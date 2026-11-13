// Install a deterministic, offline UI harness in an isolated copy of harmony/.
// Never use a signed/release package or a real user account for visual acceptance.
import { copyFileSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const target = realpathSync(resolve(process.argv[2] || '.'));
if (target === source || !target.toLowerCase().includes('schedule')) {
  throw new Error('Pass an isolated schedule acceptance build directory, not the source project.');
}
const put = (path, content) => writeFileSync(resolve(target, path), content, 'utf8');
const semester = '2026-2027-1';
const weeks = Array.from({ length: 20 }, (_, i) => ({ value: String(i + 1), label: `第${i + 1}周`, current: i === 4 }));
const calendarWeeks = weeks.map(({ value }) => {
  const days = Array.from({ length: 7 }, (_, day) => {
    const date = new Date(Date.UTC(2026, 8, 7 + (Number(value) - 1) * 7 + day));
    return date.toISOString().slice(0, 10);
  });
  return { week: Number(value), days, monday: days[0], sunday: days[6] };
});
const courses = [
  [1, 1, 2, '药物设计学', '教学楼A101'],
  [1, 5, 8, '天然药物化学实验', '实验楼B203'],
  // The one course with a note someone wrote; the others carry the period label the academic system sends.
  [2, 1, 4, '药物化学', '教学楼B202', '带实验报告'],
  [2, 9, 12, '人工智能药学', '机房C301'],
  [3, 3, 4, '药物分析', '教学楼A102'],
  [3, 5, 6, '药剂学', '教学楼A203'],
  [4, 1, 2, '药事管理学', '教学楼C205'],
  [4, 5, 8, '生物药剂学与药物动力学', '实验楼D201'],
  [5, 3, 4, '药理学', '教学楼C101'],
  [5, 9, 11, '临床药学', '教学楼A102'],
  [6, 1, 1, '单节课程', 'A101'],
  [6, 3, 6, '超长课程名称用于检查手机课表自动换行和截断', '综合教学楼A102'],
  [6, 5, 6, '重叠课程', 'B203'],
  [6, 12, 12, '第十二节课程', 'A112'],
];
// Deliberately distinct fixture times prove that server configuration reaches
// the time axis and details. These are test data, not a bundled school timetable.
const periods = Array.from({ length: 12 }, (_, i) => {
  const start = 8 * 60 + i * 60;
  const time = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { id: i + 1, name: `第${i + 1}节`, start: time(start), end: time(start + 45) };
});
const snapshot = {
  version: 1, completeSemester: true, source: 'undergraduate',
  auth: { authenticated: true, identity: 'offline-schedule-acceptance' },
  data: {
    source: 'undergraduate', semesters: [{ value: semester, label: semester, current: true }],
    weeks, currentSemester: semester, currentWeek: '5',
    cells: courses.map(([day, startSlot, endSlot, name, location, note], index) => ({
      day, bigSlot: Math.ceil(startSlot / 2), courses: [{
        nativeId: `fixture-${index}`, name, location, teacher: '示例教师', weeks: '1-20周',
        weekList: weeks.map(({ value }) => Number(value)), startSlot, endSlot, editKeys: [`qa|${index}`],
        slotNote: note || `${String(startSlot).padStart(2, '0')}-${String(endSlot).padStart(2, '0')}节`,
      }],
    })),
  },
  // Week 6 carries one day off and one make-up day (Saturday takes Thursday's classes).
  calendar: { periods, currentWeek: 5, semesterStart: '2026-09-07', semesterEnd: '2027-01-24', weeks: calendarWeeks,
    adjustments: [{ date: calendarWeeks[5].days[0], kind: 'off', note: '校运动会' },
      { date: calendarWeeks[5].days[5], kind: 'swap', source: calendarWeeks[5].days[3] }] },
  // The stand-in keeps single-meeting changes (`--ps occurrences 1` seeds two).
  occurrenceChanges: [],
};
// `--ps occurrences 1`: this week Monday's first course is cancelled and Tuesday's first moved to
// Thursday evening, as iOS's CPU_DEBUG_OCCURRENCES.
const seededOccurrences = [{ key: 'qa|0', date: calendarWeeks[4].days[0], cancelled: true },
  { key: 'qa|2', date: calendarWeeks[4].days[1], toDate: calendarWeeks[4].days[3], startSlot: 9, endSlot: 10, location: '实验楼B101' }];
// `--ps data promo`: the sample timetable the iOS client uses for its store screenshots
// (NativeScheduleDebugFixture with CPU_DEBUG_VISUAL_SCHEDULE), on the school's own bell times.
const promoNames = ['高等数学', '大学英语', '有机化学', '药理学', '人体解剖生理学', '药物分析', '生物化学', '大学物理', '思想道德与法治',
  '体育', '药剂学', '中药学', '微生物学与免疫学', '分析化学', '药理学实验与实践', '高等数学', '大学英语', '药事管理学'];
const promoPeriods = [['08:00', '08:45'], ['08:55', '09:40'], ['09:55', '10:40'], ['10:50', '11:35'], ['13:30', '14:15'], ['14:25', '15:10'],
  ['15:25', '16:10'], ['16:20', '17:05'], ['18:30', '19:15'], ['19:25', '20:10'], ['20:20', '21:05'], ['21:15', '22:00']]
  .map(([start, end], index) => ({ id: index + 1, name: `第${index + 1}节`, start, end }));
const promoSnapshot = {
  version: 1, completeSemester: true, source: 'undergraduate',
  auth: { authenticated: true, identity: 'offline-schedule-acceptance' },
  data: {
    source: 'undergraduate', semesters: [{ value: semester, label: semester, current: true }],
    weeks, currentSemester: semester, currentWeek: '5',
    cells: promoNames.map((name, index) => {
      const startSlot = index === 16 ? 12 : index === 17 ? 11 : Math.floor(index / 6) * 4 + 1;
      const endSlot = startSlot + ([14, 16].includes(index) ? 0 : 1);
      return { day: index % 6 + 1, bigSlot: Math.ceil(startSlot / 2), courses: [{
        nativeId: `promo-${index}`, name, location: `教学楼 ${201 + index}`, teacher: `${['李', '王', '张'][index % 3]}老师`, weeks: '1-20周',
        weekList: weeks.map(({ value }) => Number(value)), startSlot, endSlot,
      }] };
    }),
  },
  calendar: { periods: promoPeriods, currentWeek: 5, semesterStart: '2026-09-07', semesterEnd: '2027-01-24', weeks: calendarWeeks },
};
// `--ps overlay 1`: a classmate at another school laid over the timetable, on that school's bells
// (15 forty-minute periods), so the strip places their courses by clock time.
const otherPeriods = [['08:00', '08:40'], ['08:50', '09:30'], ['09:40', '10:20'], ['10:30', '11:10'], ['11:20', '12:00'],
  ['13:30', '14:10'], ['14:20', '15:00'], ['15:10', '15:50'], ['16:00', '16:40'], ['16:50', '17:30'], ['18:30', '19:10'],
  ['19:20', '20:00'], ['20:10', '20:50'], ['21:00', '21:40'], ['21:50', '22:30']].map(([start, end], index) => ({ id: index + 1, start, end }));
const otherCourses = [[1, 1, 3, '系统解剖学', '基础楼201'], [1, 6, 7, '医学心理学', '求索楼B102'], [2, 3, 5, '组织胚胎学', '基础楼305'],
  [3, 1, 2, '药物设计学', '教学楼A101'], [3, 11, 12, '大学生心理健康', '线上'], [4, 6, 8, '病理学实验', '实验楼E210'], [5, 2, 4, '生理学', '基础楼102']];
const overlayDocument = { code: 'NJMU2345', owner: '小林', semester, courseCount: otherCourses.length,
  createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-06T12:30:00.000Z',
  schedule: { cells: otherCourses.map(([day, startSlot, endSlot, name, location]) => ({ day, bigSlot: Math.ceil(startSlot / 2),
    courses: [{ name, location, teacher: '', weeks: '1-20周', weekList: weeks.map(({ value }) => Number(value)), startSlot, endSlot }] })) },
  calendar: { ...snapshot.calendar, periods: otherPeriods, school: '南京医科大学' } };
// What the stand-in share server hands back for any code: the same timetable under another name.
const shareDocument = { code: 'ABCD2345', owner: '阿青', semester, courseCount: courses.length,
  createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-06T12:30:00.000Z',
  schedule: { cells: snapshot.data.cells }, calendar: snapshot.calendar };
// `--ps couple active`: a partner whose timetable meets the user's in every way the grid draws:
// Monday the same class, Tuesday and Thursday classes that meet the user's, the rest hers alone.
const partnerCourses = [
  [1, 1, 2, '药物设计学', '教学楼A101'],
  [2, 3, 4, '高等数学', '理科楼B105'],
  [3, 1, 2, '物理化学', '教学楼C210'],
  [4, 5, 6, '分析化学实验', '实验楼E305'],
  [5, 5, 6, '医用物理学', '理科楼A301'],
  [7, 3, 4, '周日社团：合唱', '大学生活动中心'],
];
const coupleMember = (id, nickname) => ({ id, color: 'blue', nickname, avatar: null,
  snapshot: { semester, syncedAt: '2026-10-08T01:30:00.000Z', changedAt: '2026-10-07T02:00:00.000Z' } });
const coupleStatus = {
  none: { status: 'none' },
  pending: { status: 'pending', invite: { code: 'K7M2QX', expiresAt: '2099-01-01T00:00:00.000Z', expired: false } },
  active: { status: 'active', since: '2026-09-01T02:00:00.000Z', anniversary: '2025-05-20',
    me: coupleMember(1, '阿青'), partner: coupleMember(2, '小鹿') },
};
const coupleSchedules = { me: null, partner: { semester, syncedAt: '2026-10-08T01:30:00.000Z', changedAt: '2026-10-07T02:00:00.000Z',
  schedule: { cells: partnerCourses.map(([day, startSlot, endSlot, name, location]) => ({ day, bigSlot: Math.ceil(startSlot / 2),
    courses: [{ name, location, teacher: '', weeks: '1-20周', weekList: weeks.map(({ value }) => Number(value)), startSlot, endSlot }] })) },
  calendar: snapshot.calendar } };
// `--ps dorm active`: a four-person dorm. The sheet's data is worked out here with the bridge's own
// dormView (harmony/bridge/dorm.ts, the site's dorm.ts and dormWeek.ts) on fixture timetables.
const dormStatus = { status: 'active', id: 7, name: '梅苑 3-402', memberLimit: 6, isOwner: true, since: '2026-09-01T00:00:00.000Z',
  invite: { code: 'K7M2QX', expiresAt: '2099-01-01T00:00:00.000Z', expired: false },
  me: { id: 1, color: 'blue', nickname: '阿青', avatar: null, isOwner: true, snapshot: { semester, syncedAt: '2026-11-10T08:00:00.000Z', changedAt: '' } },
  members: [] };
const dormPeople = [[1, 'blue', '阿青', true], [2, 'pink', '小鹿', false], [3, 'green', '阿杰', false], [4, 'amber', '老周', false]];
dormStatus.members = dormPeople.map(([id, color, nickname, synced]) => ({ id, color, nickname, avatar: null, isOwner: id === 1,
  snapshot: id === 4 ? null : { semester, syncedAt: '2026-11-10T08:00:00.000Z', changedAt: '' } }));
const dormSnapshots = {
  1: { semester, syncedAt: '', changedAt: '', schedule: snapshot.data, calendar: snapshot.calendar },
  2: { semester, syncedAt: '', changedAt: '', schedule: { ...snapshot.data, cells: coupleSchedules.partner.schedule.cells }, calendar: snapshot.calendar },
  3: { semester, syncedAt: '', changedAt: '', schedule: { ...snapshot.data, cells: overlayDocument.schedule.cells }, calendar: overlayDocument.calendar },
};
const dormBundle = (() => {
  const { buildSync } = createRequire(resolve(source, '../web/package.json'))('esbuild');
  const out = buildSync({ entryPoints: [resolve(source, 'bridge/dorm.ts')], bundle: true, write: false, format: 'cjs', platform: 'node',
    alias: { '@': resolve(source, '../web/src') } });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, () => ({}));
  return module.exports;
})();
const dormReaders = dormBundle.createDormReaders(dormPeople.map(([id, color, nickname]) => ({ id, color, nickname, snapshot: dormSnapshots[id] ?? null })));
const dormViews = { this: dormBundle.dormView(dormReaders, dormStatus, {}), relaxed: dormBundle.dormView(dormReaders, dormStatus, { minFree: 2 }) };
put('entry/src/main/ets/pages/ScheduleAcceptance.ets', `
import { NativeSchedulePage } from '../schedule/NativeSchedulePage';
import { NativeCourseBlock, NativeScheduleStore, NativeScheduleRequest, NativeOccurrenceChange, NativeOccurrenceRequest,
  NativeScheduleSnapshot } from '../schedule/NativeScheduleStore';
import { applyOccurrencesToCells } from '../schedule/ScheduleOccurrences';
import { CourseEditorRequest, NativeCourseEditor, NativeCourseEditorModel } from '../schedule/NativeCourseEditor';
import { agendaDateOf, agendaDayNumber, AgendaReply, NativeAgendaDraft, NativeAgendaExtracted, NativeAgendaModel } from '../schedule/NativeAgenda';
import { agendaToday, NativeAgendaEditor, NativeAgendaEditorModel } from '../schedule/NativeAgendaEditor';
import { NativeAgendaItem } from '../schedule/NativeScheduleStore';
import { NativeScheduleSharing, NativeScheduleSharingModel, ShareApiData, ShareApiReply, ShareApiRequest } from '../schedule/NativeScheduleSharing';
import { librarySave, RawShareDocument, readSharedSchedule, SharedSchedule, SharePublishBody, sharedScheduleSnapshot,
  sharePublishBody } from '../schedule/ScheduleSharing';
import { NativeOverlayPicker } from '../schedule/NativeOverlayPicker';
import { NativeCommonFree } from '../schedule/NativeCommonFree';
import { ScheduleCardView } from '../schedulewidget/ScheduleCardView';
import { ScheduleWidgetBinding, refreshAllScheduleForms, saveLocalScheduleSnapshot, saveScheduleWidgetDisplayOptions,
  scheduleWidgetBindingAt } from '../common/ScheduleWidgetService';
import { ScheduleWidgetDisplayOptions, defaultWidgetDisplayOptions } from '../common/ScheduleWidgetOptions';
import { ScheduleCardSettings } from '../schedule/ScheduleCardSettings';
import { LocalScheduleRecord, localScheduleRecord } from '../schedule/NativeWidgetLocalSchedule';
import { NativeScheduleCell } from '../schedule/NativeScheduleStore';
import preferences from '@ohos.data.preferences';
import { DormReply, DormRequest, DormViewReply, NativeDormModel, NativeDormSheet } from '../schedule/NativeDormSheet';
import { NativeBackgroundCrop } from '../schedule/NativeBackgroundCrop';
import { DayShareCardData, dayShareCard, dayShareCardData } from '../schedule/ScheduleDayShareCard';
import { shareSnapshotImage } from '../schedule/ScheduleImageShare';
import fs from '@ohos.file.fs';
import { CoupleApiData, CoupleApiReply, CoupleApiRequest, NativeScheduleCouple, NativeScheduleCoupleModel } from '../schedule/NativeScheduleCouple';
import { normalizeScheduleStyle, scheduleClockMinutes, SCHEDULE_STYLES } from '../schedule/ScheduleStyle';
import { NativeTabBar } from '../common/NativeTabBar';
import { nativeNavigationBottomInset, nativeNavigationClearance } from '../common/NativeNavigationLayout';
import { SCHEDULE_PALETTES } from '../schedule/SchedulePalettes';
import { scheduleSurface } from '../schedule/ScheduleLayout';
import common from '@ohos.app.ability.common';
import ConfigurationConstant from '@ohos.app.ability.ConfigurationConstant';
import window from '@ohos.window';
import { LengthMetrics } from '@kit.ArkUI';

interface QaEditorReply { session?: string; hidden?: string[]; priority?: Record<string, number>; saved?: boolean; }
interface QaAgendaRequest { action?: string; id?: string; date?: string; done?: boolean; on?: boolean; text?: string; data?: NativeAgendaItem; }
interface QaExtractReply { items: NativeAgendaExtracted[]; message: string; }
// One card of the gallery: a kind and size of card at a pinned moment, under a set of display options.
interface QaCardSample { caption: string; binding: ScheduleWidgetBinding; width: number; height: number; now: number; }

@Entry
@Component
struct ScheduleAcceptance {
  @State private store: NativeScheduleStore = new NativeScheduleStore();
  @State private editor: NativeCourseEditorModel = new NativeCourseEditorModel();
  // 日程 talk to a stand-in for the page's CPUTimeNativeAgenda, seeded around today.
  @State private agendaEditor: NativeAgendaEditorModel = new NativeAgendaEditorModel();
  private agenda?: NativeAgendaModel;
  private agendaItems: NativeAgendaItem[] = [];
  private agendaRelay: boolean = false;
  @State private sharing: NativeScheduleSharingModel = new NativeScheduleSharingModel();
  @State private sharedStore: NativeScheduleStore = new NativeScheduleStore();
  @State private sharedVisible: boolean = false;
  @State private couple: NativeScheduleCoupleModel = new NativeScheduleCoupleModel();
  @State private noCouple: NativeScheduleCoupleModel = new NativeScheduleCoupleModel();
  // none | pending | active: what the stand-in couple server answers.
  @StorageProp('qaCouple') private coupleState: string = '';
  // "teal,amber": the user's colour, then the partner's.
  @StorageProp('qaCoupleColors') private coupleColors: string = '';
  private coupleMine: string = 'blue';
  private coupleTheirs: string = 'pink';
  @StorageProp('qaStyle') @Watch('syncOptions') private style: string = 'classic';
  @StorageProp('qaWeekend') @Watch('syncOptions') private weekend: boolean = true;
  // Display settings, comma separated: sundayFirst, offWeek, teacher, compact, noTime, noSaturday,
  // noSunday, noToday, small or large, rows=140.
  @StorageProp('qaDisplay') @Watch('syncOptions') private display: string = '';
  @StorageProp('qaNow') @Watch('syncOptions') private now: string = '';
  @StorageProp('qaPriority') @Watch('syncOptions') private priority: string = '';
  @StorageProp('qaWeek') @Watch('syncOptions') private week: string = '';
  @StorageProp('qaDay') @Watch('syncOptions') private day: string = '';
  @StorageProp('qaPanel') @Watch('syncOptions') private panel: string = '';
  @StorageProp('qaData') private data: string = '';
  // Store screenshots: no system status bar, which on an emulator carries debugging icons.
  @StorageProp('qaClean') private clean: boolean = false;
  @StorageProp('qaOccurrences') private seedOccurrences: string = '';
  @StorageProp('qaOverlay') private overlaySeed: string = '';
  @State private overlayPicker: boolean = false;
  @State private commonFree: boolean = false;
  // \`--ps panel cards\`: today's card in the four card styles, the last over a photo.
  @State private cardsShown: boolean = false;
  // \`--ps panel cardGallery --ps cards live|sizes|today|preview|twoDay|options|states\`: the service cards at their
  // desktop sizes (2×2 149×149, 2×4 320×149, 4×4 320×340), each at a pinned moment of week 10 of the fixture;
  // \`--ps cardStyle classic|table|paper|board\` draws them in that card style. \`--ps panel cardSettings\` shows the
  // display options of the cards panel over a sample card. \`--ps cardOptions large,hideCompleted,noWeek,...\`
  // (auto, small, large, hideCompleted, noProgress, noWeek, noLunar, noHoliday, noResident, noName, noRoom,
  // noTeacher, noTime; \`default\` for none) saves those options for the cards on the desktop and refreshes them;
  // the desktop cards read the fixture timetable, which this page writes down like the app does.
  @StorageProp('qaCards') private cardsPage: string = '';
  @StorageProp('qaCardStyle') private qaCardStyle: string = 'classic';
  @StorageProp('qaCardOptions') private cardOptionFlags: string = '';
  @State private gallery: QaCardSample[] = [];
  @State private cardSettingsShown: boolean = false;
  @State private cardOptions: ScheduleWidgetDisplayOptions = defaultWidgetDisplayOptions();
  private cardRows: string = ${JSON.stringify(JSON.stringify([
    { name: '药物化学', start: '08:00', time: '08:00–09:45', meta: '@B202', ended: false, accent: '#2563EB', tint: '#DBEAFE', colorIndex: 1 },
    { name: '药理学', start: '10:00', time: '10:00–11:45', meta: '@C101', ended: false, accent: '#0F766E', tint: '#CCFBF1', colorIndex: 3 },
    { name: '临床药学', start: '16:00', time: '16:00–18:45', meta: '@A102', ended: false, accent: '#BE185D', tint: '#FCE7F3', colorIndex: 5 }]))};
  @State private dorm: NativeDormModel = new NativeDormModel();
  @StorageProp('qaDorm') private dormState: string = '';
  // \`--ps background 1\` puts a photo behind the timetable (light; \`dark\` too with backgroundDark 1),
  // \`--ps crop x,y,w,h\` frames it, \`--ps panel crop\` opens 调整范围.
  @StorageProp('qaBackground') private backgroundSeed: string = '';
  @StorageProp('qaCrop') private cropSeed: string = '';
  @State private cropOpen: boolean = false;
  // \`--ps holiday 国庆快乐\`: every free day is that holiday. \`--ps panel shareCard\` shows the day card on screen.
  @StorageProp('qaHoliday') private holiday: string = '';
  @State private cardShown: boolean = false;
  private shareCard: DayShareCardData = { brand: '', title: '', subtitle: '', items: [], emptyText: '' };
  private occurrences: NativeOccurrenceChange[] = [];
  private published: boolean = false;
  @StorageProp('systemTopInsetPx') private topInset: number = 0;
  @StorageProp('systemBottomInsetPx') private bottomInset: number = 0;
  @StorageProp('qaTheme') @Watch('syncOptions') private theme: string = 'color-glass';
  @StorageProp('qaDark') @Watch('syncOptions') private dark: boolean = false;
  @StorageProp('qaMode') @Watch('syncOptions') private mode: string = 'week';
  @StorageProp('qaState') @Watch('syncOptions') private state: string = 'loaded';
  private syncOptions(): void {
    this.store.dark = this.dark;
    this.applySystemAppearance();
    this.store.palette = this.theme;
    this.store.visualStyle = normalizeScheduleStyle(this.style);
    const flags = this.display.split(',').map((flag: string) => flag.trim());
    const rows = flags.find((flag: string) => flag.startsWith('rows='));
    this.store.resetDisplay();
    this.store.showSaturday = this.weekend && !flags.includes('noSaturday');
    this.store.showSunday = this.weekend && !flags.includes('noSunday');
    this.store.sundayFirst = flags.includes('sundayFirst');
    this.store.showOffWeek = flags.includes('offWeek');
    this.store.showTeacher = flags.includes('teacher');
    this.store.compactLayout = flags.includes('compact');
    this.store.showSlotTime = !flags.includes('noTime');
    this.store.showBackToWeek = !flags.includes('noToday');
    this.store.textSize = flags.includes('small') ? 'small' : flags.includes('large') ? 'large' : 'standard';
    if (rows) this.store.rowHeight = Number(rows.substring(5)) || 100;
    if (this.state === 'loaded') {
      this.store.load(true);
      this.store.setViewMode(this.mode);
      if (this.week) this.store.selectWeek(this.week);
      if (this.day) this.store.selectDay(Number(this.day));
      const priorities: Record<string, number> = {};
      if (this.priority) priorities[this.priority] = 1;
      this.store.setPriorities('${semester}', priorities);
      if (this.panel === 'editor') this.openEditor(this.store.displayBlocks(this.store.selectedDay)[0]);
      if (this.panel === 'add') this.openEditor();
      if (this.panel === 'sharing') this.sharing.open();
      if (this.panel === 'couple') this.couple.open();
      if (this.panel === 'agenda') setTimeout(() => this.agendaEditor.openList(), 400);
      if (this.panel === 'agendaNew') setTimeout(() => this.agendaEditor.openNew(agendaToday(), '14:00'), 400);
      if (this.panel === 'agendaEdit') setTimeout(() => { if (this.agendaItems.length) this.agendaEditor.openItem(this.agendaItems[0]); }, 400);
      if (this.panel === 'agendaExtract') setTimeout(() => { this.agendaEditor.openNew('', ''); this.agendaEditor.extractText('qa'); }, 400);
    } else {
      this.store.viewMode = this.mode;
      this.store.result = undefined;
      this.store.status = this.state === 'loading' ? 'loading' : this.state === 'unauthorized' ? 'unauthorized' : 'failed';
      this.store.errorMessage = this.state === 'failed' ? '离线验收：模拟网络失败' : '';
    }
  }
  private applySystemAppearance(): void {
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context) return;
    context.getApplicationContext().setColorMode(this.store.dark ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK : ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT);
    void window.getLastWindow(context).then(main => {
      if (this.clean) void main.setSpecificSystemBarEnabled('status', false).catch(() => undefined);
      return main.setWindowSystemBarProperties({
      statusBarColor: '#00000000', statusBarContentColor: this.store.dark ? '#FFFFFF' : '#202722',
      navigationBarColor: '#00000000', navigationBarContentColor: this.store.dark ? '#FFFFFF' : '#172033'
      });
    }).catch(() => undefined);
  }
  private topPadding(): number { return this.clean ? 16 : px2vp(this.topInset); }
  private toggleAppearance(): void {
    this.store.dark = !this.store.dark;
    this.applySystemAppearance();
  }
  // The fixture with the stand-in's single-meeting changes written in, as the site does.
  private snapshotJson(): string {
    const base = JSON.parse(this.data === 'promo'
      ? ${JSON.stringify(JSON.stringify(promoSnapshot))} : ${JSON.stringify(JSON.stringify(snapshot))}) as NativeScheduleSnapshot;
    if (base.data && base.calendar) base.data.cells = applyOccurrencesToCells(base.data.cells, this.occurrences, base.calendar.weeks);
    if (this.data !== 'promo') base.occurrenceChanges = this.occurrences;
    base.fetchedAt = Date.now();
    return JSON.stringify(base);
  }
  aboutToAppear(): void {
    if (this.seedOccurrences === '1') this.occurrences = JSON.parse(${JSON.stringify(JSON.stringify(seededOccurrences))}) as NativeOccurrenceChange[];
    this.store.attach((request: NativeScheduleRequest) => {
      if (request.id) this.store.acceptResult(request.id, this.snapshotJson());
    }, () => undefined);
    this.store.occurrenceSaver = async (request: NativeOccurrenceRequest): Promise<string> => {
      const kept = this.occurrences.filter((item: NativeOccurrenceChange) => !(request.keys.includes(item.key) && item.date === request.date));
      const change = request.change;
      const added: NativeOccurrenceChange[] = change ? request.keys.map((key: string): NativeOccurrenceChange => {
        const item: NativeOccurrenceChange = JSON.parse(JSON.stringify(change)) as NativeOccurrenceChange;
        item.key = key;
        item.date = request.date;
        return item;
      }) : [];
      this.occurrences = kept.concat(added);
      return '';
    };
    this.store.markBridgeReady();
    this.editor.attach((id: string, request: CourseEditorRequest) => {
      const opened: QaEditorReply = { session: 'offline-acceptance', hidden: [], priority: this.store.displayPriorities() };
      const saved: QaEditorReply = { saved: true };
      setTimeout(() => this.editor.accept(id, JSON.stringify(request.action === 'open' ? opened : saved)), 60);
    }, () => undefined);
    this.attachAgenda();
    this.sharing.attach((request: ShareApiRequest) => this.shareApi(request), () => undefined);
    this.couple.attach((request: CoupleApiRequest) => this.coupleApi(request), () => undefined);
    const picked = this.coupleColors.split(',');
    if (picked.length === 2) { this.coupleMine = picked[0].trim(); this.coupleTheirs = picked[1].trim(); }
    if (this.coupleState) void this.couple.refresh(true);
    if (this.overlaySeed === '1') {
      const shared = readSharedSchedule(JSON.parse(${JSON.stringify(JSON.stringify(overlayDocument))}) as RawShareDocument, Date.now());
      this.sharing.library = librarySave(this.sharing.library, shared, '');
      this.couple.setOverlay(shared);
    }
    if (this.panel === 'overlayPicker') setTimeout(() => this.overlayPicker = true, 600);
    if (this.panel === 'commonFree') setTimeout(() => this.commonFree = true, 600);
    if (this.panel === 'cards') setTimeout(() => this.cardsShown = true, 600);
    if (this.panel === 'cardGallery') setTimeout(() => this.buildGallery(), 600);
    if (this.panel === 'cardSettings') setTimeout(() => { this.buildSettingsSample(); this.cardSettingsShown = true; }, 600);
    this.seedDesktopCards();
    this.dorm.attach((request: DormRequest) => this.dormApi(request), () => undefined);
    if (this.panel.startsWith('dorm')) setTimeout(() => {
      this.dorm.page = this.panel === 'dormFree' ? 'free' : this.panel === 'dormMorning' ? 'morning' : this.panel === 'dormRoom' ? 'room' : 'week';
      this.dorm.open(this.panel === 'dormJoin' ? 'K7M2QX' : '');
    }, 600);
    if (this.backgroundSeed) this.seedBackground();
    if (this.panel === 'crop') setTimeout(() => this.cropOpen = true, 600);
    this.store.debugGreeting = this.holiday;
    if (this.panel === 'shareCard') setTimeout(() => {
      this.shareCard = dayShareCardData(this.store, this.store.rawDate(this.store.selectedDay), '拾间课表');
      this.cardShown = true;
    }, 800);
    this.syncOptions();
  }
  private async coupleApi(request: CoupleApiRequest): Promise<CoupleApiReply> {
    if (request.action === 'invite') this.coupleState = 'pending';
    else if (request.action === 'cancelInvite' || request.action === 'unbind') this.coupleState = 'none';
    else if (request.action === 'accept') this.coupleState = 'active';
    else if (request.action === 'settings') {
      // Picking the partner's colour swaps the two, as the server does.
      const picked = (JSON.parse(JSON.stringify(request.body ?? {})) as Record<string, string>)['myColor'];
      if (picked) {
        if (picked === this.coupleTheirs) this.coupleTheirs = this.coupleMine;
        this.coupleMine = picked;
      }
    }
    const status = this.coupleState === 'pending' ? ${JSON.stringify(JSON.stringify(coupleStatus.pending))}
      : this.coupleState === 'active' ? ${JSON.stringify(JSON.stringify(coupleStatus.active))}
      : ${JSON.stringify(JSON.stringify(coupleStatus.none))};
    const raw = request.action === 'schedules' ? ${JSON.stringify(JSON.stringify(coupleSchedules))} : request.action === 'sync' ? '{"changed":false}' : status;
    const data = JSON.parse(raw) as CoupleApiData;
    if (data.me) data.me.color = this.coupleMine;
    if (data.partner && data.status === 'active') data.partner.color = this.coupleTheirs;
    const reply: CoupleApiReply = { ok: true, status: 200, data };
    return reply;
  }
  private async dormApi(request: DormRequest): Promise<DormReply> {
    if (request.action === 'view') {
      const raw = this.dormState === 'active'
        ? '{"status":' + ${JSON.stringify(JSON.stringify(dormStatus))} + ',"view":' + (request.minFree
          ? ${JSON.stringify(JSON.stringify(dormViews.relaxed))} : ${JSON.stringify(JSON.stringify(dormViews.this))}) + '}'
        : '{"status":{"status":"none"}}';
      const reply: DormReply = { data: JSON.parse(raw) as DormViewReply };
      return reply;
    }
    if (request.action === 'join' || request.action === 'invite') this.dormState = 'active';
    if (request.action === 'leave') this.dormState = '';
    const done: DormReply = { data: { status: 'active' } };
    return done;
  }
  @Builder
  private shareCardBuilder() {
    dayShareCard(this.shareCard)
  }
  private shareDay(): void {
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context) return;
    this.shareCard = dayShareCardData(this.store, this.store.rawDate(this.store.selectedDay), '拾间课表');
    void shareSnapshotImage(context, this.getUIContext(), () => { this.shareCardBuilder() }, 'qa-day.png');
  }
  private seedBackground(): void {
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context) return;
    try {
      const target = context.filesDir + '/qa-background.jpg';
      const bytes = context.resourceManager.getRawFileContentSync('qa-background.jpg');
      const file = fs.openSync(target, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      try { fs.writeSync(file.fd, bytes.buffer); } finally { fs.closeSync(file); }
      this.store.backgroundPath = 'file://' + target;
      this.store.backgroundCrop = this.cropSeed;
      this.store.backgroundOpacity = 0.3;
      if (this.backgroundSeed === 'dark') { this.store.backgroundDarkPath = 'file://' + target; this.store.backgroundDarkCrop = ''; }
    } catch (_) {}
  }
  private attachAgenda(): void {
    const today = agendaDayNumber(agendaToday());
    const item = (id: string, title: string, offset: number, start: string, end: string, location: string): NativeAgendaItem => ({
      id: id, title: title, date: offset < -100 ? '' : agendaDateOf(today + offset), start: start, end: end, location: location, note: '',
      remind: start ? 15 : -1, repeat: 'none', until: '', done: false, doneDates: [], createdAt: 1 });
    this.agendaItems = [item('qaagenda0001', '有机化学实验报告', 0, '15:00', '16:30', '实验楼 B204'), item('qaagenda0002', '交药理学作业', 0, '', '', ''),
      item('qaagenda0003', '体检', 1, '', '', '校医院'), item('qaagenda0004', '英语答疑', 2, '10:00', '10:40', '文科楼'),
      item('qaagenda0005', '还图书馆的书', -3, '', '', ''), item('qaagenda0006', '买实验服', -1000, '', '', '')];
    const model = new NativeAgendaModel(this.store);
    this.agenda = model;
    model.attach((id: string, payload: string) => {
      setTimeout(() => model.accept(id, this.agendaApi(JSON.parse(payload) as QaAgendaRequest)), 120);
    }, () => undefined, () => undefined);
    this.agendaEditor.attach(model);
    this.store.agendaOpen = (id: string) => {
      const found = this.store.agendaItems.find((entry: NativeAgendaItem) => entry.id === id);
      if (found) this.agendaEditor.openItem(found); else this.agendaEditor.openList();
    };
    this.store.agendaNew = (date: string, start: string) => this.agendaEditor.openNew(date, start);
    this.store.agendaList = () => this.agendaEditor.openList();
    this.store.agendaToggle = (id: string, date: string, done: boolean) => model.toggle(id, date, done);
    model.refresh(true);
  }
  private agendaApi(request: QaAgendaRequest): string {
    if (request.action === 'extract') {
      // What the stand-in "reads" from any screenshot or notice (截图识别).
      const day = (offset: number): string => agendaDateOf(agendaDayNumber(agendaToday()) + offset);
      const read: NativeAgendaExtracted[] = [
        { title: '药学院学术讲座：AI 与新药发现', date: day(4), start: '14:00', end: '16:00', location: '江宁校区 药学楼 101',
          note: '· 携带学生证，提前 10 分钟签到\\n· 计入第二课堂学分 0.5', remind: 30, repeat: 'none' },
        { title: '讲座报名截止', date: day(2), start: '18:00', end: '', location: '', note: '· 在“药大青年”小程序报名，名额 120 人',
          remind: 60, repeat: 'none' }
      ];
      const reply: QaExtractReply = { items: read, message: '' };
      return JSON.stringify(reply);
    }
    if (request.action === 'parse') {
      // A rough stand-in for the page's parseAgendaText: 明天, HH:MM and @place.
      let text = request.text ?? '';
      const draft: NativeAgendaDraft = { title: '', date: '', start: '', end: '', location: '', remind: -1, repeat: 'none' };
      if (text.indexOf('明天') >= 0) { draft.date = agendaDateOf(agendaDayNumber(agendaToday()) + 1); text = text.replace('明天', ''); }
      const time = /(\d{1,2}):(\d{2})/.exec(text);
      if (time) { draft.start = (time[1].length === 1 ? '0' : '') + time[1] + ':' + time[2]; text = text.replace(time[0], ''); if (!draft.date) draft.date = agendaToday(); }
      const place = /@(\S+)/.exec(text);
      if (place) { draft.location = place[1]; text = text.replace(place[0], ''); }
      draft.title = text.trim();
      const parsed: AgendaReply = { parsed: draft };
      return JSON.stringify(parsed);
    }
    if (request.action === 'save' && request.data) {
      const saved = request.data;
      if (!saved.id) { saved.id = 'qanew' + Date.now(); saved.createdAt = Date.now(); }
      this.agendaItems = this.agendaItems.filter((entry: NativeAgendaItem) => entry.id !== saved.id).concat([saved]);
      const reply: AgendaReply = { authenticated: true, account: 'qa', items: this.agendaItems, relay: this.agendaRelay, saved: saved };
      return JSON.stringify(reply);
    }
    if (request.action === 'remove') this.agendaItems = this.agendaItems.filter((entry: NativeAgendaItem) => entry.id !== request.id);
    if (request.action === 'relay') this.agendaRelay = request.on === true;
    if (request.action === 'toggle') {
      this.agendaItems = this.agendaItems.map((entry: NativeAgendaItem) => {
        if (entry.id === request.id) entry.done = request.done === true;
        return entry;
      });
    }
    const reply: AgendaReply = { authenticated: true, account: 'qa', items: this.agendaItems, relay: this.agendaRelay };
    return JSON.stringify(reply);
  }
  // The editor and the sharing page talk to stand-ins for the Web bridge and the share server.
  private openEditor(block?: NativeCourseBlock, day?: number, slot?: number): void {
    this.store.detailVisible = false;
    setTimeout(() => this.editor.open(this.store, block, day, slot), 250);
  }
  private cycleStyle(): void {
    this.store.visualStyle = SCHEDULE_STYLES[(SCHEDULE_STYLES.indexOf(this.store.visualStyle) + 1) % SCHEDULE_STYLES.length];
  }
  private async shareApi(request: ShareApiRequest): Promise<ShareApiReply> {
    const mine: ShareApiData = { code: 'WXYZ6789', owner: '我', semester: '${semester}',
      courseCount: this.data === 'promo' ? ${new Set(promoNames).size} : ${courses.length},
      createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-07T01:00:00.000Z' };
    let data: ShareApiData = {};
    const missing: ShareApiReply = { ok: false, status: 404, error: '分享课表不存在或已撤销' };
    if (request.action === 'mine') {
      data.shares = this.published ? [mine] : [];
    } else if (request.action === 'publish') {
      data = mine;
      data.created = !this.published;
      data.changed = !this.published;
      this.published = true;
    } else if (request.action === 'revoke') {
      this.published = false;
    } else if (request.code === 'ZZZZ2222') {
      return missing;
    } else {
      data = JSON.parse(${JSON.stringify(JSON.stringify(shareDocument))}) as ShareApiData;
      data.code = request.code;
    }
    const reply: ShareApiReply = { ok: true, status: 200, data };
    return reply;
  }
  private openShared(schedule: SharedSchedule): void {
    const store = new NativeScheduleStore();
    const raw = JSON.stringify(sharedScheduleSnapshot(schedule, Date.now()));
    store.readOnly = true;
    store.dark = this.store.dark;
    store.palette = this.store.palette;
    store.visualStyle = this.store.visualStyle;
    store.attach((request: NativeScheduleRequest) => { if (request.id) store.acceptResult(request.id, raw); }, () => undefined);
    store.markBridgeReady();
    this.sharing.visible = false;
    this.sharedStore = store;
    this.sharedVisible = true;
  }
  @Builder
  private panelSheet() {
    if (this.dorm.visible) {
      NativeDormSheet({ model: this.dorm, dark: this.store.dark })
    } else if (this.commonFree) {
      NativeCommonFree({ store: this.store, couple: this.couple, sharing: this.sharing,
        onAgenda: (date: string, start: string) => this.agendaEditor.openNew(date, start), onDone: () => this.commonFree = false })
    } else if (this.overlayPicker) {
      NativeOverlayPicker({ couple: this.couple, sharing: this.sharing, onDone: () => this.overlayPicker = false })
    } else if (this.editor.visible) {
      NativeCourseEditor({ model: this.editor })
    } else if (this.agendaEditor.visible) {
      NativeAgendaEditor({ model: this.agendaEditor, store: this.store })
    } else if (this.couple.sheetVisible) {
      NativeScheduleCouple({ model: this.couple, dark: this.store.dark, nowMinutes: this.store.nowMinutes })
    } else {
      NativeScheduleSharing({ model: this.sharing, semester: '${semester}', semesterLabel: '2026–27 秋', canPublish: true,
        publishBody: (): SharePublishBody => sharePublishBody(this.store.completeSnapshot(), this.store.periods),
        onOpen: (schedule: SharedSchedule) => this.openShared(schedule) })
    }
  }
  private qaCardOptions(flags: string): ScheduleWidgetDisplayOptions {
    const options = defaultWidgetDisplayOptions();
    flags.split(',').forEach((raw: string) => {
      const flag = raw.trim();
      if (flag === 'auto' || flag === 'small' || flag === 'large') options.textSize = flag;
      if (flag === 'hideCompleted') options.hideCompleted = true;
      if (flag === 'noProgress') options.showProgress = false;
      if (flag === 'noWeek') options.showWeek = false;
      if (flag === 'noLunar') options.showLunarDate = false;
      if (flag === 'noHoliday') options.showHoliday = false;
      if (flag === 'noResident') options.holidayAlwaysVisible = false;
      if (flag === 'noName') options.showCourseName = false;
      if (flag === 'noRoom') options.showRoom = false;
      if (flag === 'noTeacher') options.showTeacher = false;
      if (flag === 'noTime') options.showTime = false;
    });
    return options;
  }
  private fixtureRecord(): LocalScheduleRecord | undefined {
    const snapshot = JSON.parse(this.snapshotJson()) as NativeScheduleSnapshot;
    return localScheduleRecord(snapshot, (cells: NativeScheduleCell[], day: number, week: number) => this.store.blocksInWeek(cells, day, week), undefined);
  }
  // "2026-11-11 10:20" on the device's clock.
  private qaMoment(value: string): number {
    return new Date(Number(value.substring(0, 4)), Number(value.substring(5, 7)) - 1, Number(value.substring(8, 10)),
      Number(value.substring(11, 13)), Number(value.substring(14, 16))).getTime();
  }
  private cardSample(record: LocalScheduleRecord, caption: string, formName: string, dimension: number, moment: string, flags: string): QaCardSample {
    const now = this.qaMoment(moment);
    const binding = scheduleWidgetBindingAt(record, dimension, formName, this.theme, this.qaCardOptions(flags), now);
    return { caption: caption, binding: binding, width: dimension === 2 ? 149 : 320, height: dimension === 4 ? 340 : 149, now: now };
  }
  // Week 10 of the fixture: Mon 11.09 … Sun 11.15, on the bundled bell times the cards fall back to. Wed has
  // 09:55–11:35 and 13:30–15:10, Fri 09:55–11:35 and 18:30–21:05, Sat four classes (the first over by ten, the
  // second on until 15:10), Mon 08:00–09:40 and 13:30–17:05, Sun none.
  private buildGallery(): void {
    const record = this.fixtureRecord();
    if (!record) return;
    const page = this.cardsPage || 'live';
    const upcoming = 'schedule_upcoming';
    const today = 'schedule_today';
    const twoDay = 'schedule_two_day';
    const samples: QaCardSample[] = [];
    const add = (caption: string, formName: string, dimension: number, moment: string, flags: string): void => {
      samples.push(this.cardSample(record, caption, formName, dimension, moment, flags));
    };
    if (page === 'live') {
      add('临近课程 2×2 · 上课中', upcoming, 2, '2026-11-11 11:12', '');
      add('临近课程 2×2 · 上课前 25 分钟', upcoming, 2, '2026-11-13 18:05', '');
      add('临近课程 2×4 · 上课中，还有一个多小时', upcoming, 3, '2026-11-11 10:20', '');
      add('临近课程 2×4 · 上课前 25 分钟', upcoming, 3, '2026-11-13 18:05', '');
      add('今日课表 2×4 · 上课中', today, 3, '2026-11-11 10:20', '');
      add('临近课程 2×4 · 关掉倒计时与进度', upcoming, 3, '2026-11-11 10:20', 'noProgress');
    } else if (page === 'sizes') {
      add('临近课程 2×2 · 小', upcoming, 2, '2026-11-11 10:20', 'small');
      add('临近课程 2×2 · 大', upcoming, 2, '2026-11-11 10:20', 'large');
      add('只剩一节 · 标准', upcoming, 2, '2026-11-13 18:05', '');
      add('只剩一节 · 自适应', upcoming, 2, '2026-11-13 18:05', 'auto');
      add('临近课程 2×4 · 大 · 上课前 25 分钟', upcoming, 3, '2026-11-13 18:05', 'large');
      add('今日课表 2×4 · 小', today, 3, '2026-11-11 10:20', 'small');
      add('今日课表 2×4 · 大', today, 3, '2026-11-11 10:20', 'large');
    } else if (page === 'today') {
      add('今日课表 4×4 · 周六四门课 · 标准', today, 4, '2026-11-14 10:20', '');
      add('今日课表 4×4 · 周六四门课 · 大', today, 4, '2026-11-14 10:20', 'large');
    } else if (page === 'preview') {
      add('今日课表 4×4 · 自适应 · 周三两门课，预告周四', today, 4, '2026-11-11 10:20', 'auto');
      add('今日课表 4×4 · 大 · 隐藏已上完的课，预告只剩一行', today, 4, '2026-11-14 10:20', 'hideCompleted,large');
    } else if (page === 'preview2') {
      add('今日课表 4×4 · 周五傍晚，预告周六', today, 4, '2026-11-13 18:05', '');
      add('今日课表 4×4 · 隐藏已上完的课、不显示周次', today, 4, '2026-11-09 14:00', 'hideCompleted,noWeek');
    } else if (page === 'twoDay') {
      add('两日课表 4×4 · 周三上课中 · 标准', twoDay, 4, '2026-11-11 10:20', '');
      add('两日课表 4×4 · 周六 · 大', twoDay, 4, '2026-11-14 10:20', 'large');
    } else if (page === 'twoDay2') {
      add('两日课表 4×4 · 今天的课都上完并隐藏', twoDay, 4, '2026-11-09 17:30', 'hideCompleted');
      add('两日课表 4×4 · 小 · 关掉倒计时与进度', twoDay, 4, '2026-11-14 10:20', 'small,noProgress');
    } else if (page === 'options') {
      add('不显示周次、农历、节假日', today, 3, '2026-11-11 10:20', 'noWeek,noLunar,noHoliday');
      add('不常驻最近节假日', today, 3, '2026-11-11 10:20', 'noResident');
      add('不显示教室和老师', today, 3, '2026-11-11 10:20', 'noRoom,noTeacher');
      add('不显示课程名称和上课时间', upcoming, 3, '2026-11-11 10:20', 'noName,noTime');
    } else {
      add('明天的课（周日）', upcoming, 2, '2026-11-15 10:00', '');
      add('明天的课 · 大', upcoming, 2, '2026-11-15 10:00', 'large');
      add('今日课表 2×4 · 明天的课', today, 3, '2026-11-15 10:00', '');
      add('寒假 · 休息状态', upcoming, 3, '2027-01-26 10:00', '');
      add('寒假 · 休息状态 · 自适应', today, 3, '2027-01-26 10:00', 'auto');
    }
    this.gallery = samples;
  }
  private buildSettingsSample(): void {
    const record = this.fixtureRecord();
    if (!record) return;
    const now = this.qaMoment('2026-11-11 10:20');
    this.gallery = [{ caption: '', binding: scheduleWidgetBindingAt(record, 3, 'schedule_today', this.theme, this.cardOptions, now),
      width: 320, height: 149, now: now }];
  }
  // The cards on the desktop read what the app writes down: the fixture timetable, the display options
  // of \`--ps cardOptions\` and the sample 日程.
  private seedDesktopCards(): void {
    const context = AppStorage.get<common.UIAbilityContext>('abilityContext');
    if (!context) return;
    this.store.attachSnapshotListener((snapshot?: NativeScheduleSnapshot) => {
      void saveLocalScheduleSnapshot(context, snapshot, (cells: NativeScheduleCell[], day: number, week: number) => {
        return this.store.blocksInWeek(cells, day, week);
      }).catch(() => undefined);
    });
    if (!this.cardOptionFlags) return;
    void saveScheduleWidgetDisplayOptions(context, this.qaCardOptions(this.cardOptionFlags)).then(async () => {
      const prefs = await preferences.getPreferences(context, 'native_agenda');
      await prefs.put('items', JSON.stringify(this.agendaItems));
      await prefs.flush();
      await refreshAllScheduleForms(context);
    }).catch(() => undefined);
  }
  @Builder
  private galleryCard(sample: QaCardSample) {
    Column({ space: 4 }) {
      if (sample.caption) {
        Text(sample.caption).fontSize(11).fontColor('#FFFFFF').maxLines(1).width(sample.width)
      }
      Column() {
        ScheduleCardView({ state: sample.binding.state, title: sample.binding.title, subtitle: sample.binding.subtitle,
          leftTitle: sample.binding.leftTitle, rightTitle: sample.binding.rightTitle,
          primaryCourses: sample.binding.primaryCourses, secondaryCourses: sample.binding.secondaryCourses,
          footer: sample.binding.footer, theme: sample.binding.theme, accent: sample.binding.accent,
          semester: sample.binding.semester, currentWeek: sample.binding.currentWeek,
          primaryWeek: sample.binding.primaryWeek, secondaryWeek: sample.binding.secondaryWeek,
          primaryRemaining: sample.binding.primaryRemaining, secondaryRemaining: sample.binding.secondaryRemaining,
          dimension: sample.binding.dimension, variant: sample.binding.variant, layout: sample.binding.layout,
          mode: sample.binding.mode, dayNote: sample.binding.dayNote, badge: sample.binding.badge,
          restTitle: sample.binding.restTitle, restDetail: sample.binding.restDetail, lockLine: sample.binding.lockLine,
          leadLabel: sample.binding.leadLabel, trailLabel: sample.binding.trailLabel, rightNote: sample.binding.rightNote,
          lunar: sample.binding.lunar, badgeStatutory: sample.binding.badgeStatutory, rightLunar: sample.binding.rightLunar,
          rightBadge: sample.binding.rightBadge, rightBadgeStatutory: sample.binding.rightBadgeStatutory,
          cardStyle: this.qaCardStyle, textSize: sample.binding.textSize, showProgress: sample.binding.showProgress,
          showWeek: sample.binding.showWeek, hideCompleted: sample.binding.hideCompleted, countdown: sample.binding.countdown,
          primaryEmpty: sample.binding.primaryEmpty, previewLabel: sample.binding.previewLabel,
          previewDetail: sample.binding.previewDetail, previewCourses: sample.binding.previewCourses,
          previewCount: sample.binding.previewCount, previewSummary: sample.binding.previewSummary, pinnedNow: sample.now })
      }.width(sample.width).height(sample.height)
    }
  }
  private cycleTheme(): void {
    const index = SCHEDULE_PALETTES.findIndex((item) => item.key === this.store.palette);
    this.store.palette = SCHEDULE_PALETTES[(index + 1) % SCHEDULE_PALETTES.length].key;
  }
  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      NativeSchedulePage({ store: this.store, couple: this.couple, onCouple: () => this.couple.open(),
        onOverlay: () => this.overlayPicker = true, onCommonFree: () => this.commonFree = true, onShare: () => this.shareDay(),
        onDorm: () => this.dorm.open(),
        bottomClearance: nativeNavigationClearance(px2vp(this.bottomInset)),
        pinnedNow: scheduleClockMinutes(this.now),
        onStyle: () => this.cycleStyle(), onAppearance: () => this.toggleAppearance(), onWidgets: () => this.cycleTheme(),
        onEdit: (block: NativeCourseBlock) => this.openEditor(block), onTools: () => this.openEditor(),
        onAddSlot: (day: number, slot: number) => this.openEditor(undefined, day, slot),
        onSharing: () => this.sharing.open(), onAgenda: () => this.agendaEditor.openList(), debugAction: this.panel })
        .padding({ top: this.topPadding() })
      NativeTabBar({ selected: 2, dark: this.store.dark })
        .margin({ left: 12, right: 12, bottom: nativeNavigationBottomInset(px2vp(this.bottomInset)) })
      if (this.cardsShown) {
        Scroll() {
          Column({ space: 12 }) {
            ForEach(['classic', 'table', 'paper', 'board', 'photo'], (style: string) => {
              Column() {
                ScheduleCardView({ state: 'ready', title: '课表', leftTitle: '今天 周三', primaryCourses: this.cardRows, dimension: 3,
                  variant: 'desktop', layout: 'today', mode: 'today', cardStyle: style === 'photo' ? 'paper' : style,
                  cardPhoto: style === 'photo' ? this.store.backgroundPath : '', veil: 0.55 })
              }.width('100%').aspectRatio(364 / 170)
            }, (style: string) => style)
          }.width('100%').padding({ left: 16, right: 16, top: 60, bottom: 120 })
        }.width('100%').height('100%').backgroundColor('#8090A0').onClick(() => this.cardsShown = false)
      }
      if (this.gallery.length > 0 && !this.cardSettingsShown) {
        Scroll() {
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Center, space: { main: LengthMetrics.vp(12), cross: LengthMetrics.vp(10) } }) {
            ForEach(this.gallery, (sample: QaCardSample) => {
              this.galleryCard(sample)
            }, (sample: QaCardSample) => sample.caption + sample.now)
          }.width('100%').padding({ left: 12, right: 12, top: this.topPadding() + 8, bottom: 24 })
        }.width('100%').height('100%').backgroundColor(this.store.dark ? '#28323C' : '#8090A0').scrollBar(BarState.Off)
      }
      if (this.cardSettingsShown) {
        Scroll() {
          Column({ space: 20 }) {
            ForEach(this.gallery, (sample: QaCardSample) => {
              this.galleryCard(sample)
            }, (sample: QaCardSample) => JSON.stringify(sample.binding))
            ScheduleCardSettings({ options: this.cardOptions, onChange: (options: ScheduleWidgetDisplayOptions) => {
              this.cardOptions = options;
              this.buildSettingsSample();
            } })
          }.width('100%').padding({ left: 20, right: 20, top: this.topPadding() + 8, bottom: 40 })
        }.width('100%').height('100%').backgroundColor($r('app.color.app_surface')).scrollBar(BarState.Off)
      }
      if (this.cardShown) {
        Scroll() { Column() { this.shareCardBuilder() }.scale({ x: 0.66, y: 0.66 }) }.width('100%').height('100%')
          .backgroundColor('#333333').onClick(() => this.cardShown = false)
      }
      if (this.cropOpen) {
        NativeBackgroundCrop({ path: this.store.backgroundPath, crop: this.store.backgroundCrop, aspect: 0.48,
          onDone: (crop: string) => { this.store.backgroundCrop = crop; this.cropOpen = false; },
          onCancel: () => this.cropOpen = false })
      }
      if (this.sharedVisible) {
        Column() {
          NativeSchedulePage({ store: this.sharedStore, couple: this.noCouple, bottomClearance: nativeNavigationBottomInset(px2vp(this.bottomInset)) + 8,
            pinnedNow: scheduleClockMinutes(this.now), onClose: () => { this.sharedVisible = false; this.sharing.visible = true; } })
        }.width('100%').height('100%').padding({ top: this.topPadding() }).backgroundColor(scheduleSurface(this.store.dark))
      }
    }.width('100%').height('100%').backgroundColor(scheduleSurface(this.store.dark))
      .bindSheet(this.editor.visible || this.sharing.visible || this.couple.sheetVisible || this.agendaEditor.visible || this.overlayPicker || this.commonFree || this.dorm.visible, this.panelSheet(),
        { height: SheetSize.LARGE, showClose: true, dragBar: true,
        onDisappear: () => { this.editor.cancel(); this.sharing.close(); this.couple.close(); this.agendaEditor.close(); this.overlayPicker = false; this.commonFree = false; this.dorm.close(); } })
  }
}
`);
const abilityPath = resolve(source, 'entry/src/main/ets/entryability/EntryAbility.ets');
let ability = readFileSync(abilityPath, 'utf8');
ability = ability.replace(/windowStage\.loadContent\('pages\/Index'\)/g, "windowStage.loadContent('pages/ScheduleAcceptance')");
ability = ability.replace('const routedUrl =', `AppStorage.setOrCreate('qaTheme', String(want.parameters?.theme ?? 'color-glass'));
    AppStorage.setOrCreate('qaDark', String(want.parameters?.dark ?? 'false') === 'true');
    AppStorage.setOrCreate('qaMode', String(want.parameters?.mode ?? 'week'));
    AppStorage.setOrCreate('qaState', String(want.parameters?.state ?? 'loaded'));
    AppStorage.setOrCreate('qaStyle', String(want.parameters?.style ?? 'classic'));
    AppStorage.setOrCreate('qaWeekend', String(want.parameters?.weekend ?? 'true') !== 'false');
    AppStorage.setOrCreate('qaDisplay', String(want.parameters?.display ?? ''));
    AppStorage.setOrCreate('qaNow', String(want.parameters?.now ?? ''));
    AppStorage.setOrCreate('qaPriority', String(want.parameters?.priority ?? ''));
    AppStorage.setOrCreate('qaWeek', String(want.parameters?.week ?? ''));
    AppStorage.setOrCreate('qaDay', String(want.parameters?.day ?? ''));
    AppStorage.setOrCreate('qaPanel', String(want.parameters?.panel ?? ''));
    AppStorage.setOrCreate('qaCouple', String(want.parameters?.couple ?? ''));
    AppStorage.setOrCreate('qaCoupleColors', String(want.parameters?.coupleColors ?? ''));
    AppStorage.setOrCreate('qaData', String(want.parameters?.data ?? ''));
    AppStorage.setOrCreate('qaClean', String(want.parameters?.clean ?? 'false') === 'true');
    AppStorage.setOrCreate('qaOccurrences', String(want.parameters?.occurrences ?? ''));
    AppStorage.setOrCreate('qaOverlay', String(want.parameters?.overlay ?? ''));
    AppStorage.setOrCreate('qaBackground', String(want.parameters?.background ?? ''));
    AppStorage.setOrCreate('qaCrop', String(want.parameters?.crop ?? ''));
    AppStorage.setOrCreate('qaHoliday', String(want.parameters?.holiday ?? ''));
    AppStorage.setOrCreate('qaDorm', String(want.parameters?.dorm ?? ''));
    AppStorage.setOrCreate('qaCards', String(want.parameters?.cards ?? ''));
    AppStorage.setOrCreate('qaCardStyle', String(want.parameters?.cardStyle ?? 'classic'));
    AppStorage.setOrCreate('qaCardOptions', String(want.parameters?.cardOptions ?? ''));
    const routedUrl =`);
put('entry/src/main/ets/entryability/EntryAbility.ets', ability);
// A photo for the background checks.
copyFileSync(resolve(source, '../web/src/views/services/campus3d/cover.jpg'), resolve(target, 'entry/src/main/resources/rawfile/qa-background.jpg'));
put('entry/src/main/resources/base/profile/main_pages.json', JSON.stringify({ src: ['pages/Index', 'pages/ScheduleAcceptance'] }, null, 2));
const appPath = resolve(source, 'AppScope/app.json5');
put('AppScope/app.json5', readFileSync(appPath, 'utf8').replace('"cn.lizmt.cpuweb"', '"cn.lizmt.cpuweb.scheduleqa"'));
const shortcutsPath = 'entry/src/main/resources/base/profile/shortcuts_config.json';
put(shortcutsPath, readFileSync(resolve(source, shortcutsPath), 'utf8').replaceAll('"cn.lizmt.cpuweb"', '"cn.lizmt.cpuweb.scheduleqa"'));
console.log(`Offline acceptance harness prepared in ${target}; bundle: cn.lizmt.cpuweb.scheduleqa`);
