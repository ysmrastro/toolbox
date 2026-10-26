/*
 * app.js — 入力（センサー・指・マウス）と画面。流体は fluid.js、規則は pour.js にある
 *
 * 操作は2通り。
 *   傾けて注ぐ（iPhone）: 構えた角度から手前に倒すと注げる。左右に傾けると注ぐ点が横に動く
 *                         （ウィグル）。注ぐ点の起点は指でカップを触って動かす
 *   押して注ぐ（PC・確認用）: 押しているあいだ、指やマウスの位置に注ぐ
 */
(function () {
  'use strict';

  var POUR = LA_POUR;
  var $ = function (id) { return document.getElementById(id); };

  /* 流れの強さの調整値。画面で見ながら決めたもの（物理量ではない）。
     window.LATTE.tune から書き換えて見比べられる */
  var T = {
    SOURCE: 14,         // 湧き出しの強さ [1/秒]（注ぐ量 1・白が浮いているとき）
    SOURCE_SUNK: 0.35,  // 沈んでいるあいだの湧き出しの割合（潜ったぶん表面は動きにくい）
    DRAG: 0.1,          // 注ぐ点の動きに液面が引きずられる割合
    /* 引きずる速さの上限 [uv/秒]。強く引きずると液面全体が渦を巻いて、描いた白がまるごと
       押し流される（細い流れが一本の筋を引く、という本物の切り抜きにならない） */
    MOVE_MAX: 0.8,
    /* 注ぎ口の向き（画面の奥）へ流れが持つ勢い [uv/秒]。白を奥へ運んでロゼッタの葉を
       積ませる狙いで入れたが、カップ全体に大きな渦が1組できて模様が流れるだけだったので
       0 にしてある（README の「ロゼッタが描けない」） */
    JET: 0,
    /* 注ぐ点が速く動いているあいだは流れが液面に潜り、泡ではなく下の茶色い液が湧き上がる
       [uv/秒]。揺らしたときに葉と葉の間へ茶色の筋を挟む狙い。まだ葉は分かれていない */
    DIVE_SPEED: 0.6,
    FOAM: 1.2,          // 注ぐ点で落ち着く泡の厚み（0.5 あたりから白く見える）
    RADIUS_MIN: 0.016,  // 注ぐ流れの太さ（注ぐ量 0〜1 で変わる）
    RADIUS_MAX: 0.034,
  };

  var canvas = $('cup');
  var sim = null;
  try {
    sim = LA_FLUID.create(canvas);
  } catch (e) {
    console.error(e);
  }
  if (!sim) {
    $('unsupported').hidden = false;
    return;
  }

  var state = {
    mode: 'pointer',        // 'pointer' | 'sensor'
    fill: POUR.FILL_START,
    flow: 0,
    pressing: false,        // 押して注ぐ: 押しているか
    pointer: { x: 0.5, y: 0.5 },
    base: { x: 0.5, y: 0.5 },   // 傾けて注ぐ: 注ぐ点の起点
    beta: null, gamma: null,
    beta0: null, gamma0: null,
    last: null,             // 前のフレームの注ぐ点（動いた速さを出すため）
    move: { x: 0, y: 0 },
  };

  /* ===================== キャンバスの大きさ ===================== */

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var size = Math.round(canvas.clientWidth * dpr);
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  }
  window.addEventListener('resize', resize);
  resize();

  /* ===================== 指・マウス ===================== */

  function toUv(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height };
  }

  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    var p = toUv(e);
    if (state.mode === 'sensor') { state.base = p; return; }
    state.pressing = true;
    state.pointer = p;
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = toUv(e);
    if (state.mode === 'sensor') {
      if (e.buttons || e.pointerType === 'touch') state.base = p;
      return;
    }
    state.pointer = p;
  });
  function release() { state.pressing = false; }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  /* ===================== 傾き ===================== */

  function onOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    state.beta = e.beta;
    state.gamma = e.gamma;
    if (state.beta0 == null) calibrate();
  }

  /** いまの構えを「注いでいない角度」にする */
  function calibrate() {
    state.beta0 = state.beta;
    state.gamma0 = state.gamma;
  }

  async function startSensor() {
    try {
      // iOS は許可が要る。ボタンを押した処理の中で呼ばないと断られる
      if (typeof DeviceOrientationEvent !== 'undefined'
        && typeof DeviceOrientationEvent.requestPermission === 'function') {
        var res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') {
          showMessage('傾きセンサーの使用が許可されませんでした。押して注ぐ操作は使えます。');
          return;
        }
      }
    } catch (err) {
      showMessage('傾きセンサーを使えませんでした（' + err.message + '）。');
      return;
    }
    window.addEventListener('deviceorientation', onOrientation);
    state.mode = 'sensor';
    state.beta0 = null;
    document.body.classList.add('is-sensor');
    showMessage('構えた角度を基準にしました。手前に倒すと注げます。');
    // しばらく値が来なければ、センサーの無い端末と判断する
    setTimeout(function () {
      if (state.mode === 'sensor' && state.beta == null) {
        showMessage('傾きの値が届きません。この端末では押して注ぐ操作を使ってください。');
        stopSensor();
      }
    }, 1500);
  }

  function stopSensor() {
    window.removeEventListener('deviceorientation', onOrientation);
    state.mode = 'pointer';
    document.body.classList.remove('is-sensor');
  }

  function showMessage(text) { $('message').textContent = text; }

  /* ===================== 1フレーム ===================== */

  /**
   * 入力から、このフレームの注ぐ点と量を決める。
   * 返り値は { x, y, flow }。注いでいなければ flow は 0
   */
  function readInput() {
    if (state.mode === 'sensor') {
      if (state.beta == null || state.beta0 == null) return { x: state.base.x, y: state.base.y, flow: 0 };
      var dx = POUR.offsetFromRoll(state.gamma, state.gamma0) * 2 * LA_FLUID.CUP_R;
      return {
        x: state.base.x + dx,
        y: state.base.y,
        flow: POUR.flowFromTilt(state.beta, state.beta0),
      };
    }
    return {
      x: state.pointer.x,
      y: state.pointer.y,
      flow: state.pressing ? Number($('flowSlider').value) / 100 : 0,
    };
  }

  function advance(dt, input) {
    var flow = state.fill >= 1 ? 0 : input.flow;
    state.flow = flow;

    // 注ぐ点の動き。指の飛びで暴れないよう、少しならしてから使う
    if (state.last && flow > 0) {
      var k = Math.min(1, dt * 20);
      state.move.x += ((input.x - state.last.x) / dt - state.move.x) * k;
      state.move.y += ((input.y - state.last.y) / dt - state.move.y) * k;
      var sp = Math.hypot(state.move.x, state.move.y);
      if (!isFinite(sp)) { state.move.x = 0; state.move.y = 0; }   // 念のため（NaN を流れに入れない）
      else if (sp > T.MOVE_MAX) { state.move.x *= T.MOVE_MAX / sp; state.move.y *= T.MOVE_MAX / sp; }
    } else {
      state.move.x = 0; state.move.y = 0;
    }
    state.last = { x: input.x, y: input.y };

    var pour = null;
    if (flow > 0) {
      var speed = Math.hypot(state.move.x, state.move.y);
      var floatF = POUR.floatFactor(state.fill, flow);
      var fl = floatF / (1 + Math.pow(speed / T.DIVE_SPEED, 2));
      // 液面を押す強さは潜りに左右されない（注いだ量はどのみち液面を押し上げる）
      var source = T.SOURCE * flow * (T.SOURCE_SUNK + (1 - T.SOURCE_SUNK) * floatF);
      pour = {
        x: input.x, y: input.y,
        radius: T.RADIUS_MIN + (T.RADIUS_MAX - T.RADIUS_MIN) * flow,
        source: source,
        // 注ぐ点に湧き上がるものの泡の厚み。入れ替わる速さは湧き出しに比例させる
        white: fl * T.FOAM,
        rate: source * dt,
        sunk: Math.min(1, (1 - fl) * flow * 4 * dt),
        mx: state.move.x * T.DRAG, my: state.move.y * T.DRAG + T.JET * flow * fl,
      };
    }
    sim.step(dt, pour);
    state.fill = POUR.nextFill(state.fill, flow, dt);
    if (debug) debugNote(dt, pour);
  }

  /* ===================== 診断表示（URL に ?debug） =====================
   * 実機でだけ起きる不具合を、画面のスクリーンショットから追えるようにする。
   * 流れと泡の値は GPU から読み戻すので重い。0.5秒ごとにだけ読む */
  var debug = /[?&]debug/.test(location.search);
  var dbg = { minDt: Infinity, maxDt: 0, frames: 0, probe: null, at: 0, pour: null };

  function debugNote(dt, pour) {
    dbg.frames++;
    dbg.minDt = Math.min(dbg.minDt, dt);
    dbg.maxDt = Math.max(dbg.maxDt, dt);
    dbg.pour = pour;
    var now = performance.now();
    if (now - dbg.at > 500) { dbg.at = now; dbg.probe = sim.probe(); }
  }

  function debugText() {
    var f = function (x, n) { return x == null ? '—' : Number(x).toFixed(n == null ? 3 : n); };
    var p = dbg.pour, q = dbg.probe || {};
    return [
      'frames ' + dbg.frames + ' / dt ' + f(dbg.minDt * 1000, 1) + '〜' + f(dbg.maxDt * 1000, 1) + 'ms',
      'pour ' + (p ? 'x ' + f(p.x) + ' y ' + f(p.y) + ' src ' + f(p.source, 2) + ' white ' + f(p.white, 2) +
        ' rate ' + f(p.rate) + ' m ' + f(p.mx, 2) + ',' + f(p.my, 2) : 'なし'),
      '流れ 最大 ' + f(q.vmax) + ' NaN ' + (q.vnan == null ? '—' : q.vnan) +
        '／泡 最大 ' + f(q.rmax, 2) + ' NaN ' + (q.rnan == null ? '—' : q.rnan) +
        (q.error ? '／' + q.error : ''),
      'gl ' + sim.info(),
    ].join('\n');
  }

  var PHASE_TEXT = {
    idle: '注いでいません',
    sink: '沈んでいる（クレマの下に潜っている）',
    float: '浮いている（白が表に出る）',
    full: '満杯です。「作り直す」でもう一杯',
  };

  function updateHud() {
    $('fillBar').style.width = (state.fill * 100).toFixed(1) + '%';
    $('flowBar').style.width = (state.flow * 100).toFixed(1) + '%';
    var ph = POUR.phase(state.fill, state.flow);
    $('phase').textContent = PHASE_TEXT[ph];
    $('phase').dataset.phase = ph;
    if (state.mode === 'sensor' && state.beta != null && state.beta0 != null) {
      $('tilt').textContent = '倒した角度 ' + Math.round(state.beta0 - state.beta) + '°／左右 ' +
        Math.round(state.gamma - state.gamma0) + '°';
    } else {
      $('tilt').textContent = '';
    }
    if (debug) $('debug').textContent = debugText();
  }

  var prevT = null;
  var paused = false;
  function frame(t) {
    if (!paused) {
      var dt = prevT == null ? 1 / 60 : Math.min((t - prevT) / 1000, 1 / 30);
      /* iOS では前のフレームと同じ時刻が来ることがある。dt が 0 だと注ぐ点の速さが
         0÷0 になり、NaN が流れに入ってそれ以降の計算がすべて止まる */
      if (dt > 0) {
        advance(dt, readInput());
        sim.render();
        updateHud();
      }
    }
    prevT = t;
    requestAnimationFrame(frame);
  }

  function reset() {
    state.fill = POUR.FILL_START;
    state.flow = 0;
    state.last = null;
    sim.reset();
  }

  $('btnSensor').addEventListener('click', startSensor);
  $('btnCalibrate').addEventListener('click', function () {
    calibrate();
    showMessage('いまの構えを基準にしました。');
  });
  $('btnReset').addEventListener('click', reset);

  /* 自動テストと OGP 画像の生成用。入力を決めてフレームを進める。
     fn(i) は i フレーム目の { x, y, flow } を返す。描画は最後に1回だけ */
  window.LATTE = {
    drive: function (frames, fn) {
      paused = true;
      for (var i = 0; i < frames; i++) advance(1 / 60, fn(i));
      sim.render();
      updateHud();
    },
    reset: function (seed) { reset(); sim.reset(seed); },
    resume: function () { paused = false; },
    state: state,
    tune: T,
  };

  requestAnimationFrame(frame);
})();
