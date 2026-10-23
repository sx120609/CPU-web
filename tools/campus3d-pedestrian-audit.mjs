// Compare the original road-side route rule with the current safe spans using
// the shipped building/bridge walls and independent player collision resolver.
import { writeFileSync } from 'node:fs';
import { sceneContext } from '../web/tests/helpers/campus3dScene.mjs';
const world=sceneContext();
world.run('buildBuildings();buildBridges();collisionGrids();BLD.forEach((b,i)=>BGRID.add(i,b.bb));buildPeople();');
const model=world.run('({BLD,BRIDGES,PEOPLE,ACTIVITY_CENTER,pedestrianCandidates,cumLen,sampleAt,walkResolve,groundAt,inWater,onBridge,pip})');
const candidates=model.pedestrianCandidates().map(r=>{const cum=model.cumLen(r.p);return {...r,cum,L:cum[cum.length-1]};});
function inspect(routes,radius) {
  let samples=0,wallContacts=0,waterContacts=0,siteContacts=0,bridgeSamples=0;
  const affected=[];
  for(const r of routes){let wall=0,water=0,site=0;const examples=[];
    for(let i=0;i<=Math.ceil(r.L/.5);i++){
      const q=model.sampleAt(r.p,r.cum,Math.min(i*.5,r.L));
      for(const lat of [-.7,0,.7]){
        const x=q.x-q.dz*lat,z=q.z+q.dx*lat,[xx,zz]=model.walkResolve(x,z,model.groundAt(x,z),radius);
        const contact=Math.hypot(xx-x,zz-z)>.01,wet=model.inWater(x,z)&&!model.onBridge(x,z),inside=model.pip(x,z,model.ACTIVITY_CENTER.site);
        wall+=contact;water+=wet;site+=inside;samples++;
        if(model.inWater(x,z)&&model.onBridge(x,z))bridgeSamples++;
        if((contact||wet||inside)&&examples.length<2)examples.push([x,z]);
      }
    }
    wallContacts+=wall;waterContacts+=water;siteContacts+=site;
    if(wall||water||site)affected.push({id:r.id,name:r.name||null,wall,water,site,examples});
  }
  return {routeCount:routes.length,samples,radius,wallContacts,waterContacts,siteContacts,bridgeSamples,affected};
}
const report={
  checkedOn:'2026-10-23',status:'partially_verified',
  scope:{buildings:model.BLD.length,bridges:model.BRIDGES.length,samplingStep:.5,lateralOffsets:[-.7,0,.7],includesEndpoints:true},
  limitations:[
    'Headless comparison builds campus buildings and bridges; full landscape, trees, bicycles and parked cars are not generated here.',
    'Dedicated regression fixtures cover tree trunks, instanced props, thin-wall dodges and bridge height updates.',
    'The browser verifies full-scene startup and rendered activity, not every runtime route or device.',
    'Clipped spans are simulation constraints. Source roads, building outlines, physical entrances and current access still require external verification.',
  ],
  before:inspect(candidates.filter(r=>r.L>20),.28),
  after:inspect(model.PEOPLE.routes,.3),
  retainedLength:model.PEOPLE.routes.reduce((n,r)=>n+r.L,0),
  restrictedSources:candidates.filter(r=>r.L>20).map(r=>{
    const retained=model.PEOPLE.routes.filter(p=>p.id===r.id).reduce((n,p)=>n+p.L,0);
    return {id:r.id,name:r.name||null,originalLength:r.L,retainedLength:retained};
  }).filter(r=>r.originalLength-r.retainedLength>.1),
};
writeFileSync(new URL('../docs/campus3d-pedestrian-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({before:{routes:report.before.routeCount,affected:report.before.affected.length,contacts:report.before.wallContacts},after:{routes:report.after.routeCount,samples:report.after.samples,contacts:report.after.wallContacts,water:report.after.waterContacts,site:report.after.siteContacts,bridgeSamples:report.after.bridgeSamples},retainedLength:report.retainedLength}));
