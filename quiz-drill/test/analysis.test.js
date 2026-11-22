/*
 * analysis.test.js — 分析タブの集計（analysis.js）
 *
 * 日時はローカルの Date の API（new Date(年, 月, 日, 時, 分)）で作る。期待値もローカルの日付で書くので、
 * TZ=UTC でも TZ=Asia/Tokyo でも同じ結果になる。期待値はテストの中に直接書く。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const A = require('../analysis.js');

/** ローカルの日時の ISO 文字列（月は 1 始まりで書く） */
function at(y, m, d, h, min) {
  return new Date(y, m - 1, d, h || 0, min || 0).toISOString();
}

let seq = 0;
function ans(key, iso, ok) {
  seq += 1;
  return { id: 'dev:' + String(seq).padStart(5, '0'), key, at: iso, ok };
}
function clear(setId, iso) {
  seq += 1;
  return { id: 'dev:' + String(seq).padStart(5, '0'), kind: 'clear', setId, at: iso };
}
function lucky(ref, iso) {
  seq += 1;
  return { id: 'dev:' + String(seq).padStart(5, '0'), kind: 'lucky', ref, on: true, at: iso };
}

function set(id, n, cats) {
  return {
    id, title: '問題集' + id,
    questions: Array.from({ length: n }, (_, i) => Object.assign(
      { id: 'q' + (i + 1), question: '問', choices: ['あ', 'い'], answer: 1 },
      cats && cats[i] !== undefined ? { category: cats[i] } : {})),
  };
}

const NOW = new Date(2026, 10, 22, 21, 0);   // 2026-11-22（日）21:00

/* ===================== 日付 ===================== */

test('dayKey: ローカルの0時で区切る（23:59 と 翌0:01 は別の日）', () => {
  assert.strictEqual(A.dayKey(at(2026, 11, 21, 23, 59)), '2026-11-21');
  assert.strictEqual(A.dayKey(at(2026, 11, 22, 0, 1)), '2026-11-22');
});

test('addDays: 月・年をまたぐ', () => {
  assert.strictEqual(A.addDays('2026-11-30', 1), '2026-12-01');
  assert.strictEqual(A.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(A.addDays('2026-03-01', -1), '2026-02-28');
});

test('weekStart: 月曜始まり（日曜はその前の月曜の週）', () => {
  assert.strictEqual(A.weekStart('2026-11-22'), '2026-11-16');   // 日
  assert.strictEqual(A.weekStart('2026-11-16'), '2026-11-16');   // 月
  assert.strictEqual(A.weekStart('2026-11-17'), '2026-11-16');   // 火
});

/* ===================== 日別の集計 ===================== */

test('dailyCounts: 日ごとの回答数と正解数。日をまたぐ回答は別の日に入る', () => {
  const log = [
    ans('s::q1', at(2026, 11, 21, 23, 59), true),
    ans('s::q2', at(2026, 11, 22, 0, 1), false),
    ans('s::q1', at(2026, 11, 22, 9, 0), true),
  ];
  assert.deepStrictEqual(A.dailyCounts(log), {
    '2026-11-21': { answers: 1, corrects: 1 },
    '2026-11-22': { answers: 2, corrects: 1 },
  });
});

test('dailyCounts: 消去の印を無視して、印より前の回答も数える。印そのものは数えない', () => {
  const log = [
    ans('s::q1', at(2026, 11, 20, 10), true),
    clear('s', at(2026, 11, 21, 10)),
    ans('s::q1', at(2026, 11, 22, 10), true),
  ];
  assert.deepStrictEqual(A.dailyCounts(log), {
    '2026-11-20': { answers: 1, corrects: 1 },
    '2026-11-22': { answers: 1, corrects: 1 },
  });
});

test('dailyCounts: まぐれは不正解として数える。まぐれの印は回答に数えない', () => {
  const a = ans('s::q1', at(2026, 11, 22, 10), true);
  const log = [a, lucky(a.id, at(2026, 11, 22, 10, 1))];
  assert.deepStrictEqual(A.dailyCounts(log), { '2026-11-22': { answers: 1, corrects: 0 } });
});

test('dailyCounts: 空のログ', () => {
  assert.deepStrictEqual(A.dailyCounts([]), {});
  assert.deepStrictEqual(A.dailyCounts(undefined), {});
});

/* ===================== サマリー・連続日数 ===================== */

function dailyOf(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => { out[k] = { answers: obj[k], corrects: 0 }; });
  return out;
}

test('currentStreak: 今日解いていれば今日から数える', () => {
  const d = dailyOf({ '2026-11-20': 1, '2026-11-21': 2, '2026-11-22': 3 });
  assert.strictEqual(A.currentStreak(d, NOW), 3);
});

test('currentStreak: 今日まだ解いていなければ、昨日までの連続を数える', () => {
  const d = dailyOf({ '2026-11-19': 1, '2026-11-20': 1, '2026-11-21': 2 });
  assert.strictEqual(A.currentStreak(d, NOW), 3);
});

test('currentStreak: 昨日も解いていなければ0', () => {
  const d = dailyOf({ '2026-11-19': 1, '2026-11-20': 1 });
  assert.strictEqual(A.currentStreak(d, NOW), 0);
});

test('currentStreak: 月をまたいで続く', () => {
  const d = dailyOf({ '2026-10-31': 1, '2026-11-01': 1, '2026-11-02': 1 });
  assert.strictEqual(A.currentStreak(d, new Date(2026, 10, 2, 8)), 3);
});

test('currentStreak: 0時をまたいだ直後は、新しい日の「今日」はまだ0件', () => {
  const log = [ans('s::q1', at(2026, 11, 21, 23, 59), true)];
  const d = A.dailyCounts(log);
  const justAfter = new Date(2026, 10, 22, 0, 1);
  assert.strictEqual(A.currentStreak(d, justAfter), 1);
  assert.strictEqual(A.summaryCards(d, justAfter).today, 0);
});

test('summaryCards: 今日・今週（月曜から）・累計・自己ベスト（同数なら先の日）', () => {
  const d = dailyOf({
    '2026-11-15': 9,   // 先週の日曜（今週に入らない）
    '2026-11-16': 4,   // 今週の月曜
    '2026-11-20': 9,
    '2026-11-22': 5,
  });
  const s = A.summaryCards(d, NOW);
  assert.strictEqual(s.today, 5);
  assert.strictEqual(s.week, 18);
  assert.strictEqual(s.total, 27);
  assert.strictEqual(s.days, 4);
  assert.deepStrictEqual(s.best, { date: '2026-11-15', count: 9 });
  assert.strictEqual(s.streak, 1);   // 11/21 に解いていないので、今日の1日だけ
});

test('summaryCards: 空', () => {
  assert.deepStrictEqual(A.summaryCards({}, NOW), { today: 0, week: 0, total: 0, streak: 0, best: null, days: 0 });
});

/* ===================== 日別のグラフと累計 ===================== */

test('dailySeries: 30日は今日を含めて30日。累計は期間より前の分から始まる', () => {
  const d = dailyOf({ '2026-10-01': 7, '2026-10-24': 2, '2026-11-22': 3 });
  const s = A.dailySeries(d, '30', NOW);
  assert.strictEqual(s.days.length, 30);
  assert.strictEqual(s.days[0].date, '2026-10-24');
  assert.strictEqual(s.days[29].date, '2026-11-22');
  assert.strictEqual(s.startCum, 7);
  assert.strictEqual(s.days[0].cum, 9);
  assert.strictEqual(s.days[1].cum, 9);
  assert.strictEqual(s.days[29].cum, 12);
  assert.strictEqual(s.max, 3);
  assert.strictEqual(s.active, 2);
});

test('dailySeries: 期間の切り替え（90日・1年・すべて）', () => {
  const d = dailyOf({ '2025-06-01': 1, '2026-11-22': 1 });
  assert.strictEqual(A.dailySeries(d, '90', NOW).days.length, 90);
  assert.strictEqual(A.dailySeries(d, '90', NOW).days[0].date, '2026-08-25');
  const y = A.dailySeries(d, '365', NOW);
  assert.strictEqual(y.days.length, 365);
  assert.strictEqual(y.startCum, 1);
  const all = A.dailySeries(d, 'all', NOW);
  assert.strictEqual(all.days[0].date, '2025-06-01');
  assert.strictEqual(all.startCum, 0);
  assert.strictEqual(all.days[all.days.length - 1].cum, 2);
});

test('dailySeries: 期間の中に解いた日が無ければ active は0（案内文を出す）', () => {
  const d = dailyOf({ '2026-01-01': 5 });
  const s = A.dailySeries(d, '30', NOW);
  assert.strictEqual(s.active, 0);
  assert.strictEqual(s.startCum, 5);
  assert.strictEqual(s.days[29].cum, 5);
});

test('dailySeries: 記録が空で「すべて」なら30日の枠を返す', () => {
  const s = A.dailySeries({}, 'all', NOW);
  assert.strictEqual(s.days.length, 30);
  assert.strictEqual(s.active, 0);
  assert.strictEqual(s.cumMax, 0);
});

/* ===================== 週ごとの正答率 ===================== */

test('weeklyAccuracy: 月曜始まりの週ごと。回答の無い週は rate が null', () => {
  const d = {
    '2026-11-10': { answers: 4, corrects: 1 },   // 11/9 の週
    '2026-11-21': { answers: 2, corrects: 2 },   // 11/16 の週
    '2026-11-22': { answers: 2, corrects: 1 },   // 11/16 の週（日曜）
  };
  const w = A.weeklyAccuracy(d, '30', NOW);
  // 30日の始まりは 10/24（土）→ その週の月曜 10/19 から
  assert.strictEqual(w[0].week, '2026-10-19');
  assert.strictEqual(w[w.length - 1].week, '2026-11-16');
  const byWeek = Object.fromEntries(w.map((g) => [g.week, g]));
  assert.strictEqual(byWeek['2026-11-09'].rate, 0.25);
  assert.strictEqual(byWeek['2026-11-16'].answers, 4);
  assert.strictEqual(byWeek['2026-11-16'].rate, 0.75);
  assert.strictEqual(byWeek['2026-11-02'].rate, null);
});

test('weeklyAccuracy: 期間の始まりより前の日は、同じ週でも数えない', () => {
  const d = { '2026-10-19': { answers: 10, corrects: 0 }, '2026-10-24': { answers: 2, corrects: 2 } };
  const w = A.weeklyAccuracy(d, '30', NOW);
  assert.strictEqual(w[0].answers, 2);
  assert.strictEqual(w[0].rate, 1);
});

/* ===================== カレンダー ===================== */

test('heatmap: 53列×7行。最後の列が今週で、今日より後は null', () => {
  const h = A.heatmap(dailyOf({ '2026-11-22': 3 }), NOW);
  assert.strictEqual(h.weeks.length, 53);
  const last = h.weeks[52];
  assert.strictEqual(last[0].date, '2026-11-16');
  assert.strictEqual(last[6].date, '2026-11-22');
  assert.strictEqual(last[6].answers, 3);
  const mid = A.heatmap({}, new Date(2026, 10, 18, 12));   // 水曜
  assert.strictEqual(mid.weeks[52][2].date, '2026-11-18');
  assert.strictEqual(mid.weeks[52][3], null);
  assert.strictEqual(h.from, '2025-11-17');
});

test('heatmap: 月のラベルは月の1日が入る列', () => {
  const h = A.heatmap({}, NOW);
  const nov = h.months.find((m) => m.month === 11);
  assert.ok(h.weeks[nov.col].some((c) => c && c.date === '2026-11-01'));
  assert.strictEqual(h.months.length, 12);
});

test('heatThresholds / heatLevel: 解いた日の件数の四分位で5段階', () => {
  const th = A.heatThresholds([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(th, [3, 5, 7]);
  assert.strictEqual(A.heatLevel(0, th), 0);
  assert.strictEqual(A.heatLevel(1, th), 1);
  assert.strictEqual(A.heatLevel(3, th), 1);
  assert.strictEqual(A.heatLevel(4, th), 2);
  assert.strictEqual(A.heatLevel(7, th), 3);
  assert.strictEqual(A.heatLevel(8, th), 4);
  // 件数がそろっていても区切りは増えていく（段階が潰れない）
  assert.deepStrictEqual(A.heatThresholds([5, 5, 5]), [5, 6, 7]);
  assert.deepStrictEqual(A.heatThresholds([]), [1, 2, 3]);
});

/* ===================== マイルストーン ===================== */

test('milestones: 累計・1日の問題数は初めて届いた日。次の目標までの残り', () => {
  const d = dailyOf({ '2026-11-01': 60, '2026-11-02': 45, '2026-11-03': 120 });
  const m = A.milestones(d);
  const get = (kind, t) => m.list.find((x) => x.kind === kind && x.target === t);
  assert.strictEqual(get('total', 100).date, '2026-11-02');
  assert.strictEqual(get('total', 500).achieved, false);
  assert.strictEqual(get('day', 50).date, '2026-11-01');
  assert.strictEqual(get('day', 100).date, '2026-11-03');
  assert.strictEqual(get('streak', 3).date, '2026-11-03');
  assert.deepStrictEqual(m.next, { target: 500, remaining: 275 });
});

test('milestones: 連続は過去の最長で判定（途切れても達成は消えない）', () => {
  const d = dailyOf({ '2026-10-01': 1, '2026-10-02': 1, '2026-10-03': 1, '2026-10-10': 1 });
  const m = A.milestones(d);
  const s3 = m.list.find((x) => x.kind === 'streak' && x.target === 3);
  const s7 = m.list.find((x) => x.kind === 'streak' && x.target === 7);
  assert.strictEqual(s3.date, '2026-10-03');
  assert.strictEqual(s7.achieved, false);
});

test('milestones: 空の記録は何も達成していない。次は100問', () => {
  const m = A.milestones({});
  assert.ok(m.list.every((x) => !x.achieved));
  assert.deepStrictEqual(m.next, { target: 100, remaining: 100 });
});

/* ===================== 習熟度 ===================== */

test('mastery: 未回答・苦手・学習中・定着に分ける', () => {
  const sets = [set('s', 5)];
  const t = (d, h) => at(2026, 11, d, h);
  const log = [
    // q1: 3連続正解・正答率100% → 定着
    ans('s::q1', t(1, 9), true), ans('s::q1', t(2, 9), true), ans('s::q1', t(3, 9), true),
    // q2: 最後が不正解 → 苦手
    ans('s::q2', t(1, 9), true), ans('s::q2', t(2, 9), false),
    // q3: 正解2回だけ（直近3回に届かない）→ 学習中
    ans('s::q3', t(1, 9), true), ans('s::q3', t(2, 9), true),
    // q4: 直近3回は正解だが正答率 3/4=75% → 学習中（苦手でもない: 75% ≥ 70%）
    ans('s::q4', t(1, 9), false), ans('s::q4', t(2, 9), true), ans('s::q4', t(3, 9), true), ans('s::q4', t(4, 9), true),
    // q5: 未回答
  ];
  const m = A.mastery(sets, log);
  assert.deepStrictEqual(m, { total: 5, unseen: 1, weak: 1, learning: 2, mastered: 1, answered: 4, answeredRate: 0.8 });
});

test('mastery: 消去の印より前の回答は数えない（未回答に戻る）', () => {
  const sets = [set('s', 2)];
  const log = [
    ans('s::q1', at(2026, 11, 1, 9), true), ans('s::q1', at(2026, 11, 2, 9), true), ans('s::q1', at(2026, 11, 3, 9), true),
    clear('s', at(2026, 11, 4, 9)),
    ans('s::q2', at(2026, 11, 5, 9), false),
  ];
  const m = A.mastery(sets, log);
  assert.strictEqual(m.unseen, 1);
  assert.strictEqual(m.weak, 1);
  assert.strictEqual(m.mastered, 0);
});

test('mastery: まぐれは不正解として数える（直近3回の連続が切れる）', () => {
  const sets = [set('s', 1)];
  const a = ans('s::q1', at(2026, 11, 3, 9), true);
  const log = [ans('s::q1', at(2026, 11, 1, 9), true), ans('s::q1', at(2026, 11, 2, 9), true), a, lucky(a.id, at(2026, 11, 3, 10))];
  const m = A.mastery(sets, log);
  assert.strictEqual(m.mastered, 0);
  assert.strictEqual(m.weak, 1);   // 最後がまぐれ＝不正解
});

test('mastery: 読み込んでいない問題集の回答は数えない。問題が無ければ answeredRate は null', () => {
  const log = [ans('other::q1', at(2026, 11, 1, 9), true)];
  assert.strictEqual(A.mastery([set('s', 2)], log).unseen, 2);
  assert.strictEqual(A.mastery([], log).answeredRate, null);
});

/* ===================== 問題集ごと・分類ごと ===================== */

test('sinceMs: 今月・30日・日付・全期間', () => {
  assert.strictEqual(A.sinceMs('all', NOW), null);
  assert.strictEqual(A.sinceMs('', NOW), null);
  assert.strictEqual(A.sinceMs('month', NOW), new Date(2026, 10, 1).getTime());
  assert.strictEqual(A.sinceMs('30', NOW), new Date(2026, 9, 24).getTime());
  assert.strictEqual(A.sinceMs('2026-11-05', NOW), new Date(2026, 10, 5).getTime());
  assert.strictEqual(A.sinceMs('2026-02-30', NOW), null);
});

test('breakdown: 実施数の多い順。消去の印を反映し、開始日以降だけを数える', () => {
  const sets = [set('a', 3, ['地理', '歴史', '地理']), set('b', 2, ['歴史'])];   // b の q2 は分類なし
  const log = [
    ans('a::q1', at(2026, 11, 1, 9), true),
    ans('a::q2', at(2026, 11, 10, 9), false),
    ans('b::q1', at(2026, 11, 10, 9), true),
    ans('b::q1', at(2026, 11, 11, 9), true),
    ans('b::q2', at(2026, 11, 12, 9), false),
    clear('a', at(2026, 11, 5, 9)),   // a の 11/1 の回答は数えない
  ];
  const all = A.breakdown(sets, log, null);
  assert.deepStrictEqual(all.bySet.map((g) => [g.id, g.answers, g.answered, g.questions, g.rate]), [
    ['b', 3, 2, 2, 2 / 3],
    ['a', 1, 1, 3, 0],
  ]);
  assert.deepStrictEqual(all.byCategory.map((g) => [g.category, g.answers]), [['歴史', 3], [null, 1], ['地理', 0]]);

  const since = A.breakdown(sets, log, new Date(2026, 10, 11).getTime());
  assert.deepStrictEqual(since.bySet.map((g) => [g.id, g.answers]), [['b', 2], ['a', 0]]);
  assert.strictEqual(since.bySet[1].rate, null);
});

test('breakdown: 開始日より前に付けた消去の印も反映する', () => {
  const sets = [set('a', 1)];
  const log = [ans('a::q1', at(2026, 11, 20, 9), true), clear('a', at(2026, 11, 20, 10)), ans('a::q1', at(2026, 11, 21, 9), false)];
  const r = A.breakdown(sets, log, new Date(2026, 10, 21).getTime());
  assert.strictEqual(r.bySet[0].answers, 1);
  assert.strictEqual(r.bySet[0].rate, 0);
  const r2 = A.breakdown(sets, log, new Date(2026, 10, 1).getTime());
  assert.strictEqual(r2.bySet[0].answers, 1);   // 印より前の 11/20 9:00 は数えない
});

test('breakdown: 空のログ', () => {
  const r = A.breakdown([set('a', 2)], [], null);
  assert.strictEqual(r.bySet[0].answers, 0);
  assert.strictEqual(r.bySet[0].rate, null);
});
