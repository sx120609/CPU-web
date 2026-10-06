import { NativeCourseBlock, NativeScheduleStore } from './NativeScheduleStore';
import { scheduleCardTone } from './ScheduleVisuals';
import { scheduleAccent, scheduleCell, scheduleCellBorder, scheduleGridMetrics, ScheduleGridMetrics,
  scheduleSecondaryText, scheduleSurface, scheduleText, scheduleTint } from './ScheduleLayout';

const DAYS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

@Component
export struct NativeScheduleBody {
  @ObjectLink store: NativeScheduleStore;
  @Prop view: NativeScheduleStore = new NativeScheduleStore();
  @Prop contentHeight: number = 540;
  @Prop pageWidth: number = 360;
  @Prop showDayStrip: boolean = true;
  onLogin: () => void = () => undefined;
  onAddSlot: (day: number, slot: number) => void = () => undefined;
  onCourse: (block: NativeCourseBlock) => void = () => undefined;

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
          if (this.view.viewMode === 'week') this.weekSchedule()
          else if (this.view.blocksForDay(this.view.selectedDay).length) this.daySchedule()
          else this.stateCard('这一天没有课程', '可以切换日期，或添加个人课程', this.view.source === 'graduate' ? '' : '添加课程', () => this.onAddSlot(this.view.selectedDay, 1))
        }
      }.width('100%').padding({ bottom: 12 })
    }.width('100%').height('100%').scrollBar(BarState.Off)
  }

  @Builder
  private calendarDay(day: number, selected: boolean) {
    Column({ space: 1 }) {
      Text(DAYS[day - 1]).fontSize(11).fontWeight(600).fontColor(selected ? this.accentColor() : this.textColor()).maxLines(1)
      Text(this.dateLabel(day)).fontSize(9).fontColor(selected ? this.accentColor() : this.secondaryColor()).maxLines(1)
    }.width('100%').height(this.metrics().header).justifyContent(FlexAlign.Center).borderRadius(10)
      .backgroundColor(selected ? scheduleTint(this.accentColor(), 0.12) : (this.store.backgroundPath ? this.surfaceColor() : Color.Transparent))
      .border({ width: selected ? 0.8 : 0, color: scheduleTint(this.accentColor(), 0.3), radius: 10 })
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
        ForEach([1,2,3,4,5,6,7], (day: number) => {
          Button() { this.calendarDay(day, this.view.isToday(day)) }
            .type(ButtonType.Normal).height(this.metrics().header).layoutWeight(1).padding(0).backgroundColor(Color.Transparent).borderRadius(10)
            .responseRegion({ x: 0, y: -4, width: '100%', height: 44 })
            .accessibilitySelected(this.view.isToday(day))
            .accessibilityText(DAYS[day - 1] + '，' + this.dateLabel(day) + '，查看当天课程')
            .onClick(() => { this.store.selectDay(day); this.store.setViewMode('day'); })
        })
      }.width('100%')
      Row({ space: this.metrics().gap }) {
        Column() { ForEach(this.view.slots(), (slot: number) => { this.slotAxis(slot, false) }) }.width(this.metrics().axis)
        ForEach([1,2,3,4,5,6,7], (day: number) => {
          Stack({ alignContent: Alignment.TopStart }) {
            Column() {
              ForEach(this.view.slots(), (slot: number) => {
                Column().width('100%').height(this.metrics().weekRow).margin({ bottom: slot < this.view.slotCount() ? this.metrics().gap : 0 })
                  .backgroundColor(this.view.isToday(day) ? this.todayCellColor() : this.cellColor()).borderRadius(8)
                  .border({ width: 0.6, color: scheduleCellBorder(this.store.dark), radius: 8 })
                  .accessibilityText(DAYS[day - 1] + '第' + slot + '节，添加课程')
                  .onClick(() => { if (this.store.source !== 'graduate') this.onAddSlot(day, slot); })
              })
            }.width('100%')
            ForEach(this.view.blocksForDay(day), (block: NativeCourseBlock) => {
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
                if (this.overlapCount(block) > 1 && block.endSlot > block.startSlot) {
                  Text(`+${this.overlapCount(block) - 1} 门`).fontSize(8).fontColor(this.toneAccent(block.course.name)).maxLines(1)
                }
              }.width('100%').height('100%')
                .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center).padding({ left: 1, right: 1, top: block.endSlot === block.startSlot ? 1 : 3, bottom: block.endSlot === block.startSlot ? 1 : 3 })
              }.type(ButtonType.Normal).width('calc(100% - 2vp)').height((block.endSlot - block.startSlot + 1) * this.weekStride() - this.metrics().gap - 2)
                .padding(0).clip(true).borderRadius(this.metrics().courseRadius)
                .backgroundColor(Color.Transparent)
                .linearGradient({ angle: 180, colors: [[this.toneFill(block.course.name), 0], [this.toneBottom(block.course.name), 1]] })
                .backdropBlur(10)
                .border({ width: this.store.palette === 'color-glass' ? 1 : 1.5, color: this.toneBorder(block.course.name), radius: this.metrics().courseRadius })
                .shadow({ radius: 3, offsetY: 1, color: this.store.dark ? '#3D000000' : '#0D2C3E5E' })
                .position({ x: 1, y: (block.startSlot - 1) * this.weekStride() + 1 })
                .accessibilityText(this.courseAccessibility(block)).onClick(() => this.onCourse(block))
            })
          }.height(this.weekStride() * this.view.slotCount() - this.metrics().gap).layoutWeight(1)
        })
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
      Column() { ForEach(this.view.slots(), (slot: number) => { this.slotAxis(slot, true) }) }.width(this.metrics().dayAxis)
      Stack({ alignContent: Alignment.TopStart }) {
        Column() {
          ForEach(this.view.slots(), (slot: number) => {
            Column().width('100%').height(this.metrics().dayRow).margin({ bottom: slot < this.view.slotCount() ? this.metrics().dayGap : 0 })
              .backgroundColor(this.cellColor()).borderRadius(12)
              .border({ width: 0.6, color: scheduleCellBorder(this.store.dark), radius: 12 })
              .accessibilityText('第' + slot + '节，添加课程')
              .onClick(() => { if (this.store.source !== 'graduate') this.onAddSlot(this.view.selectedDay, slot); })
          })
        }.width('100%')
        ForEach(this.view.blocksForDay(this.view.selectedDay), (block: NativeCourseBlock) => {
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
              if (this.overlapCount(block) > 1 && block.endSlot > block.startSlot) {
                Text(`${this.overlapCount(block)} 门课程重叠，点击查看`).fontSize(10).fontColor(this.secondaryColor()).width('100%')
              }
            }.width('100%').height('100%').padding({ left: 14, right: 14, top: block.endSlot === block.startSlot ? 3 : 6, bottom: block.endSlot === block.startSlot ? 3 : 6 })
              .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Start)
          }.type(ButtonType.Normal).width('calc(100% - 2vp)').height((block.endSlot - block.startSlot + 1) * this.dayStride() - this.metrics().dayGap - 2)
            .padding(0).clip(true).borderRadius(14).backgroundColor(Color.Transparent)
            .linearGradient({ angle: 180, colors: [[this.toneFill(block.course.name), 0], [this.toneBottom(block.course.name), 1]] })
            .backdropBlur(10)
            .border({ width: this.store.palette === 'color-glass' ? 1 : 1.5, color: this.toneBorder(block.course.name), radius: 14 })
            .shadow({ radius: 3, offsetY: 1, color: this.store.dark ? '#3D000000' : '#0D2C3E5E' })
            .position({ x: 1, y: (block.startSlot - 1) * this.dayStride() + 1 })
            .accessibilityText(this.courseAccessibility(block)).onClick(() => this.onCourse(block))
        })
      }.layoutWeight(1).height(this.dayStride() * this.view.slotCount() - this.metrics().dayGap)
    }.width('100%').alignItems(VerticalAlign.Top)
  }

  private overlapCount(block: NativeCourseBlock): number {
    return this.view.blocksForDay(block.day).filter((item: NativeCourseBlock) => item.startSlot <= block.endSlot && item.endSlot >= block.startSlot).length;
  }
  private timeRangeSuffix(block: NativeCourseBlock): string {
    const start = this.view.slotStart(block.startSlot);
    const end = this.view.slotEnd(block.endSlot);
    return start && end ? ` · ${start}-${end}` : '';
  }
  private courseAccessibility(block: NativeCourseBlock): string {
    return DAYS[block.day - 1] + '，' + block.course.name + '，第' + block.startSlot + '至' + block.endSlot + '节，' + (block.course.location || '');
  }
  private metrics(): ScheduleGridMetrics { return scheduleGridMetrics(this.pageWidth, this.contentHeight, this.view.slotCount()); }
  private weekStride(): number { return this.metrics().weekRow + this.metrics().gap; }
  private dayStride(): number { return this.metrics().dayRow + this.metrics().dayGap; }
  private dateLabel(day: number): string {
    const date = this.view.dayDate(day);
    return date ? date.replace('-', '.') : '—';
  }
  private textColor(): string { return scheduleText(this.store.dark); }
  private secondaryColor(): string { return scheduleSecondaryText(this.store.dark); }
  private surfaceColor(): string { return scheduleSurface(this.store.dark, !!this.store.backgroundPath); }
  private softSurfaceColor(): string { return this.store.dark ? '#25252B' : '#E7E7ED'; }
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

