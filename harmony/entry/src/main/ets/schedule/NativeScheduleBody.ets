import { NativeCourseBlock, NativeScheduleStore } from './NativeScheduleStore';
import { scheduleCardTone } from './ScheduleVisuals';

const DAYS: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SLOTS: number[] = [1,2,3,4,5,6,7,8,9,10,11];
const SLOT_STARTS: string[] = ['08:00', '08:55', '09:55', '10:50', '13:30', '14:25', '15:25', '16:20', '18:30', '19:25', '20:20'];
const SLOT_ENDS: string[] = ['08:45', '09:40', '10:40', '11:35', '14:15', '15:10', '16:10', '17:05', '19:15', '20:10', '21:05'];

@Component
export struct NativeScheduleBody {
  @ObjectLink store: NativeScheduleStore;
  @Prop view: NativeScheduleStore = new NativeScheduleStore();
  @Prop contentHeight: number = 540;
  @Prop pageWidth: number = 360;
  onLogin: () => void = () => undefined;
  onAddSlot: (day: number, slot: number) => void = () => undefined;
  onCourse: (block: NativeCourseBlock) => void = () => undefined;

  build() {
    Scroll() {
      Column() {
        if (this.view.viewMode === 'day' && this.view.calendar) this.dayStrip()
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
    Column({ space: 4 }) {
      Text(DAYS[day - 1]).fontSize(12).fontWeight(FontWeight.Bold).fontColor(this.textColor())
      Text(this.dateLabel(day)).fontSize(10).fontWeight(FontWeight.Medium).fontColor(this.secondaryColor())
    }.width('100%').height(44).justifyContent(FlexAlign.Center).borderRadius(12)
      .backgroundColor(selected ? this.surfaceColor() : Color.Transparent)
      .border({ width: selected ? 0.8 : 0, color: this.store.dark ? '#484C5B' : '#DCE2F0' })
  }

  @Builder
  private dayStrip() {
    Row({ space: 2 }) {
      ForEach([1,2,3,4,5,6,7], (day: number) => {
        Button() { this.calendarDay(day, day === this.view.selectedDay) }
          .type(ButtonType.Normal).height(44).layoutWeight(1).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText(DAYS[day - 1] + ' ' + this.dateLabel(day)).accessibilitySelected(day === this.view.selectedDay)
          .onClick(() => this.store.selectDay(day))
      })
    }.width('100%').margin({ bottom: 8 })
  }

  @Builder
  private weekSchedule() {
    Column({ space: 6 }) {
      Row({ space: 4 }) {
        Text('节次').fontSize(11).fontWeight(FontWeight.Medium).fontColor(this.secondaryColor()).width(38).height(44).textAlign(TextAlign.Center)
        ForEach([1,2,3,4,5,6,7], (day: number) => {
          Button() { this.calendarDay(day, this.view.isToday(day)) }
            .type(ButtonType.Normal).height(44).layoutWeight(1).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText(DAYS[day - 1] + '，' + this.dateLabel(day) + '，查看当天课程')
            .onClick(() => { this.store.selectDay(day); this.store.setViewMode('day'); })
        })
      }.width('100%')
      Row({ space: 4 }) {
        Column() { ForEach(SLOTS, (slot: number) => { this.slotAxis(slot, false) }) }.width(38)
        ForEach([1,2,3,4,5,6,7], (day: number) => {
          Stack({ alignContent: Alignment.TopStart }) {
            Column() {
              ForEach(SLOTS, (slot: number) => {
                Column().width('100%').height(this.weekStride() - 5).margin({ bottom: 5 })
                  .backgroundColor(this.cellColor()).borderRadius(9)
                  .accessibilityText(DAYS[day - 1] + '第' + slot + '节，添加课程')
                  .onClick(() => { if (this.store.source !== 'graduate') this.onAddSlot(day, slot); })
              })
            }.width('100%')
            ForEach(this.view.blocksForDay(day), (block: NativeCourseBlock) => {
              Column({ space: 4 }) {
                Text(block.course.name).fontSize(this.pageWidth <= 390 ? 10 : 11).fontWeight(FontWeight.Bold)
                  .minFontSize(9).maxFontSize(this.pageWidth <= 390 ? 10 : 11)
                  .heightAdaptivePolicy(TextHeightAdaptivePolicy.MIN_FONT_SIZE_FIRST)
                  .fontColor(this.toneText(block.course.name)).width('100%').textAlign(TextAlign.Center)
                  .maxLines(block.endSlot === block.startSlot ? 2 : block.endSlot - block.startSlot < 2 ? 3 : 6)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (block.course.location && block.endSlot > block.startSlot) {
                  Text('@' + block.course.location).fontSize(10).fontWeight(FontWeight.Bold)
                    .minFontSize(8).maxFontSize(10).heightAdaptivePolicy(TextHeightAdaptivePolicy.MIN_FONT_SIZE_FIRST)
                    .fontColor(this.toneAccent(block.course.name)).width('100%').textAlign(TextAlign.Center)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                if (this.overlapCount(block) > 1 && block.endSlot > block.startSlot) {
                  Text(`+${this.overlapCount(block) - 1} 门`).fontSize(8).fontColor(this.toneAccent(block.course.name)).maxLines(1)
                }
              }.width('100%').height((block.endSlot - block.startSlot + 1) * this.weekStride() - 5).clip(true)
                .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center).padding({ left: 2, right: 2, top: 4, bottom: 4 }).borderRadius(9)
                .backgroundColor(this.toneFill(block.course.name)).border({ width: 1, color: this.toneBorder(block.course.name) })
                .position({ x: 0, y: (block.startSlot - 1) * this.weekStride() })
                .accessibilityText(this.courseAccessibility(block)).onClick(() => this.onCourse(block))
            })
          }.height(this.weekStride() * 11).layoutWeight(1)
        })
      }.width('100%').alignItems(VerticalAlign.Top)
    }.width('100%')
  }

  @Builder
  private slotAxis(slot: number, dayView: boolean) {
    Column({ space: 2 }) {
      Text(String(slot)).fontSize(12).fontWeight(FontWeight.Bold).fontColor(this.textColor())
      Text(SLOT_STARTS[slot - 1]).fontSize(9).fontColor(this.secondaryColor())
      Text(SLOT_ENDS[slot - 1]).fontSize(9).fontColor(this.secondaryColor())
    }.height(dayView ? this.dayStride() : this.weekStride()).width('100%').justifyContent(FlexAlign.Center)
  }

  @Builder
  private daySchedule() {
    Row({ space: 10 }) {
      Column() { ForEach(SLOTS, (slot: number) => { this.slotAxis(slot, true) }) }.width(38)
      Stack({ alignContent: Alignment.TopStart }) {
        Column() {
          ForEach(SLOTS, (slot: number) => {
            Column().width('100%').height(this.dayStride() - 4).margin({ bottom: 4 })
              .backgroundColor(this.cellColor()).borderRadius(10)
              .border({ width: 0.5, color: $r('app.color.app_divider') })
              .accessibilityText('第' + slot + '节，添加课程')
              .onClick(() => { if (this.store.source !== 'graduate') this.onAddSlot(this.view.selectedDay, slot); })
          })
        }.width('100%')
        ForEach(this.view.blocksForDay(this.view.selectedDay), (block: NativeCourseBlock) => {
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
            .padding(0).clip(true).backgroundColor(this.toneFill(block.course.name)).border({ width: 1, color: this.toneBorder(block.course.name), radius: 12 })
            .position({ x: 0, y: (block.startSlot - 1) * this.dayStride() + 2 })
            .accessibilityText(this.courseAccessibility(block)).onClick(() => this.onCourse(block))
        })
      }.layoutWeight(1).height(this.dayStride() * 11)
    }.width('100%').alignItems(VerticalAlign.Top)
  }

  private overlapCount(block: NativeCourseBlock): number {
    return this.view.blocksForDay(block.day).filter((item: NativeCourseBlock) => item.startSlot <= block.endSlot && item.endSlot >= block.startSlot).length;
  }
  private courseAccessibility(block: NativeCourseBlock): string {
    return DAYS[block.day - 1] + '，' + block.course.name + '，第' + block.startSlot + '至' + block.endSlot + '节，' + (block.course.location || '');
  }
  private weekStride(): number { return Math.max(36, (this.contentHeight - 62) / 11); }
  private dayStride(): number { return Math.max(48, (this.contentHeight - 60) / 11); }
  private dateLabel(day: number): string {
    const date = this.view.dayDate(day);
    return date ? date.replace('-', '.') : '—';
  }
  private textColor(): string { return this.store.dark ? '#F5F5F7' : '#151518'; }
  private secondaryColor(): string { return this.store.dark ? '#A6A6B0' : '#72727D'; }
  private surfaceColor(): string { return this.store.dark ? '#303139' : '#FFFFFF'; }
  private softSurfaceColor(): string { return this.store.dark ? '#25252B' : '#E7E7ED'; }
  private cellColor(): string { return this.store.dark ? '#202023' : '#FFFFFF'; }
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

}

