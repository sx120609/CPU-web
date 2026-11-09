import Foundation

/// Somebody else's timetable drawn over the user's (the couple timetable, or a
/// shared one laid on top) may come from another school with other bells:
/// NJMU's third period is not CPU's. Their courses are placed on the user's
/// periods by clock time, and keep their real clock times for every label.
enum ScheduleOverlayTiming {
    struct Period: Equatable {
        let number: Int
        let start: Int
        let end: Int
    }

    /// Minutes since midnight of "HH:mm".
    static func minutes(_ value: String) -> Int? {
        let parts = value.split(separator: ":").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        guard parts.count >= 2, (0..<24).contains(parts[0]), (0..<60).contains(parts[1]) else { return nil }
        return parts[0] * 60 + parts[1]
    }

    static func periods(_ value: [NativeSchedulePeriod]) -> [Period] {
        value.compactMap { period in
            guard let start = minutes(period.startTime), let end = minutes(period.endTime) else { return nil }
            return Period(number: period.number, start: start, end: end)
        }.sorted { $0.start < $1.start }
    }

    /// The user's periods that a class from `start` to `end` (minutes) covers:
    /// from the first period still running at its start to the last one begun
    /// before its end. A class wholly inside a break takes the nearest period.
    static func place(start: Int, end: Int, on mine: [Period]) -> (start: Int, end: Int)? {
        guard !mine.isEmpty else { return nil }
        let first = mine.first { $0.end > start }
        let last = mine.last { $0.start < end }
        if let first, let last, first.number <= last.number { return (first.number, last.number) }
        let middle = (start + end) / 2
        let nearest = mine.min { abs(($0.start + $0.end) / 2 - middle) < abs(($1.start + $1.end) / 2 - middle) }!
        return (nearest.number, nearest.number)
    }

    /// Whether two bell schedules agree on every period both have: then
    /// period numbers can be used as they are.
    static func sameBells(_ theirs: [Period], _ mine: [Period]) -> Bool {
        let own = Dictionary(mine.map { ($0.number, $0) }, uniquingKeysWith: { first, _ in first })
        return theirs.allSatisfy { period in own[period.number].map { $0 == period } ?? false }
    }

    static func clock(_ minutes: Int) -> String {
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }
}

extension NativeScheduleCourse {
    /// The same course with its own clock times.
    func withClock(start: String, end: String) -> NativeScheduleCourse {
        NativeScheduleCourse(
            nativeId: nativeId, customStartTime: start, customEndTime: end, name: name, teacher: teacher,
            weeks: weeks, weekList: weekList, location: location, slotNote: slotNote,
            startSlot: startSlot, endSlot: endSlot, sourceKey: sourceKey, customId: customId,
            custom: custom, orphaned: orphaned, sourceNote: sourceNote
        )
    }
}
