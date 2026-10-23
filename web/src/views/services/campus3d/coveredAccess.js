export const SAFETY_CENTER_PASSAGE = Object.freeze({
  buildingWay:553656883,roadWay:970880295,
  centerline:[[-231.9,-317.0],[-239.3,-317.1]],
  // OSM records covered=yes, but no measured width or clearance.
  // These values only describe the model, never a real-world vehicle limit.
  modelWidth:4.5,modelClearance:3.7,
  source:'https://www.openstreetmap.org/way/970880295',
  sourceVersion:1,sourceTimestamp:'2021-08-06T11:07:48Z',checkedOn:'2026-10-23',
});

export function annotateCoveredAccess(roads) {
  const ends=SAFETY_CENTER_PASSAGE.centerline;
  return roads.map(r=>r.p.length===2&&r.p.every((p,i)=>Math.hypot(p[0]-ends[i][0],p[1]-ends[i][1])<0.1)
    ?{...r,covered:true,osm:SAFETY_CENTER_PASSAGE.roadWay,spatialSource:'osm-covered-way-970880295'}:r);
}

export function splitCoveredGround(polygon,centerline,width) {
  const [a,b]=centerline,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
  if(length<1e-6||width<=0)throw new Error('Invalid passage dimensions');
  const nx=-dz/length,nz=dx/length;
  const clip=(poly,limit,sign)=>{
    const out=[],distance=p=>sign*((p[0]-a[0])*nx+(p[1]-a[1])*nz-limit);
    for(let i=0;i<poly.length;i++){
      const p=poly[i],q=poly[(i+1)%poly.length],dp=distance(p),dq=distance(q),inside=dp>=-1e-9,nextInside=dq>=-1e-9;
      if(inside)out.push(p);
      if(inside!==nextInside){const t=dp/(dp-dq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
    }
    return out;
  };
  return {groundParts:[clip(polygon,width/2,1),clip(polygon,-width/2,-1)],opening:clip(clip(polygon,-width/2,1),width/2,-1)};
}

export const groundFootprints=b=>b.groundParts||b.parts||[b.p];
export function passageApproach(passage,distance=12) {
  const [a,b]=passage.centerline,dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);
  return [b[0]+dx/l*distance,b[1]+dz/l*distance];
}
export function buildingSolidAt(b,x,z,y,pointInPolygon) {
  if(b.volumes)return b.volumes.some(v=>y>=v.minY&&y<=v.maxY&&pointInPolygon(x,z,v.p));
  const polygons=b.coveredPassage&&y<b.coveredPassage.modelClearance?groundFootprints(b):b.parts||[b.p];
  return polygons.some(p=>pointInPolygon(x,z,p));
}

export function buildingTopAt(b,x,z,pointInPolygon) {
  if(b.volumes)return Math.max(0,...b.volumes.filter(v=>pointInPolygon(x,z,v.p)).map(v=>v.maxY));
  return (b.parts||[b.p]).some(p=>pointInPolygon(x,z,p))?b.h:0;
}
