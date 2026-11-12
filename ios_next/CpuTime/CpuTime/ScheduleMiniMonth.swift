import SwiftUI

/// A small month beside the day view on an iPad: every date a button that
/// opens that day, a dot under the days with classes and a second one for
/// 日程 not yet done. Dates outside the term are shown but cannot be opened.
@available(iOS 17.0, *)
struct ScheduleMiniMonth: View {
    struct Mark {
        /// The teaching week the date is in; nil outside the term.
        var week: Int?
        var hasCourses = false
        var hasAgenda = false
        /// `off` for a holiday, `work` for a make-up day.
        var adjustmentKind: String?
    }

    /// `yyyy-MM` of the month shown.
    let month: String
    let selectedDate: String?
    let todayDate: String?
    let mark: (String) -> Mark
    let onSelect: (String) -> Void
    /// 1 for the next month, -1 for the one before.
    let onMove: (Int) -> Void

    private let brand = Color.cpuBrand

    private static let labels = ["一", "二", "三", "四", "五", "六", "日"]
    private static let gutter: CGFloat = 20

    private var title: String {
        guard let parts = ScheduleMiniMonthGrid.parts(month) else { return month }
        return "\(parts.year) 年 \(parts.month) 月"
    }

    var body: some View {
        let weeks = ScheduleMiniMonthGrid.weeks(month: month)
        VStack(spacing: 6) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                Spacer(minLength: 4)
                step("chevron.left", label: "上一月") { onMove(-1) }
                step("chevron.right", label: "下一月") { onMove(1) }
            }
            .padding(.leading, Self.gutter + 6)

            HStack(spacing: 0) {
                Text("周")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .frame(width: Self.gutter)
                ForEach(Array(Self.labels.enumerated()), id: \.offset) { index, label in
                    Text(label)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(index >= 5 ? Color.pink.opacity(0.8) : Color.secondary)
                        .frame(maxWidth: .infinity)
                }
            }

            ForEach(weeks, id: \.first?.date) { row in
                HStack(spacing: 0) {
                    Text(row.compactMap { mark($0.date).week }.first.map(String.init) ?? "")
                        .font(.system(size: 9, weight: .semibold).monospacedDigit())
                        .foregroundStyle(.tertiary)
                        .frame(width: Self.gutter)
                    ForEach(Array(row.enumerated()), id: \.element.date) { index, day in
                        cell(day, weekend: index >= 5)
                    }
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 12)
        .background {
            let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
            NativeScheduleBackgroundSurface()
                .clipShape(shape)
                .overlay { shape.strokeBorder(Color.primary.opacity(0.08), lineWidth: 1) }
        }
    }

    private func step(_ systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.footnote.weight(.semibold))
                .frame(width: 32, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .hoverEffect(.highlight)
        .accessibilityLabel(label)
    }

    private func cell(_ day: ScheduleMiniMonthGrid.Day, weekend: Bool) -> some View {
        let value = mark(day.date)
        let selected = day.date == selectedDate
        let today = day.date == todayDate
        let open = value.week != nil
        let ink: Color = selected ? .white
            : today ? brand
            : value.adjustmentKind == "off" || (weekend && value.adjustmentKind != "work") ? Color.pink.opacity(0.85)
            : .primary
        return Button {
            onSelect(day.date)
        } label: {
            VStack(spacing: 2) {
                Text("\(day.number)")
                    .font(.system(size: 14, weight: selected || today ? .bold : .medium, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(ink)
                    .frame(width: 30, height: 30)
                    .background {
                        if selected {
                            Circle().fill(brand)
                        } else if today {
                            Circle().strokeBorder(brand, lineWidth: 1.5)
                        }
                    }
                HStack(spacing: 3) {
                    if value.hasCourses { Circle().fill(brand.opacity(0.75)).frame(width: 4, height: 4) }
                    if value.hasAgenda { Circle().fill(Color.orange).frame(width: 4, height: 4) }
                }
                .frame(height: 4)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 2)
            .opacity(!open ? 0.3 : (day.inMonth ? 1 : 0.45))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!open)
        .accessibilityLabel(NativeOccurrenceText.date(day.date)
            + (value.hasCourses ? "，有课" : "") + (value.hasAgenda ? "，有日程" : ""))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}
