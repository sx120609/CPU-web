import Foundation

// Run with ios_next/scripts/check-class-reminders.sh.

private typealias Rules = NativeClassReminderRules
private typealias Meeting = NativeClassReminderRules.Meeting

private func time(_ date: String, _ clock: String) -> Date { ISO8601DateFormatter().date(from: "\(date)T\(clock):00+08:00")! }
private func minutes(_ clock: String) -> Int { Int(clock.prefix(2))! * 60 + Int(clock.suffix(2))! }
private func meeting(_ name: String, _ date: String, _ start: String, _ end: String, room: String? = nil) -> Meeting {
    Meeting(name: name, location: room, date: date, start: minutes(start), end: minutes(end))
}

@main
struct NativeClassReminderChecks {
    static func main() {
        let monday = [
            meeting("药理学", "2026-11-16", "08:20", "09:50", room: "教学楼B102"),
            meeting("诊断学", "2026-11-16", "10:00", "11:30", room: "B5-203"),
            meeting("英语", "2026-11-16", "14:00", "15:30"),
        ]
        let tuesday = [meeting("生理学", "2026-11-17", "08:20", "09:50", room: "A301")]

        // 课前提醒: fifteen minutes ahead, or when the class before lets out.
        let early = Rules.plan([monday, tuesday], lead: 15, now: time("2026-11-16", "07:00"), limit: 14)
        precondition(early.map(\.fire) == [time("2026-11-16", "08:05"), time("2026-11-16", "09:50"), time("2026-11-16", "13:45"), time("2026-11-17", "08:05")])
        precondition(early[0].title == "药理学 · 08:20 上课" && early[0].body == "15 分钟后开始 · B102", "the room is shortened as on the timetable")
        precondition(early[1].body == "10 分钟后开始 · B5-203", "not announced in the middle of the class before")
        precondition(early[2].body == "15 分钟后开始", "no room, no trailing dot")
        precondition(early.map(\.id) == ["2026-11-16.500", "2026-11-16.600", "2026-11-16.840", "2026-11-17.500"])
        // What is already past is left out; a class about to start is still said.
        let midday = Rules.plan([monday, tuesday], lead: 15, now: time("2026-11-16", "09:55"), limit: 14)
        precondition(midday.map(\.start) == [minutes("14:00"), minutes("08:20")])
        // The limit keeps the earliest; 「今天不再提醒」 drops one date only.
        precondition(Rules.plan([monday, tuesday], lead: 15, now: time("2026-11-16", "07:00"), limit: 2).count == 2)
        let skipped = Rules.plan([monday, tuesday], lead: 15, now: time("2026-11-16", "07:00"), limit: 14, skipping: "2026-11-16")
        precondition(skipped.map(\.date) == ["2026-11-17"])
        // Back to back: said the moment the first ends, as starting now.
        let backToBack = Rules.plan([[meeting("甲", "2026-11-16", "08:00", "09:40"), meeting("乙", "2026-11-16", "09:40", "11:20")]],
                                    lead: 30, now: time("2026-11-16", "07:00"), limit: 14)
        precondition(backToBack.map(\.fire) == [time("2026-11-16", "07:30"), time("2026-11-16", "09:40")] && backToBack[1].body == "现在上课")
        // Classes that overlap (two timetables laid together) each get theirs at their own lead.
        let overlapping = Rules.plan([[meeting("甲", "2026-11-16", "08:00", "09:40"), meeting("乙", "2026-11-16", "09:00", "10:00")]],
                                     lead: 15, now: time("2026-11-16", "07:00"), limit: 14)
        precondition(overlapping.map(\.fire) == [time("2026-11-16", "07:45"), time("2026-11-16", "08:45")])
        precondition(Rules.normalizedLead(10) == 10 && Rules.normalizedLead(7) == 15 && Rules.normalizedLead(0) == 15)
        precondition(Rules.plan([], lead: 15, now: .now, limit: 14).isEmpty)

        // When both are free: outside either's classes, half an hour at least, from now on.
        let theirs = [meeting("药理学", "2026-11-16", "08:20", "09:50"), meeting("统计学", "2026-11-16", "15:40", "17:10")]
        let free = Rules.sharedFree(mine: monday, theirs: theirs)
        precondition(free.map(\.text) == ["11:30–14:00", "17:10–22:30"], "08:00–08:20 and the ten minutes between classes are too short")
        precondition(Rules.sharedFree(mine: monday, theirs: theirs, from: minutes("12:10")).map(\.text) == ["12:10–14:00", "17:10–22:30"])
        precondition(Rules.sharedFree(mine: monday, theirs: theirs, from: minutes("22:15")).isEmpty)
        precondition(Rules.sharedFree(mine: [], theirs: []).map(\.text) == ["08:00–22:30"])
        precondition(Rules.sharedFree(mine: [meeting("通宵", "2026-11-16", "07:00", "23:00")], theirs: []).isEmpty)

        // A class both take: same name, spaces aside, at the same clock times.
        precondition(Rules.isTogether(monday[0], with: theirs))
        precondition(Rules.isTogether(meeting("药 理 学", "2026-11-16", "08:20", "09:50"), with: theirs))
        precondition(!Rules.isTogether(monday[1], with: theirs) && !Rules.isTogether(meeting("药理学", "2026-11-16", "08:00", "09:40"), with: theirs),
                     "another school's 08:00 is not this 08:20, whatever the period number")

        // 「TA 下课了」: once per run of classes, saying until when both are free.
        let partner = [[
            meeting("药理学", "2026-11-16", "08:20", "09:50"), meeting("诊断学", "2026-11-16", "10:00", "11:30"),
            meeting("统计学", "2026-11-16", "15:40", "17:10"),
        ]]
        let notices = Rules.partnerPlan(partner, mine: [monday], name: "小满", now: time("2026-11-16", "07:00"), limit: 8)
        precondition(notices.map(\.fire) == [time("2026-11-16", "11:30"), time("2026-11-16", "17:10")], "a morning of two classes says it once")
        precondition(notices[0].title == "小满 下课了" && notices[0].body == "刚上完「药理学、诊断学」，你们都有空到 14:00")
        precondition(notices[1].body == "刚上完「统计学」，今天你们都没课了")
        // The user still in class when the partner gets out.
        let busy = Rules.partnerPlan([[meeting("体育", "2026-11-16", "14:00", "14:40")]], mine: [monday], name: "TA", now: time("2026-11-16", "07:00"), limit: 8)
        precondition(busy[0].body == "刚上完「体育」，你还在上课")
        // Past runs are left out and the limit keeps the earliest.
        precondition(Rules.partnerPlan(partner, mine: [monday], name: "TA", now: time("2026-11-16", "12:00"), limit: 8).map(\.start) == [minutes("17:10")])
        precondition(Rules.partnerPlan(partner, mine: [monday], name: "TA", now: time("2026-11-16", "07:00"), limit: 1).count == 1)

        // The watch's 日程: this watch's ticks over the phone's list, until the list agrees.
        let agenda = WatchAgenda(today: "2026-11-16", items: [
            .init(itemID: "a", date: "2026-11-16", title: "交实验报告", todo: true, start: "", end: "", location: "", done: false),
            .init(itemID: "b", date: "2026-11-17", title: "组会", todo: false, start: "14:00", end: "15:30", location: "302", done: false),
            .init(itemID: "c", date: "", title: "买书", todo: true, start: "", end: "", location: "", done: false),
            .init(itemID: "exam:1f", date: "2026-11-20", title: "考试 · 药理学", todo: false, start: "09:30", end: "11:30", location: "", done: false),
            .init(itemID: "d", date: "2026-11-14", title: "还书", todo: true, start: "", end: "", location: "", done: false),
        ])
        let ticked = agenda.applying(["a@2026-11-16": true, "zz@": true])
        precondition(ticked.items.map(\.done) == [true, false, false, false, false])
        precondition(agenda.unsettled(["a@2026-11-16": true, "zz@": true]) == ["a@2026-11-16": true], "a tick for an item no longer listed is dropped")
        precondition(ticked.unsettled(["a@2026-11-16": true]).isEmpty, "once the phone's list shows it, the tick is settled")
        precondition(agenda.sections(today: "2026-11-16", tomorrow: "2026-11-17").map(\.title) == ["已过日期", "今天", "明天", "之后", "待办"])
        precondition(agenda.sections(today: "2026-11-17", tomorrow: "2026-11-18").map(\.title) == ["已过日期", "今天", "之后", "待办"], "the watch's own day, not the list's")
        precondition(!agenda.items[3].tickable && agenda.items[0].tickable, "an exam is shown but not ticked")
        precondition(agenda.items[1].timeText == "14:00–15:30" && agenda.items[0].timeText.isEmpty)
        let coded = WatchAgenda.decode(agenda.encoded()!)
        precondition(coded == agenda && WatchAgenda.decode(Data("nope".utf8)) == nil)
        let long = WatchAgenda(today: "2026-11-16", items: (0..<60).map { .init(itemID: "i\($0)", date: "", title: "t", todo: true, start: "", end: "", location: "", done: false) })
        precondition(WatchAgenda.decode(long.encoded()!)!.items.count == WatchAgenda.limit)

        print("NativeClassReminderChecks passed")
    }
}
