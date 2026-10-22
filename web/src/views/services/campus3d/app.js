// Generated from cpu-jiangning-3d/src/main.js by tools/export_cpuweb.py. Do not edit by hand.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export function mountCampus3D(root, opts) {
let DISPOSED = false, RAF = 0;
const CLEANUP = [];
const on = (target, type, fn, options) => { target.addEventListener(type, fn, options); CLEANUP.push(() => target.removeEventListener(type, fn, options)); };

const D = JSON.parse(JSON.stringify(opts.data));
const O = JSON.parse(JSON.stringify(opts.outer));
// OSM still contains service roads from the pre-Double-A layout. The photographed
// east forecourt is pedestrian paving; retain only its northern access segment.
D.r = D.r.flatMap(r => {
  const [x, z] = r.p[0];
  if (r.t === 'service' && Math.abs(x - 16.7) < 0.1 && Math.abs(z + 493.4) < 0.1) return [];
  if (r.t === 'service' && Math.abs(x + 47.7) < 0.1 && Math.abs(z + 713.9) < 0.1) return [{ ...r, p: r.p.slice(0, 4) }];
  return [r];
});
const $ = (s) => root.querySelector(s);
const nextFrame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 60); });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const LAT0 = 31.9035, LON0 = 118.9125;
const KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110574;
const toLL = (x, z) => [LAT0 - z / KY, LON0 + x / KX];

function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rand = mulberry(639);
const rr = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const TOUCH = matchMedia('(pointer: coarse)').matches;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
const QUALITY = TOUCH ? 'low' : ((navigator.hardwareConcurrency || 4) >= 8 ? 'high' : 'med');
const QP = {
  high: { tex: 4096, trees: 1.0, shadow: 4096, water: 512, people: 240, cars: 55, pr: 1.6 },
  med: { tex: 4096, trees: 0.72, shadow: 2048, water: 512, people: 160, cars: 40, pr: 1.25 },
  low: { tex: 2048, trees: 0.42, shadow: 1024, water: 256, people: 80, cars: 24, pr: 1.25 },
}[QUALITY];

function pArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; }
function pCentroid(p) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1]; a += f; cx += (p[j][0] + p[i][0]) * f; cz += (p[j][1] + p[i][1]) * f;
  }
  if (Math.abs(a) < 1e-6) { let x = 0, z = 0; p.forEach((q) => { x += q[0]; z += q[1]; }); return [x / p.length, z / p.length]; }
  return [cx / (3 * a), cz / (3 * a)];
}
function pip(x, z, p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function pBox(p) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const q of p) { a = Math.min(a, q[0]); b = Math.min(b, q[1]); c = Math.max(c, q[0]); d = Math.max(d, q[1]); } return [a, b, c, d]; }
function obb(p) {
  let best = null;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) continue;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const q of p) { const u = q[0] * c + q[1] * s, v = -q[0] * s + q[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) { const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2; best = { A, ang, L: u1 - u0, W: v1 - v0, cx: cu * c - cv * s, cz: cu * s + cv * c }; }
  }
  if (best.W > best.L) best = { ...best, ang: best.ang + Math.PI / 2, L: best.W, W: best.L };
  best.ux = Math.cos(best.ang); best.uz = Math.sin(best.ang);
  return best;
}
// Distance along (dx, dz) from (ox, oz) to the nearest edge of p, or Infinity.
function rayPoly(p, ox, oz, dx, dz) {
  let t = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], ex = b[0] - a[0], ez = b[1] - a[1], den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const wx = a[0] - ox, wz = a[1] - oz, s = (wx * ez - wz * ex) / den, r = (wx * dz - wz * dx) / den;
    if (s > 0 && r >= 0 && r <= 1) t = Math.min(t, s);
  }
  return t;
}
const scalePoly =(p, c, k) => p.map((q) => [c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k]);
function rectPoly(cx, cz, L, W, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [[L / 2, W / 2], [-L / 2, W / 2], [-L / 2, -W / 2], [L / 2, -W / 2]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
}
function roundedRect(cx, cz, L, W, r, ang, seg = 7) {
  const hl = L / 2 - r, hw = W / 2 - r, pts = [];
  for (const [u0, v0, a0] of [[hl, hw, 0], [-hl, hw, Math.PI / 2], [-hl, -hw, Math.PI], [hl, -hw, Math.PI * 1.5]])
    for (let i = 0; i <= seg; i++) { const a = a0 + i / seg * Math.PI / 2; pts.push([u0 + Math.cos(a) * r, v0 + Math.sin(a) * r]); }
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
}
function circlePoly(cx, cz, r, n = 24) { const o = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; o.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } return o; }
function offsetLine(p, d) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    let nx = 0, nz = 0;
    if (i > 0) { const dx = p[i][0] - p[i - 1][0], dz = p[i][1] - p[i - 1][1], l = Math.hypot(dx, dz) || 1; nx += -dz / l; nz += dx / l; }
    if (i < p.length - 1) { const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][1] - p[i][1], l = Math.hypot(dx, dz) || 1; nx += -dz / l; nz += dx / l; }
    const l = Math.hypot(nx, nz) || 1; out.push([p[i][0] + nx / l * d, p[i][1] + nz / l * d]);
  }
  return out;
}
function cumLen(p) { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; }
function sampleAt(p, cum, s) {
  s = clamp(s, 0, cum[cum.length - 1]);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / seg;
  const dx = p[hi][0] - p[lo][0], dz = p[hi][1] - p[lo][1], l = Math.hypot(dx, dz) || 1;
  return { x: p[lo][0] + dx * t, z: p[lo][1] + dz * t, dx: dx / l, dz: dz / l };
}
function edgeOutward(p, i) {
  const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  const ccw = pArea(p) > 0;
  return { a, b, len: l, mx: (a[0] + b[0]) / 2, mz: (a[1] + b[1]) / 2, nx: ccw ? dz / l : -dz / l, nz: ccw ? -dx / l : dx / l, dx: dx / l, dz: dz / l };
}
function edgeFacing(p, tx, tz, minLen = 8) {
  let best = null;
  for (let i = 0; i < p.length; i++) {
    const e = edgeOutward(p, i); if (e.len < minLen) continue;
    const vx = tx - e.mx, vz = tz - e.mz, vl = Math.hypot(vx, vz) || 1;
    const sc = (e.nx * vx + e.nz * vz) / vl + e.len * 0.004;
    if (!best || sc > best.sc) best = { ...e, sc, i };
  }
  return best;
}

class Grid {
  constructor(cell) { this.c = cell; this.m = new Map(); }
  k(i, j) { return i * 100003 + j; }
  add(item, bb) {
    for (let i = Math.floor(bb[0] / this.c); i <= Math.floor(bb[2] / this.c); i++)
      for (let j = Math.floor(bb[1] / this.c); j <= Math.floor(bb[3] / this.c); j++) {
        const k = this.k(i, j); if (!this.m.has(k)) this.m.set(k, []); this.m.get(k).push(item);
      }
  }
  at(x, z) { return this.m.get(this.k(Math.floor(x / this.c), Math.floor(z / this.c))) || []; }
}

const CATS = {
  gate: { name: '门户与行政', color: '#ff3b30' },
  teach: { name: '教学科研', color: '#007aff' },
  life: { name: '生活', color: '#ff9500' },
  scenic: { name: '湖泊园林', color: '#34c759' },
  sport: { name: '运动', color: '#ff2d55' },
  transit: { name: '交通', color: '#5856d6' },
};
const ICON = {
  book: 'M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5c-.8 0-1.5-.7-1.5-1.5zM20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z',
  flask: 'M9 3h6M10 3v6l-5.2 8.8A2.1 2.1 0 0 0 6.6 21h10.8a2.1 2.1 0 0 0 1.8-3.2L14 9V3M7.5 15h9',
  cap: 'M2 9.5 12 5l10 4.5-10 4.5zM6 11.5V16c3.5 2.4 8.5 2.4 12 0v-4.5',
  columns: 'M3 9.5 12 4l9 5.5M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 20.5h18',
  bed: 'M3 19V6M3 15h18v4M21 15v-2.5A3.5 3.5 0 0 0 17.5 9H11v6M7 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  fork: 'M7 3v7M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 10v11M17 21V3c-2.2 1-3.5 4-3.5 8H17',
  cross: 'M12 6v12M6 12h12',
  track: 'M8 6h8a6 6 0 0 1 0 12H8A6 6 0 0 1 8 6zM8 9.5h8a2.5 2.5 0 0 1 0 5H8a2.5 2.5 0 0 1 0-5z',
  ball: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3v18M5.7 5.7a9 9 0 0 1 0 12.6M18.3 5.7a9 9 0 0 0 0 12.6',
  waves: 'M3 9.5c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  leaf: 'M5 19C5 10 11 5 20 4c-1 9-6 15-15 15zM5 19l8-8',
  flag: 'M5 21V4M5 4h12l-2.5 4.5L17 13H5',
  tram: 'M7 3h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM5 10h14M8.5 21l1.5-4M15.5 21 14 17',
  road: 'M8 3 5 21M16 3l3 18M12 4v3M12 10.5v3M12 17v3',
  building: 'M5 21V4h9v17M14 9h5v12M3 21h18M8 8h3M8 12h3M8 16h3',
  briefcase: 'M4 8h16v11H4zM9 8V5.5h6V8M4 13h16',
};
ICON.box = 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8';
ICON.shield = 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z';
const SVGNS = 'http://www.w3.org/2000/svg';
function svgIcon(k) {
  const svg = document.createElementNS(SVGNS, 'svg'), path = document.createElementNS(SVGNS, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); path.setAttribute('d', ICON[k] || ICON.building); svg.appendChild(path); return svg;
}
function elt(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function iconFor(p) {
  const n = p.name;
  if (p.water || /河道/.test(n)) return 'waves';
  const rules = [[/图书馆/, 'book'], [/博物馆/, 'columns'], [/行政楼|会议中心|大礼堂/, 'briefcase'], [/门$/, 'flag'], [/教学楼|求.楼|经管文/, 'cap'], [/驿站|文创/, 'box'], [/广场/, 'flag'], [/警务/, 'shield'], [/医务|医学楼/, 'cross'], [/樱花/, 'leaf'], [/旧馆/, 'ball'],
    [/实验楼|科学楼|化学楼|分析楼|理学楼|研发楼|科研楼|安评|同位素|实训|兴药楼|中心$/, 'flask'], [/食堂/, 'fork'], [/苑|公寓/, 'bed'], [/门诊/, 'cross'],
    [/植物园|温室/, 'leaf'], [/体育场/, 'track'], [/游泳/, 'drop'], [/体育馆|篮球|网球/, 'ball'], [/地铁|站/, 'tram'], [/大道/, 'road']];
  for (const [re, k] of rules) if (re.test(n)) return k;
  return 'building';
}
const placeColor = (p) => (p.water || /河道/.test(p.name) ? '#30b0c7' : CATS[p.cat]?.color || '#007aff');
const CAMPUS = D.campus;
{ const yc = D.r.find((r) => r.n === '以诚路'); if (yc) { yc.p = [[-278, 245], [-250, 200], [-206, 154], [-194.5, 141], [-186, 114], [-172.4, 60.6], [-160, 20], [-140, 0], [-108, -36], [-89, -58], [-66, -84]]; yc.wide = 24; } }
// 文德苑（研究生公寓四期，OSM 553917100）：形体按 z18/z19 卫星图的屋面，立面与层数按 r01.jpg / official_graduate.png。
// 西端斜向西南的弧形板楼接东西向主楼，东端一段南北向短翼（南山墙每层居中一窗），楼前一圈向南凸出的单层弧形裙房。
const WENDE = (() => {
  const H = 9 * 3.3, ctr = [], P0 = [375.5, -374], P1 = [388.5, -357.2], P2 = [404, -356.6];
  for (let i = 0; i <= 10; i++) { const t = i / 10, a = (1 - t) ** 2, m = 2 * t * (1 - t), c = t * t; ctr.push([a * P0[0] + m * P1[0] + c * P2[0], a * P0[1] + m * P1[1] + c * P2[1]]); }
  ctr.push([420, -356.6], [436.5, -356.6]);
  const north = offsetLine(ctr, -6.4), south = offsetLine(ctr, 6.4);
  const slab = north.concat(south.slice().reverse());
  const wing = [[436.5, -377], [448.5, -377], [448.5, -348.5], [436.5, -348.5]];
  const arc = []; for (let i = 0; i <= 14; i++) { const x = 436.5 - 36.5 * i / 14; arc.push([x, -350.2 + 7.7 * Math.sin(Math.PI * (x - 400) / 36.5)]); }
  const podium = arc.concat([[400, -351.4], [436.5, -351.4]]);
  const footprint = north.concat(wing.slice(0, 3), [[436.5, -348.5]], arc, south.filter((q) => q[0] < 399.9).reverse());
  return { H, slab, wing, podium, footprint };
})();
const NE = {
  site: [[397,-563],[490,-565],[535,-530],[580,-505],[592,-410],[560,-393],[425,-398],[402,-448]],
  beds: [[380,-620],[429,-635],[472,-597],[420,-565]],
  phase4: [[395,-400],[474,-399],[490,-385],[494,-346],[477,-346],[475,-377],[468,-383],[395,-383],[380,-396],[388,-409]],
  phase5: (()=>{const c=new THREE.CatmullRomCurve3([[586,-375],[530,-375],[523,-357],[542,-336],[565,-316],[627,-314]].map(p=>new THREE.Vector3(p[0],0,p[1])),false,'centripetal');const line=c.getPoints(48).map(p=>[p.x,p.z]);return offsetLine(line,8.2).concat(offsetLine(line,-8.2).reverse());})(),
  pond: [[473,-846],[507,-858],[541,-852],[548,-835],[537,-807],[511,-795],[482,-809],[467,-828]],
  parking: [rectPoly(624,-445,48,65,0),rectPoly(620,-386,60,24,0)],
  phase5Yard:[[512,-402],[645,-403],[652,-288],[565,-288],[510,-341]],
  reserves:[
    [[-120,-1160],[650,-1160],[735,-970],[310,-900],[-120,-943]],
    [[410,-936],[580,-1030],[1020,-650],[770,-470],[610,-646]],
  ],
  patches: [
    {kind:'wood',p:[[-130,-1140],[-25,-1152],[130,-1115],[262,-955],[210,-941],[-90,-970]]},
    {kind:'nursery',p:[[155,-1135],[340,-1152],[418,-1045],[280,-959]]},
    {kind:'wood',p:[[325,-1005],[528,-1045],[590,-943],[452,-862],[392,-897]]},
    {kind:'nursery',p:[[422,-875],[555,-925],[632,-854],[570,-741],[501,-755]]},
    {kind:'wood',p:[[568,-790],[646,-853],[758,-703],[706,-604],[621,-650]]},
    {kind:'field',p:[[648,-989],[801,-1096],[922,-946],[769,-830]]},
    {kind:'field',p:[[744,-780],[854,-853],[962,-688],[849,-615]]},
    {kind:'nursery',p:[[621,-619],[724,-672],[813,-559],[714,-501]]},
  ],
};
// This mapped pitch predates the construction visible in the supplied imagery.
D.pi = D.pi.filter(q=>!(q.p && pCentroid(q.p)[0]>500 && pCentroid(q.p)[1]<-260));
D.lu.push(...NE.parking.map(p=>({k:'parking',p})));
D.w.push({n:'东北林地水塘',o:[NE.pond],i:[]});
D.r=D.r.map(r=>r.n==='博爱路'&&r.p[0][1]<-500&&r.p.length>4?{...r,p:[[376.2,-510.9],[394,-450],[407,-414],[492,-414],[507,-397],[508,-360],[525,-330],[545,-300],[553,-260],...r.p.filter(p=>p[1]>-250)]}:r);
const WATERS = D.w.map((w) => ({ name: w.n, outer: w.o, inner: w.i, bb: pBox(w.o[0]) }));

const FAC = {
  ribbonGlass: { bw: 1.45, fh: 4.3, lit: 0.25 },
  cityG: { bw: 3.3, fh: 3.0, lit: 0.5 },
  adminDark: { bw: 3.9, fh: 3.9, lit: 0.25 }, libStone: { bw: 4.2, fh: 4.4, lit: 0.7 }, libPodium: { bw: 4.0, fh: 5.0, lit: 0.8 }, labDark: { bw: 3.4, fh: 4.4, lit: 0.4 },
  dormWhite: { bw: 3.6, fh: 3.2, lit: 0.6 }, dormBeige: { bw: 3.6, fh: 3.2, lit: 0.6 }, confDark: { bw: 4.2, fh: 5.0, lit: 0.6 }, stoneGrey: { bw: 4.0, fh: 4.0, lit: 0.3 },
  lab: { bw: 4.2, fh: 4.0, lit: 0.32 }, teach: { bw: 4.0, fh: 4.0, lit: 0.3 }, library: { bw: 4.0, fh: 4.3, lit: 0.75 },
  admin: { bw: 3.6, fh: 3.9, lit: 0.22 }, dorm: { bw: 3.6, fh: 3.3, lit: 0.62 }, dormStripe: { bw: 3.6, fh: 3.3, lit: 0.6 },
  canteen: { bw: 4.2, fh: 4.5, lit: 0.8 }, labw: { bw: 3.0, fh: 4.2, lit: 0.4 }, whiteGreen: { bw: 3.0, fh: 4.2, lit: 0.36 },
  glass: { bw: 1.6, fh: 4.0, lit: 0.55 }, glassGrey: { bw: 3.0, fh: 4.2, lit: 0.3 }, plain: { bw: 3.6, fh: 3.6, lit: 0.3 },
  beigeBand: { bw: 3.4, fh: 3.1, lit: 0.6 }, podium: { bw: 6.0, fh: 4.5, lit: 0.8 },
  wende: { bw: 3.6, fh: 3.3, lit: 0.62 }, wendeSolid: { bw: 3.6, fh: 3.3, lit: 0 }, wendePodium: { bw: 4.2, fh: 5.6, lit: 0.8 }, shed: { bw: 6.0, fh: 6.5, lit: 0.04 },
  city: { bw: 3.3, fh: 3.0, lit: 0.5 }, cityB: { bw: 3.3, fh: 3.0, lit: 0.5 }, cityW: { bw: 3.3, fh: 3.0, lit: 0.5 },
  villa: { bw: 3.6, fh: 3.2, lit: 0.42 }, stone: { bw: 4, fh: 4, lit: 0 },
};

function teachLabel(n) { const m = n.match(/(求.楼)\s*\/\s*教学楼([A-E])/); return m ? `教学楼${m[2]} · ${m[1]}` : n; }
function classify(b) {
  const n = b.n || '';
  const R = (o) => Object.assign({ fl: 4, st: 'plain', roof: 'roof:light', trim: 'trim:grey', ph: 1.0, towers: 0, cat: 'teach', label: n }, o);
  if (b.ly === '1' && /中国药科大学/.test(n)) return R({ special: 'station', cat: 'transit', label: '地铁中国药科大学站', fl: 2 });
  if (/图书馆/.test(n)) return R({ special: 'library', fl: 7 });
  if (/药学博物馆/.test(n)) return R({ special: 'museum', fl: 3 });
  if (/行政楼/.test(n)) return R({ special: 'admin', fl: 7, st: 'adminDark', trim: 'trim:dark', ph: 1.2, cat: 'gate' });
  if (/会议中心/.test(n)) return R({ special: 'conference', fl: 2, cat: 'gate' });
  if (/求知|求实|求真|求新|求同/.test(n)) return R({ fl: 5, st: 'teach', towers: 1, trim: 'trim:white', label: teachLabel(n) });
  if (/科学楼|化学楼|分析楼|理学楼|经管文楼/.test(n)) return R({ fl: /经管/.test(n) ? 5 : 6, st: 'lab', towers: 1, trim: 'trim:white', roof: 'roof:mid' });
  if (/综合研发楼/.test(n)) return R({ fl: 8, st: 'lab', trim: 'trim:white', towers: 1 });
  if (/实训楼/.test(n)) return R({ fl: 5, st: 'lab' });
  if (/安评中心/.test(n)) return R({ fl: 4, st: 'labw', trim: 'trim:white' });
  if (/同位素楼|库房/.test(n)) return R({ fl: 2, st: 'plain' });
  if (/食堂/.test(n)) return R({ fl: 4, st: 'canteen', trim: 'trim:dark', cat: 'life' });
  if (/文思苑|文德苑/.test(n)) return R({ fl: 7, st: 'dormStripe', trim: 'trim:white', roof: 'roof:dark', cat: 'life' });
  if (/文萃|文轩|文菁|文澜/.test(n)) return R({ fl: 5, st: 'dormWhite', roof: 'roof:tileGrey', hip: 1, trim: 'trim:white', cat: 'life' });
  if (/文枢|文昌/.test(n)) return R({ fl: 6, st: 'dormBeige', roof: 'roof:tileRed', hip: 1, trim: 'trim:white', cat: 'life' });
  if (/苑/.test(n)) return R({ fl: 6, st: 'dormWhite', roof: 'roof:tileGrey', hip: 1, trim: 'trim:white', cat: 'life' });
  if (/体育馆/.test(n)) return R({ special: 'gym', cat: 'sport', fl: 2 });
  if (/门诊|后勤/.test(n)) return R({ fl: 3, st: 'plain', cat: 'life' });
  if (/温室/.test(n)) return R({ special: 'greenhouse', cat: 'scenic', fl: 1 });
  if (/植物园管理/.test(n)) return R({ special:'gardenService',fl: 2, h:6,st: 'plain', cat: 'scenic' });
  if (b.t === 'apartments') return R({ fl: 6, st: 'dormWhite', roof: 'roof:tileGrey', hip: 1, trim: 'trim:white', cat: 'life' });
  return null;
}

const BLD = [];
for (const b of D.b) {
  if (b.p.length < 3) continue;
  if(b.id===553917100) continue;
  const p = pArea(b.p) === 0 ? b.p : b.p;
  BLD.push({ osm: b.id, name: b.n || '', p, cls: classify(b), src: 'osm', type: b.t });
}
const EXTRA = [
  { name: '学院实验楼', special: 'xueyuan', cat: 'teach', p: rectPoly(-170, -595, 190, 215, 0), src: 'sat', fl: 5 },
  { name: '新建科研楼 A', p: [[-292, -497], [-252, -497], [-252, -420], [-292, -420]], st: 'labw', fl: 6, src: 'sat-inferred', cat: 'teach', group: 'newlab' },
  { name: '新建科研楼 A', p: [[-252, -452], [-180, -505], [-163, -484], [-238, -428], [-252, -428]], st: 'labw', fl: 6, src: 'sat-inferred', cat: 'teach', group: 'newlab', nolabel: 1 },
  { name: '新建科研楼 B', p: [[-298, -412], [-202, -412], [-202, -376], [-298, -376]], st: 'glassGrey', fl: 6, src: 'sat-inferred', cat: 'teach', group: 'newlab' },
  { name: '新建科研楼 C', p: [[-404, -420], [-308, -420], [-308, -380], [-404, -380]], st: 'whiteGreen', fl: 6, src: 'sat-inferred', cat: 'teach', group: 'newlab' },
  { name: '', p: [[-160, -446], [-137, -446], [-137, -400], [-160, -400]], st: 'plain', fl: 2, src: 'sat', cat: 'teach' },
  { name: '文德苑', p: WENDE.footprint, special: 'wende', st: 'wende', fl: 9, h: WENDE.H, src: 'photo+sat', cat: 'life' },
  { name: '文正苑6、7号楼', p:NE.phase5,special:'graduate',st:'beigeBand',fl:8,h:25.6,src:'sat-inferred',cat:'life' },
  { name: '文华苑1号楼', p: rectPoly(531.6, -135.2, 81, 21.7, 0), special: 'hdorm', st: 'beigeBand', fl: 8, h: 25.2, src: 'sat', cat: 'life' },
  { name: '文华苑2号楼', p: rectPoly(496.2, -81.1, 71, 20.2, 0), special: 'hdorm', st: 'beigeBand', fl: 8, h: 25.2, src: 'sat', cat: 'life' },
  { name: '文华苑3号楼', p: rectPoly(465.7, -27, 71, 20.1, 0), special: 'hdorm', st: 'beigeBand', fl: 8, h: 25.2, src: 'sat', cat: 'life' },
  { name: '文正苑4号楼', p: rectPoly(569.4, -186.2, 74, 21.5, 0), special: 'hdorm', st: 'beigeBand', fl: 8, h: 25.2, src: 'sat', cat: 'life' },
  { name: '文正苑5号楼', p: rectPoly(615.3, -242, 78.6, 24.7, 0), special: 'hdorm', st: 'beigeBand', fl: 8, h: 25.2, src: 'sat', cat: 'life' },
  { name: '活动中心', p: rectPoly(337, 28, 58, 36, 0), st: 'whiteGreen', fl: 3, src: 'map-inferred', cat: 'life' },
  ...[-499,-480,-460,-442].map((z,i)=>({name:'',p:rectPoly(566,z,33,7,0),st:'shed',fl:1,h:3.2,roof:i%2?'roof:light':'roof:metalBlue',src:'sat',cat:'transit',nolabel:1})),
  {name:'',p:rectPoly(-383,-35,12,8.5,0.33),st:'plain',fl:1,h:3.6,hip:1,roof:'villaRoof',src:'sat',cat:'scenic',nolabel:1},
  {name:'',p:rectPoly(450,-880,26,16,-0.28),st:'plain',fl:1,h:4,roof:'roof:metalBlue',src:'sat',cat:'scenic',nolabel:1},
];
for (const e of EXTRA) BLD.push({ name: e.name, p: e.p, src: e.src, extra: e, cls: Object.assign({ fl: e.fl || 4, st: e.st || 'plain', roof: e.roof || 'roof:light', trim: 'trim:white', ph: 1.0, towers: 0, cat: e.cat, label: e.nolabel ? '' : e.name, h: e.h }, e.special ? { special: e.special } : {}) });

const poolPi = D.pi.find((q) => q.k === 'swimming_pool');
if (poolPi) {
  const ob = obb(poolPi.p);
  BLD.push({ name: '游泳馆', p: rectPoly(ob.cx, ob.cz, ob.L + 16, ob.W + 14, ob.ang), src: 'osm+', cls: { special: 'natatorium', fl: 2, cat: 'sport', label: '游泳馆', st: 'labw' } });
}

for (const b of BLD) {
  b.c = pCentroid(b.p); b.bb = pBox(b.p); b.area = Math.abs(pArea(b.p));
}
for (const b of BLD) {
  if (b.cls) continue;
  let best = null, bd = 70;
  for (const o of BLD) { if (!o.cls || o === b || o.cls.special) continue; const d = Math.hypot(o.c[0] - b.c[0], o.c[1] - b.c[1]); if (d < bd) { bd = d; best = o; } }
  if (b.area > 4000) b.cls = { fl: 2, h: 13, st: 'shed', roof: 'roof:light', trim: 'trim:grey', ph: 0.6, towers: 0, cat: 'transit', label: '' };
  else if (best) b.cls = { ...best.cls, label: '', towers: 0, special: undefined };
  else b.cls = { fl: 3, st: 'plain', roof: 'roof:light', trim: 'trim:grey', ph: 1, towers: 0, cat: 'teach', label: '' };
}
for (const b of BLD) {
  const c = b.cls; c.fh = c.fh || (FAC[c.st] ? FAC[c.st].fh : 3.6);
  b.h = c.h || c.fl * c.fh;
  if (/教学楼[ABDE]/.test(b.name)) b.parts = courtyardParts(b.p);
}
// 教学楼 A/B/D/E are courtyard blocks: long wings on the main side walls (their roof grilles show on the
// satellite tiles), end blocks across both ends and a garden court inside. Where the OSM outline juts past a
// side wall at one end (求实楼 and 求新楼, facing each other across 求真楼's forecourt) that corner is a stair tower.
// parts: [wing -v, wing +v, end -u, end +u, ...towers]; front is the u sign facing the lakeside avenue.
function courtyardParts(p) {
  const ob = obb(p), dw = 15, de = 13;
  const U = (q) => (q[0] - ob.cx) * ob.ux + (q[1] - ob.cz) * ob.uz, V = (q) => -(q[0] - ob.cx) * ob.uz + (q[1] - ob.cz) * ob.ux;
  const box = (u0, u1, v0, v1) => rectPoly(ob.cx + ob.ux * (u0 + u1) / 2 - ob.uz * (v0 + v1) / 2, ob.cz + ob.uz * (u0 + u1) / 2 + ob.ux * (v0 + v1) / 2, u1 - u0, v1 - v0, ob.ang);
  const wall = [-1, 1].map((s) => {
    let best = null;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 8 || Math.abs(((c[0] - a[0]) * ob.ux + (c[1] - a[1]) * ob.uz) / len) < 0.9) continue;
      const v = (V(a) + V(c)) / 2;
      if (v * s > 0 && (!best || len > best.len)) best = { len, v };
    }
    return best ? best.v : s * ob.W / 2;
  });
  const L2 = ob.L / 2, parts = [box(-L2, L2, wall[0], wall[0] + dw), box(-L2, L2, wall[1] - dw, wall[1]), box(-L2, -L2 + de, wall[0] + dw, wall[1] - dw), box(L2 - de, L2, wall[0] + dw, wall[1] - dw)];
  parts.court = box(-L2 + de, L2 - de, wall[0] + dw, wall[1] - dw);
  parts.front = ob.ux * -0.84 + ob.uz * -0.54 > 0 ? 1 : -1;
  parts.tw = [false, false];
  [-1, 1].forEach((s, k) => {
    const out = p.filter((q) => V(q) * s > Math.abs(wall[k]) + 2); if (!out.length) return;
    const us = out.map(U), u0 = Math.max(-L2, Math.min(...us)), u1 = Math.min(L2, Math.max(...us));
    if (u1 - u0 < 4) return;
    parts.push(s < 0 ? box(u0, u1, -ob.W / 2, wall[k]) : box(u0, u1, wall[k], ob.W / 2)); parts.tw[k] = true;
  });
  return parts;
}
const byName = (re) => BLD.find((b) => re.test(b.name));
// 求真楼 (C) is the entrance block in the middle of the row: centred between the long wings of 求实楼 and 求新楼,
// bridged to both by open corridors and facing the lakeside avenue across a forecourt (photos r21, r38).
// The OSM outline is squared off and re-centred in that gap.
const TEACH_WINGS = BLD.filter((b) => b.parts && /教学楼[BD]/.test(b.name)).flatMap((b) => b.parts);
const TEACH_C = byName(/教学楼C/);
if (TEACH_C && TEACH_WINGS.length) {
  const ob = obb(TEACH_C.p), vx = -ob.uz, vz = ob.ux, hit = (dx, dz) => Math.min(...TEACH_WINGS.map((p) => rayPoly(p, ob.cx, ob.cz, dx, dz)));
  const a = hit(vx, vz), d = hit(-vx, -vz), off = a + d < 90 ? (a - d) / 2 : 0;
  TEACH_C.p = rectPoly(ob.cx + vx * off, ob.cz + vz * off, ob.L, ob.W, ob.ang);
  TEACH_C.c = pCentroid(TEACH_C.p); TEACH_C.bb = pBox(TEACH_C.p); TEACH_C.area = Math.abs(pArea(TEACH_C.p));
}
const TEACH_FORE = (() => {
  if (!TEACH_C || !TEACH_WINGS.length) return null;
  const ob = obb(TEACH_C.p), sg = ob.ux * -0.84 + ob.uz * -0.54 > 0 ? 1 : -1, fx = ob.ux * sg, fz = ob.uz * sg, sx = -fz, sz = fx;
  const hit = (x, z, dx, dz) => Math.min(...TEACH_WINGS.map((p) => rayPoly(p, x, z, dx, dz)));
  const f0 = ob.L / 2, at = (f, s) => [ob.cx + fx * f + sx * s, ob.cz + fz * f + sz * s];
  const right = hit(...at(f0 + 3, 0), sx, sz), left = hit(...at(f0 + 3, 0), -sx, -sz);
  if (right + left > 90) return null;
  let depth = 26;
  for (const s of [right - 2, 2 - left]) depth = Math.min(depth, hit(...at(f0 + 1, s), fx, fz) + 1);
  return { ob, fx, fz, sx, sz, f0, f1: f0 + depth, right, left, at, hit };
})();
const ACADEMIC_COURTS = BLD.filter(b=>b.parts).map(b=>obb(b.p));
if (TEACH_FORE) {
  const F = TEACH_FORE, f0 = F.f0 - 12, f1 = F.f1 + 2, [cx, cz] = F.at((f0 + f1) / 2, (F.right - F.left) / 2);
  ACADEMIC_COURTS.push({ cx, cz, ux: F.fx, uz: F.fz, L: f1 - f0, W: F.right + F.left });
}
const TEACH_TREES = [];

const INFO = {
  '图书馆': { d: '江宁校区的中心建筑，正对中心广场与镜湖。主楼地上 7 层，前部为两层白色柱廊裙房与宽阔台阶，立面为灰色石材配白色边框与横向带窗。江宁校区馆面积约 2.3 万平方米，二层设借阅室与学术报告厅。', s: '层数：OpenStreetMap；面积与楼层功能：百度百科“中国药科大学图书馆”；立面：公开照片' },
  '药学博物馆': { d: '紧邻图书馆西侧的三层展馆，一面深灰石墙竖向镌刻馆名，主体为玻璃幕墙与悬挑灰色框架。馆内陈列药材标本、制药器具与药学史料。', s: '层数：OpenStreetMap；外观：百度百科配图' },
  '行政楼': { d: '位于正门内西侧，镜湖西岸。深炭灰墙板、端墙和檐口配蓝色窗带，南侧连接大礼堂与学术报告厅。', s: '位置：OpenStreetMap；外观：校园航拍与公开实景照片' },
  '会议中心': { d: '行政楼南侧，经北面的玻璃中庭与行政楼相连。中部高起的方形浅色体量是大礼堂观众厅；西南两层楼沿一道大弧线展开，底层退进为玻璃，上方挑出白色檐口；东侧朝广场是一排锯齿形玻璃门厅，东南角伸出三角形入口雨棚。体量与位置按卫星影像建模。', s: '位置：OpenStreetMap；外观：校园全景照片' },
  '学院实验楼': { d: '位于校园西北角，东临明湖，北依药用植物园西区，因两翼平面呈“A”形，常被称作“双 A 楼”。由美国 HDR 公司方案设计、南京大学建筑设计研究院完成施工图；建筑面积约 36991 平方米，地上 5 层、地下 1 层。东侧科研办公室呈弧形面向明湖，白色水平遮阳带与玻璃幕墙层层叠退；中庭有螺旋原木雕塑与竖琴形天窗。二期大楼于 2021 年 2 月通过竣工验收。', s: '搜狐《匠心独具｜探秘中国药科大学江宁校区学院实验楼》；学校基建处“已建项目”；外观：学校官网航拍' },
  '新建科研楼 A': { d: '明湖西侧近年落成的白色带状立面科研楼。学校基建处列出的近年竣工项目包括：学院实验楼二期（2021）、药学动物中心（2023）、临床药学研究中心与药物再评价中心（2025）、创新药物成药性评价中心（2025），本楼为其中之一，具体对应关系为推断。', s: '形体：卫星影像；项目清单：学校基建处“已建项目”' },
  '新建科研楼 B': { d: '灰色玻璃幕墙配白色横向框线、屋顶设备密集的科研楼，形态与基建处公布的药学动物中心照片接近（推断）。', s: '形体：卫星影像；参考：学校基建处“已建项目”照片' },
  '新建科研楼 C': { d: '白色横带配青绿色玻璃的六层科研楼，形态与基建处公布的临床药学研究中心照片接近（推断）。', s: '形体：卫星影像；参考：学校基建处“已建项目”照片' },
  '文德苑': {d:'研究生公寓四期，位于文思苑北侧。9 层弧形板楼，西端斜向西南，东端接一段南北向短翼；米色窗间墙与深棕窗带横向相间，楼前是一圈向南凸出的单层裙房和入口。',s:'学校基建处与校友会发布的实景照片；z18/z19 卫星图。层高为照片估算，非测绘数据。'},
  '一食堂': { d: '学生第一食堂，位于学生公寓区西侧。四层，深灰面砖墙面，窗间饰白色竖向条板。', s: '名称与位置：OpenStreetMap；外观参照二食堂实景照片' },
  '二食堂': { d: '学生第二食堂，四层，深灰面砖墙面配白色窗下板，转角立面有竖排“二食堂”字样；楼前常停满自行车。', s: '名称与位置：OpenStreetMap；外观：实景照片' },
  '体育馆': { d: '校园南部的综合体育馆，银灰色金属拱形屋面，正立面为带菱形桁架的玻璃幕墙。', s: '位置：OpenStreetMap；外观：实景照片' },
  '体育场': { d: '标准 400 米田径场，跑道为蓝色塑胶，西侧有白色悬挑顶棚看台；东侧另有足球场、篮球场群与六片蓝色网球场。', s: '位置：OpenStreetMap；跑道颜色与看台：卫星影像' },
  '游泳馆': { d: '原室外游泳池，游泳池改扩建项目于 2026 年 6 月 3 日通过竣工验收。此处按基建处公布的白色馆体、深色横向条带与屋顶光伏建模。', s: '学校基建处“已建项目”' },
  '药用植物园温室': { d: '药用植物园东区的展示温室，园内栽培多种药用植物，是药大最有特色的校园景观之一。', s: '位置：OpenStreetMap；简介：去哪儿网游记' },
  '实训楼': { d: '明湖东岸、药用植物园南侧的实训教学楼。', s: '位置：OpenStreetMap' },
  '综合研发楼': { d: '位于实训楼南侧，沿精业路布置的科研楼。', s: '位置：OpenStreetMap' },
};
const TEACH_DESC = '教学楼 A–E（求知、求实、求真、求新、求同）沿镜湖东侧一字排开，是公共课与考试的主要场所，也是全国硕士研究生招生考试中国药科大学考点的考场所在地。居中的求真楼面朝湖边大道，白色柱廊前立着雕像、摆着红色花箱；求实楼与求新楼的长翼在两侧夹出前院，端部楼梯塔高出屋面，三层连廊把它们和求真楼连在一起。求知、求实、求新、求同四栋各自围合一个内院。灰色立面、白色楼层线。';
const LAB_DESC = '沿校内河道西岸排列的学院科研楼，深浅灰色面砖墙面，楼梯间塔楼高出屋面，顶部为白色玻璃“灯笼”，倒映在河道中。';
const DORM_DESC = '本科生公寓按“文”字组团命名：文萃、文轩、文菁、文澜、文枢、文昌、文思、文德等苑。不同组团采用米白、砖色或灰色墙面，配白色窗框和生活阳台；北部文思苑为白色与深蓝相间立面，文德苑（研究生公寓）为米色与深棕横带。';

const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, QP.pr));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = QUALITY !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
stage.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(stage.clientWidth, stage.clientHeight);
labelRenderer.domElement.className = 'labels';
stage.appendChild(labelRenderer.domElement);
const MAXANI = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc8d4dc, 0.00016);
const camera = new THREE.PerspectiveCamera(50, stage.clientWidth / stage.clientHeight, 1.5, 26000);
camera.layers.enable(1);
camera.position.set(-760, 520, 820);
class EarthControls extends THREE.EventDispatcher {
  constructor(cam, dom) {
    super();
    Object.assign(this, { camera: cam, dom, target: new THREE.Vector3(), enabled: true, active: false, minDistance: 4, maxDistance: 1800, minPolarAngle: 0.0005, maxPolarAngle: 1.45 });
    this.offset = new THREE.Vector3(0, 1, 1); this.lift = 0; this.last = new THREE.Vector3(1e9, 0, 0);
    this.vel = new THREE.Vector3(); this.spinVel = 0; this.zoomQ = 0; this.anchor = new THREE.Vector3(); this.anchorAt = { t: 0, x: 0, y: 0 };
    this.pts = new Map(); this.drag = null; this.hist = []; this.sph = new THREE.Spherical();
    this.rc = new THREE.Raycaster(); this.nd = new THREE.Vector2();
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', (e) => this.down(e));
    dom.addEventListener('pointermove', (e) => this.move(e));
    dom.addEventListener('pointerup', (e) => this.up(e));
    dom.addEventListener('pointercancel', (e) => this.up(e));
    dom.addEventListener('lostpointercapture', (e) => this.up(e));
    dom.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    dom.addEventListener('keydown', (e) => this.key(e));
  }
  ray(x, y) { const r = this.dom.getBoundingClientRect(); this.nd.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); this.rc.setFromCamera(this.nd, this.camera); return this.rc.ray; }
  plane(x, y, h) { const ray = this.ray(x, y); if (ray.direction.y > -1e-4) return null; const t = (h - ray.origin.y) / ray.direction.y; return t > 0 && t < 9000 ? ray.at(t, new THREE.Vector3()) : null; }
  pick(x, y) {
    const ray = this.ray(x, y), g = this.plane(x, y, 0), L = g ? g.distanceTo(ray.origin) : 4000, step = Math.max(1.2, L / 700), p = new THREE.Vector3();
    for (let t = 0; t < L; t += step) {
      ray.at(t, p); if (p.y > 140) continue;
      for (const k of BGRID.at(p.x, p.z)) { const b = BLD[k]; if (p.y <= b.h && p.x >= b.bb[0] && p.x <= b.bb[2] && p.z >= b.bb[1] && p.z <= b.bb[3] && (b.parts || [b.p]).some((q) => pip(p.x, p.z, q))) return ray.at(Math.max(0, t - step / 2), new THREE.Vector3()); }
    }
    return g || ray.at(Math.min(L, 2500), new THREE.Vector3());
  }
  dist() { return this.offset.length(); }
  begin() { if (!this.active) { this.active = true; this.dispatchEvent({ type: 'start' }); } }
  finish() { if (this.active && !this.pts.size) { this.active = false; this.dispatchEvent({ type: 'end' }); } }
  write() {
    const c = this.camera;
    c.position.copy(this.target).add(this.offset); c.position.y += this.lift;
    c.lookAt(this.target); c.updateMatrixWorld(); this.last.copy(c.position);
  }
  resync() { if (this.camera.position.distanceToSquared(this.last) > 1e-6) { this.offset.copy(this.camera.position).sub(this.target); this.lift = 0; this.last.copy(this.camera.position); } }
  rotate(da, dp, pivot) {
    this.sph.setFromVector3(this.offset); this.sph.theta += da; this.sph.phi = clamp(this.sph.phi + dp, this.minPolarAngle, this.maxPolarAngle); this.offset.setFromSpherical(this.sph);
    if (pivot && da) { const v = this.target.clone().sub(pivot).applyAxisAngle(_Y, da); this.target.copy(pivot).add(v); }
  }
  zoomAbout(A, k) {
    const d = this.dist(); k = clamp(k, this.minDistance / d, this.maxDistance / d);
    this.target.sub(A).multiplyScalar(k).add(A); this.offset.multiplyScalar(k);
  }
  down(e) {
    if (!this.enabled) return;
    if (e.button === 1) e.preventDefault();
    this.resync(); try { this.dom.setPointerCapture(e.pointerId); } catch (_) { }
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, m: e.ctrlKey || e.metaKey || e.shiftKey || e.altKey });
    this.vel.set(0, 0, 0); this.spinVel = 0; this.zoomQ = 0; this.begin(); this.start();
  }
  start() {
    const P = [...this.pts.values()];
    if (P.length >= 2) {
      const [a, b] = P, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, G = this.pick(mx, my);
      this.drag = { type: 'multi', mx, my, dist: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), G, h: clamp(G.y, 0, 80), mode: null, acc: 0 };
    } else if (P.length === 1) {
      const a = P[0];
      if (a.b === 1 || a.b === 2 || a.m) this.drag = { type: 'rotate', x: a.x, y: a.y };
      else { const G = this.pick(a.x, a.y); this.drag = { type: 'pan', G, h: clamp(G.y, 0, 80) }; }
    } else this.drag = null;
    this.hist = [];
  }
  panTo(G, h, x, y) {
    const P = this.plane(x, y, h); if (!P) return;
    const d = G.clone().sub(P); d.y = 0; const lim = Math.max(30, this.dist() * 0.7); if (d.length() > lim) d.setLength(lim);
    this.target.add(d); this.hist.push({ t: performance.now(), d }); if (this.hist.length > 12) this.hist.shift();
  }
  move(e) {
    const q = this.pts.get(e.pointerId); if (!q || !this.drag || !this.enabled) return;
    const px = q.x, py = q.y; q.x = e.clientX; q.y = e.clientY;
    const D = this.drag, r = this.dom.getBoundingClientRect();
    if (D.type === 'pan') this.panTo(D.G, D.h, q.x, q.y);
    else if (D.type === 'rotate') {
      const da = -(q.x - px) / r.width * Math.PI * 0.85, dp = -(q.y - py) / r.height * Math.PI * 0.55;
      this.rotate(da, dp); this.spinVel = this.spinVel * 0.5 + da / Math.max(1e-3, (e.timeStamp - (D.t || e.timeStamp - 16)) / 1000) * 0.5; D.t = e.timeStamp;
    } else if (D.type === 'multi') {
      const [a, b] = [...this.pts.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dist = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      const dmy = my - D.my, dmx = mx - D.mx, dd = dist - D.dist; let da = ang - D.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      if (!D.mode) {
        D.acc += Math.abs(dmy) + Math.abs(dmx) + Math.abs(dd) + Math.abs(da) * dist * 0.5;
        if (D.acc > 10) D.mode = Math.abs(dmy) > 2 * Math.abs(dmx) && Math.abs(dd) < Math.abs(dmy) * 0.5 && Math.abs(da) * dist < Math.abs(dmy) && Math.abs(Math.sin(ang)) < 0.6 ? 'tilt' : 'pinch';
      }
      if (D.mode === 'tilt') this.rotate(0, -dmy / r.height * Math.PI * 0.6);
      else if (D.mode === 'pinch') {
        if (dist > 1) this.zoomAbout(D.G, D.dist / dist);
        this.rotate(da, 0, D.G);
        this.write(); this.panTo(D.G, D.h, mx, my);
      }
      Object.assign(D, { mx, my, dist, ang });
    }
    this.write(); this.dispatchEvent({ type: 'change' });
  }
  up(e) {
    if (!this.pts.has(e.pointerId)) return;
    this.pts.delete(e.pointerId);
    if (this.drag && this.drag.type === 'pan' && !this.pts.size) {
      const now = performance.now(), recent = this.hist.filter((h) => now - h.t < 110), last = recent[recent.length - 1];
      if (recent.length >= 3 && now - last.t < 45) { const sum = recent.reduce((v, h) => v.add(h.d), new THREE.Vector3()), span = Math.max(50, last.t - recent[0].t + 16); this.vel.copy(sum).multiplyScalar(1000 / span); this.vel.multiplyScalar(0.6); if (this.vel.length() > this.dist() * 0.6) this.vel.setLength(this.dist() * 0.6); }
    }
    if (this.drag && this.drag.type === 'rotate' && e.timeStamp - (this.drag.t || 0) > 80) this.spinVel = 0;
    this.start(); this.finish();
  }
  wheel(e) {
    if (!this.enabled) return;
    e.preventDefault(); this.resync();
    let dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1); dy = clamp(dy, -250, 250);
    const now = performance.now();
    if (now - this.anchorAt.t > 220 || Math.hypot(e.clientX - this.anchorAt.x, e.clientY - this.anchorAt.y) > 6) { this.anchor.copy(this.pick(e.clientX, e.clientY)); this.anchorAt = { t: now, x: e.clientX, y: e.clientY }; }
    else this.anchorAt.t = now;
    this.zoomQ += dy * (e.ctrlKey ? 0.004 : 0.0011); this.vel.set(0, 0, 0); this.spinVel = 0;
    this.dispatchEvent({ type: 'start' });
  }
  key(e) {
    if (!this.enabled) return;
    const fw = new THREE.Vector3(-this.offset.x, 0, -this.offset.z).normalize(), rt = new THREE.Vector3(-fw.z, 0, fw.x), s2 = this.dist() * 0.08;
    const m = { ArrowUp: [fw, s2], ArrowDown: [fw, -s2], ArrowLeft: [rt, -s2], ArrowRight: [rt, s2] }[e.code];
    if (m) { this.resync(); this.vel.addScaledVector(m[0], m[1] * 4); e.preventDefault(); this.dispatchEvent({ type: 'start' }); }
    else if (e.key === '+' || e.key === '=' || e.key === '-') { this.resync(); this.anchor.copy(this.target); this.zoomQ += e.key === '-' ? 0.35 : -0.35; this.dispatchEvent({ type: 'start' }); }
  }
  update(dt) {
    if (!this.enabled) return;
    dt = Math.min(dt || 0.016, 0.05); this.resync();
    if (!this.drag) {
      if (this.vel.lengthSq() > 1e-3) { this.target.addScaledVector(this.vel, dt); this.vel.multiplyScalar(Math.exp(-dt * 6)); } else this.vel.set(0, 0, 0);
      if (Math.abs(this.spinVel) > 1e-3) { this.rotate(this.spinVel * dt * 0.5, 0); this.spinVel *= Math.exp(-dt * 7); } else this.spinVel = 0;
    }
    if (Math.abs(this.zoomQ) > 1e-4) { const st = this.zoomQ * (1 - Math.exp(-dt * 11)); this.zoomQ -= st; this.zoomAbout(this.anchor, Math.exp(st)); } else this.zoomQ = 0;
    this.sph.setFromVector3(this.offset); this.sph.phi = clamp(this.sph.phi, this.minPolarAngle, this.maxPolarAngle); this.sph.radius = clamp(this.sph.radius, this.minDistance, this.maxDistance); this.offset.setFromSpherical(this.sph);
    const t = this.target; t.x = clamp(t.x, -700, 870); t.z = clamp(t.z, -1060, 845); t.y = clamp(t.y, 0, 60);
    const bx = t.x + this.offset.x, by = t.y + this.offset.y, bz = t.z + this.offset.z, want = Math.max(0, camFloor(bx, bz) - by);
    this.lift += (want - this.lift) * Math.min(1, dt * (want > this.lift ? 16 : 3.5));
    this.write();
  }
}
const controls = new EarthControls(camera, renderer.domElement);
controls.target.set(-120, 0, -150);
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', '三维校园地图：拖动平移，右键或 Ctrl 加拖动旋转与倾斜，滚轮缩放，方向键平移');
for (const ev of ['contextmenu', 'selectstart', 'dragstart']) on(root, ev, (e) => { if (!e.target.closest?.('input, textarea')) e.preventDefault(); });
for (const ev of ['gesturestart', 'gesturechange']) on(root, ev, (e) => e.preventDefault());
on(root, 'touchstart', (e) => { if (e.touches.length > 1 && !e.target.closest?.('canvas')) e.preventDefault(); }, { passive: false });
controls.addEventListener('start', () => { camera.userData.reviewLock = false; tween = null; spin = null; if (mode === 'tour') setMode('orbit'); });
renderer.domElement.addEventListener('keydown', () => { spin = null; });

const sunLight = new THREE.DirectionalLight(0xffffff, 3);
sunLight.castShadow = renderer.shadowMap.enabled;
sunLight.shadow.mapSize.set(QP.shadow, QP.shadow);
sunLight.shadow.bias = -0.00025; sunLight.shadow.normalBias = 0.6;
sunLight.shadow.camera.layers.enable(1); sunLight.shadow.camera.layers.enable(2);
scene.add(sunLight, sunLight.target);
const hemi = new THREE.HemisphereLight(0xbcd3ea, 0x5d5a48, 1.0);
scene.add(hemi);

const uTime = { value: 0 };
const NIGHT_MATS = [];
const NO_AO = [];
let composer = null, gtaoPass = null, bloomPass = null, gradePass = null;
const viewPR = Math.min(devicePixelRatio || 1, QP.pr);
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.08 }, uCon: { value: 1.06 }, uVig: { value: 0.1 }, uLift: { value: new THREE.Vector3(0.006, 0.008, 0.012) }, uGain: { value: new THREE.Vector3(1.0, 1.0, 1.0) }, uGrain: { value: 0.002 }, uT: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 900) }, uSharp: { value: 0.7 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uCon, uVig, uGrain, uT, uSharp; uniform vec2 uTexel; uniform vec3 uLift, uGain; varying vec2 vUv;
    float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uT) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb;
      vec3 sn = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb, ss = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      vec3 se = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb, sw = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
      vec3 mn = min(min(min(sn, ss), min(se, sw)), col), mx = max(max(max(sn, ss), max(se, sw)), col);
      vec3 wgt = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0)) * (-1.0 / mix(8.0, 5.0, uSharp));
      col = clamp((col + (sn + ss + se + sw) * wgt) / (1.0 + 4.0 * wgt), 0.0, 1.0);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uCon + 0.5;
      col = col * uGain + uLift * (1.0 - col);
      vec2 d = vUv - 0.5; col *= 1.0 - uVig * smoothstep(0.18, 0.75, dot(d, d) * 2.0);
      col += (hh(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};
function initComposer() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const rt = new THREE.WebGLRenderTarget(w * viewPR, h * viewPR, { type: THREE.HalfFloatType, samples: QUALITY === 'low' ? 2 : 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  if (QUALITY !== 'low') {
    gtaoPass = new GTAOPass(scene, camera, w, h);
    gtaoPass.updateGtaoMaterial({ radius: 4.5, distanceExponent: 1.5, thickness: 2.5, scale: 1.25, samples: 8, distanceFallOff: 1.0, screenSpaceRadius: false });
    gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 8 });
    // occlusion is soft and low-frequency: work out normals, AO and denoise at half resolution, blend at full
    const sz0 = gtaoPass.setSize.bind(gtaoPass);
    gtaoPass.setSize = (w2, h2) => sz0(Math.max(1, Math.round(w2 / 2)), Math.max(1, Math.round(h2 / 2)));
    gtaoPass.blendIntensity = 0.9;
    const r0 = gtaoPass.render.bind(gtaoPass);
    gtaoPass.render = (...a) => { const hid = []; for (const o of NO_AO) if (o.visible) { o.visible = false; hid.push(o); } r0(...a); for (const o of hid) o.visible = true; };
    composer.addPass(gtaoPass);
  }
  bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.14, 0.5, 0.96);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  gradePass = new ShaderPass(GradeShader); composer.addPass(gradePass); gradePass.uniforms.uTexel.value.set(1 / (w * viewPR), 1 / (h * viewPR));
  composer.setPixelRatio(viewPR); composer.setSize(w, h);
}
function setViewSize(w, h, pr, style = true) {
  renderer.setPixelRatio(pr); renderer.setSize(w, h, style);
  if (composer) { composer.setPixelRatio(pr); composer.setSize(w, h); gradePass.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr)); }
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
const PERF = { lvl: 0, acc: 0, n: 0 };
function setPerf(l) {
  PERF.lvl = l;
  if (l >= 2 && sunLight.shadow.mapSize.x > 2048) { sunLight.shadow.map?.dispose(); sunLight.shadow.map = null; sunLight.shadow.mapSize.set(2048, 2048); }
  if (l >= 3 && waterObj && waterObj.visible) setWaterReflect(false);
}
function trackPerf(dt) {
  if (FILMING) return;
  PERF.acc += dt; PERF.n++;
  if (PERF.acc > 2.5) { const avg = PERF.acc / PERF.n; if (avg > (TOUCH || REDUCED_MOTION.matches ? 0.055 : 0.036) && PERF.lvl < 3) setPerf(PERF.lvl + 1); PERF.acc = 0; PERF.n = 0; }
}
let shadowStamp = 0, shadowDirty = true;
renderer.info.autoReset = false;
function updateNear() {
  const n = mode === 'walk' ? 0.15 : clamp(camera.position.y * 0.006, 1, 5);
  if (Math.abs(camera.near - n) > 0.04) { camera.near = n; camera.updateProjectionMatrix(); }
}
function renderFrame() {
  renderer.info.reset();
  updateNear();
  const now = performance.now();
  renderer.shadowMap.needsUpdate = FILMING || shadowDirty || now - shadowStamp > 120;
  if (renderer.shadowMap.needsUpdate) { shadowStamp = now; shadowDirty = false; }
  if (composer) {
    gradePass.uniforms.uT.value = (gradePass.uniforms.uT.value + 0.37) % 10;
    bloomPass.enabled = NIGHT > 0.15;
    if (gtaoPass) gtaoPass.enabled = FILMING || PERF.lvl < 1;
    composer.render();
  } else renderer.render(scene, camera);
}

function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, srgb = true, rep = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAXANI; t.needsUpdate = true;
  return t;
}
function speckle(g, x, y, w, h, n, a) {
  for (let i = 0; i < n; i++) {
    const v = rand() * a; g.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${v})`;
    g.fillRect(x + rand() * w, y + rand() * h, 1 + rand() * 2.5, 1 + rand() * 2.5);
  }
}
function valueNoise(N, cells, oct, seed) {
  const r = mulberry(seed), out = new Float32Array(N * N);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const C = cells << o, lat = new Float32Array(C * C); for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / N * C, fy = y / N * C, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = lat[iy % C * C + ix % C], b = lat[iy % C * C + (ix + 1) % C], c = lat[(iy + 1) % C * C + ix % C], d = lat[(iy + 1) % C * C + (ix + 1) % C];
      out[y * N + x] += amp * lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function noiseCanvas(N, cells, oct, seed, lo = 0, hi = 255) {
  const v = valueNoise(N, cells, oct, seed), c = mkCanvas(N, N), g = c.getContext('2d'), im = g.createImageData(N, N);
  for (let i = 0; i < v.length; i++) { const k = lo + (hi - lo) * v[i]; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = k; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0); return c;
}

const LITC = ['#ffd49a', '#ffe2b0', '#fff0d2', '#ffc98a', '#e4efff', '#ffe9c4', '#fff6e6'];
function glassRect(g, x, y, w, h, c1, c2) {
  const gr = g.createLinearGradient(x, y, x + w * 0.5, y + h); gr.addColorStop(0, c2); gr.addColorStop(1, c1);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.moveTo(x + w * 0.2, y); g.lineTo(x + w * 0.5, y); g.lineTo(x + w * 0.2, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h * 0.65); g.closePath(); g.fill();
}
function win(cx, x, y, w, h, o, lit) {
  const { g, m, e, hh } = cx;
  if (o.frame) { g.fillStyle = o.frame; g.fillRect(x - o.fw, y - o.fw, w + o.fw * 2, h + o.fw * 2); hh.fillStyle = '#d0d0d0'; hh.fillRect(x - o.fw, y - o.fw, w + o.fw * 2, h + o.fw * 2); }
  glassRect(g, x, y, w, h, o.c1 || '#2c3a45', o.c2 || '#506272');
  hh.fillStyle = '#3a3a3a'; hh.fillRect(x, y, w, h);
  if (o.mull) { g.fillStyle = o.mull; hh.fillStyle = '#707070'; for (let k = 1; k < o.mn; k++) { g.fillRect(x + w * k / o.mn - 1, y, 2, h); hh.fillRect(x + w * k / o.mn - 1, y, 2, h); } if (o.tr) { g.fillRect(x, y + h * o.tr, w, 2); hh.fillRect(x, y + h * o.tr, w, 2); } }
  hh.fillStyle = 'rgba(0,0,0,.35)'; hh.fillRect(x, y, w, 3);
  m.fillStyle = 'rgb(0,92,40)'; m.fillRect(x, y, w, h);
  if (rand() < lit) {
    e.fillStyle = pick(LITC); e.globalAlpha = rr(0.55, 1); e.fillRect(x, y, w, h);
    if (rand() < 0.45) { e.globalAlpha = 1; e.fillStyle = 'rgba(0,0,0,.5)'; e.fillRect(x, y + h * rr(0.15, 0.6), w, h); }
    e.globalAlpha = 1;
  }
}
let WALL_H = null;
function wall(g, col, tile, n = 1800) {
  g.fillStyle = col; g.fillRect(0, 0, 512, 256); speckle(g, 0, 0, 512, 256, n, 0.07);
  if (tile) {
    g.fillStyle = 'rgba(255,255,255,.06)';
    for (let y = 0; y < 256; y += tile) g.fillRect(0, y, 512, 1);
    g.fillStyle = 'rgba(0,0,0,.06)';
    for (let y = 0; y < 256; y += tile) for (let x = ((y / tile) % 2) * tile; x < 512; x += tile * 2) g.fillRect(x, y, 1, tile);
    if (WALL_H) { WALL_H.fillStyle = '#8a8a8a'; for (let y = 0; y < 256; y += tile) WALL_H.fillRect(0, y, 512, 0.8); for (let y = 0; y < 256; y += tile) for (let x = ((y / tile) % 2) * tile; x < 512; x += tile * 2) WALL_H.fillRect(x, y, 0.8, tile); }
  }
}
function heightToNormal(hc, k) {
  const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data, oc = mkCanvas(w, h), og = oc.getContext('2d'), out = og.createImageData(w, h), d = out.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = -(H(x + 1, y) - H(x - 1, y)) * k, ny = (H(x, y + 1) - H(x, y - 1)) * k, l = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
    d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  og.putImageData(out, 0, 0); return oc;
}
function drawFacade(name, cx) {
  const { g } = cx, L = FAC[name].lit;
  const cell = (fn) => { for (let f = 0; f < 4; f++) for (let b = 0; b < 8; b++) fn(b * 64, f * 64, b, f); };
  switch (name) {
    case 'ribbonGlass': wall(g, '#45575b', 0, 180); cell((x, y) => { win(cx, x + 1, y + 1, 62, 62, { c1: '#33474c', c2: '#72878c', mull: '#9daeb1', mn: 1, tr: 0.72 }, L); }); break;
    case 'lab': wall(g, '#8b8e91', 16); cell((x, y) => { g.fillStyle = '#e3e1dc'; g.fillRect(x, y + 56, 64, 8); cx.hh.fillStyle = '#f0f0f0'; cx.hh.fillRect(x, y + 56, 64, 8); win(cx, x + 4, y + 12, 56, 36, { c1: '#26333d', c2: '#4c5e6c', mull: '#9da2a6', mn: 3 }, L); }); break;
    case 'teach': wall(g, '#858789', 8, 2400); cell((x, y) => { win(cx, x + 10, y + 12, 44, 34, { c1: '#334a59', c2: '#718697', mull: '#deded6', mn: 3, fw: 2, frame: '#c9cbc7' }, L); g.fillStyle = '#aaaead'; g.fillRect(x, y + 58, 64, 2); }); break;
    case 'library': wall(g, '#6f7378', 32); cell((x, y) => { g.fillStyle = '#e8e7e2'; g.fillRect(x, y + 54, 64, 10); win(cx, x + 1, y + 12, 62, 34, { c1: '#26333e', c2: '#4a5d6c', mull: '#c9ccce', mn: 3 }, L); }); break;
    case 'admin': wall(g, '#b7b9b8', 32, 1200); cell((x, y) => { g.fillStyle = '#efefeb'; g.fillRect(x, y, 8, 64); win(cx, x + 18, y + 8, 38, 46, { c1: '#283442', c2: '#4b5c6e', mull: '#a9b0b6', mn: 2, tr: 0.7 }, L); }); break;
    case 'dorm': wall(g, '#5e6266', 8); cell((x, y, b) => { win(cx, x + 18, y + 14, 28, 32, { frame: '#e8e8e4', fw: 4, c1: '#2b333b', c2: '#56636e', mull: '#e8e8e4', mn: 2 }, L); if (b % 2 === 0) { g.fillStyle = '#e6e6e2'; g.fillRect(x + 20, y + 52, 24, 9); g.fillStyle = '#c9c9c4'; for (let k = 0; k < 4; k++) g.fillRect(x + 22 + k * 6, y + 54, 3, 5); } }); break;
    case 'dormStripe': wall(g, '#27394f', 0, 900); cell((x, y) => { g.fillStyle = '#edeeea'; g.fillRect(x, y, 64, 24); speckle(g, x, y, 64, 24, 30, 0.05); win(cx, x + 7, y + 31, 50, 26, { c1: '#3f5469', c2: '#7d95ab', mull: '#dfe3e6', mn: 3 }, L); }); break;
    case 'canteen': {
      g.fillStyle = '#65686b'; g.fillRect(0, 0, 512, 256);
      for (let y = 0; y < 256; y += 6) for (let x = (y / 6 % 2) * 7; x < 512; x += 14) { g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},${rr(0.02, 0.09)})`; g.fillRect(x, y, 13, 5); }
      g.fillStyle = 'rgba(140,142,144,.35)'; for (let y = 5; y < 256; y += 6) g.fillRect(0, y, 512, 1);
      cell((x, y) => { win(cx, x + 22, y + 6, 20, 42, { frame: '#9a9c9e', fw: 1, c1: '#262c31', c2: '#4a535a' }, L); g.fillStyle = '#efefea'; g.fillRect(x + 22, y + 50, 20, 12); });
      break;
    }
    case 'labw': wall(g, '#f0f1ee', 0, 600); cell((x, y) => { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, y + 14, 64, 2); win(cx, x, y + 16, 64, 48, { c1: '#33414c', c2: '#5d6d79', mull: '#b8bdc1', mn: 2 }, L); g.fillStyle = '#f0f1ee'; g.fillRect(x, y, 64, 14); }); break;
    case 'whiteGreen': wall(g, '#eff0ec', 0, 600); cell((x, y) => { win(cx, x, y + 16, 64, 48, { c1: '#2d5852', c2: '#5d8b83', mull: '#d4d9d8', mn: 2 }, L); g.fillStyle = '#eff0ec'; g.fillRect(x, y, 64, 15); }); break;
    case 'glass': wall(g, '#5b7a83', 0, 300); cell((x, y) => { win(cx, x, y, 64, 64, { c1: '#3f5f68', c2: '#87a5ad', mull: '#d4d9db', mn: 2, tr: 0.62 }, L); g.fillStyle = '#d4d9db'; g.fillRect(x, y, 64, 2); g.fillRect(x, y, 2, 64); }); break;
    case 'glassGrey': wall(g, '#e5e6e3', 0, 400); cell((x, y) => { win(cx, x + 2, y + 8, 60, 54, { c1: '#353f48', c2: '#6c7883', mull: '#c3c8cb', mn: 3 }, L); }); break;
    case 'plain': wall(g, '#c3beb3', 0); cell((x, y) => win(cx, x + 18, y + 14, 28, 32, { frame: '#ebe9e3', fw: 2, c1: '#36404a', c2: '#5d6a74', mull: '#ebe9e3', mn: 2 }, L)); break;
    case 'beigeBand': wall(g, '#b6977a', 0, 900); cell((x, y) => { g.fillStyle = '#ddcdb0'; g.fillRect(x, y, 64, 20); win(cx, x + 6, y + 27, 52, 30, { c1: '#3a4651', c2: '#6f7f8c', mull: '#e6e0d4', mn: 3 }, L); }); break;
    // 文德苑：每层一条米色窗间墙，下面是深棕窗带；窗间每隔几跨夹白色空调百叶或木纹板（r01.jpg）
    case 'wende': case 'wendeSolid': wall(g, '#4a403a', 0, 900); cell((x, y, b) => {
      g.fillStyle = '#d6c4a2'; g.fillRect(x, y, 64, 21); speckle(g, x, y, 64, 21, 24, 0.04); cx.hh.fillStyle = '#c4c4c4'; cx.hh.fillRect(x, y, 64, 21);
      g.fillStyle = '#342c27'; g.fillRect(x, y + 21, 64, 2);
      if (name === 'wendeSolid') return;
      const louver = b % 4 === 1, timber = b % 4 === 3, ww = louver || timber ? 38 : 56;
      win(cx, x + 4, y + 30, ww, 27, { c1: '#2d3a40', c2: '#677b84', mull: '#60767b', mn: louver || timber ? 2 : 3 }, L);
      if (louver) { g.fillStyle = '#e4e4e0'; g.fillRect(x + 46, y + 27, 14, 33); g.fillStyle = 'rgba(0,0,0,.2)'; for (let k = 2; k < 33; k += 3) g.fillRect(x + 46, y + 27 + k, 14, 1); }
      if (timber) { g.fillStyle = '#7b5844'; g.fillRect(x + 46, y + 28, 14, 31); g.fillStyle = 'rgba(0,0,0,.22)'; for (let k = 1; k < 14; k += 2) g.fillRect(x + 46 + k, y + 28, 1, 31); }
    }); break;
    case 'wendePodium': wall(g, '#d6c4a2', 0, 600); cell((x, y) => { g.fillStyle = '#4a403a'; g.fillRect(x, y + 11, 64, 9); win(cx, x + 7, y + 23, 57, 41, { c1: '#2b3c41', c2: '#5e7780', mull: '#2e4749', mn: 3, tr: 0.72 }, L); g.fillStyle = '#3d3530'; g.fillRect(x, y + 20, 7, 44); }); break;
    case 'podium': wall(g, '#eeeeea', 0, 300); cell((x, y) => { win(cx, x + 11, y + 2, 53, 62, { c1: '#2e3d48', c2: '#5c7080', mull: '#dfe2e3', mn: 3, tr: 0.75 }, L); g.fillStyle = '#f2f2ee'; g.fillRect(x, y, 11, 64); }); break;
    case 'shed': g.fillStyle = '#b7bbbe'; g.fillRect(0, 0, 512, 256); for (let x = 0; x < 512; x += 8) { g.fillStyle = 'rgba(0,0,0,.1)'; g.fillRect(x, 0, 2, 256); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + 3, 0, 1, 256); } cell((x, y, b, f) => { if (f % 2 === 0 && b % 2 === 0) win(cx, x + 6, y + 4, 52, 10, { c1: '#3a4651', c2: '#6f7f8c' }, L); }); break;
    case 'city': wall(g, '#d9d4ca', 0); cell((x, y) => { win(cx, x + 12, y + 16, 40, 28, { c1: '#3a4651', c2: '#6f7f8c', mull: '#f0eee8', mn: 3 }, L); g.fillStyle = '#f2f0ea'; g.fillRect(x, y + 46, 64, 6); }); break;
    case 'cityB': wall(g, '#ad7f68', 8); cell((x, y) => { win(cx, x + 14, y + 16, 36, 28, { frame: '#efe9e0', fw: 2, c1: '#3a4651', c2: '#6f7f8c', mull: '#efe9e0', mn: 2 }, L); g.fillStyle = '#e9e2d6'; g.fillRect(x, y + 48, 64, 5); }); break;
    case 'cityG': wall(g, '#c9ccce', 0); cell((x, y) => { win(cx, x + 4, y + 12, 56, 32, { c1: '#2d3c4a', c2: '#62798c', mull: '#e8eaeb', mn: 4 }, L); g.fillStyle = '#e8eaeb'; g.fillRect(x, y + 48, 64, 6); }); break;
    case 'cityW': wall(g, '#ebe9e3', 0); cell((x, y) => { win(cx, x + 8, y + 14, 48, 32, { c1: '#34404b', c2: '#6c7c89', mull: '#c9ccc9', mn: 4 }, L); g.fillStyle = '#c9ccc9'; g.fillRect(x, y + 50, 64, 3); }); break;
    case 'villa': wall(g, '#e6dcc6', 0); cell((x, y, b) => { if (b % 3 !== 1) win(cx, x + 20, y + 16, 24, 32, { frame: '#6b4b33', fw: 3, c1: '#36404a', c2: '#61707b', mull: '#6b4b33', mn: 2 }, L); }); break;
    case 'stone': wall(g, '#575b5f', 0, 2500); g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 512, 1); for (let x = 0; x < 512; x += 64) g.fillRect(x, 0, 1, 256); break;
    case 'adminDark': wall(g, '#6c7178', 32, 2200); cell((x, y, b) => { g.fillStyle = '#5c626a'; g.fillRect(x, y, 6, 64); cx.hh.fillStyle = '#e0e0e0'; cx.hh.fillRect(x, y, 6, 64); g.fillStyle = '#43474d'; g.fillRect(x, y + 54, 64, 10); win(cx, x + 10, y + 6, 22, 46, { c1: '#21364f', c2: '#4d6f96', mull: '#6c737b', mn: 1, tr: 0.75 }, L); win(cx, x + 36, y + 6, 22, 46, { c1: '#21364f', c2: '#4d6f96', mull: '#6c737b', mn: 1, tr: 0.75 }, L); }); break;
    case 'libStone': wall(g, '#a69d96', 16, 2200); cell((x, y, b) => { if (b % 4 === 3) { g.fillStyle = '#9c938c'; g.fillRect(x, y, 64, 64); win(cx, x + 24, y + 8, 16, 44, { c1: '#26323c', c2: '#55697a', mull: '#8d8f8e', mn: 1, tr: 0.6 }, L); return; } g.fillStyle = '#b3aba3'; g.fillRect(x, y, 6, 64); cx.hh.fillStyle = '#ffffff'; cx.hh.fillRect(x, y, 6, 64); g.fillStyle = '#978f88'; g.fillRect(x, y + 52, 64, 12); win(cx, x + 8, y + 8, 54, 42, { c1: '#26323c', c2: '#55697a', mull: '#7f8384', mn: 3, tr: 0.62 }, L); }); break;
    case 'libPodium': wall(g, '#c6beb1', 0, 1200); cell((x, y, b) => { g.fillStyle = '#cfc8bc'; g.fillRect(x, y, 14, 64); cx.hh.fillStyle = '#ffffff'; cx.hh.fillRect(x, y, 14, 64); win(cx, x + 16, y + 2, 46, 60, { c1: '#2a3843', c2: '#5a6e7d', mull: '#9a9d9e', mn: 2, tr: 0.7 }, L); }); break;
    case 'labDark': wall(g, '#666b70', 0, 1400); cell((x, y) => { g.fillStyle = '#585d62'; g.fillRect(x, y + 50, 64, 14); win(cx, x + 2, y + 6, 60, 42, { c1: '#2a3640', c2: '#5b6b78', mull: '#7c8288', mn: 3 }, L); }); break;
    case 'dormWhite': wall(g, '#e7e4dc', 0, 1300); cell((x, y, b) => { g.fillStyle = '#d4d1c9'; g.fillRect(x, y + 58, 64, 6); win(cx, x + 16, y + 12, 32, 34, { frame: '#5d6166', fw: 3, c1: '#2c343c', c2: '#5a6772', mull: '#5d6166', mn: 2 }, L); if (b % 2 === 0) { g.fillStyle = '#ffffff'; g.fillRect(x + 12, y + 46, 40, 10); cx.hh.fillStyle = '#ffffff'; cx.hh.fillRect(x + 12, y + 46, 40, 10); g.fillStyle = '#9aa0a5'; for (let k = 0; k < 8; k++) g.fillRect(x + 14 + k * 5, y + 47, 1.5, 8); } }); break;
    case 'dormBeige': wall(g, '#d6bf9b', 0, 1600); cell((x, y, b) => { g.fillStyle = '#efe8db'; g.fillRect(x, y + 52, 64, 12); cx.hh.fillStyle = '#e8e8e8'; cx.hh.fillRect(x, y + 52, 64, 12); win(cx, x + 16, y + 10, 32, 36, { frame: '#f1ede4', fw: 3, c1: '#2d353d', c2: '#5c6974', mull: '#f1ede4', mn: 2 }, L); }); break;
    case 'confDark': wall(g, '#5a5f66', 32, 1400); cell((x, y) => { g.fillStyle = '#676c73'; g.fillRect(x, y, 12, 64); cx.hh.fillStyle = '#ffffff'; cx.hh.fillRect(x, y, 12, 64); win(cx, x + 14, y + 4, 50, 56, { c1: '#203348', c2: '#4a6a8c', mull: '#70777f', mn: 2, tr: 0.7 }, L); }); break;
    case 'stoneGrey': wall(g, '#a9aaa7', 32, 1600); cell((x, y, b, f) => { if (f % 2 === 0) win(cx, x + 4, y + 20, 56, 22, { c1: '#2c3640', c2: '#5d6b77', mull: '#8c9094', mn: 3 }, L); }); break;
    default: wall(g, '#bbbbbb', 0);
  }
}
const MAT = {};
function facadeMat(name) {
  const S2 = QUALITY === 'low' ? 1 : 2, c = mkCanvas(512 * S2, 256 * S2), m = mkCanvas(512, 256), e = mkCanvas(512, 256), hc = mkCanvas(512, 256);
  const cx = { g: c.getContext('2d'), m: m.getContext('2d'), e: e.getContext('2d'), hh: hc.getContext('2d') };
  cx.g.scale(S2,S2);
  cx.m.fillStyle = 'rgb(0,225,0)'; cx.m.fillRect(0, 0, 512, 256);
  cx.e.fillStyle = '#000'; cx.e.fillRect(0, 0, 512, 256);
  cx.hh.fillStyle = '#b4b4b4'; cx.hh.fillRect(0, 0, 512, 256);
  WALL_H = cx.hh; drawFacade(name, cx); WALL_H = null;
  const orm = canvasTex(m, false), nm = canvasTex(heightToNormal(hc, 2.2), false);
  const mat = new THREE.MeshStandardMaterial({ map: canvasTex(c), roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, normalMap: nm, normalScale: new THREE.Vector2(0.23, 0.23), emissive: 0xffffff, emissiveIntensity: 0 });
  mat.userData.nightMap=canvasTex(e);
  mat.userData.facade = true;
  NIGHT_MATS.push({ m: mat, k: 1.4 });
  const f = FAC[name];
  return facadeRelief(mat, canvasTex(hc, false), f ? [1 / (f.bw * 8), 1 / (f.fh * 4)] : [1 / 32, 1 / 16]);
}
// Parallax occlusion on facades: the height canvas (frames light, glass dark) is marched along the view ray, so
// windows sit back behind their frames and mullions instead of being painted on a flat wall. Walls are vertical,
// so the tangent frame is the wall direction and up; the u direction's sign comes from screen-space derivatives.
function facadeRelief(mat, hTex, uvPerM) {
  const N1 = String.fromCharCode(10);
  mat.customProgramCacheKey = () => 'facadeRelief';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPomH = { value: hTex }; sh.uniforms.uUvPerM = { value: new THREE.Vector2(...uvPerM) };
    sh.uniforms.uPom = RELIEF_U;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + N1 + 'varying float vWY; varying vec3 vPomW; varying vec3 vPomN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + N1 + 'vec4 pomW4 = modelMatrix * vec4(transformed, 1.0); vWY = pomW4.y; vPomW = pomW4.xyz; vPomN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + N1 + 'varying float vWY; varying vec3 vPomW; varying vec3 vPomN; uniform sampler2D uPomH; uniform vec2 uUvPerM; uniform float uPom;' + N1 +
      '#if __VERSION__ >= 300' + N1 + '#define POM_TEX(t, u, a, b) textureGrad(t, u, a, b)' + N1 + '#else' + N1 + '#define POM_TEX(t, u, a, b) texture2D(t, u)' + N1 + '#endif' + N1 +
      'float pomDepth(vec2 u, vec2 a, vec2 b) { return clamp((0.72 - POM_TEX(uPomH, u, a, b).r) * 2.0, 0.0, 1.0); }')
      .replace('void main() {', `void main() {
  vec2 pomUv = vMapUv;
  vec3 pq0 = dFdx(vPomW), pq1 = dFdy(vPomW); vec2 ps0 = dFdx(vMapUv), ps1 = dFdy(vMapUv);
  vec3 pV = cameraPosition - vPomW; float pd = length(pV);
  vec3 pN = normalize(vPomN);
  if (uPom > 0.5 && pd < 140.0 && abs(pN.y) < 0.3) {
    vec3 pT = normalize(cross(vec3(0.0, 1.0, 0.0), pN));
    if (dot(pq0, pT) * ps0.x + dot(pq1, pT) * ps1.x < 0.0) pT = -pT;
    vec3 V = pV / pd; vec3 vt = vec3(dot(V, pT), V.y, dot(V, pN));
    vec2 maxOff = -vt.xy / max(vt.z, 0.22) * 0.3 * uUvPerM * (1.0 - smoothstep(90.0, 140.0, pd));
    float n = floor(mix(16.0, 6.0, clamp(vt.z, 0.0, 1.0)));
    float lay = 1.0 / n; vec2 st = maxOff * lay; vec2 uv = vMapUv; float cur = 0.0;
    float dep = pomDepth(uv, ps0, ps1);
    for (int i = 0; i < 16; i++) { if (cur >= dep || float(i) >= n) break; uv += st; cur += lay; dep = pomDepth(uv, ps0, ps1); }
    vec2 pu = uv - st; float pa = dep - cur, pb = pomDepth(pu, ps0, ps1) - cur + lay;
    pomUv = mix(uv, pu, clamp(pa / (pa - pb + 1e-5), 0.0, 1.0));
  }
#define vMapUv pomUv
#define vNormalMapUv pomUv
#define vRoughnessMapUv pomUv
#define vMetalnessMapUv pomUv
#define vEmissiveMapUv pomUv
`)
      .replace('#include <map_fragment>', '#include <map_fragment>' + N1 + 'diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 4.5, vWY));');
  };
  return mat;
}
const RELIEF_U = { value: QUALITY === 'low' ? 0 : 1 };
function plainMat(color, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0 }, o)); }
function baseAO(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 4.5, vWY));');
  };
  return mat;
}
function roofTex(base, joint, seed) {
  const c = mkCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  const n = noiseCanvas(128, 4, 3, seed, 0, 255); g.globalAlpha = 0.18; g.globalCompositeOperation = 'overlay'; g.drawImage(n, 0, 0, 256, 256);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; speckle(g, 0, 0, 256, 256, 1600, 0.08);
  if (joint) { g.fillStyle = joint; for (let i = 0; i < 256; i += 64) { g.fillRect(i, 0, 2, 256); g.fillRect(0, i, 256, 2); } }
  return canvasTex(c);
}
function initMaterials() {
  for (const k of Object.keys(FAC)) Object.defineProperty(MAT,'f:'+k,{configurable:true,enumerable:true,get(){const material=facadeMat(k);Object.defineProperty(MAT,'f:'+k,{value:material,enumerable:true});return material;}});
  const rt = roofTex('#ffffff', 'rgba(0,0,0,.12)', 11);
  MAT['roof:light'] = plainMat('#b3b2ad', { map: rt, roughness: 0.95 });
  MAT['roof:dark'] = plainMat('#5c6064', { map: rt, roughness: 0.9 });
  MAT['roof:mid'] = plainMat('#9b9b97', { map: rt, roughness: 0.95 });
  const tileC = mkCanvas(128, 128), tg = tileC.getContext('2d'); tg.fillStyle = '#ffffff'; tg.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) { tg.fillStyle = 'rgba(0,0,0,.28)'; tg.fillRect(0, y, 128, 2); for (let x = (y / 8 % 2) * 6; x < 128; x += 12) { tg.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'},${rr(0.03, 0.12)})`; tg.fillRect(x, y + 2, 11, 6); } }
  const tileT = canvasTex(tileC);
  MAT['roof:tileGrey'] = plainMat('#5b6066', { map: tileT, roughness: 0.75, side: THREE.DoubleSide });
  MAT['roof:tileRed'] = plainMat('#9c4c34', { map: tileT, roughness: 0.75, side: THREE.DoubleSide });
  MAT['roof:terrace'] = plainMat('#a8765c', { map: rt, roughness: 0.9 });
  MAT.plinth = baseAO(plainMat('#5b5d5f', { map: rt, roughness: 0.8 }));
  MAT.stoneWarm = baseAO(plainMat('#e1ded5', { map: rt, roughness: 0.8 }));
  MAT.stoneFacade = baseAO(plainMat('#b7b4ae', { map: rt, roughness: 0.88 }));
  MAT.museumGlass = plainMat('#6a8990', {roughness:0.32, metalness:0.18});
  MAT.adminPanel = baseAO(plainMat('#70757c', {map:rt,roughness:0.88}));
  MAT.adminFrame = baseAO(plainMat('#a9adb1', {map:rt,roughness:0.85}));
  MAT.adminGlass = plainMat('#5683ad', {roughness:0.28,metalness:0.15});
  MAT.redPlant = plainMat('#883d3c', {roughness:1});
  MAT.siteFence = plainMat('#87a0a0',{roughness:.88});
  MAT.crane = plainMat('#c4a342',{roughness:.65,metalness:.25});
  MAT.poolBlue = plainMat('#4483a5',{roughness:.22,metalness:.1});
  const brick = mkCanvas(256, 256), bg = brick.getContext('2d'); bg.fillStyle = '#b6a89c'; bg.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) for (let x = -32; x < 256; x += 32) { bg.fillStyle = `hsl(22, ${rr(14, 21)}%, ${rr(62, 72)}%)`; bg.fillRect(x + (y / 16 % 2) * 16 + 1, y + 1, 30, 14); }
  const bt = canvasTex(brick); bt.repeat.set(4, 4); MAT.paveBrick = plainMat('#ffffff', {map:bt,roughness:0.95});
  MAT.membrane = new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.55, metalness: 0, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0 });
  NIGHT_MATS.push({ m: MAT.membrane, k: 0.08 });
  MAT.seatRed = plainMat('#b8262a', { roughness: 0.6 });
  const sc = mkCanvas(64, 64), sg = sc.getContext('2d'); sg.fillStyle = '#fff'; sg.fillRect(0, 0, 64, 64); sg.fillStyle = 'rgba(0,0,0,.18)'; for (let x = 0; x < 64; x += 8) sg.fillRect(x, 0, 2, 64);
  MAT['roof:metal'] = plainMat('#aeb4b8', { map: canvasTex(sc), roughness: 0.42, metalness: 0.65 });
  MAT['roof:metalBlue'] = plainMat('#4f78a8', { map: canvasTex(sc), roughness: 0.45, metalness: 0.4 });
  MAT['trim:white'] = baseAO(plainMat('#e6e5e0', { side: THREE.DoubleSide }));
  MAT['trim:grey'] = baseAO(plainMat('#a6a9aa', { side: THREE.DoubleSide }));
  MAT['trim:dark'] = baseAO(plainMat('#4b4f52', { side: THREE.DoubleSide }));
  MAT.white = baseAO(plainMat('#eeede8', { roughness: 0.6 }));
  MAT.concrete = baseAO(plainMat('#b2b1ab', { map: rt, roughness: 0.92 }));
  MAT.stone = baseAO(plainMat('#8b8983', { map: rt, roughness: 0.8 }));
  MAT.granite = plainMat('#6b6a66', { map: rt, roughness: 0.7 });
  MAT.equip = plainMat('#9ea2a3', { roughness: 0.6, metalness: 0.3 });
  MAT.gold = plainMat('#c79a3c', { roughness: 0.35, metalness: 0.9 });
  MAT.redcol = plainMat('#8b2c21', { roughness: 0.6 });
  MAT.tile = plainMat('#3b4044', { roughness: 0.75 });
  MAT.wood = plainMat('#8a5d3c', { roughness: 0.8 });
  MAT.curb = baseAO(plainMat('#bdbab2', { roughness: 0.9 }));
  MAT.paint = plainMat('#e9e7df', { roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  MAT.terracotta = plainMat('#bd7955', { roughness: 0.9 });
  MAT.garden = plainMat('#627844', { roughness: 1 });
  MAT.cactus = plainMat('#59745b', { roughness: 0.85 });
  MAT.deck = plainMat('#c3c0b8', { map: rt, roughness: 0.9 });
  MAT.solar = plainMat('#1c2d4a', { roughness: 0.25, metalness: 0.7 });
  MAT.seatBlue = plainMat('#2f62a6', { roughness: 0.6 });
  MAT.wendeBeige = baseAO(plainMat('#d6c4a2', { map: rt, roughness: 0.85 }));
  MAT.metal = plainMat('#9aa1a6', { roughness: 0.4, metalness: 0.7 });
  MAT.dark = plainMat('#2b2e31', { roughness: 0.7 });
  MAT.glassClear = new THREE.MeshStandardMaterial({ color: '#eaf3f5', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55, emissive: 0xfff3dc, emissiveIntensity: 0, depthWrite: false });
  NIGHT_MATS.push({ m: MAT.glassClear, k: 0.9 });
  MAT.lamp = new THREE.MeshStandardMaterial({ color: '#f4f1e6', emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4 });
  NIGHT_MATS.push({ m: MAT.lamp, k: 3.0 });
  const gh = mkCanvas(64, 64), gg = gh.getContext('2d'); gg.fillStyle = 'rgba(220,236,232,.35)'; gg.fillRect(0, 0, 64, 64); gg.fillStyle = '#f4f6f4'; gg.fillRect(0, 0, 64, 3); gg.fillRect(0, 0, 3, 64); gg.fillRect(30, 0, 2, 64);
  MAT.greenhouse = new THREE.MeshStandardMaterial({ map: canvasTex(gh), transparent: true, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
}

class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.o = []; this.cur = -1; }
  tri(A, B, C) {
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const P of [A, B, C]) { this.p.push(P[0], P[1], P[2]); this.n.push(nx, ny, nz); this.u.push(P[3] || 0, P[4] || 0); }
    this.o.push(this.cur);
  }
  quadO(A, B, C, D, ox, oy, oz) {
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * ox + ny * oy + nz * oz < 0) { this.tri(A, C, B); this.tri(A, D, C); } else { this.tri(A, B, C); this.tri(A, C, D); }
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere(); return g;
  }
}
const BUFS = {};
const buf = (k) => (BUFS[k] ||= new GB());
let OWNER = -1;
function insetPoly(p, d) {
  const n = p.length, ccw = pArea(p) > 0, out = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    let e1x = b[0] - a[0], e1z = b[1] - a[1], l1 = Math.hypot(e1x, e1z) || 1; e1x /= l1; e1z /= l1;
    let e2x = c[0] - b[0], e2z = c[1] - b[1], l2 = Math.hypot(e2x, e2z) || 1; e2x /= l2; e2z /= l2;
    const n1x = ccw ? -e1z : e1z, n1z = ccw ? e1x : -e1x, n2x = ccw ? -e2z : e2z, n2z = ccw ? e2x : -e2x;
    let mx = n1x + n2x, mz = n1z + n2z; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = d / Math.max(0.35, mx * n1x + mz * n1z);
    out.push([b[0] + mx * k, b[1] + mz * k]);
  }
  return out;
}
function addParapet(key, poly, y, h, t = 0.32) {
  const inner = insetPoly(poly, t);
  addWalls(key, poly, y, y + h); addWalls(key, inner, y, y + h, undefined, true); addCap(key, poly, y + h, false, [inner]);
}
function addHipRoof(key, poly, y, rise, inset, eave = 0.6) {
  const area = Math.abs(pArea(poly)); let inn = insetPoly(poly, inset);
  const ok = Math.abs(pArea(inn)) > area * 0.08 && (pArea(inn) > 0) === (pArea(poly) > 0) && inn.every((q) => pip(q[0], q[1], poly));
  if (!ok) { addCap(key, poly, y); return; }
  const outer = insetPoly(poly, -eave), B = buf(key); B.cur = OWNER;
  const n = poly.length, ccw = pArea(poly) > 0;
  for (let i = 0; i < n; i++) {
    const a = outer[i], b = outer[(i + 1) % n], c = inn[(i + 1) % n], d = inn[i];
    const ex = b[0] - a[0], ez = b[1] - a[1], el = Math.hypot(ex, ez) || 1, nx = ccw ? ez / el : -ez / el, nz = ccw ? -ex / el : ex / el;
    const sl = Math.hypot(inset + eave, rise);
    B.quadO([a[0], y - 0.25, a[1], 0, 0], [b[0], y - 0.25, b[1], el / 2, 0], [c[0], y + rise, c[1], el / 2, sl / 2], [d[0], y + rise, d[1], 0, sl / 2], nx * rise, inset + eave, nz * rise);
    B.quadO([a[0], y - 0.25, a[1], 0, 0], [b[0], y - 0.25, b[1], el / 2, 0], [b[0], y - 0.55, b[1], el / 2, 0.15], [a[0], y - 0.55, a[1], 0, 0.15], nx, 0, nz);
  }
  addCap(key, inn, y + rise);
}
function addSlopedPrism(key, poly, y0, hf, capKey) {
  const B = buf(key); B.cur = OWNER; const ccw = pArea(poly) > 0; let dist = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); if (len < 0.02) continue;
    const nx = ccw ? dz / len : -dz / len, nz = ccw ? -dx / len : dx / len, f = FAC[key.slice(2)] || { bw: 4, fh: 4 };
    const ha = hf(a[0], a[1]), hb = hf(b[0], b[1]);
    B.quadO([a[0], y0, a[1], dist / (f.bw * 8), 0], [b[0], y0, b[1], (dist + len) / (f.bw * 8), 0], [b[0], hb, b[1], (dist + len) / (f.bw * 8), (hb - y0) / (f.fh * 4)], [a[0], ha, a[1], dist / (f.bw * 8), (ha - y0) / (f.fh * 4)], nx, 0, nz);
    dist += len;
  }
  const C = buf(capKey); C.cur = OWNER;
  const tris = THREE.ShapeUtils.triangulateShape(poly.map((q) => new THREE.Vector2(q[0], q[1])), []);
  for (const [i, j, k] of tris) { const P = (q) => [q[0], hf(q[0], q[1]), q[1], q[0] / 8, q[1] / 8]; const A = poly[i], Bq = poly[j], Cq = poly[k]; C.quadO(P(A), P(Bq), P(Cq), P(Cq), 0, 1, 0); }
}
function addWalls(key, poly, y0, y1, uvm, flip) {
  const B = buf(key); B.cur = OWNER;
  const f = key.startsWith('f:') ? FAC[key.slice(2)] : null;
  const su = f ? f.bw * 8 : 4, sv = f ? f.fh * 4 : 4;
  const ccw = pArea(poly) > 0; let dist = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); if (len < 0.02) continue;
    let nx = ccw ? dz / len : -dz / len, nz = ccw ? -dx / len : dx / len;
    if (flip) { nx = -nx; nz = -nz; }
    const dorm = key.startsWith('f:dorm');
    const u0 = dorm ? 0 : dist / su, u1 = dorm ? Math.max(1, Math.round(len / f.bw)) / 8 : (dist + len) / su, v0 = (uvm === 'abs' ? y0 : 0) / sv, v1 = (uvm === 'abs' ? y1 : y1 - y0) / sv;
    B.quadO([a[0], y0, a[1], u0, v0], [b[0], y0, b[1], u1, v0], [b[0], y1, b[1], u1, v1], [a[0], y1, a[1], u0, v1], nx, 0, nz);
    dist += len;
  }
}
function addCap(key, poly, y, down = false, holes = []) {
  const B = buf(key); B.cur = OWNER;
  const v2 = poly.map((q) => new THREE.Vector2(q[0], q[1]));
  const hv = holes.map((h) => h.map((q) => new THREE.Vector2(q[0], q[1])));
  let tris; try { tris = THREE.ShapeUtils.triangulateShape(v2, hv); } catch (e) { return; }
  const all = poly.concat(...holes);
  for (const [i, j, k] of tris) {
    const A = all[i], Bp = all[j], C = all[k];
    const P = (q) => [q[0], y, q[1], q[0] / 8, q[1] / 8];
    const cy = (Bp[1] - A[1]) * (C[0] - A[0]) - (Bp[0] - A[0]) * (C[1] - A[1]);
    if ((cy > 0) !== down) B.tri(P(A), P(Bp), P(C)); else B.tri(P(A), P(C), P(Bp));
  }
}
function addPrism(key, poly, y0, y1, capKey, uvm) { addWalls(key, poly, y0, y1, uvm); addCap(capKey || key, poly, y1); }
const PROPS = [];
function addBox(key, cx, y0, cz, L, W, H, ang = 0, capKey) {
  const poly = rectPoly(cx, cz, L, W, ang);
  if (y0 < 0.6 && H >= 0.45 && L * W >= 0.05 && L * W <= 600 && !/^(deck|f:|roof|glass|lamp|trim:white)/.test(key)) PROPS.push({ p: poly, top: y0 + H, c: [cx, cz] });
  addPrism(key, poly, y0, y0 + H, capKey);
}
function addBeam(key, a, b, width = 0.18) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A).normalize();
  const u = new THREE.Vector3(0, 1, 0); if (Math.abs(d.y) > 0.95) u.set(1, 0, 0);
  u.cross(d).normalize().multiplyScalar(width / 2);
  const v = d.clone().cross(u).normalize().multiplyScalar(width / 2);
  const p = (c, i, j) => c.clone().addScaledVector(u, i).addScaledVector(v, j).toArray();
  const q = [p(A, -1, -1), p(A, 1, -1), p(A, 1, 1), p(A, -1, 1)], r = [p(B, -1, -1), p(B, 1, -1), p(B, 1, 1), p(B, -1, 1)];
  const g = buf(key); g.cur = OWNER;
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; g.tri(q[i], q[j], r[j]); g.tri(q[i], r[j], r[i]); }
  g.tri(...[q[2], q[1], q[0]]); g.tri(q[3], q[2], q[0]); g.tri(r[0], r[1], r[2]); g.tri(r[0], r[2], r[3]);
}
function addCyl(key, x, y0, z, r, h, seg = 10, r2) {
  const B = buf(key); B.cur = OWNER; r2 = r2 ?? r;
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2;
    B.quadO([x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r, i / seg, 0], [x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r, (i + 1) / seg, 0],
      [x + Math.cos(a1) * r2, y0 + h, z + Math.sin(a1) * r2, (i + 1) / seg, 1], [x + Math.cos(a0) * r2, y0 + h, z + Math.sin(a0) * r2, i / seg, 1], Math.cos(am), 0, Math.sin(am));
    if (r2 > 0) B.tri([x, y0 + h, z], [x + Math.cos(a1) * r2, y0 + h, z + Math.sin(a1) * r2], [x + Math.cos(a0) * r2, y0 + h, z + Math.sin(a0) * r2]);
  }
}
function addRibbon(key, pts, w, y0, y1, sideKey) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); if (l < 0.1) continue;
    addBox(sideKey || key, (a[0] + b[0]) / 2, y0, (a[1] + b[1]) / 2, l + 0.6, w, y1 - y0, Math.atan2(dz, dx), key);
  }
}

function textCanvas(text, o = {}) {
  const fs = o.fs || 120, font = `${o.weight || 900} ${fs}px ${o.family || '"Noto Serif SC", "Songti SC", serif'}`;
  const tmp = mkCanvas(8, 8).getContext('2d'); tmp.font = font;
  const chars = [...text], gap = fs * (o.gap ?? 0.12);
  let W, H;
  if (o.vertical) { W = Math.ceil(fs * 1.25); H = Math.ceil(chars.length * (fs + gap) + fs * 0.3); }
  else { W = Math.ceil(tmp.measureText(text).width + chars.length * gap + fs * 0.5); H = Math.ceil(fs * 1.35); }
  const c = mkCanvas(W, H), g = c.getContext('2d');
  if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, W, H); }
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (o.shadow) { g.shadowColor = o.shadow; g.shadowBlur = fs * 0.06; g.shadowOffsetY = fs * 0.03; }
  g.fillStyle = o.color || '#c9a24a';
  if (o.vertical) chars.forEach((ch, i) => g.fillText(ch, W / 2, fs * 0.65 + i * (fs + gap)));
  else { let x = fs * 0.25; for (const ch of chars) { const w = g.measureText(ch).width; g.fillText(ch, x + w / 2, H / 2); x += w + gap; } }
  return c;
}
const SIGNS = new THREE.Group();
const imgReady = (img) => (img.complete && img.naturalWidth ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = () => r(); setTimeout(r, 4000); }));
const CALLI = new Image();
CALLI.src = opts.calliUrl;
function addImageSign(img, x, y, z, nx, nz, height, o = {}) {
  const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAXANI; t.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.32, metalness: 0.75, emissive: new THREE.Color(o.glow || '#000'), emissiveMap: o.glow ? t : null, emissiveIntensity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  if (o.glow) NIGHT_MATS.push({ m, k: 1.1 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * img.width / img.height, height), m);
  mesh.position.set(x + nx * 0.12, y, z + nz * 0.12); mesh.rotation.y = Math.atan2(nx, nz);
  SIGNS.add(mesh); return mesh;
}
function addSign(text, x, y, z, nx, nz, height, o = {}) {
  const c = textCanvas(text, o), aspect = c.width / c.height, h = height, w = h * aspect;
  const t = canvasTex(c, true, false);
  const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: o.rough ?? 0.35, metalness: o.metal ?? 0.6, emissive: new THREE.Color(o.glow || '#000000'), emissiveMap: o.glow ? t : null, emissiveIntensity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  if (o.glow) NIGHT_MATS.push({ m, k: 1.2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.position.set(x + nx * 0.12, y, z + nz * 0.12);
  mesh.rotation.y = Math.atan2(nx, nz);
  SIGNS.add(mesh);
  return mesh;
}

const REG = { x0: -760, z0: -1160, x1: 960, z1: 960 };
const REGW = REG.x1 - REG.x0, REGH = REG.z1 - REG.z0;
const RW = { motorway: 12, trunk: 12, primary: 12, secondary: 10, tertiary: 9, unclassified: 7, residential: 6, living_street: 5.5, service: 4.5, road: 6 };
const RCOL = { motorway: '#3b3e41', primary: '#3e4144', secondary: '#43464a', tertiary: '#484b4e', unclassified: '#54575a', residential: '#595c5e', living_street: '#646664', service: '#5d6062', road: '#57595b' };
const PW = { footway: 3, path: 2.4, steps: 3, pedestrian: 6, cycleway: 3, track: 3 };
const roadW = (r) => r.wide || (RW[r.t] || 5) * (r.ln && r.ow ? Math.max(1, r.ln / 2.4) : 1);
const tracePoly = (g, p) => { g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); g.closePath(); };
const traceLine = (g, p) => { g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); };
const fillPoly = (g, p, col) => { g.beginPath(); tracePoly(g, p); g.fillStyle = col; g.fill(); };

const GATE = { x: -385.5, z: 294.5, dx: 0.837, dz: 0.548, nx: -0.548, nz: 0.837 };
const gateP = (a, b) => [GATE.x + GATE.dx * a + GATE.nx * b, GATE.z + GATE.dz * a + GATE.nz * b];
const gateRect = (a0, a1, b0, b1) => [gateP(a0, b0), gateP(a1, b0), gateP(a1, b1), gateP(a0, b1)];
const GATE_FORE = [gateRect(-48, 52, 3.4, 34.5)];
function paintGate(g, paveP) {
  fillPoly(g, gateRect(-48, 52, 7.4, 34.5), '#56595c');
  g.strokeStyle = 'rgba(238,238,232,.8)'; g.lineWidth = 0.15;
  for (let a = 1; a <= 32; a += 2.6) { traceLine(g, [gateP(a, 13.4), gateP(a, 18.8)]); g.stroke(); }
  traceLine(g, [gateP(1, 18.8), gateP(32.2, 18.8)]); g.stroke();
  fillPoly(g, gateRect(-48, 52, 3.4, 7.4), '#b08f84'); g.fillStyle = paveP; g.fill();
  g.strokeStyle = '#cfccc4'; g.lineWidth = 0.3; traceLine(g, [gateP(-48, 7.4), gateP(52, 7.4)]); g.stroke();
  fillPoly(g, PLAZAS.gate, '#d3cec4'); g.fillStyle = paveP; g.fill();
  fillPoly(g, gateRect(-6, 5, -14, -78), '#c8c3b8'); fillPoly(g, gateRect(-5.4, 4.4, -14.6, -77.4), '#1f3133');
}
const PLAZAS = {
  gate: [gateP(-11.8, 3.4), gateP(13.5, 3.4), gateP(15.8, -13), gateP(5, -13), gateP(5, -70), gateP(8, -70), gateP(8, -86), gateP(-9, -86), gateP(-9, -70), gateP(-6, -70), gateP(-6, -13), gateP(-14.6, -13)],
  xueyuan: null,
  xyLawns: null,
  rondo: [-55, -112, 24],
};
function paintParcel(g,p,kind) {
  const ob=obb(p),cols=kind==='wood'?['#526447','#5f714d','#465d3b']:['#a1946d','#76855a','#879566','#596e45'];
  g.save();g.beginPath();tracePoly(g,p);g.clip();g.translate(ob.cx,ob.cz);g.rotate(ob.ang);
  g.fillStyle=kind==='wood'?'#657653':'#a79775';g.fillRect(-ob.L/2,-ob.W/2,ob.L,ob.W);
  for(let v=-ob.W/2;v<ob.W/2;v+=kind==='wood'?10:5){g.fillStyle=cols[Math.abs(Math.round(v))%cols.length];g.fillRect(-ob.L/2+1,v,ob.L-2,kind==='wood'?8.5:3.5);}
  g.strokeStyle='#bdaf91';g.lineWidth=2.2;for(let u=-ob.L/2+30;u<ob.L/2;u+=40){g.beginPath();g.moveTo(u,-ob.W/2);g.lineTo(u,ob.W/2);g.stroke();}g.restore();
}
function paintNortheast(g,site=true) {
  for(const p of NE.reserves)paintParcel(g,p,'wood');
  for(const p of NE.patches) paintParcel(g,p.p,p.kind);
  if(!site) return;
  fillPoly(g,NE.phase5Yard,'#c4bfb4');
  fillPoly(g,NE.site,'#ab9476');
  const nets=[[[423,-512],[479,-526],[514,-502],[508,-463],[437,-458]],[[424,-451],[493,-459],[521,-433],[505,-403],[432,-410]],[[514,-506],[547,-511],[554,-462],[530,-453]]];
  for(const p of nets){g.save();g.beginPath();tracePoly(g,p);g.clip();g.fillStyle='#587668';g.fill();const bb=pBox(p);g.lineWidth=.26;g.strokeStyle='rgba(186,199,159,.45)';for(let x=bb[0]-80;x<bb[2]+80;x+=2){g.beginPath();g.moveTo(x,bb[1]);g.lineTo(x+70,bb[3]);g.stroke();}g.restore();}
  traceLine(g,[[410,-544],[416,-470],[426,-405],[555,-405],[586,-433],[588,-500]]);g.lineWidth=5;g.strokeStyle='#b6a183';g.stroke();
  paintParcel(g,NE.beds,'nursery');
  for(const p of NE.parking){fillPoly(g,p,'#797b75');const bb=pBox(p);g.lineWidth=.18;g.strokeStyle='#dedcd0';for(let z=bb[1]+2;z<bb[3]-2;z+=2.7) for(const x of [bb[0]+1,bb[2]-6]){g.strokeRect(x,z,5,2.6);}}
}
let GROUND = null;
function paintGround() {
  const H = QP.tex, W = Math.round(H * REGW / REGH), s = H / REGH;
  const cv = mkCanvas(W, H), g = cv.getContext('2d');
  g.setTransform(s, 0, 0, s, -REG.x0 * s, -REG.z0 * s);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const pat = (c, meters) => { const p = g.createPattern(c, 'repeat'); p.setTransform(new DOMMatrix().scale(meters / c.width)); return p; };
  const grassC = mkCanvas(256, 256), gg = grassC.getContext('2d');
  for (let i = 0; i < 5000; i++) { gg.strokeStyle = `rgba(${rand() < 0.5 ? '20,40,10' : '220,235,170'},${rr(0.04, 0.16)})`; gg.lineWidth = rr(0.6, 1.6); const x = rand() * 256, y = rand() * 256; gg.beginPath(); gg.moveTo(x, y); gg.lineTo(x + rr(-2, 2), y - rr(2, 6)); gg.stroke(); }
  const grassP = pat(grassC, 10);
  const paveC = mkCanvas(256, 256), pg = paveC.getContext('2d'); pg.fillStyle = '#c9c4b9'; pg.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) { pg.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},${rr(0.02, 0.08)})`; pg.fillRect(x, y, 32, 32); }
  pg.fillStyle = 'rgba(90,85,75,.35)'; for (let i = 0; i < 256; i += 32) { pg.fillRect(i, 0, 1.5, 256); pg.fillRect(0, i, 256, 1.5); }
  const paveP = pat(paveC, 8);
  const pebC = mkCanvas(256, 256), bg = pebC.getContext('2d'); bg.fillStyle = '#ddd8cd'; bg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { bg.fillStyle = pick(['#c9c3b6', '#ebe7de', '#bdb6a8', '#d6d0c3']); bg.beginPath(); bg.ellipse(rand() * 256, rand() * 256, rr(3, 9), rr(2, 6), rand() * 3, 0, 7); bg.fill(); }
  const pebP = pat(pebC, 6);

  { const oc = OUTER.canvas, os = OUTER.s; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingQuality = 'high'; g.drawImage(oc, (REG.x0 - OREG.x0) * os, (REG.z0 - OREG.z0) * os, REGW * os, REGH * os, 0, 0, W, H); g.restore(); }
  for (const l of D.lu) { if (l.k === 'railway') fillPoly(g, l.p, '#8e887d'); }
  fillPoly(g, CAMPUS, '#6e894e'); g.fillStyle = grassP; g.fill();
  const GC = { grass: '#78955a', meadow: '#839c5c', park: '#729255', wood: '#4f6a3e', scrub: '#5d7845' };
  for (const q of D.g) { fillPoly(g, q.p, GC[q.k] || '#779a4e'); g.fillStyle = grassP; g.fill(); }
  for (const q of D.sq) { fillPoly(g, q.p, '#c9c4b9'); g.fillStyle = paveP; g.fill(); }
  paintGate(g, paveP);
  { const lib = BLD.find((b) => b.name === '图书馆'), sq = lib && D.sq.reduce((best, q) => { const c = pCentroid(q.p), bc = best && pCentroid(best.p); return !best || Math.hypot(c[0] - lib.c[0], c[1] - lib.c[1]) < Math.hypot(bc[0] - lib.c[0], bc[1] - lib.c[1]) ? q : best; }, null);
    if (sq) {
      const A = (a, d) => [-228.2 + 0.849 * a - 0.528 * d, -50.1 + 0.528 * a + 0.849 * d];
      for (const poly of [sq.p, [A(-3, 0), A(110, 0), A(110, 15), A(-3, 15)]]) {
        g.save(); g.beginPath(); tracePoly(g, poly); g.clip();
        g.translate(-228.2, -50.1); g.rotate(Math.atan2(0.528, 0.849));
        for (let a = -60; a < 160; a += 6.4) for (let d = -10; d < 120; d += 6.4) { g.fillStyle = ((Math.round(a / 6.4) + Math.round(d / 6.4)) & 1) ? '#cfc6b8' : '#d9d2c6'; g.fillRect(a, d, 6.4, 6.4); }
        g.strokeStyle = 'rgba(120,108,92,.55)'; g.lineWidth = 0.28;
        for (let a = -60; a < 160; a += 6.4) { g.beginPath(); g.moveTo(a, -10); g.lineTo(a, 120); g.stroke(); }
        for (let d = -10; d < 120; d += 6.4) { g.beginPath(); g.moveTo(-60, d); g.lineTo(160, d); g.stroke(); }
        g.restore();
      }
    } }
  fillPoly(g, PLAZAS.xueyuan, '#ddd8cd'); g.fillStyle = pebP; g.fill();
  for (const [x, z, r] of PLAZAS.xyLawns) {
    const p = circlePoly(x, z, r, 48).map(([px,pz],i) => [x+(px-x)*(1+0.18*Math.sin(i/48*Math.PI*4)),z+(pz-z)*0.8]);
    fillPoly(g, p, '#7da352'); g.fillStyle = grassP; g.fill(); g.strokeStyle = '#efece4'; g.lineWidth = 1.2; g.stroke();
  }
  {
    const [x, z, r] = PLAZAS.rondo; fillPoly(g, circlePoly(x, z, r, 60), '#d5bdb5');
    g.strokeStyle = 'rgba(150,95,90,.55)'; g.lineWidth = 0.6;
    for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; g.beginPath(); g.moveTo(x + Math.cos(a) * 8, z + Math.sin(a) * 8); g.lineTo(x + Math.cos(a) * r, z + Math.sin(a) * r); g.stroke(); }
    for (const rr2 of [12, 17, 21]) { g.beginPath(); g.arc(x, z, rr2, 0, 7); g.stroke(); }
    fillPoly(g, circlePoly(x, z, 8, 40), '#79a050');
  }
  paintSports(g);
  paintNortheast(g);
  g.strokeStyle = '#b3aea3'; g.lineWidth = 7;
  for (const b of BLD) { if (b.cls.special === 'station' || b.extra?.special === 'xueyuan') continue; for (const p of b.parts || [b.p]) { g.beginPath(); tracePoly(g, p); g.stroke(); g.fillStyle = '#b3aea3'; g.fill(); } }
  for (const pod of XY_PODS) { g.beginPath(); tracePoly(g, pod.p); g.lineWidth = 8; g.stroke(); }
  { const blue = [[-150, -401], [-104, -419], [-46, -441], [-2, -458], [8, -500], [14, -538], [44, -588], [86, -616], [128, -640], [160, -662]];
    traceLine(g, blue); g.strokeStyle = '#e9ebe6'; g.lineWidth = 4.2; g.stroke(); traceLine(g, blue); g.strokeStyle = '#3d6cab'; g.lineWidth = 3.2; g.stroke(); }
  for (const r of D.pa) { traceLine(g, r.p); g.strokeStyle = r.t === 'steps' ? '#a8a49b' : '#c7b9a0'; g.lineWidth = PW[r.t] || 2.5; g.stroke(); }
  const roads = D.r.filter((r) => r.t !== 'proposed' && r.t !== 'construction');
  for (const r of roads) { traceLine(g, r.p); g.strokeStyle = '#b8b5ad'; g.lineWidth = roadW(r) + 1.4; g.stroke(); }
  for (const r of roads) { traceLine(g, r.p); g.strokeStyle = r.wide ? '#c5c0b6' : RCOL[r.t] || '#57595b'; g.lineWidth = roadW(r); g.stroke(); if (r.wide) { g.strokeStyle = paveP; g.stroke(); } }
  g.lineCap = 'butt';
  for (const r of roads) {
    const w = roadW(r);
    if (['primary', 'secondary', 'tertiary', 'motorway'].includes(r.t)) {
      g.strokeStyle = 'rgba(235,235,230,.85)'; g.lineWidth = 0.18; g.setLineDash([]);
      traceLine(g, offsetLine(r.p, w / 2 - 0.6)); g.stroke(); traceLine(g, offsetLine(r.p, -w / 2 + 0.6)); g.stroke();
      if (r.ow) { g.setLineDash([4, 6]); for (const o of [-w / 6, w / 6]) { traceLine(g, offsetLine(r.p, o)); g.stroke(); } }
      else { g.strokeStyle = 'rgba(230,190,60,.9)'; for (const o of [-0.2, 0.2]) { traceLine(g, offsetLine(r.p, o)); g.stroke(); } }
    } else if (['unclassified', 'residential'].includes(r.t)) {
      g.strokeStyle = 'rgba(235,235,230,.75)'; g.lineWidth = 0.15; g.setLineDash([3, 4]); traceLine(g, r.p); g.stroke();
    }
    g.setLineDash([]);
  }
  for (const [k, x, z] of D.n) {
    if (k !== 'crossing') continue;
    let best = null, bd = 12;
    for (const r of roads) for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1), d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
      if (d < bd) { bd = d; best = { ang: Math.atan2(dz, dx), w: roadW(r) }; }
    }
    if (!best) continue;
    g.save(); g.translate(x, z); g.rotate(best.ang); g.fillStyle = 'rgba(240,240,235,.9)';
    for (let v = -best.w / 2 + 0.4; v < best.w / 2 - 0.3; v += 1.0) g.fillRect(-2.5, v, 5, 0.5);
    g.restore();
  }
  for (const l of D.lu) {
    if (l.k !== 'parking') continue;
    fillPoly(g, l.p, '#5a5d60'); const ob = obb(l.p);
    g.save(); g.translate(ob.cx, ob.cz); g.rotate(ob.ang); g.strokeStyle = 'rgba(240,240,235,.8)'; g.lineWidth = 0.15;
    for (let u = -ob.L / 2 + 1; u < ob.L / 2; u += 2.5) { g.beginPath(); g.moveTo(u, -ob.W / 2 + 0.5); g.lineTo(u, -ob.W / 2 + 5.5); g.moveTo(u, ob.W / 2 - 0.5); g.lineTo(u, ob.W / 2 - 5.5); g.stroke(); }
    g.restore();
  }
  for (const w of WATERS) {
    g.beginPath(); for (const o of w.outer) tracePoly(g, o); for (const i of w.inner) tracePoly(g, i);
    g.strokeStyle = '#8c8877'; g.lineWidth = 2.6; g.stroke(); g.fillStyle = '#243837'; g.fill('evenodd');
  }
  for (const b of BLD) { if (b.cls.special === 'station' || b.extra?.special === 'xueyuan') continue; for (const p of b.parts || [b.p]) fillPoly(g, p, '#6c6e70'); }
  for (const pod of XY_PODS) fillPoly(g, pod.p, '#6c6e70');
  for (const l of XY_LINKS) fillPoly(g, l, '#6c6e70');
  for (const r of D.rl) {
    if (r.t !== 'subway' || r.ly >= 2 || /折返线/.test(r.n)) continue;
    traceLine(g, r.p); g.strokeStyle = '#7d776c'; g.lineWidth = 3.4; g.stroke();
    g.strokeStyle = 'rgba(60,55,50,.9)'; g.lineWidth = 0.12; for (const o of [-0.72, 0.72]) { traceLine(g, offsetLine(r.p, o)); g.stroke(); }
  }
  {
    const ao = mkCanvas(W, H), ag = ao.getContext('2d');
    ag.setTransform(s, 0, 0, s, -REG.x0 * s, -REG.z0 * s); ag.filter = `blur(${Math.round(s * 3.2)}px)`; ag.fillStyle = 'rgba(0,0,0,.6)';
    for (const b of BLD) { if (b.extra?.special === 'xueyuan') continue; for (const p of b.parts || [b.p]) { ag.beginPath(); tracePoly(ag, p); ag.fill(); } }
    for (const pod of XY_PODS) { ag.beginPath(); tracePoly(ag, pod.p); ag.fill(); }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 0.55; g.drawImage(ao, 0, 0); g.restore();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const n1 = noiseCanvas(256, 4, 4, 77, 70, 190); const p1 = g.createPattern(n1, 'repeat'); p1.setTransform(new DOMMatrix().scale(s * 90 / 256));
  g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.55; g.fillStyle = p1; g.fillRect(0, 0, W, H);
  const n2 = noiseCanvas(128, 8, 3, 91, 60, 200); const p2 = g.createPattern(n2, 'repeat'); p2.setTransform(new DOMMatrix().scale(s * 14 / 128));
  g.globalAlpha = 0.35; g.fillStyle = p2; g.fillRect(0, 0, W, H);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  { const fm = mkCanvas(W, H), fg = fm.getContext('2d'); fg.drawImage(cv, 0, 0); g.save(); g.globalCompositeOperation = 'copy'; g.drawImage(OUTER.canvas, (REG.x0 - OREG.x0) * OUTER.s, (REG.z0 - OREG.z0) * OUTER.s, REGW * OUTER.s, REGH * OUTER.s, 0, 0, W, H); g.restore();
    const bw = Math.round(s * 120);
    const msk = mkCanvas(W, H), xg = msk.getContext('2d'); xg.filter = `blur(${Math.round(bw / 2.5)}px)`; xg.fillStyle = '#fff'; xg.fillRect(bw * 0.9, bw * 0.9, W - bw * 1.8, H - bw * 1.8); xg.filter = 'none'; xg.globalCompositeOperation = 'source-in'; xg.drawImage(fm, 0, 0);
    g.drawImage(msk, 0, 0); }
  GROUND = { canvas: cv, s, W, H };
}

let STADIUM = null;
const COURTS = [];
let TRACK_FIELD = null;
function paintSports(g) {
  const line = (w = 0.12) => { g.strokeStyle = 'rgba(245,245,240,.95)'; g.lineWidth = w; };
  const stad = D.pi.find((o) => o.k === 'stadium');
  if (stad) {
    let best = null, bd = 1e9;
    for (const q of D.pi) { if (q.s !== 'soccer') continue; const c = pCentroid(q.p), d = Math.hypot(c[0] - 205, c[1] - 525); if (d < bd) { bd = d; best = q; } }
    TRACK_FIELD = best;
  }
  for (const q of D.pi) {
    if (q.k === 'swimming_pool') continue;
    const ob = obb(q === TRACK_FIELD ? q.p : q.p);
    g.save(); g.translate(ob.cx, ob.cz); g.rotate(ob.ang);
    const L = ob.L, W = ob.W;
    if (q.k === 'stadium') { g.restore(); continue; }
    if (q === TRACK_FIELD) {
      STADIUM = ob;
      const st = 84.39 / 2, r0 = 36.5, r1 = r0 + 8 * 1.22;
      const track = (r) => { g.beginPath(); g.moveTo(-st, -r); g.lineTo(st, -r); g.arc(st, 0, r, -Math.PI / 2, Math.PI / 2); g.lineTo(-st, r); g.arc(-st, 0, r, Math.PI / 2, Math.PI * 1.5); g.closePath(); };
      track(r1 + 1.5); g.fillStyle = '#3f6aa6'; g.fill();
      track(r0); g.fillStyle = '#5c9a43'; g.fill();
      for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#5c9a43' : '#66a64b'; g.fillRect(-52.5 + i * 8.75, -34, 8.75, 68); }
      line(0.1); for (let k = 0; k <= 8; k++) { track(r0 + k * 1.22); g.stroke(); }
      line(0.14); g.strokeRect(-52.5, -34, 105, 68); g.beginPath(); g.moveTo(0, -34); g.lineTo(0, 34); g.stroke(); g.beginPath(); g.arc(0, 0, 9.15, 0, 7); g.stroke();
      for (const sgn of [-1, 1]) { g.strokeRect(sgn > 0 ? 52.5 - 16.5 : -52.5, -20.15, 16.5, 40.3); g.strokeRect(sgn > 0 ? 52.5 - 5.5 : -52.5, -9.16, 5.5, 18.32); }
      g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(st - 0.1, r0, 0.2, 8 * 1.22);
    } else if (q.s === 'tennis') {
      g.fillStyle = '#3d7a5a'; g.fillRect(-L / 2, -W / 2, L, W);
      const along = W < 30; const n = along ? Math.max(1, Math.round(L / 36)) : Math.max(1, Math.floor(L / 18.3));
      for (let i = 0; i < n; i++) {
        g.save();
        if (along) g.translate(-L / 2 + (i + 0.5) * L / n, 0); else { g.translate(-L / 2 + (i + 0.5) * L / n, 0); g.rotate(Math.PI / 2); }
        g.fillStyle = '#3d68a8'; g.fillRect(-11.885, -5.485, 23.77, 10.97); line(0.08);
        g.strokeRect(-11.885, -5.485, 23.77, 10.97); g.strokeRect(-11.885, -4.115, 23.77, 8.23);
        g.beginPath(); g.moveTo(-6.4, 0); g.lineTo(6.4, 0); g.moveTo(-6.4, -4.115); g.lineTo(-6.4, 4.115); g.moveTo(6.4, -4.115); g.lineTo(6.4, 4.115); g.stroke();
        g.restore();
        COURTS.push({ type: 'tennis', ob, i, n, along });
      }
    } else if (q.s === 'basketball') {
      g.fillStyle = '#a5503f'; g.fillRect(-L / 2, -W / 2, L, W);
      const cl = Math.min(28, L - 2), cw = Math.min(15, W - 2);
      g.fillStyle = '#3f7d5d'; g.fillRect(-cl / 2, -cw / 2, cl, cw); line(0.08); g.strokeRect(-cl / 2, -cw / 2, cl, cw);
      g.beginPath(); g.moveTo(0, -cw / 2); g.lineTo(0, cw / 2); g.stroke(); g.beginPath(); g.arc(0, 0, 1.8, 0, 7); g.stroke();
      for (const sg of [-1, 1]) { g.beginPath(); g.arc(sg * (cl / 2 - 1.575), 0, 6.75, sg > 0 ? Math.PI * 0.6 : -Math.PI * 0.4, sg > 0 ? Math.PI * 1.4 : Math.PI * 0.4); g.stroke(); g.strokeRect(sg > 0 ? cl / 2 - 5.8 : -cl / 2, -2.45, 5.8, 4.9); }
      COURTS.push({ type: 'basketball', ob, cl });
    } else if (q.s === 'soccer') {
      for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#5b9643' : '#65a24a'; g.fillRect(-L / 2 + i * L / 12, -W / 2, L / 12 + 0.05, W); }
      line(0.14); g.strokeRect(-L / 2 + 1.5, -W / 2 + 1.5, L - 3, W - 3); g.beginPath(); g.moveTo(0, -W / 2 + 1.5); g.lineTo(0, W / 2 - 1.5); g.stroke(); g.beginPath(); g.arc(0, 0, 9.15, 0, 7); g.stroke();
      COURTS.push({ type: 'soccer', ob });
    } else {
      g.fillStyle = '#6e9d58'; g.fillRect(-L / 2, -W / 2, L, W);
    }
    g.restore();
  }
}
function tracePolyLocal(g, p, ob) { const c = Math.cos(-ob.ang), s = Math.sin(-ob.ang); const q = p.map(([x, z]) => { const dx = x - ob.cx, dz = z - ob.cz; return [dx * c - dz * s, dx * s + dz * c]; }); tracePoly(g, q); }

let MASK = null;
function buildMask() {
  const c = mkCanvas(REGW, REGH), g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, -REG.x0, -REG.z0); g.lineJoin = g.lineCap = 'round';
  g.fillStyle = g.strokeStyle = '#fff';
  for (const b of BLD) { if (b.extra?.special === 'xueyuan') continue; for (const p of b.parts || [b.p]) { g.beginPath(); tracePoly(g, p); g.fill(); g.lineWidth = 5; g.stroke(); } }
  for (const pod of XY_PODS) { g.beginPath(); tracePoly(g, pod.p); g.fill(); g.lineWidth = 6; g.stroke(); }
  for (const l of XY_LINKS) { g.beginPath(); tracePoly(g, l); g.fill(); g.lineWidth = 5; g.stroke(); }
  for (const w of WATERS) { g.beginPath(); for (const o of w.outer) tracePoly(g, o); for (const i of w.inner) tracePoly(g, i); g.fill('evenodd'); g.lineWidth = 2.5; g.stroke(); }
  for (const r of D.r) { traceLine(g, r.p); g.lineWidth = roadW(r) + 2.5; g.stroke(); }
  for (const r of D.pa) { traceLine(g, r.p); g.lineWidth = (PW[r.t] || 2.5) + 1.2; g.stroke(); }
  for (const q of D.pi) { g.beginPath(); tracePoly(g, q.p); g.fill(); }
  for (const q of D.sq) { g.beginPath(); tracePoly(g, q.p); g.fill(); }
  for(const p of [NE.site,NE.beds,NE.phase5Yard]){g.beginPath();tracePoly(g,p);g.fill();}
  for (const l of D.lu) if (l.k === 'parking' || l.k === 'railway') { g.beginPath(); tracePoly(g, l.p); g.fill(); }
  for (const p of OUT_BLD) { g.beginPath(); tracePoly(g, p); g.fill(); g.lineWidth = 4; g.stroke(); }
  g.beginPath(); tracePoly(g, PLAZAS.gate); g.fill(); g.beginPath(); tracePoly(g, PLAZAS.xueyuan); g.fill();
  for (const q of GATE_FORE) { g.beginPath(); tracePoly(g, q); g.fill(); }
  g.beginPath(); g.arc(PLAZAS.rondo[0], PLAZAS.rondo[1], PLAZAS.rondo[2] + 2, 0, 7); g.fill();
  const d = g.getImageData(0, 0, REGW, REGH).data, a = new Uint8Array(REGW * REGH);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] > 20 ? 1 : 0;
  MASK = a;
}
const blocked = (x, z) => { const ix = Math.floor(x - REG.x0), iz = Math.floor(z - REG.z0); if (ix < 0 || iz < 0 || ix >= REGW || iz >= REGH) return true; return MASK[iz * REGW + ix] === 1; };
const inWater = (x, z) => { for (const w of WATERS) { if (x < w.bb[0] || x > w.bb[2] || z < w.bb[1] || z > w.bb[3]) continue; let ins = false; for (const o of w.outer) if (pip(x, z, o)) ins = true; for (const i of w.inner) if (pip(x, z, i)) ins = false; if (ins) return true; } return false; };
const inCampus = (x, z) => pip(x, z, CAMPUS);

function chaikin(pts, it = 2) {
  let p = pts;
  for (let k = 0; k < it; k++) { const q = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } p = q; }
  return p;
}
const XY = (() => {
  const ribbon = (line, w) => { const curve = new THREE.CatmullRomCurve3(line.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal'); const p = curve.getPoints(36).map(p => [p.x, p.z]); return offsetLine(p, w / 2).concat(offsetLine(p, -w / 2).reverse()); };
  return {
    labs: [
      { p: [[-202, -672], [-108, -672], [-124, -600], [-202, -622]], hole: [[-185, -650], [-121, -650], [-134, -617]], fl: 5, roof: 'glass' },
      { p: [[-232, -574], [-131, -574], [-149, -500], [-176, -500], [-232, -525]], hole: [[-214, -551], [-147, -551], [-159, -520]], fl: 5, roof: 'louver' },
    ],
    pods: [
      ribbon([[-116, -652], [-90, -648], [-66, -655], [-55, -677]], 18),
      ribbon([[-128, -611], [-106, -605], [-96, -590], [-103, -564], [-115, -552], [-144, -551]], 18),
      ribbon([[-158, -520], [-142, -509], [-132, -495], [-129, -476]], 18),
    ],
    glass: [
      [[-113, -643], [-94, -638], [-106, -612], [-126, -616]],
      [[-130, -593], [-112, -590], [-115, -575], [-134, -575]],
      [[-147, -543], [-133, -539], [-145, -511], [-158, -516]],
      [[-174, -500], [-148, -500], [-148, -477], [-174, -477]],
      [[-95, -691], [-75, -691], [-75, -677], [-95, -677]],
    ],
    plaza: chaikin([[-96, -641], [-47, -649], [-30, -627], [-47, -598], [-55, -572], [-24, -550], [-21, -516], [-33, -474], [-66, -457], [-104, -462], [-122, -477], [-121, -511], [-89, -548], [-78, -581], [-88, -608]], 2),
    lawns: [[-62, -623, 8], [-71, -526, 11.5], [-105, -524, 6.5], [-77, -488, 15]],
  };
})();
const XY_PODS = XY.pods.map((p) => ({ p, fl: 5 }));
const XY_LINKS = XY.labs.map((l) => l.p).concat(XY.glass);
PLAZAS.xueyuan = XY.plaza; PLAZAS.xyLawns = XY.lawns;
function bandedPod(poly, floors, fh) {
  const inner = insetPoly(poly, 0.75);
  for (let f = 0; f < floors; f++) {
    const y = f * fh;
    addWalls('trim:white', poly, y + fh - 0.72, y + fh);
    addCap('trim:white', poly, y + fh, false, [inner]); addCap('trim:white', poly, y + fh - 0.72, true, [inner]);
    addWalls('f:ribbonGlass', inner, y, y + fh - 0.72, 'abs');
  }
  addCap('roof:mid', inner, floors * fh - 0.72 + 0.02);
  addParapet('trim:white', poly, floors * fh, 0.7, 0.22);
}
function buildXueyuan(b) {
  const fh = 4.3, H = 5 * fh;
  for (const L of XY.labs) {
    const h = L.fl * fh;
    for (let f = 0; f < L.fl; f++) { const y = f * fh; addWalls('trim:white', L.p, y + fh - 0.72, y + fh); addWalls('f:ribbonGlass', insetPoly(L.p, 0.6), y, y + fh - 0.72, 'abs'); addCap('trim:white', L.p, y + fh - 0.72, true, [insetPoly(L.p, 0.6)]); }
    addWalls('plinth', insetPoly(L.p, -0.05), 0, 0.7);
    addWalls('f:labw', L.hole, 0, h, undefined, true);
    addCap('roof:mid', L.p, h, false, [L.hole]);
    addParapet('trim:white', L.p, h, 1.0); addWalls('trim:white', L.hole, h, h + 1.0, undefined, true); addWalls('trim:white', insetPoly(L.hole, -0.3), h, h + 1.0); addCap('trim:white', insetPoly(L.hole, -0.3), h + 1.0, false, [L.hole]);
    const bb = pBox(L.p), cz = (bb[1] + bb[3]) / 2;
    for (let k = 0; k < 16; k++) { const x = rr(bb[0] + 4, bb[2] - 4), z = rr(bb[1] + 3, bb[3] - 3); if (pip(x, z, L.p) && !pip(x, z, insetPoly(L.hole, -3)) && pip(x + 3, z, L.p) && pip(x - 3, z, L.p)) addBox('equip', x, h, z, rr(2, 6), rr(1.5, 4), rr(1, 2.6), 0, 'equip'); }
    void cz;
    if (L.roof === 'glass') {
      const hb = pBox(L.hole);
      addCap('glass:roof', insetPoly(L.hole, -0.1), h - 0.3);
    } else {
      addCap('glass:roof', L.hole, h - 0.6);
    }
    // Skylight ribs terminate on the triangular atrium boundary (r07 / s21).
    const [a, c, d] = L.hole;
    for (let t = 0.04; t < 1; t += L.roof === 'glass' ? 0.055 : 0.035) {
      addBeam(L.roof === 'glass' ? 'white' : 'trim:dark', [lerp(a[0], c[0], t), h - 0.1, lerp(a[1], c[1], t)], [lerp(a[0], d[0], t), h - 0.1, lerp(a[1], d[1], t)], L.roof === 'glass' ? 0.22 : 0.45);
    }
    for (let t = 0.15; t < 1; t += 0.15) addBeam('metal', [lerp(a[0], d[0], t), h, lerp(a[1], d[1], t)], [lerp(c[0], d[0], t), h, lerp(c[1], d[1], t)], 0.16);
    const serviceRing = insetPoly(L.p, 4.5);
    for (let j = 0; j < serviceRing.length; j++) {
      const a = serviceRing[j], c = serviceRing[(j + 1) % serviceRing.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      addBeam('equip', [a[0], h + 0.7, a[1]], [c[0], h + 0.7, c[1]], 0.4);
      for (let t = 3; t < len - 3; t += 4.5) {
        const x = lerp(a[0], c[0], t / len), z = lerp(a[1], c[1], t / len);
        if (pip(x, z, insetPoly(L.hole, -2))) continue;
        addBox('equip', x, h, z, 2.6, 1.7, 1.05, Math.atan2(c[1] - a[1], c[0] - a[0]));
        addCyl('metal', x, h + 1.05, z, 0.46, 0.38, 8);
        addCyl('white', x + 0.9, h, z + 0.6, 0.18, 2.1, 6);
      }
    }
  }
  for (const P of XY.pods) bandedPod(P, 5, fh);
  for (const gp of XY.glass) { addWalls('f:glass', gp, 0, H + 0.4); addCap('glass:roof', gp, H + 0.4); addParapet('trim:white', gp, H + 0.4, 0.5, 0.3); }
  for (const P of XY.pods) roofClutter(insetPoly(P, 2), H - 0.68, 20);
  addSign('学院实验楼', -60, 3.0, -661, 0.99, 0.12, 2.0, { color: '#3a3f44', family: '"Noto Sans SC", sans-serif', weight: 700, metal: 0.1 });
  for (const r of [15, 20, 25]) {
    const pts = []; for (let i = 0; i <= 32; i++) { const a = -Math.PI * 0.36 + i / 32 * Math.PI * 0.72; pts.push([-54 + Math.cos(a) * r, -561 + Math.sin(a) * r]); }
    addRibbon('stoneWarm', pts, 0.85, 0, 0.45);
  }
  b.h = H + 1.3; b.area = XY.labs.reduce((a, q) => a + Math.abs(pArea(q.p)), 0) + XY.pods.reduce((a, q) => a + Math.abs(pArea(q)), 0);
}
function roofClutter(p, y, n) {
  const ob = obb(p); if (ob.L < 14 || ob.W < 8) return;
  const k = Math.max(1, Math.min(Math.ceil(n / 3), Math.floor(ob.L / 16)));
  const at = (u, v) => [ob.cx + ob.ux * u - ob.uz * v, ob.cz + ob.uz * u + ob.ux * v];
  { const [x, z] = at(-ob.L * 0.32, 0); if (pip(x, z, p)) addBox('equip', x, y, z, 5, Math.min(5, ob.W * 0.4), 2.8, ob.ang, 'roof:mid'); }
  for (let i = 0; i < k; i++) {
    const [x, z] = at(-ob.L * 0.12 + (k > 1 ? ob.L * 0.38 * i / (k - 1) : ob.L * 0.15), 0);
    if (pip(x, z, p)) addBox('equip', x, y, z, 3.4, Math.min(2.4, ob.W * 0.25), 1.5, ob.ang, 'equip');
  }
}
function buildGeneric(b, idx) {
  if (/教学楼[A-E]/.test(b.name)) { buildAcademic(b); return; }
  const c = b.cls, h = b.h;
  addWalls('f:' + c.st, b.p, 0, h);
  addWalls('plinth', insetPoly(b.p, -0.05), 0, 0.65);
  if (c.hip) {
    addParapet(c.trim, b.p, h, 0.45, 0.25);
    const ob = obb(b.p); addHipRoof(c.roof, b.p, h + 0.45, Math.min(3.4, ob.W * 0.22), Math.min(5.5, ob.W * 0.32));
    b.h = h + 3.6;
  } else {
    addCap(c.roof, b.p, h);
    addParapet(c.trim, b.p, h, c.ph || 1.1);
    if (b.area > 400) roofClutter(b.p, h, Math.min(12, Math.round(b.area / 380)));
  }
  if (c.towers) {
    const ob = obb(b.p);
    for (const sgn of [-1, 1]) {
      const d = ob.L / 2 - 7, x = ob.cx + ob.ux * d * sgn, z = ob.cz + ob.uz * d * sgn;
      if (!pip(x, z, b.p)) continue;
      const tp = rectPoly(x, z, 7.2, 7.2, ob.ang);
      addWalls('f:' + c.st, tp, 0, h + 4.5); addCap('roof:light', tp, h + 4.5);
      const lp = rectPoly(x, z, 7.6, 7.6, ob.ang);
      addWalls('glassClear', lp, h + 4.5, h + 8.2); addCap('trim:white', lp, h + 8.2); addParapet('trim:white', lp, h + 8.2, 0.6, 0.25);
    }
  }
  if (/^dorm/.test(c.st)) {
    const e = edgeFacing(b.p, b.c[0] + 30, b.c[1] + 30, 12);
    if (e) for (let t = 0.25; t < 0.8; t += 0.5) addBox('trim:white', e.a[0] + (e.b[0] - e.a[0]) * t + e.nx * 1.2, 2.9, e.a[1] + (e.b[1] - e.a[1]) * t + e.nz * 1.2, 4, 2.4, 0.25, Math.atan2(e.dz, e.dx), 'trim:white');
    dormDetails(b, h);
  }
  if (!/^dorm/.test(c.st) && c.st !== 'canteen' && b.area > 300 && h > 6) addEntrance(b);
  if (c.st === 'lab' || c.st === 'labw' || c.st === 'whiteGreen') academicRoof(b.p, h);
  if (c.st === 'canteen') {
    const e = edgeFacing(b.p, b.c[0] - 60, b.c[1] + 60, 15), a = Math.atan2(e.dz, e.dx);
    for (let t = 3; t < e.len - 2; t += 4.2) addBox('stoneWarm', e.a[0] + e.dx * t + e.nx * 0.3, 1, e.a[1] + e.dz * t + e.nz * 0.3, 0.38, 0.65, h - 1, a);
    addBox('f:ribbonGlass', e.mx + e.nx * 0.2, 0.4, e.mz + e.nz * 0.2, 13, 0.4, 4.1, a);
    addBox('trim:white', e.mx + e.nx * 2.2, 4.6, e.mz + e.nz * 2.2, 16, 4.4, 0.4, a);
    for (const u of [-6.5, 6.5]) addCyl('metal', e.mx + e.dx * u + e.nx * 3.8, 0, e.mz + e.dz * u + e.nz * 3.8, 0.18, 4.6, 8);
  }
}
// Main entrance on the face nearest a road.
const NO_TREE = [];
function addEntrance(b) {
  let best = null, bd = 1e9;
  for (const r of D.r) for (const q of r.p) {
    const d = Math.hypot(q[0] - b.c[0], q[1] - b.c[1]);
    if (d < bd && !pip(q[0], q[1], b.p)) { bd = d; best = q; }
  }
  const e = best && bd < 250 ? edgeFacing(b.p, best[0], best[1], 9) : edgeFacing(b.p, b.c[0] + 1, b.c[1] + 60, 9);
  if (!e || e.len < 9) return;
  const a = Math.atan2(e.dz, e.dx), P = (u, v) => [e.mx + e.dx * u + e.nx * v, e.mz + e.dz * u + e.nz * v];
  { const [x, z] = P(0, 0.07); addBox('f:ribbonGlass', x, 0.12, z, 4.2, 0.1, 2.85, a); }
  for (const u of [-2.17, 2.17]) { const [x, z] = P(u, 0.1); addBox('metal', x, 0.12, z, 0.14, 0.2, 3.0, a); }
  for (const u of [-0.7, 0.7]) { const [x, z] = P(u, 0.13); addBox('metal', x, 0.12, z, 0.06, 0.08, 2.85, a); }
  { const [x, z] = P(0, 0.1); addBox('metal', x, 2.97, z, 4.48, 0.2, 0.16, a); }
  { const [x, z] = P(0, 1.55); addBox('trim:white', x, 3.35, z, 6.4, 3.1, 0.3, a, 'trim:white'); }
  for (const u of [-2.9, 2.9]) { const [x, z] = P(u, 2.85); addCyl('metal', x, 0, z, 0.1, 3.35, 10); }
  { const [x, z] = P(0, 1.6); addBox('stoneWarm', x, 0, z, 6.8, 3.2, 0.14, a, 'stoneWarm'); }
  { const [x, z] = P(0, 4); NO_TREE.push(rectPoly(x, z, 10, 9, a)); }
  const name = (b.name || '').split(' / ')[0].replace(/^[A-Z]\s*/, '');
  if (name && name.length <= 8 && !/[（(]/.test(name)) { const [x, z] = P(0, 3.11); addSign(name, x, 3.5, z, e.nx, e.nz, 0.36, { color: '#3a3f44', family: '"Noto Sans SC", sans-serif', weight: 700, metal: 0.1 }); }
}
function academicRoof(p, h) {
  for (let i = 0; i < p.length; i++) {
    const e = edgeOutward(p, i); if (e.len < 25) continue;
    const a = Math.atan2(e.dz, e.dx);
    addBox('trim:grey', e.mx - e.nx * 1.4, h + 1.9, e.mz - e.nz * 1.4, e.len - 2, 0.35, 0.35, a);
    for (let t = 2; t < e.len - 1; t += 3.2) {
      const x = e.a[0] + e.dx * t, z = e.a[1] + e.dz * t;
      addBeam('trim:white', [x, h + 2, z], [x - e.nx * 4, h + 2, z - e.nz * 4], 0.22);
      if (Math.round(t / 3.2) % 3 === 0) addBox('trim:white', x - e.nx * 1.4, h, z - e.nz * 1.4, 0.35, 0.35, 2.1, a);
    }
  }
}
function buildAcademic(b) {
  const h = /教学楼C/.test(b.name) ? 16.5 : b.h, parts = b.parts || [b.p];
  // Stair tower rising above the roof: stone shaft, a glazed top storey in a white frame (r38).
  // The corner towers of 求实楼 and 求新楼 are whole bays, so they keep the window grid below the roof line.
  const glassTop = (tp, ang, big) => {
    if (big) { addWalls('f:teach', tp, 0, h); addWalls('plinth', tp, 0, 0.5); addWalls('f:stone', tp, h, h + 1.4); }
    else addWalls('f:stone', tp, 0, h + 1.4);
    addCap('roof:mid', tp, h + 1.4);
    addWalls('f:ribbonGlass', insetPoly(tp, 0.6), h + 1.4, h + 5.2);
    for (const q of tp) addBox('trim:white', q[0], h + 1.2, q[1], 0.5, 0.5, 4.3, ang);
    if (big) { addCap('roof:mid', tp, h + 5.4); addParapet('trim:white', tp, h + 5.4, 0.55, 0.35); }
    else addCap('trim:white', tp, h + 5.4);
  };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i], ob = obb(p);
    if (i >= 4) { glassTop(p, ob.ang, true); continue; }
    addWalls(b.parts ? 'f:teach' : 'stoneFacade', p, 0, h); addWalls('plinth', p, 0, 0.5);
    addCap('roof:dark', p, h); addParapet('trim:grey', p, h, 0.6, 0.3);
    if (b.parts && i < 2) academicRoof(p, h);
    roofClutter(p, h, i < 2 ? 3 : 1);
    // Wings without a corner tower get a stair tower with a glazed top at the avenue end.
    if (b.parts && i < 2 && !b.parts.tw[i] && ob.L > 50) {
      const sg = ob.ux * -0.84 + ob.uz * -0.54 > 0 ? 1 : -1;
      const x = ob.cx + ob.ux * sg * (ob.L / 2 - 3.2), z = ob.cz + ob.uz * sg * (ob.L / 2 - 3.2);
      glassTop(rectPoly(x, z, 6.4, ob.W + 0.5, ob.ang), ob.ang);
    }
  }
  if (b.parts) {
    // Garden court inside the ring.
    const oc = obb(b.parts.court);
    addCap('garden', insetPoly(b.parts.court, 0.6), 0.03);
    addBox('deck', oc.cx, 0.02, oc.cz, oc.L - 1.2, 2.6, 0.04, oc.ang); addBox('deck', oc.cx, 0.02, oc.cz, 2.6, oc.W - 1.2, 0.04, oc.ang);
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      const u = su * oc.L / 4, v = sv * oc.W / 4;
      TEACH_TREES.push(['camphor', oc.cx + oc.ux * u - oc.uz * v, oc.cz + oc.uz * u + oc.ux * v, 0.72]);
    }
    b.area = b.parts.reduce((sum, p) => sum + Math.abs(pArea(p)), 0);
    b.h = h + 5.4;
    return;
  }

  // 求真楼: white two-storey portico, entrance steps and the statue on the forecourt axis.
  const F = TEACH_FORE;
  const e = F
    ? { mx: F.ob.cx + F.fx * F.f0, mz: F.ob.cz + F.fz * F.f0, nx: F.fx, nz: F.fz, dx: F.sx, dz: F.sz, len: F.ob.W }
    : edgeFacing(b.p, b.c[0] - 84, b.c[1] - 54, 10);
  const a = Math.atan2(e.dz, e.dx), width = Math.min(16, e.len - 2);
  for (const u of [-8, 0, 8]) addBox('f:ribbonGlass', e.mx + e.dx * u + e.nx * 0.06, 12.4, e.mz + e.dz * u + e.nz * 0.06, u === 0 ? 6.2 : 4.3, 0.12, 2.4, a);
  addBox('f:libPodium', e.mx + e.nx * 0.06, 1, e.mz + e.nz * 0.06, width - 2, 0.14, 3.8, a);
  for (let i = 0; i < 6; i++) addBox('stone', e.mx + e.nx * (3.8 - i * 0.5), 0, e.mz + e.nz * (3.8 - i * 0.5), width, 0.52, (i + 1) * 0.17, a);
  addBox('dark', e.mx + e.nx * 0.18, 5, e.mz + e.nz * 0.18, width - 3, 0.3, 5, a);
  addBox('trim:white', e.mx + e.nx * 2, 10.4, e.mz + e.nz * 2, width, 3.8, 0.45, a);
  for (const u of [-width / 2 + 0.5, width / 2 - 0.5]) addBox('trim:white', e.mx + e.dx * u + e.nx * 3, 1, e.mz + e.dz * u + e.nz * 3, 0.45, 0.45, 9.4, a);
  {
    const x = e.mx + e.nx * 11, z = e.mz + e.nz * 11;
    addBox('stoneWarm',x,0.05,z,1.7,1.7,0.9,a);
    // Simplified standing stone figure; facial likeness is not inferred.
    addCyl('stoneWarm',x,0.95,z,0.43,1.65,9,0.3);
    addCyl('stoneWarm',x,2.6,z,0.19,0.36,10,0.16);
    for (const s of [-1,1]) { addBeam('stoneWarm',[x+e.dx*s*0.25,2.37,z+e.dz*s*0.25],[x+e.dx*s*0.42,1.35,z+e.dz*s*0.42],0.15); }
  }
  if (F) {
    const D = F.f1 - F.f0, fa = Math.atan2(F.fz, F.fx), sa = Math.atan2(F.sz, F.sx), P = (f, s) => F.at(F.f0 + f, s);
    const rect = (f0, f1, s0, s1) => { const [x, z] = P((f0 + f1) / 2, (s0 + s1) / 2); return rectPoly(x, z, f1 - f0, s1 - s0, fa); };
    // Forecourt: stone paving between the wings, a brick-paved axis from the steps out through the gap between the corner towers.
    addCap('deck', rect(0, D, -F.left, F.right), 0.03);
    addCap('paveBrick', rect(3.8, D + 6, -9, 9), 0.045);
    for (const s of [-1, 1]) {
      // Red-leaf hedge beds with a row of round trees, then a clipped green hedge towards the wings (r21).
      const [bx, bz] = P(5 + (D - 8) / 2, s * 12.5);
      addBox('stone', bx, 0, bz, D - 8, 4.6, 0.3, fa); addBox('redPlant', bx, 0.3, bz, D - 8.4, 4, 0.55, fa);
      const [gx, gz] = P(5 + (D - 8) / 2, s * 16.5);
      addBox('garden', gx, 0, gz, D - 8, 1.6, 1.05, fa);
      for (let f = 7; f < D - 3; f += 6) TEACH_TREES.push(['camphor', ...P(f, s * 12.5), 0.55]);
      for (let f = 4; f < D - 1; f += 7) TEACH_TREES.push(['ginkgo', ...P(f, s * (s > 0 ? F.right : F.left) - s * 5), 0.7]);
    }
    // A row of four red planters at the edge of the court.
    for (const s of [-10.5, -3.5, 3.5, 10.5]) { const [x, z] = P(D - 2.5, s); addBox('redcol', x, 0.05, z, 1.7, 1.7, 0.95, fa, 'garden'); }
    // Open corridors on three floors from both sides of 求真楼 to the wings, set back from its front face (r38).
    const fc = -7, w = 5.2;
    for (const s of [1, -1]) {
      const [ox, oz] = P(fc, 0), t0 = rayPoly(b.p, ox, oz, F.sx * s, F.sz * s), t1 = F.hit(ox, oz, F.sx * s, F.sz * s);
      if (!isFinite(t0) || !isFinite(t1) || t1 - t0 < 1 || t1 - t0 > 25) continue;
      const len = t1 - t0 + 0.4, [x, z] = P(fc, s * (t0 + t1) / 2);
      for (let lv = 1; lv <= 4; lv++) {
        const y = lv * 4 - 0.35;
        addBox('trim:white', x, y, z, len, w, 0.4, sa, lv === 4 ? 'roof:dark' : undefined);
        if (lv < 4) for (const k of [-1, 1]) addBox('stone', x + F.fx * k * (w / 2 - 0.12), y + 0.4, z + F.fz * k * (w / 2 - 0.12), len, 0.24, 1.05, sa);
      }
    }
  }
  b.h = h + 5.4;
}
function dormDetails(b, h) {
  const modern = b.cls.st === 'dormStripe';
  for (let i = 0; i < b.p.length; i++) {
    const e = edgeOutward(b.p, i), a = Math.atan2(e.dz, e.dx);
    if (e.len < 18) continue;
    if (modern) {
      for (let f = 1; f <= b.cls.fl; f++) addBox('trim:white', e.mx + e.nx * 0.25, f * b.cls.fh - 0.75, e.mz + e.nz * 0.25, e.len, 0.55, 0.75, a);
      for (let t = 4; t < e.len - 2; t += 8) addBox('trim:white', e.a[0] + e.dx * t + e.nx * 0.35, h, e.a[1] + e.dz * t + e.nz * 0.35, 0.35, 0.35, 1.6, a);
      addBox('trim:white', e.mx, h + 1.5, e.mz, e.len, 0.45, 0.25, a);
    } else if (e.nz > 0.25) {
      const bays = Math.max(1, Math.round(e.len / FAC[b.cls.st].bw)), bayWidth = e.len / bays;
      for (let k = 0; k < bays; k++) {
        const t = (k + 0.5) * bayWidth;
        const x = e.a[0] + e.dx * t, z = e.a[1] + e.dz * t;
        for (let f = 1; f < b.cls.fl; f++) {
          const y = f * b.cls.fh;
          addBox('trim:white', x + e.nx * 0.6, y - 0.12, z + e.nz * 0.6, 2.7, 1.3, 0.2, a);
          addBox('trim:grey', x + e.nx * 1.2, y + 0.55, z + e.nz * 1.2, 2.7, 0.12, 0.48, a);
          const ax = x + e.dx * bayWidth * 0.4 + e.nx * 0.32, az = z + e.dz * bayWidth * 0.4 + e.nz * 0.32;
          addBox('equip', ax, y + 1.65, az, 0.62, 0.5, 0.52, a);
          addBox('trim:grey', ax + e.nx * 0.27, y + 1.72, az + e.nz * 0.27, 0.38, 0.03, 0.36, a);
        }
      }
      if (b.cls.st === 'dormBeige') for (const t of [1.1, e.len - 1.1]) addBox('terracotta', e.a[0] + e.dx * t + e.nx * 0.2, 0.6, e.a[1] + e.dz * t + e.nz * 0.2, 1.3, 0.5, h - 0.6, a);
    }
  }
}
function buildWende(b) {
  const { H, slab, wing, podium } = WENDE;
  const rail = (poly, y) => {
    const ring = insetPoly(poly, 0.18).concat([insetPoly(poly, 0.18)[0]]), cum = cumLen(ring), L = cum[cum.length - 1];
    for (let d = 0; d < L; d += 2.4) { const q = sampleAt(ring, cum, d); addBox('equip', q.x, y, q.z, 0.06, 0.06, 1.05, 0); }
    addWalls('equip', insetPoly(poly, 0.16), y + 1.0, y + 1.06); addWalls('equip', insetPoly(poly, 0.2), y + 1.0, y + 1.06, undefined, true);
  };
  for (const p of [slab, wing]) {
    addWalls('f:wende', p, 0, H); addWalls('plinth', insetPoly(p, -0.04), 0, 0.6);
    addCap('roof:light', p, H); addParapet('wendeBeige', p, H, 0.9, 0.3); rail(p, H + 0.9);
  }
  roofClutter(slab, H, 6); roofClutter(wing, H, 2);
  // the wing's south gable: bands without the ribbon windows, one window per floor in the middle
  addBox('f:wendeSolid', 442.5, 0, -348.44, 12.1, 0.12, H, 0);
  for (let f = 0; f < 9; f++) { addBox('trim:dark', 442.5, f * 3.3 + 1.05, -348.35, 1.9, 0.08, 1.6, 0); addBox('museumGlass', 442.5, f * 3.3 + 1.12, -348.3, 1.6, 0.06, 1.42, 0); }
  // curved single-storey podium with its entrance canopy, steps and roof units
  addWalls('f:wendePodium', podium, 0, 5.6); addCap('roof:light', podium, 5.6); addParapet('wendeBeige', podium, 5.6, 0.5, 0.25);
  addBox('museumGlass', 418.2, 3.55, -341.6, 9.5, 2.8, 0.14, 0); addBox('trim:dark', 418.2, 3.69, -341.6, 9.7, 3.0, 0.06, 0);
  for (const [z, w] of [[-341.2, 11], [-340.4, 12.5], [-339.6, 14]]) addBox('concrete', 418.2, 0, z, w, 0.8, z === -341.2 ? 0.45 : z === -340.4 ? 0.3 : 0.15, 0);
  for (const x of [404, 409.5, 427, 432.5]) addBox('trim:white', x, 5.6, -349.6, 2.3, 1.7, 1.9, 0, 'equip');
  b.h = H + 2;
}
function buildGraduate(b) {
  const fl=b.cls.fl||18,h=b.cls.h||fl*3.2;
  addWalls('f:beigeBand',b.p,0,h);addWalls('plinth',b.p,0,.65);
  for(let f=1;f<=fl;f++)addWalls('stoneWarm',insetPoly(b.p,-.18),f*3.2-.25,f*3.2);
  addCap('roof:light',b.p,h);addParapet('stoneWarm',b.p,h,.9,.3);roofClutter(b.p,h,7);
  const e=edgeFacing(b.p,b.c[0],b.c[1]+80,25)||edgeFacing(b.p,b.c[0],b.c[1]+80,6);
  if(e){const a=Math.atan2(e.dz,e.dx);
  addBox('f:glassGrey',e.mx+e.nx*.2,0,e.mz+e.nz*.2,8,.4,4.2,a);
  addBox('stoneWarm',e.mx+e.nx*2,4.1,e.mz+e.nz*2,10,4.2,.35,a);}
  b.h=h+.9;
}
function buildHighDorm(b) {
  const fl = b.cls.fl || 8, h = fl * 3.15, ob = obb(b.p), sg = ob.ux >= 0 ? 1 : -1;
  addWalls('f:beigeBand', b.p, 0, h); addWalls('plinth', insetPoly(b.p, -0.05), 0, 0.8);
  for (let f = 1; f <= fl; f++) addWalls('stoneWarm', insetPoly(b.p, -0.15), f * 3.15 - 0.22, f * 3.15);
  addCap('roof:light', b.p, h); addParapet('stoneWarm', b.p, h, 1.0, 0.3);
  for (let v = -ob.W / 2 + 3; v < ob.W / 2 - 2.5; v += 3.2) addBox('solar', ob.cx - ob.uz * v - ob.ux * sg * 5, h + 0.35, ob.cz + ob.ux * v - ob.uz * sg * 5, ob.L - 18, 2.1, 0.2, ob.ang, 'solar');
  const r = ob.W * 0.45, ex = ob.cx + ob.ux * sg * ob.L / 2, ez = ob.cz + ob.uz * sg * ob.L / 2, semi = [];
  for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + Math.PI * i / 12, du = Math.cos(a) * r * sg, dv = Math.sin(a) * r; semi.push([ex + ob.ux * du - ob.uz * dv, ez + ob.uz * du + ob.ux * dv]); }
  if (pArea(semi) < 0) semi.reverse();
  addWalls('f:glassGrey', semi, 0, h + 1.2); addCap('roof:light', semi, h + 1.2);
  for (let f = 1; f <= fl; f++) addPrism('trim:white', insetPoly(semi, -0.5), f * 3.15 - 0.3, f * 3.15);
  const e = edgeFacing(b.p, ob.cx, ob.cz + 80, 20), a = Math.atan2(e.dz, e.dx);
  addBox('f:glassGrey', e.mx + e.nx * 0.2, 0, e.mz + e.nz * 0.2, 10, 0.4, 4.4, a);
  addBox('stoneWarm', e.mx + e.nx * 2.2, 4.3, e.mz + e.nz * 2.2, 13, 4.4, 0.35, a);
  b.h = h + 1.2;
}
function buildConstruction(b) {
  const p=b.p,ring=p.concat([p[0]]),cum=cumLen(ring),L=cum[cum.length-1];
  addWalls('f:beigeBand',insetPoly(p,.35),0,28.8);
  for(let f=0;f<18;f++){
    const y=(f+1)*3.2;
    addWalls('concrete',p,y-.24,y);addCap('concrete',p,y);addCap('concrete',p,y-.24,true);
    if(f>=8) for(let d=1.8;d<L;d+=5.8){const q=sampleAt(ring,cum,d);addBox('concrete',q.x,f*3.2,q.z,.5,.5,3.2,0);}
  }
  addBox('concrete',540,0,-356,8,7,61,0);
  b.h=61;
}
function buildGardenService(b){
  addWalls('f:plain',b.p,0,5.8);addCap('roof:light',b.p,5.8);addParapet('trim:white',b.p,5.8,.45,.25);
  const ob=obb(b.p),p=rectPoly(ob.cx-ob.ux*3,ob.cz-ob.uz*3,7,9,ob.ang);
  addPrism('trim:white',p,5.8,6.35);addCap('poolBlue',insetPoly(p,.4),6.36);b.h=6.5;
}
function buildNortheastSite(){
  OWNER=-1;
  for(let i=0;i<NE.site.length;i++){
    const e=edgeOutward(NE.site,i),a=Math.atan2(e.dz,e.dx);
    for(let d=1.5;d<e.len;d+=3){const x=e.a[0]+e.dx*d,z=e.a[1]+e.dz*d;if(x<440&&Math.abs(z+428)<5)continue;addBox('siteFence',x,0,z,2.9,.16,2.3,a);addBox('metal',x,0,z,.09,.14,2.45,a);}
  }
  for(let i=0;i<9;i++)addBox('concrete',551+(i%3)*3,0,-418+Math.floor(i/3)*3,2.3,1.3,.8,0);
  const ob=obb(NE.beds);
  for(let v=-ob.W/2+3;v<ob.W/2-2;v+=5){let line=[];
    for(let u=-ob.L/2+2;u<ob.L/2-1;u+=2){const p=[ob.cx+ob.ux*u-ob.uz*v,ob.cz+ob.uz*u+ob.ux*v];if(pip(...p,NE.beds))line.push(p);}
    if(line.length>1)addRibbon('garden',line,1.1,.03,.35);
  }
}
function buildAdmin(b) {
  const h = 28.2;
  addWalls('f:confDark', b.p, 0, 9.2); addWalls('plinth', insetPoly(b.p, -0.05), 0, 0.8);
  framedUpper(b.p, 9.2, h, 4, 'adminPanel', 'adminGlass', 'adminFrame');
  addCap('roof:mid', b.p, h); addParapet('adminFrame', b.p, h, 1.2, 0.35); roofClutter(b.p, h, 5);
  const e = edgeFacing(b.p, b.c[0] + 10, b.c[1] + 200, 20), ang = Math.atan2(e.dz, e.dx);
  addBox('adminPanel', e.mx + e.nx * 3, 4.5, e.mz + e.nz * 3, 18, 6, 0.5, ang);
  for (const t of [-7, 7]) addBox('adminPanel', e.mx + e.dx * t + e.nx * 5.5, 0, e.mz + e.dz * t + e.nz * 5.5, 0.65, 0.65, 4.5, ang);
  b.h = h + 1.2;
}
function framedUpper(p, bottom, top, rows, wallKey = 'stoneFacade', glassKey = 'f:ribbonGlass', frameKey='stoneWarm') {
  addWalls(wallKey, p, bottom, top);
  for (let i = 0; i < p.length; i++) {
    const e = edgeOutward(p, i), ang = Math.atan2(e.dz, e.dx), usable = e.len - 6;
    if (usable < 6) continue;
    const groups = e.len > 45 ? [0.35, 0.16, 0.35] : [0.7];
    let u = -usable / 2;
    for (const fraction of groups) {
      const width = usable * fraction;
      for (let f = 0; f < rows; f++) {
        const y = bottom + 1.2 + f * (top - bottom - 2.5) / rows;
        const height = (top - bottom - 2.5) / rows - 1.15;
        addBox(glassKey, e.mx + e.dx * (u + width / 2) + e.nx * 0.03, y, e.mz + e.dz * (u + width / 2) + e.nz * 0.03, width, 0.08, height, ang);
        for (let k = 2.2; k < width; k += 2.2) addBox('metal', e.mx + e.dx * (u + k) + e.nx * 0.12, y, e.mz + e.dz * (u + k) + e.nz * 0.12, 0.08, 0.12, height, ang);
      }
      u += width + usable * 0.07;
    }
    for (const t of [-e.len / 2 + 1.5, e.len / 2 - 1.5]) addBox(frameKey, e.mx + e.dx * t + e.nx * 0.35, bottom, e.mz + e.dz * t + e.nz * 0.35, 3, 0.9, top - bottom, ang);
    for (const y of [bottom, top - 1.7]) addBox(frameKey, e.mx + e.nx * 0.35, y, e.mz + e.nz * 0.35, e.len + 0.6, 0.9, 1.7, ang);
  }
}
function buildLibrary(b) {
  const P = b.p, c = b.c, plazaQ = D.sq.reduce((best, q) => { const qc = pCentroid(q.p); return !best || Math.hypot(qc[0] - c[0], qc[1] - c[1]) < Math.hypot(pCentroid(best.p)[0] - c[0], pCentroid(best.p)[1] - c[1]) ? q : best; }, null), plaza = pCentroid(plazaQ.p);
  const fe = edgeFacing(P, plaza[0], plaza[1], 15) || edgeFacing(P, plaza[0], plaza[1], 1);
  const west = fe.b[0] < fe.a[0], o = west ? fe.b : fe.a, dx = west ? -fe.dx : fe.dx, dz = west ? -fe.dz : fe.dz, nx = fe.nx, nz = fe.nz, L = fe.len, fang = Math.atan2(dz, dx);
  const at = (a, d) => [o[0] + dx * a - nx * d, o[1] + dz * a - nz * d];
  const rect = (a0, a1, d0, d1) => [at(a0, d0), at(a1, d0), at(a1, d1), at(a0, d1)];
  const box = (key, a0, a1, d0, d1, y0, h, cap) => { const [x, z] = at((a0 + a1) / 2, (d0 + d1) / 2); addBox(key, x, y0, z, a1 - a0, d1 - d0, h, fang, cap); };
  MAT.libFrame ||= baseAO(plainMat('#cbc6bd', { map: MAT.stoneWarm.map, roughness: 0.85 }));
  MAT.libTerrace ||= plainMat('#c4a77f', { map: MAT['roof:light'].map, roughness: 0.92 });
  const podH = 9.6, top = 33.6, aE = L, wing = (q) => { addWalls('f:libPodium', q, 0, podH); addWalls('plinth', insetPoly(q, -0.05), 0, 0.7); addCap('libTerrace', q, podH); addParapet('libFrame', q, podH, 1.1, 0.35); };
  wing(rect(68, aE, 0, 56)); wing(rect(0, 13, 0, 58)); wing(rect(13, 40, 47, 60)); wing(rect(40, 68, 49, 58));
  for (let a = 70.5; a < aE - 1; a += 6.2) box('libFrame', a - 0.7, a + 0.7, -1.3, 0, 0, podH);
  for (const a of [1.8, 7, 12]) box('libFrame', a - 0.7, a + 0.7, -1.3, 0, 0, podH);
  const tp = rect(8, 72, 10, 50);
  framedUpper(tp, podH, top, 5, 'stoneFacade', 'f:ribbonGlass', 'libFrame');
  addCap('stoneFacade', tp, podH, true); addCap('roof:mid', tp, top); addParapet('libFrame', tp, top, 1.0, 0.4);
  addPrism('glass:roof', rect(32, 50, 22, 36), top - 0.1, top + 1.4);
  roofClutter(insetPoly(tp, 4), top, 6);
  box('libFrame', 63.5, 72.8, 9.2, 50.8, podH, top - podH + 1.0);
  box('f:ribbonGlass', 66.6, 69.6, 9.05, 9.2, podH + 2, top - podH - 4);
  box('f:ribbonGlass', 72.8, 72.95, 25, 35, podH + 1.6, top - podH - 3.2);
  for (let y = podH + 6.4; y < top - 2; y += 4.8) box('libFrame', 72.8, 73.1, 25, 35, y, 0.35);
  addWalls('museumGlass', rect(11.5, 68.5, 14, 47), 0, podH);
  for (let a = 12; a <= 68.1; a += 8) box('libFrame', a - 0.75, a + 0.75, 10.2, 11.7, 0, podH);
  const terH = 4.8, s0 = 18, s1 = 44, stD = 14, n = 27;
  box('stoneWarm', 12, 68, -1, 10.2, 0, terH, 'deck');
  box('glassClear', 12, s0, -1.05, -0.85, terH, 1.1); box('glassClear', s1, 68, -1.05, -0.85, terH, 1.1);
  box('metal', 12, s0, -1.1, -0.8, terH + 1.1, 0.08); box('metal', s1, 68, -1.1, -0.8, terH + 1.1, 0.08);
  box('museumGlass', 47, 66, -1.12, -1.0, 0.4, 3.4);
  for (let k = 0; k < n; k++) { const d0 = -1 - (n - k) * stD / n; box('stone', s0, s1, d0, d0 + stD / n + 0.02, 0, terH * (k + 1) / n, 'stoneWarm'); }
  const ramp = (x, z) => 1.05 + terH * (1 - clamp(((x - o[0]) * nx + (z - o[1]) * nz - 1) / stD, 0, 1));
  for (const a of [s0 - 0.35, s1 + 0.35]) { const [x, z] = at(a, -1 - stD / 2); addSlopedPrism('libFrame', rectPoly(x, z, stD, 0.7, Math.atan2(nz, nx)), 0, ramp, 'libFrame'); }
  { const [x, z] = at(24, 9.6); addSign('图 书 馆', x, podH + 3.4, z, nx, nz, 1.5, { color: '#c9a24a', fs: 120, metal: 0.6, rough: 0.45 }); }
  {
    const [sx, sz] = at(40, 13), y0 = top + 1.4, sw = 34;
    for (let t = -0.5; t <= 0.5001; t += 1 / 6) addBox('metal', sx + dx * sw * t, y0, sz + dz * sw * t, 0.22, 0.22, 4.4, fang, 'metal');
    for (const yy of [y0 + 0.3, y0 + 4.2]) addBox('metal', sx, yy, sz, sw, 0.18, 0.18, fang, 'metal');
    addSign('中国药科大学', sx + nx * 0.25, y0 + 2.7, sz + nz * 0.25, nx, nz, 5.2, { color: '#c21c26', fs: 170, gap: 0.12, metal: 0.05, rough: 0.65, glow: '#ff3030', family: '"Noto Serif SC", "Songti SC", serif' });
  }
  {
    const [x, z] = at(8, -24), h = 18;
    addBox('stoneWarm', x, 0, z, 2.2, 2.2, 0.3, fang, 'stoneWarm'); addBox('granite', x, 0.3, z, 1.1, 1.1, 0.35, fang, 'granite');
    addCyl('metal', x, 0.65, z, 0.14, h - 0.65, 12, 0.075); addDisc('gold', x, h, z, 0.15, 0.28, 10);
    FLAGS.push({ x, z, top: h - 0.25, ang: fang });
  }
  for (const a of [-1, 5, 11, 47, 54, 61, 68, 75, 82]) { const [x, z] = at(a, -9.5); addBox('stoneWarm', x, 0, z, 1.8, 1.8, 0.18, fang, 'garden'); LIB_TREES.push([x, z]); }
  {
    const rock = new THREE.IcosahedronGeometry(1, 1), pp = rock.attributes.position, rn = mulberry(1936);
    for (let i = 0; i < pp.count; i++) { const k = 0.82 + rn() * 0.36; pp.setXYZ(i, pp.getX(i) * k, pp.getY(i) * k, pp.getZ(i) * k); }
    rock.scale(2.6, 1.3, 1.5); rock.rotateY(fang + 0.4); const [x, z] = at(20, -43); rock.translate(x, 0.9, z); addGeo('granite', rock); rock.dispose();
  }
  for (let k = 0; k < 3; k++) {
    const [x, z] = at(108 - k * 1.6, -26 - k * 1.4), w = 15 - k * 3.5, d = 4 - k * 0.6;
    addBox('stoneWarm', x, 0, z, w, d, 0.45 * (k + 1), fang, k % 2 ? 'redPlant' : 'garden');
  }
  LIB_PLAZA.x = plaza[0]; LIB_PLAZA.z = plaza[1];
  { const tq = rect(12, 68, -1, 10.2), sq = rect(s0, s1, -1 - stD, -1); STEP_SURF.push((x, z) => pip(x, z, tq) ? terH : pip(x, z, sq) ? Math.max(0.01, terH * (1 - clamp(((o[0] - x) * nx + (o[1] - z) * nz - 1) / stD, 0, 1))) : 0); }
  { const [x, z] = at(40, -60); b.front = { x, z }; }
  b.h = top + 7.6;
}
function buildMuseum(b) {
  const P = b.p, lib = byName(/^图书馆$/);
  const ob = obb(P), ax = [ob.ux, ob.uz];
  const hf = (x, z) => 12.5 + 5.5 * clamp(((x - ob.cx) * ax[0] + (z - ob.cz) * ax[1]) / ob.L + 0.5, 0, 1);
  addSlopedPrism('museumGlass', P, 0, hf, 'roof:mid');
  addWalls('plinth', insetPoly(P, -0.05), 0, 0.7);
  const fe = edgeFacing(P, lib ? lib.c[0] - 40 : b.c[0], lib ? lib.c[1] + 80 : b.c[1] + 50, 6);
  const ang = Math.atan2(fe.dz, fe.dx);
  const x = fe.a[0] + fe.nx * 1.5 + fe.dx * 3, z = fe.a[1] + fe.nz * 1.5 + fe.dz * 3;
  addBox('f:stone', x, 0, z, 8, 2.4, 18, ang, 'granite');
  addSign('药学博物馆', x + fe.nx * 1.25, 10, z + fe.nz * 1.25, fe.nx, fe.nz, 9, { vertical: true, color: '#e8e4da', fs: 110, metal: 0.1, glow: '#fff2d0' });
  for (let i = 0; i < P.length; i++) {
    const e = edgeOutward(P, i); if (e.len < 6) continue;
    const ya = hf(e.a[0], e.a[1]), yb = hf(e.b[0], e.b[1]);
    addBeam('stoneWarm', [e.a[0] + e.nx * 1.1, ya, e.a[1] + e.nz * 1.1], [e.b[0] + e.nx * 1.1, yb, e.b[1] + e.nz * 1.1], 2.2);
    for (const q of [e.a, e.b]) addBox('stoneWarm', q[0], 0, q[1], 1.3, 1.3, hf(...q), 0);
    for (let t = 2.4; t < e.len; t += 2.4) { const x = e.a[0] + e.dx * t, z = e.a[1] + e.dz * t; addBeam('metal', [x, 0.8, z], [x, hf(x, z) - 0.5, z], 0.09); }
    for (let y = 3; y < Math.min(ya, yb) - 0.8; y += 2.8) addBeam('metal', [e.a[0], y, e.a[1]], [e.b[0], y, e.b[1]], 0.08);
  }
  const front = edgeFacing(P, b.c[0] - 30, b.c[1] + 120, 18), fa = Math.atan2(front.dz, front.dx);
  const right = [front.nz, -front.nx], px = front.mx + right[0] * front.len * 0.37 + front.nx * 4, pz = front.mz + right[1] * front.len * 0.37 + front.nz * 4;
  addBox('stoneWarm', px, 11.3, pz, 13, 8, 1.5, fa);
  for (const s of [-1, 1]) addBox('stoneWarm', px + right[0] * s * 5.5 + front.nx * 3, 0, pz + right[1] * s * 5.5 + front.nz * 3, 1.5, 1.5, 11.3, fa);
  addBox('stoneWarm', front.mx + front.nx * 1.2, 3.4, front.mz + front.nz * 1.2, front.len - 3, 2.5, 0.65, fa);
  b.h = 19;
}
function buildConference(b) {
  const C = [-487.9, 123.2], R = 69.3, arc = [];
  for (let a = 70.3; a <= 147.01; a += 77 / 28) { const r = a * Math.PI / 180; arc.push([C[0] + Math.cos(r) * R, C[1] + Math.sin(r) * R]); }
  const P = [[-546, 112.5], [-485, 112.5], [-485, 158], [-464.5, 158], ...arc];
  if (pArea(P) < 0) P.reverse();
  const h = 9.6;
  addWalls('f:glassGrey', insetPoly(P, 0.9), 0, 4.4); addWalls('plinth', insetPoly(P, 0.85), 0, 0.5);
  addCap('stoneFacade', insetPoly(P, 0.9), 4.4, true);
  addWalls('stoneFacade', P, 4.4, h); addCap('roof:dark', P, h); addParapet('stoneWarm', P, h, 0.8, 0.35);
  const big = insetPoly(P, -1.4);
  addWalls('trim:white', big, 4.3, 4.85); addCap('trim:white', big, 4.85, false, [P]); addCap('trim:white', big, 4.3, true, [P]);
  for (let i = 0; i < P.length; i++) {
    const e = edgeOutward(P, i), a = Math.atan2(e.dz, e.dx); if (e.len < 1.5) continue;
    addBox('f:ribbonGlass', e.mx + e.nx * 0.05, 5.9, e.mz + e.nz * 0.05, e.len + 0.05, 0.1, 2.3, a);
    addBox('stoneWarm', e.mx + e.nx * 0.1, 8.2, e.mz + e.nz * 0.1, e.len + 0.1, 0.25, 0.25, a);
  }
  const ring = big.concat([big[0]]), cum = cumLen(ring);
  for (let t = 2; t < cum[cum.length - 1]; t += 6.5) { const q = sampleAt(ring, cum, t), x = q.x - q.dz * 0.25, z = q.z + q.dx * 0.25; if (!pip(x, z, insetPoly(P, -0.2))) addCyl('stoneWarm', x, 0, z, 0.22, 4.3, 10); }
  const hall = [[-537.4, 118.8], [-507.3, 118.8], [-507.3, 147.6], [-537.4, 147.6]];
  addWalls('stoneFacade', hall, h, 18); addCap('roof:light', hall, 18); addParapet('stoneWarm', hall, 18, 0.9, 0.4);
  for (let i = 0; i < 4; i++) {
    const e = edgeOutward(hall, i), a = Math.atan2(e.dz, e.dx);
    for (let t = 1.5; t < e.len - 1; t += 2.4) addBox('stoneWarm', e.a[0] + e.dx * t + e.nx * 0.3, h, e.a[1] + e.dz * t + e.nz * 0.3, 0.35, 0.6, 18 - h, a);
    addBox('stoneWarm', e.mx + e.nx * 0.35, 16.6, e.mz + e.nz * 0.35, e.len + 0.8, 0.7, 1.4, a);
  }
  addPrism('stoneFacade', [[-540, 148.4], [-512, 148.4], [-512, 161], [-540, 161]], h, 12.4, 'roof:mid');
  const atr = [[-534.4, 99.2], [-497, 99.2], [-497, 112.5], [-534.4, 112.5]];
  addWalls('f:glass', atr, 0, 9.2); addPrism('glass:roof', atr, 9.2, 9.5);
  for (let x = -532; x < -497; x += 3.7) addBeam('white', [x, 9.55, 99.2], [x, 9.55, 112.5], 0.16);
  addWalls('trim:white', atr, 9.5, 10.0);
  for (let z = 114; z + 6 <= 158; z += 6) addPrism('f:glass', [[-485, z], [-480.6, z + 3], [-485, z + 6]], 0, h - 0.2, 'roof:dark');
  for (let z = 114; z + 6 <= 158; z += 6) addBox('trim:white', -480.6, 0, z + 3, 0.3, 0.3, h, 0);
  const wedge = [[-464.5, 170.5], [-438.5, 176], [-464.5, 181.5]];
  addPrism('trim:white', wedge, 5.0, 5.6); addCap('trim:white', wedge, 5.0, true);
  for (const x of [-445, -455]) addCyl('stoneWarm', x, 0, 176, 0.25, 5.0, 10);
  for (let k = 0; k < 7; k++) addBox('stoneWarm', -543 - k * 0.0, k * 0.6, 150 + k * 1.5, 5.5, 1.6, 0.6, 0);
  b.h = 18.6;
  // the footprint actually built, for collision and keeping trees out (the OSM outline misses the arc's east end)
  b.parts = [P, atr, [[-485, 113], [-480.4, 113], [-480.4, 158], [-485, 158]], [[-540, 148.4], [-512, 148.4], [-512, 161], [-540, 161]]];
  addCap('paveBrick', [[-483,100],[-437,100],[-432,181],[-462,185],[-462,161],[-482,158],[-483,113]], 0.04);
}
function buildGym(b) {
  MAT.gymRib ||= (() => { const c = mkCanvas(64, 64), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(0,0,0,.2)'; for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 64, 2); return plainMat('#b4b9bd', { map: canvasTex(c), roughness: 0.45, metalness: 0.55 }); })();
  const O = [-55, 465], E = [0.989, 0.152], A = [-0.152, 0.989], ang = Math.atan2(A[1], A[0]);
  const P = (u, v, y) => [O[0] + A[0] * u + E[0] * v, y, O[1] + A[1] * u + E[1] * v];
  const L = 90, v0 = -47, vj = 4, v1 = 44, eave = 2.6;
  const wc = -16, wTop = 21.5, wR = ((wc - v0) ** 2 + (wTop - eave) ** 2) / (2 * (wTop - eave)), wcy = wTop - wR;
  const ec = 14, eR = 44.8, ecy = 14.1 - eR;
  const hW = (v) => wcy + Math.sqrt(Math.max(0, wR * wR - (v - wc) ** 2));
  const hE = (v) => ecy + Math.sqrt(Math.max(0, eR * eR - (v - ec) ** 2));
  const top = buf('roof:metal'), under = buf('trim:white'), endG = buf('f:glass'), endM = buf('roof:metal'), band = buf('f:ribbonGlass');
  top.cur = under.cur = endG.cur = endM.cur = band.cur = OWNER;
  const NU = 30, parts = [[v0, vj, hW, 30], [vj, v1, hE, 24]];
  for (const [a, bnd, h, n] of parts) {
    let arc = 0;
    for (let j = 0; j < n; j++) {
      const va = a + (bnd - a) * j / n, vb = a + (bnd - a) * (j + 1) / n, ya = h(va), yb = h(vb), seg = Math.hypot(vb - va, yb - ya);
      for (let i = 0; i < NU; i++) {
        const ua = -L / 2 - 1 + (L + 2) * i / NU, ub = -L / 2 - 1 + (L + 2) * (i + 1) / NU;
        const q = (u, v, y, t) => [...P(u, v, y), u / 4, t / 4];
        top.quadO(q(ua, va, ya, arc), q(ub, va, ya, arc), q(ub, vb, yb, arc + seg), q(ua, vb, yb, arc + seg), -(yb - ya) * E[0], vb - va, -(yb - ya) * E[1]);
        under.quadO(q(ua, va, ya - 0.3, 0), q(ub, va, ya - 0.3, 0), q(ub, vb, yb - 0.3, 0), q(ua, vb, yb - 0.3, 0), (yb - ya) * E[0], -(vb - va), (yb - ya) * E[1]);
      }
      for (const [u, g, m] of [[-L / 2, endG, -1], [L / 2, endM, 1]]) {
        const q = (v, y) => g === endG ? [...P(u, v, y), v / 12.8, y / 16] : [...P(u, v, y), v / 4, y / 4];
        g.quadO(q(va, 0), q(vb, 0), q(vb, yb), q(va, ya), A[0] * m, 0, A[1] * m);
      }
      arc += seg;
    }
  }
  const yLow = hE(vj), yHigh = hW(vj);
  for (let i = 0; i < 18; i++) {
    const ua = -L / 2 + L * i / 18, ub = ua + L / 18, q = (u, y) => [...P(u, vj, y), u / 12.8, (y - yLow) / 16];
    band.quadO(q(ua, yLow), q(ub, yLow), q(ub, yHigh), q(ua, yHigh), E[0], 0, E[1]);
  }
  for (let u = -L / 2; u <= L / 2 + 0.1; u += 4.5) { const [x, , z] = P(u, vj + 0.1, 0); addBox('trim:white', x, yLow, z, 0.18, 0.2, yHigh - yLow, ang); }
  { const [x, , z] = P(0, vj + 0.5, 0); addBox('trim:white', x, yHigh - 0.1, z, L + 2, 1.2, 0.35, ang, 'trim:white'); }
  for (const m of [-1, 1]) for (let v = v0 + 3; v < v1; v += 3.2) {
    const h = v < vj ? hW(v) : hE(v), [x, , z] = P(m * (L / 2 + 0.08), v, 0);
    addBox(m < 0 ? 'metal' : 'trim:grey', x, 0, z, 0.15, m < 0 ? 0.14 : 0.3, h - 0.4, ang);
  }
  for (const m of [-1, 1]) { const [x, , z] = P(m * (L / 2 + 1.2), 0, 0); addBox('trim:grey', x, 0, z, 2.2, v1 - v0, 0.25, ang); }
  { const [x, , z] = P(0, v0 + 0.2, 0); addBox('gymRib', x, 0, z, L, 0.5, eave + 0.2, ang, 'trim:grey'); }
  { const [x, , z] = P(0, v1 + 1.6, 0); addBox('gymRib', x, 0, z, L + 1, 3.4, 3.2, ang, 'trim:white'); }
  for (const u of [-18, 14]) {
    const [x, , z] = P(u, v1 + 4.1, 0), [dx, , dz] = P(u, v1 + 3.45, 0);
    addBox('dark', dx, 0, dz, 4.2, 0.2, 2.6, ang);
    addBox('trim:white', x, 2.9, z, 5.6, 2.2, 0.28, ang, 'trim:white');
    for (const s2 of [-2.4, 2.4]) { const [px, , pz] = P(u + s2, v1 + 4.9, 0); addBox('trim:white', px, 0, pz, 0.18, 0.18, 2.9, ang); }
  }
  { const [x, , z] = P(-10, v1 + 3.35, 0); addSign('体育馆', x, 1.9, z, E[0], E[1], 0.9, { color: '#f4f2ec', family: '"Noto Sans SC", sans-serif', weight: 700, metal: 0.1, glow: '#ffffff' }); }
  { const [x, , z] = P(0, v1 + 9.5, 0); addBox('garden', x, 0, z, L - 12, 1.4, 1.0, ang); }
  b.h = wTop + 0.5;
}
function buildGreenhouse(b) {
  const ob = obb(b.p), rect = rectPoly(ob.cx, ob.cz, ob.L, ob.W, ob.ang), h = 6;
  addWalls('greenhouse', rect, 0, h);
  const n = Math.max(2, Math.round(ob.L / 7)), B = buf('greenhouse'); B.cur = OWNER;
  const P = (u, v, y) => [ob.cx + u * ob.ux - v * ob.uz, y, ob.cz + u * ob.uz + v * ob.ux, u / 4, v / 4];
  for (let i = 0; i < n; i++) {
    const u0 = -ob.L / 2 + i * ob.L / n, u1 = u0 + ob.L / n, um = (u0 + u1) / 2;
    B.quadO(P(u0, -ob.W / 2, h), P(u0, ob.W / 2, h), P(um, ob.W / 2, h + 2.6), P(um, -ob.W / 2, h + 2.6), -ob.ux, 1, -ob.uz);
    B.quadO(P(um, -ob.W / 2, h + 2.6), P(um, ob.W / 2, h + 2.6), P(u1, ob.W / 2, h), P(u1, -ob.W / 2, h), ob.ux, 1, ob.uz);
    for (const s of [-1, 1]) B.tri(P(u0, s * ob.W / 2, h), P(u1, s * ob.W / 2, h), P(um, s * ob.W / 2, h + 2.6));
    for (let v = -ob.W / 2; v <= ob.W / 2 + 0.1; v += ob.W / 8) {
      addBeam('white', P(u0, v, h).slice(0, 3), P(um, v, h + 2.6).slice(0, 3), 0.1);
      addBeam('white', P(um, v, h + 2.6).slice(0, 3), P(u1, v, h).slice(0, 3), 0.1);
      if (Math.abs(v) > ob.W / 2 - 0.1 || i % 2 === 0) addBeam('white', P(u0, v, 0).slice(0, 3), P(u0, v, h).slice(0, 3), 0.12);
    }
    addBeam('white', P(um, -ob.W / 2, h + 2.6).slice(0, 3), P(um, ob.W / 2, h + 2.6).slice(0, 3), 0.1);
  }
  addCap('deck', rect, 0.03);
  for (let u = -ob.L / 2 + 3; u < ob.L / 2 - 2; u += 4) for (const v of [-ob.W * 0.3, ob.W * 0.3]) {
    const pt = P(u, v, 0), tall = 1.2 + (Math.sin(u * 2) + 1) * 1.3;
    addCyl('cactus', pt[0], 0, pt[2], 0.25, tall, 9, 0.19);
    addCyl('cactus', pt[0] + 0.6, tall * 0.45, pt[2], 0.14, tall * 0.38, 7, 0.1);
    addBeam('cactus', [pt[0], tall * 0.5, pt[2]], [pt[0] + 0.6, tall * 0.5, pt[2]], 0.2);
    addCyl('garden', pt[0] - 0.9, 0, pt[2] + 1.1, 0.65, 0.65, 10, 0.2);
  }
  b.h = h + 2.6;
}
function buildNatatorium(b) {
  const P = b.p, h = 16;
  addWalls('f:glassGrey', P, 0, 5.5); addWalls('trim:white', P, 5.5, 7); addWalls('f:ribbonGlass', P, 7, h - 1.5);
  addWalls('plinth', insetPoly(P, -0.05), 0, 0.7); addCap('roof:light', P, h); addParapet('trim:white', insetPoly(P, -0.6), h - 1.5, 2.1, 0.65);
  const ob = obb(P);
  for (let j = -2; j <= 2; j++) addBox('solar', ob.cx - ob.uz * j * (ob.W - 10) / 5, h + 0.12, ob.cz + ob.ux * j * (ob.W - 10) / 5, ob.L - 9, (ob.W - 10) / 5 - 0.55, 0.12, ob.ang);
  for (let i = 0; i < P.length; i++) {
    const e = edgeOutward(P, i), a = Math.atan2(e.dz, e.dx); if (e.len < 20) continue;
    for (let y = 7.5; y < h - 1.5; y += 0.48) addBox('trim:grey', e.mx + e.nx * 0.25, y, e.mz + e.nz * 0.25, e.len, 0.35, 0.12, a);
    const q = t => [e.a[0] + e.dx * t + e.nx * 0.75, e.a[1] + e.dz * t + e.nz * 0.75];
    for (const t of [e.len * 0.18, e.len * 0.78]) { const a = q(t), c = q(t + 7); addBeam('trim:white', [a[0], 0.3, a[1]], [c[0], h - 0.2, c[1]], 1.6); }
  }
  const e = edgeFacing(P, b.c[0] - 80, b.c[1], 10);
  if (e) addSign('游泳池', e.mx + e.nx * 0.15 + e.dx * e.len * 0.25, 9.5, e.mz + e.nz * 0.15 + e.dz * e.len * 0.25, e.nx, e.nz, 2.4, { color: '#3d4247', family: '"Noto Serif SC", serif', metal: 0.3 });
  b.h = h + 0.6;
}
function buildStation(b) {
  const ob = obb(b.p), cx = ob.cx, cz = ob.cz, ux = ob.ux, uz = ob.uz, ang = ob.ang, L = ob.L, W = Math.max(20, ob.W);
  const at = (u, v) => [cx + ux * u - uz * v, cz + uz * u + ux * v];
  const box = (key, u, v, lu, lv, y0, h, cap) => { const [x, z] = at(u, v); addBox(key, x, y0, z, lu, lv, h, ang, cap); };
  const slab = (key, u, v, lu, lv, y0, h, cap) => { box(key, u, v, lu, lv, y0, h, cap); const [x, z] = at(u, v); addCap(key, rectPoly(x, z, lu, lv, ang), y0, true); };
  const ne = Math.sign((GATE.x - cx) * -uz + (GATE.z - cz) * ux) || 1;
  const yC = 5.8, yD = 11.5, yP = 12.75, yE = 17.8, rise = 3.6, Lr = L + 14, R = W / 2 + 1.5;
  for (let u = -L / 2 + 6; u <= L / 2 - 5; u += 12) for (const v of [-4.2, 4.2]) { const [x, z] = at(u, v); addCyl('concrete', x, 0, z, 0.75, yC - 0.4, 12); }
  slab('concrete', 0, 0, L - 4, W - 2, yC - 0.45, 0.45);
  { const [x, z] = at(0, 0), hall = rectPoly(x, z, L * 0.62, W - 3, ang); addWalls('f:glassGrey', hall, yC, yD - 1.2); }
  for (let u = -L * 0.31; u <= L * 0.31; u += 3.2) for (const v of [-(W - 3) / 2 - 0.1, (W - 3) / 2 + 0.1]) box('trim:white', u, v, 0.22, 0.3, yC, yD - 1.2 - yC);
  slab('concrete', 0, 0, Lr - 6, 10.5, yD - 1.2, 1.2);
  for (const o of [-2.1, 2.1]) for (const r of [-0.72, 0.72]) box('dark', 0, o + r, Lr - 8, 0.14, yD, 0.2);
  for (const sgn of [-1, 1]) {
    box('concrete', 0, sgn * 7.85, L * 0.82, 5.2, yD - 1.2, yP - yD + 1.2, 'deck');
    box('glassClear', 0, sgn * 5.45, L * 0.8, 0.12, yP, 1.6);
    for (let u = -L * 0.4; u <= L * 0.4; u += 12) { const [x, z] = at(u, sgn * 9.6); addCyl('white', x, yP, z, 0.28, yE + rise * 0.45 - yP, 10); }
  }
  const cap = [], wAt = (u) => { const a = Math.abs(u) - (Lr / 2 - R); return a <= 0 ? R : Math.sqrt(Math.max(0, R * R - a * a)); };
  for (let i = 0; i <= 40; i++) { const u = -Lr / 2 + Lr * i / 40; cap.push(at(u, wAt(u) - 1.4)); }
  for (let i = 40; i >= 0; i--) { const u = -Lr / 2 + Lr * i / 40; cap.push(at(u, -(wAt(u) - 1.4))); }
  addWalls('f:glassGrey', cap.filter((q, i) => i === 0 || Math.hypot(q[0] - cap[i - 1][0], q[1] - cap[i - 1][1]) > 0.3), yP, yE - 0.2);
  const NU = 56, NV = 12, top = buf('roof:metal'), sky = buf('glass:roof'), under = buf('trim:white'), edge = buf('trim:white');
  top.cur = sky.cur = under.cur = edge.cur = OWNER;
  const RP = (u, t) => { const w = wAt(u), [x, z] = at(u, w * t); return [x, yE + rise * (1 - t * t) * (w / R), z, u / 6, t * 2]; };
  for (let i = 0; i < NU; i++) {
    const u0 = -Lr / 2 + Lr * i / NU, u1 = -Lr / 2 + Lr * (i + 1) / NU;
    for (let j = 0; j < NV; j++) {
      const t0 = -1 + 2 * j / NV, t1 = -1 + 2 * (j + 1) / NV, A = RP(u0, t0), B = RP(u1, t0), C = RP(u1, t1), Dq = RP(u0, t1);
      const glass = Math.abs((t0 + t1) / 2) < 0.12 && Math.abs((u0 + u1) / 2) < Lr / 2 - R;
      (glass ? sky : top).quadO(A, B, C, Dq, 0, 1, 0);
      if (!glass) under.quadO(A, B, C, Dq, 0, -1, 0);
    }
    for (const t of [-1, 1]) {
      const A = RP(u0, t), B = RP(u1, t), ox = A[0] - at(u0, 0)[0], oz = A[2] - at(u0, 0)[1];
      edge.quadO(A, B, [B[0], B[1] - 0.9, B[2], 0, 0], [A[0], A[1] - 0.9, A[2], 0, 0], ox, 0, oz);
    }
  }
  const sign = (text, u, v, y, h, nv) => { const [x, z] = at(u, v); addSign(text, x, y, z, -uz * nv, ux * nv, h, { color: '#ffffff', bg: '#0a8fc7', family: '"Noto Sans SC", sans-serif', weight: 700, metal: 0, glow: '#ffffff' }); };
  sign('中国药科大学站', 0, ne * ((W - 3) / 2 + 0.35), yD - 2.2, 1.5, ne);
  sign('中国药科大学站', 0, -ne * ((W - 3) / 2 + 0.35), yD - 2.2, 1.5, -ne);
  const exit = (px, pz, side, len, label) => {
    const u = (px - cx) * ux + (pz - cz) * uz, v0 = (W - 3) / 2, v1 = v0 + len, vm = side * (v0 + v1) / 2;
    slab('concrete', u, vm, 7.5, len, yC - 0.45, 0.45);
    for (const s2 of [-1, 1]) box('f:glassGrey', u + s2 * 3.55, vm, 0.25, len, yC, 3.4);
    box('trim:white', u, vm, 8.2, len, yC + 3.4, 0.45, 'trim:white');
    for (let k = 0; k <= len; k += 12) box('concrete', u, side * (v0 + k), 1.0, 1.0, 0, yC - 0.45);
    const vt = side * (v1 + 4.5);
    box('f:glassGrey', u, vt, 9, 9, 0, yC + 3.4, 'trim:white'); box('trim:white', u, vt, 10, 10, yC + 3.4, 0.5, 'trim:white');
    box('trim:white', u, side * (v1 + 11), 9, 4.5, 3.2, 0.35, 'trim:white');
    for (const s2 of [-1, 1]) box('metal', u + s2 * 4.2, side * (v1 + 12.8), 0.18, 0.18, 0, 3.2);
    sign(label, u, side * (v1 + 9.05), yC + 1.6, 1.2, side);
  };
  exit(-312.7, 377, ne, 34, '1 号口 · 中国药科大学');
  exit(-345, 426, -ne, 26, '2 号口');
  { const u = (-330 - cx) * ux + (438 - cz) * uz, v = (-ne) * 30; box('trim:white', u, v, 24, 7, 3.3, 0.35, 'trim:white'); for (const du of [-10, 0, 10]) for (const dv of [-2.8, 2.8]) box('metal', u + du, v + dv, 0.2, 0.2, 0, 3.3); }
  b.h = yE + rise + 0.5;
}

const FLAGS = [], LIB_PLAZA = { x: -205, z: 5 }, LIB_TREES = [];
function buildFlags() {
  if (!FLAGS.length) return;
  const c = mkCanvas(300, 200), g = c.getContext('2d'); g.fillStyle = '#de2910'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#ffde00';
  const star = (cx, cy, r, rot) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = rot - Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * 0.382 : r; g.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2); } g.closePath(); g.fill(); };
  star(50, 50, 30, 0); for (const [x, y] of [[100, 20], [120, 40], [120, 70], [100, 90]]) star(x, y, 10, Math.atan2(50 - y, 50 - x) + Math.PI / 2);
  const tex = canvasTex(c, true, false);
  const geo = new THREE.PlaneGeometry(4.8, 3.2, 24, 8); geo.translate(2.4, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 });
  mat.onBeforeCompile = (sh) => { sh.uniforms.uTime = uTime; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', '#include <begin_vertex>\n float fx = position.x / 4.8; transformed.z += sin(position.x * 1.6 - uTime * 6.0) * 0.32 * fx + sin(position.x * 3.1 - uTime * 9.0 + position.y) * 0.08 * fx; transformed.y -= fx * fx * 0.25;'); };
  for (const f of FLAGS) { const m2 = new THREE.Mesh(geo, mat); m2.position.set(f.x, f.top - 1.6, f.z); m2.rotation.y = -f.ang + Math.PI * 0.85; m2.castShadow = true; scene.add(m2); }
}
function addGeo(key, geo) {
  const B = buf(key); B.cur = OWNER;
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position.array, u = g.attributes.uv ? g.attributes.uv.array : null;
  for (let i = 0; i < p.length / 3; i += 3) {
    const V = (k) => [p[(i + k) * 3], p[(i + k) * 3 + 1], p[(i + k) * 3 + 2], u ? u[(i + k) * 2] * 0.12 : 0, u ? u[(i + k) * 2 + 1] * 0.12 : 0];
    B.tri(V(0), V(1), V(2));
  }
}
function addDisc(key, x, y, z, r, h, seg = 12) { const c = circlePoly(x, z, r, seg); addPrism(key, c, y, y + h); addCap(key, c, y, true); }
function buildGate() {
  const P = gateP, ang = Math.atan2(GATE.dz, GATE.dx), nx = GATE.nx, nz = GATE.nz;
  const box = (key, a, b, L, W, y0, H, cap) => { const [x, z] = P(a, b); addBox(key, x, y0, z, L, W, H, ang, cap); };
  OWNER = -1;
  box('stoneWarm', 0.5, 0, 21, 1.3, 0, 3.1);
  box('stoneWarm', 0.5, 0, 21.3, 1.5, 3.1, 0.12);
  box('stoneWarm', -12, 0, 4, 1.1, 0, 2.45);
  box('stoneWarm', -15.5, 0, 1.4, 1.0, 0, 2.15);
  for (const a of [-14.6, -10.2]) box('dark', a, 0.75, 0.28, 0.28, 0, 2.75);
  box('dark', -12.4, 0.75, 4.7, 0.3, 2.5, 0.25);
  box('stoneWarm', 3, 1.32, 16, 1.35, 0, 0.7);
  box('dark', 3.3, 0.665, 10.6, 0.04, 0.7, 0.16);
  box('stoneWarm', -7.2, 1.6, 4.4, 2.0, 0, 0.16); box('stoneWarm', -7.2, 1.3, 4.4, 1.3, 0.16, 0.16);
  box('stoneWarm', 13, 0.4, 4, 2.0, 0, 0.75);
  box('stoneWarm', 0.5, 2.75, 24.5, 1.1, 0, 0.42); box('garden', 0.5, 2.68, 24.1, 0.75, 0.42, 0.42);
  for (let i = 0; i < 6; i++) { box('white', 4 + i * 1.6, 2.2, 0.32, 0.3, 0.42, 0.34); box('lamp', 4 + i * 1.6, 2.04, 0.26, 0.03, 0.46, 0.24); }
  {
    const cuts = [0, 150, 280, 455, 633, 805, 980], sx = CALLI.naturalWidth / 980;
    for (let i = 0; i < 6; i++) {
      const w = Math.round((cuts[i + 1] - cuts[i]) * sx), c = mkCanvas(w, CALLI.naturalHeight);
      c.getContext('2d').drawImage(CALLI, cuts[i] * sx, 0, w, CALLI.naturalHeight, 0, 0, w, CALLI.naturalHeight);
      const [x, z] = P(0.5 + (i - 2.5) * 2.2, 0.65);
      const m = addImageSign(c, x, 2.0, z, nx, nz, 1.2, { glow: '#b98a45' }).material; m.metalness = 0.45; m.roughness = 0.42;
    }
  }
  [16.5, 19.2, 17.3, 21, 19.3, 16.8, 17].forEach((h, i) => {
    const [x, z] = P(0.5 + (i - 3) * 2.5, -5.5), y0 = h - 2.75;
    addDisc('dark', x, 0, z, 0.32, 0.12);
    addCyl('dark', x, 0, z, 0.21, 5.6, 12);
    addDisc('dark', x, 5.6, z, 0.24, 0.1);
    addCyl('metal', x, 5.7, z, 0.13, y0 - 5.7, 10, 0.11);
    addDisc('dark', x, y0, z, 0.3, 0.16);
    addDisc('metal', x, y0 + 0.16, z, 0.17, 0.08);
    addCyl('lamp', x, y0 + 0.24, z, 0.14, 1.76, 10);
    for (let k = 0; k < 12; k++) addDisc('metal', x, y0 + 0.32 + k * 0.14, z, 0.205, 0.035, 10);
    addDisc('dark', x, y0 + 2.0, z, 0.32, 0.15);
    addDisc('lamp', x, y0 + 2.15, z, 0.2, 0.45, 8);
    addDisc('metal', x, y0 + 2.6, z, 0.13, 0.08, 8);
  });
  for (const b of [-31, -51, -71]) {
    const W = 9, H = 8.6, D = 1.5, s = new THREE.Shape(), hole = new THREE.Path();
    s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(W / 2, H); s.lineTo(-W / 2, H); s.closePath();
    hole.absarc(0, 4.5, 2.8, 0, Math.PI * 2, true); s.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false, curveSegments: 48 }), [x, z] = P(-0.5, b);
    geo.translate(0, 0, -D / 2); geo.rotateY(-ang); geo.translate(x, 0.42, z);
    addGeo('white', geo); geo.dispose();
    box('stoneWarm', -0.5, b, W + 0.8, D + 0.8, 0, 0.42);
  }
  MAT.poolWater ||= plainMat('#2c4446', { roughness: 0.04, metalness: 0.55 });
  { const q = gateRect(-5.4, 4.4, -14.6, -77.4); addCap('poolWater', q, 0.24); }
  for (const [a0, a1, b0, b1] of [[-6, -5.4, -14, -78], [4.4, 5, -14, -78], [-5.4, 4.4, -14, -14.6], [-5.4, 4.4, -77.4, -78]]) box('stoneWarm', (a0 + a1) / 2, (b0 + b1) / 2, a1 - a0, b0 - b1, 0, 0.45, 'stoneWarm');
  for (const a of [-7.6, 6.6]) for (const [b0, b1] of [[-15, -27], [-35, -47], [-55, -67]]) box('garden', a, (b0 + b1) / 2, 0.9, b0 - b1, 0, 0.7);
  const house = (a, b) => {
    box('stone', a, b, 8.4, 5.9, 0, 0.35);
    box('f:glassGrey', a, b, 7.6, 5.1, 0.35, 3.1, 'roof:light');
    box('trim:white', a, b, 9.6, 7.1, 3.45, 0.5, 'trim:white');
  };
  house(-33, 6.5); house(29, 5.5);
  for (const [a, b, dir] of [[-12.2, 4.6, -1], [13.9, 4.6, 1]]) {
    box('white', a, b, 0.45, 0.45, 0, 1.05);
    box('white', a + dir * 3.3, b, 6.2, 0.1, 0.95, 0.1);
  }
}

const STEP_SURF = [];
function groundAt(x, z) {
  for (const b of BRIDGES) if (pip(x, z, b.p)) return typeof b.y === 'function' ? b.y(x, z) : b.y;
  for (const f of STEP_SURF) { const y = f(x, z); if (y > 0) return y; }
  return 0;
}
function lakeSteps() {
  OWNER = -1;
  const cx = -398, cz = 82;
  STEP_SURF.push((x, z) => { const d = Math.hypot(x - cx, z - cz), a = Math.atan2(z - cz, x - cx); if (Math.abs(a) > Math.PI * 0.42 || d > 8 + 8 * 2.6) return 0; return d < 8 ? 1.25 : Math.max(0.01, 1.2 - Math.floor((d - 8) / 2.6) * 0.2); });
  for (let k = 0; k < 8; k++) {
    const r0 = 8 + k * 2.6, r1 = r0 + 2.6, y = 1.2 - k * 0.2, pts = [], a0 = -Math.PI * 0.42, a1 = Math.PI * 0.42;
    for (let i = 0; i <= 24; i++) { const a = a0 + (a1 - a0) * i / 24; pts.push([cx + Math.cos(a) * r1, cz + Math.sin(a) * r1]); }
    for (let i = 24; i >= 0; i--) { const a = a0 + (a1 - a0) * i / 24; pts.push([cx + Math.cos(a) * r0, cz + Math.sin(a) * r0]); }
    addPrism('stoneWarm', pts, -0.5, y);
  }
  addPrism('deck', circlePoly(cx, cz, 8, 32), -0.5, 1.25);
  const a = [-378, 114], bq = [-344, 132], dx = bq[0] - a[0], dz = bq[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, ang = Math.atan2(dz, dx);
  addBox('deck', (a[0] + bq[0]) / 2, 0.2, (a[1] + bq[1]) / 2, L, 4.2, 0.55, ang, 'deck');
  for (let t = 3; t < L; t += 5.5) { const x = a[0] + ux * t, z = a[1] + uz * t; for (const s2 of [-1, 1]) addBox('white', x - uz * s2 * 2.2, 0.75, z + ux * s2 * 2.2, 0.35, 0.35, 4.2, ang, 'white'); addBox('white', x, 4.95, z, 0.4, 5.0, 0.45, ang, 'white'); }
}
function pavilion(x, z, r = 3.2) {
  const n = 6;
  addCyl('stone', x, 0, z, r + 1, 0.55, n);
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; addCyl('redcol', x + Math.cos(a) * r, 0.55, z + Math.sin(a) * r, 0.16, 3, 6); }
  addCyl('redcol', x, 3.4, z, r + 0.4, 0.4, n);
  addCyl('tile', x, 3.8, z, r + 1.8, 0.35, n, r + 1.5);
  addCyl('tile', x, 4.15, z, r + 1.5, 2.4, n, 0.2);
  addCyl('gold', x, 6.5, z, 0.25, 0.8, 6, 0.05);
}

const BRIDGES = [];
const BRIDGE_SPEC = [
  { x: 102.5, z: -2.5, W: 12, sw: 2.6, rail: 'baluster', fascia: 'stoneWarm', H: 0.95, lamps: 'ends' },
  { x: -1.5, z: 161.5, W: 18, sw: 0, road: 'bridgeConcrete', rail: 'steel', railKey: 'dark', fascia: 'concrete', H: 0.8, lamps: 'poles' },
  { x: -83.5, z: 325.5, W: 11, sw: 1.6, rail: 'wall', fascia: 'white', H: 1.05, lamps: 'mid' },
  { x: 259, z: -241, W: 13, walk: true, flare: 3.5, rail: 'low', fascia: 'stoneWarm', H: 0.75, ramp: 6 },
  { x: -472.5, z: -334.5, W: 6, walk: true, rail: 'steel', railKey: 'metal', fascia: 'concrete', beam: true, spans: 3, H: 0.55, ramp: 3 },
];
function roadBridge(a, b, s) {
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, ang = Math.atan2(dz, dx);
  const ramp = s.ramp ?? 5, Lt = l + 2 * ramp, H = s.H, sw = s.walk ? 0 : s.sw, ew = s.rail === 'low' ? 0.55 : 0.32, rb = s.rail === 'steel' ? 0.3 : 0.18, kerb = sw ? 0.15 : 0;
  const P = (u, v, y) => [mx + ux * u - uz * v, y, mz + uz * u + ux * v, u / 4, v / 4];
  const top = (u) => 0.04 + H * Math.max(0, 1 - (u / (Lt / 2)) ** 2);
  const half = (u) => s.W / 2 + (s.flare || 0) * smooth(l / 2 - 1, Lt / 2, Math.abs(u));
  const spans = s.spans || 1, sl = l / spans;
  const under = (u) => {
    if (Math.abs(u) >= l / 2) return -0.05;
    if (s.beam) return top(u) - 0.75;
    const i = Math.min(spans - 1, Math.floor((u + l / 2) / sl)), t = ((u + l / 2) - i * sl) / sl * 2 - 1;
    return 0.1 + (top(u) - 0.65 - 0.1) * Math.sqrt(Math.max(0, 1 - t * t));
  };
  const B = (k) => { const g = buf(k); g.cur = OWNER; return g; };
  const road = B(s.walk ? 'deck' : s.road || 'bridgeRoad'), walk = B('deck'), fas = B(s.fascia), cop = B(s.rail === 'wall' ? 'white' : s.rail === 'steel' ? s.fascia : 'stoneWarm'), und = B('concrete'), curb = B('stoneWarm');
  const N = Math.ceil(Lt / 0.8);
  for (let i = 0; i < N; i++) {
    const u0 = -Lt / 2 + Lt * i / N, u1 = -Lt / 2 + Lt * (i + 1) / N, t0 = top(u0), t1 = top(u1), h0 = half(u0), h1 = half(u1), c = s.W / 2 - sw;
    if (sw) {
      road.quadO(P(u0, -c, t0), P(u1, -c, t1), P(u1, c, t1), P(u0, c, t0), 0, 1, 0);
      for (const g of [-1, 1]) {
        walk.quadO(P(u0, g * c, t0 + kerb), P(u1, g * c, t1 + kerb), P(u1, g * (h1 - ew), t1 + kerb), P(u0, g * (h0 - ew), t0 + kerb), 0, 1, 0);
        curb.quadO(P(u0, g * c, t0), P(u1, g * c, t1), P(u1, g * c, t1 + kerb), P(u0, g * c, t0 + kerb), -g * -uz, 0, -g * ux);
      }
    } else road.quadO(P(u0, -(h0 - ew), t0), P(u1, -(h1 - ew), t1), P(u1, h1 - ew, t1), P(u0, h0 - ew, t0), 0, 1, 0);
    for (const g of [-1, 1]) {
      const nx = -uz * g, nz = ux * g, y0 = t0 + kerb, y1 = t1 + kerb;
      cop.quadO(P(u0, g * (h0 - ew), y0 + rb), P(u1, g * (h1 - ew), y1 + rb), P(u1, g * h1, y1 + rb), P(u0, g * h0, y0 + rb), 0, 1, 0);
      cop.quadO(P(u0, g * (h0 - ew), y0), P(u1, g * (h1 - ew), y1), P(u1, g * (h1 - ew), y1 + rb), P(u0, g * (h0 - ew), y0 + rb), -nx, 0, -nz);
      fas.quadO(P(u0, g * h0, under(u0)), P(u1, g * h1, under(u1)), P(u1, g * h1, y1 + rb), P(u0, g * h0, y0 + rb), nx, 0, nz);
    }
    if (Math.abs((u0 + u1) / 2) < l / 2) und.quadO(P(u0, -h0, under(u0)), P(u1, -h1, under(u1)), P(u1, h1, under(u1)), P(u0, h0, under(u0)), 0, -1, 0);
  }
  if (!s.beam) for (const u of [-l / 2, l / 2]) { const [x, , z] = P(u, 0, 0); addBox('granite', x, -0.5, z, 1.4, s.W + 1.6, 0.9, ang); }
  else for (let k = 1; k < spans; k++) {
    const u = -l / 2 + k * sl;
    for (const v of [-s.W * 0.28, s.W * 0.28]) { const [x, , z] = P(u, v, 0); addCyl('concrete', x, -0.4, z, 0.42, top(u) - 0.35, 12); }
    const [x, , z] = P(u, 0, 0); addBox('concrete', x, top(u) - 1.05, z, 1.0, s.W - 0.6, 0.35, ang);
  }
  const railY = (u) => top(u) + kerb + rb;
  for (const g of [-1, 1]) {
    const v = (u) => g * (half(u) - ew / 2), at = (u, y) => { const q = P(u, v(u), y); return [q[0], q[1], q[2]]; };
    const u0 = -Lt / 2 + 0.6, u1 = Lt / 2 - 0.6;
    if (s.rail === 'baluster') {
      const n = Math.max(2, Math.round((u1 - u0) / 2.4));
      for (let k = 0; k <= n; k++) {
        const u = u0 + (u1 - u0) * k / n, [x, y, z] = at(u, railY(u)), end = k === 0 || k === n;
        addBox('stoneWarm', x, y, z, end ? 0.6 : 0.3, end ? 0.6 : 0.3, end ? 1.35 : 0.95, ang, 'stoneWarm');
        addBox('stoneWarm', x, y + (end ? 1.35 : 0.95), z, end ? 0.72 : 0.38, end ? 0.72 : 0.38, 0.1, ang, 'stoneWarm');
        if (end && s.lamps === 'ends') { addBox('lamp', x, y + 1.45, z, 0.36, 0.36, 0.42, ang, 'lamp'); addBox('stoneWarm', x, y + 1.87, z, 0.5, 0.5, 0.08, ang, 'stoneWarm'); }
        if (k < n) {
          const un = u0 + (u1 - u0) * (k + 1) / n;
          addBeam('stoneWarm', at(u, railY(u) + 0.86), at(un, railY(un) + 0.86), 0.17);
          addBeam('stoneWarm', at(u, railY(u) + 0.1), at(un, railY(un) + 0.1), 0.13);
          for (let j = 1; j <= 5; j++) { const ub = u + (un - u) * j / 6, [bx, by, bz] = at(ub, railY(ub)); addBox('stoneWarm', bx, by + 0.16, bz, 0.08, 0.08, 0.64, ang); }
        }
      }
    } else if (s.rail === 'steel') {
      const key = s.railKey || 'dark', n = Math.max(2, Math.round((u1 - u0) / 2));
      for (let k = 0; k <= n; k++) {
        const u = u0 + (u1 - u0) * k / n, [x, y, z] = at(u, railY(u));
        addBox(key, x, y, z, 0.08, 0.08, 1.05, ang, key);
        if (k < n) {
          const un = u0 + (u1 - u0) * (k + 1) / n;
          addBeam(key, at(u, railY(u) + 1.02), at(un, railY(un) + 1.02), 0.07);
          addBeam(key, at(u, railY(u) + 0.12), at(un, railY(un) + 0.12), 0.05);
          for (let j = 1; j < 13; j++) { const ub = u + (un - u) * j / 13, [bx, by, bz] = at(ub, railY(ub)); addBox(key, bx, by + 0.12, bz, 0.025, 0.025, 0.9, ang); }
        }
      }
    } else if (s.rail === 'wall' || s.rail === 'low') {
      const hgt = s.rail === 'wall' ? 0.95 : 0.42, key = s.rail === 'wall' ? 'white' : 'stoneWarm', W2 = buf(key); W2.cur = OWNER;
      const M = Math.ceil((u1 - u0) / 0.8);
      for (let k = 0; k < M; k++) {
        const ua = u0 + (u1 - u0) * k / M, ubb = u0 + (u1 - u0) * (k + 1) / M, ya = railY(ua), yb = railY(ubb), nx = -uz * g, nz = ux * g;
        const pa = (u, dv, y) => { const q = P(u, v(u) + g * dv, y); return q; };
        W2.quadO(pa(ua, -ew / 2, ya), pa(ubb, -ew / 2, yb), pa(ubb, -ew / 2, yb + hgt), pa(ua, -ew / 2, ya + hgt), -nx, 0, -nz);
        W2.quadO(pa(ua, ew / 2, ya), pa(ubb, ew / 2, yb), pa(ubb, ew / 2, yb + hgt), pa(ua, ew / 2, ya + hgt), nx, 0, nz);
        W2.quadO(pa(ua, -ew / 2 - 0.05, ya + hgt), pa(ubb, -ew / 2 - 0.05, yb + hgt), pa(ubb, ew / 2 + 0.05, yb + hgt), pa(ua, ew / 2 + 0.05, ya + hgt), 0, 1, 0);
      }
      for (const u of [u0, u1]) { const [x, y, z] = at(u, railY(u)); addBox(key, x, y, z, 0.7, ew + 0.2, hgt + 0.25, ang, key); }
      if (s.rail === 'wall') for (let u = u0 + 3; u < u1 - 2; u += 3) { const [x, y, z] = at(u, railY(u)); addBox('trim:grey', x - uz * g * -0.02, y + 0.12, z + ux * g * -0.02, 0.22, ew + 0.04, hgt - 0.24, ang); }
      if (s.lamps === 'mid') { const [x, y, z] = at(0, railY(0)); addCyl('metal', x, y + hgt, z, 0.08, 4.2, 8, 0.06); addBox('metal', x - uz * g * 0.6, y + hgt + 4.1, z + ux * g * 0.6, 1.3, 0.22, 0.12, ang + Math.PI / 2); addBox('lamp', x - uz * g * 1.1, y + hgt + 3.98, z + ux * g * 1.1, 0.5, 0.3, 0.12, ang + Math.PI / 2); }
    }
    if (s.lamps === 'poles') for (const u of [-l / 4, l / 4]) {
      const [x, y, z] = at(u, railY(u));
      addCyl('dark', x, y, z, 0.1, 6.5, 8, 0.07);
      addBeam('dark', [x, y + 6.4, z], [x - uz * g * 1.4, y + 6.55, z + ux * g * 1.4], 0.08);
      addBox('lamp', x - uz * g * 1.5, y + 6.35, z + ux * g * 1.5, 0.7, 0.32, 0.14, ang);
    }
  }
  const foot = rectPoly(mx, mz, Lt, s.W + 2 * (s.flare || 0), ang);
  BRIDGES.push({ p: foot, y: (x, z) => { const u = (x - mx) * ux + (z - mz) * uz, v = -(x - mx) * uz + (z - mz) * ux; return top(u) + (sw && Math.abs(v) > s.W / 2 - sw ? kerb : 0); } });
}
function boardwalk(pts, w, y) {
  const c = cumLen(pts), L = c[c.length - 1];
  addRibbon('wood', pts, w, y - 0.18, y);
  for (let t = 0; t <= L; t += 2.4) {
    const q = sampleAt(pts, c, t);
    for (const g of [-1, 1]) {
      const x = q.x - q.dz * g * (w / 2 - 0.1), z = q.z + q.dx * g * (w / 2 - 0.1);
      addCyl('wood', x, -0.6, z, 0.11, y - 0.12, 7);
      addBox('wood', x, y, z, 0.1, 0.1, 1.0, Math.atan2(q.dz, q.dx));
    }
  }
  for (const g of [-1, 1]) { const side = offsetLine(pts, g * (w / 2 - 0.1)); addRibbon('wood', side, 0.12, y + 0.92, y + 1.04); addRibbon('wood', side, 0.06, y + 0.46, y + 0.52); }
  BRIDGES.push({ p: offsetLine(pts, w / 2).concat(offsetLine(pts, -w / 2).reverse()), y: y + 0.02 });
}
function buildBridges() {
  OWNER = -1;
  MAT.bridgeRoad ||= plainMat('#4f5255', { roughness: 0.93 });
  MAT.bridgeConcrete ||= plainMat('#a8a49b', { map: MAT['roof:light'].map, roughness: 0.92 });
  const items = D.r.map((r) => ({ p: r.p, w: roadW(r), path: false })).concat(D.pa.map((r) => ({ p: r.p, w: (PW[r.t] || 2.5) + 0.6, path: true })));
  for (const it of items) {
    const cum = cumLen(it.p), L = cum[cum.length - 1];
    let run = null;
    const flush = () => {
      if (!run) return;
      const len = run.e - run.s;
      if (len > 3 && len < 160) {
        const a = sampleAt(it.p, cum, Math.max(0, run.s - 1.5)), b = sampleAt(it.p, cum, Math.min(L, run.e + 1.5)), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const spec = BRIDGE_SPEC.find((q) => Math.hypot(q.x - mx, q.z - mz) < 20);
        if (spec) roadBridge(a, b, spec);
        else if (it.path) roadBridge(a, b, { W: it.w + 1, walk: true, rail: 'baluster', fascia: 'stoneWarm', H: 0.6 + len * 0.03 });
        else { const l = Math.hypot(b.x - a.x, b.z - a.z); roadBridge(a, b, { W: it.w + 3, sw: 1.5, rail: 'steel', railKey: 'metal', fascia: 'concrete', beam: true, spans: Math.max(1, Math.round(l / 16)), H: 0.5, ramp: 4 }); }
      }
      run = null;
    };
    for (let s = 0; s <= L; s += 0.8) {
      const q = sampleAt(it.p, cum, s);
      if (q.x < REG.x0 || q.x > REG.x1 || q.z < REG.z0 || q.z > REG.z1) { flush(); continue; }
      if (inWater(q.x, q.z)) { if (!run) run = { s, e: s }; else run.e = s; } else flush();
    }
    flush();
  }
  {
    const deck = [[-350.5, -29.5], [-340.5, -29.5], [-340.5, -18.5], [-350.5, -18.5]], y = 0.75;
    addPrism('wood', deck, y - 0.25, y);
    for (const [x, z] of [[-350.2, -29.2], [-340.8, -29.2], [-340.8, -18.8], [-350.2, -18.8], [-345.5, -18.8], [-345.5, -29.2]]) addCyl('wood', x, -0.6, z, 0.16, y - 0.2, 8);
    for (const [a, b] of [[[-350.4, -29.4], [-350.4, -18.6]], [[-350.4, -18.6], [-347.2, -18.6]], [[-343.8, -18.6], [-340.6, -18.6]], [[-340.6, -18.6], [-340.6, -29.4]], [[-340.6, -29.4], [-344, -29.4]]]) {
      addRibbon('wood', [a, b], 0.12, y + 0.9, y + 1.02);
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= l; t += 1.6) addBox('wood', a[0] + (b[0] - a[0]) * t / l, y, a[1] + (b[1] - a[1]) * t / l, 0.1, 0.1, 0.95, 0);
    }
    for (const x of [-346.5, -344.5]) addCyl('dark', x, y, -18.3, 0.12, 0.45, 8);
    boardwalk([[-346, -47], [-346, -38], [-345.5, -29.5]], 3.0, 0.75);
    BRIDGES.push({ p: deck, y });
    for (const [x, z, a] of [[-345.6, -15.6, 0.15], [-342.2, -15.2, -0.1], [-334, -31, 1.4]]) {
      addBox('white', x, 0.12, z, 1.3, 3.8, 0.55, a, 'white'); addBox('wood', x, 0.2, z, 1.0, 3.3, 0.38, a, 'wood');
      addBox('white', x - Math.sin(a) * 0, 0.48, z, 1.05, 0.25, 0.08, a, 'white');
    }
  }
  boardwalk([[-313, 177], [-308, 168], [-301, 162.5], [-292, 161], [-283, 164], [-277, 169], [-274, 175]], 2.4, 0.78);
}

function buildShoreline() {
  OWNER = -1;
  for (const w of WATERS) for (const p of w.outer.concat(w.inner)) {
    // Low stone revetment follows the mapped shore; below the surface it runs down to the lake bed, facing the water.
    addWalls('stone', p, -0.3, 0.44);
    addWalls('stone', p, LAKE_BED - 0.1, -0.3, undefined, w.outer.includes(p));
    const ring = p.concat([p[0]]), length = cumLen(ring), total = length[length.length - 1];
    for (let t = 0; t < total; t += 5.5) {
      const q = sampleAt(ring, length, t);
      if (q.x < -290 && q.z > -30 && q.z < 160) addCyl('granite', q.x, 0.2, q.z, 0.5 + rand() * 0.6, 0.35 + rand() * 0.3, 7);
    }
  }
  // A narrow timber bank walk on Minghu, connected to the mapped pedestrian path.
  const path = [[-119, -281], [-104, -301], [-89, -320], [-75, -338]];
  addRibbon('wood', path, 3.0, 0.34, 0.7);
  BRIDGES.push({p:offsetLine(path,1.5).concat(offsetLine(path,-1.5).reverse()),y:0.7});
  const c = cumLen(path);
  for (let t = 0; t < c[c.length - 1]; t += 2.5) {
    const q = sampleAt(path, c, t);
    for (const s of [-1, 1]) { const x = q.x - q.dz * s * 1.4, z = q.z + q.dx * s * 1.4; addBox('wood', x, 0.65, z, 0.14, 0.14, 1.05, 0); }
  }
  for (const s of [-1, 1]) addRibbon('wood', offsetLine(path, s * 1.4), 0.12, 1.55, 1.7);
}

function buildFence() {
  const pts = CAMPUS.concat([CAMPUS[0]]), gaps = [];
  for (const r of D.r) for (let i = 0; i < r.p.length - 1; i++) for (let j = 0; j < pts.length - 1; j++) {
    const a = r.p[i], b = r.p[i + 1], c = pts[j], d = pts[j + 1];
    const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]); if (Math.abs(den) < 1e-9) continue;
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den, u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) gaps.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, roadW(r) / 2 + 3]);
  }
  gaps.push([GATE.x, GATE.z, 70]);
  const c = mkCanvas(64, 128), g = c.getContext('2d');
  g.fillStyle = '#26292b'; g.fillRect(0, 6, 64, 5); g.fillRect(0, 112, 64, 5);
  for (let x = 2; x < 64; x += 8) { g.fillRect(x, 0, 3, 128); g.beginPath(); g.moveTo(x - 1, 2); g.lineTo(x + 1.5, -4); g.lineTo(x + 4, 2); g.fill(); }
  const tex = canvasTex(c); tex.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.6 });
  const pos = [], uv = [], H = 2.2; let dist = 0;
  OWNER = -1;
  for (let j = 0; j < pts.length - 1; j++) {
    const a = pts[j], b = pts[j + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s < l; s += 3) {
      const s1 = Math.min(l, s + 3), x0 = a[0] + (b[0] - a[0]) * s / l, z0 = a[1] + (b[1] - a[1]) * s / l, x1 = a[0] + (b[0] - a[0]) * s1 / l, z1 = a[1] + (b[1] - a[1]) * s1 / l;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if (gaps.some(([gx, gz, r]) => Math.hypot(gx - mx, gz - mz) < r)) { dist += s1 - s; continue; }
      const u0 = dist / 1.2, u1 = (dist + s1 - s) / 1.2; dist += s1 - s;
      pos.push(x0, 0, z0, x1, 0, z1, x1, H, z1, x0, 0, z0, x1, H, z1, x0, H, z0);
      uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
      if (Math.round(s) % 15 === 0) addBox('stone', x0, 0, z0, 0.55, 0.55, H + 0.35, Math.atan2(b[1] - a[1], b[0] - a[0]), 'stone');
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; scene.add(mesh);
}

function buildSports() {
  OWNER = -1;
  if (STADIUM) {
    const ob = STADIUM, perp = [-ob.uz, ob.ux], west = perp[0] < 0 ? 1 : -1, r1 = 36.5 + 8 * 1.22;
    const P = (u, v) => [ob.cx + ob.ux * u + perp[0] * v * west, ob.cz + ob.uz * u + perp[1] * v * west];
    const d0 = r1 + 3.5, rows = 24, U = 74;
    { const [x, z] = P(0, d0 - 0.6); addBox('concrete', x, 0, z, U * 2, 1.2, 1.4, ob.ang, 'concrete'); }
    for (let k = 0; k < rows; k++) {
      const v = d0 + 0.6 + k * 0.85, top = 1.4 + k * 0.48;
      for (let u0 = -U; u0 < U; u0 += 12) {
        const mid = u0 + 6, red = Math.abs(mid) < 16, aisle = false;
        const key = red ? 'seatRed' : 'seatBlue';
        const [x, z] = P(mid, v); addBox('concrete', x, 0, z, 11.2, 0.86, top, ob.ang, 'concrete');
        for (let seat = 0; seat < 20; seat++) { const [sx, sz] = P(u0 + 0.55 + seat * 0.54, v); addBox(key, sx, top, sz, 0.45, 0.42, 0.18, ob.ang); addBox(key, sx, top + 0.18, sz, 0.45, 0.1, 0.35, ob.ang); }
        void aisle;
      }
      if (k % 8 === 7) { const [x, z] = P(0, v + 0.43); addBox('concrete', x, top, z, U * 2, 0.4, 0.5, ob.ang, 'concrete'); }
    }
    const back = d0 + rows * 0.85 + 1.2;
    const topY = 1.4 + rows * 0.48;
    addPrism('f:stoneGrey', [P(-U - 2, back), P(U + 2, back), P(U + 2, back + 4), P(-U - 2, back + 4)], 0, topY + 2.5, 'roof:light');
    for (const sg of [-1, 1]) { const [x, z] = P(sg * (U + 0.6), (d0 + back) / 2); addBox('concrete', x, 0, z, back - d0, 1.2, topY + 0.6, ob.ang + Math.PI / 2, 'concrete'); }
    { const [sx, sz] = P(0, d0 + 8.6); addSign('精业济群', sx, 6.3, sz, -perp[0] * west, -perp[1] * west, 1.9, { color: '#ffffff', bg: '#c41a20', fs: 110, gap: 0.6, metal: 0, rough: 0.6 }); }
    const bays = 8, bw = (U * 2 + 4) / bays, yb = 27, yf = 19.5, arch = 4.2, depth = rows * 0.85 + 9;
    const vb = back + 2, vf = vb - depth;
    const rib = (s, t) => { const v = lerp(vb, vf, t), y = lerp(yb, yf, t) + Math.sin(Math.PI * t) * 2.4; return [v, y]; };
    const M = buf('membrane'); M.cur = -1;
    for (let i = 0; i < bays; i++) {
      const u0 = -U - 2 + i * bw;
      const NS = 10, NT = 10;
      const pt = (si, ti) => { const sN = si / NS, tN = ti / NT, u = u0 + sN * bw; const [v, y] = rib(sN, tN); const [x, z] = P(u, v); return [x, y + Math.sin(Math.PI * sN) * arch * (0.35 + 0.65 * tN), z, sN, tN]; };
      for (let si = 0; si < NS; si++) for (let ti = 0; ti < NT; ti++) M.quadO(pt(si, ti), pt(si + 1, ti), pt(si + 1, ti + 1), pt(si, ti + 1), 0, 1, 0);
    }
    for (let i = 0; i <= bays; i++) {
      const u = -U - 2 + i * bw, pts = [];
      for (let k = 0; k <= 12; k++) { const t = k / 12, [v, y] = rib(0, t); pts.push([...P(u, v), y]); }
      for (let k = 0; k < 12; k++) { const a = pts[k], b2 = pts[k + 1]; addBeam('white', [a[0], a[2] - 0.15, a[1]], [b2[0], b2[2] - 0.15, b2[1]], 0.24); addBeam('white', [a[0], a[2] - 0.95, a[1]], [b2[0], b2[2] - 0.95, b2[1]], 0.18); addBeam('metal', [a[0], a[2] - 0.95, a[1]], [b2[0], b2[2] - 0.15, b2[1]], 0.1); }
      const [cx2, cz2] = P(u, vb); addCyl('white', cx2, 0, cz2, 0.55, yb - 0.5, 10);
      const [fx, fz] = P(u, vb - depth * 0.55); addCyl('white', fx, 1.4 + rows * 0.48, fz, 0.32, lerp(yb, yf, 0.55) + 1.6 - (1.4 + rows * 0.48), 8);
    }
    for (let i = 0; i < bays; i++) for (const t of [0, 0.5, 1]) {
      const [v, y] = rib(0, t); const u0 = -U - 2 + i * bw;
      for (let j = 0; j < 12; j++) {
        const a = j / 12, c = (j + 1) / 12, p0 = P(u0 + a * bw, v), p1 = P(u0 + c * bw, v);
        const y0 = y + Math.sin(Math.PI * a) * arch * (0.35 + 0.65 * t) - 0.15, y1 = y + Math.sin(Math.PI * c) * arch * (0.35 + 0.65 * t) - 0.15;
        addBeam('white', [p0[0], y0, p0[1]], [p1[0], y1, p1[1]], 0.13);
        addBeam('white', [p0[0], y0 - 0.7, p0[1]], [p1[0], y1, p1[1]], 0.08);
      }
    }
    for (const s2 of [-1, 1]) {
      const [gx, gz] = P(s2 * 52.5, 0), gp = [-ob.uz, ob.ux];
      for (const v of [-3.66, 3.66]) addCyl('white', gx + gp[0] * v, 0, gz + gp[1] * v, 0.07, 2.44, 6);
      addBox('white', gx, 2.38, gz, 0.14, 7.5, 0.12, ob.ang + Math.PI / 2, 'white');
    }
    for (const [u, v] of [[-72, -60], [72, -60]]) {
      const [x, z] = [ob.cx + ob.ux * u - ob.uz * v * west, ob.cz + ob.uz * u + ob.ux * v * west];
      addCyl('metal', x, 0, z, 0.45, 30, 8, 0.3); addBox('lamp', x, 29, z, 4, 1.2, 2.6, ob.ang, 'metal');
    }
  }
  for (const c of COURTS) {
    const ob = c.ob, P = (u, v) => [ob.cx + ob.ux * u - ob.uz * v, ob.cz + ob.uz * u + ob.ux * v];
    if (c.type === 'basketball') {
      for (const s of [-1, 1]) {
        const [x, z] = P(s * (c.cl / 2 + 0.9), 0);
        addCyl('metal', x, 0, z, 0.1, 3.3, 6);
        const [hx, hz] = P(s * (c.cl / 2 - 0.3), 0); addBox('white', hx, 2.95, hz, 0.1, 1.8, 1.05, ob.ang + Math.PI / 2, 'white');
      }
    } else if (c.type === 'tennis' && c.i === 0) {
      addFenceRect(rectPoly(ob.cx, ob.cz, ob.L, ob.W, ob.ang), 3.6);
    } else if (c.type === 'soccer') {
      for (const s of [-1, 1]) {
        const [x, z] = P(s * (ob.L / 2 - 1.5), 0); addBox('white', x, 2.2, z, 0.14, 7.3, 0.12, ob.ang + Math.PI / 2, 'white');
        for (const v of [-3.6, 3.6]) { const [px, pz] = P(s * (ob.L / 2 - 1.5), v); addCyl('white', px, 0, pz, 0.07, 2.3, 6); }
      }
    }
  }
}
const FENCE_RECTS = [];
function addFenceRect(p, h) { FENCE_RECTS.push({ p, h }); }
function buildCourtFences() {
  if (!FENCE_RECTS.length) return;
  const c = mkCanvas(64, 64), g = c.getContext('2d'); g.strokeStyle = '#2f5b46'; g.lineWidth = 1.4;
  for (let i = -64; i < 128; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
  g.fillStyle = '#2f5b46'; g.fillRect(0, 0, 3, 64);
  const m = new THREE.MeshStandardMaterial({ map: canvasTex(c), alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.7 });
  const pos = [], uv = [];
  for (const { p, h } of FENCE_RECTS) for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], h, b[1], a[0], 0, a[1], b[0], h, b[1], a[0], h, a[1]);
    uv.push(0, 0, l / 3, 0, l / 3, h / 3, 0, 0, l / 3, h / 3, 0, h / 3);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, m));
}

const TRACKS = [];
function buildViaduct(pts, deckY, w, opts = {}) {
  OWNER = -1;
  addRibbon('concrete', pts, w, deckY - 1.8, deckY);
  for (const s of [-1, 1]) addRibbon('concrete', offsetLine(pts, s * (w / 2 - 0.2)), 0.35, deckY, deckY + 1.0);
  const cum = cumLen(pts), L = cum[cum.length - 1];
  for (let s = 6; s < L - 3; s += opts.span || 32) {
    const q = sampleAt(pts, cum, s); if (opts.skip && opts.skip(q)) continue;
    const ang = Math.atan2(q.dz, q.dx);
    addBox('concrete', q.x, 0, q.z, 2.4, 2.4, deckY - 3.2, ang, 'concrete');
    addBox('concrete', q.x, deckY - 3.2, q.z, 2.6, w - 1.5, 1.4, ang, 'concrete');
  }
  for (const o of opts.tracks || [-2.1, 2.1]) for (const r of [-0.72, 0.72]) addRibbon('dark', offsetLine(pts, o + r), 0.14, deckY, deckY + 0.2);
}
function clipPts(p, R = 3600) { return p.filter((q) => Math.hypot(q[0], q[1]) < R); }
function buildRail() {
  const metro = D.rl.filter((r) => r.t === 'subway' && r.ly === 2);
  const turn = D.rl.filter((r) => /折返线/.test(r.n));
  if (metro.length) {
    let a = clipPts(metro[0].p);
    const st = byName(/^中国药科大学$/);
    if (st && Math.hypot(a[0][0] - st.c[0], a[0][1] - st.c[1]) < Math.hypot(a[a.length - 1][0] - st.c[0], a[a.length - 1][1] - st.c[1])) a = a.slice().reverse();
    buildViaduct(a, 11.5, 10.5, { skip: (q) => st && pip(q.x, q.z, st.p) });
    TRACKS.push({ kind: 'metro', p: a, y: 11.7 });
  }
  if (turn.length) buildViaduct(turn[0].p, 9.5, 10, { span: 28 });
  const hsr = D.rl.filter((r) => r.t === 'rail');
  const nh = hsr.filter((r) => /宁杭/.test(r.n)), hy = hsr.filter((r) => /沿江/.test(r.n) && r.br === 'viaduct');
  if (nh.length) { const p = clipPts(nh[0].p); buildViaduct(p, 14, 13, { tracks: [-2.5, 2.5], span: 32 }); TRACKS.push({ kind: 'hsr', p, y: 14.2 }); }
  if (hy.length) { const p = clipPts(hy[0].p); buildViaduct(p, 22, 13, { tracks: [-2.5, 2.5], span: 36 }); TRACKS.push({ kind: 'hsr', p, y: 22.2 }); }
  for (const [k, x, z, n] of D.n) if (k === 'subway_entrance' && !byName(/^中国药科大学$/)) {
    addBox('f:glass', x, 0, z, 7, 4, 3.6, -0.6, 'roof:metal'); addBox('trim:white', x, 3.6, z, 8, 5, 0.35, -0.6, 'trim:white');
    addSign(`地铁 ${n.replace(/.*#/, '')} 号口`, x + 0.565 * 2.6, 4.3, z + 0.825 * 2.6, 0.565, 0.825, 0.62, { color: '#fff', bg: '#0a8fc7', family: '"Noto Sans SC", sans-serif', weight: 700, metal: 0, fs: 80 });
  }
}

const OREG = { x0: -3200, z0: -3200, x1: 3200, z1: 3200 };
const ZONES = [
  { k: 'tower', ang: -0.55, p: [[-1000, 420], [-430, 420], [-90, 640], [-90, 1260], [-1000, 1260]] },
  { k: 'tower', ang: -0.55, p: [[640, -220], [1170, -220], [1170, 880], [640, 880]] },
  { k: 'tower', ang: -0.15, p: [[-200, -1720], [520, -1720], [520, -1040], [-200, -1040]] },
  { k: 'villa', ang: -0.22, p: [[-1360, -980], [-620, -980], [-620, 290], [-1360, 290]] },
  { k: 'mid', ang: -0.05, p: [[-2950, -3000], [-1360, -3000], [-1360, 700], [-2950, 700]] },
  { k: 'mid', ang: -0.35, p: [[-1360, -1760], [-200, -1760], [-200, -980], [-1360, -980]] },
  { k: 'mid', ang: -0.3, p: [[-2950, 700], [-1000, 700], [-1000, 2950], [-2950, 2950]] },
  { k: 'ind', ang: -0.75, p: [[-150, -3000], [2950, -3000], [2950, -1260], [520, -1260], [520, -1720], [-150, -1760]] },
  { k: 'camp', ang: -0.6, p: [[420, 0], [640, 0], [640, 660], [420, 660]] },
  { k: 'farm', ang: -0.3, p: [[-1000, 1260], [2950, 1260], [2950, 2950], [-1000, 2950]] },
  { k: 'farm', ang: -0.6, p: [[1170, -1260], [2950, -1260], [2950, 1260], [1170, 1260]] },
  { k: 'farm', ang: -0.45, p: [[-90, 880], [1170, 880], [1170, 1260], [-90, 1260]] },
];
const ZBASE = { tower: '#aaa79c', mid: '#a9a596', villa: '#a5a48f', ind: '#b3b1a6', camp: '#a9a594', farm: '#8e9a6c' };
const ORW = { motorway: 26, trunk: 22, primary: 22, secondary: 16, tertiary: 11, unclassified: 7, residential: 6, living_street: 5, service: 4, road: 6, motorway_link: 8, secondary_link: 8, tertiary_link: 7 };
let OUTER = null, OMASK = null;
const OMS = 0.5;
function inZone(x, z) { for (const Z of ZONES) if (pip(x, z, Z.p)) return Z; return null; }
function paintOuter() {
  const N = QUALITY === 'low' ? 2048 : 4096, sc = N / (OREG.x1 - OREG.x0);
  const cv = mkCanvas(N, N), g = cv.getContext('2d');
  g.setTransform(sc, 0, 0, sc, -OREG.x0 * sc, -OREG.z0 * sc); g.lineJoin = g.lineCap = 'round';
  g.fillStyle = '#8f9871'; g.fillRect(OREG.x0, OREG.z0, OREG.x1 - OREG.x0, OREG.z1 - OREG.z0);
  const rn = mulberry(4242), R = (a, b) => a + (b - a) * rn();
  for (const Z of ZONES) {
    g.save(); g.beginPath(); tracePoly(g, Z.p); g.clip();
    g.fillStyle = ZBASE[Z.k]; g.fillRect(OREG.x0, OREG.z0, OREG.x1 - OREG.x0, OREG.z1 - OREG.z0);
    const bb = pBox(Z.p), cs = Math.cos(Z.ang), sn = Math.sin(Z.ang);
    if (Z.k === 'farm') {
      for (let u = bb[0] - 400; u < bb[2] + 400; u += R(40, 90)) for (let v = bb[1] - 400; v < bb[3] + 400; v += R(30, 80)) {
        g.save(); g.translate(u, v); g.rotate(Z.ang + R(-0.06, 0.06));
        const w = R(30, 110), h = R(20, 70), roll = rn();
        g.fillStyle = roll < 0.16 ? pick(['#2f4a44', '#36524a', '#3e5b4f']) : pick(['#7d9a4c', '#8ea657', '#6f8c43', '#a3a35b', '#b4a86a', '#94985a', '#6b8a4a', '#c0b37a', '#7b8d58']);
        g.fillRect(-w / 2, -h / 2, w, h); g.strokeStyle = 'rgba(70,60,40,.35)'; g.lineWidth = 1.2; g.strokeRect(-w / 2, -h / 2, w, h); g.restore();
      }
    } else {
      for (let i = 0; i < 260; i++) { g.save(); g.translate(R(bb[0], bb[2]), R(bb[1], bb[3])); g.rotate(Z.ang); g.globalAlpha = 0.55; g.fillStyle = pick(['#7d9358', '#8a9a62', '#a29f90', '#b6b2a5', '#94a06c']); g.fillRect(-R(10, 40), -R(8, 30), R(20, 80), R(16, 60)); g.restore(); }
    }
    g.restore();
  }
  const LUC = { res: '#aba79a', ind: '#b3b1a6', com: '#b5afa2', con: '#b8a888', grass: '#86a05c', wood: '#56703f', park: '#7c9a57', edu: '#a7a798', rail: '#8e887d', farm: '#9aa45c', water: '#2f4a46' };
  for (const l of O.lu) { g.globalAlpha = l.k === 'res' || l.k === 'edu' ? 0.75 : 1; fillPoly(g, l.p, LUC[l.k] || '#a0a090'); }
  g.globalAlpha = 1;
  paintNortheast(g,false);
  for (const q of O.pi) { const c = q.k === 'stadium' ? '#8a8a84' : q.s === 'basketball' || q.s === 'tennis' ? '#3f6a8a' : '#5d9645'; fillPoly(g, q.p, c); }
  for (const w of O.ww) { traceLine(g, w.p); g.strokeStyle = '#2f4a46'; g.lineWidth = w.t === 'river' ? 34 : w.t === 'canal' ? 18 : w.t === 'stream' ? 6 : 4; g.stroke(); }
  for (const w of O.water) { fillPoly(g, w, '#2f4a46'); g.strokeStyle = '#7c7a68'; g.lineWidth = 2; g.stroke(); }
  for (const r of O.rail) { traceLine(g, r.p); g.strokeStyle = r.br ? '#8d8d88' : '#857d70'; g.lineWidth = r.t === 'rail' ? 9 : 7; g.stroke(); }
  const roads = O.roads.slice().sort((a, b) => (ORW[a.t] || 5) - (ORW[b.t] || 5));
  for (const r of roads) { traceLine(g, r.p); g.strokeStyle = '#b8b4aa'; g.lineWidth = (ORW[r.t] || 5) + 2.5; g.stroke(); }
  for (const r of roads) { traceLine(g, r.p); g.strokeStyle = r.t === 'motorway' ? '#45484b' : (ORW[r.t] || 5) > 10 ? '#4b4e51' : '#5a5c5d'; g.lineWidth = ORW[r.t] || 5; g.stroke(); }
  g.lineCap = 'butt'; g.setLineDash([5, 7]); g.strokeStyle = 'rgba(235,235,228,.8)'; g.lineWidth = 0.35;
  for (const r of roads) if ((ORW[r.t] || 5) >= 11) { traceLine(g, r.p); g.stroke(); }
  g.setLineDash([]); g.lineCap = 'round';
  OUTER = { canvas: cv, s: sc, N, g };
}
function buildOuterMask() {
  const N = Math.round((OREG.x1 - OREG.x0) * OMS), c = mkCanvas(N, N), g = c.getContext('2d');
  g.setTransform(OMS, 0, 0, OMS, -OREG.x0 * OMS, -OREG.z0 * OMS); g.lineJoin = g.lineCap = 'round'; g.fillStyle = g.strokeStyle = '#fff';
  for (const r of O.roads) { traceLine(g, r.p); g.lineWidth = (ORW[r.t] || 5) + 9; g.stroke(); }
  for (const r of D.r) { traceLine(g, r.p); g.lineWidth = roadW(r) + 9; g.stroke(); }
  for (const w of O.water) { g.beginPath(); tracePoly(g, w); g.fill(); g.lineWidth = 8; g.stroke(); }
  for (const w of WATERS) for (const o of w.outer) { g.beginPath(); tracePoly(g, o); g.fill(); g.lineWidth = 8; g.stroke(); }
  for (const w of O.ww) { traceLine(g, w.p); g.lineWidth = w.t === 'river' ? 44 : w.t === 'canal' ? 26 : 10; g.stroke(); }
  for (const r of O.rail) { traceLine(g, r.p); g.lineWidth = 26; g.stroke(); }
  for (const r of D.rl) { traceLine(g, r.p); g.lineWidth = 22; g.stroke(); }
  for (const b of O.b) { g.beginPath(); tracePoly(g, b.p); g.fill(); g.lineWidth = 8; g.stroke(); }
  for (const b of BLD) { g.beginPath(); tracePoly(g, b.p); g.fill(); g.lineWidth = 8; g.stroke(); }
  for (const l of O.lu) if (l.k === 'wood' || l.k === 'park' || l.k === 'grass' || l.k === 'rail' || l.k === 'edu') { g.beginPath(); tracePoly(g, l.p); g.fill(); }
  for (const l of D.lu) if (l.k === 'railway' || l.k === 'parking' || l.k === 'kindergarten') { g.beginPath(); tracePoly(g, l.p); g.fill(); }
  g.beginPath(); tracePoly(g, insetPoly(CAMPUS, -25)); g.fill();
  const d = g.getImageData(0, 0, N, N).data, a = new Uint8Array(N * N);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] > 20 ? 1 : 0;
  OMASK = { a, N };
}
const oBlocked = (x, z) => { const ix = Math.floor((x - OREG.x0) * OMS), iz = Math.floor((z - OREG.z0) * OMS); if (ix < 0 || iz < 0 || ix >= OMASK.N || iz >= OMASK.N) return true; return OMASK.a[iz * OMASK.N + ix] === 1; };
function oFree(p) { for (const q of p) if (oBlocked(q[0], q[1])) return false; const c = pCentroid(p); return !oBlocked(c[0], c[1]); }
function oMark(p) { const bb = pBox(p); for (let x = bb[0]; x <= bb[2]; x += 1 / OMS) for (let z = bb[1]; z <= bb[3]; z += 1 / OMS) if (pip(x, z, p)) { const ix = Math.floor((x - OREG.x0) * OMS), iz = Math.floor((z - OREG.z0) * OMS); if (ix >= 0 && iz >= 0 && ix < OMASK.N && iz < OMASK.N) OMASK.a[iz * OMASK.N + ix] = 1; } }
const OUT_BLD = [];
function buildCity() {
  OWNER = -1;
  const g = OUTER.g, rn = mulberry(9090), R = (a, b) => a + (b - a) * rn(), P = (a) => a[Math.floor(rn() * a.length)];
  const foot = (p, col) => { g.beginPath(); tracePoly(g, p); g.fillStyle = col; g.fill(); };
  const put = (p, fn, col = '#6c6e70', pad = 3) => { const c=pCentroid(p);if(NE.patches.some(q=>pip(...c,q.p))||NE.reserves.some(p=>pip(...c,p)))return false;const q = insetPoly(p, -pad); if (!oFree(q)) return false; oMark(q); fn(p); foot(p, col); OUT_BLD.push(p); return true; };
  const flatRoof = (p, h, roof = 'roof:light') => { addCap(roof, p, h); };
  for (const b of O.b) {
    if (b.p.length < 3 || Math.abs(pArea(b.p)) < 25) continue;
    const bc = pCentroid(b.p); if (pip(bc[0],bc[1],CAMPUS)) continue;
    const lv = b.l || (Math.abs(pArea(b.p)) > 3000 ? 2 : Math.abs(pArea(b.p)) > 600 ? 5 : 3), h = lv * 3.2;
    const st = Math.abs(pArea(b.p)) > 3000 ? 'shed' : P(['city', 'cityW', 'plain', 'cityB']);
    addWalls('f:' + st, b.p, 0, h); flatRoof(b.p, h, st === 'shed' ? 'roof:metal' : 'roof:light'); foot(b.p, '#6c6e70');
  }
  for (const Z of ZONES) {
    const bb = pBox(Z.p), cs = Math.cos(Z.ang), sn = Math.sin(Z.ang), cx = (bb[0] + bb[2]) / 2, cz = (bb[1] + bb[3]) / 2, Rr = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2;
    const grid = (du, dv, fn) => { for (let u = -Rr; u < Rr; u += du) for (let v = -Rr; v < Rr; v += dv) { const x = cx + u * cs - v * sn, z = cz + u * sn + v * cs; if (pip(x, z, Z.p)) fn(x, z); } };
    if (Z.k === 'tower') grid(68, 58, (x, z) => {
      if (rn() < 0.12) return;
      const point = rn() < 0.3, L = point ? R(22, 26) : R(32, 40), Wd = point ? R(20, 24) : R(14, 17), fl = Math.round(R(18, 33)), h = fl * 3;
      const p = rectPoly(x + R(-4, 4), z + R(-4, 4), L, Wd, Z.ang); const st = P(['city', 'cityW', 'city', 'cityB', 'cityG']);
      put(p, (q) => { addWalls('f:' + st, q, 0, h); addCap('roof:light', q, h); addParapet('trim:white', q, h, 1.2, 0.3); const c = pCentroid(q); addPrism('f:' + st, rectPoly(c[0], c[1], L * 0.32, Wd * 0.55, Z.ang), h, h + 4.5, 'roof:light'); }, '#686a6c', 8);
    });
    else if (Z.k === 'mid') grid(64, 36, (x, z) => {
      if (rn() < 0.18) return;
      const L = R(40, 58), Wd = R(12, 14), fl = Math.round(R(5, 11)), h = fl * 3; const st = P(['city', 'cityB', 'cityW', 'city']);
      const p = rectPoly(x + R(-3, 3), z + R(-3, 3), L, Wd, Z.ang);
      put(p, (q) => { addWalls('f:' + st, q, 0, h); if (fl <= 7 && rn() < 0.5) { addParapet('trim:white', q, h, 0.4, 0.2); addHipRoof(rn() < 0.6 ? 'roof:tileGrey' : 'roof:tileRed', q, h + 0.4, 2.6, 4.2); } else { addCap('roof:light', q, h); addParapet('trim:white', q, h, 1.0, 0.25); } }, '#6a6c6d', 6);
    });
    else if (Z.k === 'villa') grid(30, 26, (x, z) => {
      if (rn() < 0.15) return;
      const L = R(14, 20), Wd = R(10, 12), fl = rn() < 0.7 ? 3 : 4, h = fl * 3.2;
      const p = rectPoly(x + R(-2, 2), z + R(-2, 2), L, Wd, Z.ang + R(-0.04, 0.04));
      put(p, (q) => { addWalls('f:villa', q, 0, h); addHipRoof(rn() < 0.75 ? 'roof:tileRed' : 'roof:tileGrey', q, h, 3.0, 4.6); }, '#7a6e66', 3);
    });
    else if (Z.k === 'ind') {
      const lots = Math.round(Math.abs(pArea(Z.p)) / 30000);
      for (let i = 0; i < lots * 4; i++) {
        const x = R(bb[0], bb[2]), z = R(bb[1], bb[3]); if (!pip(x,z,Z.p)) continue;
        const L = R(45, 160), Wd = R(22, 78), h = R(7.5, 17), ang = Z.ang + (rn()<0.26 ? Math.PI/2 : 0) + R(-0.1,0.1);
        const p = rectPoly(x, z, L, Wd, ang); if (!p.every(q=>pip(...q,Z.p))) continue;
        put(p, q => {
          addWalls('f:shed', q, 0, h); addCap(rn()<0.06 ? 'roof:metalBlue' : rn()<0.55 ? 'roof:light' : 'roof:metal', q, h);
          if (rn()<0.65) for (let u = -L/2+7; u < L/2-4; u += 14) { const px=x+Math.cos(ang)*u,pz=z+Math.sin(ang)*u; addBox('roof:light',px,h,pz,3,Wd*0.7,0.3,ang); }
          g.beginPath(); tracePoly(g,insetPoly(q,-9)); g.strokeStyle='#7e807d';g.lineWidth=5.5;g.stroke();
          if (rn()<0.5) { const yard=rectPoly(x-Math.sin(ang)*(Wd/2+18),z+Math.cos(ang)*(Wd/2+18),L*0.55,16,ang);fillPoly(g,yard,'#aca99f'); }
        }, '#81837f', 24);
      }
    }
    else if (Z.k === 'camp') grid(34, 16, (x, z) => {
      if (rn() < 0.3) return;
      const p = rectPoly(x, z, R(22, 30), 7, Z.ang);
      put(p, (q) => { addWalls('f:labw', q, 0, 6.4); addCap('roof:metalBlue', q, 6.4); }, '#6c7c90', 2);
    });
    else if (Z.k === 'farm') {
      const nv = Math.round(Math.abs(pArea(Z.p)) / 260000);
      for (let k = 0; k < nv; k++) {
        const vx = R(bb[0], bb[2]), vz = R(bb[1], bb[3]); if (!pip(vx, vz, Z.p)) continue;
        const nh = Math.round(R(12, 40)), rad = Math.sqrt(nh) * 13;
        for (let i = 0; i < nh * 1.6; i++) {
          const a = R(0, 6.28), r = rad * Math.sqrt(rn()), x = vx + Math.cos(a) * r, z = vz + Math.sin(a) * r;
          const p = rectPoly(x, z, R(10, 14), R(7, 9), Z.ang + R(-0.1, 0.1)), h = Math.round(R(2, 3.4)) * 3.2;
          put(p, (q) => { addWalls('f:' + P(['villa', 'plain', 'cityW']), q, 0, h); addHipRoof(rn() < 0.55 ? 'roof:tileGrey' : 'roof:tileRed', q, h, 2.2, 3.2); }, '#7a7068', 2.5);
        }
      }
    }
  }
  for (const p of OUT_BLD) { const c = pCentroid(p); g.save(); g.globalAlpha = 0.18; g.fillStyle = '#000'; g.beginPath(); tracePoly(g, p.map((q) => [q[0] + 3, q[1] + 3])); g.fill(); g.restore(); void c; }
  const n1 = noiseCanvas(256, 4, 4, 177, 70, 190);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.5; const pn = g.createPattern(n1, 'repeat'); pn.setTransform(new DOMMatrix().scale(OUTER.s * 300 / 256)); g.fillStyle = pn; g.fillRect(0, 0, OUTER.N, OUTER.N); g.restore();
  { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); const N = OUTER.N, bw = N * 0.07;
    for (const [x, y, w, h, gx0, gy0, gx1, gy1] of [[0, 0, bw, N, 0, 0, bw, 0], [N - bw, 0, bw, N, N, 0, N - bw, 0], [0, 0, N, bw, 0, 0, 0, bw], [0, N - bw, N, bw, 0, N, 0, N - bw]]) { const gr = g.createLinearGradient(gx0, gy0, gx1, gy1); gr.addColorStop(0, 'rgba(143,150,113,1)'); gr.addColorStop(1, 'rgba(143,150,113,0)'); g.fillStyle = gr; g.fillRect(x, y, w, h); }
    g.restore(); }
}
function placeOuterTrees() {
  const rn = mulberry(5151), R = (a, b) => a + (b - a) * rn();
  const ok = (x, z) => !(x > REG.x0 && x < REG.x1 && z > REG.z0 && z < REG.z1) && !oBlocked(x, z);
  for (const l of O.lu) {
    if (!['wood', 'park', 'grass'].includes(l.k)) continue;
    const bb = pBox(l.p), sp = l.k === 'wood' ? 12 : 26;
    for (let x = bb[0]; x < bb[2]; x += sp) for (let z = bb[1]; z < bb[3]; z += sp) { const px = x + R(0, sp), pz = z + R(0, sp); if (pip(px, pz, l.p) && !(px > REG.x0 && px < REG.x1 && pz > REG.z0 && pz < REG.z1)) addTree(rn() < 0.7 ? 'camphor' : rn() < 0.5 ? 'metasequoia' : 'cedar', px, pz, R(0.8, 1.1)); }
  }
  for (const r of O.roads) {
    if ((ORW[r.t] || 5) < 7) continue;
    const w = ORW[r.t] || 5, sp = 16;
    for (const side of [-1, 1]) { const line = offsetLine(r.p, side * (w / 2 + 3)), cum = cumLen(line); for (let s2 = R(0, sp); s2 < cum[cum.length - 1]; s2 += sp) { const q = sampleAt(line, cum, s2); if (Math.abs(q.x) < 3150 && Math.abs(q.z) < 3150 && !(q.x > REG.x0 && q.x < REG.x1 && q.z > REG.z0 && q.z < REG.z1)) addTree(r.t === 'motorway' ? 'metasequoia' : 'camphor', q.x, q.z, 0.9); } }
  }
  for (let i = 0; i < 9000 * QP.trees; i++) {
    const x = R(OREG.x0 + 50, OREG.x1 - 50), z = R(OREG.z0 + 50, OREG.z1 - 50); if (!ok(x, z)) continue;
    const Z = inZone(x, z), k = Z ? Z.k : 'none';
    const p = { tower: 0.5, mid: 0.6, villa: 0.75, ind: 0.22, camp: 0.1, farm: 0.18, none: 0.4 }[k];
    if (rn() > p) continue;
    addTree(k === 'farm' ? (rn() < 0.5 ? 'metasequoia' : 'camphor') : rn() < 0.6 ? 'camphor' : rn() < 0.5 ? 'ginkgo' : 'cherry', x, z, R(0.8, 1.05));
  }
}
function placeNorthTrees(){
  const rn=mulberry(8137),nearRoads=D.r.concat(O.roads).filter(r=>r.p.some(p=>p[0]>-250&&p[0]<1150&&p[1]<-450&&p[1]>-1300));
  const roadFree=(x,z)=>!nearRoads.some(r=>r.p.slice(1).some((b,i)=>{const a=r.p[i],dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<(r.t==='motorway'?18:r.t==='secondary'?12:6);}));
  for(const patch of NE.patches.concat(NE.reserves.map(p=>({p,kind:'wood',fill:true})))){
    const ob=obb(patch.p),spacing=patch.kind==='wood'?9:patch.kind==='nursery'?8:28;
    for(let u=-ob.L/2;u<ob.L/2;u+=spacing)for(let v=-ob.W/2;v<ob.W/2;v+=patch.kind==='nursery'?11:spacing){
      const j=patch.kind==='wood'?spacing*.7:1.2,x=ob.cx+ob.ux*u-ob.uz*v+(rn()-.5)*j,z=ob.cz+ob.uz*u+ob.ux*v+(rn()-.5)*j;
      if(!pip(x,z,patch.p)||(patch.fill&&NE.patches.some(p=>pip(x,z,p.p)))||inWater(x,z)||!roadFree(x,z)||BLD.some(b=>pip(x,z,b.p)))continue;
      addTree(patch.kind==='field'?'metasequoia':rn()<.7?'camphor':'cedar',x,z,patch.kind==='wood'?.85+rn()*.3:patch.kind==='nursery'?.48+rn()*.12:.55);
    }
  }
  for(const r of nearRoads.filter(r=>r.t==='motorway'||r.n==='格致路'))for(const side of [-1,1]){
    const line=offsetLine(r.p,side*(r.t==='motorway'?22:16)),cum=cumLen(line);
    for(let d=0;d<cum[cum.length-1];d+=8){const q=sampleAt(line,cum,d);if(q.x>-150&&q.x<1100&&q.z>-1250&&q.z<-480&&!inWater(q.x,q.z))addTree('metasequoia',q.x,q.z,.9);}
  }
}
function buildHills() {
  const NR = 34, NT = 320, r0 = 4200, r1 = 17000, pos = [], col = [], idx = [];
  const rn = mulberry(77), lat = new Float32Array(64 * 64).map(() => rn());
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, s = (a) => a * a * (3 - 2 * a); const L = (i, j) => lat[((j & 63) * 64) + (i & 63)]; return lerp(lerp(L(xi, yi), L(xi + 1, yi), s(fx)), lerp(L(xi, yi + 1), L(xi + 1, yi + 1), s(fx)), s(fy)); };
  const fbm = (x, y) => { let a = 0.5, t = 0; for (let k = 0; k < 5; k++) { t += a * vn(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return t; };
  const ranges = [
    { th: -0.42, w: 0.5, r: 7800, rw: 1700, h: 300, name: 'qinglong', quarry: true },
    { th: 0.72, w: 0.14, r: 6200, rw: 900, h: 210, flat: true },
    { th: 2.75, w: 0.55, r: 10500, rw: 2400, h: 260 },
    { th: -1.75, w: 0.3, r: 15000, rw: 2000, h: 440 },
    { th: 1.7, w: 0.35, r: 12500, rw: 2200, h: 220 },
  ];
  const ang = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  for (let i = 0; i <= NR; i++) for (let j = 0; j <= NT; j++) {
    const r = r0 + (r1 - r0) * Math.pow(i / NR, 1.4), th = j / NT * Math.PI * 2 - Math.PI;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    let h = 0, q = 0;
    for (const G of ranges) {
      const da = ang(th, G.th) / G.w, dr = (r - G.r) / G.rw;
      let m = Math.exp(-da * da * 2.2) * Math.exp(-dr * dr * 2.4);
      if (G.flat) m = Math.min(1, m * 1.8);
      const n = fbm(x * 0.0009 + 3, z * 0.0009 + 7);
      h += G.h * m * (G.flat ? 0.85 + 0.15 * n : 0.45 + n * 0.9);
      if (G.quarry && m > 0.35) q = Math.max(q, smooth(0.62, 0.7, fbm(x * 0.003, z * 0.003)) * smooth(0.35, 0.6, m));
    }
    h *= smooth(r0, r0 + 1500, r);
    pos.push(x, h - 6, z);
    const c = new THREE.Color('#5f7158').lerp(new THREE.Color('#4a5e4a'), clamp(h / 300, 0, 1)).lerp(new THREE.Color('#c9c4b8'), q);
    col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NT; j++) { const a = i * (NT + 1) + j, b = a + 1, c = a + NT + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  m.receiveShadow = false; scene.add(m);
}
const SPECIES = {
  camphor: { leaf: 'broad', rx: 4.6, ry: 3.4, base: 2.6, tr: 0.27, br: 6, cards: 150, cs: 1.75, ev: 1 },
  willow: { leaf: 'willow', rx: 4.3, ry: 3.6, base: 2.4, tr: 0.26, br: 5, cards: 130, cs: 1.8, weep: 1 },
  cherry: { leaf: 'broad', rx: 3.6, ry: 2.3, base: 1.7, tr: 0.18, br: 5, cards: 105, cs: 1.5 },
  ginkgo: { leaf: 'ginkgo', rx: 2.5, ry: 4.4, base: 2.8, tr: 0.2, br: 7, cards: 100, cs: 1.35 },
  metasequoia: { leaf: 'needle', rx: 2.4, ry: 7.4, base: 1.6, tr: 0.26, cone: 1, cards: 125, cs: 1.55 },
  cedar: { leaf: 'needle', rx: 4.0, ry: 5.2, base: 0.8, tr: 0.3, cone: 1, cards: 145, cs: 1.95, ev: 1 },
  maple: { leaf: 'maple', rx: 2.7, ry: 2.0, base: 1.5, tr: 0.13, br: 5, cards: 80, cs: 1.3 },
  shrub: { leaf: 'broad', rx: 1.7, ry: 0.95, base: 0, tr: 0, cards: 26, cs: 1.1, ev: 1, shrub: 1 },
};
const SCOL = {
  camphor: { spring: ['#8fb552', '#9fbe5c'], summer: ['#4e8236', '#64923f'], autumn: ['#577f3a', '#6c8c40'], winter: ['#4d703c', '#5d7d44'] },
  willow: { spring: ['#b5d65e', '#c9e47a'], summer: ['#76a446', '#88b152'], autumn: ['#c1b356', '#d4bd5e'], winter: null },
  cherry: { spring: 'blossom', summer: ['#5f9240', '#70a049'], autumn: ['#cf5e33', '#e5913f'], winter: null },
  ginkgo: { spring: ['#b6dc6f', '#c8e482'], summer: ['#6ea544', '#7fb050'], autumn: ['#f7c818', '#fbda44'], winter: null },
  metasequoia: { spring: ['#a2d16a', '#b2da78'], summer: ['#5c9443', '#6ca04d'], autumn: ['#c05c2e', '#d37534'], winter: null },
  cedar: { spring: ['#4c7049', '#5b7f56'], summer: ['#466a47', '#557a54'], autumn: ['#486b47', '#577a55'], winter: ['#425f42', '#4f6e4e'] },
  maple: { spring: ['#b74e33', '#a4b04f'], summer: ['#70a044', '#9a4532'], autumn: ['#de3420', '#ee5d24'], winter: null },
  shrub: { spring: ['#6f9e45', '#b04533'], summer: ['#4f7f38', '#629040'], autumn: ['#7c7a38', '#a8432c'], winter: ['#55693d', '#655537'] },
};
const TREES = [];
function addTree(type, x, z, s = 1) {
  // The photographed Double-A forecourt is open lawn, not a wooded parcel.
  if (x > -130 && x < 65 && z > -658 && z < -455) return;
  if(type!=='shrub' && x>-300 && x<-150 && z>-30 && z<90) s*=0.68;
  if(pip(x,z,NE.site)||pip(x,z,NE.beds)||pip(x,z,NE.phase5Yard))return;
  if (NO_TREE.some((q) => pip(x, z, q))) return;
  for (const ob of ACADEMIC_COURTS) {
    const u = (x - ob.cx) * ob.ux + (z - ob.cz) * ob.uz, v = -(x - ob.cx) * ob.uz + (z - ob.cz) * ob.ux;
    if (Math.abs(u) < ob.L / 2 + 1 && Math.abs(v) < ob.W / 2 + 1) return;
  }
  TREES.push({ type, x, z, s: s * rr(0.8, 1.2), r: rand(), rot: rand() * 6.28, v: Math.floor(rand() * 3) });
}
function placeTrees() {
  const dens = QP.trees;
  const jitter = (p, spacing, fn) => {
    spacing /= Math.sqrt(dens); const bb = pBox(p);
    for (let x = bb[0]; x < bb[2]; x += spacing) for (let z = bb[1]; z < bb[3]; z += spacing) {
      const px = x + rr(0, spacing), pz = z + rr(0, spacing);
      if (pip(px, pz, p) && !blocked(px, pz)) fn(px, pz);
    }
  };
  const weighted = (w) => { let t = rand() * w.reduce((a, b) => a + b[1], 0); for (const [k, v] of w) { if ((t -= v) <= 0) return k; } return w[0][0]; };
  for (const q of D.g) {
    if (q.k === 'wood') jitter(q.p, 7.0, (x, z) => addTree(weighted([['camphor', 5], ['metasequoia', 2], ['ginkgo', 1.2], ['cherry', 0.8], ['cedar', 1], ['maple', 0.6]]), x, z));
    else if (q.k === 'scrub') { jitter(q.p, 4.0, (x, z) => addTree('shrub', x, z, 1.1)); jitter(q.p, 13, (x, z) => addTree(weighted([['camphor', 3], ['cherry', 1], ['maple', 1]]), x, z)); }
    else jitter(q.p, 22, (x, z) => addTree(weighted([['camphor', 4], ['cherry', 2], ['ginkgo', 2], ['cedar', 1], ['maple', 1]]), x, z));
  }
  const greenPolys = D.g.map((q) => q.p);
  jitter(CAMPUS, 24, (x, z) => { if (greenPolys.some((p) => pip(x, z, p))) return; addTree(weighted([['camphor', 4], ['ginkgo', 2], ['cherry', 1], ['shrub', 3], ['maple', 0.8]]), x, z); });
  for (const r of D.r) {
    const inside = inCampus(r.p[0][0], r.p[0][1]) || inCampus(r.p[r.p.length - 1][0], r.p[r.p.length - 1][1]);
    if (r.t === 'service' && !inside) continue;
    const w = roadW(r), sp = (inside ? 8.5 : 11) / Math.sqrt(dens), type = /以仁|精业/.test(r.n || '') ? 'ginkgo' : /博爱/.test(r.n || '') ? 'metasequoia' : /博学|博思|博雅/.test(r.n || '') ? 'cherry' : 'camphor';
    for (const side of [-1, 1]) {
      const line = offsetLine(r.p, side * (w / 2 + 2.6)), cum = cumLen(line);
      for (let s2 = rr(0, sp); s2 < cum[cum.length - 1]; s2 += sp) { const q = sampleAt(line, cum, s2); if (!blocked(q.x, q.z) && q.x > REG.x0 && q.x < REG.x1 && q.z > REG.z0 && q.z < REG.z1) addTree(type, q.x, q.z, 0.95); }
    }
  }
  for (const w of WATERS) for (const o of w.outer.concat(w.inner)) {
    const ring = o.concat([o[0]]), cum = cumLen(ring), L = cum[cum.length - 1], isInner = w.inner.includes(o);
    const ccw = pArea(o) > 0;
    for (let s2 = rr(0, 6); s2 < L; s2 += 8 / Math.sqrt(dens)) {
      const q = sampleAt(ring, cum, s2); let nx = ccw ? q.dz : -q.dz, nz = ccw ? -q.dx : q.dx; if (isInner) { nx = -nx; nz = -nz; }
      const x = q.x + nx * 3.6, z = q.z + nz * 3.6;
      if (x < REG.x0 || x > REG.x1 || z < REG.z0 || z > REG.z1 || blocked(x, z)) continue;
      addTree(weighted([['willow', 6], ['cherry', 2.2], ['camphor', 1], ['maple', 0.7]]), x, z);
      if (rand() < 0.35) { const d = rr(5, 9); if (!blocked(q.x + nx * d, q.z + nz * d)) addTree('shrub', q.x + nx * d, q.z + nz * d, 0.9); }
    }
  }
  for (const b of BLD) {
    if (!inCampus(b.c[0], b.c[1]) || b.cls.special === 'station') continue;
    const ring = b.p.concat([b.p[0]]), cum = cumLen(ring), L = cum[cum.length - 1], ccw = pArea(b.p) > 0;
    for (let s2 = rr(0, 6); s2 < L; s2 += rr(5, 9)) {
      const q = sampleAt(ring, cum, s2), nx = ccw ? q.dz : -q.dz, nz = ccw ? -q.dx : q.dx, x = q.x + nx * 4.2, z = q.z + nz * 4.2;
      if (!blocked(x, z) && rand() < 0.6) addTree('shrub', x, z, rr(0.7, 1.0));
    }
  }
  for (let i = 0; i < 1600 * dens; i++) { const x = rr(REG.x0, REG.x1), z = rr(REG.z0, REG.z1); if (!inCampus(x, z) && !blocked(x, z)) addTree(weighted([['camphor', 4], ['metasequoia', 1], ['shrub', 2], ['cedar', 0.5]]), x, z, 0.9); }
  addTree('camphor', -451, 113, 1.35); addTree('camphor', -432, 151, 1.4);
  for (const [x, z] of LIB_TREES) addTree('camphor', x, z, 0.62);
  for (const [type, x, z, s] of TEACH_TREES) TREES.push({ type, x, z, s: s * rr(0.85, 1.1), r: rand(), rot: rand() * 6.28, v: Math.floor(rand() * 3) });
  for (let b = -17; b > -70; b -= 6.5) for (const a of [-9.6, 8.6]) { const [x, z] = gateP(a, b); addTree('ginkgo', x, z, 1.05); }
  for (let b = -18; b > -76; b -= 5) for (const a of [-12.5, 11.5]) { const [x, z] = gateP(a, b); addTree('ginkgo', x, z, 0.85); }
}
function leafAtlas(kind) {
  const c = mkCanvas(512, 512), g = c.getContext('2d'), rn = mulberry(kind.length * 977 + 3);
  const R = (a, b) => a + (b - a) * rn();
  const gray = (lo, hi) => { const v = Math.floor(R(lo, hi)); return `rgb(${v},${v},${v})`; };
  for (let qd = 0; qd < 4; qd++) {
    const ox = (qd % 2) * 256, oy = Math.floor(qd / 2) * 256, cx = ox + 128, cy = oy + 128;
    g.save(); g.beginPath(); g.rect(ox + 2, oy + 2, 252, 252); g.clip();
    if (kind === 'willow') {
      for (let k = 0; k < 30; k++) {
        const x = cx + R(-105, 105), y = oy + R(2, 26); const len = R(170, 240), sway = R(-14, 14);
        g.strokeStyle = gray(110, 150); g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + sway, y + len * 0.5, x + sway * 0.6, y + len); g.stroke();
        for (let t = 0; t < 1; t += 0.018) {
          const px = x + sway * 2 * t * (1 - t) + sway * 0.6 * t * t, py = y + len * t;
          for (const sd of [-1, 1]) { g.save(); g.translate(px, py); g.rotate(sd * R(0.3, 0.7)); g.fillStyle = gray(165, 250); g.beginPath(); g.ellipse(sd * 3.5, 4, 2.4, 7.5, 0, 0, 7); g.fill(); g.restore(); }
        }
      }
    } else if (kind === 'needle') {
      for (let k = 0; k < 11; k++) {
        const a = R(0, 6.28), len = R(60, 120), x1 = cx + Math.cos(a) * len, y1 = cy + Math.sin(a) * len * 0.75;
        g.strokeStyle = gray(60, 90); g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(x1, y1); g.stroke();
        for (let t = 0.1; t < 1; t += 0.03) {
          const px = cx + (x1 - cx) * t, py = cy + (y1 - cy) * t;
          for (const sd of [-1, 1]) { const na = a + sd * R(0.8, 1.2); g.strokeStyle = gray(120, 230); g.lineWidth = 1.3; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(na) * R(7, 13), py + Math.sin(na) * R(7, 13)); g.stroke(); }
        }
      }
    } else if (kind === 'blossom') {
      for (let k = 0; k < 40; k++) { const a = R(0, 6.28), r = 100 * Math.sqrt(rn()); g.fillStyle = `rgb(${R(90, 120)},${R(120, 150)},${R(70, 90)})`; g.beginPath(); g.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 7, 3.5, R(0, 3), 0, 7); g.fill(); }
      for (let k = 0; k < 230; k++) {
        const a = R(0, 6.28), r = 108 * Math.pow(rn(), 0.6), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.9;
        const col = pick(['#ffd3df', '#ffc1d2', '#fff0f4', '#f7b3c8', '#ffe3ea']);
        for (let pt = 0; pt < 5; pt++) { const pa = pt / 5 * 6.28 + k; g.fillStyle = col; g.beginPath(); g.ellipse(x + Math.cos(pa) * 3.4, y + Math.sin(pa) * 3.4, 3.2, 2.3, pa, 0, 7); g.fill(); }
        g.fillStyle = '#e88aa5'; g.beginPath(); g.arc(x, y, 1.3, 0, 7); g.fill();
      }
    } else {
      g.strokeStyle = gray(55, 80); g.lineWidth = 2;
      for (let k = 0; k < 7; k++) { const a = R(0, 6.28); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R(50, 100), cy + Math.sin(a) * R(50, 100)); g.stroke(); }
      const n = kind === 'broad' ? 520 : 400;
      for (let k = 0; k < n; k++) {
        const a = R(0, 6.28), r = 114 * Math.pow(rn(), 0.62), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.92;
        g.save(); g.translate(x, y); g.rotate(R(0, 6.28)); g.fillStyle = gray(r > 90 ? 150 : 165, 250);
        if (kind === 'ginkgo') { g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R(7, 10), -0.55, 0.55 + Math.PI * 0.12); g.closePath(); g.fill(); }
        else if (kind === 'maple') { g.beginPath(); for (let pt = 0; pt < 10; pt++) { const rr2 = pt % 2 ? 3.2 : 8, pa = pt / 10 * 6.28; g.lineTo(Math.cos(pa) * rr2, Math.sin(pa) * rr2); } g.closePath(); g.fill(); }
        else { g.beginPath(); g.ellipse(0, 0, R(7, 10), R(3.4, 4.8), 0, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(-8, 0); g.lineTo(8, 0); g.stroke(); }
        g.restore();
      }
    }
    g.restore();
  }
  const id = g.getImageData(0, 0, 512, 512).data, ac = mkCanvas(512, 512), ag = ac.getContext('2d'), ad = ag.createImageData(512, 512);
  for (let i = 0; i < id.length; i += 4) { const a = id[i + 3]; ad.data[i] = ad.data[i + 1] = ad.data[i + 2] = a; ad.data[i + 3] = 255; }
  ag.putImageData(ad, 0, 0);
  const oc = mkCanvas(512, 512), og = oc.getContext('2d'); og.fillStyle = kind === 'blossom' ? '#f3cfd9' : kind === 'needle' ? '#9a9a9a' : '#b9b9b9'; og.fillRect(0, 0, 512, 512);
  og.filter = 'blur(6px)'; og.drawImage(c, 0, 0); og.filter = 'none'; og.drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(oc); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const at = new THREE.CanvasTexture(ac); at.anisotropy = 4;
  return { map: t, alpha: at };
}
function barkTex() {
  const c = mkCanvas(256, 512), g = c.getContext('2d'); g.fillStyle = '#6b5a4a'; g.fillRect(0, 0, 256, 512);
  // furrowed bark: long dark fissures between lighter plates, then fine grain
  for (let i = 0; i < 140; i++) {
    let x = rand() * 256, y = rand() * 512; const len = rr(40, 160), w = rr(2, 6);
    g.strokeStyle = `rgba(28,20,14,${rr(0.35, 0.7)})`; g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += rr(-6, 6); y += len / 6; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rand() < 0.5 ? '30,22,16' : '176,158,136'},${rr(0.06, 0.22)})`; g.fillRect(rand() * 256, rand() * 512, rr(1, 4), rr(4, 22)); }
  for (const dx of [-256, 256]) g.drawImage(c, dx, 0);
  const t = canvasTex(c); t.anisotropy = MAXANI; return t;
}
function treeGeometry(sp, seed, low) {
  const S = SPECIES[sp], rn = mulberry(seed * 7919 + sp.length * 131 + (low ? 17 : 0));
  const R = (a, b) => a + (b - a) * rn();
  const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const W = { p: [], n: [], u: [], c: [] }, Lf = { p: [], n: [], u: [], c: [] };
  const push = (B, P, N, U, C) => { B.p.push(...P); B.n.push(...N); B.u.push(...U); for (let k = 0; k < P.length; k++) B.c.push(C); };
  const tube = (a, b, r0, r1, seg) => {
    const d = nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = nrm(cross(d, ref)), v = cross(d, u);
    const ring = (o, r, t) => { const c = Math.cos(t), s = Math.sin(t); const nn = [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s]; return [[o[0] + nn[0] * r, o[1] + nn[1] * r, o[2] + nn[2] * r], nn]; };
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg * Math.PI * 2, t1 = (i + 1) / seg * Math.PI * 2;
      const [a0, n0] = ring(a, r0, t0), [a1, n1] = ring(a, r0, t1), [b1, m1] = ring(b, r1, t1), [b0, m0] = ring(b, r1, t0);
      const u0 = i / seg, u1 = (i + 1) / seg, vv = len / 2;
      push(W, [...a0, ...a1, ...b1], [...n0, ...n1, ...m1], [u0, 0, u1, 0, u1, vv], 1);
      push(W, [...a0, ...b1, ...b0], [...n0, ...m1, ...m0], [u0, 0, u1, vv, u0, vv], 1);
    }
  };
  const quad = (P, N, U, C) => { push(Lf, [...P[0], ...P[1], ...P[2]], [...N, ...N, ...N], [U[0], U[1], U[2], U[3], U[4], U[5]], C); push(Lf, [...P[0], ...P[2], ...P[3]], [...N, ...N, ...N], [U[0], U[1], U[4], U[5], U[6], U[7]], C); };
  const base = S.base, C = S.shrub ? [0, S.ry * 0.95, 0] : [0, base + S.ry, 0];
  if (!S.shrub) {
    if (S.cone) {
      const topY = base + 2 * S.ry * 1.02;
      tube([0, 0, 0], [R(-0.1, 0.1), topY, R(-0.1, 0.1)], S.tr, S.tr * 0.12, low ? 4 : 7);
      if (!low) for (let k = 0; k < 10; k++) { const t = 0.06 + k / 10 * 0.86, y = base + 2 * S.ry * t, len = S.rx * Math.pow(1 - t, 0.85) * R(0.75, 1.05); for (let j = 0; j < 4; j++) { const a = R(0, 6.28); tube([0, y, 0], [Math.cos(a) * len, y - len * 0.18, Math.sin(a) * len], Math.max(0.03, S.tr * 0.25 * (1 - t)), 0.015, 3); } }
    } else {
      const top = [R(-0.3, 0.3), base + S.ry * (S.weep ? 0.55 : 0.7), R(-0.3, 0.3)];
      tube([0, 0, 0], top, S.tr, S.tr * 0.55, low ? 4 : 7);
      if (!low) for (let i = 0; i < S.br; i++) {
        const a = i / S.br * Math.PI * 2 + R(-0.35, 0.35);
        const st = [top[0] * 0.8, base + R(0.1, S.ry * 0.55), top[2] * 0.8];
        const en = [Math.cos(a) * S.rx * R(0.5, 0.82), C[1] + S.ry * R(-0.05, 0.6) + (S.weep ? S.ry * 0.25 : 0), Math.sin(a) * S.rx * R(0.5, 0.82)];
        tube(st, en, S.tr * 0.5, S.tr * 0.1, 4);
        for (let j = 0; j < 3; j++) { const t = R(0.35, 0.75), m = [st[0] + (en[0] - st[0]) * t, st[1] + (en[1] - st[1]) * t, st[2] + (en[2] - st[2]) * t]; const e2 = [en[0] + R(-1, 1) * S.rx * 0.45, en[1] + R(-0.4, 0.9), en[2] + R(-1, 1) * S.rx * 0.45]; tube(m, e2, S.tr * 0.16, 0.015, 3); }
      }
    }
  }
  const nCards = low ? 0 : S.cards, csz = S.cs;
  for (let i = 0; i < nCards; i++) {
    let p, out, f;
    if (S.cone) {
      const t = Math.pow(R(0.02, 0.98), 0.85), y = base + 2 * S.ry * t, maxr = S.rx * Math.pow(1 - t, 0.9);
      f = Math.sqrt(R(0.3, 1)); const a = R(0, 6.28); p = [Math.cos(a) * maxr * f, y, Math.sin(a) * maxr * f]; out = nrm([Math.cos(a), 0.5, Math.sin(a)]);
    } else {
      let dx, dy, dz, l2;
      do { dx = R(-1, 1); dy = R(-1, 1); dz = R(-1, 1); l2 = dx * dx + dy * dy + dz * dz; } while (l2 > 1 || l2 < 0.02);
      const l = Math.sqrt(l2); dx /= l; dy /= l; dz /= l;
      if (dy < -0.65) dy = -0.65 + (dy + 0.65) * 0.3;
      f = Math.pow(R(0.4, 1), 0.5);
      p = [C[0] + dx * S.rx * f, C[1] + dy * S.ry * f, C[2] + dz * S.rx * f];
      if (S.shrub) p[1] = Math.max(0.35, p[1]);
      out = nrm([dx, dy * 1.15, dz]);
    }
    const sh = nrm([out[0] * 0.85, out[1] * 0.85 + 0.35, out[2] * 0.85]);
    const hf = clamp((p[1] - (S.shrub ? 0 : base)) / (2 * S.ry + 0.01), 0, 1);
    const ao = clamp(0.5 + 0.5 * f, 0, 1) * (0.74 + 0.26 * hf) * R(0.85, 1.12);
    const qd = Math.floor(R(0, 4)), u0 = (qd % 2) * 0.5, v0 = Math.floor(qd / 2) * 0.5;
    const U = [u0, v0, u0 + 0.5, v0, u0 + 0.5, v0 + 0.5, u0, v0 + 0.5];
    if (S.weep && !low && R(0, 1) < 0.72 && out[1] > -0.4) {
      const tg = nrm([-out[2], 0, out[0]]), w = csz * R(0.5, 0.8), h = csz * R(1.5, 2.4);
      const P = [[p[0] - tg[0] * w / 2, p[1] - h, p[2] - tg[2] * w / 2], [p[0] + tg[0] * w / 2, p[1] - h, p[2] + tg[2] * w / 2], [p[0] + tg[0] * w / 2, p[1] + 0.2, p[2] + tg[2] * w / 2], [p[0] - tg[0] * w / 2, p[1] + 0.2, p[2] - tg[2] * w / 2]];
      quad(P, sh, U, ao);
      continue;
    }
    const rnd = nrm([R(-1, 1), R(-1, 1), R(-1, 1)]);
    const n = nrm([out[0] * 0.55 + rnd[0] * 0.45, out[1] * 0.55 + rnd[1] * 0.45 + (S.cone ? 0.4 : 0), out[2] * 0.55 + rnd[2] * 0.45]);
    const ref = Math.abs(n[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    let rgt = nrm(cross(ref, n)), up = cross(n, rgt);
    const sp2 = R(0, 6.28), cs2 = Math.cos(sp2), sn2 = Math.sin(sp2);
    const r2 = [rgt[0] * cs2 + up[0] * sn2, rgt[1] * cs2 + up[1] * sn2, rgt[2] * cs2 + up[2] * sn2], u2 = [up[0] * cs2 - rgt[0] * sn2, up[1] * cs2 - rgt[1] * sn2, up[2] * cs2 - rgt[2] * sn2];
    const w = csz * R(0.75, 1.25) * (S.cone ? 1.1 : 1), h = csz * R(0.75, 1.25) * (S.cone ? 0.7 : 1);
    const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [p[0] + r2[0] * a * w / 2 + u2[0] * b * h / 2, p[1] + r2[1] * a * w / 2 + u2[1] * b * h / 2, p[2] + r2[2] * a * w / 2 + u2[2] * b * h / 2]);
    quad(P, sh, U, ao);
  }
  const mk = (B) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3)); g.computeBoundingSphere(); return g; };
  return { wood: W.p.length ? mk(W) : null, leaf: mk(Lf) };
}
function leafMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ map: tex.map, alphaMap: tex.alpha, vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.22, alphaToCoverage: QUALITY !== 'low' });
  m.userData.leaf = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\n#ifdef USE_INSTANCING\nattribute float aHide; varying float vHide;\n#endif')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vHide = aHide;
        float ph = instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
        float k = max(position.y - 1.5, 0.0) * 0.014;
        transformed.x += sin(uTime * 1.3 + ph + position.y * 0.35) * k; transformed.z += cos(uTime * 1.07 + ph * 1.3 + position.x * 0.2) * k;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n  diffuseColor.a = clamp((diffuseColor.a - 0.4) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0.0, 1.0);\n#ifdef USE_INSTANCING\nif (vHide > 0.001 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) < vHide) discard;\n#endif')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * uLeafAmb;')
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', 'reflectedLight.directDiffuse += saturate( ( dot( geometryNormal, directLight.direction ) + 0.65 ) / 1.65 ) * directLight.color * BRDF_Lambert( material.diffuseColor );').replace('reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );', 'reflectedLight.directSpecular += min(irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material ), vec3(2.0));'))
      .replace('#include <common>', '#include <common>\nuniform float uLeafAmb;\n#ifdef USE_INSTANCING\nvarying float vHide;\n#endif');
    sh.uniforms.uLeafAmb = LEAF_AMB;
  };
  m.customProgramCacheKey = () => 'leaf';
  return m;
}
const CROWN_ATLAS = {};
function crownAtlas(kind) {
  if (CROWN_ATLAS[kind]) return CROWN_ATLAS[kind];
  const cv=mkCanvas(256,256),g=cv.getContext('2d'),rn=mulberry(kind.length*613+27);
  for(let i=0;i<1800;i++){
    let x,y; do{x=rn()*2-1;y=rn()*2-1;}while(x*x+y*y>0.92);
    if(kind==='needle') x*=0.22+0.78*(y+1)/2;
    const px=128+x*108,py=128+y*112,r=4+rn()*10;
    const v=Math.round(150+(1-y)*32+rn()*24);g.fillStyle=`rgb(${v},${v},${v})`;
    g.beginPath();g.ellipse(px,py,kind==='willow'?r*.55:r,kind==='willow'?r*1.8:r*.75,rn()*Math.PI,0,Math.PI*2);g.fill();
  }
  const alpha=mkCanvas(256,256),ag=alpha.getContext('2d');ag.drawImage(cv,0,0);
  const pixels=ag.getImageData(0,0,256,256);for(let i=0;i<pixels.data.length;i+=4){const a=pixels.data[i+3];pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=a;pixels.data[i+3]=255;}ag.putImageData(pixels,0,0);
  return CROWN_ATLAS[kind]={map:canvasTex(cv,true,false),alpha:canvasTex(alpha,false,false)};
}
function crownGeometry(sp) {
  const S=SPECIES[sp],positions=[],normals=[],uv=[],colors=[];
  const bottom=S.shrub?0:S.base,top=bottom+S.ry*2,width=S.rx*2.25;
  for(const a of [0,Math.PI/2]){
    const x=Math.cos(a)*width/2,z=Math.sin(a)*width/2;
    const verts=[[-x,bottom,-z],[x,bottom,z],[x,top,z],[-x,bottom,-z],[x,top,z],[-x,top,-z]];
    verts.forEach(v=>{positions.push(...v);normals.push(0,0.8,0.6);colors.push(1,1,1);});uv.push(0,0,1,0,1,1,0,0,1,1,0,1);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeBoundingSphere();return geo;
}
let TREE_GROUPS = [], TREE_MESHES = [], LEAF_TEX = {}, WOOD_MAT = null;
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color(), _e = new THREE.Euler();
// Keep every crown out of the buildings: a tree standing inside a footprint goes, one whose crown would cut
// into a wall shrinks until it clears, and one that would have to shrink too far goes as well.
function clearTreesFromBuildings() {
  const polys = [];
  for (const b of BLD) {
    const ps = b.extra?.special === 'xueyuan' ? XY_PODS.map((q) => q.p).concat(XY_LINKS) : b.parts || [b.p];
    for (const q of ps) polys.push({ q, bb: pBox(q), h: b.h });
  }
  const keep = [];
  for (const t of TREES) {
    const S = SPECIES[t.type], base = S.base * t.s;
    let rc = S.rx * t.s * 0.8, ok = true;
    for (const P of polys) {
      if (P.h <= base || t.x < P.bb[0] - rc || t.x > P.bb[2] + rc || t.z < P.bb[1] - rc || t.z > P.bb[3] + rc) continue;
      if (pip(t.x, t.z, P.q)) { ok = false; break; }
      const d = nearestOnPoly(t.x, t.z, P.q)[0];
      if (d < rc) { if (d < S.rx * t.s * 0.8 * 0.55) { ok = false; break; } rc = d; }
    }
    if (!ok) continue;
    const k = rc / (S.rx * t.s * 0.8);
    if (k < 1) t.s *= k;
    keep.push(t);
  }
  TREES.length = 0; TREES.push(...keep);
}
function buildTrees() {
  for (const m of TREE_MESHES) scene.remove(m);
  TREE_MESHES = []; TREE_GROUPS = [];
  for (const k of ['broad', 'willow', 'ginkgo', 'needle', 'maple', 'blossom']) LEAF_TEX[k] = leafAtlas(k);
  WOOD_MAT = new THREE.MeshStandardMaterial({ map: barkTex(), color: '#ffffff', roughness: 0.95, vertexColors: true });
  WOOD_MAT.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n#ifdef USE_INSTANCING\nattribute float aHide; varying float vHide;\n#endif').replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\nvHide = aHide;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n#ifdef USE_INSTANCING\nvarying float vHide;\n#endif').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n#ifdef USE_INSTANCING\nif (vHide > 0.001 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) < vHide) discard;\n#endif');
  };
  WOOD_MAT.customProgramCacheKey = () => 'treewood';
  const bySp = {};
  TREES.forEach((t, i) => { (bySp[t.type + ':' + t.v] ||= []).push(i); });
  for (const [key, items] of Object.entries(bySp)) {
    const [sp, vs] = key.split(':'), v = +vs, S = SPECIES[sp];
    const near = treeGeometry(sp, v + 1, false), far = treeGeometry(sp, v + 1, true);
    const lm = leafMaterial(LEAF_TEX[S.leaf]);
    const fm = leafMaterial(crownAtlas(S.leaf));
    const mkI = (geo, mat, shadow) => { if (!geo) return null; if (geo.getAttribute('aHide')) geo = geo.clone(); geo.setAttribute('aHide', new THREE.InstancedBufferAttribute(new Float32Array(items.length), 1)); const im = new THREE.InstancedMesh(geo, mat, items.length); im.count = 0; im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = true; im.setColorAt(0, _c.set('#fff')); im.instanceColor.array.fill(1); scene.add(im); TREE_MESHES.push(im); return im; };
    const g = { sp, items, lm, fm, nearLeaf: mkI(near.leaf, lm, QUALITY !== 'low'), farLeaf: mkI(crownGeometry(sp), fm, false), nearWood: mkI(near.wood, WOOD_MAT, QUALITY !== 'low'), farWood: mkI(far.wood, WOOD_MAT, false), mats: new Float32Array(items.length * 16), cols: new Float32Array(items.length * 3), fade: new Float32Array(items.length), slot: new Int32Array(items.length) };
    items.forEach((ti, j) => { const t = TREES[ti]; _e.set(0, t.rot, 0); _q.setFromEuler(_e); _m4.compose(_v.set(t.x, 0, t.z), _q, _s.set(t.s, t.s * rr(0.92, 1.08), t.s)); _m4.toArray(g.mats, j * 16); });
    for (const m of [g.nearLeaf, g.farLeaf]) if (m) NO_AO.push(m);
    TREE_GROUPS.push(g);
  }
  applySeasonToTrees();
}
let lodKey = '', lodAt = 0;
const treeFrustum = new THREE.Frustum(), treeProjection = new THREE.Matrix4(), treeSphere = new THREE.Sphere(new THREE.Vector3(), 26), cullCam = new THREE.PerspectiveCamera();
function updateTreeLOD(force) {
  if (!TREE_GROUPS.length) return;
  const cx = camera.position.x, cz = camera.position.z, cy = camera.position.y;
  const R = 230 + Math.min(Math.max(cy, 0), 600) * 0.45;
  const key = `${Math.round(cx / 10)},${Math.round(cz / 10)},${Math.round(R / 25)},${camera.quaternion.toArray().map(v=>Math.round(v*30)).join(',')},${camera.aspect.toFixed(2)}`;
  if (!force) { if (key === lodKey) return; const now = performance.now(); if (now - lodAt < 110) return; lodAt = now; }
  lodKey = key;
  const R2 = R * R;
  camera.updateMatrixWorld(); cullCam.copy(camera); cullCam.fov = Math.min(150, camera.fov + 40); cullCam.updateProjectionMatrix(); cullCam.updateMatrixWorld();
  treeProjection.multiplyMatrices(cullCam.projectionMatrix, cullCam.matrixWorldInverse); treeFrustum.setFromProjectionMatrix(treeProjection);
  const farLimit = Math.pow(QUALITY === 'low' ? 3400 : 5600, 2);
  for (const g of TREE_GROUPS) {
    let nn = 0, nf = 0;
    const NL = g.nearLeaf, FL = g.farLeaf, NW = g.nearWood, FW = g.farWood;
    for (let j = 0; j < g.items.length; j++) {
      const t = TREES[g.items[j]], dx = t.x - cx, dz = t.z - cz;
      if (camera.userData.reviewClearRadius && dx * dx + dz * dz < camera.userData.reviewClearRadius ** 2) continue;
      treeSphere.center.set(t.x, 9, t.z);
      if (dx * dx + dz * dz > farLimit || !treeFrustum.intersectsSphere(treeSphere)) continue;
      const mo = j * 16, co = j * 3;
      if (dx * dx + dz * dz < R2) {
        NL.instanceMatrix.array.set(g.mats.subarray(mo, mo + 16), nn * 16); NL.instanceColor.array.set(g.cols.subarray(co, co + 3), nn * 3);
        if (NW) NW.instanceMatrix.array.set(g.mats.subarray(mo, mo + 16), nn * 16);
        g.slot[nn] = j; NL.geometry.attributes.aHide.array[nn] = g.fade[j]; if (NW) NW.geometry.attributes.aHide.array[nn] = g.fade[j];
        nn++;
      } else {
        FL.instanceMatrix.array.set(g.mats.subarray(mo, mo + 16), nf * 16); FL.instanceColor.array.set(g.cols.subarray(co, co + 3), nf * 3);
        if (FW) FW.instanceMatrix.array.set(g.mats.subarray(mo, mo + 16), nf * 16);
        nf++;
      }
    }
    NL.count = nn; FL.count = nf; if (NW) NW.count = nn; if (FW) FW.count = nf;
    for (const m of [NL, FL, NW, FW]) if (m) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    NL.geometry.attributes.aHide.needsUpdate = true; if (NW) NW.geometry.attributes.aHide.needsUpdate = true;
  }
}
function updateTreeFade(dt) {
  if (!TREE_GROUPS.length) return;
  const veh = mode === 'walk' && ((DRIVE.on && DRIVE.cam === 'chase') || (RIDE.on && RIDE.cam === 'chase'));
  const C = camera.position, T = veh ? VEH_FOCUS : controls.target, dx = T.x - C.x, dy = T.y - C.y, dz = T.z - C.z, L = Math.hypot(dx, dy, dz) || 1, ux = dx / L, uy = dy / L, uz = dz / L, step = Math.min(1, dt * 3.5);
  const walking = mode === 'walk', low = veh || (!walking && (C.y < 70 || -uy < 0.4)), reach = veh ? L + 0.5 : L - 6;
  for (const g of TREE_GROUPS) {
    const S = SPECIES[g.sp], NL = g.nearLeaf, NW = g.nearWood, ah = NL.geometry.attributes.aHide, aw = NW && NW.geometry.attributes.aHide;
    let ch = false;
    for (let k = 0; k < NL.count; k++) {
      const j = g.slot[k], t = TREES[g.items[j]], rc = Math.max(S.rx, S.ry * 0.75) * t.s + 1.2;
      const vx = t.x - C.x, vy = (S.base + S.ry * 0.85) * t.s - C.y, vz = t.z - C.z, along = vx * ux + vy * uy + vz * uz;
      let want = 0;
      if (low && along > -rc && along < reach - (veh ? 0 : rc) && Math.hypot(vx - ux * along, vy - uy * along, vz - uz * along) < rc + Math.max(0, along) * 0.03) want = 1;
      else if (walking ? vx * vx + vy * vy + vz * vz < rc * rc * 0.45 : C.y < 35 && along > -rc && vx * vx + vy * vy + vz * vz < (rc + 5) * (rc + 5)) want = 1;
      const f = g.fade[j], nf = f + clamp(want - f, -step, step);
      if (nf !== f) { g.fade[j] = nf; ah.array[k] = nf; if (aw) aw.array[k] = nf; ch = true; }
    }
    if (ch) { ah.needsUpdate = true; if (aw) aw.needsUpdate = true; }
  }
}
function applySeasonToTrees() {
  for (const g of TREE_GROUPS) {
    const cs = SCOL[g.sp][season];
    const bare = cs === null, blossom = cs === 'blossom';
    g.nearLeaf.visible = g.farLeaf.visible = !bare;
    if(g.farWood) g.farWood.visible=bare;
    const tex = blossom ? LEAF_TEX.blossom : LEAF_TEX[SPECIES[g.sp].leaf];
    if (g.lm.map !== tex.map) { g.lm.map = tex.map; g.lm.alphaMap = tex.alpha; g.lm.needsUpdate = true; }
    g.items.forEach((ti, j) => {
      const t = TREES[ti];
      if (bare) _c.set('#ffffff');
      else if (blossom) _c.set('#ffffff').lerp(_c2.set('#f4dde4'), t.r);
      else { _c.set(cs[0]).lerp(_c2.set(cs[1]), t.r > 0.75 ? 1 : t.r * 0.6); _c.offsetHSL((t.r - 0.5) * 0.02, 0, (t.r - 0.5) * 0.08); }
      g.cols[j * 3] = _c.r; g.cols[j * 3 + 1] = _c.g; g.cols[j * 3 + 2] = _c.b;
    });
  }
  lodKey = '';
}

let HEDGES = null;
// Grass tufts: a few thousand instanced blade clusters on a fixed world grid around a low camera, only where the ground
// map is grass, swaying in the wind, faded out towards the edge of the patch so they never pop.
let GRASS = null;
function grassHash(i, j, k) { let h = (i * 374761393 + j * 668265263 + k * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function buildGrass() {
  const rn = mulberry(911), pos = [], col = [], nor = [];
  for (let k = 0; k < 11; k++) {
    const a = rn() * 6.283, lean = 0.15 + rn() * 0.35, h = 0.06 + rn() * 0.11, w = 0.011 + rn() * 0.008;
    const ox = (rn() - 0.5) * 0.3, oz = (rn() - 0.5) * 0.3, dx = Math.cos(a), dz = Math.sin(a), px = -dz * w, pz = dx * w, tint = 0.85 + rn() * 0.3;
    const P = (t, half) => [ox + dx * lean * h * t * t + px * half, h * t, oz + dz * lean * h * t * t + pz * half];
    const tri = (A, Bv, C, ta, tb, tc) => { for (const [v, t] of [[A, ta], [Bv, tb], [C, tc]]) { pos.push(...v); nor.push(0, 1, 0); const c = (0.55 + 0.5 * t) * tint; col.push(c, c * 1.03, c * 0.92); } };
    const b0 = P(0, 1), b1 = P(0, -1), m0 = P(0.55, 0.65), m1 = P(0.55, -0.65), tip = P(1, 0);
    tri(b0, b1, m1, 0, 0, 0.55); tri(b0, m1, m0, 0, 0.55, 0.55); tri(m0, m1, tip, 0.55, 0.55, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime; sh.uniforms.uGrass = SEASON_U.uGrass;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 gw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sw = sin(uTime * 1.6 + gw.x * 0.31 + gw.z * 0.23) * 0.6 + sin(uTime * 3.1 + gw.x * 1.3 - gw.z * 0.7) * 0.25;
        float hh = transformed.y * transformed.y;
        transformed.x += sw * hh * 3.0; transformed.z += sw * hh * 1.5;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uGrass;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= uGrass * 1.75;');
  };
  mat.customProgramCacheKey = () => 'grassTuft';
  const lowQ = QUALITY === 'low', R = lowQ ? 12 : 18, S = lowQ ? 0.5 : 0.36, cap = Math.ceil(Math.PI * R * R / (S * S) * 1.05);
  const mesh = new THREE.InstancedMesh(g, mat, cap); mesh.count = 0; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.layers.set(1);
  scene.add(mesh);
  GRASS = { mesh, R, S, cx: 1e9, cz: 1e9, mask: null };
}
function grassMaskBuild() {
  const W = Math.round(REGW), H = Math.round(REGH), c = mkCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(GROUND.canvas, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
  for (let i = 0, o = 0; i < W * H; i++, o += 4) { const r = d[o], gg = d[o + 1], b = d[o + 2]; m[i] = gg > r * 1.06 && gg > b * 1.12 ? 1 : 0; }
  return { m, W, H };
}
function updateGrass() {
  if (!GRASS) return;
  const cp = camera.position, on = cp.y - groundAt(cp.x, cp.z) < 30 && season !== 'winter';
  GRASS.mesh.visible = on; if (!on) return;
  if (Math.abs(cp.x - GRASS.cx) < 1.2 && Math.abs(cp.z - GRASS.cz) < 1.2) return;
  GRASS.cx = cp.x; GRASS.cz = cp.z;
  const M = GRASS.mask ||= grassMaskBuild(), { R, S, mesh } = GRASS;
  let n = 0;
  const i0 = Math.floor((cp.x - R) / S), i1 = Math.ceil((cp.x + R) / S), j0 = Math.floor((cp.z - R) / S), j1 = Math.ceil((cp.z + R) / S);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const x = (i + grassHash(i, j, 1)) * S, z = (j + grassHash(i, j, 2)) * S, d = Math.hypot(x - cp.x, z - cp.z);
    if (d > R) continue;
    const mx = Math.floor(x - REG.x0), mz = Math.floor(z - REG.z0);
    if (mx < 0 || mz < 0 || mx >= M.W || mz >= M.H || !M.m[mz * M.W + mx]) continue;
    const fade = 1 - smooth(R * 0.62, R, d), sc = (0.75 + grassHash(i, j, 3) * 0.6) * fade;
    if (sc < 0.05) continue;
    _e.set(0, grassHash(i, j, 4) * 6.283, 0); _q.setFromEuler(_e);
    _m4.compose(_v.set(x, 0, z), _q, _s.set(sc, sc * (0.8 + grassHash(i, j, 5) * 0.5), sc)); mesh.setMatrixAt(n++, _m4);
    if (n >= mesh.instanceMatrix.count) break;
  }
  mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
}
function buildHedges() {
  const segs = [];
  const add = (line, color) => {
    const cum = cumLen(line), L = cum[cum.length - 1];
    for (let s2 = 1.5; s2 < L - 1.5; s2 += 3.2) { const q = sampleAt(line, cum, s2); if (blocked(q.x, q.z) || inWater(q.x, q.z)) continue; segs.push([q.x, q.z, Math.atan2(q.dz, q.dx), color]); }
  };
  for (const r of D.r) {
    const inside = inCampus(r.p[0][0], r.p[0][1]) && inCampus(r.p[r.p.length - 1][0], r.p[r.p.length - 1][1]);
    if (!inside || r.t === 'service') continue;
    const w = roadW(r), col = /以仁|精业|博爱/.test(r.n || '') ? 'red' : /博学|博思|博雅/.test(r.n || '') ? 'gold' : 'green';
    for (const side of [-1, 1]) add(offsetLine(r.p, side * (w / 2 + 1.7)), col);
  }
  const hc = mkCanvas(256, 256), hg = hc.getContext('2d'); hg.fillStyle = '#8a8a8a'; hg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) { const v = Math.floor(rr(110, 250)); hg.fillStyle = `rgb(${v},${v},${v})`; hg.beginPath(); hg.ellipse(rand() * 256, rand() * 256, rr(2.5, 5), rr(1.4, 2.6), rand() * 3, 0, 7); hg.fill(); }
  const ht = canvasTex(hc);
  const geo = new THREE.BoxGeometry(3.3, 0.88, 1.04, 16, 5, 6); geo.translate(0, 0.44, 0);
  {
    const pa = geo.attributes.position, cols = [];
    for (let i = 0; i < pa.count; i++) {
      let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const top = smooth(0.5, 0.88, y);
      z *= 1 - top * 0.22; x *= 1 - top * 0.02;
      const lump = Math.sin(x * 5.3 + z * 3.1) * Math.sin(y * 6.7 + x * 2.3) * 0.045 + Math.sin(x * 13.1 + y * 9.7 + z * 7.3) * 0.022;
      const dx = x, dy = y - 0.35, dz = z * 1.6, l = Math.hypot(dx * 0.35, dy, dz) || 1;
      if (y > 0.02) { x += dx * 0.35 / l * lump; y += dy / l * lump; z += dz / l * lump; }
      pa.setXYZ(i, x, Math.max(0, y), z);
      const v = 0.62 + 0.48 * smooth(0, 0.9, y) + Math.sin(x * 7.7 + z * 5.1) * 0.06; cols.push(v, v, v);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
  }
  const lt = LEAF_TEX.broad ? LEAF_TEX.broad.map.clone() : ht; lt.wrapS = lt.wrapT = THREE.RepeatWrapping; lt.repeat.set(4.6, 1.4); lt.needsUpdate = true;
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: lt, bumpMap: ht, bumpScale: 2.5, vertexColors: true, roughness: 0.9 }), segs.length);
  const COL = { green: ['#4c7a33', '#56853a', '#45702f'], red: ['#4c7a33', '#56853a', '#7d3328'], gold: ['#56853a', '#6d8a38', '#8f8a3a'] };
  segs.forEach(([x, z, a, col], i) => {
    const sy = rr(0.9, 1.1);
    _e.set(0, -a, 0); _q.setFromEuler(_e); _m4.compose(_v.set(x, 0, z), _q, _s.set(1, sy, 1)); im.setMatrixAt(i, _m4); im.setColorAt(i, _c.set(pick(COL[col])));
    PROPS.push({ p: rectPoly(x, z, 3.25, 1.0, a), top: 0.85 * sy, c: [x, z] });
  });
  im.castShadow = true; im.receiveShadow = true; im.layers.set(1); scene.add(im); HEDGES = im;
  chunkify(im, 700, 260);
}
let LAMP_GLOW = null;
const LAMP_POS = [];
// Kerb stones along both edges of campus roads and dashed centre lines on the wider ones. Junctions are left open:
// a sample that falls on another road's carriageway gets no kerb and no paint.
function buildCurbs() {
  OWNER = -1;
  const roads = D.r.filter((r) => r.p.length > 1 && r.p.some((q) => inCampus(q[0], q[1])));
  const G = new Grid(30), segs = [];
  D.r.forEach((r, ri) => {
    const w = roadW(r) / 2;
    for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1], k = segs.length; segs.push([a, b, w, r]);
      G.add(k, [Math.min(a[0], b[0]) - w - 2, Math.min(a[1], b[1]) - w - 2, Math.max(a[0], b[0]) + w + 2, Math.max(a[1], b[1]) + w + 2]);
    }
  });
  const segD = (x, z, a, b) => { const ex = b[0] - a[0], ez = b[1] - a[1], t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1), 0, 1); return Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t); };
  const onOther = (x, z, r, pad) => G.at(x, z).some((k) => { const [a, b, w, rr2] = segs[k]; return rr2 !== r && segD(x, z, a, b) < w + pad; });
  const okAt = (x, z) => x > REG.x0 && x < REG.x1 && z > REG.z0 && z < REG.z1 && !inWater(x, z) && groundAt(x, z) < 0.05;
  for (const r of roads) {
    const w = roadW(r);
    for (const side of [-1, 1]) {
      const line = offsetLine(r.p, side * (w / 2 + 0.08)), cum = cumLen(line), L = cum[cum.length - 1];
      let run = null;
      const flush = (end) => {
        if (!run) return;
        for (let s0 = run; s0 < end - 0.2; s0 += 6) {
          const s1 = Math.min(end, s0 + 6), q0 = sampleAt(line, cum, s0), q1 = sampleAt(line, cum, s1);
          addBox('curb', (q0.x + q1.x) / 2, 0, (q0.z + q1.z) / 2, Math.hypot(q1.x - q0.x, q1.z - q0.z) + 0.04, 0.16, 0.13, Math.atan2(q1.z - q0.z, q1.x - q0.x), 'curb');
        }
        run = null;
      };
      for (let t = 0; t <= L; t += 1) {
        const q = sampleAt(line, cum, t), ok = okAt(q.x, q.z) && !onOther(q.x, q.z, r, 0.3);
        if (ok && run == null) run = t; else if (!ok) flush(t);
      }
      flush(L);
    }
    if (w < 6.5 || r.ow) continue;
    const cum = cumLen(r.p), L = cum[cum.length - 1];
    for (let t = 3; t < L - 3; t += 6) {
      const q0 = sampleAt(r.p, cum, t), q1 = sampleAt(r.p, cum, Math.min(L, t + 2.2));
      if (!okAt(q0.x, q0.z) || onOther(q0.x, q0.z, r, 2) || onOther(q1.x, q1.z, r, 2)) continue;
      addCap('paint', rectPoly((q0.x + q1.x) / 2, (q0.z + q1.z) / 2, Math.hypot(q1.x - q0.x, q1.z - q0.z), 0.13, Math.atan2(q1.z - q0.z, q1.x - q0.x)), 0.025);
    }
  }
}
function buildLamps() {
  const poles = [], heads = [];
  for (const r of D.r) {
    const inside = inCampus(r.p[0][0], r.p[0][1]) || inCampus(r.p[r.p.length - 1][0], r.p[r.p.length - 1][1]);
    if (!inside && !['primary', 'secondary', 'tertiary'].includes(r.t)) continue;
    const w = roadW(r), line = offsetLine(r.p, w / 2 + 0.9), cum = cumLen(line), sp = inside ? 28 : 36;
    for (let s = 10; s < cum[cum.length - 1]; s += sp) { const q = sampleAt(line, cum, s); if (q.x < REG.x0 || q.x > REG.x1 || q.z < REG.z0 || q.z > REG.z1 || inWater(q.x, q.z)) continue; poles.push([q.x, q.z, Math.atan2(-q.dx, q.dz), inside ? 6.5 : 10]); }
  }
  for (const r of D.pa) {
    if (!inCampus(r.p[0][0], r.p[0][1])) continue;
    const line = offsetLine(r.p, 2), cum = cumLen(line);
    for (let s = 8; s < cum[cum.length - 1]; s += 24) { const q = sampleAt(line, cum, s); if (!inWater(q.x, q.z) && !blocked(q.x, q.z)) poles.push([q.x, q.z, 0, 3.4]); }
  }
  for (const [x, z] of poles) LAMP_POS.push([x, z]);
  const lampParts = (h) => {
    const pole = [], head = [], at = (g, x, y, z) => { g.translate(x, y, z); return g; };
    if (h > 5) {
      pole.push([at(new THREE.BoxGeometry(0.34, 0.5, 0.34), 0, 0.25, 0), 1]);
      pole.push([at(new THREE.CylinderGeometry(0.055, 0.1, h, 8, 1, true), 0, h / 2, 0), 1]);
      pole.push([at(new THREE.SphereGeometry(0.07, 6, 3), 0, h, 0), 1]);
      const arm = new THREE.CylinderGeometry(0.035, 0.045, 1.25, 6, 1, true); arm.rotateX(Math.PI / 2 - 0.12); arm.translate(0, h + 0.02, 0.6); pole.push([arm, 1]);
      pole.push([at(new THREE.BoxGeometry(0.34, 0.14, 0.8), 0, h + 0.1, 1.32), 1]);
      head.push([at(new THREE.BoxGeometry(0.27, 0.04, 0.66), 0, h + 0.015, 1.32), 1]);
    } else {
      pole.push([at(new THREE.CylinderGeometry(0.14, 0.17, 0.35, 8), 0, 0.175, 0), 1]);
      pole.push([at(new THREE.CylinderGeometry(0.045, 0.06, h, 6, 1, true), 0, h / 2, 0), 1]);
      pole.push([at(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 8), 0, h + 0.02, 0), 1]);
      head.push([at(new THREE.CylinderGeometry(0.15, 0.12, 0.42, 8), 0, h + 0.25, 0), 1]);
      pole.push([at(new THREE.CylinderGeometry(0.03, 0.2, 0.14, 8, 1, true), 0, h + 0.53, 0), 1]);
    }
    return { pole: mergeColored(pole), head: mergeColored(head) };
  };
  const byH = new Map(); poles.forEach((q) => { if (!byH.has(q[3])) byH.set(q[3], []); byH.get(q[3]).push(q); });
  for (const [h, list] of byH) {
    const g = lampParts(h), pm = new THREE.InstancedMesh(g.pole, MAT.metal, list.length), hm = new THREE.InstancedMesh(g.head, MAT.lamp, list.length);
    list.forEach(([x, z, a], i) => { _e.set(0, a, 0); _q.setFromEuler(_e); _m4.compose(_v.set(x, 0, z), _q, _s.set(1, 1, 1)); pm.setMatrixAt(i, _m4); hm.setMatrixAt(i, _m4); });
    pm.castShadow = h > 5; pm.layers.set(1); hm.layers.set(1); scene.add(pm, hm);
    chunkify(pm, h > 5 ? 900 : 380, 300); chunkify(hm, h > 5 ? 900 : 380, 300);
  }
  const gc = mkCanvas(64, 64), gx = gc.getContext('2d'), gr = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,230,180,1)'); gr.addColorStop(0.25, 'rgba(255,200,130,.5)'); gr.addColorStop(1, 'rgba(255,190,120,0)'); gx.fillStyle = gr; gx.fillRect(0, 0, 64, 64);
  const gp = new Float32Array(poles.length * 3); poles.forEach(([x, z, a, h], i) => { const o = h > 5 ? 1.32 : 0; gp[i * 3] = x + Math.sin(a) * o; gp[i * 3 + 1] = h > 5 ? h - 0.1 : h + 0.25; gp[i * 3 + 2] = z + Math.cos(a) * o; });
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  LAMP_GLOW = new THREE.Points(gg, new THREE.PointsMaterial({ map: canvasTex(gc, true, false), size: 9, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: true }));
  // a glow is a halo seen from afar; walking right under a lamp it fades out instead of filling the screen
  LAMP_GLOW.material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <fog_vertex>', 'vFade = smoothstep(5.0, 28.0, -mvPosition.z);\ngl_PointSize = min(gl_PointSize, 260.0);\n#include <fog_vertex>');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <opaque_fragment>', 'diffuseColor.a *= vFade;\n#include <opaque_fragment>');
  };
  LAMP_GLOW.layers.set(1); scene.add(LAMP_GLOW);
  const benches = [];
  for (const r of D.pa) for (let i = 0; i < r.p.length - 1; i += 2) {
    const a = r.p[i], b = r.p[i + 1], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (!inCampus(mx, mz) || rand() > 0.45) continue;
    let near = false; for (const w of WATERS) if (mx > w.bb[0] - 25 && mx < w.bb[2] + 25 && mz > w.bb[1] - 25 && mz < w.bb[3] + 25) near = true;
    if (!near) continue;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), ox = -Math.sin(ang) * 2.2, oz = Math.cos(ang) * 2.2;
    if (!blocked(mx + ox, mz + oz) && !inWater(mx + ox, mz + oz)) benches.push([mx + ox, mz + oz, -ang]);
  }
  const bp = [], wood = [0.5, 0.33, 0.2], iron = [0.09, 0.09, 0.1];
  const B = (sx, sy, sz, x, y, z, c, rx = 0) => { const g = new THREE.BoxGeometry(sx, sy, sz); if (rx) g.rotateX(rx); g.translate(x, y, z); bp.push([g, c]); };
  for (const z of [-0.19, -0.07, 0.05, 0.17]) B(1.8, 0.035, 0.1, 0, 0.44, z, wood);
  for (const y of [0.6, 0.74]) B(1.8, 0.1, 0.03, 0, y, 0.27 + (y - 0.6) * 0.18, wood, 0.18);
  for (const x of [-0.75, 0.75]) {
    B(0.05, 0.42, 0.06, x, 0.21, -0.17, iron); B(0.05, 0.8, 0.06, x, 0.4, 0.25, iron, 0.18);
    B(0.05, 0.05, 0.5, x, 0.41, 0.02, iron); B(0.05, 0.04, 0.44, x, 0.63, 0.0, iron);
  }
  const bm = new THREE.InstancedMesh(mergeColored(bp), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.15 }), benches.length);
  for (const [x, z, a] of benches) PROPS.push({ p: rectPoly(x, z, 1.8, 0.6, -a), top: 0.8, c: [x, z] });
  benches.forEach(([x, z, a], i) => { _e.set(0, a, 0); _q.setFromEuler(_e); _m4.compose(_v.set(x, 0, z), _q, _s.set(1, 1, 1)); bm.setMatrixAt(i, _m4); });
  bm.castShadow = true; bm.layers.set(1); scene.add(bm);
  chunkify(bm, 320, 300);
}

let BUSH_GRID = null, BIKE_SPOTS = [], BIKE_CHUNKS = [];
function bushAt(x, z) {
  if (!BUSH_GRID) { BUSH_GRID = new Grid(8); TREES.forEach((t, i) => { const r = SPECIES[t.type].rx * t.s * (t.type === 'shrub' ? 0.8 : 0.12) + 0.9; BUSH_GRID.add(i, [t.x - r, t.z - r, t.x + r, t.z + r]); }); }
  return BUSH_GRID.at(x, z).some((i) => { const t = TREES[i], r = SPECIES[t.type].rx * t.s * (t.type === 'shrub' ? 0.8 : 0.12) + 0.9; return Math.hypot(t.x - x, t.z - z) < r; });
}
function buildBikes() {
  const parts = [];
  const rod = (a, b, r, color) => {
    const aa = new THREE.Vector3(...a), bb = new THREE.Vector3(...b), d = bb.clone().sub(aa);
    const g = new THREE.CylinderGeometry(r, r, d.length(), r < 0.012 ? 3 : 5, 1, true); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(...aa.add(bb).multiplyScalar(0.5).toArray()); parts.push([g, color]);
  };
  const wheel = new THREE.TorusGeometry(0.33, 0.035, 4, 14);
  for (const dx of [-0.52, 0.52]) { const w = wheel.clone(); w.translate(dx, 0.36, 0); parts.push([w, 0.08]); }
  const back = [-0.52, 0.36, 0], crank = [-0.05, 0.36, 0], seatTop = [-0.22, 0.85, 0], front = [0.52, 0.36, 0], stem = [0.37, 0.84, 0];
  for (const [a, b] of [[back, crank], [back, seatTop], [seatTop, crank], [seatTop, stem], [crank, stem], [stem, front], [stem, [0.41, 1.02, 0]]]) rod(a, b, 0.026, 1);
  for (const dx of [-0.52, 0.52]) for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; rod([dx, 0.36, 0], [dx + Math.cos(a) * 0.3, 0.36 + Math.sin(a) * 0.3, 0], 0.009, 0.45); }
  const seat = new THREE.BoxGeometry(0.25, 0.05, 0.14); seat.translate(-0.25, 0.92, 0); parts.push([seat, 0.15]);
  const post = new THREE.BoxGeometry(0.05, 0.4, 0.05); post.translate(-0.25, 0.72, 0); parts.push([post, 1]);
  const bar = new THREE.BoxGeometry(0.05, 0.05, 0.5); bar.translate(0.42, 0.98, 0); parts.push([bar, 0.15]);
  for (const y of [0.8, 0.98]) { rod([0.49, y, -0.16], [0.76, y, -0.16], 0.015, 0.25); rod([0.49, y, 0.16], [0.76, y, 0.16], 0.015, 0.25); rod([0.76, y, -0.16], [0.76, y, 0.16], 0.015, 0.25); }
  for (const z of [-0.16, 0.16]) for (const x of [0.49, 0.62, 0.76]) rod([x, 0.8, z], [x, 0.98, z], 0.01, 0.25);
  rod([-0.12, 0.34, 0.03], [-0.3, 0.0, 0.2], 0.012, 0.3);
  const geo = mergeColored(parts);
  const spots = [];
  for (const b of BLD) {
    if (!/食堂|求|楼|苑|图书馆/.test(b.name) || b.cls.special === 'station') continue;
    if (b.parts) continue;
    const e = edgeFacing(b.p, b.c[0] + 20, b.c[1] + 40, 20); if (!e) continue;
    const n = Math.min(28, Math.floor(e.len * 0.9 / 1.1)) * (/食堂|图书馆/.test(b.name) ? 1 : 0.4);
    for (let k = 0; k < n; k++) {
      const t = 0.08 + 0.84 * k / n, x = e.a[0] + (e.b[0] - e.a[0]) * t + e.nx * 4.2, z = e.a[1] + (e.b[1] - e.a[1]) * t + e.nz * 4.2;
      if (!inWater(x, z) && !bushAt(x, z) && !NO_TREE.some((q) => pip(x, z, q))) spots.push([x, z, Math.atan2(e.nz, e.nx) + rr(-0.12, 0.12) + Math.PI * 0.08]);
    }
  }
  BIKE_SPOTS = spots;
  const bm = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }), spots.length);
  const cols = ['#f2c200', '#1f8fe0', '#2fb35a', '#f2c200', '#1f8fe0'];
  const lean = new THREE.Euler(0, 0, 0, 'YXZ');
  spots.forEach(([x, z, a], i) => { lean.set(-0.11, -a, 0); _q.setFromEuler(lean); _m4.compose(_v.set(x, 0, z), _q, _s.set(1, 1, 1)); bm.setMatrixAt(i, _m4); bm.setColorAt(i, _c.set(pick(cols))); });
  bm.castShadow = false; bm.layers.set(1); scene.add(bm);
  BIKE_CHUNKS = chunkify(bm, 260, 240, true);
}
function mergeColored(parts) {
  const pos = [], nor = [], col = [], limbs = [];
  for (const [g, shade, limb = 0] of parts) {
    const ng = g.index ? g.toNonIndexed() : g; const p = ng.attributes.position, n = ng.attributes.normal;
    const [cr, cg, cb] = Array.isArray(shade) ? shade : [shade, shade, shade];
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(cr, cg, cb); limbs.push(limb); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aLimb', new THREE.Float32BufferAttribute(limbs, 1));
  return g;
}

const LIFE = [];
let LIFE_ON = true;
// Split a static InstancedMesh into spatial chunks: each chunk gets a tight bounding sphere, so the renderer frustum-culls
// it, and updateChunks() drops chunks beyond maxD. Props that are only a few pixels tall far away cost nothing there.
const CHUNKS = [];
function chunkify(im, maxD, cell = 140, life = false) {
  const groups = new Map(), m = new THREE.Matrix4(), v = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m); v.setFromMatrixPosition(m);
    const k = Math.floor(v.x / cell) + ',' + Math.floor(v.z / cell);
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i);
  }
  const parent = im.parent || scene; parent.remove(im);
  const out = [];
  for (const ids of groups.values()) {
    const c = new THREE.InstancedMesh(im.geometry, im.material, ids.length);
    ids.forEach((i, j) => { im.getMatrixAt(i, m); c.setMatrixAt(j, m); if (im.instanceColor) { im.getColorAt(i, col); c.setColorAt(j, col); } });
    c.castShadow = im.castShadow; c.receiveShadow = im.receiveShadow; c.layers.mask = im.layers.mask;
    if (im.customDepthMaterial) c.customDepthMaterial = im.customDepthMaterial;
    c.computeBoundingSphere(); c.userData.maxD = maxD; c.userData.life = life; c.userData.ids = ids;
    parent.add(c); CHUNKS.push(c); out.push(c);
  }
  return out;
}
const _cv = new THREE.Vector3();
function updateChunks() {
  const cp = camera.position, far = mode === 'walk' ? 1 : 1 + Math.max(0, cp.y - 60) / 120;
  for (const c of CHUNKS) {
    const bs = c.boundingSphere; _cv.copy(bs.center);
    c.visible = (!c.userData.life || LIFE_ON) && _cv.distanceTo(cp) - bs.radius < c.userData.maxD * far;
  }
}
let PEOPLE = null;
function buildPeople() {
  const routes = [];
  for (const r of D.pa) if (inCampus(r.p[0][0], r.p[0][1]) && r.p.length > 1) routes.push({ p: r.p, off: 0 });
  for (const r of D.r) if (inCampus(r.p[0][0], r.p[0][1]) && r.p.length > 1 && r.t !== 'service') { const w = roadW(r); routes.push({ p: offsetLine(r.p, w / 2 + 0.6), off: 0 }); routes.push({ p: offsetLine(r.p, -w / 2 - 0.6), off: 0 }); }
  routes.forEach((r) => { r.cum = cumLen(r.p); r.L = r.cum[r.cum.length - 1]; r.br = BRIDGES.filter((b) => r.p.some((q) => Math.hypot(q[0] - b.p[0][0], q[1] - b.p[0][1]) < 120)); });
  const valid = routes.filter((r) => r.L > 20);
  const N = QP.people, list = [];
  for (let i = 0; i < N; i++) {
    const r = pick(valid); list.push({ r, s: rr(0, r.L), dir: rand() < 0.5 ? 1 : -1, v: rr(1.0, 1.5), lat: rr(-0.7, 0.7), ph: rand() * 6, sc: rr(0.92, 1.08) });
  }
  const standSpots = [];
  const lib = byName(/^图书馆$/);
  if (lib && lib.front) for (let i = 0; i < 16; i++) standSpots.push([lib.front.x + rr(-35, 35), lib.front.z + rr(-35, 35)]);
  for (let i = 0; i < 12; i++) standSpots.push([PLAZAS.rondo[0] + rr(-18, 18), PLAZAS.rondo[1] + rr(-18, 18)]);
  for (const [x, z] of standSpots) if (!inWater(x, z)) list.push({ stand: true, x, z, a: rand() * 6.28, ph: rand() * 6, sc: rr(0.92, 1.08) });
  // three meshes sharing each walker's matrix: top (shirt colour), bottom (trousers colour), skin (face, neck, hands)
  const shirtP = [], pantsP = [], skinP = [];
  const add = (arr, g, x, y, z, shade = 1, limb = 0) => { g.translate(x, y, z); arr.push([g, shade, limb]); };
  { const t = new THREE.CylinderGeometry(0.17, 0.145, 0.52, 10, 1, true); t.scale(1, 1, 0.66); add(shirtP, t, 0, 1.15, 0); }
  { const sh = new THREE.SphereGeometry(0.17, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2); sh.scale(1.12, 0.42, 0.7); add(shirtP, sh, 0, 1.4, 0); }
  { const c = new THREE.CylinderGeometry(0.075, 0.09, 0.05, 8, 1, true); add(shirtP, c, 0, 1.44, 0, 0.92); }
  { const hp = new THREE.CylinderGeometry(0.15, 0.158, 0.17, 10); hp.scale(1, 1, 0.68); add(pantsP, hp, 0, 0.84, 0); }
  { const belt = new THREE.CylinderGeometry(0.152, 0.152, 0.035, 10, 1, true); belt.scale(1, 1, 0.69); add(pantsP, belt, 0, 0.92, 0, 0.35); }
  add(skinP, new THREE.CylinderGeometry(0.05, 0.056, 0.11, 7, 1, true), 0, 1.47, 0);
  for (const side of [-1, 1]) {
    add(pantsP, new THREE.CylinderGeometry(0.07, 0.052, 0.78, 7, 1, true), side * 0.085, 0.43, 0, 1, side);
    { const f = new THREE.BoxGeometry(0.1, 0.075, 0.26); f.translate(0, 0, 0.045); add(pantsP, f, side * 0.085, 0.037, 0, [0.12, 0.11, 0.1], side); }
    { const sole = new THREE.BoxGeometry(0.104, 0.02, 0.27); sole.translate(0, 0, 0.045); add(pantsP, sole, side * 0.085, 0.01, 0, [0.85, 0.85, 0.82], side); }
    add(shirtP, new THREE.CylinderGeometry(0.05, 0.04, 0.56, 7, 1, true), side * 0.2, 1.1, 0, 1, side * 2);
    { const hand = new THREE.SphereGeometry(0.046, 6, 4); hand.scale(0.8, 1.15, 0.75); add(skinP, hand, side * 0.2, 0.78, 0, 1, side * 2); }
  }
  const pantsCols = ['#2b3442', '#1f2124', '#3d4a5c', '#6b6457', '#4b4d52', '#8a7d64', '#2a3a5a', '#1c2433'];
  const shirtM = mergeColored(shirtP), pantsM = mergeColored(pantsP);
  const aPh = new THREE.InstancedBufferAttribute(Float32Array.from(list, p => p.ph), 1), aSt = new THREE.InstancedBufferAttribute(Float32Array.from(list, p => p.stand ? 0 : p.v), 1);
  aPh.setUsage(THREE.DynamicDrawUsage); aSt.setUsage(THREE.DynamicDrawUsage);
  for (const g of [shirtM, pantsM]) { g.setAttribute('aPhase', aPh); g.setAttribute('aStride', aSt); }
  const animateLimb = sh => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLimb, aPhase, aStride; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      if(abs(aLimb)>0.5){float aa=sin(uTime*7.0*aStride+aPhase)*0.48*sign(aLimb)*min(aStride,1.0);float pivot=0.82;
      if(abs(aLimb)>1.5){aa*=-0.7;pivot=1.36;}float py=transformed.y-pivot;float pz=transformed.z;
      transformed.y=pivot+py*cos(aa)-pz*sin(aa);transformed.z=py*sin(aa)+pz*cos(aa);}`);
  };
  const mk = (geo, rough) => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: rough }); m.onBeforeCompile = animateLimb;
    const im = new THREE.InstancedMesh(geo, m, list.length);
    im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); im.customDepthMaterial.onBeforeCompile = animateLimb;
    return im;
  };
  const face = new THREE.SphereGeometry(0.1, 12, 8); face.scale(0.86, 1.1, 0.95); face.translate(0, 1.61, 0); skinP.push([face, 1, 0]);
  const hair = new THREE.SphereGeometry(0.106, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.5); hair.scale(0.9, 1.0, 1.0); hair.translate(0, 1.645, -0.012); skinP.push([hair, 0.13, 0]);
  const back = new THREE.SphereGeometry(0.104, 7, 3, Math.PI * 1.15, Math.PI * 0.7, Math.PI * 0.45, Math.PI * 0.3); back.scale(0.92, 1.05, 1.0); back.translate(0, 1.64, -0.012); skinP.push([back, 0.13, 0]);
  for (const side of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.012, 4, 3); eye.translate(side * 0.033, 1.615, 0.091); skinP.push([eye, 0.08, 0]);
    const brow = new THREE.BoxGeometry(0.032, 0.007, 0.008); brow.translate(side * 0.033, 1.636, 0.093); skinP.push([brow, 0.2, 0]);
    const ear = new THREE.SphereGeometry(0.022, 4, 3); ear.scale(0.5, 1, 0.8); ear.translate(side * 0.087, 1.61, 0); skinP.push([ear, 0.92, 0]);
  }
  { const nose = new THREE.ConeGeometry(0.014, 0.035, 4); nose.rotateX(Math.PI / 2); nose.translate(0, 1.593, 0.1); skinP.push([nose, 0.95, 0]); }
  const skinM = mergeColored(skinP);
  skinM.setAttribute('aPhase', aPh); skinM.setAttribute('aStride', aSt);
  const bm = mk(shirtM, 0.88), pmesh = mk(pantsM, 0.82), hm = mk(skinM, 0.75);
  pmesh.instanceMatrix = bm.instanceMatrix;
  const shirts = ['#f2f1ec', '#2f3b4c', '#7b8ea3', '#c9c3b3', '#4a5a4c', '#26292d', '#b8c7d6', '#c48f8f', '#e9e7e1', '#5d5672', '#a8835f', '#d7b46a', '#9a3d3d'];
  const skins = ['#e2bf9f', '#d8b08d', '#caa07d', '#efcdb0'];
  list.forEach((p, i) => { p.c = [new THREE.Color(pick(shirts)), new THREE.Color(pick(pantsCols)), new THREE.Color(pick(skins))]; bm.setColorAt(i, p.c[0]); pmesh.setColorAt(i, p.c[1]); hm.setColorAt(i, p.c[2]); });
  bm.castShadow = pmesh.castShadow = hm.castShadow = QUALITY === 'high'; bm.frustumCulled = pmesh.frustumCulled = hm.frustumCulled = false;
  bm.layers.set(1); pmesh.layers.set(1); hm.layers.set(1); scene.add(bm, pmesh, hm); LIFE.push(bm, pmesh, hm);
  PEOPLE = { list, bm, hm, pants: pmesh, aPh, aSt };
}
function updatePeople(dt, t) {
  if (!PEOPLE || !PEOPLE.bm.visible) return;
  const { list, bm, hm, pants, aPh, aSt } = PEOPLE, cp = camera.position, R = mode === 'walk' ? 260 : 320 + Math.max(0, cp.y) * 1.5;
  let j = 0;
  list.forEach((p) => {
    let x, z, a, y = 0;
    if (p.stand) { x = p.x; z = p.z; a = p.a + Math.sin(t * 0.3 + p.ph) * 0.3; y = p.gy ??= groundAt(x, z); }
    else {
      p.s += p.v * p.dir * dt; if (p.s > p.r.L) { p.s = p.r.L; p.dir = -1; } else if (p.s < 0) { p.s = 0; p.dir = 1; }
      const q = sampleAt(p.r.p, p.r.cum, p.s); x = q.x - q.dz * p.lat; z = q.z + q.dx * p.lat; a = Math.atan2(q.dx * p.dir, q.dz * p.dir);
      y = Math.abs(Math.sin(t * 7 * p.v + p.ph)) * 0.035 + groundAt(x, z);
    }
    if (Math.abs(x - cp.x) > R || Math.abs(z - cp.z) > R) return;
    _e.set(0, a, 0); _q.setFromEuler(_e); _m4.compose(_v.set(x, y, z), _q, _s.setScalar(p.sc)); bm.setMatrixAt(j, _m4); hm.setMatrixAt(j, _m4);
    bm.setColorAt(j, p.c[0]); pants.setColorAt(j, p.c[1]); hm.setColorAt(j, p.c[2]);
    aPh.array[j] = p.ph; aSt.array[j] = p.stand ? 0 : p.v; j++;
  });
  bm.count = pants.count = hm.count = j;
  bm.instanceMatrix.needsUpdate = hm.instanceMatrix.needsUpdate = true;
  for (const m of [bm, pants, hm]) m.instanceColor.needsUpdate = true;
  aPh.needsUpdate = aSt.needsUpdate = true;
}

let CARS = null;
function carGeometry(o = {}) {
  const body = [], trim = [], wheel = [];
  const profile = (pts, width, bevel = 0.06) => {
    const sh = new THREE.Shape(pts.map((q) => new THREE.Vector2(...q)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1, curveSegments: 4 });
    g.translate(0, 0, -width / 2); g.computeVertexNormals(); return g;
  };
  const arch = (cx) => { const out = []; for (let k = 0; k <= 8; k++) { const a = Math.PI - k / 8 * Math.PI; out.push([cx + Math.cos(a) * 0.43, 0.31 + Math.sin(a) * 0.43]); } return out; };
  // side profile, front at +x: bumper, bonnet, waistline, boot; wheel arches cut into the sill
  body.push([profile([[-2.28, 0.34], ...arch(-1.4), [0.97, 0.34], ...arch(1.4), [2.27, 0.36], [2.34, 0.6], [2.2, 0.8], [1.0, 0.93], [-1.6, 0.97], [-2.16, 0.92], [-2.31, 0.74]], 1.66, 0.08), 1]);
  // glasshouse in tinted glass, with roof panel and pillars in body colour
  trim.push([profile([[-1.5, 0.95], [0.95, 0.95], [0.2, 1.43], [-1.05, 1.45], [-1.45, 1.05]], 1.42, 0.04), [0.07, 0.09, 0.11]]);
  { const r = new THREE.BoxGeometry(1.22, 0.05, 1.4); r.translate(-0.42, 1.47, 0); body.push([r, 1]); }
  { const bp = new THREE.BoxGeometry(0.1, 0.5, 1.5); bp.translate(-0.36, 1.2, 0); body.push([bp, 1]); }
  for (const [a, b] of [[[0.95, 0.95], [0.2, 1.44]], [[-1.05, 1.46], [-1.47, 1.02]]]) for (const z of [-0.71, 0.71]) {
    const dx = b[0] - a[0], dy = b[1] - a[1], g = new THREE.BoxGeometry(Math.hypot(dx, dy), 0.07, 0.07);
    g.rotateZ(Math.atan2(dy, dx)); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z); body.push([g, 1]);
  }
  for (const z of [-0.95, 0.95]) { const m = new THREE.BoxGeometry(0.14, 0.1, 0.16); m.translate(0.8, 1.0, z); body.push([m, 1]); }
  for (const [x, z] of [[0, 0], [-1.4, -0.8], [-1.4, 0.8], [1.4, -0.8], [1.4, 0.8]]) {
    const dst = x === 0 ? wheel : trim, y = x === 0 ? 0 : 0.33;
    if (x !== 0 && o.noWheels) continue;
    const tyre = new THREE.CylinderGeometry(0.33, 0.33, 0.24, x === 0 ? 20 : 12); tyre.rotateX(Math.PI / 2); tyre.translate(x, y, z); dst.push([tyre, [0.035, 0.035, 0.04]]);
    const rim = new THREE.CylinderGeometry(0.21, 0.21, 0.25, x === 0 ? 12 : 8); rim.rotateX(Math.PI / 2); rim.translate(x, y, z); dst.push([rim, [0.55, 0.57, 0.6]]);
    const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.26, 6); hub.rotateX(Math.PI / 2); hub.translate(x, y, z); dst.push([hub, [0.2, 0.2, 0.22]]);
    if (x === 0) for (let sk = 0; sk < 5; sk++) { const sp = new THREE.BoxGeometry(0.035, 0.3, 0.02); sp.rotateZ(sk * Math.PI / 5 * 2); sp.translate(0, 0, 0.128); dst.push([sp, [0.4, 0.42, 0.45]]); }
  }
  const box = (sx, sy, sz, x, y, z, c) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); trim.push([g, c]); };
  for (const z of [-0.58, 0.58]) { box(0.08, 0.13, 0.38, 2.27, 0.7, z, [1.0, 0.97, 0.88]); box(0.07, 0.13, 0.42, -2.3, 0.76, z, [0.62, 0.05, 0.05]); }
  box(0.05, 0.17, 0.92, 2.31, 0.5, 0, [0.05, 0.05, 0.055]);
  box(0.1, 0.13, 1.72, 2.28, 0.38, 0, [0.07, 0.07, 0.075]); box(0.1, 0.13, 1.72, -2.29, 0.41, 0, [0.07, 0.07, 0.075]);
  box(0.03, 0.12, 0.44, 2.35, 0.47, 0, [0.92, 0.92, 0.88]); box(0.03, 0.12, 0.44, -2.34, 0.58, 0, [0.92, 0.92, 0.88]);
  return { body: mergeColored(body), trim: mergeColored(trim), wheel: mergeColored(wheel) };
}
function buildCars() {
  const cg = carGeometry(), geo = cg.body, mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.55 });
  const cols = ['#f1f1ef', '#1c1d20', '#9aa0a6', '#c9ccd0', '#2c4a7a', '#8c2a2a', '#f1f1ef', '#4a4f55', '#e8e2d2'];
  const movers = [];
  const outer = D.r.filter((r) => ['primary', 'secondary', 'tertiary'].includes(r.t) && cumLen(r.p).pop() > 150);
  outer.forEach((r) => { r.cum = cumLen(r.p); r.L = r.cum[r.cum.length - 1]; r.br = false; for (let t = 0; t < r.L && !r.br; t += 4) { const q = sampleAt(r.p, r.cum, t); r.br = BRIDGES.some((b) => pip(q.x, q.z, b.p)); } });
  const totalL = outer.reduce((a, r) => a + r.L, 0);
  for (const r of outer) {
    const n = Math.max(1, Math.round(QP.cars * r.L / totalL));
    for (let i = 0; i < n; i++) {
      const dir = r.ow ? 1 : (rand() < 0.5 ? 1 : -1), lanes = r.ow ? Math.max(2, r.ln || 3) : 1;
      const lane = r.ow ? (Math.floor(rand() * lanes) - (lanes - 1) / 2) * 3.4 : -2.2 * dir;
      movers.push({ r, s: rr(0, r.L), dir, lane, v: rr(9, 15) });
    }
  }
  const parked = [];
  for (const r of D.r) {
    if (!inCampus(r.p[0][0], r.p[0][1]) || r.wide || !['unclassified', 'service', 'tertiary'].includes(r.t)) continue;
    const w = roadW(r), side = rand() < 0.5 ? 1 : -1, line = offsetLine(r.p, side * (w / 2 + 1.3)), cum = cumLen(line), dens = /济群|以诚|博文/.test(r.n || '') ? 0.32 : 0.1;
    for (let s = 5; s < cum[cum.length - 1] - 5; s += 5.6) {
      if (rand() > dens) continue; const q = sampleAt(line, cum, s);
      const academicEntry = BLD.some(b => b.parts && Math.hypot(q.x-b.c[0],q.z-b.c[1])<125);
      if (!academicEntry && Math.hypot(q.x - GATE.x, q.z - GATE.z) > 48 && Math.hypot(q.x - PLAZAS.rondo[0], q.z - PLAZAS.rondo[1]) > PLAZAS.rondo[2] + 4 && !D.sq.some((g) => pip(q.x, q.z, g.p)) && !D.g.some((g) => pip(q.x, q.z, g.p)) && !inWater(q.x, q.z) && !BLD.some((b) => pip(q.x, q.z, b.p))) parked.push([q.x, q.z, Math.atan2(q.dz, q.dx)]);
    }
  }
  for (const l of D.lu) if (l.k === 'parking') { const ob = obb(l.p); for (let u = -ob.L / 2 + 1.5; u < ob.L / 2 - 1; u += 2.5) for (const v of [-ob.W / 2 + 3, ob.W / 2 - 3]) if (rand() < 0.7) parked.push([ob.cx + ob.ux * u - ob.uz * v, ob.cz + ob.uz * u + ob.ux * v, ob.ang + Math.PI / 2]); }
  for (let a = 2.3; a < 31; a += 2.6) if (rand() < 0.7) { const [x, z] = gateP(a, 16.1); parked.push([x, z, Math.atan2(GATE.nz, GATE.nx)]); }
  const N = movers.length + parked.length;
  const im = new THREE.InstancedMesh(geo, mat, N); im.castShadow = true; im.frustumCulled = false;
  const carCols = []; for (let i = 0; i < N; i++) { carCols.push(new THREE.Color(pick(cols))); im.setColorAt(i, carCols[i]); }
  const parkedM = parked.map(([x, z, a]) => { _e.set(0, -a, 0); _q.setFromEuler(_e); return new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), _q.clone(), new THREE.Vector3(1, 1, 1)); });
  im.layers.set(1); scene.add(im); LIFE.push(im);
  // glass, tyres and lights keep their own colours: a second mesh sharing the same instance matrices
  const trim = new THREE.InstancedMesh(cg.trim, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.35 }), N);
  trim.instanceMatrix = im.instanceMatrix; trim.frustumCulled = false; trim.layers.set(1); scene.add(trim); LIFE.push(trim);
  CARS = { im, movers, trim, parkedM, carCols };
}
function updateCars(dt) {
  if (!CARS || !CARS.im.visible) return;
  const cp = camera.position, R = mode === 'walk' ? 600 : 700 + Math.max(0, cp.y) * 2, im = CARS.im;
  let j = 0;
  CARS.movers.forEach((c, i) => {
    c.s += c.v * c.dir * dt; if (c.s > c.r.L) c.s -= c.r.L; if (c.s < 0) c.s += c.r.L;
    if (c.drive) return;
    const q = sampleAt(c.r.p, c.r.cum, c.s), x = q.x - q.dz * c.lane, z = q.z + q.dx * c.lane;
    if (Math.abs(x - cp.x) > R || Math.abs(z - cp.z) > R) return;
    _e.set(0, -Math.atan2(q.dz * c.dir, q.dx * c.dir), 0); _q.setFromEuler(_e); _m4.compose(_v.set(x, c.r.br ? groundAt(x, z) : 0, z), _q, _s.set(1, 1, 1));
    im.setMatrixAt(j, _m4); im.setColorAt(j, CARS.carCols[i]); j++;
  });
  CARS.parkedM.forEach((m, k) => {
    if (CARS.taken === k) return;
    const e = m.elements; if (Math.abs(e[12] - cp.x) > R || Math.abs(e[14] - cp.z) > R) return;
    im.setMatrixAt(j, m); im.setColorAt(j, CARS.carCols[CARS.movers.length + k]); j++;
  });
  im.count = CARS.trim.count = j;
  im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
}

const TRAINS = [];
function trainSideTex(kind) {
  const c = mkCanvas(512, 64), g = c.getContext('2d');
  g.fillStyle = '#f4f5f3'; g.fillRect(0, 0, 512, 64);
  if (kind === 'metro') { g.fillStyle = '#00a2df'; g.fillRect(0, 40, 512, 8); g.fillStyle = '#1b2a33'; for (let x = 18; x < 512; x += 64) g.fillRect(x, 12, 40, 22); g.fillStyle = '#bfc6ca'; for (let x = 4; x < 512; x += 128) g.fillRect(x, 8, 10, 48); }
  else { g.fillStyle = '#c81e1e'; g.fillRect(0, 42, 512, 5); g.fillStyle = '#c9a23a'; g.fillRect(0, 48, 512, 2); g.fillStyle = '#1b2a33'; for (let x = 10; x < 512; x += 26) g.fillRect(x, 16, 18, 16); }
  return canvasTex(c, true, false);
}
function buildTrains() {
  for (const tr of TRACKS) {
    const metro = tr.kind === 'metro', n = metro ? 6 : 8, len = metro ? 19.5 : 25, w = metro ? 2.9 : 3.3, h = metro ? 3.7 : 3.9;
    const side = new THREE.MeshStandardMaterial({ map: trainSideTex(tr.kind), roughness: 0.35, metalness: 0.3, emissive: 0xffe6b0, emissiveIntensity: 0 });
    const plain = new THREE.MeshStandardMaterial({ color: '#f4f5f3', roughness: 0.35, metalness: 0.3 });
    NIGHT_MATS.push({ m: side, k: 0.12 });
    const cars = [];
    for (let i = 0; i < n; i++) {
      const g = new THREE.BoxGeometry(len - 0.6, h, w); g.translate(0, h / 2 + 0.5, 0);
      const m = new THREE.Mesh(g, [plain, plain, plain, plain, side, side]); m.castShadow = true;
      if (i === 0 || i === n - 1) { const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI), plain); nose.scale.set(metro ? 1.2 : 4.5, h / 2, w / 2); nose.rotation.y = i === 0 ? -Math.PI / 2 : Math.PI / 2; nose.position.set((i === 0 ? 1 : -1) * (len / 2 - 0.3), h / 2 + 0.5, 0); m.add(nose); }
      scene.add(m); cars.push(m);
    }
    tr.cum = cumLen(tr.p); tr.L = tr.cum[tr.cum.length - 1];
    TRAINS.push({ tr, cars, len, metro, t: rand() * 60, side: metro ? -2.1 : 2.5 });
  }
}
function updateTrains(dt) {
  for (const T of TRAINS) {
    T.t += dt; const L = T.tr.L, total = T.len * T.cars.length;
    let s, dir;
    if (T.metro) {
      const cyc = 150, k = T.t % cyc;
      if (k < 55) { s = lerp(-total, L - 6, ease(k / 55)); dir = 1; T.side = -2.1; }
      else if (k < 80) { s = L - 6; dir = 1; }
      else { s = lerp(L - 6, -total - 200, ease((k - 80) / 70)); dir = 1; T.side = 2.1; }
    } else { const cyc = 70, k = T.t % cyc; dir = Math.floor(T.t / cyc) % 2 ? -1 : 1; s = (k / cyc) * (L + total * 2) - total; if (dir < 0) s = L - s; T.side = dir > 0 ? 2.5 : -2.5; }
    T.cars.forEach((m, i) => {
      const si = s - (i + 0.5) * T.len * (dir > 0 ? 1 : -1) * (T.metro ? 1 : 1);
      if (si < 0 || si > L) { m.visible = false; return; }
      m.visible = true; const q = sampleAt(T.tr.p, T.tr.cum, si);
      m.position.set(q.x - q.dz * T.side, T.tr.y, q.z + q.dx * T.side);
      m.rotation.y = -Math.atan2(q.dz, q.dx) + (dir > 0 ? 0 : Math.PI);
    });
  }
}

const sky = new Sky(); sky.scale.setScalar(10000); scene.add(sky);
const skyU = sky.material.uniforms;
skyU.uZenith = {value: new THREE.Color('#397bc1')}; skyU.uHorizon = {value: new THREE.Color('#c6ddeb')}; skyU.uDay = {value: 1};
sky.material.vertexShader = `varying vec3 vSkyDir; void main(){vec4 w=modelMatrix*vec4(position,1.0);vSkyDir=w.xyz-cameraPosition;gl_Position=projectionMatrix*viewMatrix*w;gl_Position.z=gl_Position.w;}`;
sky.material.fragmentShader = `uniform vec3 sunPosition,uZenith,uHorizon; uniform float uDay; varying vec3 vSkyDir;
void main(){vec3 d=normalize(vSkyDir);float h=pow(max(d.y,0.0),0.45);vec3 c=mix(uHorizon,uZenith,h);float sd=max(dot(d,normalize(sunPosition)),0.0);c+=vec3(1.0,0.82,0.6)*pow(sd,250.0)*0.3*uDay;c+=vec3(3.0,2.7,2.0)*smoothstep(0.99972,0.99994,sd)*uDay;gl_FragColor=vec4(c,1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
function skyGain(m, g) {
  m.uniforms.uGain = { value: g };
  m.fragmentShader = m.fragmentShader.replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float uGain;').replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * uGain, 1.0 );');
  m.needsUpdate = true;
}
skyGain(sky.material, 0.65);
skyU.turbidity.value = 2.5; skyU.rayleigh.value = 2.0; skyU.mieCoefficient.value = 0.003; skyU.mieDirectionalG.value = 0.82;
const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(50); envScene.add(envSky); skyGain(envSky.material, 0.21);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null, lastEnvElev = 999;
const stars = (() => {
  const n = 2500, pos = new Float32Array(n * 3), r = mulberry(5);
  for (let i = 0; i < n; i++) { const u = r(), v = r() * 0.95, th = u * Math.PI * 2, ph = Math.acos(1 - v); pos[i * 3] = Math.sin(ph) * Math.cos(th) * 8000; pos[i * 3 + 1] = Math.cos(ph) * 8000; pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 8000; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  p.layers.set(3); camera.layers.enable(3); scene.add(p); return p;
})();
const DECL = { spring: 9.5, summer: 21.5, autumn: -11.2, winter: -20.5 };
let season = 'summer', hour = 10.5, NIGHT = 0, autoTime = true, timeApplyAt = 0;
const SUN = new THREE.Vector3();
function sunVector(h) {
  const lat = 31.9 * Math.PI / 180, dec = DECL[season] * Math.PI / 180, H = (h - 11.85) * 15 * Math.PI / 180;
  const east = -Math.cos(dec) * Math.sin(H), north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.cos(H) * Math.sin(lat), up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  return new THREE.Vector3(east, up, -north).normalize();
}
function sunTimes() {
  const lat = 31.9 * Math.PI / 180, dec = DECL[season] * Math.PI / 180;
  const H0 = Math.acos(clamp((Math.sin(-0.83 * Math.PI / 180) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec)), -1, 1)) * 180 / Math.PI / 15;
  const f = (t) => `${Math.floor(t)}:${String(Math.round((t % 1) * 60)).padStart(2, '0')}`;
  return [f(11.85 - H0), f(11.85 + H0)];
}
let groundMat = null, waterObj = null, waterSimple = null;
const SEASONS = {
  spring: { grass: '#7fa846', grassAmt: 0.55, snow: 0, turb: 2.4, ray: 2.7, cover: 0.38, part: 'petal', water: '#2f5046', sunK: 1.0, haze: '#d5dfe7', expo: 0.86 },
  summer: { grass: '#4f7d33', grassAmt: 0.6, snow: 0, turb: 1.9, ray: 3.1, cover: 0.46, part: null, water: '#294739', sunK: 1.06, haze: '#cad7e2', expo: 0.82 },
  autumn: { grass: '#9c9150', grassAmt: 0.62, snow: 0, turb: 1.8, ray: 2.9, cover: 0.28, part: 'leaf', water: '#34493f', sunK: 1.0, haze: '#dad7cc', expo: 0.86 },
  winter: { grass: '#8a876f', grassAmt: 0.75, snow: 0.9, turb: 7.0, ray: 1.1, cover: 0.62, part: 'snow', water: '#5f6e74', sunK: 0.5, haze: '#ccd2d8', expo: 1.0 },
};
const LEAF_AMB = { value: 0.12 };
const SEASON_U = { uSnow: { value: 0 }, uGrass: { value: new THREE.Color('#4c7c30') }, uGrassAmt: { value: 0.6 } };
function seasonPatch(mat) {
  if (!mat || !mat.isMeshStandardMaterial || mat.userData.seasonPatched) return;
  mat.userData.seasonPatched = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    sh.uniforms.uSnow = SEASON_U.uSnow;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnN; varying vec3 vSnP;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 snp = vec4(transformed, 1.0); vec3 snn = objectNormal;
          #ifdef USE_INSTANCING
          snp = instanceMatrix * snp; snn = mat3(instanceMatrix) * snn;
          #endif
          vSnP = (modelMatrix * snp).xyz; vSnN = normalize(mat3(modelMatrix) * snn); }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uSnow; varying vec3 vSnN; varying vec3 vSnP;
      float snH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float snN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(snH(i), snH(i + vec2(1, 0)), f.x), mix(snH(i + vec2(0, 1)), snH(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      if (uSnow > 0.0) {
        float up = smoothstep(0.3, 0.8, normalize(vSnN).y);
        float nz = snN(vSnP.xz * 0.3) * 0.6 + snN(vSnP.xz * 1.9) * 0.4;
        float sk = uSnow * up * smoothstep(0.18, 0.5, nz + uSnow * 0.3 - 0.12);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.95), sk);
      }`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => key() + '|snow';
}
let CLOUDS = null;
function buildClouds() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uTime, uCover: { value: 0.45 }, uSun: { value: SUN }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color('#9fb0c4') }, uCam: { value: camera.position } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime, uCover; uniform vec3 uSun, uSunCol, uAmb, uCam; varying vec3 vW;
      float hs(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float ns(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hs(i), hs(i + vec2(1, 0)), f.x), mix(hs(i + vec2(0, 1)), hs(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0.5, s = 0.0; mat2 r = mat2(0.8, 0.6, -0.6, 0.8); for (int i = 0; i < 6; i++) { s += a * ns(p); p = r * p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
      void main(){
        vec2 p = vW.xz * 0.00038 + vec2(uTime * 0.0035, uTime * 0.0014);
        float n = clamp((fbm(p) - 0.5) * 1.8 + 0.5, 0.0, 1.0);
        float d = smoothstep(1.0 - uCover, 1.0 - uCover + 0.32, n);
        if (d < 0.004) discard;
        float n2 = clamp((fbm(p + normalize(uSun.xz + 1e-4) * 0.05) - 0.5) * 1.8 + 0.5, 0.0, 1.0);
        float lit = clamp(0.7 + (n - n2) * 1.6, 0.25, 1.15);
        vec3 col = mix(uAmb, uSunCol, lit * 0.8) * (1.0 - d * 0.18);
        float dist = length(vW.xz - uCam.xz);
        float fade = 1.0 - smoothstep(8000.0, 20000.0, dist);
        gl_FragColor = vec4(col, d * fade * 0.94);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(46000, 46000, 1, 1); geo.rotateX(-Math.PI / 2);
  CLOUDS = new THREE.Mesh(geo, mat); CLOUDS.position.y = 1800; CLOUDS.frustumCulled = false; CLOUDS.renderOrder = 2;
  CLOUDS.visible = false;
  scene.add(CLOUDS); NO_AO.push(CLOUDS);
}
let PART = null;
function buildParticles() {
  const N = 7000, pos = new Float32Array(N * 3), sd = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = rr(-110, 110); pos[i * 3 + 1] = rr(0, 70); pos[i * 3 + 2] = rr(-110, 110); sd[i] = rand(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uType: { value: 0 }, uLight: { value: 1 } }]),
    vertexShader: `attribute float aSeed; uniform float uTime, uType; uniform vec3 uCam; varying float vS; varying float vRot;
      #include <fog_pars_vertex>
      void main(){
        float fall = uType > 1.5 ? 1.3 : (uType > 0.5 ? 1.6 : 0.9);
        vec3 p = position;
        p.y -= uTime * fall * (0.7 + aSeed * 0.6);
        p.x += sin(uTime * (0.6 + aSeed) + aSeed * 40.0) * (uType > 1.5 ? 1.2 : 3.0) + uTime * 0.8;
        p.z += cos(uTime * (0.5 + aSeed * 0.7) + aSeed * 20.0) * (uType > 1.5 ? 1.2 : 2.5);
        vec3 c = uCam; c.y = max(uCam.y - 25.0, 0.0);
        p.xz = mod(p.xz - c.xz + 110.0, 220.0) - 110.0 + c.xz;
        p.y = mod(p.y - c.y, 70.0) + c.y;
        vS = aSeed; vRot = uTime * (1.0 + aSeed * 2.0) + aSeed * 6.28;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (uType > 1.5 ? 0.16 : 0.22) * 900.0 / -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uType, uLight; varying float vS; varying float vRot;
      #include <fog_pars_fragment>
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float cs = cos(vRot), sn = sin(vRot); q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
        vec3 col; float a;
        if (uType > 1.5) { a = smoothstep(0.5, 0.15, length(q)); col = vec3(0.97, 0.98, 1.0); }
        else if (uType > 0.5) { a = step(length(q * vec2(1.0, 2.1)), 0.42); col = mix(vec3(0.95, 0.72, 0.12), vec3(0.78, 0.3, 0.1), vS); }
        else { a = step(length(q * vec2(1.0, 1.7)), 0.4); col = mix(vec3(1.0, 0.86, 0.9), vec3(0.98, 0.7, 0.8), vS); }
        if (a < 0.05) discard;
        gl_FragColor = vec4(col * uLight, a * 0.92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  PART = new THREE.Points(g, mat); PART.frustumCulled = false; PART.visible = false; PART.layers.set(1);
  scene.add(PART); NO_AO.push(PART);
}
function updateParticles(dt) {
  if (!PART || !PART.visible) return;
  const u = PART.material.uniforms; u.uTime.value += dt; u.uCam.value.copy(camera.position);
}
let ICE = null, LOTUS = null;
function applyTime() {
  shadowDirty = true;
  const S = SEASONS[season];
  SUN.copy(sunVector(hour));
  const el = Math.asin(SUN.y) * 180 / Math.PI;
  NIGHT = 1 - smooth(-7, 3, el);
  const golden = smooth(-2, 4, el) * (1 - smooth(5, 20, el));
  skyU.sunPosition.value.copy(SUN);
  skyU.rayleigh.value = lerp(S.ray, S.ray + 1.0, golden);
  skyU.turbidity.value = lerp(S.turb, S.turb + 4, golden);
  skyU.mieCoefficient.value = season === 'winter' ? 0.008 : 0.003;
  const day = smooth(-3, 10, el);
  skyU.uDay.value = day;
  skyU.uZenith.value.set(season === 'winter' ? '#9fb7cb' : '#4289cf').lerp(new THREE.Color('#557ca2'), golden).lerp(new THREE.Color('#020817'), NIGHT);
  skyU.uHorizon.value.set(season === 'winter' ? '#d1d8dd' : '#bfd9eb').lerp(new THREE.Color('#e8b486'), golden * 0.85).lerp(new THREE.Color('#101b30'), NIGHT);
  sunLight.intensity = lerp(0, 3.95 * S.sunK, day) + NIGHT * 0.25;
  sunLight.color.setRGB(1, lerp(0.985, 0.6, golden), lerp(0.95, 0.36, golden)).lerp(new THREE.Color('#9fb4ff'), NIGHT);
  hemi.intensity = lerp(0.1, (1.0 + (1 - S.sunK) * 0.65) * 0.55, day) + NIGHT * 0.32;
  hemi.color.set('#c3d6ec').lerp(new THREE.Color('#ffd2a6'), golden * 0.5).lerp(new THREE.Color('#25314f'), NIGHT);
  hemi.groundColor.set(season === 'winter' ? '#8a8c90' : '#5f5c4a').lerp(new THREE.Color('#161616'), NIGHT);
  const fog = new THREE.Color(S.haze).lerp(new THREE.Color('#e9b98c'), golden * 0.75).lerp(new THREE.Color('#0d1525'), NIGHT);
  scene.fog.color.copy(fog); scene.fog.density = lerp(season === 'winter' ? 0.00034 : season === 'autumn' ? 0.0002 : 0.00016, 0.00026, NIGHT);
  renderer.toneMappingExposure = lerp(S.expo * 0.82, 1.25, NIGHT);
  stars.material.opacity = NIGHT * (season === 'winter' ? 0.25 : 0.9);
  if (LAMP_GLOW) LAMP_GLOW.material.opacity = smooth(0.35, 0.9, NIGHT);
  for (const { m, k } of NIGHT_MATS) {m.emissiveIntensity = NIGHT * k;if(m.userData.nightMap){const map=NIGHT>.001?m.userData.nightMap:null;if(m.emissiveMap!==map){m.emissiveMap=map;m.needsUpdate=true;}}}
  if (waterObj) {
    waterObj.material.uniforms.sunDirection.value.copy(SUN.y > 0 ? SUN : new THREE.Vector3(0.3, 0.4, 0.2).normalize());
    waterObj.material.uniforms.sunColor.value.copy(sunLight.color).multiplyScalar(day * 0.8 * S.sunK + 0.04);
    waterObj.material.uniforms.waterColor.value.set(S.water).lerp(new THREE.Color('#071012'), NIGHT);
  }
  if (CLOUDS) {
    const u = CLOUDS.material.uniforms;
    u.uCover.value = S.cover;
    u.uSunCol.value.copy(sunLight.color).multiplyScalar(lerp(0.05, 1.25, day));
    u.uAmb.value.set(season === 'winter' ? '#a9b0b8' : '#a7b6c8').lerp(new THREE.Color('#e3a77e'), golden * 0.6).multiplyScalar(lerp(0.04, 0.95, day));
  }
  if (PART) PART.material.uniforms.uLight.value = lerp(0.12, 1.0, day);
  LEAF_AMB.value = lerp(0.02, season === 'winter' ? 0.2 : 0.22, day);
  if ((Math.abs(el - lastEnvElev) > (autoTime ? 2.5 : 1.2) && !controls.active && !controls.zoomQ) || envSeason !== season) {
    lastEnvElev = el; envSeason = season;
    envSky.material.uniforms.sunPosition.value.copy(SUN);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = skyU[k].value;
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0.04); scene.environment = envRT.texture;
  }
  const lab = $('#timeLabel'); const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60) % 60;
  lab.textContent = `${hh}:${String(mm).padStart(2, '0')}`;
  $('#time').style.setProperty('--p', `${((hour - 5) / 17.5) * 100}%`);
  labelRenderer.domElement.classList.toggle('night', NIGHT > 0.5);
  if (UNDER.on) underFog();
}
let envSeason = '';
function tuneEnv() {
  const shiny = new Set([MAT.glassClear, MAT.glassRoof, MAT.solar, MAT.metal, MAT.gold, MAT.greenhouse, MAT.poolWater]);
  scene.traverse((o) => {
    if (!o.material) return;
    for (const m of [].concat(o.material)) {
      if (!('envMapIntensity' in m)) continue;
      m.envMapIntensity = shiny.has(m) ? 0.9 : m.userData.facade ? 0.75 : m.userData.leaf ? 0.35 : 0.3;
      seasonPatch(m);
    }
  });
}
function applySeason() {
  const S = SEASONS[season];
  SEASON_U.uSnow.value = S.snow; SEASON_U.uGrass.value.set(S.grass); SEASON_U.uGrassAmt.value = S.grassAmt;
  if (PART) { PART.visible = !!S.part; PART.material.uniforms.uType.value = { petal: 0, leaf: 1, snow: 2 }[S.part] ?? 0; PART.geometry.setDrawRange(0, S.part === 'snow' ? 7000 : S.part === 'petal' ? 1600 : 1300); }
  if (ICE) ICE.visible = season === 'winter';
  if (LOTUS) LOTUS.forEach((m) => { m.visible = season === 'summer' || (season === 'spring' && m.userData.leafOnly); });
  applySeasonToTrees(); applyTime();
}

const LOAD_STATE={stages:[],completed:0,total:0,started:performance.now(),readyAt:null};
async function loadStage(label,work){
  if (DISPOSED) throw new Error('disposed');
  $('#loadMsg').textContent=`${label} · ${LOAD_STATE.completed}/${LOAD_STATE.total}`;
  await nextFrame();const start=performance.now();await work();
  LOAD_STATE.stages.push({label,ms:performance.now()-start});LOAD_STATE.completed++;
  $('#loadBar').style.width=(LOAD_STATE.completed/LOAD_STATE.total*100)+'%';
  $('#loading .bar').setAttribute('aria-valuenow',String(LOAD_STATE.completed));
}
async function uploadSceneTextures(){
  if(!renderer.initTexture)return;
  const textures=new Set();scene.traverse(o=>{for(const m of o.material?[].concat(o.material):[])for(const key of ['map','normalMap','roughnessMap','metalnessMap','alphaMap','emissiveMap'])if(m[key]?.isTexture)textures.add(m[key]);});
  let n=0;
  for(const texture of textures){renderer.initTexture(texture);n++;if(n%6===0){$('#loadMsg').textContent=`上传贴图 ${n}/${textures.size} · ${LOAD_STATE.completed}/${LOAD_STATE.total}`;$('#loadBar').style.width=((LOAD_STATE.completed+n/textures.size)/LOAD_STATE.total*100)+'%';await nextFrame();}}
}
function paintTreeShade() {
  const { canvas, s } = GROUND, g = canvas.getContext('2d');
  const sh = mkCanvas(canvas.width, canvas.height), sg = sh.getContext('2d');
  sg.setTransform(s, 0, 0, s, -REG.x0 * s, -REG.z0 * s); sg.fillStyle = 'rgba(0,0,0,.42)';
  for (const t of TREES) { const r = SPECIES[t.type].rx * t.s * 0.7; sg.beginPath(); sg.arc(t.x, t.z, r, 0, 7); sg.fill(); }
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.filter = `blur(${Math.round(s * 1.6)}px)`; g.globalAlpha = 0.5; g.drawImage(sh, 0, 0); g.restore();
}
function buildGround() {
  const tex = new THREE.CanvasTexture(GROUND.canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = MAXANI;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  const geo = new THREE.PlaneGeometry(REGW, REGH); geo.rotateX(-Math.PI / 2); geo.translate(REG.x0 + REGW / 2, 0, REG.z0 + REGH / 2);
  const det = canvasTex(noiseCanvas(256, 16, 3, 33, 0, 255), false);
  const near = (() => {
    // r: grass blades, g: fine grain for paving/asphalt, b: pebbles and stains
    const c = mkCanvas(512, 512), g = c.getContext('2d'), N = 512;
    g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, N, N);
    const id = g.getImageData(0, 0, N, N), d = id.data;
    for (let i = 0; i < N * N; i++) { d[i * 4 + 1] = 128 + (rand() - 0.5) * 70; d[i * 4] = 128 + (rand() - 0.5) * 40; d[i * 4 + 2] = 128 + (rand() - 0.5) * 30; }
    g.putImageData(id, 0, 0);
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 9000; i++) {
      const x = rand() * N, y = rand() * N, l = rr(5, 16), a = rr(-0.5, 0.5), v = Math.floor(rr(40, 230));
      g.strokeStyle = `rgba(${v},128,128,${rr(0.5, 0.9)})`; g.lineWidth = rr(1, 2.2); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(a) * l, y - Math.cos(a) * l); g.stroke();
      for (const [ox, oy] of [[-N, 0], [N, 0], [0, -N], [0, N]]) if ((x + ox > -20 && x + ox < N + 20) && (y + oy > -20 && y + oy < N + 20)) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.sin(a) * l, y + oy - Math.cos(a) * l); g.stroke(); }
    }
    const id2 = g.getImageData(0, 0, N, N), e = id2.data;
    for (let i = 0; i < 260; i++) { const cx = rand() * N, cy = rand() * N, r = rr(1, 3.5), v = rand() < 0.5 ? 70 : 190; for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= r * r) { const px = (Math.floor(cx + x) + N) % N, py = (Math.floor(cy + y) + N) % N; e[(py * N + px) * 4 + 2] = v; } }
    g.putImageData(id2, 0, 0);
    const t = canvasTex(c, false); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAXANI; return t;
  })();
  groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
  groundMat.customProgramCacheKey = () => 'ground';
  groundMat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: det }; sh.uniforms.uNear = { value: near }; sh.uniforms.uCam = { value: camera.position }; sh.uniforms.uGrass = SEASON_U.uGrass; sh.uniforms.uGrassAmt = SEASON_U.uGrassAmt;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform sampler2D uDetail; uniform sampler2D uNear; uniform vec3 uCam; uniform vec3 uGrass; uniform float uGrassAmt;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float dd = distance(uCam, vWP); float kk = 1.0 - smoothstep(25.0, 260.0, dd);
        float det = texture2D(uDetail, vWP.xz * 0.23).r * 0.55 + texture2D(uDetail, vWP.xz * 0.047).r * 0.45;
        diffuseColor.rgb *= mix(1.0, 0.74 + det * 0.52, kk);
        float gmx = max(diffuseColor.r, diffuseColor.b); float gr = clamp((diffuseColor.g - gmx) * 9.0, 0.0, 1.0);
        float glum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = mix(diffuseColor.rgb, uGrass * (0.42 + glum * 1.5), gr * uGrassAmt);
        diffuseColor.rgb *= mix(1.0, 0.66, smoothstep(0.42, 0.8, dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))));
        float kn = 1.0 - smoothstep(6.0, 70.0, dd);
        if (kn > 0.0) {
          vec3 nb = texture2D(uNear, vWP.xz * 0.55).rgb, nf = texture2D(uNear, vWP.xz * 1.9).rgb;
          float gm = max(gr, step(gmx + 0.02, diffuseColor.g) * 0.6);
          float blade = (nb.r - 0.5) * 0.55 + (nf.r - 0.5) * 0.35;
          float grain = (nf.g - 0.5) * 0.22 + (nb.b - 0.5) * 0.14;
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          // light paving: 0.6 m slabs with thin joints
          vec2 sl = fract(vWP.xz / 0.6); vec2 jd = min(sl, 1.0 - sl); float joint = 1.0 - smoothstep(0.0, 0.035, min(jd.x, jd.y));
          float pave = smoothstep(0.32, 0.45, lum) * (1.0 - gm) * (1.0 - smoothstep(18.0, 40.0, dd));
          diffuseColor.rgb *= 1.0 + kn * (gm * blade + (1.0 - gm) * grain);
          diffuseColor.rgb *= 1.0 - pave * joint * 0.18;
        }`);
  };
  const mesh = new THREE.Mesh(geo, groundMat); mesh.receiveShadow = true; scene.add(mesh);
  { const ot = new THREE.CanvasTexture(OUTER.canvas); ot.colorSpace = THREE.SRGBColorSpace; ot.anisotropy = MAXANI;
    const og2 = new THREE.PlaneGeometry(OREG.x1 - OREG.x0, OREG.z1 - OREG.z0); og2.rotateX(-Math.PI / 2); og2.translate((OREG.x0 + OREG.x1) / 2, -0.12, (OREG.z0 + OREG.z1) / 2);
    const om = groundMat.clone(); om.map = ot; om.onBeforeCompile = groundMat.onBeforeCompile; om.customProgramCacheKey = groundMat.customProgramCacheKey;
    const o2 = new THREE.Mesh(og2, om); o2.receiveShadow = true; scene.add(o2); }
  const og = new THREE.PlaneGeometry(36000, 36000); og.rotateX(-Math.PI / 2);
  const oc = mkCanvas(1024, 1024), octx = oc.getContext('2d'); octx.fillStyle = '#8f9671'; octx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 700; i++) { octx.save(); octx.translate(rand() * 1024, rand() * 1024); octx.rotate(-0.58 + rr(-0.15, 0.15)); octx.globalAlpha = 0.55; octx.fillStyle = pick(['#9d9d80', '#aba58f', '#8f9a72', '#a5a291', '#86926a', '#b4af9f', '#7f8c62', '#b9b6a8', '#c2beb2']); octx.fillRect(-rr(8, 30), -rr(6, 26), rr(16, 60), rr(12, 52)); octx.restore(); }
  octx.globalAlpha = 0.5; octx.globalCompositeOperation = 'soft-light'; octx.drawImage(noiseCanvas(256, 4, 4, 12, 40, 220), 0, 0, 1024, 1024);
  const ot = canvasTex(oc); ot.repeat.set(9, 9);
  const outer = new THREE.Mesh(og, new THREE.MeshStandardMaterial({ map: ot, roughness: 1 }));
  outer.position.y = -0.4; scene.add(outer);
}
function buildWater() {
  const shapes = [];
  for (const w of WATERS) for (const o of w.outer) {
    const sh = new THREE.Shape(o.map((q) => new THREE.Vector2(q[0], -q[1])));
    for (const h of w.inner) sh.holes.push(new THREE.Path(h.map((q) => new THREE.Vector2(q[0], -q[1]))));
    shapes.push(sh);
  }
  const geo = new THREE.ShapeGeometry(shapes);
  const N = 256, nc = mkCanvas(N, N), ng = nc.getContext('2d'), im = ng.createImageData(N, N);
  const hv = valueNoise(N, 8, 4, 2024), hgt = (x, y) => hv[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * 1.8, dy = (hgt(x, y + 1) - hgt(x, y - 1)) * 1.8, l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    im.data[i] = (-dx / l * 0.5 + 0.5) * 255; im.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; im.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; im.data[i + 3] = 255;
  }
  ng.putImageData(im, 0, 0);
  const normals = new THREE.CanvasTexture(nc); normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
  waterObj = new Water(geo, { textureWidth: QP.water, textureHeight: QP.water, waterNormals: normals, sunDirection: SUN.clone(), sunColor: 0xffffff, waterColor: 0x294739, distortionScale: 0.35, fog: true, alpha: 1 });
  waterObj.rotation.x = -Math.PI / 2; waterObj.position.y = 0.32; waterObj.material.uniforms.size.value = 1.2;
  const reflect = waterObj.onBeforeRender.bind(waterObj); let reflectionKey = '', reflectionStamp = 0;
  waterObj.onBeforeRender = (...args) => {
    const cam = args[2], now = performance.now(), key = [...cam.position.toArray(), ...cam.quaternion.toArray(), cam.aspect, hour].map(v => Math.round(v * 1000)).join(',') + season;
    if (FILMING || key !== reflectionKey || now - reflectionStamp > 180) { reflectionKey = key; reflectionStamp = now; reflect(...args); }
  };
  waterObj.material.fragmentShader = waterObj.material.fragmentShader.replace('vec3( 0.1 ) + reflectionSample', 'vec3( 0.025 ) + reflectionSample');
  scene.add(waterObj);
  waterSimple = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#27443f', roughness: 0.06, metalness: 0.15 }));
  waterSimple.rotation.x = -Math.PI / 2; waterSimple.position.y = 0.32; waterSimple.visible = false; scene.add(waterSimple);
  if (QUALITY === 'low') setWaterReflect(false);
  const ic = noiseCanvas(512, 6, 5, 404, 0, 255), icg = ic.getContext('2d'), id = icg.getImageData(0, 0, 512, 512);
  for (let i = 0; i < id.data.length; i += 4) { const v = id.data[i]; const a = clamp((v - 140) * 2.2, 0, 210); id.data[i] = 235 - (255 - v) * 0.12; id.data[i + 1] = 240 - (255 - v) * 0.1; id.data[i + 2] = 245; id.data[i + 3] = a; }
  icg.putImageData(id, 0, 0);
  const it = canvasTex(ic); it.repeat.set(1 / 120, 1 / 120);
  ICE = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: it, transparent: true, roughness: 0.3, metalness: 0.05, depthWrite: false }));
  ICE.rotation.x = -Math.PI / 2; ICE.position.y = 0.36; ICE.visible = false; ICE.renderOrder = 1; scene.add(ICE);
  buildLotus();
}
function buildLotus() {
  const pads = [], flowers = [];
  for (const w of WATERS) {
    const o = w.outer[0], area = Math.abs(pArea(o));
    const small = area < 26000, bb = w.bb;
    if (!small) continue;
    const n = Math.min(240, area / 24);
    const ring = o.concat([o[0]]), cum = cumLen(ring), L = cum[cum.length - 1];
    for (let i = 0; i < n; i++) {
      let x, z;
      { const q = sampleAt(ring, cum, (0.12 + rand() * 0.22) * L), cxp = (bb[0] + bb[2]) / 2, czp = (bb[1] + bb[3]) / 2, k = rr(0.015, 0.065); x = q.x + (cxp - q.x) * k; z = q.z + (czp - q.z) * k; }
      if (!inWater(x, z)) continue;
      pads.push([x, z, rr(0.35, 0.75), rand() * 6.28]);
      if (rand() < 0.08) flowers.push([x + rr(-0.4, 0.4), z + rr(-0.4, 0.4), rr(0.6, 1.1)]);
    }
  }
  const pg = new THREE.CircleGeometry(1, 14, 0.25, Math.PI * 2 - 0.5); pg.rotateX(-Math.PI / 2);
  const pm = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 }), pads.length);
  pads.forEach(([x, z, r, a], i) => { _e2.set(0, a, 0); _q2.setFromEuler(_e2); _m2.compose(_v2.set(x, 0.42, z), _q2, _s2.set(r, 1, r)); pm.setMatrixAt(i, _m2); pm.setColorAt(i, _c3.set(pick(['#36602a', '#3f6a2f', '#4a7534', '#2f5a28']))); });
  const fg = new THREE.ConeGeometry(0.22, 0.32, 6, 1, true); fg.translate(0, 0.16, 0);
  const fm = new THREE.InstancedMesh(fg, new THREE.MeshStandardMaterial({ color: '#f2a6c2', roughness: 0.6, side: THREE.DoubleSide }), Math.max(1, flowers.length));
  flowers.forEach(([x, z, h], i) => { _m2.compose(_v2.set(x, 0.42 + h * 0.2, z), _q2.identity(), _s2.set(1, 1, 1)); fm.setMatrixAt(i, _m2); });
  fm.count = flowers.length;
  pm.receiveShadow = true; pm.userData.leafOnly = true;
  LOTUS = [pm, fm]; for (const m of LOTUS) { m.visible = false; m.layers.set(1); scene.add(m); }
}
const _m2 = new THREE.Matrix4(), _q2 = new THREE.Quaternion(), _v2 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _e2 = new THREE.Euler(), _c3 = new THREE.Color();
function setWaterReflect(on) { waterObj.visible = on; waterSimple.visible = !on; $('#t-water').setAttribute('aria-pressed', String(on)); }

const PICKABLE = [];
function buildBuildings() {
  BLD.forEach((b, idx) => {
    OWNER = idx;
    const sp = b.cls.special;
    if (sp === 'library') buildLibrary(b);
    else if (sp === 'museum') buildMuseum(b);
    else if (sp === 'conference') buildConference(b);
    else if (sp === 'gym') buildGym(b);
    else if (sp === 'greenhouse') buildGreenhouse(b);
    else if (sp === 'station') buildStation(b);
    else if (sp === 'xueyuan') buildXueyuan(b);
    else if (sp === 'natatorium') buildNatatorium(b);
    else if (sp === 'admin') buildAdmin(b);
    else if (sp === 'graduate') buildGraduate(b);
    else if (sp === 'wende') buildWende(b);
    else if (sp === 'hdorm') buildHighDorm(b);
    else if (sp === 'construction') buildConstruction(b);
    else if (sp === 'gardenService') buildGardenService(b);
    else buildGeneric(b, idx);
  });
  OWNER = -1;
  for (const b of BLD) {
    const m = b.name.match(/学生第([一二])食堂/); if (!m) continue;
    const e = edgeFacing(b.p, b.c[0] - 60, b.c[1] + 60, 10); if (!e) continue;
    addSign(`${m[1]}食堂`, e.a[0] + e.dx * 2.2, b.h - 4.5, e.a[1] + e.dz * 2.2, e.nx, e.nz, 6.5, { vertical: true, color: '#e9e6dc', family: '"Noto Serif SC", serif', metal: 0.1, glow: '#fff3d6' });
    b.label = `${m[1]}食堂`;
  }
  for (const b of BLD) {
    const m = b.name.match(/^(求.楼)/); if (!m) continue;
    const e = (b.parts ? b.parts.slice(0, 2) : [b.p]).map((q) => edgeFacing(q, -300, -190, 10)).filter(Boolean).sort((u, v) => Math.hypot(u.mx + 300, u.mz + 190) - Math.hypot(v.mx + 300, v.mz + 190))[0]; if (!e) continue;
    addSign(m[1], e.a[0] + e.dx * 3 + e.nx * 0.1, Math.min(b.h - 5, (b.cls.fl || 5) * 4 - 4), e.a[1] + e.dz * 3 + e.nz * 0.1, e.nx, e.nz, 6, { vertical: true, color: '#f2efe6', metal: 0.1, glow: '#fff3d6' });
  }
}
function separateCoplanar() {
  const bufs = Object.values(BUFS), first = new Map(), clash = new Set();
  const keyOf = (B, o) => {
    const nx = B.n[o], ny = B.n[o + 1], nz = B.n[o + 2], d = nx * B.p[o] + ny * B.p[o + 1] + nz * B.p[o + 2];
    return ((Math.round(nx * 40) + 40) * 81 + Math.round(ny * 40) + 40) * 81 + Math.round(nz * 40) + 40 + 531441 * (Math.round(d * 40) + 400000);
  };
  bufs.forEach((B, bi) => {
    for (let i = 0, o = 0; o < B.p.length; i++, o += 9) {
      const k = keyOf(B, o), sub = bi * 100000 + B.o[i] + 1, f = first.get(k);
      if (f === undefined) first.set(k, sub); else if (f !== sub) clash.add(k);
    }
  });
  const groups = new Map();
  bufs.forEach((B, bi) => {
    const P = B.p;
    for (let i = 0, o = 0; o < P.length; i++, o += 9) {
      if (B.n[o + 1] > 0.99 && Math.abs(P[o + 1]) < 0.05 && Math.abs(P[o + 4]) < 0.05 && Math.abs(P[o + 7]) < 0.05) { P[o + 1] += 0.05; P[o + 4] += 0.05; P[o + 7] += 0.05; continue; }
      const k = keyOf(B, o); if (!clash.has(k)) continue;
      let g = groups.get(k); if (!g) groups.set(k, g = new Map());
      const sub = bi * 100000 + B.o[i] + 1; let e = g.get(sub); if (!e) g.set(sub, e = { area: 0, tris: [] });
      const ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2], vx = P[o + 6] - P[o], vy = P[o + 7] - P[o + 1], vz = P[o + 8] - P[o + 2];
      e.area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); e.tris.push(B, o);
    }
  });
  for (const g of groups.values()) {
    [...g.values()].sort((a, b) => b.area - a.area).forEach((e, r) => {
      if (!r) return;
      const off = 0.035 * r;
      for (let t = 0; t < e.tris.length; t += 2) {
        const B = e.tris[t], o = e.tris[t + 1];
        for (let v = 0; v < 9; v += 3) { B.p[o + v] += B.n[o] * off; B.p[o + v + 1] += B.n[o + 1] * off; B.p[o + v + 2] += B.n[o + 2] * off; }
      }
    });
  }
}
function flushBuffers() {
  separateCoplanar();
  for (const [k, B] of Object.entries(BUFS)) {
    if (!B.p.length) continue;
    let m = MAT[k] || MAT[k.replace(/^f:/, 'f:')];
    if (!m) {
      if (k === 'glass:roof') m = MAT.glassRoof ||= new THREE.MeshStandardMaterial({ color: '#9fc1cc', roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.75 });
      else if (k === 'villaRoof') m = MAT.villaRoof ||= plainMat('#8f4b39', { roughness: 0.8, side: THREE.DoubleSide });
      else m = MAT[k] || plainMat('#bbbbbb');
    }
    const mesh = new THREE.Mesh(B.geo(), m);
    const transparent = m.transparent;
    mesh.castShadow = !transparent; mesh.receiveShadow = true;
    mesh.userData.owner = Int32Array.from(B.o);
    scene.add(mesh); PICKABLE.push(mesh);
  }
  scene.add(SIGNS);
}

const LABELS = [];
const PLACES = [];
let labelsOn = true, selected = null;
function addLabel(text, x, y, z, o) {
  const el = document.createElement('div'); el.className = 'lbl off ' + (o.cls || '');
  el.style.setProperty('--c', o.color);
  const pin = elt('div', 'pin'), glyph = elt('span', 'glyph'); glyph.appendChild(svgIcon(o.icon)); pin.append(glyph, elt('span', 't', text)); el.appendChild(pin);
  el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  el.addEventListener('click', (ev) => { ev.stopPropagation(); o.onClick && o.onClick(); });
  const obj = new CSS2DObject(el); obj.center.set(0, 0); obj.position.set(x, y, z); scene.add(obj);
  const L = { el, pin: el.firstChild, obj, max: o.max || 900, place: o.place, prio: o.prio || 1, kind: /water/.test(o.cls) ? 'water' : /unit/.test(o.cls) ? 'unit' : 'poi', shown: false }; LABELS.push(L); return L;
}
function buildPlaces() {
  const seen = new Set();
  const dormGroups = {};
  BLD.forEach((b, i) => {
    const m = b.name.match(/^(文.苑)/);
    if (m) { (dormGroups[m[1]] ||= []).push(i); return; }
    const label = b.label || b.cls.label;
    if (!label || seen.has(label)) return; seen.add(label);
    const cat = b.cls.cat || 'teach';
    const major = /图书馆|行政楼|学院实验楼|体育馆|药学博物馆|食堂|教学楼|游泳馆/.test(label);
    PLACES.push({ name: label, cat, bld: [i], x: b.c[0], z: b.c[1], h: b.h, major, inferred: /inferred/.test(b.src || '') });
  });
  BLD.forEach((b, i) => { if (b.extra?.nolabel && b.name) { const p = PLACES.find((q) => q.name === b.name); if (p) p.bld.push(i); } });
  for (const [g, idx] of Object.entries(dormGroups)) {
    let x = 0, z = 0; idx.forEach((i) => { x += BLD[i].c[0]; z += BLD[i].c[1]; });
    PLACES.push({ name: g, cat: 'life', bld: idx, x: x / idx.length, z: z / idx.length, h: 22, dorm: true, sub: `学生公寓 · ${idx.length} 栋` });
  }
  const jing = WATERS.find((w) => w.name === '镜湖'), ming = WATERS.find((w) => w.name === '明湖');
  const wc = (w) => pCentroid(w.outer[0]);
  if (jing) { const [x, z] = wc(jing); PLACES.push({ name: '镜湖', cat: 'scenic', x, z, h: 2, water: true, sub: '正门内的景观湖', desc: '进入正门即可看到镜湖。湖面倒映着图书馆与行政楼，岸边遍植垂柳与樱花，西南湖湾有阶梯式亲水平台，湖中三座小岛。', src: '水体与岛屿：OpenStreetMap；景观：去哪儿网游记、校园航拍', area: Math.abs(pArea(jing.outer[0])) }); }
  if (ming) { const [x, z] = wc(ming); PLACES.push({ name: '明湖', cat: 'scenic', x, z, h: 2, water: true, sub: '学院实验楼东侧的带状湖', desc: '自西北向东南蜿蜒的带状湖泊，东临实训楼与综合研发楼，西接学院实验楼的弧形办公翼；湖心有岛，北岸有一条蓝色健身步道。', src: '水体：OpenStreetMap；步道：卫星影像', area: Math.abs(pArea(ming.outer[0])) }); }
  PLACES.push({ name: '校内河道', cat: 'scenic', x: 60, z: -60, h: 2, sub: '贯穿校园的景观河', desc: '河道分隔教学区与学生公寓区，两岸是科研楼群与垂柳，车行桥和白色步行桥跨河而过。', src: '水体：OpenStreetMap；景观：去哪儿网实拍' });
  PLACES.push({ name: '正门', cat: 'gate', x: GATE.x, z: GATE.z, h: 6, major: true, sub: '龙眠大道 639 号', desc: '面向龙眠大道的主入口，门外即南京地铁 1 号线终点站“中国药科大学”站。校名石墙刻官方书法“中国药科大学”，墙后七根灯柱高低错落；两条车道夹着中轴，三座方框圆洞景墙“连中三元”沿中轴通向镜湖与图书馆。', src: '闸机与大门位置：OpenStreetMap；外观：去哪儿网实拍、“学习强国”图片' });
  const garden = D.g.filter((q) => q.k === 'grass' || q.k === 'meadow').map((q) => ({ q, c: pCentroid(q.p) })).filter(({ c }) => c[0] > 150 && c[1] < -600)[0];
  PLACES.push({ name: '药用植物园', cat: 'scenic', x: garden ? garden.c[0] : 320, z: garden ? garden.c[1] : -720, h: 4, major: true, sub: '校园北部，分东、西两区', desc: '药大最具特色的校园景观，栽培多种药用植物，东区有展示温室与管理用房，园内水塘曲径相连。', src: '位置：OpenStreetMap；简介：去哪儿网游记' });
  if (STADIUM) PLACES.push({ name: '体育场', cat: 'sport', x: STADIUM.cx, z: STADIUM.cz, h: 6, major: true, sub: '400 米田径场', desc: INFO['体育场'].d, src: INFO['体育场'].s });
  const tennis = COURTS.find((c) => c.type === 'tennis'); if (tennis) PLACES.push({ name: '网球场', cat: 'sport', x: tennis.ob.cx, z: tennis.ob.cz, h: 3, sub: '六片硬地球场' });
  const bb = COURTS.filter((c) => c.type === 'basketball'); if (bb.length) { const x = bb.reduce((a, c) => a + c.ob.cx, 0) / bb.length, z = bb.reduce((a, c) => a + c.ob.cz, 0) / bb.length; PLACES.push({ name: '篮球场', cat: 'sport', x, z, h: 3, sub: `${bb.length} 片室外球场` }); }
  PLACES.push({ name: '龙眠大道', cat: 'transit', x: -520, z: 330, h: 4, sub: '地铁 1 号线高架沿路而行' });
  mapNames();
  for (const p of PLACES) {
    p.icon = iconFor(p); p.color = placeColor(p);
    p.label = addLabel(p.name, p.x, (p.h || 10) + (p.unit ? 1.5 : p.water ? 1 : 3), p.z, { cls: p.unit ? 'unit' : p.water ? 'water' : p.major ? 'major' : p.dorm ? '' : 'minor', color: p.color, icon: p.icon, max: p.unit ? 480 : p.major || p.water ? 2600 : p.dorm ? 1100 : 750, onClick: () => select(p), place: p, prio: /^图书馆$/.test(p.name) ? 12 : /^(正门|兴药楼|镜湖)$/.test(p.name) ? 11 : p.major ? 10 : p.water ? 9 : p.dorm ? 5 : p.unit ? 2 : 3 });
  }
}
const DORM_LETTER = { 文轩苑: 'A', 文菁苑: 'B', 文萃苑: 'C', 文澜苑: 'D', 文枢苑: 'E', 文昌苑: 'F', 文思苑: 'G', 文华苑: 'H', 文正苑: 'H' };
const MAP_NAMES = {
  学院实验楼: ['兴药楼', '新大楼 · 一期 / 二期（学院实验楼）'], 会议中心: ['大礼堂', '学术报告厅 · 会议中心'], 同位素楼: ['核药中心'],
  '新建科研楼 A': ['成药性评价中心'], '新建科研楼 B': ['动物中心'], '新建科研楼 C': ['临床中心'], 综合门诊楼: ['医务室', '综合门诊楼'],
  理学楼: ['A 理学楼'], 分析楼: ['B 分析楼'], 化学楼: ['C 化学楼'], 生命科学楼: ['D 生命科学楼'], 中药科学楼: ['E 中药科学楼'], 药学科学楼: ['F 药学科学楼'], 综合研发楼: ['G 综合研发楼'],
  文德苑: ['文德苑', '研究生公寓'],
};
function mapNames() {
  for (const p of PLACES) {
    const t = MAP_NAMES[p.name]; if (t) { p.name = t[0]; if (t[1]) p.sub = t[1]; }
    const m = p.name.match(/^教学楼([A-E]) · (求.楼)$/); if (m) { p.name = `${m[1]} ${m[2]}`; p.sub = `教学楼 ${m[1]}`; }
  }
  const groups = {};
  BLD.forEach((b, i) => {
    const m = b.name.match(/^(文.苑)(\d+)(?:、(\d+))?号楼/); if (!m || !DORM_LETTER[m[1]]) return;
    const code = DORM_LETTER[m[1]] + m[2] + (m[3] ? '·' + DORM_LETTER[m[1]] + m[3] : '');
    b.code = code; ((groups[code] ||= { g: m[1], n: m[2] + (m[3] ? '、' + m[3] : ''), idx: [] }).idx).push(i);
  });
  for (const [code, u] of Object.entries(groups)) {
    const bs = u.idx.map((i) => BLD[i]), x = bs.reduce((a, b) => a + b.c[0], 0) / bs.length, z = bs.reduce((a, b) => a + b.c[1], 0) / bs.length;
    PLACES.push({ name: code, cat: 'life', bld: u.idx, x, z, h: Math.max(...bs.map((b) => b.h)), unit: true, sub: `${u.g} ${u.n} 号楼 · 学生公寓` });
  }
  for (const p of PLACES) {
    if (!p.dorm) continue;
    const L = DORM_LETTER[p.name], codes = p.bld.map((i) => BLD[i].code).filter(Boolean);
    if (L === 'H') { const ns = codes.map((c) => c.match(/\d+/g)).flat().map(Number); p.name = `H${Math.min(...ns)}–${Math.max(...ns)} ${p.name}`; }
    else if (L) p.name = `${L} ${p.name}`;
    if (codes.length) p.sub = `学生公寓 · ${p.bld.length} 栋 · ${codes.join(' ')}`;
  }
  const med = BLD.findIndex((b) => !b.name && Math.hypot(b.c[0] - 301, b.c[1] - 114) < 12);
  if (med >= 0) { BLD[med].name = '医学楼'; PLACES.push({ name: '医学楼', cat: 'teach', bld: [med], x: BLD[med].c[0], z: BLD[med].c[1], h: BLD[med].h }); }
  const pt = (name, cat, x, z, h, sub, extra) => PLACES.push(Object.assign({ name, cat, x, z, h, sub, src: '名称与位置：校园地图标注；三维位置按地图换算，约略示意' }, extra));
  pt('北门', 'gate', 169, -905, 4, '晚 7 点关闭', { major: true });
  pt('西门', 'gate', -440, -323, 4, '西侧围墙门');
  pt('东门', 'gate', 520, 15, 4, '东侧围墙门，临医务室');
  pt('东南门', 'gate', 46, 595, 4, '体育场东侧');
  pt('菜鸟驿站', 'life', 316, -283, 6, '快递收发 · 文思苑西侧');
  pt('警务室', 'life', 330, -82, 6, '校园警务室 · 文枢苑与文昌苑之间');
  pt('樱花大道', 'scenic', 318, -505, 4, '河畔樱花步道');
  pt('旧馆', 'sport', 150, 590, 10, '体育场西看台');
  pt('1936广场', 'scenic', LIB_PLAZA.x, LIB_PLAZA.z, 3, '图书馆前广场', { major: true, desc: '图书馆正前方的大广场，以建校的 1936 年命名。大方格石材铺装，西侧临草坪处立有一根国旗旗杆，裙楼前一排方形树池，临湖一侧有景观石。' });
  const lib = BLD.findIndex((b) => b.name === '图书馆');
  if (lib >= 0) pt('药大文创', 'life', BLD[lib].c[0] - 16, BLD[lib].c[1] + 4, 6, '图书馆二楼', { bld: [lib], desc: '药大文创位于图书馆二楼。' });
}
function placeFacts(p) {
  const facts = [];
  if (p.bld) {
    const bs = p.bld.map((i) => BLD[i]);
    const area = bs.reduce((a, b) => a + b.area, 0), h = Math.max(...bs.map((b) => b.h));
    const fl = bs[0].cls.fl;
    if (!p.dorm) facts.push(['层数', bs[0].cls.special === 'gym' ? '大空间' : `${fl} 层`]);
    facts.push(['高度', `${Math.round(h)} m`]);
    facts.push(['占地', `${Math.round(area).toLocaleString('zh-CN')} m²`]);
  }
  if (p.area) facts.push(['水面', `${Math.round(p.area).toLocaleString('zh-CN')} m²`]);
  return facts;
}
function select(p) {
  selected = p;
  for (const L of LABELS) L.el.classList.toggle('sel', L.place === p);
  $('#info').hidden = false;
  $('#infoName').textContent = p.name;
  const bs = p.bld ? p.bld.map((i) => BLD[i]) : [];
  const info = INFO[p.name] || INFO[bs[0]?.name] || null;
  let sub = p.sub || '';
  if (!sub && bs[0]) { const raw = bs[0].name; sub = raw && raw !== p.name && !/^学生第/.test(raw) ? raw.split(' / ')[1] || '' : ''; }
  const parts = [CATS[p.cat]?.name]; if (sub) parts.push(sub); if (p.inferred) parts.push('位置为推断');
  $('#infoSub').textContent = parts.join(' · ');
  let desc = p.desc || info?.d || '';
  if (!desc && /求.楼|教学楼/.test(p.name)) desc = TEACH_DESC;
  if (!desc && /科学楼|化学楼|分析楼|理学楼|经管文楼/.test(p.name)) desc = LAB_DESC;
  if (!desc && p.dorm) desc = DORM_DESC;
  $('#infoDesc').textContent = desc;
  const facts = placeFacts(p), [lat, lon] = toLL(p.x, p.z);
  const cell = (k, v, wide) => { const d = elt('div'); if (wide) d.style.gridColumn = 'span 2'; d.append(elt('span', '', k), elt('b', '', v)); return d; };
  $('#infoFacts').replaceChildren(...facts.map(([k, v], i) => cell(k, v, facts.length % 2 && i === facts.length - 1)), cell('坐标', `${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E`, true));
  let src = p.src || info?.s || '轮廓：OpenStreetMap';
  if (bs.some((b) => /inferred/.test(b.src))) src += '。名称与位置为推断，以学校公布为准。';
  else if (bs.some((b) => b.src === 'sat')) src += '。OpenStreetMap 未收录，按卫星影像补建。';
  $('#infoSrc').textContent = src;
  highlight(p);
  root.querySelectorAll('.row').forEach((el) => el.setAttribute('aria-current', String(el.dataset.name === p.name)));
}
let HL = null;
function highlight(p) {
  if (HL) { scene.remove(HL); HL.traverse((o) => o.geometry?.dispose()); const k = NO_AO.indexOf(HL); if (k >= 0) NO_AO.splice(k, 1); HL = null; }
  if (!p.bld) return;
  const own = new Set(p.bld), pos = [], line = [];
  for (const m of PICKABLE) {
    const ow = m.userData.owner, P = m.geometry.attributes.position.array;
    for (let i = 0; i < ow.length; i++) if (own.has(ow[i])) for (let k = 0; k < 9; k++) pos.push(P[i * 9 + k]);
  }
  for (const i of p.bld) {
    const b = BLD[i];
    for (const q of b.extra?.special === 'xueyuan' ? XY_PODS.map((d) => d.p) : b.parts || [b.p]) for (let k = 0; k < q.length; k++) { const a = q[k], c = q[(k + 1) % q.length]; line.push(a[0], 0.35, a[1], c[0], 0.35, c[1]); }
  }
  HL = new THREE.Group();
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#2f8cff', transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
  const edge = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#0a84ff', transparent: true, opacity: 0.9 }));
  HL.add(fill, edge); HL.material = fill.material; HL.renderOrder = 10; HL.userData.t0 = performance.now(); scene.add(HL); NO_AO.push(HL);
}
function buildPlaceList() {
  const list = $('#placeList'), order = ['gate', 'teach', 'life', 'scenic', 'sport', 'transit'];
  const render = (q = '') => {
    list.replaceChildren();
    for (const cat of order) {
      const Q = q.toUpperCase(), items = PLACES.filter((p) => p.cat === cat && (q ? p.name.toUpperCase().includes(Q) || (p.sub || '').includes(q) || (p.bld && p.bld.some((i) => BLD[i].name.includes(q))) : !p.unit));
      if (!items.length) continue;
      const h = document.createElement('h3'); h.textContent = CATS[cat].name; list.appendChild(h);
      items.sort((a, b) => (b.major ? 1 : 0) - (a.major ? 1 : 0) || a.name.localeCompare(b.name, 'zh-CN'));
      for (const p of items) {
        const btn = document.createElement('button'); btn.className = 'row'; btn.dataset.name = p.name;
        const meta = p.dorm ? `${p.bld.length} 栋` : p.bld ? `${Math.round(Math.max(...p.bld.map((i) => BLD[i].h)))} m` : '';
        const glyph = elt('span', 'glyph'); glyph.style.setProperty('--c', p.color); glyph.appendChild(svgIcon(p.icon));
        btn.append(glyph, elt('span', 'name', p.name), elt('span', 'meta', meta));
        btn.addEventListener('click', () => { select(p); flyToPlace(p); if (innerWidth <= 760 || innerHeight <= 500) setSidebar(false); });
        list.appendChild(btn);
      }
    }
  };
  render(); $('#q').addEventListener('input', (e) => render(e.target.value.trim()));
}

let mode = 'orbit', tween = null, spin = null;
const _Y = new THREE.Vector3(0, 1, 0);
function flyTo(pos, tgt, dur = 1.8, done) {
  camera.userData.reviewLock = false; spin = null;
  if (REDUCED_MOTION.matches) dur = 0.001;
  tween = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: tgt.clone(), done };
}
function viewFor(p) {
  const r = p.bld ? Math.max(...p.bld.map((i) => Math.hypot(BLD[i].bb[2] - BLD[i].bb[0], BLD[i].bb[3] - BLD[i].bb[1]))) : 120;
  const spread = p.dorm ? 160 : 0, h = p.h || 10;
  const dist = clamp(r * 1.5 + h * 1.6 + spread + 40, 70, 650);
  const dir = camera.position.clone().sub(controls.target); dir.y = 0; if (dir.lengthSq() < 1) dir.set(-1, 0, 1); dir.normalize();
  const tgt = new THREE.Vector3(p.x, h * 0.35, p.z);
  const pos = tgt.clone().addScaledVector(dir, dist * Math.cos(0.72)).add(new THREE.Vector3(0, dist * Math.sin(0.72), 0));
  return { pos, tgt };
}
function flyToPlace(p) { if (mode === 'walk') { walkToPlace(p); return; } if (mode === 'tour') setMode('orbit'); const v = viewFor(p); flyTo(v.pos, v.tgt, 2.2, () => { spin = { t: 0 }; }); }

const BGRID = new Grid(25);
const PGRID = new Grid(25);
function initGrid() {
  BLD.forEach((b, i) => BGRID.add(i, b.bb));
  PROPS.forEach((q, i) => { q.bb = pBox(q.p); q.skip = groundAt(q.c[0], q.c[1]) > 0.02; if (!q.skip) PGRID.add(i, q.bb); });
}
function camFloor(x, z) {
  let top = groundAt(x, z);
  for (const [ox, oz] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) {
    const px = x + ox, pz = z + oz;
    for (const k of BGRID.at(px, pz)) { const b = BLD[k]; if (b.h > top && px >= b.bb[0] && px <= b.bb[2] && pz >= b.bb[1] && pz <= b.bb[3] && (b.parts || [b.p]).some((q) => pip(px, pz, q))) top = b.h; }
  }
  return top + 1.8;
}
// ---------- free exploration (first person) ----------
// An FPS controller: pointer-lock mouse look, Quake/Source-style ground friction and acceleration, jump with
// coyote time and input buffering, crouch, sprint, stepping onto low props, head bob, landing dip, sprint FOV
// kick and synthesized footsteps. Touch gets a floating stick on the left and look-drag on the right.
const WALK = {
  x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, ground: true, air: 0, jumpBuf: 0, crouch: 0, crouchOn: false,
  keys: new Set(), pad: { x: 0, y: 0 }, padRun: false, fov: 72, zoom: 0, zoomOn: false, trans: null, faceYaw: null,
  ph: 0, bobA: 0, stepY: 0, land: 0, landV: 0, roll: 0, kick: 0, sprint: false,
  locked: false, unlockT: 0, inspect: false, noLock: TOUCH || !('requestPointerLock' in HTMLElement.prototype),
  sound: !TOUCH, sens: 0.0022, aim: null, aimOwn: -1, aimT: 0,
};
const WALK_R = 0.38, EYE = 1.65, EYE_LOW = 1.05, STEP_UP = 0.5, WALK_FOV = 72;
const MOVE = { run: 4.8, sprint: 8, crouch: 2.2, accel: 11, air: 1.8, friction: 7.5, stop: 2.2, gravity: 19, jump: 5.4 };
// Walls around (x, z) for a walker whose feet are at height `feet`: buildings always, props only when taller than a step.
function walkPolys(x, z, feet = groundAt(x, z)) {
  const out = [];
  for (const k of BGRID.at(x, z)) {
    const b = BLD[k];
    if (b.cls.special === 'station' || x < b.bb[0] - 3 || x > b.bb[2] + 3 || z < b.bb[1] - 3 || z > b.bb[3] + 3) continue;
    if (b.extra?.special === 'xueyuan') { for (const q of XY_PODS) out.push(q.p); for (const q of XY_LINKS) out.push(q); continue; }
    for (const q of b.parts || [b.p]) out.push(q);
  }
  for (const k of PGRID.at(x, z)) {
    const q = PROPS[k];
    if (q.top <= feet + STEP_UP || x < q.bb[0] - 2 || x > q.bb[2] + 2 || z < q.bb[1] - 2 || z > q.bb[3] + 2) continue;
    out.push(q.p);
  }
  return out;
}
function nearestOnPoly(x, z, q) {
  let md = Infinity, mx = 0, mz = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], e = q[(i + 1) % q.length], ex = e[0] - a[0], ez = e[1] - a[1];
    const t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1), 0, 1), px = a[0] + ex * t, pz = a[1] + ez * t, d = Math.hypot(x - px, z - pz);
    if (d < md) { md = d; mx = px; mz = pz; }
  }
  return [md, mx, mz];
}
let TGRID = null;
// Collision radius of a tree: its trunk, or for a bush the dense middle of its crown.
const trunkR = (t) => t.type === 'shrub' ? SPECIES.shrub.rx * t.s * 0.5 : SPECIES[t.type].tr * t.s;
function trunkGrid() {
  TGRID = new Grid(10);
  TREES.forEach((t, i) => { const r = trunkR(t), e = r + WALK_R + 0.4; if (r > 0.05) TGRID.add(i, [t.x - e, t.z - e, t.x + e, t.z + e]); });
  LAMP_POS.forEach(([x, z], i) => { const e = 0.12 + WALK_R + 0.4; TGRID.add(~i, [x - e, z - e, x + e, z + e]); });
}
// Push a walker circle out of every wall and trunk it overlaps; moving into one therefore slides along it.
function walkResolve(x, z, feet, RR = WALK_R) {
  if (!TGRID) trunkGrid();
  for (let it = 0; it < 3; it++) {
    let moved = false;
    for (const k of TGRID.at(x, z)) {
      let cx, cz, R;
      if (k < 0) { [cx, cz] = LAMP_POS[~k]; R = 0.12 + RR; }
      else { const t = TREES[k]; if (t.type === 'shrub' && feet != null && feet > 0.8 * t.s) continue; cx = t.x; cz = t.z; R = trunkR(t) + RR + (t.type === 'shrub' ? 0 : 0.12); }
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      if (d >= R) continue;
      const a = d > 1e-4 ? 1 / d : 0; x = cx + (a ? dx * a : 1) * (R + 0.01); z = cz + dz * a * (R + 0.01); moved = true;
    }
    // parked cars are solid boxes (4.6 x 1.8 m) for walkers and for the car being driven
    if (CARS) for (let k = 0; k < CARS.parkedM.length; k++) {
      if (k === CARS.taken) continue;
      const e = CARS.parkedM[k].elements, cx = e[12], cz = e[14];
      if (Math.abs(x - cx) > 3.6 || Math.abs(z - cz) > 3.6) continue;
      const ca = e[0], sa = e[2], dx = x - cx, dz = z - cz, hx = 2.3 + RR, hz = 0.92 + RR;
      let lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
      if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) continue;
      if (hx - Math.abs(lx) < hz - Math.abs(lz)) lx = (lx < 0 ? -1 : 1) * (hx + 0.01); else lz = (lz < 0 ? -1 : 1) * (hz + 0.01);
      x = cx + lx * ca - lz * sa; z = cz + lx * sa + lz * ca; moved = true;
    }
    for (const q of walkPolys(x, z, feet)) {
      const [d, mx, mz] = nearestOnPoly(x, z, q), inside = pip(x, z, q);
      if (!inside && d >= RR) continue;
      let nx = x - mx, nz = z - mz; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      if (inside) { nx = -nx; nz = -nz; }
      x = mx + nx * (RR + 0.01); z = mz + nz * (RR + 0.01); moved = true;
    }
    if (!moved) break;
  }
  return [x, z];
}
const onBridge = (x, z) => BRIDGES.some((b) => pip(x, z, b.p));
const inRegion = (x, z) => x > REG.x0 + 5 && x < REG.x1 - 5 && z > REG.z0 + 5 && z < REG.z1 - 5;
const walkable = (x, z) => inRegion(x, z) && (!inWater(x, z) || onBridge(x, z));
// Lakes are 3.4 m deep below a surface at WATER_Y; in winter they are frozen and carry the walker on the ice.
const WATER_Y = 0.32, LAKE_BED = -3.4;
const frozen = () => Boolean(ICE && ICE.visible);
const isWet = (x, z) => inWater(x, z) && !onBridge(x, z) && !frozen();
// A swimmer can climb out onto the bank only from near the surface, not from the lake bed.
const canStand = (x, z) => inRegion(x, z) && (isWet(x, z) || !WALK.swim || WALK.y > -1.7);
function walkMove(dx, dz) {
  const f = WALK.y;
  let [nx, nz] = walkResolve(WALK.x + dx, WALK.z + dz, f);
  if (!canStand(nx, nz)) {
    const ax = walkResolve(WALK.x + dx, WALK.z, f), az = walkResolve(WALK.x, WALK.z + dz, f);
    if (Math.abs(dx) > 1e-4 && canStand(ax[0], ax[1])) [nx, nz] = ax;
    else if (Math.abs(dz) > 1e-4 && canStand(az[0], az[1])) [nx, nz] = az;
    else return;
  }
  WALK.x = nx; WALK.z = nz;
}
// Highest surface under the walker it can stand on: terrain, bridges, steps, or a prop no taller than a step above the feet.
function floorAt(x, z, feet) {
  if (inWater(x, z) && !onBridge(x, z)) return frozen() ? 0.36 : LAKE_BED;
  let y = groundAt(x, z);
  const r = WALK_R * 0.6;
  for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    const px = x + ox, pz = z + oz;
    for (const k of PGRID.at(px, pz)) {
      const q = PROPS[k];
      if (q.top > y && q.top <= feet + STEP_UP && px >= q.bb[0] && px <= q.bb[2] && pz >= q.bb[1] && pz <= q.bb[3] && pip(px, pz, q.p)) y = q.top;
    }
  }
  return y;
}
function walkSpot(x, z) {
  for (let r = 0; r < 200; r += 2) {
    const n = r ? Math.ceil(r * 1.2) : 1;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, [qx, qz] = walkResolve(px, pz);
      if (Math.hypot(qx - px, qz - pz) < 0.05 && walkable(px, pz)) return [px, pz];
    }
  }
  return [x, z];
}
const walkForward = () => [-Math.sin(WALK.yaw), -Math.cos(WALK.yaw)];
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function enterWalk(x, z, yaw, o = {}) {
  [x, z] = walkSpot(x, z);
  const from = camera.position.clone(), q0 = camera.quaternion.clone(), fov0 = camera.fov, y = groundAt(x, z);
  Object.assign(WALK, { x, z, y, yaw, pitch: o.pitch ?? -0.04, vx: 0, vz: 0, vy: 0, ground: true, air: 0, jumpBuf: 0, faceYaw: null, stepY: 0, land: 0, landV: 0, roll: 0, swim: false });
  const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(WALK.pitch, yaw, 0, 'YXZ'));
  WALK.trans = o.instant || REDUCED_MOTION.matches ? null : { t: 0, dur: o.dur || 1.5, p0: from, q0, q1, fov0, lift: Math.min(90, from.distanceTo(new THREE.Vector3(x, y + EYE, z)) * 0.25) };
}
// Drop the walker where the view was centred, stepping back toward the camera until the way ahead is open.
function walkEntry() {
  const t = controls.target, d = new THREE.Vector3(); camera.getWorldDirection(d);
  let dx = d.x, dz = d.z, l = Math.hypot(dx, dz);
  if (l < 0.12) { dx = 0; dz = -1; l = 1; }
  dx /= l; dz /= l;
  const yaw = Math.atan2(-dx, -dz);
  const open = (x, z) => {
    for (let s = 0; s <= 14; s += 2) {
      const px = x + dx * s, pz = z + dz * s, [qx, qz] = walkResolve(px, pz);
      if (Math.hypot(qx - px, qz - pz) > 0.05 || !walkable(px, pz)) return false;
    }
    return true;
  };
  for (let back = 0; back <= 180; back += 4) { const x = t.x - dx * back, z = t.z - dz * back; if (open(x, z)) return { x, z, yaw }; }
  return { x: t.x, z: t.z, yaw };
}
// Distance from (x, z) to the nearest building wall within `r` metres (r when none is that close).
function wallGap(x, z, r = 20) {
  let m = r;
  for (const b of BLD) {
    if (b.cls.special === 'station' || x < b.bb[0] - r || x > b.bb[2] + r || z < b.bb[1] - r || z > b.bb[3] + r) continue;
    const ps = b.extra?.special === 'xueyuan' ? XY_PODS.map((q) => q.p).concat(XY_LINKS) : b.parts || [b.p];
    for (const q of ps) { if (pip(x, z, q)) return 0; m = Math.min(m, nearestOnPoly(x, z, q)[0]); }
  }
  return m;
}
// Eye-level rays against the static scene (instanced trees, bikes and lamps ignored): the building ahead must not be
// much closer than planned, and nothing may crowd the walker from the sides or behind.
const SIGHT_RAY = new THREE.Raycaster();
// No trunk, bush or lamp post right in the face, and none within the first metres of the view.
function openAround(x, z, fx, fz) {
  if (!TGRID) trunkGrid();
  const seen = new Set();
  for (let s = 0; s <= 9; s += 1.5) for (const k of TGRID.at(x + fx * s, z + fz * s)) {
    if (seen.has(k)) continue; seen.add(k);
    let cx, cz, r;
    if (k < 0) { [cx, cz] = LAMP_POS[~k]; r = 0.15; } else { const t = TREES[k]; cx = t.x; cz = t.z; r = t.type === 'shrub' ? SPECIES.shrub.rx * t.s : trunkR(t); }
    const dx = cx - x, dz = cz - z, along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
    if (Math.hypot(dx, dz) < r + 2.2) return false;
    if (along > 0 && along < 9 && side < r + 1.4) return false;
  }
  return true;
}
function sightOK(x, z, fx, fz, dist) {
  const o = new THREE.Vector3(x, groundAt(x, z) + EYE, z), hitAt = (dx, dz, far) => {
    SIGHT_RAY.set(o, new THREE.Vector3(dx, 0, dz)); SIGHT_RAY.far = far;
    const h = SIGHT_RAY.intersectObjects(scene.children, true).find((q) => q.object.isMesh && !q.object.isInstancedMesh && q.object.visible && q.object.layers.test(camera.layers));
    return h ? h.distance : far;
  };
  // open sky overhead: seen from above, the first solid surface must be the ground, not a roof the walker would stand under
  SIGHT_RAY.set(new THREE.Vector3(x, 150, z), new THREE.Vector3(0, -1, 0)); SIGHT_RAY.far = 160;
  for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    SIGHT_RAY.ray.origin.set(x + ox, 150, z + oz);
    const top = SIGHT_RAY.intersectObjects(scene.children, true).find((q) => q.object.isMesh && !q.object.isInstancedMesh && q.object.visible && q.object.layers.test(camera.layers));
    if (top && top.point.y > groundAt(x + ox, z + oz) + 1.2) return false;
  }
  if (hitAt(fx, fz, dist) < Math.min(dist * 0.6, dist - 6)) return false;
  for (const [dx, dz, need] of [[fz, -fx, 3], [-fz, fx, 3], [-fx, -fz, 2.5], [(fx + fz) * 0.707, (fz - fx) * 0.707, 3], [(fx - fz) * 0.707, (fz + fx) * 0.707, 3]]) if (hitAt(dx, dz, need) < need) return false;
  return true;
}
// Where to stand to look at a place: in front of its main face, backed off until the wall is comfortably far away
// and nothing (wall, bush, post, water) is in the way of the first steps.
function placeFront(p) {
  let x, z, nx, nz;
  const e = p.bld ? edgeFacing(BLD[p.bld[0]].p, BLD[p.bld[0]].c[0] - 100, BLD[p.bld[0]].c[1] + 100, 6) : null;
  if (e) { x = e.mx; z = e.mz; nx = e.nx; nz = e.nz; }
  else { const dx = WALK.x - p.x, dz = WALK.z - p.z, l = Math.hypot(dx, dz) || 1; x = p.x; z = p.z; nx = dx / l; nz = dz / l; }
  const yaw = Math.atan2(nx, nz), h = p.bld ? Math.max(...p.bld.map((i) => BLD[i].h)) : 10, want = clamp(h * 0.7, 12, 30);
  const clear = (px, pz) => { const [qx, qz] = walkResolve(px, pz); return Math.hypot(qx - px, qz - pz) < 0.05 && walkable(px, pz); };
  // straight out from the face first, then swinging round to either side, always looking back at the face
  for (const da of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
    const c = Math.cos(da), sn = Math.sin(da), ux = nx * c - nz * sn, uz = nx * sn + nz * c;
    for (let s = Math.max(10, want * (da ? 0.8 : 1)); s <= 70; s += 2) {
      const px = x + ux * s, pz = z + uz * s;
      if (clear(px, pz) && wallGap(px, pz, 8) >= 8 && openAround(px, pz, -ux, -uz) && sightOK(px, pz, -ux, -uz, s)) return { x: px, z: pz, yaw: Math.atan2(ux, uz) };
    }
  }
  // boxed in on that side (a courtyard or forecourt): circle the place itself and take the first open spot facing it
  const cx = p.bld ? BLD[p.bld[0]].c[0] : p.x, cz = p.bld ? BLD[p.bld[0]].c[1] : p.z;
  for (let r = 24; r <= 110; r += 6) for (let i = 0; i < 24; i++) {
    const a = Math.atan2(nz, nx) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 12, ux = Math.cos(a), uz = Math.sin(a), px = cx + ux * r, pz = cz + uz * r;
    if (clear(px, pz) && wallGap(px, pz, 8) >= 8 && openAround(px, pz, -ux, -uz) && sightOK(px, pz, -ux, -uz, r)) return { x: px, z: pz, yaw: Math.atan2(ux, uz) };
  }
  return { x: x + nx * want, z: z + nz * want, yaw };
}
function walkToPlace(p) {
  if (DRIVE.on) exitCar();
  if (RIDE.on) exitBike();
  const f = placeFront(p);
  enterWalk(f.x, f.z, f.yaw, { dur: Math.hypot(f.x - WALK.x, f.z - WALK.z) > 220 ? 1.8 : 1.1 });
}
// One fixed physics step: friction, acceleration toward the wished velocity, sliding collision, then gravity and floors.
function walkStep(h, wx, wz, wish) {
  const W = WALK;
  if (W.swim) {
    const k = Math.exp(-2.4 * h); W.vx *= k; W.vz *= k;
    if (wish > 0) { const add = wish - (W.vx * wx + W.vz * wz); if (add > 0) { const a = Math.min(5 * wish * h, add); W.vx += wx * a; W.vz += wz * a; } }
    if (W.vx || W.vz) walkMove(W.vx * h, W.vz * h);
    if (!isWet(W.x, W.z)) {
      // reached the bank: climb out onto it
      const fl = floorAt(W.x, W.z, W.y + 2.5); W.stepY -= fl - W.y; W.y = fl; W.vy = 0; W.swim = false; W.ground = true; W.air = 0;
      walkSound('stroke', 0.8); return;
    }
    const floatY = WATER_Y + 0.28 - EYE, dive = W.keys.has('KeyC') || W.crouchOn;
    if (W.jumpBuf > 0) { W.vy = Math.max(W.vy, 2.4); W.jumpBuf = 0; walkSound('stroke', 0.7); }
    if (dive) W.vy += (-1.7 - W.vy) * Math.min(1, h * 2.5);
    else W.vy += ((floatY - W.y) * 5 - W.vy * 2.6) * h;
    W.y += W.vy * h;
    if (W.y < LAKE_BED) { W.y = LAKE_BED; W.vy = Math.max(0, W.vy); }
    if (W.y > floatY + 0.6) W.vy -= MOVE.gravity * h;
    return;
  }
  if (W.ground) {
    const sp = Math.hypot(W.vx, W.vz);
    if (sp > 1e-3) { const k = Math.max(0, sp - Math.max(sp, MOVE.stop) * MOVE.friction * h) / sp; W.vx *= k; W.vz *= k; }
  }
  if (wish > 0) {
    const add = wish - (W.vx * wx + W.vz * wz);
    if (add > 0) { const a = Math.min((W.ground ? MOVE.accel : MOVE.air) * wish * h, add); W.vx += wx * a; W.vz += wz * a; }
  }
  if (W.vx || W.vz) {
    const px = W.x, pz = W.z;
    walkMove(W.vx * h, W.vz * h);
    // Keep only the velocity that actually moved the walker, so pushing into a wall never banks speed.
    const mx = (W.x - px) / h, mz = (W.z - pz) / h;
    if (Math.hypot(mx, mz) < Math.hypot(W.vx, W.vz) - 0.01) { W.vx = mx; W.vz = mz; }
  }
  W.jumpBuf = Math.max(0, W.jumpBuf - h);
  if (W.ground) {
    const fl = floorAt(W.x, W.z, W.y);
    if (fl < W.y - 0.36) { W.ground = false; W.air = 0; W.vy = 0; }
    else { W.stepY -= fl - W.y; W.y = fl; }
  } else W.air += h;
  if (W.jumpBuf > 0 && (W.ground || (W.air < 0.12 && W.vy <= 0))) {
    W.vy = MOVE.jump * (W.crouch > 0.5 ? 0.85 : 1); W.ground = false; W.air = 0.2; W.jumpBuf = 0;
    walkSound('jump');
  }
  if (!W.ground) {
    W.vy -= MOVE.gravity * h; W.y += W.vy * h;
    if (isWet(W.x, W.z) && W.y < WATER_Y - 0.25) { W.swim = true; W.ground = false; walkSound('splash', clamp(-W.vy / 6, 0.35, 1)); W.vy *= 0.35; return; }
    const fl = floorAt(W.x, W.z, W.y);
    if (W.y <= fl && W.vy <= 0) {
      const hit = -W.vy; W.y = fl; W.vy = 0; W.ground = true; W.air = 0;
      if (hit > 2.2) { W.landV -= Math.min(1.6, hit * 0.16); walkSound('land', Math.min(1, hit / 8)); }
    }
  }
}
function updateWalk(dt) {
  if (DRIVE.on) { updateDrive(dt); return; }
  if (RIDE.on) { updateRide(dt); return; }
  const W = WALK, k = W.keys, live = TOUCH || W.locked || W.noLock;
  let f = 0, s = 0;
  if (live) {
    f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - W.pad.y;
    s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + W.pad.x;
  }
  const padMag = Math.min(1, Math.hypot(W.pad.x, W.pad.y)), mag = Math.min(1, Math.hypot(f, s));
  const crouch = live && (k.has('KeyC') || W.crouchOn);
  W.crouch += ((crouch ? 1 : 0) - W.crouch) * Math.min(1, dt * 10);
  W.sprint = live && !crouch && f > 0.3 && (k.has('ShiftLeft') || k.has('ShiftRight') || W.padRun);
  const [fx, fz] = walkForward(), rx = -fz, rz = fx;
  let wish = 0, wx = 0, wz = 0;
  if (mag > 0.05 && !W.trans) {
    const l = Math.hypot(f, s);
    wx = (fx * f + rx * s) / l; wz = (fz * f + rz * s) / l;
    wish = (W.swim ? (W.sprint ? 3.2 : 1.9) : W.sprint ? MOVE.sprint : crouch ? MOVE.crouch : MOVE.run) * (padMag > 0 && !W.sprint ? Math.min(1, padMag / 0.85) : 1);
  }
  const h = Math.min(dt, 0.05), n = Math.max(1, Math.ceil(h * 120));
  for (let i = 0; i < n; i++) walkStep(h / n, wx, wz, wish);
  if (W.faceYaw != null) {
    const d = angDiff(W.faceYaw, W.yaw);
    W.yaw += d * Math.min(1, dt * 3.5); if (Math.abs(d) < 0.01) W.faceYaw = null;
  }
  // camera feel: smoothed steps, landing spring, footstep-locked bob, strafe lean, sprint FOV kick, right-button zoom
  const still = REDUCED_MOTION.matches, e1 = Math.min(dt, 0.05);
  W.stepY *= Math.exp(-dt * 14);
  W.landV += (-90 * W.land - 13 * W.landV) * e1; W.land += W.landV * e1;
  const sp = W.ground ? Math.hypot(W.vx, W.vz) : 0, before = Math.floor(W.ph / Math.PI);
  W.ph += sp * dt / (0.62 + sp * 0.05) * Math.PI;
  if (Math.floor(W.ph / Math.PI) !== before && sp > 1 && !W.swim) walkSound('step', Math.min(1, sp / 6));
  W.bobA += ((still ? 0 : Math.min(1, sp / 5)) - W.bobA) * Math.min(1, dt * 8);
  const bobY = -Math.cos(W.ph * 2) * 0.042 * W.bobA * (W.sprint ? 1.35 : 1), bobX = Math.sin(W.ph) * 0.032 * W.bobA;
  W.roll += ((still ? 0 : -s * 0.016 * Math.min(1, Math.hypot(W.vx, W.vz) / 3)) - W.roll) * Math.min(1, dt * 6);
  W.zoom += ((W.zoomOn && live ? 1 : 0) - W.zoom) * Math.min(1, dt * 12);
  W.kick += ((W.sprint && sp > 5 && !still ? 1 : 0) - W.kick) * Math.min(1, dt * 5);
  if (W.swim) {
    W.strokeT = (W.strokeT || 0) + dt * Math.min(1.5, Math.hypot(W.vx, W.vz));
    if (W.strokeT > 1.4) { W.strokeT = 0; walkSound('stroke', 0.5); }
  }
  const eyeH = W.swim ? EYE + Math.sin(performance.now() / 600) * 0.035 : EYE + (EYE_LOW - EYE) * W.crouch;
  const eye = new THREE.Vector3(W.x + rx * bobX, W.y + eyeH + W.stepY + W.land + bobY, W.z + rz * bobX);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(W.pitch, W.yaw, W.roll + Math.sin(W.ph) * 0.004 * W.bobA, 'YXZ'));
  const fov = W.fov * (1 - 0.55 * W.zoom) + 7 * W.kick;
  if (W.trans) {
    const T = W.trans; T.t = Math.min(1, T.t + dt / T.dur); const e = ease(T.t);
    camera.position.lerpVectors(T.p0, eye, e); camera.position.y += Math.sin(Math.PI * e) * T.lift;
    camera.quaternion.slerpQuaternions(T.q0, q, e);
    camera.fov = T.fov0 + (fov - T.fov0) * e; camera.updateProjectionMatrix();
    if (T.t >= 1) W.trans = null;
  } else {
    camera.position.copy(eye); camera.quaternion.copy(q);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 12); camera.updateProjectionMatrix(); }
  }
  controls.target.set(W.x + fx * 20, W.y + EYE, W.z + fz * 20);
  setUnderwater(W.swim && camera.position.y < WATER_Y - 0.04);
  W.aimT -= dt;
  if (W.aimT <= 0) { W.aimT = 0.1; walkAim(); }
}
// ---- underwater: lake bed, the surface seen from below, dense green fog and a tint ----
const UNDER = { on: false, bed: null, top: null };
function underFog() { scene.fog.color.set('#16413d'); scene.fog.density = 0.12; }
function setUnderwater(on) {
  if (UNDER.on === on) return;
  UNDER.on = on;
  if (on && !UNDER.bed && waterObj) {
    const bt = canvasTex(noiseCanvas(256, 8, 4, 515, 40, 150)); bt.repeat.set(1 / 6, 1 / 6);
    UNDER.bed = new THREE.Mesh(waterObj.geometry, new THREE.MeshStandardMaterial({ color: '#4a5a3c', map: bt, roughness: 1 }));
    UNDER.bed.rotation.x = -Math.PI / 2; UNDER.bed.position.y = LAKE_BED - 0.02;
    UNDER.top = new THREE.Mesh(waterObj.geometry, new THREE.MeshBasicMaterial({ color: '#79b3ad', side: THREE.BackSide, transparent: true, opacity: 0.88, fog: false }));
    UNDER.top.rotation.x = -Math.PI / 2; UNDER.top.position.y = WATER_Y - 0.002;
    scene.add(UNDER.bed, UNDER.top);
  }
  if (UNDER.bed) UNDER.bed.visible = UNDER.top.visible = on;
  if (on) underFog(); else applyTime();
  $('#app').classList.toggle('underwater', on);
}
// ======================= driving =======================
const DRIVE = { on: false, k: -1, x: 0, z: 0, a: 0, y: 0, v: 0, vx: 0, vz: 0, r: 0, steer: 0, spin: 0, pitch: 0, roll: 0, vlPrev: 0, shake: 0, camA: 0, cam: 'chase', camYaw: 0, camPitch: 0.2, lookT: 0, root: null, wheels: [], snd: null, near: -1, gas: false, brake: false };
const VEH_FOCUS = new THREE.Vector3();
function nearCar() {
  if (!CARS) return -1;
  const [fx, fz] = walkForward(); let best = -1, bd = 1e9;
  CARS.parkedM.forEach((m, k) => {
    const e = m.elements, dx = e[12] - WALK.x, dz = e[14] - WALK.z, d = Math.hypot(dx, dz);
    if (d < 4.2 && (d < 2.6 || (dx * fx + dz * fz) / d > 0.2) && d < bd) { bd = d; best = k; }
  });
  return best;
}
function driveMesh() {
  if (DRIVE.root) return DRIVE.root;
  const cg = carGeometry({ noWheels: true }), root = new THREE.Group();
  DRIVE.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.55 });
  const body = new THREE.Mesh(cg.body, DRIVE.bodyMat), trim = new THREE.Mesh(cg.trim, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.35 }));
  body.castShadow = true; root.add(body, trim);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 1.4), new THREE.MeshStandardMaterial({ color: '#202225', roughness: 0.8 })); dash.position.set(0.62, 0.98, 0); root.add(dash);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 6, 20), new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 }));
  sw.position.set(0.32, 1.08, -0.36); sw.rotation.y = Math.PI / 2; sw.rotation.x = 0.35; root.add(sw); DRIVE.sw = sw;
  for (const [x, z] of [[1.4, -0.8], [1.4, 0.8], [-1.4, -0.8], [-1.4, 0.8]]) {
    const w = new THREE.Mesh(cg.wheel, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }));
    w.position.set(x, 0.33, z); w.rotation.order = 'YXZ'; w.castShadow = true; root.add(w); DRIVE.wheels.push(w);
  }
  root.visible = false; scene.add(root); DRIVE.root = root; return root;
}
function enterCar(k) {
  const m = CARS.parkedM[k], e = m.elements, root = driveMesh();
  Object.assign(DRIVE, { on: true, k, x: e[12], z: e[14], a: Math.atan2(e[2], e[0]), v: 0, vx: 0, vz: 0, r: 0, steer: 0, pitch: 0, roll: 0, vlPrev: 0, shake: 0, camYaw: 0, camPitch: 0.2, lookT: 0, gas: false, brake: false });
  DRIVE.camA = DRIVE.a; DRIVE.camW = DRIVE.a + Math.PI; DRIVE.cam = 'chase';
  DRIVE.y = groundAt(DRIVE.x, DRIVE.z);
  DRIVE.bodyMat.color.copy(CARS.carCols[CARS.movers.length + k]);
  CARS.taken = k; root.visible = true;
  WALK.vx = WALK.vz = WALK.vy = 0; WALK.trans = null; setUnderwater(false);
  driveSound(true); walkHud();
  toast(TOUCH ? '左侧摇杆转向 · 右侧油门和刹车 · ^ 手刹' : 'W/S 油门刹车 · A/D 转向 · 空格手刹 · Shift 加速 · V 视角 · E 下车', 4200);
}
function exitCar() {
  if (!DRIVE.on) return;
  const D = DRIVE, c = Math.cos(D.a), sn = Math.sin(D.a);
  _e.set(0, -D.a, 0); _q.setFromEuler(_e);
  CARS.parkedM[D.k] = new THREE.Matrix4().compose(new THREE.Vector3(D.x, 0, D.z), _q.clone(), new THREE.Vector3(1, 1, 1));
  CARS.taken = -1; D.on = false; D.root.visible = false; driveSound(false);
  // step out on the driver's (left) side, facing the way the car points
  const [px, pz] = walkSpot(D.x + sn * 2.1, D.z - c * 2.1);
  Object.assign(WALK, { x: px, z: pz, y: floorAt(px, pz, 5), yaw: Math.atan2(-c, -sn), pitch: -0.05, vx: 0, vz: 0, vy: 0, ground: true, swim: false });
  walkHud();
}
function driveSound(on) {
  if (!on) { if (DRIVE.snd) { try { DRIVE.snd.o.stop(); DRIVE.snd.o2.stop(); DRIVE.snd.sq.stop(); } catch (_) { } DRIVE.snd = null; } return; }
  walkAudioWake(); if (!WALK.sound || !AUD || DRIVE.snd) return;
  const C = AUD.C, o = C.createOscillator(), o2 = C.createOscillator(), f = C.createBiquadFilter(), g = C.createGain();
  o.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = 7; f.type = 'lowpass'; f.frequency.value = 380; g.gain.value = 0.0;
  o.connect(f); o2.connect(f); f.connect(g); g.connect(AUD.out); o.start(); o2.start();
  const nb = C.createBuffer(1, C.sampleRate, C.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const sq = C.createBufferSource(), sf = C.createBiquadFilter(), sg = C.createGain();
  sq.buffer = nb; sq.loop = true; sf.type = 'bandpass'; sf.frequency.value = 1700; sf.Q.value = 4; sg.gain.value = 0;
  sq.connect(sf); sf.connect(sg); sg.connect(AUD.out); sq.start();
  DRIVE.snd = { o, o2, f, g, sq, sg };
}
// Car handling: engine and brakes act along the nose; steering is rate-limited and loses lock with speed; the yaw rate
// follows the bicycle model through a short tyre lag, and sideways velocity bleeds away through grip, so the car carries
// a little slip in fast corners and slides on the handbrake. Walls take away only the velocity that points into them.
function camBlocked(x, y, z) {
  if (y < groundAt(x, z) + 0.35) return true;
  for (const k of BGRID.at(x, z)) {
    const b = BLD[k];
    if (y > b.h + 0.5 || x < b.bb[0] || x > b.bb[2] || z < b.bb[1] || z > b.bb[3]) continue;
    if ((b.parts || [b.p]).some((q) => pip(x, z, q))) return true;
  }
  return false;
}
// Third-person boom shared by the car and the bike. The mouse or a drag orbits it in world space, so it moves the way it
// reads on screen and stays where it was put; only after ~2 s without input, and only while the vehicle is moving, does
// it swing back behind the direction of travel (faster at speed). It pulls in when a wall or the ground is in the way.
function chaseCam(S, dt, o) {
  S.lookT += dt;
  const travel = o.speed > 2.2 && o.fwd ? Math.atan2(o.vz, o.vx) : o.heading;
  if (S.lookT > 2 && o.speed > 2.2) {
    S.camW += angDiff(travel + Math.PI, S.camW) * Math.min(1, dt * (1.1 + o.speed * 0.12));
    S.camPitch += (o.pitch0 - S.camPitch) * Math.min(1, dt * 1.5);
  }
  const pc = Math.cos(S.camPitch), ps = Math.sin(S.camPitch);
  const piv = new THREE.Vector3(o.x, o.y + o.height, o.z), dir = new THREE.Vector3(Math.cos(S.camW) * pc, ps, Math.sin(S.camW) * pc);
  let arm = o.dist;
  for (let t = 0.6; t <= o.dist; t += 0.35) { const q = piv.clone().addScaledVector(dir, t); if (camBlocked(q.x, q.y, q.z)) { arm = Math.max(1.0, t - 0.45); break; } }
  camera.position.lerp(piv.clone().addScaledVector(dir, arm), 1 - Math.exp(-dt * 18));
  if (o.shake) { camera.position.x += (Math.random() - 0.5) * o.shake; camera.position.y += (Math.random() - 0.5) * o.shake; }
  const la = o.lookAhead;
  camera.lookAt(o.x - Math.cos(S.camW) * la, o.y + o.height - 0.3, o.z - Math.sin(S.camW) * la);
}
// Looking around from a seat: the head turns with the mouse and stays turned; it eases back only while moving.
function seatLook(S, dt, moving, pitch0) {
  S.lookT += dt;
  if (S.lookT > 2 && moving) { S.camYaw *= Math.exp(-dt * 2); S.camPitch += (pitch0 - S.camPitch) * Math.min(1, dt * 2); }
}
function vehicleLook(S, dx, dy, k) {
  if (S.cam === 'chase') { S.camW += dx * k; S.camPitch = clamp(S.camPitch + dy * k, -0.12, 1.2); }
  else { S.camYaw = clamp(S.camYaw - dx * k, -2.4, 2.4); S.camPitch = clamp(S.camPitch - dy * k, -1.0, 0.9); }
  S.lookT = 0;
}
function updateDrive(dt) {
  const D = DRIVE, k = WALK.keys, pad = WALK.pad, live = TOUCH || WALK.locked || WALK.noLock, h = Math.min(dt, 0.05);
  const gas = live && (k.has('KeyW') || k.has('ArrowUp') || D.gas), brk = live && (k.has('KeyS') || k.has('ArrowDown') || D.brake);
  const thr = (gas ? 1 : 0) - (brk ? 1 : 0);
  const st = live ? clamp((k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - pad.x, -1, 1) : 0;
  const hb = live && k.has('Space'), boost = live && (k.has('ShiftLeft') || k.has('ShiftRight')), max = boost ? 26 : 17;
  const c = Math.cos(D.a), sn = Math.sin(D.a), rx = -sn, rz = c;
  let vl = D.vx * c + D.vz * sn, vt = D.vx * rx + D.vz * rz;
  if (thr > 0) vl += (vl < -0.3 ? 12 : 8.6 * (1 - Math.max(0, vl) / max) + 0.5) * h;
  else if (thr < 0) { vl += (vl > 0.3 ? -13 : -4) * h; vl = Math.max(vl, -6); }
  else vl -= Math.sign(vl) * Math.min(Math.abs(vl), (0.5 + Math.abs(vl) * 0.1) * h);
  vl -= vl * Math.abs(vl) * 0.0011 * h;
  if (hb) vl -= Math.sign(vl) * Math.min(Math.abs(vl), 4.5 * h);
  const lock = 0.6 / (1 + Math.abs(vl) * 0.21), tgt = st * lock, rate = (Math.abs(tgt) < Math.abs(D.steer) || tgt * D.steer < 0 ? 4.2 : 2.4) * h;
  D.steer += clamp(tgt - D.steer, -rate, rate);
  const rDes = -vl / 2.75 * Math.tan(D.steer) * (hb ? 1.35 : 1);
  D.r += (rDes - D.r) * Math.min(1, h * (hb ? 2.6 : 8));
  // grip turns most of the scrubbed sideways speed back into forward speed, so a corner does not feel like braking
  const vt0 = vt; vt *= Math.exp(-h * (hb ? 1.3 : 9));
  if (!hb && Math.abs(vl) > 0.5) vl = Math.sign(vl) * Math.sqrt(vl * vl + 0.75 * (vt0 * vt0 - vt * vt));
  D.vx = c * vl + rx * vt; D.vz = sn * vl + rz * vt;
  D.a += D.r * h;
  // body motion: squat and dive with longitudinal acceleration, roll away from the corner
  const ax = (vl - D.vlPrev) / Math.max(h, 1e-3); D.vlPrev = vl;
  D.pitch += (clamp(ax * 0.0045, -0.045, 0.045) - D.pitch) * Math.min(1, h * 6);
  D.roll += (clamp(-vl * D.r * 0.006, -0.06, 0.06) - D.roll) * Math.min(1, h * 6);
  // move, then collide two body circles; remove only the velocity that drives into the obstacle
  const ca = Math.cos(D.a), sa = Math.sin(D.a);
  let nx = D.x + D.vx * h, nz = D.z + D.vz * h, px = 0, pz = 0, wet = false;
  for (const off of [1.3, -1.3]) {
    const cx = nx + ca * off, cz = nz + sa * off, [qx, qz] = walkResolve(cx, cz, 0, 0.92);
    if (Math.hypot(qx - cx, qz - cz) > Math.hypot(px, pz)) { px = qx - cx; pz = qz - cz; }
    if (isWet(cx, cz) || !inRegion(cx, cz)) wet = true;
  }
  if (wet) {
    nx = D.x; nz = D.z; const sp0 = Math.hypot(D.vx, D.vz);
    if (sp0 > 3) { walkSound('bump', Math.min(1, sp0 / 12)); D.shake = Math.min(1, sp0 / 12); }
    D.vx *= -0.15; D.vz *= -0.15; D.r *= 0.3;
  } else if (px || pz) {
    nx += px; nz += pz;
    const pl = Math.hypot(px, pz), ux = px / pl, uz = pz / pl, vn = D.vx * ux + D.vz * uz;
    if (vn < 0) {
      D.vx -= ux * vn * 1.2; D.vz -= uz * vn * 1.2; D.r *= 0.6;
      if (-vn > 2.5) { walkSound('bump', Math.min(1, -vn / 12)); D.shake = Math.min(1, -vn / 10); }
    }
  }
  D.x = nx; D.z = nz; D.y += (groundAt(D.x, D.z) - D.y) * Math.min(1, h * 10);
  vl = D.vx * ca + D.vz * sa; vt = -D.vx * sa + D.vz * ca; D.v = vl;
  const sp = Math.hypot(D.vx, D.vz);
  D.spin -= vl * h / 0.33;
  const r = D.root; r.position.set(D.x, D.y, D.z);
  r.rotation.set(D.roll, -D.a, D.pitch, 'YXZ');
  D.wheels.forEach((w, i) => w.rotation.set(0, i < 2 ? D.steer : 0, D.spin, 'YXZ'));
  if (D.sw) D.sw.rotation.z = -D.steer * 3;
  WALK.x = D.x; WALK.z = D.z; WALK.y = D.y;
  VEH_FOCUS.set(D.x, D.y + 1, D.z);
  // camera
  D.shake *= Math.exp(-dt * 7);
  const shk = D.shake > 0.01 ? D.shake * 0.12 : 0;
  if (D.cam === 'chase') {
    chaseCam(D, dt, { x: D.x, y: D.y, z: D.z, vx: D.vx, vz: D.vz, heading: D.a, speed: sp, fwd: vl > 0, dist: 5.6 + Math.min(2.4, sp * 0.1), height: 1.35, pitch0: 0.2, lookAhead: 2.2 + Math.min(4, Math.max(0, vl) * 0.16), shake: shk });
  } else {
    seatLook(D, dt, sp > 2, 0);
    camera.position.set(D.x - ca * 0.32 + sa * 0.36 - clamp(D.r * vl * 0.004, -0.05, 0.05) * sa, D.y + 1.24 + (Math.random() - 0.5) * shk * 0.5, D.z - sa * 0.32 - ca * 0.36);
    camera.quaternion.setFromEuler(new THREE.Euler(D.camPitch - 0.05 + D.pitch * 0.5, -D.a - Math.PI / 2 + D.camYaw, -D.roll * 0.6, 'YXZ'));
  }
  const fov = (D.cam === 'chase' ? 66 : 74) + Math.min(12, sp * 0.45);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  controls.target.set(D.x + ca * 20, D.y + 1.2, D.z + sa * 20);
  const spd = $('#speedo b'); if (spd) spd.textContent = String(Math.round(Math.abs(vl) * 3.6));
  if (D.snd) {
    const t = AUD.C.currentTime, rpm = 38 + Math.abs(vl) * 5.5 % 40 + Math.abs(vl) * 2.2 + Math.max(0, thr) * 18;
    D.snd.o.frequency.setTargetAtTime(rpm, t, 0.08); D.snd.o2.frequency.setTargetAtTime(rpm * 0.5, t, 0.08);
    D.snd.f.frequency.setTargetAtTime(260 + Math.abs(vl) * 40 + Math.max(0, thr) * 300, t, 0.1);
    D.snd.g.gain.setTargetAtTime(WALK.sound ? 0.035 + Math.max(0, thr) * 0.03 + Math.abs(vl) * 0.0015 : 0, t, 0.1);
    D.snd.sg.gain.setTargetAtTime(WALK.sound ? clamp((Math.abs(vt) - 1.6) * 0.03, 0, 0.09) : 0, t, 0.05);
  }
}
// ======================= cycling =======================
// Any parked bike can be ridden: pedal, brake, steer, lean into turns, bunny-hop, ring the bell. First person shows the
// rider's own arms and pedalling legs; third person shows the whole rider. Riding into a lake throws the rider in.
const RIDE = { on: false, k: -1, x: 0, z: 0, a: 0, y: 0, v: 0, steer: 0, lean: 0, crank: 0, spin: 0, hop: 0, hopV: 0,
  cam: 'chase', camW: 0, camYaw: 0, camPitch: 0.24, lookT: 0, root: null, near: -1, tick: 0 };
function bikeSlot(k) { for (const c of BIKE_CHUNKS) { const j = c.userData.ids.indexOf(k); if (j >= 0) return [c, j]; } return [null, -1]; }
function nearBike() {
  const [fx, fz] = walkForward(); let best = -1, bd = 1e9;
  BIKE_SPOTS.forEach(([x, z], k) => {
    if (k === RIDE.k && RIDE.on) return;
    const dx = x - WALK.x, dz = z - WALK.z, d = Math.hypot(dx, dz);
    if (d < 2.6 && (d < 1.4 || (dx * fx + dz * fz) / d > 0.25) && d < bd) { bd = d; best = k; }
  });
  return best;
}
const limbTo = (m, a, b) => { const d = new THREE.Vector3().subVectors(b, a), l = d.length(); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(l || 1)); m.scale.set(1, l, 1); };
function rideMesh() {
  if (RIDE.root) return RIDE.root;
  const root = new THREE.Group(), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const frameMat = new THREE.MeshStandardMaterial({ color: '#1f8fe0', roughness: 0.45, metalness: 0.35 }), dark = new THREE.MeshStandardMaterial({ color: '#1a1b1d', roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: '#b7bcc2', roughness: 0.35, metalness: 0.8 });
  const unit = new THREE.CylinderGeometry(1, 1, 1, 8); unit.translate(0, 0, 0);
  const rod = (a, b, r, mat, parent = root) => { const m = new THREE.Mesh(unit, mat); m.scale.x = m.scale.z = r; limbTo(m, a, b); m.scale.x = m.scale.z = r; parent.add(m); m.castShadow = true; return m; };
  const wheel = () => {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.032, 8, 32), dark); g.add(t);
    const rimM = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 6, 32), steel); g.add(rimM);
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, sp = new THREE.Mesh(unit, steel); sp.scale.set(0.004, 0.3, 0.004); sp.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0); sp.rotation.z = a - Math.PI / 2; g.add(sp); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10), steel); hub.rotation.x = Math.PI / 2; g.add(hub);
    t.castShadow = true; return g;
  };
  const back = V(-0.52, 0.36, 0), crank = V(-0.05, 0.36, 0), seatTop = V(-0.22, 0.85, 0), front = V(0.52, 0.36, 0), stem = V(0.37, 0.84, 0);
  for (const [a, b] of [[back, crank], [back, seatTop], [seatTop, crank], [seatTop, stem], [crank, stem]]) rod(a, b, 0.024, frameMat);
  rod(V(-0.52, 0.36, 0.05), V(-0.22, 0.85, 0.02), 0.012, frameMat); rod(V(-0.52, 0.36, -0.05), V(-0.22, 0.85, -0.02), 0.012, frameMat);
  rod(seatTop, V(-0.25, 0.95, 0), 0.016, steel);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.15), dark); seat.position.set(-0.26, 0.98, 0); root.add(seat);
  const rear = wheel(); rear.position.copy(back); root.add(rear);
  // steering assembly turns about the head tube
  const steerG = new THREE.Group(); steerG.position.copy(stem); root.add(steerG);
  const axis = new THREE.Vector3().subVectors(front, stem).normalize();
  rod(V(0, 0, 0), V(0.15, -0.48, 0.05), 0.014, frameMat, steerG); rod(V(0, 0, 0), V(0.15, -0.48, -0.05), 0.014, frameMat, steerG);
  rod(V(0, 0, 0), V(0.04, 0.18, 0), 0.018, steel, steerG);
  rod(V(0.04, 0.18, -0.29), V(0.04, 0.18, 0.29), 0.013, steel, steerG);
  for (const z of [-0.26, 0.26]) { const gr = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), dark); gr.rotation.x = Math.PI / 2; gr.position.set(0.04, 0.18, z); steerG.add(gr); }
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.34), new THREE.MeshStandardMaterial({ color: '#2a2c2f', roughness: 0.6, wireframe: true })); basket.position.set(0.25, 0.1, 0); steerG.add(basket);
  const frontW = wheel(); frontW.position.set(0.15, -0.48, 0); steerG.add(frontW);
  // crank and pedals
  const crankG = new THREE.Group(); crankG.position.copy(crank); root.add(crankG);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.01, 20), steel); ring.rotation.x = Math.PI / 2; ring.position.z = 0.06; crankG.add(ring);
  const pedals = [];
  for (const sd of [1, -1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.02), steel); arm.position.set(0, -0.085 * sd, 0.09 * sd); crankG.add(arm);
    const pd = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.08), dark); pd.position.set(0, -0.17 * sd, 0.14 * sd); crankG.add(pd); pedals.push(pd);
  }
  // rider: torso leaning over the bars, arms to the grips, legs solved to the pedals every frame
  const skin = new THREE.MeshStandardMaterial({ color: '#d9b08d', roughness: 0.75 }), shirt = new THREE.MeshStandardMaterial({ color: '#2f3b4c', roughness: 0.85 }), pants = new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.85 });
  const rider = new THREE.Group(); root.add(rider);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.56, 12), shirt); torso.scale.z = 0.7; torso.position.set(-0.12, 1.24, 0); torso.rotation.z = -0.55; rider.add(torso);
  const head = new THREE.Group(); head.position.set(0.12, 1.6, 0); rider.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), skin));
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.106, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: '#1d1714', roughness: 0.9 })); hair.position.y = 0.03; head.add(hair);
  const limbs = {};
  for (const sd of [1, -1]) {
    limbs['ua' + sd] = rod(V(0, 0, 0), V(0, 1, 0), 0.045, shirt, rider); limbs['fa' + sd] = rod(V(0, 0, 0), V(0, 1, 0), 0.038, skin, rider);
    limbs['th' + sd] = rod(V(0, 0, 0), V(0, 1, 0), 0.065, pants, rider); limbs['sh' + sd] = rod(V(0, 0, 0), V(0, 1, 0), 0.05, pants, rider);
  }
  Object.assign(RIDE, { root, rear, frontW, steerG, axis, crankG, pedals, rider, head, limbs, frameMat, shirt });
  root.visible = false; scene.add(root); return root;
}
function poseRider() {
  const R = RIDE, V = (x, y, z) => new THREE.Vector3(x, y, z), L = R.limbs;
  for (const sd of [1, -1]) {
    const sh = V(0.05, 1.4, 0.17 * sd), grip = V(0.41, 1.0, 0.25 * sd);
    grip.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0).sub(V(0.37, 0.84, 0)).applyAxisAngle(R.axis, -R.steer).add(V(0.37, 0.84, 0));
    const elbow = sh.clone().lerp(grip, 0.5).add(V(-0.04, -0.06, 0.05 * sd));
    limbTo(L['ua' + sd], sh, elbow); L['ua' + sd].scale.x = L['ua' + sd].scale.z = 0.045;
    limbTo(L['fa' + sd], elbow, grip); L['fa' + sd].scale.x = L['fa' + sd].scale.z = 0.038;
    // two-bone leg: hip to pedal with 0.46 m thigh and shin, knee bent forward
    const ang = R.crank + (sd > 0 ? 0 : Math.PI), pedal = V(-0.05 - Math.sin(ang) * 0.17, 0.36 - Math.cos(ang) * 0.17, 0.14 * sd), hip = V(-0.25, 1.0, 0.1 * sd);
    const d = pedal.clone().sub(hip), dl = Math.min(d.length(), 0.9), mid = hip.clone().addScaledVector(d.clone().normalize(), dl / 2);
    const bend = Math.sqrt(Math.max(0, 0.46 * 0.46 - (dl / 2) * (dl / 2))), perp = new THREE.Vector3(-d.y, d.x, 0).normalize();
    if (perp.x < 0) perp.negate();
    const knee = mid.addScaledVector(perp, bend);
    limbTo(L['th' + sd], hip, knee); L['th' + sd].scale.x = L['th' + sd].scale.z = 0.065;
    limbTo(L['sh' + sd], knee, pedal); L['sh' + sd].scale.x = L['sh' + sd].scale.z = 0.05;
  }
}
function enterBike(k) {
  const [c, j] = bikeSlot(k); if (!c) return;
  rideMesh();
  const [x, z, a] = BIKE_SPOTS[k], col = new THREE.Color(); c.getColorAt(j, col);
  _m4.makeScale(0, 0, 0); c.setMatrixAt(j, _m4); c.instanceMatrix.needsUpdate = true;
  Object.assign(RIDE, { on: true, k, x, z, a, y: groundAt(x, z), v: 0, steer: 0, lean: 0, hop: 0, hopV: 0, cam: 'chase', camW: a + Math.PI, camYaw: 0, camPitch: 0.24, lookT: 0 });
  RIDE.frameMat.color.copy(col); RIDE.shirt.color.set(pick(['#f2f1ec', '#2f3b4c', '#7b8ea3', '#c48f8f', '#4a5a4c', '#d7b46a', '#9a3d3d']));
  RIDE.root.visible = true; WALK.vx = WALK.vz = WALK.vy = 0; WALK.trans = null; setUnderwater(false);
  walkAudioWake(); walkHud();
  toast(TOUCH ? '左侧摇杆骑行 · 跳跃键小跳 · 点“下车”离开' : 'W 蹬车 · S 刹车 · A/D 转向 · Shift 加速 · 空格小跳 · B 车铃 · V 视角 · E 下车', 4200);
}
function exitBike(o = {}) {
  if (!RIDE.on) return;
  const R = RIDE, [c, j] = bikeSlot(R.k), c0 = Math.cos(R.a), s0 = Math.sin(R.a);
  if (c && !o.swim) {
    const lean = new THREE.Euler(-0.11, -R.a, 0, 'YXZ'); _q.setFromEuler(lean);
    _m4.compose(_v.set(R.x, groundAt(R.x, R.z), R.z), _q, _s.set(1, 1, 1)); c.setMatrixAt(j, _m4); c.instanceMatrix.needsUpdate = true; c.computeBoundingSphere();
    BIKE_SPOTS[R.k] = [R.x, R.z, R.a];
  } else { BIKE_SPOTS[R.k] = [1e9, 1e9, 0]; }
  R.on = false; R.root.visible = false;
  if (o.swim) {
    Object.assign(WALK, { x: R.x + c0 * 1.2, z: R.z + s0 * 1.2, y: 0, yaw: Math.atan2(-c0, -s0), vx: c0 * R.v * 0.5, vz: s0 * R.v * 0.5, vy: 1.5, ground: false, swim: false });
  } else {
    const [px, pz] = walkSpot(R.x + s0 * 0.9, R.z - c0 * 0.9);
    Object.assign(WALK, { x: px, z: pz, y: floorAt(px, pz, 5), yaw: Math.atan2(-c0, -s0), pitch: -0.05, vx: 0, vz: 0, vy: 0, ground: true, swim: false });
  }
  walkHud();
}
function updateRide(dt) {
  const R = RIDE, k = WALK.keys, pad = WALK.pad, live = TOUCH || WALK.locked || WALK.noLock, h = Math.min(dt, 0.05);
  const thr = live ? clamp((k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - pad.y, -1, 1) : 0;
  const st = live ? clamp((k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - pad.x, -1, 1) : 0;
  const fast = live && (k.has('ShiftLeft') || k.has('ShiftRight') || WALK.padRun), max = fast ? 8.5 : 5.6;
  if (thr > 0.05) R.v += (2.9 * (1 - Math.max(0, R.v) / max) + 0.2) * thr * h;
  else if (thr < -0.05) R.v = R.v > 0.2 ? R.v - 6 * -thr * h : Math.max(-0.8, R.v - 1.5 * h);
  R.v -= R.v * 0.06 * h + Math.sign(R.v) * Math.min(Math.abs(R.v), 0.18 * h);
  const tgt = st * (0.62 - 0.44 * Math.min(1, Math.abs(R.v) / 7));
  R.steer += (tgt - R.steer) * Math.min(1, h * 7);
  R.a -= R.v / 1.05 * Math.tan(R.steer) * h;
  R.lean += (clamp(-Math.atan(R.v * R.v * Math.tan(R.steer) / 1.05 / 9.8) * 0.8, -0.4, 0.4) - R.lean) * Math.min(1, h * 4);
  // bunny hop
  if (WALK.jumpBuf > 0 && R.hop <= 0.001) { R.hopV = 2.8; WALK.jumpBuf = 0; walkSound('jump', 0.6); }
  WALK.jumpBuf = Math.max(0, WALK.jumpBuf - h);
  if (R.hop > 0 || R.hopV > 0) { R.hopV -= 15 * h; R.hop = Math.max(0, R.hop + R.hopV * h); if (R.hop === 0) { if (R.hopV < -2) walkSound('land', 0.4); R.hopV = 0; } }
  const c = Math.cos(R.a), sn = Math.sin(R.a);
  let nx = R.x + c * R.v * h, nz = R.z + sn * R.v * h, px = 0, pz = 0;
  for (const off of [0.5, -0.5]) {
    const cx = nx + c * off, cz = nz + sn * off, [rx, rz] = walkResolve(cx, cz, groundAt(cx, cz) + R.hop, 0.32);
    if (Math.hypot(rx - cx, rz - cz) > Math.hypot(px, pz)) { px = rx - cx; pz = rz - cz; }
  }
  if (isWet(nx + c * 0.6, nz + sn * 0.6) && R.v > 0.5) { walkSound('splash', 0.8); exitBike({ swim: true }); return; }
  if (!inRegion(nx, nz)) { nx = R.x; nz = R.z; R.v = 0; }
  const want = R.v * h; nx += px; nz += pz;
  const got = (nx - R.x) * c + (nz - R.z) * sn, ratio = Math.abs(want) > 1e-4 ? got / want : 1;
  if (ratio < 0.35) { if (Math.abs(R.v) > 2.5) walkSound('bump', 0.5); R.v *= 0.2; } else if (ratio < 0.98) R.v *= 1 - (1 - ratio) * 0.4;
  R.x = nx; R.z = nz; R.y += (groundAt(R.x, R.z) - R.y) * Math.min(1, h * 12);
  // drivetrain: wheels roll, cranks turn while pedalling, freewheel ticks while coasting
  R.spin -= R.v * h / 0.33;
  const pedal = thr > 0.05 && R.v > 0;
  if (pedal) R.crank += R.v * h / 0.33 / 2.4;
  R.tick += Math.abs(R.v) * h; if (!pedal && R.v > 1 && R.tick > 0.35) { R.tick = 0; walkSound('tick', 0.4); }
  const root = R.root; root.position.set(R.x, R.y + R.hop, R.z); root.rotation.set(R.lean, -R.a, 0, 'YXZ');
  R.rear.rotation.z = R.spin; R.frontW.rotation.z = R.spin;
  R.steerG.quaternion.setFromAxisAngle(R.axis, -R.steer);
  R.crankG.rotation.z = -R.crank; R.pedals.forEach((pd) => { pd.rotation.z = R.crank; });
  poseRider();
  WALK.x = R.x; WALK.z = R.z; WALK.y = R.y; VEH_FOCUS.set(R.x, R.y + 1.1, R.z);
  // camera: a chase boom behind the rider, or the rider's eyes (gentle pedalling bob, a little lean, head turned into the corner)
  R.head.visible = R.cam !== 'fp';
  const spd0 = Math.abs(R.v);
  if (R.cam === 'chase') {
    chaseCam(R, dt, { x: R.x, y: R.y + R.hop, z: R.z, vx: c * R.v, vz: sn * R.v, heading: R.a, speed: spd0, fwd: R.v > 0, dist: 3.5 + Math.min(1.5, spd0 * 0.12), height: 1.3, pitch0: 0.24, lookAhead: 1.2 + Math.min(2, Math.max(0, R.v) * 0.18) });
  } else {
    seatLook(R, dt, spd0 > 1.5, -0.14);
    const eye = new THREE.Vector3(0.1, 1.57 + Math.abs(Math.sin(R.crank)) * 0.012 * Math.min(1, R.v / 3), 0).applyEuler(new THREE.Euler(R.lean, -R.a, 0, 'YXZ'));
    camera.position.set(R.x + eye.x, R.y + R.hop + eye.y, R.z + eye.z);
    camera.quaternion.setFromEuler(new THREE.Euler(R.camPitch, -R.a - Math.PI / 2 + R.camYaw + R.steer * 0.35, -R.lean * 0.3, 'YXZ'));
  }
  const fov = (R.cam === 'chase' ? 64 : 74) + Math.min(9, Math.abs(R.v) * 0.8);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  controls.target.set(R.x + c * 20, R.y + 1.2, R.z + sn * 20);
  const spd = $('#speedo b'); if (spd) spd.textContent = String(Math.round(Math.abs(R.v) * 3.6));
}
// ---- aiming and inspecting buildings ----
function placeOf(own) {
  const pl = PLACES.find((q) => q.bld && q.bld.includes(own)); if (pl) return pl;
  const b = BLD[own]; if (!b || !b.name) return null;
  return { name: b.name, cat: b.cls.cat || 'teach', bld: [own], x: b.c[0], z: b.c[1], h: b.h };
}
function walkAim() {
  const live = !WALK.trans && (WALK.locked || WALK.noLock || TOUCH);
  let car = live ? nearCar() : -1, bike = live ? nearBike() : -1;
  if (car >= 0 && bike >= 0) {
    const ce = CARS.parkedM[car].elements, [bx, bz] = BIKE_SPOTS[bike];
    if (Math.hypot(ce[12] - WALK.x, ce[14] - WALK.z) - 1.2 < Math.hypot(bx - WALK.x, bz - WALK.z)) bike = -1; else car = -1;
  }
  const key = car >= 0 ? 'c' + car : bike >= 0 ? 'b' + bike : '';
  if (key !== WALK.vehKey) {
    WALK.vehKey = key; DRIVE.near = car; RIDE.near = bike;
    if (key) { WALK.aimOwn = -2; WALK.aim = null; $('#xhair').classList.add('on'); $('#xhint').hidden = false; $('#xhintName').textContent = car >= 0 ? '上车' : '骑车'; return; }
    WALK.aimOwn = -3;
  }
  if (key) return;
  let own = -1;
  if (!WALK.trans && (WALK.locked || WALK.noLock)) {
    ndc.set(0, 0); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(PICKABLE, false)[0], o = hit ? hit.object.userData.owner?.[hit.faceIndex] : null;
    if (o != null && o >= 0 && hit.distance < 90) own = o;
  }
  if (own === WALK.aimOwn) return;
  WALK.aimOwn = own; WALK.aim = own >= 0 ? placeOf(own) : null;
  $('#xhair').classList.toggle('on', Boolean(WALK.aim));
  $('#xhint').hidden = !WALK.aim; if (WALK.aim) $('#xhintName').textContent = WALK.aim.name;
}
function walkInspect(p = WALK.aim) {
  if (DRIVE.on) { exitCar(); return; }
  if (RIDE.on) { exitBike(); return; }
  if (p === WALK.aim && DRIVE.near >= 0) { enterCar(DRIVE.near); DRIVE.near = -1; WALK.vehKey = null; return; }
  if (p === WALK.aim && RIDE.near >= 0) { enterBike(RIDE.near); RIDE.near = -1; WALK.vehKey = null; return; }
  if (!p) return;
  select(p); WALK.inspect = true; WALK.zoomOn = false;
  walkUnlock(); walkHud();
}
function walkPick(e) {
  screenRay(e);
  const hit = ray.intersectObjects(PICKABLE, false)[0], own = hit ? hit.object.userData.owner?.[hit.faceIndex] : null;
  return own != null && own >= 0 && hit.distance < 400 ? placeOf(own) : null;
}
// ---- pointer lock ----
const LOCK_EL = renderer.domElement;
const isLocked = () => LOCK_EL.getRootNode().pointerLockElement === LOCK_EL;
function walkLock() {
  walkAudioWake();
  if (WALK.noLock || mode !== 'walk' || isLocked()) return;
  let p = null;
  try { p = LOCK_EL.requestPointerLock({ unadjustedMovement: true }); } catch (_) { p = null; }
  if (p && p.catch) p.catch(() => { try { const r = LOCK_EL.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (_) { } });
}
function walkUnlock() { if (isLocked()) document.exitPointerLock(); }
function walkLockChange() {
  const l = isLocked();
  if (WALK.locked && !l) WALK.unlockT = performance.now();
  WALK.locked = l;
  $('#app').classList.toggle('locked', l && mode === 'walk');
  if (l) {
    if (WALK.inspect && !$('#info').hidden) $('#infoClose').click(); WALK.inspect = false;
    if (!WALK.hinted) { WALK.hinted = true; toast('WASD 移动 · 空格跳 · Shift 冲刺 · C 蹲 · E 查看 · Esc 暂停', 3600); }
  }
  else { WALK.keys.clear(); WALK.zoomOn = false; }
  walkHud();
}
function walkLockError() { if (mode === 'walk') toast('再点一下画面继续', 1600); }
on(document, 'pointerlockchange', walkLockChange);
on(document, 'pointerlockerror', walkLockError);
function walkHud() {
  const on = mode === 'walk';
  const veh = DRIVE.on || RIDE.on;
  $('#speedo').hidden = !(on && veh); $('#carExit').hidden = !(on && veh && TOUCH); $('#walkCrouch').hidden = on && veh;
  $('#drvGas').hidden = $('#drvBrake').hidden = !(on && DRIVE.on && TOUCH);
  $('#vehView').hidden = !(on && veh && TOUCH);
  $('#xhair').hidden = !on || veh || (!TOUCH && !WALK.noLock && !WALK.locked);
  $('#walkPause').hidden = !on || WALK.noLock || WALK.locked;
  $('#walkPause').classList.toggle('mini', WALK.inspect);
  $('#walkbtns').hidden = !(on && TOUCH); $('#walkpad').hidden = !(on && TOUCH);
  if (!on || $('#xhair').hidden) { WALK.aimOwn = -1; WALK.aim = null; $('#xhair').classList.remove('on'); $('#xhint').hidden = true; }
}
// ---- footsteps (synthesized, no audio files) ----
let AUD = null, GROUND_CTX = null;
function walkAudioWake() {
  if (AUD === false || !WALK.sound) return;
  if (!AUD) {
    try {
      const C = new (window.AudioContext || window.webkitAudioContext)();
      const n = Math.floor(C.sampleRate * 0.3), buf = C.createBuffer(1, n, C.sampleRate), d = buf.getChannelData(0);
      let b = 0; for (let i = 0; i < n; i++) { b = b * 0.55 + (Math.random() * 2 - 1) * 0.45; d[i] = b * Math.pow(1 - i / n, 3); }
      const out = C.createGain(); out.gain.value = 0.5; out.connect(C.destination);
      AUD = { C, buf, out };
    } catch (_) { AUD = false; return; }
  }
  if (AUD.C.state === 'suspended') AUD.C.resume().catch(() => { });
}
function walkAudioClose() { if (AUD) AUD.C.close().catch(() => { }); AUD = null; }
function surfaceHard() {
  const W = WALK;
  if (W.y > 0.05 || onBridge(W.x, W.z)) return true;
  try {
    GROUND_CTX ||= GROUND.canvas.getContext('2d');
    const px = Math.floor((W.x - REG.x0) / REGW * GROUND.canvas.width), py = Math.floor((W.z - REG.z0) / REGH * GROUND.canvas.height);
    const [r, g, b] = GROUND_CTX.getImageData(px, py, 1, 1).data;
    return !(g > r * 1.06 && g > b * 1.12);
  } catch (_) { return true; }
}
function walkSound(kind, k = 1) {
  if (!WALK.sound || !AUD || AUD.C.state !== 'running') return;
  if (kind === 'bell') {
    const { C, out } = AUD, t = C.currentTime;
    for (const [f0, t0] of [[2350, 0], [2350, 0.16]]) for (const f of [f0, f0 * 1.5]) {
      const o = C.createOscillator(), g = C.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + t0); g.gain.exponentialRampToValueAtTime(f === f0 ? 0.22 : 0.08, t + t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + t0 + 0.9);
      o.connect(g); g.connect(out); o.start(t + t0); o.stop(t + t0 + 0.95);
    }
    return;
  }
  if (kind === 'tick') {
    const { C, out } = AUD, t = C.currentTime, o = C.createOscillator(), g = C.createGain(); o.type = 'square'; o.frequency.value = 3200;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03 * k, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.03);
    return;
  }
  if (kind === 'splash' || kind === 'stroke' || kind === 'bump') {
    const { C, buf, out } = AUD, t = C.currentTime, src = C.createBufferSource(), fl = C.createBiquadFilter(), g = C.createGain();
    const len = kind === 'splash' ? 0.7 : kind === 'bump' ? 0.25 : 0.32;
    src.buffer = buf; src.playbackRate.value = kind === 'bump' ? 0.5 : kind === 'splash' ? 0.6 : 0.9; src.loop = kind === 'splash';
    fl.type = kind === 'bump' ? 'lowpass' : 'bandpass'; fl.frequency.value = kind === 'bump' ? 220 : kind === 'splash' ? 900 : 1300; fl.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime((kind === 'splash' ? 0.7 : kind === 'bump' ? 0.9 : 0.22) * k, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(fl); fl.connect(g); g.connect(out); src.start(t); src.stop(t + len + 0.05);
    return;
  }
  const { C, buf, out } = AUD, t = C.currentTime, hard = surfaceHard();
  const src = C.createBufferSource(), fl = C.createBiquadFilter(), g = C.createGain();
  src.buffer = buf; src.playbackRate.value = (hard ? 1.3 : 0.8) * (0.9 + Math.random() * 0.2);
  fl.type = hard ? 'bandpass' : 'lowpass'; fl.frequency.value = hard ? 1500 + Math.random() * 600 : 900 + Math.random() * 300; fl.Q.value = hard ? 1.4 : 0.6;
  const v = (kind === 'land' ? 0.6 : kind === 'jump' ? 0.22 : 0.16 + 0.16 * k) * (hard ? 1 : 0.8), len = kind === 'land' ? 0.22 : hard ? 0.09 : 0.16;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(fl); fl.connect(g); g.connect(out); src.start(t); src.stop(t + len + 0.02);
  if (kind === 'land' || hard) {
    const o = C.createOscillator(), og = C.createGain();
    o.frequency.setValueAtTime(kind === 'land' ? 110 : 150, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(v * 0.5, t + 0.005); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.12);
  }
}
// ---- input ----
LOCK_EL.addEventListener('mousemove', (e) => {
  if (mode !== 'walk' || !WALK.locked || WALK.trans) return;
  const mx = e.movementX || 0, my = e.movementY || 0;
  if (Math.abs(mx) > 400 || Math.abs(my) > 400) return; // some browsers send one bogus jump right after locking
  const k = WALK.sens * camera.fov / WALK_FOV;
  if (RIDE.on) { vehicleLook(RIDE, mx, my, k); return; }
  if (DRIVE.on) { vehicleLook(DRIVE, mx, my, k); return; }
  WALK.yaw -= mx * k; WALK.pitch = clamp(WALK.pitch - my * k, -1.5, 1.5); WALK.faceYaw = null;
});
const WALK_PTR = new Map();
const STICK_R = 52;
let stickC = null, stickId = null;
function stickAt(x, y, start) {
  const pad = $('#walkpad');
  if (start) {
    const pr = pad.parentElement.getBoundingClientRect();
    stickC = { x, y }; pad.style.left = (x - pr.left - pad.offsetWidth / 2) + 'px'; pad.style.top = (y - pr.top - pad.offsetHeight / 2) + 'px'; pad.style.bottom = 'auto';
    pad.classList.add('on');
  }
  let dx = (x - stickC.x) / STICK_R, dy = (y - stickC.y) / STICK_R; const l = Math.hypot(dx, dy);
  WALK.padRun = l > 1.25 && dy < -0.6 * l;
  if (l > 1) { dx /= l; dy /= l; }
  WALK.pad.x = dx; WALK.pad.y = dy;
  $('#walknub').style.transform = `translate(${dx * 36}px, ${dy * 36}px)`;
  pad.classList.toggle('run', WALK.padRun);
}
function stickEnd() {
  const pad = $('#walkpad');
  stickC = null; stickId = null; WALK.pad.x = WALK.pad.y = 0; WALK.padRun = false;
  pad.style.left = pad.style.top = pad.style.bottom = ''; pad.classList.remove('on', 'run'); $('#walknub').style.transform = '';
}
LOCK_EL.addEventListener('pointerdown', (e) => {
  if (mode !== 'walk') return;
  if (e.pointerType === 'mouse' && !WALK.noLock) {
    if (!WALK.locked) { walkLock(); return; }
    if (e.button === 0) walkInspect(); else if (e.button === 2) WALK.zoomOn = true;
    return;
  }
  walkAudioWake();
  const r = LOCK_EL.getBoundingClientRect();
  const stick = e.pointerType === 'touch' && stickId == null && e.clientX - r.left < r.width * 0.42;
  WALK_PTR.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), stick });
  if (stick) { stickId = e.pointerId; stickAt(e.clientX, e.clientY, true); }
  try { LOCK_EL.setPointerCapture(e.pointerId); } catch (_) { }
});
LOCK_EL.addEventListener('pointermove', (e) => {
  if (mode !== 'walk') return;
  const p = WALK_PTR.get(e.pointerId); if (!p) return;
  if (p.stick) { stickAt(e.clientX, e.clientY); return; }
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (WALK.trans) return;
  const k = (e.pointerType === 'touch' ? 0.0052 : 0.0035) * camera.fov / WALK_FOV;
  if (RIDE.on) { vehicleLook(RIDE, dx, dy, k); return; }
  if (DRIVE.on) { vehicleLook(DRIVE, dx, dy, k); return; }
  WALK.yaw -= dx * k; WALK.pitch = clamp(WALK.pitch - dy * k, -1.5, 1.5); WALK.faceYaw = null;
});
function walkPointerEnd(e) {
  if (e.pointerType === 'mouse' && e.button === 2) WALK.zoomOn = false;
  const p = WALK_PTR.get(e.pointerId); if (!p) return;
  WALK_PTR.delete(e.pointerId);
  if (p.stick) { stickEnd(); return; }
  if (mode !== 'walk' || e.type !== 'pointerup') return;
  if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 8 && performance.now() - p.t0 < 300) { const pl = walkPick(e); if (pl) walkInspect(pl); }
}
LOCK_EL.addEventListener('pointerup', walkPointerEnd);
LOCK_EL.addEventListener('pointercancel', walkPointerEnd);
LOCK_EL.addEventListener('wheel', (e) => {
  if (mode !== 'walk') return;
  e.preventDefault();
  WALK.fov = clamp(WALK.fov * (1 + clamp(e.deltaY, -200, 200) * 0.0011), 40, 90);
}, { passive: false });
const keyTarget = (e) => (e.composedPath ? e.composedPath()[0] : e.target);
on(window, 'keydown', (e) => {
  if (mode !== 'walk') return;
  const t = keyTarget(e); if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  // With pointer lock the browser's own Esc releases the mouse and pauses; Esc again leaves exploration.
  if (e.code === 'Escape') { if (!WALK.locked && performance.now() - WALK.unlockT > 400) setMode('orbit'); return; }
  const live = WALK.locked || WALK.noLock;
  if (e.code === 'KeyE' || e.code === 'KeyF') { if (live && !e.repeat) walkInspect(); return; }
  if (RIDE.on && e.code === 'KeyV' && !e.repeat) { RIDE.cam = RIDE.cam === 'fp' ? 'chase' : 'fp'; RIDE.camYaw = 0; RIDE.camW = RIDE.a + Math.PI; RIDE.camPitch = RIDE.cam === 'fp' ? -0.14 : 0.24; RIDE.lookT = 9; return; }
  if (RIDE.on && e.code === 'KeyB' && !e.repeat) { walkSound('bell'); return; }
  if (DRIVE.on && e.code === 'KeyV' && !e.repeat) { DRIVE.cam = DRIVE.cam === 'chase' ? 'seat' : 'chase'; DRIVE.camYaw = 0; DRIVE.camW = DRIVE.a + Math.PI; DRIVE.camPitch = DRIVE.cam === 'chase' ? 0.2 : 0; DRIVE.lookT = 9; return; }
  if (e.code === 'Space') { e.preventDefault(); if (DRIVE.on) { if (live) WALK.keys.add('Space'); return; } if (live && !e.repeat) WALK.jumpBuf = 0.15; return; }
  if (!live) return;
  WALK.keys.add(e.code);
  if (/^Arrow/.test(e.code)) e.preventDefault();
});
on(window, 'keyup', (e) => WALK.keys.delete(e.code));
on(window, 'blur', () => { WALK.keys.clear(); WALK.zoomOn = false; });
$('#walkJump').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); WALK.jumpBuf = 0.15; if (DRIVE.on) WALK.keys.add('Space'); walkAudioWake(); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('#walkJump').addEventListener(ev, () => WALK.keys.delete('Space'));
$('#carExit').addEventListener('click', () => { exitCar(); exitBike(); });
$('#vehView').addEventListener('click', () => {
  const S = DRIVE.on ? DRIVE : RIDE.on ? RIDE : null; if (!S) return;
  S.cam = S.cam === 'chase' ? (S === DRIVE ? 'seat' : 'fp') : 'chase'; S.camYaw = 0; S.camW = S.a + Math.PI; S.camPitch = S.cam === 'chase' ? (S === DRIVE ? 0.2 : 0.24) : (S === DRIVE ? 0 : -0.14); S.lookT = 9;
});
for (const [id, key] of [['#drvGas', 'gas'], ['#drvBrake', 'brake']]) {
  const el = $(id);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); DRIVE[key] = true; walkAudioWake(); try { el.setPointerCapture(e.pointerId); } catch (_) { } });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => { DRIVE[key] = false; });
}
$('#walkCrouch').addEventListener('click', (e) => { WALK.crouchOn = !WALK.crouchOn; e.currentTarget.setAttribute('aria-pressed', String(WALK.crouchOn)); });
$('#xhint').addEventListener('click', () => walkInspect());
$('#walkResume').addEventListener('click', () => walkLock());
$('#walkExit').addEventListener('click', () => setMode('orbit'));
$('#walkSound').addEventListener('click', (e) => {
  WALK.sound = !WALK.sound; if (WALK.sound) walkAudioWake();
  e.currentTarget.setAttribute('aria-pressed', String(WALK.sound)); e.currentTarget.textContent = WALK.sound ? '脚步声 开' : '脚步声 关';
});
let TOUR = null;
function tourStops() {
  const lib = byName(/^图书馆$/), adm = byName(/^行政楼$/);
  const S = (title, text, cam, tgt) => ({ title, text, cam: new THREE.Vector3(...cam), tgt: new THREE.Vector3(...tgt) });
  return [
    S('正门 · 龙眠大道 639 号', '地铁 1 号线终点站就在门外。校名石墙刻着官方书法校名，墙后七根灯柱高低错落，三座圆洞景墙沿中轴通向镜湖。', [-403.4, 5, 316.3], [-382.2, 8, 289.5]),
    S('镜湖', '进门第一眼看到的湖。西岸是行政楼与会议中心，湖心三座小岛，岸边垂柳与樱花。', [-470, 48, 210], [-300, 4, 20]),
    S('中心广场与图书馆', '图书馆主楼 7 层，楼顶立着“中国药科大学”红字；柱廊裙房前是宽阔台阶，西侧是药学博物馆的深灰石墙。', lib ? [lib.front.x * 0.4 + lib.c[0] * 0.6 - 25, 14, lib.front.z * 0.4 + lib.c[1] * 0.6 + 55] : [-240, 12, 40], lib ? [lib.c[0], 16, lib.c[1]] : [-160, 14, -60]),
    S('教学楼 A–E', '求知、求实、求真、求新、求同五栋教学楼沿镜湖东侧一字排开，塔楼高出屋面。', [-330, 95, 300], [-110, 10, 70]),
    S('校内河道', '河道两岸是学院科研楼群，楼梯间塔楼顶着白色玻璃“灯笼”，白色步行桥跨河而过。', [10, 22, 170], [120, 8, -110]),
    S('明湖', '带状湖泊自西北向东南蜿蜒，湖心有岛，北岸蓝色健身步道。', [80, 80, -170], [-120, 0, -360]),
    S('兴药楼（新大楼）', '两个“A”形翼楼在西侧交汇，中庭分别覆盖玻璃天窗与光伏板；东侧三条白色弧形楼面向明湖与卵石纹广场。', [110, 150, -520], [-145, 0, -585]),
    S('药用植物园', '校园北部的植物园分东西两区，东区有展示温室。', [180, 90, -540], [340, 4, -720]),
    S('学生公寓', '文萃、文轩、文菁、文澜、文枢、文昌、文思、文德等苑组团，一、二食堂位于组团之间。', [560, 120, 40], [300, 10, -150]),
    S('体育场', '蓝色塑胶跑道的田径场，西侧看台上方是连续拱形的白色膜结构顶棚。', [292, 12, 566], [150, 12, 540]),
    S('校园全景', '江宁校区总体规划占地两千余亩，2012 年 5 月建成启用，成为中国药科大学的中心校区。', [-1000, 820, 980], [-60, 0, -180]),
  ];
}
function startTour() {
  TOUR = { stops: tourStops(), i: -1, t: 0, phase: 'move' };
  $('#tourDots').replaceChildren(...TOUR.stops.map(() => elt('i')));
  nextStop(); $('#tourcap').hidden = false;
}
function nextStop() {
  TOUR.i++; if (TOUR.i >= TOUR.stops.length) { stopTour(); setMode('orbit'); return; }
  const s = TOUR.stops[TOUR.i];
  $('#tourTitle').textContent = s.title; $('#tourText').textContent = s.text;
  [...$('#tourDots').children].forEach((d, k) => d.classList.toggle('on', k === TOUR.i));
  flyTo(s.cam, s.tgt, TOUR.i === 0 ? 2.5 : 5.5, () => { TOUR.phase = 'dwell'; TOUR.t = 0; });
  TOUR.phase = 'move';
}
function stopTour() { TOUR = null; tween = null; $('#tourcap').hidden = true; }

function setMode(m, at) {
  if (m === mode && m !== 'tour') return;
  const prev = mode; mode = m; spin = null;
  ['orbit', 'walk', 'tour'].forEach((k) => $('#m-' + k).setAttribute('aria-pressed', String(k === m)));
  $('#walkBtn').setAttribute('aria-pressed', String(m === 'walk'));
  if (prev === 'tour' && m !== 'tour') stopTour();
  if (m === 'walk') {
    tween = null; controls.enabled = false;
    if (MEAS.on) measureSet(false);
    const e = at || walkEntry();
    WALK.fov = WALK_FOV; enterWalk(e.x, e.z, e.yaw);
    $('#app').classList.add('walking');
    if (innerWidth <= 760 || innerHeight <= 500) setSidebar(false);
    walkHud();
    if (TOUCH) toast('左侧拖动移动，推出圈外冲刺 · 右侧拖动看四周 · 点建筑查看', 5200);
    else if (WALK.noLock) toast('拖动看四周 · WASD 移动 · 空格跳 · Shift 冲刺 · Esc 退出', 5200);
    else walkLock();
    return;
  }
  controls.enabled = true;
  if (prev === 'walk') {
    if (DRIVE.on) exitCar(); if (RIDE.on) exitBike(); setUnderwater(false);
    walkUnlock(); $('#app').classList.remove('walking', 'locked');
    WALK.keys.clear(); WALK.inspect = false; WALK.zoomOn = false; WALK.crouchOn = false;
    $('#walkCrouch').setAttribute('aria-pressed', 'false'); stickEnd(); walkHud(); walkAudioClose();
    const [fx, fz] = walkForward(), tgt = new THREE.Vector3(WALK.x + fx * 14, 0, WALK.z + fz * 14);
    camera.fov = 50; camera.updateProjectionMatrix();
    flyTo(new THREE.Vector3(tgt.x - fx * 120, 90, tgt.z - fz * 120), tgt, 1.4);
  }
  if (m === 'tour') startTour();
}

const mini = $('#minimap'), mctx = mini.getContext('2d');
let MINIBASE = null;
function buildMinimap() {
  const c = mkCanvas(mini.width, mini.height), g = c.getContext('2d');
  g.drawImage(GROUND.canvas, 0, 0, c.width, c.height);
  const sx = c.width / REGW, sz = c.height / REGH;
  g.setTransform(sx, 0, 0, sz, -REG.x0 * sx, -REG.z0 * sz);
  g.fillStyle = 'rgba(40,44,48,.85)';
  for (const b of BLD) { if (b.extra?.special === 'xueyuan') continue; for (const p of b.parts || [b.p]) { g.beginPath(); tracePoly(g, p); g.fill(); } }
  for (const p of XY_PODS) { g.beginPath(); tracePoly(g, p.p); g.fill(); }
  for (const l of XY_LINKS) { g.beginPath(); tracePoly(g, l); g.fill(); }
  g.strokeStyle = 'rgba(179,65,43,.9)'; g.lineWidth = 4; g.beginPath(); tracePoly(g, CAMPUS); g.stroke();
  MINIBASE = c;
}
function drawMinimap() {
  if (!MINIBASE) return;
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.drawImage(MINIBASE, 0, 0);
  const sx = mini.width / REGW, sz = mini.height / REGH;
  const px = (camera.position.x - REG.x0) * sx, pz = (camera.position.z - REG.z0) * sz;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); const a = Math.atan2(dir.z, dir.x);
  const tx = controls.target.x, tz = controls.target.z, range = clamp(camera.position.distanceTo(controls.target) * 0.9, 60, 900);
  mctx.save(); mctx.translate((tx - REG.x0) * sx, (tz - REG.z0) * sz); mctx.rotate(a);
  mctx.fillStyle = 'rgba(255,255,255,.22)'; mctx.beginPath(); mctx.moveTo(0, 0); mctx.arc(0, 0, range * sx, -0.5, 0.5); mctx.closePath(); mctx.fill();
  mctx.restore();
  mctx.fillStyle = '#e2553a'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2;
  mctx.save(); mctx.translate(clamp(px, 4, mini.width - 4), clamp(pz, 4, mini.height - 4)); mctx.rotate(a);
  mctx.beginPath(); mctx.moveTo(9, 0); mctx.lineTo(-6, -6); mctx.lineTo(-3, 0); mctx.lineTo(-6, 6); mctx.closePath(); mctx.fill(); mctx.stroke(); mctx.restore();
}
mini.addEventListener('click', (e) => {
  const r = mini.getBoundingClientRect(), x = clamp(REG.x0 + (e.clientX - r.left) / r.width * REGW, -700, 870), z = clamp(REG.z0 + (e.clientY - r.top) / r.height * REGH, -1060, 845);
  if (mode === 'walk') { enterWalk(x, z, WALK.yaw, { dur: 1.6 }); return; }
  if (mode === 'tour') setMode('orbit');
  const off = camera.position.clone().sub(controls.target);
  flyTo(new THREE.Vector3(x, 0, z).add(off), new THREE.Vector3(x, 0, z), 1.2);
});
function updateHud() {
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  const brg = Math.atan2(d.x, -d.z) * 180 / Math.PI;
  $('#needle').style.transform = `rotate(${-brg}deg)`;
  const dist = camera.position.distanceTo(controls.target);
  if (mode === 'orbit') $('#dim').textContent = (camera.position.y-controls.target.y)/dist > 0.97 ? '3D' : '2D';
  const mpp = 2 * dist * Math.tan(camera.fov * Math.PI / 360) / stage.clientHeight;
  const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((n) => n / mpp > 50) || 1000;
  $('#scaleBar').style.width = Math.round(nice / mpp) + 'px'; $('#scaleTxt').textContent = nice >= 1000 ? '1 km' : nice + ' m';
}
let toastT = 0;
function toast(msg, ms = 3800) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.remove('out');
  clearTimeout(toastT); toastT = setTimeout(() => { t.classList.add('out'); setTimeout(() => { t.hidden = true; }, 400); }, ms);
}
$('#compass').addEventListener('click', () => {
  if (mode === 'walk') { WALK.faceYaw = 0; return; }
  if (mode === 'tour') setMode('orbit');
  const t = controls.target.clone(), off = camera.position.clone().sub(t), hd = Math.hypot(off.x, off.z);
  flyTo(new THREE.Vector3(t.x, camera.position.y, t.z + hd), t, 1.0);
});

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downXY = null;
const activePointers = new Set();
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function screenRay(e) { const r = renderer.domElement.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera); }
function groundPoint(e) { screenRay(e); const hit = ray.intersectObjects(PICKABLE, false)[0]; if (hit) return hit.point.clone(); const p = new THREE.Vector3(); return ray.ray.intersectPlane(GROUND_PLANE, p) ? p : null; }
const MEAS = { on: false, pts: [], line: null, lbls: [] };
function measureClear() {
  if (MEAS.line) { scene.remove(MEAS.line); MEAS.line.geometry.dispose(); MEAS.line = null; }
  for (const l of MEAS.lbls) scene.remove(l);
  MEAS.lbls = []; MEAS.pts = [];
}
function measureSet(on) {
  MEAS.on = on; $('#measure').setAttribute('aria-pressed', String(on)); stage.classList.toggle('cross', on);
  if (!on) measureClear(); else { if (mode !== 'orbit') setMode('orbit'); toast('依次点击地面测量距离，再按一次按钮结束'); }
}
function measureAdd(p) {
  MEAS.pts.push(p.clone().setY(p.y + 0.6));
  if (MEAS.line) { scene.remove(MEAS.line); MEAS.line.geometry.dispose(); }
  const g = new THREE.BufferGeometry().setFromPoints(MEAS.pts);
  MEAS.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#0a84ff', depthTest: false, transparent: true }));
  MEAS.line.renderOrder = 20; scene.add(MEAS.line);
  const dot = document.createElement('div'); dot.className = 'measure-lbl'; dot.appendChild(document.createElement('span'));
  let tot = 0; for (let i = 1; i < MEAS.pts.length; i++) tot += Math.hypot(MEAS.pts[i].x - MEAS.pts[i - 1].x, MEAS.pts[i].z - MEAS.pts[i - 1].z);
  dot.firstChild.textContent = MEAS.pts.length === 1 ? '起点' : (tot >= 1000 ? (tot / 1000).toFixed(2) + ' km' : Math.round(tot) + ' m');
  for (const l of MEAS.lbls) l.element.classList.remove('total');
  if (MEAS.pts.length > 1) dot.classList.add('total');
  const o = new CSS2DObject(dot); o.center.set(0, 0); o.position.copy(MEAS.pts[MEAS.pts.length - 1]); scene.add(o); MEAS.lbls.push(o);
}
$('#measure').addEventListener('click', () => measureSet(!MEAS.on));
on(window, 'keydown', (e) => { if (e.code === 'Escape' && MEAS.on) measureSet(false); });
function zoomBy(k) {
  if (mode === 'walk') { WALK.fov = clamp(WALK.fov * (k < 1 ? 0.82 : 1.2), 34, 80); return; }
  if (mode === 'tour') setMode('orbit');
  const off = camera.position.clone().sub(controls.target), d = clamp(off.length() * k, controls.minDistance, controls.maxDistance);
  flyTo(controls.target.clone().add(off.setLength(d)), controls.target.clone(), 0.5);
}
$('#zIn').addEventListener('click', () => zoomBy(0.55));
$('#zOut').addEventListener('click', () => zoomBy(1.8));
$('#dim').addEventListener('click', () => {
  if (mode !== 'orbit') setMode('orbit');
  const t = controls.target.clone(), off = camera.position.clone().sub(t), d = off.length();
  const flat = off.y / d > 0.97;
  let pos;
  if (flat) { pos = new THREE.Vector3(t.x, t.y + d * Math.sin(0.9), t.z + d * Math.cos(0.9)); $('#dim').textContent = '2D'; }
  else { pos = new THREE.Vector3(t.x, t.y + d, t.z + 0.01); $('#dim').textContent = '3D'; }
  flyTo(pos, t, 0.9);
});
renderer.domElement.addEventListener('dblclick', (e) => {
  if (mode !== 'orbit' || MEAS.on) return;
  const p = groundPoint(e); if (!p) return;
  const off = camera.position.clone().sub(controls.target), d = Math.max(controls.minDistance, off.length() * 0.45);
  flyTo(p.clone().add(off.setLength(d)), p, 0.8);
});
let hoverT = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (mode !== 'orbit' || e.buttons || MEAS.on || TOUCH) return;
  const now = performance.now(); if (now - hoverT < 90) return;
  hoverT = now; screenRay(e);
  const hit = ray.intersectObjects(PICKABLE, false)[0], own = hit ? hit.object.userData.owner?.[hit.faceIndex] : -1;
  stage.classList.toggle('pointer', own != null && own >= 0);
});
renderer.domElement.addEventListener('pointerdown', (e) => { if (mode === 'orbit' && e.button === 0 && !MEAS.on) stage.classList.add('grabbing'); });
on(window, 'pointerup', () => stage.classList.remove('grabbing'));
renderer.domElement.addEventListener('pointerdown', (e) => {
  activePointers.add(e.pointerId);
  if (activePointers.size === 1 && e.button === 0) downXY = {x:e.clientX,y:e.clientY,id:e.pointerId,dragged:false};
  else downXY = null;
  if (mode === 'tour') setMode('orbit');
});
renderer.domElement.addEventListener('pointermove', e => { if (downXY && Math.hypot(e.clientX-downXY.x,e.clientY-downXY.y)>5) downXY.dragged=true; });
renderer.domElement.addEventListener('pointercancel', e => { activePointers.delete(e.pointerId); downXY=null; });
renderer.domElement.addEventListener('pointerup', (e) => {
  activePointers.delete(e.pointerId);
  const tap = downXY; downXY = null;
  if (!tap || tap.id!==e.pointerId || tap.dragged || e.button!==0 || activePointers.size || mode !== 'orbit') return;
  if (MEAS.on) { const p = groundPoint(e); if (p) measureAdd(p); return; }
  screenRay(e);
  const hit = ray.intersectObjects(PICKABLE, false)[0];
  if (!hit) return;
  const own = hit.object.userData.owner?.[hit.faceIndex];
  if (own == null || own < 0) return;
  const b = BLD[own];
  const p = PLACES.find((q) => q.bld && q.bld.includes(own));
  if (p) select(p);
  else select({ name: b.name || '未命名建筑', cat: b.cls.cat || 'teach', bld: [own], x: b.c[0], z: b.c[1], h: b.h });
});
$('#m-orbit').addEventListener('click', () => setMode('orbit'));
$('#m-walk').addEventListener('click', () => setMode('walk'));
$('#walkBtn').addEventListener('click', () => setMode(mode === 'walk' ? 'orbit' : 'walk'));
$('#infoWalk').addEventListener('click', () => { if (!selected) return; if (mode === 'walk') walkToPlace(selected); else { const f = placeFront(selected); setMode('walk', f); } });
$('#m-tour').addEventListener('click', () => { if (mode === 'tour') { setMode('orbit'); return; } setMode('orbit'); setMode('tour'); });
function rotateTip() {
  const tip = $('#rotateTip'), portrait = matchMedia('(orientation: portrait)');
  let dismissed = false;
  try { dismissed = sessionStorage.getItem('campus3d-rotate-tip') === '1'; } catch (_) { }
  const update = () => { tip.hidden = dismissed || !TOUCH || !portrait.matches || innerWidth > 760; };
  const canLock = Boolean(screen.orientation && screen.orientation.lock && document.fullscreenEnabled);
  $('#rotateGo').hidden = !canLock;
  const close = () => { dismissed = true; try { sessionStorage.setItem('campus3d-rotate-tip', '1'); } catch (_) { } update(); };
  $('#rotateLater').addEventListener('click', close);
  $('#rotateGo').addEventListener('click', async () => {
    try { await $('#app').requestFullscreen({ navigationUI: 'hide' }); await screen.orientation.lock('landscape'); } catch (_) { }
    close();
  });
  on(portrait, 'change', update);
  update();
}
function setSidebar(open) { $('#sidebar').dataset.open = String(open); $('#m-menu').setAttribute('aria-pressed', String(open)); }
$('#m-menu').addEventListener('click', () => setSidebar($('#sidebar').dataset.open !== 'true'));
$('#infoClose').addEventListener('click', () => { $('#info').hidden = true; selected = null; highlight({}); LABELS.forEach((L) => L.el.classList.remove('sel')); root.querySelectorAll('.row').forEach((el) => el.setAttribute('aria-current', 'false')); });
$('#infoFly').addEventListener('click', () => selected && flyToPlace(selected));
// Scrubbing takes the clock over: the running clock used to rewrite the slider under the finger every 120 ms
// (the thumb jumped back and forth) and wrapped 22:30 back to 5:00 (the thumb snapped to the left end).
let timeScrub = false;
const endTimeScrub = () => { timeScrub = false; };
$('#time').addEventListener('pointerdown', () => { timeScrub = true; setAutoTime(false); });
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'change', 'blur']) $('#time').addEventListener(ev, endTimeScrub);
$('#time').addEventListener('input', (e) => { if (autoTime) setAutoTime(false); hour = parseFloat(e.target.value); applyTime(); });
function setAutoTime(on) { autoTime = on; const b = $('#timePlay'); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? '暂停时间流逝' : '开始时间流逝'); }
$('#timePlay').addEventListener('click', () => setAutoTime(!autoTime));
const SEASON_NAMES = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
function setSeason(sn) { season = sn; root.querySelectorAll('[data-season]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.season === sn))); $('#seasonCycle').textContent = SEASON_NAMES[sn]; applySeason(); }
$('#seasonCycle').addEventListener('click', () => { const k = Object.keys(SEASON_NAMES); setSeason(k[(k.indexOf(season) + 1) % 4]); toast(SEASON_NAMES[season] + '季', 1400); });
$('#sceneOptionsToggle').addEventListener('click', () => {
  const on = $('#sceneOptions').classList.toggle('open');
  $('#sceneOptionsToggle').setAttribute('aria-expanded', String(on));
});
on(root, 'pointerdown', e => {
  if (!e.target.closest('#sceneOptions, #sceneOptionsToggle')) { $('#sceneOptions').classList.remove('open'); $('#sceneOptionsToggle').setAttribute('aria-expanded', 'false'); }
});
root.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', () => {
  setSeason(b.dataset.season);
}));
$('#t-labels').addEventListener('click', (e) => { labelsOn = !labelsOn; e.currentTarget.setAttribute('aria-pressed', String(labelsOn)); labelRenderer.domElement.style.display = labelsOn ? '' : 'none'; });
$('#t-shadow').addEventListener('click', (e) => { const on = !sunLight.castShadow; sunLight.castShadow = on; renderer.shadowMap.enabled = on; scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); }); e.currentTarget.setAttribute('aria-pressed', String(on)); });
$('#t-water').addEventListener('click', () => setWaterReflect(!waterObj.visible));
$('#t-life').addEventListener('click', (e) => { const on = LIFE_ON = !LIFE_ON; LIFE.forEach((m) => { m.visible = on; }); TRAINS.forEach((T) => T.cars.forEach((c) => { c.userData.hide = !on; })); e.currentTarget.setAttribute('aria-pressed', String(on)); });
if (!renderer.shadowMap.enabled) $('#t-shadow').setAttribute('aria-pressed', 'false');
const onResize = () => {
  if (DISPOSED || !stage.clientWidth || !stage.clientHeight) return;
  const w = stage.clientWidth, h = stage.clientHeight; setViewSize(w, h, viewPR); labelRenderer.setSize(w, h);
};
on(window, 'resize', onResize);
if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(onResize); ro.observe(stage); CLEANUP.push(() => ro.disconnect()); }

let last = performance.now(), frameN = 0;
const _lp = new THREE.Vector3();
function labelHidden(L) {
  const a = camera.position, b = L.obj.position, own = L.place?.bld || [];
  const len = a.distanceTo(b), n = Math.min(90, Math.ceil(len / 5));
  for (let i = 1; i < n * 0.97; i++) {
    const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    if (y > 130) continue;
    for (const k of BGRID.at(x, z)) {
      const B = BLD[k];
      if (y < B.h && !own.includes(k) && x >= B.bb[0] && x <= B.bb[2] && z >= B.bb[1] && z <= B.bb[3] && (B.parts || [B.p]).some((q) => pip(x, z, q))) return true;
    }
  }
  return false;
}
const LABEL_UI = ['#sidebar', '#info:not([hidden])', '#dock', '.mapctl', '#mini', '#scale', '#tourcap:not([hidden])', '.legal'];
function updateLabels() {
  if (!labelsOn) return;
  const sr = stage.getBoundingClientRect(), W = sr.width, H = sr.height, cp = camera.position, items = [], placed = [];
  for (const q of LABEL_UI) for (const e of root.querySelectorAll(q)) { const r = e.getBoundingClientRect(); if (r.width > 1 && r.height > 1) placed.push([r.left - sr.left - 6, r.right - sr.left + 6, r.top - sr.top - 6, r.bottom - sr.top + 6]); }
  const scale = W < 760 ? 0.6 : 1;
  for (const L of LABELS) {
    const sel = L.el.classList.contains('sel'), d = cp.distanceTo(L.obj.position);
    L.vis = sel || d <= (mode === 'walk' ? Math.min(L.max, 420) : L.max) * scale;
    if (!L.vis) continue;
    _lp.copy(L.obj.position).project(camera);
    if (_lp.z > 1 || Math.abs(_lp.x) > 1.1 || Math.abs(_lp.y) > 1.1) { L.vis = false; continue; }
    if (!sel && labelHidden(L)) { L.vis = false; continue; }
    items.push({ L, x: (_lp.x + 1) / 2 * W, y: (1 - _lp.y) / 2 * H, pr: (sel ? 100 : L.prio) + (L.shown ? 0.8 : 0) - d * 0.002 });
  }
  items.sort((a, b) => b.pr - a.pr);
  for (const it of items) {
    const L = it.L;
    if (!L.w) { L.w = L.pin.offsetWidth; L.h = L.pin.offsetHeight; L.g = L.pin.firstChild.offsetWidth; }
    const w = L.w || 90, h = L.h || 22, g = L.g || 22;
    const r = L.kind === 'water' ? [it.x - w / 2 - 4, it.x + w / 2 + 4, it.y - h / 2 - 3, it.y + h / 2 + 3] : [it.x - g / 2 - 3, it.x - g / 2 + w + 5, it.y - h / 2 - 3, it.y + h / 2 + 3];
    if (r[0] < 6 || r[1] > W - 6 || r[2] < 6 || r[3] > H - 6 || placed.some((q) => r[0] < q[1] && r[1] > q[0] && r[2] < q[3] && r[3] > q[2])) L.vis = false; else placed.push(r);
  }
  for (const L of LABELS) { const on = !!L.vis; if (on !== L.shown) { L.shown = on; L.el.classList.toggle('off', !on); } }
}
const _sm = new THREE.Matrix4();
function updateShadowCam() {
  if (!sunLight.castShadow) return;
  const c = mode === 'walk' ? camera.position : controls.target;
  const r = mode === 'walk' ? 120 : Math.min(700, 90 * Math.pow(1.2, Math.round(Math.log(clamp(camera.position.distanceTo(controls.target) * 0.8, 90, 700) / 90) / Math.log(1.2))));
  const cam = sunLight.shadow.camera;
  const desired=FILMING?QP.shadow:QUALITY==='high'?(PERF.lvl>=2?2048:4096):QP.shadow;
  if(desired!==sunLight.shadow.mapSize.x){sunLight.shadow.map?.dispose();sunLight.shadow.map=null;sunLight.shadow.mapSize.set(desired,desired);shadowDirty=true;}
  if (cam.right !== r) { cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 4000; cam.updateProjectionMatrix(); shadowDirty = true; }
  const texel = (2 * r) / sunLight.shadow.mapSize.x, sx = Math.round(c.x / texel) * texel, sz = Math.round(c.z / texel) * texel;
  if (Math.abs(sunLight.target.position.x - sx) > texel || Math.abs(sunLight.target.position.z - sz) > texel) shadowDirty = true;
  const dir = SUN.y > 0.02 ? SUN : new THREE.Vector3(0.3, 0.6, 0.2).normalize();
  sunLight.target.position.set(sx, 0, sz); sunLight.position.set(sx + dir.x * 1500, dir.y * 1500, sz + dir.z * 1500);
}
let FILMING = false, REVIEW_PAUSED = false, FRAME_SAMPLE = null;
const VIEW_OFF = { x: 0, y: 0 };
// Keep the picked place in the part of the map the info card leaves free.
function updateViewOffset(dt) {
  const card = $('#info'), W = stage.clientWidth, H = stage.clientHeight;
  let tx = 0, ty = 0;
  if (!FILMING && mode !== 'walk' && card && !card.hidden && W && H) {
    const sr = stage.getBoundingClientRect(), r = card.getBoundingClientRect(), left = r.left - sr.left, top = r.top - sr.top;
    if (left > W * 0.4) tx = (W - left + 12) / 2;
    else if (top > H * 0.3) ty = (H - top + 12) / 2;
  }
  const k = Math.min(1, dt * 6);
  VIEW_OFF.x += (tx - VIEW_OFF.x) * k; VIEW_OFF.y += (ty - VIEW_OFF.y) * k;
  if (Math.abs(VIEW_OFF.x) < 0.5 && Math.abs(VIEW_OFF.y) < 0.5 && !tx && !ty) { if (camera.view && camera.view.enabled) camera.clearViewOffset(); return; }
  camera.setViewOffset(W, H, VIEW_OFF.x, VIEW_OFF.y, W, H);
}
function loop(now) {
  if (DISPOSED) return;
  if (FILMING || REVIEW_PAUSED) { last = now; RAF = requestAnimationFrame(loop); return; }
  if (document.hidden) { last = now; RAF = requestAnimationFrame(loop); return; }
  if ((TOUCH || REDUCED_MOTION.matches) && now - last < 1000 / 30 - 0.5) { RAF = requestAnimationFrame(loop); return; }
  const rdt = (now - last) / 1000, dt = Math.min(0.05, rdt); last = now; frameN++;
  if (frameN > 180 && rdt < 0.5) trackPerf(rdt);
  uTime.value += dt;
  if (autoTime && !timeScrub) {
    hour += dt * (hour >= 19.5 || hour < 6.2 ? 1 / 4 : 1 / 12); if (hour > 22.5) hour = 5;
    if (now - timeApplyAt > 120) { timeApplyAt = now; $('#time').value = hour; applyTime(); }
  }
  if (spin && !tween && mode === 'orbit') { spin.t += dt; const off = camera.position.clone().sub(controls.target).applyAxisAngle(_Y, dt * 0.085 * Math.min(1, spin.t / 1.6)); camera.position.copy(controls.target).add(off); }
  if (tween) {
    tween.t += dt / tween.dur; const k = ease(Math.min(1, tween.t));
    camera.position.lerpVectors(tween.p0, tween.p1, k);
    const lift = Math.sin(Math.PI * Math.min(1, tween.t)) * Math.min(160, tween.p0.distanceTo(tween.p1) * 0.18);
    camera.position.y += lift;
    controls.target.lerpVectors(tween.t0, tween.t1, k);
    camera.lookAt(controls.target);
    if (tween.t >= 1) { const d = tween.done; tween = null; d && d(); }
  } else if (mode === 'orbit' && !camera.userData.reviewLock) controls.update(dt);
  else if (mode === 'walk') updateWalk(dt);
  if (mode === 'tour' && TOUR && TOUR.phase === 'dwell') {
    TOUR.t += dt;
    const s = TOUR.stops[TOUR.i], ang = dt * 0.05, off = camera.position.clone().sub(s.tgt); off.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang); camera.position.copy(s.tgt).add(off); camera.lookAt(s.tgt);
    if (TOUR.t > 4.5) nextStop();
  }
  if (waterObj && waterObj.visible) waterObj.material.uniforms.time.value += dt * 0.5;
  updatePeople(dt, now / 1000); updateCars(dt); updateTrains(dt); updateChunks(); updateGrass();
  TRAINS.forEach((T) => T.cars.forEach((c) => { if (c.userData.hide) c.visible = false; }));
  updateParticles(dt); updateTreeLOD(); updateTreeFade(dt);
  if (HL) HL.material.opacity = 0.16 + 0.08 * Math.sin((now - HL.userData.t0) * 0.004);
  updateShadowCam();
  updateViewOffset(dt);
  const submitStart = performance.now();
  renderFrame();
  if (FRAME_SAMPLE && now > FRAME_SAMPLE.start) {
    FRAME_SAMPLE.intervals.push(rdt*1000); FRAME_SAMPLE.submit.push(performance.now()-submitStart);
    if (FRAME_SAMPLE.intervals.length >= FRAME_SAMPLE.count) FRAME_SAMPLE.finish();
  }
  if (labelsOn) labelRenderer.render(scene, camera);
  if (frameN % 3 === 0) updateLabels();
  if (frameN % 6 === 0) { drawMinimap(); updateHud(); }
  RAF = requestAnimationFrame(loop);
}


async function boot() {
  try {
    const jobs=[
      ['载入校徽与字体',async()=>{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,1500))]);await imgReady(CALLI);}],
      ['准备材质',initMaterials],['绘制周边地表',paintOuter],['规划周边道路',buildOuterMask],['建造周边建筑',buildCity],
      ['绘制校园与施工区',paintGround],['规划步道与绿地',buildMask],['建造校园建筑',buildBuildings],
      ['建造校门与施工设施',()=>{buildGate();buildNortheastSite();}],
      ['布置湖岸景观',()=>{lakeSteps();buildFlags();pavilion(-10,-150);pavilion(-38,-297);pavilion(-124,-274,2.6);pavilion(300,-760,2.8);pavilion(-268,45,2.2);}],
      ['建造桥梁与围栏',()=>{buildBridges();buildShoreline();buildFence();buildCurbs();}],['建造轨道与高架',buildRail],
      ['布置体育设施',()=>{buildSports();buildCourtFences();}],['构建远景',buildHills],['合并建筑与贴图',flushBuffers],['生成水面',buildWater],
      ['布置校园树木',placeTrees],['布置周边树木',placeOuterTrees],['布置北侧林地苗圃',placeNorthTrees],
      ['铺设地表与树荫',()=>{clearTreesFromBuildings();paintTreeShade();buildGround();}],['生成树木模型',()=>{buildTrees();buildGrass();}],
      ['布置绿篱与路灯',()=>{buildHedges();buildLamps();}],['布置单车与行人',()=>{buildBikes();buildPeople();}],
      ['布置车辆与列车',()=>{buildCars();buildTrains();}],['准备地标与小地图',()=>{initGrid();buildPlaces();buildPlaceList();buildMinimap();}],
      ['设置四季与光照',()=>{buildParticles();applySeason();tuneEnv();}],
      ['准备画面效果',()=>{initComposer();updateTreeLOD(true);updateShadowCam();}],
      ['上传场景贴图',uploadSceneTextures],
      ['编译场景着色器',async()=>{if(renderer.compileAsync)await renderer.compileAsync(scene,camera);}],
      ['绘制首帧',()=>{updatePeople(0,0);updateCars(0);updateTrains(0);renderFrame();labelRenderer.render(scene,camera);updateLabels();drawMinimap();updateHud();}],
    ];
    LOAD_STATE.total=jobs.length;$('#loading .bar').setAttribute('aria-valuemax',String(jobs.length));
    for(const [label,work] of jobs)await loadStage(label,work);
    LOAD_STATE.readyAt=performance.now();$('#loadMsg').textContent=`准备就绪 · ${jobs.length}/${jobs.length}`;
    $('#loading').classList.add('done'); setTimeout(() => { $('#loading').hidden = true; }, 300);
    setSidebar(innerWidth > 760 && innerHeight > 500);
    rotateTip();
    setTimeout(() => toast(TOUCH ? '单指拖动平移 · 双指缩放旋转 · 点按建筑查看' : '拖动平移 · 右键或 Ctrl+拖动旋转倾斜 · 滚轮缩放 · 双击放大', 5200), 900);
    RAF = requestAnimationFrame(loop);
  } catch (err) {
    if (DISPOSED) return;
    console.error(err);
    $('#loadMsg').textContent = '加载失败，请刷新页面重试（' + (err && err.message ? err.message : err) + '）';
  }
}

boot();
return function dispose() {
  if (DISPOSED) return;
  DISPOSED = true;
  cancelAnimationFrame(RAF);
  for (const fn of CLEANUP.splice(0)) { try { fn(); } catch (_) { } }
  try { walkUnlock(); walkAudioClose(); } catch (_) { }
  try { controls.enabled = false; } catch (_) { }
  try {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); }
    });
  } catch (_) { }
  try { composer && composer.dispose && composer.dispose(); } catch (_) { }
  try { renderer.dispose(); renderer.forceContextLoss(); } catch (_) { }
};
}
