// Manual control points read from the school's notice image (726 x 573 pixels).
// OSM coordinates use the same local projection as the campus scene.
// The notice's red rectangle is an area-of-interest annotation, not a fence survey.
export const GRADUATE5_REGISTRATION = {
  noticeUrl: 'https://jjc.cpu.edu.cn/61/db/c494a221659/page.htm',
  imageUrl: 'https://jjc.cpu.edu.cn/_upload/article/images/2a/da/85f82571416c8c91b51b2f484185/f2bfd074-d725-4219-ad46-007f6dffb202.png',
  publicationDate: '2025-04-30',
  imageSize: [726, 573],
  fitPoints: [
    { id:'J5', pixel:[160,224], world:[-31.6,-865.5] },
    { id:'J6', pixel:[522,251], world:[166.1,-849.8] },
    { id:'J10', pixel:[171,349], world:[-26.2,-795.1] },
    { id:'J11', pixel:[490,407], world:[150.6,-764.1] },
    { id:'J12', pixel:[154,420], world:[-34.4,-753.6] },
    { id:'J21', pixel:[464,514], world:[137.1,-701.3] },
  ],
  checkPoints: [
    { id:'J3', pixel:[74,169], world:[-77.7,-896.8] },
    { id:'J7', pixel:[18,270], world:[-106.7,-838.1] },
    { id:'J9', pixel:[160,300], world:[-34.3,-822.3] },
    { id:'north-road-center', pixel:[533,105], world:[169,-920.3] },
  ],
  referencePixels: [[187,115],[528,115],[528,371],[187,371]],
  isFenceBoundary: false,
};

export function affineRegistration(points) {
  if (points.length < 3) throw new Error('At least three control points are required');
  const m = Array.from({length:3},()=>Array(5).fill(0));
  for (const {pixel:[x,y],world:[u,v]} of points) {
    const a=[x,y,1];
    for(let i=0;i<3;i++) {
      for(let j=0;j<3;j++)m[i][j]+=a[i]*a[j];
      m[i][3]+=a[i]*u;m[i][4]+=a[i]*v;
    }
  }
  for(let k=0;k<3;k++) {
    let pivot=k;for(let i=k+1;i<3;i++)if(Math.abs(m[i][k])>Math.abs(m[pivot][k]))pivot=i;
    [m[k],m[pivot]]=[m[pivot],m[k]];
    if(Math.abs(m[k][k])<1e-10)throw new Error('Control points do not constrain an affine transform');
    const divisor=m[k][k];for(let j=k;j<5;j++)m[k][j]/=divisor;
    for(let i=0;i<3;i++)if(i!==k){const f=m[i][k];for(let j=k;j<5;j++)m[i][j]-=f*m[k][j];}
  }
  const coefficients=m.map(row=>row.slice(3));
  const project=([x,y])=>[0,1].map(k=>coefficients[0][k]*x+coefficients[1][k]*y+coefficients[2][k]);
  const error=p=>{const q=project(p.pixel);return Math.hypot(q[0]-p.world[0],q[1]-p.world[1]);};
  return { coefficients, project, error, rms:Math.sqrt(points.reduce((s,p)=>s+error(p)**2,0)/points.length) };
}

const fit=affineRegistration(GRADUATE5_REGISTRATION.fitPoints);
export const GRADUATE5_REFERENCE_AREA=GRADUATE5_REGISTRATION.referencePixels.map(fit.project);
export const GRADUATE5_FIT_REPORT={
  coefficients:fit.coefficients, fittingRmsMeters:fit.rms,
  checks:GRADUATE5_REGISTRATION.checkPoints.map(p=>({id:p.id,errorMeters:fit.error(p)})),
  interpretation:'Footpath checks are about 2–4 m; the northern road check differs by about 13 m. The outline is only a notice reference area, never a physical barrier.',
};
