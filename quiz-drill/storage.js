/*
 * storage.js — 保存まわりの薄いラッパ
 *
 * 問題集は IndexedDB に置く。localStorage は 5MB 前後で頭打ちになり、画像入りの問題集
 * （1ファイル 5〜6MB）が入らないため。レコードは問題集1つにつき1件（keyPath は問題集の id）
 * なので、同じ id を put すれば置き換え、違う id なら追加になる。
 *
 * 進行中のセッションと問題ごとの成績は小さいので localStorage に置く。
 * localStorage はプライベートブラウズなどで例外を投げることがあるので、読み書きは握りつぶす
 * （保存できなくても出題はできる）。
 */
var QD_STORAGE = (function () {
  'use strict';

  var DB_NAME = 'quiz-drill';
  var DB_VERSION = 1;
  var STORE = 'sets';
  var SESSION_KEY = 'quiz-drill.session';
  var STATS_KEY = 'quiz-drill.stats';

  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  /** 1つのトランザクションで store に対する処理を行い、完了を待つ */
  function withStore(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var result = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(result && 'result' in result ? result.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  /** 保存済みの問題集をすべて返す。並びは保存した順（savedAt）にする */
  function getAllSets() {
    return withStore('readonly', function (store) { return store.getAll(); })
      .then(function (records) {
        return (records || [])
          .sort(function (a, b) { return (a.savedAt || 0) - (b.savedAt || 0); })
          .map(function (r) { return r.set; });
      });
  }

  /**
   * 問題集を保存する。同じ id は置き換え。置き換えのときは元の savedAt を引き継いで
   * 一覧での位置を変えない。
   */
  function putSets(sets) {
    return getSavedAt().then(function (savedAt) {
      var now = Date.now();
      return withStore('readwrite', function (store) {
        sets.forEach(function (set, i) {
          store.put({ id: set.id, set: set, savedAt: savedAt[set.id] || now + i });
        });
      });
    });
  }

  function getSavedAt() {
    return withStore('readonly', function (store) { return store.getAll(); })
      .then(function (records) {
        var map = {};
        (records || []).forEach(function (r) { map[r.id] = r.savedAt; });
        return map;
      });
  }

  function deleteSet(id) {
    return withStore('readwrite', function (store) { store.delete(id); });
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
    getAllSets: getAllSets,
    putSets: putSets,
    deleteSet: deleteSet,
    loadSession: function () { return readJson(SESSION_KEY); },
    saveSession: function (s) { writeJson(SESSION_KEY, s); },
    clearSession: function () { writeJson(SESSION_KEY, null); },
    loadStats: function () { return readJson(STATS_KEY) || {}; },
    saveStats: function (s) { writeJson(STATS_KEY, s); },
  };
})();
