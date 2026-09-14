// storage.js ── 資料層：所有「存、讀、刪、備份」都只經過這裡。
// 目前用瀏覽器內建的 localStorage 存在裝置本機。
// 將來要改雲端同步，只改這個檔案，其他檔案不用動（見 L02）。

const STORAGE_KEY = 'calorie-app:entries';   // 紀錄存放的抽屜名稱
const SETTINGS_KEY = 'calorie-app:settings'; // 設定存放的抽屜名稱

function readAll() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function writeAll(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export const storage = {
  // 新增一筆紀錄，回傳存好的那筆（含自動產生的 id）
  add(entry) {
    const entries = readAll();
    const saved = { ...entry, id: crypto.randomUUID(), ts: Date.now() };
    entries.push(saved);
    writeAll(entries);
    return saved;
  },

  // 讀某一天（'YYYY-MM-DD'）的所有紀錄，依加入時間排序
  listByDate(date) {
    return readAll()
      .filter(e => e.date === date)
      .sort((a, b) => a.ts - b.ts);
  },

  // 刪除一筆
  remove(id) {
    writeAll(readAll().filter(e => e.id !== id));
  },

  // 匯出全部（給備份用）
  exportAll() {
    return { version: 1, exportedAt: new Date().toISOString(),
             settings: this.getSettings(), entries: readAll() };
  },

  // 匯入備份：同 id 的不重複加入，回傳新增筆數
  importAll(data) {
    if (!data || !Array.isArray(data.entries)) throw new Error('備份檔格式不對');
    const existing = readAll();
    const known = new Set(existing.map(e => e.id));
    const fresh = data.entries.filter(e => !known.has(e.id));
    writeAll([...existing, ...fresh]);
    if (data.settings) this.saveSettings(data.settings);
    return fresh.length;
  },

  getSettings() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { goalKcal: 1800, ...(raw ? JSON.parse(raw) : {}) };
  },

  saveSettings(patch) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...this.getSettings(), ...patch }));
  },
};
