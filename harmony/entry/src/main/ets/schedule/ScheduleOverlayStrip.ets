import { NativeCalendarWeek, NativeCourseBlock, NativeScheduleStore } from './NativeScheduleStore';
import { NativeScheduleCoupleModel } from './NativeScheduleCouple';
import { OverlayStripCard, overlayStripCards, overlayStripDayCount, overlayStripLeading } from './ScheduleOverlay';
import { CourseMenuAction, courseMenuActions } from './ScheduleOccurrences';
import { scheduleAlpha, scheduleCleanLocation, scheduleCourseAccent, scheduleCourseFill, scheduleMetaText, scheduleNowOffset,
  scheduleStyleCanvas, scheduleStyleCellBorder, scheduleStyleCourseColor, scheduleStyleInk, scheduleStyleLayout,
  scheduleStylePanelSurface, scheduleStyleTextFont, scheduleThemeFill, scheduleThemeText, scheduleThemeTint,
  scheduleTodayDate, scheduleWeekday } from './ScheduleStyle';
import { scheduleSecondaryText, scheduleText } from './ScheduleLayout';

// The week view while somebody else's timetable is laid over the user's (the partner's, or a shared
// one): NapTable's strip of consecutive days, each split into the user's own column and a column of
// the other person's courses as hollow outlined cards (iOS ScheduleOverlayStrip). The period axis
// stays put while the days slide past one at a time; the leftmost day is the browsing position the
// week title, the arrows and 回到本周今日 follow.

const HEADER: number = 46;
const GAP: number = 3;
const DAY_GAP: number = 4;
const COLUMN_GAP: number = 2;

class StripDates implements IDataSource {
  private dates: string[] = [];
  private listeners: DataChangeListener[] = [];

  constructor(dates: string[]) { this.dates = dates; }

  totalCount(): number { return this.dates.length; }

  getData(index: number): string { return this.dates[index]; }

  registerDataChangeListener(listener: DataChangeListener): void {
    if (!this.listeners.includes(listener)) this.listeners.push(listener);
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  replace(dates: string[]): void {
    this.dates = dates;
    this.listeners.forEach((listener: DataChangeListener) => listener.onDataReloaded());
  }
}

@Component
export struct ScheduleOverlayStrip {
  @ObjectLink store: NativeScheduleStore;
  @ObjectLink couple: NativeScheduleCoupleModel;
  @Prop pageWidth: number = 360;
  @Prop contentHeight: number = 540;
  // The date the page has selected; the strip keeps it at its left edge.
  @Prop @Watch('follow') selection: string = '';
  // Goes up when the term or the other person's timetable changes.
  @Prop @Watch('reload') revision: string = '';
  onCourse: (block: NativeCourseBlock, shownDay: number, date: string) => void = () => undefined;
  onPeek: (block: NativeCourseBlock, shownDay: number, note: string) => void = () => undefined;
  onMenu: (action: string, block: NativeCourseBlock, shownDay: number, date: string) => void = () => undefined;
  onOpenDay: (date: string) => void = () => undefined;
  private scroller: Scroller = new Scroller();
  private source: StripDates = new StripDates([]);
  private leading: number = 0;
  // A day the user slid to and reported: until the page's selection names it, other selections are
  // the halfway states of storing a weekday and a week one after the other.
  private reported: string = '';
  private reportedAt: number = 0;

  aboutToAppear(): void {
    this.source = new StripDates(this.dates());
    this.leading = overlayStripLeading(this.selection, this.dates(), this.count());
  }

  build() {
    Column() {
      Row() {
        this.axis()
        List({ scroller: this.scroller, initialIndex: this.leading }) {
          LazyForEach(this.source, (date: string) => {
            ListItem() { this.dayView(date) }.width(this.dayWidth())
          }, (date: string) => date)
        }.listDirection(Axis.Horizontal).scrollBar(BarState.Off).edgeEffect(EdgeEffect.None)
          .scrollSnapAlign(ScrollSnapAlign.START).cachedCount(2)
          .width(this.innerWidth() - this.axisWidth()).height(HEADER + this.gridHeight())
          .onScrollIndex((start: number) => { this.leading = start; })
          .onScrollStop(() => this.report())
          .id('schedule-overlay-strip')
      }.width(this.innerWidth()).alignItems(VerticalAlign.Top)
    }.width('100%').padding(this.store.visualStyle === 'classic' ? 0 : 4)
      .backgroundColor(this.store.visualStyle === 'classic' ? Color.Transparent : this.panelColor())
      .borderRadius(this.store.visualStyle === 'classic' ? 0 : 16)
  }

  // ---- The fixed period axis ----

  @Builder
  private axis() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        Text(this.monthLabel()).fontSize(11).fontWeight(FontWeight.Bold).fontColor(scheduleMetaText(this.store.dark))
          .width('100%').height(HEADER).textAlign(TextAlign.Center)
        ForEach(this.store.slots(), (slot: number) => {
          Column({ space: 1 }) {
            Text(String(slot)).fontSize(12).fontWeight(FontWeight.Bold).fontColor(this.ink())
            if (this.store.showSlotTime) {
              Text(this.store.slotStart(slot) || '—').fontSize(8).fontColor(scheduleMetaText(this.store.dark))
            }
          }.width('100%').height(this.rowHeight()).justifyContent(FlexAlign.Center)
            .margin({ bottom: slot < this.store.slotCount() ? GAP : 0 })
        }, (slot: number) => String(slot))
      }.width('100%')
      if (this.nowY() >= 0 && this.todayOnScreen()) {
        Text(this.clockLabel()).fontSize(9).fontWeight(600).fontColor('#FFFFFF').height(15).width('100%')
          .textAlign(TextAlign.Center).borderRadius(8).backgroundColor(scheduleThemeFill(this.store.palette))
          .position({ x: 0, y: HEADER + this.nowY() - 7.5 }).hitTestBehavior(HitTestMode.None).accessibilityLevel('no')
      }
    }.width(this.axisWidth()).height(HEADER + this.gridHeight())
  }

  // ---- One day ----

  @Builder
  private dayView(date: string) {
    Column() {
      Column({ space: 2 }) {
        Text(`${scheduleWeekday(this.weekday(date))} ${this.shortDate(date)}`).fontSize(12).fontWeight(FontWeight.Bold)
          .fontFamily(scheduleStyleTextFont(this.store.visualStyle))
          .fontColor(date === this.today() ? scheduleThemeText(this.store.palette, this.store.dark) : this.ink()).maxLines(1)
        Row({ space: COLUMN_GAP }) {
          this.legend('我', false)
          this.legend(this.couple.partnerName(), true)
        }.width('100%')
        if (this.store.adjustmentOnDate(date)) {
          Text(this.store.adjustmentOnDate(date)?.kind === 'off' ? '休' : '班').fontSize(8).fontWeight(600).fontColor('#FFFFFF')
            .width(12).height(12).textAlign(TextAlign.Center).borderRadius(3).position({ x: 2, y: 2 })
            .backgroundColor(this.store.adjustmentOnDate(date)?.kind === 'off' ? '#E11D48' : '#C2410C')
        }
      }.width('100%').height(HEADER).justifyContent(FlexAlign.Center).padding({ left: 2, right: 2 })
        .id('schedule-overlay-day-' + date)
        .accessibilityGroup(true).accessibilityText(scheduleWeekday(this.weekday(date)) + ' ' + this.shortDate(date) + '，打开这一天的日视图')
        .onClick(() => this.onOpenDay(date))
      Stack({ alignContent: Alignment.TopStart }) {
        Row({ space: COLUMN_GAP }) {
          this.column(date, false)
          this.column(date, true)
        }
        if (date === this.today() && this.nowY() >= 0) {
          Row() {
            Circle().width(6).height(6).fill(scheduleThemeFill(this.store.palette)).margin({ left: -3 })
            Column().height(1.5).layoutWeight(1).backgroundColor(scheduleThemeText(this.store.palette, this.store.dark))
          }.width(this.columnWidth() * 2 + COLUMN_GAP).height(6).position({ x: 0, y: this.nowY() - 3 })
            .hitTestBehavior(HitTestMode.None).accessibilityLevel('no')
        }
      }.height(this.gridHeight())
    }.width(this.dayWidth()).padding({ left: DAY_GAP / 2, right: DAY_GAP / 2 })
      .backgroundColor(date === this.today() ? scheduleThemeTint(this.store.palette, this.store.dark ? 0.14 : 0.07) : Color.Transparent)
      .borderRadius(12)
      .border({ width: { left: this.store.visualStyle === 'paper' || this.store.visualStyle === 'board' ? 0.5 : 0 },
        color: scheduleAlpha(this.ink(), 0.16) })
  }

  @Builder
  private legend(text: string, hollow: boolean) {
    Row({ space: 2 }) {
      Column().width(6).height(6).borderRadius(1.5)
        .backgroundColor(hollow ? Color.Transparent : this.legendInk())
        .border({ width: hollow ? 1 : 0, color: this.legendInk(), radius: 1.5 })
      Text(text).fontSize(9).fontWeight(600).fontColor(this.legendInk()).maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
    }.width(this.columnWidth()).justifyContent(FlexAlign.Center).accessibilityLevel('no')
  }

  // One person's column of a day: faint cells, then that person's courses (overlaps as one card).
  @Builder
  private column(date: string, theirs: boolean) {
    Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        ForEach(this.store.slots(), (slot: number) => {
          Column().width('100%').height(this.rowHeight()).margin({ bottom: slot < this.store.slotCount() ? GAP : 0 })
            .borderRadius(6).backgroundColor(scheduleAlpha(this.ink(), this.store.dark ? 0.05 : 0.035))
        }, (slot: number) => String(slot))
      }.width('100%')
      ForEach(this.cards(date, theirs), (card: OverlayStripCard) => {
        this.tile(card, date, theirs)
      }, (card: OverlayStripCard) => card.id + ':' + card.more)
    }.width(this.columnWidth()).height(this.gridHeight())
  }

  @Builder
  private tile(card: OverlayStripCard, date: string, theirs: boolean) {
    Stack({ alignContent: Alignment.TopEnd }) {
      Column({ space: 2 }) {
        Text(card.block.course.name).fontSize(this.tileHeight(card) < 60 ? 10 : 11).fontWeight(FontWeight.Bold)
          .fontFamily(scheduleStyleTextFont(this.store.visualStyle)).fontColor(this.accent(card.block))
          .decoration({ type: card.block.cancelled ? TextDecorationType.LineThrough : TextDecorationType.None })
          .maxLines(this.tileHeight(card) < 60 ? 2 : 4).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        if (this.tileHeight(card) >= 56 && scheduleCleanLocation(card.block.course.location)) {
          Text('@' + scheduleCleanLocation(card.block.course.location)).fontSize(9).fontWeight(600).opacity(0.85)
            .fontColor(this.accent(card.block)).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        }
      }.width('100%').height('100%').padding({ left: 3, right: 3, top: card.more ? 12 : 4, bottom: 3 })
        .alignItems(HorizontalAlign.Start)
      if (card.more > 0) {
        Text('+' + card.more).fontSize(8).fontWeight(FontWeight.Bold).fontColor('#FFFFFF').height(12)
          .padding({ left: 3, right: 3 }).borderRadius(6).backgroundColor(this.accent(card.block)).margin({ top: 2, right: 2 })
      }
    }.width(this.columnWidth()).height(this.tileHeight(card))
      .position({ x: 0, y: (card.startSlot - 1) * (this.rowHeight() + GAP) })
      .borderRadius(this.radius()).clip(true)
      .backgroundColor(theirs ? this.hollowFill() : scheduleCourseFill(scheduleStyleCourseColor(card.block.course.name, this.store.palette),
        this.store.dark, !!this.store.backgroundPath))
      .border({ width: theirs ? 1.2 : 0, color: scheduleAlpha(this.accent(card.block), 0.8), radius: this.radius(),
        style: theirs && this.dashed() ? BorderStyle.Dashed : BorderStyle.Solid })
      .opacity(card.block.cancelled ? 0.55 : 1).grayscale(card.block.cancelled ? 1 : 0)
      .accessibilityGroup(true)
      .accessibilityText((theirs ? this.couple.partnerName() + '的课，' : '') + card.block.course.name
        + (card.more ? `，还有 ${card.more} 门` : '') + '，' + scheduleCleanLocation(card.block.course.location))
      .onClick(() => {
        if (theirs) this.onPeek(card.block, this.weekday(date), this.couple.partnerName() + ' 的课');
        else this.onCourse(card.block, this.weekday(date), date);
      })
      .bindContextMenu(this.menu(card, date, theirs), ResponseType.LongPress, { preview: MenuPreviewMode.IMAGE })
  }

  @Builder
  private menu(card: OverlayStripCard, date: string, theirs: boolean) {
    Menu() {
      ForEach(this.actions(card, date, theirs), (action: CourseMenuAction) => {
        MenuItem({ content: action.label })
          .onClick(() => {
            if (action.id === 'detail' && theirs) this.onPeek(card.block, this.weekday(date), this.couple.partnerName() + ' 的课');
            else this.onMenu(action.id, card.block, this.weekday(date), date);
          })
      }, (action: CourseMenuAction) => action.id)
    }
  }

  // ---- Following the page ----

  private follow(): void {
    if (this.reported) {
      if (this.selection === this.reported || Date.now() - this.reportedAt > 600) this.reported = '';
      else return;
    }
    const index = overlayStripLeading(this.selection, this.dates(), this.count());
    if (index === this.leading) return;
    this.leading = index;
    this.scroller.scrollToIndex(index, true);
  }

  private reload(): void {
    this.source.replace(this.dates());
    const index = overlayStripLeading(this.selection, this.dates(), this.count());
    this.leading = index;
    this.scroller.scrollToIndex(index, false);
  }

  // The user slid the strip: the new leftmost day becomes the page's selected week and day.
  private report(): void {
    const date = this.dates()[this.leading];
    if (!date || date === this.selection) return;
    const slot = this.store.dateSlot(date);
    if (!slot) return;
    this.reported = date;
    this.reportedAt = Date.now();
    this.store.selectedDay = slot.day;
    if (String(slot.week) !== this.store.selectedWeek) this.store.selectWeek(String(slot.week));
    else this.store.selectDay(slot.day);
  }

  // ---- Data ----

  private dates(): string[] {
    const dates: string[] = [];
    (this.store.calendar?.weeks ?? []).forEach((week: NativeCalendarWeek) => {
      (week.days ?? []).forEach((date: string) => { if (date && !dates.includes(date)) dates.push(date); });
    });
    return dates.sort();
  }

  private cards(date: string, theirs: boolean): OverlayStripCard[] {
    if (theirs) return overlayStripCards(this.couple.blocksOn(date, this.store.periods), 'ta-' + date);
    const day = this.weekday(date);
    const own = this.store.blocksOnDate(date).concat(this.store.cancelledOnDate(date, day, this.sourceDay(date)));
    return overlayStripCards(own, 'me-' + date);
  }

  private actions(card: OverlayStripCard, date: string, theirs: boolean): CourseMenuAction[] {
    return courseMenuActions({ partner: theirs, cancelled: !!card.block.cancelled, moved: !!card.block.course.occurrenceFrom,
      editable: this.store.canEdit(), occurrences: this.store.occurrencesEditable(), date,
      adjusted: !!this.store.adjustmentOnDate(date), agenda: this.store.agendaAvailable && !!this.store.agendaNew });
  }

  // A make-up day holds another weekday's courses.
  private sourceDay(date: string): number {
    const adjustment = this.store.adjustmentOnDate(date);
    if (adjustment?.kind === 'swap') return this.store.dateSlot(adjustment.source ?? '')?.day ?? this.weekday(date);
    return this.weekday(date);
  }

  private weekday(date: string): number { return this.store.dateSlot(date)?.day ?? 1; }

  private today(): string { return scheduleTodayDate(Date.now()); }

  private todayOnScreen(): boolean {
    const dates = this.dates();
    const index = dates.indexOf(this.today());
    return index >= this.leading && index < this.leading + this.count();
  }

  private shortDate(date: string): string { return date.length >= 10 ? `${Number(date.substring(5, 7))}.${Number(date.substring(8, 10))}` : date; }

  private monthLabel(): string {
    const date = this.dates()[this.leading] ?? '';
    return date.length >= 10 ? `${Number(date.substring(5, 7))}月` : '节次';
  }

  private clockLabel(): string {
    const minutes = this.store.nowMinutes;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  // ---- Geometry ----

  private innerWidth(): number { return Math.max(200, Math.min(this.pageWidth, 720) - 24 - (this.store.visualStyle === 'classic' ? 0 : 8)); }
  private axisWidth(): number { return 34; }
  private count(): number { return overlayStripDayCount(this.innerWidth(), this.axisWidth()); }
  private dayWidth(): number { return (this.innerWidth() - this.axisWidth()) / this.count(); }
  private columnWidth(): number { return Math.max(20, (this.dayWidth() - DAY_GAP - COLUMN_GAP) / 2); }
  private rowHeight(): number {
    const count = Math.max(1, this.store.slotCount());
    return Math.max(34, (this.contentHeight - HEADER - 26 - (count - 1) * GAP) / count) * this.store.rowScale();
  }
  private gridHeight(): number {
    const count = Math.max(1, this.store.slotCount());
    return count * this.rowHeight() + (count - 1) * GAP;
  }
  private tileHeight(card: OverlayStripCard): number {
    return (card.endSlot - card.startSlot + 1) * this.rowHeight() + (card.endSlot - card.startSlot) * GAP;
  }
  private nowY(): number {
    if (!this.store.showNowIndicator || this.store.nowMinutes < 0) return -1;
    const slots = this.store.slots();
    return scheduleNowOffset(this.store.nowMinutes, slots.map((slot: number) => this.store.slotStart(slot)),
      slots.map((slot: number) => this.store.slotEnd(slot)), this.rowHeight(), GAP);
  }

  // ---- Colours ----

  private ink(): string { return this.store.visualStyle === 'classic' ? scheduleText(this.store.dark) : scheduleStyleInk(this.store.visualStyle, this.store.dark); }
  private legendInk(): string {
    return this.store.visualStyle === 'classic' ? scheduleSecondaryText(this.store.dark) : scheduleAlpha(this.ink(), 0.62);
  }
  private accent(block: NativeCourseBlock): string {
    return scheduleCourseAccent(scheduleStyleCourseColor(block.course.name, this.store.palette), this.store.dark);
  }
  private radius(): number {
    return this.store.visualStyle === 'classic' ? 8 : Math.max(2, scheduleStyleLayout(this.store.visualStyle).cornerRadius);
  }
  // Where the user's own cards are outlined too (classic, grid), the other person's outline is dashed.
  private dashed(): boolean { return this.store.visualStyle === 'classic' || scheduleStyleLayout(this.store.visualStyle).borderWidth > 0; }
  private hollowFill(): string {
    if (this.store.backgroundPath) return this.store.dark ? '#57000000' : '#A8FFFFFF';
    return this.store.dark ? '#0AFFFFFF' : '#CCFFFFFF';
  }
  private panelColor(): string {
    const canvas = scheduleStyleCanvas(this.store.visualStyle, this.store.dark);
    if (canvas && !this.store.backgroundPath) return canvas;
    return scheduleStylePanelSurface(!!this.store.backgroundPath, this.store.dark, this.store.backgroundOpacity);
  }
  private cellBorder(): string { return scheduleStyleCellBorder(this.store.dark); }
}
