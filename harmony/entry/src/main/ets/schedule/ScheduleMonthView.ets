import { NativeCourseBlock, NativeScheduleAdjustment, NativeScheduleStore } from './NativeScheduleStore';
import { scheduleCardTone } from './ScheduleVisuals';
import { scheduleAccent, scheduleSecondaryText, scheduleSurface, scheduleText } from './ScheduleLayout';
import { buildScheduleMonth, ScheduleMonthDay, ScheduleMonthDayInfo, scheduleMonthCourseLines, scheduleMonthCourseNames,
  scheduleMonthRows, schedulePaperMonthTitle } from './ScheduleMonth';
import { scheduleAlpha, scheduleCourseAccent, scheduleCourseFill, scheduleMetaText, scheduleStyleAccent, scheduleStyleCanvas,
  scheduleStyleCellBorder, scheduleStyleCellSurface, scheduleStyleCourseColor, scheduleStyleFont, scheduleStyleInk,
  scheduleStyleLayout, scheduleStylePanelSurface, scheduleStyleTextFont, scheduleThemeFill, scheduleThemeText,
  scheduleTodayDate } from './ScheduleStyle';
import { calendarDayBadge, calendarDayLabel, ChineseCalendar, OffDay, publishedHolidaysFromOffDays } from '../common/ChineseCalendar';
import { systemLunarDate } from '../common/SystemLunarCalendar';
import { NativeScheduleCoupleModel } from './NativeScheduleCouple';
import { couplePersonTone } from './ScheduleCouple';

const WEEKDAY_LABELS: string[] = ['一', '二', '三', '四', '五', '六', '日'];
const HOLIDAY_RED: string = '#E11D48';
const SWAP_ORANGE: string = '#C2410C';
// How many lines of courses a day's cell holds; with more, the last line is "+N".
const COURSE_LINES: number = 3;

// 月视图：课表界面的第三种视图，和「日」「周」共用同一个顶栏切换。不画节次网格，而是一张
// 日历：每天一格，格子里是公历日、农历或节日，下面直接列出当天的课，一门一行，放不下的收成
// 「+N」；点一天进入那天的日视图。开着情侣课表时，自己的课统一用自己的颜色，每天最下面多一行
// 「TA N 门」。六种课表风格只在月历的边框和表头上有区别，数据都来自 ScheduleMonth.ets。
@Component
export struct ScheduleMonthView {
  @ObjectLink store: NativeScheduleStore;
  // The couple timetable; a read-only shared timetable gets one that is not bound.
  @ObjectLink couple: NativeScheduleCoupleModel;
  onCourse: (block: NativeCourseBlock, shownDay: number) => void = () => undefined;
  private lunar?: ChineseCalendar;
  private lunarKey: string = '';
  private cachedKey: string = '';
  private cachedDays: ScheduleMonthDay[] = [];
  // 上下拖动换月：格子跟着手指走的距离。
  @State private pull: number = 0;

  build() {
    Scroll() {
      Column() {
        // The pan starts after 3 vp, sooner than the page's own scrolling, so a drag that begins
        // on the calendar turns the month instead of scrolling or pulling to refresh.
        Column() {
          if (this.store.visualStyle === 'classic') this.classicGrid()
          else this.styledGrid()
        }.width('100%')
          .translate({ y: this.pull }).opacity(this.pullOpacity())
          .gesture(PanGesture({ direction: PanDirection.Vertical, distance: 3 })
            .onActionUpdate((event: GestureEvent) => { this.pull = event.offsetY * 0.55; })
            .onActionEnd((event: GestureEvent) => this.finishPull(event.offsetY))
            .onActionCancel(() => this.finishPull(0)))
          .backgroundColor(this.store.visualStyle === 'classic' ? Color.Transparent : this.panelColor())
          .borderRadius(this.store.visualStyle === 'minimal' ? 20 : this.store.visualStyle === 'grid' ? 12 : 0)
          .border({ width: this.store.visualStyle === 'classic' || this.store.visualStyle === 'board' ? 0
            : this.store.visualStyle === 'paper' ? 1.2 : this.store.visualStyle === 'table' ? 0.6 : 1,
            color: this.store.visualStyle === 'paper' ? scheduleAlpha(this.ink(), 0.6)
              : this.store.visualStyle === 'table' ? this.rule() : scheduleStyleCellBorder(this.store.dark),
            radius: this.store.visualStyle === 'minimal' ? 20 : this.store.visualStyle === 'grid' ? 12 : 0 })
      }.width('100%').padding({ top: 4, bottom: 16 })
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
  }

  // ---- Classic: the teaching week in a gutter, on a glass panel ----

  @Builder
  private classicGrid() {
    Column({ space: 4 }) {
      Row({ space: 2 }) {
        Text('周').fontSize(10).fontWeight(600).fontColor(scheduleAlpha(this.secondary(), 0.7)).width(22).textAlign(TextAlign.Center)
        ForEach(WEEKDAY_LABELS, (label: string, index: number) => {
          Text(label).fontSize(12).fontWeight(600).layoutWeight(1).textAlign(TextAlign.Center)
            .fontColor(index >= 5 ? scheduleAlpha(this.holiday(), 0.8) : this.secondary())
        })
      }.width('100%')
      ForEach(scheduleMonthRows(this.days()), (row: ScheduleMonthDay[]) => {
        Row({ space: 2 }) {
          Text(this.rowWeek(row)).fontSize(10).fontWeight(600).fontColor(scheduleAlpha(this.secondary(), 0.7)).width(22)
            .textAlign(TextAlign.Center).margin({ top: 8 })
          ForEach(row, (day: ScheduleMonthDay) => {
            Column() { this.dayCell(day) }.layoutWeight(1)
          }, (day: ScheduleMonthDay) => this.dayKey(day))
        }.width('100%').alignItems(VerticalAlign.Top)
      }, (row: ScheduleMonthDay[]) => this.rowKey(row))
    }.width('100%').padding({ top: 10, bottom: 10, left: 6, right: 6 }).borderRadius(12)
      .backgroundColor(scheduleSurface(this.store.dark, !!this.store.backgroundPath))
  }

  // ---- Minimal, grid, table, paper and board: the same cells in the style's frame ----

  @Builder
  private styledGrid() {
    Column({ space: this.store.visualStyle === 'grid' || this.store.visualStyle === 'minimal' ? 6 : 0 }) {
      if (this.store.visualStyle === 'paper') {
        Text(schedulePaperMonthTitle(this.store.monthAnchor)).fontSize(15).fontWeight(600).fontFamily('serif').fontColor(this.ink())
          .width('100%').height(30).padding({ left: 12, right: 12 })
      }
      Row({ space: this.cellGap() }) {
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
      Column({ space: this.cellGap() }) {
        ForEach(scheduleMonthRows(this.days()), (row: ScheduleMonthDay[], rowIndex: number) => {
          Row({ space: this.cellGap() }) {
            ForEach(row, (day: ScheduleMonthDay) => {
              Column() { this.dayCell(day) }.layoutWeight(1)
                .borderRadius(this.store.visualStyle === 'grid' ? scheduleStyleLayout('grid').cornerRadius : 0)
                .backgroundColor(this.cellBackground(day))
                // The grid frames every day; the table rules each cell's trailing and bottom edges once.
                .border(this.store.visualStyle === 'grid'
                  ? { radius: scheduleStyleLayout('grid').cornerRadius, width: day.date === this.today() ? scheduleStyleLayout('grid').borderWidth : 0.7,
                    color: day.date === this.today() ? this.styleAccent() : this.rule() }
                  : { width: { right: this.store.visualStyle === 'table' && day.weekday < 7 ? 0.6 : 0,
                    bottom: this.store.visualStyle === 'table' ? 0.6 : 0 }, color: this.rule() })
            }, (day: ScheduleMonthDay) => this.dayKey(day))
          }.width('100%').alignItems(VerticalAlign.Top)
            // Minimal and the board rule their weeks apart with a hairline.
            .border({ width: { bottom: (this.store.visualStyle === 'board' || this.store.visualStyle === 'minimal' || this.store.visualStyle === 'paper')
              && rowIndex < scheduleMonthRows(this.days()).length - 1 ? 0.6 : 0 },
              color: scheduleAlpha(this.ink(), this.store.dark ? 0.2 : 0.12) })
        }, (row: ScheduleMonthDay[]) => this.rowKey(row))
      }.width('100%')
    }.width('100%')
      // The table's heading fill and rules have to meet its frame.
      .padding({ left: this.store.visualStyle === 'table' || this.store.visualStyle === 'board' ? 0 : 8,
        right: this.store.visualStyle === 'table' || this.store.visualStyle === 'board' ? 0 : 8,
        top: this.store.visualStyle === 'paper' ? 12 : this.store.visualStyle === 'table' ? 0 : 10,
        bottom: this.store.visualStyle === 'paper' ? 12 : this.store.visualStyle === 'table' ? 0 : 8 })
  }

  // ---- One day ----

  @Builder
  private dayCell(day: ScheduleMonthDay) {
    Stack({ alignContent: Alignment.TopEnd }) {
      Column({ space: 1 }) {
        // Today: the date sits in a disc of the theme colour.
        Text(this.store.visualStyle === 'board' ? String(day.number).padStart(2, '0') : String(day.number))
          .fontSize(14).fontWeight(day.date === this.today() ? FontWeight.Bold : FontWeight.Medium)
          .fontFamily(this.store.visualStyle === 'classic' ? 'HarmonyOS Sans' : scheduleStyleFont(this.store.visualStyle))
          .fontColor(this.numberColor(day)).width(22).height(22).textAlign(TextAlign.Center)
          .borderRadius(this.store.visualStyle === 'board' || this.store.visualStyle === 'table' ? 0 : 11)
          .backgroundColor(day.date === this.today() ? this.todayFill() : Color.Transparent)
        Text(day.subtitle || ' ').fontSize(9).fontWeight(day.isFestival ? FontWeight.Bold : FontWeight.Regular).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Clip }).fontColor(this.subtitleColor(day))
        ForEach(scheduleMonthCourseLines(scheduleMonthCourseNames(day.courses), COURSE_LINES).shown, (name: string) => {
          Text(name).fontSize(10).fontWeight(600).fontFamily(this.store.visualStyle === 'classic' ? 'HarmonyOS Sans' : scheduleStyleTextFont(this.store.visualStyle))
            .fontColor(this.lineInk(name)).maxLines(1).textOverflow({ overflow: TextOverflow.Clip }).wordBreak(WordBreak.BREAK_ALL)
            .width('100%').height(14).padding({ left: 2, right: 1 })
            .borderRadius(this.store.visualStyle === 'classic' || this.store.visualStyle === 'minimal' || this.store.visualStyle === 'grid' ? 3 : 0)
            .backgroundColor(this.lineFill(name))
        }, (name: string) => name)
        if (scheduleMonthCourseLines(scheduleMonthCourseNames(day.courses), COURSE_LINES).more > 0) {
          Text('+' + scheduleMonthCourseLines(scheduleMonthCourseNames(day.courses), COURSE_LINES).more).fontSize(9).fontWeight(600)
            .fontColor(this.metaColor()).width('100%').height(12).padding({ left: 3 })
        }
        // The partner's day is one line of its own: how many courses they have.
        if (this.partnerCount(day) > 0) {
          Text(`TA ${this.partnerCount(day)} 门`).fontSize(10).fontWeight(600).maxLines(1).textAlign(TextAlign.Center)
            .fontColor(couplePersonTone(this.couple.status.partner.color, this.store.dark).text)
            .width('100%').height(14).borderRadius(7).margin({ top: 1 })
            .backgroundColor(couplePersonTone(this.couple.status.partner.color, this.store.dark).fill)
        }
      }.width('100%').height(this.couple.showing() ? 106 : 90).justifyContent(FlexAlign.Start).alignItems(HorizontalAlign.Center)
        .padding({ top: 3, left: 1, right: 1 })
      this.badge(day, 12)
    }.width('100%').opacity(day.inMonth ? 1 : 0.45)
      .accessibilityGroup(true).accessibilityText(this.spokenDay(day))
      .id(day.date === this.today() ? 'schedule-month-today' : '')
      // A day of the term opens as that day; any other one is only picked.
      .onClick(() => { if (!this.store.openDate(day.date)) this.store.selectDate(day.date); })
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
          .backgroundColor(day.adjustmentKind === 'off' ? HOLIDAY_RED : SWAP_ORANGE).accessibilityLevel('no')
      }
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

  // How many different courses the partner has that day; 0 while the couple timetable is off.
  private partnerCount(day: ScheduleMonthDay): number {
    return this.couple.showing() ? scheduleMonthCourseNames(this.couple.blocksOn(day.date)).length : 0;
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
      day.courses.map((block: NativeCourseBlock) => block.course.name).join('/'), this.partnerCount(day), this.couple.revision].join('|');
  }

  private spokenDay(day: ScheduleMonthDay): string {
    const parts: string[] = [`${day.number} 日`];
    if (day.subtitle) parts.push(day.subtitle);
    if (day.week) parts.push(`第 ${day.week} 周`);
    if (day.adjustmentKind) parts.push(day.adjustmentKind === 'off' ? '放假' : '补班');
    const names = scheduleMonthCourseNames(day.courses);
    parts.push(names.length ? `${names.length} 门课程：${names.join('、')}` : '没有课程');
    if (this.partnerCount(day) > 0) parts.push(`TA ${this.partnerCount(day)} 门课`);
    return parts.join('，');
  }

  // ---- Colours ----

  private text(): string { return scheduleText(this.store.dark); }
  private secondary(): string { return scheduleSecondaryText(this.store.dark); }
  private accent(): string { return scheduleAccent(this.store.palette, this.store.dark); }
  private ink(): string { return scheduleStyleInk(this.store.visualStyle, this.store.dark); }
  private themeText(): string { return scheduleThemeText(this.store.palette, this.store.dark); }
  private styleAccent(): string { return scheduleStyleAccent(this.store.visualStyle, this.store.dark, this.themeText()); }
  private canvasOrWhite(): string { return scheduleStyleCanvas(this.store.visualStyle, this.store.dark) || '#FFFFFF'; }
  private rule(): string { return scheduleAlpha(this.ink(), 0.24); }
  private cellGap(): number { return this.store.visualStyle === 'grid' ? 4 : this.store.visualStyle === 'minimal' ? 2 : 0; }
  // A statutory holiday's name. The badge red is too dim on the dark canvas, so dark uses a lighter pink.
  private holiday(): string { return this.store.dark ? '#FF8CA6' : HOLIDAY_RED; }
  private metaColor(): string {
    return this.store.visualStyle === 'classic' ? this.secondary() : scheduleAlpha(this.ink(), 0.7);
  }
  private todayFill(): string {
    if (this.store.visualStyle === 'classic') return this.accent();
    return this.store.visualStyle === 'paper' || this.store.visualStyle === 'board' ? this.styleAccent() : scheduleThemeFill(this.store.palette);
  }
  private numberColor(day: ScheduleMonthDay): string {
    if (day.date === this.today()) return this.store.visualStyle === 'paper' || this.store.visualStyle === 'board' ? this.canvasOrWhite() : '#FFFFFF';
    if (day.adjustmentKind === 'off' || day.isStatutoryHoliday) return this.store.visualStyle === 'paper' ? this.styleAccent() : this.holiday();
    if (this.store.visualStyle === 'classic') return day.weekday >= 6 ? scheduleAlpha(this.holiday(), 0.85) : this.text();
    return this.ink();
  }
  private subtitleColor(day: ScheduleMonthDay): string {
    if (day.isStatutoryHoliday) return this.store.visualStyle === 'paper' ? this.styleAccent() : this.holiday();
    if (this.store.visualStyle === 'classic') return day.isFestival ? this.accent() : this.secondary();
    if (day.isFestival) return this.styleAccent();
    return scheduleMetaText(this.store.dark);
  }
  private cellBackground(day: ScheduleMonthDay): ResourceColor {
    if (this.store.visualStyle === 'grid') {
      return day.adjustmentKind === 'off' ? scheduleAlpha(this.holiday(), 0.14) : scheduleStyleCellSurface(!!this.store.backgroundPath, this.store.dark);
    }
    if (this.store.visualStyle === 'table') {
      return day.date === this.today() ? scheduleAlpha(this.styleAccent(), this.store.dark ? 0.18 : 0.10)
        : day.weekday >= 6 ? scheduleAlpha(this.ink(), 0.04) : Color.Transparent;
    }
    return Color.Transparent;
  }
  // One course's line: its own colour, or the user's couple colour while the partner's courses are shown.
  private lineFill(name: string): string {
    if (this.couple.showing()) return couplePersonTone(this.couple.status.me.color, this.store.dark).fill;
    if (this.store.visualStyle === 'classic') return scheduleCardTone(name, this.store.palette, this.store.dark).top;
    return scheduleCourseFill(scheduleStyleCourseColor(name, this.store.palette), this.store.dark, !!this.store.backgroundPath);
  }
  private lineInk(name: string): string {
    if (this.couple.showing()) return couplePersonTone(this.couple.status.me.color, this.store.dark).text;
    if (this.store.visualStyle === 'classic') return scheduleCardTone(name, this.store.palette, this.store.dark).text;
    return this.store.visualStyle === 'paper' || this.store.visualStyle === 'board' ? this.ink()
      : scheduleCourseAccent(scheduleStyleCourseColor(name, this.store.palette), this.store.dark);
  }
  private panelColor(): string {
    const canvas = scheduleStyleCanvas(this.store.visualStyle, this.store.dark);
    if (canvas) return this.store.backgroundPath ? scheduleAlpha(canvas, 0.96) : canvas;
    return scheduleStylePanelSurface(!!this.store.backgroundPath, this.store.dark, this.store.backgroundOpacity);
  }
}
