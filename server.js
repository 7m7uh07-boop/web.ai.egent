const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const TelegramBot = require('node-telegram-bot-api');
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// تخزين دائم على القرص (لتفادي فقدان كل شيء عند
// إعادة تشغيل السيرفر - كان هذا سبب رئيسي لأخطاء "الموقع معطوب")
// ==========================================
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function defaultAgent(id) {
    return {
        id,
        name: "new agent",
        type: "IMFA Agents Default",
        instructions: "أنت مساعد ذكي ولطيف تقوم بالرد على استفسارات المستخدمين باختصار واحترافية.",
        provider: "gemini",
        customEndpoint: "",
        customModelName: "",
        imfaAgentId: "",
        apiKeys: [],
        status: "draft",
        channels: {
            wa: { connected: false, config: {} },
            tg: { connected: false, config: {} },
            dc: { connected: false, config: {} }
        }
    };
}

function loadStore() {
    try {
        if (fs.existsSync(STORE_FILE)) {
            const raw = fs.readFileSync(STORE_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.users) return parsed;
        }
    } catch (err) {
        console.error('⚠️ تعذرت قراءة ملف البيانات، سيتم إنشاء بيانات جديدة:', err.message);
    }
    return { users: {} };
}

let store = loadStore();

function saveStore() {
    try {
        fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
        console.error('⚠️ تعذر حفظ البيانات على القرص:', err.message);
    }
}

function getUserAgents(username) {
    if (!store.users[username]) return {};
    return store.users[username].agents || {};
}

function getAgent(username, agentId) {
    return getUserAgents(username)[agentId] || null;
}

function setAgent(username, agent) {
    if (!store.users[username]) return;
    if (!store.users[username].agents) store.users[username].agents = {};
    store.users[username].agents[agent.id] = agent;
    saveStore();
}

function deleteAgentFromStore(username, agentId) {
    if (!store.users[username] || !store.users[username].agents) return;
    delete store.users[username].agents[agentId];
    saveStore();
}

// ==========================================
// نظام تسجيل الدخول / إنشاء الحساب
// ==========================================
const sessions = {}; // token -> username (في الذاكرة، تُنشأ من جديد عند إعادة التشغيل)
const SESSION_COOKIE = 'sid';

function parseCookies(req) {
    const header = req.headers.cookie;
    const cookies = {};
    if (!header) return cookies;
    header.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        cookies[key] = decodeURIComponent(val);
    });
    return cookies;
}

function createSession(username) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions[token] = username;
    return token;
}

function requireAuth(req, res, next) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    const username = token && sessions[token];
    if (!username || !store.users[username]) {
        return res.status(401).json({ success: false, message: "يجب تسجيل الدخول أولاً." });
    }
    req.user = username;
    next();
}

function isValidUsername(u) {
    return typeof u === 'string' && /^[a-zA-Z0-9_\u0600-\u06FF]{3,32}$/.test(u.trim());
}

app.post('/api/auth/register', async (req, res) => {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    if (!isValidUsername(username)) {
        return res.json({ success: false, message: "اسم المستخدم يجب أن يكون بين 3 و32 حرفًا (أحرف/أرقام فقط)." });
    }
    if (password.length < 6) {
        return res.json({ success: false, message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل." });
    }
    if (store.users[username]) {
        return res.json({ success: false, message: "اسم المستخدم مستخدم بالفعل." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const firstAgentId = String(Date.now());
    store.users[username] = {
        passwordHash,
        createdAt: new Date().toISOString(),
        agents: { [firstAgentId]: defaultAgent(firstAgentId) }
    };
    saveStore();

    const token = createSession(username);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
    res.json({ success: true, message: "تم إنشاء الحساب بنجاح!", username });
});

app.post('/api/auth/login', async (req, res) => {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    const user = store.users[username];
    if (!user) {
        return res.json({ success: false, message: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
        return res.json({ success: false, message: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    }

    const token = createSession(username);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
    res.json({ success: true, message: "تم تسجيل الدخول بنجاح!", username });
});

app.post('/api/auth/logout', (req, res) => {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (token) delete sessions[token];
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    const username = token && sessions[token];
    if (!username || !store.users[username]) {
        return res.status(401).json({ success: false });
    }
    res.json({ success: true, username });
});

// ==========================================
// أدوات مساعدة عامة
// ==========================================
function sanitizeUrl(raw) {
    if (!raw) return "";
    let url = String(raw).trim();
    const mdMatch = url.match(/\]\((https?:\/\/[^)\s]+)\)/);
    if (mdMatch) url = mdMatch[1];
    url = url.replace(/[\[\]]/g, '').trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url.replace(/\/+$/, '');
}

const activeTelegramBots = {};
const activeDiscordBots = {};
const activeWhatsAppSockets = {};
const whatsappQRCodes = {};
const imfaSessions = {};
const waRestartAttempts = {};

function botKey(username, agentId) { return `${username}::${agentId}`; }

// ==========================================
// محركات الذكاء الاصطناعي (تدعم عدة مزودين فعليًا)
// ==========================================
async function generateGeminiResponse(agent, userMessage) {
    const apiKey = agent.apiKeys[Math.floor(Math.random() * agent.apiKeys.length)];
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-flash-latest",
        systemInstruction: agent.instructions || "أنت مساعد ذكي مفيد."
    });
    const result = await model.generateContent(userMessage);
    return result.response.text();
}

async function generateOpenAIResponse(agent, userMessage) {
    const apiKey = agent.apiKeys[Math.floor(Math.random() * agent.apiKeys.length)];
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: agent.customModelName || "gpt-4o-mini",
            messages: [
                { role: "system", content: agent.instructions || "أنت مساعد ذكي مفيد." },
                { role: "user", content: userMessage }
            ]
        })
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "لم يصل رد.";
}

async function generateAnthropicResponse(agent, userMessage) {
    const apiKey = agent.apiKeys[Math.floor(Math.random() * agent.apiKeys.length)];
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: agent.customModelName || "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            system: agent.instructions || "أنت مساعد ذكي مفيد.",
            messages: [{ role: "user", content: userMessage }]
        })
    });
    if (!response.ok) throw new Error(`Anthropic ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return data.content?.[0]?.text || "لم يصل رد.";
}

async function generateCustomResponse(agent, userMessage) {
    const apiKey = agent.apiKeys[Math.floor(Math.random() * agent.apiKeys.length)];
    const baseUrl = sanitizeUrl(agent.customEndpoint);
    if (!baseUrl) throw new Error("رابط الـ Custom Endpoint غير صالح أو فارغ.");
    const endpoint = /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: agent.customModelName || "default",
            messages: [
                { role: "system", content: agent.instructions || "أنت مساعد ذكي مفيد." },
                { role: "user", content: userMessage }
            ]
        })
    });
    if (!response.ok) throw new Error(`Custom Endpoint ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || data.reply || "لم يصل رد.";
}

async function generateIMFAResponse(agent, userMessage, chatKey) {
    if (!agent.imfaAgentId) throw new Error("لم يتم ضبط معرّف وكيل IMFA (Agent ID).");
    const apiKey = agent.apiKeys[0];
    const sessionKey = `${agent.id}:${chatKey || 'default'}`;
    const existingSessionId = imfaSessions[sessionKey];

    const body = { message: userMessage };
    if (existingSessionId) body.sessionId = existingSessionId;

    const response = await fetch(`https://site.imfa.app/v1/agents/${agent.imfaAgentId}/chat`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": "chat-" + crypto.randomUUID(),
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`IMFA ${response.status}: ${await response.text()}`);
    const data = await response.json();
    if (data.sessionId) imfaSessions[sessionKey] = data.sessionId;
    return data.reply || "لم يصل رد.";
}

async function generateAIResponse(agent, userMessage, chatKey) {
    if (!agent.apiKeys || agent.apiKeys.length === 0) {
        return "⚠️ خطأ: لم يتم ضبط مفاتيح API للذكاء الاصطناعي لهذا المساعد.";
    }
    try {
        switch (agent.provider) {
            case 'openai': return await generateOpenAIResponse(agent, userMessage);
            case 'anthropic': return await generateAnthropicResponse(agent, userMessage);
            case 'imfa': return await generateIMFAResponse(agent, userMessage, chatKey);
            case 'custom': return await generateCustomResponse(agent, userMessage);
            case 'gemini':
            default: return await generateGeminiResponse(agent, userMessage);
        }
    } catch (error) {
        console.error(`خطأ الذكاء الاصطناعي [${agent.provider}]:`, error.message);
        return "عذراً، حدث خطأ أثناء معالجة الطلب. تحقق من صحة مفتاح API والنموذج المختار.";
    }
}

function extractWhatsAppText(message) {
    if (!message) return null;
    let m = message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m?.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    if (m?.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
    if (m?.viewOnceMessage) m = m.viewOnceMessage.message;
    if (!m) return null;

    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.buttonsResponseMessage?.selectedDisplayText ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        null
    );
}

// ==========================================
// إدارة واتساب الحقيقي (Baileys)
// ==========================================
async function startWhatsAppBot(username, agentId, isRestart = false) {
    const key = botKey(username, agentId);
    if (activeWhatsAppSockets[key] && !isRestart) {
        return activeWhatsAppSockets[key];
    }

    const authDir = path.join(DATA_DIR, `auth_wa_${username}_${agentId}`);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            whatsappQRCodes[key] = await QRCode.toDataURL(qr);
        }

        if (connection === 'open') {
            console.log(`✅ تم ربط واتساب بنجاح [${key}]`);
            delete whatsappQRCodes[key];
            waRestartAttempts[key] = 0;
            const agent = getAgent(username, agentId);
            if (agent) {
                agent.channels.wa.connected = true;
                setAgent(username, agent);
            }
        } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const loggedOut = statusCode === DisconnectReason.loggedOut;

            delete activeWhatsAppSockets[key];

            if (loggedOut) {
                const agent = getAgent(username, agentId);
                if (agent) { agent.channels.wa.connected = false; setAgent(username, agent); }
                waRestartAttempts[key] = 0;
                return;
            }

            waRestartAttempts[key] = (waRestartAttempts[key] || 0) + 1;
            if (waRestartAttempts[key] <= 5) {
                setTimeout(() => startWhatsAppBot(username, agentId, true), 1500);
            } else {
                console.error(`❌ فشل ربط واتساب [${key}] بعد عدة محاولات.`);
                const agent = getAgent(username, agentId);
                if (agent) { agent.channels.wa.connected = false; setAgent(username, agent); }
                delete whatsappQRCodes[key];
                waRestartAttempts[key] = 0;
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe) continue;

            const text = extractWhatsAppText(msg.message);
            if (!text) continue;

            const agent = getAgent(username, agentId);
            if (!agent || agent.status !== 'published') continue;

            try {
                const reply = await generateAIResponse(agent, text, msg.key.remoteJid);
                await sock.sendMessage(msg.key.remoteJid, { text: reply });
            } catch (err) {
                console.error(`خطأ أثناء الرد على واتساب [${key}]:`, err.message);
            }
        }
    });

    activeWhatsAppSockets[key] = sock;
    return sock;
}

// ==========================================
// إدارة تلغرام وديسكورد
// ==========================================
function startTelegramBot(username, agentId, token) {
    const key = botKey(username, agentId);
    if (activeTelegramBots[key]) {
        try { activeTelegramBots[key].stopPolling(); } catch (e) {}
    }
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', (err) => console.error(`Telegram polling error [${key}]:`, err.message));
        bot.on('message', async (msg) => {
            if (!msg.text || msg.text.startsWith('/start')) return;
            const agent = getAgent(username, agentId);
            if (!agent || agent.status !== 'published') return;
            bot.sendChatAction(msg.chat.id, 'typing');
            const reply = await generateAIResponse(agent, msg.text, String(msg.chat.id));
            bot.sendMessage(msg.chat.id, reply);
        });
        activeTelegramBots[key] = bot;
    } catch (e) { console.error(`تعذر تشغيل بوت تلغرام [${key}]:`, e.message); }
}

function startDiscordBot(username, agentId, token) {
    const key = botKey(username, agentId);
    if (activeDiscordBots[key]) {
        try { activeDiscordBots[key].destroy(); } catch (e) {}
    }
    try {
        const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
        client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            const agent = getAgent(username, agentId);
            if (!agent || agent.status !== 'published') return;
            await message.channel.sendTyping();
            const reply = await generateAIResponse(agent, message.content, String(message.channel.id));
            message.reply(reply);
        });
        client.login(token).catch(err => console.error(`تعذر تسجيل دخول بوت ديسكورد [${key}]:`, err.message));
        activeDiscordBots[key] = client;
    } catch (e) { console.error(`تعذر تشغيل بوت ديسكورد [${key}]:`, e.message); }
}

// ==========================================
// المسارات البرمجية (APIs) - كلها محمية بتسجيل الدخول
// ==========================================
app.get('/api/agents', requireAuth, (req, res) => {
    res.json(Object.values(getUserAgents(req.user)));
});

app.post('/api/agents/save', requireAuth, (req, res) => {
    const agent = req.body;
    if (!agent || !agent.id) return res.status(400).json({ success: false, message: "بيانات المساعد غير صالحة." });
    if (agent.customEndpoint) agent.customEndpoint = sanitizeUrl(agent.customEndpoint);
    setAgent(req.user, agent);
    res.json({ success: true, agent });
});

app.delete('/api/agents/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const key = botKey(req.user, id);
    if (activeTelegramBots[key]) { try { activeTelegramBots[key].stopPolling(); } catch (e) {} delete activeTelegramBots[key]; }
    if (activeDiscordBots[key]) { try { activeDiscordBots[key].destroy(); } catch (e) {} delete activeDiscordBots[key]; }
    if (activeWhatsAppSockets[key]) { try { activeWhatsAppSockets[key].end(); } catch (e) {} delete activeWhatsAppSockets[key]; }
    deleteAgentFromStore(req.user, id);
    res.json({ success: true });
});

app.get('/api/whatsapp/qr/:agentId', requireAuth, async (req, res) => {
    const { agentId } = req.params;
    const key = botKey(req.user, agentId);

    if (!activeWhatsAppSockets[key]) {
        startWhatsAppBot(req.user, agentId);
    }

    setTimeout(() => {
        const qrImage = whatsappQRCodes[key];
        const isConnected = getAgent(req.user, agentId)?.channels?.wa?.connected || false;
        res.json({ qr: qrImage || null, connected: isConnected });
    }, 1500);
});

app.post('/api/agents/publish', requireAuth, async (req, res) => {
    const { agentId } = req.body;
    const agent = getAgent(req.user, agentId);

    if (!agent) return res.status(404).json({ success: false, errors: ["المساعد غير موجود."] });

    const errors = [];
    if (!agent.instructions) errors.push("تعليمات النظام فارغة.");
    if (!agent.apiKeys || agent.apiKeys.length === 0) errors.push("لم يتم إضافة أي مفتاح API.");
    if (agent.provider === 'imfa' && !agent.imfaAgentId) errors.push("لم يتم إدخال معرّف وكيل IMFA (Agent ID).");
    if (agent.provider === 'custom' && !sanitizeUrl(agent.customEndpoint)) errors.push("رابط الـ Custom Endpoint غير صالح.");

    if (errors.length > 0) return res.json({ success: false, errors });

    agent.status = "published";
    setAgent(req.user, agent);

    if (agent.channels.tg?.connected && agent.channels.tg?.config?.token) {
        startTelegramBot(req.user, agent.id, agent.channels.tg.config.token);
    }
    if (agent.channels.dc?.connected && agent.channels.dc?.config?.token) {
        startDiscordBot(req.user, agent.id, agent.channels.dc.config.token);
    }

    res.json({ success: true, message: "تم نشر المساعد وتفعيل البوتات بنجاح!" });
});

// ==========================================
// استئناف البوتات المنشورة تلقائيًا عند إقلاع السيرفر
// ==========================================
function resumeAllPublishedBots() {
    Object.keys(store.users).forEach(username => {
        const agents = getUserAgents(username);
        Object.values(agents).forEach(agent => {
            if (agent.status !== 'published') return;
            if (agent.channels.tg?.connected && agent.channels.tg?.config?.token) {
                startTelegramBot(username, agent.id, agent.channels.tg.config.token);
            }
            if (agent.channels.dc?.connected && agent.channels.dc?.config?.token) {
                startDiscordBot(username, agent.id, agent.channels.dc.config.token);
            }
            if (agent.channels.wa?.connected) {
                startWhatsAppBot(username, agent.id).catch(err =>
                    console.error(`تعذر استئناف واتساب [${username}:${agent.id}]:`, err.message)
                );
            }
        });
    });
}

app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
    resumeAllPublishedBots();
});
