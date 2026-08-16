/*
 * test/helpers/load.js — 計算まわりのファイルをブラウザと同じ形で読み込む
 *
 * data.js / astro.js / engine.js / plan.js はブラウザでは <script> タグで順に読まれ、
 * 1つのスクリプトスコープを共有する（engine.js が MS_DATA を、plan.js が MS_ASTRO を
 * 素のグローバルとして参照している）。require で1本ずつ読むとこの関係が崩れるので、
 * vm で連結評価して本番と同じ読まれ方を再現する。
 *
 * app.js だけは DOM に結び付いているため読まない。app.js の中の計算は plan.js に
 * 切り出してあるので、そちらをここから触る。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appDir = path.join(__dirname, '..', '..');
const FILES = ['data.js', 'astro.js', 'engine.js', 'plan.js'];

let cached = null;

/** { D: MS_DATA, A: MS_ASTRO, E: MS_ENGINE, P: MS_PLAN } を返す */
function load() {
  if (cached) return cached;

  // module を undefined にしておくと、各ファイル末尾の module.exports ガードが働かない
  // ＝ブラウザと同じくグローバルに置くだけになる
  const sandbox = { console: console, module: undefined };
  vm.createContext(sandbox);

  const source = FILES
    .map((f) => path.join(appDir, f))
    .map((p) => fs.readFileSync(p, 'utf8'))
    .join('\n;\n');

  vm.runInContext(
    source + '\n;globalThis.__exports = { D: MS_DATA, A: MS_ASTRO, E: MS_ENGINE, P: MS_PLAN };',
    sandbox, { filename: 'bundle.js' }
  );

  cached = sandbox.__exports;
  return cached;
}

/** index.html / sw.js など、テキストとして突き合わせるファイルを読む */
function readAppFile(name) {
  return fs.readFileSync(path.join(appDir, name), 'utf8');
}

module.exports = { load: load, readAppFile: readAppFile, appDir: appDir };
