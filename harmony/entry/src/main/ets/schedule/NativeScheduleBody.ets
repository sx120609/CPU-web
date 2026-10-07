import { NativeCourseBlock, NativeScheduleStore } from './NativeScheduleStore';
import { scheduleCardTone } from './ScheduleVisuals';
import { scheduleAccent, scheduleCell, scheduleCellBorder, scheduleGridMetrics, ScheduleGridMetrics,
  scheduleSecondaryText, scheduleSurface, scheduleText, scheduleTint } from './ScheduleLayout';
import { PlacedCourseBlock, placeScheduleBlocks } from './SchedulePlacement';
import { scheduleAdjustmentText } from './ScheduleMonth';
import { scheduleAlpha, scheduleCleanLocation, scheduleClockLabel, scheduleClockMinutes, scheduleCourseAccent,
  scheduleCourseBorder, scheduleCourseFill, scheduleCoursePhase, scheduleCourseStatusLabel, ScheduleDayStatus,
  scheduleMetaText, scheduleNowOffset, scheduleNumeral, scheduleSession, scheduleSlotText, scheduleStyleAccent,
  scheduleStyleCanvas, scheduleStyleCellBorder, scheduleStyleCellSurface, scheduleStyleColumnGap,
  scheduleStyleCourseColor, scheduleStyleFont, scheduleStyleFramesPanel, scheduleStyleInk, scheduleStyleLayout,
  scheduleStylePanelSurface, scheduleThemeFill, scheduleThemeText, scheduleThemeTint, scheduleTodayDate,
  scheduleWeekday } from './ScheduleStyle';

const DAYS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SHORT_DAYS: string[] = ['一', '二', '三', '四', '五', '六', '日'];
// Row gap and date-header height of the styled grids, as on iOS.
const STYLED_SLOT_GAP: number = 3;
const STYLED_HEADER: number = 48;
const OFF_BADGE: string = '#E11D48';
const SWAP_BADGE: string = '#C2410C';

// How a period's cell relates to the courses drawn over it.
interface SlotCover {
  occupied: boolean;
  // Course tiles cover the whole cell. Dark fills are translucent, so a cell left underneath would show through.
  covered: boolean;
  joinsBelow: boolean;
  joinsAbove: boolean;
}

// One node of the minimal style's day timeline: the courses that start together.
interface TimelineGroup {
  courses: PlacedCourseBlock[];
  // none | past | current | next
  phase: string;
  // Minutes left (current) or minutes until the start (next).
  minutes: number;
}

interface DaySection {
  title: string;
  courses: PlacedCourseBlock[];
}

@Component
export struct NativeScheduleBody {
  @ObjectLink store: NativeScheduleStore;
  @Prop view: NativeScheduleStore = new NativeScheduleStore();
  @Prop contentHeight: number = 540;
  @Prop pageWidth: number = 360;
  @Prop showDayStrip: boolean = true;
  onLogin: () => void = () => undefined;
  onAddSlot: (day: number, slot: number) => void = () => undefined;
  // The second argument is the weekday the course is shown on, which differs on a make-up day.
  onCourse: (block: NativeCourseBlock, shownDay: number) => void = () => undefined;

  build() {
    Scroll() {
      Column() {
        if (this.showDayStrip && this.view.viewMode === 'day' && this.view.calendar) this.dayStrip()
        if (this.view.status === 'unauthorized') {
          this.stateCard('教务授权已失效', '请重新登录并完成教务授权后读取课表', '去登录', () => this.onLogin())
        } else if ((this.view.status === 'idle' || this.view.status === 'loading') && !this.view.result) {
          this.loadingCard()
        } else if (this.view.status === 'failed' && !this.view.result) {
          this.stateCard('课表暂时无法加载', this.view.errorMessage || '请检查网络连接后重试', '重新加载', () => this.store.load(true))
        } else if (this.view.result) {
          if (this.store.visualStyle !== 'classic') {
            if (this.view.viewMode === 'week') this.styledWeek()
            else this.styledDay()
          } else if (this.view.viewMode === 'week') this.weekSchedule()
          else if (this.view.displayBlocks(this.view.selectedDay).length) this.daySchedule()
          else this.stateCard('这一天没有课程', this.emptyDayNote(), this.store.canEdit() ? '添加课程' : '', () => this.addAt(this.view.selectedDay, 1))
        }
      }.width('100%').padding({ bottom: 12 })
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
  }

  // ---- Classic: glass cells and gradient cards ----

  @Builder
  private adjustmentBadge(day: number, size: number) {
    if (this.view.adjustment(day)) {
      Text(this.view.adjustment(day)?.kind === 'off' ? '休' : '班').fontSize(size - 4).fontWeight(600).fontColor('#FFFFFF')
        .width(size).height(size).textAlign(TextAlign.Center).borderRadius(3)
        .backgroundColor(this.view.adjustment(day)?.kind === 'off' ? OFF_BADGE : SWAP_BADGE)
        .accessibilityLevel('no')
    }
  }

  @Builder
  private calendarDay(day: number, selected: boolean) {
    Stack({ alignContent: Alignment.TopEnd }) {
      Column({ space: 1 }) {
        Text(DAYS[day - 1]).fontSize(11).fontWeight(600).fontColor(selected ? this.accentColor() : this.textColor()).maxLines(1)
        Text(this.dateLabel(day)).fontSize(9).fontColor(selected ? this.accentColor() : this.secondaryColor()).maxLines(1)
      }.width('100%').height(this.metrics().header).justifyContent(FlexAlign.Center).borderRadius(10)
        .backgroundColor(selected ? scheduleTint(this.accentColor(), 0.12) : (this.store.backgroundPath ? this.surfaceColor() : Color.Transparent))
        .border({ width: selected ? 0.8 : 0, color: scheduleTint(this.accentColor(), 0.3), radius: 10 })
      this.adjustmentBadge(day, 12)
    }.width('100%').height(this.metrics().header)
  }

  @Builder
  private dayStrip() {
    Row({ space: 2 }) {
      ForEach([1,2,3,4,5,6,7], (day: number) => {
        Button() { this.calendarDay(day, day === this.view.selectedDay) }
          .type(ButtonType.Normal).height(this.metrics().header).layoutWeight(1).padding(0).borderRadius(10).backgroundColor(Color.Transparent)
          .accessibilityText(DAYS[day - 1] + ' ' + this.dateLabel(day)).accessibilitySelected(day === this.view.selectedDay)
          .onClick(() => this.store.selectDay(day))
      })
    }.width('100%').margin({ bottom: 8 })
  }

  @Builder
  private weekSchedule() {
    Column({ space: 4 }) {
      Row({ space: this.metrics().gap }) {
        Text('节次').fontSize(10).fontColor(this.secondaryColor()).width(this.metrics().axis).height(this.metrics().header).textAlign(TextAlign.Center)
          .borderRadius(10).backgroundColor(this.store.backgroundPath ? this.surfaceColor() : Color.Transparent)
        ForEach(this.view.visibleDays(), (day: number) => {
          Button() { this.calendarDay(day, this.view.isToday(day)) }
            .type(ButtonType.Normal).height(this.metrics().header).layoutWeight(1).padding(0).backgroundColor(Color.Transparent).borderRadius(10)
            .responseRegion({ x: 0, y: -4, width: '100%', height: 44 })
            .accessibilitySelected(this.view.isToday(day))
            .accessibilityText(DAYS[day - 1] + '，' + this.dateLabel(day) + this.adjustmentSpoken(day) + '，查看当天课程')
            .onClick(() => { this.store.selectDay(day); this.store.setViewMode('day'); })
        }, (day: number) => String(day))
      }.width('100%')
      Row({ space: this.metrics().gap }) {
        Stack({ alignContent: Alignment.TopStart }) {
          Column() { ForEach(this.view.slots(), (slot: number) => { this.slotAxis(slot, false) }) }.width('100%')
          if (this.weekNowY(this.metrics().weekRow, this.metrics().gap) >= 0) {
            this.nowBadge(this.metrics().axis, this.weekNowY(this.metrics().weekRow, this.metrics().gap))
          }
        }.width(this.metrics().axis)
        ForEach(this.view.visibleDays(), (day: number) => {
          Stack({ alignContent: Alignment.TopStart }) {
            Column() {
              ForEach(this.view.slots(), (slot: number) => {
                Column().width('100%').height(this.metrics().weekRow).margin({ bottom: slot < this.view.slotCount() ? this.metrics().gap : 0 })
                  .backgroundColor(this.view.isToday(day) ? this.todayCellColor() : this.cellColor()).borderRadius(8)
                  .border({ width: 0.6, color: scheduleCellBorder(this.store.dark), radius: 8,
                    style: this.view.adjustment(day)?.kind === 'off' ? BorderStyle.Dashed : BorderStyle.Solid })
                  .accessibilityText(DAYS[day - 1] + '第' + slot + '节，添加课程')
                  .onClick(() => this.addAt(day, slot))
              })
            }.width('100%')
            ForEach(this.placed(day), (block: PlacedCourseBlock) => {
              Button() {
              Column({ space: block.endSlot === block.startSlot ? 1 : 2 }) {
                Text(block.course.name).fontSize(this.metrics().nameSize).fontWeight(FontWeight.Bold)
                  .minFontSize(this.metrics().nameSize).maxFontSize(this.metrics().nameSize)
                  .heightAdaptivePolicy(TextHeightAdaptivePolicy.MIN_FONT_SIZE_FIRST)
                  .fontColor(this.toneText(block.course.name)).width('100%').textAlign(TextAlign.Center)
                  // One line on a one-period card, so the classroom below it is never pushed out.
                  .maxLines(block.endSlot === block.startSlot ? 1 : block.endSlot - block.startSlot < 2 ? 3 : 4)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (block.course.location) {
                  Text('@' + block.course.location).fontSize(this.metrics().locationSize).fontWeight(600)
                    .minFontSize(this.metrics().locationSize).maxFontSize(this.metrics().locationSize).heightAdaptivePolicy(TextHeightAdaptivePolicy.MIN_FONT_SIZE_FIRST)
                    .fontColor(this.toneAccent(block.course.name)).width('100%').textAlign(TextAlign.Center)
                    .maxLines(block.endSlot === block.startSlot ? 1 : 2).textOverflow({ overflow: TextOverflow.Ellipsis }).opacity(0.94)
                }
              }.width('100%').height('100%')
                .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center).padding({ left: 1, right: 1, top: block.endSlot === block.startSlot ? 1 : 3, bottom: block.endSlot === block.startSlot ? 1 : 3 })
              }.type(ButtonType.Normal).width(this.weekColumn() / block.lanes - 2)
                .height((block.endSlot - block.startSlot + 1) * this.weekStride() - this.metrics().gap - 2)
                .padding(0).clip(true).borderRadius(this.metrics().courseRadius)
                .backgroundColor(Color.Transparent)
                .linearGradient({ angle: 180, colors: [[this.toneFill(block.course.name), 0], [this.toneBottom(block.course.name), 1]] })
                .backdropBlur(10)
                .border({ width: this.store.palette === 'color-glass' ? 1 : 1.5, color: this.toneBorder(block.course.name), radius: this.metrics().courseRadius })
                .shadow({ radius: 3, offsetY: 1, color: this.store.dark ? '#3D000000' : '#0D2C3E5E' })
                .position({ x: block.lane * this.weekColumn() / block.lanes + 1, y: (block.startSlot - 1) * this.weekStride() + 1 })
                .accessibilityText(this.courseAccessibility(block, day)).onClick(() => this.onCourse(block.whole, day))
            })
            if (this.view.isToday(day) && this.weekNowY(this.metrics().weekRow, this.metrics().gap) >= 0) {
              this.nowLine(this.weekColumn(), this.weekNowY(this.metrics().weekRow, this.metrics().gap))
            }
          }.height(this.weekStride() * this.view.slotCount() - this.metrics().gap).layoutWeight(1)
        }, (day: number) => String(day))
      }.width('100%').alignItems(VerticalAlign.Top)
    }.width('100%')
  }

  @Builder
  private slotAxis(slot: number, dayView: boolean) {
    Column({ space: 1 }) {
      Text(String(slot)).fontSize(11).fontWeight(600).fontColor(this.textColor())
      Text(this.view.slotStart(slot) || '—').fontSize(8).fontColor(this.secondaryColor())
      Text(this.view.slotEnd(slot) || '—').fontSize(8).fontColor(this.secondaryColor())
    }.height(dayView ? this.metrics().dayRow : this.metrics().weekRow).margin({ bottom: slot < this.view.slotCount() ? (dayView ? this.metrics().dayGap : this.metrics().gap) : 0 })
      .width('100%').justifyContent(FlexAlign.Center)
  }

  @Builder
  private daySchedule() {
    Row({ space: this.metrics().dayGap }) {
      Stack({ alignContent: Alignment.TopStart }) {
        Column() { ForEach(this.view.slots(), (slot: number) => { this.slotAxis(slot, true) }) }.width('100%')
        if (this.dayNowY(this.metrics().dayRow, this.metrics().dayGap) >= 0) {
          this.nowBadge(this.metrics().dayAxis, this.dayNowY(this.metrics().dayRow, this.metrics().dayGap))
        }
      }.width(this.metrics().dayAxis)
      Stack({ alignContent: Alignment.TopStart }) {
        Column() {
          ForEach(this.view.slots(), (slot: number) => {
            Column().width('100%').height(this.metrics().dayRow).margin({ bottom: slot < this.view.slotCount() ? this.metrics().dayGap : 0 })
              .backgroundColor(this.cellColor()).borderRadius(12)
              .border({ width: 0.6, color: scheduleCellBorder(this.store.dark), radius: 12 })
              .accessibilityText('第' + slot + '节，添加课程')
              .onClick(() => this.addAt(this.view.selectedDay, slot))
          })
        }.width('100%')
        ForEach(this.placed(this.view.selectedDay), (block: PlacedCourseBlock) => {
          Button() {
            Column({ space: block.endSlot === block.startSlot ? 2 : 5 }) {
              Text(block.course.name).fontSize(block.endSlot === block.startSlot ? 14 : 17).fontWeight(FontWeight.Bold)
                .fontColor(this.toneText(block.course.name)).width('100%')
                .maxLines(block.endSlot === block.startSlot ? 1 : block.endSlot - block.startSlot < 2 ? 2 : 3).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text([block.course.location ? '@' + block.course.location : '', block.course.teacher].filter((value: string | undefined) => !!value).join(' · ') || '地点待确认')
                .fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.toneText(block.course.name)).width('100%').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              if (block.endSlot > block.startSlot) {
                Text((block.course.slotNote || `第 ${block.startSlot}–${block.endSlot} 节`) + this.timeRangeSuffix(block)).fontSize(11)
                  .fontColor(this.toneAccent(block.course.name)).opacity(0.86).width('100%').maxLines(1)
              }
            }.width('100%').height('100%').padding({ left: block.lanes > 1 ? 8 : 14, right: block.lanes > 1 ? 8 : 14, top: block.endSlot === block.startSlot ? 3 : 6, bottom: block.endSlot === block.startSlot ? 3 : 6 })
              .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Start)
          }.type(ButtonType.Normal).width(this.dayColumn() / block.lanes - 2)
            .height((block.endSlot - block.startSlot + 1) * this.dayStride() - this.metrics().dayGap - 2)
            .padding(0).clip(true).borderRadius(14).backgroundColor(Color.Transparent)
            .linearGradient({ angle: 180, colors: [[this.toneFill(block.course.name), 0], [this.toneBottom(block.course.name), 1]] })
            .backdropBlur(10)
            .border({ width: this.store.palette === 'color-glass' ? 1 : 1.5, color: this.toneBorder(block.course.name), radius: 14 })
            .shadow({ radius: 3, offsetY: 1, color: this.store.dark ? '#3D000000' : '#0D2C3E5E' })
            .position({ x: block.lane * this.dayColumn() / block.lanes + 1, y: (block.startSlot - 1) * this.dayStride() + 1 })
            .accessibilityText(this.courseAccessibility(block, this.view.selectedDay)).onClick(() => this.onCourse(block.whole, this.view.selectedDay))
        })
        if (this.dayNowY(this.metrics().dayRow, this.metrics().dayGap) >= 0) {
          this.nowLine(this.dayColumn(), this.dayNowY(this.metrics().dayRow, this.metrics().dayGap))
        }
      }.layoutWeight(1).height(this.dayStride() * this.view.slotCount() - this.metrics().dayGap)
    }.width('100%').alignItems(VerticalAlign.Top)
  }

  // ---- "Now" ----

  // The current time in a theme-colour capsule on the period axis.
  @Builder
  private nowBadge(width: number, y: number) {
    Text(scheduleClockLabel(this.store.nowMinutes)).fontSize(10).fontWeight(600).fontColor('#FFFFFF').maxLines(1)
      .height(16).padding({ left: 4, right: 4 }).borderRadius(8).backgroundColor(scheduleThemeFill(this.store.palette))
      .position({ x: 0, y: y - 8 }).width(width).textAlign(TextAlign.Center)
      .hitTestBehavior(HitTestMode.None).accessibilityLevel('no')
  }

  // A theme-colour line across today's column with a dot at its leading end.
  @Builder
  private nowLine(width: number, y: number) {
    Row() {
      Circle().width(7).height(7).fill(scheduleThemeFill(this.store.palette)).margin({ left: -3.5 })
      Column().height(1.5).layoutWeight(1).backgroundColor(this.themeText())
    }.width(width).height(7).position({ x: 0, y: y - 3.5 }).hitTestBehavior(HitTestMode.None).accessibilityLevel('no')
  }

  private nowY(rowHeight: number, gap: number): number {
    if (!this.store.showNowIndicator || this.store.nowMinutes < 0) return -1;
    const slots = this.view.slots();
    return scheduleNowOffset(this.store.nowMinutes, slots.map((slot: number) => this.view.slotStart(slot)),
      slots.map((slot: number) => this.view.slotEnd(slot)), rowHeight, gap);
  }

  // Only a week that holds today, among the days on screen, marks "now".
  private weekNowY(rowHeight: number, gap: number): number {
    return this.view.visibleDays().some((day: number) => this.view.isToday(day)) ? this.nowY(rowHeight, gap) : -1;
  }

  private dayNowY(rowHeight: number, gap: number): number {
    return this.view.isToday(this.view.selectedDay) ? this.nowY(rowHeight, gap) : -1;
  }

  // ---- Styled week (minimal, grid, table, paper, board) ----

  @Builder
  private styledWeek() {
    if (this.store.visualStyle === 'paper') {
      // Paper frames its panel with a heavy outer and a fine inner rule.
      Column() {
        Column() { this.styledWeekContent() }.width('100%').padding(3)
          .border({ width: 0.6, color: scheduleAlpha(this.ink(), 0.24) })
      }.width('100%').padding(2).backgroundColor(this.panelColor())
        .border({ width: 1.2, color: scheduleAlpha(this.ink(), 0.6), radius: 2 })
    } else {
      Column() { this.styledWeekContent() }.width('100%').padding(this.panelPad())
        .backgroundColor(this.panelColor())
        .borderRadius(this.store.visualStyle === 'minimal' || this.store.visualStyle === 'grid' ? 20 : scheduleStyleLayout(this.store.visualStyle).cornerRadius)
        .border({ width: this.store.visualStyle === 'table' ? 0.6 : scheduleStyleFramesPanel(this.store.visualStyle) ? 1 : 0,
          color: scheduleStyleCellBorder(this.store.dark),
          radius: this.store.visualStyle === 'minimal' || this.store.visualStyle === 'grid' ? 20 : scheduleStyleLayout(this.store.visualStyle).cornerRadius })
    }
  }

  @Builder
  private styledWeekContent() {
    Stack({ alignContent: Alignment.TopStart }) {
      if (this.store.visualStyle === 'minimal') {
        // The minimal style's hairlines between periods, right of the period axis.
        ForEach(this.view.slots(), (slot: number) => {
          if (slot < this.view.slotCount() || slot === 1) {
            Column().height(0.4).backgroundColor(scheduleStyleCellBorder(this.store.dark))
              .width(Math.max(0, this.bodyWidth() - 2 * this.panelPad() - this.styledAxis() - 2))
              .position({ x: this.styledAxis() + 2,
                y: slot === 1 && this.view.slotCount() > 1 ? STYLED_HEADER - 0.5 : STYLED_HEADER + slot * this.styledStride() - STYLED_SLOT_GAP / 2 })
              .hitTestBehavior(HitTestMode.None)
          }
        })
      }
      Row({ space: scheduleStyleColumnGap(this.store.visualStyle) }) {
        Column() {
          // The headers carry only the day of the month; the month reads here, as on a calendar.
          Text(this.monthLabel()).fontSize(11).fontWeight(FontWeight.Bold).fontColor(scheduleMetaText(this.store.dark))
            .fontFamily(scheduleStyleFont(this.store.visualStyle))
            .width('100%').height(STYLED_HEADER).textAlign(TextAlign.Center)
          ForEach(this.view.slots(), (slot: number) => {
            Column() { this.styledSlotLabel(slot) }.width('100%').height(this.styledRow())
              .justifyContent(FlexAlign.Center).margin({ bottom: slot < this.view.slotCount() ? STYLED_SLOT_GAP : 0 })
              .border({ width: { top: this.store.visualStyle === 'table' ? 0.6 : 0 }, color: scheduleStyleCellBorder(this.store.dark) })
          })
        }.width(this.styledAxis())
        ForEach(this.view.visibleDays(), (day: number) => { this.styledColumn(day, false) }, (day: number) => String(day))
      }.alignItems(VerticalAlign.Top)
      if (this.weekNowY(this.styledRow(), STYLED_SLOT_GAP) >= 0) {
        this.nowBadge(this.styledAxis(), STYLED_HEADER + this.weekNowY(this.styledRow(), STYLED_SLOT_GAP))
      }
    }.width('100%')
  }

  @Builder
  private styledSlotLabel(slot: number) {
    if (this.store.visualStyle === 'minimal') {
      Text(String(slot)).fontSize(14).fontWeight(FontWeight.Bold).fontColor(this.ink())
      Text(this.view.slotStart(slot) || '—').fontSize(10).fontWeight(600).fontColor(scheduleMetaText(this.store.dark)).margin({ top: 3 })
    } else if (this.store.visualStyle === 'board') {
      if (this.startsSession(slot)) {
        Text(scheduleSession(this.view.slotStart(slot))).fontSize(8).fontWeight(FontWeight.Bold).fontColor(this.ink())
      }
      Text(this.view.slotStart(slot) || '—').fontSize(12).fontWeight(FontWeight.Bold).fontColor(this.ink()).fontFamily('monospace').maxLines(1)
      Text(`第${slot}节`).fontSize(8).fontColor(this.ink())
    } else {
      Text(this.store.visualStyle === 'paper' ? scheduleNumeral(slot) : String(slot))
        .fontSize(this.store.visualStyle === 'paper' ? 12 : 13).fontWeight(FontWeight.Bold).fontColor(this.ink())
        .fontFamily(scheduleStyleFont(this.store.visualStyle))
      Text(this.view.slotStart(slot) || '—').fontSize(9).fontColor(this.ink()).fontFamily(scheduleStyleFont(this.store.visualStyle))
      Text(this.view.slotEnd(slot) || '—').fontSize(9).fontColor(this.ink()).fontFamily(scheduleStyleFont(this.store.visualStyle))
    }
  }

  // One day of a styled week grid, and the grid column of the styled day view.
  @Builder
  private styledColumn(day: number, dayRow: boolean) {
    Column() {
      if (!dayRow) {
        Stack({ alignContent: Alignment.TopEnd }) {
          this.styledDateHeader(day)
          if (this.store.visualStyle === 'minimal' && this.view.adjustment(day)) {
            Column() { this.styledAdjustmentMark(day) }.margin({ right: 2 })
          }
        }.width('100%').height(STYLED_HEADER)
          .accessibilityGroup(true)
          .accessibilityText(scheduleWeekday(day) + ' ' + this.dateLabel(day) + this.adjustmentSpoken(day) + '，查看当天课程')
          .onClick(() => { this.store.selectDay(day); this.store.setViewMode('day'); })
      }
      Stack({ alignContent: Alignment.TopStart }) {
        Column() {
          ForEach(this.view.slots(), (slot: number) => { this.styledCell(day, slot, dayRow) })
        }.width('100%')
        // Only the grid style runs the "now" line beneath its course tiles.
        if (this.store.visualStyle === 'grid' && this.columnNowY(day, dayRow) >= 0) {
          this.nowLine(this.columnWidth(dayRow), this.columnNowY(day, dayRow))
        }
        ForEach(this.placed(day), (block: PlacedCourseBlock) => { this.styledTile(block, day, dayRow) })
        if (this.store.visualStyle !== 'grid' && this.columnNowY(day, dayRow) >= 0) {
          this.nowLine(this.columnWidth(dayRow), this.columnNowY(day, dayRow))
        }
      }.width('100%').height(this.columnHeight(dayRow))
    }.width(this.columnWidth(dayRow)).backgroundColor(dayRow ? Color.Transparent : this.columnBackground(day))
      .borderRadius(this.store.visualStyle === 'minimal' ? 12 : 0)
  }

  @Builder
  private styledAdjustmentMark(day: number) {
    if (this.store.visualStyle === 'paper' || this.store.visualStyle === 'board') {
      // A solid seal for a day off, an outlined one for a make-up day.
      Text(this.view.adjustment(day)?.kind === 'off' ? '休' : '班').fontSize(9).fontWeight(FontWeight.Bold)
        .fontFamily(scheduleStyleFont(this.store.visualStyle))
        .fontColor(this.view.adjustment(day)?.kind === 'off' ? this.canvasOrWhite() : this.styleAccent())
        .width(13).height(13).textAlign(TextAlign.Center)
        .backgroundColor(this.view.adjustment(day)?.kind === 'off' ? this.styleAccent() : Color.Transparent)
        .border({ width: 1, color: this.styleAccent() }).accessibilityLevel('no')
    } else {
      this.adjustmentBadge(day, 12)
    }
  }

  @Builder
  private styledDateHeader(day: number) {
    if (this.store.visualStyle === 'minimal') {
      // The day of the month above, the weekday below; today takes the theme colour.
      Column({ space: 3 }) {
        Text(this.dayOfMonth(day)).fontSize(16).fontWeight(FontWeight.Bold).maxLines(1)
          .fontColor(this.view.isToday(day) ? this.themeText() : this.ink())
        Text(this.view.isToday(day) ? '今天' : scheduleWeekday(day)).fontSize(11).fontWeight(600).maxLines(1)
          .fontColor(this.view.isToday(day) ? this.themeText() : scheduleMetaText(this.store.dark))
      }.width('100%').height('100%').justifyContent(FlexAlign.Center).padding({ top: 6 })
    } else {
      Column({ space: 3 }) {
        if (this.store.visualStyle === 'grid') {
          Text(SHORT_DAYS[day - 1]).fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.headerInk(day)).maxLines(1)
        } else {
          Text(this.view.isToday(day) ? (this.store.visualStyle === 'paper' ? '今日' : '今天') : scheduleWeekday(day))
            .fontSize(11).fontWeight(600).fontColor(this.headerInk(day)).maxLines(1)
            .fontFamily(scheduleStyleFont(this.store.visualStyle))
        }
        Row({ space: 2 }) {
          Text(this.dayOfMonth(day)).fontSize(this.store.visualStyle === 'paper' ? 15 : 11).fontWeight(FontWeight.Medium)
            .fontColor(this.headerInk(day)).maxLines(1).fontFamily(scheduleStyleFont(this.store.visualStyle))
            .padding({ left: this.store.visualStyle === 'paper' ? 4 : 0, right: this.store.visualStyle === 'paper' ? 4 : 0 })
            .borderRadius(10)
            .border({ width: this.store.visualStyle === 'paper' && this.view.isToday(day) ? 1 : 0, color: this.styleAccent(), radius: 10 })
          if (this.view.adjustment(day)) this.styledAdjustmentMark(day)
        }.justifyContent(FlexAlign.Center)
      }.width('100%').height('100%').justifyContent(FlexAlign.Center)
        .backgroundColor(this.store.visualStyle === 'table' && this.view.isToday(day) ? scheduleThemeFill(this.store.palette) : Color.Transparent)
        .border({ width: { bottom: this.store.visualStyle === 'board' && this.view.isToday(day) ? 3 : 0,
          left: this.store.visualStyle === 'table' ? 0.6 : 0 },
          color: { bottom: this.styleAccent(), left: scheduleStyleCellBorder(this.store.dark) } })
    }
  }

  // One empty period of a styled column, on the shared row pitch.
  @Builder
  private styledCell(day: number, slot: number, dayRow: boolean) {
    if (scheduleStyleLayout(this.store.visualStyle).grid === 'cells') {
      Column().width('100%').height(this.cellRow(dayRow)).margin({ bottom: slot < this.view.slotCount() ? STYLED_SLOT_GAP : 0 })
        .backgroundColor(this.cover(day, slot).covered ? Color.Transparent
          : this.view.isToday(day) && !dayRow ? scheduleThemeTint(this.store.palette, 0.12)
          : scheduleStyleCellSurface(!!this.store.backgroundPath, this.store.dark))
        .borderRadius(scheduleStyleLayout(this.store.visualStyle).cornerRadius)
        .border({ width: this.cover(day, slot).covered ? 0 : 1, color: scheduleStyleCellBorder(this.store.dark),
          radius: scheduleStyleLayout(this.store.visualStyle).cornerRadius,
          style: this.view.adjustment(day)?.kind === 'off' ? BorderStyle.Dashed : BorderStyle.Solid })
        .accessibilityText(scheduleWeekday(day) + '第' + slot + '节，空节次').accessibilityLevel(this.cover(day, slot).occupied ? 'no' : 'auto')
        .onClick(() => this.addAt(day, slot))
    } else if (scheduleStyleLayout(this.store.visualStyle).grid === 'table') {
      // Every shared edge is ruled once; a rule that would cross a course spanning several periods is left out.
      Column().width('100%').height(this.cellRow(dayRow) + (slot < this.view.slotCount() ? STYLED_SLOT_GAP : 0))
        .backgroundColor(this.view.isToday(day) && !dayRow ? scheduleThemeTint(this.store.palette, 0.08) : Color.Transparent)
        .border({ width: { top: this.cover(day, slot).joinsAbove ? 0 : 0.6, left: 0.6 }, color: scheduleStyleCellBorder(this.store.dark) })
        .accessibilityText(scheduleWeekday(day) + '第' + slot + '节，空节次').accessibilityLevel(this.cover(day, slot).occupied ? 'no' : 'auto')
        .onClick(() => this.addAt(day, slot))
    } else if (scheduleStyleLayout(this.store.visualStyle).grid === 'sessions') {
      // The heavy rule between morning, afternoon and evening always runs through; the hairline is
      // left out inside a multi-period course.
      Column().width('100%').height(this.cellRow(dayRow)).margin({ bottom: slot < this.view.slotCount() ? STYLED_SLOT_GAP : 0 })
        .border({ width: { top: this.startsSession(slot) ? 2 : this.cover(day, slot).joinsAbove ? 0 : 0.5 },
          color: scheduleAlpha(this.ink(), this.startsSession(slot) ? 0.65 : 0.12) })
        .accessibilityText(scheduleWeekday(day) + '第' + slot + '节，空节次').accessibilityLevel(this.cover(day, slot).occupied ? 'no' : 'auto')
        .onClick(() => this.addAt(day, slot))
    } else {
      Column().width('100%').height(this.cellRow(dayRow)).margin({ bottom: slot < this.view.slotCount() ? STYLED_SLOT_GAP : 0 })
        .border({ width: { bottom: this.store.visualStyle === 'minimal' || this.cover(day, slot).joinsBelow || slot >= this.view.slotCount() ? 0 : 0.5 },
          color: scheduleAlpha(this.ink(), 0.16) })
        .accessibilityText(scheduleWeekday(day) + '第' + slot + '节，空节次').accessibilityLevel(this.cover(day, slot).occupied ? 'no' : 'auto')
        .onClick(() => this.addAt(day, slot))
    }
  }

  @Builder
  private styledTile(block: PlacedCourseBlock, day: number, dayRow: boolean) {
    Stack({ alignContent: Alignment.TopStart }) {
      Column({ space: this.tileTiny(block, dayRow) ? 0 : this.tileSmall(block, dayRow) ? 2 : 4 }) {
        if (scheduleStyleLayout(this.store.visualStyle).course === 'departure' && !this.tileTiny(block, dayRow)) {
          Row({ space: 3 }) {
            // The board has no fill and no bar, so a small course-colour mark sits beside the start time.
            Column().width(this.tileSmall(block, dayRow) ? 5 : 7).height(this.tileSmall(block, dayRow) ? 5 : 7).borderRadius(1)
              .backgroundColor(scheduleCourseAccent(scheduleStyleCourseColor(block.course.name, this.store.palette),
                this.tileInverse(block, day) ? !this.store.dark : this.store.dark))
            Text(this.blockStart(block)).fontSize(this.tileSmall(block, dayRow) ? 10 : 14).fontWeight(FontWeight.Bolder)
              .fontFamily('monospace').fontColor(this.tileInk(block, day)).maxLines(1)
          }
        }
        Text(block.course.name).fontSize(this.tileNameSize(block, dayRow)).fontWeight(600)
          .fontFamily(scheduleStyleFont(this.store.visualStyle)).fontColor(this.tileInk(block, day))
          .maxLines(dayRow ? (this.tileShort(block, dayRow) ? 1 : 2) : this.tileTiny(block, dayRow) ? 1 : this.tileShort(block, dayRow) ? 2 : this.tileSmall(block, dayRow) ? 4 : 3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .textAlign(this.tileCentered(dayRow) ? TextAlign.Center : TextAlign.Start).width('100%')
        if (scheduleCleanLocation(block.course.location)) {
          Text('@' + scheduleCleanLocation(block.course.location)).fontSize(dayRow ? 12 : this.tileSmall(block, dayRow) ? Math.min(9, this.tileNameSize(block, dayRow) - 1) : 11)
            .fontWeight(FontWeight.Medium).fontFamily(scheduleStyleFont(this.store.visualStyle)).fontColor(this.tileInk(block, day))
            .maxLines(this.tileShort(block, dayRow) || dayRow ? 1 : 2).textOverflow({ overflow: TextOverflow.Ellipsis })
            .textAlign(this.tileCentered(dayRow) ? TextAlign.Center : TextAlign.Start).width('100%')
        }
      }.width('100%').height('100%')
        .alignItems(this.tileCentered(dayRow) ? HorizontalAlign.Center : HorizontalAlign.Start)
        .justifyContent(this.tileCentered(dayRow) || dayRow ? FlexAlign.Center : FlexAlign.Start)
        .padding({ left: this.tileStripe() + (dayRow ? 12 : this.tileSmall(block, dayRow) ? 3 : 7),
          right: (dayRow ? 12 : this.tileSmall(block, dayRow) ? 3 : 7) + (dayRow && block.lanes === 1 && this.tileStatus(block, day) ? 84 : 0),
          top: this.tileTiny(block, dayRow) ? 1 : this.tileShort(block, dayRow) ? 3 : 6,
          bottom: this.tileTiny(block, dayRow) ? 1 : this.tileShort(block, dayRow) ? 3 : 6 })
      if (this.tileStripe() > 0) {
        Column().width(this.tileStripe()).height('100%')
          .backgroundColor(scheduleCourseAccent(scheduleStyleCourseColor(block.course.name, this.store.palette), this.store.dark))
      }
      if (dayRow && block.lanes === 1 && this.tileStatus(block, day) && this.store.visualStyle !== 'minimal') {
        Row() {
          Text(this.tileStatus(block, day)).fontSize(11).fontWeight(600).fontColor(this.themeText()).textAlign(TextAlign.End).maxLines(2)
        }.width('100%').height('100%').justifyContent(FlexAlign.End).padding({ right: 10 }).hitTestBehavior(HitTestMode.None)
      }
    }.width(this.tileWidth(block, dayRow)).height(this.tileHeight(block, dayRow))
      .clip(true).borderRadius(scheduleStyleLayout(this.store.visualStyle).cornerRadius)
      .backgroundColor(this.tileBackground(block, day))
      .border({ width: scheduleStyleLayout(this.store.visualStyle).borderWidth > 0
        ? (this.tileCurrent(block, day) ? 2 : scheduleStyleLayout(this.store.visualStyle).borderWidth) : 0,
        color: this.tileCurrent(block, day) ? this.themeText()
          : scheduleCourseAccent(scheduleStyleCourseColor(block.course.name, this.store.palette), this.store.dark),
        radius: scheduleStyleLayout(this.store.visualStyle).cornerRadius })
      .position({ x: this.tileInset(block) + block.lane * this.columnWidth(dayRow) / block.lanes,
        y: (block.startSlot - 1) * (this.cellRow(dayRow) + STYLED_SLOT_GAP) + this.tileInset(block) })
      .accessibilityGroup(true).accessibilityText(this.courseAccessibility(block, day))
      .onClick(() => this.onCourse(block.whole, day))
  }

  // ---- Styled day ----

  @Builder
  private styledDay() {
    if (!this.placed(this.view.selectedDay).length && this.store.visualStyle !== 'grid' && this.store.visualStyle !== 'table') {
      // Minimal, paper and board show the rest card on a free day; grid and table keep their empty
      // rows so a course can still be added there.
      this.restCard()
    } else if (this.store.visualStyle === 'minimal') {
      this.timelineDay()
    } else if (this.store.visualStyle === 'grid') {
      Row({ space: 8 }) {
        Stack({ alignContent: Alignment.TopStart }) {
          Column() {
            ForEach(this.view.slots(), (slot: number) => {
              Column() { this.styledSlotLabel(slot) }.width('100%').height(this.cellRow(true)).justifyContent(FlexAlign.Center)
                .margin({ bottom: slot < this.view.slotCount() ? STYLED_SLOT_GAP : 0 })
            })
          }.width('100%')
          if (this.dayNowY(this.cellRow(true), STYLED_SLOT_GAP) >= 0) {
            this.nowBadge(48, this.dayNowY(this.cellRow(true), STYLED_SLOT_GAP))
          }
        }.width(48)
        this.styledColumn(this.view.selectedDay, true)
      }.width('100%').alignItems(VerticalAlign.Top).margin({ top: 8 })
    } else if (this.store.visualStyle === 'table') {
      this.tableDay()
    } else if (this.store.visualStyle === 'paper') {
      this.paperDay()
    } else {
      this.boardDay()
    }
  }

  // Minimal: courses in order of their start time, with no rows reserved for empty periods.
  @Builder
  private timelineDay() {
    Column({ space: 20 }) {
      ForEach(this.timelineGroups(), (group: TimelineGroup, index: number) => {
        Row({ space: 12 }) {
          // The rail runs outside the times; the node sits level with the first line of the time.
          Stack({ alignContent: Alignment.TopStart }) {
            Column().width(1).backgroundColor(group.phase === 'past' || group.phase === 'current'
              ? scheduleAlpha(this.themeText(), 0.6) : scheduleAlpha(scheduleMetaText(this.store.dark), 0.25))
              .height(this.timelineHeight(group) + (index < this.timelineGroups().length - 1 ? 20 : 0) - (index === 0 ? 28 : 0))
              .position({ x: 6, y: index === 0 ? 28 : 0 })
            Circle().width(group.phase === 'none' ? 5 : 9).height(group.phase === 'none' ? 5 : 9)
              .fill(group.phase === 'next' ? this.canvasOrPage() : group.phase === 'none'
                ? scheduleAlpha(scheduleMetaText(this.store.dark), 0.6) : group.phase === 'current'
                ? scheduleThemeFill(this.store.palette) : scheduleAlpha(this.themeText(), 0.6))
              .stroke(group.phase === 'next' ? this.themeText() : Color.Transparent).strokeWidth(group.phase === 'next' ? 1.5 : 0)
              .position({ x: group.phase === 'none' ? 4 : 2, y: group.phase === 'none' ? 25.5 : 23.5 })
          }.width(13).height(this.timelineHeight(group)).accessibilityLevel('no')
          // The start time leads; the end time and the periods step back beneath it. In class or
          // next up, the third line becomes a countdown.
          Column({ space: 3 }) {
            Text(this.blockStart(group.courses[0])).fontSize(17).fontWeight(600).maxLines(1)
              .fontColor(group.phase === 'current' || group.phase === 'next' ? this.themeText()
                : group.phase === 'past' ? scheduleMetaText(this.store.dark) : this.ink())
            Text(this.groupEnd(group)).fontSize(12).fontWeight(FontWeight.Medium).fontColor(scheduleMetaText(this.store.dark)).maxLines(1)
            if (this.timelineStatus(group)) {
              Text(this.timelineStatus(group)).fontSize(10).fontWeight(600).fontColor(this.themeText()).maxLines(1)
                .padding({ left: 5, right: 5, top: 2, bottom: 2 }).borderRadius(9)
                .backgroundColor(scheduleThemeTint(this.store.palette, 0.12)).margin({ top: 2 })
            } else {
              Text(this.groupSlots(group)).fontSize(10).fontWeight(FontWeight.Medium).fontColor(scheduleMetaText(this.store.dark)).margin({ top: 2 }).maxLines(1)
            }
          }.width(66).alignItems(HorizontalAlign.End).padding({ top: 17 })
          Column({ space: 10 }) {
            ForEach(group.courses, (block: PlacedCourseBlock) => { this.timelineCard(block, group.courses.length > 1) })
          }.layoutWeight(1)
        }.width('100%').alignItems(VerticalAlign.Top)
      })
    }.width('100%').padding({ top: 12, left: 4, right: 4 })
  }

  // The minimal day card: a pale tint held by a light edge and a soft shadow.
  @Builder
  private timelineCard(block: PlacedCourseBlock, showsSlots: boolean) {
    Stack({ alignContent: Alignment.TopEnd }) {
      Column({ space: 7 }) {
        Text(block.course.name).fontSize(17).fontWeight(this.blockPhase(block, this.view.selectedDay) === 'completed' ? FontWeight.Medium : 600)
          .fontColor(this.courseAccent(block.course.name)).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          .padding({ right: this.blockPhase(block, this.view.selectedDay) === 'completed' ? 26 : 0 })
        if (this.courseDetail(block)) {
          Text(this.courseDetail(block)).fontSize(13).fontColor(this.courseAccent(block.course.name)).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        }
        if (showsSlots) {
          // The left column already names the periods; a card repeats them only when several courses start together.
          Text(`${scheduleSlotText(block.startSlot, block.endSlot)} · ${this.blockStart(block)}–${this.blockEnd(block)}`).fontSize(11)
            .fontWeight(FontWeight.Medium).maxLines(1).width('100%')
            .fontColor(this.blockPhase(block, this.view.selectedDay) === 'completed' ? scheduleMetaText(this.store.dark) : this.courseAccent(block.course.name))
        }
      }.width('100%').height('100%').justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Start)
        .padding({ left: 18, right: 18, top: 14, bottom: 14 })
      if (this.blockPhase(block, this.view.selectedDay) === 'completed') {
        Text('✓').fontSize(13).fontWeight(FontWeight.Bold).fontColor(this.courseAccent(block.course.name))
          .width(25).height(25).textAlign(TextAlign.Center).borderRadius(8)
          .backgroundColor(scheduleAlpha(this.courseAccent(block.course.name), this.store.dark ? 0.2 : 0.12))
          .border({ width: 1, color: scheduleAlpha(this.courseAccent(block.course.name), 0.22), radius: 8 })
          .rotate({ angle: 10 }).margin({ right: 12, top: 10 }).accessibilityLevel('no')
      }
    }.width('100%').height(this.cardHeight()).borderRadius(20)
      .backgroundColor(scheduleCourseFill(scheduleStyleCourseColor(block.course.name, this.store.palette), this.store.dark, !!this.store.backgroundPath))
      .border({ width: 1, radius: 20, color: this.blockPhase(block, this.view.selectedDay) === 'completed'
        ? scheduleAlpha(scheduleMetaText(this.store.dark), 0.16)
        : scheduleCourseBorder(scheduleStyleCourseColor(block.course.name, this.store.palette), this.store.dark) })
      .shadow({ radius: this.blockPhase(block, this.view.selectedDay) === 'completed' ? 0 : 7, offsetY: 3,
        color: this.store.dark ? '#2E000000' : '#12000000' })
      .accessibilityGroup(true).accessibilityText(this.spokenLabel(block, this.view.selectedDay))
      .onClick(() => this.onCourse(block.whole, this.view.selectedDay))
  }

  @Builder
  private tableDay() {
    Column() {
      Row() {
        Text('节').width(28).textAlign(TextAlign.Center).fontSize(12).fontWeight(600).fontColor(this.ink())
        Text('时间').width(58).textAlign(TextAlign.Center).fontSize(12).fontWeight(600).fontColor(this.ink())
        Text('课程').layoutWeight(1).padding({ left: 8 }).fontSize(12).fontWeight(600).fontColor(this.ink())
        Text('教室').width(80).padding({ left: 6 }).fontSize(12).fontWeight(600).fontColor(this.ink())
      }.width('100%').height(32).backgroundColor(scheduleAlpha(this.ink(), 0.06))
      ForEach(this.view.slots(), (slot: number) => {
        Row() {
          Text(String(slot)).width(28).textAlign(TextAlign.Center).fontSize(12).fontWeight(FontWeight.Bold).fontColor(this.ink())
          Column({ space: 3 }) {
            Text(this.view.slotStart(slot) || '—').fontSize(10).fontFamily('monospace').fontColor(this.ink())
            Text(this.view.slotEnd(slot) || '—').fontSize(10).fontFamily('monospace').fontColor(this.ink())
          }.width(58).height('100%').justifyContent(FlexAlign.Center)
            .border({ width: { left: 0.5, right: 0.5 }, color: scheduleStyleCellBorder(this.store.dark) })
          if (!this.blocksAt(this.view.selectedDay, slot).length) {
            Row() {
              Text('—').layoutWeight(1).padding({ left: 8 }).fontSize(13).fontColor(scheduleMetaText(this.store.dark))
              Text('—').width(80).height('100%').padding({ left: 6 }).fontSize(13).fontColor(scheduleMetaText(this.store.dark))
                .border({ width: { left: 0.5 }, color: scheduleStyleCellBorder(this.store.dark) })
            }.layoutWeight(1).height('100%')
              .accessibilityGroup(true).accessibilityText('第 ' + slot + ' 节，空节次')
              .onClick(() => this.addAt(this.view.selectedDay, slot))
          } else {
            Column() {
              ForEach(this.blocksAt(this.view.selectedDay, slot), (block: PlacedCourseBlock) => {
                Row() {
                  Column().width(3).height('100%').backgroundColor(this.courseAccent(block.course.name))
                  Column({ space: 3 }) {
                    Text(block.course.name).fontSize(14).fontWeight(600).fontColor(this.courseAccent(block.course.name))
                      .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                    // The status belongs to the course, so it is written once, on its first period.
                    if (slot > block.startSlot) {
                      Text('续课').fontSize(10).fontColor(this.courseAccent(block.course.name)).width('100%')
                    } else if (this.tileStatus(block, this.view.selectedDay)) {
                      Text(this.tileStatus(block, this.view.selectedDay)).fontSize(10).fontColor(this.courseAccent(block.course.name)).maxLines(1).width('100%')
                    }
                  }.layoutWeight(1).padding({ left: 5, right: 5 }).justifyContent(FlexAlign.Center).height('100%')
                  Text(scheduleCleanLocation(block.course.location) || '—').fontSize(12).fontColor(this.courseAccent(block.course.name))
                    .maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width(80).height('100%').padding({ left: 6, right: 6 })
                    .border({ width: { left: 0.5 }, color: scheduleStyleCellBorder(this.store.dark) })
                }.width('100%').height(this.tableRow())
                  .backgroundColor(scheduleCourseFill(scheduleStyleCourseColor(block.course.name, this.store.palette), this.store.dark))
                  .accessibilityGroup(true).accessibilityText(this.spokenLabel(block, this.view.selectedDay))
                  .onClick(() => this.onCourse(block.whole, this.view.selectedDay))
              })
            }.layoutWeight(1)
          }
        }.width('100%').height(Math.max(1, this.blocksAt(this.view.selectedDay, slot).length) * this.tableRow())
          .border({ width: { bottom: slot < this.view.slotCount() ? 0.5 : 0 }, color: scheduleStyleCellBorder(this.store.dark) })
      })
    }.width('100%').margin({ top: 8 }).backgroundColor(this.panelColor())
      .border({ width: 0.6, color: scheduleStyleCellBorder(this.store.dark) })
  }

  @Builder
  private paperDay() {
    Column() {
      Column() {
        ForEach(this.daySections(), (section: DaySection, sectionIndex: number) => {
          Row({ space: 10 }) {
            Text(section.title).fontSize(13).fontWeight(FontWeight.Bold).fontFamily('serif').fontColor(this.ink())
            Column().height(0.5).layoutWeight(1).backgroundColor(scheduleAlpha(this.ink(), 0.2))
          }.width('100%').height(40).padding({ left: 12, right: 12 }).accessibilityLevel('no')
          ForEach(section.courses, (block: PlacedCourseBlock, index: number) => {
            Row({ space: 10 }) {
              Column({ space: 4 }) {
                Text(this.blockStart(block)).fontSize(20).fontWeight(FontWeight.Bold).fontFamily('serif').fontColor(this.ink()).maxLines(1)
                Text(this.blockEnd(block)).fontSize(12).fontFamily('serif').fontColor(this.ink()).maxLines(1)
              }.width(64).alignItems(HorizontalAlign.Start)
              Column().width(2).height(this.cardHeight() - 32).backgroundColor(this.courseAccent(block.course.name))
              Column({ space: 5 }) {
                Text(block.course.name).fontSize(17).fontWeight(600).fontFamily('serif').fontColor(this.ink())
                  .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                if (scheduleCleanLocation(block.course.location)) {
                  Text('@' + scheduleCleanLocation(block.course.location)).fontSize(14).fontFamily('serif').fontColor(this.ink()).maxLines(1).width('100%')
                }
                Text(scheduleSlotText(block.startSlot, block.endSlot)).fontSize(10).fontFamily('serif').fontColor(this.ink()).width('100%')
                if (this.tileStatus(block, this.view.selectedDay)) {
                  Text(this.tileStatus(block, this.view.selectedDay)).fontSize(12).fontWeight(600).fontFamily('serif')
                    .fontColor(this.styleAccent()).maxLines(1).width('100%')
                }
              }.layoutWeight(1)
            }.width('100%').height(this.cardHeight()).padding({ left: 12, right: 12 })
              // The last row closes the list; one more rule there would sit on the panel's edge.
              .border({ width: { bottom: sectionIndex === this.daySections().length - 1 && index === section.courses.length - 1 ? 0 : 0.5 },
                color: scheduleAlpha(this.ink(), 0.15) })
              .accessibilityGroup(true).accessibilityText(this.spokenLabel(block, this.view.selectedDay))
              .onClick(() => this.onCourse(block.whole, this.view.selectedDay))
          })
        })
      }.width('100%').padding(9).border({ width: 0.6, color: scheduleAlpha(this.ink(), 0.24) })
    }.width('100%').padding(3).margin({ top: 8 }).backgroundColor(this.panelColor())
      .border({ width: 1.2, color: scheduleAlpha(this.ink(), 0.6), radius: 2 })
  }

  // The board's day view: what is on now, what comes next and how long is left. Any other day,
  // and a day with the "now" indicator off, has no "now" and shows one plain timetable instead.
  @Builder
  private boardDay() {
    Column() {
      if (this.dayStatus(this.view.selectedDay).now >= 0) {
        Row({ space: 8 }) {
          Text('现在').fontSize(11).fontWeight(FontWeight.Bold).fontFamily('monospace').fontColor(scheduleAlpha(this.ink(), 0.72)).letterSpacing(2)
          Text(scheduleClockLabel(this.store.nowMinutes, true)).fontSize(16).fontWeight(FontWeight.Bold).fontFamily('monospace').fontColor(this.ink())
          Blank()
          Text(this.boardRemaining()).fontSize(12).fontWeight(FontWeight.Medium).fontFamily('monospace').fontColor(scheduleAlpha(this.ink(), 0.72)).maxLines(1)
        }.width('100%').height(36).padding({ left: 12, right: 12 }).accessibilityGroup(true)
        ForEach(this.phaseBlocks('current'), (block: PlacedCourseBlock) => { this.boardHero(block) })
        if (this.phaseBlocks('upcoming').length) {
          this.boardHeading('接下来', true)
          ForEach(this.phaseBlocks('upcoming'), (block: PlacedCourseBlock, index: number) => {
            this.boardRow(block, index === 0, index === this.phaseBlocks('upcoming').length - 1)
          })
        }
        if (this.phaseBlocks('completed').length) {
          this.boardHeading('已结束', false)
          ForEach(this.phaseBlocks('completed'), (block: PlacedCourseBlock) => {
            // A finished course folds down to one quiet line.
            Row({ space: 12 }) {
              Text(this.blockStart(block)).fontSize(14).fontWeight(600).fontFamily('monospace').fontColor(scheduleAlpha(this.ink(), 0.62)).width(82)
              Text(block.course.name).fontSize(14).fontFamily('monospace').fontColor(scheduleAlpha(this.ink(), 0.62)).maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
              if (scheduleCleanLocation(block.course.location)) {
                Text(scheduleCleanLocation(block.course.location)).fontSize(12).fontFamily('monospace').fontColor(scheduleAlpha(this.ink(), 0.62)).maxLines(1)
              }
            }.width('100%').height(Math.max(34, this.cardHeight() * 0.34)).padding({ left: 12, right: 12 })
              .accessibilityGroup(true).accessibilityText(this.spokenLabel(block, this.view.selectedDay))
              .onClick(() => this.onCourse(block.whole, this.view.selectedDay))
          })
        }
      } else {
        this.boardHeading('课程安排', true)
        ForEach(this.placed(this.view.selectedDay), (block: PlacedCourseBlock, index: number) => {
          this.boardRow(block, false, index === this.placed(this.view.selectedDay).length - 1)
        })
      }
    }.width('100%').padding({ top: 8, bottom: 8 }).margin({ top: 8 }).backgroundColor(this.panelColor())
  }

  @Builder
  private boardHeading(title: string, ruled: boolean) {
    Column({ space: 6 }) {
      Text(title).fontSize(11).fontWeight(FontWeight.Bold).fontFamily('monospace').letterSpacing(2)
        .fontColor(scheduleAlpha(this.ink(), 0.72)).width('100%').padding({ left: 12, right: 12 })
      // The heavy rule that opens a list. 已结束 is a quieter footer and goes without.
      Column().width('100%').height(2).backgroundColor(ruled ? scheduleAlpha(this.ink(), 0.65) : Color.Transparent)
    }.width('100%').height(40).justifyContent(FlexAlign.End)
  }

  // The course in progress, inverted: time range, name, room and teacher, time left and progress.
  @Builder
  private boardHero(block: PlacedCourseBlock) {
    Column() {
      Row({ space: 8 }) {
        Text(`正在上 · ${scheduleSlotText(block.startSlot, block.endSlot)}`).fontSize(11).fontWeight(FontWeight.Bold)
          .fontFamily('monospace').fontColor(scheduleAlpha(this.canvasOrWhite(), 0.72)).maxLines(1)
        Blank()
        Text(`还剩 ${this.blockRemaining(block)} 分`).fontSize(13).fontWeight(FontWeight.Bold).fontFamily('monospace')
          .fontColor(scheduleThemeText(this.store.palette, !this.store.dark)).maxLines(1)
      }.width('100%')
      Blank()
      Text(`${this.blockStart(block)} — ${this.blockEnd(block)}`).fontSize(30).fontWeight(FontWeight.Bold).fontFamily('monospace')
        .fontColor(this.canvasOrWhite()).maxLines(1).width('100%')
      Blank()
      Row({ space: 7 }) {
        Column().width(9).height(9).borderRadius(1.5)
          .backgroundColor(scheduleCourseAccent(scheduleStyleCourseColor(block.course.name, this.store.palette), !this.store.dark))
        Text(block.course.name).fontSize(17).fontWeight(FontWeight.Bold).fontFamily('monospace').fontColor(this.canvasOrWhite())
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
      }.width('100%')
      if (this.heroDetail(block)) {
        Text(this.heroDetail(block)).fontSize(14).fontFamily('monospace').fontColor(scheduleAlpha(this.canvasOrWhite(), 0.72))
          .maxLines(1).width('100%').margin({ top: 3 })
      }
      Blank()
      Stack({ alignContent: Alignment.Start }) {
        Column().width('100%').height(3).backgroundColor(scheduleAlpha(this.canvasOrWhite(), 0.25))
        Column().width(`${Math.round(this.blockProgress(block) * 100)}%`).height(3)
          .backgroundColor(scheduleThemeText(this.store.palette, !this.store.dark))
      }.width('100%').height(3)
    }.width('100%').height(Math.max(148, this.cardHeight() * 1.38)).padding(14).margin({ bottom: 4 })
      .backgroundColor(this.ink())
      .accessibilityGroup(true).accessibilityText(this.spokenLabel(block, this.view.selectedDay))
      .onClick(() => this.onCourse(block.whole, this.view.selectedDay))
  }

  // A course still to come, or any course in the plain timetable: the start time leads.
  @Builder
  private boardRow(block: PlacedCourseBlock, isNext: boolean, last: boolean) {
    Row({ space: 12 }) {
      Text(this.blockStart(block)).fontSize(24).fontWeight(FontWeight.Bold).fontFamily('monospace').fontColor(this.ink()).width(82).maxLines(1)
      Column({ space: 4 }) {
        Row({ space: 7 }) {
          Column().width(9).height(9).borderRadius(1.5).backgroundColor(this.courseAccent(block.course.name))
          Text(block.course.name).fontSize(17).fontWeight(600).fontFamily('monospace').fontColor(this.ink())
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        }.width('100%')
        Text([scheduleCleanLocation(block.course.location), scheduleSlotText(block.startSlot, block.endSlot)]
          .filter((value: string) => !!value).join(' · ')).fontSize(12).fontFamily('monospace')
          .fontColor(scheduleAlpha(this.ink(), 0.72)).maxLines(1).width('100%')
      }.layoutWeight(1)
      if (this.boardNote(block, isNext)) {
        Text(this.boardNote(block, isNext)).fontSize(12).fontWeight(600).fontFamily('monospace').maxLines(1)
          .fontColor(isNext && this.blockPhase(block, this.view.selectedDay) !== 'completed' ? this.themeText() : scheduleAlpha(this.ink(), 0.72))
      }
    }.width('100%').height(Math.max(68, this.cardHeight() * 0.66)).padding({ left: 12, right: 12 })
      .border({ width: { bottom: last ? 0 : 0.5 }, color: scheduleAlpha(this.ink(), 0.15) })
      .accessibilityGroup(true).accessibilityText(this.spokenLabel(block, this.view.selectedDay))
      .onClick(() => this.onCourse(block.whole, this.view.selectedDay))
  }

  // The rest card of a day with no courses: a dozing cloud in the theme colour.
  @Builder
  private restCard() {
    Column() {
      Column({ space: 24 }) {
        // Drawn on a 116 × 88 grid, as on iOS, and scaled to 184 × 140 vp.
        Stack({ alignContent: Alignment.TopStart }) {
          Circle().width(this.restUnit(78)).height(this.restUnit(78)).position({ x: this.restUnit(15), y: this.restUnit(4) })
            .fill(scheduleAlpha(this.restAccent(), this.store.dark ? 0.10 : 0.05))
          Ellipse().width(this.restUnit(65)).height(this.restUnit(5)).position({ x: this.restUnit(24), y: this.restUnit(75) })
            .fill(scheduleAlpha(this.restAccent(), this.store.dark ? 0.10 : 0.07))
          Circle().width(this.restUnit(29)).height(this.restUnit(29)).position({ x: this.restUnit(65), y: this.restUnit(11) })
            .fill(scheduleAlpha(this.restAccent(), this.store.dark ? 0.48 : 0.24))
          Path().width(184).height(140)
            .commands(this.restPath([['M', 32, 67], ['C', 11, 67, 10, 39, 30, 37], ['C', 29, 15, 60, 11, 66, 30],
              ['C', 76, 26, 87, 32, 85, 42], ['C', 105, 43, 103, 67, 84, 67], ['Z']]))
            .fill(this.store.dark ? '#333333' : '#FFFFFF').stroke(scheduleAlpha(this.restAccent(), this.store.dark ? 0.35 : 0.20)).strokeWidth(1.2)
          Path().width(184).height(140)
            .commands(this.restPath([['M', 41, 48], ['Q', 46, 54, 51, 48], ['M', 63, 48], ['Q', 68, 54, 73, 48]]))
            .fill(Color.Transparent).stroke(scheduleAlpha(this.restAccent(), this.store.dark ? 0.85 : 0.70)).strokeWidth(1.8)
            .strokeLineCap(LineCapStyle.Round)
        }.width(184).height(140).accessibilityLevel('no')
        Column({ space: 10 }) {
          Text('这天没有课程').fontSize(20).fontWeight(600).fontColor(this.ink()).fontFamily(scheduleStyleFont(this.store.visualStyle))
          Text(this.emptyDayNote() || '留点时间，做喜欢的事').fontSize(14).fontColor(scheduleMetaText(this.store.dark))
            .fontFamily(scheduleStyleFont(this.store.visualStyle)).textAlign(TextAlign.Center)
        }
        if (this.store.canEdit()) {
          Button('添加课程').type(ButtonType.Capsule).height(40).fontSize(13).fontColor(this.restAccent())
            .backgroundColor(scheduleAlpha(this.restAccent(), this.store.dark ? 0.2 : 0.1))
            .onClick(() => this.addAt(this.view.selectedDay, 1))
        }
      }.width('100%').constraintSize({ maxWidth: 360 }).padding({ left: 24, right: 24, top: 32, bottom: 32 })
        .borderRadius(this.store.visualStyle === 'minimal' ? 32 : 2)
        .backgroundColor(scheduleStyleCanvas(this.store.visualStyle, this.store.dark) && !this.store.backgroundPath
          ? scheduleStyleCanvas(this.store.visualStyle, this.store.dark) : scheduleSurface(this.store.dark, !!this.store.backgroundPath))
        .border({ width: 1, radius: this.store.visualStyle === 'minimal' ? 32 : 2,
          color: scheduleAlpha(scheduleStyleCanvas(this.store.visualStyle, this.store.dark) ? this.ink() : this.themeText(), this.store.dark ? 0.14 : 0.1) })
    }.width('100%').constraintSize({ minHeight: Math.max(360, this.contentHeight - 24) })
      .justifyContent(FlexAlign.Center).padding({ left: 12, right: 12 })
  }

  // ---- Data ----

  private placed(day: number): PlacedCourseBlock[] {
    return placeScheduleBlocks(this.view.displayBlocks(day), this.store.displayPriorities());
  }

  private blocksAt(day: number, slot: number): PlacedCourseBlock[] {
    return this.placed(day).filter((block: PlacedCourseBlock) => block.startSlot <= slot && slot <= block.endSlot);
  }

  private cover(day: number, slot: number): SlotCover {
    const covering = this.blocksAt(day, slot);
    const lanes: number[] = [];
    covering.forEach((block: PlacedCourseBlock) => { if (!lanes.includes(block.lane)) lanes.push(block.lane); });
    return { occupied: covering.length > 0,
      // Side-by-side courses that do not fill the row leave the rest of the cell showing.
      covered: covering.length > 0 && lanes.length >= covering[0].lanes,
      joinsBelow: covering.some((block: PlacedCourseBlock) => block.endSlot > slot),
      joinsAbove: covering.some((block: PlacedCourseBlock) => block.startSlot < slot) };
  }

  private addAt(day: number, slot: number): void {
    if (!this.store.canEdit()) return;
    // On a make-up day the new course belongs to the weekday being made up.
    this.onAddSlot(this.view.effectiveSlot(day).day, slot);
  }

  private startsSession(slot: number): boolean {
    return slot <= 1 || scheduleSession(this.view.slotStart(slot - 1)) !== scheduleSession(this.view.slotStart(slot));
  }

  // A custom course may carry its own clock times; they win over the bell schedule.
  private blockStart(block: PlacedCourseBlock): string {
    const custom = (block.course.customStartTime ?? '').trim();
    return scheduleClockMinutes(custom) >= 0 ? custom : (this.view.slotStart(block.startSlot) || '—');
  }

  private blockEnd(block: PlacedCourseBlock): string {
    const custom = (block.course.customEndTime ?? '').trim();
    return scheduleClockMinutes(custom) >= 0 ? custom : (this.view.slotEnd(block.endSlot) || '—');
  }

  private dayStatus(day: number): ScheduleDayStatus {
    const date = this.view.rawDate(day);
    const today = scheduleTodayDate(Date.now());
    const isToday = !!date && date === today;
    return { now: isToday && this.store.showNowIndicator ? this.store.nowMinutes : -1,
      completedBefore: !date ? -1 : date < today ? 24 * 60 : isToday ? this.store.nowMinutes : -1 };
  }

  private blockPhase(block: PlacedCourseBlock, day: number): string {
    return scheduleCoursePhase(this.dayStatus(day), this.blockStart(block), this.blockEnd(block));
  }

  private tileStatus(block: PlacedCourseBlock, day: number): string {
    return scheduleCourseStatusLabel(this.dayStatus(day), this.blockStart(block), this.blockEnd(block));
  }

  private tileCurrent(block: PlacedCourseBlock, day: number): boolean {
    return this.blockPhase(block, day) === 'current';
  }

  private blockRemaining(block: PlacedCourseBlock): number {
    return Math.max(1, scheduleClockMinutes(this.blockEnd(block)) - this.store.nowMinutes);
  }

  private blockProgress(block: PlacedCourseBlock): number {
    const start = scheduleClockMinutes(this.blockStart(block));
    const end = scheduleClockMinutes(this.blockEnd(block));
    return end > start ? Math.min(1, Math.max(0, (this.store.nowMinutes - start) / (end - start))) : 0;
  }

  private phaseBlocks(phase: string): PlacedCourseBlock[] {
    return this.placed(this.view.selectedDay).filter((block: PlacedCourseBlock) => this.blockPhase(block, this.view.selectedDay) === phase);
  }

  private boardRemaining(): string {
    const remaining = this.phaseBlocks('current').length + this.phaseBlocks('upcoming').length;
    return remaining > 0 ? `今天还有 ${remaining} 门课` : '今天的课上完了';
  }

  // The trailing edge of a board row: a countdown for the next course, the time of day for later
  // ones, and 已结束 for a finished course in the plain timetable.
  private boardNote(block: PlacedCourseBlock, isNext: boolean): string {
    if (this.blockPhase(block, this.view.selectedDay) === 'completed') return '已结束';
    const start = scheduleClockMinutes(this.blockStart(block));
    const now = this.dayStatus(this.view.selectedDay).now;
    if (isNext && now >= 0 && start > now) {
      const wait = start - now;
      return wait < 60 ? `${wait} 分钟后` : wait % 60 === 0 ? `${wait / 60} 小时后` : `${Math.floor(wait / 60)} 小时 ${wait % 60} 分后`;
    }
    const session = scheduleSession(this.blockStart(block));
    return session === '课程' ? '' : session;
  }

  private heroDetail(block: PlacedCourseBlock): string {
    return [scheduleCleanLocation(block.course.location), (block.course.teacher ?? '').trim()]
      .filter((value: string) => !!value).join(' · ');
  }

  private courseDetail(block: PlacedCourseBlock): string {
    const location = scheduleCleanLocation(block.course.location);
    return [location ? '@' + location : '', (block.course.teacher ?? '').trim()].filter((value: string) => !!value).join(' · ');
  }

  private timelineGroups(): TimelineGroup[] {
    const groups: TimelineGroup[] = [];
    this.placed(this.view.selectedDay).forEach((block: PlacedCourseBlock) => {
      const last = groups.length ? groups[groups.length - 1] : undefined;
      if (last && last.courses[0].startSlot === block.startSlot) last.courses.push(block);
      else groups.push({ courses: [block], phase: 'none', minutes: 0 });
    });
    const status = this.dayStatus(this.view.selectedDay);
    const ranges: number[][] = groups.map((group: TimelineGroup): number[] => {
      let end = -1;
      group.courses.forEach((block: PlacedCourseBlock) => { end = Math.max(end, scheduleClockMinutes(this.blockEnd(block))); });
      return [scheduleClockMinutes(this.blockStart(group.courses[0])), end];
    });
    if (status.now < 0) {
      // A past day: everything is finished, without a "now" to count from.
      groups.forEach((group: TimelineGroup, index: number) => {
        if (status.completedBefore >= 0 && ranges[index][1] >= 0 && ranges[index][1] <= status.completedBefore) group.phase = 'past';
      });
      return groups;
    }
    const inClass = ranges.some((range: number[]) => range[0] >= 0 && range[0] <= status.now && status.now <= range[1]);
    let foundNext = false;
    groups.forEach((group: TimelineGroup, index: number) => {
      const range = ranges[index];
      if (range[0] < 0 || range[1] < 0) return;
      if (status.now > range[1]) { group.phase = 'past'; return; }
      if (status.now >= range[0]) { group.phase = 'current'; group.minutes = range[1] - status.now; return; }
      if (!inClass && !foundNext) { foundNext = true; group.phase = 'next'; group.minutes = range[0] - status.now; }
    });
    return groups;
  }

  private timelineHeight(group: TimelineGroup): number {
    return group.courses.length * this.cardHeight() + (group.courses.length - 1) * 10;
  }

  private timelineStatus(group: TimelineGroup): string {
    if (group.phase === 'current') return `还剩 ${Math.max(1, group.minutes)} 分`;
    if (group.phase !== 'next') return '';
    return group.minutes < 60 ? `${Math.max(1, group.minutes)} 分钟后` : `约 ${Math.round(group.minutes / 60)} 小时后`;
  }

  private groupEnd(group: TimelineGroup): string {
    let latest = group.courses[0];
    group.courses.forEach((block: PlacedCourseBlock) => { if (block.endSlot > latest.endSlot) latest = block; });
    return this.blockEnd(latest);
  }

  private groupSlots(group: TimelineGroup): string {
    let end = group.courses[0].endSlot;
    group.courses.forEach((block: PlacedCourseBlock) => { end = Math.max(end, block.endSlot); });
    const start = group.courses[0].startSlot;
    return start === end ? `第 ${start} 节` : `${start}–${end} 节`;
  }

  private daySections(): DaySection[] {
    const sections: DaySection[] = [];
    ['上午', '下午', '晚上', '课程'].forEach((title: string) => {
      const courses = this.placed(this.view.selectedDay).filter((block: PlacedCourseBlock) => scheduleSession(this.blockStart(block)) === title);
      if (courses.length) sections.push({ title, courses });
    });
    return sections;
  }

  private emptyDayNote(): string {
    const adjustment = this.view.adjustment(this.view.selectedDay);
    if (adjustment) return scheduleAdjustmentText(adjustment);
    return this.store.visualStyle === 'classic' ? (this.store.canEdit() ? '可以切换日期，或添加个人课程' : '可以切换日期查看其他课程') : '';
  }

  private adjustmentSpoken(day: number): string {
    const adjustment = this.view.adjustment(day);
    return adjustment ? (adjustment.kind === 'off' ? '，休息' : '，补班') : '';
  }

  private timeRangeSuffix(block: PlacedCourseBlock): string {
    const start = this.view.slotStart(block.startSlot);
    const end = this.view.slotEnd(block.endSlot);
    return start && end ? ` · ${start}-${end}` : '';
  }

  private courseAccessibility(block: PlacedCourseBlock, day: number): string {
    return DAYS[day - 1] + '，' + block.course.name + '，第' + block.startSlot + '至' + block.endSlot + '节，' + (block.course.location || '');
  }

  // "高等数学，教室 A101，第 1–2 节，08:00 至 09:40，已结束"
  private spokenLabel(block: PlacedCourseBlock, day: number): string {
    const location = scheduleCleanLocation(block.course.location);
    return [block.course.name, location ? '教室 ' + location : '', scheduleSlotText(block.startSlot, block.endSlot),
      `${this.blockStart(block)} 至 ${this.blockEnd(block)}`, this.tileStatus(block, day)]
      .filter((value: string) => !!value).join('，');
  }

  // ---- Geometry ----

  private metrics(): ScheduleGridMetrics { return scheduleGridMetrics(this.pageWidth, this.contentHeight, this.view.slotCount()); }
  private weekStride(): number { return this.metrics().weekRow + this.metrics().gap; }
  private dayStride(): number { return this.metrics().dayRow + this.metrics().dayGap; }
  private bodyWidth(): number { return Math.max(0, Math.min(this.pageWidth, 720) - 2 * this.metrics().inset); }
  private dayCount(): number { return Math.max(1, this.view.visibleDays().length); }
  private weekColumn(): number {
    return Math.max(12, (this.bodyWidth() - this.metrics().axis - this.dayCount() * this.metrics().gap) / this.dayCount());
  }
  private dayColumn(): number { return Math.max(12, this.bodyWidth() - this.metrics().dayAxis - this.metrics().dayGap); }

  // The table's rules run along the panel edge, so it takes no padding.
  private panelPad(): number { return this.store.visualStyle === 'table' ? 0 : this.store.visualStyle === 'paper' ? 5 : 6; }
  private styledAxis(): number { return this.pageWidth <= 390 ? 38 : 42; }
  private styledStride(): number { return this.styledRow() + STYLED_SLOT_GAP; }
  private styledRow(): number {
    const count = Math.max(1, this.view.slotCount());
    // A whole day fits above the tab bar on a phone, as in the classic grid.
    return Math.max(34, (this.contentHeight - STYLED_HEADER - 2 * this.panelPad() - (count - 1) * STYLED_SLOT_GAP - 18) / count);
  }
  private cardHeight(): number { return this.pageWidth <= 390 ? 96 : 108; }
  private tableRow(): number { return Math.max(58, this.cardHeight() * 0.6); }
  private cellRow(dayRow: boolean): number { return dayRow ? Math.max(48, this.cardHeight() * 0.52) : this.styledRow(); }
  private columnHeight(dayRow: boolean): number {
    const count = Math.max(1, this.view.slotCount());
    return count * this.cellRow(dayRow) + (count - 1) * STYLED_SLOT_GAP;
  }
  private columnWidth(dayRow: boolean): number {
    if (dayRow) return Math.max(24, this.bodyWidth() - 56);
    return Math.max(24, (this.bodyWidth() - 2 * this.panelPad() - this.styledAxis()
      - this.dayCount() * scheduleStyleColumnGap(this.store.visualStyle)) / this.dayCount());
  }
  private columnNowY(day: number, dayRow: boolean): number {
    return this.view.isToday(day) ? this.nowY(this.cellRow(dayRow), STYLED_SLOT_GAP) : -1;
  }

  // Grid tiles are the cell itself; table tiles sit just inside the rules; the rest keep 1 vp all round.
  private tileInset(block: PlacedCourseBlock): number {
    return this.store.visualStyle === 'table' ? 0.5 : this.store.visualStyle === 'grid' && block.lanes === 1 ? 0 : 1;
  }
  private tileWidth(block: PlacedCourseBlock, dayRow: boolean): number {
    return Math.max(12, this.columnWidth(dayRow) / block.lanes - this.tileInset(block) * 2);
  }
  private tileHeight(block: PlacedCourseBlock, dayRow: boolean): number {
    // Table rules sit at the top of each period, so a tile reaches across the row gap to the next one.
    const reach = this.store.visualStyle === 'table' && block.endSlot < this.view.slotCount() ? STYLED_SLOT_GAP : 0;
    return Math.max(34, (block.endSlot - block.startSlot + 1) * this.cellRow(dayRow)
      + (block.endSlot - block.startSlot) * STYLED_SLOT_GAP + reach - this.tileInset(block) * 2);
  }
  private tileShort(block: PlacedCourseBlock, dayRow: boolean): boolean { return this.tileHeight(block, dayRow) < 64; }
  private tileSmall(block: PlacedCourseBlock, dayRow: boolean): boolean {
    return !dayRow && (this.tileShort(block, dayRow) || this.columnWidth(dayRow) / block.lanes < 70);
  }
  // A one-period tile on a phone: one line for the name, so the classroom below it still shows.
  private tileTiny(block: PlacedCourseBlock, dayRow: boolean): boolean { return !dayRow && this.tileHeight(block, dayRow) < 46; }
  // Three characters of a course name fit on one line of a week tile on a 360 vp phone.
  private tileNameSize(block: PlacedCourseBlock, dayRow: boolean): number {
    if (dayRow) return 15;
    if (!this.tileSmall(block, dayRow)) return 13;
    const inner = this.tileWidth(block, dayRow) - this.tileStripe() - 6;
    return Math.max(9, Math.min(11, Math.floor(inner / 3 * 2) / 2));
  }
  private tileCentered(dayRow: boolean): boolean { return scheduleStyleLayout(this.store.visualStyle).centered && !dayRow; }
  // The course-colour bar on the leading edge; the text clears it by the same amount.
  private tileStripe(): number {
    const course = scheduleStyleLayout(this.store.visualStyle).course;
    return course === 'stripe' ? 3 : course === 'ink' ? 2 : 0;
  }

  // ---- Colours ----

  private tileInverse(block: PlacedCourseBlock, day: number): boolean {
    return this.store.visualStyle === 'board' && this.tileCurrent(block, day);
  }
  private tileInk(block: PlacedCourseBlock, day: number): string {
    if (this.tileInverse(block, day)) return this.canvasOrWhite();
    return this.store.visualStyle === 'paper' || this.store.visualStyle === 'board' ? this.ink() : this.courseAccent(block.course.name);
  }
  private tileBackground(block: PlacedCourseBlock, day: number): string {
    if (this.tileInverse(block, day)) return this.ink();
    const course = scheduleStyleLayout(this.store.visualStyle).course;
    const color = scheduleStyleCourseColor(block.course.name, this.store.palette);
    if (course === 'card' || course === 'stripe') return scheduleCourseFill(color, this.store.dark, !!this.store.backgroundPath);
    // Paper keeps its ink text; the course colour is only a faint wash.
    if (course === 'ink') return scheduleCourseFill(color, this.store.dark, !!this.store.backgroundPath, 0.7);
    return '#00000000';
  }
  private columnBackground(day: number): string {
    if (this.store.visualStyle === 'minimal' && this.view.isToday(day)) return scheduleThemeTint(this.store.palette, this.store.dark ? 0.15 : 0.08);
    if (this.store.visualStyle === 'paper' && this.view.isToday(day)) return scheduleAlpha(this.styleAccent(), this.store.dark ? 0.10 : 0.07);
    // A weekend column is greyed in the table; one worked as a make-up day stays plain.
    if (this.store.visualStyle === 'table' && day >= 6 && this.view.adjustment(day)?.kind !== 'swap') return scheduleAlpha(this.ink(), 0.035);
    return '#00000000';
  }
  private headerInk(day: number): string {
    if (this.store.visualStyle === 'table' && this.view.isToday(day)) return '#FFFFFF';
    return this.view.isToday(day) ? this.styleAccent() : this.ink();
  }
  private ink(): string { return scheduleStyleInk(this.store.visualStyle, this.store.dark); }
  private themeText(): string { return scheduleThemeText(this.store.palette, this.store.dark); }
  private styleAccent(): string { return scheduleStyleAccent(this.store.visualStyle, this.store.dark, this.themeText()); }
  private restAccent(): string { return this.styleAccent(); }
  private restUnit(value: number): number { return value * 184 / 116; }
  // Path commands are in px: the drawing's grid units are scaled to vp and then to px.
  private restPath(commands: Array<Array<string | number>>): string {
    const scale = this.getUIContext().vp2px(184 / 116);
    return commands.map((command: Array<string | number>) => {
      return command.map((part: string | number) => typeof part === 'number' ? String(Math.round(part * scale * 10) / 10) : part).join(' ');
    }).join(' ');
  }
  private canvasOrWhite(): string { return scheduleStyleCanvas(this.store.visualStyle, this.store.dark) || '#FFFFFF'; }
  private canvasOrPage(): string { return this.store.dark ? '#15181C' : '#F8FBFF'; }
  private courseAccent(name: string): string {
    return scheduleCourseAccent(scheduleStyleCourseColor(name, this.store.palette), this.store.dark);
  }
  private panelColor(): string {
    const canvas = scheduleStyleCanvas(this.store.visualStyle, this.store.dark);
    if (canvas && !this.store.backgroundPath) return canvas;
    return scheduleStylePanelSurface(!!this.store.backgroundPath, this.store.dark, this.store.backgroundOpacity);
  }

  private monthLabel(): string {
    const date = this.view.rawDate(this.view.visibleDays()[0] ?? 1);
    return date.length >= 10 ? `${Number(date.substring(5, 7))}月` : '节次';
  }
  private dayOfMonth(day: number): string {
    const date = this.view.rawDate(day);
    return date.length >= 10 ? String(Number(date.substring(8, 10))) : '–';
  }
  private dateLabel(day: number): string {
    const date = this.view.dayDate(day);
    return date ? date.replace('-', '.') : '—';
  }
  private textColor(): string { return scheduleText(this.store.dark); }
  private secondaryColor(): string { return scheduleSecondaryText(this.store.dark); }
  private surfaceColor(): string { return scheduleSurface(this.store.dark, !!this.store.backgroundPath); }
  private cellColor(): string { return scheduleCell(this.store.dark); }
  private todayCellColor(): string { return this.store.dark ? scheduleCell(this.store.dark, true) : '#7AE8F6F3'; }
  private accentColor(): string { return scheduleAccent(this.store.palette, this.store.dark); }
  private toneBorder(name: string): string { return scheduleCardTone(name, this.store.palette, this.store.dark).border; }
  private toneText(name: string): string { return scheduleCardTone(name, this.store.palette, this.store.dark).text; }
  private toneAccent(name: string): string { return this.toneText(name); }
  private toneFill(name: string): string { return scheduleCardTone(name, this.store.palette, this.store.dark).top; }
  private toneBottom(name: string): string { return scheduleCardTone(name, this.store.palette, this.store.dark).bottom; }
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

}
