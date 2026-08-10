/*
 * lightpollution.js — 地点の夜空の明るさ（天頂の人工光輝度）を光害地図から引く
 *
 * データ出典: David Lorenz「World Atlas of the Artificial Night Sky Brightness」2025年版
 *   https://djlorenz.github.io/astronomy/lp/
 *   元となる夜間光データ: NOAA VIIRS の年平均雲なし夜間光
 *   （Earth Observation Group, Colorado School of Mines）
 *
 * 重要（著者の要請）:
 *   この地図は「天頂（真上）の人工光による輝度」のモデル計算値であり、
 *   Bortle スケールではない。Bortle スケールは地平線から天頂までの全天を目視で評価する
 *   主観的な指標で、天頂輝度とは別物。混同しないこと。
 *
 * 仕組み:
 *   配布タイルは 4bit パレット PNG（16色）で、16色が光害ゾーン
 *   0 / 1a / 1b / 2a / 2b / 3a / 3b / 4a / 4b / 5a / 5b / 6a / 6b / 7a / 7b / 8
 *   に対応する。著者の定義により
 *     - ゾーン番号 +1 = 人工光が3倍
 *     - 同番号の a→b = √3 倍
 *     - ゾーン 3b と 4a の境界で 人工光 = 自然光（LPI = 1）
 *     - 自然光の天頂輝度は 22.0 等/平方秒
 *   したがって色から次式で等級が求まる。
 *     LPI（人工光/自然光）= 3^((index-7)/2) … 帯の下端
 *     SQM = 22.0 - 2.5·log10(1 + LPI)
 *   代表値には帯の対数中央（下端 × 3^0.25）を使う。
 */

const MS_LP = (function () {
  'use strict';

  const ZOOM = 6;                 // 同梱タイルのズーム（元データ1/120度に対し約500m/px で十分）
  const TILE = 1024;              // タイル1枚のピクセル数
  const BASE = 'lp-tiles/';
  const RANGE = { x: [53, 59], y: [22, 28] };   // 同梱している日本周辺の範囲
  const NATURAL_SKY = 22.0;       // 自然の夜空の天頂輝度 [等/平方秒]

  /* パレット（index 0 = 最暗 → 15 = 最明） */
  const PALETTE = [
    [0, 0, 0], [34, 34, 34], [66, 66, 66], [20, 47, 114],
    [33, 84, 216], [15, 87, 20], [31, 161, 42], [110, 100, 30],
    [184, 166, 37], [191, 100, 30], [253, 150, 80], [251, 90, 73],
    [251, 153, 138], [160, 160, 160], [242, 242, 242], [255, 255, 255],
  ];

  const ZONES = ['0', '1a', '1b', '2a', '2b', '3a', '3b', '4a',
    '4b', '5a', '5b', '6a', '6b', '7a', '7b', '8'];

  /** ゾーン index → 人工光の強さ（自然光比）と等級 */
  function zoneValues(index) {
    const lower = Math.pow(3, (index - 7) / 2);      // 帯の下端
    let lpi;
    if (index === 0) lpi = 0.012;                    // ゾーン0は「十分小さい値」
    else if (index === 15) lpi = lower * 1.3;        // 上限が開いた帯
    else lpi = lower * Math.pow(3, 0.25);            // 帯の対数中央
    return {
      lpi: lpi,
      sqm: NATURAL_SKY - 2.5 * Math.log10(1 + lpi),
      zone: ZONES[index],
      index: index,
    };
  }

  /** 帯の境界の等級（UI で「◯◯〜◯◯等」と出すため） */
  function zoneRange(index) {
    const lo = index === 0 ? 0 : Math.pow(3, (index - 7) / 2);
    const hi = Math.pow(3, (index - 6) / 2);
    return {
      dark: NATURAL_SKY - 2.5 * Math.log10(1 + lo),
      bright: NATURAL_SKY - 2.5 * Math.log10(1 + hi),
    };
  }

  /* ---------------- タイルの読み込み ---------------- */
  const tileCache = {};            // "x_y" → {img} / 'missing'
  let canvas = null;
  let ctx = null;

  function getCanvas() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = TILE;
      canvas.height = TILE;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    return ctx;
  }

  function loadTile(x, y) {
    const key = x + '_' + y;
    if (tileCache[key]) return Promise.resolve(tileCache[key]);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { tileCache[key] = img; resolve(img); };
      img.onerror = () => { tileCache[key] = 'missing'; resolve('missing'); };
      img.src = BASE + 'tile_' + ZOOM + '_' + x + '_' + y + '.png';
    });
  }

  /** RGB → パレット index（最も近い色。ブラウザの色変換で微妙にずれても耐える） */
  function nearestIndex(r, g, b) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < PALETTE.length; i++) {
      const p = PALETTE[i];
      const d = (p[0] - r) * (p[0] - r) + (p[1] - g) * (p[1] - g) + (p[2] - b) * (p[2] - b);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** 緯度経度 → タイル座標とタイル内ピクセル（Webメルカトル） */
  function project(lat, lon) {
    const n = Math.pow(2, ZOOM);
    const latRad = lat * Math.PI / 180;
    const xw = (lon + 180) / 360 * n;
    const yw = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
    const tx = Math.floor(xw);
    const ty = Math.floor(yw);
    return {
      tx: tx, ty: ty,
      px: Math.min(TILE - 1, Math.max(0, Math.floor((xw - tx) * TILE))),
      py: Math.min(TILE - 1, Math.max(0, Math.floor((yw - ty) * TILE))),
    };
  }

  /**
   * 指定地点の夜空の明るさを引く
   * @returns Promise<{sqm, zone, index, lpi, range, outside, missing}>
   *   outside: 同梱範囲（日本周辺）の外
   *   missing: タイルが存在しない外洋（著者のビューアと同様に最暗として扱う）
   */
  function lookup(lat, lon) {
    const p = project(lat, lon);
    if (p.tx < RANGE.x[0] || p.tx > RANGE.x[1] || p.ty < RANGE.y[0] || p.ty > RANGE.y[1]) {
      return Promise.resolve({ outside: true });
    }
    return loadTile(p.tx, p.ty).then((img) => {
      if (img === 'missing') {
        // 外洋。著者のビューアも欠損タイルを最暗色で描くため index 0 として扱う
        return Object.assign({ missing: true, range: zoneRange(0) }, zoneValues(0));
      }
      const c = getCanvas();
      c.clearRect(0, 0, TILE, TILE);
      c.drawImage(img, 0, 0);
      const d = c.getImageData(p.px, p.py, 1, 1).data;
      const index = nearestIndex(d[0], d[1], d[2]);
      return Object.assign({ range: zoneRange(index) }, zoneValues(index));
    }).catch(() => ({ error: true }));
  }

  return {
    lookup: lookup,
    zoneValues: zoneValues,
    zoneRange: zoneRange,
    ZONES: ZONES,
    PALETTE: PALETTE,
    ZOOM: ZOOM,
    RANGE: RANGE,
    NATURAL_SKY: NATURAL_SKY,
    year: 2025,
    credit: 'David Lorenz 光害アトラス 2025（元データ: NOAA VIIRS / Colorado School of Mines EOG）',
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MS_LP;
