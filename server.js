const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// تخزين المساعدين في الذاكرة (مؤقتاً)
let agentsData = {
    "1": {
        id: "1",
        name: "new agent",
        type: "IMFA Agents Default",
        instructions: "أنت مساعد ذكي ولطيف تقوم بالرد على استفسارات العملاء باحترافية.",
        provider: "gemini",
        apiKeys: ["AIzaSyExampleKey123456"],
        status: "draft", // draft, published
        channels: {
            wa: { connected: false, config: {} },
            tg: { connected: false, config: {} },
            dc: { connected: false, config: {} }
        }
    }
};

// API: جلب كل المساعدين
app.get('/api/agents', (req, res) => {
    res.json(Object.values(agentsData));
});

// API: حفظ بيانات مساعد
app.post('/api/agents/save', (req, res) => {
    const agent = req.body;
    if (!agent || !agent.id) {
        return res.status(400).json({ error: "بيانات المساعد غير مكتملة" });
    }
    agentsData[agent.id] = agent;
    res.json({ success: true, message: "تم حفظ التغييرات بنجاح!", agent });
});

// API: التحقق والنشر
app.post('/api/agents/publish', (req, res) => {
    const { agentId } = req.body;
    const agent = agentsData[agentId];

    if (!agent) {
        return res.status(404).json({ success: false, errors: ["المساعد غير موجود."] });
    }

    const errors = [];

    // 1. التحقق من التعليمات
    if (!agent.instructions || agent.instructions.trim().length === 0) {
        errors.push("تعليمات النظام فارغة. يرجى إضافة تعليمات للمساعد.");
    }

    // 2. التحقق من مفاتيح API
    if (!agent.apiKeys || agent.apiKeys.length === 0 || agent.apiKeys.every(k => !k.trim())) {
        errors.push("لم يتم إضافة أي مفتاح API صالح لمزود الذكاء الاصطناعي.");
    }

    // 3. التحقق من وجود قناة واحدة متصلة على الأقل
    const hasConnectedChannel = Object.values(agent.channels || {}).some(c => c.connected === true);
    if (!hasConnectedChannel) {
        errors.push("يجب ربط قناة واحدة على الأقل (WhatsApp, Telegram, أو Discord) وتفعيلها.");
    }

    if (errors.length > 0) {
        return res.json({ success: false, errors });
    }

    // تغيير الحالة إلى منشور
    agent.status = "published";
    res.json({ success: true, message: "تم نشر المساعد بنجاح! المساعد الآن يعمل ويتلقى الرسائل." });
});

app.listen(PORT, () => {
    console.log(`🚀 خادم مِنسَج يعمل الآن على المنفذ: ${PORT}`);
});
