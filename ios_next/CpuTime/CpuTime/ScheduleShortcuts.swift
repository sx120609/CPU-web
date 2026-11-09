import AppIntents
import Combine
import Foundation

/// What the Shortcuts actions read: the dated timetable the app keeps in the
/// App Group for the widgets (`NativeWidgetLocalSchedule`), so a shortcut
/// answers without opening the app or reaching the network.
enum ScheduleShortcutReader {
    struct Meeting: Equatable {
        let name: String
        let location: String?
        let date: String
        /// Minutes since midnight.
        let start: Int
        let end: Int

        var timeText: String { "\(clock(start))–\(clock(end))" }
        var place: String { location.map { " · \(ScheduleClassroom.only($0))" } ?? "" }
    }

    static let zone = TimeZone(identifier: "Asia/Shanghai") ?? .current

    static func record() -> NativeWidgetLocalSchedule.Record? {
        guard let url = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: NextWidgetConfiguration.appGroup)?
            .appendingPathComponent(NativeWidgetLocalSchedule.fileName),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(NativeWidgetLocalSchedule.Record.self, from: data)
    }

    /// The meetings of one date in time order; nil when that date is not in the saved term.
    static func meetings(on date: String, in record: NativeWidgetLocalSchedule.Record) -> [Meeting]? {
        guard let day = record.days.first(where: { $0.date == date }) else { return nil }
        return day.courses.compactMap { course in
            guard let start = course.startTime.flatMap(minutes), let end = course.endTime.flatMap(minutes), end > start else { return nil }
            return Meeting(name: course.name, location: course.location?.trimmedNonEmpty, date: date, start: start, end: end)
        }
        .sorted { $0.start < $1.start }
    }

    static func minutes(_ value: String) -> Int? {
        let parts = value.split(separator: ":").compactMap { Int($0) }
        return parts.count >= 2 ? parts[0] * 60 + parts[1] : nil
    }

    static func clock(_ minutes: Int) -> String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }

    static func today(_ now: Date = .now) -> (date: String, minute: Int) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: now)
        return (String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0),
                (parts.hour ?? 0) * 60 + (parts.minute ?? 0))
    }

    static func date(byAdding days: Int, to date: String) -> String? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3,
              let value = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)),
              let next = calendar.date(byAdding: .day, value: days, to: value) else { return nil }
        let out = calendar.dateComponents([.year, .month, .day], from: next)
        return String(format: "%04d-%02d-%02d", out.year ?? 0, out.month ?? 0, out.day ?? 0)
    }

    /// The class going on at `minute`, if any.
    static func current(_ meetings: [Meeting], minute: Int) -> Meeting? {
        meetings.first { $0.start <= minute && minute < $0.end }
    }

    /// The next class from `minute` on this date or, looking up to two weeks
    /// ahead, a later one.
    static func next(after minute: Int, on date: String, in record: NativeWidgetLocalSchedule.Record) -> Meeting? {
        if let found = meetings(on: date, in: record)?.first(where: { $0.start > minute }) { return found }
        var day = date
        for _ in 0..<14 {
            guard let following = self.date(byAdding: 1, to: day) else { return nil }
            day = following
            if let first = meetings(on: day, in: record)?.first { return first }
        }
        return nil
    }

    static func dayText(_ date: String, today: String) -> String {
        if date == today { return "今天" }
        if date == self.date(byAdding: 1, to: today) { return "明天" }
        if date == self.date(byAdding: 2, to: today) { return "后天" }
        let parts = date.split(separator: "-").compactMap { Int($0) }
        return parts.count == 3 ? "\(parts[1])月\(parts[2])日" : date
    }

    static let missing = "还没有课表。打开药大拾间登录并刷新一次课表后再试。"
}

@available(iOS 17.0, *)
struct ScheduleNowIntent: AppIntent {
    static let title: LocalizedStringResource = "现在在上课吗"
    static let description = IntentDescription("看看现在有没有课：在上的课和几点下课，或者下一节课。")

    func perform() async throws -> some IntentResult & ReturnsValue<Bool> & ProvidesDialog {
        guard let record = ScheduleShortcutReader.record() else { return .result(value: false, dialog: "\(ScheduleShortcutReader.missing)") }
        let now = ScheduleShortcutReader.today()
        let today = ScheduleShortcutReader.meetings(on: now.date, in: record) ?? []
        if let current = ScheduleShortcutReader.current(today, minute: now.minute) {
            let left = current.end - now.minute
            return .result(value: true, dialog: "正在上「\(current.name)」\(current.place)，\(ScheduleShortcutReader.clock(current.end)) 下课，还有 \(left) 分钟。")
        }
        if let next = ScheduleShortcutReader.next(after: now.minute, on: now.date, in: record) {
            return .result(value: false, dialog: "现在没有课。下一节是\(ScheduleShortcutReader.dayText(next.date, today: now.date)) \(ScheduleShortcutReader.clock(next.start))「\(next.name)」\(next.place)。")
        }
        return .result(value: false, dialog: "现在没有课，近两周也没有安排。")
    }
}

@available(iOS 17.0, *)
struct ScheduleNextCourseIntent: AppIntent {
    static let title: LocalizedStringResource = "下一节课"
    static let description = IntentDescription("下一节课的名称、时间和教室。")

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        guard let record = ScheduleShortcutReader.record() else { return .result(value: "", dialog: "\(ScheduleShortcutReader.missing)") }
        let now = ScheduleShortcutReader.today()
        guard let next = ScheduleShortcutReader.next(after: now.minute, on: now.date, in: record) else {
            return .result(value: "", dialog: "近两周没有课。")
        }
        let text = "\(ScheduleShortcutReader.dayText(next.date, today: now.date)) \(next.timeText)「\(next.name)」\(next.place)"
        return .result(value: text, dialog: "\(text)")
    }
}

@available(iOS 17.0, *)
struct ScheduleTodayEndIntent: AppIntent {
    static let title: LocalizedStringResource = "今天几点下课"
    static let description = IntentDescription("今天最后一节课的下课时间。")

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        guard let record = ScheduleShortcutReader.record() else { return .result(value: "", dialog: "\(ScheduleShortcutReader.missing)") }
        let now = ScheduleShortcutReader.today()
        guard let last = ScheduleShortcutReader.meetings(on: now.date, in: record)?.last else {
            return .result(value: "", dialog: "今天没有课。")
        }
        let end = ScheduleShortcutReader.clock(last.end)
        let dialog = last.end <= now.minute ? "今天的课已经上完了，最后一节「\(last.name)」\(end) 下课。"
            : "今天 \(end) 下课，最后一节是「\(last.name)」\(last.place)。"
        return .result(value: end, dialog: "\(dialog)")
    }
}

@available(iOS 17.0, *)
struct ScheduleTomorrowFirstIntent: AppIntent {
    static let title: LocalizedStringResource = "明天第一节课"
    static let description = IntentDescription("明天几点上第一节课，好定闹钟。")

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        guard let record = ScheduleShortcutReader.record() else { return .result(value: "", dialog: "\(ScheduleShortcutReader.missing)") }
        let now = ScheduleShortcutReader.today()
        guard let tomorrow = ScheduleShortcutReader.date(byAdding: 1, to: now.date) else { return .result(value: "", dialog: "暂时算不出明天的日期。") }
        guard let first = ScheduleShortcutReader.meetings(on: tomorrow, in: record)?.first else {
            return .result(value: "", dialog: "明天没有课。")
        }
        let start = ScheduleShortcutReader.clock(first.start)
        return .result(value: start, dialog: "明天 \(start) 第一节「\(first.name)」\(first.place)。")
    }
}

@available(iOS 17.0, *)
struct ScheduleOpenIntent: AppIntent {
    static let title: LocalizedStringResource = "打开课表"
    static let description = IntentDescription("打开药大拾间的课表。")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ScheduleShortcutRouter.shared.pending = .schedule
        return .result()
    }
}

@available(iOS 17.0, *)
struct ScheduleAddAgendaIntent: AppIntent {
    static let title: LocalizedStringResource = "给这节课记一笔"
    static let description = IntentDescription("打开新建日程，时间定在现在这节或下一节课。")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ScheduleShortcutRouter.shared.pending = .agenda
        return .result()
    }
}

/// What a shortcut that opens the app asked for, picked up by the shell.
@MainActor
final class ScheduleShortcutRouter: ObservableObject {
    enum Action: Equatable { case schedule, agenda }
    static let shared = ScheduleShortcutRouter()
    @Published var pending: Action?

    /// The date and start time a new 日程 from a shortcut gets: the class on
    /// now, else the next one today, else now.
    static func agendaTarget() -> (date: String, start: String?) {
        let now = ScheduleShortcutReader.today()
        guard let record = ScheduleShortcutReader.record(),
              let meetings = ScheduleShortcutReader.meetings(on: now.date, in: record) else { return (now.date, nil) }
        let meeting = ScheduleShortcutReader.current(meetings, minute: now.minute) ?? meetings.first { $0.start > now.minute }
        return (now.date, meeting.map { ScheduleShortcutReader.clock($0.start) })
    }
}

@available(iOS 17.0, *)
struct ScheduleShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ScheduleNowIntent(), phrases: [
            "\(.applicationName) 现在有课吗", "\(.applicationName) 现在在上课吗",
        ], shortTitle: "现在有课吗", systemImageName: "clock")
        AppShortcut(intent: ScheduleNextCourseIntent(), phrases: [
            "\(.applicationName) 下一节课", "\(.applicationName) 下节课是什么",
        ], shortTitle: "下一节课", systemImageName: "forward")
        AppShortcut(intent: ScheduleTodayEndIntent(), phrases: [
            "\(.applicationName) 今天几点下课",
        ], shortTitle: "今天几点下课", systemImageName: "figure.walk.departure")
        AppShortcut(intent: ScheduleTomorrowFirstIntent(), phrases: [
            "\(.applicationName) 明天第一节课", "\(.applicationName) 明天几点上课",
        ], shortTitle: "明天第一节课", systemImageName: "alarm")
        AppShortcut(intent: ScheduleAddAgendaIntent(), phrases: [
            "\(.applicationName) 记作业", "\(.applicationName) 给这节课记一笔",
        ], shortTitle: "记一笔", systemImageName: "square.and.pencil")
    }
}
