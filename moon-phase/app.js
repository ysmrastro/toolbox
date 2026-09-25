"use strict";

/* ============================================================
   モデル
   状態は経過日数 simDay（実数）ひとつだけ。0日目の正午を基準にする。

   - 月の位置・形は simDay を朔望月 SYN で割った余り（＝月齢）から決まる
   - 日本の向きは simDay の端数（＝時刻）だけから決まる。simDay の整数部（＝日）は関係ない
   - 「日」つまみ・「時刻」つまみは、どちらも simDay の別の見方を操作しているだけ

   離角・明暗・自転・出没の判定の詳しい式は README を参照。
   ============================================================ */
const SYN = 29.5306;                 // 朔望月（日）
const TWO_PI = Math.PI * 2;
const DAY_CYCLE = 30;                 // 「日」つまみが 0〜29 で一周する長さ

const ageToPhi = age => (age / SYN) * TWO_PI;
const phiToAge = phi => (phi / TWO_PI) * SYN;
const normPhi = phi => ((phi % TWO_PI) + TWO_PI) % TWO_PI;
const normAge = age => ((age % SYN) + SYN) % SYN;
const normSimDay = d => ((d % DAY_CYCLE) + DAY_CYCLE) % DAY_CYCLE;

/* 名前を出す月齢の代表値。表示名は円環距離がいちばん近いものを採用し、
   離れていたら「満ちていく／欠けていく」の一般表現にする。 */
const NAMED_PHASES = [
  { age: 0,           html: '<ruby>新月<rt>しんげつ</rt></ruby>' },
  { age: 3,            html: '<ruby>三日月<rt>みかづき</rt></ruby>' },
  { age: SYN / 4,      html: '<ruby>上弦<rt>じょうげん</rt></ruby>の<ruby>月<rt>つき</rt></ruby>' },
  { age: SYN / 2,      html: '<ruby>満月<rt>まんげつ</rt></ruby>' },
  { age: SYN * 3 / 4,  html: '<ruby>下弦<rt>かげん</rt></ruby>の<ruby>月<rt>つき</rt></ruby>' }
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
const EARTH_R = 56, MOON_R = 16;   // EARTH_R は日本の形が見える大きさまで上げてある

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
  orbitSvg.appendChild(earth);

  buildJapan();

  earth.appendChild(el('circle', { cx: ORBIT_CX, cy: ORBIT_CY, r: 4, fill: '#fff' }));  // 北極（日本より上に描く）

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

function updateOrbitScene(phi) {
  const [mx, my] = moonPosition(phi);
  moonGroup.setAttribute('transform', `translate(${mx},${my})`);
}

/* ---- 日本（自転で向きが変わる） ----
   正距方位図法もどき ── 北極中心からの距離を「(90-緯度)/90 × 地球の半径」、
   向きを「日本時間だけで決めた回転角 + 経度のずれ」で決める簡略モデル。
   経度差は形（線の長さ）だけに使い、自転の速さの計算には使わない
   （日本全体をひとつの地方時として扱ってよい、という指示のとおり）。 */
const JAPAN_REF_LON = 135;   // 日本標準時の基準子午線。回転角の基準にも使う
const JAPAN_REF_LAT = 36;    // 「人が立つ地点」の代表緯度（近畿あたり）
// 正しい縮尺のままだと、この絵の地球（半径 EARTH_R）の上では日本が数px の点にしかならず、
// 北海道・本州・九州の見分けがつかない。代表地点からの緯度経度のずれをこの倍率で誇張し、
// 形だけ見える大きさにする（代表地点そのものの位置は誇張しない＝地平線や人の印はそのまま）。
const JAPAN_SCALE = 3.1;

// 北海道の東から反時計まわりに太平洋側を九州まで下り、瀬戸内・日本海側を北海道まで戻る、
// ごく粗い輪郭（十数点）。海岸線データではなく、形の見当をつけるための概算値。
const JAPAN_OUTLINE = [
  [145.8, 44.5], [144.5, 43.5], [141.8, 41.2], [141.3, 38.3], [140.9, 36.0],
  [139.8, 34.9], [138.8, 34.6], [136.9, 34.2], [135.0, 33.5], [133.3, 32.8],
  [131.8, 31.6], [130.3, 31.2], [129.7, 32.9], [131.5, 33.9], [132.5, 35.4],
  [135.7, 35.6], [137.0, 36.8], [139.1, 38.0], [140.1, 39.7], [141.0, 41.3],
  [140.7, 43.1], [142.5, 44.9]
];

// 時刻（0〜24時）から、日本の回転角（度・数学座標＝反時計回りが正）を作る。
// 正午に太陽側（画面左＝180°）、18時に画面の下（270°）、0時に画面の右（0°）、
// 6時に画面の上（90°）になるように決めてある。
function japanRotDeg(time) { return 180 + (time - 12) * 15; }

function projectLonLat(lon, lat, rotDeg) {
  const angleDeg = rotDeg + (lon - JAPAN_REF_LON);
  const rad = angleDeg * Math.PI / 180;
  const dist = EARTH_R * (90 - lat) / 90;
  return [ORBIT_CX + dist * Math.cos(rad), ORBIT_CY - dist * Math.sin(rad)];
}

let japanPath, japanLabel, japanHorizon, japanPersonHead, japanPersonBody;

function buildJapan() {
  japanPath = el('path', { fill: 'var(--mp-gold)', stroke: 'var(--mp-gold)', 'stroke-width': 1, 'stroke-linejoin': 'round' });
  orbitSvg.appendChild(japanPath);

  // 地平線（接している短い線）と、立っている人の印
  japanHorizon = el('line', { stroke: 'var(--mp-gold)', 'stroke-width': 1.5, opacity: 0.85 });
  orbitSvg.appendChild(japanHorizon);
  japanPersonBody = el('line', { stroke: 'var(--mp-text)', 'stroke-width': 1.5 });
  orbitSvg.appendChild(japanPersonBody);
  japanPersonHead = el('circle', { r: 2.2, fill: 'var(--mp-text)' });
  orbitSvg.appendChild(japanPersonHead);

  japanLabel = el('text', {
    'font-size': 13, fill: 'var(--mp-gold)', 'text-anchor': 'middle', 'dominant-baseline': 'middle'
  });
  japanLabel.textContent = 'にほん';
  orbitSvg.appendChild(japanLabel);
}

function updateJapan(rotDeg) {
  const d = JAPAN_OUTLINE
    .map(([lon, lat], i) => {
      // JAPAN_SCALE の説明どおり、代表地点からのずれだけを誇張して投影する
      const exLon = JAPAN_REF_LON + (lon - JAPAN_REF_LON) * JAPAN_SCALE;
      const exLat = JAPAN_REF_LAT + (lat - JAPAN_REF_LAT) * JAPAN_SCALE;
      const [x, y] = projectLonLat(exLon, exLat, rotDeg);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ') + ' Z';
  japanPath.setAttribute('d', d);

  // 代表地点（東経135°・北緯36°）に、地平線の接線と人の印を立てる
  const [px, py] = projectLonLat(JAPAN_REF_LON, JAPAN_REF_LAT, rotDeg);
  const rad = rotDeg * Math.PI / 180;
  const radial = [Math.cos(rad), -Math.sin(rad)];      // 中心から外向き（＝その人にとっての「上」）
  const tangent = [-radial[1], radial[0]];             // 90°回した接線＝地平線の向き

  const HL = 15;
  japanHorizon.setAttribute('x1', px - tangent[0] * HL);
  japanHorizon.setAttribute('y1', py - tangent[1] * HL);
  japanHorizon.setAttribute('x2', px + tangent[0] * HL);
  japanHorizon.setAttribute('y2', py + tangent[1] * HL);

  const headX = px + radial[0] * 9, headY = py + radial[1] * 9;
  japanPersonBody.setAttribute('x1', px); japanPersonBody.setAttribute('y1', py);
  japanPersonBody.setAttribute('x2', headX); japanPersonBody.setAttribute('y2', headY);
  japanPersonHead.setAttribute('cx', headX); japanPersonHead.setAttribute('cy', headY);

  // ラベルは中心から見て代表地点のさらに外側（読みやすいよう少し離す）
  japanLabel.setAttribute('x', ORBIT_CX + (px - ORBIT_CX) * 1.5);
  japanLabel.setAttribute('y', ORBIT_CY + (py - ORBIT_CY) * 1.5);
}

/* ---- 月の形（地球から見た見え方） ---- */
const shapeSvg = document.getElementById('mp-shape');
const shapePanel = document.querySelector('.mp-panel--shape');
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

function updateShapeScene(phi) {
  shapePath.setAttribute('d', moonShapePath(SHAPE_CX, SHAPE_CY, SHAPE_R, phi));
}

/* ---- 昼夜・月の出没の判定 ----
   太陽の方向は常に画面左＝(-1,0)。日本の方向・月の方向は、それぞれの回転角から
   単位ベクトルを作り、内積の符号（＝なす角が90°未満かどうか）で判定する。
   導出は README 参照。 */
function isDaytimeAt(rotDeg) {
  const rad = rotDeg * Math.PI / 180;
  return -Math.cos(rad) > 0;
}
function isMoonUpAt(phi, rotDeg) {
  const rad = rotDeg * Math.PI / 180;
  return -Math.cos(phi - rad) > 0;
}

/* ============================================================
   状態・表示
   ============================================================ */
const ageValueEl = document.getElementById('mp-age-value');
const nameEl = document.getElementById('mp-name');
const daynightEl = document.getElementById('mp-daynight');
const moonvisEl = document.getElementById('mp-moonvis');
const daySlider = document.getElementById('mp-day-slider');
const timeSlider = document.getElementById('mp-time-slider');
const dayOut = document.getElementById('mp-day-out');
const timeOut = document.getElementById('mp-time-out');
const speedButtons = Array.from(document.querySelectorAll('.mp-speed-btn'));
const playBtn = document.getElementById('mp-play');
const dayPrevBtn = document.getElementById('mp-day-prev');
const dayNextBtn = document.getElementById('mp-day-next');
const timePrevBtn = document.getElementById('mp-time-prev');
const timeNextBtn = document.getElementById('mp-time-next');

let simDay = 0;   // 経過日数（実数）。これだけが状態

function formatTime(time) {
  // time は day + time/24 の往復で作っているので、10/24 のような割り切れない値では
  // 浮動小数の誤差が乗る（例: 9.999999999998 になって Math.floor で時が1つ落ちる）。
  // 分単位で丸めてから時・分に分けることで、この誤差を吸収する。
  const totalMin = Math.round(time * 60) % (24 * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function render() {
  const day = Math.floor(simDay);
  const time = (simDay - day) * 24;
  const age = normAge(simDay);
  const phi = ageToPhi(age);
  const rotDeg = japanRotDeg(time);

  updateOrbitScene(phi);
  updateJapan(rotDeg);
  updateShapeScene(phi);

  ageValueEl.textContent = age.toFixed(1);
  nameEl.innerHTML = phaseName(age);

  const daytime = isDaytimeAt(rotDeg);
  daynightEl.innerHTML = daytime
    ? 'にほんは いま <ruby>昼<rt>ひる</rt></ruby>'
    : 'にほんは いま <ruby>夜<rt>よる</rt></ruby>';

  const moonUp = isMoonUpAt(phi, rotDeg);
  moonvisEl.innerHTML = '<ruby>月<rt>つき</rt></ruby>は <ruby>空<rt>そら</rt></ruby>に '
    + (moonUp ? 'でている' : 'しずんでいる');
  shapePanel.classList.toggle('is-moon-hidden', !moonUp);

  daySlider.value = day;
  timeSlider.value = time;
  dayOut.textContent = day;
  timeOut.textContent = formatTime(time);
}

function setSimDay(newDay) {
  simDay = normSimDay(newDay);
  render();
}

/* ============================================================
   ドラッグ（軌道図の月をつかんで動かす）
   月の角度から t を逆算するので、日・時刻の両方のつまみが動く。
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
  setSimDay(phiToAge(angleFromClient(e.clientX, e.clientY)));
}
function onPointerMove(e) {
  if (!dragging) return;
  setSimDay(phiToAge(angleFromClient(e.clientX, e.clientY)));
}
function onPointerUp(e) {
  if (!dragging) return;
  dragging = false;
  moonHit.releasePointerCapture(e.pointerId);
}

/* ============================================================
   つまみ・速さ・再生
   ============================================================ */
function currentSlidersToSimDay() {
  const day = parseInt(daySlider.value, 10);
  const time = parseFloat(timeSlider.value);
  return day + time / 24;
}
daySlider.addEventListener('input', () => { stopPlaying(); setSimDay(currentSlidersToSimDay()); });
timeSlider.addEventListener('input', () => { stopPlaying(); setSimDay(currentSlidersToSimDay()); });

/* ◀ ▶ の1コマ送り。日は日だけ、時刻は時刻だけをループさせる ──
   例えば時刻が 23:45 で▶を押すと 0:00 に飛ぶが、日はそのまま変えない
  （t = 日 + 時刻/24 を作り直すので、結果として t は約1日ぶん戻る。指示どおりの挙動）。 */
const TIME_STEP = 0.25;                    // 時刻つまみの刻み＝15分
const TIME_STEPS_PER_DAY = 24 / TIME_STEP; // 96コマ

function stepDay(delta) {
  stopPlaying();
  const day = Math.floor(simDay);
  const time = (simDay - day) * 24;
  const newDay = ((day + delta) % DAY_CYCLE + DAY_CYCLE) % DAY_CYCLE;
  setSimDay(newDay + time / 24);
}
function stepTime(delta) {
  stopPlaying();
  const day = Math.floor(simDay);
  const time = (simDay - day) * 24;
  // コマ番号にいったん丸めてから1コマ動かす（ドラッグ直後などで15分刻みから
  // ずれていても、ボタンを押せばきちんと格子に乗る）
  const idx = Math.round(time / TIME_STEP);
  const newIdx = ((idx + delta) % TIME_STEPS_PER_DAY + TIME_STEPS_PER_DAY) % TIME_STEPS_PER_DAY;
  setSimDay(day + (newIdx * TIME_STEP) / 24);
}
dayPrevBtn.addEventListener('click', () => stepDay(-1));
dayNextBtn.addEventListener('click', () => stepDay(1));
timePrevBtn.addEventListener('click', () => stepTime(-1));
timeNextBtn.addEventListener('click', () => stepTime(1));

let speedHoursPerSec = 6;   // 初期値「1秒で6時間」
speedButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    speedHoursPerSec = parseFloat(btn.dataset.speed);
    speedButtons.forEach(b => b.classList.toggle('is-active', b === btn));
  });
});

let playing = false, rafId = null, lastTs = null;

function tick(ts) {
  if (!playing) return;
  if (lastTs !== null) {
    const dt = (ts - lastTs) / 1000;
    setSimDay(simDay + (speedHoursPerSec / 24) * dt);
  }
  lastTs = ts;
  rafId = requestAnimationFrame(tick);
}

function startPlaying() {
  if (playing) return;
  playing = true;
  lastTs = null;
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
