import { widgetChipFill } from '../common/ScheduleWidgetPalette';
import { widgetTextScales } from '../common/ScheduleWidgetOptions';
import {
  CARD_COLUMN_LABEL,
  CARD_COLUMN_SUMMARY,
  CARD_COMPACT_NEXT,
  CARD_FITTED_PROGRESS_EXTRA,
  CARD_FITTED_SUMMARY,
  CARD_HEADER_HEIGHT,
  CARD_HINT_HEIGHT,
  CARD_LARGE_ROW,
  CARD_MEDIUM_ROW,
  CARD_PREVIEW_ROW,
  CARD_PREVIEW_SUMMARY,
  CARD_PROGRESS_EXTRA,
  CARD_REMAINING,
  CARD_ROOMY_SUMMARY,
  CARD_TWO_DAY_ROW,
  CardCountdown,
  LargeTodayPlan,
  MediumTodayPlan,
  cardClock,
  cardCountdown,
  cardEnded,
  cardEndedPrefix,
  cardInProgress,
  cardPreviewHeight,
  cardProgress,
  chooseCardScale,
  largeTodayHeight,
  largeTodayPlan,
  mediumTodayPlan,
  twoDayHeight,
  twoDayPlan
} from './ScheduleCardLayout';

interface WidgetCourseRow {
  name: string;
  start: string;
  time: string;
  meta: string;
  ended: boolean;
  accent: string;
  tint: string;
  colorIndex?: number;
  // 今天的课的上下课时刻（毫秒），别的日子的课没有。
  startAt?: number;
  endAt?: number;
}

const NO_COURSE: WidgetCourseRow = { name: '', start: '', time: '', meta: '', ended: false, accent: '', tint: '' };

// 版式照 iOS ScheduleWidgets.swift 逐项对齐：pt 按 1:1 换成 vp，字号用 fp。行高和放得下几门课的算法在
// ScheduleCardLayout.ets。
//
// @Builder 的参数是按值传的，调用处算好的值只在第一次渲染时取。这里的 builder 只收两种参数：
// 调用处写死的字符串（哪一列、哪种行），和 ForEach 给的那门课（键里带着这门课的全部内容，变了就重建）。
// 其余一律在 builder 里面从 this 读，日期、课程和时钟变了才跟得上。
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
  // The timetable style: 表格 frames the card in rules, 素笺 is paper with a double rule, 站牌 a sign
  // with a heavy top rule; the rest keep the original look. A photo may lie under a veil of the card's colour.
  @Prop cardStyle: string = 'classic';
  @Prop cardPhoto: string = '';
  @Prop veil: number = 0.55;
  // 显示开关（ScheduleWidgetOptions）：文字大小、上课倒计时与进度、周次、隐藏已上完的课。
  @Prop textSize: string = 'standard';
  @Prop showProgress: boolean = true;
  @Prop showWeek: boolean = true;
  @Prop hideCompleted: boolean = false;
  // 日期栏常驻的假期倒计时「距国庆节还有 5 天」。
  @Prop countdown: string = '';
  @Prop primaryEmpty: string = '';
  // 大号今日课表课少时接着预告的下一次课。
  @Prop previewLabel: string = '';
  @Prop previewDetail: string = '';
  @Prop previewCourses: string = '[]';
  @Prop previewCount: number = 0;
  @Prop previewSummary: string = '';
  // 样张钉住的时刻（毫秒）。大于 0 时倒计时和进度按这一刻画成静止的，不走时钟。
  @Prop pinnedNow: number = 0;
  @State private cardWidth: number = 0;
  @State private cardHeight: number = 0;
  // 卡片自己的时钟。系统最快 5 分钟才肯刷新一次卡片、一天还有次数上限，倒计时和进度等不起：
  // 一个看不见的计时器每秒看一眼时间，画面要变了才更新这个值。
  @State private nowMs: number = 0;
  private ticker: TextTimerController = new TextTimerController();
  private parsedRows: Map<string, WidgetCourseRow[]> = new Map<string, WidgetCourseRow[]>();

  aboutToAppear(): void {
    this.nowMs = Date.now();
  }

  private clock(): number {
    return this.pinnedNow > 0 ? this.pinnedNow : this.nowMs;
  }

  private rows(value: string): WidgetCourseRow[] {
    const cached = this.parsedRows.get(value);
    if (cached) return cached;
    let rows: WidgetCourseRow[] = [];
    try {
      const parsed = JSON.parse(value) as WidgetCourseRow[];
      rows = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      rows = [];
    }
    if (this.parsedRows.size > 8) this.parsedRows.clear();
    this.parsedRows.set(value, rows);
    return rows;
  }

  private rowKey(course: WidgetCourseRow, index: number): string {
    return `${index}|${JSON.stringify(course)}`;
  }

  private surface(): ResourceColor {
    if (this.cardStyle === 'paper') return $r('app.color.widget_paper');
    if (this.cardStyle === 'board') return $r('app.color.widget_board');
    return $r('app.color.widget_surface');
  }

  private frame(): BorderOptions {
    if (this.cardStyle === 'table') return { width: 1, color: $r('app.color.widget_rule'), radius: 10 };
    if (this.cardStyle === 'paper') return { width: 1.5, color: $r('app.color.widget_ink_rule'), radius: 6, style: BorderStyle.Solid };
    if (this.cardStyle === 'board') return { width: { top: 4, left: 0, right: 0, bottom: 0 }, color: $r('app.color.widget_ink_rule'), radius: 6 };
    return { width: 0 };
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

  // 没放大缩小时内容区的高度。
  private baseHeight(): number {
    const height = this.cardHeight > 0 ? this.cardHeight : this.dimension === 4 ? 340 : 158;
    return height - this.cardPadding() * 2;
  }

  // 文字大小：整块内容排在 1 / 比例 大小的画布里再放大回去，字、色条和间距同一个比例，
  // 下面按高度算放几门课的地方看到的是真实剩下的地方，放大后放不下的课照常数进「后面还有 N 门课」。
  // 自适应从大到小试，最满的排法放得下才放大。锁屏卡片和提示状态不缩放。
  private textScale(): number {
    if (this.isLockScreen() || this.state !== 'ready' || this.cardHeight <= 0 || this.cardWidth <= 0) return 1;
    const scales = widgetTextScales(this.textSize);
    return scales.length === 1 ? scales[0] : chooseCardScale(scales, this.baseHeight(), this.fullestHeight());
  }

  private contentHeight(): number {
    return this.baseHeight() / this.textScale();
  }

  private canvasWidth(): Length {
    return this.textScale() === 1 ? '100%' : (this.cardWidth - this.cardPadding() * 2) / this.textScale();
  }

  private canvasHeight(): Length {
    return this.textScale() === 1 ? '100%' : this.contentHeight();
  }

  // 日期栏的高度。kind 见 dateHeader：整宽的日期栏把「明天的课」放在同一行右边，其余的在下面另起一行。
  private headerHeight(kind: string): number {
    return CARD_HEADER_HEIGHT + (kind !== 'wide' && this.headerHint(kind) ? CARD_HINT_HEIGHT : 0);
  }

  // ---- 时钟：倒计时、进度、上完没有 ----

  private rowEnded(course: WidgetCourseRow): boolean {
    return course.ended || cardEnded(course.endAt ?? 0, this.clock());
  }

  private rowProgressing(course: WidgetCourseRow): boolean {
    return this.showProgress && cardInProgress(course.startAt ?? 0, course.endAt ?? 0, this.clock());
  }

  // 临近课程第一节带进度时多出来的高度。fitted：小号放两节，行距收紧过。
  private leadExtra(fitted: boolean): number {
    if (!this.rowProgressing(this.upcomingRow(0))) return 0;
    return fitted ? CARD_FITTED_PROGRESS_EXTRA : CARD_PROGRESS_EXTRA;
  }

  private progressWidth(course: WidgetCourseRow): string {
    const percent = cardProgress(course.startAt ?? 0, course.endAt ?? 0, this.clock()) * 100;
    return `${Math.max(3, Math.round(percent * 10) / 10)}%`;
  }

  private endedPrefix(rows: WidgetCourseRow[]): number {
    return cardEndedPrefix(rows.map((course: WidgetCourseRow) => course.endAt ?? 0), this.clock());
  }

  // 临近课程放的两节。服务端多给了两节：两次刷新之间下课了，自己往后挪。
  private upcomingRows(): WidgetCourseRow[] {
    const rows = this.rows(this.primaryCourses);
    if (this.mode !== 'today') return rows.slice(0, 2);
    const skip = this.endedPrefix(rows);
    return rows.slice(skip, skip + 2);
  }

  private upcomingRow(index: number): WidgetCourseRow {
    const rows = this.upcomingRows();
    return index < rows.length ? rows[index] : NO_COURSE;
  }

  // 今日课表、两日课表今天那列的课。「隐藏已上完的课」时，两次刷新之间上完的课也不留着。
  private todayRows(): WidgetCourseRow[] {
    const rows = this.rows(this.primaryCourses);
    if (!this.hideCompleted || this.mode !== 'today') return rows;
    const skip = this.endedPrefix(rows);
    return skip > 0 ? rows.slice(skip) : rows;
  }

  private startedLead(): boolean {
    const first = this.upcomingRow(0);
    return (first.startAt ?? 0) > 0 && this.clock() >= (first.startAt ?? 0);
  }

  // 两栏的标签跟着时钟走：第一节开始上了就是「当前 / 接下来」。
  private leadText(): string {
    if (this.mode !== 'today' || (this.upcomingRow(0).startAt ?? 0) <= 0) return this.leadLabel;
    return this.startedLead() ? '当前' : '下一节';
  }

  private trailText(): string {
    if (this.mode !== 'today' || (this.upcomingRow(0).startAt ?? 0) <= 0) return this.trailLabel;
    return this.startedLead() ? '接下来' : '之后';
  }

  // 「距下课 23:10」「距上课 12:40」：只给今天的第一节，上课前一小时才出现。
  private leadCountdown(): CardCountdown {
    if (!this.showProgress || this.mode !== 'today' || this.effectiveLayout() !== 'upcoming') return { title: '', seconds: 0 };
    const first = this.upcomingRow(0);
    return cardCountdown(first.startAt ?? 0, first.endAt ?? 0, this.clock());
  }

  // 今天还有没上完的课时才用得着时钟。
  private ticks(): boolean {
    if (this.pinnedNow > 0 || this.isLockScreen() || this.state !== 'ready') return false;
    const now = this.clock();
    return this.rows(this.primaryCourses).some((course: WidgetCourseRow) => (course.endAt ?? 0) > 0 && !cardEnded(course.endAt ?? 0, now));
  }

  // 每秒来一次。画面上有按秒走的倒计时才每秒更新，否则换了分钟才更新，免得整张卡片每秒重算。
  private tick(): void {
    const now = Date.now();
    const first = this.upcomingRow(0);
    const seconds = this.showProgress && this.mode === 'today' && this.effectiveLayout() === 'upcoming'
      && cardCountdown(first.startAt ?? 0, first.endAt ?? 0, now).title.length > 0;
    if (seconds || Math.floor(now / 60000) !== Math.floor(this.nowMs / 60000)) this.nowMs = now;
  }

  // ---- 放得下几门 ----

  private largePlan(): LargeTodayPlan {
    const rows = this.todayRows().slice(0, 7);
    const available = this.contentHeight() - this.headerHeight('wide') - 8;
    return largeTodayPlan(available, rows.length, this.primaryRemaining, this.mode === 'today' ? this.previewCount : 0);
  }

  private largeRows(): WidgetCourseRow[] {
    return this.todayRows().slice(0, this.largePlan().rows);
  }

  private mediumPlan(): MediumTodayPlan {
    const available = this.contentHeight() - this.headerHeight('wide') - 5;
    return mediumTodayPlan(available, this.todayRows().length, this.primaryRemaining);
  }

  private mediumRows(): WidgetCourseRow[] {
    return this.todayRows().slice(0, this.mediumPlan().rows);
  }

  private columnRows(side: string): WidgetCourseRow[] {
    return (side === 'left' ? this.todayRows() : this.rows(this.secondaryCourses)).slice(0, 5);
  }

  private columnRemaining(side: string): number {
    return side === 'left' ? this.primaryRemaining : this.secondaryRemaining;
  }

  private columnShown(side: string): WidgetCourseRow[] {
    const rows = this.columnRows(side);
    const available = this.contentHeight() - this.headerHeight('left') - 18;
    return rows.slice(0, twoDayPlan(available, rows.length, this.columnRemaining(side)));
  }

  // 没显示出来的课有几门。kind：large、medium 是今日课表，left、right 是两日课表的两列。
  private hiddenCount(kind: string): number {
    if (kind === 'large') return this.todayRows().length - this.largeRows().length + this.primaryRemaining;
    if (kind === 'medium') return this.todayRows().length - this.mediumRows().length + this.primaryRemaining;
    return this.columnRows(kind).length - this.columnShown(kind).length + this.columnRemaining(kind);
  }

  // 小号默认放两节（同 iOS 默认）；卡片矮到放不下（或文字放大了）时只放一节。
  private smallShowsNext(): boolean {
    if (this.upcomingRows().length < 2) return false;
    const needed = this.headerHeight('small') + 8 + CARD_FITTED_SUMMARY + this.leadExtra(true) + 6 + CARD_COMPACT_NEXT;
    return needed <= this.contentHeight();
  }

  // 中号一栏里课名两行放不下（文字放大了）时只写一行。
  private columnTitleLines(): number {
    const needed = this.headerHeight('wide') + 8 + CARD_COLUMN_LABEL + CARD_COLUMN_SUMMARY + this.leadExtra(false);
    return needed <= this.contentHeight() ? 2 : 1;
  }

  // 标准大小下最满的排法要多高：自适应拿它定放大到哪一档。
  private fullestHeight(): number {
    const layout = this.effectiveLayout();
    const rest = CARD_HEADER_HEIGHT + 8 + 60;
    if (layout === 'upcoming') {
      const rows = this.upcomingRows();
      const header = this.headerHeight(this.dimension === 2 ? 'small' : 'wide');
      if (rows.length === 0) return rest;
      if (this.dimension !== 2) return header + 8 + CARD_COLUMN_LABEL + CARD_COLUMN_SUMMARY + this.leadExtra(false);
      return rows.length > 1 ? header + 8 + CARD_FITTED_SUMMARY + this.leadExtra(true) + 6 + CARD_COMPACT_NEXT
        : header + 8 + CARD_ROOMY_SUMMARY + this.leadExtra(false);
    }
    if (layout === 'today') {
      const header = this.headerHeight('wide');
      const all = this.todayRows();
      if (all.length === 0) return rest;
      if (this.dimension === 4) {
        const rows = all.slice(0, 7);
        const preview = this.mode === 'today' && this.primaryRemaining === 0 && this.previewCount > 0
          ? cardPreviewHeight(Math.min(3, this.previewCount)) : 0;
        return header + 8 + largeTodayHeight(rows.length, this.primaryRemaining) + preview;
      }
      const rows = Math.min(2, all.length);
      const hidden = all.length - rows + this.primaryRemaining;
      return header + 5 + rows * CARD_MEDIUM_ROW + (rows - 1) * 7 + (hidden > 0 ? 8 + CARD_REMAINING : 0);
    }
    const header = this.headerHeight('left') + 18;
    const left = this.columnRows('left');
    const right = this.columnRows('right');
    return Math.max(
      left.length > 0 ? header + twoDayHeight(left.length, this.primaryRemaining) : rest,
      right.length > 0 ? header + twoDayHeight(right.length, this.secondaryRemaining) : rest
    );
  }

  // ---- 日期栏 ----

  // kind：small 是 2×2，wide 是整宽的（中号、大号），left、right 是两日课表的两列。
  private headerTitle(kind: string): string {
    return kind === 'right' ? this.rightTitle : this.leftTitle;
  }

  // 日期栏下面挂的「明天的课」。
  private headerHint(kind: string): string {
    return kind === 'left' || kind === 'right' ? this.rightNote : this.dayNote;
  }

  private headerBadge(kind: string): string {
    return kind === 'right' ? this.rightBadge : this.badge;
  }

  private headerStatutory(kind: string): boolean {
    return kind === 'right' ? this.rightBadgeStatutory : this.badgeStatutory;
  }

  private headerWeek(kind: string): number {
    if (!this.showWeek) return 0;
    return kind === 'right' ? this.secondaryWeek : this.primaryWeek;
  }

  // 「9.28 周一」拆成日期和星期。
  private headerDate(kind: string): string {
    return this.headerTitle(kind).split(' ')[0];
  }

  private headerWeekday(kind: string): string {
    return this.headerTitle(kind).split(' ').slice(1).join('');
  }

  private weekdayColor(kind: string): ResourceColor {
    const weekday = this.headerWeekday(kind);
    return weekday === '周六' || weekday === '周日' ? $r('app.color.widget_pink') : this.accent;
  }

  // 星期旁边那一列：宽卡片放农历（节日另有右侧徽标），窄卡片没有徽标，节日优先顶上来。
  private headerDetail(kind: string): string {
    const lunar = kind === 'right' ? this.rightLunar : this.lunar;
    return kind !== 'wide' && this.headerBadge(kind) ? this.headerBadge(kind) : lunar;
  }

  // 窄日期栏（2×2、两日课表的半宽列）右边那一小格有多宽。没法量文字，按字数估：日期 19fp 粗体每个数字
  // 约 10.8vp、小数点 4.8，星期和农历各一列约 11，加上竖线和间隔；宁可少算一点地方。
  private compactRoom(kind: string, withDetail: boolean): number {
    const padding = this.cardPadding() * 2;
    const canvas = ((this.cardWidth > 0 ? this.cardWidth : this.dimension === 2 ? 149 : 320) - padding) / this.textScale();
    const column = kind === 'small' ? canvas : (canvas - 26.5) / 2;
    const date = this.headerDate(kind);
    const dots = date.split('.').length - 1;
    return column - (date.length - dots) * 10.8 - dots * 4.8 - (withDetail ? 44.8 : 24.8);
  }

  // 2×2 的倒计时比右边那一格宽（还有一个多小时下课，或文字放大了）时，让出农历那一列。
  // 倒计时 11fp 每个数字约 5.6vp，上面的「距下课」约 24vp。
  private showsDetail(kind: string): boolean {
    if (!this.headerDetail(kind)) return false;
    if (kind !== 'small' || this.footer || !this.leadCountdown().title) return true;
    const clock = cardClock(this.leadCountdown().seconds);
    const colons = clock.split(':').length - 1;
    return this.compactRoom(kind, true) >= Math.max(24, (clock.length - colons) * 5.6 + colons * 3) + 1;
  }

  // 「第 N 周」。窄日期栏放不下时先去掉空格、缩一号字，再放不下就不显示；「第」不省，
  // 单写「5周」像是说五个星期。也不去挤左边的日期。
  private weekLabel(kind: string): string {
    const week = this.headerWeek(kind);
    if (week <= 0) return '';
    if (kind === 'wide') return `第 ${week} 周`;
    const digits = `${week}`.length;
    const room = this.compactRoom(kind, this.headerDetail(kind).length > 0);
    // 10fp 写全要 25.6 + 每个数字 6；差一点时由文字自己缩到 9fp，所以按九成算。
    if (room >= (25.6 + digits * 6) * 0.9) return `第 ${week} 周`;
    return room >= 14.4 + digits * 4.8 ? `第${week}周` : '';
  }

  private weekFontSize(kind: string): number {
    return this.weekLabel(kind).includes(' ') ? 10 : 8;
  }

  private detailColor(kind: string): ResourceColor {
    if (kind === 'wide' || !this.headerBadge(kind)) return $r('app.color.widget_secondary');
    return this.headerStatutory(kind) ? $r('app.color.widget_pink') : this.accent;
  }

  // 整宽的日期栏右边有的是地方：没有跨日标注要写时，假期倒计时收在「第 N 周」下面，不单占一行。
  private headerCountdown(kind: string): string {
    return kind === 'wide' && !this.dayNote && !this.footer ? this.countdown : '';
  }

  // 「距国庆节还有 5 天」里的天数，用主题色大一号。
  private countdownPart(index: number): string {
    const match = /^(.*?)(\d+)(.*)$/.exec(this.countdown);
    if (!match) return index === 0 ? this.countdown : '';
    return match[index + 1];
  }

  @Builder
  private columnRule() {
    Column().width(1).height(24).backgroundColor($r('app.color.widget_rule')).flexShrink(0)
  }

  // 一个字一行的竖排。两个字正好和左边的日期一样高；三个字的节日名收一号字。
  @Builder
  private weekdayColumn(kind: string) {
    Text(this.headerWeekday(kind).split('').join('\n'))
      .fontSize(this.headerWeekday(kind).length > 2 ? 8 : 10)
      .lineHeight(this.headerWeekday(kind).length > 2 ? 9 : 12)
      .fontWeight(FontWeight.Bold)
      .fontColor(this.weekdayColor(kind))
      .textAlign(TextAlign.Center)
      .flexShrink(0)
  }

  @Builder
  private detailColumn(kind: string) {
    Text(this.headerDetail(kind).split('').join('\n'))
      .fontSize(this.headerDetail(kind).length > 2 ? 8 : 10)
      .lineHeight(this.headerDetail(kind).length > 2 ? 9 : 12)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.detailColor(kind))
      .textAlign(TextAlign.Center)
      .flexShrink(0)
  }

  // 节日徽标：9fp 粗体，胶囊底是同色 16%。
  @Builder
  private badgeCapsule(kind: string) {
    Text(this.headerBadge(kind))
      .fontSize(9)
      .lineHeight(11)
      .fontWeight(FontWeight.Bold)
      .fontColor(this.headerStatutory(kind) ? $r('app.color.widget_pink') : this.accent)
      .maxLines(1)
      .padding({ left: 5, right: 5, top: 2, bottom: 2 })
      .backgroundColor(this.headerStatutory(kind) ? $r('app.color.widget_pink_soft') : widgetChipFill(this.accent))
      .borderRadius(8)
      .flexShrink(0)
  }

  @Builder
  private weekText(kind: string, lineHeight: number) {
    Text(this.weekLabel(kind))
      .fontSize(this.weekFontSize(kind))
      .maxFontSize(this.weekFontSize(kind))
      .minFontSize(this.weekFontSize(kind) - 1)
      .lineHeight(lineHeight)
      .fontWeight(600)
      .fontColor($r('app.color.widget_secondary'))
      .maxLines(1)
      .flexShrink(1)
  }

  // 「明天的课」：9fp 粗体，胶囊底是同色 16%。
  @Builder
  private hintCapsule(kind: string) {
    Text(this.headerHint(kind))
      .fontSize(9)
      .lineHeight(11)
      .fontWeight(FontWeight.Bold)
      .fontColor(this.accent)
      .maxLines(1)
      .padding({ left: 5, right: 5, top: 2, bottom: 2 })
      .backgroundColor(widgetChipFill(this.accent))
      .borderRadius(8)
      .flexShrink(0)
  }

  // 日期栏永远是那一列的日子；标注说课程区显示的是哪天（「明天的课」）：整宽的日期栏放在同一行右边，
  // 窄的另起一行，两日课表今天那列只占位不显示。
  @Builder
  private dateHeader(kind: string) {
    Column() {
      Row({ space: kind === 'wide' ? 6 : 4 }) {
        Text(this.headerDate(kind))
          .fontSize(19)
          .lineHeight(23)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.widget_text'))
          .maxLines(1)
          .flexShrink(0)
        this.columnRule()
        if (this.headerWeekday(kind)) {
          this.weekdayColumn(kind)
        }
        if (this.headerWeekday(kind) && this.showsDetail(kind)) {
          this.columnRule()
        }
        if (this.showsDetail(kind)) {
          this.detailColumn(kind)
        }
        Row({ space: 6 }) {
          if (kind === 'wide' && this.headerHint(kind)) {
            this.hintCapsule(kind)
          }
          if (kind === 'wide' && this.headerBadge(kind)) {
            this.badgeCapsule(kind)
          }
          if (this.footer) {
            Text('缓存').fontSize(10).fontWeight(600).fontColor($r('app.color.widget_secondary')).maxLines(1)
          } else if (kind === 'small' && this.leadCountdown().title) {
            // 2×2 放不下「当前」那一行标签：倒计时两行叠在日期栏右边，这会儿让出「第 N 周」。
            Column() {
              Text(this.leadCountdown().title)
                .fontSize(8)
                .lineHeight(10)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.widget_muted'))
                .maxLines(1)
              // 还有一个多小时下课时是「1:15:00」，比这一小格宽：缩字，不截断。
              Text(cardClock(this.leadCountdown().seconds))
                .fontSize(11)
                .maxFontSize(11)
                .minFontSize(7)
                .lineHeight(13)
                .fontWeight(600)
                .fontFeature('"tnum" on')
                .fontColor(this.courseAccent(this.upcomingRow(0)))
                .maxLines(1)
            }
            .width('100%')
            .alignItems(HorizontalAlign.End)
          } else if (this.headerCountdown(kind)) {
            // 周数在上、倒计时在下，两行靠右，合起来和左边的日期数字一样高。
            Column({ space: 1 }) {
              if (this.weekLabel(kind)) {
                this.weekText(kind, 11)
              }
              Text() {
                Span(this.countdownPart(0))
                Span(this.countdownPart(1)).fontSize(11).fontWeight(FontWeight.Bold).fontColor(this.accent)
                Span(this.countdownPart(2))
              }
              .fontSize(9)
              .lineHeight(12)
              .fontWeight(600)
              .fontColor($r('app.color.widget_secondary'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .alignItems(HorizontalAlign.End)
            .flexShrink(1)
          } else if (this.weekLabel(kind)) {
            this.weekText(kind, 12)
          }
        }
        .layoutWeight(1)
        .margin({ left: 4 })
        .justifyContent(FlexAlign.End)
      }
      .width('100%')
      .constraintSize({ minHeight: CARD_HEADER_HEIGHT })
      .alignItems(VerticalAlign.Center)
      if (kind !== 'wide' && this.headerHint(kind)) {
        Row() {
          Blank()
          this.hintCapsule(kind)
        }
        .width('100%')
        .margin({ top: 4 })
        .opacity(kind === 'left' ? 0 : 1)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  // 两日课表里没有课可列的一列。祝福只属于今天：明天那列没课就照常说「没有课程」；
  // 今天有课但都上完、又选了隐藏，就说「今日课程已结束」。
  @Builder
  private emptyCourses(side: string) {
    Column() {
      Text(side === 'left' ? (this.primaryEmpty || this.restTitle) : '没有课程')
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

  // ---- 课程 ----

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

  // 正在上的这节课上到哪了：一条细进度，跟着卡片的时钟走。这是临近课程第一节的，画在时间下面；
  // 这节课换了人（上一节下课、下一节顶上来）也要跟上，所以不收参数。
  @Builder
  private leadProgressTrack() {
    Stack({ alignContent: Alignment.Start }) {
      Column().width('100%').height(4).borderRadius(2).backgroundColor($r('app.color.widget_rule'))
      Column().width(this.progressWidth(this.upcomingRow(0))).height(4).borderRadius(2)
        .backgroundColor(this.courseAccent(this.upcomingRow(0)))
    }
    .width('100%')
    .height(4)
    .accessibilityText('本节课程进度')
  }

  // 临近课程的一节：小号 15fp 课名，中号的一栏 13fp；色条跟着文字一样高。
  // kind：fitted 是小号放两节时的第一节（课名一行），roomy 是小号只放一节，column 是中号的一栏。
  @Builder
  private courseSummary(index: number, kind: string) {
    Row({ space: kind === 'column' ? 7 : 9 }) {
      Column()
        .width(5)
        .alignSelf(ItemAlign.Stretch)
        .borderRadius(3)
        .backgroundColor(this.courseAccent(this.upcomingRow(index)))
      Column({ space: kind === 'column' || (kind === 'fitted' && this.leadExtra(true) > 0) ? 2 : 3 }) {
        Text(this.upcomingRow(index).name)
          .fontSize(kind === 'column' ? 13 : 15)
          .maxFontSize(kind === 'column' ? 13 : 15)
          .minFontSize(kind === 'column' ? 10 : 12)
          .lineHeight(kind === 'column' ? 16 : 18)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.widget_text'))
          .maxLines(kind === 'fitted' ? 1 : kind === 'column' ? this.columnTitleLines() : 2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.upcomingRow(index).meta) {
          Text(this.upcomingRow(index).meta)
            .fontSize(kind === 'column' ? 9 : 10)
            .lineHeight(kind === 'column' ? 11 : 12)
            .fontColor($r('app.color.widget_secondary'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        if (this.upcomingRow(index).time) {
          Text(this.upcomingRow(index).time)
            .fontSize(kind === 'column' ? 10 : 11)
            .maxFontSize(kind === 'column' ? 10 : 11)
            .minFontSize(8)
            .lineHeight(kind === 'column' ? 12 : 13)
            .fontWeight(600)
            .fontColor($r('app.color.widget_text'))
            .maxLines(1)
        }
        if (index === 0 && this.rowProgressing(this.upcomingRow(0))) {
          this.leadProgressTrack()
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  // 小号的第二节：短色条，课名一行，时间用次要色。
  @Builder
  private compactNextCourse() {
    Row({ space: 8 }) {
      Column()
        .width(5)
        .height(CARD_COMPACT_NEXT)
        .borderRadius(3)
        .backgroundColor(this.courseAccent(this.upcomingRow(1)))
      Column({ space: 1 }) {
        Text(this.upcomingRow(1).name)
          .fontSize(12)
          .lineHeight(14)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.widget_text'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text([this.upcomingRow(1).meta, this.upcomingRow(1).time].filter((value: string) => value.length > 0).join(' · '))
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
      this.dateHeader('small')
      if (this.upcomingRows().length === 0) {
        this.restCourses()
      } else if (this.smallShowsNext()) {
        Blank(8)
        Column() {
          this.courseSummary(0, 'fitted')
        }
        .grayscale(this.mode === 'ahead' ? 1 : 0)
        .opacity(this.mode === 'ahead' ? 0.56 : 1)
        Blank(6)
        Column() {
          this.compactNextCourse()
        }
        .grayscale(this.mode === 'ahead' ? 1 : 0)
        .opacity(this.mode === 'ahead' ? 0.56 : 1)
      } else {
        Blank(8)
        Column() {
          this.courseSummary(0, 'roomy')
        }
        .grayscale(this.mode === 'ahead' ? 1 : 0)
        .opacity(this.mode === 'ahead' ? 0.56 : 1)
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }

  // 中号的一栏：标签，右边是倒计时（只有第一栏、今天的课才有），下面是课程。
  @Builder
  private upcomingColumn(index: number) {
    Column({ space: 7 }) {
      Row({ space: 3 }) {
        Text(index === 0 ? this.leadText() : this.trailText())
          .fontSize(11)
          .lineHeight(13)
          .fontWeight(600)
          .fontColor($r('app.color.widget_secondary'))
          .maxLines(1)
          .flexShrink(0)
        Blank()
        if (index === 0 && this.leadCountdown().title) {
          Text(this.leadCountdown().title)
            .fontSize(10)
            .lineHeight(13)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.widget_muted'))
            .maxLines(1)
            .flexShrink(0)
          Text(cardClock(this.leadCountdown().seconds))
            .fontSize(11)
            .lineHeight(13)
            .fontWeight(600)
            .fontFeature('"tnum" on')
            .fontColor(this.courseAccent(this.upcomingRow(0)))
            .maxLines(1)
            .flexShrink(0)
        }
      }
      .width('100%')
      .height(13)
      if (this.upcomingRows().length > index) {
        this.courseSummary(index, 'column')
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
      this.dateHeader('wide')
      if (this.upcomingRows().length === 0) {
        this.restCourses()
      } else {
        Row({ space: 14 }) {
          this.upcomingColumn(0)
          Divider()
            .vertical(true)
            .height('100%')
            .strokeWidth(0.5)
            .color($r('app.color.widget_divider'))
          this.upcomingColumn(1)
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
  private courseTime(course: WidgetCourseRow, kind: string) {
    Text(course.time)
      .fontSize(kind === 'large' ? 10 : 9)
      .lineHeight(kind === 'large' ? 12 : 11)
      .fontWeight(600)
      .fontColor($r('app.color.widget_text'))
      .maxLines(1)
      .flexShrink(0)
  }

  private rowHeight(kind: string): number {
    return kind === 'large' ? CARD_LARGE_ROW : kind === 'column' ? CARD_TWO_DAY_ROW : kind === 'preview' ? CARD_PREVIEW_ROW
      : CARD_MEDIUM_ROW;
  }

  // 已下课、或今日课表整张换成了别的日子的课：去色并压到 0.56。预告的课不压。
  private rowDimmed(course: WidgetCourseRow, kind: string): boolean {
    if (kind === 'preview') return false;
    return this.rowEnded(course) || ((kind === 'large' || kind === 'medium') && this.mode === 'ahead');
  }

  // 今日课表、两日课表的一行：色块底 + 5vp 色条。kind：large 大号，medium 中号，column 两日课表（时间另起一行），
  // preview 大号下面预告的课。正在上的课沿这一行的底边有一条进度：不占文字的地方，行高不变。
  @Builder
  private todayCourseRow(course: WidgetCourseRow, kind: string) {
    Stack({ alignContent: Alignment.BottomStart }) {
      Row({ space: kind === 'large' ? 9 : 6 }) {
        Column()
          .width(5)
          .height(kind === 'large' ? 40 : kind === 'column' ? 39 : 29)
          .borderRadius(3)
          .backgroundColor(this.courseAccent(course))
        Column({ space: 2 }) {
          Text(course.name)
            .fontSize(kind === 'large' ? 14 : 12)
            .lineHeight(kind === 'large' ? 17 : 14)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.widget_text'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (course.meta) {
            Text(course.meta)
              .fontSize(kind === 'large' ? 10 : 9)
              .lineHeight(kind === 'large' ? 12 : 11)
              .fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.widget_secondary'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          if (kind === 'column' && course.time) {
            this.courseTime(course, kind)
          }
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        if (kind !== 'column' && course.time) {
          this.courseTime(course, kind)
        }
      }
      .width('100%')
      .height('100%')
      .padding({ left: kind === 'large' ? 9 : 7, right: kind === 'large' ? 9 : 7 })
      if (kind !== 'preview' && this.rowProgressing(course)) {
        Stack({ alignContent: Alignment.Start }) {
          Column().width('100%').height(3).backgroundColor($r('app.color.widget_rule'))
          Column().width(this.progressWidth(course)).height(3).backgroundColor(this.courseAccent(course))
        }
        .width('100%')
        .height(3)
        .accessibilityText('本节课程进度')
      }
    }
    .width('100%')
    .height(this.rowHeight(kind))
    .borderRadius(kind === 'large' ? 11 : 8)
    .clip(true)
    .backgroundColor(this.courseTint(course))
    .grayscale(this.rowDimmed(course, kind) ? 1 : 0)
    .opacity(this.rowDimmed(course, kind) ? 0.56 : 1)
  }

  // 没显示的课都排在最后一行之后（已经上完的才会被省在前面），所以说「后面」。
  @Builder
  private remainingText(kind: string) {
    Text(`后面还有 ${this.hiddenCount(kind)} 门课`)
      .width('100%')
      .fontSize(9)
      .lineHeight(CARD_REMAINING)
      .fontWeight(FontWeight.Medium)
      .fontColor($r('app.color.widget_muted'))
      .textAlign(TextAlign.End)
      .maxLines(1)
      .margin({ top: kind === 'large' ? 10 : kind === 'medium' ? this.mediumPlan().footerGap : 8 })
  }

  // 大号今日课表课少的日子，今天的课下面接着预告下一次课：「明天 周四」的标注，下面是那天开头的几门。
  // 只剩一行的地方时不列课，标注后面写第一门课和一共几门。
  @Builder
  private nextDayPreview() {
    Column({ space: 6 }) {
      Row({ space: 5 }) {
        Text(this.previewLabel)
          .fontSize(10)
          .lineHeight(12)
          .fontWeight(FontWeight.Bolder)
          .fontColor('#FFFFFF')
          .maxLines(1)
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .backgroundColor(this.accent)
          .borderRadius(8)
          .flexShrink(0)
        Text(this.previewDetail)
          .fontSize(10)
          .lineHeight(12)
          .fontWeight(600)
          .fontColor($r('app.color.widget_secondary'))
          .maxLines(1)
          .flexShrink(0)
        if (this.largePlan().preview === CARD_PREVIEW_SUMMARY) {
          Text(this.previewSummary)
            .layoutWeight(1)
            .fontSize(11)
            .lineHeight(13)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.widget_secondary'))
            .textAlign(TextAlign.End)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        } else if (this.previewCount > this.largePlan().preview) {
          Text(`后面还有 ${this.previewCount - this.largePlan().preview} 门课`)
            .layoutWeight(1)
            .fontSize(9)
            .lineHeight(CARD_REMAINING)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.widget_muted'))
            .textAlign(TextAlign.End)
            .maxLines(1)
        }
      }
      .width('100%')
      .height(16)
      ForEach(this.rows(this.previewCourses).slice(0, Math.max(0, this.largePlan().preview)), (course: WidgetCourseRow) => {
        this.todayCourseRow(course, 'preview')
      }, (course: WidgetCourseRow, index: number) => this.rowKey(course, index))
    }
    .width('100%')
    .margin({ top: this.largePlan().preview === CARD_PREVIEW_SUMMARY ? 12 : 16 })
  }

  // 今日课表：大号贴顶排、最多 7 行；中号最多两门，整块竖着居中。
  @Builder
  private todayView() {
    Column() {
      this.dateHeader('wide')
      if (this.todayRows().length === 0) {
        this.restCourses()
      } else if (this.dimension === 4) {
        Column({ space: 8 }) {
          ForEach(this.largeRows(), (course: WidgetCourseRow) => {
            this.todayCourseRow(course, 'large')
          }, (course: WidgetCourseRow, index: number) => this.rowKey(course, index))
        }
        .width('100%')
        .margin({ top: 8 })
        if (this.hiddenCount('large') > 0) {
          this.remainingText('large')
        }
        if (this.largePlan().preview !== 0) {
          this.nextDayPreview()
        }
      } else {
        Column({ space: this.mediumPlan().spacing }) {
          ForEach(this.mediumRows(), (course: WidgetCourseRow) => {
            this.todayCourseRow(course, 'medium')
          }, (course: WidgetCourseRow, index: number) => this.rowKey(course, index))
        }
        .width('100%')
        .margin({ top: 5 })
        if (this.hiddenCount('medium') > 0) {
          this.remainingText('medium')
        }
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .justifyContent(this.dimension === 4 || this.todayRows().length === 0 ? FlexAlign.Start : FlexAlign.Center)
  }

  // 两日课表的一列：没有标题、没有边框，日期栏和第一门课隔开 18。
  @Builder
  private dayColumn(side: string) {
    Column() {
      this.dateHeader(side)
      if (this.columnRows(side).length === 0) {
        this.emptyCourses(side)
      } else {
        Column({ space: 7 }) {
          ForEach(this.columnShown(side), (course: WidgetCourseRow) => {
            this.todayCourseRow(course, 'column')
          }, (course: WidgetCourseRow, index: number) => this.rowKey(course, index))
        }
        .width('100%')
        .margin({ top: 18 })
        if (this.hiddenCount(side) > 0) {
          this.remainingText(side)
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
      this.dayColumn('left')
      Divider()
        .vertical(true)
        .height('100%')
        .strokeWidth(0.5)
        .color($r('app.color.widget_divider'))
      this.dayColumn('right')
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
    const day = this.lockDay || this.headerWeekday('small') || this.leftTitle;
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
    Stack({ alignContent: Alignment.TopStart }) {
      if (this.cardPhoto && !this.isLockScreen()) {
        Image(this.cardPhoto).width('100%').height('100%').objectFit(ImageFit.Cover)
        Column().width('100%').height('100%').backgroundColor(this.surface()).opacity(this.veil)
      }
      Column() {
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
        .width(this.canvasWidth())
        .height(this.canvasHeight())
        .scale({ x: this.textScale(), y: this.textScale(), centerX: 0, centerY: 0 })
      }
      .width('100%')
      .height('100%')
      .padding(this.cardPadding())
      .alignItems(HorizontalAlign.Start)
      if (this.ticks()) {
        // 看不见的秒表：系统驱动，卡片不可见时自己停，回来接着走；时间一律从系统时钟读，不靠它累计。
        TextTimer({ controller: this.ticker })
          .format('mm:ss')
          .fontSize(1)
          .width(1)
          .height(1)
          .opacity(0)
          .onAppear(() => {
            this.ticker.start();
            this.nowMs = Date.now();
          })
          .onTimer(() => this.tick())
      }
    }
    .width('100%')
    .height('100%')
    .clip(true)
    .backgroundColor(this.isLockScreen() || this.cardPhoto ? Color.Transparent : this.surface())
    .borderRadius(this.isLockScreen() ? 0 : this.cardStyle === 'paper' || this.cardStyle === 'board' ? 6 : this.cardStyle === 'table' ? 10 : 22)
    .border(this.isLockScreen() ? { width: 0 } : this.frame())
    // onAreaChange 在卡片里不可用；onSizeChange 可以。
    .onSizeChange((_previous: SizeOptions, size: SizeOptions) => {
      this.cardWidth = Number(size.width ?? 0);
      this.cardHeight = Number(size.height ?? 0);
    })
  }
}
