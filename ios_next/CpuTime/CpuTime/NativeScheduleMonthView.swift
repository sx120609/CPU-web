import SwiftUI

/// 月视图：课表界面的第三种视图，和「日」「周」共用同一个顶栏切换。
///
/// 周视图和日视图都是按节次画网格的课表；月视图不再画网格，而是一张日历：每天一
/// 格，格子里是公历日、农历/节日和当天课程的彩色圆点，下面跟着所选那天的课程清
/// 单。教学周信息保留在每行左侧的「周」栏里，这样月历和学期周次仍能对上。
struct NativeScheduleMonthView: View {
    /// 所显示月份里的任意一天（`yyyy-MM-dd`）。
    let monthAnchor: String
    let selectedDate: String
    let todayDate: String?
    /// 日期 -> (教学周, 星期几)。来自课表日历，学期外的日期查不到。
    let dateIndex: [String: NativeScheduleMonthView.DaySlot]
    /// (星期几, 教学周) -> 当天课程。调休已经在里面解析过了。
    let blocks: (Int, Int) -> [NativeScheduleCourseBlock]
    /// 日期 -> 这一天的调休安排。
    let adjustments: [String: NativeScheduleAdjustment]
    let palette: String
    let periods: [NativeSchedulePeriod]
    let showLocation: Bool
    let showTeacher: Bool
    let canOpenDay: (String) -> Bool
    let onSelect: (String) -> Void
    let onOpenDay: (String) -> Void
    /// 第二个参数是被点的那一天，调课时课程归属要按它换算。
    let onCourseSelected: (NativeScheduleCourseBlock, String) -> Void

    struct DaySlot: Equatable {
        let week: Int
        let day: Int
    }

    @Environment(\.colorScheme) private var colorScheme

    private static let weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"]
    private static let gutterWidth: CGFloat = 26
    private static let gridInset: CGFloat = 8
    private static let columnSpacing: CGFloat = 2

    var body: some View {
        // 每月铺满整周；农历与课程数据只构建一次。
        let days = buildDays()
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { geometry in
                let dayWidth = max(1, (geometry.size.width - 2 * Self.gridInset - Self.gutterWidth - 7 * Self.columnSpacing) / 7)
                monthGrid(days, dayWidth: dayWidth)
            }
            .frame(height: CGFloat(weeks(days).count) * 56 + 38)
            selectedDayCard(days)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func dayCell(_ day: Day) -> some View {
        let isSelected = day.date == selectedDate
        let isToday = day.date == todayDate
        return Button {
            onSelect(day.date)
        } label: {
            VStack(spacing: 1) {
                Text("\(day.number)")
                    .font(.system(size: 16, weight: isToday || isSelected ? .bold : .medium, design: .rounded))
                    .foregroundStyle(numberColor(day, isSelected: isSelected, isToday: isToday))
                Text(day.subtitle)
                    .font(.system(size: 9, weight: day.isFestival ? .bold : .regular))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(subtitleColor(day, isSelected: isSelected))
                    .opacity(day.inMonth ? 1 : 0.4)
                courseDots(day)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
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
                        .padding(.top, 1)
                        .padding(.trailing, 1)
                        .opacity(day.inMonth ? 1 : 0.45)
                }
            }
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.cpuBrand.opacity(0.16))
                } else if isToday {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(Color.cpuBrand.opacity(0.45), lineWidth: 1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel(day))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : [.isButton])
    }

    private func courseDots(_ day: Day) -> some View {
        HStack(spacing: 2) {
            ForEach(Array(day.courses.prefix(3).enumerated()), id: \.offset) { _, block in
                Circle()
                    .fill(NativeScheduleThemeColor.accent(for: block.course.name, palette: palette, scheme: colorScheme))
                    .frame(width: 4, height: 4)
            }
            if day.courses.count > 3 {
                Text("+")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(height: 5)
        .opacity(day.inMonth ? 1 : 0.45)
    }

    private func numberColor(_ day: Day, isSelected: Bool, isToday: Bool) -> Color {
        guard day.inMonth else { return .secondary.opacity(0.45) }
        if isToday || isSelected { return Color.cpuBrand }
        if day.isStatutoryHoliday { return .pink }
        return day.weekday >= 6 ? Color.pink.opacity(0.85) : .primary
    }

    private func subtitleColor(_ day: Day, isSelected: Bool) -> Color {
        if day.isStatutoryHoliday { return .pink }
        if day.isFestival { return Color.cpuBrand }
        return .secondary
    }

    private func accessibilityLabel(_ day: Day) -> String {
        var parts = ["\(day.number) 日", day.subtitle]
        if let slot = dateIndex[day.date] { parts.append("第 \(slot.week) 周") }
        if let adjustment = day.adjustment { parts.append(adjustmentText(adjustment)) }
        parts.append(day.courses.isEmpty ? "没有课程" : "\(day.courses.count) 门课程")
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

    // MARK: 选中那天

    private func selectedDayCard(_ days: [Day]) -> some View {
        let day = days.first { $0.date == selectedDate }
        let courses = day?.courses ?? []
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(selectedTitle(days))
                        .font(.headline)
                    Text(selectedSubtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if canOpenDay(selectedDate) {
                    Button {
                        onOpenDay(selectedDate)
                    } label: {
                        Label("日视图", systemImage: "calendar.day.timeline.left")
                            .font(.caption.weight(.semibold))
                            .labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.cpuBrand)
                }
            }

            if let adjustment = adjustments[selectedDate] {
                Label(adjustmentText(adjustment), systemImage: "calendar.badge.exclamationmark")
                    .font(.caption)
                    .foregroundStyle(adjustment.kind == "off" ? Color.pink : Color.orange)
            }

            if dateIndex[selectedDate] == nil {
                Text("这一天不在当前学期的教学周内。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if courses.isEmpty {
                Text(adjustments[selectedDate]?.kind == "off" ? "这一天放假，没有课程。" : "这一天没有课程。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(courses) { block in
                    agendaRow(block)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func agendaRow(_ block: NativeScheduleCourseBlock) -> some View {
        Button {
            onCourseSelected(block, selectedDate)
        } label: {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(NativeScheduleThemeColor.accent(for: block.course.name, palette: palette, scheme: colorScheme))
                    .frame(width: 4, height: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text(block.course.name)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text(metadata(block))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Text(timeRange(block))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("查看或修改课程"))
    }

    private func metadata(_ block: NativeScheduleCourseBlock) -> String {
        let values = [
            showLocation ? block.course.location?.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
            showTeacher ? block.course.teacher?.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
            "第 \(block.startSlot)-\(block.endSlot) 节",
        ].compactMap { $0 }.filter { !$0.isEmpty }
        return values.joined(separator: " · ")
    }

    private func timeRange(_ block: NativeScheduleCourseBlock) -> String {
        guard let start = periods.first(where: { $0.number == block.startSlot }) else { return "--:--" }
        let end = periods.first(where: { $0.number == block.endSlot }) ?? start
        return "\(start.startTime)\n\(end.endTime)"
    }

    private func selectedTitle(_ days: [Day]) -> String {
        let pieces = selectedDate.split(separator: "-")
        guard pieces.count == 3, let month = Int(pieces[1]), let day = Int(pieces[2]) else { return selectedDate }
        let weekday = days.first { $0.date == selectedDate }?.weekday ?? 1
        let labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
        return "\(month) 月 \(day) 日 · \(labels[min(max(weekday, 1), 7) - 1])"
    }

    private var selectedSubtitle: String {
        var parts: [String] = []
        if let slot = dateIndex[selectedDate] { parts.append("第 \(slot.week) 周") }
        if let info = ChineseCalendarInfo.info(forDate: selectedDate) {
            parts.append(info.lunar.fullLabel)
            if let badge = info.badge { parts.append(badge) }
        }
        return parts.joined(separator: " · ")
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
                courses: slot.map { blocks($0.day, $0.week) } ?? []
            )
        }
    }
}

enum NativeScheduleThemeColor {
    static func accent(for name: String, palette: String, scheme: ColorScheme) -> Color {
        let hash = name.unicodeScalars.reduce(UInt64(0)) { ($0 &* 31) &+ UInt64($1.value) }
        let base: Double?
        switch palette {
        case "green": base = 0.42
        case "blue": base = 0.58
        case "teal": base = 0.50
        case "indigo": base = 0.66
        case "violet": base = 0.75
        case "orange": base = 0.08
        case "rose": base = 0.93
        case "slate": base = 0.58
        default: base = nil
        }
        let hue = base.map { ($0 + Double(hash % 23) / 360).truncatingRemainder(dividingBy: 1) }
            ?? Double(hash % 360) / 360
        let saturation = palette == "slate" ? 0.20 + Double((hash >> 8) % 8) / 100
            : 0.58 + Double((hash >> 8) % 18) / 100
        let lightness = scheme == .dark ? 0.72 : 0.25 + Double((hash >> 24) % 8) / 100
        let accentSaturation = scheme == .dark
            ? min(0.82, saturation + 0.08)
            : min(0.76, saturation + 0.04)
        let chroma = (1 - abs(2 * lightness - 1)) * accentSaturation
        let scaled = hue * 6
        let x = chroma * (1 - abs(scaled.truncatingRemainder(dividingBy: 2) - 1))
        let baseRGB: (Double, Double, Double)
        switch scaled {
        case 0..<1: baseRGB = (chroma, x, 0)
        case 1..<2: baseRGB = (x, chroma, 0)
        case 2..<3: baseRGB = (0, chroma, x)
        case 3..<4: baseRGB = (0, x, chroma)
        case 4..<5: baseRGB = (x, 0, chroma)
        default: baseRGB = (chroma, 0, x)
        }
        let match = lightness - chroma / 2
        return Color(red: baseRGB.0 + match, green: baseRGB.1 + match, blue: baseRGB.2 + match)
    }
}
