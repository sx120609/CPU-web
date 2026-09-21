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
        defaults.set(15, forKey: NativeLiveActivityController.leadMinutesKey)
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

        // Local reservations respect holidays and make-up days without an upload.
        controller.setEnabled(true)
        controller.broadcastWindows = [.init(id: "2026-09-16", startHour: 0, endHour: 24, channelID: "day-16")]
        clock = start.addingTimeInterval(-3600)
        let ordinary = controller.localReservations(from: fixture())
        precondition(ordinary.count == 1)
        precondition(ordinary[0].start == start.addingTimeInterval(-900))
        precondition(ordinary[0].end == end)
        precondition(controller.localReservations(from: adjustedFixture()).isEmpty)
        clock = ISO8601DateFormatter().date(from: "2026-09-19T07:00:00+08:00")!
        controller.broadcastWindows = [.init(id: "2026-09-19", startHour: 0, endHour: 24, channelID: "day-19")]
        let makeUp = controller.localReservations(from: adjustedFixture())
        precondition(makeUp.count == 1)
        precondition(makeUp[0].state.normalizedAdjustmentNote == "上 09.16 周三的课")
        precondition(controller.localReservations(from: fixture(authenticated: false)).isEmpty)
        controller.setEnabled(false)
        precondition(controller.localReservations(from: adjustedFixture()).isEmpty)
        controller.reset()
        await settle()

        // Execute actual scheduled ActivityKit requests, including cancellation.
        clock = start.addingTimeInterval(-3600)
        controller.setEnabled(true)
        controller.broadcastWindows = [.init(id: "2026-09-16", startHour: 0, endHour: 24, channelID: "day-16")]
        controller.accept(fixture())
        await settle()
        let reserved = Activity<ScheduleLiveActivityAttributes>.activities.filter { $0.activityState == .pending }
        precondition(reserved.count == 1)
        precondition(reserved[0].scheduledStart == start.addingTimeInterval(-900))
        precondition(reserved[0].scheduledAlert?.body.value == reserved[0].content.state.courseName)
        guard case .channel("day-16")? = reserved[0].requestedPushType else {
            preconditionFailure("Local requests must subscribe to the school date channel")
        }
        controller.foreground()
        await settle()
        precondition(Activity<ScheduleLiveActivityAttributes>.activities.filter { $0.activityState == .pending }.map(\.id) == reserved.map(\.id), "Foreground must not duplicate reservations")
        controller.broadcastWindows = [.init(id: "2026-09-16", startHour: 0, endHour: 24, channelID: "new-day-16")]
        await settle()
        precondition(reserved[0].activityState == .ended, "Channel changes must cancel old reservations")
        precondition(Activity<ScheduleLiveActivityAttributes>.activities.filter { $0.activityState == .pending }.count == 1)
        controller.accept(adjustedFixture())
        await settle()
        precondition(Activity<ScheduleLiveActivityAttributes>.activities.filter { $0.activityState == .pending }.isEmpty, "Holiday edits cancel an already scheduled activity")
        controller.accept(fixture())
        await settle()
        TestActivityKit.activitiesEnabled = false
        controller.foreground()
        await settle()
        precondition(Activity<ScheduleLiveActivityAttributes>.activities.filter { $0.activityState == .pending }.isEmpty)
        TestActivityKit.activitiesEnabled = true
        controller.foreground()
        await settle()
        controller.reset()
        await settle()
        precondition(Activity<ScheduleLiveActivityAttributes>.activities.filter { $0.activityState == .pending }.isEmpty, "Logout cancels scheduled starts too")

        // Custom lead applies to local reservations and semester remote plans.
        clock = start.addingTimeInterval(-3600)
        controller.setLeadMinutes(30)
        controller.accept(fixture())
        precondition(controller.leadMinutes == 30)
        precondition(controller.localReservations(from: fixture())[0].start == start.addingTimeInterval(-1800))
        await settle()
        let customReservation = Activity<ScheduleLiveActivityAttributes>.activities.first { $0.activityState == .pending }
        precondition(customReservation?.scheduledStart == start.addingTimeInterval(-1800), "Personal lead must reach ActivityKit, not only the plan")
        let remote = controller.remoteStartWindows()
        precondition(remote.count == 1 && remote[0].start == Int(start.timeIntervalSince1970))
        let wire = String(data: try JSONEncoder().encode(remote), encoding: .utf8)!
        precondition(!wire.contains("药") && !wire.contains("teacher") && !wire.contains("location"))
        controller.setLeadMinutes(0)
        precondition(controller.localReservations(from: fixture())[0].start == start)
        controller.setLeadMinutes(100)
        precondition(controller.leadMinutes == 60)
        controller.setLeadMinutes(15)
        controller.accept(adjustedFixture())
        let moved = controller.remoteStartWindows()
        precondition(moved.count == 1 && moved[0].dateKey == "2026-09-19", "Remote plan includes future make-up day without reopening")
        TestActivityKit.activitiesEnabled = false
        precondition(controller.remoteStartWindows().isEmpty)
        TestActivityKit.activitiesEnabled = true
        controller.remoteStartsEnabled = true
        controller.accept(fixture())
        await settle()
        precondition(activeActivities.isEmpty && Activity<ScheduleLiveActivityAttributes>.activities.filter { $0.activityState == .pending }.isEmpty,
                     "Remote mode must not also create local/scheduled activities")
        let remoteActivity = try Activity<ScheduleLiveActivityAttributes>.request(
            attributes: .init(semester: "", dateKey: "2026-09-16", broadcastWindow: "morning"),
            content: .init(state: .init(phase: .upcoming, courseName: "课程", startDate: start, endDate: end), staleDate: end),
            pushType: .channel("am"))
        controller.foreground()
        await settle()
        precondition(activeActivities.count == 1 && activeActivities[0].id == remoteActivity.id,
                     "Foreground must preserve remote channel activities")
        // An empty school boundary must not keep a completed window alive.
        clock = end
        await remoteActivity.update(.init(state: .init(
            phase: .upcoming, courseName: "", startDate: end, endDate: end,
            broadcastDateKey: "2026-09-16", broadcastTimestamp: end
        ), staleDate: nil))
        controller.foreground()
        await settle()
        precondition(remoteActivity.activityState == .ended,
                     "Remote activities must be dismissed after the student's final class")
        controller.reset()
        controller.remoteStartsEnabled = false
        await settle()

        // Broadcasts carry only time. Resolve multi-period courses using their
        // real interval, never merely the first period number.
        let course = ScheduleLiveActivityAttributes.LocalCourse(
            dateKey: "2026-09-16", period: 1, name: "药理学", teacher: "老师", location: "302",
            periodLabel: "第 1–2 节", startDate: start, endDate: start.addingTimeInterval(100 * 60), weekRangeLabel: "3周"
        )
        let signal = ScheduleLiveActivityAttributes.ContentState(
            phase: .upcoming, courseName: "", startDate: start, endDate: start,
            broadcastDateKey: "2026-09-16", broadcastTimestamp: start
        )
        let attrs = ScheduleLiveActivityAttributes(semester: "2026-1", dateKey: "2026-09-16", broadcastWindow: "morning")
        let resolved = signal.resolvedForBroadcast(attributes: attrs, now: start.addingTimeInterval(55 * 60), cachedCourses: [course])
        precondition(resolved.courseName == "药理学" && resolved.phase == .inProgress)
        precondition(signal.resolvedForBroadcast(attributes: attrs, now: start.addingTimeInterval(-900), cachedCourses: [course]).phase == .upcoming)
        precondition(signal.resolvedForBroadcast(attributes: attrs, now: course.endDate, cachedCourses: [course]).phase == .idle)
        let finished = signal.resolvedForBroadcast(now: course.endDate, cachedCourses: [course])
        precondition(finished.phase == .idle && !finished.courseName.isEmpty,
                     "A late broadcast without window attributes must show a finished state, never an empty countdown")
        precondition(signal.resolvedForBroadcast(attributes: attrs, now: start, cachedCourses: []).phase == .idle)
        let afternoon = ScheduleLiveActivityAttributes(semester: "2026-1", dateKey: "2026-09-16", broadcastWindow: "afternoon")
        precondition(signal.resolvedForBroadcast(attributes: afternoon, now: start, cachedCourses: [course]).phase == .idle)
        let tomorrow = ScheduleLiveActivityAttributes(semester: "2026-1", dateKey: "2026-09-17", broadcastWindow: "morning")
        precondition(signal.resolvedForBroadcast(attributes: tomorrow, now: start, cachedCourses: [course]).phase == .idle)

        // Multiple lessons share one date channel but keep independent content.
        let later = ScheduleLiveActivityAttributes.LocalCourse(
            dateKey: course.dateKey, period: 3, name: "Second lesson", teacher: "", location: "",
            periodLabel: nil, startDate: start.addingTimeInterval(120 * 60),
            endDate: start.addingTimeInterval(165 * 60), weekRangeLabel: nil
        )
        let lessons = [course, later]
        let daily = lessons.map {
            ScheduleLiveActivityAttributes(semester: "2026-1", dateKey: $0.dateKey,
                broadcastWindow: $0.dateKey, broadcastChannel: "day-16",
                reservationStart: $0.startDate, reservationEnd: $0.endDate)
        }
        let firstState = signal.resolvedForBroadcast(attributes: daily[0], now: start, cachedCourses: lessons)
        precondition(firstState.phase == .inProgress && firstState.endDate == course.endDate)
        let secondState = signal.resolvedForBroadcast(attributes: daily[1], now: start, cachedCourses: lessons)
        precondition(secondState.phase == .upcoming && secondState.courseName == later.name)
        precondition(signal.resolvedForBroadcast(attributes: daily[0], now: later.startDate, cachedCourses: lessons).phase == .idle,
                     "An ended lesson must not adopt another lesson from the shared channel")
        let boundary = signal.resolvedForBroadcast(attributes: daily[1], now: later.startDate, cachedCourses: lessons)
        precondition(boundary.phase == .inProgress && boundary.endDate == later.endDate)
        precondition(boundary == signal.resolvedForBroadcast(attributes: daily[1], now: later.startDate, cachedCourses: lessons),
                     "Repeated boundary updates must be idempotent")
        precondition(signal.resolvedForBroadcast(attributes: daily[1], now: later.endDate, cachedCourses: lessons).phase == .idle,
                     "Final update resolves to idle without an APNs end")

        // Exercise the real network coordinator, including a logout while a
        // plan save is in flight. Late success must be revoked, not resurrected.
        let shared = NativeLiveActivityController.shared
        let push = LiveActivityPushService(localScheduling: false)
        var calls: [(String, String, [String: Any]?)] = []
        var held: CheckedContinuation<Data, Error>?
        var holdNext = false
        let response = Data("{\"data\":{\"revoke\":\"test-capability\",\"scheduledThrough\":\"2027-01-01\",\"missingWindows\":[]}}".utf8)
        defer {
            for key in ["cpu.liveActivity.remote.revoke", "cpu.liveActivity.remote.pendingRevokes"] {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }
        push.setAPIRequest { path, method, body in
            calls.append((path, method, body))
            if method == "PUT", holdNext {
                holdNext = false
                return try await withCheckedThrowingContinuation { held = $0 }
            }
            return response
        }
        shared.accept(fixture())
        push.activate()
        await settle()
        precondition(calls.filter { $0.1 == "PUT" }.count == 1)
        shared.setLeadMinutes(25)
        await settle()
        precondition(calls.last?.2?["leadMinutes"] as? Int == 25)
        precondition(calls.last?.2?["replaces"] as? String == "test-capability")
        holdNext = true
        shared.setLeadMinutes(35)
        await settle()
        precondition(held != nil)
        shared.reset()
        held?.resume(returning: response)
        held = nil
        await settle()
        precondition(calls.last?.0 == "/api/live-activities/remote-start/revoke")
        precondition(UserDefaults.standard.string(forKey: "cpu.liveActivity.remote.revoke") == nil)
        precondition((UserDefaults.standard.stringArray(forKey: "cpu.liveActivity.remote.pendingRevokes") ?? []).isEmpty)
        shared.setLeadMinutes(15)

        let localPush = LiveActivityPushService(localScheduling: true)
        calls.removeAll()
        UserDefaults.standard.set("legacy-device", forKey: "cpu.liveActivity.remote.revoke")
        localPush.setAPIRequest { path, method, body in
            calls.append((path, method, body))
            return Data("{\"data\":{\"windows\":[{\"id\":\"2026-09-16\",\"startHour\":0,\"endHour\":24,\"channelID\":\"school-day\"}]}}".utf8)
        }
        shared.accept(fixture())
        localPush.activate()
        await settle()
        precondition(!shared.remoteStartsEnabled)
        precondition(calls.first?.0 == "/api/live-activities/remote-start/revoke", "Upgrade must revoke old starts before local reservations")
        precondition(calls.contains { $0.0.contains("broadcast-config?mode=day") && $0.1 == "GET" && $0.2 == nil })
        precondition(!calls.contains { $0.1 == "PUT" }, "iOS 26 must not upload personal plans")
        precondition(shared.broadcastWindows.first?.channelID == "school-day")
        localPush.resetForLogout()
        shared.reset()
        await settle()

        print("Live Activity checks passed: legacy flow, local date reservations, reminders, upgrade revocation, no iOS 26 plan upload, broadcast resolution and lifecycle")
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

    /// 周三放假，周六补这天的课：计划必须跟着挪，而且说清楚挪的是哪天。
    private static func adjustedFixture() -> NativeScheduleSnapshot {
        let base = fixture()
        return NativeScheduleSnapshot(
            completeSemester: true,
            source: .cache,
            periods: base.periods,
            data: base.data,
            calendar: NativeScheduleCalendar(
                currentSemester: "2026-2027-1",
                currentWeek: 3,
                weeks: base.calendar?.weeks ?? [],
                adjustments: [
                    NativeScheduleAdjustment(date: "2026-09-16", kind: "off", source: nil, note: "国庆节放假"),
                    NativeScheduleAdjustment(date: "2026-09-19", kind: "swap", source: "2026-09-16", note: nil),
                ]
            ),
            auth: NativeScheduleAuth(authenticated: true)
        )
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
