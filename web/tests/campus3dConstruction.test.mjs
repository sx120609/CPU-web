import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { NATATORIUM, DORM_GROUP_INFO, buildingFacts, buildingListMeta } from '../src/views/services/campus3d/placeMetadata.js';
import { ACTIVITY_CENTER, GRADUATE_PHASE_FIVE } from '../src/views/services/campus3d/constructionSites.js';
import * as research from '../src/views/services/campus3d/researchCenters.js';
import * as graduate from '../src/views/services/campus3d/graduateResidences.js';
import * as access from '../src/views/services/campus3d/coveredAccess.js';

const base = new URL('../src/views/services/campus3d/', import.meta.url);
const app = readFileSync(new URL('app.js', base), 'utf8');
const slice = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));
// Exercise the shipped vertex builders, wall extraction, wall grid, spawn search,
// and movement resolver. Only external actors and terrain outside this flat site
// are absent; no renderer, WebGL, database, or test-only collider is substituted.
const ctx = vm.createContext({
  THREE, NATATORIUM, ACTIVITY_CENTER, GRADUATE_PHASE_FIVE, DORM_GROUP_INFO, ...research, ...access,...graduate,
  opts: {
    data: JSON.parse(readFileSync(new URL('osm-data.json', base), 'utf8')),
    outer: JSON.parse(readFileSync(new URL('osm-outer.json', base), 'utf8')),
  },
  root: { querySelector() {} }, matchMedia: () => ({ matches: false }), navigator: { hardwareConcurrency: 8 },
  groundAt: () => 0, walkable: () => true, addSign() {},
  TREES: [], LAMP_POS: [], PED_GRID: null, PEOPLE: null, CARS: null, NET: { others: new Map() },
  WALK: { y: 0, swim: false }, WALK_R: 0.38, STEP_UP: 0.5, WATER_Y: 0.32,
});
vm.runInContext([
  slice('const D =', 'const stage ='),
  slice('class GB {', 'function textCanvas('),
  slice('function buildActivityCenter(', 'function buildNortheastSite('),
  slice('const BGRID =', '// Building picks'),
  slice('function walkPolys(', 'const onBridge ='),
  slice('function walkSpot(', 'const walkForward ='),
  slice('function camBlocked(', '// Third-person boom'),
  'const activity = BLD.find(b => b.cls.special === "activityConstruction");',
  'buildActivityCenter(activity); collisionGrids(); BLD.forEach((b, i) => BGRID.add(i, b.bb));',
].join('\n'), ctx);
const model = vm.runInContext('({ BLD, D, activity, BUFS, WSEG, WCAPS, WCYL, pip, pCentroid, edgeOutward, sampleAt, cumLen, walkResolve, walkSpot, camBlocked })', ctx);

test('the old finished activity-center block is replaced by the dated construction parcel', () => {
  assert.equal(model.BLD.filter(b => /活动中心/.test(b.name)).length, 1);
  assert.equal(model.activity.name, '大学生活动中心');
  assert.equal(model.activity.cls.special, 'activityConstruction');
  assert.ok(model.activity.p === ACTIVITY_CENTER.site);
  assert.equal(model.D.pa.filter(p => p.n === '二食堂东侧防护通道').length, 1);
  const facts = buildingFacts({}, [model.activity]);
  assert.equal(buildingListMeta([model.activity]), '在建');
  assert.equal(facts[1][1], '三层楼面浇筑（2026-09）');
  assert.ok(!facts.some(([key]) => /层数|建筑高度/.test(key)), 'construction slab count must not become a claim about final floor count');
});

test('the fenced parcel and covered passage keep the surrounding streets and canteen clear', () => {
  const canteen = model.BLD.find(b => b.name === '学生第二食堂');
  const shell = ACTIVITY_CENTER.shell;
  assert.ok(shell.every(p => model.pip(...p, ACTIVITY_CENTER.site)));
  const roadWidths = { unclassified: 7, residential: 6, service: 4.5 };
  for (const road of model.D.r) {
    if (!road.p.some(([x,z]) => x > 250 && x < 420 && z > -30 && z < 90)) continue;
    const c = model.cumLen(road.p), L = c[c.length - 1], half = (roadWidths[road.t] || 6) / 2;
    for (let s = 0; s <= L; s += 0.5) {
      const q = model.sampleAt(road.p, c, s);
      for (const side of [-half, 0, half]) assert.ok(!model.pip(q.x - q.dz * side, q.z + q.dx * side, ACTIVITY_CENTER.site), `road clearance at ${q.x},${q.z}`);
    }
  }
  const c = model.cumLen(ACTIVITY_CENTER.passage), L = c[c.length - 1];
  for (let s = 0; s <= L; s += 0.5) {
    const q = model.sampleAt(ACTIVITY_CENTER.passage, c, s);
    for (const side of [-2.4, 0, 2.4]) {
      const p = [q.x - q.dz * side, q.z + q.dx * side];
      assert.ok(!model.pip(...p, ACTIVITY_CENTER.site));
      assert.ok(!model.pip(...p, canteen.p), 'passage does not clip the canteen wall');
    }
  }
});

test('rendered buffers have finite vertices, an open frame, and the intended illustrated height', () => {
  let vertexCount = 0, highest = 0;
  for (const buffer of Object.values(model.BUFS)) {
    const geometry = buffer.geo(), points = geometry.getAttribute('position');
    for (let i = 0; i < points.count; i++) {
      assert.ok([points.getX(i), points.getY(i), points.getZ(i)].every(Number.isFinite));
      highest = Math.max(highest, points.getY(i));
    }
    vertexCount += points.count;
    geometry.dispose();
  }
  assert.ok(vertexCount > 500 && vertexCount < 15000);
  assert.ok(Math.abs(highest - ACTIVITY_CENTER.modelHeight) < 1e-5);
  assert.ok(!Object.keys(model.BUFS).some(key => key.startsWith('f:')), 'no completed facade is drawn');
});

test('the actual movement resolver stops walkers at every side of the rendered hoarding', () => {
  for (let edge = 0; edge < ACTIVITY_CENTER.site.length; edge++) {
    const e = model.edgeOutward(ACTIVITY_CENTER.site, edge);
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      let x = e.a[0] + e.dx * e.len * t + e.nx * 2, z = e.a[1] + e.dz * e.len * t + e.nz * 2;
      for (let step = 0; step < 30; step++) [x, z] = model.walkResolve(x - e.nx * 0.15, z - e.nz * 0.15, 0);
      assert.ok(!model.pip(x, z, ACTIVITY_CENTER.site), `crossed fence on edge ${edge}`);
    }
  }
});

test('protected passage is traversable at ground level, including both open ends', () => {
  const path = ACTIVITY_CENTER.passage, c = model.cumLen(path), L = c[c.length - 1];
  for (let s = 0; s <= L; s += 0.25) {
    const q = model.sampleAt(path, c, s), [x, z] = model.walkResolve(q.x, q.z, 0);
    assert.ok(Math.hypot(x - q.x, z - q.z) < 1e-6, `passage blocked at ${s} m`);
    assert.ok(!model.camBlocked(q.x, 1, q.z));
  }
});

test('free-exploration spawn at the site center is relocated outside the hoarding', () => {
  const [x, z] = model.pCentroid(ACTIVITY_CENTER.site), [px, pz] = model.walkSpot(x, z);
  assert.ok(!model.pip(px, pz, ACTIVITY_CENTER.site));
  assert.ok(Math.hypot(px - x, pz - z) < 200);
  assert.ok(!model.camBlocked(px, 1, pz));
});
