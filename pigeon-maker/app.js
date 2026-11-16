'use strict';
/* 画面とイベント。計算と描画は pigeon.js に置く。 */
(() => {
  const P = PIGEON;
  const POSES = [['walk', 'きまま'], ['stand', 'たちどまる'], ['look', '見回す'], ['sit', 'おすわり']];
  const stage = document.getElementById('stage');
  const infoEl = document.getElementById('info');
  const slidersEl = document.getElementById('sliders');
  const morphsEl = document.getElementById('morphs');
  const posesEl = document.getElementById('poses');
  const seedEl = document.getElementById('seed');

  const st = { seed: 1, p: P.defaults(), morph: 'bar', pose: 'walk', fun: false };
  let handles = null;
  const inputs = {};

  const rangeOf = q => (st.fun ? q.fun : q.real);

  function buildSliders() {
    slidersEl.innerHTML = '';
    P.PARAMS.forEach(q => {
      if (q.sec) {
        const h = document.createElement('div'); h.className = 'pm__sec'; h.textContent = q.sec; slidersEl.appendChild(h); return;
      }
      const row = document.createElement('div'); row.className = 'pm__row';
      const tag = q.src === 'lit' ? '<span class="pm__tag pm__tag--lit">文献</span>' : q.src === 'est' ? '<span class="pm__tag">仮</span>' : '';
      row.innerHTML = `<div><label for="s-${q.key}">${q.label} ${tag}</label><output id="o-${q.key}"></output></div>
        <input id="s-${q.key}" type="range" step="1">
        ${q.lo ? `<small><span>${q.lo}</span><span>${q.hi}</span></small>` : ''}`;
      slidersEl.appendChild(row);
      const el = row.querySelector('input');
      inputs[q.key] = { el, out: row.querySelector('output'), q };
      el.addEventListener('input', () => { st.p[q.key] = +el.value; if (q.key === 'size') applyRanges(); sync(false); });
    });
    const fun = document.createElement('label');
    fun.className = 'pm__fun';
    fun.innerHTML = '<input type="checkbox" id="fun"> ありえない個体も作る（実在の範囲を超えて動かせる）';
    slidersEl.appendChild(fun);
    fun.querySelector('input').addEventListener('change', e => { st.fun = e.target.checked; applyRanges(); sync(false); });
  }

  function applyRanges() {
    P.PARAMS.forEach(q => {
      if (!q.key) return;
      const [lo, hi] = (q.key === 'girth' && !st.fun) ? P.girthRange(st.p.size) : rangeOf(q), i = inputs[q.key];
      i.el.min = lo; i.el.max = hi;
      st.p[q.key] = Math.min(hi, Math.max(lo, st.p[q.key]));
    });
  }

  function buildChoices() {
    morphsEl.innerHTML = '';
    Object.keys(P.MORPHS).forEach(k => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.textContent = P.MORPHS[k].label; b.dataset.k = k;
      b.addEventListener('click', () => { st.morph = k; sync(true); });
      morphsEl.appendChild(b);
    });
    posesEl.innerHTML = '';
    POSES.forEach(([k, label]) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.textContent = label; b.dataset.k = k;
      b.addEventListener('click', () => { st.pose = k; sync(true); });
      posesEl.appendChild(b);
    });
  }

  let raf = 0;
  function sync() {
    P.PARAMS.forEach(q => { if (q.key) { inputs[q.key].el.value = st.p[q.key]; inputs[q.key].out.textContent = st.p[q.key] + '%'; } });
    morphsEl.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.k === st.morph)));
    posesEl.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.k === st.pose)));
    seedEl.value = st.seed;
    const i = P.info(st.p, st.morph, st.pose);
    const title = document.createElement('b');
    title.textContent = `ドバト・${i.morph}　No.${st.seed}`;
    infoEl.replaceChildren(title, document.createElement('br'), document.createTextNode(`翼長 約${(i.wingMm / 10).toFixed(1)}cm ／ 跗蹠 約${(i.tarsusMm / 10).toFixed(1)}cm ／ 体重 約${Math.round(i.weightG)}g ／ 全長 約${Math.round(i.lengthCm)}cm`));
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => render());
  }

  // 体の層（羽毛が多くフィルタも使う）は、画面の解像度に合わせた画像にして貼る。
  // SVG のまま画面サイズで描くと、スマホ（特に Safari）でフィルタが低解像度になって粗く見える。
  let renderId = 0;
  function bodyImage(inner, done) {
    const w = Math.min(2600, Math.max(P.VW, Math.round((stage.clientWidth || P.VW) * (window.devicePixelRatio || 1) * 1.15)));
    const h = Math.round(w * P.VH / P.VW);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${P.VW} ${P.VH}" width="${w}" height="${h}">${inner}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => done(img, url);
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  let lastBuild = null, lastW = 0;
  function render() {
    const id = ++renderId;
    lastW = stage.clientWidth;
    const b = P.build(st.p, st.morph, st.pose, st.seed);
    const vb = `0 0 ${P.VW} ${P.VH}`;
    bodyImage(b.B, (img, url) => {
      if (id !== renderId) { URL.revokeObjectURL(url); return; }
      const swap = () => {
        if (id !== renderId) { URL.revokeObjectURL(url); return; }
        // 3層を同時に差し替える。前の絵は、新しい体の画像が読めるまで残す
        const box = document.createElement('div');   // template だと別文書への移し替えで画像が再読み込みされる
        box.innerHTML = `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${b.A}</svg><div class="pm__body" aria-hidden="true"></div><svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${b.C}</svg>`;
        box.children[1].appendChild(img);
        stage.replaceChildren(...box.children);
        handles = P.bind(stage, b.G);
        lastBuild = b;
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      };
      (img.decode ? img.decode() : Promise.resolve()).then(swap, swap);
    });
  }
  // 幅が変わったときだけ作り直す（iOS はツールバーの出し入れでも resize が来る）
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (stage.clientWidth !== lastW) render(); }, 250); });

  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t0 = performance.now();
  function loop(now) {
    if (handles && !reduce) P.tick(handles, (now - t0) / 1000, st.pose);
    requestAnimationFrame(loop);
  }

  function setSeed(n) {
    st.seed = Math.min(9999, Math.max(1, Math.floor(n) || 1));
    const r = P.fromSeed(st.seed);
    st.p = r.p; st.morph = r.morph;
    applyRanges(); sync(true);
  }

  document.getElementById('omakase').addEventListener('click', () => setSeed(1 + Math.floor(Math.random() * 9999)));
  document.getElementById('seedgo').addEventListener('click', () => setSeed(+seedEl.value));
  document.getElementById('reset').addEventListener('click', () => { st.p = P.defaults(); st.morph = 'bar'; st.seed = 1; applyRanges(); sync(true); });
  document.getElementById('copy').addEventListener('click', async e => {
    const text = JSON.stringify({ v: 1, seed: st.seed, morph: st.morph, p: st.p });
    try { await navigator.clipboard.writeText(text); e.target.textContent = 'コピーしました'; } catch (_) { prompt('コピーしてください', text); }
    setTimeout(() => { e.target.textContent = '設定をコピー'; }, 1500);
  });
  document.getElementById('load').addEventListener('click', () => {
    const text = prompt('コピーした設定を貼り付けてください');
    if (!text) return;
    const o = P.parseSettings(text);
    if (!o) { alert('設定を読み込めませんでした'); return; }
    st.p = o.p; st.morph = o.morph; st.seed = o.seed;
    st.fun = true; document.getElementById('fun').checked = true;
    applyRanges(); sync(true);
  });
  document.getElementById('save').addEventListener('click', () => {
    if (!lastBuild) return;
    const layers = lastBuild.A + lastBuild.B + lastBuild.C;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${P.VW * 2}" height="${P.VH * 2}" viewBox="0 0 ${P.VW} ${P.VH}">${layers}</svg>`;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = P.VW * 2; c.height = P.VH * 2;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob(bl => { const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = `pigeon-${st.seed}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });

  buildSliders(); buildChoices();
  // 初期は乱数の個体。URL の ?no= で番号を指定できる
  const q = new URLSearchParams(location.search).get('no');
  applyRanges();
  setSeed(q ? +q : 1 + Math.floor(Math.random() * 9999));
  requestAnimationFrame(loop);
  window.PIGEON_APP = { st, setSeed, sync };
})();
