import ActivityKit
import Combine
import Foundation

/// Keeps one schedule Live Activity in sync with the currently visible native
/// timetable. The widget renders the countdown locally, while this controller
/// only needs to refresh when the course crosses a boundary or the schedule
/// changes.
@available(iOS 16.1, *)
@MainActor
final class NativeLiveActivityController: ObservableObject {
    enum Status: Equatable {
        case disabled
        case waiting
        case active
        case unavailable(String)
        case failed(String)

        var title: String {
            switch self {
            case .disabled: return "已关闭"
            case .waiting: return "等待下一节课"
            case .active: return "实时活动已显示"
            case .unavailable: return "暂时没有可显示的课程"
            case .failed: return "启动失败"
            }
        }

        var detail: String? {
            switch self {
            case .unavailable(let message), .failed(let message): return message
            default: return nil
            }
        }
    }

    static let shared = NativeLiveActivityController()
    static let enabledKey = "scheduleLiveActivityEnabled"
    /// A timetable Live Activity is useful only when the next class is close
    /// enough to act on. The regular widgets remain the right surface for
    /// showing a class that is hours away.
    static let leadTime: TimeInterval = 15 * 60

    @Published private(set) var status: Status = .waiting
    @Published private(set) var isPreviewActive = false

    private var refreshTask: Task<Void, Never>?
    private var previewEndTask: Task<Void, Never>?
    private var lastSnapshot: NativeScheduleSnapshot?
    /// ActivityKit can apply a future state update/end timestamp while the app
    /// is suspended. Keep the last scheduled boundary so the sync loop does
    /// not submit the same future operation on every poll.
    private var scheduledLifecycleKey: String?
    private var currentActivity: Activity<ScheduleLiveActivityAttributes>? {
        Activity<ScheduleLiveActivityAttributes>.activities.first
    }

    private init() {
        if !ActivityAuthorizationInfo().areActivitiesEnabled {
            status = .unavailable("请在系统设置中允许“实时活动”。")
        } else if currentActivity != nil {
            status = .active
        }
    }

    var isEnabled: Bool {
        UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?
            .object(forKey: Self.enabledKey) as? Bool ?? true
    }

    func setEnabled(_ enabled: Bool) {
        UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?.set(enabled, forKey: Self.enabledKey)
        if enabled, let lastSnapshot {
            status = .waiting
            accept(lastSnapshot)
        } else if !enabled {
            status = .disabled
            end()
        } else {
            status = .waiting
        }
    }

    func accept(_ snapshot: NativeScheduleSnapshot) {
        lastSnapshot = snapshot
        if isPreviewActive { return }
        refreshTask?.cancel()
        guard isEnabled else {
            status = .disabled
            end()
            return
        }
        status = .waiting
        refreshTask = Task { @MainActor [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                guard let delay = await self.synchronize(snapshot) else { return }
                do {
                    try await Task.sleep(for: .seconds(delay))
                } catch {
                    return
                }
            }
        }
    }

    /// Starts a local, self-contained activity so users can inspect the lock
    /// screen and Dynamic Island layout without waiting for a real class.
    func startPreview() {
        guard isEnabled else {
            status = .disabled
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            status = .unavailable("请在系统设置中允许“实时活动”。")
            return
        }

        refreshTask?.cancel()
        refreshTask = nil
        previewEndTask?.cancel()
        previewEndTask = nil
        isPreviewActive = true
        status = .waiting

        let start = Date.now.addingTimeInterval(-20 * 60)
        let end = Date.now.addingTimeInterval(55 * 60)
        let state = ScheduleLiveActivityAttributes.ContentState(
            phase: .inProgress,
            courseName: "药理学实验",
            teacher: "李老师",
            location: "药学楼 302",
            periodLabel: "第 3-4 节",
            dateLabel: "今天 · 演示",
            weekRangeLabel: "第 3 周",
            startDate: start,
            endDate: end,
            nextCourseName: "药物化学",
            nextCoursePeriod: "第 6 节",
            nextCourseDateLabel: "今天",
            nextCourseWeekRangeLabel: "第 3 周",
            nextCourseTeacher: "王老师",
            nextCourseLocation: "教学楼 101",
            nextCourseStart: end.addingTimeInterval(40 * 60),
            nextCourseEnd: end.addingTimeInterval(130 * 60),
            updatedAt: .now
        )
        let attributes = ScheduleLiveActivityAttributes(
            semester: "__preview__",
            dateKey: "preview",
            week: 0
        )
        let content = ActivityContent(state: state, staleDate: end)

        Task { @MainActor [weak self] in
            guard let self else { return }
            await endActivities()
            do {
                _ = try Activity<ScheduleLiveActivityAttributes>.request(
                    attributes: attributes,
                    content: content,
                    pushType: nil
                )
                status = .active
                previewEndTask = Task { @MainActor [weak self] in
                    let seconds = max(1, end.timeIntervalSinceNow)
                    do {
                        try await Task.sleep(for: .seconds(seconds))
                    } catch {
                        return
                    }
                    guard let self, self.isPreviewActive else { return }
                    self.endPreview()
                }
            } catch {
                isPreviewActive = false
                status = .failed(error.localizedDescription)
            }
        }
    }

    func endPreview() {
        guard isPreviewActive else { return }
        previewEndTask?.cancel()
        previewEndTask = nil
        isPreviewActive = false
        end()
        if isEnabled, let lastSnapshot {
            accept(lastSnapshot)
        } else if isEnabled {
            status = .waiting
        }
    }

    func end() {
        refreshTask?.cancel()
        refreshTask = nil
        previewEndTask?.cancel()
        previewEndTask = nil
        isPreviewActive = false
        scheduledLifecycleKey = nil
        if !isEnabled { status = .disabled }
        let activities = Activity<ScheduleLiveActivityAttributes>.activities
        guard !activities.isEmpty else { return }
        Task { @MainActor in
            for activity in activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    private func synchronize(_ snapshot: NativeScheduleSnapshot) async -> TimeInterval? {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            status = .unavailable("请在系统设置中允许“实时活动”。")
            await endActivities()
            return nil
        }
        guard snapshot.auth.authenticated else {
            status = .unavailable("完成登录并加载课表后会自动显示。")
            await endActivities()
            return nil
        }
        guard let occurrence = nextOccurrence(in: snapshot) else {
            status = .unavailable("今天和接下来没有可显示的课程。")
            await endActivities()
            return nil
        }

        // Keep the island quiet while the next class is still far away. The
        // refresh loop stays alive so it can start automatically as the class
        // enters the lead window.
        if !occurrence.isInProgress,
           occurrence.start.timeIntervalSinceNow > Self.leadTime {
            status = .waiting
            await endActivities()
            return refreshDelay(for: occurrence)
        }

        let attributes = ScheduleLiveActivityAttributes(
            semester: snapshot.data?.currentSemester ?? "",
            dateKey: occurrence.dateKey,
            week: occurrence.week
        )
        let state = contentState(for: occurrence, phase: occurrence.isInProgress ? .inProgress : .upcoming)
        let inProgressState = contentState(for: occurrence, phase: .inProgress)
        // The system should consider the activity stale as soon as this
        // occurrence ends. The controller wakes at the same boundary and
        // either advances to a nearby class or dismisses the activity.
        let content = ActivityContent(state: state, staleDate: occurrence.end)
        let inProgressContent = ActivityContent(state: inProgressState, staleDate: occurrence.end)

        if let activity = currentActivity,
           activity.attributes == attributes {
            await activity.update(content)
            await scheduleLifecycle(
                for: activity,
                occurrence: occurrence,
                inProgressContent: inProgressContent
            )
            status = .active
            return refreshDelay(for: occurrence)
        }
        await endActivities()
        do {
            let activity = try Activity<ScheduleLiveActivityAttributes>.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
            await scheduleLifecycle(
                for: activity,
                occurrence: occurrence,
                inProgressContent: inProgressContent
            )
            status = .active
            return refreshDelay(for: occurrence)
        } catch {
            status = .failed(error.localizedDescription)
            return nil
        }
    }

    /// Wake at the next meaningful boundary instead of polling on a fixed
    /// cadence. This keeps a finished class from lingering on the lock screen
    /// while still starting the activity as the next class enters the lead
    /// window.
    private func refreshDelay(for occurrence: Occurrence) -> TimeInterval {
        let now = Date.now
        if occurrence.isInProgress {
            return max(1, min(15, occurrence.end.timeIntervalSince(now)))
        }

        let untilLeadWindow = occurrence.start.timeIntervalSince(now) - Self.leadTime
        if untilLeadWindow > 0 {
            return max(5, min(60, untilLeadWindow))
        }
        return max(1, min(15, occurrence.start.timeIntervalSince(now)))
    }

    private func endActivities() async {
        scheduledLifecycleKey = nil
        for activity in Activity<ScheduleLiveActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// Schedule the two boundaries with ActivityKit when the OS supports
    /// timestamped updates. This keeps the phase transition and dismissal
    /// working while the app is backgrounded or the device is locked. The
    /// controller's short foreground loop remains as a fallback for iOS 17.0
    /// and 17.1, where timestamped local updates are unavailable.
    private func scheduleLifecycle(
        for activity: Activity<ScheduleLiveActivityAttributes>,
        occurrence: Occurrence,
        inProgressContent: ActivityContent<ScheduleLiveActivityAttributes.ContentState>
    ) async {
        let now = Date.now
        let lifecycleKey = "\(activity.id)|\(occurrence.start.timeIntervalSince1970)|\(occurrence.end.timeIntervalSince1970)"
        guard scheduledLifecycleKey != lifecycleKey else { return }
        scheduledLifecycleKey = lifecycleKey

        guard #available(iOS 17.2, *) else { return }
        if occurrence.start > now {
            // The system applies this state at the exact class start, even if
            // the app has been suspended in the meantime.
            await activity.update(inProgressContent, timestamp: occurrence.start)
        }
        // A future timestamp makes the activity disappear at the class end;
        // using immediate dismissal avoids leaving a stale card on the lock
        // screen after the final second.
        await activity.end(nil, dismissalPolicy: .immediate, timestamp: occurrence.end)
    }

    private func contentState(
        for occurrence: Occurrence,
        phase: ScheduleLiveActivityAttributes.ContentState.Phase
    ) -> ScheduleLiveActivityAttributes.ContentState {
        ScheduleLiveActivityAttributes.ContentState(
            phase: phase,
            courseName: occurrence.name,
            teacher: occurrence.teacher,
            location: occurrence.location,
            periodLabel: occurrence.periodLabel,
            dateLabel: occurrence.dateLabel,
            weekRangeLabel: occurrence.weekRangeLabel,
            startDate: occurrence.start,
            endDate: occurrence.end,
            nextCourseName: occurrence.next?.name,
            nextCoursePeriod: occurrence.next?.periodLabel,
            nextCourseDateLabel: occurrence.next?.dateLabel,
            nextCourseWeekRangeLabel: occurrence.next?.weekRangeLabel,
            nextCourseTeacher: occurrence.next?.teacher,
            nextCourseLocation: occurrence.next?.location,
            nextCourseStart: occurrence.next?.start,
            nextCourseEnd: occurrence.next?.end,
            updatedAt: phase == .inProgress ? occurrence.start : .now
        )
    }

    private struct Occurrence {
        struct NextCourse {
            let name: String
            let teacher: String
            let location: String
            let start: Date
            let end: Date
            let periodLabel: String
            let dateLabel: String
            let weekRangeLabel: String
        }

        let name: String
        let teacher: String
        let location: String
        let periodLabel: String
        let dateLabel: String
        let start: Date
        let end: Date
        let dateKey: String
        let week: Int
        let isInProgress: Bool
        let next: NextCourse?
        let weekRangeLabel: String
    }

    private func nextOccurrence(in snapshot: NativeScheduleSnapshot) -> Occurrence? {
        guard let data = snapshot.data, let calendar = snapshot.calendar else { return nil }
        var dateCalendar = Calendar(identifier: .gregorian)
        dateCalendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let now = Date()
        let periods = snapshot.periods.isEmpty ? NativeSchedulePeriod.bundledTimetable : snapshot.periods
        let periodByNumber = Dictionary(uniqueKeysWithValues: periods.map { ($0.number, $0) })
        // The timetable payload can contain the whole semester while the
        // visible grid is only one week. Build occurrences for every dated
        // week so a no-class day still gets the next scheduled course.
        let events = calendar.weeks.flatMap { week -> [Occurrence] in
            week.days.enumerated().flatMap { dayIndex, day in
                data.cells
                    .filter { $0.day == dayIndex + 1 }
                    .flatMap { cell in
                        cell.courses.compactMap { course -> Occurrence? in
                            guard course.weekList.isEmpty || course.weekList.contains(week.week) else { return nil }
                            let range = NativeSchedulePeriod.normalizedRange(
                                bigSlot: cell.bigSlot,
                                startSlot: course.startSlot,
                                endSlot: course.endSlot,
                                periods: periods
                            )
                            guard let startPeriod = periodByNumber[range.start],
                                  let endPeriod = periodByNumber[range.end] else {
                                return nil
                            }
                            guard let start = date(day, time: startPeriod.startTime, calendar: dateCalendar),
                                  let end = date(day, time: endPeriod.endTime, calendar: dateCalendar),
                                  end > start else {
                                return nil
                            }
                            return Occurrence(
                                name: course.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "课程" : course.name,
                                teacher: course.teacher?.trimmedNonEmpty ?? "",
                                location: course.location?.trimmedNonEmpty ?? "",
                                periodLabel: Self.periodLabel(start: range.start, end: range.end),
                                dateLabel: Self.dateLabel(day: day, week: week.week),
                                start: start,
                                end: end,
                                dateKey: day,
                                week: week.week,
                                isInProgress: false,
                                next: nil,
                                weekRangeLabel: course.weeks.trimmedNonEmpty ?? ""
                            )
                        }
                    }
            }
        }
        .filter { $0.end > now }
        .sorted { $0.start < $1.start }
        guard !events.isEmpty else { return nil }

        if let index = events.firstIndex(where: { $0.start <= now && now < $0.end }) {
            let current = events[index]
            return Occurrence(
                name: current.name,
                teacher: current.teacher,
                location: current.location,
                periodLabel: current.periodLabel,
                dateLabel: current.dateLabel,
                start: current.start,
                end: current.end,
                dateKey: current.dateKey,
                week: current.week,
                isInProgress: true,
                next: events.dropFirst(index + 1).first.map {
                    Occurrence.NextCourse(
                        name: $0.name,
                        teacher: $0.teacher,
                        location: $0.location,
                        start: $0.start,
                        end: $0.end,
                        periodLabel: $0.periodLabel,
                        dateLabel: $0.dateLabel,
                        weekRangeLabel: $0.weekRangeLabel
                    )
                },
                weekRangeLabel: current.weekRangeLabel
            )
        }
        let upcoming = events[0]
        let next = events.dropFirst().first.map {
            Occurrence.NextCourse(
                name: $0.name,
                teacher: $0.teacher,
                location: $0.location,
                start: $0.start,
                end: $0.end,
                periodLabel: $0.periodLabel,
                dateLabel: $0.dateLabel,
                weekRangeLabel: $0.weekRangeLabel
            )
        }
        return Occurrence(
            name: upcoming.name,
            teacher: upcoming.teacher,
            location: upcoming.location,
            periodLabel: upcoming.periodLabel,
            dateLabel: upcoming.dateLabel,
            start: upcoming.start,
            end: upcoming.end,
            dateKey: upcoming.dateKey,
            week: upcoming.week,
            isInProgress: false,
            next: next,
            weekRangeLabel: upcoming.weekRangeLabel
        )
    }

    private static func periodLabel(start: Int, end: Int) -> String {
        start == end ? "第 " + String(start) + " 节" : "第 " + String(start) + "-" + String(end) + " 节"
    }

    private static func dateLabel(day: String, week: Int) -> String {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return week > 0 ? "第 " + String(week) + " 周" : "" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        let weekday = date.map { calendar.component(.weekday, from: $0) }
        let labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
        let dayLabel = weekday.flatMap { labels.indices.contains($0) ? labels[$0] : nil }
        if let dayLabel, week > 0 { return dayLabel + " · 第 " + String(week) + " 周" }
        return dayLabel ?? (week > 0 ? "第 " + String(week) + " 周" : "")
    }

    private func date(_ day: String, time: String, calendar: Calendar) -> Date? {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        let dateParts = day.split(separator: "-").compactMap { Int($0) }
        guard dateParts.count == 3 else { return nil }
        var components = DateComponents()
        components.year = dateParts[0]
        components.month = dateParts[1]
        components.day = dateParts[2]
        components.hour = parts[0]
        components.minute = parts[1]
        components.second = 0
        return calendar.date(from: components)
    }
}
