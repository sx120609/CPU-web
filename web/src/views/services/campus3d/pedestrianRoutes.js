// Simulation clearance only: these routes are not a real-world access map.
export const PEDESTRIAN_RADIUS = 0.3;
export const PEDESTRIAN_WANDER = 0.7;

export function pointSegmentDistance(p, a, b) {
  const dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;
  const t=length2?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/length2)):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}

export function segmentDistance(a,b,c,d) {
  const ux=b[0]-a[0],uz=b[1]-a[1],vx=d[0]-c[0],vz=d[1]-c[1],den=ux*vz-uz*vx;
  if(Math.abs(den)>1e-10){
    const t=((c[0]-a[0])*vz-(c[1]-a[1])*vx)/den;
    const u=((c[0]-a[0])*uz-(c[1]-a[1])*ux)/den;
    if(t>=0&&t<=1&&u>=0&&u<=1)return 0;
  }
  return Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
}

// Preserve mapped lines and split at obstructions. No route jumps across a
// blocked interval, and no road/building coordinates are moved to make it pass.
export function clearRouteSpans(route, segmentClear, cumLen, sampleAt) {
  const cum=cumLen(route.p),length=cum[cum.length-1],out=[];
  let run=[];
  const clearance=PEDESTRIAN_RADIUS+PEDESTRIAN_WANDER+0.05;
  const flush=()=>{
    if(run.length>1){const distances=cumLen(run),L=distances[distances.length-1];if(L>20)out.push({...route,p:run,cum:distances,L});}
    run=[];
  };
  // Include every original corner; never replace it by an unchecked shortcut.
  const samples=[...cum];
  for(let s=.75;s<length;s+=.75)samples.push(s);
  samples.sort((a,b)=>a-b);
  for(const s of samples){
    const q=sampleAt(route.p,cum,s),p=[q.x,q.z];
    if(run.length){if(!segmentClear(run[run.length-1],p,clearance))flush();}
    if(!run.length&&!segmentClear(p,p,clearance))continue;
    if(!run.length||Math.hypot(p[0]-run[run.length-1][0],p[1]-run[run.length-1][1])>1e-6)run.push(p);
  }
  flush();
  return out;
}
