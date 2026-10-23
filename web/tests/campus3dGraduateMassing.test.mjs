import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import * as metadata from '../src/views/services/campus3d/placeMetadata.js';
import * as construction from '../src/views/services/campus3d/constructionSites.js';
import * as research from '../src/views/services/campus3d/researchCenters.js';
import * as access from '../src/views/services/campus3d/coveredAccess.js';
import * as graduate from '../src/views/services/campus3d/graduateResidences.js';

const base=new URL('../src/views/services/campus3d/',import.meta.url),app=readFileSync(new URL('app.js',base),'utf8');
const slice=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b));
const fn=name=>{const start=app.indexOf(`function ${name}(`);return app.slice(start,app.indexOf('\nfunction ',start+1));};
const ctx=vm.createContext({THREE,...metadata,...construction,...research,...access,...graduate,
  opts:{data:JSON.parse(readFileSync(new URL('osm-data.json',base),'utf8')),outer:JSON.parse(readFileSync(new URL('osm-outer.json',base),'utf8'))},
  root:{querySelector(){}},matchMedia:()=>({matches:false}),navigator:{hardwareConcurrency:8},groundAt:()=>0,
});
vm.runInContext([
  slice('const D =','const stage ='),slice('class GB {','function textCanvas('),fn('buildGraduate'),
  slice('const BGRID =','// Building picks'),fn('camBlocked'),slice('function camFloor(','// ---------- free exploration'),
  'const building=BLD.find(b=>b.name===GRADUATE_RESIDENCE.name);buildGraduate(building);BLD.forEach((b,i)=>BGRID.add(i,b.bb));',
].join('\n'),ctx);
const model=vm.runInContext('({building,BUFS,pArea,pip,camBlocked,camFloor,INFO})',ctx);
const c=graduate.GRADUATE_RESIDENCE;
const points={north:[558,-375],link:[542,-336],south:[596,-315]};

test('splitting the estimated envelope preserves its ground area and two dorm identities',()=>{
  const b=model.building,area=p=>Math.abs(model.pArea(p));
  assert.ok(Math.abs(b.volumes.reduce((s,v)=>s+area(v.p),0)-area(b.p))<1e-7);
  for(const [role,point] of Object.entries(points)) {
    assert.equal(b.volumes.filter(v=>model.pip(...point,v.p)).length,1);
    assert.ok(model.pip(...point,b.volumes.find(v=>v.role===role).p));
  }
  assert.deepEqual(metadata.dormSummary([b]).codes,['H6','H7']);
});

test('rendered roof heights and camera occupancy agree over the low link and both towers',()=>{
  const meshes=Object.values(model.BUFS).map(b=>new THREE.Mesh(b.geo(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
  meshes.forEach(m=>m.updateMatrixWorld());
  for(const [role,[x,z]] of Object.entries(points)) {
    const roof=role==='link'?c.modelLinkRoof:c.modelTowerRoof;
    const ray=new THREE.Raycaster(new THREE.Vector3(x,40,z),new THREE.Vector3(0,-1,0));
    const hits=ray.intersectObjects(meshes,false);
    assert.ok(hits.length);
    assert.ok(Math.abs(hits[0].point.y-roof)<1e-5,`${role} rendered roof`);
    assert.ok(model.camBlocked(x,1.65,z),`${role} remains solid at ground level`);
    assert.equal(model.camBlocked(x,12,z),role!=='link',`${role} upper airspace`);
    const parapet=role==='link'?c.modelLinkParapet:c.modelTowerParapet;
    assert.ok(Math.abs(model.camFloor(x,z)-(roof+parapet+1.8))<1e-8,`${role} camera floor`);
  }
  meshes.forEach(m=>{m.geometry.dispose();m.material.dispose();});
});

test('the lower connection no longer produces a wall across mid-height sightlines',()=>{
  const meshes=Object.values(model.BUFS).map(b=>new THREE.Mesh(b.geo(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
  meshes.forEach(m=>m.updateMatrixWorld());
  const ray=new THREE.Raycaster(new THREE.Vector3(500,12,-336),new THREE.Vector3(1,0,0),0,65);
  assert.equal(ray.intersectObjects(meshes,false).length,0);
  ray.ray.origin.y=1.65;
  assert.ok(ray.intersectObjects(meshes,false).length>0,'ground wall is retained');
  meshes.forEach(m=>{m.geometry.dispose();m.material.dispose();});
});

test('details keep heights, ground registration and individual building numbers qualified',()=>{
  const info=model.INFO[c.name];
  assert.match(info.d,/尚未确认南北单栋与楼号/);
  assert.match(info.s,/模型估算/);
  assert.match(info.s,/屋顶侧向偏移未作为基底坐标/);
  assert.ok(info.links.some(s=>s.url.includes('a209587')));
  const facts=metadata.buildingFacts({unit:true},[model.building]);
  assert.ok(facts.some(([k,v])=>k==='模型体量'&&v==='两栋主体 · 低层连接体'));
  assert.ok(facts.some(([k])=>k==='模型高度'));
});
