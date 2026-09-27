/*
 * quiz.js — 4択ドリルの純粋な処理
 *
 * 【方針】ここに置く関数は**引数だけで答えが決まる**ようにする（DOM・保存先・時計に触らない）。
 * 乱数も引数 rand（0以上1未満を返す関数）で受け取る。テストで決まった並びを作って確かめるため。
 * app.js は DOM に結び付いた1枚のクロージャで外から呼べないので、計算はここに置く。
 *
 * 選択肢の番号は2種類ある。混ぜないこと。
 *   - 元の番号（original）: ファイルの choices の並び。answer / answers はこちらの 1 始まり
 *   - 表示位置（display） : 画面で並べ替えた後の並び
 * このファイルの中では両方とも 0 始まりの添字で扱い、1 始まりにするのは入口（answer の解釈）と
 * 画面の表示だけにする。
 */
var QD_QUIZ = (function () {
  'use strict';

  var FORMAT = 'yontaku-drill/1';

  /* ===================== 検証 ===================== */

  function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim() !== '';
  }

  function isId(v) {
    return isNonEmptyString(v) || (typeof v === 'number' && isFinite(v));
  }

  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  /** 任意項目の型を確かめる。問題があればメッセージを返す */
  function optionalErrors(q) {
    var errs = [];
    if (q.no !== undefined && !isInt(q.no)) errs.push('no は整数で書いてください');
    if (q.points !== undefined && !(typeof q.points === 'number' && isFinite(q.points) && q.points > 0)) {
      errs.push('points は正の数で書いてください');
    }
    ['category', 'explanation', 'supplement', 'image', 'imageAlt'].forEach(function (k) {
      if (q[k] !== undefined && typeof q[k] !== 'string') errs.push(k + ' は文字列で書いてください');
    });
    if (q.tags !== undefined && !(Array.isArray(q.tags) && q.tags.every(isNonEmptyString))) {
      errs.push('tags は文字列の配列で書いてください');
    }
    if (q.fixedOrder !== undefined && typeof q.fixedOrder !== 'boolean') {
      errs.push('fixedOrder は true か false で書いてください');
    }
    return errs;
  }

  function questionErrors(q) {
    if (!q || typeof q !== 'object') return ['問題がオブジェクトではありません'];
    var errs = [];
    if (!isId(q.id)) errs.push('id がありません');
    if (!isNonEmptyString(q.question)) errs.push('question（問題文）がありません');

    var n = Array.isArray(q.choices) ? q.choices.length : 0;
    if (!Array.isArray(q.choices) || n < 2) {
      errs.push('choices（選択肢）が2個以上ありません');
    } else if (!q.choices.every(isNonEmptyString)) {
      errs.push('choices に空の選択肢があります');
    }

    // 正解は answer と answers のどちらか一方があればよい（両方あれば answers を使う）
    if (q.answer === undefined && q.answers === undefined) {
      errs.push('answer または answers（正解の番号）がありません');
    } else if (q.answer !== undefined) {
      if (!isInt(q.answer)) {
        errs.push('answer は正解の番号（整数）で書いてください');
      } else if (n >= 2 && (q.answer < 1 || q.answer > n)) {
        errs.push('answer が選択肢の範囲外です（1〜' + n + '）');
      }
    }

    if (q.answers !== undefined) {
      if (!Array.isArray(q.answers) || q.answers.length === 0 || !q.answers.every(isInt)) {
        errs.push('answers は正解の番号の配列で書いてください');
      } else if (n >= 2 && q.answers.some(function (a) { return a < 1 || a > n; })) {
        errs.push('answers に選択肢の範囲外の番号があります（1〜' + n + '）');
      }
    }
    return errs.concat(optionalErrors(q));
  }

  /**
   * 問題ファイル（JSON を解釈したもの）を検証する。
   * 返り値 { ok, errors: [文字列], sets }。ok でなければ sets は空。
   * errors はどの問題集の何問目（id）の何が悪いかを1行ずつ書いたもの。
   */
  function validateFile(data) {
    var errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, errors: ['問題ファイルの形式ではありません'], sets: [] };
    }
    if (data.format !== FORMAT) {
      return {
        ok: false,
        errors: ['format が "' + FORMAT + '" ではありません（' + JSON.stringify(data.format) + '）'],
        sets: [],
      };
    }
    if (!Array.isArray(data.sets) || data.sets.length === 0) {
      return { ok: false, errors: ['sets（問題集）がありません'], sets: [] };
    }

    var setIds = {};
    data.sets.forEach(function (set, si) {
      var where = (si + 1) + '番目の問題集';
      if (!set || typeof set !== 'object') {
        errors.push(where + ': 問題集がオブジェクトではありません');
        return;
      }
      if (isNonEmptyString(set.title)) where = '問題集「' + set.title + '」';

      if (!isNonEmptyString(set.id)) {
        errors.push(where + ': id がありません');
      } else if (setIds[set.id]) {
        errors.push(where + ': 問題集の id「' + set.id + '」が重複しています');
      } else {
        setIds[set.id] = true;
      }
      if (!isNonEmptyString(set.title)) errors.push(where + ': title（表示名）がありません');

      if (!Array.isArray(set.questions) || set.questions.length === 0) {
        errors.push(where + ': questions（問題）がありません');
        return;
      }

      var qIds = {};
      set.questions.forEach(function (q, qi) {
        var qWhere = where + 'の ' + (qi + 1) + ' 問目' +
          (q && isId(q.id) ? '（id: ' + q.id + '）' : '');
        questionErrors(q).forEach(function (e) { errors.push(qWhere + ': ' + e); });
        if (q && isId(q.id)) {
          var key = String(q.id);
          if (qIds[key]) errors.push(qWhere + ': 問題の id が重複しています');
          qIds[key] = true;
        }
      });
    });

    return errors.length
      ? { ok: false, errors: errors, sets: [] }
      : { ok: true, errors: [], sets: data.sets };
  }

  /* ===================== 統合 ===================== */

  /**
   * 読み込み済みの問題集に新しい問題集を足す。同じ id は置き換え（位置はそのまま）、違う id は末尾に追加。
   * 返り値 { sets, added: [id], replaced: [id] }。引数は書き換えない。
   */
  function mergeSets(existing, incoming) {
    var sets = existing.slice();
    var added = [];
    var replaced = [];
    incoming.forEach(function (set) {
      var i = -1;
      for (var k = 0; k < sets.length; k++) {
        if (sets[k].id === set.id) { i = k; break; }
      }
      if (i >= 0) {
        sets[i] = set;
        if (replaced.indexOf(set.id) < 0 && added.indexOf(set.id) < 0) replaced.push(set.id);
      } else {
        sets.push(set);
        added.push(set.id);
      }
    });
    return { sets: sets, added: added, replaced: replaced };
  }

  /* ===================== 出題順 ===================== */

  /** 問題を指す鍵。問題の id は問題集の中でしか一意でないので、問題集の id と組にする */
  function questionKey(setId, questionId) {
    return setId + '::' + String(questionId);
  }

  /** 鍵 → { set, question, index } の表を作る */
  function indexSets(sets) {
    var map = {};
    sets.forEach(function (set) {
      set.questions.forEach(function (q, i) {
        map[questionKey(set.id, q.id)] = { set: set, question: q, index: i };
      });
    });
    return map;
  }

  /** Fisher–Yates。新しい配列を返す */
  function shuffle(list, rand) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** 通し: no の順（no が無い問題は配列の位置で並べる。同じ no なら配列順） */
  function sequentialOrder(set) {
    return set.questions
      .map(function (q, i) { return { q: q, i: i, no: q.no !== undefined ? q.no : Infinity }; })
      .sort(function (a, b) { return a.no - b.no || a.i - b.i; })
      .map(function (e) { return questionKey(set.id, e.q.id); });
  }

  /** 問題集の中でランダム */
  function randomOrder(set, rand) {
    return shuffle(sequentialOrder(set), rand);
  }

  /** 全問題からランダム。count が null か全問より多ければ全問 */
  function allRandomOrder(sets, count, rand) {
    var keys = [];
    sets.forEach(function (set) { keys = keys.concat(sequentialOrder(set)); });
    var a = shuffle(keys, rand);
    return count == null ? a : a.slice(0, count);
  }

  /* ===================== 絞り込み =====================
   * 絞り込みは「問題集の問題を減らした写し」を作る形にする。出題順の関数（通し・ランダム）は
   * そのまま使え、どの出題方法にも同じように効く。
   */

  /** 読み込んだ問題に出てくるタグ（最初に出てきた順・重複なし） */
  function collectTags(sets) {
    var tags = [];
    sets.forEach(function (set) {
      set.questions.forEach(function (q) {
        (q.tags || []).forEach(function (t) {
          if (tags.indexOf(t) < 0) tags.push(t);
        });
      });
    });
    return tags;
  }

  /**
   * filter: { type: 'all' } / { type: 'only', tag } / { type: 'exclude', tag }。
   * タグの無い問題は「だけ」には入らず、「除く」には入る。
   */
  function matchesFilter(question, filter) {
    if (!filter || filter.type === 'all') return true;
    var has = Array.isArray(question.tags) && question.tags.indexOf(filter.tag) >= 0;
    if (filter.type === 'only') return has;
    if (filter.type === 'exclude') return !has;
    return true;
  }

  /** 問題を条件で絞った問題集の写しを返す。0問になった問題集は落とす。引数は書き換えない */
  function selectQuestions(sets, pred) {
    return sets
      .map(function (set) {
        var qs = set.questions.filter(function (q) { return pred(set, q); });
        return Object.assign({}, set, { questions: qs });
      })
      .filter(function (set) { return set.questions.length > 0; });
  }

  function filterSets(sets, filter) {
    return selectQuestions(sets, function (set, q) { return matchesFilter(q, filter); });
  }

  /**
   * 前に間違えた問題: 成績の記録で「最後に解いたとき不正解」だった問題だけに絞る。
   * stats は updateStats() で作ったもの（鍵 → { last: 'correct' | 'wrong', ... }）。
   */
  function filterWrong(sets, stats) {
    return selectQuestions(sets, function (set, q) {
      var st = stats[questionKey(set.id, q.id)];
      return !!st && st.last === 'wrong';
    });
  }

  /** 問題集の問題数の合計 */
  function countQuestions(sets) {
    return sets.reduce(function (n, set) { return n + set.questions.length; }, 0);
  }

  /* ===================== 選択肢と正誤 ===================== */

  /**
   * 表示順を作る。返り値は「表示位置 → 元の添字」の配列（0 始まり）。
   * fixedOrder の問題は並べ替えない（選択肢が画像の中の番号を指す問題など）。
   *
   * prevPos は、前回この問題を表示したときの代表の正解（correctIndices の先頭）の表示位置。
   * 渡されたら、代表の正解を**それ以外の位置**に置く。完全な無作為だと 1/選択肢数 の確率で
   * 前回と同じ位置に正解が来て、番号で覚えてしまうため。
   * 作り方: 代表の正解の位置を prevPos 以外から無作為に選び、残りの選択肢を残りの位置に
   * 無作為に並べる。prevPos が無い（範囲外を含む）ときは今までどおり全体を無作為に並べる。
   */
  function choiceOrder(question, rand, prevPos) {
    var n = question.choices.length;
    var identity = question.choices.map(function (_, i) { return i; });
    if (question.fixedOrder) return identity;
    if (!isInt(prevPos) || prevPos < 0 || prevPos >= n || n < 2) return shuffle(identity, rand);

    var main = correctIndices(question)[0];
    var free = identity.filter(function (i) { return i !== prevPos; });   // 正解を置ける位置
    var pos = free[Math.floor(rand() * free.length)];
    var rest = shuffle(identity.filter(function (i) { return i !== main; }), rand);
    var order = [];
    for (var d = 0, k = 0; d < n; d++) order.push(d === pos ? main : rest[k++]);
    return order;
  }

  /** 表示順の中で代表の正解が置かれた位置（次回の choiceOrder に渡す値） */
  function correctPosition(question, order) {
    return order.indexOf(correctIndices(question)[0]);
  }

  /** 正解の元の添字（0 始まり）。answers があればそのどれでも正解 */
  function correctIndices(question) {
    var list = Array.isArray(question.answers) ? question.answers : [question.answer];
    return list.map(function (n) { return n - 1; });
  }

  function isCorrectOriginal(question, originalIndex) {
    return correctIndices(question).indexOf(originalIndex) >= 0;
  }

  /** 表示位置で選んだものを元の添字に戻して判定する */
  function judge(question, order, displayIndex) {
    var original = order[displayIndex];
    return { original: original, correct: isCorrectOriginal(question, original) };
  }

  /* ===================== 採点・表示用の値 ===================== */

  /**
   * results: [{ question, correct }]。points の無い問題は1点として数える。
   * hasPoints は points の付いた問題が1問でもあるか（得点を画面に出すかどうか）。
   */
  function score(results) {
    var s = { correct: 0, total: results.length, points: 0, maxPoints: 0, hasPoints: false };
    results.forEach(function (r) {
      var p = r.question.points !== undefined ? r.question.points : 1;
      if (r.question.points !== undefined) s.hasPoints = true;
      s.maxPoints += p;
      if (r.correct) { s.correct += 1; s.points += p; }
    });
    return s;
  }

  /** 「第11回 問5」の形。no が無ければ問題集の中の位置（1 始まり）を使う */
  function questionLabel(set, question, index) {
    var no = question.no !== undefined ? question.no : index + 1;
    return set.title + ' 問' + no;
  }

  /** 丸付き数字（①〜⑳）。それより大きい番号は (21) の形 */
  function circled(n) {
    return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : '(' + n + ')';
  }

  /** 問題文の冒頭（改行は空白にし、長ければ … で切る） */
  function excerpt(text, max) {
    var s = String(text).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  /**
   * 問題ごとの成績を1件更新する。now は ISO 文字列など、呼び出し側が渡す。
   * 返り値は新しいオブジェクト（引数は書き換えない）。
   */
  function updateStats(stats, key, correct, now) {
    var next = Object.assign({}, stats);
    var prev = stats[key] || { attempts: 0, corrects: 0 };
    next[key] = {
      attempts: prev.attempts + 1,
      corrects: prev.corrects + (correct ? 1 : 0),
      last: correct ? 'correct' : 'wrong',
      lastAt: now,
    };
    return next;
  }

  /* ===================== 学習の記録の書き出し・読み込み =====================
   * 記録は「成績（stats）」と「前回の正解の表示位置（positions）」の2つ。どちらも鍵は
   * 「問題集id::問題id」。書き出すファイルには問題文などの中身を入れない（ID と数値と日時だけ）。
   */

  var HISTORY_FORMAT = 'yontaku-drill-history/1';
  var RECORD_FIELDS = ['attempts', 'corrects', 'last', 'lastAt'];

  function isCount(v) {
    return isInt(v) && v >= 0;
  }

  /** 成績の記録1件から、アプリが使う項目だけを取り出す（分析用に足した項目は落とす） */
  function coreRecord(r) {
    var out = {};
    RECORD_FIELDS.forEach(function (k) { out[k] = r[k]; });
    return out;
  }

  /**
   * 書き出す中身を作る。now は Date。
   * 分析しやすいよう、問題集が読み込まれている記録には問題集の表示名・問番号・分類・タグを添える
   * （読み込むときは無視する）。問番号は no が無ければ問題集の中の位置（1 始まり）。
   */
  function buildHistoryExport(stats, positions, sets, now) {
    var index = indexSets(sets);
    var history = {};
    Object.keys(stats).forEach(function (key) {
      var rec = coreRecord(stats[key]);
      var e = index[key];
      if (e) {
        rec.setTitle = e.set.title;
        rec.no = e.question.no !== undefined ? e.question.no : e.index + 1;
        if (e.question.category !== undefined) rec.category = e.question.category;
        if (e.question.tags !== undefined) rec.tags = e.question.tags.slice();
      }
      history[key] = rec;
    });
    return {
      format: HISTORY_FORMAT,
      exportedAt: now.toISOString(),
      history: history,
      positions: Object.assign({}, positions),
    };
  }

  /** 書き出すファイル名。端末の時刻で quiz-drill-記録-YYYYMMDD-HHMM.json */
  function historyFileName(now) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'quiz-drill-記録-' + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) +
      '-' + p(now.getHours()) + p(now.getMinutes()) + '.json';
  }

  /** 記録のファイルを検証する。返り値 { ok, errors } */
  function validateHistory(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, errors: ['学習の記録のファイルではありません'] };
    }
    if (data.format !== HISTORY_FORMAT) {
      return { ok: false, errors: ['format が "' + HISTORY_FORMAT + '" ではありません（' + JSON.stringify(data.format) + '）'] };
    }
    var h = data.history;
    if (!h || typeof h !== 'object' || Array.isArray(h)) {
      return { ok: false, errors: ['history がオブジェクトではありません'] };
    }
    var errors = [];
    Object.keys(h).forEach(function (key) {
      var r = h[key];
      var where = '記録「' + key + '」: ';
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        errors.push(where + 'オブジェクトではありません');
        return;
      }
      if (!isCount(r.attempts)) errors.push(where + 'attempts は0以上の整数で書いてください');
      if (!isCount(r.corrects)) errors.push(where + 'corrects は0以上の整数で書いてください');
      else if (isCount(r.attempts) && r.corrects > r.attempts) errors.push(where + 'corrects が attempts より多くなっています');
      if (r.last !== 'correct' && r.last !== 'wrong') errors.push(where + 'last は "correct" か "wrong" で書いてください');
      if (typeof r.lastAt !== 'string' || isNaN(Date.parse(r.lastAt))) errors.push(where + 'lastAt が日時ではありません');
    });
    if (data.positions !== undefined) {
      var p = data.positions;
      if (!p || typeof p !== 'object' || Array.isArray(p)) {
        errors.push('positions がオブジェクトではありません');
      } else {
        Object.keys(p).forEach(function (key) {
          if (!isCount(p[key])) errors.push('positions「' + key + '」: 0以上の整数で書いてください');
        });
      }
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /**
   * 今の端末の記録に、読み込んだ記録を統合する。二重に数えないよう回数は足さない。
   *   - 鍵ごとに、最後に解いた日時（lastAt）が新しい方の記録を丸ごと採る。同じ日時なら今の端末を残す
   *   - 今の端末にない鍵は追加する
   *   - positions は、history で採った側の値を使う。採った側に値が無ければもう一方の値を残す。
   *     history にない鍵の positions は、今の端末に無いときだけ追加する
   * 返り値 { stats, positions, added, updated, unchanged }（件数は history の鍵で数える）。引数は書き換えない。
   */
  function mergeHistory(curStats, curPos, inStats, inPos) {
    var stats = Object.assign({}, curStats);
    var positions = Object.assign({}, curPos);
    var incomingPos = inPos || {};
    var added = 0, updated = 0, unchanged = 0;

    Object.keys(inStats).forEach(function (key) {
      var mine = curStats[key];
      var theirs = coreRecord(inStats[key]);
      var takeTheirs;
      if (!mine) {
        added += 1;
        takeTheirs = true;
      } else if (Date.parse(theirs.lastAt) > Date.parse(mine.lastAt)) {
        updated += 1;
        takeTheirs = true;
      } else {
        unchanged += 1;
        takeTheirs = false;
      }
      if (takeTheirs) {
        stats[key] = theirs;
        if (incomingPos[key] !== undefined) positions[key] = incomingPos[key];
      } else if (positions[key] === undefined && incomingPos[key] !== undefined) {
        positions[key] = incomingPos[key];
      }
    });

    Object.keys(incomingPos).forEach(function (key) {
      if (inStats[key] === undefined && positions[key] === undefined) positions[key] = incomingPos[key];
    });

    return { stats: stats, positions: positions, added: added, updated: updated, unchanged: unchanged };
  }

  /** 記録の概要: 解いた問題の数と、最後に不正解だった問題の数（読み込んでいない問題集の分も含む） */
  function historySummary(stats) {
    var keys = Object.keys(stats);
    return {
      answered: keys.length,
      wrong: keys.filter(function (k) { return stats[k].last === 'wrong'; }).length,
    };
  }

  return {
    FORMAT: FORMAT,
    HISTORY_FORMAT: HISTORY_FORMAT,
    buildHistoryExport: buildHistoryExport,
    historyFileName: historyFileName,
    validateHistory: validateHistory,
    mergeHistory: mergeHistory,
    historySummary: historySummary,
    validateFile: validateFile,
    mergeSets: mergeSets,
    questionKey: questionKey,
    indexSets: indexSets,
    shuffle: shuffle,
    sequentialOrder: sequentialOrder,
    randomOrder: randomOrder,
    allRandomOrder: allRandomOrder,
    collectTags: collectTags,
    matchesFilter: matchesFilter,
    filterSets: filterSets,
    filterWrong: filterWrong,
    countQuestions: countQuestions,
    choiceOrder: choiceOrder,
    correctPosition: correctPosition,
    correctIndices: correctIndices,
    isCorrectOriginal: isCorrectOriginal,
    judge: judge,
    score: score,
    questionLabel: questionLabel,
    circled: circled,
    excerpt: excerpt,
    updateStats: updateStats,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QD_QUIZ;
