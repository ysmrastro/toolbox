/*
 * pour.test.js — 注ぐ動作の規則（pour.js）
 *
 * 期待値はテストの中に直接書く（pour.js と同じ式を写すと、バグごと固定してしまう）。
 * 流体の計算（fluid.js）は WebGL に結び付いているので、ここでは扱わない。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const POUR = require('../pour.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} と ${b}`);

/* ===================== 傾き → 注ぐ量 ===================== */

test('flowFromTilt: 構えた角度から手前に倒すほど多く注ぐ', () => {
  // 40°で構えた。上の辺を下げると beta が減る
  assert.strictEqual(POUR.flowFromTilt(40, 40), 0, '構えたままでは注がない');
  assert.strictEqual(POUR.flowFromTilt(36, 40), 0, '手ぶれ程度（4°）では垂れない');
  assert.strictEqual(POUR.flowFromTilt(8, 40), 1, '32°倒せば最大');
  assert.strictEqual(POUR.flowFromTilt(-20, 40), 1, 'それ以上倒しても最大のまま');
  assert.strictEqual(POUR.flowFromTilt(60, 40), 0, '奥へ起こしても注がない');

  const a = POUR.flowFromTilt(30, 40);
  const b = POUR.flowFromTilt(20, 40);
  assert.ok(a > 0 && b > a && b < 1, '途中は倒した角度に応じて増える');
});

test('offsetFromRoll: 左右に傾けると注ぐ点が同じ向きに動く', () => {
  assert.strictEqual(POUR.offsetFromRoll(0, 0), 0);
  assert.ok(POUR.offsetFromRoll(10, 0) > 0, '右に傾けると右へ');
  assert.ok(POUR.offsetFromRoll(-10, 0) < 0, '左に傾けると左へ');
  near(POUR.offsetFromRoll(10, 0), -POUR.offsetFromRoll(-10, 0), 1e-12, '左右で対称');
  assert.strictEqual(POUR.offsetFromRoll(90, 0), POUR.offsetFromRoll(40, 0), '動く幅には上限がある');
  assert.ok(POUR.offsetFromRoll(90, 0) <= 0.25, 'カップの外まで飛ばない');
  near(POUR.offsetFromRoll(15, 5), POUR.offsetFromRoll(10, 0), 1e-12, '構えた角度からの差で決まる');
});

/* ===================== カップの量 ===================== */

test('nextFill: 最大の量で注ぎ続けると約10秒で満杯になる', () => {
  let fill = POUR.FILL_START;
  let t = 0;
  while (fill < 1 && t < 60) { fill = POUR.nextFill(fill, 1, 1 / 60); t += 1 / 60; }
  assert.ok(t > 8 && t < 12, `満杯まで ${t.toFixed(1)} 秒`);
  assert.strictEqual(POUR.nextFill(1, 1, 1), 1, '満杯より増えない');
  assert.strictEqual(POUR.nextFill(0.5, 0, 1), 0.5, '注がなければ増えない');
});

/* ===================== 白が浮くか沈むか =====================
 * 期待値は解説に書かれている振る舞い（README の出典）。
 *   - 高い位置から注ぐと潜る
 *   - 液面ぎりぎりから注ぐと泡が乗る。ただしカップが半分〜3/4 入ってから
 *   - 勢いは弱すぎても強すぎても模様にならない（強すぎると沈む）
 */

const FULL_ENOUGH = 0.7;   // 半分〜3/4 の範囲
const GENTLE = 0.5;        // ほどほどの勢い

test('floatFactor: 高い位置から注ぐと、満ちていても勢いが程よくても沈む', () => {
  assert.strictEqual(POUR.floatFactor(FULL_ENOUGH, GENTLE, false), 0);
  assert.strictEqual(POUR.floatFactor(0.95, GENTLE, false), 0);
});

test('floatFactor: 液面ぎりぎりから、ほどほどの勢いで注ぐと白が浮く', () => {
  assert.strictEqual(POUR.floatFactor(FULL_ENOUGH, GENTLE, true), 1);
});

test('floatFactor: カップがまだ浅いうちは、低く注いでも白が乗らない', () => {
  assert.strictEqual(POUR.floatFactor(POUR.FILL_START, GENTLE, true), 0, 'エスプレッソだけ');
  assert.strictEqual(POUR.floatFactor(0.4, GENTLE, true), 0, '半分に満たない');
});

test('floatFactor: 低くても一気に注ぐと沈む。弱すぎても泡を押し広げられない', () => {
  assert.strictEqual(POUR.floatFactor(FULL_ENOUGH, 1, true), 0, '一気に');
  assert.strictEqual(POUR.floatFactor(FULL_ENOUGH, 0.05, true), 0, 'ちょろちょろ');
  const mid = POUR.floatFactor(FULL_ENOUGH, 0.8, true);
  assert.ok(mid > 0 && mid < 1, '強めの勢いでは少しずつ沈み始める');
});

test('phase: 沈んでいるときは理由を返す', () => {
  assert.strictEqual(POUR.phase(0.5, 0, true), 'idle');
  assert.strictEqual(POUR.phase(FULL_ENOUGH, GENTLE, true), 'float');
  assert.strictEqual(POUR.phase(FULL_ENOUGH, GENTLE, false), 'high', '高い位置');
  assert.strictEqual(POUR.phase(0.4, GENTLE, true), 'shallow', 'カップが浅い');
  assert.strictEqual(POUR.phase(FULL_ENOUGH, 1, true), 'strong', '勢いが強すぎる');
  assert.strictEqual(POUR.phase(FULL_ENOUGH, 0.05, true), 'weak', '勢いが弱い');
  assert.strictEqual(POUR.phase(0.4, GENTLE, false), 'high', '高くて浅いときは、まず高さを言う');
  assert.strictEqual(POUR.phase(1, GENTLE, true), 'full', '満杯なら注いでいても満杯');
});
