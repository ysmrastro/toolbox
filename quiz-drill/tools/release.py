#!/usr/bin/env python3
"""版と更新時刻を、まとめて打つ（開発用）

    python3 quiz-drill/tools/release.py 1.1.0

更新するのは次の3か所。手で書くと、必ずどこかを忘れるか、時刻を推測で書いてしまう
（meteor-settings の tools/release.py と同じ考え方。Service Worker は無いので、その分は無い）。

  1. version.js の QD_VERSION.version
  2. version.js の QD_VERSION.updated  ← このスクリプトが「いまの時刻」を入れる
  3. index.html の <meta name="app-version"> と、自作の js/css の ?v=

実行後は、`npm run test:quiz-drill` を通す（3か所の一致と、更新時刻が未来でないことを
test/release.test.js が検査する）。
"""
import datetime
import pathlib
import re
import sys

DIR = pathlib.Path(__file__).resolve().parent.parent
SEMVER = re.compile(r'^\d+\.\d+\.\d+$')


def main():
    if len(sys.argv) != 2 or not SEMVER.match(sys.argv[1]):
        raise SystemExit('使い方: python3 quiz-drill/tools/release.py 1.1.0')
    version = sys.argv[1]
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')

    vjs = DIR / 'version.js'
    src = vjs.read_text(encoding='utf-8')
    old = re.search(r"version: '([^']+)'", src).group(1)
    src = re.sub(r"version: '[^']+'", f"version: '{version}'", src)
    src = re.sub(r"updated: '[^']+'", f"updated: '{now}'", src)
    vjs.write_text(src, encoding='utf-8')

    html = DIR / 'index.html'
    h = html.read_text(encoding='utf-8')
    h = re.sub(r'(<meta name="app-version" content=")[^"]+(")', rf'\g<1>{version}\g<2>', h)
    # 自作の js/css の ?v= をすべて置き換える（付け忘れは release.test.js が検出する）
    h = re.sub(r'((?:src|href)="[^"?]+\.(?:js|css))\?v=[^"]+"', rf'\g<1>?v={version}"', h)
    html.write_text(h, encoding='utf-8')

    print(f'{old} → {version} / 更新時刻 {now}')
    print('version.js / index.html を更新しました。')
    print('次に: npm run test:quiz-drill')


if __name__ == '__main__':
    main()
