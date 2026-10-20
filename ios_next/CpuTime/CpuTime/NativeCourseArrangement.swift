import Foundation

/// The own start and end of a course that does not follow the periods (a
/// lecture, a lab, a club meeting): `customStartTime` / `customEndTime` in
/// 24-hour "HH:MM". Port of the Web `server/src/shared/scheduleCustomTime.ts`.
///
/// The grid is still laid out by period, so such a course also keeps
/// `startSlot` / `endSlot`: the periods its time overlaps, or the nearest one
/// when it falls in a break or outside the bell schedule.
struct NativeCourseTime: Equatable, Sendable {
    let start: String
    let end: String

    /// Both times valid and the end after the start, written with two-digit hours.
    init?(start: String?, end: String?) {
        guard let from = Self.minutes(start), let to = Self.minutes(end), to > from else { return nil }
        self.start = Self.text(from)
        self.end = Self.text(to)
    }

    var startMinutes: Int { Self.minutes(start) ?? 0 }
    var endMinutes: Int { Self.minutes(end) ?? 0 }

    /// "8:05" or "08:05" → 485; nil when it is not a time of day.
    static func minutes(_ value: String?) -> Int? {
        guard let text = value?.trimmingCharacters(in: .whitespaces),
              text.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil else { return nil }
        let parts = text.split(separator: ":")
        guard parts.count == 2, let hours = Int(parts[0]), let minutes = Int(parts[1]), hours <= 23, minutes <= 59 else { return nil }
        return hours * 60 + minutes
    }

    static func text(_ minutes: Int) -> String {
        let safe = min(max(minutes, 0), 23 * 60 + 59)
        return String(format: "%02d:%02d", safe / 60, safe % 60)
    }

    /// The periods this time is drawn on: the ones it overlaps, or the nearest
    /// one when it overlaps none. Nil for an empty bell schedule.
    func slotRange(in periods: [(number: Int, start: String, end: String)]) -> ClosedRange<Int>? {
        let timed: [(number: Int, start: Int, end: Int)] = periods.compactMap { period -> (number: Int, start: Int, end: Int)? in
            guard period.number > 0, let start = Self.minutes(period.start), let end = Self.minutes(period.end) else { return nil }
            return (number: period.number, start: start, end: end)
        }.sorted { $0.number < $1.number }
        guard let firstPeriod = timed.first else { return nil }
        let from = startMinutes
        let to = endMinutes
        let overlapping = timed.filter { $0.start < to && from < $0.end }
        if let first = overlapping.first, let last = overlapping.last { return first.number...last.number }
        var nearest = firstPeriod
        var best = Int.max
        for period in timed {
            let distance = period.end <= from ? from - period.end : period.start - to
            if distance < best {
                best = distance
                nearest = period
            }
        }
        return nearest.number...nearest.number
    }
}

/// One "when it meets" group of a course in the editor: a weekday, any set of
/// periods and the weeks it runs.
///
/// The saved edit payload shared with Web and Android describes one contiguous
/// block per item, so an arrangement is written as one item per run of
/// consecutive periods. A course on its own `time` is one item across the
/// periods it is drawn on, carrying `customStartTime` / `customEndTime`.
struct NativeCourseArrangement: Equatable, Sendable {
    var day: Int
    var slots: Set<Int>
    /// Empty means every week.
    var weekList: [Int]
    /// A course that does not follow the periods; `slots` are then the periods it is drawn on.
    var time: NativeCourseTime?

    init(day: Int, slots: Set<Int>, weekList: [Int] = [], time: NativeCourseTime? = nil) {
        self.day = day
        self.slots = slots
        self.weekList = weekList
        self.time = time
    }

    /// The runs of consecutive periods, in order: [1, 2, 5, 6, 9] → 1...2, 5...6, 9...9.
    var runs: [ClosedRange<Int>] {
        var result: [ClosedRange<Int>] = []
        for slot in slots.sorted() {
            if let last = result.last, last.upperBound + 1 == slot {
                result[result.count - 1] = last.lowerBound...slot
            } else {
                result.append(slot...slot)
            }
        }
        return result
    }

    /// "全部周" or "第 1,3,5 周", the wording the editor has always saved.
    var weeksLabel: String {
        weekList.isEmpty ? "全部周" : "第 \(weekList.map(String.init).joined(separator: ",")) 周"
    }

    /// The text fields shared by every block of the course being saved.
    struct Details: Equatable, Sendable {
        var name: String
        var teacher: String
        var location: String
        var note: String
    }

    /// The edit items for a course's arrangements.
    ///
    /// The first run of the first arrangement keeps `primaryID` and
    /// `primarySourceKey`: it is the block being edited, and for an official
    /// course it stays tied to the original it replaces. Every further run is a
    /// plain custom item with an identifier from `makeID`.
    static func customItems(
        details: Details,
        arrangements: [NativeCourseArrangement],
        primaryID: String,
        primarySourceKey: String?,
        makeID: () -> String
    ) -> [NativeScheduleCustomItem] {
        var items: [NativeScheduleCustomItem] = []
        for arrangement in arrangements {
            let weekList = Array(Set(arrangement.weekList.filter { $0 > 0 })).sorted()
            let weeks = NativeCourseArrangement(day: arrangement.day, slots: [], weekList: weekList).weeksLabel
            var runs = arrangement.runs
            if arrangement.time != nil, let low = arrangement.slots.min(), let high = arrangement.slots.max() {
                runs = [low...high]
            }
            for run in runs {
                let isPrimary = items.isEmpty
                let id = isPrimary ? primaryID : makeID()
                let sourceKey = isPrimary ? primarySourceKey : nil
                items.append(NativeScheduleCustomItem(
                    id: id,
                    sourceKey: sourceKey,
                    day: arrangement.day,
                    bigSlot: (run.lowerBound + 1) / 2,
                    course: NativeScheduleCourse(
                        customStartTime: arrangement.time?.start,
                        customEndTime: arrangement.time?.end,
                        name: details.name,
                        teacher: details.teacher,
                        weeks: weeks,
                        weekList: weekList,
                        location: details.location,
                        slotNote: details.note.isEmpty ? "第 \(run.lowerBound)-\(run.upperBound) 节" : details.note,
                        startSlot: run.lowerBound,
                        endSlot: run.upperBound,
                        sourceKey: sourceKey,
                        customId: id,
                        custom: true
                    )
                ))
            }
        }
        return items
    }

    /// Names of the courses this arrangement would sit on top of: same weekday,
    /// intersecting periods and at least one week in common. Courses that only
    /// alternate weeks in the same periods do not count.
    ///
    /// `ignoring` holds the identifiers of the course being edited, so it does
    /// not collide with itself. A course without a week list meets every week.
    /// When either side keeps its own time and `clock` gives the bell times of
    /// a period, the two are compared by the minute instead of by period.
    func conflicts(
        in cells: [NativeScheduleCell],
        ignoring: Set<String> = [],
        clock: ((Int) -> (start: String, end: String)?)? = nil
    ) -> [String] {
        guard !slots.isEmpty else { return [] }
        let weeks = Set(weekList)
        func runMinutes(_ run: ClosedRange<Int>) -> (start: Int, end: Int)? {
            guard let clock, let first = clock(run.lowerBound), let last = clock(run.upperBound),
                  let from = NativeCourseTime.minutes(first.start), let to = NativeCourseTime.minutes(last.end), to > from else { return nil }
            return (start: from, end: to)
        }
        let own: [(start: Int, end: Int)]
        if let time {
            own = [(start: time.startMinutes, end: time.endMinutes)]
        } else {
            own = runs.compactMap { runMinutes($0) }
        }
        var names: [String] = []
        for cell in cells where cell.day == day {
            for course in cell.courses where !ignoring.contains(course.id) {
                let start = course.startSlot ?? cell.bigSlot * 2 - 1
                let end = max(start, course.endSlot ?? cell.bigSlot * 2)
                let courseTime = NativeCourseTime(start: course.customStartTime, end: course.customEndTime)
                var other: (start: Int, end: Int)?
                if let courseTime {
                    other = (start: courseTime.startMinutes, end: courseTime.endMinutes)
                } else if time != nil {
                    other = runMinutes(start...end)
                }
                let overlaps: Bool
                if let other, !own.isEmpty {
                    overlaps = own.contains { $0.start < other.end && other.start < $0.end }
                } else {
                    overlaps = slots.contains(where: { (start...end).contains($0) })
                }
                guard overlaps else { continue }
                let courseWeeks = Set(course.weekList)
                guard weeks.isEmpty || courseWeeks.isEmpty || !weeks.isDisjoint(with: courseWeeks) else { continue }
                if !names.contains(course.name) { names.append(course.name) }
            }
        }
        return names
    }
}
