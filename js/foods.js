// foods.js ── 食物資料庫層：負責載入 foods.json 並提供搜尋。
// 資料庫更新只要換 data/foods.json，這裡不用改。

let foods = [];

export async function loadFoods() {
  const res = await fetch('./data/foods.json');
  foods = await res.json();
  return foods.length;
}

// 把字串標準化：去空白、轉小寫，讓「珍奶」「珍 奶」都搜得到
const norm = s => (s || '').toLowerCase().replace(/\s+/g, '');

// 搜尋：名稱、別名、品牌都比對；名稱開頭命中的排前面
export function searchFoods(query, limit = 30) {
  const q = norm(query);
  if (!q) return [];
  const scored = [];
  for (const f of foods) {
    const name = norm(f.name);
    const hay = [name, norm(f.brand), ...(f.aliases || []).map(norm)];
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (hay.some(h => h.startsWith(q))) score = 2;
    else if (hay.some(h => h.includes(q))) score = 1;
    if (score) scored.push({ f, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.f);
}

export function getFood(id) {
  return foods.find(f => f.id === id);
}
