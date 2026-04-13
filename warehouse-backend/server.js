require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// KẾT NỐI SUPABASE
// ==========================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ==========================================
// MODULE 1: QUẢN LÝ NHÂN VIÊN
// ==========================================

// Lấy danh sách nhân viên
app.get('/api/employees', async (req, res) => {
    const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Thêm nhân viên mới
app.post('/api/employees', async (req, res) => {
    const { name, dob, hometown, skills, avatar_url, role, team_lead_id, team_name, join_date } = req.body;
    if (!name) return res.status(400).json({ error: 'Tên nhân viên là bắt buộc' });
    
    const employeeData = { name, dob, hometown, skills, avatar_url, role };
    if (team_lead_id) employeeData.team_lead_id = team_lead_id;
    if (team_name) employeeData.team_name = team_name;
    if (join_date) employeeData.join_date = join_date;

    const { data, error } = await supabase.from('employees').insert([employeeData]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
});

// Chỉnh sửa hồ sơ nhân viên
app.patch('/api/employees/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('employees')
        .update(req.body)
        .eq('id', id)
        .select();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
});

// Xóa nhân viên và dữ liệu liên quan
app.delete('/api/employees/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Thiếu ID nhân viên' });
    const parsedId = !Number.isNaN(Number(id)) ? Number(id) : id;

    // Xóa lịch sử làm việc trước để tránh lỗi liên kết dữ liệu
    const { error: logError } = await supabase.from('productivity_logs').delete().eq('employee_id', parsedId);
    if (logError) return res.status(500).json({ error: logError.message });

    const { data, error } = await supabase.from('employees').delete().eq('id', parsedId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Nhân viên đã được xóa thành công' });
});

// ==========================================
// MODULE 2: SẢN LƯỢNG & LỊCH SỬ
// ==========================================

// Lưu kết quả ca làm việc
app.post('/api/logs', async (req, res) => {
    const { 
        employee_id, work_date, start_time, end_time, total_orders, 
        total_time_seconds, average_time_per_order, session_name, order_codes 
    } = req.body;

    if (!employee_id) return res.status(400).json({ error: 'Thiếu ID nhân viên' });

    const { data, error } = await supabase.from('productivity_logs').insert([{ 
        employee_id, work_date, start_time, end_time, total_orders, 
        total_time_seconds, average_time_per_order, session_name, order_codes 
    }]);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Đã lưu lịch sử thành công', data });
});

// Truy vấn lịch sử theo nhân viên và ngày
app.get('/api/history', async (req, res) => {
    const { employee_id, date } = req.query;
    if (!employee_id) return res.status(400).json({ error: 'Thiếu ID nhân viên' });

    let query = supabase.from('productivity_logs').select('*').eq('employee_id', employee_id);
    if (date) query = query.eq('work_date', date);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ==========================================
// MODULE 3: THỐNG KÊ (DASHBOARD - NÂNG CẤP LỌC TỪ NGÀY ĐẾN NGÀY)
// ==========================================

// Thống kê sản lượng nhân viên theo khoảng ngày
app.get('/api/stats/employees', async (req, res) => {
    const { startDate, endDate } = req.query; 
    let query = supabase.from('productivity_logs').select(`total_orders, employees(name)`);
    
    // Lọc theo khoảng ngày nếu có
    if (startDate) query = query.gte('work_date', startDate);
    if (endDate) query = query.lte('work_date', endDate);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const stats = {};
    data.forEach(log => {
        if (log.employees) {
            const empName = log.employees.name;
            stats[empName] = (stats[empName] || 0) + log.total_orders;
        }
    });
    res.json(Object.keys(stats).map(name => ({ name, total: stats[name] })));
});

// Thống kê tổng kho theo khoảng ngày
app.get('/api/stats/daily', async (req, res) => {
    const { startDate, endDate } = req.query;
    let query = supabase.from('daily_productivity').select('*');
    
    if (startDate) query = query.gte('work_date', startDate);
    if (endDate) query = query.lte('work_date', endDate);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// API MỚI: Lấy dữ liệu để vẽ Bảng Xếp Hạng Tốc Độ Theo Ca
app.get('/api/stats/sessions', async (req, res) => {
    const { startDate, endDate } = req.query;
    let query = supabase.from('productivity_logs').select(`session_name, total_orders, total_time_seconds, employees(name)`);
    
    if (startDate) query = query.gte('work_date', startDate);
    if (endDate) query = query.lte('work_date', endDate);
    
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ==========================================
// MODULE 4: TÌM KIẾM MÃ VẬN ĐƠN
// ==========================================
app.get('/api/search', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'Thiếu mã vận đơn' });

    const { data, error } = await supabase
        .from('productivity_logs')
        .select('*, employees(name, role, team_name)')
        .ilike('order_codes', `%${code}%`)
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ==========================================
// MODULE 5: ĐỒNG BỘ TRẠNG THÁI "ĐANG LÀM" (REAL-TIME NÂNG CẤP)
// ==========================================
let globalActiveSessions = {}; 

// Lấy danh sách ai đang làm (để máy khác hiện chấm xanh/vàng)
app.get('/api/active-sessions', (req, res) => {
    res.json(globalActiveSessions);
});

// Cập nhật trạng thái khi có máy Bắt đầu/Gõ đơn/Kết thúc/Tạm dừng
app.post('/api/active-sessions', (req, res) => {
    const { employeeId, action, sessionData } = req.body;
    
    if (action === 'start') {
        // Khởi tạo phiên làm việc trên server
        globalActiveSessions[employeeId] = sessionData; 
    } else if (action === 'update' && globalActiveSessions[employeeId]) {
        // Cập nhật các thông số từ máy đang làm (Số đơn, Tạm dừng, Thời gian)
        if (sessionData.orderCount !== undefined) globalActiveSessions[employeeId].orderCount = sessionData.orderCount;
        if (sessionData.startTime !== undefined) globalActiveSessions[employeeId].startTime = sessionData.startTime;
        if (sessionData.isPaused !== undefined) globalActiveSessions[employeeId].isPaused = sessionData.isPaused;
        if (sessionData.accumulatedTime !== undefined) globalActiveSessions[employeeId].accumulatedTime = sessionData.accumulatedTime;
    } else if (action === 'end') {
        // Xóa phiên làm việc khi kết thúc
        delete globalActiveSessions[employeeId]; 
    }
    
    // Gửi lại danh sách sau khi đã cập nhật để đảm bảo tính đồng bộ
    res.json({ success: true, activeSessions: globalActiveSessions });
});

// ==========================================
// KHỞI ĐỘNG SERVER (LUÔN ĐỂ Ở CUỐI)
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running perfectly on port ${PORT}`));