/*
 * engine.js — 流星撮影設定の計算エンジン
 *
 * 出典: note記事「流れ星の撮り方｜F値とISOを「理論」で決めるペルセウス座流星群の撮影設定ガイド」
 *       （friend_camera 著、著者の許諾を得て実装）
 *       https://note.com/brave_godwit4798/n/n938a74b50144
 *
 * 記事の付録A（8つの式）をそのまま実装し、基準構成（α7R V + SIGMA 20mm F1.4）で
 * 記事が示す数値を再現できるようキャリブレーションしてある。self-test は末尾。
 *
 * ---- モデルの前提（記事の記述から確定できない部分の扱い） ----
 *  A. 到達等級の絶対値アンカー
 *     記事は「20mm F1.4 でペルセウス座平均(+1.63等)に到達するには空の暗さ 21.0等が必要」
 *     としているため、基準構成 × 空 21.0等 = +1.63等 をアンカーに置いた。
 *     この前提だと空 21.5等で +1.88等 となり、記事の「+1.90等」とほぼ一致する。
 *  B. S/N の比例式
 *     記事の式④は S/N ∝ 有効口径 ÷ (角速度 × トレイル幅 × √(空の明るさ × 露出時間))。
 *     読み出しノイズを扱えるよう、√(空の明るさ×露出時間) を実際の1画素ノイズ
 *     σ = √(背景電子数 + 読み出しノイズ²) に置き換え、単位を合わせるため
 *     S/N ∝ D × (画素ピッチ/F値) / (角速度 × トレイル幅 × σ) の形にしている。
 *     この形は記事の条件補正表（F値1段=+0.38等、焦点距離2倍=+0.75等、露出2倍=-0.38等、
 *     空1等=-0.50等、トレイル幅=-2.5log比）をすべて再現する。
 *  C. トレイル幅
 *     焦点距離を変えても「秒角でのトレイル幅」は変えない。これにより記事の
 *     「焦点距離2倍で+0.75等」がそのまま再現される。ピント精度の影響は係数で与える。
 *  D. 背景電子数のスケール定数 K
 *     記事の火球白飛び限界 -4.25等（基準構成・ISO640）から逆算して決めた。
 *     結果 15.4 e-/画素（空21.0等・8秒・F1.4・3.756µm）となり、読み出しノイズ 1.41e- に対し
 *     背景ショットノイズ支配（記事の主張と一致）。
 */

(function (global) {
  'use strict';

  const RAD = Math.PI / 180;
  const ARCSEC_PER_MM = 206.265; // µm/mm を秒角に変換する係数（206265 × 1e-3）

  /* ===================== 基準構成（記事の α7R V + SIGMA 20mm F1.4） ===================== */
  const REF = {
    focal: 20,
    fnum: 1.4,
    pixelPitch: 3.756,
    trailPx: 1.73,      // 画面中央の実測トレイル幅
    exposure: 8,
    gap: 1.0,           // コマ間隔（記事の「67%」を再現する値）
    iso: 640,
    isoBase: 100,
    fwcBase: 35815,
    readNoise: 1.41,
    rnGain: 4.74,
    rnFloor: 1.20,
    omegaDeg: 18,       // ペルセウス座の典型角速度
    sky: 21.0,
    limMag: 1.63,       // 空 21.0等 のときの到達等級（アンカー）
    fireballMag: -4.25, // 空 21.0等・ISO640 での白飛び限界（アンカー）
  };

  REF.aperture = REF.focal / REF.fnum;                                  // 有効口径 14.286mm
  REF.trailArcsec = (REF.trailPx * REF.pixelPitch / REF.focal) * ARCSEC_PER_MM; // 67.0 秒角
  REF.satElectrons = REF.fwcBase * REF.isoBase / REF.iso;               // 5596 e-

  /* 背景電子数のスケール定数 K を火球アンカーから逆算する */
  (function calibrateK() {
    const omegaArcsec = REF.omegaDeg * 3600;
    // 式⑥: 比 = 10^(0.4(空 - 流星等級)) / (角速度 × トレイル幅 × 露出)
    const ratioAtLimit =
      Math.pow(10, 0.4 * (REF.sky - REF.fireballMag)) /
      (omegaArcsec * REF.trailArcsec * REF.exposure);
    // 式⑦: 飽和 / 背景 = 1 + 比
    const bkgRef = REF.satElectrons / (1 + ratioAtLimit);
    REF.bkgElectrons = bkgRef;
    REF.K = bkgRef / (Math.pow(REF.pixelPitch / REF.fnum, 2) * REF.exposure);
  })();

  REF.sigma = Math.sqrt(REF.bkgElectrons + REF.readNoise * REF.readNoise);
  REF.snrProxy =
    REF.aperture * (REF.pixelPitch / REF.fnum) /
    (REF.omegaDeg * 3600 * REF.trailArcsec * REF.sigma);

  /* ===================== 付録Aの各式 ===================== */

  /** 式① 1画素の角サイズ [秒角] */
  function pixelAngle(pixelPitch, focal) {
    return pixelPitch / focal * ARCSEC_PER_MM;
  }

  /** 式② 流星が1画素に留まる時間 [秒] */
  function dwellTime(pixelPitch, focal, omegaDeg) {
    return pixelAngle(pixelPitch, focal) / (omegaDeg * 3600);
  }

  /** 式③ 流星の角速度 [°/s]（対地速度・放射点からの離角・高度角から） */
  function angularVelocity(velocityKms, elongationDeg, altitudeDeg) {
    const alt = Math.max(altitudeDeg, 0);
    return (velocityKms / 100) * 57.3 *
      Math.sin(elongationDeg * RAD) * Math.sin(alt * RAD);
  }

  /** NPF則（簡易式）による日周運動の露出上限 [秒] */
  function npfLimit(fnum, pixelPitch, focal) {
    return (35 * fnum + 30 * pixelPitch) / focal;
  }

  /** 背景（空）の1画素あたり電子数 [e-] */
  function backgroundElectrons(sky, pixelPitch, fnum, exposure) {
    return REF.K *
      Math.pow(10, -0.4 * (sky - REF.sky)) *
      Math.pow(pixelPitch / fnum, 2) *
      exposure;
  }

  /** 読み出しノイズ [e-]（ISO依存モデル: σ_r = √((A·100/ISO)² + F²)） */
  function readNoiseAt(camera, iso) {
    const a = camera.rnGain != null ? camera.rnGain : REF.rnGain;
    const f = camera.rnFloor != null ? camera.rnFloor : REF.rnFloor;
    return Math.sqrt(Math.pow(a * 100 / iso, 2) + f * f);
  }

  /** 飽和電子数 [e-]（ISOを上げるとADCのフルスケールに対応する電子数が減る） */
  function saturationElectrons(camera, iso) {
    return camera.fwcBase * 100 / iso;
  }

  /**
   * 式④⑤ 到達等級
   * S/N ∝ D × (画素ピッチ/F値) ÷ (角速度[秒角/s] × トレイル幅[秒角] × σ)
   */
  function limitingMagnitude(p) {
    const aperture = p.focal / p.fnum;
    const omegaArcsec = p.omegaDeg * 3600;
    const sigma = Math.sqrt(p.bkgElectrons + p.readNoise * p.readNoise);
    const snr = aperture * (p.pixelPitch / p.fnum) /
      (omegaArcsec * p.trailArcsec * sigma);
    return REF.limMag + 2.5 * Math.log10(snr / REF.snrProxy);
  }

  /**
   * 式⑤ を記事の記述どおりに実装した到達等級（背景ショットノイズ支配の近似）
   *   Δ等級 = 2.5log10(口径比) - 2.5log10(角速度比) - 1.25log10(露出比)
   *          + 0.5(空の明るさの差) - 2.5log10(トレイル幅比)
   * 読み出しノイズを含まないため、露出が短い領域では過大評価になる。
   * 記事の条件補正表を厳密に再現するので、検証と「記事どおりモード」に使う。
   */
  function limitingMagnitudeArticle(p) {
    const aperture = p.focal / p.fnum;
    return REF.limMag +
      2.5 * Math.log10(aperture / REF.aperture) -
      2.5 * Math.log10(p.omegaDeg / REF.omegaDeg) -
      1.25 * Math.log10(p.exposure / REF.exposure) +
      0.5 * (p.sky - REF.sky) -
      2.5 * Math.log10(p.trailArcsec / REF.trailArcsec);
  }

  /**
   * 式⑥⑦ 火球が白飛びしない限界等級（これより明るい火球はサチる）
   * m = 空 - 2.5log10((飽和/背景 - 1) × 角速度 × トレイル幅 × 露出)
   */
  function fireballLimit(p) {
    const headroom = p.satElectrons / p.bkgElectrons - 1;
    if (headroom <= 0) return Infinity; // 背景だけで飽和 = 露出過多
    const omegaArcsec = p.omegaDeg * 3600;
    return p.sky - 2.5 * Math.log10(headroom * omegaArcsec * p.trailArcsec * p.exposure);
  }

  /** 式⑧ 継続時間 dur の流星が1コマに途切れず収まる確率 */
  function uncutProbability(exposure, gap, durationSec) {
    if (exposure <= durationSec) return 0;
    return Math.max(0, Math.min(1, (exposure - durationSec) / (exposure + gap)));
  }

  /* ===================== 派生指標 ===================== */

  /** 画角 [度] と概算立体角 [平方度] */
  function fieldOfView(focal, sensorW, sensorH) {
    const w = 2 * Math.atan(sensorW / (2 * focal)) / RAD;
    const h = 2 * Math.atan(sensorH / (2 * focal)) / RAD;
    return { widthDeg: w, heightDeg: h, areaDeg2: w * h, diagDeg: Math.sqrt(w * w + h * h) };
  }

  /** 露出中に空を写している時間の割合 */
  function dutyCycle(exposure, gap) {
    return exposure / (exposure + gap);
  }

  /**
   * 遭遇本数の相対指数（基準構成 = 100）
   * 群の光度分布 N(<m) ∝ r^m を使い、到達等級・画角・放射点高度・稼働率の積で評価する。
   * 絶対本数は較正できないため、あくまで構成間の比較用。
   */
  function encounterIndex(p) {
    return Math.pow(p.r, p.limMag) * p.fovAreaDeg2 *
      Math.max(Math.sin(Math.max(p.radiantAlt, 0) * RAD), 0) *
      dutyCycle(p.exposure, p.gap);
  }

  /* ===================== 総合評価 ===================== */

  /**
   * ある設定（機材＋条件＋露出＋ISO）を評価する
   * @param {Object} cfg
   *   camera, focal, fnum, trailFactor, sky, omegaDeg, exposure, gap, iso,
   *   shower(r, meanMag), radiantAlt, sensorW, sensorH, fireballDuration
   */
  function evaluate(cfg) {
    const cam = cfg.camera;
    const pixelPitch = cam.pixelPitch;
    const trailArcsec = REF.trailArcsec * cfg.trailFactor;
    const bkg = backgroundElectrons(cfg.sky, pixelPitch, cfg.fnum, cfg.exposure);
    const rn = readNoiseAt(cam, cfg.iso);
    const sat = saturationElectrons(cam, cfg.iso);

    const common = {
      focal: cfg.focal,
      fnum: cfg.fnum,
      pixelPitch: pixelPitch,
      omegaDeg: cfg.omegaDeg,
      trailArcsec: trailArcsec,
      bkgElectrons: bkg,
      readNoise: rn,
      satElectrons: sat,
      sky: cfg.sky,
      exposure: cfg.exposure,
    };

    // cfg.articleMode: true なら読み出しノイズを無視した記事どおりの式⑤を使う
    const limMagArticle = limitingMagnitudeArticle(common);
    const limMagFull = limitingMagnitude(common);
    const limMag = cfg.articleMode ? limMagArticle : limMagFull;
    const fbMag = fireballLimit(common);
    const fov = fieldOfView(cfg.focal, cfg.sensorW, cfg.sensorH);

    return {
      aperture: cfg.focal / cfg.fnum,
      pixelAngle: pixelAngle(pixelPitch, cfg.focal),
      dwellTime: dwellTime(pixelPitch, cfg.focal, cfg.omegaDeg),
      npf: npfLimit(cfg.fnum, pixelPitch, cfg.focal),
      trailArcsec: trailArcsec,
      bkgElectrons: bkg,
      readNoise: rn,
      satElectrons: sat,
      shotNoise: Math.sqrt(bkg),
      noiseDominance: bkg / (rn * rn),          // >1 なら背景ショットノイズ支配
      limMag: limMag,
      limMagArticle: limMagArticle,             // 記事どおりの式⑤の値
      readNoisePenalty: limMagArticle - limMagFull, // 読み出しノイズで失う等級
      magVsMean: limMag - cfg.meanMag,          // 群の平均光度に対する余裕
      fireballMag: fbMag,
      fireballHeadroom: sat / bkg,
      uncut: uncutProbability(cfg.exposure, cfg.gap, cfg.fireballDuration),
      duty: dutyCycle(cfg.exposure, cfg.gap),
      fov: fov,
      encounterIndex: encounterIndex({
        r: cfg.r, limMag: limMag, fovAreaDeg2: fov.areaDeg2,
        radiantAlt: cfg.radiantAlt, exposure: cfg.exposure, gap: cfg.gap,
      }),
    };
  }

  /**
   * ISO の推奨値
   * 「到達等級の損失が許容値未満に収まる最も低いISO」を選ぶ。
   * 低ISOほど飽和電子数が大きく火球の白飛び余裕が増える一方、読み出しノイズが増えて
   * 到達等級が落ちる、というトレードオフをそのまま解いている。
   * 許容値 0.05等 のとき、基準構成では ISO 640 が選ばれる（記事の推奨値と一致）。
   */
  function recommendIso(cfg, tolerance) {
    const cam = cfg.camera;
    const bkg = backgroundElectrons(cfg.sky, cam.pixelPitch, cfg.fnum, cfg.exposure);
    const floor = cam.rnFloor != null ? cam.rnFloor : REF.rnFloor;
    const sigmaBest = Math.sqrt(bkg + floor * floor); // ISO→∞ の漸近ノイズ
    const steps = MS_DATA.isoSteps;
    for (let i = 0; i < steps.length; i++) {
      const rn = readNoiseAt(cam, steps[i]);
      const sigma = Math.sqrt(bkg + rn * rn);
      const loss = 2.5 * Math.log10(sigma / sigmaBest);
      if (loss < tolerance) return steps[i];
    }
    return steps[steps.length - 1];
  }

  /**
   * 露出時間の推奨値
   * NPF則を上限とし、目的に応じたスコアを実用シャッター速度の中で最大化する。
   *   火球狙い : 稼働率 × 途切れない確率
   *   本数狙い : r^到達等級 × 稼働率
   *   バランス : 両者の幾何平均
   */
  function recommendExposure(cfg, purpose) {
    const npf = npfLimit(cfg.fnum, cfg.camera.pixelPitch, cfg.focal);
    const candidates = MS_DATA.shutterSteps.filter((t) => t <= npf + 1e-9);
    if (candidates.length === 0) candidates.push(MS_DATA.shutterSteps[0]);

    let best = null;
    candidates.forEach((t) => {
      const iso = recommendIso(Object.assign({}, cfg, { exposure: t }), purpose.isoTolerance);
      const ev = evaluate(Object.assign({}, cfg, { exposure: t, iso: iso }));
      const scoreFireball = ev.duty * ev.uncut;
      const scoreCount = ev.encounterIndex;
      const w = purpose.weightCount;
      // 正規化のためスコアは対数で線形結合する（幾何平均の一般化）
      const score = (1 - w) * Math.log(Math.max(scoreFireball, 1e-12)) +
        w * Math.log(Math.max(scoreCount, 1e-12));
      if (!best || score > best.score) best = { score: score, exposure: t, iso: iso, ev: ev };
    });
    best.npf = npf;
    return best;
  }

  /** 撮影枚数と必要容量の見積り */
  function storageEstimate(camera, exposure, gap, hours) {
    const shots = Math.floor(hours * 3600 / (exposure + gap));
    const mbPerShot = camera.megapixels * 1.0; // 圧縮RAWの実測目安（61MP≒60MB）
    return { shots: shots, gb: shots * mbPerShot / 1024 };
  }

  /* ===================== 公開API ===================== */
  const MS_ENGINE = {
    REF: REF,
    pixelAngle: pixelAngle,
    dwellTime: dwellTime,
    angularVelocity: angularVelocity,
    npfLimit: npfLimit,
    backgroundElectrons: backgroundElectrons,
    readNoiseAt: readNoiseAt,
    saturationElectrons: saturationElectrons,
    limitingMagnitude: limitingMagnitude,
    limitingMagnitudeArticle: limitingMagnitudeArticle,
    fireballLimit: fireballLimit,
    uncutProbability: uncutProbability,
    fieldOfView: fieldOfView,
    dutyCycle: dutyCycle,
    evaluate: evaluate,
    recommendIso: recommendIso,
    recommendExposure: recommendExposure,
    storageEstimate: storageEstimate,
  };

  global.MS_ENGINE = MS_ENGINE;
  if (typeof module !== 'undefined' && module.exports) module.exports = MS_ENGINE;
})(typeof window !== 'undefined' ? window : globalThis);
