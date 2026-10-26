/*
 * pour.js — 注ぐ動作の規則（傾き→注ぐ量、高さ・カップの量・勢い→白が浮くか沈むか）
 *
 * 引数だけで答えが決まる純粋な関数だけを置く。センサーの値や時刻は app.js が渡す。
 * 流体の計算（fluid.js）は WebGL に結び付いていてテストできないので、
 * 「どういうときに白が出るか」という肝の規則はこちらに分けてある。
 *
 * 【白が浮くか沈むかの根拠】作者の感覚ではなく、ラテアートの解説に書かれていることに従う
 * （出典は README の「出典」）。
 *   - 高い位置から注ぐと、勢いがついてクレマを突き抜け、潜る。白は出ない
 *   - 注ぎ口を液面ぎりぎりまで下げると、横に流れて泡が表面に乗る。白が出るのはここだけ
 *   - 下げるのはカップが半分〜3/4 入ってから。最初に高く注いで沈めておかないと、
 *     泡がコーヒーと混ざって全体が濁る
 *   - 流量は弱すぎると泡を押し広げられず、強すぎると模様が崩れて沈む
 * 高さはセンサーで測れないので、画面に指を置いているかどうかで表す（app.js）。
 */
var LA_POUR = (function () {
  'use strict';

  /* 傾きの効き方。iPhone をピッチャーに見立て、上の辺を注ぎ口にする。
     構えた角度から手前に倒す（上の辺を下げる）と注げる。
     本物ほど深く倒すと画面が見えなくなるので、浅い角度で満量に届くようにしてある */
  var TILT_DEAD = 6;     // [度] これより浅い傾きでは注がない（手ぶれで垂れないように）
  var TILT_FULL = 32;    // [度] ここまで倒すと最大の量
  var ROLL_FULL = 22;    // [度] 左右にこれだけ傾けると、注ぐ点が最大まで横へ動く
  var ROLL_REACH = 0.18; // そのときの横の動き（カップの直径を1とした割合）

  /* カップの量。エスプレッソが入った状態から始まり、最大の量で注ぎ続けると
     約10秒で満杯になる（実際のラテの注ぎもそのくらい） */
  var FILL_START = 0.35;
  var FILL_PER_SEC = 0.065;

  /* 液面ぎりぎりで注いで白が乗るのは、カップが半分を過ぎてから
     （解説では「半分〜3/4 入ったら注ぎ口を液面に近づける」） */
  var SHALLOW_TO = 0.45;
  var SHALLOW_OK = 0.6;

  /* 勢いの窓。弱すぎると泡を押し広げられず、強すぎると模様を崩して沈める */
  var WEAK_TO = 0.1;
  var WEAK_OK = 0.25;
  var STRONG_FROM = 0.7;
  var STRONG_TO = 0.92;

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /**
   * 前後の傾き（deviceorientation の beta）から注ぐ量（0〜1）。
   * beta0 は構えたときの角度。そこから上の辺を下げる（beta が減る）と注げる。
   */
  function flowFromTilt(beta, beta0) {
    var tip = beta0 - beta;
    return clamp((tip - TILT_DEAD) / (TILT_FULL - TILT_DEAD), 0, 1);
  }

  /** 左右の傾き（gamma）から注ぐ点の横ずれ（カップの直径を1とした割合、右が正） */
  function offsetFromRoll(gamma, gamma0) {
    return clamp((gamma - gamma0) / ROLL_FULL, -1, 1) * ROLL_REACH;
  }

  /** 注いだぶんだけカップの量を増やす。1 で満杯 */
  function nextFill(fill, flow, dt) {
    return clamp(fill + flow * FILL_PER_SEC * dt, 0, 1);
  }

  /** カップの深さの条件（0〜1）。浅いうちは低く注いでも白が乗らない */
  function depthFactor(fill) { return smoothstep(SHALLOW_TO, SHALLOW_OK, fill); }

  /** 勢いの条件（0〜1）。弱すぎても強すぎても白が乗らない */
  function flowFactor(flow) {
    return smoothstep(WEAK_TO, WEAK_OK, flow) * (1 - smoothstep(STRONG_FROM, STRONG_TO, flow));
  }

  /**
   * 注いだミルクのうち、表面に浮いて白くなる割合（0〜1）。
   * low は注ぎ口が液面ぎりぎりにあるか。高い位置からは必ず潜る。
   */
  function floatFactor(fill, flow, low) {
    if (!low) return 0;
    return depthFactor(fill) * flowFactor(flow);
  }

  /**
   * 画面に出す状態。沈んでいるときは、なぜ沈むのかを返す（初心者が直せるように）。
   *   idle: 注いでいない／full: 満杯／float: 白が浮いている
   *   high: 高い位置から注いでいる／shallow: カップがまだ浅い
   *   weak: 勢いが弱い／strong: 勢いが強すぎる
   */
  function phase(fill, flow, low) {
    if (fill >= 1) return 'full';
    if (flow <= 0) return 'idle';
    if (floatFactor(fill, flow, low) >= 0.5) return 'float';
    if (!low) return 'high';
    if (depthFactor(fill) < 0.5) return 'shallow';
    return flow < WEAK_OK ? 'weak' : 'strong';
  }

  return {
    FILL_START: FILL_START,
    clamp: clamp,
    smoothstep: smoothstep,
    flowFromTilt: flowFromTilt,
    offsetFromRoll: offsetFromRoll,
    nextFill: nextFill,
    floatFactor: floatFactor,
    phase: phase,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LA_POUR;
