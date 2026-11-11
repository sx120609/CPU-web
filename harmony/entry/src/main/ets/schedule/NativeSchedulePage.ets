import { NativeCourseBlock, NativeOccurrenceChange, NativeScheduleSemester, NativeScheduleStore,
  NativeScheduleWeek } from './NativeScheduleStore';
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
import { COUPLE_ACCENT, NativeScheduleCoupleModel } from './NativeScheduleCouple';
import { couplePersonTone } from './ScheduleCouple';
import { NativeOccurrenceEditor, NativeOccurrenceEditorModel } from './NativeOccurrenceEditor';
import { ScheduleOverlayStrip } from './ScheduleOverlayStrip';
import { backgroundCropRect } from './NativeBackgroundCrop';
import { cancelledKeysOf, movedKeys, occurrenceDateText, occurrenceKeysOf, originalSlotsOf } from './ScheduleOccurrences';
import { agendaMinutes, agendaOn, NativeAgendaOccurrence } from './NativeAgenda';
import { promptAction } from '@kit.ArkUI';

const DAYS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
// Height of the styled day strip: the date header of the styled week views, a little taller.
const STYLED_STRIP: number = 50;

@Component
export struct NativeSchedulePage {
  @ObjectLink store: NativeScheduleStore;
  // The couple timetable; a read-only shared timetable gets one that is not bound.
  @ObjectLink couple: NativeScheduleCoupleModel;
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
  onCouple: () => void = () => undefined;
  // 叠加到我的课表: whose courses are drawn beside the user's.
  onOverlay: () => void = () => undefined;
  // 找共同空闲.
  onCommonFree: () => void = () => undefined;
  // 导出日历文件: this week or the whole term.
  onCalendar: () => void = () => undefined;
  // 宿舍课表是网页页面，返回回到这里。
  onDorm: () => void = () => undefined;
  // 日程与待办, over the user's own timetable.
  onAgenda?: () => void;
  // Closes a read-only shared timetable.
  onClose: () => void = () => undefined;
  // Pins "now" (minutes since midnight) for acceptance screenshots; -1 follows the clock.
  @Prop @Watch('tick') pinnedNow: number = -1;
  // The acceptance harness opens a sheet of this page once the timetable is there (`--ps panel …`).
  @Prop @Watch('runDebugAction') debugAction: string = '';
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
  // 调课 · 原定 …, on a meeting that was moved on its own.
  @State private detailStatus: string = '';
  // The date of the meeting looked at, for its 日程; empty when the calendar has none.
  @State private detailDate: string = '';
  @State private occurrence: NativeOccurrenceEditorModel = new NativeOccurrenceEditorModel();
  // 更多: NapTable's grouped tools sheet.
  @State private toolsVisible: boolean = false;
  private detailBlock?: NativeCourseBlock;
  private weekController: SwiperController = new SwiperController();
  private dayController: SwiperController = new SwiperController();
  private nowTimer: number = -1;

  aboutToAppear(): void {
    this.tick();
    this.runDebugAction();
    // "Now" moves once a minute; a short interval keeps it from lagging after the app resumes.
    this.nowTimer = setInterval(() => this.tick(), 15000);
  }

  aboutToDisappear(): void {
    clearInterval(this.nowTimer);
  }

  private runDebugAction(): void {
    const action = this.debugAction;
    if (!action) return;
    setTimeout(() => {
      const day = this.store.selectedDay;
      const blocks = this.store.displayBlocks(day);
      const date = this.store.rawDate(day);
      if (action === 'occurrence' && blocks.length) this.handleMenu('adjust', blocks[0], day, date);
      if (action === 'occurrenceCancelled') {
        const ghost = [1, 2, 3, 4, 5, 6, 7].map((value: number) => this.store.cancelledBlocks(value)).find((list: NativeCourseBlock[]) => list.length > 0);
        if (ghost) this.askRestore(ghost[0]);
      }
      if (action === 'courseDetail' && blocks.length) this.openDetail(blocks[0], day, '', date);
      if (action === 'tools') this.toolsVisible = true;
    }, 600);
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
      if (this.store.shownBackground()) {
        if (backgroundCropRect(this.store.shownBackgroundCrop()).length === 4) {
          // The framing chosen in 调整范围: that part of the photo stretched over the page.
          Stack() {
            Image(this.store.shownBackground()).objectFit(ImageFit.Fill)
              .width(this.pageWidth / backgroundCropRect(this.store.shownBackgroundCrop())[2])
              .height(this.pageHeight / backgroundCropRect(this.store.shownBackgroundCrop())[3])
              .position({ x: -backgroundCropRect(this.store.shownBackgroundCrop())[0] * this.pageWidth / backgroundCropRect(this.store.shownBackgroundCrop())[2],
                y: -backgroundCropRect(this.store.shownBackgroundCrop())[1] * this.pageHeight / backgroundCropRect(this.store.shownBackgroundCrop())[3] })
          }.width('100%').height('100%').clip(true).opacity(this.store.backgroundOpacity)
        } else {
          Image(this.store.shownBackground()).width('100%').height('100%').objectFit(ImageFit.Cover).opacity(this.store.backgroundOpacity)
        }
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
            ScheduleMonthView({ store: this.store, couple: this.couple,
              onCourse: (block: NativeCourseBlock, shownDay: number) => this.openDetail(block, shownDay, '', this.store.selectedDate),
              onCancelled: (block: NativeCourseBlock) => this.askRestore(block) })
          } else if (this.store.viewMode === 'day' && this.store.weekOptions().length) {
            Column() {
              this.dayStrip()
              Swiper(this.dayController) {
                ForEach([1,2,3,4,5,6,7], (day: number) => {
                  Column() {
                    NativeScheduleBody({ store: this.store, couple: this.couple, view: this.dayPreview(day),
                      contentHeight: Math.max(360, this.contentHeight - (this.store.visualStyle === 'classic' ? 44 : STYLED_STRIP + 2)),
                      pageWidth: this.pageWidth,
                      showDayStrip: false,
                      onLogin: this.onLogin, onAddSlot: this.onAddSlot,
                      onCourse: (block: NativeCourseBlock, shownDay: number) => this.openDetail(block, shownDay),
                      onPeek: (block: NativeCourseBlock, shownDay: number, note: string) => this.openDetail(block, shownDay, note || ' '),
                      onMenu: (action: string, block: NativeCourseBlock, shownDay: number, date: string) => this.handleMenu(action, block, shownDay, date) })
                  }.width('100%').height('100%')
                })
              }.width('100%').layoutWeight(1).index(Math.max(0, Math.min(6, this.store.selectedDay - 1)))
                .loop(false).indicator(false).duration(260).curve(Curve.EaseOut).cachedCount(1)
                .onChange((index: number) => this.store.selectDay(index + 1))
            }.width('100%').height('100%')
          } else if (this.stripShown()) {
            // Somebody else's timetable laid over: NapTable's strip of days side by side.
            Scroll() {
              ScheduleOverlayStrip({ store: this.store, couple: this.couple, pageWidth: this.pageWidth, contentHeight: this.contentHeight,
                selection: this.store.rawDate(this.store.selectedDay),
                revision: `${this.store.selectedSemester}|${this.store.dataRevision}|${this.couple.revision}|${this.store.periods.length}`,
                onCourse: (block: NativeCourseBlock, shownDay: number, date: string) => this.openDetail(block, shownDay, '', date),
                onPeek: (block: NativeCourseBlock, shownDay: number, note: string) => this.openDetail(block, shownDay, note || ' '),
                onMenu: (action: string, block: NativeCourseBlock, shownDay: number, date: string) => this.handleMenu(action, block, shownDay, date),
                onOpenDay: (date: string) => { this.store.openDate(date); } })
            }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
          } else if (this.store.weekOptions().length) {
            Swiper(this.weekController) {
              ForEach(this.store.weekOptions(), (week: NativeScheduleWeek, index: number) => {
                Column() {
                  if (Math.abs(index - this.store.selectedWeekIndex()) <= 1) {
                    NativeScheduleBody({ store: this.store, couple: this.couple, view: this.weekPreview(week.value),
                      contentHeight: this.contentHeight, pageWidth: this.pageWidth,
                      onLogin: this.onLogin, onAddSlot: this.onAddSlot,
                      onCourse: (block: NativeCourseBlock, shownDay: number) => this.openDetail(block, shownDay),
                      onPeek: (block: NativeCourseBlock, shownDay: number, note: string) => this.openDetail(block, shownDay, note || ' '),
                      onMenu: (action: string, block: NativeCourseBlock, shownDay: number, date: string) => this.handleMenu(action, block, shownDay, date) })
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
            NativeScheduleBody({ store: this.store, couple: this.couple, view: this.store,
              contentHeight: this.contentHeight, pageWidth: this.pageWidth,
              onLogin: this.onLogin, onAddSlot: this.onAddSlot,
              onCourse: (block: NativeCourseBlock, shownDay: number) => this.openDetail(block, shownDay),
              onPeek: (block: NativeCourseBlock, shownDay: number, note: string) => this.openDetail(block, shownDay, note || ' '),
                      onMenu: (action: string, block: NativeCourseBlock, shownDay: number, date: string) => this.handleMenu(action, block, shownDay, date) })
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
      .bindSheet(this.store.detailVisible || this.store.weekPickerVisible || this.occurrence.visible || this.toolsVisible, this.scheduleSheet(), {
        height: SheetSize.FIT_CONTENT, showClose: true, dragBar: true,
        onWillDismiss: (action: DismissSheetAction) => { if (!this.occurrence.busy) action.dismiss(); },
        onDisappear: () => {
          this.store.detailVisible = false; this.store.weekPickerVisible = false; this.occurrence.visible = false; this.toolsVisible = false;
        }
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
          .onClick(() => this.toolsVisible = true)
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
        if (this.store.viewMode === 'day' || this.stripShown()) this.store.moveWeek(delta);
        else if (delta < 0) this.weekController.showPrevious();
        else this.weekController.showNext();
      })
  }

  // Bound: the week and its dates share the first line and the partner's status takes the second,
  // so the couple timetable needs no row of its own.
  @Builder
  private coupledWeekSwitcher() {
    Row() {
      this.weekStepButton(-1)
      Column({ space: 2 }) {
        Row({ space: 6 }) {
          Text(this.weekLabel()).fontSize(14).fontWeight(600).fontColor(this.navigatorInk()).fontFamily(this.navigatorTitleFont()).maxLines(1)
          if (this.isCurrentWeek()) {
            Text('本周').fontSize(10).fontWeight(FontWeight.Bold).fontColor(this.accentColor())
              .padding({ left: 5, right: 5, top: 1, bottom: 1 }).borderRadius(6)
              .backgroundColor(scheduleTint(this.accentColor(), 0.14))
          }
          Text(this.weekRange()).fontSize(10).fontColor(this.navigatorSecondary()).maxLines(1).fontFamily(this.navigatorDateFont())
        }.justifyContent(FlexAlign.Center).width('100%')
          .accessibilityGroup(true).accessibilityText('选择周次，' + this.weekLabel() + '，' + this.weekRange())
          .id('schedule-week-title').onClick(() => this.store.weekPickerVisible = true)
        Row({ space: 4 }) {
          Row({ space: 5 }) {
            Circle().width(6).height(6).fill(couplePersonTone(this.couple.status.partner.color, this.store.dark).border)
            Text(this.couple.nowText(this.store.nowMinutes)).fontSize(11).fontColor(this.navigatorSecondary()).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis }).flexShrink(1)
            if (this.couple.daysTogether() > 0) {
              Row({ space: 2 }) {
                SymbolGlyph($r('sys.symbol.heart_fill')).fontSize(10).fontColor([COUPLE_ACCENT])
                Text(String(this.couple.daysTogether())).fontSize(11).fontWeight(600).fontColor(COUPLE_ACCENT).maxLines(1)
              }.margin({ left: 2 })
            }
          }.layoutWeight(1).justifyContent(FlexAlign.Center)
            .accessibilityGroup(true)
            .accessibilityText('情侣课表，' + this.couple.nowText(this.store.nowMinutes)
              + (this.couple.daysTogether() > 0 ? `，在一起第 ${this.couple.daysTogether()} 天` : ''))
            .id('schedule-couple-line').onClick(() => this.onCouple())
          // A small switch: the partner's courses on or off without opening the sheet.
          Row() {
            Circle().width(10).height(10).fill('#FFFFFF')
          }.width(26).height(14).padding(2).borderRadius(7)
            .justifyContent(this.couple.visible ? FlexAlign.End : FlexAlign.Start)
            .backgroundColor(this.couple.visible ? COUPLE_ACCENT : scheduleAlpha(this.navigatorSecondary(), 0.35))
            .responseRegion({ x: -6, y: -8, width: 38, height: 30 })
            .accessibilityGroup(true).accessibilityRole(AccessibilityRoleType.SWITCH)
            .accessibilityText('在课表里显示 TA 的课').accessibilityChecked(this.couple.visible)
            .id('schedule-couple-toggle').onClick(() => this.couple.setVisible(!this.couple.visible))
        }.width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Center)
      this.weekStepButton(1)
    }.width('100%').constraintSize({ minHeight: 42 }).margin({ bottom: 2 }).borderRadius(18)
      .backgroundColor(this.store.backgroundPath ? this.surfaceColor() : Color.Transparent)
  }

  // A shared timetable laid over: the week and its dates, then whose courses these are with a button to take them off.
  @Builder
  private overlayWeekSwitcher() {
    Row() {
      this.weekStepButton(-1)
      Column({ space: 2 }) {
        Row({ space: 6 }) {
          Text(this.weekLabel()).fontSize(14).fontWeight(600).fontColor(this.navigatorInk()).fontFamily(this.navigatorTitleFont()).maxLines(1)
          if (this.isCurrentWeek()) {
            Text('本周').fontSize(10).fontWeight(FontWeight.Bold).fontColor(this.accentColor())
              .padding({ left: 5, right: 5, top: 1, bottom: 1 }).borderRadius(6)
              .backgroundColor(scheduleTint(this.accentColor(), 0.14))
          }
          Text(this.weekRange()).fontSize(10).fontColor(this.navigatorSecondary()).maxLines(1).fontFamily(this.navigatorDateFont())
        }.justifyContent(FlexAlign.Center).width('100%')
          .id('schedule-week-title').onClick(() => this.store.weekPickerVisible = true)
        Row({ space: 6 }) {
          Circle().width(6).height(6).fill(this.couple.tint('ta', this.store.dark).border)
          Text(`叠加了 ${this.couple.partnerName()} 的课` + (this.couple.otherSchool() ? ` · ${this.couple.otherSchool()}` : ''))
            .fontSize(11).fontColor(this.navigatorSecondary()).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).flexShrink(1)
            .id('schedule-overlay-line').onClick(() => this.onOverlay())
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(11).fontColor([this.navigatorSecondary()])
            .responseRegion({ x: -10, y: -10, width: 32, height: 32 })
            .id('schedule-overlay-off').accessibilityText('不再叠加')
            .onClick(() => this.couple.setOverlay(undefined))
        }.justifyContent(FlexAlign.Center).width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Center)
      this.weekStepButton(1)
    }.width('100%').constraintSize({ minHeight: 42 }).margin({ bottom: 2 }).borderRadius(18)
      .backgroundColor(this.store.backgroundPath ? this.surfaceColor() : Color.Transparent)
  }

  // The week view while somebody else's timetable is laid over the user's.
  private stripShown(): boolean {
    return this.store.viewMode === 'week' && !this.store.readOnly && this.couple.showing() && !!this.store.calendar?.weeks?.length;
  }

  @Builder
  private weekSwitcher() {
    if (!this.store.readOnly && this.couple.overlaying()) {
      this.overlayWeekSwitcher()
    } else if (!this.store.readOnly && this.couple.bound()) {
      this.coupledWeekSwitcher()
    } else {
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
    // 更多 keeps its title still and scrolls only the list, so the sheet's close button never sits on a row.
    if (this.toolsVisible) {
      this.toolsSheet()
    } else {
    Scroll() {
    if (this.occurrence.visible) {
      NativeOccurrenceEditor({ model: this.occurrence, dark: this.store.dark })
    } else if (this.store.weekPickerVisible) {
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
      if (this.detailStatus) {
        Text(this.detailStatus).width('100%').fontSize(13).fontWeight(600).fontColor('#C2410C')
      }
      if (this.agendaShown()) this.detailAgenda()
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

  // 这节课的日程: on the meeting's date, at its time or naming the course; ticked or opened in place.
  @Builder
  private detailAgenda() {
    Column({ space: 8 }) {
      Divider().color(scheduleAlpha(this.secondaryColor(), 0.25))
      Row() {
        Text('这节课的日程').fontSize(14).fontWeight(600).fontColor(scheduleMetaText(this.store.dark)).layoutWeight(1)
        if (this.store.agendaAvailable && this.store.agendaNew) {
          Text('＋ 添加').fontSize(14).fontWeight(600).fontColor(scheduleThemeText(this.store.palette, this.store.dark))
            .id('schedule-course-agenda-add')
            .onClick(() => {
              const date = this.detailDate;
              const start = this.detailBlock ? this.store.blockStart(this.detailBlock) : '';
              this.store.detailVisible = false;
              setTimeout(() => this.store.agendaNew?.(date, start), 350);
            })
        }
      }.width('100%')
      if (!this.relatedAgenda().length) {
        Text('还没有。作业、小测或要带的东西，记一笔就会在这里出现。').fontSize(12).fontColor(scheduleMetaText(this.store.dark)).width('100%')
      }
      ForEach(this.relatedAgenda(), (entry: NativeAgendaOccurrence) => {
        Row({ space: 10 }) {
          Stack() {
            if (entry.done) Text('✓').fontSize(11).fontColor('#FFFFFF')
          }.width(20).height(20).borderRadius(10)
            .backgroundColor(entry.done ? scheduleThemeText(this.store.palette, this.store.dark) : Color.Transparent)
            .border({ width: entry.done ? 0 : 1.5, color: this.secondaryColor(), radius: 10 })
            .responseRegion({ x: -10, y: -10, width: 40, height: 40 })
            .accessibilityText(entry.done ? entry.item.title + '，已完成' : '完成' + entry.item.title)
            .onClick(() => this.store.agendaToggle?.(entry.item.id, entry.date, !entry.done))
          Column({ space: 2 }) {
            Text(entry.item.title).fontSize(15).fontColor(this.textColor()).width('100%').maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .decoration({ type: entry.done ? TextDecorationType.LineThrough : TextDecorationType.None })
            if (entry.item.start) {
              Text(entry.item.end ? `${entry.item.start}–${entry.item.end}` : entry.item.start).fontSize(12)
                .fontColor(scheduleMetaText(this.store.dark)).width('100%')
            }
          }.layoutWeight(1)
            .onClick(() => {
              const id = entry.item.id;
              const date = entry.date;
              this.store.detailVisible = false;
              setTimeout(() => this.store.agendaOpen?.(id, date), 350);
            })
        }.width('100%').opacity(entry.done ? 0.6 : 1)
      }, (entry: NativeAgendaOccurrence) => entry.item.id + ':' + entry.date + ':' + (entry.done ? 1 : 0))
    }.width('100%')
  }

  private agendaShown(): boolean {
    return !this.store.readOnly && !this.detailPeek && !!this.detailDate && (this.store.agendaAvailable || this.relatedAgenda().length > 0);
  }

  private relatedAgenda(): NativeAgendaOccurrence[] {
    if (this.store.readOnly || !this.detailDate || !this.detailBlock || !this.store.agendaItems.length) return [];
    const name = this.detailName.trim();
    const start = agendaMinutes(this.store.blockStart(this.detailBlock));
    const end = agendaMinutes(this.store.blockEnd(this.detailBlock));
    return agendaOn(this.store.agendaItems, this.detailDate).filter((entry: NativeAgendaOccurrence) => {
      if (name.length >= 2 && (entry.item.title.includes(name) || entry.item.note.includes(name))) return true;
      const begins = agendaMinutes(entry.item.start);
      if (start < 0 || end < 0 || begins < 0) return false;
      const ends = agendaMinutes(entry.item.end) >= 0 ? agendaMinutes(entry.item.end) : begins;
      return begins < end && ends >= start;
    });
  }

  // ---- 更多 ----

  // NapTable's 更多: four quick actions, then 日历与日程, 一起看 and 外观与设置.
  @Builder
  private toolsSheet() {
    Column() {
    Text('更多').fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.textColor()).width('100%')
      .padding({ left: 16, right: 64, top: 24, bottom: 14 })
    Scroll() {
    Column({ space: 16 }) {
      Row({ space: 8 }) {
        this.toolTile('刷新', $r('sys.symbol.arrow_clockwise'), '#0F766E', 'tools-refresh', () => this.store.load(true))
        this.toolTile('添加课程', $r('sys.symbol.plus'), '#2563EB', 'tools-course', () => this.onTools())
        this.toolTile('添加日程', $r('sys.symbol.calendar_badge_plus'), '#EA580C', 'tools-agenda',
          () => this.store.agendaNew?.(this.store.rawDate(this.store.selectedDay), ''))
        this.toolTile('分享', $r('sys.symbol.share'), '#4F46E5', 'tools-share', () => this.onShare())
      }.width('100%')
      this.toolSection('日历与日程')
      Column() {
        this.toolRow('导出日历文件', '这一周或整学期，可导入系统日历', $r('sys.symbol.calendar'), '#DC2626', 'tools-calendar',
          () => this.onCalendar())
        this.toolRow('日程与待办', '作业、考试和自己的安排', $r('sys.symbol.checkmark_square'), '#EA580C', 'tools-agenda-list',
          () => this.onAgenda?.())
      }.width('100%').borderRadius(16).backgroundColor(this.softSurfaceColor()).clip(true)
      this.toolSection('一起看')
      Column() {
        this.toolRow('共享课表', '发分享码，或保存同学的课表', $r('sys.symbol.person_2'), '#0D9488', 'tools-sharing', () => this.onSharing())
        this.toolRow('叠加到我的课表', this.couple.overlaying() ? `正在叠加 ${this.couple.partnerName()}` : '把同学的课并排放进你的课表',
          $r('sys.symbol.square_on_square_fill'), '#0891B2', 'tools-overlay', () => this.onOverlay())
        this.toolRow('找共同空闲', '和同学、TA 比一比哪天都有空', $r('sys.symbol.clock'), '#4F46E5', 'tools-free', () => this.onCommonFree())
        this.toolRow('情侣课表', '绑定后两人的课并排显示', $r('sys.symbol.heart_fill'), '#E2568A', 'tools-couple', () => this.onCouple())
        this.toolRow('宿舍课表', '一周谁有空、空闲时段和早八', $r('sys.symbol.house'), '#7C3AED', 'tools-dorm', () => this.onDorm())
      }.width('100%').borderRadius(16).backgroundColor(this.softSurfaceColor()).clip(true)
      this.toolSection('外观与设置')
      Column() {
        this.toolRow('课表风格、配色与背景', '六种风格，浅色、深色背景分别设置', $r('sys.symbol.paintpalette'), '#DB2777', 'tools-style',
          () => this.onStyle())
        this.toolRow('桌面与锁屏服务卡片', '卡片风格、背景和上课闹钟', $r('sys.symbol.square_grid_2x2'), '#0284C7', 'tools-widgets',
          () => this.onWidgets())
        this.toolRow('应用外观', '跟随系统、浅色或深色', $r('sys.symbol.sun_max'), '#CA8A04', 'tools-appearance', () => this.onAppearance())
      }.width('100%').borderRadius(16).backgroundColor(this.softSurfaceColor()).clip(true)
    }.width('100%').padding({ left: 16, right: 16, top: 2, bottom: 28 })
    }.width('100%').scrollBar(BarState.Off).align(Alignment.Top)
      .constraintSize({ maxHeight: Math.max(200, this.pageHeight - 130) })
    }.width('100%').backgroundColor(this.surfaceColor())
  }

  @Builder
  private toolSection(title: string) {
    Text(title).fontSize(13).fontWeight(600).fontColor(this.secondaryColor()).width('100%').padding({ left: 4 }).margin({ bottom: -8 })
  }

  @Builder
  private toolTile(title: string, icon: Resource, tint: string, id: string, run: () => void) {
    Column({ space: 6 }) {
      SymbolGlyph(icon).fontSize(20).fontColor([tint])
      Text(title).fontSize(12).fontWeight(600).fontColor(this.textColor()).maxLines(1)
    }.layoutWeight(1).height(68).justifyContent(FlexAlign.Center).borderRadius(16).backgroundColor(this.softSurfaceColor())
      .id(id).accessibilityGroup(true).accessibilityText(title)
      .onClick(() => this.runTool(run))
  }

  @Builder
  private toolRow(title: string, detail: string, icon: Resource, tint: string, id: string, run: () => void) {
    Row({ space: 12 }) {
      Stack() { SymbolGlyph(icon).fontSize(17).fontColor(['#FFFFFF']) }
        .width(30).height(30).borderRadius(9).backgroundColor(tint)
      Column({ space: 2 }) {
        Text(title).fontSize(15).fontColor(this.textColor()).width('100%').maxLines(1)
        Text(detail).fontSize(11).fontColor(this.secondaryColor()).width('100%').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.layoutWeight(1)
      SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.secondaryColor()])
    }.width('100%').padding({ left: 14, right: 12, top: 10, bottom: 10 })
      .id(id).accessibilityGroup(true).accessibilityText(title + '，' + detail)
      .onClick(() => this.runTool(run))
  }

  // The tools sheet closes first; what opens next is usually another sheet.
  private runTool(run: () => void): void {
    this.toolsVisible = false;
    setTimeout(() => run(), 350);
  }

  // ---- The long-press menu and single meetings ----

  private handleMenu(action: string, block: NativeCourseBlock, shownDay: number, date: string): void {
    if (action === 'detail') {
      if (block.cancelled) this.askRestore(block);
      else this.openDetail(block, shownDay, '', date);
    } else if (action === 'edit') {
      this.onEdit(block);
    } else if (action === 'agenda') {
      this.store.agendaNew?.(date, this.store.blockStart(block));
    } else if (action === 'adjust') {
      this.occurrence.open(this.store, block, occurrenceKeysOf(block.course), date, undefined, [block.startSlot, block.endSlot]);
    } else if (action === 'cancel') {
      const name = block.course.name;
      const change: NativeOccurrenceChange = { key: '', date, cancelled: true };
      void this.store.changeOccurrence(occurrenceKeysOf(block.course), date, change).then((message: string) => {
        promptAction.showToast({ message: message || `「${name}」${occurrenceDateText(date)}停课，长按可恢复` });
      });
    } else if (action === 'readjust') {
      const key = block.course.occurrenceKey ?? '';
      const from = block.course.occurrenceFrom ?? '';
      const changes = this.store.occurrenceChanges ?? [];
      const keys = movedKeys(changes, key, from);
      const existing = changes.find((change: NativeOccurrenceChange) => change.key === key && change.date === from);
      this.occurrence.open(this.store, block, keys, from, existing, originalSlotsOf(this.store.result?.cells ?? [], keys));
    } else if (action === 'restore') {
      if (block.cancelled) this.restore(cancelledKeysOf(block), block.cancelled.date);
      else this.restore(movedKeys(this.store.occurrenceChanges ?? [], block.course.occurrenceKey ?? '', block.course.occurrenceFrom ?? ''),
        block.course.occurrenceFrom ?? '');
    }
  }

  private restore(keys: string[], date: string): void {
    void this.store.changeOccurrence(keys, date).then((message: string) => {
      promptAction.showToast({ message: message || '已恢复原安排' });
    });
  }

  // A cancelled meeting tapped: put it back?
  private askRestore(block: NativeCourseBlock): void {
    const change = block.cancelled;
    if (!change) return;
    AlertDialog.show({ title: `「${block.course.name}」这次停课`,
      message: `${occurrenceDateText(change.date)} 的这节课已停课；恢复后按原来的时间上课。`,
      primaryButton: { value: '取消', action: () => undefined },
      secondaryButton: { value: '恢复原安排', action: () => this.restore(cancelledKeysOf(block), change.date) } });
  }

  // `shownDay` is the weekday the course is shown on; on a make-up day it differs from the
  // weekday the course belongs to, which is what the editor uses.
  private openDetail(block: NativeCourseBlock, shownDay: number, peek: string = '', date: string = ''): void {
    if (block.cancelled && !peek.trim()) { this.askRestore(block); return; }
    this.detailPeek = peek;
    this.detailDate = date || this.store.shownRawDate(shownDay);
    this.detailStatus = block.course.occurrenceFrom ? `调课 · 原定 ${occurrenceDateText(block.course.occurrenceFrom)}` : '';
    this.detailBlock = block;
    this.detailName = block.course.name || '课程';
    this.detailTeacher = (block.course.teacher ?? '').trim();
    this.detailLocation = scheduleCleanLocation(block.course.location);
    this.detailWeeks = block.course.occurrenceFrom ? '' : (block.course.weeks ?? '').trim();
    this.detailNote = this.store.courseNote(block.course);
    this.detailCustom = block.course.custom === true || !!block.course.customId;
    this.detailOrphaned = block.course.orphaned === true;
    // "周三 · 第 5–6 节 · 13:30–15:10"
    // Each part stays on one line (no break inside 「第 9–10 节」 or 「16:00–17:45」); lines wrap between parts.
    this.detailSchedule = [scheduleWeekday(shownDay), scheduleSlotText(block.startSlot, block.endSlot),
      this.timeRange(block)].filter((value: string) => !!value)
      .map((value: string) => value.replace(/ /g, '\u00A0').replace(/[–-]/g, '\u2060–\u2060')).join(' · ');
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
