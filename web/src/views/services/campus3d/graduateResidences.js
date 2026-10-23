// H6/H7 stays one selectable compound until north/south building numbers are verified.
// The dated imagery supports two tall end blocks and a low connecting volume.
// Keep the existing approximate ground envelope: roof parallax is not a surveyed offset.
export const GRADUATE_RESIDENCE = Object.freeze({
  name: '文正苑6、7号楼',
  modelTowerRoof: 25.6,
  modelTowerParapet: 0.9,
  modelLinkRoof: 4.5,
  modelLinkParapet: 0.55,
  modelNorthCut: -366.8,
  modelSouthCut: -324.2,
  checkedOn: '2026-10-23',
  sources: [
    { title: '学工处：文正苑·经纬社区（H4–H7）', url: 'https://xgc.cpu.edu.cn/81/3f/c18000a229695/page.htm' },
    { title: '学校：研究生公寓四期交付与实景照片（2024-08-23）', url: 'https://www.cpu.edu.cn/32/b3/c4132a209587/page.htm' },
    { title: 'Esri World Imagery：校园东北侧影像', url: 'https://www.arcgis.com/apps/mapviewer/index.html?basemap=satellite&center=118.9187,31.9066&level=19' },
  ],
});

// Clip the current model envelope, not an image roof outline. Cut positions and
// all heights above are modeling estimates; the source verifies only the massing relationship.
export function graduateVolumes(polygon) {
  const clip = (poly, z, sign) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = (a[1] - z) * sign, db = (b[1] - z) * sign;
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push([a[0] + t * (b[0] - a[0]), z]);
      }
    }
    return out;
  };
  const c = GRADUATE_RESIDENCE;
  return [
    { role: 'north', p: clip(polygon, c.modelNorthCut, -1), roof: c.modelTowerRoof, parapet: c.modelTowerParapet },
    { role: 'link', p: clip(clip(polygon, c.modelNorthCut, 1), c.modelSouthCut, -1), roof: c.modelLinkRoof, parapet: c.modelLinkParapet },
    { role: 'south', p: clip(polygon, c.modelSouthCut, 1), roof: c.modelTowerRoof, parapet: c.modelTowerParapet },
  ].map(v => ({ ...v, minY: 0, maxY: v.roof + v.parapet }));
}
