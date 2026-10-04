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

  /* ===================== 自作テキスト ===================== */

  var TEXT_FORMAT = 'yontaku-text/1';

  /**
   * 自作テキストのファイル（公式や単位の換算などをまとめたもの）を検証する。
   * 形は { format, texts: [{ id, title, sections: [{ title, note?, items: [{ term, value, note? }] }] }] }。
   * 返り値 { ok, errors: [文字列], texts }。誤りが1つでもあれば ok は false。
   */
  function validateTextFile(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, errors: ['テキストファイルの形式ではありません'], texts: [] };
    }
    if (data.format !== TEXT_FORMAT) {
      return {
        ok: false,
        errors: ['format が "' + TEXT_FORMAT + '" ではありません（' + JSON.stringify(data.format) + '）'],
        texts: [],
      };
    }
    if (!Array.isArray(data.texts) || data.texts.length === 0) {
      return { ok: false, errors: ['texts（テキスト）がありません'], texts: [] };
    }
    var errors = [];
    var ids = {};
    data.texts.forEach(function (text, ti) {
      var where = (ti + 1) + '番目のテキスト';
      if (!text || typeof text !== 'object') {
        errors.push(where + ': テキストがオブジェクトではありません');
        return;
      }
      if (isNonEmptyString(text.title)) where = 'テキスト「' + text.title + '」';
      if (!isNonEmptyString(text.id)) {
        errors.push(where + ': id がありません');
      } else if (ids[text.id]) {
        errors.push(where + ': テキストの id「' + text.id + '」が重複しています');
      } else {
        ids[text.id] = true;
      }
      if (!isNonEmptyString(text.title)) errors.push(where + ': title（表示名）がありません');
      if (!Array.isArray(text.sections) || text.sections.length === 0) {
        errors.push(where + ': sections（節）がありません');
        return;
      }
      text.sections.forEach(function (sec, si) {
        var sWhere = where + ' の' + (si + 1) + '番目の節';
        if (!sec || typeof sec !== 'object') {
          errors.push(sWhere + ': 節がオブジェクトではありません');
          return;
        }
        if (!isNonEmptyString(sec.title)) errors.push(sWhere + ': title（見出し）がありません');
        else sWhere = where + ' の節「' + sec.title + '」';
        if (sec.note !== undefined && typeof sec.note !== 'string') errors.push(sWhere + ': note は文字列にしてください');
        if (!Array.isArray(sec.items) || sec.items.length === 0) {
          errors.push(sWhere + ': items（項目）がありません');
          return;
        }
        sec.items.forEach(function (item, ii) {
          var iWhere = sWhere + ' の' + (ii + 1) + '番目の項目';
          if (!item || typeof item !== 'object') {
            errors.push(iWhere + ': 項目がオブジェクトではありません');
            return;
          }
          if (!isNonEmptyString(item.term)) errors.push(iWhere + ': term（用語）がありません');
          if (!isNonEmptyString(item.value)) errors.push(iWhere + ': value（値・式）がありません');
          if (item.note !== undefined && typeof item.note !== 'string') errors.push(iWhere + ': note は文字列にしてください');
        });
      });
    });
    return { ok: errors.length === 0, errors: errors, texts: errors.length ? [] : data.texts };
  }

  /** 自作テキストの項目の数 */
  function countTextItems(text) {
    return text.sections.reduce(function (n, sec) { return n + sec.items.length; }, 0);
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
   * 前に間違えた問題: 記録で「最後に解いたとき不正解」だった問題だけに絞る。
   * summary は summarizeLog() の返り値（鍵 → { last: 'correct' | 'wrong', ... }）。
   */
  function filterWrong(sets, summary) {
    return selectQuestions(sets, function (set, q) {
      var st = summary[questionKey(set.id, q.id)];
      return !!st && st.last === 'wrong';
    });
  }

  /**
   * まだ1回も解いていない問題だけに絞る（記録が無いか、回答が0件）。
   * 問題集の記録を消した（消去の印）あとは、その問題集の問題もまだ解いていないものとして数える。
   */
  function filterUnseen(sets, summary) {
    return selectQuestions(sets, function (set, q) {
      var st = summary[questionKey(set.id, q.id)];
      return !st || !(st.attempts > 0);
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

  /**
   * セッションの1問の回答（{ correct, lucky }）を正解として数えるか。まぐれにした正解は不正解として数える
   */
  function answerCorrect(a) {
    return !!a && !!a.correct && !a.lucky;
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

  /* ===================== 学習の記録（回答のログ） =====================
   * 記録は「1回答えるごとに1件」のログ { id, key, at, ok } を積み上げる形。
   *   id  : 一意なID（端末ID＋時刻＋連番。2台で衝突しない）
   *   key : 「問題集id::問題id」
   *   at  : 答えた日時（ISO 文字列）
   *   ok  : 正解なら true
   * 回数や正答率はすべてログから計算する（summarizeLog）。ログを id で和集合にすれば、
   * 2台で解いた記録が合算され、同じファイルを何度読み込んでも増えない。
   *
   * 以前は問題ごとの集計 { attempts, corrects, last, lastAt } だけを持っていた。
   * これは migrateStats() でログに変換する（旧形式のファイルの読み込みにも使う）。
   *
   * 問題集の記録を消すときは、ログから消すのではなく「消去の印」{ id, kind: 'clear', setId, at } を足す
   * （墓標）。ログを消すだけだと、もう一方の端末のファイルを読み込んだときに和集合で戻ってしまうため。
   * 集計では、その問題集の回答のうち最新の印の at 以前のものを数えない（effectiveLog）。
   * kind の無い要素は回答として扱う。
   *
   * たまたま当たった回答には「まぐれの印」{ id, kind: 'lucky', ref: 回答の id, on, at } を足す。
   * 回答の ok を書き換えないのは、和集合が id で重複を捨てるため（書き換えはもう一方の端末に伝わらない）。
   * 同じ ref の印のうち最新（at が同じなら id の大きい方）の on を採り、on なら集計では不正解として数える。
   * 取り消すときは on: false の印を足す。
   */

  var HISTORY_FORMAT = 'yontaku-drill-history/2';
  var HISTORY_FORMAT_V1 = 'yontaku-drill-history/1';
  var HISTORY_FILE_NAME = 'quiz-drill-記録.json';   // 保存のたびに置き換えやすいよう固定
  var WEAK_THRESHOLDS = [0.5, 0.7, 0.8];
  var DEFAULT_WEAK_THRESHOLD = 0.7;
  var WEAK_LIST_MAX = 30;

  function isCount(v) {
    return isInt(v) && v >= 0;
  }

  function isDateString(v) {
    return typeof v === 'string' && !isNaN(Date.parse(v));
  }

  /** ログ1件から、アプリが使う項目だけを取り出す */
  function coreEntry(e) {
    if (e.kind === 'clear') return { id: e.id, kind: 'clear', setId: e.setId, at: e.at };
    if (e.kind === 'lucky') return { id: e.id, kind: 'lucky', ref: e.ref, on: e.on, at: e.at };
    return { id: e.id, key: e.key, at: e.at, ok: e.ok };
  }

  function isClear(e) {
    return e.kind === 'clear';
  }

  /** 印の前後: at が新しい方、同じなら id の大きい方を後とみなす */
  function isLater(a, b) {
    var ma = Date.parse(a.at), mb = Date.parse(b.at);
    return ma > mb || (ma === mb && a.id > b.id);
  }

  /** 回答の id → いまその回答がまぐれとされているか（同じ ref の最新の印の on） */
  function luckyRefs(log) {
    var latest = {};
    log.forEach(function (e) {
      if (e.kind !== 'lucky') return;
      if (!latest[e.ref] || isLater(e, latest[e.ref])) latest[e.ref] = e;
    });
    var out = {};
    Object.keys(latest).forEach(function (ref) { if (latest[ref].on) out[ref] = true; });
    return out;
  }

  function inSet(key, setId) {
    return key.indexOf(setId + '::') === 0;
  }

  /**
   * 集計に使う回答だけを返す。印の要素（消去・まぐれ）そのものと、消去の印のある問題集の回答のうち
   * 最新の消去の印の at 以前のものを除く。印より後の回答はふつうに数える。
   * まぐれとされた正解は { ...回答, ok: false, lucky: true } の写しにして返す（元のログは書き換えない）。
   * 不正解の回答に付いたまぐれの印は何もしない。消去の印で除かれた回答に付いた印も何もしない。
   */
  function effectiveLog(log) {
    var clearedAt = {};   // 問題集id → 最新の印の時刻（ミリ秒）
    log.forEach(function (e) {
      if (!isClear(e)) return;
      var ms = Date.parse(e.at);
      if (clearedAt[e.setId] === undefined || ms > clearedAt[e.setId]) clearedAt[e.setId] = ms;
    });
    var ids = Object.keys(clearedAt);
    var lucky = luckyRefs(log);
    return log.filter(function (e) {
      if (e.kind !== undefined) return false;
      for (var i = 0; i < ids.length; i++) {
        if (inSet(e.key, ids[i]) && Date.parse(e.at) <= clearedAt[ids[i]]) return false;
      }
      return true;
    }).map(function (e) {
      return e.ok && lucky[e.id] ? Object.assign({}, e, { ok: false, lucky: true }) : e;
    });
  }

  /** 問題集の記録を消したら数えなくなる回答の件数（今数えている分） */
  function countSetAnswers(log, setId) {
    return effectiveLog(log).filter(function (e) { return inSet(e.key, setId); }).length;
  }

  /** 前回の正解の位置から、その問題集の分を除いた写し */
  function removeSetPositions(positions, setId) {
    var out = {};
    Object.keys(positions).forEach(function (k) {
      if (!inSet(k, setId)) out[k] = positions[k];
    });
    return out;
  }

  /**
   * ログを問題ごとに集計する。返り値は 鍵 → { attempts, corrects, wrongs, lucky, rate, last, lastAt, lastLucky }。
   * rate は 0〜1。last は最後に解いたときの結果（'correct' | 'wrong'）。
   * まぐれとされた回答は不正解として数える（wrongs に入り、corrects には入らない）。lucky はその件数、
   * lastLucky は最後の回答がまぐれか。
   * 同じ日時のログが並んだら id の大きい方を「後」とみなす（読み込んだ順に左右されないように）。
   * 消去の印は反映する（effectiveLog）。
   */
  function summarizeLog(log) {
    var map = {};
    var lastMs = {};
    var lastId = {};
    effectiveLog(log).forEach(function (e) {
      var s = map[e.key];
      if (!s) {
        s = map[e.key] = { attempts: 0, corrects: 0, wrongs: 0, lucky: 0, rate: 0, last: null, lastAt: null, lastLucky: false };
      }
      s.attempts += 1;
      if (e.ok) s.corrects += 1; else s.wrongs += 1;
      if (e.lucky) s.lucky += 1;
      var ms = Date.parse(e.at);
      if (s.lastAt === null || ms > lastMs[e.key] || (ms === lastMs[e.key] && e.id > lastId[e.key])) {
        s.last = e.ok ? 'correct' : 'wrong';
        s.lastAt = e.at;
        s.lastLucky = !!e.lucky;
        lastMs[e.key] = ms;
        lastId[e.key] = e.id;
      }
    });
    Object.keys(map).forEach(function (k) { map[k].rate = map[k].corrects / map[k].attempts; });
    return map;
  }

  /**
   * 以前の集計 { 鍵: { attempts, corrects, last, lastAt } } をログに変換する。
   * 各問題について corrects 件の正解と attempts−corrects 件の不正解を作り、日時は lastAt から
   * 1秒ずつさかのぼらせる。最後の1件が last になるように置き、それより前は不正解を先に並べる。
   * id は集計の値だけから決まる形（mig:鍵:attempts:corrects:lastAt:連番）。2台が同じ集計を
   * 持っていれば同じ id になり、和集合で二重にならない。
   * last と回数が食い違う（last が正解なのに corrects が0など）ときは回数を優先する。
   */
  function migrateStats(stats) {
    var out = [];
    Object.keys(stats).forEach(function (key) {
      var r = stats[key];
      var n = r.attempts;
      var c = r.corrects;
      if (!(n > 0)) return;
      var lastOk = r.last === 'correct';
      if (lastOk && c === 0) lastOk = false;
      if (!lastOk && c === n) lastOk = true;
      var olderCorrects = c - (lastOk ? 1 : 0);
      var flags = [];
      for (var i = 0; i < n - 1; i++) flags.push(i >= (n - 1) - olderCorrects);   // 前が不正解・後ろが正解
      flags.push(lastOk);
      var base = Date.parse(r.lastAt);
      flags.forEach(function (ok, i) {
        out.push({
          id: 'mig:' + key + ':' + n + ':' + c + ':' + r.lastAt + ':' + i,
          key: key,
          at: new Date(base - (n - 1 - i) * 1000).toISOString(),
          ok: ok,
        });
      });
    });
    return out;
  }

  /** ログの和集合（id で1件にまとめる）。返り値 { log, added }。引数は書き換えない */
  function unionLog(current, incoming) {
    var seen = {};
    current.forEach(function (e) { seen[e.id] = true; });
    var added = [];
    incoming.forEach(function (e) {
      if (seen[e.id]) return;
      seen[e.id] = true;
      added.push(coreEntry(e));
    });
    return { log: current.concat(added), added: added };
  }

  /** 前回の正解の位置: 今の端末に無い鍵だけ足す（ある鍵は今の端末を残す） */
  function mergePositions(current, incoming) {
    var out = Object.assign({}, current);
    Object.keys(incoming || {}).forEach(function (k) {
      if (out[k] === undefined) out[k] = incoming[k];
    });
    return out;
  }

  /**
   * 書き出す中身を作る。now は Date。問題文などの中身は入れない。
   * summary は分析用（読み込むときは無視する）。問題集が読み込まれている記録にだけ、
   * 問題集の表示名・問番号・分類・タグを添える。問番号は no が無ければ問題集の中の位置（1 始まり）。
   */
  function buildHistoryExport(log, positions, sets, now) {
    var index = indexSets(sets);
    var sum = summarizeLog(log);
    var summary = {};
    Object.keys(sum).forEach(function (key) {
      var rec = Object.assign({}, sum[key]);
      var e = index[key];
      if (e) {
        rec.setTitle = e.set.title;
        rec.no = e.question.no !== undefined ? e.question.no : e.index + 1;
        if (e.question.category !== undefined) rec.category = e.question.category;
        if (e.question.tags !== undefined) rec.tags = e.question.tags.slice();
      }
      summary[key] = rec;
    });
    return {
      format: HISTORY_FORMAT,
      exportedAt: now.toISOString(),
      log: log.map(coreEntry),
      positions: Object.assign({}, positions),
      summary: summary,
    };
  }

  function validateV1(h, errors) {
    if (!h || typeof h !== 'object' || Array.isArray(h)) {
      errors.push('history がオブジェクトではありません');
      return;
    }
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
      if (!isDateString(r.lastAt)) errors.push(where + 'lastAt が日時ではありません');
    });
  }

  function validateV2(log, errors) {
    if (!Array.isArray(log)) {
      errors.push('log が配列ではありません');
      return;
    }
    log.forEach(function (e, i) {
      var where = (i + 1) + '件目の記録' + (e && isNonEmptyString(e.id) ? '（id: ' + e.id + '）' : '') + ': ';
      if (!e || typeof e !== 'object' || Array.isArray(e)) {
        errors.push(where + 'オブジェクトではありません');
        return;
      }
      if (!isNonEmptyString(e.id)) errors.push(where + 'id がありません');
      if (!isDateString(e.at)) errors.push(where + 'at が日時ではありません');
      if (e.kind === 'clear') {
        if (!isNonEmptyString(e.setId)) errors.push(where + '消去の印に setId がありません');
      } else if (e.kind === 'lucky') {
        if (!isNonEmptyString(e.ref)) errors.push(where + 'まぐれの印に ref（回答の id）がありません');
        if (typeof e.on !== 'boolean') errors.push(where + 'まぐれの印の on は true か false で書いてください');
      } else if (e.kind !== undefined) {
        errors.push(where + 'kind は "clear"・"lucky" か、書かない（回答）かのどれかです');
      } else {
        if (!isNonEmptyString(e.key)) errors.push(where + 'key がありません');
        if (typeof e.ok !== 'boolean') errors.push(where + 'ok は true か false で書いてください');
      }
    });
  }

  /** 記録のファイルを検証する（新旧どちらの形式も）。返り値 { ok, errors } */
  function validateHistory(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, errors: ['学習の記録のファイルではありません'] };
    }
    var errors = [];
    if (data.format === HISTORY_FORMAT) validateV2(data.log, errors);
    else if (data.format === HISTORY_FORMAT_V1) validateV1(data.history, errors);
    else {
      return { ok: false, errors: ['format が "' + HISTORY_FORMAT + '" ではありません（' + JSON.stringify(data.format) + '）'] };
    }
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

  /** 検証済みのファイルからログを取り出す。旧形式は migrateStats() で変換する */
  function historyToLog(data) {
    return data.format === HISTORY_FORMAT_V1 ? migrateStats(data.history) : data.log.map(coreEntry);
  }

  /** 記録の概要: 解いた問題の数・最後に不正解だった問題の数・回答の総数（読み込んでいない問題集の分も含む） */
  function historySummary(summary) {
    var keys = Object.keys(summary);
    return {
      answered: keys.length,
      wrong: keys.filter(function (k) { return summary[k].last === 'wrong'; }).length,
      answers: keys.reduce(function (n, k) { return n + summary[k].attempts; }, 0),
    };
  }

  /* ===================== 苦手な問題 ===================== */

  /** 苦手: 1回以上解いていて、正答率がしきい値未満か、最後に不正解 */
  function isWeak(s, threshold) {
    return !!s && s.attempts > 0 && (s.rate < threshold || s.last === 'wrong');
  }

  function filterWeak(sets, summary, threshold) {
    return selectQuestions(sets, function (set, q) {
      return isWeak(summary[questionKey(set.id, q.id)], threshold);
    });
  }

  /** 苦手の並べ方: 正答率の低い順、同じなら不正解の回数が多い順 */
  function compareWeak(a, b) {
    return a.rate - b.rate || b.wrongs - a.wrongs;
  }

  /**
   * 苦手な問題の出題順。sets は filterWeak() などで絞ったもの。
   * 正答率・不正解の回数が同じ問題どうしは無作為な順にする（先に混ぜてから安定ソートする）。
   */
  function weakOrder(sets, summary, count, rand) {
    var keys = [];
    sets.forEach(function (set) { keys = keys.concat(sequentialOrder(set)); });
    var sorted = shuffle(keys, rand).sort(function (a, b) { return compareWeak(summary[a], summary[b]); });
    return count == null ? sorted : sorted.slice(0, count);
  }

  function emptyGroup() {
    return { questions: 0, answered: 0, answers: 0, corrects: 0, rate: null, weak: 0, lucky: 0 };
  }

  function addToGroup(g, s, threshold) {
    g.questions += 1;
    if (!s) return;
    g.answered += 1;
    g.answers += s.attempts;
    g.corrects += s.corrects;
    if (isWeak(s, threshold)) g.weak += 1;
    if (s.lastLucky) g.lucky += 1;
  }

  function finishGroup(g) {
    g.rate = g.answers > 0 ? g.corrects / g.answers : null;
    return g;
  }

  /**
   * 成績の画面の中身。読み込んでいる問題集の問題だけを数える。
   * 返り値 {
   *   total: 集計, bySet: [{ id, title, ...集計 }], byCategory: [{ category, ...集計 }],
   *   weakList: [{ key, attempts, corrects, wrongs, rate }]（苦手を正答率の低い順に最大30件）
   * }。集計は { questions, answered, answers, corrects, rate（回答が無ければ null）, weak,
   * lucky（最後の回答がまぐれの問題の数） }。
   * 分類の無い問題は category: null にまとめる。分類の並びは最初に出てきた順。
   */
  function statsReport(sets, summary, threshold) {
    var total = emptyGroup();
    var bySet = [];
    var cats = {};
    var catOrder = [];
    var weak = [];
    sets.forEach(function (set) {
      var g = Object.assign({ id: set.id, title: set.title }, emptyGroup());
      var idx = indexSets([set]);
      sequentialOrder(set).forEach(function (key) {
        var q = idx[key].question;
        var s = summary[key];
        var cat = q.category !== undefined ? q.category : null;
        var ck = cat === null ? '\u0000' : 'c:' + cat;
        if (!cats[ck]) { cats[ck] = Object.assign({ category: cat }, emptyGroup()); catOrder.push(ck); }
        addToGroup(total, s, threshold);
        addToGroup(g, s, threshold);
        addToGroup(cats[ck], s, threshold);
        if (isWeak(s, threshold)) {
          weak.push({ key: key, attempts: s.attempts, corrects: s.corrects, wrongs: s.wrongs, rate: s.rate });
        }
      });
      bySet.push(finishGroup(g));
    });
    // 同点は問題集の順・問番号の順のまま（Array.prototype.sort は安定）
    weak.sort(compareWeak);
    return {
      total: finishGroup(total),
      bySet: bySet,
      byCategory: catOrder.map(function (k) { return finishGroup(cats[k]); }),
      weakList: weak.slice(0, WEAK_LIST_MAX),
    };
  }

  return {
    FORMAT: FORMAT,
    HISTORY_FORMAT: HISTORY_FORMAT,
    HISTORY_FORMAT_V1: HISTORY_FORMAT_V1,
    HISTORY_FILE_NAME: HISTORY_FILE_NAME,
    WEAK_THRESHOLDS: WEAK_THRESHOLDS,
    DEFAULT_WEAK_THRESHOLD: DEFAULT_WEAK_THRESHOLD,
    summarizeLog: summarizeLog,
    effectiveLog: effectiveLog,
    countSetAnswers: countSetAnswers,
    removeSetPositions: removeSetPositions,
    migrateStats: migrateStats,
    unionLog: unionLog,
    mergePositions: mergePositions,
    buildHistoryExport: buildHistoryExport,
    validateHistory: validateHistory,
    historyToLog: historyToLog,
    historySummary: historySummary,
    isWeak: isWeak,
    filterWeak: filterWeak,
    weakOrder: weakOrder,
    statsReport: statsReport,
    validateFile: validateFile,
    TEXT_FORMAT: TEXT_FORMAT,
    validateTextFile: validateTextFile,
    countTextItems: countTextItems,
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
    filterUnseen: filterUnseen,
    countQuestions: countQuestions,
    choiceOrder: choiceOrder,
    correctPosition: correctPosition,
    correctIndices: correctIndices,
    isCorrectOriginal: isCorrectOriginal,
    judge: judge,
    answerCorrect: answerCorrect,
    score: score,
    questionLabel: questionLabel,
    circled: circled,
    excerpt: excerpt,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QD_QUIZ;
