import SwiftUI
import EventKit
import UIKit

/// 「Apple 日历」: syncing the whole semester into the system calendar, the
/// calendar file for other apps, and removing what was synced. Opened from
/// 更多 on the timetable and from 课表、设备与小组件.
@available(iOS 17.0, *)
struct NativeScheduleCalendarView: View {
    @ObservedObject var store: NativeScheduleStore
    @State private var phase: Phase = .idle
    @State private var remindersEnabled: Bool
    @State private var showClearConfirmation = false
    @State private var message: Message?
    @State private var lastSync: NativeScheduleCalendarImporter.LastSync?
    @State private var exportItem: ExportItem?

    enum Phase: Equatable { case idle, preparing, importing, exporting, clearing }

    struct Message: Equatable {
        let text: String
        let failed: Bool
    }

    struct ExportItem: Identifiable {
        let id = UUID()
        let url: URL
    }

    init(store: NativeScheduleStore) {
        self.store = store
        _remindersEnabled = State(initialValue: NativeScheduleCalendarImporter.remindersEnabled)
        _lastSync = State(initialValue: NativeScheduleCalendarImporter.lastSync)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                hero
                syncCard
                fileCard
                clearCard
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 18)
        }
        .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
        .alert("清空已同步的课程？", isPresented: $showClearConfirmation) {
            Button("清空", role: .destructive) { clear() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("只删除由药大拾间写入的课程事件，日历里的其他内容不受影响。")
        }
        .sheet(item: $exportItem) { item in
            NativeCalendarFileShareView(url: item.url)
                .presentationDetents([.medium, .large])
                .ignoresSafeArea()
        }
    }

    // MARK: Sections

    private var hero: some View {
        VStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.cpuBrand.gradient)
                    .frame(width: 64, height: 64)
                    .shadow(color: Color.cpuBrand.opacity(0.28), radius: 12, y: 6)
                VStack(spacing: 0) {
                    Text(Self.monthText)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white.opacity(0.85))
                    Text(Self.dayText)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                }
            }
            Text("课表进日历")
                .font(.title3.weight(.bold))
            Text("整学期的课按实际日期写进系统日历，放假和调休都已经算好。日历、Siri 和锁屏都能看到。")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 6)
        .padding(.horizontal, 8)
    }

    private var syncCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                Button(action: sync) {
                    HStack(spacing: 10) {
                        if phase == .preparing || phase == .importing {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: lastSync == nil ? "calendar.badge.plus" : "arrow.triangle.2.circlepath")
                                .font(.body.weight(.semibold))
                        }
                        Text(syncTitle)
                            .font(.body.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .foregroundStyle(.white)
                    .background(Color.cpuBrand, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(phase != .idle || store.snapshotForWatch() == nil)
                .opacity(store.snapshotForWatch() == nil ? 0.5 : 1)

                Toggle(isOn: Binding(
                    get: { remindersEnabled },
                    set: { value in
                        remindersEnabled = value
                        NativeScheduleCalendarImporter.remindersEnabled = value
                    }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("课前 15 分钟提醒")
                            .font(.body.weight(.medium))
                        Text("下次同步时生效")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .tint(.cpuBrand)

                if let message {
                    Label(message.text, systemImage: message.failed ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(message.failed ? Color.orange : Color.cpuBrand)
                        .transition(.opacity)
                } else if let lastSync {
                    Label(lastSyncText(lastSync), systemImage: "clock")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var fileCard: some View {
        card(padding: 0) {
            Button(action: exportFile) {
                HStack(spacing: 12) {
                    iconTile("doc.badge.arrow.up", tint: .blue)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("导出日历文件")
                            .font(.body.weight(.medium))
                            .foregroundStyle(.primary)
                        Text("整学期 .ics，可发给别人或导入其他日历 App")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    if phase == .exporting {
                        ProgressView()
                    } else {
                        Image(systemName: "square.and.arrow.up")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(phase != .idle || store.snapshotForWatch() == nil)
        }
    }

    private var clearCard: some View {
        card(padding: 0) {
            Button {
                showClearConfirmation = true
            } label: {
                HStack(spacing: 12) {
                    iconTile("trash", tint: .red)
                    Text(phase == .clearing ? "正在清空…" : "清空已同步的课程")
                        .font(.body.weight(.medium))
                        .foregroundStyle(hasImported ? Color.red : Color.secondary)
                    Spacer(minLength: 8)
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(phase != .idle || !hasImported)
        }
    }

    // MARK: Building blocks

    private func card<Content: View>(padding: CGFloat = 16, @ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func iconTile(_ systemImage: String, tint: Color) -> some View {
        Image(systemName: systemImage)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 30, height: 30)
            .background(tint.gradient, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var syncTitle: String {
        switch phase {
        case .preparing: return "正在读取整学期课表…"
        case .importing: return "正在写入日历…"
        default: return lastSync == nil ? "同步到 Apple 日历" : "重新同步"
        }
    }

    private var hasImported: Bool { NativeScheduleCalendarImporter.hasImportedEvents }

    private func lastSyncText(_ sync: NativeScheduleCalendarImporter.LastSync) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.unitsStyle = .full
        let when = formatter.localizedString(for: sync.date, relativeTo: .now)
        return "\(when)同步了 \(sync.count) 节课"
    }

    private static var monthText: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月"
        return formatter.string(from: .now)
    }

    private static var dayText: String {
        String(Calendar.current.component(.day, from: .now))
    }

    // MARK: Actions

    private func sync() {
        message = nil
        phase = .preparing
        Task { @MainActor in
            let snapshot = await store.snapshotForCalendarImport()
            guard let snapshot, snapshot.data != nil else {
                phase = .idle
                withAnimation { message = Message(text: "暂时没有可同步的课表", failed: true) }
                return
            }
            phase = .importing
            do {
                let count = try await NativeScheduleCalendarImporter().importSnapshot(snapshot, remindersEnabled: remindersEnabled)
                lastSync = NativeScheduleCalendarImporter.lastSync
                withAnimation {
                    message = Message(
                        text: snapshot.completeSemester ? "已同步整学期 \(count) 节课" : "已同步本周 \(count) 节课",
                        failed: false
                    )
                }
            } catch {
                withAnimation { message = Message(text: "同步失败：\(error.localizedDescription)", failed: true) }
            }
            phase = .idle
        }
    }

    private func exportFile() {
        message = nil
        phase = .exporting
        Task { @MainActor in
            defer { phase = .idle }
            guard let snapshot = await store.snapshotForCalendarImport() else {
                withAnimation { message = Message(text: "暂时没有可导出的课表", failed: true) }
                return
            }
            let occurrences = NativeScheduleOccurrences.make(snapshot)
            guard !occurrences.isEmpty else {
                withAnimation { message = Message(text: "这学期还没有可导出的课程", failed: true) }
                return
            }
            let name = Self.fileName(for: snapshot)
            let ics = NativeScheduleICSExporter.make(occurrences: occurrences, calendarName: name)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).ics")
            guard (try? Data(ics.utf8).write(to: url, options: .atomic)) != nil else {
                withAnimation { message = Message(text: "日历文件写入失败", failed: true) }
                return
            }
            exportItem = ExportItem(url: url)
        }
    }

    private func clear() {
        message = nil
        phase = .clearing
        Task { @MainActor in
            do {
                let count = try await NativeScheduleCalendarImporter().clearImportedEvents()
                lastSync = nil
                withAnimation {
                    message = Message(text: count > 0 ? "已删除 \(count) 节课" : "日历里没有找到同步过的课程", failed: false)
                }
            } catch {
                withAnimation { message = Message(text: "清空失败：\(error.localizedDescription)", failed: true) }
            }
            phase = .idle
        }
    }

    private static func fileName(for snapshot: NativeScheduleSnapshot) -> String {
        guard let data = snapshot.data else { return "课表" }
        let semester = NativeScheduleSemester.calendarDisplayName(
            for: data.currentSemester,
            options: data.semesters + (snapshot.calendar?.semesters ?? [])
        )
        let scope = snapshot.completeSemester ? "" : "-第\(data.currentWeek)周"
        return "课表-\(semester)\(scope)".replacingOccurrences(of: "/", with: "-")
    }
}

@available(iOS 17.0, *)
private struct NativeCalendarFileShareView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Writes the meetings `NativeScheduleOccurrences` resolves into the default
/// calendar and remembers which events it made, so a later sync updates them
/// in place and 清空 removes only those.
@MainActor
@available(iOS 17.0, *)
final class NativeScheduleCalendarImporter {
    static let mapPrefix = "scheduleAppleCalendarEventMap.v1."
    static let remindersKey = "scheduleAppleCalendarRemindersEnabled"
    private static let lastSyncKey = "scheduleAppleCalendarLastSync.v1"
    private static var defaults: UserDefaults? { UserDefaults(suiteName: NextWidgetConfiguration.appGroup) }

    struct LastSync: Codable {
        let date: Date
        let count: Int
    }

    enum ImportError: LocalizedError {
        case permissionDenied
        case noCalendar
        case invalidSchedule

        var errorDescription: String? {
            switch self {
            case .permissionDenied: return "没有日历写入权限，请在系统设置里允许药大拾间访问日历。"
            case .noCalendar: return "这台设备没有可以写入的日历。"
            case .invalidSchedule: return "课表的日期或节次不完整，暂时无法同步。"
            }
        }
    }

    static var remindersEnabled: Bool {
        get { defaults?.object(forKey: remindersKey) as? Bool ?? false }
        set { defaults?.set(newValue, forKey: remindersKey) }
    }

    static var lastSync: LastSync? {
        guard let data = defaults?.data(forKey: lastSyncKey) else { return nil }
        return try? JSONDecoder().decode(LastSync.self, from: data)
    }

    static var hasImportedEvents: Bool {
        defaults?.dictionaryRepresentation().keys.contains { $0.hasPrefix(mapPrefix) } == true
    }

    func importSnapshot(_ snapshot: NativeScheduleSnapshot, remindersEnabled: Bool) async throws -> Int {
        guard let data = snapshot.data, !data.currentSemester.isEmpty,
              let calendar = snapshot.calendar, !calendar.weeks.isEmpty else {
            throw ImportError.invalidSchedule
        }
        let eventStore = try await authorizedStore()
        guard let targetCalendar = eventStore.defaultCalendarForNewEvents else { throw ImportError.noCalendar }

        let occurrences = NativeScheduleOccurrences.make(snapshot)
        guard !occurrences.isEmpty else { throw ImportError.invalidSchedule }
        let semesterName = NativeScheduleSemester.calendarDisplayName(
            for: data.currentSemester,
            options: data.semesters + calendar.semesters
        )
        var eventMap = loadMap(for: data.currentSemester)
        var activeKeys = Set<String>()

        for occurrence in occurrences {
            let key = occurrence.key
            activeKeys.insert(key)
            let event: EKEvent
            if let identifier = eventMap[key], let existing = eventStore.event(withIdentifier: identifier) {
                event = existing
            } else {
                event = EKEvent(eventStore: eventStore)
                event.calendar = targetCalendar
            }
            let course = occurrence.course
            event.title = course.name.trimmedNonEmpty ?? "课程"
            event.startDate = occurrence.start
            event.endDate = occurrence.end
            event.location = course.location.map(ScheduleClassroom.only)
            event.notes = notes(for: occurrence, semester: semesterName)
            event.alarms = remindersEnabled ? [EKAlarm(relativeOffset: -15 * 60)] : []
            try eventStore.save(event, span: .thisEvent, commit: false)
            eventMap[key] = event.eventIdentifier
        }

        // A complete semester is authoritative: events from an earlier sync that
        // the timetable no longer has are removed. A single week never deletes
        // the weeks it did not see.
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
        if let encoded = try? JSONEncoder().encode(LastSync(date: .now, count: occurrences.count)) {
            Self.defaults?.set(encoded, forKey: Self.lastSyncKey)
        }
        return occurrences.count
    }

    func clearImportedEvents() async throws -> Int {
        let eventStore = try await authorizedStore()
        guard let defaults = Self.defaults else { return 0 }
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
        defaults.removeObject(forKey: Self.lastSyncKey)
        return count
    }

    private func authorizedStore() async throws -> EKEventStore {
        let eventStore = EKEventStore()
        guard try await eventStore.requestFullAccessToEvents() else { throw ImportError.permissionDenied }
        return eventStore
    }

    private func notes(for occurrence: NativeScheduleOccurrence, semester: String) -> String {
        var lines = ["学期：\(semester)", "周次：第 \(occurrence.week) 周"]
        if let teacher = occurrence.course.teacher?.trimmedNonEmpty { lines.append("老师：\(teacher)") }
        if let note = occurrence.course.editableNote { lines.append("备注：\(note)") }
        if let source = occurrence.sourceDate { lines.append("调休：补 \(source) 的课") }
        return lines.joined(separator: "\n")
    }

    private func loadMap(for semester: String) -> [String: String] {
        guard let data = Self.defaults?.data(forKey: Self.mapPrefix + semester),
              let value = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return value
    }

    private func saveMap(_ value: [String: String], for semester: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        Self.defaults?.set(data, forKey: Self.mapPrefix + semester)
    }
}
