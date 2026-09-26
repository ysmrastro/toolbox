/*
 * app.js — 4択ドリルの画面（DOM・イベント・描画）
 *
 * 計算（検証・統合・出題順・並べ替え・正誤・採点）は quiz.js、保存は storage.js に置いてあり、
 * ここは持たない。app.js は外から呼べないクロージャなので、ここに計算を置くとテストできない。
 *
 * セッション（localStorage）の形:
 *   { mode, order: [問題の鍵], pos: いま何問目か（0 始まり）,
 *     answers: { 鍵: { order: 表示順, picked: 選んだ元の添字, correct } } }
 * 回答するたびに保存するので、途中で閉じても同じ問題から再開できる。
 */
(function () {
  'use strict';

  var Q = QD_QUIZ;
  var S = QD_STORAGE;

  var MODE_NAMES = {
    'seq': '問題集ごとに通し',
    'set-random': '問題集の中でランダム',
    'all-random': '全問題からランダム',
    'retry': '間違えた問題',
  };
  var MAX_ERRORS_SHOWN = 20;
  var EXCERPT_LEN = 40;

  var state = {
    sets: [],          // 読み込み済みの問題集（保存順）
    index: {},         // 鍵 → { set, question, index }
    session: null,     // 進行中のセッション
    finished: null,    // 直前に終えたセッション（結果画面と見返し用）
    stats: S.loadStats(),
    currentOrder: null, // 回答前の問題の表示順
    reviewKey: null,   // 結果画面から見返している問題の鍵
    loaded: false,     // 保存済みの問題集を読み出せたか
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ===================== 画面の切り替え ===================== */

  function showScreen(name) {
    ['home', 'quiz', 'result'].forEach(function (n) {
      $('screen-' + n).hidden = n !== name;
    });
    window.scrollTo(0, 0);
  }

  /* ===================== ホーム ===================== */

  function setSets(sets) {
    state.sets = sets;
    state.index = Q.indexSets(sets);
  }

  /** セッションの問題がすべて手元にあるか（問題集を消した・置き換えたときに崩れる） */
  function sessionUsable(session) {
    return !!session && Array.isArray(session.order) && session.order.length > 0 &&
      session.order.every(function (k) { return !!state.index[k]; });
  }

  function renderHome() {
    var has = state.sets.length > 0;
    $('empty-guide').hidden = has;
    $('start-card').hidden = !has;
    $('set-empty').hidden = has;

    // 問題集の一覧
    var list = $('set-list');
    list.textContent = '';
    state.sets.forEach(function (set) {
      var li = document.createElement('li');
      li.className = 'qd-set-item';
      var name = document.createElement('span');
      name.className = 'qd-set-name';
      name.textContent = set.title;
      var count = document.createElement('span');
      count.className = 'qd-set-count';
      count.textContent = set.questions.length + '問';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'tb-btn tb-btn--ghost qd-set-del';
      del.textContent = '削除';
      del.setAttribute('aria-label', '「' + set.title + '」を削除');
      del.addEventListener('click', function () { removeSet(set); });
      li.appendChild(name);
      li.appendChild(count);
      li.appendChild(del);
      list.appendChild(li);
    });

    // 問題集の選択肢（前に選んでいたものは残す）
    var select = $('set-select');
    var prev = select.value;
    select.textContent = '';
    state.sets.forEach(function (set) {
      var opt = document.createElement('option');
      opt.value = set.id;
      opt.textContent = set.title + '（' + set.questions.length + '問）';
      select.appendChild(opt);
    });
    if (prev && state.sets.some(function (s) { return s.id === prev; })) select.value = prev;

    // 続きから
    // 読み出しに失敗したとき（loaded でない）は、途中の分を消さずに残しておく
    if (state.loaded && state.session && !sessionUsable(state.session)) {
      state.session = null;
      S.clearSession();
    }
    var s = sessionUsable(state.session) ? state.session : null;
    $('resume-card').hidden = !s;
    if (s) {
      $('btn-resume').textContent = '続きから（' + (s.pos + 1) + ' / ' + s.order.length + '）';
      $('resume-desc').textContent = describeSession(s);
    }

    renderModeFields();
  }

  function describeSession(s) {
    var first = state.index[s.order[0]];
    var name = MODE_NAMES[s.mode] || '';
    if ((s.mode === 'seq' || s.mode === 'set-random') && first) return name + '：' + first.set.title;
    return name;
  }

  function selectedMode() {
    return document.querySelector('input[name="mode"]:checked').value;
  }

  function renderModeFields() {
    var mode = selectedMode();
    $('set-field').hidden = mode === 'all-random';
    $('count-field').hidden = mode !== 'all-random';
  }

  function removeSet(set) {
    if (!confirm('「' + set.title + '」（' + set.questions.length + '問）を削除します。よろしいですか？')) return;
    S.deleteSet(set.id).then(reloadSets).then(function () {
      showMessage(['「' + set.title + '」を削除しました。'], false);
    }).catch(function (e) {
      showMessage(['削除できませんでした: ' + e], true);
    });
  }

  function reloadSets() {
    return S.getAllSets().then(function (sets) {
      setSets(sets);
      state.loaded = true;
      renderHome();
    });
  }

  function showMessage(lines, isError) {
    var box = $('load-msg');
    box.textContent = '';
    box.classList.toggle('is-error', !!isError);
    lines.forEach(function (line) {
      var p = document.createElement('p');
      p.textContent = line;
      box.appendChild(p);
    });
    box.hidden = lines.length === 0;
  }

  /* ===================== 読み込み ===================== */

  /**
   * 読み込んだ中身（{ name, text }）を検証して保存する。
   * ファイルごとに判定し、不正なファイルは保存しない（正しいファイルだけ保存する）。
   */
  function importTexts(files) {
    var lines = [];
    var hasError = false;
    var incoming = [];

    files.forEach(function (f) {
      var data;
      try {
        data = JSON.parse(f.text);
      } catch (e) {
        hasError = true;
        lines.push('「' + f.name + '」: JSON として読めません。保存していません。');
        return;
      }
      var r = Q.validateFile(data);
      if (!r.ok) {
        hasError = true;
        lines.push('「' + f.name + '」に誤りがあるため保存していません:');
        r.errors.slice(0, MAX_ERRORS_SHOWN).forEach(function (e) { lines.push('・' + e); });
        if (r.errors.length > MAX_ERRORS_SHOWN) {
          lines.push('ほか ' + (r.errors.length - MAX_ERRORS_SHOWN) + ' 件');
        }
        return;
      }
      incoming = incoming.concat(r.sets);
    });

    if (incoming.length === 0) {
      showMessage(lines, hasError);
      return Promise.resolve();
    }

    var merged = Q.mergeSets(state.sets, incoming);
    return S.putSets(incoming).then(reloadSets).then(function () {
      var parts = [];
      if (merged.added.length) parts.push('追加 ' + merged.added.length + '件');
      if (merged.replaced.length) parts.push('置き換え ' + merged.replaced.length + '件');
      lines.unshift('問題集を読み込みました（' + parts.join('、') + '）。');
      showMessage(lines, hasError);
    }).catch(function (e) {
      lines.unshift('保存できませんでした: ' + e);
      showMessage(lines, true);
    });
  }

  function onFiles(ev) {
    var files = Array.prototype.slice.call(ev.target.files || []);
    if (files.length === 0) return;
    Promise.all(files.map(function (file) {
      return file.text().then(function (text) { return { name: file.name, text: text }; });
    })).then(importTexts).finally(function () {
      ev.target.value = '';   // 同じファイルをもう一度選んでも change が起きるように
    });
  }

  function loadSample() {
    fetch('sample.json')
      .then(function (res) {
        if (!res.ok) throw new Error(res.status);
        return res.text();
      })
      .then(function (text) { return importTexts([{ name: 'sample.json', text: text }]); })
      .catch(function (e) { showMessage(['見本を読み込めませんでした: ' + e], true); });
  }

  /* ===================== セッションの開始 ===================== */

  function startSession(mode, order) {
    state.session = { mode: mode, order: order, pos: 0, answers: {} };
    state.finished = null;
    S.saveSession(state.session);
    renderQuestion();
  }

  function onStart() {
    if (state.session && !confirm('途中の問題があります。新しく始めると、途中の分は消えます。よろしいですか？')) return;
    var mode = selectedMode();
    var order;
    if (mode === 'all-random') {
      var v = document.querySelector('input[name="count"]:checked').value;
      order = Q.allRandomOrder(state.sets, v === 'all' ? null : Number(v), Math.random);
    } else {
      var id = $('set-select').value;
      var set = state.sets.filter(function (s) { return s.id === id; })[0];
      if (!set) return;
      order = mode === 'seq' ? Q.sequentialOrder(set) : Q.randomOrder(set, Math.random);
    }
    startSession(mode, order);
  }

  /* ===================== 問題 ===================== */

  function renderQuestion() {
    var s = state.session;
    var key = s.order[s.pos];
    var answer = s.answers[key] || null;
    if (!answer) state.currentOrder = Q.choiceOrder(state.index[key].question, Math.random);
    drawQuestion(key, answer ? answer.order : state.currentOrder, answer, false);
    showScreen('quiz');
  }

  /**
   * 問題を描く。answer があれば回答後の表示にする。
   * review は結果画面からの見返し（進み具合を出さず、ボタンを「結果に戻る」にする）。
   */
  function drawQuestion(key, order, answer, review) {
    var entry = state.index[key];
    var q = entry.question;

    $('q-label').textContent = Q.questionLabel(entry.set, q, entry.index);
    $('q-category').textContent = q.category || '';
    var badge = $('q-points');
    badge.hidden = !(q.points >= 2);
    badge.textContent = q.points + '点';

    if (review) {
      $('q-progress').textContent = '';
      $('q-score').textContent = '';
    } else {
      var s = state.session;
      $('q-progress').textContent = (s.pos + 1) + ' / ' + s.order.length;
      $('q-score').textContent = '正解 ' + countCorrect(s);
    }
    $('btn-quit').textContent = review ? '結果へ' : '中断';

    $('q-text').textContent = q.question;

    var fig = $('q-figure');
    fig.hidden = !q.image;
    if (q.image) {
      $('q-image').src = q.image;
      $('q-image').alt = q.imageAlt || '問題の図';
    } else {
      $('q-image').removeAttribute('src');
    }

    // 選択肢（表示順）
    var list = $('q-choices');
    list.textContent = '';
    order.forEach(function (original, displayIndex) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qd-choice';
      var num = document.createElement('span');
      num.className = 'qd-choice-num';
      num.textContent = String(displayIndex + 1);
      var text = document.createElement('span');
      text.className = 'qd-choice-text';
      text.textContent = q.choices[original];
      btn.appendChild(num);
      btn.appendChild(text);
      if (answer) {
        btn.disabled = true;
        if (Q.isCorrectOriginal(q, original)) btn.classList.add('is-correct');
        else if (original === answer.picked) btn.classList.add('is-wrong');
        if (original === answer.picked) btn.classList.add('is-picked');
      } else {
        btn.addEventListener('click', function () { onPick(displayIndex); });
      }
      li.appendChild(btn);
      list.appendChild(li);
    });

    var verdict = $('q-verdict');
    verdict.hidden = !answer;
    $('q-after').hidden = !answer;
    if (!answer) return;

    verdict.textContent = answer.correct ? '正解' : '不正解';
    verdict.classList.toggle('is-correct', answer.correct);
    verdict.classList.toggle('is-wrong', !answer.correct);

    // 元の番号順の選択肢。解説は元の番号で書かれていることがあるので、これで番号を突き合わせる
    var orig = $('q-original');
    orig.textContent = '';
    q.choices.forEach(function (choice, i) {
      var li = document.createElement('li');
      li.className = 'qd-original-item';
      var num = document.createElement('span');
      num.className = 'qd-original-num';
      num.textContent = Q.circled(i + 1);
      var text = document.createElement('span');
      text.className = 'qd-original-text';
      text.textContent = choice;
      li.appendChild(num);
      li.appendChild(text);
      var correct = Q.isCorrectOriginal(q, i);
      if (correct) {
        li.classList.add('is-correct');
        li.appendChild(tag('正解', 'qd-tag qd-tag--correct'));
      }
      if (i === answer.picked) {
        li.appendChild(tag('あなたの回答', correct ? 'qd-tag qd-tag--picked' : 'qd-tag qd-tag--wrong'));
      }
      orig.appendChild(li);
    });

    $('q-explanation-wrap').hidden = !q.explanation;
    $('q-explanation').textContent = q.explanation || '';
    $('q-supplement-wrap').hidden = !q.supplement;
    $('q-supplement').textContent = q.supplement || '';

    var next = $('btn-next');
    if (review) next.textContent = '結果に戻る';
    else next.textContent = state.session.pos + 1 >= state.session.order.length ? '結果を見る' : '次の問題へ';
  }

  function tag(text, cls) {
    var span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    return span;
  }

  function countCorrect(s) {
    return s.order.filter(function (k) { return s.answers[k] && s.answers[k].correct; }).length;
  }

  function onPick(displayIndex) {
    var s = state.session;
    var key = s.order[s.pos];
    if (s.answers[key]) return;   // 選び直しはできない
    var q = state.index[key].question;
    var r = Q.judge(q, state.currentOrder, displayIndex);
    s.answers[key] = { order: state.currentOrder, picked: r.original, correct: r.correct };
    S.saveSession(s);
    state.stats = Q.updateStats(state.stats, key, r.correct, new Date().toISOString());
    S.saveStats(state.stats);
    drawQuestion(key, state.currentOrder, s.answers[key], false);
  }

  function onNext() {
    if (state.reviewKey) {
      state.reviewKey = null;
      showScreen('result');
      return;
    }
    var s = state.session;
    if (s.pos + 1 >= s.order.length) {
      finishSession();
      return;
    }
    s.pos += 1;
    S.saveSession(s);
    renderQuestion();
  }

  function onQuit() {
    if (state.reviewKey) {
      onNext();
      return;
    }
    renderHome();
    showScreen('home');
  }

  /* ===================== 結果 ===================== */

  function finishSession() {
    state.finished = state.session;
    state.session = null;
    S.clearSession();
    renderResult();
    showScreen('result');
  }

  function renderResult() {
    var f = state.finished;
    var results = f.order.map(function (k) {
      return { key: k, question: state.index[k].question, correct: !!(f.answers[k] && f.answers[k].correct) };
    });
    var sc = Q.score(results);
    $('r-summary').textContent = sc.correct + ' / ' + sc.total + ' 問正解';
    $('r-rate').textContent = '正答率 ' + Math.round(sc.correct / sc.total * 100) + '%';
    $('r-points').hidden = !sc.hasPoints;
    $('r-points').textContent = '得点 ' + sc.points + ' / ' + sc.maxPoints + ' 点';

    var wrong = results.filter(function (r) { return !r.correct; });
    var list = $('r-wrong');
    list.textContent = '';
    wrong.forEach(function (r) {
      var entry = state.index[r.key];
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qd-wrong-item';
      var label = document.createElement('span');
      label.className = 'qd-wrong-label';
      label.textContent = Q.questionLabel(entry.set, entry.question, entry.index);
      var text = document.createElement('span');
      text.className = 'qd-wrong-text';
      text.textContent = Q.excerpt(entry.question.question, EXCERPT_LEN);
      btn.appendChild(label);
      btn.appendChild(text);
      btn.addEventListener('click', function () { review(r.key); });
      li.appendChild(btn);
      list.appendChild(li);
    });
    $('r-nowrong').hidden = wrong.length > 0;
    $('btn-retry').hidden = wrong.length === 0;
  }

  function review(key) {
    var a = state.finished.answers[key];
    state.reviewKey = key;
    drawQuestion(key, a.order, a, true);
    showScreen('quiz');
  }

  function onRetry() {
    var f = state.finished;
    var wrong = f.order.filter(function (k) { return !(f.answers[k] && f.answers[k].correct); });
    if (wrong.length) startSession('retry', wrong);
  }

  /* ===================== 画像の拡大 ===================== */

  function openLightbox() {
    var img = $('q-image');
    $('lightbox-img').src = img.src;
    $('lightbox-img').alt = img.alt;
    $('lightbox').hidden = false;
  }

  function closeLightbox() {
    $('lightbox').hidden = true;
  }

  /* ===================== 起動 ===================== */

  $('file-input').addEventListener('change', onFiles);
  $('btn-sample').addEventListener('click', loadSample);
  $('btn-start').addEventListener('click', onStart);
  $('btn-resume').addEventListener('click', renderQuestion);
  $('btn-next').addEventListener('click', onNext);
  $('btn-quit').addEventListener('click', onQuit);
  $('btn-retry').addEventListener('click', onRetry);
  $('btn-home').addEventListener('click', function () { renderHome(); showScreen('home'); });
  $('q-image').addEventListener('click', openLightbox);
  $('lightbox').addEventListener('click', closeLightbox);
  Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (el) {
    el.addEventListener('change', renderModeFields);
  });

  state.session = S.loadSession();
  reloadSets().catch(function (e) {
    renderHome();
    showMessage(['保存した問題集を読み出せませんでした: ' + e], true);
  });
})();
