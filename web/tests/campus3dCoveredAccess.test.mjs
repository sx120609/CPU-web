import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import * as metadata from '../src/views/services/campus3d/placeMetadata.js';
import * as construction from '../src/views/services/campus3d/constructionSites.js';
import * as research from '../src/views/services/campus3d/researchCenters.js';
import * as graduate from '../src/views/services/campus3d/graduateResidences.js';
import * as access from '../src/views/services/campus3d/coveredAccess.js';

const base=new URL('../src/views/services/campus3d/',import.meta.url),app=readFileSync(new URL('app.js',base),'utf8');
const slice=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b));
const fn=name=>{const s=app.indexOf(`function ${name}(`),e=app.indexOf('\nfunction ',s+1);return app.slice(s,e);};
const ctx=vm.createContext({
  THREE,...metadata,...construction,...research,...access,...graduate,
  opts:{data:JSON.parse(readFileSync(new URL('osm-data.json',base),'utf8')),outer:JSON.parse(readFileSync(new URL('osm-outer.json',base),'utf8'))},
  root:{querySelector(){}},matchMedia:()=>({matches:false}),navigator:{hardwareConcurrency:8},
  roofClutter(){},academicRoof(){},groundAt:()=>0,
  TREES:[],LAMP_POS:[],PED_GRID:null,PEOPLE:null,CARS:null,NET:{others:new Map()},WALK:{y:0,swim:false},WALK_R:0.38,STEP_UP:0.5,WATER_Y:0.32,
});
vm.runInContext([
  slice('const D =','const stage ='),slice('class GB {','function textCanvas('),fn('buildCoveredLab'),
  slice('const BGRID =','// Building picks'),slice('function walkPolys(','const onBridge ='),fn('camBlocked'),
  'const building=BLD.find(b=>b.osm===SAFETY_CENTER_PASSAGE.buildingWay);buildCoveredLab(building);collisionGrids();BLD.forEach((b,i)=>BGRID.add(i,b.bb));',
].join('\n'),ctx);
const model=vm.runInContext('({D,building,BUFS,pArea,pip,walkResolve,camBlocked})',ctx);
const C=access.SAFETY_CENTER_PASSAGE;
const midpoint=[(C.centerline[0][0]+C.centerline[1][0])/2,(C.centerline[0][1]+C.centerline[1][1])/2];

test('source covered semantics are retained on the specific OSM connection',()=>{
  const road=model.D.r.find(r=>r.osm===970880295);
  assert.ok(road?.covered);
  assert.equal(model.building.cls.special,'coveredLab');
  assert.equal(C.sourceVersion,1);
});

test('ground pieces and the opening exactly partition the mapped H plan',()=>{
  const b=model.building,area=p=>Math.abs(model.pArea(p));
  assert.ok(Math.abs(area(b.p)-area(b.coveredPassage.opening)-b.groundParts.reduce((s,p)=>s+area(p),0))<1e-7);
  assert.ok(!b.groundParts.some(p=>model.pip(...midpoint,p)));
  assert.ok(model.pip(...midpoint,b.p));
});

test('actual walking collision and camera checks permit the ground passage',()=>{
  const [a,b]=C.centerline,dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),ux=dx/l,uz=dz/l;
  let [x,z]=[a[0]-ux*3,a[1]-uz*3];
  for(let s=0;s<l+6;s+=0.1){
    [x,z]=model.walkResolve(x+ux*0.1,z+uz*0.1,0);
    assert.ok(!model.camBlocked(x,1.65,z));
  }
  assert.ok(Math.hypot(x-(b[0]+ux*3),z-(b[1]+uz*3))<0.15);
});

test('the ground-view approach lies on the mapped access axis outside the building',()=>{
  const [x,z]=access.passageApproach(C);
  assert.ok(!model.camBlocked(x,1.65,z));
  assert.ok(!model.pip(x,z,model.building.p));
  const [a,b]=C.centerline;
  assert.ok(Math.abs((x-b[0])*(b[1]-a[1])-(z-b[1])*(b[0]-a[0]))<1e-8);
  const view=vm.runInNewContext(fn('placeFront')+'\nplaceFront(place)',{
    walkSpot:(x,z)=>[x,z],
    place:{x:model.building.c[0],z:model.building.c[1],viewFrom:[x,z],viewTarget:C.centerline[0]},
  });
  const fx=-Math.sin(view.yaw),fz=-Math.cos(view.yaw),dx=a[0]-x,dz=a[1]-z;
  assert.ok(Math.abs(fx*dz-fz*dx)<1e-8,'view aims along the passage, not the off-axis building centroid');
});

test('adjacent ground walls and the upper connection remain solid',()=>{
  const [x,z]=midpoint;
  assert.ok(model.camBlocked(x,C.modelClearance+0.2,z));
  assert.ok(model.camBlocked(x,1.65,z-C.modelWidth/2-0.5));
  let px=C.centerline[0][0]+3,pz=z-C.modelWidth/2-0.5;
  for(let i=0;i<160;i++)[px,pz]=model.walkResolve(px-0.1,pz,0);
  assert.ok(px>C.centerline[0][0],'cannot walk through the neighboring wall');
});

test('rendered triangle mesh has a visible ceiling and no eye-level wall across the passage',()=>{
  const meshes=Object.values(model.BUFS).map(b=>new THREE.Mesh(b.geo(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
  meshes.forEach(m=>m.updateMatrixWorld());
  const [a,b]=C.centerline,dir=new THREE.Vector3(b[0]-a[0],0,b[1]-a[1]).normalize();
  const horizontal=new THREE.Raycaster(new THREE.Vector3(a[0]-dir.x*2,1.65,a[1]-dir.z*2),dir,0,Math.hypot(b[0]-a[0],b[1]-a[1])+4);
  assert.equal(horizontal.intersectObjects(meshes,false).length,0);
  const up=new THREE.Raycaster(new THREE.Vector3(midpoint[0],1,midpoint[1]),new THREE.Vector3(0,1,0));
  assert.ok(Math.abs(up.intersectObjects(meshes,false)[0].point.y-C.modelClearance)<1e-6);
  const ceiling=model.BUFS.concrete;
  assert.ok(ceiling.n.filter((_,i)=>i%3===1).every(y=>y<-.99),'ceiling faces down into the passage');
  meshes.forEach(m=>{m.geometry.dispose();m.material.dispose();});
});

test('splitting rejects a zero-length or nonpositive-width passage',()=>{
  assert.throws(()=>access.splitCoveredGround(model.building.p,[[0,0],[0,0]],4));
  assert.throws(()=>access.splitCoveredGround(model.building.p,C.centerline,0));
});
