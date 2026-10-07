import { NativeCourseBlock, NativeScheduleCell, NativeScheduleCourse, NativeScheduleStore } from './NativeScheduleStore';

// One "when it meets" group of a course as it is sent to the Web bridge: a weekday, any set of
// periods and the weeks it runs. The saved edit payload shared with Web, Android and iOS describes
// one contiguous block per item, so the bridge writes one item per run of consecutive periods.
export interface CourseArrangementForm {
  day: number;
  slots: number[];
  weekList: number[];
}
export interface CourseEditorForm {
  name: string;
  // The first run of the first arrangement, for bridges that read a single block.
  day: number;
  startSlot: number;
  endSlot: number;
  teacher: string;
  location: string;
  note: string;
  weekList: number[];
  arrangements: CourseArrangementForm[];
  // Show this course in front of the ones it overlaps.
  preferred: boolean;
}
export interface CourseEditorRequest {
  action: string;
  semester: string;
  session: string;
  original?: NativeCourseBlock;
  cells: NativeScheduleCell[];
  form: CourseEditorForm;
  key: string;
}
// The editor's draft of one arrangement. Drafts are replaced, never mutated, so the sheet redraws.
export interface CourseArrangementDraft {
  id: number;
  day: number;
  slots: number[];
  // current | all | custom
  weekMode: string;
  weeks: number[];
}
interface HiddenCourse { key: string; label: string; }
interface EditorReply {
  session?: string;
  hidden?: HiddenCourse[];
  saved?: boolean;
  error?: string;
  priority?: Record<string, number>;
}

/** The runs of consecutive periods, in order: [1, 2, 5, 6, 9] → [1, 2], [5, 6], [9, 9]. */
export function courseSlotRuns(slots: number[]): number[][] {
  const runs: number[][] = [];
  const sorted = slots.filter((slot: number, index: number) => slots.indexOf(slot) === index).sort((a: number, b: number) => a - b);
  sorted.forEach((slot: number) => {
    const last = runs.length ? runs[runs.length - 1] : undefined;
    if (last && last[1] + 1 === slot) last[1] = slot; else runs.push([slot, slot]);
  });
  return runs;
}

function sameCourse(course: NativeScheduleCourse, day: number, original?: NativeCourseBlock): boolean {
  if (!original) return false;
  const own = original.course;
  if (own.customId || course.customId) return !!own.customId && own.customId === course.customId;
  if (own.sourceKey && own.sourceKey === course.sourceKey) return true;
  if (own.nativeId && own.nativeId === course.nativeId) return true;
  // The rows 教务 repeats for one course merge into the block being edited.
  return own.name === course.name && day === original.day;
}

/**
 * Names of the courses an arrangement would sit on top of: same weekday, intersecting periods and
 * at least one week in common. Courses that only alternate weeks in the same periods do not count,
 * and the course being edited does not collide with itself. A course without a week list meets every week.
 */
export function courseArrangementConflicts(day: number, slots: number[], weekList: number[], cells: NativeScheduleCell[],
  original?: NativeCourseBlock): string[] {
  const names: string[] = [];
  if (!slots.length) return names;
  cells.filter((cell: NativeScheduleCell) => cell.day === day).forEach((cell: NativeScheduleCell) => {
    cell.courses.forEach((course: NativeScheduleCourse) => {
      if (sameCourse(course, cell.day, original)) return;
      const start = Number(course.startSlot) || cell.bigSlot * 2 - 1;
      const end = Math.max(start, Number(course.endSlot) || cell.bigSlot * 2);
      if (!slots.some((slot: number) => slot >= start && slot <= end)) return;
      const weeks = course.weekList ?? [];
      if (weekList.length && weeks.length && !weekList.some((week: number) => weeks.includes(week))) return;
      if (!names.includes(course.name)) names.push(course.name);
    });
  });
  return names;
}

@Observed
export class NativeCourseEditorModel {
  visible: boolean = false;
  busy: boolean = false;
  error: string = '';
  session: string = '';
  name: string = '';
  location: string = '';
  teacher: string = '';
  note: string = '';
  // The first is the block being edited; more can be added, and each may pick periods that are not consecutive.
  arrangements: CourseArrangementDraft[] = [];
  preferred: boolean = false;
  defaultWeek: number = 1;
  options: number[] = [];
  hidden: HiddenCourse[] = [];
  original?: NativeCourseBlock;
  semester: string = '';
  cells: NativeScheduleCell[] = [];
  slots: number[] = [];
  slotStarts: string[] = [];
  slotEnds: string[] = [];
  private requestId: string = '';
  private requestSequence: number = 0;
  private draftSequence: number = 0;
  private timer: number = -1;
  private requester?: (id: string, request: CourseEditorRequest) => void;
  private saved?: () => void;
  private priorities?: (semester: string, priority: Record<string, number>) => void;

  attach(requester: (id: string, request: CourseEditorRequest) => void, saved: () => void,
    priorities?: (semester: string, priority: Record<string, number>) => void): void {
    this.requester = requester;
    this.saved = saved;
    this.priorities = priorities;
  }
  // `day` and `slot` place a new course on the empty period that was tapped.
  open(store: NativeScheduleStore, block?: NativeCourseBlock, day?: number, slot?: number): void {
    this.cancel();
    this.original = block;
    this.semester = store.selectedSemester;
    this.cells = store.result?.cells ?? [];
    this.slots = store.slots();
    this.slotStarts = this.slots.map((value: number) => store.slotStart(value));
    this.slotEnds = this.slots.map((value: number) => store.slotEnd(value));
    this.name = block?.course.name ?? '';
    this.location = block?.course.location ?? '';
    this.teacher = block?.course.teacher ?? '';
    this.note = store.courseNote(block?.course);
    this.options = store.weekOptions().map(item => Number(item.value)).filter(value => value >= 1 && value <= 64);
    this.defaultWeek = Number(store.selectedWeek) || this.options[0] || 1;
    const lastSlot = this.slots.length ? this.slots[this.slots.length - 1] : 12;
    const start = Math.max(1, Math.min(lastSlot, block?.startSlot ?? slot ?? 1));
    const end = Math.max(start, Math.min(lastSlot, block?.endSlot ?? start + 1));
    const slots: number[] = [];
    for (let value = start; value <= end; value += 1) slots.push(value);
    const list = block ? block.course.weekList ?? [] : [this.defaultWeek];
    const everyWeek = list.length === 0 || (this.options.length > 0 && this.options.every(week => list.includes(week)));
    this.arrangements = [{ id: ++this.draftSequence, day: block?.day ?? day ?? store.selectedDay, slots,
      weekMode: everyWeek ? 'all' : list.length === 1 && list[0] === this.defaultWeek ? 'current' : 'custom',
      weeks: everyWeek ? [...this.options] : [...list].sort((a, b) => a - b) }];
    this.preferred = !!block && (store.displayPriorities()[this.priorityKey(block.course.name)] ?? 0) > 0;
    this.session = '';
    this.hidden = [];
    this.visible = true;
    this.submit('open');
  }
  submit(action: string, key: string = ''): void {
    if (this.busy || !this.requester) return;
    const resolved: CourseArrangementForm[] = [];
    if (action === 'save') {
      if (!this.name.trim()) { this.error = '请填写课程名称'; return; }
      for (let index = 0; index < this.arrangements.length; index += 1) {
        const draft = this.arrangements[index];
        const title = this.arrangements.length > 1 ? `上课时间 ${index + 1}：` : '';
        if (!draft.slots.length) { this.error = `${title}请选择至少一节`; return; }
        const weekList = this.weekList(draft);
        if (!weekList.length) { this.error = `${title}请选择至少一个周次`; return; }
        resolved.push({ day: draft.day, slots: [...draft.slots].sort((a, b) => a - b), weekList });
      }
    } else {
      this.arrangements.forEach((draft: CourseArrangementDraft) => {
        resolved.push({ day: draft.day, slots: [...draft.slots].sort((a, b) => a - b), weekList: this.weekList(draft) });
      });
    }
    const first: CourseArrangementForm = resolved.length ? resolved[0] : { day: 1, slots: [1], weekList: [] };
    const run = courseSlotRuns(first.slots)[0] ?? [1, 1];
    this.busy = true;
    this.error = '';
    this.requestId = `editor-${Date.now()}-${++this.requestSequence}`;
    this.timer = setTimeout(() => {
      this.requestId = '';
      this.busy = false;
      this.error = '请求超时，请关闭后重新打开课程，确认保存结果';
    }, 60000);
    this.requester(this.requestId, { action, semester: this.semester, session: this.session,
      original: this.original, cells: this.cells, key,
      form: { name: this.name, day: first.day, startSlot: run[0], endSlot: run[1],
        location: this.location, teacher: this.teacher, note: this.note, weekList: first.weekList,
        arrangements: resolved, preferred: this.preferred }
    });
  }
  accept(id: string, raw: string): void {
    if (!id || id !== this.requestId) return;
    clearTimeout(this.timer);
    this.requestId = '';
    this.busy = false;
    try {
      const reply = JSON.parse(raw) as EditorReply;
      if (reply.error) { this.error = reply.error; return; }
      if (reply.priority) this.priorities?.(this.semester, reply.priority);
      if (reply.saved) { this.visible = false; this.saved?.(); return; }
      this.session = reply.session ?? '';
      this.hidden = reply.hidden ?? [];
      if (reply.priority && this.original) {
        this.preferred = (reply.priority[this.priorityKey(this.original.course.name)] ?? 0) > 0;
      }
    } catch (_) { this.error = '课程修改结果无法读取，请重新打开确认'; }
  }
  cancel(): void {
    clearTimeout(this.timer);
    this.requestId = '';
    this.visible = false;
    this.busy = false;
    this.original = undefined;
    this.cells = [];
    this.hidden = [];
    this.arrangements = [];
    this.preferred = false;
    this.session = '';
    this.name = '';
    this.location = '';
    this.teacher = '';
    this.note = '';
  }

  // The weeks an arrangement is saved with.
  weekList(draft: CourseArrangementDraft): number[] {
    if (draft.weekMode === 'current') return [this.defaultWeek];
    if (draft.weekMode === 'all') return this.options.length ? [...this.options] : [this.defaultWeek];
    return [...draft.weeks].sort((a, b) => a - b);
  }
  addArrangement(): void {
    const last = this.arrangements.length ? this.arrangements[this.arrangements.length - 1] : undefined;
    this.arrangements = [...this.arrangements, { id: ++this.draftSequence, day: last?.day ?? 1, slots: [],
      weekMode: last?.weekMode ?? 'all', weeks: last ? [...last.weeks] : [this.defaultWeek] }];
  }
  removeArrangement(id: number): void {
    if (this.arrangements.length > 1) this.arrangements = this.arrangements.filter(item => item.id !== id);
  }
  setDay(id: number, day: number): void {
    this.replace(id, (draft: CourseArrangementDraft): CourseArrangementDraft =>
      ({ id: draft.id, day, slots: draft.slots, weekMode: draft.weekMode, weeks: draft.weeks }));
  }
  toggleSlot(id: number, slot: number): void {
    this.replace(id, (draft: CourseArrangementDraft): CourseArrangementDraft => ({ id: draft.id, day: draft.day,
      slots: draft.slots.includes(slot) ? draft.slots.filter(value => value !== slot) : [...draft.slots, slot].sort((a, b) => a - b),
      weekMode: draft.weekMode, weeks: draft.weeks }));
  }
  setWeekMode(id: number, mode: string): void {
    this.replace(id, (draft: CourseArrangementDraft): CourseArrangementDraft => ({ id: draft.id, day: draft.day, slots: draft.slots,
      weekMode: mode, weeks: mode === 'all' ? [...this.options] : mode === 'current' ? [this.defaultWeek] : draft.weeks }));
  }
  setWeeks(id: number, weeks: number[]): void {
    this.replace(id, (draft: CourseArrangementDraft): CourseArrangementDraft =>
      ({ id: draft.id, day: draft.day, slots: draft.slots, weekMode: draft.weekMode, weeks: [...weeks].sort((a, b) => a - b) }));
  }
  toggleWeek(id: number, week: number): void {
    const draft = this.arrangements.find(item => item.id === id);
    if (draft) this.setWeeks(id, draft.weeks.includes(week) ? draft.weeks.filter(value => value !== week) : [...draft.weeks, week]);
  }
  conflicts(draft: CourseArrangementDraft): string[] {
    return courseArrangementConflicts(draft.day, draft.slots, draft.weekMode === 'all' ? [] : this.weekList(draft), this.cells, this.original);
  }
  // Every other course some arrangement of this one sits on top of. A priority is per course
  // name, so it cannot rank a course against itself.
  overlappingNames(): string[] {
    const names: string[] = [];
    const own = this.name.trim();
    this.arrangements.forEach((draft: CourseArrangementDraft) => {
      this.conflicts(draft).forEach((name: string) => { if (name !== own && !names.includes(name)) names.push(name); });
    });
    return names;
  }
  // "第 1–2、5 节 · 08:00–09:40、13:30–14:15"
  slotSummary(slots: number[]): string {
    const runs = courseSlotRuns(slots);
    if (!runs.length) return '轻点选择上课的节次，可以不连续';
    const numbers = runs.map(run => run[0] === run[1] ? `${run[0]}` : `${run[0]}–${run[1]}`);
    const times: string[] = [];
    runs.forEach((run: number[]) => {
      const start = this.slotStarts[this.slots.indexOf(run[0])] ?? '';
      const end = this.slotEnds[this.slots.indexOf(run[1])] ?? '';
      if (start && end) times.push(`${start}–${end}`);
    });
    return `第 ${numbers.join('、')} 节` + (times.length ? ` · ${times.join('、')}` : '');
  }
  private replace(id: number, change: (draft: CourseArrangementDraft) => CourseArrangementDraft): void {
    this.arrangements = this.arrangements.map(item => item.id === id ? change(item) : item);
  }
  private priorityKey(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }
}

const EDITOR_DAYS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const WEEK_MODES: string[] = ['current', 'all', 'custom'];
const WEEK_MODE_LABELS: string[] = ['本周', '全部周', '指定周次'];

@Component
export struct NativeCourseEditor {
  @ObjectLink model: NativeCourseEditorModel;
  build() {
    Column({ space: 12 }) {
      Row() {
        Text(this.model.original ? '编辑课程' : '添加课程').fontSize(22).fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.app_text_primary')).layoutWeight(1)
      }.width('100%').height(44).padding({ right: 42 })
      if (this.model.error) {
        Text(this.model.error).fontSize(14).fontColor('#B42318').width('100%')
      }
      if (this.model.busy && !this.model.session) {
        LoadingProgress().width(36).height(36)
        Text('正在读取个人课程修改').fontSize(14).fontColor($r('app.color.app_text_secondary'))
      }
      Scroll() {
        Column({ space: 12 }) {
          if (this.model.original && (this.model.original.course.custom || this.model.original.course.orphaned)) {
            this.statusCard()
          }
          this.sectionTitle('课程信息')
          Column() {
            this.fieldRow('课程', this.model.name, '课程名称（必填）', 120, (value: string) => this.model.name = value)
            this.fieldRow('老师', this.model.teacher, '选填', 120, (value: string) => this.model.teacher = value)
            this.fieldRow('地点', this.model.location, '选填', 200, (value: string) => this.model.location = value)
            this.fieldRow('备注', this.model.note, '选填', 200, (value: string) => this.model.note = value)
          }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
          Row({ space: 12 }) {
            Text('时间段').fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_secondary')).layoutWeight(1)
            if (this.model.original?.course.customId && this.model.original?.course.sourceKey) {
              Text('使用教务安排').fontSize(13).fontWeight(600).fontColor($r('app.color.app_accent'))
                .padding({ top: 8, bottom: 8 }).onClick(() => { if (!this.model.busy) this.model.submit('restore'); })
            }
            if (this.model.original) {
              Text(this.model.original.course.customId ? '删除' : '隐藏').fontSize(13).fontWeight(600).fontColor('#B42318')
                .padding({ top: 8, bottom: 8 }).onClick(() => { if (!this.model.busy) this.confirmDelete(); })
            }
          }.width('100%').padding({ left: 4, right: 4 })
          ForEach(this.model.arrangements, (draft: CourseArrangementDraft, index: number) => {
            this.arrangementCard(draft, index)
          }, (draft: CourseArrangementDraft, index: number) => index + ':' + JSON.stringify(draft) + ':' + this.model.arrangements.length)
          Button('＋ 添加上课时间').type(ButtonType.Normal).height(48).width('100%').borderRadius(16).fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.app_accent')).backgroundColor($r('app.color.app_control'))
            .onClick(() => this.model.addArrangement())
          if (this.model.overlappingNames().length || this.model.preferred) {
            Row({ space: 12 }) {
              Column({ space: 3 }) {
                Text('优先显示这门课').fontSize(16).fontColor($r('app.color.app_text_primary')).width('100%')
                Text(this.model.overlappingNames().length
                  ? `和${this.model.overlappingNames().map((name: string) => '「' + name + '」').join('')}重叠的节次只显示这门课，其他课程仍保留在课表里。`
                  : '和别的课重叠时，重叠的节次只显示这门课。')
                  .fontSize(12).fontColor($r('app.color.app_text_secondary')).width('100%')
              }.layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.model.preferred }).selectedColor($r('app.color.app_accent'))
                .accessibilityText('优先显示这门课').onChange((value: boolean) => this.model.preferred = value)
            }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
          }
          if (!this.model.original && this.model.hidden.length) {
            this.sectionTitle('已隐藏课程')
            ForEach(this.model.hidden, (item: HiddenCourse) => {
              Button(`恢复 · ${item.label}`).height(44).width('100%').enabled(!this.model.busy)
                .fontColor($r('app.color.app_accent')).backgroundColor($r('app.color.app_control'))
                .onClick(() => this.model.submit('restoreHidden', item.key))
            })
          }
        }.width('100%').padding({ bottom: 12 }).enabled(!this.model.busy)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
      Button(this.model.busy ? '处理中' : '保存课程').height(48).width('100%').fontSize(16)
        .backgroundColor($r('app.color.app_accent')).fontColor($r('app.color.app_on_accent'))
        .enabled(!this.model.busy && this.model.session.length > 0)
        .onClick(() => this.model.submit('save'))
    }.width('100%').height('100%').padding({ left: 16, right: 16, top: 24, bottom: 28 })
      .backgroundColor($r('app.color.app_surface'))
  }

  @Builder
  private sectionTitle(title: string) {
    Text(title).fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_secondary')).width('100%').padding({ left: 4, right: 4 })
  }

  @Builder
  private fieldRow(title: string, value: string, placeholder: string, limit: number, change: (value: string) => void) {
    Row({ space: 12 }) {
      Text(title).fontSize(16).fontColor($r('app.color.app_text_primary')).width(40)
      TextInput({ text: value, placeholder }).height(48).maxLength(limit).layoutWeight(1).textAlign(TextAlign.End)
        .backgroundColor(Color.Transparent).padding({ left: 0, right: 0 })
        .accessibilityText(title === '课程' ? '课程名称' : title === '老师' ? '授课教师' : title === '地点' ? '上课地点' : '课程备注')
        .onChange((text: string) => change(text))
    }.width('100%').padding({ left: 14, right: 14 })
      .border({ width: { bottom: title === '备注' ? 0 : 0.5 }, color: $r('app.color.app_divider') })
  }

  @Builder
  private statusCard() {
    Column({ space: 6 }) {
      Text(this.model.original?.course.orphaned ? '这门课的安排需要核对'
        : this.model.original?.course.sourceKey ? '已编辑课程' : '自定义课程')
        .fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_primary')).width('100%')
      Text(this.model.original?.course.orphaned
        ? '当前教务课表与保存编辑时的信息未能对应，可能是时间、周次、老师或地点变化，不表示课程已取消。这里仍保留着你的编辑。'
        : this.model.original?.course.sourceKey ? '这是你编辑过的课程，可通过“使用教务安排”移除个人修改。'
        : '这是你添加或保留的自定义课程，不属于教务课表。')
        .fontSize(12).fontColor($r('app.color.app_text_secondary')).width('100%')
    }.width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.app_control'))
  }

  // One "when it meets" group: weeks, weekday and any set of periods.
  @Builder
  private arrangementCard(draft: CourseArrangementDraft, index: number) {
    Column({ space: 6 }) {
      if (this.model.arrangements.length > 1) {
        Row() {
          Text(`上课时间 ${index + 1}`).fontSize(12).fontWeight(600).fontColor($r('app.color.app_text_secondary')).layoutWeight(1)
          if (index > 0) {
            Text('移除').fontSize(12).fontWeight(600).fontColor('#B42318').padding({ top: 6, bottom: 6 })
              .onClick(() => this.model.removeArrangement(draft.id))
          }
        }.width('100%').padding({ left: 4, right: 4 })
      }
      Column() {
        Row({ space: 12 }) {
          Text('周数').fontSize(16).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
          Select(WEEK_MODE_LABELS.map((label: string): SelectOption => ({ value: label })))
            .selected(Math.max(0, WEEK_MODES.indexOf(draft.weekMode))).value(WEEK_MODE_LABELS[Math.max(0, WEEK_MODES.indexOf(draft.weekMode))])
            .height(40).accessibilityText('周次范围')
            .onSelect((selected: number) => this.model.setWeekMode(draft.id, WEEK_MODES[selected]))
        }.width('100%').height(48).padding({ left: 14, right: 8 })
        if (draft.weekMode === 'custom') {
          Column({ space: 8 }) {
            Row({ space: 14 }) {
              Text('指定周').fontSize(14).fontWeight(600).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
              // Shortcuts for the common patterns; the chips below still toggle one week at a time.
              Text('全部').fontSize(12).fontWeight(600).fontColor($r('app.color.app_accent')).padding({ top: 6, bottom: 6 })
                .onClick(() => this.model.setWeeks(draft.id, this.model.options))
              Text('单周').fontSize(12).fontWeight(600).fontColor($r('app.color.app_accent')).padding({ top: 6, bottom: 6 })
                .onClick(() => this.model.setWeeks(draft.id, this.model.options.filter((week: number) => week % 2 === 1)))
              Text('双周').fontSize(12).fontWeight(600).fontColor($r('app.color.app_accent')).padding({ top: 6, bottom: 6 })
                .onClick(() => this.model.setWeeks(draft.id, this.model.options.filter((week: number) => week % 2 === 0)))
              Text('清空').fontSize(12).fontWeight(600).fontColor($r('app.color.app_accent')).padding({ top: 6, bottom: 6 })
                .onClick(() => this.model.setWeeks(draft.id, []))
            }.width('100%')
            Grid() {
              ForEach(this.model.options, (week: number) => {
                GridItem() {
                  this.chip(String(week), draft.weeks.includes(week), `第 ${week} 周`, () => this.model.toggleWeek(draft.id, week))
                }
              }, (week: number) => week + ':' + (draft.weeks.includes(week) ? 1 : 0))
            }.columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr').columnsGap(6).rowsGap(6)
              .height(Math.ceil(this.model.options.length / 6) * 40 - 6)
          }.width('100%').padding({ left: 14, right: 14, top: 4, bottom: 10 })
        } else {
          Text(draft.weekMode === 'all' ? '这门课会显示在全部周次' : `第 ${this.model.defaultWeek} 周`).fontSize(12)
            .fontColor($r('app.color.app_text_secondary')).width('100%').padding({ left: 14, right: 14, bottom: 10 })
        }
        Row({ space: 12 }) {
          Text('星期').fontSize(16).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
          Select(EDITOR_DAYS.map((label: string): SelectOption => ({ value: label })))
            .selected(draft.day - 1).value(EDITOR_DAYS[draft.day - 1])
            .height(40).accessibilityText('上课星期')
            .onSelect((selected: number) => this.model.setDay(draft.id, selected + 1))
        }.width('100%').height(48).padding({ left: 14, right: 8 })
          .border({ width: { top: 0.5 }, color: $r('app.color.app_divider') })
        Column({ space: 8 }) {
          Text('节次').fontSize(16).fontColor($r('app.color.app_text_primary')).width('100%')
          Grid() {
            ForEach(this.model.slots, (slot: number) => {
              GridItem() {
                this.chip(String(slot), draft.slots.includes(slot), this.slotSpoken(slot), () => this.model.toggleSlot(draft.id, slot))
              }
            }, (slot: number) => slot + ':' + (draft.slots.includes(slot) ? 1 : 0))
          }.columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr').columnsGap(6).rowsGap(6)
            .height(Math.ceil(this.model.slots.length / 6) * 40 - 6)
          Text(this.model.slotSummary(draft.slots)).fontSize(12).fontColor($r('app.color.app_text_secondary')).width('100%')
        }.width('100%').padding({ left: 14, right: 14, top: 10, bottom: 12 })
          .border({ width: { top: 0.5 }, color: $r('app.color.app_divider') })
      }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
      if (this.model.conflicts(draft).length) {
        // A hint only: overlapping courses can still be saved.
        Text(`与「${this.model.conflicts(draft).join('」「')}」时间重叠`).fontSize(12).fontColor('#C2410C').width('100%').padding({ left: 4, right: 4 })
      }
    }.width('100%')
  }

  @Builder
  private chip(title: string, selected: boolean, spoken: string, action: () => void) {
    Button(title).type(ButtonType.Normal).height(34).width('100%').padding(0).borderRadius(9).fontSize(13).fontWeight(FontWeight.Medium)
      .fontColor(selected ? $r('app.color.app_accent') : $r('app.color.app_text_secondary'))
      .backgroundColor(selected ? $r('app.color.app_accent_surface') : $r('app.color.app_surface'))
      .border({ width: 1, color: selected ? $r('app.color.app_accent') : $r('app.color.app_divider'), radius: 9 })
      .accessibilityText(spoken + (selected ? '，已选' : '，未选')).accessibilitySelected(selected)
      .onClick(() => action())
  }

  private slotSpoken(slot: number): string {
    const index = this.model.slots.indexOf(slot);
    const start = this.model.slotStarts[index] ?? '';
    const end = this.model.slotEnds[index] ?? '';
    return `第 ${slot} 节` + (start && end ? `，${start} 至 ${end}` : '');
  }
  private confirmDelete(): void {
    AlertDialog.show({ title: this.model.original?.course.customId ? '删除个人课程' : '隐藏课程',
      message: '这只修改你的个人课表，不会改变学校教务记录。',
      primaryButton: {value:'取消',action:() => undefined},
      secondaryButton: {value:'确认',action:() => this.model.submit('delete')}
    });
  }
}
