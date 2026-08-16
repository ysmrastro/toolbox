/*
 * engine.test.js — 撮影設定の計算が note 記事の数値を再現するか
 *
 * 期待値の出どころは friend_camera 氏の note 記事（付録A 8式と第12章の補正表）。
 * **プロダクトコードとは独立した外部の真値**なので、同じ式をテストに書き写す
 * 自作自演にならない。engine.js を触ったときに記事から外れたら落ちる。
 *
 * 「記事に数値が無い」ものは分けて書いてある（下の「現状値の固定」）。
 * そちらは正しさの証明ではなく、黙って変わらないための回帰防止。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/load.js');

const { D, E } = load();
const a7rv = D.cameras.find((c) => c.id === 'a7rv');
const per = D.showers.find((s) => s.id === 'per');

/** 記事の基準構成: α7R V + SIGMA 20mm F1.4 / 8秒 / ISO640 / 空21.0等 */
const base = {
  camera: a7rv,
  focal: 20, fnum: 1.4,
  trailFactor: 1.0,
  sky: 21.0,
  omegaDeg: 18,
  exposure: 8, gap: 1.0, iso: 640,
  r: per.r, meanMag: per.meanMag,
  radiantAlt: 50,
  sensorW: 35.9, sensorH: 23.9,
  fireballDuration: 2.0,
};

const ev = E.evaluate(base);
/** 記事の式そのまま（読み出しノイズを入れない）で評価する */
const va = (over) => E.evaluate(Object.assign({}, base, over, { articleMode: true }));
/** 読み出しノイズ込み（アプリが実際に出す値） */
const v = (over) => E.evaluate(Object.assign({}, base, over));

/** 許容差つきの数値比較。記事の数値は丸めて載っているので tol が要る */
function near(actual, expected, tol, message) {
  assert.ok(Math.abs(actual - expected) <= tol,
    `${message}: 計算=${actual} 期待=${expected}±${tol}`);
}

test('記事の基準構成の数値を再現する', () => {
  near(ev.npf, 8.08, 0.01, 'NPF則の露出上限[秒]');
  near(ev.aperture, 14.29, 0.02, '有効口径[mm]');
  near(ev.limMag, 1.63, 0.005, '到達等級[等]');
  near(ev.fireballMag, -4.25, 0.005, '火球の白飛び限界[等]');
  near(ev.uncut * 100, 67, 0.5, '2秒火球が途切れない確率[%]');
});

test('α7R V のセンサー値は記事の実測値のまま', () => {
  near(a7rv.pixelPitch, 3.756, 0.001, '画素ピッチ[µm]');
  near(a7rv.fwcBase, 35815, 1, '飽和電子数(ISO100)[e-]');
  near(E.readNoiseAt(a7rv, 640), 1.41, 0.01, '読み出しノイズ(ISO640)[e-]');
});

test('条件補正表を厳密に再現する（記事 第12章 / 式⑤そのまま）', () => {
  const ref = va({}).limMag;
  near(va({ fnum: 1.4 / Math.SQRT2 }).limMag - ref, 0.38, 0.005, 'F値1段開放');
  near(va({ focal: 40 }).limMag - ref, 0.75, 0.005, '焦点距離2倍');
  near(va({ exposure: 16 }).limMag - ref, -0.38, 0.005, '露出2倍');
  near(va({ sky: 20.0 }).limMag - ref, -0.50, 0.005, '空が1等明るい');
  near(va({ trailFactor: 1.63 }).limMag - ref, -0.53, 0.005, 'ピントが甘い(中央→周辺)');
  near(va({ omegaDeg: 36 }).limMag - ref, -0.75, 0.005, '角速度2倍');
  near(va({ focal: 35, fnum: 2.4 }).limMag - ref, 0.0, 0.03, '35mm F2.4 ≒ 20mm F1.4');
  near(va({ sky: 21.5 }).limMag, 1.90, 0.03, '到達等級(空21.5等)');
});

test('ISO の効き方（記事の中心的な主張）', () => {
  near(v({ iso: 1280 }).limMag - ev.limMag, 0.003, 0.02, 'ISO1段上昇の到達等級への影響');
  near(ev.fireballMag - v({ iso: 1280 }).fireballMag, -0.76, 0.01, 'ISO1段上昇で失う火球保護');
  near(ev.noiseDominance, 7.7, 1.0, '背景ショットノイズ支配（>1で支配）');
  assert.ok(ev.noiseDominance > 1, '基準構成では背景ショットノイズが支配的であること');
});

test('基準geometry（離角60°・カメラ高度38°）と整合する', () => {
  near(E.angularVelocity(per.velocity, E.REF.elong, E.REF.camAlt), 18.0, 0.02, '式③で ω=18°/s');
  near(E.skyOffsetForAltitude(21.0, E.REF.camAlt), 0.0, 0.001, '基準高度での空の明るさ補正');
  near(E.meteorExtinction(E.REF.camAlt), 0.0, 0.001, '基準高度での流星の減光');
  near(E.airmass(90), 1.0, 0.001, '天頂の大気の厚み');
  near(E.airmass(30), 2.0, 0.01, '高度30°の大気の厚み');
});

test('記事の定性的な主張どおりに振る舞う', () => {
  near(v({ sky: 20.0 }).fireballMag - ev.fireballMag, 0.0, 0.05, '火球限界は空の明るさにほぼ無依存');
  near(v({ exposure: 16 }).fireballMag - ev.fireballMag, 0.0, 0.05, '火球限界は露出時間にほぼ無依存');
  near(v({ focal: 35, fnum: 2.4 }).aperture, 14.6, 0.05, '35mm F2.4 の有効口径[mm]');
});

/* ===================== 現状値の固定（characterization test） =====================
 * ここから下の期待値は記事には載っていない。モデルを触ったときに黙って変わらない
 * ようにするためだけの固定で、「この値が正しい」ことの証明ではない。
 * 意図して変えたときは期待値を書き換えてよい（そのときは変えた理由をコミットに書く）。
 */

test('[現状値] カメラの高度による補正', () => {
  // [高度, 大気の厚み, 暗夜21.56等での空, 郊外18.69等での空, 流星の減光]
  const expected = [
    [90, 1.00, 21.56, 18.69, 0.00],
    [60, 1.15, 21.44, 18.56, 0.03],
    [45, 1.41, 21.28, 18.40, 0.08],
    [38, 1.62, 21.17, 18.29, 0.12],
    [30, 1.99, 21.04, 18.14, 0.20],
    [20, 2.90, 20.84, 17.91, 0.38],
    [10, 5.59, 20.80, 17.73, 0.92],
  ];
  expected.forEach(([alt, airmass, dark, town, ext]) => {
    near(E.airmass(alt), airmass, 0.02, `高度${alt}° 大気の厚み`);
    near(E.skyAtAltitude(21.56, alt), dark, 0.02, `高度${alt}° 空(暗夜)`);
    near(E.skyAtAltitude(18.69, alt), town, 0.02, `高度${alt}° 空(郊外)`);
    near(E.REF.extinctionK * (E.airmass(alt) - 1), ext, 0.02, `高度${alt}° 流星の減光`);
  });
});

test('[現状値] 目的別の推奨設定', () => {
  const expected = {
    fireball: { exposure: 8, iso: 640 },
    balance: { exposure: 8, iso: 800 },
    count: { exposure: 2, iso: 1600 },
  };
  D.purposes.forEach((p) => {
    const want = expected[p.id];
    if (!want) return;                       // 目的を足したらここにも足す
    const rec = E.recommendExposure(base, p);
    assert.strictEqual(rec.exposure, want.exposure, `${p.label} の露出[秒]`);
    assert.strictEqual(rec.iso, want.iso, `${p.label} の ISO`);
  });
});

test('[現状値] 容量見積り（記事: 8秒間隔×5時間 ≒ 2000枚 ≒ 120GB）', () => {
  const st = E.storageEstimate(a7rv, 8, 1.0, 5);
  assert.strictEqual(st.shots, 2000, '枚数');
  near(st.gb, 119, 1, '容量[GB]');
});

test('[現状値] 読み出しノイズを入れたことによる記事の式との差', () => {
  /* readNoisePenalty は「記事の式 − 読み出しノイズ込み」で、基準構成でぴったり 0 になる
     ように較正してある。露出を短くすると差が開く（記事の式が過大評価になる）。
     空が明るいときは符号が反転して負になるが、これは誤りではない。読み出しノイズの
     効きは暗い空（＝基準）でいちばん大きいので、そこを基準にすると明るい空は
     相対的に得をして見える。 */
  // [設定, 記事の式の到達等級, 読み出しノイズ込み]
  const expected = [
    [{}, 1.63, 1.63],
    [{ exposure: 2 }, 2.38, 2.22],
    [{ exposure: 1 }, 2.76, 2.44],
    [{ sky: 19.0 }, 0.63, 0.68],
  ];
  expected.forEach(([over, article, withNoise]) => {
    const e = v(over);
    near(e.limMagArticle, article, 0.02, `${JSON.stringify(over)} 記事の式`);
    near(e.limMag, withNoise, 0.02, `${JSON.stringify(over)} 読み出しノイズ込み`);
    near(e.readNoisePenalty, article - withNoise, 0.02, `${JSON.stringify(over)} 差の定義`);
  });

  // 露出が短いほど記事の式との差が開く（読み出しノイズが効いてくる）
  assert.ok(v({ exposure: 1 }).readNoisePenalty > v({ exposure: 2 }).readNoisePenalty);
  assert.ok(v({ exposure: 2 }).readNoisePenalty > v({}).readNoisePenalty);
});
