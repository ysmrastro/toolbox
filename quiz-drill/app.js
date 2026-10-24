/*
 * app.js — 4択ドリルの画面（DOM・イベント・描画）
 *
 * 計算（検証・統合・出題順・並べ替え・正誤・採点）は quiz.js、保存は storage.js に置いてあり、
 * ここは持たない。app.js は外から呼べないクロージャなので、ここに計算を置くとテストできない。
 *
 * 学習の記録は回答ごとのログ（IndexedDB）で、集計（state.summary）はそこから quiz.js で計算する。
 * 以前の成績の記録（問題ごとの集計）が残っていれば、起動時に一度だけログに移す。
 *
 * セッション（localStorage）の形:
 *   { mode, order: [問題の鍵], pos: いま何問目か（0 始まり）,
 *     answers: { 鍵: { order: 表示順, picked: 選んだ元の添字, correct, logId: 回答の記録の id, lucky } },
 *     shown: { key, order } 回答前の問題を表示したときの表示順 }
 * 回答するたびに保存するので、途中で閉じても同じ問題から再開できる。
 * shown があるので、回答前に閉じて「続きから」で戻っても同じ並びで描く（並べ替え直さない）。
 */
(function () {
  'use strict';

  var Q = QD_QUIZ;
  var S = QD_STORAGE;

  var MODE_NAMES = {
    'seq': '問題集ごとに通し',
    'set-random': '問題集の中でランダム',
    'all-random': '全問題からランダム',
    'wrong': '前に間違えた問題',
    'unseen': 'まだ解いていない問題',
    'mock': '模擬試験',
    'weak': '苦手な問題',
    'retry': '間違えた問題だけもう一度',
  };
  var ALL_SETS = '';   // 問題集の選択肢の「すべての問題集」（前に間違えた問題・苦手な問題でだけ出す）
  var MAX_ERRORS_SHOWN = 20;
  var EXCERPT_LEN = 40;

  var state = {
    sets: [],          // 読み込み済みの問題集（保存順）
    texts: [],         // 読み込み済みの自作テキスト（保存順）
    mock: S.loadMock(), // 進行中の模擬試験（無ければ null）
    tab: S.loadTab() === 'book' ? 'book' : 'drill',   // ホームで開いているタブ
    bookId: S.loadBookTab(),   // 自作テキストのサブタブで選んでいるテキストの id
    index: {},         // 鍵 → { set, question, index }
    session: null,     // 進行中のセッション
    finished: null,    // 直前に終えたセッション（結果画面と見返し用）
    log: [],           // 学習の記録（回答ごとのログ）
    summary: {},       // ログの集計（鍵 → { attempts, corrects, wrongs, rate, last, lastAt }）
    positions: S.loadPositions(),   // 鍵 → 前回表示したときの代表の正解の表示位置
    currentOrder: null, // 回答前の問題の表示順
    reviewKey: null,   // 結果画面・成績の画面から見返している問題の鍵
    reviewFrom: null,  // 見返しから戻る画面（'result' | 'stats'）
    loaded: false,     // 保存済みの問題集を読み出せたか
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ===================== 画面の切り替え ===================== */

  function showScreen(name) {
    ['home', 'quiz', 'result', 'stats', 'mock', 'mockreview'].forEach(function (n) {
      $('screen-' + n).hidden = n !== name;
    });
    // 残り時間は模擬試験の2つの画面にいる間だけ数える
    if (name === 'mock' || name === 'mockreview') startMockTimer();
    else stopMockTimer();
    window.scrollTo(0, 0);
  }

  /* ===================== ホーム ===================== */

  function setSets(sets) {
    // 読み込んだ順ではなく名前順（「第9回」「第11回」のように数字は大きさで）に並べる
    state.sets = sets.slice().sort(function (a, b) {
      return a.title.localeCompare(b.title, 'ja', { numeric: true });
    });
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

    fillFilterSelect();
    renderHistory();
    renderBooks();
    renderTab();

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

    renderMockResume();
    renderModeFields();
  }

  function describeSession(s) {
    if (s.desc) return s.desc;
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
    $('count-field').hidden = mode !== 'all-random' && mode !== 'wrong' && mode !== 'unseen' && mode !== 'weak';
    $('threshold-field').hidden = mode !== 'weak';
    $('mockmode-field').hidden = mode !== 'mock';
    renderMockModeNote();
    // 模擬試験は本番どおり1回分の全問を出すので、絞り込みは使わない
    $('filter-field').hidden = mode === 'mock' || Q.collectTags(state.sets).length === 0;
    fillSetSelect(mode);
    renderStartCount();
  }

  /** 問題集の選択肢。前に間違えた問題・苦手な問題のときだけ先頭に「すべての問題集」を足す。前の選択は残す */
  function fillSetSelect(mode) {
    var select = $('set-select');
    var prev = select.value;
    select.textContent = '';
    var add = function (value, text) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      select.appendChild(opt);
    };
    if (mode === 'wrong' || mode === 'unseen' || mode === 'weak') add(ALL_SETS, 'すべての問題集');
    state.sets.forEach(function (set) {
      add(set.id, set.title + '（' + set.questions.length + '問）');
    });
    var keep = Array.prototype.some.call(select.options, function (o) { return o.value === prev; });
    if (keep) select.value = prev;
  }

  /**
   * 絞り込みの選択肢。タグはデータから取る（アプリにタグの言葉を書かない）。
   * 値は { type, tag } の JSON にしてある（タグにどんな文字が入っていても区切りで壊れないように）。
   */
  function fillFilterSelect() {
    var tags = Q.collectTags(state.sets);
    var select = $('filter-select');
    var prev = select.value;
    select.textContent = '';
    $('filter-field').hidden = tags.length === 0;
    var add = function (filter, text) {
      var opt = document.createElement('option');
      opt.value = JSON.stringify(filter);
      opt.textContent = text;
      select.appendChild(opt);
    };
    add({ type: 'all' }, 'すべて');
    tags.forEach(function (tag) {
      add({ type: 'only', tag: tag }, tag + 'だけ');
      add({ type: 'exclude', tag: tag }, tag + 'を除く');
    });
    var keep = Array.prototype.some.call(select.options, function (o) { return o.value === prev; });
    if (keep) select.value = prev;
  }

  function currentFilter() {
    if ($('filter-field').hidden) return { type: 'all' };
    try {
      return JSON.parse($('filter-select').value);
    } catch (e) {
      return { type: 'all' };
    }
  }

  /** 模擬試験のモード。'rehearsal'（本番どおり）か 'practice'（時間を過ぎても続けられる） */
  function selectedMockMode() {
    var el = document.querySelector('input[name="mockmode"]:checked');
    return el && el.value === 'practice' ? 'practice' : 'rehearsal';
  }

  function renderMockModeNote() {
    $('mockmode-note').textContent = selectedMockMode() === 'practice'
      ? '練習：時間を過ぎても自動で提出しません。超えた時間は結果に出ます。'
      : 'リハーサル：本番どおり。50分で自動的に提出します。';
  }

  function selectedCount() {
    var v = document.querySelector('input[name="count"]:checked').value;
    return v === 'all' ? null : Number(v);
  }

  /** 苦手の判定に使う正答率のしきい値（0〜1） */
  function selectedThreshold() {
    return Number(document.querySelector('input[name="threshold"]:checked').value) / 100;
  }

  /** いまの出題方法・問題集・絞り込みで対象になる問題集（問題を絞った写し） */
  function candidateSets(mode) {
    if (mode === 'mock') {
      var mockId = $('set-select').value;
      return state.sets.filter(function (set) { return set.id === mockId; });
    }
    var sets = Q.filterSets(state.sets, currentFilter());
    if (mode === 'wrong') sets = Q.filterWrong(sets, state.summary);
    if (mode === 'unseen') sets = Q.filterUnseen(sets, state.summary);
    if (mode === 'weak') sets = Q.filterWeak(sets, state.summary, selectedThreshold());
    if (mode === 'all-random') return sets;
    var id = $('set-select').value;
    if ((mode === 'wrong' || mode === 'unseen' || mode === 'weak') && id === ALL_SETS) return sets;
    return sets.filter(function (set) { return set.id === id; });
  }

  /** 今の条件で対象になる問題数。0問なら開始できないようにする */
  function renderStartCount() {
    if (!state.sets.length) return;
    var mode = selectedMode();
    var n = Q.countQuestions(candidateSets(mode));
    var text;
    if (mode === 'wrong') text = n > 0 ? '前に間違えた問題: ' + n + '問' : '前に間違えた問題はありません';
    else if (mode === 'unseen') text = n > 0 ? 'まだ解いていない問題: ' + n + '問' : 'まだ解いていない問題はありません';
    else if (mode === 'mock') text = n > 0 ? '模擬試験: ' + n + '問・' + Math.round(Q.MOCK_LIMIT_SEC / 60) + '分（提出するまで正誤は出ません）' : '問題集を選んでください';
    else if (mode === 'weak') text = n > 0 ? '苦手な問題: ' + n + '問' : '苦手な問題はありません';
    else text = n > 0 ? '対象: ' + n + '問' : '条件に合う問題がないため、開始できません';
    var el = $('start-count');
    el.textContent = text;
    el.classList.toggle('is-empty', n === 0);
    $('btn-start').disabled = n === 0;
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

  function showMessage(lines, isError, boxId) {
    var box = $(boxId || 'load-msg');
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

  /* ===================== ホームのタブ ===================== */

  function renderTab() {
    ['drill', 'book'].forEach(function (name) {
      var on = state.tab === name;
      $('tab-' + name).setAttribute('aria-selected', on ? 'true' : 'false');
      $('tab-' + name).classList.toggle('is-active', on);
      $('panel-' + name).hidden = !on;
    });
  }

  function selectTab(name) {
    state.tab = name;
    S.saveTab(name);
    renderTab();
  }

  /* ===================== 自作テキスト ===================== */

  function renderBooks() {
    var list = $('book-list');
    list.textContent = '';
    $('book-empty').hidden = state.texts.length > 0;
    state.texts.forEach(function (text) {
      var li = document.createElement('li');
      li.className = 'qd-set-item';
      var name = document.createElement('span');
      name.className = 'qd-set-name';
      name.textContent = text.title;
      var count = document.createElement('span');
      count.className = 'qd-set-count';
      count.textContent = Q.countTextItems(text) + '項目';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'tb-btn tb-btn--ghost qd-set-del';
      del.textContent = '削除';
      del.setAttribute('aria-label', '「' + text.title + '」を削除');
      del.addEventListener('click', function () { removeBook(text); });
      li.appendChild(name);
      li.appendChild(count);
      li.appendChild(del);
      list.appendChild(li);
    });
    renderBookTabs();
  }

  /** テキストごとのサブタブを作り、選んでいるテキストの中身を出す。選んでいたものが無ければ先頭 */
  function renderBookTabs() {
    var bar = $('book-subtabs');
    bar.textContent = '';
    var has = state.texts.length > 0;
    bar.hidden = !has;
    $('book-view').hidden = !has;
    if (!has) return;
    var current = state.texts.filter(function (t) { return t.id === state.bookId; })[0] || state.texts[0];
    state.texts.forEach(function (text) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.className = 'qd-subtab' + (text === current ? ' is-active' : '');
      btn.setAttribute('aria-selected', text === current ? 'true' : 'false');
      btn.textContent = text.title;
      btn.addEventListener('click', function () { selectBook(text.id); });
      bar.appendChild(btn);
    });
    renderBook(current);
  }

  function selectBook(id) {
    state.bookId = id;
    S.saveBookTab(id);
    renderBookTabs();
  }

  /** テキストの中身を描く。節ごとにカードを作り、先頭に節への目次を置く */
  function renderBook(text) {
    var toc = $('bk-toc');
    var body = $('bk-body');
    toc.textContent = '';
    body.textContent = '';
    toc.hidden = text.sections.length < 2;
    text.sections.forEach(function (sec, si) {
      var anchor = 'bk-sec-' + si;
      var link = document.createElement('a');
      link.href = '#' + anchor;
      link.textContent = sec.title;
      link.addEventListener('click', function (ev) {
        ev.preventDefault();
        $(anchor).scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      toc.appendChild(link);

      var card = document.createElement('section');
      card.className = 'qd-card qd-book-sec';
      card.id = anchor;
      var h = document.createElement('h2');
      h.className = 'qd-card-title';
      h.textContent = sec.title;
      card.appendChild(h);
      if (sec.note) {
        var p = document.createElement('p');
        p.className = 'qd-note qd-book-secnote';
        p.textContent = sec.note;
        card.appendChild(p);
      }
      var dl = document.createElement('dl');
      dl.className = 'qd-book-items';
      sec.items.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'qd-book-item';
        var dt = document.createElement('dt');
        dt.textContent = item.term;
        var dd = document.createElement('dd');
        dd.className = 'qd-book-value';
        dd.textContent = item.value;
        row.appendChild(dt);
        row.appendChild(dd);
        if (item.note) {
          var nd = document.createElement('dd');
          nd.className = 'qd-book-note';
          nd.textContent = item.note;
          row.appendChild(nd);
        }
        dl.appendChild(row);
      });
      card.appendChild(dl);
      body.appendChild(card);
    });
  }

  function removeBook(text) {
    if (!confirm('「' + text.title + '」を削除します。よろしいですか？')) return;
    S.deleteText(text.id).then(reloadBooks).then(function () {
      showMessage(['「' + text.title + '」を削除しました。'], false, 'book-msg');
    }).catch(function (e) {
      showMessage(['削除できませんでした: ' + e], true, 'book-msg');
    });
  }

  function reloadBooks() {
    return S.getAllTexts().then(function (texts) {
      state.texts = texts;
      renderBooks();
    });
  }

  /** テキストファイル（{ name, text }）を検証して保存する。不正なファイルは保存しない */
  function importBooks(files) {
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
      var r = Q.validateTextFile(data);
      if (!r.ok) {
        hasError = true;
        lines.push('「' + f.name + '」に誤りがあるため保存していません:');
        r.errors.slice(0, MAX_ERRORS_SHOWN).forEach(function (e) { lines.push('・' + e); });
        if (r.errors.length > MAX_ERRORS_SHOWN) lines.push('ほか ' + (r.errors.length - MAX_ERRORS_SHOWN) + ' 件');
        return;
      }
      incoming = incoming.concat(r.texts);
    });
    if (incoming.length === 0) {
      showMessage(lines, hasError, 'book-msg');
      return Promise.resolve();
    }
    var merged = Q.mergeSets(state.texts, incoming);
    return S.putTexts(incoming).then(reloadBooks).then(function () {
      var parts = [];
      if (merged.added.length) parts.push('追加 ' + merged.added.length + '件');
      if (merged.replaced.length) parts.push('置き換え ' + merged.replaced.length + '件');
      lines.unshift('テキストを読み込みました（' + parts.join('、') + '）。');
      showMessage(lines, hasError, 'book-msg');
    }).catch(function (e) {
      lines.unshift('保存できませんでした: ' + e);
      showMessage(lines, true, 'book-msg');
    });
  }

  function onBookFiles(ev) {
    var files = Array.prototype.slice.call(ev.target.files || []);
    if (files.length === 0) return;
    Promise.all(files.map(function (file) {
      return file.text().then(function (text) { return { name: file.name, text: text }; });
    })).then(importBooks).finally(function () {
      ev.target.value = '';
    });
  }

  /* ===================== 学習の記録の書き出し・読み込み ===================== */

  function setLog(log) {
    state.log = log;
    state.summary = Q.summarizeLog(log);
  }

  /**
   * 以前の成績の記録（問題ごとの集計）が残っていればログに移し、ログを読み出す。
   * 移したあとも古い記録は消さず、移行済みの印だけを付ける。移す id は集計から決まるので、
   * 途中で失敗して次の起動でやり直しても二重にならない。
   */
  function initLog() {
    var legacy = S.loadLegacyStats();
    var migrate = Promise.resolve();
    if (legacy && !S.isMigrated()) {
      var v = Q.validateHistory({ format: Q.HISTORY_FORMAT_V1, history: legacy });
      if (v.ok) migrate = S.addLog(Q.migrateStats(legacy)).then(S.markMigrated);
    }
    return migrate.then(S.getAllLog).then(setLog);
  }

  function renderHistory() {
    var sum = Q.historySummary(state.summary);
    $('history-summary').textContent = sum.answered > 0
      ? '解いた問題 ' + sum.answered + '問・回答 ' + sum.answers + '件・前に間違えた問題 ' + sum.wrong + '問'
      : 'まだ記録がありません。';
    $('btn-export').disabled = sum.answered === 0;
  }

  /**
   * 記録を書き出す。iPhone では共有メニュー（「"ファイル"に保存」で iCloud Drive へ）で渡し、
   * Web Share API でファイルを渡せないブラウザではダウンロードにする。
   */
  function exportHistory() {
    var now = new Date();
    var data = Q.buildHistoryExport(state.log, state.positions, state.sets, now);
    var name = Q.HISTORY_FILE_NAME;
    var json = JSON.stringify(data, null, 2) + '\n';
    var file = null;
    try {
      file = new File([json], name, { type: 'application/json' });
    } catch (e) { /* File を作れない古いブラウザはダウンロードだけにする */ }

    if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(function (e) {
        if (e && e.name === 'AbortError') return;   // 共有を取り消しただけ。何も出さない
        download(json, name);
      });
      return;
    }
    download(json, name);
  }

  function download(text, name) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /**
   * 記録を読み込んで統合する。ログは id で和集合を取るので、2台の記録は合算され、
   * 同じファイルを何度読み込んでも増えない。進行中のセッションには触れない。
   */
  function importHistory(name, text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      showMessage(['「' + name + '」: JSON として読めません。記録は変えていません。'], true, 'history-msg');
      return;
    }
    var v = Q.validateHistory(data);
    if (!v.ok) {
      var lines = ['「' + name + '」に誤りがあるため、記録は変えていません:'];
      v.errors.slice(0, MAX_ERRORS_SHOWN).forEach(function (e) { lines.push('・' + e); });
      if (v.errors.length > MAX_ERRORS_SHOWN) lines.push('ほか ' + (v.errors.length - MAX_ERRORS_SHOWN) + ' 件');
      showMessage(lines, true, 'history-msg');
      return;
    }
    var r = Q.unionLog(state.log, Q.historyToLog(data));
    // 保存できてから画面の状態を変える（失敗したら何も変えない）
    S.addLog(r.added).then(function () {
      setLog(r.log);
      state.positions = Q.mergePositions(state.positions, data.positions);
      S.savePositions(state.positions);
      renderHome();
      var clears = r.added.filter(function (x) { return x.kind === 'clear'; }).length;
      var lucks = r.added.filter(function (x) { return x.kind === 'lucky'; }).length;
      showMessage(['記録を読み込みました（追加 ' + (r.added.length - clears - lucks) + '件の回答' +
        (clears ? '・消去の印 ' + clears + '件' : '') + (lucks ? '・まぐれの印 ' + lucks + '件' : '') +
        '・合計 ' + r.log.length + '件）。'],
        false, 'history-msg');
    }).catch(function (e) {
      showMessage(['記録を保存できませんでした: ' + e], true, 'history-msg');
    });
  }

  function onHistoryFile(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    file.text().then(function (text) { importHistory(file.name, text); }).finally(function () {
      ev.target.value = '';
    });
  }

  /* ===================== セッションの開始 ===================== */

  function startSession(mode, order, desc) {
    state.session = { mode: mode, order: order, pos: 0, answers: {}, desc: desc || '' };
    state.finished = null;
    S.saveSession(state.session);
    renderQuestion();
  }

  function onStart() {
    var mode = selectedMode();
    if (mode === 'mock') {
      var mockSets = candidateSets(mode);
      if (Q.countQuestions(mockSets) === 0) {
        renderStartCount();
        return;
      }
      if (state.mock && !confirm('途中の模擬試験があります。新しく始めると、途中の分は消えます。よろしいですか？')) return;
      startMock(mockSets[0], selectedMockMode() === 'practice');
      return;
    }
    if (state.session && !confirm('途中の問題があります。新しく始めると、途中の分は消えます。よろしいですか？')) return;
    var sets = candidateSets(mode);
    if (Q.countQuestions(sets) === 0) {
      renderStartCount();
      return;
    }
    var order;
    if (mode === 'all-random' || mode === 'wrong' || mode === 'unseen') {
      order = Q.allRandomOrder(sets, selectedCount(), Math.random);
    } else if (mode === 'weak') {
      order = Q.weakOrder(sets, state.summary, selectedCount(), Math.random);
    } else {
      order = mode === 'seq' ? Q.sequentialOrder(sets[0]) : Q.randomOrder(sets[0], Math.random);
    }
    startSession(mode, order, describeStart(mode));
  }

  /** 続きからの下に出す説明（出題方法・問題集・絞り込み） */
  function describeStart(mode) {
    var parts = [MODE_NAMES[mode]];
    if (mode !== 'all-random') {
      var opt = $('set-select').selectedOptions[0];
      var id = $('set-select').value;
      var set = state.sets.filter(function (s) { return s.id === id; })[0];
      parts.push(set ? set.title : (opt ? opt.textContent : ''));
    }
    if (mode === 'weak') parts.push('正答率' + Math.round(selectedThreshold() * 100) + '%未満か最後に不正解');
    if (!$('filter-field').hidden && currentFilter().type !== 'all') {
      parts.push($('filter-select').selectedOptions[0].textContent);
    }
    return parts.join('：');
  }

  /* ===================== 問題 ===================== */

  function renderQuestion() {
    var s = state.session;
    var key = s.order[s.pos];
    var answer = s.answers[key] || null;
    if (!answer) state.currentOrder = orderForDisplay(s, key);
    drawQuestion(key, answer ? answer.order : state.currentOrder, answer, false);
    showScreen('quiz');
  }

  /**
   * 回答前の問題の表示順。同じ問題をもう一度描くとき（続きから）はセッションに残した並びを使い、
   * 並べ替えも位置の記録もしない。新しく表示するときは、前回の正解の位置を避けて並べ、
   * その位置を記録する（回答しなくても、次に出すときは別の位置になる）。
   */
  function orderForDisplay(s, key) {
    if (s.shown && s.shown.key === key) return s.shown.order;
    var q = state.index[key].question;
    var order = Q.choiceOrder(q, Math.random, state.positions[key]);
    if (!q.fixedOrder) {
      state.positions = Object.assign({}, state.positions);
      state.positions[key] = Q.correctPosition(q, order);
      S.savePositions(state.positions);
    }
    s.shown = { key: key, order: order };
    S.saveSession(s);
    return order;
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
    $('btn-quit').textContent = review ? (state.reviewFrom === 'stats' ? '成績へ' : '結果へ') : '中断';

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

    // 成績の画面からの見返しは回答が無い（picked が null）。判定は出さず、正解だけを示す
    var verdict = $('q-verdict');
    verdict.hidden = !answer || answer.picked == null;
    $('q-after').hidden = !answer;
    $('btn-lucky').hidden = true;   // 回答後に下で出し直す
    if (!answer) return;

    verdict.textContent = answer.correct ? (answer.lucky ? '正解（まぐれ）' : '正解') : '不正解';
    verdict.classList.toggle('is-correct', answer.correct);
    verdict.classList.toggle('is-wrong', !answer.correct);

    // まぐれの印は、回答した直後の画面でだけ操作できる（見返しでは出さない）。
    // logId の無い回答（この機能より前に始めたセッション）では出さない
    var lucky = $('btn-lucky');
    lucky.hidden = review || !answer.correct || !answer.logId;
    lucky.textContent = answer.lucky ? 'まぐれにしました（取り消す）' : 'まぐれ（あとで復習）';
    lucky.classList.toggle('is-on', !!answer.lucky);

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
    if (review) next.textContent = state.reviewFrom === 'stats' ? '成績に戻る' : '結果に戻る';
    else next.textContent = state.session.pos + 1 >= state.session.order.length ? '結果を見る' : '次の問題へ';
  }

  function tag(text, cls) {
    var span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    return span;
  }

  function countCorrect(s) {
    return s.order.filter(function (k) { return Q.answerCorrect(s.answers[k]); }).length;
  }

  function onPick(displayIndex) {
    var s = state.session;
    var key = s.order[s.pos];
    if (s.answers[key]) return;   // 選び直しはできない
    var q = state.index[key].question;
    var r = Q.judge(q, state.currentOrder, displayIndex);
    var now = new Date();
    var entry = { id: S.newLogId(now), key: key, at: now.toISOString(), ok: r.correct };
    s.answers[key] = { order: state.currentOrder, picked: r.original, correct: r.correct, logId: entry.id, lucky: false };
    S.saveSession(s);
    setLog(state.log.concat([entry]));
    S.addLog([entry]).catch(function (e) {
      showMessage(['回答の記録を保存できませんでした: ' + e], true, 'history-msg');
    });
    drawQuestion(key, state.currentOrder, s.answers[key], false);
  }

  /**
   * まぐれの印を付ける・取り消す。回答の記録は書き換えず、印 { kind: 'lucky', ref, on } を足す
   * （書き換えは和集合でもう一方の端末に伝わらないため）。印が保存できてから表示を変える。
   */
  function onLucky() {
    var s = state.session;
    var key = s.order[s.pos];
    var a = s.answers[key];
    if (!a || !a.correct || !a.logId) return;
    var now = new Date();
    var mark = { id: S.newLogId(now), kind: 'lucky', ref: a.logId, on: !a.lucky, at: now.toISOString() };
    S.addLog([mark]).then(function () {
      a.lucky = mark.on;
      S.saveSession(s);
      setLog(state.log.concat([mark]));
      drawQuestion(key, a.order, a, false);
    }).catch(function (e) {
      alert('まぐれの印を保存できませんでした: ' + e);
    });
  }

  function onNext() {
    if (state.reviewKey) {
      state.reviewKey = null;
      showScreen(state.reviewFrom || 'result');
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

  /* ===================== 模擬試験 ===================== */

  var mockTimer = null;

  /** 途中の模擬試験の問題がすべて手元にあるか（問題集を消した・置き換えたときに崩れる） */
  function mockUsable(m) {
    return !!m && Array.isArray(m.order) && m.order.length > 0 && typeof m.startedAt === 'number' &&
      m.answers && m.flags && m.order.every(function (k) { return !!state.index[k]; });
  }

  function mockLeft() {
    return Q.remainingSeconds(state.mock.startedAt, state.mock.limitSec, Date.now());
  }

  function startMock(set, practice) {
    state.mock = {
      setId: set.id, title: set.title, practice: !!practice,
      order: Q.sequentialOrder(set),   // 本番と同じ問番号の順
      answers: {},                     // 鍵 → 選んだ選択肢（元の番号・0始まり）
      inTime: {},                      // 鍵 → 制限時間内に選んでいた答え（時間外に選び直しても変わらない）
      flags: {},                       // 鍵 → true（あとで見直す）
      pos: 0, startedAt: Date.now(), limitSec: Q.MOCK_LIMIT_SEC,
    };
    state.finished = null;
    S.saveMock(state.mock);
    renderMock();
  }

  function renderMockResume() {
    var m = mockUsable(state.mock) ? state.mock : null;
    if (state.loaded && state.mock && !m) {
      state.mock = null;
      S.clearMock();
    }
    $('mock-resume-card').hidden = !m;
    if (!m) return;
    var st = Q.mockStatus(m.order, m.answers, m.flags);
    $('mock-resume-desc').textContent = m.title + '（' + (m.practice ? '練習' : 'リハーサル') + '）：回答 ' + st.answered + ' / ' + m.order.length +
      (mockLeft() > 0 ? '・残り ' + Q.formatClock(mockLeft()) : (m.practice ? '・時間を過ぎています' : '・時間切れです'));
  }

  var mockBuilt = null;    // いま画面に組んである模擬試験の開始時刻（別の試験になったら組み直す）
  var mockScroll = 0;      // 見直し一覧へ行く前のスクロール位置

  /** 解答画面を出す。jumpIdx があればその問題へ、scrollY があればその位置へ移る */
  function renderMock(jumpIdx, scrollY) {
    if (mockBuilt !== state.mock.startedAt) buildMockPage();
    showScreen('mock');
    if (typeof jumpIdx === 'number') {
      var card = $('mq-' + jumpIdx);
      if (card) card.scrollIntoView();
    } else if (typeof scrollY === 'number') {
      window.scrollTo(0, scrollY);
    }
  }

  function updateMockHeader() {
    var m = state.mock;
    var st = Q.mockStatus(m.order, m.answers, m.flags);
    $('mk-progress').textContent = '解答数 ' + st.answered + '/' + m.order.length + '問';
  }

  /** 全問を縦に並べて組む。選択肢は本番と同じ並びのまま。答えても正誤は出さず、選び直せる */
  function buildMockPage() {
    var m = state.mock;
    var list = $('mk-list');
    list.textContent = '';
    m.order.forEach(function (key, idx) {
      var q = state.index[key].question;
      var card = document.createElement('section');
      card.className = 'qd-card qd-mq';
      card.id = 'mq-' + idx;

      var head = document.createElement('div');
      head.className = 'qd-mock-head';
      var no = document.createElement('span');
      no.className = 'qd-qno';
      no.textContent = 'Q' + (q.no !== undefined ? q.no : idx + 1);
      var blank = document.createElement('span');
      blank.className = 'qd-unanswered';
      blank.textContent = '未解答';
      var spacer = document.createElement('span');
      spacer.className = 'qd-spacer';
      var flag = document.createElement('label');
      flag.className = 'qd-flag';
      var box = document.createElement('input');
      box.type = 'checkbox';
      var flagText = document.createElement('span');
      flagText.textContent = 'あとで見直す';
      flag.appendChild(box);
      flag.appendChild(flagText);
      head.appendChild(no);
      head.appendChild(blank);
      head.appendChild(spacer);
      head.appendChild(flag);
      card.appendChild(head);

      var text = document.createElement('p');
      text.className = 'qd-qtext';
      text.textContent = q.question;
      card.appendChild(text);

      if (q.image) {
        var fig = document.createElement('figure');
        fig.className = 'qd-figure';
        var img = document.createElement('img');
        img.src = q.image;
        img.alt = q.imageAlt || '問題の図';
        img.addEventListener('click', openLightbox);
        fig.appendChild(img);
        card.appendChild(fig);
      }

      var choices = document.createElement('ol');
      choices.className = 'qd-choices';
      var buttons = q.choices.map(function (choice, i) {
        var li = document.createElement('li');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'qd-choice';
        var num = document.createElement('span');
        num.className = 'qd-choice-num';
        num.textContent = String(i + 1);
        var label = document.createElement('span');
        label.className = 'qd-choice-text';
        label.textContent = choice;
        btn.appendChild(num);
        btn.appendChild(label);
        btn.addEventListener('click', function () {
          m.answers[key] = i;
          // 制限時間を過ぎたあとの答えは、時間内の得点には数えない（練習モードで続けたとき）
          if (Date.now() - m.startedAt <= m.limitSec * 1000) {
            if (!m.inTime) m.inTime = {};
            m.inTime[key] = i;
          }
          S.saveMock(m);
          refresh();
          updateMockHeader();
        });
        li.appendChild(btn);
        choices.appendChild(li);
        return btn;
      });
      card.appendChild(choices);

      box.addEventListener('change', function () {
        if (box.checked) m.flags[key] = true;
        else delete m.flags[key];
        S.saveMock(m);
      });

      function refresh() {
        var picked = m.answers[key];
        blank.hidden = picked !== undefined;
        buttons.forEach(function (btn, i) { btn.classList.toggle('is-selected', picked === i); });
      }
      box.checked = !!m.flags[key];
      refresh();
      list.appendChild(card);
    });
    mockBuilt = m.startedAt;
    updateMockHeader();
  }

  function renderMockReview() {
    var m = state.mock;
    mockScroll = window.scrollY;
    // 見直し一覧に見える「あとで見直す」の印や答えは、いまの画面の状態に合わせる
    var st = Q.mockStatus(m.order, m.answers, m.flags);
    $('mr-summary').textContent = '回答 ' + st.answered + ' / ' + m.order.length +
      '・未解答 ' + st.unanswered.length + '・あとで見直す ' + st.flagged.length;
    var list = $('mr-list');
    list.textContent = '';
    m.order.forEach(function (key, idx) {
      var q = state.index[key].question;
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      var answered = m.answers[key] !== undefined;
      btn.className = 'qd-mr-cell ' + (answered ? 'is-answered' : 'is-unanswered') + (m.flags[key] ? ' is-flagged' : '');
      btn.textContent = String(q.no !== undefined ? q.no : idx + 1);
      btn.setAttribute('aria-label', '問' + btn.textContent + (answered ? '' : '（未解答）') + (m.flags[key] ? '（あとで見直す）' : ''));
      btn.addEventListener('click', function () { renderMock(idx); });
      li.appendChild(btn);
      list.appendChild(li);
    });
    showScreen('mockreview');
  }

  /** 残り時間を出す。リハーサルは0になったら自動で提出する（本番の時間切れの扱いは手引きに書かれていない）。練習は提出しない */
  function tickMock() {
    if (!state.mock) {
      stopMockTimer();
      return;
    }
    var m = state.mock;
    var left = mockLeft();
    var text = '残り ' + Q.formatClock(left);
    // 練習モードは時間を過ぎても続けられる。超えた分を数える
    if (left <= 0 && m.practice) text = '超過 ' + Q.formatClock(Q.overSeconds(m.startedAt, m.limitSec, Date.now()));
    ['mk-clock', 'mr-clock'].forEach(function (id) {
      var el = $(id);
      el.textContent = text;
      el.classList.toggle('is-low', left <= 300);
    });
    if (left <= 0 && !m.practice) {
      stopMockTimer();
      submitMock(true);
    }
  }

  function startMockTimer() {
    if (mockTimer) clearInterval(mockTimer);   // 解答画面と見直し一覧の行き来では、画面点灯を外さない
    mockTimer = null;
    if (!state.mock) { releaseWakeLock(); return; }
    tickMock();
    mockTimer = setInterval(tickMock, 1000);
    acquireWakeLock();
  }

  function stopMockTimer() {
    if (mockTimer) clearInterval(mockTimer);
    mockTimer = null;
    releaseWakeLock();
  }

  /* 模擬試験の間は画面を点けたままにする（Screen Wake Lock。使えない端末では何もしない）。
     別のタブやアプリへ移ると自動で外れるので、戻ってきたとき（visibilitychange）に取り直す */
  var wakeLock = null;

  function showWakeNote(on) {
    var el = $('mk-wake');
    if (el) el.hidden = !on;
  }

  function acquireWakeLock() {
    if (!navigator.wakeLock || wakeLock || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(function (lock) {
      if (!mockTimer) { lock.release(); return; }   // 取れる前に画面を離れていた
      wakeLock = lock;
      showWakeNote(true);
      lock.addEventListener('release', function () {
        if (wakeLock === lock) wakeLock = null;
        showWakeNote(false);
      });
    }).catch(function () { showWakeNote(false); });
  }

  function releaseWakeLock() {
    var lock = wakeLock;
    wakeLock = null;
    showWakeNote(false);
    if (lock) lock.release().catch(function () {});
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && mockTimer) acquireWakeLock();
  });

  /** 提出する。未解答の問題も不正解として学習の記録に残す（あとで「前に間違えた問題」で解き直せる） */
  function submitMock(auto) {
    var m = state.mock;
    if (!m) return;
    var st = Q.mockStatus(m.order, m.answers, m.flags);
    if (!auto) {
      var msg = (st.unanswered.length ? '未解答が ' + st.unanswered.length + '問あります。' : '') +
        '提出すると、続きは解けません。提出しますか？';
      if (!confirm(msg)) return;
    }
    var now = new Date();
    var answers = {};
    var entries = [];
    var inTime = {};
    m.order.forEach(function (key) {
      var q = state.index[key].question;
      var picked = m.answers[key];
      var within = (m.inTime || m.answers)[key];
      inTime[key] = within === undefined ? null : within;
      var has = picked !== undefined;
      var correct = has && Q.isCorrectOriginal(q, picked);
      var id = S.newLogId(now);
      entries.push({ id: id, key: key, at: now.toISOString(), ok: correct });
      answers[key] = {
        order: q.choices.map(function (_, i) { return i; }),
        picked: has ? picked : null, correct: correct, logId: id, lucky: false,
      };
    });
    state.finished = {
      mode: 'mock', order: m.order.slice(), pos: 0, answers: answers, desc: '模擬試験（' + (m.practice ? '練習' : 'リハーサル') + '）：' + m.title,
      elapsedSec: m.practice ? Math.round((Date.now() - m.startedAt) / 1000) : Math.min(m.limitSec, Math.round((Date.now() - m.startedAt) / 1000)),
      limitSec: m.limitSec, auto: !!auto, practice: !!m.practice, inTime: inTime,
    };
    state.mock = null;
    mockBuilt = null;
    S.clearMock();
    setLog(state.log.concat(entries));
    S.addLog(entries).catch(function (e) {
      showMessage(['回答の記録を保存できませんでした: ' + e], true, 'history-msg');
    });
    renderResult();
    showScreen('result');
  }

  /**
   * 結果画面の補足（模擬試験のときだけ）：制限時間内の得点・合格ライン・所要時間・未解答。
   * 練習モードは時間を過ぎても続けられるので、時間内に選んでいた答えだけの得点と、時間外を含めた得点を並べる
   * （差が「もっと速く解けていれば届いた点数」）。合格ラインは時間内の得点で判定する（本番は時間内のものだけ）
   */
  function renderResultExtra(f, sc) {
    var lines = [];
    if (f.mode === 'mock') {
      var within = Q.score(f.order.map(function (k) {
        var q = state.index[k].question;
        var picked = f.inTime ? f.inTime[k] : f.answers[k].picked;
        return { key: k, question: q, correct: picked !== null && picked !== undefined && Q.isCorrectOriginal(q, picked) };
      }));
      if (f.practice) {
        var gain = sc.points - within.points;
        lines.push('制限時間内の得点 ' + within.points + '点。時間外の答えを含めると ' + sc.points + '点（' +
          (gain > 0 ? '時間外で ' + gain + '点増えました' : gain < 0 ? '時間外の選び直しで ' + (-gain) + '点減りました' : '時間外で変わった点数はありません') + '）');
      }
      var pass = Q.passResult(within);
      if (pass) {
        lines.push('合格ライン ' + pass.line + '点（' + within.maxPoints + '点満点、' + (f.practice ? '制限時間内の得点' : '得点') + 'で判定）：' +
          (pass.ok ? '超えました' : 'あと ' + pass.short + '点'));
      }
      lines.push((f.practice ? '練習モード。' : 'リハーサル。') + '所要時間 ' + Q.formatClock(f.elapsedSec) + '（制限 ' + Q.formatClock(f.limitSec) + '）' +
        (f.auto ? '。時間切れで自動的に提出しました' : (f.elapsedSec > f.limitSec ? '。制限を ' + Q.formatClock(f.elapsedSec - f.limitSec) + ' 超えました' : '')));
      var blank = f.order.filter(function (k) { return f.answers[k].picked === null; }).length;
      if (blank) lines.push('未解答 ' + blank + '問（不正解として数えています）');
      $('r-points').textContent = '得点 ' + sc.points + ' / ' + sc.maxPoints + ' 点' + (f.practice ? '（時間外を含む）' : '');
    }
    $('r-extra').hidden = lines.length === 0;
    $('r-extra').textContent = lines.join('\n');
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
      return { key: k, question: state.index[k].question, correct: Q.answerCorrect(f.answers[k]) };
    });
    var sc = Q.score(results);
    $('r-summary').textContent = sc.correct + ' / ' + sc.total + ' 問正解';
    $('r-rate').textContent = '正答率 ' + Math.round(sc.correct / sc.total * 100) + '%';
    var lucky = f.order.filter(function (k) { return f.answers[k] && f.answers[k].lucky; }).length;
    $('r-lucky').hidden = lucky === 0;
    $('r-lucky').textContent = 'うち まぐれ ' + lucky + '問（不正解として数えています）';
    $('r-points').hidden = !sc.hasPoints;
    $('r-points').textContent = '得点 ' + sc.points + ' / ' + sc.maxPoints + ' 点';
    renderResultExtra(f, sc);

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
    state.reviewFrom = 'result';
    drawQuestion(key, a.order, a, true);
    showScreen('quiz');
  }

  function onRetry() {
    var f = state.finished;
    var wrong = f.order.filter(function (k) { return !Q.answerCorrect(f.answers[k]); });
    if (wrong.length) startSession('retry', wrong);
  }

  /* ===================== 成績 ===================== */

  function percent(rate) {
    return rate == null ? '—' : Math.round(rate * 100) + '%';
  }

  /** 集計1件をカード1枚にする（表は横にはみ出すのでカードにする） */
  function statCard(title, g) {
    var li = document.createElement('li');
    li.className = 'qd-stat-item';
    var h = document.createElement('span');
    h.className = 'qd-stat-title';
    h.textContent = title;
    var line = document.createElement('span');
    line.className = 'qd-stat-line';
    line.textContent = '解いた ' + g.answered + ' / ' + g.questions + '問・正答率 ' + percent(g.rate) + '・苦手 ' + g.weak + '問' +
      (g.lucky ? '・まぐれ ' + g.lucky + '問' : '');
    li.appendChild(h);
    li.appendChild(line);
    return li;
  }

  /**
   * 問題集の記録を消す。ログからは消さず「消去の印」を足す（墓標）。消すだけだと、もう一方の
   * 端末のファイルを読み込んだときに和集合で戻ってしまうため。印は書き出し・読み込みで伝わる。
   * 前回の正解の位置は端末の中だけで消す。進行中のセッションには触れない。
   */
  function clearSetRecord(set) {
    var n = Q.countSetAnswers(state.log, set.id);
    if (!confirm('「' + set.title + '」の記録（回答 ' + n + '件）を消します。' +
      'ほかの端末でも、この端末の記録を読み込むと消えます。元に戻せません。よろしいですか？')) return;
    var now = new Date();
    var mark = { id: S.newLogId(now), kind: 'clear', setId: set.id, at: now.toISOString() };
    S.addLog([mark]).then(function () {
      setLog(state.log.concat([mark]));
      state.positions = Q.removeSetPositions(state.positions, set.id);
      S.savePositions(state.positions);
      renderHome();
      renderStats();
    }).catch(function (e) {
      alert('記録を消せませんでした: ' + e);
    });
  }

  function renderStats() {
    var th = Q.DEFAULT_WEAK_THRESHOLD;
    var r = Q.statsReport(state.sets, state.summary, th);
    $('st-total').textContent = '解いた問題 ' + r.total.answered + ' / ' + r.total.questions + '問';
    $('st-total-sub').textContent = '回答 ' + r.total.answers + '件・正答率 ' + percent(r.total.rate) +
      '・まぐれ ' + r.total.lucky + '問';
    $('st-threshold').textContent = '苦手 = 正答率' + Math.round(th * 100) + '%未満か、最後に不正解だった問題';

    var bySet = $('st-sets');
    bySet.textContent = '';
    r.bySet.forEach(function (g) {
      var li = statCard(g.title, g);
      var set = state.sets.filter(function (x) { return x.id === g.id; })[0];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tb-btn tb-btn--ghost qd-stat-clear';
      btn.textContent = 'この問題集の記録を消す';
      btn.disabled = g.answers === 0;   // 数えている回答が無ければ消すものが無い
      btn.addEventListener('click', function () { clearSetRecord(set); });
      li.appendChild(btn);
      bySet.appendChild(li);
    });

    var byCat = $('st-cats');
    byCat.textContent = '';
    r.byCategory.forEach(function (g) { byCat.appendChild(statCard(g.category === null ? '（分類なし）' : g.category, g)); });
    $('st-cats-card').hidden = r.byCategory.length === 0 ||
      (r.byCategory.length === 1 && r.byCategory[0].category === null);

    var list = $('st-weak');
    list.textContent = '';
    r.weakList.forEach(function (w) {
      var e = state.index[w.key];
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qd-wrong-item';
      var label = document.createElement('span');
      label.className = 'qd-wrong-label';
      label.textContent = Q.questionLabel(e.set, e.question, e.index);
      var text = document.createElement('span');
      text.className = 'qd-wrong-text';
      text.textContent = (e.question.category ? e.question.category + '・' : '') +
        w.attempts + '回・正答率 ' + percent(w.rate);
      btn.appendChild(label);
      btn.appendChild(text);
      btn.addEventListener('click', function () { reviewFromStats(w.key); });
      li.appendChild(btn);
      list.appendChild(li);
    });
    $('st-noweak').hidden = r.weakList.length > 0;
  }

  /** 成績の画面から、その問題の回答後の表示（元の番号の選択肢と解説）を見る。並べ替えも記録もしない */
  function reviewFromStats(key) {
    var q = state.index[key].question;
    state.reviewKey = key;
    state.reviewFrom = 'stats';
    var order = q.choices.map(function (_, i) { return i; });
    drawQuestion(key, order, { order: order, picked: null, correct: null }, true);
    showScreen('quiz');
  }

  function openStats() {
    renderStats();
    showScreen('stats');
  }

  /* ===================== 画像の拡大 ===================== */

  function openLightbox(ev) {
    var img = (ev && ev.currentTarget) || $('q-image');   // 押した画像を拡大する（問題画面・模擬試験の両方で使う）
    $('lightbox-img').src = img.src;
    $('lightbox-img').alt = img.alt;
    $('lightbox').hidden = false;
  }

  function closeLightbox() {
    $('lightbox').hidden = true;
  }

  /* ===================== 起動 ===================== */

  $('file-input').addEventListener('change', onFiles);
  $('book-input').addEventListener('change', onBookFiles);
  $('tab-drill').addEventListener('click', function () { selectTab('drill'); });
  $('tab-book').addEventListener('click', function () { selectTab('book'); });
  $('btn-export').addEventListener('click', exportHistory);
  $('btn-export-result').addEventListener('click', exportHistory);
  $('btn-stats').addEventListener('click', openStats);
  $('btn-stats-home').addEventListener('click', function () { renderHome(); showScreen('home'); });
  $('history-input').addEventListener('change', onHistoryFile);
  $('btn-sample').addEventListener('click', loadSample);
  $('btn-start').addEventListener('click', onStart);
  $('btn-resume').addEventListener('click', renderQuestion);
  $('btn-next').addEventListener('click', onNext);
  $('btn-lucky').addEventListener('click', onLucky);
  $('btn-quit').addEventListener('click', onQuit);
  $('btn-retry').addEventListener('click', onRetry);
  $('btn-home').addEventListener('click', function () { renderHome(); showScreen('home'); });
  $('btn-mock-resume').addEventListener('click', function () { renderMock(); });
  $('btn-mk-review').addEventListener('click', renderMockReview);
  $('btn-mr-back').addEventListener('click', function () { renderMock(null, mockScroll); });
  $('btn-mr-submit').addEventListener('click', function () { submitMock(false); });
  $('q-image').addEventListener('click', openLightbox);
  $('lightbox').addEventListener('click', closeLightbox);
  Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (el) {
    el.addEventListener('change', renderModeFields);
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="count"]'), function (el) {
    el.addEventListener('change', renderStartCount);
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="threshold"]'), function (el) {
    el.addEventListener('change', renderStartCount);
  });
  $('set-select').addEventListener('change', renderStartCount);
  Array.prototype.forEach.call(document.querySelectorAll('input[name="mockmode"]'), function (el) {
    el.addEventListener('change', renderMockModeNote);
  });
  $('filter-select').addEventListener('change', renderStartCount);

  state.session = S.loadSession();
  initLog().catch(function (e) {
    showMessage(['学習の記録を読み出せませんでした: ' + e], true, 'history-msg');
  }).then(reloadSets).catch(function (e) {
    renderHome();
    showMessage(['保存した問題集を読み出せませんでした: ' + e], true);
  }).then(reloadBooks).catch(function (e) {
    showMessage(['保存した自作テキストを読み出せませんでした: ' + e], true, 'book-msg');
  });
})();
