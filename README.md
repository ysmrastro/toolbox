# ysmrastro toolbox

ちょっとしたWebアプリツール集。GitHub Pages でホスティング。

## ツール一覧

- **QRコード生成ツール** — カスタマイズ可能なQRコード生成。プリセットテーマ・ロゴ対応
- **流星撮影セッティング** — 機材構成と流星群・撮影目的から露出・F値・ISOを理論で算出（PWA・オフライン対応）
- **光軸合わせシミュレーター** — ニュートン式反射望遠鏡。ネジを1本ずつ動かして、センタリングアイピースで覗いた景色がどう変わるかを確かめる

## 開発

ローカルサーバーで確認：

```bash
npx serve .
# または
python3 -m http.server
```

## デプロイ

`main` ブランチへの push で GitHub Pages が自動デプロイ。

サイトURL: https://ysmrastro.github.io/toolbox/
