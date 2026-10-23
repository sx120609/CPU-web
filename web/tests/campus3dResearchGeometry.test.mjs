import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { NATATORIUM, DORM_GROUP_INFO, buildingFacts } from '../src/views/services/campus3d/placeMetadata.js';
import { ACTIVITY_CENTER, GRADUATE_PHASE_FIVE } from '../src/views/services/campus3d/constructionSites.js';
import * as research from '../src/views/services/campus3d/researchCenters.js';

const base = new URL('../src/views/services/campus3d/', import.meta.url);
const app = readFileSync(new URL('app.js', base), 'utf8');
const data = JSON.parse(readFileSync(new URL('osm-data.json', base), 'utf8'));
const outer = JSON.parse(readFileSync(new URL('osm-outer.json', base), 'utf8'));
const slice = (a, b) => app.slice(app.indexOf(a), app.indexOf(b));
const ctx = vm.createContext({
  THREE, NATATORIUM, DORM_GROUP_INFO, ACTIVITY_CENTER, GRADUATE_PHASE_FIVE, ...research,
  opts: { data, outer }, root: { querySelector() {} }, matchMedia: () => ({ matches: false }), navigator: { hardwareConcurrency: 8 }, NO_TREE: [],
});
vm.runInContext([
  slice('const D =', 'const stage ='), slice('class GB {', 'function textCanvas('),
  slice('function buildResearchCenter(', '// Main entrance on the face nearest a road.'),
  'const centers = BLD.filter(b => b.extra?.researchId);',
  'for (const b of centers) if (b.cls.special === "researchCenter") buildResearchCenter(b);',
].join('\n'),ctx);
const model = vm.runInContext('({ centers, BLD, D, BUFS, pip, pArea, pCentroid, pBox, sampleAt, cumLen })',ctx);

test('roof tracing retains source date, global tile origin and positional uncertainty', () => {
  const p = research.researchImagePoint([747,587]);
  // Independently calculated from the EPSG:3857 tile grid during source inspection.
  assert.ok(Math.abs(p[0] + 257.10) < 0.01);
  assert.ok(Math.abs(p[1] + 464.66) < 0.01);
  assert.equal(research.RESEARCH_IMAGERY.acquisitionDate,'2025-06-16');
  assert.equal(research.RESEARCH_IMAGERY.sourceAccuracyMeters,8.47);
});

test('school evidence produces five chemical floors and six clinical floors with declared height', () => {
  const chem = model.centers.find(b=>b.extra.researchId==='chemistry');
  const clinical = model.centers.find(b=>b.extra.researchId==='clinical');
  assert.equal(model.centers.length,3,'the chemical wings are one U-shaped building, not two overlapping guesses');
  assert.equal(chem.cls.fl,5);
  assert.equal(clinical.cls.fl,6);
  assert.equal(clinical.h,29.85);
  assert.deepEqual(buildingFacts({},[chem])[0],['层数（学校资料）','地上 5 层 · 地下 1 层']);
  assert.deepEqual(buildingFacts({},[clinical])[1],['建筑高度（项目公告）','29.85 m']);
});

test('new roofs do not overlap the mapped warehouse or one another', () => {
  const warehouse = model.BLD.find(b=>b.osm===553656882);
  const shapes=[warehouse,...model.centers];
  for(let i=0;i<shapes.length;i++)for(let j=i+1;j<shapes.length;j++){
    const a=shapes[i],b=shapes[j],box=model.pBox(a.p);
    for(let x=box[0]+0.125;x<box[2];x+=0.5)for(let z=box[1]+0.125;z<box[3];z+=0.5)
      assert.ok(!(model.pip(x,z,a.p)&&model.pip(x,z,b.p)),`overlap: ${a.name}/${b.name} at ${x},${z}`);
  }
});

test('visible facade displacement does not inflate every modeled floor beyond the published area',()=>{
  const chem=model.centers.find(b=>b.extra.researchId==='chemistry');
  const clinical=model.centers.find(b=>b.extra.researchId==='clinical');
  assert.ok(Math.abs(model.pArea(chem.p))*5 < research.RESEARCH_CENTERS.chemistry.publishedGrossArea);
  const clinicalRatio=Math.abs(model.pArea(clinical.p))*6/research.RESEARCH_CENTERS.clinical.publishedAboveGroundArea;
  assert.ok(clinicalRatio>0.85&&clinicalRatio<1.15,'uniform six-floor model should be compatible with the published above-ground area');
});

test('the chemistry court is open to the sky in the real generated mesh', () => {
  const meshes=Object.values(model.BUFS).map(b=>new THREE.Mesh(b.geo(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
  const [x,z]=model.pCentroid(research.CHEMISTRY_COURT);
  const ray=new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0));
  meshes.forEach(m=>m.updateMatrixWorld());
  const hits=ray.intersectObjects(meshes,false);
  assert.ok(hits.length>0);
  assert.ok(hits[0].point.y<0.1,'a roof or floor must not fill the photographed courtyard');
  meshes.forEach(m=>{m.geometry.dispose();m.material.dispose();});
});

test('corrected road centers and both carriageway edges stay out of neighboring building footprints', () => {
  const width={unclassified:7,service:4.5};
  const buildings=model.BLD.filter(b=>b.cls.special!=='xueyuan'&&b.c[0]>-450&&b.c[0]<-100&&b.c[1]>-510&&b.c[1]<-330);
  for(const r of model.D.r){
    if(r.spatialSource!=='research-imagery-2025-06-16')continue;
    if(!r.p.some(([x,z])=>x>-450&&x<-100&&z>-510&&z<-330))continue;
    const c=model.cumLen(r.p),L=c[c.length-1],half=(width[r.t]||6)/2;
    for(let s=0;s<=L;s+=0.5){
      const q=model.sampleAt(r.p,c,s);
      for(const side of [-half,0,half])for(const b of buildings)
        assert.ok(!model.pip(q.x-q.dz*side,q.z+q.dx*side,b.p),`${r.n||r.t} crosses ${b.name} at ${q.x.toFixed(1)},${q.z.toFixed(1)}`);
    }
  }
});

test('roof meshes are finite and retain the traced concave and chamfered outlines', () => {
  for(const b of Object.values(model.BUFS)){
    assert.ok(b.p.every(Number.isFinite));
    assert.ok(b.n.every(Number.isFinite));
  }
  for(const b of model.centers) assert.ok(Math.abs(model.pArea(b.p))>1000);
});

test('source road centerlines do not route vehicles through the corrected research buildings',()=>{
  // Unchanged OSM widths are estimates. Edge/footprint candidates are retained
  // in the spatial inventory rather than moving a source-derived building to hide them.
  for(const r of model.D.r){
    const c=model.cumLen(r.p),L=c[c.length-1];
    for(let s=0;s<=L;s+=1){const q=model.sampleAt(r.p,c,s);
      for(const b of model.centers)
        assert.ok(!model.pip(q.x,q.z,b.p),`${r.n||r.t} from ${r.p[0]} crosses ${b.name} at ${q.x.toFixed(2)},${q.z.toFixed(2)}`);
    }
  }
});
