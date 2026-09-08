import { NativeCourseBlock, NativeScheduleSemester, NativeScheduleStore, NativeScheduleWeek } from './NativeScheduleStore';
import { NativeScheduleBody } from './NativeScheduleBody';
import { scheduleCardTone } from './ScheduleVisuals';

const DAYS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SLOTS: number[] = [1,2,3,4,5,6,7,8,9,10,11];
const SLOT_STARTS: string[] = ['08:00', '08:55', '09:55', '10:50', '13:30', '14:25', '15:25', '16:20', '18:30', '19:25', '20:20'];
const SLOT_ENDS: string[] = ['08:45', '09:40', '10:40', '11:35', '14:15', '15:10', '16:10', '17:05', '19:15', '20:10', '21:05'];

@Component
export struct NativeSchedulePage {
  @ObjectLink store: NativeScheduleStore;
  @Prop bottomSafeInset: number = 0;
  onLogin: () => void = () => undefined;
  onWidgets: () => void = () => undefined;
  onTools: () => void = () => undefined;
  onEdit: (block: NativeCourseBlock) => void = () => undefined;
  onAddSlot: (day: number, slot: number) => void = () => undefined;
  onStyle: () => void = () => undefined;
  onAppearance: () => void = () => undefined;
  onShare: () => void = () => undefined;
  onExport: () => void = () => undefined;
  @State private contentHeight: number = 540;
  @State private pageWidth: number = 360;
  @State private pageHeight: number = 700;
  @State private pullRefreshing: boolean = false;
  @State private detailName: string = '';
  @State private detailTeacher: string = '';
  @State private detailLocation: string = '';
  @State private detailWeeks: string = '';
  @State private detailSlotNote: string = '';
  @State private detailDay: number = 1;
  @State private detailStartSlot: number = 1;
  @State private detailEndSlot: number = 2;
  private detailBlock?: NativeCourseBlock;
  @State private overlappingBlocks: NativeCourseBlock[] = [];
  private weekController: SwiperController = new SwiperController();

  build() {
    Stack() {
      Column().width('100%').height('100%')
        .backgroundColor(this.store.dark ? '#000000' : '#F3F3F9')
      if (this.store.backgroundPath) {
        Image(this.store.backgroundPath).width('100%').height('100%').objectFit(ImageFit.Cover).opacity(this.store.backgroundOpacity)
      }
      Column() {
        if (this.store.weekOptions().length) {
          this.scheduleToolbar()
          this.weekSwitcher()
        }
        if (this.store.errorMessage) this.messageBanner(this.store.errorMessage, this.surfaceColor(), this.textColor())
        Refresh({ refreshing: this.pullRefreshing && this.store.status === 'loading' }) {
          if (this.store.weekOptions().length) {
            Swiper(this.weekController) {
              ForEach(this.store.weekOptions(), (week: NativeScheduleWeek, index: number) => {
                Column() {
                  if (Math.abs(index - this.store.selectedWeekIndex()) <= 1) {
                    NativeScheduleBody({ store: this.store, view: this.store.previewWeek(week.value),
                      contentHeight: this.contentHeight, pageWidth: this.pageWidth,
                      onLogin: this.onLogin, onAddSlot: this.onAddSlot,
                      onCourse: (block: NativeCourseBlock) => this.openCourseAt(block) })
                  }
                }.width('100%').height('100%')
              }, (week: NativeScheduleWeek) => this.store.selectedSemester + ':' + week.value)
            }.width('100%').height('100%').index(this.store.selectedWeekIndex())
              .loop(false).indicator(false).duration(260).curve(Curve.EaseOut)
              .onChange((index: number) => {
                const week = this.store.weekOptions()[index];
                if (week) this.store.selectWeek(week.value);
              })
          } else {
            NativeScheduleBody({ store: this.store, view: this.store,
              contentHeight: this.contentHeight, pageWidth: this.pageWidth,
              onLogin: this.onLogin, onAddSlot: this.onAddSlot,
              onCourse: (block: NativeCourseBlock) => this.openCourseAt(block) })
          }
        }.layoutWeight(1).width('100%').margin({ bottom: 54 + this.bottomSafeInset })
          .onRefreshing(() => { this.pullRefreshing = true; this.store.load(true); })
          .onStateChange((state: RefreshStatus) => {
            if (state === RefreshStatus.Inactive || state === RefreshStatus.Done) this.pullRefreshing = false;
          })
          .onAreaChange((_old: Area, next: Area) => this.contentHeight = Number(next.height))
      }.width('100%').height('100%').padding({ left: 12, right: 12, top: 12 })
    }.width('100%').height('100%')
      .onAreaChange((_old: Area, next: Area) => { this.pageWidth = Number(next.width); this.pageHeight = Number(next.height); })
      .bindSheet(this.store.detailVisible || this.store.weekPickerVisible, this.scheduleSheet(), {
        height: SheetSize.FIT_CONTENT, showClose: true, dragBar: true,
        onDisappear: () => { this.store.detailVisible = false; this.store.weekPickerVisible = false; this.overlappingBlocks = []; }
      })
  }

  @Builder
  private scheduleToolbar() {
    Row({ space: 6 }) {
      Select(this.semesterSelectOptions())
        .selected(this.store.selectedSemesterIndex()).value(this.store.selectedSemester)
        .font({ size: 16, weight: FontWeight.Bold }).fontColor(this.store.dark ? '#8DADFF' : '#3668D3')
        .backgroundColor(this.surfaceColor()).borderRadius(22).layoutWeight(1).height(42).padding({ left: 12, right: 6 })
        .accessibilityText('选择学期')
        .onSelect((index: number) => { const option = this.store.semesterOptions()[index]; if (option) this.store.selectSemester(option.value); })
      Row({ space: 2 }) {
        this.modeButton('周', 'week')
        this.modeButton('日', 'day')
      }.width(78).height(40).padding(3).backgroundColor(this.softSurfaceColor()).borderRadius(22)
      Button() { SymbolGlyph($r('sys.symbol.scope')).fontSize(23).fontColor([this.store.dark ? '#8DADFF' : '#3668D3']) }
        .type(ButtonType.Normal).width(40).height(40).padding(0).backgroundColor(this.surfaceColor()).borderRadius(22)
        .responseRegion({ x: -2, y: -2, width: 44, height: 44 })
        .accessibilityText('回到本周今日')
        .onClick(() => { this.store.returnToCurrentWeek(); this.store.selectDay(new Date().getDay() || 7); })
      Button() {
        if (this.store.status === 'loading') {
          LoadingProgress().width(19).height(19).color(this.store.dark ? '#8DADFF' : '#3668D3')
        } else {
          Row({ space: 3 }) {
            ForEach([1,2,3], () => { Circle().width(3).height(3).fill(this.textColor()) })
          }
        }
      }.type(ButtonType.Normal).width(32).height(40).padding(0).backgroundColor(Color.Transparent).borderRadius(20)
        .responseRegion({ x: -4, y: -2, width: 40, height: 44 })
        .accessibilityText('更多课表操作')
        .bindMenu([
          { value: '刷新课表', enabled: this.store.status !== 'loading', action: () => this.store.load(true) },
          { value: '课表配色与背景', action: () => this.onStyle() },
          { value: '添加与恢复课程', enabled: this.store.source !== 'graduate', action: () => this.onTools() },
          { value: '桌面与锁屏服务卡片', action: () => this.onWidgets() },
          { value: '分享所选周课表', action: () => this.onShare() },
          { value: '导出所选周日历', action: () => this.onExport() },
          { value: '应用外观', action: () => this.onAppearance() }
        ])
    }.width('100%').height(46).margin({ bottom: 12 })
  }

  @Builder
  private modeButton(label: string, mode: string) {
    Button(label).type(ButtonType.Normal).layoutWeight(1).height(34).padding(0).fontSize(14)
      .fontWeight(this.store.viewMode === mode ? FontWeight.Bold : FontWeight.Medium)
      .fontColor(this.store.viewMode === mode ? this.textColor() : this.secondaryColor())
      .backgroundColor(this.store.viewMode === mode ? this.surfaceColor() : Color.Transparent).borderRadius(19)
      .responseRegion({ x: 0, y: -7, width: '100%', height: 44 })
      .accessibilityText(label + '视图').accessibilitySelected(this.store.viewMode === mode)
      .onClick(() => this.store.setViewMode(mode))
  }

  @Builder
  private weekSwitcher() {
    Row({ space: 8 }) {
      Button() {
        SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(23).fontWeight(FontWeight.Bold).fontColor([this.textColor()])
      }.type(ButtonType.Normal).width(44).height(48).padding(0).backgroundColor(Color.Transparent).borderRadius(22)
        .enabled(this.store.canMoveWeek(-1)).accessibilityText('上一周').onClick(() => this.weekController.showPrevious())
      Button() {
        Column({ space: 4 }) {
          Text(this.weekLabel()).fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.textColor())
          Text(this.weekRange()).fontSize(12).fontColor(this.secondaryColor()).maxLines(1)
        }.width('100%').alignItems(HorizontalAlign.Center)
      }.type(ButtonType.Normal).layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent).borderRadius(18)
        .accessibilityText('选择周次，' + this.weekLabel() + '，' + this.weekRange())
        .onClick(() => this.store.weekPickerVisible = true)
      Button() {
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(23).fontWeight(FontWeight.Bold).fontColor([this.textColor()])
      }.type(ButtonType.Normal).width(44).height(48).padding(0).backgroundColor(Color.Transparent).borderRadius(22)
        .enabled(this.store.canMoveWeek(1)).accessibilityText('下一周').onClick(() => this.weekController.showNext())
    }.width('100%').height(48).margin({ bottom: 12 })
  }

  @Builder
  private scheduleSheet() {
    Scroll() {
    if (this.store.weekPickerVisible) {
      Column({ space: 16 }) {
        Text('选择周次').width('100%').fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.textColor())
        Grid() {
          ForEach(this.store.weekOptions(), (week: NativeScheduleWeek) => {
            GridItem() {
              Button(week.value).height(44).width('100%').type(ButtonType.Normal).borderRadius(10)
                .fontColor(week.value === this.store.selectedWeek ? $r('app.color.app_on_accent') : this.textColor())
                .backgroundColor(week.value === this.store.selectedWeek ? $r('app.color.app_accent') : this.softSurfaceColor())
                .accessibilityText('第' + week.value + '周').onClick(() => { this.store.weekPickerVisible = false; this.store.selectWeek(week.value); })
            }
          })
        }.columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr').columnsGap(6).rowsGap(6)
          .height(Math.min(350, Math.ceil(this.store.weekOptions().length / 6) * 50)).scrollBar(BarState.Off)
        Button('回到本周').height(44).fontColor($r('app.color.app_on_accent')).backgroundColor($r('app.color.app_accent'))
          .onClick(() => { this.store.weekPickerVisible = false; this.store.returnToCurrentWeek(); })
      }.width('100%').padding({ left: 18, right: 18, top: 28, bottom: 24 }).backgroundColor(this.surfaceColor())
    } else if (this.overlappingBlocks.length) {
      Column({ space: 12 }) {
        Text('同一时段的课程').fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.textColor()).width('100%')
        ForEach(this.overlappingBlocks, (block: NativeCourseBlock) => {
          Button(block.course.name + ' · ' + (block.course.location || '地点待定')).width('100%').height(48)
            .fontColor(this.toneText(block.course.name)).backgroundColor(this.softSurfaceColor())
            .onClick(() => { this.overlappingBlocks = []; this.openDetail(block); })
        })
      }.width('100%').padding({ left: 18, right: 18, top: 28, bottom: 24 }).backgroundColor(this.surfaceColor())
    } else this.courseDetail()
    }.width('100%').constraintSize({ maxHeight: Math.max(260, this.pageHeight - 60) })
      .scrollBar(BarState.Off).backgroundColor(this.surfaceColor())
  }

  private openCourseAt(block: NativeCourseBlock): void {
    const matches = this.store.blocksForDay(block.day).filter((item: NativeCourseBlock) => item.startSlot <= block.endSlot && item.endSlot >= block.startSlot);
    if (matches.length <= 1) { this.openDetail(block); return; }
    this.overlappingBlocks = matches;
    this.store.detailVisible = true;
  }
  private textColor(): string { return this.store.dark ? '#F5F5F7' : '#151518'; }
  private secondaryColor(): string { return this.store.dark ? '#A6A6B0' : '#72727D'; }
  private surfaceColor(): string { return this.store.dark ? '#303139' : '#FFFFFF'; }
  private softSurfaceColor(): string { return this.store.dark ? '#25252B' : '#E7E7ED'; }
  private cellColor(): string { return this.store.dark ? '#202023' : '#FFFFFF'; }
  private toneBorder(name: string): string { return scheduleCardTone(name, this.store.palette, this.store.dark).border; }
  private toneText(name: string): string { return scheduleCardTone(name, this.store.palette, this.store.dark).text; }
  private toneAccent(name: string): string { return this.toneText(name); }
  private toneFill(name: string): string { return scheduleCardTone(name, this.store.palette, this.store.dark).top; }
  @Builder
  private messageBanner(message: string, background: string, foreground: string) {
    Row({ space: 8 }) {
      Text('i')
        .width(20)
        .height(20)
        .fontSize(12)
        .fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF')
        .textAlign(TextAlign.Center)
        .backgroundColor(foreground)
        .borderRadius(10)
      Text(message)
        .fontSize(12)
        .fontColor(foreground)
        .layoutWeight(1)
        .maxLines(3)
    }
    .width('100%')
    .padding(11)
    .backgroundColor(background)
    .borderRadius(12)
  }

  @Builder
  private courseDetail() {
    Column() {
      Column({ space: 14 }) {
        Row() {
          Text('课程详情')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
            .layoutWeight(1)
        }
        .width('100%')

        Text(this.detailName)
          .width('100%')
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())

        this.detailRow('星期', DAYS[this.detailDay - 1])
        this.detailRow('节次', this.detailSlotNote || `第 ${this.detailStartSlot}-${this.detailEndSlot} 节`)
        this.detailRow('时间', this.timeRange(this.detailStartSlot, this.detailEndSlot))
        this.detailRow('周次', this.detailWeeks)
        if (this.detailTeacher) this.detailRow('教师', this.detailTeacher)
        if (this.detailLocation) this.detailRow('地点', this.detailLocation)
        if (this.store.source !== 'graduate') {
          Button('编辑个人课程').height(44).width('100%').fontSize(14)
            .fontColor($r('app.color.app_accent')).backgroundColor($r('app.color.app_accent_surface'))
            .onClick(() => { if (this.detailBlock) this.onEdit(this.detailBlock); })
        }
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 20, bottom: 28 })
      .backgroundColor(this.surfaceColor())
      .borderRadius({ topLeft: 24, topRight: 24 })
    }
    .width('100%')
    .backgroundColor(this.surfaceColor())
  }

  @Builder
  private detailRow(label: string, value: string) {
    Row() {
      Text(label)
        .width(58)
        .fontSize(13)
        .fontColor(this.secondaryColor())
      Text(value || '—')
        .fontSize(13)
        .fontColor(this.textColor())
        .layoutWeight(1)
    }
    .width('100%')
  }

  private openDetail(block: NativeCourseBlock): void {
    this.detailBlock = block;
    this.detailName = block.course.name || '课程';
    this.detailTeacher = block.course.teacher ?? '';
    this.detailLocation = block.course.location ?? '';
    this.detailWeeks = block.course.weeks ?? '';
    this.detailSlotNote = block.course.slotNote ?? '';
    this.detailDay = block.day;
    this.detailStartSlot = block.startSlot;
    this.detailEndSlot = block.endSlot;
    this.store.detailVisible = true;
  }

  private semesterSelectOptions(): SelectOption[] {
    const options: SelectOption[] = [];
    this.store.semesterOptions().forEach((item: NativeScheduleSemester) => options.push({ value: item.label }));
    return options;
  }

  private weekSelectOptions(): SelectOption[] {
    const options: SelectOption[] = [];
    this.store.weekOptions().forEach((item: NativeScheduleWeek) => options.push({ value: item.label }));
    return options;
  }

  private weekLabel(): string {
    const week = this.store.weekOptions()[this.store.selectedWeekIndex()];
    const value = week?.value || this.store.selectedWeek;
    return value ? `第${value}周` : '选择周次';
  }

  private weekRange(): string {
    const start = this.store.dayDate(1);
    const end = this.store.dayDate(7);
    return start && end ? `${start.replace('-', '.')} - ${end.replace('-', '.')}` : '校历暂无日期';
  }

  private courseCount(): number {
    return (this.store.viewMode === 'day' ? this.store.visibleCells().filter(cell => cell.day === this.store.selectedDay) : this.store.visibleCells()).reduce((sum: number, cell) => sum + cell.courses.length, 0);
  }

  private timeRange(startSlot: number, endSlot: number): string {
    const start = SLOT_STARTS[Math.max(0, startSlot - 1)] ?? '';
    const end = SLOT_ENDS[Math.max(0, endSlot - 1)] ?? '';
    return start && end ? `${start}-${end}` : '';
  }

}
