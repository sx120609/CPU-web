import Combine
import CryptoKit
import Foundation
import SwiftUI

#if !SWIFT_PACKAGE
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

#endif

extension NativeScheduleSnapshot {
    func watchEnvelope() throws -> ScheduleEnvelope {
        guard version == 1 else { throw ScheduleFailure.unsupportedVersion }
        guard auth.authenticated, error == nil,
              let fetchedAt, let data, let sourceCalendar = calendar,
              !data.currentSemester.isEmpty else { throw ScheduleFailure.invalidData }

        let calendarWeeks = sourceCalendar.weeks.sorted { $0.week < $1.week }
        guard !calendarWeeks.isEmpty,
              calendarWeeks.map(\.week) == Array(1...calendarWeeks.count),
              let firstWeek = calendarWeeks.first,
              let lastWeek = calendarWeeks.last else {
            throw ScheduleFailure.invalidData
        }
        let semesterStart = try firstWeek.watchWeekDays()[0]
        let semesterEnd = try lastWeek.watchWeekDays()[6]

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
        guard !schedulePeriods.isEmpty,
              Set(schedulePeriods.map(\.number)).count == schedulePeriods.count else {
            throw ScheduleFailure.invalidData
        }
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
                // One stable source may have different rooms, teachers or
                // lengths in different weeks. Keep those variants separate;
                // covered-week replacement removes obsolete variants on edits.
                let variant = [sourceIdentity, course.name, course.teacher ?? "",
                               course.location ?? "", String(cell.day),
                               String(startPeriod), String(endPeriod), start.startTime, end.endTime]
                let digest = SHA256.hash(data: try JSONEncoder().encode(variant))
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
        let currentWeek = ScheduleEnvelope.teachingWeek(
            at: fetchedAt,
            semesterStart: semesterStart,
            semesterEnd: semesterEnd,
            timezone: timezone
        )
        return ScheduleEnvelope(
            schemaVersion: ScheduleEnvelope.currentVersion,
            messageType: ScheduleWireProtocol.MessageType.snapshot,
            generatedAt: fetchedAt,
            semester: semester,
            timezone: timezone,
            currentWeek: currentWeek,
            coveredWeeks: coveredWeeks,
            periods: schedulePeriods,
            courses: mappedCourses.values.sorted { $0.id < $1.id }
        )
    }

}

private extension NativeCalendarWeek {
    /// Match the shared Web calendar's Sunday-first and missing-day handling.
    func watchWeekDays() throws -> [String] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        let anchors = days.enumerated().compactMap { index, value -> (Int, Date, Int)? in
            let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let date = formatter.date(from: text), formatter.string(from: date) == text else { return nil }
            let weekday = calendar.component(.weekday, from: date)
            return (index, date, weekday == 1 ? 7 : weekday - 1)
        }
        guard let anchor = anchors.first else { throw ScheduleFailure.invalidData }
        let sundayScore = anchors.filter { $0.2 == ($0.0 == 0 ? 7 : $0.0) }.count
        let mondayScore = anchors.filter { $0.2 == $0.0 + 1 }.count
        let offset = sundayScore > mondayScore ? (anchor.0 == 0 ? -1 : anchor.0 - 1) : anchor.0
        guard let monday = calendar.date(byAdding: .day, value: -offset, to: anchor.1),
              calendar.component(.weekday, from: monday) == 2 else { throw ScheduleFailure.invalidData }
        return try (0..<7).map { offset in
            guard let date = calendar.date(byAdding: .day, value: offset, to: monday) else {
                throw ScheduleFailure.invalidData
            }
            return formatter.string(from: date)
        }
    }
}
