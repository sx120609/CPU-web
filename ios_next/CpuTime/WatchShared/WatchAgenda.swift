import Foundation

/// The 日程 the watch lists and ticks off: the next week's items and the to-dos without a day,
/// as the phone holds them. The phone sends the list (`agenda.list`); a tick made on the watch
/// travels back (`agenda.tick`) and joins the ticks the home-screen widget leaves for the app,
/// so it is saved the same way, the next time the app has its signed-in page.
nonisolated struct WatchAgenda: Codable, Equatable, Sendable {
    struct Item: Codable, Equatable, Identifiable, Sendable {
        var itemID: String
        /// "yyyy-MM-dd", or empty for a to-do without a day.
        var date: String
        var title: String
        var todo: Bool
        /// "HH:mm" or empty.
        var start: String
        var end: String
        var location: String
        var done: Bool

        var id: String { itemID + "@" + date }
        /// 教务's exam arrangements are shown but are not the user's to tick off.
        var tickable: Bool { !itemID.hasPrefix("exam:") }
        var timeText: String { start.isEmpty ? "" : end.isEmpty ? start : "\(start)–\(end)" }
    }

    static let days = 7
    static let limit = 40

    /// The day the phone made the list on, "yyyy-MM-dd".
    var today: String
    var items: [Item]

    func encoded() -> Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return try? encoder.encode(self)
    }

    static func decode(_ data: Data) -> WatchAgenda? {
        guard data.count <= 64 * 1024, let agenda = try? JSONDecoder().decode(WatchAgenda.self, from: data) else { return nil }
        return WatchAgenda(today: agenda.today, items: Array(agenda.items.prefix(limit)))
    }

    /// The list with the ticks made on this watch laid over it.
    func applying(_ ticks: [String: Bool]) -> WatchAgenda {
        WatchAgenda(today: today, items: items.map { item in
            var item = item
            if let done = ticks[item.id] { item.done = done }
            return item
        })
    }

    /// The ticks the phone has not taken in yet: those the list still disagrees with.
    func unsettled(_ ticks: [String: Bool]) -> [String: Bool] {
        let state = Dictionary(items.map { ($0.id, $0.done) }, uniquingKeysWith: { first, _ in first })
        return ticks.filter { state[$0.key] != nil && state[$0.key] != $0.value }
    }

    struct Section: Equatable, Identifiable, Sendable {
        let title: String
        let items: [Item]
        var id: String { title }
    }

    /// Today, tomorrow, the days after, then the to-dos without a day. `today` is the watch's
    /// own date: the list may be a day old.
    func sections(today: String, tomorrow: String) -> [Section] {
        let dated = items.filter { !$0.date.isEmpty && $0.date >= today }
            .sorted { ($0.date, $0.start.isEmpty ? "00:00" : $0.start) < ($1.date, $1.start.isEmpty ? "00:00" : $1.start) }
        let overdue = items.filter { !$0.date.isEmpty && $0.date < today && !$0.done && $0.todo }
        return [
            Section(title: "已过日期", items: overdue),
            Section(title: "今天", items: dated.filter { $0.date == today }),
            Section(title: "明天", items: dated.filter { $0.date == tomorrow }),
            Section(title: "之后", items: dated.filter { $0.date > tomorrow }),
            Section(title: "待办", items: items.filter { $0.date.isEmpty }),
        ].filter { !$0.items.isEmpty }
    }
}
