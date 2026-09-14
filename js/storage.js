// storage.js v2 ── 資料層。對外只有一組固定動作（介面），背後有兩種做法：
//   local：存在裝置的 localStorage（沒設定雲端時）
//   cloud：存在 Firebase Firestore，登入後跨裝置同步，離線時先寫本機快取、上線自動補送
// 畫面（app.js）只認這些動作的名字，不知道也不需要知道背後是哪一種。（見 L02）

import { firebaseConfig } from './firebase-config.js';

const LOCAL_KEY = 'calorie-app:entries';
const SETTINGS_KEY = 'calorie-app:settings';
const DEFAULT_SETTINGS = { goalKcal: 1800 };

// ---------- 共用：本機讀寫 ----------
const readLocal = () => JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
const writeLocal = list => localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
const readSettingsLocal = () => ({ ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') });
const writeSettingsLocal = s => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));

// ---------- 做法一：本機 ----------
function makeLocalBackend() {
  const listeners = new Set();           // 誰在看哪一天
  const notify = () => listeners.forEach(l => l.cb(byDate(l.date)));
  const byDate = date => readLocal().filter(e => e.date === date).sort((a, b) => a.ts - b.ts);
  return {
    mode: 'local',
    async init() {},
    onAuth(cb) { cb({ local: true }); return () => {}; },   // 本機模式視為「永遠已登入」
    subscribeDay(date, cb) {
      const l = { date, cb }; listeners.add(l); cb(byDate(date));
      return () => listeners.delete(l);
    },
    async add(entry) {
      const saved = { ...entry, id: crypto.randomUUID(), ts: Date.now() };
      writeLocal([...readLocal(), saved]); notify(); return saved;
    },
    async put(entry) { writeLocal([...readLocal(), entry]); notify(); },   // 匯入用：保留原 id 與時間
    async remove(id) { writeLocal(readLocal().filter(e => e.id !== id)); notify(); },
    async allEntries() { return readLocal(); },
    getSettings: readSettingsLocal,
    async saveSettings(patch) { writeSettingsLocal({ ...readSettingsLocal(), ...patch }); notify(); },
    onSettings(cb) { cb(readSettingsLocal()); return () => {}; },
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
  // 離線快取：沒網路也能看、能加，恢復連線自動同步
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  const a = auth.getAuth(app);
  a.languageCode = 'zh-TW';

  let uid = null;
  let settingsCache = readSettingsLocal();
  const entriesCol = () => fs.collection(db, 'users', uid, 'entries');
  const settingsDoc = () => fs.doc(db, 'users', uid, 'meta', 'settings');

  // 第一次登入時，把這台裝置本機模式留下的紀錄搬上雲端（搬完清空本機）
  async function migrateLocal() {
    const local = readLocal();
    if (!local.length) return 0;
    const batch = fs.writeBatch(db);
    for (const e of local) batch.set(fs.doc(entriesCol(), e.id), e);
    await batch.commit();
    writeLocal([]);
    return local.length;
  }

  return {
    mode: 'cloud',
    async init() {},
    onAuth(cb) {
      return auth.onAuthStateChanged(a, async user => {
        uid = user ? user.uid : null;
        if (user) { try { await migrateLocal(); } catch (e) { console.warn('搬移本機紀錄失敗', e); } }
        cb(user ? { email: user.email, uid: user.uid } : null);
      });
    },
    subscribeDay(date, cb) {
      if (!uid) { cb([]); return () => {}; }
      const q = fs.query(entriesCol(), fs.where('date', '==', date));
      return fs.onSnapshot(q, snap => {
        cb(snap.docs.map(d => d.data()).sort((x, y) => x.ts - y.ts));
      }, err => console.error('讀取紀錄失敗', err));
    },
    async add(entry) {
      const saved = { ...entry, id: crypto.randomUUID(), ts: Date.now() };
      fs.setDoc(fs.doc(entriesCol(), saved.id), saved);   // 不 await：離線也立即回應，SDK 自己排隊送出
      return saved;
    },
    async put(entry) { fs.setDoc(fs.doc(entriesCol(), entry.id), entry); },
    async remove(id) { fs.deleteDoc(fs.doc(entriesCol(), id)); },
    async allEntries() {
      const snap = await fs.getDocs(entriesCol());
      return snap.docs.map(d => d.data());
    },
    getSettings: () => settingsCache,
    async saveSettings(patch) {
      settingsCache = { ...settingsCache, ...patch };
      writeSettingsLocal(settingsCache);
      fs.setDoc(settingsDoc(), settingsCache, { merge: true });
    },
    onSettings(cb) {
      if (!uid) { cb(settingsCache); return () => {}; }
      return fs.onSnapshot(settingsDoc(), snap => {
        if (snap.exists()) { settingsCache = { ...DEFAULT_SETTINGS, ...snap.data() }; writeSettingsLocal(settingsCache); }
        cb(settingsCache);
      });
    },
    signIn: (email, pw) => auth.signInWithEmailAndPassword(a, email, pw),
    signUp: (email, pw) => auth.createUserWithEmailAndPassword(a, email, pw),
    signOut: () => auth.signOut(a),
    resetPassword: email => auth.sendPasswordResetEmail(a, email),
  };
}

// ---------- 對外：依設定決定用哪一種 ----------
let backend = null;
export async function initStorage() {
  backend = firebaseConfig ? await makeCloudBackend(firebaseConfig) : makeLocalBackend();
  await backend.init();
  return backend;
}
export const storage = new Proxy({}, { get: (_, k) => backend[k] });

// 備份格式（兩種做法共用）
export async function exportAll() {
  return { version: 2, exportedAt: new Date().toISOString(), settings: backend.getSettings(), entries: await backend.allEntries() };
}
export async function importAll(data) {
  if (!data || !Array.isArray(data.entries)) throw new Error('備份檔格式不對');
  const existing = new Set((await backend.allEntries()).map(e => e.id));
  let n = 0;
  for (const e of data.entries) {
    if (existing.has(e.id)) continue;
    // 用原本的 id 與時間，不要重新產生，否則兩台裝置各匯入一次會重複
    await backend.put(e);
    n++;
  }
  if (data.settings) await backend.saveSettings(data.settings);
  return n;
}
