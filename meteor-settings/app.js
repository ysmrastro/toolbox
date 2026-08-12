/*
 * app.js — UI と状態管理
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const D = MS_DATA;
  const E = MS_ENGINE;
  const A = MS_ASTRO;
  const STORE_KEY = 'ms-meteor-settings-v1';

  /* ===================== 状態 ===================== */
  const state = {
    cameraId: 'a7rv',
    pixelPitch: 3.756,
    megapixels: 61.0,
    fwcBase: 35815,
    fwcSource: 'measured',
    sensorW: 35.9,
    sensorH: 23.9,
    focal: 20,
    fnum: 1.4,
    lensIndex: null,    // init で MS_DATA.defaultLensName から解決する
    trailId: 'sharp',
    gap: 1.0,
    hours: 5,
    tracked: false,     // 赤道儀で追尾するか
    maxExposure: 30,    // 追尾時の露出上限［秒］
    purposeId: 'fireball',
    showerId: 'per',
    datetime: null,
    locIndex: null,     // init で MS_DATA.defaultLocationName から解決する
    myLocName: null,    // 「マイ地点」を選んでいるときその名前（プリセットとは排他）
    lat: null,
    lon: null,
    skyBase: 21.0,
    skyAuto: true,        // 地点変更時に光害地図から自動で空の暗さを取り込むか
    moonId: 'auto',
    durTarget: 2.0,
    camAz: null,        // カメラの方位（null なら放射点から45°離した向きを自動採用）
    camAlt: 60,         // カメラの高度
    /* 赤道儀で追尾するときの狙い。三脚固定は「向けた方位・高度」がそのまま残るが、
       追尾するカメラは空に貼り付くので、狙いは赤経・赤緯で持つほうが実物に合う。
       null は「まだ持ち替えていない」状態で、追尾をオンにした時点で埋める */
    camRa: null,        // 赤経［度］
    camDec: null,       // 赤緯［度］
    articleMode: false,
    activePage: 'page-plan',   // 開いていたタブ（再読み込み後もここに戻る）
    keepAwake: false,          // 現地で画面が消えないようにするか
    fovPortrait: false,        // 画角プレビューの構図（false=横 / true=縦）
    gearSetName: null,         // 選んでいる機材セットの名前
  };

  /* 状態の初期値。共有URLには「初期値と違う項目」だけを載せるために取っておく */
  const DEFAULTS = JSON.parse(JSON.stringify(state));

  /* ボトムナビで行き来するページ。設定はシートなのでここには入れない。
     並び順は index.html の DOM 順と一致させる（横スワイプのトラックがこの順に並ぶ） */
  const PAGES = ['page-plan', 'page-gear', 'page-cond', 'page-result'];

  const DURATIONS = [
    { value: 0.3, label: '0.3秒', sub: '一般的な流星' },
    { value: 1.0, label: '1秒', sub: 'やや長い' },
    { value: 2.0, label: '2秒', sub: '火球クラス' },
    { value: 3.0, label: '3秒', sub: '大火球' },
  ];

  const FNUM_CHIPS = [1.2, 1.4, 1.8, 2.0, 2.8, 4.0];

  /* ===================== 保存・復元 ===================== */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 無視 */ }
  }

  /** 保存された設定を読む。初回訪問（保存が無い）なら false を返す */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      Object.assign(state, JSON.parse(raw));
      return true;
    } catch (e) { return false; }
  }

  /* ===================== 版の食い違いからの復帰 =====================
   * Service Worker の更新中に「古い index.html ＋ 新しい app.js」の組み合わせで
   * 起動してしまうと、新しい JS が古い HTML に無い要素を触って例外になり、
   * どのページにも .active が付かないまま画面が真っ白になる（実際に発生した）。
   *
   * index.html に埋めた <meta name="app-version"> と data.js の版を突き合わせ、
   * 食い違っていたらキャッシュと Service Worker を捨てて1回だけ作り直す。
   * 1.3.2 より前の index.html はこの meta を持たないので、null も食い違い扱いにする。
   */
  const RECOVERY_KEY = 'ms-recovery';

  function stampedVersion() {
    const m = document.querySelector('meta[name="app-version"]');
    return m ? m.getAttribute('content') : null;
  }

  function recoveryTried() {
    try { return sessionStorage.getItem(RECOVERY_KEY); } catch (e) { return null; }
  }

  /** 画面上部に細い帯でお知らせを出す（古い HTML でも出せるよう要素は動的に作る） */
  function showBanner(text, actionLabel, onAction) {
    if (document.getElementById('msBanner')) return;   // 二重に出さない
    const bar = document.createElement('div');
    bar.id = 'msBanner';
    bar.setAttribute('role', 'alert');
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      'padding:10px 12px', 'font:13px/1.5 system-ui,sans-serif',
      'background:#4a1f14', 'color:#ffd9c9', 'text-align:center',
      'box-shadow:0 2px 8px rgba(0,0,0,0.5)',
    ].join(';');
    bar.appendChild(document.createTextNode(text + ' '));
    if (actionLabel) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.style.cssText = 'margin-left:6px;padding:3px 10px;border-radius:6px;' +
        'border:1px solid #ffd9c9;background:transparent;color:#ffd9c9;font:inherit';
      btn.addEventListener('click', onAction);
      bar.appendChild(btn);
    }
    document.body.appendChild(bar);
  }

  /** キャッシュと Service Worker を捨てて読み直す */
  async function rebuildAndReload(reason) {
    try { sessionStorage.setItem(RECOVERY_KEY, reason); } catch (e) { /* 続行する */ }
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) { /* 消せなくても読み直しは試す */ }
    location.reload();
  }

  /* ===================== 表示テーマ =====================
   * 選択値（auto/dark/light/astro）は入力内容とは別のキーに保存する。
   * index.html のインライン script が最初の描画より前に同じキーを読んで
   * <html data-theme> を立てるため、ここは「あとから切り替える」役だけを持つ。
   */
  const THEME_KEY = 'ms-theme';
  /* PWA のステータスバー色。各テーマの --tb-bg-primary と揃えておく */
  const THEME_COLORS = { dark: '#0d1117', light: '#f4f7fa', astro: '#090403' };

  function themePref() {
    const v = document.documentElement.getAttribute('data-theme-pref');
    return D.themes.some((t) => t.id === v) ? v : 'auto';
  }

  function prefersLight() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }

  function applyTheme(pref) {
    const effective = pref === 'auto' ? (prefersLight() ? 'light' : 'dark') : pref;
    const root = document.documentElement;
    root.setAttribute('data-theme', effective);
    root.setAttribute('data-theme-pref', pref);
    const meta = $('themeColor');
    if (meta) meta.setAttribute('content', THEME_COLORS[effective] || THEME_COLORS.dark);
    try { localStorage.setItem(THEME_KEY, pref); } catch (e) { /* 保存できなくても表示は変わる */ }
    renderThemeSeg();
  }

  function renderThemeSeg() {
    const cur = themePref();
    $('themeSeg').innerHTML = D.themes.map((t) => `
      <button type="button" class="segmented__item${t.id === cur ? ' active' : ''}" data-theme="${t.id}">
        ${t.label}<span class="segmented__sub">${t.sub}</span>
      </button>`).join('');
  }

  /* ===================== 文字サイズ =====================
   * ルート（html）の font-size を差し替える。文字サイズ・固定バーの高さ・タップ目標を
   * すべて rem で書いてあるので、ここを変えるだけで全体が同じ比率で伸びる。
   * ホーム画面から起動（standalone）していると端末の文字サイズ設定が効かないため、
   * アプリ側に持たせる必要がある。
   */
  const TEXT_SIZE_KEY = 'ms-text-size';

  function textSizePref() {
    const v = document.documentElement.getAttribute('data-text-size');
    return D.textSizes.some((t) => t.id === v) ? v : D.textSizes[0].id;
  }

  function applyTextSize(id) {
    const size = D.textSizes.find((t) => t.id === id) || D.textSizes[0];
    const root = document.documentElement;
    root.style.fontSize = size.rootPx + 'px';
    root.setAttribute('data-text-size', size.id);
    try { localStorage.setItem(TEXT_SIZE_KEY, size.id); } catch (e) { /* 保存できなくても表示は変わる */ }
    renderTextSizeSeg();
  }

  function renderTextSizeSeg() {
    const cur = textSizePref();
    $('textSizeSeg').innerHTML = D.textSizes.map((t) => `
      <button type="button" class="segmented__item${t.id === cur ? ' active' : ''}" data-size="${t.id}">
        ${t.label}<span class="segmented__sub">${t.sub}</span>
      </button>`).join('');
  }

  /* ===================== シート ===================== */
  const SHEETS = ['aboutSheet', 'settingsSheet', 'calendarSheet'];

  function openSheet(id) {
    SHEETS.forEach((s) => { $(s).hidden = (s !== id); });
  }

  function closeSheets() {
    SHEETS.forEach((s) => { $(s).hidden = true; });
  }

  function anySheetOpen() {
    return SHEETS.some((s) => !$(s).hidden);
  }

  /* ===================== タブ（横スライド） =====================
   * 狭い画面では3ページを横並びのトラックに入れ、トラックごと translateX する。
   * 指の動きにそのまま追従させ、離した時点で近いページへスナップする。
   *
   * トラック方式にすると3ページが同時に文書内に存在するため、縦スクロール位置が
   * 共有されてしまう。そのままだと「下までスクロールした状態で横に払うと、隣も
   * 同じだけスクロールされた状態で入ってくる」ので、ページごとの位置を覚えておき、
   * 動かしている間だけ隣のページを translateY でその位置に合わせる。
   */
  const SNAP_MS = 300;
  const SNAP_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

  /** ページごとの縦スクロール位置 */
  const scrollMemo = { 'page-gear': 0, 'page-cond': 0, 'page-result': 0 };

  /** ボトムナビが出ている＝1ページずつ横に動かすモードか */
  function isTabMode() {
    return window.getComputedStyle($('tabbar')).display !== 'none';
  }

  function pageIndex(pageId) {
    const i = PAGES.indexOf(pageId || state.activePage);
    return i < 0 ? 0 : i;
  }

  /** 3ページを並べている（.is-animating）ときに i 番目を画面に置くトラックの位置。
      畳んでいるときは表示中のページだけが並ぶので translateX(0) が定位置になる */
  function trackBase(i) {
    return `translateX(${-i * 100}%)`;
  }

  function setActive(pageId) {
    document.querySelectorAll('.tabbar__item[data-page]').forEach((b) => {
      b.classList.toggle('active', b.dataset.page === pageId);
    });
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    $(pageId).classList.add('active');
    state.activePage = pageId;
    save();
  }

  /** 隣のページを実寸で描画し、縦位置をそれぞれの記憶位置に合わせる */
  function beginTrack() {
    const track = $('track');
    const from = window.scrollY;
    scrollMemo[state.activePage] = from;
    track.classList.add('is-animating');
    track.style.willChange = 'transform';
    track.style.transition = 'none';
    track.style.transform = trackBase(pageIndex());
    PAGES.forEach((id) => {
      $(id).style.transform = id === state.activePage
        ? '' : `translateY(${from - (scrollMemo[id] || 0)}px)`;
    });
  }

  /** 動かし終わり。隣を畳み、translateY を実際のスクロール位置に置き換える。
      畳むと表示中のページだけが並ぶので、トラックの位置は translateX(0) に戻す。
      見た目は動かし終わりの状態と完全に同じになる。 */
  function endTrack(pageId) {
    const track = $('track');
    setActive(pageId);
    track.classList.remove('is-animating');
    track.style.transition = 'none';
    track.style.willChange = '';
    track.style.transform = 'translateX(0)';
    PAGES.forEach((id) => { $(id).style.transform = ''; });
    window.scrollTo(0, scrollMemo[pageId] || 0);
    redrawFov();   // 表示されて初めて幅が決まるので、ここで描く
  }

  /** 指の位置に追従させる（端では抵抗をつけて引っぱり過ぎないようにする） */
  function dragTrack(dx) {
    const i = pageIndex();
    const atEdge = (i === 0 && dx > 0) || (i === PAGES.length - 1 && dx < 0);
    const d = atEdge ? dx * 0.3 : dx;
    const track = $('track');
    track.style.transition = 'none';
    track.style.transform = `translateX(calc(${-i * 100}% + ${d}px))`;
  }

  /** 目的のページへスナップさせる */
  function snapTrack(pageId) {
    const track = $('track');
    track.style.transition = `transform ${SNAP_MS}ms ${SNAP_EASE}`;
    requestAnimationFrame(() => { track.style.transform = trackBase(pageIndex(pageId)); });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      track.removeEventListener('transitionend', finish);
      endTrack(pageId);
    };
    track.addEventListener('transitionend', finish);
    // 動く距離が 0 だと transitionend が来ないので保険をかける
    setTimeout(finish, SNAP_MS + 120);
  }

  /**
   * タブを切り替える。
   * @param {string} pageId    表示するページの id
   * @param {boolean} animate  true ならスライドさせる（タブのタップ・スワイプ）
   */
  function goToTab(pageId, animate) {
    if (PAGES.indexOf(pageId) < 0) pageId = PAGES[0];
    if (!isTabMode()) { setActive(pageId); return; }
    if (!animate) {
      scrollMemo[state.activePage] = window.scrollY;
      endTrack(pageId);
      return;
    }
    if (pageId === state.activePage) return;
    beginTrack();
    snapTrack(pageId);
  }

  /* ===================== 設定の共有（URL） =====================
   * 入力内容を1つの文字列にして URL のハッシュに載せる。
   * localStorage は端末をまたげないので、別の端末や友達に渡す手段として用意する。
   *  - 初期値と同じ項目は載せない（URL を短く保つ）
   *  - 開いたページの種類やマイ地点の一覧は相手には意味がないので載せない
   *  - 読み取り側は state に元からあるキーだけを受け付ける（想定外の値を入れない）
   */
  const SHARE_SKIP = ['activePage', 'myLocName', 'keepAwake', 'gearSetName'];

  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /** カメラのプリセットから決まる項目（手で変えていなければ共有URLに載せない） */
  const CAMERA_DERIVED = ['pixelPitch', 'megapixels', 'fwcBase', 'fwcSource', 'rnGain',
    'rnFloor', 'dualGainISO', 'sensorW', 'sensorH', 'sensorAspect', 'cameraNote'];

  function cameraPresetValues(id) {
    const cam = D.cameras.find((c) => c.id === id);
    if (!cam) return null;
    const f = D.formats[cam.format];
    return {
      pixelPitch: cam.pixelPitch, megapixels: cam.megapixels, fwcBase: cam.fwcBase,
      fwcSource: cam.fwcSource, rnGain: cam.rnGain, rnFloor: cam.rnFloor,
      dualGainISO: cam.dualGainISO, sensorW: f.width, sensorH: f.height,
      sensorAspect: f.height / f.width, cameraNote: cam.note || '',
    };
  }

  /** いまの設定を載せた共有URL */
  function shareUrl() {
    const payload = { v: 1 };
    Object.keys(state).forEach((k) => {
      if (SHARE_SKIP.indexOf(k) >= 0) return;
      if (JSON.stringify(state[k]) === JSON.stringify(DEFAULTS[k])) return;
      payload[k] = state[k];
    });
    /* センサーの値がプリセットどおりならカメラIDだけで復元できるので落とす（URLを短くする） */
    const preset = cameraPresetValues(state.cameraId);
    if (preset) {
      CAMERA_DERIVED.forEach((k) => {
        if (JSON.stringify(state[k]) === JSON.stringify(preset[k])) delete payload[k];
      });
    }
    const base = location.origin + location.pathname;
    /* クエリ（?s=）に載せる。ハッシュ（#s=）はメッセージアプリや短縮URLの経路で
       落ちることがあるため、渡す側は必ずクエリにする。中身は撮影設定だけなので
       サーバーのログに載っても差し支えない。 */
    return base + '?s=' + b64urlEncode(JSON.stringify(payload));
  }

  /** URL から共有設定を読むだけ（state には触らない）。無ければ null。
      新しい形（?s=）と、古いリンクの形（#s=）の両方を受ける */
  function readSharedPayload() {
    const src = (location.search || '') + (location.hash || '');
    const m = src.match(/[?#&]s=([A-Za-z0-9\-_]+)/);
    if (!m) return null;
    try {
      const obj = JSON.parse(b64urlDecode(m[1]));
      return (obj && typeof obj === 'object') ? obj : null;
    } catch (e) { return null; }
  }

  /**
   * 共有設定を state に当てる。
   * state に元からあるキーで、値が数値・真偽・文字列・null のものだけを受け付ける。
   */
  function applySharedPayload(obj) {
    let applied = 0;
    Object.keys(obj).forEach((k) => {
      if (k === 'v' || SHARE_SKIP.indexOf(k) >= 0) return;
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) return;
      const v = obj[k];
      const t = typeof v;
      if (v === null || t === 'number' || t === 'boolean' || t === 'string') {
        state[k] = v;
        applied++;
      }
    });
    return applied > 0;
  }

  /** 数秒で消える通知（共有URLの読み込みや、コピー結果の知らせに使う） */
  function showToast(text) {
    const old = document.getElementById('msToast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'msToast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('is-out'); }, 3200);
    setTimeout(() => { el.remove(); }, 3700);
  }

  /** ユーザーが入れた文字列を HTML に埋めるための最小限のエスケープ */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function escapeAttr(str) { return escapeHtml(str); }

  /* ===================== 画面を消さない =====================
   * 現地でアプリを見ながら操作していると画面が落ちて面倒なので、
   * Screen Wake Lock で消灯を止める。
   * 取得はユーザー操作か表示中でないと拒否されるため、失敗しても黙って諦め、
   * バックグラウンドから戻ったときに取り直す（解除されるため）。
   */
  let wakeLockSentinel = null;

  function wakeLockSupported() {
    return !!(navigator.wakeLock && navigator.wakeLock.request);
  }

  async function acquireWakeLock() {
    if (!wakeLockSupported() || wakeLockSentinel) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
    } catch (e) {
      wakeLockSentinel = null;   // 端末が断ったときは何もしない
    }
    renderWakeLock();
  }

  async function releaseWakeLock() {
    if (!wakeLockSentinel) return;
    try { await wakeLockSentinel.release(); } catch (e) { /* 解放できなくても続行 */ }
    wakeLockSentinel = null;
    renderWakeLock();
  }

  function renderWakeLock() {
    $('wakeLock').checked = !!state.keepAwake;
    $('wakeLock').disabled = !wakeLockSupported();
    const hint = $('wakeLockHint');
    if (!wakeLockSupported()) {
      hint.textContent = 'この端末（ブラウザ）では画面の消灯を止められません。' +
        '端末側の自動ロックを長めにしてください。';
    } else if (state.keepAwake) {
      hint.textContent = wakeLockSentinel
        ? '有効。バッテリーを使うので、撮影が終わったら切ってください。'
        : '画面に触ると有効になります（バックグラウンドでは解除されます）。';
    } else {
      hint.textContent = '入れておくと、現地で画面を触らなくても消灯しません。';
    }
  }

  /* ===================== 機材セット =====================
   * カメラ・レンズ・ピント・インターバル・赤道儀の設定をまとめて名前付きで保存する。
   * 2台体制（広角＋標準）を行き来するときのため。
   * 観測地（マイ地点）と同じく、入力内容のリセットでは消えない別キーに置く。
   */
  const GEAR_KEY = 'ms-gear-presets';

  /* セットに含める state のキー。ここに無い項目（日時・場所・空の暗さ等）は
     現場の条件なので機材セットでは持ち回さない */
  const GEAR_KEYS = ['cameraId', 'pixelPitch', 'megapixels', 'fwcBase', 'fwcSource',
    'rnGain', 'rnFloor', 'dualGainISO', 'sensorW', 'sensorH', 'sensorAspect', 'cameraNote',
    'focal', 'fnum', 'lensIndex', 'trailId', 'gap', 'hours', 'tracked', 'maxExposure'];

  function loadGearSets() {
    try {
      const raw = localStorage.getItem(GEAR_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((g) => g && g.name && g.gear) : [];
    } catch (e) { return []; }
  }

  function saveGearSets(list) {
    try { localStorage.setItem(GEAR_KEY, JSON.stringify(list)); } catch (e) { /* 無視 */ }
  }

  function renderGearSets() {
    const list = loadGearSets();
    $('gearSetSelect').innerHTML =
      '<option value="">（セットを選ばない）</option>' +
      list.map((g) => `<option value="${escapeAttr(g.name)}">${escapeHtml(g.name)}</option>`).join('');
    $('gearSetSelect').value = state.gearSetName && list.some((g) => g.name === state.gearSetName)
      ? state.gearSetName : '';
    if ($('gearSetSelect').value === '') state.gearSetName = null;
    $('btnDeleteGear').hidden = !state.gearSetName;
  }

  /* ===================== マイ地点 =====================
   * 現在地や友達に教わった穴場を名前付きで保存する。
   * プリセット（data.js）とは別に localStorage に持ち、観測地セレクトの先頭に出す。
   * 入力内容のリセットでは消さない（別キーにしてある）。
   */
  const MY_LOC_KEY = 'ms-my-locations';

  function loadMyLocations() {
    try {
      const raw = localStorage.getItem(MY_LOC_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list)
        ? list.filter((l) => l && l.name && isFinite(l.lat) && isFinite(l.lon))
        : [];
    } catch (e) { return []; }
  }

  function saveMyLocations(list) {
    try { localStorage.setItem(MY_LOC_KEY, JSON.stringify(list)); } catch (e) { /* 無視 */ }
  }

  function currentMyLocation() {
    if (!state.myLocName) return null;
    return loadMyLocations().find((l) => l.name === state.myLocName) || null;
  }

  /* ===================== ユーティリティ ===================== */
  function shower() { return D.showers.find((s) => s.id === state.showerId) || D.showers[0]; }
  function purpose() { return D.purposes.find((p) => p.id === state.purposeId) || D.purposes[0]; }
  function trailQuality() { return D.trailQuality.find((t) => t.id === state.trailId) || D.trailQuality[1]; }

  function toLocalInput(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
  }

  function currentDate() {
    const d = state.datetime ? new Date(state.datetime) : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  }

  /** 選択中の流星群の「次の極大の夜」の 01:00 */
  function nextPeakDate(sh) {
    const now = new Date();
    if (!sh.peak) {
      const d = new Date(now.getTime() + 86400000);
      d.setHours(1, 0, 0, 0);
      return d;
    }
    const [mm, dd] = sh.peak.split('-').map(Number);
    for (let dy = 0; dy <= 1; dy++) {
      const d = new Date(now.getFullYear() + dy, mm - 1, dd, 1, 0, 0, 0);
      if (d.getTime() > now.getTime()) return d;
    }
    return new Date(now.getFullYear() + 1, mm - 1, dd, 1, 0, 0, 0);
  }

  function fmt(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return v.toFixed(digits === undefined ? 2 : digits);
  }

  function signed(v, digits) {
    if (!isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(digits === undefined ? 2 : digits);
  }

  function shutterLabel(t) {
    return t >= 1 ? `${t}秒` : `1/${Math.round(1 / t)}秒`;
  }

  /* ===================== 計算 ===================== */
  function astroSnapshot() {
    const date = currentDate();
    const sh = shower();
    const rad = A.radiantAltitude(date, state.lat, state.lon, sh);
    const sun = A.sunPosition(date, state.lat, state.lon);
    const moon = A.moonInfo(date, state.lat, state.lon);
    return { date, sh, rad, sun, moon };
  }

  function effectiveSky(snap) {
    let delta = 0;
    if (state.moonId === 'auto') {
      delta = A.moonSkyPenalty(snap.moon);
    } else {
      const preset = D.moonPresets.find((m) => m.id === state.moonId);
      delta = preset ? preset.delta : 0;
    }
    return { sky: state.skyBase + delta, delta: delta };
  }

  /* 向きのスライダーの刻みと範囲。大気の式は地平線近くで意味を失うので
     高度には下限を置き、赤緯は日本から狙える範囲に絞る */
  const CAM_ALT_MIN = 10;
  const RA_STEP_DEG = 7.5;        // 赤経スライダーの刻み（0.5時間）
  const DEC_MIN = -40;
  const DEC_MAX = 90;

  function norm360(deg) { return ((deg % 360) + 360) % 360; }
  function roundRa(deg) { return norm360(Math.round(norm360(deg) / RA_STEP_DEG) * RA_STEP_DEG); }
  function roundDec(deg) { return Math.min(DEC_MAX, Math.max(DEC_MIN, Math.round(deg / 5) * 5)); }

  /** 赤経を「21h30m」の形にする */
  function raLabel(deg) {
    if (deg == null) return '—';
    const h = norm360(deg) / 15;
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return mm === 60 ? `${(hh + 1) % 24}h 00m` : `${hh}h ${String(mm).padStart(2, '0')}m`;
  }

  /** 追尾するかどうかで狙いの持ち方が変わるので、いま有効なほうを判定する */
  function eqAimActive() {
    return !!state.tracked && state.camRa != null && state.camDec != null;
  }

  /** カメラの向きから、放射点との離角や大気の効果を求める */
  function cameraGeometry(snap, zenithSky) {
    const radAz = snap.rad.isSporadic ? 0 : snap.rad.azimuth;
    const radAlt = snap.rad.isSporadic ? 45 : snap.rad.altitude;

    /* 追尾するときは赤経・赤緯が狙い。時刻を動かすと同じ空を追いかけたまま高度が変わる
       （固定撮影では逆に、向けた方位・高度がそのまま残って空が流れていく） */
    let az;
    let alt;
    if (eqAimActive()) {
      const hz = A.equatorialToHorizontal(state.camRa, state.camDec, state.lat, state.lon, snap.date);
      az = norm360(hz.azimuth);
      alt = hz.altitude;
    } else {
      az = state.camAz == null ? defaultCamAz(snap) : state.camAz;
      alt = state.camAlt;
    }

    // 散在流星は放射点を持たないので、記事の基準と同じ離角60°で扱う
    const sep = snap.rad.isSporadic
      ? E.REF.elong
      : A.angularSeparation(az, alt, radAz, radAlt);

    // 放射点の真上を狙うと角速度がゼロに近づいて発散するため下限を設ける
    const elong = Math.max(sep, 10);

    /* 赤経・赤緯で狙うと地平線の下も指せてしまう。大気の式（airmass や van Rhijn）は
       そこで破綻するので、計算にはスライダーと同じ下限 10° を使い、
       実際の高度は altTrue として別に持って画面で断る */
    const altUsed = Math.max(alt, CAM_ALT_MIN);

    return {
      az: az,
      alt: altUsed,
      altTrue: alt,
      belowFloor: alt < CAM_ALT_MIN - 0.01,
      separation: sep,
      elong: elong,
      airmass: E.airmass(altUsed),
      skyOffset: E.skyOffsetForAltitude(zenithSky, altUsed),
      skyHere: E.skyAtAltitude(zenithSky, altUsed),
      extinction: E.meteorExtinction(altUsed),
    };
  }

  /** 放射点から方位で45°離した向き（初期値） */
  function defaultCamAz(snap) {
    if (snap.rad.isSporadic || snap.rad.azimuth == null) return 180;
    return Math.round(((snap.rad.azimuth + 45) % 360) / 5) * 5 % 360;
  }

  /** プリセットで狙う向き（方位・高度）。天頂は方位を変えない */
  function presetDirection(kind, snap, radAz, radAlt) {
    const cur = state.camAz == null ? defaultCamAz(snap) : state.camAz;
    if (kind === 'zenith') return { az: cur, alt: 90 };
    if (kind === 'radiant') return { az: radAz, alt: radAlt };

    /* 放射点から45°離す。
       「方位を45°ずらす」だと放射点が高いときに離角が45°に届かない
       （高度58°では方位45°ずらしても離角は23°しかない。実際にそうなっていた）。
       球面上で45°離れた円をたどり、そのうち最も高度が取れる点を選ぶ。
       高度が高いほど空が暗く流星の減光も小さいので、条件のいい向きになる。 */
    let best = null;
    circleAround(radAz, radAlt, 45, 72).forEach((q) => {
      if (!best || q.alt > best.alt) best = q;
    });
    return best ? { az: norm360(best.az), alt: best.alt } : { az: norm360(radAz + 45), alt: radAlt };
  }

  /** いまの時刻・地点で、方位・高度の狙いに対応する赤経・赤緯 */
  function eqFromHoriz(az, alt) {
    return A.horizontalToEquatorial(az, alt, state.lat, state.lon, currentDate());
  }

  function setEqAim(eq) {
    state.camRa = roundRa(eq.ra);
    state.camDec = roundDec(eq.dec);
  }

  function setHorizAim(hz) {
    state.camAz = Math.round(norm360(hz.azimuth) / 5) * 5 % 360;
    state.camAlt = Math.min(90, Math.max(CAM_ALT_MIN, Math.round(hz.altitude / 5) * 5));
  }

  /**
   * 追尾のオン・オフで狙いの持ち方が変わるとき、向いている方向を持ち替える。
   * 切り替えた瞬間に画角が飛ばないよう、いまの向きを相手の座標系に移すだけ。
   */
  function ensureAimForMode() {
    const snap = astroSnapshot();
    if (state.tracked) {
      if (state.camRa == null || state.camDec == null) {
        const az = state.camAz == null ? defaultCamAz(snap) : state.camAz;
        setEqAim(eqFromHoriz(az, state.camAlt));
      }
    } else if (state.camRa != null && state.camDec != null) {
      setHorizAim(A.equatorialToHorizontal(state.camRa, state.camDec, state.lat, state.lon, snap.date));
      state.camRa = null;
      state.camDec = null;
    }
  }

  function buildCfg(snap, sky) {
    const sh = snap.sh;
    const geo = cameraGeometry(snap, sky);
    // 式③の「高度」は放射点ではなくカメラの向きの高度（流星は高度100kmで光るため
    // 視線距離が 100/sin(高度) になる）
    const omega = E.angularVelocity(sh.velocity, geo.elong, geo.alt);

    return {
      geo: geo,
      camAlt: geo.alt,
      camera: {
        pixelPitch: state.pixelPitch,
        megapixels: state.megapixels,
        fwcBase: state.fwcBase,
        rnGain: state.rnGain,
        rnFloor: state.rnFloor,
      },
      focal: state.focal,
      fnum: state.fnum,
      trailFactor: trailQuality().factor,
      sky: sky + geo.skyOffset,
      omegaDeg: omega,
      exposure: 8,
      gap: state.gap,
      iso: 640,
      r: sh.r,
      meanMag: sh.meanMag,
      radiantAlt: snap.rad.altitude,
      sensorW: state.sensorW,
      sensorH: state.sensorH,
      fireballDuration: state.durTarget,
      tracked: state.tracked,
      maxExposure: state.maxExposure,
      articleMode: state.articleMode,
    };
  }

  function compute() {
    const snap = astroSnapshot();
    const skyInfo = effectiveSky(snap);
    const cfg = buildCfg(snap, skyInfo.sky);
    const rec = E.recommendExposure(cfg, purpose());
    const final = Object.assign({}, cfg, { exposure: rec.exposure, iso: rec.iso });
    const ev = E.evaluate(final);
    return { snap, skyInfo, cfg: final, rec, ev };
  }

  /* ===================== 初期描画：セレクト類 ===================== */
  function initSelects() {
    $('cameraSelect').innerHTML = D.cameras
      .map((c) => `<option value="${c.id}">${c.name}</option>`).join('');

    // レンズはマウントごとに optgroup でまとめる
    const lensGroups = [];
    D.lenses.forEach((l, i) => {
      const mount = l.mount || 'その他';
      let g = lensGroups.find((x) => x.mount === mount);
      if (!g) { g = { mount: mount, items: [] }; lensGroups.push(g); }
      g.items.push(`<option value="${i}">${l.name}</option>`);
    });
    $('lensSelect').innerHTML =
      '<option value="-1">レンズを選ぶ（任意）</option>' +
      lensGroups.map((g) => `<optgroup label="${g.mount}">${g.items.join('')}</optgroup>`).join('');

    $('showerSelect').innerHTML = D.showers
      .map((s) => `<option value="${s.id}">${s.name}</option>`).join('');

    // 観測地は地域ごとに optgroup でまとめる
    const groups = [];
    D.locations.forEach((l, i) => {
      const region = l.region || 'その他';
      let g = groups.find((x) => x.region === region);
      if (!g) { g = { region: region, items: [] }; groups.push(g); }
      g.items.push(`<option value="${i}">${l.name}</option>`);
    });
    const mine = loadMyLocations();
    const mineHtml = mine.length
      ? `<optgroup label="マイ地点">${mine.map((l) =>
        `<option value="m:${escapeAttr(l.name)}">${escapeHtml(l.name)}</option>`).join('')}</optgroup>`
      : '';
    $('locationSelect').innerHTML = mineHtml +
      groups.map((g) => `<optgroup label="${g.region}">${g.items.join('')}</optgroup>`).join('') +
      '<optgroup label="任意の座標"><option value="-1">手入力</option></optgroup>';

    $('moonSelect').innerHTML =
      '<option value="auto">自動（日時と場所から計算）</option>' +
      D.moonPresets.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');

    $('fnumChips').innerHTML = FNUM_CHIPS
      .map((f) => `<button type="button" class="chip" data-fnum="${f}">F${f.toFixed(1)}</button>`).join('');

    $('skyChips').innerHTML = D.skyPresets
      .map((s) => `<button type="button" class="chip" data-sky="${s.sqm}">${s.label} ${s.sqm.toFixed(1)}</button>`).join('');

    $('trailSeg').innerHTML = D.trailQuality.map((t) =>
      `<button type="button" class="segmented__item" data-trail="${t.id}">${t.label}
         <span class="segmented__sub">${t.note}</span></button>`).join('');

    $('durSeg').innerHTML = DURATIONS.map((d) =>
      `<button type="button" class="segmented__item" data-dur="${d.value}">${d.label}
         <span class="segmented__sub">${d.sub}</span></button>`).join('');

    $('purposeGrid').innerHTML = D.purposes.map((p) =>
      `<div class="purpose" data-purpose="${p.id}">
         <span class="purpose__icon">${p.icon}</span>
         <span class="purpose__label">${p.label}</span>
       </div>`).join('');
  }

  /* ===================== 入力への反映 ===================== */
  function applyCameraPreset(id) {
    const cam = D.cameras.find((c) => c.id === id);
    if (!cam) return;
    const fmtDef = D.formats[cam.format];
    state.cameraId = cam.id;
    state.pixelPitch = cam.pixelPitch;
    state.megapixels = cam.megapixels;
    state.fwcBase = cam.fwcBase;
    state.fwcSource = cam.fwcSource;
    state.rnGain = cam.rnGain;
    state.rnFloor = cam.rnFloor;
    state.dualGainISO = cam.dualGainISO;
    state.sensorW = fmtDef.width;
    state.sensorH = fmtDef.height;
    state.sensorAspect = fmtDef.height / fmtDef.width;
    state.cameraNote = cam.note || '';
  }

  function syncInputs() {
    $('cameraSelect').value = state.cameraId;
    $('pixelPitch').value = state.pixelPitch;
    $('megapixels').value = state.megapixels;
    $('fwcBase').value = Math.round(state.fwcBase);
    $('sensorW').value = state.sensorW;
    $('lensSelect').value = String(state.lensIndex);
    $('focal').value = state.focal;
    $('fnum').value = state.fnum;
    $('gap').value = state.gap;
    $('hours').value = state.hours;
    $('tracked').checked = state.tracked;
    $('maxExposure').value = state.maxExposure;
    $('maxExposureField').hidden = !state.tracked;
    $('showerSelect').value = state.showerId;
    $('locationSelect').value = state.myLocName
      ? 'm:' + state.myLocName
      : String(state.locIndex);
    // 保存済みのマイ地点が消えていた場合は手入力扱いに落とす
    if ($('locationSelect').value === '' && state.myLocName) {
      state.myLocName = null;
      state.locIndex = -1;
      $('locationSelect').value = '-1';
    }
    $('btnDeleteLoc').hidden = !state.myLocName;
    $('lat').value = state.lat;
    $('lon').value = state.lon;
    $('sky').value = state.skyBase;
    $('moonSelect').value = state.moonId;
    $('camAz').value = state.camAz == null ? 180 : state.camAz;
    $('camAlt').value = state.camAlt;
    $('camRa').value = (state.camRa == null ? 0 : norm360(state.camRa)) / 15;
    $('camDec').value = state.camDec == null ? 45 : state.camDec;
    $('camHorizField').hidden = !!state.tracked;
    $('camEqField').hidden = !state.tracked;
    $('camModeHint').textContent = state.tracked
      ? '赤道儀に載せるので、狙いは赤経・赤緯で指定します。日時を変えても同じ空を追いかけたままになり、そのぶん高度（＝空の明るさと減光）が変わります。'
      : '三脚に固定するので、狙いは方位・高度で指定します。日時を変えても向きはそのままで、空だけが流れていきます。';
    $('articleMode').checked = state.articleMode;
    $('datetime').value = toLocalInput(currentDate());

    document.querySelectorAll('[data-fnum]').forEach((el) => {
      el.classList.toggle('active', Math.abs(Number(el.dataset.fnum) - state.fnum) < 0.001);
    });
    document.querySelectorAll('[data-sky]').forEach((el) => {
      el.classList.toggle('active', Math.abs(Number(el.dataset.sky) - state.skyBase) < 0.001);
    });
    document.querySelectorAll('[data-trail]').forEach((el) => {
      el.classList.toggle('active', el.dataset.trail === state.trailId);
    });
    document.querySelectorAll('[data-dur]').forEach((el) => {
      el.classList.toggle('active', Math.abs(Number(el.dataset.dur) - state.durTarget) < 0.001);
    });
    document.querySelectorAll('[data-purpose]').forEach((el) => {
      el.classList.toggle('active', el.dataset.purpose === state.purposeId);
    });

    $('skyValue').textContent = state.skyBase.toFixed(2);
    $('camAltValue').textContent = state.camAlt;
    $('camRaValue').textContent = raLabel(state.camRa);
    $('camDecValue').textContent = state.camDec == null ? '—' : signed(state.camDec, 0) + '°';
    $('purposeDesc').textContent = purpose().desc;
  }

  /* ===================== 描画：機材タブ ===================== */
  function renderGear(res) {
    const badges = [];
    badges.push(`<span class="spec-badge">画素ピッチ ${state.pixelPitch.toFixed(3)} µm</span>`);
    badges.push(`<span class="spec-badge">${state.megapixels} MP</span>`);
    const fwcLabel = { measured: '実測', manual: '手入力', estimated: '推定' }[state.fwcSource] || '推定';
    const fwcClass = state.fwcSource === 'estimated' ? 'est' : 'measured';
    badges.push(`<span class="spec-badge spec-badge--${fwcClass}">飽和 ${Math.round(state.fwcBase).toLocaleString()} e- ${fwcLabel}</span>`);
    if (state.dualGainISO) badges.push(`<span class="spec-badge">デュアルゲイン ISO ${state.dualGainISO}</span>`);
    $('cameraSpecs').innerHTML = badges.join('');

    $('fwcHint').textContent = state.fwcSource === 'measured'
      ? '記事の実測値を使用しています。'
      : state.fwcSource === 'manual'
      ? '手入力された値を使用しています。'
      : '飽和電子数は α7R V の実測値からの推定です。火球の白飛び限界にのみ影響し、到達等級や推奨露出には影響しません。';

    const ap = state.focal / state.fnum;
    $('apertureOut').textContent = `${ap.toFixed(1)} mm`;
    let note = '';
    if (ap >= 14) note = '記事の基準（12mm以上）を満たし、ペルセウス座の平均光度に届く水準です。';
    else if (ap >= 12) note = '記事の基準（12mm以上）をぎりぎり満たします。';
    else note = '記事の基準（12mm以上）を下回ります。より暗い空か明るいレンズが必要です。';
    $('apertureNote').textContent = note;

    $('trackedHint').textContent = state.tracked
      ? '追尾すると日周運動で星が伸びないため、NPF則による露出の上限が外れます。上限は追尾精度やバッテリーなどの実務的な都合で決めてください。'
      : '固定撮影では NPF則（星が点に写る限界）が露出の上限になります。赤道儀を使う場合はオンにしてください。';

    const ev = res.ev;
    const rec = res.rec;
    if (state.tracked) {
      $('trackedReport').innerHTML =
        `露出の上限 <b>${state.maxExposure}秒</b>（追尾しない場合は NPF則で <b>${fmt(ev.npf, 2)}秒</b>）<br>` +
        `選ばれた露出 <b>${rec.exposure}秒</b>／到達等級 <b>${signed(ev.limMag)}</b>等` +
        `<p class="hint">流星は移動天体なので、露出を延ばしても流星の信号は増えず背景だけ増えます。` +
        `到達等級は露出2倍ごとに 0.38等 悪化するため、追尾しても「長ければ良い」わけではありません。` +
        `長い露出が有利なのは、コマの切れ目で火球が途切れる確率が下がる点だけです。</p>`;
    } else {
      $('trackedReport').innerHTML =
        `NPF則の露出上限 <b>${fmt(ev.npf, 2)}秒</b>／選ばれた露出 <b>${rec.exposure}秒</b>`;
    }
  }

  /* ===================== 描画：条件タブ ===================== */
  /* ===================== 撮影計画タイムライン =====================
   * 夜ごとの計算（薄明・月出没・放射点高度の系列）はそれなりに重いので、
   * 同じ夜・同じ地点・同じ群なら使い回す。
   */
  let tlCache = { key: null, value: null };
  let fovResizeTimer = null;
  /* 直近の計算結果。タブが表示された時点で画角プレビューを描き直すために持つ
     （canvas は表示されていない間は幅が0で描けない） */
  let lastRes = null;

  /** その時刻が属する「夜」の起点（現地12:00）。未明は前日の夜として扱う */
  function nightOf(date) {
    const noon = new Date(date.getTime());
    noon.setHours(12, 0, 0, 0);
    if (date.getTime() < noon.getTime()) noon.setDate(noon.getDate() - 1);
    return noon;
  }

  function timelineFor(date, lat, lon, sh) {
    const key = [nightOf(date).toDateString(), lat.toFixed(3), lon.toFixed(3), sh.id].join('|');
    if (tlCache.key !== key) {
      tlCache = { key: key, value: A.nightTimeline(date, lat, lon, sh) };
    }
    return tlCache.value;
  }

  function hhmm(d) {
    if (!d) return '—';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function minutesText(min) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return (h ? `${h}時間` : '') + (m || !h ? `${m}分` : '');
  }

  /** 放射点高度 0〜90° を帯の中の y 位置（%）に写す。0°を下寄りに置いて曲線を見せる */
  function altToY(alt) {
    const a = Math.max(0, Math.min(90, alt));
    return 95 - (a / 90) * (95 - 8);
  }

  function renderTimeline(res) {
    const sh = res.snap.sh;
    const tl = timelineFor(currentDate(), state.lat, state.lon, sh);
    const span = tl.to.getTime() - tl.from.getTime();
    const pct = (d) => Math.max(0, Math.min(100, (d.getTime() - tl.from.getTime()) / span * 100));
    const seg = (cls, a, b) => {
      if (!a || !b) return '';
      const l = pct(a);
      const w = pct(b) - l;
      return w > 0 ? `<div class="tl__seg ${cls}" style="left:${l}%;width:${w}%"></div>` : '';
    };

    /* 放射点高度の折れ線 */
    const points = tl.series
      .map((s) => `${pct(s.time).toFixed(2)},${altToY(s.altitude).toFixed(2)}`).join(' ');

    /* 時刻目盛り。ラベルが詰まらないよう間隔を夜の長さから決める */
    const hours = span / 3600000;
    const step = [1, 2, 3, 4, 6].find((h) => hours / h <= 6) || 6;
    const ticks = [];
    const first = new Date(tl.from.getTime());
    first.setMinutes(0, 0, 0);
    if (first.getHours() % step !== 0) first.setHours(first.getHours() + (step - first.getHours() % step));
    for (let t = first.getTime(); t <= tl.to.getTime(); t += step * 3600000) {
      const d = new Date(t);
      ticks.push(`<span style="left:${pct(d)}%">${d.getHours()}時</span>`);
    }

    const now = currentDate();
    const inRange = now >= tl.from && now <= tl.to;

    $('timeline').innerHTML = `
      <div class="tl__track" id="tlTrack">
        ${seg('tl__seg--dark', tl.duskAstro || tl.from, tl.dawnAstro || tl.to)}
        ${tl.moonUp.map((g) => seg('tl__seg--moon', g.from, g.to)).join('')}
        <div class="tl__horizon" style="top:${altToY(0)}%"></div>
        <svg class="tl__curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="${points}"></polyline>
        </svg>
        ${tl.golden.map((g) => seg('tl__seg--golden', g.from, g.to)).join('')}
        ${tl.peak ? `<div class="tl__peak" style="left:${pct(tl.peak.time)}%"></div>` : ''}
        ${inRange ? `<div class="tl__now" style="left:${pct(now)}%"></div>` : ''}
      </div>
      <div class="tl__axis">${ticks.join('')}</div>
      <div class="tl__legend">
        <span><i style="background:var(--ms-tl-twilight)"></i>薄明</span>
        <span><i style="background:var(--ms-tl-dark)"></i>暗夜</span>
        <span><i style="background:var(--ms-tl-moon)"></i>月あり</span>
        <span><i style="background:var(--tb-success)"></i>狙い目</span>
        <span><i style="background:var(--tb-accent)"></i>放射点高度</span>
        <span><i style="background:var(--ms-warn)"></i>最高高度</span>
      </div>`;

    /* 文章での要約 */
    let r = '';
    r += `日没 <b>${hhmm(tl.sunset)}</b>／天文薄明終わり <b>${hhmm(tl.duskAstro)}</b>` +
      `／天文薄明始まり <b>${hhmm(tl.dawnAstro)}</b>／日の出 <b>${hhmm(tl.sunrise)}</b><br>`;
    if (tl.moonUp.length === 0) {
      r += `月は一晩中出ません（月齢 <b>${fmt(tl.moon.age, 1)}日</b>）。<br>`;
    } else {
      const total = tl.moonUp.reduce((a, g) => a + (g.to - g.from) / 60000, 0);
      r += `月は <b>${tl.moonUp.map((g) => hhmm(g.from) + '〜' + hhmm(g.to)).join('、')}</b>` +
        `（計 ${minutesText(total)}）／輝面比 <b>${Math.round(tl.moon.illumination * 100)}%</b>` +
        `・月齢 <b>${fmt(tl.moon.age, 1)}日</b><br>`;
    }
    if (!sh.ra) {
      r += '放射点を持たない群のため、高度の山はありません。<br>';
    } else if (tl.peak) {
      r += `放射点が最も高くなるのは <b>${hhmm(tl.peak.time)}</b>（<b>${fmt(tl.peak.altitude, 0)}°</b>）。<br>`;
    }
    if (tl.goldenMinutes > 0) {
      r += `<b>狙い目は ${tl.golden.map((g) => hhmm(g.from) + '〜' + hhmm(g.to)).join('、')}` +
        `（計 ${minutesText(tl.goldenMinutes)}）</b>` +
        '——暗夜で、月が出ておらず、放射点が地平線上にある時間です。';
    } else {
      r += '<b>この夜は条件のそろう時間がありません。</b>月・薄明・放射点のいずれかが常に邪魔をしています。';
    }
    $('timelineReport').innerHTML = r;
  }

  /* ===================== 年間カレンダー =====================
   * 主要群の極大の夜について「月の条件」と「狙える時間」を並べる。
   * 極大日にどれだけ月が邪魔をするかは年ごとに変わるので、これが分かると
   * 「今年のペルセウスは当たり年」といった判断ができる。
   * 15群 × タイムライン計算はそれなりに重いので、年ごとに結果を持っておく。
   */
  let calCache = { key: null, rows: null };
  let calYear = null;

  /** その年の各群の極大の夜を評価する */
  function calendarRows(year) {
    const key = [year, state.lat.toFixed(2), state.lon.toFixed(2)].join('|');
    if (calCache.key === key) return calCache.rows;

    const rows = D.showers.filter((sh) => sh.peak).map((sh) => {
      const [mm, dd] = sh.peak.split('-').map(Number);
      // 極大日の未明（01:00）を代表時刻にする。nightTimeline は前日の夜として扱う
      const night = new Date(year, mm - 1, dd, 1, 0, 0, 0);
      const tl = A.nightTimeline(night, state.lat, state.lon, sh);
      /* 月齢と輝面比は「その夜が始まる日の正午」の値にする。
         マンスリーカレンダーのマスと同じ数え方に揃えて、別の数字が並ばないようにする */
      const noon = new Date(night.getTime() - 13 * 3600000);   // 極大日01:00 → 前日12:00
      const moonNoon = A.moonInfo(noon, state.lat, state.lon);
      return {
        shower: sh,
        date: night,
        timeline: tl,
        goldenMinutes: tl.goldenMinutes,
        illumination: moonNoon.illumination,
        moonAge: moonNoon.age,
        peakAlt: tl.peak ? tl.peak.altitude : 0,
        peakTime: tl.peak ? tl.peak.time : null,
      };
    });
    calCache = { key: key, rows: rows };
    return rows;
  }

  /**
   * 月・放射点高度・狙える時間から「当たり年かどうか」を4段階で表す。
   * 出現数の絶対値は較正できないので、あくまで条件の良し悪しの目安。
   */
  function calendarVerdict(row) {
    const hours = row.goldenMinutes / 60;
    const alt = row.peakAlt;
    if (hours <= 0 || alt <= 5) return { rank: 'bad', label: '見込みなし' };
    // 狙える時間（暗夜×月なし）と放射点の高さの両方が要る
    const score = Math.min(hours / 5, 1) * Math.min(alt / 50, 1);
    /* 評価しているのは「月と放射点高度の条件」だけで、群そのものの多さは含まない。
       「当たり年」だと出現数が多いように読めるので、条件の良し悪しとして書く（ZHR は横に並べる） */
    if (score >= 0.75) return { rank: 'ok', label: '条件よい' };
    if (score >= 0.4) return { rank: 'mid', label: 'まあまあ' };
    return { rank: 'warn', label: '条件わるい' };
  }

  function renderCalendar() {
    const years = [];
    const thisYear = new Date().getFullYear();
    for (let y = thisYear; y <= thisYear + 2; y++) years.push(y);
    if (calYear === null) calYear = thisYear;

    $('calYears').innerHTML = years.map((y) =>
      `<button type="button" class="chip${y === calYear ? ' active' : ''}" data-year="${y}">${y}年</button>`
    ).join('');

    const rows = calendarRows(calYear).slice().sort((a, b) => a.date - b.date);
    const locName = state.myLocName
      || (state.locIndex >= 0 && D.locations[state.locIndex] ? D.locations[state.locIndex].name : '手入力の座標');

    $('calList').innerHTML =
      `<p class="hint">観測地: ${escapeHtml(locName)}（${fmt(state.lat, 2)}, ${fmt(state.lon, 2)}）` +
      '<br>日付はその夜が始まる日（夕方）です。極大は未明なので前夜から狙います。</p>' +
      rows.map(showerRowHtml).join('');
  }

  /**
   * 極大の夜1件ぶんの行。計画タブの「次の流星群」と年間カレンダーで共通に使う。
   * 左の日付は「その夜が始まる日」で、極大日（未明）とは1日ずれる。
   */
  function showerRowHtml(r) {
    const v = calendarVerdict(r);
    const night = nightAnchor(r.date);
    const days = Math.round((night.getTime() - nightAnchor(new Date()).getTime()) / 86400000);
    const daysLabel = days < 0 ? '' : days === 0 ? '今夜' : days === 1 ? '明日の夜' : `${days}日後`;
    const active = r.shower.id === state.showerId && sameYMD(night, nightAnchor(currentDate()));
    return `
      <button type="button" class="cal-row${active ? ' active' : ''}"
              data-shower="${r.shower.id}" data-date="${r.date.toISOString()}">
        <div class="cal-row__date">
          <div class="cal-row__md">${night.getMonth() + 1}/${night.getDate()}</div>
          <div class="cal-row__wd">${WEEKDAYS_MON[weekIndex(night)]}</div>
          ${daysLabel ? `<div class="cal-row__days">${daysLabel}</div>` : ''}
        </div>
        <div class="cal-row__body">
          <div class="cal-row__name">${escapeHtml(r.shower.name)}
            <span class="cal-badge cal-badge--${v.rank}">${v.label}</span></div>
          <div class="cal-row__sub">
            極大 ${peakLabel(r.shower)} 未明／ZHR ${r.shower.zhr}／
            放射点 最高 <b>${fmt(r.peakAlt, 0)}°</b>
            ${r.peakTime ? '（' + hhmm(r.peakTime) + '）' : ''}
          </div>
          <div class="cal-row__sub">
            月齢 ${fmt(r.moonAge, 1)}日・輝面比 ${Math.round(r.illumination * 100)}%／
            狙える時間 <b>${r.goldenMinutes > 0 ? minutesText(r.goldenMinutes) : 'なし'}</b>
          </div>
        </div>
      </button>`;
  }

  /** 群と「その夜のいちばん狙いやすい時刻」を選ぶ（一覧と年間カレンダーの共通処理） */
  function selectShowerNight(showerId, isoDate) {
    state.showerId = showerId;
    const ref = new Date(isoDate);
    const night = nightAnchor(ref);
    const sh = D.showers.find((s) => s.id === showerId) || shower();
    const tl = A.nightTimeline(ref, state.lat, state.lon, sh);
    state.datetime = bestTimeOfNight(tl, night).toISOString();
    monthAnchor = new Date(night.getFullYear(), night.getMonth(), 1);
  }

  /* ===================== 計画タブ =====================
   * 「次の流星群っていつだっけ？」に最初に答えるページ。
   * 極大が遠い時期は機材より予定のほうが知りたいので、これを最初のタブにしている。
   *
   * カレンダーの1マスは「日付」ではなく「その夜」を表す。
   * 8/12 のマス＝8/12 の日没から 8/13 の夜明けまで。流星群の極大は未明が本番なので、
   * 極大日（例 8/13）の印はその前夜（8/12）のマスに置く。
   */

  /** カレンダーが表示している月の1日。null なら選んでいる夜の月を出す */
  let monthAnchor = null;

  const WEEKDAYS_MON = ['月', '火', '水', '木', '金', '土', '日'];

  /** その夜を代表する日付（0時0分）。未明は前の日の夜の続きとして扱う */
  function nightAnchor(date) {
    const d = new Date(date.getTime());
    if (d.getHours() < 12) d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function sameYMD(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  /** 月曜始まりの曜日番号（0=月 … 6=日） */
  function weekIndex(date) { return (date.getDay() + 6) % 7; }

  /** その夜のうち最も狙いやすい時刻（暗夜のうち放射点が最も高い時刻） */
  function bestTimeOfNight(tl, nightDate) {
    if (tl && tl.peak) return tl.peak.time;
    if (tl && tl.duskAstro && tl.dawnAstro) {
      return new Date((tl.duskAstro.getTime() + tl.dawnAstro.getTime()) / 2);
    }
    const d = new Date(nightDate.getTime());
    d.setHours(23, 0, 0, 0);
    return d;
  }

  /**
   * 月の形の小さな図。輝面比 k と満ちていく途中かどうかで描く。
   * 明るい側は「満月に向かう途中なら右」（北半球から見た向き）。
   * 明暗の境界は楕円になるので、半円＋楕円弧の2つの弧で閉じた形にする。
   */
  function moonGlyph(illumination, waxing, size) {
    const c = size / 2;
    const r = c - 0.5;
    const k = Math.max(0, Math.min(1, illumination));
    const rx = r * Math.abs(1 - 2 * k);          // 三日月ほど境界が明るい側へ寄る
    const outer = waxing ? 1 : 0;                // 明るい側の半円をどちら回りで描くか
    const inner = (!!waxing === (k < 0.5)) ? 0 : 1;
    const lit = k <= 0.01 ? '' :
      `<path d="M ${c},${c - r} A ${r},${r} 0 0,${outer} ${c},${c + r}` +
      ` A ${rx.toFixed(2)},${r} 0 0,${inner} ${c},${c - r} Z" fill="var(--ms-cal-moon-lit)"/>`;
    return `<svg class="mcell__moon" width="${size}" height="${size}" ` +
      `viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
      `<circle cx="${c}" cy="${c}" r="${r}" fill="var(--ms-cal-moon-dark)"/>${lit}</svg>`;
  }

  /** 表示中の月に極大がある夜を { 日: [流星群] } で返す */
  function peakNightsOfMonth(year, month) {
    const map = {};
    D.showers.filter((sh) => sh.peak).forEach((sh) => {
      const [pm, pd] = sh.peak.split('-').map(Number);
      // 1月・12月のマスには隣の年の極大が入るので前後の年も見る
      [year - 1, year, year + 1].forEach((y) => {
        const night = nightAnchor(new Date(y, pm - 1, pd, 1, 0, 0, 0));
        if (night.getFullYear() !== year || night.getMonth() !== month) return;
        const key = night.getDate();
        if (!map[key]) map[key] = [];
        map[key].push(sh);
      });
    });
    return map;
  }

  /** 今日以降の極大を近い順に返す */
  function upcomingPeaks(count) {
    const todayMs = nightAnchor(new Date()).getTime();
    const year = new Date().getFullYear();
    const rows = [];
    [year, year + 1].forEach((y) => {
      calendarRows(y).forEach((r) => {
        if (nightAnchor(r.date).getTime() >= todayMs) rows.push(r);
      });
    });
    rows.sort((a, b) => a.date - b.date);
    return rows.slice(0, count);
  }

  /** 'MM-DD' を「8/13」の形にする（0埋めのままだと日付に見えにくい） */
  function peakLabel(sh) {
    if (!sh.peak) return '—';
    const [m, d] = sh.peak.split('-').map(Number);
    return `${m}/${d}`;
  }

  function renderPlanList() {
    $('planList').innerHTML = upcomingPeaks(8).map(showerRowHtml).join('');
  }

  let lastNightKey = null;

  function renderMonth() {
    const selected = nightAnchor(currentDate());
    const key = selected.toDateString();
    if (key !== lastNightKey) {
      /* 日時が変わったら、その夜が見える月に合わせる。
         月送りのボタンで眺めているだけのときは動かさない（renderMonth を直接呼ぶ） */
      monthAnchor = new Date(selected.getFullYear(), selected.getMonth(), 1);
      lastNightKey = key;
    }
    const y = monthAnchor.getFullYear();
    const m = monthAnchor.getMonth();
    $('monthLabel').textContent = `${y}年 ${m + 1}月`;

    const peaks = peakNightsOfMonth(y, m);
    const today = new Date();
    const lead = weekIndex(new Date(y, m, 1));          // 1日までの空きマス
    const days = new Date(y, m + 1, 0).getDate();       // その月の日数

    const head = WEEKDAYS_MON.map((w, i) =>
      `<span class="${i === 5 ? 'is-sat' : i === 6 ? 'is-sun' : ''}">${w}</span>`).join('');

    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="mcell mcell--blank"></div>');
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m, d);
      const wi = weekIndex(date);
      const noon = new Date(y, m, d, 12, 0, 0, 0);
      const moon = A.moonInfo(noon, state.lat, state.lon);
      const sh = peaks[d];
      const cls = ['mcell'];
      if (wi === 5) cls.push('mcell--sat');
      if (wi === 6) cls.push('mcell--sun');
      if (sameYMD(date, today)) cls.push('mcell--today');
      if (sameYMD(date, selected)) cls.push('active');
      const label = `${m + 1}月${d}日（${WEEKDAYS_MON[wi]}）の夜／月齢 ${fmt(moon.age, 1)}日` +
        (sh ? '／' + sh.map((s) => s.name).join('・') + 'の極大' : '');
      cells.push(
        `<button type="button" class="${cls.join(' ')}" data-day="${d}" aria-label="${label}">` +
        `<span class="mcell__d">${d}</span>` +
        moonGlyph(moon.illumination, moon.age < 14.77, 14) +
        `<span class="mcell__peak${sh ? '' : ' mcell__peak--none'}"></span>` +
        '</button>');
    }

    $('month').innerHTML =
      `<div class="month__wd">${head}</div>` +
      `<div class="month__grid">${cells.join('')}</div>`;
  }

  /** 選んでいる夜の詳細（日の出入り・月の出入り・月齢・暗夜） */
  function renderDayReport(res) {
    const night = nightAnchor(currentDate());
    const next = new Date(night.getTime() + 86400000);
    const ev = A.dayEvents(night, state.lat, state.lon);
    const evNext = A.dayEvents(next, state.lat, state.lon);
    const tl = timelineFor(currentDate(), state.lat, state.lon, res.snap.sh);
    const peaks = peakNightsOfMonth(night.getFullYear(), night.getMonth())[night.getDate()];

    let r = `<b>${night.getMonth() + 1}/${night.getDate()}` +
      `（${WEEKDAYS_MON[weekIndex(night)]}）の夜</b>`;
    if (peaks) {
      r += '　<span class="mcell__peak mcell__peak--legend"></span>' +
        `<span style="color:var(--tb-accent)"> ` +
        peaks.map((s) => escapeHtml(s.name) + '（極大 ' + peakLabel(s) + '）').join('・') +
        'の夜</span>';
    }
    r += '<br>';
    r += `日の入 <b>${hhmm(ev.sunset)}</b> → 翌 日の出 <b>${hhmm(evNext.sunrise)}</b>`;
    if (tl.duskAstro && tl.dawnAstro) {
      const darkMin = (tl.dawnAstro.getTime() - tl.duskAstro.getTime()) / 60000;
      r += `／暗夜 <b>${hhmm(tl.duskAstro)} 〜 ${hhmm(tl.dawnAstro)}</b>（${minutesText(darkMin)}）`;
    }
    r += '<br>';

    /* 月はこの夜に出ているかどうかが本題なので、夜のあいだの出入りを先に書く */
    if (!tl.moonUp.length) {
      r += `月：<b>この夜は出ていません</b>`;
    } else {
      const spans = tl.moonUp.map((s) => `${hhmm(s.from)}〜${hhmm(s.to)}`).join('、');
      r += `月が出ている時間：<b>${spans}</b>`;
    }
    r += `（月齢 <b>${fmt(ev.moonAge, 1)}日</b>・輝面比 <b>${Math.round(ev.illumination * 100)}%</b>）<br>`;
    r += `この日の 日の出 ${hhmm(ev.sunrise)}・日の入 ${hhmm(ev.sunset)}／` +
      `月の出 ${hhmm(ev.moonrise)}・月の入 ${hhmm(ev.moonset)}<br>`;
    if (tl.peak) {
      r += `放射点が最も高いのは <b>${hhmm(tl.peak.time)}</b>（${fmt(tl.peak.altitude, 0)}°）／`;
    }
    r += `狙える時間 <b>${tl.goldenMinutes > 0 ? minutesText(tl.goldenMinutes) : 'なし'}</b>`;
    r += '<p class="hint">時刻は近似値です。国立天文台の公表値と比べて太陽は±1分、月は±3分の範囲で一致します。' +
      '「狙える時間」は暗夜・月なし・放射点が地平線上の重なりです。</p>';
    $('dayReport').innerHTML = r;
  }

  /** カレンダーの表示月を送る（選んでいる夜は動かさない） */
  function shiftMonth(delta) {
    const base = monthAnchor || nightAnchor(currentDate());
    monthAnchor = new Date(base.getFullYear(), base.getMonth() + delta, 1);
    renderMonth();
  }

  function renderPlan(res) {
    renderPlanList();
    renderMonth();
    renderDayReport(res);

    /* 流星群そのものの数値（条件タブから移設） */
    const sh = res.snap.sh;
    const tags = [];
    if (sh.fireball === 'high') tags.push('<span class="tag tag--fireball">火球が多い</span>');
    if (sh.velocity >= 60) tags.push('<span class="tag tag--fast">高速で不利</span>');
    if (sh.velocity <= 30) tags.push('<span class="tag tag--slow">低速で有利</span>');
    $('showerInfo').innerHTML = `
      <div class="shower-info__grid">
        <div class="stat"><div class="stat__label">対地速度</div><div class="stat__value">${sh.velocity} km/s</div></div>
        <div class="stat"><div class="stat__label">流星の角速度</div><div class="stat__value">${fmt(res.cfg.omegaDeg, 1)} °/s</div></div>
        <div class="stat"><div class="stat__label">平均光度</div><div class="stat__value">${signed(sh.meanMag)} 等</div></div>
        <div class="stat"><div class="stat__label">光度分布 r</div><div class="stat__value">${sh.r}</div></div>
        <div class="stat"><div class="stat__label">極大</div><div class="stat__value">${sh.peak ? sh.peak.replace('-', '/') : '—'}</div></div>
        <div class="stat"><div class="stat__label">ZHR</div><div class="stat__value">${sh.zhr}</div></div>
      </div>
      <div>${tags.join('')}</div>
      <p class="shower-info__note">${sh.note || ''}</p>`;
  }

  /* ===================== 画角プレビュー =====================
   * カメラの向きを中心にした心射投影（gnomonic projection）で、レンズが写す範囲を
   * そのまま長方形に描く。星は stars.js（5.0等まで1630星）から引く。
   * 星座線は入れていない（ライセンスが波及しないデータが無いため）。
   * 代わりに1等星クラスの固有名を出して向きが分かるようにしている。
   */
  const RAD = Math.PI / 180;

  /**
   * 方位・高度を、視野中心（az0, alt0）を原点とする画面座標に写す。
   * 返り値の x は右が正・y は上が正で、単位は「中心から見た接平面上の距離」。
   * behind が true の点は視野の裏側なので描かない。
   */
  function projectSky(az, alt, az0, alt0) {
    const a = alt * RAD;
    const a0 = alt0 * RAD;
    const dAz = (az - az0) * RAD;
    const cosC = Math.sin(a0) * Math.sin(a) + Math.cos(a0) * Math.cos(a) * Math.cos(dAz);
    if (cosC <= 0.01) return { behind: true };
    return {
      x: (Math.cos(a) * Math.sin(dAz)) / cosC,
      y: (Math.cos(a0) * Math.sin(a) - Math.sin(a0) * Math.cos(a) * Math.cos(dAz)) / cosC,
      behind: false,
    };
  }

  /** 放射点から指定した角距離だけ離れた点の列（離角の目安の円を描くため） */
  function circleAround(az0, alt0, radiusDeg, steps) {
    const pts = [];
    const r = radiusDeg * RAD;
    const a0 = alt0 * RAD;
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * 2 * Math.PI;
      // 中心（az0, alt0）から方位角 th の向きに r だけ進んだ点（球面三角）
      const alt = Math.asin(Math.sin(a0) * Math.cos(r) + Math.cos(a0) * Math.sin(r) * Math.cos(th));
      const dAz = Math.atan2(Math.sin(r) * Math.sin(th),
        Math.cos(a0) * Math.cos(r) - Math.sin(a0) * Math.sin(r) * Math.cos(th));
      pts.push({ az: az0 + dAz / RAD, alt: alt / RAD });
    }
    return pts;
  }

  function renderFovOrient() {
    document.querySelectorAll('#fovOrient [data-orient]').forEach((b) => {
      b.classList.toggle('active', (b.dataset.orient === 'port') === !!state.fovPortrait);
    });
  }

  /** 表示されているときだけ画角プレビューを描く */
  function redrawFov() {
    if (!lastRes) return;
    if ($('fovWrap').clientWidth <= 0) return;
    renderFov(lastRes);
  }

  /**
   * 視野中心において「天の北極の方向」が画面の上からどれだけ傾いているか [度]。
   * 赤道儀に載せたカメラは赤経赤緯に合わせて構えるので、枠がこの角度だけ傾く。
   *
   * 解析式（パララクティック角）を書くと符号や象限を間違えやすいので、
   * 中心から赤緯をわずかに北へずらした点を投影して、その向きから求める。
   */
  function frameTiltDeg(az0, alt0, date) {
    const eq = A.horizontalToEquatorial(az0, alt0, state.lat, state.lon, date);
    const step = eq.dec > 89.9 ? -0.05 : 0.05;   // 天の北極そのものを向いている場合は南へずらす
    const hz = A.equatorialToHorizontal(eq.ra, eq.dec + step, state.lat, state.lon, date);
    const pt = projectSky(hz.azimuth, hz.altitude, az0, alt0);
    if (pt.behind) return 0;
    const sign = step > 0 ? 1 : -1;
    return Math.atan2(sign * pt.x, sign * pt.y) / RAD;
  }

  function renderFov(res) {
    const wrap = $('fovWrap');
    const cv = $('fovCanvas');
    const fov = E.fieldOfView(state.focal, state.sensorW, state.sensorH);
    const geo = res.cfg.geo;

    const az0 = geo.az;
    /* 計算に使う高度には下限があるが、プレビューは実際に向いている方向を描く
       （地平線の下を狙っていればそれが分かるようにする） */
    const alt0 = geo.altTrue;
    const date = currentDate();

    /* --- 枠（センサーが写す範囲）を作る ---
       心射投影ではレンズの画角がそのまま長方形になるので、中心を共有する長方形として
       正確に描ける。縦構図は縦横を入れ替え、赤道儀追尾のときは天の北極が枠の上に
       来るように傾ける（空は地平線基準のまま動かさない）。 */
    const portrait = !!state.fovPortrait;
    const frameW = portrait ? fov.heightDeg : fov.widthDeg;
    const frameH = portrait ? fov.widthDeg : fov.heightDeg;
    const tilt = state.tracked ? frameTiltDeg(az0, alt0, date) : 0;
    const halfFw = Math.tan(frameW / 2 * RAD);
    const halfFh = Math.tan(frameH / 2 * RAD);
    const ct = Math.cos(tilt * RAD);
    const st = Math.sin(tilt * RAD);
    /* 枠の四隅（接平面上）。傾きぶん回してから使う */
    const frameCorners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
      const x = sx * halfFw;
      const y = sy * halfFh;
      return { x: x * ct + y * st, y: -x * st + y * ct };
    });

    /* 表示範囲は枠がすべて入るように取り、まわりに少し空を見せる */
    const boundX = Math.max.apply(null, frameCorners.map((c) => Math.abs(c.x)));
    const boundY = Math.max.apply(null, frameCorners.map((c) => Math.abs(c.y)));
    const margin = D.fovMargin || 1.35;
    const halfW = boundX * margin;
    const halfH = boundY * margin;

    const cssW = wrap.clientWidth;
    if (cssW <= 0) return;
    const cssH = Math.round(cssW * (halfH / halfW));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.style.width = cssW + 'px';
    cv.style.height = cssH + 'px';
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);

    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    /* 接平面上の座標 → 画面座標 */
    const scale = (cssW / 2) / halfW;
    const toScreen = (pt) => ({ x: cssW / 2 + pt.x * scale, y: cssH / 2 - pt.y * scale });
    const framePts = frameCorners.map(toScreen);

    const bg = themeColor('--ms-tl-dark', '#101726');
    g.fillStyle = bg;
    g.fillRect(0, 0, cssW, cssH);

    /* 地平線（高度0°の線）。視野に入るときだけ描く */
    g.strokeStyle = themeColor('--tb-danger', '#f85149');
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    g.beginPath();
    let started = false;
    for (let d = -100; d <= 100; d += 2) {
      const pt = projectSky(az0 + d, 0, az0, alt0);
      if (pt.behind) { started = false; continue; }
      const sp = toScreen(pt);
      if (!started) { g.moveTo(sp.x, sp.y); started = true; } else { g.lineTo(sp.x, sp.y); }
    }
    g.stroke();
    g.setLineDash([]);

    /* 星。等級で大きさを変える（明るいほど大きく） */
    const starColor = themeColor('--tb-text-primary', '#e6edf3');
    const labelColor = themeColor('--tb-text-secondary', '#8b949e');
    const font = '"Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif';
    const labels = [];
    if (typeof MS_STARS !== 'undefined') {
      MS_STARS.forEach((st) => {
        const hz = A.equatorialToHorizontal(st[0], st[1], state.lat, state.lon, date);
        const pt = projectSky(hz.azimuth, hz.altitude, az0, alt0);
        if (pt.behind) return;
        const sp = toScreen(pt);
        if (sp.x < -10 || sp.x > cssW + 10 || sp.y < -10 || sp.y > cssH + 10) return;
        const r = Math.max(0.7, (5.2 - st[2]) * 0.55);
        g.fillStyle = starColor;
        g.globalAlpha = Math.max(0.35, Math.min(1, (5.4 - st[2]) / 3));
        g.beginPath();
        g.arc(sp.x, sp.y, r, 0, 2 * Math.PI);
        g.fill();
        if (st[3]) labels.push({ x: sp.x, y: sp.y, name: st[3], r: r });
      });
      g.globalAlpha = 1;
    }

    /* 固有名。重なるものは間引き、端で切れたり下の方位表示に被るものは出さない */
    g.font = `12px ${font}`;
    g.fillStyle = labelColor;
    const placed = [];
    labels.sort((a, b) => b.r - a.r).forEach((l) => {
      if (l.y < 16 || l.y > cssH - 24) return;          // 上端で切れる／下端の方位表示に被る
      if (l.x > cssW - 70) return;                       // 右端で切れる
      if (placed.some((q) => Math.abs(q.x - l.x) < 70 && Math.abs(q.y - l.y) < 15)) return;
      placed.push(l);
      g.fillText(l.name, l.x + l.r + 4, l.y + 4);
    });

    /* 放射点と、そこから45°の円 */
    const rad = res.snap.rad;
    let radiantInside = false;
    if (!rad.isSporadic && rad.azimuth != null) {
      const ring = circleAround(rad.azimuth, rad.altitude, 45, 96);
      g.strokeStyle = themeColor('--ms-warn', '#d9a03c');
      g.lineWidth = 1.5;
      g.beginPath();
      let on = false;
      ring.forEach((q) => {
        const pt = projectSky(q.az, q.alt, az0, alt0);
        if (pt.behind) { on = false; return; }
        const sp = toScreen(pt);
        if (!on) { g.moveTo(sp.x, sp.y); on = true; } else { g.lineTo(sp.x, sp.y); }
      });
      g.stroke();

      const rp = projectSky(rad.azimuth, rad.altitude, az0, alt0);
      if (!rp.behind) {
        const sp = toScreen(rp);
        // 枠の座標系に戻して内外を判定する（傾いていても正しく効く）
        const lx = rp.x * ct - rp.y * st;
        const ly = rp.x * st + rp.y * ct;
        radiantInside = Math.abs(lx) <= halfFw && Math.abs(ly) <= halfFh;
        g.strokeStyle = themeColor('--tb-accent', '#7eb8da');
        g.lineWidth = 2;
        g.beginPath();
        g.arc(sp.x, sp.y, 9, 0, 2 * Math.PI);
        g.stroke();
        g.beginPath();
        g.moveTo(sp.x - 14, sp.y);
        g.lineTo(sp.x + 14, sp.y);
        g.moveTo(sp.x, sp.y - 14);
        g.lineTo(sp.x, sp.y + 14);
        g.stroke();
        if (radiantInside) {
          g.fillStyle = themeColor('--tb-accent', '#7eb8da');
          g.font = `bold 12px ${font}`;
          g.fillText('放射点', sp.x + 14, sp.y - 8);
        }
      }
    }

    /* --- 枠。外側を暗くしてから枠線を引く（写る範囲がひと目で分かるように） --- */
    g.save();
    g.beginPath();
    g.rect(0, 0, cssW, cssH);
    g.moveTo(framePts[0].x, framePts[0].y);
    for (let i = framePts.length - 1; i >= 1; i--) g.lineTo(framePts[i].x, framePts[i].y);
    g.closePath();
    g.fillStyle = themeColor('--ms-backdrop', 'rgba(0,0,0,0.6)');
    g.fill('evenodd');
    g.restore();

    g.strokeStyle = themeColor('--tb-text-primary', '#e6edf3');
    g.lineWidth = 2;
    g.beginPath();
    framePts.forEach((q, i) => { if (i === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y); });
    g.closePath();
    g.stroke();

    /* 枠の上辺の外側に、枠の「上」を指す矢印と説明を置く。
       追尾では枠が傾くので、画面の上ではなく枠の上を指させる必要がある */
    const topMid = { x: (framePts[0].x + framePts[1].x) / 2, y: (framePts[0].y + framePts[1].y) / 2 };
    const dx = topMid.x - cssW / 2;
    const dy = topMid.y - cssH / 2;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const tip = { x: topMid.x + ux * 13, y: topMid.y + uy * 13 };
    g.strokeStyle = themeColor('--tb-text-primary', '#e6edf3');
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(topMid.x, topMid.y);
    g.lineTo(tip.x, tip.y);
    // 矢じり（進行方向に対して左右へ開く）
    g.lineTo(tip.x - ux * 5 - uy * 4, tip.y - uy * 5 + ux * 4);
    g.moveTo(tip.x, tip.y);
    g.lineTo(tip.x - ux * 5 + uy * 4, tip.y - uy * 5 - ux * 4);
    g.stroke();

    g.fillStyle = themeColor('--tb-text-primary', '#e6edf3');
    g.font = `bold 11px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = state.tracked ? '天の北極' : '上';
    const lw = g.measureText(label).width;
    // 画面の外へ出ないように寄せる
    const lx = Math.max(lw / 2 + 4, Math.min(cssW - lw / 2 - 4, topMid.x + ux * 26));
    const ly = Math.max(10, Math.min(cssH - 10, topMid.y + uy * 26));
    g.fillText(label, lx, ly);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';

    /* 画面の端に方位と高度を書く */
    g.fillStyle = labelColor;
    g.font = `12px ${font}`;
    g.fillText(`${A.compassName(az0)} ${Math.round(az0)}° / 高度 ${Math.round(alt0)}°`, 8, cssH - 8);
    g.textAlign = 'right';
    g.fillText(`${fmt(frameW, 0)}° × ${fmt(frameH, 0)}°`, cssW - 8, cssH - 8);
    g.textAlign = 'left';

    /* 文章の補足 */
    $('fovNote').textContent = `対角 ${fmt(fov.diagDeg, 0)}°。`;
    let r = '';
    r += `写る範囲 <b>${fmt(frameW, 1)}° × ${fmt(frameH, 1)}°</b>`;
    r += `（${portrait ? '縦構図' : '横構図'}／対角 <b>${fmt(fov.diagDeg, 1)}°</b>）<br>`;
    if (state.tracked) {
      r += `赤道儀で追尾するので枠は天の北極を上にして構えます。` +
        `この向きでは地平線に対して <b>${fmt(Math.abs(tilt), 0)}°</b> 傾きます。<br>`;
    } else {
      r += '固定撮影なのでカメラは水平に構えます（枠の辺は地平線と平行）。<br>';
    }
    if (rad.isSporadic) {
      r += '放射点を持たない群のため、放射点の印は出していません。';
    } else if (radiantInside) {
      r += `放射点は<b>画角の中</b>（離角 <b>${fmt(geo.separation, 0)}°</b>）。` +
        '広角では45°離しても画角に入ります。放射点に近いほど流星は短く写るので、' +
        '長い流星を狙うなら画面の端に置くとよいです。';
    } else {
      r += `放射点は<b>画角の外</b>（離角 <b>${fmt(geo.separation, 0)}°</b>）。` +
        '橙色の円が「放射点から45°」の目安です。';
    }
    $('fovReport').innerHTML = r;
    renderFovOrient();
  }

  function renderCond(res) {
    // 流星群そのものの数値は計画タブ（renderPlan）に移した
    const sh = res.snap.sh;
    const rad = res.snap.rad;
    const sun = res.snap.sun;
    const moon = res.snap.moon;
    // 暗夜とピークはタイムラインの計算結果を使い回す（同じ走査を2回しない）
    const tl = timelineFor(currentDate(), state.lat, state.lon, sh);

    let report = '';
    report += rad.isSporadic
      ? '放射点を持たない群のため、高度45°相当で計算しています。<br>'
      : `放射点高度 <b>${fmt(rad.altitude, 1)}°</b>（方位 ${fmt(rad.azimuth, 0)}°）／極大からのずれ <b>${signed(rad.daysFromPeak, 1)}日</b><br>`;
    report += `太陽高度 <b>${fmt(sun.altitude, 1)}°</b>`;
    report += sun.altitude > -18 ? '（<span style="color:var(--ms-warn)">薄明中</span>）<br>' : '（天文薄明終了後）<br>';
    report += `月 高度 <b>${fmt(moon.altitude, 1)}°</b>／輝面比 <b>${Math.round(moon.illumination * 100)}%</b>／月齢 <b>${fmt(moon.age, 1)}日</b><br>`;
    if (tl.duskAstro && tl.dawnAstro) {
      report += `暗夜 <b>${hhmm(tl.duskAstro)} 〜 ${hhmm(tl.dawnAstro)}</b>`;
      if (tl.peak) report += `／放射点が最も高いのは <b>${hhmm(tl.peak.time)}</b>（${fmt(tl.peak.altitude, 0)}°）`;
    }
    $('astroReport').innerHTML = report;

    // カメラの向き
    const geo = res.cfg.geo;
    let camHead = '';
    if (eqAimActive()) {
      /* 追尾中は方位・高度が「赤経赤緯から決まる値」になる。夜のあいだに高度が
         どう動くかが露出条件に直結するので、1時間後の高度も添える */
      $('camRaValue').textContent = raLabel(state.camRa);
      $('camDecValue').textContent = signed(state.camDec, 0) + '°';
      const later = A.equatorialToHorizontal(state.camRa, state.camDec, state.lat, state.lon,
        new Date(currentDate().getTime() + 3600000));
      camHead += `いまこの向きは <b>${A.compassName(geo.az)} ${Math.round(geo.az)}°</b>` +
        `／高度 <b>${fmt(geo.altTrue, 0)}°</b>（1時間後 ${fmt(later.altitude, 0)}°）<br>`;
      if (geo.belowFloor) {
        camHead += `<span style="color:var(--ms-warn)">この時刻には高度 ${CAM_ALT_MIN}° より低いため、` +
          `大気の影響は高度 ${CAM_ALT_MIN}° として計算しています。</span><br>`;
      }
    } else {
      $('camAz').value = geo.az;
      $('camAzValue').textContent = Math.round(geo.az) + '°';
      $('camAzName').textContent = A.compassName(geo.az);
      $('camAltValue').textContent = Math.round(geo.alt);
    }
    const clamped = geo.separation < geo.elong - 0.01;
    $('camReport').innerHTML = camHead +
      `放射点からの離角 <b>${fmt(geo.separation, 0)}°</b>` +
      (clamped ? `（計算には下限の ${geo.elong}° を使用）` : '') +
      `／流星の角速度 <b>${fmt(res.cfg.omegaDeg, 1)} °/s</b><br>` +
      `大気の厚み <b>${fmt(geo.airmass, 2)}</b> 倍（天頂比）<br>` +
      `この向きの空の明るさ <b>${fmt(geo.skyHere, 2)}</b> 等/平方秒` +
      `（天頂より ${fmt(geo.skyHere - res.skyInfo.sky, 2)}等）<br>` +
      `流星自身の減光 <b>${signed(-geo.extinction, 2)}</b> 等（基準の高度38°比）` +
      `<p class="hint">高度による空の明るさと減光は近似値です。大気光や透明度は夜ごとに変わり、` +
      `方位による明るさの差（街の方向かどうか）は天頂輝度の地図からは求められないため含めていません。</p>`;

    const eff = res.skyInfo;
    $('effectiveSky').textContent = `${eff.sky.toFixed(2)} 等/平方秒` +
      (Math.abs(eff.delta) > 0.01 ? `（月による補正 ${signed(eff.delta, 2)}）` : '（月の影響なし）');
  }

  /* ===================== 描画：結果タブ ===================== */
  function renderResult(res) {
    const ev = res.ev;
    const sh = res.snap.sh;
    const p = purpose();

    /* --- サマリーとヒーロー --- */
    $('sumShutter').textContent = shutterLabel(res.rec.exposure);
    $('sumFnum').textContent = 'F' + state.fnum.toFixed(1);
    $('sumIso').textContent = res.rec.iso;
    $('resShutter').textContent = res.rec.exposure;
    $('resFnum').textContent = 'F' + state.fnum.toFixed(1);
    $('resIso').textContent = res.rec.iso;
    $('heroPurpose').textContent = `${p.icon} ${p.label} / ${sh.name}`;

    const heroNotes = [];
    heroNotes.push(state.tracked
      ? `赤道儀で追尾するため NPF則の上限（${fmt(ev.npf, 2)}秒）は外し、指定の上限 ${state.maxExposure}秒 の範囲で選んでいます。`
      : `NPF則の上限は ${fmt(ev.npf, 2)}秒。日周運動で星が伸びない範囲でこれを選んでいます。`);
    heroNotes.push(`ISO は「到達等級の損失が ${p.isoTolerance}等 未満に収まる最も低い値」として選びました。ISO を上げても到達等級はほぼ変わらず、火球の白飛び余裕だけが 1段ごとに 0.76等 失われます。`);
    heroNotes.push(`絞りは開放が最適です（1段開けるごとに +0.38等）。`);
    $('heroNote').innerHTML = heroNotes.join('<br>');

    /* --- 到達等級 --- */
    $('resLimMag').textContent = signed(ev.limMag);
    const margin = ev.limMag - sh.meanMag;
    const limV = $('limVerdict');
    if (margin >= 0.5) {
      limV.className = 'verdict verdict--ok';
      limV.textContent = `${sh.name}の平均光度（${signed(sh.meanMag)}等）に対して ${signed(margin)}等 の余裕があります。平均的な流星は余裕をもって写ります。`;
    } else if (margin >= 0) {
      limV.className = 'verdict verdict--ok';
      limV.textContent = `${sh.name}の平均光度（${signed(sh.meanMag)}等）にちょうど届いています（余裕 ${signed(margin)}等）。`;
    } else if (margin >= -0.5) {
      limV.className = 'verdict verdict--warn';
      limV.textContent = `${sh.name}の平均光度（${signed(sh.meanMag)}等）に ${fmt(-margin)}等 届いていません。平均より明るい流星しか写りません。`;
    } else {
      limV.className = 'verdict verdict--bad';
      limV.textContent = `${sh.name}の平均光度（${signed(sh.meanMag)}等）に ${fmt(-margin)}等 届きません。より暗い空、明るいレンズ、長い焦点距離のいずれかが必要です。`;
    }
    renderMagbar(ev.limMag, sh.meanMag);

    /* --- 火球 --- */
    $('resFireball').textContent = signed(ev.fireballMag);
    const fbV = $('fireballVerdict');
    const est = state.fwcSource !== 'measured';
    fbV.className = 'verdict ' + (ev.fireballMag <= -4 ? 'verdict--ok' : ev.fireballMag <= -2 ? 'verdict--warn' : 'verdict--bad');
    fbV.innerHTML = `${signed(ev.fireballMag)}等 より明るい火球は白飛びします。` +
      (ev.fireballMag <= -4 ? '−4等級（金星クラス）の火球まで階調を保てます。' : 'ISO を下げると 1段ごとに 0.76等 ぶん余裕が増えます。') +
      (est ? '<br><span style="color:var(--ms-warn)">※ この機種の飽和電子数は推定値です（誤差1段で ±0.75等）。</span>' : '');
    $('resHeadroom').textContent = `飽和電子数は背景の ${fmt(ev.fireballHeadroom, 0)} 倍`;

    /* --- 途切れない確率 --- */
    const pct = ev.uncut * 100;
    $('resUncut').textContent = fmt(pct, 0);
    $('uncutBar').style.width = Math.max(pct, 0) + '%';
    const uV = $('uncutVerdict');
    uV.className = 'verdict ' + (pct >= 60 ? 'verdict--ok' : pct >= 30 ? 'verdict--warn' : 'verdict--bad');
    uV.textContent = pct <= 0
      ? `継続時間 ${state.durTarget}秒 の流星は、露出 ${res.rec.exposure}秒 では必ず途切れます（露出が継続時間以下）。`
      : `継続時間 ${state.durTarget}秒 の流星が1コマに丸ごと収まる確率は ${fmt(pct, 0)}%（露出 ${res.rec.exposure}秒＋コマ間隔 ${state.gap}秒）。`;

    renderWarnings(res);
    renderChecklist();
    renderWhatIf(res);
    renderDetail(res);
    renderVerify();
  }

  function renderMagbar(limMag, target) {
    const min = -2, max = 5;
    const pos = (m) => Math.max(0, Math.min(100, (m - min) / (max - min) * 100));
    $('magbar').innerHTML = `
      <div class="magbar__track">
        <div class="magbar__fill" style="width:${pos(limMag)}%"></div>
        <div class="magbar__marker" style="left:${pos(limMag)}%"></div>
        <div class="magbar__marker magbar__marker--target" style="left:${pos(target)}%"></div>
      </div>
      <div class="magbar__labels">
        <span>−2等（明るい）</span><span>+1</span><span>+3</span><span>+5等（暗い）</span>
      </div>
      <p class="hint">白い線＝到達等級（ここまで写る）／橙の線＝この群の平均光度</p>`;
  }

  function renderChecklist() {
    const items = [
      '長秒時ノイズ低減をオフにする（オンだと撮影可能時間が半分になります）',
      '高感度ノイズ低減をオフにする',
      '周辺光量補正をオフにする',
      'ピントはライブビュー拡大で追い込む（トレイル幅が2倍になると絞り2段ぶん失います）',
      '手ブレ補正をオフにし、三脚を安定させる',
      'RAWで記録する（探索は全画面表示、等倍で判定しない）',
      'バッテリーとメモリカードの残量を撮影時間ぶん確保する',
    ];
    $('checkList').innerHTML = items
      .map((t) => `<li class="is-ok"><span class="warn-list__icon">☑</span><span>${t}</span></li>`).join('');
  }

  function renderWarnings(res) {
    const ev = res.ev;
    const items = [];
    const add = (level, text) => items.push({ level, text });

    if (!res.snap.rad.isSporadic) {
      if (res.snap.rad.altitude <= 0) {
        add('bad', `放射点が地平線下（${fmt(res.snap.rad.altitude, 1)}°）です。この時刻は撮影できません。高度5°として計算しています。`);
      } else if (res.snap.rad.altitude < 20) {
        add('warn', `放射点高度が ${fmt(res.snap.rad.altitude, 1)}° と低く、出現数が大きく減ります（放射点高度の sin に比例）。`);
      }
    }
    if (res.snap.sun.altitude > -18) {
      add('bad', `太陽高度が ${fmt(res.snap.sun.altitude, 1)}° で薄明中です。空の明るさが計算値より悪化します。`);
    }
    if (res.snap.moon.altitude > 0 && res.snap.moon.illumination > 0.25) {
      add('warn', `月が高度 ${fmt(res.snap.moon.altitude, 1)}°・輝面比 ${Math.round(res.snap.moon.illumination * 100)}% で出ています。`);
    }
    if (state.tracked) {
      if (res.rec.exposure > ev.npf + 0.01) {
        add('ok', `露出 ${res.rec.exposure}秒 は固定撮影の上限（NPF則 ${fmt(ev.npf, 2)}秒）を超えていますが、追尾するため星は点に写ります。`);
      }
      add('warn', '追尾すると地上の風景は流れます。星景として前景を止めたい場合は固定撮影にするか、別に前景用のコマを撮ってください。');
      add('warn', `極軸合わせと追尾精度を確認してください。${res.cfg.focal}mm で ${res.rec.exposure}秒 なら要求は緩めですが、ずれると星が伸びます。`);
    } else if (res.rec.exposure > ev.npf + 0.01) {
      add('bad', `露出 ${res.rec.exposure}秒 は NPF則の上限 ${fmt(ev.npf, 2)}秒 を超えています。星が線になります。`);
    }
    if (ev.noiseDominance < 2) {
      add('warn', `背景電子数（${fmt(ev.bkgElectrons, 1)} e-）が読み出しノイズ（${fmt(ev.readNoise, 2)} e-）に対して小さく、読み出しノイズ支配です。ISO を上げるか露出を延ばす余地があります。`);
    }
    if (state.pixelPitch < 4.0) {
      add('warn', '高画素機です。流星の探索は等倍ではなく全画面表示で行ってください（縮小で最大0.44等ぶん回復します）。');
    }
    if (state.fwcSource !== 'measured') {
      add('warn', 'この機種の飽和電子数は推定値です。火球の白飛び限界だけが不確かで、他の数値には影響しません。');
    }
    if (ev.uncut < 0.4) {
      add('warn', `狙っている ${state.durTarget}秒 の流星は ${Math.round((1 - ev.uncut) * 100)}% の確率でコマの境目で途切れます。コマ間隔を詰めるか露出を延ばすと改善します。`);
    }
    if (res.cfg.geo.separation < 15) {
      add('warn', `カメラの向きが放射点に近すぎます（離角 ${fmt(res.cfg.geo.separation, 0)}°）。流星は点に近い短い痕跡しか残りません。`);
    }
    if (res.cfg.geo.belowFloor) {
      add('bad', `狙っている赤経・赤緯はこの時刻には高度 ${fmt(res.cfg.geo.altTrue, 0)}°（地平線の下または低空すぎ）です。` +
        `大気の計算は高度 ${CAM_ALT_MIN}° として扱っているので、時刻か向きを変えてください。`);
    } else if (res.cfg.geo.alt < 25) {
      add('warn', `カメラの高度が ${fmt(res.cfg.geo.alt, 0)}° と低く、空が明るくなるうえ流星も ${fmt(res.cfg.geo.extinction, 2)}等 減光します。`);
    }
    if (ev.aperture < 12) {
      add('bad', `有効口径が ${fmt(ev.aperture, 1)}mm で、記事の基準（12mm以上）を下回ります。明るいレンズか長い焦点距離が必要です。`);
    }
    if (items.length === 0) {
      add('ok', 'この設定に大きな問題は見つかりませんでした。');
    }

    const icon = { bad: '⛔', warn: '⚠️', ok: '✅' };
    $('warnList').innerHTML = items.map((i) =>
      `<li class="is-${i.level}"><span class="warn-list__icon">${icon[i.level]}</span><span>${i.text}</span></li>`).join('');
  }

  /** 記事の基準構成を固定値で計算し、記事の数値と並べて表示する */
  function renderVerify() {
    const refCam = D.cameras.find((c) => c.id === 'a7rv');
    const per = D.showers.find((s) => s.id === 'per');
    const ev = E.evaluate({
      camera: refCam, focal: 20, fnum: 1.4, trailFactor: 1.0, sky: 21.0,
      omegaDeg: 18, exposure: 8, gap: 1.0, iso: 640, r: per.r, meanMag: per.meanMag,
      radiantAlt: 50, sensorW: 35.9, sensorH: 23.9, fireballDuration: 2.0,
    });
    const evIso1280 = E.evaluate({
      camera: refCam, focal: 20, fnum: 1.4, trailFactor: 1.0, sky: 21.0,
      omegaDeg: 18, exposure: 8, gap: 1.0, iso: 1280, r: per.r, meanMag: per.meanMag,
      radiantAlt: 50, sensorW: 35.9, sensorH: 23.9, fireballDuration: 2.0,
    });
    const rows = [
      ['NPF則の露出上限', `${fmt(ev.npf, 2)} 秒`, '8.08 秒'],
      ['有効口径', `${fmt(ev.aperture, 2)} mm`, '14.3 mm'],
      ['到達等級', `${signed(ev.limMag)} 等`, '+1.63 等'],
      ['火球の白飛び限界', `${signed(ev.fireballMag)} 等`, '−4.25 等'],
      ['2秒火球が途切れない確率', `${fmt(ev.uncut * 100, 0)} %`, '67 %'],
      ['ISO 1段で失う火球保護', `${fmt(evIso1280.fireballMag - ev.fireballMag, 2)} 等`, '0.76 等'],
      ['ISO 1段の到達等級への影響', `${signed(evIso1280.limMag - ev.limMag, 3)} 等`, '±0.003 等'],
      ['飽和電子数（ISO 100）', `${refCam.fwcBase.toLocaleString()} e-`, '35,815 e-'],
      ['読み出しノイズ（ISO 640）', `${fmt(E.readNoiseAt(refCam, 640), 2)} e-`, '1.41 e-'],
      ['背景ノイズ支配（>1で背景）', `${fmt(ev.noiseDominance, 1)} 倍`, '背景支配'],
    ];
    $('verifyTable').innerHTML =
      '<tr><th style="color:var(--tb-text-secondary)">項目</th><td style="color:var(--tb-accent)">本アプリ</td><td style="color:var(--tb-text-muted)">記事</td></tr>' +
      rows.map(([k, a, b]) => `<tr><th>${k}</th><td>${a}</td><td style="color:var(--tb-text-muted)">${b}</td></tr>`).join('');
  }

  function renderWhatIf(res) {
    const base = res.cfg;
    const baseMag = res.ev.limMag;
    const lens = state.lensIndex >= 0 ? D.lenses[state.lensIndex] : null;
    const cases = [];

    const test = (label, over, note) => {
      const e = E.evaluate(Object.assign({}, base, over));
      cases.push({ label: label, delta: e.limMag - baseMag, note: note });
    };

    if (lens && state.fnum > lens.fnum + 0.01) {
      test(`絞りを開放 F${lens.fnum.toFixed(1)} まで開ける`, { fnum: lens.fnum });
    } else {
      test('絞りを1段開ける（もし開けられたら）', { fnum: state.fnum / Math.SQRT2 });
    }
    test('焦点距離を2倍にする', { focal: state.focal * 2 },
      '画角が1/4になり、遭遇本数は大きく減ります');
    if (state.trailId !== 'sharp') {
      test('ピントを追い込む（画面中央の星像）', { trailFactor: 1.0 });
    }
    test('空が1等暗い場所へ移動する', { sky: base.sky + 1.0 });
    test('露出を半分にする', { exposure: Math.max(res.rec.exposure / 2, 0.3) },
      '長い火球が途切れる確率が上がり、日周運動の余裕も使い切れません');
    const geo = res.cfg.geo;
    test('放射点の近く（離角を半分）を狙う', {
      omegaDeg: E.angularVelocity(res.snap.sh.velocity, Math.max(geo.elong / 2, 10), geo.alt),
    }, '放射点付近は流星が短く写り、見た目の迫力は落ちます');
    if (geo.alt < 90) {
      test('カメラを天頂に向ける', {
        omegaDeg: E.angularVelocity(res.snap.sh.velocity, geo.elong, 90),
        sky: base.sky - geo.skyOffset + E.skyOffsetForAltitude(res.skyInfo.sky, 90),
        camAlt: 90,
      }, '空が最も暗く流星の減光も最小。ただし角速度は最大になります');
    }
    test('ISO を1段上げる', { iso: res.rec.iso * 2 },
      `火球の白飛び限界が 0.76等 悪化します（記事の中心的な指摘）`);

    $('whatifList').innerHTML = cases.map((c) =>
      `<li><span>${c.label}${c.note ? `<br><span class="hint">${c.note}</span>` : ''}</span>` +
      `<span class="whatif__delta ${c.delta >= 0 ? 'plus' : 'minus'}">${signed(c.delta)}等</span></li>`
    ).join('');
  }

  function renderDetail(res) {
    const ev = res.ev;
    const rows = [
      ['有効口径 (焦点距離÷F値)', `${fmt(ev.aperture, 2)} mm`],
      ['1画素の角サイズ（式①）', `${fmt(ev.pixelAngle, 2)} 秒角`],
      ['1画素の滞在時間（式②）', `${(ev.dwellTime * 1000).toFixed(3)} ms`],
      ['カメラの方位', `${fmt(res.cfg.geo.az, 0)}° ${A.compassName(res.cfg.geo.az)}`],
      ['カメラの高度', `${fmt(res.cfg.geo.altTrue, 1)}°` +
        (res.cfg.geo.belowFloor ? `（計算には下限の ${CAM_ALT_MIN}° を使用）` : '')],
      ['放射点からの離角', `${fmt(res.cfg.geo.separation, 1)}°`],
      ['流星の角速度（式③）', `${fmt(res.cfg.omegaDeg, 2)} °/s`],
      ['大気の厚み（天頂比）', `${fmt(res.cfg.geo.airmass, 2)} 倍`],
      ['この向きの空の明るさ', `${fmt(res.cfg.geo.skyHere, 2)} 等/□"`],
      ['流星自身の減光', `${signed(-res.cfg.geo.extinction, 2)} 等`],
      ['トレイル幅', `${fmt(ev.trailArcsec, 1)} 秒角`],
      ['NPF則の露出上限', `${fmt(ev.npf, 2)} 秒`],
      ['露出の上限として使った値', state.tracked ? `${state.maxExposure} 秒（追尾）` : `${fmt(ev.npf, 2)} 秒（固定）`],
      ['計算に使う空の明るさ', `${fmt(res.cfg.sky, 2)} 等/□"`],
      ['背景電子数 / 画素', `${fmt(ev.bkgElectrons, 1)} e-`],
      ['背景ショットノイズ', `${fmt(ev.shotNoise, 2)} e-`],
      ['読み出しノイズ', `${fmt(ev.readNoise, 2)} e-`],
      ['ノイズ支配（>1で背景支配）', `${fmt(ev.noiseDominance, 1)} 倍`],
      ['飽和電子数（この ISO）', `${Math.round(ev.satElectrons).toLocaleString()} e-`],
      ['画角', `${fmt(ev.fov.widthDeg, 1)}° × ${fmt(ev.fov.heightDeg, 1)}°`],
      ['遭遇本数の相対指数', `${fmt(relativeIndex(res), 0)}（基準構成=100）`],
      ['記事の式のみでの到達等級', `${signed(ev.limMagArticle)} 等`],
      ['読み出しノイズで失う量', `${signed(-ev.readNoisePenalty)} 等`],
    ];
    if (eqAimActive()) {
      // 追尾中は方位・高度がこの狙いから決まる値なので、元の指定を先に出す
      rows.splice(3, 0, ['狙いの赤経・赤緯（追尾）',
        `${raLabel(state.camRa)} / ${signed(state.camDec, 0)}°`]);
    }
    $('detailTable').innerHTML = rows
      .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');

    const st = E.storageEstimate(
      { megapixels: state.megapixels }, res.rec.exposure, state.gap, state.hours);
    $('storageTable').innerHTML = [
      ['撮影時間', `${state.hours} 時間`],
      ['1コマの周期', `${fmt(res.rec.exposure + state.gap, 1)} 秒`],
      ['撮影枚数', `${st.shots.toLocaleString()} 枚`],
      ['必要容量（圧縮RAW目安）', `${fmt(st.gb, 0)} GB`],
    ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  }

  /** 基準構成を 100 とした遭遇本数の相対指数 */
  let refIndexCache = null;
  function relativeIndex(res) {
    if (refIndexCache === null) {
      const per = D.showers.find((s) => s.id === 'per');
      const refCam = D.cameras.find((c) => c.id === 'a7rv');
      refIndexCache = E.evaluate({
        camera: refCam, focal: 20, fnum: 1.4, trailFactor: 1.0, sky: 21.0,
        omegaDeg: 18, exposure: 8, gap: 1.0, iso: 640, r: per.r, meanMag: per.meanMag,
        radiantAlt: 50, sensorW: 35.9, sensorH: 23.9, fireballDuration: 2.0,
      }).encounterIndex;
    }
    return res.ev.encounterIndex / refIndexCache * 100;
  }

  /* ===================== 光害地図からの取得 ===================== */
  let lpState = { status: 'idle', lat: null, lon: null, data: null };

  function renderLpLookup() {
    const el = $('lpLookup');
    const d = lpState.data;
    if (lpState.status === 'loading') {
      el.innerHTML = '<p class="hint">光害地図を読み込み中…</p>';
      return;
    }
    if (lpState.status === 'idle' || !d) {
      el.innerHTML = '<p class="hint">この地点の夜空の明るさを光害地図（2025年）から読み取れます。</p>';
      return;
    }
    if (d.outside) {
      el.innerHTML = '<p class="hint">この地点は同梱している光害地図の範囲（日本周辺）の外です。スライダーで手動設定してください。</p>';
      return;
    }
    if (d.error) {
      el.innerHTML = '<p class="hint">光害地図を読み込めませんでした。スライダーで手動設定してください。</p>';
      return;
    }
    const col = MS_LP.PALETTE[d.index];
    const applied = Math.abs(state.skyBase - d.sqm) < 0.03;
    el.innerHTML = `
      <div class="lp-result">
        <span class="lp-swatch" style="background:rgb(${col[0]},${col[1]},${col[2]})"></span>
        <div class="lp-result__body">
          <div class="lp-result__main">
            <strong>${d.sqm.toFixed(2)}</strong> 等/平方秒
            <span class="lp-zone">光害ゾーン ${d.zone}</span>
          </div>
          <div class="lp-result__sub">
            この階調の範囲 ${d.range.bright.toFixed(2)}〜${d.range.dark.toFixed(2)}等
            ／人工光は自然光の ${d.lpi < 1 ? d.lpi.toFixed(2) : Math.round(d.lpi)} 倍
            ${d.missing ? '（外洋のため最暗として扱っています）' : ''}
          </div>
        </div>
        ${applied ? '<span class="lp-applied">反映中</span>'
          : '<button type="button" class="chip" id="btnLpApply">反映</button>'}
      </div>
      <p class="hint">
        天頂の人工光輝度のモデル計算値です（Bortleスケールではありません）。
        出典: David Lorenz 光害アトラス2025 / NOAA VIIRS。
      </p>`;
    const apply = $('btnLpApply');
    if (apply) {
      apply.addEventListener('click', () => {
        state.skyBase = Math.round(d.sqm * 20) / 20;   // スライダーの刻み(0.05)に合わせる
        state.skyAuto = true;
        syncInputs();
        refresh();
      });
    }
  }

  /** 光害地図を引く。applyResult が true なら空の暗さに反映する */
  function fetchLightPollution(applyResult) {
    const lat = state.lat;
    const lon = state.lon;
    lpState = { status: 'loading', lat: lat, lon: lon, data: null };
    renderLpLookup();
    MS_LP.lookup(lat, lon).then((d) => {
      // 取得中に地点が変わっていたら破棄する
      if (state.lat !== lat || state.lon !== lon) return;
      lpState = { status: 'done', lat: lat, lon: lon, data: d };
      if (applyResult && d && d.sqm !== undefined) {
        state.skyBase = Math.round(d.sqm * 20) / 20;
        state.skyAuto = true;
        syncInputs();
        refresh();
      } else {
        renderLpLookup();
      }
    });
  }

  /** 地点が変わったときの処理 */
  function onLocationChanged() {
    if (state.skyAuto) fetchLightPollution(true);
    else fetchLightPollution(false);
  }

  /* ===================== 再計算と再描画 ===================== */
  function refresh() {
    const res = compute();
    renderPlan(res);
    renderGear(res);
    renderCond(res);
    renderTimeline(res);
    lastRes = res;
    renderFov(res);
    renderResult(res);
    renderLpLookup();
    save();
  }

  /* ===================== 結果カードの画像書き出し =====================
   * 外部ライブラリを使わず canvas に手で描く。1200×630（SNSのカードと同じ比率）。
   * 色は画面のテーマから読み取って、見えているものと同じ配色で出す。
   */
  const CARD_W = 1200;
  const CARD_H = 630;

  function themeColor(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  /** 結果カードを描いた canvas を返す */
  function drawResultCard(res) {
    const cv = document.createElement('canvas');
    cv.width = CARD_W;
    cv.height = CARD_H;
    const g = cv.getContext('2d');

    const bg = themeColor('--tb-bg-primary', '#0d1117');
    const panel = themeColor('--tb-bg-secondary', '#1a1a2e');
    const line = themeColor('--tb-border', '#30363d');
    const text = themeColor('--tb-text-primary', '#e6edf3');
    const sub = themeColor('--tb-text-secondary', '#8b949e');
    const accent = themeColor('--tb-accent', '#7eb8da');
    const font = '"Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif';
    const mono = '"SF Mono", "Fira Code", monospace';

    g.fillStyle = bg;
    g.fillRect(0, 0, CARD_W, CARD_H);

    /* 見出し */
    g.fillStyle = sub;
    g.font = `28px ${font}`;
    g.textBaseline = 'alphabetic';
    g.fillText('流星撮影セッティング', 60, 78);
    g.fillStyle = text;
    g.font = `bold 44px ${font}`;
    const sh = res.snap.sh;
    g.fillText(`${purpose().label}／${sh.name}`, 60, 138);

    /* 推奨値の3枠 */
    const boxY = 178;
    const boxH = 190;
    const boxW = 340;
    const gap = 30;
    const values = [
      { label: 'シャッター', value: shutterLabel(res.cfg.exposure) },
      { label: '絞り', value: 'F' + fmt(res.cfg.fnum, 1) },
      { label: 'ISO', value: String(res.cfg.iso) },
    ];
    values.forEach((v, i) => {
      const x = 60 + i * (boxW + gap);
      g.fillStyle = panel;
      g.strokeStyle = line;
      g.lineWidth = 2;
      roundRect(g, x, boxY, boxW, boxH, 18);
      g.fill();
      g.stroke();
      g.fillStyle = accent;
      g.font = `bold 96px ${mono}`;
      g.textAlign = 'center';
      g.fillText(v.value, x + boxW / 2, boxY + 118);
      g.fillStyle = sub;
      g.font = `26px ${font}`;
      g.fillText(v.label, x + boxW / 2, boxY + 160);
      g.textAlign = 'left';
    });

    /* 主要な指標 */
    const items = [
      ['写せる暗さ', signed(res.ev.limMag, 2) + ' 等'],
      ['火球の白飛び限界', signed(res.ev.fireballMag, 2) + ' 等'],
      ['1コマに収まる確率', Math.round(res.ev.uncut * 100) + ' %'],
      ['空の明るさ', fmt(res.skyInfo.sky, 2) + ' 等/□″'],
    ];
    const iy = 430;
    const iw = (CARD_W - 120 - 3 * 24) / 4;
    items.forEach(([label, value], i) => {
      const x = 60 + i * (iw + 24);
      g.fillStyle = sub;
      g.font = `24px ${font}`;
      g.fillText(label, x, iy);
      g.fillStyle = text;
      g.font = `bold 40px ${mono}`;
      g.fillText(value, x, iy + 48);
    });

    /* 条件（機材・日時・場所） */
    const locName = state.myLocName
      || (state.locIndex >= 0 && D.locations[state.locIndex] ? D.locations[state.locIndex].name : '手入力の座標');
    const cam = D.cameras.find((c) => c.id === state.cameraId);
    const lens = state.lensIndex >= 0 && D.lenses[state.lensIndex] ? D.lenses[state.lensIndex].name : null;
    const d = currentDate();
    const when = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`;
    const gear = [
      (cam ? cam.name : '') + (lens ? ' + ' + lens : ` / ${fmt(state.focal, 0)}mm F${fmt(state.fnum, 1)}`),
      `${when}　${locName}`,
      `コマ間隔 ${fmt(state.gap, 1)}秒${state.tracked ? '／赤道儀で追尾' : ''}`,
    ];
    g.fillStyle = sub;
    g.font = `24px ${font}`;
    gear.forEach((t, i) => { g.fillText(t, 60, 522 + i * 32); });

    /* 出典。機材の行と重ならないよう最下段に置く */
    g.fillStyle = line;
    g.font = `20px ${font}`;
    g.textAlign = 'right';
    g.fillText('理論: friend_camera 氏の note 記事 ／ ysmrastro.github.io/toolbox', CARD_W - 60, 618);
    g.textAlign = 'left';

    return cv;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function cardFileName() {
    const d = currentDate();
    const p = (n) => String(n).padStart(2, '0');
    return `meteor-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
  }

  function canvasToBlob(cv) {
    return new Promise((resolve) => {
      if (cv.toBlob) cv.toBlob(resolve, 'image/png');
      else resolve(null);
    });
  }

  /** 画像を作ってプレビューに出し、blob を返す */
  async function buildCardImage() {
    const cv = drawResultCard(compute());
    const url = cv.toDataURL('image/png');
    $('cardPreview').hidden = false;
    $('cardPreview').innerHTML = `<img src="${url}" alt="推奨設定のカード">`;
    return { blob: await canvasToBlob(cv), url: url };
  }

  /* ===================== イベント ===================== */
  function bind() {
    /* ボトムナビ（ページを持つ項目はタブ、data-sheet の項目はシートを開く） */
    document.querySelectorAll('.tabbar__item').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.sheet) { openSheet(btn.dataset.sheet); return; }
        goToTab(btn.dataset.page, true);
      });
    });

    /* 機材 */
    /* 機材を手で変えたら、選んでいたセットとは中身が食い違うので選択を外す */
    const detachGearSet = () => {
      if (!state.gearSetName) return;
      state.gearSetName = null;
      renderGearSets();
    };

    $('cameraSelect').addEventListener('change', (e) => {
      applyCameraPreset(e.target.value);
      detachGearSet();
      syncInputs();
      refresh();
    });

    const numField = (id, key, onAfter) => {
      $(id).addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (!isFinite(v)) return;
        state[key] = v;
        if (onAfter) onAfter();
        refresh();
      });
    };

    numField('pixelPitch', 'pixelPitch');
    numField('megapixels', 'megapixels');
    $('fwcBase').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!isFinite(v)) return;
      state.fwcBase = v;
      state.fwcSource = 'manual';
      refresh();
    });
    $('sensorW').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!isFinite(v)) return;
      state.sensorW = v;
      // 旧バージョンの保存データにアスペクト比が無い場合は現在値から求める
      const aspect = state.sensorAspect || (state.sensorH / state.sensorW) || (23.9 / 35.9);
      state.sensorH = v * aspect;
      refresh();
    });

    $('lensSelect').addEventListener('change', (e) => {
      state.lensIndex = Number(e.target.value);
      const l = D.lenses[state.lensIndex];
      if (l) { state.focal = l.focal; state.fnum = l.fnum; }
      detachGearSet();
      syncInputs();
      refresh();
    });

    numField('focal', 'focal', detachGearSet);
    numField('fnum', 'fnum', () => {
      detachGearSet();
      document.querySelectorAll('[data-fnum]').forEach((el) => {
        el.classList.toggle('active', Math.abs(Number(el.dataset.fnum) - state.fnum) < 0.001);
      });
    });
    numField('gap', 'gap');
    numField('hours', 'hours');

    $('tracked').addEventListener('change', (e) => {
      state.tracked = e.target.checked;
      $('maxExposureField').hidden = !state.tracked;
      detachGearSet();
      ensureAimForMode();   // 狙いを方位・高度 ⇔ 赤経・赤緯 で持ち替える
      syncInputs();
      refresh();            // 画角プレビューの枠の傾きもここで変わる
    });

    numField('maxExposure', 'maxExposure');

    $('fnumChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-fnum]');
      if (!b) return;
      state.fnum = Number(b.dataset.fnum);
      syncInputs();
      refresh();
    });

    $('trailSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-trail]');
      if (!b) return;
      state.trailId = b.dataset.trail;
      syncInputs();
      refresh();
    });

    /* 条件 */
    $('purposeGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-purpose]');
      if (!b) return;
      state.purposeId = b.dataset.purpose;
      syncInputs();
      refresh();
    });

    $('showerSelect').addEventListener('change', (e) => {
      state.showerId = e.target.value;
      refresh();
    });

    /* タイムラインの帯をタップした位置の時刻に切り替える */
    $('timeline').addEventListener('click', (e) => {
      if (!e.target.closest('.tl__track')) return;
      const track = $('tlTrack');
      const r = track.getBoundingClientRect();
      if (r.width <= 0) return;
      const tl = timelineFor(currentDate(), state.lat, state.lon, shower());
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const ms = tl.from.getTime() + frac * (tl.to.getTime() - tl.from.getTime());
      const snapped = new Date(Math.round(ms / (5 * 60000)) * 5 * 60000);   // 5分刻みに丸める
      state.datetime = snapped.toISOString();
      syncInputs();
      refresh();
    });

    $('datetime').addEventListener('change', (e) => {
      const d = new Date(e.target.value);
      if (!isNaN(d.getTime())) state.datetime = d.toISOString();
      refresh();
    });

    $('btnPeak').addEventListener('click', () => {
      state.datetime = nextPeakDate(shower()).toISOString();
      syncInputs();
      refresh();
    });

    $('btnBest').addEventListener('click', () => {
      const best = A.bestObservingTime(currentDate(), state.lat, state.lon, shower());
      if (best && best.best) {
        state.datetime = best.best.time.toISOString();
        syncInputs();
        refresh();
      }
    });

    $('locationSelect').addEventListener('change', (e) => {
      const v = e.target.value;
      if (v.indexOf('m:') === 0) {
        const l = loadMyLocations().find((x) => x.name === v.slice(2));
        state.myLocName = l ? l.name : null;
        state.locIndex = -1;
        if (l) { state.lat = l.lat; state.lon = l.lon; }
      } else {
        state.myLocName = null;
        state.locIndex = Number(v);
        const l = D.locations[state.locIndex];
        if (l) { state.lat = l.lat; state.lon = l.lon; }
      }
      syncInputs();
      refresh();
      onLocationChanged();
    });

    const detachLocation = () => {
      state.locIndex = -1;
      state.myLocName = null;
      $('locationSelect').value = '-1';
      $('btnDeleteLoc').hidden = true;
    };
    numField('lat', 'lat', detachLocation);
    numField('lon', 'lon', detachLocation);
    // 緯度経度の手入力は連続して変わるので、入力が落ち着いてから引く
    let latlonTimer = null;
    ['lat', 'lon'].forEach((id) => {
      $(id).addEventListener('input', () => {
        clearTimeout(latlonTimer);
        latlonTimer = setTimeout(onLocationChanged, 600);
      });
    });

    /* マイ地点として保存 */
    $('btnSaveLoc').addEventListener('click', () => {
      const suggested = state.myLocName ||
        (state.locIndex >= 0 && D.locations[state.locIndex] ? D.locations[state.locIndex].name : '') ||
        `マイ地点${loadMyLocations().length + 1}`;
      const name = (window.prompt('この地点の名前', suggested) || '').trim();
      if (!name) return;
      const list = loadMyLocations().filter((l) => l.name !== name);
      list.push({ name: name, lat: state.lat, lon: state.lon });
      saveMyLocations(list);
      state.myLocName = name;
      state.locIndex = -1;
      initSelects();      // セレクトを作り直してから選択を戻す
      syncInputs();
      refresh();
    });

    /* マイ地点を削除 */
    $('btnDeleteLoc').addEventListener('click', () => {
      if (!state.myLocName) return;
      if (!window.confirm(`「${state.myLocName}」を削除します。よろしいですか？`)) return;
      saveMyLocations(loadMyLocations().filter((l) => l.name !== state.myLocName));
      state.myLocName = null;
      state.locIndex = -1;
      initSelects();
      syncInputs();
      refresh();
    });

    $('btnLp').addEventListener('click', () => fetchLightPollution(true));

    $('btnGeo').addEventListener('click', () => {
      if (!navigator.geolocation) { alert('この端末では現在地を取得できません。'); return; }
      $('btnGeo').textContent = '取得中…';
      navigator.geolocation.getCurrentPosition((pos) => {
        state.lat = Math.round(pos.coords.latitude * 100) / 100;
        state.lon = Math.round(pos.coords.longitude * 100) / 100;
        state.locIndex = -1;
        state.myLocName = null;
        $('btnGeo').textContent = '現在地を使う';
        syncInputs();
        refresh();
        onLocationChanged();
      }, () => {
        $('btnGeo').textContent = '現在地を使う';
        alert('現在地を取得できませんでした。緯度経度を手で入力してください。');
      }, { timeout: 10000 });
    });

    $('sky').addEventListener('input', (e) => {
      state.skyBase = parseFloat(e.target.value);
      state.skyAuto = false;   // 手動で動かしたら自動反映をやめる
      $('skyValue').textContent = state.skyBase.toFixed(2);
      document.querySelectorAll('[data-sky]').forEach((el) => {
        el.classList.toggle('active', Math.abs(Number(el.dataset.sky) - state.skyBase) < 0.001);
      });
      refresh();
    });

    $('skyChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sky]');
      if (!b) return;
      state.skyBase = Number(b.dataset.sky);
      state.skyAuto = false;
      syncInputs();
      refresh();
    });

    $('moonSelect').addEventListener('change', (e) => {
      state.moonId = e.target.value;
      refresh();
    });

    $('durSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dur]');
      if (!b) return;
      state.durTarget = Number(b.dataset.dur);
      syncInputs();
      refresh();
    });

    $('camAz').addEventListener('input', (e) => {
      state.camAz = Number(e.target.value);
      refresh();
    });

    $('camAlt').addEventListener('input', (e) => {
      state.camAlt = Number(e.target.value);
      $('camAltValue').textContent = state.camAlt;
      refresh();
    });

    $('camRa').addEventListener('input', (e) => {
      state.camRa = norm360(Number(e.target.value) * 15);
      $('camRaValue').textContent = raLabel(state.camRa);
      refresh();
    });

    $('camDec').addEventListener('input', (e) => {
      state.camDec = Number(e.target.value);
      $('camDecValue').textContent = signed(state.camDec, 0) + '°';
      refresh();
    });

    $('camPresets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cam]');
      if (!b) return;
      const snap = astroSnapshot();
      const radAz = snap.rad.isSporadic || snap.rad.azimuth == null ? 180 : snap.rad.azimuth;
      const radAlt = snap.rad.isSporadic ? 45 : snap.rad.altitude;
      const target = presetDirection(b.dataset.cam, snap, radAz, radAlt);
      if (eqAimActive()) {
        /* 追尾中は狙いを赤経・赤緯で持つ。放射点と天頂は座標が直接分かるので
           方位・高度を経由せずそのまま入れる（丸め誤差を持ち込まない） */
        if (b.dataset.cam === 'radiant' && !snap.rad.isSporadic) {
          setEqAim({ ra: snap.rad.ra, dec: snap.rad.dec });
        } else if (b.dataset.cam === 'zenith') {
          // 天頂の赤緯は観測地の緯度、赤経はその瞬間の地方恒星時
          setEqAim({ ra: A.gmst(snap.date) + state.lon, dec: state.lat });
        } else {
          setEqAim(eqFromHoriz(target.az, target.alt));
        }
      } else {
        setHorizAim({ azimuth: target.az, altitude: target.alt });
      }
      syncInputs();
      refresh();
    });

    $('articleMode').addEventListener('change', (e) => {
      state.articleMode = e.target.checked;
      refresh();
    });

    /* シート（前提と出典・設定） */
    $('btnAbout').addEventListener('click', () => { openSheet('aboutSheet'); });

    /* 更新履歴へ。シートの中身をスクロールさせる（ページ全体は動かさない） */
    $('btnChangelog').addEventListener('click', (e) => {
      e.preventDefault();
      const body = $('aboutBody');
      const target = $('changelog');
      body.scrollTo({ top: target.offsetTop - body.offsetTop - 8, behavior: 'smooth' });
    });
    $('btnSettings').addEventListener('click', () => { openSheet('settingsSheet'); });
    SHEETS.forEach((id) => {
      $(id).addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-close')) closeSheets();
      });
    });

    const reloadBtn = (e) => {
      e.currentTarget.textContent = '確認中…';
      reloadWithUpdate();
    };
    $('btnReload').addEventListener('click', reloadBtn);
    $('btnReload2').addEventListener('click', reloadBtn);

    /* 設定 — テーマ */
    $('themeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme]');
      if (!b) return;
      applyTheme(b.dataset.theme);
    });

    /* 設定 — 文字サイズ */
    $('textSizeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-size]');
      if (!b) return;
      applyTextSize(b.dataset.size);
    });

    /* OS のライト／ダーク切り替えに追従する（「端末に合わせる」のときだけ） */
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const onSchemeChange = () => { if (themePref() === 'auto') applyTheme('auto'); };
      if (mq.addEventListener) mq.addEventListener('change', onSchemeChange);
      else if (mq.addListener) mq.addListener(onSchemeChange);
    }

    /* --- 共有まわりの共通処理（結果カードと設定シートの両方から使う） --- */
    const putUrl = (url) => { $('shareHint').textContent = url; };

    const copyUrl = async (url) => {
      try {
        await navigator.clipboard.writeText(url);
        showToast('URLをコピーしました');
        return true;
      } catch (e) {
        // クリップボードが使えない環境向けの手動フォールバック
        putUrl(url);
        showToast('コピーできませんでした。設定の下に出したURLを長押しで選んでください');
        return false;
      }
    };

    /* 結果カードの画像 */
    $('btnCardSave').addEventListener('click', async () => {
      const img = await buildCardImage();
      const a = document.createElement('a');
      a.download = cardFileName();
      a.href = img.blob ? URL.createObjectURL(img.blob) : img.url;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (img.blob) setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      showToast('画像を保存しました');
    });

    /* 画像と「同じ設定で開けるURL」をまとめて共有する。
       X に投稿すると画像が本文に付き、URL から相手が同じ設定で開ける。
       共有先によっては url フィールドが落ちるので、URLは本文（text）に入れて渡す。 */
    $('btnCardShare').addEventListener('click', async () => {
      const img = await buildCardImage();
      const url = shareUrl();
      const sh = shower();
      const text = `${purpose().label}／${sh.name}\n` +
        `${shutterLabel(lastRes.cfg.exposure)} / F${fmt(lastRes.cfg.fnum, 1)} / ISO ${lastRes.cfg.iso}\n` +
        `${url}`;
      const file = img.blob ? new File([img.blob], cardFileName(), { type: 'image/png' }) : null;

      if (file && navigator.canShare && navigator.share) {
        // 画像＋本文（URL入り）で共有できるならそれが最良
        if (navigator.canShare({ files: [file], text: text })) {
          try { await navigator.share({ files: [file], text: text }); return; } catch (e) { return; }
        }
        // 本文を付けられない端末は画像だけ共有し、URLは別途コピーする
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: '流星撮影セッティング' });
            $('shareHint').textContent = url;
            copyUrl(url);
            return;
          } catch (e) { return; }
        }
      }
      if (navigator.share) {
        try { await navigator.share({ title: '流星撮影セッティング', text: text }); return; } catch (e) { return; }
      }
      showToast('この端末では共有できません。画像は「画像を保存」から、URLは設定からコピーできます');
    });

    /* 画角プレビューの構図（赤道儀かどうかは機材タブの設定から連動する） */
    $('fovOrient').addEventListener('click', (e) => {
      const b = e.target.closest('[data-orient]');
      if (!b) return;
      state.fovPortrait = b.dataset.orient === 'port';
      save();
      redrawFov();
      renderFovOrient();
    });

    /* 画面を消さない */
    $('wakeLock').addEventListener('change', (e) => {
      state.keepAwake = e.target.checked;
      save();
      if (state.keepAwake) acquireWakeLock(); else releaseWakeLock();
      renderWakeLock();
    });

    /* バックグラウンドから戻ると解除されるので取り直す */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.keepAwake) acquireWakeLock();
    });

    /* 機材セット */
    $('gearSetSelect').addEventListener('change', (e) => {
      const name = e.target.value;
      if (!name) { state.gearSetName = null; renderGearSets(); return; }
      const set = loadGearSets().find((g) => g.name === name);
      if (!set) { renderGearSets(); return; }
      GEAR_KEYS.forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(set.gear, k)) state[k] = set.gear[k];
      });
      state.gearSetName = name;
      renderGearSets();
      ensureAimForMode();   // セットに含まれる tracked で狙いの座標系が変わることがある
      syncInputs();
      refresh();
      showToast(`機材セット「${name}」に切り替えました`);
    });

    $('btnSaveGear').addEventListener('click', () => {
      const cam = D.cameras.find((c) => c.id === state.cameraId);
      const suggested = state.gearSetName ||
        `${cam ? cam.name : '機材'} ${fmt(state.focal, 0)}mm`;
      const name = (window.prompt('この機材セットの名前', suggested) || '').trim();
      if (!name) return;
      const gear = {};
      GEAR_KEYS.forEach((k) => { gear[k] = state[k]; });
      const list = loadGearSets().filter((g) => g.name !== name);
      list.push({ name: name, gear: gear });
      saveGearSets(list);
      state.gearSetName = name;
      renderGearSets();
      save();
      showToast(`「${name}」として保存しました`);
    });

    $('btnDeleteGear').addEventListener('click', () => {
      if (!state.gearSetName) return;
      if (!window.confirm(`機材セット「${state.gearSetName}」を削除します。よろしいですか？`)) return;
      saveGearSets(loadGearSets().filter((g) => g.name !== state.gearSetName));
      state.gearSetName = null;
      renderGearSets();
      save();
    });

    /* 年間カレンダー */
    /* 計画 — 次の流星群のリスト */
    $('planList').addEventListener('click', (e) => {
      const row = e.target.closest('.cal-row');
      if (!row) return;
      selectShowerNight(row.dataset.shower, row.dataset.date);
      syncInputs();
      refresh();
      showToast('この群と極大の夜に切り替えました');
    });

    /* 計画 — マンスリーカレンダー */
    $('btnMonthPrev').addEventListener('click', () => { shiftMonth(-1); });
    $('btnMonthNext').addEventListener('click', () => { shiftMonth(1); });
    $('btnMonthToday').addEventListener('click', () => {
      const now = new Date();
      monthAnchor = new Date(now.getFullYear(), now.getMonth(), 1);
      renderMonth();
    });

    $('month').addEventListener('click', (e) => {
      const cell = e.target.closest('.mcell[data-day]');
      if (!cell) return;
      const night = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(),
        Number(cell.dataset.day));
      // その夜のうち狙いやすい時刻に合わせる（夜を選んだのに昼の時刻が残ると混乱する）
      const noonNext = new Date(night.getTime() + 25 * 3600000);   // 翌日の未明を代表時刻に
      const tl = A.nightTimeline(noonNext, state.lat, state.lon, shower());
      state.datetime = bestTimeOfNight(tl, night).toISOString();
      syncInputs();
      refresh();
    });

    $('btnCalendar').addEventListener('click', () => {
      renderCalendar();
      openSheet('calendarSheet');
    });

    $('calYears').addEventListener('click', (e) => {
      const b = e.target.closest('[data-year]');
      if (!b) return;
      calYear = Number(b.dataset.year);
      renderCalendar();
    });

    $('calList').addEventListener('click', (e) => {
      const row = e.target.closest('.cal-row');
      if (!row) return;
      selectShowerNight(row.dataset.shower, row.dataset.date);
      closeSheets();
      syncInputs();
      refresh();
      showToast('この群と極大の夜に切り替えました');
    });

    /* 設定 — URL で共有 */
    $('btnShare').addEventListener('click', async () => {
      const url = shareUrl();
      putUrl(url);
      if (navigator.share) {
        try {
          await navigator.share({ title: '流星撮影セッティング', text: 'この設定で撮ろう', url: url });
          return;
        } catch (e) { /* 共有をやめた場合など。コピーに落とす */ }
      }
      copyUrl(url);
    });

    $('btnCopyUrl').addEventListener('click', () => {
      const url = shareUrl();
      putUrl(url);
      copyUrl(url);
    });

    /* 設定 — 入力内容のリセット（テーマは別キーなので残る） */
    $('btnResetState').addEventListener('click', () => {
      if (!window.confirm('入力した機材・条件を初期値に戻します。よろしいですか？')) return;
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 消せなくても再読み込みは行う */ }
      location.reload();
    });

    // PC ではキーボードで閉じられるようにする
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && anySheetOpen()) closeSheets();
    });
  }

  /* ===================== 起動 ===================== */

  /** 更新履歴を ⓘ シートに出す（新しい順） */
  function renderChangelog() {
    const list = D.changelog || [];
    $('changelogList').innerHTML = list.map((rel) => `
      <div class="changelog__rel">
        <div class="changelog__head">
          <span class="changelog__ver">v${escapeHtml(rel.version)}</span>
          <span class="changelog__date">${escapeHtml(rel.date)}</span>
        </div>
        <ul>${rel.items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
      </div>`).join('');
  }

  /** バージョンと更新日時をアプリバーに出す */
  function renderVersion() {
    const parts = D.appUpdated.split(' ');   // '2026-08-11 08:28'
    $('appVersion').innerHTML =
      `<div>v${D.appVersion}</div><div>${parts[0]}</div>` +
      (parts[1] ? `<div>${parts[1]}</div>` : '');
    const foot = $('aboutVersion');
    if (foot) foot.textContent = `v${D.appVersion}（${D.appUpdated} 更新）`;
    const s = $('settingsVersion');
    if (s) s.textContent = `v${D.appVersion} / ${D.appUpdated}`;
  }

  /* ===================== タッチ操作 =====================
   * 縦（上端から下）＝引っぱって更新、横＝タブ移動。
   * ブラウザ標準の pull-to-refresh は、PWA を standalone で起動すると
   * 存在しない（iOS）か抑制される。どの環境でも同じ動きにするため自前で実装する。
   * 更新時は Service Worker の update を先に走らせ、新しい版があれば
   * それを取り込んでから再読み込みする。
   */
  const PTR_TRIGGER = 70;    // これ以上引っぱったら更新する[px]
  const PTR_MAX = 110;       // 見た目の最大移動量[px]
  const AXIS_LOCK = 10;      // 縦のジェスチャーか横のジェスチャーかを決める閾値[px]
  const SWIPE_RATIO = 0.28;  // 画面幅のこの割合を超えて動かしたらページを移す
  const FLICK_SPEED = 0.45;  // 速く払ったときは移動量が小さくても移す[px/ms]

  /** Service Worker を更新してから再読み込みする */
  async function reloadWithUpdate() {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          // sw.js は install で skipWaiting するので、待機中の版はすぐ有効になる
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
    } catch (e) { /* 更新確認に失敗しても再読み込みは行う */ }
    location.reload();
  }

  function setupGestures() {
    const el = $('ptr');
    const label = $('ptrLabel');
    let startX = null;
    let startY = null;
    let axis = null;       // null（未確定） / 'x' / 'y'
    let atTop = false;     // 触り始めた時点で上端にいたか
    let dxNow = 0;
    let dyNow = 0;
    let lastX = 0;         // 直前の位置と時刻（払う速さを求めるため）
    let lastT = 0;
    let vx = 0;            // 横方向の速さ[px/ms]
    let pulling = false;
    let sliding = false;   // トラックを指で動かしている最中
    let loading = false;

    const show = (dy) => {
      const ready = dy >= PTR_TRIGGER;
      el.classList.add('is-active');
      el.classList.toggle('is-ready', ready);
      el.style.transform = `translateY(${Math.min(dy * 0.55, PTR_MAX)}px)`;
      el.querySelector('.ptr__spinner').style.transform = `rotate(${dy * 2.4}deg)`;
      label.textContent = ready ? '離して更新' : '引っぱって更新';
    };

    const hidePtr = () => {
      el.classList.add('is-releasing');
      el.classList.remove('is-active', 'is-ready');
      el.style.transform = 'translateY(-24px)';
      setTimeout(() => el.classList.remove('is-releasing'), 260);
      pulling = false;
    };

    const clear = () => {
      startX = null;
      startY = null;
      axis = null;
      dxNow = 0;
      dyNow = 0;
      vx = 0;
      sliding = false;
    };

    /** 離した位置と速さから、どのページに落ち着かせるかを決める */
    const snapTarget = () => {
      const i = pageIndex();
      const threshold = window.innerWidth * SWIPE_RATIO;
      const flick = Math.abs(vx) > FLICK_SPEED && Math.abs(dxNow) > 12;
      let next = i;
      if (dxNow < 0 && (-dxNow > threshold || (flick && vx < 0))) next = i + 1;
      else if (dxNow > 0 && (dxNow > threshold || (flick && vx > 0))) next = i - 1;
      return PAGES[Math.min(PAGES.length - 1, Math.max(0, next))];
    };

    document.addEventListener('touchstart', (e) => {
      if (loading || e.touches.length !== 1) return;
      // シート表示中と、指の動きがそのまま値になる部品（スライダー）の上では何もしない。
      // select は縦に払っても値が変わらないので除外しない
      // （機材タブの上端はカメラの select なので、除外すると引っぱって更新ができなくなる）
      if (anySheetOpen()) return;
      if (e.target.closest('input[type="range"], textarea, .sheet')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      lastX = startX;
      lastT = e.timeStamp;
      axis = null;
      atTop = window.scrollY <= 0;
      pulling = false;
      sliding = false;
      dxNow = 0;
      dyNow = 0;
      vx = 0;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (startY === null || loading) return;
      const x = e.touches[0].clientX;
      const dx = x - startX;
      const dy = e.touches[0].clientY - startY;

      // 最初のわずかな動きで縦か横かを決め、以後は取り違えない
      if (axis === null) {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axis === 'x') {
          if (pulling) hidePtr();
          if (isTabMode()) { sliding = true; beginTrack(); }
        }
      }

      if (axis === 'x') {
        dxNow = dx;
        const dt = e.timeStamp - lastT;
        if (dt > 0) {
          // 直前の速さを少し残して均す（1フレームのぶれで判定が変わらないように）
          vx = 0.6 * ((x - lastX) / dt) + 0.4 * vx;
          lastX = x;
          lastT = e.timeStamp;
        }
        if (sliding) {
          dragTrack(dx);
          // 指に追従させている間は縦にスクロールさせない
          if (e.cancelable) e.preventDefault();
        }
        return;
      }

      if (!atTop || dy <= 0 || window.scrollY > 0) {
        if (pulling) hidePtr();
        return;
      }
      pulling = true;
      dyNow = dy;
      show(dy);
      // 自前で動かすのでブラウザのゴム引きは止める
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', () => {
      if (startY === null || loading) { clear(); return; }

      if (sliding) snapTrack(snapTarget());

      if (pulling && dyNow >= PTR_TRIGGER) {
        loading = true;
        el.classList.add('is-loading', 'is-active');
        el.classList.remove('is-ready');
        el.style.transform = 'translateY(56px)';
        label.textContent = '更新中…';
        reloadWithUpdate();
      } else if (pulling) {
        hidePtr();
      }
      clear();
    }, { passive: true });

    document.addEventListener('touchcancel', () => {
      if (pulling) hidePtr();
      if (sliding) snapTrack(state.activePage);
      clear();
    }, { passive: true });

    /* 画面幅が変わってタブ表示と全ページ表示を行き来したとき、
       付けたままの transform が残らないように整える */
    window.addEventListener('resize', () => {
      const track = $('track');
      PAGES.forEach((id) => { $(id).style.transform = ''; });
      track.style.transition = 'none';
      track.classList.remove('is-animating');
      track.style.transform = isTabMode() ? 'translateX(0)' : '';
      // canvas は CSS では伸縮しないので描き直す
      clearTimeout(fovResizeTimer);
      fovResizeTimer = setTimeout(redrawFov, 150);
    });
  }

  /** 既定のレンズを名前から解決して state に入れる */
  function applyDefaultLens() {
    const i = D.lenses.findIndex((l) => l.name === D.defaultLensName);
    const idx = i >= 0 ? i : 0;
    state.lensIndex = idx;
    state.focal = D.lenses[idx].focal;
    state.fnum = D.lenses[idx].fnum;
  }

  /** 既定の観測地を名前から解決して state に入れる */
  function applyDefaultLocation() {
    const i = D.locations.findIndex((l) => l.name === D.defaultLocationName);
    const idx = i >= 0 ? i : 0;
    state.locIndex = idx;
    state.lat = D.locations[idx].lat;
    state.lon = D.locations[idx].lon;
  }

  /** 起動の本体。ここで落ちても真っ白にしないよう init() が包む */
  function boot() {
    initSelects();
    renderVersion();
    renderChangelog();
    applyTheme(themePref());       // インライン script が立てた値を正として全体に反映する
    applyTextSize(textSizePref()); // 同じく文字サイズ
    setupGestures();
    const hadSaved = load();
    /* 共有URLで開かれた場合は、保存された内容よりURLを優先する。
       取り込んだらハッシュを外し、次に開いたときは自分の設定に戻るようにする */
    const sharedPayload = readSharedPayload();
    let shared = false;
    if (sharedPayload) {
      /* カメラIDのプリセットを先に当ててから、URL に明示された値で上書きする。
         共有URLはプリセットどおりのセンサー値を省いてあるため、この順でないと
         手で変えたセンサー値がプリセットに戻されてしまう。 */
      if (typeof sharedPayload.cameraId === 'string') applyCameraPreset(sharedPayload.cameraId);
      shared = applySharedPayload(sharedPayload);
      try {
        // 次に開いたときは自分の設定に戻るよう、共有用のクエリとハッシュを外す
        history.replaceState(null, '', location.pathname);
      } catch (e) { /* 履歴を触れなくても動作に影響はない */ }
    }
    if (state.locIndex == null || state.lat == null || state.lon == null) {
      applyDefaultLocation();
    } else {
      // プリセットの並びが変わっても保存された座標を正とする。
      // 添字が指す地点と座標が食い違う場合は「手入力」扱いにして誤った地名を出さない
      const l = D.locations[state.locIndex];
      const same = l && Math.abs(l.lat - state.lat) < 0.001 && Math.abs(l.lon - state.lon) < 0.001;
      if (!same) state.locIndex = -1;
    }
    if (state.lensIndex == null) {
      applyDefaultLens();
    } else if (state.lensIndex >= 0) {
      // プリセットの並びが変わっても保存された焦点距離とF値を正とする。
      // 添字が指すレンズと食い違う場合は選択を外して誤った製品名を出さない
      const l = D.lenses[state.lensIndex];
      const same = l && Math.abs(l.focal - state.focal) < 0.01 && Math.abs(l.fnum - state.fnum) < 0.01;
      if (!same) state.lensIndex = -1;
    }
    // 古い保存値にセンサー特性が無い場合はカメラIDからプリセットを当てる
    if (state.rnGain === undefined || state.fwcSource === undefined) {
      applyCameraPreset(state.cameraId);
    }
    /* 初めて開いたときは「次に来る流星群」とその夜を選んでおく。
       極大が遠い時期に真っ先に知りたいのはこれなので、既定をペルセウス座に固定しない。
       2回目以降は保存された選択を尊重する（勝手に切り替えない） */
    if (!hadSaved && !shared) {
      const next = upcomingPeaks(1)[0];
      if (next) {
        state.showerId = next.shower.id;
        state.datetime = bestTimeOfNight(next.timeline, nightAnchor(next.date)).toISOString();
      }
    }
    if (!state.datetime) state.datetime = nextPeakDate(shower()).toISOString();
    // 地点と日時が確定してから、追尾のオン・オフに合った座標系で狙いを持ち直す
    ensureAimForMode();
    renderGearSets();
    renderWakeLock();
    if (state.keepAwake) acquireWakeLock();
    syncInputs();
    bind();
    goToTab(state.activePage, false);   // 再読み込み後も開いていたタブに戻る
    refresh();
    // 初回は表示だけ更新し、空の暗さの自動反映は skyAuto に従う
    fetchLightPollution(state.skyAuto === true);

    if (shared) showToast('共有された設定を読み込みました');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応は任意 */ });
    }
  }

  function init() {
    /* HTML と JS の版が食い違っていたら、そのまま起動しても要素が見つからず落ちる。
       先にキャッシュを作り直す（無限に繰り返さないよう1回だけ） */
    if (stampedVersion() !== D.appVersion) {
      if (!recoveryTried()) { rebuildAndReload('version-mismatch'); return; }
      showBanner('ファイルの版が揃っていません。', '作り直す', () => rebuildAndReload('manual'));
    } else {
      // 正常に起動できた版なので、次に食い違ったときも自動で直せるよう印を消す
      try { sessionStorage.removeItem(RECOVERY_KEY); } catch (e) { /* 無視 */ }
    }

    try {
      boot();
    } catch (err) {
      /* どこかで落ちても真っ白にはしない。最低限1ページを見せて、直す手段を出す */
      try {
        const first = $(PAGES[0]);
        if (first && !document.querySelector('.page.active')) first.classList.add('active');
      } catch (e) { /* 無視 */ }
      showBanner('起動時にエラーが出ました（' + (err && err.message) + '）。',
        '作り直す', () => rebuildAndReload('boot-error'));
      throw err;   // 原因を残すためコンソールにも出す
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
