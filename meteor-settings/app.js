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
    lensIndex: 0,
    trailId: 'sharp',
    gap: 1.0,
    hours: 5,
    purposeId: 'fireball',
    showerId: 'per',
    datetime: null,
    locIndex: 0,
    lat: 35.69,
    lon: 139.69,
    skyBase: 21.0,
    skyAuto: true,        // 地点変更時に光害地図から自動で空の暗さを取り込むか
    moonId: 'auto',
    durTarget: 2.0,
    elong: 60,
    articleMode: false,
  };

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

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      Object.assign(state, JSON.parse(raw));
    } catch (e) { /* 無視 */ }
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

  function buildCfg(snap, sky) {
    const sh = snap.sh;
    // 放射点が地平線下でも計算は成立させ、警告で伝える（高度は 5° を下限にクランプ）
    const altForOmega = Math.max(snap.rad.altitude, 5);
    const omega = E.angularVelocity(sh.velocity, state.elong, altForOmega);

    return {
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
      sky: sky,
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

    $('lensSelect').innerHTML =
      '<option value="-1">レンズを選ぶ（任意）</option>' +
      D.lenses.map((l, i) => `<option value="${i}">${l.name}</option>`).join('');

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
    $('locationSelect').innerHTML =
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
    $('showerSelect').value = state.showerId;
    $('locationSelect').value = String(state.locIndex);
    $('lat').value = state.lat;
    $('lon').value = state.lon;
    $('sky').value = state.skyBase;
    $('moonSelect').value = state.moonId;
    $('elong').value = state.elong;
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
    $('elongValue').textContent = state.elong;
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
  }

  /* ===================== 描画：条件タブ ===================== */
  function renderCond(res) {
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

    const rad = res.snap.rad;
    const sun = res.snap.sun;
    const moon = res.snap.moon;
    const best = A.bestObservingTime(currentDate(), state.lat, state.lon, sh);
    const timeFmt = (d) => d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';

    let report = '';
    report += rad.isSporadic
      ? '放射点を持たない群のため、高度45°相当で計算しています。<br>'
      : `放射点高度 <b>${fmt(rad.altitude, 1)}°</b>（方位 ${fmt(rad.azimuth, 0)}°）／極大からのずれ <b>${signed(rad.daysFromPeak, 1)}日</b><br>`;
    report += `太陽高度 <b>${fmt(sun.altitude, 1)}°</b>`;
    report += sun.altitude > -18 ? '（<span style="color:var(--ms-warn)">薄明中</span>）<br>' : '（天文薄明終了後）<br>';
    report += `月 高度 <b>${fmt(moon.altitude, 1)}°</b>／輝面比 <b>${Math.round(moon.illumination * 100)}%</b>／月齢 <b>${fmt(moon.age, 1)}日</b><br>`;
    if (best && best.window.begin && best.window.end) {
      report += `暗夜 <b>${timeFmt(best.window.begin)} 〜 ${timeFmt(best.window.end)}</b>`;
      if (best.best) report += `／放射点が最も高いのは <b>${timeFmt(best.best.time)}</b>（${fmt(best.best.altitude, 0)}°）`;
    }
    $('astroReport').innerHTML = report;

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
    heroNotes.push(`NPF則の上限は ${fmt(ev.npf, 2)}秒。日周運動で星が伸びない範囲でこれを選んでいます。`);
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
        <div style="position:absolute;inset:0;width:${pos(limMag)}%;background:linear-gradient(90deg,rgba(126,184,218,.25),rgba(126,184,218,.65))"></div>
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
    if (res.rec.exposure > ev.npf + 0.01) {
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
    test('放射点の近く（離角を半分）を狙う', {
      omegaDeg: E.angularVelocity(res.snap.sh.velocity, state.elong / 2, Math.max(res.snap.rad.altitude, 5)),
    }, '放射点付近は流星が短く写り、見た目の迫力は落ちます');
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
      ['流星の角速度（式③）', `${fmt(res.cfg.omegaDeg, 2)} °/s`],
      ['トレイル幅', `${fmt(ev.trailArcsec, 1)} 秒角`],
      ['NPF則の露出上限', `${fmt(ev.npf, 2)} 秒`],
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
    renderGear(res);
    renderCond(res);
    renderResult(res);
    renderLpLookup();
    save();
  }

  /* ===================== イベント ===================== */
  function bind() {
    /* タブ切り替え */
    document.querySelectorAll('.tabbar__item').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tabbar__item').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        $(btn.dataset.page).classList.add('active');
        window.scrollTo({ top: 0 });
      });
    });

    /* 機材 */
    $('cameraSelect').addEventListener('change', (e) => {
      applyCameraPreset(e.target.value);
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
      syncInputs();
      refresh();
    });

    numField('focal', 'focal');
    numField('fnum', 'fnum', () => {
      document.querySelectorAll('[data-fnum]').forEach((el) => {
        el.classList.toggle('active', Math.abs(Number(el.dataset.fnum) - state.fnum) < 0.001);
      });
    });
    numField('gap', 'gap');
    numField('hours', 'hours');

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
      state.locIndex = Number(e.target.value);
      const l = D.locations[state.locIndex];
      if (l) { state.lat = l.lat; state.lon = l.lon; }
      syncInputs();
      refresh();
      onLocationChanged();
    });

    numField('lat', 'lat', () => { state.locIndex = -1; $('locationSelect').value = '-1'; });
    numField('lon', 'lon', () => { state.locIndex = -1; $('locationSelect').value = '-1'; });
    // 緯度経度の手入力は連続して変わるので、入力が落ち着いてから引く
    let latlonTimer = null;
    ['lat', 'lon'].forEach((id) => {
      $(id).addEventListener('input', () => {
        clearTimeout(latlonTimer);
        latlonTimer = setTimeout(onLocationChanged, 600);
      });
    });

    $('btnLp').addEventListener('click', () => fetchLightPollution(true));

    $('btnGeo').addEventListener('click', () => {
      if (!navigator.geolocation) { alert('この端末では現在地を取得できません。'); return; }
      $('btnGeo').textContent = '取得中…';
      navigator.geolocation.getCurrentPosition((pos) => {
        state.lat = Math.round(pos.coords.latitude * 100) / 100;
        state.lon = Math.round(pos.coords.longitude * 100) / 100;
        state.locIndex = -1;
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

    $('elong').addEventListener('input', (e) => {
      state.elong = Number(e.target.value);
      $('elongValue').textContent = state.elong;
      refresh();
    });

    $('articleMode').addEventListener('change', (e) => {
      state.articleMode = e.target.checked;
      refresh();
    });

    /* 前提シート */
    $('btnAbout').addEventListener('click', () => { $('aboutSheet').hidden = false; });
    $('aboutSheet').addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-close')) $('aboutSheet').hidden = true;
    });
  }

  /* ===================== 起動 ===================== */
  function init() {
    initSelects();
    load();
    // 保存値にカメラのセンサー特性が無い場合はプリセットから補う
    if (state.rnGain === undefined || state.fwcSource === undefined) {
      applyCameraPreset(state.cameraId);
    }
    if (!state.datetime) state.datetime = nextPeakDate(shower()).toISOString();
    syncInputs();
    bind();
    document.querySelector('.page').classList.add('active');
    refresh();
    // 初回は表示だけ更新し、空の暗さの自動反映は skyAuto に従う
    fetchLightPollution(state.skyAuto === true);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応は任意 */ });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
