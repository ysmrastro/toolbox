/*
 * 日の出入り・月の出入り・月齢を国立天文台の公表値と突き合わせる（開発用）
 *
 *   TZ=Asia/Tokyo node meteor-settings/tools/check-riseset.js
 *
 * カレンダーに時刻を出すようになったので、どれだけずれるかを数字で押さえておく。
 * 参照値の出典（暦計算室「各地のこよみ」2026年）:
 *   東京 8月  https://eco.mtk.nao.ac.jp/koyomi/dni/2026/s1308.html  /  m1308.html
 *   東京 12月 https://eco.mtk.nao.ac.jp/koyomi/dni/2026/m1312.html
 *   根室 8月  https://eco.mtk.nao.ac.jp/koyomi/dni/2026/m0108.html
 * 表の「南中」列と「月の入」列を間違えやすいので注意（一度取り違えた）。
 */
const A = require('../astro.js');

/* 参照値は JST の時刻なので、実行環境のタイムゾーンが日本でないと比べられない */
if (new Date(2026, 7, 13).getTimezoneOffset() !== -540) {
  console.error('TZ が日本時間ではありません。TZ=Asia/Tokyo を付けて実行してください。');
  process.exit(1);
}

const SITES = {
  tokyo: { name: '東京', lat: 35.6581, lon: 139.7414 },
  nemuro: { name: '根室', lat: 43.3333, lon: 145.5833 },
};

/* [地点, 年, 月, 日, 日の出, 日の入, 月の出, 月の入, 月齢] — null は公表値なし */
const REF = [
  ['tokyo', 2026, 8, 1,  '4:49', '18:46', '20:12', '7:02',  17.7],
  ['tokyo', 2026, 8, 12, '4:57', '18:35', '3:56',  '18:20', 28.7],
  ['tokyo', 2026, 8, 13, '4:58', '18:33', '5:10',  '18:53', 0.4],
  ['tokyo', 2026, 8, 20, '5:03', '18:25', '12:42', '22:19', 7.4],
  ['tokyo', 2026, 8, 31, '5:12', '18:10', '19:33', '8:01',  18.4],
  ['tokyo', 2026, 12, 12, null, null, '9:13',  '19:02', 3.1],
  ['tokyo', 2026, 12, 13, null, null, '9:47',  '20:02', 4.1],
  ['tokyo', 2026, 12, 14, null, null, '10:17', '21:01', 5.1],
  ['tokyo', 2026, 12, 21, null, null, '13:36', '3:19',  12.1],
  ['nemuro', 2026, 8, 1,  null, null, '19:54', '6:28',  17.7],
  ['nemuro', 2026, 8, 12, null, null, '3:10',  '18:13', 28.7],
  ['nemuro', 2026, 8, 13, null, null, '4:31',  '18:40', 0.4],
  ['nemuro', 2026, 8, 20, null, null, '12:45', '21:27', 7.4],
  ['nemuro', 2026, 8, 31, null, null, '19:00', '7:44',  18.4],
];

function toMinutes(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function hhmm(d) {
  if (!d) return '—';
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

function diff(got, want) {
  if (!got || !want) return null;
  return got.getHours() * 60 + got.getMinutes() + got.getSeconds() / 60 - toMinutes(want);
}

let worstSun = 0;
let worstMoon = 0;
let worstAge = 0;
const lines = [];

REF.forEach(([siteId, y, mo, d, sunrise, sunset, moonrise, moonset, age]) => {
  const site = SITES[siteId];
  const ev = A.dayEvents(new Date(y, mo - 1, d, 0, 0, 0, 0), site.lat, site.lon);
  const items = [
    ['日の出', ev.sunrise, sunrise, 'sun'],
    ['日の入', ev.sunset, sunset, 'sun'],
    ['月の出', ev.moonrise, moonrise, 'moon'],
    ['月の入', ev.moonset, moonset, 'moon'],
  ];
  items.forEach(([label, got, want, kind]) => {
    if (!want) return;
    const dm = diff(got, want);
    if (dm === null) {
      lines.push(`  NG  ${site.name} ${mo}/${d} ${label}: 求まらなかった（公表値 ${want}）`);
      worstMoon = Infinity;
      return;
    }
    if (kind === 'sun') worstSun = Math.max(worstSun, Math.abs(dm));
    else worstMoon = Math.max(worstMoon, Math.abs(dm));
    lines.push(`      ${site.name} ${String(mo).padStart(2)}/${String(d).padStart(2)} ${label}` +
      ` ${hhmm(got).padStart(6)} / 公表 ${want.padStart(6)}  ${dm >= 0 ? '+' : ''}${dm.toFixed(1)}分`);
  });
  const da = ev.moonAge - age;
  worstAge = Math.max(worstAge, Math.abs(da));
  lines.push(`      ${site.name} ${String(mo).padStart(2)}/${String(d).padStart(2)} 月齢 ` +
    `${ev.moonAge.toFixed(1)} / 公表 ${age}  ${da >= 0 ? '+' : ''}${da.toFixed(1)}日`);
});

console.log('=== 国立天文台の公表値との差 ===');
lines.forEach((l) => console.log(l));
console.log('');
console.log(`最大の差: 太陽 ${worstSun.toFixed(1)}分 / 月 ${worstMoon.toFixed(1)}分 / 月齢 ${worstAge.toFixed(2)}日`);

/* 許容範囲。撮影の計画に使う用途では、月が数分ずれても判断は変わらない。
   これを超えたら近似の書き方（画面の注記）も見直す必要がある */
const LIMIT = { sun: 2, moon: 4, age: 0.1 };
const ng = [];
if (worstSun > LIMIT.sun) ng.push(`太陽が ${LIMIT.sun}分 を超えた`);
if (worstMoon > LIMIT.moon) ng.push(`月が ${LIMIT.moon}分 を超えた`);
if (worstAge > LIMIT.age) ng.push(`月齢が ${LIMIT.age}日 を超えた`);
if (ng.length) {
  console.error('\nNG: ' + ng.join(' / '));
  process.exit(1);
}
console.log(`許容範囲（太陽${LIMIT.sun}分・月${LIMIT.moon}分・月齢${LIMIT.age}日）に収まっています。`);
