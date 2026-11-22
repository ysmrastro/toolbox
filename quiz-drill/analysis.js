/*
 * analysis.js — 4択ドリルの「分析」タブの集計（純粋関数）
 *
 * 【方針】quiz.js と同じく、引数だけで答えが決まるようにする（DOM・保存先・時計に触らない）。
 * 「いま」は必ず引数 now（Date）で受け取る。中で new Date() を呼ぶと、日をまたぐ場合を試せない。
 *
 * 日付は端末のローカル時刻の0時区切りで、'YYYY-MM-DD' の文字列（日の鍵）で扱う。
 * 日を進めるときは 86400000 ms を足さず、new Date(年, 月, 日 + n) で作る（夏時間のある地域でずれないように）。
 * 週は月曜始まり（今週の問題数・カレンダー・週ごとの正答率で同じにする）。
 *
 * 数え方は2通りある。混ぜないこと。
 *   - 実施した事実（サマリー・日別のグラフ・カレンダー・週ごとの正答率・マイルストーン）:
 *     消去の印を無視して、すべての回答を数える（practiceLog）。まぐれは不正解として数える
 *   - 成績（習熟度・問題集ごと・分類ごと）: 成績の画面と同じく、消去の印を反映する（quiz.js の summarizeLog・statsReport）
 */
var QD_ANALYSIS = (function () {
  'use strict';

  // ブラウザではグローバルの QD_QUIZ、Node（テスト）では require で読む
  var Q = typeof QD_QUIZ !== 'undefined' ? QD_QUIZ : require('./quiz.js');

  var RANGES = ['30', '90', '365', 'all'];
  var HEAT_WEEKS = 53;            // カレンダーの列の数（直近1年を必ず含む）
  var MASTERED_STREAK = 3;        // 定着: 直近この回数が連続で正解
  var MASTERED_RATE = 0.8;        // 定着: 正答率がこれ以上
  var MILESTONES = [
    { kind: 'total', target: 100 }, { kind: 'total', target: 500 }, { kind: 'total', target: 1000 },
    { kind: 'total', target: 2000 }, { kind: 'total', target: 5000 },
    { kind: 'streak', target: 3 }, { kind: 'streak', target: 7 }, { kind: 'streak', target: 14 }, { kind: 'streak', target: 30 },
    { kind: 'day', target: 50 }, { kind: 'day', target: 100 },
  ];

  /* ===================== 日付 ===================== */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** Date → その端末のローカルの日の鍵 'YYYY-MM-DD' */
  function dayKeyOf(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** ISO の日時 → ローカルの日の鍵 */
  function dayKey(iso) {
    return dayKeyOf(new Date(iso));
  }

  /** 日の鍵 → その日のローカルの0時の Date */
  function keyDate(key) {
    var p = key.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  /** 日の鍵に n 日足した鍵 */
  function addDays(key, n) {
    var d = keyDate(key);
    return dayKeyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  }

  /** その日を含む週の月曜の鍵 */
  function weekStart(key) {
    var dow = keyDate(key).getDay();   // 0=日
    return addDays(key, -((dow + 6) % 7));
  }

  /** from から to まで（両端を含む）の日の鍵の配列 */
  function dayRange(from, to) {
    var out = [];
    for (var k = from; k <= to; k = addDays(k, 1)) out.push(k);
    return out;
  }

  /* ===================== 実施した事実 ===================== */

  /**
   * 実施の数え方で使う回答だけを返す。消去の印は無視し（印より前の回答も数える）、印の要素そのものは除く。
   * まぐれとされた正解は ok: false の写しにする（quiz.js の effectiveLog に、消去の印を抜いたログを渡す）。
   */
  function practiceLog(log) {
    return Q.effectiveLog((log || []).filter(function (e) { return e && e.kind !== 'clear'; }));
  }

  /** 日の鍵 → { answers, corrects }。実施の数え方（消去の印を無視） */
  function dailyCounts(log) {
    var map = {};
    practiceLog(log).forEach(function (e) {
      var k = dayKey(e.at);
      var c = map[k] || (map[k] = { answers: 0, corrects: 0 });
      c.answers += 1;
      if (e.ok) c.corrects += 1;
    });
    return map;
  }

  function sortedDays(daily) {
    return Object.keys(daily).sort();
  }

  /**
   * 連続学習日数。今日解いていれば今日から、まだなら昨日からさかのぼって、続いている日数を数える。
   */
  function currentStreak(daily, now) {
    var k = dayKeyOf(now);
    if (!daily[k]) k = addDays(k, -1);
    var n = 0;
    while (daily[k]) { n += 1; k = addDays(k, -1); }
    return n;
  }

  /** サマリーカードの中身: 今日・今週（月曜から）・累計・連続日数・自己ベストの日（同数なら先に達した日） */
  function summaryCards(daily, now) {
    var today = dayKeyOf(now);
    var ws = weekStart(today);
    var res = { today: 0, week: 0, total: 0, streak: currentStreak(daily, now), best: null, days: 0 };
    sortedDays(daily).forEach(function (k) {
      var n = daily[k].answers;
      res.total += n;
      res.days += 1;
      if (k === today) res.today = n;
      if (k >= ws && k <= today) res.week += n;
      if (!res.best || n > res.best.count) res.best = { date: k, count: n };
    });
    return res;
  }

  /**
   * 期間の始まりの日の鍵。range は '30' | '90' | '365'（今日を含めてその日数）か 'all'（最初に解いた日から）。
   * 'all' で記録が無ければ 30日にする（枠を見せるため）。
   */
  function rangeStart(daily, range, now) {
    var today = dayKeyOf(now);
    if (range === 'all') {
      var days = sortedDays(daily);
      if (days.length && days[0] <= today) return days[0];
      range = '30';
    }
    var n = Number(range) > 0 ? Number(range) : 30;
    return addDays(today, -(n - 1));
  }

  /**
   * 日別の棒グラフと累計の折れ線の中身。
   * 返り値 { days: [{ date, answers, cum }], startCum, max, cumMax, active }。
   * cum は「始めてからの累計」（期間より前の分も含む）。startCum は期間の前日までの累計。
   * active は期間の中で解いた日の数（0なら案内文を出す）。
   */
  function dailySeries(daily, range, now) {
    var from = rangeStart(daily, range, now);
    var to = dayKeyOf(now);
    var startCum = 0;
    sortedDays(daily).forEach(function (k) { if (k < from) startCum += daily[k].answers; });
    var cum = startCum, max = 0, active = 0;
    var days = dayRange(from, to).map(function (k) {
      var n = daily[k] ? daily[k].answers : 0;
      cum += n;
      if (n > max) max = n;
      if (n > 0) active += 1;
      return { date: k, answers: n, cum: cum };
    });
    return { days: days, startCum: startCum, max: max, cumMax: cum, active: active };
  }

  /**
   * 週ごとの正答率。期間（dailySeries と同じ range）に掛かる週を月曜始まりで並べる。
   * 返り値 [{ week: 月曜の鍵, answers, corrects, rate（回答が無い週は null） }]。
   * 週の集計は期間の中の日だけを数える（期間の最初の週が途中から始まるときは、その分だけ）。
   */
  function weeklyAccuracy(daily, range, now) {
    var from = rangeStart(daily, range, now);
    var to = dayKeyOf(now);
    var weeks = [];
    var byWeek = {};
    for (var w = weekStart(from); w <= to; w = addDays(w, 7)) {
      byWeek[w] = { week: w, answers: 0, corrects: 0, rate: null };
      weeks.push(byWeek[w]);
    }
    sortedDays(daily).forEach(function (k) {
      if (k < from || k > to) return;
      var g = byWeek[weekStart(k)];
      g.answers += daily[k].answers;
      g.corrects += daily[k].corrects;
    });
    weeks.forEach(function (g) { if (g.answers > 0) g.rate = g.corrects / g.answers; });
    return weeks;
  }

  /**
   * 色の段階（0〜4）の区切り。解いた日の件数の 25・50・75 パーセンタイルで分ける。
   * 返り値 [t1, t2, t3]: 1〜t1 が段階1、〜t2 が2、〜t3 が3、それより多いと4。0件は段階0。
   */
  function heatThresholds(counts) {
    var v = counts.filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; });
    if (!v.length) return [1, 2, 3];
    var at = function (p) { return v[Math.min(v.length - 1, Math.floor(p * v.length))]; };
    var t1 = at(0.25), t2 = Math.max(t1 + 1, at(0.5)), t3 = Math.max(t2 + 1, at(0.75));
    return [t1, t2, t3];
  }

  function heatLevel(n, th) {
    if (!(n > 0)) return 0;
    if (n <= th[0]) return 1;
    if (n <= th[1]) return 2;
    if (n <= th[2]) return 3;
    return 4;
  }

  /**
   * カレンダー（直近1年）。列は週（月曜始まり）、行は曜日（0=月〜6=日）。最後の列が今週。
   * 返り値 { weeks: [[{ date, answers, level } | null（今日より後）] × 7], months: [{ col, month }],
   *          thresholds, total, from, to }。months は、その列に月の1日が入る列（最初の列は除く。ラベルが重なるため）。
   */
  function heatmap(daily, now, weeksCount) {
    var nw = weeksCount || HEAT_WEEKS;
    var today = dayKeyOf(now);
    var first = addDays(weekStart(today), -7 * (nw - 1));
    var days = dayRange(first, today);
    var th = heatThresholds(days.map(function (k) { return daily[k] ? daily[k].answers : 0; }));
    var weeks = [];
    var months = [];
    var total = 0;
    for (var c = 0; c < nw; c++) {
      var col = [];
      for (var r = 0; r < 7; r++) {
        var k = addDays(first, c * 7 + r);
        if (k > today) { col.push(null); continue; }
        var n = daily[k] ? daily[k].answers : 0;
        total += n;
        col.push({ date: k, answers: n, level: heatLevel(n, th) });
        if (c > 0 && k.slice(8) === '01') months.push({ col: c, month: Number(k.slice(5, 7)) });
      }
      weeks.push(col);
    }
    return { weeks: weeks, months: months, thresholds: th, total: total, from: first, to: today };
  }

  /* ===================== マイルストーン ===================== */

  /** 過去の最長の連続について、長さ target に初めて届いた日を返す（届いていなければ null） */
  function streakReachedOn(days, target) {
    var run = 0, prev = null;
    for (var i = 0; i < days.length; i++) {
      run = prev && addDays(prev, 1) === days[i] ? run + 1 : 1;
      prev = days[i];
      if (run >= target) return days[i];
    }
    return null;
  }

  /**
   * マイルストーン（バッジ）。返り値 { list: [{ kind, target, achieved, date }], next }。
   * total は累計の問題数、streak は連続の日数（過去の最長で判定。途切れても達成は消えない）、day は1日の問題数。
   * date は初めて届いた日。next は未達成の累計の目標のうち最小のもの { target, remaining }（すべて達成なら null）。
   */
  function milestones(daily) {
    var days = sortedDays(daily);
    var list = MILESTONES.map(function (m) {
      var date = null;
      if (m.kind === 'total') {
        var cum = 0;
        for (var i = 0; i < days.length && !date; i++) {
          cum += daily[days[i]].answers;
          if (cum >= m.target) date = days[i];
        }
      } else if (m.kind === 'streak') {
        date = streakReachedOn(days, m.target);
      } else {
        for (var j = 0; j < days.length && !date; j++) if (daily[days[j]].answers >= m.target) date = days[j];
      }
      return { kind: m.kind, target: m.target, achieved: !!date, date: date };
    });
    var total = days.reduce(function (n, k) { return n + daily[k].answers; }, 0);
    var next = null;
    list.forEach(function (m) {
      if (m.kind === 'total' && !m.achieved && !next) next = { target: m.target, remaining: m.target - total };
    });
    return { list: list, next: next };
  }

  /* ===================== 成績（消去の印を反映する） ===================== */

  /**
   * 問題ごとの直近の結果（新しい順の ok の配列）。消去の印とまぐれを反映する（effectiveLog）。
   * 同じ日時なら id の大きい方を後とみなす（summarizeLog と同じ）。
   */
  function recentResults(log) {
    var byKey = {};
    Q.effectiveLog(log || []).forEach(function (e) {
      (byKey[e.key] || (byKey[e.key] = [])).push(e);
    });
    var out = {};
    Object.keys(byKey).forEach(function (k) {
      out[k] = byKey[k].sort(function (a, b) {
        var d = Date.parse(b.at) - Date.parse(a.at);
        return d !== 0 ? d : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
      }).map(function (e) { return e.ok; });
    });
    return out;
  }

  /**
   * 習熟度の内訳。読み込んでいる問題集の問題だけを数える（statsReport と同じ）。
   *   未回答: 回答が無い（消去の印より前の回答は数えない）
   *   苦手: quiz.js の isWeak（成績の画面と同じ判定）
   *   定着: 苦手でなく、直近3回が連続で正解、かつ正答率が80%以上
   *   学習中: それ以外の、回答がある問題
   * 返り値 { total, unseen, weak, learning, mastered, answered, answeredRate（0〜1。問題が無ければ null） }。
   */
  function mastery(sets, log, threshold) {
    var th = threshold == null ? Q.DEFAULT_WEAK_THRESHOLD : threshold;
    var summary = Q.summarizeLog(log || []);
    var recent = recentResults(log);
    var res = { total: 0, unseen: 0, weak: 0, learning: 0, mastered: 0, answered: 0, answeredRate: null };
    sets.forEach(function (set) {
      Q.sequentialOrder(set).forEach(function (key) {
        res.total += 1;
        var s = summary[key];
        if (!s || !(s.attempts > 0)) { res.unseen += 1; return; }
        res.answered += 1;
        if (Q.isWeak(s, th)) { res.weak += 1; return; }
        var r = recent[key] || [];
        var streak = r.length >= MASTERED_STREAK && r.slice(0, MASTERED_STREAK).every(Boolean);
        if (streak && s.rate >= MASTERED_RATE) res.mastered += 1;
        else res.learning += 1;
      });
    });
    if (res.total > 0) res.answeredRate = res.answered / res.total;
    return res;
  }

  /**
   * 開始日付のフィルタの下限（ミリ秒）。choice は 'all' | 'month'（今月の1日）| '30'（今日を含めて30日）|
   * 'YYYY-MM-DD'（その日のローカルの0時）。'all' や不正な日付なら null（絞らない）。
   */
  function sinceMs(choice, now) {
    if (!choice || choice === 'all') return null;
    if (choice === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    if (choice === '30') return keyDate(addDays(dayKeyOf(now), -29)).getTime();
    return Q.wrongSinceMs({ type: 'since', date: choice }, now.getTime());
  }

  /**
   * 問題集ごと・分類ごとの実施数と正答率。消去の印を反映したうえで（statsReport と同じ）、
   * since（ミリ秒。null なら全期間）以降に答えた回答だけを数える。印の要素は日付で絞らない
   * （開始日より前に付けた消去の印も、成績の画面と同じく反映する）。
   * 返り値 { bySet: [{ id, title, questions, answered, answers, corrects, rate }],
   *          byCategory: [{ category（無ければ null）, ... }] }。どちらも回答数の多い順（同数は元の順）。
   */
  function breakdown(sets, log, since) {
    var filtered = (log || []).filter(function (e) {
      return e.kind !== undefined || since == null || Date.parse(e.at) >= since;
    });
    var r = Q.statsReport(sets, Q.summarizeLog(filtered), Q.DEFAULT_WEAK_THRESHOLD);
    var byAnswers = function (a, b) { return b.answers - a.answers; };
    var pick = function (g) {
      var out = { questions: g.questions, answered: g.answered, answers: g.answers, corrects: g.corrects, rate: g.rate };
      if ('id' in g) { out.id = g.id; out.title = g.title; } else out.category = g.category;
      return out;
    };
    return {
      bySet: r.bySet.map(pick).sort(byAnswers),
      byCategory: r.byCategory.map(pick).sort(byAnswers),
    };
  }

  return {
    RANGES: RANGES,
    MASTERED_STREAK: MASTERED_STREAK,
    MASTERED_RATE: MASTERED_RATE,
    dayKey: dayKey,
    dayKeyOf: dayKeyOf,
    keyDate: keyDate,
    addDays: addDays,
    weekStart: weekStart,
    practiceLog: practiceLog,
    dailyCounts: dailyCounts,
    currentStreak: currentStreak,
    summaryCards: summaryCards,
    rangeStart: rangeStart,
    dailySeries: dailySeries,
    weeklyAccuracy: weeklyAccuracy,
    heatThresholds: heatThresholds,
    heatLevel: heatLevel,
    heatmap: heatmap,
    milestones: milestones,
    recentResults: recentResults,
    mastery: mastery,
    sinceMs: sinceMs,
    breakdown: breakdown,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QD_ANALYSIS;
