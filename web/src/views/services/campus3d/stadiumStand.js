// Horizontal silhouette: dated imagery with 15 separately visible membrane bays.
// Front treatment: school photographs from 2025-10 and 2026-03-29.
// All elevations, row spacing and hidden structure remain illustrative estimates.
export const STADIUM_STAND = Object.freeze({
  bays:15,roofHalfLength:60,bodyHalfLength:74,
  frontOffset:58.3,bodyDepth:33.5,
  roofRearOffset:90,roofFrontOffset:70.5,rearCurve:16,frontCurve:6,
  modelBaseHeight:3.2,modelRows:24,modelRowDepth:1.05,modelRowRise:.35,
  modelRoofRear:17,modelRoofFront:18.5,modelBayRise:1.7,
  imageryDate:'2025-04-06',photoDate:'2026-03-29',
  links:[
    {title:'学校：第五届体育文化节现场照片（2026-03-29）',url:'https://jjh.cpu.edu.cn/article/17192'},
    {title:'外国语学院：运动会看台照片（2025-11-07）',url:'https://wywy.cpu.edu.cn/7f/64/c6015a229220/page.htm'},
  ],
});

export function stadiumStandLayout(ob) {
  const q=STADIUM_STAND,west=-ob.uz<0?1:-1;
  const point=(u,v)=>[ob.cx+ob.ux*u-ob.uz*v*west,ob.cz+ob.uz*u+ob.ux*v*west];
  const rear=u=>q.frontOffset+q.bodyDepth*Math.max(0,1-(u/q.bodyHalfLength)**2);
  const roofRear=u=>q.roofRearOffset-q.rearCurve*(u/q.roofHalfLength)**2;
  const roofFront=u=>q.roofFrontOffset-q.frontCurve*(u/q.roofHalfLength)**2;
  const footprint=[point(-q.bodyHalfLength,q.frontOffset),point(q.bodyHalfLength,q.frontOffset)];
  for(let i=1;i<48;i++){const u=q.bodyHalfLength-i/48*q.bodyHalfLength*2;footprint.push(point(u,rear(u)));}
  const roof=(bay,s,t)=>{
    const u=-q.roofHalfLength+(bay+s)*q.roofHalfLength*2/q.bays;
    const v=roofRear(u)+(roofFront(u)-roofRear(u))*t;
    const y=q.modelRoofRear+(q.modelRoofFront-q.modelRoofRear)*t+Math.sin(Math.PI*t)*.65+Math.sin(Math.PI*s)*q.modelBayRise;
    const [x,z]=point(u,v);return [x,y,z];
  };
  return {point,rear,roofRear,roofFront,footprint,roof,west,
    rowHalfLength:v=>q.bodyHalfLength*Math.sqrt(Math.max(0,1-(v-q.frontOffset)/q.bodyDepth))};
}
