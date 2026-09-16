import ActivityKit
import Foundation

// Isolated preferences: the checks never touch the installed app's App Group.
enum NextWidgetConfiguration {
    static let appGroup = "cn.cputime.tests.live-activity.\(UUID().uuidString)"
}

@main
struct NativeLiveActivityChecks {
    @MainActor
    static func main() async throws {
        let defaults = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)!
        defer { defaults.removePersistentDomain(forName: NextWidgetConfiguration.appGroup) }
        let start = ISO8601DateFormatter().date(from: "2026-09-16T00:00:00Z")!
        let end = start.addingTimeInterval(45 * 60)
        var clock = start.addingTimeInterval(-16 * 60)
        let controller = NativeLiveActivityController(now: { clock })
        let snapshot = fixture()

        // A real authenticated timetable, just outside the lead window.
        controller.accept(snapshot)
        await settle()
        precondition(activeActivities.isEmpty)
        precondition(controller.status == .waiting)

        // The original regression immediately ended this requested activity.
        clock = start.addingTimeInterval(-14 * 60)
        controller.foreground()
        await settle()
        precondition(activeActivities.count == 1, "Upcoming activity must remain active after creation")
        let activity = activeActivities[0]
        precondition(TestActivityKit.events == ["request"], "Creation must not schedule an immediate end or prematurely enter class")
        precondition(activity.content.state.phase == .upcoming)
        precondition(activity.content.staleDate == end)
        precondition(activity.content.state.dateLabel == "周三 · 第 3 周")
        precondition(activity.attributes.week == 3)

        // Snapshot/cache re-delivery must update the same activity.
        controller.accept(snapshot)
        await settle()
        precondition(activeActivities.count == 1 && activeActivities[0].id == activity.id)
        precondition(controller.status == .active)

        // Foreground boundary and resuming after background both reconcile
        // against the clock, instead of waiting for another network fetch.
        clock = start
        controller.foreground()
        await settle()
        precondition(activeActivities[0].content.state.phase == .inProgress)
        precondition(activeActivities[0].content.state.endDate == end)
        precondition(activeActivities[0].id == activity.id)

        clock = end.addingTimeInterval(-1)
        controller.foreground()
        await settle()
        precondition(activeActivities.count == 1, "A class must not end before its actual end time")

        clock = end
        controller.foreground()
        await settle()
        precondition(activeActivities.isEmpty, "An ended class must be dismissed on reconciliation")

        // Transient failure does not permanently prevent a future retry.
        clock = start.addingTimeInterval(60)
        TestActivityKit.failNextRequest = true
        controller.accept(snapshot)
        await settle()
        if case .failed = controller.status {} else { preconditionFailure("Expected request failure") }
        controller.foreground()
        await settle()
        precondition(activeActivities.count == 1, "Foreground retries a previously failed request")
        precondition(activeActivities[0].id != activity.id, "An ended activity must not be reused")

        controller.setEnabled(false)
        await settle()
        precondition(activeActivities.isEmpty && controller.status == .disabled)
        controller.setEnabled(true)
        await settle()
        precondition(activeActivities.count == 1)

        // Account reset must remove the retained snapshot, including resume.
        controller.reset()
        await settle()
        controller.foreground()
        await settle()
        precondition(activeActivities.isEmpty, "Logout must not restart the old account's class")

        // A system permission change is picked up without refreshing data.
        TestActivityKit.activitiesEnabled = false
        controller.accept(snapshot)
        await settle()
        precondition(activeActivities.isEmpty)
        TestActivityKit.activitiesEnabled = true
        controller.foreground()
        await settle()
        precondition(activeActivities.count == 1)

        controller.accept(fixture(authenticated: false))
        await settle()
        precondition(activeActivities.isEmpty)

        controller.accept(snapshot)
        controller.reset()
        await settle()
        precondition(activeActivities.isEmpty, "A cancelled load cannot create an activity after logout")

        // Exercise the real foreground timer loop, with no new snapshot or
        // foreground notification at either course boundary.
        clock = start.addingTimeInterval(-0.1)
        controller.accept(snapshot)
        await settle()
        precondition(activeActivities[0].content.state.phase == .upcoming)
        clock = start
        try await Task.sleep(for: .milliseconds(1100))
        precondition(activeActivities[0].content.state.phase == .inProgress,
                     "The running loop must transition at class start")
        clock = end.addingTimeInterval(-0.1)
        controller.accept(snapshot)
        await settle()
        clock = end
        try await Task.sleep(for: .milliseconds(1100))
        precondition(activeActivities.isEmpty, "The running loop must dismiss at class end")
        controller.reset()

        print("Live Activity checks passed: lead window, create, cache update, start, end, retry, settings, permission and logout")
    }

    @MainActor
    private static var activeActivities: [Activity<ScheduleLiveActivityAttributes>] {
        Activity<ScheduleLiveActivityAttributes>.activities.filter {
            $0.activityState == .active || $0.activityState == .stale
        }
    }

    private static func settle() async {
        try? await Task.sleep(for: .milliseconds(20))
    }

    private static func fixture(authenticated: Bool = true) -> NativeScheduleSnapshot {
        NativeScheduleSnapshot(
            completeSemester: true,
            source: .cache,
            periods: [NativeSchedulePeriod(number: 1, startTime: "08:00", endTime: "08:45")],
            data: NativeScheduleResult(
                currentSemester: "2026-2027-1", currentWeek: "3",
                cells: [NativeScheduleCell(day: 3, bigSlot: 1, courses: [
                    NativeScheduleCourse(name: "药理学实验", teacher: "李老师", weeks: "3周", weekList: [3], location: "药学楼 302", startSlot: 1, endSlot: 1),
                ])]
            ),
            calendar: NativeScheduleCalendar(
                currentSemester: "2026-2027-1", currentWeek: 3,
                weeks: [NativeCalendarWeek(week: 3, days: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"])]
            ),
            auth: NativeScheduleAuth(authenticated: authenticated)
        )
    }
}
