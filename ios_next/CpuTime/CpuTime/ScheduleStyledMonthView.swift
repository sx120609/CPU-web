import SwiftUI

/// The month page of the NapTable styles: the calendar and the selected day's
/// courses share one panel. Month data, selection and editing stay in
/// `NativeScheduleMonthView`; this view only draws them.
@available(iOS 17.0, *)
struct ScheduleStyledMonthPage: View {
    let days: [NativeScheduleMonthView.Day]
    let selectedDate: String
    let todayDate: String?
    let periods: [NativeSchedulePeriod]
    let showLocation: Bool
    let showTeacher: Bool
    /// "10 月 7 日 · 周三".
    let selectedTitle: String
    /// "第 5 周 · 八月廿六".
    let selectedSubtitle: String
    /// Why the selected day has no courses, or nil when it has some.
    let emptyText: String?
    let adjustmentText: String?
    let canOpenDay: Bool
    let accessibilityLabel: (NativeScheduleMonthView.Day) -> String
    let onSelect: (String) -> Void
    let onOpenDay: () -> Void
    let onCourseSelected: (NativeScheduleCourseBlock) -> Void

    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.scheduleHasBackground) private var hasBackground
    @Environment(\.scheduleThemeBrand) private var brand
    @Environment(\.schedulePalette) private var palette

    private typealias Day = NativeScheduleMonthView.Day
    private static let weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"]

    private var dark: Bool { colorScheme == .dark }
    private var ink: Color { style.inkColor(dark: dark) }
    private var accent: Color { style.styleAccent(dark: dark, fallback: ThemePalette.of(brand).text(dark: dark)) }
    private var fill: Color {
        style == .grid || style == .table ? ThemePalette.of(brand).fill(dark: dark) : accent
    }
    private var onAccent: Color {
        style == .paper || style == .board ? (style.canvasColor(dark: dark) ?? .white) : .white
    }
    private var rule: Color { ink.opacity(contrast == .increased ? 0.6 : 0.24) }
    /// The board's heavy rule, as between morning, afternoon and evening in its week view.
    private var boardRule: Color { ink.opacity(0.65) }
    /// A statutory holiday's name. The badge red is too dim on the dark canvas, so dark uses a lighter pink.
    private var holidayColor: Color {
        dark ? Color(.sRGB, red: 1, green: 0.55, blue: 0.65, opacity: 1) : ScheduleAdjustmentBadge.offColor
    }

    private var rows: [[Day]] {
        stride(from: 0, to: days.count, by: 7).map { Array(days[$0..<min($0 + 7, days.count)]) }
    }

    /// The table writes course names inside its cells and needs the taller row.
    private var rowHeight: CGFloat {
        switch style {
        case .minimal: 58
        case .table: 70
        default: 62
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            if style == .minimal { minimalGrid } else { styledGrid }
            // The table's frame already separates the calendar from the summary.
            if style != .table {
                Rectangle().fill(style == .board ? boardRule : rule.opacity(style == .minimal ? 0.5 : 1))
                    .frame(height: style == .board ? 2 : 0.7)
                    .padding(.horizontal, style == .board ? 0 : 12)
            }
            summary
        }
        .foregroundStyle(ink)
        .background {
            // Dense text sits on a flat base; no per-cell material.
            if style == .paper || style == .board {
                (style.canvasColor(dark: dark) ?? .clear).opacity(hasBackground ? 0.96 : 1)
            } else {
                ScheduleSurface(cornerRadius: style == .grid ? 12 : 20, isPanel: true, showsBorder: style != .table)
            }
        }
        .overlay {
            if style == .paper {
                Rectangle().strokeBorder(ink.opacity(0.6), lineWidth: 1.2)
                    .overlay { Rectangle().inset(by: 3).stroke(rule, lineWidth: 0.6) }
                    .allowsHitTesting(false)
            } else if style == .table {
                // One frame for the calendar and the summary, at the weight of the cell rules.
                Rectangle().strokeBorder(rule, lineWidth: 0.6).allowsHitTesting(false)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }

    // MARK: Calendar

    private var minimalGrid: some View {
        VStack(spacing: 12) {
            HStack(spacing: 4) {
                ForEach(Array(Self.weekdayLabels.enumerated()), id: \.offset) { _, label in
                    Text(label)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.scheduleMeta)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 16)
            VStack(spacing: 6) {
                ForEach(rows, id: \.first?.date) { row in
                    HStack(spacing: 4) {
                        ForEach(row) { day in cell(day) { minimalLabel(day) } }
                    }
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 14)
        .padding(.bottom, 10)
    }

    private var styledGrid: some View {
        let rows = rows
        return VStack(spacing: style == .grid ? 6 : 0) {
            if style == .paper, let date = days.first(where: \.inMonth)?.date {
                Text(Self.paperMonthTitle(date))
                    .font(.system(.subheadline, design: style.fontDesign).weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(height: 30)
                    .padding(.horizontal, 12)
            }
            HStack(spacing: 0) {
                ForEach(Array(Self.weekdayLabels.enumerated()), id: \.offset) { index, label in
                    Text(label)
                        .font(.system(size: style == .paper ? 12 : 11,
                                      weight: style == .board ? .bold : .medium,
                                      design: style.fontDesign))
                        .foregroundStyle(ink.opacity(index >= 5 ? 0.62 : 0.78))
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: style == .table || style == .board ? 28 : 22)
            .background(style == .table ? Color.primary.opacity(dark ? 0.06 : 0.045) : Color.clear)
            .overlay(alignment: .bottom) {
                if style == .table { Rectangle().fill(rule).frame(height: 0.6) }
            }
            if style == .paper {
                Rectangle().fill(ink.opacity(0.24)).frame(height: 0.8).padding(.horizontal, 12)
            } else if style == .board {
                // The board is divided by heavy rules: one under the weekdays, one above the summary.
                Rectangle().fill(boardRule).frame(height: 2)
            }
            VStack(spacing: style == .grid ? 5 : 0) {
                ForEach(rows, id: \.first?.date) { row in
                    HStack(spacing: style == .grid ? 5 : 0) {
                        ForEach(row) { day in cell(day) { styledLabel(day) } }
                    }
                    .overlay(alignment: .bottom) {
                        // The last week sits on the heavy rule above the summary.
                        if style == .board && row.first?.date != rows.last?.first?.date {
                            Rectangle().fill(ink.opacity(dark ? 0.24 : 0.16)).frame(height: 0.6)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, style == .table || style == .board ? 0 : 10)
        // The table's heading fill and rules have to meet its frame.
        .padding(.vertical, style == .paper ? 12 : (style == .table ? 0 : 8))
    }

    private func cell<Label: View>(_ day: Day, @ViewBuilder label: () -> Label) -> some View {
        Button { onSelect(day.date) } label: { label().contentShape(Rectangle()) }
            .buttonStyle(.plain)
            .accessibilityLabel(accessibilityLabel(day))
            .accessibilityHint("选择日期，查看下方的课程")
            .accessibilityAddTraits(day.date == selectedDate ? [.isButton, .isSelected] : [.isButton])
    }

    private func minimalLabel(_ day: Day) -> some View {
        let isSelected = day.date == selectedDate
        let isToday = day.date == todayDate
        return VStack(spacing: 3) {
            Text("\(day.number)")
                .font(.system(size: 18, weight: isSelected || isToday ? .bold : .medium, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(minimalNumberStyle(day, isSelected: isSelected, isToday: isToday))
                .frame(width: 30, height: 30)
                .background {
                    ZStack {
                        Circle().fill(isSelected ? AnyShapeStyle(.themeFill) : AnyShapeStyle(.clear))
                        if isToday && !isSelected { Circle().strokeBorder(.themeText, lineWidth: 1) }
                    }
                }
                .overlay(alignment: .topTrailing) {
                    if let adjustment = day.adjustment {
                        ScheduleAdjustmentBadge(kind: adjustment.kind).offset(x: 5, y: -5)
                    }
                }
            Text(day.subtitle.isEmpty ? " " : day.subtitle)
                .font(.system(size: 10, weight: day.isFestival ? .medium : .regular))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .foregroundStyle(minimalSubtitleStyle(day))
                .opacity(day.inMonth ? 1 : 0.6)
            courseDots(day)
        }
        .frame(maxWidth: .infinity)
        .frame(height: rowHeight)
    }

    private func minimalNumberStyle(_ day: Day, isSelected: Bool, isToday: Bool) -> AnyShapeStyle {
        if isSelected { return AnyShapeStyle(.themeOnFill) }
        guard day.inMonth else { return AnyShapeStyle(Color.secondary.opacity(0.6)) }
        if isToday { return AnyShapeStyle(.themeText) }
        return AnyShapeStyle(day.weekday >= 6 ? Color.secondary : Color.primary)
    }

    private func minimalSubtitleStyle(_ day: Day) -> AnyShapeStyle {
        guard day.isFestival else { return AnyShapeStyle(.secondary) }
        if day.isStatutoryHoliday { return AnyShapeStyle(holidayColor) }
        return AnyShapeStyle(.themeText)
    }

    private func courseDots(_ day: Day) -> some View {
        HStack(spacing: 3) {
            ForEach(Array(day.courses.prefix(3).enumerated()), id: \.offset) { _, block in
                Circle().fill(courseAccent(block)).frame(width: 4, height: 4)
            }
            if day.courses.count > 3 {
                Circle().fill(Color.secondary.opacity(0.4)).frame(width: 3, height: 3)
            }
        }
        .frame(height: 6)
        .opacity(day.inMonth ? 1 : 0.5)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func styledLabel(_ day: Day) -> some View {
        let isSelected = day.date == selectedDate
        let isToday = day.date == todayDate
        let outsideOpacity = day.inMonth ? 1.0 : 0.65
        let height = rowHeight
        switch style {
        case .grid:
            VStack(spacing: 2) {
                dateNumber(day, isSelected: isSelected, isToday: isToday)
                Text(day.subtitle.isEmpty ? " " : day.subtitle)
                    .font(.system(size: 9, weight: day.isFestival ? .medium : .regular, design: style.fontDesign))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(subtitleColor(day))
                courseDots(day)
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .opacity(outsideOpacity)
            .background {
                ZStack {
                    RoundedRectangle(cornerRadius: style.layout.cornerRadius)
                        .fill(Color.scheduleCellSurface(hasBackground: hasBackground, dark: dark))
                    if day.adjustment?.kind == "off" {
                        RoundedRectangle(cornerRadius: style.layout.cornerRadius).fill(holidayColor.opacity(0.14))
                    }
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: style.layout.cornerRadius, style: .continuous)
                    .strokeBorder(isToday || isSelected ? accent : rule,
                                  lineWidth: isToday || isSelected ? style.layout.borderWidth : 0.7)
            }
            .overlay(alignment: .topTrailing) { adjustmentBadge(day.adjustment).padding(2) }
        case .table:
            VStack(alignment: .leading, spacing: 2) {
                // The lunar date shares the date's line; on its own line a short
                // cell could not fit two courses. It shrinks, then drops, before
                // the date and the badge do.
                ViewThatFits(in: .horizontal) {
                    tableDateRow(day, isSelected: isSelected, isToday: isToday, subtitleSize: 9)
                    tableDateRow(day, isSelected: isSelected, isToday: isToday, subtitleSize: 7)
                    tableDateRow(day, isSelected: isSelected, isToday: isToday, subtitleSize: nil)
                }
                .padding(.horizontal, 3)
                .padding(.top, 3)
                ForEach(Array(day.courses.prefix(2))) { block in
                    HStack(spacing: 2) {
                        Rectangle().fill(courseAccent(block)).frame(width: 2)
                        Text(Self.shortName(block))
                            .font(.system(size: 9, weight: .semibold, design: style.textDesign))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(height: 12)
                    .background(courseFill(block))
                    .padding(.horizontal, 2)
                }
                if day.courses.count > 2 {
                    Text("+\(day.courses.count - 2)")
                        .font(.system(size: 9, weight: .semibold, design: style.fontDesign))
                        .foregroundStyle(ink.opacity(0.7))
                        .padding(.leading, 4)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: height, alignment: .top)
            .opacity(outsideOpacity)
            .background(isToday ? accent.opacity(dark ? 0.18 : 0.10) : Color.clear)
            .background(day.weekday >= 6 ? ink.opacity(0.04) : Color.clear)
            // Each cell rules only its trailing and bottom edges, so a shared edge is drawn once.
            .overlay(alignment: .trailing) {
                if day.weekday < 7 { Rectangle().fill(rule).frame(width: 0.6) }
            }
            .overlay(alignment: .bottom) { Rectangle().fill(rule).frame(height: 0.6) }
        case .paper:
            VStack(spacing: 1) {
                ZStack(alignment: .topTrailing) {
                    dateNumber(day, isSelected: isSelected, isToday: isToday)
                    adjustmentBadge(day.adjustment).offset(x: 7, y: -2)
                }
                Text(day.subtitle.isEmpty ? " " : day.subtitle)
                    .font(.system(size: 10, weight: day.isFestival ? .semibold : .regular, design: style.fontDesign))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(subtitleColor(day))
                // An ink stroke that grows with the number of courses.
                Rectangle()
                    .fill(ink.opacity(day.courses.isEmpty ? 0.18 : 0.62))
                    .frame(width: day.courses.isEmpty ? 8 : min(24, 6 + CGFloat(day.courses.count) * 4), height: 1.5)
                    .padding(.top, 2)
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .opacity(outsideOpacity)
            .background(isSelected ? accent.opacity(0.08) : Color.clear)
            .overlay(alignment: .bottom) {
                if isSelected { Rectangle().fill(accent).frame(width: 16, height: 2) }
            }
        case .board:
            VStack(spacing: 3) {
                Text(String(format: "%02d", day.number))
                    .font(.system(size: 17, weight: isToday || isSelected ? .bold : .semibold, design: .monospaced))
                    .underline(isToday)
                Text(day.courses.isEmpty ? "—" : "\(day.courses.count) 门")
                    .font(.system(size: 9, weight: .medium))
                    .lineLimit(1)
                Text(day.subtitle.isEmpty ? " " : day.subtitle)
                    .font(.system(size: 9, design: .monospaced))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .opacity(outsideOpacity)
            .foregroundStyle(isSelected ? onAccent : ink)
            .background(isSelected ? ink : Color.clear)
            .overlay(alignment: .topTrailing) {
                if day.adjustment != nil {
                    adjustmentBadge(day.adjustment).padding(2).background(style.canvasColor(dark: dark))
                }
            }
        case .minimal, .classic:
            EmptyView()
        }
    }

    private func tableDateRow(_ day: Day, isSelected: Bool, isToday: Bool, subtitleSize: CGFloat?) -> some View {
        HStack(spacing: 2) {
            dateNumber(day, isSelected: isSelected, isToday: isToday)
            adjustmentBadge(day.adjustment)
            if let subtitleSize, !day.subtitle.isEmpty {
                Text(day.subtitle)
                    .font(.system(size: subtitleSize))
                    .foregroundStyle(subtitleColor(day))
                    .lineLimit(1)
                    .fixedSize()
            }
            Spacer(minLength: 0)
        }
    }

    private func dateNumber(_ day: Day, isSelected: Bool, isToday: Bool) -> some View {
        Text("\(day.number)")
            .font(.system(size: style == .paper ? 19 : (style == .table ? 14 : 16),
                          weight: isSelected || isToday ? .bold : .medium,
                          design: style.fontDesign))
            .monospacedDigit()
            .foregroundStyle(numberColor(day, isSelected: isSelected, isToday: isToday))
            .frame(width: style == .table ? nil : 32, height: style == .table ? 22 : 30)
            .padding(.horizontal, style == .table ? 2 : 0)
            .background {
                if isSelected && style != .paper && style != .board {
                    RoundedRectangle(cornerRadius: 4, style: .continuous).fill(fill)
                } else if isToday && style == .paper {
                    Circle().stroke(accent, lineWidth: 1.3)
                }
            }
    }

    private func numberColor(_ day: Day, isSelected: Bool, isToday: Bool) -> Color {
        if isSelected && style != .paper && style != .board { return onAccent }
        if isToday && style != .board { return accent }
        if day.adjustment?.kind == "off" || day.isStatutoryHoliday {
            return style == .paper ? accent : holidayColor
        }
        return ink
    }

    private func subtitleColor(_ day: Day) -> Color {
        if day.isStatutoryHoliday { return style == .paper ? accent : holidayColor }
        if day.isFestival || day.date == todayDate { return accent }
        return ink.opacity(contrast == .increased ? 0.9 : 0.72)
    }

    @ViewBuilder
    private func adjustmentBadge(_ adjustment: NativeScheduleAdjustment?) -> some View {
        if let adjustment {
            if style == .paper || style == .board {
                Text(adjustment.kind == "off" ? "休" : "班")
                    .font(.system(size: 9, weight: .bold, design: style.fontDesign))
                    .foregroundStyle(adjustment.kind == "off" ? onAccent : ink)
                    .frame(width: 12, height: 12)
                    .background(adjustment.kind == "off" ? accent : Color.clear)
                    .overlay { Rectangle().stroke(ink, lineWidth: adjustment.kind == "off" ? 0 : 1) }
                    .accessibilityHidden(true)
            } else {
                ScheduleAdjustmentBadge(kind: adjustment.kind)
            }
        }
    }

    // MARK: Selected day

    private var summary: some View {
        let courses = days.first { $0.date == selectedDate }?.courses ?? []
        return VStack(alignment: .leading, spacing: style == .paper ? 10 : 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(selectedTitle)
                            .font(.system(size: style == .paper ? 17 : 16,
                                          weight: style == .board ? .bold : .semibold,
                                          design: style.textDesign))
                        if selectedDate == todayDate {
                            Text(style == .paper ? "今日" : "今天")
                                .font(.system(size: 10, weight: .bold, design: style.fontDesign))
                                .foregroundStyle(style == .paper || style == .board ? onAccent : accent)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background {
                                    if style == .paper || style == .board {
                                        Rectangle().fill(style == .board ? ink : accent)
                                    } else {
                                        Capsule().fill(accent.opacity(0.14))
                                    }
                                }
                        }
                    }
                    Text(selectedSubtitle)
                        .font(.system(size: 11, design: style.textDesign))
                        .foregroundStyle(ink.opacity(0.72))
                }
                Spacer(minLength: 8)
                if canOpenDay {
                    Button(action: onOpenDay) {
                        Label("日视图", systemImage: "calendar.day.timeline.left")
                            .font(.system(size: 11, weight: .semibold, design: style.textDesign))
                            .labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(style == .board ? ink.opacity(0.72) : accent)
                }
            }
            if let adjustmentText {
                Label(adjustmentText, systemImage: "calendar.badge.exclamationmark")
                    .font(.system(size: 11, design: style.textDesign))
                    .foregroundStyle(style == .paper || style == .board ? accent : holidayColor)
            }
            if let emptyText {
                Text(emptyText)
                    .font(.system(.footnote, design: style.textDesign))
                    .foregroundStyle(ink.opacity(0.72))
                    .padding(.vertical, 6)
            } else {
                VStack(spacing: style == .paper ? 4 : 6) {
                    ForEach(courses) { block in
                        Button { onCourseSelected(block) } label: { courseRow(block) }
                            .buttonStyle(.plain)
                            .accessibilityHint("查看课程详情")
                    }
                }
            }
        }
        .padding(.horizontal, style == .table ? 10 : 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func metadata(_ block: NativeScheduleCourseBlock) -> String {
        [
            showLocation ? ScheduleStyleTime.location(block.course.location) : nil,
            showTeacher ? block.course.teacher?.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
            block.startSlot == block.endSlot ? "第 \(block.startSlot) 节" : "第 \(block.startSlot)–\(block.endSlot) 节",
        ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func startTime(_ block: NativeScheduleCourseBlock) -> String {
        periods.first { $0.number == block.startSlot }?.startTime ?? "--:--"
    }

    private func endTime(_ block: NativeScheduleCourseBlock) -> String {
        periods.first { $0.number == block.endSlot }?.endTime ?? startTime(block)
    }

    @ViewBuilder
    private func courseRow(_ block: NativeScheduleCourseBlock) -> some View {
        let tint = ScheduleStyleCourseColor(name: block.course.name, palette: palette)
        let courseAccent = tint.accent(dark: dark)
        if style == .minimal {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(block.course.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(metadata(block)).font(.caption).lineLimit(1)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(startTime(block)).font(.caption.weight(.semibold))
                    Text(endTime(block)).font(.caption2)
                }
                .monospacedDigit()
            }
            .foregroundStyle(courseAccent)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(tint.fill(dark: dark, hasBackground: hasBackground),
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(Rectangle())
        } else {
            HStack(spacing: 10) {
                VStack(alignment: style == .board ? .leading : .trailing, spacing: 3) {
                    Text(startTime(block))
                        .font(.system(.subheadline, design: style.fontDesign).weight(.semibold))
                    Text(endTime(block)).font(.system(.caption2, design: style.fontDesign))
                }
                .monospacedDigit()
                .fixedSize(horizontal: true, vertical: false)
                .foregroundStyle(style == .board ? onAccent : ink)
                .padding(.horizontal, style == .board ? 6 : 0)
                .padding(.vertical, style == .board ? 6 : 0)
                .background(style == .board ? ink : Color.clear)
                Rectangle().fill(courseAccent)
                    .frame(width: style == .paper ? 2 : 3)
                    .padding(.vertical, 10)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(block.course.name)
                        .font(.system(.body, design: style.textDesign).weight(.semibold))
                        .lineLimit(2)
                    Text(metadata(block))
                        .font(.system(.footnote, design: style.textDesign))
                        .foregroundStyle(ink.opacity(contrast == .increased ? 0.9 : 0.74))
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, style == .paper ? 0 : 10)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(ink)
            .background {
                if style == .grid {
                    RoundedRectangle(cornerRadius: style.layout.cornerRadius)
                        .fill(tint.fill(dark: dark, hasBackground: hasBackground))
                } else if style == .table {
                    ink.opacity(dark ? 0.06 : 0.035)
                }
            }
            .overlay {
                if style == .grid {
                    RoundedRectangle(cornerRadius: style.layout.cornerRadius)
                        .strokeBorder(courseAccent, lineWidth: style.layout.borderWidth)
                }
            }
            .overlay(alignment: .bottom) {
                if style != .grid {
                    Rectangle().fill(rule).frame(height: style == .board ? 1.5 : 0.6)
                }
            }
            .contentShape(Rectangle())
        }
    }

    private func courseAccent(_ block: NativeScheduleCourseBlock) -> Color {
        ScheduleStyleCourseColor(name: block.course.name, palette: palette).accent(dark: dark)
    }

    private func courseFill(_ block: NativeScheduleCourseBlock) -> Color {
        ScheduleStyleCourseColor(name: block.course.name, palette: palette).fill(dark: dark, hasBackground: hasBackground)
    }

    /// At most four characters a row; the full name stays in the summary and for VoiceOver.
    private static func shortName(_ block: NativeScheduleCourseBlock) -> String {
        let name = block.course.name.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.count <= 4 ? name : String(name.prefix(3)) + "…"
    }

    private static func chineseNumber(_ value: Int) -> String {
        let digits = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
        guard (0...31).contains(value) else { return String(value) }
        if value < 10 { return digits[value] }
        let tens = value < 20 ? "十" : digits[value / 10] + "十"
        return tens + (value % 10 == 0 ? "" : digits[value % 10])
    }

    /// "二〇二六年 · 十月"
    private static func paperMonthTitle(_ date: String) -> String {
        let parts = date.split(separator: "-")
        let digits = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
        guard parts.count == 3, let month = Int(parts[1]) else { return date }
        let year = parts[0].compactMap { $0.wholeNumberValue }.map { digits[$0] }.joined()
        return year + "年 · " + chineseNumber(month) + "月"
    }
}
