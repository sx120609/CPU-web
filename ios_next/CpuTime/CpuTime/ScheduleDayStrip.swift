import SwiftUI

/// The day view's seven-day selector in the styles that came from NapTable.
/// Each draws it as the header row of its own week view, so switching between
/// the two views keeps the row in place, and the strip and the day list under
/// it read as one design. The classic style keeps its own strip.
@available(iOS 17.0, *)
struct ScheduleDayStrip: View {
    struct Day: Identifiable {
        /// Weekday, 1–7.
        let day: Int
        /// Day of the month, 「9」.
        let number: String?
        /// 「10.09」, read out by VoiceOver.
        let date: String?
        let isToday: Bool
        /// "off" or "swap" when the date is adjusted.
        let adjustmentKind: String?
        /// What the adjustment means, for VoiceOver.
        let adjustmentDetail: String?
        let courseCount: Int
        var id: Int { day }
    }

    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    let days: [Day]
    let selectedDay: Int
    let onSelect: (Int) -> Void

    private var rule: Color { .scheduleCellBorder(dark: scheme == .dark) }

    var body: some View {
        // Same gaps as the week view: only minimal and grid keep space between days.
        HStack(spacing: CGFloat(style.columnGap)) {
            ForEach(days) { day in
                let isSelected = selectedDay == day.day
                Button { onSelect(day.day) } label: {
                    cell(day, isSelected: isSelected)
                        .frame(maxWidth: .infinity, minHeight: 50, maxHeight: 50)
                        .overlay(alignment: .trailing) {
                            // The table rules between its days, like the columns of its week view.
                            if style == .table && day.id != days.last?.id {
                                Rectangle().fill(rule).frame(width: 0.5)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(ScheduleStyleTime.weekday(day.day)) \(day.date ?? "")")
                .accessibilityValue(
                    [day.adjustmentDetail, day.courseCount > 0 ? "\(day.courseCount) 门课" : "没有课"]
                        .compactMap { $0 }.joined(separator: "，")
                )
                .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : [.isButton])
            }
        }
        .background {
            if style == .table { ScheduleSurface(cornerRadius: 0, isPanel: true, showsBorder: false) }
        }
        .overlay {
            // Stroked on top: the selected day fills its cell edge to edge.
            if style == .table { Rectangle().strokeBorder(rule, lineWidth: 0.5).allowsHitTesting(false) }
        }
        .overlay(alignment: .bottom) {
            // The board has no panel to sit on, so the strip ends on the hairline it rules its rows with.
            if style == .board {
                Rectangle().fill(style.inkColor(dark: scheme == .dark).opacity(0.15)).frame(height: 0.5)
            }
        }
    }

    @ViewBuilder
    private func cell(_ day: Day, isSelected: Bool) -> some View {
        if style == .minimal {
            minimalCell(day, isSelected: isSelected)
        } else {
            ScheduleStyledDateHeader(day: day.day, date: day.number ?? "–", isToday: day.isToday,
                                     adjustmentKind: day.adjustmentKind, selected: isSelected)
        }
    }

    /// The day of the month above and the weekday below, as in the minimal
    /// week header; the selected day sits on a pale rounded tile.
    private func minimalCell(_ day: Day, isSelected: Bool) -> some View {
        let highlighted = isSelected || day.isToday
        return VStack(spacing: 3) {
            Text(day.number ?? "–")
                .font(.system(size: 17, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(highlighted ? AnyShapeStyle(.themeText) : AnyShapeStyle(.primary))
                .overlay(alignment: .topTrailing) {
                    if let kind = day.adjustmentKind {
                        ScheduleAdjustmentBadge(kind: kind)
                            .frame(width: 0, alignment: .leading)
                            .offset(x: 2, y: -1)
                    }
                }
            Text(day.isToday ? "今天" : ScheduleStyleTime.weekday(day.day))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(highlighted ? AnyShapeStyle(.themeText) : AnyShapeStyle(.secondary))
        }
        .lineLimit(1)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            if isSelected {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.themeTint(scheme == .dark ? 0.2 : 0.1))
            }
        }
    }
}
