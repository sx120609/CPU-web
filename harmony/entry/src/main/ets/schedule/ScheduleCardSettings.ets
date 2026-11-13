import {
  ScheduleWidgetDisplayOptions,
  WIDGET_TEXT_SIZES,
  defaultWidgetDisplayOptions,
  widgetTextSizeLabel
} from '../common/ScheduleWidgetOptions';

// 「桌面与锁屏服务卡片」面板里的显示开关，分组和文案照 iOS「设备与设置 › iPhone 小组件」：
// 课程信息、文字与排版、日期栏。改一项就整份交回去，由面板保存并刷新卡片。
@Component
export struct ScheduleCardSettings {
  @Prop options: ScheduleWidgetDisplayOptions = defaultWidgetDisplayOptions();
  onChange: (options: ScheduleWidgetDisplayOptions) => void = () => {};

  private flag(key: string): boolean {
    const options = this.options;
    if (key === 'showCourseName') return options.showCourseName;
    if (key === 'showRoom') return options.showRoom;
    if (key === 'showTeacher') return options.showTeacher;
    if (key === 'showTime') return options.showTime;
    if (key === 'showProgress') return options.showProgress;
    if (key === 'hideCompleted') return options.hideCompleted;
    if (key === 'showWeek') return options.showWeek;
    if (key === 'showLunarDate') return options.showLunarDate;
    if (key === 'showHoliday') return options.showHoliday;
    return options.holidayAlwaysVisible;
  }

  private copy(): ScheduleWidgetDisplayOptions {
    return JSON.parse(JSON.stringify(this.options)) as ScheduleWidgetDisplayOptions;
  }

  private setFlag(key: string, value: boolean): void {
    if (this.flag(key) === value) return;
    const next = this.copy();
    if (key === 'showCourseName') next.showCourseName = value;
    else if (key === 'showRoom') next.showRoom = value;
    else if (key === 'showTeacher') next.showTeacher = value;
    else if (key === 'showTime') next.showTime = value;
    else if (key === 'showProgress') next.showProgress = value;
    else if (key === 'hideCompleted') next.hideCompleted = value;
    else if (key === 'showWeek') next.showWeek = value;
    else if (key === 'showLunarDate') next.showLunarDate = value;
    else if (key === 'showHoliday') next.showHoliday = value;
    else next.holidayAlwaysVisible = value;
    this.onChange(next);
  }

  private setTextSize(size: string): void {
    if (this.options.textSize === size) return;
    const next = this.copy();
    next.textSize = size;
    this.onChange(next);
  }

  // 「最近节假日常驻」跟着「节假日提示」：提示关了它就不起作用。
  private optionEnabled(key: string): boolean {
    return key !== 'holidayAlwaysVisible' || this.options.showHoliday;
  }

  @Builder
  private toggleRow(label: string, key: string, first: boolean) {
    Row({ space: 12 }) {
      Text(label).fontSize(16).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
        .opacity(this.optionEnabled(key) ? 1 : 0.4)
      Toggle({ type: ToggleType.Switch, isOn: this.flag(key) }).selectedColor($r('app.color.app_accent'))
        .enabled(this.optionEnabled(key))
        .accessibilityText(label)
        .id('card-option-' + key)
        .onChange((value: boolean) => this.setFlag(key, value))
    }.width('100%').padding({ left: 14, right: 14, top: 8, bottom: 8 })
    .border({ width: { top: first ? 0 : 0.5 }, color: $r('app.color.app_divider') })
  }

  @Builder
  private heading(title: string) {
    Text(title).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.app_text_primary')).width('100%')
  }

  @Builder
  private footnote(text: string) {
    Text(text).fontSize(12).fontColor($r('app.color.app_text_tertiary')).width('100%')
  }

  build() {
    Column({ space: 20 }) {
      Column({ space: 8 }) {
        this.heading('课程信息')
        Column() {
          this.toggleRow('课程名称', 'showCourseName', true)
          this.toggleRow('教室', 'showRoom', false)
          this.toggleRow('老师', 'showTeacher', false)
          this.toggleRow('上课时间', 'showTime', false)
        }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
      }.width('100%')
      Column({ space: 8 }) {
        this.heading('文字与排版')
        Column() {
          Row({ space: 12 }) {
            Text('文字大小').fontSize(16).fontColor($r('app.color.app_text_primary')).layoutWeight(1)
            Row({ space: 2 }) {
              ForEach(WIDGET_TEXT_SIZES, (size: string) => {
                Button(widgetTextSizeLabel(size)).type(ButtonType.Normal).height(30).borderRadius(8)
                  .padding({ left: 10, right: 10 }).fontSize(13)
                  .fontWeight(this.options.textSize === size ? 600 : 400)
                  .fontColor(this.options.textSize === size ? $r('app.color.app_accent') : $r('app.color.app_text_secondary'))
                  .backgroundColor(this.options.textSize === size ? $r('app.color.app_surface') : Color.Transparent)
                  .accessibilitySelected(this.options.textSize === size)
                  .id('card-text-size-' + size)
                  .onClick(() => this.setTextSize(size))
              }, (size: string) => size)
            }.padding(2).borderRadius(10).backgroundColor($r('app.color.app_divider'))
          }.width('100%').padding({ left: 14, right: 14, top: 8, bottom: 8 })
          this.toggleRow('上课倒计时与进度', 'showProgress', false)
          this.toggleRow('隐藏已上完的课', 'hideCompleted', false)
        }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
        this.footnote('文字和间距一起缩放，放不下的课收进“后面还有几门”；“自适应”在课少时放大。倒计时在上课前一小时出现。')
      }.width('100%')
      Column({ space: 8 }) {
        this.heading('日期栏')
        Column() {
          this.toggleRow('周次', 'showWeek', true)
          this.toggleRow('农历日期', 'showLunarDate', false)
          this.toggleRow('节假日提示', 'showHoliday', false)
          this.toggleRow('最近节假日常驻', 'holidayAlwaysVisible', false)
        }.width('100%').borderRadius(16).backgroundColor($r('app.color.app_control')).clip(true)
      }.width('100%')
    }.width('100%')
  }
}
