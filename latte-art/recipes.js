/*
 * recipes.js — 決まった注ぎ方（OGP 画像の生成と、調整値を見比べるときに使う）
 *
 * 解説に書かれている手順をそのまま入力にしたもの（README の出典）。
 *   1. 高い位置から、ゆっくり注いでカップを半分まで満たす（沈めて茶色の土台を作る）
 *   2. 注ぎ口を液面ぎりぎりに下げ、中央に白を乗せて広げる
 *   3. 液面の近くから、素早く奥へ横切って切り抜く
 * LATTE.drive(HEART.frames, HEART.input) のように渡す。1フレーム＝1/60秒。
 * 配信はされるが、画面からは使っていない。
 */
var HEART = {
  frames: 720,
  input: function (i) {
    if (i < 300) return { x: 0.5, y: 0.5, flow: 0.5, low: false };
    if (i < 520) return { x: 0.5, y: 0.5, flow: 0.6, low: true };
    if (i < 550) { var t = (i - 520) / 30; return { x: 0.5, y: 0.25 + 0.55 * t, flow: 0.35, low: true }; }
    return { x: 0.5, y: 0.8, flow: 0, low: false };
  },
};
