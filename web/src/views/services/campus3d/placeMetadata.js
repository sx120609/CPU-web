// Dimensions from project notices are separate from dimensions estimated by the model.
// Keep the source, publication date and verification date with each verified fact.
export const NATATORIUM = Object.freeze({
  height: 14.8,
  floors: 2,
  basementFloors: 1,
  opened: '2026-07-01',
  checked: '2026-10-23',
  sources: [
    { title: '基建后勤处：项目层数与建筑高度（2025-07-08）', url: 'https://jjc.cpu.edu.cn/71/8b/c499a225675/page.htm' },
    { title: '学校新闻：游泳馆开馆（2026-07-01）', url: 'https://www.cpu.edu.cn/b1/34/c11509a241972/page.htm' },
    { title: '教育发展基金会：海鲸天悦运动健身中心开馆（2026-09-20）', url: 'https://jjh.cpu.edu.cn/article/17511' },
  ],
});

export const DORM_LETTER = Object.freeze({ 文轩苑: 'A', 文菁苑: 'B', 文萃苑: 'C', 文澜苑: 'D', 文枢苑: 'E', 文昌苑: 'F', 文思苑: 'G', 文华苑: 'H', 文正苑: 'H' });

// One numbered building may have multiple OSM polygons (D2); a single model may
// contain multiple numbered buildings (H6/H7). Neither polygon count is a count of dorms.
export function dormSummary(buildings) {
  const units = new Map();
  for (const b of buildings) {
    const match = b.name.match(/^(文.苑)(\d+(?:、\d+)*)号楼/);
    if (match) {
      for (const n of match[2].split('、').map(Number)) {
        units.set(`${match[1]}:${n}`, { group: match[1], n, code: DORM_LETTER[match[1]] ? `${DORM_LETTER[match[1]]}${n}` : `${match[1]}${n}` });
      }
    } else if (b.name) units.set(b.name, { group: b.name, n: null, code: null });
  }
  const sorted = [...units.values()].sort((a, b) => a.group.localeCompare(b.group, 'zh-CN') || (a.n ?? 0) - (b.n ?? 0));
  return { count: sorted.length, numbers: sorted.map(u => u.n).filter(n => n !== null), codes: sorted.map(u => u.code).filter(Boolean) };
}

export function isNatatorium(buildings) {
  return buildings.length === 1 && buildings[0].cls.special === 'natatorium';
}

export function heightLabel(buildings) {
  return isNatatorium(buildings) ? `${NATATORIUM.height} m` : `约 ${Math.round(Math.max(...buildings.map(b => b.h)))} m`;
}

export function geometrySource(buildings) {
  if (!buildings.length) return '校园地图位置示意';
  const sources = new Set();
  for (const b of buildings) {
    if (b.src === 'osm') sources.add('OpenStreetMap');
    else if (b.src === 'osm+') sources.add('OpenStreetMap 旧轮廓扩建估算');
    else if (b.src === 'photo+sat') sources.add('公开照片与卫星影像近似重建');
    else if (b.src?.startsWith('sat')) sources.add('卫星影像近似重建');
    else if (b.src?.startsWith('map')) sources.add('校园地图换算');
    else sources.add('模型估算');
  }
  return `轮廓：${[...sources].join('、')}`;
}

export function buildingFacts(place, buildings) {
  if (!buildings.length) return [];
  const facts = [];
  if (place.dorm) facts.push(['楼栋', `${dormSummary(buildings).count} 栋`]);
  else if (isNatatorium(buildings)) facts.push(['层数（项目公告）', `地上 ${NATATORIUM.floors} 层 · 地下 ${NATATORIUM.basementFloors} 层`]);
  else facts.push(['模型层数', buildings[0].cls.special === 'gym' ? '大空间' : `${buildings[0].cls.fl} 层`]);
  facts.push([isNatatorium(buildings) ? '建筑高度（项目公告）' : '模型高度', heightLabel(buildings)]);
  const area = buildings.reduce((a, b) => a + b.area, 0);
  facts.push(['模型占地', `约 ${Math.round(area).toLocaleString('zh-CN')} m²`]);
  return facts;
}
