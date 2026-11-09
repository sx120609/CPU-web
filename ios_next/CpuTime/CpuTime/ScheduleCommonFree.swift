import Foundation

/// 找共同空闲: the times on each day when nobody of the chosen timetables has a
/// class. Each timetable keeps its own bells and calendar (days off, make-up
/// days, single meetings moved or cancelled), so people at different schools
/// compare by clock time.
enum ScheduleCommonFree {
    struct Window: Identifiable, Equatable, Sendable {
        /// "yyyy-MM-dd".
        let date: String
        /// Minutes since midnight.
        let start: Int
        let end: Int

        var id: String { "\(date)@\(start)" }
        var minutes: Int { end - start }
    }

    /// A day of the result: its free windows, and the classes of anybody, as
    /// minute ranges, for the bar that shows the day.
    struct Day: Identifiable, Equatable, Sendable {
        let date: String
        let windows: [Window]
        let busy: [ClosedRange<Int>]
        var id: String { date }
    }

    /// Dates every timetable covers, as yyyy-MM-dd strings in order.
    static func covered(_ snapshots: [NativeScheduleSnapshot]) -> ClosedRange<String>? {
        var lower: String?
        var upper: String?
        for snapshot in snapshots {
            let days = (snapshot.calendar?.weeks ?? []).flatMap(\.days).filter { $0.count == 10 }.sorted()
            guard let first = days.first, let last = days.last else { return nil }
            lower = max(lower ?? first, first)
            upper = min(upper ?? last, last)
        }
        guard let lower, let upper, lower <= upper else { return nil }
        return lower...upper
    }

    /// The days from `from` to `to` (both included) inside every timetable's
    /// term, with the windows of at least `minimum` minutes between `earliest`
    /// and `latest`. On today nothing before `now` counts, rounded up to the
    /// quarter hour.
    static func days(
        _ snapshots: [NativeScheduleSnapshot],
        from: String, to: String,
        earliest: Int, latest: Int, minimum: Int,
        now: Date = .now
    ) -> [Day] {
        guard !snapshots.isEmpty, from <= to, earliest < latest, minimum > 0,
              let covered = covered(snapshots) else { return [] }
        let first = max(from, covered.lowerBound)
        let last = min(to, covered.upperBound)
        guard first <= last else { return [] }

        var busyByDate: [String: [ClosedRange<Int>]] = [:]
        for snapshot in snapshots {
            for meeting in NativeScheduleOccurrences.make(snapshot) where meeting.date >= first && meeting.date <= last {
                guard let start = minutes(meeting.start), let end = minutes(meeting.end), end > start else { continue }
                busyByDate[meeting.date, default: []].append(start...end)
            }
        }

        let today = NativeOccurrenceDates.string(now)
        let nowMinute = minutes(now) ?? 0
        var result: [Day] = []
        for date in NativeOccurrenceDates.range(first, last) {
            if date < today { continue }
            let busy = merge(busyByDate[date] ?? [])
            var cursor = earliest
            if date == today { cursor = max(cursor, Int((Double(nowMinute) / 15).rounded(.up)) * 15) }
            var windows: [Window] = []
            for range in busy where range.upperBound > cursor && range.lowerBound < latest {
                if range.lowerBound - cursor >= minimum {
                    windows.append(Window(date: date, start: cursor, end: range.lowerBound))
                }
                cursor = max(cursor, range.upperBound)
            }
            if latest - cursor >= minimum { windows.append(Window(date: date, start: cursor, end: latest)) }
            result.append(Day(date: date, windows: windows, busy: busy))
        }
        return result
    }

    /// Overlapping or touching ranges joined, in order.
    static func merge(_ ranges: [ClosedRange<Int>]) -> [ClosedRange<Int>] {
        var merged: [ClosedRange<Int>] = []
        for range in ranges.sorted(by: { $0.lowerBound < $1.lowerBound }) {
            if let last = merged.last, range.lowerBound <= last.upperBound {
                merged[merged.count - 1] = last.lowerBound...max(last.upperBound, range.upperBound)
            } else {
                merged.append(range)
            }
        }
        return merged
    }

    private static func minutes(_ date: Date) -> Int? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = NativeScheduleOccurrences.timeZone
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        guard let hour = parts.hour, let minute = parts.minute else { return nil }
        return hour * 60 + minute
    }

    /// "1 小时 45 分".
    static func durationText(_ minutes: Int) -> String {
        let hours = minutes / 60, rest = minutes % 60
        switch (hours, rest) {
        case (0, _): return "\(rest) 分钟"
        case (_, 0): return "\(hours) 小时"
        default: return "\(hours) 小时 \(rest) 分"
        }
    }

    static func clock(_ minutes: Int) -> String {
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }
}

/// Plain yyyy-MM-dd arithmetic in the timetable's time zone.
enum NativeOccurrenceDates {
    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = NativeScheduleOccurrences.timeZone
        return calendar
    }

    static func string(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    static func date(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    static func adding(_ days: Int, to value: String) -> String? {
        guard let date = date(value), let next = calendar.date(byAdding: .day, value: days, to: date) else { return nil }
        return string(next)
    }

    /// Every date from `first` to `last`, both included; at most a year.
    static func range(_ first: String, _ last: String) -> [String] {
        var result: [String] = []
        var current = first
        while current <= last, result.count < 366 {
            result.append(current)
            guard let next = adding(1, to: current) else { break }
            current = next
        }
        return result
    }
}
