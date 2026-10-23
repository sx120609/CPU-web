// Rebuild the spatial audit inventory from the actual scene preprocessing.
// This does not execute WebGL or claim that a model matches current real-world conditions.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import * as metadata from '../web/src/views/services/campus3d/placeMetadata.js';
import * as construction from '../web/src/views/services/campus3d/constructionSites.js';
import * as research from '../web/src/views/services/campus3d/researchCenters.js';
import { GRADUATE5_FIT_REPORT } from '../web/src/views/services/campus3d/graduate5Registration.js';

const root=new URL('../',import.meta.url), base=new URL('web/src/views/services/campus3d/',root);
const app=readFileSync(new URL('app.js',base),'utf8');
const data=JSON.parse(readFileSync(new URL('osm-data.json',base),'utf8'));
const outer=JSON.parse(readFileSync(new URL('osm-outer.json',base),'utf8'));
const model=vm.runInNewContext(app.slice(app.indexOf('const D ='),app.indexOf('const stage ='))+'\n({BLD,D,INFO,pip,cumLen,sampleAt})',{
  THREE,...metadata,...construction,...research,opts:{data,outer},root:{querySelector(){}},matchMedia:()=>({matches:false}),navigator:{hardwareConcurrency:8},
});
const round=v=>Math.round(v*100)/100;
const named = model.BLD.map((b,i)=>({
  key:b.osm?`osm-way-${b.osm}`:`supplement-${i}`,
  name:b.name||'(未命名)', category:b.cls.cat,
  footprintSource:b.src, osmWay:b.osm??null,
  sourceLink:b.osm?`https://www.openstreetmap.org/way/${b.osm}`:null,
  modelCenter:b.c.map(round), modelBounds:b.bb.map(round),
  modelFloorCount:b.cls.fl, osmFloorCount:data.b.find(q=>q.id===b.osm)?.l||null,
  geometryBuilder:b.cls.special||'generic',
  spatialEvidence:b.extra?.researchId?'2025-06-16 georeferenced roof + dated school evidence':b.cls.special==='activityConstruction'?'dated construction notice, schematic geometry':'requires dated reference check',
  currentFootprintVerified:false, currentHeightVerified:false, currentFacadeVerified:false, entranceVerified:false,
  evidenceLinks:(model.INFO[b.name]?.links||[]).map(s=>s.url),
}));
const widths={unclassified:7,residential:6,service:4.5,primary:12,secondary:10,tertiary:9};
const roads=model.D.r.map((r,i)=>({key:`road-${i}`,name:r.n||'(未命名)',type:r.t,vertices:r.p.length,spatialSource:r.spatialSource||'OSM snapshot; date not recorded',currentAccessVerified:false}));
// Candidates use footprints, not the full rendered meshes. Special envelopes and
// courtyards must be inspected before concluding a road physically crosses a wall.
const intersectionCandidates=[];
model.D.r.forEach((r,ri)=>{
  const c=model.cumLen(r.p), L=c[c.length-1], half=(r.wide||widths[r.t]||5)/2, found=new Map();
  for(let s=0;s<=L;s+=1){
    const q=model.sampleAt(r.p,c,s);
    for(const side of [-half,0,half]){
      const x=q.x-q.dz*side,z=q.z+q.dx*side;
      for(let i=0;i<model.BLD.length;i++){
        const b=model.BLD[i];if(b.cls.special==='xueyuan'||x<b.bb[0]||x>b.bb[2]||z<b.bb[1]||z>b.bb[3])continue;
        if((b.parts||[b.p]).some(p=>model.pip(x,z,p)))found.set(i,(found.get(i)||0)+1);
      }
    }
  }
  for(const [bi,samples] of found)intersectionCandidates.push({road:roads[ri].key,roadName:roads[ri].name,building:named[bi].key,buildingName:named[bi].name,sampledContacts:samples,status:'needs rendered/source inspection'});
});
const inventory={
  schemaVersion:1,checkedOn:'2026-10-23',status:'in_progress',
  scope:'All model buildings and source roads, plus footpaths, waters and sports areas. No category is marked complete by unit-test success.',
  counts:{modelBuildings:named.length,roads:roads.length,footpaths:model.D.pa.length,waters:model.D.w.length,sports:model.D.pi.length},
  limitations:['Building records are preprocessing metadata; bespoke rendered heights and geometry are not measured here.','OSM snapshot date is unknown; links identify ways, not proof of current accuracy.','2025 imagery cannot prove 2026 construction or access status.','Intersection candidates are diagnostic leads, not confirmed wall collisions.'],
  buildings:named,roads,
  footpaths:model.D.pa.map((p,i)=>({key:`footpath-${i}`,name:p.n||null,vertices:p.p.length,currentAccessVerified:false})),
  waters:model.D.w.map((w,i)=>({key:`water-${i}`,name:w.n||null,outerRings:w.o.length,innerRings:w.i.length,currentShorelineVerified:false})),
  sports:model.D.pi.map((p,i)=>({key:`sport-${i}`,name:p.n||null,type:p.s||p.k,currentLayoutVerified:false})),
  graduatePhaseFive:{referenceOnly:true,fitReport:GRADUATE5_FIT_REPORT,buildingHeightAndFenceNotModeled:true},
  intersectionCandidates,
  nextPriorities:['Validate independent 2026 observations of major facades and entrance positions.','Resolve the northern-road registration discrepancy before modeling a phase-five fence.','Inspect every road/footprint intersection candidate using dated imagery or rendered geometry.','Review the remaining undated generic buildings, water boundaries, bridges and sports dimensions.'],
};
writeFileSync(new URL('docs/campus3d-spatial-inventory.json',root),JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify({counts:inventory.counts,intersectionCandidates:intersectionCandidates.length}));
