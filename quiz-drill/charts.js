/*
 * charts.js — 分析タブのグラフ（手書きの SVG。外部ライブラリなし）
 *
 * 【方針】どの関数も、データと寸法を受け取って SVG の文字列（と、操作に使う位置の情報）を返すだけにする。
 * DOM・イベント・時計には触らない。ツールチップやキーボードの操作は app.js が受け持つ。
 *
 * 色は SVG の属性（fill="var(...)"）に書かず、クラスと style.css のトークンで付ける
 * （属性の中の var() は解決されないブラウザがある）。グラデーションの色も style 属性で書く。
 * 文字はすべて 12px 以上（CLAUDE.md のタイポグラフィの下限）。
 */
var QD_CHARTS = (function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function r1(n) { return Math.round(n * 10) / 10; }

  /** 0 から max を、ちょうど div 区切りで覆う目盛り（刻みは 1・1.5・2・2.5・3・4・5・6・8 × 10^k に切り上げ。整数）。max が 0 以下なら fallback で */
  function fixedTicks(max, div, fallback) {
    var top = max > 0 ? max : fallback;
    var raw = top / div;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / mag;
    // 区切りの数が決まっているので、刻みの候補を細かくして上の余りを小さくする
    var nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].filter(function (x) { return x >= f; })[0];
    var step = Math.max(1, Math.ceil(nice * mag));
    var out = [];
    for (var i = 0; i <= div; i++) out.push(step * i);
    return out;
  }

  /** 3桁ごとの区切り（1,234） */
  function num(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** 'YYYY-MM-DD' → 'M/D' */
  function md(key) {
    return Number(key.slice(5, 7)) + '/' + Number(key.slice(8));
  }

  /**
   * なめらかな線（単調な3次スプライン。Fritsch–Carlson）。点の並びの上下を越えて膨らまないので、
   * 累計のように増えるだけの線が途中で下がって見えることがない。
   */
  function smoothPath(pts) {
    var n = pts.length;
    if (n === 0) return '';
    if (n === 1) return 'M' + r1(pts[0][0]) + ',' + r1(pts[0][1]);
    var dx = [], dy = [], m = [], t = [];
    for (var i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1][0] - pts[i][0];
      dy[i] = pts[i + 1][1] - pts[i][1];
      m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
    }
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (var j = 1; j < n - 1; j++) t[j] = m[j - 1] * m[j] <= 0 ? 0 : (m[j - 1] + m[j]) / 2;
    for (var k = 0; k < n - 1; k++) {
      if (m[k] === 0) { t[k] = 0; t[k + 1] = 0; continue; }
      var a = t[k] / m[k], b = t[k + 1] / m[k], s = a * a + b * b;
      if (s > 9) { var h = 3 / Math.sqrt(s); t[k] = h * a * m[k]; t[k + 1] = h * b * m[k]; }
    }
    var d = 'M' + r1(pts[0][0]) + ',' + r1(pts[0][1]);
    for (var q = 0; q < n - 1; q++) {
      var c = dx[q] / 3;
      d += 'C' + r1(pts[q][0] + c) + ',' + r1(pts[q][1] + c * t[q]) + ' ' +
        r1(pts[q + 1][0] - c) + ',' + r1(pts[q + 1][1] - c * t[q + 1]) + ' ' +
        r1(pts[q + 1][0]) + ',' + r1(pts[q + 1][1]);
    }
    return d;
  }

  /** x 軸に出す日付の添字（幅に合わせて間引く。最後の日は必ず出す） */
  function labelIndices(n, plotW, minGap) {
    var every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / minGap))));
    var out = [];
    for (var i = n - 1; i >= 0; i -= every) out.unshift(i);
    return out;
  }

  function glowFilter(id) {
    return '<filter id="' + id + '" x="-20%" y="-50%" width="140%" height="200%">' +
      '<feGaussianBlur stdDeviation="3.5" result="b"/>' +
      '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
  }

  /**
   * 日別の棒（左軸）と、始めてからの累計の折れ線（右軸）。series は QD_ANALYSIS.dailySeries の返り値。
   * opts: { width, height, uid }。返り値 { svg, plot: { left, top, width, height, step, n } }。
   */
  function dualAxis(series, opts) {
    var W = Math.max(240, opts.width), H = opts.height || 260;
    var uid = opts.uid || 'dx';
    var days = series.days, n = days.length;
    // 左右の目盛りを同じ高さの線に乗せるため、区切りの数を両方 4 に固定する
    var leftTicks = fixedTicks(series.max, 4, 10);
    var rightTicks = fixedTicks(series.cumMax, 4, 100);
    var lMax = leftTicks[leftTicks.length - 1], rMax = rightTicks[rightTicks.length - 1];
    var rightW = Math.max(36, num(rMax).length * 8 + 10);
    var pad = { l: 36, r: rightW, t: 18, b: 30 };
    var pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    var step = pw / n;
    var bw = Math.max(1, step * (n > 120 ? 0.82 : 0.64));
    var yL = function (v) { return pad.t + ph - (v / lMax) * ph; };
    var yR = function (v) { return pad.t + ph - (v / rMax) * ph; };

    var s = '<svg class="qd-chart" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">';
    s += '<defs>' +
      '<linearGradient id="' + uid + '-bar" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" style="stop-color:var(--qd-viz-bar);stop-opacity:1"/>' +
      '<stop offset="1" style="stop-color:var(--qd-viz-bar);stop-opacity:0.28"/></linearGradient>' +
      '<linearGradient id="' + uid + '-area" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" style="stop-color:var(--qd-viz-line);stop-opacity:0.18"/>' +
      '<stop offset="1" style="stop-color:var(--qd-viz-line);stop-opacity:0"/></linearGradient>' +
      glowFilter(uid + '-glow') + '</defs>';

    // 目盛りの線と左右の軸の数字（左は日別、右は累計。同じ高さに4本そろえる）
    leftTicks.forEach(function (v, i) {
      var y = r1(yL(v));
      s += '<line class="qd-grid" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="qd-ax" x="' + (pad.l - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + num(v) + '</text>';
      var rv = rightTicks[i];
      if (rv !== undefined) {
        s += '<text class="qd-ax qd-ax--line" x="' + (W - pad.r + 8) + '" y="' + r1(yR(rv) + 4) + '">' + num(rv) + '</text>';
      }
    });

    // 棒（下から伸びる。遅れは全体で 0.45 秒に収める）
    s += '<g class="qd-bars">';
    days.forEach(function (d, i) {
      if (!d.answers) return;
      var x = pad.l + step * i + (step - bw) / 2;
      var y = yL(d.answers);
      var h = Math.max(1.5, pad.t + ph - y);
      s += '<rect class="qd-bar" data-i="' + i + '" x="' + r1(x) + '" y="' + r1(pad.t + ph - h) + '" width="' + r1(bw) +
        '" height="' + r1(h) + '" rx="' + r1(Math.min(3, bw / 2)) + '" fill="url(#' + uid + '-bar)" style="--d:' +
        Math.round((i / n) * 450) + 'ms"/>';
    });
    s += '</g>';

    // 累計の折れ線（発光させる）と、その下の淡い面
    var pts = days.map(function (d, i) { return [pad.l + step * (i + 0.5), yR(d.cum)]; });
    var line = smoothPath(pts);
    if (series.cumMax > 0) {
      var area = line + 'L' + r1(pts[n - 1][0]) + ',' + (pad.t + ph) + 'L' + r1(pts[0][0]) + ',' + (pad.t + ph) + 'Z';
      s += '<path class="qd-area" d="' + area + '" fill="url(#' + uid + '-area)"/>';
      s += '<path class="qd-line" d="' + line + '" pathLength="1" filter="url(#' + uid + '-glow)"/>';
      s += '<circle class="qd-line-end" cx="' + r1(pts[n - 1][0]) + '" cy="' + r1(pts[n - 1][1]) + '" r="4" filter="url(#' + uid + '-glow)"/>';
    }

    // x 軸の日付
    labelIndices(n, pw, 64).forEach(function (i) {
      var x = pad.l + step * (i + 0.5);
      var anchor = i === n - 1 ? 'end' : 'middle';
      if (i === n - 1) x = Math.min(x + step / 2, W - pad.r);
      s += '<text class="qd-ax" x="' + r1(x) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + md(days[i].date) + '</text>';
    });
    s += '<line class="qd-axis" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + (pad.t + ph) + '" y2="' + (pad.t + ph) + '"/>';
    // 選んだ日の縦線（app.js が位置を動かす）
    s += '<line class="qd-cursor" x1="0" x2="0" y1="' + pad.t + '" y2="' + (pad.t + ph) + '" visibility="hidden"/>';
    s += '</svg>';
    return { svg: s, plot: { left: pad.l, top: pad.t, width: pw, height: ph, step: step, n: n } };
  }

  /**
   * 週ごとの正答率。weeks は QD_ANALYSIS.weeklyAccuracy の返り値。回答のある週だけ点を打ち、線でつなぐ。
   * 点の大きさは回答数（多いほど大きい）、回答が 10 件未満の週は薄くする（信頼しにくい）。
   * 70% の線は、苦手の目安（成績の画面のしきい値）。返り値 { svg, plot, points: [{ i, x, y }] }。
   */
  function accuracy(weeks, opts) {
    var W = Math.max(240, opts.width), H = opts.height || 220;
    var uid = opts.uid || 'ac';
    var pad = { l: 44, r: 16, t: 16, b: 30 };
    var pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    var n = weeks.length;
    var step = pw / Math.max(1, n);
    var y = function (rate) { return pad.t + ph - rate * ph; };
    var maxAns = weeks.reduce(function (m, w) { return Math.max(m, w.answers); }, 1);

    var s = '<svg class="qd-chart" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">';
    s += '<defs>' + glowFilter(uid + '-glow') + '</defs>';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      var yy = r1(y(v));
      s += '<line class="qd-grid" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + yy + '" y2="' + yy + '"/>';
      s += '<text class="qd-ax" x="' + (pad.l - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + Math.round(v * 100) + '%</text>';
    });
    var y70 = r1(y(0.7));
    s += '<line class="qd-ref" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y70 + '" y2="' + y70 + '"/>';
    s += '<text class="qd-ax qd-ax--ref" x="' + (W - pad.r) + '" y="' + (y70 - 6) + '" text-anchor="end">苦手の目安 70%</text>';

    var points = [];
    weeks.forEach(function (w, i) {
      if (w.rate === null) return;
      points.push({ i: i, x: pad.l + step * (i + 0.5), y: y(w.rate) });
    });
    if (points.length > 1) {
      s += '<path class="qd-line qd-line--acc" d="' + smoothPath(points.map(function (p) { return [p.x, p.y]; })) +
        '" pathLength="1" filter="url(#' + uid + '-glow)"/>';
    }
    points.forEach(function (p, j) {
      var w = weeks[p.i];
      var r = 2.5 + 4 * Math.sqrt(w.answers / maxAns);
      s += '<circle class="qd-dot' + (w.answers < 10 ? ' is-thin' : '') + '" data-i="' + p.i + '" cx="' + r1(p.x) + '" cy="' + r1(p.y) +
        '" r="' + r1(r) + '" style="--d:' + (300 + j * 25) + 'ms"/>';
    });

    labelIndices(n, pw, 64).forEach(function (i) {
      var x = pad.l + step * (i + 0.5);
      s += '<text class="qd-ax" x="' + r1(x) + '" y="' + (H - 8) + '" text-anchor="' + (i === n - 1 ? 'end' : 'middle') + '">' +
        md(weeks[i].week) + '</text>';
    });
    s += '<line class="qd-axis" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + (pad.t + ph) + '" y2="' + (pad.t + ph) + '"/>';
    s += '<line class="qd-cursor" x1="0" x2="0" y1="' + pad.t + '" y2="' + (pad.t + ph) + '" visibility="hidden"/>';
    s += '</svg>';
    return { svg: s, plot: { left: pad.l, top: pad.t, width: pw, height: ph, step: step, n: n }, points: points };
  }

  var WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];

  /**
   * カレンダー（GitHub の草のような、日ごとの実施数の濃淡）。hm は QD_ANALYSIS.heatmap の返り値。
   * opts: { cell（マスの一辺）, gap }。返り値 { svg（マスと月）, labels（曜日の列）, width, height, labelW }。
   */
  function heatmap(hm, opts) {
    var cell = opts.cell || 12, gap = opts.gap || 3;
    var labelW = 22, top = 20;
    var cols = hm.weeks.length;
    var W = cols * (cell + gap), H = top + 7 * (cell + gap);
    // 曜日のラベルは別の SVG にする（横にスクロールしても左に残るように）
    var labels = '<svg class="qd-chart" width="' + labelW + '" height="' + H + '" viewBox="0 0 ' + labelW + ' ' + H + '" aria-hidden="true">';
    [0, 2, 4, 6].forEach(function (r) {
      labels += '<text class="qd-ax" x="0" y="' + r1(top + r * (cell + gap) + cell / 2 + 4) + '">' + WEEKDAYS[r] + '</text>';
    });
    labels += '</svg>';
    var s = '<svg class="qd-chart qd-heat" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">';
    hm.months.forEach(function (m) {
      s += '<text class="qd-ax" x="' + (m.col * (cell + gap)) + '" y="13">' + m.month + '月</text>';
    });
    hm.weeks.forEach(function (col, c) {
      col.forEach(function (d, r) {
        if (!d) return;
        s += '<rect class="qd-heat-cell qd-heat-l' + d.level + '" data-date="' + d.date + '" data-n="' + d.answers + '" x="' +
          (c * (cell + gap)) + '" y="' + (top + r * (cell + gap)) + '" width="' + cell + '" height="' + cell +
          '" rx="' + Math.max(2, Math.round(cell / 5)) + '"/>';
      });
    });
    s += '</svg>';
    return { svg: s, labels: labels, width: W, height: H, labelW: labelW };
  }

  /**
   * 習熟度のドーナツ。m は QD_ANALYSIS.mastery の返り値。segments の順（定着→学習中→苦手→未回答）で時計回りに描く。
   * 返り値は SVG の文字列。中央の数字は app.js が HTML で重ねる。
   */
  var DONUT_ORDER = ['mastered', 'learning', 'weak', 'unseen'];
  function donut(m, opts) {
    var size = opts.size || 200, sw = opts.stroke || 18;
    var r = (size - sw) / 2 - 4, c = 2 * Math.PI * r, cx = size / 2;
    var uid = opts.uid || 'dn';
    var s = '<svg class="qd-chart qd-donut" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">';
    s += '<defs>' + glowFilter(uid + '-glow') + '</defs>';
    s += '<circle class="qd-donut-track" cx="' + cx + '" cy="' + cx + '" r="' + r1(r) + '" stroke-width="' + sw + '"/>';
    var total = m.total || 0;
    var offset = 0;
    var gapLen = total > 0 ? Math.min(3, c / 200) : 0;
    DONUT_ORDER.forEach(function (k, i) {
      var v = m[k] || 0;
      if (!total || !v) return;
      var len = (v / total) * c;
      var vis = Math.max(0.5, len - (len > gapLen * 2 ? gapLen : 0));
      s += '<circle class="qd-donut-seg qd-seg--' + k + '" cx="' + cx + '" cy="' + cx + '" r="' + r1(r) + '" stroke-width="' + sw +
        '" stroke-dasharray="' + r1(vis) + ' ' + r1(c) + '" stroke-dashoffset="' + r1(-offset) + '" transform="rotate(-90 ' + cx + ' ' + cx + ')"' +
        (k === 'mastered' ? ' filter="url(#' + uid + '-glow)"' : '') + ' style="--len:' + r1(vis) + ';--c:' + r1(c) + ';--d:' + (i * 180) + 'ms"/>';
      offset += len;
    });
    s += '</svg>';
    return s;
  }

  return {
    esc: esc,
    num: num,
    md: md,
    fixedTicks: fixedTicks,
    smoothPath: smoothPath,
    dualAxis: dualAxis,
    accuracy: accuracy,
    heatmap: heatmap,
    donut: donut,
    DONUT_ORDER: DONUT_ORDER,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QD_CHARTS;
