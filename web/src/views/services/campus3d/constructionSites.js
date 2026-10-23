// Dated construction evidence, not a prediction of the finished building or a live site survey.
import { GRADUATE5_REFERENCE_AREA } from './graduate5Registration.js';

export const GRADUATE_PHASE_FIVE = Object.freeze({
  name: '研究生公寓五期（在建）',
  referenceArea: GRADUATE5_REFERENCE_AREA,
  center: GRADUATE5_REFERENCE_AREA.reduce((a,p)=>[a[0]+p[0]/4,a[1]+p[1]/4],[0,0]),
  viewFrom: [143, -751],
  description: '位于北门西侧林地的独立建设项目。学校 2025 年试桩通知附图标出了施工区域，2026 年在建项目清单仍列有该项目。招标规划为地上 19 层、地下 1 层，约 59.80 米；这些不是当前施工高度。选中后的地面虚线仅表示通知附图的参考范围，现状结构与围挡边界尚待核实。',
  sources: [
    { title:'施工区域通知附图（2025-04-30）',url:'https://jjc.cpu.edu.cn/61/db/c494a221659/page.htm' },
    { title:'学校在建项目清单',url:'https://jjc.cpu.edu.cn/507/list.htm' },
    { title:'五期项目规划参数（2025-08-07）',url:'https://njggzy.nanjing.gov.cn/njweb/fjsz/068001/068001001/20250807/4108c9c9-35a7-42f5-b5d6-654d35a37e5e.html' },
  ],
});
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
