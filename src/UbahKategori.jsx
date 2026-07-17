import { useState, useEffect } from 'react';

export default function UbahKategori({ daftarAktivitas, daftarKategori, fungsiUbahKategori }) {
  const [mulaiKategorisasi, setMulaiKategorisasi] = useState(false);
  const [notifikasi, setNotifikasi] = useState(null);

  // Efek untuk menghilangkan notifikasi secara otomatis setelah 2.5 detik
  useEffect(() => {
    if (notifikasi) {
      const timer = setTimeout(() => setNotifikasi(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [notifikasi]);

  // PERBAIKAN BUG: Menggunakan label 'category', bukan 'kategori'
  const aktivitasTanpaKategori = daftarAktivitas.filter(
    (aktivitas) => !aktivitas.category || aktivitas.category === ''
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

  // TAMPILAN 2: Selesai (Semua terkategorikan)
  if (aktivitasTanpaKategori.length === 0) {
    return (
      <div className="p-5 border rounded-2xl shadow-sm bg-green-50 border-green-200 mt-4 text-center dark:bg-green-900/20 dark:border-green-800/30">
        <div className="w-12 h-12 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-3 dark:bg-green-800 dark:text-green-300">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
        </div>
        <h3 className="text-lg font-extrabold mb-1 text-green-700 dark:text-green-400">Selesai!</h3>
        <p className="mb-4 text-sm text-green-600 dark:text-green-500">Hebat! Semua aktivitas saat ini sudah memiliki kategori.</p>
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

  return (
    <div className="p-5 border rounded-2xl shadow-sm bg-white mt-4 relative overflow-hidden dark:bg-gray-800 dark:border-gray-700">
      
      {/* Notifikasi Non-Intrusif (Mengambang di atas, tidak menggeser tombol) */}
      {notifikasi && (
        <div className="absolute top-0 left-0 w-full p-2 bg-green-500 text-white text-xs font-bold text-center animate-in slide-in-from-top-4 fade-in z-10 shadow-sm">
          {notifikasi}
        </div>
      )}

      <h3 className="text-lg font-bold mb-4 mt-2 dark:text-gray-100">Pilih Kategori</h3>
      
      <div className="mb-5 p-5 bg-orange-50 rounded-2xl border border-orange-100 text-center dark:bg-gray-900 dark:border-gray-700">
        <p className="text-xs text-gray-500 mb-2 font-medium dark:text-gray-400">Aktivitas yang belum dikategorikan:</p>
        {/* PERBAIKAN BUG: Menggunakan label 'activity', bukan 'nama' */}
        <p className="font-black text-2xl text-gray-800 dark:text-gray-100">{aktivitasSaatIni.activity}</p> 
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
      
      <div className="text-center">
        <button
          onClick={() => setMulaiKategorisasi(false)}
          className="text-xs font-bold text-red-500 hover:text-red-600 px-4 py-2 rounded-lg hover:bg-red-50 transition-colors dark:hover:bg-red-500/10"
        >
          Berhenti Kategorisasi
        </button>
      </div>
    </div>
  );
}
