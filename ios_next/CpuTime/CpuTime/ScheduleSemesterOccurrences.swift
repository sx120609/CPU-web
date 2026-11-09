import Foundation

/// Every class meeting a snapshot holds, on its real date and clock times.
///
/// The Apple Calendar import and the calendar file export both read this, so
/// a day off, a make-up day (调休), a course's own clock times and the weeks
/// it runs are settled in one place instead of in each exporter.
struct NativeScheduleOccurrence: Equatable, Sendable {
    let semester: String
    /// Teaching week the meeting is held in.
    let week: Int
    /// 1 (Monday) to 7, the day it is held on.
    let day: Int
    /// "yyyy-MM-dd", the date it is held on.
    let date: String
    let start: Date
    let end: Date
    let startSlot: Int
    let endSlot: Int
    let course: NativeScheduleCourse
    /// Set when a make-up day runs the courses of another date.
    let sourceDate: String?

    /// Stable across imports of the same timetable; a changed room or teacher
    /// keeps the identity, a moved meeting does not.
    var key: String {
        let identity = course.nativeId ?? course.sourceKey ?? course.customId ?? course.name
        return [semester, String(week), String(day), String(startSlot), String(endSlot), identity].joined(separator: "|")
    }
}

enum NativeScheduleOccurrences {
    static let timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current

    /// The meetings of every week the snapshot covers: the whole semester for a
    /// complete snapshot, otherwise only the week it was loaded for.
    static func make(_ snapshot: NativeScheduleSnapshot) -> [NativeScheduleOccurrence] {
        guard let data = snapshot.data, let calendar = snapshot.calendar, !calendar.weeks.isEmpty else { return [] }
        let periods = !snapshot.periods.isEmpty ? snapshot.periods
            : !calendar.periods.isEmpty ? calendar.periods : NativeSchedulePeriod.bundledTimetable
        let ordered = calendar.weeks.sorted { $0.week < $1.week }
        let weeks: [NativeCalendarWeek]
        if snapshot.completeSemester {
            weeks = ordered
        } else {
            let selected = Int(data.currentWeek) ?? calendar.currentWeek
            weeks = ordered.filter { $0.week == selected }
        }
        let semester = data.currentSemester.trimmedNonEmpty ?? calendar.currentSemester

        var result: [NativeScheduleOccurrence] = []
        for week in weeks {
            for targetDay in 1...7 {
                guard week.days.indices.contains(targetDay - 1) else { continue }
                let targetDate = week.days[targetDay - 1]
                let adjustment = calendar.adjustments.first { $0.date == targetDate }
                if adjustment?.kind == "off" { continue }

                var sourceDay = targetDay
                var sourceWeek = week.week
                var sourceDate: String?
                if adjustment?.kind == "swap" {
                    guard let source = adjustment?.source,
                          let sourceWeekInfo = calendar.weeks.first(where: { $0.days.contains(source) }),
                          let sourceIndex = sourceWeekInfo.days.firstIndex(of: source) else { continue }
                    sourceDay = sourceIndex + 1
                    sourceWeek = sourceWeekInfo.week
                    sourceDate = source
                }

                for cell in data.cells where cell.day == sourceDay {
                    for course in cell.courses where course.weekList.isEmpty || course.weekList.contains(sourceWeek) {
                        let range = NativeSchedulePeriod.normalizedRange(
                            bigSlot: cell.bigSlot, startSlot: course.startSlot, endSlot: course.endSlot, periods: periods
                        )
                        // A course with its own clock times keeps them over the bell schedule.
                        let startText = clock(course.customStartTime)
                            ?? periods.first { $0.number == range.start }?.startTime
                        let endText = clock(course.customEndTime)
                            ?? periods.first { $0.number == range.end }?.endTime
                        guard let startText, let endText,
                              let start = date(targetDate, time: startText),
                              let end = date(targetDate, time: endText), end > start else { continue }
                        result.append(NativeScheduleOccurrence(
                            semester: semester, week: week.week, day: targetDay, date: targetDate,
                            start: start, end: end, startSlot: range.start, endSlot: range.end,
                            course: course, sourceDate: sourceDate
                        ))
                    }
                }
            }
        }
        return result.sorted { ($0.start, $0.startSlot) < ($1.start, $1.startSlot) }
    }

    static func clock(_ value: String?) -> String? {
        guard let value = value?.trimmedNonEmpty,
              value.split(separator: ":").compactMap({ Int($0) }).count >= 2 else { return nil }
        return value
    }

    static func date(_ day: String, time: String) -> Date? {
        let date = day.split(separator: "-").compactMap { Int($0) }
        let clock = time.split(separator: ":").compactMap { Int($0) }
        guard date.count == 3, clock.count >= 2 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.date(from: DateComponents(
            year: date[0], month: date[1], day: date[2], hour: clock[0], minute: clock[1]
        ))
    }
}
