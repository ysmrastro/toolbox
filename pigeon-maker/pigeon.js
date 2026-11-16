'use strict';
/*
 * 鳩（ドバト Columba livia）を横向きの SVG で描く。
 *
 * 寸法の根拠:
 *   翼長・跗蹠長・体重 … Acta Vet Scand 2010;52:45 の表1（Madrid の市街地ドバト n=118）
 *       翼長 221.4mm（200–237）／跗蹠 31.6mm（27.2–36.3）／体重 275.6g（168–385）
 *   全長 … 二次資料（Wikipedia・BirdForum・HBW を引く Oiseaux-birds）の 29–37cm の中ほど 33cm
 *   尾・くちばし・首・頭の長さ … 文献値を取れていない。見た目の釣り合いからの「仮」の値
 *
 * 絵の縮尺は 1mm = U px。体の大きさ s は「翼長が平均の何倍か」。
 * 跗蹠は体の大きさと独立に変えられるので s を掛けない。
 */
const PIGEON = (() => {
  const VW = 640, VH = 440, GY = 382, U = 1.25;
  const TILT = -12, CB = Math.cos(TILT * Math.PI / 180), SB = Math.sin(TILT * Math.PI / 180);
  const rot = (x, y) => ({ x: x * CB - y * SB, y: x * SB + y * CB });
  const f = n => Math.round(n * 10) / 10;
  const REF = { wing: 221.4, tarsus: 31.6, weight: 275.6, length: 33 };

  // real: 文献の範囲に収まる幅 / fun: ありえない個体も作るときの幅
  // src: 'lit' = 文献の実測の範囲、'est' = 仮
  const PARAMS = [
    { sec: '体つき' },
    { key: 'size',   label: '体の大きさ（翼長）', real: [91, 107],  fun: [55, 160], def: 100, src: 'lit', note: '翼長 200–237mm' },
    { key: 'girth',  label: '胴まわり',           real: [78, 118],  fun: [55, 170], def: 100, src: 'lit', note: '体重 168–385g に相当', lo: 'やせ', hi: 'ふっくら' },
    { key: 'length', label: '胴の長さ',           real: [92, 108],  fun: [70, 150], def: 100, src: 'est' },
    { key: 'fluff',  label: '羽毛のふくらみ',     real: [0, 100],   fun: [0, 100],  def: 50,  src: 'none', lo: 'ぴたっ', hi: 'もこもこ' },
    { key: 'tail',   label: '尾の長さ',           real: [88, 112],  fun: [50, 180], def: 100, src: 'est' },
    { sec: '脚' },
    { key: 'leg',    label: '脚の長さ（跗蹠）',   real: [87, 114],  fun: [45, 230], def: 100, src: 'lit', note: '跗蹠 27.2–36.3mm' },
    { key: 'legw',   label: '脚の太さ',           real: [88, 115],  fun: [60, 220], def: 100, src: 'est' },
    { sec: '顔' },
    { key: 'head',   label: '頭の大きさ',         real: [92, 108],  fun: [60, 190], def: 100, src: 'est' },
    { key: 'neck',   label: '首の長さ',           real: [85, 115],  fun: [45, 210], def: 100, src: 'est' },
    { key: 'beak',   label: 'くちばしの長さ',     real: [88, 112],  fun: [55, 190], def: 100, src: 'est' },
    { key: 'eye',    label: '目の大きさ',         real: [90, 110],  fun: [60, 210], def: 100, src: 'est' },
    { key: 'sheen',  label: '首の玉虫色',         real: [0, 150],   fun: [0, 150],  def: 100, src: 'none', lo: 'なし', hi: '強い' },
  ];

  // 羽色は Johnston & Janiga (1995) の5型（Aouissi et al. 2021 Avian Res 12:45 が引用）+ 赤（茶）
  const MORPHS = {
    bar:     { label: '灰色（ブルーバー）', pat: 'bar',     weight: 30, body: '#8c919c', dark: '#565b68', light: '#b4b8c1', wing: '#9ba2ae', bar: '#2a2d34', tail: '#555a65', sheen: 1 },
    checker: { label: '灰色（チェッカー）', pat: 'checker', weight: 25, body: '#868b97', dark: '#515665', light: '#aeb2bc', wing: '#939aa7', bar: '#24272e', tail: '#4f545f', sheen: 1 },
    t:       { label: '灰色（Tパターン）',  pat: 't',       weight: 12, body: '#7a7f8b', dark: '#4a4f5c', light: '#9fa3ae', wing: '#80868f', bar: '#1f2228', tail: '#4a4f5a', sheen: 1.1 },
    black:   { label: '黒（スプレッド）',   pat: 'spread',  weight: 13, body: '#33353c', dark: '#141519', light: '#51545e', wing: '#3b3e46', bar: '#0e0f12', tail: '#1c1d21', sheen: 1.3 },
    white:   { label: '白',                 pat: 'none',    weight: 8,  body: '#ecece7', dark: '#c5c5be', light: '#fafaf6', wing: '#f6f6f1', bar: '#cdcdc5', tail: '#dedfd8', sheen: .12 },
    red:     { label: '赤（茶）',           pat: 'bar',     weight: 12, body: '#a45b41', dark: '#6b3425', light: '#c77d5e', wing: '#b4684b', bar: '#552a1d', tail: '#6b3425', sheen: .8 },
  };

  function mulberry32(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  function defaults() { const p = {}; PARAMS.forEach(q => { if (q.key) p[q.key] = q.def; }); return p; }

  // 個体番号から、文献の範囲に収まる個体を決める
  function fromSeed(seed) {
    const r = mulberry32(seed * 7919 + 13);
    const z = () => (r() + r() + r()) / 3;
    const p = defaults();
    PARAMS.forEach(q => { if (q.key && q.key !== 'fluff' && q.key !== 'sheen') p[q.key] = Math.round(q.real[0] + z() * (q.real[1] - q.real[0])); });
    p.fluff = Math.round(r() * 100);
    p.sheen = Math.round(60 + r() * 70);
    let w = r() * Object.values(MORPHS).reduce((s, m) => s + m.weight, 0), morph = 'bar';
    for (const k in MORPHS) { w -= MORPHS[k].weight; if (w <= 0) { morph = k; break; } }
    return { p, morph };
  }

  function geom(p, pose) {
    const s = p.size / 100, fl = p.fluff / 100;
    const a = 105 * s * p.length / 100;
    const b = 62 * s * (p.girth / 100) * (1 + .1 * fl);
    const r = 25.5 * s * p.head / 100;
    const nlen = 32 * s * p.neck / 100;
    const H = { x: a * .7 + nlen * .4, y: -b * .74 - nlen * .9 };
    const bl = 24 * s * p.beak / 100;
    const tl = 120 * s * p.tail / 100;
    const tarsus = REF.tarsus * U * p.leg / 100;
    const ll = pose === 'sit' ? 0 : tarsus * 1.1;
    const th = 4.8 * Math.sqrt(s) * p.legw / 100;
    const wingL = REF.wing * U * s;
    const hip = { x: -a * .12, y: b * .78 };
    const rh = rot(hip.x, hip.y);
    const CY = pose === 'sit' ? GY - b * .95 - 2 : GY - ll - rh.y;
    const CX = 320 - ((H.x + r + bl) - (a + tl)) * CB / 2;
    const hw = { x: CX + rh.x, y: CY + rh.y };
    const headTop = CY + rot(H.x, H.y).y - r;
    return { s, fl, a, b, r, nlen, H, bl, tl, tarsus, ll, th, wingL, hip, CX, CY, hw, span: H.x + r + bl + a + tl, height: GY - headTop, pose };
  }

  function info(p, morphKey, pose) {
    const G = geom(p, pose), d = geom(defaults(), pose);
    return {
      wingMm: REF.wing * G.s,
      tarsusMm: REF.tarsus * p.leg / 100,
      weightG: REF.weight * Math.pow(G.s, 3) * Math.pow(p.girth / 100, 2),
      lengthCm: REF.length * (G.span / d.span) ,
      morph: MORPHS[morphKey].label,
    };
  }

  // ---- 部品 ----
  function scallops(x0, x1, y0, y1, sc, col, rnd, op) {
    let out = '';
    const dy = sc * .8;
    let row = 0;
    for (let y = y0; y < y1; y += dy, row++) {
      for (let x = x0 + (row % 2) * sc; x < x1; x += sc * 2) {
        const jx = (rnd() - .5) * sc * .6, jy = (rnd() - .5) * sc * .4, w = sc * (.85 + rnd() * .3);
        const X = x + jx, Y = y + jy, sh = rnd();
        out += `<path d="M${f(X - w)},${f(Y)}Q${f(X)},${f(Y + sc * 1.6)} ${f(X + w)},${f(Y)}" fill="${sh > .5 ? '#fff' : '#000'}" fill-opacity="${f(.04 + rnd() * .08)}" stroke="${col}" stroke-opacity="${op}" stroke-width=".9"/>`;
      }
    }
    return out;
  }

  function leg(id, x, y, G, col, toeCol, shade) {
    const s = G.s, th = G.th, L = G.ll;
    const ay = L - 3 * s;
    const toe = (x2, y2, bend) => `<path d="M0,${f(ay)}Q${f(x2 * .5)},${f(ay + bend)} ${f(x2)},${f(y2)}" stroke="${toeCol}" stroke-width="${f(th * .85)}" stroke-linecap="round" fill="none"/><circle cx="${f(x2)}" cy="${f(y2)}" r="${f(th * .55)}" fill="#2b2327"/>`;
    return `<g transform="translate(${f(x)} ${f(y)})"><g id="${id}">
      <line x1="0" y1="${f(-6 * s)}" x2="0" y2="${f(ay)}" stroke="${col}" stroke-width="${f(th)}" stroke-linecap="round"/>
      <line x1="0" y1="${f(2 * s)}" x2="0" y2="${f(ay)}" stroke="${shade}" stroke-width="${f(th)}" stroke-dasharray="1.4 2.6" opacity=".55"/>
      ${toe(26 * s, L, 1.5 * s)}${toe(19 * s, L - .5 * s, 3 * s)}${toe(-14 * s, L, 1.5 * s)}
      <circle cx="0" cy="${f(ay)}" r="${f(th * .75)}" fill="${col}"/>
    </g></g>`;
  }

  function neckPath(G, dx, dy) {
    const { a, b, r, s } = G;
    const P1 = { x: a * .12, y: -b * .92 }, P2 = { x: a * 1.02, y: -b * .28 };
    const Hc = { x: G.H.x + dx, y: G.H.y + dy };
    const Hb = { x: Hc.x - r * .9, y: Hc.y + r * .55 }, Hf = { x: Hc.x + r * .62, y: Hc.y + r * .92 };
    const c1 = { x: (P1.x + Hb.x) / 2 - 6 * s, y: (P1.y + Hb.y) / 2 + 4 * s };
    const c2 = { x: (Hf.x + P2.x) / 2 + 10 * s, y: (Hf.y + P2.y) / 2 - 2 };
    return `M${f(P1.x)},${f(P1.y)}Q${f(c1.x)},${f(c1.y)} ${f(Hb.x)},${f(Hb.y)}L${f(Hf.x)},${f(Hf.y)}Q${f(c2.x)},${f(c2.y)} ${f(P2.x)},${f(P2.y)}L${f(P2.x - a * .2)},${f(P2.y + b * .6)}L${f(P1.x)},${f(P1.y + b * .7)}Z`;
  }

  // ---- 組み立て ----
  function build(p, morphKey, pose, seed) {
    const M = MORPHS[morphKey], G = geom(p, pose);
    const { s, fl, a, b, r, tl, bl, H } = G;
    const rnd = mulberry32((seed || 1) * 31 + 7);
    const sheen = Math.min(1, M.sheen * p.sheen / 100 * .62);
    const fz = f(2 + fl * 13);
    const bodyD = `M${f(-a * .95)},${f(-b * .05)}C${f(-a * .7)},${f(-b * .95)} ${f(a * .1)},${f(-b * 1.05)} ${f(a * .55)},${f(-b * .8)}C${f(a * 1.05)},${f(-b * .5)} ${f(a * (1.08 + .06 * fl))},${f(b * .35)} ${f(a * .55)},${f(b * .9)}C${f(a * .1)},${f(b * 1.05)} ${f(-a * .7)},${f(b * .8)} ${f(-a * .95)},${f(-b * .05)}Z`;

    // 翼（手首から翼端まで、翼長の実測値で決める）
    const Wx = a * .7, Wy = -b * .45, L = G.wingL, Tx = Wx - L, Ty = b * .3;
    const wingD = `M${f(Wx)},${f(Wy)}C${f(Wx - L * .25)},${f(-b * 1.02)} ${f(Wx - L * .7)},${f(-b * .8)} ${f(Tx)},${f(Ty)}C${f(Tx + L * .3)},${f(b * .62)} ${f(Wx - L * .3)},${f(b * .66)} ${f(Wx + a * .05)},${f(Wy + b * .62)}C${f(Wx + a * .18)},${f(Wy + b * .3)} ${f(Wx + a * .12)},${f(Wy + b * .08)} ${f(Wx)},${f(Wy)}Z`;
    const bar = frac => { const x = Wx - L * frac; return `<path d="M${f(x + 16 * s)},${f(-b * 1.0)}Q${f(x - 6 * s)},${f(-b * .15)} ${f(x + 6 * s)},${f(b * .7)}" stroke="${M.bar}" stroke-width="${f(9 * s)}" fill="none" opacity="${morphKey === 'white' ? .5 : .9}"/>`; };
    let covert = '';
    if (M.pat === 'checker') {
      for (let i = 0; i < 46; i++) { const cx = Wx - L * (.04 + rnd() * .5), cy = -b * .9 + rnd() * b * 1.1, w = (5 + rnd() * 4) * s; covert += `<rect x="${f(cx)}" y="${f(cy)}" width="${f(w)}" height="${f(w * .9)}" rx="${f(w * .25)}" fill="${M.bar}" fill-opacity=".8"/>`; }
    } else if (M.pat === 't') {
      covert = `<path d="M${f(Wx + 6)},${f(-b * 1.1)}L${f(Wx - L * .56)},${f(-b * 1.1)}L${f(Wx - L * .5)},${f(b * .5)}L${f(Wx + 6)},${f(b * .5)}Z" fill="${M.bar}" fill-opacity=".72"/>`;
    } else if (M.pat === 'spread') {
      covert = `<rect x="${f(Tx)}" y="${f(-b * 1.1)}" width="${f(L + 12)}" height="${f(b * 1.7)}" fill="${M.bar}" fill-opacity=".5"/>`;
    }
    let flight = '';
    for (let i = 0; i < 16; i++) {
      const y = -b * .55 + i * b * .075, x0 = Wx - L * (.5 + rnd() * .12);
      flight += `<path d="M${f(x0)},${f(y)}Q${f(x0 - L * .25)},${f(y + b * .04)} ${f(Tx + rnd() * 30 * s)},${f(Ty + (y - Ty) * .25)}" stroke="${M.bar}" stroke-opacity=".28" stroke-width=".9" fill="none"/>`;
    }

    // 尾（先に暗い帯）
    const bx = -a * .7;
    const tailD = `M${f(bx)},${f(-b * .32)}C${f(-a - tl * .4)},${f(-b * .38)} ${f(-a - tl * .9)},${f(-b * .24)} ${f(-a - tl)},${f(-b * .04)}L${f(-a - tl * .98)},${f(b * .26)}C${f(-a - tl * .8)},${f(b * .4)} ${f(-a - tl * .3)},${f(b * .42)} ${f(bx)},${f(b * .36)}Z`;
    let tailLines = '';
    for (let i = 0; i < 7; i++) { const y = -b * .28 + i * b * .09; tailLines += `<path d="M${f(bx - 8)},${f(y)}L${f(-a - tl * (.96 - i * .004))},${f(-b * .02 + i * b * .045)}" stroke="#000" stroke-opacity=".16" stroke-width=".9"/>`; }

    // ---- 層B: 体（静止）----
    const B = `
<defs>
 <filter id="fz" x="-15%" y="-30%" width="130%" height="160%"><feTurbulence type="fractalNoise" baseFrequency=".05 .09" numOctaves="3" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${fz}" xChannelSelector="R" yChannelSelector="G"/></filter>
 <filter id="fz2" x="-15%" y="-30%" width="130%" height="160%"><feTurbulence type="fractalNoise" baseFrequency=".06 .1" numOctaves="2" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${f(fz * .6)}" xChannelSelector="R" yChannelSelector="G"/></filter>
 <clipPath id="cb"><path d="${bodyD}"/></clipPath>
 <clipPath id="cw"><path d="${wingD}"/></clipPath>
 <linearGradient id="gb" gradientUnits="userSpaceOnUse" x1="0" y1="${f(-b)}" x2="0" y2="${f(b)}"><stop offset="0" stop-color="${M.body}"/><stop offset=".5" stop-color="${M.light}"/><stop offset="1" stop-color="${M.body}"/></linearGradient>
 <linearGradient id="gs" gradientUnits="userSpaceOnUse" x1="0" y1="${f(-b * .1)}" x2="0" y2="${f(b)}"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient>
 <radialGradient id="gh" gradientUnits="userSpaceOnUse" cx="${f(a * .2)}" cy="${f(-b * .55)}" r="${f(a * .95)}"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
 <radialGradient id="gc" gradientUnits="userSpaceOnUse" cx="${f(a * .85)}" cy="${f(-b * .35)}" r="${f(b * .8)}"><stop offset="0" stop-color="#3fae86" stop-opacity="${f(sheen * .6)}"/><stop offset=".55" stop-color="#9a52c9" stop-opacity="${f(sheen * .22)}"/><stop offset=".85" stop-color="#9a52c9" stop-opacity="0"/></radialGradient>
 <linearGradient id="gw" gradientUnits="userSpaceOnUse" x1="${f(Wx)}" y1="0" x2="${f(Tx)}" y2="0"><stop offset="0" stop-color="${M.wing}"/><stop offset=".62" stop-color="${M.wing}"/><stop offset="1" stop-color="${M.bar}" stop-opacity=".85"/></linearGradient>
 <linearGradient id="gt" gradientUnits="userSpaceOnUse" x1="${f(bx)}" y1="0" x2="${f(-a - tl)}" y2="0"><stop offset="0" stop-color="${M.body}"/><stop offset=".5" stop-color="${M.tail}"/><stop offset=".74" stop-color="${M.bar}"/><stop offset=".96" stop-color="${M.bar}"/><stop offset="1" stop-color="${M.light}"/></linearGradient>
</defs>
<g transform="translate(${f(G.CX)} ${f(G.CY)}) rotate(${TILT})">
 <g filter="url(#fz2)"><path d="${tailD}" fill="url(#gt)"/>${tailLines}</g>
 ${G.pose === 'sit' ? '' : `<g filter="url(#fz)"><ellipse cx="${f(a * .06)}" cy="${f(b * .72)}" rx="${f(a * .22)}" ry="${f(b * .3)}" fill="${M.dark}"/></g>`}
 <g filter="url(#fz)">
  <path d="${bodyD}" fill="url(#gb)"/>
  <g clip-path="url(#cb)">
   ${scallops(-a, a * 1.1, -b, b, (7 + fl * 6) * s, M.dark, rnd, .22)}
   <rect x="${f(-a)}" y="${f(-b * 1.1)}" width="${f(a * 2.3)}" height="${f(b * 2.3)}" fill="url(#gh)"/>
   <rect x="${f(-a)}" y="${f(-b * 1.1)}" width="${f(a * 2.3)}" height="${f(b * 2.3)}" fill="url(#gs)"/>
   <rect x="${f(-a)}" y="${f(-b * 1.1)}" width="${f(a * 2.3)}" height="${f(b * 2.3)}" fill="url(#gc)"/>
  </g>
 </g>
 <g filter="url(#fz2)">
  <path d="${wingD}" fill="url(#gw)"/>
  <g clip-path="url(#cw)">
   ${M.pat === 'bar' || M.pat === 'checker' ? bar(.3) + bar(.5) : ''}${covert}
   ${scallops(Tx + L * .5, Wx + 4, -b, b * .6, 10 * s, M.dark, rnd, .3)}
   ${flight}
  </g>
  <path d="${wingD}" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="1.1"/>
 </g>
</g>`;

    // ---- 層C: 首と頭（動く）----
    const Cc = `
<defs>
 <filter id="bl"><feGaussianBlur stdDeviation="${f(6 * s)}"/></filter>
 <mask id="nm" maskContentUnits="objectBoundingBox"><linearGradient id="nmg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".22" stop-color="#fff" stop-opacity="1"/></linearGradient><rect width="1" height="1" fill="url(#nmg)"/></mask>
 <clipPath id="ch"><ellipse rx="${f(r * 1.08)}" ry="${f(r * .94)}"/></clipPath>
 <clipPath id="nk"><path id="nkp" d="${neckPath(G, 0, 0)}"/></clipPath>
 <linearGradient id="gn" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${M.dark}" stop-opacity=".4"/><stop offset=".45" stop-color="${M.dark}" stop-opacity=".97"/><stop offset="1" stop-color="${M.dark}"/></linearGradient>
 <radialGradient id="gha" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="${M.light}" stop-opacity=".55"/><stop offset=".5" stop-color="${M.dark}"/><stop offset="1" stop-color="${M.dark}"/></radialGradient>
 <radialGradient id="gi" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffc24a"/><stop offset=".7" stop-color="#e5600c"/><stop offset="1" stop-color="#a63a06"/></radialGradient>
</defs>
<g transform="translate(${f(G.CX)} ${f(G.CY)}) rotate(${TILT})">
 <path id="neck" d="${neckPath(G, 0, 0)}" fill="url(#gn)" filter="url(#fz2)" mask="url(#nm)"/>
 <g clip-path="url(#nk)"><g id="sheen" opacity="${f(sheen)}" filter="url(#bl)">
  <ellipse cx="${f(H.x - r * .1)}" cy="${f(H.y + r * 1.5)}" rx="${f(r * 1.1)}" ry="${f(r * .85)}" fill="#2fb27a"/>
  <ellipse cx="${f(H.x + r * .1)}" cy="${f(H.y + r * 2.2)}" rx="${f(r * 1.5)}" ry="${f(r * .7)}" fill="#8f4fc4"/>
  <ellipse cx="${f(H.x - r * .5)}" cy="${f(H.y + r * 2.0)}" rx="${f(r * .5)}" ry="${f(r * .6)}" fill="#2a9db0"/>
 </g></g>
 <g clip-path="url(#nk)"><g id="neckTex">${scallops(H.x - r * 1.5, H.x + r * 1.4, H.y - r * .2, H.y + r * 3.4, 4.6 * s, M.dark, rnd, .38)}</g></g>
 <g id="head" transform="translate(${f(H.x)} ${f(H.y)}) rotate(14)">
  <ellipse rx="${f(r * 1.12)}" ry="${f(r * .98)}" fill="url(#gha)" filter="url(#fz2)"/>
  <g clip-path="url(#ch)">${scallops(-r * 1.2, r * 1.1, -r, r, 3.6 * s, M.dark, rnd, .3)}</g>
  <path d="M${f(r * .9)},${f(-r * .2)}C${f(r * .9 + bl * .5)},${f(-r * .27)} ${f(r * .9 + bl * .85)},${f(-r * .2)} ${f(r * .9 + bl)},${f(r * .13)}C${f(r * .9 + bl * .7)},${f(r * .13)} ${f(r * .9 + bl * .4)},${f(r * .1)} ${f(r * .9)},${f(r * .1)}Z" fill="#3a3a41"/>
  <path d="M${f(r * .9)},${f(r * .1)}Q${f(r * .9 + bl * .5)},${f(r * .06)} ${f(r * .9 + bl * .96)},${f(r * .12)}" stroke="#15151a" stroke-width="1" fill="none"/>
  <ellipse cx="${f(r * .9 + bl * .26)}" cy="${f(-r * .17)}" rx="${f(bl * .24)}" ry="${f(bl * .15)}" fill="#efe9e1" stroke="#cdc4b8" stroke-width=".8"/>
  <g id="eye" transform="translate(${f(r * .36)} ${f(-r * .14)})">
   <circle r="${f(r * .27 * p.eye / 100 * 1.25)}" fill="none" stroke="#cbbab0" stroke-opacity=".7" stroke-width="${f(r * .08)}"/>
   <circle r="${f(r * .27 * p.eye / 100)}" fill="url(#gi)"/>
   <circle r="${f(r * .14 * p.eye / 100)}" fill="#0a0a0c"/>
   <circle cx="${f(-r * .07)}" cy="${f(-r * .08)}" r="${f(r * .05)}" fill="#fff" fill-opacity=".9"/>
  </g>
 </g>
</g>`;

    // ---- 層A: 背景・影・脚（脚は動く）----
    let tiles = '';
    for (let i = 0; i < 5; i++) { const y = GY + 6 + i * i * 4 + i * 8; tiles += `<line x1="0" y1="${y}" x2="${VW}" y2="${y}" stroke="#000" stroke-opacity="${f(.1 + i * .02)}"/>`; }
    for (let i = -6; i < 14; i++) tiles += `<line x1="${320 + (i - 4) * 36}" y1="${GY + 4}" x2="${320 + (i - 4) * 90}" y2="${VH}" stroke="#000" stroke-opacity=".09"/>`;
    const A = `
<defs>
 <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#46686a"/><stop offset="1" stop-color="#2c4745"/></linearGradient>
 <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b5a54"/><stop offset="1" stop-color="#1d312d"/></linearGradient>
 <filter id="sb"><feGaussianBlur stdDeviation="5"/></filter>
</defs>
<rect width="${VW}" height="${VH}" fill="url(#bg)"/>
<rect y="${GY - 8}" width="${VW}" height="${VH - GY + 8}" fill="url(#gr)"/>
${tiles}
<ellipse cx="${f(G.CX - 10)}" cy="${GY + 3}" rx="${f(G.a * 1.25 + G.tl * .35)}" ry="9" fill="#000" fill-opacity=".38" filter="url(#sb)"/>
${G.pose === 'sit' ? '' : leg('legF', G.hw.x + 15 * s, G.hw.y, G, '#9a3249', '#a63a52', '#4a1020') + leg('legN', G.hw.x, G.hw.y, G, '#cf4b64', '#d9566e', '#6d1a2c')}`;

    return { A, B, C: Cc, G };
  }

  // ---- 動き ----
  function bind(stage, G) {
    const q = id => stage.querySelector('#' + id);
    return { G, layers: [...stage.querySelectorAll('svg')], neck: q('neck'), nkp: q('nkp'), sheen: q('sheen'), tex: q('neckTex'), head: q('head'), legN: q('legN'), legF: q('legF') };
  }

  function tick(h, t, pose) {
    const G = h.G; const s = G.s;
    let dx = 0, dy = 0, hr = 0, bob = 0, ln = 0, lf = 0;
    if (pose === 'walk') {
      const T = .72, u = (t % T) / T, hold = .64;
      dx = u < hold ? -(u / hold) * 17 * s : -17 * s * (1 - (u - hold) / (1 - hold)) ** 2;
      ln = 26 * Math.sin(u * Math.PI * 2); lf = -ln;
      bob = Math.abs(Math.sin(u * Math.PI * 2)) * -1.5;
    } else if (pose === 'look') {
      dx = 4 * Math.sin(t * 1.3) * s; dy = 3 * Math.sin(t * .9) * s; hr = 16 * Math.sin(t * 1.1) + 6 * Math.sin(t * 2.7);
      bob = Math.sin(t * 1.8) * .4;
    } else {
      bob = Math.sin(t * 2) * .5; dy = Math.sin(t * 2) * .4;
    }
    if (h.neck) h.neck.setAttribute('d', neckPath(G, dx, dy));
    if (h.nkp) h.nkp.setAttribute('d', neckPath(G, dx, dy));
    if (h.sheen) h.sheen.setAttribute('transform', `translate(${f(dx)} ${f(dy)})`);
    if (h.tex) h.tex.setAttribute('transform', `translate(${f(dx)} ${f(dy)})`);
    if (h.head) h.head.setAttribute('transform', `translate(${f(G.H.x + dx)} ${f(G.H.y + dy)}) rotate(${f(14 + hr)})`);
    if (h.legN) h.legN.setAttribute('transform', `rotate(${f(ln)})`);
    if (h.legF) h.legF.setAttribute('transform', `rotate(${f(lf)})`);
    const w = h.layers[0] ? h.layers[0].clientWidth : VW, k = w / VW;
    if (h.layers[1]) h.layers[1].style.transform = `translateY(${f(bob * k)}px)`;
    if (h.layers[2]) h.layers[2].style.transform = `translateY(${f(bob * k)}px)`;
  }

  return { VW, VH, REF, PARAMS, MORPHS, defaults, fromSeed, build, info, bind, tick };
})();
if (typeof module !== 'undefined') module.exports = PIGEON;
