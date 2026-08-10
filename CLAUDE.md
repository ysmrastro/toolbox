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
└── meteor-settings/        # 流星撮影セッティング（PWA・トップページ未掲載）
    ├── index.html
    ├── style.css
    ├── data.js             # カメラ/レンズ/流星群/観測地データ
    ├── astro.js            # 放射点高度・太陽高度・月齢
    ├── engine.js           # note記事の付録A 8式の実装
    ├── app.js
    ├── selftest.js         # 記事の数値を再現するかの検証（node で実行）
    ├── manifest.json / sw.js
    └── README.md           # 出典・前提・データ確度の詳細
```

**meteor-settings について**: 計算は friend_camera 氏の note 記事（著者の許諾済み）に基づく。
前提・確度・検証結果は `meteor-settings/README.md` に集約してある。
著者レビュー中のためトップページの導線には**まだ載せていない**（直リンクのみ）。

## 共通CSS

- `tb-` プレフィクスで名前衝突を回避
- 夜空テーマカラー: `#0d1117`(背景), `#1a1a2e`(パネル), `#7eb8da`(アクセント)
- CSS Custom Properties で統一管理（`shared/css/variables.css`）

## 新しいツールの追加パターン

1. `tool-name/` ディレクトリを作成
2. `index.html` で `shared/css/*.css` をインポート
3. ツール固有のCSS/JSを配置
4. トップページ `index.html` にカードを追加

## 開発コマンド

```bash
npx serve .                    # ローカルサーバー
python3 -m http.server         # 代替
```

## デプロイ

mainブランチへのpushでGitHub Pagesが自動デプロイ。
