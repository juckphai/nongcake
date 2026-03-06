// ==============================================
// ตัวแปร global และ Firebase
// ==============================================
let accounts = [];
let currentAccount = null;
let records = [];
let editingIndex = null;
let accountTypes = new Map();
let tempTypeValue = '';
let backupPassword = null;
let summaryContext = {};
let singleDateExportContext = {}; 
let dateRangeExportContext = {};

// ✅ ตัวแปรใหม่สำหรับเก็บสรุปผลแต่ละวันแบบโครงสร้าง (ไม่กระทบของเดิม)
let dailySummaryData = {}; // เก็บข้อมูลสรุปแต่ละวันในรูปแบบ object { date: { income, expense } }

// Firebase
let currentUser = null;
let userDataRef = null;
let syncInProgress = false;
let lastSyncTime = null;
let unsubscribeMain = null;
let unsubscribeAccount = null;
let unsubscribeMap = {};

// ตัวแปรสำหรับ Real-time Clock
let clockInterval = null;

// ==============================================
// ฟังก์ชันจัดการวันที่และเวลา (ปรับปรุงใหม่: แก้ Timezone + แยกช่อง + เวลาเดิน)
// ==============================================

/**
 * ดึงค่าวันและเวลาปัจจุบันแบบ Local Time (แก้ปัญหาเวลาเพี้ยน)
 */
function getCurrentLocalValues() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    return {
        date: `${year}-${month}-${day}`,
        time: `${hours}:${minutes}`
    };
}

/**
 * ตั้งค่าวันที่และเวลาปัจจุบันลงในช่อง entryDate และ entryTime
 */
function setCurrentDateTime() {
    const dateInput = document.getElementById('entryDate');
    const timeInput = document.getElementById('entryTime');
    
    if (dateInput && timeInput) {
        const current = getCurrentLocalValues();
        
        // ถ้าไม่มีการแก้ไข (Manual) ให้เวลาเดินไปเรื่อยๆ
        if (dateInput.dataset.manual !== "true") {
            dateInput.value = current.date;
        }
        if (timeInput.dataset.manual !== "true") {
            timeInput.value = current.time;
        }
    }
}

/**
 * เริ่มต้นนาฬิกาเดินเอง (Real-time Clock)
 */
function startRealTimeClock() {
    // เคลียร์ Interval เก่าก่อน (ถ้ามี)
    if (clockInterval) clearInterval(clockInterval);

    // เซ็ตครั้งแรกทันที
    setCurrentDateTime();

    // ดักจับ Event เมื่อผู้ใช้แก้ไขเอง
    const inputs = ['entryDate', 'entryTime'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', function() {
                this.dataset.manual = "true"; // ปักธงว่าแก้ไขเอง
            });
        }
    });

    // เริ่มวนลูปทุก 1 วินาที
    clockInterval = setInterval(() => {
        setCurrentDateTime();
    }, 1000);
}

/**
 * แปลงวันที่จาก Local string เป็น Date object
 */
function parseLocalDateTime(dateTimeStr) {
    if (!dateTimeStr) return new Date();
    
    try {
        const [datePart, timePart] = dateTimeStr.split(' ');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hours, minutes] = timePart.split(':').map(Number);
        
        return new Date(year, month - 1, day, hours, minutes);
    } catch (error) {
        console.error('Error parsing date:', dateTimeStr, error);
        return new Date();
    }
}

/**
 * จัดรูปแบบวันที่และเวลาสำหรับแสดงผล
 */
function formatDateForDisplay(dateTimeStr) {
    const date = parseLocalDateTime(dateTimeStr);
    const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
    const formattedTime = `${String(date.getHours()).padStart(2, '0')}.${String(date.getMinutes()).padStart(2, '0')} น.`;
    return { formattedDate, formattedTime };
}

/**
 * แปลงวันที่จาก input string เป็น Date object
 */
function parseDateInput(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return null;
    }
    const [year, month, day] = dateStr.split('-');
    return new Date(year, month - 1, day);
}

/**
 * แปลงวันที่ YYYY-MM-DD เป็นรูปแบบไทย
 */
function formatThaiDate(dateStr) {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    const thaiYear = parseInt(year) + 543;
    return `${parseInt(day)}/${parseInt(month)}/${thaiYear}`;
}

// ==============================================
// ฟังก์ชันจัดการ Authentication
// ==============================================

/**
 * ดึงชื่อผู้ใช้สำหรับ Audit Trail
 */
function getCurrentUserIdentifier() {
    if (currentUser && currentUser.email) {
        return currentUser.email;
    }
    return 'Guest (Local)';
}

/**
 * สลับการแสดงรหัสผ่านในหน้า Login
 */
function togglePassword() {
    const passwordInput = document.getElementById('loginPassword');
    if (passwordInput) {
        passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
    }
}

/**
 * เข้าสู่ระบบด้วยอีเมล
 */
async function emailLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const rememberMe = document.getElementById('rememberMe').checked;
    
    if (!email || !password) {
        document.getElementById('loginError').textContent = 'กรุณากรอกอีเมลและรหัสผ่าน';
        return;
    }
    
    try {
        showToast('🔐 กำลังเข้าสู่ระบบ...', 'info');
        
        const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
        currentUser = userCredential.user;
        
        if (rememberMe) {
            localStorage.setItem('user_email', email);
        } else {
            localStorage.removeItem('user_email');
        }
        
        showToast('✅ เข้าสู่ระบบสำเร็จ!', 'success');
        
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('btnLogout').style.display = 'flex';
        
        await loadFromFirebase();
        
    } catch (error) {
        console.error('Login error:', error);
        let errorMessage = 'การเข้าสู่ระบบล้มเหลว';
        
        switch (error.code) {
            case 'auth/user-not-found':
                errorMessage = 'ไม่พบผู้ใช้';
                break;
            case 'auth/wrong-password':
                errorMessage = 'รหัสผ่านไม่ถูกต้อง';
                break;
            case 'auth/invalid-email':
                errorMessage = 'อีเมลไม่ถูกต้อง';
                break;
            case 'auth/too-many-requests':
                errorMessage = 'พยายามเข้าสู่ระบบมากเกินไป โปรดลองใหม่ในภายหลัง';
                break;
        }
        
        document.getElementById('loginError').textContent = errorMessage;
        showToast(`❌ ${errorMessage}`, 'error');
    }
}

/**
 * ออกจากระบบ
 */
async function emailLogout() {
    if (confirm('คุณแน่ใจว่าจะออกจากระบบหรือไม่?')) {
        try {
            await firebase.auth().signOut();
            currentUser = null;
            userDataRef = null;
            
            saveToLocal();
            
            document.getElementById('login-overlay').style.display = 'flex';
            document.getElementById('btnLogout').style.display = 'none';
            
            showToast('✅ ออกจากระบบสำเร็จ', 'success');
        } catch (error) {
            console.error('Logout error:', error);
            showToast('❌ ออกจากระบบล้มเหลว', 'error');
        }
    }
}

/**
 * ตรวจสอบสถานะการล็อกอินเมื่อโหลดหน้าเว็บ
 */
firebase.auth().onAuthStateChanged(async (user) => {
    const userStatusBar = document.getElementById('user-status-bar');
    const userDisplaySpan = document.getElementById('current-user-display');

    if (user) {
        currentUser = user;
        console.log('User is signed in:', user.email);
        
        if (userStatusBar && userDisplaySpan) {
            userStatusBar.style.display = 'block';
            userDisplaySpan.textContent = user.email;
        }

        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('btnLogout').style.display = 'flex';
        
        await loadFromFirebase();
        
        const rememberedEmail = localStorage.getItem('user_email');
        if (rememberedEmail) {
            document.getElementById('loginEmail').value = rememberedEmail;
            document.getElementById('rememberMe').checked = true;
        }
    } else {
        console.log('User is signed out');
        currentUser = null;
        
        if (userStatusBar) {
            userStatusBar.style.display = 'none';
        }

        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('btnLogout').style.display = 'none';
        
        loadFromLocal();
    }
});

// ==============================================
// ฟังก์ชัน Toast Notification
// ==============================================

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    
    let backgroundColor = '#007bff';
    switch(type) {
        case 'success':
            backgroundColor = '#28a745';
            break;
        case 'error':
            backgroundColor = '#dc3545';
            break;
        case 'warning':
            backgroundColor = '#ffc107';
            break;
        case 'income':
            backgroundColor = '#28a745';
            break;
        case 'expense':
            backgroundColor = '#dc3545';
            break;
        case 'info':
        default:
            backgroundColor = '#007bff';
            break;
    }
    
    toast.textContent = message;
    toast.style.backgroundColor = backgroundColor;
    toast.className = "toast-notification show";
    
    setTimeout(() => {
        toast.className = toast.className.replace("show", "");
    }, 3000);
}

// ==============================================
// ฟังก์ชันจัดการเมนู
// ==============================================

function toggleMainSection(sectionId) { 
    console.log('toggleMainSection called:', sectionId);
    
    const section = document.getElementById(sectionId);
    if (!section) {
        console.error('Section not found:', sectionId);
        return;
    }
    
    const header = section.previousElementSibling;
    const isCurrentlyActive = section.classList.contains('active');
    
    const allMainSections = document.querySelectorAll('.main-section-content');
    const allMainHeaders = document.querySelectorAll('.main-section-header');
    
    allMainSections.forEach(section => {
        section.classList.remove('active');
    });
    
    allMainHeaders.forEach(header => {
        header.classList.remove('active');
    });
    
    if (!isCurrentlyActive) {
        section.classList.add('active');
        if (header) header.classList.add('active');
    }
}

function toggleSubSection(sectionId) {
    console.log('toggleSubSection called:', sectionId);
    
    const section = document.getElementById(sectionId);
    if (!section) {
        console.error('Sub-section not found:', sectionId);
        return;
    }
    
    const header = section.previousElementSibling;
    
    section.classList.toggle('active');
    if (header) header.classList.toggle('active');
}

function closeAllMainSections() {
    const allMainSections = document.querySelectorAll('.main-section-content');
    const allMainHeaders = document.querySelectorAll('.main-section-header');
    
    allMainSections.forEach(section => {
        section.classList.remove('active');
    });
    
    allMainHeaders.forEach(header => {
        header.classList.remove('active');
    });
}

function toggleSection(sectionId) {
    toggleMainSection(sectionId);
}

// ==============================================
// ฟังก์ชันจัดการ Modal
// ==============================================

function openSummaryModal(htmlContent) {
    const modal = document.getElementById('summaryModal');
    const modalBody = document.getElementById('modalBodyContent');
    modalBody.innerHTML = htmlContent;
    modal.style.display = 'flex';
    setupSummaryControlsAndSave();
    showToast("📊 เปิดหน้าต่างสรุปข้อมูลเรียบร้อย", 'info');
}

function closeSummaryModal() { 
    const modal = document.getElementById('summaryModal'); 
    modal.style.display = 'none'; 
}

function openExportOptionsModal() { 
    document.getElementById('exportOptionsModal').style.display = 'flex'; 
    showToast("💾 เปิดหน้าต่างบันทึกข้อมูลเรียบร้อย", 'info');
}

function closeExportOptionsModal() { 
    document.getElementById('exportOptionsModal').style.display = 'none'; 
}

function closeSingleDateExportModal() { 
    document.getElementById('singleDateExportModal').style.display = 'none'; 
}

function closeSingleDateExportFormatModal() { 
    document.getElementById('singleDateExportFormatModal').style.display = 'none'; 
}

function closeFormatModal() { 
    document.getElementById('formatSelectionModal').style.display = 'none'; 
}

function closeExportSingleAccountModal() { 
    document.getElementById('exportSingleAccountModal').style.display = 'none'; 
}

function openSummaryOutputModal() { 
    document.getElementById('summaryOutputModal').style.display = 'flex'; 
}

function closeSummaryOutputModal() { 
    document.getElementById('summaryOutputModal').style.display = 'none'; 
    summaryContext = {}; 
}

function closeDateRangeExportModal() {
    document.getElementById('dateRangeExportModal').style.display = 'none';
    dateRangeExportContext = {};
}

// ==============================================
// ฟังก์ชันจัดการ Summary Modal Controls
// ==============================================

function setupSummaryControlsAndSave() {
    const modalContentContainer = document.querySelector("#summaryModal .modal-content-container");
    const modalBody = document.getElementById("modalBodyContent");
    if (!modalBody || !modalContentContainer) return;

    const textElements = modalBody.querySelectorAll('p, h4, strong, th, td, span, div');
    const fsSlider = document.getElementById("summaryFontSizeSlider");
    const fsValueSpan = document.getElementById("summaryFontSizeValue");

    textElements.forEach(el => {
        if (!el.dataset.originalSize) {
            el.dataset.originalSize = parseFloat(window.getComputedStyle(el).fontSize);
        }
    });

    function updateFontSize() {
        const scale = fsSlider.value;
        textElements.forEach(el => {
            const originalSize = parseFloat(el.dataset.originalSize);
            if (originalSize) {
                el.style.fontSize = (originalSize * scale) + 'px';
            }
        });
        fsValueSpan.textContent = "ขนาด: " + Math.round(scale * 100) + "%";
    }
    
    fsSlider.removeEventListener("input", updateFontSize);
    fsSlider.addEventListener("input", updateFontSize);

    const lhSlider = document.getElementById("summaryLineHeightSlider");
    const lhValueSpan = document.getElementById("summaryLineHeightValue");

    function updateLineHeight() {
        const lineHeight = lhSlider.value;
        modalBody.style.lineHeight = lineHeight;
        const tableCells = modalBody.querySelectorAll('th, td');
        tableCells.forEach(cell => {
            const calcPadding = 4 * lineHeight; 
            cell.style.padding = `${calcPadding}px 4px`;
            cell.style.lineHeight = lineHeight; 
        });
        lhValueSpan.textContent = "ความสูงของบรรทัด: " + lineHeight;
    }
    
    lhSlider.removeEventListener("input", updateLineHeight);
    lhSlider.addEventListener("input", updateLineHeight);
    
    const saveBtn = document.getElementById("saveSummaryAsImageBtn");
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.addEventListener("click", function() {
        const actionButtons = document.querySelector('.summary-action-buttons');
        const controlGroups = document.querySelectorAll('.control-group');
        const closeBtn = document.querySelector('.modal-close-btn');

        if(actionButtons) actionButtons.style.display = 'none';
        controlGroups.forEach(el => el.style.display = 'none');
        if(closeBtn) closeBtn.style.display = 'none';

        modalContentContainer.style.padding = '5px 2px';

        html2canvas(modalContentContainer, {
            useCORS: true,
            scale: 4,
            backgroundColor: '#FAFAD2'
        }).then(canvas => {
            const link = document.createElement('a');
            const fileName = `สรุป_${currentAccount || 'account'}_${Date.now()}.png`;
            link.download = fileName;
            link.href = canvas.toDataURL("image/png");
            link.click();
            showToast(`🖼️ บันทึกภาพสรุปเป็น "${fileName}" สำเร็จ`, 'success');
        }).catch(err => {
            console.error("Error creating image:", err);
            showToast("❌ ขออภัย, ไม่สามารถบันทึกเป็นรูปภาพได้", 'error');
        }).finally(() => {
            if(actionButtons) actionButtons.style.display = '';
            controlGroups.forEach(el => el.style.display = '');
            if(closeBtn) closeBtn.style.display = '';
            modalContentContainer.style.padding = '';
        });
    });        
    
    const shareBtn = document.getElementById("shareSummaryImageBtn");
    const newShareBtn = shareBtn.cloneNode(true);
    shareBtn.parentNode.replaceChild(newShareBtn, shareBtn);

    newShareBtn.addEventListener("click", async function () {
        const actionButtons = document.querySelector('.summary-action-buttons');
        const controlGroups = document.querySelectorAll('.control-group');
        const closeBtn = document.querySelector('.modal-close-btn');

        if(actionButtons) actionButtons.style.display = 'none';
        controlGroups.forEach(el => el.style.display = 'none');
        if(closeBtn) closeBtn.style.display = 'none';

        modalContentContainer.style.padding = '5px 2px';

        try {
            showToast("⏳ กำลังเตรียมรูปภาพเพื่อแชร์...", "info");
            const canvas = await html2canvas(modalContentContainer, {
                useCORS: true,
                scale: 4,
                backgroundColor: '#FAFAD2'
            });

            canvas.toBlob(async (blob) => {
                const file = new File(
                    [blob],
                    `สรุป_${currentAccount || 'account'}.png`,
                    { type: 'image/png' }
                );

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                    });
                    showToast("📤 แชร์รูปภาพสำเร็จ", 'success');
                } else {
                    showToast("❌ อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการแชร์รูปภาพโดยตรง", 'error');
                }
            });

        } catch (err) {
            console.error(err);
            if (err.name !== 'AbortError') {
                showToast("❌ แชร์รูปภาพไม่สำเร็จ", 'error');
            }
        } finally {
            if(actionButtons) actionButtons.style.display = '';
            controlGroups.forEach(el => el.style.display = '');
            if(closeBtn) closeBtn.style.display = '';
            modalContentContainer.style.padding = '';
        }
    });

    updateFontSize();
    updateLineHeight();
}

// ==============================================
// ฟังก์ชันจัดการ Firebase Sync
// ==============================================

/**
 * ตรวจสอบความเท่ากันของข้อมูล
 */
function isSameRecord(serverRecord, localRecord) {
    if (serverRecord.createdTime && localRecord.createdTime) {
        const sTime = typeof serverRecord.createdTime.toDate === 'function' 
                      ? serverRecord.createdTime.toDate().toISOString() 
                      : serverRecord.createdTime.toString();
        const lTime = typeof localRecord.createdTime.toDate === 'function' 
                      ? localRecord.createdTime.toDate().toISOString() 
                      : localRecord.createdTime.toString();
        
        if (sTime === lTime) return true;
    }

    return (
        String(serverRecord.dateTime) === String(localRecord.dateTime) &&
        String(serverRecord.description).trim() === String(localRecord.description).trim() &&
        parseFloat(serverRecord.amount) === parseFloat(localRecord.amount) &&
        String(serverRecord.type) === String(localRecord.type)
    );
}

/**
 * เพิ่มรายการแบบ Real-time
 */
async function addTransactionRealtime(newRecord) {
    if (!currentUser) return;

    const SHARED_ID = 'my_shared_group_01';
    const accDocRef = db.collection('users').doc(`${SHARED_ID}_${newRecord.account}`);

    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(accDocRef);
            let serverRecords = [];
            
            if (snap.exists) {
                serverRecords = snap.data().records || [];
            } else {
                serverRecords = [];
            }

            serverRecords.push(newRecord);

            tx.set(accDocRef, {
                accountName: newRecord.account,
                records: serverRecords,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        });
        console.log(`✅ เพิ่มรายการ Real-time สำเร็จ: ${newRecord.description}`);
    } catch (err) {
        console.error("Add Transaction Error:", err);
        throw err;
    }
}

/**
 * แก้ไขรายการแบบ Real-time
 */
async function editTransactionRealtime(oldRecord, newRecord) {
    if (!currentUser) return;

    const SHARED_ID = 'my_shared_group_01';
    const accDocRef = db.collection('users').doc(`${SHARED_ID}_${newRecord.account}`);

    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(accDocRef);
            if (!snap.exists) throw new Error("ไม่พบไฟล์บัญชีบน Server");

            const serverRecords = snap.data().records || [];
            
            const index = serverRecords.findIndex(r => isSameRecord(r, oldRecord));

            if (index === -1) {
                console.warn("⚠️ ไม่พบข้อมูลเดิมบน Server -> ทำการเพิ่มใหม่แทน");
                serverRecords.push(newRecord);
            } else {
                console.log(`✓ เจอข้อมูลเดิมที่ตำแหน่ง ${index} -> กำลังอัปเดต...`);
                serverRecords[index] = newRecord;
            }

            tx.set(accDocRef, {
                records: serverRecords,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        });
        console.log(`✅ แก้ไขรายการ Real-time สำเร็จ: ${newRecord.description}`);
    } catch (err) {
        console.error("Edit Transaction Error:", err);
        throw err;
    }
}

/**
 * ลบรายการแบบ Real-time
 */
async function deleteRecordRealtime(record) {
    if (!currentUser) return;

    const SHARED_ID = 'my_shared_group_01';
    const accDocRef = db
        .collection('users')
        .doc(`${SHARED_ID}_${record.account}`);

    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(accDocRef);
            if (!snap.exists) return;

            const serverRecords = snap.data().records || [];

            const filtered = serverRecords.filter(r =>
                !(
                    r.dateTime === record.dateTime &&
                    r.amount === record.amount &&
                    r.description === record.description &&
                    r.type === record.type
                )
            );

            tx.set(accDocRef, {
                records: filtered,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        showToast('🗑️ ลบข้อมูลแบบ Real-time สำเร็จ', 'success');

    } catch (err) {
        console.error(err);
        showToast('❌ ลบข้อมูลไม่สำเร็จ', 'error');
    }
}

/**
 * โหลดข้อมูลจาก Firebase
 */
async function loadFromFirebase() {
    if (!currentUser) return;
    
    try {
        showToast('☁️ กำลังโหลดข้อมูล (ระบบแยกบัญชี)...', 'info');
        const SHARED_ID = 'my_shared_group_01'; 
        
        const mainDocRef = db.collection('users').doc(SHARED_ID);
        const mainDoc = await mainDocRef.get();
        
        if (mainDoc.exists) {
            const data = mainDoc.data();
            accounts = data.accounts || [];
            currentAccount = data.currentAccount || null;
            
            if (data.accountTypes) {
                if (Array.isArray(data.accountTypes)) {
                    accountTypes = new Map(data.accountTypes);
                } else {
                    accountTypes = new Map(Object.entries(data.accountTypes));
                }
            } else {
                accountTypes = new Map();
            }
            backupPassword = data.backupPassword || null;
            
            if (data.lastUpdated) {
                if (typeof data.lastUpdated.toDate === 'function') {
                    lastSyncTime = data.lastUpdated.toDate();
                } else {
                    lastSyncTime = new Date(data.lastUpdated);
                }
            } else {
                lastSyncTime = new Date();
            }

            const loadPromises = accounts.map(async (accName) => {
                const docId = `${SHARED_ID}_${accName}`;
                const accDoc = await db.collection('users').doc(docId).get();
                if (accDoc.exists) {
                    const accData = accDoc.data();
                    return accData.records || [];
                }
                return [];
            });

            const results = await Promise.all(loadPromises);
            
            const serverRecords = results.flat();
            
            if (records.length > 0) {
                console.log("พบข้อมูล Local, กำลังผสานกับ Server...");
                serverRecords.forEach(serverRec => {
                    const isDuplicate = records.some(localRec => 
                        localRec.dateTime === serverRec.dateTime &&
                        localRec.amount === serverRec.amount &&
                        localRec.description === serverRec.description &&
                        localRec.account === serverRec.account
                    );
                    
                    if (!isDuplicate) {
                        records.push(serverRec);
                    }
                });

                if (records.length > serverRecords.length) {
                    console.log("💡 พบข้อมูล Offline ที่ยังไม่มีบน Cloud -> กำลัง Auto-Sync...");
                    await saveToFirebase(); 
                }
            } else {
                records = serverRecords;
            }
            
            records.sort((a, b) => parseLocalDateTime(b.dateTime) - parseLocalDateTime(a.dateTime));
            
            updateAccountSelect();
            
            if (currentAccount && accounts.includes(currentAccount)) {
                document.getElementById('accountSelect').value = currentAccount;
            } else if (accounts.length > 0) {
                currentAccount = accounts[0]; 
            } else {
                currentAccount = null;
            }
            
            changeAccount();
            
            showToast('✅ โหลดข้อมูลทุกบัญชีสำเร็จ!', 'success');

            setupRealtimeListener(); 

        } else {
            console.log('No main data found in Firebase');
            showToast('📱 พร้อมใช้งาน (เริ่มต้นใหม่)', 'info');
            setupRealtimeListener(); 
        }
        
    } catch (error) {
        console.error('Error loading:', error);
        showToast('❌ โหลดข้อมูลล้มเหลว ใช้ข้อมูลจากเครื่องแทน', 'error');
        loadFromLocal();
    }
}

/**
 * ตรวจสอบว่ารายการเหมือนกันหรือไม่
 */
function isRecordEqual(rec1, rec2) {
    return rec1.dateTime === rec2.dateTime &&
           rec1.amount === rec2.amount &&
           rec1.description === rec2.description &&
           rec1.type === rec2.type &&
           rec1.account === rec2.account;
}

/**
 * บันทึกข้อมูลไปยัง Firebase
 */
async function saveToFirebase() {
    if (!currentUser || syncInProgress) return;

    const SHARED_ID = 'my_shared_group_01';
    syncInProgress = true;
    updateSyncStatus();

    try {
        const mainDocRef = db.collection('users').doc(SHARED_ID);

        await mainDocRef.set({
            accounts: accounts || [],
            currentAccount: currentAccount || null,
            accountTypes: Object.fromEntries(accountTypes || []),
            backupPassword: backupPassword || null,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });

        const promises = accounts.map(accName => {
            const accDocRef = db
                .collection('users')
                .doc(`${SHARED_ID}_${accName}`);

            const accRecords = records.filter(r => r.account === accName);

            return accDocRef.set({
                accountName: accName,
                records: accRecords,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        await Promise.all(promises);

        lastSyncTime = new Date();
        showToast('☁️ ซิงค์ข้อมูลเรียบร้อย (Real-time)', 'success');

    } catch (err) {
        console.error(err);
        showToast(`❌ Sync ล้มเหลว: ${err.message}`, 'error');
    } finally {
        syncInProgress = false;
        updateSyncStatus();
    }
}

/**
 * ตั้งค่าระบบฟังข้อมูล Real-time
 */
function setupRealtimeListener() {
    if (!currentUser) return;
    
    const SHARED_ID = 'my_shared_group_01';

    console.log('📡 กำลังเริ่มระบบดักฟังข้อมูล Real-time (Multi-account mode)...');

    if (unsubscribeMain) {
        unsubscribeMain();
        unsubscribeMain = null;
    }

    const mainDocRef = db.collection('users').doc(SHARED_ID);
    unsubscribeMain = mainDocRef.onSnapshot((doc) => {
        if (!doc.exists) return;
        const data = doc.data();
        
        const newAccountsList = data.accounts || [];
        const isAccountListChanged = JSON.stringify(accounts) !== JSON.stringify(newAccountsList);

        if (isAccountListChanged) {
            console.log('📋 พบการเปลี่ยนแปลงรายชื่อบัญชี ปรับปรุงข้อมูล...');
            accounts = newAccountsList;
            updateAccountSelect();
            updateMultiAccountSelector();
            updateImportAccountSelect();
            
            setupAccountListeners(SHARED_ID);
        }
        
        if (data.accountTypes) {
             if (Array.isArray(data.accountTypes)) {
                accountTypes = new Map(data.accountTypes);
             } else {
                accountTypes = new Map(Object.entries(data.accountTypes));
             }
        }
    }, (error) => {
        console.error("Main listener error:", error);
    });

    setupAccountListeners(SHARED_ID);
}

/**
 * ตั้งค่าระบบฟังข้อมูลสำหรับแต่ละบัญชี
 */
function setupAccountListeners(SHARED_ID) {
    accounts.forEach(accName => {
        if (!unsubscribeMap[accName]) {
            const accDocId = `${SHARED_ID}_${accName}`;
            console.log(`➕ เริ่มดักฟังบัญชี: ${accName}`);
            
            unsubscribeMap[accName] = db.collection('users').doc(accDocId)
                .onSnapshot((doc) => {
                    if (!doc.exists) return;
                    const data = doc.data();
                    const serverRecords = data.records || [];
                    
                    records = records.filter(r => r.account !== accName);
                    
                    records = records.concat(serverRecords);
                    
                    records.sort((a, b) => parseLocalDateTime(b.dateTime) - parseLocalDateTime(a.dateTime));
                    
                    if (data.lastUpdated) {
                        let remoteTime;
                        if (typeof data.lastUpdated.toDate === 'function') {
                            remoteTime = data.lastUpdated.toDate();
                        } else {
                            remoteTime = new Date(data.lastUpdated);
                        }
                        if (!lastSyncTime || remoteTime > lastSyncTime) {
                            lastSyncTime = remoteTime;
                        }
                    }
                    updateSyncStatus();

                    if (currentAccount === accName) {
                        console.log(`🔄 บัญชีที่เปิดอยู่ (${accName}) มีการเปลี่ยนแปลง รีเฟรชตาราง...`);
                        displayRecords();
                        // ✅ อัปเดตสรุปแต่ละวันเมื่อข้อมูลเปลี่ยนแปลง (เฉพาะข้อมูล ไม่แสดงผล)
                        calculateDailySummaries();
                    } else {
                         console.log(`☁️ บัญชี ${accName} อัปเดตเบื้องหลังเรียบร้อย`);
                    }

                }, (error) => {
                    console.error(`Error listening to ${accName}:`, error);
                });
        }
    });

    Object.keys(unsubscribeMap).forEach(accName => {
        if (!accounts.includes(accName)) {
            console.log(`🛑 ยกเลิกการดักฟังบัญชีที่ถูกลบ: ${accName}`);
            if (unsubscribeMap[accName]) {
                unsubscribeMap[accName]();
                delete unsubscribeMap[accName];
            }
            records = records.filter(r => r.account !== accName);
            displayRecords();
            // ✅ อัปเดตสรุปแต่ละวันเมื่อข้อมูลเปลี่ยนแปลง
            calculateDailySummaries();
        }
    });
}

/**
 * อัปเดตสถานะการซิงค์
 */
function updateSyncStatus() {
    const syncStatus = document.getElementById('sync-status');
    if (!syncStatus) return;
    
    let statusText = '';
    let statusColor = '';
    
    if (!currentUser) {
        statusText = '📴 ออฟไลน์ (ไม่ได้ล็อกอิน)';
        statusColor = '#888';
    } else if (syncInProgress) {
        statusText = '🔄 กำลังซิงค์ข้อมูล...';
        statusColor = '#ff9800';
    } else if (lastSyncTime) {
        const timeAgo = getTimeAgo(lastSyncTime);
        statusText = `☁️ ซิงค์ล่าสุด: ${timeAgo}`;
        statusColor = '#4CAF50';
    } else {
        statusText = '☁️ พร้อมซิงค์';
        statusColor = '#4CAF50';
    }
    
    syncStatus.textContent = statusText;
    syncStatus.style.color = statusColor;
}

/**
 * คำนวณเวลาที่ผ่านมา
 */
function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'ไม่กี่วินาทีที่แล้ว';
    if (diffMins < 60) return `${diffMins} นาทีที่แล้ว`;
    if (diffHours < 24) return `${diffHours} ชั่วโมงที่แล้ว`;
    if (diffDays === 1) return 'เมื่อวานนี้';
    if (diffDays < 7) return `${diffDays} วันที่แล้ว`;
    
    return date.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

/**
 * ลบไฟล์บัญชีออกจาก Firebase
 */
async function deleteAccountFromFirebase(targetAccountName) {
    if (!currentUser) return;
    
    const SHARED_ID = 'my_shared_group_01';
    const docId = `${SHARED_ID}_${targetAccountName}`;
    
    try {
        await db.collection('users').doc(docId).delete();
        console.log(`🔥 ลบไฟล์บัญชี ${targetAccountName} บน Server สำเร็จ`);
    } catch (error) {
        console.error("Error deleting document:", error);
        showToast(`❌ ลบข้อมูลบน Server ไม่สำเร็จ: ${error.message}`, 'error');
    }
}

// ==============================================
// ฟังก์ชันเพิ่ม/แก้ไขรายการ
// ==============================================

/**
 * เพิ่มรายการใหม่หรือแก้ไขรายการที่มีอยู่
 */
async function addEntry() {
    let entryDateInput = document.getElementById('entryDate').value;
    let entryTimeInput = document.getElementById('entryTime').value;
    const typeInput = document.getElementById('type');
    const typeText = typeInput.value.trim();
    const description = document.getElementById('description').value;
    const amount = parseFloat(document.getElementById('amount').value);
    let datePart, timePart;
    
    if (!entryDateInput || !entryTimeInput) {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        datePart = !entryDateInput ? `${y}-${m}-${d}` : entryDateInput;
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        timePart = !entryTimeInput ? `${hh}:${mm}` : entryTimeInput;
    } else {
        datePart = entryDateInput;
        timePart = entryTimeInput;
    }
    
    const dateTime = `${datePart} ${timePart}`;
    
    if (!currentAccount) { showToast("❌ กรุณาเลือกบัญชีก่อนเพิ่มรายการ", 'error'); return; }
    if (!typeText) { showToast("❌ กรุณากรอกประเภท", 'error'); return; }
    if (!description) { showToast("❌ กรุณากรอกรายละเอียด", 'error'); return; }
    if (isNaN(amount) || amount <= 0) { showToast("❌ กรุณากรอกจำนวนเงินที่ถูกต้อง", 'error'); return; }
    
    initializeAccountTypes(currentAccount);
    const types = accountTypes.get(currentAccount);
    let entryCategory = 'expense';
    if (types["รายรับ"].includes(typeText)) {
        entryCategory = 'income';
    }

    const userEmail = getCurrentUserIdentifier();
    const timestamp = new Date().toISOString();
    
    const transactionPromises = [];

    if (editingIndex !== null) {
        const originalRecord = JSON.parse(JSON.stringify(records[editingIndex]));
        
        const updatedRecord = { 
            dateTime, 
            type: typeText, 
            description, 
            amount, 
            account: currentAccount,
            createdBy: originalRecord.createdBy || 'Unknown', 
            createdTime: originalRecord.createdTime || timestamp, 
            editedBy: userEmail,
            editedTime: timestamp
        };

        records[editingIndex] = updatedRecord;
        editingIndex = null;
        
        if (currentUser) {
            transactionPromises.push(editTransactionRealtime(originalRecord, updatedRecord));
        }

        showToast(`✓ แก้ไขข้อมูลเรียบร้อย (กำลังอัปเดต Server...)`, 'info');

    } else {
        const newRecord = { 
            dateTime, 
            type: typeText, 
            description, 
            amount, 
            account: currentAccount,
            createdBy: userEmail,
            createdTime: timestamp,
            editedBy: null,
            editedTime: null
        };
        
        records.push(newRecord);
        if (currentUser) {
            transactionPromises.push(addTransactionRealtime(newRecord));
        }

        const selectedCheckboxes = document.querySelectorAll('#multiAccountCheckboxes input:checked');
        selectedCheckboxes.forEach(checkbox => {
            const targetAccount = checkbox.value;
            const clonedRecord = JSON.parse(JSON.stringify(newRecord));
            clonedRecord.account = targetAccount;
            
            records.push(clonedRecord);
            
            if (currentUser) {
                transactionPromises.push(addTransactionRealtime(clonedRecord));
            }
        });
        
        showToast(`✓ เพิ่มข้อมูลในเครื่องแล้ว (กำลังส่งขึ้น Server...)`, 'info');
    }
    
    displayRecords();
    // ✅ อัปเดตสรุปแต่ละวันเมื่อเพิ่มข้อมูล (เฉพาะข้อมูล ไม่แสดงผล)
    calculateDailySummaries();
    
    document.getElementById('description').value = '';
    document.getElementById('amount').value = '';
    
    // รีเซ็ต flags manual สำหรับวันที่และเวลา
    const dateInput = document.getElementById('entryDate');
    const timeInput = document.getElementById('entryTime');
    if (dateInput) dateInput.dataset.manual = "false";
    if (timeInput) timeInput.dataset.manual = "false";
    setCurrentDateTime();
    
    typeInput.value = '';
    document.querySelectorAll('#multiAccountCheckboxes input:checked').forEach(checkbox => {
        checkbox.checked = false;
    });
    updateMultiAccountSelector();

    saveToLocal(); 
    
    if (currentUser && transactionPromises.length > 0) {
        try {
            await Promise.all(transactionPromises);
            
            if (entryCategory === 'income') {
                showToast('✅ ซิงค์รายรับออนไลน์เสร็จสมบูรณ์', 'success');
            } else {
                showToast('✅ ซิงค์รายจ่ายออนไลน์เสร็จสมบูรณ์', 'success');
            }
        } catch (error) {
            console.error(error);
            showToast('❌ ซิงค์ออนไลน์ขัดข้อง (ข้อมูลถูกบันทึกในเครื่องแล้ว)', 'error');
            await saveToFirebase();
        }
    }
}

// ==============================================
// ฟังก์ชันจัดการบัญชี
// ==============================================

/**
 * เพิ่มบัญชีใหม่
 */
async function addAccount() { 
    const accountName = prompt("กรุณากรอกชื่อบัญชีใหม่:");
    if (accountName && !accounts.includes(accountName)) { 
        accounts.push(accountName); 
        updateAccountSelect(); 
        updateMultiAccountSelector(); 
        
        saveToLocal();
        if (currentUser) {
            showToast('⏳ กำลังสร้างบัญชีใหม่บน Server...', 'info');
            try {
                await saveToFirebase();
                showToast(`✓ สร้างบัญชี "${accountName}" บน Server สำเร็จ`, 'success');
            } catch (error) {
                showToast(`❌ สร้างบัญชีออนไลน์ไม่สำเร็จ (แต่บันทึกในเครื่องแล้ว)`, 'warning');
            }
        } else {
            showToast(`✓ เพิ่มบัญชี "${accountName}" สำเร็จ`, 'success');
        }
    } else { 
        showToast("❌ ชื่อบัญชีซ้ำหรือกรอกข้อมูลไม่ถูกต้อง", 'error'); 
    } 
}

/**
 * อัปเดตตัวเลือกบัญชี
 */
function updateAccountSelect() { 
    const accountSelect = document.getElementById('accountSelect'); 
    accountSelect.innerHTML = '<option value="">เลือกบัญชี</option>'; 
    accounts.forEach(account => { 
        const option = document.createElement('option'); 
        option.value = account; 
        option.textContent = account; 
        accountSelect.appendChild(option); 
    }); 
}

/**
 * เปลี่ยนบัญชีที่เลือก
 */
function changeAccount() {
    currentAccount = document.getElementById('accountSelect').value;
    document.getElementById('accountName').textContent = currentAccount || "";
    
    updateTypeList();
    displayRecords();
    updateMultiAccountSelector();
    updateImportAccountSelect();
    // ✅ คำนวณและแสดงสรุปแต่ละวันสำหรับบัญชีที่เลือก (เฉพาะข้อมูล ไม่แสดงผล)
    calculateDailySummaries();
    
    if (currentAccount) {
        const accountRecords = records.filter(record => record.account === currentAccount);
        console.log(`Loaded ${accountRecords.length} records for account: ${currentAccount}`);
        showToast(`📂 โหลดข้อมูลบัญชี "${currentAccount}" สำเร็จ (${accountRecords.length} รายการ)`, 'success');
        
    }
    
    if (currentUser) {
        saveToFirebase();
    }
}

/**
 * แก้ไขชื่อบัญชี
 */
async function editAccount() { 
    if (!currentAccount) { 
        showToast("❌ กรุณาเลือกบัญชีที่ต้องการแก้ไข", 'error'); 
        return; 
    } 
    
    const newAccountName = prompt("กรุณากรอกชื่อบัญชีใหม่:", currentAccount); 
    
    if (newAccountName && newAccountName !== currentAccount && !accounts.includes(newAccountName)) { 
        const oldAccountName = currentAccount; 
        
        if (currentUser) {
            showToast('⏳ กำลังเปลี่ยนชื่อบัญชีบน Server...', 'info');
            await deleteAccountFromFirebase(oldAccountName);
        }
        
        const index = accounts.indexOf(oldAccountName); 
        if (index > -1) { 
            accounts[index] = newAccountName; 
            
            records.forEach(record => { 
                if (record.account === oldAccountName) { 
                    record.account = newAccountName; 
                } 
            }); 
            
            if (accountTypes.has(oldAccountName)) { 
                const oldTypes = accountTypes.get(oldAccountName); 
                accountTypes.set(newAccountName, oldTypes); 
                accountTypes.delete(oldAccountName); 
            } 
            
            currentAccount = newAccountName; 
            
            updateAccountSelect(); 
            document.getElementById('accountSelect').value = newAccountName; 
            document.getElementById('accountName').textContent = currentAccount; 
            displayRecords(); 
            updateMultiAccountSelector(); 
            // ✅ อัปเดตสรุปแต่ละวันเมื่อเปลี่ยนชื่อบัญชี (เฉพาะข้อมูล ไม่แสดงผล)
            calculateDailySummaries();
            
            showToast(`✓ แก้ไขชื่อบัญชีเป็น "${newAccountName}" สำเร็จ`, 'success'); 
            
            saveToLocal();
            if (currentUser) {
                await saveToFirebase();
            }
        } 
    } else if (accounts.includes(newAccountName)) {
        showToast("❌ ชื่อบัญชีนี้มีอยู่แล้ว", 'error'); 
    } else { 
        showToast("❌ ยกเลิกการแก้ไขหรือข้อมูลไม่ถูกต้อง", 'error'); 
    } 
}

/**
 * ลบบัญชี
 */
async function deleteAccount() { 
    if (currentAccount) { 
        const confirmDelete = confirm(`คุณแน่ใจว่าจะลบบัญชี "${currentAccount}" และข้อมูลทั้งหมดในบัญชีนี้หรือไม่?`); 
        
        if (confirmDelete) { 
            const accountToDelete = currentAccount; 
            
            if (currentUser) {
                showToast('⏳ กำลังลบข้อมูลออกจาก Server...', 'info');
                await deleteAccountFromFirebase(accountToDelete);
            }

            const index = accounts.indexOf(accountToDelete); 
            if (index > -1) { 
                accounts.splice(index, 1); 
            } 
            accountTypes.delete(accountToDelete); 
            records = records.filter(rec => rec.account !== accountToDelete); 
            
            currentAccount = null; 
            document.getElementById('accountSelect').value = ""; 
            document.getElementById('accountName').textContent = ""; 
            
            updateAccountSelect(); 
            displayRecords(); 
            updateMultiAccountSelector(); 
            // ✅ อัปเดตสรุปแต่ละวันเมื่อลบบัญชี (เฉพาะข้อมูล ไม่แสดงผล)
            calculateDailySummaries();
            
            showToast(`✓ ลบบัญชี "${accountToDelete}" สำเร็จ`, 'success'); 
            
            saveToLocal();
            if (currentUser) {
                await saveToFirebase();
            }
        } 
    } else { 
        showToast("❌ กรุณาเลือกบัญชีที่ต้องการลบ", 'error'); 
    } 
}

// ==============================================
// ฟังก์ชันจัดการประเภท
// ==============================================

/**
 * เริ่มต้นข้อมูลประเภทสำหรับบัญชี
 */
function initializeAccountTypes(accountName) { 
    if (!accountTypes.has(accountName)) { 
        accountTypes.set(accountName, { 
            "รายรับ": ["ถูกหวย", "เติมทุน"], 
            "รายจ่าย": ["ชื้อหวย", "โอนกำไร", "ชื้อกับข้าว"] 
        }); 
    } 
}

/**
 * อัปเดตรายการประเภท
 */
function updateTypeList() { 
    const typeList = document.getElementById('typeList'); 
    const typeInput = document.getElementById('type');
    
    if (!currentAccount) { 
        typeList.innerHTML = ''; 
        typeInput.value = '';
        return; 
    } 
    
    initializeAccountTypes(currentAccount); 
    const types = accountTypes.get(currentAccount); 
    typeList.innerHTML = ''; 
    
    types["รายจ่าย"].forEach(type => { 
        const option = document.createElement('option'); 
        option.value = type; 
        option.textContent = type; 
        typeList.appendChild(option); 
    }); 
    
    types["รายรับ"].forEach(type => { 
        const option = document.createElement('option'); 
        option.value = type; 
        option.textContent = type; 
        typeList.appendChild(option); 
    }); 
    
    console.log('อัพเดทรายการประเภทเรียบร้อย:', types);
}

/**
 * แสดงประเภททั้งหมด
 */
function showAllTypes(inputElement) { 
    tempTypeValue = inputElement.value; 
    inputElement.value = ''; 
}

/**
 * คืนค่าประเภทเดิม
 */
function restoreType(inputElement) { 
    if (inputElement.value === '') { 
        inputElement.value = tempTypeValue; 
    } 
}

/**
 * เพิ่มประเภทใหม่
 */
async function addNewType() { 
    if (!currentAccount) { showToast("❌ กรุณาเลือกบัญชีก่อนเพิ่มประเภท", 'error'); return; } 
    
    initializeAccountTypes(currentAccount); 
    const types = accountTypes.get(currentAccount); 
    
    const typeName = prompt("กรุณากรอกชื่อประเภทใหม่:"); 
    if (!typeName || typeName.trim() === '') { showToast("❌ กรุณากรอกชื่อประเภท", 'error'); return; }
    
    const category = prompt("เลือกหมวดหมู่ที่จะเพิ่ม (รายรับ/รายจ่าย):"); 
    if (category !== "รายรับ" && category !== "รายจ่าย") { showToast("❌ กรุณากรอก 'รายรับ' หรือ 'รายจ่าย' เท่านั้น", 'error'); return; } 
    
    const trimmedTypeName = typeName.trim();
    if (types[category].includes(trimmedTypeName)) { showToast(`❌ ประเภท "${trimmedTypeName}" มีอยู่แล้ว`, 'error'); return; } 
    
    types[category].push(trimmedTypeName); 
    updateTypeList(); 
    document.getElementById('type').value = trimmedTypeName;
    
    saveToLocal();
    if (currentUser) {
        showToast('⏳ กำลังบันทึกประเภทใหม่...', 'info');
        await saveToFirebase();
        showToast(`✓ เพิ่มประเภท "${trimmedTypeName}" บน Server สำเร็จ`, 'success');
    } else {
        showToast(`✓ เพิ่มประเภทสำเร็จ`, 'success');
    }
}

/**
 * แก้ไขประเภท
 */
function editType() { 
    if (!currentAccount) { 
        showToast("❌ กรุณาเลือกบัญชีก่อนแก้ไขประเภท", 'error'); 
        return; 
    } 
    
    initializeAccountTypes(currentAccount); 
    const types = accountTypes.get(currentAccount); 
    const typeInput = document.getElementById('type'); 
    const currentType = typeInput.value.trim(); 
    
    if (!currentType) { 
        showToast("❌ กรุณาเลือกหรือพิมพ์ประเภทที่ต้องการแก้ไข", 'error'); 
        return; 
    } 
    
    let foundCategory = null; 
    for (const category in types) { 
        if (types[category].includes(currentType)) { 
            foundCategory = category; 
            break; 
        } 
    } 
    
    if (!foundCategory) { 
        showToast("❌ ไม่พบประเภทที่ต้องการแก้ไข", 'error'); 
        return; 
    } 
    
    showEditTypeModal(currentType, foundCategory);
}

/**
 * แสดงโมดอลแก้ไขประเภท
 */
function showEditTypeModal(currentType, currentCategory) {
    const modalHTML = `
        <div id="editTypeModal" class="modal-overlay" style="display: flex;">
            <div class="format-modal-content">
                <h3>แก้ไขประเภท: "${currentType}"</h3>
                <div class="entry-form" style="margin-bottom: 20px;">
                    <div class="entry-group">
                        <label for="editTypeName">ชื่อประเภทใหม่:</label>
                        <input type="text" id="editTypeName" value="${currentType}" required>
                    </div>
                    <div class="entry-group">
                        <label for="editTypeCategory">หมวดหมู่:</label>
                        <select id="editTypeCategory" required>
                            <option value="รายรับ" ${currentCategory === 'รายรับ' ? 'selected' : ''}>รายรับ</option>
                            <option value="รายจ่าย" ${currentCategory === 'รายจ่าย' ? 'selected' : ''}>รายจ่าย</option>
                        </select>
                    </div>
                </div>
                <div class="format-modal-buttons">
                    <button onclick="processTypeEdit('${currentType}', '${currentCategory}')" style="background-color: #28a745;">บันทึกการแก้ไข</button>
                    <button onclick="closeEditTypeModal()" class="btn-cancel">ยกเลิก</button>
                </div>
            </div>
        </div>
    `;
    
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHTML;
    document.body.appendChild(modalContainer);
}

/**
 * ปิดโมดอลแก้ไขประเภท
 */
function closeEditTypeModal() {
    const modal = document.getElementById('editTypeModal');
    if (modal) {
        modal.remove();
    }
}

/**
 * ประมวลผลการแก้ไขประเภท
 */
async function processTypeEdit(oldType, oldCategory) {
    const newTypeName = document.getElementById('editTypeName').value.trim();
    const newCategory = document.getElementById('editTypeCategory').value;
    
    if (!newTypeName) { showToast("❌ กรุณากรอกชื่อประเภทใหม่", 'error'); return; }
    
    if (newTypeName === oldType && newCategory === oldCategory) {
        showToast("❌ ไม่มีการเปลี่ยนแปลงใดๆ", 'warning');
        closeEditTypeModal();
        return;
    }
    
    initializeAccountTypes(currentAccount);
    const types = accountTypes.get(currentAccount);
    
    if (newTypeName !== oldType) {
        for (const category in types) {
            if (types[category].includes(newTypeName)) {
                showToast(`❌ มีประเภท "${newTypeName}" อยู่แล้ว`, 'error');
                return;
            }
        }
    }
    
    const oldIndex = types[oldCategory].indexOf(oldType);
    if (oldIndex > -1) {
        types[oldCategory].splice(oldIndex, 1);
        if (!types[newCategory]) { types[newCategory] = []; }
        types[newCategory].push(newTypeName);
        
        updateRecordsType(oldType, newTypeName, newCategory);
        updateTypeList();
        document.getElementById('type').value = newTypeName;
        
        closeEditTypeModal();

        saveToLocal();
        if (currentUser) {
            showToast('⏳ กำลังอัปเดตประเภทบน Server...', 'info');
            await saveToFirebase();
            showToast(`✓ แก้ไขประเภทสำเร็จและซิงค์แล้ว`, 'success');
        } else {
            showToast(`✓ แก้ไขประเภทสำเร็จ`, 'success');
        }
    }
}

/**
 * อัปเดตประเภทในข้อมูลที่บันทึกไว้
 */
function updateRecordsType(oldType, newType, newCategory) {
    let updatedCount = 0;
    
    records.forEach(record => { 
        if (record.account === currentAccount && record.type === oldType) { 
            record.type = newType;
            updatedCount++;
        } 
    });
    
    console.log(`✅ อัพเดทประเภทใน ${updatedCount} รายการ`);
    
    if (updatedCount > 0) {
        displayRecords();
        // ✅ อัปเดตสรุปแต่ละวันเมื่อข้อมูลเปลี่ยนแปลง (เฉพาะข้อมูล ไม่แสดงผล)
        calculateDailySummaries();
        showToast(`✓ อัพเดทประเภทใน ${updatedCount} รายการที่บันทึกไว้`, 'info');
    }
}

/**
 * ลบประเภท
 */
async function deleteType() { 
    if (!currentAccount) { showToast("❌ กรุณาเลือกบัญชี", 'error'); return; } 
    
    initializeAccountTypes(currentAccount); 
    const types = accountTypes.get(currentAccount); 
    const typeInput = document.getElementById('type'); 
    const currentType = typeInput.value.trim(); 
    
    if (!currentType) { showToast("❌ กรุณาเลือกประเภท", 'error'); return; } 
    
    let foundCategory = null; 
    for (const category in types) { 
        if (types[category].includes(currentType)) { foundCategory = category; break; } 
    } 
    
    if (!foundCategory) { showToast("❌ ไม่พบประเภท", 'error'); return; } 
    
    const recordsToDelete = records.filter(record => record.account === currentAccount && record.type === currentType);
    
    if (recordsToDelete.length > 0) {
        const confirmDelete = confirm(`ยืนยันลบประเภท "${currentType}" และ ${recordsToDelete.length} รายการที่เกี่ยวข้อง?`); 
        if (!confirmDelete) return;
        deleteRecordsByType(currentType);
    } else {
        const confirmDelete = confirm(`ยืนยันลบประเภท "${currentType}"?`); 
        if (!confirmDelete) return;
    }
    
    const index = types[foundCategory].indexOf(currentType);
    types[foundCategory].splice(index, 1);
    
    updateTypeList(); 
    typeInput.value = ''; 
    
    saveToLocal();
    if (currentUser) {
        showToast('⏳ กำลังลบประเภทบน Server...', 'info');
        await saveToFirebase();
        showToast(`✓ ลบประเภทบน Server สำเร็จ`, 'success');
    } else {
        showToast(`✓ ลบประเภทสำเร็จ`, 'success');
    }
}

/**
 * แสดงหน้าจัดการประเภท
 */
function showTypeManagement() {
    if (!currentAccount) {
        showToast("❌ กรุณาเลือกบัญชีก่อน", 'error');
        return;
    }
    
    initializeAccountTypes(currentAccount);
    const types = accountTypes.get(currentAccount);
    
    let typeListHTML = `
        <h3>จัดการประเภท - บัญชี: ${currentAccount}</h3>
        <div style="display: flex; gap: 20px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px;">
                <h4>รายรับ</h4>
                <ul id="incomeTypesList" style="min-height: 100px; border: 1px solid #ccc; padding: 10px; list-style: none;">
    `;
    
    types["รายรับ"].forEach(type => {
        typeListHTML += `
            <li style="padding: 5px; margin: 2px 0; display: flex; justify-content: space-between; align-items: center;">
                <span>${type}</span>
                <div>
                    <button onclick="quickEditType('รายรับ', '${type}')" style="background-color: #ffc107; padding: 2px 8px; font-size: 12px;">แก้ไข</button>
                    <button onclick="quickDeleteType('รายรับ', '${type}')" style="background-color: #dc3545; padding: 2px 8px; font-size: 12px;">ลบ</button>
                </div>
            </li>`;
    });
    
    typeListHTML += `
                </ul>
                <button onclick="quickAddType('รายรับ')" style="width: 100%; margin-top: 5px;">➕ เพิ่มรายรับ</button>
            </div>
            <div style="flex: 1; min-width: 200px;">
                <h4>รายจ่าย</h4>
                <ul id="expenseTypesList" style="min-height: 100px; border: 1px solid #ccc; padding: 10px; list-style: none;">
    `;
    
    types["รายจ่าย"].forEach(type => {
        typeListHTML += `
            <li style="padding: 5px; margin: 2px 0; display: flex; justify-content: space-between; align-items: center;">
                <span>${type}</span>
                <div>
                    <button onclick="quickEditType('รายจ่าย', '${type}')" style="background-color: #ffc107; padding: 2px 8px; font-size: 12px;">แก้ไข</button>
                    <button onclick="quickDeleteType('รายจ่าย', '${type}')" style="background-color: #dc3545; padding: 2px 8px; font-size: 12px;">ลบ</button>
                </div>
            </li>`;
    });
    
    typeListHTML += `
                </ul>
                <button onclick="quickAddType('รายจ่าย')" style="width: 100%; margin-top: 5px;">➕ เพิ่มรายจ่าย</button>
            </div>
        </div>
    `;
    
    openSummaryModal(typeListHTML);
}

/**
 * แก้ไขประเภทแบบเร็ว
 */
function quickEditType(category, typeName) {
    showEditTypeModal(typeName, category);
}

/**
 * เพิ่มประเภทแบบเร็ว
 */
async function quickAddType(category) {
    const typeName = prompt(`กรุณากรอกชื่อประเภท${category}:`);
    if (!typeName || typeName.trim() === '') return;
    
    const trimmedTypeName = typeName.trim();
    initializeAccountTypes(currentAccount);
    const types = accountTypes.get(currentAccount);
    
    if (types[category].includes(trimmedTypeName)) {
        showToast("❌ ประเภทนี้มีอยู่แล้ว", 'error');
        return;
    }
    
    types[category].push(trimmedTypeName);
    updateTypeList();
    
    saveToLocal();
    if (currentUser) {
        await saveToFirebase();
    }
    showToast(`✓ เพิ่มประเภทสำเร็จ`, 'success');
    showTypeManagement();
}

/**
 * ลบประเภทแบบเร็ว
 */
async function quickDeleteType(category, typeName) {
    const recordsToDelete = records.filter(record => record.account === currentAccount && record.type === typeName);
    let confirmMessage = recordsToDelete.length > 0 ? 
        `ลบประเภท "${typeName}" และ ${recordsToDelete.length} รายการที่เกี่ยวข้อง?` : 
        `ลบประเภท "${typeName}"?`;

    if (!confirm(confirmMessage)) return;
    
    initializeAccountTypes(currentAccount);
    const types = accountTypes.get(currentAccount);
    const index = types[category].indexOf(typeName);
    
    if (index > -1) {
        if (recordsToDelete.length > 0) { deleteRecordsByType(typeName); }
        types[category].splice(index, 1);
        updateTypeList();
        
        saveToLocal();
        if (currentUser) {
            showToast('⏳ กำลังอัปเดต Server...', 'info');
            await saveToFirebase();
            showToast('✓ ลบเรียบร้อย', 'success');
        }
        showTypeManagement();
    }
}

/**
 * ลบข้อมูลที่บันทึกไว้ตามประเภท
 */
function deleteRecordsByType(typeToDelete) {
    let deletedCount = 0;
    
    const recordsToDeleteCount = records.filter(record => 
        record.account === currentAccount && record.type === typeToDelete
    ).length;
    
    records = records.filter(record => 
        !(record.account === currentAccount && record.type === typeToDelete)
    );
    
    deletedCount = recordsToDeleteCount;
    
    console.log(`🗑️ ลบ ${deletedCount} รายการที่ใช้ประเภท "${typeToDelete}"`);
    
    if (deletedCount > 0) {
        displayRecords();
        // ✅ อัปเดตสรุปแต่ละวันเมื่อข้อมูลเปลี่ยนแปลง (เฉพาะข้อมูล ไม่แสดงผล)
        calculateDailySummaries();
        showToast(`🗑️ ลบ ${deletedCount} รายการที่ใช้ประเภท "${typeToDelete}" ออกแล้ว`, 'info');
    }
    
    return deletedCount;
}

// ==============================================
// ฟังก์ชันจัดการรายการ
// ==============================================

/**
 * แสดงรายการในตาราง
 */
function displayRecords() { 
    const recordBody = document.getElementById('recordBody'); 
    
    const theadRow = document.querySelector('#recordTable thead tr');
    if (theadRow && theadRow.children.length === 6) {
        const thUser = document.createElement('th');
        thUser.textContent = 'ผู้บันทึก/แก้ไข';
        
        thUser.style.padding = '8px';
        thUser.style.border = '1px solid #ddd';
        thUser.style.textAlign = 'center';
        thUser.style.width = '15%'; 
        
        theadRow.insertBefore(thUser, theadRow.lastElementChild);
    } else if (theadRow && theadRow.children.length === 5) {
         theadRow.innerHTML = `
            <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">📅 วันเดือนปี</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">⏰ เวลา</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">📊 ประเภท</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">📄 รายละเอียด</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">💰 จำนวนเงิน</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">ผู้บันทึก/แก้ไข</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">🔧 การจัดการ</th>
         `;
    }

    recordBody.innerHTML = ""; 
    const filteredRecords = records.filter(record => record.account === currentAccount) 
    .sort((a, b) => parseLocalDateTime(b.dateTime) - parseLocalDateTime(a.dateTime)); 
    
    filteredRecords.forEach((record, index) => { 
        const originalIndex = records.findIndex(r => r === record); 
        const { formattedDate, formattedTime } = formatDateForDisplay(record.dateTime);
        
        let auditInfo = `<span style="font-size: 11px; color: #666;">สร้าง: ${record.createdBy || '-'}</span>`;
        
        if (record.editedBy) {
            auditInfo += `<br><span style="font-size: 11px; color: #d9534f;">แก้ไข: ${record.editedBy}</span>`;
        }

        const row = document.createElement('tr'); 
        row.innerHTML = ` 
        <td>${formattedDate}</td> 
        <td>${formattedTime}</td> 
        <td>${record.type}</td> 
        <td>${record.description}</td> 
        <td>${record.amount.toLocaleString()} บาท</td> 
        <td style="line-height: 1.2; text-align: center;">${auditInfo}</td>
        <td> 
        <button onclick="editRecord(${originalIndex})">แก้ไข</button> 
        <button onclick="deleteRecord(${originalIndex})">ลบ</button> 
        </td> 
        `; 
        recordBody.appendChild(row); 
    }); 
    
    if (filteredRecords.length === 0) { 
        const row = document.createElement('tr'); 
        row.innerHTML = `<td colspan="7" style="text-align: center;">ไม่มีข้อมูล</td>`; 
        recordBody.appendChild(row); 
    } 
}

/**
 * แก้ไขรายการ
 */
function editRecord(index) {
    const record = records[index];
    document.getElementById('type').value = record.type;
    document.getElementById('description').value = record.description;
    document.getElementById('amount').value = record.amount;
    const [datePart, timePart] = record.dateTime.split(' ');
    document.getElementById('entryDate').value = datePart;
    document.getElementById('entryTime').value = timePart;
    
    // เมื่อแก้ไขรายการ ให้หยุด Real-time clock สำหรับช่องนี้
    const dateInput = document.getElementById('entryDate');
    const timeInput = document.getElementById('entryTime');
    if (dateInput) dateInput.dataset.manual = "true";
    if (timeInput) timeInput.dataset.manual = "true";
    
    editingIndex = index;
    updateMultiAccountSelector();
    showToast("📝 กำลังแก้ไขรายการ...", 'info');
}

/**
 * ลบรายการ
 */
async function deleteRecord(index) { 
    if (!confirm('ยืนยันลบรายการนี้?')) return;

    const record = records[index];

    records.splice(index, 1);
    displayRecords();
    // ✅ อัปเดตสรุปแต่ละวันเมื่อข้อมูลเปลี่ยนแปลง (เฉพาะข้อมูล ไม่แสดงผล)
    calculateDailySummaries();

    await deleteRecordRealtime(record);
}

/**
 * สลับการแสดง/ซ่อนรายการ
 */
function toggleRecordsVisibility() { 
    const detailsSection = document.getElementById('detailsSection'); 
    if (detailsSection.style.display === 'none' || detailsSection.style.display === '') { 
        detailsSection.style.display = 'block'; 
        showToast("📋 แสดงรายการทั้งหมดเรียบร้อย", 'success');
    } else { 
        detailsSection.style.display = 'none'; 
        showToast("📋 ซ่อนรายการทั้งหมดเรียบร้อย", 'info');
    } 
}

/**
 * ลบข้อมูลตามวันที่
 */
async function deleteRecordsByDate() {
    const dateInput = document.getElementById('deleteByDateInput');
    const selectedDate = dateInput.value;
    if (!currentAccount) { showToast("❌ กรุณาเลือกบัญชีที่ต้องการลบข้อมูลก่อน", 'error'); return; }
    if (!selectedDate) { showToast("❌ กรุณาเลือกวันที่ที่ต้องการลบข้อมูล", 'error'); return; }
    
    const recordsToDelete = records.filter(record => {
        if (record.account !== currentAccount) return false;
        const recordDateOnly = record.dateTime.split(' ')[0];
        return recordDateOnly === selectedDate;
    });
    
    if (recordsToDelete.length === 0) {
        showToast(`❌ ไม่พบข้อมูลในบัญชี "${currentAccount}" ของวันที่ ${selectedDate}`, 'error');
        return;
    }
    
    const confirmDelete = confirm(
        `คุณแน่ใจหรือไม่ว่าจะลบข้อมูลทั้งหมด ${recordsToDelete.length} รายการ ของวันที่ ${selectedDate}?\n\n*** การกระทำนี้ไม่สามารถย้อนกลับได้! ***`
    );
    
    if (confirmDelete) {
        records = records.filter(record => !recordsToDelete.includes(record));
        
        displayRecords();
        // ✅ อัปเดตสรุปแต่ละวันเมื่อข้อมูลเปลี่ยนแปลง (เฉพาะข้อมูล ไม่แสดงผล)
        calculateDailySummaries();
        dateInput.value = ''; 

        saveToLocal();
        
        if (currentUser) {
            showToast(`🗑️ กำลังลบข้อมูล ${recordsToDelete.length} รายการ บน Server...`, 'info');
            try {
                await saveToFirebase();
                showToast(`✅ ลบข้อมูลวันที่ ${selectedDate} บน Server สำเร็จ`, 'success');
            } catch (error) {
                showToast(`❌ ลบออนไลน์ขัดข้อง`, 'error');
            }
        } else {
            showToast(`✓ ลบข้อมูลสำเร็จ`, 'success');
        }
    }
}

// ==============================================
// ฟังก์ชันจัดการบัญชีหลายบัญชี
// ==============================================

/**
 * อัปเดตตัวเลือกบัญชีหลายบัญชี
 */
function updateMultiAccountSelector() { 
    const selectorDiv = document.getElementById('multiAccountSelector'); 
    const checkboxesDiv = document.getElementById('multiAccountCheckboxes'); 
    checkboxesDiv.innerHTML = ''; 
    if (accounts.length > 1 && editingIndex === null) { 
        selectorDiv.style.display = 'block'; 
        accounts.forEach(acc => { 
            if (acc !== currentAccount) { 
                const itemDiv = document.createElement('div'); 
                itemDiv.className = 'checkbox-item'; 
                const checkbox = document.createElement('input'); 
                checkbox.type = 'checkbox'; 
                checkbox.id = `acc-check-${acc}`; 
                checkbox.value = acc; 
                const label = document.createElement('label'); 
                label.htmlFor = `acc-check-${acc}`; 
                label.textContent = acc; 
                itemDiv.appendChild(checkbox); 
                itemDiv.appendChild(label); 
                checkboxesDiv.appendChild(itemDiv); 
            } 
        }); 
    } else { 
        selectorDiv.style.display = 'none'; 
    } 
}

// ==============================================
// ฟังก์ชันนำเข้าข้อมูลจากบัญชีอื่น
// ==============================================

/**
 * อัปเดตตัวเลือกบัญชีสำหรับนำเข้า
 */
function updateImportAccountSelect() {
    const importSelect = document.getElementById('importAccountSelect');
    const importButton = document.querySelector('#import-from-account-section button');
    importSelect.innerHTML = '';
    const otherAccounts = accounts.filter(acc => acc !== currentAccount);
    
    if (otherAccounts.length === 0 || !currentAccount) {
        importSelect.innerHTML = '<option value="">ไม่มีบัญชีอื่นให้เลือก</option>';
        importSelect.disabled = true;
        if (importButton) importButton.disabled = true;
    } else {
        importSelect.disabled = false;
        if (importButton) importButton.disabled = false;
        importSelect.innerHTML = '<option value="">-- เลือกบัญชี --</option>';
        otherAccounts.forEach(acc => {
            const option = document.createElement('option');
            option.value = acc;
            option.textContent = acc;
            importSelect.appendChild(option);
        });
    }
}

/**
 * นำเข้ารายการจากบัญชีอื่น
 */
async function importEntriesFromAccount() {
    const sourceAccount = document.getElementById('importAccountSelect').value;
    const importDateStr = document.getElementById('importDate').value;

    if (!currentAccount) {
        showToast("❌ กรุณาเลือกบัญชีปัจจุบัน (บัญชีปลายทาง) ก่อน", 'error');
        return;
    }
    if (!sourceAccount) {
        showToast("❌ กรุณาเลือกบัญชีต้นทางที่ต้องการดึงข้อมูล", 'error');
        return;
    }
    if (!importDateStr) {
        showToast("❌ กรุณาเลือกวันที่ของข้อมูลที่ต้องการดึง", 'error');
        return;
    }

    const recordsToImport = records.filter(record => {
        return record.account === sourceAccount && record.dateTime.startsWith(importDateStr);
    });

    if (recordsToImport.length === 0) {
        showToast(`❌ ไม่พบข้อมูลในบัญชี "${sourceAccount}" ของวันที่ ${importDateStr}`, 'error');
        return;
    }

    const confirmImport = confirm(`พบ ${recordsToImport.length} รายการในบัญชี "${sourceAccount}" ของวันที่ ${importDateStr}\n\nคุณต้องการคัดลอกรายการทั้งหมดมายังบัญชี "${currentAccount}" หรือไม่? (ข้อมูลซ้ำจะถูกข้าม)`);

    if (confirmImport) {
        let importedCount = 0;
        let skippedCount = 0;
        
        recordsToImport.forEach(recordToAdd => {
            const isDuplicate = records.some(existingRecord => 
                existingRecord.account === currentAccount &&
                existingRecord.dateTime === recordToAdd.dateTime &&
                existingRecord.amount === recordToAdd.amount &&
                existingRecord.description === recordToAdd.description &&
                existingRecord.type === recordToAdd.type
            );
            if (!isDuplicate) {
                const newEntry = { ...recordToAdd, account: currentAccount };
                records.push(newEntry);
                importedCount++;
            } else {
                skippedCount++;
            }
        });
        
        displayRecords();
        // ✅ อัปเดตสรุปแต่ละวันเมื่อข้อมูลเปลี่ยนแปลง (เฉพาะข้อมูล ไม่แสดงผล)
        calculateDailySummaries();
        saveToLocal();
        
        if (currentUser) {
            showToast('☁️ กำลังอัปเดตข้อมูลออนไลน์...', 'info');
            try {
                await saveToFirebase();
            } catch (err) {
                console.error("Auto-sync failed:", err);
            }
        }

        showToast(`✓ คัดลอกข้อมูลสำเร็จ! เพิ่ม ${importedCount} รายการใหม่, ข้าม ${skippedCount} รายการที่ซ้ำซ้อน`, 'success');
    }
}

// ==============================================
// ฟังก์ชันจัดการข้อมูลสรุป (หลัก)
// ==============================================

/**
 * สร้างข้อมูลสรุป
 */
function generateSummaryData(startDate, endDate) {
    if (!currentAccount) { 
        console.error("❌ ไม่มีบัญชีปัจจุบันในการสรุปข้อมูล");
        showToast("❌ ไม่พบบัญชีที่เลือก", 'error'); 
        return null; 
    }
    
    if (!accountTypes.has(currentAccount)) {
        console.log(`⚠️ สร้างประเภทบัญชีใหม่สำหรับ: ${currentAccount}`);
        initializeAccountTypes(currentAccount);
    }
    
    const summary = { 
        income: {}, 
        expense: {}, 
        totalIncome: 0, 
        totalExpense: 0, 
        incomeCount: 0, 
        expenseCount: 0 
    };
    
    const periodRecords = []; 
    let totalBalance = 0; 
    const accountSpecificTypes = accountTypes.get(currentAccount);
    
    console.log(`🔍 เริ่มสรุปข้อมูลสำหรับบัญชี: ${currentAccount}`);
    console.log(`📅 ช่วงวันที่: ${startDate} ถึง ${endDate}`);
    
    records.forEach(record => {
        if (record.account !== currentAccount) return;
        
        const recordDate = parseLocalDateTime(record.dateTime);
        if (recordDate <= endDate) {
            if (accountSpecificTypes["รายรับ"].includes(record.type)) { 
                totalBalance += record.amount; 
            } else if (accountSpecificTypes["รายจ่าย"].includes(record.type)) { 
                totalBalance -= record.amount; 
            }
        }
    });
    
    records.forEach(record => {
        if (record.account !== currentAccount) return;
        
        const recordDate = parseLocalDateTime(record.dateTime);
        if (!(recordDate >= startDate && recordDate <= endDate)) return;
        
        periodRecords.push(record);
        
        if (accountSpecificTypes["รายรับ"].includes(record.type)) {
            summary.totalIncome += record.amount; 
            summary.incomeCount++;
            
            if (!summary.income[record.type]) {
                summary.income[record.type] = { amount: 0, count: 0 };
            }
            summary.income[record.type].amount += record.amount; 
            summary.income[record.type].count++;
            
        } else if (accountSpecificTypes["รายจ่าย"].includes(record.type)) {
            summary.totalExpense += record.amount; 
            summary.expenseCount++;
            
            if (!summary.expense[record.type]) {
                summary.expense[record.type] = { amount: 0, count: 0 };
            }
            summary.expense[record.type].amount += record.amount; 
            summary.expense[record.type].count++;
        }
    });
    
    periodRecords.sort((a, b) => parseLocalDateTime(a.dateTime) - parseLocalDateTime(b.dateTime));
    
    console.log(`✅ สรุปข้อมูลสำเร็จ: ${periodRecords.length} รายการ`);
    console.log(`💰 รายรับ: ${summary.totalIncome}, รายจ่าย: ${summary.totalExpense}`);
    
    return { summary, periodRecords, totalBalance };
}

/**
 * สร้าง HTML สำหรับแสดงสรุป
 */
function buildOriginalSummaryHtml(context) {
    const { summaryResult, title, dateString, remark, transactionDaysInfo, type, thaiDateString, headerLine1, headerLine2, headerLine3, daysDiff, activeDays, showDetails } = context;
    const { summary, periodRecords, totalBalance } = summaryResult;
    
    let incomeHTML = ''; 
    for (const typeKey in summary.income) { 
        incomeHTML += `<p>- ${typeKey} : ${summary.income[typeKey].count} ครั้ง เป็นเงิน ${summary.income[typeKey].amount.toLocaleString()} บาท</p>`; 
    }
    
    let expenseHTML = ''; 
    for (const typeKey in summary.expense) { 
        expenseHTML += `<p>- ${typeKey} : ${summary.expense[typeKey].count} ครั้ง เป็นเงิน ${summary.expense[typeKey].amount.toLocaleString()} บาท</p>`; 
    }
    
    let recordsHTML = '';
    if ((type === 'today' || type === 'byDayMonth' || (type === 'range' && showDetails)) && periodRecords.length > 0) {
        recordsHTML = ` 
        <div style="margin-top: 20px;"> 
        <h4 style="border-bottom: 1px solid #ddd; padding-bottom: 5px;">${headerLine3 || 'รายละเอียดรายการ'}</h4> 
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;"> 
        <thead><tr style="background-color: #f2f2f2;">
        <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">วัน/เวลา</th>
        <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">ประเภท</th>
        <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">รายละเอียด</th>
        <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">จำนวนเงิน</th>
        </tr></thead> 
        <tbody> 
        ${periodRecords.map(record => {
            const { formattedDate, formattedTime } = formatDateForDisplay(record.dateTime);
            const isIncome = accountTypes.get(currentAccount)["รายรับ"].includes(record.type); 
            const color = isIncome ? "#4CAF50" : "#F44336";
            
            const displayTime = (type === 'range') ? `${formattedDate} ${formattedTime}` : formattedTime;

            return `<tr>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${displayTime}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${record.type}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${record.description}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: center; color: ${color}; font-weight: bold;">${record.amount.toLocaleString()}</td>
            </tr>`;
        }).join('')} 
        </tbody> 
        </table> 
        </div>`;
    }
    
    let comparisonText = ''; let comparisonColor = ''; let differenceAmount = 0;
    if (summary.totalIncome > summary.totalExpense) {
        differenceAmount = summary.totalIncome - summary.totalExpense;
        comparisonText = `รายได้มากกว่ารายจ่าย = ${differenceAmount.toLocaleString()} บาท`;
        comparisonColor = 'blue';
    } else if (summary.totalIncome < summary.totalExpense) {
        differenceAmount = summary.totalExpense - summary.totalIncome;
        comparisonText = `รายจ่ายมากกว่ารายได้ = ${differenceAmount.toLocaleString()} บาท`;
        comparisonColor = 'red';
    } else {
        comparisonText = 'รายได้เท่ากับรายจ่าย';
        comparisonColor = 'black';
    }
    
    let summaryLineHTML;
    if (summary.totalIncome === 0 && summary.totalExpense === 0) {
         summaryLineHTML = `<p style="color: green; font-weight: bold;">${headerLine1} ไม่มีธุรกรรมการเงิน</p>`;
    } else {
         summaryLineHTML = `<p style="color: ${comparisonColor}; font-weight: bold;">${headerLine1} ${comparisonText}</p>`;
    }
    
    let totalBalanceLine;
    if (type === 'range' || type === 'all') {
        totalBalanceLine = `<p><span style="color: blue; font-size: 14px; font-weight: bold;">${headerLine2} = </span><span style="color: ${totalBalance >= 0 ? 'green' : 'red'}; font-size: 16px; font-weight: bold;">${totalBalance.toLocaleString()}</span> บาท</p>`
    } else {
        totalBalanceLine = `<p><span style="color: blue; font-size: 14px; font-weight: bold;">เงินในบัญชีถึงวันนี้มี = </span><span style="color: ${totalBalance >= 0 ? 'green' : 'red'}; font-size: 16px; font-weight: bold;">${totalBalance.toLocaleString()}</span> บาท</p>`
    }
    
    const totalTransactionCount = summary.incomeCount + summary.expenseCount;
    const summaryDateTime = new Date().toLocaleString("th-TH", { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'}) + ' น.';
    
    let averageHtml = '';
    if (activeDays && activeDays >= 1) { 
        const netTotal = summary.totalIncome - summary.totalExpense;
        const avgNet = netTotal / activeDays; 
        let avgText = "";
        let avgColor = "";

        if (avgNet > 0) {
            avgText = `รายได้มากกว่ารายจ่ายเฉลี่ย : ${avgNet.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} บาท/วัน`;
            avgColor = "blue";
        } else if (avgNet < 0) {
            avgText = `รายจ่ายมากกว่ารายได้เฉลี่ย : ${Math.abs(avgNet).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} บาท/วัน`;
            avgColor = "red";
        } else {
            avgText = `รายได้เท่ากับรายจ่ายเฉลี่ย : 0.00 บาท/วัน`;
            avgColor = "black";
        }

        averageHtml = `
        <hr style="border: 0.5px solid green;">
        <p><span style="color: #673ab7; font-weight: bold;">สรุปค่าเฉลี่ย (คำนวณจาก ${activeDays} วันที่ทำธุรกรรม) :</span></p>
        <p style="margin-left: 10px; color: ${avgColor}; font-weight: bold;">- ${avgText}</p>
        `;
    }
    
    return ` 
    <p><strong>ชื่อบัญชี:</strong> ${currentAccount}</p> 
    <p><strong>สรุปเมื่อวันที่ : </strong> ${summaryDateTime}</p> 
    <p><strong>${title} : </strong> ${thaiDateString}</p> 
    ${transactionDaysInfo ? transactionDaysInfo : ''} 
    <hr style="border: 0.5px solid green;">
    <p><strong>รายรับ : </strong> ${summary.incomeCount} ครั้ง เป็นเงิน ${summary.totalIncome.toLocaleString()} บาท</p>${incomeHTML} 
    <hr style="border: 0.5px solid green;">
    <p><strong>รายจ่าย : </strong> ${summary.expenseCount} ครั้ง เป็นเงิน ${summary.totalExpense.toLocaleString()} บาท</p>${expenseHTML} 
    <hr style="border: 0.5px solid green;">
    ${summaryLineHTML} 
    ${totalBalanceLine} 
    
    <p>
      <span style="color: blue; font-size: clamp(12px, 2vw, 16px); font-weight: bold;">
        ธุรกรรมทั้งหมด :
      </span>
      <span style="font-size: clamp(14px, 2.2vw, 20px); font-weight: bold;">
        ${totalTransactionCount} ครั้ง (รายรับ ${summary.incomeCount} + รายจ่าย ${summary.expenseCount})
      </span>
    </p>

    ${averageHtml}
    
    <p>ข้อความเพิ่ม : <span style="color: orange;">${remark}</span></p> 
    ${recordsHTML}`;
}

/**
 * สร้าง HTML สำหรับ PDF
 */
function buildPdfSummaryHtml(context) {
    const { summaryResult, title, dateString, remark, transactionDaysInfo, type, thaiDateString, headerLine1, headerLine2, headerLine3, daysDiff, activeDays } = context;
    const { summary, periodRecords, totalBalance } = summaryResult;
    
    let incomeHTML = ''; 
    for (const type in summary.income) { 
        incomeHTML += `<p style="margin-left: 15px; line-height: 0.5;">- ${type} : ${summary.income[type].count} ครั้ง เป็นเงิน ${summary.income[type].amount.toLocaleString()} บาท</p>`; 
    }
    
    let expenseHTML = ''; 
    for (const type in summary.expense) { 
        expenseHTML += `<p style="margin-left: 15px; line-height: 0.5;">- ${type} : ${summary.expense[type].count} ครั้ง เป็นเงิน ${summary.expense[type].amount.toLocaleString()} บาท</p>`; 
    }
    
    let recordsHTML = '';
    if (periodRecords.length > 0) {
        recordsHTML = ` 
        <div style="margin-top: 20px;"> 
        <h4>รายละเอียดธุรกรรม</h4> 
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px; text-align: center;">
        <thead>
        <tr style="background-color: #f2f2f2;">
        <th style="width: 15%; padding: 4px; border: 1px solid #ddd;">วันเดือนปี</th>
        <th style="width: 10%; padding: 4px; border: 1px solid #ddd;">เวลา</th>
        <th style="width: 15%; padding: 4px; border: 1px solid #ddd;">ประเภท</th>
        <th style="width: 30%; padding: 4px; border: 1px solid #ddd;">รายละเอียด</th>
        <th style="width: 15%; padding: 4px; border: 1px solid #ddd;">จำนวนเงิน</th>
        </tr>
        </thead>
        <tbody>
        ${periodRecords.map(record => {
            const { formattedDate, formattedTime } = formatDateForDisplay(record.dateTime);
            const isIncome = accountTypes.get(currentAccount)["รายรับ"].includes(record.type); 
            const color = isIncome ? "#4CAF50" : "#F44336";
            
            return `
            <tr>
            <td style="padding: 4px; border: 1px solid #ddd; word-wrap: break-word;">${formattedDate}</td>
            <td style="padding: 4px; border: 1px solid #ddd; word-wrap: break-word;">${formattedTime}</td>
            <td style="padding: 4px; border: 1px solid #ddd; word-wrap: break-word;">${record.type}</td>
            <td style="padding: 4px; border: 1px solid #ddd; word-wrap: break-word;">${record.description}</td>
            <td style="padding: 4px; border: 1px solid #ddd; color: ${color}; font-weight: bold; word-wrap: break-word;">${record.amount.toLocaleString()}</td>
            </tr>`;
        }).join('')} 
        </tbody> 
        </table> 
        </div>`;
    }
    
    let comparisonText = ''; let comparisonColor = ''; let differenceAmount = 0;
    if (summary.totalIncome > summary.totalExpense) {
        differenceAmount = summary.totalIncome - summary.totalExpense;
        comparisonText = `รายได้มากกว่ารายจ่าย = ${differenceAmount.toLocaleString()} บาท`;
        comparisonColor = 'blue';
    } else if (summary.totalIncome < summary.totalExpense) {
        differenceAmount = summary.totalExpense - summary.totalIncome;
        comparisonText = `รายจ่ายมากกว่ารายได้ = ${differenceAmount.toLocaleString()} บาท`;
        comparisonColor = 'red';
    } else {
        comparisonText = 'รายได้เท่ากับรายจ่าย';
        comparisonColor = 'black';
    }
    
    let summaryLineHTML;
    if (summary.totalIncome === 0 && summary.totalExpense === 0) {
        summaryLineHTML = `<p style="color: green; font-weight: bold; line-height: 0.5;">${headerLine1} ไม่มีธุรกรรมการเงิน</p>`;
    } else {
        summaryLineHTML = `<p style="color: ${comparisonColor}; font-weight: bold; line-height: 0.5;">${headerLine1} ${comparisonText}</p>`;
    }
    
    let totalBalanceLine;
    if (type === 'range' || type === 'all') {
        totalBalanceLine = `<p style="line-height: 0.5;"><b>${headerLine2} = </b><b style="color: ${totalBalance >= 0 ? 'green' : 'red'}; font-size: 1.1em;">${totalBalance.toLocaleString()}</b> บาท</p>`
    } else {
        totalBalanceLine = `<p style="line-height: 0.5;"><b>เงินในบัญชีถึงวันนี้มี = </b><b style="color: ${totalBalance >= 0 ? 'green' : 'red'}; font-size: 1.1em;">${totalBalance.toLocaleString()}</b> บาท</p>`
    }
    
    const totalTransactionCount = summary.incomeCount + summary.expenseCount;
    const summaryDateTime = new Date().toLocaleString("th-TH", { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'}) + ' น.';
    
    let averageHtml = '';
    if (activeDays && activeDays >= 1) {
        const netTotal = summary.totalIncome - summary.totalExpense;
        const avgNet = netTotal / activeDays;
        let avgText = "";
        let avgColor = "";

        if (avgNet > 0) {
            avgText = `รายได้มากกว่ารายจ่ายเฉลี่ย : ${avgNet.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} บาท/วัน`;
            avgColor = "blue";
        } else if (avgNet < 0) {
            avgText = `รายจ่ายมากกว่ารายได้เฉลี่ย : ${Math.abs(avgNet).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} บาท/วัน`;
            avgColor = "red";
        } else {
            avgText = `รายได้เท่ากับรายจ่ายเฉลี่ย : 0.00 บาท/วัน`;
            avgColor = "black";
        }

        averageHtml = `
        <hr style="border: 0.5px solid green;">
        <p style="line-height: 0.5;"><strong>สรุปค่าเฉลี่ย (คำนวณจาก ${activeDays} วันที่ทำธุรกรรม) :</strong></p>
        <p style="margin-left: 15px; line-height: 0.5; color: ${avgColor}; font-weight: bold;">- ${avgText}</p>
        `;
    }
    
    return ` 
    <p style="line-height: 0.5;"><strong>ชื่อบัญชี:</strong> ${currentAccount}</p> 
    <p style="line-height: 0.5;"><strong>สรุปเมื่อวันที่ : </strong> ${summaryDateTime}</p> 
    <p style="line-height: 0.5;"><strong>${title} : </strong> ${thaiDateString}</p> 
    ${transactionDaysInfo ? transactionDaysInfo.replace(/<p/g, '<p style="line-height: 0.5;"') : ''} 
    <hr style="border: 0.5px solid green;">
    <p style="line-height: 0.5;"><strong>รายรับ : </strong> ${summary.incomeCount} ครั้ง เป็นเงิน ${summary.totalIncome.toLocaleString()} บาท</p>
    ${incomeHTML} 
    <hr style="border: 0.5px solid green;">
    <p style="line-height: 0.5;"><strong>รายจ่าย : </strong> ${summary.expenseCount} ครั้ง เป็นเงิน ${summary.totalExpense.toLocaleString()} บาท</p>
    ${expenseHTML} 
    <hr style="border: 0.5px solid green;">
    ${summaryLineHTML} 
    ${totalBalanceLine} 
    
    <p style="line-height: 0.5;"><strong>ธุรกรรมทั้งหมด : </strong> ${totalTransactionCount} ครั้ง (รวมรับ-จ่าย)</p>
    
    ${averageHtml}

    <p style="line-height: 0.5;"><b>ข้อความเพิ่ม : </b><span style="color: orange;">${remark}</span></p> 
    ${recordsHTML}
    `;
}

// ==============================================
// ฟังก์ชันจัดการผลลัพธ์สรุป
// ==============================================

// [🔧 แก้ไข] ฟังก์ชัน handleSummaryOutput ใหม่ รองรับ 'dailySummary'
function handleSummaryOutput(choice) {
    if (!summaryContext) {
        console.error("Summary context is missing. Cannot proceed.");
        closeSummaryOutputModal();
        return;
    }
    
    // --- โหมดพิเศษ: สรุปผลแต่ละวัน ---
    if (summaryContext.type === 'dailySummary') {
        if (choice === 'display') {
            const htmlForDisplay = buildDailySummaryHtml(summaryContext, false);
            openSummaryModal(htmlForDisplay);
        } else if (choice === 'xlsx') {
            exportDailySummaryToXlsx(summaryContext);
            showToast(`📊 สรุปข้อมูลบันทึกเป็นไฟล์ XLSX สำเร็จ`, 'success');
        } else if (choice === 'pdf') {
            const printContainer = document.getElementById('print-container');
            if (printContainer) {
                const htmlWithDetailsForPdf = buildDailySummaryHtml(summaryContext, true);
                printContainer.innerHTML = `<div class="summaryResult">${htmlWithDetailsForPdf}</div>`;
                
                const toast = document.getElementById('toast');
                if (toast) toast.style.display = 'none';
                
                setTimeout(() => { 
                    window.print(); 
                    setTimeout(() => {
                        if (toast) toast.style.display = '';
                        showToast(`📄 สรุปข้อมูลบันทึกเป็นไฟล์ PDF สำเร็จ`, 'success');
                    }, 1000);
                }, 250);
            }
        }
        closeSummaryOutputModal();
        return;
    }

    // --- โหมดปกติ (สรุปวันที่ถึงวันที่, สรุปวันนี้, ฯลฯ) ---
    if (choice === 'display') {
        const htmlForDisplay = buildOriginalSummaryHtml(summaryContext);
        openSummaryModal(htmlForDisplay);
    } else if (choice === 'xlsx') {
        const { summaryResult, title, dateString, remark, transactionDaysInfo, periodName, daysDiff, activeDays } = summaryContext;
        exportSummaryToXlsx(summaryResult, title, dateString, remark, transactionDaysInfo, periodName, daysDiff, activeDays);
        showToast(`📊 สรุปข้อมูลบันทึกเป็นไฟล์ XLSX สำเร็จ`, 'success');
    } else if (choice === 'pdf') {
        const printContainer = document.getElementById('print-container');
        if (printContainer) {
            const htmlWithDetailsForPdf = buildPdfSummaryHtml(summaryContext);
            printContainer.innerHTML = `<div class="summaryResult">${htmlWithDetailsForPdf}</div>`;
            
            const toast = document.getElementById('toast');
            if (toast) toast.style.display = 'none';
            
            setTimeout(() => { 
                window.print(); 
                setTimeout(() => {
                    if (toast) toast.style.display = '';
                    showToast(`📄 สรุปข้อมูลบันทึกเป็นไฟล์ PDF สำเร็จ`, 'success');
                }, 1000);
            }, 250);
        }
    }
    closeSummaryOutputModal();
}

// ==============================================
// ✅ ฟังก์ชันใหม่สำหรับสรุปผลแต่ละวัน (เฉพาะผลสรุปเป็นตาราง)
// ==============================================

/**
 * คำนวณสรุปข้อมูลแต่ละวันและเก็บไว้ใน dailySummaryData
 */
function calculateDailySummaries() {
    console.log("-> กำลังคำนวณข้อมูลสรุปรายวัน...");
    if (!currentAccount || records.length === 0) {
        dailySummaryData = {};
        return;
    }

    const accountRecords = records.filter(record => record.account === currentAccount);
    if (accountRecords.length === 0) {
        dailySummaryData = {};
        return;
    }

    // ป้องกันกรณี accountTypes ยังไม่ได้ถูกสร้าง
    if (!accountTypes.has(currentAccount)) {
        initializeAccountTypes(currentAccount);
    }
    const accountSpecificTypes = accountTypes.get(currentAccount);
    const summaryByDate = {};

    accountRecords.forEach(record => {
        // ป้องกัน Error กรณีไม่มีข้อมูล dateTime
        if (!record.dateTime) return;
        const dateParts = record.dateTime.split(' ');
        if (dateParts.length === 0) return;
        
        const date = dateParts[0]; // ดึงเฉพาะ YYYY-MM-DD

        if (!summaryByDate[date]) {
            summaryByDate[date] = { income: 0, expense: 0 };
        }

        // ป้องกัน Error กรณีโครงสร้างประเภทบัญชีสูญหาย
        if (accountSpecificTypes) {
            if (accountSpecificTypes["รายรับ"] && accountSpecificTypes["รายรับ"].includes(record.type)) {
                summaryByDate[date].income += parseFloat(record.amount) || 0;
            } else if (accountSpecificTypes["รายจ่าย"] && accountSpecificTypes["รายจ่าย"].includes(record.type)) {
                summaryByDate[date].expense += parseFloat(record.amount) || 0;
            }
        }
    });

    dailySummaryData = summaryByDate;
    console.log("คำนวณเสร็จสิ้น พบข้อมูลที่มีความเคลื่อนไหวจำนวน:", Object.keys(dailySummaryData).length, "วัน");
}

/**
 * สลับโหมดการเลือกช่วงวันที่ (range หรือ lastX)
 */
function toggleDailyMode() {
    const mode = document.querySelector('input[name="dailyMode"]:checked').value;
    const rangeContainer = document.getElementById('rangeContainer');
    const lastXContainer = document.getElementById('lastXContainer');
    
    if (mode === 'lastX') {
        rangeContainer.style.display = 'none';
        lastXContainer.style.display = 'block';
        document.getElementById('lastXPreview').innerHTML = '';
    } else {
        rangeContainer.style.display = 'block';
        lastXContainer.style.display = 'none';
        document.getElementById('lastXPreview').innerHTML = '';
    }
}

/**
 * คำนวณช่วงวันที่สำหรับ X วันล่าสุด
 */
function calculateLastXRange() {
    const days = parseInt(document.getElementById('lastXDays').value);
    
    if (!days || days <= 0) {
        showToast('⚠️ กรุณาระบุจำนวนวันที่ถูกต้อง', 'error');
        return;
    }
    
    if (!dailySummaryData || Object.keys(dailySummaryData).length === 0) {
        showToast('⚠️ ไม่มีข้อมูลสำหรับคำนวณ', 'error');
        return;
    }
    
    const dates = Object.keys(dailySummaryData).sort();
    const endDate = dates[dates.length - 1];
    
    const end = new Date(endDate);
    const start = new Date(end);
    start.setDate(end.getDate() - days + 1);
    
    const startDate = start.toISOString().split('T')[0];
    
    // ใส่ค่าอัตโนมัติลงช่อง date
    document.getElementById('dailyStartDate').value = startDate;
    document.getElementById('dailyEndDate').value = endDate;
    
    document.getElementById('lastXPreview').innerHTML = 
        `ช่วงวันที่: ${startDate} ถึง ${endDate}`;
    
    showToast('✅ คำนวณช่วงวันที่เรียบร้อย', 'success');
}

// [🔧 แก้ไข] ฟังก์ชัน showDailySummaryByRange ใหม่ (ใช้ Modal)
function showDailySummaryByRange() {
    console.log("-> กดปุ่มแสดงสรุปตามช่วงที่เลือก (โหมด Modal)");
    
    let startDate = document.getElementById('dailyStartDate').value;
    let endDate = document.getElementById('dailyEndDate').value;
    
    if (!startDate || !endDate) {
        showToast('⚠️ กรุณาเลือกหรือคำนวณช่วงวันที่ก่อน', 'error');
        return;
    }
    
    if (new Date(startDate) > new Date(endDate)) {
        showToast('⚠️ วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด', 'error');
        return;
    }
    
    // บังคับคำนวณใหม่เพื่อความชัวร์ ถ้าข้อมูลว่างเปล่า
    if (!dailySummaryData || Object.keys(dailySummaryData).length === 0) {
        calculateDailySummaries();
    }
    
    const filteredData = {};
    let hasData = false;
    
    Object.keys(dailySummaryData).forEach(date => {
        if (date >= startDate && date <= endDate) {
            filteredData[date] = dailySummaryData[date];
            hasData = true;
        }
    });
    
    if (!hasData) {
        showToast('⚠️ ไม่มีข้อมูลในช่วงวันที่เลือก', 'error');
        return;
    }

    // ✅ เพิ่มกล่องรับข้อความหมายเหตุ
    const remarkInput = prompt("กรุณากรอกหมายเหตุ (ถ้าไม่กรอกจะใช้ 'No comment'):", "No comment") || "No comment";

    // เตรียม Context ส่งไปให้ Modal หน้าสรุป
    const activeDaysCount = Object.keys(filteredData).length;
    summaryContext = {
        type: 'dailySummary', // แจ้งประเภทเพื่อแยกการสร้าง HTML
        startDateStr: startDate,
        endDateStr: endDate,
        filteredData: filteredData,
        activeDaysCount: activeDaysCount,
        title: 'สรุปผลแต่ละวัน',
        remark: remarkInput // ✅ นำข้อความมาแสดง
    };
    
    openSummaryOutputModal();
}

// ==============================================
// ฟังก์ชันจัดการการส่งออกข้อมูล
// ==============================================

/**
 * บันทึกข้อมูลลงไฟล์
 */
function saveToFile() { 
    closeExportOptionsModal(); 
    if (accounts.length === 0) { 
        showToast("❌ ไม่มีบัญชีให้บันทึก", 'error'); 
        return; 
    } 
    document.getElementById('formatSelectionModal').style.display = 'flex'; 
    showToast("📁 กำลังเปิดหน้าต่างบันทึกไฟล์...", 'info');
}

/**
 * ส่งออกบัญชีที่เลือก
 */
function exportSelectedAccount() { 
    closeExportOptionsModal(); 
    if (!currentAccount) { 
        showToast("❌ กรุณาเลือกบัญชีที่ต้องการบันทึกก่อน", 'error'); 
        return; 
    } 
    document.getElementById('exportSingleAccountModal').style.display = 'flex'; 
    showToast("📁 กำลังเปิดหน้าต่างบันทึกบัญชี...", 'info');
}

/**
 * เริ่มการส่งออกข้อมูลรายวัน
 */
function initiateSingleDateExport() {
    if (!currentAccount) {
        showToast("❌ กรุณาเลือกบัญชีที่ต้องการบันทึกก่อน", 'error');
        return;
    }
    closeExportOptionsModal();
    document.getElementById('singleDateAccountName').textContent = currentAccount;
    document.getElementById('exportSingleDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('singleDateExportModal').style.display = 'flex';
    showToast("📅 กำลังเปิดหน้าต่างบันทึกข้อมูลรายวัน...", 'info');
}

/**
 * ดำเนินการส่งออกข้อมูลรายวัน
 */
function processSingleDateExport() {
    const selectedDateStr = document.getElementById('exportSingleDate').value;
    if (!selectedDateStr) {
        showToast("❌ กรุณาเลือกวันที่ที่ต้องการบันทึก", 'error');
        return;
    }
    const filteredRecords = records.filter(record => {
        return record.account === currentAccount && record.dateTime.startsWith(selectedDateStr);
    });
    if (filteredRecords.length === 0) {
        showToast(`❌ ไม่พบข้อมูลในบัญชี "${currentAccount}" ในวันที่ ${selectedDateStr}`, 'error');
        return;
    }
    singleDateExportContext = {
        records: filteredRecords,
        selectedDate: selectedDateStr,
    };
    closeSingleDateExportModal();
    document.getElementById('singleDateExportFormatModal').style.display = 'flex';
    showToast(`✅ พบข้อมูล ${filteredRecords.length} รายการสำหรับวันที่ ${selectedDateStr}`, 'success');
}

/**
 * เริ่มการส่งออกข้อมูลตามช่วงวันที่
 */
function initiateDateRangeExport() {
    if (!currentAccount) {
        showToast("❌ กรุณาเลือกบัญชีที่ต้องการบันทึกก่อน", 'error');
        return;
    }
    
    closeExportOptionsModal();
    setupDateRangeModal();
    document.getElementById('dateRangeExportModal').style.display = 'flex';
    showToast("📅 กำลังเปิดหน้าต่างบันทึกข้อมูลตามช่วงวันที่...", 'info');
}

/**
 * ตั้งค่าโมดอลช่วงวันที่
 */
function setupDateRangeModal() {
    document.getElementById('dateRangeAccountName').textContent = currentAccount;
    
    const accountRecords = records.filter(record => record.account === currentAccount);
    
    const endDateValue = new Date().toISOString().slice(0, 10);
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 2);
    const startDateValue = startDate.toISOString().slice(0, 10);
    
    document.getElementById('exportStartDate').value = startDateValue;
    document.getElementById('exportEndDate').value = endDateValue;
}

/**
 * ดำเนินการส่งออกข้อมูลตามช่วงวันที่
 */
function processDateRangeExport() {
    const validationResult = validateDateRangeInput();
    if (!validationResult.isValid) {
        showToast(validationResult.message, 'error');
        return;
    }
    
    const { startDateStr, endDateStr, startDate, endDate } = validationResult;
    
    const filteredRecords = filterRecordsByDateRange(startDate, endDate);
    
    if (filteredRecords.length === 0) {
        showNoDataAlert(startDateStr, endDateStr);
        return;
    }
    
    exportDateRangeAsJson(filteredRecords, startDateStr, endDateStr);
    closeDateRangeExportModal();
}

/**
 * ส่งออกข้อมูลช่วงวันที่เป็น JSON
 */
async function exportDateRangeAsJson(filteredRecords, startDate, endDate) {
    const defaultFileName = `${currentAccount}_${startDate}_ถึง_${endDate}`;
    const fileName = prompt("กรุณากรอกชื่อไฟล์ (ไม่ต้องใส่นามสกุล):", defaultFileName);
    
    if (!fileName) {
        showToast("❌ ยกเลิกการบันทึกไฟล์", 'info');
        return;
    }
    
    const accountTypesData = accountTypes.get(currentAccount) || { "รายรับ": [], "รายจ่าย": [] };
    
    const exportData = {
        accountName: currentAccount,
        isDateRangeExport: true,
        exportStartDate: startDate,
        exportEndDate: endDate,
        exportTimestamp: new Date().toISOString(),
        recordCount: filteredRecords.length,
        records: filteredRecords,
        accountTypes: accountTypesData
    };
    
    let dataString = JSON.stringify(exportData, null, 2);
    
    if (backupPassword) {
        showToast('🔐 กำลังเข้ารหัสข้อมูล...', 'info');
        try {
            const encryptedObject = await encryptData(dataString, backupPassword);
            dataString = JSON.stringify(encryptedObject, null, 2);
        } catch (e) {
            showToast('❌ การเข้ารหัสล้มเหลว!', 'error');
            return;
        }
    }
    
    try {
        const blob = new Blob([dataString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast(`✅ บันทึกข้อมูลช่วงวันที่ ${startDate} ถึง ${endDate} เป็น JSON เรียบร้อย\nจำนวนรายการ: ${filteredRecords.length} รายการ`, 'success');
    } catch (error) {
        console.error("Error downloading file:", error);
        showToast("❌ เกิดข้อผิดพลาดในการบันทึกไฟล์: " + error.message, 'error');
    }
}

/**
 * ตรวจสอบความถูกต้องของช่วงวันที่
 */
function validateDateRangeInput() {
    const startDateStr = document.getElementById('exportStartDate').value;
    const endDateStr = document.getElementById('exportEndDate').value;
    
    if (!startDateStr || !endDateStr) {
        return { isValid: false, message: "❌ กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุด" };
    }
    
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    
    if (startDate > endDate) {
        return { isValid: false, message: "❌ วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด" };
    }
    
    return { 
        isValid: true, 
        startDateStr, 
        endDateStr, 
        startDate, 
        endDate: new Date(endDate.setHours(23, 59, 59, 999))
    };
}

/**
 * กรองข้อมูลตามช่วงวันที่
 */
function filterRecordsByDateRange(startDate, endDate) {
    return records.filter(record => {
        if (record.account !== currentAccount) return false;
        
        const recordDate = parseLocalDateTime(record.dateTime);
        return recordDate >= startDate && recordDate <= endDate;
    });
}

/**
 * แสดงแจ้งเตือนไม่มีข้อมูล
 */
function showNoDataAlert(startDateStr, endDateStr) {
    showToast(`❌ ไม่พบข้อมูลในบัญชี "${currentAccount}" ระหว่างวันที่ ${startDateStr} ถึง ${endDateStr}`, 'error');
}

// ==============================================
// ฟังก์ชันจัดการไฟล์ (บันทึก/โหลด)
// ==============================================

/**
 * บันทึกข้อมูลและแสดง Toast
 */
function saveDataAndShowToast(entryCategory = 'neutral') { 
    saveToLocal();
    
    if (currentUser) {
        saveToFirebase();
    }
    
    let message = '✓ บันทึกข้อมูลสำเร็จแล้ว';
    let type = 'info';
    
    if (entryCategory === 'income') { 
        message = '✓ บันทึกรายรับสำเร็จ';
        type = 'income';
    } else if (entryCategory === 'expense') { 
        message = '✓ บันทึกรายจ่ายสำเร็จ';
        type = 'expense';
    }
    
    showToast(message, type);
}

/**
 * บันทึกข้อมูลลง Local Storage
 */
function saveToLocal(fromPasswordSave = false) {
    const dataToSave = {
        accounts: [...accounts],
        currentAccount: currentAccount,
        records: [...records],
        accountTypes: Array.from(accountTypes.entries()),
        backupPassword: backupPassword,
        // ✅ บันทึก dailySummaryData ด้วย (ถ้ามี)
        dailySummaryData: dailySummaryData || {}
    };
    try {
        localStorage.setItem('accountData', JSON.stringify(dataToSave));
        if (!fromPasswordSave && !currentUser) {
            showToast('✓ บันทึกข้อมูลชั่วคราวในเบราว์เซอร์เรียบร้อยแล้ว', 'success');
        }
    } catch (error) {
        console.error("บันทึกข้อมูลชั่วคราวไม่สำเร็จ:", error);
        showToast("❌ เกิดข้อผิดพลาดในการบันทึกข้อมูลชั่วคราว", 'error');
    }
}

/**
 * โหลดข้อมูลจาก Local Storage
 */
function loadFromLocal() {
    const data = localStorage.getItem('accountData');
    if (data) {
        try {
            const parsed = JSON.parse(data);
            accounts = parsed.accounts || [];
            currentAccount = parsed.currentAccount || null;
            records = parsed.records || [];
            accountTypes = new Map(parsed.accountTypes || []);
            backupPassword = parsed.backupPassword || null; 
            // ✅ โหลด dailySummaryData (ถ้ามี)
            dailySummaryData = parsed.dailySummaryData || {};
            
            renderBackupPasswordStatus();
            updateAccountSelect();
            if (currentAccount) {
                document.getElementById('accountSelect').value = currentAccount;
            }
            changeAccount();
            
            if (!currentUser) {
                showToast('📂 โหลดข้อมูลจากเครื่องสำเร็จ', 'success');
            }
        } catch (error) {
            console.error("โหลดข้อมูลจาก LocalStorage ไม่สำเร็จ", error);
            if (!currentUser) {
                showToast('❌ โหลดข้อมูลจากเครื่องไม่สำเร็จ', 'error');
            }
        }
    }
    updateMultiAccountSelector();
}

/**
 * จัดการบันทึกตามรูปแบบ
 */
async function handleSaveAs(format) {
    closeFormatModal();
    const formatLower = format.toLowerCase().trim();
    const fileName = prompt("กรุณากรอกชื่อไฟล์สำหรับบันทึกข้อมูล (ไม่ต้องใส่นามสกุล):", "ข้อมูลทุกบัญชี");
    if (!fileName) {
        showToast("❌ ยกเลิกการบันทึกไฟล์", 'info');
        return;
    }
    const now = new Date();
    const dateTimeString = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    
    if (formatLower === 'json') {
        const fullFileName = `${fileName}_${dateTimeString}.json`;
        const data = { 
            accounts, 
            currentAccount, 
            records, 
            accountTypes: Array.from(accountTypes.entries()), 
            backupPassword: null,
            // ✅ บันทึก dailySummaryData ด้วย
            dailySummaryData: dailySummaryData || {}
        };
        let dataString = JSON.stringify(data, null, 2);
        if (backupPassword) {
            showToast('🔐 กำลังเข้ารหัสข้อมูล...', 'info');
            try {
                const encryptedObject = await encryptData(dataString, backupPassword);
                dataString = JSON.stringify(encryptedObject, null, 2);
            } catch (e) {
                showToast('❌ การเข้ารหัสล้มเหลว!', 'error'); 
                return;
            }
        }
        const blob = new Blob([dataString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fullFileName; a.click();
        URL.revokeObjectURL(url);
        showToast(`✅ บันทึกข้อมูลทั้งหมดเป็น JSON เรียบร้อย\nไฟล์: ${fullFileName}`, 'success');
    } else if (formatLower === 'csv') {
        const fullFileName = `${fileName}_${dateTimeString}.csv`;
        let csvData = [];
        csvData.push(['###ALL_ACCOUNTS_BACKUP_CSV###']);
        csvData.push(['###ACCOUNTS_LIST###', ...accounts]);
        csvData.push(['###ACCOUNT_TYPES_START###']);
        for (const [accName, typesObj] of accountTypes.entries()) {
            initializeAccountTypes(accName);
            const currentTypes = accountTypes.get(accName);
            if (currentTypes.รายรับ && currentTypes.รายรับ.length > 0) csvData.push([accName, 'รายรับ', ...currentTypes.รายรับ]);
            if (currentTypes.รายจ่าย && currentTypes.รายจ่าย.length > 0) csvData.push([accName, 'รายจ่าย', ...currentTypes.รายจ่าย]);
        }
        csvData.push(['###ACCOUNT_TYPES_END###']);
        csvData.push(['###DATA_START###']);
        csvData.push(["วันที่", "เวลา", "ประเภท", "รายละเอียด", "จำนวนเงิน (บาท)", "บัญชี", "สร้างโดย", "แก้ไขล่าสุดโดย"]);
        const allSortedRecords = [...records].sort((a, b) => parseLocalDateTime(a.dateTime) - parseLocalDateTime(b.dateTime));
        allSortedRecords.forEach(record => {
            const { formattedDate, formattedTime } = formatDateForDisplay(record.dateTime);
            csvData.push([
                formattedDate, 
                formattedTime, 
                record.type, 
                record.description, 
                record.amount, 
                record.account,
                record.createdBy || '-',
                record.editedBy || '-'
            ]);
        });
        let csvContent = Papa.unparse(csvData, { header: false });
        const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fullFileName;
        link.click();
        URL.revokeObjectURL(link.href);
        showToast(`✅ บันทึกข้อมูลทั้งหมดลงในไฟล์ CSV "${fullFileName}" เรียบร้อยแล้ว`, 'success');
    }
}

/**
 * จัดการส่งออกบัญชีที่เลือก
 */
async function handleExportSelectedAs(format) {
    closeExportSingleAccountModal();
    if (!currentAccount) {
        showToast("❌ เกิดข้อผิดพลาด: ไม่พบบัญชีที่เลือก", 'error');
        return;
    }
    const fileName = prompt(`กรุณากรอกชื่อไฟล์สำหรับบัญชี ${currentAccount} (ไม่ต้องใส่นามสกุล):`, currentAccount);
    if (!fileName) {
        showToast("❌ ยกเลิกการบันทึกไฟล์", 'info');
        return;
    }
    const now = new Date();
    const dateTimeString = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    
    if (format === 'json') {
        const fullFileName = `${fileName}_${dateTimeString}.json`;
        const accountData = {
            accountName: currentAccount,
            records: records.filter(record => record.account === currentAccount),
            accountTypes: accountTypes.get(currentAccount) || { "รายรับ": [], "รายจ่าย": [] }
        };
        let dataString = JSON.stringify(accountData, null, 2);
        if (backupPassword) {
            showToast('🔐 กำลังเข้ารหัสข้อมูล...', 'info');
            try {
                const encryptedObject = await encryptData(dataString, backupPassword);
                dataString = JSON.stringify(encryptedObject, null, 2);
            } catch (e) {
                showToast('❌ การเข้ารหัสล้มเหลว!', 'error'); 
                return;
            }
        }
        const blob = new Blob([dataString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fullFileName; a.click();
        URL.revokeObjectURL(url);
        showToast(`✅ บันทึกบัญชี "${currentAccount}" เป็น JSON เรียบร้อย\nไฟล์: ${fullFileName}`, 'success');
    } else if (format === 'csv') {
        const fullFileName = `${fileName}_${dateTimeString}.csv`;
        initializeAccountTypes(currentAccount);
        const accountCurrentTypes = accountTypes.get(currentAccount);
        let excelData = [];
        excelData.push([`ชื่อบัญชี: ${currentAccount}`]);
        excelData.push(['###ACCOUNT_TYPES###']);
        excelData.push(['รายรับ', ...(accountCurrentTypes['รายรับ'] || [])]);
        excelData.push(['รายจ่าย', ...(accountCurrentTypes['รายจ่าย'] || [])]);
        excelData.push(['###DATA_START###']);
        excelData.push(["วันที่", "เวลา", "ประเภท", "รายละเอียด", "จำนวนเงิน (บาท)", "ผู้สร้าง", "ผู้แก้ไข"]);
        const filteredRecords = records.filter(record => record.account === currentAccount).sort((a, b) => parseLocalDateTime(a.dateTime) - parseLocalDateTime(b.dateTime));
        filteredRecords.forEach(record => {
            const { formattedDate, formattedTime } = formatDateForDisplay(record.dateTime);
            excelData.push([
                formattedDate, 
                formattedTime, 
                record.type, 
                record.description, 
                record.amount,
                record.createdBy || '-',
                record.editedBy || '-'
            ]);
        });
        let csvContent = Papa.unparse(excelData, { header: false });
        const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = fullFileName; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 100);
        showToast(`✅ บันทึกบัญชี "${currentAccount}" เป็น CSV เรียบร้อย\nไฟล์: ${fullFileName}`, 'success');
    }
}

/**
 * จัดการส่งออกข้อมูลรายวัน
 */
async function handleSingleDateExportAs(format) {
    closeSingleDateExportFormatModal();
    const { records: filteredRecords, selectedDate } = singleDateExportContext;
    
    if (!filteredRecords || filteredRecords.length === 0) {
        showToast("❌ เกิดข้อผิดพลาด: ไม่พบข้อมูลที่จะบันทึก", 'error');
        return;
    }
    const fileName = prompt(`กรุณากรอกชื่อไฟล์ (ไม่ต้องใส่นามสกุล):`, `${currentAccount}_${selectedDate}`);
    if (!fileName) {
        showToast("❌ ยกเลิกการบันทึกไฟล์", 'info');
        return;
    }
    const fullFileName = `${fileName}.${format}`;
    
    if (format === 'json') {
        const exportData = {
            accountName: currentAccount,
            isDailyExport: true,
            exportDate: selectedDate,
            records: filteredRecords
        };
        let dataString = JSON.stringify(exportData, null, 2);
        if (backupPassword) {
            showToast('🔐 กำลังเข้ารหัสข้อมูล...', 'info');
            try {
                const encryptedObject = await encryptData(dataString, backupPassword);
                dataString = JSON.stringify(encryptedObject, null, 2);
            } catch (e) {
                showToast('❌ การเข้ารหัสล้มเหลว!', 'error'); 
                return;
            }
        }
        const blob = new Blob([dataString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fullFileName; a.click();
        URL.revokeObjectURL(url);
        showToast(`✅ บันทึกข้อมูลวันที่ ${selectedDate} เป็น JSON เรียบร้อย\nไฟล์: ${fullFileName}`, 'success');

    } else if (format === 'csv') {
        const fullFileName = `${fileName}.csv`;
        let csvData = [];
        csvData.push([`ชื่อบัญชี: ${currentAccount}`]);
        csvData.push([`วันที่ส่งออก: ${selectedDate}`]);
        csvData.push([]);
        csvData.push(["วันที่", "เวลา", "ประเภท", "รายละเอียด", "จำนวนเงิน (บาท)", "ผู้สร้าง", "ผู้แก้ไข"]);
        
        const sortedRecords = [...filteredRecords].sort((a, b) => parseLocalDateTime(a.dateTime) - parseLocalDateTime(b.dateTime));
        
        sortedRecords.forEach(record => {
            const { formattedDate, formattedTime } = formatDateForDisplay(record.dateTime);
            csvData.push([
                formattedDate, 
                formattedTime, 
                record.type, 
                record.description, 
                record.amount,
                record.createdBy || '-',
                record.editedBy || '-'
            ]);
        });
        
        let csvContent = Papa.unparse(csvData, { header: false });
        const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = fullFileName; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 100);
        showToast(`✅ บันทึกข้อมูลวันที่ ${selectedDate} เป็น CSV เรียบร้อย\nไฟล์: ${fullFileName}`, 'success');

    } else if (format === 'xlsx') {
        const fullFileName = `${fileName}.xlsx`;
        const wb = XLSX.utils.book_new();
        
        let excelData = [];
        
        excelData.push([`ชื่อบัญชี: ${currentAccount}`]);
        excelData.push([`วันที่ส่งออก: ${selectedDate}`]);
        excelData.push([]);
        
        excelData.push(["วันที่", "เวลา", "ประเภท", "รายละเอียด", "จำนวนเงิน (บาท)", "ผู้สร้าง", "ผู้แก้ไข"]);
        
        const sortedRecords = [...filteredRecords].sort((a, b) => parseLocalDateTime(a.dateTime) - parseLocalDateTime(b.dateTime));
        
        sortedRecords.forEach(record => {
            const { formattedDate, formattedTime } = formatDateForDisplay(record.dateTime);
            excelData.push([
                formattedDate, 
                formattedTime, 
                record.type, 
                record.description, 
                record.amount,
                record.createdBy || '-',
                record.editedBy || '-'
            ]);
        });
        
        const ws = XLSX.utils.aoa_to_sheet(excelData);
        
        const colWidths = [
            {wch: 12},
            {wch: 10},
            {wch: 15},
            {wch: 30},
            {wch: 15},
            {wch: 20},
            {wch: 20}
        ];
        ws['!cols'] = colWidths;
        
        ws['!pageSetup'] = {
            orientation: 'landscape',
            paperSize: 9,
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            margins: {
                left: 0.7, right: 0.7,
                top: 0.75, bottom: 0.75,
                header: 0.3, footer: 0.3
            }
        };
        
        XLSX.utils.book_append_sheet(wb, ws, "ข้อมูลบัญชี");
        
        XLSX.writeFile(wb, fullFileName);
        showToast(`✅ บันทึกข้อมูลวันที่ ${selectedDate} เป็น XLSX เรียบร้อย\nไฟล์: ${fullFileName}`, 'success');
    }
    singleDateExportContext = {};
}

// ==============================================
// ฟังก์ชันจัดการการนำเข้าไฟล์
// ==============================================

/**
 * โหลดข้อมูลจากไฟล์
 */
async function loadFromFile(event) {
    const file = event.target.files[0]; 
    if (!file) { return; }
    const reader = new FileReader();
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.csv')) {
        reader.onload = (e) => loadFromCsv(e.target.result);
        reader.readAsText(file, 'UTF-8');
        showToast("📂 กำลังโหลดข้อมูลจากไฟล์ CSV...", 'info');
    } else if (fileName.endsWith('.json')) {
        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                let finalDataToMerge = null;
                
                if (importedData && importedData.isEncrypted === true) {
                    const password = prompt("ไฟล์นี้ถูกเข้ารหัส กรุณากรอกรหัสผ่านเพื่อถอดรหัส:");
                    if (!password) { 
                        showToast("❌ ยกเลิกการนำเข้าไฟล์", 'info'); 
                        event.target.value = ''; 
                        return; 
                    }
                    showToast('🔓 กำลังถอดรหัส...', 'info');
                    const decryptedString = await decryptData(importedData, password);
                    if (decryptedString) {
                        finalDataToMerge = JSON.parse(decryptedString);
                        showToast('✅ ถอดรหัสสำเร็จ!', 'success');
                    } else {
                        showToast("❌ ถอดรหัสล้มเหลว! รหัสผ่านอาจไม่ถูกต้อง", 'error'); 
                        event.target.value = ''; 
                        return;
                    }
                } else {
                    finalDataToMerge = importedData;
                }
                
                if (finalDataToMerge.accounts && Array.isArray(finalDataToMerge.accounts)) {
                    if(confirm("ไฟล์นี้เป็นไฟล์บันทึกข้อมูล JSON ทั้งหมด ต้องการโหลดข้อมูลทั้งหมดทับของเดิมหรือไม่?")) {
                        accounts = finalDataToMerge.accounts;
                        records = finalDataToMerge.records;
                        accountTypes = new Map(finalDataToMerge.accountTypes);
                        currentAccount = finalDataToMerge.currentAccount;
                        // ✅ โหลด dailySummaryData (ถ้ามี)
                        dailySummaryData = finalDataToMerge.dailySummaryData || {};
                        showToast("✅ โหลดข้อมูลทั้งหมดจาก JSON สำเร็จ", 'success');
                    }
                } else if (finalDataToMerge.isDailyExport === true) {
                    const { accountName, exportDate, records: recordsToAdd } = finalDataToMerge;
                    const confirmMsg = `ไฟล์นี้มีข้อมูลของวันที่ ${exportDate} จำนวน ${recordsToAdd.length} รายการ สำหรับบัญชี "${accountName}"\n\nกด OK เพื่อ "เพิ่ม" รายการเหล่านี้ลงในบัญชี (ข้อมูลซ้ำจะถูกข้าม)\nกด Cancel เพื่อยกเลิก`;
                    if (confirm(confirmMsg)) {
                        processDateRangeImport(finalDataToMerge);
                    }
                } else if (finalDataToMerge.isDateRangeExport === true) {
                    const { accountName, exportStartDate, exportEndDate, records: recordsToAdd, accountTypes: importedAccountTypes } = finalDataToMerge;
                    const confirmMsg = `ไฟล์นี้มีข้อมูลของบัญชี "${accountName}" ระหว่างวันที่ ${exportStartDate} ถึง ${exportEndDate} จำนวน ${recordsToAdd.length} รายการ\n\n✅ ไฟล์นี้มีข้อมูลประเภทบัญชีพร้อมใช้งาน\n\nกด OK เพื่อ "เพิ่ม" รายการเหล่านี้ลงในบัญชี (ข้อมูลซ้ำจะถูกข้าม)\nกด Cancel เพื่อยกเลิก`;
                    
                    if (confirm(confirmMsg)) {
                        processDateRangeImport({
                            accountName: accountName,
                            exportStartDate: exportStartDate,
                            exportEndDate: exportEndDate,
                            records: recordsToAdd,
                            accountTypes: importedAccountTypes
                        });
                    }
                } else if (finalDataToMerge.accountName) {
                    const confirmMsg = `ไฟล์นี้เป็นข้อมูลของบัญชี "${finalDataToMerge.accountName}"\n\nกด OK เพื่อ "แทนที่" ข้อมูลทั้งหมดของบัญชีนี้\nกด Cancel เพื่อยกเลิก`;
                    if (confirm(confirmMsg)) {
                        if (!accounts.includes(finalDataToMerge.accountName)) {
                            accounts.push(finalDataToMerge.accountName);
                        }
                        records = records.filter(r => r.account !== finalDataToMerge.accountName);
                        records.push(...(finalDataToMerge.records || []));
                        accountTypes.set(finalDataToMerge.accountName, finalDataToMerge.accountTypes || { "รายรับ": [], "รายจ่าย": [] });
                        currentAccount = finalDataToMerge.accountName;
                        // ✅ คำนวณ dailySummaryData ใหม่หลังจากนำเข้า
                        calculateDailySummaries();
                        showToast(`✅ แทนที่ข้อมูลบัญชี "${finalDataToMerge.accountName}" สำเร็จ`, 'success');
                    }
                } else {
                    throw new Error("รูปแบบไฟล์ JSON ไม่ถูกต้อง");
                }
                
                updateAccountSelect();
                if (currentAccount) {
                    document.getElementById('accountSelect').value = currentAccount;
                }
                changeAccount();
                saveDataAndShowToast();
                updateMultiAccountSelector();
               
                
            } catch (error) {
                showToast("❌ ไฟล์ JSON ไม่ถูกต้องหรือเสียหาย: " + error.message, 'error');
            }
        };
        reader.readAsText(file);
    } else {
        showToast("❌ กรุณาเลือกไฟล์ .json หรือ .csv เท่านั้น", 'error');
    }
    reader.onerror = () => showToast("❌ เกิดข้อผิดพลาดในการอ่านไฟล์", 'error');
    event.target.value = '';
}

/**
 * ดำเนินการนำเข้าข้อมูลตามช่วงวันที่
 */
async function processDateRangeImport(importedData) {
    const { accountName, exportStartDate, exportEndDate, records: recordsToAdd, accountTypes: importedAccountTypes } = importedData;
    
    if (!accounts.includes(accountName)) { accounts.push(accountName); }
    if (importedAccountTypes) { accountTypes.set(accountName, importedAccountTypes); }
    else { initializeAccountTypes(accountName); }
    
    let addedCount = 0;
    let skippedCount = 0;
    
    recordsToAdd.forEach(recordToAdd => {
        const isDuplicate = records.some(existingRecord =>
            existingRecord.account === accountName &&
            existingRecord.dateTime === recordToAdd.dateTime &&
            existingRecord.amount === recordToAdd.amount &&
            existingRecord.description === recordToAdd.description &&
            existingRecord.type === recordToAdd.type
        );
        if (!isDuplicate) {
            records.push({ ...recordToAdd, account: accountName });
            addedCount++;
        } else {
            skippedCount++;
        }
    });
    
    currentAccount = accountName;
    updateAccountSelect();
    document.getElementById('accountSelect').value = currentAccount;
    changeAccount();
    
    // ✅ คำนวณ dailySummaryData ใหม่
    calculateDailySummaries();
    
    saveToLocal();
    if (currentUser) {
        showToast(`⏳ นำเข้าสำเร็จ ${addedCount} รายการ.. กำลังอัปโหลด...`, 'info');
        try {
            await saveToFirebase();
            showToast(`✅ อัปโหลดข้อมูลนำเข้าขึ้น Server เรียบร้อย`, 'success');
        } catch (error) {
            showToast(`⚠️ นำเข้าลงเครื่องแล้ว แต่อัปโหลดไม่สำเร็จ`, 'warning');
        }
    } else {
        showToast(`✅ เติมข้อมูลสำเร็จ! (${addedCount} รายการ)`, 'success');
    }
}

/**
 * สร้างข้อความยืนยันการนำเข้า
 */
function createImportConfirmationMessage(accountName, startDate, endDate, recordCount) {
    return `ไฟล์นี้มีข้อมูลของบัญชี "${accountName}" ระหว่างวันที่ ${startDate} ถึง ${endDate} จำนวน ${recordCount} รายการ\n\nกด OK เพื่อ "เพิ่ม" รายการเหล่านี้ลงในบัญชี (ข้อมูลซ้ำจะถูกข้าม)\nกด Cancel เพื่อยกเลิก`;
}

/**
 * ผสานข้อมูลที่นำเข้า
 */
function mergeImportedRecords(accountName, recordsToAdd) {
    if (!accounts.includes(accountName)) {
        accounts.push(accountName);
    }
    
    let addedCount = 0;
    let skippedCount = 0;
    
    recordsToAdd.forEach(recordToAdd => {
        const isDuplicate = isRecordDuplicate(accountName, recordToAdd);
        
        if (!isDuplicate) {
            records.push({ ...recordToAdd, account: accountName });
            addedCount++;
        } else {
            skippedCount++;
        }
    });
    
    return { addedCount, skippedCount };
}

/**
 * ตรวจสอบว่ารายการซ้ำหรือไม่
 */
function isRecordDuplicate(accountName, recordToCheck) {
    return records.some(existingRecord =>
        existingRecord.account === accountName &&
        existingRecord.dateTime === recordToCheck.dateTime &&
        existingRecord.amount === recordToCheck.amount &&
        existingRecord.description === recordToCheck.description &&
        existingRecord.type === recordToCheck.type
    );
}

/**
 * แสดงผลการนำเข้า
 */
function showImportResult(result, accountName) {
    const { addedCount, skippedCount } = result;
    currentAccount = accountName;
    
    showToast(`✅ เติมข้อมูลสำเร็จ!\nเพิ่ม ${addedCount} รายการใหม่\nข้าม ${skippedCount} รายการที่ซ้ำซ้อน`, 'success');
}

/**
 * อัปเดตการเลือกบัญชี
 */
function updateAccountSelection(accountName) {
    updateAccountSelect();
    document.getElementById('accountSelect').value = accountName;
    changeAccount();
}

/**
 * นำเข้าจากไฟล์สำหรับการผสานข้อมูล
 */
function importFromFileForMerging(event) {
    const file = event.target.files[0];
    if (!file) { return; }
    if (!currentAccount) {
        showToast("❌ กรุณาเลือกบัญชีปัจจุบัน (บัญชีปลายทาง) ก่อน", 'error');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    const fileName = file.name.toLowerCase();

    const processAndMerge = async (dataString) => {
        try {
            let parsedData = JSON.parse(dataString);
            let finalDataToMerge = null;

            if (parsedData && parsedData.isEncrypted === true) {
                const password = prompt("ไฟล์นี้ถูกเข้ารหัส กรุณากรอกรหัสผ่านเพื่อถอดรหัส:");
                if (!password) { 
                    showToast("❌ ยกเลิกการนำเข้าไฟล์", 'info'); 
                    return; 
                }
                showToast('🔓 กำลังถอดรหัส...', 'info');
                const decryptedString = await decryptData(parsedData, password);
                if (decryptedString) {
                    finalDataToMerge = JSON.parse(decryptedString);
                    showToast('✅ ถอดรหัสสำเร็จ!', 'success');
                } else {
                    showToast("❌ ถอดรหัสล้มเหลว! รหัสผ่านอาจไม่ถูกต้อง", 'error'); 
                    return;
                }
            } else {
                finalDataToMerge = parsedData;
            }

            if (finalDataToMerge && finalDataToMerge.isDailyExport === true) {
                const { exportDate, records: recordsToAdd } = finalDataToMerge;
                
                let addedCount = 0;
                let skippedCount = 0;

                recordsToAdd.forEach(recordToAdd => {
                    const isDuplicate = records.some(existingRecord =>
                        existingRecord.account === currentAccount &&
                        existingRecord.dateTime === recordToAdd.dateTime &&
                        existingRecord.amount === recordToAdd.amount &&
                        existingRecord.description === recordToAdd.description &&
                        existingRecord.type === recordToAdd.type
                    );
                    if (!isDuplicate) {
                        records.push({ ...recordToAdd, account: currentAccount });
                        addedCount++;
                    } else {
                        skippedCount++;
                    }
                });

                displayRecords();
                // ✅ คำนวณ dailySummaryData ใหม่
                calculateDailySummaries();
                saveToLocal();
                
                if (currentUser) {
                    showToast('☁️ กำลังอัปเดตข้อมูลออนไลน์...', 'info');
                    try {
                        await saveToFirebase();
                    } catch (err) {
                        console.error("Auto-sync failed:", err);
                    }
                }

                showToast(`✅ เติมข้อมูลสำเร็จ!\nเพิ่ม ${addedCount} รายการใหม่\nข้าม ${skippedCount} รายการที่ซ้ำซ้อน`, 'success');

            } else {
                showToast("❌ ไฟล์ที่เลือกไม่ใช่ไฟล์ข้อมูลรายวันที่ถูกต้อง\nกรุณาใช้ไฟล์ที่ได้จากการ 'บันทึกเฉพาะวันที่เลือก' เท่านั้น", 'error');
            }
        } catch (error) {
            showToast("❌ ไฟล์ JSON ไม่ถูกต้องหรือเสียหาย: " + error.message, 'error');
        }
    };
    
    if (fileName.endsWith('.json')) {
        reader.onload = (e) => processAndMerge(e.target.result);
        reader.readAsText(file);
        showToast("📂 กำลังโหลดข้อมูลจากไฟล์ JSON...", 'info');
    } else {
        showToast("❌ ฟังก์ชันนี้รองรับเฉพาะไฟล์ .json เท่านั้น", 'error');
    }
    
    reader.onerror = () => showToast("❌ เกิดข้อผิดพลาดในการอ่านไฟล์", 'error');
    event.target.value = '';
}

/**
 * โหลดข้อมูลจาก CSV
 */
function loadFromCsv(csvText) {
    let csvImportData = { 
        isFullBackup: false, 
        isDailyExport: false, 
        isDateRangeExport: false,
        accountName: '', 
        exportDate: '', 
        exportStartDate: '',
        exportEndDate: '',
        types: { "รายรับ": [], "รายจ่าย": [] }, 
        records: [] 
    };
    let inTypesSection = false;
    let inDataSection = false;
    let dataHeaderPassed = false;
    
    Papa.parse(csvText, {
        skipEmptyLines: true,
        step: function(results) {
            const row = results.data;
            const firstCell = (row[0] || '').trim();
            
            if (firstCell === '###ALL_ACCOUNTS_BACKUP_CSV###') {
                csvImportData.isFullBackup = true;
                return;
            }
            if (firstCell.startsWith('isDailyExport:')) {
                csvImportData.isDailyExport = true;
                csvImportData.exportDate = firstCell.split(':')[1].trim();
                return;
            }
            if (firstCell.startsWith('isDateRangeExport:')) {
                csvImportData.isDateRangeExport = true;
                const dateRange = firstCell.split(':')[1].trim();
                const [startDate, endDate] = dateRange.split(' to ');
                csvImportData.exportStartDate = startDate;
                csvImportData.exportEndDate = endDate;
                return;
            }
            if (firstCell === '###ACCOUNT_TYPES_START###') {
                inTypesSection = true; return;
            }
            if (firstCell === '###ACCOUNT_TYPES_END###') {
                inTypesSection = false; return;
            }
            if (firstCell === '###DATA_START###') {
                inDataSection = true; return;
            }
            
            if (inTypesSection && row.length >= 3) {
                const accName = row[0];
                const category = row[1];
                const types = row.slice(2).filter(t => t.trim() !== '');
                if (!csvImportData.accountName) csvImportData.accountName = accName;
                if (category === 'รายรับ' || category === 'รายจ่าย') csvImportData.types[category] = types;
                return;
            }
            
            if (inDataSection) {
                if (!dataHeaderPassed) { dataHeaderPassed = true; return; }
                if (row.length >= 5) {
                    const [dateStr, timeStr, type, description, amountStr] = row;
                    const amount = parseFloat(amountStr.replace(/[^\d.-]/g, ''));
                    if (!isNaN(amount)) {
                        const [day, month, year] = dateStr.split('/');
                        const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                        const timeParts = timeStr.replace(' น.', '').split('.');
                        const formattedTime = `${timeParts[0].padStart(2, '0')}:${timeParts[1].padStart(2, '0')}`;
                        const dateTime = `${formattedDate} ${formattedTime}`;
                        csvImportData.records.push({
                            dateTime, type, description, amount,
                            account: csvImportData.accountName
                        });
                    }
                }
            }
        },
        complete: async function() {
            if (csvImportData.isFullBackup) {
                 if(confirm("ไฟล์นี้เป็นไฟล์ CSV Backup ทั้งหมด ต้องการโหลดทับหรือไม่?")) {
                    showToast('⚠️ แนะนำให้ใช้ไฟล์ JSON สำหรับการกู้คืนข้อมูลทั้งหมด', 'warning');
                 }
            } else if (csvImportData.isDailyExport) {
                const { accountName, exportDate, records: recordsToAdd } = csvImportData;
                 const confirmMsg = `ไฟล์ CSV นี้นำเข้าข้อมูลวันที่ ${exportDate} ของบัญชี "${accountName}" จำนวน ${recordsToAdd.length} รายการ\n\nกด OK เพื่อเพิ่มรายการ`;
                 if (confirm(confirmMsg)) {
                     processDateRangeImport({
                        accountName: accountName,
                        exportStartDate: exportDate, 
                        exportEndDate: exportDate,
                        records: recordsToAdd
                    });
                 }
            } else if (csvImportData.isDateRangeExport) {
                const { accountName, exportStartDate, exportEndDate, records: recordsToAdd } = csvImportData;
                const confirmMsg = `ไฟล์ CSV นี้นำเข้าข้อมูลช่วงวันที่ ${exportStartDate} ถึง ${exportEndDate} จำนวน ${recordsToAdd.length} รายการ\n\nกด OK เพื่อเพิ่มรายการ`;
                
                if (confirm(confirmMsg)) {
                    processDateRangeImport({
                        accountName: accountName,
                        exportStartDate: exportStartDate,
                        exportEndDate: exportEndDate,
                        records: recordsToAdd
                    });
                }
            } else if (csvImportData.accountName) {
                 const confirmMsg = `ไฟล์ CSV นี้เป็นข้อมูลบัญชี "${csvImportData.accountName}"\nกด OK เพื่อ "แทนที่" ข้อมูลบัญชีนี้ทั้งหมด`;
                 if (confirm(confirmMsg)) {
                    if (!accounts.includes(csvImportData.accountName)) {
                        accounts.push(csvImportData.accountName);
                    }
                    records = records.filter(r => r.account !== csvImportData.accountName);
                    records.push(...(csvImportData.records || []));
                    
                    if(csvImportData.types["รายรับ"].length > 0 || csvImportData.types["รายจ่าย"].length > 0) {
                         accountTypes.set(csvImportData.accountName, csvImportData.types);
                    } else {
                         initializeAccountTypes(csvImportData.accountName);
                    }

                    currentAccount = csvImportData.accountName;
                    updateAccountSelect();
                    document.getElementById('accountSelect').value = currentAccount;
                    changeAccount();
                    
                    // ✅ คำนวณ dailySummaryData ใหม่
                    calculateDailySummaries();
                    
                    saveToLocal();
                    if (currentUser) {
                        showToast('☁️ กำลังอัปเดตข้อมูลออนไลน์...', 'info');
                        await saveToFirebase();
                    }
                    showToast(`✅ นำเข้าข้อมูล CSV บัญชี "${csvImportData.accountName}" สำเร็จ`, 'success');
                 }
            } else {
                showToast('❌ รูปแบบไฟล์ CSV ไม่ถูกต้อง', 'error');
            }
        }
    });
}

// ==============================================
// ฟังก์ชันจัดการรหัสผ่าน
// ==============================================

/**
 * บันทึกรหัสผ่านสำรอง
 */
async function saveBackupPassword(e) {
    e.preventDefault();
    const newPassword = document.getElementById('backup-password').value;
    const confirmPassword = document.getElementById('backup-password-confirm').value;
    if (newPassword !== confirmPassword) {
        showToast('❌ รหัสผ่านไม่ตรงกัน', 'error');
        return;
    }
    backupPassword = newPassword.trim() || null;
    
    saveToLocal(true);
    if (currentUser) {
        showToast('⏳ กำลังบันทึกรหัสผ่านไปยัง Server...', 'info');
        await saveToFirebase();
        showToast('✅ ตั้งค่ารหัสผ่านบน Server เรียบร้อย', 'success');
    } else {
        renderBackupPasswordStatus();
        showToast('✅ บันทึกรหัสผ่านในเครื่องเรียบร้อย', 'success');
    }
    
    document.getElementById('backup-password').value = '';
    document.getElementById('backup-password-confirm').value = '';
    renderBackupPasswordStatus();
}

/**
 * แสดงสถานะรหัสผ่าน
 */
function renderBackupPasswordStatus() {
    const statusEl = document.getElementById('password-status');
    if (backupPassword) {
        statusEl.textContent = 'สถานะ: มีการตั้งรหัสผ่านแล้ว';
        statusEl.style.color = 'green';
    } else {
        statusEl.textContent = 'สถานะ: ยังไม่มีการตั้งรหัสผ่าน (ไฟล์บันทึกข้อมูลจะไม่ถูกเข้ารหัส)';
        statusEl.style.color = '#f5a623';
    }
}

// ==============================================
// ฟังก์ชันการเข้ารหัส
// ==============================================

/**
 * แปลง ArrayBuffer เป็น Base64
 */
function arrayBufferToBase64(buffer) { 
    let binary = ''; 
    const bytes = new Uint8Array(buffer); 
    const len = bytes.byteLength; 
    for (let i = 0; i < len; i++) { 
        binary += String.fromCharCode(bytes[i]); 
    } 
    return window.btoa(binary); 
}

/**
 * แปลง Base64 เป็น ArrayBuffer
 */
function base64ToArrayBuffer(base64) { 
    const binary_string = window.atob(base64); 
    const len = binary_string.length; 
    const bytes = new Uint8Array(len); 
    for (let i = 0; i < len; i++) { 
        bytes[i] = binary_string.charCodeAt(i); 
    } 
    return bytes.buffer; 
}

/**
 * สร้างคีย์จากรหัสผ่าน
 */
async function deriveKey(password, salt) { 
    const enc = new TextEncoder(); 
    const keyMaterial = await window.crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']); 
    return window.crypto.subtle.deriveKey({ 
        "name": 'PBKDF2', 
        salt: salt, 
        "iterations": 100000, 
        "hash": 'SHA-256' 
    }, keyMaterial, { 
        "name": 'AES-GCM', 
        "length": 256 
    }, true, [ 
        "encrypt", 
        "decrypt" 
    ] ); 
}

/**
 * เข้ารหัสข้อมูล
 */
async function encryptData(dataString, password) { 
    const salt = window.crypto.getRandomValues(new Uint8Array(16)); 
    const iv = window.crypto.getRandomValues(new Uint8Array(12)); 
    const key = await deriveKey(password, salt); 
    const enc = new TextEncoder(); 
    const encodedData = enc.encode(dataString); 
    const encryptedContent = await window.crypto.subtle.encrypt({ 
        name: 'AES-GCM', 
        iv: iv 
    }, key, encodedData); 
    return { 
        isEncrypted: true, 
        salt: arrayBufferToBase64(salt), 
        iv: arrayBufferToBase64(iv), 
        encryptedData: arrayBufferToBase64(encryptedContent) 
    }; 
}

/**
 * ถอดรหัสข้อมูล
 */
async function decryptData(encryptedPayload, password) { 
    try { 
        const salt = base64ToArrayBuffer(encryptedPayload.salt); 
        const iv = base64ToArrayBuffer(encryptedPayload.iv); 
        const data = base64ToArrayBuffer(encryptedPayload.encryptedData); 
        const key = await deriveKey(password, salt); 
        const decryptedContent = await window.crypto.subtle.decrypt({ 
            name: 'AES-GCM', 
            iv: iv 
        }, key, data); 
        const dec = new TextDecoder(); 
        return dec.decode(decryptedContent); 
    } catch (e) { 
        console.error("Decryption failed:", e); 
        return null; 
    } 
}

// ==============================================
// ฟังก์ชันส่งออก Summary เป็น XLSX
// ==============================================

/**
 * ส่งออกสรุปเป็น XLSX
 */
function exportSummaryToXlsx(summaryResult, title, dateString, remark, transactionDaysInfo = null, periodName, daysDiff = 0, activeDays = 0) {
    const { summary, periodRecords, totalBalance } = summaryResult;
    
    const wb = XLSX.utils.book_new();
    
    let excelData = [];
    
    const summaryDateTime = new Date().toLocaleString("th-TH", { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit'
    }) + ' น.';
    
    excelData.push(['สรุปข้อมูลบัญชี']);
    excelData.push(['ชื่อบัญชี:', currentAccount]);
    excelData.push(['สรุปเมื่อวันที่:', summaryDateTime]);
    excelData.push([`${title} :`, dateString]);
    excelData.push([]);
    
    if (transactionDaysInfo) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = transactionDaysInfo;
        const pElements = tempDiv.querySelectorAll('p');
        pElements.forEach(p => {
            excelData.push([p.innerText]);
        });
        excelData.push([]);
    }
    
    excelData.push(['รายรับ :', `${summary.incomeCount} ครั้ง เป็นเงิน ${summary.totalIncome.toLocaleString()} บาท`]);
    for (const type in summary.income) {
        excelData.push([`- ${type} : ${summary.income[type].count} ครั้ง เป็นเงิน ${summary.income[type].amount.toLocaleString()} บาท`]);
    }
    excelData.push([]);
    
    excelData.push(['รายจ่าย :', `${summary.expenseCount} ครั้ง เป็นเงิน ${summary.totalExpense.toLocaleString()} บาท`]);
    for (const type in summary.expense) {
        excelData.push([`- ${type} : ${summary.expense[type].count} ครั้ง เป็นเงิน ${summary.expense[type].amount.toLocaleString()} บาท`]);
    }
    excelData.push([]);
    
    const netAmount = summary.totalIncome - summary.totalExpense;
    let comparisonText = '';
    
    if (summary.totalIncome > summary.totalExpense) {
        comparisonText = `รายได้มากกว่ารายจ่าย = ${netAmount.toLocaleString()} บาท`;
    } else if (summary.totalIncome < summary.totalExpense) {
        comparisonText = `รายจ่ายมากกว่ารายได้ = ${Math.abs(netAmount).toLocaleString()} บาท`;
    } else {
        comparisonText = 'รายได้เท่ากับรายจ่าย';
    }
    
    if (summary.totalIncome === 0 && summary.totalExpense === 0) {
        excelData.push(['สรุป :', 'ไม่มีธุรกรรมการเงิน']);
    } else {
        excelData.push(['สรุป :', comparisonText]);
    }
    
    if (periodName === 'ทั้งหมด' || periodName.includes('ถึง')) {
        excelData.push(['เงินในบัญชีถึงวันนี้มี =', `${totalBalance.toLocaleString()} บาท`]);
    } else {
        excelData.push(['เงินคงเหลือในบัญชีทั้งหมด =', `${totalBalance.toLocaleString()} บาท`]);
    }

    const totalTransactionCount = summary.incomeCount + summary.expenseCount;
    excelData.push(['ธุรกรรมทั้งหมด :', `${totalTransactionCount} ครั้ง`]);
    
    if (activeDays && activeDays >= 1) {
        const netTotal = summary.totalIncome - summary.totalExpense;
        const avgNet = netTotal / activeDays;
        let avgText = "";

        if (avgNet > 0) {
            avgText = `รายได้มากกว่ารายจ่ายเฉลี่ย : ${avgNet.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} บาท/วัน`;
        } else if (avgNet < 0) {
            avgText = `รายจ่ายมากกว่ารายได้เฉลี่ย : ${Math.abs(avgNet).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} บาท/วัน`;
        } else {
            avgText = `รายได้เท่ากับรายจ่ายเฉลี่ย : 0.00 บาท/วัน`;
        }

        excelData.push([]);
        excelData.push([`สรุปค่าเฉลี่ย (คำนวณจาก ${activeDays} วันที่ทำธุรกรรม) :`]);
        excelData.push([`- ${avgText}`]);
    }
    
    excelData.push(['ข้อความเพิ่ม :', remark]);
    excelData.push([]);
    
    if (periodRecords.length > 0) {
        excelData.push(['--- รายการธุรกรรม ---']);
        excelData.push(['วันที่', 'เวลา', 'ประเภท', 'รายละเอียด', 'จำนวนเงิน (บาท)']);
        
        periodRecords.forEach(record => {
            const { formattedDate, formattedTime } = formatDateForDisplay(record.dateTime);
            
            excelData.push([
                formattedDate, 
                formattedTime, 
                record.type, 
                record.description, 
                record.amount.toLocaleString()
            ]);
        });
    }
    
    const ws = XLSX.utils.aoa_to_sheet(excelData);
    
    const colWidths = [
        {wch: 15},
        {wch: 30},
        {wch: 15},
        {wch: 30},
        {wch: 20}
    ];
    ws['!cols'] = colWidths;
    
    ws['!pageSetup'] = {
        orientation: 'portrait',
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: {
            left: 0.7, right: 0.7,
            top: 0.75, bottom: 0.75,
            header: 0.3, footer: 0.3
        }
    };
    
    if (!ws['!merges']) ws['!merges'] = [];
    ws['!merges'].push({s: {r: 0, c: 0}, e: {r: 0, c: 4}});
    
    XLSX.utils.book_append_sheet(wb, ws, "สรุปข้อมูลบัญชี");
    
    const fileName = `สรุป_${currentAccount}_${periodName}_${new Date().getTime()}.xlsx`;
    
    XLSX.writeFile(wb, fileName);
}

/**
 * ใช้สไตล์ Excel
 */
function applyExcelStyles(ws, data) {
    if (!ws['!merges']) ws['!merges'] = [];
    
    ws['!merges'].push({s: {r: 0, c: 0}, e: {r: 0, c: 4}});
    
    if (!ws['!cols']) ws['!cols'] = [];
    ws['!cols'][0] = {wch: 25};
    ws['!cols'][1] = {wch: 35};
    ws['!cols'][2] = {wch: 15};
    ws['!cols'][3] = {wch: 30};
    ws['!cols'][4] = {wch: 20};
    
    return ws;
}

// ==============================================
// [✅ เพิ่ม] ฟังก์ชันสร้าง HTML สำหรับ Modal ของ สรุปรายวัน
// ==============================================
function buildDailySummaryHtml(context, isPdf = false) {
    const { startDateStr, endDateStr, activeDaysCount, filteredData, title, remark } = context;

    const startObj = new Date(startDateStr); startObj.setHours(0, 0, 0, 0);
    const endObj = new Date(endDateStr); endObj.setHours(23, 59, 59, 999);
    
    // อาศัย generateSummaryData ในการดึงยอดรวม
    const summaryResult = generateSummaryData(startObj, endObj);
    if (!summaryResult) return "";
    const summary = summaryResult.summary;

    const summaryDateTime = new Date().toLocaleString("th-TH", {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) + ' น.';

    const startThai = formatThaiDate(startDateStr);
    const endThai = formatThaiDate(endDateStr);
    const calculatedTotalDays = Math.round((new Date(endDateStr).setHours(0, 0, 0, 0) - new Date(startDateStr).setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24)) + 1;
    const inactiveDaysCount = calculatedTotalDays - activeDaysCount;

    const pStyle = isPdf ? 'style="line-height: 0.5;"' : '';
    const listStyle = isPdf ? 'style="margin-left: 15px; line-height: 0.5;"' : '';

    // สร้างรายละเอียดรายรับรายจ่าย
    let incomeHTML = '';
    for (const typeKey in summary.income) {
        incomeHTML += `<p ${listStyle}>- ${typeKey} : ${summary.income[typeKey].count} ครั้ง เป็นเงิน ${summary.income[typeKey].amount.toLocaleString()} บาท</p>`;
    }

    let expenseHTML = '';
    for (const typeKey in summary.expense) {
        expenseHTML += `<p ${listStyle}>- ${typeKey} : ${summary.expense[typeKey].count} ครั้ง เป็นเงิน ${summary.expense[typeKey].amount.toLocaleString()} บาท</p>`;
    }

    // หักลบยอด
    let comparisonText = '';
    let differenceAmount = 0;
    if (summary.totalIncome > summary.totalExpense) {
        differenceAmount = summary.totalIncome - summary.totalExpense;
        comparisonText = `<span style="color: blue;">รายได้มากกว่ารายจ่าย = ${differenceAmount.toLocaleString()} บาท</span>`;
    } else if (summary.totalIncome < summary.totalExpense) {
        differenceAmount = summary.totalExpense - summary.totalIncome;
        comparisonText = `<span style="color: red;">รายจ่ายมากกว่ารายได้ = ${differenceAmount.toLocaleString()} บาท</span>`;
    } else {
        comparisonText = 'รายได้เท่ากับรายจ่าย';
    }

    // สร้างตารางแต่ละวัน
    const sortedDates = Object.keys(filteredData).sort((a, b) => new Date(b) - new Date(a));
    let tableHTML = `
    <div style="margin-top: 20px;">
        <h4 style="border-bottom: 1px solid #ddd; padding-bottom: 5px;" ${pStyle}>ตารางสรุปผลแต่ละวัน</h4>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px; text-align: center;">
            <thead>
                <tr style="background-color: #f2f2f2;">
                    <th style="padding: 8px; border: 1px solid #ddd;">วันที่</th>
                    <th style="padding: 8px; border: 1px solid #ddd;">รายได้</th>
                    <th style="padding: 8px; border: 1px solid #ddd;">รายจ่าย</th>
                    <th style="padding: 8px; border: 1px solid #ddd;">คงเหลือ</th>
                </tr>
            </thead>
            <tbody>
    `;

    sortedDates.forEach(date => {
        const sum = filteredData[date];
        const diff = sum.income - sum.expense;
        tableHTML += `
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">${formatThaiDate(date)}</td>
                <td style="padding: 8px; border: 1px solid #ddd; color: #28a745; font-weight: bold;">${sum.income.toLocaleString()}</td>
                <td style="padding: 8px; border: 1px solid #ddd; color: #dc3545; font-weight: bold;">${sum.expense.toLocaleString()}</td>
                <td style="padding: 8px; border: 1px solid #ddd; color: ${diff >= 0 ? '#28a745' : '#dc3545'}; font-weight: bold;">${diff.toLocaleString()}</td>
            </tr>
        `;
    });
    tableHTML += `</tbody></table></div>`;

    return `
        <p ${pStyle}><strong>ชื่อบัญชี:</strong> ${currentAccount}</p>
        <p ${pStyle}><strong>สรุปเมื่อวันที่ : </strong> ${summaryDateTime}</p>
        <p ${pStyle}><strong>${title} : </strong> ${startDateStr === endDateStr ? startThai : `${startThai} ถึง ${endThai}`}</p>
        <p ${pStyle}>จำนวนทั้งหมด ${calculatedTotalDays} วัน (ทำธุรกรรม ${activeDaysCount} วัน, ไม่ได้ทำ ${inactiveDaysCount} วัน)</p>
        <hr style="border: 0.5px solid green;">
        <p ${pStyle}><strong>รายรับ : </strong> ${summary.incomeCount} ครั้ง เป็นเงิน ${summary.totalIncome.toLocaleString()} บาท</p>
        ${incomeHTML}
        <hr style="border: 0.5px solid green;">
        <p ${pStyle}><strong>รายจ่าย : </strong> ${summary.expenseCount} ครั้ง เป็นเงิน ${summary.totalExpense.toLocaleString()} บาท</p>
        ${expenseHTML}
        <hr style="border: 0.5px solid green;">
        <p ${pStyle}><strong>สรุป : </strong> ${comparisonText}</p>
        
        <p ${pStyle}>ข้อความเพิ่ม : <span style="color: orange;">${remark}</span></p>
        ${tableHTML}
    `;
}

// ==============================================
// [✅ เพิ่ม] ฟังก์ชันบันทึก XLSX สำหรับ สรุปรายวัน
// ==============================================
function exportDailySummaryToXlsx(context) {
    const { startDateStr, endDateStr, activeDaysCount, filteredData, title, remark } = context;

    const startObj = new Date(startDateStr); startObj.setHours(0, 0, 0, 0);
    const endObj = new Date(endDateStr); endObj.setHours(23, 59, 59, 999);
    const summaryResult = generateSummaryData(startObj, endObj);
    if (!summaryResult) return;
    const summary = summaryResult.summary;

    const wb = XLSX.utils.book_new();
    let excelData = [];

    const summaryDateTime = new Date().toLocaleString("th-TH", {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) + ' น.';

    const startThai = formatThaiDate(startDateStr);
    const endThai = formatThaiDate(endDateStr);
    const calculatedTotalDays = Math.round((new Date(endDateStr).setHours(0, 0, 0, 0) - new Date(startDateStr).setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24)) + 1;
    const inactiveDaysCount = calculatedTotalDays - activeDaysCount;

    excelData.push(['สรุปผลแต่ละวัน']);
    excelData.push(['ชื่อบัญชี:', currentAccount]);
    excelData.push(['สรุปเมื่อวันที่:', summaryDateTime]);
    excelData.push([`${title} :`, startDateStr === endDateStr ? startThai : `${startThai} ถึง ${endThai}`]);
    excelData.push(['จำนวนทั้งหมด:', `${calculatedTotalDays} วัน (ทำธุรกรรม ${activeDaysCount} วัน, ไม่ได้ทำ ${inactiveDaysCount} วัน)`]);
    excelData.push([]);

    excelData.push(['รายรับ :', `${summary.incomeCount} ครั้ง เป็นเงิน ${summary.totalIncome.toLocaleString()} บาท`]);
    for (const typeKey in summary.income) {
        excelData.push([`- ${typeKey} : ${summary.income[typeKey].count} ครั้ง เป็นเงิน ${summary.income[typeKey].amount.toLocaleString()} บาท`]);
    }
    excelData.push([]);

    excelData.push(['รายจ่าย :', `${summary.expenseCount} ครั้ง เป็นเงิน ${summary.totalExpense.toLocaleString()} บาท`]);
    for (const typeKey in summary.expense) {
        excelData.push([`- ${typeKey} : ${summary.expense[typeKey].count} ครั้ง เป็นเงิน ${summary.expense[typeKey].amount.toLocaleString()} บาท`]);
    }
    excelData.push([]);

    let comparisonText = '';
    let netAmount = summary.totalIncome - summary.totalExpense;
    if (summary.totalIncome > summary.totalExpense) {
        comparisonText = `รายได้มากกว่ารายจ่าย = ${netAmount.toLocaleString()} บาท`;
    } else if (summary.totalIncome < summary.totalExpense) {
        comparisonText = `รายจ่ายมากกว่ารายได้ = ${Math.abs(netAmount).toLocaleString()} บาท`;
    } else {
        comparisonText = 'รายได้เท่ากับรายจ่าย';
    }
    excelData.push(['สรุป :', comparisonText]);
    excelData.push(['ข้อความเพิ่ม :', remark]);
    excelData.push([]);

    excelData.push(['--- ตารางสรุปผลแต่ละวัน ---']);
    excelData.push(['วันที่', 'รายได้ (บาท)', 'รายจ่าย (บาท)', 'คงเหลือ (บาท)']);

    const sortedDates = Object.keys(filteredData).sort((a, b) => new Date(b) - new Date(a));
    sortedDates.forEach(date => {
        const sum = filteredData[date];
        const diff = sum.income - sum.expense;
        excelData.push([
            formatThaiDate(date),
            sum.income,
            sum.expense,
            diff
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(excelData);

    const colWidths = [ {wch: 25}, {wch: 25}, {wch: 25}, {wch: 25} ];
    ws['!cols'] = colWidths;

    if (!ws['!merges']) ws['!merges'] = [];
    ws['!merges'].push({s: {r: 0, c: 0}, e: {r: 0, c: 3}});

    XLSX.utils.book_append_sheet(wb, ws, "สรุปผลแต่ละวัน");

    const fileName = `สรุปรายวัน_${currentAccount}_${startDateStr}_ถึง_${endDateStr}.xlsx`;
    XLSX.writeFile(wb, fileName);
}

// ==============================================
// ฟังก์ชันจัดการ PWA
// ==============================================

/**
 * ซ่อนปุ่มติดตั้ง PWA
 */
function hideInstallPrompt() { 
    const installGuide = document.getElementById('install-guide'); 
    if (installGuide) { 
        installGuide.style.display = 'none'; 
    } 
}

// ==============================================
// ฟังก์ชันตั้งค่าปุ่ม Enter
// ==============================================

/**
 * ตั้งค่าปุ่ม Enter ในฟอร์มเพิ่มข้อมูล
 */
function setupEnterKeyForAddEntry() {
    const amountInput = document.getElementById('amount');
    const typeInput = document.getElementById('type');
    const descriptionInput = document.getElementById('description');
    
    const inputs = [amountInput, typeInput, descriptionInput];
    
    inputs.forEach(input => {
        if (input) {
            input.addEventListener('keydown', function(event) {
                if (event.key === 'Enter' || event.keyCode === 13) {
                    event.preventDefault(); 
                    
                    addEntry();
                    
                    if (input.id === 'type') {
                        restoreType(typeInput);
                    }
                }
            });
        }
    });
}

// ==============================================
// ฟังก์ชันเปลี่ยนรหัสผ่าน Firebase
// ==============================================

/**
 * เปิดโมดอลเปลี่ยนรหัสผ่าน
 */
function openChangePasswordModal() {
    if (!currentUser) {
        showToast("❌ คุณยังไม่ได้เข้าสู่ระบบ", 'error');
        return;
    }
    document.getElementById('oldFirebasePassword').value = '';
    document.getElementById('newFirebasePassword').value = '';
    document.getElementById('confirmFirebasePassword').value = '';
    
    ['oldFirebasePassword', 'newFirebasePassword', 'confirmFirebasePassword'].forEach(id => {
        document.getElementById(id).type = 'password';
    });
    
    document.getElementById('changePasswordModal').style.display = 'flex';
}

/**
 * ปิดโมดอลเปลี่ยนรหัสผ่าน
 */
function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').style.display = 'none';
}

/**
 * สลับการแสดงรหัสผ่าน
 */
function toggleInputPassword(inputId) {
    const input = document.getElementById(inputId);
    if (input.type === "password") {
        input.type = "text";
    } else {
        input.type = "password";
    }
}

/**
 * ดำเนินการเปลี่ยนรหัสผ่าน
 */
async function handleChangePassword() {
    const oldPass = document.getElementById('oldFirebasePassword').value;
    const newPass = document.getElementById('newFirebasePassword').value;
    const confirmPass = document.getElementById('confirmFirebasePassword').value;

    if (!oldPass) {
        showToast("❌ กรุณากรอกรหัสผ่านเดิมเพื่อยืนยันตัวตน", 'warning');
        return;
    }
    if (newPass.length < 6) {
        showToast("❌ รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร", 'warning');
        return;
    }
    if (newPass !== confirmPass) {
        showToast("❌ รหัสผ่านใหม่และการยืนยันไม่ตรงกัน", 'error');
        return;
    }
    if (oldPass === newPass) {
        showToast("❌ รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม", 'warning');
        return;
    }

    if (!currentUser) {
        showToast("❌ ไม่พบผู้ใช้งาน กรุณาล็อกอินใหม่", 'error');
        closeChangePasswordModal();
        return;
    }

    try {
        showToast("⏳ กำลังตรวจสอบรหัสผ่านเดิม...", 'info');

        const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, oldPass);

        await currentUser.reauthenticateWithCredential(credential);

       showToast("⏳ รหัสเดิมถูกต้อง กำลังเปลี่ยนรหัสผ่าน...", 'info');

        await currentUser.updatePassword(newPass);
        
        showToast("✅ เปลี่ยนรหัสผ่านสำเร็จ! กรุณาล็อกอินใหม่ด้วยรหัสใหม่", 'success');
        closeChangePasswordModal();

    } catch (error) {
        console.error("Change password error:", error);
        
        if (error.code === 'auth/wrong-password') {
            showToast("❌ รหัสผ่านเดิมไม่ถูกต้อง", 'error');
        } else if (error.code === 'auth/weak-password') {
            showToast("❌ รหัสผ่านง่ายเกินไป", 'error');
        } else if (error.code === 'auth/too-many-requests') {
            showToast("❌ ทำรายการถี่เกินไป โปรดรอสักครู่", 'error');
        } else {
            showToast(`❌ เกิดข้อผิดพลาด: ${error.message}`, 'error');
        }
    }
}

// ==============================================
// [🔧 เพิ่มใหม่] ฟังก์ชันสลับโหมดสำหรับการสรุปแบบกำหนดเอง
// ==============================================
// ฟังก์ชันสลับโหมดสำหรับการสรุปแบบกำหนดเอง
function toggleGeneralSummaryMode() {
    const mode = document.querySelector('input[name="summaryMode"]:checked').value;
    const rangeContainer = document.getElementById('generalRangeContainer');
    const lastXContainer = document.getElementById('generalLastXContainer');
    const previewContainer = document.getElementById('generalLastXPreview');
    
    if (mode === 'lastX') {
        if(rangeContainer) rangeContainer.style.display = 'none';
        if(lastXContainer) lastXContainer.style.display = 'block';
    } else {
        if(rangeContainer) rangeContainer.style.display = 'block';
        if(lastXContainer) lastXContainer.style.display = 'none';
    }
    
    // เคลียร์ข้อความพรีวิวทุกครั้งที่สลับโหมด
    if(previewContainer) previewContainer.innerHTML = '';
}

// ==============================================
// [🔧 แก้ไข] ฟังก์ชันคำนวณช่วงวันที่สำหรับ X วันล่าสุด (โหมดสรุปวันที่ถึงวันที่)
// ==============================================
/**
 * คำนวณช่วงวันที่สำหรับ X วันล่าสุด (โหมดสรุปวันที่ถึงวันที่)
 */
function calculateGeneralLastXRange() {
    const daysInput = document.getElementById('summaryLastXDays').value;
    const days = parseInt(daysInput);
    
    if (!days || days <= 0) {
        showToast('⚠️ กรุณาระบุจำนวนวันที่ต้องการย้อนหลังให้ถูกต้อง', 'error');
        return;
    }
    
    // ✅ อัปเดต: ให้ใช้วันล่าสุดที่มีข้อมูล (เหมือนกับฝั่งสรุปรายวัน)
    if (!dailySummaryData || Object.keys(dailySummaryData).length === 0) {
        // บังคับให้คำนวณใหม่เผื่อยังไม่มีข้อมูล
        calculateDailySummaries(); 
        if (Object.keys(dailySummaryData).length === 0) {
            showToast('⚠️ ไม่มีข้อมูลในบัญชีนี้สำหรับคำนวณ', 'error');
            return;
        }
    }
    
    // ดึงวันล่าสุดที่มีข้อมูลจาก dailySummaryData
    const dates = Object.keys(dailySummaryData).sort();
    const endDateStr = dates[dates.length - 1]; // วันที่มากที่สุด (ล่าสุด)
    
    // ✅ แยกปี เดือน วัน เพื่อสร้าง Date Object ให้ตรงกับ Timezone ท้องถิ่นแบบ 100%
    const [ey, em, ed] = endDateStr.split('-').map(Number);
    const endObj = new Date(ey, em - 1, ed);
    const startObj = new Date(ey, em - 1, ed);
    startObj.setDate(endObj.getDate() - days + 1);
    
    // แปลงกลับเป็น YYYY-MM-DD
    const sy = startObj.getFullYear();
    const sm = String(startObj.getMonth() + 1).padStart(2, '0');
    const sd = String(startObj.getDate()).padStart(2, '0');
    const startStr = `${sy}-${sm}-${sd}`;
    
    // เซ็ตค่าลงในช่อง Input แบบเงียบๆ เพื่อให้ฟังก์ชัน summarize() ดึงไปใช้ต่อได้ทันที
    document.getElementById('startDate').value = startStr;
    document.getElementById('endDate').value = endDateStr;
    
    // แปลงเป็นวันที่แบบไทยเพื่อแสดงผล Preview ให้สวยงาม
    const thaiStart = startObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
    const thaiEnd = endObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
    
    // แสดงพรีวิว
    document.getElementById('generalLastXPreview').innerHTML = `ช่วงวันที่: ${thaiStart} ถึง ${thaiEnd}`;
    
    showToast('✅ คำนวณช่วงวันที่เรียบร้อย', 'success');
}

// ==============================================
// ฟังก์ชันเริ่มต้น (onload)
// ==============================================

window.onload = function () {
    document.getElementById('detailsSection').style.display = 'none';
    
    // เปลี่ยนจาก setCurrentDateTime เป็น startRealTimeClock เพื่อให้นาฬิกาเดินตลอด
    startRealTimeClock();
    
    document.getElementById('backup-password-form').addEventListener('submit', saveBackupPassword);
    document.getElementById('show-backup-password').addEventListener('change', (e) => {
        document.getElementById('backup-password').type = e.target.checked ? 'text' : 'password';
        document.getElementById('backup-password-confirm').type = e.target.checked ? 'text' : 'password';
    });
    
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('summaryModal');
        if (event.target == modal) { 
            closeSummaryModal(); 
        }
    });
    
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone || localStorage.getItem('pwa_installed') === 'true') {
        hideInstallPrompt();
    }
    
    console.log('Menu functions loaded:', {
        toggleMainSection: typeof toggleMainSection,
        toggleSubSection: typeof toggleSubSection
    });
    
    setupEnterKeyForAddEntry(); 
    
    // ตั้งค่าเริ่มต้นสำหรับโหมดสรุปแต่ละวัน
    if (typeof toggleDailyMode === 'function') {
        toggleDailyMode();
    }
    
    // ตั้งค่าเริ่มต้นสำหรับโหมดสรุปทั่วไป
    if (typeof toggleGeneralSummaryMode === 'function') {
        toggleGeneralSummaryMode();
    }
    
    setTimeout(() => {
        toggleMainSection('account-section');
        
        if (!currentUser) {
            loadFromLocal();
        }
        
        // ✅ คำนวณ dailySummaryData หลังจากโหลดข้อมูล
        if (currentAccount) {
            calculateDailySummaries();
        }
    }, 500);
};

window.addEventListener('appinstalled', () => { 
    console.log('App was installed.'); 
    hideInstallPrompt(); 
    localStorage.setItem('pwa_installed', 'true'); 
    showToast('✅ ติดตั้งแอปพลิเคชันสำเร็จ!', 'success');
});

// ✅ เพิ่ม event listener สำหรับการเปลี่ยนแปลงข้อมูลเพื่ออัปเดต dailySummaryData
document.addEventListener('DOMContentLoaded', function() {
    // ดักจับการเปลี่ยนแปลงข้อมูล
    const observer = new MutationObserver(function(mutations) {
        // เมื่อมีการเปลี่ยนแปลงใน recordBody (ตารางข้อมูล)
        if (currentAccount) {
            calculateDailySummaries();
        }
    });
    
    const recordBody = document.getElementById('recordBody');
    if (recordBody) {
        observer.observe(recordBody, { childList: true, subtree: true });
    }
});

// ✅ สร้างฟังก์ชันสำหรับเรียกใช้เมื่อมีการเพิ่ม/แก้ไข/ลบข้อมูล
function refreshDailySummaries() {
    calculateDailySummaries();
}

// ✅ Override ฟังก์ชัน addEntry, deleteRecord เพื่อ refresh summary
const originalAddEntry = addEntry;
addEntry = async function() {
    await originalAddEntry.apply(this, arguments);
    refreshDailySummaries();
};

const originalDeleteRecord = deleteRecord;
deleteRecord = async function(index) {
    await originalDeleteRecord.apply(this, [index]);
    refreshDailySummaries();
};

const originalDeleteRecordsByDate = deleteRecordsByDate;
deleteRecordsByDate = async function() {
    await originalDeleteRecordsByDate.apply(this, arguments);
    refreshDailySummaries();
};

// ==============================================
// ฟังก์ชันสรุปเพิ่มเติม (ต้องมีเพื่อให้ปุ่มทำงาน)
// ==============================================

// [🔧 แก้ไข] ฟังก์ชัน summarizeToday ให้ดึงวันล่าสุดที่มีข้อมูล
function summarizeToday() {
    if (!currentAccount) {
        showToast("❌ กรุณาเลือกบัญชีก่อน", 'error');
        return;
    }

    // ✅ ดึงวันล่าสุดที่มีข้อมูลจริงๆ
    if (!dailySummaryData || Object.keys(dailySummaryData).length === 0) {
        calculateDailySummaries();
        if (Object.keys(dailySummaryData).length === 0) {
            showToast('⚠️ ไม่มีข้อมูลในบัญชีนี้', 'error');
            return;
        }
    }

    // หาวันที่มากที่สุด (ล่าสุด)
    const dates = Object.keys(dailySummaryData).sort();
    const latestDateStr = dates[dates.length - 1]; 

    const startDate = new Date(latestDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(latestDateStr);
    endDate.setHours(23, 59, 59, 999);

    const summaryResult = generateSummaryData(startDate, endDate);
    if (!summaryResult) return;

    const thaiDateString = startDate.toLocaleDateString('th-TH', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });

    // ✅ เพิ่มกล่องรับข้อความหมายเหตุ
    const remarkInput = prompt("กรุณากรอกหมายเหตุ (ถ้าไม่กรอกจะใช้ 'No comment'):", "No comment") || "No comment";

    summaryContext = {
        summaryResult: summaryResult,
        title: 'สรุปข้อมูลวันล่าสุดที่มี', // เปลี่ยนชื่อหัวข้อให้เข้ากับข้อมูลจริง
        dateString: thaiDateString,
        remark: remarkInput,
        type: 'today',
        thaiDateString: thaiDateString,
        headerLine1: 'สรุปวันล่าสุด :',
        headerLine2: 'เงินในบัญชีวันนี้มี =',
        headerLine3: 'รายการวันล่าสุด'
    };

    openSummaryOutputModal();
}

// [🔧 แก้ไข] ฟังก์ชัน summarizeAll (ปรับให้แสดงวันที่ตามข้อมูลจริง)
function summarizeAll() {
    if (!currentAccount) {
        showToast("❌ กรุณาเลือกบัญชีก่อน", 'error');
        return;
    }

    // 1. ตรวจสอบว่ามีข้อมูลในบัญชีหรือไม่
    const accountRecords = records.filter(r => r.account === currentAccount);
    if (accountRecords.length === 0) {
        showToast("❌ ไม่มีข้อมูลในบัญชีนี้ให้สรุป", 'error');
        return;
    }

    // 2. หาวันที่น้อยที่สุด (วันเริ่มต้น) และมากที่สุด (วันล่าสุด) จากข้อมูลจริง
    const allDates = accountRecords.map(r => parseLocalDateTime(r.dateTime));
    const startDate = new Date(Math.min.apply(null, allDates));
    const endDate = new Date(Math.max.apply(null, allDates));

    // 3. ปรับเวลาให้ครอบคลุมทั้งวัน (00:00:00 ถึง 23:59:59)
    startDate.setHours(0, 0, 0, 0);
    const adjustedEndDate = new Date(endDate);
    adjustedEndDate.setHours(23, 59, 59, 999);

    const summaryResult = generateSummaryData(startDate, adjustedEndDate);
    if (!summaryResult) return;

    // 4. คำนวณจำนวนวันทั้งหมด และ วันที่ทำธุรกรรมจริง
    const daysDiff = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const transactionDays = new Set(summaryResult.periodRecords.map(r => parseLocalDateTime(r.dateTime).toDateString()));
    const activeDays = transactionDays.size;
    const inactiveDaysCount = daysDiff - activeDays;

    // 5. สร้างข้อความแสดงจำนวนวัน (ปรับสีสันให้เข้ากับธีมของ script.js)
    const transactionDaysInfo = `<p style="color: #673ab7; font-weight: bold;">จำนวนทั้งหมด ${daysDiff} วัน (ทำธุรกรรม ${activeDays} วัน, ไม่ได้ทำ ${inactiveDaysCount} วัน)</p>`;

    // 6. แปลงวันที่สำหรับนำไปแสดงผล
    const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
    const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    const thaiDateString = `${startDate.toLocaleDateString('th-TH', {day: 'numeric', month: 'long', year: 'numeric'})} ถึง ${endDate.toLocaleDateString('th-TH', {day: 'numeric', month: 'long', year: 'numeric'})}`;
    
    // ✅ เพิ่มกล่องรับข้อความหมายเหตุ
    const remarkInput = prompt("กรุณากรอกหมายเหตุ (ถ้าไม่กรอกจะใช้ 'No comment'):", "No comment") || "No comment";

    // 7. ส่งข้อมูลไปยัง Context เพื่อวาดหน้าจอสรุปผล
    summaryContext = {
        summaryResult: summaryResult,
        title: 'สรุปข้อมูลทั้งหมดตั้งแต่',
        dateString: `${startDateStr} ถึง ${endDateStr}`,
        remark: remarkInput, // ✅ นำข้อความมาแสดง
        transactionDaysInfo: transactionDaysInfo, // แสดงข้อความจำนวนวัน
        activeDays: activeDays, // ส่งค่านี้เพื่อให้คำนวณ "รายได้/รายจ่าย เฉลี่ยต่อวัน" ได้
        type: 'all',
        thaiDateString: thaiDateString,
        headerLine1: 'สรุปทั้งหมด :',
        headerLine2: 'เงินในบัญชีทั้งหมด =',
        headerLine3: 'รายการทั้งหมด'
    };
    
    openSummaryOutputModal();
}

// [🔧 แก้ไข] ฟังก์ชัน summarizeByDayMonth
function summarizeByDayMonth() {
    if (!currentAccount) {
        showToast("❌ กรุณาเลือกบัญชีก่อน", 'error');
        return;
    }
    
    const selectedDateStr = document.getElementById('customDayMonth').value;
    if (!selectedDateStr) {
        showToast("❌ กรุณาเลือกวันที่", 'error');
        return;
    }
    
    const startDate = new Date(selectedDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(selectedDateStr);
    endDate.setHours(23, 59, 59, 999);
    
    const summaryResult = generateSummaryData(startDate, endDate);
    if (!summaryResult) return;
    
    const thaiDateString = startDate.toLocaleDateString('th-TH', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    
    // ✅ เพิ่มกล่องรับข้อความหมายเหตุ
    const remarkInput = prompt("กรุณากรอกหมายเหตุ (ถ้าไม่กรอกจะใช้ 'No comment'):", "No comment") || "No comment";

    summaryContext = {
        summaryResult: summaryResult,
        title: 'สรุปข้อมูลวันที่เลือก',
        dateString: selectedDateStr,
        remark: remarkInput, // ✅ นำข้อความมาแสดง
        type: 'byDayMonth',
        thaiDateString: thaiDateString,
        headerLine1: 'สรุปวันที่เลือก :',
        headerLine2: 'เงินในบัญชีวันนี้มี =',
        headerLine3: 'รายการวันที่เลือก'
    };
    
    openSummaryOutputModal();
}

// [🔧 แก้ไข] ฟังก์ชัน summarize (รองรับโหมดย้อนหลัง X วัน)
function summarize() {
    if (!currentAccount) {
        showToast("❌ กรุณาเลือกบัญชีก่อน", 'error');
        return;
    }
    
    // --- 🟢 ส่วนที่ 1: ดึงค่าวันที่โดยเช็คจากโหมดที่เลือก ---
    let startDateStr = '';
    let endDateStr = '';
    const showDetailsElement = document.getElementById('showDetailsRange');
    const showDetails = showDetailsElement ? showDetailsElement.checked : false;

    // เช็คว่ามี Radio Button ให้เลือกโหมดหรือไม่ (กันเหนียวเผื่อ HTML โหลดไม่ทัน)
    const modeRadios = document.querySelectorAll('input[name="summaryMode"]');
    let selectedMode = 'range';
    if (modeRadios.length > 0) {
        const checkedRadio = document.querySelector('input[name="summaryMode"]:checked');
        if (checkedRadio) selectedMode = checkedRadio.value;
    }

    if (selectedMode === 'lastX') {
        // โหมด X วันล่าสุด
        const daysInput = document.getElementById('summaryLastXDays');
        const days = parseInt(daysInput ? daysInput.value : 0);
        
        if (!days || days <= 0) {
            showToast('⚠️ กรุณาระบุจำนวนวันที่ต้องการย้อนหลังให้ถูกต้อง', 'error');
            return;
        }

        // ✅ อัปเดต: ให้ใช้วันล่าสุดที่มีข้อมูล (เหมือนกับฝั่งสรุปรายวัน)
        if (!dailySummaryData || Object.keys(dailySummaryData).length === 0) {
            calculateDailySummaries();
            if (Object.keys(dailySummaryData).length === 0) {
                showToast('⚠️ ไม่มีข้อมูลในบัญชีนี้สำหรับคำนวณ', 'error');
                return;
            }
        }

        // ดึงวันล่าสุดที่มีข้อมูลจาก dailySummaryData
        const dates = Object.keys(dailySummaryData).sort();
        endDateStr = dates[dates.length - 1]; // วันที่มากที่สุด (ล่าสุด)

        // ✅ แยกปี เดือน วัน เพื่อสร้าง Date Object ให้ตรงกับ Timezone ท้องถิ่นแบบ 100%
        const [ey, em, ed] = endDateStr.split('-').map(Number);
        const startObj = new Date(ey, em - 1, ed);
        startObj.setDate(startObj.getDate() - days + 1); // ลบจำนวนวัน (+1 เพื่อให้นับวันล่าสุดเป็น 1 วัน)

        const sy = startObj.getFullYear();
        const sm = String(startObj.getMonth() + 1).padStart(2, '0');
        const sd = String(startObj.getDate()).padStart(2, '0');
        startDateStr = `${sy}-${sm}-${sd}`;

        // (Option) อัปเดตค่ากลับไปที่ช่อง input date เพื่อให้ผู้ใช้เห็นว่าระบบใช้วันที่ไหนคำนวณ
        if (document.getElementById('startDate')) document.getElementById('startDate').value = startDateStr;
        if (document.getElementById('endDate')) document.getElementById('endDate').value = endDateStr;

    } else {
        // โหมดปกติ (ดึงจากช่อง Input Date ตรงๆ)
        startDateStr = document.getElementById('startDate').value;
        endDateStr = document.getElementById('endDate').value;
    }
    // --- 🟢 สิ้นสุดส่วนที่ 1 ---

    if (!startDateStr || !endDateStr) {
        showToast("❌ กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุด", 'error');
        return;
    }
    
    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);
    
    if (startDate > endDate) {
        showToast("❌ วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด", 'error');
        return;
    }
    
    const summaryResult = generateSummaryData(startDate, endDate);
    if (!summaryResult) return;
    
    const startThai = startDate.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const endThai = endDate.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const thaiDateString = `${startThai} ถึง ${endThai}`;
    
    // --- 🟢 ส่วนที่เพิ่มใหม่: คำนวณจำนวนวันทั้งหมด และ วันที่ทำธุรกรรม ---
    // 1. คำนวณจำนวนวันทั้งหมดในช่วงวันที่เลือก
    const calculatedTotalDays = Math.round((new Date(endDateStr).setHours(0, 0, 0, 0) - new Date(startDateStr).setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24)) + 1;
    
    // 2. คำนวณจำนวนวันที่มีการทำธุรกรรม (นับจากวันที่ที่ไม่ซ้ำกันใน periodRecords)
    const uniqueDates = new Set();
    summaryResult.periodRecords.forEach(record => {
        const dateOnly = record.dateTime.split(' ')[0]; // เอาเฉพาะ YYYY-MM-DD
        uniqueDates.add(dateOnly);
    });
    const activeDaysCount = uniqueDates.size;
    
    // 3. คำนวณจำนวนวันที่ไม่ได้ทำธุรกรรม
    const inactiveDaysCount = calculatedTotalDays - activeDaysCount;

    // 4. สร้าง HTML String สำหรับแสดงผล
    const transactionDaysInfo = `<p style="color: #673ab7; font-weight: bold;">จำนวนทั้งหมด ${calculatedTotalDays} วัน (ทำธุรกรรม ${activeDaysCount} วัน, ไม่ได้ทำ ${inactiveDaysCount} วัน)</p>`;
    // --- 🟢 สิ้นสุดส่วนที่เพิ่มใหม่ ---

    // ✅ เพิ่มกล่องรับข้อความหมายเหตุ
    const remarkInput = prompt("กรุณากรอกหมายเหตุ (ถ้าไม่กรอกจะใช้ 'No comment'):", "No comment") || "No comment";

    summaryContext = {
        summaryResult: summaryResult,
        title: 'สรุปข้อมูลตามช่วงวันที่',
        dateString: `${startDateStr} ถึง ${endDateStr}`,
        remark: remarkInput, 
        transactionDaysInfo: transactionDaysInfo, // 🟢 ส่งข้อความที่สร้างไว้เข้าไปแสดงผล
        activeDays: activeDaysCount,              // 🟢 ส่งค่านี้เข้าไปเพื่อให้ระบบคำนวณ "รายได้/รายจ่าย เฉลี่ยต่อวัน" ให้ด้วย
        type: 'range',
        thaiDateString: thaiDateString,
        headerLine1: 'สรุปช่วงวันที่ :',
        headerLine2: 'เงินในบัญชีทั้งหมด =',
        headerLine3: 'รายการในช่วงวันที่',
        showDetails: showDetails
    };
    
    openSummaryOutputModal();
}