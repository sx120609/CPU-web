// Dated construction evidence, not a prediction of the finished building or a live site survey.
// The May 2025 site plan puts this parcel between No. 2 canteen and Bo'ai Road.
// Its four corners are aligned to the surrounding OSM road junctions, with a setback
// to keep the existing carriageways and footways outside the illustrated hoarding.
export const ACTIVITY_CENTER = Object.freeze({
  name: '大学生活动中心',
  alias: '科学艺术中心',
  checked: '2026-10-23',
  progressDate: '2026-09-22',
  site: [[307, -14], [395, 8], [367, 76], [271, 60]],
  shell: [[314, -3], [383, 14], [360, 63], [284, 49]],
  // Only the third-floor slab operation is evidenced. These level heights and
  // the structural grid are illustrative; they must not be presented as surveyed dimensions.
  slabs: [0.3, 4.5, 8.7],
  modelHeight: 9.6,
  // The July overhead photo shows the protected passage along the east face of
  // No. 2 canteen, outside the construction parcel. Both ends remain open.
  passage: [[265.4, 33.3], [290.9, -30.3]],
  passageWidth: 4.8,
  sources: [
    { title: '基建后勤处：在建工程（科学艺术中心）', url: 'https://jjc.cpu.edu.cn/507/list.htm' },
    { title: '施工区域附图（2025-05-23）', url: 'https://jjc.cpu.edu.cn/68/1e/c494a223262/page.htm' },
    { title: '二食堂东侧安全通道公告与实景图（2026-07-15）', url: 'https://jjc.cpu.edu.cn/b3/13/c494a242451/page.htm' },
    { title: '三层楼面浇筑通知（2026-09-22）', url: 'https://jjc.cpu.edu.cn/bb/0f/c494a244495/page.htm' },
  ],
});
