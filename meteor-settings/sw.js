/*
 * sw.js — オフラインでも使えるようにするための Service Worker
 * 撮影地は電波が届かないことが多いため、初回アクセス後は完全にオフラインで動く。
 */
const CACHE = 'meteor-settings-v1';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './data.js',
  './astro.js',
  './engine.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  '../shared/css/variables.css',
  '../shared/css/reset.css',
  '../shared/css/components.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => { /* 一部が失敗しても install は続行する */ })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* キャッシュ優先＋バックグラウンド更新 */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fetching = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => hit);
      return hit || fetching;
    })
  );
});
