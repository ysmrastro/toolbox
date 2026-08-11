#!/usr/bin/env python3
"""版と更新時刻を4か所へまとめて打つ（開発用）

    python3 meteor-settings/tools/release.py 1.6.0

更新するのは次の4か所。手で書くと必ずどこかを忘れるか、時刻を推測で書いてしまう。
（実際に appUpdated を手打ちして、実際の時刻より最大2時間先の値を入れていた）

  1. data.js の MS_DATA.appVersion
  2. data.js の MS_DATA.appUpdated  ← このスクリプトが「いまの時刻」を入れる
  3. index.html の <meta name="app-version"> と js/css の ?v=
  4. sw.js の VERSION

実行後は必ず `node meteor-settings/selftest.js` を通す（4か所の一致と、
更新時刻が未来でないことを検査する）。
"""
import datetime
import pathlib
import re
import sys

DIR = pathlib.Path(__file__).resolve().parent.parent
SEMVER = re.compile(r'^\d+\.\d+\.\d+$')


def main():
    if len(sys.argv) != 2 or not SEMVER.match(sys.argv[1]):
        raise SystemExit('使い方: python3 meteor-settings/tools/release.py 1.6.0')
    version = sys.argv[1]
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')

    data = DIR / 'data.js'
    src = data.read_text(encoding='utf-8')
    old_version = re.search(r"MS_DATA\.appVersion = '([^']+)'", src).group(1)
    src = re.sub(r"MS_DATA\.appVersion = '[^']+'", f"MS_DATA.appVersion = '{version}'", src)
    src = re.sub(r"MS_DATA\.appUpdated = '[^']+'", f"MS_DATA.appUpdated = '{now}'", src)
    data.write_text(src, encoding='utf-8')

    html = DIR / 'index.html'
    h = html.read_text(encoding='utf-8')
    h = re.sub(r'(<meta name="app-version" content=")[^"]+(")', rf'\g<1>{version}\g<2>', h)
    # js/css の ?v= をすべて置き換える（付け忘れは selftest が検出する）
    h = re.sub(r'((?:src|href)="[^"?]+\.(?:js|css))\?v=[^"]+"', rf'\g<1>?v={version}"', h)
    html.write_text(h, encoding='utf-8')

    sw = DIR / 'sw.js'
    w = sw.read_text(encoding='utf-8')
    w = re.sub(r"const VERSION = '[^']+'", f"const VERSION = '{version}'", w)
    sw.write_text(w, encoding='utf-8')

    print(f'{old_version} → {version} / 更新時刻 {now}')
    print('data.js / index.html / sw.js を更新しました。')
    print('次に: node meteor-settings/selftest.js')


if __name__ == '__main__':
    main()
