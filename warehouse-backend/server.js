require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Kết nối Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ==========================================
// API NHÂN VIÊN
// ==========================================
app.get('/api/employees', async (req, res) => {
    const { data, error } = await supabase.from('employees').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/employees', async (req, res) => {
    const { name, dob, hometown, skills, avatar_url, role, team_lead_id, team_name, join_date } = req.body;
    if (!name) return res.status(400).json({ error: 'Tên nhân viên là bắt buộc' });
    
    const employeeData = { name, dob, hometown, skills, avatar_url, role };
    if (team_lead_id) employeeData.team_lead_id = team_lead_id;
    if (team_name) employeeData.team_name = team_name;
    if (join_date) employeeData.join_date = join_date;

    const { data, error } = await supabase.from('employees')
        .insert([employeeData])
        .select();
        
    if (error) {
        console.error('POST /api/employees failed:', error);
        return res.status(500).json({ error: error.message });
    }
    res.json(data[0]);
});

app.patch('/api/employees/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    const { data, error } = await supabase.from('employees')
        .update(updates)
        .eq('id', id)
        .select();
        
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
});

app.delete('/api/employees/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Thiếu ID nhân viên' });

    const parsedId = !Number.isNaN(Number(id)) ? Number(id) : id;

    const { error: logError } = await supabase.from('productivity_logs').delete().eq('employee_id', parsedId);
    if (logError) return res.status(500).json({ error: logError.message });

    const { data, error } = await supabase.from('employees').delete().eq('id', parsedId);
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) return res.status(404).json({ error: 'Nhân viên không tồn tại' });

    res.json({ message: 'Nhân viên đã được xóa' });
});


// ==========================================
// API SẢN LƯỢNG & LỊCH SỬ
// ==========================================
app.post('/api/logs', async (req, res) => {
    const { employee_id, work_date, start_time, end_time, total_orders, total_time_seconds, average_time_per_order, session_name, order_codes } = req.body;
    
    if (!employee_id) return res.status(400).json({ error: 'Thiếu ID nhân viên' });

    const { data, error } = await supabase
        .from('productivity_logs')
        .insert([{ 
            employee_id, work_date, start_time, end_time, total_orders, 
            total_time_seconds, average_time_per_order, session_name, order_codes 
        }]);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Đã lưu thành công', data });
});

app.get('/api/history', async (req, res) => {
    const { employee_id, date } = req.query;
    if (!employee_id) return res.status(400).json({ error: 'Thiếu ID nhân viên' });

    let query = supabase
        .from('productivity_logs')
        .select('*')
        .eq('employee_id', employee_id);
    
    if (date) {
        query = query.eq('work_date', date);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});


// ==========================================
// API DASHBOARD (Thống kê)
// ==========================================
app.get('/api/stats/employees', async (req, res) => {
    const { date } = req.query; 
    let query = supabase.from('productivity_logs').select(`total_orders, employees(name)`);
    if (date) query = query.eq('work_date', date);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const stats = {};
    data.forEach(log => {
        const empName = log.employees.name;
        stats[empName] = (stats[empName] || 0) + log.total_orders;
    });

    res.json(Object.keys(stats).map(name => ({ name, total: stats[name] })));
});

app.get('/api/stats/daily', async (req, res) => {
    const { data, error } = await supabase.from('daily_productivity').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});


// ==========================================
// API TÌM KIẾM MÃ VẬN ĐƠN
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
// API ĐỒNG BỘ TRẠNG THÁI (CHẤM XANH) GIỮA CÁC MÁY
// ==========================================
let globalActiveSessions = {}; 

app.get('/api/active-sessions', (req, res) => {
    res.json(globalActiveSessions);
});

app.post('/api/active-sessions', (req, res) => {
    const { employeeId, action, sessionData } = req.body;
    if (action === 'start') {
        globalActiveSessions[employeeId] = sessionData; 
    } else if (action === 'end') {
        delete globalActiveSessions[employeeId]; 
    }
    res.json({ success: true, activeSessions: globalActiveSessions });
});


// ==========================================
// CHỐT SỔ (LUÔN PHẢI NẰM DƯỚI CÙNG)
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));