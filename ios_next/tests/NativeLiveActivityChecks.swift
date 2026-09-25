import ActivityKit
import Foundation

enum NextWidgetConfiguration { static let appGroup = "cn.cputime.tests.live-activity.\(UUID().uuidString)" }
@main
struct NativeLiveActivityChecks {
    @MainActor static func main() async throws {
        let defaults = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)!
        defer { defaults.removePersistentDomain(forName: NextWidgetConfiguration.appGroup) }
        let start = ISO8601DateFormatter().date(from: "2026-09-16T00:00:00Z")!
        var clock = start.addingTimeInterval(-900)
        let segments = [ScheduleLiveActivityAttributes.Segment(period: 1, startAt: start, endAt: start.addingTimeInterval(2700)),
                        .init(period: 2, startAt: start.addingTimeInterval(3300), endAt: start.addingTimeInterval(6000))]
        for lead in [15, 30, 60] {
            let upcoming = ScheduleLiveActivityAttributes.resolveTimeline(segments, mode: .segmented, now: start.addingTimeInterval(Double(-lead * 60)))!
            precondition(upcoming.phase == .upcoming && upcoming.target == start)
        }
        precondition(ScheduleLiveActivityAttributes.resolveTimeline(segments, mode: .segmented, now: start)!.target == start.addingTimeInterval(2700))
        precondition(ScheduleLiveActivityAttributes.resolveTimeline(segments, mode: .segmented, now: start.addingTimeInterval(2700))!.phase == .intermission)
        let breakTimeline = ScheduleLiveActivityAttributes.resolveTimeline(segments, mode: .segmented, now: start.addingTimeInterval(2700))!
        precondition(breakTimeline.target == start.addingTimeInterval(3300))
        precondition(breakTimeline.courseEnd == start.addingTimeInterval(6000), "break displays the upcoming segment's full time range")
        precondition(ScheduleLiveActivityAttributes.resolveTimeline(segments, mode: .whole, now: start.addingTimeInterval(2700))!.target == start.addingTimeInterval(6000))
        precondition(ScheduleLiveActivityAttributes.resolveTimeline(segments, mode: .segmented, now: start.addingTimeInterval(3300))!.index == 1)
        precondition(ScheduleLiveActivityAttributes.resolveTimeline(segments, mode: .whole, now: start.addingTimeInterval(6000))!.phase == .finished)
        // A scheduled wake-up before 08:00 must display the entire 08:00–11:35
        // course, while the upcoming timer still counts down to startDate.
        let morningEnd = start.addingTimeInterval(12900)
        let morningSegments = segments + [
            .init(period: 3, startAt: start.addingTimeInterval(6900), endAt: start.addingTimeInterval(9600)),
            .init(period: 4, startAt: start.addingTimeInterval(10200), endAt: morningEnd)
        ]
        var morningAttributes = ScheduleLiveActivityAttributes(semester: "s", dateKey: "2026-09-16", reservationEnd: morningEnd)
        morningAttributes.occurrenceId = "morning-course"
        morningAttributes.accountScope = "test-account-scope"
        var morningCourse = ScheduleLiveActivityAttributes.LocalCourse(dateKey: "2026-09-16", period: 1,
            name: "上午课程", teacher: "", location: "", periodLabel: "1–4节",
            startDate: start, endDate: morningEnd, weekRangeLabel: nil)
        morningCourse.occurrenceId = morningAttributes.occurrenceId
        morningCourse.accountScope = morningAttributes.accountScope
        morningCourse.segments = morningSegments
        let marker = ScheduleLiveActivityAttributes.ContentState(phase: .idle, courseName: "", startDate: start, endDate: start)
        for mode in [ScheduleLiveActivityAttributes.TimingMode.whole, .segmented] {
            morningCourse.mode = mode
            for lead in [15, 30, 60] {
                let state = marker.resolvedForBroadcast(attributes: morningAttributes,
                    now: start.addingTimeInterval(Double(-lead * 60)), cachedCourses: [morningCourse])
                precondition(state.phase == .upcoming)
                precondition(state.startDate == start, "upcoming countdown targets 08:00")
                precondition(state.endDate == morningEnd, "course time range ends at 11:35, not 08:00")
            }
            let inClass = marker.resolvedForBroadcast(attributes: morningAttributes, now: start, cachedCourses: [morningCourse])
            precondition(inClass.phase == .inProgress && inClass.startDate == start)
            precondition(inClass.endDate == (mode == .whole ? morningEnd : segments[0].endAt))
        }
        for (raw, expected) in [(0, 15), (16, 30), (31, 60), (61, 15), (-1, 15)] { precondition(NativeLiveActivityController.normalizedLead(raw) == expected) }
        let controller = NativeLiveActivityController(now: { clock })
        controller.accept(fixture())
        let config = NativeLiveActivityController.TimingConfig(protocolVersion: 2, scheduleId: "main-campus", scheduleVersion: "test-version", timezone: "Asia/Shanghai",
            periods: [.init(id: 1, name: "1", start: "08:00", end: "08:45"), .init(id: 2, name: "2", start: "08:55", end: "09:40"), .init(id: 3, name: "3", start: "09:55", end: "10:40")],
            issuedAt: clock.timeIntervalSince1970, usableUntil: clock.addingTimeInterval(7 * 86400).timeIntervalSince1970,
            broadcastUntil: clock.addingTimeInterval(8 * 86400).timeIntervalSince1970,
            windows: [1, 2, 3].map { .init(id: String($0), startHour: 0, endHour: 24, channelID: "end-\($0)") })
        controller.installTiming(config)
        controller.localHandoffComplete = true
        controller.accept(fixture())
        await settle()
        let firstPlan = controller.remoteStartWindows()
        precondition(firstPlan.count == 2)
        precondition(live.count == 2, "iOS 26 schedules each course independently")
        let first = live.first { $0.attributes.occurrenceId == firstPlan[0].occurrenceId }!
        let second = live.first { $0.attributes.occurrenceId == firstPlan[1].occurrenceId }!
        precondition(first.attributes.broadcastWindow == "2")
        precondition(first.content.state.phase == .upcoming && first.content.state.startDate == start)
        precondition(first.content.state.endDate == start.addingTimeInterval(6000), "reservation preserves the course end before wake-up")
        controller.setLeadMinutes(60)
        await settle()
        let revisedSecond = live.first { $0.attributes.occurrenceId == second.attributes.occurrenceId }!
        precondition(revisedSecond.attributes.reminderDate == start.addingTimeInterval(6000), "next course cannot start before previous course ends")
        precondition(controller.remoteStartWindows().map(\.occurrenceId) == firstPlan.map(\.occurrenceId))
        controller.accept(fixture(name: "课程改名"))
        await settle()
        precondition(controller.remoteStartWindows().map(\.occurrenceId) == firstPlan.map(\.occurrenceId), "presentation edits retain identity")
        let active = live.first { $0.attributes.occurrenceId == firstPlan[0].occurrenceId }!
        active.testSetState(.active)
        controller.setTimingMode(.segmented)
        clock = start.addingTimeInterval(2700)
        controller.foreground()
        await settle()
        precondition(active.content.state.phase == .intermission)
        precondition(active.content.state.startDate == start.addingTimeInterval(3300))
        active.testSetState(.dismissed)
        controller.accept(fixture(name: "课程改名"))
        await settle()
        precondition(!live.contains { $0.attributes.occurrenceId == firstPlan[0].occurrenceId }, "same-session dismissal is not immediately restored")
        controller.foreground()
        await settle()
        precondition(live.contains { $0.attributes.occurrenceId == firstPlan[0].occurrenceId }, "next foreground restores dismissed occurrence")
        controller.setEnabled(false)
        await settle()
        precondition(live.isEmpty)
        controller.foreground()
        await settle()
        precondition(live.isEmpty && !controller.isEnabled)
        controller.setEnabled(true)
        await settle()
        precondition(!live.isEmpty)
        clock = start
        controller.accept(fixture(conflict: true))
        await settle()
        precondition(controller.conflicts.count == 1)
        precondition(controller.remoteStartWindows().allSatisfy { $0.startPeriod == 3 }, "unresolved courses are removed from plans")
        let conflict = controller.conflicts[0]
        controller.selectCourse("b", for: conflict)
        await settle()
        let split = controller.remoteStartWindows()
        precondition(split.map(\.startPeriod) == [1, 2, 3])
        precondition(split.first?.supersedes.contains(firstPlan[0].occurrenceId) == false, "boundary-only edit retains identity")
        var attrs = ScheduleLiveActivityAttributes(semester: "s", dateKey: "2026-09-16", reservationEnd: start.addingTimeInterval(6000))
        attrs.accountScope = "other-account"; attrs.occurrenceId = firstPlan[0].occurrenceId
        let fallback = active.content.state.resolvedForBroadcast(attributes: attrs, now: start, cachedCourses: [])
        precondition(fallback.courseName == "课程信息暂不可用")
        controller.reset()
        await settle()
        controller.foreground()
        await settle()
        precondition(live.isEmpty)
        // A closer course must take the slot of the latest pending reservation.
        clock = start.addingTimeInterval(-86400 - 900)
        let capacity = NativeLiveActivityController(now: { clock })
        capacity.accept(fixture(account: "capacity-account"))
        capacity.installTiming(config)
        capacity.localHandoffComplete = true
        TestActivityKit.maximumActivities = 2
        capacity.accept(fixture(account: "capacity-account"))
        await settle()
        precondition(live.count == 2)
        let farthest = live.max { $0.attributes.reservationStart! < $1.attributes.reservationStart! }!
        capacity.accept(fixture(earlier: true, account: "capacity-account"))
        await settle()
        precondition(live.count == 2)
        precondition(live.contains { $0.attributes.dateKey == "2026-09-15" }, "closer pending course gets capacity first")
        precondition(farthest.activityState == .ended)
        precondition(capacity.coverageStatus.contains("共 3 次，已安排 2 次"))
        capacity.reset()
        await settle()
        TestActivityKit.maximumActivities = Int.max
        clock = start.addingTimeInterval(-900)
        let rolling = NativeLiveActivityController(now: { clock })
        let base = fixture(account: "rolling-account")
        let rollingSnapshot = NativeScheduleSnapshot(completeSemester: true, source: .cache, periods: base.periods,
            data: NativeScheduleResult(currentSemester: "s", currentWeek: "3", cells: [NativeScheduleCell(day: 3, bigSlot: 1, courses: [NativeScheduleCourse(nativeId: "roll", name: "滚动课程", weekList: [3, 4], startSlot: 1, endSlot: 1)])]),
            calendar: NativeScheduleCalendar(currentSemester: "s", currentWeek: 3, weeks: base.calendar!.weeks + [NativeCalendarWeek(week: 4, days: ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"])]),
            auth: NativeScheduleAuth(authenticated: true, account: "rolling-account"))
        rolling.accept(rollingSnapshot)
        rolling.installTiming(config)
        rolling.localHandoffComplete = true
        rolling.accept(rollingSnapshot)
        await settle()
        precondition(live.count == 1 && live[0].attributes.dateKey == "2026-09-16")
        clock = start.addingTimeInterval(86400)
        // Simulate an online mapping refresh extending only the signed lease.
        let extended = NativeLiveActivityController.TimingConfig(protocolVersion: 2, scheduleId: config.scheduleId, scheduleVersion: config.scheduleVersion, timezone: config.timezone,
            periods: config.periods, issuedAt: clock.timeIntervalSince1970, usableUntil: clock.addingTimeInterval(7 * 86400).timeIntervalSince1970,
            broadcastUntil: clock.addingTimeInterval(8 * 86400).timeIntervalSince1970, windows: config.windows)
        rolling.installTiming(extended)
        rolling.foreground()
        await settle()
        precondition(live.count == 1 && live[0].attributes.dateKey == "2026-09-23", "foreground extends to courses six days away")
        let retainedID = live[0].id
        rolling.foreground()
        await settle()
        precondition(live.count == 1 && live[0].id == retainedID, "unchanged reservations survive rolling checks")
        rolling.reset()
        await settle()
        print("Live Activity v2 timeline, identity, conflict, reservation, dismissal and privacy checks passed")
    }
    @MainActor static var live: [Activity<ScheduleLiveActivityAttributes>] { Activity<ScheduleLiveActivityAttributes>.activities.filter { $0.activityState != .ended && $0.activityState != .dismissed } }
    static func settle() async { try? await Task.sleep(for: .milliseconds(80)) }
    static func fixture(name: String = "课程 A", conflict: Bool = false, earlier: Bool = false, account: String = "test-account-scope") -> NativeScheduleSnapshot {
        var courses = [NativeScheduleCourse(nativeId: "a", name: name, weeks: "3周", weekList: [3], startSlot: 1, endSlot: 2, sourceKey: "a"),
                       NativeScheduleCourse(nativeId: "c", name: "课程 C", weeks: "3周", weekList: [3], startSlot: 3, endSlot: 3, sourceKey: "c")]
        if conflict { courses.append(NativeScheduleCourse(nativeId: "b", name: "课程 B", weeks: "3周", weekList: [3], startSlot: 2, endSlot: 2, sourceKey: "b")) }
        var cells = [NativeScheduleCell(day: 3, bigSlot: 1, courses: courses)]
        if earlier { cells.append(NativeScheduleCell(day: 2, bigSlot: 1, courses: [NativeScheduleCourse(nativeId: "early", name: "近期课程", weeks: "3周", weekList: [3], startSlot: 1, endSlot: 1, sourceKey: "early")])) }
        return NativeScheduleSnapshot(completeSemester: true, source: .cache,
            periods: [NativeSchedulePeriod(number: 1, startTime: "08:00", endTime: "08:45"), .init(number: 2, startTime: "08:55", endTime: "09:40"), .init(number: 3, startTime: "09:55", endTime: "10:40")],
            data: NativeScheduleResult(currentSemester: "s", currentWeek: "3", cells: cells),
            calendar: NativeScheduleCalendar(currentSemester: "s", currentWeek: 3, weeks: [NativeCalendarWeek(week: 3, days: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"])]),
            auth: NativeScheduleAuth(authenticated: true, account: account))
    }
}
