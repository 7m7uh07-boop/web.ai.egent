// فتح نافذة واتساب وجلب الـ QR الحقيقي من السيرفر
document.getElementById('node-wa').onclick = async () => {
    openModal('modal-wa');
    const qrContainer = document.getElementById('qr-placeholder');
    qrContainer.innerHTML = 'جاري توليد رمز QR الحقيقي...';

    // طلب الـ QR من السيرفر
    const interval = setInterval(async () => {
        const res = await fetch(`/api/whatsapp/qr/${currentAgent.id}`);
        const data = await res.json();

        if (data.connected) {
            qrContainer.innerHTML = '<span style="color:green; font-weight:bold;">✅ تم الاتصال بواتساب بنجاح!</span>';
            currentAgent.channels.wa.connected = true;
            updateUIFromAgent();
            clearInterval(interval);
        } else if (data.qr) {
            qrContainer.innerHTML = `<img src="${data.qr}" style="width:100%; border-radius:8px;">`;
        }
    }, 2000);
};
