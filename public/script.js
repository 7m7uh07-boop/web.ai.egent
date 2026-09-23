document.addEventListener('DOMContentLoaded', () => {
    // الهيكل الأساسي لبيانات المساعد
    let currentAgent = {
        id: "1",
        name: "new agent",
        type: "IMFA Agents Default",
        instructions: "أنت مساعد ذكي تقوم بالرد على الاستفسارات باختصار واحترافية.",
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
    // دالّات النوافذ المنبثقة (Modals)
    // ==========================================
    window.openModal = function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
        } else {
            console.error(`❌ النافذة [${modalId}] غير موجودة.`);
        }
    };

    window.closeModal = function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
        if (qrInterval) {
            clearInterval(qrInterval);
            qrInterval = null;
        }
    };

    // ==========================================
    // 1. ربط عقدة واتساب وتأكيد الربط
    // ==========================================
    const waNode = document.getElementById('node-wa');
    if (waNode) {
        waNode.addEventListener('click', () => {
            openModal('modal-wa');
            const qrContainer = document.getElementById('qr-placeholder');
            if (qrContainer) qrContainer.innerHTML = '<p style="color:#666;">جاري جلب رمز QR من السيرفر...</p>';

            if (qrInterval) clearInterval(qrInterval);

            // استعلام دوري لجلب الـ QR ومراقبة حالة الاتصال
            qrInterval = setInterval(async () => {
                try {
                    const res = await fetch(`/api/whatsapp/qr/${currentAgent.id}`);
                    if (!res.ok) throw new Error("فشل الاتصال بالسيرفر");
                    
                    const data = await res.json();

                    if (data.connected) {
                        if (qrContainer) {
                            qrContainer.innerHTML = '<div style="color:#10b981; font-weight:bold; padding:15px; border:1px solid #10b981; border-radius:8px; background:#ecfdf5;">✅ تم الاتصال بواتساب بنجاح!</div>';
                        }
                        currentAgent.channels.wa.connected = true;
                        clearInterval(qrInterval);
                        qrInterval = null;
                    } else if (data.qr) {
                        if (qrContainer) {
                            qrContainer.innerHTML = `<img src="${data.qr}" alt="WhatsApp QR Code" style="width:220px; height:220px; border-radius:8px; border:1px solid #ddd;">`;
                        }
                    }
                } catch (err) {
                    console.error("خطأ أثناء جلب الـ QR:", err);
                    if (qrContainer) qrContainer.innerHTML = '<p style="color:red;">⚠️ تعذر الاتصال بالسيرفر. تحقق من تشغيل السيرفر.</p>';
                }
            }, 2500);
        });
    }

    // زر تأكيد/إغلاق نافذة واتساب
    const confirmWaBtn = document.getElementById('confirm-wa-btn');
    if (confirmWaBtn) {
        confirmWaBtn.addEventListener('click', () => {
            closeModal('modal-wa');
            alert(currentAgent.channels.wa.connected ? "✅ تم تأكيد ربط واتساب!" : "⚠️ لم يتم استكمال مسح رمز الـ QR بعد.");
        });
    }

    // ==========================================
    // 2. حفظ مفتاح Gemini API
    // ==========================================
    const saveApiKeyBtn = document.getElementById('save-api-key-btn');
    if (saveApiKeyBtn) {
        saveApiKeyBtn.addEventListener('click', () => {
            const input = document.getElementById('gemini-api-key-input');
            const keyVal = input ? input.value.trim() : '';

            if (keyVal) {
                currentAgent.apiKeys = [keyVal];
                alert('✅ تم حفظ مفتاح Gemini API بنجاح!');
                closeModal('modal-gemini');
            } else {
                alert('⚠️ يرجى إدخال مفتاح API صحيح لـ Gemini.');
            }
        });
    }

    // ==========================================
    // 3. حفظ وتأكيد ربط تلغرام
    // ==========================================
    const saveTgBtn = document.getElementById('save-tg-btn');
    if (saveTgBtn) {
        saveTgBtn.addEventListener('click', () => {
            const input = document.getElementById('tg-token-input');
            const tokenVal = input ? input.value.trim() : '';

            if (tokenVal) {
                currentAgent.channels.tg.config.token = tokenVal;
                currentAgent.channels.tg.connected = true;
                alert('✅ تم حفظ توكن تلغرام وتأكيد الاتصال!');
                closeModal('modal-tg');
            } else {
                alert('⚠️ يرجى إدخال توكن تلغرام صحيح.');
            }
        });
    }

    // ==========================================
    // 4. حفظ تعليمات النظام (System Prompt)
    // ==========================================
    const instructionsInput = document.getElementById('instructions-input');
    if (instructionsInput) {
        instructionsInput.addEventListener('change', (e) => {
            currentAgent.instructions = e.target.value;
        });
    }

    // ==========================================
    // 5. زر النشر والتفعيل (Publish Button)
    // ==========================================
    const publishBtn = document.getElementById('publish-btn');
    if (publishBtn) {
        publishBtn.addEventListener('click', async () => {
            // تحديث التعليمات من حقل النص إن وجد
            if (instructionsInput && instructionsInput.value.trim()) {
                currentAgent.instructions = instructionsInput.value.trim();
            }

            // التحقق الأول المحلي لمنع إرسال طلبات ناقصة
            if (!currentAgent.apiKeys || currentAgent.apiKeys.length === 0) {
                alert('⚠️ يرجى إضافة مفتاح Gemini API أولاً قبل النشر.');
                openModal('modal-gemini');
                return;
            }

            const isWaConnected = currentAgent.channels.wa.connected;
            const isTgConnected = currentAgent.channels.tg.connected && currentAgent.channels.tg.config.token;
            
            if (!isWaConnected && !isTgConnected) {
                alert('⚠️ يجب ربط وتأكيد قناة واحدة على الأقل (WhatsApp أو Telegram) قبل النشر.');
                return;
            }

            // إظهار حالة جاري النشر
            publishBtn.disabled = true;
            publishBtn.innerText = 'جاري النشر...';

            try {
                // 1. حفظ البيانات على السيرفر
                const saveRes = await fetch('/api/agents/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(currentAgent)
                });
                if (!saveRes.ok) throw new Error("فشل حفظ إعدادات الوكيل.");

                // 2. إرسال طلب النشر وتفعيل البوتات
                const pubRes = await fetch('/api/agents/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ agentId: currentAgent.id })
                });

                const data = await pubRes.json();

                if (data.success) {
                    alert('🎉 ' + data.message);
                } else {
                    alert('❌ تعذر النشر للأساب التالية:\n• ' + (data.errors ? data.errors.join('\n• ') : 'خطأ غير معروف'));
                }
            } catch (err) {
                console.error("خطأ أثناء عملية النشر:", err);
                alert('❌ حدث خطأ أثناء الاتصال بالسيرفر. تأكد من أن تطبيق Railway يعمل بشكل صحيح.');
            } finally {
                publishBtn.disabled = false;
                publishBtn.innerText = 'نشر ▶';
            }
        });
    }

    // إغلاق النوافذ عند الضغط على زر X
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) closeModal(modal.id);
        });
    });
});
