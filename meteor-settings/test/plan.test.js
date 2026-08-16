/*
 * plan.test.js — 「いつ・どこを狙うか」の計算（plan.js）
 *
 * この層は過去に2回バグを出しているのに、これまで app.js のクロージャの中にいて
 * テストが書けなかった。plan.js に切り出した目的はここを固めること。
 *   - 放射点から45°離すはずが離れていなかった（v1.8.0 で修正）
 *   - 朝に見ると「今夜」が1日ずれていた（v1.9.1 で修正）
 * どちらも下に回帰テストがある。直す前のコードでは落ちる書き方にしてある。
 *
 * 時刻は TZ=Asia/Tokyo で走らせる前提（package.json の test）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/load.js');

const { D, A, P } = load();

const TOKYO = { lat: 35.6581, lon: 139.7414 };
const per = D.showers.find((s) => s.id === 'per');
const kcg = D.showers.find((s) => s.id === 'kcg');
const cap = D.showers.find((s) => s.id === 'cap');
const spo = D.showers.find((s) => s.id === 'spo');

const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/* ===================== 夜の数え方 ===================== */

test('nightAnchor: 未明は前の日の夜として数える', () => {
  // 8/13 の 01:00 は「8/12 の夜」
  assert.strictEqual(ymd(P.nightAnchor(new Date(2026, 7, 13, 1, 0))), '2026-8-12');
  // 正午が境界。11:59 はまだ前の夜、12:00 からは当日の夜
  assert.strictEqual(ymd(P.nightAnchor(new Date(2026, 7, 13, 11, 59))), '2026-8-12');
  assert.strictEqual(ymd(P.nightAnchor(new Date(2026, 7, 13, 12, 0))), '2026-8-13');
  assert.strictEqual(ymd(P.nightAnchor(new Date(2026, 7, 13, 23, 30))), '2026-8-13');
  // 月をまたぐ
  assert.strictEqual(ymd(P.nightAnchor(new Date(2026, 8, 1, 3, 0))), '2026-8-31');
  // 時刻は 0時0分に丸める
  const a = P.nightAnchor(new Date(2026, 7, 13, 23, 30));
  assert.strictEqual(a.getHours() + a.getMinutes() + a.getSeconds(), 0);
});

test('[回帰 v1.9.1] tonightAnchor: 朝に見ても「今夜」が今夜のまま', () => {
  const at = (h, m) => P.tonightAnchor(new Date(2026, 7, 16, h, m), TOKYO.lat, TOKYO.lon);

  /* 8/16 の日の出は 5:01 ごろ。
     夜明け前はまだ「8/15 の夜」の続きで、日が昇ったらもう「8/16 の夜」を指す。 */
  assert.strictEqual(ymd(at(2, 0)), '2026-8-15', '深夜2時はまだ前の夜');
  assert.strictEqual(ymd(at(4, 30)), '2026-8-15', '夜明け直前はまだ前の夜');

  /* ここが v1.9.1 で直した本体。nightAnchor の正午境界を「今」に当てていたため、
     朝のあいだ基準が昨夜のままになり、今夜の群が「明日の夜」と表示されていた。
     旧実装ではこの3件が 2026-8-15 を返して落ちる。 */
  assert.strictEqual(ymd(at(8, 0)), '2026-8-16', '朝8時はもう今夜（旧実装は前夜を返していた）');
  assert.strictEqual(ymd(at(11, 59)), '2026-8-16', '正午直前も今夜');
  assert.strictEqual(ymd(at(13, 0)), '2026-8-16', '午後は当然今夜');
  assert.strictEqual(ymd(at(23, 0)), '2026-8-16', '夜も今夜');
});

test('tonightAnchor: 冬の朝（まだ暗い6時）は前の夜のまま', () => {
  // 12/16 の東京の日の出は 6:47 ごろ。時刻ではなく太陽高度で切っていることの確認
  const at = (h, m) => P.tonightAnchor(new Date(2026, 11, 16, h, m), TOKYO.lat, TOKYO.lon);
  assert.strictEqual(ymd(at(6, 0)), '2026-12-15', '日の出前なので前の夜');
  assert.strictEqual(ymd(at(8, 0)), '2026-12-16', '日が昇れば今夜');
});

test('weekIndex は月曜始まり / sameYMD は日付だけを見る', () => {
  assert.strictEqual(P.weekIndex(new Date(2026, 7, 17)), 0, '2026-08-17 は月曜');
  assert.strictEqual(P.weekIndex(new Date(2026, 7, 22)), 5, '2026-08-22 は土曜');
  assert.strictEqual(P.weekIndex(new Date(2026, 7, 23)), 6, '2026-08-23 は日曜');
  assert.ok(P.sameYMD(new Date(2026, 7, 16, 0, 0), new Date(2026, 7, 16, 23, 59)));
  assert.ok(!P.sameYMD(new Date(2026, 7, 16), new Date(2027, 7, 16)));
});

test('bestTimeOfNight: 放射点の山 → 暗夜の中央 → 23時 の順に落とす', () => {
  const night = new Date(2026, 7, 12);
  const peak = new Date(2026, 7, 13, 3, 30);
  assert.strictEqual(P.bestTimeOfNight({ peak: { time: peak } }, night), peak, '山があればその時刻');

  const dusk = new Date(2026, 7, 12, 20, 0);
  const dawn = new Date(2026, 7, 13, 4, 0);
  assert.strictEqual(P.bestTimeOfNight({ duskAstro: dusk, dawnAstro: dawn }, night).getHours(), 0,
    '山が無ければ暗夜の中央（20:00〜翌4:00 なら 0:00）');

  assert.strictEqual(P.bestTimeOfNight(null, night).getHours(), 23, '何も無ければ23時');
});

/* ===================== 名前とラベル ===================== */

test('showerLabel: ギリシャ文字の直後に読みを入れる', () => {
  assert.strictEqual(P.showerLabel(cap), 'やぎ座α（アルファ）流星群');
  assert.strictEqual(P.showerLabel(kcg), 'はくちょう座κ（カッパ）流星群');
  // 「南」の前、つまり文字の直後に入る（末尾だとどこに掛かるか分からなくなる）
  assert.strictEqual(P.showerLabel(D.showers.find((s) => s.id === 'sda')),
    'みずがめ座δ（デルタ）南流星群');
  // ギリシャ文字が無い群はそのまま
  assert.strictEqual(P.showerLabel(per), 'ペルセウス座流星群');
  assert.strictEqual(P.showerLabel(spo), '散在流星（群に属さない）');
});

test('showerLabel: 群を足しても読みが付く（読みは文字に持たせているため）', () => {
  // data.js に無い群でも、文字さえギリシャ文字なら読みが付く
  assert.strictEqual(P.showerLabel('ちょうこくしつ座φ流星群'), 'ちょうこくしつ座φ（ファイ）流星群');
});

test('peakLabel / yearsAwayLabel', () => {
  assert.strictEqual(P.peakLabel(per), '8/13', '0埋めを外す');
  assert.strictEqual(P.peakLabel(D.showers.find((s) => s.id === 'qua')), '1/4');
  assert.strictEqual(P.peakLabel(spo), '—', '極大を持たない群');

  assert.strictEqual(P.yearsAwayLabel(0), '今年');
  assert.strictEqual(P.yearsAwayLabel(1), '来年');
  assert.strictEqual(P.yearsAwayLabel(8), '8年後');
});

test('nextPeakDate: 過ぎていれば翌年の極大を返す', () => {
  // ペルセウスの極大は 8-13。8/1 時点ではこの年、8/20 時点では翌年
  assert.strictEqual(ymd(P.nextPeakDate(per, new Date(2026, 7, 1))), '2026-8-13');
  assert.strictEqual(ymd(P.nextPeakDate(per, new Date(2026, 7, 20))), '2027-8-13');
  assert.strictEqual(P.nextPeakDate(per, new Date(2026, 7, 1)).getHours(), 1, '未明01:00');
  // 極大を持たない群は翌日の01:00
  assert.strictEqual(ymd(P.nextPeakDate(spo, new Date(2026, 7, 16, 22, 0))), '2026-8-17');
});

/* ===================== 極大の夜の評価 ===================== */

test('evaluatePeakNight: 極大日の未明を、その前夜として評価する', () => {
  const r = P.evaluatePeakNight(per, 2026, TOKYO.lat, TOKYO.lon);
  assert.strictEqual(ymd(r.date), '2026-8-13', '代表時刻は極大日の未明');
  assert.strictEqual(ymd(P.nightAnchor(r.date)), '2026-8-12', 'その夜は前日から始まる');
  assert.ok(r.goldenMinutes >= 0);
  assert.ok(r.illumination >= 0 && r.illumination <= 1);
  assert.ok(r.moonAge >= 0 && r.moonAge < 30);
  assert.ok(r.peakAlt > 0, 'ペルセウスは東京から見えるので放射点が上がる');
});

test('calendarVerdict: 4段階の境目', () => {
  // score = min(狙える時間/5h, 1) × min(高度/50°, 1)
  const at = (minutes, alt) => P.calendarVerdict({ goldenMinutes: minutes, peakAlt: alt });

  assert.strictEqual(at(0, 60).rank, 'bad', '狙える時間が無ければ見込みなし');
  assert.strictEqual(at(300, 5).rank, 'bad', '放射点が5°以下なら見込みなし');
  assert.strictEqual(at(300, 50).rank, 'ok', '5時間×50° は満点');
  assert.strictEqual(at(300, 50).score, 1);
  assert.strictEqual(at(300, 90).rank, 'ok', '高度は50°で頭打ち');
  assert.strictEqual(at(600, 50).score, 1, '狙える時間は5時間で頭打ち');

  assert.strictEqual(at(225, 50).rank, 'ok', 'score 0.75 は「条件よい」に入る');
  assert.strictEqual(at(224, 50).rank, 'mid', 'その少し下は「まあまあ」');
  assert.strictEqual(at(120, 50).rank, 'mid', 'score 0.40 は「まあまあ」に入る');
  assert.strictEqual(at(119, 50).rank, 'warn', 'その少し下は「条件わるい」');
});

test('calendarVerdict の score は条件のよい年どうしを比べるのには使えない', () => {
  /* 群別の見通しのバーが「狙える時間の相対値」なのはこのため。
     この性質が変わったら、あちらのバーの作りも見直すこと。 */
  const a = P.calendarVerdict({ goldenMinutes: 300, peakAlt: 72 });
  const b = P.calendarVerdict({ goldenMinutes: 460, peakAlt: 72 });
  assert.strictEqual(a.score, b.score, '5時間を超えると差が出ない（どちらも 1.0）');
});

test('peakNightsOfMonth: 極大日の印は前夜のマスに付く', () => {
  const aug = P.peakNightsOfMonth(2026, 7);        // 8月
  const ids = (day) => (aug[day] || []).map((s) => s.id);
  assert.ok(ids(12).includes('per'), 'ペルセウス（極大 8/13 未明）は 8/12 のマス');
  assert.ok(!ids(13).includes('per'), '8/13 のマスには付かない');
  assert.ok(ids(16).includes('kcg'), 'はくちょう座κ（極大 8/17 未明）は 8/16 のマス');
});

test('peakNightsOfMonth: 年をまたぐ極大も拾う', () => {
  // しぶんぎ座の極大は 1/4 未明 → 1/3 の夜
  const jan = P.peakNightsOfMonth(2027, 0);
  assert.ok((jan[3] || []).some((s) => s.id === 'qua'), 'しぶんぎ座は 1/3 のマス');
  // こぐま座の極大は 12/22 未明 → 12/21 の夜
  const dec = P.peakNightsOfMonth(2026, 11);
  assert.ok((dec[21] || []).some((s) => s.id === 'urs'), 'こぐま座は 12/21 のマス');
});

test('upcomingPeaks: 今夜以降だけを近い順に返す', () => {
  const now = new Date(2026, 7, 16, 22, 0);       // 2026-08-16 22:00
  const rows = P.upcomingPeaks(8, now, TOKYO.lat, TOKYO.lon);

  assert.strictEqual(rows.length, 8);
  assert.strictEqual(rows[0].shower.id, 'kcg', '極大 8/17 未明のはくちょう座κが先頭');

  const tonight = P.tonightAnchor(now, TOKYO.lat, TOKYO.lon).getTime();
  rows.forEach((r) => {
    assert.ok(P.nightAnchor(r.date).getTime() >= tonight,
      `${r.shower.name} の夜が今夜より前になっている`);
  });
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].date >= rows[i - 1].date, '日付の昇順であること');
  }
});

test('[回帰 v1.9.1] upcomingPeaks: 朝に開いても前の夜の群が残らない', () => {
  /* 8/17 の朝。はくちょう座κ（8/16 の夜）はもう終わっているので消えているはず。
     旧実装は基準が「8/16 の夜」のままだったので先頭に残っていた。 */
  const morning = new Date(2026, 7, 17, 8, 0);
  const rows = P.upcomingPeaks(8, morning, TOKYO.lat, TOKYO.lon);
  assert.ok(!rows.some((r) => r.shower.id === 'kcg' && r.date.getFullYear() === 2026),
    '終わった夜の群が残っている');
});

test('outlookRows: その年から20年ぶんを年の順で返す', () => {
  const rows = P.outlookRows(per, 2026, TOKYO.lat, TOKYO.lon);
  assert.strictEqual(rows.length, P.OUTLOOK_YEARS);
  assert.strictEqual(rows.length, 20);
  assert.strictEqual(rows[0].date.getFullYear(), 2026);
  assert.strictEqual(rows[19].date.getFullYear(), 2045);
  rows.forEach((r) => assert.strictEqual(r.shower.id, 'per'));
});

test('outlookRows: 20年あれば「条件よい」年が必ず含まれる（メトン周期の根拠）', () => {
  /* 20年にした理由そのもの。月の満ち欠けは約19年で同じ日付に戻るので、
     どの群でも20年のうちに月に邪魔されない年が来る。
     ここが落ちるなら OUTLOOK_YEARS の根拠が崩れている。 */
  D.showers.filter((s) => s.peak).forEach((sh) => {
    const rows = P.outlookRows(sh, 2026, TOKYO.lat, TOKYO.lon);
    const best = rows.map(P.calendarVerdict).reduce((m, v) => Math.max(m, v.score), 0);
    assert.ok(best > 0, `${sh.name}: 20年のうち1年も狙えない`);
  });
});

test('outlookRows: 年ごとの差はほぼ月の条件（放射点の高さは変わらない）', () => {
  const rows = P.outlookRows(per, 2026, TOKYO.lat, TOKYO.lon);
  const alts = rows.map((r) => r.peakAlt);
  const spread = Math.max.apply(null, alts) - Math.min.apply(null, alts);
  /* 完全に一定ではない。放射点が最も高くなる時刻は日没〜日の出の窓の中で探すので、
     窓の端が年によって少し動くぶんだけ振れる。判定に使う 50° に対しては誤差の範囲。 */
  assert.ok(spread < 2.0, `放射点の最高高度は20年でほぼ一定のはず（差 ${spread.toFixed(2)}°）`);

  const golden = rows.map((r) => r.goldenMinutes);
  assert.ok(Math.max.apply(null, golden) - Math.min.apply(null, golden) > 120,
    '狙える時間のほうは年で大きく変わる');
});

/* ===================== カメラを向ける方向 ===================== */

test('norm360', () => {
  assert.strictEqual(P.norm360(0), 0);
  assert.strictEqual(P.norm360(370), 10);
  assert.strictEqual(P.norm360(-10), 350);
  assert.strictEqual(P.norm360(-370), 350);
});

test('circleAround: 中心からちょうど指定した角距離だけ離れた点を返す', () => {
  [0, 30, 58, 85].forEach((alt) => {
    P.circleAround(120, alt, 45, 36).forEach((q) => {
      const sep = A.angularSeparation(120, alt, q.az, q.alt);
      assert.ok(Math.abs(sep - 45) < 1e-6,
        `中心高度${alt}°: 離角が ${sep.toFixed(4)}° になっている`);
    });
  });
});

test('[回帰 v1.8.0] 「放射点から45°離す」が本当に45°離れる', () => {
  /* 旧実装は「方位を45°ずらす」だけで、放射点が高いと離角が45°に届かなかった
     （高度58°では離角23°しかなかった）。放射点の高さを変えて全部確かめる。 */
  [5, 20, 40, 58, 75, 89].forEach((radAlt) => {
    const radAz = 41;
    const got = P.presetDirection('off45', 180, radAz, radAlt);
    const sep = A.angularSeparation(radAz, radAlt, got.az, got.alt);
    assert.ok(Math.abs(sep - 45) < 0.5,
      `放射点高度${radAlt}°: 離角が ${sep.toFixed(1)}°（45°になっていない）`);
  });
});

test('「放射点から45°離す」は45°の円のうち最も高い点を選ぶ', () => {
  const radAz = 41;
  const radAlt = 30;
  const got = P.presetDirection('off45', 180, radAz, radAlt);
  // 45°離れた円のどの点より高い（＝空が暗く、流星の減光も小さい向き）
  P.circleAround(radAz, radAlt, 45, 72).forEach((q) => {
    assert.ok(got.alt >= q.alt - 1e-6, `より高い点がある（${q.alt.toFixed(1)}° > ${got.alt.toFixed(1)}°）`);
  });
  assert.ok(got.alt > radAlt, '放射点より高い向きになる');
});

test('プリセット: 天頂は方位を変えない / 放射点はそのまま向く', () => {
  const zenith = P.presetDirection('zenith', 123, 41, 58);
  assert.strictEqual(zenith.alt, 90);
  assert.strictEqual(zenith.az, 123, '天頂へ向けても方位は動かさない');

  /* plan.js は vm の別コンテキストで動いているため、返るオブジェクトのプロトタイプが
     こちらと違う。deepStrictEqual は通らないので中身で比べる */
  const radiant = P.presetDirection('radiant', 123, 41, 58);
  assert.strictEqual(radiant.az, 41);
  assert.strictEqual(radiant.alt, 58);
});

test('defaultCamAz: 放射点から方位で45°、5°刻み。散在は南', () => {
  assert.strictEqual(P.defaultCamAz({ azimuth: 41, isSporadic: false }), 85, '41+45=86 → 85');
  assert.strictEqual(P.defaultCamAz({ azimuth: 330, isSporadic: false }), 15, '330+45=375 → 15');
  assert.strictEqual(P.defaultCamAz({ isSporadic: true }), 180, '散在流星は南');
  assert.strictEqual(P.defaultCamAz({ azimuth: null }), 180, '放射点が無ければ南');
});

test('projectSky: 視野の中心は原点、裏側は behind', () => {
  const center = P.projectSky(120, 40, 120, 40);
  assert.ok(Math.abs(center.x) < 1e-9 && Math.abs(center.y) < 1e-9, '中心は原点');
  assert.strictEqual(center.behind, false);

  assert.strictEqual(P.projectSky(300, -40, 120, 40).behind, true, '真後ろは映らない');

  const up = P.projectSky(120, 50, 120, 40);
  assert.ok(up.y > 0 && Math.abs(up.x) < 1e-9, '高いほうは上（y が正）');
  const right = P.projectSky(130, 40, 120, 40);
  assert.ok(right.x > 0, '方位が大きいほうは右（x が正）');
});
