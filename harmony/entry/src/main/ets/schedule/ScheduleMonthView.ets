import { NativeCourseBlock, NativeScheduleAdjustment, NativeScheduleStore } from './NativeScheduleStore';
import { scheduleCardTone, ScheduleCourseTone } from './ScheduleVisuals';
import { scheduleAccent, scheduleSecondaryText, scheduleSurface, scheduleText, scheduleTint } from './ScheduleLayout';
import { PlacedCourseBlock, placeScheduleBlocks } from './SchedulePlacement';
import { buildScheduleMonth, scheduleAdjustmentText, ScheduleMonthDay, ScheduleMonthDayInfo, scheduleMonthRows,
  scheduleMonthSlotLabel, schedulePaperMonthTitle, scheduleSelectedDateTitle, scheduleShortCourseName } from './ScheduleMonth';
import { scheduleAlpha, scheduleCleanLocation, scheduleCourseAccent, scheduleCourseFill, scheduleMetaText,
  scheduleStyleAccent, scheduleStyleCanvas, scheduleStyleCellBorder, scheduleStyleCellSurface, scheduleStyleCourseColor,
  scheduleStyleFont, scheduleStyleInk, scheduleStyleLayout, scheduleStylePanelSurface, scheduleStyleTextFont,
  scheduleThemeFill, scheduleThemeText, scheduleTodayDate } from './ScheduleStyle';
import { calendarDayBadge, calendarDayLabel, ChineseCalendar, lunarFullLabel, OffDay,
  publishedHolidaysFromOffDays } from '../common/ChineseCalendar';
import { systemLunarDate } from '../common/SystemLunarCalendar';

const WEEKDAY_LABELS: string[] = ['一', '二', '三', '四', '五', '六', '日'];
const HOLIDAY_RED: string = '#E11D48';
const SWAP_ORANGE: string = '#C2410C';

// 月视图：课表界面的第三种视图，和「日」「周」共用同一个顶栏切换。不画节次网格，
// 而是一张日历：每天一格，格子里是公历日、农历/节日和当天课程的标记，下面跟着
// 所选那天的课程清单。六种课表风格各有自己的格子画法，数据都来自 ScheduleMonth.ets。
@Component
export struct ScheduleMonthView {
  @ObjectLink store: NativeScheduleStore;
  onCourse: (block: NativeCourseBlock, shownDay: number) => void = () => undefined;
  private lunar?: ChineseCalendar;
  private lunarKey: string = '';
  private cachedKey: string = '';
  private cachedDays: ScheduleMonthDay[] = [];
  // 上下拖动换月：格子跟着手指走的距离。
  @State private pull: number = 0;

  build() {
    Scroll() {
      Column({ space: this.store.visualStyle === 'classic' ? 12 : 0 }) {
        if (this.store.visualStyle === 'classic') {
          // The pan starts after 3 vp, sooner than the page's own scrolling, so a drag that
          // begins on the calendar turns the month instead of scrolling or pulling to refresh.
          Column() { this.classicGrid() }.width('100%')
            .translate({ y: this.pull }).opacity(this.pullOpacity())
            .gesture(PanGesture({ direction: PanDirection.Vertical, distance: 3 })
              .onActionUpdate((event: GestureEvent) => { this.pull = event.offsetY * 0.55; })
              .onActionEnd((event: GestureEvent) => this.finishPull(event.offsetY))
              .onActionCancel(() => this.finishPull(0)))
          this.summary()
        } else {
          Column() {
            Column() {
              if (this.store.visualStyle === 'minimal') this.minimalGrid()
              else this.styledGrid()
            }.width('100%')
              .translate({ y: this.pull }).opacity(this.pullOpacity())
              .gesture(PanGesture({ direction: PanDirection.Vertical, distance: 3 })
                .onActionUpdate((event: GestureEvent) => { this.pull = event.offsetY * 0.55; })
                .onActionEnd((event: GestureEvent) => this.finishPull(event.offsetY))
                .onActionCancel(() => this.finishPull(0)))
            // The table's frame already separates the calendar from the summary.
            if (this.store.visualStyle !== 'table') {
              Column().height(this.store.visualStyle === 'board' ? 2 : 0.7)
                .backgroundColor(this.store.visualStyle === 'board' ? scheduleAlpha(this.ink(), 0.65)
                  : scheduleAlpha(this.ink(), this.store.visualStyle === 'minimal' ? 0.12 : 0.24))
                .width('100%').margin({ left: this.store.visualStyle === 'board' ? 0 : 12, right: this.store.visualStyle === 'board' ? 0 : 12 })
            }
            this.summary()
          }.width('100%').backgroundColor(this.panelColor())
            .borderRadius(this.store.visualStyle === 'minimal' ? 20 : this.store.visualStyle === 'grid' ? 12 : 0)
            .border({ width: this.store.visualStyle === 'paper' ? 1.2 : this.store.visualStyle === 'board' ? 0 : this.store.visualStyle === 'table' ? 0.6 : 1,
              color: this.store.visualStyle === 'paper' ? scheduleAlpha(this.ink(), 0.6)
                : this.store.visualStyle === 'table' ? this.rule() : scheduleStyleCellBorder(this.store.dark),
              radius: this.store.visualStyle === 'minimal' ? 20 : this.store.visualStyle === 'grid' ? 12 : 0 })
        }
      }.width('100%').padding({ top: 4, bottom: 16 })
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
  }

  // ---- Classic ----

  @Builder
  private classicGrid() {
    Column({ space: 6 }) {
      Row({ space: 2 }) {
        Text('周').fontSize(10).fontWeight(600).fontColor(scheduleAlpha(this.secondary(), 0.7)).width(26).textAlign(TextAlign.Center)
        ForEach(WEEKDAY_LABELS, (label: string, index: number) => {
          Text(label).fontSize(12).fontWeight(600).layoutWeight(1).textAlign(TextAlign.Center)
            .fontColor(index >= 5 ? scheduleAlpha(this.holiday(), 0.8) : this.secondary())
        })
      }.width('100%')
      ForEach(scheduleMonthRows(this.days()), (row: ScheduleMonthDay[]) => {
        Row({ space: 2 }) {
          Text(this.rowWeek(row)).fontSize(10).fontWeight(600).fontColor(scheduleAlpha(this.secondary(), 0.7)).width(26).textAlign(TextAlign.Center)
          ForEach(row, (day: ScheduleMonthDay) => {
            Stack({ alignContent: Alignment.TopEnd }) {
              Column({ space: 1 }) {
                Text(String(day.number)).fontSize(16)
                  .fontWeight(day.date === this.store.selectedDate || day.date === this.today() ? FontWeight.Bold : FontWeight.Medium)
                  .fontColor(!day.inMonth ? scheduleAlpha(this.secondary(), 0.45)
                    : day.date === this.store.selectedDate || day.date === this.today() ? this.accent()
                    : day.isStatutoryHoliday ? this.holiday() : day.weekday >= 6 ? scheduleAlpha(this.holiday(), 0.85) : this.text())
                Text(day.subtitle || ' ').fontSize(9).fontWeight(day.isFestival ? FontWeight.Bold : FontWeight.Regular).maxLines(1)
                  .fontColor(day.isStatutoryHoliday ? this.holiday() : day.isFestival ? this.accent() : this.secondary())
                  .opacity(day.inMonth ? 1 : 0.4)
                this.courseDots(day)
              }.width('100%').height(50).justifyContent(FlexAlign.Center).borderRadius(10)
                .backgroundColor(day.date === this.store.selectedDate ? scheduleTint(this.accent(), 0.16) : Color.Transparent)
                .border({ width: day.date === this.today() && day.date !== this.store.selectedDate ? 1 : 0,
                  color: scheduleTint(this.accent(), 0.45), radius: 10 })
              this.badge(day, 13)
            }.layoutWeight(1).height(50)
              .accessibilityGroup(true).accessibilityText(this.spokenDay(day)).accessibilitySelected(day.date === this.store.selectedDate)
              .onClick(() => this.store.selectDate(day.date))
          }, (day: ScheduleMonthDay) => this.dayKey(day))
        }.width('100%')
      }, (row: ScheduleMonthDay[]) => this.rowKey(row))
    }.width('100%').padding({ top: 10, bottom: 10, left: 8, right: 8 }).borderRadius(8)
      .backgroundColor(scheduleSurface(this.store.dark, !!this.store.backgroundPath))
  }

  // ---- Minimal ----

  @Builder
  private minimalGrid() {
    Column({ space: 12 }) {
      Row({ space: 4 }) {
        ForEach(WEEKDAY_LABELS, (label: string) => {
          Text(label).fontSize(11).fontWeight(FontWeight.Medium).fontColor(scheduleMetaText(this.store.dark)).layoutWeight(1).textAlign(TextAlign.Center)
        })
      }.width('100%').height(16)
      Column({ space: 6 }) {
        ForEach(scheduleMonthRows(this.days()), (row: ScheduleMonthDay[]) => {
          Row({ space: 4 }) {
            ForEach(row, (day: ScheduleMonthDay) => {
              Column({ space: 3 }) {
                Stack({ alignContent: Alignment.TopEnd }) {
                  Text(String(day.number)).fontSize(18)
                    .fontWeight(day.date === this.store.selectedDate || day.date === this.today() ? FontWeight.Bold : FontWeight.Medium)
                    .fontColor(day.date === this.store.selectedDate ? '#FFFFFF' : !day.inMonth ? scheduleAlpha(scheduleMetaText(this.store.dark), 0.6)
                      : day.date === this.today() ? this.themeText() : day.weekday >= 6 ? scheduleMetaText(this.store.dark) : this.ink())
                    .width(30).height(30).textAlign(TextAlign.Center).borderRadius(15)
                    .backgroundColor(day.date === this.store.selectedDate ? scheduleThemeFill(this.store.palette) : Color.Transparent)
                    .border({ width: day.date === this.today() && day.date !== this.store.selectedDate ? 1 : 0, color: this.themeText(), radius: 15 })
                  Column() { this.badge(day, 12) }.margin({ top: -5, right: -5 })
                }.width(30).height(30)
                Text(day.subtitle || ' ').fontSize(10).fontWeight(day.isFestival ? FontWeight.Medium : FontWeight.Regular).maxLines(1)
                  .fontColor(day.isStatutoryHoliday ? this.holiday() : day.isFestival ? this.themeText() : scheduleMetaText(this.store.dark))
                  .opacity(day.inMonth ? 1 : 0.6)
                this.courseDots(day)
              }.layoutWeight(1).height(58).justifyContent(FlexAlign.Center)
                .accessibilityGroup(true).accessibilityText(this.spokenDay(day)).accessibilitySelected(day.date === this.store.selectedDate)
                .onClick(() => this.store.selectDate(day.date))
            }, (day: ScheduleMonthDay) => this.dayKey(day))
          }.width('100%')
        }, (row: ScheduleMonthDay[]) => this.rowKey(row))
      }.width('100%')
    }.width('100%').padding({ left: 10, right: 10, top: 14, bottom: 10 })
  }

  // ---- Grid, table, paper and board ----

  @Builder
  private styledGrid() {
    Column({ space: this.store.visualStyle === 'grid' ? 6 : 0 }) {
      if (this.store.visualStyle === 'paper') {
        Text(schedulePaperMonthTitle(this.store.monthAnchor)).fontSize(15).fontWeight(600).fontFamily('serif').fontColor(this.ink())
          .width('100%').height(30).padding({ left: 12, right: 12 })
      }
      Row() {
        ForEach(WEEKDAY_LABELS, (label: string, index: number) => {
          Text(label).fontSize(this.store.visualStyle === 'paper' ? 12 : 11)
            .fontWeight(this.store.visualStyle === 'board' ? FontWeight.Bold : FontWeight.Medium)
            .fontFamily(scheduleStyleFont(this.store.visualStyle)).fontColor(scheduleAlpha(this.ink(), index >= 5 ? 0.62 : 0.78))
            .layoutWeight(1).textAlign(TextAlign.Center)
        })
      }.width('100%').height(this.store.visualStyle === 'table' || this.store.visualStyle === 'board' ? 28 : 22)
        .backgroundColor(this.store.visualStyle === 'table' ? scheduleAlpha(this.ink(), this.store.dark ? 0.06 : 0.045) : Color.Transparent)
        .border({ width: { bottom: this.store.visualStyle === 'table' ? 0.6 : this.store.visualStyle === 'board' ? 2 : 0 },
          color: this.store.visualStyle === 'board' ? scheduleAlpha(this.ink(), 0.65) : this.rule() })
      if (this.store.visualStyle === 'paper') {
        Column().height(0.8).width('100%').backgroundColor(scheduleAlpha(this.ink(), 0.24))
      }
      Column({ space: this.store.visualStyle === 'grid' ? 5 : 0 }) {
        ForEach(scheduleMonthRows(this.days()), (row: ScheduleMonthDay[], rowIndex: number) => {
          Row({ space: this.store.visualStyle === 'grid' ? 5 : 0 }) {
            ForEach(row, (day: ScheduleMonthDay) => {
              Column() { this.styledCell(day) }.layoutWeight(1)
                .accessibilityGroup(true).accessibilityText(this.spokenDay(day)).accessibilitySelected(day.date === this.store.selectedDate)
                .onClick(() => this.store.selectDate(day.date))
            }, (day: ScheduleMonthDay) => this.dayKey(day))
          }.width('100%')
            // The board's last week sits on the heavy rule above the summary.
            .border({ width: { bottom: this.store.visualStyle === 'board' && rowIndex < scheduleMonthRows(this.days()).length - 1 ? 0.6 : 0 },
              color: scheduleAlpha(this.ink(), this.store.dark ? 0.24 : 0.16) })
        }, (row: ScheduleMonthDay[]) => this.rowKey(row))
      }.width('100%')
    }.width('100%')
      // The table's heading fill and rules have to meet its frame.
      .padding({ left: this.store.visualStyle === 'table' || this.store.visualStyle === 'board' ? 0 : 10,
        right: this.store.visualStyle === 'table' || this.store.visualStyle === 'board' ? 0 : 10,
        top: this.store.visualStyle === 'paper' ? 12 : this.store.visualStyle === 'table' ? 0 : 8,
        bottom: this.store.visualStyle === 'paper' ? 12 : this.store.visualStyle === 'table' ? 0 : 8 })
  }

  @Builder
  private styledCell(day: ScheduleMonthDay) {
    if (this.store.visualStyle === 'grid') {
      Stack({ alignContent: Alignment.TopEnd }) {
        Column({ space: 2 }) {
          this.dateNumber(day)
          Text(day.subtitle || ' ').fontSize(9).fontWeight(day.isFestival ? FontWeight.Medium : FontWeight.Regular).maxLines(1).fontColor(this.subtitleColor(day))
          this.courseDots(day)
        }.width('100%').height(62).justifyContent(FlexAlign.Center)
        Column() { this.badge(day, 12) }.margin(2)
      }.width('100%').height(62).opacity(day.inMonth ? 1 : 0.65)
        .borderRadius(scheduleStyleLayout('grid').cornerRadius)
        .backgroundColor(day.adjustmentKind === 'off' ? scheduleAlpha(this.holiday(), 0.14)
          : scheduleStyleCellSurface(!!this.store.backgroundPath, this.store.dark))
        .border({ radius: scheduleStyleLayout('grid').cornerRadius,
          width: day.date === this.today() || day.date === this.store.selectedDate ? scheduleStyleLayout('grid').borderWidth : 0.7,
          color: day.date === this.today() || day.date === this.store.selectedDate ? this.styleAccent() : this.rule() })
    } else if (this.store.visualStyle === 'table') {
      Column({ space: 2 }) {
        // The lunar date shares the date's line; on its own line a short cell could not fit two courses.
        Row({ space: 2 }) {
          this.dateNumber(day)
          this.badge(day, 12)
          if (day.subtitle) {
            Text(day.subtitle).fontSize(8).fontColor(this.subtitleColor(day)).maxLines(1).layoutWeight(1)
              .textOverflow({ overflow: TextOverflow.Clip })
          }
        }.width('100%').padding({ left: 3, right: 1, top: 3 })
        ForEach(day.courses.slice(0, 2), (block: NativeCourseBlock) => {
          Row({ space: 2 }) {
            Column().width(2).height(12).backgroundColor(this.courseAccent(block.course.name))
            Text(scheduleShortCourseName(block.course.name)).fontSize(9).fontWeight(600).fontColor(this.ink()).maxLines(1).layoutWeight(1)
          }.height(12).margin({ left: 2, right: 2 })
            .backgroundColor(scheduleCourseFill(scheduleStyleCourseColor(block.course.name, this.store.palette), this.store.dark, !!this.store.backgroundPath))
        })
        if (day.courses.length > 2) {
          Text('+' + (day.courses.length - 2)).fontSize(9).fontWeight(600).fontColor(scheduleAlpha(this.ink(), 0.7)).padding({ left: 4 }).width('100%')
        }
      }.width('100%').height(70).justifyContent(FlexAlign.Start).alignItems(HorizontalAlign.Start).opacity(day.inMonth ? 1 : 0.65)
        .backgroundColor(day.date === this.today() ? scheduleAlpha(this.styleAccent(), this.store.dark ? 0.18 : 0.10)
          : day.weekday >= 6 ? scheduleAlpha(this.ink(), 0.04) : Color.Transparent)
        // Each cell rules only its trailing and bottom edges, so a shared edge is drawn once.
        .border({ width: { right: day.weekday < 7 ? 0.6 : 0, bottom: 0.6 }, color: this.rule() })
    } else if (this.store.visualStyle === 'paper') {
      Column({ space: 1 }) {
        Stack({ alignContent: Alignment.TopEnd }) {
          this.dateNumber(day)
          Column() { this.badge(day, 12) }.margin({ top: -2, right: -7 })
        }
        Text(day.subtitle || ' ').fontSize(10).fontWeight(day.isFestival ? 600 : FontWeight.Regular).fontFamily('serif').maxLines(1)
          .fontColor(this.subtitleColor(day))
        // An ink stroke that grows with the number of courses.
        Column().height(1.5).margin({ top: 2 }).width(day.courses.length ? Math.min(24, 6 + day.courses.length * 4) : 8)
          .backgroundColor(scheduleAlpha(this.ink(), day.courses.length ? 0.62 : 0.18))
      }.width('100%').height(62).justifyContent(FlexAlign.Center).opacity(day.inMonth ? 1 : 0.65)
        .backgroundColor(day.date === this.store.selectedDate ? scheduleAlpha(this.styleAccent(), 0.08) : Color.Transparent)
        .border({ width: { bottom: day.date === this.store.selectedDate ? 2 : 0 }, color: this.styleAccent() })
    } else {
      Stack({ alignContent: Alignment.TopEnd }) {
        Column({ space: 3 }) {
          Text(String(day.number).padStart(2, '0')).fontSize(17).fontFamily('monospace')
            .fontWeight(day.date === this.today() || day.date === this.store.selectedDate ? FontWeight.Bold : 600)
            .decoration({ type: day.date === this.today() ? TextDecorationType.Underline : TextDecorationType.None })
            .fontColor(day.date === this.store.selectedDate ? this.canvasOrWhite() : this.ink())
          Text(day.courses.length ? `${day.courses.length} 门` : '—').fontSize(9).fontWeight(FontWeight.Medium).maxLines(1)
            .fontColor(day.date === this.store.selectedDate ? this.canvasOrWhite() : this.ink())
          Text(day.subtitle || ' ').fontSize(9).fontFamily('monospace').maxLines(1)
            .fontColor(day.date === this.store.selectedDate ? this.canvasOrWhite() : this.ink())
        }.width('100%').height(62).justifyContent(FlexAlign.Center)
        Column() { this.badge(day, 12) }.margin(2)
      }.width('100%').height(62).opacity(day.inMonth ? 1 : 0.65)
        .backgroundColor(day.date === this.store.selectedDate ? this.ink() : Color.Transparent)
    }
  }

  @Builder
  private dateNumber(day: ScheduleMonthDay) {
    Text(String(day.number)).fontSize(this.store.visualStyle === 'paper' ? 19 : this.store.visualStyle === 'table' ? 14 : 16)
      .fontWeight(day.date === this.store.selectedDate || day.date === this.today() ? FontWeight.Bold : FontWeight.Medium)
      .fontFamily(scheduleStyleFont(this.store.visualStyle)).fontColor(this.numberColor(day))
      .height(this.store.visualStyle === 'table' ? 22 : 30).textAlign(TextAlign.Center)
      .constraintSize({ minWidth: this.store.visualStyle === 'table' ? 18 : 32 })
      .padding({ left: this.store.visualStyle === 'table' ? 2 : 0, right: this.store.visualStyle === 'table' ? 2 : 0 })
      .borderRadius(this.store.visualStyle === 'paper' ? 15 : 4)
      .backgroundColor(day.date === this.store.selectedDate && this.store.visualStyle !== 'paper' ? this.selectedFill() : Color.Transparent)
      .border({ width: day.date === this.today() && this.store.visualStyle === 'paper' ? 1.3 : 0, color: this.styleAccent(), radius: 15 })
  }

  @Builder
  private courseDots(day: ScheduleMonthDay) {
    // 日期下面只画一条，和系统日历一样：一节课是一个点，课越多越长。
    Row() {
      if (day.courses.length > 0) {
        Column().width(day.courses.length === 1 ? 4 : Math.min(4, day.courses.length) * 5).height(4).borderRadius(2)
          .backgroundColor(scheduleAlpha(this.store.visualStyle === 'classic' ? this.accent() : this.themeText(), 0.85))
      }
    }.height(6).justifyContent(FlexAlign.Center).opacity(day.inMonth ? 1 : 0.5).accessibilityLevel('no')
  }

  // 拖过一段距离就换月，新的一页从拖来的那一边滑进来；不够就弹回去。
  private finishPull(offset: number): void {
    const delta = offset < 0 ? 1 : -1;
    if (Math.abs(offset) >= 44) {
      this.store.moveMonth(delta);
      this.pull = delta > 0 ? 36 : -36;
    }
    animateTo({ duration: 220, curve: Curve.EaseOut }, () => { this.pull = 0; });
  }

  private pullOpacity(): number {
    return 1 - Math.min(0.6, Math.abs(this.pull) / 86);
  }

  @Builder
  private badge(day: ScheduleMonthDay, size: number) {
    if (day.adjustmentKind) {
      if (this.store.visualStyle === 'paper' || this.store.visualStyle === 'board') {
        Text(day.adjustmentKind === 'off' ? '休' : '班').fontSize(9).fontWeight(FontWeight.Bold).fontFamily(scheduleStyleFont(this.store.visualStyle))
          .fontColor(day.adjustmentKind === 'off' ? this.canvasOrWhite() : this.ink()).width(size).height(size).textAlign(TextAlign.Center)
          .backgroundColor(day.adjustmentKind === 'off' ? this.styleAccent() : scheduleStyleCanvas(this.store.visualStyle, this.store.dark))
          .border({ width: day.adjustmentKind === 'off' ? 0 : 1, color: this.ink() }).accessibilityLevel('no')
      } else {
        Text(day.adjustmentKind === 'off' ? '休' : '班').fontSize(size - 4).fontWeight(600).fontColor('#FFFFFF')
          .width(size).height(size).textAlign(TextAlign.Center).borderRadius(3)
          .backgroundColor(day.adjustmentKind === 'off' ? HOLIDAY_RED : SWAP_ORANGE)
          .opacity(day.inMonth ? 1 : 0.45).accessibilityLevel('no')
      }
    }
  }

  // ---- Selected day ----

  @Builder
  private summary() {
    Column({ space: this.store.visualStyle === 'paper' ? 10 : 8 }) {
      Row({ space: 8 }) {
        Column({ space: 3 }) {
          Row({ space: 6 }) {
            Text(scheduleSelectedDateTitle(this.store.selectedDate)).fontSize(this.store.visualStyle === 'paper' ? 17 : 16)
              .fontWeight(this.store.visualStyle === 'board' ? FontWeight.Bold : 600)
              .fontFamily(scheduleStyleTextFont(this.store.visualStyle)).fontColor(this.inkOrText())
            if (this.store.selectedDate === this.today()) {
              Text(this.store.visualStyle === 'paper' ? '今日' : '今天').fontSize(10).fontWeight(FontWeight.Bold)
                .fontFamily(scheduleStyleFont(this.store.visualStyle))
                .fontColor(this.store.visualStyle === 'paper' || this.store.visualStyle === 'board' ? this.canvasOrWhite() : this.summaryAccent())
                .padding({ left: 5, right: 5, top: 2, bottom: 2 })
                .borderRadius(this.store.visualStyle === 'paper' || this.store.visualStyle === 'board' ? 0 : 9)
                .backgroundColor(this.store.visualStyle === 'board' ? this.ink() : this.store.visualStyle === 'paper' ? this.styleAccent()
                  : scheduleAlpha(this.summaryAccent(), 0.14))
            }
          }
          Text(this.selectedSubtitle()).fontSize(11).fontFamily(scheduleStyleTextFont(this.store.visualStyle))
            .fontColor(this.store.visualStyle === 'classic' ? this.secondary() : scheduleAlpha(this.ink(), 0.72))
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (this.store.dateSlot(this.store.selectedDate)) {
          Button('日视图').type(ButtonType.Capsule).height(30).fontSize(11).fontWeight(600).padding({ left: 12, right: 12 })
            .fontColor(this.store.visualStyle === 'board' ? scheduleAlpha(this.ink(), 0.72) : this.summaryAccent())
            .backgroundColor(scheduleAlpha(this.summaryAccent(), this.store.dark ? 0.18 : 0.1))
            .id('schedule-month-open-day').accessibilityText('在日视图查看这一天')
            .onClick(() => { this.store.openDate(this.store.selectedDate); })
        }
      }.width('100%').alignItems(VerticalAlign.Top)
      if (this.store.adjustmentOnDate(this.store.selectedDate)) {
        Text(this.selectedAdjustmentText()).fontSize(11).fontFamily(scheduleStyleTextFont(this.store.visualStyle)).width('100%')
          .fontColor(this.store.visualStyle === 'paper' || this.store.visualStyle === 'board' ? this.styleAccent()
            : this.store.adjustmentOnDate(this.store.selectedDate)?.kind === 'off' ? this.holiday() : SWAP_ORANGE)
      }
      if (this.emptyText()) {
        Text(this.emptyText()).fontSize(13).fontFamily(scheduleStyleTextFont(this.store.visualStyle)).width('100%').padding({ top: 6, bottom: 6 })
          .fontColor(this.store.visualStyle === 'classic' ? this.secondary() : scheduleAlpha(this.ink(), 0.72))
      } else {
        Column({ space: this.store.visualStyle === 'paper' ? 4 : 6 }) {
          ForEach(this.selectedCourses(), (block: PlacedCourseBlock) => { this.courseRow(block) })
        }.width('100%')
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
      .padding({ left: this.store.visualStyle === 'table' ? 10 : this.store.visualStyle === 'classic' ? 14 : 16,
        right: this.store.visualStyle === 'table' ? 10 : this.store.visualStyle === 'classic' ? 14 : 16, top: 14, bottom: 14 })
      .borderRadius(this.store.visualStyle === 'classic' ? 16 : 0)
      .backgroundColor(this.store.visualStyle === 'classic' ? scheduleSurface(this.store.dark, !!this.store.backgroundPath) : Color.Transparent)
  }

  @Builder
  private courseRow(block: PlacedCourseBlock) {
    if (this.store.visualStyle === 'classic') {
      Row({ space: 10 }) {
        Column().width(4).height(34).borderRadius(3).backgroundColor(this.classicAccent(block.course.name))
        Column({ space: 2 }) {
          Text(block.course.name).fontSize(14).fontWeight(600).fontColor(this.tone(block.course.name).text).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(this.metadata(block)).fontSize(12).fontColor(this.tone(block.course.name).text).opacity(0.85).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        }.layoutWeight(1)
        Column({ space: 1 }) {
          Text(this.store.slotStart(block.startSlot) || '--:--').fontSize(12).fontWeight(600).fontColor(this.tone(block.course.name).text)
          Text(this.store.slotEnd(block.endSlot) || '--:--').fontSize(12).fontWeight(600).fontColor(this.tone(block.course.name).text)
        }.alignItems(HorizontalAlign.End).opacity(0.85)
      }.width('100%').padding(10).borderRadius(12)
        .linearGradient({ angle: 180, colors: [[this.tone(block.course.name).top, 0], [this.tone(block.course.name).bottom, 1]] })
        .border({ width: 1, color: this.tone(block.course.name).border, radius: 12 })
        .accessibilityGroup(true).accessibilityText(this.spokenCourse(block))
        .onClick(() => this.select(block))
    } else if (this.store.visualStyle === 'minimal') {
      Row({ space: 10 }) {
        Column({ space: 3 }) {
          Text(block.course.name).fontSize(14).fontWeight(600).fontColor(this.courseAccent(block.course.name)).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(this.metadata(block)).fontSize(12).fontColor(this.courseAccent(block.course.name)).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        }.layoutWeight(1)
        Column({ space: 2 }) {
          Text(this.store.slotStart(block.startSlot) || '--:--').fontSize(12).fontWeight(600).fontColor(this.courseAccent(block.course.name))
          Text(this.store.slotEnd(block.endSlot) || '--:--').fontSize(10).fontColor(this.courseAccent(block.course.name))
        }.alignItems(HorizontalAlign.End)
      }.width('100%').padding({ left: 12, right: 12, top: 10, bottom: 10 }).borderRadius(12)
        .backgroundColor(scheduleCourseFill(scheduleStyleCourseColor(block.course.name, this.store.palette), this.store.dark, !!this.store.backgroundPath))
        .accessibilityGroup(true).accessibilityText(this.spokenCourse(block))
        .onClick(() => this.select(block))
    } else {
      Row({ space: 10 }) {
        Column({ space: 3 }) {
          Text(this.store.slotStart(block.startSlot) || '--:--').fontSize(14).fontWeight(600).fontFamily(scheduleStyleFont(this.store.visualStyle))
            .fontColor(this.store.visualStyle === 'board' ? this.canvasOrWhite() : this.ink())
          Text(this.store.slotEnd(block.endSlot) || '--:--').fontSize(10).fontFamily(scheduleStyleFont(this.store.visualStyle))
            .fontColor(this.store.visualStyle === 'board' ? this.canvasOrWhite() : this.ink())
        }.alignItems(this.store.visualStyle === 'board' ? HorizontalAlign.Start : HorizontalAlign.End)
          .padding(this.store.visualStyle === 'board' ? 6 : 0)
          .backgroundColor(this.store.visualStyle === 'board' ? this.ink() : Color.Transparent)
        Column().width(this.store.visualStyle === 'paper' ? 2 : 3).height(30).backgroundColor(this.courseAccent(block.course.name))
        Column({ space: 4 }) {
          Text(block.course.name).fontSize(16).fontWeight(600).fontFamily(scheduleStyleTextFont(this.store.visualStyle)).fontColor(this.ink())
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(this.metadata(block)).fontSize(13).fontFamily(scheduleStyleTextFont(this.store.visualStyle)).fontColor(scheduleAlpha(this.ink(), 0.74))
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        }.layoutWeight(1)
      }.width('100%').padding({ left: this.store.visualStyle === 'paper' ? 0 : 10, right: this.store.visualStyle === 'paper' ? 0 : 10, top: 10, bottom: 10 })
        .borderRadius(this.store.visualStyle === 'grid' ? scheduleStyleLayout('grid').cornerRadius : 0)
        .backgroundColor(this.store.visualStyle === 'grid'
          ? scheduleCourseFill(scheduleStyleCourseColor(block.course.name, this.store.palette), this.store.dark, !!this.store.backgroundPath)
          : this.store.visualStyle === 'table' ? scheduleAlpha(this.ink(), this.store.dark ? 0.06 : 0.035) : Color.Transparent)
        .border(this.store.visualStyle === 'grid'
          ? { width: scheduleStyleLayout('grid').borderWidth, color: this.courseAccent(block.course.name), radius: scheduleStyleLayout('grid').cornerRadius }
          : { width: { bottom: this.store.visualStyle === 'board' ? 1.5 : 0.6 }, color: this.rule() })
        .accessibilityGroup(true).accessibilityText(this.spokenCourse(block))
        .onClick(() => this.select(block))
    }
  }

  // ---- Data ----

  private today(): string { return scheduleTodayDate(Date.now()); }

  private chinese(): ChineseCalendar {
    // 服务端在校历里给出的放假日优先于内置的法定假日推算。
    const offDays: OffDay[] = (this.store.calendar?.adjustments ?? [])
      .filter((item: NativeScheduleAdjustment) => item.kind === 'off')
      .map((item: NativeScheduleAdjustment): OffDay => ({ date: item.date, note: item.note ?? '' }));
    const key = JSON.stringify(offDays);
    if (!this.lunar || key !== this.lunarKey) {
      this.lunar = new ChineseCalendar(systemLunarDate, publishedHolidaysFromOffDays(offDays));
      this.lunarKey = key;
    }
    return this.lunar;
  }

  // 每月的农历与课程只构建一次；key 里读到的状态变了才重建。
  private days(): ScheduleMonthDay[] {
    const anchor = this.store.monthAnchor || this.today();
    const key = [anchor.substring(0, 7), this.store.selectedSemester, this.store.dataRevision, this.store.priorityRevision,
      this.store.status, this.store.result ? this.store.result.cells.length : -1, this.store.calendar?.weeks?.length ?? 0].join('|');
    if (key === this.cachedKey) return this.cachedDays;
    const chinese = this.chinese();
    this.cachedDays = buildScheduleMonth(anchor,
      (date: string): ScheduleMonthDayInfo => {
        const info = chinese.info(date);
        return { subtitle: info ? calendarDayLabel(info) : '', isFestival: !!info && calendarDayBadge(info) !== '',
          isStatutoryHoliday: !!info && info.holiday !== '' };
      },
      (date: string): number => this.store.dateSlot(date)?.week ?? 0,
      (date: string): string => this.store.adjustmentOnDate(date)?.kind ?? '',
      (date: string): NativeCourseBlock[] => this.store.blocksOnDate(date));
    this.cachedKey = key;
    return this.cachedDays;
  }

  private selectedCourses(): PlacedCourseBlock[] {
    // 读一下 dataRevision，课表数据变了这里也要重算。
    return this.store.dataRevision >= 0
      ? placeScheduleBlocks(this.store.blocksOnDate(this.store.selectedDate), this.store.displayPriorities()) : [];
  }

  private emptyText(): string {
    if (!this.store.dateSlot(this.store.selectedDate)) return '这一天不在当前学期的教学周内。';
    if (this.selectedCourses().length) return '';
    return this.store.adjustmentOnDate(this.store.selectedDate)?.kind === 'off' ? '这一天放假，没有课程。' : '这一天没有课程。';
  }

  private selectedAdjustmentText(): string {
    const adjustment = this.store.adjustmentOnDate(this.store.selectedDate);
    return adjustment ? scheduleAdjustmentText(adjustment) : '';
  }

  // "第 5 周 · 八月廿六 · 中秋节"
  private selectedSubtitle(): string {
    const parts: string[] = [];
    const slot = this.store.dateSlot(this.store.selectedDate);
    if (slot) parts.push(`第 ${slot.week} 周`);
    const info = this.chinese().info(this.store.selectedDate);
    if (info?.lunar) parts.push(lunarFullLabel(info.lunar));
    if (info && calendarDayBadge(info)) parts.push(calendarDayBadge(info));
    return parts.join(' · ');
  }

  private select(block: PlacedCourseBlock): void {
    const day = this.store.dateSlot(this.store.selectedDate)?.day ?? block.day;
    this.onCourse(block.whole, day);
  }

  private metadata(block: PlacedCourseBlock): string {
    return [scheduleCleanLocation(block.course.location), (block.course.teacher ?? '').trim(),
      scheduleMonthSlotLabel(block.startSlot, block.endSlot)].filter((value: string) => !!value).join(' · ');
  }

  private rowWeek(row: ScheduleMonthDay[]): string {
    const day = row.find((item: ScheduleMonthDay) => item.week > 0);
    return day ? String(day.week) : '';
  }

  private rowKey(row: ScheduleMonthDay[]): string {
    return row.map((day: ScheduleMonthDay) => this.dayKey(day)).join(',');
  }

  private dayKey(day: ScheduleMonthDay): string {
    return [day.date, day.inMonth ? 1 : 0, day.week, day.subtitle, day.adjustmentKind,
      day.courses.map((block: NativeCourseBlock) => block.course.name).join('/')].join('|');
  }

  private spokenDay(day: ScheduleMonthDay): string {
    const parts: string[] = [`${day.number} 日`];
    if (day.subtitle) parts.push(day.subtitle);
    if (day.week) parts.push(`第 ${day.week} 周`);
    if (day.adjustmentKind) parts.push(day.adjustmentKind === 'off' ? '放假' : '补班');
    parts.push(day.courses.length ? `${day.courses.length} 门课程` : '没有课程');
    return parts.join('，');
  }

  private spokenCourse(block: PlacedCourseBlock): string {
    return [block.course.name, this.metadata(block), `${this.store.slotStart(block.startSlot)} 至 ${this.store.slotEnd(block.endSlot)}`].join('，');
  }

  // ---- Colours ----

  private text(): string { return scheduleText(this.store.dark); }
  private secondary(): string { return scheduleSecondaryText(this.store.dark); }
  private accent(): string { return scheduleAccent(this.store.palette, this.store.dark); }
  private ink(): string { return scheduleStyleInk(this.store.visualStyle, this.store.dark); }
  private inkOrText(): string { return this.store.visualStyle === 'classic' ? this.text() : this.ink(); }
  private themeText(): string { return scheduleThemeText(this.store.palette, this.store.dark); }
  private styleAccent(): string { return scheduleStyleAccent(this.store.visualStyle, this.store.dark, this.themeText()); }
  private summaryAccent(): string { return this.store.visualStyle === 'classic' ? this.accent() : this.styleAccent(); }
  private canvasOrWhite(): string { return scheduleStyleCanvas(this.store.visualStyle, this.store.dark) || '#FFFFFF'; }
  private rule(): string { return scheduleAlpha(this.ink(), 0.24); }
  // A statutory holiday's name. The badge red is too dim on the dark canvas, so dark uses a lighter pink.
  private holiday(): string { return this.store.dark ? '#FF8CA6' : HOLIDAY_RED; }
  private selectedFill(): string {
    if (this.store.visualStyle === 'board') return '#00000000';
    return this.store.visualStyle === 'grid' || this.store.visualStyle === 'table' ? scheduleThemeFill(this.store.palette) : this.styleAccent();
  }
  private numberColor(day: ScheduleMonthDay): string {
    if (day.date === this.store.selectedDate && this.store.visualStyle !== 'paper' && this.store.visualStyle !== 'board') return '#FFFFFF';
    if (day.date === this.today() && this.store.visualStyle !== 'board') return this.styleAccent();
    if (day.adjustmentKind === 'off' || day.isStatutoryHoliday) return this.store.visualStyle === 'paper' ? this.styleAccent() : this.holiday();
    return this.ink();
  }
  private subtitleColor(day: ScheduleMonthDay): string {
    if (day.isStatutoryHoliday) return this.store.visualStyle === 'paper' ? this.styleAccent() : this.holiday();
    if (day.isFestival || day.date === this.today()) return this.styleAccent();
    return scheduleAlpha(this.ink(), 0.72);
  }
  private courseAccent(name: string): string {
    return scheduleCourseAccent(scheduleStyleCourseColor(name, this.store.palette), this.store.dark);
  }
  private classicAccent(name: string): string { return scheduleCardTone(name, this.store.palette, this.store.dark).border; }
  private tone(name: string): ScheduleCourseTone { return scheduleCardTone(name, this.store.palette, this.store.dark); }
  private panelColor(): string {
    const canvas = scheduleStyleCanvas(this.store.visualStyle, this.store.dark);
    if (canvas) return this.store.backgroundPath ? scheduleAlpha(canvas, 0.96) : canvas;
    return scheduleStylePanelSurface(!!this.store.backgroundPath, this.store.dark, this.store.backgroundOpacity);
  }
}
