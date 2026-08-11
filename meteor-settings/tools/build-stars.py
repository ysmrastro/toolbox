#!/usr/bin/env python3
"""stars.js を作る（開発用。ブラウザからは読み込まれない）

Yale 輝星星表（BSC5）から「赤経・赤緯・実視等級」だけを抜き出し、
画角プレビューで使う最小限のデータに落とす。

  python3 meteor-settings/tools/build-stars.py

出力: meteor-settings/stars.js（MS_STARS を定義）

なぜ生成物をコミットするのか:
  このアプリは静的ファイルだけで動かす方針なので、実行時に外部から
  星表を取ってこない。生成は1回だけで、結果をリポジトリに入れる。

出典:
  Hoffleit D., Warren Jr W.H., The Bright Star Catalogue, 5th Revised Ed.
  Astronomical Data Center, NSSDC/ADC (1991) / CDS カタログ V/50
"""
import gzip
import json
import pathlib
import urllib.request

SRC = 'https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz'
MAG_LIMIT = 5.0          # ここまで入れると1600星ほど・30KB弱で、肉眼の見え方に近い
OUT = pathlib.Path(__file__).resolve().parent.parent / 'stars.js'

# 固有名を出す星。BSC5 の Bayer 名（バイエル符号＋星座略号）で引く。
# 1等星と、流星群でよく使う目印（北極星・ペルセウス座・北斗七星）に絞る。
NAMES = {
    'Alp CMa': 'シリウス',
    'Alp Car': 'カノープス',
    'Alp Boo': 'アークトゥルス',
    'Alp Cen': 'リギルケンタウルス',
    'Alp Lyr': 'ベガ',
    'Alp Aur': 'カペラ',
    'Bet Ori': 'リゲル',
    'Alp CMi': 'プロキオン',
    'Alp Eri': 'アケルナル',
    'Alp Ori': 'ベテルギウス',
    'Bet Cen': 'ハダル',
    'Alp Aql': 'アルタイル',
    'Alp Cru': 'アクルックス',
    'Alp Tau': 'アルデバラン',
    'Alp Sco': 'アンタレス',
    'Alp Vir': 'スピカ',
    'Bet Gem': 'ポルックス',
    'Alp PsA': 'フォーマルハウト',
    'Alp Cyg': 'デネブ',
    'Alp Leo': 'レグルス',
    'Alp Gem': 'カストル',
    'Gam Ori': 'ベラトリックス',
    'Eps Ori': 'アルニラム',
    'Alp UMi': 'ポラリス',
    'Alp Per': 'ミルファク',
    'Bet Per': 'アルゴル',
    'Alp Cas': 'シェダル',
    'Alp UMa': 'ドゥーベ',
    'Eps UMa': 'アリオト',
    'Eta UMa': 'アルカイド',
    'Alp And': 'アルフェラッツ',
    'Alp Peg': 'マルカブ',
    'Alp Ari': 'ハマル',
}

# 生成物の妥当性チェック（等級は BSC5 の実視等級。±0.05 で照合する）
# ポラリスは変光星で、一般に見る 1.97 等ではなく星表の値 2.02 等を正とする
EXPECT = {
    'シリウス': -1.46, 'ベガ': 0.03, 'カペラ': 0.08, 'リゲル': 0.12,
    'ポラリス': 2.02, 'アルゴル': 2.09, 'ミルファク': 1.79, 'アルデバラン': 0.85,
}


def bayer_key(name_field):
    """'9Alp CMa' → 'Alp CMa'（先頭のフラムスティード番号を落とす）"""
    s = name_field.strip()
    i = 0
    while i < len(s) and (s[i].isdigit() or s[i] == ' '):
        i += 1
    return s[i:].strip()


def main():
    print('星表を取得:', SRC)
    with urllib.request.urlopen(SRC, timeout=120) as r:
        raw = gzip.decompress(r.read()).decode('latin-1')

    stars = []
    named = {}
    for line in raw.splitlines():
        try:
            rah, ram, ras = line[75:77], line[77:79], line[79:83]
            sign, ded, dem, des = line[83], line[84:86], line[86:88], line[88:90]
            vmag = line[102:107]
            if not rah.strip() or not vmag.strip():
                continue
            mag = float(vmag)
            if mag > MAG_LIMIT:
                continue
            ra = (int(rah) + int(ram) / 60 + float(ras) / 3600) * 15
            dec = (int(ded) + int(dem) / 60 + int(des) / 3600) * (-1 if sign == '-' else 1)
        except (ValueError, IndexError):
            continue

        entry = [round(ra, 2), round(dec, 2), round(mag, 1)]
        key = bayer_key(line[4:14])
        if key in NAMES and NAMES[key] not in named:
            entry.append(NAMES[key])
            named[NAMES[key]] = mag
        stars.append(entry)

    stars.sort(key=lambda s: s[2])

    # 妥当性チェック
    bad = []
    for name, mag in EXPECT.items():
        got = named.get(name)
        if got is None or abs(got - mag) > 0.05:
            bad.append(f'{name}: 期待 {mag} / 実際 {got}')
    if bad:
        raise SystemExit('照合に失敗しました:\n  ' + '\n  '.join(bad))

    body = ',\n  '.join(json.dumps(s, ensure_ascii=False, separators=(',', ' ')) for s in stars)
    OUT.write_text(f'''/*
 * stars.js — 画角プレビュー用の星のデータ（自動生成・手で編集しない）
 *
 * 生成: python3 meteor-settings/tools/build-stars.py
 * 形式: [赤経(度, J2000), 赤緯(度, J2000), 実視等級, 固有名（あるものだけ）]
 * 収録: {MAG_LIMIT}等より明るい {len(stars)} 星
 *
 * 出典: Hoffleit D., Warren Jr W.H., The Bright Star Catalogue, 5th Revised Ed.
 *       Astronomical Data Center, NSSDC/ADC (1991) / CDS カタログ V/50
 */
const MS_STARS = [
  {body},
];

if (typeof module !== 'undefined' && module.exports) module.exports = MS_STARS;
''', encoding='utf-8')

    print(f'{len(stars)} 星 / 固有名 {len(named)} 個 / {OUT.stat().st_size / 1024:.1f}KB → {OUT}')
    print('照合OK:', ', '.join(f'{k} {v}' for k, v in list(EXPECT.items())[:4]))


if __name__ == '__main__':
    main()
