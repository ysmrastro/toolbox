"use strict";

/* ============================================================
   ベクトル
   ============================================================ */
const V = {
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
  sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s],
  dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  len:a=>Math.hypot(a[0],a[1],a[2]),
  norm:a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];},
  cross:(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
};

/* ============================================================
   実機の寸法（mm）
   z＝筒の中心軸。主鏡の頂点が z=0、筒先が +z。
   x＝接眼部の中心軸。接眼部側が +x。
   ============================================================ */
const P = {
  R_PM   : 65,      // 主鏡の半径
  F_PM   : 650,     // 主鏡の焦点距離
  SEC_A  : 45*Math.SQRT2/2,  // 斜鏡の長半径 31.82
  SEC_B  : 45/2,             // 斜鏡の短半径 22.5
  L      : 460,     // 交点の z（＝650 − 交点から焦点面まで 190。第1回の仮定）
  OFFSET : 2.714,   // オフセット（面に沿って、主鏡側へ。第1回の値）
  R_FIELD: 25.4,    // ドローチューブの縁の内半径（仮の値・未実測）
  D_FIELD: 46,      // ドローチューブの先の、交点からの距離（繰り出し 0 のとき）
  R_TUBE : 75,      // 筒の内半径
  R_SSCR : 15,      // 斜鏡の押しネジの配置半径
  HOLD_L : 28,      // 斜鏡の土台の本体の長さ（絵のためだけの仮の値・未実測）
  HOLD_V : 400,     // 視野に出すときの柱の長さ。実機では視野の外まで続いて見えるので、
                    // 縁を確実に超えるところまで伸ばす（長さそのものは絵に出ない）
  STEM_R : 4.5,     // 柱（中央の引きネジ）の半径（絵のためだけの仮の値・未実測）
  HOLD_R : 11,      // 斜鏡を支えている柱の半径（仮の値・未実測）。筒先から見ると
                    // 斜鏡の見かけの半分ほどの太さに見える
  R_PSCR : 55,      // 主鏡の押しネジの配置半径
  MARK_IN: 2.13,    // センターマークの穴の半径
  MARK_OUT:3.90,    // センターマークの外半径
  EPB_R  : 9.52,    // アイピースの裏側（銀の面）の半径（仮の値・未実測）
  EPB_H  : 4.03,    // 覗き穴の半径（仮の値・未実測）
  // 押さえの爪（度）。BKP130 は上に1つ、あとは左右の下に1つずつ ──
  // 視野に出る角度は 180°からこの値を引いたもの（反射で裏返る）なので、
  // 90/210/330 で 上・左下・右下 になる
  CLIPS  : [90,210,330]
};

// 斜鏡の基準の姿勢
const N_SEC0  = V.norm([1,0,-1]);   // 面の法線（接眼部側かつ主鏡側を向く）
const FACE_U0 = V.norm([1,0,1]);    // 面内・筒先かつ接眼部側が +
const FACE_V0 = [0,1,0];            // 面内・上が +
// スパイダーの台（ハブ）は筒の中心軸の上にある。オフセットはここでは足さない ──
// 鏡を土台のどこに貼るかで作るものなので、geometry() の最後で足す。
const HUB0  = [0,0,P.L];
// 目を置く位置の基準は「焦点面」。つまみの中央がここ。
// 実際にはセンタリングアイピースの長さぶん外側から覗くことになるが、
// その長さは人によって違うのでモデルには入れない。
const FOCAL = P.F_PM - P.L;                       // 交点から焦点面まで＝190mm
const eyePoint  = d => [FOCAL + d, 0, P.L];       // 目の位置
const drawFront = d => P.D_FIELD + d;             // ドローチューブの先（一緒に動く）

// 単位ベクトル a を b に重ねる最小の回転（ロドリゲス）
function rotBetween(a,b){
  const v=V.cross(a,b), c=V.dot(a,b);
  // ここを緩めると小さい回転が丸ごと消える。押しネジ 0.01mm は 4.4e-4 rad で、
  // 以前の 0.9999999 では 1目盛りぶんがそっくり効かなくなっていた
  if(c>1-1e-12) return q=>q.slice();
  const k=1/(1+c);
  return q=>{const w=V.cross(v,q); return V.add(V.add(q,w), V.mul(V.cross(v,w),k));};
}

// 画面の基準（覗き穴から見て）
const F_HAT = [-1,0,0];   // 視線の向き
const U_HAT = [0,1,0];    // 画面の上
const R_HAT = [0,0,-1];   // 画面の右（＝主鏡側）

/* ============================================================
   状態
   ============================================================ */
const DEF = {draw:0,spiderX:0,spiderY:0,secA:0,secB:0,secC:0,secPull:0,secRot:0,pmA:0,pmB:0,pmC:0};
const ALIGN_KEYS = Object.keys(DEF).filter(k=>k!=='draw');   // 繰り出しは光軸の調整ではない
const opt = id => document.getElementById(id).checked;
// つまみの値は「始めた位置から、どれだけ回したか」。
// ずれた状態から始めても、つまみはまんなかに置く ── 実際の光軸合わせと同じで、
// いまどれだけずれているかは覗いて確かめるしかない。
const state = Object.assign({},DEF);   // 回した量
const base  = Object.assign({},DEF);   // 始めの状態（隠してある）
const live  = ()=>{const o={}; for(const k in DEF) o[k]=base[k]+state[k]; return o;};

// 折りたためる塊（fold）ごとに、小見出し（group）を並べる。
// 順番は、ふだんさわる順。ドローチューブは基本さわらないので一番下で、畳んである。
const SLIDERS = [
 // 斜鏡まわりは、実際に合わせる順に並べる ── スパイダー → 回転 → 押し引き
 {fold:"斜鏡まわり", open:true, groups:[
  {group:"スパイダー（斜鏡そのものの位置）",
   note:"4本は均一に張り、台は筒の中心軸の上に置きます。振ると台が軸から外れます。",
   items:[
     {k:"spiderX",label:"押し引き X",min:-4,max:4,step:.05,unit:"mm",lo:"接眼部から遠ざける",hi:"接眼部へ寄せる"},
     {k:"spiderY",label:"押し引き Y",min:-4,max:4,step:.05,unit:"mm",lo:"下へ",hi:"上へ"}
   ]},
  {group:"斜鏡の回転",
   note:"中央の引きネジをゆるめて、土台の柱ごと回す。面が円錐を描くので視野ごと動きます。",
   items:[
     {k:"secRot",label:"回転",min:-6,max:6,step:.05,unit:"°"}
   ]},
  {group:"斜鏡の押しネジ（3本）",
   note:"ステム軸に沿って効きます。3本を同じだけ回しても傾かず、前後に動くだけです。",
   items:[
     {k:"secA",label:"押しネジ A",min:-1,max:1,step:.01,unit:"mm"},
     {k:"secB",label:"押しネジ B",min:-1,max:1,step:.01,unit:"mm"},
     {k:"secC",label:"押しネジ C",min:-1,max:1,step:.01,unit:"mm"}
   ]},
  {group:"斜鏡の引きネジ（中央 1本）",
   note:"土台をステム軸に沿って前後させます。オフセットの効き方が変わります。",
   items:[
     {k:"secPull",label:"引きネジ",min:-2.5,max:2.5,step:.02,unit:"mm",lo:"ゆるめる",hi:"締める"}
   ]},

 ]},
 {fold:"主鏡の押しネジ（3本）", open:true, groups:[
  {note:"主鏡は傾くだけで、中心は動きません。だから 1回反射の層は動きません。",
   items:[
     {k:"pmA",label:"押しネジ A",min:-1.5,max:1.5,step:.01,unit:"mm"},
     {k:"pmB",label:"押しネジ B",min:-1.5,max:1.5,step:.01,unit:"mm"},
     {k:"pmC",label:"押しネジ C",min:-1.5,max:1.5,step:.01,unit:"mm"}
   ]}
 ]},
 {fold:"ドローチューブ（覗き方）", open:false, groups:[
  {note:"つまみの中央が焦点面です。そこを基準に、目の位置とドローチューブの先が一緒に前後します。",
   items:[
     {k:"draw",label:"焦点面から",min:-45,max:45,step:1,unit:"mm",lo:"押し込む",hi:"繰り出す"}
   ]}
 ]}
];

const ITEM = {};
for(const sec of SLIDERS) for(const gp of sec.groups) for(const it of gp.items) ITEM[it.k]=it;
// つまみの刻みに乗せ、範囲に収める
const fitKnob = (k,v) => {
  const it=ITEM[k];
  return +Math.max(it.min, Math.min(it.max, Math.round(v/it.step)*it.step)).toFixed(4);
};

/* ============================================================
   いまの姿勢を組み立てる
   ============================================================ */
function threeScrewFit(d0,d1,d2,r){
  // 120°おきに置いた3本のネジの出し入れから、傾き（a,b）と前後（piston）を出す
  const ph=[Math.PI/2, Math.PI*7/6, Math.PI*11/6], d=[d0,d1,d2];
  let a=0,b=0,p=0;
  for(let i=0;i<3;i++){a+=d[i]*Math.cos(ph[i]); b+=d[i]*Math.sin(ph[i]); p+=d[i];}
  return {a:a*2/(3*r), b:b*2/(3*r), piston:p/3};
}

function geometry(s){
  // ---- スパイダー ----
  // 4本は均一に張ってあり、台は筒の中心軸の上にある。押し引きはそこからの「ずれ」。
  const hub = V.add(HUB0,[s.spiderX,s.spiderY,0]);

  // ---- 斜鏡の土台 ----
  // 回転は「中央の引きネジをゆるめて、土台の柱をステム軸のまわりに回す」動き。
  // 45°に切った面ごと回るので、鏡の法線が円錐を描いて振れる ── 視野ごと動く。
  // 台に載っているものは全部まとめて回るので、まずここで回してから傾きを乗せる。
  const rot = s.secRot*Math.PI/180, cr=Math.cos(rot), sr=Math.sin(rot);
  const rz = q=>[q[0]*cr - q[1]*sr, q[0]*sr + q[1]*cr, q[2]];

  // 中央の引きネジと3本の押しネジは、ステム軸（＝筒の中心軸）に沿って効く。
  const f = threeScrewFit(s.secA,s.secB,s.secC,P.R_SSCR);
  const stem = V.norm([-f.a,-f.b,1]);
  const R = rotBetween([0,0,1],stem);
  const nSec = R(rz(N_SEC0));
  const fu = R(rz(FACE_U0)), fv = R(rz(FACE_V0));
  const Q = V.add(hub, V.mul(stem, f.piston + s.secPull));   // 土台の45°面の中心

  // ---- 鏡の貼り付け位置 ----
  // オフセットはここ。土台の軸から、面に沿って主鏡側へ OFFSET だけずらして貼ってある。
  // 柱ごと回るので、オフセットの向きも楕円の向きも一緒に回る。
  const major = fu, minor = fv;
  // オフセットは切れる。切ると鏡の中心が土台の軸の上に来る
  const cSec = V.sub(Q, V.mul(major, opt('opt-offset') ? P.OFFSET : 0));

  // ---- 主鏡 ----
  const g = threeScrewFit(s.pmA,s.pmB,s.pmC,P.R_PSCR);
  const nPm = V.norm([-g.a,-g.b,1]);   // 頂点は動かさない（傾くだけ）
  const vPm = [0,0,0];
  const pu = V.norm(V.sub([1,0,0], V.mul(nPm, nPm[0])));
  const pv = V.cross(nPm, pu);

  // 目を斜鏡の面で折り返す
  const eye = eyePoint(s.draw), dfront = drawFront(s.draw);
  const e1 = reflectPoint(eye, cSec, nSec);
  return {hub,Q,stem,cSec,nSec,fu,fv,major,minor,nPm,vPm,pu,pv,e1,rot,eye,dfront,
          secTilt:Math.hypot(f.a,f.b), pmTilt:Math.hypot(g.a,g.b)};
}

function reflectPoint(p,c,n){ return V.sub(p, V.mul(n, 2*V.dot(V.sub(p,c),n))); }
function reflectDir(d,n){ return V.sub(d, V.mul(n, 2*V.dot(d,n))); }

// 主鏡が結ぶ像（近軸）
function pmImage(q,g){
  const rel = V.sub(q,g.vPm);
  const u = V.dot(rel,g.nPm);
  if(u<=1) return null;                       // 鏡の裏側にある
  const h = V.sub(rel, V.mul(g.nPm,u));
  let inv = 1/P.F_PM - 1/u;
  const LIM = 1/2.0e5;                        // 焦点のすぐ際で発散させない
  if(Math.abs(inv)<LIM) inv = inv<0 ? -LIM : LIM;
  const v = 1/inv, m = -v/u;
  return V.add(V.add(g.vPm, V.mul(g.nPm,v)), V.mul(h,m));
}

// 展開した空間の点を、視野の座標（タンジェント）に落とす。
// 3回反射の像は「目より先」に結ぶ実像になる（＝目は収束途中の光を受ける）。
// そのときは光線の向きを裏返して、来た方向を見かけの位置とする。
function project(p,g){
  const D = V.sub(p,g.e1);
  let d = reflectDir(D,g.nSec);
  let w = -d[0];
  if(w<0){ d=V.mul(d,-1); w=-w; }          // 目の後ろに結ぶ実像
  if(w<=1e-6) return null;
  return [-d[2]/w, d[1]/w];
}

const view0 = (q,g)=>project(reflectPoint(q,g.cSec,g.nSec),g);         // 0回
const view1 = (q,g)=>project(q,g);                                      // 1回
const view2 = (q,g)=>{const i=pmImage(q,g); return i&&project(i,g);};   // 2回
const view3 = (q,g)=>{const i=pmImage(reflectPoint(q,g.cSec,g.nSec),g); return i&&project(i,g);};

/* ---- 3次元の輪郭をつくる ---- */
function ring(c,e1,e2,a,b,n){
  const out=[];
  for(let i=0;i<n;i++){const t=2*Math.PI*i/n;
    out.push(V.add(c, V.add(V.mul(e1,a*Math.cos(t)), V.mul(e2,b*Math.sin(t)))));}
  return out;
}
function mapPts(pts,fn,g){
  const out=[];
  for(const q of pts){const p=fn(q,g); if(!p) return null; out.push(p);}
  return out;
}

// 点群を包む凸多角形（Andrew's monotone chain）。
// 円柱の壁は「45°に切った口」と「筒先側の端」の2つの輪でできている。
// ほぼ真横から見ることになるので、2つまとめて包むと帯の形になる。
function hull(pts){
  if(!pts || pts.length<3) return null;
  const p=pts.slice().sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[], up=[];
  for(const q of p){
    while(lo.length>=2 && cr(lo[lo.length-2],lo[lo.length-1],q)<=0) lo.pop();
    lo.push(q);
  }
  for(let i=p.length-1;i>=0;i--){
    const q=p[i];
    while(up.length>=2 && cr(up[up.length-2],up[up.length-1],q)<=0) up.pop();
    up.push(q);
  }
  lo.pop(); up.pop();
  return lo.concat(up);
}

/* ============================================================
   視野に出すものを、まとめて組み立てる
   ============================================================ */
function build(g){
  const N=180, o={};

  // 0回 ── ドローチューブの縁（視野をふちどる）
  o.field = mapPts(ring([g.dfront,0,P.L],[0,1,0],[0,0,1],P.R_FIELD,P.R_FIELD,N), view0, g);
  // 0回 ── 斜鏡の鏡面の縁
  o.secRim = mapPts(ring(g.cSec,g.major,g.minor,P.SEC_A,P.SEC_B,N), view0, g);

  // 0回 ── 斜鏡を支えている円柱の壁。
  // 土台の本体は、45°に切った口に鏡を貼り、そこから筒先側へ伸びる円柱。
  // 覗くとほぼ真横から見ることになるので、帯に見える ──
  // 口の輪と筒先側の端の輪を、まとめて包んで形をとる。
  {
    const M=48, seg=[];
    const w1=g.fv, w2=V.cross(g.stem,g.fv);
    const back=V.add(g.Q, V.mul(g.stem,P.HOLD_V));
    for(let i=0;i<M;i++){const a=2*Math.PI*i/M;          // 筒先側の端（円）
      seg.push(V.add(back, V.add(V.mul(w1,P.SEC_B*Math.cos(a)), V.mul(w2,P.SEC_B*Math.sin(a)))));}
    for(let i=0;i<M;i++){const a=2*Math.PI*i/M;          // 45°に切った口（楕円）
      seg.push(V.add(g.Q, V.add(V.mul(g.major,P.SEC_A*Math.cos(a)), V.mul(g.minor,P.SEC_B*Math.sin(a)))));}
    o.holder = hull(mapPts(seg, view0, g));
  }

  // 1回 ── 主鏡の縁・センターマーク
  o.pmRim  = mapPts(ring(g.vPm,g.pu,g.pv,P.R_PM,P.R_PM,N), view1, g);
  o.markIn = mapPts(ring(g.vPm,g.pu,g.pv,P.MARK_IN,P.MARK_IN,72), view1, g);
  o.markOut= mapPts(ring(g.vPm,g.pu,g.pv,P.MARK_OUT,P.MARK_OUT,72), view1, g);
  // 1回 ── 押さえの爪
  o.clips=[];
  for(const deg of P.CLIPS){
    const c=deg*Math.PI/180, w=5*Math.PI/180, seg=[];
    for(let i=0;i<=8;i++){const t=c-w+2*w*i/8;
      seg.push(V.add(g.vPm, V.add(V.mul(g.pu,P.R_PM*Math.cos(t)), V.mul(g.pv,P.R_PM*Math.sin(t)))));}
    for(let i=8;i>=0;i--){const t=c-w+2*w*i/8, r=P.R_PM-7;
      seg.push(V.add(g.vPm, V.add(V.mul(g.pu,r*Math.cos(t)), V.mul(g.pv,r*Math.sin(t)))));}
    const m=mapPts(seg,view1,g); if(m) o.clips.push(m);
  }

  // 2回 ── 斜鏡のシルエット
  o.sil = mapPts(ring(g.cSec,g.major,g.minor,P.SEC_A,P.SEC_B,N), view2, g);
  // 2回 ── ドローチューブ。筒の中へ突き出した口を、主鏡が映して返す。
  // 2回反射は筒の中心軸に沿った影に近いので、口の輪は真横を向いていて線に潰れる。
  // 輪だけでは何も見えないので、筒の壁まで伸びる2本の縁とあわせて口の形を描く。
  {
    const seg=[], M=48;
    // 壁ぎわで切ると、主鏡を大きく傾けたとき口の絵が視野の中に浮いて見える。
    // 実際のドローチューブは壁の外まで続いているので、そこまで伸ばして縁で切らせる
    const REACH = P.R_TUBE*3;
    seg.push([REACH, P.R_FIELD,P.L]);                          // 壁の外まで（上）
    seg.push([g.dfront, P.R_FIELD,P.L]);                       // 口の縁へ
    for(let i=0;i<=M;i++){const a=Math.PI*i/M;                 // 口の輪の半分
      seg.push([g.dfront, P.R_FIELD*Math.cos(a), P.L+P.R_FIELD*Math.sin(a)]);}
    seg.push([REACH,-P.R_FIELD,P.L]);                          // 壁の外まで（下）
    o.dtube = mapPts(seg, view2, g);
  }
  // 2回 ── スパイダー（4本。台は動くが、筒壁の取りつけ位置は動かない）
  o.spider=[];
  const hz=g.hub[2], H=[g.hub[0],g.hub[1],hz];
  for(const w of [[P.R_TUBE,0],[0,P.R_TUBE],[-P.R_TUBE,0],[0,-P.R_TUBE]]){
    const A=[w[0],w[1],hz], seg=[];
    for(let i=0;i<=24;i++){const t=i/24; seg.push(V.add(V.mul(H,1-t), V.mul(A,t)));}
    const m=mapPts(seg,view2,g); if(m) o.spider.push(m);
  }

  // 3回 ── アイピースの裏側と覗き穴
  o.spiderHub = view2(g.hub,g);                 // スパイダーの交点（2回）
  o.epBack = mapPts(ring(g.eye,[0,1,0],[0,0,1],P.EPB_R,P.EPB_R,N), view3, g);
  o.epHole = mapPts(ring(g.eye,[0,1,0],[0,0,1],P.EPB_H,P.EPB_H,N), view3, g);

  return o;
}

/* ============================================================
   描画（視野）
   ============================================================ */
// 目とドローチューブの先が一緒に動くので、視野の広さは繰り出しでは変わらない
const FIELD_TAN = P.R_FIELD/(FOCAL-P.D_FIELD);
const cvView = document.getElementById('cv-view');

// スマホでは絵を上に貼りつけるので、高さを画面の一部に抑える
function paneMaxH(){
  return isNarrow() ? Math.max(180, Math.min(window.innerHeight*0.38, 380)) : Infinity;
}
function isNarrow(){ return window.matchMedia('(max-width:900px)').matches; }

function setup(cv,aw,ah,maxW){
  const host = cv.parentElement, cs = getComputedStyle(host);
  const avail = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if(!(avail>20)) return null;                     // 隠れているペインは描かない
  let w = Math.min(avail, maxW), h = w*ah/aw;
  const mh = paneMaxH();
  if(h>mh){ h=mh; w=h*aw/ah; }
  w=Math.round(w); h=Math.round(h);
  const dpr = window.devicePixelRatio||1;
  cv.style.width=w+'px'; cv.style.height=h+'px';
  cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  return {ctx,w,h};
}

function pathOf(ctx,pts,tx){
  if(!pts||pts.length<3) return false;
  ctx.beginPath();
  for(let i=0;i<pts.length;i++){const c=tx(pts[i]); i?ctx.lineTo(c[0],c[1]):ctx.moveTo(c[0],c[1]);}
  ctx.closePath(); return true;
}
function lineOf(ctx,pts,tx){
  if(!pts||pts.length<2) return false;
  ctx.beginPath();
  for(let i=0;i<pts.length;i++){const c=tx(pts[i]); i?ctx.lineTo(c[0],c[1]):ctx.moveTo(c[0],c[1]);}
  return true;
}

function drawView(g,o,guide,cross){
  const L0=opt('opt-r0'), L1=opt('opt-r1'),
        L2=opt('opt-r2'), L3=opt('opt-r3');                     // 見せる層
  // 筒の中に白い紙を入れると、斜鏡の向こうが白くなる。
  // 斜鏡の鏡面は主鏡のほうを向いていて紙を映さないので、暗いまま ──
  // だから鏡の縁が、白地の上の暗い輪として出る（実機で使うコツ）
  const paper = opt('opt-paper');
  // 紙を入れるのは筒の中なので、ドローチューブの内壁（視野の外）は暗いまま
  const C_WALL = '#05090B';                       // ドローチューブの内壁（視野の外）
  const C_TUBE = paper ? '#EDEFF1' : '#0A1015';   // 筒の中（斜鏡の外）
  const s0=setup(cvView,1,1,640); if(!s0) return;
  const {ctx,w,h}=s0;
  const cx=w/2, cy=h/2, S=Math.min(w,h)/2/FIELD_TAN*0.94;
  const tx = p=>[cx+p[0]*S, cy-p[1]*S];

  ctx.fillStyle=C_WALL; ctx.fillRect(0,0,w,h);

  // 視野の外側（ドローチューブの内壁）
  if(!pathOf(ctx,o.field,tx)) return;
  ctx.save(); ctx.clip();
  ctx.fillStyle=C_TUBE; ctx.fillRect(0,0,w,h);

  // 0回 ── 斜鏡を支えている円柱の壁。鏡より奥にあるので、鏡より先に塗る
  if(L0 && pathOf(ctx,o.holder,tx)){ ctx.fillStyle = paper ? '#8A9399' : '#141C22'; ctx.fill(); }

  // --- 斜鏡の鏡面 ---
  const C_SEC = L0 ? '#1B242A' : C_TUBE;          // 消すと、筒の中と同じ色になって縁が見えなくなる
  if(pathOf(ctx,o.secRim,tx)){
    ctx.fillStyle = C_SEC; ctx.fill();
    ctx.save(); ctx.clip();

    // 1回 ── 主鏡の縁の中身（明るい面）
    if(pathOf(ctx,o.pmRim,tx)){
      // 消しても、奥に 2回・3回が残っているなら、それが見えるように暗い面は敷く。
      // 全部消したときは鏡の面と同じ色にして、主鏡の円も見えなくする
      ctx.fillStyle = L1 ? '#E9EFF2' : ((L2||L3) ? '#12191E' : C_SEC); ctx.fill();
      ctx.save(); ctx.clip();

      // 押さえの爪
      if(L1){
        ctx.fillStyle='#20282D';
        for(const c of o.clips){ if(pathOf(ctx,c,tx)) ctx.fill(); }
      }

      if(L2){
        // 2回 ── ドローチューブ。口の中は暗いので、影として塗る
        if(pathOf(ctx,o.dtube,tx)){ ctx.fillStyle='#20282D'; ctx.fill(); }

        // 2回 ── スパイダー
        ctx.strokeStyle='#5E6D76'; ctx.lineWidth=Math.max(1.4,S*0.0016);
        for(const sp of o.spider){ if(lineOf(ctx,sp,tx)) ctx.stroke(); }

        // 2回 ── 斜鏡のシルエット
        if(pathOf(ctx,o.sil,tx)){ ctx.fillStyle='#0B1116'; ctx.fill(); }
      }

      // 3回 ── アイピースの裏側と覗き穴
      if(L3){
        if(pathOf(ctx,o.epBack,tx)){ ctx.fillStyle='#C6D2D8'; ctx.fill(); }
        if(pathOf(ctx,o.epHole,tx)){ ctx.fillStyle='#10171C'; ctx.fill(); }
      }

      // 1回 ── センターマーク（外周と穴のあいだだけが不透明）
      if(L1 && o.markOut && o.markIn && pathOf(ctx,o.markOut,tx)){
        const p=new Path2D();
        const a=o.markOut.map(tx), b=o.markIn.map(tx);
        p.moveTo(a[0][0],a[0][1]); for(let i=1;i<a.length;i++)p.lineTo(a[i][0],a[i][1]); p.closePath();
        p.moveTo(b[0][0],b[0][1]); for(let i=b.length-1;i>=0;i--)p.lineTo(b[i][0],b[i][1]); p.closePath();
        // 合っているとアイピースの裏（明るい）と覗き穴（暗い）に重なる。
        // どちらの上でも見えるよう、中間の明るさにしてある
        ctx.fillStyle='#829099'; ctx.fill(p,'evenodd');
      }
      ctx.restore();
    }
    // 斜鏡の縁の線
    if(L0 && pathOf(ctx,o.secRim,tx)){ ctx.strokeStyle='#39464E'; ctx.lineWidth=1.2; ctx.stroke(); }
    ctx.restore();
  }
  ctx.restore();

  // --- 基準線 ---
  if(guide){
    const C={0:'#63B6D8',1:'#E5A052',2:'#B39BDB',3:'#E8748F'};
    const st=(pts,col,dash)=>{ if(!lineOf(ctx,pts,tx))return;
      ctx.closePath(); ctx.setLineDash(dash||[]); ctx.strokeStyle=col;
      ctx.lineWidth=1.6; ctx.globalAlpha=.95; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha=1; };
    if(L0){ st(o.field,C[0],[6,5]); st(o.secRim,C[0]); }
    if(L1){ st(o.pmRim,C[1]); st(o.markOut,C[1]); }
    if(L2){ st(o.sil,C[2]); st(o.dtube,C[2],[5,4]); }
    if(L3){ st(o.epBack,C[3],[5,4]); st(o.epHole,C[3]); }
    // 中心（十字）
    const cr=(p,col)=>{ if(!p)return; const c=tx(p); ctx.strokeStyle=col; ctx.lineWidth=1.4;
      ctx.beginPath(); ctx.moveTo(c[0]-7,c[1]); ctx.lineTo(c[0]+7,c[1]);
      ctx.moveTo(c[0],c[1]-7); ctx.lineTo(c[0],c[1]+7); ctx.stroke(); };
    if(L1) cr(center(o.pmRim),C[1]);
    if(L2) cr(center(o.sil),C[2]);
    if(L3) cr(center(o.epHole),C[3]);
  }

  // 十字線（シミュレーターの補助。実物にはない）
  // ドローチューブの縁の中心＝視線の軸なので、画面の中央に引けばよい
  if(cross){
    ctx.save();
    if(pathOf(ctx,o.field,tx)) ctx.clip();
    ctx.strokeStyle='rgba(126,184,218,.85)'; ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(0,cy); ctx.lineTo(w,cy);
    ctx.moveTo(cx,0); ctx.lineTo(cx,h);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx,cy,Math.max(6,S*0.012),0,7); ctx.stroke();
    ctx.restore();
  }

  // 向き
  const fv2=Math.max(9,Math.min(11,w/50));
  ctx.fillStyle='#5C6E78'; ctx.font=fv2+'px system-ui'; ctx.textBaseline='middle';
  ctx.fillText('◀ 筒先側',8,h-fv2);
  ctx.textAlign='right'; ctx.fillText('主鏡側 ▶',w-8,h-fv2); ctx.textAlign='left';
}

// 最小二乗で円をあてはめる（代数解法）。
// 射影された楕円は点の並びが偏るので、重心を中心にすると値がずれる。
function fitCircle(pts){
  if(!pts||pts.length<3) return null;
  let Sx=0,Sy=0,Sxx=0,Syy=0,Sxy=0,Sxz=0,Syz=0,Sz=0;
  const n=pts.length;
  for(const p of pts){const x=p[0],y=p[1],z=x*x+y*y;
    Sx+=x;Sy+=y;Sxx+=x*x;Syy+=y*y;Sxy+=x*y;Sxz+=x*z;Syz+=y*z;Sz+=z;}
  const M=[[Sxx,Sxy,Sx],[Sxy,Syy,Sy],[Sx,Sy,n]], R=[Sxz,Syz,Sz];
  const det=a=>a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1])
             -a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0])
             +a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0]);
  const D=det(M); if(Math.abs(D)<1e-18) return null;
  const rep=(k)=>{const A=M.map(r=>r.slice()); for(let i=0;i<3;i++)A[i][k]=R[i]; return det(A)/D;};
  const A=rep(0), B=rep(1), C=rep(2);
  const cx=A/2, cy=B/2, r2=C+cx*cx+cy*cy;
  if(!(r2>0)) return null;
  return {c:[cx,cy], r:Math.sqrt(r2)};
}
function center(pts){const f=fitCircle(pts); return f&&f.c;}
function radius(pts){const f=fitCircle(pts); return f?f.r:0;}

/* ============================================================
   描画（筒の断面）
   ============================================================ */
const cvSide = document.getElementById('cv-side');
function drawSide(g,showRay){
  const s0=setup(cvSide,640,330,780); if(!s0) return null;
  const {ctx,w,h}=s0;
  ctx.fillStyle='#05090B'; ctx.fillRect(0,0,w,h);
  // 目は繰り出しで最大 235mm まで動くので、その先まで入る枠にする（縮尺は固定）
  const zMin=-35, zMax=555, xMin=-92, xMax=258;
  const s=Math.min(w/(zMax-zMin), h/(xMax-xMin))*0.94;
  const ox=(w-(zMax-zMin)*s)/2, oy=(h-(xMax-xMin)*s)/2;
  const T=(x,z)=>[ox+(zMax-z)*s, oy+(x-xMin)*s];   // 主鏡＝右／筒先＝左／接眼部＝下
  const mv=(x,z)=>{const c=T(x,z);ctx.moveTo(c[0],c[1]);};
  const ln=(x,z)=>{const c=T(x,z);ctx.lineTo(c[0],c[1]);};

  // 筒
  ctx.strokeStyle='#2C3A42'; ctx.lineWidth=2;
  ctx.beginPath(); mv(-P.R_TUBE,0); ln(-P.R_TUBE,540); ctx.stroke();
  ctx.beginPath(); mv(P.R_TUBE,0); ln(P.R_TUBE,P.L-P.R_FIELD); ctx.stroke();
  ctx.beginPath(); mv(P.R_TUBE,P.L+P.R_FIELD); ln(P.R_TUBE,540); ctx.stroke();
  ctx.beginPath(); mv(-P.R_TUBE,0); ln(P.R_TUBE,0); ctx.stroke();

  // ドローチューブ
  ctx.strokeStyle='#33434C';
  ctx.beginPath(); mv(g.dfront,P.L-P.R_FIELD); ln(g.eye[0]+16,P.L-P.R_FIELD); ctx.stroke();
  ctx.beginPath(); mv(g.dfront,P.L+P.R_FIELD); ln(g.eye[0]+16,P.L+P.R_FIELD); ctx.stroke();
  ctx.beginPath(); mv(g.dfront,P.L-P.R_FIELD); ln(g.dfront,P.L+P.R_FIELD); ctx.stroke();  // 先端

  // 筒の中心軸・接眼部の中心軸
  ctx.setLineDash([4,5]); ctx.strokeStyle='#2A3A44'; ctx.lineWidth=1;
  ctx.beginPath(); mv(0,-40); ln(0,550); ctx.stroke();
  ctx.beginPath(); mv(-90,P.L); ln(g.eye[0]+20,P.L); ctx.stroke();
  ctx.setLineDash([]);

  // 主鏡（傾く。中心は動かない）
  const pmDir=V.norm(V.cross([0,1,0],g.nPm));
  ctx.strokeStyle='#63B6D8'; ctx.lineWidth=4; ctx.lineCap='round';
  ctx.beginPath();
  mv(-P.R_PM*pmDir[0], -P.R_PM*pmDir[2]); ln(P.R_PM*pmDir[0], P.R_PM*pmDir[2]);
  ctx.stroke(); ctx.lineCap='butt';

  // 主鏡から斜鏡へ来る光（と、折れて出ていく光）
  ctx.strokeStyle='rgba(229,160,82,.30)'; ctx.lineWidth=1.2;
  for(const sgn of [1,-1]){
    const start=[sgn*P.R_PM*pmDir[0],0,sgn*P.R_PM*pmDir[2]];
    const foc=V.add(g.vPm,V.mul(g.nPm,P.F_PM));
    const dir=V.norm(V.sub(foc,start));
    const hit=planeHit(start,dir,g.cSec,g.nSec);
    ctx.beginPath(); mv(start[0],start[2]);
    if(hit){ ln(hit.p[0],hit.p[2]);
      const d2=reflectDir(dir,g.nSec);
      const t2=(g.eye[0]+10-hit.p[0])/(d2[0]||1e-9);
      if(t2>0){const e=V.add(hit.p,V.mul(d2,t2)); ln(e[0],e[2]);}
    } else ln(start[0]+dir[0]*600, start[2]+dir[2]*600);
    ctx.stroke();
  }

  // 斜鏡
  const t=V.norm(V.cross([0,1,0],g.nSec));
  const psi=Math.atan2(V.dot(t,g.minor), V.dot(t,g.major));
  const half=1/Math.hypot(Math.cos(psi)/P.SEC_A, Math.sin(psi)/P.SEC_B);
  ctx.strokeStyle='#63B6D8'; ctx.lineWidth=4; ctx.lineCap='round';
  ctx.beginPath();
  mv(g.cSec[0]-t[0]*half, g.cSec[2]-t[2]*half);
  ln(g.cSec[0]+t[0]*half, g.cSec[2]+t[2]*half);
  ctx.stroke(); ctx.lineCap='butt';

  // 交点
  const ip=T(0,P.L);
  ctx.strokeStyle='#7B8D97'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(ip[0]-5,ip[1]); ctx.lineTo(ip[0]+5,ip[1]);
  ctx.moveTo(ip[0],ip[1]-5); ctx.lineTo(ip[0],ip[1]+5); ctx.stroke();

  // 焦点面（つまみの中央の位置）
  ctx.setLineDash([3,4]); ctx.strokeStyle='#8FD48F'; ctx.lineWidth=1.4;
  ctx.beginPath(); mv(FOCAL,P.L-22); ln(FOCAL,P.L+22); ctx.stroke(); ctx.setLineDash([]);

  // 目の位置
  const ep=T(g.eye[0],P.L);
  ctx.fillStyle='#E8748F'; ctx.beginPath(); ctx.arc(ep[0],ep[1],3.2,0,7); ctx.fill();

  // 視線
  let miss=null;
  if(showRay){
    const path=[g.eye]; let p=g.eye, d=[-1,0,0], ok=true;
    const steps=[{c:g.cSec,n:g.nSec},{c:g.vPm,n:g.nPm},{c:g.cSec,n:g.nSec}];
    for(const st of steps){
      const hit=planeHit(p,d,st.c,st.n);
      if(!hit){ok=false;break;}
      path.push(hit.p); p=hit.p; d=reflectDir(d,st.n);
    }
    if(ok){
      const tEnd=(g.eye[0]-p[0])/(d[0]||1e-9);
      const end = tEnd>0 ? V.add(p,V.mul(d,tEnd)) : V.add(p,V.mul(d,240));
      path.push(end);
      if(tEnd>0) miss=Math.hypot(end[1]-g.eye[1], end[2]-g.eye[2]);
    }
    ctx.strokeStyle='#E8748F'; ctx.lineWidth=1.3;
    ctx.beginPath(); mv(path[0][0],path[0][2]);
    for(let i=1;i<path.length;i++) ln(path[i][0],path[i][2]);
    ctx.stroke();
    if(ok && miss!==null){
      const e=path[path.length-1], c=T(e[0],e[2]);
      ctx.fillStyle=miss<1?'#8FD48F':'#E8748F';
      ctx.beginPath(); ctx.arc(c[0],c[1],2.6,0,7); ctx.fill();
    }
  }

  const fs=Math.max(9,Math.min(11,w/56));
  ctx.fillStyle='#5C6E78'; ctx.font=fs+'px system-ui'; ctx.textBaseline='alphabetic';
  ctx.fillText('筒先', 10, fs+5);
  ctx.textAlign='right'; ctx.fillText('主鏡', w-10, fs+5); ctx.textAlign='left';
  const lb=(t,x,z,dx,dy)=>{const c=T(x,z); ctx.fillText(t,c[0]+dx,c[1]+dy);};
  ctx.fillStyle='#7B8D97';
  lb('斜鏡', g.cSec[0]-t[0]*half, g.cSec[2]-t[2]*half, -34, -6);   // 鏡の筒先側の端
  lb('交点', 0, P.L, 9, 17);
  lb('目の位置', g.eye[0], P.L, 9, 4);
  lb('焦点面', FOCAL, P.L, 9, -8);
  return miss;
}

function planeHit(p0,d,c,n){
  const dn=V.dot(d,n); if(Math.abs(dn)<1e-9) return null;
  const t=V.dot(V.sub(c,p0),n)/dn; if(t<=1e-6) return null;
  return {t,p:V.add(p0,V.mul(d,t))};
}

/* ============================================================
   描画（斜鏡を面の正面から）
   ============================================================ */
const cvFace = document.getElementById('cv-face');
function drawFace(g){
  const s0=setup(cvFace,1,1,300); if(!s0) return;
  const {ctx,w,h}=s0;
  ctx.fillStyle='#05090B'; ctx.fillRect(0,0,w,h);
  const s=Math.min(w,h)/2/42*0.92, cx=w/2, cy=h/2;
  // 面内の座標（fu を右、fv を上）
  const T=(u,v)=>[cx+u*s, cy-v*s];

  // 鏡の楕円。柱ごと回るので、面の座標に対しては向きが変わらない
  ctx.beginPath();
  for(let i=0;i<=180;i++){
    const t=2*Math.PI*i/180;
    const c=T(P.SEC_A*Math.cos(t), P.SEC_B*Math.sin(t));
    i?ctx.lineTo(c[0],c[1]):ctx.moveTo(c[0],c[1]);
  }
  ctx.closePath();
  ctx.fillStyle='#1B242A'; ctx.fill();
  ctx.strokeStyle='#63B6D8'; ctx.lineWidth=2; ctx.stroke();

  // 主鏡から来る光の切り口
  const pts=[];
  for(let i=0;i<=180;i++){
    const t=2*Math.PI*i/180;
    const e=V.add(V.mul(g.fu,Math.cos(t)), V.mul(g.fv,Math.sin(t)));
    const r=coneRadius(g,e);
    if(r===null){pts.length=0;break;}
    pts.push([r*Math.cos(t), r*Math.sin(t)]);
  }
  if(pts.length){
    ctx.beginPath();
    for(let i=0;i<pts.length;i++){const c=T(pts[i][0],pts[i][1]); i?ctx.lineTo(c[0],c[1]):ctx.moveTo(c[0],c[1]);}
    ctx.closePath();
    ctx.fillStyle='rgba(229,160,82,.16)'; ctx.fill();
    ctx.strokeStyle='rgba(229,160,82,.85)'; ctx.lineWidth=1.4; ctx.setLineDash([5,4]); ctx.stroke(); ctx.setLineDash([]);
  }

  // 土台の軸（鏡はここから OFFSET だけずらして貼ってある）
  const qa=T(P.OFFSET,0);
  ctx.strokeStyle='#7B8D97'; ctx.lineWidth=1.2; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.arc(qa[0],qa[1],5,0,7); ctx.stroke(); ctx.setLineDash([]);

  // 鏡の中心と、光の切り口の中心
  const cm=T(0,0);
  ctx.strokeStyle='#63B6D8'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.moveTo(cm[0]-6,cm[1]); ctx.lineTo(cm[0]+6,cm[1]);
  ctx.moveTo(cm[0],cm[1]-6); ctx.lineTo(cm[0],cm[1]+6); ctx.stroke();
  if(pts.length){
    let u=0,v=0; for(const p of pts){u+=p[0];v+=p[1];} u/=pts.length; v/=pts.length;
    const c=T(u,v);
    ctx.strokeStyle='#E5A052';
    ctx.beginPath(); ctx.moveTo(c[0]-6,c[1]); ctx.lineTo(c[0]+6,c[1]);
    ctx.moveTo(c[0],c[1]-6); ctx.lineTo(c[0],c[1]+6); ctx.stroke();
  }

  const fF=Math.max(9,Math.min(11,w/30));
  ctx.fillStyle='#5C6E78'; ctx.font=fF+'px system-ui';
  ctx.fillText('筒先／接眼部側 ▶', 8, h-8);
  ctx.fillText('○ 土台の軸 ／ ＋ 鏡の中心 ／ ＋ 光の切り口', 8, h-8-fF*1.7);
}

/* ============================================================
   描画（ドローチューブ側から見た土台）
   ── 土台は「ステム軸に沿った円柱を 45°で切ったもの」。半径を斜鏡の短半径に
      とれば、切り口はちょうど鏡の楕円になる（長半径＝短半径×√2）。
      鏡はその切り口に、軸から OFFSET だけずらして貼ってある。
   ── 真正面から見ると柱の回転がまったく見えない（軸のまわりに対称なので
      輪郭が変わらない）。少しだけ斜めから見て、鏡の楕円の向きで見せる。
   ============================================================ */
const cvStem = document.getElementById('cv-stem');
const STEM_TILT = 15*Math.PI/180;                               // 斜めの角度
const CAM   = [Math.cos(STEM_TILT), 0,  Math.sin(STEM_TILT)];   // 物体 → カメラ
const SCR_R = [Math.sin(STEM_TILT), 0, -Math.cos(STEM_TILT)];   // 画面の右（＝主鏡側）
const SCR_U = [0,1,0];

function drawStem(g,gr,ok){
  const s0=setup(cvStem,84,66,300); if(!s0) return;
  const {ctx,w,h}=s0;
  ctx.fillStyle='#05090B'; ctx.fillRect(0,0,w,h);
  // 画面の原点は「合っているときの土台の軸」。だから土台が動けば絵の中でも動く
  const s=w/84, cx=w/2+16*s, cy=h/2-4*s;
  const pr = p => {const d=V.sub(p,HUB0); return [cx+V.dot(d,SCR_R)*s, cy-V.dot(d,SCR_U)*s];};
  const path = pts => {ctx.beginPath();
    pts.forEach((p,i)=>{const q=pr(p); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});
    ctx.closePath();};
  const seg = (p0,p1)=>{const a=pr(p0),b=pr(p1);
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();};
  // 円柱は、軸と視線の両方に直交する向きへ半径ぶん振ればシルエットになる
  const cyl=(c0,c1,r,fill,stroke)=>{
    const wv=V.norm(V.cross(V.sub(c1,c0),CAM));
    path([V.add(c0,V.mul(wv,r)),V.add(c1,V.mul(wv,r)),V.sub(c1,V.mul(wv,r)),V.sub(c0,V.mul(wv,r))]);
    ctx.fillStyle=fill; ctx.fill();
    ctx.strokeStyle=stroke; ctx.lineWidth=1.2; ctx.stroke();
  };

  const R=rotBetween([0,0,1],g.stem), su=R([1,0,0]), sv=R([0,1,0]);
  const back=V.add(g.Q,V.mul(g.stem,P.HOLD_L));

  // 筒の中心軸（合っているときの柱の軸）
  ctx.strokeStyle='#2A353C'; ctx.lineWidth=1; ctx.setLineDash([2,5]);
  seg(V.add(HUB0,[0,0,-26]), V.add(HUB0,[0,0,72]));
  // いまの柱の軸 ── 回転はこの軸のまわり
  ctx.strokeStyle='#54666F'; ctx.setLineDash([5,4]);
  seg(V.add(g.Q,V.mul(g.stem,-26)), V.add(g.Q,V.mul(g.stem,72)));
  ctx.setLineDash([]);

  // 柱（中央の引きネジが通る）── 枠の外まで伸びる
  cyl(back, V.add(g.Q,V.mul(g.stem,P.HOLD_L+70)), P.STEM_R, '#151D23', '#3C5059');
  // 土台の本体
  cyl(g.Q, back, P.SEC_B, '#131C22', '#3B5763');
  // 背の面と、押しネジ3本
  path(ring(back,su,sv,P.SEC_B,P.SEC_B,72));
  ctx.fillStyle='#141C22'; ctx.fill();
  ctx.strokeStyle='#3B5763'; ctx.lineWidth=1.2; ctx.stroke();
  for(const t of [Math.PI/2, Math.PI*7/6, Math.PI*11/6]){
    const p=pr(V.add(back, V.add(V.mul(su,P.R_SSCR*Math.cos(t)), V.mul(sv,P.R_SSCR*Math.sin(t)))));
    ctx.beginPath(); ctx.arc(p[0],p[1],3,0,7);
    ctx.fillStyle='#26333A'; ctx.fill();
    ctx.strokeStyle='#7B8D97'; ctx.lineWidth=1; ctx.stroke();
  }

  // 合っているときの鏡（点線）── 少しの回転でも、ここからのずれで見える
  if(!ok){
    path(ring(gr.cSec,gr.fu,gr.fv,P.SEC_A,P.SEC_B,96));
    ctx.strokeStyle='rgba(123,141,151,.8)'; ctx.lineWidth=1.2;
    ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
  }
  // 鏡
  path(ring(g.cSec,g.fu,g.fv,P.SEC_A,P.SEC_B,96));
  ctx.fillStyle='#1B242A'; ctx.fill();
  ctx.strokeStyle='#63B6D8'; ctx.lineWidth=2; ctx.stroke();

  // 面の長径と短径。柱を回すと、この十字ごと傾く
  ctx.strokeStyle='rgba(99,182,216,.45)'; ctx.lineWidth=1;
  seg(V.sub(g.cSec,V.mul(g.fu,P.SEC_A)), V.add(g.cSec,V.mul(g.fu,P.SEC_A)));
  seg(V.sub(g.cSec,V.mul(g.fv,P.SEC_B)), V.add(g.cSec,V.mul(g.fv,P.SEC_B)));

  // 土台の軸（○）と、鏡の中心（＋）。この隙間がオフセット
  const qa=pr(g.Q);
  ctx.strokeStyle='#7B8D97'; ctx.lineWidth=1.2; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.arc(qa[0],qa[1],5,0,7); ctx.stroke(); ctx.setLineDash([]);
  const cm=pr(g.cSec);
  ctx.strokeStyle='#63B6D8'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.moveTo(cm[0]-6,cm[1]); ctx.lineTo(cm[0]+6,cm[1]);
  ctx.moveTo(cm[0],cm[1]-6); ctx.lineTo(cm[0],cm[1]+6); ctx.stroke();

  const fF=Math.max(9,Math.min(11,w/30));
  ctx.fillStyle='#5C6E78'; ctx.font=fF+'px system-ui';
  ctx.fillText('◀ 筒先側', 8, h-8);
  const rl='主鏡側 ▶'; ctx.fillText(rl, w-8-ctx.measureText(rl).width, h-8);
  ctx.fillText('○ 土台の軸 ／ ＋ 鏡の中心', 8, h-8-fF*1.7);
}


/* ============================================================
   筒先から筒の中を見る ── スパイダーを合わせるときの向き
   画面の上が接眼部側。筒の中心軸に沿って、まっすぐ覗きこんだ形。
   ============================================================ */
const cvFront = document.getElementById('cv-front');
const FR_R = [0,-1,0];   // 画面の右
const FR_U = [1,0,0];    // 画面の上（＝接眼部側）

function drawTubeFront(g,gr,ok){
  const AW=180, AH=244;                       // 上が筒、下が拡大の帯
  const s0=setup(cvFront,AW,AH,300); if(!s0) return;
  const {ctx,w,h}=s0;
  ctx.fillStyle='#05090B'; ctx.fillRect(0,0,w,h);
  const s=w/AW, cx=w/2, cy=AW*s/2;
  const pr = p => [cx+V.dot(p,FR_R)*s, cy-V.dot(p,FR_U)*s];
  const path = pts => {ctx.beginPath();
    pts.forEach((p,i)=>{const q=pr(p); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});
    ctx.closePath();};
  const seg = (p0,p1)=>{const a=pr(p0),b=pr(p1);
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();};
  const cross = (q,r,col,lw)=>{ctx.strokeStyle=col; ctx.lineWidth=lw;
    ctx.beginPath(); ctx.moveTo(q[0]-r,q[1]); ctx.lineTo(q[0]+r,q[1]);
    ctx.moveTo(q[0],q[1]-r); ctx.lineTo(q[0],q[1]+r); ctx.stroke();};

  // 筒の内側
  ctx.beginPath(); ctx.arc(cx,cy,P.R_TUBE*s,0,7);
  ctx.fillStyle='#0A1015'; ctx.fill();
  ctx.strokeStyle='#3B5763'; ctx.lineWidth=2; ctx.stroke();

  // ドローチューブ ── 筒の中に入りこんだ先。繰り出すと伸びてくる
  ctx.save();
  ctx.beginPath(); ctx.arc(cx,cy,P.R_TUBE*s-1,0,7); ctx.clip();
  ctx.strokeStyle='#2A353C'; ctx.lineWidth=1.4;
  const dfx=g.dfront, far=P.R_TUBE+14;
  seg([dfx,-P.R_FIELD,0],[far,-P.R_FIELD,0]);
  seg([dfx, P.R_FIELD,0],[far, P.R_FIELD,0]);
  seg([dfx,-P.R_FIELD,0],[dfx, P.R_FIELD,0]);
  ctx.restore();

  // スパイダー4本 ── 筒壁の取りつけ位置は動かない。台だけが動く
  ctx.strokeStyle='#54666F'; ctx.lineWidth=1.6;
  for(const wv of [[P.R_TUBE,0],[0,P.R_TUBE],[-P.R_TUBE,0],[0,-P.R_TUBE]])
    seg([wv[0],wv[1],0],[g.hub[0],g.hub[1],0]);

  // 合っているときの鏡（点線）
  if(!ok){
    path(ring(gr.cSec,gr.fu,gr.fv,P.SEC_A,P.SEC_B,96));
    ctx.strokeStyle='rgba(123,141,151,.8)'; ctx.lineWidth=1.2;
    ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
  }
  // 鏡 ── 45°の楕円は、ここから見るとちょうど円になる。傾けば形が崩れる
  path(ring(g.cSec,g.fu,g.fv,P.SEC_A,P.SEC_B,96));
  ctx.fillStyle='#1B242A'; ctx.fill();
  ctx.strokeStyle='#63B6D8'; ctx.lineWidth=2; ctx.stroke();

  // 柱 ── 鏡の裏なので本当は見えない。まんなかに来ているかを見るために重ねる
  const hb=pr([g.hub[0],g.hub[1],0]);
  ctx.beginPath(); ctx.arc(hb[0],hb[1],P.HOLD_R*s,0,7);
  ctx.fillStyle='#26333A'; ctx.fill();
  ctx.strokeStyle='#9AACB6'; ctx.lineWidth=1.4; ctx.stroke();
  cross([cx,cy],7,'#3B5763',1.2);

  // ── 下の帯：中心まわりの拡大 ──────────────────
  // オフセットは筒の大きさに対して小さいので、そのままでは絵に出ない
  const by=AW*s+8, bh=h-by-16, bx=w*0.22, bw=w*0.56;
  ctx.fillStyle='#0A1015'; ctx.fillRect(bx,by,bw,bh);
  ctx.strokeStyle='#26333A'; ctx.lineWidth=1; ctx.strokeRect(bx,by,bw,bh);
  const bc=[bx+bw/2, by+bh/2], si=bh/11;          // 縦に ±5.5mm ぶん
  const bpr = q => [bc[0]-q[1]*si, bc[1]-q[0]*si];
  cross(bc,8,'#54666F',1.2);                       // 筒の中心
  const bhb=bpr(g.hub), bms=bpr(g.cSec);
  ctx.strokeStyle='rgba(99,182,216,.5)'; ctx.lineWidth=1; ctx.setLineDash([2,3]);
  ctx.beginPath(); ctx.moveTo(bhb[0],bhb[1]); ctx.lineTo(bms[0],bms[1]); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(bhb[0],bhb[1],5,0,7);
  ctx.fillStyle='#26333A'; ctx.fill();
  ctx.strokeStyle='#9AACB6'; ctx.lineWidth=1.4; ctx.stroke();
  cross(bms,8,'#63B6D8',1.6);                      // 鏡の中心

  const fF=Math.max(9,Math.min(11,w/30));
  ctx.fillStyle='#5C6E78'; ctx.font=fF+'px system-ui';
  ctx.fillText('▲ 接眼部側', 8, fF*1.6);
  ctx.fillText('○ 柱 ／ ＋ 筒の中心', 8, AW*s-6);
  const bl='中心まわりを拡大　○ 柱 ／ ＋ 筒の中心 ／ ＋ 鏡の中心';
  ctx.fillText(bl, Math.max(4,(w-ctx.measureText(bl).width)/2), h-4);
}

// 土台のペインの下の一言
function stemNote(g,gr){
  const el=document.getElementById('stem-note'); if(!el) return;
  const d=Math.acos(Math.max(-1,Math.min(1,V.dot(g.nSec,gr.nSec))))*180/Math.PI;
  el.innerHTML = d<0.005
    ? (opt('opt-offset')
        ? '鏡は、土台の軸から <b>'+P.OFFSET.toFixed(2)+'mm</b> だけずらして貼ってあります。これがオフセットです。'
        : 'オフセットを切ってあるので、鏡の中心は土台の軸の上にあります。')
    : '鏡の面は、合っているときから <b>'+d.toFixed(2)+'°</b> 振れています。点線が合っているときの鏡です。';
}

// 斜鏡の面内で、方向 e に沿って主鏡から来る光錐の縁までの距離
function coneRadius(g,e){
  const A = V.sub(V.sub(g.cSec,g.vPm), V.mul(g.nPm, V.dot(V.sub(g.cSec,g.vPm),g.nPm)));
  const z0 = V.dot(V.sub(g.cSec,g.vPm),g.nPm);
  const en = V.dot(e,g.nPm);
  const B = V.sub(e, V.mul(g.nPm,en));
  const k = P.R_PM/P.F_PM;
  // |A+rB|^2 = (k(F - z0 - r*en))^2
  const a = V.dot(B,B) - k*k*en*en;
  const b = 2*V.dot(A,B) + 2*k*k*en*(P.F_PM-z0);
  const c = V.dot(A,A) - k*k*(P.F_PM-z0)*(P.F_PM-z0);
  let r;
  if(Math.abs(a)<1e-9){ if(Math.abs(b)<1e-12) return null; r=-c/b; }
  else{ const D=b*b-4*a*c; if(D<0) return null;
        const q=Math.sqrt(D); const r1=(-b+q)/(2*a), r2=(-b-q)/(2*a);
        r = Math.max(r1,r2); if(r<=0) r=Math.min(r1,r2); }
  return (r>0 && r<400) ? r : null;
}

// 光の切り口が鏡の中心にちょうど来るオフセット量。
// 幾何だけで決まるので、起動時に一度だけ二分法で解く。
const OFFSET_IDEAL = (function(){
  const g0 = geometry(DEF);
  const back = V.mul(g0.fu,-1);
  const diff = o => {
    const gg = Object.assign({}, g0, {cSec: V.sub(HUB0, V.mul(g0.fu,o))});
    const a = coneRadius(gg,g0.fu), b = coneRadius(gg,back);
    return (a===null||b===null) ? null : a-b;
  };
  let lo=0, hi=12;
  for(let i=0;i<60;i++){
    const m=(lo+hi)/2, d=diff(m);
    if(d===null) break;
    if(d>0) hi=m; else lo=m;
  }
  return (lo+hi)/2;
})();

/* ============================================================
   読み取り
   ============================================================ */
// 視野の中での向き（右＝主鏡側、左＝筒先側）
function dirName(th){
  const d=(th*180/Math.PI+360)%360;
  const names=[[22.5,'主鏡側'],[67.5,'主鏡側の下'],[112.5,'下'],[157.5,'筒先側の下'],
               [202.5,'筒先側'],[247.5,'筒先側の上'],[292.5,'上'],[337.5,'主鏡側の上'],[360,'主鏡側']];
  for(const [lim,nm] of names) if(d<lim) return nm;
  return '主鏡側';
}

function readout(g,o,miss){
  const rows=[];
  const fPm=fitCircle(o.pmRim), cPm=fPm&&fPm.c, rPm=fPm?fPm.r:0;
  const cFd=center(o.field);
  const pct=(c)=> (c&&cPm&&rPm) ? Math.hypot(c[0]-cPm[0],c[1]-cPm[1])/rPm*100 : null;
  const fmt=(v)=> v===null?'─':v.toFixed(2)+' %';
  const pctPt=(q,c,r)=> (q&&c&&r) ? Math.hypot(q[0]-c[0],q[1]-c[1])/r*100 : null;

  // 主鏡の縁は「視野の中心」から測る
  const ePm = (cPm&&cFd&&rPm) ? Math.hypot(cPm[0]-cFd[0],cPm[1]-cFd[1])/rPm*100 : null;
  rows.push(['主鏡の縁（1回）の偏心', fmt(ePm), ePm!==null&&ePm>3]);
  rows.push(['センターマーク（1回）', fmt(pct(center(o.markIn))), false]);
  rows.push(['斜鏡の縁（0回）の偏心', fmt(pct(center(o.secRim))), false]);
  rows.push(['斜鏡のシルエット（2回）', fmt(pct(center(o.sil))), false]);
  rows.push(['スパイダーの交点（2回）', fmt(pctPt(o.spiderHub,cPm,rPm)), false]);
  rows.push(['返ってきた覗き穴（3回）', fmt(pct(center(o.epHole))), pct(center(o.epHole))>3]);

  // 斜鏡の縁と主鏡の縁のすき間
  const fS = cPm&&rPm ? fitCircle(o.secRim) : null;
  if(fS){
    const dx=fS.c[0]-cPm[0], dy=fS.c[1]-cPm[1], rS=fS.r;
    let mn=Infinity,mx=-Infinity,thMax=0;
    for(let i=0;i<360;i++){
      const th=2*Math.PI*i/360, ct=Math.cos(th), st=Math.sin(th);
      const k=dx*ct+dy*st, m=dx*st-dy*ct;
      if(rS*rS-m*m<0){mn=0;break;}
      const gap=(k+Math.sqrt(rS*rS-m*m))-rPm;
      if(gap<mn) mn=gap;
      if(gap>mx){mx=gap; thMax=th;}
    }
    const ratio = mn>0 ? mx/mn : null;
    rows.push(['輪の太さ（太い側／細い側）', ratio?ratio.toFixed(2)+' 倍':'閉じている（爪が隠れる）', !ratio||ratio>1.6]);
    if(ratio) rows.push(['太いのは', dirName(thMax), false]);
  }

  rows.push(['目の位置（交点から）', g.eye[0].toFixed(0)+' mm', false]);
  rows.push(['斜鏡の傾き', (Math.atan(g.secTilt)*180/Math.PI).toFixed(2)+' °', false]);
  rows.push(['主鏡の傾き', (Math.atan(g.pmTilt)*180/Math.PI).toFixed(2)+' °', false]);
  if(miss!==null && miss!==undefined)
    rows.push(['戻った視線の、覗き穴からのずれ', miss.toFixed(1)+' mm', miss>1]);

  document.getElementById('readout').innerHTML =
    rows.map(r=>'<tr'+(r[2]?' class="is-warn"':'')+'><th>'+r[0]+'</th><td>'+r[1]+'</td></tr>').join('');
}

/* ============================================================
   UI
   ============================================================ */
function buildControls(){
  const host=document.getElementById('controls');
  host.innerHTML = SLIDERS.map((sec,i)=>
    '<details class="cl-fold"'+(sec.open?' open':'')+'>'+
    '<summary>'+sec.fold+
      '<span class="cl-fold__flag" id="f-'+i+'" hidden></span></summary>'+
    sec.groups.map(gp=>
      '<div class="cl-group">'+(gp.group?'<h3>'+gp.group+'</h3>':'')+'<p>'+gp.note+'</p>'+
      gp.items.map(it=>
        '<div class="cl-sl"><label for="s-'+it.k+'">'+it.label+'</label>'+
        '<input type="range" id="s-'+it.k+'" data-k="'+it.k+'" min="'+it.min+'" max="'+it.max+
        '" step="'+it.step+'" value="0" aria-describedby="o-'+it.k+'">'+
        '<output id="o-'+it.k+'" data-k="'+it.k+'" title="タップで 0 に戻す">0.00 '+
        it.unit+'</output></div>').join('')+
      '</div>').join('')+
    '</details>').join('');
  host.querySelectorAll('input[type=range]').forEach(el=>{
    el.addEventListener('input',()=>{
      state[el.dataset.k]=parseFloat(el.value);
      activePreset=null; syncOut(el.dataset.k); syncFlags(); render(); });
  });
  host.querySelectorAll('output[data-k]').forEach(el=>{
    el.addEventListener('click',()=>{
      state[el.dataset.k]=0; activePreset=null; syncControls(); render(); });
  });
}
// 畳んだ塊の中に、回したままのつまみが残っていたら見出しに印を出す
function syncFlags(){
  SLIDERS.forEach((sec,i)=>{
    let n=0;
    for(const gp of sec.groups) for(const it of gp.items)
      if(Math.abs(state[it.k])>1e-9) n++;
    const fl=document.getElementById('f-'+i);
    fl.hidden = n===0;
    fl.textContent = n>1 ? '●'+n : '●';
    fl.title = '始めた位置から回したつまみが '+n+' 個あります';
  });
}
// つまみ1つ分の数字。動かしている最中もここを通す ──
// これを忘れると、つまみは動くのに数字が 0.00 のまま残る
function syncOut(k){
  const it=ITEM[k], ou=document.getElementById('o-'+k);
  const dec = it.unit==='°'?1:2;
  ou.textContent=state[k].toFixed(dec)+' '+it.unit;
  ou.classList.toggle('is-off', Math.abs(state[k])>1e-9);
}
function syncControls(){
  for(const sec of SLIDERS) for(const gp of sec.groups) for(const it of gp.items){
    document.getElementById('s-'+it.k).value=state[it.k];
    syncOut(it.k);
  }
  syncFlags();
}

const between = (lo,hi) => lo + Math.random()*(hi-lo);
const signed  = (lo,hi) => (Math.random()<0.5?-1:1)*between(lo,hi);
// 3本のネジで「傾きだけ」を作る。向きも大きさも毎回ちがう（前後は動かさない）
function tiltScrews(lo,hi){
  const A=between(lo,hi), ph=Math.random()*Math.PI*2;
  return [Math.PI/2, Math.PI*7/6, Math.PI*11/6].map(t=>A*Math.cos(t-ph));
}
function spiderShove(lo,hi){
  const r=between(lo,hi), th=Math.random()*Math.PI*2;
  return {spiderX:r*Math.cos(th), spiderY:r*Math.sin(th)};
}

// プリセットは「ずれ方の型」。押すたびに、その型のなかで別のずれを作る
const PRESETS={
  zero  : ()=>({}),
  sec   : ()=>{ const d=tiltScrews(.18,.34); return {secA:d[0],secB:d[1],secC:d[2]}; },
  pm    : ()=>{ const d=tiltScrews(.50,1.15); return {pmA:d[0],pmB:d[1],pmC:d[2]}; },
  spider: ()=>spiderShove(1.5,3.2),
  rot   : ()=>({secRot:signed(.7,2.4)}),
  rand  : ()=>{
    const s=tiltScrews(.08,.28), p=tiltScrews(.25,.95);
    return Object.assign(spiderShove(.4,2.4),
      {secA:s[0],secB:s[1],secC:s[2],secPull:signed(.1,.8),secRot:signed(.2,1.4),
       pmA:p[0],pmB:p[1],pmC:p[2]});
  }
};
// 最後に押したプリセット。つまみを手で動かしたら外れる
let activePreset='zero';
// 光軸が合っているか ── つまみの値ではなく、出来上がった姿勢そのもので見る。
// 押しネジ3本を同じだけ回すのと引きネジは同じ動きなので、
// 値がちがっても同じ姿勢になり得る。それを「合っていない」と言わないため。
const near = (a,b,t)=>V.len(V.sub(a,b))<t;
const alignedNow = (g,r)=>
  near(g.cSec,r.cSec,1e-6) && near(g.nSec,r.nSec,1e-9) &&
  near(g.fu,r.fu,1e-9)     && near(g.nPm,r.nPm,1e-9);

function markActivePreset(zero){
  document.querySelectorAll('button[data-preset]').forEach(b=>{
    const k=b.dataset.preset;
    if(k==='rand') return;                       // ランダムは状態ではなく操作
    const on = k==='zero' ? zero : (!zero && activePreset===k);
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on?'true':'false');
  });
}

function applyPreset(name){
  const keep = state.draw;                 // 覗き方は保つ
  Object.assign(state,DEF);
  state.draw = keep;
  Object.assign(base,DEF);
  // ずれは「始めの状態」のほうに入れる。つまみはまんなかから始まる。
  // 刻みに乗せてあるので、つまみを逆に同じだけ回せばちょうど合う。
  const made = (PRESETS[name]||PRESETS.zero)();
  for(const k in made) base[k]=fitKnob(k,made[k]);
  activePreset = name;
  syncControls(); render();
}
document.querySelectorAll('button[data-preset]').forEach(b=>
  b.addEventListener('click',()=>applyPreset(b.dataset.preset)));
['opt-offset','opt-cross','opt-guide','opt-ray','opt-paper',
 'opt-r0','opt-r1','opt-r2','opt-r3'].forEach(id=>
  document.getElementById(id).addEventListener('change',render));

/* ============================================================
   まわす
   ============================================================ */
// 斜鏡ペインの下に、切り口が中心から外れる理由を出す
function faceNote(g){
  const el=document.getElementById('face-note'); if(!el) return;
  const rp=coneRadius(g,g.fu), rm=coneRadius(g,V.mul(g.fu,-1));
  if(rp===null||rm===null){ el.textContent=''; return; }
  const d=(rp-rm)/2;
  el.innerHTML = Math.abs(d)<0.05
    ? '<b>切り口は、鏡のまんなかに収まっています。</b>'+
      'オフセットは、この2つの中心を合わせるための操作でした。'
    : '切り口が '+Math.abs(d).toFixed(2)+'mm だけ'+(d>0?'筒先側':'主鏡側')+'へ寄っています。'+
      'まんなかに来るのはオフセットが '+OFFSET_IDEAL.toFixed(3)+'mm のときです。';
}

function render(){
  const g=geometry(live());
  // 合っているときの姿。点線の下敷きと、振れ角の基準に使う
  const gr=geometry(Object.assign({},DEF,{draw:state.draw}));
  markActivePreset(alignedNow(g,gr));
  const o=build(g);
  drawView(g,o,opt('opt-guide'),opt('opt-cross'));
  const miss=drawSide(g,opt('opt-ray'));
  drawFace(g);
  faceNote(g);
  drawStem(g,gr,alignedNow(g,gr));
  drawTubeFront(g,gr,alignedNow(g,gr));
  stemNote(g,gr);
  readout(g,o,miss);
}
// スマホでは上のペインを1枚ずつ出す
const tabs = Array.from(document.querySelectorAll('.cl-tab'));
const panes = Array.from(document.querySelectorAll('.cl-pane'));
tabs.forEach(b=>b.addEventListener('click',()=>{
  tabs.forEach(x=>{const on=x===b;
    x.classList.toggle('is-active',on); x.setAttribute('aria-selected',on?'true':'false');});
  panes.forEach(p=>p.classList.toggle('is-active', p.dataset.pane===b.dataset.pane));
  render();
}));

buildControls(); syncControls(); render();
let rt;
const redraw=()=>{clearTimeout(rt); rt=setTimeout(render,120);};
window.addEventListener('resize',redraw);
window.addEventListener('orientationchange',redraw);
if(document.fonts && document.fonts.ready) document.fonts.ready.then(render);
