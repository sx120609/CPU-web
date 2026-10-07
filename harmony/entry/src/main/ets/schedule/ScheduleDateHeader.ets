import { scheduleAlpha, scheduleMetaText, scheduleStyleAccent, scheduleStyleCanvas, scheduleStyleCellBorder,
  scheduleStyleDateSize, scheduleStyleDateText, scheduleStyleFont, scheduleStyleInk, scheduleStyleLayout,
  scheduleThemeFill, scheduleThemeText, scheduleThemeTint, scheduleWeekday } from './ScheduleStyle';

const SHORT_DAYS: string[] = ['一', '二', '三', '四', '五', '六', '日'];
const OFF_BADGE: string = '#E11D48';
const SWAP_BADGE: string = '#C2410C';

// One day of the date row in the styles that came from NapTable. The week view draws it over each
// column; the day view's seven-day strip draws the same header as a control, so switching between the
// two views keeps the row in place. There, today and the selected day each keep a mark of their own.
@Component
export struct ScheduleStyledDateHeader {
  @Prop visualStyle: string = 'minimal';
  @Prop dark: boolean = false;
  @Prop palette: string = 'color-glass';
  // Weekday, 1–7.
  @Prop day: number = 1;
  // Day of the month, 「9」; 「–」 without a calendar.
  @Prop date: string = '–';
  @Prop today: boolean = false;
  // '', 'off' or 'swap'.
  @Prop adjustment: string = '';
  // -1 in the week header. The day strip passes 1 for its selected day and 0 for the others.
  @Prop selected: number = -1;
  // The first cell of the strip: the table rules only between its days.
  @Prop leading: boolean = false;

  build() {
    Stack({ alignContent: Alignment.TopEnd }) {
      if (this.visualStyle === 'minimal') {
        // The day of the month above, the weekday below; the selected day sits on a pale rounded tile.
        Column({ space: 3 }) {
          Text(this.date).fontSize(this.selected >= 0 ? 17 : 16).fontWeight(this.selected >= 0 ? 600 : FontWeight.Bold).maxLines(1)
            .fontColor(this.picked() || this.today ? this.themeText() : this.styleInk())
          Text(this.today ? '今天' : scheduleWeekday(this.day)).fontSize(11).fontWeight(this.selected >= 0 ? FontWeight.Medium : 600).maxLines(1)
            .fontColor(this.picked() || this.today ? this.themeText() : scheduleMetaText(this.dark))
        }.width('100%').height('100%').justifyContent(FlexAlign.Center).padding({ top: this.selected >= 0 ? 0 : 6 })
          .borderRadius(12)
          .backgroundColor(this.picked() ? scheduleThemeTint(this.palette, this.dark ? 0.2 : 0.1) : Color.Transparent)
        // The week header places its own mark over the column.
        if (this.selected >= 0 && this.adjustment) {
          Column() { this.badge() }.margin({ top: 4, right: 3 })
        }
      } else {
        Column({ space: 3 }) {
          if (this.visualStyle === 'grid') {
            Text(SHORT_DAYS[Math.max(0, Math.min(6, this.day - 1))]).fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.ink()).maxLines(1)
          } else {
            Text(this.today ? (this.visualStyle === 'paper' ? '今日' : '今天') : scheduleWeekday(this.day))
              .fontSize(11).fontWeight(600).fontColor(this.ink()).maxLines(1).fontFamily(scheduleStyleFont(this.visualStyle))
          }
          Row({ space: 2 }) {
            Text(scheduleStyleDateText(this.visualStyle, this.date)).fontSize(scheduleStyleDateSize(this.visualStyle, this.selected >= 0))
              .fontWeight(this.visualStyle === 'board' ? FontWeight.Bold : FontWeight.Medium)
              .fontColor(this.ink()).maxLines(1).fontFamily(scheduleStyleFont(this.visualStyle))
              .padding({ left: this.visualStyle === 'paper' ? 4 : 0, right: this.visualStyle === 'paper' ? 4 : 0 })
              .borderRadius(10)
              .border({ width: this.visualStyle === 'paper' && this.today ? 1 : 0, color: this.accent(), radius: 10 })
            if (this.adjustment) this.mark()
          }.justifyContent(FlexAlign.Center)
        }.width('100%').height('100%').justifyContent(FlexAlign.Center)
          .backgroundColor(this.fill())
          .borderRadius(this.framed() ? scheduleStyleLayout(this.visualStyle).cornerRadius : 0)
          .border(this.edges())
      }
    }.width('100%').height('100%')
  }

  @Builder
  private badge() {
    Text(this.adjustment === 'off' ? '休' : '班').fontSize(8).fontWeight(600).fontColor('#FFFFFF')
      .width(12).height(12).textAlign(TextAlign.Center).borderRadius(3)
      .backgroundColor(this.adjustment === 'off' ? OFF_BADGE : SWAP_BADGE).accessibilityLevel('no')
  }

  @Builder
  private mark() {
    if (this.visualStyle === 'paper' || this.visualStyle === 'board') {
      // A solid seal for a day off, an outlined one for a make-up day.
      Text(this.adjustment === 'off' ? '休' : '班').fontSize(9).fontWeight(FontWeight.Bold)
        .fontFamily(scheduleStyleFont(this.visualStyle))
        .fontColor(this.adjustment === 'off' ? this.sealPaper() : this.sealInk())
        .width(13).height(13).textAlign(TextAlign.Center)
        .backgroundColor(this.adjustment === 'off' ? this.sealInk() : Color.Transparent)
        .border({ width: 1, color: this.sealInk() }).accessibilityLevel('no')
    } else {
      this.badge()
    }
  }

  private edges(): BorderOptions {
    if (this.framed()) {
      // A course tile of the grid: pale fill inside a border of the same colour.
      return { width: scheduleStyleLayout(this.visualStyle).borderWidth, color: this.themeText(),
        radius: scheduleStyleLayout(this.visualStyle).cornerRadius };
    }
    // The board keeps its bar under today until that day is the selected one.
    const widths: EdgeWidths = { bottom: this.visualStyle === 'board' && this.today && !this.picked() ? 3 : 0,
      left: this.visualStyle === 'table' && !this.leading ? 0.6 : 0 };
    const colors: EdgeColors = { bottom: this.accent(), left: scheduleStyleCellBorder(this.dark) };
    return { width: widths, color: colors };
  }

  private picked(): boolean { return this.selected === 1; }
  // The table fills one whole cell: today in the week header, the selected day in the strip.
  private filled(): boolean { return this.visualStyle === 'table' && (this.selected >= 0 ? this.picked() : this.today); }
  // The board inverts the selected day, as its month view does.
  private inked(): boolean { return this.visualStyle === 'board' && this.picked(); }
  private framed(): boolean { return this.visualStyle === 'grid' && this.picked(); }
  private themeText(): string { return scheduleThemeText(this.palette, this.dark); }
  private styleInk(): string { return scheduleStyleInk(this.visualStyle, this.dark); }
  private accent(): string { return scheduleStyleAccent(this.visualStyle, this.dark, this.themeText()); }
  private canvas(): string { return scheduleStyleCanvas(this.visualStyle, this.dark) || '#FFFFFF'; }

  private ink(): string {
    if (this.filled()) return '#FFFFFF';
    if (this.inked()) return this.canvas();
    return this.today ? this.accent() : this.styleInk();
  }

  private fill(): string {
    if (this.filled()) return scheduleThemeFill(this.palette);
    if (this.inked()) return this.styleInk();
    if (this.framed()) return scheduleThemeTint(this.palette, this.dark ? 0.2 : 0.1);
    // Paper washes the selected day the way its week view washes today's column.
    if (this.picked()) return scheduleAlpha(this.accent(), this.dark ? 0.16 : 0.08);
    return '#00000000';
  }

  // On the board's inverted block the seal trades ink and paper.
  private sealInk(): string { return this.inked() ? this.canvas() : this.accent(); }
  private sealPaper(): string { return this.inked() ? this.styleInk() : this.canvas(); }
}
