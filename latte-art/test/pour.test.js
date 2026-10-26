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

/* ===================== 白が浮くか沈むか ===================== */

test('floatFactor: 注ぎ始めは沈み、カップが満ちると白が浮く', () => {
  assert.strictEqual(POUR.floatFactor(POUR.FILL_START, 1), 0, 'エスプレッソだけのうちは沈む');
  assert.strictEqual(POUR.floatFactor(0.5, 1), 0, '半分までは沈む');
  assert.strictEqual(POUR.floatFactor(0.8, 1), 1, '8割入っていれば浮く');
  assert.ok(POUR.floatFactor(0.65, 1) > 0 && POUR.floatFactor(0.65, 1) < 1, 'そのあいだは少しずつ');
});

test('floatFactor: 細い注ぎは満ちていても沈む（切り抜きの線になる）', () => {
  assert.strictEqual(POUR.floatFactor(0.9, 0.15), 0, '細い注ぎは潜る');
  assert.strictEqual(POUR.floatFactor(0.9, 0.6), 1, 'しっかり注げば浮く');
});

test('phase: 画面に出す状態', () => {
  assert.strictEqual(POUR.phase(0.4, 0), 'idle');
  assert.strictEqual(POUR.phase(0.4, 0.8), 'sink');
  assert.strictEqual(POUR.phase(0.85, 0.8), 'float');
  assert.strictEqual(POUR.phase(1, 0.8), 'full', '満杯なら注いでいても満杯');
});
