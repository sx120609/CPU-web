import { NativeCourseBlock, NativeScheduleSemester, NativeScheduleStore, NativeScheduleWeek } from './NativeScheduleStore';
import { harmonyCourseColor } from './ScheduleDesign';

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
        .backgroundColor($r('app.color.app_background'))
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
            LoadingProgress().width(16).height(16).color($r('app.color.app_accent'))
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
                else this.stateCard('这一天没有课程', '可以切换日期，或添加个人课程', this.store.source === 'graduate' ? '' : '添加课程', () => this.onAddSlot(this.store.selectedDay, 1))
              }
            }.width('100%').padding({ bottom: 12 })
          }.width('100%').height('100%').scrollBar(BarState.Off)
        }.layoutWeight(1).width('100%').margin({ bottom: 76 + this.bottomSafeInset })
          .onRefreshing(() => this.store.load(true))
          .onAreaChange((_old: Area, next: Area) => this.contentHeight = Number(next.height))
          .parallelGesture(PanGesture({ direction: PanDirection.Horizontal, distance: 24 })
            .onActionEnd((event: GestureEvent) => { if (Math.abs(event.offsetX) >= 60) this.store.moveWeek(event.offsetX < 0 ? 1 : -1); }))
      }.width('100%').height('100%').padding({ left: 12, right: 12, top: 4 })
    }.width('100%').height('100%')
      .onAreaChange((_old: Area, next: Area) => { this.pageWidth = Number(next.width); this.pageHeight = Number(next.height); })
      .bindSheet(this.store.detailVisible || this.store.weekPickerVisible, this.scheduleSheet(), {
        height: SheetSize.FIT_CONTENT, showClose: true, dragBar: true,
        onDisappear: () => { this.store.detailVisible = false; this.store.weekPickerVisible = false; this.overlappingBlocks = []; }
      })
  }

  @Builder
  private scheduleToolbar() {
    Row({ space: 4 }) {
      Select(this.semesterSelectOptions())
        .selected(this.store.selectedSemesterIndex()).value(this.store.selectedSemester)
        .font({ size: 13, weight: FontWeight.Medium }).fontColor(this.textColor())
        .backgroundColor(Color.Transparent).layoutWeight(1).height(44).padding(0)
        .accessibilityText('选择学期')
        .onSelect((index: number) => { const option = this.store.semesterOptions()[index]; if (option) this.store.selectSemester(option.value); })
      Row({ space: 2 }) {
        this.modeButton('日', 'day')
        this.modeButton('周', 'week')
      }.width(68).height(36).padding(3).backgroundColor($r('app.color.app_control')).borderRadius(18)
      Button() { SymbolGlyph($r('sys.symbol.scope')).fontSize(19).fontColor([$r('app.color.app_accent')]) }
        .type(ButtonType.Normal).width(36).height(44).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText('回到本周今日')
        .onClick(() => { this.store.returnToCurrentWeek(); this.store.selectDay(new Date().getDay() || 7); })
      Button() {
        Row({ space: 3 }) {
          ForEach([1,2,3], () => { Circle().width(3).height(3).fill(this.textColor()) })
        }
      }.type(ButtonType.Normal).width(36).height(44).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText('更多课表操作')
        .bindMenu([
          { value: '课表配色与背景', action: () => this.onStyle() },
          { value: '添加与恢复课程', enabled: this.store.source !== 'graduate', action: () => this.onTools() },
          { value: '桌面与锁屏服务卡片', action: () => this.onWidgets() },
          { value: '分享所选周课表', action: () => this.onShare() },
          { value: '导出所选周日历', action: () => this.onExport() },
          { value: '应用外观', action: () => this.onAppearance() }
        ])
      Button() { SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(19).fontColor([this.textColor()]) }
        .type(ButtonType.Normal).width(36).height(44).padding(0).backgroundColor(Color.Transparent)
        .enabled(this.store.status !== 'loading').accessibilityText('刷新课表').onClick(() => this.store.load(true))
    }.width('100%').height(44).padding({ left: 4 }).margin({ bottom: 4 })
  }

  @Builder
  private modeButton(label: string, mode: string) {
    Button(label).type(ButtonType.Normal).layoutWeight(1).height(30).padding(0).fontSize(12)
      .fontWeight(this.store.viewMode === mode ? FontWeight.Medium : FontWeight.Regular)
      .fontColor(this.store.viewMode === mode ? this.textColor() : this.secondaryColor())
      .backgroundColor(this.store.viewMode === mode ? this.surfaceColor() : Color.Transparent).borderRadius(15)
      .responseRegion({ x: 0, y: -7, width: '100%', height: 44 })
      .accessibilityText(label + '视图').accessibilitySelected(this.store.viewMode === mode)
      .onClick(() => this.store.setViewMode(mode))
  }

  @Builder
  private weekSwitcher() {
    Row({ space: 8 }) {
      Button() {
        Row({ space: 4 }) {
          SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(12).fontColor([this.secondaryColor()])
          Text('上一周').fontSize(11).fontColor(this.secondaryColor())
        }
      }.type(ButtonType.Normal).width(68).height(48).padding(0).backgroundColor(Color.Transparent)
        .enabled(this.store.canMoveWeek(-1)).accessibilityText('上一周').onClick(() => this.store.moveWeek(-1))
      Button() {
        Column({ space: 3 }) {
          Row({ space: 6 }) {
            Text(this.weekLabel()).fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.textColor())
            SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(10).fontColor([this.secondaryColor()])
          }
          Text(this.weekRange()).fontSize(11).fontColor(this.secondaryColor()).maxLines(1)
        }.width('100%').alignItems(HorizontalAlign.Center)
      }.type(ButtonType.Normal).layoutWeight(1).height(56).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText('选择周次，' + this.weekLabel() + '，' + this.weekRange())
        .onClick(() => this.store.weekPickerVisible = true)
      Button() {
        Row({ space: 4 }) {
          Text('下一周').fontSize(11).fontColor(this.secondaryColor())
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(12).fontColor([this.secondaryColor()])
        }
      }.type(ButtonType.Normal).width(68).height(48).padding(0).backgroundColor(Color.Transparent)
        .enabled(this.store.canMoveWeek(1)).accessibilityText('下一周').onClick(() => this.store.moveWeek(1))
    }.width('100%').height(56).margin({ bottom: 8 })
  }

  @Builder
  private calendarDay(day: number, selected: boolean) {
    Column({ space: 4 }) {
      Text(DAYS[day - 1].substring(1)).fontSize(10).fontColor(this.secondaryColor())
      Text(this.dayNumber(day)).fontSize(15).fontWeight(FontWeight.Medium)
        .fontColor(selected ? $r('app.color.app_on_accent') : this.textColor())
        .width(28).height(28).textAlign(TextAlign.Center).borderRadius(14)
        .backgroundColor(selected ? $r('app.color.app_accent') : Color.Transparent)
    }.width('100%').height(48).justifyContent(FlexAlign.Center)
  }

  @Builder
  private dayStrip() {
    Row({ space: 2 }) {
      ForEach([1,2,3,4,5,6,7], (day: number) => {
        Button() { this.calendarDay(day, day === this.store.selectedDay) }
          .type(ButtonType.Normal).height(52).layoutWeight(1).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText(DAYS[day - 1] + ' ' + this.dateLabel(day)).accessibilitySelected(day === this.store.selectedDay)
          .onClick(() => this.store.selectDay(day))
      })
    }.width('100%').margin({ bottom: 16 })
  }

  @Builder
  private weekSchedule() {
    Column({ space: 8 }) {
      Row({ space: 3 }) {
        Text('节次').fontSize(10).fontColor(this.secondaryColor()).width(30).height(48).textAlign(TextAlign.Center)
        ForEach([1,2,3,4,5,6,7], (day: number) => {
          Button() { this.calendarDay(day, this.store.isToday(day)) }
            .type(ButtonType.Normal).height(48).layoutWeight(1).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText(DAYS[day - 1] + '，' + this.dateLabel(day) + '，查看当天课程')
            .onClick(() => { this.store.selectDay(day); this.store.setViewMode('day'); })
        })
      }.width('100%')
      Row({ space: 3 }) {
        Column() { ForEach(SLOTS, (slot: number) => { this.slotAxis(slot, false) }) }.width(30)
        ForEach([1,2,3,4,5,6,7], (day: number) => {
          Stack({ alignContent: Alignment.TopStart }) {
            Column() {
              ForEach(SLOTS, (slot: number) => {
                Column().width('100%').height(this.weekStride())
                  .border({ width: { top: 0.5 }, color: $r('app.color.app_divider') })
                  .accessibilityText(DAYS[day - 1] + '第' + slot + '节，添加课程')
                  .onClick(() => { if (this.store.source !== 'graduate') this.onAddSlot(day, slot); })
              })
            }.width('100%')
            ForEach(this.store.blocksForDay(day), (block: NativeCourseBlock) => {
              Column({ space: 4 }) {
                Text(block.course.name).fontSize(this.pageWidth <= 390 ? 10 : 11).fontWeight(FontWeight.Medium)
                  .fontColor(this.toneText(block.course.name)).width('100%').textAlign(TextAlign.Center)
                  .maxLines(block.endSlot === block.startSlot ? 1 : block.endSlot - block.startSlot < 2 ? 3 : 5)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (block.course.location) {
                  Text('@' + block.course.location).fontSize(9).fontColor(this.toneAccent(block.course.name))
                    .width('100%').textAlign(TextAlign.Center).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                if (this.overlapCount(block) > 1 && block.endSlot > block.startSlot) {
                  Text(`+${this.overlapCount(block) - 1} 门`).fontSize(8).fontColor(this.toneAccent(block.course.name)).maxLines(1)
                }
              }.width('100%').height((block.endSlot - block.startSlot + 1) * this.weekStride() - 3).clip(true)
                .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center).padding({ left: 4, right: 4, top: 5, bottom: 5 }).borderRadius(7)
                .backgroundColor(this.toneFill(block.course.name))
                .position({ x: 0, y: (block.startSlot - 1) * this.weekStride() + 1 })
                .accessibilityText(this.courseAccessibility(block)).onClick(() => this.openCourseAt(block))
            })
          }.height(this.weekStride() * 11).layoutWeight(1)
        })
      }.width('100%').alignItems(VerticalAlign.Top)
    }.width('100%')
  }

  @Builder
  private slotAxis(slot: number, dayView: boolean) {
    Column({ space: 2 }) {
      Text(String(slot)).fontSize(dayView ? 11 : 10).fontWeight(FontWeight.Medium).fontColor(this.textColor())
      Text(SLOT_STARTS[slot - 1]).fontSize(dayView ? 9 : 8).fontColor(this.secondaryColor())
      Text(SLOT_ENDS[slot - 1]).fontSize(dayView ? 9 : 8).fontColor(this.secondaryColor())
    }.height(dayView ? this.dayStride() : this.weekStride()).width('100%').justifyContent(FlexAlign.Center)
  }

  @Builder
  private daySchedule() {
    Row({ space: 10 }) {
      Column() { ForEach(SLOTS, (slot: number) => { this.slotAxis(slot, true) }) }.width(38)
      Stack({ alignContent: Alignment.TopStart }) {
        Column() {
          ForEach(SLOTS, (slot: number) => {
            Column().width('100%').height(this.dayStride())
              .border({ width: { top: 0.5 }, color: $r('app.color.app_divider') })
              .accessibilityText('第' + slot + '节，添加课程')
              .onClick(() => { if (this.store.source !== 'graduate') this.onAddSlot(this.store.selectedDay, slot); })
          })
        }.width('100%')
        ForEach(this.store.blocksForDay(this.store.selectedDay), (block: NativeCourseBlock) => {
          Button() {
            Column({ space: 7 }) {
              Text(block.course.name).fontSize(block.endSlot === block.startSlot ? 13 : 16).fontWeight(FontWeight.Medium)
                .fontColor(this.toneText(block.course.name)).width('100%')
                .maxLines(block.endSlot === block.startSlot ? 1 : 3).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text([block.course.location ? '@' + block.course.location : '', block.course.teacher].filter((value: string | undefined) => !!value).join(' · ') || '地点待确认')
                .fontSize(11).fontColor(this.secondaryColor()).width('100%').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              if (block.endSlot > block.startSlot) {
                Text(block.course.slotNote || `第 ${block.startSlot}–${block.endSlot} 节`).fontSize(11)
                  .fontColor(this.toneAccent(block.course.name)).width('100%').maxLines(1)
              }
              if (this.overlapCount(block) > 1 && block.endSlot > block.startSlot) {
                Text(`${this.overlapCount(block)} 门课程重叠，点击查看`).fontSize(10).fontColor(this.secondaryColor()).width('100%')
              }
            }.width('100%').height('100%').padding({ left: 16, right: 16, top: 6, bottom: 6 })
              .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Start)
          }.type(ButtonType.Normal).width('100%').height((block.endSlot - block.startSlot + 1) * this.dayStride() - 4)
            .padding(0).borderRadius(14).clip(true).backgroundColor(this.toneFill(block.course.name))
            .position({ x: 0, y: (block.startSlot - 1) * this.dayStride() + 2 })
            .accessibilityText(this.courseAccessibility(block)).onClick(() => this.openCourseAt(block))
        })
      }.layoutWeight(1).height(this.dayStride() * 11)
    }.width('100%').alignItems(VerticalAlign.Top)
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
  private overlapCount(block: NativeCourseBlock): number {
    return this.store.blocksForDay(block.day).filter((item: NativeCourseBlock) => item.startSlot <= block.endSlot && item.endSlot >= block.startSlot).length;
  }
  private courseAccessibility(block: NativeCourseBlock): string {
    return DAYS[block.day - 1] + '，' + block.course.name + '，第' + block.startSlot + '至' + block.endSlot + '节，' + (block.course.location || '');
  }
  private weekStride(): number { return Math.max(36, (this.contentHeight - 70) / 11); }
  private dayStride(): number { return Math.max(48, (this.contentHeight - 12) / 11); }
  private dateLabel(day: number): string { return (this.store.dayDate(day) || '--').replace('-', '/'); }
  private dayNumber(day: number): string { return String(Number((this.store.dayDate(day) || '').split('-').pop())) || '—'; }
  private monthLabel(): string { return String(Number((this.store.dayDate(1) || '').split('-')[0])) + '月'; }
  private textColor(): string { return this.store.dark ? '#F3F5F7' : '#202722'; }
  private secondaryColor(): string { return this.store.dark ? '#ADB5AF' : '#6A746E'; }
  private surfaceColor(): string { return this.store.dark ? '#222724' : '#FFFFFF'; }
  private softSurfaceColor(): string { return this.store.dark ? '#2D332F' : '#F1F3F1'; }
  private toneText(name: string): string { return harmonyCourseColor(name, this.store.palette, this.store.dark).text; }
  private toneAccent(name: string): string { return harmonyCourseColor(name, this.store.palette, this.store.dark).accent; }
  private toneFill(name: string): string { return harmonyCourseColor(name, this.store.palette, this.store.dark).fill; }
  @Builder
  private loadingCard() {
    Column({ space: 14 }) {
      LoadingProgress()
        .width(34)
        .height(34)
        .color($r('app.color.app_accent'))
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
