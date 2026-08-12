/*
 * astro.js — 放射点高度・太陽高度・月の状態を求める最小限の天文計算
 *
 * 外部ライブラリを使わずブラウザだけで完結させるため、低精度アルゴリズムを使う。
 * 精度の目安: 太陽 ±0.01°、月 ±0.05°、放射点高度 ±0.1°。
 * 出入りの時刻を国立天文台の公表値と比べると、太陽 ±0.5分・月 ±2.2分・月齢 ±0.02日
 * （東京と根室・8月と12月の28件で実測。tools/check-riseset.js で再現できる）。
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

  /** 地平座標 → 赤道座標（equatorialToHorizontal の逆。赤道儀の枠の傾きを出すのに使う） */
  function horizontalToEquatorial(azDeg, altDeg, latDeg, lonDeg, date) {
    const az = azDeg * RAD;
    const alt = altDeg * RAD;
    const lat = latDeg * RAD;
    const sinDec = Math.sin(alt) * Math.sin(lat) + Math.cos(alt) * Math.cos(lat) * Math.cos(az);
    const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
    const ha = Math.atan2(
      -Math.cos(alt) * Math.cos(lat) * Math.sin(az),
      Math.sin(alt) - Math.sin(lat) * sinDec
    );
    const lst = norm360(gmst(date) + lonDeg);
    return { ra: norm360(lst - ha / RAD), dec: dec * DEG };
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

  /**
   * 月の黄経・黄緯 [度]
   *
   * 主要な周期項までの打ち切り近似。平均黄経＋出差（6.289°）だけでは
   * 月の出入りが国立天文台の値と最大10分ずれたため、次に大きい
   * 二均差（evection 1.274°）・変差（variation 0.658°）などを足している。
   * 効果は tools/check-riseset.js で実測して確認する（最大10分→3分）。
   */
  function moonEcliptic(date) {
    const d = julianDay(date) - 2451545.0;
    const lp = norm360(218.3165 + 13.17639648 * d);        // 平均黄経 L'
    const dd = norm360(297.8502 + 12.19074910 * d) * RAD;  // 太陽からの平均離角 D
    const ms = norm360(357.5291 + 0.98560028 * d) * RAD;   // 太陽の平均近点角 M
    const mm = norm360(134.9634 + 13.06499300 * d) * RAD;  // 月の平均近点角 M'
    const f = norm360(93.2721 + 13.22935050 * d) * RAD;    // 昇交点からの平均離角 F

    const lambda = lp
      + 6.28875 * Math.sin(mm)                 // 出差
      + 1.27402 * Math.sin(2 * dd - mm)        // 二均差
      + 0.65831 * Math.sin(2 * dd)             // 変差
      + 0.21362 * Math.sin(2 * mm)
      - 0.18512 * Math.sin(ms)                 // 年差
      - 0.11433 * Math.sin(2 * f)
      + 0.05879 * Math.sin(2 * dd - 2 * mm)
      + 0.05706 * Math.sin(2 * dd - ms - mm)
      + 0.05332 * Math.sin(2 * dd + mm)
      + 0.04576 * Math.sin(2 * dd - ms)
      - 0.04092 * Math.sin(ms - mm)
      - 0.03472 * Math.sin(dd)
      - 0.03038 * Math.sin(ms + mm);

    const beta = 5.12812 * Math.sin(f)
      + 0.28060 * Math.sin(mm + f)
      + 0.27769 * Math.sin(mm - f)
      + 0.17324 * Math.sin(2 * dd - f)
      + 0.05541 * Math.sin(2 * dd - mm + f)
      + 0.04627 * Math.sin(2 * dd - mm - f)
      + 0.03257 * Math.sin(2 * dd + f);

    return { lambda: norm360(lambda), beta: beta };
  }

  /**
   * 月の位置だけを求める軽い版。
   * 出入りの時刻を探すときは1日あたり数百回呼ぶので、月齢の計算を含めない。
   */
  function moonPosition(date, lat, lon) {
    const ec = moonEcliptic(date);
    const eq = eclipticToEquatorial(ec.lambda, ec.beta, date);
    const hz = equatorialToHorizontal(eq.ra, eq.dec, lat, lon, date);
    return {
      ra: eq.ra, dec: eq.dec,
      altitude: hz.altitude, azimuth: hz.azimuth,
      lambda: ec.lambda,
    };
  }

  const SYNODIC = 29.530589;        // 朔望月 [日]

  /**
   * 月齢＝直前の朔（新月）からの経過日数。
   *
   * 「29.53 × 離角 / 360」で済ませると、月の公転が一定速度でないため
   * 国立天文台の値と最大0.8日ずれる（実際にずれていた）。
   * 朔の時刻そのものをニュートン法で探して数える。
   */
  function moonAge(date) {
    const rate = 360 / SYNODIC;     // 離角の平均増加率 [度/日]
    // 朔をまたぐと符号が変わる量（-180〜180）にして、これがゼロになる時刻を探す
    const signedElong = (t) => {
      const e = norm360(moonEcliptic(t).lambda - sunLongitude(t));
      return e > 180 ? e - 360 : e;
    };
    const converge = (guessMs) => {
      let t = guessMs;
      for (let i = 0; i < 6; i++) t -= (signedElong(new Date(t)) / rate) * 86400000;
      return t;
    };
    let newMoon = converge(date.getTime());
    // 最も近い朔が未来だった場合は、その1つ前の朔から数える
    if (newMoon > date.getTime()) newMoon = converge(newMoon - SYNODIC * 86400000);
    return (date.getTime() - newMoon) / 86400000;
  }

  /** 月の位置・輝面比・月齢 */
  function moonInfo(date, lat, lon) {
    const p = moonPosition(date, lat, lon);
    const elong = norm360(p.lambda - sunLongitude(date));   // 太陽からの離角
    return {
      ra: p.ra, dec: p.dec,
      altitude: p.altitude, azimuth: p.azimuth,
      illumination: (1 - Math.cos(elong * RAD)) / 2,
      age: moonAge(date),
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

  /**
   * ある値が閾値をまたぐ時刻を線形補間で求める補助関数。
   * fn(t) の符号が変わる区間を粗い刻みで探し、その中を内挿する。
   * @param {number} startMs 走査開始
   * @param {number} endMs   走査終了
   * @param {number} stepMs  刻み
   * @param {function} fn    時刻(Date) → 数値
   * @param {number} level   この値をまたぐ時刻を探す
   * @param {number} dir     +1 なら上向き（level を下から上へ）、-1 なら下向き
   * @returns {Date|null}
   */
  function findCrossing(startMs, endMs, stepMs, fn, level, dir, refineMs) {
    let prevT = startMs;
    let prevV = fn(new Date(startMs)) - level;
    for (let t = startMs + stepMs; t <= endMs; t += stepMs) {
      const v = fn(new Date(t)) - level;
      const up = prevV < 0 && v >= 0;
      const down = prevV > 0 && v <= 0;
      if ((dir > 0 && up) || (dir < 0 && down)) {
        /* 粗い刻みで区間を見つけたら、その区間だけ細かく刻み直す。
           荒い刻みのまま線形内挿すると、地平線近くで曲がる分だけ時刻がずれる */
        if (refineMs && refineMs < t - prevT) {
          const fine = findCrossing(prevT, t, refineMs, fn, level, dir);
          if (fine) return fine;
        }
        // 線形内挿（区間が短いので十分）
        const ratio = prevV / (prevV - v);
        return new Date(prevT + (t - prevT) * ratio);
      }
      prevT = t;
      prevV = v;
    }
    return null;
  }

  /* ---------- カレンダーの1日ぶんの出入り ----------
   * 現地の 00:00〜24:00 を走査して、その日のうちに起きる出／入を採る
   * （国立天文台「各地のこよみ」と同じ数え方）。月は毎日およそ50分ずつ遅れるため、
   * 出が無い日・入が無い日がある。その場合は null を返す。
   */
  const SUN_HORIZON = -0.833;   // 太陽の出入り＝上辺が地平線に接する（大気差込み）
  const MOON_HORIZON = 0.125;   // 月の出入り＝地心高度がこの値（視差・大気差・視半径の合成）

  function dayEvents(date, lat, lon) {
    const start = new Date(date.getTime());
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    const endMs = startMs + 24 * 3600000;
    const sunAlt = (t) => sunPosition(t, lat, lon).altitude;
    const moonAlt = (t) => moonPosition(t, lat, lon).altitude;
    // 10分刻みで区間を探し、その区間を30秒刻みで詰める
    const find = (fn, level, dir) =>
      findCrossing(startMs, endMs, 10 * 60000, fn, level, dir, 30000);

    const noon = new Date(startMs + 12 * 3600000);
    const age = moonAge(noon);
    const elong = norm360(moonEcliptic(noon).lambda - sunLongitude(noon));
    return {
      date: start,
      sunrise: find(sunAlt, SUN_HORIZON, +1),
      sunset: find(sunAlt, SUN_HORIZON, -1),
      moonrise: find(moonAlt, MOON_HORIZON, +1),
      moonset: find(moonAlt, MOON_HORIZON, -1),
      moonAge: age,                                  // 正午の値
      illumination: (1 - Math.cos(elong * RAD)) / 2,
      waxing: age < SYNODIC / 2,                     // 満ちていく途中か
    };
  }

  /**
   * 指定した夜の撮影計画に必要な時刻をまとめて求める。
   *
   * 「その夜」は date の現地日付の 12:00 から翌 12:00 までとする
   * （深夜1時を指定しても同じ夜として扱われるように）。
   *
   * 返り値の時刻はすべて Date か null。null は「その夜には起きない」
   * （高緯度の白夜や、月が一晩中出ている／出ないケース）。
   */
  function nightTimeline(date, lat, lon, shower) {
    const noon = new Date(date.getTime());
    noon.setHours(12, 0, 0, 0);
    // 指定時刻が正午より前なら、前日の正午を起点にする（未明は前の夜の続き）
    if (date.getTime() < noon.getTime()) noon.setDate(noon.getDate() - 1);
    const startMs = noon.getTime();
    const endMs = startMs + 24 * 3600000;

    const sunAlt = (t) => sunPosition(t, lat, lon).altitude;
    const moonAlt = (t) => moonPosition(t, lat, lon).altitude;   // 月齢は要らないので軽い版
    const coarse = 5 * 60000;      // 5分刻みで符号の変化を探す

    /* 太陽 — 日没・各薄明の終わり／始まり */
    const sunset = findCrossing(startMs, endMs, coarse, sunAlt, -0.833, -1);
    const duskCivil = findCrossing(startMs, endMs, coarse, sunAlt, -6, -1);
    const duskAstro = findCrossing(startMs, endMs, coarse, sunAlt, -18, -1);
    const dawnAstro = findCrossing(startMs, endMs, coarse, sunAlt, -18, +1);
    const dawnCivil = findCrossing(startMs, endMs, coarse, sunAlt, -6, +1);
    const sunrise = findCrossing(startMs, endMs, coarse, sunAlt, -0.833, +1);

    /* 表示範囲は日没から日の出まで（求まらない場合は 18:00〜翌6:00 で代用） */
    const from = sunset || new Date(startMs + 6 * 3600000);
    const to = sunrise || new Date(startMs + 18 * 3600000);

    /* 月 — 表示範囲の中で地平線をまたぐ時刻と、出ている区間 */
    const moonrise = findCrossing(from.getTime(), to.getTime(), coarse, moonAlt, 0, +1);
    const moonset = findCrossing(from.getTime(), to.getTime(), coarse, moonAlt, 0, -1);
    const moonUp = [];
    {
      let segStart = moonAlt(from) > 0 ? from : null;
      let prev = moonAlt(from) > 0;
      for (let t = from.getTime() + coarse; t <= to.getTime(); t += coarse) {
        const dt = new Date(t);
        const up = moonAlt(dt) > 0;
        if (!prev && up) segStart = dt;
        if (prev && !up && segStart) { moonUp.push({ from: segStart, to: dt }); segStart = null; }
        prev = up;
      }
      if (segStart) moonUp.push({ from: segStart, to: to });
    }

    /* 放射点高度の系列とピーク（10分刻み） */
    const series = [];
    let peak = null;
    const seriesStep = 10 * 60000;
    for (let t = from.getTime(); t <= to.getTime(); t += seriesStep) {
      const dt = new Date(t);
      const alt = radiantAltitude(dt, lat, lon, shower).altitude;
      series.push({ time: dt, altitude: alt });
      const inDark = (!duskAstro || t >= duskAstro.getTime()) &&
        (!dawnAstro || t <= dawnAstro.getTime());
      if (inDark && (!peak || alt > peak.altitude)) peak = { time: dt, altitude: alt };
    }
    // 暗夜が無い夜（白夜など）はやむを得ず全区間から採る
    if (!peak) {
      series.forEach((s) => { if (!peak || s.altitude > peak.altitude) peak = s; });
    }

    /* 狙い目 = 天文薄明のあいだ かつ 月が地平線下 かつ 放射点が地平線上 */
    const golden = [];
    {
      const darkFrom = duskAstro ? duskAstro.getTime() : from.getTime();
      const darkTo = dawnAstro ? dawnAstro.getTime() : to.getTime();
      const ok = (t) => {
        const dt = new Date(t);
        return t >= darkFrom && t <= darkTo && moonAlt(dt) <= 0 &&
          radiantAltitude(dt, lat, lon, shower).altitude > 0;
      };
      let segStart = null;
      for (let t = from.getTime(); t <= to.getTime(); t += coarse) {
        const good = ok(t);
        if (good && segStart === null) segStart = new Date(t);
        if (!good && segStart !== null) { golden.push({ from: segStart, to: new Date(t) }); segStart = null; }
      }
      if (segStart !== null) golden.push({ from: segStart, to: to });
    }

    /* 夜の代表値としての月の状態（暗夜の中央、なければ範囲の中央） */
    const midMs = duskAstro && dawnAstro
      ? (duskAstro.getTime() + dawnAstro.getTime()) / 2
      : (from.getTime() + to.getTime()) / 2;
    const moonMid = moonInfo(new Date(midMs), lat, lon);

    return {
      from: from, to: to,
      sunset: sunset, duskCivil: duskCivil, duskAstro: duskAstro,
      dawnAstro: dawnAstro, dawnCivil: dawnCivil, sunrise: sunrise,
      moonrise: moonrise, moonset: moonset, moonUp: moonUp,
      moon: moonMid,
      series: series, peak: peak, golden: golden,
      goldenMinutes: golden.reduce((a, g) => a + (g.to - g.from) / 60000, 0),
    };
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
    horizontalToEquatorial: horizontalToEquatorial,
    angularSeparation: angularSeparation,
    compassName: compassName,
    eclipticToEquatorial: eclipticToEquatorial,
    sunPosition: sunPosition,
    moonInfo: moonInfo,
    moonPosition: moonPosition,
    moonAge: moonAge,
    dayEvents: dayEvents,
    radiantPosition: radiantPosition,
    radiantAltitude: radiantAltitude,
    darkWindow: darkWindow,
    bestObservingTime: bestObservingTime,
    findCrossing: findCrossing,
    nightTimeline: nightTimeline,
    moonSkyPenalty: moonSkyPenalty,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MS_ASTRO;
