document.addEventListener('DOMContentLoaded', () => {
    // الهيكل الأساسي للبيانات المحلية
    let currentAgent = {
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
    };

    let qrInterval = null;

    // ==========================================
    // دالّات فتح وإغلاق النوافذ المنبثقة (Modals)
    // ==========================================
    window.openModal = function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
        } else {
            console.error(`❌ النافذة [${modalId}] غير موجودة في ملف HTML`);
        }
    };

    window.closeModal = function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
        if (qrInterval) clearInterval(qrInterval);
    };

    // ==========================================
    // ربط الأزرار بالأحداث (Event Listeners)
    // ==========================================

    // 1. زر عقدة واتساب (WhatsApp Node)
    const waNode = document.getElementById('node-wa');
    if (waNode) {
        waNode.addEventListener('click', async () => {
            openModal('modal-wa');
            const qrContainer = document.getElementById('qr-placeholder');
            if (qrContainer) qrContainer.innerHTML = 'جاري الاتصال بالسيرفر وتوليد رمز QR...';

            // تنظيف أي مؤقت سابق
            if (qrInterval) clearInterval(qrInterval);

            // جلب رمز QR من السيرفر بشكل دوري
            qrInterval = setInterval(async () => {
                try {
                    const res = await fetch(`/api/whatsapp/qr/${currentAgent.id}`);
                    const data = await res.json();

                    if (data.connected) {
                        if (qrContainer) qrContainer.innerHTML = '<div style="color:green; font-weight:bold; padding:20px;">✅ تم الاتصال بواتساب بنجاح!</div>';
                        currentAgent.channels.wa.connected = true;
                        clearInterval(qrInterval);
                    } else if (data.qr) {
                        if (qrContainer) qrContainer.innerHTML = `<img src="${data.qr}" style="width:250px; height:250px; border-radius:8px;">`;
                    }
                } catch (err) {
                    console.error("خطأ في جلب الـ QR:", err);
                }
            }, 2000);
        });
    }

    // 2. زر حفظ مفتاح Gemini API
    const saveApiKeyBtn = document.getElementById('save-api-key-btn');
    if (saveApiKeyBtn) {
        saveApiKeyBtn.addEventListener('click', () => {
            const input = document.getElementById('gemini-api-key-input');
            if (input && input.value.trim() !== '') {
                currentAgent.apiKeys = [input.value.trim()];
                alert('✅ تم حفظ مفتاح Gemini API بنجاح!');
                closeModal('modal-gemini');
            } else {
                alert('⚠️ يرجى إدخال مفتاح API صحيح.');
            }
        });
    }

    // 3. زر حفظ توكن تلغرام (Telegram Token)
    const saveTgBtn = document.getElementById('save-tg-btn');
    if (saveTgBtn) {
        saveTgBtn.addEventListener('click', () => {
            const input = document.getElementById('tg-token-input');
            if (input && input.value.trim() !== '') {
                currentAgent.channels.tg.config.token = input.value.trim();
                currentAgent.channels.tg.connected = true;
                alert('✅ تم حفظ توكن تلغرام بنجاح!');
                closeModal('modal-tg');
            } else {
                alert('⚠️ يرجى إدخال توكن تلغرام صحيح.');
            }
        });
    }

    // 4. زر النشر والتفعيل (Publish)
    const publishBtn = document.getElementById('publish-btn');
    if (publishBtn) {
        publishBtn.addEventListener('click', async () => {
            try {
                // حفظ البيانات أولاً
                await fetch('/api/agents/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(currentAgent)
                });

                // طلب النشر
                const res = await fetch('/api/agents/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ agentId: currentAgent.id })
                });

                const data = await res.json();
                if (data.success) {
                    alert('🚀 ' + data.message);
                } else {
                    alert('⚠️ أخطاء في النشر:\n' + data.errors.join('\n'));
                }
            } catch (err) {
                console.error("خطأ أثناء النشر:", err);
                alert('❌ تعذر الاتصال بالسيرفر. تأكد من تشغيل السيرفر بشكل صحيح.');
            }
        });
    }

    // إغلاق النوافذ عند الضغط على زر الإغلاق (X)
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) closeModal(modal.id);
        });
    });
});
