// sw.js ── service worker（守門員）。第一次開啟時把檔案存進手機，之後離線也能用。
// 每次改程式要把 VERSION 改一個新字串，手機才會換新版。
const VERSION = 'v3.0-pig-2026-09-14';
const FILES = [
  './', './index.html', './css/style.css',
  './js/app.js', './js/storage.js', './js/foods.js',
  './data/foods.json', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './assets/pig-hero.png', './assets/pig-empty.png',
];

// 安裝：把清單裡的檔案全部下載存進快取
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

// 啟用：把舊版本的快取清掉
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 攔截每次請求：先給快取，沒有再上網抓
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
