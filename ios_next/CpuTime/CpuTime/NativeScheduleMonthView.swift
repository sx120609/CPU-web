import SwiftUI

/// 月视图：课表界面的第三种视图，和「日」「周」共用同一个顶栏切换。
///
/// 周视图和日视图都是按节次画网格的课表；月视图不再画网格，而是一张日历：每天一
/// 格，格子里是公历日、农历/节日，下面直接列出当天的课，一门一行，放不下的收成
/// 「+N」。点教学周内的一天进入那天的日视图。教学周信息保留在每行左侧的「周」栏
/// 里，这样月历和学期周次仍能对上。

/// 上下拖动月历换月：格子跟着手指走，拖过一段距离就翻到下一个月或上一个月，
/// 新的一页从拖来的那一边滑进来；不够就弹回去。
@available(iOS 17.0, *)
struct ScheduleMonthSwipe: ViewModifier {
    let onMove: (Int) -> Void
    @State private var pull: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .offset(y: pull)
            .opacity(1 - min(0.6, Double(abs(pull)) / 86))
            .contentShape(Rectangle())
            .highPriorityGesture(
                DragGesture(minimumDistance: 12)
                    .onChanged { value in
                        guard abs(value.translation.height) > abs(value.translation.width) else { return }
                        pull = value.translation.height * 0.55
                    }
                    .onEnded { value in
                        let distance = value.translation.height
                        if abs(distance) >= 44, abs(distance) > abs(value.translation.width) {
                            let delta = distance < 0 ? 1 : -1
                            onMove(delta)
                            pull = delta > 0 ? 36 : -36
                        }
                        withAnimation(.easeOut(duration: 0.22)) { pull = 0 }
                    }
            )
    }
}

@available(iOS 17.0, *)
struct NativeScheduleMonthView: View {
    /// 所显示月份里的任意一天（`yyyy-MM-dd`）。
    let monthAnchor: String
    let todayDate: String?
    /// 日期 -> (教学周, 星期几)。来自课表日历，学期外的日期查不到。
    let dateIndex: [String: NativeScheduleMonthView.DaySlot]
    /// (星期几, 教学周) -> 当天课程。调休已经在里面解析过了。
    let blocks: (Int, Int) -> [NativeScheduleCourseBlock]
    /// 日期 -> 这一天的调休安排。
    let adjustments: [String: NativeScheduleAdjustment]
    let palette: String
    /// 情侣课表：日期 -> TA 这一天有几门不同的课。
    var partnerCourses: (String) -> Int = { _ in 0 }
    let canOpenDay: (String) -> Bool
    let onOpenDay: (String) -> Void
    /// 上下拖动月历换月：1 是下一个月，-1 是上一个月。
    var onMoveMonth: (Int) -> Void = { _ in }

    struct DaySlot: Equatable {
        let week: Int
        let day: Int
    }

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleStyle) private var style
    @Environment(\.scheduleCouple) private var couple

    private static let weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"]
    private static let gutterWidth: CGFloat = 26
    private static let gridInset: CGFloat = 8
    private static let columnSpacing: CGFloat = 2

    var body: some View {
        // 每月铺满整周；农历与课程数据只构建一次。
        let days = buildDays()
        if style == .classic {
            GeometryReader { geometry in
                let dayWidth = max(1, (geometry.size.width - 2 * Self.gridInset - Self.gutterWidth - 7 * Self.columnSpacing) / 7)
                monthGrid(days, dayWidth: dayWidth)
            }
            .frame(height: CGFloat(weeks(days).count) * (rowHeight + 6) + 38)
            .modifier(ScheduleMonthSwipe(onMove: onMoveMonth))
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            ScheduleStyledMonthPage(
                days: days, todayDate: todayDate, accessibilityLabel: accessibilityLabel,
                onDay: open, onMoveMonth: onMoveMonth
            )
        }
    }

    /// 双人模式下多一行「TA N 门」，格子高一点。
    private var rowHeight: CGFloat { couple == nil ? 88 : 104 }

    /// 教学周内的一天进日视图；学期外的日期点了没有反应。
    private func open(_ day: Day) {
        if canOpenDay(day.date) { onOpenDay(day.date) }
    }

    /// 一天的课名：同名的只算一门，按上课先后。
    static func courseNames(_ blocks: [NativeScheduleCourseBlock]) -> [String] {
        var seen = Set<String>()
        return blocks.sorted { ($0.startSlot, $0.endSlot) < ($1.startSlot, $1.endSlot) }
            .map { $0.course.name.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    // MARK: 月历

    private func monthGrid(_ days: [Day], dayWidth: CGFloat) -> some View {
        VStack(spacing: 6) {
            HStack(spacing: Self.columnSpacing) {
                Text("周")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .frame(width: Self.gutterWidth)
                ForEach(Array(Self.weekdayLabels.enumerated()), id: \.offset) { index, label in
                    Text(label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(index >= 5 ? Color.pink.opacity(0.8) : Color.secondary)
                        .frame(width: dayWidth)
                }
            }

            ForEach(weeks(days), id: \.first?.date) { row in
                HStack(spacing: Self.columnSpacing) {
                    Text(row.compactMap { dateIndex[$0.date]?.week }.first.map(String.init) ?? "")
                        .font(.caption2.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.tertiary)
                        .frame(width: Self.gutterWidth)
                    ForEach(row) { day in
                        dayCell(day)
                            .frame(width: dayWidth)
                    }
                }
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, Self.gridInset)
        .background { NativeScheduleBackgroundSurface() }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func dayCell(_ day: Day) -> some View {
        let isToday = day.date == todayDate
        let dark = colorScheme == .dark
        let mine = couple.map { CoupleRules.personTone(color: $0.myColor, dark: dark) }
        let lines = Self.courseNames(day.courses).map { name -> ScheduleMonthCourseLines.Line in
            if let mine { return .init(name: name, text: mine.text.color, fill: mine.fill.color) }
            let tone = NativeSchedulePalette.tone(name: name, palette: palette, dark: dark)
            return .init(name: name, text: tone.text.color, fill: tone.top.color)
        }
        let partner = couple.flatMap { layer in
            day.partnerCourses > 0
                ? ScheduleMonthCourseLines.Partner(count: day.partnerCourses, tint: CoupleRules.personTone(color: layer.partnerColor, dark: dark))
                : nil
        }
        return Button {
            open(day)
        } label: {
            VStack(spacing: 1) {
                Text("\(day.number)")
                    .font(.system(size: 14, weight: isToday ? .bold : .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(isToday ? Color.white : numberColor(day))
                    .frame(minWidth: 22, minHeight: 22)
                    // 今天的日期放在主题色的圆里。
                    .background { if isToday { Circle().fill(Color.cpuBrand) } }
                Text(day.subtitle.isEmpty ? " " : day.subtitle)
                    .font(.system(size: 9, weight: day.isFestival ? .bold : .regular))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(subtitleColor(day))
                ScheduleMonthCourseLines(lines: lines, partner: partner).padding(.top, 1)
                Spacer(minLength: 0)
            }
            .padding(.top, 2)
            .frame(maxWidth: .infinity)
            .frame(height: rowHeight, alignment: .top)
            .opacity(day.inMonth ? 1 : 0.45)
            .overlay(alignment: .topTrailing) {
                if let adjustment = day.adjustment {
                    Text(adjustment.kind == "off" ? "休" : "班")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.white)
                        .fixedSize()
                        .frame(width: 13, height: 13, alignment: .center)
                        // 小字号汉字做光学居中，仅移动文字，不移动底色。
                        .offset(x: 0.3)
                        .background(
                            (adjustment.kind == "off" ? Color.pink : Color.orange).opacity(0.9),
                            in: RoundedRectangle(cornerRadius: 3, style: .continuous)
                        )
                        .opacity(day.inMonth ? 1 : 0.45)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel(day))
        .accessibilityAddTraits(.isButton)
    }

    private func numberColor(_ day: Day) -> Color {
        if day.isStatutoryHoliday { return .pink }
        return day.weekday >= 6 ? Color.pink.opacity(0.85) : .primary
    }

    private func subtitleColor(_ day: Day) -> Color {
        if day.isStatutoryHoliday { return .pink }
        if day.isFestival { return Color.cpuBrand }
        return .secondary
    }

    private func accessibilityLabel(_ day: Day) -> String {
        var parts = ["\(day.number) 日", day.subtitle]
        if let slot = dateIndex[day.date] { parts.append("第 \(slot.week) 周") }
        if let adjustment = day.adjustment { parts.append(adjustmentText(adjustment)) }
        let names = Self.courseNames(day.courses)
        parts.append(names.isEmpty ? "没有课程" : names.joined(separator: "、"))
        if couple != nil, day.partnerCourses > 0 { parts.append("TA \(day.partnerCourses) 门课") }
        return parts.joined(separator: "，")
    }

    private func adjustmentText(_ adjustment: NativeScheduleAdjustment) -> String {
        if adjustment.kind == "swap", adjustment.source?.isEmpty != false { return "补班，课程待确认" }
        let note = adjustment.note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !note.isEmpty { return note }
        if adjustment.kind == "off" { return "放假，不上课" }
        guard let source = adjustment.source else { return "调课" }
        let parts = source.split(separator: "-")
        return parts.count == 3 ? "上 \(parts[1]).\(parts[2]) 的课" : "调课"
    }

    // MARK: 月份网格数据

    struct Day: Identifiable {
        let date: String
        let number: Int
        let inMonth: Bool
        /// 1...7，周一为 1。
        let weekday: Int
        let subtitle: String
        let isFestival: Bool
        let isStatutoryHoliday: Bool
        let adjustment: NativeScheduleAdjustment?
        let courses: [NativeScheduleCourseBlock]
        /// 情侣课表：TA 这一天有几门不同的课。
        var partnerCourses = 0

        var id: String { date }
    }

    private func weeks(_ days: [Day]) -> [[Day]] {
        stride(from: 0, to: days.count, by: 7).map { Array(days[$0..<min($0 + 7, days.count)]) }
    }

    private func buildDays() -> [Day] {
        let calendar = ChineseCalendarInfo.gregorian
        guard let anchor = ChineseCalendarInfo.date(fromDate: monthAnchor),
              let monthRange = calendar.range(of: .day, in: .month, for: anchor),
              let firstOfMonth = calendar.date(from: calendar.dateComponents([.year, .month], from: anchor)) else {
            return []
        }
        let month = calendar.component(.month, from: anchor)
        // 网格从这个月第一天所在的周一开始，铺满整周为止。
        let leading = (calendar.component(.weekday, from: firstOfMonth) + 5) % 7
        let total = Int(ceil(Double(leading + monthRange.count) / 7)) * 7
        return (0..<total).compactMap { offset -> Day? in
            guard let date = calendar.date(byAdding: .day, value: offset - leading, to: firstOfMonth) else { return nil }
            let key = ChineseCalendarInfo.dateString(date)
            let info = ChineseCalendarInfo.info(forDate: key)
            let slot = dateIndex[key]
            let weekdayIndex = (calendar.component(.weekday, from: date) + 5) % 7 + 1
            return Day(
                date: key,
                number: calendar.component(.day, from: date),
                inMonth: calendar.component(.month, from: date) == month,
                weekday: weekdayIndex,
                subtitle: info?.displayLabel ?? "",
                isFestival: info?.badge != nil,
                isStatutoryHoliday: info?.isStatutoryHoliday ?? false,
                adjustment: adjustments[key],
                courses: slot.map { blocks($0.day, $0.week) } ?? [],
                partnerCourses: partnerCourses(key)
            )
        }
    }
}
