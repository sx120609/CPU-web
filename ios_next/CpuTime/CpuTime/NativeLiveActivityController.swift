import ActivityKit
import Combine
import Foundation

@available(iOS 17.0, *)
@MainActor
final class NativeLiveActivityController: ObservableObject {
    typealias Attributes = ScheduleLiveActivityAttributes
    typealias State = Attributes.ContentState
    enum Status: Equatable {
        case disabled, waiting, active, unavailable(String), failed(String)
        var title: String {
            switch self {
            case .disabled: return "已关闭"
            case .waiting: return "等待下一节课"
            case .active: return "实时活动已显示"
            case .unavailable: return "暂时没有可显示的课程"
            case .failed: return "安排未完成"
            }
        }
        var detail: String? {
            switch self { case .unavailable(let s), .failed(let s): return s; default: return nil }
        }
    }
    static let shared = NativeLiveActivityController()
    static let enabledKey = "scheduleLiveActivityEnabled"
    static let leadMinutesKey = "scheduleLiveActivityLeadMinutes"
    private var defaults: UserDefaults { UserDefaults(suiteName: NextWidgetConfiguration.appGroup)! }
    static func normalizedLead(_ value: Int?) -> Int {
        guard let value, (0...60).contains(value) else { return 15 }
        return value <= 15 ? 15 : value <= 30 ? 30 : 60
    }
    var leadMinutes: Int { Self.normalizedLead(defaults.object(forKey: Self.leadMinutesKey) as? Int) }
    var leadTime: TimeInterval { TimeInterval(leadMinutes * 60) }
    var timingMode: Attributes.TimingMode { Attributes.TimingMode(rawValue: defaults.string(forKey: "cpu.liveActivity.mode") ?? "whole") ?? .whole }
    func setLeadMinutes(_ value: Int) { defaults.set(Self.normalizedLead(value), forKey: Self.leadMinutesKey); reconfigure() }
    func setTimingMode(_ value: Attributes.TimingMode) { defaults.set(value.rawValue, forKey: "cpu.liveActivity.mode"); reconfigure() }
    var isEnabled: Bool { defaults.object(forKey: Self.enabledKey) as? Bool ?? true }
    @Published private(set) var status: Status = .waiting
    @Published private(set) var isPreviewActive = false
    @Published var broadcastStatus = "等待学校作息及频道。"
    @Published private(set) var coverageStatus = "等待加载课表"
    @Published private(set) var conflicts: [Conflict] = []
    var remoteStartsEnabled = false
    var localHandoffComplete = false
    var recoverRemote: ((String) async throws -> String?)?
    var planDidChange: (() -> Void)?
    var resetPushService: (() -> Void)?
    var scheduleBackgroundWakeup: ((Date) -> Void)?
    private var refreshTask: Task<Void, Never>?
    private var previewEndTask: Task<Void, Never>?
    private var lastSnapshot: NativeScheduleSnapshot?
    var currentScheduleMetadata: NativeScheduleSnapshot? { lastSnapshot }
    private let now: () -> Date
    private var generation = 0
    private var session = UUID().uuidString
    private var foregroundRecovery = true
    private var reconciling = false
    private var occurrences: [Occurrence] = []
    private var ledger: [String: LedgerEntry] = [:]
    private var identityRecords: [String: [IdentityRecord]] = [:]
    private var choices: [String: String] = [:]
    private var loadedAccount: String?
    private var committedRemote = Set<String>()
    func installHandoffRecords(_ records: [[String: Any]]) {
        committedRemote = Set(records.compactMap { $0["occurrenceId"] as? String })
        for row in records where row["state"] as? String == "terminal" {
            if let id = row["occurrenceId"] as? String, let c = occurrences.first(where: { $0.id == id }) { record(c, state: "terminal") }
        }
    }
    struct BusyInterval: Codable { let startAt: Double; let endAt: Double }
    private(set) var busyIntervals: [BusyInterval] = []
    private var unsupported: [String] = []
    private var failures: [String: String] = [:]
    struct BroadcastWindow: Codable, Equatable { let id: String; let startHour: Int; let endHour: Int; let channelID: String? }
    var broadcastWindows: [BroadcastWindow] = []
    struct TimingConfig: Codable, Equatable {
        struct Period: Codable, Equatable { let id: Int; let name: String; let start: String; let end: String }
        let protocolVersion: Int
        let scheduleId: String
        let scheduleVersion: String
        let timezone: String
        let periods: [Period]
        let issuedAt: Double
        let usableUntil: Double
        let broadcastUntil: Double
        let windows: [BroadcastWindow]
    }
    private(set) var timing: TimingConfig?
    func installTiming(_ value: TimingConfig) {
        guard value.protocolVersion == 2, TimeZone(identifier: value.timezone) != nil else { return }
        timing = value
        broadcastWindows = value.windows
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: "cpu.liveActivity.timing.v2") }
        reconfigure()
    }
    struct LedgerEntry: Codable {
        var state: String
        var activityID: String?
        var generation: Int
        var plannedStart: Date
        var session: String
        var cancellation: String?
        var signature: String
    }
    struct IdentityRecord: Codable { var id: String; var periods: [Int]; var supersedes: [String] }
    struct Conflict: Identifiable {
        struct Option: Identifiable { let id: String; let name: String }
        let id: String
        let dateKey: String
        let period: Int
        let options: [Option]
        let selectedSource: String?
    }
    func selectCourse(_ source: String, for conflict: Conflict) {
        choices[conflict.id] = source
        persist()
        reconfigure()
    }
    struct Occurrence {
        let id: String
        let supersedes: [String]
        let name: String
        let teacher: String
        let location: String
        let periodLabel: String
        let dateKey: String
        let week: Int
        let weekRangeLabel: String
        let adjustmentNote: String
        let segments: [Attributes.Segment]
        var plannedStart: Date
        var start: Date { segments.first!.startAt }
        var end: Date { segments.last!.endAt }
        var endPeriod: Int { segments.last!.period }
        var signature: String { segments.map { "\($0.period):\($0.startAt.timeIntervalSince1970):\($0.endAt.timeIntervalSince1970)" }.joined(separator: ",") }
    }
    private var currentActivity: Activity<Attributes>? { Activity<Attributes>.activities.first { $0.activityState == .active || $0.activityState == .stale } }
    init(now: @escaping () -> Date = { .now }) {
        self.now = now
        if let data = defaults.data(forKey: "cpu.liveActivity.timing.v2") { timing = try? JSONDecoder().decode(TimingConfig.self, from: data); broadcastWindows = timing?.windows ?? [] }
        if !isEnabled { status = .disabled }
    }
    private func persist() {
        guard let loadedAccount else { return }
        for (key, data) in [("ledger", try? JSONEncoder().encode(ledger)), ("identities", try? JSONEncoder().encode(identityRecords)), ("choices", try? JSONEncoder().encode(choices))] {
            if let data { defaults.set(data, forKey: "cpu.liveActivity.v2.\(loadedAccount).\(key)") }
        }
    }
    private func loadAccount(_ account: String) {
        guard loadedAccount != account else { return }
        localHandoffComplete = false
        loadedAccount = account
        ledger = defaults.data(forKey: "cpu.liveActivity.v2.\(account).ledger").flatMap { try? JSONDecoder().decode([String: LedgerEntry].self, from: $0) } ?? [:]
        identityRecords = defaults.data(forKey: "cpu.liveActivity.v2.\(account).identities").flatMap { try? JSONDecoder().decode([String: [IdentityRecord]].self, from: $0) } ?? [:]
        choices = defaults.data(forKey: "cpu.liveActivity.v2.\(account).choices").flatMap { try? JSONDecoder().decode([String: String].self, from: $0) } ?? [:]
        defaults.set(account, forKey: "cpu.liveActivity.account")
    }
    func setEnabled(_ value: Bool) {
        defaults.set(value, forKey: Self.enabledKey)
        generation += 1
        if value { session = UUID().uuidString; foregroundRecovery = true; reconfigure() }
        else { end(); status = .disabled }
        #if os(iOS)
        if #available(iOS 17.2, *) { LiveActivityPushService.shared.enabledDidChange(value) }
        #endif
    }
    private func reconfigure() { if let lastSnapshot { accept(lastSnapshot) }; objectWillChange.send() }
    func accept(_ snapshot: NativeScheduleSnapshot) {
        lastSnapshot = snapshot
        generation += 1
        guard !isPreviewActive else { return }
        if let account = snapshot.auth.account, snapshot.auth.authenticated {
            loadAccount(account)
            occurrences = expand(snapshot)
            saveBroadcastCourses()
        } else { occurrences = []; conflicts = [] }
        planDidChange?()
        startLoop()
    }
    private func startLoop() {
        refreshTask?.cancel()
        let epoch = generation
        refreshTask = Task { @MainActor [weak self] in
            guard let self else { return }
            while !Task.isCancelled, epoch == generation {
                if !reconciling {
                    reconciling = true
                    await reconcile(epoch)
                    reconciling = false
                }
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
    }
    func foreground() {
        session = UUID().uuidString
        foregroundRecovery = true
        if isPreviewActive { if (currentActivity?.content.state.endDate ?? .distantPast) <= now() { endPreview() }; return }
        reconfigure()
    }
    func reset() {
        generation += 1
        end()
        resetPushService?()
        lastSnapshot = nil
        occurrences = []
        loadedAccount = nil
        ledger = [:]
        defaults.removeObject(forKey: Attributes.broadcastCoursesKey)
        defaults.removeObject(forKey: "cpu.liveActivity.account")
        localHandoffComplete = false
    }
    func end() {
        generation += 1
        refreshTask?.cancel(); refreshTask = nil
        previewEndTask?.cancel(); previewEndTask = nil
        isPreviewActive = false
        let activities = Activity<Attributes>.activities
        for a in activities { mark(a.attributes.occurrenceId, state: "missing", reason: "disabled") }
        Task { for a in activities { await a.end(nil, dismissalPolicy: .immediate) } }
    }
    private func endActivities() async { for a in Activity<Attributes>.activities { await a.end(nil, dismissalPolicy: .immediate) } }
    func reconcileInBackground() async {
        for a in Activity<Attributes>.activities where !isEnabled || (a.attributes.reservationEnd ?? a.content.state.endDate) <= now() {
            await a.end(nil, dismissalPolicy: .immediate)
        }
    }
    private func valid(_ epoch: Int) -> Bool { epoch == generation && isEnabled && !isPreviewActive && lastSnapshot?.auth.authenticated == true && !Task.isCancelled }
    private func mark(_ id: String?, state: String, reason: String? = nil) {
        guard let id, var entry = ledger[id] else { return }
        entry.state = state; entry.cancellation = reason; entry.session = session
        ledger[id] = entry; persist()
    }
    private func record(_ c: Occurrence, state: String, activityID: String? = nil) {
        ledger[c.id] = LedgerEntry(state: state, activityID: activityID, generation: generation,
            plannedStart: c.plannedStart, session: session, signature: c.signature + (timing?.scheduleVersion ?? ""))
        persist()
    }
    private func state(_ c: Occurrence) -> State {
        let timeline = Attributes.resolveTimeline(c.segments, mode: timingMode, now: now())!
        let phase: State.Phase = timeline.phase == .finished ? .idle : timeline.phase == .upcoming ? .upcoming : timeline.phase == .intermission ? .intermission : .inProgress
        return State(phase: phase, courseName: c.name, teacher: c.teacher, location: c.location, periodLabel: c.periodLabel,
            dateLabel: Self.dateLabel(day: c.dateKey, week: c.week), weekRangeLabel: c.weekRangeLabel,
            startDate: phase == .inProgress ? timeline.start : timeline.target, endDate: timeline.target,
            adjustmentNote: c.adjustmentNote, updatedAt: now())
    }
    private func attributes(_ c: Occurrence, channel: String?) -> Attributes {
        var a = Attributes(semester: lastSnapshot?.data?.currentSemester ?? "", dateKey: c.dateKey, week: c.week,
            broadcastWindow: String(c.endPeriod), broadcastChannel: channel, reservationStart: c.start, reservationEnd: c.end, reminderDate: c.plannedStart)
        a.occurrenceId = c.id; a.accountScope = loadedAccount; a.scheduleId = timing?.scheduleId; a.scheduleVersion = timing?.scheduleVersion
        return a
    }
    private func channel(_ c: Occurrence) -> String? {
        guard let timing, c.start.timeIntervalSince1970 < timing.usableUntil, c.end.timeIntervalSince1970 <= timing.broadcastUntil else { return nil }
        return timing.windows.first { $0.id == String(c.endPeriod) }?.channelID
    }
    private func reconcile(_ epoch: Int) async {
        guard valid(epoch), ActivityAuthorizationInfo().areActivitiesEnabled else {
            await endActivities(); status = isEnabled ? .unavailable("请登录并允许实时活动。") : .disabled; return
        }
        let current = now()
        var seen = Set<String>()
        for a in Activity<Attributes>.activities {
            guard valid(epoch) else { return }
            guard a.activityState != .ended && a.activityState != .dismissed else {
                if let id = a.attributes.occurrenceId, ledger[id]?.activityID == a.id, ledger[id]?.cancellation == nil {
                    let next = (a.attributes.reservationEnd ?? current) <= current ? "terminal" : a.activityState == .dismissed ? "dismissed" : "missing"
                    if ledger[id]?.state != next {
                        if ledger[id]?.session != session {
                            ledger[id]?.state = next; persist()
                        } else { mark(id, state: next) }
                    }
                }
                continue
            }
            let id = a.attributes.occurrenceId ?? ""
            let c = occurrences.first { $0.id == id }
            let active = a.activityState == .active || a.activityState == .stale
            let changed = c.map { a.attributes.reservationStart != $0.start || a.attributes.reservationEnd != $0.end || a.attributes.scheduleVersion != timing?.scheduleVersion || ledger[id]?.signature != nil && ledger[id]?.signature != $0.signature + (timing?.scheduleVersion ?? "") } ?? true
            if active, ledger[id] == nil {
                if let c { record(c, state: "active", activityID: a.id) }
                else if !id.isEmpty {
                    ledger[id] = LedgerEntry(state: "active", activityID: a.id, generation: generation, plannedStart: a.attributes.reminderDate ?? current, session: session, signature: "")
                    persist()
                }
            }
            if a.attributes.accountScope != loadedAccount || c == nil || c!.end <= current || ledger[id]?.state == "terminal" || active && changed {
                if active {
                    if let c, ledger[id] == nil { record(c, state: "active", activityID: a.id) }
                    mark(id, state: "terminal", reason: "courseChanged")
                }
                else { mark(id, state: "missing", reason: "reconfigure") }
                await a.end(nil, dismissalPolicy: .immediate)
                continue
            }
            guard let c else { continue }
            if seen.contains(id) { await a.end(nil, dismissalPolicy: .immediate); continue }
            if !active && (changed || a.attributes.reminderDate != c.plannedStart || a.attributes.broadcastChannel != channel(c)) {
                mark(id, state: "missing", reason: "reconfigure")
                // State is rechecked immediately before cancelling a reservation.
                if a.activityState == .active || a.activityState == .stale { continue }
                await a.end(nil, dismissalPolicy: .immediate)
                continue
            }
            seen.insert(id)
            record(c, state: active ? "active" : "pending", activityID: a.id)
            if active { await a.update(ActivityContent(state: state(c), staleDate: c.end)) }
        }
        guard valid(epoch) else { return }
        for c in occurrences where c.end <= current {
            if ledger[c.id] != nil { mark(c.id, state: "terminal", reason: "finished") }
        }
        let targets = occurrences.filter { $0.end > current && $0.start < current.addingTimeInterval(7 * 86400) }
        failures = [:]
        var arranged = 0
        for c in targets {
            guard valid(epoch) else { return }
            if seen.contains(c.id) { arranged += 1; continue }
            if ledger[c.id]?.state == "terminal" || c.supersedes.contains(where: { committedRemote.contains($0) || ["terminal", "active"].contains(ledger[$0]?.state ?? "") }) { record(c, state: "terminal"); failures[c.id] = "本次课程变更后已终止"; continue }
            if let entry = ledger[c.id], ["active", "pending", "requesting"].contains(entry.state), entry.cancellation == nil, c.plannedStart <= current {
                // System absence is not proof of dismissal. Suppress within this
                // session; a new foreground session is allowed to recover.
                if entry.session == session { mark(c.id, state: "missing") }
            }
            if let entry = ledger[c.id], ["dismissed", "missing"].contains(entry.state), entry.session == session, entry.cancellation == nil {
                failures[c.id] = "下次打开 App 时恢复"; continue
            }
            guard c.end.timeIntervalSince(c.plannedStart) < 8 * 3600, c.plannedStart < c.end else { failures[c.id] = "课程及提醒达到 8 小时上限"; continue }
            if committedRemote.contains(c.id), c.plannedStart > current { failures[c.id] = "已有远程提交记录，等待核对"; continue }
            var channelID = channel(c)
            var scheduled = false
            if #available(iOS 26.0, *) {
                guard localHandoffComplete else { failures[c.id] = "等待完成启动方式切换"; continue }
                guard channelID != nil else { failures[c.id] = "频道缺失或映射已过期"; continue }
                scheduled = true
            } else if remoteStartsEnabled {
                guard c.plannedStart <= current else { continue }
                guard foregroundRecovery, let recoverRemote else { continue }
                do { channelID = try await recoverRemote(c.id) }
                catch { failures[c.id] = "等待联网协调前台恢复"; continue }
                guard valid(epoch) else { return }
                guard channelID != nil else { failures[c.id] = "结束频道未就绪"; continue }
            } else {
                guard c.plannedStart <= current else { continue }
                if #available(iOS 18.0, *) { failures[c.id] = "等待启动配置"; continue }
            }
            guard c.end > now().addingTimeInterval(scheduled ? 1 : 0) else { continue }
            do {
                try request(c, channel: channelID, scheduled: scheduled)
                arranged += 1
            } catch {
                failures[c.id] = error.localizedDescription
                mark(c.id, state: "retryableFailure")
                if isCapacityError(error), #available(iOS 26.0, *) {
                    // Replace at most one strictly later pending reservation.
                    let candidates = Activity<Attributes>.activities.filter { a in
                        a.activityState == .pending && a.attributes.accountScope == loadedAccount && (a.attributes.reminderDate ?? .distantPast) > c.plannedStart
                    }.sorted { ($0.attributes.reminderDate ?? .distantPast) > ($1.attributes.reminderDate ?? .distantPast) }
                    guard let victim = candidates.first, let old = occurrences.first(where: { $0.id == victim.attributes.occurrenceId }) else { break }
                    mark(old.id, state: "missing", reason: "capacityRebalance")
                    guard valid(epoch), victim.activityState == .pending else { break }
                    await victim.end(nil, dismissalPolicy: .immediate)
                    guard valid(epoch) else { return }
                    failures[old.id] = "名额优先用于近期课程"
                    do { try request(c, channel: channelID, scheduled: true); arranged += 1; failures[c.id] = nil }
                    catch {
                        failures[c.id] = error.localizedDescription
                        mark(c.id, state: "retryableFailure")
                        if !isCapacityError(error) {
                            do { try request(old, channel: channel(old), scheduled: true) }
                            catch { mark(old.id, state: "retryableFailure", reason: "capacityRebalance") }
                        }
                        break
                    }
                }
            }
        }
        guard valid(epoch) else { return }
        let successful = Set(Activity<Attributes>.activities.filter { $0.activityState != .ended && $0.activityState != .dismissed && $0.attributes.accountScope == loadedAccount }.compactMap { $0.attributes.occurrenceId })
        arranged = targets.filter { successful.contains($0.id) }.count
        coverageStatus = "未来 7 天共 \(targets.count + unsupported.count) 次，已安排 \(arranged) 次"
        if let first = unsupported.first { coverageStatus += "；\(first)" }
        if let missing = targets.first(where: { !successful.contains($0.id) }) { coverageStatus += "；\(missing.dateKey) \(missing.name)：\(failures[missing.id] ?? "等待安排")" }
        let unresolvedCount = conflicts.filter { $0.selectedSource == nil }.count
        if unresolvedCount > 0 { coverageStatus += "；\(unresolvedCount) 个节次冲突待选择" }
        status = currentActivity == nil ? .waiting : .active
    }
    private func isCapacityError(_ error: Error) -> Bool {
        // ActivityKit exposes a named error, never infer quota from arbitrary text.
        #if os(iOS)
        guard let error = error as? ActivityAuthorizationError else { return false }
        return error == .globalMaximumExceeded || error == .targetMaximumExceeded
        #else
        return (error as NSError).domain == "ActivityKit.capacity"
        #endif
    }
    private func request(_ c: Occurrence, channel: String?, scheduled: Bool) throws {
        record(c, state: "requesting")
        let content = ActivityContent(state: state(c), staleDate: c.end)
        let activity: Activity<Attributes>
        if #available(iOS 26.0, *), scheduled, let channel {
            activity = try Activity.request(attributes: attributes(c, channel: channel), content: content,
                pushType: .channel(channel), style: .standard,
                alertConfiguration: AlertConfiguration(title: "课程提醒", body: LocalizedStringResource(stringLiteral: c.name), sound: .default),
                start: max(c.plannedStart, now().addingTimeInterval(1)))
        } else if #available(iOS 18.0, *), let channel {
            activity = try Activity.request(attributes: attributes(c, channel: channel), content: content, pushType: .channel(channel))
        } else { activity = try Activity.request(attributes: attributes(c, channel: nil), content: content, pushType: nil) }
        record(c, state: scheduled ? "pending" : "active", activityID: activity.id)
    }
    struct RemoteStartWindow: Codable, Equatable {
        let occurrenceId: String; let supersedes: [String]; let dateKey: String; let startPeriod: Int; let endPeriod: Int
    }
    func remoteStartWindows() -> [RemoteStartWindow] {
        guard isEnabled, ActivityAuthorizationInfo().areActivitiesEnabled else { return [] }
        return occurrences.filter { $0.end > now() && $0.start < now().addingTimeInterval(370 * 86400) }.map {
            RemoteStartWindow(occurrenceId: $0.id, supersedes: $0.supersedes, dateKey: $0.dateKey, startPeriod: $0.segments[0].period, endPeriod: $0.endPeriod)
        }
    }
    private func saveBroadcastCourses() {
        let existing = defaults.data(forKey: Attributes.broadcastCoursesKey).flatMap { try? JSONDecoder().decode([Attributes.LocalCourse].self, from: $0) } ?? []
        let referenced = Set(Activity<Attributes>.activities.compactMap { $0.attributes.occurrenceId })
        var records = existing.filter { record in record.accountScope == loadedAccount && referenced.contains(record.occurrenceId ?? "") && !occurrences.contains(where: { c in c.id == record.occurrenceId }) }
        records += occurrences.map { c in
            var r = Attributes.LocalCourse(dateKey: c.dateKey, period: c.segments[0].period, name: c.name, teacher: c.teacher, location: c.location,
                periodLabel: c.periodLabel, startDate: c.start, endDate: c.end, weekRangeLabel: c.weekRangeLabel, adjustmentNote: c.adjustmentNote)
            r.occurrenceId = c.id; r.accountScope = loadedAccount; r.segments = c.segments; r.mode = timingMode; r.contentVersion = c.signature
            return r
        }
        if let data = try? JSONEncoder().encode(records) { defaults.set(data, forKey: Attributes.broadcastCoursesKey) }
    }
    private func expand(_ snapshot: NativeScheduleSnapshot) -> [Occurrence] {
        guard let data = snapshot.data, let calendar = snapshot.calendar else { return [] }
        var dateCalendar = Calendar(identifier: .gregorian)
        dateCalendar.timeZone = TimeZone(identifier: timing?.timezone ?? "Asia/Shanghai")!
        let periods = timing?.periods.map { NativeSchedulePeriod(number: $0.id, startTime: $0.start, endTime: $0.end) } ?? snapshot.periods
        guard !periods.isEmpty else { coverageStatus = "缺少学校作息表"; return [] }
        let byNumber = Dictionary(uniqueKeysWithValues: periods.map { ($0.number, $0) })
        var result: [Occurrence] = []
        unsupported = []
        busyIntervals = []
        var unresolved: [Conflict] = []
        for week in calendar.weeks {
            for (dayIndex, day) in week.days.enumerated() {
                guard let resolved = Self.resolvedDay(date: day, day: dayIndex + 1, week: week.week, calendar: calendar) else { continue }
                var candidates: [Int: [String: NativeScheduleCourse]] = [:]
                for cell in data.cells where cell.day == resolved.day {
                    for course in cell.courses where course.weekList.isEmpty || course.weekList.contains(resolved.week) {
                        if course.customStartTime != nil || course.customEndTime != nil {
                            if let startClock = course.customStartTime, let endClock = course.customEndTime,
                               let start = date(day, time: startClock, calendar: dateCalendar), let end = date(day, time: endClock, calendar: dateCalendar), start < end {
                                busyIntervals.append(BusyInterval(startAt: start.timeIntervalSince1970, endAt: end.timeIntervalSince1970))
                                if end > now(), start < now().addingTimeInterval(7 * 86400) { unsupported.append("\(day) \(course.name)：自定义时间暂不支持自动活动") }
                            } else { unsupported.append("\(day) \(course.name)：自定义时间无效") }
                            continue
                        }
                        let source = course.nativeId ?? course.sourceKey ?? course.customId.map { "custom:\($0)" } ?? course.id
                        if let start = course.startSlot, let end = course.endSlot,
                           (byNumber[start] == nil || byNumber[end] == nil || start > end) {
                            if let midnight = date(day, time: "00:00", calendar: dateCalendar),
                               midnight.addingTimeInterval(86400) > now(), midnight < now().addingTimeInterval(7 * 86400) {
                                unsupported.append("\(day) \(course.name)：自定义时间或节次无法对应学校作息")
                            }
                            continue
                        }
                        let range = NativeSchedulePeriod.normalizedRange(bigSlot: cell.bigSlot, startSlot: course.startSlot, endSlot: course.endSlot, periods: periods)
                        guard range.start <= range.end else { continue }
                        for period in range.start...range.end { candidates[period, default: [:]][source] = course }
                    }
                }
                var selected: [(Int, String, NativeScheduleCourse)] = []
                var blocked = Set<String>()
                for period in candidates.keys.sorted() {
                    let options = candidates[period]!
                    let key = "\(data.currentSemester):\(day):\(period)"
                    let chosen = options.count == 1 ? options.keys.first : choices[key].flatMap { options[$0] != nil ? $0 : nil }
                    if options.count > 1 {
                        unresolved.append(Conflict(id: key, dateKey: day, period: period,
                            options: options.keys.sorted().map { Conflict.Option(id: $0, name: options[$0]!.name) }, selectedSource: chosen))
                    }
                    if let chosen, let course = options[chosen] { selected.append((period, chosen, course)) }
                    else { blocked.formUnion(options.keys) }
                }
                selected.removeAll { blocked.contains($0.1) }
                var runs: [[(Int, String, NativeScheduleCourse)]] = []
                for item in selected {
                    if let previous = runs.last?.last, previous.1 == item.1, previous.0 + 1 == item.0 { runs[runs.count - 1].append(item) }
                    else { runs.append([item]) }
                }
                let grouped = Dictionary(grouping: runs, by: { $0[0].1 })
                for (source, sourceRuns) in grouped {
                    let key = "\(data.currentSemester):\(day):\(source)"
                    let old = identityRecords[key] ?? []
                    let unchanged = old.count == sourceRuns.count
                    var records: [IdentityRecord] = []
                    for (index, run) in sourceRuns.enumerated() {
                        let numbers = run.map { $0.0 }
                        // A boundary edit keeps identity; a split/merge records all
                        // replaced identities, preventing already-started fragments from restarting.
                        let record: IdentityRecord
                        if unchanged { record = IdentityRecord(id: old[index].id, periods: numbers, supersedes: old[index].supersedes) }
                        else { record = IdentityRecord(id: UUID().uuidString, periods: numbers, supersedes: old.map(\.id)) }
                        records.append(record)
                        let segments = numbers.compactMap { p -> Attributes.Segment? in
                            guard let period = byNumber[p], let start = date(day, time: period.startTime, calendar: dateCalendar), let end = date(day, time: period.endTime, calendar: dateCalendar) else { return nil }
                            return Attributes.Segment(period: p, startAt: start, endAt: end)
                        }
                        guard segments.count == numbers.count, let first = segments.first else { continue }
                        let course = run[0].2
                        result.append(Occurrence(id: record.id, supersedes: record.supersedes, name: course.name, teacher: course.teacher ?? "", location: course.location ?? "",
                            periodLabel: Self.periodLabel(start: numbers[0], end: numbers.last!), dateKey: day, week: week.week,
                            weekRangeLabel: course.weeks, adjustmentNote: resolved.note, segments: segments, plannedStart: first.startAt.addingTimeInterval(-leadTime)))
                    }
                    identityRecords[key] = records
                }
            }
        }
        result.sort { ($0.start, $0.id) < ($1.start, $1.id) }
        var previousEnd = Date.distantPast
        for index in result.indices {
            let busyEnd = busyIntervals.filter { $0.startAt < result[index].start.timeIntervalSince1970 }.map { Date(timeIntervalSince1970: $0.endAt) }.max() ?? .distantPast
            result[index].plannedStart = max(result[index].plannedStart, previousEnd, busyEnd)
            previousEnd = max(previousEnd, result[index].end)
        }
        var protectedIDs = Set(ledger.filter { $0.value.state == "terminal" || $0.value.state == "active" }.map(\.key)).union(committedRemote)
        var changed = true
        while changed {
            changed = false
            for records in identityRecords.values {
                for record in records where record.supersedes.contains(where: { protectedIDs.contains($0) }) {
                    if protectedIDs.insert(record.id).inserted { changed = true }
                }
            }
        }
        for c in result where protectedIDs.contains(c.id) && !committedRemote.contains(c.id) && ledger[c.id] == nil { record(c, state: "terminal") }
        conflicts = unresolved
        persist()
        return result
    }
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
        guard parts.count == 2, (0...23).contains(parts[0]), (0...59).contains(parts[1]) else { return nil }
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
