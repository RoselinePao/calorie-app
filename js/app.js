// app.js v3 ── 畫面與流程。負責「使用者按了什麼 → 呼叫哪一層 → 更新畫面」。
// 不直接碰 localStorage 或 Firebase，一律透過 storage.js 與 foods.js。
// v3 新增：最近吃過 / 常吃 快速鍵、我的食物、找不到回報。

import { initStorage, storage, exportAll, importAll } from './storage.js';
import { loadFoods, searchFoods, getFood } from './foods.js';

// ---------- 小工具 ----------
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const toKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const round = n => Math.round(n);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let currentDate = new Date();
let picked = null;
let multiplier = 1;
let entries = [];            // 目前顯示這一天的紀錄
let myFoods = [];            // 使用者自己存的食物
let unsubDay = null, unsubSettings = null, unsubMyFoods = null, unsubWeight = null;
let weight = null;           // 目前這一天的體重紀錄 { date, kg, ts } 或 null
let user = null;

function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2200);
}

// ---------- 訂閱某一天 ----------
function watchDay() {
  if (unsubDay) unsubDay();
  unsubDay = storage.subscribeDay(toKey(currentDate), list => { entries = list; render(); });
  if (unsubWeight) unsubWeight();
  unsubWeight = storage.subscribeWeight(toKey(currentDate), w => { weight = w; renderWeight(); });
}

// ---------- 體重卡 ----------
const fmtKg = n => Number(n).toFixed(2);
const prevWeightCache = new Map();   // 日期 → 上一次體重，避免每次重畫都去雲端查
async function renderWeight() {
  const key = toKey(currentDate);
  $('weightVal').textContent = weight ? fmtKg(weight.kg) : '--';
  $('weightBtn').textContent = weight ? '修改' : '記錄體重';
  const diffEl = $('weightDiff');
  try {
    let prev = prevWeightCache.get(key);
    if (prev === undefined) {
      if (!diffEl.textContent.trim()) diffEl.textContent = ' ';   // 佔位，高度不變
      prev = await storage.latestWeightBefore(key); prevWeightCache.set(key, prev);
    }
    if (key !== toKey(currentDate)) return;          // 使用者已經滑到別天，這次結果作廢
    if (weight && prev) {
      const d = weight.kg - prev.kg;
      diffEl.textContent = d === 0 ? `跟 ${prev.date} 一樣` : `比 ${prev.date} ${d > 0 ? '+' : '−'}${fmtKg(Math.abs(d))} kg`;
    } else if (!weight && prev) {
      diffEl.textContent = `上次 ${prev.date}：${fmtKg(prev.kg)} kg`;
    } else if (!weight) {
      diffEl.textContent = '今天還沒量';
    }
  } catch (e) { console.warn(e); }
}
const weightSheet = $('weightSheet');
function openWeightSheet() {
  weightSheet.hidden = false;
  $('weightSheetDate').textContent = toKey(currentDate);
  $('weightInput').value = weight ? fmtKg(weight.kg) : '';
  $('weightDelete').hidden = !weight;
  setTimeout(() => $('weightInput').focus(), 50);
}
function closeWeightSheet() { weightSheet.hidden = true; }
$('weightBtn').onclick = openWeightSheet;
weightSheet.querySelector('[data-close-weight]').onclick = closeWeightSheet;
$('weightSave').onclick = async () => {
  const kg = Number($('weightInput').value);
  if (!(kg >= 20 && kg <= 300)) { toast('請輸入 20 到 300 之間的公斤數'); return; }
  prevWeightCache.clear();
  await storage.saveWeight(toKey(currentDate), Math.round(kg * 100) / 100);   // 只留兩位小數
  closeWeightSheet(); toast(`已記錄 ${fmtKg(kg)} kg`);
};
$('weightDelete').onclick = async () => { prevWeightCache.clear(); await storage.removeWeight(toKey(currentDate)); closeWeightSheet(); toast('已刪除今天的體重'); };
$('weightInput').onkeydown = e => { if (e.key === 'Enter') $('weightSave').click(); };

// ---------- 月曆：點日期打開，點一天看預覽，再前往 ----------
const calSheet = $('calSheet');
let calYear = 0, calMonth = 0, calSelected = '', calData = {};
const ymKey = (y, m) => `${y}-${pad(m + 1)}`;
async function openCal() {
  calYear = currentDate.getFullYear(); calMonth = currentDate.getMonth(); calSelected = toKey(currentDate);
  calSheet.hidden = false;
  await loadCal();
}
function closeCal() { calSheet.hidden = true; }
async function loadCal() {
  $('calTitle').textContent = `${calYear} 年 ${calMonth + 1} 月`;
  drawCal();                                          // 先畫格子（沒有小點），資料回來再畫一次
  try { calData = await storage.monthSummary(ymKey(calYear, calMonth)); } catch (e) { console.warn(e); calData = {}; }
  drawCal(); drawPeek();
}
function drawCal() {
  const grid = $('calGrid'); grid.innerHTML = '';
  for (const d of ['日', '一', '二', '三', '四', '五', '六']) { const el = document.createElement('div'); el.className = 'dow'; el.textContent = d; grid.appendChild(el); }
  const first = new Date(calYear, calMonth, 1).getDay();
  const days = new Date(calYear, calMonth + 1, 0).getDate();
  const todayKey = toKey(new Date());
  for (let i = 0; i < first; i++) { const b = document.createElement('div'); b.className = 'day blank'; grid.appendChild(b); }
  for (let d = 1; d <= days; d++) {
    const key = `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
    const b = document.createElement('button'); b.className = 'day'; b.textContent = d;
    if (key === todayKey) b.classList.add('today');
    if (key === calSelected) b.classList.add('sel');
    if (key > todayKey) b.classList.add('future');
    if (calData[key]) b.insertAdjacentHTML('beforeend', '<i></i>');
    b.onclick = () => { calSelected = key; drawCal(); drawPeek(); };
    grid.appendChild(b);
  }
}
function drawPeek() {
  const d = calData[calSelected];
  { const [y, m, d] = calSelected.split('-').map(Number); $('peekDate').textContent = `${y} 年 ${m} 月 ${d} 日`; }
  $('peekKcal').textContent = d && d.count ? `${round(d.kcal)} kcal ・ ${d.count} 筆` : '沒有紀錄';
  $('peekKg').textContent = d && d.kg != null ? `${fmtKg(d.kg)} kg` : '沒量';
}
$('dateLabel').onclick = openCal;
calSheet.querySelector('[data-close-cal]').onclick = closeCal;
$('calClose').onclick = closeCal;
$('calPrev').onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } loadCal(); };
$('calNext').onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } loadCal(); };
$('calToday').onclick = () => { currentDate = new Date(); watchDay(); closeCal(); };
$('calGo').onclick = () => { const [y, m, d] = calSelected.split('-').map(Number); currentDate = new Date(y, m - 1, d); watchDay(); closeCal(); };

// ---------- 側邊選單（漢堡） ----------
const drawer = $('drawer');
$('menuBtn').onclick = () => { drawer.hidden = false; };
$('drawerClose').onclick = () => { drawer.hidden = true; };
drawer.querySelector('[data-close-drawer]').onclick = () => { drawer.hidden = true; };

// ---------- 畫面更新 ----------
function render() {
  const key = toKey(currentDate);
  const isToday = key === toKey(new Date());
  $('dateLabel').textContent = isToday ? `今天 ${key}` : key;
  $('todayBtn').hidden = isToday;

  const goal = storage.getSettings().goalKcal;
  const sum = entries.reduce((acc, e) => {
    acc.kcal += e.kcal || 0; acc.p += e.protein_g || 0; acc.c += e.carb_g || 0; acc.f += e.fat_g || 0; return acc;
  }, { kcal: 0, p: 0, c: 0, f: 0 });

  $('totalKcal').textContent = round(sum.kcal);
  $('goalKcal').textContent = goal;
  $('mProtein').textContent = round(sum.p);
  $('mCarb').textContent = round(sum.c);
  $('mFat').textContent = round(sum.f);
  $('barFill').style.width = Math.min(100, (sum.kcal / goal) * 100) + '%';
  $('barFill').classList.toggle('over', sum.kcal > goal);
  const remain = goal - sum.kcal;
  const ratio = sum.kcal / goal;
  const crowned = ratio >= 0.8 && ratio <= 1.0;          // 達標區間：80% 到 100%
  $('remainLabel').textContent = crowned ? '今天剛剛好，榮獲小豬國王嘉勉！'
    : remain >= 0 ? `還可以吃 ${round(remain)} kcal` : `超過目標 ${round(-remain)} kcal`;
  $('remainLabel').classList.toggle('crowned', crowned);
  const king = $('kingImg'); if (king) king.hidden = !crowned;

  const list = $('entryList');
  list.innerHTML = '';
  $('emptyHint').hidden = entries.length > 0;
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = 'entry';
    li.innerHTML = `
      <div class="entry-main">
        <div class="entry-name">${esc(e.name)}</div>
        <div class="entry-sub">${esc(e.portionLabel || '')}</div>
      </div>
      <div class="entry-kcal">${round(e.kcal)} kcal</div>
      <button class="del" aria-label="刪除">✕</button>`;
    li.querySelector('.del').onclick = async () => { await storage.remove(e.id); toast('已刪除'); };
    list.appendChild(li);
  }
}

// ---------- 日期切換 ----------
// v9.3：只有「吃了什麼」那張卡會滑進來，上面的熱量卡、體重卡與背景原地不動。
function shiftDay(n) {
  const card = $('mealsCard');
  card.classList.remove('slide-left', 'slide-right');
  requestAnimationFrame(() => {
    card.classList.add(n > 0 ? 'slide-left' : 'slide-right');   // 這一幀先開始動畫
    requestAnimationFrame(() => {                               // 下一幀再換資料，避免和動畫搶同一幀
      currentDate.setDate(currentDate.getDate() + n);
      watchDay();
    });
  });
}
$('prevDay').onclick = () => shiftDay(-1);
$('nextDay').onclick = () => shiftDay(1);
$('todayBtn').onclick = () => { currentDate = new Date(); watchDay(); };

// ---------- 左右滑動切換日期 ----------
// 手指在主畫面水平滑超過 60px、垂直位移小於 50px 就換日：往左滑看後一天，往右滑看前一天
let touchX = null, touchY = null;
document.addEventListener('touchstart', e => {
  if (!sheet.hidden || !drawer.hidden || !weightSheet.hidden || !calSheet.hidden) return;   // 任何面板開著時不切日期
  touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', e => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  touchX = touchY = null;
  if (Math.abs(dx) < 60 || Math.abs(dy) > 50) return;
  shiftDay(dx < 0 ? 1 : -1);      // 動畫已經包在 shiftDay 裡
}, { passive: true });

// ---------- 擋掉放大 ----------
// iOS Safari 從 iOS 10 起故意忽略 viewport 的 user-scalable=no，CSS 的 touch-action 也擋不乾淨，
// 所以這裡直接攔手勢事件：雙指縮放（gesture*）與雙擊放大（兩次 touchend 很近又很快）。
['gesturestart', 'gesturechange', 'gestureend'].forEach(t =>
  document.addEventListener(t, e => e.preventDefault(), { passive: false })
);
let lastTapT = 0, lastTapX = 0, lastTapY = 0;
document.addEventListener('touchend', e => {
  const t = e.changedTouches[0];
  const now = Date.now();
  const near = Math.abs(t.clientX - lastTapX) < 40 && Math.abs(t.clientY - lastTapY) < 40;
  // 按鈕、輸入框不擋：連按兩下 ‹ 想連退兩天是正常操作，擋掉第二下反而變成按不動。
  // 這些控制項本來也不會觸發雙擊放大，會放大的是中間那片文字與圖。
  const isControl = e.target.closest && e.target.closest('button, input, label, a, select, textarea');
  if (!isControl && now - lastTapT < 350 && near) e.preventDefault();   // 第二下不放行，就不會放大
  lastTapT = now; lastTapX = t.clientX; lastTapY = t.clientY;
}, { passive: false });

// ---------- 目標熱量 ----------
$('goalBtn').onclick = async () => {
  const v = prompt('每日目標熱量（kcal）', storage.getSettings().goalKcal);
  const n = Number(v);
  if (v !== null && n > 0) { await storage.saveSettings({ goalKcal: n }); render(); }
};

// ---------- 從一筆紀錄還原出「一份是多少」的食物，給快速鍵用 ----------
function foodFromEntry(e) {
  if (e.foodId) {
    const f = getFood(e.foodId) || myFoods.find(m => m.id === e.foodId);
    if (f) return f;
  }
  // 舊紀錄或自訂：用紀錄裡存的單位值；再舊的沒有單位值就把整筆當一份
  return { id: e.foodId || null, name: e.name, unit_desc: e.unitDesc || '1 份',
    kcal: e.unitKcal ?? e.kcal, protein_g: e.unitProtein ?? null, carb_g: e.unitCarb ?? null, fat_g: e.unitFat ?? null, brand: null };
}

// ---------- 快速鍵：最近吃過、常吃 ----------
async function renderQuick() {
  const box = $('quick');
  box.innerHTML = '';
  let all = [];
  try { all = await storage.allEntries(); } catch { return; }
  if (!all.length) return;
  const since = Date.now() - 60 * 86400000;           // 只看最近 60 天
  const recentList = all.filter(e => e.ts > since).sort((a, b) => b.ts - a.ts);
  const seen = new Set(), recent = [], count = new Map();
  for (const e of recentList) {
    const k = e.foodId || e.name;
    count.set(k, (count.get(k) || 0) + 1);
    if (!seen.has(k) && recent.length < 8) { seen.add(k); recent.push(e); }
  }
  const frequent = [...seen].map(k => recentList.find(e => (e.foodId || e.name) === k))
    .sort((a, b) => count.get(b.foodId || b.name) - count.get(a.foodId || a.name)).slice(0, 8);

  const section = (title, items) => {
    if (!items.length) return;
    const h = document.createElement('div'); h.className = 'quick-title'; h.textContent = title; box.appendChild(h);
    const row = document.createElement('div'); row.className = 'chips';
    for (const e of items) {
      const f = foodFromEntry(e);
      const b = document.createElement('button'); b.className = 'chip';
      b.innerHTML = `${esc(f.name)} <span class="chip-kcal">${round(f.kcal)}</span>`;
      b.onclick = () => pickFood(f);
      row.appendChild(b);
    }
    box.appendChild(row);
  };
  section('最近吃過', recent);
  section('常吃', frequent);
}

// ---------- 新增面板 ----------
const sheet = $('sheet');
function openSheet() {
  sheet.hidden = false; showStep('stepSearch');
  $('searchInput').value = ''; $('results').innerHTML = ''; $('noResult').hidden = true;
  $('quick').hidden = false; renderQuick();
  setTimeout(() => $('searchInput').focus(), 50);
}
function closeSheet() { sheet.hidden = true; picked = null; }
function showStep(id) { for (const s of ['stepSearch', 'stepPortion', 'stepCustom']) $(s).hidden = s !== id; }
$('addBtn').onclick = openSheet;
sheet.querySelector('[data-close]').onclick = closeSheet;

$('searchInput').oninput = e => {
  const q = e.target.value.trim();
  const ul = $('results'); ul.innerHTML = '';
  $('quick').hidden = q.length > 0;               // 一開始打字就收起快速鍵
  const hits = q ? searchFoods(q, 30, myFoods) : [];
  $('noResult').hidden = !(q.length >= 2 && hits.length === 0);
  $('reportText').textContent = q;
  for (const f of hits) {
    const li = document.createElement('li');
    li.className = 'result';
    li.innerHTML = `
      <div>
        <div class="result-name">${esc(f.name)}</div>
        <div class="result-sub">${f.brand ? esc(f.brand) + ' ・ ' : ''}${esc(f.unit_desc)}</div>
      </div>
      <div class="result-kcal">${round(f.kcal)} kcal</div>`;
    li.onclick = () => pickFood(f);
    ul.appendChild(li);
  }
};

// 找不到 → 回報，並直接跳到自訂輸入
$('reportBtn').onclick = async () => {
  const q = $('searchInput').value.trim();
  try { await storage.reportMissing(q); toast('已回報，謝謝！先用自訂輸入吧'); }
  catch (err) { console.warn(err); toast('回報沒送出，先用自訂輸入'); }
  openCustom(q);
};

function pickFood(f) {
  picked = f; setMultiplier(1);
  $('pickName').textContent = f.name;
  $('pickUnit').textContent = `每 ${f.unit_desc} 約 ${round(f.kcal)} kcal${f.brand ? ' ・ ' + f.brand : ''}`;
  showStep('stepPortion');
}
function setMultiplier(m) {
  multiplier = m; $('customMult').value = m;
  document.querySelectorAll('.portion').forEach(b => b.classList.toggle('active', Number(b.dataset.m) === m));
  $('pickKcal').textContent = round(picked.kcal * m);
}
document.querySelectorAll('.portion').forEach(b => (b.onclick = () => setMultiplier(Number(b.dataset.m))));
$('customMult').oninput = e => { const m = Number(e.target.value); if (m > 0) setMultiplier(m); };
$('backBtn').onclick = () => showStep('stepSearch');

// 確認加入：除了算好的總量，也把「一份是多少」存進紀錄，快速鍵才能還原
async function addEntryFromFood(f, m) {
  const scale = v => (v == null ? null : v * m);
  await storage.add({
    date: toKey(currentDate), foodId: f.id, name: f.name,
    portionLabel: `${m} × ${f.unit_desc}`, kcal: f.kcal * m,
    protein_g: scale(f.protein_g), carb_g: scale(f.carb_g), fat_g: scale(f.fat_g),
    unitDesc: f.unit_desc, unitKcal: f.kcal, unitProtein: f.protein_g ?? null, unitCarb: f.carb_g ?? null, unitFat: f.fat_g ?? null,
  });
}
$('confirmBtn').onclick = async () => {
  if (!picked) return;
  const name = picked.name;
  await addEntryFromFood(picked, multiplier);
  closeSheet(); toast(`已加入 ${name}`);
};

// 自訂食物：可選擇存進「我的食物」，下次搜得到
function openCustom(prefill = '') {
  showStep('stepCustom');
  $('customName').value = prefill; $('customKcal').value = ''; $('saveMine').checked = true;
  (prefill ? $('customKcal') : $('customName')).focus();
}
$('customBtn').onclick = () => openCustom('');
$('customBack').onclick = () => showStep('stepSearch');
$('customConfirm').onclick = async () => {
  const name = $('customName').value.trim();
  const kcal = Number($('customKcal').value);
  if (!name || !(kcal >= 0)) { toast('請填名稱和熱量'); return; }
  let f = { id: null, name, unit_desc: '1 份', kcal, protein_g: null, carb_g: null, fat_g: null };
  if ($('saveMine').checked) f = await storage.addMyFood(f);
  await addEntryFromFood(f, 1);
  closeSheet(); toast(`已加入 ${name}`);
};

// ---------- 備份 ----------
$('exportBtn').onclick = async () => {
  const blob = new Blob([JSON.stringify(await exportAll(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `豬豬卡路里備份_${toKey(new Date())}.json`; a.click();
  URL.revokeObjectURL(a.href);
};
$('importFile').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try { const n = await importAll(JSON.parse(await file.text())); toast(`已匯入 ${n} 筆新紀錄`); }
  catch (err) { toast('匯入失敗：' + err.message); }
  e.target.value = '';
};

// ---------- 帳號 ----------
const AUTH_MSG = {
  'auth/invalid-email': 'Email 格式不對', 'auth/user-not-found': '沒有這個帳號，請先註冊',
  'auth/wrong-password': '密碼錯誤', 'auth/invalid-credential': 'Email 或密碼錯誤',
  'auth/email-already-in-use': '這個 Email 已註冊過，請直接登入', 'auth/weak-password': '密碼至少 6 個字',
  'auth/network-request-failed': '沒有網路', 'auth/too-many-requests': '嘗試太多次，請稍後再試',
};
const authErr = e => AUTH_MSG[e.code] || e.message;
function authForm() { return [$('authEmail').value.trim(), $('authPassword').value]; }
$('signInBtn').onclick = async () => { try { await storage.signIn(...authForm()); } catch (e) { toast(authErr(e)); } };
$('signUpBtn').onclick = async () => { try { await storage.signUp(...authForm()); toast('註冊成功，已登入'); } catch (e) { toast(authErr(e)); } };
$('resetBtn').onclick = async () => {
  const [email] = authForm(); if (!email) { toast('請先填 Email'); return; }
  try { await storage.resetPassword(email); toast('重設密碼的信已寄出'); } catch (e) { toast(authErr(e)); }
};
$('signOutBtn').onclick = async () => { await storage.signOut(); toast('已登出'); };

function applyAuth(u) {
  user = u;
  const cloud = storage.mode === 'cloud';
  $('authCard').hidden = !cloud || !!u;
  $('appMain').hidden = cloud && !u;
  $('addBtn').hidden = cloud && !u;
  $('menuBtn').hidden = false;                      // 選單在登入前也可用（備份匯入、資料庫筆數）
  $('accountRow').hidden = !cloud || !u;
  if (u && !u.local) $('accountEmail').textContent = u.email;
  $('syncInfo').textContent = cloud ? '雲端同步：開啟' : '目前為本機模式，紀錄只存在這台裝置';
  if (!cloud || u) {
    // 登入後才掛訂閱：目標熱量、我的食物一有變化（含別台裝置改的）就更新
    if (unsubSettings) unsubSettings();
    unsubSettings = storage.onSettings(() => render());
    if (unsubMyFoods) unsubMyFoods();
    unsubMyFoods = storage.onMyFoods(list => { myFoods = list; });
    watchDay();
  }
}

// ---------- 啟動 ----------
async function boot() {
  try { await initStorage(); }
  catch (e) { console.error(e); $('syncInfo').textContent = '雲端連線失敗，請檢查網路後重新開啟'; }
  render();                      // 登入前先畫一次，日期標題才正確
  storage.onAuth(applyAuth);
  try { const n = await loadFoods(); $('dbInfo').textContent = `食物資料庫：${n} 筆`; }
  catch { $('dbInfo').textContent = '食物資料庫載入失敗，仍可自訂輸入'; }
  setupSW();
}
boot();

// ---------- 新版偵測（v9.3）----------
// 瀏覽器每次開網址都會重新導航，順手就檢查了新版；但桌面上的 PWA 是「叫回前景」，
// 不算導航，所以永遠不會自己去看有沒有新版 —— 這就是 PWA 一直卡舊版的原因。
// 這裡改成：主動問、問到就換、換好自動重載一次。
let swReg = null;
let reloading = false;
let pendingReload = false;
const hadController = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;

// 換新版要重載畫面，但不能把正在打字的人打斷：面板開著就先記著，等面板關了或下次回到前景再換。
function reloadForNewVersion() {
  if (reloading) return;
  if (!sheet.hidden || !weightSheet.hidden || !calSheet.hidden) { pendingReload = true; return; }
  reloading = true;
  location.reload();
}

async function setupSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // updateViaCache:'none'：連 sw.js 自己都不准吃瀏覽器的 HTTP 快取，每次都真的問伺服器
    swReg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  } catch { return; }

  showVersion();

  // 新版守門員接手畫面時重載一次，畫面才會真的換成新的 HTML/JS。
  // hadController 是為了避開「第一次安裝」那一次，不然初次進站會白白重載。
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    reloadForNewVersion();
  });

  checkUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (pendingReload) { reloadForNewVersion(); return; }   // 上次沒換成，這次補換
    checkUpdate();                                          // iPhone 的 PWA 靠這行才會發現新版
  });
  window.addEventListener('pageshow', () => checkUpdate());
}

function checkUpdate() { if (swReg) swReg.update().catch(() => {}); }

// 抽屜裡顯示目前實際跑的版本，Roseline 一看就知道 PWA 換過來了沒有
function showVersion() {
  const el = $('verInfo');
  const sw = navigator.serviceWorker.controller;
  if (!el) return;
  if (!sw) { el.textContent = '版本：安裝中，關掉重開就會生效'; return; }
  const ch = new MessageChannel();
  ch.port1.onmessage = ev => { el.textContent = '版本 ' + ev.data; };
  sw.postMessage('version', [ch.port2]);
}

$('updateBtn').onclick = async () => {
  if (!swReg) { toast('這個瀏覽器不支援自動更新'); return; }
  toast('檢查中…');
  try {
    await swReg.update();
    if (swReg.installing || swReg.waiting) toast('有新版，正在換，馬上重開');
    else toast('已經是最新版');
  } catch { toast('檢查失敗，請確認網路'); }
};
