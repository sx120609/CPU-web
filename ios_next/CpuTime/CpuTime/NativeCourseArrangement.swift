import Foundation

/// One "when it meets" group of a course in the editor: a weekday, any set of
/// periods and the weeks it runs.
///
/// The saved edit payload shared with Web and Android describes one contiguous
/// block per item, so an arrangement is written as one item per run of
/// consecutive periods. Nothing new is added to the payload: every client
/// already reads the result.
struct NativeCourseArrangement: Equatable, Sendable {
    var day: Int
    var slots: Set<Int>
    /// Empty means every week.
    var weekList: [Int]

    init(day: Int, slots: Set<Int>, weekList: [Int] = []) {
        self.day = day
        self.slots = slots
        self.weekList = weekList
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
            for run in arrangement.runs {
                let isPrimary = items.isEmpty
                let id = isPrimary ? primaryID : makeID()
                let sourceKey = isPrimary ? primarySourceKey : nil
                items.append(NativeScheduleCustomItem(
                    id: id,
                    sourceKey: sourceKey,
                    day: arrangement.day,
                    bigSlot: (run.lowerBound + 1) / 2,
                    course: NativeScheduleCourse(
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
    func conflicts(in cells: [NativeScheduleCell], ignoring: Set<String> = []) -> [String] {
        guard !slots.isEmpty else { return [] }
        let weeks = Set(weekList)
        var names: [String] = []
        for cell in cells where cell.day == day {
            for course in cell.courses where !ignoring.contains(course.id) {
                let start = course.startSlot ?? cell.bigSlot * 2 - 1
                let end = max(start, course.endSlot ?? cell.bigSlot * 2)
                guard slots.contains(where: { (start...end).contains($0) }) else { continue }
                let courseWeeks = Set(course.weekList)
                guard weeks.isEmpty || courseWeeks.isEmpty || !weeks.isDisjoint(with: courseWeeks) else { continue }
                if !names.contains(course.name) { names.append(course.name) }
            }
        }
        return names
    }
}
