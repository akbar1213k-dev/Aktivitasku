import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, 
  GoogleAuthProvider, signInWithPopup, signOut,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
  RecaptchaVerifier, signInWithPhoneNumber
} from 'firebase/auth';import { getFirestore, collection, doc, onSnapshot, writeBatch, updateDoc, deleteDoc } from 'firebase/firestore';

// Inisialisasi Firebase
// KODE BARU:
let app, auth, db, appId;
try {
  // Masukkan config dari project settings Firebase Anda di sini
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  };
  
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  appId = 'whatsapp-tracker'; 
} catch(e) {
  console.warn("Sistem Cloud sedang offline. Menggunakan penyimpanan lokal sementara.");
}

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [inputText, setInputText] = useState('');
  const [parsedData, setParsedData] = useState(() => {
    // Membaca cache lokal jika Firebase offline atau belum termuat
    try {
      const savedData = localStorage.getItem('offline_activities');
      return savedData ? JSON.parse(savedData) : [];
    } catch (error) {
      return [];
    }
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [toast, setToast] = useState('');
  // --- STATE UNTUK TEMA ---
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('themeMode') === 'dark';
  });

  useEffect(() => {
    localStorage.setItem('themeMode', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);
  // --- STATE UNTUK LOGIN ---
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [isSendingLink, setIsSendingLink] = useState(false);

  const fileInputRef = useRef(null);
  const pressTimer = useRef(null);

  // Filter, Seleksi, Kategori, & Expand
  const [dateFilter, setDateFilter] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('');
  const [expandedId, setExpandedId] = useState(null); // Menyimpan ID aktivitas yang sedang diklik untuk melihat detail
  // Menyimpan setiap perubahan data ke localStorage (sebagai backup offline / cache)
  useEffect(() => {
    localStorage.setItem('offline_activities', JSON.stringify(parsedData));
  }, [parsedData]);

  useEffect(() => {
    if (!auth) return;

    // Mengecek apakah user masuk dari link email
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let emailForSignIn = window.localStorage.getItem('emailForSignIn');
      if (!emailForSignIn) {
        emailForSignIn = window.prompt('Silakan masukkan email Anda untuk konfirmasi login:');
      }
      if (emailForSignIn) {
        signInWithEmailLink(auth, emailForSignIn, window.location.href)
          .then(() => {
            window.localStorage.removeItem('emailForSignIn');
            showToast('Berhasil Login dengan Email!');
            window.history.replaceState(null, '', window.location.pathname); // bersihkan URL
          })
          .catch((error) => {
            showToast('Gagal verifikasi email: ' + error.message);
          });
      }
    }

    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const colRef = collection(db, 'artifacts', appId, 'users', user.uid, 'activities');
    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setParsedData(data);
    }, (error) => {
      console.error("Firestore error:", error);
    });
    return () => unsubscribe();
  }, [user]);

  const handleLoginGoogle = async () => {
    if (!auth) { showToast('Sistem Cloud belum siap.'); return; }
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      showToast('Berhasil Login dengan Google!');
    } catch(e) {
      if(e.code === 'auth/popup-closed-by-user') {
         showToast('Popup ditutup sebelum login selesai.');
      } else {
         showToast('Gagal Login: ' + e.message);
      }
    }
  };

  const handleLoginEmailLink = async () => {
    if (!auth) return showToast('Sistem Cloud belum siap.');
    if (!loginEmail) return showToast('Masukkan alamat email.');
    
    setIsSendingLink(true);
    const actionCodeSettings = {
      url: window.location.href, // Akan mengarah kembali ke web ini
      handleCodeInApp: true,
    };

    try {
      await sendSignInLinkToEmail(auth, loginEmail, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', loginEmail);
      showToast('Tautan login telah dikirim ke email Anda!');
      setLoginEmail('');
    } catch (e) {
      showToast('Gagal mengirim tautan: ' + e.message);
    } finally {
      setIsSendingLink(false);
    }
  };

  const setupRecaptcha = () => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        'size': 'invisible'
      });
    }
  };

  const handleSendOTP = async () => {
    if (!auth) return showToast('Sistem Cloud belum siap.');
    if (!loginPhone.startsWith('+')) return showToast('Gunakan kode negara (contoh: +628...)');
    
    setupRecaptcha();
    const appVerifier = window.recaptchaVerifier;

    try {
      const result = await signInWithPhoneNumber(auth, loginPhone, appVerifier);
      setConfirmationResult(result);
      showToast('Kode OTP telah dikirim via SMS/WA!');
    } catch (e) {
      showToast('Gagal mengirim OTP: ' + e.message);
      if (window.recaptchaVerifier) {
         window.recaptchaVerifier.clear();
         window.recaptchaVerifier = null;
      }
    }
  };

  const handleVerifyOTP = async () => {
    if (!otpCode || !confirmationResult) return;
    try {
      await confirmationResult.confirm(otpCode);
      showToast('Berhasil Login dengan Telepon!');
      setConfirmationResult(null);
      setOtpCode('');
      setLoginPhone('');
    } catch (e) {
      showToast('Kode OTP salah atau kedaluwarsa.');
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      setUser(null); // Menghapus sesi
      // Muat ulang data dari mode lokal
      const savedData = localStorage.getItem('offline_activities');
      setParsedData(savedData ? JSON.parse(savedData) : []);
      showToast('Logout berhasil. Kembali ke Mode Lokal.');
      setActiveTab('home');
    } catch(e) {
      showToast('Gagal Logout.');
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const calculateDurationInfo = (startTime, endTime) => {
    const start = startTime.replace(/\./g, ':');
    const end = endTime.replace(/\./g, ':');
    const [startHour, startMin] = start.split(':').map(Number);
    const [endHour, endMin] = end.split(':').map(Number);

    let startTotalMinutes = startHour * 60 + startMin;
    let endTotalMinutes = endHour * 60 + endMin;

    if (endTotalMinutes < startTotalMinutes) endTotalMinutes += 24 * 60;

    const diffMinutes = endTotalMinutes - startTotalMinutes;
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;

    let text = '';
    if (hours > 0 && minutes > 0) text = `${hours}j ${minutes}m`;
    else if (hours > 0) text = `${hours}j`;
    else text = `${minutes}m`;

    return { text, rawMinutes: diffMinutes };
  };

  // Fungsi untuk memfinalisasi satu sesi (termasuk yang memiliki jeda/segmen)
  const finalizeSession = (session) => {
    let totalMinutes = 0;
    session.segments.forEach(seg => {
        if(seg.start && seg.end) {
            const info = calculateDurationInfo(seg.start, seg.end);
            seg.rawMinutes = info.rawMinutes;
            totalMinutes += info.rawMinutes;
        }
    });
    session.startTime = session.segments[0].start;
    // Jika tidak ada end karena format cacat, gunakan start
    session.endTime = session.segments[session.segments.length - 1].end || session.startTime;
    session.rawMinutes = totalMinutes;
    session.activity = session.message; // mapping dari variabel temp

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) session.durationText = `${hours}j ${minutes}m`;
    else if (hours > 0) session.durationText = `${hours}j`;
    else session.durationText = `${minutes}m`;

    return session;
  };

  const handleParse = async () => {
    if (!inputText.trim()) {
      showToast('Teks kosong.');
      return;
    }

    const lines = inputText.split('\n');
    const regex = /\[?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)[, ]+(\d{2}[.:]\d{2}(?:[.:]\d{2})?)\]?\s+(.*?):\s+(.*)/;
    const newActivities = [];
    
    let activeSession = null;
    let lastTime = null;

    lines.forEach((line) => {
      const match = line.match(regex);
      if (match) {
        const date = match[1];
        let time = match[2];
        let message = match[4].trim();

        const explicitTimeMatch = message.match(/^(\d{1,2}[.:]\d{2})\s+(.*)/);
        if (explicitTimeMatch) {
          time = explicitTimeMatch[1];
          message = explicitTimeMatch[2].trim();
        }

        const isEndMarker = message === '.';
        const isPauseMarker = message === '..';
        const isResumeMarker = message === '...';
        
        let activityFromDot = null;
        if (!isEndMarker && !isPauseMarker && !isResumeMarker && message.startsWith('.')) {
          activityFromDot = message.substring(1).trim();
        }

        if (isPauseMarker) {
          // JEDA: Tutup segmen yang sedang berjalan, biarkan sesi tetap hidup
          if (activeSession && activeSession.segments.length > 0) {
              let lastSeg = activeSession.segments[activeSession.segments.length - 1];
              if (!lastSeg.end) lastSeg.end = time;
          }
        } else if (isResumeMarker) {
          // LANJUT: Buka segmen baru pada sesi yang sama
          if (activeSession) {
              activeSession.segments.push({ start: time, end: null });
          }
        } else if (isEndMarker) {
          // SELESAI: Tutup segmen terakhir dan finalisasi seluruh sesi
          if (activeSession) {
              let lastSeg = activeSession.segments[activeSession.segments.length - 1];
              if (!lastSeg.end) lastSeg.end = time;
              newActivities.push(finalizeSession(activeSession));
              activeSession = null;
          }
        } else if (activityFromDot) {
          // BACKWARD (Mundur)
          if (activeSession) {
              let lastSeg = activeSession.segments[activeSession.segments.length - 1];
              if (!lastSeg.end) lastSeg.end = time;
              newActivities.push(finalizeSession(activeSession));
          }
          if (lastTime) {
              let newSess = { id: crypto.randomUUID(), date, message: activityFromDot, segments: [{start: lastTime, end: time}], createdAt: Date.now() + newActivities.length };
              newActivities.push(finalizeSession(newSess));
          }
          activeSession = null;
        } else {
          // AKTIVITAS BARU
          if (activeSession) {
              let lastSeg = activeSession.segments[activeSession.segments.length - 1];
              if (!lastSeg.end) lastSeg.end = time;
              newActivities.push(finalizeSession(activeSession));
          }
          activeSession = { id: crypto.randomUUID(), date, message, segments: [{start: time, end: null}], createdAt: Date.now() + newActivities.length };
        }

        lastTime = time;
      }
    });

    if (newActivities.length > 0) {
      if (user && db) {
        try {
          const batch = writeBatch(db);
          newActivities.forEach(act => {
            const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'activities', act.id);
            batch.set(docRef, act);
          });
          await batch.commit();
          showToast('Data berhasil ditambahkan!');
        } catch(e) {
          setParsedData(prev => [...prev, ...newActivities]);
          showToast('Disimpan sementara (Mode Offline)');
        }
      } else {
        setParsedData(prev => [...prev, ...newActivities]);
        showToast('Disimpan sementara (Mode Offline)');
      }
    } else {
      showToast('Tidak ada format data valid yang ditemukan.');
    }

    setIsModalOpen(false);
    setInputText('');
  };

  const handleExport = () => {
    if (parsedData.length === 0) {
      showToast('Tidak ada data untuk diekspor.');
      return;
    }
    const dataStr = JSON.stringify(parsedData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'riwayat_aktivitas.json';
    link.click();
    URL.revokeObjectURL(url);
    showToast('Berhasil diekspor!');
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (Array.isArray(importedData)) {
          if (user && db) {
            const batch = writeBatch(db);
            importedData.forEach(act => {
              const newId = act.id || crypto.randomUUID();
              const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'activities', newId);
              batch.set(docRef, { ...act, id: newId });
            });
            await batch.commit();
            showToast('Data berhasil diimpor!');
          } else {
            setParsedData(prev => {
               const merged = [...prev, ...importedData];
               return Array.from(new Map(merged.map(item => [item.id, item])).values());
            });
            showToast('Data diimpor (Mode Offline)');
          }
        }
      } catch (error) {
        showToast('Format file JSON tidak valid.');
      }
    };
    reader.readAsText(file);
    e.target.value = null; // reset
  };

  const handleSaveEdit = async () => {
    try {
      let updatedItem = { ...editingItem };
      
      if (updatedItem.segments && updatedItem.segments.length > 0) {
        // Kalkulasi ulang total menit dari semua segmen
        let totalMinutes = 0;
        updatedItem.segments.forEach(seg => {
            if(seg.start && seg.end) {
              const info = calculateDurationInfo(seg.start, seg.end);
              seg.rawMinutes = info.rawMinutes;
              totalMinutes += info.rawMinutes;
            }
        });
        updatedItem.startTime = updatedItem.segments[0].start;
        updatedItem.endTime = updatedItem.segments[updatedItem.segments.length - 1].end;
        updatedItem.rawMinutes = totalMinutes;
        
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours > 0 && minutes > 0) updatedItem.durationText = `${hours}j ${minutes}m`;
        else if (hours > 0) updatedItem.durationText = `${hours}j`;
        else updatedItem.durationText = `${minutes}m`;
      } else {
        const durInfo = calculateDurationInfo(editingItem.startTime, editingItem.endTime);
        updatedItem = { ...updatedItem, durationText: durInfo.text, rawMinutes: durInfo.rawMinutes };
      }

      if (user && db) {
         const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'activities', editingItem.id);
         await updateDoc(docRef, updatedItem);
      } else {
         setParsedData(prev => prev.map(item => item.id === editingItem.id ? updatedItem : item));
      }
      showToast('Data diperbarui!');
      setEditingItem(null);
    } catch (e) {
      showToast('Gagal! Format jam salah.');
    }
  };

  const handleDelete = async () => {
    if (user && db) {
       const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'activities', editingItem.id);
       await deleteDoc(docRef);
    } else {
       setParsedData(prev => prev.filter(item => item.id !== editingItem.id));
    }
    showToast('Aktivitas dihapus!');
    setEditingItem(null);
  };

  const parseDateStr = (dateStr) => {
    const parts = dateStr.split('/');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
    const fullYear = year < 100 ? 2000 + year : year;
    return new Date(fullYear, month, day);
  };

  const filteredData = parsedData.filter(item => {
    if (dateFilter === 'all') return true;
    const itemDate = parseDateStr(item.date);
    itemDate.setHours(0,0,0,0);

    if (dateFilter === 'today') {
      const today = new Date(); today.setHours(0,0,0,0);
      return itemDate.getTime() === today.getTime();
    }
    if (dateFilter === 'custom' && customStartDate && customEndDate) {
      const s = new Date(customStartDate); s.setHours(0,0,0,0);
      const e = new Date(customEndDate); e.setHours(0,0,0,0);
      return itemDate >= s && itemDate <= e;
    }
    return true;
  });

  const availableCategories = Array.from(new Set([
    'Produktif', 'Non Produktif', ...parsedData.map(d => d.category).filter(Boolean)
  ]));

  const handlePointerDown = (id) => {
    if (isSelectionMode) return;
    pressTimer.current = setTimeout(() => {
      setIsSelectionMode(true);
      setSelectedItems([id]);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500); 
  };
  
  const handlePointerUp = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };
  
  const toggleSelection = (id) => {
    setSelectedItems(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleBulkDelete = async () => {
    if (user && db) {
      const batch = writeBatch(db);
      selectedItems.forEach(id => {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'activities', id);
        batch.delete(docRef);
      });
      await batch.commit();
    } else {
      setParsedData(prev => prev.filter(item => !selectedItems.includes(item.id)));
    }
    showToast(`${selectedItems.length} aktivitas dihapus!`);
    setIsSelectionMode(false);
    setSelectedItems([]);
  };

  const handleBulkCategory = async () => {
    const catToSet = bulkCategory.trim();
    if (!catToSet) { showToast('Ketik atau pilih kategori!'); return; }

    if (user && db) {
      const batch = writeBatch(db);
      selectedItems.forEach(id => {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'activities', id);
        batch.update(docRef, { category: catToSet });
      });
      await batch.commit();
    } else {
      setParsedData(prev => prev.map(item => selectedItems.includes(item.id) ? { ...item, category: catToSet } : item));
    }
    showToast(`${selectedItems.length} aktivitas diubah kategorinya!`);
    setCategoryModalOpen(false);
    setIsSelectionMode(false);
    setSelectedItems([]);
    setBulkCategory('');
  };

  const handleBulkMerge = async () => {
    if (selectedItems.length < 2) {
      showToast('Pilih minimal 2 aktivitas untuk digabungkan!');
      return;
    }

    // 1. Ambil detail aktivitas yang dipilih
    const activitiesToMerge = parsedData.filter(item => selectedItems.includes(item.id));

    // 2. Cek apakah kategori sama
    const categories = new Set(activitiesToMerge.map(item => item.category || 'Belum Kategori'));
    if (categories.size > 1) {
      showToast('Peringatan: Aktivitas yang digabungkan memiliki kategori berbeda!');
      return;
    }

    // 3. Urutkan berdasarkan waktu paling awal (untuk dijadikan judul utama)
    activitiesToMerge.sort((a, b) => {
       const dateA = parseDateStr(a.date);
       const [hA, mA] = a.startTime.replace('.', ':').split(':');
       dateA.setHours(hA, mA, 0, 0);

       const dateB = parseDateStr(b.date);
       const [hB, mB] = b.startTime.replace('.', ':').split(':');
       dateB.setHours(hB, mB, 0, 0);

       return dateA.getTime() - dateB.getTime();
    });

    const baseActivity = activitiesToMerge[0];
    const otherActivities = activitiesToMerge.slice(1);

    // 4. Gabungkan semua segmen / sesi waktunya
    let combinedSegments = [];
    activitiesToMerge.forEach(act => {
       if (act.segments && act.segments.length > 0) {
          combinedSegments.push(...act.segments);
       } else {
          combinedSegments.push({
             start: act.startTime,
             end: act.endTime,
             rawMinutes: act.rawMinutes
          });
       }
    });

    // Kalkulasi ulang total durasi semua segmen
    let totalMinutes = 0;
    combinedSegments.forEach(seg => {
        if (seg.start && seg.end) {
            const info = calculateDurationInfo(seg.start, seg.end);
            seg.rawMinutes = info.rawMinutes;
            totalMinutes += info.rawMinutes;
        }
    });

    // Susun data aktivitas gabungan
    const updatedBaseActivity = {
       ...baseActivity,
       segments: combinedSegments,
       startTime: combinedSegments[0].start, // Sesi paling awal
       endTime: combinedSegments[combinedSegments.length - 1].end, // Sesi paling akhir
       rawMinutes: totalMinutes,
    };

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) updatedBaseActivity.durationText = `${hours}j ${minutes}m`;
    else if (hours > 0) updatedBaseActivity.durationText = `${hours}j`;
    else updatedBaseActivity.durationText = `${minutes}m`;

    // 5. Simpan pembaruan ke Database / State
    if (user && db) {
       const batch = writeBatch(db);
       
       // Perbarui aktivitas paling awal
       const baseRef = doc(db, 'artifacts', appId, 'users', user.uid, 'activities', baseActivity.id);
       batch.update(baseRef, updatedBaseActivity);

       // Hapus sisa aktivitas yang sudah digabung
       otherActivities.forEach(act => {
          const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'activities', act.id);
          batch.delete(docRef);
       });
       await batch.commit();
    } else {
       setParsedData(prev => {
          let newData = prev.filter(item => !otherActivities.find(o => o.id === item.id));
          return newData.map(item => item.id === baseActivity.id ? updatedBaseActivity : item);
       });
    }

    showToast('Aktivitas berhasil digabungkan!');
    setIsSelectionMode(false);
    setSelectedItems([]);
  };

  const totalMinutesAll = filteredData.reduce((acc, curr) => acc + curr.rawMinutes, 0);
  const totalHours = Math.floor(totalMinutesAll / 60);
  const totalMins = totalMinutesAll % 60;
  const totalDurationText = totalHours > 0 ? `${totalHours} Jam ${totalMins} Menit` : `${totalMins} Menit`;

  const categoryStats = filteredData.reduce((acc, curr) => {
    const cat = curr.category || 'Belum Kategori';
    acc[cat] = (acc[cat] || 0) + curr.rawMinutes;
    return acc;
  }, {});

  return (
    <div className={`flex justify-center min-h-screen font-sans transition-colors duration-300 ${isDarkMode ? 'bg-gray-900' : 'bg-gray-200'}`}>
      <div className={`w-full max-w-md min-h-screen relative flex flex-col shadow-2xl transition-colors duration-300 ${isDarkMode ? 'bg-gray-950 text-gray-100' : 'bg-gray-50 text-gray-800'}`}>
        
        {toast && (
          <div className="absolute top-10 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-5 py-3 rounded-full text-sm font-bold z-[60] shadow-lg animate-in fade-in slide-in-from-top-4">
            {toast}
          </div>
        )}

        <div className="flex-1 pb-28 p-6">
          
          {activeTab === 'home' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex justify-between items-center mb-6">
                <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Aktivitas Saya</h2>
                <select 
                  className={`border text-xs font-bold rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-orange-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-600'}`}
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                >
                  <option value="all">Semua Waktu</option>
                  <option value="today">Hari Ini</option>
                  <option value="custom">Pilih Tanggal...</option>
                </select>
              </div>
              {dateFilter === 'custom' && (
                <div className="flex gap-2 mb-4 bg-orange-50 p-3 rounded-2xl border border-orange-100">
                  <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="flex-1 bg-white border border-gray-200 rounded-xl text-[10px] p-2 outline-none font-bold text-gray-600" />
                  <span className="self-center text-gray-400 font-bold">-</span>
                  <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="flex-1 bg-white border border-gray-200 rounded-xl text-[10px] p-2 outline-none font-bold text-gray-600" />
                </div>
              )}
              
              {filteredData.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-gray-400 mt-24">
                  <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <p className="font-medium text-gray-500">Belum ada data tersimpan</p>
                  <p className="text-xs mt-1">Tekan tombol + di bawah untuk menambah.</p>
                </div>
              ) : (
                filteredData.map((item) => {
                  const hasSegments = item.segments && item.segments.length > 1;
                  return (
                  <div 
                    key={item.id} 
                    onPointerDown={() => handlePointerDown(item.id)}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onClick={() => {
                      if (isSelectionMode) toggleSelection(item.id);
                      else if (hasSegments) setExpandedId(expandedId === item.id ? null : item.id);
                    }}
                    className={`p-4 rounded-2xl shadow-sm border flex flex-col hover:shadow-md transition-all group relative ${hasSegments ? 'cursor-pointer' : ''} ${isSelectionMode && selectedItems.includes(item.id) ? (isDarkMode ? 'border-orange-500 bg-orange-900/40' : 'border-orange-500 bg-orange-50/50') : (isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100')}`}
                  >
                    <div className="flex justify-between items-center w-full">
                        {isSelectionMode && (
                           <div className="mr-3 flex-shrink-0">
                             <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${selectedItems.includes(item.id) ? 'bg-orange-500 border-orange-500' : (isDarkMode ? 'border-gray-600' : 'border-gray-300')}`}>
                               {selectedItems.includes(item.id) && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                             </div>
                           </div>
                        )}

                        <div className="flex-1 pr-4">
                          <p className={`font-bold text-lg break-words ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                            {item.activity}
                            {hasSegments && (
                               <span className="inline-block ml-2 align-middle text-gray-400">
                                   <svg className={`w-5 h-5 transform transition-transform ${expandedId === item.id ? 'rotate-180 text-orange-500' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                               </span>
                            )}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <p className="text-xs font-medium text-gray-400">{item.date} • {item.startTime} - {item.endTime}</p>
                            {item.category && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isDarkMode ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-600'}`}>{item.category}</span>}
                          </div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <div className={`px-3 py-1.5 rounded-full text-sm font-extrabold shadow-sm whitespace-nowrap ${isDarkMode ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-50 text-orange-600'}`}>
                            {item.durationText}
                          </div>
                          {!isSelectionMode && (
                            <button onClick={(e) => { e.stopPropagation(); setEditingItem(item); }} className={`p-2 rounded-full transition-colors active:scale-90 ${isDarkMode ? 'text-gray-400 hover:text-orange-400 hover:bg-gray-700' : 'text-gray-300 hover:text-orange-500 hover:bg-orange-50'}`}>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                            </button>
                          )}
                        </div>
                    </div>

                    {/* Expand Detail Segmen/Jeda */}
                    {expandedId === item.id && hasSegments && (
                       <div className="mt-4 pt-4 border-t border-dashed border-gray-200 animate-in fade-in slide-in-from-top-2">
                           <p className="text-xs font-bold text-gray-500 mb-3 ml-1">Detail Sesi (Jeda tidak dihitung):</p>
                           <div className="space-y-2 relative before:absolute before:inset-y-0 before:left-[11px] before:w-[2px] before:bg-gray-100">
                             {item.segments.map((seg, i) => (
                                <React.Fragment key={i}>
                                   <div className="flex items-center relative z-10">
                                      <div className="w-6 h-6 rounded-full bg-orange-100 border-2 border-white flex items-center justify-center text-orange-600 font-bold text-[10px] shadow-sm mr-3">
                                         {i+1}
                                      </div>
                                      <div className="flex-1 bg-gray-50 p-3 rounded-xl flex justify-between items-center border border-gray-100">
                                         <span className="text-gray-700 font-bold text-xs">{seg.start} - {seg.end}</span>
                                         <span className="text-orange-600 font-black text-xs">{seg.rawMinutes} mnt</span>
                                      </div>
                                   </div>
                                   {i < item.segments.length - 1 && (
                                      <div className="flex items-center relative z-10 ml-[26px] my-1">
                                         <div className="bg-gray-100 text-gray-400 text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1">
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                            Jeda {calculateDurationInfo(seg.end, item.segments[i+1].start).rawMinutes} mnt
                                         </div>
                                      </div>
                                   )}
                                </React.Fragment>
                             ))}
                           </div>
                       </div>
                    )}

                  </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex justify-between items-center mb-6">
                <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Aktivitas Saya</h2>
                <select 
                  className={`border text-xs font-bold rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-orange-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-600'}`}
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                >
                  <option value="all">Semua Waktu</option>
                  <option value="today">Hari Ini</option>
                  <option value="custom">Pilih Tanggal...</option>
                </select>
              </div>

              {dateFilter === 'custom' && (
                <div className="flex gap-2 mb-4 bg-orange-50 p-3 rounded-2xl border border-orange-100">
                  <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="flex-1 bg-white border border-gray-200 rounded-xl text-[10px] p-2 outline-none font-bold text-gray-600" />
                  <span className="self-center text-gray-400 font-bold">-</span>
                  <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="flex-1 bg-white border border-gray-200 rounded-xl text-[10px] p-2 outline-none font-bold text-gray-600" />
                </div>
              )}
              
              <div className="bg-gradient-to-br from-orange-500 to-orange-400 text-white p-6 rounded-3xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 opacity-10 transform translate-x-4 -translate-y-4">
                   <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                </div>
                <p className="text-orange-100 text-sm font-medium relative z-10">Total Waktu Aktivitas</p>
                <p className="text-3xl font-black mt-1 relative z-10">{totalDurationText}</p>
              </div>

              <div className={`p-5 rounded-3xl shadow-sm border flex justify-between items-center ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
                <div>
                  <p className="text-gray-400 text-sm font-medium">Total Sesi Aktivitas</p>
                  <p className={`text-2xl font-black mt-1 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>{filteredData.length} Sesi</p>
                </div>
                <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-500">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                </div>
              </div>
              {/* --- STATISTIK KATEGORI --- */}
              <div className="mt-6 space-y-4">
                <h3 className={`text-lg font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Statistik per Kategori</h3>
                {Object.entries(categoryStats)
                  .sort((a, b) => b[1] - a[1]) // Urutkan durasi dari yang terlama
                  .map(([cat, mins]) => {
                    const h = Math.floor(mins / 60);
                    const m = mins % 60;
                    const timeTxt = h > 0 ? `${h}j ${m}m` : `${m}m`;
                    const pct = totalMinutesAll > 0 ? Math.round((mins / totalMinutesAll) * 100) : 0;
                    
                    return (
                      <div key={cat} className={`p-4 rounded-2xl shadow-sm border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-bold text-sm">{cat}</span>
                          <span className="text-orange-500 font-black text-sm">{timeTxt}</span>
                        </div>
                        <div className={`w-full rounded-full h-2.5 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                          <div className="bg-orange-500 h-2.5 rounded-full" style={{width: `${pct}%`}}></div>
                        </div>
                        <p className="text-right text-[10px] mt-1 text-gray-400">{pct}% dari total waktu</p>
                      </div>
                    );
                })}
              </div>
              
          </div>
      )}

          {activeTab === 'settings' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <h2 className={`text-2xl font-bold mb-6 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Pengaturan</h2>

              {/* --- TOGGLE MODE GELAP --- */}
              <div className={`p-5 rounded-3xl shadow-sm border mb-6 flex justify-between items-center ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-gray-700 text-yellow-400' : 'bg-blue-50 text-blue-500'}`}>
                    {isDarkMode ? (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                    ) : (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Mode Tampilan</h3>
                    <p className="text-xs text-gray-400 font-medium">{isDarkMode ? 'Mode Gelap Aktif' : 'Mode Terang Aktif'}</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={isDarkMode} onChange={() => setIsDarkMode(!isDarkMode)} />
                  <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-orange-500"></div>
                </label>
              </div>
              
              <div className={`p-6 rounded-3xl shadow-sm border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center text-orange-500 shadow-sm">
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg">
                      {user && !user.isAnonymous ? (user.displayName || user.phoneNumber || 'Pengguna Cloud') : 'Mode Lokal'}
                    </h3>
                    <p className="text-xs text-gray-400 font-medium">
                      {user && !user.isAnonymous ? (user.email || 'Terhubung via Telepon') : 'Data tidak disinkronisasi'}
                    </p>
                  </div>
                </div>

                {user && !user.isAnonymous ? (
                  <button onClick={handleLogout} className="w-full bg-red-50 text-red-500 hover:bg-red-100 font-bold py-3.5 rounded-2xl transition-colors">
                    Keluar dari Akun
                  </button>
                ) : (
                  <div className="space-y-6">
                    {/* Wadah rahasia Recaptcha (Wajib untuk login OTP Telepon) */}
                    <div id="recaptcha-container"></div>

                    {/* --- LOGIN GOOGLE --- */}
                    <div className="border-b border-gray-100 pb-5">
                      <p className="text-xs text-gray-500 font-bold mb-3">Cara Tercepat:</p>
                      <button onClick={handleLoginGoogle} className="w-full bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold py-3.5 rounded-2xl flex items-center justify-center gap-3 transition-colors">
                        <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1h-9.17v2.73h5.51c-.18 1.09-1.01 2.94-2.76 4.11l4.28 3.32c2.51-2.31 3.96-5.71 3.96-9.52 0-.91-.13-1.74-.35-2.52z"></path><path fill="currentColor" d="M12.18 21.07c2.61 0 4.81-.86 6.41-2.33l-4.28-3.32c-.81.56-1.93.94-3.32.94-2.61 0-4.87-1.73-5.71-4.13L1.08 15.5c1.64 3.27 4.98 5.57 8.94 5.57z"></path><path fill="currentColor" d="M6.47 12.23c-.22-.64-.34-1.32-.34-2.03s.12-1.39.34-2.03l-4.2-3.26C1.41 6.55 1 8.21 1 10.2c0 1.99.41 3.65 1.27 5.27l4.2-3.24z"></path><path fill="currentColor" d="M12.18 3.33c1.7 0 3.01.73 3.69 1.38l2.7-2.63C16.89.65 14.7 0 12.18 0 8.22 0 4.88 2.3 3.24 5.57l4.2 3.26c.84-2.4 3.1-4.13 5.71-4.13z"></path></svg>
                        Login dengan Google
                      </button>
                    </div>

                    {/* --- LOGIN EMAIL LINK --- */}
                    <div className="border-b border-gray-100 pb-5">
                      <p className="text-xs text-gray-500 font-bold mb-3">Login Tautan Email (Tanpa Sandi):</p>
                      <div className="flex gap-2">
                         <input type="email" placeholder="contoh@email.com" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)}
                           className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 outline-none text-sm font-medium focus:ring-2 focus:ring-orange-500" />
                         <button onClick={handleLoginEmailLink} disabled={isSendingLink} className="bg-gray-800 text-white px-5 py-3 rounded-2xl font-bold hover:bg-gray-700 disabled:bg-gray-300 transition-colors">
                           {isSendingLink ? 'Kirim...' : 'Kirim'}
                         </button>
                      </div>
                    </div>

                    {/* --- LOGIN TELEPON --- */}
                    <div>
                      <p className="text-xs text-gray-500 font-bold mb-3">Login dengan Nomor Telepon:</p>
                      {!confirmationResult ? (
                        <div className="flex gap-2">
                           <input type="tel" placeholder="+62812..." value={loginPhone} onChange={(e) => setLoginPhone(e.target.value)}
                             className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 outline-none text-sm font-medium focus:ring-2 focus:ring-orange-500" />
                           <button onClick={handleSendOTP} className="bg-gray-800 text-white px-5 py-3 rounded-2xl font-bold hover:bg-gray-700 transition-colors">OTP</button>
                        </div>
                      ) : (
                        <div className="flex gap-2 animate-in fade-in">
                           <input type="number" placeholder="Kode 6 Digit" value={otpCode} onChange={(e) => setOtpCode(e.target.value)}
                             className="flex-1 bg-orange-50 border border-orange-200 text-orange-800 rounded-2xl px-4 outline-none font-bold tracking-widest text-center focus:ring-2 focus:ring-orange-500" />
                           <button onClick={handleVerifyOTP} className="bg-orange-500 text-white px-5 py-3 rounded-2xl font-bold hover:bg-orange-600 transition-colors">Masuk</button>
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>
            </div>
          )}

        {editingItem && (
          <div className="absolute inset-0 bg-gray-900/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white w-full rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
              <h3 className="text-xl font-extrabold text-gray-800 mb-5">Edit Aktivitas</h3>
              
              <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Nama Aktivitas</label>
              <input className="w-full bg-gray-50 border border-gray-200 p-3.5 rounded-2xl mb-4 focus:ring-2 focus:ring-orange-500 outline-none font-medium" 
                value={editingItem.activity} onChange={e => setEditingItem({...editingItem, activity: e.target.value})} />
              
              <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Kategori (Ketik atau Pilih)</label>
              <input list="category-list" className="w-full bg-gray-50 border border-gray-200 p-3.5 rounded-2xl mb-4 focus:ring-2 focus:ring-orange-500 outline-none font-medium" 
                value={editingItem.category || ''} placeholder="Misal: Produktif" onChange={e => setEditingItem({...editingItem, category: e.target.value})} />
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Tanggal</label>
                  <input className="w-full bg-gray-50 border border-gray-200 p-3.5 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none font-medium" 
                    value={editingItem.date} onChange={e => setEditingItem({...editingItem, date: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Jam Mulai</label>
                  <input className="w-full bg-gray-50 border border-gray-200 p-3.5 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none font-medium disabled:opacity-50 disabled:bg-gray-200" 
                    value={editingItem.startTime} 
                    disabled={editingItem.segments && editingItem.segments.length > 1}
                    onChange={e => {
                      const updated = {...editingItem, startTime: e.target.value};
                      if (updated.segments && updated.segments.length === 1) {
                         updated.segments[0].start = e.target.value;
                      }
                      setEditingItem(updated);
                    }} />
                </div>
              </div>
              
              <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Jam Selesai</label>
              <input className="w-full bg-gray-50 border border-gray-200 p-3.5 rounded-2xl mb-2 focus:ring-2 focus:ring-orange-500 outline-none font-medium disabled:opacity-50 disabled:bg-gray-200" 
                value={editingItem.endTime} 
                disabled={editingItem.segments && editingItem.segments.length > 1}
                onChange={e => {
                  const updated = {...editingItem, endTime: e.target.value};
                  if (updated.segments && updated.segments.length === 1) {
                     updated.segments[0].end = e.target.value;
                  }
                  setEditingItem(updated);
                }} />

              {editingItem.segments && editingItem.segments.length > 1 ? (
                 <div className="mb-4 mt-2 bg-orange-50 p-3 rounded-2xl border border-orange-100">
                    <p className="text-xs font-bold text-orange-600 mb-2">Edit Waktu Per Sesi</p>
                    {editingItem.segments.map((seg, i) => (
                      <div key={i} className="flex gap-2 mb-2 items-center">
                        <input className="w-full bg-white border border-gray-200 p-2 rounded-xl text-xs outline-none font-medium" value={seg.start} onChange={e => {
                          const newSegs = [...editingItem.segments];
                          newSegs[i].start = e.target.value;
                          setEditingItem({
                            ...editingItem, 
                            segments: newSegs,
                            startTime: newSegs[0].start
                          });
                        }} />
                        <span className="text-gray-400 font-bold">-</span>
                        <input className="w-full bg-white border border-gray-200 p-2 rounded-xl text-xs outline-none font-medium" value={seg.end} onChange={e => {
                          const newSegs = [...editingItem.segments];
                          newSegs[i].end = e.target.value;
                          setEditingItem({
                            ...editingItem, 
                            segments: newSegs,
                            endTime: newSegs[newSegs.length - 1].end
                          });
                        }} />
                        <button className="text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors" onClick={() => {
                          if (editingItem.segments.length <= 1) return;
                          const newSegs = editingItem.segments.filter((_, idx) => idx !== i);
                          setEditingItem({
                             ...editingItem, 
                             segments: newSegs,
                             startTime: newSegs.length > 0 ? newSegs[0].start : editingItem.startTime,
                             endTime: newSegs.length > 0 ? newSegs[newSegs.length - 1].end : editingItem.endTime
                          });
                        }}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                      </div>
                    ))}
                 </div>
              ) : (
                <div className="mb-6"></div>
              )}
              
              <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Jam Selesai</label>
              <input className="w-full bg-gray-50 border border-gray-200 p-3.5 rounded-2xl mb-2 focus:ring-2 focus:ring-orange-500 outline-none font-medium" 
                value={editingItem.endTime} onChange={e => setEditingItem({...editingItem, endTime: e.target.value})} />

              {editingItem.segments && editingItem.segments.length > 1 && (
                 <p className="text-[10px] text-orange-500 italic mb-4 ml-1">*Catatan: Mengedit jam pada aktivitas ber-jeda akan menyatukan sesi.</p>
              )}
              {!(editingItem.segments && editingItem.segments.length > 1) && <div className="mb-6"></div>}

              <div className="flex gap-3 mb-4">
                <button onClick={() => setEditingItem(null)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 py-3.5 rounded-2xl font-bold transition-colors">Batal</button>
                <button onClick={handleSaveEdit} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3.5 rounded-2xl font-bold transition-colors">Simpan</button>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <button onClick={handleDelete} className="w-full text-red-500 hover:bg-red-50 font-bold py-3 rounded-2xl transition-colors">Hapus Aktivitas</button>
              </div>
            </div>
          </div>
        )}

        {categoryModalOpen && (
          <div className="absolute inset-0 bg-gray-900/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white w-full rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
               <h3 className="text-xl font-extrabold text-gray-800 mb-2">Tetapkan Kategori</h3>
               <p className="text-xs text-gray-500 mb-5">Terapkan ke {selectedItems.length} aktivitas yang dipilih.</p>

               <input list="category-list" className="w-full bg-gray-50 border border-gray-200 p-3.5 rounded-2xl mb-6 focus:ring-2 focus:ring-orange-500 outline-none font-medium" 
                value={bulkCategory} placeholder="Ketik atau pilih kategori..." onChange={e => setBulkCategory(e.target.value)} />
               
               <div className="flex gap-3">
                <button onClick={() => setCategoryModalOpen(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 py-3.5 rounded-2xl font-bold transition-colors">Batal</button>
                <button onClick={handleBulkCategory} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3.5 rounded-2xl font-bold transition-colors">Simpan Kategori</button>
              </div>
            </div>
          </div>
        )}

          {/* --- TAMBAHKAN MULAI DARI SINI: TOOLBAR SELEKSI --- */}
        {/* --- KODE TOOLBAR SELEKSI YANG DIPERBARUI (DENGAN TOMBOL GABUNG) --- */}
        {isSelectionMode && selectedItems.length > 0 && (
          <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 w-full max-w-md px-4 z-[60] animate-in slide-in-from-bottom-4 fade-in duration-200">
            <div className="bg-gray-900 rounded-3xl shadow-2xl p-4 flex items-center justify-between text-white border border-gray-700">
              <div className="flex items-center gap-2">
                <button onClick={() => { setIsSelectionMode(false); setSelectedItems([]); }} className="p-2 bg-gray-800 rounded-full hover:bg-gray-700 transition-colors">
                  <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
                <span className="font-extrabold text-sm">{selectedItems.length} Terpilih</span>
              </div>
              <div className="flex items-center gap-2">
                
                {/* --- TOMBOL GABUNGKAN (Hanya muncul jika lebih dari 1 dipilih) --- */}
                {selectedItems.length > 1 && (
                  <button onClick={handleBulkMerge} className="px-3 py-2 bg-blue-500 hover:bg-blue-400 rounded-xl text-xs font-bold transition-colors">
                    Gabung
                  </button>
                )}

                <button onClick={() => setCategoryModalOpen(true)} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-xs font-bold transition-colors">
                  Kategori
                </button>
                <button onClick={handleBulkDelete} className="p-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-xl transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
              </div>
            </div>
          </div>
        )}
        {/* --- BATAS AKHIR KODE TOOLBAR SELEKSI --- */}
          
        <datalist id="category-list">
          {availableCategories.map(c => <option key={c} value={c} />)}
        </datalist>

        </div> 

        {/* --- KODE MODAL TAMBAH AKTIVITAS YANG HILANG --- */}
        {isModalOpen && (
          <div className="absolute inset-0 bg-gray-900/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white w-full rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
              <h3 className="text-xl font-extrabold text-gray-800 mb-2">Tambah Aktivitas</h3>
              <p className="text-xs text-gray-500 mb-4">Paste format teks Anda di bawah ini:</p>
              
              <textarea 
                className="w-full bg-gray-50 border border-gray-200 p-4 rounded-2xl h-40 mb-4 focus:ring-2 focus:ring-orange-500 outline-none font-mono text-xs resize-none"
                placeholder="Contoh:&#10;[12/10 12.00] : Mulai aktivitas..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
              
              <div className="flex gap-3 mb-4">
                <button onClick={() => setIsModalOpen(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 py-3.5 rounded-2xl font-bold transition-colors">Batal</button>
                <button onClick={handleParse} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3.5 rounded-2xl font-bold transition-colors">Simpan Data</button>
              </div>

              <div className="flex gap-3 border-t border-gray-100 pt-4">
                <button onClick={handleExport} className="flex-1 text-xs font-bold text-gray-500 bg-gray-50 py-2 rounded-xl hover:bg-gray-100">Export JSON</button>
                <label className="flex-1 text-xs font-bold text-gray-500 bg-gray-50 py-2 rounded-xl hover:bg-gray-100 text-center cursor-pointer">
                  Import JSON
                  <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleImport} />
                </label>
              </div>
            </div>
          </div>
        )}

       {/* --- KODE NAVIGASI BAWAH YANG DIPERBARUI --- */}
        {/* --- KODE NAVIGASI BAWAH YANG BARU (DENGAN TOMBOL SETTINGS) --- */}
        <div className={`fixed bottom-0 left-1/2 transform -translate-x-1/2 w-full max-w-md flex justify-around items-center p-3 z-50 rounded-t-3xl shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)] border-t transition-colors duration-300 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-100'}`}>
          
          <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center space-y-1 w-14 ${activeTab === 'home' ? 'text-orange-500' : 'text-gray-300 hover:text-gray-500'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
            <span className="text-[10px] font-extrabold">Home</span>
          </button>

          <button onClick={() => setActiveTab('stats')} className={`flex flex-col items-center space-y-1 w-14 ${activeTab === 'stats' ? 'text-orange-500' : 'text-gray-300 hover:text-gray-500'}`}>
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
             <span className="text-[10px] font-extrabold">Stats</span>
          </button>

          <button onClick={() => setIsModalOpen(true)} className="relative -top-4 bg-orange-500 text-white p-3.5 rounded-full shadow-lg shadow-orange-500/40 border-4 border-white hover:bg-orange-600 hover:scale-105 transition-all active:scale-95">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"></path></svg>
          </button>

          <button onClick={() => setActiveTab('settings')} className={`flex flex-col items-center space-y-1 w-14 ${activeTab === 'settings' ? 'text-orange-500' : 'text-gray-300 hover:text-gray-500'}`}>
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
             <span className="text-[10px] font-extrabold">Setelan</span>
          </button>

        </div>

      </div> 
    </div> 
  );
}
      
