import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {vehicleScene} from './helpers/campus3dVehicles.mjs';

function parkCar(m,x,z,a=0){
  m.CARS.parkedM[0]=new THREE.Matrix4().compose(new THREE.Vector3(x,m.groundAt(x,z),z),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-a,0)),new THREE.Vector3(1,1,1));
  m.WALK.keys.clear();m.enterCar(0);
}
function bridgeCenter(m){
  const bridge=m.BRIDGES.find(b=>{const p=m.pCentroid(b.p);return p[0]>0&&Math.abs(m.pArea(b.p))>200&&m.groundAt(...p)>.9;});
  assert.ok(bridge);return m.pCentroid(bridge.p);
}
const matches=(v,p)=>assert.ok(Math.hypot(v.x-p[0],v.y-p[1],v.z-p[2])<1e-6);

test('entering a vehicle positions its mesh immediately, even if settings pause the first update',()=>{
  const {model:m}=vehicleScene();const [x,z]=bridgeCenter(m);
  parkCar(m,x,z);m.WALK.menu=true;
  matches(m.DRIVE.root.position,[m.DRIVE.x,m.DRIVE.y,m.DRIVE.z]);
  m.exitCar();m.WALK.menu=false;m.enterBike(0);m.WALK.menu=true;
  matches(m.RIDE.root.position,[m.RIDE.x,m.RIDE.y,m.RIDE.z]);
});

test('parking a driven car on an actual generated bridge preserves the deck height',()=>{
  const {model:m}=vehicleScene();const [x,z]=bridgeCenter(m),height=m.groundAt(x,z);
  parkCar(m,x,z);m.updateDrive(0);m.exitCar();
  assert.ok(Math.abs(m.CARS.parkedM[0].elements[13]-height)<1e-6);
  assert.equal(m.DRIVE.root.visible,false);assert.equal(m.CARS.taken,-1);
  assert.ok(Number.isFinite(m.WALK.y));
  m.enterCar(0);assert.ok(Math.abs(m.DRIVE.y-height)<1e-6);
});

test('parked bicycle collision follows pickup and re-parking rather than leaving a ghost at its old location',()=>{
  const {model:m}=vehicleScene(),[oldX,oldZ]=m.BIKE_SPOTS[0];
  const displacement=(x,z)=>{const q=m.walkResolve(x,z,m.groundAt(x,z));return Math.hypot(q[0]-x,q[1]-z);};
  assert.ok(displacement(oldX,oldZ)>.1,'the visible parked bicycle is solid');
  m.enterBike(0);assert.ok(displacement(oldX,oldZ)<1e-6,'pickup clears the old collision');
  const [x,z]=bridgeCenter(m);m.RIDE.x=x;m.RIDE.z=z;m.exitBike();
  assert.ok(displacement(oldX,oldZ)<1e-6);assert.ok(displacement(x,z)>.1,'new parking position is solid');
  const [chunk,index]=m.bikeSlot(0),matrix=new THREE.Matrix4();chunk.getMatrixAt(index,matrix);
  assert.ok(Math.abs(matrix.elements[13]-m.groundAt(x,z))<1e-6);
  m.enterBike(0);assert.ok(displacement(x,z)<1e-6);
  m.exitBike({swim:true});assert.ok(displacement(x,z)<1e-6,'discarded bicycle remains absent');
});

test('boost-speed car motion does not tunnel across the actual construction hoarding',()=>{
  const world=vehicleScene();
  const report=world.run(`(()=>{const e=edgeOutward(ACTIVITY_CENTER.site,0),a=Math.atan2(-e.nz,-e.nx);
    CARS.parkedM[0]=new THREE.Matrix4().compose(new THREE.Vector3(e.mx+e.nx*2.25,0,e.mz+e.nz*2.25),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-a,0)),new THREE.Vector3(1,1,1));
    enterCar(0);DRIVE.vx=-e.nx*26;DRIVE.vz=-e.nz*26;WALK.keys.add('KeyW');WALK.keys.add('ShiftLeft');
    let closest=Infinity,inside=false;for(let i=0;i<80;i++){updateDrive(.05);closest=Math.min(closest,(DRIVE.x-e.mx)*e.nx+(DRIVE.z-e.mz)*e.nz);inside ||= pip(DRIVE.x,DRIVE.z,ACTIVITY_CENTER.site);}
    const stopped=(DRIVE.x-e.mx)*e.nx+(DRIVE.z-e.mz)*e.nz;WALK.keys.clear();WALK.keys.add('KeyS');
    for(let i=0;i<120;i++)updateDrive(.05);
    return {closest,inside,retreat:(DRIVE.x-e.mx)*e.nx+(DRIVE.z-e.mz)*e.nz-stopped};})()`);
  assert.equal(report.inside,false);assert.ok(report.closest>2.18,'the front body circle stays outside the fence');
  assert.ok(report.retreat>2,'reverse remains available to escape a blocked front');
});

test('actual car and bicycle controllers accelerate, steer, brake and keep camera transforms finite',()=>{
  const world=vehicleScene(),m=world.model,road=m.D.r.find(r=>r.n==='以诚路'),cum=m.cumLen(road.p),q=m.sampleAt(road.p,cum,cum.at(-1)/2);
  const heading=Math.atan2(q.dz,q.dx);
  parkCar(m,q.x,q.z,heading);m.WALK.keys.add('KeyW');
  for(let i=0;i<120;i++)m.updateDrive(1/60);
  assert.ok(m.DRIVE.v>5);const carHeading=m.DRIVE.a;m.WALK.keys.add('KeyA');
  for(let i=0;i<30;i++)m.updateDrive(1/60);
  assert.ok(Math.abs(m.DRIVE.a-carHeading)>.02);
  m.WALK.keys.clear();m.WALK.keys.add('KeyS');for(let i=0;i<180&&m.DRIVE.v>.1;i++)m.updateDrive(1/60);
  assert.ok(m.DRIVE.v<=.1);assert.ok(world.ctx.camera.position.toArray().every(Number.isFinite));m.exitCar();
  m.enterBike(0);m.RIDE.x=q.x;m.RIDE.z=q.z;m.RIDE.y=m.groundAt(q.x,q.z);m.RIDE.a=heading;
  m.WALK.keys.clear();m.WALK.keys.add('KeyW');for(let i=0;i<120;i++)m.updateRide(1/60);
  assert.ok(m.RIDE.v>2);const bikeHeading=m.RIDE.a;m.WALK.keys.add('KeyA');for(let i=0;i<20;i++)m.updateRide(1/60);
  assert.ok(Math.abs(m.RIDE.a-bikeHeading)>.02);
  m.WALK.keys.clear();m.WALK.keys.add('KeyS');for(let i=0;i<180&&m.RIDE.v>.1;i++)m.updateRide(1/60);
  assert.ok(m.RIDE.v<=.1);m.RIDE.cam='fp';m.updateRide(0);assert.equal(m.RIDE.head.visible,false);
  m.RIDE.cam='chase';m.updateRide(0);assert.equal(m.RIDE.head.visible,true);
  matches(m.RIDE.root.position,[m.RIDE.x,m.RIDE.y+m.RIDE.hop,m.RIDE.z]);
  assert.ok(world.ctx.camera.position.toArray().every(Number.isFinite));
});

for(const touch of [false,true])test(`${touch?'touch stick':'keyboard S'} stops the bicycle, then reverses slowly until released`,()=>{
  const world=vehicleScene({touch}),m=world.model; m.enterBike(0);
  const road=m.D.r.find(r=>r.n==='以诚路'),cum=m.cumLen(road.p),q=m.sampleAt(road.p,cum,cum.at(-1)/2);
  Object.assign(m.RIDE,{x:q.x,z:q.z,y:m.groundAt(q.x,q.z),a:Math.atan2(q.dz,q.dx),v:3,cam:'fp'});
  m.updateRide(0);
  if(touch)m.WALK.pad.y=1;else m.WALK.keys.add('KeyS');
  let frames=0;
  while(m.RIDE.v>0&&frames++<120){m.updateRide(1/60);assert.ok(m.RIDE.v>=0,'braking reaches rest before reverse starts');}
  assert.equal(m.RIDE.v,0);const stopped=[m.RIDE.x,m.RIDE.z];
  for(let i=0;i<180;i++){m.updateRide(1/60);assert.ok(m.RIDE.v>=-.8,'reverse speed is bounded');}
  assert.ok(m.RIDE.v<-.5);assert.ok((m.RIDE.x-stopped[0])*q.dx+(m.RIDE.z-stopped[1])*q.dz < -1.5,'the bicycle actually backs up');
  m.WALK.keys.clear();m.WALK.pad.y=0;
  for(let i=0;i<300;i++)m.updateRide(1/60);
  assert.equal(m.RIDE.v,0,'releasing input brings it to rest without oscillating');
});

for(const touch of [false,true])test(`${touch?'touch stick':'keyboard S'} backs a bicycle away from an actual blocking fence`,()=>{
  const world=vehicleScene({touch});world.ctx.touchInput=touch;
  const result=world.run(`(()=>{
    const e=edgeOutward(ACTIVITY_CENTER.site,0);enterBike(0);
    Object.assign(RIDE,{x:e.mx+e.nx*1.2,z:e.mz+e.nz*1.2,a:Math.atan2(-e.nz,-e.nx),cam:'fp'});updateRide(0);
    if(touchInput)WALK.pad.y=-1;else WALK.keys.add('KeyW');
    let closest=Infinity;for(let i=0;i<120;i++){updateRide(1/60);closest=Math.min(closest,(RIDE.x-e.mx)*e.nx+(RIDE.z-e.mz)*e.nz);}
    const stopped=(RIDE.x-e.mx)*e.nx+(RIDE.z-e.mz)*e.nz;
    WALK.keys.clear();if(touchInput)WALK.pad.y=1;else WALK.keys.add('KeyS');
    for(let i=0;i<240;i++)updateRide(1/60);
    return {closest,stopped,retreat:(RIDE.x-e.mx)*e.nx+(RIDE.z-e.mz)*e.nz-stopped,v:RIDE.v};
  })()`);
  assert.ok(result.closest>=.81);assert.ok(result.stopped<1,'forward input stops outside the fence face');
  assert.ok(result.retreat>2,'the rider can escape without dismounting');assert.ok(result.v<-.5);
});

test('relocating the walking view parks any active vehicle before moving the character',()=>{
  const world=vehicleScene(),m=world.model,[x,z]=bridgeCenter(m),target=m.walkSpot(700,700);
  parkCar(m,x,z);world.ctx.relocationTarget=target;
  world.run('enterWalk(...relocationTarget,0,{instant:true})');
  assert.equal(m.DRIVE.on,false);assert.equal(m.DRIVE.root.visible,false);
  assert.ok(Math.hypot(m.WALK.x-target[0],m.WALK.z-target[1])<1e-6);
  assert.ok(Math.hypot(m.CARS.parkedM[0].elements[12]-x,m.CARS.parkedM[0].elements[14]-z)<1e-6,'car stays where it was parked');
  const oldBike=[...m.BIKE_SPOTS[0]];m.enterBike(0);world.run('enterWalk(...relocationTarget,0,{instant:true})');
  assert.equal(m.RIDE.on,false);assert.equal(m.RIDE.root.visible,false);
  assert.ok(Math.hypot(m.WALK.x-target[0],m.WALK.z-target[1])<1e-6);
  assert.deepEqual(Array.from(m.BIKE_SPOTS[0]),oldBike);
});

for(const kind of ['bicycle','car'])test(`a walking actor detours around a ${kind} parked on its route after route preparation`,()=>{
  const world=vehicleScene();world.run('buildPeople();lifeView=()=>{};lifeSeen=()=>true;');
  world.ctx.parkedKind=kind;
  const result=world.run(`(()=>{
    let chosen=null;
    for(const r of PEOPLE.routes.filter(r=>r.id.startsWith('road-')&&r.L>80)){
      for(let s=20;s<r.L-20;s+=4){const q=sampleAt(r.p,r.cum,s),width=parkedKind==='car'?3.2:2,left=[q.x-q.dz*width,q.z+q.dx*width],right=[q.x+q.dz*width,q.z-q.dx*width];
        const start=[q.x-q.dx*8,q.z-q.dz*8],end=[q.x+q.dx*8,q.z+q.dz*8];
        if(CARS.parkedM.every(m=>pointSegmentDistance([m.elements[12],m.elements[14]],start,end)>6)&&pedestrianSegmentClear(left,right)&&pedestrianSegmentClear(start,end)){chosen={r,s,q};break;}}
      if(chosen)break;
    }
    if(!chosen)throw new Error('No open road fixture');
    const {r,s,q}=chosen;
    if(parkedKind==='bicycle'){enterBike(0);RIDE.x=q.x;RIDE.z=q.z;RIDE.a=Math.atan2(q.dz,q.dx)+Math.PI/2;exitBike();}
    else{enterCar(0);DRIVE.x=q.x;DRIVE.z=q.z;DRIVE.a=Math.atan2(q.dz,q.dx)+Math.PI/2;exitCar();}
    const p={...PEOPLE.list[0],stand:false,r,s:s-7,dir:1,v:1.2,lat:0,ph:0,wait:0,ox:0,oz:0,tx:0,tz:0,cx:undefined,cz:undefined};
    PEOPLE.list=[p];camera.position.set(q.x,30,q.z);let contacts=0,largestOffset=0;
    for(let i=0;i<240;i++){updatePeople(.05,i*.05);const grid=PED_GRID;PED_GRID=null;const resolved=walkResolve(p.cx,p.cz,groundAt(p.cx,p.cz),.3);PED_GRID=grid;
      if(Math.hypot(resolved[0]-p.cx,resolved[1]-p.cz)>.01)contacts++;largestOffset=Math.max(largestOffset,Math.hypot(p.ox,p.oz));}
    return {contacts,largestOffset,progress:p.s-s};
  })()`);
  assert.equal(result.contacts,0);assert.ok(result.largestOffset>1);assert.ok(result.progress>3,'the actor passes the obstacle rather than vanishing or remaining stuck');
});
