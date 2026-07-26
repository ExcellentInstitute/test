const GOOGLE_APP_URL = "https://script.google.com/macros/s/AKfycbxFsBuyiWOdTMMGeOgTXhvSmAfUK_uMbdwVO945ejPvnsEOQtX9ZtMCh9RQtBWzHSVj/exec";

// Initialize Firebase Storage for the Document Vault
const firebaseConfig = {
    storageBucket: "excellent-institute-vault.firebasestorage.app"
};
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

let appData = { students: [], transactions: [], stats: { income: 0, expense: 0, balance: 0 }, files: [] };
let sessionPassword = ""; 
let cropper = null;
let currentCropTarget = null;
let croppedImages = { reg: null, edit: null };
let assumptionsData = [];
let assumptionMode = false;
let analyticsChart = null;
let pendingQRCodeBase64 = null;
let isBalanceHidden = true; // Toggle state for Dashboard Privacy (Hidden by default)

window.onload = function() {
    setDefaultDates();
};

function shareTransactionWA(txId) {
    const tx = appData.transactions.find(t => t.id === txId);
    if(!tx) return;
    const isInc = tx.type === 'income';
    let msg = `${isInc ? '🟢' : '🔴'} *TRANSACTION RECORD*%0A*Date:* ${tx.date}%0A*Title:* ${tx.title.replace(/ \[STU.*\]/, '')}%0A*Amount:* ${isInc ? '+' : '-'}₹${tx.amount}`;
    if(tx.description && tx.description !== "N/A" && tx.description !== "-") msg += `%0A*Details:* ${tx.description}`;
    
    const link = document.createElement('a');
    link.href = `https://api.whatsapp.com/send?text=${msg}`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function shareStudentWA() {
    const stId = document.getElementById('tuition-student-id').value;
    const student = appData.students.find(s => s.id === stId);
    if(!student) return;
    const actualPaid = getDynamicPaidFee(student);
    const adDiscount = parseFloat(student.adWallet) || 0;
    const dues = student.totalFee - actualPaid - adDiscount;
    const msg = `🎓 *STUDENT UPDATE*%0A*Name:* ${student.name}%0A*Course:* ${student.course}%0A*Duration:* ${student.duration || '?'} Months%0A*Total Fee:* ₹${student.totalFee}%0A*Total Paid:* ₹${actualPaid}%0A*Ad Discount:* ₹${adDiscount.toFixed(2)}%0A*Due:* ₹${dues.toFixed(2)}%0A*Status:* ${dues <= 0 ? 'Cleared ✅' : 'Pending ⚠️'}`;
    
    const link = document.createElement('a');
    link.href = `https://api.whatsapp.com/send?text=${msg}`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    ['reg-date', 'tuition-date', 'job-date', 'print-date', 'exp-date'].forEach(id => {
        if(document.getElementById(id)) document.getElementById(id).value = today;
    });
    if(document.getElementById('assumed-date')) {
        document.getElementById('assumed-date').value = today.substring(0,7);
    }
}

function checkDuesNotifications() {
    const today = new Date();
    let dueStudents = [];
    
    appData.students.forEach(st => {
        const actualPaid = getDynamicPaidFee(st);
        const adDiscount = parseFloat(st.adWallet) || 0;
        const overallDues = st.totalFee - actualPaid - adDiscount;
        
        if (overallDues > 0 && st.date && (st.status || 'Active') === 'Active') {
            const admissionDate = new Date(st.date);
            
            let monthsPassed = (today.getFullYear() - admissionDate.getFullYear()) * 12 + (today.getMonth() - admissionDate.getMonth());
            if (monthsPassed < 0) monthsPassed = 0;
            
            let expectedAmount = (monthsPassed + 1) * 500;
            
            if (expectedAmount > st.totalFee) {
                expectedAmount = st.totalFee;
            }
            
            const currentMonthDue = expectedAmount - actualPaid - adDiscount;
            
            if (currentMonthDue > 0) {
                dueStudents.push({ 
                    ...st, 
                    currentDue: currentMonthDue 
                });
            }
        }
    });

    const badge = document.getElementById('notif-badge');
    const countText = document.getElementById('notif-count-text');
    const list = document.getElementById('notif-list');

    if (dueStudents.length > 0) {
        badge.innerText = dueStudents.length;
        badge.classList.remove('hidden');
        countText.innerText = `${dueStudents.length} Pending`;
        
        list.innerHTML = '';
        dueStudents.forEach(st => {
            list.innerHTML += `
                <div class="p-3 border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer rounded-xl" onclick="closeNotificationsIfOpen(); switchTab('tuition'); setTimeout(()=>selectStudent('${st.id}'), 100);">
                    <p class="text-sm font-bold text-slate-800">${st.name}</p>
                    <p class="text-xs text-rose-500 font-bold mt-1">₹${st.currentDue.toFixed(2)} Due for Current Month</p>
                </div>
            `;
        });
    } else {
        badge.classList.add('hidden');
        countText.innerText = `0 Pending`;
        list.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm font-bold"><i class="fa-solid fa-check-circle text-3xl mb-2 text-emerald-400 block"></i>All clear! No pending dues this month.</div>`;
    }
}

function toggleNotifications() {
    const drop = document.getElementById('notif-dropdown');
    if (drop.classList.contains('hidden')) {
        checkDuesNotifications(); 
        drop.classList.remove('hidden');
        setTimeout(() => { drop.classList.remove('scale-95', 'opacity-0'); }, 10);
    } else {
        drop.classList.add('scale-95', 'opacity-0');
        setTimeout(() => { drop.classList.add('hidden'); }, 200);
    }
}

function closeNotificationsIfOpen(e) {
    if(e && e.target.closest && e.target.closest('.fa-bell')) return; 
    const drop = document.getElementById('notif-dropdown');
    if (!drop.classList.contains('hidden')) {
        drop.classList.add('scale-95', 'opacity-0');
        setTimeout(() => { drop.classList.add('hidden'); }, 200);
    }
}

function togglePasswordVisibility() {
    const passInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eye-icon');
    if (passInput.type === 'password') {
        passInput.type = 'text';
        eyeIcon.classList.remove('fa-eye');
        eyeIcon.classList.add('fa-eye-slash');
    } else {
        passInput.type = 'password';
        eyeIcon.classList.remove('fa-eye-slash');
        eyeIcon.classList.add('fa-eye');
    }
}

function openCropModal(event, target) {
    const file = event.target.files[0];
    if (!file) return;
    currentCropTarget = target;
    const reader = new FileReader();
    reader.onload = function(e) {
        const image = document.getElementById('image-to-crop');
        image.src = e.target.result;
        image.classList.remove('hidden');
        
        const modal = document.getElementById('crop-modal');
        const content = document.getElementById('crop-modal-content');
        modal.classList.remove('hidden');
        setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); }, 10);

        if (cropper) cropper.destroy();
        cropper = new Cropper(image, { aspectRatio: 1, viewMode: 1, autoCropArea: 1 });
    };
    reader.readAsDataURL(file);
}

function closeCropModal() {
    const modal = document.getElementById('crop-modal');
    const content = document.getElementById('crop-modal-content');
    modal.classList.add('opacity-0'); content.classList.add('scale-95');
    setTimeout(() => { 
        modal.classList.add('hidden'); 
        if(cropper) { cropper.destroy(); cropper = null; }
        document.getElementById('image-to-crop').src = '';
        if(!croppedImages[currentCropTarget]) {
            document.getElementById(currentCropTarget === 'reg' ? 'reg-image' : 'edit-image').value = '';
        }
    }, 300);
}

function confirmCrop() {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({ width: 400, height: 400 });
    croppedImages[currentCropTarget] = canvas.toDataURL('image/jpeg', 0.8);
    closeCropModal();
}

async function handleLogin(e) {
    e.preventDefault();
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value.trim(); 
    const errorMsg = document.getElementById('login-error');
    const btnText = document.getElementById('login-btn-text');

    if (user !== 'excellent') { 
        errorMsg.innerHTML = '<i class="fa-solid fa-circle-exclamation mr-2"></i>Access Denied! Incorrect Username.';
        showError(errorMsg); 
        return; 
    }

    errorMsg.classList.add('hidden');
    btnText.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Authenticating...';
    
    try {
        const response = await fetch(GOOGLE_APP_URL + "?pass=" + encodeURIComponent(pass));
        const data = await response.json();
        
        if(data.error) {
            errorMsg.innerHTML = '<i class="fa-solid fa-circle-exclamation mr-2"></i>Access Denied! Incorrect Password.';
            throw new Error("Invalid Password");
        }

        sessionPassword = pass;
        appData = data;
        
        appData.transactions.forEach(tx => {
            if(!tx.id) tx.id = 'TXN' + Math.floor(Math.random() * 90000 + 10000);
        });
        appData.students.forEach(st => {
            if(!st.id) st.id = 'STU' + Math.floor(Math.random() * 90000 + 10000);
            if(!st.status) st.status = 'Active'; // Guarantee status property
        });

        localStorage.setItem('excellentERP_Database', JSON.stringify(appData));
        
        setDefaultDates();
        refreshAllUI();
        
        document.getElementById('login-screen').style.opacity = '0';
        setTimeout(() => {
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('app-screen').classList.remove('hidden');
            document.getElementById('app-screen').classList.add('flex');
            document.getElementById('password').value = '';
            btnText.innerHTML = 'Secure Access <i class="fa-solid fa-arrow-right-to-bracket ml-3"></i>';
            document.getElementById('login-screen').style.opacity = '1';
        }, 500);

    } catch(err) {
        if(err.message !== "Invalid Password") {
            errorMsg.innerHTML = '<i class="fa-solid fa-wifi mr-2"></i>Connection Error! Please update Google Apps Script.';
        }
        showError(errorMsg);
        btnText.innerHTML = 'Secure Access <i class="fa-solid fa-arrow-right-to-bracket ml-3"></i>';
    }
}

function showError(el) {
    el.classList.remove('hidden');
    document.getElementById('login-screen').animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(10px)' }, { transform: 'translateX(0px)' }], { duration: 300 });
}

function logout() { location.reload(); }

function recalculateStats() {
    appData.stats.income = 0;
    appData.stats.expense = 0;
    appData.transactions.forEach(tx => {
        if(tx.type === 'income') appData.stats.income += parseFloat(tx.amount);
        if(tx.type === 'expense') appData.stats.expense += parseFloat(tx.amount);
    });
    appData.stats.balance = appData.stats.income - appData.stats.expense;
}

function saveDatabase() {
    localStorage.setItem('excellentERP_Database', JSON.stringify(appData));
    const payload = { action: 'legacy_save', password: sessionPassword, data: appData }; 
    fetch(GOOGLE_APP_URL, { 
        method: 'POST', 
        body: JSON.stringify(payload), 
        headers: { "Content-Type": "text/plain;charset=utf-8" }
    })
    .then(res => res.json())
    .then(result => {
        if(result.error) {
            console.error("Database Save Failed:", result.error);
            alert("Database Sync Error: " + result.error + "\n\n(Your data is saved locally, but cloud sync was rejected by the database script).");
        }
    })
    .catch(error => console.log("Cloud sync connection failed.", error));
}

// DASHBOARD PRIVACY TOGGLE FUNCTION
function toggleBalanceVisibility() {
    isBalanceHidden = !isBalanceHidden;
    const btn = document.getElementById('toggle-balance-btn');
    if (isBalanceHidden) {
        btn.innerHTML = '<i class="fa-solid fa-eye mr-2"></i> Show Values';
        btn.classList.remove('bg-indigo-100', 'text-indigo-700', 'border-indigo-300');
        btn.classList.add('bg-slate-100', 'text-slate-700', 'border-slate-200');
    } else {
        btn.innerHTML = '<i class="fa-solid fa-eye-slash mr-2"></i> Hide Values';
        btn.classList.remove('bg-slate-100', 'text-slate-700', 'border-slate-200');
        btn.classList.add('bg-indigo-100', 'text-indigo-700', 'border-indigo-300');
    }
    updateDashboard();
}

function updateDashboard() {
    // Respects the privacy toggle state
    const format = (num) => isBalanceHidden ? '₹ ••••••' : `₹${num.toLocaleString('en-IN')}`;
    
    document.getElementById('dash-income').innerText = format(appData.stats.income);
    document.getElementById('dash-expense').innerText = format(appData.stats.expense);
    document.getElementById('dash-balance').innerText = format(appData.stats.balance);
    document.getElementById('header-balance').innerText = format(appData.stats.balance);
}

function refreshAllUI() {
    updateDashboard(); renderStudentList(); renderLedger(); renderExpenseList(); renderJobList(); renderPrintList();
    renderAnalytics(); checkDuesNotifications(); populateSettings();
    const activeId = document.getElementById('tuition-student-id').value;
    if(activeId && !document.getElementById('tuition-active').classList.contains('hidden')) {
        selectStudent(activeId);
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('-translate-x-full');
    const overlay = document.getElementById('sidebar-overlay');
    if (overlay.classList.contains('hidden')) { overlay.classList.remove('hidden'); setTimeout(() => overlay.classList.remove('opacity-0'), 10); } 
    else { overlay.classList.add('opacity-0'); setTimeout(() => overlay.classList.add('hidden'), 300); }
}

function exportDatabaseBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.download = `Excellent_Institute_Backup_${new Date().toISOString().split('T')[0]}.json`;
    link.href = url; link.click();
}

function importDatabaseBackup(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if (importedData.students && importedData.transactions && importedData.stats) {
                appData = importedData; saveDatabase(); alert("Database Restored Successfully!"); refreshAllUI();
            } else alert("Error: Invalid backup format.");
        } catch (error) { alert("Error reading backup."); }
    };
    reader.readAsText(file);
}

function switchTab(tabId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${tabId}`).classList.add('active');
    document.getElementById(`nav-${tabId}`).classList.add('active');
    const titles = { 'dashboard': 'System Dashboard', 'registration': 'New Admission', 'tuition': 'Student Database', 'job': 'Job Applications', 'print': 'Print & Copy Desk', 'expenditure': 'Expenditures', 'analytics': 'Profit & Loss Analytics', 'settings': 'System Settings' };
    document.getElementById('page-title').innerText = titles[tabId];
    if(window.innerWidth < 768) {
        const sidebar = document.getElementById('sidebar');
        if(!sidebar.classList.contains('-translate-x-full')) toggleSidebar();
    }
    if(tabId === 'analytics') renderAnalytics();
}

function populateSettings() {
    if (!appData.settings) return;
    document.getElementById('set-upi').value = appData.settings.upiId || '';
    document.getElementById('set-reward-amt').value = appData.settings.rewardPerClick || 0.25;
    document.getElementById('set-allow-rewards').value = appData.settings.allowVideoRewards ? "true" : "false";
    
    const qrPreview = document.getElementById('set-qr-preview');
    const qrIcon = document.getElementById('set-qr-icon');
    if (appData.settings.qrCodeUrl && appData.settings.qrCodeUrl !== "") {
        qrPreview.src = appData.settings.qrCodeUrl;
        qrPreview.classList.remove('hidden');
        qrIcon.classList.add('hidden');
    } else {
        qrPreview.src = '';
        qrPreview.classList.add('hidden');
        qrIcon.classList.remove('hidden');
    }
}

function previewQRCode(event) {
    const file = event.target.files[0];
    if (!file) return;
    compressImage(file, function(base64Image) {
        pendingQRCodeBase64 = base64Image;
        const qrPreview = document.getElementById('set-qr-preview');
        const qrIcon = document.getElementById('set-qr-icon');
        qrPreview.src = base64Image;
        qrPreview.classList.remove('hidden');
        qrIcon.classList.add('hidden');
    });
}

function submitSettings(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-settings');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';
    
    const upiId = document.getElementById('set-upi').value.trim();
    const rewardAmt = document.getElementById('set-reward-amt').value;
    const allowRewards = document.getElementById('set-allow-rewards').value === 'true';
    
    if (!appData.settings) appData.settings = {};
    
    appData.settings.upiId = upiId;
    appData.settings.rewardPerClick = parseFloat(rewardAmt);
    appData.settings.allowVideoRewards = allowRewards;
    
    if (pendingQRCodeBase64) {
        appData.settings.qrCodeUrl = pendingQRCodeBase64;
        pendingQRCodeBase64 = null;
    }
    
    saveDatabase();
    
    setTimeout(() => {
        btn.innerHTML = 'Save Configuration';
        alert("Settings queued for synchronization! Apps Script will save this directly into your JSON payload.");
    }, 1000);
}

function compressImage(file, callback) {
    if(!file) return callback(null);
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const MAX_SIZE = 200; let width = img.width, height = img.height;
            if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } } 
            else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
            canvas.width = width; canvas.height = height; ctx.drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', 0.8));
        }
        img.src = e.target.result;
    }
    reader.readAsDataURL(file);
}

function generateExcelBill(transactionDetails, billTitle) {
    return;
}

function generateComprehensivePrint() {
    let printDiv = document.getElementById('comprehensive-print-view');
    let now = new Date().toLocaleString('en-IN');
    let html = `
        <div style="text-align: center; margin-bottom: 20px; font-family: sans-serif;">
            <h1 style="font-size: 28px; font-weight: bold; margin: 0; color: #1e293b;">EXCELLENT INSTITUTE</h1>
            <p style="margin: 0; font-size: 14px; color: #475569;">TEACHERS COLONY, SURADA, DIST - GANJAM, ODISHA - 761108</p>
            <h2 style="font-size: 20px; margin-top: 15px; border-bottom: 2px solid #1e293b; display: inline-block; padding-bottom: 5px;">Comprehensive Financial Statement</h2>
            <p style="font-size: 12px; text-align: right; margin-top: 10px; font-weight: bold;">Generated on: ${now}</p>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 30px; border: 2px solid #e2e8f0; padding: 15px; background: #f8fafc; border-radius: 10px; font-family: sans-serif;">
            <div><strong style="color: #64748b; text-transform: uppercase; font-size: 12px;">Total Revenue</strong><br><span style="font-size: 24px; font-weight: bold; color: #059669;">₹${appData.stats.income.toLocaleString('en-IN')}</span></div>
            <div><strong style="color: #64748b; text-transform: uppercase; font-size: 12px;">Total Expenditure</strong><br><span style="font-size: 24px; font-weight: bold; color: #e11d48;">₹${appData.stats.expense.toLocaleString('en-IN')}</span></div>
            <div><strong style="color: #64748b; text-transform: uppercase; font-size: 12px;">Net Balance</strong><br><span style="font-size: 24px; font-weight: bold; color: #4f46e5;">₹${appData.stats.balance.toLocaleString('en-IN')}</span></div>
        </div>
        <h3 style="font-size: 18px; margin-bottom: 10px; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; font-family: sans-serif;">Complete Transaction Ledger</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; font-family: sans-serif;">
            <thead><tr style="border-bottom: 2px solid #1e293b;"><th style="padding: 8px 5px;">Date</th><th style="padding: 8px 5px;">Description / Title</th><th style="padding: 8px 5px;">Type</th><th style="padding: 8px 5px; text-align: right;">Amount</th></tr></thead>
            <tbody>
    `;
    appData.transactions.forEach(tx => {
        if (parseFloat(tx.amount) === 0) return;
        let isInc = tx.type === 'income'; let sign = isInc ? '+' : '-';
        html += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 5px; color: #475569;">${tx.date}</td>
                <td style="padding: 8px 5px;"><strong>${tx.title.replace(/ \[STU.*\]/, '')}</strong> <br><small style="color:#64748b">${tx.description || ''}</small></td>
                <td style="padding: 8px 5px; font-weight: bold; color: ${isInc ? '#059669' : '#e11d48'}">${isInc ? 'INCOME' : 'EXPENSE'}</td>
                <td style="padding: 8px 5px; text-align: right; font-weight: bold;">${sign}₹${tx.amount.toLocaleString('en-IN')}</td>
            </tr>
        `;
    });
    html += `</tbody></table><div style="margin-top: 40px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px dashed #e2e8f0; padding-top: 10px; font-family: sans-serif;">-- End of Official Statement --</div>`;
    document.getElementById('comprehensive-print-view').innerHTML = html;
    window.print();
}

function toggleAssumptionMode() {
    assumptionMode = !assumptionMode;
    const panel = document.getElementById('assumption-panel');
    const btn = document.getElementById('btn-assumption');
    if(assumptionMode) {
        panel.classList.remove('hidden');
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles mr-2 text-indigo-500"></i> Assumption Mode: ON';
        btn.classList.add('bg-indigo-100', 'text-indigo-700', 'border-indigo-300');
    } else {
        panel.classList.add('hidden');
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles mr-2"></i> Assumption Mode: OFF';
        btn.classList.remove('bg-indigo-100', 'text-indigo-700', 'border-indigo-300');
    }
    renderAnalytics();
}

function toggleAssumedCategory() {
    const type = document.getElementById('assumed-type').value;
    const catSelect = document.getElementById('assumed-category');
    if (type === 'income') {
        catSelect.innerHTML = '<option value="Course Tuition Fee">Course Tuition Fee</option><option value="Admission Fee">Admission Fee</option><option value="Print Desk">Print Desk</option><option value="Job Desk">Job Desk</option><option value="Custom">➕ Add Custom Category...</option>';
    } else {
        catSelect.innerHTML = '<option value="Electricity Bill">Electricity Bill</option><option value="Office Rent">Office Rent</option><option value="Staff Salary">Staff Salary</option><option value="Maintenance & Repair">Maintenance & Repair</option><option value="Paper & Ink Supplies">Paper & Ink Supplies</option><option value="Institute Promotion">Institute Promotion</option><option value="Water Can">Water Can</option><option value="Miscellaneous">Miscellaneous</option><option value="Custom">➕ Add Custom Category...</option>';
    }
    toggleCustomAssumedCategory();
}

function toggleCustomAssumedCategory() {
    const val = document.getElementById('assumed-category').value;
    const customInput = document.getElementById('assumed-custom-category');
    if (val === 'Custom') customInput.classList.remove('hidden');
    else customInput.classList.add('hidden');
}

function addAssumption() {
    const type = document.getElementById('assumed-type').value;
    let cat = document.getElementById('assumed-category').value;
    if (cat === 'Custom') {
        cat = document.getElementById('assumed-custom-category').value || 'Custom Record';
    }
    const amt = parseFloat(document.getElementById('assumed-amount').value);
    const dateStr = document.getElementById('assumed-date').value; 
    if(!amt || !dateStr) return alert('Please enter both amount and a Month/Year.');
    
    assumptionsData.push({
        id: 'ASSUM_' + Date.now(), type: type, amount: amt,
        date: dateStr + '-01', title: `[Assumed] ${cat}`
    });
    
    document.getElementById('assumed-amount').value = '';
    document.getElementById('assumed-custom-category').value = '';
    renderAssumedList();
    renderAnalytics();
}

function renderAssumedList() {
    const container = document.getElementById('assumed-list-container');
    const list = document.getElementById('assumed-list');
    list.innerHTML = '';
    if(assumptionsData.length > 0) {
        container.classList.remove('hidden');
        assumptionsData.forEach(a => {
            const sign = a.type === 'income' ? '+' : '-';
            const color = a.type === 'income' ? 'text-emerald-600' : 'text-rose-600';
            list.innerHTML += `<li class="flex justify-between items-center bg-white p-3 rounded-xl border border-indigo-100 shadow-sm"><span class="font-bold text-slate-700">${a.date.substring(0,7)} <span class="text-[10px] text-slate-400 ml-1 truncate">(${a.title})</span></span> <span class="font-black ${color}">${sign}₹${a.amount}</span></li>`;
        });
    } else {
        container.classList.add('hidden');
    }
}

function clearAssumptions() {
    assumptionsData = [];
    renderAssumedList();
    renderAnalytics();
}

function renderAnalytics() {
    const periodType = document.getElementById('analytics-period').value;
    const chartType = document.getElementById('analytics-chart-type').value;

    const grouped = {};
    
    appData.transactions.forEach(tx => {
        if(parseFloat(tx.amount) === 0) return;
        const dateParts = tx.date.split('-');
        if(dateParts.length < 2) return;
        const year = dateParts[0]; const month = dateParts[1];
        let key = ''; let sortVal = 0;
        
        if (periodType === 'month') {
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            key = `${monthNames[parseInt(month)-1]} ${year}`; sortVal = parseInt(year) * 100 + parseInt(month);
        } else {
            key = `${year}`; sortVal = parseInt(year);
        }

        if(!grouped[key]) grouped[key] = { actualInc: 0, actualExp: 0, assumInc: 0, assumExp: 0, label: key, sortVal: sortVal };
        if(tx.type === 'income') grouped[key].actualInc += parseFloat(tx.amount);
        else if(tx.type === 'expense') grouped[key].actualExp += parseFloat(tx.amount);
    });

    if(assumptionMode && assumptionsData.length > 0) {
        assumptionsData.forEach(tx => {
            if(parseFloat(tx.amount) === 0) return;
            const dateParts = tx.date.split('-');
            const year = dateParts[0]; const month = dateParts[1];
            let key = ''; let sortVal = 0;
            
            if (periodType === 'month') {
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                key = `${monthNames[parseInt(month)-1]} ${year}`; sortVal = parseInt(year) * 100 + parseInt(month);
            } else {
                key = `${year}`; sortVal = parseInt(year);
            }

            if(!grouped[key]) grouped[key] = { actualInc: 0, actualExp: 0, assumInc: 0, assumExp: 0, label: key, sortVal: sortVal };
            if(tx.type === 'income') grouped[key].assumInc += parseFloat(tx.amount);
            else if(tx.type === 'expense') grouped[key].assumExp += parseFloat(tx.amount);
        });
    }

    const sortedKeys = Object.keys(grouped).sort((a,b) => grouped[a].sortVal - grouped[b].sortVal);
    
    const actualIncomes = sortedKeys.map(k => grouped[k].actualInc);
    const assumIncomes = sortedKeys.map(k => grouped[k].assumInc);
    const actualExpenses = sortedKeys.map(k => grouped[k].actualExp);
    const assumExpenses = sortedKeys.map(k => grouped[k].assumExp);
    const profits = sortedKeys.map(k => (grouped[k].actualInc + grouped[k].assumInc) - (grouped[k].actualExp + grouped[k].assumExp));

    renderAnalyticsTable(sortedKeys, grouped);

    const ctx = document.getElementById('analyticsChartCanvas').getContext('2d');
    if(analyticsChart) analyticsChart.destroy();

    if(chartType === 'pie') {
        let totalInc = 0, totalExp = 0;
        sortedKeys.forEach(k => { totalInc += grouped[k].actualInc + grouped[k].assumInc; totalExp += grouped[k].actualExp + grouped[k].assumExp; });
        
        analyticsChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Total Income', 'Total Expenses'],
                datasets: [{
                    data: [totalInc, totalExp],
                    backgroundColor: ['rgba(16, 185, 129, 0.8)', 'rgba(244, 63, 94, 0.8)'],
                    borderColor: ['#10b981', '#f43f5e'],
                    borderWidth: 2, hoverOffset: 10
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: {font: {family: 'Plus Jakarta Sans', weight: 'bold'}} } }, cutout: '60%' }
        });
    } else if (chartType === 'net-bar') {
        const colors = profits.map(p => p >= 0 ? 'rgba(16, 185, 129, 0.8)' : 'rgba(244, 63, 94, 0.8)');
        const borders = profits.map(p => p >= 0 ? '#10b981' : '#f43f5e');
        
        const negActualExp = actualExpenses.map(v => -v);
        const negAssumExp = assumExpenses.map(v => -v);

        analyticsChart = new Chart(ctx, {
            type: 'bar',
            data: { 
                labels: sortedKeys, 
                datasets: [
                    { label: 'Actual Income', data: actualIncomes, backgroundColor: 'rgba(16, 185, 129, 0.8)', stack: 'Stack 0' },
                    { label: 'Assumed Income', data: assumIncomes, backgroundColor: 'rgba(16, 185, 129, 0.3)', stack: 'Stack 0' },
                    { label: 'Actual Expense', data: negActualExp, backgroundColor: 'rgba(244, 63, 94, 0.8)', stack: 'Stack 0' },
                    { label: 'Assumed Expense', data: negAssumExp, backgroundColor: 'rgba(244, 63, 94, 0.3)', stack: 'Stack 0' },
                    { label: 'Net Profit', data: profits, borderColor: '#6366f1', backgroundColor: '#6366f1', type: 'line', fill: false, tension: 0.3, borderWidth: 3 }
                ] 
            },
            options: { 
                responsive: true, maintainAspectRatio: false, 
                plugins: { tooltip: { callbacks: { label: function(context) { return context.dataset.label + ': ₹' + Math.abs(context.raw).toLocaleString('en-IN'); } } } }, 
                scales: { y: { grid: { color: 'rgba(226, 232, 240, 0.6)' }, ticks: { callback: function(value) { return '₹' + value; } } }, x: { grid: { display: false } } } 
            }
        });
    } else if (chartType === 'line') {
        const totalIncomes = sortedKeys.map((k, i) => actualIncomes[i] + assumIncomes[i]);
        const totalExpenses = sortedKeys.map((k, i) => actualExpenses[i] + assumExpenses[i]);
        
        analyticsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sortedKeys,
                datasets: [
                    { label: 'Total Income', data: totalIncomes, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.4, borderWidth: 3 },
                    { label: 'Total Expense', data: totalExpenses, borderColor: '#f43f5e', backgroundColor: 'rgba(244, 63, 94, 0.1)', fill: true, tension: 0.4, borderWidth: 3 },
                    { label: 'Net Profit', data: profits, borderColor: '#6366f1', backgroundColor: 'transparent', fill: false, tension: 0.4, borderWidth: 3, borderDash: [5, 5] }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { padding: 12, titleFont: { size: 14 }, bodyFont: { size: 13 } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(226, 232, 240, 0.6)' } }, x: { grid: { display: false } } } }
        });
    } else {
        analyticsChart = new Chart(ctx, {
            type: chartType,
            data: {
                labels: sortedKeys,
                datasets: [
                    { label: 'Actual Income', data: actualIncomes, backgroundColor: 'rgba(16, 185, 129, 0.8)', borderColor: '#10b981', borderWidth: 2, stack: 'Inc', borderRadius: 4 },
                    { label: 'Assumed Income', data: assumIncomes, backgroundColor: 'rgba(16, 185, 129, 0.3)', borderColor: '#10b981', borderWidth: 2, borderDash: [5, 5], stack: 'Inc', borderRadius: 4 },
                    { label: 'Actual Expense', data: actualExpenses, backgroundColor: 'rgba(244, 63, 94, 0.8)', borderColor: '#f43f5e', borderWidth: 2, stack: 'Exp', borderRadius: 4 },
                    { label: 'Assumed Expense', data: assumExpenses, backgroundColor: 'rgba(244, 63, 94, 0.3)', borderColor: '#f43f5e', borderWidth: 2, borderDash: [5, 5], stack: 'Exp', borderRadius: 4 },
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { padding: 12, titleFont: { size: 14 }, bodyFont: { size: 13 } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(226, 232, 240, 0.6)' } }, x: { grid: { display: false } } } }
        });
    }
}

function renderAnalyticsTable(keys, grouped) {
    const tbody = document.getElementById('analytics-table-body');
    tbody.innerHTML = '';
    if(keys.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-slate-400 font-bold">No financial data available for analysis.</td></tr>';
        return;
    }
    [...keys].reverse().forEach(k => {
        const data = grouped[k];
        const actualNet = data.actualInc - data.actualExp;
        const assumNet = data.assumInc - data.assumExp;
        const finalNet = actualNet + assumNet;

        const finalClass = finalNet >= 0 ? 'text-emerald-600' : 'text-rose-600';
        const finalSign = finalNet >= 0 ? '+' : '';

        let assumHtml = `<span class="text-slate-300">-</span>`;
        if (data.assumInc > 0 || data.assumExp > 0) {
            assumHtml = `<span class="text-emerald-500">+₹${data.assumInc.toLocaleString('en-IN')}</span> / <span class="text-rose-500">-₹${data.assumExp.toLocaleString('en-IN')}</span>`;
        }

        tbody.innerHTML += `
            <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td class="py-4 px-5 font-bold text-slate-700">${k}</td>
                <td class="py-4 px-5 text-slate-600 font-medium whitespace-nowrap"><span class="text-emerald-600">₹${data.actualInc.toLocaleString('en-IN')}</span> / <span class="text-rose-600">₹${data.actualExp.toLocaleString('en-IN')}</span></td>
                <td class="py-4 px-5 font-bold whitespace-nowrap bg-indigo-50/30">${assumHtml}</td>
                <td class="py-4 px-5 ${finalClass} font-black text-right bg-slate-50">${finalSign}₹${finalNet.toLocaleString('en-IN')}</td>
            </tr>
        `;
    });
}

function showFeeBreakdown() {
    let admission = 0, tuition = 0, exam = 0, other = 0, totalAdDiscount = 0;
    appData.transactions.forEach(tx => {
        if(tx.type === 'income' && !tx.title.includes('Job Desk:') && !tx.title.includes('Print Desk:')) {
            const amt = parseFloat(tx.amount) || 0;
            if(tx.title.toLowerCase().includes('admission')) admission += amt;
            else if(tx.title.toLowerCase().includes('tuition')) tuition += amt;
            else if(tx.title.toLowerCase().includes('exam') || tx.title.toLowerCase().includes('certificate')) exam += amt;
            else if(tx.title.toLowerCase().includes('other')) other += amt;
            else admission += amt; 
        }
    });
    appData.students.forEach(st => {
        totalAdDiscount += parseFloat(st.adWallet) || 0;
    });
    const total = admission + tuition + exam + other;
    alert(`📊 TOTAL STUDENT FEES: ₹${total.toLocaleString('en-IN')}\n\n🎟️ Admission Fees: ₹${admission.toLocaleString('en-IN')}\n📖 Course Tuitions: ₹${tuition.toLocaleString('en-IN')}\n📝 Exam/Certificates: ₹${exam.toLocaleString('en-IN')}\n💡 Other Fees: ₹${other.toLocaleString('en-IN')}\n🎁 Total Ad Discounts: ₹${totalAdDiscount.toFixed(2)}`);
}

function getDynamicPaidFee(student) {
    let total = 0;
    appData.transactions.forEach(tx => {
        if (tx.type === 'income' && !tx.title.includes('Job Desk:') && !tx.title.includes('Print Desk:')) {
            if (tx.title.includes(`[${student.id}]`) || (tx.title.includes(student.name) && !tx.title.includes('[STU'))) {
                total += parseFloat(tx.amount) || 0;
            }
        }
    });
    return Math.max(total, parseFloat(student.paidFee) || 0);
}

function addStudent(name, course, totalFee, paidNow, phone, dateStr, feeType, gender, imageBase64, durationStr) {
    const id = 'STU' + Math.floor(Math.random() * 90000 + 10000);
    appData.students.unshift({ id: id, name: name, course: course, totalFee: parseFloat(totalFee), paidFee: parseFloat(paidNow), feeType: feeType, gender: gender, phone: phone, date: dateStr, image: imageBase64, duration: parseInt(durationStr) || 0, adWallet: 0, status: 'Active' });
    recordTransaction("income", `Admission Fee - ${name} [${id}]`, parseFloat(paidNow), dateStr);
    renderStudentList(); saveDatabase(); return id;
}

function recordTransaction(type, title, amount, dateStr, desc = "") {
    appData.transactions.push({ id: 'TXN' + Math.floor(Math.random() * 9000 + 1000), type: type, title: title, amount: parseFloat(amount), date: dateStr, description: desc });
    appData.transactions.sort((a,b) => new Date(b.date) - new Date(a.date));
    recalculateStats(); refreshAllUI(); saveDatabase();
}

function submitRegistration(e) {
    e.preventDefault();
    const date = document.getElementById('reg-date').value; const name = document.getElementById('reg-name').value;
    const course = document.getElementById('reg-course').value; const feeType = document.getElementById('reg-feetype').value;
    const gender = document.getElementById('reg-gender').value; const phone = document.getElementById('reg-phone').value;
    const totalFee = document.getElementById('reg-totalfee').value; const paid = document.getElementById('reg-paid').value;
    const duration = document.getElementById('reg-duration').value;
    const fileInput = document.getElementById('reg-image');

    const finishReg = function(base64Image) {
        const stId = addStudent(name, course, totalFee, paid, phone, date, feeType, gender, base64Image, duration);
        alert(`Success! ${name} registered.`); e.target.reset(); setDefaultDates(); switchTab('tuition'); croppedImages.reg = null;
    };

    if(croppedImages.reg) { finishReg(croppedImages.reg); } else { compressImage(fileInput.files[0], finishReg); }
}

function renderStudentList() {
    let totalTuition = 0;
    appData.transactions.forEach(tx => {
        if(tx.type === 'income' && !tx.title.includes('Job Desk:') && !tx.title.includes('Print Desk:')) {
            totalTuition += parseFloat(tx.amount) || 0;
        }
    });
    const tuitionSpan = document.getElementById('total-tuition-collected');
    if (tuitionSpan) tuitionSpan.innerText = totalTuition.toLocaleString('en-IN');

    const listEl = document.getElementById('student-list');
    const searchQ = document.getElementById('filter-search') ? document.getElementById('filter-search').value.toLowerCase() : '';
    const dueF = document.getElementById('filter-due') ? document.getElementById('filter-due').value : 'all';
    const courseF = document.getElementById('filter-course') ? document.getElementById('filter-course').value : 'all';
    const statusF = document.getElementById('filter-status') ? document.getElementById('filter-status').value : 'Active';

    listEl.innerHTML = '';
    if(appData.students.length === 0) {
        listEl.innerHTML = '<div class="text-center text-slate-400 mt-10"><i class="fa-solid fa-folder-open text-4xl mb-4 text-slate-200 block"></i><p class="font-bold text-slate-500">No students yet</p></div>'; return;
    }

    const courseSelect = document.getElementById('filter-course');
    if (courseSelect) {
        const currentVal = courseSelect.value;
        const uniqueCourses = [...new Set(appData.students.map(s => s.course))];
        let optionsHtml = '<option value="all">All Batches</option>';
        uniqueCourses.forEach(c => { optionsHtml += `<option value="${c}">${c}</option>`; });
        courseSelect.innerHTML = optionsHtml; courseSelect.value = uniqueCourses.includes(currentVal) ? currentVal : 'all';
    }

    const filteredStudents = appData.students.filter(st => {
        const actualPaid = getDynamicPaidFee(st);
        const adDiscount = parseFloat(st.adWallet) || 0;
        const dues = st.totalFee - actualPaid - adDiscount;
        
        const matchSearch = st.name.toLowerCase().includes(searchQ) || st.id.toLowerCase().includes(searchQ);
        const matchDue = dueF === 'all' || (dueF === 'pending' && dues > 0) || (dueF === 'cleared' && dues <= 0);
        const matchCourse = courseF === 'all' || st.course === courseF;
        
        const stStatus = st.status || 'Active';
        const matchStatus = statusF === 'all' || stStatus === statusF;
        
        return matchSearch && matchDue && matchCourse && matchStatus;
    });

    if(filteredStudents.length === 0) {
        listEl.innerHTML = '<div class="text-center text-slate-400 mt-10 text-sm font-bold"><i class="fa-solid fa-magnifying-glass text-3xl mb-3 block text-slate-300"></i>No matches found</div>'; return;
    }

    filteredStudents.forEach(st => {
        const actualPaid = getDynamicPaidFee(st);
        const adDiscount = parseFloat(st.adWallet) || 0;
        const dues = st.totalFee - actualPaid - adDiscount;
        const avatar = st.image ? `<img src="${st.image}" class="w-full h-full object-cover">` : `<span class="font-bold text-lg">${st.name.charAt(0)}</span>`;
        const card = document.createElement('div');
        card.className = "flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl cursor-pointer hover:border-indigo-400 hover:shadow-lg transition-all group transform hover:-translate-y-1 shadow-sm";
        card.onclick = () => selectStudent(st.id);
        card.innerHTML = `
            <div class="flex items-center space-x-4 overflow-hidden">
                <div class="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors overflow-hidden shadow-inner shrink-0">${avatar}</div>
                <div class="truncate"><p class="font-extrabold text-slate-800 text-sm truncate">${st.name}</p><p class="text-[10px] text-slate-500 font-bold uppercase tracking-wide mt-0.5 truncate">${st.id} • ${st.course}</p></div>
            </div>
            <div class="text-right shrink-0 ml-2"><p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Due</p><p class="${dues > 0 ? 'text-rose-500' : 'text-emerald-500'} font-black text-sm drop-shadow-sm">₹${dues.toFixed(2)}</p></div>
        `;
        listEl.appendChild(card);
    });
}

function renderMiniLedger(student) {
    const miniLedger = document.getElementById('student-mini-ledger');
    miniLedger.innerHTML = '';
    
    const stTx = appData.transactions.filter(t => !t.title.includes('Job Desk:') && !t.title.includes('Print Desk:') && (t.title.includes(`[${student.id}]`) || (t.title.includes(student.name) && !t.title.includes('[STU'))));
    
    if(stTx.length === 0) {
        if (student.paidFee > 0) {
            miniLedger.innerHTML = `
                <tr class="hover:bg-slate-100 transition-colors border-b border-slate-100">
                    <td class="py-3 px-3 text-slate-500 font-bold">${student.date || '-'}</td>
                    <td class="py-3 px-3 text-slate-800 font-bold max-w-[120px] truncate" title="Recovered Advance Payment">Prior Advance Payment</td>
                    <td class="py-3 px-3 text-right font-black text-emerald-600">+₹${student.paidFee}</td>
                    <td class="py-3 px-2 text-center"><i class="fa-solid fa-check text-emerald-400"></i></td>
                </tr>
            `;
        } else {
            miniLedger.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-xs text-slate-400 font-bold">No payment history found.</td></tr>'; 
        }
        return;
    }
    
    stTx.forEach(tx => {
        const isInc = tx.type === 'income';
        const cleanTitle = tx.title.replace(` - ${student.name}`, '').replace(` [${student.id}]`, '');
        miniLedger.innerHTML += `
            <tr class="hover:bg-slate-100 transition-colors border-b border-slate-100">
                <td class="py-3 px-3 text-slate-500 font-bold">${tx.date}</td>
                <td class="py-3 px-3 text-slate-800 font-bold max-w-[120px] truncate" title="${tx.title}">${cleanTitle}</td>
                <td class="py-3 px-3 text-right font-black ${isInc ? 'text-emerald-600' : 'text-rose-600'}">${isInc ? '+' : '-'}₹${tx.amount}</td>
                <td class="py-3 px-2 text-center">
                    <button type="button" onclick="shareTransactionWA('${tx.id}')" class="text-emerald-400 hover:text-emerald-600 transition-colors p-1" title="Share via WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>
                    <button type="button" onclick="deleteTransaction('${tx.id}')" class="text-rose-300 hover:text-rose-600 transition-colors p-1" title="Delete Payment"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

function selectStudent(id) {
    const student = appData.students.find(s => s.id === id);
    if(!student) return;

    const actualPaid = getDynamicPaidFee(student);
    const adDiscount = parseFloat(student.adWallet) || 0;

    document.getElementById('tuition-placeholder').classList.add('hidden');
    document.getElementById('tuition-active').classList.remove('hidden');
    document.getElementById('active-student-name').innerText = student.name;
    document.getElementById('active-student-course').innerText = `${student.course} (${student.duration || '?'} Months)`;
    document.getElementById('active-student-gender').innerText = student.gender || "N/A";
    document.getElementById('active-student-feetype').innerText = student.feeType || "Monthly";
    document.getElementById('tuition-student-id').value = student.id;
    document.getElementById('active-student-avatar').innerHTML = student.image ? `<img src="${student.image}" class="w-full h-full object-cover">` : student.name.charAt(0);
    document.getElementById('active-student-date').innerText = student.date || "-";
    document.getElementById('active-student-phone').innerText = student.phone || "-";
    document.getElementById('active-student-totalfee').innerText = `₹${student.totalFee}`;
    document.getElementById('active-student-paidfee').innerText = `₹${actualPaid}`;
    document.getElementById('active-student-adwallet').innerText = `₹${adDiscount.toFixed(2)}`;

    // Show/Hide Graduated Badge
    const badgeEl = document.getElementById('active-student-badge');
    if(badgeEl) {
        if (student.status === 'Graduated') {
            badgeEl.classList.remove('hidden');
        } else {
            badgeEl.classList.add('hidden');
        }
    }

    const dues = student.totalFee - actualPaid - adDiscount;
    const dueEl = document.getElementById('active-student-dues');
    dueEl.innerText = `₹${dues.toFixed(2)}`;
    dueEl.className = dues <= 0 ? "text-3xl md:text-4xl font-black text-emerald-400 drop-shadow-md" : "text-3xl md:text-4xl font-black text-rose-400 drop-shadow-md";
    if(dues <= 0) dueEl.innerText = "Cleared";

    renderMiniLedger(student);
    renderStudentFiles(student.id);
    if(window.innerWidth < 1024) document.getElementById('tuition-active').scrollIntoView({behavior: 'smooth'});
}

function renderLedger() {
    const tbody = document.getElementById('transaction-ledger'); tbody.innerHTML = '';
    if(appData.transactions.length === 0) return;
    appData.transactions.slice(0, 15).forEach(tx => {
        const isInc = tx.type === 'income';
        const badge = isInc ? `<span class="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-[10px] font-black tracking-widest shadow-sm">IN</span>` : `<span class="px-3 py-1 bg-rose-100 text-rose-700 rounded-lg text-[10px] font-black tracking-widest shadow-sm">OUT</span>`;
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors">
                <td class="py-4 px-4 text-slate-500 text-xs font-bold whitespace-nowrap">${tx.date}</td>
                <td class="py-4 px-4 font-extrabold text-slate-800 min-w-[200px]">${tx.title.replace(/ \[STU.*\]/, '')}</td>
                <td class="py-4 px-4 text-center">${badge}</td>
                <td class="py-4 px-4 text-right font-black text-base ${isInc ? 'text-emerald-600' : 'text-rose-600'}">${isInc ? '+' : '-'}₹${tx.amount.toLocaleString('en-IN')}</td>
                <td class="py-4 px-2 text-center">
                    <button type="button" onclick="shareTransactionWA('${tx.id}')" class="text-emerald-400 hover:text-emerald-600 transition-colors p-1 mr-1" title="Share via WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>
                    <button type="button" onclick="openEditTransactionModal('${tx.id}')" class="text-indigo-300 hover:text-indigo-600 transition-colors p-1" title="Edit Record"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" onclick="deleteTransaction('${tx.id}')" class="text-rose-300 hover:text-rose-600 transition-colors p-1 ml-1" title="Delete Record"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

function renderList(containerId, itemsFilterFn, titleReplace, iconClass, colorClass, emptyMsg) {
    const listEl = document.getElementById(containerId); listEl.innerHTML = '';
    const items = appData.transactions.filter(itemsFilterFn);
    if(items.length === 0) { listEl.innerHTML = `<div class="text-center text-slate-400 mt-10"><i class="${iconClass} text-4xl mb-4 text-slate-200 block"></i><p class="font-bold text-slate-500">${emptyMsg}</p></div>`; return; }
    items.forEach(tx => {
        const isInc = tx.type === 'income';
        listEl.innerHTML += `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-5 bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all transform hover:-translate-y-1 mb-3 gap-4">
                <div class="flex items-center space-x-4">
                    <div class="w-14 h-14 rounded-2xl bg-${colorClass}-50 text-${colorClass}-600 flex items-center justify-center text-2xl shadow-inner border border-${colorClass}-100 shrink-0"><i class="${iconClass}"></i></div>
                    <div><h4 class="font-extrabold text-slate-800 text-sm md:text-base">${tx.title.replace(titleReplace, '').replace(/ \[STU.*\]/, '')}</h4><p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">${tx.date} ${tx.description ? '• ' + tx.description : ''}</p></div>
                </div>
                <div class="flex items-center gap-2 sm:gap-4 self-end sm:self-auto">
                    <h3 class="text-xl md:text-2xl font-black drop-shadow-sm ${isInc ? 'text-emerald-600' : 'text-rose-600'}">${isInc ? '+' : '-'}₹${tx.amount.toLocaleString('en-IN')}</h3>
                    <div class="flex space-x-1">
                        <button type="button" onclick="shareTransactionWA('${tx.id}')" class="text-emerald-400 hover:text-emerald-600 transition-colors p-2" title="Share via WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>
                        <button type="button" onclick="openEditTransactionModal('${tx.id}')" class="text-indigo-300 hover:text-indigo-600 transition-colors p-2" title="Edit Record"><i class="fa-solid fa-pen"></i></button>
                        <button type="button" onclick="deleteTransaction('${tx.id}')" class="text-rose-300 hover:text-rose-600 transition-colors p-2" title="Delete Record"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </div>
        `;
    });
}
function renderExpenseList() { renderList('expense-list', t => t.type === 'expense', '', 'fa-solid fa-receipt', 'rose', 'No expenditures recorded.'); }
function renderJobList() { renderList('job-list', t => t.title.includes('Job Desk:'), 'Job Desk: ', 'fa-solid fa-user-tie', 'blue', 'No job applications yet.'); }
function renderPrintList() { renderList('print-list', t => t.title.includes('Print Desk:'), 'Print Desk: ', 'fa-solid fa-print', 'purple', 'No print income yet.'); }

function openEditModal() {
    const stId = document.getElementById('tuition-student-id').value;
    const student = appData.students.find(s => s.id === stId);
    if(!student) return;

    document.getElementById('edit-student-id').value = student.id; 
    document.getElementById('edit-name').value = student.name;
    document.getElementById('edit-date').value = student.date || new Date().toISOString().split('T')[0];
    document.getElementById('edit-phone').value = student.phone || ''; 
    document.getElementById('edit-gender').value = student.gender || 'Male';
    document.getElementById('edit-course').value = student.course; 
    document.getElementById('edit-feetype').value = student.feeType || 'Monthly';
    document.getElementById('edit-totalfee').value = student.totalFee; 
    document.getElementById('edit-paidfee').value = getDynamicPaidFee(student);
    document.getElementById('edit-adwallet').value = student.adWallet || 0;
    document.getElementById('edit-duration').value = student.duration || 0;
    
    const statusSelect = document.getElementById('edit-status');
    if (statusSelect) {
        statusSelect.value = student.status || 'Active';
    }

    const modal = document.getElementById('edit-student-modal'); const content = document.getElementById('edit-modal-content');
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); }, 10);
}

function closeEditModal() {
    const modal = document.getElementById('edit-student-modal'); const content = document.getElementById('edit-modal-content');
    modal.classList.add('opacity-0'); content.classList.add('scale-95');
    setTimeout(() => { 
        modal.classList.add('hidden'); document.getElementById('edit-image').value = ''; croppedImages.edit = null; 
    }, 300);
}

function submitEditStudent(e) {
    e.preventDefault();
    const id = document.getElementById('edit-student-id').value; let student = appData.students.find(s => s.id === id);
    if(!student) return;

    const oldName = student.name;
    const newName = document.getElementById('edit-name').value;
    student.name = newName; 
    student.date = document.getElementById('edit-date').value;
    student.phone = document.getElementById('edit-phone').value; 
    student.gender = document.getElementById('edit-gender').value;
    student.course = document.getElementById('edit-course').value; 
    student.feeType = document.getElementById('edit-feetype').value;
    student.totalFee = parseFloat(document.getElementById('edit-totalfee').value);
    student.duration = parseInt(document.getElementById('edit-duration').value) || 0;
    student.adWallet = parseFloat(document.getElementById('edit-adwallet').value) || 0;
    
    const statusSelect = document.getElementById('edit-status');
    if (statusSelect) {
        student.status = statusSelect.value;
    }
    
    if (oldName !== newName) {
        appData.transactions.forEach(tx => {
            if (!tx.title.includes('Job Desk:') && !tx.title.includes('Print Desk:') && (tx.title.includes(`[${student.id}]`) || (tx.title.includes(oldName) && !tx.title.includes('[STU')))) { 
                tx.title = tx.title.replace(oldName, newName); 
            }
            if (tx.description && (!tx.title.includes('Job Desk:') && !tx.title.includes('Print Desk:') && (tx.title.includes(`[${student.id}]`) || tx.description.includes(oldName)))) { 
                tx.description = tx.description.replace(oldName, newName); 
            }
        });
    }

    const oldPaid = getDynamicPaidFee(student);
    const newPaid = parseFloat(document.getElementById('edit-paidfee').value);
    student.paidFee = newPaid;

    if(newPaid !== oldPaid) {
        const diff = newPaid - oldPaid;
        let targetTx = appData.transactions.find(tx => tx.type === 'income' && !tx.title.includes('Job Desk:') && !tx.title.includes('Print Desk:') && (tx.title.includes(`[${student.id}]`) || (tx.title.includes(student.name) && !tx.title.includes('[STU'))));
        if (targetTx) { targetTx.amount = parseFloat(targetTx.amount) + diff; if(targetTx.amount < 0) targetTx.amount = 0; }
    }

    const fileInput = document.getElementById('edit-image');
    if(croppedImages.edit) {
        student.image = croppedImages.edit; croppedImages.edit = null; finalizeEdit(student);
    } else if(fileInput.files && fileInput.files[0]) {
        compressImage(fileInput.files[0], function(base64Image) { student.image = base64Image; finalizeEdit(student); });
    } else { finalizeEdit(student); }
}

function finalizeEdit(student) { closeEditModal(); recalculateStats(); saveDatabase(); refreshAllUI(); alert("Profile updated successfully!"); }

function submitTuitionFee(e) {
    e.preventDefault();
    const stId = document.getElementById('tuition-student-id').value; const date = document.getElementById('tuition-date').value;
    const feeCategory = document.getElementById('tuition-feetype-select').value; const desc = document.getElementById('tuition-desc').value;
    const amount = parseFloat(document.getElementById('tuition-amount').value);
    let student = appData.students.find(s => s.id === stId);
    if(student) {
        if(feeCategory === "Course Tuition Fee" || feeCategory === "Admission Fee") { student.paidFee += amount; }
        const finalDesc = desc ? `${feeCategory} (${desc})` : feeCategory;
        recordTransaction("income", `${finalDesc} - ${student.name} [${student.id}]`, amount, date);
        alert(`₹${amount} recorded for ${student.name}!`); e.target.reset(); setDefaultDates(); selectStudent(stId); 
    }
}

function submitJobApp(e) {
    e.preventDefault();
    const date = document.getElementById('job-date').value; const name = document.getElementById('job-name').value;
    const post = document.getElementById('job-post').value; const amount = document.getElementById('job-amount').value;
    recordTransaction("income", `Job Desk: ${name}`, amount, date, post);
    e.target.reset(); setDefaultDates();
}

function submitPrintIncome(e) {
    e.preventDefault();
    const date = document.getElementById('print-date').value; const service = document.getElementById('print-service').value;
    const desc = document.getElementById('print-desc').value; const amount = document.getElementById('print-amount').value;
    recordTransaction("income", `Print Desk: ${service}`, amount, date, desc);
    e.target.reset(); setDefaultDates();
}

function submitExpense(e) {
    e.preventDefault();
    const date = document.getElementById('exp-date').value; const category = document.getElementById('exp-category').value;
    const amount = document.getElementById('exp-amount').value; const desc = document.getElementById('exp-desc').value;
    if(parseFloat(amount) > appData.stats.balance && !confirm("Expense is greater than balance. Proceed?")) return;
    recordTransaction("expense", category, amount, date, desc);
    e.target.reset(); setDefaultDates();
}

function openEditTransactionModal(txId) {
    const tx = appData.transactions.find(t => t.id === txId);
    if(!tx) return;
    if(tx.title.includes("Tuition Fee") || tx.title.includes("Admission") || tx.title.includes("Advance")) {
        alert("Please edit student payments directly from their profile in the Student Database."); return;
    }
    document.getElementById('edit-tx-id').value = tx.id; document.getElementById('edit-tx-date').value = tx.date;
    document.getElementById('edit-tx-title').value = tx.title; document.getElementById('edit-tx-amount').value = tx.amount;
    document.getElementById('edit-tx-desc').value = tx.description || '';
    const modal = document.getElementById('edit-transaction-modal');
    modal.classList.remove('hidden'); setTimeout(() => { modal.classList.remove('opacity-0'); modal.querySelector('div').classList.remove('scale-95'); }, 10);
}

function closeEditTransactionModal() {
    const modal = document.getElementById('edit-transaction-modal'); modal.classList.add('opacity-0'); modal.querySelector('div').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function submitEditTransaction(e) {
    e.preventDefault();
    const txId = document.getElementById('edit-tx-id').value; const tx = appData.transactions.find(t => t.id === txId);
    if(!tx) return;
    tx.date = document.getElementById('edit-tx-date').value; tx.title = document.getElementById('edit-tx-title').value;
    tx.amount = parseFloat(document.getElementById('edit-tx-amount').value); tx.description = document.getElementById('edit-tx-desc').value;
    recalculateStats(); saveDatabase(); refreshAllUI(); closeEditTransactionModal(); alert("Record updated successfully!");
}

function deleteTransaction(txId) { openDeleteModal(txId, false); }

function openDeleteModal(id = null, isStudent = true) {
    if(isStudent) {
        const stId = document.getElementById('tuition-student-id').value; const student = appData.students.find(s => s.id === stId);
        if(!student) return;
        document.getElementById('delete-student-name').innerText = student.name; document.getElementById('delete-student-flag').value = 'true';
    } else {
        document.getElementById('delete-student-name').innerText = "this record"; document.getElementById('delete-transaction-id').value = id;
        document.getElementById('delete-student-flag').value = 'false';
    }
    document.getElementById('delete-password-input').value = ''; document.getElementById('delete-error').classList.add('hidden');
    const modal = document.getElementById('delete-student-modal'); const content = document.getElementById('delete-modal-content');
    modal.classList.remove('hidden'); setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); }, 10);
}

function closeDeleteModal() {
    const modal = document.getElementById('delete-student-modal'); const content = document.getElementById('delete-modal-content');
    modal.classList.add('opacity-0'); content.classList.add('scale-95'); setTimeout(() => modal.classList.add('hidden'), 300);
}

async function executeDelete() {
    const pass = document.getElementById('delete-password-input').value;
    const errorMsg = document.getElementById('delete-error');
    const btnText = document.getElementById('delete-btn-text');
    const isStudent = document.getElementById('delete-student-flag').value === 'true';

    if(!pass) return;
    if (pass !== 'admin') { errorMsg.classList.remove('hidden'); return; }

    errorMsg.classList.add('hidden'); btnText.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Deleting...';

    setTimeout(() => {
        if(isStudent) {
            const stId = document.getElementById('tuition-student-id').value; let student = appData.students.find(s => s.id === stId);
            if(student) {
                appData.students = appData.students.filter(s => s.id !== stId);
                appData.transactions = appData.transactions.filter(tx => !(!tx.title.includes('Job Desk:') && !tx.title.includes('Print Desk:') && (tx.title.includes(`[${student.id}]`) || (tx.title.includes(student.name) && !tx.title.includes('[STU')))));
                document.getElementById('tuition-placeholder').classList.remove('hidden'); document.getElementById('tuition-active').classList.add('hidden');
                alert(`${student.name} deleted.`);
            }
        } else {
            const txId = document.getElementById('delete-transaction-id').value; const txIndex = appData.transactions.findIndex(t => t.id === txId);
            if(txIndex !== -1) {
                const tx = appData.transactions[txIndex];
                if (tx.title.includes('Tuition') || tx.title.includes('Admission') || tx.title.includes('Advance')) {
                    appData.students.forEach(student => { 
                        if (!tx.title.includes('Job Desk:') && !tx.title.includes('Print Desk:') && (tx.title.includes(`[${student.id}]`) || (tx.title.includes(student.name) && !tx.title.includes('[STU')))) { 
                            student.paidFee -= tx.amount; if(student.paidFee < 0) student.paidFee = 0; 
                        } 
                    });
                }
                appData.transactions.splice(txIndex, 1);
                alert("Record deleted successfully.");
            }
        }
        recalculateStats(); saveDatabase(); refreshAllUI(); closeDeleteModal(); btnText.innerHTML = 'Confirm Delete';
    }, 300);
}

// =========================================
// STUDENT DOCUMENT VAULT LOGIC (FIREBASE & COMPRESSION)
// =========================================

// Compresses document images heavily before upload. Leaves PDFs native.
function compressDocumentImage(file, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas'); 
            const ctx = canvas.getContext('2d');
            const MAX_SIZE = 800; // Optimal size for reading document text
            let width = img.width, height = img.height;
            
            if (width > height) { 
                if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } 
            } else { 
                if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } 
            }
            
            canvas.width = width; 
            canvas.height = height; 
            ctx.drawImage(img, 0, 0, width, height);
            
            // Convert back to a file object for Firebase
            canvas.toBlob((blob) => {
                const compressedFile = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
                callback(compressedFile);
            }, 'image/jpeg', 0.7); // 0.7 quality compresses heavily while retaining text readability
        }
        img.src = e.target.result;
    }
    reader.readAsDataURL(file);
}

// Structurally optimizes PDFs using PDF-Lib
async function compressPDF(file, callback) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        // Load the PDF into memory
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
        
        // Re-save with object streams enabled (compresses the internal structure of the PDF)
        const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
        
        const compressedBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        let finalFile = new File([compressedBlob], file.name, {
            type: 'application/pdf',
            lastModified: Date.now(),
        });
        
        // If structural compression somehow made it larger, fallback to the original
        if(finalFile.size >= file.size) {
            finalFile = file;
        }
        
        callback(finalFile);
    } catch (error) {
        console.error("PDF Optimization failed:", error);
        callback(file); // Fallback to original if library fails
    }
}

function handleStudentFileUpload(event) {
    const originalFile = event.target.files[0];
    if (!originalFile) return;
    
    const stId = document.getElementById('tuition-student-id').value;
    if (!stId) return;

    const uploadToFirebase = (fileToUpload) => {
        const storageRef = firebase.storage().ref();
        
        // CHANGED PATH to match your strict Firebase rule: match /vault/{fileName}
        // Safely strip special characters from file name just in case
        const safeName = fileToUpload.name.replace(/[^a-zA-Z0-9.]/g, '_');
        const filePath = `vault/${stId}_${Date.now()}_${safeName}`;
        
        const fileRef = storageRef.child(filePath);

        const progressBar = document.getElementById('upload-progress-bar');
        const progressContainer = document.getElementById('upload-progress-container');
        progressContainer.classList.remove('hidden');
        progressBar.style.width = '0%';

        const uploadTask = fileRef.put(fileToUpload);

        uploadTask.on('state_changed', 
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                progressBar.style.width = progress + '%';
            }, 
            (error) => {
                console.error("Upload failed:", error);
                // Shows the precise Firebase Error code so you know exactly what is blocking it
                alert("File upload to Vault failed!\n\nFirebase Error: " + error.code + "\nMessage: " + error.message + "\n\nTip: Go to Firebase Console -> Storage -> Rules, and set to 'allow read, write: if true;' for testing.");
                progressContainer.classList.add('hidden');
                document.getElementById('student-doc-upload').value = '';
            }, 
            () => {
                uploadTask.snapshot.ref.getDownloadURL().then((downloadURL) => {
                    progressContainer.classList.add('hidden');
                    const sizeMB = (fileToUpload.size / (1024 * 1024)).toFixed(2);
                    saveFileToDatabase(fileToUpload.name, "Student Certificate", stId, downloadURL, filePath, sizeMB);
                    document.getElementById('student-doc-upload').value = '';
                });
            }
        );
    };

    // Compress images or PDFs based on file type
    if (originalFile.type.startsWith('image/')) {
        compressDocumentImage(originalFile, uploadToFirebase);
    } else if (originalFile.type === 'application/pdf') {
        compressPDF(originalFile, uploadToFirebase);
    } else {
        uploadToFirebase(originalFile);
    }
}

function saveFileToDatabase(name, category, target, url, path, size) {
    const payload = { 
        action: 'add_file', 
        pass: sessionPassword, 
        name: name, 
        category: category, 
        target: target, 
        url: url, 
        path: path, 
        size: size, 
        folder: "Student Vault" 
    };
    
    fetch(GOOGLE_APP_URL, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { "Content-Type": "text/plain;charset=utf-8" }
    })
    .then(res => res.json())
    .then(result => {
        if(result.success) {
            if (!appData.files) appData.files = [];
            appData.files.push({
                id: "FL" + Date.now(),
                name: name,
                category: category,
                target: target,
                url: url,
                path: path,
                size: size,
                date: new Date().toISOString().split('T')[0],
                folder: "Student Vault"
            });
            renderStudentFiles(target);
            alert("Document successfully saved to Student Vault!");
        } else {
            alert("Error saving file record to database: " + result.error);
        }
    })
    .catch(error => {
        console.error("Database save failed:", error);
        alert("Database connection failed while saving file record.");
    });
}

function renderStudentFiles(stId) {
    const listEl = document.getElementById('student-files-list');
    if(!listEl) return;
    listEl.innerHTML = '';
    
    if (!appData.files) appData.files = [];
    const stFiles = appData.files.filter(f => f.target === stId);
    
    if (stFiles.length === 0) {
        listEl.innerHTML = '<tr><td colspan="3" class="text-center py-6 text-xs text-slate-400 font-bold"><i class="fa-solid fa-folder-open text-2xl mb-2 text-slate-300 block"></i>No documents stored yet.</td></tr>';
        return;
    }
    
    stFiles.forEach(f => {
        listEl.innerHTML += `
            <tr class="hover:bg-slate-100 transition-colors border-b border-slate-100">
                <td class="py-3 px-3 text-slate-500 font-bold text-[10px]">${f.date}</td>
                <td class="py-3 px-3 text-slate-800 font-bold max-w-[150px] truncate" title="${f.name}">
                    <a href="${f.url}" target="_blank" class="text-indigo-600 hover:text-indigo-800 hover:underline transition-colors"><i class="fa-solid fa-file-pdf text-rose-500 mr-1.5"></i>${f.name}</a>
                </td>
                <td class="py-3 px-2 text-center">
                    <button type="button" onclick="deleteStudentFile('${f.path}', '${f.id}')" class="text-rose-300 hover:text-rose-600 transition-colors p-1" title="Delete Document"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

function deleteStudentFile(path, fileId) {
    if(!confirm("Are you sure you want to permanently delete this document?")) return;
    
    const storageRef = firebase.storage().ref();
    const fileRef = storageRef.child(path);
    
    fileRef.delete().then(() => {
        const payload = { action: 'delete_file', pass: sessionPassword, id: fileId, path: path };
        fetch(GOOGLE_APP_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        })
        .then(res => res.json())
        .then(result => {
            if(result.success) {
                appData.files = appData.files.filter(f => f.id !== fileId);
                const stId = document.getElementById('tuition-student-id').value;
                renderStudentFiles(stId);
                alert("Document deleted.");
            }
        });
    }).catch((error) => {
        console.error("Firebase deletion failed:", error);
        const payload = { action: 'delete_file', pass: sessionPassword, id: fileId, path: path };
        fetch(GOOGLE_APP_URL, { method: 'POST', body: JSON.stringify(payload), headers: { "Content-Type": "text/plain;charset=utf-8" }})
        .then(res => res.json())
        .then(result => {
            appData.files = appData.files.filter(f => f.id !== fileId);
            const stId = document.getElementById('tuition-student-id').value;
            renderStudentFiles(stId);
        });
    });
}
