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
  const [isGuideOpen, setIsGuideOpen] = useState(false); // STATE BARU UNTUK PANDUAN
  const [editingItem, setEditingItem] = useState(null);
  const [toast, setToast] = useState('');
  
  // --- FUNGSI UNTUK MENYALIN TEKS PANDUAN ---
  const handleCopyGuide = () => {
    const guideText = `PANDUAN FORMAT TEKS AKTIVITAS:\n\n1. Format Dasar:\n[12/10 08.00] : Sarapan pagi\n[12/10 08.30] : Mulai kerja\n\n2. Format Eksplisit:\n[12/10 09.00] : 10.30 Olahraga\n\n3. Menandai Selesai: (.)\n[12/10 11.00] : .\n\n4. Format Jeda: (..) jeda, (...) lanjut\n[12/10 13.00] : Belajar\n[12/10 14.00] : ..\n[12/10 14.30] : ...\n[12/10 15.30] : .\n\n5. Aktivitas Mundur: (. Nama)\n[12/10 16.00] : Mulai Kerja\n[12/10 16.30] : . Balas Email\n\n6. Potong Menit Start (.[angka] Nama):\n[12/10 20.15] : .23 Nyuci\n(Jam mulai menjadi 19.52)\n\n7. Durasi Instan (Nama .d[angka]):\n[12/10 16.13] : Makan .d29\n(Durasi otomatis 29 menit, selesai jam 16.13)`;
    navigator.clipboard.writeText(guideText);
    showToast('Teks Panduan Berhasil Disalin!');
  };

  // --- STATE UNTUK TEMA ---
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('themeMode') === 'dark';
  });

  useEffect(() => {
    localStorage.setItem('themeMode', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

// --- STATE UNTUK URUTAN ---
  const [sortOrder, setSortOrder] = useState(() => {
    return localStorage.getItem('sortOrder') || 'terbaru';
  });

  useEffect(() => {
    localStorage.setItem('sortOrder', sortOrder);
  }, [sortOrder]);

 // --- STATE UNTUK CATATAN APLIKASI ---
  const [appNotes, setAppNotes] = useState(() => {
    try {
      const saved = localStorage.getItem('appNotes');
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      return [];
    }
  });
  const [newNoteText, setNewNoteText] = useState('');

  // 1. Simpan catatan otomatis ke memori lokal (Sebagai Backup Offline/Instan)
  useEffect(() => {
    localStorage.setItem('appNotes', JSON.stringify(appNotes));
  }, [appNotes]);

  // 2. Fungsi Kirim Catatan (Lokal dulu -> baru Cloud)
  const handleAddNote = async () => {
    if (!newNoteText.trim()) return;
    const noteId = Date.now().toString(); // Gunakan string untuk ID Firebase
    const note = {
      id: noteId,
      text: newNoteText,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + new Date().toLocaleDateString()
    };
    
    // Simpan ke layar & lokal seketika (Tanpa Loading)
    setAppNotes([...appNotes, note]);
    setNewNoteText('');

    // Sinkronisasi ke Cloud Firebase jika sedang Login
    if (user && db) {
      try {
        const batch = writeBatch(db);
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'notes', noteId);
        batch.set(docRef, note);
        await batch.commit();
      } catch(e) {
        console.warn('Gagal sinkronisasi catatan ke cloud, disimpan di lokal.', e);
      }
    }
  };

  // 3. Fungsi Hapus Catatan (Lokal dulu -> baru Cloud)
  const handleDeleteNote = async (id) => {
    // Hapus dari layar & lokal seketika
    setAppNotes(appNotes.filter(note => note.id !== id));

    // Hapus dari Cloud Firebase jika sedang Login
    if (user && db) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'notes', id.toString());
        await deleteDoc(docRef);
      } catch(e) {
        console.warn('Gagal hapus catatan di cloud.', e);
      }
    }
  };
  
  // --- STATE UNTUK LOGIN ---
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [isSendingLink, setIsSendingLink] = useState(false);

  const fileInputRef = useRef(null);
  const pressTimer = useRef(null);
  const currentTimeRef = useRef(null); // Ref untuk menggulir ke garis merah

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
    
    // 1. Listener Sinkronisasi Aktivitas
    const colRef = collection(db, 'artifacts', appId, 'users', user.uid, 'activities');
    const unsubscribeActivities = onSnapshot(colRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setParsedData(data);
    }, (error) => {
      console.error("Firestore error:", error);
    });

    // 2. Listener Sinkronisasi Catatan (Baru)
    const notesRef = collection(db, 'artifacts', appId, 'users', user.uid, 'notes');
    const unsubscribeNotes = onSnapshot(notesRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Urutkan berdasarkan waktu buat (karena ID kita menggunakan Date.now)
      data.sort((a, b) => Number(a.id) - Number(b.id));
      setAppNotes(data);
    }, (error) => {
      console.error("Firestore notes error:", error);
    });

    return () => {
       unsubscribeActivities();
       unsubscribeNotes();
    };
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
      setUser(null); // 1. Menghapus sesi Cloud
      
      // 2. Muat ulang Aktivitas dari mode lokal
      const savedData = localStorage.getItem('offline_activities');
      setParsedData(savedData ? JSON.parse(savedData) : []);
      
      // 3. Muat ulang Catatan dari mode lokal (KODE BARU YANG DITAMBAHKAN)
      const savedNotes = localStorage.getItem('appNotes');
      setAppNotes(savedNotes ? JSON.parse(savedNotes) : []);

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

  // --- FUNGSI PENGECEK TUMPANG TINDIH WAKTU (BENTROK) ---
  const checkTimeOverlap = (activitiesToCheck, existingData) => {
    const toMins = (timeStr) => {
      if (!timeStr) return 0;
      const [h, m] = timeStr.replace('.', ':').split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };

    const allActs = [...existingData]; // Gabungkan data lama dan baru
    
    for (const newAct of activitiesToCheck) {
      const newDate = newAct.date;
      const newSegs = newAct.segments && newAct.segments.length > 0 ? newAct.segments : [{start: newAct.startTime, end: newAct.endTime}];

      for (const existingAct of allActs) {
        if (existingAct.id === newAct.id) continue; // Jangan cek diri sendiri saat di-edit
        
        if (existingAct.date === newDate) {
          const oldSegs = existingAct.segments && existingAct.segments.length > 0 ? existingAct.segments : [{start: existingAct.startTime, end: existingAct.endTime}];

          for (const nSeg of newSegs) {
            for (const oSeg of oldSegs) {
              if (!nSeg.start || !nSeg.end || !oSeg.start || !oSeg.end) continue;
              
              let nStart = toMins(nSeg.start);
              let nEnd = toMins(nSeg.end);
              if (nEnd <= nStart) nEnd += 24 * 60; // Jika melewati tengah malam

              let oStart = toMins(oSeg.start);
              let oEnd = toMins(oSeg.end);
              if (oEnd <= oStart) oEnd += 24 * 60;

              // Kondisi Bentrok: MulaiA < SelesaiB DAN MulaiB < SelesaiA
              if (nStart < oEnd && oStart < nEnd) {
                return {
                  hasOverlap: true,
                  msg: `Terdapat tumpang tindih waktu (bentrok) pada tanggal ${newDate}!\n\n🛑 [${existingAct.activity}] (${oSeg.start} - ${oSeg.end})\n⚠️ [${newAct.activity}] (${nSeg.start} - ${nSeg.end})\n\nSilakan sesuaikan kembali jam aktivitas Anda sebelum menyimpan.`
                };
              }
            }
          }
        }
      }
      allActs.push(newAct); // Tambahkan ke daftar agar aktivitas baru dicek satu sama lain
    }
    return { hasOverlap: false };
  };
  // --------------------------------------------------------

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

    // --- HELPER UNTUK MENGURANGI MENIT WAKTU ---
    const subtractMinutes = (timeStr, minsToSubtract) => {
      let [h, m] = timeStr.replace('.', ':').split(':').map(Number);
      let totalMins = (h || 0) * 60 + (m || 0) - parseInt(minsToSubtract, 10);
      if (totalMins < 0) totalMins += 24 * 60; // Jika mundur melewati tengah malam
      const newH = Math.floor(totalMins / 60) % 24;
      const newM = totalMins % 60;
      return `${newH.toString().padStart(2, '0')}.${newM.toString().padStart(2, '0')}`;
    };

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

        // 1. MEKANISME BARU: SHIFT WAKTU (.23 Nyuci)
        const shiftMatch = message.match(/^\.(\d+)\s+(.*)/);
        if (shiftMatch) {
          const shiftMins = parseInt(shiftMatch[1], 10);
          time = subtractMinutes(time, shiftMins); // Jam ditarik mundur
          message = shiftMatch[2].trim();
        }

        // 2. MEKANISME BARU: DURASI LANGSUNG (Makan .d29)
        let explicitStart = null;
        let explicitEnd = null;
        const durMatch = message.match(/(.*?)\s+\.d(\d+)$/i);
        if (durMatch) {
          message = durMatch[1].trim();
          const durMins = parseInt(durMatch[2], 10);
          explicitEnd = time; // Jam pesan menjadi waktu selesai
          explicitStart = subtractMinutes(time, durMins); // Mulainya mundur sebesar durasi
        }

        // Format Eksplisit Jam bawaan (Contoh: "10.30 Olahraga")
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

        // --- EKSEKUSI ---
        if (explicitStart && explicitEnd) {
          // Jika menggunakan mekanisme .d[angka] (Langsung difinalisasi)
          if (activeSession) {
              let lastSeg = activeSession.segments[activeSession.segments.length - 1];
              if (!lastSeg.end) lastSeg.end = explicitStart; // Tutup aktivitas sblmnya
              newActivities.push(finalizeSession(activeSession));
          }
          let newSess = { id: crypto.randomUUID(), date, message: message, segments: [{start: explicitStart, end: explicitEnd}], createdAt: Date.now() + newActivities.length };
          newActivities.push(finalizeSession(newSess));
          activeSession = null;
          lastTime = explicitEnd;
        } 
        else if (isPauseMarker) {
          if (activeSession && activeSession.segments.length > 0) {
              let lastSeg = activeSession.segments[activeSession.segments.length - 1];
              if (!lastSeg.end) lastSeg.end = time;
          }
          lastTime = time;
        } 
        else if (isResumeMarker) {
          if (activeSession) {
              activeSession.segments.push({ start: time, end: null });
          }
          lastTime = time;
        } 
        else if (isEndMarker) {
          if (activeSession) {
              let lastSeg = activeSession.segments[activeSession.segments.length - 1];
              if (!lastSeg.end) lastSeg.end = time;
              newActivities.push(finalizeSession(activeSession));
              activeSession = null;
          }
          lastTime = time;
        } 
        else if (activityFromDot) {
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
          lastTime = time;
        } 
        else {
          // AKTIVITAS BARU NORMAL
          if (activeSession) {
              let lastSeg = activeSession.segments[activeSession.segments.length - 1];
              if (!lastSeg.end) lastSeg.end = time;
              newActivities.push(finalizeSession(activeSession));
          }
          activeSession = { id: crypto.randomUUID(), date, message, segments: [{start: time, end: null}], createdAt: Date.now() + newActivities.length };
          lastTime = time;
        }
      }
    });

    // --- KODE LAMA LANJUT DARI SINI: CEK TUMPANG TINDIH ---
    if (newActivities.length > 0) {
      
      // --- CEK TUMPANG TINDIH SEBELUM MENYIMPAN DATA BARU ---
      const overlapCheck = checkTimeOverlap(newActivities, parsedData);
      if (overlapCheck.hasOverlap) {
         alert(overlapCheck.msg); // Memunculkan pop up peringatan di layar
         return; // Langsung membatalkan dan menghentikan proses simpan
      }
      // ------------------------------------------------------

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

      // --- CEK TUMPANG TINDIH SEBELUM MENYIMPAN HASIL EDIT ---
      const overlapCheck = checkTimeOverlap([updatedItem], parsedData);
      if (overlapCheck.hasOverlap) {
         alert(overlapCheck.msg);
         return; // Membatalkan penyimpanan jika waktu edit bentrok
      }
      // -------------------------------------------------------

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

  // --- LOGIKA FILTER & PENGURUTAN GLOBAL ---
  // Mengurutkan SELURUH data berdasarkan Jam dan Tanggal nyata (MENGABAIKAN WAKTU INPUT)
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
  }).sort((a, b) => {
    // Kalkulasi Jam & Tanggal untuk Aktivitas A
    const dateA = parseDateStr(a.date);
    const [hA, mA] = (a.startTime || '00.00').replace('.', ':').split(':').map(Number);
    dateA.setHours(hA || 0, mA || 0, 0, 0);
    
    // Kalkulasi Jam & Tanggal untuk Aktivitas B
    const dateB = parseDateStr(b.date);
    const [hB, mB] = (b.startTime || '00.00').replace('.', ':').split(':').map(Number);
    dateB.setHours(hB || 0, mB || 0, 0, 0);
    
    // Urutkan sesuai pilihan pengaturan (Terbaru/Terlama) secara akurat
    return sortOrder === 'terbaru' ? dateB.getTime() - dateA.getTime() : dateA.getTime() - dateB.getTime();
  });

  // Alias agar kode di tab Home tidak error
  const sortedHomeData = filteredData; 
  // -----------------------------------------
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

  // --- LOGIKA WAKTU TERCATAT VS TIDAK TERCATAT ---
  let totalPossibleMinutes = 0;
  if (dateFilter === 'today') {
    totalPossibleMinutes = 24 * 60; // 24 Jam
  } else if (dateFilter === 'custom' && customStartDate && customEndDate) {
    const s = new Date(customStartDate); s.setHours(0,0,0,0);
    const e = new Date(customEndDate); e.setHours(0,0,0,0);
    const diffTime = Math.abs(e - s);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    totalPossibleMinutes = diffDays * 24 * 60;
  } else {
    // Untuk "Semua Waktu", hitung dari hari pertama aktivitas dicatat sampai hari ini
    if (parsedData.length > 0) {
       const allDates = parsedData.map(d => parseDateStr(d.date).getTime());
       const minDate = Math.min(...allDates);
       const maxDate = new Date().setHours(0,0,0,0);
       const diffTime = Math.max(0, maxDate - minDate);
       const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
       totalPossibleMinutes = diffDays * 24 * 60;
    } else {
       totalPossibleMinutes = 24 * 60;
    }
  }

  const recordedMinutes = totalMinutesAll;
  const unrecordedMinutes = Math.max(0, totalPossibleMinutes - recordedMinutes);
  const recordedPct = totalPossibleMinutes > 0 ? (recordedMinutes / totalPossibleMinutes) * 100 : 0;
  const unrecordedPct = totalPossibleMinutes > 0 ? (unrecordedMinutes / totalPossibleMinutes) * 100 : 0;

  const formatMins = (mins) => {
    const h = Math.floor(mins / 60);
    const m = Math.floor(mins % 60);
    return h > 0 ? `${h}j ${m}m` : `${m}m`;
  };
  // ------------------------------------------------

  const categoryStats = filteredData.reduce((acc, curr) => {
    const cat = curr.category || 'Belum Kategori';
    acc[cat] = (acc[cat] || 0) + curr.rawMinutes;
    return acc;
  }, {});

  // --- FUNGSI UNTUK WARNA KARTU BERBEDA TIAP HARI ---
  const getDateColor = (dateStr, isDark) => {
    if (!dateStr) return isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100';
    
    // Ambil angka hari dan bulan dari string "DD/MM"
    const parts = dateStr.split('/');
    const day = parseInt(parts[0], 10) || 0;
    const month = parseInt(parts[1], 10) || 0;
    
    // Daftar palet warna pastel halus (Light & Dark Mode)
    const themes = [
      { light: 'bg-white border-gray-100', dark: 'bg-gray-800 border-gray-700' }, // Netral
      { light: 'bg-blue-50/50 border-blue-100', dark: 'bg-blue-900/10 border-blue-800/40' },     // Biru halus
      { light: 'bg-emerald-50/50 border-emerald-100', dark: 'bg-emerald-900/10 border-emerald-800/40' }, // Hijau halus
      { light: 'bg-purple-50/50 border-purple-100', dark: 'bg-purple-900/10 border-purple-800/40' }, // Ungu halus
      { light: 'bg-rose-50/50 border-rose-100', dark: 'bg-rose-900/10 border-rose-800/40' },       // Merah muda halus
      { light: 'bg-amber-50/50 border-amber-100', dark: 'bg-amber-900/10 border-amber-800/40' },   // Kuning/Krem halus
      { light: 'bg-teal-50/50 border-teal-100', dark: 'bg-teal-900/10 border-teal-800/40' }        // Toska halus
    ];
    
    // Rumus agar tanggal yang sama selalu dapat warna yang sama persis
    const index = (day + month) % themes.length;
    return isDark ? themes[index].dark : themes[index].light;
  };

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
              
              {sortedHomeData.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-gray-400 mt-24">
                  <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <p className="font-medium text-gray-500">Belum ada data tersimpan</p>
                  <p className="text-xs mt-1">Tekan tombol + di bawah untuk menambah.</p>
                </div>
              ) : (
                sortedHomeData.map((item) => {
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
                    // WARNA BACKGROUND DIGANTI MENGGUNAKAN getDateColor DI SINI:
                    className={`p-4 rounded-2xl shadow-sm border flex flex-col hover:shadow-md transition-all group relative ${hasSegments ? 'cursor-pointer' : ''} ${isSelectionMode && selectedItems.includes(item.id) ? (isDarkMode ? 'border-orange-500 bg-orange-900/40' : 'border-orange-500 bg-orange-50/50') : getDateColor(item.date, isDarkMode)}`}
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
              
              {/* --- KARTU GABUNGAN: WAKTU AKTIVITAS & TOTAL SESI --- */}
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white p-6 rounded-3xl shadow-xl shadow-orange-500/20 relative overflow-hidden flex flex-col justify-between min-h-[160px]">
                {/* Ikon Latar Belakang (Transparan) */}
                <div className="absolute top-0 right-0 opacity-10 transform translate-x-4 -translate-y-4">
                   <svg className="w-36 h-36" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                </div>
                
                {/* Bagian Atas: Prioritas Utama (Total Waktu) */}
                <div className="relative z-10 flex justify-between items-start">
                   <div>
                      <p className="text-orange-100 text-xs font-black uppercase tracking-widest mb-1 shadow-sm">Total Waktu Aktivitas</p>
                      <p className="text-3xl md:text-4xl font-black leading-tight drop-shadow-md">{totalDurationText}</p>
                   </div>
                </div>
                
                {/* Bagian Bawah: Prioritas Kedua (Total Sesi) */}
                <div className="relative z-10 mt-6 pt-4 border-t border-orange-400/40 flex justify-between items-center">
                   <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center shadow-inner">
                         <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                      </div>
                      <span className="text-xs font-bold text-orange-50 uppercase tracking-wider">Sesi Terhitung</span>
                   </div>
                   <p className="text-xl font-black drop-shadow-sm">{filteredData.length} Sesi</p>
                </div>
              </div>
              {/* --- STATISTIK WAKTU TERCATAT VS TIDAK TERCATAT --- */}
              <div className={`p-5 rounded-3xl shadow-sm border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
                <div className="flex justify-between items-end mb-3">
                  <div>
                    <p className="text-orange-500 text-[10px] font-extrabold uppercase tracking-wider mb-1">Tercatat</p>
                    <p className={`text-lg font-black ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                      {recordedPct.toFixed(1)}% <span className="text-xs font-bold text-gray-400 ml-1">({formatMins(recordedMinutes)})</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-400 text-[10px] font-extrabold uppercase tracking-wider mb-1">Tdk Tercatat</p>
                    <p className={`text-lg font-black ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                      {unrecordedPct.toFixed(1)}% <span className="text-xs font-bold text-gray-400 ml-1">({formatMins(unrecordedMinutes)})</span>
                    </p>
                  </div>
                </div>
                
                {/* Progress Bar Satu Garis Proporsional */}
                <div className={`w-full h-4 rounded-full flex overflow-hidden ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                  <div className="bg-orange-500 h-full flex items-center justify-center transition-all duration-500" style={{ width: `${recordedPct}%` }}>
                    {recordedPct >= 10 && <span className="text-[8px] font-bold text-white opacity-80">{recordedPct.toFixed(0)}%</span>}
                  </div>
                  <div className={`h-full flex items-center justify-center transition-all duration-500 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-200'}`} style={{ width: `${unrecordedPct}%` }}>
                  </div>
                </div>
              </div>
              {/* -------------------------------------------------- */}

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

              {/* --- PENGATURAN URUTAN --- */}
              <div className={`p-5 rounded-3xl shadow-sm border mb-6 flex justify-between items-center ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-gray-700 text-green-400' : 'bg-green-50 text-green-500'}`}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path></svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Urutan Aktivitas</h3>
                    <p className="text-xs text-gray-400 font-medium">Di Tab Beranda</p>
                  </div>
                </div>
                <select 
                  className={`border font-bold text-sm rounded-xl px-3 py-2 outline-none cursor-pointer focus:ring-2 focus:ring-orange-500 ${isDarkMode ? 'bg-gray-900 border-gray-600 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-700'}`}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                >
                  <option value="terbaru">Terbaru</option>
                  <option value="terlama">Terlama</option>
                </select>
              </div>

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
              
              {/* --- CATATAN APLIKASI (STYLE CHAT) --- */}
              <div className={`p-5 rounded-3xl shadow-sm border flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-gray-700 text-blue-400' : 'bg-blue-50 text-blue-500'}`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Catatan Pribadi</h3>
                    <p className="text-xs text-gray-400 font-medium">Tersimpan di perangkat ini</p>
                  </div>
                </div>

                {/* Area Chat */}
                <div className={`flex flex-col gap-3 h-64 overflow-y-auto p-4 rounded-2xl mb-4 border shadow-inner ${isDarkMode ? 'bg-gray-900/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                  {appNotes.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 opacity-60">
                      <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                      <span className="text-xs font-bold">Belum ada catatan</span>
                    </div>
                  ) : (
                    appNotes.map(note => (
                      <div key={note.id} className="flex justify-end group items-center gap-2">
                        {/* Tombol Hapus (Muncul saat disentuh/diarahkan kursor) */}
                        <button onClick={() => handleDeleteNote(note.id)} className="p-2 bg-red-100 hover:bg-red-200 text-red-500 rounded-full lg:opacity-0 group-hover:opacity-100 transition-opacity dark:bg-red-500/20 dark:hover:bg-red-500/40 active:scale-90">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                        
                        {/* Bubble Chat */}
                        <div className={`relative max-w-[80%] p-3.5 rounded-[20px] rounded-tr-sm shadow-sm ${isDarkMode ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'}`}>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{note.text}</p>
                          <p className="text-[9px] text-right mt-2 opacity-70 font-bold tracking-wider">{note.date}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Input Chat */}
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Ketik catatan di sini..." 
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                    className={`flex-1 border rounded-2xl px-4 py-3 outline-none text-sm font-medium focus:ring-2 focus:ring-blue-500 transition-colors ${isDarkMode ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500' : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'}`}
                  />
                  <button 
                    onClick={handleAddNote}
                    className="bg-blue-500 hover:bg-blue-600 text-white w-12 h-12 rounded-2xl flex items-center justify-center transition-colors shrink-0 shadow-md active:scale-95"
                  >
                    <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>
                  </button>
                </div>
              </div>
              {/* --- BATAS KODE CATATAN APLIKASI --- */}
              
            </div>
          )}

          {/* --- TAB VISUALISASI MULTI-HARI (SCROLL BERSAMBUNG & BEBAS BUG) --- */}
          {activeTab === 'visual' && (
            <div className="space-y-4 animate-in fade-in duration-300 pb-10">
              <div className="flex justify-between items-center mb-6">
                <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Visual Aktivitas</h2>
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

              {/* KONTAINER UTAMA TIMELINE */}
              <div className={`relative w-full rounded-3xl shadow-inner border flex flex-col ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
                {(() => {
                  // 1. Kelompokkan aktivitas berdasarkan Tanggal
                  const groupedData = {};
                  filteredData.forEach(act => {
                    if (!groupedData[act.date]) groupedData[act.date] = [];
                    groupedData[act.date].push(act);
                  });

                  // 2. Urutkan tanggal mengikuti pengaturan (Terbaru/Terlama)
                  const sortedDates = Object.keys(groupedData).sort((a, b) => {
                    const timeA = parseDateStr(a).getTime();
                    const timeB = parseDateStr(b).getTime();
                    return sortOrder === 'terbaru' ? timeB - timeA : timeA - timeB;
                  });

                  if (sortedDates.length === 0) {
                     return (
                        <div className="flex flex-col items-center justify-center text-gray-400 py-24">
                          <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                          <p className="font-medium text-sm">Belum ada data visual</p>
                        </div>
                     );
                  }

                  // 3. Fungsi Pembuat Warna Lembut
                  const getActivityColor = (text) => {
                    let hash = 0;
                    for (let i = 0; i < text.length; i++) hash = text.charCodeAt(i) + ((hash << 5) - hash);
                    const themes = [
                      { light: 'bg-blue-50/90 border-blue-200 text-blue-800', dark: 'bg-blue-900/30 border-blue-800/50 text-blue-300' },
                      { light: 'bg-indigo-50/90 border-indigo-200 text-indigo-800', dark: 'bg-indigo-900/30 border-indigo-800/50 text-indigo-300' },
                      { light: 'bg-purple-50/90 border-purple-200 text-purple-800', dark: 'bg-purple-900/30 border-purple-800/50 text-purple-300' },
                      { light: 'bg-rose-50/90 border-rose-200 text-rose-800', dark: 'bg-rose-900/30 border-rose-800/50 text-rose-300' },
                      { light: 'bg-orange-50/90 border-orange-200 text-orange-800', dark: 'bg-orange-900/30 border-orange-800/50 text-orange-300' },
                      { light: 'bg-emerald-50/90 border-emerald-200 text-emerald-800', dark: 'bg-emerald-900/30 border-emerald-800/50 text-emerald-300' },
                      { light: 'bg-teal-50/90 border-teal-200 text-teal-800', dark: 'bg-teal-900/30 border-teal-800/50 text-teal-300' },
                      { light: 'bg-cyan-50/90 border-cyan-200 text-cyan-800', dark: 'bg-cyan-900/30 border-cyan-800/50 text-cyan-300' }
                    ];
                    const index = Math.abs(hash) % themes.length;
                    return isDarkMode ? themes[index].dark : themes[index].light;
                  };

                  // 4. Helper Hitung Posisi & Pencegah Tumpah (Bug Fix)
                  const getSafePosition = (timeStr, rawMins) => {
                    if (!timeStr) return null;
                    const [h, m] = timeStr.replace('.', ':').split(':').map(Number);
                    const sMins = ((h || 0) % 24) * 60 + (m || 0); // Fix bug jam 24:00
                    let bHeight = Math.max(rawMins || 0, 15); // Minimal tinggi 15px agar bisa diklik
                    bHeight = Math.min(bHeight, 1440 - sMins); // KUNCI UTAMA: Potong tinggi jika menyeberang 24:00 agar tidak tumpah
                    return { startMins: sMins, blockHeight: bHeight };
                  };

                  // 5. Render Blok Skala 24 Jam
                  return sortedDates.map((dateStr) => {
                    const actsForDate = groupedData[dateStr];
                    const isToday = parseDateStr(dateStr).getTime() === new Date().setHours(0,0,0,0);

                    return (
                      <div key={dateStr} className={`relative w-full h-[1440px] border-b border-dashed ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
                        
                        {/* --- Garis Batas 00:00 & Tanggal Mengapung (Sticky) --- */}
                        <div className="sticky top-2 z-40 w-full pointer-events-none h-0 overflow-visible">
                           <div className={`absolute top-0 left-0 w-full border-t-[3px] shadow-sm ${isDarkMode ? 'border-orange-500/60' : 'border-orange-500/80'}`}></div>
                           <div className="absolute top-0 left-0 w-full flex justify-between items-start px-3 mt-1.5">
                             <span className={`text-[10px] font-black tracking-widest flex items-center gap-1 backdrop-blur-md px-2 py-0.5 rounded-lg shadow-sm opacity-90 border ${isDarkMode ? 'text-orange-300 bg-gray-900/60 border-gray-700' : 'text-orange-700 bg-white/70 border-gray-200'}`}>
                               <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                               {dateStr}
                             </span>
                             <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-lg backdrop-blur-md opacity-90 border ${isDarkMode ? 'bg-gray-800/60 text-gray-300 border-gray-700' : 'bg-gray-100/60 text-gray-700 border-gray-200'}`}>
                               {actsForDate.length} Aktv
                             </span>
                           </div>
                        </div>

                        {/* Garis Penanda Jam Orientasi Dinamis (Terbaru/Terlama) */}
                        {Array.from({ length: 24 }).map((_, i) => (
                          <div key={i} className={`absolute w-full border-t ${isDarkMode ? 'border-gray-800/40' : 'border-gray-200/50'}`} style={{ top: sortOrder === 'terbaru' ? 'auto' : `${i * 60}px`, bottom: sortOrder === 'terbaru' ? `${i * 60}px` : 'auto', height: '0px' }}>
                            <span className={`absolute text-[10px] font-black -mt-2 bg-transparent pl-4 pr-2 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                              {i.toString().padStart(2, '0')}:00
                            </span>
                          </div>
                        ))}

                        {/* Garis Merah Waktu Saat Ini (Dapat Dilompati Tombol) */}
                        {isToday && (
                          <div ref={currentTimeRef} className="absolute w-full border-t-2 border-red-500 z-20 pointer-events-none flex items-center" style={{ top: sortOrder === 'terbaru' ? 'auto' : `${new Date().getHours() * 60 + new Date().getMinutes()}px`, bottom: sortOrder === 'terbaru' ? `${new Date().getHours() * 60 + new Date().getMinutes()}px` : 'auto', height: '0px' }}>
                             <div className="absolute w-2 h-2 rounded-full bg-red-500 ml-1 shadow-[0_0_8px_rgba(239,68,68,0.8)] -mt-1"></div>
                          </div>
                        )}

                        {/* Render Kotak Aktivitas */}
                        {actsForDate.map(act => {
                          const colorClass = getActivityColor(act.activity);
                          const textAlignment = sortOrder === 'terbaru' ? 'justify-end pb-2' : 'justify-start pt-2'; // Fix teks posisi terbalik

                          if (act.segments && act.segments.length > 1) {
                            return act.segments.map((seg, idx) => {
                              const pos = getSafePosition(seg.start, seg.rawMinutes);
                              if (!pos) return null;
                              return (
                                <div key={`${act.id}-${idx}`} className={`absolute left-16 right-6 px-2 rounded-xl text-xs font-medium border shadow-sm overflow-hidden transition-all hover:scale-[1.01] hover:z-30 hover:shadow-md cursor-pointer flex flex-col ${textAlignment} opacity-95 hover:opacity-100 ${colorClass}`} style={{ top: sortOrder === 'terbaru' ? 'auto' : `${pos.startMins}px`, bottom: sortOrder === 'terbaru' ? `${pos.startMins}px` : 'auto', height: `${pos.blockHeight}px` }}>
                                  <p className="font-bold truncate leading-tight">{act.activity} <span className="opacity-70 text-[10px]">(Sesi {idx+1})</span></p>
                                  {pos.blockHeight > 25 && <p className="opacity-80 text-[10px] mt-0.5">{seg.start} - {seg.end}</p>}
                                </div>
                              );
                            });
                          }

                          const pos = getSafePosition(act.startTime, act.rawMinutes);
                          if (!pos) return null;

                          return (
                            <div key={act.id} className={`absolute left-16 right-6 px-2 rounded-xl text-xs font-medium border shadow-sm overflow-hidden transition-all hover:scale-[1.01] hover:z-30 hover:shadow-md cursor-pointer flex flex-col ${textAlignment} opacity-95 hover:opacity-100 ${colorClass}`} style={{ top: sortOrder === 'terbaru' ? 'auto' : `${pos.startMins}px`, bottom: sortOrder === 'terbaru' ? `${pos.startMins}px` : 'auto', height: `${pos.blockHeight}px` }}>
                              <p className="font-bold truncate leading-tight">{act.activity}</p>
                              {pos.blockHeight > 25 && <p className="opacity-80 text-[10px] mt-0.5">{act.startTime} - {act.endTime}</p>}
                            </div>
                          );
                        })}

                      </div>
                    );
                  });
                })()}
              </div>

              {/* Tombol Mengapung (FAB) ke Waktu Saat Ini */}
              <div className="fixed bottom-[100px] left-1/2 transform -translate-x-1/2 w-full max-w-md flex justify-end px-6 pointer-events-none z-[60]">
                 <button 
                   onClick={() => {
                     if (currentTimeRef.current) {
                       currentTimeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                     } else {
                       showToast('Garis waktu (Hari Ini) tidak ada di tampilan visual saat ini.');
                     }
                   }}
                   className="pointer-events-auto bg-red-500/50 hover:bg-red-500/80 text-white p-3.5 rounded-full shadow-lg backdrop-blur-md transition-all active:scale-90 border border-red-400/40"
                   aria-label="Ke Waktu Saat Ini"
                 >
                   <svg className="w-6 h-6 drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                 </button>
              </div>

            </div>
          )}
          {/* --- BATAS KODE TAB VISUALISASI --- */}
          
        {/* --- KODE MODAL EDIT AKTIVITAS (SUDAH SUPPORT DARK MODE) --- */}
        {editingItem && (
          <div className="absolute inset-0 bg-gray-900/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className={`w-full rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200 ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
              <h3 className={`text-xl font-extrabold mb-5 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Edit Aktivitas</h3>
              
              <label className={`block text-xs font-bold mb-1 ml-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Nama Aktivitas</label>
              <input 
                className={`w-full border p-3.5 rounded-2xl mb-4 focus:ring-2 focus:ring-orange-500 outline-none font-medium transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                value={editingItem.activity} 
                onChange={e => setEditingItem({...editingItem, activity: e.target.value})} 
              />
              
              <label className={`block text-xs font-bold mb-1 ml-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Kategori (Ketik atau Pilih)</label>
              <input list="category-list" 
                className={`w-full border p-3.5 rounded-2xl mb-4 focus:ring-2 focus:ring-orange-500 outline-none font-medium transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100 placeholder-gray-500' : 'bg-gray-50 border-gray-200 text-gray-800 placeholder-gray-400'}`}
                value={editingItem.category || ''} 
                placeholder="Misal: Produktif" 
                onChange={e => setEditingItem({...editingItem, category: e.target.value})} 
              />
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className={`block text-xs font-bold mb-1 ml-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Tanggal Mulai</label>
                  <input 
                    className={`w-full border p-3.5 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none font-medium transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                    value={editingItem.date} 
                    onChange={e => setEditingItem({...editingItem, date: e.target.value})} 
                  />
                </div>
                <div>
                  <label className={`block text-xs font-bold mb-1 ml-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Jam Mulai</label>
                  <input 
                    className={`w-full border p-3.5 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none font-medium disabled:opacity-50 transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                    value={editingItem.startTime} 
                    disabled={editingItem.segments && editingItem.segments.length > 1}
                    onChange={e => {
                      const updated = {...editingItem, startTime: e.target.value};
                      if (updated.segments && updated.segments.length === 1) {
                         updated.segments[0].start = e.target.value;
                      }
                      setEditingItem(updated);
                    }} 
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-2">
                <div>
                  <label className={`block text-xs font-bold mb-1 ml-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Tanggal Selesai</label>
                  <input 
                    className={`w-full border p-3.5 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none font-medium transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                    value={editingItem.endDate || editingItem.date} 
                    onChange={e => setEditingItem({...editingItem, endDate: e.target.value})} 
                  />
                </div>
                <div>
                  <label className={`block text-xs font-bold mb-1 ml-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Jam Selesai</label>
                  <input 
                    className={`w-full border p-3.5 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none font-medium disabled:opacity-50 transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                    value={editingItem.endTime} 
                    disabled={editingItem.segments && editingItem.segments.length > 1}
                    onChange={e => {
                      const updated = {...editingItem, endTime: e.target.value};
                      if (updated.segments && updated.segments.length === 1) {
                         updated.segments[0].end = e.target.value;
                      }
                      setEditingItem(updated);
                    }} 
                  />
                </div>
              </div>

              {editingItem.segments && editingItem.segments.length > 1 ? (
                 <div className={`mb-4 mt-2 p-3 rounded-2xl border ${isDarkMode ? 'bg-orange-900/20 border-orange-500/30' : 'bg-orange-50 border-orange-100'}`}>
                    <p className={`text-xs font-bold mb-2 ${isDarkMode ? 'text-orange-400' : 'text-orange-600'}`}>Edit Waktu Per Sesi</p>
                    {editingItem.segments.map((seg, i) => (
                      <div key={i} className="flex gap-2 mb-2 items-center">
                        <input className={`w-full border p-2 rounded-xl text-xs outline-none font-medium ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-200 text-gray-800'}`} value={seg.start} onChange={e => {
                          const newSegs = [...editingItem.segments];
                          newSegs[i].start = e.target.value;
                          setEditingItem({
                            ...editingItem, 
                            segments: newSegs,
                            startTime: newSegs[0].start
                          });
                        }} />
                        <span className="text-gray-400 font-bold">-</span>
                        <input className={`w-full border p-2 rounded-xl text-xs outline-none font-medium ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-200 text-gray-800'}`} value={seg.end} onChange={e => {
                          const newSegs = [...editingItem.segments];
                          newSegs[i].end = e.target.value;
                          setEditingItem({
                            ...editingItem, 
                            segments: newSegs,
                            endTime: newSegs[newSegs.length - 1].end
                          });
                        }} />
                        <button className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'text-red-400 hover:bg-red-500/20' : 'text-red-500 hover:bg-red-50'}`} onClick={() => {
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
              
              {editingItem.segments && editingItem.segments.length > 1 && (
                 <p className="text-[10px] text-orange-500 italic mb-4 ml-1">*Catatan: Mengedit jam pada aktivitas ber-jeda akan menyatukan sesi.</p>
              )}
              {!(editingItem.segments && editingItem.segments.length > 1) && <div className="mb-6"></div>}

              <div className="flex gap-3 mb-4">
                <button onClick={() => setEditingItem(null)} className={`flex-1 py-3.5 rounded-2xl font-bold transition-colors ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}>Batal</button>
                <button onClick={handleSaveEdit} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3.5 rounded-2xl font-bold transition-colors">Simpan</button>
              </div>

              <div className={`border-t pt-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                <button onClick={handleDelete} className={`w-full font-bold py-3 rounded-2xl transition-colors ${isDarkMode ? 'text-red-400 hover:bg-red-500/10' : 'text-red-500 hover:bg-red-50'}`}>Hapus Aktivitas</button>
              </div>
            </div>
          </div>
        )}
        {/* --- BATAS KODE MODAL EDIT AKTIVITAS --- */}
              
        {/* --- KODE MODAL KATEGORI (SUDAH SUPPORT DARK MODE) --- */}
        {categoryModalOpen && (
          <div className="absolute inset-0 bg-gray-900/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className={`w-full rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200 ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
               <h3 className={`text-xl font-extrabold mb-2 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Tetapkan Kategori</h3>
               <p className={`text-xs mb-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Terapkan ke {selectedItems.length} aktivitas yang dipilih.</p>

               <input list="category-list" 
                className={`w-full border p-3.5 rounded-2xl mb-6 focus:ring-2 focus:ring-orange-500 outline-none font-medium transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100 placeholder-gray-500' : 'bg-gray-50 border-gray-200 text-gray-800 placeholder-gray-400'}`} 
                value={bulkCategory} 
                placeholder="Ketik atau pilih kategori..." 
                onChange={e => setBulkCategory(e.target.value)} 
               />
               
               <div className="flex gap-3">
                <button onClick={() => setCategoryModalOpen(false)} className={`flex-1 py-3.5 rounded-2xl font-bold transition-colors ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}>Batal</button>
                <button onClick={handleBulkCategory} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3.5 rounded-2xl font-bold transition-colors">Simpan Kategori</button>
              </div>
            </div>
          </div>
        )}
      
        {/* --- BATAS KODE MODAL KATEGORI --- */}
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

        {/* --- KODE MODAL TAMBAH AKTIVITAS (SUDAH SUPPORT DARK MODE) --- */}
        {isModalOpen && (
          <div className="absolute inset-0 bg-gray-900/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className={`w-full rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200 ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
              
              <div className="flex justify-between items-center mb-1">
                <h3 className={`text-xl font-extrabold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Tambah Aktivitas</h3>
                
                {/* --- TOMBOL PANDUAN --- */}
                <button onClick={() => setIsGuideOpen(true)} className="flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-full text-[10px] font-bold transition-colors shadow-sm border border-blue-100 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  Panduan
                </button>
              </div>
              <p className={`text-xs mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Paste format teks Anda di bawah ini:</p>
              
              {/* Textarea dengan deteksi Dark Mode */}
              <textarea 
                className={`w-full border p-4 rounded-2xl h-40 mb-4 focus:ring-2 focus:ring-orange-500 outline-none font-mono text-xs resize-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100 placeholder-gray-500' : 'bg-gray-50 border-gray-200 text-gray-800 placeholder-gray-400'}`}
                placeholder="Contoh:&#10;[12/10 12.00] : Mulai aktivitas..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
              
              <div className="flex gap-3 mb-4">
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  className={`flex-1 py-3.5 rounded-2xl font-bold transition-colors ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}>
                  Batal
                </button>
                <button 
                  onClick={handleParse} 
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3.5 rounded-2xl font-bold transition-colors">
                  Simpan Data
                </button>
              </div>

              <div className={`flex gap-3 border-t pt-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                <button 
                  onClick={handleExport} 
                  className={`flex-1 text-xs font-bold py-2 rounded-xl transition-colors ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-400' : 'bg-gray-50 hover:bg-gray-100 text-gray-500'}`}>
                  Export JSON
                </button>
                <label className={`flex-1 text-xs font-bold py-2 rounded-xl text-center cursor-pointer transition-colors ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-400' : 'bg-gray-50 hover:bg-gray-100 text-gray-500'}`}>
                  Import JSON
                  <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleImport} />
                </label>
              </div>
            </div>
          </div>
        )}
        {/* --- BATAS KODE MODAL TAMBAH AKTIVITAS --- */}

        {/* --- KODE MODAL PANDUAN FORMAT (BARU) --- */}
        {isGuideOpen && (
          <div className="absolute inset-0 bg-gray-900/80 z-[80] flex items-center justify-center p-4 backdrop-blur-md">
            <div className={`w-full max-h-[85vh] flex flex-col rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200 border ${isDarkMode ? 'bg-gray-900 border-gray-800 text-gray-100' : 'bg-white border-gray-100 text-gray-800'}`}>
              
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-black">Panduan Format</h3>
                <button onClick={handleCopyGuide} className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded-xl text-[10px] font-black transition-colors flex items-center gap-1.5 shadow-md active:scale-95">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                  SALIN TEKS
                </button>
              </div>

              <div className={`flex-1 overflow-y-auto pr-2 space-y-4 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                
                {/* Aturan 1 */}
                <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                  <p className="font-extrabold text-orange-500 mb-1">1. Format Dasar (Waktu Nyambung)</p>
                  <p className="mb-2 opacity-80 text-[10px]">Waktu selesai otomatis dihitung dari waktu aktivitas berikutnya.</p>
                  <code className={`block p-3 rounded-xl font-mono text-[10px] leading-relaxed shadow-inner ${isDarkMode ? 'bg-gray-950 text-green-400' : 'bg-gray-900 text-green-400'}`}>
                    [12/10 08.00] : Sarapan pagi<br/>
                    [12/10 08.30] : Mulai kerja
                  </code>
                </div>

                {/* Aturan 2 */}
                <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                  <p className="font-extrabold text-orange-500 mb-1">2. Format Eksplisit (Batas Waktu Jelas)</p>
                  <p className="mb-2 opacity-80 text-[10px]">Menentukan jam mulai dan selesai dalam satu baris.</p>
                  <code className={`block p-3 rounded-xl font-mono text-[10px] leading-relaxed shadow-inner ${isDarkMode ? 'bg-gray-950 text-green-400' : 'bg-gray-900 text-green-400'}`}>
                    [12/10 09.00] : 10.30 Olahraga
                  </code>
                </div>

                {/* Aturan 3 */}
                <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                  <p className="font-extrabold text-orange-500 mb-1">3. Jeda / Sesi (Istirahat)</p>
                  <p className="mb-2 opacity-80 text-[10px]">Gunakan titik dua (..) untuk menjeda, titik tiga (...) untuk melanjutkan.</p>
                  <code className={`block p-3 rounded-xl font-mono text-[10px] leading-relaxed shadow-inner ${isDarkMode ? 'bg-gray-950 text-green-400' : 'bg-gray-900 text-green-400'}`}>
                    [12/10 13.00] : Belajar<br/>
                    [12/10 14.00] : ..<br/>
                    [12/10 14.30] : ...<br/>
                    [12/10 15.30] : .
                  </code>
                </div>

                {/* Aturan 4 */}
                <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                  <p className="font-extrabold text-orange-500 mb-1">4. Menandai Berhenti / Selesai</p>
                  <p className="mb-2 opacity-80 text-[10px]">Gunakan titik tunggal (.) untuk menutup aktivitas akhir.</p>
                  <code className={`block p-3 rounded-xl font-mono text-[10px] leading-relaxed shadow-inner ${isDarkMode ? 'bg-gray-950 text-green-400' : 'bg-gray-900 text-green-400'}`}>
                    [12/10 11.00] : .
                  </code>
                </div>

                {/* Aturan 5 */}
                <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                  <p className="font-extrabold text-orange-500 mb-1">5. Aktivitas Mundur (Backward)</p>
                  <p className="mb-2 opacity-80 text-[10px]">Aktivitas yang baru teringat dicatat, letakkan titik sebelum nama (. Nama).</p>
                  <code className={`block p-3 rounded-xl font-mono text-[10px] leading-relaxed shadow-inner ${isDarkMode ? 'bg-gray-950 text-green-400' : 'bg-gray-900 text-green-400'}`}>
                    [12/10 16.00] : Mulai Kerja<br/>
                    [12/10 16.30] : . Balas Email
                  </code>
                </div>

              </div>

              <div className={`mt-5 pt-4 border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                <button onClick={() => setIsGuideOpen(false)} className={`w-full py-3.5 rounded-2xl font-bold transition-colors shadow-sm ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}>
                  Tutup Panduan
                </button>
              </div>

            </div>
          </div>
        )}
        {/* --- BATAS KODE MODAL PANDUAN FORMAT --- */}

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

          <button onClick={() => setIsModalOpen(true)} className={`relative -top-4 bg-orange-500 text-white p-3.5 rounded-full shadow-lg shadow-orange-500/40 border-[6px] hover:bg-orange-600 hover:scale-105 transition-all active:scale-95 flex-shrink-0 z-10 ${isDarkMode ? 'border-gray-900' : 'border-white'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"></path></svg>
          </button>

          {/* TOMBOL VISUAL (BARU) */}
          <button onClick={() => setActiveTab('visual')} className={`flex flex-col items-center space-y-1 w-[4.5rem] ${activeTab === 'visual' ? 'text-orange-500' : 'text-gray-300 hover:text-gray-500'}`}>
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
             <span className="text-[10px] font-extrabold">Visual</span>
          </button>

          <button onClick={() => setActiveTab('settings')} className={`flex flex-col items-center space-y-1 w-[4.5rem] ${activeTab === 'settings' ? 'text-orange-500' : 'text-gray-300 hover:text-gray-500'}`}>
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
             <span className="text-[10px] font-extrabold">Setelan</span>
          </button>

        </div>
      </div> 
    </div> 
  );
}
