import test from 'node:test';
import assert from 'node:assert/strict';
import { affineRegistration, GRADUATE5_REGISTRATION as registration, GRADUATE5_REFERENCE_AREA, GRADUATE5_FIT_REPORT } from '../src/views/services/campus3d/graduate5Registration.js';

test('affine fitting reproduces independent coordinates and rejects collinear control points',()=>{
  const points=[[0,0],[10,0],[0,10],[10,10]].map(([x,y])=>({pixel:[x,y],world:[2*x-y+7,x+3*y-20]}));
  const fit=affineRegistration(points), p=fit.project([6,8]);
  assert.ok(Math.hypot(p[0]-11,p[1]-10)<1e-9);
  assert.throws(()=>affineRegistration(points.slice(0,2)));
  assert.throws(()=>affineRegistration([0,1,2].map(x=>({pixel:[x,x],world:[x,2*x]}))));
});

test('held-out controls expose the north-road disagreement instead of calling the fit survey-accurate',()=>{
  assert.ok(GRADUATE5_FIT_REPORT.fittingRmsMeters<1.2);
  const checks=GRADUATE5_FIT_REPORT.checks;
  assert.ok(checks.slice(0,3).every(p=>p.errorMeters>2&&p.errorMeters<4));
  assert.ok(checks.find(p=>p.id==='north-road-center').errorMeters>13);
  assert.equal(registration.isFenceBoundary,false);
});

test('notice area lies west of the north gate, separately from H6/H7',()=>{
  const center=GRADUATE5_REFERENCE_AREA.reduce((a,p)=>[a[0]+p[0]/4,a[1]+p[1]/4],[0,0]);
  assert.ok(Math.abs(center[0]-76.197)<0.01);
  assert.ok(Math.abs(center[1]+854.94)<0.01);
  assert.ok(center[0]<169&&center[1]<-750);
  assert.ok(Math.hypot(center[0]-570,center[1]+350)>600);
});
