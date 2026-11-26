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

  /* ===================== 版の食い違いからの復帰 =====================
   * 古い index.html ＋ 新しい app.js の組み合わせで起動すると、新しい JS が古い HTML に無い要素を触って落ち、
   * 画面が動かなくなる（ブラウザは HTML を10分、JS をURLごとにキャッシュする）。
   * index.html に埋めた <meta name="app-version"> と version.js の版を突き合わせ、食い違っていたら
   * HTML を読み直す（cache-busting の ?r= を付けて）。無限に繰り返さないよう、自動では1回だけ。
   * meteor-settings と同じ考え方（Service Worker は使わない）。
   */
  var RECOVERY_KEY = 'qd-recovery';

  function stampedVersion() {
    var m = document.querySelector('meta[name="app-version"]');
    return m ? m.getAttribute('content') : null;
  }

  function showBanner(text, actionLabel, onAction) {
    if (document.getElementById('qdBanner')) return;
    var bar = document.createElement('div');
    bar.id = 'qdBanner';
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:10px 12px;font:13px/1.5 system-ui,sans-serif;' +
      'background:#4a1f14;color:#ffd9c9;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.5)';
    bar.appendChild(document.createTextNode(text + ' '));
    if (actionLabel) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.style.cssText = 'margin-left:6px;padding:3px 10px;border-radius:6px;border:1px solid #ffd9c9;background:transparent;color:#ffd9c9;font:inherit';
      btn.addEventListener('click', onAction);
      bar.appendChild(btn);
    }
    (document.body || document.documentElement).appendChild(bar);
  }

  /** HTML を、キャッシュを避けて読み直す */
  function reloadFresh(reason) {
    try { sessionStorage.setItem(RECOVERY_KEY, reason); } catch (e) { /* 続行する */ }
    location.replace(location.pathname + '?r=' + Date.now());
  }

  /** 食い違っていたら true（このとき app.js は起動しない） */
  function versionMismatch() {
    var js = typeof QD_VERSION !== 'undefined' ? QD_VERSION.version : null;
    if (stampedVersion() === js && js !== null) {
      try { sessionStorage.removeItem(RECOVERY_KEY); } catch (e) { /* 無視 */ }
      return false;
    }
    var tried = null;
    try { tried = sessionStorage.getItem(RECOVERY_KEY); } catch (e) { /* 無視 */ }
    if (!tried) { reloadFresh('version-mismatch'); return true; }
    showBanner('ファイルの版が揃っていません。', '作り直す', function () { reloadFresh('manual'); });
    return true;
  }

  if (versionMismatch()) return;

  /** 設定タブに、いま動いている版と更新日時を出す */
  function renderVersion() {
    var el = document.getElementById('app-version');
    if (el) el.textContent = '版 ' + QD_VERSION.version + '・' + QD_VERSION.updated;
  }

  var Q = QD_QUIZ;
  var S = QD_STORAGE;
  var AN = QD_ANALYSIS;
  var CH = QD_CHARTS;

  var MODE_NAMES = {
    'seq': '問題集ごとに通し',
    'set-random': '問題集の中でランダム',
    'all-random': '全問題からランダム',
    'wrong': '前に間違えた問題',
    'unseen': 'まだ解いていない問題',
    'mock': '模擬試験',
    'weak': '苦手な問題',
    'retry': '間違えた問題だけもう一度',
    'daily': '今日の一問',
  };
  var ALL_SETS = '';   // 問題集の選択肢の「すべての問題集」（前に間違えた問題・苦手な問題でだけ出す）
  var MAX_ERRORS_SHOWN = 20;
  var EXCERPT_LEN = 40;

  var state = {
    sets: [],          // 読み込み済みの問題集（保存順）
    texts: [],         // 読み込み済みの自作テキスト（保存順）
    mock: S.loadMock(), // 進行中の模擬試験（無ければ null）
    tab: ['book', 'analysis', 'settings'].indexOf(S.loadTab()) >= 0 ? S.loadTab() : 'drill',   // ホームで開いているタブ
    bookId: S.loadBookTab(),   // 自作テキストのサブタブで選んでいるテキストの id
    index: {},         // 鍵 → { set, question, index }
    session: null,     // 進行中のセッション
    finished: null,    // 直前に終えたセッション（結果画面と見返し用）
    log: [],           // 学習の記録（回答ごとのログ）
    summary: {},       // ログの集計（鍵 → { attempts, corrects, wrongs, rate, last, lastAt }）
    dailyExcluded: Q.parseExcludedSets(S.loadDailyExcluded()),   // 今日の一問の対象から外した問題集の id
    positions: S.loadPositions(),   // 鍵 → 前回表示したときの代表の正解の表示位置
    currentOrder: null, // 回答前の問題の表示順
    reviewKey: null,   // 結果画面・成績の画面から見返している問題の鍵
    reviewFrom: null,  // 見返しから戻る画面（'result' | 'stats' | 'search'）
    loaded: false,     // 保存済みの問題集を読み出せたか
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ===================== 画面の切り替え ===================== */

  function showScreen(name) {
    ['home', 'quiz', 'result', 'stats', 'search', 'mock', 'mockreview'].forEach(function (n) {
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
    renderWipe();
    var has = state.sets.length > 0;
    $('empty-guide').hidden = has;
    $('start-card').hidden = !has;
    $('search-card').hidden = !has;
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
    restoreStartChoices();
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
    renderDaily();
    renderDailySettings();
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
    $('wrongsince-field').hidden = mode !== 'wrong';
    renderWrongDate();
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

  /** 「はじめる」を押したときの選択を覚えておく。次に開いたときに同じ選択から始められる */
  function saveStartChoices() {
    var checked = function (name) {
      var el = document.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : null;
    };
    S.saveStart({
      mode: checked('mode'), set: $('set-select').value, filter: $('filter-select').value,
      count: checked('count'), threshold: checked('threshold'), rest: checked('rest'), mockmode: checked('mockmode'),
      wrongsince: $('wrongsince-select').value, wrongdate: $('wrongdate-input').value, wrongfixed: checked('wrongfixed'),
    });
  }

  /** 覚えておいた選択を戻す（最初の1回だけ）。いまの問題集に無い値は、そのまま既定にしておく */
  var startRestored = false;
  function restoreStartChoices() {
    if (startRestored || !state.sets.length) return;
    startRestored = true;
    var v = S.loadStart();
    if (!v || typeof v !== 'object') return;
    var pick = function (name, value) {
      if (typeof value !== 'string') return;
      var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
      if (el) el.checked = true;
    };
    var setSelect = function (id, value) {
      var select = $(id);
      if (typeof value !== 'string') return;
      if (Array.prototype.some.call(select.options, function (o) { return o.value === value; })) select.value = value;
    };
    pick('mode', v.mode);
    pick('count', v.count);
    pick('threshold', v.threshold);
    pick('rest', v.rest);
    pick('mockmode', v.mockmode);
    pick('wrongfixed', v.wrongfixed);
    renderModeFields();            // 出題方法に合わせて問題集の選択肢を作り直す
    setSelect('set-select', v.set);
    setSelect('filter-select', v.filter);
    setSelect('wrongsince-select', v.wrongsince);
    if (typeof v.wrongdate === 'string') $('wrongdate-input').value = v.wrongdate;
    renderWrongDate();
    renderMockModeNote();
    renderStartCount();
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

  /** 苦手な問題で、最近正解した問題を外す時間（時間）。0 なら外さない */
  function selectedRest() {
    var el = document.querySelector('input[name="rest"]:checked');
    return el ? Number(el.value) : 0;
  }

  /** 前に間違えた問題で、いつ間違えたかの選択（quiz.js の wrongSinceMs に渡す形） */
  function selectedWrongSince() {
    var v = $('wrongsince-select').value;
    if (v === 'date') return { type: 'since', date: $('wrongdate-input').value };
    if (v === 'all') return { type: 'all' };
    return { type: 'within', days: Number(v) };
  }

  /** 間違えたあとに正解し直した問題も含めるか */
  function selectedWrongFixed() {
    var el = document.querySelector('input[name="wrongfixed"]:checked');
    return !!el && el.value === '1';
  }

  /** 「日付を指定」のときだけ日付の入力欄を出す。選択に合わせて、下の説明も直す */
  function renderWrongDate() {
    $('wrongdate-input').hidden = $('wrongsince-select').value !== 'date';
    $('wrongsince-note').textContent = selectedWrongFixed()
      ? 'この期間に一度でも不正解だった問題を出します。そのあと正解し直した問題も含みます。'
      : '最後に解いたときの不正解が、この期間にある問題だけを出します。正解し直した問題は出しません。';
  }

  /** 選んだ期間の説明（件数の文・続きからの説明に使う）。絞らないときは空 */
  function wrongSinceText() {
    var c = selectedWrongSince();
    if (Q.wrongSinceMs(c, Date.now()) == null) return '';
    if (c.type === 'within') return c.days === 1 ? '24時間以内' : c.days + '日以内';
    var p = c.date.split('-');
    return Number(p[0]) + '年' + Number(p[1]) + '月' + Number(p[2]) + '日以降';
  }

  /** いまの出題方法・問題集・絞り込みで対象になる問題集（問題を絞った写し） */
  function candidateSets(mode) {
    if (mode === 'mock') {
      var mockId = $('set-select').value;
      return state.sets.filter(function (set) { return set.id === mockId; });
    }
    var sets = Q.filterSets(state.sets, currentFilter());
    if (mode === 'wrong') {
      var sinceMs = Q.wrongSinceMs(selectedWrongSince(), Date.now());
      sets = selectedWrongFixed()
        ? Q.filterWrongKeys(sets, Q.wrongKeysSince(state.log, sinceMs))
        : Q.filterWrong(sets, state.summary, sinceMs);
    }
    if (mode === 'unseen') sets = Q.filterUnseen(sets, state.summary);
    if (mode === 'weak') {
      sets = Q.filterWeak(sets, state.summary, selectedThreshold());
      sets = Q.filterRecentCorrect(sets, state.summary, selectedRest(), Date.now());
    }
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
    if (mode === 'wrong') {
      var since = wrongSinceText();
      var label = '前に間違えた問題' + (since || selectedWrongFixed() ? '（' + [since, selectedWrongFixed() ? '正解し直した問題を含む' : ''].filter(Boolean).join('・') + '）' : '');
      text = n > 0 ? label + ': ' + n + '問' : label + 'はありません';
      if ($('wrongsince-select').value === 'date' && !$('wrongdate-input').value) text += '（日付を選ぶまでは、いつでも間違えた問題を出します）';
    }
    else if (mode === 'unseen') text = n > 0 ? 'まだ解いていない問題: ' + n + '問' : 'まだ解いていない問題はありません';
    else if (mode === 'mock') text = n > 0 ? '模擬試験: ' + n + '問・' + Math.round(Q.MOCK_LIMIT_SEC / 60) + '分（提出するまで正誤は出ません）' : '問題集を選んでください';
    else if (mode === 'weak') text = weakCountText(n);
    else text = n > 0 ? '対象: ' + n + '問' : '条件に合う問題がないため、開始できません';
    var el = $('start-count');
    el.textContent = text;
    el.classList.toggle('is-empty', n === 0);
    $('btn-start').disabled = n === 0;
  }

  /** 苦手な問題の件数の文。最近正解して外した分も添える（外した結果0問のときは、そう分かるように） */
  function weakCountText(n) {
    var all = Q.countQuestions(Q.filterWeak(candidateSetsBeforeRest(), state.summary, selectedThreshold()));
    var skipped = all - n;
    if (n > 0) return '苦手な問題: ' + n + '問' + (skipped > 0 ? '（最近正解した ' + skipped + '問を除く）' : '');
    return skipped > 0 ? '苦手な問題はすべて最近正解したので、いまは出せません（' + skipped + '問）' : '苦手な問題はありません';
  }

  /** 苦手の絞り込みの前の、問題集と絞り込みだけを当てた問題集 */
  function candidateSetsBeforeRest() {
    var sets = Q.filterSets(state.sets, currentFilter());
    var id = $('set-select').value;
    return id === ALL_SETS ? sets : sets.filter(function (set) { return set.id === id; });
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
    ['drill', 'book', 'analysis', 'settings'].forEach(function (name) {
      var on = state.tab === name;
      $('tab-' + name).setAttribute('aria-selected', on ? 'true' : 'false');
      $('tab-' + name).classList.toggle('is-active', on);
      $('panel-' + name).hidden = !on;
    });
    // 記録や問題集が変わると renderHome からここに来るので、分析を開いていれば描き直す
    if (state.tab === 'analysis') scheduleAnalysis();
    // 設定タブを開いたときも、データの削除カードの件数を最新にする
    if (state.tab === 'settings') renderWipe();
  }

  function selectTab(name) {
    var opening = name === 'analysis' && state.tab !== 'analysis';
    state.tab = name;
    S.saveTab(name);
    if (opening) an.animate = true;   // タブを開いたときだけ、数字とグラフを動かす
    renderTab();
  }


  /* ===================== 分析 ===================== */

  // 集計は analysis.js、SVG は charts.js。ここはデータを渡して描き、操作に応えるだけ。
  var an = {
    range: '30',       // 毎日のグラフと週ごとの正答率の期間
    since: '',         // 問題集ごと・分類ごとの開始日付（'' は全期間、'month' / '30' / 'YYYY-MM-DD'）
    animate: true,     // 次に描くときに動かすか（タブを開いたときだけ）
    pending: false,
    data: null,        // 最後に集計した結果（幅が変わったときの描き直しに使う）
    widths: {},        // グラフごとの、最後に描いた幅
    observer: null,
  };
  var WEEK_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** 表示してから描く（隠れているパネルは幅が 0 になるので、次のフレームで測る） */
  function scheduleAnalysis() {
    if (an.pending) return;
    an.pending = true;
    requestAnimationFrame(function () {
      an.pending = false;
      if ($('panel-analysis').hidden || $('screen-home').hidden) return;
      renderAnalysis();
    });
  }

  function fmtDate(key, withYear) {
    var d = AN.keyDate(key);
    return (withYear ? d.getFullYear() + '/' : '') + (d.getMonth() + 1) + '/' + d.getDate() + '（' + WEEK_NAMES[d.getDay()] + '）';
  }

  /** 数字のカウントアップ（動きを減らす設定のときと、動かさないときは、すぐに最終の値） */
  function countUp(el, value, animate) {
    var text = CH.num(value);
    if (!animate || reducedMotion() || value === 0) { el.textContent = text; return; }
    var start = performance.now(), dur = 900;
    el.textContent = '0';
    function tick(t) {
      var p = Math.min(1, (t - start) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = CH.num(value * e);
      if (p < 1) requestAnimationFrame(tick); else el.textContent = text;
    }
    requestAnimationFrame(tick);
  }

  function renderAnalysis() {
    var now = new Date();
    var animate = an.animate;
    an.animate = false;
    var daily = AN.dailyCounts(state.log);
    an.data = {
      now: now,
      daily: daily,
      series: AN.dailySeries(daily, an.range, now),
      weeks: AN.weeklyAccuracy(daily, an.range, now),
      heat: AN.heatmap(daily, now),
    };
    renderAnSummary(AN.summaryCards(daily, now), animate);
    an.widths = {};
    drawAnCharts(animate);
    renderAnDonut(AN.mastery(state.sets, state.log), animate);
    renderAnMilestones(AN.milestones(daily));
    renderAnBreakdown(animate);
    observeAnCharts();
  }

  function renderAnSummary(s, animate) {
    countUp($('an-today'), s.today, animate);
    countUp($('an-week'), s.week, animate);
    countUp($('an-total'), s.total, animate);
    countUp($('an-streak'), s.streak, animate);
    countUp($('an-best'), s.best ? s.best.count : 0, animate);
    $('an-best-date').textContent = s.best ? fmtDate(s.best.date, true) : 'まだありません';
    $('an-streak-note').textContent = s.streak === 0 ? '今日の1問から始まります'
      : s.today > 0 ? '今日の分も入っています' : '今日解くと ' + (s.streak + 1) + '日になります';
    var head;
    if (s.total === 0) head = '解いた記録が、ここに育っていきます。';
    else if (s.today > 0) head = '今日は ' + CH.num(s.today) + '問。連続 ' + s.streak + '日です。';
    else if (s.streak > 0) head = '連続 ' + s.streak + '日。今日の分で ' + (s.streak + 1) + '日に伸びます。';
    else head = '今週は ' + CH.num(s.week) + '問。今日の1問から、また積み上げましょう。';
    $('an-headline').textContent = head;
  }

  /** グラフの入れ物の幅（パディングを除く）。0 なら描かない */
  function hostWidth(id) {
    return $(id).clientWidth;
  }

  function drawAnCharts(animate) {
    drawAnDaily(animate);
    drawAnHeat(animate);
    drawAnAccuracy(animate);
  }

  function setSvg(host, svg, animate) {
    var box = host.querySelector('.qd-an-svg');
    box.innerHTML = svg;   // charts.js が作る文字列。中身は数字と日付だけ（エスケープ済み）
    box.classList.toggle('qd-anim', !!animate && !reducedMotion());
    host.querySelector('.qd-tip').hidden = true;
  }

  function showEmpty(host, text) {
    var p = host.querySelector('.qd-an-empty');
    if (!p) return;
    p.hidden = !text;
    p.textContent = '';
    if (text) {
      var span = document.createElement('span');
      span.textContent = text;
      p.appendChild(span);
    }
  }

  /** ツールチップを、入れ物の中の (x, y) の上に出す。はみ出さないよう左右を寄せる */
  function placeTip(host, x, y, nodes) {
    var tip = host.querySelector('.qd-tip');
    tip.textContent = '';
    nodes.forEach(function (n) { tip.appendChild(n); });
    tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight, W = host.clientWidth;
    var left = Math.max(0, Math.min(W - w, x - w / 2));
    var top = y - h - 12;
    if (top < 0) top = y + 16;
    tip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
  }

  function tipLine(text, cls, strong) {
    var div = document.createElement('div');
    if (cls) div.className = cls;
    if (strong !== undefined) {
      div.appendChild(document.createTextNode(text));
      var b = document.createElement('b');
      b.textContent = strong;
      div.appendChild(b);
    } else div.textContent = text;
    return div;
  }

  function hideTip(host) {
    host.querySelector('.qd-tip').hidden = true;
    var cur = host.querySelector('.qd-cursor');
    if (cur) cur.setAttribute('visibility', 'hidden');
    Array.prototype.forEach.call(host.querySelectorAll('.is-pick'), function (el) { el.classList.remove('is-pick'); });
    var bars = host.querySelector('.qd-bars');
    if (bars) bars.classList.remove('has-pick');
    host.dataset.pick = '';
  }

  var RANGE_NAMES = { '30': '直近30日', '90': '直近90日', '365': '直近1年', 'all': '始めてから' };

  function drawAnDaily(animate) {
    var host = $('an-daily');
    var W = hostWidth('an-daily');
    if (!W) return;
    an.widths['an-daily'] = W;
    var s = an.data.series;
    var H = W < 520 ? 240 : 300;
    var r = CH.dualAxis(s, { width: W, height: H, uid: 'qd-daily' });
    host._plot = r.plot;
    setSvg(host, r.svg, animate);
    showEmpty(host, s.active === 0
      ? (s.cumMax === 0 ? '解くと、ここに毎日の棒と累計の線が育ちます。' : 'この期間に解いた日はありません。期間を広げると、これまでの分が見えます。')
      : '');
    var total = s.days.reduce(function (n, d) { return n + d.answers; }, 0);
    var label = RANGE_NAMES[an.range] + 'の毎日の問題数と累計。' + s.active + '日解いて ' + total + '問、累計は ' +
      s.cumMax + '問。いちばん多い日は ' + s.max + '問。左右の矢印キーで日を選べます。';
    host.setAttribute('aria-label', label);
    $('an-daily-foot').textContent = s.active > 0
      ? RANGE_NAMES[an.range] + 'で ' + s.active + '日・' + CH.num(total) + '問。1日あたり ' +
        (Math.round(total / s.active * 10) / 10) + '問（解いた日の平均）。'
      : '';
  }

  function pickDaily(host, i) {
    var s = an.data.series, p = host._plot;
    if (!p || !s.days.length) return;
    i = Math.max(0, Math.min(s.days.length - 1, i));
    host.dataset.pick = String(i);
    var d = s.days[i];
    var x = p.left + p.step * (i + 0.5);
    var cur = host.querySelector('.qd-cursor');
    cur.setAttribute('x1', x);
    cur.setAttribute('x2', x);
    cur.setAttribute('visibility', 'visible');
    var bars = host.querySelector('.qd-bars');
    Array.prototype.forEach.call(bars.querySelectorAll('.is-pick'), function (el) { el.classList.remove('is-pick'); });
    var bar = bars.querySelector('[data-i="' + i + '"]');
    bars.classList.toggle('has-pick', !!bar);
    if (bar) bar.classList.add('is-pick');
    placeTip(host, x, p.top + 8, [
      tipLine(fmtDate(d.date, true)),
      tipLine('その日 ', null, CH.num(d.answers) + '問'),
      tipLine('累計 ' + CH.num(d.cum) + '問', 'is-line'),
    ]);
  }

  function drawAnAccuracy(animate) {
    var host = $('an-acc');
    var W = hostWidth('an-acc');
    if (!W) return;
    an.widths['an-acc'] = W;
    var weeks = an.data.weeks;
    var r = CH.accuracy(weeks, { width: W, height: W < 520 ? 210 : 240, uid: 'qd-acc' });
    host._plot = r.plot;
    host._points = r.points;
    setSvg(host, r.svg, animate);
    showEmpty(host, r.points.length === 0 ? '解くと、週ごとの正答率の線がここに伸びます。' : '');
    $('an-acc-range').textContent = RANGE_NAMES[an.range];
    var rates = r.points.map(function (p) { return Math.round(weeks[p.i].rate * 100); });
    host.setAttribute('aria-label', '週ごとの正答率（' + RANGE_NAMES[an.range] + '）。回答のある週は ' + rates.length + '週' +
      (rates.length ? '。最初の週 ' + rates[0] + '%、最後の週 ' + rates[rates.length - 1] + '%、最高 ' + Math.max.apply(null, rates) +
        '%、最低 ' + Math.min.apply(null, rates) + '%' : '') + '。左右の矢印キーで週を選べます。');
  }

  function pickAccuracy(host, j) {
    var pts = host._points || [];
    if (!pts.length) return;
    j = Math.max(0, Math.min(pts.length - 1, j));
    host.dataset.pick = String(j);
    var p = pts[j], w = an.data.weeks[p.i];
    Array.prototype.forEach.call(host.querySelectorAll('.qd-dot.is-pick'), function (el) { el.classList.remove('is-pick'); });
    var dot = host.querySelector('.qd-dot[data-i="' + p.i + '"]');
    if (dot) dot.classList.add('is-pick');
    var cur = host.querySelector('.qd-cursor');
    cur.setAttribute('x1', p.x);
    cur.setAttribute('x2', p.x);
    cur.setAttribute('visibility', 'visible');
    placeTip(host, p.x, p.y, [
      tipLine(fmtDate(w.week, true) + 'からの週'),
      tipLine('正答率 ', null, Math.round(w.rate * 100) + '%'),
      tipLine(w.corrects + ' / ' + w.answers + '問 正解' + (w.answers < 10 ? '（少ないので、ぶれやすい）' : '')),
    ]);
  }

  /** 点のうち、x がいちばん近いものの添字 */
  function nearestPoint(pts, x) {
    var best = 0;
    pts.forEach(function (p, j) { if (Math.abs(p.x - x) < Math.abs(pts[best].x - x)) best = j; });
    return best;
  }

  function drawAnHeat(animate) {
    var host = $('an-heat');
    var W = hostWidth('an-heat');
    if (!W) return;
    an.widths['an-heat'] = W;
    var hm = an.data.heat;
    var gap = 3, cols = hm.weeks.length;
    // 収まるならマスを広げて幅いっぱいに（10〜18px）。収まらない狭い画面では 12px にして横にスクロールする
    var fit = Math.floor((W - 22) / cols) - gap;
    var cell = fit >= 10 ? Math.min(18, fit) : 12;
    var r = CH.heatmap(hm, { cell: cell, gap: gap });
    setSvg(host, r.svg, animate);
    host.querySelector('.qd-an-heat-days').innerHTML = r.labels;
    var scroller = host.querySelector('.qd-an-scroll');
    scroller.scrollLeft = scroller.scrollWidth;   // いちばん新しい週（右端）から見せる
    var active = 0;
    hm.weeks.forEach(function (col) { col.forEach(function (d) { if (d && d.answers > 0) active += 1; }); });
    $('an-heat-total').textContent = active + '日・' + CH.num(hm.total) + '問';
    $('an-heat-note').textContent = hm.total === 0 ? '解いた日のマスに色が付きます。多く解いた日ほど濃くなります。' : '色の濃さは、その日に解いた問題数（この1年に解いた日の件数を4つに分けて、多いほど濃い）。' +
      '区切り: ' + hm.thresholds[0] + '問まで／' + hm.thresholds[1] + '問まで／' + hm.thresholds[2] + '問まで／それより多い。';
    host.setAttribute('aria-label', '直近1年の学習のカレンダー。' + fmtDate(hm.from, true) + 'から今日まで、' + active + '日解いて ' +
      hm.total + '問。左右の矢印キーで日を選べます。');
  }

  function pickHeat(host, rect) {
    if (!rect) return;
    Array.prototype.forEach.call(host.querySelectorAll('.qd-heat-cell.is-pick'), function (el) { el.classList.remove('is-pick'); });
    rect.classList.add('is-pick');
    host.dataset.pick = rect.getAttribute('data-date');
    var hb = host.getBoundingClientRect(), rb = rect.getBoundingClientRect();
    var n = Number(rect.getAttribute('data-n'));
    placeTip(host, rb.left - hb.left + rb.width / 2, rb.top - hb.top, [
      tipLine(fmtDate(rect.getAttribute('data-date'), true)),
      n > 0 ? tipLine('', null, CH.num(n) + '問') : tipLine('解いていません'),
    ]);
  }

  /** カレンダーで、選んでいる日から delta 日動く（見えていなければスクロールして見せる） */
  function stepHeat(host, delta) {
    var key = host.dataset.pick || AN.dayKeyOf(an.data.now);
    var next = AN.addDays(key, delta);
    var rect = host.querySelector('.qd-heat-cell[data-date="' + next + '"]') ||
      host.querySelector('.qd-heat-cell[data-date="' + key + '"]');
    if (!rect) return;
    var sc = host.querySelector('.qd-an-scroll');
    var sb = sc.getBoundingClientRect(), rb = rect.getBoundingClientRect();
    if (rb.left < sb.left) sc.scrollLeft -= sb.left - rb.left;
    else if (rb.right > sb.right) sc.scrollLeft += rb.right - sb.right;
    pickHeat(host, rect);
  }

  var DONUT_NAMES = { mastered: '定着', learning: '学習中', weak: '苦手', unseen: '未回答' };

  function renderAnDonut(m, animate) {
    var box = $('an-donut');
    box.innerHTML = CH.donut(m, { size: 200, stroke: 18, uid: 'qd-donut' });
    box.classList.toggle('qd-anim', !!animate && !reducedMotion());
    var rate = m.answeredRate === null ? 0 : Math.round(m.answeredRate * 100);
    countUp($('an-donut-rate'), rate, animate);
    var list = $('an-donut-legend');
    list.textContent = '';
    CH.DONUT_ORDER.forEach(function (k) {
      var li = document.createElement('li');
      li.className = 'is-' + k;
      li.appendChild(document.createElement('i'));
      li.appendChild(document.createTextNode(DONUT_NAMES[k]));
      var b = document.createElement('b');
      b.textContent = CH.num(m[k]) + '問';
      li.appendChild(b);
      list.appendChild(li);
    });
    box.setAttribute('aria-label', m.total === 0 ? '問題集を読み込むと、習熟度の内訳が出ます。'
      : '習熟度の内訳。全 ' + m.total + '問のうち、解いた問題 ' + rate + '%。' + CH.DONUT_ORDER.map(function (k) {
        return DONUT_NAMES[k] + ' ' + m[k] + '問';
      }).join('、') + '。');
  }

  var MILESTONE_GROUPS = [
    { kind: 'total', title: '累計の問題数', name: function (t) { return CH.num(t) + '問'; }, disc: function (t) { return t >= 1000 ? (t / 1000) + 'k' : String(t); } },
    { kind: 'streak', title: '連続学習', name: function (t) { return t + '日連続'; }, disc: function (t) { return t + '日'; } },
    { kind: 'day', title: '1日の問題数', name: function (t) { return '1日 ' + t + '問'; }, disc: function (t) { return String(t); } },
  ];

  function renderAnMilestones(ms) {
    var done = ms.list.filter(function (m) { return m.achieved; }).length;
    var next = $('an-next');
    next.textContent = '';
    if (ms.next) {
      next.appendChild(document.createTextNode('次の目標「累計 ' + CH.num(ms.next.target) + '問」まで、あと '));
      var b = document.createElement('b');
      b.textContent = CH.num(ms.next.remaining) + '問';
      next.appendChild(b);
      next.appendChild(document.createTextNode('。'));
    } else {
      next.textContent = '累計の目標はすべて達成しました。';
    }
    var box = $('an-badges');
    box.textContent = '';
    box.setAttribute('aria-label', 'マイルストーン ' + ms.list.length + '個のうち ' + done + '個を達成');
    MILESTONE_GROUPS.forEach(function (g) {
      var wrap = document.createElement('div');
      var h = document.createElement('h3');
      h.className = 'qd-badge-group-title';
      h.textContent = g.title;
      wrap.appendChild(h);
      var ul = document.createElement('ul');
      ul.className = 'qd-badge-row';
      ms.list.filter(function (m) { return m.kind === g.kind; }).forEach(function (m) {
        var li = document.createElement('li');
        li.className = 'qd-medal' + (m.achieved ? ' is-done' : '');
        var disc = document.createElement('span');
        disc.className = 'qd-medal-disc';
        disc.setAttribute('aria-hidden', 'true');
        disc.textContent = g.disc(m.target);
        var name = document.createElement('span');
        name.className = 'qd-medal-name';
        name.textContent = g.name(m.target);
        var date = document.createElement('span');
        date.className = 'qd-medal-date';
        date.textContent = m.achieved ? fmtDate(m.date, true).replace(/（.）$/, '') : 'まだ';
        li.appendChild(disc);
        li.appendChild(name);
        li.appendChild(date);
        li.setAttribute('aria-label', g.name(m.target) + (m.achieved ? '、' + fmtDate(m.date, true) + 'に達成' : '、未達成'));
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      box.appendChild(wrap);
    });
  }

  function barItem(title, g, animate) {
    var li = document.createElement('li');
    li.className = 'qd-bars-item';
    var top = document.createElement('div');
    top.className = 'qd-bars-top';
    var name = document.createElement('span');
    name.className = 'qd-bars-name';
    name.textContent = title;
    var rate = document.createElement('span');
    rate.className = 'qd-bars-rate' + (g.rate === null ? ' is-none' : '');
    rate.textContent = g.rate === null ? '回答なし' : Math.round(g.rate * 100) + '%';
    top.appendChild(name);
    top.appendChild(rate);
    var track = document.createElement('div');
    track.className = 'qd-bars-track';
    var fill = document.createElement('div');
    fill.className = 'qd-bars-fill';
    fill.style.width = (g.rate === null ? 0 : Math.round(g.rate * 1000) / 10) + '%';
    track.appendChild(fill);
    var meta = document.createElement('span');
    meta.className = 'qd-bars-meta';
    meta.textContent = '回答 ' + CH.num(g.answers) + '件　解いた問題 ' + g.answered + ' / ' + g.questions + '問';
    li.appendChild(top);
    li.appendChild(track);
    li.appendChild(meta);
    li.setAttribute('aria-label', title + '、正答率 ' + (g.rate === null ? 'なし' : Math.round(g.rate * 100) + '%') + '、' + meta.textContent);
    return li;
  }

  function renderAnBreakdown(animate) {
    var choice = an.since;
    var since = AN.sinceMs(choice, new Date());
    $('an-since').value = since === null ? '' : AN.dayKeyOf(new Date(since));
    Array.prototype.forEach.call(document.querySelectorAll('[data-since]'), function (b) {
      var on = b.getAttribute('data-since') === (choice || 'all');
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var r = AN.breakdown(state.sets, state.log, since);
    var fill = function (id, groups, titleOf, empty) {
      var ul = $(id);
      ul.textContent = '';
      ul.classList.toggle('qd-anim', !!animate && !reducedMotion());
      if (!groups.length) {
        var li = document.createElement('li');
        li.className = 'qd-note';
        li.textContent = empty;
        ul.appendChild(li);
        return;
      }
      groups.forEach(function (g) { ul.appendChild(barItem(titleOf(g), g, animate)); });
    };
    fill('an-sets', r.bySet, function (g) { return g.title; }, '問題集を読み込むと、ここに並びます。');
    fill('an-cats', r.byCategory, function (g) { return g.category === null ? '（分類なし）' : g.category; }, '問題集を読み込むと、ここに並びます。');
  }

  /** 幅が変わったら、そのグラフだけ動かさずに描き直す（文字が潰れないよう、viewBox の拡大縮小に頼らない） */
  function observeAnCharts() {
    if (an.observer || typeof ResizeObserver === 'undefined') return;
    var draw = { 'an-daily': drawAnDaily, 'an-heat': drawAnHeat, 'an-acc': drawAnAccuracy };
    var queued = {};
    an.observer = new ResizeObserver(function (entries) {
      entries.forEach(function (e) {
        var id = e.target.id;
        var w = e.target.clientWidth;
        if (!w || !an.data || an.widths[id] === w || queued[id]) return;
        queued[id] = true;
        requestAnimationFrame(function () { queued[id] = false; draw[id](false); });
      });
    });
    Object.keys(draw).forEach(function (id) { an.observer.observe($(id)); });
  }

  /** グラフの操作: ホバー・タップでツールチップ、矢印キーで選ぶ位置を動かす、Esc で閉じる */
  function bindAnCharts() {
    var daily = $('an-daily');
    var xIn = function (host, ev) { return ev.clientX - host.getBoundingClientRect().left; };
    daily.addEventListener('pointermove', function (ev) {
      if (!host_ok(daily)) return;
      var p = daily._plot;
      pickDaily(daily, Math.floor((xIn(daily, ev) - p.left) / p.step));
    });
    daily.addEventListener('pointerdown', function (ev) {
      if (!host_ok(daily)) return;
      var p = daily._plot;
      pickDaily(daily, Math.floor((xIn(daily, ev) - p.left) / p.step));
    });
    daily.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') hideTip(daily); });

    var acc = $('an-acc');
    var pickAccAt = function (ev) {
      var pts = acc._points || [];
      if (pts.length) pickAccuracy(acc, nearestPoint(pts, xIn(acc, ev)));
    };
    acc.addEventListener('pointermove', pickAccAt);
    acc.addEventListener('pointerdown', pickAccAt);
    acc.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') hideTip(acc); });

    var heat = $('an-heat');
    var pickHeatAt = function (ev) {
      var rect = ev.target.closest && ev.target.closest('.qd-heat-cell');
      if (rect) pickHeat(heat, rect);
    };
    heat.addEventListener('pointerover', pickHeatAt);
    heat.addEventListener('pointerdown', pickHeatAt);
    heat.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') hideTip(heat); });
    heat.querySelector('.qd-an-scroll').addEventListener('scroll', function () { heat.querySelector('.qd-tip').hidden = true; });

    var keys = function (host, step, first) {
      host.addEventListener('keydown', function (ev) {
        var d = { ArrowLeft: -1, ArrowRight: 1, Home: -1e6, End: 1e6 }[ev.key];
        if (ev.key === 'Escape') { hideTip(host); return; }
        if (d === undefined) return;
        ev.preventDefault();
        step(d);
      });
      host.addEventListener('blur', function () { hideTip(host); });
      host.addEventListener('focus', function () { if (first) first(); });
    };
    keys(daily, function (d) {
      var cur = daily.dataset.pick === '' || daily.dataset.pick === undefined ? an.data.series.days.length - 1 : Number(daily.dataset.pick) + d;
      pickDaily(daily, cur);
    });
    keys(acc, function (d) {
      var n = (acc._points || []).length;
      if (!n) return;
      var cur = acc.dataset.pick === '' || acc.dataset.pick === undefined ? n - 1 : Number(acc.dataset.pick) + d;
      pickAccuracy(acc, cur);
    });
    keys(heat, function (d) {
      if (Math.abs(d) > 1) d = d > 0 ? 400 : -400;
      if (Math.abs(d) === 400) {
        var cells = heat.querySelectorAll('.qd-heat-cell');
        var target = d > 0 ? cells[cells.length - 1] : cells[0];
        heat.dataset.pick = target.getAttribute('data-date');
        stepHeat(heat, 0);
        return;
      }
      stepHeat(heat, heat.dataset.pick ? d : 0);
    });

    function host_ok(host) { return !!host._plot && !!an.data; }

    Array.prototype.forEach.call(document.querySelectorAll('input[name="an-range"]'), function (el) {
      el.addEventListener('change', function () {
        an.range = el.value;
        if (!an.data) return;
        var daily2 = an.data.daily;
        var now = new Date();
        an.data.now = now;
        an.data.series = AN.dailySeries(daily2, an.range, now);
        an.data.weeks = AN.weeklyAccuracy(daily2, an.range, now);
        drawAnDaily(true);
        drawAnAccuracy(true);
      });
    });
    $('an-since').addEventListener('change', function () {
      an.since = $('an-since').value;   // 空なら全期間
      renderAnBreakdown(false);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-since]'), function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-since');
        an.since = v === 'all' ? '' : v;
        renderAnBreakdown(true);
      });
    });
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
      renderWipe();   // 設定タブの件数（自作テキストの個数）も最新にする
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

  /* ===================== まとめて削除 ===================== */

  function wipePick() {
    return { sets: $('wipe-sets').checked, texts: $('wipe-texts').checked, records: $('wipe-records').checked };
  }

  function wipeCounts() {
    return {
      sets: state.sets.length,
      questions: Q.countQuestions(state.sets),
      texts: state.texts.length,
      records: state.log.length,
    };
  }

  /** 件数の表示と、ボタンの有効・無効を更新する（ホームを描くたびに呼ぶ） */
  function renderWipe() {
    var n = wipeCounts();
    $('wipe-sets-label').textContent = '問題集（' + n.sets + '個・' + n.questions + '問）';
    $('wipe-texts-label').textContent = '自作テキスト（' + n.texts + '個）';
    $('wipe-records-label').textContent = '学習の記録（回答 ' + n.records + '件）と、進行中の出題';
    var p = wipePick();
    $('btn-wipe').disabled = !(p.sets || p.texts || p.records);
  }

  function onWipe() {
    var pick = wipePick();
    var text = Q.wipeConfirmText(pick, wipeCounts());
    if (!text || !confirm(text)) return;
    var jobs = [];
    if (pick.sets) jobs.push(S.clearSets().then(function () { S.clearSession(); S.clearMock(); state.mock = null; }));
    if (pick.texts) jobs.push(S.clearTexts());
    if (pick.records) jobs.push(S.clearRecords().then(function () {
      state.mock = null;
      state.positions = {};
      setLog([]);
    }));
    Promise.all(jobs).then(function () {
      return Promise.all([S.getAllSets(), S.getAllTexts()]);
    }).then(function (r) {
      setSets(r[0]);
      state.texts = r[1];
      ['wipe-sets', 'wipe-texts', 'wipe-records'].forEach(function (id) { $(id).checked = false; });
      renderHome();
      renderBooks();
      showMessage(['削除しました。'], false, 'wipe-msg');
    }).catch(function (e) {
      showMessage(['削除できませんでした: ' + e], true, 'wipe-msg');
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

    // どちらの端末が新しいかを見分けられるよう、最後に解いた日時を端末ごとに出す
    var last = Q.latestAnswers(state.log, S.getDeviceId());
    var when = function (iso) {
      if (!iso) return 'なし';
      var d = new Date(iso);
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    };
    $('history-latest').textContent = sum.answered > 0
      ? '最後に解いた日時 — この端末: ' + when(last.own) + '／ほかの端末から取り込んだ分: ' + when(last.other)
      : '';
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

  /* ===================== 今日の一問 ===================== */

  /** 今日の一問のカードの状態。問題集が無ければ null */
  /** 今日の一問の対象の問題集（設定で外したものを除く） */
  function dailyTargetSets() {
    return Q.dailySets(state.sets, state.dailyExcluded);
  }

  /** 設定タブの、今日の一問の対象の問題集のチェックボックス */
  function renderDailySettings() {
    var box = $('daily-set-list');
    box.textContent = '';
    $('daily-set-empty').hidden = state.sets.length > 0;
    state.sets.forEach(function (set) {
      var label = document.createElement('label');
      label.className = 'qd-check';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.dailyExcluded.indexOf(set.id) < 0;
      input.addEventListener('change', function () {
        state.dailyExcluded = Q.setExcluded(state.dailyExcluded, set.id, input.checked);
        S.saveDailyExcluded(state.dailyExcluded);
        renderDaily();
      });
      var span = document.createElement('span');
      span.textContent = set.title + '（' + set.questions.length + '問）';
      label.appendChild(input);
      label.appendChild(span);
      box.appendChild(label);
    });
  }

  function dailyStatus() {
    if (state.sets.length === 0) return null;
    var now = new Date();
    var today = Q.localDayKey(now);
    var sets = dailyTargetSets();
    // 対象の問題集が無い。カードは出すが、押せない
    if (sets.length === 0) return { empty: true };
    var key = Q.dailyQuestion(sets, state.log, now);
    if (!key) return null;
    var daily = AN.dailyCounts(state.log);
    var solvedToday = daily[today] ? daily[today].answers : 0;
    var done = Q.effectiveLog(state.log).some(function (e) {
      return e.key === key && Q.localDayKey(new Date(e.at)) === today;
    });
    return { now: now, sets: sets, key: key, done: done, solvedToday: solvedToday, streak: AN.currentStreak(daily, now) };
  }

  function renderDaily() {
    var d = dailyStatus();
    var card = $('daily-card');
    card.hidden = !d;
    if (!d) return;
    if (d.empty) {
      card.classList.remove('qd-daily--done');
      $('daily-title').textContent = '今日の一問';
      $('daily-desc').textContent = '対象の問題集がありません。設定で選んでください。';
      $('btn-daily').textContent = '今日の一問を解く';
      $('btn-daily').disabled = true;
      return;
    }
    card.classList.toggle('qd-daily--done', d.done);
    var more = d.done ? Q.extraQuestion(d.sets, state.log, d.now) : d.key;
    if (d.done) {
      $('daily-title').textContent = '今日はできました（連続 ' + d.streak + ' 日）';
      $('daily-desc').textContent = more ? 'もう少し解くなら、もう1問どうぞ。' : '解ける問題は、今日の分をすべて解きました。';
      $('btn-daily').textContent = 'もう1問';
    } else {
      $('daily-title').textContent = '今日の一問';
      $('daily-desc').textContent = d.solvedToday > 0
        ? '今日は ' + d.solvedToday + ' 問解いています（連続 ' + d.streak + ' 日）。今日の一問も解いてみませんか。'
        : (d.streak > 0 ? 'いま連続 ' + d.streak + ' 日。1問だけでも続きます。' : '1問だけでも続けるのが大事です。');
      $('btn-daily').textContent = '今日の一問を解く';
    }
    $('btn-daily').disabled = !more;
  }

  function onDaily() {
    var d = dailyStatus();
    if (!d || d.empty) return;
    var key = d.done ? Q.extraQuestion(d.sets, state.log, d.now) : d.key;
    if (!key) { renderDaily(); return; }
    if (state.session && !confirm('途中の問題があります。新しく始めると、途中の分は消えます。よろしいですか？')) return;
    startSession('daily', [key], d.done ? '今日の一問（もう1問）' : '今日の一問');
  }

  function onStart() {
    var mode = selectedMode();
    saveStartChoices();
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
    if (mode === 'wrong' && wrongSinceText()) parts.push(wrongSinceText() + 'に間違えた');
    if (mode === 'wrong' && selectedWrongFixed()) parts.push('正解し直した問題を含む');
    if (mode === 'weak') {
      parts.push('正答率' + Math.round(selectedThreshold() * 100) + '%未満か最後に不正解');
      if (selectedRest() > 0) parts.push('最近正解した問題を除く');
    }
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

  /** 見返しから戻る先ごとの、上のボタンと下のボタンの文言 */
  var REVIEW_BACK = {
    result: { quit: '結果へ', next: '結果に戻る' },
    stats: { quit: '成績へ', next: '成績に戻る' },
    search: { quit: '探す画面へ', next: '探す画面に戻る' },
  };

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
    $('btn-quit').textContent = review ? REVIEW_BACK[state.reviewFrom || 'result'].quit : '中断';

    setRich($('q-text'), q.question);

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
      setRich(text, q.choices[original]);
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
      setRich(text, choice);
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
    setRich($('q-explanation'), q.explanation);
    $('q-supplement-wrap').hidden = !q.supplement;
    setRich($('q-supplement'), q.supplement);

    // コピーする文章はここで作っておく（ボタンを押した操作の中ですぐ書き込まないと、iPhone ではコピーが拒否される）
    askCopyText = Q.askText(entry.set, q, entry.index, answer.picked);
    $('q-ask-msg').hidden = true;
    $('q-ask-text').hidden = true;

    var next = $('btn-next');
    if (review) next.textContent = REVIEW_BACK[state.reviewFrom || 'result'].next;
    else next.textContent = state.session.pos + 1 >= state.session.order.length ? '結果を見る' : '次の問題へ';

    // 「探す」からの見返しだけ、同じ問題集の前後の問題へ動くボタンを出す
    var nav = review && state.reviewFrom === 'search';
    $('q-search-nav').hidden = !nav;
    if (nav) {
      $('btn-prevq').disabled = !Q.neighborKey(entry.set, key, -1);
      $('btn-nextq').disabled = !Q.neighborKey(entry.set, key, 1);
    }
  }

  /* ===================== AI に質問する用のコピー ===================== */

  var askCopyText = '';   // いま表示している問題の、コピーする文章

  function onAskCopy() {
    var text = askCopyText;
    var done = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error('clipboard'));
    done.then(function () {
      if (text !== askCopyText) return;   // 書き込みの間に別の問題へ移ったら、表示は変えない
      $('q-ask-text').hidden = true;
      showAskMessage('コピーしました。AI の入力欄に貼り付けてください。');
    }, function () {
      if (text !== askCopyText) return;
      var area = $('q-ask-text');
      area.value = text;
      area.hidden = false;
      area.focus();
      area.select();
      showAskMessage('自動でコピーできませんでした。下の欄を全選択してコピーしてください。');
    });
  }

  function showAskMessage(message) {
    var el = $('q-ask-msg');
    el.textContent = message;
    el.hidden = false;
  }

  /* ===================== 数式（KaTeX） ===================== */

  var katexLoading = null;   // KaTeX の読み込み（式を含む問題が出たときに、一度だけ始める）

  /** KaTeX（同梱）を読み込む。読み込めなければ reject。式のない問題集では呼ばれない */
  function loadKatex() {
    if (window.katex) return Promise.resolve(window.katex);
    if (katexLoading) return katexLoading;
    // スクリプトだけでなく、CSS とフォントが届くまで待ってから、式を描く。待たずに描くと、スタイルが当たる前の
    // 見た目で描かれたあとに、CSS とフォントが届いて見た目が大きく変わり、iPhone（WebKit）で最初の式の
    // 最初の積分記号が欠けることがあった（実機で確認。最初に式を出すときだけ起きる）
    katexLoading = new Promise(function (resolve, reject) {
      var cssDone = new Promise(function (ok) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'vendor/katex/katex.min.css';
        link.onload = ok;
        link.onerror = ok;   // CSS が読めなくても、式は描く（見た目が崩れるだけ）
        document.head.appendChild(link);
      });
      var scriptDone = new Promise(function (ok, ng) {
        var sc = document.createElement('script');
        sc.src = 'vendor/katex/katex.min.js';
        sc.onload = function () { window.katex ? ok() : ng(new Error('katex')); };
        sc.onerror = function () { ng(new Error('katex')); };
        document.head.appendChild(sc);
      });
      Promise.all([cssDone, scriptDone]).then(waitKatexFonts).then(function () {
        resolve(window.katex);
      }, function (e) { katexLoading = null; reject(e); });
    });
    return katexLoading;
  }

  /** KaTeX のフォントが届くまで待つ（最大3秒。届かなくても、そのまま描く） */
  function waitKatexFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var faces = ['1em KaTeX_Main', 'italic 1em KaTeX_Main', '1em KaTeX_Math', 'italic 1em KaTeX_Math',
      '1em KaTeX_Size1', '1em KaTeX_Size2', '1em KaTeX_Size3', '1em KaTeX_Size4', '1em KaTeX_AMS'];
    var loading = Promise.all(faces.map(function (f) { return document.fonts.load(f).catch(function () {}); }));
    var timeout = new Promise(function (ok) { setTimeout(ok, 3000); });
    return Promise.race([loading, timeout]);
  }

  /**
   * 文字列を、文字と式に分けて el に入れる。文字はテキストノード（innerHTML は使わない）、
   * 式は KaTeX で描く（読み込みが終わるまでは、TeX の文字のまま出す）。
   * `$` を含まない文字列は、これまでと同じ textContent だけで出す。
   */
  function setRich(el, text) {
    text = text == null ? '' : String(text);
    if (text.indexOf('$') < 0) { el.textContent = text; return; }
    var parts = Q.splitMath(text);
    el.textContent = '';
    var maths = [];
    parts.forEach(function (p) {
      if (p.type === 'text') { el.appendChild(document.createTextNode(p.value)); return; }
      var span = document.createElement(p.display ? 'div' : 'span');
      span.className = p.display ? 'qd-math qd-math--display' : 'qd-math';
      span.textContent = (p.display ? '$$' : '$') + p.value + (p.display ? '$$' : '$');
      // KaTeX が届くまで、TeX の文字は隠しておく（場所だけ確保）。見せたまま式に差し替えると、
      // iPhone（WebKit）で、最初の積分記号の上側が欠けて描かれることがあった（実機で確認）
      span.classList.add('qd-math--pending');
      el.appendChild(span);
      maths.push({ el: span, tex: p.value, display: p.display });
    });
    if (!maths.length) return;
    loadKatex().then(function (katex) {
      maths.forEach(function (m) {
        if (!m.el.isConnected) return;
        m.el.textContent = '';
        katex.render(m.tex, m.el, { throwOnError: false, trust: false, displayMode: m.display });
        m.el.classList.remove('qd-math--pending');
      });
    }, function () {
      // 読み込めないときは、TeX の文字のまま見せる
      maths.forEach(function (m) { m.el.classList.remove('qd-math--pending'); });
    });
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

      // p ではなく div にする（式の div を p の中に入れると、iPhone の WebKit で最初の積分記号の上が欠ける）
      var text = document.createElement('div');
      text.className = 'qd-qtext';
      setRich(text, q.question);
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
        setRich(label, choice);
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

  /* ===================== 問題を探す ===================== */

  var SEARCH_LIMIT = 50;

  /** 探す画面を開く。問題集の選択肢を作り直す（選んでいた問題集が残っていれば、そのまま） */
  function openSearch() {
    var sel = $('search-set');
    var keep = sel.value;
    sel.textContent = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = 'すべての問題集';
    sel.appendChild(all);
    state.sets.forEach(function (set) {
      var o = document.createElement('option');
      o.value = set.id;
      o.textContent = set.title;
      sel.appendChild(o);
    });
    if (keep && state.sets.some(function (s) { return s.id === keep; })) sel.value = keep;
    renderSearch();
    showScreen('search');
  }

  function renderSearch() {
    var r = Q.searchQuestions(state.sets, $('search-set').value, $('search-input').value, SEARCH_LIMIT);
    var list = $('search-list');
    list.textContent = '';
    var status = $('search-status');
    var more = $('search-more');
    more.hidden = true;
    if (r.mode === 'empty') {
      status.textContent = '問番号か語を入れてください。';
      return;
    }
    if (r.total === 0) {
      status.textContent = '見つかりません。';
      return;
    }
    status.textContent = r.total + '問見つかりました（' + (r.mode === 'number' ? '問番号' : '語') + 'で探しています）。';
    r.hits.forEach(function (h) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qd-wrong-item';
      var label = document.createElement('span');
      label.className = 'qd-wrong-label';
      label.textContent = Q.questionLabel(h.set, h.question, h.index);
      var text = document.createElement('span');
      text.className = 'qd-wrong-text';
      text.textContent = Q.excerpt(h.question.question, EXCERPT_LEN);
      btn.appendChild(label);
      btn.appendChild(text);
      btn.addEventListener('click', function () { viewFromSearch(h.key); });
      li.appendChild(btn);
      list.appendChild(li);
    });
    if (r.total > r.hits.length) {
      more.hidden = false;
      more.textContent = 'ほかに ' + (r.total - r.hits.length) + ' 件あります。語を足して絞り込んでください。';
    }
  }

  /** 探した問題の、回答後の表示（元の番号の選択肢と解説）を見る。並べ替えも記録もしない */
  function viewFromSearch(key) {
    state.reviewFrom = 'search';
    showSearchQuestion(key);
    showScreen('quiz');
  }

  function showSearchQuestion(key) {
    var q = state.index[key].question;
    state.reviewKey = key;
    var order = q.choices.map(function (_, i) { return i; });
    drawQuestion(key, order, { order: order, picked: null, correct: null }, true);
  }

  /** 同じ問題集の中で、問番号順に前後の問題へ動く */
  function stepSearch(delta) {
    var e = state.index[state.reviewKey];
    var k = e && Q.neighborKey(e.set, state.reviewKey, delta);
    if (!k) return;
    showSearchQuestion(k);
    window.scrollTo(0, 0);
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

  renderVersion();

  $('file-input').addEventListener('change', onFiles);
  $('book-input').addEventListener('change', onBookFiles);
  $('tab-drill').addEventListener('click', function () { selectTab('drill'); });
  $('tab-book').addEventListener('click', function () { selectTab('book'); });
  $('tab-analysis').addEventListener('click', function () { selectTab('analysis'); });
  $('tab-settings').addEventListener('click', function () { selectTab('settings'); });
  bindAnCharts();
  $('btn-export').addEventListener('click', exportHistory);
  ['wipe-sets', 'wipe-texts', 'wipe-records'].forEach(function (id) { $(id).addEventListener('change', renderWipe); });
  $('btn-wipe').addEventListener('click', onWipe);
  $('btn-export-result').addEventListener('click', exportHistory);
  $('btn-stats').addEventListener('click', openStats);
  $('btn-search').addEventListener('click', openSearch);
  $('btn-search-home').addEventListener('click', function () { renderHome(); showScreen('home'); });
  $('search-set').addEventListener('change', renderSearch);
  $('search-input').addEventListener('input', renderSearch);
  $('btn-prevq').addEventListener('click', function () { stepSearch(-1); });
  $('btn-nextq').addEventListener('click', function () { stepSearch(1); });
  $('btn-stats-home').addEventListener('click', function () { renderHome(); showScreen('home'); });
  $('history-input').addEventListener('change', onHistoryFile);
  $('btn-sample').addEventListener('click', loadSample);
  $('btn-start').addEventListener('click', onStart);
  $('btn-resume').addEventListener('click', renderQuestion);
  $('btn-daily').addEventListener('click', onDaily);
  // ホーム画面に置いたアプリは開いたままのことが多いので、戻ってきたとき（日付が変わっていても）カードを描き直す
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !$('screen-home').hidden) renderDaily();
  });
  $('btn-next').addEventListener('click', onNext);
  $('btn-lucky').addEventListener('click', onLucky);
  $('btn-ask-copy').addEventListener('click', onAskCopy);
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
  Array.prototype.forEach.call(document.querySelectorAll('input[name="rest"]'), function (el) {
    el.addEventListener('change', renderStartCount);
  });
  $('set-select').addEventListener('change', renderStartCount);
  $('wrongsince-select').addEventListener('change', function () { renderWrongDate(); renderStartCount(); });
  $('wrongdate-input').addEventListener('change', renderStartCount);
  Array.prototype.forEach.call(document.querySelectorAll('input[name="wrongfixed"]'), function (el) {
    el.addEventListener('change', function () { renderWrongDate(); renderStartCount(); });
  });
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
