/*
 * storage.js — 保存まわりの薄いラッパ
 *
 * 問題集は IndexedDB に置く。localStorage は 5MB 前後で頭打ちになり、画像入りの問題集
 * （1ファイル 5〜6MB）が入らないため。レコードは問題集1つにつき1件（keyPath は問題集の id）
 * なので、同じ id を put すれば置き換え、違う id なら追加になる。
 *
 * 学習の記録（回答ごとのログ）も IndexedDB に置く（store 'log'、keyPath は回答の id）。
 * 1件は 100 バイト前後で、何年も積み上げると数万〜十万件（数MB〜10MB）になりうる。
 * localStorage の上限（5MB 前後）に近づくと、進行中のセッションまで保存できなくなるので避けた。
 * id で put するので、同じ回答を何度書いても1件のまま。
 *
 * 自作テキスト（公式や単位の換算など）も IndexedDB に置く（store 'texts'、keyPath はテキストの id）。
 * 扱いは問題集と同じで、同じ id を put すれば置き換え、違う id なら追加。
 *
 * 進行中のセッション・前回の正解の表示位置・端末ID と連番は小さいので localStorage に置く。
 * 以前の成績の記録（問題ごとの集計）も localStorage に残っている。ログに移したあとも消さず、
 * 移行済みの印だけを付ける。
 * localStorage はプライベートブラウズなどで例外を投げることがあるので、読み書きは握りつぶす
 * （保存できなくても出題はできる）。
 */
var QD_STORAGE = (function () {
  'use strict';

  var DB_NAME = 'quiz-drill';
  var DB_VERSION = 3;   // 2 で学習の記録、3 で自作テキストの store を足した
  var STORE = 'sets';
  var LOG_STORE = 'log';
  var TEXT_STORE = 'texts';
  var SESSION_KEY = 'quiz-drill.session';
  var STATS_KEY = 'quiz-drill.stats';           // 以前の成績の記録（問題ごとの集計）。読むだけ
  var MIGRATED_KEY = 'quiz-drill.stats-migrated'; // 以前の成績の記録をログに移した印
  var DEVICE_KEY = 'quiz-drill.device';           // 端末ごとに固定のランダムな ID
  var SEQ_KEY = 'quiz-drill.seq';                 // 回答の id に付ける連番
  var POSITIONS_KEY = 'quiz-drill.positions';   // 鍵 → 前回表示したときの代表の正解の表示位置

  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(LOG_STORE)) db.createObjectStore(LOG_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(TEXT_STORE)) db.createObjectStore(TEXT_STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  /** 1つのトランザクションで store に対する処理を行い、完了を待つ。name を省くと問題集の store */
  function withStore(mode, fn, name) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var storeName = name || STORE;
        var tx = db.transaction(storeName, mode);
        var result = fn(tx.objectStore(storeName));
        tx.oncomplete = function () { resolve(result && 'result' in result ? result.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  /**
   * 保存済みのもの（問題集か自作テキスト）をすべて返す。並びは保存した順（savedAt）にする。
   * レコードは { id, set, savedAt }（自作テキストも中身を set に入れる）
   */
  function getAll(name) {
    return withStore('readonly', function (store) { return store.getAll(); }, name)
      .then(function (records) {
        return (records || [])
          .sort(function (a, b) { return (a.savedAt || 0) - (b.savedAt || 0); })
          .map(function (r) { return r.set; });
      });
  }

  /**
   * 保存する。同じ id は置き換え。置き換えのときは元の savedAt を引き継いで
   * 一覧での位置を変えない。
   */
  function putAll(items, name) {
    return getSavedAt(name).then(function (savedAt) {
      var now = Date.now();
      return withStore('readwrite', function (store) {
        items.forEach(function (item, i) {
          store.put({ id: item.id, set: item, savedAt: savedAt[item.id] || now + i });
        });
      }, name);
    });
  }

  function getSavedAt(name) {
    return withStore('readonly', function (store) { return store.getAll(); }, name)
      .then(function (records) {
        var map = {};
        (records || []).forEach(function (r) { map[r.id] = r.savedAt; });
        return map;
      });
  }

  function deleteOne(id, name) {
    return withStore('readwrite', function (store) { store.delete(id); }, name);
  }

  /* ===================== 学習の記録（ログ） ===================== */

  function getAllLog() {
    return withStore('readonly', function (store) { return store.getAll(); }, LOG_STORE)
      .then(function (records) { return records || []; });
  }

  /** ログを書き足す。同じ id は上書き（＝1件のまま） */
  function addLog(entries) {
    if (!entries.length) return Promise.resolve();
    return withStore('readwrite', function (store) {
      entries.forEach(function (e) { store.put(e); });
    }, LOG_STORE);
  }

  /** 端末ID（無ければ作る）。2台で衝突しないよう乱数で作る */
  function deviceId() {
    var id = readJson(DEVICE_KEY);
    if (typeof id === 'string' && id) return id;
    var bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    id = Array.prototype.map.call(bytes, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    writeJson(DEVICE_KEY, id);
    return id;
  }

  /**
   * 回答の id。端末ID＋時刻＋連番。連番が消えても（サイトデータを消したときなど）時刻で衝突しない。
   */
  function newLogId(now) {
    var seq = (readJson(SEQ_KEY) || 0) + 1;
    writeJson(SEQ_KEY, seq);
    return deviceId() + ':' + now.getTime().toString(36) + ':' + seq;
  }

  /* ===================== localStorage ===================== */

  function readJson(key) {
    try {
      var s = localStorage.getItem(key);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* 保存できなくても出題は続けられる */ }
  }

  return {
    getAllSets: function () { return getAll(STORE); },
    putSets: function (sets) { return putAll(sets, STORE); },
    deleteSet: function (id) { return deleteOne(id, STORE); },
    getAllTexts: function () { return getAll(TEXT_STORE); },
    putTexts: function (texts) { return putAll(texts, TEXT_STORE); },
    deleteText: function (id) { return deleteOne(id, TEXT_STORE); },
    loadSession: function () { return readJson(SESSION_KEY); },
    saveSession: function (s) { writeJson(SESSION_KEY, s); },
    clearSession: function () { writeJson(SESSION_KEY, null); },
    getAllLog: getAllLog,
    addLog: addLog,
    newLogId: newLogId,
    loadLegacyStats: function () { return readJson(STATS_KEY); },
    isMigrated: function () { return readJson(MIGRATED_KEY) === true; },
    markMigrated: function () { writeJson(MIGRATED_KEY, true); },
    loadPositions: function () { return readJson(POSITIONS_KEY) || {}; },
    savePositions: function (p) { writeJson(POSITIONS_KEY, p); },
  };
})();
