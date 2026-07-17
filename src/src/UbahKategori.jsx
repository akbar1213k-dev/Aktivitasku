import { useState } from 'react';

export default function UbahKategori({ daftarAktivitas, daftarKategori, fungsiUbahKategori }) {
  // State untuk melacak apakah user sudah mengklik tombol 'Mulai Kategorikan'
  const [mulaiKategorisasi, setMulaiKategorisasi] = useState(false);

  // Memisahkan aktivitas yang belum memiliki kategori (kategori kosong atau belum ada datanya)
  const aktivitasTanpaKategori = daftarAktivitas.filter(
    (aktivitas) => !aktivitas.kategori || aktivitas.kategori === ''
  );

  // TAMPILAN 1: Halaman awal sebelum tombol 'Mulai Kategorikan' diklik
  if (!mulaiKategorisasi) {
    return (
      <div className="p-4 border rounded shadow-sm bg-white mt-4">
        <h3 className="text-lg font-bold mb-2">Ubah Kategori</h3>
        <p className="mb-4">
          Ada {aktivitasTanpaKategori.length} aktivitas yang belum memiliki kategori.
        </p>
        {aktivitasTanpaKategori.length > 0 && (
          <button
            onClick={() => setMulaiKategorisasi(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
          >
            Mulai Kategorikan
          </button>
        )}
      </div>
    );
  }

  // TAMPILAN 2: Jika user sedang mengkategorikan, tapi semua aktivitas sudah habis (selesai)
  if (aktivitasTanpaKategori.length === 0) {
    return (
      <div className="p-4 border rounded shadow-sm bg-white mt-4">
        <h3 className="text-lg font-bold mb-2 text-green-600">Selesai!</h3>
        <p className="mb-4">Hebat! Semua aktivitas saat ini sudah memiliki kategori.</p>
        <button
          onClick={() => setMulaiKategorisasi(false)}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition"
        >
          Kembali ke Pengaturan
        </button>
      </div>
    );
  }

  // TAMPILAN 3: Menampilkan aktivitas satu per satu. 
  // Begitu kategori dipilih, aktivitas ini otomatis keluar dari daftar, 
  // sehingga index ke-0 akan selalu diisi oleh aktivitas selanjutnya yang belum dikategorikan.
  const aktivitasSaatIni = aktivitasTanpaKategori[0];

  return (
    <div className="p-4 border rounded shadow-sm bg-white mt-4">
      <h3 className="text-lg font-bold mb-2">Pilih Kategori</h3>
      
      <div className="mb-4 p-4 bg-gray-100 rounded border border-gray-300">
        <p className="text-sm text-gray-500 mb-1">Aktivitas yang belum dikategorikan:</p>
        {/* Asumsi properti nama aktivitas disimpan di 'nama', jika di kode Anda berbeda (misal 'title'), ini perlu disesuaikan nanti */}
        <p className="font-semibold text-xl">{aktivitasSaatIni.nama}</p> 
      </div>
      
      <p className="mb-3 text-sm">Pilih kategori yang sesuai untuk aktivitas di atas:</p>
      
      <div className="flex flex-wrap gap-2 mb-6">
        {daftarKategori.map((kategori) => (
          <button
            key={kategori.id}
            onClick={() => fungsiUbahKategori(aktivitasSaatIni.id, kategori.id)}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition"
          >
            {kategori.nama}
          </button>
        ))}
      </div>
      
      <button
        onClick={() => setMulaiKategorisasi(false)}
        className="text-sm text-red-500 hover:text-red-700 underline"
      >
        Batal & Berhenti Kategorisasi
      </button>
    </div>
  );
}
