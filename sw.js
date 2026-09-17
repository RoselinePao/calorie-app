// sw.js v5 ── service worker（守門員）。第一次開啟時把檔案存進手機，之後離線也能用。
// 每次改程式要把 VERSION 改一個新字串，手機才會換新版。
const VERSION = 'v9.5-confirm-2026-09-17';
const FILES = [
  './', './index.html', './css/style.css',
  './js/app.js', './js/storage.js', './js/foods.js', './js/firebase-config.js',
  './data/foods.json', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './assets/pig-hero.png', './assets/pig-empty.png', './assets/pig-fab.png', './assets/pig-king.png',
];
const RUNTIME = VERSION + '-runtime';   // Firebase 程式庫等外部檔：第一次抓到就存起來

self.addEventListener('install', e => {
  // v9.3：加 cache:'reload'，強迫每個檔都跟伺服器重拿最新的，
  // 不然瀏覽器會拿自己 HTTP 快取裡的舊檔塞進新版快取，換了版還是舊畫面。
  const fresh = FILES.map(u => new Request(u, { cache: 'reload' }));
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== RUNTIME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// v9.3：畫面可以問「你現在是哪一版」，抽屜裡就能顯示版本號
self.addEventListener('message', e => {
  if (e.data === 'version' && e.ports[0]) e.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Firebase 的資料連線（firestore / identitytoolkit）不要攔，交給 SDK 自己處理離線
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('firebaseio.com')) return;

  // 外部程式庫（www.gstatic.com）：有存就用存的，沒存就抓回來順手存下
  if (url.hostname === 'www.gstatic.com') {
    e.respondWith(caches.open(RUNTIME).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // 自己的檔案：先給快取，沒有再上網抓
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
