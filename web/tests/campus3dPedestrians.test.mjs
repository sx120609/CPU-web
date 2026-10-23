import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sceneContext } from './helpers/campus3dScene.mjs';

const world=sceneContext();
world.run('buildBuildings();buildBridges();collisionGrids();BLD.forEach((b,i)=>BGRID.add(i,b.bb));buildPeople();');
const m=world.run('({PEOPLE,D,BLD,BRIDGES,pip,groundAt,inWater,onBridge,cumLen,sampleAt,offsetLine,roadW,walkResolve,pedestrianSegmentClear})');
world.ctx.camera=new THREE.PerspectiveCamera();world.ctx.mode='orbit';
world.run('lifeView=()=>{};lifeSeen=()=>true;vehicleThreat=()=>null;');

test('the former source route reproduces a collision in the actual generated walls',()=>{
  let hits=0;
  const c=m.cumLen(m.D.pa[24].p),L=c[c.length-1];
  for(let s=0;s<L;s+=.5){const q=m.sampleAt(m.D.pa[24].p,c,s);for(const lat of [-.7,0,.7]){
    const x=q.x-q.dz*lat,z=q.z+q.dx*lat,[xx,zz]=m.walkResolve(x,z,m.groundAt(x,z),.3);
    if(Math.hypot(xx-x,zz-z)>.01)hits++;
  }}
  assert.ok(hits>100,'source path crosses drawn geometry, not just a footprint projection');
});

test('all prepared route lanes clear the independent walking resolver, water and construction parcel',()=>{
  assert.ok(m.PEOPLE.routes.length>150,'do not make the test pass by removing campus activity');
  assert.ok(m.PEOPLE.routes.reduce((n,r)=>n+r.L,0)>24000);
  let samples=0,bridgeSamples=0;
  for(const r of m.PEOPLE.routes)for(let i=0;i<=Math.ceil(r.L/.5);i++){
    const s=Math.min(i*.5,r.L);
    const q=m.sampleAt(r.p,r.cum,s);
    for(const lat of [-.7,0,.7]){
      const x=q.x-q.dz*lat,z=q.z+q.dx*lat,y=m.groundAt(x,z);
      const [xx,zz]=m.walkResolve(x,z,y,.3);
      assert.ok(Math.hypot(xx-x,zz-z)<.01,`${r.id} has a drawn wall at ${s}`);
      assert.ok(!m.inWater(x,z)||m.onBridge(x,z),`${r.id} enters water`);
      assert.ok(!m.pip(x,z,world.ctx.ACTIVITY_CENTER.site),`${r.id} enters construction parcel`);
      if(m.inWater(x,z))bridgeSamples++;
      samples++;
    }
  }
  assert.ok(samples>140000);
  assert.ok(bridgeSamples>100,'bridges must retain pedestrian traffic');
});

test('spawns are outside solids and the protected canteen passage remains usable',()=>{
  for(const p of m.PEOPLE.list){
    let x=p.x,z=p.z;
    if(!p.stand){const q=m.sampleAt(p.r.p,p.r.cum,p.s);x=q.x-q.dz*p.lat;z=q.z+q.dx*p.lat;}
    assert.ok(m.pedestrianSegmentClear([x,z],[x,z]));
  }
  const passage=m.D.pa.find(p=>p.n==='二食堂东侧防护通道');
  assert.ok(m.pedestrianSegmentClear(passage.p[0],passage.p[1]));
});

test('clear endpoints cannot authorize a dodge through a thin wall',()=>{
  // A small isolated wall exercises swept motion independently of footprint
  // interiors. Both endpoints are on clear ground in the scene.
  const a=[798,800],b=[802,800];
  assert.ok(m.pedestrianSegmentClear(a,b),'fixture starts on unobstructed ground');
  world.run('const testWall=WSEG.length;recWall(800,790,800,810,0,2);WGRID.add(testWall,[798.9,788.9,801.1,811.1]);');
  assert.ok(m.pedestrianSegmentClear(a,a));
  assert.ok(m.pedestrianSegmentClear(b,b));
  assert.equal(m.pedestrianSegmentClear(a,b),false);
  world.ctx.camera.position.set(a[0],100,a[1]);
  const person=m.PEOPLE.list[0],original=m.PEOPLE.list;
  const fixture={...person,stand:true,x:a[0],z:a[1],a:0,cx:a[0],cz:a[1],ox:0,oz:0,tx:4,tz:0,wait:2};
  try{
    m.PEOPLE.list=[fixture];world.run('updatePeople(1,1);');
    assert.equal(fixture.cx,a[0]);assert.equal(fixture.cz,a[1]);
  }finally{m.PEOPLE.list=original;}
});

test('the real animation updater keeps moving actors clear and uses their final ground height',()=>{
  world.ctx.camera.position.set(0,800,0);
  for(let i=0;i<60;i++){
    world.run(`updatePeople(.05,${i*.05});`);
    for(const p of m.PEOPLE.list){
      if(p.cx==null)continue;
      assert.ok(m.pedestrianSegmentClear([p.cx,p.cz],[p.cx,p.cz]));
      assert.ok(Math.abs(p.cy-m.groundAt(p.cx,p.cz))<=.035001);
    }
  }
});

test('a bridge-side dodge recomputes height at the final position instead of using a cached ground value',()=>{
  let point;
  for(const r of m.PEOPLE.routes){
    for(let s=1;s<r.L-1;s+=1){const q=m.sampleAt(r.p,r.cum,s),end=[q.x+q.dx*.1,q.z+q.dz*.1];
      if(m.inWater(q.x,q.z)&&m.groundAt(...end)>.1&&m.pedestrianSegmentClear([q.x,q.z],end)){point={q,end};break;}
    }
    if(point)break;
  }
  assert.ok(point);
  const {q,end}=point,original=m.PEOPLE.list;
  const p={...original[0],stand:true,x:q.x,z:q.z,cx:q.x,cz:q.z,a:0,ox:q.dx*.1,oz:q.dz*.1,tx:q.dx*.1,tz:q.dz*.1,wait:2,gy:-999};
  world.ctx.camera.position.set(q.x,100,q.z);
  try{
    m.PEOPLE.list=[p];world.run('updatePeople(0,0);');
    assert.ok(Math.abs(p.cx-end[0])<1e-7);
    assert.ok(Math.abs(p.cy-m.groundAt(...end))<1e-7);
  }finally{m.PEOPLE.list=original;}
});

test('tree trunks are included in route clearance without changing tree positions',()=>{
  world.ctx.SPECIES={camphor:{tr:.4,rx:1}};
  const tree={x:750,z:800,type:'camphor',s:1};
  world.ctx.TREES.push(tree);world.run('trunkGrid();');
  try{
    assert.equal(m.pedestrianSegmentClear([748,800],[752,800]),false);
    assert.ok(m.pedestrianSegmentClear([748,800],[748,800]));
    assert.deepEqual([tree.x,tree.z],[750,800]);
  }finally{world.ctx.TREES.pop();world.run('trunkGrid();');}
});

test('instanced street props use the same footprint clearance as walking collision',()=>{
  assert.ok(m.pedestrianSegmentClear([718,800],[722,800]));
  world.run('const propFixture=PROPS.length;PROPS.push({inst:true,top:1.2,p:rectPoly(720,800,1.8,.7,0),bb:[719.1,799.65,720.9,800.35]});PGRID.add(propFixture,PROPS[propFixture].bb);');
  try{assert.equal(m.pedestrianSegmentClear([718,800],[722,800]),false);}
  finally{world.run('PROPS.pop();PGRID.m.clear();PROPS.forEach((q,i)=>{if(q.bb&&!q.skip)PGRID.add(i,q.bb);});');}
});
