// storage.js v3 ── 資料層。對外只有一組固定動作（介面），背後有兩種做法：
//   local：存在裝置的 localStorage（沒設定雲端時）
//   cloud：存在 Firebase Firestore，登入後跨裝置同步，離線時先寫本機快取、上線自動補送
// 畫面（app.js）只認這些動作的名字，不知道也不需要知道背後是哪一種。（見 L02、L06）
//
// v3 新增：我的食物（自訂食物永久保存）、找不到回報。

import { firebaseConfig } from './firebase-config.js';

const LOCAL_KEY = 'calorie-app:entries';
const SETTINGS_KEY = 'calorie-app:settings';
const MYFOODS_KEY = 'calorie-app:myfoods';
const MISSING_KEY = 'calorie-app:missing';
const WEIGHTS_KEY = 'calorie-app:weights';   // { 'YYYY-MM-DD': { date, kg, ts } }
const DEFAULT_SETTINGS = { goalKcal: 1800 };

// ---------- 共用：本機讀寫 ----------
const readJSON = (k, fallback) => JSON.parse(localStorage.getItem(k) || JSON.stringify(fallback));
const writeJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const readLocal = () => readJSON(LOCAL_KEY, []);
const writeLocal = list => writeJSON(LOCAL_KEY, list);
const readSettingsLocal = () => ({ ...DEFAULT_SETTINGS, ...readJSON(SETTINGS_KEY, {}) });
const writeSettingsLocal = s => writeJSON(SETTINGS_KEY, s);

// 把使用者自訂的食物整理成跟資料庫一樣的形狀，搜尋層才能一視同仁
function shapeMyFood(f) {
  return {
    id: f.id || 'my-' + crypto.randomUUID(),
    name: String(f.name).trim(),
    aliases: f.aliases || [],
    category: 'custom',
    brand: '我的',
    unit_desc: f.unit_desc || '1 份',
    unit_g: f.unit_g ?? null,
    kcal: Number(f.kcal),
    protein_g: f.protein_g ?? null,
    carb_g: f.carb_g ?? null,
    fat_g: f.fat_g ?? null,
    source: '自訂',
    confidence: 'low',
    ts: f.ts || Date.now(),
  };
}

// ---------- 做法一：本機 ----------
function makeLocalBackend() {
  const dayListeners = new Set();
  const foodListeners = new Set();
  const byDate = date => readLocal().filter(e => e.date === date).sort((a, b) => a.ts - b.ts);
  const notifyDays = () => dayListeners.forEach(l => l.cb(l.kind === 'w' ? (readJSON(WEIGHTS_KEY, {})[l.date] || null) : byDate(l.date)));
  const notifyFoods = () => foodListeners.forEach(cb => cb(readJSON(MYFOODS_KEY, [])));
  return {
    mode: 'local',
    async init() {},
    onAuth(cb) { cb({ local: true }); return () => {}; },
    // 紀錄
    subscribeDay(date, cb) { const l = { date, cb }; dayListeners.add(l); cb(byDate(date)); return () => dayListeners.delete(l); },
    async add(entry) { const saved = { ...entry, id: crypto.randomUUID(), ts: Date.now() }; writeLocal([...readLocal(), saved]); notifyDays(); return saved; },
    async put(entry) { writeLocal([...readLocal(), entry]); notifyDays(); },
    async remove(id) { writeLocal(readLocal().filter(e => e.id !== id)); notifyDays(); },
    async allEntries() { return readLocal(); },
    // 設定
    getSettings: readSettingsLocal,
    async saveSettings(patch) { writeSettingsLocal({ ...readSettingsLocal(), ...patch }); notifyDays(); },
    onSettings(cb) { cb(readSettingsLocal()); return () => {}; },
    // 我的食物
    onMyFoods(cb) { foodListeners.add(cb); cb(readJSON(MYFOODS_KEY, [])); return () => foodListeners.delete(cb); },
    async addMyFood(food) { const f = shapeMyFood(food); writeJSON(MYFOODS_KEY, [...readJSON(MYFOODS_KEY, []), f]); notifyFoods(); return f; },
    async removeMyFood(id) { writeJSON(MYFOODS_KEY, readJSON(MYFOODS_KEY, []).filter(f => f.id !== id)); notifyFoods(); },
    // 體重（每天一筆，以日期為 key）
    subscribeWeight(date, cb) { const l = { date, cb, kind: 'w' }; dayListeners.add(l); cb(readJSON(WEIGHTS_KEY, {})[date] || null); return () => dayListeners.delete(l); },
    async saveWeight(date, kg) { const w = readJSON(WEIGHTS_KEY, {}); w[date] = { date, kg: Number(kg), ts: Date.now() }; writeJSON(WEIGHTS_KEY, w); notifyDays(); },
    async removeWeight(date) { const w = readJSON(WEIGHTS_KEY, {}); delete w[date]; writeJSON(WEIGHTS_KEY, w); notifyDays(); },
    async latestWeightBefore(date) { return Object.values(readJSON(WEIGHTS_KEY, {})).filter(x => x.date < date).sort((a, b) => b.date.localeCompare(a.date))[0] || null; },
    async allWeights() { return Object.values(readJSON(WEIGHTS_KEY, {})); },
    // 月摘要：{ 'YYYY-MM-DD': { kcal, count, kg } }，給月曆用
    async monthSummary(ym) {
      const out = {};
      for (const e of readLocal()) if (e.date.startsWith(ym)) { const o = out[e.date] ||= { kcal: 0, count: 0, kg: null }; o.kcal += e.kcal || 0; o.count++; }
      for (const w of Object.values(readJSON(WEIGHTS_KEY, {}))) if (w.date.startsWith(ym)) (out[w.date] ||= { kcal: 0, count: 0, kg: null }).kg = w.kg;
      return out;
    },
    // 找不到回報（本機模式只記在裝置上）
    async reportMissing(query) { writeJSON(MISSING_KEY, [...readJSON(MISSING_KEY, []), { query, ts: Date.now() }]); },
    // 帳號（本機模式沒有這些功能，給空動作讓畫面不會出錯）
    async signIn() {}, async signUp() {}, async signOut() {}, async resetPassword() {},
  };
}

// ---------- 做法二：雲端 Firebase ----------
async function makeCloudBackend(config) {
  const V = '11.8.0';
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const auth = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);

  const app = initializeApp(config);
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  const a = auth.getAuth(app);
  a.languageCode = 'zh-TW';

  let uid = null, email = null;
  let settingsCache = readSettingsLocal();
  const entriesCol = () => fs.collection(db, 'users', uid, 'entries');
  const foodsCol = () => fs.collection(db, 'users', uid, 'foods');
  const settingsDoc = () => fs.doc(db, 'users', uid, 'meta', 'settings');
  const weightsCol = () => fs.collection(db, 'users', uid, 'weights');

  async function migrateLocal() {
    const local = readLocal();
    const myLocal = readJSON(MYFOODS_KEY, []);
    const wLocal = Object.values(readJSON(WEIGHTS_KEY, {}));
    if (!local.length && !myLocal.length && !wLocal.length) return 0;
    const batch = fs.writeBatch(db);
    for (const e of local) batch.set(fs.doc(entriesCol(), e.id), e);
    for (const f of myLocal) batch.set(fs.doc(foodsCol(), f.id), f);
    for (const w of wLocal) batch.set(fs.doc(weightsCol(), w.date), w);
    await batch.commit();
    writeLocal([]); writeJSON(MYFOODS_KEY, []); writeJSON(WEIGHTS_KEY, {});
    return local.length + myLocal.length;
  }

  return {
    mode: 'cloud',
    async init() {},
    onAuth(cb) {
      return auth.onAuthStateChanged(a, async user => {
        uid = user ? user.uid : null; email = user ? user.email : null;
        if (user) { try { await migrateLocal(); } catch (e) { console.warn('搬移本機資料失敗', e); } }
        cb(user ? { email: user.email, uid: user.uid } : null);
      });
    },
    // 紀錄
    subscribeDay(date, cb) {
      if (!uid) { cb([]); return () => {}; }
      const q = fs.query(entriesCol(), fs.where('date', '==', date));
      return fs.onSnapshot(q, snap => cb(snap.docs.map(d => d.data()).sort((x, y) => x.ts - y.ts)),
        err => console.error('讀取紀錄失敗', err));
    },
    async add(entry) { const saved = { ...entry, id: crypto.randomUUID(), ts: Date.now() }; fs.setDoc(fs.doc(entriesCol(), saved.id), saved); return saved; },
    async put(entry) { fs.setDoc(fs.doc(entriesCol(), entry.id), entry); },
    async remove(id) { fs.deleteDoc(fs.doc(entriesCol(), id)); },
    async allEntries() { const snap = await fs.getDocs(entriesCol()); return snap.docs.map(d => d.data()); },
    // 設定
    getSettings: () => settingsCache,
    async saveSettings(patch) { settingsCache = { ...settingsCache, ...patch }; writeSettingsLocal(settingsCache); fs.setDoc(settingsDoc(), settingsCache, { merge: true }); },
    onSettings(cb) {
      if (!uid) { cb(settingsCache); return () => {}; }
      return fs.onSnapshot(settingsDoc(), snap => {
        if (snap.exists()) { settingsCache = { ...DEFAULT_SETTINGS, ...snap.data() }; writeSettingsLocal(settingsCache); }
        cb(settingsCache);
      });
    },
    // 我的食物
    onMyFoods(cb) {
      if (!uid) { cb([]); return () => {}; }
      return fs.onSnapshot(foodsCol(), snap => cb(snap.docs.map(d => d.data()).sort((x, y) => y.ts - x.ts)),
        err => console.error('讀取我的食物失敗', err));
    },
    async addMyFood(food) { const f = shapeMyFood(food); fs.setDoc(fs.doc(foodsCol(), f.id), f); return f; },
    async removeMyFood(id) { fs.deleteDoc(fs.doc(foodsCol(), id)); },
    // 體重：users/{uid}/weights/{date}
    subscribeWeight(date, cb) {
      if (!uid) { cb(null); return () => {}; }
      return fs.onSnapshot(fs.doc(weightsCol(), date), snap => cb(snap.exists() ? snap.data() : null), err => console.error('讀取體重失敗', err));
    },
    async saveWeight(date, kg) { fs.setDoc(fs.doc(weightsCol(), date), { date, kg: Number(kg), ts: Date.now() }); },
    async removeWeight(date) { fs.deleteDoc(fs.doc(weightsCol(), date)); },
    async latestWeightBefore(date) {
      const q = fs.query(weightsCol(), fs.where('date', '<', date), fs.orderBy('date', 'desc'), fs.limit(1));
      const snap = await fs.getDocs(q); return snap.empty ? null : snap.docs[0].data();
    },
    async allWeights() { const snap = await fs.getDocs(weightsCol()); return snap.docs.map(d => d.data()); },
    async monthSummary(ym) {
      if (!uid) return {};
      const out = {};
      const lo = ym + '-01', hi = ym + '-31';
      const es = await fs.getDocs(fs.query(entriesCol(), fs.where('date', '>=', lo), fs.where('date', '<=', hi)));
      es.docs.forEach(d => { const e = d.data(); const o = out[e.date] ||= { kcal: 0, count: 0, kg: null }; o.kcal += e.kcal || 0; o.count++; });
      const ws = await fs.getDocs(fs.query(weightsCol(), fs.where('date', '>=', lo), fs.where('date', '<=', hi)));
      ws.docs.forEach(d => { const w = d.data(); (out[w.date] ||= { kcal: 0, count: 0, kg: null }).kg = w.kg; });
      return out;
    },
    // 找不到回報：寫到頂層 missing 集合，Roseline 在 Firebase 後台看得到
    async reportMissing(query) {
      await fs.addDoc(fs.collection(db, 'missing'), { query, uid, email, ts: Date.now(), date: new Date().toISOString().slice(0, 10) });
    },
    // 帳號
    signIn: (em, pw) => auth.signInWithEmailAndPassword(a, em, pw),
    signUp: (em, pw) => auth.createUserWithEmailAndPassword(a, em, pw),
    signOut: () => auth.signOut(a),
    resetPassword: em => auth.sendPasswordResetEmail(a, em),
  };
}

// ---------- 對外：依設定決定用哪一種 ----------
let backend = null;
export async function initStorage() {
  // 網址加 ?local 可強制本機模式，方便在沒登入的情況下測試畫面
  const forceLocal = new URLSearchParams(location.search).has('local');
  backend = firebaseConfig && !forceLocal ? await makeCloudBackend(firebaseConfig) : makeLocalBackend();
  await backend.init();
  return backend;
}
export const storage = new Proxy({}, { get: (_, k) => backend[k] });

// 備份格式（兩種做法共用）
export async function exportAll() {
  return { version: 4, exportedAt: new Date().toISOString(), settings: backend.getSettings(), entries: await backend.allEntries(), weights: await backend.allWeights() };
}
export async function importAll(data) {
  if (!data || !Array.isArray(data.entries)) throw new Error('備份檔格式不對');
  const existing = new Set((await backend.allEntries()).map(e => e.id));
  let n = 0;
  for (const e of data.entries) { if (existing.has(e.id)) continue; await backend.put(e); n++; }
  if (Array.isArray(data.weights)) for (const w of data.weights) if (w && w.date && w.kg != null) await backend.saveWeight(w.date, w.kg);
  if (data.settings) await backend.saveSettings(data.settings);
  return n;
}
