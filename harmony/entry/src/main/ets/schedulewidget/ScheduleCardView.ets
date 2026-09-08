import { harmonyCourseColor } from '../schedule/ScheduleDesign';

interface WidgetCourseRow {
  name: string;
  start: string;
  time: string;
  meta: string;
  ended: boolean;
  accent: string;
  tint: string;
}

@Component
export struct ScheduleCardView {
  @Prop state: string = 'loading';
  @Prop title: string = '药大课表';
  @Prop subtitle: string = '正在同步课程';
  @Prop leftTitle: string = '';
  @Prop rightTitle: string = '';
  @Prop primaryCourses: string = '[]';
  @Prop secondaryCourses: string = '[]';
  @Prop footer: string = '';
  @Prop theme: string = 'color-glass';
  @Prop accent: string = '#6D5DFC';
  @Prop semester: string = '';
  @Prop currentWeek: number = 0;
  @Prop primaryWeek: number = 0;
  @Prop secondaryWeek: number = 0;
  @Prop primaryRemaining: number = 0;
  @Prop secondaryRemaining: number = 0;
  @Prop dimension: number = 2;
  @Prop variant: string = 'desktop';
  @Prop layout: string = '';

  private rows(value: string): WidgetCourseRow[] {
    try {
      const rows = JSON.parse(value) as WidgetCourseRow[];
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  private effectiveLayout(): string {
    return this.layout || (this.dimension === 2 ? 'upcoming' : this.dimension === 3 ? 'today' : 'two-day');
  }

  private isLockScreen(): boolean {
    return this.variant.startsWith('lock-');
  }

  private firstCourse(): WidgetCourseRow | undefined {
    return this.rows(this.primaryCourses)[0];
  }

  private courseAccent(course: WidgetCourseRow): string {
    return harmonyCourseColor(course.name, this.theme, false).accent;
  }

  @Builder
  private dateHeader(title: string, week: number) {
    Row({ space: 5 }) {
      Text(title.split(' ')[0]).fontSize(this.dimension === 2 ? 12 : 14).fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.app_text_primary')).maxLines(1)
      Text(title.split(' ').slice(1).join(' ')).fontSize(10)
        .fontColor($r('app.color.app_text_secondary')).maxLines(1)
      Blank()
      if (this.footer) {
        Text('缓存').fontSize(8).fontColor($r('app.color.app_text_secondary')).maxLines(1)
      } else if (week > 0) {
        Text(`第${week}周`).fontSize(9).fontColor($r('app.color.app_text_secondary')).maxLines(1)
      }
    }.width('100%').height(20).alignItems(VerticalAlign.Center)
  }

  @Builder
  private emptyCourses(message: string) {
    Column({ space: 8 }) {
      SymbolGlyph($r('sys.symbol.calendar')).fontSize(22).fontColor([$r('app.color.app_text_tertiary')])
      Text(message).fontSize(12).fontColor($r('app.color.app_text_secondary'))
    }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
  }

  @Builder
  private upcomingView() {
    Column({ space: 0 }) {
      this.dateHeader(this.leftTitle, this.primaryWeek)
      if (this.rows(this.primaryCourses).length === 0) {
        this.emptyCourses('近期没有课程')
      } else if (this.dimension === 3) {
        Row({ space: 14 }) {
          this.upcomingColumn('当前', 0)
          Divider().vertical(true).height(84).color($r('app.color.app_divider'))
          this.upcomingColumn('接下来', 1)
        }.width('100%').layoutWeight(1).alignItems(VerticalAlign.Center)
      } else {
        Blank().height(4)
        this.courseSummary(this.rows(this.primaryCourses)[0], true)
        Blank().layoutWeight(1)
        if (this.rows(this.primaryCourses).length > 1) {
          Text('接下来').fontSize(9).fontColor($r('app.color.app_text_secondary')).height(12)
          Row({ space: 7 }) {
            Column().width(2).height(24).borderRadius(1).backgroundColor(this.courseAccent(this.rows(this.primaryCourses)[1]))
            Column({ space: 1 }) {
              Text(this.rows(this.primaryCourses)[1].name).fontSize(11).fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.app_text_primary')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(this.rows(this.primaryCourses)[1].time).fontSize(9).fontColor($r('app.color.app_text_secondary')).maxLines(1)
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          }.width('100%').height(25)
        }
      }
    }.width('100%').height('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private courseSummary(course: WidgetCourseRow, compact: boolean) {
    Row({ space: 7 }) {
      Column().width(2).height(compact ? 55 : 58).borderRadius(1).backgroundColor(this.courseAccent(course))
      Column({ space: 2 }) {
        Text(course.name).fontSize(13).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.app_text_primary')).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(course.meta).fontSize(compact ? 9 : 10).fontColor($r('app.color.app_text_secondary'))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(course.time).fontSize(10).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.app_text_primary')).maxLines(1)
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }.width('100%').height(compact ? 58 : 64)
  }

  @Builder
  private upcomingColumn(label: string, index: number) {
    Column({ space: 6 }) {
      Text(label).fontSize(10).fontColor($r('app.color.app_text_secondary'))
      if (this.rows(this.primaryCourses).length > index) {
        this.courseSummary(this.rows(this.primaryCourses)[index], false)
      } else {
        Text('暂无课程').fontSize(13).fontColor($r('app.color.app_text_secondary'))
      }
    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
  }

  @Builder
  private todayCourseRow(course: WidgetCourseRow, narrow: boolean) {
    Row({ space: narrow ? 7 : 9 }) {
      Column().width(2).height(narrow ? 40 : 25).borderRadius(1).backgroundColor(this.courseAccent(course))
      Column({ space: 3 }) {
        Text(course.name).fontSize(narrow ? 12 : 13).fontWeight(FontWeight.Medium)
          .fontColor(course.ended ? $r('app.color.app_text_secondary') : $r('app.color.app_text_primary'))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(course.meta).fontSize(10).fontColor($r('app.color.app_text_secondary'))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (narrow) {
          Text(course.time).fontSize(11).fontWeight(FontWeight.Medium).maxLines(1)
            .fontColor(course.ended ? $r('app.color.app_text_secondary') : $r('app.color.app_text_primary'))
        }
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      if (!narrow) {
        Text(course.time).fontSize(this.dimension === 3 ? 10 : 11).fontWeight(FontWeight.Medium)
          .fontColor(course.ended ? $r('app.color.app_text_secondary') : $r('app.color.app_text_primary')).maxLines(1)
      }
    }.width('100%').height(narrow ? 45 : this.dimension === 3 ? 40 : 34)
  }

  @Builder
  private todayView() {
    Column({ space: this.dimension === 3 ? 7 : 6 }) {
      this.dateHeader(this.leftTitle, this.primaryWeek)
      if (this.rows(this.primaryCourses).length === 0) {
        this.emptyCourses('今天没有课程')
      } else {
        ForEach(this.rows(this.primaryCourses), (course: WidgetCourseRow) => {
          this.todayCourseRow(course, false)
        }, (course: WidgetCourseRow) => `${course.time}|${course.name}|${course.meta}`)
        if (this.primaryRemaining > 0) {
          Text(`还有 ${this.primaryRemaining} 门`).width('100%').fontSize(9)
            .fontColor($r('app.color.app_text_secondary')).textAlign(TextAlign.End)
        }
      }
    }.width('100%').height('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private dayColumn(title: string, week: number, value: string, remaining: number) {
    Column({ space: 8 }) {
      this.dateHeader(title, week)
      if (this.rows(value).length === 0) {
        this.emptyCourses('没有课程')
      } else {
        ForEach(this.rows(value), (course: WidgetCourseRow) => {
          this.todayCourseRow(course, true)
        }, (course: WidgetCourseRow) => `${course.time}|${course.name}|${course.meta}`)
      }
      if (remaining > 0) {
        Text(`还有 ${remaining} 门`).fontSize(9).fontColor($r('app.color.app_text_secondary'))
      }
    }.height('100%').alignItems(HorizontalAlign.Start).layoutWeight(1)
  }

  @Builder
  private twoDayView() {
    Row({ space: 14 }) {
      this.dayColumn(this.leftTitle, this.primaryWeek, this.primaryCourses, this.primaryRemaining)
      Divider().vertical(true).height('100%').strokeWidth(0.5).color($r('app.color.app_divider'))
      this.dayColumn(this.rightTitle, this.secondaryWeek, this.secondaryCourses, this.secondaryRemaining)
    }.width('100%').height('100%').alignItems(VerticalAlign.Top)
  }

  @Builder
  private statusView() {
    Column({ space: 8 }) {
      Text('课')
        .width(34)
        .height(34)
        .borderRadius(11)
        .textAlign(TextAlign.Center)
        .fontSize(17)
        .fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF')
        .backgroundColor(this.accent)
      Text(this.state === 'loading' ? '正在同步课程' : this.subtitle)
        .fontSize(15)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.app_text_primary'))
        .textAlign(TextAlign.Center)
      Text(this.footer)
        .fontSize(10)
        .fontColor($r('app.color.app_text_secondary'))
        .textAlign(TextAlign.Center)
        .maxLines(this.dimension === 2 ? 3 : 2)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  private lockInlineView() {
    Row({ space: 7 }) {
      SymbolGlyph(this.firstCourse() ? $r('sys.symbol.book_pages') : $r('sys.symbol.calendar'))
        .fontSize(10)
        .fontWeight(FontWeight.Bold)
        .fontColor(['#FFFFFFFF'])
      if (this.firstCourse()) {
        Text(`${this.leftTitle} ${this.firstCourse()?.start ?? '--:--'} ${this.firstCourse()?.name ?? '课程'}`)
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      } else {
        Text(`${this.leftTitle} 近期无课`)
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
      }
    }
    .width('100%')
    .height('100%')
    .padding({ left: 14, right: 14 })
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  private lockCircularView() {
    Column({ space: 1 }) {
      SymbolGlyph(this.firstCourse() ? $r('sys.symbol.book_pages') : $r('sys.symbol.calendar'))
        .fontSize(this.firstCourse() ? 11 : 16).fontColor(['#FFFFFFFF'])
      if (this.firstCourse()) {
        Text(this.firstCourse()?.start ?? '--:--')
          .fontSize(this.dimension === 3 ? 13 : 15)
          .minFontSize(11).maxFontSize(this.dimension === 3 ? 13 : 15)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
        Text(this.firstCourse()?.name ?? '课程')
          .fontSize(9)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      } else {
        Text('无课')
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFFFF')
      }
    }
    .width('100%')
    .height('100%')
    .padding(7)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  private lockRectangularView() {
    Column({ space: 3 }) {
      Row({ space: 5 }) {
        SymbolGlyph(this.firstCourse() ? $r('sys.symbol.book_pages') : $r('sys.symbol.calendar'))
          .fontSize(9)
          .fontWeight(FontWeight.Bold)
          .fontColor(['#FFFFFFFF'])
        Text(this.leftTitle)
          .fontSize(10)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
        Blank()
        if (this.rows(this.primaryCourses).length > 1) {
          Text(`下一节 ${this.rows(this.primaryCourses)[1].start}`)
            .fontSize(9)
            .fontColor('#CCFFFFFF')
            .maxLines(1)
        }
      }
      .width('100%')
      if (this.firstCourse()) {
        Text(this.firstCourse()?.name ?? '课程')
          .width('100%')
          .fontSize(this.dimension === 3 ? 13 : 15)
          .minFontSize(11).maxFontSize(this.dimension === 3 ? 13 : 15)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(`${this.firstCourse()?.time ?? ''} · ${this.firstCourse()?.meta ?? ''}`)
          .width('100%')
          .fontSize(10)
          .fontColor('#E6FFFFFF')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      } else {
        Text('近期没有课程')
          .width('100%')
          .fontSize(this.dimension === 3 ? 13 : 15)
          .minFontSize(11).maxFontSize(this.dimension === 3 ? 13 : 15)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFFFF')
        Text('打开课表查看本周安排')
          .width('100%')
          .fontSize(10)
          .fontColor('#E6FFFFFF')
      }
    }
    .width('100%')
    .height('100%')
    .padding({ left: 14, right: 14, top: 11, bottom: 11 })
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private lockStatusView() {
    if (this.variant === 'lock-circular') {
      Column({ space: 2 }) {
        Text(this.state === 'loading' ? '↻' : '!')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFFFF')
        Text(this.state === 'loading' ? '同步中' : '打开 App')
          .fontSize(9)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
    } else if (this.variant === 'lock-inline') {
      Row({ space: 7 }) {
        Text(this.state === 'loading' ? '↻' : '!')
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFFFF')
        Text(this.state === 'loading' ? '正在同步课程' : this.subtitle)
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
      }
      .width('100%')
      .height('100%')
      .padding({ left: 14, right: 14 })
      .alignItems(VerticalAlign.Center)
    } else {
      Column({ space: 3 }) {
        Text(this.state === 'loading' ? '正在同步课程' : this.subtitle)
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
        Text(this.footer)
          .fontSize(10)
          .fontColor('#E6FFFFFF')
          .maxLines(2)
      }
      .width('100%')
      .height('100%')
      .padding({ left: 14, right: 14 })
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Start)
    }
  }

  build() {
    Column({ space: 5 }) {
      Column() {
      if (this.isLockScreen() && this.state !== 'ready') {
        this.lockStatusView()
      } else if (this.variant === 'lock-inline') {
        this.lockInlineView()
      } else if (this.variant === 'lock-circular') {
        this.lockCircularView()
      } else if (this.variant === 'lock-rectangular') {
        this.lockRectangularView()
      } else if (this.state !== 'ready') {
        this.statusView()
      } else if (this.effectiveLayout() === 'upcoming') {
        this.upcomingView()
      } else if (this.effectiveLayout() === 'today') {
        this.todayView()
      } else {
        this.twoDayView()
      }
      }.width('100%').layoutWeight(1)

    }
    .width('100%')
    .height('100%')
    .padding(this.isLockScreen() ? 0 : (this.dimension === 2 ? 12 : 16))
    .backgroundColor(this.isLockScreen() ? Color.Transparent : $r('app.color.widget_background'))
    .borderRadius(this.isLockScreen() ? 0 : 22)

  }
}
