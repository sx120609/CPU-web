import { widgetChipFill } from '../common/ScheduleWidgetPalette';

interface WidgetCourseRow {
  name: string;
  start: string;
  time: string;
  meta: string;
  ended: boolean;
  accent: string;
  tint: string;
  colorIndex?: number;
}

// 版式照 iOS ScheduleWidgets.swift 逐项对齐：pt 按 1:1 换成 vp，字号用 fp。
// 下面的行高约为字号的 1.2 倍，对应 iOS 系统字体的行高，用来算一张卡片放得下几门课。
const HEADER_HEIGHT = 24;
// 「明天的课」胶囊一行：9fp 字 11 行高 + 上下各 2 的内边距，再隔上一行 4。
const HINT_HEIGHT = 19;
// 今日课表大号一行：色条 40 + 上下各 6。
const LARGE_ROW_HEIGHT = 52;
// 今日课表中号一行：色条 29 + 上下各 3。
const MEDIUM_ROW_HEIGHT = 35;
// 两日课表一行：课名、地点、时间三行文字 40 + 上下各 4。
const TWO_DAY_ROW_HEIGHT = 48;
// 「后面还有 N 门课」：9fp 字 11 行高。
const REMAINING_HEIGHT = 11;
// 小号放两节时第一节的色条跟着文字走：课名 18 + 3 + 地点 12 + 3 + 时间 13。
const FITTED_SUMMARY_HEIGHT = 49;
// 小号第二节课的色条高。
const COMPACT_NEXT_HEIGHT = 27;

@Component
export struct ScheduleCardView {
  @Prop state: string = 'loading';
  @Prop title: string = '课表';
  @Prop subtitle: string = '正在同步课程';
  @Prop leftTitle: string = '';
  @Prop rightTitle: string = '';
  @Prop primaryCourses: string = '[]';
  @Prop secondaryCourses: string = '[]';
  @Prop footer: string = '';
  @Prop theme: string = 'color-glass';
  @Prop accent: string = '#0F8F7F';
  @Prop semester: string = '';
  @Prop currentWeek: number = 0;
  @Prop primaryWeek: number = 0;
  @Prop secondaryWeek: number = 0;
  @Prop primaryRemaining: number = 0;
  @Prop secondaryRemaining: number = 0;
  @Prop dimension: number = 2;
  @Prop variant: string = 'desktop';
  @Prop layout: string = '';
  @Prop mode: string = 'today';
  @Prop dayNote: string = '';
  @Prop badge: string = '';
  @Prop restTitle: string = '今日无课';
  @Prop restDetail: string = '';
  @Prop lockLine: string = '今日无课';
  @Prop leadLabel: string = '当前';
  @Prop trailLabel: string = '接下来';
  @Prop rightNote: string = '';
  @Prop lunar: string = '';
  @Prop badgeStatutory: boolean = false;
  @Prop rightLunar: string = '';
  @Prop rightBadge: string = '';
  @Prop rightBadgeStatutory: boolean = false;
  @Prop lockTitle: string = '';
  @Prop lockDay: string = '';
  @State private cardHeight: number = 0;

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

  // iOS 各尺寸都是 16 的内容边距；鸿蒙 2×2、2×4 卡片比 iOS 小号、中号矮一些，按比例收到 14。
  private cardPadding(): number {
    return this.isLockScreen() ? 0 : this.dimension === 4 ? 16 : 14;
  }

  private contentHeight(): number {
    const height = this.cardHeight > 0 ? this.cardHeight : this.dimension === 4 ? 340 : 158;
    return height - this.cardPadding() * 2;
  }

  private headerHeight(hint: string): number {
    return HEADER_HEIGHT + (hint ? HINT_HEIGHT : 0);
  }

  // 已计算好的课程色（单色主题就是主题色）。
  private courseAccent(course: WidgetCourseRow): string {
    return course.accent || this.accent;
  }

  // 课程块底色：浅色是各自的浅底，深色是强调色叠 18%，由资源随系统深浅色切换。
  private courseTint(course: WidgetCourseRow): Resource {
    if (this.theme === 'color-glass') {
      const glass: Resource[] = [$r('app.color.widget_tint_glass_0'), $r('app.color.widget_tint_glass_1'),
        $r('app.color.widget_tint_glass_2'), $r('app.color.widget_tint_glass_3'), $r('app.color.widget_tint_glass_4'),
        $r('app.color.widget_tint_glass_5')];
      const index = Math.floor(course.colorIndex ?? 0);
      return glass[index >= 0 && index < glass.length ? index : 0];
    }
    if (this.theme === 'green') return $r('app.color.widget_tint_green');
    if (this.theme === 'blue') return $r('app.color.widget_tint_blue');
    if (this.theme === 'teal') return $r('app.color.widget_tint_teal');
    if (this.theme === 'indigo') return $r('app.color.widget_tint_indigo');
    if (this.theme === 'violet') return $r('app.color.widget_tint_violet');
    if (this.theme === 'orange') return $r('app.color.widget_tint_orange');
    if (this.theme === 'rose') return $r('app.color.widget_tint_rose');
    return $r('app.color.widget_tint_slate');
  }

  // 今日课表大号：从 7 行往下试，挑第一个连同「后面还有」一起放得下的行数。
  private largeTodayRows(value: string, remaining: number): WidgetCourseRow[] {
    const rows = this.rows(value).slice(0, 7);
    const available = this.contentHeight() - this.headerHeight(this.dayNote) - 8;
    for (let count = rows.length; count > 1; count -= 1) {
      const hidden = rows.length - count + remaining;
      const needed = count * LARGE_ROW_HEIGHT + (count - 1) * 8 + (hidden > 0 ? 10 + REMAINING_HEIGHT : 0);
      if (needed <= available) return rows.slice(0, count);
    }
    return rows.slice(0, 1);
  }

  // 今日课表中号固定两门：放不下时两门之间的间隔从 7 一档档收到 4。
  private mediumRowSpacing(count: number, remaining: number): number {
    const available = this.contentHeight() - this.headerHeight(this.dayNote) - 5;
    const footer = remaining > 0 ? 8 + REMAINING_HEIGHT : 0;
    for (const spacing of [7, 6, 5]) {
      if (count * MEDIUM_ROW_HEIGHT + (count - 1) * spacing + footer <= available) return spacing;
    }
    return 4;
  }

  // 两日课表每列最多 5 门，卡片矮时少放几门。
  private twoDayRows(value: string, hint: string): WidgetCourseRow[] {
    const rows = this.rows(value).slice(0, 5);
    const available = this.contentHeight() - this.headerHeight(hint) - 18;
    for (let count = rows.length; count > 1; count -= 1) {
      const footer = count < rows.length ? 8 + REMAINING_HEIGHT : 0;
      if (count * TWO_DAY_ROW_HEIGHT + (count - 1) * 7 + footer <= available) return rows.slice(0, count);
    }
    return rows.slice(0, 1);
  }

  // 小号默认放两节（同 iOS 默认）；卡片矮到放不下时只放一节。
  private smallShowsNext(): boolean {
    if (this.rows(this.primaryCourses).length < 2) return false;
    const needed = this.headerHeight(this.dayNote) + 8 + FITTED_SUMMARY_HEIGHT + 6 + COMPACT_NEXT_HEIGHT;
    return needed <= this.contentHeight();
  }

  // 「9.28 周一」拆成日期和星期。
  private titleDate(title: string): string {
    return title.split(' ')[0];
  }

  private titleWeekday(title: string): string {
    return title.split(' ').slice(1).join('');
  }

  private isWeekend(weekday: string): boolean {
    return weekday === '周六' || weekday === '周日';
  }

  // 星期旁边那一列：宽卡片放农历（节日另有右侧徽标），窄卡片没有徽标，节日优先顶上来。
  private headerDetail(badge: string, lunar: string, compact: boolean): string {
    return compact && badge ? badge : lunar;
  }

  private detailColor(badge: string, statutory: boolean, compact: boolean): ResourceColor {
    if (!compact || !badge) return $r('app.color.widget_secondary');
    return statutory ? $r('app.color.widget_pink') : this.accent;
  }

  @Builder
  private columnRule() {
    Column().width(1).height(24).backgroundColor($r('app.color.widget_rule')).flexShrink(0)
  }

  // 一个字一行的竖排。两个字正好和左边的日期一样高；三个字的节日名收一号字。
  @Builder
  private verticalText(value: string, weight: FontWeight, color: ResourceColor) {
    Text(value.split('').join('\n'))
      .fontSize(value.length > 2 ? 8 : 10)
      .lineHeight(value.length > 2 ? 9 : 12)
      .fontWeight(weight)
      .fontColor(color)
      .textAlign(TextAlign.Center)
      .flexShrink(0)
  }

  // 「明天的课」和节日徽标：9fp 粗体，胶囊底是同色 16%。
  @Builder
  private capsule(title: string, color: ResourceColor, fill: ResourceColor) {
    Text(title)
      .fontSize(9)
      .lineHeight(11)
      .fontWeight(FontWeight.Bold)
      .fontColor(color)
      .maxLines(1)
      .padding({ left: 5, right: 5, top: 2, bottom: 2 })
      .backgroundColor(fill)
      .borderRadius(8)
      .flexShrink(0)
  }

  // 日期栏永远是那一列的日子；hint 标出课程区显示的是哪天（「明天的课」），hideHint 只占位不显示。
  @Builder
  private dateHeader(title: string, week: number, hint: string, hideHint: boolean, badge: string,
    statutory: boolean, lunar: string, compact: boolean) {
    Column() {
      Row({ space: compact ? 4 : 6 }) {
        Text(this.titleDate(title))
          .fontSize(19)
          .lineHeight(23)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.widget_text'))
          .maxLines(1)
          .flexShrink(0)
        this.columnRule()
        if (this.titleWeekday(title)) {
          this.verticalText(this.titleWeekday(title), FontWeight.Bold,
            this.isWeekend(this.titleWeekday(title)) ? $r('app.color.widget_pink') : this.accent)
        }
        if (this.titleWeekday(title) && this.headerDetail(badge, lunar, compact)) {
          this.columnRule()
        }
        if (this.headerDetail(badge, lunar, compact)) {
          this.verticalText(this.headerDetail(badge, lunar, compact), FontWeight.Medium,
            this.detailColor(badge, statutory, compact))
        }
        Row({ space: 6 }) {
          if (!compact && badge) {
            this.capsule(badge, statutory ? $r('app.color.widget_pink') : this.accent,
              statutory ? $r('app.color.widget_pink_soft') : widgetChipFill(this.accent))
          }
          if (this.footer) {
            Text('缓存').fontSize(10).fontWeight(600).fontColor($r('app.color.widget_secondary')).maxLines(1)
          } else if (week > 0) {
            // 放不下时先缩字，「第」不省：单写「5周」像是说五个星期。
            Text(`第 ${week} 周`)
              .fontSize(10)
              .maxFontSize(10)
              .minFontSize(8)
              .fontWeight(600)
              .fontColor($r('app.color.widget_secondary'))
              .maxLines(1)
              .flexShrink(1)
          }
        }
        .layoutWeight(1)
        .margin({ left: 4 })
        .justifyContent(FlexAlign.End)
      }
      .width('100%')
      .constraintSize({ minHeight: HEADER_HEIGHT })
      .alignItems(VerticalAlign.Center)
      if (hint) {
        Row() {
          Blank()
          this.capsule(hint, this.accent, widgetChipFill(this.accent))
        }
        .width('100%')
        .margin({ top: 4 })
        .opacity(hideHint ? 0 : 1)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private emptyCourses(message: string) {
    Column() {
      Text(message)
        .fontSize(12)
        .fontWeight(600)
        .fontColor($r('app.color.widget_muted'))
        .maxLines(1)
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center)
  }

  // 休息状态：主文案是祝福或「今日无课」，副文案是最近一段法定假期；有副文案才放图标。
  @Builder
  private restCourses() {
    Column({ space: 3 }) {
      if (this.restDetail) {
        SymbolGlyph($r('sys.symbol.calendar'))
          .fontSize(this.dimension === 2 ? 13 : 15)
          .fontWeight(FontWeight.Medium)
          .fontColor([$r('app.color.widget_muted')])
      }
      Text(this.restTitle)
        .width('100%')
        .fontSize(13)
        .maxFontSize(13)
        .minFontSize(10)
        .lineHeight(16)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.widget_text'))
        .textAlign(TextAlign.Center)
        .maxLines(2)
      if (this.restDetail) {
        Text(this.restDetail)
          .width('100%')
          .fontSize(10)
          .maxFontSize(10)
          .minFontSize(7)
          .lineHeight(12)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.widget_muted'))
          .textAlign(TextAlign.Center)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .width('100%')
    .layoutWeight(1)
    .margin({ top: 8 })
    .justifyContent(FlexAlign.Center)
  }

  // 临近课程的一节：roomy 是小号（15fp 课名），否则是中号的一栏（13fp）。fits 时课名只占一行。
  @Builder
  private courseSummary(course: WidgetCourseRow, roomy: boolean, fits: boolean, barHeight: number) {
    Row({ space: roomy ? 9 : 7 }) {
      Column()
        .width(5)
        .height(barHeight)
        .borderRadius(3)
        .backgroundColor(this.courseAccent(course))
      Column({ space: roomy ? 3 : 2 }) {
        Text(course.name)
          .fontSize(roomy ? 15 : 13)
          .maxFontSize(roomy ? 15 : 13)
          .minFontSize(roomy ? 12 : 10)
          .lineHeight(roomy ? 18 : 16)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.widget_text'))
          .maxLines(fits ? 1 : 2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(course.meta)
          .fontSize(roomy ? 10 : 9)
          .lineHeight(roomy ? 12 : 11)
          .fontColor($r('app.color.widget_secondary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(course.time)
          .fontSize(roomy ? 11 : 10)
          .maxFontSize(roomy ? 11 : 10)
          .minFontSize(8)
          .lineHeight(roomy ? 13 : 12)
          .fontWeight(600)
          .fontColor($r('app.color.widget_text'))
          .maxLines(1)
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  // 小号的第二节：短色条，课名一行，时间用次要色。
  @Builder
  private compactNextCourse(course: WidgetCourseRow) {
    Row({ space: 8 }) {
      Column()
        .width(5)
        .height(COMPACT_NEXT_HEIGHT)
        .borderRadius(3)
        .backgroundColor(this.courseAccent(course))
      Column({ space: 1 }) {
        Text(course.name)
          .fontSize(12)
          .lineHeight(14)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.widget_text'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(course.meta ? `${course.meta} · ${course.time}` : course.time)
          .fontSize(9)
          .lineHeight(11)
          .fontColor($r('app.color.widget_secondary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }

  // 2×2 临近课程。显示的是之后某天的课时整体去色压暗（同 iOS dimmedAsOtherDay）。
  @Builder
  private smallUpcoming() {
    Column() {
      this.dateHeader(this.leftTitle, this.primaryWeek, this.dayNote, false, this.badge, this.badgeStatutory,
        this.lunar, true)
      if (!this.firstCourse()) {
        this.restCourses()
      } else if (this.smallShowsNext()) {
        Blank(8)
        Column() {
          this.courseSummary(this.rows(this.primaryCourses)[0], true, true, FITTED_SUMMARY_HEIGHT)
        }
        .grayscale(this.mode === 'ahead' ? 1 : 0)
        .opacity(this.mode === 'ahead' ? 0.56 : 1)
        Blank(6)
        Column() {
          this.compactNextCourse(this.rows(this.primaryCourses)[1])
        }
        .grayscale(this.mode === 'ahead' ? 1 : 0)
        .opacity(this.mode === 'ahead' ? 0.56 : 1)
      } else {
        Blank(8)
        Column() {
          this.courseSummary(this.rows(this.primaryCourses)[0], true, false,
            Math.max(24, Math.min(58, this.contentHeight() - this.headerHeight(this.dayNote) - 8)))
        }
        .grayscale(this.mode === 'ahead' ? 1 : 0)
        .opacity(this.mode === 'ahead' ? 0.56 : 1)
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private upcomingColumn(label: string, index: number, barHeight: number) {
    Column({ space: 7 }) {
      Text(label)
        .fontSize(11)
        .lineHeight(13)
        .fontWeight(600)
        .fontColor($r('app.color.widget_secondary'))
        .maxLines(1)
      if (this.rows(this.primaryCourses).length > index) {
        this.courseSummary(this.rows(this.primaryCourses)[index], false, false, barHeight)
      } else {
        Text('暂无课程').fontSize(11).fontColor($r('app.color.widget_muted')).maxLines(1)
      }
    }
    .layoutWeight(1)
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }

  // 2×4 临近课程：两栏，中间一条竖线。
  @Builder
  private upcomingView() {
    Column() {
      this.dateHeader(this.leftTitle, this.primaryWeek, this.dayNote, false, this.badge, this.badgeStatutory,
        this.lunar, false)
      if (this.rows(this.primaryCourses).length === 0) {
        this.restCourses()
      } else {
        Row({ space: 14 }) {
          this.upcomingColumn(this.leadLabel, 0,
            Math.max(24, Math.min(62, this.contentHeight() - this.headerHeight(this.dayNote) - 8 - 13 - 7)))
          Divider()
            .vertical(true)
            .height('100%')
            .strokeWidth(0.5)
            .color($r('app.color.widget_divider'))
          this.upcomingColumn(this.trailLabel, 1,
            Math.max(24, Math.min(62, this.contentHeight() - this.headerHeight(this.dayNote) - 8 - 13 - 7)))
        }
        .width('100%')
        .layoutWeight(1)
        .margin({ top: 8 })
        .alignItems(VerticalAlign.Top)
        .grayscale(this.mode === 'ahead' ? 1 : 0)
        .opacity(this.mode === 'ahead' ? 0.56 : 1)
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private courseTime(course: WidgetCourseRow, large: boolean) {
    Text(course.time)
      .fontSize(large ? 10 : 9)
      .lineHeight(large ? 12 : 11)
      .fontWeight(600)
      .fontColor($r('app.color.widget_text'))
      .maxLines(1)
      .flexShrink(0)
  }

  // 今日课表、两日课表的一行：色块底 + 5vp 色条。已下课或不是今天的课去色并压到 0.56。
  @Builder
  private todayCourseRow(course: WidgetCourseRow, large: boolean, separateTime: boolean, completed: boolean) {
    Row({ space: large ? 9 : 6 }) {
      Column()
        .width(5)
        .height(large ? 40 : separateTime ? 39 : 29)
        .borderRadius(3)
        .backgroundColor(this.courseAccent(course))
      Column({ space: 2 }) {
        Text(course.name)
          .fontSize(large ? 14 : 12)
          .lineHeight(large ? 17 : 14)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.widget_text'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(course.meta)
          .fontSize(large ? 10 : 9)
          .lineHeight(large ? 12 : 11)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.widget_secondary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (separateTime) {
          this.courseTime(course, large)
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      if (!separateTime) {
        this.courseTime(course, large)
      }
    }
    .width('100%')
    .height(large ? LARGE_ROW_HEIGHT : separateTime ? TWO_DAY_ROW_HEIGHT : MEDIUM_ROW_HEIGHT)
    .padding({ left: large ? 9 : 7, right: large ? 9 : 7 })
    .borderRadius(large ? 11 : 8)
    .backgroundColor(this.courseTint(course))
    .grayscale(completed ? 1 : 0)
    .opacity(completed ? 0.56 : 1)
  }

  // 没显示的课都排在最后一行之后（已经上完的才会被省在前面），所以说「后面」。
  @Builder
  private remainingText(count: number, top: number) {
    Text(`后面还有 ${count} 门课`)
      .width('100%')
      .fontSize(9)
      .lineHeight(REMAINING_HEIGHT)
      .fontWeight(FontWeight.Medium)
      .fontColor($r('app.color.widget_muted'))
      .textAlign(TextAlign.End)
      .maxLines(1)
      .margin({ top: top })
  }

  // 今日课表：大号贴顶排、最多 7 行；中号固定两门，整块竖着居中。
  @Builder
  private todayView() {
    Column() {
      this.dateHeader(this.leftTitle, this.primaryWeek, this.dayNote, false, this.badge, this.badgeStatutory,
        this.lunar, false)
      if (this.rows(this.primaryCourses).length === 0) {
        this.restCourses()
      } else if (this.dimension === 4) {
        Column({ space: 8 }) {
          ForEach(this.largeTodayRows(this.primaryCourses, this.primaryRemaining), (course: WidgetCourseRow) => {
            this.todayCourseRow(course, true, false, course.ended || this.mode === 'ahead')
          }, (course: WidgetCourseRow) => `${course.time}|${course.name}|${course.meta}`)
        }
        .width('100%')
        .margin({ top: 8 })
        if (this.rows(this.primaryCourses).length - this.largeTodayRows(this.primaryCourses, this.primaryRemaining).length
          + this.primaryRemaining > 0) {
          this.remainingText(this.rows(this.primaryCourses).length
            - this.largeTodayRows(this.primaryCourses, this.primaryRemaining).length + this.primaryRemaining, 10)
        }
      } else {
        Column({ space: this.mediumRowSpacing(this.rows(this.primaryCourses).slice(0, 2).length, this.primaryRemaining) }) {
          ForEach(this.rows(this.primaryCourses).slice(0, 2), (course: WidgetCourseRow) => {
            this.todayCourseRow(course, false, false, course.ended || this.mode === 'ahead')
          }, (course: WidgetCourseRow) => `${course.time}|${course.name}|${course.meta}`)
        }
        .width('100%')
        .margin({ top: 5 })
        if (this.rows(this.primaryCourses).length - Math.min(2, this.rows(this.primaryCourses).length)
          + this.primaryRemaining > 0) {
          this.remainingText(this.rows(this.primaryCourses).length - Math.min(2, this.rows(this.primaryCourses).length)
            + this.primaryRemaining,
            this.mediumRowSpacing(this.rows(this.primaryCourses).slice(0, 2).length, this.primaryRemaining) > 4 ? 8 : 4)
        }
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .justifyContent(this.dimension === 4 || this.rows(this.primaryCourses).length === 0
      ? FlexAlign.Start : FlexAlign.Center)
  }

  // 两日课表的一列：没有标题、没有边框，日期栏和第一门课隔开 18。
  @Builder
  private dayColumn(title: string, week: number, value: string, isToday: boolean) {
    Column() {
      this.dateHeader(title, week, this.rightNote, isToday, isToday ? this.badge : this.rightBadge,
        isToday ? this.badgeStatutory : this.rightBadgeStatutory, isToday ? this.lunar : this.rightLunar, true)
      if (this.rows(value).length === 0) {
        // 祝福只属于今天：明天那列没课就照常说「没有课程」。
        this.emptyCourses(isToday ? this.restTitle : '没有课程')
      } else {
        Column({ space: 7 }) {
          ForEach(this.twoDayRows(value, this.rightNote), (course: WidgetCourseRow) => {
            this.todayCourseRow(course, false, true, isToday && course.ended)
          }, (course: WidgetCourseRow) => `${course.time}|${course.name}|${course.meta}`)
        }
        .width('100%')
        .margin({ top: 18 })
        if (this.twoDayRows(value, this.rightNote).length < this.rows(value).length) {
          this.remainingText(this.rows(value).length - this.twoDayRows(value, this.rightNote).length
            + (isToday ? this.primaryRemaining : this.secondaryRemaining), 8)
        }
      }
    }
    .layoutWeight(1)
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private twoDayView() {
    Row({ space: 13 }) {
      this.dayColumn(this.leftTitle, this.primaryWeek, this.primaryCourses, true)
      Divider()
        .vertical(true)
        .height('100%')
        .strokeWidth(0.5)
        .color($r('app.color.widget_divider'))
      this.dayColumn(this.rightTitle, this.secondaryWeek, this.secondaryCourses, false)
    }
    .width('100%')
    .height('100%')
    .alignItems(VerticalAlign.Top)
  }

  // 未配置、授权失效、刷新失败：左对齐的图标、标题和说明，同 iOS WidgetMessageView。
  @Builder
  private statusView() {
    Column({ space: 8 }) {
      SymbolGlyph($r('sys.symbol.calendar'))
        .fontSize(24)
        .fontWeight(FontWeight.Medium)
        .fontColor([this.accent])
      Text(this.state === 'loading' ? '正在同步课程' : this.subtitle)
        .fontSize(15)
        .lineHeight(18)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.widget_text'))
        .maxLines(1)
      Text(this.footer)
        .fontSize(11)
        .lineHeight(13)
        .fontColor($r('app.color.widget_secondary'))
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .height('100%')
    .padding(2)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Start)
  }

  private lockInlineText(): string {
    const course = this.firstCourse();
    if (!course) return this.lockLine;
    const day = this.lockDay || this.titleWeekday(this.leftTitle) || this.leftTitle;
    return [day, course.start, course.name, course.meta].filter((value: string) => value.length > 0).join(' ');
  }

  @Builder
  private lockInlineView() {
    Row({ space: 6 }) {
      SymbolGlyph(this.firstCourse() ? $r('sys.symbol.book_pages') : $r('sys.symbol.calendar'))
        .fontSize(12)
        .fontWeight(FontWeight.Medium)
        .fontColor(['#FFFFFFFF'])
      Text(this.lockInlineText())
        .layoutWeight(1)
        .fontSize(12)
        .fontWeight(FontWeight.Medium)
        .fontColor('#FFFFFFFF')
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .height('100%')
    .padding({ left: 14, right: 14 })
    .alignItems(VerticalAlign.Center)
  }

  // 圆形锁屏：半透明圆底上，图标、开始时间、课名三行（同 iOS accessoryCircular）。
  @Builder
  private lockCircularView() {
    Stack() {
      Circle()
        .width('100%')
        .height('100%')
        .fill('#26FFFFFF')
      Column({ space: this.firstCourse() ? 0 : 1 }) {
        SymbolGlyph(this.firstCourse() ? $r('sys.symbol.book_pages') : $r('sys.symbol.calendar'))
          .fontSize(this.firstCourse() ? 10 : 15)
          .fontWeight(FontWeight.Medium)
          .fontColor(['#FFFFFFFF'])
        if (this.firstCourse()) {
          Text(this.firstCourse()?.start ?? '--:--')
            .fontSize(12)
            .maxFontSize(12)
            .minFontSize(9)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFFFF')
            .maxLines(1)
          Text(this.firstCourse()?.name ?? '课程')
            .fontSize(8)
            .maxFontSize(8)
            .minFontSize(5)
            .fontWeight(600)
            .fontColor('#FFFFFFFF')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        } else {
          Text('无课')
            .fontSize(9)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFFFF')
        }
      }
      .width('100%')
      .padding(5)
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }

  // 矩形锁屏：第一行「明天 9.29 周二」和下一节开始时间，下面课名 14、地点和时间各 10。
  @Builder
  private lockRectangularView() {
    Column({ space: 2 }) {
      Row({ space: 4 }) {
        SymbolGlyph(this.firstCourse() ? $r('sys.symbol.book_pages') : $r('sys.symbol.calendar'))
          .fontSize(10)
          .fontWeight(FontWeight.Medium)
          .fontColor(['#FFFFFFFF'])
        Text(this.lockTitle || this.leftTitle)
          .fontSize(10)
          .maxFontSize(10)
          .minFontSize(8)
          .fontWeight(600)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
          .flexShrink(1)
        Blank(2)
        if (this.rows(this.primaryCourses).length > 1) {
          Text(`下一节 ${this.rows(this.primaryCourses)[1].start}`)
            .fontSize(9)
            .fontWeight(FontWeight.Medium)
            .fontColor('#FFFFFFFF')
            .maxLines(1)
            .flexShrink(0)
        }
      }
      .width('100%')
      if (this.firstCourse()) {
        Text(this.firstCourse()?.name ?? '课程')
          .width('100%')
          .fontSize(14)
          .maxFontSize(14)
          .minFontSize(10)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.firstCourse()?.meta ?? '')
          .width('100%')
          .fontSize(10)
          .maxFontSize(10)
          .minFontSize(8)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.firstCourse()?.time ?? '')
          .width('100%')
          .fontSize(10)
          .maxFontSize(10)
          .minFontSize(8)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
      } else {
        Text(this.restTitle)
          .width('100%')
          .fontSize(14)
          .maxFontSize(14)
          .minFontSize(10)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
        Text(this.restDetail || '打开课表查看本周安排')
          .width('100%')
          .fontSize(10)
          .maxFontSize(10)
          .minFontSize(7)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFFFF')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .width('100%')
    .height('100%')
    .padding({ left: 14, right: 14, top: 8, bottom: 8 })
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private lockStatusView() {
    if (this.variant === 'lock-circular') {
      Stack() {
        Circle()
          .width('100%')
          .height('100%')
          .fill('#26FFFFFF')
        SymbolGlyph($r('sys.symbol.calendar'))
          .fontSize(20)
          .fontWeight(FontWeight.Medium)
          .fontColor(['#FFFFFFFF'])
      }
      .width('100%')
      .height('100%')
      .alignContent(Alignment.Center)
    } else if (this.variant === 'lock-inline') {
      Row({ space: 6 }) {
        SymbolGlyph($r('sys.symbol.calendar'))
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(['#FFFFFFFF'])
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
      Row({ space: 8 }) {
        SymbolGlyph($r('sys.symbol.calendar'))
          .fontSize(19)
          .fontWeight(FontWeight.Medium)
          .fontColor(['#FFFFFFFF'])
        Column({ space: 2 }) {
          Text(this.state === 'loading' ? '正在同步课程' : this.subtitle)
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFFFF')
            .maxLines(1)
          Text(this.footer)
            .fontSize(10)
            .fontColor('#FFFFFFFF')
            .maxLines(2)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .height('100%')
      .padding({ left: 14, right: 14 })
      .alignItems(VerticalAlign.Center)
    }
  }

  build() {
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
      } else if (this.effectiveLayout() === 'upcoming' && this.dimension === 2) {
        this.smallUpcoming()
      } else if (this.effectiveLayout() === 'upcoming') {
        this.upcomingView()
      } else if (this.effectiveLayout() === 'today') {
        this.todayView()
      } else {
        this.twoDayView()
      }
    }
    .width('100%')
    .height('100%')
    .padding(this.cardPadding())
    .backgroundColor(this.isLockScreen() ? Color.Transparent : $r('app.color.widget_surface'))
    .borderRadius(this.isLockScreen() ? 0 : 22)
    .onAreaChange((_previous: Area, area: Area) => this.cardHeight = Number(area.height))
  }
}
