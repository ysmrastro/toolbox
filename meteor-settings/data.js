/*
 * data.js — 機材・流星群・観測地のデータ定義
 *
 * 出典と精度についての注意:
 *  - pixelPitch（画素ピッチ）はメーカー公表スペック（センサー実寸 ÷ 有効画素数）から算出した「実測相当」の値。
 *  - fwcBase（基準ISOでの飽和電子数）は α7R V のみ記事の実測値。それ以外は
 *    α7R V の実測値から得た 2540 e-/µm^2 を外挿した「推定値」。
 *    火球の白飛び限界にのみ影響し、到達等級には影響しない（engine.js のコメント参照）。
 *  - dualGainISO はデュアルコンバージョンゲインの切り替え点。確度が低い機種は null にしてある。
 */

const MS_DATA = {};

/* ---------------- センサーフォーマット ---------------- */
MS_DATA.formats = {
  ff:    { label: 'フルサイズ',   width: 35.9, height: 23.9 },
  apsc:  { label: 'APS-C',        width: 23.5, height: 15.6 },
  apscC: { label: 'APS-C(Canon)', width: 22.3, height: 14.9 },
  mft:   { label: 'マイクロフォーサーズ', width: 17.4, height: 13.0 },
};

/* 飽和電子数の外挿係数（α7R V 実測 35815 e- ÷ 3.756µm^2 = 2540 e-/µm^2） */
MS_DATA.FWC_PER_UM2 = 2540;

/**
 * カメラ定義
 *  pixelPitch : µm
 *  megapixels : 有効画素数（容量見積り用）
 *  fwcBase    : ISO 100 相当での飽和電子数 [e-]
 *  fwcSource  : 'measured' | 'estimated'
 *  rnGain     : 読み出しノイズモデルの ISO 依存項 A [e-]（ISO100 換算）
 *  rnFloor    : 読み出しノイズの下限 F [e-]
 *  dualGainISO: デュアルゲイン切り替え点（不明なら null）
 */
MS_DATA.cameras = [
  { id: 'a7rv',   name: 'Sony α7R V',            format: 'ff',    pixelPitch: 3.756, megapixels: 61.0, fwcBase: 35815, fwcSource: 'measured',  rnGain: 4.74, rnFloor: 1.20, dualGainISO: 320, note: '記事の基準機材（飽和電子数・読み出しノイズは記事の実測値）' },
  { id: 'a7r4',   name: 'Sony α7R IV',           format: 'ff',    pixelPitch: 3.756, megapixels: 61.0, fwcBase: null,  fwcSource: 'estimated', rnGain: 4.76, rnFloor: 1.25, dualGainISO: 320 },
  { id: 'a7r3',   name: 'Sony α7R III',          format: 'ff',    pixelPitch: 4.506, megapixels: 42.4, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.09, rnFloor: 1.45, dualGainISO: 640 },
  { id: 'a74',    name: 'Sony α7 IV',            format: 'ff',    pixelPitch: 5.121, megapixels: 33.0, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.09, rnFloor: 1.40, dualGainISO: 640 },
  { id: 'a73',    name: 'Sony α7 III',           format: 'ff',    pixelPitch: 5.933, megapixels: 24.2, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.31, rnFloor: 1.50, dualGainISO: 640 },
  { id: 'a7s3',   name: 'Sony α7S III',          format: 'ff',    pixelPitch: 8.396, megapixels: 12.1, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.76, rnFloor: 1.30, dualGainISO: 500 },
  { id: 'a7c2',   name: 'Sony α7C II',           format: 'ff',    pixelPitch: 5.121, megapixels: 33.0, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.09, rnFloor: 1.40, dualGainISO: 640 },
  { id: 'a6700',  name: 'Sony α6700',            format: 'apsc',  pixelPitch: 3.795, megapixels: 26.0, fwcBase: null,  fwcSource: 'estimated', rnGain: 4.87, rnFloor: 1.35, dualGainISO: 500 },
  { id: 'r5',     name: 'Canon EOS R5',          format: 'ff',    pixelPitch: 4.394, megapixels: 45.0, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.20, rnFloor: 1.55, dualGainISO: null },
  { id: 'r62',    name: 'Canon EOS R6 Mark II',  format: 'ff',    pixelPitch: 5.983, megapixels: 24.2, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.42, rnFloor: 1.50, dualGainISO: null },
  { id: 'ra',     name: 'Canon EOS Ra',          format: 'ff',    pixelPitch: 5.357, megapixels: 30.3, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.87, rnFloor: 1.80, dualGainISO: null },
  { id: 'z8',     name: 'Nikon Z 8 / Z 9',       format: 'ff',    pixelPitch: 4.348, megapixels: 45.7, fwcBase: null,  fwcSource: 'estimated', rnGain: 4.98, rnFloor: 1.40, dualGainISO: 400 },
  { id: 'z63',    name: 'Nikon Z 6III',          format: 'ff',    pixelPitch: 5.936, megapixels: 24.5, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.31, rnFloor: 1.50, dualGainISO: null },
  { id: 'zf',     name: 'Nikon Z f / Z 6II',     format: 'ff',    pixelPitch: 5.936, megapixels: 24.5, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.31, rnFloor: 1.45, dualGainISO: 400 },
  { id: 's5m2',   name: 'Panasonic LUMIX S5II',  format: 'ff',    pixelPitch: 5.933, megapixels: 24.2, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.31, rnFloor: 1.50, dualGainISO: 640 },
  { id: 'xt5',    name: 'FUJIFILM X-T5 / X-H2',  format: 'apsc',  pixelPitch: 3.041, megapixels: 40.2, fwcBase: null,  fwcSource: 'estimated', rnGain: 4.87, rnFloor: 1.40, dualGainISO: null },
  { id: 'xt4',    name: 'FUJIFILM X-T4 / X-S20', format: 'apsc',  pixelPitch: 3.756, megapixels: 26.1, fwcBase: null,  fwcSource: 'estimated', rnGain: 4.87, rnFloor: 1.40, dualGainISO: null },
  { id: 'om1',    name: 'OM SYSTEM OM-1',        format: 'mft',   pixelPitch: 3.356, megapixels: 20.4, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.09, rnFloor: 1.45, dualGainISO: null },
  { id: 'custom', name: '手入力（その他の機種）',  format: 'ff',    pixelPitch: 4.500, megapixels: 30.0, fwcBase: null,  fwcSource: 'estimated', rnGain: 5.09, rnFloor: 1.45, dualGainISO: null },
];

/* fwcBase が null の機種は画素ピッチから外挿する */
MS_DATA.cameras.forEach((c) => {
  if (c.fwcBase == null) {
    c.fwcBase = Math.round(MS_DATA.FWC_PER_UM2 * c.pixelPitch * c.pixelPitch);
  }
});

/* ---------------- レンズプリセット ----------------
 * 焦点距離とF値は選択後も手で上書きできる。
 * ズームは星景で使う広角端の値を登録している。
 */
MS_DATA.lenses = [
  /* ソニーE / SIGMA */
  { mount: 'ソニー E / SIGMA', name: 'SIGMA 20mm F1.4 DG DN Art', focal: 20, fnum: 1.4, note: '記事の基準レンズ' },
  { mount: 'ソニー E / SIGMA', name: 'SIGMA 14mm F1.4 DG DN Art', focal: 14, fnum: 1.4 },
  { mount: 'ソニー E / SIGMA', name: 'SIGMA 24mm F1.4 DG DN Art', focal: 24, fnum: 1.4 },
  { mount: 'ソニー E / SIGMA', name: 'SIGMA 35mm F1.2 DG DN Art', focal: 35, fnum: 1.2 },
  { mount: 'ソニー E / SIGMA', name: 'Sony FE 14mm F1.8 GM',      focal: 14, fnum: 1.8 },
  { mount: 'ソニー E / SIGMA', name: 'Sony FE 20mm F1.8 G',       focal: 20, fnum: 1.8 },
  { mount: 'ソニー E / SIGMA', name: 'Sony FE 24mm F1.4 GM',      focal: 24, fnum: 1.4 },
  { mount: 'ソニー E / SIGMA', name: 'Sony FE 35mm F1.4 GM',      focal: 35, fnum: 1.4 },
  { mount: 'ソニー E / SIGMA', name: 'Sony FE 50mm F1.4 GM',      focal: 50, fnum: 1.4 },
  { mount: 'ソニー E / SIGMA', name: 'Samyang 14mm F2.8',         focal: 14, fnum: 2.8 },

  /* ニコン Z（フルサイズ・現行） */
  { mount: 'ニコン Z', name: 'NIKKOR Z 20mm f/1.8 S',        focal: 20, fnum: 1.8 },
  { mount: 'ニコン Z', name: 'NIKKOR Z 24mm f/1.8 S',        focal: 24, fnum: 1.8 },
  { mount: 'ニコン Z', name: 'NIKKOR Z 26mm f/2.8',          focal: 26, fnum: 2.8 },
  { mount: 'ニコン Z', name: 'NIKKOR Z 28mm f/2.8',          focal: 28, fnum: 2.8 },
  { mount: 'ニコン Z', name: 'NIKKOR Z 35mm f/1.2 S',        focal: 35, fnum: 1.2 },
  { mount: 'ニコン Z', name: 'NIKKOR Z 35mm f/1.4',          focal: 35, fnum: 1.4 },
  { mount: 'ニコン Z', name: 'NIKKOR Z 35mm f/1.8 S',        focal: 35, fnum: 1.8 },
  { mount: 'ニコン Z', name: 'NIKKOR Z 14-24mm f/2.8 S @14mm', focal: 14, fnum: 2.8 },
  { mount: 'ニコン Z', name: 'NIKKOR Z 14-30mm f/4 S @14mm',   focal: 14, fnum: 4.0 },
  { mount: 'ニコン Z', name: 'NIKKOR Z 17-28mm f/2.8 @17mm',   focal: 17, fnum: 2.8 },
  { mount: 'ニコン Z', name: 'NIKKOR Z 24-70mm f/2.8 S @24mm', focal: 24, fnum: 2.8 },

  /* キヤノン RF（フルサイズ・現行） */
  { mount: 'キヤノン RF', name: 'RF 14mm F1.4 L VCM',            focal: 14, fnum: 1.4 },
  { mount: 'キヤノン RF', name: 'RF 16mm F2.8 STM',              focal: 16, fnum: 2.8 },
  { mount: 'キヤノン RF', name: 'RF 20mm F1.4 L VCM',            focal: 20, fnum: 1.4 },
  { mount: 'キヤノン RF', name: 'RF 24mm F1.4 L VCM',            focal: 24, fnum: 1.4 },
  { mount: 'キヤノン RF', name: 'RF 24mm F1.8 MACRO IS STM',     focal: 24, fnum: 1.8 },
  { mount: 'キヤノン RF', name: 'RF 28mm F2.8 STM',              focal: 28, fnum: 2.8 },
  { mount: 'キヤノン RF', name: 'RF 35mm F1.4 L VCM',            focal: 35, fnum: 1.4 },
  { mount: 'キヤノン RF', name: 'RF 35mm F1.8 MACRO IS STM',     focal: 35, fnum: 1.8 },
  { mount: 'キヤノン RF', name: 'RF 10-20mm F4 L IS STM @10mm',  focal: 10, fnum: 4.0 },
  { mount: 'キヤノン RF', name: 'RF 14-35mm F4 L IS USM @14mm',  focal: 14, fnum: 4.0 },
  { mount: 'キヤノン RF', name: 'RF 15-35mm F2.8 L IS USM @15mm', focal: 15, fnum: 2.8 },
  { mount: 'キヤノン RF', name: 'RF 16-28mm F2.8 IS STM @16mm',  focal: 16, fnum: 2.8 },

  /* タムロン（ソニーE / ニコンZ・現行） */
  { mount: 'タムロン', name: 'TAMRON 20mm F/2.8 Di III OSD M1:2',    focal: 20, fnum: 2.8 },
  { mount: 'タムロン', name: 'TAMRON 24mm F/2.8 Di III OSD M1:2',    focal: 24, fnum: 2.8 },
  { mount: 'タムロン', name: 'TAMRON 35mm F/2.8 Di III OSD M1:2',    focal: 35, fnum: 2.8 },
  { mount: 'タムロン', name: 'TAMRON 12-20mm F/2.8 Di III VXD @12mm', focal: 12, fnum: 2.8 },
  { mount: 'タムロン', name: 'TAMRON 16-30mm F/2.8 Di III VXD G2 @16mm', focal: 16, fnum: 2.8 },
  { mount: 'タムロン', name: 'TAMRON 20-40mm F/2.8 Di III VXD @20mm', focal: 20, fnum: 2.8 },
  { mount: 'タムロン', name: 'TAMRON 17-50mm F/4 Di III VXD @17mm',  focal: 17, fnum: 4.0 },
  { mount: 'タムロン', name: 'TAMRON 11-20mm F/2.8 Di III-A RXD @11mm（APS-C）', focal: 11, fnum: 2.8 },

  /* 汎用 */
  { mount: 'その他', name: '標準ズーム 24mm F2.8', focal: 24, fnum: 2.8 },
  { mount: 'その他', name: '標準ズーム 24mm F4',   focal: 24, fnum: 4.0 },
];

/* ---------------- 星像（トレイル幅）の品質係数 ---------------- */
/* 1.00 = 記事の実測「中央 1.73px」相当。1.63 = 記事の実測「周辺 2.82px」相当 */
MS_DATA.trailQuality = [
  { id: 'sharp',  label: 'ピント追い込み済み・画面中央', factor: 1.00, note: '記事の基準（中央 1.73px 相当）' },
  { id: 'normal', label: '実用的なピント・画面全体の平均', factor: 1.28, note: '中央と周辺の中間' },
  { id: 'soft',   label: 'ピントが甘い / 周辺像',        factor: 1.63, note: '記事の実測（周辺 2.82px 相当）' },
];

/* ---------------- 主要流星群 ---------------- */
/*
 * ra/dec  : 極大時の放射点座標（J2000, 度）
 * raDrift : 放射点の日々の移動量（度/日）— 極大日からのずれを補正するのに使う
 * velocity: 対地速度 [km/s]
 * zhr     : 天頂出現数
 * r       : 光度分布指数（population index）
 * meanMag : 平均光度。記事のペルセウス座 +1.63 を基準に、IMO の平均光度差をそのまま
 *           オフセット（-0.97等）した値。記事との整合を保つための調整であることに注意。
 * fireball: 火球の出やすさ（'high' / 'mid' / 'low'）
 */
MS_DATA.showers = [
  { id: 'per', name: 'ペルセウス座流星群',       peak: '08-13', ra: 48,  dec: 58,  raDrift: 1.35, decDrift: 0.15, velocity: 59, zhr: 100, r: 2.2, meanMag: 1.63, fireball: 'mid',  note: '記事が基準にしている群。主要群で最速クラスで、角速度が大きく撮影は不利。' },
  { id: 'gem', name: 'ふたご座流星群',           peak: '12-14', ra: 112, dec: 33,  raDrift: 1.02, decDrift: -0.15, velocity: 35, zhr: 150, r: 2.6, meanMag: 1.23, fireball: 'mid',  note: '対地速度が遅く角速度が小さいため、ペルセウス座より約0.5等有利。' },
  { id: 'qua', name: 'しぶんぎ座流星群',         peak: '01-04', ra: 230, dec: 49,  raDrift: 0.40, decDrift: -0.20, velocity: 41, zhr: 110, r: 2.1, meanMag: 1.43, fireball: 'low',  note: '極大が数時間しか続かない。放射点は夜半以降に高くなる。' },
  { id: 'ori', name: 'オリオン座流星群',         peak: '10-21', ra: 95,  dec: 16,  raDrift: 1.10, decDrift: 0.10, velocity: 66, zhr: 20,  r: 2.5, meanMag: 1.93, fireball: 'mid',  note: '主要群で最速。角速度が非常に大きく、撮影条件は最も厳しい。' },
  { id: 'leo', name: 'しし座流星群',             peak: '11-17', ra: 152, dec: 22,  raDrift: 0.95, decDrift: -0.40, velocity: 71, zhr: 15,  r: 2.5, meanMag: 1.83, fireball: 'mid',  note: '最速級。速い代わりに明るい流星の割合は比較的高い。' },
  { id: 'lyr', name: 'こと座流星群',             peak: '04-22', ra: 271, dec: 34,  raDrift: 1.10, decDrift: 0.00, velocity: 49, zhr: 18,  r: 2.1, meanMag: 1.73, fireball: 'mid' },
  { id: 'eta', name: 'みずがめ座η流星群',        peak: '05-06', ra: 338, dec: -1,  raDrift: 0.90, decDrift: 0.40, velocity: 66, zhr: 50,  r: 2.4, meanMag: 1.83, fireball: 'mid',  note: '日本からは放射点が低く、明け方の短時間しか狙えない。' },
  { id: 'sda', name: 'みずがめ座δ南流星群',      peak: '07-30', ra: 340, dec: -16, raDrift: 0.78, decDrift: 0.18, velocity: 41, zhr: 25,  r: 3.2, meanMag: 2.33, fireball: 'low',  note: '暗い流星が多く（r が大きい）、到達等級の要求が厳しい。' },
  { id: 'cap', name: 'やぎ座α流星群',            peak: '07-30', ra: 307, dec: -10, raDrift: 0.90, decDrift: 0.30, velocity: 22, zhr: 5,   r: 2.5, meanMag: 1.03, fireball: 'high', note: '対地速度が最も遅く、明るい火球が多い。出現数は少ないが火球狙いの本命。' },
  { id: 'sta', name: 'おうし座南流星群',         peak: '11-05', ra: 52,  dec: 15,  raDrift: 0.79, decDrift: 0.19, velocity: 27, zhr: 5,   r: 2.3, meanMag: 1.33, fireball: 'high', note: '低速で火球が多い。数は少ないが1本の価値が大きい。' },
  { id: 'nta', name: 'おうし座北流星群',         peak: '11-12', ra: 58,  dec: 22,  raDrift: 0.79, decDrift: 0.19, velocity: 29, zhr: 5,   r: 2.3, meanMag: 1.33, fireball: 'high', note: 'おうし座南流星群と同様に低速・火球型。' },
  { id: 'kcg', name: 'はくちょう座κ流星群',      peak: '08-17', ra: 286, dec: 52,  raDrift: 0.60, decDrift: 0.20, velocity: 25, zhr: 3,   r: 3.0, meanMag: 1.23, fireball: 'high', note: '低速で火球が出やすい。ペルセウス座の直後に放射点が高い。' },
  { id: 'dra', name: 'りゅう座流星群',           peak: '10-08', ra: 262, dec: 54,  raDrift: 0.60, decDrift: -0.10, velocity: 20, zhr: 5,   r: 2.6, meanMag: 2.03, fireball: 'mid',  note: '最低速の群。突発出現があり、宵の時間帯に放射点が高い。' },
  { id: 'urs', name: 'こぐま座流星群',           peak: '12-22', ra: 217, dec: 76,  raDrift: 0.30, decDrift: -0.10, velocity: 33, zhr: 10,  r: 3.0, meanMag: 2.03, fireball: 'low' },
  { id: 'spo', name: '散在流星（群に属さない）', peak: null,    ra: null, dec: null, raDrift: 0,   decDrift: 0,    velocity: 40, zhr: 8,   r: 3.0, meanMag: 2.03, fireball: 'mid',  note: '放射点を持たないため、離角の平均的な値（60°）で計算する。' },
];

/* ---------------- 空の明るさプリセット ---------------- */
MS_DATA.skyPresets = [
  { label: '石垣島クラス（国内最良）', sqm: 21.7, bortle: 'Bortle 2' },
  { label: '星空保護区の基準',        sqm: 21.2, bortle: 'Bortle 3' },
  { label: '記事の基準（好条件の山）', sqm: 21.0, bortle: 'Bortle 3〜4' },
  { label: '全国平均',                sqm: 20.7, bortle: 'Bortle 4' },
  { label: '郊外',                    sqm: 20.0, bortle: 'Bortle 4〜5' },
  { label: '都市近郊',                sqm: 19.0, bortle: 'Bortle 6' },
];

/* ---------------- 月明かりによる空の劣化（粗い目安） ---------------- */
MS_DATA.moonPresets = [
  { id: 'none', label: '月なし（新月または月没後）', delta: 0.0 },
  { id: 'thin', label: '細い月・低空',              delta: -0.5 },
  { id: 'half', label: '半月クラス',                delta: -1.2 },
  { id: 'full', label: '満月に近い月が高い',        delta: -2.5 },
];

/* ---------------- 観測地プリセット ----------------
 * 座標は OpenStreetMap（Nominatim / Overpass API）で名称が一致した地物から取得した値。
 * 出典が確認できなかった地点は載せていない。
 */
MS_DATA.locations = [
  /* 主要都市 */
  { region: '主要都市', name: '東京',   lat: 35.69, lon: 139.69 },
  { region: '主要都市', name: '札幌',   lat: 43.06, lon: 141.35 },
  { region: '主要都市', name: '仙台',   lat: 38.27, lon: 140.87 },
  { region: '主要都市', name: '名古屋', lat: 35.18, lon: 136.91 },
  { region: '主要都市', name: '大阪',   lat: 34.69, lon: 135.50 },
  { region: '主要都市', name: '広島',   lat: 34.39, lon: 132.46 },
  { region: '主要都市', name: '福岡',   lat: 33.59, lon: 130.40 },

  /* 本州 — 長野・山梨 */
  { region: '本州（長野・山梨）', name: '野辺山',                       lat: 35.94,   lon: 138.48 },
  { region: '本州（長野・山梨）', name: '美ヶ原',                       lat: 36.23,   lon: 138.11 },
  { region: '本州（長野・山梨）', name: '小川天文台（小川村）',           lat: 36.6596, lon: 137.9870 },
  { region: '本州（長野・山梨）', name: 'レストハウスふるさと（小海町）', lat: 36.0642, lon: 138.3927 },
  { region: '本州（長野・山梨）', name: '霧ヶ峰 富士見台（諏訪市）',      lat: 36.0927, lon: 138.1851 },
  { region: '本州（長野・山梨）', name: 'まるやち湖（原村）',             lat: 35.9735, lon: 138.2638 },
  { region: '本州（長野・山梨）', name: 'みずがき湖（北杜市）',           lat: 35.8611, lon: 138.4992 },

  /* 本州 — 静岡以西 */
  { region: '本州（静岡・以西）', name: '西臼塚（富士）',                       lat: 35.30,   lon: 138.75 },
  { region: '本州（静岡・以西）', name: '天城高原ゴルフコース駐車場（伊豆市）', lat: 34.8717, lon: 139.0239 },
  { region: '本州（静岡・以西）', name: '全国育樹祭記念広場（豊田市）',         lat: 35.1582, lon: 137.1959 },
  { region: '本州（静岡・以西）', name: 'すさみ町（和歌山）',                   lat: 33.5508, lon: 135.4947 },
  { region: '本州（静岡・以西）', name: '八塔寺ふるさと村（備前市）',           lat: 34.9174, lon: 134.2540 },

  /* 九州 — 福岡 */
  { region: '九州（福岡・佐賀）', name: '星の文化館（八女市星野村）', lat: 33.2439, lon: 130.7600 },
  { region: '九州（福岡・佐賀）', name: '小石原川ダム（朝倉市）',     lat: 33.4676, lon: 130.7638 },
  { region: '九州（福岡・佐賀）', name: '平尾台（北九州市）',         lat: 33.7586, lon: 130.8900 },
  { region: '九州（福岡・佐賀）', name: '英彦山（添田町）',           lat: 33.4763, lon: 130.9260 },
  { region: '九州（福岡・佐賀）', name: '九千部山（鳥栖市）',         lat: 33.4167, lon: 130.4461 },
  /* 九州 — 佐賀 */
  { region: '九州（福岡・佐賀）', name: '脊振山（神埼市）',           lat: 33.4364, lon: 130.3687 },
  { region: '九州（福岡・佐賀）', name: '天山（小城市）',             lat: 33.3389, lon: 130.1429 },
  { region: '九州（福岡・佐賀）', name: '多良岳（太良町）',           lat: 32.9756, lon: 130.0928 },
  { region: '九州（福岡・佐賀）', name: '佐賀県立宇宙科学館（武雄市）', lat: 33.1791, lon: 130.0354 },

  /* 九州 — 長崎 */
  { region: '九州（長崎）', name: '雲仙 仁田峠',         lat: 32.7411, lon: 130.2923 },
  { region: '九州（長崎）', name: '生月島（平戸市）',     lat: 33.4071, lon: 129.4247 },
  { region: '九州（長崎）', name: '五島（福江）',         lat: 32.6951, lon: 128.8408 },
  { region: '九州（長崎）', name: '対馬',                 lat: 34.2054, lon: 129.2947 },

  /* 九州 — 熊本 */
  { region: '九州（熊本・大分）', name: '大観峰（阿蘇市）',       lat: 32.9964, lon: 131.0672 },
  { region: '九州（熊本・大分）', name: '草千里ヶ浜（阿蘇）',     lat: 32.8807, lon: 131.0538 },
  { region: '九州（熊本・大分）', name: '押戸石の丘（南小国町）', lat: 33.0288, lon: 131.0618 },
  { region: '九州（熊本・大分）', name: '瀬の本高原（南小国町）', lat: 33.0705, lon: 131.1739 },
  { region: '九州（熊本・大分）', name: '市房山（水上村）',       lat: 32.3117, lon: 131.1011 },
  { region: '九州（熊本・大分）', name: '牛深（天草市）',         lat: 32.2088, lon: 130.0105 },
  /* 九州 — 大分 */
  { region: '九州（熊本・大分）', name: '牧ノ戸峠（九重町）',     lat: 33.0965, lon: 131.2084 },
  { region: '九州（熊本・大分）', name: '大船山（竹田市）',       lat: 33.0950, lon: 131.2806 },

  /* 九州 — 宮崎 */
  { region: '九州（宮崎）', name: '国見ヶ丘（高千穂町）',   lat: 32.7191, lon: 131.2811 },
  { region: '九州（宮崎）', name: '向坂山（五ヶ瀬町）',     lat: 32.5797, lon: 131.1049 },
  { region: '九州（宮崎）', name: '大崩山（延岡市）',       lat: 32.7378, lon: 131.5131 },
  { region: '九州（宮崎）', name: 'えびの高原（えびの市）', lat: 31.9492, lon: 130.8435 },
  { region: '九州（宮崎）', name: '都井岬（串間市）',       lat: 31.3786, lon: 131.3300 },

  /* 九州 — 鹿児島 */
  { region: '九州（鹿児島）', name: '輝北天球館（鹿屋市）',     lat: 31.5931, lon: 130.8242 },
  { region: '九州（鹿児島）', name: '高千穂河原（霧島市）',     lat: 31.8857, lon: 130.8959 },
  { region: '九州（鹿児島）', name: '藺牟田池（薩摩川内市）',   lat: 31.8182, lon: 130.4677 },
  { region: '九州（鹿児島）', name: '甫与志岳（肝付町）',       lat: 31.2643, lon: 130.9901 },
  { region: '九州（鹿児島）', name: '開聞岳（指宿市）',         lat: 31.1800, lon: 130.5284 },
  { region: '九州（鹿児島）', name: '佐多岬（南大隅町）',       lat: 30.9953, lon: 130.6609 },
  { region: '九州（鹿児島）', name: '屋久島',                   lat: 30.3875, lon: 130.6568 },
  { region: '九州（鹿児島）', name: '種子島（宇宙センター）',   lat: 30.3943, lon: 130.9578 },

  /* 沖縄 */
  { region: '沖縄', name: '那覇',           lat: 26.21, lon: 127.68 },
  { region: '沖縄', name: '石垣島（市街）', lat: 24.34, lon: 124.16 },
  { region: '沖縄', name: '石垣島 平久保',  lat: 24.60, lon: 124.30 },
];

/* 既定の観測地（名前で引くのでプリセットの並び替えに影響されない） */
MS_DATA.defaultLocationName = '小石原川ダム（朝倉市）';

/* ---------------- 実用的なシャッター速度の刻み ---------------- */
MS_DATA.shutterSteps = [0.5, 0.6, 0.8, 1, 1.3, 1.6, 2, 2.5, 3, 4, 5, 6, 8, 10, 13, 15, 20, 25, 30];

/* ---------------- 標準ISO（1/3段刻み） ---------------- */
MS_DATA.isoSteps = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400];

/* ---------------- 撮影目的 ---------------- */
MS_DATA.purposes = [
  {
    id: 'fireball',
    label: '火球狙い',
    icon: '☄️',
    desc: '明るい流星を白飛びさせずに、途切れずに写し止める',
    isoTolerance: 0.02,   // 到達等級の許容損失[等] — 小さいほど低ISOを選ぶ（0.02で記事のISO640を再現）
    weightCount: 0.0,
  },
  {
    id: 'balance',
    label: 'バランス',
    icon: '⚖️',
    desc: '本数と火球の記録品質を両立させる',
    isoTolerance: 0.015,
    weightCount: 0.5,
  },
  {
    id: 'count',
    label: '本数狙い',
    icon: '✨',
    desc: '暗い流星まで拾って写る本数を最大化する',
    isoTolerance: 0.01,
    weightCount: 1.0,
  },
];
