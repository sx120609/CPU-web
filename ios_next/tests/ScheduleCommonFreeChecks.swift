import Foundation

@main
struct ScheduleCommonFreeChecks {
    static func main() {
        let periods = NativeSchedulePeriod.bundledTimetable
        func days(_ start: Int) -> [String] { (start..<(start + 7)).map { String(format: "2026-09-%02d", $0) } }
        func snapshot(_ cells: [NativeScheduleCell], weeks: [NativeCalendarWeek], periods: [NativeSchedulePeriod] = periods,
                      adjustments: [NativeScheduleAdjustment] = []) -> NativeScheduleSnapshot {
            NativeScheduleSnapshot(
                completeSemester: true, periods: periods,
                data: NativeScheduleResult(currentSemester: "t", currentWeek: "1", cells: cells),
                calendar: NativeScheduleCalendar(currentSemester: "t", currentWeek: 1, weeks: weeks, periods: periods, adjustments: adjustments)
            )
        }
        let both = [NativeCalendarWeek(week: 1, days: days(7)), NativeCalendarWeek(week: 2, days: days(14))]
        // Me: Monday periods 1–2 (08:00–09:40) and 5–6 (13:30–15:10).
        let me = snapshot([
            NativeScheduleCell(day: 1, bigSlot: 1, courses: [NativeScheduleCourse(name: "高数", weekList: [1, 2], startSlot: 1, endSlot: 2)]),
            NativeScheduleCell(day: 1, bigSlot: 3, courses: [NativeScheduleCourse(name: "化学", weekList: [1], startSlot: 5, endSlot: 6)]),
        ], weeks: both)
        // Them, at another school: Monday 09:40–11:10 by their own bells, and only week 1 in their term.
        let theirBells = [NativeSchedulePeriod(number: 1, startTime: "09:40", endTime: "10:20"),
                          NativeSchedulePeriod(number: 2, startTime: "10:30", endTime: "11:10")]
        let them = snapshot([
            NativeScheduleCell(day: 1, bigSlot: 1, courses: [NativeScheduleCourse(name: "解剖", weekList: [1], startSlot: 1, endSlot: 2)]),
        ], weeks: [NativeCalendarWeek(week: 1, days: days(7))], periods: theirBells)

        let past = ISO8601DateFormatter().date(from: "2026-09-01T00:00:00Z")!
        let result = ScheduleCommonFree.days([me, them], from: "2026-09-07", to: "2026-09-20",
                                             earliest: 8 * 60, latest: 18 * 60, minimum: 60, now: past)
        // Only week 1 is in both terms.
        precondition(result.map(\.date) == days(7), "\(result.map(\.date))")
        let monday = result[0]
        precondition(monday.busy == [480...670, 810...910], "\(monday.busy)")
        // 11:10–13:30 and 15:10–18:00; 08:00–09:40 is taken, nothing under an hour.
        precondition(monday.windows.map { [$0.start, $0.end] } == [[670, 810], [910, 1080]], "\(monday.windows)")
        precondition(result[1].windows.map { [$0.start, $0.end] } == [[480, 1080]])

        // Today starts at the next quarter hour; earlier days are left out.
        let now = ISO8601DateFormatter().date(from: "2026-09-08T03:05:00Z")!   // 11:05 in Shanghai, Tuesday
        let today = ScheduleCommonFree.days([me], from: "2026-09-07", to: "2026-09-08", earliest: 480, latest: 1080, minimum: 30, now: now)
        precondition(today.map(\.date) == ["2026-09-08"])
        precondition(today[0].windows.first?.start == 11 * 60 + 15)

        precondition(ScheduleCommonFree.merge([5...9, 1...3, 3...4, 12...13]) == [1...4, 5...9, 12...13])
        precondition(ScheduleCommonFree.durationText(105) == "1 小时 45 分" && ScheduleCommonFree.durationText(120) == "2 小时")
        precondition(NativeOccurrenceDates.range("2026-02-27", "2026-03-02") == ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"])
        print("common free checks passed")
    }
}
