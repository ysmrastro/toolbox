/*
 * pigeon.test.js — 鳩メーカーの寸法と個体の決め方（pigeon.js）
 *
 * 期待値は文献の数値をそのまま書く（pigeon.js の式を写さない）:
 *   Acta Vet Scand 2010;52:45 表1（Madrid の市街地ドバト n=118）
 *   翼長 221.4mm（200–237）／跗蹠 31.6mm（27.2–36.3）／体重 275.6g（168–385）
 * 尾・くちばし・首・頭は文献値を取れていない「仮」の値なので、ここでは検査しない。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const P = require('../pigeon.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} と ${b}`);
const q = key => P.PARAMS.find(x => x.key === key);

test('既定値は文献の平均（翼長 221.4mm・跗蹠 31.6mm・体重 275.6g）', () => {
  const i = P.info(P.defaults(), 'bar', 'stand');
  near(i.wingMm, 221.4, 0.05, '翼長');
  near(i.tarsusMm, 31.6, 0.05, '跗蹠');
  near(i.weightG, 275.6, 0.05, '体重');
  near(i.lengthCm, 33, 0.05, '全長（二次資料 29–37cm の中ほど）');
});

test('「文献」の印がついた範囲の両端が、観測された範囲に収まる', () => {
  const base = P.defaults();
  const at = (key, v) => P.info(Object.assign({}, base, { [key]: v }), 'bar', 'stand');
  // 翼長 200–237mm
  const w0 = at('size', q('size').real[0]).wingMm, w1 = at('size', q('size').real[1]).wingMm;
  assert.ok(w0 >= 200 && w1 <= 237, `翼長 ${w0}–${w1}`);
  // 跗蹠 27.2–36.3mm
  const t0 = at('leg', q('leg').real[0]).tarsusMm, t1 = at('leg', q('leg').real[1]).tarsusMm;
  assert.ok(t0 >= 27.2 && t1 <= 36.3, `跗蹠 ${t0}–${t1}`);
  // 体重 168–385g は、大きさごとの胴まわりの範囲（girthRange）で動かしたとき端でも収まる
  for (const size of [q('size').real[0], 100, q('size').real[1]]) {
    const [lo, hi] = P.girthRange(size);
    [lo, hi].forEach(girth => {
      const g = P.info(Object.assign({}, base, { size, girth }), 'bar', 'stand').weightG;
      assert.ok(g >= 168 && g <= 385, `大きさ ${size}% 胴まわり ${girth}% → ${g}g`);
    });
  }
});

test('個体番号から同じ個体が決まり、「実在」の範囲に収まる', () => {
  const a = P.fromSeed(6575), b = P.fromSeed(6575), c = P.fromSeed(7622);
  assert.deepStrictEqual(a, b, '同じ番号なら同じ個体');
  assert.notDeepStrictEqual(a.p, c.p, '番号が違えば別の個体');
  for (let n = 1; n <= 200; n++) {
    const r = P.fromSeed(n);
    assert.ok(P.MORPHS[r.morph], `羽色 ${r.morph}`);
    P.PARAMS.forEach(x => { if (x.key) assert.ok(r.p[x.key] >= x.real[0] && r.p[x.key] <= x.real[1], `${n}: ${x.key}=${r.p[x.key]}`); });
  }
});

test('全ポーズ・全羽色で描画でき、NaN が出ない', () => {
  for (const pose of ['walk', 'stand', 'look', 'sit']) {
    for (const m of Object.keys(P.MORPHS)) {
      const b = P.build(P.defaults(), m, pose, 1);
      ['A', 'B', 'C'].forEach(k => assert.ok(b[k].length > 500 && !/NaN|undefined/.test(b[k]), `${pose}/${m}/${k}`));
    }
  }
});

test('ありえない範囲でも描画が壊れない（スイッチを入れたとき）', () => {
  const p = P.defaults();
  P.PARAMS.forEach(x => { if (x.key) p[x.key] = x.fun[1]; });
  assert.ok(!/NaN/.test(P.build(p, 'bar', 'stand', 1).B));
  P.PARAMS.forEach(x => { if (x.key) p[x.key] = x.fun[0]; });
  assert.ok(!/NaN/.test(P.build(p, 'bar', 'stand', 1).B));
});

test('立っているときは足が地面につく', () => {
  const p = P.defaults();
  [50, 100, 200].forEach(leg => {
    const g = P.build(Object.assign({}, p, { leg }), 'bar', 'stand', 1).G;
    near(g.hw.y + g.ll, 382, 0.01, `脚 ${leg}%`);
  });
});

test('個体番号1〜9999の全部が、体重 168–385g・全長 29–37cm に収まる', () => {
  for (let n = 1; n <= 9999; n++) {
    const r = P.fromSeed(n), i = P.info(r.p, r.morph, 'stand');
    assert.ok(i.weightG >= 168 && i.weightG <= 385, `${n}: ${i.weightG}g`);
    assert.ok(i.lengthCm >= 29 && i.lengthCm <= 37, `${n}: ${i.lengthCm}cm`);
  }
});

test('parseSettings: 不正な設定は null、危険な値や未知のキーは取り込まない', () => {
  assert.strictEqual(P.parseSettings('これはJSONではない'), null);
  assert.strictEqual(P.parseSettings('{"morph":"nothing","p":{}}'), null, '未知の羽色');
  assert.strictEqual(P.parseSettings('null'), null);
  ['constructor', '__proto__', 'toString', 'hasOwnProperty'].forEach(m => assert.strictEqual(P.parseSettings(JSON.stringify({ morph: m, p: {} })), null, `羽色 ${m} は通さない`));
  const o = P.parseSettings('{"morph":"bar","seed":"<img src=x onerror=alert(1)>","p":{"size":"abc","leg":120,"zzz":1,"head":99999,"eye":null}}');
  assert.strictEqual(o.seed, 1, '数でない個体番号は 1');
  assert.strictEqual(o.p.size, 100, '数でない値は既定値');
  assert.strictEqual(o.p.leg, 120);
  assert.strictEqual(o.p.head, q('head').fun[1], '範囲外は端に収める');
  assert.strictEqual(o.p.eye, 100, 'null は既定値');
  assert.ok(!('zzz' in o.p), '未知のキーは捨てる');
  assert.strictEqual(P.parseSettings('{"morph":"bar","seed":123456,"p":{}}').seed, 9999, '個体番号は 1〜9999 に収める');
});
