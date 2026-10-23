// Research coordinates, not a site survey. See docs/campus3d-spatial-sources.json.
// Six volleyball bays traced from ground paving dated 2024-01-12. The larger
// mosaic is mixed-date; a center-point date must not be applied to every court.
// The school also lists six volleyball courts in its 2023 renovation notice.
export const VOLLEYBALL_PITCHES = [
  [[348.5,257.2],[361.4,257.2],[361.4,282.4],[348.5,282.4]],
  [[361.4,257.2],[373.6,257.2],[373.6,282.4],[361.4,282.4]],
  [[373.6,257.2],[386,257.2],[386,282.4],[373.6,282.4]],
  [[348.5,282.4],[361.4,282.4],[361.4,307.5],[348.5,307.5]],
  [[361.4,282.4],[373.6,282.4],[373.6,307.5],[361.4,307.5]],
  [[373.6,282.4],[386,282.4],[386,307.5],[373.6,307.5]],
].map((p,i)=>({k:'pitch',s:'volleyball',n:'',p,id:`volleyball-${i+1}`,spatialSource:'2024-01-12 ground imagery; approximate paving bays'}));

export const SPORTS_SOURCE = {
  stadiumDate:'2025-04-06',northDate:'2025-06-16',volleyballDate:'2024-01-12',
  southBasketballDates:'2024-01-12 / 2025-04-06',
  links:[
    {title:'学校采购公告：一期球场改造（2023-07-17）',url:'https://cgzx.cpu.edu.cn/cgxxgc/39322.chtml'},
    {title:'体育部：场馆改造与设施照片（2025-10-31）',url:'https://ddh11.cpu.edu.cn/7d/f5/c17616a228853/page.htm'},
    {title:'Esri 影像服务与来源元数据',url:'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'},
  ],
};

export function sportsPitches(pitches) {
  return [...pitches,...VOLLEYBALL_PITCHES.filter(q=>!pitches.some(p=>p.id===q.id))];
}

// A tennis parcel holds six separate courts, unlike a basketball/volleyball bay.
// Painting, nets and searchable places share the same court orientation.
export function courtFrame(court) {
  const ob=court.ob;
  if(court.type!=='tennis')return {x:ob.cx,z:ob.cz,ux:ob.ux,uz:ob.uz};
  const offset=-ob.L/2+(court.i+.5)*ob.L/court.n;
  return {x:ob.cx+ob.ux*offset,z:ob.cz+ob.uz*offset,ux:court.along?ob.ux:-ob.uz,uz:court.along?ob.uz:ob.ux};
}

// Connected groups prevent a campus-wide centroid from pointing between venues.
// Select a real court as the pin; even a local group's centroid can lie in a gap.
export function courtGroups(courts,type,gap=70) {
  const remaining=new Set(courts.filter(c=>c.type===type)),groups=[];
  while(remaining.size){
    const first=remaining.values().next().value,members=[first];remaining.delete(first);
    for(let i=0;i<members.length;i++){
      const a=courtFrame(members[i]);
      for(const c of remaining){const b=courtFrame(c);if(Math.hypot(a.x-b.x,a.z-b.z)<=gap){members.push(c);remaining.delete(c);}}
    }
    const centers=members.map(courtFrame),x=centers.reduce((sum,c)=>sum+c.x,0)/centers.length,z=centers.reduce((sum,c)=>sum+c.z,0)/centers.length;
    const anchor=centers.reduce((best,c)=>Math.hypot(c.x-x,c.z-z)<Math.hypot(best.x-x,best.z-z)?c:best);
    groups.push({members,x:anchor.x,z:anchor.z});
  }
  return groups.sort((a,b)=>a.z-b.z||a.x-b.x);
}

export function sportsPlaces(courts) {
  const places=[];
  for(const type of ['basketball','tennis','volleyball'])for(const group of courtGroups(courts,type)){
    const north=group.z<0;
    const name=type==='tennis'?'网球场':type==='volleyball'?'排球场':`篮球场（${north?'北区':group.z<450?'体育场东北侧':'体育场东南侧'}）`;
    const date=type==='volleyball'?SPORTS_SOURCE.volleyballDate:north?SPORTS_SOURCE.northDate:type==='tennis'?SPORTS_SOURCE.stadiumDate:SPORTS_SOURCE.southBasketballDates;
    const accuracy=type==='volleyball'?'5':type==='basketball'&&!north?'5–8.47':'8.47';
    const kind=type==='tennis'?'网球':type==='volleyball'?'排球':'篮球';
    places.push({name,cat:'sport',x:group.x,z:group.z,h:3,sub:`${group.members.length} 片${kind}场 · 影像参考布局`,
      desc:`这组${kind}场按公开影像中的相邻场地单独定位。场地数量与布局用于校园浏览，尺寸、球网和设施为近似示意；后续改造及现场出入口仍需核对。`,
      src:`轮廓：${type==='volleyball'?'卫星影像补绘':'OpenStreetMap'}；外观参考：${date} 影像。影像来源标称定位精度约 ${accuracy} 米，不能据此确认当前开放状态。`,
      links:SPORTS_SOURCE.links});
  }
  return places;
}
