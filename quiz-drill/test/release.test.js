/*
 * release.test.js — 配信物の版がそろっているか
 *
 * 版は version.js と index.html（meta と ?v=）に出てくる。ずれると「古い HTML ＋ 新しい JS」で起動して
 * 画面が動かなくなる（meteor-settings で実際に起きた）。版を打つのは tools/release.py の仕事。
 * 手で書き換えると、ここが落ちる。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const vjs = fs.readFileSync(path.join(dir, 'version.js'), 'utf8');
const m = vjs.match(/version: '([^']+)', updated: '([^']+)'/);

test('version.js に版と更新日時がある', () => {
  assert.ok(m, 'version.js の QD_VERSION が読めない');
  assert.match(m[1], /^\d+\.\d+\.\d+$/);
  assert.match(m[2], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('index.html の meta app-version が version.js と一致する', () => {
  const meta = html.match(/<meta name="app-version" content="([^"]+)">/);
  assert.ok(meta, 'meta app-version が無い');
  assert.strictEqual(meta[1], m[1]);
});

test('index.html の自作の js/css の ?v= がすべて同じ版', () => {
  const queries = Array.from(html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))\?v=([^"]+)"/g));
  assert.ok(queries.length >= 7, `?v= 付きの js/css が少なすぎる（${queries.length}件）`);
  const bad = queries.filter((q) => q[2] !== m[1]).map((q) => `${q[1]}?v=${q[2]}`);
  assert.deepEqual(bad, [], `版がずれている: ${bad.join(', ')}`);
});

test('版を付け忘れた自作の js/css が無い', () => {
  // 外部（http）と、共通 CSS（../shared）は対象外
  const unversioned = Array.from(html.matchAll(/(?:src|href)="((?!https?:|\.\.\/)[^"?]+\.(?:js|css))"/g)).map((q) => q[1]);
  assert.deepEqual(unversioned, [], `?v= が付いていない: ${unversioned.join(', ')}`);
});

test('version.js が、ほかの js より先に読まれる', () => {
  const scripts = Array.from(html.matchAll(/<script src="([^"?]+\.js)\?v=/g)).map((q) => q[1]);
  assert.strictEqual(scripts[0], 'version.js');
});

test('更新日時が未来でない', () => {
  const t = new Date(m[2].replace(' ', 'T') + ':00');   // 端末のローカル時刻として読む
  assert.ok(t.getTime() <= Date.now() + 60 * 1000, `更新日時が未来: ${m[2]}`);
});
