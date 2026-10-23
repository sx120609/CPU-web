import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { NATATORIUM, DORM_LETTER, DORM_GROUP_INFO, dormSummary, heightLabel, buildingFacts, geometrySource } from '../src/views/services/campus3d/placeMetadata.js';
import { ACTIVITY_CENTER, GRADUATE_PHASE_FIVE } from '../src/views/services/campus3d/constructionSites.js';
import * as research from '../src/views/services/campus3d/researchCenters.js';
import * as graduate from '../src/views/services/campus3d/graduateResidences.js';
import * as access from '../src/views/services/campus3d/coveredAccess.js';

const base = new URL('../src/views/services/campus3d/', import.meta.url);
const app = readFileSync(new URL('app.js', base), 'utf8');
const data = JSON.parse(readFileSync(new URL('osm-data.json', base), 'utf8'));
const outer = JSON.parse(readFileSync(new URL('osm-outer.json', base), 'utf8'));
// Run the shipped model's data preparation, including its supplementary buildings.
// This catches disagreements between actual OSM polygons, additions, and displayed units.
const model = vm.runInNewContext(app.slice(app.indexOf('const D ='), app.indexOf("const stage =")) + '\n({ BLD, obb, edgeOutward, edgeFacing })', {
  opts: { data, outer }, root: { querySelector() {} }, matchMedia: () => ({ matches: false }), navigator: { hardwareConcurrency: 8 }, NATATORIUM, ACTIVITY_CENTER, GRADUATE_PHASE_FIVE, DORM_GROUP_INFO, THREE, ...research, ...access,...graduate,
});

test('real dorm polygons count unique numbered buildings, including shared footprints', () => {
  const expected = { 文轩苑: 8, 文菁苑: 9, 文萃苑: 6, 文澜苑: 6, 文枢苑: 6, 文昌苑: 6, 文思苑: 10, 文华苑: 3, 文正苑: 4, 文德苑: 1 };
  for (const [group, count] of Object.entries(expected)) {
    const buildings = Array.from(model.BLD).filter(b => b.name.startsWith(group));
    assert.equal(dormSummary(buildings).count, count, group);
  }
  const d = Array.from(model.BLD).filter(b => b.name.startsWith('文澜苑'));
  assert.equal(d.length, 7, 'D2 retains both geometry parts');
  assert.deepEqual(dormSummary(d).codes, ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
  const h = Array.from(model.BLD).filter(b => b.name.startsWith('文正苑'));
  assert.equal(h.length, 3, 'H6/H7 retains its shared model');
  assert.deepEqual(dormSummary(h).codes, ['H4', 'H5', 'H6', 'H7']);
});

test('duplicate parts and ordering do not change dorm identity', () => {
  const parts = [{ name: '文澜苑2号楼' }, { name: '文澜苑1号楼' }, { name: '文澜苑2号楼' }];
  assert.deepEqual(dormSummary(parts).codes, ['D1', 'D2']);
  assert.equal(dormSummary(parts.slice().reverse()).count, 2);
  assert.equal(dormSummary([{ name: '文正苑6、7号楼' }]).count, 2);
  assert.deepEqual(dormSummary([]), { count: 0, numbers: [], codes: [] });
});

test('G11 uses its own mapped outline rather than a graduate phase-four photo model',()=>{
  const mapped=data.b.find(b=>b.id===553917100);
  const buildings=Array.from(model.BLD).filter(b=>b.name==='文德苑');
  assert.equal(buildings.length,1);
  assert.equal(buildings[0].osm,mapped.id);
  assert.deepEqual(JSON.parse(JSON.stringify(buildings[0].p)),mapped.p);
  assert.equal(buildings[0].src,'osm');
});

test('natatorium roof and parapet use the announced 14.8 m height, not the former 16.6 m', () => {
  const b = Array.from(model.BLD).find(b => b.cls.special === 'natatorium');
  assert.equal(b.h, 14.8, 'model initialization and view framing');
  const topSurfaces = [], signs = [];
  const context = {
    ...model, NATATORIUM, b, insetPoly: p => p,
    addWalls: (_material, _p, _y0, y1) => topSurfaces.push(y1),
    addCap: (_material, _p, y) => topSurfaces.push(y),
    addParapet: (_material, _p, y, height) => topSurfaces.push(y + height),
    addBox: (_material, _x, y, _z, _l, _w, height) => topSurfaces.push(y + height),
    addBeam() {}, addSign: text => signs.push(text),
  };
  vm.runInNewContext(app.slice(app.indexOf('function buildNatatorium('), app.indexOf('function buildStation(')) + '\nbuildNatatorium(b);', context);
  assert.ok(Math.abs(Math.max(...topSurfaces) - 14.8) < 1e-9);
  assert.equal(b.h, 14.8, 'completed model and place metadata');
  assert.deepEqual(signs, ['游泳馆']);
  assert.equal(heightLabel([b]), '14.8 m');
});

test('facts distinguish project dimensions from estimated model footprint and height', () => {
  const pool = Array.from(model.BLD).find(b => b.cls.special === 'natatorium');
  const verified = buildingFacts({}, [pool]);
  assert.deepEqual(verified.slice(0, 2), [['层数（项目公告）', '地上 2 层 · 地下 1 层'], ['建筑高度（项目公告）', '14.8 m']]);
  assert.equal(verified[2][0], '模型占地');
  assert.match(verified[2][1], /^约 /);
  const library = Array.from(model.BLD).find(b => b.name === '图书馆');
  assert.equal(buildingFacts({}, [library])[1][0], '模型高度');
  assert.match(heightLabel([library]), /^约 /);
  const dorm = Array.from(model.BLD).filter(b => b.name.startsWith('文澜苑'));
  assert.deepEqual(buildingFacts({ dorm: true }, dorm)[0], ['楼栋', '6 栋']);
  assert.deepEqual(buildingFacts({}, []), []);
});

test('place preparation preserves both D2 parts and all H6/H7 geometry while counting physical units', () => {
  const groups = ['文澜苑', '文正苑'];
  const places = groups.map(name => ({ name, dorm: true, bld: Array.from(model.BLD).flatMap((b, i) => b.name.startsWith(name) ? [i] : []) }));
  vm.runInNewContext(app.slice(app.indexOf('const MAP_NAMES ='), app.indexOf('function placeFacts(')) + '\nmapNames();', {
    BLD: model.BLD, PLACES: places, DORM_LETTER, dormSummary, LIB_PLAZA: { x: 0, z: 0 },
  });
  assert.equal(places[0].name, 'D 文澜苑');
  assert.equal(places[0].dormCount, 6);
  assert.equal(places[0].sub, '学生公寓 · 6 栋 · D1 D2 D3 D4 D5 D6');
  assert.equal(places[0].bld.length, 7);
  assert.equal(places[1].name, 'H4–7 文正苑');
  assert.equal(places[1].dormCount, 4);
  assert.equal(places[1].sub, '学生公寓 · 4 栋 · H4 H5 H6 H7');
  assert.equal(places[1].dormGroup, '文正苑');
  assert.equal(places.find(p => p.name === 'H6·H7').dormGroup, '文正苑');
  assert.equal(DORM_GROUP_INFO[places[1].dormGroup].nameConfirmed, true);
  assert.equal(places.find(p => p.name === 'D2').bld.length, 2);
  assert.equal(places.find(p => p.name === 'H6·H7').bld.length, 1);
});

test('verified dimensions retain dated official sources', () => {
  assert.equal(NATATORIUM.sources.length, 3);
  for (const source of NATATORIUM.sources) assert.match(source.url, /^https:\/\/[^/]*\.cpu\.edu\.cn\//);
  assert.equal(NATATORIUM.checked, '2026-10-23');
});

test('satellite-only buildings do not claim OpenStreetMap footprint provenance', () => {
  const h = Array.from(model.BLD).filter(b => b.name.startsWith('文正苑'));
  assert.equal(geometrySource(h), '轮廓：卫星影像近似重建');
  const d = Array.from(model.BLD).filter(b => b.name.startsWith('文澜苑'));
  assert.equal(geometrySource(d), '轮廓：OpenStreetMap');
  assert.equal(geometrySource([d[0], h[0]]), '轮廓：OpenStreetMap、卫星影像近似重建');
  assert.equal(geometrySource([{ src: 'map-inferred' }]), '轮廓：校园地图换算');
  assert.equal(geometrySource([]), '校园地图位置示意');
});
