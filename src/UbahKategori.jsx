import { useState, useEffect } from 'react';

// ─── BOOLEAN EXPRESSION EVALUATOR (AND / OR / Parentheses, Case-Insensitive) ───
function evaluateExpression(text, expression) {
  if (!expression || !expression.trim() || !text) return false;
  const textLower = text.toLowerCase();

  // Tokenize expression string
  const tokens = [];
  let i = 0;
  const expr = expression.trim();
  while (i < expr.length) {
    if (expr[i] === ' ') { i++; continue; }
    if (expr[i] === '(') { tokens.push('('); i++; continue; }
    if (expr[i] === ')') { tokens.push(')'); i++; continue; }
    if (expr[i] === '"') {
      let j = i + 1;
      while (j < expr.length && expr[j] !== '"') j++;
      tokens.push(expr.slice(i + 1, j).toLowerCase());
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < expr.length && expr[j] !== ' ' && expr[j] !== '(' && expr[j] !== ')') j++;
    const word = expr.slice(i, j);
    const upper = word.toUpperCase();
    if (upper === 'AND') tokens.push('AND');
    else if (upper === 'OR') tokens.push('OR');
    else tokens.push(word.toLowerCase());
    i = j;
  }

  // Recursive descent parser (precedence: Parentheses > AND > OR)
  let pos = 0;

  function parseOr() {
    let left = parseAnd();
    while (pos < tokens.length && tokens[pos] === 'OR') {
      pos++;
      const right = parseAnd();
      left = left || right;
    }
    return left;
  }

  function parseAnd() {
    let left = parsePrimary();
    while (pos < tokens.length && tokens[pos] === 'AND') {
      pos++;
      const right = parsePrimary();
      left = left && right;
    }
    return left;
  }

  function parsePrimary() {
    if (pos >= tokens.length) return false;
    if (tokens[pos] === '(') {
      pos++;
      const result = parseOr();
      if (pos < tokens.length && tokens[pos] === ')') pos++;
      return result;
    }
    if (tokens[pos] === 'OR') { pos++; return parsePrimary(); }
    if (typeof tokens[pos] === 'string' && tokens[pos] !== 'AND' && tokens[pos] !== 'OR') {
      const word = tokens[pos];
      pos++;
      return textLower.includes(word);
    }
    pos++;
    return false;
  }

  return parseOr();
}

export default function UbahKategori({ daftarAktivitas, daftarKategori, fungsiUbahKategori, fungsiBulkSetCategory, onSelesai }) {
  // mode: 'welcome' (L1) | 'manual' (L2) | 'done'
  const [mode, setMode] = useState('welcome');

  // ── L1 States ──
  const [filterRules, setFilterRules] = useState([{ keyword: '', category: '' }]);
  const [allCategories, setAllCategories] = useState(daftarKategori);
  const [notif, setNotif] = useState(null);
  const [notifType, setNotifType] = useState('success'); // 'success' | 'info'

  // ── L2 States (Manual Wizard) ──
  const [manualQueue, setManualQueue] = useState([]);
  const [manualIdx, setManualIdx] = useState(0);

  // Auto-dismiss notification
  useEffect(() => {
    if (notif) {
      const t = setTimeout(() => setNotif(null), 3500);
      return () => clearTimeout(t);
    }
  }, [notif]);

  // Sinkronisasi daftar kategori dari parent jika berubah
  useEffect(() => {
    setAllCategories(daftarKategori);
  }, [daftarKategori]);

  // Hitung aktivitas tanpa kategori
  const uncategorized = daftarAktivitas.filter(a => !a.category || a.category === '');
  const sisaCount = uncategorized.length;

  // ── FILTER RULE HANDLERS ──
  const addRule = () => setFilterRules(prev => [...prev, { keyword: '', category: '' }]);
  const removeRule = (idx) => setFilterRules(prev => prev.filter((_, i) => i !== idx));
  const updateRule = (idx, field, val) => {
    setFilterRules(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  };

  // ── EKSEKUSI KATEGORISASI OTOMATIS ──
  const handleMulaiKategorikan = () => {
    const validRules = filterRules.filter(r => r.keyword.trim() && r.category.trim());
    const toAutoUpdate = [];
    const toManualQueue = [];

    uncategorized.forEach(activity => {
      const matchedCategories = [];
      validRules.forEach(rule => {
        if (evaluateExpression(activity.activity, rule.keyword)) {
          matchedCategories.push(rule.category.trim());
        }
      });

      if (matchedCategories.length === 0) {
        toManualQueue.push(activity);
      } else {
        const unique = [...new Set(matchedCategories)];
        if (unique.length === 1) {
          toAutoUpdate.push({ id: activity.id, category: unique[0] });
        } else {
          // Benturan aturan: beberapa kategori berbeda
          toManualQueue.push(activity);
        }
      }
    });

    // Terapkan kategorisasi otomatis
    if (toAutoUpdate.length > 0) {
      fungsiBulkSetCategory(toAutoUpdate);
    }

    // Tambahkan kategori baru dari filter ke daftar lokal
    const newCats = validRules
      .map(r => r.category.trim())
      .filter(c => c && !allCategories.some(ac => ac.nama === c));
    if (newCats.length > 0) {
      setAllCategories(prev => [...prev, ...newCats.map(c => ({ id: c, nama: c }))]);
    }

    // Tampilkan notifikasi
    if (toAutoUpdate.length > 0) {
      setNotifType('success');
      setNotif(`✓ ${toAutoUpdate.length} aktivitas berhasil dikategorikan secara otomatis`);
    } else {
      setNotifType('info');
      setNotif('Tidak ada aktivitas yang cocok dengan filter otomatis');
    }

    // Pindah ke L2 jika masih ada sisa
    if (toManualQueue.length > 0) {
      setManualQueue(toManualQueue);
      setManualIdx(0);
      setTimeout(() => setMode('manual'), 1500);
    } else {
      setTimeout(() => onSelesai(), 2000);
    }
  };

  // ── L2 MANUAL WIZARD HANDLERS ──
  const handlePilihManual = (namaKategori) => {
    const act = manualQueue[manualIdx];
    fungsiUbahKategori(act.id, namaKategori);
    if (manualIdx < manualQueue.length - 1) {
      setManualIdx(prev => prev + 1);
    } else {
      setMode('done');
    }
  };

  const handleLewati = () => {
    if (manualIdx < manualQueue.length - 1) {
      setManualIdx(prev => prev + 1);
    } else {
      setMode('done');
    }
  };

  // ════════════════════════ RENDER ════════════════════════
  return (
    <div className="p-4 border rounded-2xl shadow-sm bg-white mt-4 dark:bg-gray-800 dark:border-gray-700">

      {/* ── NOTIFIKASI ── */}
      {notif && (
        <div className={`mb-4 p-3 rounded-xl text-sm font-bold text-center animate-in slide-in-from-top-2 fade-in ${
          notifType === 'success'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        }`}>
          {notif}
        </div>
      )}

      {/* ════════ LAYER 1 (L1): PENGKATEGORI OTOMATIS ════════ */}
      {mode === 'welcome' && (
        <div>
          <h3 className="text-lg font-bold mb-2 dark:text-gray-100">Rapikan Kategori</h3>
          <p className="mb-4 text-sm dark:text-gray-400">
            Ada <span className="font-bold text-orange-500">{sisaCount}</span> aktivitas yang belum memiliki kategori.
          </p>

          {/* ── SUB-SEKSI PENGKATEGORI OTOMATIS ── */}
          <div className="mb-4 p-4 border border-dashed border-gray-200 rounded-2xl dark:border-gray-700">
            <p className="text-xs font-extrabold text-gray-500 uppercase tracking-wider mb-3 dark:text-gray-400">
              ── Pengkategori Otomatis Aktivitas (Kelola Aturan Logika) ──
            </p>

            {/* Header kolom */}
            <div className="flex gap-2 mb-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              <div className="flex-1 min-w-0">Kata Kunci Logika (Case-Insensitive)</div>
              <div className="w-32 flex-shrink-0">Kategori Target</div>
              <div className="w-9 flex-shrink-0"></div>
            </div>

            {/* Baris filter */}
            {filterRules.map((rule, idx) => (
              <div key={idx} className="flex gap-2 mb-2 items-center">
                <input
                  type="text"
                  value={rule.keyword}
                  onChange={(e) => updateRule(idx, 'keyword', e.target.value)}
                  placeholder='Contoh: ("Aktifitas" AND "makan") OR "olahraga"'
                  className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:ring-2 focus:ring-orange-500 dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400"
                />
                <input
                  list={`auto-cat-list-${idx}`}
                  value={rule.category}
                  onChange={(e) => updateRule(idx, 'category', e.target.value)}
                  placeholder="Kategori"
                  className="w-32 flex-shrink-0 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:ring-2 focus:ring-orange-500 dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 placeholder-gray-400"
                />
                <datalist id={`auto-cat-list-${idx}`}>
                  {allCategories.map(c => (
                    <option key={c.id} value={c.nama} />
                  ))}
                </datalist>
                <button
                  onClick={() => removeRule(idx)}
                  disabled={filterRules.length <= 1}
                  className="flex-shrink-0 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-25 disabled:cursor-not-allowed dark:hover:bg-red-900/20"
                  title="Hapus baris ini"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
              </div>
            ))}

            {/* Tombol Tambah Baris */}
            <button
              onClick={addRule}
              className="w-full py-2.5 border-2 border-dashed border-gray-300 text-gray-400 text-xs font-bold rounded-xl hover:border-orange-400 hover:text-orange-500 transition-colors dark:border-gray-700 dark:hover:border-orange-500 dark:hover:text-orange-400"
            >
              + Tambah Baris Filter
            </button>
          </div>

          {/* ── TOMBOL MULAI KATEGORIKAN ── */}
          {sisaCount > 0 && (
            <button
              onClick={handleMulaiKategorikan}
              className="w-full px-4 py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-colors active:scale-95 shadow-md"
            >
              Mulai Kategorikan
            </button>
          )}
          {sisaCount === 0 && (
            <div className="text-center py-4 text-green-500 font-bold text-sm dark:text-green-400">
              Semua aktivitas sudah memiliki kategori!
            </div>
          )}
        </div>
      )}

      {/* ════════ LAYER 2 (L2): WIZARD MANUAL ════════ */}
      {mode === 'manual' && manualQueue.length > 0 && manualIdx < manualQueue.length && (
        <div>
          <h3 className="text-lg font-bold mb-4 dark:text-gray-100">Pilih Kategori</h3>

          {/* Info aktivitas */}
          <div className="mb-5 p-5 bg-orange-50 rounded-2xl border border-orange-100 text-center dark:bg-gray-900 dark:border-gray-700 flex flex-col justify-center items-center min-h-[100px]">
            <p className="text-[10px] text-gray-500 mb-1.5 font-medium dark:text-gray-400">Aktivitas yang belum dikategorikan:</p>
            <p className="font-black text-xl text-gray-800 dark:text-gray-100">{manualQueue[manualIdx].activity}</p>
            <p className="text-[11px] text-gray-400 font-bold mt-2 uppercase tracking-wider bg-white dark:bg-gray-800 px-3 py-1 rounded-lg border border-orange-100 dark:border-gray-600 inline-block shadow-sm">
              {manualQueue[manualIdx].date} • {manualQueue[manualIdx].startTime} - {manualQueue[manualIdx].endTime}
            </p>
            <p className="text-[10px] text-gray-400 mt-2 font-bold">{manualIdx + 1} dari {manualQueue.length}</p>
          </div>

          <p className="mb-3 text-xs font-bold text-gray-500 dark:text-gray-400 text-center">Pilih kategori yang sesuai:</p>

          {/* Tombol Kategori */}
          <div className="flex flex-wrap justify-center gap-2 mb-6">
            {allCategories.map((kategori) => (
              <button
                key={kategori.id}
                onClick={() => handlePilihManual(kategori.nama)}
                className="px-4 py-2.5 bg-gray-100 text-gray-700 font-bold text-sm rounded-xl hover:bg-orange-500 hover:text-white transition-colors active:scale-95 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-orange-500"
              >
                {kategori.nama}
              </button>
            ))}
          </div>

          {/* Tombol Bawah */}
          <div className="flex flex-col gap-2 text-center border-t border-gray-100 dark:border-gray-700 pt-5 mt-2">
            <button
              onClick={handleLewati}
              className="text-xs font-bold text-gray-500 hover:text-gray-800 px-4 py-3 rounded-xl bg-gray-50 hover:bg-gray-200 transition-colors active:scale-95 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            >
              Lewati Aktivitas Ini
            </button>
            <button
              onClick={onSelesai}
              className="text-xs font-bold text-red-400 hover:text-red-600 px-4 py-2 rounded-lg transition-colors"
            >
              Berhenti Kategorisasi
            </button>
          </div>
        </div>
      )}

      {/* ════════ SELESAI ════════ */}
      {mode === 'done' && (
        <div className="p-5 border rounded-2xl shadow-sm bg-green-50 border-green-200 mt-2 text-center dark:bg-green-900/20 dark:border-green-800/30">
          <div className="w-12 h-12 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-3 dark:bg-green-800 dark:text-green-300">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <h3 className="text-lg font-extrabold mb-1 text-green-700 dark:text-green-400">Selesai!</h3>
          <p className="mb-4 text-sm text-green-600 dark:text-green-500">Tidak ada lagi aktivitas yang perlu dikategorikan saat ini.</p>
          <button
            onClick={onSelesai}
            className="px-5 py-2.5 bg-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            Tutup
          </button>
        </div>
      )}
    </div>
  );
}
