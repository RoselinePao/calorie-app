// foods.js v2 ── 食物資料庫層：載入 foods.json 並提供搜尋。
// v2：搜尋時可以把「我的食物」一起納入，且排在前面。

let foods = [];

export async function loadFoods() {
  const res = await fetch('./data/foods.json');
  foods = await res.json();
  return foods.length;
}

const norm = s => (s || '').toLowerCase().replace(/\s+/g, '');

// 對一份清單打分：名稱開頭命中 3 分、別名或品牌開頭 2 分、包含 1 分
function scoreList(list, q, bonus = 0) {
  const out = [];
  for (const f of list) {
    const name = norm(f.name);
    const hay = [name, norm(f.brand), ...(f.aliases || []).map(norm)];
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (hay.some(h => h.startsWith(q))) score = 2;
    else if (hay.some(h => h.includes(q))) score = 1;
    if (score) out.push({ f, score: score + bonus });
  }
  return out;
}

// 搜尋：extra 是使用者自己的食物，命中時多加 5 分，永遠排在資料庫之前
export function searchFoods(query, limit = 30, extra = []) {
  const q = norm(query);
  if (!q) return [];
  const scored = [...scoreList(extra, q, 5), ...scoreList(foods, q)];
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.f);
}

export function getFood(id) {
  return foods.find(f => f.id === id);
}
