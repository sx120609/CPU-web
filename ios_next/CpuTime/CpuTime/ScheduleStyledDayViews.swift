import SwiftUI

// Day layouts of the NapTable styles. Each style reads the same resolved
// blocks and bell schedule; tapping a course opens the editor and tapping an
// empty period adds one, as in the classic grid.

/// A course's place relative to "now" on the day being shown.
struct ScheduleStyledDayStatus {
    enum Phase { case current, upcoming, completed }
    let clocks: [ScheduleSlot]
    /// Minutes since midnight when the day shown is today and "now" is marked.
    let now: Int?
    /// Courses ending by this minute are finished; also set for past days.
    let completedBefore: Int?

    /// A custom course may carry its own clock times; they win over the bell schedule.
    func start(_ block: NativeScheduleCourseBlock) -> String {
        Self.clock(block.course.customStartTime) ?? clocks.first { $0.number == block.startSlot }?.start ?? "—"
    }

    func end(_ block: NativeScheduleCourseBlock) -> String {
        Self.clock(block.course.customEndTime) ?? clocks.first { $0.number == block.endSlot }?.end ?? "—"
    }

    private static func clock(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              scheduleClockMinutes(value) != nil else { return nil }
        return value
    }

    func phase(_ block: NativeScheduleCourseBlock) -> Phase {
        guard let end = scheduleClockMinutes(end(block)), let start = scheduleClockMinutes(start(block)) else {
            return .upcoming
        }
        if let limit = completedBefore ?? now, end <= limit { return .completed }
        if let now, start <= now && now < end { return .current }
        return .upcoming
    }

    func label(_ block: NativeScheduleCourseBlock) -> String? {
        switch phase(block) {
        case .completed: return "已结束"
        case .current:
            let remaining = (scheduleClockMinutes(end(block)) ?? 0) - (now ?? 0)
            return "正在上 · 还剩 \(max(1, remaining)) 分"
        case .upcoming:
            guard let now, let start = scheduleClockMinutes(start(block)), start > now else { return nil }
            return start - now < 60 ? "\(start - now) 分钟后" : nil
        }
    }
}

private func scheduleSlotText(_ block: NativeScheduleCourseBlock) -> String {
    "第 \(block.startSlot)\(block.startSlot == block.endSlot ? "" : "–\(block.endSlot)") 节"
}

/// "高等数学，教室 A101，第 1–2 节，08:00 至 09:40，已结束"
private func scheduleSpokenLabel(_ block: NativeScheduleCourseBlock, status: ScheduleStyledDayStatus,
                                 state: String?) -> String {
    [block.course.name,
     ScheduleStyleTime.location(block.course.location).map { "教室 \($0)" },
     scheduleSlotText(block),
     "\(status.start(block)) 至 \(status.end(block))",
     state].compactMap { $0 }.joined(separator: "，")
}

private extension View {
    /// A course row: one tap opens the editor.
    func scheduleCourseAction(_ action: @escaping () -> Void) -> some View {
        contentShape(Rectangle())
            .onTapGesture(perform: action)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("轻点查看课程详情")
    }
}

/// The day view of every style except classic.
@available(iOS 17.0, *)
struct ScheduleStyledDayView: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scheduleStaticRendering) private var staticRendering
    /// Standard card height; the compact density scales it down.
    static let standardCardHeight: CGFloat = 108

    /// Weekday (1–7) of the page.
    let day: Int
    let blocks: [NativeScheduleCourseBlock]
    var clocks: [ScheduleSlot] = ScheduleSlot.all
    var slotCount: Int = ScheduleSlot.all.count
    /// Set only when the page is today and "now" is marked.
    var nowMinutes: Int? = nil
    var completedBeforeMinutes: Int? = nil
    var cardHeight: CGFloat = ScheduleStyledDayView.standardCardHeight
    /// Shown under the rest card, e.g. the reason for a day off.
    var emptyNote: String? = nil
    var holidayGreeting: String? = nil
    /// The visible height to centre the rest card in.
    var emptyHeight: CGFloat = 0
    var showLocation = true
    var showTeacher = true
    let onCourseSelected: (NativeScheduleCourseBlock) -> Void
    let onEmptySlot: (Int) -> Void

    private var visibleClocks: [ScheduleSlot] { Array(clocks.prefix(slotCount)) }
    private var status: ScheduleStyledDayStatus {
        .init(clocks: clocks, now: staticRendering ? nil : nowMinutes,
              completedBefore: staticRendering ? nil : completedBeforeMinutes)
    }
    private var orderedBlocks: [NativeScheduleCourseBlock] {
        blocks.sorted { ($0.startSlot, $0.endSlot, $0.id) < ($1.startSlot, $1.endSlot, $1.id) }
    }

    /// Minimal, paper and board show the rest card on a free day; grid and
    /// table keep their empty rows so a course can still be added there.
    static func showsRestCard(style: ScheduleStyle, blocks: [NativeScheduleCourseBlock]) -> Bool {
        blocks.isEmpty && (style == .minimal || style == .paper || style == .board)
    }

    var body: some View {
        if Self.showsRestCard(style: style, blocks: blocks) {
            ScheduleEmptyDayView(note: emptyNote, holidayGreeting: holidayGreeting)
                .frame(height: max(emptyHeight, Self.restCardHeight(cardHeight)))
        } else {
            switch style {
            case .minimal:
                ScheduleDayTimeline(blocks: orderedBlocks, status: status, cardHeight: cardHeight,
                                    showLocation: showLocation, showTeacher: showTeacher,
                                    onCourseSelected: onCourseSelected)
            case .grid: grid
            case .table: table
            case .paper: paper
            case .board:
                ScheduleBoardDayView(blocks: orderedBlocks, status: status, cardHeight: cardHeight,
                                     showLocation: showLocation, showTeacher: showTeacher,
                                     onCourseSelected: onCourseSelected)
            case .classic: EmptyView()
            }
        }
    }

    /// The pager around the day view has a fixed cross axis, so the height has
    /// to match the rows drawn here.
    static func height(style: ScheduleStyle, blocks: [NativeScheduleCourseBlock], clocks: [ScheduleSlot],
                       slotCount: Int, cardHeight: CGFloat) -> CGFloat {
        if showsRestCard(style: style, blocks: blocks) { return restCardHeight(cardHeight) }
        let rows = Array(clocks.prefix(slotCount))
        switch style {
        case .classic: return 0
        case .minimal: return ScheduleDayTimeline.height(blocks: blocks, cardHeight: cardHeight)
        case .grid:
            return CGFloat(rows.count) * gridRowHeight(cardHeight)
                + CGFloat(max(0, rows.count - 1)) * NativeScheduleStyledDayColumn.slotGap
        case .table:
            return 32 + rows.reduce(CGFloat(0)) { value, slot in
                let count = blocks.filter { $0.startSlot <= slot.number && slot.number <= $0.endSlot }.count
                return value + CGFloat(max(1, count)) * tableRowHeight(cardHeight)
            }
        case .paper:
            let sections = Set(blocks.map { block in
                ScheduleStyleTime.session(clocks.first { $0.number == block.startSlot }?.start ?? "")
            }).count
            return CGFloat(blocks.count) * cardHeight + CGFloat(sections) * 40 + 24
        case .board:
            return ScheduleBoardDayView.height(blocks: blocks, cardHeight: cardHeight)
        }
    }

    private static func restCardHeight(_ cardHeight: CGFloat) -> CGFloat { max(360, cardHeight * 2) }
    private static func gridRowHeight(_ cardHeight: CGFloat) -> CGFloat { max(48, cardHeight * 0.52) }
    private static func tableRowHeight(_ cardHeight: CGFloat) -> CGFloat { max(58, cardHeight * 0.60) }

    private var grid: some View {
        let height = Self.gridRowHeight(cardHeight)
        return GeometryReader { geometry in
            HStack(alignment: .top, spacing: 8) {
                VStack(spacing: NativeScheduleStyledDayColumn.slotGap) {
                    ForEach(visibleClocks, id: \.number) { slot in
                        ScheduleStyledSlotLabel(slot: slot).frame(width: 48, height: height)
                    }
                }
                NativeScheduleStyledDayColumn(
                    day: day, dateText: nil, isToday: nowMinutes != nil,
                    columnWidth: max(24, geometry.size.width - 56), rowHeight: height,
                    slotCount: visibleClocks.count, clocks: clocks, compactCards: false,
                    showsDateHeader: false, blocks: blocks, showLocation: showLocation,
                    onCourseSelected: onCourseSelected, onEmptySlot: onEmptySlot,
                    nowMinutes: status.now, dayPresentation: true, completedBeforeMinutes: status.completedBefore
                )
            }
        }
        .frame(height: CGFloat(visibleClocks.count) * height
            + CGFloat(max(0, visibleClocks.count - 1)) * NativeScheduleStyledDayColumn.slotGap)
    }

    private var table: some View {
        VStack(spacing: 0) {
            ScheduleDayTableHeading()
            ForEach(visibleClocks, id: \.number) { slot in
                ScheduleDayTableRow(
                    slot: slot, blocks: blocks.filter { $0.startSlot <= slot.number && slot.number <= $0.endSlot },
                    rowHeight: Self.tableRowHeight(cardHeight), status: status, showLocation: showLocation,
                    showsBottomRule: slot.number != visibleClocks.last?.number,
                    onCourseSelected: onCourseSelected, onEmptySlot: onEmptySlot
                )
            }
        }
        // The frame is stroked on top: course rows fill their cells edge to
        // edge and would paint over a border drawn beneath them.
        .background { ScheduleSurface(cornerRadius: 0, isPanel: true, showsBorder: false) }
        .overlay {
            Rectangle().strokeBorder(Color.scheduleCellBorder(dark: scheme == .dark), lineWidth: 0.5)
                .allowsHitTesting(false)
        }
    }

    private var paper: some View {
        let status = status
        let sections = ["上午", "下午", "晚上", "课程"]
            .map { session in
                (title: session, courses: orderedBlocks.filter { ScheduleStyleTime.session(status.start($0)) == session })
            }
            .filter { !$0.courses.isEmpty }
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(sections, id: \.title) { section in
                ScheduleDaySectionHeading(title: section.title).frame(height: 40)
                ForEach(section.courses) { block in
                    // The last row closes the list; one more rule there would sit on the panel's edge.
                    let last = section.title == sections.last?.title && block.id == section.courses.last?.id
                    ScheduleStyledDepartureRow(block: block, status: status, showLocation: showLocation,
                                               showsDivider: !last)
                        .frame(height: cardHeight)
                        .scheduleCourseAction { onCourseSelected(block) }
                }
            }
        }
        .padding(12)
        .background { ScheduleSurface(cornerRadius: 2, isPanel: true) }
    }
}

// MARK: - Minimal: timeline

/// Courses in order of their start time, with no rows reserved for empty
/// periods. Courses starting together share one node on the rail.
@available(iOS 17.0, *)
private struct ScheduleDayTimeline: View {
    let blocks: [NativeScheduleCourseBlock]
    let status: ScheduleStyledDayStatus
    let cardHeight: CGFloat
    let showLocation: Bool
    let showTeacher: Bool
    let onCourseSelected: (NativeScheduleCourseBlock) -> Void

    private static let groupGap: CGFloat = 20
    private static let cardGap: CGFloat = 10
    /// The node's position in each group, level with the first line of the time.
    private static let nodeY: CGFloat = 28

    private enum Phase: Equatable {
        case none
        case past
        case current(remaining: Int)
        case next(minutesUntil: Int)
    }

    static func height(blocks: [NativeScheduleCourseBlock], cardHeight: CGFloat) -> CGFloat {
        guard !blocks.isEmpty else { return max(220, cardHeight * 2) }
        let groupCount = Set(blocks.map(\.startSlot)).count
        return CGFloat(blocks.count) * cardHeight
            + CGFloat(blocks.count - groupCount) * cardGap
            + CGFloat(groupCount - 1) * groupGap
    }

    private var groups: [[NativeScheduleCourseBlock]] {
        Dictionary(grouping: blocks, by: \.startSlot)
            .sorted { $0.key < $1.key }
            .map { _, courses in courses.sorted { ($0.lane, $0.endSlot, $0.id) < ($1.lane, $1.endSlot, $1.id) } }
    }

    private func range(_ courses: [NativeScheduleCourseBlock]) -> (start: Int, end: Int)? {
        guard let first = courses.first,
              let last = courses.max(by: { $0.endSlot < $1.endSlot }),
              let start = scheduleClockMinutes(status.start(first)),
              let end = scheduleClockMinutes(status.end(last)) else { return nil }
        return (start, end)
    }

    private func phases(_ groups: [[NativeScheduleCourseBlock]]) -> [Phase] {
        let ranges = groups.map(range)
        guard let now = status.now else {
            // A past day: everything is finished, without a "now" to count from.
            return ranges.map { range in
                guard let limit = status.completedBefore, let range else { return .none }
                return range.end <= limit ? .past : .none
            }
        }
        var foundNext = false
        let inClass = ranges.contains { range in range.map { $0.start <= now && now <= $0.end } ?? false }
        return ranges.map { range in
            guard let range else { return .none }
            if now > range.end { return .past }
            if now >= range.start { return .current(remaining: range.end - now) }
            if !inClass && !foundNext {
                foundNext = true
                return .next(minutesUntil: range.start - now)
            }
            return .none
        }
    }

    private func heightOfGroup(_ courses: [NativeScheduleCourseBlock]) -> CGFloat {
        CGFloat(courses.count) * cardHeight + CGFloat(courses.count - 1) * Self.cardGap
    }

    /// Where "now" falls down the rail; the rail above it takes the theme colour.
    private func progressY(_ groups: [[NativeScheduleCourseBlock]]) -> CGFloat? {
        guard let now = status.now else { return nil }
        var knots: [(minutes: Int, y: CGFloat)] = []
        var top: CGFloat = 0
        for courses in groups {
            let height = heightOfGroup(courses)
            if let range = range(courses) {
                knots.append((max(range.start, knots.last?.minutes ?? range.start), top + Self.nodeY))
                knots.append((max(range.end, knots.last?.minutes ?? range.end), top + max(Self.nodeY, height)))
            }
            top += height + Self.groupGap
        }
        guard let first = knots.first, now >= first.minutes else { return 0 }
        for (a, b) in zip(knots, knots.dropFirst()) where now < b.minutes {
            let fraction = CGFloat(now - a.minutes) / CGFloat(max(1, b.minutes - a.minutes))
            return a.y + (b.y - a.y) * fraction
        }
        return knots.last?.y ?? 0
    }

    var body: some View {
        let groups = groups
        let phases = phases(groups)
        let groupTops = groups.indices.map { index in
            groups[..<index].reduce(CGFloat(0)) { $0 + heightOfGroup($1) + Self.groupGap }
        }
        // The coloured rail always reaches the highlighted node, even when the
        // interpolated time has not caught up with it during a break.
        let highlightedNodeY = groups.indices.compactMap { index -> CGFloat? in
            switch phases[index] {
            case .current, .next: return groupTops[index] + Self.nodeY
            case .past, .none: return nil
            }
        }.max() ?? 0
        let progress = progressY(groups).map { max($0, highlightedNodeY) }
        let isInClass = phases.contains { if case .current = $0 { return true } else { return false } }
        VStack(alignment: .leading, spacing: Self.groupGap) {
            ForEach(groups.indices, id: \.self) { index in
                let courses = groups[index]
                let phase = phases[index]
                let startSlot = courses[0].startSlot
                let endSlot = courses.map(\.endSlot).max() ?? startSlot
                let groupHeight = heightOfGroup(courses)
                let lineTop = index == 0 ? Self.nodeY : 0
                let lineBottom = index == groups.count - 1
                    ? (isInClass ? max(Self.nodeY, (progress ?? 0) - groupTops[index]) : Self.nodeY)
                    : groupHeight + Self.groupGap
                let filled = progress.map {
                    min(max($0 - groupTops[index] - lineTop, 0), max(0, lineBottom - lineTop))
                } ?? 0
                HStack(alignment: .top, spacing: 12) {
                    // The start time leads; the end time and the periods step back
                    // beneath it. In class or next up, the third line becomes a countdown.
                    VStack(alignment: .trailing, spacing: 3) {
                        Text(status.start(courses[0]))
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                            .foregroundStyle(startStyle(phase))
                        Text(status.clocks.first { $0.number == endSlot }?.end ?? "—")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(.scheduleMeta)
                        if let text = statusText(phase) {
                            Text(text)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(.themeText)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(.themeTint(0.12), in: Capsule())
                                .padding(.top, 2)
                        } else {
                            Text(startSlot == endSlot ? "第 \(startSlot) 节" : "\(startSlot)–\(endSlot) 节")
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(.scheduleMeta)
                                .padding(.top, 2)
                        }
                    }
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(width: 56, alignment: .trailing)
                    .padding(.top, 17)
                    .accessibilityElement(children: .combine)

                    VStack(spacing: Self.cardGap) {
                        ForEach(courses) { block in
                            ScheduleTimelineCourseCard(
                                course: block.course,
                                isCompleted: status.phase(block) == .completed,
                                // The left column already names the periods; a card repeats
                                // them only when several courses start together.
                                slotLabel: courses.count > 1
                                    ? "\(scheduleSlotText(block)) · \(status.start(block))–\(status.end(block))" : nil,
                                showLocation: showLocation, showTeacher: showTeacher
                            )
                            .frame(height: cardHeight)
                            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .onTapGesture { onCourseSelected(block) }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(scheduleSpokenLabel(block, status: status, state: status.label(block)))
                            .accessibilityAddTraits(.isButton)
                            .accessibilityHint("轻点查看课程详情")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding(.leading, 16)
                .overlay(alignment: .topLeading) {
                    // The rail runs outside the times and breaks around each node, so a
                    // solid dot covers it and a ring stays open.
                    let nodeRadius = TimelineNode.diameter(for: phase) / 2
                    let rail = Path { path in
                        let upperEnd = min(lineBottom, Self.nodeY - nodeRadius)
                        if upperEnd > lineTop {
                            path.addRect(CGRect(x: 2, y: lineTop, width: 1, height: upperEnd - lineTop))
                        }
                        let lowerStart = max(lineTop, Self.nodeY + nodeRadius)
                        if lineBottom > lowerStart {
                            path.addRect(CGRect(x: 2, y: lowerStart, width: 1, height: lineBottom - lowerStart))
                        }
                    }
                    ZStack(alignment: .top) {
                        rail.fill(Color.secondary.opacity(0.15))
                            .frame(width: 5, height: max(groupHeight, lineBottom))
                        rail.fill(.themeText.opacity(0.6))
                            .frame(width: 5, height: max(groupHeight, lineBottom))
                            .mask(alignment: .top) { Rectangle().frame(height: lineTop + filled) }
                        TimelineNode(phase: phase)
                            .offset(y: Self.nodeY - TimelineNode.size / 2)
                        if isInClass, let progress,
                           progress > groupTops[index] + lineTop,
                           progress <= groupTops[index] + lineBottom,
                           abs(progress - groupTops[index] - Self.nodeY) > nodeRadius + 1 {
                            Capsule().fill(.themeText).frame(width: 9, height: 2)
                                .offset(y: progress - groupTops[index] - 1)
                        }
                    }
                    .frame(width: 5, height: groupHeight, alignment: .top)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            }
        }
    }

    private func startStyle(_ phase: Phase) -> AnyShapeStyle {
        switch phase {
        case .current, .next: AnyShapeStyle(.themeText)
        case .past: AnyShapeStyle(.scheduleMeta)
        case .none: AnyShapeStyle(Color.primary)
        }
    }

    private func statusText(_ phase: Phase) -> String? {
        switch phase {
        case .current(let remaining):
            return "还剩 \(max(1, remaining)) 分"
        case .next(let minutes):
            if minutes < 60 { return "\(max(1, minutes)) 分钟后" }
            return "约 \(Int((Double(minutes) / 60).rounded())) 小时后"
        case .past, .none:
            return nil
        }
    }

    /// In class: a solid dot with a halo. Next up: a theme-colour ring. Finished: a solid theme-colour dot.
    private struct TimelineNode: View {
        static let size: CGFloat = 13
        let phase: Phase

        static func diameter(for phase: Phase) -> CGFloat {
            switch phase {
            case .current, .past: 7
            case .next: 8
            case .none: 5
            }
        }

        var body: some View {
            let diameter = Self.diameter(for: phase)
            ZStack {
                switch phase {
                case .current:
                    Circle().fill(.themeTint(0.2))
                    Circle().fill(.themeFill).frame(width: diameter, height: diameter)
                case .next:
                    Circle().strokeBorder(.themeText, lineWidth: 1.5).frame(width: diameter, height: diameter)
                case .past:
                    Circle().fill(.themeText.opacity(0.6)).frame(width: diameter, height: diameter)
                case .none:
                    Circle().fill(Color.secondary.opacity(0.45)).frame(width: diameter, height: diameter)
                }
            }
            .frame(width: Self.size, height: Self.size)
        }
    }
}

/// The minimal day card: a pale tint held by a light edge and a soft shadow.
@available(iOS 17.0, *)
private struct ScheduleTimelineCourseCard: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scheduleHasBackground) private var hasBackground
    @Environment(\.schedulePalette) private var palette
    let course: NativeScheduleCourse
    let isCompleted: Bool
    let slotLabel: String?
    let showLocation: Bool
    let showTeacher: Bool

    var body: some View {
        let dark = scheme == .dark
        let tint = ScheduleStyleCourseColor(name: course.name, palette: palette)
        let accent = tint.accent(dark: dark)
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        let detail = [
            showLocation ? ScheduleStyleTime.location(course.location).map { "@\($0)" } : nil,
            showTeacher ? course.teacher?.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
        ].compactMap { $0 }.filter { !$0.isEmpty }
        VStack(alignment: .leading, spacing: 7) {
            Text(course.name)
                .font(.headline.weight(isCompleted ? .medium : .semibold))
                .lineLimit(2)
                .minimumScaleFactor(0.85)
                .layoutPriority(1)
                .padding(.trailing, isCompleted ? 26 : 0)
            if !detail.isEmpty {
                Text(detail.joined(separator: " · "))
                    .font(.footnote)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            if let slotLabel {
                Text(slotLabel)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(isCompleted ? AnyShapeStyle(.scheduleMeta) : AnyShapeStyle(accent))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
        }
        .foregroundStyle(accent)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background { shape.fill(tint.fill(dark: dark, hasBackground: hasBackground)).allowsHitTesting(false) }
        .overlay {
            shape.strokeBorder(isCompleted ? Color.secondary.opacity(0.12) : tint.border(dark: dark), lineWidth: 1)
                .overlay {
                    if !isCompleted { shape.strokeBorder(Color.white.opacity(dark ? 0.10 : 0.62), lineWidth: 0.6) }
                }
        }
        .clipShape(shape)
        .overlay(alignment: .topTrailing) {
            if isCompleted {
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(accent)
                    .frame(width: 25, height: 25)
                    .background {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(accent.opacity(dark ? 0.20 : 0.12))
                            .overlay {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .strokeBorder(accent.opacity(0.22), lineWidth: 1)
                            }
                    }
                    .rotationEffect(.degrees(10))
                    .padding(.trailing, 12)
                    .offset(y: -12.5)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .shadow(color: isCompleted ? .clear : Color.black.opacity(dark ? 0.18 : 0.07), radius: 7, y: 3)
    }
}

// MARK: - Table

@available(iOS 17.0, *)
private struct ScheduleDayTableHeading: View {
    var body: some View {
        HStack(spacing: 0) {
            Text("节").frame(width: 28)
            Text("时间").frame(width: 58)
            Text("课程").frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 8)
            // Same 6pt inset as the room text in the rows below.
            Text("教室").padding(.leading, 6).frame(width: 80, alignment: .leading)
        }
        .font(.caption.weight(.semibold))
        .frame(height: 32)
        .background(Color.primary.opacity(0.06))
    }
}

@available(iOS 17.0, *)
private struct ScheduleDayTableRow: View {
    @Environment(\.colorScheme) private var scheme
    let slot: ScheduleSlot
    let blocks: [NativeScheduleCourseBlock]
    let rowHeight: CGFloat
    let status: ScheduleStyledDayStatus
    let showLocation: Bool
    /// The last row sits on the table frame, which already closes it.
    var showsBottomRule = true
    let onCourseSelected: (NativeScheduleCourseBlock) -> Void
    let onEmptySlot: (Int) -> Void

    private var rule: Color { .scheduleCellBorder(dark: scheme == .dark) }

    var body: some View {
        HStack(spacing: 0) {
            Text(String(slot.number)).font(.caption.bold()).frame(width: 28)
            Rectangle().fill(rule).frame(width: 0.5)
            VStack(spacing: 3) {
                Text(slot.start)
                Text(slot.end)
            }
            .font(.system(size: 10, design: .monospaced))
            // 28 + 0.5 + 57 + 0.5 = the heading's 28 + 58, so the course column starts under its title.
            .frame(width: 57)
            Rectangle().fill(rule).frame(width: 0.5)
            if blocks.isEmpty {
                HStack(spacing: 0) {
                    Text("—").frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 8)
                    Rectangle().fill(rule).frame(width: 0.5)
                    Text("—").padding(.leading, 6).frame(width: 79.5, alignment: .leading)
                }
                .foregroundStyle(.scheduleMeta)
                .contentShape(Rectangle())
                .onTapGesture { onEmptySlot(slot.number) }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("第 \(slot.number) 节，空节次")
                .accessibilityHint("轻点添加课程")
                .accessibilityAddTraits(.isButton)
            } else {
                VStack(spacing: 0) {
                    ForEach(blocks) { block in
                        ScheduleDayTableCourse(block: block, status: status, showLocation: showLocation,
                                               continuation: slot.number > block.startSlot)
                            .frame(height: rowHeight)
                            .scheduleCourseAction { onCourseSelected(block) }
                    }
                }
            }
        }
        .frame(height: CGFloat(max(1, blocks.count)) * rowHeight)
        .overlay(alignment: .bottom) {
            if showsBottomRule { Rectangle().fill(rule).frame(height: 0.5) }
        }
    }
}

@available(iOS 17.0, *)
private struct ScheduleDayTableCourse: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.schedulePalette) private var palette
    let block: NativeScheduleCourseBlock
    let status: ScheduleStyledDayStatus
    let showLocation: Bool
    let continuation: Bool

    var body: some View {
        let tint = ScheduleStyleCourseColor(name: block.course.name, palette: palette)
        let ink = tint.accent(dark: scheme == .dark)
        HStack(spacing: 0) {
            Rectangle().fill(ink).frame(width: 3)
            VStack(alignment: .leading, spacing: 3) {
                Text(block.course.name).font(.subheadline.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.8)
                // The status belongs to the course, so it is written once, on its first period.
                if continuation {
                    Text("续课").font(.caption2)
                } else if let label = status.label(block) {
                    Text(label).font(.caption2).lineLimit(1)
                }
            }
            .padding(.horizontal, 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            Rectangle().fill(.scheduleCellBorder(dark: scheme == .dark)).frame(width: 0.5)
            Text((showLocation ? ScheduleStyleTime.location(block.course.location) : nil) ?? "—")
                .font(.caption).lineLimit(3).minimumScaleFactor(0.8)
                .frame(width: 67.5, alignment: .leading).padding(.horizontal, 6)
        }
        .foregroundStyle(ink)
        .background(tint.fill(dark: scheme == .dark))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(scheduleSpokenLabel(block, status: status, state: status.label(block)))
    }
}

// MARK: - Paper

@available(iOS 17.0, *)
private struct ScheduleDaySectionHeading: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    let title: String

    var body: some View {
        HStack(spacing: 10) {
            Text(title).font(.system(size: 13, weight: .bold, design: style.fontDesign))
            Rectangle().fill(style.inkColor(dark: scheme == .dark).opacity(0.2)).frame(height: 0.5)
        }
        .foregroundStyle(style.inkColor(dark: scheme == .dark))
        .padding(.horizontal, 12)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A course row of the paper day view.
@available(iOS 17.0, *)
private struct ScheduleStyledDepartureRow: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    @Environment(\.schedulePalette) private var palette
    let block: NativeScheduleCourseBlock
    let status: ScheduleStyledDayStatus
    let showLocation: Bool
    var showsDivider = true

    private var dark: Bool { scheme == .dark }
    private var ink: Color { style.inkColor(dark: dark) }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(status.start(block)).font(.system(size: 20, weight: .bold, design: style.fontDesign))
                Text(status.end(block)).font(.system(size: 12, design: style.fontDesign))
            }
            .lineLimit(1).minimumScaleFactor(0.7).frame(width: 64, alignment: .leading)
            Rectangle()
                .fill(ScheduleStyleCourseColor(name: block.course.name, palette: palette).accent(dark: dark))
                .frame(width: 2).padding(.vertical, 16)
            VStack(alignment: .leading, spacing: 5) {
                Text(block.course.name).font(.headline.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.8)
                if showLocation, let location = ScheduleStyleTime.location(block.course.location) {
                    Text("@\(location)").font(.subheadline).lineLimit(1)
                }
                Text(scheduleSlotText(block)).font(.caption2)
                if let label = status.label(block) {
                    Text(label).font(.caption.weight(.semibold))
                        .foregroundStyle(style.styleAccent(dark: dark, fallback: .primary))
                        .lineLimit(1).minimumScaleFactor(0.75)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fontDesign(style.fontDesign)
        .foregroundStyle(ink)
        .padding(.horizontal, 12)
        .overlay(alignment: .bottom) {
            if showsDivider { Rectangle().fill(ink.opacity(0.15)).frame(height: 0.5) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(scheduleSpokenLabel(block, status: status, state: status.label(block)))
    }
}

// MARK: - Board

/// The board's day view: what is on now, what comes next and how long is left.
/// Any other day, and a day with the "now" indicator off, has no "now" and
/// shows one plain timetable instead.
@available(iOS 17.0, *)
private struct ScheduleBoardDayView: View {
    @Environment(\.scheduleStyle) private var style
    /// In timetable order.
    let blocks: [NativeScheduleCourseBlock]
    let status: ScheduleStyledDayStatus
    let cardHeight: CGFloat
    let showLocation: Bool
    let showTeacher: Bool
    let onCourseSelected: (NativeScheduleCourseBlock) -> Void

    private static let nowHeight: CGFloat = 36
    private static let headingHeight: CGFloat = 40
    private static let heroGap: CGFloat = 4
    private static let verticalPadding: CGFloat = 8
    private static func heroHeight(_ cardHeight: CGFloat) -> CGFloat { max(148, cardHeight * 1.38) }
    private static func rowHeight(_ cardHeight: CGFloat) -> CGFloat { max(68, cardHeight * 0.66) }
    private static func finishedHeight(_ cardHeight: CGFloat) -> CGFloat { max(34, cardHeight * 0.34) }

    /// The pager is sized before it knows the time, so this is the layout at
    /// its tallest: every course that can be in progress at once as a hero
    /// block, the rest as full rows, and both headings.
    static func height(blocks: [NativeScheduleCourseBlock], cardHeight: CGFloat) -> CGFloat {
        let count = CGFloat(blocks.count)
        let concurrent = CGFloat(blocks.map { block in
            blocks.filter { $0.startSlot <= block.startSlot && block.startSlot <= $0.endSlot }.count
        }.max() ?? 1)
        return nowHeight + concurrent * (heroHeight(cardHeight) + heroGap)
            + (count - concurrent) * rowHeight(cardHeight) + 2 * headingHeight + 2 * verticalPadding
    }

    private func courses(_ phase: ScheduleStyledDayStatus.Phase) -> [NativeScheduleCourseBlock] {
        blocks.filter { status.phase($0) == phase }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let now = status.now {
                let current = courses(.current), upcoming = courses(.upcoming), finished = courses(.completed)
                ScheduleBoardNowLine(minutes: now, remaining: current.count + upcoming.count)
                    .frame(height: Self.nowHeight)
                ForEach(current) { block in
                    course(block, height: Self.heroHeight(cardHeight)) {
                        ScheduleBoardHero(block: block, status: status, now: now,
                                          showLocation: showLocation, showTeacher: showTeacher)
                    }
                    .padding(.bottom, Self.heroGap)
                }
                list("接下来", upcoming, countsDown: true)
                if !finished.isEmpty {
                    ScheduleBoardHeading(title: "已结束", ruled: false).frame(height: Self.headingHeight)
                    ForEach(finished) { block in
                        course(block, height: Self.finishedHeight(cardHeight)) {
                            ScheduleBoardFinishedRow(block: block, status: status, showLocation: showLocation)
                        }
                    }
                }
            } else {
                list("课程安排", blocks, countsDown: false)
            }
        }
        .padding(.vertical, Self.verticalPadding)
        .background { ScheduleSurface(cornerRadius: 0, isPanel: true, showsBorder: style.framesPanel) }
    }

    @ViewBuilder
    private func list(_ title: String, _ courses: [NativeScheduleCourseBlock], countsDown: Bool) -> some View {
        if !courses.isEmpty {
            ScheduleBoardHeading(title: title).frame(height: Self.headingHeight)
            ForEach(courses) { block in
                course(block, height: Self.rowHeight(cardHeight)) {
                    ScheduleBoardRow(block: block, status: status, showLocation: showLocation,
                                     note: note(block, isNext: countsDown && block.id == courses.first?.id),
                                     showsDivider: block.id != courses.last?.id)
                }
            }
        }
    }

    private func course<Content: View>(_ block: NativeScheduleCourseBlock, height: CGFloat,
                                       @ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(height: height)
            .scheduleCourseAction { onCourseSelected(block) }
    }

    /// The trailing edge of a row: a countdown for the next course, and 已结束
    /// for a finished course in the plain timetable. Every other row leaves it
    /// empty; the times already lead.
    private func note(_ block: NativeScheduleCourseBlock, isNext: Bool) -> ScheduleBoardRow.Note? {
        if status.phase(block) == .completed { return .init(text: "已结束", emphasized: false) }
        if isNext, let now = status.now, let start = scheduleClockMinutes(status.start(block)), start > now {
            let wait = start - now
            let text = wait < 60 ? "\(wait) 分钟后"
                : (wait % 60 == 0 ? "\(wait / 60) 小时后" : "\(wait / 60) 小时 \(wait % 60) 分后")
            return .init(text: text, emphasized: true)
        }
        return nil
    }
}

@available(iOS 17.0, *)
private struct ScheduleBoardNowLine: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    let minutes: Int
    /// Courses in progress or still to come.
    let remaining: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("现在").font(.system(size: 11, weight: .bold, design: .monospaced)).tracking(2).opacity(0.72)
            Text(String(format: "%02d:%02d", minutes / 60, minutes % 60))
                .font(.system(size: 16, weight: .bold, design: .monospaced))
            Spacer(minLength: 8)
            Text(remaining > 0 ? "今天还有 \(remaining) 门课" : "今天的课上完了")
                .font(.system(size: 12, weight: .medium)).monospacedDigit().opacity(0.72)
        }
        .foregroundStyle(style.inkColor(dark: scheme == .dark))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .padding(.horizontal, 12)
        .accessibilityElement(children: .combine)
    }
}

@available(iOS 17.0, *)
private struct ScheduleBoardHeading: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    let title: String
    /// The heavy rule that opens a list. 已结束 is a quieter footer and goes without.
    var ruled = true

    var body: some View {
        let ink = style.inkColor(dark: scheme == .dark)
        VStack(alignment: .leading, spacing: 6) {
            Spacer(minLength: 0)
            Text(title).font(.system(size: 11, weight: .bold, design: .monospaced)).tracking(2)
                .foregroundStyle(ink.opacity(0.72)).padding(.horizontal, 12)
            Rectangle().fill(ink.opacity(ruled ? 0.65 : 0)).frame(height: 2)
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// The course in progress, inverted: time range, name, room and teacher, time left and progress.
@available(iOS 17.0, *)
private struct ScheduleBoardHero: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scheduleThemeBrand) private var brand
    @Environment(\.schedulePalette) private var palette
    let block: NativeScheduleCourseBlock
    let status: ScheduleStyledDayStatus
    let now: Int
    let showLocation: Bool
    let showTeacher: Bool

    private var dark: Bool { scheme == .dark }
    /// The block swaps light and dark, so the colours on it come from the other scheme.
    private var accent: Color { ThemePalette.of(brand).text(dark: !dark) }
    private var range: (start: Int, end: Int)? {
        guard let start = scheduleClockMinutes(status.start(block)), let end = scheduleClockMinutes(status.end(block)),
              end > start else { return nil }
        return (start, end)
    }
    private var remaining: Int { max(1, (range?.end ?? now) - now) }
    private var detail: String? {
        let parts = [
            showLocation ? ScheduleStyleTime.location(block.course.location) : nil,
            showTeacher ? block.course.teacher?.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
        ].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        let paper = style.canvasColor(dark: dark) ?? .white
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("正在上 · \(scheduleSlotText(block))")
                    .font(.system(size: 11, weight: .bold)).tracking(1).opacity(0.72)
                Spacer(minLength: 8)
                Text("还剩 \(remaining) 分")
                    .font(.system(size: 13, weight: .bold)).monospacedDigit().foregroundStyle(accent)
            }
            Spacer(minLength: 4)
            Text("\(status.start(block)) — \(status.end(block))")
                .font(.system(size: 30, weight: .bold, design: .monospaced)).minimumScaleFactor(0.6)
            Spacer(minLength: 4)
            HStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(ScheduleStyleCourseColor(name: block.course.name, palette: palette).accent(dark: !dark))
                    .frame(width: 9, height: 9)
                Text(block.course.name).font(.headline.weight(.bold)).minimumScaleFactor(0.75)
            }
            if let detail {
                Text(detail).font(.subheadline).opacity(0.72).padding(.top, 3)
            }
            Spacer(minLength: 8)
            Rectangle().fill(paper.opacity(0.25)).frame(height: 3)
                .overlay(alignment: .leading) {
                    GeometryReader { geometry in
                        let fraction = range.map { CGFloat(now - $0.start) / CGFloat($0.end - $0.start) } ?? 0
                        Rectangle().fill(accent).frame(width: geometry.size.width * min(1, max(0, fraction)))
                    }
                }
        }
        .lineLimit(1)
        .foregroundStyle(paper)
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(style.inkColor(dark: dark))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(scheduleSpokenLabel(block, status: status, state: "正在上，还剩 \(remaining) 分"))
    }
}

/// A course still to come, or any course in the plain timetable: the start
/// time leads, with the end time under it.
@available(iOS 17.0, *)
private struct ScheduleBoardRow: View {
    struct Note {
        let text: String
        /// The countdown to the next course takes the theme colour.
        let emphasized: Bool
    }

    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    @Environment(\.schedulePalette) private var palette
    let block: NativeScheduleCourseBlock
    let status: ScheduleStyledDayStatus
    let showLocation: Bool
    let note: Note?
    var showsDivider = true

    var body: some View {
        let ink = style.inkColor(dark: scheme == .dark)
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(status.start(block)).font(.system(size: 24, weight: .bold, design: .monospaced))
                Text(status.end(block)).font(.system(size: 12, weight: .medium, design: .monospaced)).opacity(0.72)
            }
            .minimumScaleFactor(0.7)
            .frame(width: 82, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 7) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(ScheduleStyleCourseColor(name: block.course.name, palette: palette)
                            .accent(dark: scheme == .dark))
                        .frame(width: 9, height: 9)
                    Text(block.course.name).font(.headline.weight(.semibold)).minimumScaleFactor(0.75)
                }
                Text([showLocation ? ScheduleStyleTime.location(block.course.location) : nil, scheduleSlotText(block)]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).opacity(0.72)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let note {
                Text(note.text).font(.caption.weight(.semibold)).monospacedDigit()
                    .foregroundStyle(note.emphasized ? AnyShapeStyle(.themeText) : AnyShapeStyle(ink.opacity(0.72)))
                    .fixedSize()
            }
        }
        .lineLimit(1)
        .foregroundStyle(ink)
        .padding(.horizontal, 12)
        .frame(maxHeight: .infinity)
        .overlay(alignment: .bottom) {
            if showsDivider { Rectangle().fill(ink.opacity(0.15)).frame(height: 0.5) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(scheduleSpokenLabel(block, status: status, state: note?.text))
    }
}

/// A finished course folds down to one quiet line.
@available(iOS 17.0, *)
private struct ScheduleBoardFinishedRow: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    let block: NativeScheduleCourseBlock
    let status: ScheduleStyledDayStatus
    let showLocation: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(status.start(block)).font(.system(size: 14, weight: .semibold, design: .monospaced))
                .frame(width: 82, alignment: .leading)
            Text(block.course.name).font(.subheadline).minimumScaleFactor(0.8)
            Spacer(minLength: 8)
            if showLocation, let location = ScheduleStyleTime.location(block.course.location) {
                Text(location).font(.caption)
            }
        }
        .lineLimit(1)
        .foregroundStyle(style.inkColor(dark: scheme == .dark).opacity(0.62))
        .padding(.horizontal, 12)
        .frame(maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(scheduleSpokenLabel(block, status: status, state: "已结束"))
    }
}

// MARK: - Rest day

/// The rest card of a day with no courses.
@available(iOS 17.0, *)
struct ScheduleEmptyDayView: View {
    var note: String? = nil
    var holidayGreeting: String? = nil

    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleHasBackground) private var hasBackground
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var detail: String {
        if let note = note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty { return note }
        return holidayGreeting ?? "留点时间，做喜欢的事"
    }

    var body: some View {
        let dark = colorScheme == .dark
        let shape = RoundedRectangle(cornerRadius: style == .paper || style == .board ? 2 : 32, style: .continuous)
        VStack(spacing: 24) {
            ScheduleRestIllustration()
                .frame(width: 184, height: 140)
                .accessibilityHidden(true)
            VStack(spacing: 10) {
                Text("这天没有课程")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(style.inkColor(dark: dark))
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.scheduleMeta)
                    .lineSpacing(4)
            }
            .fontDesign(style.fontDesign)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 32)
        .frame(maxWidth: 360)
        .background {
            if let canvas = style.canvasColor(dark: dark), !hasBackground {
                shape.fill(canvas).overlay { shape.strokeBorder(style.inkColor(dark: dark).opacity(0.18), lineWidth: 1) }
            } else {
                shape.fill(ScheduleCardSurface(hasBackground: hasBackground))
                    .overlay { shape.fill(.themeTint(dark ? 0.06 : 0.025)) }
                    .overlay { shape.strokeBorder(.themeText, lineWidth: 1).opacity(dark ? 0.12 : 0.07) }
            }
        }
        .padding(.horizontal, 12)
        // At accessibility sizes read from the top instead of centring the card low on the screen.
        .frame(maxWidth: .infinity, maxHeight: .infinity,
               alignment: dynamicTypeSize.isAccessibilitySize ? .top : .center)
    }
}

/// A dozing cloud, drawn in the theme colour for both appearances.
@available(iOS 17.0, *)
private struct ScheduleRestIllustration: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleThemeBrand) private var brand

    var body: some View {
        let dark = colorScheme == .dark
        let accent = style.styleAccent(dark: dark, fallback: ThemePalette.of(brand).text(dark: dark))
        Canvas { context, size in
            context.scaleBy(x: size.width / 116, y: size.height / 88)
            context.fill(Path(ellipseIn: CGRect(x: 15, y: 4, width: 78, height: 78)),
                         with: .color(accent.opacity(dark ? 0.10 : 0.05)))
            context.fill(Path(ellipseIn: CGRect(x: 24, y: 75, width: 65, height: 5)),
                         with: .color(accent.opacity(dark ? 0.10 : 0.07)))
            context.fill(Path(ellipseIn: CGRect(x: 65, y: 11, width: 29, height: 29)),
                         with: .color(accent.opacity(dark ? 0.48 : 0.24)))

            var cloud = Path()
            cloud.move(to: CGPoint(x: 32, y: 67))
            cloud.addCurve(to: CGPoint(x: 30, y: 37), control1: CGPoint(x: 11, y: 67), control2: CGPoint(x: 10, y: 39))
            cloud.addCurve(to: CGPoint(x: 66, y: 30), control1: CGPoint(x: 29, y: 15), control2: CGPoint(x: 60, y: 11))
            cloud.addCurve(to: CGPoint(x: 85, y: 42), control1: CGPoint(x: 76, y: 26), control2: CGPoint(x: 87, y: 32))
            cloud.addCurve(to: CGPoint(x: 84, y: 67), control1: CGPoint(x: 105, y: 43), control2: CGPoint(x: 103, y: 67))
            cloud.closeSubpath()
            context.fill(cloud, with: .color(dark ? Color(white: 0.20) : .white))
            context.fill(cloud, with: .color(accent.opacity(dark ? 0.09 : 0.025)))
            context.stroke(cloud, with: .color(accent.opacity(dark ? 0.35 : 0.20)), lineWidth: 1.2)

            var eyes = Path()
            for x: CGFloat in [41, 63] {
                eyes.move(to: CGPoint(x: x, y: 48))
                eyes.addQuadCurve(to: CGPoint(x: x + 10, y: 48), control: CGPoint(x: x + 5, y: 54))
            }
            context.stroke(eyes, with: .color(accent.opacity(dark ? 0.85 : 0.70)),
                           style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
        }
    }
}
