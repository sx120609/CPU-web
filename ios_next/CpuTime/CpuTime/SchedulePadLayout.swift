import CoreGraphics
import Foundation

/// How the timetable uses a window larger than a phone's: an iPad, full screen
/// or in a wide enough split. Everything here follows the space the view is
/// given, not the device, so a narrow split falls back to the phone layout.
enum SchedulePadLayout {
    /// The narrowest content that keeps a side column next to the day or month.
    static let sideColumnThreshold: CGFloat = 760
    /// Room between the main column and the side column.
    static let sideColumnGap: CGFloat = 16
    /// A stretched row never grows past this many times its chosen height.
    static let largestStretch: CGFloat = 2.4

    /// The width of the side column beside the day view, or nil when the
    /// content is too narrow for one. It takes about a third, within limits
    /// that keep a seven-column month readable and the day column the wider.
    static func sideColumnWidth(contentWidth: CGFloat) -> CGFloat? {
        guard contentWidth >= sideColumnThreshold else { return nil }
        return min(380, max(300, (contentWidth * 0.34).rounded()))
    }

    /// The month view puts 当天安排 beside the calendar once the calendar
    /// itself keeps at least a phone's width of day cells.
    static func monthSideColumnWidth(contentWidth: CGFloat) -> CGFloat? {
        guard contentWidth >= 960 else { return nil }
        return min(400, max(320, (contentWidth * 0.32).rounded()))
    }

    /// The row height that makes a grid of `rows` rows fill `available`.
    /// `fixed` is the grid's height with rows of zero height (header, gaps,
    /// padding) and `perRow` how much one point of row height adds to it.
    /// Never less than `base`, the height the user chose: a grid that is
    /// already taller than the window scrolls as before.
    static func stretchedRowHeight(base: CGFloat, available: CGFloat, fixed: CGFloat, perRow: CGFloat) -> CGFloat {
        guard base > 0, perRow > 0, available > fixed else { return base }
        let fitted = ((available - fixed) / perRow).rounded(.down)
        return min(max(base, fitted), (base * largestStretch).rounded(.down))
    }

    /// The month's row height when its `weeks` rows share `available`.
    /// `chrome` is the weekday header and padding around the rows and
    /// `spacing` the gap added to every row.
    static func monthRowHeight(base: CGFloat, available: CGFloat, chrome: CGFloat, spacing: CGFloat, weeks: Int) -> CGFloat {
        guard weeks > 0, available > chrome else { return base }
        let fitted = ((available - chrome) / CGFloat(weeks) - spacing).rounded(.down)
        return min(max(base, fitted), (base * largestStretch).rounded(.down))
    }

    /// How many course names a month cell lists before the rest become 「+N」:
    /// what fits under the date once `reserved` points are taken by the date,
    /// its lunar line and the partner's count, and never fewer than a phone's three.
    static func monthLineLimit(rowHeight: CGFloat, reserved: CGFloat, lineHeight: CGFloat) -> Int {
        guard lineHeight > 0 else { return 3 }
        return max(3, Int(((rowHeight - reserved) / lineHeight).rounded(.down)))
    }
}

/// The dates of one month laid out in whole weeks, Monday first. Kept apart
/// from the view so the arithmetic can be checked on its own.
enum ScheduleMiniMonthGrid {
    struct Day: Equatable {
        /// `yyyy-MM-dd`.
        let date: String
        let number: Int
        let inMonth: Bool
    }

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        calendar.firstWeekday = 2
        return calendar
    }

    private static func text(year: Int, month: Int, day: Int) -> String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// The year and month of a `yyyy-MM` or `yyyy-MM-dd` text.
    static func parts(_ month: String) -> (year: Int, month: Int)? {
        let pieces = month.split(separator: "-")
        guard pieces.count >= 2, let year = Int(pieces[0]), let value = Int(pieces[1]),
              (1...12).contains(value) else { return nil }
        return (year, value)
    }

    /// `month` moved by `offset` months, as `yyyy-MM`.
    static func month(_ month: String, offset: Int) -> String? {
        guard let parts = parts(month) else { return nil }
        let index = parts.year * 12 + (parts.month - 1) + offset
        return String(format: "%04d-%02d", index / 12, index % 12 + 1)
    }

    /// The month's weeks, each seven days from Monday, with the days of the
    /// neighbouring months that complete the first and last week.
    static func weeks(month: String) -> [[Day]] {
        guard let parts = parts(month),
              let first = calendar.date(from: DateComponents(year: parts.year, month: parts.month, day: 1)),
              let count = calendar.range(of: .day, in: .month, for: first)?.count else { return [] }
        // Sunday is 1: Monday leads, so Sunday trails by six.
        let leading = (calendar.component(.weekday, from: first) + 5) % 7
        let cells = Int((Double(leading + count) / 7).rounded(.up)) * 7
        let days: [Day] = (0..<cells).compactMap { index in
            guard let date = calendar.date(byAdding: .day, value: index - leading, to: first) else { return nil }
            let value = calendar.dateComponents([.year, .month, .day], from: date)
            guard let year = value.year, let month = value.month, let day = value.day else { return nil }
            return Day(date: text(year: year, month: month, day: day), number: day, inMonth: month == parts.month)
        }
        return stride(from: 0, to: days.count, by: 7).map { Array(days[$0..<min($0 + 7, days.count)]) }
    }
}
