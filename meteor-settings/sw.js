/*
 * sw.js — オフラインでも使えるようにするための Service Worker
 * 撮影地は電波が届かないことが多いため、初回アクセス後は完全にオフラインで動く。
 */
const CACHE = 'meteor-settings-v2';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './data.js',
  './astro.js',
  './engine.js',
  './lightpollution.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  '../shared/css/variables.css',
  '../shared/css/reset.css',
  '../shared/css/components.css',
];

/* 光害地図タイル（日本周辺・約0.8MB）。撮影地が圏外でも空の暗さを引けるように同梱する */
const LP_TILES = [
  './lp-tiles/tile_6_53_22.png',
  './lp-tiles/tile_6_53_23.png',
  './lp-tiles/tile_6_53_24.png',
  './lp-tiles/tile_6_53_25.png',
  './lp-tiles/tile_6_53_26.png',
  './lp-tiles/tile_6_53_27.png',
  './lp-tiles/tile_6_53_28.png',
  './lp-tiles/tile_6_54_22.png',
  './lp-tiles/tile_6_54_23.png',
  './lp-tiles/tile_6_54_24.png',
  './lp-tiles/tile_6_54_25.png',
  './lp-tiles/tile_6_54_26.png',
  './lp-tiles/tile_6_54_27.png',
  './lp-tiles/tile_6_55_22.png',
  './lp-tiles/tile_6_55_23.png',
  './lp-tiles/tile_6_55_24.png',
  './lp-tiles/tile_6_55_25.png',
  './lp-tiles/tile_6_55_26.png',
  './lp-tiles/tile_6_55_27.png',
  './lp-tiles/tile_6_56_22.png',
  './lp-tiles/tile_6_56_23.png',
  './lp-tiles/tile_6_56_24.png',
  './lp-tiles/tile_6_56_25.png',
  './lp-tiles/tile_6_57_22.png',
  './lp-tiles/tile_6_57_23.png',
  './lp-tiles/tile_6_57_24.png',
  './lp-tiles/tile_6_57_25.png',
  './lp-tiles/tile_6_57_26.png',
  './lp-tiles/tile_6_57_27.png',
  './lp-tiles/tile_6_58_22.png',
  './lp-tiles/tile_6_58_23.png',
  './lp-tiles/tile_6_59_22.png',
  './lp-tiles/tile_6_59_27.png',
  './lp-tiles/tile_6_59_28.png',
];

ASSETS.push.apply(ASSETS, LP_TILES);

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
