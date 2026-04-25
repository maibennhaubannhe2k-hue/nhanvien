require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ==========================================
// 1. QUẢN LÝ NHÂN VIÊN
// ==========================================
app.get('/api/employees', async (req, res) => {
    const { data, error } = await supabase.from('employees').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/employees', async (req, res) => {
    const { name, dob, hometown, skills, avatar_url, role, team_lead_id, team_name, join_date } = req.body;
    if (!name) return res.status(400).json({ error: 'Tên nhân viên là bắt buộc' });
    const employeeData = { name, dob, hometown, skills, avatar_url, role, team_lead_id, team_name, join_date };
    const { data, error } = await supabase.from('employees').insert([employeeData]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
});

app.patch('/api/employees/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from('employees').update(req.body).eq('id', id).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
});

app.delete('/api/employees/:id', async (req, res) => {
    const { id } = req.params;
    const parsedId = !Number.isNaN(Number(id)) ? Number(id) : id;
    await supabase.from('productivity_logs').delete().eq('employee_id', parsedId);
    const { data, error } = await supabase.from('employees').delete().eq('id', parsedId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Nhân viên đã được xóa thành công' });
});

// ==========================================
// 2. QUẢN LÝ CA LÀM
// ==========================================
const DEFAULT_SHIFTS = {
    individual: ["Xử lý hàng hoàn", "Đóng hộp 1", "Đóng hộp 8"],
    group: ["Xử lý hàng hoàn", "Đóng hộp 1", "Đóng hộp 8"]
};

app.get('/api/shifts', async (req, res) => {
    const { type } = req.query;
    let query = supabase.from('shifts').select('name, type').order('id', { ascending: true });
    if (type) query = query.eq('type', type);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) return res.json(type ? (DEFAULT_SHIFTS[type] || []) : DEFAULT_SHIFTS.individual);
    res.json(data.map(s => s.name));
});

app.post('/api/shifts', async (req, res) => {
    const { shiftName, type = 'individual' } = req.body;
    if (shiftName) {
        await supabase.from('shifts').insert([{ name: shiftName, type }]);
    }
    const { data, error } = await supabase.from('shifts').select('name').eq('type', type).order('id', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(s => s.name));
});

app.delete('/api/shifts', async (req, res) => {
    const { name, type = 'individual' } = req.query;
    if (!name) return res.status(400).json({ error: 'Thiếu tên ca' });
    const { error } = await supabase.from('shifts').delete().eq('name', name).eq('type', type);
    if (error) return res.status(500).json({ error: error.message });
    const { data } = await supabase.from('shifts').select('name').eq('type', type).order('id', { ascending: true });
    res.json((data || []).map(s => s.name));
});

// ==========================================
// 3. SẢN LƯỢNG & LỊCH SỬ
// ==========================================
app.post('/api/logs', async (req, res) => {
    const logsToInsert = Array.isArray(req.body) ? req.body : [req.body];
    const { data, error } = await supabase.from('productivity_logs').insert(logsToInsert);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Đã lưu lịch sử', data });
});

app.get('/api/history', async (req, res) => {
    const { employee_id, date } = req.query;
    if (!employee_id) return res.status(400).json({ error: 'Thiếu ID' });
    let query = supabase.from('productivity_logs').select('*').eq('employee_id', employee_id);
    if (date) query = query.eq('work_date', date);
    
    // FIX: Mở khóa giới hạn mặc định của Supabase lên 50.000 dòng để hiện đủ lịch sử cũ!
    const { data, error } = await query.order('created_at', { ascending: false }).limit(50000);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/logs/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from('productivity_logs').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Đã xóa lịch sử ca làm' });
});

// ==========================================
// 4. THỐNG KÊ DASHBOARD (SỐ LƯỢNG)
// ==========================================
const applyDateFilter = (query, startDate, endDate) => {
    if (startDate) query = query.gte('work_date', startDate);
    if (endDate) query = query.lte('work_date', endDate);
    return query;
};

app.get('/api/stats/employees', async (req, res) => {
    const { startDate, endDate, isGroup } = req.query;
    let query = supabase.from('productivity_logs').select(`total_orders, session_name, employees(name)`).limit(50000);
    query = applyDateFilter(query, startDate, endDate);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const stats = {};
    data.forEach(log => {
        const isLogGroup = log.session_name && log.session_name.startsWith('[NHÓM]');
        if ((isGroup === 'true' && isLogGroup) || (isGroup === 'false' && !isLogGroup)) {
            if (log.employees) {
                const empName = log.employees.name;
                stats[empName] = (stats[empName] || 0) + log.total_orders; 
            }
        }
    });
    res.json(Object.keys(stats).map(name => ({ name, total: stats[name] })));
});

app.get('/api/stats/daily', async (req, res) => {
    const { startDate, endDate, isGroup } = req.query;
    let query = supabase.from('productivity_logs').select('work_date, total_orders, session_name').limit(50000);
    query = applyDateFilter(query, startDate, endDate);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const dailyStats = {};
    data.forEach(log => {
        const isLogGroup = log.session_name && log.session_name.startsWith('[NHÓM]');
        if ((isGroup === 'true' && isLogGroup) || (isGroup === 'false' && !isLogGroup)) {
            const date = log.work_date;
            dailyStats[date] = (dailyStats[date] || 0) + log.total_orders;
        }
    });

    const result = Object.keys(dailyStats).map(date => ({
        work_date: date, total_daily_orders: dailyStats[date]
    })).sort((a, b) => a.work_date.localeCompare(b.work_date));
    res.json(result);
});

app.get('/api/stats/sessions', async (req, res) => {
    const { startDate, endDate, isGroup } = req.query;
    let query = supabase.from('productivity_logs').select(`session_name, total_orders, total_time_seconds, employees(name)`);
    query = applyDateFilter(query, startDate, endDate);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    
    const filteredData = data.filter(log => {
        const isLogGroup = log.session_name && log.session_name.startsWith('[NHÓM]');
        return (isGroup === 'true' && isLogGroup) || (isGroup === 'false' && !isLogGroup);
    });
    res.json(filteredData);
});

app.get('/api/stats/top3', async (req, res) => {
    const { date } = req.query;
    if(!date) return res.json({ individual: [], group: [] });
    
    const { data, error } = await supabase.from('productivity_logs')
        .select('total_orders, session_name, employees(name)')
        .eq('work_date', date);
    
    if (error) return res.status(500).json({ error: error.message });

    const indStats = {}; const grpStats = {};
    data.forEach(log => {
        if(!log.employees) return;
        const empName = log.employees.name;
        
        if (log.session_name && log.session_name.startsWith('[NHÓM]')) {
            grpStats[empName] = (grpStats[empName] || 0) + (log.total_orders || 0);
        } else {
            indStats[empName] = (indStats[empName] || 0) + (log.total_orders || 0);
        }
    });

    const sortTop3 = (obj) => Object.entries(obj).sort((a,b) => b[1] - a[1]).slice(0,3).map(e => ({ name: e[0], total: e[1] }));
    res.json({ individual: sortTop3(indStats), group: sortTop3(grpStats) });
});

// ==========================================
// 5. BXH HIỆU SUẤT MỚI (ĐIỂM / GIÂY)
// ==========================================
app.get('/api/stats/performance', async (req, res) => {
    const { startDate, endDate } = req.query;
    let query = supabase.from('productivity_logs').select('total_orders, total_value, coefficient, total_time_seconds, session_name, employees(name)').limit(50000);
    query = applyDateFilter(query, startDate, endDate);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const indStats = {}; const grpStats = {};

    data.forEach(log => {
        if(!log.employees) return;
        if((log.total_time_seconds || 0) < 180) return;
        const empName = log.employees.name;
        const isGroup = log.session_name && log.session_name.startsWith('[NHÓM]');
        let target = isGroup ? grpStats : indStats;

        if (!target[empName]) target[empName] = { value: 0, time: 0 };

        let val = log.total_value != null ? log.total_value : (log.total_orders * (log.coefficient || 1));

        target[empName].value += val;
        target[empName].time += (log.total_time_seconds || 1);
    });

    const calcPerf = (obj) => Object.entries(obj).map(e => {
        let perf = ((e[1].value / e[1].time) * 3600).toFixed(1);
        return { name: e[0], performance: parseFloat(perf), totalValue: e[1].value };
    }).sort((a,b) => b.performance - a.performance);

    res.json({ individual: calcPerf(indStats), group: calcPerf(grpStats) });
});

// ==========================================
// 6. TÌM KIẾM & ĐỒNG BỘ REALTIME
// ==========================================
app.get('/api/search', async (req, res) => {
    const { code } = req.query;
    const { data, error } = await supabase.from('productivity_logs').select('*, employees(name, role, team_name)').ilike('order_codes', `%${code}%`).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

let globalActiveSessions = {}; 
app.get('/api/active-sessions', (req, res) => res.json(globalActiveSessions));
app.post('/api/active-sessions', (req, res) => {
    const { employeeId, action, sessionData } = req.body;
    if (action === 'start') globalActiveSessions[employeeId] = sessionData; 
    else if (action === 'update' && globalActiveSessions[employeeId]) {
        if (sessionData.orderCount !== undefined) globalActiveSessions[employeeId].orderCount = sessionData.orderCount;
        if (sessionData.startTime !== undefined) globalActiveSessions[employeeId].startTime = sessionData.startTime;
        if (sessionData.isPaused !== undefined) globalActiveSessions[employeeId].isPaused = sessionData.isPaused;
        if (sessionData.accumulatedTime !== undefined) globalActiveSessions[employeeId].accumulatedTime = sessionData.accumulatedTime;
        if (sessionData.coefficient !== undefined) globalActiveSessions[employeeId].coefficient = sessionData.coefficient;
    } else if (action === 'end') delete globalActiveSessions[employeeId]; 
    res.json({ success: true, activeSessions: globalActiveSessions });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running perfectly on port ${PORT}`));