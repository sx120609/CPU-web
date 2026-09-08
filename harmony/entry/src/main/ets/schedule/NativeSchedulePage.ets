import { NativeCourseBlock, NativeScheduleSemester, NativeScheduleStore, NativeScheduleWeek } from './NativeScheduleStore';
import { scheduleCourseTone, schedulePalette } from './ScheduleVisuals';

const DAYS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SLOTS: number[] = [1,2,3,4,5,6,7,8,9,10,11];
const SLOT_STARTS: string[] = ['08:00', '08:55', '09:55', '10:50', '13:30', '14:25', '15:25', '16:20', '18:30', '19:25', '20:20'];
const SLOT_ENDS: string[] = ['08:45', '09:40', '10:40', '11:35', '14:15', '15:10', '16:10', '17:05', '19:15', '20:10', '21:05'];

@Component
export struct NativeSchedulePage {
  @ObjectLink store: NativeScheduleStore;
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

  build() {
    Stack() {
      Column().width('100%').height('100%')
        .linearGradient({ angle: 180, colors: this.store.dark ? [['#122923', 0], ['#0d201a', 1]] : [['#eef4ff', 0], ['#f8fbff', 0.55], ['#f8fafc', 1]] })
      if (this.store.backgroundPath) {
        Image(this.store.backgroundPath).width('100%').height('100%').objectFit(ImageFit.Cover).opacity(this.store.backgroundOpacity)
      }
      Column() {
        if (this.store.result) {
          this.scheduleToolbar()
          this.weekSwitcher()
          if (this.store.viewMode === 'day') this.dayStrip()
        }
        if (this.store.errorMessage) this.messageBanner(this.store.errorMessage, this.surfaceColor(), this.textColor())
        if (this.store.status === 'loading' && this.store.result) {
          Row({ space: 8 }) {
            LoadingProgress().width(16).height(16).color(schedulePalette(this.store.palette).accent)
            Text('正在更新课表').fontSize(12).fontColor(this.secondaryColor())
          }.height(24).width('100%')
        }
        Refresh({ refreshing: this.store.status === 'loading' && this.store.result !== undefined }) {
          Scroll() {
            Column() {
              if (this.store.status === 'unauthorized') {
                this.stateCard('教务授权已失效', '请重新登录并完成教务授权后读取课表', '去登录', () => this.onLogin())
              } else if ((this.store.status === 'idle' || this.store.status === 'loading') && !this.store.result) {
                this.loadingCard()
              } else if (this.store.status === 'failed' && !this.store.result) {
                this.stateCard('课表暂时无法加载', this.store.errorMessage || '请检查网络连接后重试', '重新加载', () => this.store.load(true))
              } else if (this.store.result) {
                if (this.store.viewMode === 'week') this.weekSchedule()
                else if (this.store.blocksForDay(this.store.selectedDay).length) this.daySchedule()
                else this.stateCard('这一天没有课程', '可以切换日期，或添加个人课程', '添加课程', () => this.onTools())
              }
            }.width('100%').padding({ bottom: 12 })
          }.width('100%').height('100%').scrollBar(BarState.Off)
        }.layoutWeight(1).width('100%').margin({ bottom: 84 })
          .onRefreshing(() => this.store.load(true))
          .onAreaChange((_old: Area, next: Area) => this.contentHeight = Number(next.height))
          .parallelGesture(PanGesture({ direction: PanDirection.Horizontal, distance: 24 })
            .onActionEnd((event: GestureEvent) => { if (Math.abs(event.offsetX) >= 60) this.store.moveWeek(event.offsetX < 0 ? 1 : -1); }))
      }.width('100%').height('100%').padding({ left: 6, right: 6, top: 8 })
    }.width('100%').height('100%')
      .onAreaChange((_old: Area, next: Area) => this.pageWidth = Number(next.width))
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
        .font({ size: 13, weight: FontWeight.Regular }).fontColor(this.textColor()).backgroundColor(this.softSurfaceColor())
        .border({ width: 1, color: this.controlBorder() }).borderRadius(10)
        .layoutWeight(1).height(38).accessibilityText('选择学期')
        .onSelect((index: number) => { const option = this.store.semesterOptions()[index]; if (option) this.store.selectSemester(option.value); })
      Row({ space: 2 }) {
        this.modeButton('日', 'day')
        this.modeButton('周', 'week')
      }.width(66).height(36).padding(3).border({ width: 1, color: this.controlBorder() })
        .backgroundColor(this.softSurfaceColor()).borderRadius(10)
      Button() { SymbolGlyph($r('sys.symbol.scope')).fontSize(18).fontColor([this.textColor()]) }
        .type(ButtonType.Normal).width(36).height(36).padding(0).backgroundColor(this.softSurfaceColor())
        .border({ width: 1, color: this.controlBorder() }).borderRadius(10).accessibilityText('回到本周今日')
        .onClick(() => { this.store.returnToCurrentWeek(); this.store.selectDay(new Date().getDay() || 7); })
      Button() {
        Row({ space: 3 }) {
          Circle().width(3).height(3).fill(this.textColor())
          Circle().width(3).height(3).fill(this.textColor())
          Circle().width(3).height(3).fill(this.textColor())
        }.width('100%').justifyContent(FlexAlign.Center)
      }
        .type(ButtonType.Normal).width(36).height(36).padding(0).backgroundColor(this.softSurfaceColor())
        .border({ width: 1, color: this.controlBorder() }).borderRadius(10).accessibilityText('更多课表操作')
        .bindMenu([
          { value: '课表配色与背景', action: () => this.onStyle() },
          { value: '添加与恢复课程', action: () => this.onTools() },
          { value: '桌面与锁屏服务卡片', action: () => this.onWidgets() },
          { value: '分享所选周课表', action: () => this.onShare() },
          { value: '导出所选周日历', action: () => this.onExport() },
          { value: '应用外观', action: () => this.onAppearance() }
        ])
      Button() { SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(18).fontColor([this.textColor()]) }
        .type(ButtonType.Normal).width(36).height(36).padding(0).backgroundColor(this.softSurfaceColor())
        .border({ width: 1, color: this.controlBorder() }).borderRadius(10).accessibilityText('刷新课表')
        .enabled(this.store.status !== 'loading').onClick(() => this.store.load(true))
    }.width('100%').height(38).margin({ bottom: 14 })
  }

  @Builder
  private modeButton(label: string, mode: string) {
    Button() {
      Text(label).width('100%').height('100%').textAlign(TextAlign.Center).fontSize(12).fontWeight(FontWeight.Bold)
        .fontColor(this.store.viewMode === mode ? this.selectedTextColor() : this.secondaryColor())
        .backgroundColor(this.store.viewMode === mode ? this.selectedBackground() : Color.Transparent).borderRadius(6)
    }.type(ButtonType.Normal).layoutWeight(1).height('100%').padding(this.store.viewMode === mode ? 1 : 0)
      .linearGradient({ angle: 135, colors: this.store.viewMode === mode && this.store.palette === 'color-glass' ? this.rainbowRing() : [[Color.Transparent, 0], [Color.Transparent, 1]] })
      .backgroundColor(Color.Transparent).borderRadius(7)
      .accessibilityText(label + '视图').onClick(() => this.store.setViewMode(mode))
  }

  @Builder
  private weekSwitcher() {
    Row({ space: 6 }) {
      Button() {
        Row({ space: 4 }) {
          SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(12).fontColor([this.textColor()])
          Text('上一周').fontSize(12).fontColor(this.textColor())
        }
      }.type(ButtonType.Normal).width(82).height(42).padding(0).backgroundColor(this.surfaceColor())
        .border({ width: 1, color: this.controlBorder() }).borderRadius(13).enabled(this.store.canMoveWeek(-1))
        .accessibilityText('上一周').onClick(() => this.store.moveWeek(-1))
      Button() {
        Column({ space: 1 }) {
          Text(this.weekLabel()).fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.weekTitleColor())
          Text(this.weekRange()).fontSize(11).fontColor(this.weekTitleColor())
        }
      }.type(ButtonType.Normal).layoutWeight(1).height(42).borderRadius(13)
        .backgroundColor(this.store.palette === 'color-glass' ? Color.Transparent : schedulePalette(this.store.palette).accentPale)
        .linearGradient({ angle: 135, colors: this.weekGradient() })
        .border({ width: 1, color: this.store.palette === 'color-glass' ? (this.store.dark ? '#6bc4b5fd' : '#387669ff') : schedulePalette(this.store.palette).accentBorder }).borderRadius(13)
        .accessibilityText('选择周次，' + this.weekLabel()).onClick(() => this.store.weekPickerVisible = true)
      Button() {
        Row({ space: 4 }) {
          Text('下一周').fontSize(12).fontColor(this.textColor())
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(12).fontColor([this.textColor()])
        }
      }.type(ButtonType.Normal).width(82).height(42).padding(0).backgroundColor(this.surfaceColor())
        .border({ width: 1, color: this.controlBorder() }).borderRadius(13).enabled(this.store.canMoveWeek(1))
        .accessibilityText('下一周').onClick(() => this.store.moveWeek(1))
    }.width('100%').margin({ bottom: 12 })
  }

  @Builder
  private dayStrip() {
    Row({ space: 3 }) {
      ForEach([1,2,3,4,5,6,7], (day: number) => {
        Button() {
          Column({ space: 1 }) {
            Text(DAYS[day - 1]).fontSize(11).fontColor(day === this.store.selectedDay ? this.selectedTextColor() : this.secondaryColor())
            Text(this.dateLabel(day)).fontSize(11).fontWeight(FontWeight.Bold).fontColor(day === this.store.selectedDay ? this.selectedTextColor() : this.secondaryColor())
          }.width('100%').height('100%').justifyContent(FlexAlign.Center)
            .backgroundColor(day === this.store.selectedDay ? this.selectedBackground() : this.surfaceColor()).borderRadius(9)
        }.type(ButtonType.Normal).height(42).layoutWeight(1).padding(1)
          .linearGradient({ angle: 135, colors: day === this.store.selectedDay && this.store.palette === 'color-glass' ? this.rainbowRing() : [[Color.Transparent, 0], [Color.Transparent, 1]] })
          .backgroundColor(Color.Transparent).border({ width: day === this.store.selectedDay ? 0 : 1, color: this.controlBorder() }).borderRadius(10)
          .accessibilityText(DAYS[day - 1] + ' ' + this.dateLabel(day)).onClick(() => this.store.selectDay(day))
      })
    }.width('100%').margin({ bottom: 14 })
  }

  @Builder
  private weekSchedule() {
    Column({ space: 6 }) {
      Row({ space: 2 }) {
        Text('节次').fontSize(11).fontColor(this.secondaryColor()).width(34).height(34).textAlign(TextAlign.Center)
        ForEach([1,2,3,4,5,6,7], (day: number) => {
          Column({ space: 3 }) {
            Text(DAYS[day - 1].substring(1)).fontSize(11).fontWeight(FontWeight.Bold).fontColor(this.store.isToday(day) ? this.weekTitleColor() : this.secondaryColor())
            Text(this.dateLabel(day)).fontSize(9).fontWeight(FontWeight.Medium).fontColor(this.store.isToday(day) ? this.weekTitleColor() : this.secondaryColor())
          }.layoutWeight(1).height(34).justifyContent(FlexAlign.Center)
            .backgroundColor(this.store.isToday(day) ? Color.Transparent : this.cellColor(true))
            .linearGradient({ angle: 135, colors: this.store.isToday(day) ? this.weekGradient() : [[Color.Transparent, 0], [Color.Transparent, 1]] })
            .border({ width: 1, color: this.store.isToday(day) ? schedulePalette(this.store.palette).accentBorder : this.cellBorder() }).borderRadius(8)
            .accessibilityText(DAYS[day - 1] + '，查看当天课程')
            .onClick(() => { this.store.selectDay(day); this.store.setViewMode('day'); })
        })
      }.width('100%').padding({ top: 3, bottom: 3 }).backgroundColor(this.surfaceColor())
      Row({ space: 2 }) {
        Column({ space: 2 }) {
          ForEach(SLOTS, (slot: number) => { this.slotAxis(slot, false) })
        }.width(34)
        ForEach([1,2,3,4,5,6,7], (day: number) => {
          Stack({ alignContent: Alignment.TopStart }) {
            Column({ space: 2 }) {
              ForEach(SLOTS, (slot: number) => {
                Column().width('100%').height(this.weekStride() - 2)
                  .backgroundColor(this.cellColor()).border({ width: 1, color: this.cellBorder() }).borderRadius(8)
                  .accessibilityText(DAYS[day - 1] + '第' + slot + '节，添加课程').onClick(() => this.onAddSlot(day, slot))
              })
            }.width('100%')
            ForEach(this.store.blocksForDay(day), (block: NativeCourseBlock) => {
              Column({ space: 2 }) {
                Text(block.course.name).fontSize(this.pageWidth <= 390 ? 8 : 9).fontWeight(FontWeight.Bold)
                  .fontColor(this.toneText(block.course.name)).textAlign(TextAlign.Center).width('100%').maxLines(7)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (block.course.location) {
                  Text('@' + block.course.location).fontSize(this.pageWidth <= 390 ? 7 : 8).fontWeight(FontWeight.Bold)
                    .fontColor(this.toneText(block.course.name)).textAlign(TextAlign.Center).width('100%').maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
              }.width('100%').height((block.endSlot - block.startSlot + 1) * this.weekStride() - 2)
                .justifyContent(FlexAlign.Center).padding({ left: 3, right: 3, top: 4, bottom: 4 }).borderRadius(7)
                .linearGradient({ angle: 180, colors: this.courseGradient(block.course.name) })
                .border({ width: 1, color: this.toneBorder(block.course.name) })
                .shadow({ radius: 3, color: '#0d2c3e5e', offsetY: 1 })
                .position({ x: 0, y: (block.startSlot - 1) * this.weekStride() })
                .accessibilityText(this.courseAccessibility(block)).onClick(() => this.openCourseAt(block))
            })
          }.height(this.weekStride() * 11 - 2).layoutWeight(1)
        })
      }.width('100%').alignItems(VerticalAlign.Top)
    }.width('100%')
  }

  @Builder
  private slotAxis(slot: number, dayView: boolean) {
    Column({ space: 2 }) {
      Text(String(slot)).fontSize(dayView ? 12 : 11).fontWeight(FontWeight.Bold).fontColor(this.textColor())
      Text(SLOT_STARTS[slot - 1]).fontSize(dayView ? 8 : 7).fontColor(this.secondaryColor())
      Text(SLOT_ENDS[slot - 1]).fontSize(dayView ? 8 : 7).fontColor(this.secondaryColor())
    }.height((dayView ? this.dayStride() : this.weekStride()) - (dayView ? 3 : 2)).width('100%')
      .justifyContent(FlexAlign.Center)
  }

  @Builder
  private daySchedule() {
    Row({ space: 3 }) {
      Column({ space: 3 }) { ForEach(SLOTS, (slot: number) => { this.slotAxis(slot, true) }) }.width(36)
      Stack({ alignContent: Alignment.TopStart }) {
        Column({ space: 3 }) {
          ForEach(SLOTS, (slot: number) => {
            Column().width('100%').height(this.dayStride() - 3).borderRadius(10)
              .backgroundColor(this.cellColor()).border({ width: 1, color: this.cellBorder() })
              .accessibilityText('第' + slot + '节，添加课程').onClick(() => this.onAddSlot(this.store.selectedDay, slot))
          })
        }.width('100%')
        ForEach(this.store.blocksForDay(this.store.selectedDay), (block: NativeCourseBlock) => {
          Column({ space: 5 }) {
            Text(block.course.name).fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.toneText(block.course.name))
              .width('100%').maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text((block.course.location ? '@' + block.course.location + '  ' : '') + (block.course.teacher || ''))
              .fontSize(11).fontWeight(FontWeight.Bold).fontColor(this.toneText(block.course.name)).width('100%')
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(block.course.slotNote || block.course.weeks).fontSize(10).fontColor(this.toneText(block.course.name)).width('100%').maxLines(2)
          }.width('100%').height((block.endSlot - block.startSlot + 1) * this.dayStride() - 3)
            .justifyContent(FlexAlign.Center).padding({ left: 10, right: 10, top: 9, bottom: 9 }).borderRadius(12)
            .linearGradient({ angle: 180, colors: this.courseGradient(block.course.name) })
            .border({ width: 1, color: this.toneBorder(block.course.name) })
            .shadow({ radius: 3, color: '#0d2c3e5e', offsetY: 1 })
            .position({ x: 0, y: (block.startSlot - 1) * this.dayStride() })
            .accessibilityText(this.courseAccessibility(block)).onClick(() => this.openCourseAt(block))
        })
      }.layoutWeight(1).height(this.dayStride() * 11 - 3)
    }.width('100%').alignItems(VerticalAlign.Top)
  }

  @Builder
  private scheduleSheet() {
    if (this.store.weekPickerVisible) {
      Column({ space: 16 }) {
        Text('选择周次').width('100%').fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.textColor())
        Grid() {
          ForEach(this.store.weekOptions(), (week: NativeScheduleWeek) => {
            GridItem() {
              Button(week.value).height(44).width('100%').type(ButtonType.Normal).borderRadius(10)
                .fontColor(week.value === this.store.selectedWeek ? '#ffffff' : this.textColor())
                .backgroundColor(week.value === this.store.selectedWeek ? schedulePalette(this.store.palette).accent : this.softSurfaceColor())
                .accessibilityText('第' + week.value + '周').onClick(() => { this.store.weekPickerVisible = false; this.store.selectWeek(week.value); })
            }
          })
        }.columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr').columnsGap(6).rowsGap(6)
          .height(Math.min(350, Math.ceil(this.store.weekOptions().length / 6) * 50)).scrollBar(BarState.Off)
        Button('回到本周').height(44).fontColor('#ffffff').backgroundColor(schedulePalette(this.store.palette).accent)
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
  }

  private openCourseAt(block: NativeCourseBlock): void {
    const matches = this.store.blocksForDay(block.day).filter((item: NativeCourseBlock) => item.startSlot <= block.endSlot && item.endSlot >= block.startSlot);
    if (matches.length <= 1) { this.openDetail(block); return; }
    this.overlappingBlocks = matches;
    this.store.detailVisible = true;
  }
  private courseAccessibility(block: NativeCourseBlock): string {
    return DAYS[block.day - 1] + '，' + block.course.name + '，第' + block.startSlot + '至' + block.endSlot + '节，' + (block.course.location || '');
  }
  private weekStride(): number { return Math.max(this.pageWidth <= 390 ? 42 : 46, (this.contentHeight - 52) / 11); }
  private dayStride(): number { return Math.max(this.pageWidth <= 390 ? 51 : 56, this.contentHeight / 11); }
  private dateLabel(day: number): string { return (this.store.dayDate(day) || '--').replace('-', '/'); }
  private textColor(): string { return this.store.dark ? '#eef8f5' : '#172033'; }
  private secondaryColor(): string { return this.store.dark ? '#abc5be' : '#667085'; }
  private controlBorder(): string { return this.store.dark ? '#47a3bab3' : '#dde4ee'; }
  private surfaceColor(): string { return this.store.dark ? '#f01a2925' : '#ffffff'; }
  private softSurfaceColor(): string { return this.store.dark ? '#e020312c' : '#f9fafb'; }
  private cellColor(strong: boolean = false): string { return this.store.dark ? (strong ? '#ad263a34' : '#851e302b') : (strong ? '#8fffffff' : '#5cffffff'); }
  private cellBorder(): string { return this.store.dark ? '#33a3bab3' : '#d1dae3ef'; }
  private selectedBackground(): string { return this.store.palette === 'color-glass' ? this.surfaceColor() : schedulePalette(this.store.palette).accent; }
  private selectedTextColor(): string { return this.store.palette === 'color-glass' ? this.textColor() : '#ffffff'; }
  private weekTitleColor(): string { return this.store.dark ? this.textColor() : this.store.palette === 'color-glass' ? '#3b2f9a' : schedulePalette(this.store.palette).accentStrong; }
  private toneText(name: string): string { return scheduleCourseTone(name, this.store.palette, this.store.dark).text; }
  private toneBorder(name: string): string { return scheduleCourseTone(name, this.store.palette, this.store.dark).border; }
  private courseGradient(name: string): Array<[ResourceColor, number]> {
    const tone = scheduleCourseTone(name, this.store.palette, this.store.dark);
    return [[tone.top, 0], [tone.bottom, 1]];
  }
  private rainbowRing(): Array<[ResourceColor, number]> {
    return this.store.dark ? [['#ebfb7185',0],['#dbfb923c',0.22],['#c74ade80',0.48],['#e060a5fa',0.74],['#dbc4b5fd',1]] :
      [['#94f43f5e',0],['#80f97316',0.22],['#7322c55e',0.48],['#8a3b82f6',0.74],['#858b5cf6',1]];
  }
  private weekGradient(): Array<[ResourceColor, number]> {
    if (this.store.palette !== 'color-glass') {
      const color = this.store.dark ? '#3026313c' : schedulePalette(this.store.palette).accentPale;
      return [[color, 0], [color, 1]];
    }
    return this.store.dark ? [['#3dfb7185',0],['#33fb923c',0.24],['#2e4ade80',0.48],['#3d60a5fa',0.74],['#38c4b5fd',1]] :
      [['#17f43f5e',0],['#12f97316',0.24],['#1222c55e',0.48],['#1a3b82f6',0.74],['#178b5cf6',1]];
  }
  @Builder
  private loadingCard() {
    Column({ space: 14 }) {
      LoadingProgress()
        .width(34)
        .height(34)
        .color('#376FD6')
      Text('正在加载课表')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text(this.store.bridgeReady ? '正在从教务服务读取最新安排' : '正在恢复登录状态与课表服务')
        .fontSize(13)
        .fontColor(this.secondaryColor())
        .textAlign(TextAlign.Center)
    }
    .width('100%')
    .constraintSize({ minHeight: 260 })
    .justifyContent(FlexAlign.Center)
    .padding(24)
    .backgroundColor(this.surfaceColor())
    .borderRadius(16)
  }

  @Builder
  private stateCard(title: string, message: string, action: string, callback: () => void) {
    Column({ space: 12 }) {
      Text(title)
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text(message)
        .fontSize(13)
        .fontColor(this.secondaryColor())
        .textAlign(TextAlign.Center)
      if (action) {
        Button(action)
          .type(ButtonType.Capsule)
          .height(44)
          .fontSize(13)
          .fontColor('#FFFFFF')
          .backgroundColor('#166F63')
          .onClick(() => callback())
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 220 })
    .justifyContent(FlexAlign.Center)
    .padding(24)
    .backgroundColor(this.surfaceColor())
    .borderRadius(16)
  }

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
    return this.store.weekOptions()[this.store.selectedWeekIndex()]?.label ||
      (this.store.selectedWeek ? `第 ${this.store.selectedWeek} 周` : '选择周次');
  }

  private weekRange(): string {
    const start = this.store.dayDate(1);
    const end = this.store.dayDate(7);
    return start && end ? `${start.replace('-', '/')} - ${end.replace('-', '/')}` : '下拉刷新课表';
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
