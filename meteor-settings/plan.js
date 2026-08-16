/*
 * plan.js — 「いつ・どこを狙うか」の計算
 *
 * 【なぜ app.js から切り出したか】
 * app.js は DOM に結び付いた1枚のクロージャで、中の関数を外から呼べない。
 * そのため、これまで**計算のバグを単体テストで捕まえられなかった**。実際に
 *   - 放射点から45°離すはずが離れていなかった（v1.8.0 で修正）
 *   - 朝に見ると「今夜」が1日ずれていた（v1.9.1 で修正）
 * の2件はどちらもこの層のバグで、どちらもテストが書けない形だったから漏れた。
 *
 * 【方針】ここに置く関数は**引数だけで答えが決まる**ようにする。
 * とくに「いま何時か」と「どこで見るか」は state から読まず、必ず引数で受け取る。
 * 1日ずれのバグは tonightAnchor() が内部で new Date() を呼んでいたために
 * 「朝7時」を渡して試すことができなかった。state を注入するのは app.js の役目。
 *
 * 文字にする処理（時刻の書式・HTML）は app.js に残してある。ここは値を返すだけ。
 */
var MS_PLAN = (function () {
  'use strict';

  var A = MS_ASTRO;
  var D = MS_DATA;

  var RAD = Math.PI / 180;

  /* ===================== 夜の数え方 =====================
   * このアプリの「1日」は日付ではなく夜。8/12 の夜＝8/12 の日没〜8/13 の朝。
   * 流星群の極大は未明が本番なので、極大日（8/13）の印は前夜（8/12）に付く。
   */

  /** その夜を代表する日付（0時0分）。未明は前の日の夜の続きとして扱う */
  function nightAnchor(date) {
    var d = new Date(date.getTime());
    if (d.getHours() < 12) d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** その夜の起点（前後どちらの日に属するかを 12:00 で切った、その日の正午） */
  function nightOf(date) {
    var noon = new Date(date.getTime());
    noon.setHours(12, 0, 0, 0);
    if (date.getTime() < noon.getTime()) noon.setDate(noon.getDate() - 1);
    return noon;
  }

  /**
   * 「今夜」がどの夜かの基準（0時0分）。夜明け前ならまだ前の夜の続き、
   * 日が昇っていればもう今夜（当日の夜）を指す。
   *
   * nightAnchor の正午境界を「今」に当ててはいけない。あれは任意の時刻を夜へ
   * 畳み込む規則で、朝に当てると基準が昨夜のままになり、今夜の群が
   * 「明日の夜」と表示される（v1.9.1 で修正した実際のバグ）。
   */
  function tonightAnchor(now, lat, lon) {
    var d = new Date(now.getTime());
    var stillNight = d.getHours() < 12
      && A.sunPosition(now, lat, lon).altitude < -0.833;
    if (stillNight) d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function sameYMD(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  /** 月曜始まりの曜日番号（0=月 … 6=日） */
  function weekIndex(date) { return (date.getDay() + 6) % 7; }

  /** その夜のうち最も狙いやすい時刻（暗夜のうち放射点が最も高い時刻） */
  function bestTimeOfNight(tl, nightDate) {
    if (tl && tl.peak) return tl.peak.time;
    if (tl && tl.duskAstro && tl.dawnAstro) {
      return new Date((tl.duskAstro.getTime() + tl.dawnAstro.getTime()) / 2);
    }
    var d = new Date(nightDate.getTime());
    d.setHours(23, 0, 0, 0);
    return d;
  }

  /* ===================== 名前とラベル ===================== */

  /**
   * 群の名前にギリシャ文字の読みを添える（やぎ座α → やぎ座α（アルファ））。
   * 括弧は文字の直後に置く。名前の末尾だと「みずがめ座δ南流星群（デルタ）」となり、
   * どこに掛かる読みなのか分からなくなる。
   *
   * 使うのは「名前を選ぶ・読む」場面だけ。結果カードの画像と共有テキスト、
   * 到達等級の文章では素の name を使う（data.js の注記）。
   */
  function showerLabel(sh) {
    var name = typeof sh === 'string' ? sh : sh.name;
    return name.replace(/[α-ω]/g, function (c) {
      return (D.greekReadings && D.greekReadings[c]) ? c + '（' + D.greekReadings[c] + '）' : c;
    });
  }

  /** 'MM-DD' を「8/13」の形にする（0埋めのままだと日付に見えにくい） */
  function peakLabel(sh) {
    if (!sh.peak) return '—';
    var p = sh.peak.split('-').map(Number);
    return p[0] + '/' + p[1];
  }

  /** 「今年」「来年」「N年後」 */
  function yearsAwayLabel(n) {
    return n === 0 ? '今年' : n === 1 ? '来年' : n + '年後';
  }

  /** 選択中の流星群の「次の極大の夜」の 01:00 */
  function nextPeakDate(sh, now) {
    if (!sh.peak) {
      var d = new Date(now.getTime() + 86400000);
      d.setHours(1, 0, 0, 0);
      return d;
    }
    var p = sh.peak.split('-').map(Number);
    for (var dy = 0; dy <= 1; dy++) {
      var c = new Date(now.getFullYear() + dy, p[0] - 1, p[1], 1, 0, 0, 0);
      if (c.getTime() > now.getTime()) return c;
    }
    return new Date(now.getFullYear() + 1, p[0] - 1, p[1], 1, 0, 0, 0);
  }

  /* ===================== 極大の夜の評価 =====================
   * タイムラインの計算はそれなりに重いので、地点と年をキーに結果を持っておく。
   * 1年ぶんだけ覚える作りだと upcomingPeaks が2年をまたぐたびに捨て合いになるので、
   * 小さな Map にして数年ぶんを残す。
   */
  var CAL_CACHE_MAX = 8;
  var calCache = new Map();
  var tlCache = { key: null, value: null };

  function locKey(lat, lon) { return lat.toFixed(2) + ',' + lon.toFixed(2); }

  /** 同じ夜のタイムラインを何度も引くので直近の1件だけ覚える */
  function timelineFor(date, lat, lon, sh) {
    var key = [nightOf(date).toDateString(), lat.toFixed(3), lon.toFixed(3), sh.id].join('|');
    if (tlCache.key !== key) {
      tlCache = { key: key, value: A.nightTimeline(date, lat, lon, sh) };
    }
    return tlCache.value;
  }

  /**
   * 「その群のその年の極大の夜」1件ぶんの評価。
   * 年間カレンダー（1年 × 全群）と群別の見通し（1群 × 20年）で共通に使う。
   */
  function evaluatePeakNight(sh, year, lat, lon) {
    var p = sh.peak.split('-').map(Number);
    // 極大日の未明（01:00）を代表時刻にする。nightTimeline は前日の夜として扱う
    var night = new Date(year, p[0] - 1, p[1], 1, 0, 0, 0);
    var tl = A.nightTimeline(night, lat, lon, sh);
    /* 月齢と輝面比は「その夜が始まる日の正午」の値にする。
       マンスリーカレンダーのマスと同じ数え方に揃えて、別の数字が並ばないようにする */
    var noon = new Date(night.getTime() - 13 * 3600000);   // 極大日01:00 → 前日12:00
    var moonNoon = A.moonInfo(noon, lat, lon);
    return {
      shower: sh,
      date: night,
      timeline: tl,
      goldenMinutes: tl.goldenMinutes,
      illumination: moonNoon.illumination,
      moonAge: moonNoon.age,
      peakAlt: tl.peak ? tl.peak.altitude : 0,
      peakTime: tl.peak ? tl.peak.time : null,
    };
  }

  /** その年の各群の極大の夜を評価する */
  function calendarRows(year, lat, lon) {
    var key = year + '|' + locKey(lat, lon);
    if (calCache.has(key)) return calCache.get(key);

    var rows = D.showers.filter(function (sh) { return sh.peak; })
      .map(function (sh) { return evaluatePeakNight(sh, year, lat, lon); });
    if (calCache.size >= CAL_CACHE_MAX) calCache.delete(calCache.keys().next().value);
    calCache.set(key, rows);
    return rows;
  }

  /**
   * 月・放射点高度・狙える時間から条件の良し悪しを4段階で表す。
   * 出現数の絶対値は較正できないので、あくまで条件の目安。
   *
   * score（0〜1）は5時間・高度50°で頭打ちになる。4段階に分けるには十分だが、
   * 条件のよい年どうしを並べる用途には使えない（全部1.0になる）。
   * 群別の見通しのバーが「狙える時間の相対値」なのはこのため。
   */
  function calendarVerdict(row) {
    var hours = row.goldenMinutes / 60;
    var alt = row.peakAlt;
    if (hours <= 0 || alt <= 5) return { rank: 'bad', label: '見込みなし', score: 0 };
    // 狙える時間（暗夜×月なし）と放射点の高さの両方が要る
    var score = Math.min(hours / 5, 1) * Math.min(alt / 50, 1);
    /* 評価しているのは「月と放射点高度の条件」だけで、群そのものの多さは含まない。
       「当たり年」だと出現数が多いように読めるので、条件の良し悪しとして書く（ZHR は横に並べる） */
    if (score >= 0.75) return { rank: 'ok', label: '条件よい', score: score };
    if (score >= 0.4) return { rank: 'mid', label: 'まあまあ', score: score };
    return { rank: 'warn', label: '条件わるい', score: score };
  }

  /** 表示中の月に極大がある夜を { 日: [流星群] } で返す */
  function peakNightsOfMonth(year, month) {
    var map = {};
    D.showers.filter(function (sh) { return sh.peak; }).forEach(function (sh) {
      var p = sh.peak.split('-').map(Number);
      // 1月・12月のマスには隣の年の極大が入るので前後の年も見る
      [year - 1, year, year + 1].forEach(function (y) {
        var night = nightAnchor(new Date(y, p[0] - 1, p[1], 1, 0, 0, 0));
        if (night.getFullYear() !== year || night.getMonth() !== month) return;
        var key = night.getDate();
        if (!map[key]) map[key] = [];
        map[key].push(sh);
      });
    });
    return map;
  }

  /** 今夜以降の極大を近い順に返す */
  function upcomingPeaks(count, now, lat, lon) {
    var todayMs = tonightAnchor(now, lat, lon).getTime();
    var year = now.getFullYear();
    var rows = [];
    [year, year + 1].forEach(function (y) {
      calendarRows(y, lat, lon).forEach(function (r) {
        if (nightAnchor(r.date).getTime() >= todayMs) rows.push(r);
      });
    });
    rows.sort(function (a, b) { return a.date - b.date; });
    return rows.slice(0, count);
  }

  /* 群別の見通しの年数。
     極大の日付は固定で、同じ日付なら放射点の高さも毎年ほとんど変わらない。
     つまり年ごとの差はほぼ月の条件だけで決まる。月の満ち欠けは約19年で同じ日付に
     戻る（メトン周期）ので、20年ぶん並べれば「次の当たり」は必ずこの中に入る。 */
  var OUTLOOK_YEARS = 20;

  /* 並べ替えのたびに20年ぶん引き直さないよう、直近の1件だけ覚える */
  var outlookCache = { key: null, rows: null };

  /** 1つの群の極大の夜を fromYear から OUTLOOK_YEARS 年ぶん並べる */
  function outlookRows(sh, fromYear, lat, lon, years) {
    var n = years || OUTLOOK_YEARS;
    var key = [sh.id, fromYear, n, locKey(lat, lon)].join('|');
    if (outlookCache.key === key) return outlookCache.rows;

    var rows = [];
    for (var y = fromYear; y < fromYear + n; y++) rows.push(evaluatePeakNight(sh, y, lat, lon));
    outlookCache = { key: key, rows: rows };
    return rows;
  }

  /* ===================== カメラを向ける方向 ===================== */

  function norm360(deg) { return ((deg % 360) + 360) % 360; }

  /**
   * 心射投影（gnomonic projection）。中心（az0, alt0）を向いた接平面に空を写す。
   * x は右が正・y は上が正。behind が true の点は視野の裏側なので描かない。
   */
  function projectSky(az, alt, az0, alt0) {
    var a = alt * RAD;
    var a0 = alt0 * RAD;
    var dAz = (az - az0) * RAD;
    var cosC = Math.sin(a0) * Math.sin(a) + Math.cos(a0) * Math.cos(a) * Math.cos(dAz);
    if (cosC <= 0.01) return { behind: true };
    return {
      x: (Math.cos(a) * Math.sin(dAz)) / cosC,
      y: (Math.cos(a0) * Math.sin(a) - Math.sin(a0) * Math.cos(a) * Math.cos(dAz)) / cosC,
      behind: false,
    };
  }

  /** ある点から指定した角距離だけ離れた点の列（離角の目安の円を描くため） */
  function circleAround(az0, alt0, radiusDeg, steps) {
    var pts = [];
    var r = radiusDeg * RAD;
    var a0 = alt0 * RAD;
    for (var i = 0; i <= steps; i++) {
      var th = (i / steps) * 2 * Math.PI;
      // 中心（az0, alt0）から方位角 th の向きに r だけ進んだ点（球面三角）
      var alt = Math.asin(Math.sin(a0) * Math.cos(r) + Math.cos(a0) * Math.sin(r) * Math.cos(th));
      var dAz = Math.atan2(Math.sin(r) * Math.sin(th),
        Math.cos(a0) * Math.cos(r) - Math.sin(a0) * Math.sin(r) * Math.cos(th));
      pts.push({ az: az0 + dAz / RAD, alt: alt / RAD });
    }
    return pts;
  }

  /** 放射点から方位で45°離した向き（初期値）。rad は { azimuth, isSporadic } */
  function defaultCamAz(rad) {
    if (!rad || rad.isSporadic || rad.azimuth == null) return 180;
    return Math.round(((rad.azimuth + 45) % 360) / 5) * 5 % 360;
  }

  /**
   * プリセットで狙う向き（方位・高度）。天頂は方位を変えない。
   * curAz は「いま向いている方位」（未設定なら defaultCamAz の値を渡す）。
   */
  function presetDirection(kind, curAz, radAz, radAlt) {
    if (kind === 'zenith') return { az: curAz, alt: 90 };
    if (kind === 'radiant') return { az: radAz, alt: radAlt };

    /* 放射点から45°離す。
       「方位を45°ずらす」だと放射点が高いときに離角が45°に届かない
       （高度58°では方位45°ずらしても離角は23°しかない。実際にそうなっていた）。
       球面上で45°離れた円をたどり、そのうち最も高度が取れる点を選ぶ。
       高度が高いほど空が暗く流星の減光も小さいので、条件のいい向きになる。 */
    var best = null;
    circleAround(radAz, radAlt, 45, 72).forEach(function (q) {
      if (!best || q.alt > best.alt) best = q;
    });
    return best ? { az: norm360(best.az), alt: best.alt } : { az: norm360(radAz + 45), alt: radAlt };
  }

  return {
    nightAnchor: nightAnchor,
    nightOf: nightOf,
    tonightAnchor: tonightAnchor,
    sameYMD: sameYMD,
    weekIndex: weekIndex,
    bestTimeOfNight: bestTimeOfNight,

    showerLabel: showerLabel,
    peakLabel: peakLabel,
    yearsAwayLabel: yearsAwayLabel,
    nextPeakDate: nextPeakDate,

    timelineFor: timelineFor,
    evaluatePeakNight: evaluatePeakNight,
    calendarRows: calendarRows,
    calendarVerdict: calendarVerdict,
    peakNightsOfMonth: peakNightsOfMonth,
    upcomingPeaks: upcomingPeaks,
    outlookRows: outlookRows,
    OUTLOOK_YEARS: OUTLOOK_YEARS,

    norm360: norm360,
    projectSky: projectSky,
    circleAround: circleAround,
    defaultCamAz: defaultCamAz,
    presetDirection: presetDirection,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MS_PLAN;
