import SwiftUI

/// One date of the overlay strip.
struct ScheduleOverlayStripPage: Hashable, Identifiable {
    let week: Int
    let day: Int
    /// "yyyy-MM-dd".
    let date: String
    var id: String { date }
}

/// What the strip draws for one date: both people's courses, ready to place.
struct ScheduleOverlayStripDay {
    let page: ScheduleOverlayStripPage
    let isToday: Bool
    /// "off" or "swap" when the date is adjusted.
    let adjustmentKind: String?
    let mine: [NativeScheduleCourseBlock]
    let theirs: [NativeScheduleCourseBlock]
}

/// Whose column of a day in the overlay strip.
enum ScheduleOverlayStripSide { case mine, theirs }

/// The overlay strip's measures, from the style of the week grid it replaces.
struct ScheduleOverlayStripMetrics: Equatable {
    var axisWidth: CGFloat
    var headerHeight: CGFloat
    var rowHeight: CGFloat
    var rowGap: CGFloat
    var slotCount: Int
    /// The room between two days.
    var dayGap: CGFloat
    /// The room between the two columns of a day.
    var columnGap: CGFloat
    /// Around the whole strip; the styled panel's breathing room.
    var panelPadding: CGFloat

    var gridHeight: CGFloat { CGFloat(slotCount) * rowHeight + CGFloat(max(0, slotCount - 1)) * rowGap }
    var height: CGFloat { headerHeight + gridHeight + 2 * panelPadding + 4 }
}

/// The week view while somebody else's timetable is laid over the user's (the
/// partner's, or a shared one): consecutive days side by side, each split into
/// the user's own column and a column of the other person's courses as hollow
/// outlined cards. The period axis stays put while the days slide past one at
/// a time, and the leftmost day is the browsing position the week title, the
/// arrows and 回到今天 follow. Ported from NapTable's `ScheduleOverlayStrip`.
@available(iOS 17.0, *)
struct ScheduleOverlayStrip<Axis: View, Column: View>: View {
    typealias Side = ScheduleOverlayStripSide
    typealias Metrics = ScheduleOverlayStripMetrics

    /// A phone held upright shows three days; a wider window up to seven.
    static func dayCount(width: CGFloat, axisWidth: CGFloat) -> Int {
        min(7, max(3, Int((width - axisWidth) / 96)))
    }

    /// The leftmost day for a selected date: that date, or the first shown
    /// after it. Near the end of term the strip stops at its last full screen.
    static func leadingIndex(for selection: String?, in pages: [ScheduleOverlayStripPage], count: Int) -> Int? {
        guard !pages.isEmpty else { return nil }
        let index = selection.flatMap { date in pages.firstIndex { $0.date >= date } } ?? pages.count - 1
        return max(0, min(index, pages.count - count))
    }

    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let pages: [ScheduleOverlayStripPage]
    /// The date the page has selected; the strip scrolls it to the left edge.
    let selection: String?
    /// The width the strip may take, its axis included.
    let width: CGFloat
    let metrics: Metrics
    /// Whose courses the second column holds, for its heading.
    let otherName: String
    let today: String?
    let showsNow: Bool
    /// Stands for everything the days are drawn from besides the page itself: the two
    /// timetables, the calendar and the display settings `day` and `column` read. A day
    /// already built is rebuilt only when this changes, not for every day slid past.
    let revision: AnyHashable
    let day: (ScheduleOverlayStripPage) -> ScheduleOverlayStripDay
    let axis: (ScheduleOverlayStripPage?) -> Axis
    let column: (ScheduleOverlayStripDay, Side, CGFloat) -> Column
    /// The user slid the strip: the new leftmost day.
    let onSelect: (ScheduleOverlayStripPage) -> Void
    let onOpenDay: (ScheduleOverlayStripPage) -> Void

    @State private var leading: String?
    /// A scroll the page asked for is under way: the days it passes are not
    /// the user's choice and are not reported back.
    @State private var followTarget: String?
    @State private var followTask: Task<Void, Never>?
    /// The day a swipe just reported. The page stores the weekday and the week
    /// one after the other, so for a moment the selection names this weekday
    /// of the old week (Monday 11.09 on the way from Sunday 11.15 to Monday
    /// 11.16); until the reported day comes back, other selections are those
    /// halfway states and must not scroll the strip.
    @State private var reported: String?
    @State private var reportedTask: Task<Void, Never>?
    /// The strip is still sliding: the day it rests on is reported once it has settled.
    @State private var settleTask: Task<Void, Never>?

    init(pages: [ScheduleOverlayStripPage], selection: String?, width: CGFloat, metrics: Metrics,
         otherName: String, today: String?, showsNow: Bool, revision: AnyHashable,
         day: @escaping (ScheduleOverlayStripPage) -> ScheduleOverlayStripDay,
         axis: @escaping (ScheduleOverlayStripPage?) -> Axis,
         column: @escaping (ScheduleOverlayStripDay, Side, CGFloat) -> Column,
         onSelect: @escaping (ScheduleOverlayStripPage) -> Void,
         onOpenDay: @escaping (ScheduleOverlayStripPage) -> Void) {
        self.pages = pages
        self.selection = selection
        self.width = width
        self.metrics = metrics
        self.otherName = otherName
        self.today = today
        self.showsNow = showsNow
        self.revision = revision
        self.day = day
        self.axis = axis
        self.column = column
        self.onSelect = onSelect
        self.onOpenDay = onOpenDay
        // Open on the selected day rather than scrolling there after the first frame.
        let count = Self.dayCount(width: width - 2 * metrics.panelPadding, axisWidth: metrics.axisWidth)
        _leading = State(initialValue: Self.leadingIndex(for: selection, in: pages, count: count).map { pages[$0].id })
    }

    private var innerWidth: CGFloat { width - 2 * metrics.panelPadding }
    private var count: Int { Self.dayCount(width: innerWidth, axisWidth: metrics.axisWidth) }
    private var dayWidth: CGFloat { (innerWidth - metrics.axisWidth) / CGFloat(count) }
    private var columnWidth: CGFloat { max(20, (dayWidth - metrics.dayGap - metrics.columnGap) / 2) }
    private var dark: Bool { colorScheme == .dark }
    private var leadingPage: ScheduleOverlayStripPage? {
        leading.flatMap { id in pages.first { $0.id == id } }
            ?? Self.leadingIndex(for: selection, in: pages, count: count).map { pages[$0] }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            axis(leadingPage)
                .frame(width: metrics.axisWidth, alignment: .top)
                .zIndex(1)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 0) {
                    ForEach(pages) { page in
                        // The stack keeps every day slid past, and this body runs again for each
                        // new leftmost day and each selection that follows it. Building a day (both
                        // people's courses, placed and merged) and its two columns every time made
                        // the slide stutter, more with every day passed: a day whose key is
                        // unchanged is skipped instead.
                        ScheduleOverlayStripColumnHost {
                            ScheduleOverlayStripDayItem(
                                key: .init(page: page, revision: revision, style: style, dark: dark, dayWidth: dayWidth,
                                           columnWidth: columnWidth, metrics: metrics, isToday: page.date == today,
                                           showsNow: showsNow, otherName: otherName),
                                content: { dayView(day(page)) }
                            )
                            .equatable()
                        }
                    }
                }
                .scrollTargetLayout()
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $leading, anchor: .leading)
            .frame(width: innerWidth - metrics.axisWidth)
        }
        .frame(width: innerWidth, height: metrics.headerHeight + metrics.gridHeight, alignment: .topLeading)
        .background(alignment: .topLeading) {
            if style == .minimal {
                ScheduleRowRules(headerHeight: metrics.headerHeight, rowHeight: metrics.rowHeight,
                                 slotCount: metrics.slotCount, leading: metrics.axisWidth)
            }
        }
        .overlay(alignment: .topLeading) { nowIndicator }
        .padding(metrics.panelPadding)
        .background {
            if style != .classic {
                ScheduleSurface(cornerRadius: 20, isPanel: true, showsBorder: style.framesPanel)
            }
        }
        .padding(.bottom, 4)
        .frame(width: width, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("schedule.overlay.strip")
        .onChange(of: leading) { _, value in
            if let target = followTarget {
                if value == target { endFollow() }
                return
            }
            guard let value, let index = pages.firstIndex(where: { $0.id == value }),
                  index != Self.leadingIndex(for: selection, in: pages, count: count) else {
                // Back where the selection already is: nothing to report.
                settleTask?.cancel()
                settleTask = nil
                return
            }
            reportWhenSettled(pages[index])
        }
        .onChange(of: selection) { _, _ in follow(animated: true) }
        .onChange(of: pages) { _, _ in follow(animated: false) }
        .onChange(of: count) { _, _ in follow(animated: false) }
        .onDisappear {
            endFollow()
            endReport()
            settleTask?.cancel()
            settleTask = nil
        }
    }

    // MARK: Following the page's selection

    /// The week changed by the arrows, the week list or 回到今天: scroll there.
    /// A selection that came from scrolling is already in place.
    private func follow(animated: Bool) {
        if let reported {
            // Waiting for the swiped-to day to come back as the selection.
            if Self.leadingIndex(for: selection, in: pages, count: count).map({ pages[$0].id }) == reported {
                endReport()
            }
            return
        }
        guard let index = Self.leadingIndex(for: selection, in: pages, count: count),
              leading != pages[index].id else { return }
        // The page chose a day itself: a day the strip was about to report gives way.
        settleTask?.cancel()
        settleTask = nil
        let target = pages[index].id
        guard animated, !reduceMotion, leading != nil else {
            endFollow()
            leading = target
            return
        }
        followTarget = target
        followTask?.cancel()
        followTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            endFollow()
            // A finger that stopped the scroll on the way decides where it ends.
            if let value = leading, value != target, let page = pages.first(where: { $0.id == value }) {
                report(page)
            }
        }
        withAnimation(.smooth) { leading = target }
    }

    /// A slide passes several days. Telling the page about each one redrew the whole
    /// timetable page under the moving strip; the day is reported once the leftmost
    /// day has stopped changing for a moment.
    private func reportWhenSettled(_ page: ScheduleOverlayStripPage) {
        settleTask?.cancel()
        settleTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(Self.settleMilliseconds))
            guard !Task.isCancelled else { return }
            settleTask = nil
            guard followTarget == nil, leading == page.id else { return }
            report(page)
        }
    }

    static var settleMilliseconds: Int { 140 }

    /// Hands a day the user scrolled to over to the page, and holds off
    /// following the selection until it has settled there (half a second at
    /// most, for a week that cannot be selected).
    private func report(_ page: ScheduleOverlayStripPage) {
        reported = page.id
        reportedTask?.cancel()
        reportedTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            endReport()
            follow(animated: true)
        }
        onSelect(page)
    }

    private func endReport() {
        reportedTask?.cancel()
        reportedTask = nil
        reported = nil
    }

    private func endFollow() {
        followTask?.cancel()
        followTask = nil
        followTarget = nil
    }

    // MARK: One day

    private func dayView(_ value: ScheduleOverlayStripDay) -> some View {
        VStack(spacing: 0) {
            header(value)
                .frame(height: metrics.headerHeight, alignment: .top)
            HStack(alignment: .top, spacing: metrics.columnGap) {
                column(value, .mine, columnWidth)
                    .frame(width: columnWidth, height: metrics.gridHeight, alignment: .top)
                column(value, .theirs, columnWidth)
                    .frame(width: columnWidth, height: metrics.gridHeight, alignment: .top)
            }
            .background(alignment: .topLeading) {
                if style == .table { tableRules(value) }
            }
            .overlay(alignment: .topLeading) {
                if value.isToday, showsNow {
                    TimelineView(.everyMinute) { context in
                        if let y = nowOffset(context.date) {
                            ScheduleNowLine(width: 2 * columnWidth + metrics.columnGap)
                                .offset(y: y)
                        }
                    }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            }
        }
        .padding(.horizontal, metrics.dayGap / 2)
        .background { if value.isToday { todayFill } }
        .overlay(alignment: .leading) {
            // The ruled styles have no gap between days; a rule marks where one ends.
            if style == .paper || style == .board {
                Rectangle().fill(style.inkColor(dark: dark).opacity(0.16)).frame(width: 0.5)
            }
        }
        .frame(width: dayWidth, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func header(_ value: ScheduleOverlayStripDay) -> some View {
        let page = value.page
        let label = [ScheduleStyleTime.weekday(page.day), Self.longDate(page.date),
                     value.adjustmentKind.map { $0 == "off" ? "休息" : "补班" }]
            .compactMap { $0 }.joined(separator: "，")
        let courses = value.mine.count + value.theirs.count
        Button { onOpenDay(page) } label: {
            Group {
                if style == .classic {
                    classicHeader(value)
                } else {
                    VStack(spacing: 0) {
                        ScheduleStyledDateHeader(day: page.day, date: ScheduleOverlayStripDate.dayOfMonth(page.date) ?? "–",
                                                 isToday: value.isToday, adjustmentKind: value.adjustmentKind)
                        legend
                            .frame(height: Self.legendHeight)
                            .padding(.bottom, 2)
                    }
                    .frame(height: metrics.headerHeight)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(courses > 0 ? "\(courses) 门课" : "没有课")
        .accessibilityHint("打开这一天的日视图")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("schedule-overlay-day-\(page.date)")
    }

    private static var legendHeight: CGFloat { 13 }

    /// The classic week header, one box over both columns of the day.
    private func classicHeader(_ value: ScheduleOverlayStripDay) -> some View {
        let page = value.page
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        let tint = value.isToday
            ? (dark ? NativeSchedulePalette.RGBA(0x9fd9cf).color : Color.cpuBrand)
            : NativeScheduleThemeColor.secondary(colorScheme)
        return VStack(spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(ScheduleStyleTime.weekday(page.day)).font(.system(size: 13, weight: .bold))
                Text(Self.shortDate(page.date)).font(.system(size: 11, weight: .semibold).monospacedDigit())
                if let kind = value.adjustmentKind {
                    ScheduleAdjustmentBadge(kind: kind).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                }
            }
            .foregroundStyle(tint)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            legend
                .frame(height: Self.legendHeight)
        }
        .frame(width: 2 * columnWidth + metrics.columnGap, height: metrics.headerHeight - 8)
        .background {
            NativeScheduleBackgroundSurface()
                .overlay { if value.isToday { Color.cpuBrand.opacity(dark ? 0.18 : 0.10) } }
                .clipShape(shape)
                .overlay {
                    shape.strokeBorder(value.isToday ? Color.cpuBrand : NativeScheduleThemeColor.cellBorder(colorScheme),
                                       lineWidth: 1)
                }
        }
        .frame(height: metrics.headerHeight, alignment: .top)
    }

    /// 「我」 over the user's column and the other person's name over theirs,
    /// each with a small solid or hollow mark like the cards below it.
    private var legend: some View {
        HStack(spacing: metrics.columnGap) {
            legendItem("我", hollow: false)
            legendItem(otherName.isEmpty ? "TA" : otherName, hollow: true)
        }
        .accessibilityHidden(true)
    }

    private func legendItem(_ text: String, hollow: Bool) -> some View {
        let ink = style == .classic ? NativeScheduleThemeColor.secondary(colorScheme) : style.inkColor(dark: dark).opacity(0.62)
        let mark = RoundedRectangle(cornerRadius: 1.5, style: .continuous)
        return HStack(spacing: 2.5) {
            Group {
                if hollow { mark.strokeBorder(ink, lineWidth: 1) } else { mark.fill(ink) }
            }
            .frame(width: 6, height: 6)
            Text(text)
                .font(.system(size: 9, weight: .semibold, design: style == .classic ? .default : style.textDesign))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .truncationMode(.tail)
        }
        .foregroundStyle(ink)
        .frame(width: columnWidth)
    }

    /// Today is one block from the header to the last period: both columns and the header together.
    @ViewBuilder
    private var todayFill: some View {
        switch style {
        case .classic:
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.cpuBrand.opacity(dark ? 0.12 : 0.07))
        case .paper:
            Rectangle().fill(style.styleAccent(dark: dark, fallback: .clear).opacity(dark ? 0.10 : 0.07))
        case .board, .table:
            Rectangle().fill(.themeTint(dark ? 0.16 : 0.09))
        default:
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.themeTint(ThemePalette.Surface.todayStrength(dark: dark)))
        }
    }

    /// The table's rules for one day: its frame, the line under the header,
    /// one between the two people, and one under each period except across a
    /// course that runs on.
    private func tableRules(_ value: ScheduleOverlayStripDay) -> some View {
        let step = metrics.rowHeight + metrics.rowGap
        let columns = [value.mine, value.theirs]
        let width = columnWidth
        let gap = metrics.columnGap
        return Canvas { context, size in
            var path = Path()
            path.addRect(CGRect(origin: .zero, size: size).insetBy(dx: 0.3, dy: 0.3))
            path.move(to: CGPoint(x: width + gap / 2, y: 0))
            path.addLine(to: CGPoint(x: width + gap / 2, y: size.height))
            for row in 1..<max(1, metrics.slotCount) {
                let y = CGFloat(row) * step - metrics.rowGap / 2
                for (index, blocks) in columns.enumerated()
                where !blocks.contains(where: { $0.startSlot <= row && row < $0.endSlot }) {
                    let x = CGFloat(index) * (width + gap)
                    path.move(to: CGPoint(x: x, y: y))
                    path.addLine(to: CGPoint(x: x + width, y: y))
                }
            }
            context.stroke(path, with: .color(.scheduleCellBorder(dark: dark)), lineWidth: 0.6)
        }
        .frame(width: 2 * width + gap, height: metrics.gridHeight)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    // MARK: Now

    private func nowOffset(_ date: Date) -> CGFloat? {
        ScheduleStyledWeekRows.nowOffset(ScheduleStyleTime.minutes(date),
                                         rows: Array(ScheduleSlot.all.prefix(metrics.slotCount)),
                                         rowHeight: metrics.rowHeight)
    }

    /// Fixed outside the scrolling days: the time on the axis and a faint line
    /// across every day on screen, so it stays in view while the days slide.
    /// Today's own line, inside its day, is drawn at full strength.
    @ViewBuilder
    private var nowIndicator: some View {
        if showsNow, let today, pages.contains(where: { $0.date == today }) {
            TimelineView(.everyMinute) { context in
                if let y = nowOffset(context.date) {
                    ZStack(alignment: .topLeading) {
                        Rectangle()
                            .fill(.themeText)
                            .opacity(0.28)
                            .frame(width: innerWidth - metrics.axisWidth, height: 1)
                            .offset(x: metrics.axisWidth, y: metrics.headerHeight + y - 0.5)
                        ScheduleNowBadge(minutes: ScheduleStyleTime.minutes(context.date))
                            .frame(width: metrics.axisWidth)
                            .offset(y: metrics.headerHeight + y - ScheduleNowBadge.height / 2)
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    // MARK: Dates

    /// "11.12".
    private static func shortDate(_ value: String) -> String {
        let pieces = value.split(separator: "-")
        guard pieces.count >= 3 else { return value }
        return "\(pieces[1]).\(pieces[2])"
    }

    /// "11月12日".
    private static func longDate(_ value: String) -> String? {
        let pieces = value.split(separator: "-")
        guard pieces.count >= 3, let month = Int(pieces[1]), let day = Int(pieces[2]) else { return nil }
        return "\(month)月\(day)日"
    }
}

/// "yyyy-MM-dd" pieces for the strip's headers and axis.
enum ScheduleOverlayStripDate {
    static func dayOfMonth(_ value: String) -> String? {
        let pieces = value.split(separator: "-")
        guard pieces.count >= 3, let day = Int(pieces[2]) else { return nil }
        return String(day)
    }

    static func month(_ value: String) -> String? {
        let pieces = value.split(separator: "-")
        guard pieces.count >= 3, let month = Int(pieces[1]) else { return nil }
        return "\(month)月"
    }
}

/// One day of the strip, built only when its key changes. `content` is not compared:
/// everything it reads is in the key (the page, the layout, the look) or stands
/// behind `revision`; what the columns take from the environment reaches them anyway.
@available(iOS 17.0, *)
private struct ScheduleOverlayStripDayItem<Content: View>: View, Equatable {
    struct Key: Equatable {
        let page: ScheduleOverlayStripPage
        let revision: AnyHashable
        let style: ScheduleStyle
        let dark: Bool
        let dayWidth: CGFloat
        let columnWidth: CGFloat
        let metrics: ScheduleOverlayStripMetrics
        let isToday: Bool
        let showsNow: Bool
        let otherName: String
    }

    let key: Key
    let content: () -> Content

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.key == rhs.key }

    var body: some View { content() }
}

/// A lazy stack keeps days that scrolled away, at their old places. Jumping
/// back to today, they came back inside the animation and flew in from there.
/// The update that brings a day back on screen is not animated.
@available(iOS 17.0, *)
private struct ScheduleOverlayStripColumnHost<Content: View>: View {
    @ViewBuilder var content: Content
    @State private var isOnScreen = false

    var body: some View {
        let isOnScreen = isOnScreen
        content
            .transaction { if !isOnScreen { $0.animation = nil } }
            .onAppear { self.isOnScreen = true }
            .onDisappear { self.isOnScreen = false }
    }
}

/// A course of the other person's in the strip: no fill of its own, only an
/// outline and lettering in the course's colour, so it reads apart from the
/// user's solid cards beside it. The shape and typeface follow the style.
@available(iOS 17.0, *)
struct ScheduleOverlayHollowTile: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scheduleHasBackground) private var hasBackground
    @Environment(\.schedulePalette) private var palette
    @Environment(\.scheduleWeekDisplay) private var display
    let course: NativeScheduleCourse
    /// "小鹿的课", for VoiceOver.
    let ownerTitle: String
    var showLocation = true
    /// A class both attend: a small heart in the corner.
    var together = false
    /// One of three or more side by side: the name and nothing else.
    var tiny = false

    private var dark: Bool { scheme == .dark }
    private var radius: CGFloat { style == .classic ? 9 : max(2, CGFloat(style.layout.cornerRadius)) }
    private var centered: Bool { style == .classic || style.layout.centered }
    private var color: ScheduleStyleCourseColor { ScheduleStyleCourseColor(name: course.name, palette: palette) }
    private var stroke: Color {
        NativeSchedulePalette.hsl(color.hue, min(80, color.saturation + 6), dark ? 66 : 52).color
    }
    /// Close to an empty cell's own surface, a little firmer over a photo so
    /// the name never sits on the picture.
    private var fill: Color {
        if hasBackground { return dark ? Color.black.opacity(0.34) : Color.white.opacity(0.66) }
        return dark ? Color.white.opacity(0.04) : Color.white.opacity(0.8)
    }
    /// Where the user's own cards are outlined too (classic, grid), the other
    /// person's outline is dashed so the two never read alike.
    private var dashed: Bool { style == .classic || style.layout.borderWidth > 0 }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        GeometryReader { geometry in
            let short = geometry.size.height < 64
            VStack(alignment: centered ? .center : .leading, spacing: 2) {
                Text(course.name)
                    .font(.system(size: (short ? 10 : 11) * display.textScale, weight: .bold,
                                  design: style == .classic ? .default : style.textDesign))
                    .lineLimit(short ? 2 : 4)
                    .minimumScaleFactor(0.85)
                    .layoutPriority(1)
                // Two side by side in a phone's column leave too little room for a room.
                if showLocation, !tiny, geometry.size.width >= 36,
                   let location = ScheduleStyleTime.location(course.location) {
                    Text("@\(location)")
                        .font(.system(size: 9 * display.textScale, weight: .semibold,
                                      design: style == .classic ? .default : style.textDesign))
                        .lineLimit(short ? 1 : 2)
                        .minimumScaleFactor(0.85)
                        .opacity(0.85)
                }
            }
            .multilineTextAlignment(centered ? .center : .leading)
            .foregroundStyle(color.accent(dark: dark))
            .padding(.horizontal, tiny ? 1 : 3)
            .padding(.top, together && !centered ? 8 : (short ? 3 : 5))
            .padding(.bottom, short ? 3 : 5)
            .frame(width: geometry.size.width, height: geometry.size.height,
                   alignment: centered ? .center : .topLeading)
        }
        .background {
            shape.fill(fill)
                .overlay { shape.fill(stroke.opacity(dark ? 0.10 : 0.05)) }
        }
        .overlay {
            shape.strokeBorder(stroke.opacity(dark ? 0.85 : 0.75),
                               style: StrokeStyle(lineWidth: 1.2, dash: dashed ? [4, 2.5] : []))
        }
        .overlay(alignment: .topTrailing) {
            if together { ScheduleCoupleHeart(size: 7).padding(3) }
        }
        .clipShape(shape)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([ownerTitle, together ? "一起上的课" : nil, course.name,
                             showLocation ? ScheduleStyleTime.location(course.location) : nil]
            .compactMap { $0 }.joined(separator: "，"))
    }
}

/// What the page's display settings contribute to a day of the strip, beside the data
/// counted by `ScheduleOverlayStripMemo.revision`. A change here rebuilds the days.
struct ScheduleOverlayStripRevision: Hashable {
    let data: Int
    let palette: String
    let showLocation: Bool
    let showTeacher: Bool
    let showPeriod: Bool
    let showWeeks: Bool
    let density: String
    let rowHeight: CGFloat
}

/// Keeps the overlay strip's dates and built days between two evaluations of the page
/// that holds it, for as long as what they are made from stays the same. The page's
/// body runs many times while the strip slides; working out a term of dates and both
/// people's courses for every day on each run is what made sliding stutter.
@available(iOS 17.0, *)
@MainActor
final class ScheduleOverlayStripMemo {
    /// Everything the strip's dates and days are computed from.
    struct Inputs: Equatable {
        let result: NativeScheduleResult
        let calendar: NativeScheduleCalendar?
        let layer: NativeCoupleLayer
        let occurrenceChanges: [NativeScheduleOccurrenceChange]?
        let priorities: [String: Int]
        let today: String?
        /// The weekend settings, which decide the dates the strip pages through.
        let weekend: [Bool]
    }

    private var inputs: Inputs?
    private var cachedPages: [ScheduleOverlayStripPage]?
    private var days: [String: ScheduleOverlayStripDay] = [:]
    /// Goes up each time the inputs change.
    private(set) var revision = 0

    func sync(_ next: Inputs) {
        guard next != inputs else { return }
        inputs = next
        revision += 1
        cachedPages = nil
        days = [:]
    }

    func pages(_ make: () -> [ScheduleOverlayStripPage]) -> [ScheduleOverlayStripPage] {
        if let cachedPages { return cachedPages }
        let made = make()
        cachedPages = made
        return made
    }

    func day(_ page: ScheduleOverlayStripPage, _ make: () -> ScheduleOverlayStripDay) -> ScheduleOverlayStripDay {
        if let day = days[page.id] { return day }
        let made = make()
        days[page.id] = made
        return made
    }
}
