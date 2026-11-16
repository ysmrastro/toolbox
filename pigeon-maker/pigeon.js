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

  // 体の大きさに対して、体重が文献の範囲（168–385g）に収まる胴まわりの範囲。
  // 体重は 大きさ³ × 胴まわり² なので、大きさを変えると胴まわりの上下限も動く。
  // 大きさが実在の範囲（91〜107%）のときだけ意味がある。範囲の外では実在の範囲外の値を返すので、「ありえない個体」のときは使わない。
  function girthRange(size) {
    const g = PARAMS.find(x => x.key === 'girth'), w = REF.weight * Math.pow(size / 100, 3);
    const lo = Math.max(g.real[0], Math.ceil(100 * Math.sqrt(168 / w))), hi = Math.min(g.real[1], Math.floor(100 * Math.sqrt(385 / w)));
    return lo <= hi ? [lo, hi] : [Math.round((lo + hi) / 2), Math.round((lo + hi) / 2)];
  }

  // 個体番号から、文献の範囲に収まる個体を決める。
  // 体重・全長が範囲を外れたら、同じ番号から決まる次の候補を引き直す（番号が同じなら結果も同じ）
  function fromSeed(seed) {
    let res;
    for (let k = 0; k < 40; k++) {
      const r = mulberry32(seed * 7919 + 13 + k * 104729);
      const z = () => (r() + r() + r()) / 3;
      const p = defaults();
      PARAMS.forEach(q => {
        if (!q.key || q.key === 'fluff' || q.key === 'sheen') return;
        const [lo, hi] = q.key === 'girth' ? girthRange(p.size) : q.real;
        p[q.key] = Math.round(lo + z() * (hi - lo));
      });
      p.fluff = Math.round(r() * 100);
      p.sheen = Math.round(60 + r() * 70);
      let w = r() * Object.values(MORPHS).reduce((t, m) => t + m.weight, 0), morph = 'bar';
      for (const key in MORPHS) { w -= MORPHS[key].weight; if (w <= 0) { morph = key; break; } }
      res = { p, morph };
      const len = info(p, morph, 'stand').lengthCm;
      if (len >= 29 && len <= 37) break;
    }
    return res;
  }

  // 貼り付けられた設定を検査して、安全な値だけを取り出す。不正なら null
  function parseSettings(text) {
    let o;
    try { o = JSON.parse(text); } catch (_) { return null; }
    if (!o || typeof o !== 'object' || !Object.hasOwn(MORPHS, o.morph)) return null;
    const seed = Math.min(9999, Math.max(1, Math.floor(Number(o.seed)) || 1));
    const p = defaults();
    PARAMS.forEach(q => {
      if (!q.key || !o.p || typeof o.p[q.key] !== 'number' || !Number.isFinite(o.p[q.key])) return;
      p[q.key] = Math.round(Math.min(q.fun[1], Math.max(q.fun[0], o.p[q.key])));
    });
    return { seed, morph: o.morph, p };
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

  // ---- 色と羽 ----
  const hex2 = h => { if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; return [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)); };
  const mix = (a, b, t) => { const A = hex2(a), B = hex2(b); t = Math.max(0, Math.min(1, t)); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

  // 羽1枚。根元が原点、先が +x。ang は時計回りの度。tip を渡すと、先の側を別の色にする（帯）
  function feather(F, x, y, len, wid, ang, col, o) {
    o = o || {};
    let fill = col;
    if (o.tip) {
      const id = F.pre + (F.n++), from = o.from || .7;
      F.defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${col}"/><stop offset="${f(from)}" stop-color="${col}"/><stop offset="${f(Math.min(1, from + .09))}" stop-color="${o.tip}"/><stop offset="1" stop-color="${o.tip}"/></linearGradient>`);
      fill = `url(#${id})`;
    }
    const d = `M0,${f(-wid * .3)}C${f(len * .22)},${f(-wid)} ${f(len * .7)},${f(-wid * 1.05)} ${f(len * .97)},${f(-wid * .35)}Q${f(len * 1.03)},0 ${f(len * .97)},${f(wid * .35)}C${f(len * .7)},${f(wid * 1.05)} ${f(len * .22)},${f(wid)} 0,${f(wid * .3)}Z`;
    const head = `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(ang)})"><path d="${d}" fill="${fill}" stroke="${o.edge || '#000'}" stroke-opacity="${o.ea == null ? .32 : o.ea}" stroke-width=".6"/>`;
    if (o.simple) return head + '</g>';
    return head +
      `<path d="M0,0H${f(len * .94)}" stroke="#000" stroke-opacity=".16" stroke-width=".5"/>` +
      `<path d="M${f(len * .1)},${f(-wid * .25)}C${f(len * .3)},${f(-wid * .7)} ${f(len * .62)},${f(-wid * .75)} ${f(len * .88)},${f(-wid * .3)}" stroke="#fff" stroke-opacity="${o.hl == null ? .14 : o.hl}" stroke-width="${f(wid * .38)}" fill="none" stroke-linecap="round"/></g>`;
  }

  // ---- 部品 ----
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
    const P1 = { x: a * .12, y: -b * .92 }, P2 = { x: a * .95, y: -b * .28 };
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

    const F = { n: 0, defs: [], pre: 'fb' };
    const dk = M.bar;

    // ---- 体の輪郭羽（屋根瓦のように、後ろ・下から先に描き、前・上を重ねる）----
    const flen = (15 + fl * 8) * s, fwid = (6 + fl * 2.6) * s, sx = fwid * 1.15, sy = flen * .42;
    let bodyF = '', row = 0;
    for (let y = b * 1.02; y > -b * 1.1; y -= sy, row++) {
      for (let x = -a * 1.0 + (row % 2) * sx / 2; x < a * 1.12; x += sx) {
        const X = x + (rnd() - .5) * sx * .5, Y = y + (rnd() - .5) * sy * .5;
        const xr = X / a, v = Math.min(1, Math.max(0, (Y + b) / (2 * b)));
        const ang = 176 - 38 * v - 60 * Math.max(0, xr - .45) + (rnd() - .5) * 9;
        let c = mix(M.body, M.light, Math.sin(Math.PI * v) * .55);
        c = mix(c, '#000', Math.max(0, v - .62) * .5);
        c = mix(c, rnd() > .5 ? '#fff' : '#000', rnd() * .08);
        const dBr = Math.hypot((X - a * .85) / b, (Y + b * .35) / (b * .8));
        if (dBr < 1) c = mix(c, '#6a5aa0', (1 - dBr) * .4 * sheen * 1.4);
        bodyF += feather(F, X, Y, flen * (.9 + rnd() * .25), fwid * (.9 + rnd() * .2), ang, c, { edge: M.dark });
      }
    }

    // ---- 翼: 初列・次列風切 → 大雨覆 → 中雨覆 → 小雨覆の順に重ねる ----
    const Wx = a * .7, Wy = -b * .45, Tx0 = Wx - G.wingL, Ty = b * .3;
    const L = Math.hypot(Tx0 - Wx, Ty - Wy), th = Math.atan2(Ty - Wy, Tx0 - Wx) * 180 / Math.PI;
    const pat = M.pat, wcol = pat === 'spread' ? mix(M.wing, dk, .55) : M.wing;
    const banded = pat === 'bar' || pat === 'checker' || pat === 't';
    const bandCol = pat === 'none' ? mix(M.wing, '#8a8f98', .35) : dk;
    const covCol = pat === 't' ? mix(M.wing, dk, .72) : wcol;
    const wo = { edge: dk, ea: .2, hl: .05 };
    let W = '';
    const bandFrom = (len, px) => Math.max(.5, 1 - px / len);
    const fan = (y0, bx0, tipx, taper) => Math.atan2(-y0 * taper * (tipx / L), tipx - bx0) * 180 / Math.PI;   // 先が翼の中心線に収束する
    for (let i = 0; i < 9; i++) {   // 初列風切（暗い）
      const bx0 = L * (.36 + i * .02), tipx = L * (.99 - i * .032), y0 = b * .1 - i * b * .03, len = tipx - bx0;
      W += feather(F, bx0, y0, len, 6.2 * s, fan(y0, bx0, tipx, .55), mix(wcol, dk, pat === 'none' ? .12 : .5), { tip: mix(wcol, dk, pat === 'none' ? .2 : .8), from: bandFrom(len, 16 * s), edge: dk, ea: .2, hl: .05 });
    }
    for (let j = 0; j < 8; j++) {   // 次列風切（先に帯）
      const bx0 = L * (.2 + j * .012), tipx = L * .62 + j * s * .6, y0 = -b * .02 - j * b * .05, len = tipx - bx0;
      W += feather(F, bx0, y0, len, 7 * s, fan(y0, bx0, tipx, .5), mix(wcol, dk, .16), banded || pat === 'none' ? { tip: bandCol, from: bandFrom(len, 13 * s), edge: dk, ea: .2, hl: .05 } : wo);
    }
    for (let i = 0; i < 11; i++) {  // 大雨覆（先に帯）
      const bx0 = L * .12, tipx = L * .43, y0 = b * .36 - i * b * .047, len = tipx - bx0;
      W += feather(F, bx0, y0, len, 7.5 * s, fan(y0, bx0, tipx, .3), covCol, banded && pat !== 't' ? { tip: bandCol, from: bandFrom(len, 13 * s), edge: dk, ea: .2, hl: .05 } : wo);
    }
    for (let i = 0; i < 12; i++) {  // 中雨覆（チェッカーは先が暗い）
      const dark = pat === 'checker' && rnd() < .7, bx0 = L * .03, tipx = L * .25, y0 = b * .44 - i * b * .047;
      W += feather(F, bx0, y0, tipx - bx0, 6.4 * s, fan(y0, bx0, tipx, .25), covCol, dark ? { tip: mix(wcol, dk, .82), from: .5, edge: dk, ea: .2, hl: .05 } : wo);
    }
    for (let i = 0; i < 13; i++) {  // 小雨覆
      const dark = pat === 'checker' && rnd() < .55, bx0 = -L * .03, tipx = L * .13, y0 = b * .47 - i * b * .036;
      W += feather(F, bx0, y0, tipx - bx0, 5.2 * s, fan(y0, bx0, tipx, .2), covCol, dark ? { tip: mix(wcol, dk, .8), from: .45, edge: dk, ea: .2, hl: .05 } : wo);
    }

    // ---- 尾: 12枚の尾羽。先に暗い帯 ----
    const bx = -a * .7;
    let tailF = '';
    for (let k = 0; k < 12; k++) {
      const o = Math.abs(k - 5.5);
      tailF += feather(F, bx, -b * .05 + (k - 5.5) * b * .03, tl + a * .3 - o * s * .8, 10.5 * s, 180 + (k - 5.5) * 2.3, mix(M.tail, M.body, .25 + (rnd() - .5) * .1), { tip: dk, from: .66, edge: dk, hl: .1 });
    }
    // ---- もも（脚のつけ根の羽毛）----
    let thigh = '';
    if (G.pose !== 'sit') for (let i = 0; i < 16; i++) thigh += feather(F, a * .06 + (rnd() - .5) * a * .3, b * .55 + rnd() * b * .3, 14 * s, 5.6 * s, 100 + rnd() * 50, mix(M.dark, M.body, .35 + rnd() * .2), { edge: dk });

    const B = `
<defs>
 <clipPath id="cb"><path d="${bodyD}"/></clipPath>
 <linearGradient id="gs" gradientUnits="userSpaceOnUse" x1="0" y1="${f(-b * .1)}" x2="0" y2="${f(b)}"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
 <radialGradient id="gh" gradientUnits="userSpaceOnUse" cx="${f(a * .2)}" cy="${f(-b * .6)}" r="${f(a * .95)}"><stop offset="0" stop-color="#fff" stop-opacity=".26"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
 ${F.defs.join('')}
</defs>
<g transform="translate(${f(G.CX)} ${f(G.CY)}) rotate(${TILT})">
 ${tailF}
 ${thigh}
 <g>
  <path d="${bodyD}" fill="${M.body}"/>
  <g clip-path="url(#cb)">
   ${bodyF}
   <rect x="${f(-a)}" y="${f(-b * 1.1)}" width="${f(a * 2.3)}" height="${f(b * 2.3)}" fill="url(#gh)"/>
   <rect x="${f(-a)}" y="${f(-b * 1.1)}" width="${f(a * 2.3)}" height="${f(b * 2.3)}" fill="url(#gs)"/>
  </g>
 </g>
 <g transform="translate(${f(Wx)} ${f(Wy)}) rotate(${f(th)})">${W}</g>
</g>`;

    // ---- 層C: 首と頭（動く。フィルタを使わず、拡大しても崩れない）----
    const F2 = { n: 0, defs: [], pre: 'fc' };
    const Pn = [{ x: a * .12, y: -b * .92 }, { x: H.x - r * .9, y: H.y + r * .55 }, { x: H.x + r * .62, y: H.y + r * .92 }, { x: a * .95, y: -b * .28 }, { x: a * .82, y: b * .32 }, { x: a * .12, y: -b * .22 }];
    // 羽を置く範囲は、歩くときの頭の後退（約17s）の分だけ前側を広げる。切り抜き（nk）が実際の首の形を決める
    const PnW = Pn.map((q, i) => (i >= 2 && i <= 4 ? { x: q.x + 20 * s, y: q.y } : q));
    const inPoly = (x, y) => { let c = false; for (let i = 0, j = PnW.length - 1; i < PnW.length; j = i++) { if ((PnW[i].y > y) !== (PnW[j].y > y) && x < (PnW[j].x - PnW[i].x) * (y - PnW[i].y) / (PnW[j].y - PnW[i].y) + PnW[i].x) c = !c; } return c; };
    const GRN = '#2fb27a', TEAL = '#2a9db0', PUR = '#9a52c9';
    let neckF = '';
    const nw = 3 * s, nl = 7.6 * s;
    for (let y = H.y + r * 3.9; y > H.y - r * .2; y -= nl * .42) {
      for (let x = Math.min(Pn[0].x, Pn[1].x) - 6; x < Math.max(Pn[2].x, Pn[3].x) + 6 + 20 * s; x += nw * 1.15) {
        const X = x + (rnd() - .5) * nw * .6, Y = y + (rnd() - .5) * nl * .3;
        if (!inPoly(X, Y)) continue;
        const tt = Math.min(1, Math.max(0, (Y - (H.y + r * .4)) / (r * 2.6)));
        const w = sheen * Math.exp(-Math.pow((Y - (H.y + r * 1.7)) / (r * 1.25), 2)) * Math.min(1, Math.max(0, (X - Pn[0].x) / (r * 1.0)));
        const tone = tt + (rnd() - .5) * .5 < .38 ? GRN : (tt + (rnd() - .5) * .4 < .62 ? TEAL : PUR);
        const yb = Pn[5].y + (Pn[4].y - Pn[5].y) * Math.min(1, Math.max(0, (X - Pn[5].x) / (Pn[4].x - Pn[5].x)));
        const fadeBottom = Math.min(1, Math.max(0, (yb - Y) / (r * 1.5)));   // 下端は体の色に溶かす
        const tf = Math.min(1, Math.max(0, (Y - Pn[2].y) / (Pn[3].y - Pn[2].y)));
        const xf = Pn[2].x + (Pn[3].x - Pn[2].x) * tf;                          // 首の前縁（のど〜胸）
        const fadeFront = Y > H.y + r * 1.6 ? Math.min(1, Math.max(0, (xf - X) / (r * 1.1))) : 1;   // 胸のあたりは前縁も溶かす
        const fade = Math.min(fadeBottom, fadeFront);
        const c = mix(mix(M.body, M.light, .25), mix(mix(M.dark, M.light, .12 + rnd() * .1), tone, w * (.55 + rnd() * .45) * .95), fade);
        neckF += feather(F2, X, Y, nl, nw, 95 + (rnd() - .5) * 22 + Math.max(0, (X - H.x)) * .4, c, { edge: M.dark, simple: true });
      }
    }
    let headF = '';
    for (let y = r * 1.0; y > -r * 1.0; y -= r * .16) {
      for (let x = -r * 1.2; x < r * 1.1; x += r * .15) {
        const X = x + (rnd() - .5) * r * .08, Y = y + (rnd() - .5) * r * .06;
        const c = mix(M.dark, M.light, .22 * Math.max(0, .6 - (Y / r + 1) / 2) + rnd() * .12);
        headF += feather(F2, X, Y, r * .34, r * .14, 178 + (rnd() - .5) * 20, c, { edge: M.dark, simple: true });
      }
    }

    const Cc = `
<defs>
 <mask id="nm" maskUnits="userSpaceOnUse" x="${f(-a * 2)}" y="${f(-b * 4)}" width="${f(a * 5)}" height="${f(b * 8)}"><linearGradient id="nmg" gradientUnits="userSpaceOnUse" x1="${f(a * .12)}" y1="0" x2="${f(a * .12 + r * .9)}" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient><rect x="${f(-a * 2)}" y="${f(-b * 4)}" width="${f(a * 5)}" height="${f(b * 8)}" fill="url(#nmg)"/></mask>
 <clipPath id="ch"><ellipse rx="${f(r * 1.1)}" ry="${f(r * .96)}"/></clipPath>
 <clipPath id="nk"><path id="nkp" d="${neckPath(G, 0, 0)}"/></clipPath>
 <linearGradient id="gn" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${M.dark}" stop-opacity=".5"/><stop offset=".45" stop-color="${M.dark}" stop-opacity=".98"/><stop offset="1" stop-color="${M.dark}"/></linearGradient>
 <radialGradient id="gha" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="${M.light}" stop-opacity=".5"/><stop offset=".55" stop-color="${M.dark}"/><stop offset="1" stop-color="${M.dark}"/></radialGradient>
 <radialGradient id="gi" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffc24a"/><stop offset=".7" stop-color="#e5600c"/><stop offset="1" stop-color="#a63a06"/></radialGradient>
 ${F2.defs.join('')}
</defs>
<g transform="translate(${f(G.CX)} ${f(G.CY)}) rotate(${TILT})">
 <g mask="url(#nm)"><path id="neck" d="${neckPath(G, 0, 0)}" fill="url(#gn)"/>
 <g clip-path="url(#nk)"><g id="neckTex">${neckF}</g></g></g>
 <g id="head" transform="translate(${f(H.x)} ${f(H.y)}) rotate(14)">
  <ellipse rx="${f(r * 1.12)}" ry="${f(r * .98)}" fill="url(#gha)"/>
  <g clip-path="url(#ch)">${headF}</g>
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
    return { G, layers: [...stage.children], neck: q('neck'), nkp: q('nkp'), tex: q('neckTex'), head: q('head'), legN: q('legN'), legF: q('legF') };
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
    if (h.tex) h.tex.setAttribute('transform', `translate(${f(dx)} ${f(dy)})`);
    if (h.head) h.head.setAttribute('transform', `translate(${f(G.H.x + dx)} ${f(G.H.y + dy)}) rotate(${f(14 + hr)})`);
    if (h.legN) h.legN.setAttribute('transform', `rotate(${f(ln)})`);
    if (h.legF) h.legF.setAttribute('transform', `rotate(${f(lf)})`);
    const w = h.layers[0] ? h.layers[0].clientWidth : VW, k = w / VW;
    if (h.layers[1]) h.layers[1].style.transform = `translateY(${f(bob * k)}px)`;
    if (h.layers[2]) h.layers[2].style.transform = `translateY(${f(bob * k)}px)`;
  }

  return { VW, VH, REF, PARAMS, MORPHS, defaults, fromSeed, girthRange, parseSettings, build, info, bind, tick };
})();
if (typeof module !== 'undefined') module.exports = PIGEON;
