interface WidgetCourseRow {
  name: string;
  time: string;
  meta: string;
  ended: boolean;
  accent: string;
  tint: string;
}

const storage = new LocalStorage();

@Entry(storage)
@Component
struct ScheduleCard {
  @LocalStorageProp('state') private state: string = 'loading';
  @LocalStorageProp('title') private title: string = '药大课表';
  @LocalStorageProp('subtitle') private subtitle: string = '正在同步课程';
  @LocalStorageProp('leftTitle') private leftTitle: string = '';
  @LocalStorageProp('rightTitle') private rightTitle: string = '';
  @LocalStorageProp('primaryCourses') private primaryCourses: string = '[]';
  @LocalStorageProp('secondaryCourses') private secondaryCourses: string = '[]';
  @LocalStorageProp('footer') private footer: string = '';
  @LocalStorageProp('theme') private theme: string = 'color-glass';
  @LocalStorageProp('accent') private accent: string = '#6D5DFC';
  @LocalStorageProp('semester') private semester: string = '';
  @LocalStorageProp('currentWeek') private currentWeek: number = 0;
  @LocalStorageProp('primaryWeek') private primaryWeek: number = 0;
  @LocalStorageProp('secondaryWeek') private secondaryWeek: number = 0;
  @LocalStorageProp('primaryRemaining') private primaryRemaining: number = 0;
  @LocalStorageProp('secondaryRemaining') private secondaryRemaining: number = 0;
  @LocalStorageProp('dimension') private dimension: number = 2;

  private rows(value: string): WidgetCourseRow[] {
    try {
      return JSON.parse(value) as WidgetCourseRow[];
    } catch (_) {
      return [];
    }
  }

  private targetUrl(): string {
    let url = 'cpuweb://schedule?source=widget&week=current';
    if (this.semester) url += `&widgetSemester=${encodeURIComponent(this.semester)}`;
    if (this.currentWeek >= 1 && this.currentWeek <= 64) url += `&widgetWeek=${this.currentWeek}`;
    return url;
  }

  @Builder
  private dateHeader(title: string, week: number) {
    Row({ space: 6 }) {
      Text(title)
        .fontSize(this.dimension === 4 ? 14 : 16)
        .fontWeight(FontWeight.Bold)
        .fontColor('#0F172A')
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Blank()
      if (this.subtitle) {
        Text(this.subtitle)
          .fontSize(9)
          .fontWeight(FontWeight.Medium)
          .fontColor('#94A3B8')
          .maxLines(1)
      } else if (week > 0) {
        Text(`第 ${week} 周`)
          .fontSize(9)
          .fontWeight(FontWeight.Medium)
          .fontColor('#64748B')
          .maxLines(1)
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  private courseSummary(course: WidgetCourseRow) {
    Row({ space: 9 }) {
      Row()
        .width(5)
        .height(58)
        .borderRadius(3)
        .backgroundColor(course.accent)
      Column({ space: 3 }) {
        Text(course.name)
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor('#0F172A')
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(course.meta)
          .fontSize(10)
          .fontColor('#64748B')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(course.time)
          .fontSize(11)
          .fontWeight(FontWeight.Medium)
          .fontColor('#0F172A')
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
  }

  @Builder
  private compactNextCourse(course: WidgetCourseRow) {
    Row({ space: 8 }) {
      Row()
        .width(5)
        .height(27)
        .borderRadius(3)
        .backgroundColor(course.accent)
      Column({ space: 1 }) {
        Text(course.name)
          .fontSize(12)
          .fontWeight(FontWeight.Bold)
          .fontColor('#0F172A')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(course.time)
          .fontSize(9)
          .fontColor('#64748B')
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
  }

  @Builder
  private todayCourseRow(course: WidgetCourseRow, narrow: boolean) {
    Row({ space: narrow ? 6 : 9 }) {
      Row()
        .width(5)
        .height(narrow ? 39 : 40)
        .borderRadius(3)
        .backgroundColor(course.accent)
      Column({ space: 2 }) {
        Text(course.name)
          .fontSize(narrow ? 11 : 13)
          .fontWeight(FontWeight.Bold)
          .fontColor(course.ended ? '#94A3B8' : '#0F172A')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(course.meta)
          .fontSize(narrow ? 8 : 9)
          .fontColor(course.ended ? '#94A3B8' : '#64748B')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (narrow) {
          Text(course.time)
            .fontSize(9)
            .fontWeight(FontWeight.Medium)
            .fontColor(course.ended ? '#94A3B8' : '#0F172A')
            .maxLines(1)
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      if (!narrow) {
        Text(course.time)
          .fontSize(10)
          .fontWeight(FontWeight.Medium)
          .fontColor(course.ended ? '#94A3B8' : '#0F172A')
          .maxLines(1)
      }
    }
    .width('100%')
    .padding({
      left: narrow ? 7 : 9,
      right: narrow ? 7 : 9,
      top: narrow ? 4 : 6,
      bottom: narrow ? 4 : 6
    })
    .borderRadius(narrow ? 8 : 11)
    .backgroundColor(course.tint)
    .opacity(course.ended ? 0.56 : 1)
  }

  @Builder
  private emptyCourses(message: string) {
    Text(message)
      .fontSize(12)
      .fontWeight(FontWeight.Medium)
      .fontColor('#94A3B8')
      .width('100%')
      .layoutWeight(1)
      .textAlign(TextAlign.Center)
  }

  @Builder
  private upcomingView() {
    Column({ space: 0 }) {
      this.dateHeader(this.leftTitle, this.primaryWeek)
      Blank().height(8)
      if (this.rows(this.primaryCourses).length === 0) {
        this.emptyCourses('近期没有课程')
      } else {
        this.courseSummary(this.rows(this.primaryCourses)[0])
        if (this.rows(this.primaryCourses).length > 1) {
          Blank().height(7)
          Text('接下来')
            .width('100%')
            .fontSize(10)
            .fontWeight(FontWeight.Medium)
            .fontColor('#94A3B8')
          this.compactNextCourse(this.rows(this.primaryCourses)[1])
        }
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private todayView() {
    Column({ space: 7 }) {
      this.dateHeader(this.leftTitle, this.primaryWeek)
      if (this.rows(this.primaryCourses).length === 0) {
        this.emptyCourses('今天没有课程')
      } else {
        ForEach(this.rows(this.primaryCourses), (course: WidgetCourseRow) => {
          this.todayCourseRow(course, false)
        }, (course: WidgetCourseRow) => `${course.time}|${course.name}|${course.meta}`)
        if (this.primaryRemaining > 0) {
          Text(`还有 ${this.primaryRemaining} 门课程`)
            .width('100%')
            .fontSize(9)
            .fontColor('#94A3B8')
            .textAlign(TextAlign.End)
        }
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private dayColumn(title: string, week: number, value: string) {
    Column({ space: 7 }) {
      this.dateHeader(title, week)
      if (this.rows(value).length === 0) {
        this.emptyCourses('没有课程')
      } else {
        ForEach(this.rows(value), (course: WidgetCourseRow) => {
          this.todayCourseRow(course, true)
        }, (course: WidgetCourseRow) => `${course.time}|${course.name}|${course.meta}`)
      }
    }
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .layoutWeight(1)
  }

  @Builder
  private twoDayView() {
    Row({ space: 13 }) {
      this.dayColumn(this.leftTitle, this.primaryWeek, this.primaryCourses)
      Divider()
        .vertical(true)
        .height('100%')
        .strokeWidth(0.5)
        .color('#DDE5EF')
      this.dayColumn(this.rightTitle, this.secondaryWeek, this.secondaryCourses)
    }
    .width('100%')
    .height('100%')
    .alignItems(VerticalAlign.Top)
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
        .fontColor('#0F172A')
        .textAlign(TextAlign.Center)
      Text(this.footer)
        .fontSize(10)
        .fontColor('#64748B')
        .textAlign(TextAlign.Center)
        .maxLines(this.dimension === 2 ? 3 : 2)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }

  build() {
    Column() {
      if (this.state !== 'ready') {
        this.statusView()
      } else if (this.dimension === 2) {
        this.upcomingView()
      } else if (this.dimension === 3) {
        this.todayView()
      } else {
        this.twoDayView()
      }
    }
    .width('100%')
    .height('100%')
    .padding(this.dimension === 2 ? 14 : 16)
    .backgroundColor('#F8FBFF')
    .borderRadius(22)
    .onClick(() => {
      postCardAction(this, {
        action: 'router',
        abilityName: 'EntryAbility',
        params: { targetUrl: this.targetUrl() }
      });
    })
  }
}
