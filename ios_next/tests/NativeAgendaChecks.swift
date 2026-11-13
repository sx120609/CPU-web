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
        // Beside a class it is a thin bar on the class's right border; in free time it spans the column.
        precondition(abs(chips[0].frame(columnWidth: 60).maxX - 59.5) < 0.001
                     && chips[0].frame(columnWidth: 60).width == NativeAgendaChip.besideWidth
                     && chips[1].frame(columnWidth: 60).width == 58)
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
        // 日程 for the Live Activities: with a time, not ticked off, still ahead, each day of a repeating one.
        let liveNow = ISO8601DateFormatter().date(from: "2026-10-21T02:00:00Z")!   // 10:00 in China
        func chinaTime(_ date: String, _ clock: String) -> Date { ISO8601DateFormatter().date(from: "\(date)T\(clock):00+08:00")! }
        let liveItems = [
            NativeAgendaItem(id: "组会/1", title: "组会", date: "2026-10-21", start: "14:00", end: "15:30", location: "药学楼 302"),
            NativeAgendaItem(id: "no-end", title: "交报告", date: "2026-10-21", start: "18:00"),
            NativeAgendaItem(id: "bad-end", title: "讲座", date: "2026-10-22", start: "19:00", end: "18:00"),
            NativeAgendaItem(id: "allday", title: "校庆", date: "2026-10-21"),
            NativeAgendaItem(id: "todo", kind: "todo", title: "领实验服", date: "2026-10-21"),
            NativeAgendaItem(id: "done", title: "已做完", date: "2026-10-21", start: "16:00", done: true),
            NativeAgendaItem(id: "morning", title: "早读", date: "2026-10-21", start: "07:00", end: "07:40"),
            NativeAgendaItem(id: "run", title: "晨跑", date: "2026-10-19", start: "06:30", end: "07:00", repeatRule: "daily",
                             until: "2026-10-23", doneDates: ["2026-10-22"]),
            NativeAgendaItem(id: "far", title: "下个月", date: "2026-11-21", start: "09:00"),
        ]
        let live = NativeAgendaRules.activities(liveItems, now: liveNow)
        precondition(live.map(\.title) == ["组会", "交报告", "讲座", "晨跑"],
                     "all-day items, to-dos without a time, ticked-off, finished and far-off ones are left out: \(live.map(\.title))")
        precondition(live[0].start == chinaTime("2026-10-21", "14:00") && live[0].end == chinaTime("2026-10-21", "15:30"))
        precondition(live[0].id == "agenda-___1-20261021" && live[0].itemID == "组会/1", "the identity is safe to send: \(live[0].id)")
        precondition(live[1].end == nil && live[2].end == nil, "no end, or an end before the start, is no end")
        // The daily run: today's is over, tomorrow's is ticked off, the day after is the last before `until`.
        precondition(live[3].date == "2026-10-23" && live[3].id == "agenda-run-20261023")
        precondition(NativeAgendaRules.activities(liveItems, now: chinaTime("2026-10-21", "06:00")).filter { $0.itemID == "run" }.map(\.date)
                        == ["2026-10-21", "2026-10-23"])
        precondition(NativeAgendaRules.activities(liveItems, now: liveNow, limit: 2).count == 2)
        let twins = [NativeAgendaItem(id: "a/b", title: "一", date: "2026-10-21", start: "12:00"),
                     NativeAgendaItem(id: "a_b", title: "二", date: "2026-10-21", start: "13:00")]
        precondition(NativeAgendaRules.activities(twins, now: liveNow).map(\.title) == ["一"], "identities are unique after being made safe")

        // 考试安排: 教务's time text, each school's own way of writing it.
        precondition(NativeExamRules.parse("2026-07-08(09:00-12:00)") == .init(date: "2026-07-08", start: "09:00", end: "12:00"), "南医")
        precondition(NativeExamRules.parse("2027-01-05 09:30~11:30") == .init(date: "2027-01-05", start: "09:30", end: "11:30"), "南中医")
        precondition(NativeExamRules.parse("2027年1月5日 9：30") == .init(date: "2027-01-05", start: "09:30", end: ""))
        precondition(NativeExamRules.parse("2027/1/5") == .init(date: "2027-01-05", start: "", end: ""))
        precondition(NativeExamRules.parse("2027-01-05 14:00:00-13:00:00") == .init(date: "2027-01-05", start: "14:00", end: ""), "an end before the start is no end")
        precondition(NativeExamRules.parse("") == nil && NativeExamRules.parse("第18周") == nil && NativeExamRules.parse("2027-02-30 09:00") == nil)
        let exams = [
            NativeExam(courseName: "药理学", examTime: "2026-10-22 09:30~11:30", location: "仙林校区 B11-209", seat: "23", examType: "期末考试", semester: "2026-2027-1"),
            NativeExam(courseName: "诊断学", examTime: "2026-10-21(14:00-16:00)", location: "江宁校区 博学楼", examName: "2026-2027学年第一学期期末考试"),
            NativeExam(courseName: "统计学", examTime: ""),
            NativeExam(courseName: "生理学", examTime: "2026-10-01 09:00~11:00"),
            NativeExam(courseName: "解剖学", examTime: "2026-09-20 09:00~11:00"),
        ]
        precondition(NativeExamRules.ordered(exams, today: "2026-10-21").map(\.courseName) == ["诊断学", "药理学", "统计学", "生理学", "解剖学"],
                     "ahead soonest first, then the undated, then the past newest first")
        let examItems = NativeExamRules.agendaItems(exams + [exams[0]], today: "2026-10-21")
        precondition(examItems.map(\.title) == ["考试 · 药理学", "考试 · 诊断学"], "only dated exams still ahead, each once")
        precondition(examItems[0].start == "09:30" && examItems[0].end == "11:30" && examItems[0].location == "仙林校区 B11-209 · 座位 23")
        precondition(examItems[0].remind == 1440 && examItems[0].kind == "event" && examItems[1].note == "期末考试", "南医's long title is cut to the kind")
        precondition(examItems.allSatisfy { NativeExamRules.isExam($0.id) } && !NativeExamRules.isExam("ab12"))
        precondition(exams[0].id == NativeExam(courseName: "药理学", examTime: "2026-10-22 09:30~11:30", semester: "2026-2027-1").id, "the same arrangement is the same exam")
        precondition(exams[0].id != NativeExam(courseName: "药理学", examTime: "2026-10-23 09:30~11:30", semester: "2026-2027-1").id, "a moved exam is a new one")
        precondition(NativeExamRules.countdown("2026-10-21", today: "2026-10-21") == "今天" && NativeExamRules.countdown("2026-10-22", today: "2026-10-21") == "明天")
        precondition(NativeExamRules.countdown("2026-11-01", today: "2026-10-21") == "11 天后" && NativeExamRules.countdown("2026-10-01", today: "2026-10-21") == "已结束")
        // They are drawn and reminded of like any 日程: on the day, and a day ahead.
        precondition(NativeAgendaRules.on(examItems, date: "2026-10-22").map(\.item.title) == ["考试 · 药理学"])
        let examReminders = NativeAgendaRules.reminders(examItems, from: chinaTime("2026-10-20", "08:00"), until: chinaTime("2026-11-20", "08:00"), limit: 10)
        precondition(examReminders.map(\.at) == [chinaTime("2026-10-20", "14:00"), chinaTime("2026-10-21", "09:30")])
        // A row with a field missing or of another type still reads; one without a course is dropped by the caller.
        let loose = try! JSONDecoder().decode([NativeExam].self, from: Data(#"[{"courseName":" 药理学 ","examTime":null,"seat":12},{}]"#.utf8))
        precondition(loose[0].courseName == "药理学" && loose[0].examTime.isEmpty && loose[0].seat.isEmpty && loose[1].courseName.isEmpty)

        // 作业: a to-do tied to its course by its title.
        let homeworkItems = [
            NativeAgendaItem(id: "h1", kind: "todo", title: "药理学：第三章习题", date: "2026-10-28", createdAt: 2),
            NativeAgendaItem(id: "h2", kind: "todo", title: "药理学: 实验报告", date: "2026-10-23", createdAt: 3),
            NativeAgendaItem(id: "h3", kind: "todo", title: "药理学：预习", createdAt: 1),
            NativeAgendaItem(id: "h4", kind: "todo", title: "药理学：交过了", date: "2026-10-20", done: true),
            NativeAgendaItem(id: "h5", kind: "todo", title: "药理学实验：报告", date: "2026-10-22"),
            NativeAgendaItem(id: "h6", kind: "event", title: "药理学：答疑", date: "2026-10-22", start: "19:00"),
        ]
        precondition(NativeAgendaRules.homework(homeworkItems, course: " 药理学 ").map(\.id) == ["h2", "h1", "h3"],
                     "open to-dos of that course only, due soonest first, undated last")
        precondition(NativeAgendaRules.homework(homeworkItems, course: "药理学实验").map(\.id) == ["h5"] && NativeAgendaRules.homework(homeworkItems, course: "").isEmpty)
        let draft = NativeAgendaRules.homeworkDraft(course: "药理学", due: "2026-10-28", start: "14:00")
        precondition(draft.id.isEmpty && draft.kind == "todo" && draft.title == "药理学：" && draft.date == "2026-10-28" && draft.start == "14:00" && draft.remind == 1440)
        let undated = NativeAgendaRules.homeworkDraft(course: "药理学", due: "", start: "14:00")
        precondition(undated.date.isEmpty && undated.start.isEmpty && undated.remind == -1, "no later meeting: no day, no reminder")
        let meetings = [(date: "2026-10-21", start: "14:00"), (date: "2026-10-28", start: "14:00"), (date: "2026-10-23", start: "08:00")]
        precondition(NativeAgendaRules.nextMeeting(meetings, after: "2026-10-21")! == (date: "2026-10-23", start: "08:00"))
        precondition(NativeAgendaRules.nextMeeting(meetings, after: "2026-10-28") == nil)

        print("NativeAgendaChecks passed")
    }
}
