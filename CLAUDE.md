# CLAUDE.md

## プロジェクト概要

ysmrastro toolbox — ちょっとしたWebアプリツール集。GitHub Pages でホスティング。

- サイトURL: https://ysmrastro.github.io/toolbox/
- フレームワーク不使用。純粋なHTML/CSS/JSで構成
- `.nojekyll` によりJekyll処理を無効化

## ディレクトリ構成

```
toolbox/
├── index.html              # ツール一覧トップページ
├── shared/css/             # 共通CSSアセット
│   ├── variables.css       # CSS変数
│   ├── reset.css           # リセットCSS
│   ├── components.css      # 共通UIコンポーネント（tb-プレフィクス）
│   └── layout.css          # 共通レイアウト
├── qr-generator/           # QRコード生成ツール
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── presets.js
│   └── logos/              # プリセットロゴSVG
└── meteor-settings/        # 流星撮影セッティング（PWA）
    ├── index.html
    ├── style.css
    ├── data.js             # カメラ/レンズ/流星群/観測地データ
    ├── astro.js            # 放射点高度・太陽高度・月齢
    ├── engine.js           # note記事の付録A 8式の実装
    ├── lightpollution.js   # 光害地図タイルから地点の夜空の明るさを引く
    ├── lp-tiles/           # 光害地図タイル（日本周辺・34枚・約0.8MB）
    ├── app.js
    ├── selftest.js         # 記事の数値を再現するかの検証（node で実行）
    ├── manifest.json / sw.js
    └── README.md           # 出典・前提・データ確度の詳細
```

**meteor-settings について**: 計算は friend_camera 氏の note 記事（著者の許諾済み）に基づく。
夜空の明るさは David Lorenz 氏の光害アトラス2025から日本周辺を切り出して同梱している。
**この値は天頂の人工光輝度であり Bortle スケールではない**（原著者の要請で明記が必要）。
前提・確度・検証結果は `meteor-settings/README.md` に集約してある。
著者の確認済みで、トップページからも導線を張っている。

## 共通CSS

- `tb-` プレフィクスで名前衝突を回避
- 夜空テーマカラー: `#0d1117`(背景), `#1a1a2e`(パネル), `#7eb8da`(アクセント)
- CSS Custom Properties で統一管理（`shared/css/variables.css`）

## 新しいツールの追加パターン

1. `tool-name/` ディレクトリを作成
2. `index.html` で `shared/css/*.css` をインポート
3. ツール固有のCSS/JSを配置
4. トップページ `index.html` にカードを追加
5. **OGP/Twitterカードのメタタグと `ogp.png` を用意する**（下記）

## SNS共有用のOGP

X などにリンクを貼ってもサムネイルが出ないのは `og:image` が無いため。各ページに
OGP/Twitterカードのメタタグを置き、1200×630 の `ogp.png` を同じディレクトリに置く。

- **`og:image` は絶対URLで書く**（相対パスでは反映されない）
- `twitter:card` は `summary_large_image`
- 画像の生成元は `ogp-source.html`（各ディレクトリ）。1200×630 でスクリーンショットを撮る:
  ```bash
  python3 -m http.server 8899        # リポジトリのルートで
  # Playwright で ogp-source.html を 1200x630 で撮影し ogp.png として保存
  ```
- X はカード情報をURL単位でキャッシュするため、タグを追加した直後は
  `?v=2` のようなクエリを付けて投稿すると新しいカードが読まれる

## バージョン表記（meteor-settings）

アプリバー右上に `vX.Y.Z` と更新日を小さく表示している。バグ修正は +0.0.1、
機能追加は +0.1（パッチは0に戻す）、メジャーはよほどの変更のときだけ。
リリース時は `data.js` の `appVersion` / `appUpdated` と `sw.js` の `CACHE` を
まとめて更新する（詳細は `meteor-settings/README.md`）。

## 開発コマンド

```bash
npx serve .                    # ローカルサーバー
python3 -m http.server         # 代替
```

## デプロイ

mainブランチへのpushでGitHub Pagesが自動デプロイ。
