import AppIntents
import SwiftUI
import WidgetKit

// The views of the schedule widgets (临近课程, 今日课表, 两日课表), ported
// from NapTable's ScheduleWidgets.swift. The widget configurations, the Live
// Activity and the controls stay in ScheduleWidgets.swift; this file has no
// entry point of its own so that the app's Debug build can compile it too and
// draw the same views in the widget gallery (`NativeWidgetGallery`).
//
// Views read "now" from `\.scheduleWidgetNow` (the entry's date, which the
// gallery pins), the family from `\.scheduleWidgetFamily` and the look from
// `\.scheduleWidgetStyle`, never from `Date.now`, `\.widgetFamily` or the
// App Group directly.

/// Which schedule widget a view draws.
@available(iOS 17.0, *)
enum ScheduleWidgetKind: String, CaseIterable, Sendable {
    case upcoming, today, twoDay, week, overview
}

/// The 日程 今日概览 counts: what is still to do today (and overdue), read from the file the
/// 日程 widget uses, with its pending ticks applied.
struct ScheduleOverviewAgenda: Equatable, Sendable {
    var count = 0
    /// The first few titles, soonest first.
    var titles: [String] = []

    static func load(now: Date) -> ScheduleOverviewAgenda {
        guard case .loaded(let snapshot) = AgendaWidgetStore.read() else { return ScheduleOverviewAgenda() }
        let due = AgendaWidgetRules.entries(snapshot, pending: AgendaWidgetStore.pending(), now: now)
            .filter { $0.group == .today || $0.group == .overdue }
        return ScheduleOverviewAgenda(count: due.count, titles: due.prefix(3).map { $0.item.title })
    }
}

private struct ScheduleOverviewAgendaKey: EnvironmentKey {
    static let defaultValue: ScheduleOverviewAgenda? = nil
}

extension EnvironmentValues {
    /// Pinned by the gallery and the settings preview; nil reads the 日程 widget's file.
    var scheduleOverviewAgenda: ScheduleOverviewAgenda? {
        get { self[ScheduleOverviewAgendaKey.self] }
        set { self[ScheduleOverviewAgendaKey.self] = newValue }
    }
}

/// What the gallery pins instead of reading the App Group and the system.
@available(iOS 17.0, *)
struct ScheduleWidgetOverrides {
    var family: WidgetFamily? = nil
    var style: WidgetStyle? = nil
    var theme: ScheduleWidgetTheme? = nil
    var options: ScheduleWidgetDisplayOptions? = nil
    /// Draw countdowns and progress as they stand at the entry's date rather
    /// than as live timers, which run on the real clock.
    var staticClock = false
    /// 今日概览's 日程, instead of the 日程 widget's file.
    var agenda: ScheduleOverviewAgenda? = nil
}

/// A whole schedule widget: the root that resolves settings, state and
/// background, around the view of its kind.
@available(iOS 17.0, *)
struct ScheduleWidgetView: View {
    let kind: ScheduleWidgetKind
    let entry: ScheduleEntry
    var overrides = ScheduleWidgetOverrides()

    var body: some View {
        ScheduleWidgetRoot(entry: entry, overrides: overrides) { payload in
            switch kind {
            case .upcoming: UpcomingOrTodayScheduleView(payload: payload)
            case .today: TodayScheduleWidgetContent(payload: payload)
            case .twoDay: TwoDayScheduleWidgetContent(payload: payload)
            case .week: WeekScheduleView(payload: payload)
            case .overview: OverviewScheduleView(payload: payload)
            }
        }
        .environment(\.scheduleOverviewAgenda, overrides.agenda)
    }
}

/// 今日概览: the next class, how much of today is left and the 日程 still to do, in one widget
/// instead of two or three side by side.
@available(iOS 17.0, *)
private struct OverviewScheduleView: View {
    let payload: SchedulePayload
    @Environment(\.scheduleWidgetFamily) private var family
    @Environment(\.scheduleWidgetNow) private var now
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleOverviewAgenda) private var pinnedAgenda
    @WidgetStyleColors private var widgetColors

    var body: some View {
        let today = payload.currentDay(now: now)
        let remaining = payload.remainingCourses(in: today, now: now)
        let agenda = pinnedAgenda ?? ScheduleOverviewAgenda.load(now: now)
        VStack(alignment: .leading, spacing: 0) {
            WidgetDateHeader(day: today, hidesCountdown: true)
            Spacer(minLength: 6)
            if family == .systemMedium {
                HStack(alignment: .top, spacing: 14) {
                    next(today: today, remaining: remaining)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    details(today: today, remaining: remaining, agenda: agenda)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            } else {
                next(today: today, remaining: remaining)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                summary(today: today, remaining: remaining, agenda: agenda)
            }
        }
    }

    /// The class going on or coming up; after the last one, the next day that has any.
    @ViewBuilder
    private func next(today: ScheduleDay, remaining: [ScheduleCourse]) -> some View {
        if let course = remaining.first {
            VStack(alignment: .leading, spacing: 4) {
                CompactNextCourse(course: course, inProgress: course.isInProgress(at: SchedulePayload.minutesSinceMidnight(now)))
                CourseCountdownLabel(course: course)
                // The medium size has room for the class after it.
                if family == .systemMedium, remaining.count > 1 {
                    CompactNextCourse(course: remaining[1]).padding(.top, 2)
                }
            }
        } else if let later = payload.nextCourseDay(after: now), let course = later.day.courseList.first {
            VStack(alignment: .leading, spacing: 4) {
                OtherDayBanner(day: later.day)
                CompactNextCourse(course: course)
            }
        } else {
            RestStateView(hadCourses: !today.courseList.isEmpty)
        }
    }

    /// Small: one line under the class.
    private func summary(today: ScheduleDay, remaining: [ScheduleCourse], agenda: ScheduleOverviewAgenda) -> some View {
        HStack(spacing: 8) {
            if !today.courseList.isEmpty {
                fact("book.closed", remaining.isEmpty ? "课上完了" : "还有 \(remaining.count) 节")
            }
            if agenda.count > 0 {
                fact("checklist", "日程 \(agenda.count)")
            }
            Spacer(minLength: 0)
        }
    }

    /// Medium: the right-hand column.
    private func details(today: ScheduleDay, remaining: [ScheduleCourse], agenda: ScheduleOverviewAgenda) -> some View {
        let total = today.courseList.count
        return VStack(alignment: .leading, spacing: 5) {
            fact("book.closed", total == 0 ? "今天没课" : remaining.isEmpty ? "今天 \(total) 节都上完了" : "今天 \(total) 节，还有 \(remaining.count) 节")
            if let together = remaining.first(where: \.isTogether) {
                fact("heart.fill", "和 TA 一起：\(together.displayName)")
            }
            fact("checklist", agenda.count == 0 ? "今天没有待办的日程" : "日程 \(agenda.count) 项")
            ForEach(Array(agenda.titles.prefix(2).enumerated()), id: \.offset) { _, title in
                Text("· \(title)")
                    .font(style.widgetFont(size: 10, weight: .regular))
                    .foregroundStyle(widgetColors.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    private func fact(_ symbol: String, _ text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(widgetColors.muted)
                .frame(width: 12)
            Text(text)
                .font(style.widgetFont(size: 10, weight: .medium))
                .foregroundStyle(widgetColors.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
    }
}

/// 大号放得下一整天，换成今日课表；其余尺寸是临近课程。
@available(iOS 17.0, *)
private struct UpcomingOrTodayScheduleView: View {
    let payload: SchedulePayload
    @Environment(\.scheduleWidgetFamily) private var family

    @ViewBuilder
    var body: some View {
        if family == .systemLarge {
            TodayScheduleView(payload: payload)
        } else {
            UpcomingScheduleView(payload: payload)
        }
    }
}

/// 今日课表：中号、大号是原来的列表或时间线，小号列今天剩下的几门，锁屏是今天的进度。
@available(iOS 17.0, *)
private struct TodayScheduleWidgetContent: View {
    let payload: SchedulePayload
    @Environment(\.scheduleWidgetFamily) private var family

    @ViewBuilder
    var body: some View {
        switch family {
        case .systemSmall: TodaySmallScheduleView(payload: payload)
        case .accessoryInline, .accessoryCircular, .accessoryRectangular: TodayAccessoryView(payload: payload)
        default: TodayScheduleView(payload: payload)
        }
    }
}

/// 两日课表：大号两列，中号两列各放两门，锁屏两行；iPad 的超大号两列各有一个大号那么宽。
@available(iOS 17.0, *)
private struct TwoDayScheduleWidgetContent: View {
    let payload: SchedulePayload
    @Environment(\.scheduleWidgetFamily) private var family

    @ViewBuilder
    var body: some View {
        switch family {
        case .systemExtraLarge:
            // 每一列就是一个大号小组件的宽度：按大号的字号和卡片画，不用半宽列收过一号的那套。
            TwoDayScheduleView(payload: payload, wide: true)
                .environment(\.scheduleWidgetFamily, .systemLarge)
        case .systemMedium: TwoDayMediumScheduleView(payload: payload)
        case .accessoryInline, .accessoryCircular, .accessoryRectangular: TwoDayAccessoryView(payload: payload)
        default: TwoDayScheduleView(payload: payload)
        }
    }
}

@available(iOS 17.0, *)
private struct ScheduleWidgetThemeEnvironmentKey: EnvironmentKey {
    static let defaultValue = ScheduleWidgetTheme.colorGlass
}

@available(iOS 17.0, *)
private struct ScheduleWidgetDisplayOptionsEnvironmentKey: EnvironmentKey {
    static let defaultValue = ScheduleWidgetDisplayOptions.default
}

@available(iOS 17.0, *)
private struct ScheduleWidgetFamilyEnvironmentKey: EnvironmentKey {
    static let defaultValue = WidgetFamily.systemSmall
}

@available(iOS 17.0, *)
private struct ScheduleWidgetNoticeEnvironmentKey: EnvironmentKey {
    static let defaultValue: ScheduleWidgetNotice? = nil
}

@available(iOS 17.0, *)
private struct ScheduleWidgetStaticClockEnvironmentKey: EnvironmentKey {
    static let defaultValue = false
}

@available(iOS 17.0, *)
private struct ScheduleWidgetNowEnvironmentKey: EnvironmentKey {
    /// 只有没经过 `ScheduleWidgetRoot` 的视图才会读到这个。
    static var defaultValue: Date { Date.now }
}

@available(iOS 17.0, *)
extension EnvironmentValues {
    /// 小组件尺寸。系统的 `widgetFamily` 只读，`ScheduleWidgetRoot` 把它转存到这里，
    /// 预览画廊才能在 App 里按指定尺寸渲染。下面的视图一律读这个。
    var scheduleWidgetFamily: WidgetFamily {
        get { self[ScheduleWidgetFamilyEnvironmentKey.self] }
        set { self[ScheduleWidgetFamilyEnvironmentKey.self] = newValue }
    }

    var scheduleWidgetTheme: ScheduleWidgetTheme {
        get { self[ScheduleWidgetThemeEnvironmentKey.self] }
        set { self[ScheduleWidgetThemeEnvironmentKey.self] = newValue }
    }

    var scheduleWidgetDisplayOptions: ScheduleWidgetDisplayOptions {
        get { self[ScheduleWidgetDisplayOptionsEnvironmentKey.self] }
        set { self[ScheduleWidgetDisplayOptionsEnvironmentKey.self] = newValue }
    }

    /// 今天放假（寒暑假）或课表过期：休息状态换成「寒假ing」「打开 App 更新课表」。
    var scheduleWidgetNotice: ScheduleWidgetNotice? {
        get { self[ScheduleWidgetNoticeEnvironmentKey.self] }
        set { self[ScheduleWidgetNoticeEnvironmentKey.self] = newValue }
    }

    /// 这一条时间线条目画的是哪一刻：`ScheduleWidgetRoot` 放进来的 `entry.date`。
    /// 一条时间线里排着一整天的条目，系统提前把每一条都画好，所以小组件的视图只能从这里
    /// 读「现在」，读真实时间会让每一条都画成生成时间线的那一刻。
    /// 预览画廊把要钉的时刻当作条目的日期传进来，照样钉得住。
    var scheduleWidgetNow: Date {
        get { self[ScheduleWidgetNowEnvironmentKey.self] }
        set { self[ScheduleWidgetNowEnvironmentKey.self] = newValue }
    }

    /// 倒计时和进度条按条目那一刻画成静止的。小组件里它们是系统驱动的实时计时，
    /// 走真实时间；预览画廊钉着别的时刻，得自己算出那一刻的样子。
    var scheduleWidgetStaticClock: Bool {
        get { self[ScheduleWidgetStaticClockEnvironmentKey.self] }
        set { self[ScheduleWidgetStaticClockEnvironmentKey.self] = newValue }
    }
}

@available(iOS 17.0, *)
private struct ScheduleWidgetRoot<Content: View>: View {
    let entry: ScheduleEntry
    let overrides: ScheduleWidgetOverrides
    @ViewBuilder let content: (SchedulePayload) -> Content
    @Environment(\.widgetFamily) private var systemFamily

    private var family: WidgetFamily { overrides.family ?? systemFamily }

    var body: some View {
        let defaults = UserDefaults(suiteName: AppWidgetConfiguration.appGroup)
        let theme = overrides.theme ?? AppWidgetConfiguration.scheduleTheme
        let style = overrides.style ?? WidgetStyle.load(from: defaults)
        let displayOptions = overrides.options ?? AppWidgetConfiguration.displayOptions
        // 锁屏的几种尺寸本来就按系统给的那一小块排满了，不跟着缩放。
        let textSize: ScheduleWidgetTextSize = family.isAccessory ? .standard : (entry.configuration.textSize ?? displayOptions.textSize)
        return WidgetTextScaled(size: textSize) {
            switch entry.state {
            case .loaded(let payload):
                content(payload)
                    .environment(\.scheduleWidgetNotice, payload.notice(now: entry.date))
                    .overlayPreferenceValue(FireworksOriginKey.self) { anchor in
                        if let anchor {
                            GeometryReader { proxy in
                                // 按下那一刻身份不能变：整层换身份时是整块替进来，碎片的出场动画不放。
                                // 收起时反过来要换，见 `ScheduleEntry.fireworksRound`。
                                FireworksOverlay(active: entry.celebrating, origin: proxy[anchor])
                                    .id(entry.fireworksRound)
                            }
                            .allowsHitTesting(false)
                        }
                    }
            case .unconfigured:
                WidgetMessageView(
                    symbol: "rectangle.stack.badge.plus",
                    title: "等待课表同步",
                    detail: "打开 App 登录并同步一次课表"
                )
            case .failed(let message):
                WidgetMessageView(
                    symbol: "exclamationmark.arrow.triangle.2.circlepath",
                    title: "课表读取失败",
                    detail: message
                )
            }
        }
        .environment(\.scheduleWidgetTheme, theme)
        .environment(\.scheduleWidgetStyle, style)
        .environment(\.scheduleWidgetDisplayOptions, displayOptions)
        .environment(\.scheduleWidgetConfiguration, entry.configuration)
        .environment(\.scheduleWidgetCelebrating, entry.celebrating)
        .environment(\.scheduleWidgetFamily, family)
        .environment(\.scheduleWidgetNow, entry.date)
        .environment(\.scheduleWidgetStaticClock, overrides.staticClock)
        .widgetURL(entry.appURL)
        .containerBackground(for: .widget) {
            if family.isAccessory {
                Color.clear
            } else {
                ScheduleWidgetBackground(style: style)
            }
        }
    }
}

@available(iOS 17.0, *)
extension WidgetFamily {
    var isAccessory: Bool {
        self == .accessoryInline || self == .accessoryCircular || self == .accessoryRectangular
    }
}

@available(iOS 17.0, *)
private struct WidgetMessageView: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    let symbol: String
    let title: String
    let detail: String
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.scheduleWidgetFamily) private var family

    @ViewBuilder
    var body: some View {
        switch family {
        case .accessoryInline:
            Label(title, systemImage: symbol)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: symbol)
                    .font(style.widgetFont(size: 20, weight: .semibold))
                    .widgetAccentable()
            }
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(style.widgetFont(size: 19, weight: .semibold))
                    .widgetAccentable()
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(style.widgetFont(size: 13, weight: .bold))
                    Text(detail)
                        .font(style.widgetFont(size: 10))
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: symbol)
                    .font(style.widgetFont(size: 24, weight: .semibold))
                    .foregroundStyle(widgetColors.accent(for: theme))
                Text(title)
                    .font(style.widgetFont(size: 15, weight: .bold))
                    .foregroundStyle(widgetColors.primary)
                Text(detail)
                    .font(style.widgetFont(size: 11))
                    .foregroundStyle(widgetColors.secondary)
                    .lineLimit(3)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .padding(2)
        }
    }
}

@available(iOS 17.0, *)
private struct UpcomingScheduleView: View {
    @Environment(\.scheduleWidgetStyle) private var style
    let payload: SchedulePayload
    @Environment(\.scheduleWidgetFamily) private var family
    @Environment(\.scheduleWidgetConfiguration) private var configuration
    @Environment(\.scheduleWidgetNotice) private var notice
    @Environment(\.scheduleWidgetNow) private var now

    @ViewBuilder
    var body: some View {
        let selection = payload.upcoming(now: now, afterClass: configuration.afterClass)
        // 「接着显示下一次课」把今天换成了别的日子：课程正上方挂一条「明天 周二」。
        // 课程照常上色，压暗是「已经上完」的意思，拿来表示明天的课会被看成上过了。
        let otherDay = OtherDay.offset(of: selection.0, now: now) == nil ? nil : selection.0
        if family.isAccessory {
            LockScreenScheduleView(day: selection.0, courses: selection.1)
        } else {
            if style == .board && family == .systemSmall && !selection.1.isEmpty
                && (configuration.upcomingCourseCount == 1 || selection.1.count == 1) {
                // Measure the complete header and ticket together: a two-line title can
                // leave too little room even for the unpadded single-course fallback.
                ViewThatFits(in: .vertical) {
                    scheduleContent(selection: selection, otherDay: otherDay, hidesCountdown: false)
                        .fixedSize(horizontal: false, vertical: true)
                    scheduleContent(selection: selection, otherDay: otherDay, hidesCountdown: true)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxHeight: .infinity, alignment: otherDay == nil ? .center : .top)
            } else if (family == .systemMedium || (family == .systemSmall && style != .board)) && !selection.1.isEmpty {
                // 小号、中号把日期栏和课程放在一起挑排法，每种排法只有一种尺寸，量得准。放不下时依次退让：
                // 先收课程的间距和字号，再去掉课表名，最后才把课名压成一行；小号保留开启的假期倒计时。
                // ViewThatFits 里只放一层 ForEach：嵌套或空的 ForEach 会让它挑最后一个时触发断言。
                let two = family == .systemSmall && configuration.upcomingCourseCount > 1 && selection.1.count > 1
                ViewThatFits(in: .vertical) {
                    ForEach(Self.smallVariants(two: two, otherDay: otherDay != nil, medium: family == .systemMedium), id: \.self) { variant in
                        scheduleContent(selection: selection, otherDay: otherDay, hidesCountdown: variant.step.hidesCountdown,
                                        hidesTableName: variant.step.hidesTableName, smallLayout: variant.layout)
                    }
                }
            } else {
                scheduleContent(selection: selection, otherDay: otherDay, hidesCountdown: false)
            }
        }
    }

    private struct SmallHeaderStep: Hashable {
        let hidesCountdown: Bool
        let hidesTableName: Bool
    }

    private static let smallHeaderSteps = [
        SmallHeaderStep(hidesCountdown: false, hidesTableName: false),
        SmallHeaderStep(hidesCountdown: true, hidesTableName: false),
        SmallHeaderStep(hidesCountdown: true, hidesTableName: true),
    ]

    /// 小号课程区的一种排法。
    private enum SmallLayout: Hashable {
        /// 一节：带「当前」「下一节」或「明天」标题，底下垫这么多。
        case column(bottom: CGFloat, size: CourseSummary.Size, titleLines: Int)
        /// 一节：不带标题。
        case summary(size: CourseSummary.Size, titleLines: Int)
        /// 两节：彼此隔开 `gap`，第一节三行之间隔 `lineSpacing`。
        case two(gap: CGFloat, lineSpacing: CGFloat)
        /// 中号两栏。
        case medium(MediumFallback)
    }

    private struct SmallVariant: Hashable {
        let step: SmallHeaderStep
        let layout: SmallLayout
    }

    /// 先保住日期栏，在课程区里退让：先收间距、缩小字号，再把课名压成一行（课名前半段最要紧，
    /// 截掉后半段也认得出），然后才去掉「当前」「下一节」标题；还放不下才收课表名。
    private static func smallVariants(two: Bool, otherDay: Bool, medium: Bool) -> [SmallVariant] {
        let layouts = smallLayouts(two: two, otherDay: otherDay, medium: medium)
        let steps = medium ? smallHeaderSteps : [
            SmallHeaderStep(hidesCountdown: false, hidesTableName: false),
            SmallHeaderStep(hidesCountdown: false, hidesTableName: true),
        ]
        return steps.flatMap { step in layouts.map { SmallVariant(step: step, layout: $0) } }
    }

    private static func smallLayouts(two: Bool, otherDay: Bool, medium: Bool) -> [SmallLayout] {
        if medium {
            // 两栏一起换字号、一起压成一行，两边不会一大一小。
            return [
                .medium(MediumFallback(size: .large, labels: true, titleLines: 2)),
                .medium(MediumFallback(size: .regular, labels: true, titleLines: 2)),
                .medium(MediumFallback(size: .regular, labels: true, titleLines: 1)),
                .medium(MediumFallback(size: .regular, labels: false, titleLines: 1)),
            ]
        }
        if two {
            // 两节的课名本来就只有一行，只收间距。
            return [.two(gap: 6, lineSpacing: 3), .two(gap: 3, lineSpacing: 3), .two(gap: 2, lineSpacing: 1), .two(gap: 1, lineSpacing: 0)]
        }
        // 大屏上多出来的高度别全压在日期和课程之间：放得下时底下也垫一点。
        // 别的日子的标注不能去，只退字号和行数。
        let columns: [SmallLayout] = [14, 8, 0].map { .column(bottom: $0, size: .large, titleLines: 2) }
            + [.column(bottom: 0, size: .regular, titleLines: 2), .column(bottom: 0, size: .regular, titleLines: 1)]
        return otherDay ? columns : columns + [.summary(size: .regular, titleLines: 1)]
    }

    @ViewBuilder
    private func smallCourses(_ layout: SmallLayout, selection: (ScheduleDay, [ScheduleCourse]), otherDay: ScheduleDay?) -> some View {
        let course = selection.1[0]
        switch layout {
        case let .column(bottom, size, titleLines):
            let label = Self.columnLabels(first: course, otherDay: otherDay != nil, now: now).first
            UpcomingColumn(label: label, course: course, size: size, otherDay: otherDay, titleLines: titleLines, live: otherDay == nil)
                .padding(.bottom, bottom)
        case let .summary(size, titleLines):
            CourseSummary(course: course, size: size, titleLines: titleLines)
        case let .two(gap, lineSpacing):
            twoCourses(first: course, second: selection.1[1], otherDay: otherDay, gap: gap, lineSpacing: lineSpacing)
        case let .medium(fallback):
            mediumColumns(fallback, selection: selection, otherDay: otherDay)
        }
    }

    /// 中号两栏。两节都是别的日子的：标注横跨两栏占一行，两栏不再各自写标题。只挂在左栏的话，
    /// 和右栏的「接下来」并排，像是左边明天、右边接下来。
    private func mediumColumns(_ fallback: MediumFallback, selection: (ScheduleDay, [ScheduleCourse]), otherDay: ScheduleDay?) -> some View {
        let labels = Self.columnLabels(first: selection.1[0], otherDay: otherDay != nil, now: now)
        return VStack(alignment: .leading, spacing: 7) {
            if let otherDay {
                OtherDayBanner(day: otherDay)
            }
            HStack(alignment: .top, spacing: 14) {
                UpcomingColumn(
                    label: otherDay == nil && fallback.labels ? labels.first : nil,
                    course: selection.1.first,
                    size: fallback.size,
                    titleLines: fallback.titleLines,
                    live: otherDay == nil
                )
                Divider()
                UpcomingColumn(
                    label: otherDay == nil && fallback.labels ? labels.second : nil,
                    course: selection.1.count > 1 ? selection.1[1] : nil,
                    size: fallback.size,
                    titleLines: fallback.titleLines
                )
            }
        }
    }

    private func scheduleContent(
        selection: (ScheduleDay, [ScheduleCourse]),
        otherDay: ScheduleDay?,
        hidesCountdown: Bool,
        hidesTableName: Bool = false,
        smallLayout: SmallLayout? = nil
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // 换到别的日子时日期栏照旧是今天，靠课程上方的标注说明下面是哪天的课。
            WidgetDateHeader(
                day: otherDay == nil ? selection.0 : payload.currentDay(now: now),
                // 休息状态自己会大字写这段假期。
                hidesCountdown: (family != .systemSmall && hidesCountdown) || (selection.1.isEmpty && notice == nil),
                tableName: hidesTableName ? nil : payload.title
            )
            // 小号放两节时最挤，日期栏和课程之间只留最少的 3；放得下时照样由 Spacer 撑开。
            let twoInSmall = family == .systemSmall && configuration.upcomingCourseCount > 1 && selection.1.count > 1
            if otherDay != nil {
                Spacer(minLength: 0).frame(height: OtherDay.headerSpacing)
            } else {
                Spacer(minLength: twoInSmall ? 3 : 8)
            }

            if selection.1.isEmpty {
                RestStateView(hadCourses: !payload.currentDay(now: now).courseList.isEmpty)
            } else if let smallLayout {
                smallCourses(smallLayout, selection: selection, otherDay: otherDay)
                    .frame(maxHeight: .infinity, alignment: otherDay == nil ? .bottom : .top)
                    .layoutPriority(1)
            } else if let course = selection.1.first {
                // 默认只放一节：当前这节，没在上课就是接下来那节。「编辑小组件」里可以改成两节。
                if configuration.upcomingCourseCount > 1 && selection.1.count > 1 {
                    // 两节挤在小号里：第一节课名只占一行，第二节不再另起标题。再挂上「明天 周三」
                    // 和日期栏的假期倒计时就放不下了：只收间距，教室一定要留着。
                    ViewThatFits(in: .vertical) {
                        twoCourses(first: course, second: selection.1[1], otherDay: otherDay, gap: 6)
                        twoCourses(first: course, second: selection.1[1], otherDay: otherDay, gap: 3)
                        twoCourses(first: course, second: selection.1[1], otherDay: otherDay, gap: 2, lineSpacing: 1)
                        // SE 这样的小屏。
                        twoCourses(first: course, second: selection.1[1], otherDay: otherDay, gap: 1, lineSpacing: 0)
                    }
                    .frame(maxHeight: .infinity, alignment: otherDay == nil ? .bottom : .top)
                    .layoutPriority(1)
                } else {
                    if style == .board && hidesCountdown {
                        VStack(alignment: .leading, spacing: 3) {
                            if let otherDay {
                                OtherDayBanner(day: otherDay)
                            }
                            StationCourseTicket(course: course, verticalPadding: 1, ruleSpacing: 0)
                        }
                    } else {
                        // 只放一节时中间空着一大块：像中号一样标上「当前」「下一节」，字也大一号。
                        // 课名折成两行、屏幕又小时放不下，先去标题，再退回原来的字号；
                        // 别的日子的标注不能去，只退字号。
                        // 大屏上多出来的高度全压在日期和课程之间会显得空：放得下时底下也垫一点，
                        // 空白分到上下两边；小屏照旧贴底。
                        let label = Self.columnLabels(first: course, otherDay: otherDay != nil, now: now).first
                        ViewThatFits(in: .vertical) {
                            ForEach([14, 8, 0] as [CGFloat], id: \.self) { bottom in
                                UpcomingColumn(label: label, course: course, size: .large, otherDay: otherDay, live: otherDay == nil)
                                    .padding(.bottom, bottom)
                            }
                            if otherDay != nil {
                                UpcomingColumn(label: label, course: course, size: .regular, otherDay: otherDay)
                                UpcomingColumn(label: label, course: course, size: .regular, otherDay: otherDay, titleLines: 1)
                            } else {
                                CourseSummary(course: course, size: .large)
                                CourseSummary(course: course, size: .regular)
                                CourseSummary(course: course, size: .regular, titleLines: 1)
                            }
                        }
                        .frame(maxHeight: .infinity, alignment: otherDay == nil ? .bottom : .top)
                        // 先把高度让给它，上面的 Spacer 只留最小的 8，ViewThatFits 才量得准。
                        .layoutPriority(1)
                    }
                }
            }
        }
    }

    private struct MediumFallback: Hashable {
        let size: CourseSummary.Size
        let labels: Bool
        let titleLines: Int
    }

    /// 小号放两节：「明天 周三」、第一节、第二节，彼此隔开 `gap`；第一节的三行之间隔 `lineSpacing`。
    private func twoCourses(
        first: ScheduleCourse,
        second: ScheduleCourse,
        otherDay: ScheduleDay?,
        gap: CGFloat,
        lineSpacing: CGFloat = 3
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let otherDay {
                OtherDayBanner(day: otherDay)
                    .padding(.bottom, gap)
            }
            CourseSummary(course: first, size: .regular, titleLines: 1, lineSpacing: lineSpacing)
            Spacer(minLength: gap)
            CompactNextCourse(course: second)
        }
    }

    /// 中号两栏（小号一节）的标题。第一节还没开始时叫「当前」就错了：那是下一节。
    /// 别的日子的课换成「明天 周二」标注，用不到这里的字。
    private static func columnLabels(first: ScheduleCourse, otherDay: Bool, now: Date) -> (first: String, second: String) {
        if otherDay { return ("第一节", "接下来") }
        if first.isInProgress(at: SchedulePayload.minutesSinceMidnight(now)) { return ("当前", "接下来") }
        return ("下一节", "之后")
    }
}

@available(iOS 17.0, *)
private struct LockScreenScheduleView: View {
    @Environment(\.scheduleWidgetStyle) private var style
    let day: ScheduleDay
    let courses: [ScheduleCourse]
    @Environment(\.scheduleWidgetFamily) private var family
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetNotice) private var notice
    @Environment(\.scheduleWidgetNow) private var now
    @Environment(\.scheduleWidgetStaticClock) private var staticClock

    /// 没课时的图标：放假、过期各有各的。
    private var emptySymbol: String { notice?.symbol ?? "calendar.badge.checkmark" }

    @ViewBuilder
    var body: some View {
        switch family {
        case .accessoryInline:
            inlineView
        case .accessoryCircular:
            circularView
        default:
            rectangularView
        }
    }

    private var inlineView: some View {
        Label {
            if let course = courses.first {
                // 一行写不下就先去掉教室老师，别留下「教1-10…」半个门牌号。
                ViewThatFits(in: .horizontal) {
                    Text(inlineText(course, metadata: options.metadata(for: course))).fixedSize()
                    Text(inlineText(course, metadata: options.shortMetadata(for: course))).fixedSize()
                    Text(inlineText(course, metadata: nil))
                }
            } else {
                Text(inlineEmptyText)
            }
        } icon: {
            Image(systemName: courses.isEmpty ? emptySymbol : "book.closed.fill")
        }
        .lineLimit(1)
    }

    /// 单行锁屏只有一句话的位置：祝福 → 假期倒计时 → 「今日无课」。
    private var inlineEmptyText: String {
        notice?.inlineText ?? RestState.inlineText(options: options, now: now)
    }

    /// 第一节是今天的课、现在正在上，而且开着「上课倒计时与进度」：圆形画成这节课的进度环。
    private var liveCourse: (course: ScheduleCourse, interval: ClosedRange<Date>)? {
        guard options.showProgress, OtherDay.offset(of: day, now: now) == nil, let course = courses.first,
              course.isInProgress(at: SchedulePayload.minutesSinceMidnight(now)),
              let interval = course.interval(onDayOf: now), interval.upperBound > now else { return nil }
        return (course, interval)
    }

    /// 进度环中间：还剩多久下课。
    private func liveLabel(_ live: (course: ScheduleCourse, interval: ClosedRange<Date>)) -> some View {
        VStack(spacing: 0) {
            Group {
                if staticClock {
                    let seconds = max(0, Int(live.interval.upperBound.timeIntervalSince(now)))
                    Text(seconds >= 3600
                        ? String(format: "%d:%02d", seconds / 3600, seconds % 3600 / 60)
                        : String(format: "%d:%02d", seconds / 60, seconds % 60))
                } else {
                    Text(timerInterval: now...live.interval.upperBound, countsDown: true)
                        .multilineTextAlignment(.center)
                }
            }
            .font(style.timeFont(size: 12, weight: .bold, design: .rounded).monospacedDigit())
            .minimumScaleFactor(0.6)
            // 环里只有四五个字的地方，课名放不下：写这是数到哪的倒计时，课名看矩形或单行的那个。
            Text("距下课")
                .font(style.widgetFont(size: 8, weight: .semibold))
        }
        .lineLimit(1)
        .padding(.horizontal, 9)
    }

    private var circularView: some View {
        ZStack {
            AccessoryWidgetBackground()
            if let live = liveCourse {
                // 系统驱动的实时进度环，不用小组件刷新。画廊出图的渲染器画不了它，用同样的环形仪表代替。
                Group {
                    if staticClock {
                        let total = live.interval.upperBound.timeIntervalSince(live.interval.lowerBound)
                        Gauge(value: min(max(now.timeIntervalSince(live.interval.lowerBound) / total, 0), 1)) {
                            EmptyView()
                        } currentValueLabel: {
                            liveLabel(live)
                        }
                        .gaugeStyle(.accessoryCircularCapacity)
                    } else {
                        ProgressView(timerInterval: live.interval, countsDown: false) {
                            EmptyView()
                        } currentValueLabel: {
                            liveLabel(live)
                        }
                        .progressViewStyle(.circular)
                    }
                }
                .widgetAccentable()
                .accessibilityLabel("本节课程进度")
            } else if let course = courses.first {
                VStack(spacing: 0) {
                    Image(systemName: "book.closed.fill")
                        .font(style.widgetFont(size: 10, weight: .semibold))
                        .widgetAccentable()
                    if options.showTime {
                        Text(course.startLabel)
                            .font(style.widgetFont(size: 12, weight: .bold, design: .rounded))
                            .minimumScaleFactor(0.72)
                    }
                    if let primary = options.primaryValue(for: course), primary != course.timeRange {
                        // 长课名折成两行，不再缩到看不清。
                        Text(primary)
                            .font(style.widgetFont(size: 8, weight: .semibold))
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .minimumScaleFactor(0.85)
                    }
                }
                .padding(5)
            } else {
                VStack(spacing: 1) {
                    Image(systemName: emptySymbol)
                        .font(style.widgetFont(size: 15, weight: .semibold))
                        .widgetAccentable()
                    Text(notice?.circularText ?? "无课")
                        .font(style.widgetFont(size: 9, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
    }

    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: courses.isEmpty ? emptySymbol : "book.closed.fill")
                    .font(style.widgetFont(size: 10, weight: .semibold))
                    .widgetAccentable()
                // 换到了别的日子时带上「明天」，锁屏上只有这一行说明是哪天。
                Text([OtherDay.label(for: day, now: now) ?? "", day.compactDate, day.displayLabel].filter { !$0.isEmpty }.joined(separator: " "))
                    .font(style.widgetFont(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 2)
                if courses.count > 1 {
                    // 第一节还没开始时它自己就是「下一节」，第二节只能叫「之后」。
                    let inProgress = OtherDay.offset(of: day, now: now) == nil
                        && courses[0].isInProgress(at: SchedulePayload.minutesSinceMidnight(now))
                    Text("\(inProgress ? "下一节" : "之后") \(courses[1].startLabel)")
                        .font(style.widgetFont(size: 9, weight: .medium))
                        .lineLimit(1)
                }
            }
            if let course = courses.first {
                if let primary = options.primaryValue(for: course) {
                    Text(primary)
                        .font(style.widgetFont(size: 14, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                }
                CourseMetadataLine(course: course, font: style.widgetFont(size: 10, weight: .medium))
                let today = OtherDay.offset(of: day, now: now) == nil
                if options.showTime || today {
                    // 今天的课：时间右边是「距下课」「距上课」的倒计时，正在上时下面一条进度。
                    HStack(spacing: 4) {
                        if options.showTime {
                            Text(course.timeRange)
                                .font(style.widgetFont(size: 10, weight: .medium))
                                .lineLimit(1)
                                .minimumScaleFactor(0.72)
                        }
                        Spacer(minLength: 0)
                        if today {
                            CourseCountdownLabel(course: course)
                        }
                    }
                }
                if today {
                    CourseProgressBar(course: course)
                }
            } else {
                let lines = emptyLines
                Text(lines.primary)
                    .font(style.widgetFont(size: 14, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
                if let secondary = lines.secondary {
                    Text(secondary)
                        .font(style.widgetFont(size: 10, weight: .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    /// 休息状态：有假期就大字写假期、小字写「4 天后 · 10.1 - 10.7 · 休 7 天」，没有才说「今日无课」。
    private var emptyLines: (primary: String, secondary: String?) {
        if let notice { return (notice.title, notice.detail(now: now)) }
        guard let holiday = RestState.holiday(options: options, now: now) else {
            return ("今日无课", "打开课表查看本周安排")
        }
        return (holiday.title, "\(holiday.caption) · \(holiday.detail)")
    }

    private func inlineText(_ course: ScheduleCourse, metadata: String?) -> String {
        [
            OtherDay.label(for: day, now: now) ?? day.shortLabel,
            options.showTime ? course.startLabel : nil,
            options.primaryValue(for: course),
            metadata
        ]
        .compactMap { $0 }
        .joined(separator: " ")
    }
}

@available(iOS 17.0, *)
private struct UpcomingColumn: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetFamily) private var family
    @WidgetStyleColors private var widgetColors
    /// 没有就不留标题行（中号标注已经横跨两栏写在上面）。
    let label: String?
    let course: ScheduleCourse?
    var size: CourseSummary.Size = .regular
    /// 课是别的日子的：标题换成「明天 周二」「3 天后 10.1 周四」。
    var otherDay: ScheduleDay? = nil
    var titleLines = 2
    /// 这一节是今天的当前或下一节：标题右边带倒计时，正在上时课程下面带进度。别的日子的课不能给。
    var live = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            // 标注带胶囊底色，比纯文字的标题高：两种都占一样高，换不换日子课的位置都不跳。
            if let otherDay {
                OtherDayBanner(day: otherDay)
            } else if let label, style != .board {
                HStack(spacing: 4) {
                    Text(label)
                        .font(style.widgetFont(size: 11, weight: .semibold))
                        .foregroundStyle(widgetColors.secondary)
                        .lineLimit(1)
                        .fixedSize()
                    Spacer(minLength: 0)
                    if live, let course {
                        CourseCountdownLabel(course: course)
                    }
                }
                .frame(height: OtherDayBanner.height, alignment: .leading)
            }
            if let course {
                CourseSummary(course: course, size: size, titleLines: titleLines, showsProgress: live && otherDay == nil)
            } else {
                Text("暂无课程")
                    .font(style.widgetFont(size: 11))
                    .foregroundStyle(widgetColors.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Include the ticket's full height when ViewThatFits chooses a single-course layout.
        // Otherwise the column reports a compressed minimum and padded variants overflow small widgets.
        .fixedSize(horizontal: false, vertical: family == .systemSmall)
    }
}

/// A restrained ticket for the board: departure time, a perforation, then the
/// course and room. The stacked version keeps small widgets and two-day
/// columns readable.
@available(iOS 17.0, *)
struct StationCourseTicket: View {
    let course: ScheduleCourse
    var titleSize: CGFloat = 12
    var titleLines = 2
    var compact = false
    var horizontal = false
    var verticalPadding: CGFloat = 6
    var ruleSpacing: CGFloat = 2
    /// 这节课是今天的：正在上时在课程信息下面画一条实时进度。
    var showsProgress = false
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.scheduleWidgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    @WidgetStyleColors private var colors

    private var accent: Color {
        colors.accent(for: course, theme: theme, colorScheme: scheme)
    }

    var body: some View {
        Group {
            if horizontal && options.showTime {
                HStack(spacing: 9) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(course.startLabel)
                            .font(.system(size: family == .systemLarge ? 14 : 12, weight: .semibold, design: .monospaced))
                            .foregroundStyle(accent)
                            .widgetAccentable()
                        if let end = course.endLabel {
                            Text(end)
                                .font(.system(size: family == .systemLarge ? 11 : 9, design: .monospaced))
                                .foregroundStyle(colors.secondary)
                        }
                    }
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .frame(width: family == .systemLarge ? 50 : 44, alignment: .leading)
                    StationPerforation(vertical: true)
                        .stroke(colors.muted.opacity(0.4), style: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
                        .frame(width: 1)
                        .padding(.vertical, -5)
                        .accessibilityHidden(true)
                    details
                }
            } else {
                VStack(alignment: .leading, spacing: compact || titleLines == 1 ? 1 : 2) {
                    if options.showTime {
                        HStack(spacing: 4) {
                            Text(course.timeRange)
                                .font(.system(size: family == .systemLarge ? 11 : (compact || titleLines == 1 ? 9 : 11), weight: .semibold, design: .monospaced))
                                .monospacedDigit()
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.right")
                                .font(.system(size: 8, weight: .regular))
                                .accessibilityHidden(true)
                        }
                        .foregroundStyle(colors.secondary)
                        StationPerforation()
                            .stroke(colors.muted.opacity(0.35), style: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
                            .frame(height: 1)
                            .padding(.vertical, compact || titleLines == 1 ? 0 : ruleSpacing)
                            .accessibilityHidden(true)
                    }
                    details
                }
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 9)
        .padding(.vertical, compact || titleLines == 1 ? 2 : verticalPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            StationTicketShape()
                .fill(colors.primary.opacity(scheme == .dark ? 0.05 : 0.03))
                .overlay {
                    StationTicketShape().stroke(colors.muted.opacity(0.3), lineWidth: 0.5)
                }
        }
        .overlay(alignment: .leading) {
            // The line's colour, as a platform marker on the ticket's edge.
            Capsule().fill(accent).frame(width: 2.5).padding(.vertical, 5).padding(.leading, 2.5)
                .widgetAccentable()
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let primary = options.primaryValue(for: course) {
                Text(primary)
                    .font(.system(size: family == .systemLarge ? titleSize : min(titleSize, compact ? 11 : 12), weight: .semibold))
                    .foregroundStyle(colors.primary)
                    .lineLimit(titleLines)
                    .minimumScaleFactor(family == .systemLarge ? 0.9 : 0.76)
            }
            if !compact {
                CourseMetadataLine(
                    course: course,
                    font: .system(size: family == .systemLarge ? (horizontal ? 12 : 11) : 9, weight: .regular),
                    color: colors.secondary
                )
            }
            if showsProgress {
                CourseProgressBar(course: course)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A paper ticket with a small punch on each edge.
@available(iOS 17.0, *)
struct StationTicketShape: Shape {
    func path(in rect: CGRect) -> Path {
        let r: CGFloat = 3
        let mid = rect.midY
        return Path { path in
            path.move(to: CGPoint(x: r, y: 0))
            path.addLine(to: CGPoint(x: rect.maxX - r, y: 0))
            path.addQuadCurve(to: CGPoint(x: rect.maxX, y: r), control: CGPoint(x: rect.maxX, y: 0))
            path.addLine(to: CGPoint(x: rect.maxX, y: mid - r))
            path.addQuadCurve(to: CGPoint(x: rect.maxX, y: mid + r), control: CGPoint(x: rect.maxX - 2 * r, y: mid))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
            path.addQuadCurve(to: CGPoint(x: rect.maxX - r, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
            path.addLine(to: CGPoint(x: r, y: rect.maxY))
            path.addQuadCurve(to: CGPoint(x: 0, y: rect.maxY - r), control: CGPoint(x: 0, y: rect.maxY))
            path.addLine(to: CGPoint(x: 0, y: mid + r))
            path.addQuadCurve(to: CGPoint(x: 0, y: mid - r), control: CGPoint(x: 2 * r, y: mid))
            path.addLine(to: CGPoint(x: 0, y: r))
            path.addQuadCurve(to: CGPoint(x: r, y: 0), control: .zero)
            path.closeSubpath()
        }
    }
}

@available(iOS 17.0, *)
struct StationPerforation: Shape {
    var vertical = false

    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.minX, y: rect.minY))
            path.addLine(to: CGPoint(x: vertical ? rect.minX : rect.maxX, y: vertical ? rect.maxY : rect.minY))
        }
    }
}

/// 「教室 · 老师」一行。放不下时只写教室，不留「实验楼 B402 · 陈…」这种半个名字。
@available(iOS 17.0, *)
private struct CourseMetadataLine: View {
    let course: ScheduleCourse
    let font: Font
    var color: Color? = nil
    @Environment(\.scheduleWidgetDisplayOptions) private var options

    var body: some View {
        if let full = options.metadata(for: course) {
            let short = options.shortMetadata(for: course) ?? full
            // 不用 ViewThatFits：外层按理想高度挑排法时，它报的高度不准，会把本来放得下的两行课名挤成一行。
            FirstThatFitsHorizontally {
                line(full)
                line(short)
            }
        }
    }

    private func line(_ value: String) -> some View {
        Text(value)
            .font(font)
            .foregroundStyle(color.map(AnyShapeStyle.init) ?? AnyShapeStyle(.primary))
            .lineLimit(1)
    }
}

@available(iOS 17.0, *)
private struct CourseSummary: View {
    @WidgetStyleColors private var widgetColors
    enum Size {
        /// 小号放两节时的第一节，和中号两栏。
        case regular
        /// 小号只放一节。
        case large

        var title: CGFloat { self == .large ? 17 : 15 }
        var metadata: CGFloat { self == .large ? 11 : 10 }
        var time: CGFloat { self == .large ? 12 : 11 }
    }

    let course: ScheduleCourse
    var size: Size = .regular
    var titleLines = 2
    /// 课名、教室老师、时间三行之间的间距。小号放两节挤不下时收紧。
    var lineSpacing: CGFloat = 3
    /// 这节课是今天的：正在上时在时间下面画一条实时进度。
    var showsProgress = false
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetStyle) private var style

    var body: some View {
        if style == .board {
            StationCourseTicket(course: course, titleSize: titleLines == 1 ? 13 : size.title, titleLines: titleLines, showsProgress: showsProgress)
        } else {
            let appearance = ScheduleWidgetStylePalette(style: style, dark: colorScheme == .dark)
            // 色条跟着文字一样高，不拉到底。
            HStack(alignment: .top, spacing: 9) {
                RoundedRectangle(cornerRadius: style == .minimal ? 3 : appearance.courseRadius, style: .continuous)
                    .fill(widgetColors.accent(for: course, theme: theme, colorScheme: colorScheme))
                    .frame(width: 5)
                    .frame(maxHeight: .infinity)
                VStack(alignment: .leading, spacing: lineSpacing) {
                    if let primary = options.primaryValue(for: course) {
                        Text(primary)
                            .font(style.widgetFont(size: size.title, weight: .bold))
                            .foregroundStyle(widgetColors.primary)
                            .lineLimit(titleLines)
                            .minimumScaleFactor(0.76)
                    }
                    CourseMetadataLine(course: course, font: style.widgetFont(size: size.metadata), color: widgetColors.secondary)
                    if options.showTime {
                        Text(course.timeRange)
                            .font(style.widgetFont(size: size.time, weight: .semibold))
                            .foregroundStyle(widgetColors.primary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                    if showsProgress {
                        CourseProgressBar(course: course)
                            .padding(.top, 1)
                    }
                }
            }
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 0)
            .overlay {
                WidgetCourseRule(color: widgetColors.primary)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// 一节课在 `now` 那一天的起止时刻。没有具体时间的课没有。
private extension ScheduleCourse {
    func interval(onDayOf now: Date) -> ClosedRange<Date>? {
        guard let start = startMinutes, endMinutes > start else { return nil }
        let day = ChineseCalendarInfo.gregorian.startOfDay(for: now)
        return day.addingTimeInterval(TimeInterval(start * 60))...day.addingTimeInterval(TimeInterval(endMinutes * 60))
    }
}

/// 「距下课 23:10」「距上课 12:40」：正在上的课数到下课，快开始的课（一小时之内）数到上课。
/// 数字是系统驱动的实时计时，不用小组件刷新；时间线在上课前一小时有一条条目，倒计时从那时出现
///（`SchedulePayload.countdownLeadMinutes`）。只能用在今天的课上。
@available(iOS 17.0, *)
private struct CourseCountdownLabel: View {
    let course: ScheduleCourse
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetNow) private var now
    @Environment(\.scheduleWidgetStaticClock) private var staticClock
    @WidgetStyleColors private var widgetColors

    var body: some View {
        if options.showProgress, let target {
            let seconds = max(0, Int(target.date.timeIntervalSince(now)))
            HStack(spacing: 3) {
                Text(target.title)
                    .font(style.widgetFont(size: 10, weight: .medium))
                    .foregroundStyle(widgetColors.muted)
                // 实时计时的文字会把给它的宽度占满：垫一段同样长的隐藏文字定宽，数字靠右叠在上面。
                Text(seconds >= 36_000 ? "00:00:00" : (seconds >= 3600 ? "0:00:00" : "00:00"))
                    .hidden()
                    .overlay(alignment: .trailing) {
                        if staticClock {
                            Text(Self.clock(seconds))
                        } else {
                            Text(timerInterval: now...max(now, target.date), countsDown: true)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    .font(style.timeFont(size: 11, weight: .semibold, design: .rounded).monospacedDigit())
                    .foregroundStyle(widgetColors.accent(for: course, theme: theme, colorScheme: colorScheme))
                    .widgetAccentable()
            }
            .lineLimit(1)
            .fixedSize()
            .accessibilityElement(children: .combine)
        }
    }

    private var target: (title: String, date: Date)? {
        guard let interval = course.interval(onDayOf: now) else { return nil }
        if course.isInProgress(at: SchedulePayload.minutesSinceMidnight(now)) {
            return interval.upperBound > now ? ("距下课", interval.upperBound) : nil
        }
        let lead = interval.lowerBound.timeIntervalSince(now)
        guard lead > 0, lead <= TimeInterval(SchedulePayload.countdownLeadMinutes * 60) else { return nil }
        return ("距上课", interval.lowerBound)
    }

    private static func clock(_ seconds: Int) -> String {
        let hours = seconds / 3600, minutes = seconds % 3600 / 60, rest = seconds % 60
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, rest) : String(format: "%d:%02d", minutes, rest)
    }
}

/// 正在上的这节课上到哪了：一条细进度，由系统实时推进，不用小组件刷新。
/// 没在上课、没有具体时间或关了「上课倒计时与进度」时什么都不画。只能用在今天的课上。
@available(iOS 17.0, *)
private struct CourseProgressBar: View {
    let course: ScheduleCourse
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetNow) private var now
    @Environment(\.scheduleWidgetStaticClock) private var staticClock
    @WidgetStyleColors private var widgetColors

    var body: some View {
        if options.showProgress, let interval = course.interval(onDayOf: now),
           course.isInProgress(at: SchedulePayload.minutesSinceMidnight(now)) {
            let tint = widgetColors.accent(for: course, theme: theme, colorScheme: colorScheme)
            Group {
                if staticClock {
                    // 画廊出图用的渲染器画不了系统的进度条，照着它的样子画一条。
                    let total = interval.upperBound.timeIntervalSince(interval.lowerBound)
                    let fraction = min(max(now.timeIntervalSince(interval.lowerBound) / total, 0), 1)
                    Capsule().fill(widgetColors.muted.opacity(0.25))
                        .overlay(alignment: .leading) {
                            GeometryReader { proxy in
                                Capsule().fill(tint).frame(width: max(4, proxy.size.width * fraction))
                            }
                        }
                } else {
                    ProgressView(timerInterval: interval, countsDown: false) {
                        EmptyView()
                    } currentValueLabel: {
                        // 默认会在进度条下面再画一个时钟。
                        EmptyView()
                    }
                    .progressViewStyle(.linear)
                    .tint(tint)
                }
            }
            .frame(height: 4)
            .widgetAccentable()
            .accessibilityLabel("本节课程进度")
        }
    }
}

@available(iOS 17.0, *)
private struct CompactNextCourse: View {
    @WidgetStyleColors private var widgetColors
    let course: ScheduleCourse
    /// 正在上：时间用强调色。
    var inProgress = false
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetStyle) private var style

    var body: some View {
        if style == .board {
            StationCourseTicket(course: course, titleSize: 12, titleLines: 1, compact: true)
        } else {
            let appearance = ScheduleWidgetStylePalette(style: style, dark: colorScheme == .dark)
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: style == .minimal ? 3 : appearance.courseRadius, style: .continuous)
                    .fill(widgetColors.accent(for: course, theme: theme, colorScheme: colorScheme))
                    .frame(width: 5, height: 27)
                    .widgetAccentable()
                VStack(alignment: .leading, spacing: 1) {
                    if let primary = options.primaryValue(for: course) {
                        Text(primary)
                            .font(style.widgetFont(size: 12, weight: .bold))
                            .foregroundStyle(widgetColors.primary)
                            .lineLimit(1)
                    }
                    if options.showTime {
                        Text(course.timeRange)
                            .font(style.timeFont(size: 9, weight: inProgress ? .semibold : .regular))
                            .foregroundStyle(inProgress ? widgetColors.accent(for: course, theme: theme, colorScheme: colorScheme) : widgetColors.secondary)
                            .lineLimit(1)
                    }
                }
            }
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 0)
            .overlay {
                WidgetCourseRule(color: widgetColors.primary)
            }
        }
    }
}

@available(iOS 17.0, *)
private struct TodayScheduleView: View {
    let payload: SchedulePayload
    @Environment(\.scheduleWidgetFamily) private var family
    @Environment(\.scheduleWidgetConfiguration) private var configuration
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetNotice) private var notice
    @Environment(\.scheduleWidgetNow) private var now

    var body: some View {
        let today = payload.currentDay(now: now)
        let nowMinutes = today.date == SchedulePayload.dateString(now)
            ? SchedulePayload.minutesSinceMidnight(now)
            : nil
        let finished = payload.remainingCourses(in: today, now: now).isEmpty
        // 今天上完了（或本来没课）：「接着显示下一次课」换成那一天的课，日期栏照旧是今天、课程上方标出是哪天；
        // 「只看今天」把上完的课灰着留在原处。都没有可列的课才显示休息状态。
        let next = finished && configuration.afterClass == .nextCourseDay
            ? payload.nextCourseDay(after: now)
            : nil
        // 「隐藏已上完的课」时「只看今天」也没有课可留了，和没课一样显示休息状态。
        let rests = today.courseList.isEmpty || (finished && (configuration.afterClass == .nextCourseDay || options.hideCompleted))
        // 大号上今天的课少、底下空着一截时，接着预告下一次课（选了「只看今天」就不预告）。
        let preview = family == .systemLarge && !rests && configuration.afterClass == .nextCourseDay
            ? payload.nextCourseDay(after: now)?.day
            : nil
        Group {
            if let next {
                courseList(day: next.day, nowMinutes: nil, otherDay: true, headerDay: today)
            } else if rests {
                // 休息状态不参与下面按行数挑排法；假期和临近课程一样贴着底边放。
                VStack(alignment: .leading, spacing: 0) {
                    // 休息状态自己会大字写这段假期；寒暑假、课表过期时日期栏照旧带着倒计时。
                    WidgetDateHeader(day: today, hidesCountdown: notice == nil, tableName: payload.title)
                    // 寒暑假、课表过期：大号把「寒假ing」「打开 App 更新课表」摆在中间；中号交给 RestStateView。
                    if family == .systemLarge, let notice {
                        ScheduleNoticeGreetingView(notice: notice)
                    // 大号放假当天和两日课表一样：图标、祝福和假期进度占住中间，不再只有底下一小段。
                    } else if family == .systemLarge, today.courseList.isEmpty,
                       let greeting = ChineseCalendarInfo.restGreeting(for: now) {
                        HolidayGreetingView(greeting: greeting)
                    } else {
                        Spacer(minLength: 8)
                        RestStateView(hadCourses: !today.courseList.isEmpty)
                    }
                }
                .frame(maxHeight: .infinity)
            } else {
                courseList(day: today, nowMinutes: nowMinutes, preview: preview)
            }
        }
        // 大号的课排不满时，系统默认把整块内容竖着居中，日期栏就飘在半空；贴顶放。
        .frame(maxHeight: family == .systemLarge ? .infinity : nil, alignment: .top)
    }

    private var spacing: CGFloat { family == .systemLarge ? 8 : 7 }
    /// 时间线只在大号上有：中号只放两门课，排不出时间线。
    private var usesTimeline: Bool { family == .systemLarge && configuration.layout == .timeline }

    /// `otherDay`：换到了最近有课的另一天，日期栏照旧是今天（`headerDay`），课程上方挂「明天 周二」。课程不压暗：压暗是「已经上完」。
    @ViewBuilder
    private func courseList(
        day: ScheduleDay,
        nowMinutes: Int?,
        otherDay: Bool = false,
        headerDay: ScheduleDay? = nil,
        preview: ScheduleDay? = nil
    ) -> some View {
        let maxLimit = family == .systemLarge ? 7 : 2
        if family == .systemLarge {
            // 大号写死 7 行放不下，多出来的课会被悄悄截掉。从多到少试，挑第一个放得下的，
            // 这样「后面还有几门」才数得准。列表在同样门数下先试课名两行，课少时不用把长课名截掉。
            let lineOptions = usesTimeline ? [1] : [2, 1]
            let listed = day.courseList.count - (options.hideCompleted ? day.completedPrefixCount(nowMinutes: nowMinutes) : 0)
            // 今天要列的课都放得下、底下还有地方时，接着预告下一次课，能放几门放几门。
            // 时间线会把课拉高铺满，三门以上本来就不空，只在一两门课时预告。
            // 连一门都放不下时退成一行：标注后面跟着第一门课（`NextDayPreview.summaryOnly`）。
            let previewRows: [Int] = preview != nil && listed <= (usesTimeline ? 2 : maxLimit) ? [3, 2, 1, NextDayPreview.summaryOnly] : []
            let variants = previewRows.flatMap { rows in lineOptions.map { [max(listed, 1), $0, rows] } }
                + stride(from: maxLimit, through: 1, by: -1).flatMap { limit in lineOptions.map { [limit, $0, 0] } }
            ViewThatFits(in: .vertical) {
                ForEach(variants, id: \.self) { variant in
                    courses(today: day, nowMinutes: nowMinutes, limit: variant[0], titleLines: variant[1], otherDay: otherDay, headerDay: headerDay,
                            preview: variant[2] != 0 ? preview : nil, previewRows: variant[2])
                }
            }
        } else {
            // 中号固定两门，提示跟在下面。两门课加日期栏已经快把高度用满了：放不下时
            // 先收日期栏和第一门课之间的距离（最宽 12，不低于 5），再把两门课之间的间隔
            // 一档档收，但不低于 4，再挤就粘在一起了；提示和上面那门课之间的距离不动。
            // 还放不下（小屏手机）才把提示贴到右下角，往下探进系统留的边距里。
            // 别的日子多一条标注：上方间距统一收紧，标注仍与下面的课程成组。
            let window = day.courseWindow(limit: maxLimit, nowMinutes: nowMinutes, hidesCompleted: options.hideCompleted)
            let gaps: [(header: CGFloat, banner: CGFloat, row: CGFloat)] = otherDay
                ? [(12, 6, 7), (10, 6, 7), (9, 5, 6), (8, 4, 6), (7, 4, 5), (6, 4, 4)]
                : [(12, 0, 7), (10, 0, 7), (8, 0, 7), (5, 0, 7), (5, 0, 6), (5, 0, 5), (5, 0, 4)]
            let tightest = gaps[gaps.count - 1]
            ViewThatFits(in: .vertical) {
                ForEach(Array(gaps.enumerated()), id: \.offset) { _, gap in
                    courses(
                        today: day, nowMinutes: nowMinutes, limit: maxLimit,
                        headerGap: gap.header, bannerGap: gap.banner, rowSpacing: gap.row,
                        otherDay: otherDay, headerDay: headerDay
                    )
                }
                courses(
                    today: day, nowMinutes: nowMinutes, limit: maxLimit,
                    headerGap: tightest.header, bannerGap: tightest.banner, rowSpacing: max(tightest.row, 5),
                    showsRemaining: false, otherDay: otherDay, headerDay: headerDay
                )
                    .frame(maxHeight: .infinity, alignment: .top)
                    .overlay(alignment: .bottomTrailing) {
                        if window.remainingCount > 0 {
                            remainingText(window.remainingCount)
                                .offset(y: 8)
                        }
                    }
            }
        }
    }

    private func courses(
        today: ScheduleDay,
        nowMinutes: Int?,
        limit: Int,
        titleLines: Int = 1,
        headerGap: CGFloat = 14,
        bannerGap: CGFloat = 8,
        rowSpacing: CGFloat? = nil,
        showsRemaining: Bool = true,
        otherDay: Bool = false,
        headerDay: ScheduleDay? = nil,
        preview: ScheduleDay? = nil,
        previewRows: Int = 0
    ) -> some View {
        let window = today.courseWindow(limit: limit, nowMinutes: nowMinutes, hidesCompleted: options.hideCompleted)
        return VStack(alignment: .leading, spacing: 0) {
            // 日期栏和第一门课拉开得比课与课之间松，不然日期像是第一门课的标题。
            WidgetDateHeader(day: headerDay ?? today, tableName: payload.title)
                // 大号的日期栏字大，本身就压得住，和第一门课之间不用拉那么开，省下的高度多放一门课。
                .padding(.bottom, otherDay ? OtherDay.headerSpacing : (family == .systemLarge ? headerGap - 3 : headerGap))
            if otherDay {
                OtherDayBanner(day: today)
                    .padding(.bottom, bannerGap)
            }
            if usesTimeline {
                DayTimeline(courses: window.courses, nowMinutes: nowMinutes)
            } else {
                VStack(alignment: .leading, spacing: rowSpacing ?? spacing) {
                    ForEach(Array(window.courses.enumerated()), id: \.offset) { _, course in
                        TodayCourseRow(
                            course: course,
                            large: family == .systemLarge,
                            timeOnSeparateLine: false,
                            completed: nowMinutes.map { course.hasEnded(at: $0) } ?? false,
                            inProgress: nowMinutes.map { course.isInProgress(at: $0) } ?? false,
                            verticalPadding: family == .systemLarge ? nil : 3,
                            maxTitleLines: titleLines
                        )
                    }
                }
            }
            if showsRemaining && window.remainingCount > 0 {
                // 和上面那门课拉开一点，不然像是那门课的附注。
                remainingText(window.remainingCount)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.top, family == .systemLarge ? 10 : 8)
            }
            if let preview, previewRows != 0 {
                NextDayPreview(day: preview, rows: previewRows)
                    .padding(.top, previewRows == NextDayPreview.summaryOnly ? 12 : 16)
            }
        }
        // 时间线要把剩下的高度吃满，不能按理想高度钉死；ViewThatFits 量的仍是理想高度，挑行数不受影响。
        .fixedSize(horizontal: false, vertical: !usesTimeline)
    }

    /// 没显示的都排在最后一行之后（已经上完的才会被省在前面），所以说「后面」。
    private func remainingText(_ count: Int) -> some View {
        RemainingCoursesText(count: count)
    }
}

@available(iOS 17.0, *)
private struct TodayCourseRow: View {
    @WidgetStyleColors private var widgetColors
    let course: ScheduleCourse
    let large: Bool
    let timeOnSeparateLine: Bool
    let completed: Bool
    /// 现在正在上：课程信息下面带一条实时进度。
    var inProgress = false
    /// 整块只有半宽的列（两日课表的每一列）：课名、教室和时间三行挤在窄列里，
    /// 字号各收一号、行距和上下留白放宽，才不会糊成一团。
    var compact = false
    /// 色块上下的留白；中号今日课表要挤出两门课之间的间隔，会传得小一点。
    var verticalPadding: CGFloat? = nil
    /// 课名最多几行。不给就按尺寸：大号时间另起一行时两行，其余一行。
    var maxTitleLines: Int? = nil
    @Environment(\.scheduleWidgetFamily) private var family
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetStyle) private var style

    private var titleSize: CGFloat {
        if compact { return 13 }
        return family == .systemLarge ? (large ? 16 : 14) : 12
    }
    private var metadataSize: CGFloat { compact ? 10 : (family == .systemLarge ? (large ? 12 : 11) : 9) }
    /// 三行之间的间距。半宽列里课名、教室和时间贴在一起最难看，留宽一点。
    private var lineSpacing: CGFloat { compact ? 3 : 2 }
    /// 课名一律一行：大号整宽、两日课表半宽都一样，折行的课名在窄列里挤成一坨，
    /// 截断比折行好看，也更省高度。`maxTitleLines` 留给以后真需要多行的画面。
    private var titleLines: Int { maxTitleLines ?? 1 }

    var body: some View {
        if style == .board {
            // 票券样式的 `compact` 会把「教室 · 老师」整行去掉，两日课表只是列窄，
            // 内容照旧要全：只把字号传小一号。
            StationCourseTicket(course: course, titleSize: titleSize, titleLines: titleLines, horizontal: !timeOnSeparateLine, showsProgress: inProgress)
                .opacity(completed ? 0.56 : 1)
        } else {
            let appearance = ScheduleWidgetStylePalette(style: style, dark: colorScheme == .dark)
            HStack(spacing: large ? 9 : 6) {
                let barHeight: CGFloat = compact ? 36 : (large ? 40 : (timeOnSeparateLine ? 39 : 29))
                RoundedRectangle(cornerRadius: style == .minimal ? 3 : appearance.courseRadius, style: .continuous)
                    .fill(widgetColors.accent(for: course, theme: theme, colorScheme: colorScheme))
                    .frame(width: compact ? 4 : 5)
                    // 课名可以折行时色条跟着文字长高（外面按理想高度钉住），否则固定高度。
                    .frame(minHeight: barHeight, maxHeight: titleLines > 1 || showsProgress ? .infinity : barHeight)
                VStack(alignment: .leading, spacing: lineSpacing) {
                    if let primary = options.primaryValue(for: course) {
                        Text(primary)
                            .font(style.widgetFont(size: titleSize, weight: .bold))
                            .foregroundStyle(widgetColors.primary)
                            .lineLimit(titleLines)
                    }
                    CourseMetadataLine(course: course, font: style.widgetFont(size: metadataSize, weight: .medium), color: widgetColors.secondary)
                    if timeOnSeparateLine && options.showTime {
                        timeLabel
                    }
                    if inProgress {
                        CourseProgressBar(course: course)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if !timeOnSeparateLine && options.showTime {
                    Spacer(minLength: 5)
                    timeLabel
                }
            }
            .padding(.horizontal, large ? 9 : 7)
            .padding(.vertical, verticalPadding ?? (large ? 6 : 4))
            .background {
                RoundedRectangle(cornerRadius: style == .minimal ? (large ? 11 : 8) : appearance.courseRadius, style: .continuous)
                    .fill(
                        renderingMode == .fullColor
                            ? (style == .minimal
                                ? widgetColors.tint(for: course, colorScheme: colorScheme, theme: theme)
                                : widgetColors.accent(for: course, theme: theme, colorScheme: colorScheme).opacity(appearance.courseFillOpacity))
                            : Color.white
                    )
                    // Clear and tinted Home Screen appearances render widgets in
                    // accented mode and remap opaque colors to solid white.
                    .opacity(renderingMode == .fullColor ? 1 : 0.14)
            }
            .overlay {
                WidgetCourseRule(color: widgetColors.primary)
            }
            .fixedSize(horizontal: false, vertical: titleLines > 1 || showsProgress)
            .saturation(completed ? 0 : 1)
            .opacity(completed ? 0.56 : 1)
        }
    }

    /// 进度条多占一行：色条跟着长高，整行按实际高度占位。
    private var showsProgress: Bool { inProgress && options.showProgress }

    private var timeLabel: some View {
        Text(course.timeRange)
            .font(style.widgetFont(size: metadataSize, weight: .semibold))
            .foregroundStyle(widgetColors.primary)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
    }
}

/// 大号今日课表课少的日子，今天的课下面接着预告下一次课：「明天 周四」的标注，下面是那天开头的几门。
/// 字比今天的课小一号，看得出主次。只剩一行的地方时不列课，标注后面写第一门课和一共几门。
@available(iOS 17.0, *)
private struct NextDayPreview: View {
    /// `rows` 取这个值：只有一行，不列课。
    static let summaryOnly = -1

    let day: ScheduleDay
    let rows: Int
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @WidgetStyleColors private var widgetColors

    var body: some View {
        let shown = Array(day.courseList.prefix(max(rows, 0)))
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                OtherDayBanner(day: day)
                Spacer(minLength: 0)
                if rows == Self.summaryOnly {
                    Text(summary)
                        .font(style.widgetFont(size: 11, weight: .medium))
                        .foregroundStyle(widgetColors.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                } else if day.courseList.count > shown.count {
                    RemainingCoursesText(count: day.courseList.count - shown.count)
                }
            }
            ForEach(Array(shown.enumerated()), id: \.offset) { _, course in
                TodayCourseRow(course: course, large: false, timeOnSeparateLine: false, completed: false, verticalPadding: 4)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    /// 「08:00 药物设计学 等 2 门」。
    private var summary: String {
        guard let first = day.courseList.first else { return "" }
        let lead = [options.showTime ? first.startLabel : nil, options.primaryValue(for: first)]
            .compactMap { $0 }
            .joined(separator: " ")
        return day.courseList.count > 1 ? "\(lead) 等 \(day.courseList.count) 门" : lead
    }
}

/// 时间线：左边一列起止时间，课程卡片和课间按时长分高度，把给它的高度用满。
/// 课少的日子不再是三张卡片堆在顶上、下面空一半；课多时退回每门课最矮的样子，照旧一门挨一门。
/// 大号今日课表用整宽的；两日课表每列只有半宽，用 `compact` 的小一号。
@available(iOS 17.0, *)
private struct DayTimeline: View {
    let courses: [ScheduleCourse]
    let nowMinutes: Int?
    var compact = false
    @Environment(\.scheduleWidgetDisplayOptions) private var options

    /// 课间短于这个就只留一道缝，不写「休息」。
    private static let labeledGap = 30

    var body: some View {
        let metrics = TimelineMetrics(compact: compact)
        ProportionalStack {
            ForEach(Array(courses.enumerated()), id: \.offset) { index, course in
                if index > 0 {
                    let gap = Self.gapMinutes(from: courses[index - 1], to: course)
                    let labeled = gap >= Self.labeledGap && options.showBreaks
                    TimelineGap(
                        minutes: gap,
                        labeled: labeled,
                        showsTimeColumn: options.showTime,
                        isNow: nowMinutes.map { courses[index - 1].hasEnded(at: $0) && !course.hasEnded(at: $0) && !course.isInProgress(at: $0) } ?? false,
                        metrics: metrics
                    )
                    // 课间按一半的比例长高：午休两个多小时不该比一门课还高。
                    .layoutValue(key: ProportionalWeight.self, value: CGFloat(gap) * 0.5)
                    .layoutValue(key: ProportionalMaxHeight.self, value: labeled ? metrics.labeledGapCap : 12)
                }
                TimelineCourseRow(
                    course: course,
                    completed: nowMinutes.map { course.hasEnded(at: $0) } ?? false,
                    inProgress: nowMinutes.map { course.isInProgress(at: $0) } ?? false,
                    metrics: metrics
                )
                .layoutValue(key: ProportionalWeight.self, value: CGFloat(Self.duration(of: course)))
                // 一天只有一两门课时卡片别撑成一整面墙。
                .layoutValue(key: ProportionalMaxHeight.self, value: metrics.cardCap)
            }
        }
    }

    private static func duration(of course: ScheduleCourse) -> Int {
        guard let start = course.startMinutes else { return 45 }
        return max(course.endMinutes - start, 20)
    }

    private static func gapMinutes(from previous: ScheduleCourse, to next: ScheduleCourse) -> Int {
        guard let start = next.startMinutes, previous.endMinutes > 0 else { return 0 }
        return max(start - previous.endMinutes, 0)
    }
}

/// 时间线的尺寸。`compact` 是两日课表半宽的列：时间列、字号、边距都收一号，课名才留得下地方。
@available(iOS 17.0, *)
private struct TimelineMetrics {
    let timeColumn: CGFloat
    let columnSpacing: CGFloat
    let cardPadding: CGFloat
    let barSpacing: CGFloat
    let startFont: CGFloat
    let endFont: CGFloat
    let titleFont: CGFloat
    let metaFont: CGFloat
    let gapFont: CGFloat
    let cornerRadius: CGFloat
    let cardCap: CGFloat
    let labeledGapCap: CGFloat

    let compact: Bool

    init(compact: Bool) {
        self.compact = compact
        // 半宽的列里课名一行只放得下五个字左右：时间列、边距都再收一点让给课名。
        timeColumn = compact ? 31 : 44
        columnSpacing = compact ? 4 : 8
        cardPadding = compact ? 6 : 9
        barSpacing = compact ? 5 : 9
        startFont = compact ? 11 : 14
        endFont = compact ? 9 : 11
        titleFont = compact ? 13 : 16
        metaFont = compact ? 11 : 12
        gapFont = compact ? 9 : 10
        cornerRadius = compact ? 9 : 11
        cardCap = compact ? 96 : 108
        labeledGapCap = compact ? 36 : 44
    }

    /// 卡片左边色条中线离卡片左边的距离，课间的虚线对着它。
    var barCenter: CGFloat { cardPadding + 2.5 }
}

@available(iOS 17.0, *)
private struct TimelineCourseRow: View {
    @WidgetStyleColors private var widgetColors
    let course: ScheduleCourse
    let completed: Bool
    let inProgress: Bool
    let metrics: TimelineMetrics
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetStyle) private var style

    var body: some View {
        let appearance = ScheduleWidgetStylePalette(style: style, dark: colorScheme == .dark)
        let accent = widgetColors.accent(for: course, theme: theme, colorScheme: colorScheme)
        HStack(alignment: .top, spacing: metrics.columnSpacing) {
            if options.showTime {
                // 开始时间对着卡片顶，结束时间对着卡片底：卡片被拉高时，一眼看得出这门课有多长。
                VStack(alignment: .trailing, spacing: 0) {
                    Text(course.startLabel)
                        .font(style.timeFont(size: metrics.startFont, weight: .bold))
                        .foregroundStyle(inProgress ? accent : widgetColors.primary)
                    Spacer(minLength: 2)
                    if let end = endLabel {
                        Text(end)
                            .font(style.timeFont(size: metrics.endFont, weight: .medium))
                            .foregroundStyle(widgetColors.secondary)
                    }
                }
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.vertical, 2)
                .frame(width: metrics.timeColumn, alignment: .trailing)
                .frame(maxHeight: .infinity)
            }
            HStack(alignment: .top, spacing: metrics.barSpacing) {
                if style == .board {
                    VStack(spacing: 3) {
                        Circle().strokeBorder(accent, lineWidth: 1.5).frame(width: 7, height: 7)
                        Rectangle().fill(accent.opacity(0.3)).frame(width: 1)
                    }
                    .frame(width: 7)
                    .accessibilityHidden(true)
                } else {
                    RoundedRectangle(cornerRadius: style == .minimal ? 2.5 : appearance.courseRadius, style: .continuous)
                        .fill(accent)
                        .frame(width: 5)
                        .frame(maxHeight: .infinity)
                }
                // 教室贴着卡片底边（和左边的下课时间对齐），课名、老师照旧在上面，卡片拉高时中间空出来。
                // 课多挤成最矮、放不下三行时退回原来的两行：课名，下面「教室 · 老师」。
                // 两日课表的列窄，一行只有五六个字：高度够时课名先放到三行。最后一种最矮，量尺寸按它。
                VStack(alignment: .leading, spacing: 4) {
                    FirstThatFitsVertically {
                        if let room {
                            ForEach(titleLineOptions, id: \.self) { lines in
                                VStack(alignment: .leading, spacing: 2) {
                                    titleText(lines: lines)
                                    if let teacher { metaText(teacher) }
                                    Spacer(minLength: 2)
                                    metaText(room)
                                }
                            }
                        }
                        ForEach(titleLineOptions, id: \.self) { lines in
                            VStack(alignment: .leading, spacing: 2) {
                                titleText(lines: lines)
                                CourseMetadataLine(course: course, font: style.widgetFont(size: metrics.metaFont, weight: .medium), color: widgetColors.secondary)
                            }
                        }
                    }
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    // 正在上的这门课：卡片底边一条实时进度，和左边的起止时间一起看得出上到哪了。
                    if inProgress {
                        CourseProgressBar(course: course)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .padding(.horizontal, metrics.cardPadding)
            .padding(.vertical, 5)
            .frame(maxHeight: .infinity, alignment: .top)
            .background {
                if style == .board {
                    StationTicketShape()
                        .fill(widgetColors.primary.opacity(colorScheme == .dark ? 0.035 : 0.02))
                        .overlay {
                            StationTicketShape().stroke(widgetColors.muted.opacity(0.3), lineWidth: 0.5)
                        }
                } else {
                    RoundedRectangle(cornerRadius: style == .minimal ? metrics.cornerRadius : appearance.courseRadius, style: .continuous)
                        .fill(
                            renderingMode == .fullColor
                                ? (style == .minimal
                                    ? widgetColors.tint(for: course, colorScheme: colorScheme, theme: theme)
                                    : accent.opacity(appearance.courseFillOpacity))
                                : Color.white
                        )
                        .opacity(renderingMode == .fullColor ? 1 : 0.14)
                }
            }
            .overlay(alignment: .bottom) {
                if style == .board {
                    StationPerforation()
                        .stroke(widgetColors.muted.opacity(0.35), style: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
                        .frame(height: 1)
                        .padding(.horizontal, 5)
                } else {
                    WidgetCourseRule(color: widgetColors.primary)
                }
            }
        }
        .saturation(completed ? 0 : 1)
        .opacity(completed ? 0.56 : 1)
    }

    /// 课名一律一行：折行的课名在窄列里挤成一坨，截断比折行好看，也更省高度。
    private var titleLineOptions: [Int] { [1] }

    @ViewBuilder
    private func titleText(lines: Int) -> some View {
        if let primary = options.primaryValue(for: course) {
            Text(primary)
                .font(style.widgetFont(size: metrics.titleFont,
                                       weight: style == .board ? .medium : .bold))
                .foregroundStyle(widgetColors.primary)
                .lineLimit(lines)
        }
    }

    private func metaText(_ value: String) -> some View {
        Text(value)
            .font(style.widgetFont(size: metrics.metaFont, weight: .medium))
            .foregroundStyle(widgetColors.secondary)
    }

    /// 放在左下角的教室。关了课程名时教室已经顶上去当标题了，不再写一遍。
    private var room: String? {
        options.showCourseName && options.showRoom ? course.normalizedLocation : nil
    }

    /// 课名下面的老师。课程名、教室都关了时老师自己就是标题。
    private var teacher: String? {
        options.showTeacher && (options.showCourseName || options.showRoom) ? course.normalizedTeacher : nil
    }

    private var endLabel: String? {
        guard course.startMinutes != nil, course.timeRange.contains(" - ") else { return nil }
        return course.timeRange.components(separatedBy: " - ").last
    }
}

/// 两门课之间：一道对着色条的虚线，长的课间在旁边写上歇多久。
@available(iOS 17.0, *)
private struct TimelineGap: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    let minutes: Int
    let labeled: Bool
    let showsTimeColumn: Bool
    /// 现在正好在这段课间里。
    let isNow: Bool
    let metrics: TimelineMetrics
    @Environment(\.scheduleWidgetTheme) private var theme

    var body: some View {
        HStack(spacing: 0) {
            if showsTimeColumn {
                Color.clear.frame(width: metrics.timeColumn + metrics.columnSpacing)
            }
            if labeled {
                HStack(spacing: metrics.barSpacing - 1) {
                    DashedLine()
                        .stroke(style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [0.1, 4]))
                        .foregroundStyle(widgetColors.muted)
                        .frame(width: 2)
                        .padding(.leading, metrics.barCenter - 1)
                    Text(isNow ? "休息中 · \(Self.duration(minutes))" : "休息 \(Self.duration(minutes))")
                        .font(style.widgetFont(size: metrics.gapFont, weight: .semibold))
                        .foregroundStyle(isNow ? widgetColors.accent(for: theme) : widgetColors.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .padding(.vertical, 5)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 6, maxHeight: .infinity, alignment: .leading)
    }

    static func duration(_ minutes: Int) -> String {
        let hours = minutes / 60
        let rest = minutes % 60
        if hours == 0 { return "\(rest) 分钟" }
        return rest == 0 ? "\(hours) 小时" : "\(hours) 小时 \(rest) 分"
    }
}

@available(iOS 17.0, *)
private struct DashedLine: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.midX, y: rect.minY + 3))
            path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY - 3))
        }
    }
}

@available(iOS 17.0, *)
private struct TwoDayScheduleView: View {
    let payload: SchedulePayload
    /// 超大号：两列各有一个大号那么宽，日期栏和课程都用整宽的排法。
    var wide = false
    @Environment(\.scheduleWidgetConfiguration) private var configuration
    @Environment(\.scheduleWidgetNotice) private var notice
    @Environment(\.scheduleWidgetNow) private var now

    var body: some View {
        if let notice {
            // 寒暑假、课表过期：两列都没有课可列，整块只放今天的日期和中间的「寒假ing」。
            VStack(alignment: .leading, spacing: 0) {
                WidgetDateHeader(day: payload.currentDay(now: now), tableName: payload.title)
                ScheduleNoticeGreetingView(notice: notice)
            }
            .frame(maxHeight: .infinity, alignment: .top)
        } else {
            columns
        }
    }

    private var columns: some View {
        let selection = TwoDaySelection(payload: payload, now: now, start: configuration.twoDayStart)
        let today = selection.today
        let right = selection.right

        // 右边不是明天时标上「后天的课」「10/2 的课」。左边占着同样一行但不显示，两列的课才对得齐。
        let rightHint = selection.rightOffset > 1 ? OtherDay.hint(for: right, now: now) : nil
        // 两天同一周，「第 N 周」只在右边写一次：靠着组件右上角，读起来是整块的标题。
        let sameWeek = today.week != nil && today.week == right.week
        let leftHeader = WidgetDateHeader(
            day: today, compact: !wide, hidesCountdown: true, tableName: payload.title, dayHint: rightHint, hidesDayHint: true,
            hidesWeek: sameWeek
        )
        let rightHeader = WidgetDateHeader(
            day: right, compact: !wide, countdownDay: today, tableName: payload.title, hidesTableName: true, dayHint: rightHint
        )
        return HStack(alignment: .top, spacing: wide ? 18 : 13) {
            DayColumn(
                day: today,
                nowMinutes: SchedulePayload.minutesSinceMidnight(now),
                isToday: true,
                timeline: configuration.layout == .timeline,
                wide: wide,
                header: leftHeader,
                companionHeader: rightHeader
            )
            Divider()
            DayColumn(
                day: right,
                nowMinutes: nil,
                timeline: configuration.layout == .timeline,
                wide: wide,
                header: rightHeader,
                companionHeader: leftHeader
            )
        }
    }
}

@available(iOS 17.0, *)
private struct DayColumn: View {
    let day: ScheduleDay
    let nowMinutes: Int?
    /// 明天那一列没课就照常说「没有课程」，祝福只属于今天。
    var isToday = false
    /// 用半宽的时间线排课，不然是一门课一张卡片的列表。
    var timeline = false
    /// 超大号的列：和大号小组件一样宽，课程用整宽的卡片。
    var wide = false
    let header: WidgetDateHeader
    /// 旁边那一列的日期栏，藏在自己的下面占位：只有一边有调休、节日时两边一样高，
    /// 两列的第一节课才对得齐。
    let companionHeader: WidgetDateHeader
    @Environment(\.scheduleWidgetNow) private var now
    @Environment(\.scheduleWidgetDisplayOptions) private var options

    /// 一列最多试着放几门。再多半宽的列也放不下，剩下的写进「后面还有 N 门课」。
    private static let maxLimit = 8

    /// 这一列要列的课有几门：「隐藏已上完的课」时不算今天开头已经上完的。
    private var listedCount: Int {
        day.courseList.count - (options.hideCompleted ? day.completedPrefixCount(nowMinutes: nowMinutes) : 0)
    }

    var body: some View {
        if listedCount == 0 {
            column(limit: 0)
        } else {
            // 以前写死 5 门，多出来的课会被悄悄截掉。和今日课表一样从多到少试，挑第一个放得下的，
            // 「后面还有几门」才数得准。
            ViewThatFits(in: .vertical) {
                ForEach(Array(stride(from: min(listedCount, Self.maxLimit), through: 1, by: -1)), id: \.self) { limit in
                    column(limit: limit)
                }
            }
        }
    }

    private func column(limit: Int) -> some View {
        let window = day.courseWindow(limit: limit, nowMinutes: nowMinutes, hidesCompleted: options.hideCompleted)
        let empty = listedCount == 0
        return VStack(alignment: .leading, spacing: 9) {
            ZStack(alignment: .topLeading) {
                companionHeader.hidden()
                header
            }
                // 日期栏和下面的课拉开到 20（加上外面 VStack 的 9），比课与课之间松。
                .padding(.bottom, 11)
            if empty {
                // 这天没有课：今天那列说「今日无课」，今天是法定假日就换成带图标和假期进度的祝福，
                // 整列不再只有一行灰字。有课但都上完、又选了隐藏，就说「今日课程已结束」。
                if isToday, day.courseList.isEmpty, let greeting = ChineseCalendarInfo.restGreeting(for: now) {
                    HolidayGreetingView(greeting: greeting)
                } else {
                    EmptyCoursesView(
                        message: !day.courseList.isEmpty ? "今日课程已结束" : (isToday ? RestState.message(now: now) : "没有课程")
                    )
                }
            } else {
                Group {
                    if timeline {
                        DayTimeline(courses: window.courses, nowMinutes: nowMinutes, compact: !wide)
                    } else {
                        ForEach(Array(window.courses.enumerated()), id: \.offset) { _, course in
                            TodayCourseRow(
                                course: course,
                                large: wide,
                                timeOnSeparateLine: !wide,
                                completed: nowMinutes.map { course.hasEnded(at: $0) } ?? false,
                                inProgress: nowMinutes.map { course.isInProgress(at: $0) } ?? false,
                                compact: !wide,
                                verticalPadding: wide ? nil : 6,
                                // 半宽列里课名只写一行：折行会把卡片撑成一坨，截断的课名
                                // 也没关系，点开 App 能看到全称。
                                maxTitleLines: 1
                            )
                        }
                    }
                }
                if window.remainingCount > 0 {
                    RemainingCoursesText(count: window.remainingCount)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.top, 3)
                }
            }
        }
        // 时间线要往下铺满整列；列表照旧按内容高度贴顶。ViewThatFits 量的是理想高度，挑行数不受影响。
        .fixedSize(horizontal: false, vertical: !timeline && !empty)
        .frame(maxWidth: .infinity, maxHeight: timeline ? .infinity : nil, alignment: .topLeading)
    }
}

/// 「后面还有 N 门课」。没显示的都排在最后一行之后（已经上完的才会被省在前面），所以说「后面」。
@available(iOS 17.0, *)
private struct RemainingCoursesText: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    let count: Int

    var body: some View {
        Text("后面还有 \(count) 门课")
            .font(style.widgetFont(size: 9, weight: .medium))
            .foregroundStyle(widgetColors.muted)
            .lineLimit(1)
    }
}

@available(iOS 17.0, *)
private struct WidgetDateHeader: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    let day: ScheduleDay
    /// 两日课表的列只有半个组件宽，日期与假期倒计时使用紧凑排版。
    var compact = false
    /// 下面的休息状态已经在大字显示同一段假期时，日期栏就别重复倒计时了。
    var hidesCountdown = false
    var countdownDay: ScheduleDay? = nil
    /// 当前课表名，放在第二行最左边。两日课表只在今天那一列写一次。
    var tableName: String? = nil
    /// 课表名只占位不显示（两日课表明天那一列）。
    var hidesTableName = false
    /// 显示的不是今天的课时，第二行右边的标注：「明天的课」「10/2 的课」。
    var dayHint: String? = nil
    /// 标注只占位不显示（两日课表今天那一列，和旁边一列对齐）。
    var hidesDayHint = false
    /// 不写「第 N 周」：两日课表两天同一周时，只在右边那列写一次。
    var hidesWeek = false
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetFamily) private var family

    /// 大号整块都是今天的课，日期栏是全场的标题，字放大一号；两日课表虽然也是大号，
    /// 但每列只有半宽（`compact`），照旧用小字。
    private var isLarge: Bool { family == .systemLarge && !compact }
    /// 在默认字号上加多少。
    private var sizeBoost: CGFloat { isLarge ? 3 : 0 }
    /// 竖线和竖排字的高度，也就是左边日期数字的高度。
    private var columnHeight: CGFloat {
        if isLarge { return 35 }
        if compact { return 24 }
        return family == .systemMedium ? 30 : 27
    }

    /// 2×1 的日期栏有更充足的横向空间，字号比小号更醒目。
    private var dateFontSize: CGFloat {
        if isLarge { return 29 }
        // 两日课表的列只有半个组件宽，日期数字和下面的课名一样收一号才不显得头重。
        if compact { return 20 }
        return family == .systemMedium ? 24 : 22
    }

    var body: some View {
        // 「周五」「初八」各自竖排成一列，日期、星期、农历之间各一条竖线。
        let isCompact = compact || family == .systemSmall
        // 两行之间几乎不留空：竖线本身比字高，行距再拉开就散了。
        VStack(alignment: .leading, spacing: 0) {
            if style == .board {
                stationHeader
            } else {
                header(isCompact: isCompact, countdown: inlineCountdown)
            }
            secondaryLine(countdown: inlineCountdown == nil ? holidayCountdown : nil)
                // 竖线比字高，靠负边距把这行收回去，贴着上一行的文字底部。「明天的课」带着
                // 胶囊底色，比字高，再往上收就压住上一行的「第 N 周」，反过来留一点空。
                // 中号（2×1）的小组件里课表名紧跟在日期下方，额外留一点间隔更易读。
                // 两日课表（compact）的日期数字收小过，竖线探出来的部分也少了，-2 会让课表名
                // 顶到日期数字上；和别处一样往下让开。
                .padding(.top, dayHint == nil
                    ? (family == .systemLarge && !compact ? 4 : (family == .systemMedium ? 1 : (family == .systemSmall ? 3 : (compact ? 4 : -2))))
                    : 2)
        }
        // 第二行的 ViewThatFits 报的最小高度是最矮那种排法（倒计时不换行），外面的 VStack
        // 照这个预留，下面的课就会多分到一截、以为放得下，整块撑出组件。按实际高度占位。
        .fixedSize(horizontal: false, vertical: true)
    }

    private var stationHeader: some View {
        HStack(alignment: .center, spacing: 7) {
            Image(systemName: "tram.fill")
                .font(.system(size: isLarge ? 16 : 12, weight: .semibold))
                .foregroundStyle(widgetColors.accent(for: theme))
                .accessibilityHidden(true)
            Text(day.compactDate)
                .font(style.timeFont(size: isLarge ? 19 : 16, weight: .semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            VStack(alignment: .leading, spacing: 2) {
                Text(day.displayLabel)
                    .font(style.widgetFont(size: 10, weight: .semibold))
                if showsWeek, let week = day.week, week > 0 {
                    Text("第 \(week) 周")
                        .font(style.widgetFont(size: 8))
                        .foregroundStyle(widgetColors.secondary)
                }
            }
            .lineLimit(1)
            .fixedSize()
            Spacer(minLength: 0)
        }
        .foregroundStyle(widgetColors.primary)
        .padding(.bottom, 5)
        .overlay(alignment: .bottom) {
            Rectangle().fill(widgetColors.accent(for: theme).opacity(0.55)).frame(height: 1)
        }
    }

    private var showsWeek: Bool { !hidesWeek && options.showWeek }

    private var normalizedTableName: String? {
        let name = tableName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? nil : name
    }

    /// 中号、大号整宽的日期栏右边有的是地方：第二行没有课表名和跨日标注要写时，假期倒计时
    /// 收到「第 N 周」下面，不再单占一行，省下的高度留给课程。小号和两日课表的半宽列放不下，照旧在第二行。
    private var inlineCountdown: ChineseHolidayCountdown? {
        guard style != .board, !compact, family != .systemSmall,
              normalizedTableName == nil, dayHint == nil else { return nil }
        return holidayCountdown
    }

    /// 第二行保留课表归属、跨日标注和用户开启的假期倒计时。
    @ViewBuilder
    private func secondaryLine(countdown: ChineseHolidayCountdown?) -> some View {
        let name = normalizedTableName
        if name != nil || dayHint != nil || countdown != nil {
            ViewThatFits(in: .horizontal) {
                if dayHint == nil || hidesDayHint || countdown == nil {
                    secondaryRow(name: name, countdown: countdown)
                    if countdown != nil {
                        secondaryRow(name: name, countdown: countdown, truncatesName: true)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    secondaryRow(name: name, truncatesName: true)
                    if let countdown {
                        HolidayCountdownChip(countdown: countdown)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
            }
        }
    }

    private func secondaryRow(name: String?, countdown: ChineseHolidayCountdown? = nil, truncatesName: Bool = false) -> some View {
        HStack(spacing: 6) {
            if let name {
                Text(name)
                    .font(style.widgetFont(size: 9, weight: .semibold))
                    .foregroundStyle(widgetColors.muted)
                    .lineLimit(1)
                    .fixedSize(horizontal: !truncatesName, vertical: false)
                    // 截短时按四到六个字报理想宽度，ViewThatFits 才量得出和倒计时并不并得下；
                    // 真正排的时候照样把剩下的宽度都给它。
                    .frame(minWidth: 0, idealWidth: truncatesName ? (compact || family == .systemSmall ? 44 : 52) : nil, maxWidth: truncatesName ? .infinity : nil, alignment: .leading)
                    .opacity(hidesTableName ? 0 : 1)
            }
            Spacer(minLength: 4)
            if let dayHint, countdown == nil {
                OtherDayChip(title: dayHint)
                    .fixedSize()
                    .opacity(hidesDayHint ? 0 : 1)
            } else if let countdown {
                HolidayCountdownChip(countdown: countdown, sizeBoost: min(sizeBoost, 2))
                    .fixedSize()
            }
        }
    }

    private func header(isCompact: Bool, countdown: ChineseHolidayCountdown?) -> some View {
        let weekday = day.displayLabel.isEmpty ? nil : day.displayLabel
        // 小号一行要塞下日期、星期、农历和「第 N 周」，各列之间收紧一点。
        return HStack(spacing: isCompact ? 4 : (isLarge ? 8 : 6)) {
            // 小号里一行很挤，日期绝不能被压得折行，宁可让右边的周数让位。
            Text(day.dayOfMonthLabel)
                .font(style.widgetFont(size: dateFontSize, weight: .bold, design: .rounded))
                .foregroundStyle(widgetColors.primary)
                .lineLimit(1)
                .fixedSize()

            columnDivider

            if let weekday {
                verticalText(
                    weekday,
                    weight: .bold,
                    color: weekday == "周六" || weekday == "周日"
                        ? Color.pink
                        : widgetColors.accent(for: theme)
                )
            }

            if weekday != nil, stackedDetail != nil {
                columnDivider
            }

            if let detail = stackedDetail {
                verticalText(detail, weight: .medium, color: detailColor)
            }

            Spacer(minLength: 4)

            if !isCompact, let badge = badgeText {
                HolidayBadge(title: badge, highlighted: calendarDay?.isStatutoryHoliday ?? false)
            }

            if let countdown {
                // 周数在上、倒计时在下，两行靠右，合起来和左边的日期数字差不多高。
                VStack(alignment: .trailing, spacing: isLarge ? 3 : 1) {
                    if showsWeek, let week = day.week, week > 0 {
                        weekLabel("第 \(week) 周")
                    }
                    HolidayCountdownChip(countdown: countdown, sizeBoost: min(sizeBoost, 2))
                        .fixedSize()
                }
            } else if showsWeek, let week = day.week, week > 0 {
                // 放不下「第 N 周」先去掉空格、再缩字，都放不下才不显示；「第」不省，
                // 单写「5周」像是说五个星期。也别去挤左边的日期。
                VStack(alignment: isCompact ? .center : .trailing, spacing: 2) {
                    ViewThatFits(in: .horizontal) {
                        weekLabel("第 \(week) 周")
                        weekLabel("第\(week)周")
                        // 大号放大了字，挤不下先退回原来的字号，再往下缩。
                        if sizeBoost > 0 {
                            weekLabel("第 \(week) 周", size: 10)
                            weekLabel("第\(week)周", size: 10)
                        }
                        weekLabel("第\(week)周", size: 9)
                        weekLabel("第\(week)周", size: 8)
                        Color.clear.frame(width: 0, height: 0)
                    }
                    if isCompact, let badge = badgeText {
                        HolidayBadge(title: badge, highlighted: calendarDay?.isStatutoryHoliday ?? false)
                    }
                }
                // 小号与两日课表每列的右侧共用两行栏，周数和节日居中对齐。
                .frame(
                    minWidth: isCompact ? 48 : nil,
                    alignment: isCompact ? .center : .trailing
                )
                .offset(y: family == .systemSmall ? 4 : 0)
            } else if isCompact, let badge = badgeText {
                HolidayBadge(title: badge, highlighted: calendarDay?.isStatutoryHoliday ?? false)
                    .frame(minWidth: 48, alignment: .center)
                    .offset(y: family == .systemSmall ? 4 : 0)
            }
        }
    }

    /// 不给字号就是这个尺寸的默认字号（大号放大过）。
    private func weekLabel(_ text: String, size: CGFloat? = nil) -> some View {
        Text(text)
            .font(style.widgetFont(size: size ?? 10 + min(sizeBoost, 2), weight: .semibold))
            .foregroundStyle(widgetColors.secondary)
            .lineLimit(1)
            .fixedSize()
    }

    private var columnDivider: some View {
        Rectangle()
            .fill(widgetColors.muted.opacity(0.45))
            .frame(width: 1, height: columnHeight)
    }

    /// 一个字一行的竖排。两个字排完正好和左边的日期一样高；三个字的节日名
    /// （中秋节、国庆节）收一号字，免得把日期栏撑高。
    private func verticalText(_ value: String, weight: Font.Weight, color: Color) -> some View {
        let characters = Array(value)
        let size: CGFloat = (characters.count > 2 ? 8 : 10) + sizeBoost
        return VStack(spacing: characters.count > 2 ? -1 : 0) {
            ForEach(Array(characters.enumerated()), id: \.offset) { _, character in
                Text(String(character))
                    .font(style.widgetFont(size: size, weight: weight))
                    .foregroundStyle(color)
            }
        }
        .fixedSize()
        // 三个字收了字号也还比两个字高一点：按竖线的高度占位，多出来的上下各探出一点，
        // 日期栏不会因为今天是国庆节就比旁边高。
        .frame(height: columnHeight)
    }

    private var calendarDay: ChineseCalendarDay? {
        guard let date = day.date else { return nil }
        return ChineseCalendarInfo.info(forDate: date)
    }

    private var badgeText: String? {
        guard options.showHoliday else { return nil }
        return calendarDay?.badge
    }

    private var lunarText: String? {
        guard options.showLunarDate, let calendarDay else { return nil }
        return calendarDay.lunar.shortLabel
    }

    /// 星期旁边那一列始终用于农历，节日单独显示在右侧。
    private var stackedDetail: String? {
        return lunarText
    }

    private var detailColor: Color {
        return widgetColors.secondary
    }

    /// 开了「始终显示最近节假日」时，今天不在假期里就提示最近的一段法定假期（看未来 120 天）。
    private var holidayCountdown: ChineseHolidayCountdown? {
        guard options.showsResidentHoliday, !hidesCountdown else { return nil }
        guard let date = (countdownDay ?? day).date, let reference = ChineseCalendarInfo.date(fromDate: date),
              let next = ChineseCalendarInfo.countdown(from: reference, withinDays: 120),
              next.daysAway > 0 else { return nil }
        return next
    }
}

/// 日期栏第二行右边常驻的假期倒计时：「距离国庆节 还有 5 天」，天数用主题色大一号。
/// 只报还剩几天，右边缘和上一行的「第 N 周」对齐：多一个色块或日期，两行的右端就对不上了。
@available(iOS 17.0, *)
private struct HolidayCountdownChip: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    let countdown: ChineseHolidayCountdown
    /// 大号日期栏放大过字，这里跟着放大一点。
    var sizeBoost: CGFloat = 0
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        countdownText(tint: renderingMode == .fullColor ? widgetColors.accent(for: theme) : widgetColors.primary)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .accessibilityLabel(countdown.phrase)
    }

    private func countdownText(tint: Color) -> Text {
        let leading = Text(countdown.leading)
            .font(style.widgetFont(size: 10 + sizeBoost, weight: .semibold))
            .foregroundColor(widgetColors.secondary)
        guard let amount = countdown.amount else { return leading }
        return leading
            + Text(" ")
            + Text(amount)
                .font(style.widgetFont(size: 12 + sizeBoost, weight: .bold, design: .rounded))
                .foregroundColor(tint)
            + Text(" " + countdown.trailing)
                .font(style.widgetFont(size: 10 + sizeBoost, weight: .semibold))
                .foregroundColor(widgetColors.secondary)
    }
}

/// 选了「接着显示下一次课」、小组件换到别的日子时，日期栏上的标注：「明天的课」「10/2 的课」。
@available(iOS 17.0, *)
private struct OtherDayChip: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    let title: String
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        let tint = widgetColors.accent(for: theme)
        Text(title)
            .font(style.widgetFont(size: 9, weight: .bold))
            .lineLimit(1)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background {
                Capsule().fill(renderingMode == .fullColor ? tint.opacity(0.16) : Color.white.opacity(0.14))
            }
            .foregroundStyle(renderingMode == .fullColor ? tint : widgetColors.primary)
    }
}

/// 某一天离今天几天，用来说「明天」「后天」「3 天后」。今天及以前返回 `nil`。
@available(iOS 17.0, *)
private enum OtherDay {
    /// 日期栏与跨日课程标注之间的间距，各尺寸共用。
    static let headerSpacing: CGFloat = 4

    static func offset(of day: ScheduleDay, now: Date) -> Int? {
        guard let date = day.date, let target = ChineseCalendarInfo.date(fromDate: date) else { return nil }
        let calendar = ChineseCalendarInfo.gregorian
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: target)).day ?? 0
        return days > 0 ? days : nil
    }

    /// 「明天」「后天」「3 天后」。
    static func label(for day: ScheduleDay, now: Date) -> String? {
        guard let days = offset(of: day, now: now) else { return nil }
        switch days {
        case 1: return "明天"
        case 2: return "后天"
        default: return "\(days) 天后"
        }
    }

    /// 日期栏上的「明天的课」「后天的课」；再往后直接写日期：「10/2 的课」。
    static func hint(for day: ScheduleDay, now: Date) -> String? {
        guard let days = offset(of: day, now: now) else { return nil }
        switch days {
        case 1: return "明天的课"
        case 2: return "后天的课"
        default: return "\(day.compactDate.replacingOccurrences(of: ".", with: "/")) 的课"
        }
    }
}


/// 课程换成了别的日子（「接着显示下一次课」）时，挂在课程正上方的标注：实心的「明天」加上
/// 那天的日期和星期。日期栏上的小胶囊不够显眼，紧贴着课放才看得出下面不是今天的课。
@available(iOS 17.0, *)
private struct OtherDayBanner: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    /// 胶囊的高度。临近课程的纯文字标题也占这么高，换不换日子课的位置都不跳。
    static let height: CGFloat = 16

    let day: ScheduleDay
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.scheduleWidgetNow) private var now

    var body: some View {
        let solid = widgetColors.solidAccent(for: theme)
        let fullColor = renderingMode == .fullColor
        // 醒目只交给胶囊一处，后面的星期用灰字：再用强调色写一遍日期，就和上面日期栏的
        // 今天叠成两行日期，分不清哪个是课的日子。明天、后天不写日期，胶囊已经说了。
        let near = (OtherDay.offset(of: day, now: now) ?? 1) <= 2
        let detail = (near ? [day.displayLabel] : [day.compactDate, day.displayLabel])
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        HStack(spacing: 5) {
            Text(OtherDay.label(for: day, now: now) ?? "")
                .font(style.widgetFont(size: 10, weight: .heavy))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background {
                    Capsule().fill(fullColor ? solid.fill : Color.white.opacity(0.28))
                }
                .foregroundStyle(fullColor ? solid.text : widgetColors.primary)
                .widgetAccentable()
            Text(detail)
                .font(style.widgetFont(size: 11, weight: .semibold))
                .foregroundStyle(widgetColors.secondary)
        }
        .lineLimit(1)
        .fixedSize()
        .frame(height: Self.height)
    }
}

/// 节日/法定假期徽标。法定假期用粉色，普通节日和节气跟随主题色。
@available(iOS 17.0, *)
private struct HolidayBadge: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    let title: String
    let highlighted: Bool
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        let tint = highlighted ? Color.pink : widgetColors.accent(for: theme)
        Text(title)
            .font(style.widgetFont(size: 9, weight: .bold))
            .lineLimit(1)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background {
                Capsule().fill(renderingMode == .fullColor ? tint.opacity(0.16) : Color.white.opacity(0.14))
            }
            .foregroundStyle(renderingMode == .fullColor ? tint : widgetColors.primary)
    }
}

/// 休息状态：今天是法定假日就道贺（「中秋快乐」），
/// 其余一律「今日无课」；下面一行小字是最近的一段法定假期。
@available(iOS 17.0, *)
private enum RestState {
    static func message(now: Date) -> String {
        ChineseCalendarInfo.restGreeting(for: now) ?? "今日无课"
    }

    static func countdown(options: ScheduleWidgetDisplayOptions, now: Date) -> ChineseHolidayCountdown? {
        guard options.showHoliday else { return nil }
        return ChineseCalendarInfo.countdown(from: now, withinDays: 120)
    }

    /// 休息时顶上来的那段假期，排成和「临近课程」一样的三行：小标签「4 天后」、
    /// 标题「国庆节」、说明「10.1 - 10.7 · 休 7 天」。已经在放假就是「放假中」「国庆快乐」。
    /// 关掉节假日提示或 120 天内没有假期时为 `nil`。
    static func holiday(
        options: ScheduleWidgetDisplayOptions,
        now: Date
    ) -> (caption: String, title: String, detail: String)? {
        guard let countdown = countdown(options: options, now: now) else { return nil }
        let name = countdown.window.name
        switch countdown.daysAway {
        case 0:
            return ("放假中", ChineseCalendarInfo.restGreeting(for: now) ?? name, countdown.dateLabel)
        case 1:
            return ("明天", name, countdown.dateLabel)
        case let days:
            return ("\(days) 天后", name, countdown.dateLabel)
        }
    }

    /// 锁屏单行只放一句：祝福 → 「距国庆节还有 5 天」→「今日无课」。
    static func inlineText(options: ScheduleWidgetDisplayOptions, now: Date) -> String {
        if let greeting = ChineseCalendarInfo.restGreeting(for: now) { return greeting }
        if let countdown = countdown(options: options, now: now), countdown.daysAway > 0 {
            return countdown.phrase
        }
        return "今日无课"
    }
}

@available(iOS 17.0, *)
private struct EmptyCoursesView: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    let message: String

    var body: some View {
        VStack(spacing: 9) {
            if style != .minimal {
                Image(systemName: symbol)
                    .font(style.widgetFont(size: 20, weight: .regular))
                    .foregroundStyle(widgetColors.muted.opacity(0.75))
                    .accessibilityHidden(true)
            }
            Text(message)
                .font(style.widgetFont(size: 12, weight: .semibold))
                .foregroundStyle(widgetColors.muted)
                .lineLimit(2)
                .multilineTextAlignment(.center)
            if style == .board {
                StationPerforation().stroke(widgetColors.muted.opacity(0.35), style: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
                    .frame(width: 64, height: 1)
                    .accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }

    private var symbol: String {
        switch style {
        case .board: "tram"
        case .paper: "leaf"
        case .table: "checkmark"
        case .minimal: "moon"
        }
    }
}

/// 两日课表放假当天今天那一列：图标、祝福，下面是这段假期的日期和进度（一天一个点，过去的和今天实心）。
/// 半个组件宽、一整列高，只写一行「国庆快乐」太空。关掉节假日提示时只留图标和祝福。
@available(iOS 17.0, *)
private struct HolidayGreetingView: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    let greeting: String
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetCelebrating) private var celebrating
    @Environment(\.scheduleWidgetFireworksPreviewTime) private var previewTime
    @Environment(\.scheduleWidgetNow) private var now

    var body: some View {
        let countdown = RestState.countdown(options: options, now: now).flatMap { $0.daysAway == 0 ? $0 : nil }
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            VStack(spacing: 10) {
                icon
                VStack(spacing: 4) {
                    Text(greeting)
                        .font(style.widgetFont(size: 17, weight: .bold))
                        .foregroundStyle(widgetColors.primary)
                    if let countdown {
                        Text(Self.dateText(for: countdown, now: now))
                            .font(style.widgetFont(size: 10, weight: .medium))
                            .foregroundStyle(widgetColors.secondary)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                if let countdown, let progress = Self.progress(of: countdown.window, now: now) {
                    VStack(spacing: 6) {
                        HStack(spacing: 4) {
                            ForEach(1...progress.total, id: \.self) { index in
                                Circle()
                                    .fill(index <= progress.day ? Color.pink : widgetColors.muted.opacity(0.3))
                                    .frame(width: 6, height: 6)
                                    .widgetAccentable(index <= progress.day)
                            }
                        }
                        Text(progress.day == progress.total ? "假期最后一天" : "第 \(progress.day) 天 · 还剩 \(progress.total - progress.day) 天")
                            .font(style.widgetFont(size: 9, weight: .semibold))
                            .foregroundStyle(widgetColors.muted)
                            .lineLimit(1)
                    }
                    .padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
            // 下面多留一点：整组稍微偏上，看起来才是居中的。
            Spacer(minLength: 0).frame(maxHeight: 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// 清明道安康，放彩炮不合适，换成叶子，也不放烟花。
    private var isSolemn: Bool { greeting.hasPrefix("清明") }

    @ViewBuilder
    private var icon: some View {
        let image = Image(systemName: isSolemn ? "leaf.fill" : "party.popper.fill")
            .font(style.widgetFont(size: 30, weight: .semibold))
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(Color.pink)
            .widgetAccentable()
        if isSolemn {
            image
        } else {
            // 彩炮是个按钮：按一下整个小组件放烟花，几秒后收起。按的时候彩炮往上一扬。
            Button(intent: CelebrateHolidayIntent()) {
                let lift = previewTime.map { FireworksTiming.tilt(at: $0) } ?? (celebrating ? 1 : 0)
                image
                    .rotationEffect(.degrees(-14 * lift))
                    .scaleEffect(1 + 0.18 * lift)
                    .padding(8)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .animation(.spring(duration: 0.9, bounce: 0.35), value: celebrating)
            .padding(-8)
            // 烟花由最外层铺满整个小组件放，从这里（彩炮口）飞出去。
            .anchorPreference(key: FireworksOriginKey.self, value: .center) { $0 }
        }
    }

    /// 画了进度点就只写起止日期：「休 7 天」和下面的「还剩 5 天」重复。没画点时照旧用完整的说明。
    private static func dateText(for countdown: ChineseHolidayCountdown, now: Date) -> String {
        let window = countdown.window
        guard progress(of: window, now: now) != nil else { return countdown.dateLabel }
        return "\(ChineseCalendarInfo.monthDayLabel(window.start)) - \(ChineseCalendarInfo.monthDayLabel(window.end))"
    }

    /// 今天是这段假期的第几天、一共几天。只有一天的假期不画点。
    private static func progress(of window: ChineseHolidayWindow, now: Date) -> (day: Int, total: Int)? {
        let total = window.dayCount
        let today = ChineseCalendarInfo.dateString(now)
        guard total > 1, total <= 12, let gap = ChineseCalendarInfo.dayGap(from: window.start, to: today) else { return nil }
        return (min(max(gap + 1, 1), total), total)
    }
}

/// 彩炮在小组件里的位置。只有放假祝福里的彩炮会报，报了最外层才铺烟花。
@available(iOS 17.0, *)
private struct FireworksOriginKey: PreferenceKey {
    static let defaultValue: Anchor<CGPoint>? = nil

    static func reduce(value: inout Anchor<CGPoint>?, nextValue: () -> Anchor<CGPoint>?) {
        value = value ?? nextValue()
    }
}

/// 今天没有要列的课时的主视图。上面一行小字交代今天：「今日课程已结束」或「今日无课」；
/// 最近的一段假期和「临近课程」里的一节课一个排法（小标签、标题、一行说明），贴着底边。
/// 放假当天不写上面那行，「放假中 / 国庆快乐」已经说明了。没有假期可说时只居中说今天。
@available(iOS 17.0, *)
private struct RestStateView: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    /// 今天排过课（已经上完）还是本来就没课。
    let hadCourses: Bool
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetNotice) private var notice
    @Environment(\.scheduleWidgetNow) private var now

    private var todayStatus: String { hadCourses ? "今日课程已结束" : "今日无课" }

    var body: some View {
        if let notice {
            ScheduleNoticeBlock(notice: notice)
        } else if let holiday = RestState.holiday(options: options, now: now) {
            VStack(alignment: .leading, spacing: 0) {
                if RestState.countdown(options: options, now: now)?.daysAway != 0 {
                    statusLine
                }
                Spacer(minLength: 6)
                holidayBlock(holiday)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        } else {
            EmptyCoursesView(message: todayStatus)
        }
    }

    private var statusLine: some View {
        Label {
            Text(todayStatus)
        } icon: {
            Image(systemName: hadCourses ? "checkmark.circle.fill" : "moon.zzz.fill")
        }
        .labelStyle(StatusLabelStyle())
        .font(style.widgetFont(size: 11, weight: .semibold))
        .foregroundStyle(widgetColors.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }

    private func holidayBlock(_ holiday: (caption: String, title: String, detail: String)) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            if style == .board {
                StationPerforation()
                    .stroke(widgetColors.muted.opacity(0.4), style: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
                    .frame(height: 1)
                    .padding(.bottom, 3)
                    .accessibilityHidden(true)
            }
            Text(holiday.caption)
                .font(style.widgetFont(size: 11, weight: .semibold))
                .foregroundStyle(widgetColors.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(holiday.title)
                    .font(style.widgetFont(size: 15, weight: .bold))
                    .foregroundStyle(widgetColors.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.76)
                Text(holiday.detail)
                    .font(style.widgetFont(size: 10, weight: .medium))
                    .foregroundStyle(widgetColors.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
    }
}

/// 放假和课表过期时的文字、图标。
@available(iOS 17.0, *)
private extension ScheduleWidgetNotice {
    var symbol: String {
        switch self {
        case .vacation(let vacation):
            switch vacation.kind {
            case .winter: return "snowflake"
            case .summer: return "sun.max.fill"
            case .other: return "beach.umbrella.fill"
            }
        case .stale:
            return "arrow.triangle.2.circlepath"
        }
    }

    var tint: Color {
        switch self {
        case .vacation(let vacation):
            switch vacation.kind {
            case .winter: return .cyan
            case .summer: return .orange
            case .other: return .pink
            }
        case .stale:
            return WidgetPalette.secondary
        }
    }

    var title: String {
        switch self {
        case .vacation(let vacation): return vacation.title
        case .stale: return "课表需要更新"
        }
    }

    /// 标题下面那行小字：放假写节日祝福和「距开学还有 N 天」，都没有就不写；过期提示打开 App。
    func detail(now: Date) -> String? {
        switch self {
        case .vacation(let vacation):
            let parts = [ChineseCalendarInfo.restGreeting(for: now), vacation.countdown].compactMap { $0 }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        case .stale:
            return "打开 App 更新课表"
        }
    }

    /// 锁屏单行。
    var inlineText: String {
        switch self {
        case .vacation(let vacation):
            guard let days = vacation.daysUntilTerm, days > 0 else { return vacation.title }
            return "\(vacation.title) · 距开学 \(days) 天"
        case .stale:
            return "打开 App 更新课表"
        }
    }

    /// 锁屏圆形里图标下面那两三个字。
    var circularText: String {
        switch self {
        case .vacation(let vacation):
            if let days = vacation.daysUntilTerm, days > 0 { return "\(days)天" }
            switch vacation.kind {
            case .winter: return "寒假"
            case .summer: return "暑假"
            case .other: return "放假"
            }
        case .stale:
            return "待更新"
        }
    }
}

/// 小号、中号的放假 / 过期状态：和假期倒计时一样贴着底边，图标、大字标题、一行说明。
@available(iOS 17.0, *)
private struct ScheduleNoticeBlock: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    let notice: ScheduleWidgetNotice
    @Environment(\.scheduleWidgetNow) private var now

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 6)
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: notice.symbol)
                    .font(style.widgetFont(size: 20, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(notice.tint)
                    .widgetAccentable()
                VStack(alignment: .leading, spacing: 2) {
                    Text(notice.title)
                        .font(style.widgetFont(size: 17, weight: .bold))
                        .foregroundStyle(widgetColors.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if let detail = notice.detail(now: now) {
                        Text(detail)
                            .font(style.widgetFont(size: 10, weight: .medium))
                            .foregroundStyle(widgetColors.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// 大号（今日课表、两日课表）的放假 / 过期状态：和放假祝福一样把图标、标题摆在中间。
@available(iOS 17.0, *)
private struct ScheduleNoticeGreetingView: View {
    @Environment(\.scheduleWidgetStyle) private var style
    @WidgetStyleColors private var widgetColors
    let notice: ScheduleWidgetNotice
    @Environment(\.scheduleWidgetNow) private var now

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            VStack(spacing: 10) {
                Image(systemName: notice.symbol)
                    .font(style.widgetFont(size: 34, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(notice.tint)
                    .widgetAccentable()
                VStack(spacing: 4) {
                    Text(notice.title)
                        .font(style.widgetFont(size: 20, weight: .bold))
                        .foregroundStyle(widgetColors.primary)
                    if let detail = notice.detail(now: now) {
                        Text(detail)
                            .font(style.widgetFont(size: 11, weight: .medium))
                            .foregroundStyle(widgetColors.secondary)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 0)
            // 和放假祝福一样整组稍微偏上。
            Spacer(minLength: 0).frame(maxHeight: 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 图标和字挨近一点，默认的 Label 间距在小组件里显得散。
@available(iOS 17.0, *)
private struct StatusLabelStyle: LabelStyle {
    @Environment(\.scheduleWidgetStyle) private var style
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon
                .font(style.widgetFont(size: 10, weight: .semibold))
            configuration.title
        }
    }
}


// MARK: - Fireworks

/// 烟花的节奏，按下那一条时间线里一口气放完：碎片从各簇中心往外炸（先快后慢），同时往下坠
///（先慢后快，两者叠出一道下垂的弧线），一下亮起、再慢慢暗到看不见。星芒一闪就没，光束先散，
/// 亮点次之，外圈的闪光飘得最久、坠得最远。画廊逐帧出动画时按这里算。
///
/// 小组件在真机上是把前后两条时间线的画面各存一份，由系统在两份之间插值，所以：
/// - 只有两份里都有的视图才会动（彩炮能扬起就是这样）。新插进来的视图直接按后一份画，
///   过渡、父视图的动画都不管用。所以碎片平时就在，按下只改状态。
/// - 存下来的是合并后的画面：叠在一起的几个缩放合成一个变换，几个透明度乘成一个值。
///   所以不能靠「先放大再缩小」两个效果相乘做出中间亮一下，前后乘积一样就什么都不动。
/// - 一个视图上的几样变化只会共用一条动画（实测整段都按最快的那条一下放完），各挂各的 `.animation` 不管用。
///   要不同快慢就得放在不同的视图上，中间隔一层 `compositingGroup`，免得又被合并。
/// - 只用系统自带的曲线，自定义贝塞尔不一定认。
/// - 完全透明的视图很可能存档时就被丢掉了，两份里都没有也就不会动。所以碎片的透明度从不降到 0：
///   平时和散完都只是暗到 `hiddenLevel`，看不见但还在。
/// - 验证真机效果用 Xcode 里这份文件末尾的 `#Preview`：它和桌面一样按两条时间线插值。
/// - 每段动画最长只放 2 秒左右，超过的部分直接跳到终点。
/// - 不认 `.delay`。
/// - 下一条时间线什么时候换上不由我们定，不指望它接着放第二段。
@available(iOS 17.0, *)
enum FireworksTiming {
    /// 按下后一组碎片一下亮起用的时间。
    static let flashDuration = 0.15
    /// 散完时碎片暗到多暗：看不见，但不是 0，免得存档时被丢掉。
    static let hiddenLevel = 0.02
    /// 碎片刚炸开时多大，飞出去的路上长到原大。平时靠整组暗到 `hiddenLevel` 藏住（见 `FireworksOverlay`）。
    static let collapsedScale = 0.4

    /// 每一层飞多久、散完要多久（两个一样长），一路坠下多少（占小组件短边的比例）。
    static func layer(_ kind: FireworksLayer) -> (life: Double, drop: CGFloat) {
        switch kind {
        case .core: return (0.8, 0.04)
        case .streak: return (1.1, 0.09)
        case .dot: return (1.5, 0.14)
        case .glitter: return (1.8, 0.2)
        }
    }

    /// 按下到最后一点闪光散完（最长那一层的寿命）。
    static let total = 1.8

    static func outward(_ progress: Double) -> Double { UnitCurve.easeOut.value(at: progress) }

    /// 下坠和变暗：先慢后快，一出来不至于就显得灰，也像被重力拽下去。只用系统自带的曲线，自定义贝塞尔在小组件里不一定认。
    static func fade(_ progress: Double) -> Double { UnitCurve.easeIn.value(at: progress) }

    /// 彩炮扬起多少：带一点回弹地扬起，烟花散完、下一条时间线来了再放回去。
    static func tilt(at time: Double) -> Double {
        guard time > 0 else { return 0 }
        let rise = min(time / 0.5, 1)
        let spring = 1 - pow(1 - rise, 3) + sin(rise * .pi) * 0.25
        let settle = min(max((time - (total + 0.3)) / 0.9, 0), 1)
        return spring * (1 - UnitCurve.easeInOut.value(at: settle))
    }
}

/// 烟花碎片的几种：星芒、光束、亮点、闪光，散得快慢、坠得远近不同。
@available(iOS 17.0, *)
enum FireworksLayer: CaseIterable {
    case core, streak, dot, glitter
}

@available(iOS 17.0, *)
private struct FireworksPreviewTimeKey: EnvironmentKey {
    static let defaultValue: Double? = nil
}

@available(iOS 17.0, *)
extension EnvironmentValues {
    /// 只有预览画廊会设：画烟花动画第几秒的样子。
    var scheduleWidgetFireworksPreviewTime: Double? {
        get { self[FireworksPreviewTimeKey.self] }
        set { self[FireworksPreviewTimeKey.self] = newValue }
    }
}

/// 铺满整个小组件的烟花。一簇一个色系，从中心往外辐射成菊花形：每根射线外头一道拖着尾巴的光，
/// 中间一颗亮点，隔一根在最外面再缀一点闪光，中心一颗星芒。一簇大的在彩炮正上方（像是它打上去的），
/// 另外几簇大小不一，散在小组件各处。
///
/// 小组件里没法跑逐帧动画，碎片平时就缩成一个点停在各簇中心，按下时几样状态各带各的曲线同时起跑
///（见 `FireworksTiming`）。位置按小组件大小的比例算好，不用随机数。
@available(iOS 17.0, *)
private struct FireworksOverlay: View {
    let active: Bool
    /// 彩炮口，在这一层的坐标里。
    let origin: CGPoint
    @Environment(\.scheduleWidgetFireworksPreviewTime) private var previewTime

    private struct Burst {
        let center: CGPoint
        let radius: CGFloat
        let rays: Int
        let colors: (Color, Color)
    }

    private struct Particle: Identifiable {
        let id: Int
        /// 哪一簇的哪一种碎片：同一组一起变暗。
        let group: Int
        let kind: FireworksLayer
        let burstCenter: CGPoint
        /// 炸开到哪（相对这一簇的中心）。
        let travel: CGSize
        let angle: Double
        let size: CGFloat
        let color: Color
    }

    /// 一簇一个色系，按放下的先后分：第一簇（彩炮上方）是金色。
    private static let palettes: [(Color, Color)] = [
        (.yellow, .orange),
        (.pink, Color(red: 1, green: 0.45, blue: 0.62)),
        (.cyan, .blue),
        (.purple, .pink),
        (.mint, .green),
    ]

    /// 其余几簇的候选位置（占宽高的比例）和半径（占短边的比例），按顺序挑，和已经放下的叠得太多就跳过。
    /// 彩炮在不同小组件里位置不一样（两日课表在左列，今日课表在正中），这样哪种都不会挤成一团。
    private static let candidates: [(x: CGFloat, y: CGFloat, radius: CGFloat)] = [
        (0.80, 0.22, 0.18),
        (0.20, 0.24, 0.16),
        (0.86, 0.54, 0.14),
        (0.14, 0.54, 0.13),
        (0.80, 0.85, 0.14),
        (0.20, 0.85, 0.12),
        (0.50, 0.90, 0.12),
    ]

    private static func bursts(in size: CGSize, origin: CGPoint) -> [Burst] {
        let side = min(size.width, size.height)
        // 第一簇在彩炮正上方，像是它打上去的。
        var placed: [(center: CGPoint, radius: CGFloat)] = [
            (CGPoint(x: origin.x, y: origin.y - side * 0.25), side * 0.19),
        ]
        // 彩炮和它下面的祝福也要让开，只占位不放烟花。
        let keepOut = [(center: CGPoint(x: origin.x, y: origin.y + side * 0.1), radius: side * 0.2)]
        for candidate in candidates where placed.count < palettes.count {
            let center = CGPoint(x: candidate.x * size.width, y: candidate.y * size.height)
            let radius = candidate.radius * side
            let clear = (placed + keepOut).allSatisfy { other in
                hypot(center.x - other.center.x, center.y - other.center.y) > (radius + other.radius) * 0.8
            }
            if clear { placed.append((center, radius)) }
        }
        return placed.enumerated().map { index, burst in
            Burst(
                center: burst.center,
                radius: burst.radius,
                rays: max(10, Int(burst.radius / 4.2)),
                colors: palettes[index]
            )
        }
    }

    private static func particles(in size: CGSize, origin: CGPoint) -> [Particle] {
        var result: [Particle] = []
        func add(_ kind: FireworksLayer, _ burst: Burst, burstIndex: Int, angle: Double, distance: CGFloat, size: CGFloat, color: Color) {
            let kindIndex = FireworksLayer.allCases.firstIndex(of: kind) ?? 0
            result.append(Particle(
                id: result.count, group: burstIndex * FireworksLayer.allCases.count + kindIndex,
                kind: kind, burstCenter: burst.center,
                travel: CGSize(width: CGFloat(cos(angle)) * distance, height: CGFloat(sin(angle)) * distance),
                angle: angle, size: size, color: color
            ))
        }
        for (index, burst) in bursts(in: size, origin: origin).enumerated() {
            let big = burst.radius > 40
            for ray in 0..<burst.rays {
                let angle = Double(ray) / Double(burst.rays) * 2 * .pi + Double(index) * 0.37
                let tint = ray.isMultiple(of: 2) ? burst.colors.0 : burst.colors.1
                let length = burst.radius * 0.34
                // 光束的中心往里收半个身长，尖端正好冲到半径上。
                add(.streak, burst, burstIndex: index, angle: angle, distance: burst.radius - length / 2, size: length, color: tint)
                add(.dot, burst, burstIndex: index, angle: angle + 0.12, distance: burst.radius * 0.62, size: big ? 3.4 : 2.8,
                    color: burst.colors.1)
                if ray.isMultiple(of: 2) {
                    add(.glitter, burst, burstIndex: index, angle: angle + 0.18, distance: burst.radius * 1.18, size: big ? 2.6 : 2.2,
                        color: burst.colors.0)
                }
            }
            add(.core, burst, burstIndex: index, angle: 0, distance: 0, size: big ? 13 : 10, color: burst.colors.0)
        }
        return result
    }

    var body: some View {
        GeometryReader { proxy in
            let particles = Self.particles(in: proxy.size, origin: origin)
            let side = min(proxy.size.width, proxy.size.height)
            let hidden = FireworksTiming.hiddenLevel
            let collapsed = FireworksTiming.collapsedScale
            let groups = Dictionary(grouping: particles) { $0.group }.sorted { $0.key < $1.key }
            ZStack {
                ForEach(groups, id: \.key) { _, members in
                    let layer = FireworksTiming.layer(members[0].kind)
                    let drop = layer.drop * side
                    // 同一个视图上的几样变化在小组件里只会共用一条动画，要各走各的就得是不同的视图，分三层：
                    // 碎片自己长到原大、往外飞，越飞越慢，一直飞到散没；同一簇同一种碎片合成一组，先一下亮起，
                    // 隔一层 `compositingGroup` 再整组越落越快、边落边暗（同一条先慢后快的曲线，像被重力拽下去）。
                    let fall = previewTime.map { $0 > 0 ? FireworksTiming.fade(min($0 / layer.life, 1)) : 0 }
                        ?? (active ? 1 : 0)
                    ZStack {
                        ForEach(members) { particle in
                            let landing = CGPoint(
                                x: particle.burstCenter.x + particle.travel.width,
                                y: particle.burstCenter.y + particle.travel.height
                            )
                            if let previewTime {
                                // 画廊逐帧出动画用：按和下面一样的曲线，自己算出第 previewTime 秒的样子。
                                let burst = previewTime > 0
                                    ? FireworksTiming.outward(min(previewTime / layer.life, 1)) : 0
                                shape(particle)
                                    .scaleEffect(collapsed + (1 - collapsed) * burst)
                                    .position(
                                        x: particle.burstCenter.x + (landing.x - particle.burstCenter.x) * burst,
                                        y: particle.burstCenter.y + (landing.y - particle.burstCenter.y) * burst
                                    )
                            } else {
                                // 平时缩小停在簇中心；按下时一边往外飞一边长到原大，飞到散没为止，不会半路停住。
                                shape(particle)
                                    .scaleEffect(active ? 1 : collapsed)
                                    .position(active ? landing : particle.burstCenter)
                                    .animation(active ? .easeOut(duration: layer.life) : nil, value: active)
                            }
                        }
                    }
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    // 平时整组暗到 hiddenLevel 藏住。先合成再调暗，叠在簇中心的一堆碎片才不会一层层透出来。
                    .compositingGroup()
                    .opacity(hidden + (1 - hidden) * (previewTime.map { $0 > 0 ? FireworksTiming.outward(min($0 / FireworksTiming.flashDuration, 1)) : 0 }
                        ?? (active ? 1 : 0)))
                    .animation(active && previewTime == nil ? .easeOut(duration: FireworksTiming.flashDuration) : nil, value: active)
                    .compositingGroup()
                    // 散完只暗到 hiddenLevel，不到 0。收起不靠这里：下一条换了 `.id`，整层按平时的样子重新放进来。
                    .offset(y: drop * fall)
                    .opacity(1 - (1 - hidden) * fall)
                    .animation(active && previewTime == nil ? .easeIn(duration: layer.life) : nil, value: active)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }

    @ViewBuilder
    private func shape(_ particle: Particle) -> some View {
        let color = particle.color
        switch particle.kind {
        case .streak:
            // 朝外的一道光，靠中心那头渐隐，像拖着尾巴飞出去。
            Capsule()
                .fill(LinearGradient(
                    colors: [particle.color.opacity(0), color],
                    startPoint: .leading, endPoint: .trailing
                ))
                .frame(width: particle.size, height: 2.4)
                .rotationEffect(.radians(particle.angle))
        case .dot, .glitter:
            Circle()
                .fill(color)
                .frame(width: particle.size, height: particle.size)
        case .core:
            Image(systemName: "sparkle")
                .font(.system(size: particle.size, weight: .bold))
                .foregroundStyle(color)
        }
    }
}

// MARK: - Families NapTable does not have

/// The radius and wash of a course card in the current style.
@available(iOS 17.0, *)
private struct ScheduleWidgetStylePalette {
    let style: WidgetStyle
    let dark: Bool

    var courseRadius: CGFloat { style.cornerRadius }
    var courseFillOpacity: Double { style.courseFillOpacity(dark: dark) }
}

/// What 今日课表 lists outside its medium and large sizes: today's courses
/// still to come, or with 接着显示下一次课 the next day that has classes.
@available(iOS 17.0, *)
private struct TodaySelection {
    let header: ScheduleDay
    /// The day the courses are on; another day than today with 接着显示下一次课.
    let day: ScheduleDay
    let courses: [ScheduleCourse]
    let otherDay: Bool
    let total: Int
    let finished: Int

    init(payload: SchedulePayload, now: Date, afterClass: ScheduleWidgetAfterClassStyle) {
        let today = payload.currentDay(now: now)
        let remaining = payload.remainingCourses(in: today, now: now)
        header = today
        if remaining.isEmpty, afterClass == .nextCourseDay, let next = payload.nextCourseDay(after: now) {
            day = next.day
            courses = next.day.courseList
            otherDay = true
            total = next.day.courseList.count
            finished = 0
        } else {
            day = today
            courses = remaining
            otherDay = false
            total = today.courseList.count
            finished = today.courseList.count - remaining.count
        }
    }
}

/// 今日课表小号：日期栏下面列还没上完的课，一门一行（课名、时间和教室），放不下的写「还有 N 门」。
@available(iOS 17.0, *)
private struct TodaySmallScheduleView: View {
    let payload: SchedulePayload
    @Environment(\.scheduleWidgetConfiguration) private var configuration
    @Environment(\.scheduleWidgetNow) private var now
    @Environment(\.scheduleWidgetNotice) private var notice

    var body: some View {
        let selection = TodaySelection(payload: payload, now: now, afterClass: configuration.afterClass)
        VStack(alignment: .leading, spacing: 0) {
            WidgetDateHeader(day: selection.header, hidesCountdown: true)
            if selection.courses.isEmpty {
                Spacer(minLength: 8)
                RestStateView(hadCourses: !selection.header.courseList.isEmpty)
            } else {
                Spacer(minLength: 6)
                ViewThatFits(in: .vertical) {
                    ForEach([3, 2, 1], id: \.self) { limit in
                        list(selection, limit: limit)
                    }
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
                .layoutPriority(1)
            }
        }
    }

    private func list(_ selection: TodaySelection, limit: Int) -> some View {
        let shown = Array(selection.courses.prefix(limit))
        let hidden = selection.courses.count - shown.count
        let minutes = selection.otherDay ? nil : SchedulePayload.minutesSinceMidnight(now)
        return VStack(alignment: .leading, spacing: 5) {
            if selection.otherDay {
                OtherDayBanner(day: selection.day)
            }
            ForEach(Array(shown.enumerated()), id: \.offset) { _, course in
                CompactNextCourse(course: course, inProgress: minutes.map { course.isInProgress(at: $0) } ?? false)
            }
            if hidden > 0 {
                RemainingCoursesText(count: hidden)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// 今日课表的锁屏：矩形列今天剩下的课，圆形是今天上了几节的进度，单行一句话。
@available(iOS 17.0, *)
private struct TodayAccessoryView: View {
    let payload: SchedulePayload
    @Environment(\.scheduleWidgetFamily) private var family
    @Environment(\.scheduleWidgetConfiguration) private var configuration
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetNow) private var now
    @Environment(\.scheduleWidgetNotice) private var notice
    @Environment(\.scheduleWidgetStyle) private var style

    var body: some View {
        let selection = TodaySelection(payload: payload, now: now, afterClass: configuration.afterClass)
        switch family {
        case .accessoryInline: inline(selection)
        case .accessoryCircular: circular(selection)
        default: rectangular(selection)
        }
    }

    private func dayTitle(_ selection: TodaySelection) -> String {
        selection.otherDay ? (OtherDay.label(for: selection.day, now: now) ?? selection.day.shortLabel) : "今天"
    }

    private func countText(_ selection: TodaySelection) -> String {
        selection.otherDay ? "\(selection.total) 节" : "还剩 \(selection.courses.count) 节"
    }

    private func inline(_ selection: TodaySelection) -> some View {
        Group {
            if let course = selection.courses.first {
                let time = options.showTime ? course.startLabel + " " : ""
                ViewThatFits(in: .horizontal) {
                    Text("\(dayTitle(selection)) \(countText(selection)) · \(time)\(options.primaryValue(for: course) ?? "")").fixedSize()
                    Text("\(dayTitle(selection)) · \(time)\(options.primaryValue(for: course) ?? "")")
                }
            } else {
                Text(notice?.inlineText ?? RestState.inlineText(options: options, now: now))
            }
        }
        .lineLimit(1)
    }

    private func circular(_ selection: TodaySelection) -> some View {
        ZStack {
            AccessoryWidgetBackground()
            if selection.total > 0, !selection.courses.isEmpty {
                // 今天上到第几节：外圈是进度，中间是还剩几节。
                Gauge(value: Double(selection.finished), in: 0...Double(max(selection.total, 1))) {
                    Text("课")
                } currentValueLabel: {
                    VStack(spacing: -2) {
                        Text("\(selection.otherDay ? selection.total : selection.courses.count)")
                            .font(style.timeFont(size: 20, weight: .bold, design: .rounded))
                        Text(selection.otherDay ? (OtherDay.label(for: selection.day, now: now) ?? "") : "节")
                            .font(.system(size: 9, weight: .semibold))
                    }
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .widgetAccentable()
            } else {
                VStack(spacing: 1) {
                    Image(systemName: notice?.symbol ?? "calendar.badge.checkmark")
                        .font(.system(size: 15, weight: .semibold))
                        .widgetAccentable()
                    Text(notice?.circularText ?? "无课")
                        .font(.system(size: 9, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
    }

    private func rectangular(_ selection: TodaySelection) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Image(systemName: selection.courses.isEmpty ? (notice?.symbol ?? "calendar.badge.checkmark") : "list.bullet.rectangle.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .widgetAccentable()
                Text([dayTitle(selection), selection.day.displayLabel].filter { !$0.isEmpty }.joined(separator: " "))
                    .font(.system(size: 11, weight: .bold))
                Spacer(minLength: 2)
                if !selection.courses.isEmpty {
                    Text(countText(selection))
                        .font(.system(size: 10, weight: .medium))
                }
            }
            .lineLimit(1)
            if selection.courses.isEmpty {
                let lines = restLines
                Text(lines.primary)
                    .font(.system(size: 14, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let secondary = lines.secondary {
                    Text(secondary)
                        .font(.system(size: 10, weight: .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
            } else {
                ForEach(Array(selection.courses.prefix(3).enumerated()), id: \.offset) { index, course in
                    HStack(spacing: 5) {
                        if options.showTime {
                            Text(course.startLabel)
                                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                                .frame(width: 34, alignment: .leading)
                        }
                        Text(options.primaryValue(for: course) ?? "")
                            .font(.system(size: 12, weight: index == 0 ? .bold : .medium))
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var restLines: (primary: String, secondary: String?) {
        if let notice { return (notice.title, notice.detail(now: now)) }
        guard let holiday = RestState.holiday(options: options, now: now) else {
            return (RestState.message(now: now), "打开课表查看本周安排")
        }
        return (holiday.title, "\(holiday.caption) · \(holiday.detail)")
    }
}

/// The two days the two-day widget shows: today, and tomorrow or (by
/// default) the next day with classes.
@available(iOS 17.0, *)
private struct TwoDaySelection {
    let today: ScheduleDay
    let right: ScheduleDay
    let rightOffset: Int

    init(payload: SchedulePayload, now: Date, start: TwoDayStartOption) {
        today = payload.currentDay(now: now)
        let tomorrowDate = SchedulePayload.dateString(
            ChineseCalendarInfo.gregorian.date(byAdding: .day, value: 1, to: now) ?? now
        )
        // 「编辑小组件」里可以把右边换成最近有课的一天：左边照旧是今天（没课就说没课、道祝福），
        // 右边跳过没课的日子；三周内都没课时照旧是明天。
        let next = start == .nextCourseDay ? payload.nextCourseDay(after: now) : nil
        right = next?.day ?? payload.fullDay(for: tomorrowDate, fallbackOffset: 1)
        rightOffset = next?.offset ?? 1
    }
}

/// 两日课表中号：两列各放日期和放得下的两三门课，多出来的写「后面还有 N 门课」。
@available(iOS 17.0, *)
private struct TwoDayMediumScheduleView: View {
    let payload: SchedulePayload
    @Environment(\.scheduleWidgetConfiguration) private var configuration
    @Environment(\.scheduleWidgetNotice) private var notice
    @Environment(\.scheduleWidgetNow) private var now

    var body: some View {
        if let notice {
            VStack(alignment: .leading, spacing: 0) {
                WidgetDateHeader(day: payload.currentDay(now: now), hidesCountdown: true)
                Spacer(minLength: 8)
                ScheduleNoticeBlock(notice: notice)
            }
        } else {
            let selection = TwoDaySelection(payload: payload, now: now, start: configuration.twoDayStart)
            let hint = selection.rightOffset > 1 ? OtherDay.hint(for: selection.right, now: now) : nil
            let sameWeek = selection.today.week != nil && selection.today.week == selection.right.week
            HStack(alignment: .top, spacing: 12) {
                MiniDayColumn(
                    day: selection.today, isToday: true,
                    header: WidgetDateHeader(day: selection.today, compact: true, hidesCountdown: true, dayHint: hint,
                                             hidesDayHint: true, hidesWeek: sameWeek)
                )
                Divider()
                MiniDayColumn(
                    day: selection.right, isToday: false,
                    header: WidgetDateHeader(day: selection.right, compact: true, hidesCountdown: true, dayHint: hint)
                )
            }
        }
    }
}

@available(iOS 17.0, *)
private struct MiniDayColumn: View {
    let day: ScheduleDay
    let isToday: Bool
    let header: WidgetDateHeader
    @Environment(\.scheduleWidgetNow) private var now

    var body: some View {
        let minutes = isToday ? SchedulePayload.minutesSinceMidnight(now) : nil
        // 今天那一列从还没上完的课排起：上完的课在中号里没地方灰着留着。
        let courses = minutes.map { minutes in day.courseList.filter { !$0.hasEnded(at: minutes) } } ?? day.courseList
        VStack(alignment: .leading, spacing: 0) {
            header
            Spacer(minLength: 6)
            if day.courseList.isEmpty {
                EmptyCoursesView(message: isToday ? RestState.message(now: now) : "没有课程")
            } else if courses.isEmpty {
                EmptyCoursesView(message: "今日课程已结束")
            } else {
                ViewThatFits(in: .vertical) {
                    ForEach([3, 2, 1], id: \.self) { limit in
                        VStack(alignment: .leading, spacing: 5) {
                            ForEach(Array(courses.prefix(limit).enumerated()), id: \.offset) { _, course in
                                CompactNextCourse(course: course, inProgress: minutes.map { course.isInProgress(at: $0) } ?? false)
                            }
                            if courses.count > limit {
                                RemainingCoursesText(count: courses.count - limit)
                                    .frame(maxWidth: .infinity, alignment: .trailing)
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxHeight: .infinity, alignment: .top)
                .layoutPriority(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// 两日课表的锁屏：矩形上下两段写两天，圆形写另一天几节课，单行一句话。
@available(iOS 17.0, *)
private struct TwoDayAccessoryView: View {
    let payload: SchedulePayload
    @Environment(\.scheduleWidgetFamily) private var family
    @Environment(\.scheduleWidgetConfiguration) private var configuration
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetNow) private var now
    @Environment(\.scheduleWidgetNotice) private var notice
    @Environment(\.scheduleWidgetStyle) private var style

    var body: some View {
        let selection = TwoDaySelection(payload: payload, now: now, start: configuration.twoDayStart)
        switch family {
        case .accessoryInline: inline(selection)
        case .accessoryCircular: circular(selection)
        default: rectangular(selection)
        }
    }

    private func label(_ day: ScheduleDay) -> String {
        OtherDay.label(for: day, now: now) ?? "今天"
    }

    private func firstCourse(_ courses: [ScheduleCourse]) -> String? {
        guard let course = courses.first else { return nil }
        return [options.showTime ? course.startLabel : nil, options.primaryValue(for: course)]
            .compactMap { $0 }.joined(separator: " ")
    }

    private func todayRemaining(_ day: ScheduleDay) -> [ScheduleCourse] {
        payload.remainingCourses(in: day, now: now)
    }

    private func inline(_ selection: TwoDaySelection) -> some View {
        Group {
            if notice != nil {
                Text(notice?.inlineText ?? "")
            } else if let first = firstCourse(selection.right.courseList) {
                Text("\(label(selection.right)) \(selection.right.courseList.count) 节 · \(first)")
            } else {
                Text("\(label(selection.right))没有课")
            }
        }
        .lineLimit(1)
    }

    private func circular(_ selection: TwoDaySelection) -> some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text(notice == nil ? label(selection.right) : "课表")
                    .font(.system(size: 10, weight: .semibold))
                    .widgetAccentable()
                if let notice {
                    Text(notice.circularText)
                        .font(.system(size: 12, weight: .bold))
                        .minimumScaleFactor(0.7)
                } else {
                    Text("\(selection.right.courseList.count)")
                        .font(style.timeFont(size: 20, weight: .bold, design: .rounded))
                    Text("节课")
                        .font(.system(size: 8, weight: .medium))
                }
            }
            .lineLimit(1)
        }
    }

    private func rectangular(_ selection: TwoDaySelection) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let notice {
                HStack(spacing: 4) {
                    Image(systemName: notice.symbol).font(.system(size: 11, weight: .semibold)).widgetAccentable()
                    Text(notice.title).font(.system(size: 14, weight: .bold))
                }
                if let detail = notice.detail(now: now) {
                    Text(detail).font(.system(size: 10, weight: .medium)).lineLimit(1).minimumScaleFactor(0.75)
                }
            } else {
                let remaining = todayRemaining(selection.today)
                block(
                    title: "今天",
                    count: selection.today.courseList.isEmpty ? "无课" : (remaining.isEmpty ? "已上完" : "还剩 \(remaining.count) 节"),
                    first: firstCourse(remaining)
                )
                block(
                    title: [label(selection.right), selection.right.displayLabel].joined(separator: " "),
                    count: selection.right.courseList.isEmpty ? "无课" : "\(selection.right.courseList.count) 节",
                    first: firstCourse(selection.right.courseList)
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func block(title: String, count: String, first: String?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Text(title).font(.system(size: 10, weight: .bold)).widgetAccentable()
                Text(count).font(.system(size: 10, weight: .medium))
            }
            if let first {
                Text(first)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .lineLimit(1)
    }
}

// MARK: - Week

/// 本周课表显示哪一周、哪几天。周末（或周五晚上）这一周剩下的日子都没课了，就换成下一周。
@available(iOS 17.0, *)
private struct WeekSelection {
    /// 要画的列：周一到周五，周六周日按设置。
    let days: [ScheduleDay]
    let week: Int?
    let isNextWeek: Bool
    /// 「11.9 - 11.15」。
    let range: String
    /// 上午、下午、晚上各要几行：这几天里那一段课最多的一天。
    let rows: [Int]

    static let bandCount = 3

    /// 上午 0、下午 1、晚上 2。没有具体时间的课排在上午。
    static func band(of course: ScheduleCourse) -> Int {
        guard let start = course.startMinutes else { return 0 }
        return start < 12 * 60 ? 0 : (start < 18 * 60 ? 1 : 2)
    }

    init(payload: SchedulePayload, now: Date, weekend: ScheduleWidgetWeekendStyle) {
        let calendar = ChineseCalendarInfo.gregorian
        let today = calendar.startOfDay(for: now)
        let weekday = calendar.component(.weekday, from: today)
        let sinceMonday = (weekday + 5) % 7
        func sevenDays(startingDaysFromToday start: Int) -> [ScheduleDay] {
            (0..<7).map { index in
                let offset = start + index
                let date = calendar.date(byAdding: .day, value: offset, to: today) ?? today
                return payload.fullDay(for: SchedulePayload.dateString(date), fallbackOffset: offset)
            }
        }
        let current = sevenDays(startingDaysFromToday: -sinceMonday)
        // 这一周还有没上的课吗：今天剩下的，加上后面几天的。
        let hasMore = !payload.remainingCourses(in: current[sinceMonday], now: now).isEmpty
            || current.dropFirst(sinceMonday + 1).contains { !$0.courseList.isEmpty }
        let next = hasMore ? [] : sevenDays(startingDaysFromToday: 7 - sinceMonday)
        let all = next.contains { !$0.courseList.isEmpty } ? next : current
        isNextWeek = !hasMore && all.first?.date != current.first?.date
        let shown = all.enumerated().filter { index, day in
            guard index >= 5 else { return true }
            switch weekend {
            case .always: return true
            case .never: return false
            case .whenNeeded: return !day.courseList.isEmpty
            }
        }.map(\.element)
        days = shown
        week = all.compactMap(\.week).first
        range = [all.first, all.last].compactMap { $0?.compactDate }.joined(separator: " - ")
        rows = (0..<Self.bandCount).map { band in
            shown.map { day in day.courseList.filter { Self.band(of: $0) == band }.count }.max() ?? 0
        }
    }
}

/// 本周课表：一天一列，课按上午、下午、晚上对齐成行，一眼看得出这一周哪天满、哪天空。
/// 大号每列只有六十几点宽，课名折两行、放不下的先去掉时间再去掉教室；iPad 的超大号每列一百三十点左右，字也大一号。
@available(iOS 17.0, *)
private struct WeekScheduleView: View {
    let payload: SchedulePayload
    @Environment(\.scheduleWidgetFamily) private var family
    @Environment(\.scheduleWidgetConfiguration) private var configuration
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @Environment(\.scheduleWidgetNotice) private var notice
    @Environment(\.scheduleWidgetNow) private var now
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetTheme) private var theme
    @WidgetStyleColors private var widgetColors

    private var wide: Bool { family == .systemExtraLarge }

    var body: some View {
        if let notice {
            // 寒暑假、课表过期：没有哪一周可列。
            VStack(alignment: .leading, spacing: 0) {
                WidgetDateHeader(day: payload.currentDay(now: now), tableName: payload.title)
                ScheduleNoticeGreetingView(notice: notice)
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .environment(\.scheduleWidgetFamily, .systemLarge)
        } else {
            let selection = WeekSelection(payload: payload, now: now, weekend: configuration.weekend)
            VStack(alignment: .leading, spacing: wide ? 8 : 6) {
                titleRow(selection)
                if selection.rows.reduce(0, +) == 0 {
                    EmptyCoursesView(message: "这一周没有课")
                } else {
                    HStack(alignment: .top, spacing: wide ? 6 : 4) {
                        ForEach(Array(selection.days.enumerated()), id: \.offset) { _, day in
                            column(day, selection: selection)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    private func titleRow(_ selection: WeekSelection) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if options.showWeek, let week = selection.week, week > 0 {
                Text("第 \(week) 周")
                    .font(style.widgetFont(size: wide ? 17 : 15, weight: .bold))
                    .foregroundStyle(widgetColors.primary)
            } else {
                Text(selection.isNextWeek ? "下周课表" : "本周课表")
                    .font(style.widgetFont(size: wide ? 17 : 15, weight: .bold))
                    .foregroundStyle(widgetColors.primary)
            }
            Text(selection.range)
                .font(style.timeFont(size: wide ? 12 : 11, weight: .medium))
                .foregroundStyle(widgetColors.secondary)
            if selection.isNextWeek {
                OtherDayChip(title: "下周")
            }
            Spacer(minLength: 4)
            if options.showsResidentHoliday,
               let countdown = ChineseCalendarInfo.countdown(from: now, withinDays: 120), countdown.daysAway > 0 {
                HolidayCountdownChip(countdown: countdown)
                    .fixedSize()
            }
        }
        .lineLimit(1)
    }

    private func column(_ day: ScheduleDay, selection: WeekSelection) -> some View {
        let isToday = day.date == SchedulePayload.dateString(now)
        let isPast = (day.date ?? "") < SchedulePayload.dateString(now)
        let minutes = isToday ? SchedulePayload.minutesSinceMidnight(now) : nil
        return VStack(spacing: wide ? 5 : 4) {
            dayHeader(day, isToday: isToday, isPast: isPast)
            ForEach(0..<WeekSelection.bandCount, id: \.self) { band in
                let courses = day.courseList.filter { WeekSelection.band(of: $0) == band }
                ForEach(0..<selection.rows[band], id: \.self) { row in
                    Group {
                        if row < courses.count {
                            WeekCourseChip(
                                course: courses[row],
                                wide: wide,
                                // 过去的日子、今天已经下课的课压暗。
                                completed: isPast || (minutes.map { courses[row].hasEnded(at: $0) } ?? false),
                                inProgress: minutes.map { courses[row].isInProgress(at: $0) } ?? false
                            )
                        } else {
                            Color.clear
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 22, maxHeight: wide ? 76 : 66)
                    // 上午、下午、晚上之间多留一点，行与行对得齐也分得开。
                    .padding(.top, row == 0 && band > 0 && selection.rows[..<band].contains { $0 > 0 } ? (wide ? 5 : 3) : 0)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private func dayHeader(_ day: ScheduleDay, isToday: Bool, isPast: Bool) -> some View {
        let solid = widgetColors.solidAccent(for: theme)
        return HStack(spacing: 3) {
            Text(day.displayLabel)
                .font(style.widgetFont(size: wide ? 11 : 9, weight: .semibold))
                .foregroundStyle(isToday ? widgetColors.accent(for: theme) : (isPast ? widgetColors.muted : widgetColors.secondary))
            Text(day.dayOfMonthLabel)
                .font(style.widgetFont(size: wide ? 12 : 10, weight: .bold, design: .rounded))
                .foregroundStyle(isToday ? solid.text : (isPast ? widgetColors.muted : widgetColors.primary))
                .padding(.horizontal, isToday ? 4 : 0)
                .padding(.vertical, isToday ? 1 : 0)
                .background {
                    if isToday {
                        Capsule().fill(solid.fill).widgetAccentable()
                    }
                }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .frame(maxWidth: .infinity)
        .frame(height: wide ? 18 : 16)
    }
}

/// 本周课表里的一门课：色条、课名，放得下再写教室和时间。
@available(iOS 17.0, *)
private struct WeekCourseChip: View {
    let course: ScheduleCourse
    let wide: Bool
    let completed: Bool
    let inProgress: Bool
    @Environment(\.scheduleWidgetStyle) private var style
    @Environment(\.scheduleWidgetTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleWidgetDisplayOptions) private var options
    @WidgetStyleColors private var widgetColors

    var body: some View {
        let accent = widgetColors.accent(for: course, theme: theme, colorScheme: colorScheme)
        let radius: CGFloat = style == .minimal ? (wide ? 8 : 6) : style.cornerRadius
        // 列窄，放不下时依次去掉时间、教室，课名从两行退到一行。量高度用最后一种，最矮。
        FirstThatFitsVertically {
            content(titleLines: 2, room: true, time: true)
            content(titleLines: 2, room: true, time: false)
            content(titleLines: 2, room: false, time: false)
            content(titleLines: 1, room: false, time: false)
        }
        .padding(.leading, wide ? 9 : 7)
        .padding(.trailing, wide ? 5 : 3)
        .padding(.vertical, wide ? 5 : 3)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(widgetColors.cardFill(for: course, theme: theme))
        }
        .overlay(alignment: .leading) {
            Capsule().fill(accent)
                .frame(width: wide ? 3 : 2.5)
                .padding(.vertical, wide ? 5 : 4)
                .padding(.leading, wide ? 3 : 2)
                .widgetAccentable()
        }
        .overlay {
            // 正在上的这一门描一圈。
            if inProgress {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(accent, lineWidth: 1.2)
                    .widgetAccentable()
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .saturation(completed ? 0 : 1)
        .opacity(completed ? 0.56 : 1)
        .accessibilityElement(children: .combine)
    }

    private func content(titleLines: Int, room: Bool, time: Bool) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            if let primary = options.primaryValue(for: course) {
                Text(primary)
                    .font(style.widgetFont(size: wide ? 12 : 10, weight: .bold))
                    .foregroundStyle(widgetColors.primary)
                    .lineLimit(titleLines)
            }
            if room, let detail = options.shortMetadata(for: course), detail != options.primaryValue(for: course) {
                Text(detail)
                    .font(style.widgetFont(size: wide ? 10 : 8, weight: .medium))
                    .foregroundStyle(widgetColors.secondary)
                    .lineLimit(1)
            }
            if time, options.showTime, course.startMinutes != nil {
                Text(wide ? course.timeRange : course.startLabel)
                    .font(style.timeFont(size: wide ? 10 : 8, weight: .semibold))
                    .foregroundStyle(inProgress ? widgetColors.accent(for: course, theme: theme, colorScheme: colorScheme) : widgetColors.secondary)
                    .lineLimit(1)
            }
        }
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
}
