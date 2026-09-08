import { NativeCourseBlock, NativeScheduleCell, NativeScheduleStore } from './NativeScheduleStore';

export interface CourseEditorForm {
  name: string;
  day: number;
  startSlot: number;
  endSlot: number;
  teacher: string;
  location: string;
  note: string;
  weekList: number[];
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
interface HiddenCourse { key: string; label: string; }
interface EditorReply { session?: string; hidden?: HiddenCourse[]; saved?: boolean; error?: string; }

@Observed
export class NativeCourseEditorModel {
  visible: boolean = false;
  busy: boolean = false;
  error: string = '';
  session: string = '';
  name: string = '';
  day: number = 1;
  startSlot: number = 1;
  endSlot: number = 2;
  location: string = '';
  teacher: string = '';
  note: string = '';
  weeks: number[] = [];
  options: number[] = [];
  hidden: HiddenCourse[] = [];
  original?: NativeCourseBlock;
  semester: string = '';
  cells: NativeScheduleCell[] = [];
  private requestId: string = '';
  private requestSequence: number = 0;
  private timer: number = -1;
  private requester?: (id: string, request: CourseEditorRequest) => void;
  private saved?: () => void;

  attach(requester: (id: string, request: CourseEditorRequest) => void, saved: () => void): void {
    this.requester = requester;
    this.saved = saved;
  }
  open(store: NativeScheduleStore, block?: NativeCourseBlock): void {
    this.cancel();
    this.original = block;
    this.semester = store.selectedSemester;
    this.cells = store.result?.cells ?? [];
    this.name = block?.course.name ?? '';
    this.day = block?.day ?? store.selectedDay;
    this.startSlot = block?.startSlot ?? 1;
    this.endSlot = block?.endSlot ?? 2;
    this.location = block?.course.location ?? '';
    this.teacher = block?.course.teacher ?? '';
    this.note = block?.course.slotNote ?? '';
    this.options = store.weekOptions().map(item => Number(item.value)).filter(value => value >= 1 && value <= 64);
    this.weeks = block ? (block.course.weekList.length ? [...block.course.weekList] : [...this.options]) : [Number(store.selectedWeek)];
    this.session = '';
    this.hidden = [];
    this.visible = true;
    this.submit('open');
  }
  submit(action: string, key: string = ''): void {
    if (this.busy || !this.requester) return;
    if (action === 'save' && (!this.name.trim() || !this.weeks.length || this.endSlot < this.startSlot)) {
      this.error = '请填写课程名称，选择周次并检查节次范围';
      return;
    }
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
      form: { name: this.name, day: this.day, startSlot: this.startSlot, endSlot: this.endSlot,
        location: this.location, teacher: this.teacher, note: this.note, weekList: this.weeks }
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
      if (reply.saved) { this.visible = false; this.saved?.(); return; }
      this.session = reply.session ?? '';
      this.hidden = reply.hidden ?? [];
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
    this.session = '';
    this.name = '';
    this.location = '';
    this.teacher = '';
    this.note = '';
  }
  toggleWeek(week: number): void {
    this.weeks = this.weeks.includes(week) ? this.weeks.filter(value => value !== week) : [...this.weeks, week].sort((a,b) => a-b);
  }
}

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
        Text(this.model.error).fontSize(14).fontColor($r('app.color.app_text_primary')).width('100%')
      }
      if (this.model.busy && !this.model.session) {
        LoadingProgress().width(36).height(36)
        Text('正在读取个人课程修改').fontSize(14).fontColor($r('app.color.app_text_secondary'))
      }
      Scroll() {
        Column({ space: 12 }) {
          TextInput({ text: this.model.name, placeholder: '课程名称（必填）' }).height(48).maxLength(120)
            .accessibilityText('课程名称').onChange(value => this.model.name = value)
          Row({ space: 8 }) {
            Select([{value:'周一'},{value:'周二'},{value:'周三'},{value:'周四'},{value:'周五'},{value:'周六'},{value:'周日'}])
              .selected(this.model.day - 1).value(['周一','周二','周三','周四','周五','周六','周日'][this.model.day - 1])
              .layoutWeight(1).height(44).accessibilityText('上课星期').onSelect(index => this.model.day = index + 1)
            Select(this.slotOptions()).selected(this.model.startSlot - 1).value(`第${this.model.startSlot}节`)
              .layoutWeight(1).height(44).accessibilityText('开始节次').onSelect(index => this.model.startSlot = index + 1)
            Select(this.slotOptions()).selected(this.model.endSlot - 1).value(`第${this.model.endSlot}节`)
              .layoutWeight(1).height(44).accessibilityText('结束节次').onSelect(index => this.model.endSlot = index + 1)
          }.width('100%')
          TextInput({text:this.model.location,placeholder:'上课地点'}).height(48).maxLength(200)
            .accessibilityText('上课地点').onChange(value => this.model.location = value)
          TextInput({text:this.model.teacher,placeholder:'授课教师'}).height(48).maxLength(120)
            .accessibilityText('授课教师').onChange(value => this.model.teacher = value)
          TextInput({text:this.model.note,placeholder:'备注（选填）'}).height(48).maxLength(200)
            .accessibilityText('课程备注').onChange(value => this.model.note = value)
          Row() {
            Text('教学周').fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
            Text(`已选 ${this.model.weeks.length} 周`).fontSize(12).fontColor($r('app.color.app_text_secondary'))
          }.width('100%')
          Row({ space: 8 }) {
            Button('全部').height(44).layoutWeight(1).fontSize(14).backgroundColor($r('app.color.app_control')).fontColor($r('app.color.app_accent')).onClick(() => this.model.weeks = [...this.model.options])
            Button('单周').height(44).layoutWeight(1).fontSize(14).backgroundColor($r('app.color.app_control')).fontColor($r('app.color.app_accent')).onClick(() => this.model.weeks = this.model.options.filter(value => value % 2 === 1))
            Button('双周').height(44).layoutWeight(1).fontSize(14).backgroundColor($r('app.color.app_control')).fontColor($r('app.color.app_accent')).onClick(() => this.model.weeks = this.model.options.filter(value => value % 2 === 0))
          }.width('100%')
          Grid() {
            ForEach(this.model.options, (week: number) => {
              GridItem() {
                Button(String(week)).height(44).width('100%').type(ButtonType.Normal).borderRadius(10)
                  .fontColor(this.model.weeks.includes(week) ? $r('app.color.app_on_accent') : $r('app.color.app_text_primary'))
                  .backgroundColor(this.model.weeks.includes(week) ? $r('app.color.app_accent') : $r('app.color.app_control'))
                  .accessibilityText(`第${week}周，${this.model.weeks.includes(week) ? '已选' : '未选'}`)
                  .onClick(() => this.model.toggleWeek(week))
              }
            })
          }.columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr').columnsGap(6).rowsGap(6)
            .height(Math.ceil(this.model.options.length / 6) * 50)
          if (this.model.original) {
            Button(this.model.original.course.customId ? '删除个人课程' : '隐藏这门课程')
              .height(44).width('100%').fontColor('#B42318').backgroundColor('#FEECEB')
              .enabled(!this.model.busy).onClick(() => this.confirmDelete())
            if (this.model.original.course.sourceKey) {
              Button('恢复教务原始安排').height(44).width('100%').enabled(!this.model.busy)
                .fontColor($r('app.color.app_accent')).backgroundColor($r('app.color.app_control'))
                .onClick(() => this.model.submit('restore'))
            }
          } else if (this.model.hidden.length) {
            Text('已隐藏课程').fontSize(16).fontColor($r('app.color.app_text_primary')).width('100%')
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
  private slotOptions(): SelectOption[] {
    return [1,2,3,4,5,6,7,8,9,10,11].map((slot: number): SelectOption => ({value:`第${slot}节`}));
  }
  private confirmDelete(): void {
    AlertDialog.show({ title: this.model.original?.course.customId ? '删除个人课程' : '隐藏课程',
      message: '这只修改你的个人课表，不会改变学校教务记录。',
      primaryButton: {value:'取消',action:() => undefined},
      secondaryButton: {value:'确认',action:() => this.model.submit('delete')}
    });
  }
}
