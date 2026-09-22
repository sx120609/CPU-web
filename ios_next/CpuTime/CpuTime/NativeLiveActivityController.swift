import ActivityKit
import Combine
import Foundation

/// Keeps one schedule Live Activity in sync with the currently visible native
/// timetable. The widget renders the countdown locally, while this controller
/// only needs to refresh when the course crosses a boundary or the schedule
/// changes.
@available(iOS 17.0, *)
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
    static let leadMinutesKey = "scheduleLiveActivityLeadMinutes"
    var leadMinutes: Int {
        let defaultMinutes: Int
        if #available(iOS 26.0, *) { defaultMinutes = 60 } else { defaultMinutes = 15 }
        let value = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?.object(forKey: Self.leadMinutesKey) as? Int ?? defaultMinutes
        return min(60, max(0, value))
    }
    var leadTime: TimeInterval { TimeInterval(leadMinutes * 60) }
    func setLeadMinutes(_ value: Int) {
        UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?.set(min(60, max(0, value)), forKey: Self.leadMinutesKey)
        if let lastSnapshot { accept(lastSnapshot) }
        objectWillChange.send()
    }
    var remoteStartsEnabled = false
    var planDidChange: (() -> Void)?

    @Published private(set) var status: Status = .waiting
    @Published private(set) var isPreviewActive = false

    private var refreshTask: Task<Void, Never>?
    private var previewEndTask: Task<Void, Never>?
    private var lastSnapshot: NativeScheduleSnapshot?
    private let now: () -> Date
    var resetPushService: (() -> Void)?
    var currentScheduleMetadata: NativeScheduleSnapshot? { lastSnapshot }
    var scheduleBackgroundWakeup: ((Date) -> Void)?
    @Published var broadcastStatus = "远程启动需要 iOS 18 和学校广播；课程详情仅保存在本机。"
    struct BroadcastWindow: Codable, Equatable {
        let id: String
        let startHour: Int
        let endHour: Int
        let channelID: String?
    }
    var broadcastWindows: [BroadcastWindow] = [] {
        didSet {
            guard oldValue != broadcastWindows, let snapshot = lastSnapshot, !isPreviewActive else { return }
            accept(snapshot)
        }
    }
    /// 一个课节块 = 课间短休相连的一串节次，由服务端按全校节次表推导下发。
    /// 客户端不再自己猜时段边界，也不需要频道 ID：服务端发送时才解析频道。
    struct ScheduleBlock: Codable, Equatable {
        let id: String
        let startClock: String
        let endClock: String

        var startSeconds: Int { ScheduleBlock.seconds(startClock) }
        var endSeconds: Int { ScheduleBlock.seconds(endClock) }

        static func seconds(_ clock: String) -> Int {
            let parts = clock.split(separator: ":")
            guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return -1 }
            return hour * 3600 + minute * 60
        }
    }
    var scheduleBlocks: [ScheduleBlock] = [] {
        didSet {
            guard oldValue != scheduleBlocks, let snapshot = lastSnapshot, !isPreviewActive else { return }
            accept(snapshot)
        }
    }
    private var currentActivity: Activity<ScheduleLiveActivityAttributes>? {
        Activity<ScheduleLiveActivityAttributes>.activities.first {
            $0.activityState == .active || $0.activityState == .stale
        }
    }

    init(now: @escaping () -> Date = { .now }) {
        self.now = now
        if !isEnabled {
            status = .disabled
        } else if !ActivityAuthorizationInfo().areActivitiesEnabled {
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
        // Refresh channel metadata when the user enables local reservations.
        #if os(iOS)
        if #available(iOS 17.2, *) { LiveActivityPushService.shared.enabledDidChange(enabled) }
        #endif
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
        saveBroadcastCourses(from: snapshot)
        planDidChange?()
        refreshTask?.cancel()
        guard isEnabled else {
            status = .disabled
            end()
            return
        }
        status = currentActivity == nil ? .waiting : .active
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

    /// App suspension pauses the local boundary task. Reconcile immediately
    /// on return, including after the user changes Live Activity permission.
    func foreground() {
        if isPreviewActive {
            if (currentActivity?.content.state.endDate ?? .distantPast) <= now() {
                endPreview()
            }
        } else if let lastSnapshot {
            accept(lastSnapshot)
        }
    }

    /// A logged-out account must not recreate its last activity on resume.
    func reset() {
        lastSnapshot = nil
        UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?.removeObject(forKey: ScheduleLiveActivityAttributes.broadcastCoursesKey)
        resetPushService?()
        end()
        status = isEnabled ? .waiting : .disabled
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

        let start = now().addingTimeInterval(-20 * 60)
        let end = now().addingTimeInterval(55 * 60)
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
            guard isPreviewActive, isEnabled else { return }
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
        guard !Task.isCancelled, !isPreviewActive else { return nil }
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
        if remoteStartsEnabled {
            // Server owns starts. Never create a second local/scheduled activity
            // while a remote start may be in flight.
            let remainingWindows = remoteStartWindows()
            for activity in Activity<ScheduleLiveActivityAttributes>.activities {
                // School boundaries keep arriving after this student's last
                // course. Keep only windows with courses still remaining.
                var obsolete = !remainingWindows.contains {
                    $0.dateKey == activity.attributes.dateKey && $0.window == activity.attributes.broadcastWindow
                }
                if #available(iOS 26.0, *) { obsolete = obsolete || activity.activityState == .pending }
                if obsolete { await activity.end(nil, dismissalPolicy: .immediate) }
            }
            status = currentActivity == nil ? .waiting : .active
            return 60
        }
        if #available(iOS 26.0, *), broadcastWindows.contains(where: { $0.channelID != nil }) {
            return await synchronizeScheduled(snapshot)
        }
        let currentDate = now()
        guard let occurrence = nextOccurrence(in: snapshot, at: currentDate) else {
            status = .unavailable("今天和接下来没有可显示的课程。")
            await endActivities()
            return nil
        }

        // Keep the island quiet while the next class is still far away. The
        // refresh loop stays alive so it can start automatically as the class
        // enters the lead window.
        if !occurrence.isInProgress,
           occurrence.start.timeIntervalSince(currentDate) > leadTime {
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
        // The system should consider the activity stale as soon as this
        // occurrence ends. The controller wakes at the same boundary and
        // either advances to a nearby class or dismisses the activity.
        let content = ActivityContent(state: state, staleDate: occurrence.end)
        // ActivityKit's timestamp is an event ordering timestamp, NOT a
        // scheduled execution date. In particular, calling end with a future
        // timestamp ends the activity immediately. Only reconcile boundaries
        // that have actually passed; foreground() also does this on resume.

        if let activity = currentActivity,
           activity.attributes == attributes {
            await activity.update(content)
            guard !Task.isCancelled else { return nil }
            status = .active
            scheduleBackgroundWakeup?(occurrence.end)
            return refreshDelay(for: occurrence)
        }
        await endActivities()
        // A newer snapshot, logout or preview may take over across the await.
        guard !Task.isCancelled, isEnabled, !isPreviewActive else { return nil }
        do {
            _ = try Activity<ScheduleLiveActivityAttributes>.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
            status = .active
            scheduleBackgroundWakeup?(occurrence.end)
            return refreshDelay(for: occurrence)
        } catch {
            status = .failed(error.localizedDescription)
            // A background request or transient ActivityKit failure must not
            // permanently stop automatic activities until another fetch.
            return 30
        }
    }

    /// Wake at the next meaningful boundary instead of polling on a fixed
    /// cadence. This keeps a finished class from lingering on the lock screen
    /// while still starting the activity as the next class enters the lead
    /// window.
    private func refreshDelay(for occurrence: Occurrence) -> TimeInterval {
        let now = now()
        if occurrence.isInProgress {
            return max(1, min(15, occurrence.end.timeIntervalSince(now)))
        }

        let untilLeadWindow = occurrence.start.timeIntervalSince(now) - leadTime
        if untilLeadWindow > 0 {
            return max(5, min(60, untilLeadWindow))
        }
        return max(1, min(15, occurrence.start.timeIntervalSince(now)))
    }

    struct RemoteStartWindow: Codable, Equatable {
        let dateKey: String
        let window: String
        let start: Int
        let end: Int
    }

    /// One small record per day/block for the loaded semester, never course text.
    func remoteStartWindows() -> [RemoteStartWindow] {
        guard isEnabled, let snapshot = lastSnapshot, snapshot.auth.authenticated,
              ActivityAuthorizationInfo().areActivitiesEnabled, !scheduleBlocks.isEmpty else { return [] }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let current = now()
        let horizon = current.addingTimeInterval(370 * 86400)
        // Pick the first remaining course of each block. Server identities are
        // date/block, so reopening mid-session does not restart a sent activity.
        let events = allOccurrences(in: snapshot)
            .filter { $0.end > current && $0.start <= horizon }
            .compactMap { occurrence -> (block: ScheduleBlock, occurrence: Occurrence)? in
                guard let block = block(containing: occurrence.start, calendar: calendar) else { return nil }
                return (block, occurrence)
            }
        let grouped = Dictionary(grouping: events) { $0.occurrence.dateKey + ":" + $0.block.id }
        return grouped.values.compactMap { courses -> RemoteStartWindow? in
            guard let block = courses.first?.block,
                  let first = courses.map(\.occurrence).min(by: { $0.start < $1.start }) else { return nil }
            // The end is the school block end, which is what the server validates
            // the plan against and what the block channel will broadcast `end` at.
            guard let end = date(first.dateKey, time: block.endClock, calendar: calendar), end > current,
                  end.timeIntervalSince(first.start.addingTimeInterval(-leadTime)) < 8 * 3600 else { return nil }
            return RemoteStartWindow(dateKey: first.dateKey, window: block.id,
                                     start: Int(first.start.timeIntervalSince1970), end: Int(end.timeIntervalSince1970))
        }.sorted { $0.start < $1.start }
    }

    private func block(containing date: Date, calendar: Calendar) -> ScheduleBlock? {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        let seconds = (parts.hour ?? 0) * 3600 + (parts.minute ?? 0) * 60
        return scheduleBlocks.first { $0.startSeconds <= seconds && seconds < $0.endSeconds }
    }

    struct LocalReservation {
        let attributes: ScheduleLiveActivityAttributes
        let state: ScheduleLiveActivityAttributes.ContentState
        let start: Date
        let end: Date
        let channelID: String
    }

    /// Each lesson has a local alert and shares its school's date channel.
    /// A two-day horizon bounds reservations; ActivityKit can still reject them.
    func localReservations(from snapshot: NativeScheduleSnapshot) -> [LocalReservation] {
        guard isEnabled, snapshot.auth.authenticated else { return [] }
        let current = now()
        let events = allOccurrences(in: snapshot).filter { $0.end > current && $0.start < current.addingTimeInterval(2 * 86400) }
        return events.compactMap { course in
            guard let window = broadcastWindows.first(where: { $0.id == course.dateKey }),
                  let channel = window.channelID, !channel.isEmpty else { return nil }
            let reminder = course.start.addingTimeInterval(-leadTime)
            let start = max(reminder, current.addingTimeInterval(1))
            let attributes = ScheduleLiveActivityAttributes(
                semester: snapshot.data?.currentSemester ?? "", dateKey: course.dateKey,
                week: course.week, broadcastWindow: course.dateKey, broadcastChannel: channel,
                reservationStart: course.start, reservationEnd: course.end, reminderDate: reminder
            )
            let state = contentState(for: course, phase: course.start <= current ? .inProgress : .upcoming)
            return LocalReservation(attributes: attributes, state: state, start: start, end: course.end, channelID: channel)
        }.sorted { $0.start < $1.start }
    }

    @available(iOS 26.0, *)
    private func synchronizeScheduled(_ snapshot: NativeScheduleSnapshot) async -> TimeInterval? {
        let reservations = localReservations(from: snapshot)
        let desired = reservations.map(\.attributes)
        for activity in Activity<ScheduleLiveActivityAttributes>.activities {
            if !desired.contains(activity.attributes) {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
        guard !Task.isCancelled, isEnabled, !isPreviewActive else { return nil }
        for reservation in reservations {
            guard !Task.isCancelled, isEnabled, !isPreviewActive else { return nil }
            guard reservation.end.timeIntervalSince(reservation.start) < 8 * 3600 else {
                status = .failed("课程及提前提醒超过实时活动的 8 小时上限。")
                return nil
            }
            let existing = Activity<ScheduleLiveActivityAttributes>.activities.first {
                $0.attributes == reservation.attributes && $0.activityState != .ended && $0.activityState != .dismissed
            }
            if let existing {
                // Course details are always resolved from the fresh App Group
                // cache. Avoid recreating a pending reservation on every tick.
                if existing.activityState == .active || existing.activityState == .stale {
                    await existing.update(ActivityContent(state: reservation.state, staleDate: reservation.end))
                }
                continue
            }
            do {
                _ = try Activity<ScheduleLiveActivityAttributes>.request(
                    attributes: reservation.attributes,
                    content: ActivityContent(state: reservation.state, staleDate: reservation.end),
                    pushType: .channel(reservation.channelID), style: .standard,
                    alertConfiguration: AlertConfiguration(title: "课程提醒", body: LocalizedStringResource(stringLiteral: reservation.state.courseName), sound: .default),
                    start: reservation.start
                )
            } catch {
                status = .failed(error.localizedDescription)
                return 30
            }
        }
        status = currentActivity == nil ? .waiting : .active
        return 60
    }

    private func endActivities() async {
        for activity in Activity<ScheduleLiveActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    func reconcileInBackground() async {
        let current = now()
        for activity in Activity<ScheduleLiveActivityAttributes>.activities {
            if (activity.content.staleDate ?? activity.content.state.endDate) <= current {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
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
            adjustmentNote: occurrence.adjustmentNote.trimmedNonEmpty,
            updatedAt: phase == .inProgress ? occurrence.start : now()
        )
    }

    private func saveBroadcastCourses(from snapshot: NativeScheduleSnapshot) {
        let records = (snapshot.auth.authenticated ? allOccurrences(in: snapshot) : []).filter { $0.end > now() && $0.start <= now().addingTimeInterval(370 * 86400) }.compactMap { occurrence -> ScheduleLiveActivityAttributes.LocalCourse? in
            let period = occurrence.periodLabel.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }.first ?? 0
            guard period > 0 else { return nil }
            return ScheduleLiveActivityAttributes.LocalCourse(
                dateKey: occurrence.dateKey,
                period: period,
                name: occurrence.name,
                teacher: occurrence.teacher,
                location: occurrence.location,
                periodLabel: occurrence.periodLabel,
                startDate: occurrence.start,
                endDate: occurrence.end,
                weekRangeLabel: occurrence.weekRangeLabel,
                adjustmentNote: occurrence.adjustmentNote.trimmedNonEmpty
            )
        }
        guard let data = try? JSONEncoder().encode(Array(records)) else { return }
        UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?.set(data, forKey: ScheduleLiveActivityAttributes.broadcastCoursesKey)
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
        /// 这一天的调休说明。补课那天要说清楚上的是哪天的课，否则锁屏上是
        /// 一节看起来不该存在的课。
        let adjustmentNote: String
    }

    /// 调休：放假那天没有课要提醒，补课那天提醒的是另一天的课，被调走的那天
    /// 也不再上课。返回 nil 表示这天一节课都没有。
    ///
    /// 和 `NativeScheduleView.blocks(for:week:result:)` 的规则保持一致，否则
    /// 网格里和锁屏上会是两张课表。
    private static func resolvedDay(
        date: String,
        day: Int,
        week: Int,
        calendar: NativeScheduleCalendar
    ) -> (day: Int, week: Int, note: String)? {
        if let adjustment = calendar.adjustments.first(where: { $0.date == date }) {
            let note = adjustment.note?.trimmedNonEmpty
            if adjustment.kind == "off" { return nil }
            if adjustment.kind == "swap" {
                guard let source = adjustment.source,
                      let sourceWeek = calendar.weeks.first(where: { $0.days.contains(source) }),
                      let index = sourceWeek.days.firstIndex(of: source) else { return nil }
                return (index + 1, sourceWeek.week, note ?? "上 \(Self.shortDate(source)) \(Self.weekdayName(source))的课")
            }
            return (day, week, note ?? "")
        }
        // 这天的课被调到别处去了，本身就不再上课。
        if calendar.adjustments.contains(where: { $0.kind == "swap" && $0.source == date }) { return nil }
        return (day, week, "")
    }

    private static func shortDate(_ value: String) -> String {
        let pieces = value.split(separator: "-")
        guard pieces.count >= 3 else { return value }
        return "\(pieces[pieces.count - 2]).\(pieces[pieces.count - 1])"
    }

    private static func weekdayName(_ value: String) -> String {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return "" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        guard let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return "" }
        let labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
        let index = calendar.component(.weekday, from: date) - 1
        return labels.indices.contains(index) ? labels[index] : ""
    }

    private func allOccurrences(in snapshot: NativeScheduleSnapshot) -> [Occurrence] {
        guard let data = snapshot.data, let calendar = snapshot.calendar else { return [] }
        var dateCalendar = Calendar(identifier: .gregorian)
        dateCalendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let periods = snapshot.periods.isEmpty ? NativeSchedulePeriod.bundledTimetable : snapshot.periods
        let periodByNumber = Dictionary(uniqueKeysWithValues: periods.map { ($0.number, $0) })
        return calendar.weeks.flatMap { week -> [Occurrence] in
            week.days.enumerated().flatMap { dayIndex, day -> [Occurrence] in
                guard let resolved = Self.resolvedDay(
                    date: day, day: dayIndex + 1, week: week.week, calendar: calendar) else { return [] }
                return data.cells.filter { $0.day == resolved.day }.flatMap { cell in
                    cell.courses.compactMap { course -> Occurrence? in
                        guard course.weekList.isEmpty || course.weekList.contains(resolved.week) else { return nil }
                        let range = NativeSchedulePeriod.normalizedRange(bigSlot: cell.bigSlot, startSlot: course.startSlot, endSlot: course.endSlot, periods: periods)
                        guard let startPeriod = periodByNumber[range.start], let endPeriod = periodByNumber[range.end],
                              let start = date(day, time: startPeriod.startTime, calendar: dateCalendar),
                              let end = date(day, time: endPeriod.endTime, calendar: dateCalendar), end > start else { return nil }
                        return Occurrence(
                            name: course.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "课程" : course.name,
                            teacher: course.teacher?.trimmedNonEmpty ?? "", location: course.location?.trimmedNonEmpty ?? "",
                            periodLabel: Self.periodLabel(start: range.start, end: range.end), dateLabel: Self.dateLabel(day: day, week: week.week),
                            start: start, end: end, dateKey: day, week: week.week, isInProgress: false, next: nil,
                            weekRangeLabel: course.weeks.trimmedNonEmpty ?? "", adjustmentNote: resolved.note)
                    }
                }
            }
        }.sorted { ($0.start, $0.end, $0.name) < ($1.start, $1.end, $1.name) }
    }

    private func nextOccurrence(in snapshot: NativeScheduleSnapshot, at now: Date) -> Occurrence? {
        guard let data = snapshot.data, let calendar = snapshot.calendar else { return nil }
        var dateCalendar = Calendar(identifier: .gregorian)
        dateCalendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let periods = snapshot.periods.isEmpty ? NativeSchedulePeriod.bundledTimetable : snapshot.periods
        let periodByNumber = Dictionary(uniqueKeysWithValues: periods.map { ($0.number, $0) })
        // The timetable payload can contain the whole semester while the
        // visible grid is only one week. Build occurrences for every dated
        // week so a no-class day still gets the next scheduled course.
        let events = calendar.weeks.flatMap { week -> [Occurrence] in
            week.days.enumerated().flatMap { dayIndex, day -> [Occurrence] in
                guard let resolved = Self.resolvedDay(
                    date: day, day: dayIndex + 1, week: week.week, calendar: calendar) else { return [] }
                return data.cells
                    .filter { $0.day == resolved.day }
                    .flatMap { cell in
                        cell.courses.compactMap { course -> Occurrence? in
                            guard course.weekList.isEmpty || course.weekList.contains(resolved.week) else { return nil }
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
                                weekRangeLabel: course.weeks.trimmedNonEmpty ?? "",
                                adjustmentNote: resolved.note
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
                weekRangeLabel: current.weekRangeLabel,
                adjustmentNote: current.adjustmentNote
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
            weekRangeLabel: upcoming.weekRangeLabel,
            adjustmentNote: upcoming.adjustmentNote
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
        let dayLabel = weekday.flatMap { labels.indices.contains($0 - 1) ? labels[$0 - 1] : nil }
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
