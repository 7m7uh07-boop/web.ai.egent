// حالة المساعد الحالي
let currentAgent = {
    id: "1",
    name: "new agent",
    type: "IMFA Agents Default",
    instructions: "",
    provider: "gemini",
    customEndpoint: "",
    customModelName: "",
    apiKeys: [""],
    status: "draft",
    channels: {
        wa: { connected: false, config: {} },
        tg: { connected: false, config: {} },
        dc: { connected: false, config: {} }
    }
};

let zoomLevel = 1.0;

// عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    loadAgentsList();
    setupEventListeners();
    setupZoom();
});

// تحميل قائمة المساعدين من الخادم
async function loadAgentsList() {
    try {
        const res = await fetch('/api/agents');
        const agents = await res.json();
        const dropdown = document.getElementById('agent-dropdown');
        dropdown.innerHTML = '';
        
        agents.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.name;
            dropdown.appendChild(opt);
        });

        if (agents.length > 0) {
            currentAgent = agents[0];
            updateUIFromAgent();
        }
    } catch (e) {
        console.error("فشل جلب بيانات المساعدين:", e);
    }
}

// تحديث الواجهة بناءً على المساعد الحالي
function updateUIFromAgent() {
    document.getElementById('display-agent-name').innerText = currentAgent.name;
    document.getElementById('display-agent-type').innerText = currentAgent.type;
    document.getElementById('display-provider-name').innerText = currentAgent.provider.toUpperCase();

    // تحديث تعليمات النظام
    const textLen = currentAgent.instructions ? currentAgent.instructions.length : 0;
    document.getElementById('instructions-count').innerText = `${textLen} / 5000`;
    const percent = Math.min(100, (textLen / 5000) * 100);
    document.getElementById('instructions-progress').style.width = `${percent}%`;

    // تحديث حالة الأسلاك الأساسية
    document.getElementById('wire-agent-hub').classList.add('active');
    if (textLen > 0) {
        document.getElementById('wire-instructions-hub').classList.add('active');
    } else {
        document.getElementById('wire-instructions-hub').classList.remove('active');
    }

    // تحديث القنوات
    updateChannelUI('wa', currentAgent.channels.wa);
    updateChannelUI('tg', currentAgent.channels.tg);
    updateChannelUI('dc', currentAgent.channels.dc);
}

function updateChannelUI(channelKey, channelData) {
    const node = document.getElementById(`node-${channelKey}`);
    const dot = document.getElementById(`dot-${channelKey}`);
    const text = document.getElementById(`text-${channelKey}`);
    const wire = document.getElementById(`wire-${channelKey}`);

    if (channelData && channelData.connected) {
        node.classList.add('connected');
        text.innerText = "متصل";
        text.style.color = "var(--wa)";
        wire.classList.add('active');
    } else {
        node.classList.remove('connected');
        text.innerText = "غير متصل";
        text.style.color = "var(--muted)";
        wire.classList.remove('active');
    }
}

// إعداد أحداث الأزرار والنوافذ
function setupEventListeners() {
    // 1. زر العودة والحفظ (←)
    document.getElementById('btn-back').onclick = async () => {
        await saveCurrentAgent();
        alert('تم حفظ كافة التغييرات تلقائياً!');
    };

    // 2. زر نشر (▶)
    document.getElementById('btn-publish').onclick = async () => {
        await saveCurrentAgent();
        const res = await fetch('/api/agents/publish', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ agentId: currentAgent.id })
        });
        const data = await res.json();
        
        const title = document.getElementById('publish-result-title');
        const body = document.getElementById('publish-result-body');

        if (data.success) {
            title.innerText = "🎉 تم النشر بنجاح";
            title.style.color = "var(--wa)";
            body.innerHTML = `<p>${data.message}</p>`;
            currentAgent.status = "published";
        } else {
            title.innerText = "⚠️ تعذر النشر";
            title.style.color = "#E85C5C";
            body.innerHTML = "<p>يرجى تصحيح الأخطاء التالية أولاً:</p><ul>" + 
                data.errors.map(e => `<li>${e}</li>`).join('') + "</ul>";
        }
        openModal('modal-publish-result');
    };

    // 3. زر ترقية
    document.getElementById('btn-upgrade').onclick = () => openModal('modal-upgrade');

    // 4. زر القائمة الإضافية (⋮)
    document.getElementById('btn-menu').onclick = () => openModal('modal-menu');

    // 5. عقدة التعليمات
    document.getElementById('node-instructions').onclick = () => {
        const area = document.getElementById('input-instructions');
        area.value = currentAgent.instructions || "";
        updateInstructionsCounter();
        openModal('modal-instructions');
    };

    document.getElementById('input-instructions').oninput = updateInstructionsCounter;

    document.getElementById('save-instructions').onclick = () => {
        currentAgent.instructions = document.getElementById('input-instructions').value;
        updateUIFromAgent();
        closeModals();
    };

    // 6. عقدة النموذج و API Keys
    document.getElementById('node-hub').onclick = () => {
        document.getElementById('select-provider').value = currentAgent.provider || "gemini";
        toggleCustomModelDetails();
        renderApiKeyInputs();
        openModal('modal-provider');
    };

    document.getElementById('select-provider').onchange = toggleCustomModelDetails;

    document.getElementById('add-api-key-btn').onclick = () => {
        currentAgent.apiKeys.push("");
        renderApiKeyInputs();
    };

    document.getElementById('save-provider').onclick = () => {
        currentAgent.provider = document.getElementById('select-provider').value;
        currentAgent.customEndpoint = document.getElementById('input-custom-endpoint').value;
        currentAgent.customModelName = document.getElementById('input-custom-model-name').value;
        
        // جمع كل المفاتيح
        const keyInputs = document.querySelectorAll('.api-key-input');
        currentAgent.apiKeys = Array.from(keyInputs).map(i => i.value).filter(v => v.trim() !== "");
        if (currentAgent.apiKeys.length === 0) currentAgent.apiKeys = [""];

        updateUIFromAgent();
        closeModals();
    };

    // 7. عقد القنوات
    document.getElementById('node-tg').onclick = () => openModal('modal-tg');
    document.getElementById('save-tg').onclick = () => {
        const token = document.getElementById('input-tg-token').value;
        if (token) {
            currentAgent.channels.tg = { connected: true, config: { token } };
            updateUIFromAgent();
            closeModals();
        }
    };
    document.getElementById('disconnect-tg').onclick = () => {
        currentAgent.channels.tg = { connected: false, config: {} };
        updateUIFromAgent();
        closeModals();
    };

    document.getElementById('node-dc').onclick = () => openModal('modal-dc');
    document.getElementById('save-dc').onclick = () => {
        const token = document.getElementById('input-dc-token').value;
        if (token) {
            currentAgent.channels.dc = { connected: true, config: { token } };
            updateUIFromAgent();
            closeModals();
        }
    };
    document.getElementById('disconnect-dc').onclick = () => {
        currentAgent.channels.dc = { connected: false, config: {} };
        updateUIFromAgent();
        closeModals();
    };

    document.getElementById('node-wa').onclick = () => openModal('modal-wa');
    document.getElementById('save-wa').onclick = () => {
        currentAgent.channels.wa = { connected: true, config: {} };
        updateUIFromAgent();
        closeModals();
    };
    document.getElementById('disconnect-wa').onclick = () => {
        currentAgent.channels.wa = { connected: false, config: {} };
        updateUIFromAgent();
        closeModals();
    };
}

// التحكم بالزوم (Zoom)
function setupZoom() {
    const canvas = document.getElementById('canvas-target');
    document.getElementById('zoom-in').onclick = () => {
        zoomLevel = Math.min(1.5, zoomLevel + 0.1);
        canvas.style.transform = `scale(${zoomLevel})`;
    };
    document.getElementById('zoom-out').onclick = () => {
        zoomLevel = Math.max(0.6, zoomLevel - 0.1);
        canvas.style.transform = `scale(${zoomLevel})`;
    };
    document.getElementById('zoom-reset').onclick = () => {
        zoomLevel = 1.0;
        canvas.style.transform = `scale(1.0)`;
    };
}

// وظائف مساعدة
function updateInstructionsCounter() {
    const val = document.getElementById('input-instructions').value;
    document.getElementById('modal-instructions-counter').innerText = `${val.length} / 5000`;
}

function toggleCustomModelDetails() {
    const val = document.getElementById('select-provider').value;
    const customDiv = document.getElementById('custom-model-details');
    customDiv.style.display = (val === 'custom') ? 'block' : 'none';
}

function renderApiKeyInputs() {
    const container = document.getElementById('api-keys-container');
    container.innerHTML = '';
    
    currentAgent.apiKeys.forEach((key, idx) => {
        const row = document.createElement('div');
        row.className = 'api-key-row';
        row.innerHTML = `
            <input type="text" class="api-key-input" value="${key}" placeholder="أدخل مفتاح API #${idx + 1}">
            <button type="button" class="btn btn-danger" onclick="removeApiKeyRow(${idx})">✕</button>
        `;
        container.appendChild(row);
    });
}

function removeApiKeyRow(index) {
    currentAgent.apiKeys.splice(index, 1);
    if (currentAgent.apiKeys.length === 0) currentAgent.apiKeys = [""];
    renderApiKeyInputs();
}

function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

async function saveCurrentAgent() {
    try {
        await fetch('/api/agents/save', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(currentAgent)
        });
    } catch (e) {
        console.error("خطأ أثناء الحفظ:", e);
    }
}
