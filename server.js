const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

const DATA_FILE = path.join(__dirname, 'users.json');

// تأكد من وجود ملف قاعدة البيانات النصية
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [] }));
}

// نظام تسجيل الدخول وإنشاء الحساب
app.post('/api/auth', (req, res) => {
    const { username, password, action } = req.body;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));

    if (action === 'register') {
        if (data.users.find(u => u.username === username)) {
            return res.json({ success: false, message: 'اسم المستخدم موجود مسبقاً' });
        }
        data.users.push({ username, password, settings: {} });
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return res.json({ success: true, message: 'تم إنشاء الحساب بنجاح، يمكنك تسجيل الدخول الآن.' });
    } else {
        const user = data.users.find(u => u.username === username && u.password === password);
        if (user) {
            return res.json({ success: true, message: 'تم تسجيل الدخول بنجاح' });
        }
        return res.json({ success: false, message: 'بيانات الدخول غير صحيحة' });
    }
});

// حفظ إعدادات الـ API Key وتعليمات النظام
app.post('/api/save_settings', (req, res) => {
    const { username, settings } = req.body;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    const userIndex = data.users.findIndex(u => u.username === username);
    
    if (userIndex !== -1) {
        data.users[userIndex].settings = { ...data.users[userIndex].settings, ...settings };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// توليد رمز QR لربط واتساب
app.get('/api/wa-qr', async (req, res) => {
    try {
        // في البيئة الحقيقية، هنا يتم جلب كود الـ QR من مكتبة whatsapp-web.js
        const mockData = "whatsapp-connect-mock-" + Date.now();
        const qrImage = await QRCode.toDataURL(mockData);
        res.json({ success: true, qr: qrImage });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
