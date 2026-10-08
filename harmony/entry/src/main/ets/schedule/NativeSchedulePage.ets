import { NativeCourseBlock, NativeScheduleSemester, NativeScheduleStore, NativeScheduleWeek } from './NativeScheduleStore';
import { NativeScheduleBody } from './NativeScheduleBody';
import { ScheduleMonthView } from './ScheduleMonthView';
import { scheduleMonthTitle } from './ScheduleMonth';
import { scheduleCardTone } from './ScheduleVisuals';
import { scheduleAccent, scheduleGridMetrics, scheduleSecondaryText, scheduleSoftSurface, scheduleSurface, scheduleText,
  scheduleTint } from './ScheduleLayout';
import { scheduleAlpha, scheduleCleanLocation, scheduleCourseAccent, scheduleMetaText, scheduleMinutesNow,
  scheduleSlotText, scheduleStyleCanvas, scheduleStyleCellBorder, scheduleStyleColumnGap, scheduleStyleCourseColor,
  scheduleStyleFont, scheduleStyleInk, scheduleStylePanelSurface, scheduleStyleTextFont, scheduleThemeText,
  scheduleThemeTint, scheduleWeekday } from './ScheduleStyle';
import { ScheduleStyledDateHeader } from './ScheduleDateHeader';

const DAYS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
// Height of the styled day strip: the date header of the styled week views, a little taller.
const STYLED_STRIP: number = 50;

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
  onSharing: () => void = () => undefined;
  // Closes a read-only shared timetable.
  onClose: () => void = () => undefined;
  // Pins "now" (minutes since midnight) for acceptance screenshots; -1 follows the clock.
  @Prop @Watch('tick') pinnedNow: number = -1;
  @State private contentHeight: number = 540;
  @State private pageWidth: number = 360;
  @State private pageHeight: number = 700;
  @State private pullRefreshing: boolean = false;
  @State private detailName: string = '';
  @State private detailTeacher: string = '';
  @State private detailLocation: string = '';
  @State private detailWeeks: string = '';
  @State private detailNote: string = '';
  // Set when the course can only be looked at from here (not this week's, or the leading Sunday's).
  @State private detailPeek: string = '';
  @State private detailSchedule: string = '';
  @State private detailCustom: boolean = false;
  @State private detailOrphaned: boolean = false;
  private detailBlock?: NativeCourseBlock;
  private weekController: SwiperController = new SwiperController();
  private dayController: SwiperController = new SwiperController();
  private nowTimer: number = -1;

  aboutToAppear(): void {
    this.tick();
    // "Now" moves once a minute; a short interval keeps it from lagging after the app resumes.
    this.nowTimer = setInterval(() => this.tick(), 15000);
  }

  aboutToDisappear(): void {
    clearInterval(this.nowTimer);
  }

  private tick(): void {
    const minutes = this.pinnedNow >= 0 ? this.pinnedNow : scheduleMinutesNow(Date.now());
    if (this.store.nowMinutes !== minutes) this.store.nowMinutes = minutes;
  }

  build() {
    Stack() {
      Column().width('100%').height('100%')
        .linearGradient({ angle: 180, colors: this.store.dark ? [['#15181C', 0], ['#0E1012', 1]] : [['#F6FAFF', 0], ['#F8FBFF', 0.42], ['#F8FBFF', 1]] })
      // Paper and board bring their own page colour.
      if (scheduleStyleCanvas(this.store.visualStyle, this.store.dark)) {
        Column().width('100%').height('100%').backgroundColor(scheduleStyleCanvas(this.store.visualStyle, this.store.dark))
      }
      if (this.store.backgroundPath) {
        Image(this.store.backgroundPath).width('100%').height('100%').objectFit(ImageFit.Cover).opacity(this.store.backgroundOpacity)
      }
      Column() {
        if (this.store.semesterOptions().length) {
          this.scheduleToolbar()
        }
        if (this.store.weekOptions().length) {
          if (this.store.viewMode === 'month') this.monthSwitcher()
          else this.weekSwitcher()
        }
        if (this.store.errorMessage) this.messageBanner(this.store.errorMessage, this.surfaceColor(), this.textColor())
        Refresh({ refreshing: this.pullRefreshing && this.store.status === 'loading' }) {
          if (this.store.viewMode === 'month' && this.store.weekOptions().length && this.store.result) {
            ScheduleMonthView({ store: this.store,
              onCourse: (block: NativeCourseBlock, shownDay: number) => this.openDetail(block, shownDay) })
          } else if (this.store.viewMode === 'day' && this.store.weekOptions().length) {
            Column() {
              this.dayStrip()
              Swiper(this.dayController) {
                ForEach([1,2,3,4,5,6,7], (day: number) => {
                  Column() {
                    NativeScheduleBody({ store: this.store, view: this.dayPreview(day),
                      contentHeight: Math.max(360, this.contentHeight - (this.store.visualStyle === 'classic' ? 44 : STYLED_STRIP + 2)),
                      pageWidth: this.pageWidth,
                      showDayStrip: false,
                      onLogin: this.onLogin, onAddSlot: this.onAddSlot,
                      onCourse: (block: NativeCourseBlock, shownDay: number) => this.openDetail(block, shownDay) })
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
                    NativeScheduleBody({ store: this.store, view: this.weekPreview(week.value),
                      contentHeight: this.contentHeight, pageWidth: this.pageWidth,
                      onLogin: this.onLogin, onAddSlot: this.onAddSlot,
                      onCourse: (block: NativeCourseBlock, shownDay: number) => this.openDetail(block, shownDay),
                      onPeek: (block: NativeCourseBlock, shownDay: number, note: string) => this.openDetail(block, shownDay, note || ' ') })
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
              onCourse: (block: NativeCourseBlock, shownDay: number) => this.openDetail(block, shownDay),
              onPeek: (block: NativeCourseBlock, shownDay: number, note: string) => this.openDetail(block, shownDay, note || ' ') })
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
        onDisappear: () => { this.store.detailVisible = false; this.store.weekPickerVisible = false; }
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
        if (this.store.readOnly) {
          Text('只读').fontSize(10).fontWeight(600).fontColor(this.secondaryColor())
        } else if (this.store.semesterOptions().length > 1) {
          SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(12).fontColor([this.secondaryColor()])
        }
      }.layoutWeight(1).height(32).padding({ left: 12, right: 10 }).borderRadius(16).backgroundColor(this.surfaceColor())
        .responseRegion({ x: 0, y: -6, width: '100%', height: 44 })
        .enabled(this.store.semesterOptions().length > 1)
        .accessibilityGroup(true).accessibilityText(this.store.readOnly ? '共享课表，' + this.semesterLabel() : '选择学期，当前 ' + this.store.selectedSemester)
        .bindMenu(this.semesterMenu())
      Row() {
        this.modeButton('日', 'day')
        this.modeButton('周', 'week')
        this.modeButton('月', 'month')
      }.width(108).height(32).padding(2).borderRadius(16).backgroundColor(this.softSurfaceColor())
      if (this.store.showBackToWeek) {
        Button() { SymbolGlyph($r('sys.symbol.scope')).fontSize(17).fontColor([this.textColor()]) }
          .type(ButtonType.Circle).width(32).height(32).padding(0).backgroundColor(this.surfaceColor())
          .responseRegion({ x: -3, y: -6, width: 38, height: 44 })
          .id('schedule-today').accessibilityText('回到本周今日')
          .onClick(() => {
            this.store.returnToCurrentWeek();
            this.store.selectDay(new Date().getDay() || 7);
            this.store.seedMonthSelection(true);
          })
      }
      if (this.store.readOnly) {
        Button() { SymbolGlyph($r('sys.symbol.xmark')).fontSize(16).fontColor([this.textColor()]) }
          .type(ButtonType.Circle).width(32).height(32).padding(0).backgroundColor(this.surfaceColor())
          .responseRegion({ x: -3, y: -6, width: 38, height: 44 })
          .id('schedule-close').accessibilityText('关闭共享课表')
          .onClick(() => this.onClose())
      } else {
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
            { value: '添加与恢复课程', enabled: this.store.source !== 'graduate', action: () => this.onTools() },
            { value: '课表风格、配色与背景', action: () => this.onStyle() },
            { value: '桌面与锁屏服务卡片', action: () => this.onWidgets() },
            { value: '分享所选周课表', action: () => this.onShare() },
            { value: '导出所选周日历', action: () => this.onExport() },
            { value: '共享课表', action: () => this.onSharing() },
            { value: '应用外观', action: () => this.onAppearance() }
          ])
      }
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
        .fontColor([this.navigatorInk()])
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
            Text(this.weekLabel()).fontSize(14).fontWeight(600).fontColor(this.navigatorInk()).fontFamily(this.navigatorTitleFont())
            if (this.isCurrentWeek()) {
              Text('本周').fontSize(10).fontWeight(FontWeight.Bold).fontColor(this.accentColor())
                .padding({ left: 5, right: 5, top: 1, bottom: 1 }).borderRadius(6)
                .backgroundColor(scheduleTint(this.accentColor(), 0.14))
            }
          }
          Text(this.weekRange()).fontSize(10).fontColor(this.navigatorSecondary()).maxLines(1).fontFamily(this.navigatorDateFont())
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
  private monthStepButton(delta: number) {
    Button() {
      SymbolGlyph(delta < 0 ? $r('sys.symbol.chevron_left') : $r('sys.symbol.chevron_right')).fontSize(16).fontWeight(FontWeight.Medium)
        .fontColor([this.navigatorInk()])
    }.type(ButtonType.Circle).width(40).height(40).padding(0).backgroundColor(Color.Transparent)
      .id(delta < 0 ? 'schedule-previous-month' : 'schedule-next-month')
      .accessibilityText(delta < 0 ? '上个月' : '下个月')
      .onClick(() => this.store.moveMonth(delta))
  }

  @Builder
  private monthSwitcher() {
    Row() {
      this.monthStepButton(-1)
      Text(scheduleMonthTitle(this.store.monthAnchor)).fontSize(14).fontWeight(600).fontColor(this.navigatorInk())
        .fontFamily(this.navigatorTitleFont()).layoutWeight(1).textAlign(TextAlign.Center)
      this.monthStepButton(1)
    }.width('100%').height(42).margin({ bottom: 2 }).borderRadius(18)
      .backgroundColor(this.store.backgroundPath ? this.surfaceColor() : Color.Transparent)
  }

  // The day view's seven-day strip. Classic keeps its own; every other style draws it as the header
  // row of its week view, see `ScheduleStyledDateHeader`.
  @Builder
  private dayStrip() {
    if (this.store.visualStyle === 'classic') this.classicDayStrip()
    else this.styledDayStrip()
  }

  @Builder
  private styledDayStrip() {
    // Same gaps as the week view: only minimal and grid keep space between days.
    Row({ space: scheduleStyleColumnGap(this.store.visualStyle) }) {
      ForEach(DAYS, (label: string, index: number) => {
        Column() {
          ScheduleStyledDateHeader({ visualStyle: this.store.visualStyle, dark: this.store.dark, palette: this.store.palette,
            day: index + 1, date: this.dayNumber(index + 1), today: this.store.isToday(index + 1),
            adjustment: this.store.adjustment(index + 1)?.kind ?? '',
            selected: index + 1 === this.store.selectedDay ? 1 : 0, leading: index === 0 })
        }.layoutWeight(1).height(STYLED_STRIP)
          .id('schedule-day-' + (index + 1))
          .accessibilityGroup(true).accessibilityRole(AccessibilityRoleType.BUTTON)
          .accessibilityText(label + ' ' + this.dayDateLabel(index + 1) + this.dayAdjustmentLabel(index + 1) + '，' + this.dayCourseCount(index + 1))
          .accessibilitySelected(index + 1 === this.store.selectedDay)
          .onClick(() => {
            this.store.selectDay(index + 1);
            this.dayController.changeIndex(index, true);
          })
      })
    }.width('100%').height(STYLED_STRIP).margin({ top: 2 })
      .backgroundColor(this.store.visualStyle === 'table'
        ? scheduleStylePanelSurface(!!this.store.backgroundPath, this.store.dark, this.store.backgroundOpacity) : Color.Transparent)
      .border(this.stripBorder())
  }

  @Builder
  private classicDayStrip() {
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
          .accessibilityText(label + ' ' + this.dayDateLabel(index + 1) + this.dayAdjustmentLabel(index + 1)).accessibilitySelected(index + 1 === this.store.selectedDay)
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

  private dayNumber(day: number): string {
    const date = this.store.rawDate(day);
    return date.length >= 10 ? String(Number(date.substring(8, 10))) : '–';
  }

  private dayCourseCount(day: number): string {
    const count = this.store.displayBlocks(day).length;
    return count > 0 ? `${count} 门课` : '没有课';
  }

  // The table frames its strip like its week panel. The board has no panel to sit on, so its strip
  // ends on the hairline it rules its rows with.
  private stripBorder(): BorderOptions {
    if (this.store.visualStyle === 'table') return { width: 0.6, color: scheduleStyleCellBorder(this.store.dark) };
    const widths: EdgeWidths = { bottom: this.store.visualStyle === 'board' ? 0.5 : 0 };
    return { width: widths, color: scheduleAlpha(scheduleStyleInk(this.store.visualStyle, this.store.dark), 0.15) };
  }

  // Paper and board have a page colour of their own: the navigator is set in their ink, and its
  // second line in that ink, thinned, in place of the theme grey.
  private ownsCanvas(): boolean { return !!scheduleStyleCanvas(this.store.visualStyle, this.store.dark) && !this.store.backgroundPath; }
  private navigatorInk(): string {
    return this.ownsCanvas() ? scheduleStyleInk(this.store.visualStyle, this.store.dark) : this.textColor();
  }
  private navigatorSecondary(): string {
    return this.ownsCanvas() ? scheduleAlpha(scheduleStyleInk(this.store.visualStyle, this.store.dark), 0.62) : this.secondaryColor();
  }
  // The week and month titles follow the style's typeface; classic and minimal stay on the system face.
  private navigatorTitleFont(): string {
    return this.store.visualStyle === 'classic' ? 'HarmonyOS Sans' : scheduleStyleTextFont(this.store.visualStyle);
  }
  // The date range under the week title is all digits, so the board may keep its monospaced face there.
  private navigatorDateFont(): string {
    return this.store.visualStyle === 'classic' ? 'HarmonyOS Sans' : scheduleStyleFont(this.store.visualStyle);
  }

  private dayAdjustmentLabel(day: number): string {
    const adjustment = this.store.adjustment(day);
    return adjustment ? (adjustment.kind === 'off' ? '，休息' : '，补班') : '';
  }

  // Reading the revisions here makes a page redraw when priorities or weekend visibility change.
  private weekPreview(week: string): NativeScheduleStore {
    const preview = this.store.previewWeek(week);
    preview.priorityRevision = this.store.priorityRevision;
    return preview;
  }

  private dayPreview(day: number): NativeScheduleStore {
    const preview = this.weekPreview(this.store.selectedWeek);
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
    } else this.courseQuickLook()
    }.width('100%').constraintSize({ maxHeight: Math.max(260, this.pageHeight - 60) })
      .scrollBar(BarState.Off).backgroundColor(this.surfaceColor())
  }

  private textColor(): string { return scheduleText(this.store.dark); }
  private secondaryColor(): string { return scheduleSecondaryText(this.store.dark); }
  private surfaceColor(): string { return scheduleSurface(this.store.dark, !!this.store.backgroundPath); }
  private softSurfaceColor(): string { return scheduleSoftSurface(this.store.dark); }
  private accentColor(): string { return scheduleAccent(this.store.palette, this.store.dark); }
  // The course-colour bar matches the card on the timetable.
  private detailAccent(): string {
    return this.store.visualStyle === 'classic' ? scheduleCardTone(this.detailName, this.store.palette, this.store.dark).border
      : scheduleCourseAccent(scheduleStyleCourseColor(this.detailName, this.store.palette), this.store.dark);
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

  // The course quick look: the name, "weekday · periods · times", then room, teacher, weeks and
  // note. Tapping a course anywhere on the timetable opens it; 编辑 opens the editor.
  @Builder
  private courseQuickLook() {
    Column({ space: 16 }) {
      Row({ space: 12 }) {
        Column().width(4).borderRadius(2).backgroundColor(this.detailAccent()).alignSelf(ItemAlign.Stretch)
        Column({ space: 6 }) {
          Text(this.detailName).width('100%').fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.textColor())
          Text(this.detailSchedule).width('100%').fontSize(14).fontColor(scheduleMetaText(this.store.dark))
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (this.store.canEdit() && !this.detailPeek) {
          Button('编辑').type(ButtonType.Capsule).height(32).fontSize(14).fontWeight(600).padding({ left: 14, right: 14 })
            .fontColor(scheduleThemeText(this.store.palette, this.store.dark))
            .backgroundColor(scheduleThemeTint(this.store.palette, this.store.dark ? 0.2 : 0.1))
            .id('schedule-course-edit').accessibilityText('编辑课程')
            .onClick(() => { if (this.detailBlock) this.onEdit(this.detailBlock); })
        }
      }.width('100%').alignItems(VerticalAlign.Top).padding({ right: 36 })
      // Rows without a value take no space.
      if (this.detailLocation || this.detailTeacher || this.detailWeeks || this.detailNote) {
        Divider().color(scheduleAlpha(this.secondaryColor(), 0.25))
        Column({ space: 14 }) {
          if (this.detailLocation) this.detailRow('教室', this.detailLocation)
          if (this.detailTeacher) this.detailRow('老师', this.detailTeacher)
          if (this.detailWeeks) this.detailRow('周次', this.detailWeeks)
          if (this.detailNote) this.detailRow('备注', this.detailNote)
        }.width('100%')
      }
      if (this.detailPeek.trim()) {
        Text(this.detailPeek.trim()).width('100%').fontSize(13).fontColor(scheduleMetaText(this.store.dark))
      } else if (this.detailOrphaned) {
        Text('教务课表里已找不到这门课，请核对后保留或删除。').width('100%').fontSize(13).fontColor('#C2410C')
      } else if (this.detailCustom) {
        Text('自己添加或修改过的课程').width('100%').fontSize(13).fontColor(scheduleMetaText(this.store.dark))
      }
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 24, bottom: 28 })
    .backgroundColor(this.surfaceColor())
  }

  @Builder
  private detailRow(label: string, value: string) {
    Row({ space: 16 }) {
      Text(label)
        .fontSize(14)
        .fontColor(scheduleMetaText(this.store.dark))
      Text(value || '—')
        .fontSize(16)
        .fontColor(this.textColor())
        .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .accessibilityGroup(true)
  }

  // `shownDay` is the weekday the course is shown on; on a make-up day it differs from the
  // weekday the course belongs to, which is what the editor uses.
  private openDetail(block: NativeCourseBlock, shownDay: number, peek: string = ''): void {
    this.detailPeek = peek;
    this.detailBlock = block;
    this.detailName = block.course.name || '课程';
    this.detailTeacher = (block.course.teacher ?? '').trim();
    this.detailLocation = scheduleCleanLocation(block.course.location);
    this.detailWeeks = (block.course.weeks ?? '').trim();
    this.detailNote = this.store.courseNote(block.course);
    this.detailCustom = block.course.custom === true || !!block.course.customId;
    this.detailOrphaned = block.course.orphaned === true;
    // "周三 · 第 5–6 节 · 13:30–15:10"
    this.detailSchedule = [scheduleWeekday(shownDay), scheduleSlotText(block.startSlot, block.endSlot),
      this.timeRange(block)].filter((value: string) => !!value).join(' · ');
    this.store.detailVisible = true;
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

  private timeRange(block: NativeCourseBlock): string {
    const start = (block.course.customStartTime ?? '').trim() || this.store.slotStart(block.startSlot);
    const end = (block.course.customEndTime ?? '').trim() || this.store.slotEnd(block.endSlot);
    return start && end ? `${start}–${end}` : '';
  }

}
