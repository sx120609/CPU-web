import { NativeCourseBlock, NativeScheduleSemester, NativeScheduleStore, NativeScheduleWeek } from './NativeScheduleStore';
import { NativeScheduleBody } from './NativeScheduleBody';
import { scheduleCardTone } from './ScheduleVisuals';
import { scheduleAccent, scheduleGridMetrics, scheduleSecondaryText, scheduleSoftSurface, scheduleSurface, scheduleText,
  scheduleTint } from './ScheduleLayout';

const DAYS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

@Component
export struct NativeSchedulePage {
  @ObjectLink store: NativeScheduleStore;
  @Prop bottomClearance: number = 100;
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
  private dayController: SwiperController = new SwiperController();

  build() {
    Stack() {
      Column().width('100%').height('100%')
        .linearGradient({ angle: 180, colors: this.store.dark ? [['#12231F', 0], ['#162D27', 0.48], ['#101C19', 1]] : [['#F6FAFF', 0], ['#F8FBFF', 0.42], ['#F8FBFF', 1]] })
      if (this.store.backgroundPath) {
        Image(this.store.backgroundPath).width('100%').height('100%').objectFit(ImageFit.Cover).opacity(this.store.backgroundOpacity)
      }
      Column() {
        if (this.store.semesterOptions().length) {
          this.scheduleToolbar()
        }
        if (this.store.weekOptions().length) {
          this.weekSwitcher()
        }
        if (this.store.errorMessage) this.messageBanner(this.store.errorMessage, this.surfaceColor(), this.textColor())
        Refresh({ refreshing: this.pullRefreshing && this.store.status === 'loading' }) {
          if (this.store.viewMode === 'day' && this.store.weekOptions().length) {
            Column() {
              this.dayStrip()
              Swiper(this.dayController) {
                ForEach([1,2,3,4,5,6,7], (day: number) => {
                  Column() {
                    NativeScheduleBody({ store: this.store, view: this.dayPreview(day),
                      contentHeight: Math.max(360, this.contentHeight - 44), pageWidth: this.pageWidth,
                      showDayStrip: false,
                      onLogin: this.onLogin, onAddSlot: this.onAddSlot,
                      onCourse: (block: NativeCourseBlock) => this.openCourseAt(block) })
                  }.width('100%').height('100%')
                })
              }.width('100%').layoutWeight(1).index(Math.max(0, Math.min(6, this.store.selectedDay - 1)))
                .loop(false).indicator(false).duration(260).curve(Curve.EaseOut).cachedCount(1)
                .onChange((index: number) => this.store.selectDay(index + 1))
            }.width('100%').height('100%')
          } else if (this.store.weekOptions().length) {
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
        }.layoutWeight(1).width('100%').clip(true).margin({ bottom: this.bottomClearance })
          .onRefreshing(() => { this.pullRefreshing = true; this.store.load(true); })
          .onStateChange((state: RefreshStatus) => {
            if (state === RefreshStatus.Inactive || state === RefreshStatus.Done) this.pullRefreshing = false;
          })
          .onAreaChange((_old: Area, next: Area) => this.contentHeight = Number(next.height))
      }.width('100%').constraintSize({ maxWidth: 720 }).height('100%')
        .padding({ left: scheduleGridMetrics(this.pageWidth, this.contentHeight).inset, right: scheduleGridMetrics(this.pageWidth, this.contentHeight).inset, top: 4 })
    }.width('100%').height('100%')
      .onAreaChange((_old: Area, next: Area) => { this.pageWidth = Number(next.width); this.pageHeight = Number(next.height); })
      .bindSheet(this.store.detailVisible || this.store.weekPickerVisible, this.scheduleSheet(), {
        height: SheetSize.FIT_CONTENT, showClose: true, dragBar: true,
        onDisappear: () => { this.store.detailVisible = false; this.store.weekPickerVisible = false; this.overlappingBlocks = []; }
      })
  }

  // The header mirrors the iOS and Android timetables: one row of small capsule
  // controls and one borderless week navigator, so the grid starts higher up.
  @Builder
  private scheduleToolbar() {
    Row({ space: 6 }) {
      Row({ space: 2 }) {
        Text(this.semesterLabel()).fontSize(12).fontWeight(600).fontColor(this.textColor())
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        if (this.store.semesterOptions().length > 1) {
          SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(12).fontColor([this.secondaryColor()])
        }
      }.layoutWeight(1).height(32).padding({ left: 12, right: 10 }).borderRadius(16).backgroundColor(this.surfaceColor())
        .responseRegion({ x: 0, y: -6, width: '100%', height: 44 })
        .enabled(this.store.semesterOptions().length > 1)
        .accessibilityGroup(true).accessibilityText('选择学期，当前 ' + this.store.selectedSemester)
        .bindMenu(this.semesterMenu())
      Row() {
        this.modeButton('日', 'day')
        this.modeButton('周', 'week')
      }.width(76).height(32).padding(2).borderRadius(16).backgroundColor(this.softSurfaceColor())
      Button() { SymbolGlyph($r('sys.symbol.scope')).fontSize(17).fontColor([this.textColor()]) }
        .type(ButtonType.Circle).width(32).height(32).padding(0).backgroundColor(this.surfaceColor())
        .responseRegion({ x: -3, y: -6, width: 38, height: 44 })
        .id('schedule-today').accessibilityText('回到本周今日')
        .onClick(() => { this.store.returnToCurrentWeek(); this.store.selectDay(new Date().getDay() || 7); })
      Button() {
        if (this.store.status === 'loading') {
          LoadingProgress().width(18).height(18).color(this.accentColor())
        } else {
          Row({ space: 3 }) {
            ForEach([1,2,3], () => { Circle().width(3.5).height(3.5).fill(this.textColor()) })
          }
        }
      }.type(ButtonType.Normal).width(34).height(40).padding(0).backgroundColor(Color.Transparent).borderRadius(12)
        .responseRegion({ x: -3, y: -2, width: 40, height: 44 })
        .id('schedule-more').accessibilityText('更多课表操作')
        .bindMenu([
          { value: '刷新课表', enabled: this.store.status !== 'loading', action: () => this.store.load(true) },
          { value: '课表配色与背景', action: () => this.onStyle() },
          { value: '添加与恢复课程', enabled: this.store.source !== 'graduate', action: () => this.onTools() },
          { value: '桌面与锁屏服务卡片', action: () => this.onWidgets() },
          { value: '分享所选周课表', action: () => this.onShare() },
          { value: '导出所选周日历', action: () => this.onExport() },
          { value: '应用外观', action: () => this.onAppearance() }
        ])
    }.width('100%').height(40).margin({ bottom: 2 })
  }

  @Builder
  private semesterMenu() {
    Menu() {
      ForEach(this.store.semesterOptions(), (item: NativeScheduleSemester) => {
        MenuItem({ content: item.label })
          .selected(item.value === this.store.selectedSemester).selectIcon(true)
          .onClick(() => this.store.selectSemester(item.value))
      }, (item: NativeScheduleSemester) => item.value)
    }
  }

  @Builder
  private modeButton(label: string, mode: string) {
    Button() {
      Text(label).fontSize(12).fontWeight(this.store.viewMode === mode ? 600 : FontWeight.Medium)
        .fontColor(this.store.viewMode === mode ? this.textColor() : this.secondaryColor())
    }.type(ButtonType.Normal).layoutWeight(1).height('100%').padding(0).borderRadius(14)
      .backgroundColor(this.store.viewMode === mode ? this.surfaceColor() : Color.Transparent)
      .responseRegion({ x: 0, y: -8, width: '100%', height: 44 })
      .accessibilityText(label + '视图').accessibilitySelected(this.store.viewMode === mode)
      .onClick(() => this.store.setViewMode(mode))
  }

  @Builder
  private weekStepButton(delta: number) {
    Button() {
      SymbolGlyph(delta < 0 ? $r('sys.symbol.chevron_left') : $r('sys.symbol.chevron_right')).fontSize(16).fontWeight(FontWeight.Medium)
        .fontColor([this.textColor()])
    }.type(ButtonType.Circle).width(40).height(40).padding(0).backgroundColor(Color.Transparent)
      .enabled(this.store.canMoveWeek(delta)).opacity(this.store.canMoveWeek(delta) ? 1 : 0.32)
      // Icon-only controls carry ids so the emulator acceptance script can find them.
      .id(delta < 0 ? 'schedule-previous-week' : 'schedule-next-week')
      .accessibilityText(delta < 0 ? '上一周' : '下一周')
      .onClick(() => {
        if (this.store.viewMode === 'day') this.store.moveWeek(delta);
        else if (delta < 0) this.weekController.showPrevious();
        else this.weekController.showNext();
      })
  }

  @Builder
  private weekSwitcher() {
    Row() {
      this.weekStepButton(-1)
      Button() {
        Column({ space: 1 }) {
          Row({ space: 6 }) {
            Text(this.weekLabel()).fontSize(14).fontWeight(600).fontColor(this.textColor())
            if (this.isCurrentWeek()) {
              Text('本周').fontSize(10).fontWeight(FontWeight.Bold).fontColor(this.accentColor())
                .padding({ left: 5, right: 5, top: 1, bottom: 1 }).borderRadius(6)
                .backgroundColor(scheduleTint(this.accentColor(), 0.14))
            }
          }
          Text(this.weekRange()).fontSize(10).fontColor(this.secondaryColor()).maxLines(1)
        }.width('100%').alignItems(HorizontalAlign.Center)
      }.type(ButtonType.Normal).layoutWeight(1).height(40).padding(0).backgroundColor(Color.Transparent).borderRadius(16)
        .accessibilityText('选择周次，' + this.weekLabel() + '，' + this.weekRange())
        .onClick(() => this.store.weekPickerVisible = true)
      this.weekStepButton(1)
    }.width('100%').height(42).margin({ bottom: 2 }).borderRadius(18)
      // Over a background photo the navigator sits on a frosted plate, like the other clients.
      .backgroundColor(this.store.backgroundPath ? this.surfaceColor() : Color.Transparent)
  }

  @Builder
  private dayStrip() {
    Row({ space: 2 }) {
      ForEach(DAYS, (label: string, index: number) => {
        Button() {
          Column({ space: 1 }) {
            Text(label).fontSize(11).fontWeight(600)
              .fontColor(index + 1 === this.store.selectedDay ? this.accentColor() : this.textColor())
            Text(this.dayDateLabel(index + 1)).fontSize(9)
              .fontColor(index + 1 === this.store.selectedDay ? this.accentColor() : this.secondaryColor())
          }.width('100%').height('100%').justifyContent(FlexAlign.Center).borderRadius(10)
            .backgroundColor(index + 1 === this.store.selectedDay ? scheduleTint(this.accentColor(), 0.12)
              : (this.store.backgroundPath ? this.surfaceColor() : Color.Transparent))
            .border({ width: index + 1 === this.store.selectedDay || this.store.isToday(index + 1) ? 0.8 : 0,
              color: scheduleTint(this.accentColor(), index + 1 === this.store.selectedDay ? 0.3 : 0.45), radius: 10 })
        }
          .type(ButtonType.Normal).height(36).layoutWeight(1).padding(0).borderRadius(10).backgroundColor(Color.Transparent)
          .responseRegion({ x: 0, y: -4, width: '100%', height: 44 })
          .accessibilityText(label + ' ' + this.dayDateLabel(index + 1)).accessibilitySelected(index + 1 === this.store.selectedDay)
          .onClick(() => {
            this.store.selectDay(index + 1);
            this.dayController.changeIndex(index, true);
          })
      })
    }.width('100%').margin({ bottom: 8 })
  }

  private semesterLabel(): string {
    const value = this.store.selectedSemester;
    const parts = value.split('-');
    // "2026-2027-1" reads as "2026–27 · 秋" in the capsule; anything else keeps the server label.
    if (parts.length === 3 && parts[0].length === 4 && parts[1].length === 4) {
      return `${parts[0]}–${parts[1].substring(2)} · ${parts[2] === '1' ? '秋' : parts[2] === '2' ? '春' : '夏'}`;
    }
    const option = this.store.semesterOptions().find((item: NativeScheduleSemester) => item.value === value);
    return option?.label || value || '选择学期';
  }

  private isCurrentWeek(): boolean {
    const current = this.store.currentWeekValue();
    return !!current && current === this.store.selectedWeek && [1,2,3,4,5,6,7].some((day: number) => this.store.isToday(day));
  }

  private dayDateLabel(day: number): string {
    const date = this.store.dayDate(day);
    return date ? date.replace('-', '.') : '—';
  }

  private dayPreview(day: number): NativeScheduleStore {
    const preview = this.store.previewWeek(this.store.selectedWeek);
    preview.viewMode = 'day';
    preview.selectedDay = day;
    return preview;
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
          Button() {
            Column({ space: 2 }) {
              Text(block.course.name).fontSize(14).fontWeight(FontWeight.Medium)
                .fontColor(this.toneText(block.course.name)).width('100%').maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(block.course.location ? '@' + block.course.location : '地点待定').fontSize(11)
                .fontColor(this.secondaryColor()).width('100%').maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }.width('100%').alignItems(HorizontalAlign.Start)
          }.width('100%').height(52).padding({ left: 12, right: 12 })
            .fontColor(this.toneText(block.course.name)).backgroundColor(this.softSurfaceColor())
            .accessibilityText(block.course.name + '，' + (block.course.location || '地点待定'))
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
  private textColor(): string { return scheduleText(this.store.dark); }
  private secondaryColor(): string { return scheduleSecondaryText(this.store.dark); }
  private surfaceColor(): string { return scheduleSurface(this.store.dark, !!this.store.backgroundPath); }
  private softSurfaceColor(): string { return scheduleSoftSurface(this.store.dark); }
  private accentColor(): string { return scheduleAccent(this.store.palette, this.store.dark); }
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
    const start = this.store.slotStart(startSlot);
    const end = this.store.slotEnd(endSlot);
    return start && end ? `${start}-${end}` : '';
  }

}
