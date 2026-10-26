/*
 * pour.js — 注ぐ動作の規則（傾き→注ぐ量、カップの量→白が浮くか沈むか）
 *
 * 引数だけで答えが決まる純粋な関数だけを置く。センサーの値や時刻は app.js が渡す。
 * 流体の計算（fluid.js）は WebGL に結び付いていてテストできないので、
 * 「どういうときに白が出るか」という肝の規則はこちらに分けてある。
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

  /* 白が浮き始めるカップの量。実際の注ぎ方では、液面が注ぎ口に近づくと
     泡がクレマの上に乗る。高さはセンサーで測れないので、カップの量で代わりにする */
  var FLOAT_FROM = 0.55;
  var FLOAT_FULL = 0.72;

  /* 細い注ぎは泡を運べず、クレマの下に潜る（最後の「切り抜き」がこれ） */
  var STREAM_FROM = 0.2;
  var STREAM_FULL = 0.5;

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

  /**
   * 注いだミルクのうち、表面に浮いて白くなる割合（0〜1）。
   * カップが満ちていて、かつ注ぐ勢いがあるときだけ浮く。
   */
  function floatFactor(fill, flow) {
    return smoothstep(FLOAT_FROM, FLOAT_FULL, fill) * smoothstep(STREAM_FROM, STREAM_FULL, flow);
  }

  /** 画面に出す状態 */
  function phase(fill, flow) {
    if (fill >= 1) return 'full';
    if (flow <= 0) return 'idle';
    return floatFactor(fill, flow) >= 0.5 ? 'float' : 'sink';
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
