/*
 * quiz.test.js — 4択ドリルの純粋な処理（quiz.js）
 *
 * 期待値はテストの中に直接書く（quiz.js と同じ式を写すと、バグごと固定してしまう）。
 * 乱数は決まった値を返す関数を注入して、並びを決定的にしてから確かめる。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Q = require('../quiz.js');

/** 決まった値を順に返す乱数（尽きたら先頭に戻る） */
function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

/** 簡単な線形合同法。並びは決定的だが偏りの少ない乱数 */
function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function q(id, extra) {
  return Object.assign({ id, question: '問' + id, choices: ['あ', 'い', 'う', 'え'], answer: 1 }, extra);
}

function file(sets) {
  return { format: 'yontaku-drill/1', sets };
}

/* ===================== 検証 ===================== */

test('validateFile: 正しいファイルを通す（任意項目つき）', () => {
  const data = file([{
    id: 's1', title: '問題集1', questions: [
      q('a', { no: 1, category: '第1章', points: 2, explanation: '解説', supplement: '補足',
        image: 'data:image/svg+xml,x', imageAlt: '図', fixedOrder: true }),
      q('b', { answers: [2, 3], answer: 2 }),
      q(3, { choices: ['はい', 'いいえ'], answer: 2 }),
    ],
  }]);
  const r = Q.validateFile(data);
  assert.strictEqual(r.ok, true, r.errors.join('\n'));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.sets.length, 1);
});

test('validateFile: format が違えば拒否する', () => {
  const r = Q.validateFile({ format: 'other/1', sets: [{ id: 's', title: 't', questions: [q('a')] }] });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /format/);
  assert.deepStrictEqual(r.sets, []);
});

test('validateFile: answer が範囲外なら、どの問題かを示して拒否する', () => {
  const r = Q.validateFile(file([{ id: 's', title: '問題集A', questions: [q('a'), q('b', { answer: 5 })] }]));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.errors, ['問題集「問題集A」の 2 問目（id: b）: answer が選択肢の範囲外です（1〜4）']);

  const r0 = Q.validateFile(file([{ id: 's', title: 'T', questions: [q('a', { answer: 0 })] }]));
  assert.strictEqual(r0.ok, false);

  const rs = Q.validateFile(file([{ id: 's', title: 'T', questions: [q('a', { answers: [1, 5] })] }]));
  assert.strictEqual(rs.ok, false);
  assert.match(rs.errors[0], /answers/);
});

test('validateFile: answers だけの問題（answer なし）を通し、answers で判定する', () => {
  const question = { id: 'a', question: '問', choices: ['あ', 'い', 'う', 'え'], answers: [2, 4] };
  const r = Q.validateFile(file([{ id: 's', title: 'T', questions: [question] }]));
  assert.strictEqual(r.ok, true, r.errors.join('\n'));
  assert.deepStrictEqual(Q.correctIndices(question), [1, 3]);
});

test('validateFile: answer も answers もない問題は拒否する', () => {
  const question = { id: 'a', question: '問', choices: ['あ', 'い', 'う', 'え'] };
  const r = Q.validateFile(file([{ id: 's', title: 'T', questions: [question] }]));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.errors, ['問題集「T」の 1 問目（id: a）: answer または answers（正解の番号）がありません']);
});

test('validateFile: 選択肢が2個未満なら拒否する', () => {
  const r = Q.validateFile(file([{ id: 's', title: 'T', questions: [q('a', { choices: ['ひとつ'] })] }]));
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /choices/);
});

test('validateFile: 問題の id・問題集の id が重複していたら拒否する', () => {
  const r = Q.validateFile(file([{ id: 's', title: 'T', questions: [q('a'), q('a')] }]));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.errors, ['問題集「T」の 2 問目（id: a）: 問題の id が重複しています']);

  const rs = Q.validateFile(file([
    { id: 's', title: 'T1', questions: [q('a')] },
    { id: 's', title: 'T2', questions: [q('a')] },
  ]));
  assert.strictEqual(rs.ok, false);
  assert.match(rs.errors[0], /問題集の id「s」が重複/);
});

test('validateFile: 別の問題集なら問題の id が同じでもよい', () => {
  const r = Q.validateFile(file([
    { id: 's1', title: 'T1', questions: [q('a')] },
    { id: 's2', title: 'T2', questions: [q('a')] },
  ]));
  assert.strictEqual(r.ok, true);
});

/* ===================== 統合 ===================== */

test('mergeSets: 同じ id は置き換え、違う id は追加する', () => {
  const old1 = { id: 's1', title: '旧1', questions: [] };
  const old2 = { id: 's2', title: '旧2', questions: [] };
  const new2 = { id: 's2', title: '新2', questions: [] };
  const new3 = { id: 's3', title: '新3', questions: [] };
  const existing = [old1, old2];

  const r = Q.mergeSets(existing, [new2, new3]);
  assert.deepStrictEqual(r.sets.map((s) => s.title), ['旧1', '新2', '新3']);
  assert.deepStrictEqual(r.added, ['s3']);
  assert.deepStrictEqual(r.replaced, ['s2']);
  // 引数は書き換えない
  assert.deepStrictEqual(existing.map((s) => s.title), ['旧1', '旧2']);
});

/* ===================== 出題順 ===================== */

test('sequentialOrder: no の順に並べる（no が無ければ配列順）', () => {
  const set = { id: 's', title: 'T', questions: [q('c', { no: 3 }), q('a', { no: 1 }), q('b', { no: 2 })] };
  assert.deepStrictEqual(Q.sequentialOrder(set), ['s::a', 's::b', 's::c']);

  const noNo = { id: 's', title: 'T', questions: [q('x'), q('y'), q('z')] };
  assert.deepStrictEqual(Q.sequentialOrder(noNo), ['s::x', 's::y', 's::z']);
});

test('randomOrder: 注入した乱数で決まった並びになる', () => {
  const set = { id: 's', title: 'T', questions: [q('a'), q('b'), q('c'), q('d')] };
  // 常に 0 を返すと、後ろから順に先頭と入れ替わる: [a,b,c,d] → [d,b,c,a] → [c,b,d,a] → [b,c,d,a]
  assert.deepStrictEqual(Q.randomOrder(set, () => 0), ['s::b', 's::c', 's::d', 's::a']);
  // 常に 0.999 を返すと、入れ替えが起きない
  assert.deepStrictEqual(Q.randomOrder(set, () => 0.999), ['s::a', 's::b', 's::c', 's::d']);
});

test('randomOrder: 全問をちょうど1回ずつ含む', () => {
  const questions = Array.from({ length: 60 }, (_, i) => q('q' + i, { no: i + 1 }));
  const set = { id: 's', title: 'T', questions };
  const order = Q.randomOrder(set, lcg(42));
  assert.strictEqual(order.length, 60);
  assert.strictEqual(new Set(order).size, 60);
  const expected = Array.from({ length: 60 }, (_, i) => 's::q' + i).sort();
  assert.deepStrictEqual(order.slice().sort(), expected);
  // 実際に並べ替わっている（通しと同じ順ではない）
  assert.notDeepStrictEqual(order, Q.sequentialOrder(set));
});

test('allRandomOrder: 全問題集から指定数に切り詰める。null なら全問', () => {
  const sets = [
    { id: 's1', title: 'T1', questions: [q('a'), q('b'), q('c')] },
    { id: 's2', title: 'T2', questions: [q('a'), q('b')] },
  ];
  const three = Q.allRandomOrder(sets, 3, lcg(7));
  assert.strictEqual(three.length, 3);
  assert.strictEqual(new Set(three).size, 3);

  const all = Q.allRandomOrder(sets, null, lcg(7));
  assert.deepStrictEqual(all.slice().sort(), ['s1::a', 's1::b', 's1::c', 's2::a', 's2::b']);

  // 全問より多い数を指定したら全問
  assert.strictEqual(Q.allRandomOrder(sets, 60, lcg(7)).length, 5);
});

/* ===================== 並べ替えと正誤 ===================== */

test('choiceOrder: fixedOrder の問題は並べ替えない', () => {
  assert.deepStrictEqual(Q.choiceOrder(q('a', { fixedOrder: true }), () => 0), [0, 1, 2, 3]);
  assert.deepStrictEqual(Q.choiceOrder(q('a'), () => 0), [1, 2, 3, 0]);
});

test('judge: 並べ替え後の表示位置から、元の番号で正誤を判定する', () => {
  const question = q('a', { answer: 3 });          // 元の 3 番（添字 2）が正解
  const order = [1, 2, 3, 0];                      // 表示位置 1 番目に元の添字 2 が来ている
  assert.deepStrictEqual(Q.judge(question, order, 1), { original: 2, correct: true });
  assert.deepStrictEqual(Q.judge(question, order, 2), { original: 3, correct: false });
  assert.deepStrictEqual(Q.judge(question, order, 0), { original: 1, correct: false });
});

test('judge: answers が複数なら、そのどれを選んでも正解', () => {
  const question = q('a', { answer: 2, answers: [2, 4] });
  const order = [3, 0, 1, 2];                      // 表示位置 → 元の添字
  assert.strictEqual(Q.judge(question, order, 0).correct, true);   // 元の 4 番
  assert.strictEqual(Q.judge(question, order, 2).correct, true);   // 元の 2 番
  assert.strictEqual(Q.judge(question, order, 1).correct, false);  // 元の 1 番
  assert.strictEqual(Q.judge(question, order, 3).correct, false);  // 元の 3 番
  assert.deepStrictEqual(Q.correctIndices(question), [1, 3]);
});

/* ===================== 採点 ===================== */

test('score: points の合計（points が無い問題は1点）', () => {
  const s = Q.score([
    { question: q('a', { points: 2 }), correct: true },
    { question: q('b', { points: 2 }), correct: false },
    { question: q('c'), correct: true },
    { question: q('d'), correct: false },
  ]);
  assert.deepStrictEqual(s, { correct: 2, total: 4, points: 3, maxPoints: 6, hasPoints: true });

  const plain = Q.score([{ question: q('a'), correct: true }, { question: q('b'), correct: false }]);
  assert.deepStrictEqual(plain, { correct: 1, total: 2, points: 1, maxPoints: 2, hasPoints: false });
});

/* ===================== 表示用の値・成績 ===================== */

test('questionLabel: 問題集名と no から「第11回 問5」の形を作る', () => {
  const set = { id: 's', title: '第11回', questions: [] };
  assert.strictEqual(Q.questionLabel(set, q('a', { no: 5 }), 0), '第11回 問5');
  assert.strictEqual(Q.questionLabel(set, q('a'), 6), '第11回 問7');
});

test('circled: 元の番号を丸付き数字にする', () => {
  assert.strictEqual(Q.circled(1), '①');
  assert.strictEqual(Q.circled(4), '④');
  assert.strictEqual(Q.circled(21), '(21)');
});

test('updateStats: 回答回数・正解回数・最後の結果・日時を積み上げる', () => {
  let st = {};
  st = Q.updateStats(st, 's::a', true, '2026-09-26T10:00:00.000Z');
  st = Q.updateStats(st, 's::a', false, '2026-09-26T11:00:00.000Z');
  assert.deepStrictEqual(st['s::a'], {
    attempts: 2, corrects: 1, last: 'wrong', lastAt: '2026-09-26T11:00:00.000Z',
  });
});
