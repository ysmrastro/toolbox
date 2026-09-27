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

/* ===================== 絞り込み ===================== */

const tagged = [
  { id: 's1', title: 'T1', questions: [
    q('a', { tags: ['タグ甲'] }),
    q('b', { tags: ['タグ乙'] }),
    q('c'),                                  // タグなし
    q('d', { tags: ['タグ甲', 'タグ乙'] }),
  ] },
  { id: 's2', title: 'T2', questions: [q('a', { tags: ['タグ乙'] })] },
];

const keysOf = (sets) => sets.flatMap((s) => s.questions.map((x) => s.id + '::' + x.id));

test('validateFile: tags は文字列の配列だけ通す', () => {
  const ok = Q.validateFile(file([{ id: 's', title: 'T', questions: [q('a', { tags: ['甲', '乙'] })] }]));
  assert.strictEqual(ok.ok, true);
  const ng = Q.validateFile(file([{ id: 's', title: 'T', questions: [q('a', { tags: '甲' })] }]));
  assert.strictEqual(ng.ok, false);
  assert.match(ng.errors[0], /tags/);
});

test('collectTags: 出てくるタグを最初に出てきた順に重複なく集める', () => {
  assert.deepStrictEqual(Q.collectTags(tagged), ['タグ甲', 'タグ乙']);
  assert.deepStrictEqual(Q.collectTags([{ id: 's', title: 'T', questions: [q('a')] }]), []);
});

test('filterSets:「だけ」はそのタグを持つ問題だけ（タグなしは含めない）', () => {
  const r = Q.filterSets(tagged, { type: 'only', tag: 'タグ甲' });
  assert.deepStrictEqual(keysOf(r), ['s1::a', 's1::d']);
});

test('filterSets:「除く」はそのタグを持たない問題（タグなしは含める）。0問の問題集は落とす', () => {
  const r = Q.filterSets(tagged, { type: 'exclude', tag: 'タグ乙' });
  assert.deepStrictEqual(keysOf(r), ['s1::a', 's1::c']);
  assert.deepStrictEqual(r.map((s) => s.id), ['s1']);
});

test('filterSets:「すべて」は絞らない。引数は書き換えない', () => {
  assert.deepStrictEqual(keysOf(Q.filterSets(tagged, { type: 'all' })),
    ['s1::a', 's1::b', 's1::c', 's1::d', 's2::a']);
  Q.filterSets(tagged, { type: 'only', tag: 'タグ甲' });
  assert.strictEqual(tagged[0].questions.length, 4);
});

test('filterSets: 絞った結果は通しの出題順にもそのまま使える', () => {
  const set = { id: 's', title: 'T', questions: [
    q('x', { no: 3, tags: ['甲'] }), q('y', { no: 1 }), q('z', { no: 2, tags: ['甲'] }),
  ] };
  const [only] = Q.filterSets([set], { type: 'only', tag: '甲' });
  assert.deepStrictEqual(Q.sequentialOrder(only), ['s::z', 's::x']);
  assert.strictEqual(Q.countQuestions(Q.filterSets([set], { type: 'only', tag: '乙' })), 0);
});

/* ===================== 前に間違えた問題 ===================== */

let seqNo = 0;
/** [鍵, 正解か, 日時] の並びからログを作る（id は通し番号） */
const logOf = (...rows) => rows.map(([key, ok, at]) => ({ id: 'd:' + (++seqNo), key, at, ok }));
const T = (h) => `2026-09-20T${String(h).padStart(2, '0')}:00:00.000Z`;

test('filterWrong: 最後に解いたとき不正解だった問題だけ', () => {
  const sum = Q.summarizeLog(logOf(['s1::a', false, T(1)], ['s1::b', true, T(1)], ['s2::a', false, T(1)]));
  // s1::c・s1::d は解いていない
  assert.deepStrictEqual(keysOf(Q.filterWrong(tagged, sum)), ['s1::a', 's2::a']);
});

test('filterWrong: 間違えたあと最後に正解したら外れる（ログの並びではなく日時で決める）', () => {
  const sum = Q.summarizeLog(logOf(
    ['s1::a', true, T(2)], ['s1::a', false, T(1)],   // 後で正解
    ['s1::b', false, T(2)], ['s1::b', true, T(1)],   // 後で不正解
  ));
  assert.deepStrictEqual(keysOf(Q.filterWrong(tagged, sum)), ['s1::b']);
});

test('filterWrong: 範囲は渡した問題集の中だけ（問題 id が同じでも別の問題集は別扱い）', () => {
  const sum = Q.summarizeLog(logOf(['s2::a', false, T(1)]));
  const onlyS1 = tagged.filter((s) => s.id === 's1');
  assert.deepStrictEqual(keysOf(Q.filterWrong(onlyS1, sum)), []);
  assert.deepStrictEqual(keysOf(Q.filterWrong(tagged, sum)), ['s2::a']);
});

test('filterWrong と絞り込み・出題数の組み合わせ', () => {
  const sum = Q.summarizeLog(logOf(...['s1::a', 's1::b', 's1::c', 's1::d'].map((k) => [k, false, T(1)])));
  const wrong = Q.filterSets(Q.filterWrong(tagged, sum), { type: 'exclude', tag: 'タグ甲' });
  assert.deepStrictEqual(keysOf(wrong), ['s1::b', 's1::c']);
  const order = Q.allRandomOrder(wrong, 1, () => 0);
  assert.strictEqual(order.length, 1);
});

/* ===================== 前回と違う位置に正解を置く ===================== */

/** 表示順が「元の添字をちょうど1回ずつ含む並び」になっているか */
function isPermutation(order, n) {
  return order.length === n && [...order].sort((a, b) => a - b).every((v, i) => v === i);
}

test('choiceOrder: 前回の位置を渡すと、正解はその位置に来ない（乱数を変えて何通りも）', () => {
  const question = q('a', { answer: 3 });            // 代表の正解は元の添字 2
  for (let prev = 0; prev < 4; prev++) {
    const seen = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      const order = Q.choiceOrder(question, lcg(seed), prev);
      assert.ok(isPermutation(order, 4), JSON.stringify(order));
      const pos = order.indexOf(2);
      assert.notStrictEqual(pos, prev, `prev=${prev} seed=${seed} order=${order}`);
      seen.add(pos);
    }
    // 前回の位置以外の3か所には、どこにも来得る
    assert.deepStrictEqual([...seen].sort(), [0, 1, 2, 3].filter((p) => p !== prev));
  }
});

test('choiceOrder: 乱数の端の値でも前回の位置を避ける', () => {
  const question = q('a', { answer: 1 });            // 元の添字 0
  // 常に 0 → 置ける位置 [1,2,3] の先頭、残り [1,2,3] は [2,3,1] に並ぶ
  assert.deepStrictEqual(Q.choiceOrder(question, () => 0, 0), [2, 0, 3, 1]);
  // 常に 0.999 → 置ける位置 [0,1,2] の末尾、残りは並べ替わらない
  assert.deepStrictEqual(Q.choiceOrder(question, () => 0.999, 3), [1, 2, 0, 3]);
});

test('choiceOrder: 前回の記録がなければ、正解はどの位置にも来得る', () => {
  const question = q('a', { answer: 3 });
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    seen.add(Q.choiceOrder(question, lcg(seed)).indexOf(2));
    seen.add(Q.choiceOrder(question, lcg(seed), undefined).indexOf(2));
    seen.add(Q.choiceOrder(question, lcg(seed), null).indexOf(2));
  }
  assert.deepStrictEqual([...seen].sort(), [0, 1, 2, 3]);
});

test('choiceOrder: 前回の位置が範囲外なら記録なしと同じに扱う', () => {
  const question = q('a', { choices: ['あ', 'い'], answer: 1 });
  const seen = new Set();
  for (let seed = 1; seed <= 50; seed++) seen.add(Q.choiceOrder(question, lcg(seed), 5).indexOf(0));
  assert.deepStrictEqual([...seen].sort(), [0, 1]);
});

test('choiceOrder: 選択肢2つなら、前回と逆の位置に正解が来る', () => {
  const question = q('a', { choices: ['はい', 'いいえ'], answer: 2 });   // 元の添字 1
  for (let seed = 1; seed <= 50; seed++) {
    assert.deepStrictEqual(Q.choiceOrder(question, lcg(seed), 1), [1, 0]);
    assert.deepStrictEqual(Q.choiceOrder(question, lcg(seed), 0), [0, 1]);
  }
});

test('choiceOrder: answers 複数なら、代表（answers の先頭）の位置が前回と変わる', () => {
  const question = q('a', { answer: 2, answers: [4, 2] });   // 代表は元の 4 番（添字 3）
  for (let seed = 1; seed <= 200; seed++) {
    const order = Q.choiceOrder(question, lcg(seed), 1);
    assert.notStrictEqual(order.indexOf(3), 1);
    assert.strictEqual(Q.correctPosition(question, order), order.indexOf(3));
  }
});

test('choiceOrder: fixedOrder の問題は前回の位置があっても並べ替えない', () => {
  assert.deepStrictEqual(Q.choiceOrder(q('a', { fixedOrder: true, answer: 1 }), lcg(1), 0), [0, 1, 2, 3]);
});

test('correctPosition: 表示順の中の代表の正解の位置', () => {
  assert.strictEqual(Q.correctPosition(q('a', { answer: 3 }), [1, 2, 3, 0]), 1);
  assert.strictEqual(Q.correctPosition(q('a', { answer: 1, answers: [2, 1] }), [1, 2, 3, 0]), 0);
});

/* ===================== 学習の記録（回答のログ） ===================== */

const e = (id, key, at, ok) => ({ id, key, at, ok });

test('summarizeLog: 回数・正解・不正解・正答率・最後の結果と日時をログから計算する', () => {
  const sum = Q.summarizeLog([
    e('x1', 's::a', T(1), true),
    e('x2', 's::a', T(3), false),
    e('x3', 's::a', T(2), true),
    e('x4', 's::b', T(1), true),
  ]);
  assert.deepStrictEqual(sum['s::a'], { attempts: 3, corrects: 2, wrongs: 1, rate: 2 / 3, last: 'wrong', lastAt: T(3) });
  assert.deepStrictEqual(sum['s::b'], { attempts: 1, corrects: 1, wrongs: 0, rate: 1, last: 'correct', lastAt: T(1) });
  assert.strictEqual(sum['s::c'], undefined);
});

test('summarizeLog: 同じ日時なら id の大きい方を後とみなす（並びに左右されない）', () => {
  const a = e('p:1', 's::a', T(1), true);
  const b = e('p:2', 's::a', T(1), false);
  assert.strictEqual(Q.summarizeLog([a, b])['s::a'].last, 'wrong');
  assert.strictEqual(Q.summarizeLog([b, a])['s::a'].last, 'wrong');
});

test('unionLog: 同じ id は1件にまとめ、2台分は合算される。何度読み込んでも増えない', () => {
  const ipad = [e('ipad:1', 's::a', T(1), false), e('ipad:2', 's::a', T(2), true)];
  const iphone = [e('iphone:1', 's::a', T(3), false)];
  const once = Q.unionLog(iphone, ipad);
  assert.strictEqual(once.added.length, 2);
  assert.strictEqual(once.log.length, 3);
  assert.deepStrictEqual(Q.summarizeLog(once.log)['s::a'],
    { attempts: 3, corrects: 1, wrongs: 2, rate: 1 / 3, last: 'wrong', lastAt: T(3) });

  const twice = Q.unionLog(once.log, ipad);
  assert.strictEqual(twice.added.length, 0);
  assert.strictEqual(twice.log.length, 3);
  // 読み込むファイルの中の重複も1件
  assert.strictEqual(Q.unionLog([], [ipad[0], ipad[0]]).log.length, 1);
  // 引数は書き換えない
  assert.strictEqual(iphone.length, 1);
});

test('mergePositions: 今の端末に無い鍵だけ足す', () => {
  assert.deepStrictEqual(Q.mergePositions({ 's::a': 1 }, { 's::a': 2, 's::b': 3 }), { 's::a': 1, 's::b': 3 });
  assert.deepStrictEqual(Q.mergePositions({ 's::a': 1 }, undefined), { 's::a': 1 });
});

/* ===================== 移行 ===================== */

test('migrateStats: 正解 corrects 件・不正解 attempts−corrects 件を作り、最後の1件が last になる', () => {
  const log = Q.migrateStats({
    's::a': { attempts: 4, corrects: 1, last: 'correct', lastAt: '2026-09-20T10:00:00.000Z' },
    's::b': { attempts: 3, corrects: 2, last: 'wrong', lastAt: '2026-09-20T10:00:00.000Z' },
  });
  const a = log.filter((x) => x.key === 's::a');
  assert.strictEqual(a.length, 4);
  assert.strictEqual(a.filter((x) => x.ok).length, 1);
  assert.deepStrictEqual(a.map((x) => x.at), [
    '2026-09-20T09:59:57.000Z', '2026-09-20T09:59:58.000Z', '2026-09-20T09:59:59.000Z', '2026-09-20T10:00:00.000Z',
  ]);
  assert.strictEqual(a[3].ok, true);
  assert.strictEqual(a[0].id, 'mig:s::a:4:1:2026-09-20T10:00:00.000Z:0');

  const sum = Q.summarizeLog(log);
  assert.deepStrictEqual(sum['s::a'], { attempts: 4, corrects: 1, wrongs: 3, rate: 0.25, last: 'correct', lastAt: '2026-09-20T10:00:00.000Z' });
  assert.deepStrictEqual(sum['s::b'], { attempts: 3, corrects: 2, wrongs: 1, rate: 2 / 3, last: 'wrong', lastAt: '2026-09-20T10:00:00.000Z' });
});

test('migrateStats: 同じ集計なら同じ id になり、2台分を和集合にしても二重にならない', () => {
  const stats = { 's::a': { attempts: 2, corrects: 1, last: 'wrong', lastAt: '2026-09-20T10:00:00.000Z' } };
  const iphone = Q.migrateStats(stats);
  const ipad = Q.migrateStats(JSON.parse(JSON.stringify(stats)));
  assert.deepStrictEqual(iphone.map((x) => x.id), ipad.map((x) => x.id));
  assert.strictEqual(Q.unionLog(iphone, ipad).log.length, 2);
  // 集計が違えば id も違う（別の記録として足される）
  const other = Q.migrateStats({ 's::a': { attempts: 3, corrects: 1, last: 'wrong', lastAt: '2026-09-21T10:00:00.000Z' } });
  assert.strictEqual(Q.unionLog(iphone, other).log.length, 5);
});

test('migrateStats: last と回数が食い違うときは回数を優先する。回数0は作らない', () => {
  const log = Q.migrateStats({
    's::a': { attempts: 2, corrects: 0, last: 'correct', lastAt: '2026-09-20T10:00:00.000Z' },
    's::b': { attempts: 0, corrects: 0, last: 'wrong', lastAt: '2026-09-20T10:00:00.000Z' },
  });
  assert.deepStrictEqual(log.map((x) => x.ok), [false, false]);
});

/* ===================== 書き出し・読み込み ===================== */

test('validateHistory: 新形式を通し、format 違い・型の不正を拒否する', () => {
  const good = { format: 'yontaku-drill-history/2', exportedAt: T(0), log: [e('d:1', 's::a', T(1), true)], positions: { 's::a': 1 } };
  assert.deepStrictEqual(Q.validateHistory(good), { ok: true, errors: [] });
  assert.strictEqual(Q.validateHistory(Object.assign({}, good, { format: 'yontaku-drill/1' })).ok, false);
  assert.strictEqual(Q.validateHistory(Object.assign({}, good, { log: {} })).ok, false);

  const bad = (x) => Q.validateHistory(Object.assign({}, good, { log: [x] })).errors[0];
  assert.match(bad(e('', 's::a', T(1), true)), /id/);
  assert.match(bad(e('d:1', 5, T(1), true)), /key/);
  assert.match(bad(e('d:1', 's::a', 'きのう', true)), /at/);
  assert.match(bad(e('d:1', 's::a', T(1), 'true')), /ok/);
  assert.match(Q.validateHistory(Object.assign({}, good, { positions: { 's::a': -1 } })).errors[0], /positions/);
});

test('validateHistory / historyToLog: 旧形式も読み込め、移行と同じ規則でログになる', () => {
  const v1 = { format: 'yontaku-drill-history/1', exportedAt: T(0),
    history: { 's::a': { attempts: 3, corrects: 1, last: 'wrong', lastAt: T(5), setTitle: 'T' } }, positions: {} };
  assert.deepStrictEqual(Q.validateHistory(v1), { ok: true, errors: [] });
  const log = Q.historyToLog(v1);
  assert.strictEqual(log.length, 3);
  assert.deepStrictEqual(log.map((x) => x.id), Q.migrateStats({ 's::a': { attempts: 3, corrects: 1, last: 'wrong', lastAt: T(5) } }).map((x) => x.id));

  const badV1 = Object.assign({}, v1, { history: { 's::a': { attempts: 'a', corrects: 0, last: 'wrong', lastAt: T(5) } } });
  assert.match(Q.validateHistory(badV1).errors[0], /attempts/);
});

test('historyToLog: 新形式はアプリが使う項目だけを取り出す', () => {
  const data = { format: 'yontaku-drill-history/2', log: [Object.assign(e('d:1', 's::a', T(1), true), { extra: 1 })] };
  assert.deepStrictEqual(Q.historyToLog(data), [e('d:1', 's::a', T(1), true)]);
});

test('buildHistoryExport: ログと集計が入り、問題文や選択肢は入らない', () => {
  const sets = [{ id: 's', title: '問題集T', questions: [
    q('a', { no: 7, category: '分類1', tags: ['甲'], question: 'ひみつの問題文', choices: ['ひみつA', 'い', 'う', 'え'],
      explanation: 'ひみつの解説' }),
    q('b', { question: 'ひみつその2' }),
  ] }];
  const log = [e('d:1', 's::a', T(1), false), e('d:2', 's::a', T(2), true), e('d:3', 's::b', T(1), true), e('d:4', 'gone::z', T(1), false)];
  const out = Q.buildHistoryExport(log, { 's::a': 2 }, sets, new Date('2026-09-27T01:02:03.000Z'));

  assert.strictEqual(out.format, 'yontaku-drill-history/2');
  assert.strictEqual(out.exportedAt, '2026-09-27T01:02:03.000Z');
  assert.deepStrictEqual(out.log, log);
  assert.deepStrictEqual(out.positions, { 's::a': 2 });
  assert.deepStrictEqual(out.summary['s::a'], {
    attempts: 2, corrects: 1, wrongs: 1, rate: 0.5, last: 'correct', lastAt: T(2),
    setTitle: '問題集T', no: 7, category: '分類1', tags: ['甲'],
  });
  assert.strictEqual(out.summary['s::b'].no, 2);
  assert.deepStrictEqual(out.summary['gone::z'], { attempts: 1, corrects: 0, wrongs: 1, rate: 0, last: 'wrong', lastAt: T(1) });
  assert.doesNotMatch(JSON.stringify(out), /ひみつ/);
  assert.strictEqual(Q.validateHistory(JSON.parse(JSON.stringify(out))).ok, true);
  assert.strictEqual(Q.HISTORY_FILE_NAME, 'quiz-drill-記録.json');
});

test('historySummary: 解いた問題の数・最後に不正解だった数・回答の総数', () => {
  const sum = Q.summarizeLog([e('1', 'a', T(1), false), e('2', 'b', T(1), true), e('3', 'b', T(2), true), e('4', 'c', T(1), false)]);
  assert.deepStrictEqual(Q.historySummary(sum), { answered: 3, wrong: 2, answers: 4 });
});

/* ===================== 苦手な問題 ===================== */

/** 鍵ごとに [正解数, 不正解数, 最後の結果] から集計を作る（ログを経由する） */
function summaryOf(spec) {
  const log = [];
  let n = 0;
  Object.entries(spec).forEach(([key, [c, w, last]]) => {
    // 最後の1件を last にし、それより前に残りを並べる
    const flags = [];
    let cc = c - (last ? 1 : 0);
    let ww = w - (last ? 0 : 1);
    while (ww-- > 0) flags.push(false);
    while (cc-- > 0) flags.push(true);
    flags.push(last);
    flags.forEach((ok, i) => log.push(e('t:' + (++n), key, `2026-09-20T00:00:${String(i).padStart(2, '0')}.000Z`, ok)));
  });
  return Q.summarizeLog(log);
}

const weakSets = [{ id: 's', title: 'T', questions: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => q(id, { no: i + 1 })) }];

test('isWeak: 正答率がしきい値未満、または最後に不正解。しきい値ちょうどは苦手ではない', () => {
  const sum = summaryOf({
    's::a': [7, 3, true],    // 70%・最後は正解
    's::b': [6, 4, true],    // 60%
    's::c': [9, 1, false],   // 90% だが最後は不正解
    's::d': [8, 2, true],    // 80%
  });
  assert.strictEqual(Q.isWeak(sum['s::a'], 0.7), false);
  assert.strictEqual(Q.isWeak(sum['s::a'], 0.8), true);
  assert.strictEqual(Q.isWeak(sum['s::b'], 0.7), true);
  assert.strictEqual(Q.isWeak(sum['s::b'], 0.5), false);
  assert.strictEqual(Q.isWeak(sum['s::c'], 0.5), true);
  assert.strictEqual(Q.isWeak(sum['s::d'], 0.8), false);
  assert.strictEqual(Q.isWeak(undefined, 0.7), false);   // 解いていない問題は苦手に入れない
  assert.deepStrictEqual(keysOf(Q.filterWeak(weakSets, sum, 0.7)), ['s::b', 's::c']);
});

test('weakOrder: 正答率の低い順、同じなら不正解の多い順、さらに同じなら乱数で決まる', () => {
  const sum = summaryOf({
    's::a': [1, 1, true],    // 50%・不正解1
    's::b': [0, 2, false],   // 0%・不正解2
    's::c': [2, 2, true],    // 50%・不正解2
    's::d': [1, 1, false],   // 50%・不正解1（a と同点）
    's::e': [0, 1, false],   // 0%・不正解1
  });
  const weak = Q.filterWeak(weakSets, sum, 0.7);
  const orders = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const o = Q.weakOrder(weak, sum, null, lcg(seed));
    assert.deepStrictEqual(o.slice(0, 3), ['s::b', 's::e', 's::c']);
    assert.deepStrictEqual(o.slice(3).sort(), ['s::a', 's::d']);
    orders.add(o.slice(3).join(','));
  }
  assert.deepStrictEqual([...orders].sort(), ['s::a,s::d', 's::d,s::a']);
  assert.deepStrictEqual(Q.weakOrder(weak, sum, 2, lcg(1)), ['s::b', 's::e']);
});

test('statsReport: 全体・問題集ごと・分類ごとの集計と、苦手の一覧', () => {
  const sets = [
    { id: 's1', title: 'T1', questions: [q('a', { category: '甲' }), q('b', { category: '乙' }), q('c', { category: '甲' })] },
    { id: 's2', title: 'T2', questions: [q('a', { category: '乙' }), q('b')] },
  ];
  const sum = Object.assign(summaryOf({
    's1::a': [1, 3, false],   // 25%・苦手
    's1::b': [3, 0, true],    // 100%
    's2::a': [1, 1, true],    // 50%・苦手
  }), { 'gone::x': { attempts: 9, corrects: 0, wrongs: 9, rate: 0, last: 'wrong', lastAt: T(1) } });
  const r = Q.statsReport(sets, sum, 0.7);

  assert.deepStrictEqual(r.total, { questions: 5, answered: 3, answers: 9, corrects: 5, rate: 5 / 9, weak: 2 });
  assert.deepStrictEqual(r.bySet, [
    { id: 's1', title: 'T1', questions: 3, answered: 2, answers: 7, corrects: 4, rate: 4 / 7, weak: 1 },
    { id: 's2', title: 'T2', questions: 2, answered: 1, answers: 2, corrects: 1, rate: 0.5, weak: 1 },
  ]);
  assert.deepStrictEqual(r.byCategory, [
    { category: '甲', questions: 2, answered: 1, answers: 4, corrects: 1, rate: 0.25, weak: 1 },
    { category: '乙', questions: 2, answered: 2, answers: 5, corrects: 4, rate: 0.8, weak: 1 },
    { category: null, questions: 1, answered: 0, answers: 0, corrects: 0, rate: null, weak: 0 },
  ]);
  assert.deepStrictEqual(r.weakList.map((w) => w.key), ['s1::a', 's2::a']);
  assert.deepStrictEqual(r.weakList[0], { key: 's1::a', attempts: 4, corrects: 1, wrongs: 3, rate: 0.25 });
});

test('statsReport: 苦手の一覧は最大30件', () => {
  const questions = Array.from({ length: 40 }, (_, i) => q('q' + i, { no: i + 1 }));
  const spec = {};
  questions.forEach((x) => { spec['s::' + x.id] = [0, 1, false]; });
  const r = Q.statsReport([{ id: 's', title: 'T', questions }], summaryOf(spec), 0.7);
  assert.strictEqual(r.weakList.length, 30);
  assert.strictEqual(r.total.weak, 40);
  assert.strictEqual(r.weakList[0].key, 's::q0');   // 同点は問題集の中の順
});

/* ===================== 問題集ごとに記録を消す（消去の印） ===================== */

const clr = (id, setId, at) => ({ id, kind: 'clear', setId, at });

test('消去の印: 印より前（同時刻を含む）の回答は数えず、後の回答は数える', () => {
  const log = [
    e('1', 's1::a', T(1), false),
    e('2', 's1::a', T(2), true),     // 印と同時刻 → 数えない
    clr('c1', 's1', T(2)),
    e('3', 's1::a', T(3), false),    // 印より後 → 数える
  ];
  assert.deepStrictEqual(Q.summarizeLog(log)['s1::a'],
    { attempts: 1, corrects: 0, wrongs: 1, rate: 0, last: 'wrong', lastAt: T(3) });
  assert.deepStrictEqual(Q.effectiveLog(log).map((x) => x.id), ['3']);
});

test('消去の印: ほかの問題集には影響しない（id の先頭が同じ問題集も別扱い）', () => {
  const log = [
    e('1', 's1::a', T(1), false),
    e('2', 's10::a', T(1), false),
    e('3', 's2::a', T(1), true),
    clr('c1', 's1', T(5)),
  ];
  const sum = Q.summarizeLog(log);
  assert.strictEqual(sum['s1::a'], undefined);
  assert.strictEqual(sum['s10::a'].attempts, 1);
  assert.strictEqual(sum['s2::a'].attempts, 1);
  assert.deepStrictEqual(Q.historySummary(sum), { answered: 2, wrong: 1, answers: 2 });
});

test('消去の印: 印が複数あれば最新のものを使う（並びに左右されない）', () => {
  const log = [
    clr('c2', 's1', T(4)),
    e('1', 's1::a', T(3), true),     // 古い印より後だが新しい印より前 → 数えない
    e('2', 's1::b', T(5), true),     // 最新の印より後 → 数える
    clr('c1', 's1', T(2)),
  ];
  const sum = Q.summarizeLog(log);
  assert.strictEqual(sum['s1::a'], undefined);
  assert.strictEqual(sum['s1::b'].attempts, 1);
});

test('countSetAnswers: 消したら数えなくなる件数（すでに消した分は含めない）', () => {
  const log = [
    e('1', 's1::a', T(1), true), e('2', 's1::b', T(2), false), e('3', 's2::a', T(2), false),
    clr('c1', 's1', T(1)),
  ];
  assert.strictEqual(Q.countSetAnswers(log, 's1'), 1);
  assert.strictEqual(Q.countSetAnswers(log, 's2'), 1);
  assert.strictEqual(Q.countSetAnswers(log, 'none'), 0);
});

test('removeSetPositions: その問題集の分だけ除く', () => {
  assert.deepStrictEqual(Q.removeSetPositions({ 's1::a': 1, 's1::b': 2, 's10::a': 3, 's2::a': 0 }, 's1'),
    { 's10::a': 3, 's2::a': 0 });
});

test('消去の印の和集合: もう一方の端末に印が伝わり、そちらの集計でも消える。何度読み込んでも1件', () => {
  // どちらの端末も消す前の同じ回答を持っている
  const shared = [e('d1', 's1::a', T(1), false), e('d2', 's1::b', T(1), true), e('d3', 's2::a', T(1), false)];
  const iphone = shared.concat([clr('c1', 's1', T(2))]);   // iPhone で s1 を消した
  const ipad = shared.concat([e('d4', 's1::a', T(3), true)]);   // iPad で印より後に解いた

  const merged = Q.unionLog(ipad, iphone);
  assert.deepStrictEqual(merged.added.map((x) => x.id), ['c1']);
  const sum = Q.summarizeLog(merged.log);
  assert.strictEqual(sum['s1::b'], undefined);
  assert.deepStrictEqual(sum['s1::a'], { attempts: 1, corrects: 1, wrongs: 0, rate: 1, last: 'correct', lastAt: T(3) });
  assert.strictEqual(sum['s2::a'].attempts, 1);

  const again = Q.unionLog(merged.log, iphone);
  assert.strictEqual(again.added.length, 0);
  assert.strictEqual(again.log.filter((x) => x.kind === 'clear').length, 1);
});

test('消去の印: 書き出しの log に印が入り、summary は印を反映する。読み込むと印の形のまま', () => {
  const sets = [{ id: 's1', title: 'T1', questions: [q('a')] }];
  const log = [e('1', 's1::a', T(1), false), clr('c1', 's1', T(2)), e('2', 's1::a', T(3), true)];
  const out = Q.buildHistoryExport(log, {}, sets, new Date(T(4)));
  assert.deepStrictEqual(out.log[1], { id: 'c1', kind: 'clear', setId: 's1', at: T(2) });
  assert.strictEqual(out.summary['s1::a'].attempts, 1);
  assert.strictEqual(Q.validateHistory(JSON.parse(JSON.stringify(out))).ok, true);
  assert.deepStrictEqual(Q.historyToLog(out)[1], { id: 'c1', kind: 'clear', setId: 's1', at: T(2) });
});

test('validateHistory: kind が clear の要素（setId・at 必須）を通し、不正を拒否する', () => {
  const wrap = (x) => Q.validateHistory({ format: 'yontaku-drill-history/2', log: [x] });
  assert.deepStrictEqual(wrap(clr('c1', 's1', T(1))), { ok: true, errors: [] });
  assert.match(wrap({ id: 'c1', kind: 'clear', at: T(1) }).errors[0], /setId/);
  assert.match(wrap({ id: 'c1', kind: 'clear', setId: 's1' }).errors[0], /at/);
  assert.match(wrap({ id: 'c1', kind: 'clear', setId: '', at: T(1) }).errors[0], /setId/);
  assert.match(wrap({ id: 'c1', kind: 'delete', setId: 's1', at: T(1) }).errors[0], /kind/);
  assert.match(wrap({ kind: 'clear', setId: 's1', at: T(1) }).errors[0], /id/);
});
