import Combine
import Foundation
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
#endif

/// 上课闹钟 (NapTable's 作息响铃): a real alarm before the first class of a
/// morning, and one before the first class after the noon break, for the
/// next seven days. Days off, make-up days and single meetings moved or
/// cancelled are already in the dated timetable it reads, so the alarms
/// follow them. iOS 26 and later (AlarmKit); the settings say so elsewhere.
@MainActor
final class NativeRoutineAlarms: ObservableObject {
    static let shared = NativeRoutineAlarms()

    struct Planned: Identifiable, Equatable, Codable {
        let kind: String
        let date: String
        let fire: Date
        let title: String
        var id: String { "\(kind)@\(date)" }
    }

    @Published var morningOn: Bool { didSet { save(); refresh() } }
    /// Minutes before the first morning class.
    @Published var morningLead: Int { didSet { save(); refresh() } }
    @Published var napOn: Bool { didSet { save(); refresh() } }
    /// Minutes before the first class after the noon break.
    @Published var napLead: Int { didSet { save(); refresh() } }
    @Published private(set) var planned: [Planned] = []
    @Published private(set) var message: String?
    @Published private(set) var authorized: Bool?

    static let morningLeads = [30, 45, 60, 90]
    static let napLeads = [10, 15, 20, 30]
    /// A class beginning before this (minutes) is a morning class.
    private static let morningEnds = 12 * 60
    private let defaults = UserDefaults.standard
    private var scheduledIDs: [String: String] {
        get { defaults.dictionary(forKey: "cpu.routineAlarm.ids") as? [String: String] ?? [:] }
        set { defaults.set(newValue, forKey: "cpu.routineAlarm.ids") }
    }
    private var refreshing: Task<Void, Never>?

    private init() {
        morningOn = defaults.bool(forKey: "cpu.routineAlarm.morning")
        morningLead = defaults.object(forKey: "cpu.routineAlarm.morningLead") as? Int ?? 60
        napOn = defaults.bool(forKey: "cpu.routineAlarm.nap")
        napLead = defaults.object(forKey: "cpu.routineAlarm.napLead") as? Int ?? 15
    }

    static var supported: Bool {
        if #available(iOS 26.0, *) { return true }
        return false
    }

    private func save() {
        defaults.set(morningOn, forKey: "cpu.routineAlarm.morning")
        defaults.set(morningLead, forKey: "cpu.routineAlarm.morningLead")
        defaults.set(napOn, forKey: "cpu.routineAlarm.nap")
        defaults.set(napLead, forKey: "cpu.routineAlarm.napLead")
    }

    /// The alarms the timetable calls for, from now to seven days ahead.
    static func plan(record: NativeWidgetLocalSchedule.Record?, morning: Int?, nap: Int?, now: Date = .now) -> [Planned] {
        guard let record else { return [] }
        let today = ScheduleShortcutReader.today(now)
        var result: [Planned] = []
        var date = today.date
        for _ in 0..<7 {
            if let meetings = ScheduleShortcutReader.meetings(on: date, in: record), !meetings.isEmpty {
                if let morning, let first = meetings.first, first.start < morningEnds {
                    append("morning", date: date, minute: first.start - morning, title: "早课：\(first.start.clockText)「\(first.name)」")
                }
                if let nap, let afternoon = meetings.first(where: { $0.start >= morningEnds }),
                   // Only after a break: a class running into the afternoon is not one.
                   !meetings.contains(where: { $0.start < morningEnds && $0.end > afternoon.start - 30 }) {
                    append("nap", date: date, minute: afternoon.start - nap, title: "午休结束：\(afternoon.start.clockText)「\(afternoon.name)」")
                }
            }
            guard let next = ScheduleShortcutReader.date(byAdding: 1, to: date) else { break }
            date = next
        }
        return result

        func append(_ kind: String, date: String, minute: Int, title: String) {
            guard minute >= 0, let fire = ScheduleShortcutReader.moment(date, minute: minute), fire > now else { return }
            result.append(Planned(kind: kind, date: date, fire: fire, title: title))
        }
    }

    /// Schedules the alarms again from the current timetable. Cheap when nothing changed.
    func refresh() {
        refreshing?.cancel()
        refreshing = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            let next = Self.plan(record: ScheduleShortcutReader.record(),
                                 morning: morningOn ? morningLead : nil, nap: napOn ? napLead : nil)
            await apply(next)
        }
    }

    private func apply(_ next: [Planned]) async {
        #if canImport(AlarmKit)
        guard #available(iOS 26.0, *) else { planned = []; return }
        let manager = AlarmManager.shared
        if !next.isEmpty {
            if manager.authorizationState == .notDetermined {
                _ = try? await manager.requestAuthorization()
            }
            authorized = manager.authorizationState == .authorized
            guard authorized == true else {
                message = "没有闹钟权限，请在系统设置里允许药大拾间设置闹钟。"
                planned = []
                return
            }
        }
        var ids = scheduledIDs
        let wanted = Dictionary(next.map { ($0.id + "|\($0.fire.timeIntervalSince1970)|\($0.title)", $0) }, uniquingKeysWith: { a, _ in a })
        // Cancel what is no longer wanted or has changed.
        for (key, raw) in ids where wanted[key] == nil {
            if let id = UUID(uuidString: raw) { try? manager.cancel(id: id) }
            ids.removeValue(forKey: key)
        }
        var failed = false
        for (key, item) in wanted where ids[key] == nil {
            let id = UUID()
            do {
                _ = try await manager.schedule(id: id, configuration: Self.configuration(for: item))
                ids[key] = id.uuidString
            } catch {
                failed = true
            }
        }
        scheduledIDs = ids
        planned = next.filter { item in ids.keys.contains { $0.hasPrefix(item.id + "|") } }
        message = failed ? "有的闹钟没有设上，稍后打开 App 会再试。" : nil
        #else
        planned = []
        #endif
    }

    #if canImport(AlarmKit)
    @available(iOS 26.0, *)
    private static func configuration(for item: Planned) -> AlarmManager.AlarmConfiguration<CPURoutineAlarmMetadata> {
        let title = LocalizedStringResource(stringLiteral: item.title)
        let alert: AlarmPresentation.Alert
        if #available(iOS 26.1, *) {
            alert = AlarmPresentation.Alert(title: title)
        } else {
            alert = AlarmPresentation.Alert(title: title,
                                            stopButton: AlarmButton(text: "关闭", textColor: .white, systemImageName: "stop.circle"))
        }
        let attributes = AlarmAttributes(presentation: AlarmPresentation(alert: alert),
                                         metadata: CPURoutineAlarmMetadata(kind: item.kind, date: item.date),
                                         tintColor: Color(red: 15 / 255, green: 143 / 255, blue: 127 / 255))
        return .alarm(schedule: .fixed(item.fire), attributes: attributes)
    }
    #endif
}

#if canImport(AlarmKit)
@available(iOS 26.0, *)
nonisolated struct CPURoutineAlarmMetadata: AlarmMetadata {
    let kind: String
    let date: String
}
#endif

private extension Int {
    var clockText: String { String(format: "%02d:%02d", self / 60, self % 60) }
}

extension ScheduleShortcutReader {
    /// The moment at `minute` of `date` in the timetable's time zone.
    static func moment(_ date: String, minute: Int) -> Date? {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2],
                                                  hour: minute / 60, minute: minute % 60))
    }
}

/// 上课闹钟 settings.
@available(iOS 17.0, *)
struct NativeRoutineAlarmSettingsPage: View {
    @ObservedObject private var alarms = NativeRoutineAlarms.shared

    var body: some View {
        Form {
            if !NativeRoutineAlarms.supported {
                Section {
                    Label("上课闹钟需要 iOS 26 或更新的系统。", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
            }
            Section {
                Toggle("早课闹钟", isOn: $alarms.morningOn)
                if alarms.morningOn {
                    Picker("第一节课前", selection: $alarms.morningLead) {
                        ForEach(NativeRoutineAlarms.morningLeads, id: \.self) { Text(Self.text($0)).tag($0) }
                    }
                }
            } footer: {
                Text("上午有课的日子，按第一节课的时间叫醒你。")
            }
            Section {
                Toggle("午休闹钟", isOn: $alarms.napOn)
                if alarms.napOn {
                    Picker("下午第一节课前", selection: $alarms.napLead) {
                        ForEach(NativeRoutineAlarms.napLeads, id: \.self) { Text(Self.text($0)).tag($0) }
                    }
                }
            } footer: {
                Text("下午有课、中午能休息的日子，在午休后的第一节课前响。")
            }
            if alarms.morningOn || alarms.napOn {
                Section("接下来") {
                    if let message = alarms.message {
                        Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.footnote)
                    }
                    if alarms.planned.isEmpty && alarms.message == nil {
                        Text("未来 7 天没有需要叫醒的课。").foregroundStyle(.secondary)
                    }
                    ForEach(alarms.planned.prefix(6)) { item in
                        HStack(spacing: 12) {
                            Image(systemName: item.kind == "morning" ? "sunrise.fill" : "cup.and.saucer.fill")
                                .foregroundStyle(item.kind == "morning" ? .orange : .brown)
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(Self.fireText(item.fire)).font(.body.weight(.semibold).monospacedDigit())
                                Text(item.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                    }
                }
            }
            Section {
            } footer: {
                Text("闹钟按课表自动排好未来 7 天，放假、调休、停课和调课都会跟着变；每次打开 App 会重新安排。闹钟由系统响起，静音模式下也会响。")
            }
        }
        .navigationTitle("上课闹钟")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { alarms.refresh() }
    }

    private static func text(_ minutes: Int) -> String {
        minutes < 60 ? "\(minutes) 分钟" : minutes % 60 == 0 ? "\(minutes / 60) 小时" : "\(minutes / 60) 小时 \(minutes % 60) 分"
    }

    private static func fireText(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = ScheduleShortcutReader.zone
        formatter.dateFormat = "M月d日 EEE HH:mm"
        return formatter.string(from: date)
    }
}
