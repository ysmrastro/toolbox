/*
 * astro.js — 放射点高度・太陽高度・月の状態を求める最小限の天文計算
 *
 * 外部ライブラリを使わずブラウザだけで完結させるため、低精度アルゴリズムを使う。
 * 精度の目安: 太陽 ±0.01°、月 ±0.3°、放射点高度 ±0.1°。
 * 撮影設定を決める用途には十分だが、掩蔽計算のような用途には使えない。
 */

const MS_ASTRO = (function () {
  'use strict';

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;

  function norm360(x) { return ((x % 360) + 360) % 360; }

  /** ユリウス日 */
  function julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  /** グリニッジ平均恒星時 [度] */
  function gmst(date) {
    const jd = julianDay(date);
    const d = jd - 2451545.0;
    const t = d / 36525;
    return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - t * t * t / 38710000);
  }

  /** 赤道座標 → 地平座標 */
  function equatorialToHorizontal(raDeg, decDeg, latDeg, lonDeg, date) {
    const lst = norm360(gmst(date) + lonDeg);       // 地方恒星時
    const ha = (lst - raDeg) * RAD;                 // 時角
    const dec = decDeg * RAD;
    const lat = latDeg * RAD;
    const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const az = Math.atan2(
      -Math.cos(dec) * Math.cos(lat) * Math.sin(ha),
      Math.sin(dec) - Math.sin(lat) * sinAlt
    );
    return { altitude: alt * DEG, azimuth: norm360(az * DEG) };
  }

  /** 地平座標の2点間の角距離 [度]（カメラの向きと放射点の離角に使う） */
  function angularSeparation(az1, alt1, az2, alt2) {
    const a1 = alt1 * RAD;
    const a2 = alt2 * RAD;
    const dAz = (az1 - az2) * RAD;
    const c = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dAz);
    return Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
  }

  /** 方位角 [度] を16方位の名前にする */
  const COMPASS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
    '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  function compassName(azDeg) {
    return COMPASS[Math.round(norm360(azDeg) / 22.5) % 16];
  }

  /** 黄道座標 → 赤道座標 */
  function eclipticToEquatorial(lambdaDeg, betaDeg, date) {
    const jd = julianDay(date);
    const eps = (23.439291 - 0.0000004 * (jd - 2451545.0)) * RAD;
    const l = lambdaDeg * RAD;
    const b = betaDeg * RAD;
    const ra = Math.atan2(
      Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps),
      Math.cos(l)
    );
    const dec = Math.asin(
      Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l)
    );
    return { ra: norm360(ra * DEG), dec: dec * DEG };
  }

  /** 太陽の黄経 [度] */
  function sunLongitude(date) {
    const n = julianDay(date) - 2451545.0;
    const meanLon = norm360(280.460 + 0.9856474 * n);
    const meanAnom = norm360(357.528 + 0.9856003 * n) * RAD;
    return norm360(meanLon + 1.915 * Math.sin(meanAnom) + 0.020 * Math.sin(2 * meanAnom));
  }

  /** 太陽の位置（高度・方位） */
  function sunPosition(date, lat, lon) {
    const eq = eclipticToEquatorial(sunLongitude(date), 0, date);
    const hz = equatorialToHorizontal(eq.ra, eq.dec, lat, lon, date);
    return { ra: eq.ra, dec: eq.dec, altitude: hz.altitude, azimuth: hz.azimuth };
  }

  /** 月の位置・輝面比・月齢 */
  function moonInfo(date, lat, lon) {
    const d = julianDay(date) - 2451545.0;
    const lp = norm360(218.316 + 13.176396 * d);          // 平均黄経
    const m = norm360(134.963 + 13.064993 * d) * RAD;     // 平均近点角
    const f = norm360(93.272 + 13.229350 * d) * RAD;      // 昇交点からの平均離角
    const lambda = norm360(lp + 6.289 * Math.sin(m));
    const beta = 5.128 * Math.sin(f);

    const eq = eclipticToEquatorial(lambda, beta, date);
    const hz = equatorialToHorizontal(eq.ra, eq.dec, lat, lon, date);

    const elong = norm360(lambda - sunLongitude(date));   // 太陽からの離角
    const illumination = (1 - Math.cos(elong * RAD)) / 2;
    const age = 29.530589 * elong / 360;

    return {
      ra: eq.ra, dec: eq.dec,
      altitude: hz.altitude, azimuth: hz.azimuth,
      illumination: illumination,
      age: age,
      elongation: elong,
    };
  }

  /**
   * 流星群の放射点の位置
   * 極大日からのずれを raDrift / decDrift で補正する。
   */
  function radiantPosition(date, shower) {
    if (shower.ra == null) return null;
    let days = 0;
    if (shower.peak) {
      const [mm, dd] = shower.peak.split('-').map(Number);
      const year = date.getUTCFullYear();
      // 年をまたぐケースに備えて前後の年も見て、最も近い極大日を採用する
      let best = null;
      [-1, 0, 1].forEach((dy) => {
        const peak = Date.UTC(year + dy, mm - 1, dd, 0, 0, 0);
        const diff = (date.getTime() - peak) / 86400000;
        if (best === null || Math.abs(diff) < Math.abs(best)) best = diff;
      });
      days = best;
    }
    return {
      ra: norm360(shower.ra + shower.raDrift * days),
      dec: shower.dec + shower.decDrift * days,
      daysFromPeak: days,
    };
  }

  /** 放射点の高度・方位 */
  function radiantAltitude(date, lat, lon, shower) {
    const pos = radiantPosition(date, shower);
    if (!pos) return { altitude: 45, azimuth: null, daysFromPeak: 0, isSporadic: true };
    const hz = equatorialToHorizontal(pos.ra, pos.dec, lat, lon, date);
    return {
      altitude: hz.altitude,
      azimuth: hz.azimuth,
      ra: pos.ra,
      dec: pos.dec,
      daysFromPeak: pos.daysFromPeak,
      isSporadic: false,
    };
  }

  /**
   * 指定日の夜（日没〜翌朝）のうち、太陽高度が -18° 以下の「暗夜」の区間を返す。
   * date は現地日付の夜を代表する任意の時刻でよい。
   */
  function darkWindow(date, lat, lon) {
    const start = new Date(date.getTime());
    start.setHours(12, 0, 0, 0);                       // 現地の正午を起点に24時間走査
    let begin = null;
    let end = null;
    let prev = null;
    for (let i = 0; i <= 24 * 12; i++) {               // 5分刻み
      const t = new Date(start.getTime() + i * 5 * 60000);
      const alt = sunPosition(t, lat, lon).altitude;
      const dark = alt <= -18;
      if (prev !== null) {
        if (!prev && dark && begin === null) begin = t;
        if (prev && !dark && begin !== null && end === null) end = t;
      }
      prev = dark;
    }
    return { begin: begin, end: end };
  }

  /**
   * 暗夜の中で放射点が最も高くなる時刻を探す（撮影の狙い目）
   */
  function bestObservingTime(date, lat, lon, shower) {
    const win = darkWindow(date, lat, lon);
    if (!win.begin || !win.end) return null;
    let best = null;
    const stepMs = 10 * 60000;                         // 10分刻み
    for (let t = win.begin.getTime(); t <= win.end.getTime(); t += stepMs) {
      const dt = new Date(t);
      const alt = radiantAltitude(dt, lat, lon, shower).altitude;
      if (!best || alt > best.altitude) best = { time: dt, altitude: alt };
    }
    return { window: win, best: best };
  }

  /** 月明かりによる空の劣化量 [等/平方秒] の粗い目安 */
  function moonSkyPenalty(moon) {
    if (moon.altitude <= 0) return 0;
    const h = Math.min(moon.altitude, 60) / 60;        // 高度の効き（60°で飽和）
    return -(0.4 + 2.6 * h) * Math.pow(moon.illumination, 1.5);
  }

  return {
    julianDay: julianDay,
    gmst: gmst,
    equatorialToHorizontal: equatorialToHorizontal,
    angularSeparation: angularSeparation,
    compassName: compassName,
    eclipticToEquatorial: eclipticToEquatorial,
    sunPosition: sunPosition,
    moonInfo: moonInfo,
    radiantPosition: radiantPosition,
    radiantAltitude: radiantAltitude,
    darkWindow: darkWindow,
    bestObservingTime: bestObservingTime,
    moonSkyPenalty: moonSkyPenalty,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MS_ASTRO;
