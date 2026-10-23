import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {sceneContext} from './helpers/campus3dScene.mjs';
import {STADIUM_STAND as spec,stadiumStandLayout} from '../src/views/services/campus3d/stadiumStand.js';

const world=sceneContext();
world.run(`STADIUM=obb(D.pi.find(q=>q.s==='soccer'&&pCentroid(q.p)[0]<250).p);buildStadiumStand(STADIUM);collisionGrids();rebuildPropGrid();`);
const m=world.run('({STADIUM,BUFS,WCYL,INFO,walkResolve,walkSpot,pip})'),layout=stadiumStandLayout(m.STADIUM);

test('fifteen narrower canopy bays follow the dated roof silhouette instead of a straight oversized rectangle',()=>{
  assert.equal(spec.bays,15);
  const backMid=layout.roof(7,.5,0),backEnd=layout.roof(0,0,0),frontMid=layout.roof(7,.5,1),frontEnd=layout.roof(0,0,1);
  assert.ok(backEnd[0]-backMid[0]>15,'rear outline curves east at the end');
  assert.ok(frontEnd[0]-frontMid[0]>5,'front edge also tapers');
  assert.ok(frontMid[0]-backMid[0]>frontEnd[0]-backEnd[0]+8);
  // Independent pixel observations converted with the saved mosaic's georeference.
  // This verifies the chosen projected silhouette, not its true ground footprint.
  assert.ok(Math.abs(backMid[0]-122.87)<1);
  assert.ok(Math.abs(frontMid[0]-141.37)<2);
  assert.ok(Math.abs(layout.roof(0,0,0)[2]-490.85)<1);
  assert.ok(Math.abs(layout.roof(14,1,0)[2]-610.95)<1);
});

test('generated membrane triangles cover each bay and stay finite within the declared model height envelope',()=>{
  const mesh=new THREE.Mesh(m.BUFS.membrane.geo(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld();
  for(let bay=0;bay<15;bay++)for(const t of [.25,.75]){
    const p=layout.roof(bay,.5,t),ray=new THREE.Raycaster(new THREE.Vector3(p[0],40,p[2]),new THREE.Vector3(0,-1,0));
    const hits=ray.intersectObject(mesh);assert.ok(hits.length,`bay ${bay+1}`);assert.ok(Math.abs(hits[0].point.y-p[1])<.03);
  }
  assert.ok(Object.values(m.BUFS).every(b=>b.p.every(Number.isFinite)));
  for(let i=1;i<m.BUFS.membrane.p.length;i+=3)assert.ok(m.BUFS.membrane.p[i]>=17&&m.BUFS.membrane.p[i]<21);
  mesh.geometry.dispose();mesh.material.dispose();
});

test('the tapered body leaves the track-side strip clear while rear support columns remain solid',()=>{
  for(let z=475;z<=627;z+=.5){const q=m.walkResolve(160,z,0,.38);assert.ok(Math.hypot(q[0]-160,q[1]-z)<1e-6,`front strip at ${z}`);}
  const columns=m.WCYL.filter(c=>c[2]===.38&&c[4]>16);assert.equal(columns.length,16);
  for(const c of columns){const q=m.walkResolve(c[0],c[1],0,.38);assert.ok(Math.hypot(q[0]-c[0],q[1]-c[1])>.38);}
  assert.ok(m.pip(130,551,layout.footprint));assert.equal(m.pip(130,485,layout.footprint),false,'curved ends do not retain a rectangular wall');
});

test('stadium details distinguish observed form from estimated heights and seat rows',()=>{
  const info=m.INFO['体育场'];assert.ok(info.s.includes('15段'));
  assert.ok(info.s.includes('高度、座席排数'));assert.ok(info.s.includes('近似重建'));
  assert.ok(spec.links.some(s=>s.url==='https://jjh.cpu.edu.cn/article/17192'));
});

test('a jump target inside the solid stand base is moved outside instead of trapping a walker in the floor',()=>{
  assert.ok(m.pip(145,551,layout.footprint));
  const point=m.walkSpot(145,551);assert.equal(m.pip(...point,layout.footprint),false);
  const resolved=m.walkResolve(...point,0,.38);assert.ok(Math.hypot(point[0]-resolved[0],point[1]-resolved[1])<1e-6);
});
