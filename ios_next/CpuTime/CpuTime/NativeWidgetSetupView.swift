import SwiftUI
import EventKit
import ActivityKit

/// One native settings surface for the two companion experiences. Keeping the
/// Watch status and iPhone widget controls together makes the schedule header
/// a single, predictable entry point.
struct NativeDeviceSettingsView: View {
    @ObservedObject var session: HybridWebViewStore
    @ObservedObject var watchStore: PhoneWatchScheduleStore
    @ObservedObject var scheduleStore: NativeScheduleStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                ScheduleSettingsSection()
                WidgetSettingsSection(session: session)
                WatchSyncStatusSection(store: watchStore)
                LiveActivitySettingsSection()
                CalendarImportSection(store: scheduleStore)
            }
            .navigationTitle("设备与小组件")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .tint(.cpuBrand)
        .preferredColorScheme(session.pageColorScheme)
    }
}

private struct ScheduleSettingsSection: View {
    @ObservedObject private var preferences = NativeSchedulePreferences.shared

    var body: some View {
        Section {
            NavigationLink {
                NativeScheduleSettingsView(preferences: preferences)
            } label: {
                Label("课表设置", systemImage: "calendar.badge.clock")
                Spacer(minLength: 8)
                Text(summary)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        } header: {
            Text("课表")
        }
    }

    private var summary: String {
        preferences.defaultView == "day" ? "日课表" : "周课表"
    }
}

private struct NativeScheduleSettingsView: View {
    @ObservedObject var preferences: NativeSchedulePreferences
    @Environment(\.dismiss) private var dismiss

    private let palettes = [
        ("color-glass", "彩色玻璃"), ("green", "绿意"), ("blue", "晴蓝"),
        ("teal", "青绿"), ("indigo", "靛青"), ("violet", "紫罗兰"),
        ("orange", "暖橙"), ("rose", "玫瑰"), ("slate", "石墨")
    ]

    var body: some View {
        Form {
            Section {
                Toggle("显示教室", isOn: $preferences.showLocation)
                Toggle("显示教师", isOn: $preferences.showTeacher)
                Toggle("显示节次", isOn: $preferences.showPeriod)
                Toggle("显示周次", isOn: $preferences.showWeeks)
            } header: {
                Text("课程卡片")
            } footer: {
                Text("关闭不需要的信息后，课程卡片会自动重新排版。")
            }

            Section {
                Picker("默认视图", selection: $preferences.defaultView) {
                    Text("周课表").tag("week")
                    Text("日课表").tag("day")
                }
                Picker("课程配色", selection: $preferences.palette) {
                    ForEach(palettes, id: \.0) { value, label in
                        Text(label).tag(value)
                    }
                }
            } header: {
                Text("课表外观")
            }

            Section {
                Button("恢复默认设置", role: .destructive) {
                    preferences.reset()
                }
            }
        }
        .navigationTitle("课表设置")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("完成") { dismiss() }
            }
        }
    }
}

@available(iOS 16.1, *)
private struct LiveActivitySettingsSection: View {
    @ObservedObject private var controller = NativeLiveActivityController.shared
    @State private var enabled: Bool

    init() {
        let defaults = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)
        _enabled = State(initialValue: defaults?.object(forKey: NativeLiveActivityController.enabledKey) as? Bool ?? true)
    }

    var body: some View {
        Section {
            Toggle("灵动岛课程活动", isOn: Binding(
                get: { enabled },
                set: { value in
                    enabled = value
                    NativeLiveActivityController.shared.setEnabled(value)
                }
            ))
            if enabled {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: statusSymbol)
                        .foregroundStyle(statusColor)
                        .frame(width: 20)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(controller.status.title)
                            .font(.subheadline.weight(.medium))
                        if let detail = controller.status.detail {
                            Text(detail)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else if controller.status == .active {
                            Text("退出 App 或锁定屏幕后，在支持的 iPhone 上查看。")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if !ActivityAuthorizationInfo().areActivitiesEnabled {
                Label("系统设置中未允许实时活动", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        } header: {
            Label("灵动岛", systemImage: "rectangle.topthird.inset.filled")
        } footer: {
            Text("正在上课时立即显示；下一节课会在上课前 15 分钟出现。课程结束后自动收起，较早的课程由小组件展示。")
        }
    }

    private var statusSymbol: String {
        switch controller.status {
        case .active: return "checkmark.circle.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .unavailable: return "minus.circle"
        case .disabled: return "pause.circle"
        case .waiting: return "clock"
        }
    }

    private var statusColor: Color {
        switch controller.status {
        case .active: return .cpuBrand
        case .failed, .unavailable: return .orange
        case .disabled, .waiting: return .secondary
        }
    }
}

private struct CalendarImportSection: View {
    @ObservedObject var store: NativeScheduleStore
    @State private var importing = false
    @State private var preparing = false
    @State private var clearing = false
    @State private var remindersEnabled: Bool
    @State private var showClearConfirmation = false
    @State private var message: String?

    init(store: NativeScheduleStore) {
        self.store = store
        let defaults = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)
        _remindersEnabled = State(initialValue: defaults?.object(forKey: NativeScheduleCalendarImporter.remindersKey) as? Bool ?? false)
    }

    var body: some View {
        Section {
            Button {
                importSchedule()
            } label: {
                Label(
                    importing ? "正在写入日历…" : preparing ? "正在读取完整课表…" : "导入到 Apple 日历",
                    systemImage: importing || preparing ? "arrow.triangle.2.circlepath" : "calendar.badge.plus"
                )
            }
            .disabled(importing || preparing || store.latestSnapshot == nil)

            Toggle("课程提醒", isOn: Binding(
                get: { remindersEnabled },
                set: { value in
                    remindersEnabled = value
                    UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?.set(value, forKey: NativeScheduleCalendarImporter.remindersKey)
                }
            ))

            Button("清空已导入课程", systemImage: "trash", role: .destructive) {
                showClearConfirmation = true
            }
            .disabled(importing || preparing || clearing || !hasImportedEvents)

            if let message {
                Label(message, systemImage: message.contains("失败") ? "exclamationmark.triangle" : "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(message.contains("失败") ? .orange : Color.cpuBrand)
            }
        } header: {
            Label("Apple 日历", systemImage: "calendar")
        } footer: {
            Text(remindersEnabled
                 ? "按课表周次、日期和节次创建课程事件，并在上课前 15 分钟提醒；再次导入会更新已有事件。"
                 : "按课表周次、日期和节次创建课程事件，默认不添加提醒；再次导入会更新已有事件。")
        }
        .alert("清空已导入课程？", isPresented: $showClearConfirmation) {
            Button("清空", role: .destructive) { clearImportedEvents() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("只会删除由本应用导入并记录的课程事件，不会影响日历中的其他内容。")
        }
    }

    private var hasImportedEvents: Bool {
        UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?
            .dictionaryRepresentation()
            .keys
            .contains { $0.hasPrefix(NativeScheduleCalendarImporter.mapPrefix) } == true
    }

    private func importSchedule() {
        guard store.snapshotForWatch() != nil else {
            message = "暂无可导入的课表"
            return
        }
        preparing = true
        Task { @MainActor in
            let snapshot = await store.snapshotForCalendarImport()
            preparing = false
            guard let snapshot else {
                message = "暂无可导入的课表"
                return
            }
            importing = true
            do {
                let count = try await NativeScheduleCalendarImporter().importSnapshot(snapshot, remindersEnabled: remindersEnabled)
                message = snapshot.completeSemester
                    ? "已同步 \(count) 个课程事件"
                    : "已同步当前周 \(count) 个课程事件"
            } catch {
                message = "导入失败：\(error.localizedDescription)"
            }
            importing = false
        }
    }

    private func clearImportedEvents() {
        clearing = true
        Task { @MainActor in
            do {
                let count = try await NativeScheduleCalendarImporter().clearImportedEvents()
                message = count > 0 ? "已清空 \(count) 个课程事件" : "没有找到已导入的课程事件"
            } catch {
                message = "清空失败：\(error.localizedDescription)"
            }
            clearing = false
        }
    }
}

@MainActor
private final class NativeScheduleCalendarImporter {
    fileprivate static let mapPrefix = "scheduleAppleCalendarEventMap.v1."
    fileprivate static let remindersKey = "scheduleAppleCalendarRemindersEnabled"
    private static let appGroup = NextWidgetConfiguration.appGroup

    enum ImportError: LocalizedError {
        case permissionDenied
        case noCalendar
        case invalidSchedule

        var errorDescription: String? {
            switch self {
            case .permissionDenied: return "没有获得 Apple 日历写入权限，请在系统设置中允许访问日历。"
            case .noCalendar: return "当前设备没有可写入的 Apple 日历。"
            case .invalidSchedule: return "课表日期或节次数据不完整，暂时无法导入。"
            }
        }
    }

    func importSnapshot(_ snapshot: NativeScheduleSnapshot, remindersEnabled: Bool) async throws -> Int {
        guard let data = snapshot.data, let calendar = snapshot.calendar,
              !data.currentSemester.isEmpty, !calendar.weeks.isEmpty else {
            throw ImportError.invalidSchedule
        }
        let eventStore = EKEventStore()
        let granted: Bool
        if #available(iOS 17.0, *) {
            granted = try await eventStore.requestFullAccessToEvents()
        } else {
            granted = try await eventStore.requestAccess(to: .event)
        }
        guard granted else { throw ImportError.permissionDenied }
        guard let targetCalendar = eventStore.defaultCalendarForNewEvents else { throw ImportError.noCalendar }

        let weeks = importWeeks(for: snapshot, data: data, calendar: calendar)
        guard !weeks.isEmpty else { throw ImportError.invalidSchedule }
        let periods = snapshot.periods.isEmpty ? NativeSchedulePeriod.bundledTimetable : snapshot.periods
        var eventMap = loadMap(for: data.currentSemester)
        var activeKeys = Set<String>()
        var count = 0

        for cell in data.cells where (1...7).contains(cell.day) {
            for course in cell.courses {
                let range = NativeSchedulePeriod.normalizedRange(
                    bigSlot: cell.bigSlot,
                    startSlot: course.startSlot,
                    endSlot: course.endSlot,
                    periods: periods
                )
                guard let startPeriod = periods.first(where: { $0.number == range.start }),
                      let endPeriod = periods.first(where: { $0.number == range.end }) else { continue }
                for week in weeks where courseApplies(course, to: week.week) {
                    guard let start = date(for: cell.day, week: week, time: startPeriod.startTime),
                          let end = date(for: cell.day, week: week, time: endPeriod.endTime), end > start else { continue }
                    let key = eventKey(semester: data.currentSemester, week: week.week, day: cell.day, range: range, course: course)
                    activeKeys.insert(key)
                    let event: EKEvent
                    if let identifier = eventMap[key], let existing = eventStore.event(withIdentifier: identifier) {
                        event = existing
                    } else {
                        event = EKEvent(eventStore: eventStore)
                        event.calendar = targetCalendar
                    }
                    event.title = course.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "课程" : course.name
                    event.startDate = start
                    event.endDate = end
                    event.location = course.location?.trimmingCharacters(in: .whitespacesAndNewlines)
                    event.notes = notes(for: course, week: week.week, semester: data.currentSemester)
                    event.alarms = remindersEnabled ? [EKAlarm(relativeOffset: -15 * 60)] : []
                    try eventStore.save(event, span: .thisEvent, commit: false)
                    eventMap[key] = event.eventIdentifier
                    count += 1
                }
            }
        }

        // A complete semester refresh is authoritative. Remove events from a
        // previous import that no longer exist in the current timetable; a
        // weekly response never deletes unseen weeks.
        if snapshot.completeSemester {
            for (key, identifier) in Array(eventMap) where !activeKeys.contains(key) {
                if let event = eventStore.event(withIdentifier: identifier) {
                    try eventStore.remove(event, span: .thisEvent, commit: false)
                }
                eventMap.removeValue(forKey: key)
            }
        }
        try eventStore.commit()
        saveMap(eventMap, for: data.currentSemester)
        return count
    }

    func clearImportedEvents() async throws -> Int {
        let eventStore = EKEventStore()
        let granted: Bool
        if #available(iOS 17.0, *) {
            granted = try await eventStore.requestFullAccessToEvents()
        } else {
            granted = try await eventStore.requestAccess(to: .event)
        }
        guard granted else { throw ImportError.permissionDenied }

        guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return 0 }
        let keys = defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix(Self.mapPrefix) }
        var identifiers = Set<String>()
        for key in keys {
            guard let data = defaults.data(forKey: key),
                  let map = try? JSONDecoder().decode([String: String].self, from: data) else { continue }
            identifiers.formUnion(map.values)
        }

        var count = 0
        for identifier in identifiers {
            guard let event = eventStore.event(withIdentifier: identifier) else { continue }
            try eventStore.remove(event, span: .thisEvent, commit: false)
            count += 1
        }
        if !identifiers.isEmpty { try eventStore.commit() }
        keys.forEach { defaults.removeObject(forKey: $0) }
        return count
    }

    private func importWeeks(for snapshot: NativeScheduleSnapshot, data: NativeScheduleResult, calendar: NativeScheduleCalendar) -> [NativeCalendarWeek] {
        let ordered = calendar.weeks.sorted { $0.week < $1.week }
        if snapshot.completeSemester { return ordered }
        let selected = Int(data.currentWeek) ?? calendar.currentWeek
        return ordered.filter { $0.week == selected }
    }

    private func courseApplies(_ course: NativeScheduleCourse, to week: Int) -> Bool {
        course.weekList.isEmpty || course.weekList.contains(week)
    }

    private func date(for day: Int, week: NativeCalendarWeek, time: String) -> Date? {
        let base = week.days.indices.contains(day - 1) ? week.days[day - 1] : week.monday
        guard let dayDate = parseDate(base) else { return nil }
        let components = time.split(separator: ":").compactMap { Int($0) }
        guard components.count >= 2 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        var value = calendar.dateComponents([.year, .month, .day], from: dayDate)
        value.hour = components[0]
        value.minute = components[1]
        value.second = 0
        return calendar.date(from: value)
    }

    private func parseDate(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    private func eventKey(semester: String, week: Int, day: Int, range: (start: Int, end: Int), course: NativeScheduleCourse) -> String {
        let identity = course.nativeId ?? course.sourceKey ?? course.customId ?? course.name
        return [semester, String(week), String(day), String(range.start), String(range.end), identity].joined(separator: "|")
    }

    private func notes(for course: NativeScheduleCourse, week: Int, semester: String) -> String {
        var lines = ["学期：\(semester)", "周次：第 \(week) 周"]
        if let teacher = course.teacher?.trimmingCharacters(in: .whitespacesAndNewlines), !teacher.isEmpty { lines.append("老师：\(teacher)") }
        if let note = course.slotNote?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty { lines.append("备注：\(note)") }
        return lines.joined(separator: "\n")
    }

    private func loadMap(for semester: String) -> [String: String] {
        guard let defaults = UserDefaults(suiteName: Self.appGroup),
              let data = defaults.data(forKey: Self.mapPrefix + semester),
              let value = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return value
    }

    private func saveMap(_ value: [String: String], for semester: String) {
        guard let defaults = UserDefaults(suiteName: Self.appGroup),
              let data = try? JSONEncoder().encode(value) else { return }
        defaults.set(data, forKey: Self.mapPrefix + semester)
    }
}

/// Kept as a small compatibility wrapper for any older route that still opens
/// the widget-only sheet.
struct NativeWidgetSetupView: View {
    @ObservedObject var session: HybridWebViewStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                WidgetSettingsSection(session: session)
            }
            .navigationTitle("iPhone 小组件")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .tint(.cpuBrand)
        .preferredColorScheme(session.pageColorScheme)
    }
}

private struct WidgetSettingsSection: View {
    @ObservedObject var session: HybridWebViewStore
    @State private var installing = false
    @State private var message: String?
    @State private var theme: String
    @State private var options: WidgetDisplayOptions

    private let themes = [
        ("color-glass", "彩色玻璃"), ("green", "绿"), ("blue", "蓝"),
        ("teal", "青"), ("indigo", "靛蓝"), ("violet", "紫"),
        ("orange", "橙"), ("rose", "玫瑰"), ("slate", "灰")
    ]

    init(session: HybridWebViewStore) {
        self.session = session
        let defaults = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)
        _theme = State(initialValue: defaults?.string(forKey: NextWidgetConfiguration.widgetThemeKey) ?? "color-glass")
        _options = State(initialValue: WidgetDisplayOptions.load(defaults: defaults))
    }

    var body: some View {
        Section {
            LabeledContent("状态", value: session.widgetSettings.isConfigured ? "已配置" : "等待配置")

            Toggle("课程名称", isOn: optionBinding(\.showCourseName))
            Toggle("教室", isOn: optionBinding(\.showRoom))
            Toggle("老师", isOn: optionBinding(\.showTeacher))
            Toggle("上课时间", isOn: optionBinding(\.showTime))

            Picker("颜色主题", selection: $theme) {
                ForEach(themes, id: \.0) { value in
                    Text(value.1).tag(value.0)
                }
            }
            .onChange(of: theme) { _, value in
                session.widgetSettings.setScheduleWidgetTheme(value)
            }

            Button {
                installing = true
                Task { @MainActor in
                    do {
                        try await session.configureScheduleWidget(theme: theme)
                        message = session.widgetSettings.status
                    } catch {
                        message = error.localizedDescription
                    }
                    installing = false
                }
            } label: {
                Label(
                    installing ? "正在同步配置…" : "同步小组件配置",
                    systemImage: installing ? "arrow.triangle.2.circlepath" : "square.and.arrow.down"
                )
            }
            .disabled(installing || !session.bridgeReady)

            if let message {
                statusLabel(message)
            } else if let status = session.widgetSettings.status {
                statusLabel(status)
            }
        } header: {
            Label("iPhone 小组件", systemImage: "square.grid.2x2")
        } footer: {
            Text("选择要显示的信息后，打开桌面添加“临近课程”“今日课表”或“两日课表”。课表会自动同步，今天无课时会显示最近有课的日期。")
        }
    }

    private func optionBinding(_ keyPath: WritableKeyPath<WidgetDisplayOptions, Bool>) -> Binding<Bool> {
        Binding(
            get: { options[keyPath: keyPath] },
            set: { value in
                options[keyPath: keyPath] = value
                session.widgetSettings.setScheduleWidgetDisplayOptions(options)
            }
        )
    }

    private func statusLabel(_ message: String) -> some View {
        Label(message, systemImage: message.contains("失败") ? "exclamationmark.triangle" : "checkmark.circle.fill")
            .font(.footnote)
            .foregroundStyle(message.contains("失败") ? .orange : Color.cpuBrand)
    }
}
