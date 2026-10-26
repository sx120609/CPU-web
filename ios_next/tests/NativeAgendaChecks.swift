import Foundation

// Run with ios_next/scripts/check-agenda.sh. The cases are HarmonyOS's
// (harmony/tests/agenda.test.mjs) and the server's (server/tests/agenda.test.ts).

private func item(_ id: String, _ title: String, date: String = "", start: String = "", end: String = "",
                  location: String = "", remind: Int = -1, repeatRule: String = "none",
                  doneDates: [String] = [], createdAt: Double = 0) -> NativeAgendaItem {
    NativeAgendaItem(id: id, title: title, date: date, start: start, end: end, location: location, remind: remind,
                     repeatRule: repeatRule, doneDates: doneDates, createdAt: createdAt)
}

@main
struct NativeAgendaChecks {
    static func main() {
        // Dates in days since 1970-01-01, both ways.
        precondition(NativeAgendaRules.dayNumber("1970-01-01") == 0)
        precondition(NativeAgendaRules.dayNumber("1969-12-31") == -1)
        precondition(NativeAgendaRules.dayNumber("2026-10-21") == 20_747)
        precondition(NativeAgendaRules.date(ofDay: 20_747) == "2026-10-21")
        precondition(NativeAgendaRules.date(ofDay: -1) == "1969-12-31")
        precondition(NativeAgendaRules.dayNumber("2026-02-29") == nil && NativeAgendaRules.dayNumber("2028-02-29") != nil)
        precondition(NativeAgendaRules.dayNumber("2026-1-01") == nil && NativeAgendaRules.dayNumber("") == nil)
        precondition(NativeAgendaRules.weekday("2026-10-21") == 3 && NativeAgendaRules.weekday("2026-10-25") == 7)
        precondition(NativeAgendaRules.minutes("08:05") == 485 && NativeAgendaRules.minutes("24:00") == nil
                     && NativeAgendaRules.minutes("8:05") == nil)

        // A day lists all-day items first, repeats by their rule and ticks repeats by day.
        // 2026-10-01 is a Thursday; the 21st a Wednesday, the 22nd a Thursday.
        let items = [
            item("evening00001", "晚课", date: "2026-10-21", start: "19:00", createdAt: 1),
            item("allday000001", "交表", date: "2026-10-21", createdAt: 2),
            item("weekly000001", "羽毛球", date: "2026-10-01", start: "07:00", repeatRule: "weekly", doneDates: ["2026-10-15"]),
        ]
        precondition(NativeAgendaRules.on(items, date: "2026-10-21").map(\.item.id) == ["allday000001", "evening00001"])
        let thursday = NativeAgendaRules.on(items, date: "2026-10-22")
        precondition(thursday.map(\.item.id) == ["weekly000001"] && !thursday[0].done)
        precondition(NativeAgendaRules.on(items, date: "2026-10-15").first?.done == true)
        precondition(NativeAgendaRules.headerDot(items, date: "2026-10-21"))
        precondition(!NativeAgendaRules.headerDot(items, date: "2026-10-22"))
        let monthly = item("monthly00001", "交房租", date: "2026-01-31", repeatRule: "monthly")
        precondition(!NativeAgendaRules.occurs(monthly, on: "2026-02-28") && NativeAgendaRules.occurs(monthly, on: "2026-03-31"))
        let weekdays = item("weekday00001", "早读", date: "2026-10-19", repeatRule: "weekdays")
        precondition(NativeAgendaRules.occurs(weekdays, on: "2026-10-23") && !NativeAgendaRules.occurs(weekdays, on: "2026-10-24"))
        var ended = weekdays
        ended.until = "2026-10-21"
        precondition(!NativeAgendaRules.occurs(ended, on: "2026-10-22"))

        // Week chips sit at their clock time and keep beside a class.
        let periods = [
            NativeSchedulePeriod(number: 1, startTime: "08:00", endTime: "08:45"),
            NativeSchedulePeriod(number: 2, startTime: "08:55", endTime: "09:40"),
            NativeSchedulePeriod(number: 3, startTime: "13:30", endTime: "14:15"),
        ]
        let chips = NativeAgendaRules.chips([
            item("morning00001", "早读", date: "2026-10-21", start: "08:22", end: "08:45"),
            item("lunch0000001", "午饭", date: "2026-10-21", start: "12:00"),
        ], date: "2026-10-21", rows: periods, rowHeight: 50, gap: 4, courses: [1...1])
        precondition(chips.count == 2)
        precondition(abs(chips[0].y - 50 * 22 / 45) < 0.01 && chips[0].beside)
        // In the lunch break, after period 2: across the gap before period 3, clear of the class.
        precondition(!chips[1].beside && chips[1].y >= 104 && chips[1].y <= 108 && chips[1].height >= 20)
        precondition(abs(chips[0].frame(columnWidth: 60).maxX - 59) < 0.001 && chips[1].frame(columnWidth: 60).width == 58)
        // Before the first period it is pinned onto period 1, so it keeps beside the class there.
        let early = NativeAgendaRules.chips([item("run000000001", "晨跑", date: "2026-10-21", start: "07:00", end: "07:40")],
                                            date: "2026-10-21", rows: periods, rowHeight: 50, gap: 4, courses: [1...1])
        precondition(early.count == 1 && early[0].y == 0 && early[0].beside)

        // Reminders fire before each open occurrence. "Now" is 2026-10-19 06:44 China time.
        let now = Date(timeIntervalSince1970: 1_792_363_440)
        let meeting = item("meeting00001", "组会", date: "2026-10-19", start: "15:00", location: "药学楼", remind: 15)
        let first = NativeAgendaRules.reminders([meeting], from: now, until: now.addingTimeInterval(86_400), limit: 30)
        precondition(first.count == 1 && first[0].at == Date(timeIntervalSince1970: 1_792_392_300))
        precondition(first[0].title == "日程提醒 · 组会" && first[0].text == "15:00 · 药学楼")
        var finished = meeting
        finished.done = true
        precondition(NativeAgendaRules.reminders([finished], from: now, until: now.addingTimeInterval(86_400), limit: 30).isEmpty)
        // 07:00 today is still ahead of 06:44; the 20th was ticked off.
        let daily = item("daily0000001", "背单词", date: "2026-10-01", start: "07:00", remind: 0, repeatRule: "daily",
                         doneDates: ["2026-10-20"])
        let days = NativeAgendaRules.reminders([daily], from: now, until: now.addingTimeInterval(3 * 86_400), limit: 30)
        precondition(days.map(\.date) == ["2026-10-19", "2026-10-21"])
        precondition(days[1].text == "10月21日 · 07:00")

        // Bridge items decode leniently and come out safe to draw; `repeat` keeps its name.
        let raw = #"{"id":"abcdef123456","title":"组会","date":"2026-13-01","start":"9:00","repeat":"weekly","remind":15,"doneDates":["2026-10-01","bad"]}"#
        let decoded = try! JSONDecoder().decode(NativeAgendaItem.self, from: Data(raw.utf8)).sanitized!
        precondition(decoded.date == "" && decoded.start == "" && decoded.repeatRule == "weekly" && decoded.remind == 15)
        precondition(decoded.doneDates == ["2026-10-01"] && decoded.kind == "event" && !decoded.done)
        precondition(try! JSONDecoder().decode(NativeAgendaItem.self, from: Data(#"{"id":"abcdef123456"}"#.utf8)).sanitized == nil)
        let encoded = String(decoding: try! JSONEncoder().encode(decoded), as: UTF8.self)
        precondition(encoded.contains(#""repeat":"weekly""#) && !encoded.contains("repeatRule"))
        // Still to do: past to-dos left unticked (oldest first), then the undated ones in the order added.
        let todos = [item("undated02", "b", createdAt: 2), item("undated01", "a", createdAt: 1),
                     item("late0002", "c", date: "2026-10-24"), item("late0001", "d", date: "2026-10-20"),
                     item("timed001", "e", date: "2026-10-20", start: "09:00"), item("today001", "f", date: "2026-10-26")]
        precondition(NativeAgendaRules.openTodos(todos, today: "2026-10-26").map(\.id) == ["late0001", "late0002", "undated01", "undated02"])
        print("NativeAgendaChecks passed")
    }
}
