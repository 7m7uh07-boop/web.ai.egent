document.addEventListener('DOMContentLoaded', () => {
  // ==========================================
  // الحالة العامة (كل الوكلاء + الوكيل الحالي)
  // ==========================================
  const defaultAgent = () => ({
    id: String(Date.now()),
    name: "وكيل جديد",
    type: "IMFA Agents Default",
    instructions: "أنت مساعد ذكي تقوم بالرد على الاستفسارات باختصار واحترافية.",
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
  });

  let agents = {};       // كل الوكلاء { id: agentObj }
  let currentAgent = null;
  let qrInterval = null;
  let zoomLevel = 1;

  // ==========================================
  // عناصر DOM
  // ==========================================
  const el = (id) => document.getElementById(id);

  // تنظيف رابط الـ Custom Endpoint من صيغة Markdown الملصوقة بالخطأ
  function sanitizeCustomUrl(raw) {
    if (!raw) return "";
    let url = String(raw).trim();
    const mdMatch = url.match(/\]\((https?:\/\/[^)\s]+)\)/);
    if (mdMatch) url = mdMatch[1];
    return url.replace(/[\[\]]/g, '').trim();
  }

  const dropdown = el('agent-dropdown');
  const canvasTarget = el('canvas-target');

  // ==========================================
  // النوافذ المنبثقة (Modals)
  // ==========================================
  function openModal(modalId) {
    const modal = el(modalId);
    if (modal) modal.classList.add('active');
  }
  function closeModal(modalId) {
    const modal = el(modalId);
    if (modal) modal.classList.remove('active');
  }
  function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    if (qrInterval) { clearInterval(qrInterval); qrInterval = null; }
  }
  window.closeModals = closeModals;
  window.closeModal = closeModal;
  window.openModal = openModal;

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModals();
    });
  });

  function showResult(title, message) {
    el('publish-result-title').innerText = title;
    el('publish-result-body').innerText = message;
    openModal('modal-publish-result');
  }

  // ==========================================
  // تحديث الواجهة حسب حالة الوكيل الحالي
  // ==========================================
  function refreshUI() {
    if (!currentAgent) return;

    el('display-agent-name').innerText = currentAgent.name;
    el('display-agent-type').innerText = currentAgent.type;

    const len = (currentAgent.instructions || '').length;
    const pct = Math.min(100, Math.round((len / 5000) * 100));
    el('instructions-progress').style.width = pct + '%';
    el('instructions-count').innerText = `${len} / 5000`;

    const providerNames = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Anthropic', imfa: 'IMFA Agent', custom: 'Custom' };
    el('display-provider-name').innerText = providerNames[currentAgent.provider] || currentAgent.provider;

    updateChannelUI('wa');
    updateChannelUI('tg');
    updateChannelUI('dc');

    const hasInstructions = len > 0;
    const hasKeys = currentAgent.apiKeys && currentAgent.apiKeys.length > 0;
    toggleWire('wire-agent-hub', hasInstructions);
    toggleWire('wire-instructions-hub', hasInstructions);
    toggleWire('wire-wa', currentAgent.channels.wa.connected && hasKeys);
    toggleWire('wire-tg', currentAgent.channels.tg.connected && hasKeys);
    toggleWire('wire-dc', currentAgent.channels.dc.connected && hasKeys);
  }

  function toggleWire(id, active) {
    const wire = el(id);
    if (wire) wire.classList.toggle('active', !!active);
  }

  function updateChannelUI(key) {
    const node = el('node-' + key);
    const dot = el('dot-' + key);
    const text = el('text-' + key);
    const connected = currentAgent.channels[key].connected;
    if (node) node.classList.toggle('connected', connected);
    if (dot) dot.style.background = connected ? 'var(--wa)' : '#E85C5C';
    if (text) text.innerText = connected ? 'متصل' : 'غير متصل';
  }

  function refreshDropdown() {
    if (!dropdown) return;
    dropdown.innerHTML = '';
    Object.values(agents).forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.innerText = a.name;
      if (currentAgent && a.id === currentAgent.id) opt.selected = true;
      dropdown.appendChild(opt);
    });
  }

  // ==========================================
  // تحميل الوكلاء من السيرفر
  // ==========================================
  async function loadAgents() {
    try {
      const res = await fetch('/api/agents');
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        list.forEach(a => { agents[a.id] = a; });
        currentAgent = list[0];
      } else {
        const a = defaultAgent();
        agents[a.id] = a;
        currentAgent = a;
      }
    } catch (err) {
      console.error('تعذر تحميل الوكلاء من السيرفر:', err);
      const a = defaultAgent();
      agents[a.id] = a;
      currentAgent = a;
    }
    refreshDropdown();
    refreshUI();
  }

  if (dropdown) {
    dropdown.addEventListener('change', () => {
      const chosen = agents[dropdown.value];
      if (chosen) {
        currentAgent = chosen;
        refreshUI();
      }
    });
  }

  // ==========================================
  // الشريط العلوي: ⋮ / نشر / ترقية / رجوع
  // ==========================================
  const btnMenu = el('btn-menu');
  if (btnMenu) btnMenu.addEventListener('click', () => openModal('modal-menu'));

  const btnUpgrade = el('btn-upgrade');
  if (btnUpgrade) btnUpgrade.addEventListener('click', () => openModal('modal-upgrade'));

  const btnBack = el('btn-back');
  if (btnBack) {
    btnBack.addEventListener('click', async () => {
      try {
        await fetch('/api/agents/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentAgent)
        });
      } catch (err) { console.error(err); }
      history.back();
    });
  }

  const btnPublish = el('btn-publish');
  if (btnPublish) {
    btnPublish.addEventListener('click', async () => {
      if (!currentAgent.apiKeys || currentAgent.apiKeys.length === 0) {
        showResult('⚠️ تنبيه', 'يرجى إضافة مفتاح API واحد على الأقل من نافذة "مزود الذكاء الاصطناعي" قبل النشر.');
        openModal('modal-provider');
        return;
      }
      const isWaConnected = currentAgent.channels.wa.connected;
      const isTgConnected = currentAgent.channels.tg.connected && currentAgent.channels.tg.config.token;
      const isDcConnected = currentAgent.channels.dc.connected && currentAgent.channels.dc.config.token;

      if (!isWaConnected && !isTgConnected && !isDcConnected) {
        showResult('⚠️ تنبيه', 'يجب ربط وتأكيد قناة واحدة على الأقل (WhatsApp أو Telegram أو Discord) قبل النشر.');
        return;
      }

      const originalText = btnPublish.innerHTML;
      btnPublish.disabled = true;
      btnPublish.innerText = 'جاري النشر...';

      try {
        const saveRes = await fetch('/api/agents/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentAgent)
        });
        if (!saveRes.ok) throw new Error('فشل حفظ إعدادات الوكيل.');

        const pubRes = await fetch('/api/agents/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: currentAgent.id })
        });
        const data = await pubRes.json();

        if (data.success) {
          showResult('🎉 تم النشر', data.message);
        } else {
          showResult('❌ تعذر النشر', 'الأسباب:\n• ' + (data.errors ? data.errors.join('\n• ') : 'خطأ غير معروف'));
        }
      } catch (err) {
        console.error('خطأ أثناء عملية النشر:', err);
        showResult('❌ خطأ', 'حدث خطأ أثناء الاتصال بالسيرفر. تأكد من أن السيرفر يعمل بشكل صحيح.');
      } finally {
        btnPublish.disabled = false;
        btnPublish.innerHTML = originalText;
      }
    });
  }

  // ==========================================
  // عقدة المساعد -> قائمة الخيارات
  // ==========================================
  const nodeAgent = el('node-agent');
  if (nodeAgent) nodeAgent.addEventListener('click', () => openModal('modal-menu'));

  // ==========================================
  // عقدة التعليمات (System Prompt)
  // ==========================================
  const nodeInstructions = el('node-instructions');
  const inputInstructions = el('input-instructions');
  const modalInstructionsCounter = el('modal-instructions-counter');

  if (nodeInstructions) {
    nodeInstructions.addEventListener('click', () => {
      inputInstructions.value = currentAgent.instructions || '';
      updateInstructionsCounter();
      openModal('modal-instructions');
    });
  }

  function updateInstructionsCounter() {
    const len = inputInstructions.value.length;
    modalInstructionsCounter.innerText = `${len} / 5000`;
  }

  if (inputInstructions) {
    inputInstructions.setAttribute('maxlength', '5000');
    inputInstructions.addEventListener('input', updateInstructionsCounter);
  }

  const saveInstructionsBtn = el('save-instructions');
  if (saveInstructionsBtn) {
    saveInstructionsBtn.addEventListener('click', () => {
      currentAgent.instructions = inputInstructions.value.trim();
      refreshUI();
      closeModals();
    });
  }

  // ==========================================
  // عقدة مزود الذكاء الاصطناعي ومفاتيح API
  // ==========================================
  const nodeHub = el('node-hub');
  const selectProvider = el('select-provider');
  const customDetails = el('custom-model-details');
  const imfaDetails = el('imfa-agent-details');
  const inputImfaAgentId = el('input-imfa-agent-id');
  const inputCustomEndpoint = el('input-custom-endpoint');
  const inputCustomModelName = el('input-custom-model-name');
  const apiKeysContainer = el('api-keys-container');
  const addApiKeyBtn = el('add-api-key-btn');

  function toggleProviderFields() {
    customDetails.style.display = selectProvider.value === 'custom' ? 'block' : 'none';
    imfaDetails.style.display = selectProvider.value === 'imfa' ? 'block' : 'none';
  }

  function addApiKeyRow(value = '') {
    const row = document.createElement('div');
    row.className = 'api-key-row';
    row.innerHTML = `
      <input type="text" class="api-key-input" placeholder="أدخل مفتاح API هنا...">
      <button type="button" class="btn btn-danger remove-api-key-btn" title="حذف">✕</button>
    `;
    row.querySelector('.api-key-input').value = value;
    row.querySelector('.remove-api-key-btn').addEventListener('click', () => row.remove());
    apiKeysContainer.appendChild(row);
  }

  if (addApiKeyBtn) {
    addApiKeyBtn.addEventListener('click', () => addApiKeyRow());
  }

  if (selectProvider) {
    selectProvider.addEventListener('change', toggleProviderFields);
  }

  if (nodeHub) {
    nodeHub.addEventListener('click', () => {
      selectProvider.value = currentAgent.provider || 'gemini';
      toggleProviderFields();
      inputCustomEndpoint.value = currentAgent.customEndpoint || '';
      inputCustomModelName.value = currentAgent.customModelName || '';
      inputImfaAgentId.value = currentAgent.imfaAgentId || '';

      apiKeysContainer.innerHTML = '';
      if (currentAgent.apiKeys && currentAgent.apiKeys.length > 0) {
        currentAgent.apiKeys.forEach(k => addApiKeyRow(k));
      } else {
        addApiKeyRow();
      }
      openModal('modal-provider');
    });
  }

  const saveProviderBtn = el('save-provider');
  if (saveProviderBtn) {
    saveProviderBtn.addEventListener('click', () => {
      currentAgent.provider = selectProvider.value;
      currentAgent.customEndpoint = sanitizeCustomUrl(inputCustomEndpoint.value.trim());
      currentAgent.customModelName = inputCustomModelName.value.trim();
      currentAgent.imfaAgentId = inputImfaAgentId.value.trim();

      const keys = Array.from(apiKeysContainer.querySelectorAll('.api-key-input'))
        .map(i => i.value.trim())
        .filter(Boolean);
      currentAgent.apiKeys = keys;

      refreshUI();
      closeModals();
    });
  }

  // ==========================================
  // عقدة تلغرام
  // ==========================================
  const nodeTg = el('node-tg');
  const inputTgToken = el('input-tg-token');
  if (nodeTg) {
    nodeTg.addEventListener('click', () => {
      inputTgToken.value = currentAgent.channels.tg.config.token || '';
      openModal('modal-tg');
    });
  }
  const saveTgBtn = el('save-tg');
  if (saveTgBtn) {
    saveTgBtn.addEventListener('click', () => {
      const tokenVal = inputTgToken.value.trim();
      if (!tokenVal) {
        showResult('⚠️ تنبيه', 'يرجى إدخال توكن تلغرام صحيح.');
        return;
      }
      currentAgent.channels.tg.config.token = tokenVal;
      currentAgent.channels.tg.connected = true;
      refreshUI();
      closeModals();
      showResult('✅ تم', 'تم حفظ توكن تلغرام وتأكيد الاتصال!');
    });
  }
  const disconnectTgBtn = el('disconnect-tg');
  if (disconnectTgBtn) {
    disconnectTgBtn.addEventListener('click', () => {
      currentAgent.channels.tg.connected = false;
      currentAgent.channels.tg.config = {};
      inputTgToken.value = '';
      refreshUI();
      closeModals();
    });
  }

  // ==========================================
  // عقدة ديسكورد
  // ==========================================
  const nodeDc = el('node-dc');
  const inputDcToken = el('input-dc-token');
  if (nodeDc) {
    nodeDc.addEventListener('click', () => {
      inputDcToken.value = currentAgent.channels.dc.config.token || '';
      openModal('modal-dc');
    });
  }
  const saveDcBtn = el('save-dc');
  if (saveDcBtn) {
    saveDcBtn.addEventListener('click', () => {
      const tokenVal = inputDcToken.value.trim();
      if (!tokenVal) {
        showResult('⚠️ تنبيه', 'يرجى إدخال توكن ديسكورد صحيح.');
        return;
      }
      currentAgent.channels.dc.config.token = tokenVal;
      currentAgent.channels.dc.connected = true;
      refreshUI();
      closeModals();
      showResult('✅ تم', 'تم حفظ توكن ديسكورد وتأكيد الاتصال!');
    });
  }
  const disconnectDcBtn = el('disconnect-dc');
  if (disconnectDcBtn) {
    disconnectDcBtn.addEventListener('click', () => {
      currentAgent.channels.dc.connected = false;
      currentAgent.channels.dc.config = {};
      inputDcToken.value = '';
      refreshUI();
      closeModals();
    });
  }

  // ==========================================
  // عقدة واتساب (QR حقيقي من السيرفر)
  // ==========================================
  const nodeWa = el('node-wa');
  const qrPlaceholder = el('qr-placeholder');

  if (nodeWa) {
    nodeWa.addEventListener('click', () => {
      openModal('modal-wa');
      if (currentAgent.channels.wa.connected) {
        qrPlaceholder.innerHTML = '<div style="color:#10b981; font-weight:bold; padding:15px; border:1px solid #10b981; border-radius:8px; background:#ecfdf5;">✅ متصل بالفعل بواتساب</div>';
        return;
      }
      qrPlaceholder.innerHTML = '<p style="color:#666;">جاري جلب رمز QR من السيرفر...</p>';
      if (qrInterval) clearInterval(qrInterval);

      qrInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/whatsapp/qr/${currentAgent.id}`);
          if (!res.ok) throw new Error('فشل الاتصال بالسيرفر');
          const data = await res.json();

          if (data.connected) {
            qrPlaceholder.innerHTML = '<div style="color:#10b981; font-weight:bold; padding:15px; border:1px solid #10b981; border-radius:8px; background:#ecfdf5;">✅ تم الاتصال بواتساب بنجاح!</div>';
            currentAgent.channels.wa.connected = true;
            refreshUI();
            clearInterval(qrInterval);
            qrInterval = null;
          } else if (data.qr) {
            qrPlaceholder.innerHTML = `<img src="${data.qr}" alt="WhatsApp QR Code" style="width:220px; height:220px; border-radius:8px; border:1px solid #ddd;">`;
          }
        } catch (err) {
          console.error('خطأ أثناء جلب الـ QR:', err);
          qrPlaceholder.innerHTML = '<p style="color:red;">⚠️ تعذر الاتصال بالسيرفر. تحقق من تشغيل السيرفر.</p>';
        }
      }, 2500);
    });
  }

  const saveWaBtn = el('save-wa');
  if (saveWaBtn) {
    saveWaBtn.addEventListener('click', () => {
      closeModals();
      if (currentAgent.channels.wa.connected) {
        showResult('✅ تم', 'تم تأكيد ربط واتساب!');
      } else {
        showResult('⚠️ تنبيه', 'لم يتم استكمال مسح رمز الـ QR بعد.');
      }
    });
  }

  const disconnectWaBtn = el('disconnect-wa');
  if (disconnectWaBtn) {
    disconnectWaBtn.addEventListener('click', () => {
      currentAgent.channels.wa.connected = false;
      currentAgent.channels.wa.config = {};
      refreshUI();
      closeModals();
    });
  }

  // ==========================================
  // قائمة خيارات المساعد (⋮)
  // ==========================================
  const menuRename = el('menu-rename');
  if (menuRename) {
    menuRename.addEventListener('click', () => {
      const newName = prompt('أدخل الاسم الجديد للمساعد:', currentAgent.name);
      if (newName && newName.trim()) {
        currentAgent.name = newName.trim();
        refreshUI();
        refreshDropdown();
      }
      closeModals();
    });
  }

  const menuDuplicate = el('menu-duplicate');
  if (menuDuplicate) {
    menuDuplicate.addEventListener('click', async () => {
      const copy = JSON.parse(JSON.stringify(currentAgent));
      copy.id = String(Date.now());
      copy.name = currentAgent.name + ' (نسخة)';
      copy.status = 'draft';
      agents[copy.id] = copy;
      currentAgent = copy;
      refreshDropdown();
      refreshUI();
      try {
        await fetch('/api/agents/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentAgent)
        });
      } catch (err) { console.error(err); }
      closeModals();
    });
  }

  const menuExport = el('menu-export');
  if (menuExport) {
    menuExport.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(currentAgent, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agent-${currentAgent.name}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      closeModals();
    });
  }

  const menuDelete = el('menu-delete');
  if (menuDelete) {
    menuDelete.addEventListener('click', async () => {
      const ids = Object.keys(agents);
      if (ids.length <= 1) {
        showResult('⚠️ تنبيه', 'لا يمكن حذف الوكيل الوحيد المتبقي.');
        return;
      }
      if (!confirm(`هل أنت متأكد من حذف المساعد "${currentAgent.name}"؟`)) return;
      const deletedId = currentAgent.id;
      try {
        await fetch(`/api/agents/${deletedId}`, { method: 'DELETE' });
      } catch (err) {
        console.error('تعذر حذف المساعد من السيرفر:', err);
      }
      delete agents[deletedId];
      currentAgent = Object.values(agents)[0];
      refreshDropdown();
      refreshUI();
      closeModals();
    });
  }

  // ==========================================
  // التكبير / التصغير
  // ==========================================
  function applyZoom() {
    if (canvasTarget) canvasTarget.style.transform = `scale(${zoomLevel})`;
  }
  const zoomInBtn = el('zoom-in');
  const zoomOutBtn = el('zoom-out');
  const zoomResetBtn = el('zoom-reset');
  if (zoomInBtn) zoomInBtn.addEventListener('click', () => { zoomLevel = Math.min(1.6, zoomLevel + 0.1); applyZoom(); });
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => { zoomLevel = Math.max(0.5, zoomLevel - 0.1); applyZoom(); });
  if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => { zoomLevel = 1; applyZoom(); });

  // ==========================================
  // البدء - تحقق من تسجيل الدخول أولاً
  // ==========================================
  async function checkAuthAndStart() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        window.location.href = 'login.html';
        return;
      }
      const data = await res.json();
      renderUserBadge(data.username);
      loadAgents();
    } catch (err) {
      console.error('تعذر التحقق من تسجيل الدخول:', err);
      window.location.href = 'login.html';
    }
  }

  function renderUserBadge(username) {
    const agentSelect = document.querySelector('.agent-select');
    if (!agentSelect) return;
    const badge = document.createElement('div');
    badge.className = 'user-badge';
    badge.innerHTML = `<span class="dot"></span><span>${username}</span>`;
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'logout-btn';
    logoutBtn.type = 'button';
    logoutBtn.innerText = 'خروج';
    logoutBtn.addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (err) {}
      window.location.href = 'login.html';
    });
    agentSelect.parentElement.insertBefore(badge, agentSelect);
    agentSelect.parentElement.appendChild(logoutBtn);
  }

  checkAuthAndStart();
});
