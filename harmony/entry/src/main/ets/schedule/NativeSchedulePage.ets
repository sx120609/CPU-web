import { NativeCourseBlock, NativeScheduleSemester, NativeScheduleStore, NativeScheduleWeek } from './NativeScheduleStore';
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
        .backgroundColor($r('app.color.app_background'))
      if (this.store.backgroundPath) {
        Image(this.store.backgroundPath).width('100%').height('100%').objectFit(ImageFit.Cover).opacity(this.store.backgroundOpacity)
      }
      Column() {
        if (this.store.weekOptions().length) {
          this.scheduleToolbar()
          this.weekSwitcher()
        }
        if (this.store.errorMessage) this.messageBanner(this.store.errorMessage, this.surfaceColor(), this.textColor())
        if (this.store.status === 'loading' && this.store.result) {
          Row({ space: 8 }) {
            LoadingProgress().width(16).height(16).color($r('app.color.app_accent'))
            Text('正在更新课表').fontSize(12).fontColor(this.secondaryColor())
          }.height(24).width('100%')
        }
        Refresh({ refreshing: this.store.status === 'loading' && this.store.result !== undefined }) {
          if (this.store.weekOptions().length) {
            Swiper(this.weekController) {
              // Builder parameters are snapshots; mode and cache changes must replace stale pages.
              ForEach(this.store.weekOptions(), (week: NativeScheduleWeek, index: number) => {
                Column() {
                  if (Math.abs(index - this.store.selectedWeekIndex()) <= 1) {
                    this.scheduleBody(this.store.previewWeek(week.value))
                  }
                }.width('100%').height('100%')
              }, (week: NativeScheduleWeek) => [this.store.selectedSemester, week.value, this.store.viewMode,
                String(this.store.selectedDay), this.store.status, String(this.store.dataRevision)].join(':'))
            }.width('100%').height('100%').index(this.store.selectedWeekIndex())
              .loop(false).indicator(false).duration(260).curve(Curve.EaseOut)
              .onChange((index: number) => {
                const week = this.store.weekOptions()[index];
                if (week) this.store.selectWeek(week.value);
              })
          } else {
            this.scheduleBody(this.store)
          }
        }.layoutWeight(1).width('100%').margin({ bottom: 76 + this.bottomSafeInset })
          .onRefreshing(() => this.store.load(true))
          .onAreaChange((_old: Area, next: Area) => this.contentHeight = Number(next.height))
      }.width('100%').height('100%').padding({ left: 8, right: 8, top: 8 })
    }.width('100%').height('100%')
      .onAreaChange((_old: Area, next: Area) => { this.pageWidth = Number(next.width); this.pageHeight = Number(next.height); })
      .bindSheet(this.store.detailVisible || this.store.weekPickerVisible, this.scheduleSheet(), {
        height: SheetSize.FIT_CONTENT, showClose: true, dragBar: true,
        onDisappear: () => { this.store.detailVisible = false; this.store.weekPickerVisible = false; this.overlappingBlocks = []; }
      })
  }

  @Builder
  private scheduleBody(view: NativeScheduleStore) {
    Scroll() {
      Column() {
        if (view.viewMode === 'day' && view.calendar) this.dayStrip(view)
        if (view.status === 'unauthorized') {
          this.stateCard('教务授权已失效', '请重新登录并完成教务授权后读取课表', '去登录', () => this.onLogin())
        } else if ((view.status === 'idle' || view.status === 'loading') && !view.result) {
          this.loadingCard()
        } else if (view.status === 'failed' && !view.result) {
          this.stateCard('课表暂时无法加载', view.errorMessage || '请检查网络连接后重试', '重新加载', () => this.store.load(true))
        } else if (view.result) {
          if (view.viewMode === 'week') this.weekSchedule(view)
          else if (view.blocksForDay(view.selectedDay).length) this.daySchedule(view)
          else this.stateCard('这一天没有课程', '可以切换日期，或添加个人课程', view.source === 'graduate' ? '' : '添加课程', () => this.onAddSlot(view.selectedDay, 1))
        }
      }.width('100%').padding({ bottom: 12 })
    }.width('100%').height('100%').scrollBar(BarState.Off)
  }

  @Builder
  private scheduleToolbar() {
    Row({ space: 4 }) {
      Select(this.semesterSelectOptions())
        .selected(this.store.selectedSemesterIndex()).value(this.store.selectedSemester)
        .font({ size: 13, weight: FontWeight.Medium }).fontColor(this.textColor())
        .backgroundColor(this.surfaceColor()).borderRadius(18).layoutWeight(1).height(38).padding({ left: 10, right: 6 })
        .accessibilityText('选择学期')
        .onSelect((index: number) => { const option = this.store.semesterOptions()[index]; if (option) this.store.selectSemester(option.value); })
      Row({ space: 2 }) {
        this.modeButton('日', 'day')
        this.modeButton('周', 'week')
      }.width(64).height(38).padding(3).backgroundColor(this.softSurfaceColor()).border({ width: 0.5, color: $r('app.color.app_divider'), radius: 12 })
      Button() { SymbolGlyph($r('sys.symbol.scope')).fontSize(19).fontColor([$r('app.color.app_accent')]) }
        .type(ButtonType.Normal).width(34).height(38).padding(0).backgroundColor(this.surfaceColor()).border({ width: 0.5, color: $r('app.color.app_divider'), radius: 12 })
        .accessibilityText('回到本周今日')
        .onClick(() => { this.store.returnToCurrentWeek(); this.store.selectDay(new Date().getDay() || 7); })
      Button() {
        Row({ space: 3 }) {
          ForEach([1,2,3], () => { Circle().width(3).height(3).fill(this.textColor()) })
        }
      }.type(ButtonType.Normal).width(34).height(38).padding(0).backgroundColor(this.surfaceColor()).border({ width: 0.5, color: $r('app.color.app_divider'), radius: 12 })
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
        .type(ButtonType.Normal).width(34).height(38).padding(0).backgroundColor(this.surfaceColor()).border({ width: 0.5, color: $r('app.color.app_divider'), radius: 12 })
        .enabled(this.store.status !== 'loading').accessibilityText('刷新课表').onClick(() => this.store.load(true))
    }.width('100%').height(44).margin({ bottom: 8 })
  }

  @Builder
  private modeButton(label: string, mode: string) {
    Button(label).type(ButtonType.Normal).layoutWeight(1).height(30).padding(0).fontSize(12)
      .fontWeight(this.store.viewMode === mode ? FontWeight.Medium : FontWeight.Regular)
      .fontColor(this.store.viewMode === mode ? this.textColor() : this.secondaryColor())
      .backgroundColor(this.store.viewMode === mode ? this.surfaceColor() : Color.Transparent).borderRadius(9)
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
      }.type(ButtonType.Normal).width(76).height(42).padding(0).backgroundColor(this.surfaceColor()).border({ width: 0.5, color: $r('app.color.app_divider'), radius: 13 })
        .enabled(this.store.canMoveWeek(-1)).accessibilityText('上一周').onClick(() => this.weekController.showPrevious())
      Button() {
        Column({ space: 3 }) {
          Row({ space: 6 }) {
            Text(this.weekLabel()).fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.textColor())
            SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(10).fontColor([this.secondaryColor()])
          }
          Text(this.weekRange()).fontSize(11).fontColor(this.secondaryColor()).maxLines(1)
        }.width('100%').alignItems(HorizontalAlign.Center)
      }.type(ButtonType.Normal).layoutWeight(1).height(42).padding(0).backgroundColor($r('app.color.app_accent_surface')).borderRadius(13)
        .accessibilityText('选择周次，' + this.weekLabel() + '，' + this.weekRange())
        .onClick(() => this.store.weekPickerVisible = true)
      Button() {
        Row({ space: 4 }) {
          Text('下一周').fontSize(11).fontColor(this.secondaryColor())
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(12).fontColor([this.secondaryColor()])
        }
      }.type(ButtonType.Normal).width(76).height(42).padding(0).backgroundColor(this.surfaceColor()).border({ width: 0.5, color: $r('app.color.app_divider'), radius: 13 })
        .enabled(this.store.canMoveWeek(1)).accessibilityText('下一周').onClick(() => this.weekController.showNext())
    }.width('100%').height(42).margin({ bottom: 12 })
  }

  @Builder
  private calendarDay(view: NativeScheduleStore, day: number, selected: boolean) {
    Column({ space: 3 }) {
      Text(DAYS[day - 1]).fontSize(11).fontWeight(FontWeight.Medium)
        .fontColor(selected ? $r('app.color.app_accent') : this.textColor())
      Text(this.dateLabel(day, view)).fontSize(9).fontColor(this.secondaryColor())
    }.width('100%').height(36).justifyContent(FlexAlign.Center).borderRadius(8)
      .backgroundColor(selected ? $r('app.color.app_accent_surface') : this.softSurfaceColor())
      .border({ width: selected ? 1 : 0.5, color: selected ? $r('app.color.app_accent') : $r('app.color.app_divider') })
  }

  @Builder
  private dayStrip(view: NativeScheduleStore) {
    Row({ space: 2 }) {
      ForEach([1,2,3,4,5,6,7], (day: number) => {
        Button() { this.calendarDay(view, day, day === view.selectedDay) }
          .type(ButtonType.Normal).height(40).layoutWeight(1).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText(DAYS[day - 1] + ' ' + this.dateLabel(day, view)).accessibilitySelected(day === view.selectedDay)
          .onClick(() => this.store.selectDay(day))
      })
    }.width('100%').margin({ bottom: 8 })
  }

  @Builder
  private weekSchedule(view: NativeScheduleStore) {
    Column({ space: 6 }) {
      Row({ space: 3 }) {
        Text('节次').fontSize(10).fontColor(this.secondaryColor()).width(38).height(36).textAlign(TextAlign.Center)
        ForEach([1,2,3,4,5,6,7], (day: number) => {
          Button() { this.calendarDay(view, day, view.isToday(day)) }
            .type(ButtonType.Normal).height(36).layoutWeight(1).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText(DAYS[day - 1] + '，' + this.dateLabel(day, view) + '，查看当天课程')
            .onClick(() => { this.store.selectDay(day); this.store.setViewMode('day'); })
        })
      }.width('100%')
      Row({ space: 3 }) {
        Column() { ForEach(SLOTS, (slot: number) => { this.slotAxis(slot, false) }) }.width(38)
        ForEach([1,2,3,4,5,6,7], (day: number) => {
          Stack({ alignContent: Alignment.TopStart }) {
            Column() {
              ForEach(SLOTS, (slot: number) => {
                Column().width('100%').height(this.weekStride() - 3).margin({ bottom: 3 })
                  .backgroundColor(this.cellColor()).borderRadius(8)
                  .border({ width: 0.5, color: $r('app.color.app_divider') })
                  .accessibilityText(DAYS[day - 1] + '第' + slot + '节，添加课程')
                  .onClick(() => { if (this.store.source !== 'graduate') this.onAddSlot(day, slot); })
              })
            }.width('100%')
            ForEach(view.blocksForDay(day), (block: NativeCourseBlock) => {
              Column({ space: 4 }) {
                Text(block.course.name).fontSize(this.pageWidth <= 390 ? 9 : 10).fontWeight(FontWeight.Medium)
                  .fontColor(this.toneText(block.course.name)).width('100%').textAlign(TextAlign.Center)
                  .maxLines(block.endSlot === block.startSlot ? 1 : block.endSlot - block.startSlot < 2 ? 3 : 5)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (block.course.location) {
                  Text('@' + block.course.location).fontSize(9).fontColor(this.toneAccent(block.course.name))
                    .width('100%').textAlign(TextAlign.Center).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                if (this.overlapCount(block, view) > 1 && block.endSlot > block.startSlot) {
                  Text(`+${this.overlapCount(block, view) - 1} 门`).fontSize(8).fontColor(this.toneAccent(block.course.name)).maxLines(1)
                }
              }.width('100%').height((block.endSlot - block.startSlot + 1) * this.weekStride() - 3).clip(true)
                .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center).padding({ left: 1, right: 1, top: 4, bottom: 4 }).borderRadius(8)
                .backgroundColor(this.toneFill(block.course.name)).border({ width: 1, color: this.toneBorder(block.course.name) })
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
  private daySchedule(view: NativeScheduleStore) {
    Row({ space: 10 }) {
      Column() { ForEach(SLOTS, (slot: number) => { this.slotAxis(slot, true) }) }.width(38)
      Stack({ alignContent: Alignment.TopStart }) {
        Column() {
          ForEach(SLOTS, (slot: number) => {
            Column().width('100%').height(this.dayStride() - 4).margin({ bottom: 4 })
              .backgroundColor(this.cellColor()).borderRadius(10)
              .border({ width: 0.5, color: $r('app.color.app_divider') })
              .accessibilityText('第' + slot + '节，添加课程')
              .onClick(() => { if (this.store.source !== 'graduate') this.onAddSlot(view.selectedDay, slot); })
          })
        }.width('100%')
        ForEach(view.blocksForDay(view.selectedDay), (block: NativeCourseBlock) => {
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
              if (this.overlapCount(block, view) > 1 && block.endSlot > block.startSlot) {
                Text(`${this.overlapCount(block, view)} 门课程重叠，点击查看`).fontSize(10).fontColor(this.secondaryColor()).width('100%')
              }
            }.width('100%').height('100%').padding({ left: 16, right: 16, top: 6, bottom: 6 })
              .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Start)
          }.type(ButtonType.Normal).width('100%').height((block.endSlot - block.startSlot + 1) * this.dayStride() - 4)
            .padding(0).clip(true).backgroundColor(this.toneFill(block.course.name)).border({ width: 1, color: this.toneBorder(block.course.name), radius: 12 })
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
  private overlapCount(block: NativeCourseBlock, view: NativeScheduleStore): number {
    return view.blocksForDay(block.day).filter((item: NativeCourseBlock) => item.startSlot <= block.endSlot && item.endSlot >= block.startSlot).length;
  }
  private courseAccessibility(block: NativeCourseBlock): string {
    return DAYS[block.day - 1] + '，' + block.course.name + '，第' + block.startSlot + '至' + block.endSlot + '节，' + (block.course.location || '');
  }
  private weekStride(): number { return Math.max(36, (this.contentHeight - 54) / 11); }
  private dayStride(): number { return Math.max(48, (this.contentHeight - 60) / 11); }
  private dateLabel(day: number, view: NativeScheduleStore): string {
    const date = view.dayDate(day);
    return date ? date.replace('-', '/') : '—';
  }
  private textColor(): string { return this.store.dark ? '#F3F5F7' : '#202722'; }
  private secondaryColor(): string { return this.store.dark ? '#ADB5AF' : '#6A746E'; }
  private surfaceColor(): string { return this.store.dark ? '#222724' : '#FFFFFF'; }
  private softSurfaceColor(): string { return this.store.dark ? '#2D332F' : '#F1F3F1'; }
  private cellColor(): string { return this.store.dark ? '#18211E' : '#F1F6F3'; }
  private toneBorder(name: string): string { return scheduleCardTone(name, this.store.palette, this.store.dark).border; }
  private toneText(name: string): string { return scheduleCardTone(name, this.store.palette, this.store.dark).text; }
  private toneAccent(name: string): string { return this.toneText(name); }
  private toneFill(name: string): string { return scheduleCardTone(name, this.store.palette, this.store.dark).top; }
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
    return start && end ? `${start.replace('-', '/')} - ${end.replace('-', '/')}` : '校历暂无日期';
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
