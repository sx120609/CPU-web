import SwiftUI

/// The month page of the NapTable styles: a calendar whose cells list the
/// day's courses, one name a line. Tapping a day of the term opens its day
/// view. Month data stays in `NativeScheduleMonthView`; this view only draws it.
@available(iOS 17.0, *)
struct ScheduleStyledMonthPage: View {
    let days: [NativeScheduleMonthView.Day]
    let todayDate: String?
    let accessibilityLabel: (NativeScheduleMonthView.Day) -> String
    let onDay: (NativeScheduleMonthView.Day) -> Void
    /// Dragging the calendar up or down turns the month: 1 is the next one.
    var onMoveMonth: (Int) -> Void = { _ in }

    @Environment(\.scheduleCouple) private var couple
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

    /// Taller while the partner's count sits under the user's courses.
    private var rowHeight: CGFloat { couple == nil ? 92 : 108 }

    var body: some View {
        grid
            .modifier(ScheduleMonthSwipe(onMove: onMoveMonth))
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
                    Rectangle().strokeBorder(rule, lineWidth: 0.6).allowsHitTesting(false)
                }
            }
            .frame(maxWidth: .infinity, alignment: .top)
    }

    // MARK: Calendar

    private var grid: some View {
        let rows = rows
        return VStack(spacing: style == .grid || style == .minimal ? 6 : 0) {
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
                // The board is divided by a heavy rule under the weekdays.
                Rectangle().fill(boardRule).frame(height: 2)
            }
            VStack(spacing: style == .grid ? 5 : (style == .minimal ? 2 : 0)) {
                ForEach(rows, id: \.first?.date) { row in
                    HStack(spacing: style == .grid ? 5 : (style == .minimal ? 2 : 0)) {
                        ForEach(row) { day in cell(day) }
                    }
                    .overlay(alignment: .bottom) {
                        if style == .board && row.first?.date != rows.last?.first?.date {
                            Rectangle().fill(ink.opacity(dark ? 0.24 : 0.16)).frame(height: 0.6)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, style == .table || style == .board ? 0 : 10)
        // The table's heading fill and rules have to meet its frame.
        .padding(.top, style == .paper ? 12 : (style == .table ? 0 : (style == .minimal ? 12 : 8)))
        .padding(.bottom, style == .paper ? 12 : (style == .table || style == .board ? 0 : 8))
    }

    private var squared: Bool { style == .table || style == .paper || style == .board }

    private func cell(_ day: Day) -> some View {
        let isToday = day.date == todayDate
        let radius: CGFloat = style == .grid ? 8 : 10
        return Button { onDay(day) } label: {
            VStack(spacing: 1) {
                Text("\(day.number)")
                    .font(.system(size: 14, weight: isToday ? .bold : .semibold,
                                  design: style == .board ? .monospaced : style.fontDesign))
                    .monospacedDigit()
                    .foregroundStyle(isToday ? onAccent : numberColor(day))
                    .frame(minWidth: 22, minHeight: 22)
                    .background {
                        // Today's date sits in a disc of the theme colour.
                        if isToday { RoundedRectangle(cornerRadius: squared ? 0 : 11, style: .continuous).fill(fill) }
                    }
                Text(day.subtitle.isEmpty ? " " : day.subtitle)
                    .font(.system(size: 9, weight: day.isFestival ? .medium : .regular, design: style.fontDesign))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(subtitleColor(day))
                ScheduleMonthCourseLines(
                    lines: lines(day), partner: partner(day), radius: squared ? 0 : 3,
                    meta: ink.opacity(0.62), design: style.textDesign
                )
                .padding(.top, 1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 2)
            .padding(.top, 3)
            .frame(maxWidth: .infinity)
            .frame(height: rowHeight, alignment: .top)
            .opacity(day.inMonth ? 1 : 0.45)
            .background {
                switch style {
                case .grid:
                    ZStack {
                        RoundedRectangle(cornerRadius: radius).fill(Color.scheduleCellSurface(hasBackground: hasBackground, dark: dark))
                        if day.adjustment?.kind == "off" { RoundedRectangle(cornerRadius: radius).fill(holidayColor.opacity(0.14)) }
                    }
                case .table:
                    ZStack {
                        if day.weekday >= 6 { ink.opacity(0.04) }
                        if isToday { accent.opacity(dark ? 0.18 : 0.10) }
                    }
                default: Color.clear
                }
            }
            .overlay {
                if style == .grid {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(isToday ? fill : rule, lineWidth: isToday ? style.layout.borderWidth : 0.7)
                }
            }
            // The table rules only the trailing and bottom edges, so a shared edge is drawn once.
            .overlay(alignment: .trailing) {
                if style == .table, day.weekday < 7 { Rectangle().fill(rule).frame(width: 0.6) }
            }
            .overlay(alignment: .bottom) {
                if style == .table { Rectangle().fill(rule).frame(height: 0.6) }
            }
            .overlay(alignment: .topTrailing) { adjustmentBadge(day.adjustment).padding(2) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel(day))
        .accessibilityAddTraits(.isButton)
    }

    /// The day's courses, one name each. While the partner's courses are
    /// shown every one of the user's takes the user's colour.
    private func lines(_ day: Day) -> [ScheduleMonthCourseLines.Line] {
        let mine = couple.map { CoupleRules.personTone(color: $0.myColor, dark: dark) }
        return NativeScheduleMonthView.courseNames(day.courses).map { name in
            if let mine { return .init(name: name, text: mine.text.color, fill: mine.fill.color) }
            let color = ScheduleStyleCourseColor(name: name, palette: palette)
            return .init(name: name, text: color.accent(dark: dark), fill: color.fill(dark: dark, hasBackground: hasBackground))
        }
    }

    private func partner(_ day: Day) -> ScheduleMonthCourseLines.Partner? {
        guard let couple, day.partnerCourses > 0 else { return nil }
        return .init(count: day.partnerCourses, tint: CoupleRules.personTone(color: couple.partnerColor, dark: dark))
    }

    private func numberColor(_ day: Day) -> Color {
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

/// The courses inside a day cell of the month view: one name a line, at most
/// three lines, and the partner's count on a line of its own.
@available(iOS 17.0, *)
struct ScheduleMonthCourseLines: View {
    struct Line: Hashable {
        let name: String
        let text: Color
        let fill: Color
    }

    struct Partner {
        let count: Int
        let tint: CoupleTint
    }

    let lines: [Line]
    var partner: Partner? = nil
    var radius: CGFloat = 3
    var meta: Color = .secondary
    var design: Font.Design = .default

    var body: some View {
        // More than three: the first two and how many are left.
        let shown = lines.count > 3 ? Array(lines.prefix(2)) : lines
        VStack(spacing: 1) {
            ForEach(shown, id: \.name) { line in
                Text(line.name)
                    .font(.system(size: 10, weight: .semibold, design: design))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .foregroundStyle(line.text)
                    .padding(.horizontal, 2)
                    .frame(maxWidth: .infinity, minHeight: 14, maxHeight: 14, alignment: .leading)
                    .background(line.fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            }
            if lines.count > 3 {
                Text("+\(lines.count - 2)")
                    .font(.system(size: 9, weight: .semibold, design: design))
                    .foregroundStyle(meta)
                    .frame(maxWidth: .infinity, minHeight: 12, maxHeight: 12, alignment: .leading)
                    .padding(.leading, 2)
            }
            if let partner {
                HStack(spacing: 2) {
                    Text("TA").font(.system(size: 8, weight: .heavy)).tracking(0.3)
                    Text("\(partner.count) 门").font(.system(size: 9, weight: .semibold))
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .foregroundStyle(partner.tint.text.color)
                .frame(maxWidth: .infinity, minHeight: 14, maxHeight: 14)
                .background(partner.tint.fill.color, in: Capsule())
                .padding(.top, 1)
            }
        }
        .accessibilityHidden(true)
    }
}
