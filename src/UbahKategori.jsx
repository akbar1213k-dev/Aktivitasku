import { useState, useEffect } from 'react';

export default function UbahKategori({ daftarAktivitas, daftarKategori, fungsiUbahKategori }) {
  const [mulaiKategorisasi, setMulaiKategorisasi] = useState(false);
  const [notifikasi, setNotifikasi] = useState(null);
  
  // STATE BARU: Untuk mengingat ID aktivitas apa saja yang barusan di-skip
  const [aktivitasDilewati, setAktivitasDilewati] = useState([]); 

  // Efek untuk menghilangkan notifikasi secara otomatis setelah 2.5 detik
  useEffect(() => {
    if (notifikasi) {
      const timer = setTimeout(() => setNotifikasi(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [notifikasi]);

  // LOGIKA BARU: Menyaring aktivitas yang belum punya kategori DAN belum di-skip
  const aktivitasTanpaKategori = daftarAktivitas.filter(
    (aktivitas) => (!aktivitas.category || aktivitas.category === '') && !aktivitasDilewati.includes(aktivitas.id)
  );

  // TAMPILAN 1: Halaman awal
  if (!mulaiKategorisasi) {
    return (
      <div className="p-4 border rounded-2xl shadow-sm bg-white mt-4 dark:bg-gray-800 dark:border-gray-700">
        <h3 className="text-lg font-bold mb-2 dark:text-gray-100">Rapikan Kategori</h3>
        <p className="mb-4 text-sm dark:text-gray-400">
          Ada <span className="font-bold text-orange-500">{aktivitasTanpaKategori.length}</span> aktivitas yang belum memiliki kategori.
        </p>
        {aktivitasTanpaKategori.length > 0 && (
          <button
            onClick={() => setMulaiKategorisasi(true)}
            className="w-full px-4 py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-colors"
          >
            Mulai Kategorikan
          </button>
        )}
      </div>
    );
  }

  // TAMPILAN 2: Selesai (Semua terkategorikan atau di-skip)
  if (aktivitasTanpaKategori.length === 0) {
    return (
      <div className="p-5 border rounded-2xl shadow-sm bg-green-50 border-green-200 mt-4 text-center dark:bg-green-900/20 dark:border-green-800/30">
        <div className="w-12 h-12 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-3 dark:bg-green-800 dark:text-green-300">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
        </div>
        <h3 className="text-lg font-extrabold mb-1 text-green-700 dark:text-green-400">Selesai!</h3>
        <p className="mb-4 text-sm text-green-600 dark:text-green-500">Tidak ada lagi aktivitas yang perlu dikategorikan saat ini.</p>
        <button
          onClick={() => setMulaiKategorisasi(false)}
          className="px-5 py-2.5 bg-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        >
          Tutup
        </button>
      </div>
    );
  }

  // TAMPILAN 3: Menampilkan aktivitas satu per satu
  const aktivitasSaatIni = aktivitasTanpaKategori[0];

  // Fungsi saat tombol kategori ditekan
  const handlePilihKategori = (idAktivitas, namaAktivitas, idKategori, namaKategori) => {
    fungsiUbahKategori(idAktivitas, idKategori);
    setNotifikasi(`Berhasil mengubah kategori "${namaAktivitas}" menjadi "${namaKategori}"`);
  };

  // FUNGSI BARU: Saat tombol Lewati ditekan
  const handleLewati = (idAktivitas) => {
    setAktivitasDilewati([...aktivitasDilewati, idAktivitas]);
  };

  return (
    <div className="p-5 border rounded-2xl shadow-sm bg-white mt-4 relative overflow-hidden dark:bg-gray-800 dark:border-gray-700">
      
      {/* Notifikasi Non-Intrusif */}
      {notifikasi && (
        <div className="absolute top-0 left-0 w-full p-2 bg-green-500 text-white text-xs font-bold text-center animate-in slide-in-from-top-4 fade-in z-10 shadow-sm">
          {notifikasi}
        </div>
      )}

      <h3 className="text-lg font-bold mb-4 mt-2 dark:text-gray-100">Pilih Kategori</h3>
      
      <div className="mb-5 p-5 bg-orange-50 rounded-2xl border border-orange-100 text-center dark:bg-gray-900 dark:border-gray-700 flex flex-col justify-center items-center min-h-[120px]">
        <p className="text-xs text-gray-500 mb-1.5 font-medium dark:text-gray-400">Aktivitas yang belum dikategorikan:</p>
        
        <p className="font-black text-2xl text-gray-800 dark:text-gray-100">{aktivitasSaatIni.activity}</p> 
        
        {/* INFO TANGGAL DAN WAKTU (BARU) */}
        <p className="text-[11px] text-gray-400 font-bold mt-2 uppercase tracking-wider bg-white dark:bg-gray-800 px-3 py-1 rounded-lg border border-orange-100 dark:border-gray-600 inline-block shadow-sm">
          {aktivitasSaatIni.date} • {aktivitasSaatIni.startTime} - {aktivitasSaatIni.endTime}
        </p>
      </div>
      
      <p className="mb-3 text-xs font-bold text-gray-500 dark:text-gray-400 text-center">Pilih kategori yang sesuai:</p>
      
      <div className="flex flex-wrap justify-center gap-2 mb-6">
        {daftarKategori.map((kategori) => (
          <button
            key={kategori.id}
            onClick={() => handlePilihKategori(aktivitasSaatIni.id, aktivitasSaatIni.activity, kategori.id, kategori.nama)}
            className="px-4 py-2.5 bg-gray-100 text-gray-700 font-bold text-sm rounded-xl hover:bg-orange-500 hover:text-white transition-colors active:scale-95 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-orange-500"
          >
            {kategori.nama}
          </button>
        ))}
      </div>
      
      {/* AREA TOMBOL BAWAH */}
      <div className="flex flex-col gap-2 text-center border-t border-gray-100 dark:border-gray-700 pt-5 mt-2">
        
        {/* TOMBOL LEWATI (SKIP) BARU */}
        <button
          onClick={() => handleLewati(aktivitasSaatIni.id)}
          className="text-xs font-bold text-gray-500 hover:text-gray-800 px-4 py-3 rounded-xl bg-gray-50 hover:bg-gray-200 transition-colors active:scale-95 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          Lewati Aktivitas Ini
        </button>

        <button
          onClick={() => setMulaiKategorisasi(false)}
          className="text-xs font-bold text-red-400 hover:text-red-600 px-4 py-2 rounded-lg transition-colors"
        >
          Berhenti Kategorisasi
        </button>
      </div>
    </div>
  );
}
