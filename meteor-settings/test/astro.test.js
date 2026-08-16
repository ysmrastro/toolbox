/*
 * astro.test.js — 日の出入り・月の出入り・月齢を国立天文台の公表値と突き合わせる
 *
 * 期待値の出典（暦計算室「各地のこよみ」2026年）:
 *   東京 8月  https://eco.mtk.nao.ac.jp/koyomi/dni/2026/s1308.html  /  m1308.html
 *   東京 12月 https://eco.mtk.nao.ac.jp/koyomi/dni/2026/m1312.html
 *   根室 8月  https://eco.mtk.nao.ac.jp/koyomi/dni/2026/m0108.html
 *
 * **アプリの外にある独立した真値**なので、astro.js の近似を書き換えたときに
 * 本当にずれたかどうかが分かる。表の「南中」列と「月の入」列を間違えやすいので注意
 * （一度取り違えた）。
 *
 * 参照値は JST の時刻。テストは TZ=Asia/Tokyo で走らせる（package.json の test）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/load.js');

const { D, A, P } = load();

const SITES = {
  tokyo: { name: '東京', lat: 35.6581, lon: 139.7414 },
  nemuro: { name: '根室', lat: 43.3333, lon: 145.5833 },
};

/* [地点, 年, 月, 日, 日の出, 日の入, 月の出, 月の入, 月齢] — null は公表値なし */
const REF = [
  ['tokyo', 2026, 8, 1, '4:49', '18:46', '20:12', '7:02', 17.7],
  ['tokyo', 2026, 8, 12, '4:57', '18:35', '3:56', '18:20', 28.7],
  ['tokyo', 2026, 8, 13, '4:58', '18:33', '5:10', '18:53', 0.4],
  ['tokyo', 2026, 8, 20, '5:03', '18:25', '12:42', '22:19', 7.4],
  ['tokyo', 2026, 8, 31, '5:12', '18:10', '19:33', '8:01', 18.4],
  ['tokyo', 2026, 12, 12, null, null, '9:13', '19:02', 3.1],
  ['tokyo', 2026, 12, 13, null, null, '9:47', '20:02', 4.1],
  ['tokyo', 2026, 12, 14, null, null, '10:17', '21:01', 5.1],
  ['tokyo', 2026, 12, 21, null, null, '13:36', '3:19', 12.1],
  ['nemuro', 2026, 8, 1, null, null, '19:54', '6:28', 17.7],
  ['nemuro', 2026, 8, 12, null, null, '3:10', '18:13', 28.7],
  ['nemuro', 2026, 8, 13, null, null, '4:31', '18:40', 0.4],
  ['nemuro', 2026, 8, 20, null, null, '12:45', '21:27', 7.4],
  ['nemuro', 2026, 8, 31, null, null, '19:00', '7:44', 18.4],
];

/* 許容範囲。撮影の計画に使う用途では、月が数分ずれても判断は変わらない。
   これを超えたら近似の書き方（画面の注記）も見直す必要がある。 */
const LIMIT = { sun: 2, moon: 4, age: 0.1 };

function toMinutes(s) {
  const p = s.split(':').map(Number);
  return p[0] * 60 + p[1];
}

function minutesOf(d) {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

test('テストは日本時間で走っていること（参照値が JST のため）', () => {
  assert.strictEqual(new Date(2026, 7, 13).getTimezoneOffset(), -540,
    'TZ=Asia/Tokyo を付けて実行する（npm test なら自動で付く）');
});

REF.forEach((row) => {
  const [siteId, y, mo, d, sunrise, sunset, moonrise, moonset, age] = row;
  const site = SITES[siteId];

  test(`${site.name} ${y}/${mo}/${d} が国立天文台の公表値と合う`, () => {
    const ev = A.dayEvents(new Date(y, mo - 1, d, 0, 0, 0, 0), site.lat, site.lon);
    const items = [
      ['日の出', ev.sunrise, sunrise, LIMIT.sun],
      ['日の入', ev.sunset, sunset, LIMIT.sun],
      ['月の出', ev.moonrise, moonrise, LIMIT.moon],
      ['月の入', ev.moonset, moonset, LIMIT.moon],
    ];
    items.forEach(([label, got, want, limit]) => {
      if (!want) return;
      assert.ok(got, `${label}: 求まらなかった（公表値 ${want}）`);
      const dm = minutesOf(got) - toMinutes(want);
      assert.ok(Math.abs(dm) <= limit,
        `${label}: ${dm >= 0 ? '+' : ''}${dm.toFixed(1)}分ずれ（許容 ±${limit}分／公表値 ${want}）`);
    });
    const da = ev.moonAge - age;
    assert.ok(Math.abs(da) <= LIMIT.age,
      `月齢: ${da >= 0 ? '+' : ''}${da.toFixed(2)}日ずれ（許容 ±${LIMIT.age}日／公表値 ${age}）`);
  });
});

/* ===================== 現状値の固定 =====================
 * 放射点の高度には手近な公表値が無いので、現状値で固定して回帰だけ見る。
 */

test('[現状値] 2026-08-13 01:00 JST 東京 のペルセウス座放射点と太陽・月', () => {
  const per = D.showers.find((s) => s.id === 'per');
  const d = new Date(2026, 7, 13, 1, 0, 0, 0);
  const rad = A.radiantAltitude(d, 35.69, 139.69, per);
  assert.ok(Math.abs(rad.altitude - 41.7) <= 0.2, `放射点高度 ${rad.altitude.toFixed(1)}°`);
  assert.ok(Math.abs(rad.azimuth - 41) <= 1, `放射点方位 ${rad.azimuth.toFixed(0)}°`);

  const sun = A.sunPosition(d, 35.69, 139.69);
  assert.ok(sun.altitude < -18, `完全な暗夜であること（太陽高度 ${sun.altitude.toFixed(1)}°）`);

  const moon = A.moonInfo(d, 35.69, 139.69);
  assert.ok(moon.altitude < 0, `月は沈んでいること（高度 ${moon.altitude.toFixed(1)}°）`);
  assert.ok(moon.illumination < 0.02, `ほぼ新月であること（輝面比 ${moon.illumination.toFixed(3)}）`);
});

test('夜のタイムラインは日没から日の出までを覆う', () => {
  const per = D.showers.find((s) => s.id === 'per');
  const tl = A.nightTimeline(new Date(2026, 7, 13, 1, 0, 0, 0), 35.69, 139.69, per);

  // 8/12 の夜として扱われる（未明は前の夜の続き）
  assert.strictEqual(tl.sunset.getDate(), 12, '日没は 8/12');
  assert.strictEqual(tl.sunrise.getDate(), 13, '日の出は 8/13');
  assert.ok(tl.duskAstro > tl.sunset, '天文薄明の終わりは日没より後');
  assert.ok(tl.dawnAstro < tl.sunrise, '天文薄明の始まりは日の出より前');
  assert.ok(tl.goldenMinutes > 0, 'この夜は狙える時間がある（新月期のペルセウス）');
  assert.ok(tl.goldenMinutes <= (tl.dawnAstro - tl.duskAstro) / 60000 + 1,
    '狙える時間は暗夜の長さを超えない');
});

test('狙える時間は月が出ている夜のほうが短い', () => {
  const per = D.showers.find((s) => s.id === 'per');
  const lat = 35.69;
  const lon = 139.69;
  // 2026年の極大は新月期、2027年は満月期（P.evaluatePeakNight と同じ数え方で引く）
  const y2026 = P.evaluatePeakNight(per, 2026, lat, lon);
  const y2027 = P.evaluatePeakNight(per, 2027, lat, lon);
  assert.ok(y2026.illumination < 0.1, `2026年の極大は新月期（輝面比 ${y2026.illumination.toFixed(2)}）`);
  assert.ok(y2027.illumination > 0.7, `2027年の極大は満月期（輝面比 ${y2027.illumination.toFixed(2)}）`);
  assert.ok(y2026.goldenMinutes > y2027.goldenMinutes,
    `新月期のほうが長く狙える（2026: ${y2026.goldenMinutes}分 / 2027: ${y2027.goldenMinutes}分）`);
});
