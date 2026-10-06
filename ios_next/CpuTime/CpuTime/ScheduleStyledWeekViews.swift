import SwiftUI

// Week-grid components of the NapTable styles (minimal, grid, table, paper and
// board). Course lanes, calendar resolution and editing stay in
// NativeScheduleView; these views only draw what they are handed.

nonisolated enum ScheduleStyleTime {
    static func session(_ start: String) -> String {
        guard let minutes = scheduleClockMinutes(start) else { return "课程" }
        if minutes < 12 * 60 { return "上午" }
        return minutes < 18 * 60 ? "下午" : "晚上"
    }

    static func numeral(_ number: Int) -> String {
        let values = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
        guard number > 0, number < 100 else { return String(number) }
        if number < 10 { return values[number] }
        return (number < 20 ? "十" : values[number / 10] + "十") + (number % 10 == 0 ? "" : values[number % 10])
    }

    static func weekday(_ day: Int) -> String {
        let labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
        return labels.indices.contains(day - 1) ? labels[day - 1] : "周\(day)"
    }

    /// The room without a leading "@": some rows carry one already and the
    /// tiles add their own.
    static func location(_ raw: String?) -> String? {
        guard let location = raw?.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "@＠").union(.whitespaces)),
            !location.isEmpty else { return nil }
        return location
    }

    /// Minutes since midnight in the timetable's time zone.
    static func minutes(_ date: Date) -> Int {
#if DEBUG
        // `CPU_DEBUG_SCHEDULE_NOW=11:05` pins "now" so a state can be looked at on demand.
        if let pinned = ProcessInfo.processInfo.environment["CPU_DEBUG_SCHEDULE_NOW"].flatMap(scheduleClockMinutes) {
            return pinned
        }
#endif
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }
}

/// "08:00" → 480; nil when it cannot be parsed.
nonisolated func scheduleClockMinutes(_ value: String) -> Int? {
    let parts = value.split(separator: ":").compactMap { Int($0) }
    return parts.count >= 2 ? parts[0] * 60 + parts[1] : nil
}

/// The 休 / 班 badge beside a date. Opaque fills with white text, the same in
/// both appearances.
@available(iOS 17.0, *)
struct ScheduleAdjustmentBadge: View {
    static let size: CGFloat = 12
    static let offColor = Color(.sRGB, red: 0xE1 / 255, green: 0x1D / 255, blue: 0x48 / 255, opacity: 1)
    static let swapColor = Color(.sRGB, red: 0xC2 / 255, green: 0x41 / 255, blue: 0x0C / 255, opacity: 1)

    /// "off" or "swap".
    let kind: String

    var body: some View {
        Text(kind == "off" ? "休" : "班")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(.white)
            .fixedSize()
            .frame(width: Self.size, height: Self.size, alignment: .center)
            .offset(x: 0.2)
            .background(kind == "off" ? Self.offColor : Self.swapColor,
                        in: RoundedRectangle(cornerRadius: 3, style: .continuous))
            .accessibilityHidden(true)
    }
}

@available(iOS 17.0, *)
struct ScheduleStyledAdjustmentMark: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    let kind: String

    var body: some View {
        if style == .paper || style == .board {
            // A solid seal for a day off, an outlined one for a make-up day.
            let dark = scheme == .dark
            let ink = style.styleAccent(dark: dark, fallback: .primary)
            let canvas = style.canvasColor(dark: dark) ?? .white
            Text(kind == "off" ? "休" : "班")
                .font(.system(size: 9, weight: .bold, design: style.fontDesign))
                .foregroundStyle(kind == "off" ? canvas : ink)
                .frame(width: 13, height: 13)
                .background(kind == "off" ? ink : .clear)
                .overlay { Rectangle().strokeBorder(ink, lineWidth: 1) }
                .accessibilityHidden(true)
        } else {
            ScheduleAdjustmentBadge(kind: kind)
        }
    }
}

@available(iOS 17.0, *)
struct ScheduleStyledDateHeader: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scheduleThemeBrand) private var brand
    @Environment(\.scheduleStaticRendering) private var staticRendering
    let day: Int
    let date: String
    let isToday: Bool
    let adjustmentKind: String?
    var selected = false

    private var today: Bool { isToday && !staticRendering }
    private var dark: Bool { scheme == .dark }
    private var accent: Color { style.styleAccent(dark: dark, fallback: ThemePalette.of(brand).text(dark: dark)) }
    private var inverse: Bool { style == .table && (today || selected) }
    private var ink: Color {
        inverse ? ThemePalette.of(brand).onFill(dark: dark) : (today ? accent : style.inkColor(dark: dark))
    }

    var body: some View {
        VStack(spacing: 3) {
            if style == .grid {
                Text(["一", "二", "三", "四", "五", "六", "日"][max(0, min(6, day - 1))])
                    .font(.system(size: 16, weight: .bold, design: style.fontDesign))
            } else {
                Text(today ? (style == .paper ? "今日" : "今天") : ScheduleStyleTime.weekday(day))
                    .font(.system(size: 11, weight: .semibold, design: style.fontDesign))
            }
            HStack(spacing: 2) {
                Text(date)
                    .font(.system(size: style == .paper ? 15 : 11, weight: .medium, design: style.fontDesign))
                    .monospacedDigit()
                    .padding(.horizontal, style == .paper ? 4 : 0)
                    .overlay { if style == .paper && today { Capsule().stroke(accent, lineWidth: 1) } }
                if let adjustmentKind { ScheduleStyledAdjustmentMark(kind: adjustmentKind) }
            }
        }
        .foregroundStyle(ink)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            if inverse { Rectangle().fill(.themeFill) }
            else if selected { Rectangle().fill(accent.opacity(dark ? 0.16 : 0.08)) }
        }
        .overlay(alignment: .bottom) {
            if style == .board && (today || selected) { Rectangle().fill(accent).frame(height: 3) }
        }
    }
}

/// One empty period of a styled week column, on the shared row pitch.
@available(iOS 17.0, *)
struct ScheduleStyledWeekCell: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scheduleHasBackground) private var hasBackground
    let today: Bool
    let holiday: Bool
    let startsSession: Bool
    /// A course tile covers the whole cell. Dark fills are translucent, so a
    /// cell left underneath would show through the tile.
    var covered = false
    /// The course here runs on into the next period.
    var joinsBelow = false
    /// The course here began in an earlier period.
    var joinsAbove = false
    /// The last period of the column.
    var closesColumn = false

    var body: some View {
        let dark = scheme == .dark
        switch style.layout.grid {
        case .cells:
            if covered {
                Color.clear
            } else {
                RoundedRectangle(cornerRadius: style.layout.cornerRadius)
                    .fill(.scheduleCellSurface(hasBackground: hasBackground, dark: dark))
                    .overlay {
                        if today { RoundedRectangle(cornerRadius: style.layout.cornerRadius).fill(.themeTint(0.12)) }
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: style.layout.cornerRadius)
                            .strokeBorder(.scheduleCellBorder(dark: dark),
                                          style: StrokeStyle(lineWidth: 1, dash: holiday ? [3, 3] : []))
                    }
            }
        case .table:
            // `ScheduleTableRules` strokes every shared edge once for the whole table.
            Rectangle().fill(today ? AnyShapeStyle(.themeTint(0.08)) : AnyShapeStyle(Color.clear))
        case .sessions:
            // The heavy rule between morning, afternoon and evening always runs
            // through; the hairline is left out inside a multi-period course.
            Color.clear.overlay(alignment: .top) {
                if startsSession || !joinsAbove {
                    Rectangle().fill(style.inkColor(dark: dark).opacity(startsSession ? 0.65 : 0.12))
                        .frame(height: startsSession ? 2 : 0.5)
                }
            }
        case .rows:
            Color.clear.overlay(alignment: .bottom) {
                if !joinsBelow && !closesColumn {
                    Rectangle().fill(style.inkColor(dark: dark).opacity(0.16)).frame(height: 0.5)
                }
            }
        }
    }
}

@available(iOS 17.0, *)
struct ScheduleStyledCourseTile: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scheduleHasBackground) private var hasBackground
    @Environment(\.scheduleStaticRendering) private var staticRendering
    @Environment(\.scheduleThemeBrand) private var brand
    @Environment(\.schedulePalette) private var palette
    let course: NativeScheduleCourse
    var compact = false
    var start: String? = nil
    var current = false
    var showLocation = true
    var trailingInset: CGFloat = 0
    /// A full-width row of the day view: reading size, leading, centred vertically.
    var dayRow = false

    private var dark: Bool { scheme == .dark }
    private var centered: Bool { style.layout.centered && !dayRow }
    private var tint: ScheduleStyleCourseColor { ScheduleStyleCourseColor(name: course.name, palette: palette) }
    private var accent: Color { tint.accent(dark: dark) }
    private var inverse: Bool { style == .board && current && !staticRendering }
    private var ink: Color {
        if inverse { return style.canvasColor(dark: dark) ?? .white }
        return style == .paper || style == .board ? style.inkColor(dark: dark) : accent
    }
    /// The course-colour bar on the leading edge; the text clears it by the same amount.
    private var stripeWidth: CGFloat {
        switch style.layout.course {
        case .stripe: 3
        case .ink: 2
        case .card, .departure: 0
        }
    }
    /// The board has no fill and no bar, so a small course-colour mark sits
    /// beside the start time. The inverted tile takes the other scheme's colour.
    private var mark: Color { inverse ? tint.accent(dark: !dark) : accent }

    var body: some View {
        GeometryReader { geometry in
            let short = geometry.size.height < 64
            let small = compact || short
            VStack(alignment: centered ? .center : .leading, spacing: small ? 2 : 4) {
                if style.layout.course == .departure {
                    HStack(spacing: 3) {
                        RoundedRectangle(cornerRadius: 1).fill(mark)
                            .frame(width: small ? 5 : 7, height: small ? 5 : 7)
                        if let start {
                            Text(start).font(.system(size: small ? 10 : 14, weight: .heavy, design: .monospaced))
                                .lineLimit(1).minimumScaleFactor(0.7)
                        }
                    }
                }
                Text(course.name)
                    .font(.system(size: dayRow ? 15 : (small ? 11 : 13), weight: .semibold, design: style.fontDesign))
                    .lineLimit(dayRow ? (short ? 1 : 2) : (short ? 2 : (compact ? 4 : 3)))
                    .minimumScaleFactor(0.8)
                    .layoutPriority(1)
                if showLocation, let location = ScheduleStyleTime.location(course.location) {
                    Text("@\(location)")
                        .font(.system(size: dayRow ? 12 : (small ? 9 : 11), weight: .medium, design: style.fontDesign))
                        .lineLimit(short || dayRow ? 1 : 2)
                        .minimumScaleFactor(0.8)
                }
            }
            .multilineTextAlignment(centered ? .center : .leading)
            .foregroundStyle(ink)
            .padding(.trailing, trailingInset)
            .padding(.leading, stripeWidth)
            .padding(.horizontal, dayRow ? 12 : (small ? 4 : 7))
            .padding(.vertical, short ? 3 : 6)
            .frame(width: geometry.size.width, height: geometry.size.height,
                   alignment: centered ? .center : (dayRow ? .leading : .topLeading))
        }
        .background {
            if inverse { Rectangle().fill(style.inkColor(dark: dark)) }
            else if style.layout.course == .card || style.layout.course == .stripe {
                Rectangle().fill(tint.fill(dark: dark, hasBackground: hasBackground))
            } else if style.layout.course == .ink {
                // Paper keeps its ink text; the course colour is only a faint wash.
                Rectangle().fill(tint.fill(dark: dark, hasBackground: hasBackground).opacity(0.7))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: style.layout.cornerRadius))
        .overlay(alignment: .leading) {
            if stripeWidth > 0 { Rectangle().fill(accent).frame(width: stripeWidth) }
        }
        .overlay {
            if style.layout.borderWidth > 0 {
                RoundedRectangle(cornerRadius: style.layout.cornerRadius)
                    .strokeBorder(current && !staticRendering ? ThemePalette.of(brand).text(dark: dark) : accent,
                                  lineWidth: current && !staticRendering ? 2 : style.layout.borderWidth)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The minimal style's week card: a borderless pale tint, text at the top leading corner.
@available(iOS 17.0, *)
struct ScheduleMinimalCourseCard: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scheduleHasBackground) private var hasBackground
    @Environment(\.schedulePalette) private var palette
    let course: NativeScheduleCourse
    var compact = false
    var showLocation = true

    static let cornerRadius: CGFloat = 9

    var body: some View {
        let tint = ScheduleStyleCourseColor(name: course.name, palette: palette)
        GeometryReader { geometry in
            let short = geometry.size.height < 64
            let small = compact || short
            VStack(alignment: .leading, spacing: small ? 2 : 4) {
                Text(course.name)
                    .font(.system(size: small ? 11 : 13, weight: .semibold))
                    .lineLimit(short ? 2 : (compact ? 4 : 3))
                    .minimumScaleFactor(0.85)
                    .layoutPriority(1)
                if showLocation, let location = ScheduleStyleTime.location(course.location) {
                    Text("@\(location)")
                        .font(.system(size: small ? 9 : 11, weight: .medium))
                        .lineLimit(short ? 1 : 2)
                        .minimumScaleFactor(0.85)
                }
            }
            .multilineTextAlignment(.leading)
            .foregroundStyle(tint.accent(dark: scheme == .dark))
            .padding(.horizontal, compact ? 4 : 7)
            .padding(.vertical, short ? 4 : 6)
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
        }
        .background {
            RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                .fill(tint.fill(dark: scheme == .dark, hasBackground: hasBackground))
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

@available(iOS 17.0, *)
struct ScheduleStyledSlotLabel: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    let slot: ScheduleSlot
    var startsSession = false

    var body: some View {
        VStack(spacing: style == .minimal ? 3 : 1) {
            if style == .minimal {
                Text("\(slot.number)")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.primary)
                Text(slot.start)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.scheduleMeta)
            } else if style == .board {
                if startsSession { Text(ScheduleStyleTime.session(slot.start)).font(.system(size: 8, weight: .bold)) }
                Text(slot.start).font(.system(size: 12, weight: .bold, design: .monospaced))
                Text("第\(slot.number)节").font(.system(size: 8))
            } else {
                Text(style == .paper ? ScheduleStyleTime.numeral(slot.number) : String(slot.number))
                    .font(.system(size: style == .paper ? 12 : 13, weight: .bold, design: style.fontDesign))
                Text(slot.start).font(.system(size: 9, design: style.fontDesign))
                Text(slot.end).font(.system(size: 9, design: style.fontDesign))
            }
        }
        .monospacedDigit()
        .foregroundStyle(style.inkColor(dark: scheme == .dark))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("第 \(slot.number) 节，\(slot.start) 至 \(slot.end)")
    }
}

/// Diagonal hatching for a day off in the table style. A grey column already
/// means "weekend", so a holiday needs a mark of its own.
@available(iOS 17.0, *)
struct ScheduleHolidayHatch: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Canvas { context, size in
            var path = Path()
            var x = -size.height
            while x < size.width {
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x + size.height, y: 0))
                x += 6
            }
            context.stroke(path, with: .color(.scheduleCellBorder(dark: scheme == .dark)), lineWidth: 0.6)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The one set of rules for the table style: every shared edge stroked once.
/// A rule that would cross a course spanning several periods is left out.
@available(iOS 17.0, *)
struct ScheduleTableRules: View {
    @Environment(\.colorScheme) private var scheme
    let headerHeight: CGFloat
    let rowHeight: CGFloat
    let slotCount: Int
    let axisWidth: CGFloat
    let columnWidth: CGFloat
    let dayCount: Int
    /// Whether one course covers both sides of the rule above `row` (zero-based) in day `column`.
    var joined: (_ column: Int, _ row: Int) -> Bool = { _, _ in false }

    var body: some View {
        Canvas { context, size in
            let lineWidth: CGFloat = 0.6
            var path = Path()
            path.addRect(CGRect(origin: .zero, size: size).insetBy(dx: lineWidth / 2, dy: lineWidth / 2))
            for index in 0..<dayCount {
                let x = axisWidth + CGFloat(index) * columnWidth
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: size.height))
            }
            for row in 0..<max(1, slotCount) {
                let y = headerHeight + CGFloat(row) * (rowHeight + NativeScheduleStyledDayColumn.slotGap)
                if axisWidth > 0 {
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: axisWidth, y: y))
                }
                for column in 0..<dayCount where !joined(column, row) {
                    let x = axisWidth + CGFloat(column) * columnWidth
                    path.move(to: CGPoint(x: x, y: y))
                    path.addLine(to: CGPoint(x: x + columnWidth, y: y))
                }
            }
            context.stroke(path, with: .color(.scheduleCellBorder(dark: scheme == .dark)), lineWidth: lineWidth)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The minimal style's hairlines between periods, right of the period axis.
@available(iOS 17.0, *)
struct ScheduleRowRules: View {
    @Environment(\.colorScheme) private var colorScheme
    let headerHeight: CGFloat
    let rowHeight: CGFloat
    let slotCount: Int
    let leading: CGFloat

    var body: some View {
        let step = rowHeight + NativeScheduleStyledDayColumn.slotGap
        let color = Color.scheduleCellBorder(dark: colorScheme == .dark)
        Canvas { context, size in
            var path = Path()
            var lines: [CGFloat] = headerHeight > 0 ? [headerHeight - 0.5] : []
            for index in 1..<max(1, slotCount) {
                lines.append(headerHeight + CGFloat(index) * step - NativeScheduleStyledDayColumn.slotGap / 2)
            }
            for y in lines {
                path.move(to: CGPoint(x: leading, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
            }
            context.stroke(path, with: .color(color), lineWidth: 0.33)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// "Now" on the period axis: the current time in a theme-colour capsule.
@available(iOS 17.0, *)
struct ScheduleNowBadge: View {
    static let height: CGFloat = 16
    let minutes: Int

    var body: some View {
        Text(String(format: "%d:%02d", minutes / 60, minutes % 60))
            .font(.system(size: 10, weight: .semibold, design: .rounded).monospacedDigit())
            .foregroundStyle(.themeOnFill)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 4)
            .frame(height: Self.height)
            .background(.themeFill, in: Capsule())
    }
}

/// "Now" across today's column: a theme-colour line with a dot at its leading end.
@available(iOS 17.0, *)
struct ScheduleNowLine: View {
    let width: CGFloat

    var body: some View {
        ZStack(alignment: .leading) {
            Rectangle().fill(.themeText).frame(width: width, height: 1.5)
            Circle().fill(.themeFill).frame(width: 7, height: 7).offset(x: -3.5)
        }
        .frame(width: width, height: 7, alignment: .leading)
        .offset(y: -3.5)
    }
}

/// One day of a styled week grid, and the grid column of the styled day view.
@available(iOS 17.0, *)
struct NativeScheduleStyledDayColumn: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleStaticRendering) private var staticRendering
    static let slotGap: CGFloat = 3
    static let dateHeaderHeight: CGFloat = 48

    let day: Int
    let dateText: String?
    /// The header date: the day of the month, with the month on the period axis.
    var headerDateText: String? = nil
    let isToday: Bool
    /// "off" or "swap" when the date is adjusted.
    var adjustmentKind: String? = nil
    let columnWidth: CGFloat
    let rowHeight: CGFloat
    var slotCount: Int = ScheduleSlot.all.count
    var clocks: [ScheduleSlot] = ScheduleSlot.all
    let compactCards: Bool
    let showsDateHeader: Bool
    let blocks: [NativeScheduleCourseBlock]
    var showLocation = true
    let onCourseSelected: (NativeScheduleCourseBlock) -> Void
    let onEmptySlot: (Int) -> Void
    var nowMinutes: Int? = nil
    var dayPresentation = false
    var completedBeforeMinutes: Int? = nil

    private var marksToday: Bool { isToday && !staticRendering }

    /// Lane count of each card's overlap cluster. Courses that overlap, directly
    /// or through a chain, share the width; everything else stays full width.
    private var clusterLaneCounts: [String: Int] {
        var counts: [String: Int] = [:]
        var cluster: [NativeScheduleCourseBlock] = []
        var clusterEnd = Int.min
        func flush() {
            let lanes = max(1, (cluster.map(\.lane).max() ?? 0) + 1)
            for block in cluster { counts[block.id] = lanes }
            cluster.removeAll()
        }
        for block in blocks.sorted(by: { ($0.startSlot, $0.endSlot) < ($1.startSlot, $1.endSlot) }) {
            if !cluster.isEmpty && block.startSlot > clusterEnd { flush() }
            cluster.append(block)
            clusterEnd = cluster.count == 1 ? block.endSlot : max(clusterEnd, block.endSlot)
        }
        flush()
        return counts
    }

    private var rows: [ScheduleSlot] { Array(clocks.prefix(slotCount)) }

    private var columnHeight: CGFloat {
        CGFloat(slotCount) * rowHeight + CGFloat(max(0, slotCount - 1)) * Self.slotGap
    }

    private var headerAccessibilityLabel: String {
        let base = [ScheduleStyleTime.weekday(day), dateText].compactMap { $0 }.joined(separator: " ")
        guard let adjustmentKind else { return base }
        return "\(base)，\(adjustmentKind == "off" ? "休息" : "补班")"
    }

    var body: some View {
        let laneCounts = clusterLaneCounts
        VStack(spacing: 0) {
            if showsDateHeader {
                Group {
                    if style == .minimal { minimalHeader } else {
                        ScheduleStyledDateHeader(day: day, date: headerDateText ?? dateText ?? "–",
                                                 isToday: marksToday, adjustmentKind: adjustmentKind)
                    }
                }
                .frame(width: columnWidth, height: Self.dateHeaderHeight)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(headerAccessibilityLabel)
            }
            ZStack(alignment: .topLeading) {
                emptyCells(laneCounts)
                // Only the grid style runs the "now" line beneath its course
                // tiles; the others draw it above the courses for the whole row.
                if style == .grid, let nowMinutes, marksToday, let now = nowPosition(nowMinutes) {
                    ForEach(Array(nowSegments(now.slots, laneCounts).enumerated()), id: \.offset) { _, segment in
                        Rectangle().fill(.themeText).frame(width: segment.width, height: 1.5)
                            .offset(x: segment.x, y: now.y).allowsHitTesting(false).accessibilityHidden(true)
                    }
                }
                ForEach(blocks) { block in course(block, lanes: laneCounts[block.id] ?? 1) }
            }
            .frame(width: columnWidth, height: columnHeight)
            .contentShape(Rectangle())
            // Resolve the tapped point against the drawn frames so a course
            // always wins over the empty period beneath it.
            .highPriorityGesture(
                SpatialTapGesture().onEnded { value in
                    if let block = block(at: value.location, laneCounts) {
                        onCourseSelected(block)
                    } else if let slot = slot(at: value.location) {
                        onEmptySlot(slot)
                    }
                }
            )
        }
        .frame(width: columnWidth)
        .background { columnBackground }
    }

    private var minimalHeader: some View {
        // The day of the month above, the weekday below; today takes the theme colour.
        VStack(spacing: 3) {
            Text(headerDateText ?? dateText ?? "–")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(marksToday ? AnyShapeStyle(.themeText) : AnyShapeStyle(.primary))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(maxWidth: max(0, columnWidth - 6))
            Text(marksToday ? "今天" : ScheduleStyleTime.weekday(day))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(marksToday ? AnyShapeStyle(.themeText) : AnyShapeStyle(.secondary))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.top, ScheduleAdjustmentBadge.size)
        .frame(width: columnWidth, height: Self.dateHeaderHeight)
        .overlay(alignment: .topTrailing) {
            if let adjustmentKind { ScheduleAdjustmentBadge(kind: adjustmentKind).padding(.trailing, 2) }
        }
    }

    @ViewBuilder
    private var columnBackground: some View {
        switch style {
        case .minimal:
            if marksToday {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.themeTint(ThemePalette.Surface.todayStrength(dark: colorScheme == .dark)))
                    .allowsHitTesting(false)
            }
        case .table:
            // A holiday column is hatched and a weekend one greyed; a weekend
            // worked as a make-up day stays plain.
            if adjustmentKind == "off" {
                ScheduleHolidayHatch().padding(.top, showsDateHeader ? Self.dateHeaderHeight : 0)
            } else if day >= 6 && adjustmentKind != "swap" {
                Color.primary.opacity(0.035)
            }
        case .paper:
            if marksToday {
                style.styleAccent(dark: colorScheme == .dark, fallback: .clear)
                    .opacity(colorScheme == .dark ? 0.10 : 0.07)
            }
        default:
            EmptyView()
        }
    }

    private func emptyCells(_ laneCounts: [String: Int]) -> some View {
        let rows = rows
        return VStack(spacing: style == .table ? 0 : Self.slotGap) {
            ForEach(rows, id: \.number) { slot in
                let covering = blocks.filter { $0.startSlot <= slot.number && slot.number <= $0.endSlot }
                let occupied = !covering.isEmpty
                // Side-by-side courses that do not fill the row leave the rest of the cell showing.
                let covered = occupied && Set(covering.map(\.lane)).count >= (laneCounts[covering[0].id] ?? 1)
                let previous = rows.first { $0.number == slot.number - 1 }
                Group {
                    if style == .minimal {
                        Color.clear
                    } else {
                        ScheduleStyledWeekCell(
                            today: marksToday, holiday: adjustmentKind == "off",
                            startsSession: previous.map {
                                ScheduleStyleTime.session($0.start) != ScheduleStyleTime.session(slot.start)
                            } ?? true,
                            covered: covered, joinsBelow: covering.contains { $0.endSlot > slot.number },
                            joinsAbove: covering.contains { $0.startSlot < slot.number },
                            closesColumn: slot.number == rows.last?.number)
                    }
                }
                .frame(width: columnWidth,
                       height: rowHeight + (style == .table && slot.number != rows.last?.number ? Self.slotGap : 0))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("第 \(slot.number) 节，空节次")
                .accessibilityHint("轻点添加课程")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { onEmptySlot(slot.number) }
                .accessibilityHidden(occupied)
            }
        }
    }

    /// Grid tiles are the cell itself, the same size as the empty cells beside
    /// them; table tiles sit just inside the rules; the rest keep 1pt all round.
    private func inset(lanes: Int) -> CGFloat {
        style == .table ? 0.5 : (style == .grid && lanes == 1 ? 0 : 1)
    }

    private func frame(of block: NativeScheduleCourseBlock, lanes: Int) -> CGRect {
        let inset = inset(lanes: lanes)
        // Table rules sit at the top of each period, so a tile reaches across the row gap to the next one.
        let reach = style == .table && block.endSlot < slotCount ? Self.slotGap : 0
        let height = CGFloat(block.endSlot - block.startSlot + 1) * rowHeight
            + CGFloat(block.endSlot - block.startSlot) * Self.slotGap + reach - inset * 2
        return CGRect(
            x: inset + CGFloat(block.lane) * columnWidth / CGFloat(lanes),
            y: CGFloat(block.startSlot - 1) * (rowHeight + Self.slotGap) + inset,
            width: max(12, columnWidth / CGFloat(lanes) - inset * 2),
            height: max(34, height)
        )
    }

    private func course(_ block: NativeScheduleCourseBlock, lanes: Int) -> some View {
        let frame = frame(of: block, lanes: lanes)
        let status = ScheduleStyledDayStatus(clocks: clocks, now: staticRendering ? nil : nowMinutes,
                                             completedBefore: staticRendering ? nil : completedBeforeMinutes)
        let label = dayPresentation && lanes == 1 ? status.label(block) : nil
        let narrow = compactCards || columnWidth / CGFloat(lanes) < 70
        return ZStack(alignment: .trailing) {
            if style == .minimal {
                ScheduleMinimalCourseCard(course: block.course, compact: narrow, showLocation: showLocation)
            } else {
                ScheduleStyledCourseTile(course: block.course, compact: narrow,
                                         start: clocks.first { $0.number == block.startSlot }?.start,
                                         current: status.phase(block) == .current,
                                         showLocation: showLocation,
                                         trailingInset: label != nil ? 80 : 0,
                                         dayRow: dayPresentation)
            }
            if let label, style != .minimal {
                Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(.themeText)
                    .multilineTextAlignment(.trailing).frame(width: 76, alignment: .trailing).padding(.trailing, 10)
            }
        }
        .frame(width: frame.width, height: frame.height)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel(block) + (status.label(block).map { "，" + $0 } ?? ""))
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("轻点查看课程详情")
        .accessibilityAction { onCourseSelected(block) }
        .offset(x: frame.minX, y: frame.minY)
    }

    private func block(at point: CGPoint, _ laneCounts: [String: Int]) -> NativeScheduleCourseBlock? {
        blocks.reversed().first { frame(of: $0, lanes: laneCounts[$0.id] ?? 1).contains(point) }
    }

    private func slot(at point: CGPoint) -> Int? {
        guard point.y >= 0 else { return nil }
        let index = Int(floor(point.y / (rowHeight + Self.slotGap)))
        let rows = rows
        return rows.indices.contains(index) ? rows[index].number : nil
    }

    /// Where the "now" line sits and which periods it lies on: the period in
    /// class, or the two around a break.
    private func nowPosition(_ current: Int) -> (y: CGFloat, slots: ClosedRange<Int>)? {
        for (index, slot) in rows.enumerated() {
            guard let start = scheduleClockMinutes(slot.start), let end = scheduleClockMinutes(slot.end),
                  end > start else { continue }
            if current < start {
                return index == 0 ? nil
                    : (CGFloat(index) * (rowHeight + Self.slotGap) - Self.slotGap / 2, (slot.number - 1)...slot.number)
            }
            if current <= end {
                return (CGFloat(index) * (rowHeight + Self.slotGap)
                            + rowHeight * CGFloat(current - start) / CGFloat(end - start),
                        slot.number...slot.number)
            }
        }
        return nil
    }

    /// The line is drawn only where no course covers it: dark course fills are
    /// translucent, and a line beneath one would show through over the name.
    private func nowSegments(_ slots: ClosedRange<Int>, _ laneCounts: [String: Int]) -> [(x: CGFloat, width: CGFloat)] {
        let covering = blocks.filter { $0.startSlot <= slots.lowerBound && slots.upperBound <= $0.endSlot }
        guard let first = covering.first else { return [(0, columnWidth)] }
        let lanes = laneCounts[first.id] ?? 1
        let width = columnWidth / CGFloat(lanes)
        return (0..<lanes).filter { lane in !covering.contains { $0.lane == lane } }
            .map { (CGFloat($0) * width, width) }
    }

    /// "高等数学，教室 A101，周一 第1–2节 08:00 至 09:40"
    private func accessibilityLabel(_ block: NativeScheduleCourseBlock) -> String {
        let slots = block.startSlot == block.endSlot ? "第\(block.startSlot)节" : "第\(block.startSlot)–\(block.endSlot)节"
        let start = clocks.first { $0.number == block.startSlot }?.start
        let end = clocks.first { $0.number == block.endSlot }?.end
        let time = start.flatMap { start in end.map { "\(start) 至 \($0)" } }
        return [block.course.name,
                ScheduleStyleTime.location(block.course.location).map { "教室 \($0)" },
                [ScheduleStyleTime.weekday(day), slots, time].compactMap { $0 }.joined(separator: " ")]
            .compactMap { $0 }
            .joined(separator: "，")
    }
}

/// What one day column of a styled week needs.
struct ScheduleStyledDay: Identifiable {
    let day: Int
    let dateText: String?
    /// "yyyy-MM-dd".
    let rawDate: String?
    let isToday: Bool
    let adjustmentKind: String?
    let blocks: [NativeScheduleCourseBlock]

    var id: Int { day }
}

/// The styled week grid: period axis, day columns, the style's rules and the
/// "now" indicator. Laid out on the same row pitch as the classic grid.
@available(iOS 17.0, *)
struct ScheduleStyledWeekRows: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.scheduleStaticRendering) private var staticRendering
    static let axisWidth: CGFloat = 42
    /// The breathing room between the panel and its first row and last column.
    static let panelPadding: CGFloat = 6

    let days: [ScheduleStyledDay]
    let columnWidth: CGFloat
    let rowHeight: CGFloat
    var slotCount: Int = ScheduleSlot.all.count
    var clocks: [ScheduleSlot] = ScheduleSlot.all
    let compactCards: Bool
    let showsDateHeader: Bool
    var showLocation = true
    var showsNow = true
    let onCourseSelected: (ScheduleStyledDay, NativeScheduleCourseBlock) -> Void
    let onEmptySlot: (ScheduleStyledDay, Int) -> Void

    /// The table's rules run along the panel edge, so it takes no padding.
    static func panelPadding(for style: ScheduleStyle) -> CGFloat { style == .table ? 0 : panelPadding }

    static func height(rowHeight: CGFloat, slotCount: Int, showsDateHeader: Bool, style: ScheduleStyle) -> CGFloat {
        (showsDateHeader ? NativeScheduleStyledDayColumn.dateHeaderHeight : 0)
            + CGFloat(slotCount) * rowHeight
            + CGFloat(max(0, slotCount - 1)) * NativeScheduleStyledDayColumn.slotGap
            + 2 * panelPadding(for: style)
    }

    /// The width left for each day once the axis, gaps and panel padding are taken out.
    static func columnWidth(contentWidth: CGFloat, dayCount: Int, style: ScheduleStyle) -> CGFloat {
        let count = CGFloat(max(1, dayCount))
        return max(24, (contentWidth - 2 * panelPadding(for: style) - axisWidth - count * CGFloat(style.columnGap)) / count)
    }

    private var gap: CGFloat { CGFloat(style.columnGap) }
    private var headerHeight: CGFloat { showsDateHeader ? NativeScheduleStyledDayColumn.dateHeaderHeight : 0 }
    private var tracksNow: Bool { showsNow && !staticRendering && days.contains { $0.isToday } }

    var body: some View {
        Group {
            if tracksNow {
                TimelineView(.everyMinute) { context in content(now: ScheduleStyleTime.minutes(context.date)) }
            } else {
                content(now: nil)
            }
        }
        .padding(Self.panelPadding(for: style))
        .background { ScheduleSurface(cornerRadius: 20, isPanel: true, showsBorder: style.framesPanel) }
    }

    private func content(now: Int?) -> some View {
        let rows = Array(clocks.prefix(slotCount))
        return HStack(alignment: .top, spacing: gap) {
            axis(rows)
            ForEach(days) { day in
                NativeScheduleStyledDayColumn(
                    day: day.day,
                    dateText: day.dateText,
                    headerDateText: day.rawDate.flatMap { Self.dayOfMonth($0) },
                    isToday: day.isToday,
                    adjustmentKind: day.adjustmentKind,
                    columnWidth: columnWidth,
                    rowHeight: rowHeight,
                    slotCount: slotCount,
                    clocks: clocks,
                    compactCards: compactCards,
                    showsDateHeader: showsDateHeader,
                    blocks: day.blocks,
                    showLocation: showLocation,
                    onCourseSelected: { onCourseSelected(day, $0) },
                    onEmptySlot: { onEmptySlot(day, $0) },
                    nowMinutes: day.isToday ? now : nil
                )
            }
        }
        .background(alignment: .topLeading) {
            if style == .minimal {
                ScheduleRowRules(headerHeight: headerHeight, rowHeight: rowHeight, slotCount: slotCount,
                                 leading: Self.axisWidth + gap / 2)
            } else if style == .table {
                // Beneath the courses: no rule over a name, none through a multi-period course.
                ScheduleTableRules(headerHeight: headerHeight, rowHeight: rowHeight, slotCount: slotCount,
                                   axisWidth: Self.axisWidth, columnWidth: columnWidth, dayCount: days.count,
                                   joined: { column, row in
                                       days[column].blocks.contains { $0.startSlot <= row && row < $0.endSlot }
                                   })
            }
        }
        .overlay(alignment: .topLeading) {
            if let now, let todayIndex = days.firstIndex(where: \.isToday),
               let y = Self.nowOffset(now, rows: rows, rowHeight: rowHeight) {
                // A capsule on the axis and a line across today's column, at one height.
                ZStack(alignment: .topLeading) {
                    if style != .grid {
                        ScheduleNowLine(width: columnWidth)
                            .offset(x: Self.axisWidth + gap + CGFloat(todayIndex) * (columnWidth + gap),
                                    y: headerHeight + y)
                    }
                    ScheduleNowBadge(minutes: now)
                        .frame(width: Self.axisWidth)
                        .offset(y: headerHeight + y - ScheduleNowBadge.height / 2)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
    }

    private func axis(_ rows: [ScheduleSlot]) -> some View {
        VStack(spacing: 0) {
            if showsDateHeader {
                // The headers carry only the day of the month; the month reads here, as on a calendar.
                Text(days.first?.rawDate.flatMap { Self.month($0) } ?? "节次")
                    .font(.system(size: 11, weight: .bold, design: style.fontDesign))
                    .foregroundStyle(.scheduleMeta)
                    .frame(width: Self.axisWidth, height: NativeScheduleStyledDayColumn.dateHeaderHeight)
            }
            VStack(spacing: NativeScheduleStyledDayColumn.slotGap) {
                ForEach(rows, id: \.number) { slot in
                    ScheduleStyledSlotLabel(
                        slot: slot,
                        startsSession: rows.first(where: { $0.number == slot.number - 1 }).map {
                            ScheduleStyleTime.session($0.start) != ScheduleStyleTime.session(slot.start)
                        } ?? true
                    )
                    .frame(width: Self.axisWidth, height: rowHeight)
                }
            }
        }
    }

    /// Where "now" falls down the grid. During a break it rests in the gap
    /// between two periods; before the first and after the last it is not drawn.
    static func nowOffset(_ current: Int, rows: [ScheduleSlot], rowHeight: CGFloat) -> CGFloat? {
        let step = rowHeight + NativeScheduleStyledDayColumn.slotGap
        for (index, slot) in rows.enumerated() {
            guard let start = scheduleClockMinutes(slot.start), let end = scheduleClockMinutes(slot.end),
                  end > start else { return nil }
            if current < start {
                return index == 0 ? nil : CGFloat(index) * step - NativeScheduleStyledDayColumn.slotGap / 2
            }
            if current <= end {
                return CGFloat(index) * step + rowHeight * CGFloat(current - start) / CGFloat(end - start)
            }
        }
        return nil
    }

    private static func month(_ date: String) -> String? {
        let pieces = date.split(separator: "-")
        guard pieces.count >= 3, let month = Int(pieces[1]) else { return nil }
        return "\(month)月"
    }

    private static func dayOfMonth(_ date: String) -> String? {
        let pieces = date.split(separator: "-")
        guard pieces.count >= 3, let day = Int(pieces[2]) else { return nil }
        return String(day)
    }
}
