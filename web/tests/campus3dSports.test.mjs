import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneContext} from './helpers/campus3dScene.mjs';
import {sportsPitches,VOLLEYBALL_PITCHES,courtFrame,courtGroups,sportsPlaces} from '../src/views/services/campus3d/sportsGrounds.js';

function fixture(){
  const world=sceneContext({variables:['SPORTS_PITCHES','COURT_MASK_CANVAS']}),fills=[];
  const g=new Proxy({fill(){fills.push(this.fillStyle);}}, {get:(o,k)=>o[k]??(()=>{})});
  world.ctx.sportsCanvas=g;world.run('paintSports(sportsCanvas)');
  return {...world,fills,m:world.run('({D,COURTS,STADIUM,SPORTS_PITCHES,BLD,BUFS,WSEG,pip,pBox,pArea,rectPoly,buildCourtNet,collisionGrids,walkResolve,hardCourtAt,surfaceHard})')};
}

test('six missing volleyball bays fit the photographed parcel without replacing existing pitches',()=>{
  const {m}=fixture();assert.equal(m.COURTS.filter(c=>c.type==='volleyball').length,6);
  assert.equal(m.COURTS.filter(c=>c.type==='tennis').length,6);
  assert.equal(m.COURTS.filter(c=>c.type==='basketball').length,23);
  assert.equal(sportsPitches(m.SPORTS_PITCHES).length,m.SPORTS_PITCHES.length,'supplementing twice is idempotent');
  for(const q of VOLLEYBALL_PITCHES){
    const bb=m.pBox(q.p);assert.ok(bb[0]>=348&&bb[2]<=386.1&&bb[1]>=257&&bb[3]<=308);
    const center=[(bb[0]+bb[2])/2,(bb[1]+bb[3])/2];
    assert.ok(!m.BLD.some(b=>m.pip(...center,b.p)),'not inside a building');
    assert.ok(!m.D.pi.some(p=>p.k==='pitch'&&m.pip(...center,p.p)),'no duplicate or overlapping source court');
  }
});

test('basketball searches produce three local groups with every pin inside one of its actual courts',()=>{
  const {m}=fixture(),groups=courtGroups(m.COURTS,'basketball');
  assert.deepEqual(groups.map(g=>g.members.length),[6,10,7]);
  for(const g of groups){
    assert.ok(g.members.some(c=>m.pip(g.x,g.z,m.rectPoly(c.ob.cx,c.ob.cz,c.ob.L,c.ob.W,c.ob.ang))));
    assert.ok(g.members.every(c=>Math.hypot(c.ob.cx-g.x,c.ob.cz-g.z)<100));
  }
  const places=sportsPlaces(m.COURTS).filter(p=>p.name.startsWith('篮球'));
  assert.deepEqual(places.map(p=>p.name),['篮球场（北区）','篮球场（体育场东北侧）','篮球场（体育场东南侧）']);
  assert.ok(places.every(p=>p.src.includes('影像')&&p.src.includes('不能据此确认')&&p.links.length));
});

test('each net crosses its own court and its collision permits going around the post',()=>{
  const {m}=fixture(),courts=m.COURTS.filter(c=>['tennis','volleyball'].includes(c.type));
  courts.forEach(m.buildCourtNet);m.collisionGrids();
  for(const c of courts){
    const f=courtFrame(c),half=c.type==='tennis'?6.4:5;
    const wall=m.WSEG.find(w=>Math.hypot((w[0]+w[2])/2-f.x,(w[1]+w[3])/2-f.z)<1e-6&&Math.abs(Math.hypot(w[2]-w[0],w[3]-w[1])-half*2)<1e-6);
    assert.ok(wall,'a net spans the court center');
    assert.ok(Math.abs((wall[2]-wall[0])*f.ux+(wall[3]-wall[1])*f.uz)<1e-6,'net is perpendicular to play');
    const x=f.x+f.ux*.15,z=f.z+f.uz*.15,q=m.walkResolve(x,z,0,.3);
    assert.ok(Math.hypot(q[0]-x,q[1]-z)>.1,'net is solid at walking height');
    const side=half+.5,px=f.x-f.uz*side,pz=f.z+f.ux*side,r=m.walkResolve(px,pz,0,.3);
    assert.ok(Math.hypot(r[0]-px,r[1]-pz)<1e-6,'walker can pass outside the net span');
  }
  assert.ok(Object.values(m.BUFS).every(b=>b.p.length&&b.p.every(Number.isFinite)));
});

test('repainting sports does not duplicate nets or searchable court counts',()=>{
  const world=fixture(),count=world.m.COURTS.length;
  world.run('paintSports(sportsCanvas)');assert.equal(world.m.COURTS.length,count);
});

test('place provenance retains the different acquisition dates within one stitched sports image',()=>{
  const {m}=fixture(),places=sportsPlaces(m.COURTS);
  assert.ok(places.find(p=>p.name==='排球场').src.includes('2024-01-12'));
  assert.ok(places.find(p=>p.name==='网球场').src.includes('2025-04-06'));
  assert.ok(places.find(p=>p.name==='篮球场（北区）').src.includes('2025-06-16'));
  for(const p of places.filter(p=>p.name.includes('体育场'))){assert.ok(p.src.includes('2024-01-12'));assert.ok(p.src.includes('2025-04-06'));}
});

test('green painted courts are treated as hard surfaces while football and nearby lawn remain separate',()=>{
  const world=fixture(),m=world.m;
  for(const c of m.COURTS){const f=courtFrame(c);assert.equal(m.hardCourtAt(f.x,f.z),c.type!=='soccer');}
  assert.equal(m.hardCourtAt(370,240),false,'nearby lawn is not turned into a hard court');
  world.ctx.GROUND={canvas:{width:1720,height:2120}};
  world.ctx.GROUND_CTX={getImageData:()=>({data:[50,150,50,255]})};
  const f=courtFrame(m.COURTS.find(c=>c.type==='volleyball'));
  Object.assign(world.ctx.WALK,{x:f.x,z:f.z,y:0});assert.equal(m.surfaceHard(),true,'footsteps use court geometry before grass-color heuristics');
});
