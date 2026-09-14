// app.js ── 畫面與流程。負責「使用者按了什麼 → 呼叫哪一層 → 更新畫面」。
// 不直接碰 localStorage，也不直接讀 foods.json，一律透過 storage.js 與 foods.js。

import { storage } from './storage.js';
import { loadFoods, searchFoods } from './foods.js';

// ---------- 小工具 ----------
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const toKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // 日期 → 'YYYY-MM-DD'
const round = n => Math.round(n);

let currentDate = new Date();   // 目前畫面顯示的日期
let picked = null;              // 使用者在面板裡選到的食物
let multiplier = 1;             // 份量倍數

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 1800);
}

// ---------- 畫面更新：把某一天的紀錄畫出來 ----------
function render() {
  const key = toKey(currentDate);
  const isToday = key === toKey(new Date());
  $('dateLabel').textContent = isToday ? `今天 ${key}` : key;
  $('todayBtn').hidden = isToday;

  const entries = storage.listByDate(key);
  const goal = storage.getSettings().goalKcal;

  // 1. 加總
  const sum = entries.reduce((acc, e) => {
    acc.kcal += e.kcal || 0;
    acc.p += e.protein_g || 0;
    acc.c += e.carb_g || 0;
    acc.f += e.fat_g || 0;
    return acc;
  }, { kcal: 0, p: 0, c: 0, f: 0 });

  // 2. 摘要卡
  $('totalKcal').textContent = round(sum.kcal);
  $('goalKcal').textContent = goal;
  $('mProtein').textContent = round(sum.p);
  $('mCarb').textContent = round(sum.c);
  $('mFat').textContent = round(sum.f);
  const pct = Math.min(100, (sum.kcal / goal) * 100);
  $('barFill').style.width = pct + '%';
  $('barFill').classList.toggle('over', sum.kcal > goal);
  const remain = goal - sum.kcal;
  $('remainLabel').textContent = remain >= 0
    ? `還可以吃 ${round(remain)} kcal`
    : `超過目標 ${round(-remain)} kcal`;

  // 3. 清單
  const list = $('entryList');
  list.innerHTML = '';
  $('emptyHint').hidden = entries.length > 0;
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = 'entry';
    li.innerHTML = `
      <div class="entry-main">
        <div class="entry-name">${e.name}</div>
        <div class="entry-sub">${e.portionLabel || ''}</div>
      </div>
      <div class="entry-kcal">${round(e.kcal)} kcal</div>
      <button class="del" aria-label="刪除">✕</button>`;
    li.querySelector('.del').onclick = () => {
      storage.remove(e.id);
      render();
      toast('已刪除');
    };
    list.appendChild(li);
  }
}

// ---------- 日期切換 ----------
function shiftDay(n) {
  currentDate.setDate(currentDate.getDate() + n);
  render();
}
$('prevDay').onclick = () => shiftDay(-1);
$('nextDay').onclick = () => shiftDay(1);
$('todayBtn').onclick = () => { currentDate = new Date(); render(); };

// ---------- 目標熱量 ----------
$('goalBtn').onclick = () => {
  const v = prompt('每日目標熱量（kcal）', storage.getSettings().goalKcal);
  const n = Number(v);
  if (v !== null && n > 0) { storage.saveSettings({ goalKcal: n }); render(); }
};

// ---------- 新增面板 ----------
const sheet = $('sheet');
function openSheet() {
  sheet.hidden = false;
  showStep('stepSearch');
  $('searchInput').value = '';
  $('results').innerHTML = '';
  setTimeout(() => $('searchInput').focus(), 50);
}
function closeSheet() { sheet.hidden = true; picked = null; }
function showStep(id) {
  for (const s of ['stepSearch', 'stepPortion', 'stepCustom']) $(s).hidden = s !== id;
}
$('addBtn').onclick = openSheet;
sheet.querySelector('[data-close]').onclick = closeSheet;

// 搜尋：每打一個字就重新找
$('searchInput').oninput = e => {
  const hits = searchFoods(e.target.value);
  const ul = $('results');
  ul.innerHTML = '';
  for (const f of hits) {
    const li = document.createElement('li');
    li.className = 'result';
    li.innerHTML = `
      <div>
        <div class="result-name">${f.name}</div>
        <div class="result-sub">${f.brand ? f.brand + ' ・ ' : ''}${f.unit_desc}</div>
      </div>
      <div class="result-kcal">${round(f.kcal)} kcal</div>`;
    li.onclick = () => pickFood(f);
    ul.appendChild(li);
  }
};

// 選到食物 → 進入份量步驟
function pickFood(f) {
  picked = f;
  setMultiplier(1);
  $('pickName').textContent = f.name;
  $('pickUnit').textContent = `每 ${f.unit_desc} 約 ${round(f.kcal)} kcal${f.brand ? ' ・ ' + f.brand : ''}`;
  showStep('stepPortion');
}
function setMultiplier(m) {
  multiplier = m;
  $('customMult').value = m;
  document.querySelectorAll('.portion').forEach(b => b.classList.toggle('active', Number(b.dataset.m) === m));
  $('pickKcal').textContent = round(picked.kcal * m);
}
document.querySelectorAll('.portion').forEach(b => (b.onclick = () => setMultiplier(Number(b.dataset.m))));
$('customMult').oninput = e => { const m = Number(e.target.value); if (m > 0) setMultiplier(m); };
$('backBtn').onclick = () => showStep('stepSearch');

// 確認加入：把「食物 × 倍數」換成一筆紀錄存起來
$('confirmBtn').onclick = () => {
  if (!picked) return;
  const m = multiplier;
  const scale = v => (v == null ? null : v * m);
  storage.add({
    date: toKey(currentDate),
    foodId: picked.id,
    name: picked.name,
    portionLabel: `${m} × ${picked.unit_desc}`,
    kcal: picked.kcal * m,
    protein_g: scale(picked.protein_g),
    carb_g: scale(picked.carb_g),
    fat_g: scale(picked.fat_g),
  });
  const addedName = picked.name;   // 先記住名字，因為 closeSheet 會把 picked 清空
  closeSheet();
  render();
  toast(`已加入 ${addedName}`);
};

// 自訂食物（資料庫沒有時）
$('customBtn').onclick = () => { showStep('stepCustom'); $('customName').value = ''; $('customKcal').value = ''; $('customName').focus(); };
$('customBack').onclick = () => showStep('stepSearch');
$('customConfirm').onclick = () => {
  const name = $('customName').value.trim();
  const kcal = Number($('customKcal').value);
  if (!name || !(kcal >= 0)) { toast('請填名稱和熱量'); return; }
  storage.add({ date: toKey(currentDate), foodId: null, name, portionLabel: '自訂', kcal });
  closeSheet();
  render();
  toast(`已加入 ${name}`);
};

// ---------- 備份 ----------
$('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(storage.exportAll(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `熱量紀錄備份_${toKey(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('importFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const n = storage.importAll(JSON.parse(await file.text()));
    render();
    toast(`已匯入 ${n} 筆新紀錄`);
  } catch (err) {
    toast('匯入失敗：' + err.message);
  }
  e.target.value = '';
};

// ---------- 啟動 ----------
async function boot() {
  render();
  try {
    const n = await loadFoods();
    $('dbInfo').textContent = `食物資料庫：${n} 筆`;
  } catch {
    $('dbInfo').textContent = '食物資料庫載入失敗，仍可自訂輸入';
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
boot();
