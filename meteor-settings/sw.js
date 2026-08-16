/*
 * sw.js — Service Worker（キャッシュとオフライン動作）
 *
 * 【位置づけ】オフラインで動くことは**要件ではなく「あわよくば動けばよい」程度**
 * （ユーザーの言葉で "圏外でも動くぐらいの仕様にしない程度"）。
 * PWA 化に伴って付いてきた実装上の選択にすぎない。
 *   - 動かなくなっていたら直すが、それは仕様違反ではない
 *   - **これを守るために機能を制限しない**（「オフラインで動かないから却下」はしない）
 *   - 通信を使う機能は「取れたときだけ表示する」作りにすればよい
 *
 * 【必ず守ること】VERSION は data.js の appVersion と index.html の
 * <meta name="app-version"> ・ scriptタグの ?v= と揃える。
 * ずれていると selftest.js が落ちる（node meteor-settings/selftest.js）。
 *
 * 【設計の理由】以前は index.html もキャッシュ優先で返していたため、
 * 更新のタイミングで「古い index.html ＋ 新しい app.js」の組み合わせで
 * 起動してしまい、新しい JS が古い HTML に無い要素を触って例外になり、
 * 画面が真っ白になる事故が起きた（iPhone・Android の両方で発生）。
 * そのため:
 *   1. HTML（ナビゲーション）はネットワーク優先。オフラインのときだけキャッシュを使う
 *   2. JS・CSS は URL に ?v=バージョン を付け、HTML と同じ版だけを読む
 *   3. activate で clients.claim() を呼ばない（開いているページを途中で乗っ取らない）
 */
const VERSION = '1.10.0';
const CACHE = 'meteor-settings-v' + VERSION;
const V = '?v=' + VERSION;

/* HTML はネットワーク優先だが、オフライン用に控えを持つ */
const HTML = ['./', './index.html'];

/* 版を固定して読むもの（index.html の ?v= と同じ URL でなければキャッシュに当たらない） */
const VERSIONED = [
  './style.css',
  './data.js',
  './astro.js',
  './engine.js',
  './stars.js',
  './lightpollution.js',
  './app.js',
  '../shared/css/variables.css',
  '../shared/css/reset.css',
  '../shared/css/components.css',
].map((p) => p + V);

const STATIC = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

/* 光害地図タイル（日本周辺・約0.8MB）。同梱している理由は他サイトへのホットリンクを避けるため
   （オフライン動作は結果として付いてくるだけで、同梱の理由ではない） */
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

const ASSETS = HTML.concat(VERSIONED, STATIC, LP_TILES);

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => { /* 一部が失敗しても install は続行する */ })
  );
});

/* 引っぱって更新から待機中の版をすぐ有効にする要求を受ける */
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  /* 古いキャッシュを片付ける。clients.claim() は呼ばない
     （開いているページを途中で新しい版に乗り換えさせると、
       そのページの HTML と読み込む JS の版が食い違う） */
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.indexOf('meteor-settings-') === 0 && k !== CACHE)
        .map((k) => caches.delete(k))
    ))
  );
});

/** ページそのものの読み込みか（HTML を取りに来たか） */
function isNavigation(request) {
  if (request.mode === 'navigate') return true;
  // mode を見られない環境向けの保険
  const url = new URL(request.url);
  return request.destination === 'document' ||
    url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  /* HTML はネットワーク優先。古い HTML が残ると JS と版が食い違って起動できなくなる */
  if (isNavigation(e.request)) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', clone));
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./')))
    );
    return;
  }

  /* それ以外はキャッシュ優先＋バックグラウンド更新 */
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
