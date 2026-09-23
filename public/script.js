
// التحقق من تسجيل الدخول
const currentUser = localStorage.getItem('currentUser');
if(!currentUser) {
    window.location.href = 'login.html';
} else {
    document.getElementById('user-display').innerText = 'مرحباً، ' + currentUser;
}

function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
}

function openModal(id) {
    document.getElementById(id).style.display = 'block';
    if(id === 'wa-modal') fetchWaQR();
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function checkProvider() {
    const p = document.getElementById('provider').value;
    document.getElementById('other-url-div').style.display = p === 'other' ? 'block' : 'none';
}

async function saveSettings() {
    const provider = document.getElementById('provider').value;
    const apiKey = document.getElementById('api-key').value;
    const prompt = document.getElementById('system-prompt').value;
    
    // إرسال البيانات للخادم لحفظها في users.json
    await fetch('/api/save_settings', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            username: currentUser,
            settings: { provider, apiKey, prompt }
        })
    });
    alert('تم حفظ الإعدادات بنجاح في ملف النظام!');
    closeModal('ai-modal');
    closeModal('sys-modal');
}

async function fetchWaQR() {
    const img = document.getElementById('wa-qr-img');
    img.style.opacity = '0.5';
    const res = await fetch('/api/wa-qr');
    const data = await res.json();
    if(data.success) {
        img.src = data.qr;
        img.style.opacity = '1';
    }
}
