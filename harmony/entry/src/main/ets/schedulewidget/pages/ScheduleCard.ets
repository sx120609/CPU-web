interface WidgetCourseRow {
  name: string;
  time: string;
  meta: string;
  ended: boolean;
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
  @LocalStorageProp('semester') private semester: string = '';
  @LocalStorageProp('currentWeek') private currentWeek: number = 0;
  @LocalStorageProp('dimension') private dimension: number = 2;

  private rows(value: string): WidgetCourseRow[] {
    try {
      return JSON.parse(value) as WidgetCourseRow[];
    } catch (_) {
      return [];
    }
  }

  private accent(): string {
    if (this.theme === 'blue') return '#2563EB';
    if (this.theme === 'teal') return '#0F766E';
    if (this.theme === 'indigo') return '#4F46E5';
    if (this.theme === 'violet') return '#7C3AED';
    if (this.theme === 'orange') return '#C2410C';
    if (this.theme === 'rose') return '#BE123C';
    if (this.theme === 'slate') return '#334155';
    return '#168776';
  }

  private targetUrl(): string {
    let url = 'cpuweb://schedule?source=widget&week=current';
    if (this.semester) url += `&widgetSemester=${encodeURIComponent(this.semester)}`;
    if (this.currentWeek >= 1 && this.currentWeek <= 64) url += `&widgetWeek=${this.currentWeek}`;
    return url;
  }

  @Builder
  private header() {
    Row() {
      Column({ space: 2 }) {
        Text(this.title)
          .fontSize(this.dimension === 2 ? 16 : 18)
          .fontWeight(FontWeight.Bold)
          .fontColor('#0F172A')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.subtitle)
          .fontSize(11)
          .fontColor('#64748B')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text('课')
        .width(28)
        .height(28)
        .borderRadius(9)
        .textAlign(TextAlign.Center)
        .fontSize(14)
        .fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF')
        .backgroundColor(this.accent())
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  private courseRow(course: WidgetCourseRow, compact: boolean) {
    Row({ space: compact ? 7 : 10 }) {
      Text(course.time.substring(0, 5))
        .width(compact ? 38 : 46)
        .fontSize(compact ? 11 : 12)
        .fontWeight(FontWeight.Medium)
        .fontColor(course.ended ? '#94A3B8' : this.accent())

      Column({ space: 1 }) {
        Text(course.name)
          .fontSize(compact ? 13 : 14)
          .fontWeight(FontWeight.Medium)
          .fontColor(course.ended ? '#94A3B8' : '#172033')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (!compact) {
          Text(course.meta)
            .fontSize(10)
            .fontColor('#64748B')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding({ top: compact ? 5 : 7, bottom: compact ? 5 : 7 })
  }

  @Builder
  private courseList(value: string, compact: boolean) {
    if (this.rows(value).length === 0) {
      Column({ space: 4 }) {
        Text('今天没有课程')
          .fontSize(compact ? 14 : 15)
          .fontWeight(FontWeight.Medium)
          .fontColor('#334155')
        Text('可以安心安排自己的时间')
          .fontSize(10)
          .fontColor('#94A3B8')
      }
      .width('100%')
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
    } else {
      ForEach(this.rows(value), (course: WidgetCourseRow) => {
        this.courseRow(course, compact)
      }, (course: WidgetCourseRow) => `${course.time}|${course.name}|${course.meta}`)
    }
  }

  @Builder
  private statusView() {
    Column({ space: 8 }) {
      Text(this.state === 'loading' ? '正在同步课程' : this.subtitle)
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor('#334155')
      Text(this.footer)
        .fontSize(11)
        .fontColor('#64748B')
        .textAlign(TextAlign.Center)
        .maxLines(2)
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }

  build() {
    Column({ space: 8 }) {
      this.header()

      if (this.state !== 'ready') {
        this.statusView()
      } else if (this.dimension === 4) {
        Row({ space: 14 }) {
          Column({ space: 2 }) {
            Text(this.leftTitle).fontSize(11).fontWeight(FontWeight.Medium).fontColor(this.accent())
            this.courseList(this.primaryCourses, true)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)

          Divider().vertical(true).height('100%').strokeWidth(0.5).color('#DCE5E3')

          Column({ space: 2 }) {
            Text(this.rightTitle).fontSize(11).fontWeight(FontWeight.Medium).fontColor(this.accent())
            this.courseList(this.secondaryCourses, true)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width('100%')
        .layoutWeight(1)
      } else {
        Column() {
          this.courseList(this.primaryCourses, this.dimension === 2)
        }
        .width('100%')
        .layoutWeight(1)
      }

      Text(this.footer)
        .width('100%')
        .fontSize(9)
        .fontColor('#94A3B8')
        .textAlign(TextAlign.End)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .height('100%')
    .padding(this.dimension === 2 ? 14 : 16)
    .backgroundColor('#F7FBFA')
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
