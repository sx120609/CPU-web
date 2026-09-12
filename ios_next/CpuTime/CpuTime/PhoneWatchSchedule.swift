import Combine
import CryptoKit
import Foundation
import SwiftUI

@MainActor
private final class NativeWatchScheduleProvider: ScheduleDataProvider {
    weak var store: NativeScheduleStore?
    var onSnapshot: ((Data) -> Void)?
    var onFailure: ((ScheduleFailure) -> Void)?

    func accept(_ snapshot: NativeScheduleSnapshot) {
        guard snapshot.version == 1 else {
            onFailure?(.unsupportedVersion)
            return
        }
        guard snapshot.auth.authenticated else {
            onFailure?(.loginRequired)
            return
        }
        guard snapshot.error == nil else {
            onFailure?(.sourceUnavailable)
            return
        }
        do {
            onSnapshot?(try snapshot.watchEnvelope().encoded())
        } catch {
            onFailure?(error as? ScheduleFailure ?? .invalidData)
        }
    }

    func refresh() {
        guard let store else {
            onFailure?(.sourceUnavailable)
            return
        }
        Task { @MainActor [weak self, weak store] in
            guard let self, let store else { return }
            await store.refresh()
            switch store.state {
            case .unauthorized:
                self.onFailure?(.loginRequired)
            case .failed:
                self.onFailure?(.sourceUnavailable)
            case .stale:
                if store.errorMessage != nil { self.onFailure?(.sourceUnavailable) }
            default:
                break
            }
        }
    }
}

@MainActor
final class PhoneWatchScheduleStore: ObservableObject {
    let coordinator: ScheduleSyncCoordinator
    private let provider: NativeWatchScheduleProvider
    private weak var nativeStore: NativeScheduleStore?

    init() {
        let provider = NativeWatchScheduleProvider()
        self.provider = provider
        coordinator = ScheduleSyncCoordinator(
            role: .phone,
            repository: CourseRepository(storage: FileScheduleStorage.local()),
            transport: WatchSessionTransport(),
            provider: provider,
            defaults: .standard
        )
        coordinator.onChange = { [weak self] in self?.objectWillChange.send() }
    }

    var showsStatusEntry: Bool {
        let connection = coordinator.transport.connection
        return connection.paired && connection.installed
    }

    func connect(to store: NativeScheduleStore) {
        guard nativeStore !== store else { return }
        nativeStore?.onWatchSnapshot = nil
        nativeStore?.onWatchReset = nil
        nativeStore = store
        provider.store = store
        store.onWatchSnapshot = { [weak provider] snapshot in provider?.accept(snapshot) }
        store.onWatchReset = { [weak self] in self?.coordinator.clearForAccountChange() }
        coordinator.start()
        if let snapshot = store.latestSnapshot { provider.accept(snapshot) }
    }

    func foreground() {
        coordinator.start()
        guard coordinator.transport.connection.installed else { return }
        coordinator.foreground()
    }
}

struct WatchSyncStatusView: View {
    @ObservedObject var store: PhoneWatchScheduleStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let sync = store.coordinator
        let connection = sync.transport.connection
        NavigationStack {
            Form {
                Section("Apple Watch") {
                    LabeledContent("已配对", value: connection.paired ? "是" : "否")
                    LabeledContent("Watch App 已安装", value: connection.installed ? "是" : "否")
                    LabeledContent("当前可达", value: connection.reachable ? "是" : "否")
                }
                Section("课表同步") {
                    LabeledContent("缓存课程", value: String(sync.repository.snapshot?.courses.count ?? 0))
                    dateRow("课表更新时间", sync.repository.snapshot?.generatedAt)
                    dateRow("已提交系统传输", sync.lastQueuedAt)
                    dateRow("手表确认同步", sync.lastSyncedAt)
                    if let error = sync.error {
                        Text(error.localizedDescription).foregroundStyle(.orange)
                    }
                    Button(sync.refreshing ? "正在刷新课表…" : "立即同步") {
                        sync.refresh()
                    }
                    .disabled(sync.refreshing)
                    Text("只有手表保存成功后的回执才会更新确认时间；离线时由系统稍后传输。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("手表同步")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }

    private func dateRow(_ title: LocalizedStringKey, _ date: Date?) -> some View {
        LabeledContent(title) {
            if let date { Text(date, format: .dateTime.month().day().hour().minute()) }
            else { Text("尚无") }
        }
    }
}

private extension NativeScheduleSnapshot {
    func watchEnvelope() throws -> ScheduleEnvelope {
        guard version == 1 else { throw ScheduleFailure.unsupportedVersion }
        guard auth.authenticated, error == nil,
              let fetchedAt, let data, let sourceCalendar = calendar,
              !data.currentSemester.isEmpty else { throw ScheduleFailure.invalidData }

        let calendarWeeks = sourceCalendar.weeks.sorted { $0.week < $1.week }
        guard !calendarWeeks.isEmpty,
              calendarWeeks.map(\.week) == Array(1...calendarWeeks.count),
              let semesterStart = calendarWeeks.first?.days.first,
              let semesterEnd = calendarWeeks.last?.days.last else {
            throw ScheduleFailure.invalidData
        }

        let coveredWeeks: [Int]
        if completeSemester {
            coveredWeeks = calendarWeeks.map(\.week)
        } else if let week = Int(data.currentWeek), calendarWeeks.contains(where: { $0.week == week }) {
            coveredWeeks = [week]
        } else {
            throw ScheduleFailure.invalidData
        }

        let schedulePeriods = periods.map {
            SchedulePeriod(number: $0.number, startTime: $0.startTime, endTime: $0.endTime)
        }.sorted { $0.number < $1.number }
        guard !schedulePeriods.isEmpty else { throw ScheduleFailure.invalidData }
        let periodByNumber = Dictionary(uniqueKeysWithValues: schedulePeriods.map { ($0.number, $0) })

        var mappedCourses: [String: WatchCourse] = [:]
        for cell in data.cells {
            for course in cell.courses {
                let range = NativeSchedulePeriod.normalizedRange(
                    bigSlot: cell.bigSlot,
                    startSlot: course.startSlot,
                    endSlot: course.endSlot,
                    periods: periods
                )
                let startPeriod = range.start
                let endPeriod = range.end
                guard let start = periodByNumber[startPeriod], let end = periodByNumber[endPeriod] else {
                    throw ScheduleFailure.invalidData
                }
                let weeks = Array(Set((course.weekList.isEmpty ? coveredWeeks : course.weekList)
                    .filter(coveredWeeks.contains))).sorted()
                guard !weeks.isEmpty else { continue }

                let sourceIdentity = course.nativeId?.trimmedNonEmpty
                    ?? course.customId.map { "custom:\($0)" }
                    ?? course.sourceKey.map { "source:\($0)" }
                    ?? ["official", data.currentSemester, String(cell.day), String(startPeriod), course.name]
                        .joined(separator: "|")
                let digest = SHA256.hash(data: Data(sourceIdentity.utf8))
                    .map { String(format: "%02x", $0) }.joined()
                let previousWeeks = mappedCourses[digest]?.weeks ?? []
                mappedCourses[digest] = WatchCourse(
                    id: digest,
                    name: course.name,
                    teacher: course.teacher,
                    room: course.location,
                    campus: nil,
                    weekday: cell.day,
                    startPeriod: startPeriod,
                    endPeriod: endPeriod,
                    startTime: start.startTime,
                    endTime: end.endTime,
                    weeks: Array(Set(previousWeeks + weeks)).sorted()
                )
            }
        }

        let timezone = "Asia/Shanghai"
        let semester = ScheduleSemester(
            id: data.currentSemester,
            startDate: semesterStart,
            endDate: semesterEnd,
            weekCount: calendarWeeks.count
        )
        let currentWeek = Self.currentWeek(at: fetchedAt, semesterStart: semesterStart,
                                           semesterEnd: semesterEnd, timezone: timezone)
        return ScheduleEnvelope(
            schemaVersion: ScheduleEnvelope.currentVersion,
            messageType: "schedule.snapshot",
            generatedAt: fetchedAt,
            semester: semester,
            timezone: timezone,
            currentWeek: currentWeek,
            coveredWeeks: coveredWeeks,
            periods: schedulePeriods,
            courses: mappedCourses.values.sorted { $0.id < $1.id }
        )
    }

    static func currentWeek(at date: Date, semesterStart: String, semesterEnd: String,
                            timezone: String) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timezone) ?? .gmt
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        guard let start = formatter.date(from: semesterStart),
              let end = formatter.date(from: semesterEnd) else { return 0 }
        let day = calendar.startOfDay(for: date)
        guard day >= start, day <= end else { return 0 }
        return (calendar.dateComponents([.day], from: start, to: day).day ?? 0) / 7 + 1
    }
}
