// Install a deterministic, offline UI harness in an isolated copy of harmony/.
// Never use a signed/release package or a real user account for visual acceptance.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
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
  [2, 1, 4, '药物化学', '教学楼B202'],
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
    cells: courses.map(([day, startSlot, endSlot, name, location], index) => ({
      day, bigSlot: Math.ceil(startSlot / 2), courses: [{
        nativeId: `fixture-${index}`, name, location, teacher: '示例教师', weeks: '1-20周',
        weekList: weeks.map(({ value }) => Number(value)), startSlot, endSlot,
        slotNote: `${startSlot}-${endSlot}节`,
      }],
    })),
  },
  // Week 6 carries one day off and one make-up day (Saturday takes Thursday's classes).
  calendar: { periods, currentWeek: 5, semesterStart: '2026-09-07', semesterEnd: '2027-01-24', weeks: calendarWeeks,
    adjustments: [{ date: calendarWeeks[5].days[0], kind: 'off', note: '校运动会' },
      { date: calendarWeeks[5].days[5], kind: 'swap', source: calendarWeeks[5].days[3] }] },
};
// What the stand-in share server hands back for any code: the same timetable under another name.
const shareDocument = { code: 'ABCD2345', owner: '阿青', semester, courseCount: courses.length,
  createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-06T12:30:00.000Z',
  schedule: { cells: snapshot.data.cells }, calendar: snapshot.calendar };
put('entry/src/main/ets/pages/ScheduleAcceptance.ets', `
import { NativeSchedulePage } from '../schedule/NativeSchedulePage';
import { NativeCourseBlock, NativeScheduleStore, NativeScheduleRequest } from '../schedule/NativeScheduleStore';
import { CourseEditorRequest, NativeCourseEditor, NativeCourseEditorModel } from '../schedule/NativeCourseEditor';
import { NativeScheduleSharing, NativeScheduleSharingModel, ShareApiData, ShareApiReply, ShareApiRequest } from '../schedule/NativeScheduleSharing';
import { SharedSchedule, SharePublishBody, sharedScheduleSnapshot, sharePublishBody } from '../schedule/ScheduleSharing';
import { normalizeScheduleStyle, scheduleClockMinutes, SCHEDULE_STYLES } from '../schedule/ScheduleStyle';
import { NativeTabBar } from '../common/NativeTabBar';
import { nativeNavigationBottomInset, nativeNavigationClearance } from '../common/NativeNavigationLayout';
import { SCHEDULE_PALETTES } from '../schedule/SchedulePalettes';
import { scheduleSurface } from '../schedule/ScheduleLayout';
import common from '@ohos.app.ability.common';
import ConfigurationConstant from '@ohos.app.ability.ConfigurationConstant';
import window from '@ohos.window';

interface QaEditorReply { session?: string; hidden?: string[]; priority?: Record<string, number>; saved?: boolean; }

@Entry
@Component
struct ScheduleAcceptance {
  @State private store: NativeScheduleStore = new NativeScheduleStore();
  @State private editor: NativeCourseEditorModel = new NativeCourseEditorModel();
  @State private sharing: NativeScheduleSharingModel = new NativeScheduleSharingModel();
  @State private sharedStore: NativeScheduleStore = new NativeScheduleStore();
  @State private sharedVisible: boolean = false;
  @StorageProp('qaStyle') @Watch('syncOptions') private style: string = 'classic';
  @StorageProp('qaWeekend') @Watch('syncOptions') private weekend: boolean = true;
  @StorageProp('qaNow') @Watch('syncOptions') private now: string = '';
  @StorageProp('qaPriority') @Watch('syncOptions') private priority: string = '';
  @StorageProp('qaWeek') @Watch('syncOptions') private week: string = '';
  @StorageProp('qaDay') @Watch('syncOptions') private day: string = '';
  @StorageProp('qaPanel') @Watch('syncOptions') private panel: string = '';
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
    this.store.showWeekend = this.weekend;
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
    void window.getLastWindow(context).then(main => main.setWindowSystemBarProperties({
      statusBarColor: '#00000000', statusBarContentColor: this.store.dark ? '#FFFFFF' : '#202722',
      navigationBarColor: '#00000000', navigationBarContentColor: this.store.dark ? '#FFFFFF' : '#172033'
    })).catch(() => undefined);
  }
  private toggleAppearance(): void {
    this.store.dark = !this.store.dark;
    this.applySystemAppearance();
  }
  aboutToAppear(): void {
    this.store.attach((request: NativeScheduleRequest) => {
      this.store.acceptResult(request.id, ${JSON.stringify(JSON.stringify(snapshot))});
    }, () => undefined);
    this.store.markBridgeReady();
    this.editor.attach((id: string, request: CourseEditorRequest) => {
      const opened: QaEditorReply = { session: 'offline-acceptance', hidden: [], priority: this.store.displayPriorities() };
      const saved: QaEditorReply = { saved: true };
      setTimeout(() => this.editor.accept(id, JSON.stringify(request.action === 'open' ? opened : saved)), 60);
    }, () => undefined);
    this.sharing.attach((request: ShareApiRequest) => this.shareApi(request), () => undefined);
    this.syncOptions();
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
    const mine: ShareApiData = { code: 'WXYZ6789', owner: '我', semester: '${semester}', courseCount: ${courses.length},
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
    if (this.editor.visible) {
      NativeCourseEditor({ model: this.editor })
    } else {
      NativeScheduleSharing({ model: this.sharing, semester: '${semester}', semesterLabel: '2026–27 秋', canPublish: true,
        publishBody: (): SharePublishBody => sharePublishBody(this.store.completeSnapshot(), this.store.periods),
        onOpen: (schedule: SharedSchedule) => this.openShared(schedule) })
    }
  }
  private cycleTheme(): void {
    const index = SCHEDULE_PALETTES.findIndex((item) => item.key === this.store.palette);
    this.store.palette = SCHEDULE_PALETTES[(index + 1) % SCHEDULE_PALETTES.length].key;
  }
  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      NativeSchedulePage({ store: this.store, bottomClearance: nativeNavigationClearance(px2vp(this.bottomInset)),
        pinnedNow: scheduleClockMinutes(this.now),
        onStyle: () => this.cycleStyle(), onAppearance: () => this.toggleAppearance(), onWidgets: () => this.cycleTheme(),
        onEdit: (block: NativeCourseBlock) => this.openEditor(block), onTools: () => this.openEditor(),
        onAddSlot: (day: number, slot: number) => this.openEditor(undefined, day, slot),
        onSharing: () => this.sharing.open() })
        .padding({ top: px2vp(this.topInset) })
      NativeTabBar({ selected: 2, dark: this.store.dark })
        .margin({ left: 12, right: 12, bottom: nativeNavigationBottomInset(px2vp(this.bottomInset)) })
      if (this.sharedVisible) {
        Column() {
          NativeSchedulePage({ store: this.sharedStore, bottomClearance: nativeNavigationBottomInset(px2vp(this.bottomInset)) + 8,
            pinnedNow: scheduleClockMinutes(this.now), onClose: () => { this.sharedVisible = false; this.sharing.visible = true; } })
        }.width('100%').height('100%').padding({ top: px2vp(this.topInset) }).backgroundColor(scheduleSurface(this.store.dark))
      }
    }.width('100%').height('100%').backgroundColor(scheduleSurface(this.store.dark))
      .bindSheet(this.editor.visible || this.sharing.visible, this.panelSheet(), { height: SheetSize.LARGE, showClose: true, dragBar: true,
        onDisappear: () => { this.editor.cancel(); this.sharing.close(); } })
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
    AppStorage.setOrCreate('qaNow', String(want.parameters?.now ?? ''));
    AppStorage.setOrCreate('qaPriority', String(want.parameters?.priority ?? ''));
    AppStorage.setOrCreate('qaWeek', String(want.parameters?.week ?? ''));
    AppStorage.setOrCreate('qaDay', String(want.parameters?.day ?? ''));
    AppStorage.setOrCreate('qaPanel', String(want.parameters?.panel ?? ''));
    const routedUrl =`);
put('entry/src/main/ets/entryability/EntryAbility.ets', ability);
put('entry/src/main/resources/base/profile/main_pages.json', JSON.stringify({ src: ['pages/Index', 'pages/ScheduleAcceptance'] }, null, 2));
const appPath = resolve(source, 'AppScope/app.json5');
put('AppScope/app.json5', readFileSync(appPath, 'utf8').replace('"cn.lizmt.cpuweb"', '"cn.lizmt.cpuweb.scheduleqa"'));
console.log(`Offline acceptance harness prepared in ${target}; bundle: cn.lizmt.cpuweb.scheduleqa`);
