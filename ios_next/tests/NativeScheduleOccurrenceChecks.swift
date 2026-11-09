import Foundation

@main
struct NativeScheduleOccurrenceChecks {
    static func main() {
        let periods = NativeSchedulePeriod.bundledTimetable
        func days(_ start: Int) -> [String] { (start..<(start + 7)).map { String(format: "2026-09-%02d", $0) } }
        let weeks = [
            NativeCalendarWeek(week: 1, days: days(7), monday: "2026-09-07", sunday: "2026-09-13"),
            NativeCalendarWeek(week: 2, days: days(14), monday: "2026-09-14", sunday: "2026-09-20"),
        ]
        let calendar = NativeScheduleCalendar(
            currentSemester: "2026-2027-1", currentWeek: 1, weeks: weeks, periods: periods,
            adjustments: [
                // Week 2 Monday is off; that Saturday runs week 1's Monday.
                NativeScheduleAdjustment(date: "2026-09-14", kind: "off"),
                NativeScheduleAdjustment(date: "2026-09-19", kind: "swap", source: "2026-09-07"),
            ]
        )
        let math = NativeScheduleCourse(nativeId: "m", name: "高等数学", weekList: [1, 2], location: "教学楼A102", startSlot: 1, endSlot: 2)
        let lab = NativeScheduleCourse(nativeId: "l", customStartTime: "18:30", customEndTime: "20:00", name: "实验, 第一组", weekList: [2], startSlot: 11, endSlot: 12)
        let data = NativeScheduleResult(currentSemester: "2026-2027-1", currentWeek: "1", cells: [
            NativeScheduleCell(day: 1, bigSlot: 1, courses: [math]),
            NativeScheduleCell(day: 3, bigSlot: 6, courses: [lab]),
        ])
        let whole = NativeScheduleSnapshot(completeSemester: true, periods: periods, data: data, calendar: calendar)
        let found = NativeScheduleOccurrences.make(whole)
        // Week 1 Monday; week 2 Monday is off; the make-up Saturday runs Monday's math; week 2 Wednesday's lab.
        precondition(found.map(\.date) == ["2026-09-07", "2026-09-16", "2026-09-19"], "\(found.map(\.date))")
        precondition(found[2].sourceDate == "2026-09-07" && found[2].week == 2 && found[2].day == 6)
        let formatter = DateFormatter()
        formatter.timeZone = NativeScheduleOccurrences.timeZone
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        precondition(formatter.string(from: found[0].start) == "2026-09-07 08:00")
        precondition(formatter.string(from: found[0].end) == "2026-09-07 09:40")
        // The lab keeps its own clock times.
        precondition(formatter.string(from: found[1].start) == "2026-09-16 18:30")
        precondition(formatter.string(from: found[1].end) == "2026-09-16 20:00")
        precondition(found[0].key == "2026-2027-1|1|1|1|2|m")

        // A single week only covers that week.
        let week = NativeScheduleSnapshot(periods: periods, data: data, calendar: calendar)
        precondition(NativeScheduleOccurrences.make(week).map(\.date) == ["2026-09-07"])

        let ics = NativeScheduleICSExporter.make(occurrences: found, calendarName: "课表-2026秋", stamp: Date(timeIntervalSince1970: 0))
        precondition(ics.hasPrefix("BEGIN:VCALENDAR\r\n") && ics.hasSuffix("END:VCALENDAR\r\n"))
        precondition(ics.components(separatedBy: "BEGIN:VEVENT").count == 4)
        precondition(ics.contains("DTSTART;TZID=Asia/Shanghai:20260916T183000"))
        precondition(ics.contains("SUMMARY:实验\\, 第一组"))
        precondition(ics.contains("LOCATION:A102"))
        precondition(ics.contains("调休补 2026-09-07 的课"))
        // Every physical line stays within 75 octets.
        for line in ics.components(separatedBy: "\r\n") { precondition(line.utf8.count <= 75, line) }
        print("occurrence checks passed")
    }
}
