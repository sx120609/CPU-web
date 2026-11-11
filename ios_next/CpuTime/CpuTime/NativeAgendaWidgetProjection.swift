import Foundation

/// What the 日程 widget may show (`AgendaWidgetSnapshot`), from the list the
/// app reads through its page. Kept apart from `NativeAgendaWidgetBridge` so
/// ios_next/scripts/check-agenda-widget.sh can run it on its own.
enum NativeAgendaWidgetProjection {
    /// What the widget may show: overdue and undated to-dos, then every
    /// occurrence of the coming fortnight still to do, earliest first.
    static func snapshot(_ items: [NativeAgendaItem], now: Date) -> AgendaWidgetSnapshot {
        let today = NativeAgendaRules.today(now)
        let base = NativeAgendaRules.dayNumber(today) ?? 0
        func entry(_ item: NativeAgendaItem, date: String) -> AgendaWidgetSnapshot.Item {
            AgendaWidgetSnapshot.Item(
                itemID: item.id, date: date, title: String(item.title.prefix(60)), todo: item.kind == "todo",
                start: date.isEmpty ? "" : item.start, end: date.isEmpty ? "" : item.end,
                location: String(item.location.prefix(30)), repeats: item.repeats, done: false
            )
        }
        let open = NativeAgendaRules.openTodos(items, today: today)
        let overdue = open.filter { !$0.date.isEmpty }.map { entry($0, date: $0.date) }
        let undated = open.filter { $0.date.isEmpty }.map { entry($0, date: "") }
        var dated: [AgendaWidgetSnapshot.Item] = []
        for offset in 0..<AgendaWidgetSnapshot.days {
            let date = NativeAgendaRules.date(ofDay: base + offset)
            dated += NativeAgendaRules.on(items, date: date).filter { !$0.done }.map { entry($0.item, date: date) }
        }
        // Overdue first, then the days in order, then the to-dos without a day; cut at the limit
        // from the far end, so the nearest days always fit.
        var list = overdue + dated
        let room = max(0, AgendaWidgetSnapshot.limit - list.count)
        list = Array(list.prefix(AgendaWidgetSnapshot.limit)) + Array(undated.prefix(room))
        return AgendaWidgetSnapshot(version: AgendaWidgetSnapshot.currentVersion, today: today, items: list)
    }
}
