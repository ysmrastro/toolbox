"use strict";

/* ============================================================
   モデル
   月齢 age（0〜SYN日）から、角度 phi（0〜2π、新月=0）を作る。
   phi はそのまま「北極から見た軌道上の角度」であり、同時に
   「太陽・地球・月」のなす角（離角 E）でもある ── 太陽は無限遠にあるとみなし、
   常に地球から見て -x 方向（左）から来る光として扱っているため。
   モデルの詳細は README を参照。
   ============================================================ */
const SYN = 29.5306;                 // 朔望月（日）
const TWO_PI = Math.PI * 2;

const ageToPhi = age => (age / SYN) * TWO_PI;
const phiToAge = phi => (phi / TWO_PI) * SYN;
const normPhi = phi => ((phi % TWO_PI) + TWO_PI) % TWO_PI;
const normAge = age => ((age % SYN) + SYN) % SYN;

/* 名前を出す月齢の代表値。表示名は円環距離がいちばん近いものを採用し、
   離れていたら「満ちていく／欠けていく」の一般表現にする。 */
const NAMED_PHASES = [
  { age: 0,          html: '<ruby>新月<rt>しんげつ</rt></ruby>' },
  { age: 3,           html: '<ruby>三日月<rt>みかづき</rt></ruby>' },
  { age: SYN / 4,     html: '<ruby>上弦<rt>じょうげん</rt></ruby>の<ruby>月<rt>つき</rt></ruby>' },
  { age: SYN / 2,     html: '<ruby>満月<rt>まんげつ</rt></ruby>' },
  { age: SYN * 3 / 4, html: '<ruby>下弦<rt>かげん</rt></ruby>の<ruby>月<rt>つき</rt></ruby>' }
];
const NAME_WINDOW = 1.0;   // この日数以内なら、近い名前を採用する

function circularDist(a, b) {
  const d = Math.abs(normAge(a) - normAge(b));
  return Math.min(d, SYN - d);
}

function phaseName(age) {
  let best = null, bestD = Infinity;
  for (const p of NAMED_PHASES) {
    const d = circularDist(age, p.age);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (bestD <= NAME_WINDOW) return best.html;
  return age < SYN / 2 ? 'だんだん ふとる' : 'だんだん やせる';
}

/* ============================================================
   SVG 組み立て
   ============================================================ */
const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

// 円を「太陽側（左）」「その裏（右）」の半円2枚に分けたパス。
// top→bottom の向きに弧を描き、side='left' なら左に、'right' なら右に張り出す。
function halfDiskPath(cx, cy, r, side) {
  const sweep = side === 'right' ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${sweep} ${cx} ${cy + r} Z`;
}

// 地球から見た月の形。phi=0 が新月、反時計回りに満ちていく（右から光る）。
// 外周（月の縁そのもの）は常に真円の半分、内側（明暗の境界＝ターミネーター）は
// 半径 |r*cos(phi)| の半楕円 ── 弦の合成で三日月〜満月〜有明月をひと続きに表せる。
function moonShapePath(cx, cy, r, phi) {
  const p = normPhi(phi);
  const waxing = p < Math.PI;                 // 新月→満月は右から満ちる
  const outerSweep = waxing ? 1 : 0;
  const a = waxing ? r * Math.cos(p) : -r * Math.cos(p);
  const rx = Math.abs(a);
  const innerSweep = a >= 0 ? 0 : 1;
  const top = `${cx} ${cy - r}`, bottom = `${cx} ${cy + r}`;
  return `M ${top} A ${r} ${r} 0 0 ${outerSweep} ${bottom} A ${rx} ${r} 0 0 ${innerSweep} ${top} Z`;
}

/* ---- 軌道図（北極から見下ろした図） ---- */
const orbitSvg = document.getElementById('mp-orbit');
const ORBIT_CX = 230, ORBIT_CY = 200, ORBIT_R = 130;
const EARTH_R = 42, MOON_R = 16;

let moonGroup, moonHit;

function buildOrbitScene() {
  // 太陽（左端。半分だけ見えている円）と、右向きの光の矢印
  const sun = el('circle', { cx: 0, cy: ORBIT_CY, r: 34, fill: 'var(--mp-sun)' });
  orbitSvg.appendChild(sun);
  const rayYs = [ORBIT_CY - 120, ORBIT_CY - 60, ORBIT_CY, ORBIT_CY + 60, ORBIT_CY + 120];
  const rays = el('g', { stroke: 'var(--mp-sun)', 'stroke-width': 2, opacity: 0.8 });
  for (const y of rayYs) {
    rays.appendChild(el('line', { x1: 40, y1: y, x2: 92, y2: y }));
    rays.appendChild(el('polygon', { points: `92,${y - 5} 100,${y} 92,${y + 5}`, fill: 'var(--mp-sun)', stroke: 'none' }));
  }
  orbitSvg.appendChild(rays);

  // 月の軌道（破線）
  orbitSvg.appendChild(el('circle', {
    cx: ORBIT_CX, cy: ORBIT_CY, r: ORBIT_R, fill: 'none',
    stroke: 'var(--mp-subtext)', 'stroke-width': 2, 'stroke-dasharray': '6 6', opacity: 0.6
  }));

  // 地球（太陽側＝左半分が明るい。中心に北極の点）
  const earth = el('g');
  earth.appendChild(el('path', { d: halfDiskPath(ORBIT_CX, ORBIT_CY, EARTH_R, 'left'), fill: 'var(--mp-primary)' }));
  earth.appendChild(el('path', { d: halfDiskPath(ORBIT_CX, ORBIT_CY, EARTH_R, 'right'), fill: 'var(--mp-earth-dark)' }));
  earth.appendChild(el('circle', { cx: ORBIT_CX, cy: ORBIT_CY, r: EARTH_R, fill: 'none', stroke: 'var(--tb-border)', 'stroke-width': 1.5 }));
  earth.appendChild(el('circle', { cx: ORBIT_CX, cy: ORBIT_CY, r: 4, fill: '#fff' }));  // 北極
  orbitSvg.appendChild(earth);

  // 月（つかんで動かす方）。形は常に「太陽側＝左半分だけ明るい」固定で、位置だけ動く
  moonGroup = el('g', { id: 'mp-moon' });
  moonGroup.appendChild(el('path', { d: halfDiskPath(0, 0, MOON_R, 'left'), fill: 'var(--mp-moon-lit)' }));
  moonGroup.appendChild(el('path', { d: halfDiskPath(0, 0, MOON_R, 'right'), fill: 'var(--mp-moon-dark)' }));
  moonGroup.appendChild(el('circle', { cx: 0, cy: 0, r: MOON_R, fill: 'none', stroke: 'var(--tb-border)', 'stroke-width': 1 }));
  // あたり判定は絵の上に重ねる。fill:transparent は「塗られていない」扱いでヒットしない
  // ブラウザがあるため、pointer-events で明示的に強制する
  moonHit = el('circle', { id: 'mp-moon-hit', cx: 0, cy: 0, r: MOON_R + 14, fill: 'transparent', 'pointer-events': 'all' });
  moonGroup.appendChild(moonHit);
  orbitSvg.appendChild(moonGroup);
}

function moonPosition(phi) {
  return [ORBIT_CX - ORBIT_R * Math.cos(phi), ORBIT_CY + ORBIT_R * Math.sin(phi)];
}

function updateOrbitScene(age) {
  const [mx, my] = moonPosition(ageToPhi(age));
  moonGroup.setAttribute('transform', `translate(${mx},${my})`);
}

/* ---- 月の形（地球から見た見え方） ---- */
const shapeSvg = document.getElementById('mp-shape');
const SHAPE_CX = 150, SHAPE_CY = 150, SHAPE_R = 110;
let shapePath;

function buildShapeScene() {
  // 地球照 ── 暗い側もうっすら見える下地
  shapeSvg.appendChild(el('circle', {
    cx: SHAPE_CX, cy: SHAPE_CY, r: SHAPE_R, fill: 'var(--mp-moon-dark)'
  }));
  shapePath = el('path', { fill: 'var(--mp-moon-lit)' });
  shapeSvg.appendChild(shapePath);
  shapeSvg.appendChild(el('circle', {
    cx: SHAPE_CX, cy: SHAPE_CY, r: SHAPE_R, fill: 'none', stroke: 'var(--tb-border)', 'stroke-width': 1.5
  }));
}

function updateShapeScene(age) {
  shapePath.setAttribute('d', moonShapePath(SHAPE_CX, SHAPE_CY, SHAPE_R, ageToPhi(age)));
}

/* ============================================================
   状態・表示
   ============================================================ */
const ageValueEl = document.getElementById('mp-age-value');
const nameEl = document.getElementById('mp-name');
const slider = document.getElementById('mp-slider');
const playBtn = document.getElementById('mp-play');

let age = 0;

function render() {
  updateOrbitScene(age);
  updateShapeScene(age);
  ageValueEl.textContent = age.toFixed(1);
  nameEl.innerHTML = phaseName(age);
  slider.value = age;
}

function setAge(newAge) {
  age = normAge(newAge);
  render();
}

/* ============================================================
   ドラッグ（軌道図の月をつかんで動かす）
   ============================================================ */
function svgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

let dragging = false;

function angleFromClient(clientX, clientY) {
  const p = svgPoint(orbitSvg, clientX, clientY);
  // moonPosition() の逆算： x=ORBIT_CX-R*cos(phi), y=ORBIT_CY+R*sin(phi)
  return Math.atan2(p.y - ORBIT_CY, ORBIT_CX - p.x);
}

function onPointerDown(e) {
  dragging = true;
  stopPlaying();
  moonHit.setPointerCapture(e.pointerId);
  setAge(phiToAge(angleFromClient(e.clientX, e.clientY)));
}
function onPointerMove(e) {
  if (!dragging) return;
  setAge(phiToAge(angleFromClient(e.clientX, e.clientY)));
}
function onPointerUp(e) {
  if (!dragging) return;
  dragging = false;
  moonHit.releasePointerCapture(e.pointerId);
}

/* ============================================================
   スライダー・再生
   ============================================================ */
slider.addEventListener('input', () => {
  stopPlaying();
  setAge(parseFloat(slider.value));
});

const CYCLE_SECONDS = 24;   // ひと月ぶんを何秒で回すか（自動再生の速さ）
let playing = false, rafId = null, lastT = null;

function tick(t) {
  if (!playing) return;
  if (lastT !== null) {
    const dt = (t - lastT) / 1000;
    setAge(age + (SYN / CYCLE_SECONDS) * dt);
  }
  lastT = t;
  rafId = requestAnimationFrame(tick);
}

function startPlaying() {
  if (playing) return;
  playing = true;
  lastT = null;
  playBtn.textContent = '■ とめる';
  rafId = requestAnimationFrame(tick);
}
function stopPlaying() {
  if (!playing) return;
  playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  playBtn.textContent = '▶ うごかす';
}

playBtn.addEventListener('click', () => { playing ? stopPlaying() : startPlaying(); });

/* ============================================================
   起動
   ============================================================ */
buildOrbitScene();
buildShapeScene();
moonHit.addEventListener('pointerdown', onPointerDown);
moonHit.addEventListener('pointermove', onPointerMove);
moonHit.addEventListener('pointerup', onPointerUp);
moonHit.addEventListener('pointercancel', onPointerUp);
render();
