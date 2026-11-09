import Foundation

@main
struct ScheduleOverlayTimingChecks {
    static func main() {
        typealias T = ScheduleOverlayTiming
        let cpu = T.periods(NativeSchedulePeriod.bundledTimetable)
        let njmuBells = [("08:00", "08:40"), ("08:50", "09:30"), ("09:40", "10:20"), ("10:30", "11:10"), ("11:20", "12:00"),
                         ("12:10", "12:50"), ("14:00", "14:40"), ("14:50", "15:30")]
        let njmu = T.periods(njmuBells.enumerated().map { NativeSchedulePeriod(number: $0.offset + 1, startTime: $0.element.0, endTime: $0.element.1) })

        precondition(T.sameBells(cpu, cpu))
        precondition(!T.sameBells(njmu, cpu))
        // Fewer periods with the same bells still count as the same.
        precondition(T.sameBells(Array(cpu.prefix(4)), cpu))

        // NJMU 1–2 (08:00–09:30) covers CPU 1–2 (08:00–09:40).
        precondition(T.place(start: 480, end: 570, on: cpu)! == (1, 2))
        // NJMU 3–4 (09:40–11:10): CPU 2 ends at 09:40, so it starts in the break before CPU 3.
        precondition(T.place(start: 580, end: 670, on: cpu)! == (3, 4))
        // NJMU 7–8 (14:00–15:30) covers CPU 5–7.
        precondition(T.place(start: 840, end: 930, on: cpu)! == (5, 7))
        // NJMU 6 (12:10–12:50) falls in CPU's lunch break: the nearest period.
        precondition(T.place(start: 730, end: 770, on: cpu)! == (4, 4))
        // Late at night: the last period.
        let last = cpu.last!.number
        precondition(T.place(start: 23 * 60, end: 23 * 60 + 30, on: cpu)! == (last, last))
        precondition(T.place(start: 600, end: 650, on: []) == nil)

        precondition(T.minutes("8:05") == 485 && T.minutes("24:00") == nil && T.minutes("") == nil)
        precondition(T.clock(485) == "08:05")
        let course = NativeScheduleCourse(nativeId: "x", name: "药理学", weekList: [1], startSlot: 3, endSlot: 4)
        let moved = course.withClock(start: "09:40", end: "11:10")
        precondition(moved.customStartTime == "09:40" && moved.customEndTime == "11:10" && moved.name == "药理学" && moved.nativeId == "x")
        print("overlay timing checks passed")
    }
}
