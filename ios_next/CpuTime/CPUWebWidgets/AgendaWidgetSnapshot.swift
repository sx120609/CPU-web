import Foundation

// The 日程 widget's data, shared by the app and the widget extension. The app
// (`NativeAgendaWidgetBridge`) writes the coming fortnight of 日程 and the
// open to-dos into the App Group; the widget lists them and, when one is
// ticked off, records the completion in a second file that the app applies
// through the signed-in page the next time it is open. The widget has no
// session of its own, so it never talks to the site.
//
// No notes, reminders or creation details leave the app: titles and places
// only, cut short.

/// What the app wrote for the widget.
nonisolated struct AgendaWidgetSnapshot: Codable, Equatable, Sendable {
    static let fileName = "widget-agenda-v1.json"
    static let pendingFileName = "widget-agenda-done-v1.json"
    static let widgetKind = "cn.cputime.mobile.widget.agenda"
    static let currentVersion = 1
    /// How many days ahead the app writes, today included.
    static let days = 14
    /// The most items written; a widget shows at most a dozen.
    static let limit = 60

    var version: Int
    /// The day the app wrote it, "yyyy-MM-dd" in China time.
    var today: String
    var items: [Item]

    /// One occurrence: a day of a repeating item is its own entry.
    struct Item: Codable, Equatable, Hashable, Identifiable, Sendable {
        /// The item's id, shared by every day of a repeating one.
        var itemID: String
        /// "yyyy-MM-dd", or empty for a to-do without a day.
        var date: String
        var title: String
        var todo: Bool
        /// "HH:mm", or empty for an all-day item.
        var start: String
        var end: String
        var location: String
        var repeats: Bool
        var done: Bool

        var id: String { itemID + "@" + date }
    }
}

/// A tick in the widget, waiting for the app to save it.
nonisolated struct AgendaWidgetCompletion: Codable, Equatable, Hashable, Sendable {
    var itemID: String
    var date: String
    var done: Bool
}

/// Reads and writes the two files in the App Group container.
nonisolated enum AgendaWidgetStore {
    enum State: Equatable {
        case loaded(AgendaWidgetSnapshot)
        /// The app has not written one: signed out, or never opened since the update.
        case missing
        case failed
    }

    static var appGroup: String {
        let configured = Bundle.main.object(forInfoDictionaryKey: "CPUAppGroupIdentifier") as? String
        let value = configured?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? "group.cn.cputime.mobile" : value
    }

    private static func url(_ name: String) -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent(name)
    }

    static func read() -> State {
        guard let url = url(AgendaWidgetSnapshot.fileName), FileManager.default.fileExists(atPath: url.path) else {
            return .missing
        }
        guard let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(AgendaWidgetSnapshot.self, from: data),
              snapshot.version == AgendaWidgetSnapshot.currentVersion else { return .failed }
        return .loaded(snapshot)
    }

    /// Writes the snapshot; nil removes it. Returns whether the file changed,
    /// so the caller reloads the widget only then.
    @discardableResult
    static func write(_ snapshot: AgendaWidgetSnapshot?) -> Bool {
        guard let url = url(AgendaWidgetSnapshot.fileName) else { return false }
        guard let snapshot else {
            guard FileManager.default.fileExists(atPath: url.path) else { return false }
            try? FileManager.default.removeItem(at: url)
            return true
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        guard let data = try? encoder.encode(snapshot) else { return false }
        if let existing = try? Data(contentsOf: url), existing == data { return false }
        do {
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            return false
        }
        return true
    }

    static func pending() -> [AgendaWidgetCompletion] {
        guard let url = url(AgendaWidgetSnapshot.pendingFileName), let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([AgendaWidgetCompletion].self, from: data)) ?? []
    }

    /// Records a tick; a later tick of the same day replaces an earlier one.
    static func addPending(_ completion: AgendaWidgetCompletion) {
        var list = pending().filter { !($0.itemID == completion.itemID && $0.date == completion.date) }
        list.append(completion)
        writePending(Array(list.suffix(100)))
    }

    static func writePending(_ list: [AgendaWidgetCompletion]) {
        guard let url = url(AgendaWidgetSnapshot.pendingFileName) else { return }
        if list.isEmpty {
            try? FileManager.default.removeItem(at: url)
            return
        }
        guard let data = try? JSONEncoder().encode(list) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

/// How the widget sorts, groups and labels the items. Kept apart from the
/// views so ios_next/scripts/check-agenda-widget.sh can run it on its own.
nonisolated enum AgendaWidgetRules {
    enum Group: Int, CaseIterable, Sendable {
        case overdue, today, tomorrow, later, undated

        var title: String {
            switch self {
            case .overdue: "已逾期"
            case .today: "今天"
            case .tomorrow: "明天"
            case .later: "之后"
            case .undated: "待办"
            }
        }
    }

    struct Entry: Equatable, Identifiable, Sendable {
        let item: AgendaWidgetSnapshot.Item
        let group: Group
        var id: String { item.id }
    }

    struct Section: Equatable, Sendable {
        let group: Group
        let entries: [Entry]
    }

    /// The time beside an item. `countdownTo` asks for a running countdown.
    struct Label: Equatable, Sendable {
        var text: String
        var overdue = false
        var countdownTo: Date? = nil
        var inProgress = false
    }

    /// An item without an end takes this long, as on the timetable.
    static let untimedSpan = 45
    /// A start this close gets a running countdown.
    static let countdownMinutes = 60

    /// The items to show at `now`: the pending ticks applied, done ones and
    /// past events left out, sorted and grouped.
    static func entries(_ snapshot: AgendaWidgetSnapshot, pending: [AgendaWidgetCompletion], now: Date) -> [Entry] {
        let today = AgendaWidgetClock.date(now)
        let minutes = AgendaWidgetClock.minutes(now)
        let ticks = Dictionary(pending.map { ($0.itemID + "@" + $0.date, $0.done) }, uniquingKeysWith: { _, last in last })
        let tomorrow = AgendaWidgetClock.adding(1, to: today)
        let candidates: [Entry] = snapshot.items.compactMap { item in
            var item = item
            if let done = ticks[item.id] { item.done = done }
            guard !item.done else { return nil }
            if item.date.isEmpty { return Entry(item: item, group: .undated) }
            if item.date < today {
                // A day gone by: only a one-off all-day item is still owed.
                guard !item.repeats, item.start.isEmpty else { return nil }
                return Entry(item: item, group: .overdue)
            }
            if item.date == today {
                if !item.todo, let end = endMinutes(item), end <= minutes { return nil }
                return Entry(item: item, group: .today)
            }
            return Entry(item: item, group: item.date == tomorrow ? .tomorrow : .later)
        }
        // Keeps the app's order for to-dos without a day (the order they were added).
        let order = Dictionary(snapshot.items.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        return candidates.sorted { a, b in
            if a.group != b.group { return a.group.rawValue < b.group.rawValue }
            if a.item.date != b.item.date { return a.item.date < b.item.date }
            if a.item.start.isEmpty != b.item.start.isEmpty { return a.item.start.isEmpty }
            if a.item.start != b.item.start { return a.item.start < b.item.start }
            return (order[a.id] ?? 0) < (order[b.id] ?? 0)
        }
    }

    static func sections(_ entries: [Entry]) -> [Section] {
        Group.allCases.compactMap { group in
            let items = entries.filter { $0.group == group }
            return items.isEmpty ? nil : Section(group: group, entries: items)
        }
    }

    static func label(for item: AgendaWidgetSnapshot.Item, now: Date) -> Label? {
        let today = AgendaWidgetClock.date(now)
        guard !item.date.isEmpty else { return nil }
        if item.date < today {
            let days = AgendaWidgetClock.days(from: item.date, to: today)
            return Label(text: days <= 1 ? "昨天" : "逾期 \(days) 天", overdue: true)
        }
        let time = item.end.isEmpty || item.start.isEmpty ? item.start : "\(item.start)–\(item.end)"
        if item.date == today {
            guard let start = clock(item.start) else { return Label(text: "今天") }
            let minutes = AgendaWidgetClock.minutes(now)
            if start <= minutes {
                if let end = clock(item.end), end > minutes { return Label(text: "进行中 · 至 \(item.end)", inProgress: true) }
                return Label(text: item.todo ? "已到 \(item.start)" : time, overdue: item.todo)
            }
            if start - minutes <= countdownMinutes {
                return Label(text: time, countdownTo: AgendaWidgetClock.instant(date: item.date, minutes: start))
            }
            return Label(text: time)
        }
        let days = AgendaWidgetClock.days(from: today, to: item.date)
        let day: String
        if days == 1 {
            day = "明天"
        } else if days < 7, let weekday = AgendaWidgetClock.weekday(item.date) {
            day = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][weekday - 1]
        } else {
            day = "\(Int(item.date.dropFirst(5).prefix(2)) ?? 0)月\(Int(item.date.suffix(2)) ?? 0)日"
        }
        return Label(text: item.start.isEmpty ? day : "\(day) \(item.start)")
    }

    /// Today's count and how many are overdue, for headers and lock screens.
    static func counts(_ entries: [Entry]) -> (today: Int, overdue: Int, total: Int) {
        (entries.filter { $0.group == .today }.count, entries.filter { $0.group == .overdue }.count, entries.count)
    }

    /// The moments the list changes: a countdown begins, an item starts or
    /// ends, and the next two midnights. At most 60, from `now`.
    static func timelineDates(_ snapshot: AgendaWidgetSnapshot, pending: [AgendaWidgetCompletion], now: Date) -> [Date] {
        let horizon = now.addingTimeInterval(48 * 3600)
        var dates: Set<Date> = [now]
        for entry in entries(snapshot, pending: pending, now: now) {
            let item = entry.item
            guard let start = clock(item.start), !item.date.isEmpty else { continue }
            let at = AgendaWidgetClock.instant(date: item.date, minutes: start)
            dates.insert(at.addingTimeInterval(TimeInterval(-countdownMinutes * 60)))
            dates.insert(at.addingTimeInterval(1))
            if let end = endMinutes(item) {
                dates.insert(AgendaWidgetClock.instant(date: item.date, minutes: end).addingTimeInterval(1))
            }
        }
        let today = AgendaWidgetClock.date(now)
        for offset in 1...2 {
            dates.insert(AgendaWidgetClock.instant(date: AgendaWidgetClock.adding(offset, to: today), minutes: 0).addingTimeInterval(1))
        }
        return Array(dates.filter { $0 >= now && $0 <= horizon }.sorted().prefix(60))
    }

    private static func clock(_ value: String) -> Int? {
        let parts = value.split(separator: ":")
        guard value.count == 5, parts.count == 2, let hours = Int(parts[0]), let minutes = Int(parts[1]),
              (0...23).contains(hours), (0...59).contains(minutes) else { return nil }
        return hours * 60 + minutes
    }

    private static func endMinutes(_ item: AgendaWidgetSnapshot.Item) -> Int? {
        guard let start = clock(item.start) else { return nil }
        return clock(item.end).flatMap { $0 > start ? $0 : nil } ?? start + untimedSpan
    }
}

/// China time, as 日程 are kept (`NativeAgendaRules`).
nonisolated enum AgendaWidgetClock {
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return calendar
    }()

    static func date(_ now: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    static func minutes(_ now: Date) -> Int {
        let parts = calendar.dateComponents([.hour, .minute], from: now)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }

    static func day(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard value.count == 10, parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func instant(date: String, minutes: Int) -> Date {
        (day(date) ?? Date()).addingTimeInterval(TimeInterval(minutes * 60))
    }

    static func adding(_ days: Int, to value: String) -> String {
        guard let start = day(value), let moved = calendar.date(byAdding: .day, value: days, to: start) else { return value }
        return date(moved)
    }

    static func days(from start: String, to end: String) -> Int {
        guard let from = day(start), let to = day(end) else { return 0 }
        return calendar.dateComponents([.day], from: from, to: to).day ?? 0
    }

    /// 1 = Monday … 7 = Sunday.
    static func weekday(_ value: String) -> Int? {
        guard let start = day(value) else { return nil }
        let weekday = calendar.component(.weekday, from: start)
        return weekday == 1 ? 7 : weekday - 1
    }
}
