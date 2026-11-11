import Foundation

// Run with ios_next/scripts/check-agenda-widget.sh: what the 日程 widget is
// given (`NativeAgendaWidgetProjection`) and how it sorts, labels and times
// the list (`AgendaWidgetRules`).

private func item(_ id: String, _ title: String, kind: String = "event", date: String = "", start: String = "",
                  end: String = "", repeatRule: String = "none", done: Bool = false, doneDates: [String] = [],
                  createdAt: Double = 0) -> NativeAgendaItem {
    NativeAgendaItem(id: id, kind: kind, title: title, date: date, start: start, end: end, repeatRule: repeatRule,
                     done: done, doneDates: doneDates, createdAt: createdAt)
}

/// 2026-11-11 (a Wednesday) at `time`, China time.
private func at(_ time: String, day: String = "2026-11-11") -> Date {
    let minutes = (Int(time.prefix(2)) ?? 0) * 60 + (Int(time.suffix(2)) ?? 0)
    return AgendaWidgetClock.instant(date: day, minutes: minutes)
}

@main
struct AgendaWidgetChecks {
    static func main() {
        let items = [
            item("late00000001", "交实验报告", kind: "todo", date: "2026-11-09", createdAt: 1),
            item("donelate0001", "已交的表", kind: "todo", date: "2026-11-08", done: true, createdAt: 2),
            item("undated00001", "给导员交材料", kind: "todo", createdAt: 3),
            item("undated00002", "买实验服", kind: "todo", createdAt: 4),
            item("meeting00001", "组会", date: "2026-11-11", start: "14:00", end: "15:30", createdAt: 5),
            item("morning00001", "早读", date: "2026-11-11", start: "08:00", createdAt: 6),
            item("allday000001", "领教材", date: "2026-11-11", createdAt: 7),
            item("weekly000001", "羽毛球", date: "2026-11-02", start: "19:00", end: "20:30", repeatRule: "weekly",
                 doneDates: ["2026-11-02"], createdAt: 8),
            item("tomorrow0001", "复习", date: "2026-11-12", start: "14:00", createdAt: 9),
            item("faraway00001", "很远的事", date: "2026-12-30", createdAt: 10),
        ]

        // The projection: open to-dos first, then a fortnight of days, then the undated;
        // done ones and days beyond the fortnight left out, and no notes.
        let snapshot = NativeAgendaWidgetProjection.snapshot(items, now: at("09:00"))
        precondition(snapshot.today == "2026-11-11")
        precondition(snapshot.items.first?.itemID == "late00000001")
        precondition(!snapshot.items.contains { $0.itemID == "donelate0001" || $0.itemID == "faraway00001" })
        precondition(snapshot.items.suffix(2).map(\.itemID) == ["undated00001", "undated00002"])
        // A weekly item is one entry per day: the 9th was ticked, the 16th, 23rd are still to do.
        precondition(snapshot.items.filter { $0.itemID == "weekly000001" }.map(\.date) == ["2026-11-16", "2026-11-23"])
        precondition(snapshot.items.allSatisfy { !$0.done })

        // Sorting and groups at 09:00: the morning item is over (no end: 45 minutes).
        let entries = AgendaWidgetRules.entries(snapshot, pending: [], now: at("09:00"))
        precondition(entries.map(\.item.itemID) == [
            "late00000001", "allday000001", "meeting00001", "tomorrow0001", "weekly000001", "weekly000001",
            "undated00001", "undated00002",
        ], "\(entries.map(\.item.itemID))")
        precondition(entries.map(\.group) == [.overdue, .today, .today, .tomorrow, .later, .later, .undated, .undated])
        let counts = AgendaWidgetRules.counts(entries)
        precondition(counts.today == 2 && counts.overdue == 1 && counts.total == 8)

        // A tick on the widget hides the item at once, until the app saves it.
        let ticked = AgendaWidgetRules.entries(snapshot, pending: [AgendaWidgetCompletion(itemID: "meeting00001",
                                                                                           date: "2026-11-11", done: true)],
                                               now: at("09:00"))
        precondition(!ticked.contains { $0.item.itemID == "meeting00001" })

        // Labels: overdue by days, a countdown in the last hour, then in progress, tomorrow, weekdays.
        func label(_ id: String, _ time: String, date: String? = nil) -> AgendaWidgetRules.Label? {
            let entry = snapshot.items.first { $0.itemID == id && (date == nil || $0.date == date) }!
            return AgendaWidgetRules.label(for: entry, now: at(time))
        }
        precondition(label("late00000001", "09:00") == .init(text: "逾期 2 天", overdue: true))
        precondition(label("meeting00001", "10:00") == .init(text: "14:00–15:30"))
        precondition(label("meeting00001", "13:30")?.countdownTo == at("14:00"))
        precondition(label("meeting00001", "14:30") == .init(text: "进行中 · 至 15:30", inProgress: true))
        precondition(label("tomorrow0001", "09:00") == .init(text: "明天 14:00"))
        precondition(label("weekly000001", "09:00", date: "2026-11-16") == .init(text: "周一 19:00"))
        precondition(label("weekly000001", "09:00", date: "2026-11-23") == .init(text: "11月23日 19:00"))
        precondition(label("undated00001", "09:00") == nil)
        // After 15:30 the meeting is gone; an all-day item stays all day.
        let evening = AgendaWidgetRules.entries(snapshot, pending: [], now: at("16:00"))
        precondition(!evening.contains { $0.item.itemID == "meeting00001" })
        precondition(evening.contains { $0.item.itemID == "allday000001" })

        // Read the next day without the app: yesterday's one-off all-day item is owed, events are past.
        let nextDay = AgendaWidgetRules.entries(snapshot, pending: [], now: at("09:00", day: "2026-11-12"))
        precondition(nextDay.first { $0.item.itemID == "allday000001" }?.group == .overdue)
        precondition(!nextDay.contains { $0.item.itemID == "meeting00001" })

        // The timeline: now, the hour before each start, each start and end, and the next two midnights.
        let dates = AgendaWidgetRules.timelineDates(snapshot, pending: [], now: at("09:00"))
        precondition(dates.first == at("09:00"))
        precondition(dates.contains(at("13:00")) && dates.contains(at("14:00").addingTimeInterval(1))
                     && dates.contains(at("15:30").addingTimeInterval(1)))
        precondition(dates.contains(at("00:00", day: "2026-11-12").addingTimeInterval(1)))
        precondition(dates == dates.sorted() && dates.count <= 60)
        precondition(dates.allSatisfy { $0 <= at("09:00").addingTimeInterval(48 * 3600) })

        print("agenda widget checks passed")
    }
}
