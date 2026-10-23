// Roof traces from georeferenced imagery, cross-checked against the school's
// March 2026 photographs. Visible facade displacement is kept separate from roof
// width. Roof-to-ground offsets are manual estimates, not surveyed bases.
export const RESEARCH_IMAGERY = Object.freeze({
  service: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
  zoom: 19, tileOrigin: [435316, 213066],
  acquisitionDate: '2025-06-16', retrieved: '2026-10-23',
  provider: 'Esri / Vantor Vivid Advanced (WV02)',
  sourceResolutionMeters: 0.5, sourceAccuracyMeters: 8.47,
  metadataUrl: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/identify?geometry=118.91%2C31.907&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1&mapExtent=118.9078%2C31.9064%2C118.9113%2C31.9085&imageDisplay=1600%2C1200%2C96&returnGeometry=false&f=pjson',
});

export function researchImagePoint([px, py]) {
  const n = 2 ** RESEARCH_IMAGERY.zoom * 256;
  const lon = (RESEARCH_IMAGERY.tileOrigin[0] * 256 + px) / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (RESEARCH_IMAGERY.tileOrigin[1] * 256 + py) / n))) * 180 / Math.PI;
  return [(lon - 118.9125) * Math.cos(31.9035 * Math.PI / 180) * 111320, (31.9035 - lat) * 110574];
}
const trace = pixels => pixels.map(researchImagePoint);

const namingUrl = 'https://www.cpu.edu.cn/_t768/8e/05/c10408a232965/page.htm';
const namingSource = { title: '学校楼宇介绍与实景照片（2026-03-05）', url: namingUrl };
const imagerySource = { title: '影像日期与定位精度（Esri / Vantor）', url: RESEARCH_IMAGERY.metadataUrl };

export const RESEARCH_CENTERS = Object.freeze({
  chemistry: {
    name: '新建科研楼 A', floors: 5, basementFloors: 1, publishedGrossArea: 16050.51,
    roofPixels: [[747,587],[825,587],[825,694],[970,694],[1006,588],[1101,588],[1033,776],[748,776]],
    groundOffsetPixels: [45,12],
    roofGroundChecks: [[[1101,588],[1146,600]],[[1033,776],[1078,788]]],
    courtyardPixels: [[827,591],[1001,592],[968,691],[827,691]],
  },
  animal: {
    name: '新建科研楼 B', floors: 6,
    roofPixels: [[638,882],[956,882],[956,963],[640,962]],
    groundOffsetPixels: [54,15],
    roofGroundChecks: [[[956,882],[1010,897]],[[956,963],[1010,978]]],
  },
  clinical: {
    name: '新建科研楼 C', floors: 6, basementFloors: 1, publishedHeight: 29.85, publishedAboveGroundArea: 10259.41,
    roofPixels: [[243,882],[526,882],[526,963],[334,963],[310,999],[298,1001],[217,984],[232,919]],
    groundOffsetPixels: [54,14],
    roofGroundChecks: [[[526,882],[580,896]],[[526,963],[580,977]]],
  },
});

export const researchGroundTrace = (building, pixels=building.roofPixels) => trace(pixels.map(([x,y])=>[x+building.groundOffsetPixels[0],y+building.groundOffsetPixels[1]]));

// The 2026 clinical-center photograph shows rounded exterior corners. Keep the
// concave return of the plan; use a small approximate curve only at convex corners.
function roundExteriorCorners(p, cutback=2) {
  const area=p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0);
  return p.flatMap((b,i)=>{
    const a=p[(i+p.length-1)%p.length],c=p[(i+1)%p.length];
    const ux=b[0]-a[0],uz=b[1]-a[1],vx=c[0]-b[0],vz=c[1]-b[1];
    if((ux*vz-uz*vx)*area<=0)return [b];
    const l=Math.hypot(ux,uz),n=Math.hypot(vx,vz),d=Math.min(cutback,l/3,n/3);
    const q=[b[0]-ux/l*d,b[1]-uz/l*d],r=[b[0]+vx/n*d,b[1]+vz/n*d];
    return Array.from({length:7},(_,k)=>{const t=k/6,s=1-t;return [s*s*q[0]+2*s*t*b[0]+t*t*r[0],s*s*q[1]+2*s*t*b[1]+t*t*r[1]];});
  });
}

export function researchBuildings() {
  return Object.entries(RESEARCH_CENTERS).map(([researchId, b]) => ({
    name: b.name, researchId, p: researchId==='clinical'?roundExteriorCorners(researchGroundTrace(b)):researchGroundTrace(b),
    special: researchId === 'animal' ? undefined : 'researchCenter',
    st: researchId === 'animal' ? 'glassGrey' : 'whiteGreen',
    fl: b.floors, h: b.publishedHeight,
    src: researchId === 'animal' ? 'sat-inferred' : 'photo+sat', cat: 'teach', group: 'newlab',
  }));
}

export const CHEMISTRY_COURT = researchGroundTrace(RESEARCH_CENTERS.chemistry,RESEARCH_CENTERS.chemistry.courtyardPixels);
export const RESEARCH_TEMPORARY_FOOTPRINT = trace([[1221,641],[1294,684],[1243,851],[1138,821]]);

// Road changes share the imagery reference with the roofs. The old service road
// through the chemistry courtyard predates the building. Keep its northern link
// and use the visible eastern access road around both buildings.
export function correctResearchRoads(roads) {
  const starts = (r, x, z) => Math.hypot(r.p[0][0] - x, r.p[0][1] - z) < 0.1;
  const traced = (r, p) => ({ ...r, p, spatialSource: 'research-imagery-2025-06-16' });
  return roads.map(r => {
    if (r.t === 'service' && starts(r, -106.5, -470)) return traced(r, r.p.slice(0, 5));
    if (r.t === 'service' && starts(r, -192.7, -411.4)) return traced(r, [[-147.9,-467.3], ...trace([[1204,590],[1176,716],[1127,820],[1083,877],[1081,954],[1052,1003],[1009,1014]]), [-204.3,-355]]);
    return r;
  });
}

export const RESEARCH_INFO = Object.freeze({
  '科研区临时设施（2025影像）': {
    d: '2025 年 6 月卫星影像中，科研楼东侧可见临时设施。其在当前校园中的保留情况尚未核实。',
    s: '轮廓来自 2025-06-16 卫星屋顶描绘；用途、单层外观和高度仅为示意，不代表已确认的现状永久建筑。',
    links: [imagerySource],
  },
  '新建科研楼 A': {
    d: '创新药物成药性评价中心，学校 2026 年 3 月资料暂称“化学楼”，地上 5 层、地下 1 层。白色横带与蓝色玻璃围合朝北开口的庭院，院内有彭司勋雕像和绿地。',
    s: '名称、层数及立面：学校楼宇介绍和实景照片（2026-03-05）。轮廓：2025-06-16 卫星屋顶描绘，并按可见立面偏移估算地面位置；源定位精度约 8.47 米，非测绘基底，模型高度为估算。',
    nameConfirmed: true, links: [namingSource, imagerySource],
  },
  '新建科研楼 B': {
    d: '位于成药性评价中心南侧、临床中心东侧的科研楼。轮廓按有坐标的卫星屋顶修正；“动物中心”的具体对应关系和层数仍需独立核实。',
    s: '轮廓：2025-06-16 Esri / Vantor 卫星屋顶与立面偏移估算，源定位精度约 8.47 米；层数与立面仍为模型估算。',
    links: [imagerySource],
  },
  '新建科研楼 C': {
    d: '临床药学研究中心与药物再评价中心，学校 2026 年 3 月资料暂称“生物楼”，地上 6 层、地下 1 层。实景可见白色水平遮阳带、蓝绿色玻璃和圆转角；2025 年项目公告给出的建筑高度为 29.85 米。',
    s: '名称、层数与外观：学校 2026-03-05 实景资料；高度：2025-07-08 项目公告，非竣工实测。轮廓按 2025-06-16 卫星屋顶与立面偏移估算，源定位精度约 8.47 米。',
    nameConfirmed: true,
    links: [namingSource, { title: '临床中心项目层数与建筑高度（2025-07-08）', url: 'https://jjc.cpu.edu.cn/71/8a/c499a225674/page.htm' }, imagerySource],
  },
});
