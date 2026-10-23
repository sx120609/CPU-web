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

const base=new URL('../src/views/services/campus3d/',import.meta.url);
const source=readFileSync(new URL('app.js',base),'utf8');
const data=JSON.parse(readFileSync(new URL('osm-data.json',base),'utf8'));
const outer=JSON.parse(readFileSync(new URL('osm-outer.json',base),'utf8'));
const fn=name=>{const s=source.indexOf(`function ${name}(`),e=source.indexOf('\nfunction ',s+1);return source.slice(s,e);};
const ctx=vm.createContext({
  THREE,...metadata,...construction,...research,...access,...graduate,opts:{data,outer},root:{querySelector(){}},matchMedia:()=>({matches:false}),navigator:{hardwareConcurrency:8},
  MAT:{stoneWarm:{},'roof:light':{}},plainMat:()=>({}),baseAO:x=>x,
  // Roof clutter and lettering do not affect eye-level wall crossings; ground
  // walls, portico, terraces, columns, flags and rock geometry execute unchanged.
  roofClutter(){},addSign(){},FLAGS:[],LIB_PLAZA:{},LIB_TREES:[],STEP_SURF:[],
});
vm.runInContext([
  source.slice(source.indexOf('const D ='),source.indexOf('const stage =')),
  source.slice(source.indexOf('class GB {'),source.indexOf('function textCanvas(')),
  fn('framedUpper'),fn('addGeo'),fn('addDisc'),fn('buildLibrary'),
  'const library=BLD.find(b=>b.name==="图书馆"); buildLibrary(library);',
].join('\n'),ctx);
const model=vm.runInContext('({D,BUFS,WSEG,sampleAt,cumLen})',ctx);
const oldManual=[[-278,245],[-250,200],[-206,154],[-194.5,141],[-186,114],[-172.4,60.6],[-160,20],[-140,0],[-108,-36],[-89,-58],[-66,-84]];
function wallHits(path) {
  const hits=[];
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1];
    for(const w of model.WSEG) {
      if(w[4]>=1.3||w[5]<=1.3)continue;
      const ex=w[2]-w[0],ez=w[3]-w[1],den=dx*ez-dz*ex;
      if(Math.abs(den)<1e-9)continue;
      const u=((w[0]-a[0])*ez-(w[1]-a[1])*ex)/den,v=((w[0]-a[0])*dz-(w[1]-a[1])*dx)/den;
      if(u>0&&u<1&&v>=0&&v<=1)hits.push([a[0]+dx*u,a[1]+dz*u]);
    }
  }
  return hits;
}

test('the former manual Yicheng line crosses actual library walls at pedestrian height',()=>{
  assert.ok(wallHits(oldManual).length>0,'fixture must reproduce the old rendered collision, not merely a footprint overlap');
});

test('Yicheng uses the image-supported source centerline without crossing library walls',()=>{
  const road=model.D.r.find(r=>r.n==='以诚路'),original=data.r.find(r=>r.n==='以诚路');
  assert.deepEqual(Array.from(road.p,p=>Array.from(p)),original.p);
  assert.equal(wallHits(road.p).length,0);
  assert.equal(road.wide,24,'retains the paved boulevard, not a newly narrowed road');
});

test('the source centerline is also clear in the generated triangle mesh',()=>{
  const meshes=Object.values(model.BUFS).map(b=>new THREE.Mesh(b.geo(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
  meshes.forEach(m=>m.updateMatrixWorld());
  const road=model.D.r.find(r=>r.n==='以诚路'),c=model.cumLen(road.p),L=c[c.length-1];
  const ray=new THREE.Raycaster();
  for(let s=0;s<L;s+=0.5){
    const a=model.sampleAt(road.p,c,s),b=model.sampleAt(road.p,c,Math.min(L,s+0.5));
    const dir=new THREE.Vector3(b.x-a.x,0,b.z-a.z),length=dir.length();
    ray.set(new THREE.Vector3(a.x,1.3,a.z),dir.normalize());ray.far=length;
    assert.equal(ray.intersectObjects(meshes,false).length,0,`wall crossing near ${a.x},${a.z}`);
  }
  meshes.forEach(m=>{m.geometry.dispose();m.material.dispose();});
});
