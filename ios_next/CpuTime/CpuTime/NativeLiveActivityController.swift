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

    private var refreshTask: Task<Void, Never>?
    private var lastSnapshot: NativeScheduleSnapshot?
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
                let shouldContinue = await self.synchronize(snapshot)
                guard shouldContinue else { return }
                try? await Task.sleep(for: .seconds(45))
            }
        }
    }

    func end() {
        refreshTask?.cancel()
        refreshTask = nil
        if !isEnabled { status = .disabled }
        let activities = Activity<ScheduleLiveActivityAttributes>.activities
        guard !activities.isEmpty else { return }
        Task { @MainActor in
            for activity in activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    private func synchronize(_ snapshot: NativeScheduleSnapshot) async -> Bool {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            status = .unavailable("请在系统设置中允许“实时活动”。")
            await endActivities()
            return false
        }
        guard snapshot.auth.authenticated else {
            status = .unavailable("完成登录并加载课表后会自动显示。")
            await endActivities()
            return false
        }
        guard let occurrence = nextOccurrence(in: snapshot) else {
            status = .unavailable("今天和接下来没有可显示的课程。")
            await endActivities()
            return false
        }

        // Keep the island quiet while the next class is still far away. The
        // refresh loop stays alive so it can start automatically as the class
        // enters the lead window.
        if !occurrence.isInProgress,
           occurrence.start.timeIntervalSinceNow > Self.leadTime {
            status = .waiting
            await endActivities()
            return true
        }

        let attributes = ScheduleLiveActivityAttributes(
            semester: snapshot.data?.currentSemester ?? "",
            dateKey: occurrence.dateKey
        )
        let state = ScheduleLiveActivityAttributes.ContentState(
            phase: occurrence.isInProgress ? .inProgress : .upcoming,
            courseName: occurrence.name,
            teacher: occurrence.teacher,
            location: occurrence.location,
            startDate: occurrence.start,
            endDate: occurrence.end,
            nextCourseName: occurrence.next?.name,
            nextCourseStart: occurrence.next?.start,
            updatedAt: .now
        )
        let content = ActivityContent(state: state, staleDate: occurrence.end.addingTimeInterval(3600))

        if let activity = currentActivity,
           activity.attributes == attributes {
            await activity.update(content)
            status = .active
            return true
        }
        await endActivities()
        do {
            _ = try Activity<ScheduleLiveActivityAttributes>.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
            status = .active
            return true
        } catch {
            status = .failed(error.localizedDescription)
            return false
        }
    }

    private func endActivities() async {
        for activity in Activity<ScheduleLiveActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    private struct Occurrence {
        struct NextCourse {
            let name: String
            let start: Date
        }

        let name: String
        let teacher: String
        let location: String
        let start: Date
        let end: Date
        let dateKey: String
        let isInProgress: Bool
        let next: NextCourse?
    }

    private func nextOccurrence(in snapshot: NativeScheduleSnapshot) -> Occurrence? {
        guard let data = snapshot.data, let calendar = snapshot.calendar else { return nil }
        var dateCalendar = Calendar(identifier: .gregorian)
        dateCalendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let now = Date()
        let periods = snapshot.periods.isEmpty ? NativeSchedulePeriod.bundledTimetable : snapshot.periods
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
                            guard let startPeriod = periods.first(where: { $0.number == range.start }),
                                  let endPeriod = periods.first(where: { $0.number == range.end }),
                                  let start = date(day, time: startPeriod.startTime, calendar: dateCalendar),
                                  let end = date(day, time: endPeriod.endTime, calendar: dateCalendar),
                                  end > start else { return nil }
                            return Occurrence(
                                name: course.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "课程" : course.name,
                                teacher: course.teacher?.trimmedNonEmpty ?? "",
                                location: course.location?.trimmedNonEmpty ?? "",
                                start: start,
                                end: end,
                                dateKey: day,
                                isInProgress: false,
                                next: nil
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
                start: current.start,
                end: current.end,
                dateKey: current.dateKey,
                isInProgress: true,
                next: events.dropFirst(index + 1).first.map { Occurrence.NextCourse(name: $0.name, start: $0.start) }
            )
        }
        let upcoming = events[0]
        let next = events.dropFirst().first.map { Occurrence.NextCourse(name: $0.name, start: $0.start) }
        return Occurrence(
            name: upcoming.name,
            teacher: upcoming.teacher,
            location: upcoming.location,
            start: upcoming.start,
            end: upcoming.end,
            dateKey: upcoming.dateKey,
            isInProgress: false,
            next: next
        )
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
