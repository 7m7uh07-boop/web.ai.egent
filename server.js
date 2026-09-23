const express = require('express');
const path = require('path');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// تخزين المساعدين والبوتات النشطة في الذاكرة
let agentsData = {
    "1": {
        id: "1",
        name: "new agent",
        type: "IMFA Agents Default",
        instructions: "أنت مساعد ذكي ولطيف تقوم بالرد على استفسارات المستخدمين باختصار واحترافية.",
        provider: "gemini",
        apiKeys: [],
        status: "draft",
        channels: {
            wa: { connected: false, config: {} },
            tg: { connected: false, config: {} },
            dc: { connected: false, config: {} }
        }
    }
};

// حاويات البوتات المشغلة حالياً
const activeTelegramBots = {};
const activeDiscordBots = {};

// ==========================================
// محرك الذكاء الاصطناعي (Gemini / AI Engine)
// ==========================================
async function generateAIResponse(agent, userMessage) {
    if (!agent.apiKeys || agent.apiKeys.length === 0) {
        return "⚠️ خطأ: لم يتم ضبط مفاتيح API للذكاء الاصطناعي لهذا المساعد.";
    }

    // اختيار مفتاح API عشوائي للتناوب (Load Balancing)
    const apiKey = agent.apiKeys[Math.floor(Math.random() * agent.apiKeys.length)];

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: agent.instructions || "أنت مساعد ذكي مفيد."
        });

        const result = await model.generateContent(userMessage);
        return result.response.text();
    } catch (error) {
        console.error("خطأ في توليد الرد من الذكاء الاصطناعي:", error.message);
        return "عذراً، حدث خطأ أثناء معالجة الطلب عبر الذكاء الاصطناعي.";
    }
}

// ==========================================
// إدارة بوتات تلغرام الحقيقية
// ==========================================
function startTelegramBot(agentId, token) {
    // إيقاف البوت القديم إن وجد
    if (activeTelegramBots[agentId]) {
        try { activeTelegramBots[agentId].stopPolling(); } catch (e) {}
    }

    try {
        const bot = new TelegramBot(token, { polling: true });

        bot.on('message', async (msg) => {
            if (!msg.text || msg.text.startsWith('/start')) {
                if (msg.text === '/start') bot.sendMessage(msg.chat.id, "أهلاً بك! أنا جاهز لمساعدتك.");
                return;
            }

            const agent = agentsData[agentId];
            if (!agent || agent.status !== 'published') return;

            // إرسال مؤشر "جاري الكتابة..."
            bot.sendChatAction(msg.chat.id, 'typing');

            // توليد الرد وإرساله
            const reply = await generateAIResponse(agent, msg.text);
            bot.sendMessage(msg.chat.id, reply);
        });

        activeTelegramBots[agentId] = bot;
        console.log(`✅ تم تشغيل بوت تلغرام للمساعد [${agentId}] بنجاح!`);
        return true;
    } catch (e) {
        console.error(`❌ فشل تشغيل بوت تلغرام للمساعد [${agentId}]:`, e.message);
        return false;
    }
}

// ==========================================
// إدارة بوتات ديسكورد الحقيقية
// ==========================================
function startDiscordBot(agentId, token) {
    if (activeDiscordBots[agentId]) {
        try { activeDiscordBots[agentId].destroy(); } catch (e) {}
    }

    try {
        const client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        });

        client.on('messageCreate', async (message) => {
            if (message.author.bot) return; // تجاهل رسائل البوتات الأخرى

            const agent = agentsData[agentId];
            if (!agent || agent.status !== 'published') return;

            // إرسال مؤشر "جاري الكتابة..."
            await message.channel.sendTyping();

            const reply = await generateAIResponse(agent, message.content);
            message.reply(reply);
        });

        client.login(token);
        activeDiscordBots[agentId] = client;
        console.log(`✅ تم تشغيل بوت ديسكورد للمساعد [${agentId}] بنجاح!`);
        return true;
    } catch (e) {
        console.error(`❌ فشل تشغيل بوت ديسكورد للمساعد [${agentId}]:`, e.message);
        return false;
    }
}

// ==========================================
// المسارات واجهات البرمجة (API Routes)
// ==========================================

app.get('/api/agents', (req, res) => {
    res.json(Object.values(agentsData));
});

app.post('/api/agents/save', (req, res) => {
    const agent = req.body;
    if (!agent || !agent.id) return res.status(400).json({ error: "بيانات غير مكتملة" });

    agentsData[agent.id] = agent;
    res.json({ success: true, message: "تم حفظ الإعدادات بنجاح!", agent });
});

// مسار نشر المساعد وتشغيل البوتات الحقيقية
app.post('/api/agents/publish', async (req, res) => {
    const { agentId } = req.body;
    const agent = agentsData[agentId];

    if (!agent) return res.status(404).json({ success: false, errors: ["المساعد غير موجود."] });

    const errors = [];
    if (!agent.instructions || !agent.instructions.trim()) errors.push("تعليمات النظام فارغة.");
    if (!agent.apiKeys || agent.apiKeys.length === 0 || agent.apiKeys.every(k => !k.trim())) {
        errors.push("لم يتم إضافة أي مفتاح API لـ Gemini.");
    }

    const hasConnectedChannel = Object.values(agent.channels || {}).some(c => c.connected === true);
    if (!hasConnectedChannel) errors.push("يجب ربط قناة واحدة على الأقل (Telegram أو Discord).");

    if (errors.length > 0) return res.json({ success: false, errors });

    // تغيير حالة المساعد إلى "منشور"
    agent.status = "published";

    // تشغيل القنوات المتصلة حقيقياً
    if (agent.channels.tg && agent.channels.tg.connected && agent.channels.tg.config.token) {
        startTelegramBot(agent.id, agent.channels.tg.config.token);
    }

    if (agent.channels.dc && agent.channels.dc.connected && agent.channels.dc.config.token) {
        startDiscordBot(agent.id, agent.channels.dc.config.token);
    }

    res.json({
        success: true,
        message: "تم نشر المساعد وتفعيل الاتصال الحقيقي بالسيرفرات! يمكنك الآن مراسلة البوت على تلغرام/ديسكورد للرد عليك."
    });
});

app.listen(PORT, () => {
    console.log(`🚀 سيرفر مِنسَج الحقيقي يعمل الآن على المنفذ: ${PORT}`);
});
