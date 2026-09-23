const express = require('express');
const path = require('path');
const cors = require('cors');
const QRCode = require('qrcode');
const TelegramBot = require('node-telegram-bot-api');
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

const activeTelegramBots = {};
const activeDiscordBots = {};
const activeWhatsAppSockets = {};
const whatsappQRCodes = {}; // تخزين رموز QR مؤقتاً

// ==========================================
// محرك الذكاء الاصطناعي (Gemini)
// ==========================================
async function generateAIResponse(agent, userMessage) {
    if (!agent.apiKeys || agent.apiKeys.length === 0) {
        return "⚠️ خطأ: لم يتم ضبط مفاتيح API للذكاء الاصطناعي لهذا المساعد.";
    }

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
        console.error("خطأ الذكاء الاصطناعي:", error.message);
        return "عذراً، حدث خطأ أثناء معالجة الطلب.";
    }
}

// ==========================================
// إدارة واتساب الحقيقي (Baileys)
// ==========================================
async function startWhatsAppBot(agentId) {
    const { state, saveCreds } = await useMultiFileAuthState(`./auth_wa_${agentId}`);
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    // مراقبة الاتصال ورمز الـ QR
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            // تحويل رمز الـ QR إلى صورة Base64 لإرسالها للواجهة
            whatsappQRCodes[agentId] = await QRCode.toDataURL(qr);
        }

        if (connection === 'open') {
            console.log(`✅ تم ربط واتساب بنجاح للمساعد [${agentId}]`);
            delete whatsappQRCodes[agentId];
            if (agentsData[agentId]) {
                agentsData[agentId].channels.wa.connected = true;
            }
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) {
                startWhatsAppBot(agentId);
            } else {
                if (agentsData[agentId]) agentsData[agentId].channels.wa.connected = false;
            }
        }
    });

    // استقبال رسائل واتساب والرد عليها
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            if (msg.key.fromMe) continue; // عدم الرد على الرسائل المرسلة منك
            
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            if (!text) continue;

            const agent = agentsData[agentId];
            if (!agent || agent.status !== 'published') continue;

            // توليد رد عبر الذكاء الاصطناعي
            const reply = await generateAIResponse(agent, text);
            await sock.sendMessage(msg.key.remoteJid, { text: reply });
        }
    });

    activeWhatsAppSockets[agentId] = sock;
}

// ==========================================
// إدارة تلغرام وديسكورد
// ==========================================
function startTelegramBot(agentId, token) {
    if (activeTelegramBots[agentId]) {
        try { activeTelegramBots[agentId].stopPolling(); } catch (e) {}
    }
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('message', async (msg) => {
            if (!msg.text || msg.text.startsWith('/start')) return;
            const agent = agentsData[agentId];
            if (!agent || agent.status !== 'published') return;
            bot.sendChatAction(msg.chat.id, 'typing');
            const reply = await generateAIResponse(agent, msg.text);
            bot.sendMessage(msg.chat.id, reply);
        });
        activeTelegramBots[agentId] = bot;
    } catch (e) { console.error(e); }
}

function startDiscordBot(agentId, token) {
    if (activeDiscordBots[agentId]) {
        try { activeDiscordBots[agentId].destroy(); } catch (e) {}
    }
    try {
        const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
        client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            const agent = agentsData[agentId];
            if (!agent || agent.status !== 'published') return;
            await message.channel.sendTyping();
            const reply = await generateAIResponse(agent, message.content);
            message.reply(reply);
        });
        client.login(token);
        activeDiscordBots[agentId] = client;
    } catch (e) { console.error(e); }
}

// ==========================================
// المسارات البرمجية (APIs)
// ==========================================
app.get('/api/agents', (req, res) => res.json(Object.values(agentsData)));

app.post('/api/agents/save', (req, res) => {
    const agent = req.body;
    agentsData[agent.id] = agent;
    res.json({ success: true, agent });
});

// مسار الحصول على رمز QR الحقيقي لواتساب
app.get('/api/whatsapp/qr/:agentId', async (req, res) => {
    const { agentId } = req.params;
    
    if (!activeWhatsAppSockets[agentId]) {
        startWhatsAppBot(agentId);
    }
    
    // انتظار توليد الـ QR إذا لم يكن جاهزاً
    setTimeout(() => {
        const qrImage = whatsappQRCodes[agentId];
        const isConnected = agentsData[agentId]?.channels?.wa?.connected || false;
        res.json({ qr: qrImage || null, connected: isConnected });
    }, 1500);
});

// مسار النشر والتشغيل
app.post('/api/agents/publish', async (req, res) => {
    const { agentId } = req.body;
    const agent = agentsData[agentId];

    if (!agent) return res.status(404).json({ success: false, errors: ["المساعد غير موجود."] });

    const errors = [];
    if (!agent.instructions) errors.push("تعليمات النظام فارغة.");
    if (!agent.apiKeys || agent.apiKeys.length === 0) errors.push("لم يتم إضافة مفتاح Gemini.");

    if (errors.length > 0) return res.json({ success: false, errors });

    agent.status = "published";

    if (agent.channels.tg?.connected && agent.channels.tg?.config?.token) {
        startTelegramBot(agent.id, agent.channels.tg.config.token);
    }
    if (agent.channels.dc?.connected && agent.channels.dc?.config?.token) {
        startDiscordBot(agent.id, agent.channels.dc.config.token);
    }

    res.json({ success: true, message: "تم نشر المساعد وتفعيل البوتات بنجاح!" });
});

app.listen(PORT, () => console.log(`🚀 السيرفر الحقيقي يعمل على المنفذ ${PORT}`));
