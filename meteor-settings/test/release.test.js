/*
 * release.test.js — 配信物の版がそろっているか
 *
 * 版は data.js / index.html（meta と ?v=）/ sw.js の4か所に出てくる。ずれると
 * 「古い HTML ＋ 新しい JS」で起動して**画面が真っ白になる**（v1.3.2 で実際に起きた）。
 * 単体テストというよりリリース検査だが、機械が見れば必ず気づけるのでここに置く。
 *
 * 版を打つのは tools/release.py の仕事。手で書き換えるとここが落ちる。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { load, readAppFile } = require('./helpers/load.js');

const { D } = load();
const version = D.appVersion;
const html = readAppFile('index.html');
const sw = readAppFile('sw.js');

test('index.html の meta app-version が data.js と一致する', () => {
  const m = html.match(/<meta name="app-version" content="([^"]+)">/);
  assert.ok(m, 'meta app-version が無い');
  assert.strictEqual(m[1], version);
});

test('index.html の js/css の ?v= がすべて同じ版', () => {
  const queries = Array.from(html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))\?v=([^"]+)"/g));
  assert.ok(queries.length >= 9, `?v= 付きの js/css が少なすぎる（${queries.length}件）`);
  const bad = queries.filter((m) => m[2] !== version).map((m) => `${m[1]}?v=${m[2]}`);
  assert.deepEqual(bad, [], `版がずれている: ${bad.join(', ')}`);
});

test('版を付け忘れた js/css が無い', () => {
  const unversioned = Array.from(html.matchAll(/(?:src|href)="((?!https?:)[^"?]+\.(?:js|css))"/g))
    .map((m) => m[1]);
  assert.deepEqual(unversioned, [], `?v= が付いていない: ${unversioned.join(', ')}`);
});

test('sw.js の VERSION が一致する', () => {
  const m = sw.match(/const VERSION = '([^']+)'/);
  assert.ok(m, 'sw.js に VERSION が無い');
  assert.strictEqual(m[1], version);
});

test('sw.js が index.html の読む js をすべてキャッシュ対象にしている', () => {
  /* 片方に足し忘れると、その1本だけネットワークから取りに行くことになる。
     オフラインは要件ではないが、版のそろい方を見る意味でも突き合わせておく。 */
  const scripts = Array.from(html.matchAll(/<script src="([^"?]+\.js)\?v=/g)).map((m) => m[1]);
  scripts.forEach((s) => {
    assert.ok(sw.includes(`'./${s}'`), `sw.js の VERSIONED に ./${s} が無い`);
  });
});

test('data.js の appUpdated の書式', () => {
  assert.match(D.appUpdated, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('appUpdated が未来の時刻になっていない', () => {
  /* 手で書くとうっかり未来の時刻を入れてしまう（実際に最大2時間先の値が入っていた）。
     tools/release.py で打つのが正。端末の時計のずれを考えて5分だけ猶予を持たせる。 */
  const updatedAt = new Date(D.appUpdated.replace(' ', 'T'));
  const skewMin = (updatedAt.getTime() - Date.now()) / 60000;
  assert.ok(skewMin <= 5,
    `${Math.round(skewMin)}分先の時刻になっている（tools/release.py で打ち直す）`);
});

/** '1.10.0' > '1.9.1' を正しく比べる（文字列比較だと逆になる） */
function cmpVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

test('更新履歴に、いまの版より新しい版が載っていない', () => {
  /* 内部の整理だけの版は changelog に載せない決まりなので「先頭＝いまの版」とは
     限らない。逆に、まだ出していない版が載っているのは書きすぎか打ち忘れ。 */
  assert.ok(Array.isArray(D.changelog) && D.changelog.length > 0);
  assert.ok(cmpVersion(D.changelog[0].version, version) <= 0,
    `changelog の先頭 ${D.changelog[0].version} が appVersion ${version} より新しい`);
});

test('更新履歴が新しい順に並んでいる', () => {
  for (let i = 1; i < D.changelog.length; i++) {
    const prev = D.changelog[i - 1].version;
    const cur = D.changelog[i].version;
    assert.ok(cmpVersion(prev, cur) > 0, `${prev} の次に ${cur} が来ている（新しい順に並べる）`);
  }
});
