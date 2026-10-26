/*
 * fluid.js — カップの液面の2次元流体（Stable Fluids を WebGL2 で）
 *
 * 【何を解いているか】
 * 上から見たカップの液面の流れ（速度場）と、液面に乗っているものの濃さ（染料）。
 * 染料のチャンネルは次のとおり。
 *   R: 表面に浮いた泡の厚み（濃さではなく量。0.5 あたりで白く見え始める）
 *   G: クレマのまだら模様（初期化時に置き、流れで一緒に動く）
 *   B: クレマの下に沈んだミルクでクレマが明るくなった度合い
 *
 * 【ふつうの Stable Fluids と違うところ】
 * 注ぐ点を「湧き出し口」として扱う。非圧縮の射影をそのままかけると、外へ広がる流れ
 * （発散する成分）がすべて消され、注いでも白が広がらない。ミルクを足せば液面は
 * 注ぐ点から外へ押し広げられるので、発散の目標値を注ぐ点で正にして解く。
 * 閉じたカップでは湧き出しの合計が0でないと解が無いので、同じ量をカップ全体から
 * 一様に吸い込ませる（足したぶんだけ液面が上がり、表面は下へ逃げていく、の近似）。
 *
 * 【泡は厚みとして運ぶ】
 * 白を「濃さ」として運ぶと、液面が引き伸ばされても薄くならない。本物の泡は量なので、
 * 注ぐ点のまわりで液面が広がると薄く伸び、下のクレマが透ける。ロゼッタの葉と葉の間の
 * 茶色い筋はこれでできる（揺らすたびに置かれる泡の量が波打ち、薄いところが透ける）。
 * そこで R だけは、運ぶときに発散ぶん（液面の伸び）だけ薄める。
 *
 * 単位: 座標はキャンバスの uv（0〜1）。速度は uv/秒。
 */
var LA_FLUID = (function () {
  'use strict';

  var CUP_R = 0.44;          // カップの内側の半径（uv）
  var SIM_RES = 192;         // 速度場の格子
  var DYE_RES = 512;         // 染料の格子（模様の細かさはこちらで決まる）
  var PRESSURE_ITERS = 30;
  var VEL_DAMP = 0.6;        // 速度の減衰 [1/秒]。注ぐのをやめると流れが落ち着く

  var VERT = [
    '#version 300 es',
    'in vec2 aPos;',
    'out vec2 vUv;',
    'void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }',
  ].join('\n');

  var HEAD = [
    '#version 300 es',
    'precision highp float;',
    'precision highp sampler2D;',
    'in vec2 vUv;',
    'out vec4 o;',
    'uniform vec2 uTexel;',
    'const float CUP_R = ' + CUP_R.toFixed(4) + ';',
    'bool inCup(vec2 p) { return distance(p, vec2(0.5)) < CUP_R; }',
    '',
  ].join('\n');

  var SHADERS = {
    /* 流れに沿って運ぶ（semi-Lagrangian）。uMask が立っていればカップの外を0にする */
    advect: HEAD + [
      'uniform sampler2D uVel; uniform sampler2D uSrc;',
      'uniform float uDt; uniform float uDecay; uniform float uMask;',
      'void main() {',
      '  vec2 v = texture(uVel, vUv).xy;',
      '  vec4 r = texture(uSrc, vUv - uDt * v) * uDecay;',
      '  if (uMask > 0.5 && !inCup(vUv)) r = vec4(0.0);',
      '  o = r;',
      '}',
    ].join('\n'),

    /* 染料を運ぶ。泡の厚み（R）は液面の伸び（発散）のぶんだけ薄める。
       発散は射影でそろえた目標値（注ぐ点の湧き出し − 全体の吸い込み）をそのまま使う */
    advectDye: HEAD + [
      'uniform sampler2D uVel; uniform sampler2D uSrc; uniform float uDt;',
      'uniform vec2 uPoint; uniform float uRadius; uniform float uSource;',
      'void main() {',
      '  vec2 v = texture(uVel, vUv).xy;',
      '  vec4 r = texture(uSrc, vUv - uDt * v);',
      '  vec2 d = vUv - uPoint;',
      '  float g = exp(-dot(d, d) / (uRadius * uRadius));',
      '  float div = uSource * (g - (uRadius * uRadius) / (CUP_R * CUP_R));',
      '  r.r *= exp(-div * uDt);',
      '  o = r;',
      '}',
    ].join('\n'),

    /* 発散。カップの外（壁）の速度は0として数える。
       注ぐ点の湧き出し uSource を差し引き、射影後の発散がその値になるようにする */
    divergence: HEAD + [
      'uniform sampler2D uVel;',
      'uniform vec2 uPoint; uniform float uRadius; uniform float uSource;',
      'vec2 V(vec2 p) { return inCup(p) ? texture(uVel, p).xy : vec2(0.0); }',
      'void main() {',
      '  float h = uTexel.x;',
      '  float L = V(vUv - vec2(h, 0.0)).x, R = V(vUv + vec2(h, 0.0)).x;',
      '  float B = V(vUv - vec2(0.0, h)).y, T = V(vUv + vec2(0.0, h)).y;',
      '  float div = 0.5 * (R - L + T - B) / h;',
      '  vec2 d = vUv - uPoint;',
      '  float g = exp(-dot(d, d) / (uRadius * uRadius));',
      // 湧き出しの合計を0にするため、同じ量をカップ全体から一様に吸い込む
      '  float mean = (uRadius * uRadius) / (CUP_R * CUP_R);',
      '  float target = inCup(vUv) ? uSource * (g - mean) : 0.0;',
      '  o = vec4(div - target, 0.0, 0.0, 1.0);',
      '}',
    ].join('\n'),

    /* 圧力のヤコビ反復。壁の外は中の値をそのまま使う（法線方向の勾配0） */
    pressure: HEAD + [
      'uniform sampler2D uP; uniform sampler2D uDiv;',
      'float P(vec2 p, float c) { return inCup(p) ? texture(uP, p).x : c; }',
      'void main() {',
      '  float h = uTexel.x;',
      '  float c = texture(uP, vUv).x;',
      '  float s = P(vUv - vec2(h, 0.0), c) + P(vUv + vec2(h, 0.0), c)',
      '          + P(vUv - vec2(0.0, h), c) + P(vUv + vec2(0.0, h), c);',
      '  o = vec4((s - h * h * texture(uDiv, vUv).x) * 0.25, 0.0, 0.0, 1.0);',
      '}',
    ].join('\n'),

    /* 圧力の勾配を引いて、発散を目標値にそろえる */
    gradient: HEAD + [
      'uniform sampler2D uP; uniform sampler2D uVel;',
      'float P(vec2 p, float c) { return inCup(p) ? texture(uP, p).x : c; }',
      'void main() {',
      '  float h = uTexel.x;',
      '  float c = texture(uP, vUv).x;',
      '  vec2 g = 0.5 * vec2(P(vUv + vec2(h, 0.0), c) - P(vUv - vec2(h, 0.0), c),',
      '                      P(vUv + vec2(0.0, h), c) - P(vUv - vec2(0.0, h), c)) / h;',
      '  vec2 v = texture(uVel, vUv).xy - g;',
      '  o = vec4(inCup(vUv) ? v : vec2(0.0), 0.0, 1.0);',
      '}',
    ].join('\n'),

    /* 定数倍（前のフレームの圧力を初期値に使うときに少し弱める） */
    scale: HEAD + [
      'uniform sampler2D uSrc; uniform float uK;',
      'void main() { o = texture(uSrc, vUv) * uK; }',
    ].join('\n'),

    /* 注ぐ点が動いた向きに液面を引きずる */
    splatVel: HEAD + [
      'uniform sampler2D uSrc;',
      'uniform vec2 uPoint; uniform float uRadius; uniform vec2 uMove;',
      'void main() {',
      '  vec2 d = vUv - uPoint;',
      '  float g = exp(-dot(d, d) / (uRadius * uRadius));',
      '  vec2 v = texture(uSrc, vUv).xy + uMove * g;',
      '  o = vec4(inCup(vUv) ? v : vec2(0.0), 0.0, 1.0);',
      '}',
    ].join('\n'),

    /* 注ぐ点の真下を、湧き上がってくるものに置き換える。
       白が浮いているときは泡（厚み uWhite）、潜っているときは下の茶色い液（厚み0）。
       足すだけにすると、潜った瞬間に茶色が出ず、葉と葉の間に筋が挟まらない */
    splatDye: HEAD + [
      'uniform sampler2D uSrc;',
      'uniform vec2 uPoint; uniform float uRadius;',
      'uniform float uWhite; uniform float uRate; uniform float uSunk;',
      'void main() {',
      '  vec4 c = texture(uSrc, vUv);',
      '  vec2 d = vUv - uPoint;',
      '  float g = exp(-dot(d, d) / (uRadius * uRadius));',
      '  c.r = mix(c.r, uWhite, clamp(uRate * g, 0.0, 1.0));',
      '  c.b = mix(c.b, 1.0, clamp(uSunk * g, 0.0, 1.0));',
      '  o = c;',
      '}',
    ].join('\n'),

    /* 作り直したときのカップ。クレマのまだらを G に置く */
    init: HEAD + [
      'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'float noise(vec2 p) {',
      '  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),',
      '             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);',
      '}',
      'uniform float uSeed;',
      'void main() {',
      '  vec2 p = vUv + uSeed;',
      '  float n = 0.55 * noise(p * 7.0) + 0.3 * noise(p * 19.0) + 0.15 * noise(p * 53.0);',
      '  o = vec4(0.0, n, 0.0, 1.0);',
      '}',
    ].join('\n'),

    /* 画面への描画。カップの縁・クレマ・ミルクの色をここで決める */
    display: HEAD + [
      'uniform sampler2D uDye;',
      'uniform float uAspect;',
      'void main() {',
      '  vec2 p = vUv - 0.5;',
      '  float r = length(p);',
      '  float aa = 1.5 / 600.0;',
      '  vec4 d = texture(uDye, vUv);',
      // クレマ: 縁ほど濃く、まだら模様で揺らぐ。沈んだミルクで明るくなる
      '  float rim = smoothstep(CUP_R * 0.45, CUP_R, r);',
      '  vec3 crema = mix(vec3(0.66, 0.42, 0.21), vec3(0.33, 0.17, 0.07),',
      '                   clamp(rim * 0.85 + (d.g - 0.5) * 0.55, 0.0, 1.0));',
      '  crema = mix(crema, vec3(0.80, 0.62, 0.42), clamp(d.b, 0.0, 1.0) * 0.55);',
      // ミルク: 泡の境目はくっきりしているので、白さを急な段差に変える
      '  float w = smoothstep(0.30, 0.52, d.r);',
      '  vec3 edge = vec3(0.86, 0.74, 0.58);',
      '  vec3 col = mix(crema, edge, smoothstep(0.06, 0.30, d.r) * 0.55);',
      '  col = mix(col, vec3(0.98, 0.96, 0.91), w);',
      // 縁の内側の影
      '  col *= 1.0 - 0.28 * smoothstep(CUP_R - 0.035, CUP_R, r);',
      // カップの縁（陶器）とソーサー
      '  float lip = CUP_R + 0.035;',
      '  vec3 cup = vec3(0.95, 0.94, 0.92) * (0.82 + 0.18 * (0.5 - p.y));',
      '  vec3 saucer = vec3(0.86, 0.85, 0.83) * (0.70 + 0.2 * (0.5 - p.y));',
      '  vec3 table = vec3(0.12, 0.10, 0.09);',
      '  vec3 outer = mix(saucer, table, smoothstep(0.495 - aa, 0.495 + aa, r));',
      '  outer = mix(cup, outer, smoothstep(lip - aa, lip + aa, r));',
      '  col = mix(col, outer, smoothstep(CUP_R - aa, CUP_R + aa, r));',
      '  o = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  };

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('シェーダのコンパイルに失敗: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  function program(gl, vs, fsSrc) {
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('シェーダのリンクに失敗: ' + gl.getProgramInfoLog(p));
    }
    var uniforms = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var name = gl.getActiveUniform(p, i).name;
      uniforms[name] = gl.getUniformLocation(p, name);
    }
    return { prog: p, u: uniforms };
  }

  /**
   * キャンバスに流体を用意する。WebGL2 か、浮動小数のテクスチャへの描画が
   * 使えなければ null を返す（app.js が案内を出す）。
   */
  function create(canvas) {
    var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
    if (!gl) return null;
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      return null;
    }

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var P = {};
    Object.keys(SHADERS).forEach(function (k) { P[k] = program(gl, vs, SHADERS[k]); });

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    function target(res) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, res, res, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex: tex, fbo: fbo, res: res };
    }

    /* 読む側と書く側を入れ替えながら使う組 */
    function pingpong(res) {
      var a = target(res), b = target(res);
      return {
        get read() { return a; },
        get write() { return b; },
        swap: function () { var t = a; a = b; b = t; },
        res: res,
      };
    }

    var vel = pingpong(SIM_RES);
    var dye = pingpong(DYE_RES);
    var prs = pingpong(SIM_RES);
    var div = target(SIM_RES);

    gl.bindFramebuffer(gl.FRAMEBUFFER, vel.read.fbo);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;

    var unit = 0;
    function use(p, res) {
      gl.useProgram(p.prog);
      unit = 0;
      if (p.u.uTexel) gl.uniform2f(p.u.uTexel, 1 / res, 1 / res);
    }
    function tex(p, name, t) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(p.u[name], unit);
      unit++;
    }
    function draw(dst) {
      if (dst) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, dst.res, dst.res);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function clear(t) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    function reset(seed) {
      clear(vel.read); clear(vel.write);
      clear(prs.read); clear(prs.write);
      var p = P.init;
      use(p, DYE_RES);
      gl.uniform1f(p.u.uSeed, seed == null ? Math.random() * 100 : seed);
      draw(dye.write); dye.swap();
    }

    /**
     * 1ステップ進める。pour は注いでいなければ null。
     *   x, y     : 注ぐ点（uv、y は上が正）
     *   source   : 湧き出しの強さ [1/秒]
     *   radius   : 注ぐ流れの太さ（uv）
     *   white    : 注ぐ点に湧き上がる泡の厚み（潜っていれば0）
     *   rate     : このステップで注ぐ点の中身が入れ替わる割合
     *   sunk     : 沈んだミルクでクレマを明るくする強さ（0〜1／ステップ）
     *   mx, my   : 注ぐ点のまわりの液面に足す速さ（uv/秒）。注ぐ点の動きと注ぎ口の向き
     */
    function step(dt, pour) {
      var p;

      /* 速度を運ぶ（減衰つき） */
      p = P.advect; use(p, SIM_RES);
      tex(p, 'uVel', vel.read); tex(p, 'uSrc', vel.read);
      gl.uniform1f(p.u.uDt, dt);
      gl.uniform1f(p.u.uDecay, 1 / (1 + VEL_DAMP * dt));
      gl.uniform1f(p.u.uMask, 1);
      draw(vel.write); vel.swap();

      /* 注ぐ点の動きと注ぎ口の向きで、まわりの液面を押す */
      if (pour && (pour.mx || pour.my)) {
        p = P.splatVel; use(p, SIM_RES);
        tex(p, 'uSrc', vel.read);
        gl.uniform2f(p.u.uPoint, pour.x, pour.y);
        gl.uniform1f(p.u.uRadius, pour.radius);
        gl.uniform2f(p.u.uMove, pour.mx, pour.my);
        draw(vel.write); vel.swap();
      }

      /* 射影（注ぐ点だけ発散を残す） */
      p = P.divergence; use(p, SIM_RES);
      tex(p, 'uVel', vel.read);
      gl.uniform2f(p.u.uPoint, pour ? pour.x : 0.5, pour ? pour.y : 0.5);
      gl.uniform1f(p.u.uRadius, pour ? pour.radius : 0.05);
      gl.uniform1f(p.u.uSource, pour ? pour.source : 0);
      draw(div);

      p = P.scale; use(p, SIM_RES);
      tex(p, 'uSrc', prs.read);
      gl.uniform1f(p.u.uK, 0.8);
      draw(prs.write); prs.swap();

      p = P.pressure; use(p, SIM_RES);
      for (var i = 0; i < PRESSURE_ITERS; i++) {
        unit = 0;
        tex(p, 'uP', prs.read); tex(p, 'uDiv', div);
        draw(prs.write); prs.swap();
      }

      p = P.gradient; use(p, SIM_RES);
      tex(p, 'uP', prs.read); tex(p, 'uVel', vel.read);
      draw(vel.write); vel.swap();

      /* 染料を運ぶ（減衰なし。描いた模様は残る） */
      p = P.advectDye; use(p, DYE_RES);
      tex(p, 'uVel', vel.read); tex(p, 'uSrc', dye.read);
      gl.uniform1f(p.u.uDt, dt);
      gl.uniform2f(p.u.uPoint, pour ? pour.x : 0.5, pour ? pour.y : 0.5);
      gl.uniform1f(p.u.uRadius, pour ? pour.radius : 0.05);
      gl.uniform1f(p.u.uSource, pour ? pour.source : 0);
      draw(dye.write); dye.swap();

      /* 注いだミルクを置く */
      if (pour) {
        p = P.splatDye; use(p, DYE_RES);
        tex(p, 'uSrc', dye.read);
        gl.uniform2f(p.u.uPoint, pour.x, pour.y);
        gl.uniform1f(p.u.uRadius, pour.radius);
        gl.uniform1f(p.u.uWhite, pour.white);
        gl.uniform1f(p.u.uRate, pour.rate);
        gl.uniform1f(p.u.uSunk, pour.sunk);
        draw(dye.write); dye.swap();
      }
    }

    function render() {
      var p = P.display; use(p, DYE_RES);
      tex(p, 'uDye', dye.read);
      draw(null);
    }

    reset();
    return { step: step, render: render, reset: reset, CUP_R: CUP_R };
  }

  return { create: create, CUP_R: CUP_R };
})();
