/*
 * selftest.js — 計算エンジンが記事の数値を再現できるかを検証する
 *
 * 実行: node meteor-settings/selftest.js
 * ブラウザからは読み込まれない（開発用）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const sandbox = { console: console, Math: Math, Date: Date, module: undefined };
vm.createContext(sandbox);
// ブラウザと同じ「1つのスクリプトスコープを共有する」挙動にするため、連結して評価する
const sources = ['data.js', 'astro.js', 'engine.js']
  .map((f) => path.join(dir, f))
  .filter((p) => fs.existsSync(p))
  .map((p) => fs.readFileSync(p, 'utf8'))
  .join('\n;\n');
vm.runInContext(
  sources + '\n;globalThis.MS_DATA = MS_DATA; globalThis.MS_ASTRO = MS_ASTRO;',
  sandbox, { filename: 'bundle.js' }
);

const E = sandbox.MS_ENGINE;
const D = sandbox.MS_DATA;
const a7rv = D.cameras.find((c) => c.id === 'a7rv');
const per = D.showers.find((s) => s.id === 'per');

let fail = 0;
function check(label, actual, expected, tol, unit) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) fail++;
  const fmt = (v) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(3));
  console.log(`${ok ? '  OK ' : 'FAIL '} ${label.padEnd(42)} 計算=${fmt(actual)}${unit || ''}  記事=${fmt(expected)}${unit || ''}`);
}

/* 基準構成 */
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

console.log('=== 基準構成: α7R V + SIGMA 20mm F1.4 / 8秒 / ISO640 / 空21.0等 ===');
const ev = E.evaluate(base);
const va = (over) => E.evaluate(Object.assign({}, base, over, { articleMode: true }));

check('NPF則の露出上限', ev.npf, 8.08, 0.01, '秒');
check('有効口径', ev.aperture, 14.29, 0.02, 'mm');
check('到達等級', ev.limMag, 1.63, 0.005, '等');
check('火球の白飛び限界', ev.fireballMag, -4.25, 0.005, '等');
check('2秒火球が途切れない確率', ev.uncut * 100, 67, 0.5, '%');
check('画素ピッチ', a7rv.pixelPitch, 3.756, 0.001, 'µm');
check('飽和電子数(ISO100)', a7rv.fwcBase, 35815, 1, 'e-');
check('読み出しノイズ(ISO640)', E.readNoiseAt(a7rv, 640), 1.41, 0.01, 'e-');

console.log('\n=== 条件補正表の厳密再現（記事 第12章 / 式⑤そのまま） ===');
const refA = va({}).limMag;
check('F値1段開放 (F1.4→F1.0相当)', va({ fnum: 1.4 / Math.SQRT2 }).limMag - refA, 0.38, 0.005, '等');
check('焦点距離2倍 (20→40mm)', va({ focal: 40 }).limMag - refA, 0.75, 0.005, '等');
check('露出2倍 (8→16秒)', va({ exposure: 16 }).limMag - refA, -0.38, 0.005, '等');
check('空が1等明るい (21.0→20.0)', va({ sky: 20.0 }).limMag - refA, -0.50, 0.005, '等');
check('ピント甘い(中央→周辺)', va({ trailFactor: 1.63 }).limMag - refA, -0.53, 0.005, '等');
check('角速度2倍', va({ omegaDeg: 36 }).limMag - refA, -0.75, 0.005, '等');
check('35mm F2.4 ≒ 20mm F1.4', va({ focal: 35, fnum: 2.4 }).limMag - refA, 0.0, 0.03, '等');
check('到達等級(空21.5等)', va({ sky: 21.5 }).limMag, 1.90, 0.03, '等');

console.log('\n=== ISO の効き方（記事の中心的な主張） ===');
const v = (over) => E.evaluate(Object.assign({}, base, over));
check('ISO1段上昇の到達等級への影響', v({ iso: 1280 }).limMag - ev.limMag, 0.003, 0.02, '等');
check('ISO1段上昇で失う火球保護', ev.fireballMag - v({ iso: 1280 }).fireballMag, -0.76, 0.01, '等');
check('読み出しノイズ(ISO640)', E.readNoiseAt(a7rv, 640), 1.41, 0.01, 'e-');
check('背景ショットノイズ支配（>1で支配）', ev.noiseDominance, 7.7, 1.0, '倍');

console.log('\n=== 基準geometry（離角60°・カメラ高度38°）の整合 ===');
check('式③で ω=18°/s になるか', E.angularVelocity(per.velocity, E.REF.elong, E.REF.camAlt), 18.0, 0.02, '°/s');
check('基準高度での空の明るさ補正', E.skyOffsetForAltitude(21.0, E.REF.camAlt), 0.0, 0.001, '等');
check('基準高度での流星の減光', E.meteorExtinction(E.REF.camAlt), 0.0, 0.001, '等');
check('天頂の大気の厚み', E.airmass(90), 1.0, 0.001, '倍');
check('高度30°の大気の厚み', E.airmass(30), 2.0, 0.01, '倍');

console.log('\n=== カメラの高度による補正（近似モデル） ===');
console.log('  高度  大気の厚み  空の明るさ(暗夜21.6等)  空の明るさ(郊外18.9等)  流星の減光');
[90, 60, 45, 38, 30, 20, 10].forEach((alt) => {
  const dark = E.skyAtAltitude(21.56, alt);
  const town = E.skyAtAltitude(18.69, alt);
  console.log(`  ${String(alt).padStart(3)}°   ${E.airmass(alt).toFixed(2)}      ` +
    `${dark.toFixed(2)}等 (${(dark - 21.56).toFixed(2)})        ` +
    `${town.toFixed(2)}等 (${(town - 18.69).toFixed(2)})       ` +
    `${(E.REF.extinctionK * (E.airmass(alt) - 1)).toFixed(2)}等`);
});

console.log('\n=== 記事の定性的な主張の確認 ===');
check('火球限界は空の明るさにほぼ無依存', v({ sky: 20.0 }).fireballMag - ev.fireballMag, 0.0, 0.05, '等');
check('火球限界は露出時間にほぼ無依存', v({ exposure: 16 }).fireballMag - ev.fireballMag, 0.0, 0.05, '等');
check('35mm F2.4 の有効口径', v({ focal: 35, fnum: 2.4 }).aperture, 14.6, 0.05, 'mm');
check('ふたご座の角速度による有利さ', 2.5 * Math.log10(59 / 35), 0.53, 0.05, '等');

console.log('\n=== 読み出しノイズを入れたことによる記事の式との差（参考） ===');
[[{}, '基準(8秒)'], [{ exposure: 2 }, '2秒'], [{ exposure: 1 }, '1秒'], [{ sky: 19.0 }, '空19.0等']]
  .forEach(([over, label]) => {
    const e = v(over);
    console.log(`  ${label.padEnd(10)} 記事の式 ${e.limMagArticle.toFixed(2)}等 → 読み出しノイズ込み ${e.limMag.toFixed(2)}等 (差 ${e.readNoisePenalty.toFixed(2)}等)`);
  });

console.log('\n=== 目的別の推奨設定 ===');
D.purposes.forEach((p) => {
  const rec = E.recommendExposure(base, p);
  console.log(`  ${p.label.padEnd(6)} → ${rec.exposure}秒 / ISO ${rec.iso} / 到達 ${rec.ev.limMag.toFixed(2)}等 / 火球限界 ${rec.ev.fireballMag.toFixed(2)}等 / 途切れない確率 ${(rec.ev.uncut * 100).toFixed(0)}%`);
});

console.log('\n=== 容量見積り（記事: 8秒間隔×5時間 ≒ 2000枚 ≒ 120GB） ===');
const st = E.storageEstimate(a7rv, 8, 1.0, 5);
console.log(`  ${st.shots}枚 / ${st.gb.toFixed(0)}GB`);

if (sandbox.MS_ASTRO) {
  console.log('\n=== 天文計算の検証 ===');
  const A = sandbox.MS_ASTRO;
  // 2026-08-13 01:00 JST 東京でのペルセウス座放射点高度
  const d = new Date(Date.UTC(2026, 7, 12, 16, 0, 0));
  const alt = A.radiantAltitude(d, 35.69, 139.69, per);
  console.log(`  2026-08-13 01:00 JST 東京 ペルセウス座放射点高度: ${alt.altitude.toFixed(1)}° (方位 ${alt.azimuth.toFixed(0)}°)`);
  const sun = A.sunPosition(d, 35.69, 139.69);
  console.log(`  同時刻の太陽高度: ${sun.altitude.toFixed(1)}°（天文薄明の判定用、-18°以下なら完全な暗夜）`);
  const moon = A.moonInfo(d, 35.69, 139.69);
  console.log(`  同時刻の月: 高度 ${moon.altitude.toFixed(1)}° / 輝面比 ${(moon.illumination * 100).toFixed(0)}% / 月齢 ${moon.age.toFixed(1)}日`);
}

/* ===================== 版の整合性 =====================
 * 版は data.js / index.html（meta と ?v=）/ sw.js の4か所に出てくる。
 * ずれると「古い HTML ＋ 新しい JS」で起動して真っ白になる事故につながるので、
 * ここで機械的に突き合わせる。
 */
console.log('\n=== 版の整合性（4か所が揃っているか） ===');
const version = D.appVersion;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');

function checkText(label, ok, detail) {
  if (!ok) fail++;
  console.log(`${ok ? '  OK ' : 'FAIL '} ${label.padEnd(42)} ${detail}`);
}

const metaMatch = html.match(/<meta name="app-version" content="([^"]+)">/);
checkText('index.html の meta app-version', !!metaMatch && metaMatch[1] === version,
  metaMatch ? metaMatch[1] : '（meta が無い）');

const queries = Array.from(html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))\?v=([^"]+)"/g));
const bad = queries.filter((m) => m[2] !== version).map((m) => `${m[1]}?v=${m[2]}`);
checkText('index.html の ?v=（js/css）', queries.length >= 9 && bad.length === 0,
  `${queries.length}件中${bad.length}件ずれ` + (bad.length ? ' → ' + bad.join(', ') : ''));

const unversioned = Array.from(html.matchAll(/(?:src|href)="((?!https?:)[^"?]+\.(?:js|css))"/g))
  .map((m) => m[1]);
checkText('版を付け忘れた js/css が無いこと', unversioned.length === 0,
  unversioned.length ? unversioned.join(', ') : 'なし');

const swMatch = sw.match(/const VERSION = '([^']+)'/);
checkText('sw.js の VERSION', !!swMatch && swMatch[1] === version,
  swMatch ? swMatch[1] : '（VERSION が無い）');

checkText('data.js の appUpdated の書式', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(D.appUpdated),
  D.appUpdated);

/* 更新時刻を手で書くと、うっかり未来の時刻を入れてしまう（実際に最大2時間先の値が
   入っていた）。tools/release.py で打つのが正で、ここでは未来でないことを検査する。
   端末の時計のずれを考えて5分だけ猶予を持たせる。 */
const updatedAt = new Date(D.appUpdated.replace(' ', 'T'));
const skewMin = (updatedAt.getTime() - Date.now()) / 60000;
checkText('appUpdated が未来でないこと', skewMin <= 5,
  skewMin > 5 ? `${Math.round(skewMin)}分先の時刻になっている（tools/release.py で打ち直す）`
    : `${Math.round(-skewMin)}分前`);

console.log(fail === 0 ? '\n全項目が記事の数値と一致しました。' : `\n${fail}項目が不一致です。`);
process.exit(fail === 0 ? 0 : 1);
