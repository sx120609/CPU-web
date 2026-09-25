import SwiftUI
import EventKit
import ActivityKit

/// Native companion settings are intentionally split by product surface. The
/// entry page stays short; each destination owns the controls for one thing.
struct NativeDeviceSettingsView: View {
    @ObservedObject var session: HybridWebViewStore
    @ObservedObject var watchStore: PhoneWatchScheduleStore
    @ObservedObject var scheduleStore: NativeScheduleStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SettingsDestinationRow(
                        title: "课表",
                        detail: "显示内容、排版和背景",
                        systemImage: "calendar"
                    ) {
                        NativeScheduleSettingsView(preferences: .shared, scheduleStore: scheduleStore)
                    }
                    SettingsDestinationRow(
                        title: "iPhone 小组件",
                        detail: session.widgetSettings.isConfigured ? "课表已同步，可在主屏幕添加" : "等待课表同步",
                        systemImage: "square.grid.2x2"
                    ) {
                        NativeWidgetSettingsPage(session: session)
                    }
                    SettingsDestinationRow(
                        title: "Apple Watch",
                        detail: watchStatus,
                        systemImage: "applewatch"
                    ) {
                        NativeWatchSettingsPage(store: watchStore)
                    }
                    if #available(iOS 16.1, *) {
                        SettingsDestinationRow(
                            title: "实时活动",
                            detail: liveActivityStatus,
                            systemImage: "rectangle.topthird.inset.filled"
                        ) {
                            NativeLiveActivitySettingsPage()
                        }
                    }
                    SettingsDestinationRow(
                        title: "Apple 日历",
                        detail: "导入课程和管理提醒",
                        systemImage: "calendar.badge.plus"
                    ) {
                        NativeCalendarSettingsPage(store: scheduleStore)
                    }
                } header: {
                    Text("设备与服务")
                } footer: {
                    Text("每项设置独立保存，调整后会立即同步到对应设备。")
                }
            }
            .navigationTitle("设备与设置")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .tint(.cpuBrand)
        .preferredColorScheme(session.pageColorScheme)
    }

    private var watchStatus: String {
        let connection = watchStore.coordinator.transport.connection
        if connection.reachable { return "已连接" }
        if connection.installed { return "等待连接" }
        if connection.paired { return "未安装" }
        return "未配对"
    }

    @available(iOS 16.1, *)
    private var liveActivityStatus: String {
        let enabled = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?
            .object(forKey: NativeLiveActivityController.enabledKey) as? Bool ?? true
        return enabled ? "已开启，临近课程自动显示" : "已关闭"
    }
}

private struct SettingsDestinationRow<Destination: View>: View {
    let title: String
    let detail: String
    let systemImage: String
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        NavigationLink(destination: destination) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.cpuBrand)
                    .frame(width: 28, height: 28)
                    .background(Color.cpuBrand.opacity(0.11), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.body.weight(.medium))
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.vertical, 3)
        }
    }
}

private struct NativeWidgetSettingsPage: View {
    @ObservedObject var session: HybridWebViewStore

    var body: some View {
        Form { WidgetSettingsSection(session: session) }
            .navigationTitle("iPhone 小组件")
            .navigationBarTitleDisplayMode(.inline)
    }
}

private struct NativeWatchSettingsPage: View {
    @ObservedObject var store: PhoneWatchScheduleStore

    var body: some View {
        Form { WatchSyncStatusSection(store: store) }
            .navigationTitle("Apple Watch")
            .navigationBarTitleDisplayMode(.inline)
    }
}

@available(iOS 16.1, *)
private struct NativeLiveActivitySettingsPage: View {
    var body: some View {
        Form { LiveActivitySettingsSection() }
            .navigationTitle("实时活动")
            .navigationBarTitleDisplayMode(.inline)
    }
}

private struct NativeCalendarSettingsPage: View {
    @ObservedObject var store: NativeScheduleStore

    var body: some View {
        Form { CalendarImportSection(store: store) }
            .navigationTitle("Apple 日历")
            .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ScheduleSettingsSection: View {
    @ObservedObject private var preferences = NativeSchedulePreferences.shared

    @ViewBuilder
    var body: some View {
        Section {
            Toggle("显示教室", isOn: $preferences.showLocation)
            Toggle("显示教师", isOn: $preferences.showTeacher)
            Toggle("显示节次", isOn: $preferences.showPeriod)
            Toggle("显示周次", isOn: $preferences.showWeeks)
        } header: {
            Label("课表显示内容", systemImage: "text.badge.checkmark")
        } footer: {
            Text("课程卡片会按屏幕宽度自动排版，关闭不需要的信息可以保留更多空间。")
        }

        Section {
            Picker("默认视图", selection: $preferences.defaultView) {
                Text("周课表").tag("week")
                Text("日课表").tag("day")
                Text("月历").tag("month")
            }
            Picker("排版密度", selection: $preferences.density) {
                Text("舒适").tag("comfortable")
                Text("紧凑").tag("compact")
            }
            Toggle("显示日期栏", isOn: $preferences.showDateHeader)
            Toggle("显示周末", isOn: $preferences.showWeekend)
        } header: {
            Label("视图与排版", systemImage: "rectangle.grid.1x2")
        }

        Section {
            NavigationLink {
                NativeScheduleSettingsView(preferences: preferences)
            } label: {
                Label("配色与背景", systemImage: "paintpalette")
                Spacer(minLength: 8)
                Text(preferences.palette == "color-glass" ? "彩色玻璃" : "已设置")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        } header: {
            Label("配色与背景", systemImage: "photo.on.rectangle")
        }
    }
}

private struct NativeScheduleSettingsView: View {
    @ObservedObject var preferences: NativeSchedulePreferences
    var scheduleStore: NativeScheduleStore? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var backgroundError = ""

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
                    Text("月历").tag("month")
                }
                Picker("排版密度", selection: $preferences.density) {
                    Text("舒适").tag("comfortable")
                    Text("紧凑").tag("compact")
                }
                Toggle("显示日期栏", isOn: $preferences.showDateHeader)
                Toggle("显示周末", isOn: $preferences.showWeekend)
                VStack(alignment: .leading, spacing: 10) {
                    Text("课程配色")
                        .font(.subheadline.weight(.medium))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), spacing: 10)], spacing: 10) {
                        ForEach(palettes, id: \.0) { value, label in
                            Button {
                                preferences.palette = value
                            } label: {
                                VStack(spacing: 5) {
                                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                                        .fill(paletteColor(value))
                                        .frame(height: 30)
                                        .overlay {
                                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                                .stroke(preferences.palette == value ? Color.cpuBrand : Color.clear, lineWidth: 2)
                                        }
                                    Text(label)
                                        .font(.caption2)
                                        .foregroundStyle(preferences.palette == value ? Color.cpuBrand : .secondary)
                                        .lineLimit(1)
                                }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("选择\(label)配色")
                        }
                    }
                }
            } header: {
                Text("课表外观")
            }

            Section {
                NavigationLink {
                    NativeScheduleBackgroundEditor(preferences: preferences, scheduleStore: scheduleStore)
                } label: {
                    HStack(spacing: 12) {
                        NativeScheduleBackground(image: preferences.backgroundImage,
                                                 visibility: preferences.backgroundVisibility,
                                                 blur: preferences.backgroundBlur)
                            .frame(width: 52, height: 52)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 4) {
                            Text("背景自定义")
                            Text(preferences.backgroundImage == nil ? "选择图片、调整显现与柔化" : "已设置 · 点按预览和调整")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                }
            } header: {
                Text("课表背景")
            } footer: {
                Text("背景只保存在本机，不会上传。")
            }

            Section {
                Button("恢复默认设置", role: .destructive) {
                    do { try preferences.reset() }
                    catch { backgroundError = "恢复默认设置失败，请重试。" }
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
        .alert("课表背景", isPresented: Binding(
            get: { !backgroundError.isEmpty },
            set: { if !$0 { backgroundError = "" } }
        )) {
            Button("知道了", role: .cancel) { backgroundError = "" }
        } message: {
            Text(backgroundError)
        }
    }

    private func paletteColor(_ value: String) -> LinearGradient {
        let colors: [Color]
        switch value {
        case "green": colors = [Color(red: 0.73, green: 0.93, blue: 0.78), Color(red: 0.35, green: 0.70, blue: 0.52)]
        case "blue": colors = [Color(red: 0.73, green: 0.86, blue: 1), Color(red: 0.35, green: 0.54, blue: 0.91)]
        case "teal": colors = [Color(red: 0.65, green: 0.91, blue: 0.88), Color(red: 0.25, green: 0.67, blue: 0.67)]
        case "indigo": colors = [Color(red: 0.77, green: 0.78, blue: 1), Color(red: 0.41, green: 0.43, blue: 0.82)]
        case "violet": colors = [Color(red: 0.88, green: 0.78, blue: 1), Color(red: 0.66, green: 0.43, blue: 0.85)]
        case "orange": colors = [Color(red: 1, green: 0.86, blue: 0.63), Color(red: 0.92, green: 0.53, blue: 0.22)]
        case "rose": colors = [Color(red: 1, green: 0.78, blue: 0.85), Color(red: 0.88, green: 0.38, blue: 0.58)]
        case "slate": colors = [Color(red: 0.83, green: 0.86, blue: 0.91), Color(red: 0.36, green: 0.42, blue: 0.51)]
        default: colors = [Color(red: 0.47, green: 0.79, blue: 0.69), Color(red: 0.46, green: 0.65, blue: 0.95), Color(red: 0.72, green: 0.59, blue: 0.87)]
        }
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
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
                Picker("课前提醒", selection: Binding(get: { controller.leadMinutes }, set: { controller.setLeadMinutes($0) })) {
                    Text("15 分钟").tag(15)
                    Text("30 分钟").tag(30)
                    Text("1 小时").tag(60)
                }
                Picker("连堂课计时", selection: Binding(get: { controller.timingMode }, set: { controller.setTimingMode($0) })) {
                    Text("整堂计时").tag(ScheduleLiveActivityAttributes.TimingMode.whole)
                    Text("分节计时").tag(ScheduleLiveActivityAttributes.TimingMode.segmented)
                }
                if #available(iOS 26.0, *) { Text(controller.coverageStatus).font(.footnote).foregroundStyle(.secondary) }
                ForEach(controller.conflicts) { conflict in
                    Picker("\(conflict.dateKey) 第 \(conflict.period) 节", selection: Binding(
                        get: { conflict.selectedSource ?? "" }, set: { controller.selectCourse($0, for: conflict) })) {
                        Text("请选择课程").tag("")
                        ForEach(conflict.options) { option in Text(option.name).tag(option.id) }
                    }
                }
            }
            if enabled, ActivityAuthorizationInfo().areActivitiesEnabled {
                Button {
                    if controller.isPreviewActive {
                        controller.endPreview()
                    } else {
                        controller.startPreview()
                    }
                } label: {
                    Label(
                        controller.isPreviewActive ? "结束实时活动测试" : "查看实时活动测试",
                        systemImage: controller.isPreviewActive ? "stop.circle" : "play.circle"
                    )
                }
            }
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
                        } else if controller.isPreviewActive {
                            Text("正在显示演示课程，锁定屏幕后可查看完整布局。")
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
            Text("iOS 26 及以上每次打开 App 安排未来 7 天课程；iOS 18–25 使用远程启动。每次课程独立计时，在最后一节下课时收起。手动移除后，下次打开 App 可恢复尚未结束的课程。")
            Text(controller.broadcastStatus)
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
        let semesterDisplayName = NativeScheduleSemester.calendarDisplayName(
            for: data.currentSemester,
            options: data.semesters + calendar.semesters
        )
        var eventMap = loadMap(for: data.currentSemester)
        var activeKeys = Set<String>()
        var count = 0

        for week in weeks {
            for targetDay in 1...7 {
                guard week.days.indices.contains(targetDay - 1) else { continue }
                let targetDate = week.days[targetDay - 1]
                let adjustment = calendar.adjustments.first(where: { $0.date == targetDate })
                if adjustment?.kind == "off" { continue }

                var sourceDay = targetDay
                var sourceWeek = week.week
                if adjustment?.kind == "swap" {
                    guard let source = adjustment?.source,
                          let sourceWeekInfo = calendar.weeks.first(where: { $0.days.contains(source) }),
                          let sourceIndex = sourceWeekInfo.days.firstIndex(of: source) else { continue }
                    sourceDay = sourceIndex + 1
                    sourceWeek = sourceWeekInfo.week
                }

                for cell in data.cells where cell.day == sourceDay {
                    for course in cell.courses where courseApplies(course, to: sourceWeek) {
                        let range = NativeSchedulePeriod.normalizedRange(
                            bigSlot: cell.bigSlot,
                            startSlot: course.startSlot,
                            endSlot: course.endSlot,
                            periods: periods
                        )
                        guard let startPeriod = periods.first(where: { $0.number == range.start }),
                              let endPeriod = periods.first(where: { $0.number == range.end }),
                              let start = date(for: targetDay, week: week, time: startPeriod.startTime),
                              let end = date(for: targetDay, week: week, time: endPeriod.endTime), end > start else { continue }
                        let key = eventKey(semester: data.currentSemester, week: week.week, day: targetDay, range: range, course: course)
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
                        event.notes = notes(for: course, week: week.week, semester: semesterDisplayName)
                        event.alarms = remindersEnabled ? [EKAlarm(relativeOffset: -15 * 60)] : []
                        try eventStore.save(event, span: .thisEvent, commit: false)
                        eventMap[key] = event.eventIdentifier
                        count += 1
                    }
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
            LabeledContent("状态", value: session.widgetSettings.isConfigured ? "课表已同步" : "等待课表同步")

            Toggle("课程名称", isOn: optionBinding(\.showCourseName))
            Toggle("教室", isOn: optionBinding(\.showRoom))
            Toggle("老师", isOn: optionBinding(\.showTeacher))
            Toggle("上课时间", isOn: optionBinding(\.showTime))

            Toggle("农历日期", isOn: optionBinding(\.showLunarDate))
            Toggle("节假日提示", isOn: optionBinding(\.showHoliday))
            Toggle("最近节假日常驻", isOn: optionBinding(\.holidayAlwaysVisible))
                .disabled(!options.showHoliday)

            Picker("颜色主题", selection: $theme) {
                ForEach(themes, id: \.0) { value in
                    Text(value.1).tag(value.0)
                }
            }
            .onChange(of: theme) { _, value in
                session.widgetSettings.setScheduleWidgetTheme(value)
            }
        } header: {
            Label("iPhone 小组件", systemImage: "square.grid.2x2")
        } footer: {
            Text("选择要显示的信息后，打开桌面添加“临近课程”“今日课表”或“两日课表”。小组件直接用 App 里的课表，打开 App 同步课表后自动更新。节假日只标法定假日和传统节日。今天的课上完后显示什么、两日课表显示哪两天，长按小组件选“编辑小组件”设置。")
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
}
