"use strict";

/* ============================================================
   実際の天文計算は meteor-settings/astro.js（MS_ASTRO）をそのまま使う。
   国立天文台の公表値と突き合わせ済みのものをコピーせず共有するため、
   index.html で <script src="../meteor-settings/astro.js"> を先に読み込んでいる。
   ============================================================ */
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const norm360 = x => ((x % 360) + 360) % 360;

const FUKUOKA_LAT = 33.59, FUKUOKA_LON = 130.40;   // 観測地は福岡
const SYNODIC = 29.530589;                          // 朔望月（日）。astro.js と同じ値

/* ============================================================
   モデル
   状態は経過日数 simDay（実数）ひとつだけ。DAY0（2026-09-11・新月 00:50 JST の日）を
   基準に、simDay の整数部がそのままカレンダーの日付になる。

   - 「日」つまみ（0〜29）・「時刻」つまみ（0〜24時）は、どちらも simDay の別の見方
   - 月の位置・形・月齢は、その瞬間の実際の離角・月齢（MS_ASTRO）から決まる
   - 日本の向きは、福岡での太陽の時角（実際の南中時刻を基準にする）から決まる
   - 昼夜・月の出没は、太陽・月の実際の高度（日の出入りと同じ基準）で判定する

   詳しい式は README を参照。
   ============================================================ */
const DAY_CYCLE = 30;                 // 「日」つまみが 0〜29 で一周する長さ
const DAY0 = new Date(2026, 8, 11);   // 2026-09-11 00:00（ブラウザのローカル時刻＝JST を想定）
const normSimDay = d => ((d % DAY_CYCLE) + DAY_CYCLE) % DAY_CYCLE;

// simDay（経過日数）から、その瞬間を表す Date を作る。分単位で丸めて浮動小数の誤差を防ぐ
// （day + time/24 の往復で 10/24 のような割り切れない値になり、丸めないと表示の分が1つ落ちる）。
function dateForSimDay(simDay) {
  const totalMinutes = Math.round(simDay * 24 * 60);
  return new Date(DAY0.getTime() + totalMinutes * 60000);
}
function formatDateLabel(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
function formatClock(date) {
  if (!date) return 'なし';
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const TWO_PI = Math.PI * 2;
const normPhi = phi => ((phi % TWO_PI) + TWO_PI) % TWO_PI;
const normAge = age => ((age % SYNODIC) + SYNODIC) % SYNODIC;

/* 名前を出す月齢の代表値。表示名は円環距離がいちばん近いものを採用し、
   離れていたら「満ちていく／欠けていく」の一般表現にする。 */
const NAMED_PHASES = [
  { age: 0,                html: '<ruby>新月<rt>しんげつ</rt></ruby>' },
  { age: 3,                 html: '<ruby>三日月<rt>みかづき</rt></ruby>' },
  { age: SYNODIC / 4,       html: '<ruby>上弦<rt>じょうげん</rt></ruby>の<ruby>月<rt>つき</rt></ruby>' },
  { age: SYNODIC / 2,       html: '<ruby>満月<rt>まんげつ</rt></ruby>' },
  { age: SYNODIC * 3 / 4,   html: '<ruby>下弦<rt>かげん</rt></ruby>の<ruby>月<rt>つき</rt></ruby>' }
];
const NAME_WINDOW = 1.0;   // この日数以内なら、近い名前を採用する

function circularDist(a, b) {
  const d = Math.abs(normAge(a) - normAge(b));
  return Math.min(d, SYNODIC - d);
}
function phaseName(age) {
  let best = null, bestD = Infinity;
  for (const p of NAMED_PHASES) {
    const d = circularDist(age, p.age);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (bestD <= NAME_WINDOW) return best.html;
  return age < SYNODIC / 2 ? 'だんだん ふとる' : 'だんだん やせる';
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

// 地平線ビュー用: 明るい側が「ローカルの +x」に来る向きで作る、回転できる版。
// 太陽の方向へ回してから置く（中心が原点のローカル座標）。k は輝面比（0=新月〜1=満月）。
function moonShapeLocalPath(r, k) {
  const a = r * (1 - 2 * k);
  const rx = Math.abs(a);
  const innerSweep = a >= 0 ? 0 : 1;
  const top = `0 ${-r}`, bottom = `0 ${r}`;
  return `M ${top} A ${r} ${r} 0 0 1 ${bottom} A ${rx} ${r} 0 0 ${innerSweep} ${top} Z`;
}

/* ---- 軌道図（北極から見下ろした図） ---- */
// viewBox（index.html 側）は 0 0 380 294。月の軌道＋月の半径ぶん（ORBIT_R+MOON_R=146）の
// 上下に 1px だけ余白を残した高さにしてある。cy を動かしたら viewBox の高さも合わせて直す。
const orbitSvg = document.getElementById('mp-orbit');
const ORBIT_CX = 230, ORBIT_CY = 147, ORBIT_R = 130;
// EARTH_R は「軌道半径の0.35〜0.4倍程度」という目安より大きい（比は約0.58）。
// 月（半径 MOON_R）が軌道上のどこにいても地球に重ならない範囲で、日本の形が見える
// 大きさまで上げてある（ORBIT_R - EARTH_R - MOON_R = 39px の余白を残す）。
const EARTH_R = 75, MOON_R = 16;

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

function moonPositionOnOrbit(phi) {
  return [ORBIT_CX - ORBIT_R * Math.cos(phi), ORBIT_CY + ORBIT_R * Math.sin(phi)];
}

function updateOrbitScene(phi) {
  const [mx, my] = moonPositionOnOrbit(phi);
  moonGroup.setAttribute('transform', `translate(${mx},${my})`);
}

/* ---- 日本（自転で向きが変わる） ----
   正距方位図法もどき ── 北極中心からの距離を「(90-緯度)/90 × 地球の半径」、
   向きを「太陽の時角 + 経度のずれ」で決める。
   経度差は形（線の長さ）だけに使い、自転の速さの計算には使わない
   （日本全体をひとつの地方時として扱ってよい、という指示のとおり）。 */
const JAPAN_REF_LON = 135;   // 日本標準時の基準子午線。回転角の基準にも使う
const JAPAN_REF_LAT = 36;    // 「人が立つ地点」の代表緯度（近畿あたり）
// 正しい縮尺のままだと、地球（半径 EARTH_R）の上では日本が数px の点にしかならず、
// 北海道・本州・九州の見分けがつかない。代表地点からの緯度経度のずれをこの倍率で誇張し、
// 列島の弧の長さ（北海道の北端〜九州の南端）が地球の半径のおよそ0.8倍になるようにしている
// （地平線・人の印も同じ誇張後の位置に合わせる。判定の計算は角度だけなので誇張しても
// 結果は変わらない）。この倍率でも列島は地球の縁の内側に収まる
// （最遠点の中心距離は約63px、EARTH_R=75pxより内側）。
const JAPAN_SCALE = 4.4;

// 北海道・本州・四国・九州を別々の多角形にして、列島の弧の形が分かるようにする。
// 海岸線データではなく、形の見当をつけるための概算値（十点前後ずつ）。
const JAPAN_LANDMASSES = [
  { points: [ // 北海道
    [140.9, 41.8], [140.3, 43.4], [141.6, 45.3], [143.5, 45.0],
    [145.3, 43.8], [145.5, 42.6], [144.0, 41.8], [142.0, 41.6]
  ] },
  { points: [ // 本州（太平洋側を南下し、日本海側を北上して戻る）
    [141.3, 41.3], [141.0, 38.9], [140.8, 37.3], [140.0, 36.0], [139.7, 35.3],
    [138.9, 34.7], [137.7, 34.6], [136.5, 34.2], [135.7, 33.6], [135.0, 33.9],
    [133.9, 34.3], [132.5, 34.2], [131.5, 34.2], [131.0, 34.5], [132.0, 35.5],
    [133.5, 35.6], [135.3, 35.7], [136.8, 36.9], [138.2, 37.8], [139.4, 39.1],
    [140.2, 40.6]
  ] },
  { points: [ // 四国
    [134.6, 33.9], [133.9, 34.2], [133.0, 33.9], [132.6, 33.3],
    [132.9, 32.8], [133.8, 32.9], [134.5, 33.2]
  ] },
  { points: [ // 九州
    [131.9, 33.9], [131.3, 33.3], [131.8, 31.7], [130.9, 31.0],
    [130.2, 31.2], [129.6, 32.6], [130.0, 33.0], [130.9, 33.5]
  ] }
];

// 太陽の時角（度）。0＝南中（日本が太陽側＝画面左）、正＝午後（西へ）、負＝午前（東へ）。
// -180〜180 に正規化する。前回の「(時刻-12)*15」という近似（均時差も、福岡の経度が
// 日本標準時の基準子午線からずれていることも無視していた）をやめ、実際の時角を使う。
function sunHourAngleDeg(sun, date) {
  const lst = norm360(MS_ASTRO.gmst(date) + FUKUOKA_LON);
  let ha = norm360(lst - sun.ra);
  if (ha > 180) ha -= 360;
  return ha;
}
// 時角0で日本が画面左（太陽側）になるよう、そのまま 180 に足す
// （軌道図・地球の「太陽側＝左半分が明るい」という描き方に合わせるため）。
function japanRotDeg(sun, date) {
  return norm360(180 + sunHourAngleDeg(sun, date));
}

function projectLonLat(lon, lat, rotDeg) {
  const angleDeg = rotDeg + (lon - JAPAN_REF_LON);
  const rad = angleDeg * Math.PI / 180;
  const dist = EARTH_R * (90 - lat) / 90;
  return [ORBIT_CX + dist * Math.cos(rad), ORBIT_CY - dist * Math.sin(rad)];
}

// JAPAN_SCALE の説明どおり、代表地点からのずれだけを誇張してから投影する。
// 地平線・人の印もこれで作った点を使うので、見た目の日本の位置とぴったり合う。
function projectJapan(lon, lat, rotDeg) {
  const exLon = JAPAN_REF_LON + (lon - JAPAN_REF_LON) * JAPAN_SCALE;
  const exLat = JAPAN_REF_LAT + (lat - JAPAN_REF_LAT) * JAPAN_SCALE;
  return projectLonLat(exLon, exLat, rotDeg);
}

let japanPaths, japanLabel, japanHorizon, japanPersonHead, japanPersonBody;

function buildJapan() {
  // 塗りは gold、縁取りはそれより暗い色で「島」がひとつずつ分かるようにする
  japanPaths = JAPAN_LANDMASSES.map(() => el('path', {
    fill: 'var(--mp-gold)', stroke: 'var(--mp-gold-edge)', 'stroke-width': 1.2, 'stroke-linejoin': 'round'
  }));
  japanPaths.forEach(p => orbitSvg.appendChild(p));

  // 地平線（接している短い線）と、立っている人の印
  japanHorizon = el('line', { stroke: 'var(--mp-gold)', 'stroke-width': 1.5, opacity: 0.85 });
  orbitSvg.appendChild(japanHorizon);
  japanPersonBody = el('line', { stroke: 'var(--mp-text)', 'stroke-width': 1.5 });
  orbitSvg.appendChild(japanPersonBody);
  japanPersonHead = el('circle', { r: 2.2, fill: 'var(--mp-text)' });
  orbitSvg.appendChild(japanPersonHead);

  japanLabel = el('text', {
    'font-size': 14, fill: 'var(--mp-gold)', 'text-anchor': 'middle', 'dominant-baseline': 'middle'
  });
  japanLabel.textContent = 'にほん';
  orbitSvg.appendChild(japanLabel);
}

function updateJapan(rotDeg) {
  JAPAN_LANDMASSES.forEach((mass, i) => {
    const d = mass.points
      .map(([lon, lat], j) => {
        const [x, y] = projectJapan(lon, lat, rotDeg);
        return `${j === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ') + ' Z';
    japanPaths[i].setAttribute('d', d);
  });

  // 代表地点（東経135°・北緯36°）の、誇張後の位置に地平線の接線と人の印を立てる
  const [px, py] = projectJapan(JAPAN_REF_LON, JAPAN_REF_LAT, rotDeg);
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

  // ラベルは代表地点と同じ向き（rad）に沿って、地球の縁の外側に置く。
  // 列島は必ず地球の中（dist < EARTH_R）に収まるので、これで形と重ならない。
  const labelDist = EARTH_R + 14;
  japanLabel.setAttribute('x', ORBIT_CX + radial[0] * labelDist);
  japanLabel.setAttribute('y', ORBIT_CY + radial[1] * labelDist);
}

/* ---- 月の形（地球から見た見え方） ---- */
// viewBox は 0 0 232 232（円の半径110+左右6pxの余白だけ）。
const shapeSvg = document.getElementById('mp-shape');
const shapePanel = document.querySelector('.mp-panel--shape');
const SHAPE_CX = 116, SHAPE_CY = 116, SHAPE_R = 110;
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
   太陽・月の実際の高度を、日の出入りと同じ基準で見る
   （astro.js の dayEvents / nightTimeline が使っている基準と同じ値）。 */
const SUN_HORIZON_ALT = -0.833;   // 太陽の出入り＝上辺が地平線に接する（大気差込み）
const MOON_HORIZON_ALT = 0.125;   // 月の出入り＝地心高度がこの値（視差・大気差・視半径の合成）
function isDaytimeAt(sun) { return sun.altitude > SUN_HORIZON_ALT; }
function isMoonUpAt(moon) { return moon.altitude > MOON_HORIZON_ALT; }

/* ============================================================
   地平線ビュー（福岡から南を見た空）
   正距円筒（方位・高度をそのまま x・y にする素朴な投影）。
   視野は方位90°(東)〜270°(西)の180° ── 120°では真東・真西が視野に入らず
   出入りが見えないため、180°に広げてある。左が東、中央が南、右が西。
   ============================================================ */
const horizonSvg = document.getElementById('mp-horizon');
const eventsEl = document.getElementById('mp-events');
const HZ_W = 640;                      // viewBox の幅は固定
let HZ_H = 320;                        // 高さは実際の縦横比に合わせて resizeHorizon() が書き換える
const HZ_GROUND_FRAC = 272 / 320;      // 地面帯の境界（高度0°）の位置。全体の高さに対する比率で固定
let HZ_GROUND_Y = HZ_H * HZ_GROUND_FRAC;
const HZ_AZ_MIN = 90, HZ_AZ_MAX = 270;
const HZ_MOON_R = 15;                  // 見かけの大きさは誇張してある（指示どおり見やすさ優先）

const hzX = az => HZ_W * (az - HZ_AZ_MIN) / (HZ_AZ_MAX - HZ_AZ_MIN);
const hzY = alt => HZ_GROUND_Y * (1 - alt / 90);
const hzInView = az => az >= HZ_AZ_MIN && az <= HZ_AZ_MAX;

// 太陽の高度から空の色を作る。上（天頂側）と地平線近くとで別の色を持たせ、
// 縦のグラデーションにする ── 単色だと、夕方でも「灰色がかったピンク一色」に
// なって夕方らしく見えない不具合があったため。しきい値は
// -18°（天文薄明＝夜）・-4°（この下は薄明で地平線にわずかに色が残る程度）・
// 0°（日の出入り＝いちばん焼ける）・+6°（昼の空色に達する）に置く。
const SKY_STOPS = [
  { alt: -18, top: [11, 16, 30], bottom: [11, 16, 30] },      // 夜（上下とも紺で一様）
  { alt: -4, top: [20, 26, 50], bottom: [120, 80, 95] },      // 薄明（地平線にわずかに色が残る）
  { alt: 0, top: [45, 55, 115], bottom: [230, 120, 70] },     // 日の出入り（地平線がいちばん焼ける）
  { alt: 6, top: [30, 95, 175], bottom: [143, 205, 236] }     // 昼（上＝濃い青、下＝明るい水色）
];
function lerpColor(c0, c1, t) {
  return c0.map((v, i) => Math.round(v + (c1[i] - v) * t));
}
function skyGradientColors(sunAlt) {
  const a = Math.max(SKY_STOPS[0].alt, Math.min(SKY_STOPS[SKY_STOPS.length - 1].alt, sunAlt));
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const s0 = SKY_STOPS[i], s1 = SKY_STOPS[i + 1];
    if (a <= s1.alt) {
      const t = (a - s0.alt) / (s1.alt - s0.alt);
      return { top: lerpColor(s0.top, s1.top, t), bottom: lerpColor(s0.bottom, s1.bottom, t) };
    }
  }
  const last = SKY_STOPS[SKY_STOPS.length - 1];
  return { top: last.top, bottom: last.bottom };
}
const rgbStr = c => `rgb(${c[0]},${c[1]},${c[2]})`;

let hzSky, hzSkyTopStop, hzSkyBottomStop, hzGround, hzHorizonLine, hzSun, hzMoonGroup, hzMoonShape, hzTrackPath, hzTicksGroup;

function buildHorizonScene() {
  // 空は縦のグラデーション（上＝天頂側、下＝地平線近く）。objectBoundingBox（既定）
  // なので、resizeHorizon() で hzSky の高さが変わっても比率は自動で合う。
  const defs = el('defs');
  const grad = el('linearGradient', { id: 'mp-sky-gradient', x1: 0, y1: 0, x2: 0, y2: 1 });
  hzSkyTopStop = el('stop', { offset: '0%' });
  hzSkyBottomStop = el('stop', { offset: '100%' });
  grad.appendChild(hzSkyTopStop);
  grad.appendChild(hzSkyBottomStop);
  defs.appendChild(grad);
  horizonSvg.appendChild(defs);

  hzSky = el('rect', { x: 0, y: 0, width: HZ_W, height: HZ_GROUND_Y, fill: 'url(#mp-sky-gradient)' });
  horizonSvg.appendChild(hzSky);

  // 地面（暗い帯）と地平線。高さは resizeHorizon() → layoutHorizonStatic() で決める
  hzGround = el('rect', { x: 0, width: HZ_W, fill: 'var(--mp-earth-dark)' });
  horizonSvg.appendChild(hzGround);
  hzHorizonLine = el('line', { x1: 0, x2: HZ_W, stroke: 'var(--tb-border)', 'stroke-width': 1.5 });
  horizonSvg.appendChild(hzHorizonLine);

  // いまの前後12時間の月の通り道（点線）と時刻の目盛り。render() のたびに作り直す
  hzTrackPath = el('path', {
    fill: 'none', stroke: 'var(--mp-moon-lit)', 'stroke-width': 1.5,
    'stroke-dasharray': '4 4', opacity: 0.5
  });
  horizonSvg.appendChild(hzTrackPath);
  hzTicksGroup = el('g');
  horizonSvg.appendChild(hzTicksGroup);

  // 太陽・月（地面より手前＝あとに描く）
  hzSun = el('circle', { r: 12, fill: 'var(--mp-sun)' });
  horizonSvg.appendChild(hzSun);

  hzMoonGroup = el('g');
  hzMoonGroup.appendChild(el('circle', { r: HZ_MOON_R, fill: 'var(--mp-moon-dark)' }));
  hzMoonShape = el('path', { fill: 'var(--mp-moon-lit)' });
  hzMoonGroup.appendChild(hzMoonShape);
  hzMoonGroup.appendChild(el('circle', { r: HZ_MOON_R, fill: 'none', stroke: 'var(--tb-border)', 'stroke-width': 1 }));
  horizonSvg.appendChild(hzMoonGroup);

  layoutHorizonStatic();
}

// HZ_H・HZ_GROUND_Y が変わったときに、それに依存する固定要素（空・地面・地平線の
// サイズ）を作り直す。太陽・月・通り道・目盛りは次の render() で更新される。
function layoutHorizonStatic() {
  horizonSvg.setAttribute('viewBox', `0 0 ${HZ_W} ${HZ_H}`);
  hzSky.setAttribute('height', HZ_GROUND_Y);
  hzGround.setAttribute('y', HZ_GROUND_Y);
  hzGround.setAttribute('height', HZ_H - HZ_GROUND_Y);
  hzHorizonLine.setAttribute('y1', HZ_GROUND_Y);
  hzHorizonLine.setAttribute('y2', HZ_GROUND_Y);
}

// パネルの実際の縦横比に合わせて HZ_H を作り直す。viewBox の幅は 640 で固定し、
// 高さだけ「実際にレイアウトで割り当てられた縦横比」に合わせることで、
// 歪ませずに幅いっぱい・高さいっぱいに描ける（指示の「2:1くらい」という目安どおりには
// ならないが、1280×800 に3枚の図を収める都合で、実際はもっと横長になる）。
function resizeHorizon() {
  const rect = horizonSvg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const newH = Math.max(80, Math.round(HZ_W * (rect.height / rect.width)));
  if (Math.abs(newH - HZ_H) < 1) return;
  HZ_H = newH;
  HZ_GROUND_Y = HZ_H * HZ_GROUND_FRAC;
  layoutHorizonStatic();
  render();   // 通り道・目盛りは毎回作り直しているので、ここで呼べば新しい縮尺で描き直る
}

// 「いま」の前後12時間（10分刻み）の月の方位・高度の並び。
// その日の 0:00〜24:00 で切ると、いま見えている月の弧が真夜中でちょうど2つに
// 割れてしまう（0〜3時側は前の晩の弧、21〜24時側は今晩の弧で、別の弧なのに
// 隣り合って見えて「途切れている」ように見える）。「いま」を中心にした窓なら、
// いま見えている弧はその中に丸ごと収まる。
const HZ_TRACK_SPAN_H = 12;
function computeMoonTrack(centerDate) {
  const startMs = centerDate.getTime() - HZ_TRACK_SPAN_H * 3600000;
  const pts = [];
  for (let m = 0; m <= HZ_TRACK_SPAN_H * 2 * 60; m += 10) {
    const t = new Date(startMs + m * 60000);
    const p = MS_ASTRO.moonPosition(t, FUKUOKA_LAT, FUKUOKA_LON);
    pts.push({ az: p.azimuth, alt: p.altitude });
  }
  return pts;
}

// 地平線より上・視野の中にある区間だけをつないだパス（複数区間に分かれてよい）
function trackPathD(pts) {
  let d = '', drawing = false;
  for (const p of pts) {
    if (p.alt > 0 && hzInView(p.az)) {
      d += `${drawing ? 'L' : 'M'} ${hzX(p.az).toFixed(1)} ${hzY(p.alt).toFixed(1)} `;
      drawing = true;
    } else {
      drawing = false;
    }
  }
  return d.trim();
}

// 3時間ごと（0, 3, 6, ...時）の目盛り。日付をまたいでも「0」「3」のように
// 時だけを表示する（通り道と同じ、いまの前後12時間の範囲で拾う）。
function updateTicks(centerDate) {
  while (hzTicksGroup.firstChild) hzTicksGroup.removeChild(hzTicksGroup.firstChild);
  const startMs = centerDate.getTime() - HZ_TRACK_SPAN_H * 3600000;
  const endMs = centerDate.getTime() + HZ_TRACK_SPAN_H * 3600000;
  const STEP_MS = 3 * 3600000;
  const firstBoundary = Math.ceil(startMs / STEP_MS) * STEP_MS;
  for (let t = firstBoundary; t <= endMs; t += STEP_MS) {
    const dt = new Date(t);
    const p = MS_ASTRO.moonPosition(dt, FUKUOKA_LAT, FUKUOKA_LON);
    if (p.altitude <= 0 || !hzInView(p.azimuth)) continue;
    const x = hzX(p.azimuth), y = hzY(p.altitude);
    hzTicksGroup.appendChild(el('circle', { cx: x, cy: y, r: 2, fill: 'var(--mp-subtext)' }));
    const label = el('text', {
      x, y: y - 7, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--mp-subtext)'
    });
    label.textContent = String(dt.getHours());
    hzTicksGroup.appendChild(label);
  }
}

// その日の出入りは日が変わったときだけ作り直す（毎フレームでは重いため）。
// 通り道・目盛りは「いま」が動くたびに窓自体が動くので、毎回作り直す
// （10分刻み×24時間ぶんの評価で軽く、毎フレームでも問題にならない）。
let hzCacheDayKey = null, hzCacheEvents = null;
function ensureHorizonDayCache(date) {
  const key = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  if (key === hzCacheDayKey) return;
  hzCacheDayKey = key;
  hzCacheEvents = MS_ASTRO.dayEvents(date, FUKUOKA_LAT, FUKUOKA_LON);
}

function updateHorizonScene(date, sun, moon) {
  ensureHorizonDayCache(date);
  hzTrackPath.setAttribute('d', trackPathD(computeMoonTrack(date)));
  updateTicks(date);

  const skyColors = skyGradientColors(sun.altitude);
  hzSkyTopStop.setAttribute('stop-color', rgbStr(skyColors.top));
  hzSkyBottomStop.setAttribute('stop-color', rgbStr(skyColors.bottom));

  if (sun.altitude > 0 && hzInView(sun.azimuth)) {
    hzSun.setAttribute('cx', hzX(sun.azimuth));
    hzSun.setAttribute('cy', hzY(sun.altitude));
    hzSun.setAttribute('opacity', 1);
  } else {
    hzSun.setAttribute('opacity', 0);
  }

  const moonVisible = moon.altitude > MOON_HORIZON_ALT && hzInView(moon.azimuth);
  if (moonVisible) {
    const mx = hzX(moon.azimuth), my = hzY(moon.altitude);
    // 「月から太陽への方向」を、この投影の x・y の上でそのまま求めて回す（近似でよい、との指示）。
    // 太陽の高度は ±90 にクランプするだけで、視野の外・地平線の下でも方向の計算には使う。
    const sunProjX = hzX(sun.azimuth);
    const sunProjY = hzY(Math.max(-90, Math.min(90, sun.altitude)));
    const angle = Math.atan2(sunProjY - my, sunProjX - mx) * DEG;
    hzMoonShape.setAttribute('d', moonShapeLocalPath(HZ_MOON_R, moon.illumination));
    hzMoonGroup.setAttribute('transform', `translate(${mx},${my}) rotate(${angle.toFixed(1)})`);
    hzMoonGroup.setAttribute('opacity', sun.altitude > 0 ? 0.4 : 1);   // 昼間は半透明
    hzMoonGroup.style.display = '';
  } else {
    hzMoonGroup.style.display = 'none';
  }

  const ev = hzCacheEvents;
  eventsEl.innerHTML =
    `<ruby>日<rt>ひ</rt></ruby>の<ruby>出<rt>で</rt></ruby> ${formatClock(ev.sunrise)}／` +
    `<ruby>日<rt>ひ</rt></ruby>の<ruby>入<rt>い</rt></ruby>り ${formatClock(ev.sunset)}／` +
    `<ruby>月<rt>つき</rt></ruby>の<ruby>出<rt>で</rt></ruby> ${formatClock(ev.moonrise)}／` +
    `<ruby>月<rt>つき</rt></ruby>の<ruby>入<rt>い</rt></ruby>り ${formatClock(ev.moonset)}`;
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

// 初期表示は 2026-09-26 20:00（お話会の当日・時刻）＝ DAY0 から15日と20時間
let simDay = 15 + 20 / 24;

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
  const date = dateForSimDay(simDay);

  const sun = MS_ASTRO.sunPosition(date, FUKUOKA_LAT, FUKUOKA_LON);
  const moon = MS_ASTRO.moonInfo(date, FUKUOKA_LAT, FUKUOKA_LON);
  const phi = moon.elongation * RAD;
  const rotDeg = japanRotDeg(sun, date);

  updateOrbitScene(phi);
  updateJapan(rotDeg);
  updateShapeScene(phi);
  updateHorizonScene(date, sun, moon);

  ageValueEl.textContent = moon.age.toFixed(1);
  nameEl.innerHTML = phaseName(moon.age);

  const daytime = isDaytimeAt(sun);
  daynightEl.innerHTML = daytime
    ? 'にほんは いま <ruby>昼<rt>ひる</rt></ruby>'
    : 'にほんは いま <ruby>夜<rt>よる</rt></ruby>';

  const moonUp = isMoonUpAt(moon);
  moonvisEl.innerHTML = '<ruby>月<rt>つき</rt></ruby>は <ruby>空<rt>そら</rt></ruby>に '
    + (moonUp ? 'でている' : 'しずんでいる');
  shapePanel.classList.toggle('is-moon-hidden', !moonUp);

  daySlider.value = day;
  timeSlider.value = time;
  dayOut.textContent = formatDateLabel(dateForSimDay(day));
  timeOut.textContent = formatTime(time);
}

function setSimDay(newDay) {
  simDay = normSimDay(newDay);
  render();
}

/* ============================================================
   ドラッグ（軌道図の月をつかんで動かす）
   つかんだ角度＝離角に最も近い時刻を、今の日付の前後で探して simDay を決める
   （厳密な逆算はしない。離角はほぼ一定の速さで増えるので、朔を探す astro.js の
   moonAge() と同じ要領でニュートン法を数回まわせば十分近い解に収束する）。
   ============================================================ */
function findDateForElongation(targetElongDeg, referenceDate) {
  const RATE = 360 / SYNODIC;   // 離角の平均増加率 [度/日]
  const signedDiff = (ms) => {
    const e = MS_ASTRO.moonInfo(new Date(ms), FUKUOKA_LAT, FUKUOKA_LON).elongation;
    let diff = e - targetElongDeg;
    diff = ((diff + 180) % 360 + 360) % 360 - 180;   // -180〜180 に畳む
    return diff;
  };
  let t = referenceDate.getTime();
  for (let i = 0; i < 8; i++) t -= (signedDiff(t) / RATE) * 86400000;
  return new Date(t);
}

function svgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

let dragging = false;

function angleFromClient(clientX, clientY) {
  const p = svgPoint(orbitSvg, clientX, clientY);
  // moonPositionOnOrbit() の逆算： x=ORBIT_CX-R*cos(phi), y=ORBIT_CY+R*sin(phi)
  return Math.atan2(p.y - ORBIT_CY, ORBIT_CX - p.x);
}

function setSimDayFromDraggedAngle(phi) {
  const targetElong = norm360(phi * DEG);
  const found = findDateForElongation(targetElong, dateForSimDay(simDay));
  setSimDay((found.getTime() - DAY0.getTime()) / 86400000);
}

function onPointerDown(e) {
  dragging = true;
  stopPlaying();
  moonHit.setPointerCapture(e.pointerId);
  setSimDayFromDraggedAngle(angleFromClient(e.clientX, e.clientY));
}
function onPointerMove(e) {
  if (!dragging) return;
  setSimDayFromDraggedAngle(angleFromClient(e.clientX, e.clientY));
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
buildHorizonScene();
resizeHorizon();   // 最初のレイアウトの縦横比に、初回描画から合わせておく
if (window.ResizeObserver) {
  new ResizeObserver(resizeHorizon).observe(horizonSvg);
} else {
  window.addEventListener('resize', resizeHorizon);
}
moonHit.addEventListener('pointerdown', onPointerDown);
moonHit.addEventListener('pointermove', onPointerMove);
moonHit.addEventListener('pointerup', onPointerUp);
moonHit.addEventListener('pointercancel', onPointerUp);
render();
