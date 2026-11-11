import Foundation

// Run with ios_next/scripts/check-dorm-schedule.sh. The fixtures and expected
// values are the Web's (`web/tests/dormSchedule.test.ts`, `dormWeek.test.ts`
// and `nativeDormSync.test.ts`) and Android's (`DormScheduleParityTest`), so
// the three clients agree on every free block, early class and cell.

private func check(_ condition: @autoclosure () -> Bool, _ message: String, line: Int = #line) {
    if !condition() {
        print("dorm check failed (line \(line)): \(message)")
        exit(1)
    }
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ message: String = "", line: Int = #line) {
    check(actual == expected, "\(message) expected \(expected), got \(actual)", line: line)
}

// MARK: Fixtures, as the Web tests build them

private func days(_ monday: String) -> [String] { (0..<7).map { DormRules.addDays(monday, $0) } }

private func calendar(periods: [[String: Any]]? = nil) -> [String: Any] {
    let weeks = [1, 2].map { week -> [String: Any] in
        let list = days(week == 1 ? "2026-09-07" : "2026-09-14")
        return ["week": week, "days": list, "monday": list[0], "sunday": list[6]]
    }
    var value: [String: Any] = ["currentWeek": 1, "semesterStart": "2026-09-07", "semesterEnd": "2026-09-20", "weeks": weeks]
    if let periods { value["periods"] = periods }
    return value
}

private func course(_ name: String, _ startSlot: Int, _ endSlot: Int, start: String? = nil, end: String? = nil) -> [String: Any] {
    var value: [String: Any] = ["name": name, "weeks": "1-2周", "weekList": [1, 2], "startSlot": startSlot, "endSlot": endSlot, "location": "A201"]
    value["customStartTime"] = start
    value["customEndTime"] = end
    return value
}

private func cell(_ day: Int, _ bigSlot: Int, _ courses: [[String: Any]]) -> [String: Any] {
    ["day": day, "bigSlot": bigSlot, "courses": courses]
}

private func snapshot(_ cells: [[String: Any]], calendar cal: [String: Any] = calendar()) -> [String: Any] {
    [
        "semester": "2026-2027-1",
        "syncedAt": "2026-09-07T00:00:00.000Z",
        "calendar": cal,
        "schedule": ["scope": "semester", "semesters": [], "weeks": [], "currentSemester": "2026-2027-1", "currentWeek": "1", "cells": cells],
    ]
}

private let colors = ["blue", "pink", "purple", "teal"]

private func member(_ id: Int, _ nickname: String, _ data: [String: Any]?) -> DormPerson {
    let schedule = data.flatMap { DormPeople.schedule(snapshot: $0, owner: nickname) }
    if data != nil { check(schedule != nil, "\(nickname)'s snapshot reads") }
    return DormPeople.person(id: id, nickname: nickname, color: colors[id - 1], schedule: schedule)
}

/// Only on Tuesday, every class at its own clock times.
private func timed(_ id: Int, _ nickname: String, _ spans: [(String, String)]) -> DormPerson {
    member(id, nickname, snapshot(spans.enumerated().map { index, span in
        cell(2, index + 1, [course("课\(index + 1)", index * 2 + 1, index * 2 + 2, start: span.0, end: span.1)])
    }))
}

private func windows(_ day: DormDayAvailability) -> [[Int]] { day.windows.map { [$0.start, $0.end] + $0.freeIds } }

// 2026-09-08 is a Tuesday.
private let tuesday = "2026-09-08"

@main
struct NativeDormChecks {
    static func main() {
        routes()
        status()
        dorm()
        week()
        sync()
        print("dorm checks passed")
    }

    static func routes() {
        // An in-app invite link keeps its code for the native dorm sheet.
        equal(DormRules.linkCode("/schedule?dorm=1&code=%20abc234"), "ABC234")
        equal(DormRules.linkCode("/schedule?code=ABC234&dorm=1#top"), "ABC234")
        equal(DormRules.linkCode("/dorm-schedule?code=k7m2qx"), "K7M2QX")
        equal(DormRules.linkCode("/dorm-schedule"), "")
        // A code that cannot be one is dropped; the sheet still opens.
        equal(DormRules.linkCode("/schedule?dorm=1&code=%3Cscript%3E"), "")
        equal(DormRules.linkCode("/schedule?dorm=1"), "")
        // Everything else stays where it was going.
        equal(DormRules.linkCode("/schedule"), nil)
        equal(DormRules.linkCode("/schedule?couple=1&code=ABC234"), nil)
        equal(DormRules.linkCode("/schedule?dorm=0"), nil)
        equal(DormRules.linkCode("/schedule/share/ABCD2345?dorm=1"), nil)
        equal(DormRules.linkCode("/dorm-schedules"), nil)
        equal(DormRules.typedCode(" k7m-2qx "), "K7M2QX")
        equal(DormRules.typedCode("宿舍码abc"), "ABC")
        check(DormRules.invitation(code: "K7M2QX", origin: "https://cpu.example/").hasSuffix("https://cpu.example/schedule?dorm=1&code=K7M2QX 就能加入。"), "invitation link")

        // Only the term running now is uploaded.
        let terms: [(value: String, current: Bool)] = [("2025-2026-2", false), ("2026-2027-1", true)]
        check(DormRules.isCurrentTerm("2026-2027-1", terms: terms), "current term")
        check(!DormRules.isCurrentTerm("2025-2026-2", terms: terms), "past term")
        check(DormRules.isCurrentTerm("2026-2027-1", terms: []), "no list of terms: the one on screen")
        check(!DormRules.isCurrentTerm("", terms: terms), "no term")
    }

    static func status() {
        let reply = """
        {"status":"active","id":7,"name":" 6 栋 302 ","memberLimit":6,"isOwner":true,"since":"2026-09-01T00:00:00.000Z",
         "invite":{"code":"K7M2QX","expiresAt":"2026-09-02T00:00:00.000Z","expired":false},
         "me":{"id":3,"color":"pink","nickname":"阿青","isOwner":true,"snapshot":{"semester":"2026-2027-1","syncedAt":"2026-09-01T02:00:00.000Z"}},
         "members":[{"id":3,"color":"pink","nickname":"阿青","isOwner":true,"snapshot":null},
                    {"id":9,"color":"lime","nickname":"小鹿","isOwner":false,"snapshot":null}]}
        """
        guard case .active(let room) = DormStatus.read(Data(reply.utf8)) else { return check(false, "an active dorm reads") }
        equal(room.name, "6 栋 302")
        equal(room.liveInvite?.code, "K7M2QX")
        equal(room.me.semester, "2026-2027-1")
        equal(room.members.map(\.id), [3, 9])
        equal(room.members[1].color, "blue", "an unknown colour")
        check(!room.isFull, "5 places left")
        equal(DormStatus.read(Data(#"{"status":"none"}"#.utf8)), .none)
        equal(DormStatus.read(Data("nonsense".utf8)), .none)
        equal(DormRules.minFreeChoices(memberCount: 5), [nil, 4, 3, 2])
        equal(DormRules.minFreeChoices(memberCount: 2), [nil])
    }

    static func dorm() {
        let zhang = member(1, "张三", snapshot([cell(2, 1, [course("药理学", 1, 2)])]))
        let li = member(2, "李四", snapshot([cell(2, 3, [course("有机化学", 5, 6)])]))
        let nobody = member(3, "王五", nil)

        // The bundled bells are the Web's `smallSlots`.
        equal(DormRules.defaultPeriods, NativeSchedulePeriod.bundledTimetable.map {
            DormPeriod(number: $0.number, start: DormRules.minutes($0.startTime)!, end: DormRules.minutes($0.endTime)!)
        })

        // The day window comes from the bells and falls back to 08:00–21:40.
        equal(DormRules.dayWindow([zhang]), DormSpan(start: 480, end: 1320))
        let early = member(1, "张三", snapshot([], calendar: calendar(periods: [["id": 1, "start": "07:10", "end": "21:05"]])))
        equal(DormRules.dayWindow([early]), DormSpan(start: 430, end: 1265))
        equal(DormRules.dayWindow([]), DormSpan(start: 480, end: 1300))

        // Free windows need every member with data to be free by default.
        var day = DormRules.availability([zhang, li], date: tuesday)
        equal(day.knownIds, [1, 2])
        equal(day.unknownIds, [])
        equal(windows(day), [[580, 810, 1, 2], [910, 1320, 1, 2]])
        equal(day.allFreeWindows, day.windows)

        // Relaxing the requirement shows where only some are free.
        day = DormRules.availability([zhang, li], date: tuesday, minFree: 1)
        equal(windows(day), [[480, 580, 2], [580, 810, 1, 2], [810, 910, 1], [910, 1320, 1, 2]])

        // Short gaps are dropped: 李四's 15 minutes between 09:40 and 09:55.
        let tight = member(2, "李四", snapshot([
            cell(2, 1, [course("英语", 2, 2, start: "08:55", end: "09:40")]),
            cell(2, 2, [course("数学", 3, 3, start: "09:55", end: "10:40")]),
        ]))
        equal(windows(DormRules.availability([zhang, tight], date: tuesday, minFree: 2, minMinutes: 20)), [[640, 1320, 1, 2]])
        equal(windows(DormRules.availability([zhang, tight], date: tuesday, minFree: 2, minMinutes: 0)), [[580, 595, 1, 2], [640, 1320, 1, 2]])

        // Roommates without data are reported, not taken as free.
        day = DormRules.availability([zhang, li, nobody], date: tuesday)
        equal(day.knownIds, [1, 2])
        equal(day.unknownIds, [3])
        equal(windows(day), [[580, 810, 1, 2], [910, 1320, 1, 2]])

        // Dates outside everyone's term have no windows at all.
        day = DormRules.availability([zhang, li], date: "2027-03-01")
        equal(day.knownIds, [])
        equal(day.unknownIds, [1, 2])
        equal(day.windows, [])
        equal(day.allFreeWindows, [])

        // A class in period 1 is an early class; a custom 07:40 in period 3 is not.
        equal(DormRules.duties([zhang], date: tuesday), [DormDuty(id: 1, course: "药理学", start: 480, end: 580)])
        equal(DormRules.duties([li], date: tuesday), [])
        let late = member(3, "王五", snapshot([cell(2, 2, [course("体育", 3, 4, start: "07:40", end: "09:00")])]))
        equal(DormRules.duties([late], date: tuesday), [])

        // The morning table covers the days asked for and counts missing data.
        let table = DormRules.morningDays([zhang, member(2, "李四", nil)], dates: DormRules.dateRange(tuesday, count: 3))
        equal(table.map(\.date), ["2026-09-08", "2026-09-09", "2026-09-10"])
        equal(table[0].duties.count, 1)
        equal(table[0].unknownCount, 1)
        equal(table[1].duties, [])

        // The next early class skips today once it has begun.
        let mine = DormRules.morningDays([zhang], dates: DormRules.dateRange(tuesday, count: 2))
        let before = DormRules.nextMorning(mine, today: tuesday, minute: 7 * 60)
        equal(before?.isToday, true)
        equal(before?.day.date, tuesday)
        check(DormRules.nextMorning(mine, today: tuesday, minute: 8 * 60 + 30) == nil, "nothing after today's has begun")

        // Dates stay in China time and cross month ends.
        equal(DormRules.addDays("2026-09-30", 1), "2026-10-01")
        equal(DormRules.addDays("2026-01-01", -1), "2025-12-31")
        equal(DormRules.dateRange("2026-09-29", count: 3), ["2026-09-29", "2026-09-30", "2026-10-01"])
        equal(DormRules.dateLabel("2026-09-08", today: "2026-09-08"), "今天 周二")
        equal(DormRules.dateLabel("2026-09-09", today: "2026-09-08"), "明天 周三")
        equal(DormRules.dateLabel("2026-09-11", today: "2026-09-08"), "周五 09-11")
        equal(DormRules.dayName("2026-09-08", today: "2026-09-08"), "今天")
        equal(DormRules.dayName("2026-09-09", today: "2026-09-08"), "明天")
        equal(DormRules.dayName("2026-09-11", today: "2026-09-08"), "周五")
        equal(DormRules.dayName("2026-09-13", today: "2026-09-08"), "周日")
        equal(DormRules.today(ISO8601DateFormatter().date(from: "2026-09-07T16:30:00Z")!), "2026-09-08")
        equal(DormRules.minute(ISO8601DateFormatter().date(from: "2026-09-07T16:30:00Z")!), 30)

        // Minutes as clock time.
        equal(DormRules.clock(480), "08:00")
        equal(DormRules.clock(1320), "22:00")
        equal(DormRules.clock(0), "00:00")
        equal(DormRules.spanText(580, 810), "09:40–13:30")
        equal(DormRules.durationText(105), "1 小时 45 分")

        // Every roommate keeps their own hue.
        equal(DormRules.tone(color: "blue", dark: false).fill, CoupleRules.hsl(214, 88, 93))
        equal(DormRules.tone(color: "red", dark: false).fill, CoupleRules.hsl(358, 88, 93))
        equal(DormRules.tone(color: "nope", dark: true), DormRules.tone(color: "blue", dark: true))

        // A reader without a snapshot answers nothing for any date.
        equal(nobody.courses(on: tuesday), nil)
        equal(nobody.periods, [])

        // An explicit head count is not lowered to the roommates who have data.
        day = DormRules.availability([zhang, li, nobody], date: tuesday, minFree: 3)
        equal(day.requiredFree, 3)
        check(day.insufficientData, "three cannot be told from two")
        equal(day.windows, [])
        check(DormRules.freeEmptyText(day, explicitMinFree: true).contains("要 3 人同时有空，但这天只有 2 人有课表数据"), "insufficient text")
        day = DormRules.availability([zhang, li, nobody], date: tuesday, minFree: 2)
        check(!day.insufficientData, "two can")
        equal(day.windows.count, 2)

        // A relaxed head count keeps an hour two share while a third comes and goes.
        let wang = timed(3, "王五", [("10:00", "10:10"), ("10:20", "10:30"), ("10:40", "10:50")])
        let hour = DormSpan(start: 600, end: 660)
        equal(windows(DormRules.availability([zhang, li, wang], date: tuesday, minFree: 2, minMinutes: 20, window: hour)), [[600, 660, 1, 2]])
        equal(DormRules.availability([zhang, li, wang], date: tuesday, minMinutes: 20, window: hour).windows, [])

        // Never chains different pairs into one group.
        let a = timed(1, "张三", [("10:15", "10:40")])
        let c = timed(3, "王五", [("10:00", "10:15")])
        equal(windows(DormRules.availability([a, li, c], date: tuesday, minFree: 2, minMinutes: 20, window: DormSpan(start: 600, end: 640))),
              [[615, 640, 2, 3]])

        // A short tail does not dissolve a longer window with more people free.
        let tail = timed(3, "王五", [("10:00", "10:10")])
        equal(windows(DormRules.availability([zhang, li, tail], date: tuesday, minFree: 2, minMinutes: 20, window: DormSpan(start: 600, end: 780))),
              [[610, 780, 1, 2, 3]])

        // Only claim the whole dorm when everyone has data.
        let complete = DormRules.availability([zhang, li], date: tuesday)
        equal(DormRules.windowLabel(complete.windows[0], day: complete), "全宿舍都有空")
        let partial = DormRules.availability([zhang, li, nobody], date: tuesday)
        equal(DormRules.windowLabel(partial.windows[0], day: partial), "已同步的 2 人都有空")
        let loose = DormRules.availability([zhang, li], date: tuesday, minFree: 1)
        equal(DormRules.windowLabel(loose.windows[0], day: loose), "1 人有空")

        // Empty text tells missing data apart from a genuinely full day.
        check(DormRules.freeEmptyText(DormRules.availability([zhang, li], date: "2027-03-01"), explicitMinFree: false).contains("没有可用课表"), "no data text")
        let full = DormRules.availability([zhang, li], date: tuesday, minMinutes: 600)
        equal(full.windows.count, 0)
        equal(DormRules.freeEmptyText(full, explicitMinFree: false), "这天没有全宿舍同时有空的时段。可以把条件放宽一点再看。")
        let half = DormRules.availability([zhang, member(2, "李四", nil)], date: tuesday, minMinutes: 900)
        equal(half.windows.count, 0)
        equal(DormRules.freeEmptyText(half, explicitMinFree: false), "已同步的 1 人里没有大家同时有空的时段。可以把条件放宽一点再看。")

        // The morning list does not promise a free night when someone has no data.
        let quiet = DormRules.morningDays([li], dates: DormRules.dateRange(tuesday, count: 3))
        equal(DormRules.morningNoneText(quiet[0]), "没人早八")
        equal(DormRules.morningSummaryText(quiet), "未来 3 天都没有早八，晚上可以放心熬。")
        let unsure = DormRules.morningDays([li, member(2, "王五", nil)], dates: DormRules.dateRange(tuesday, count: 3))
        equal(unsure[0].knownCount, 1)
        equal(DormRules.morningNoneText(unsure[0]), "已同步的人没有早八")
        check(!DormRules.morningSummaryText(unsure).contains("放心熬"), "no promise")
        check(DormRules.morningSummaryText(unsure).contains("名单可能不全"), "incomplete")
        let blank = DormRules.morningDays([member(1, "张三", nil)], dates: DormRules.dateRange(tuesday, count: 3))
        equal(DormRules.morningNoneText(blank[0]), "没有数据")
        check(DormRules.morningSummaryText(blank).contains("看不出谁有早八"), "nothing to tell")

        // A make-up day (调休) runs another date's classes; a day off has none.
        var adjusted = calendar()
        adjusted["adjustments"] = [
            ["date": "2026-09-08", "kind": "off"],
            ["date": "2026-09-13", "kind": "swap", "source": "2026-09-08"],
        ]
        let swapped = member(1, "张三", snapshot([cell(2, 1, [course("药理学", 1, 2)])], calendar: adjusted))
        equal(swapped.courses(on: tuesday), [], "the day off")
        equal(swapped.courses(on: "2026-09-13")?.map(\.name), ["药理学"], "the make-up Sunday")
        equal(DormRules.duties([swapped], date: "2026-09-13").map(\.course), ["药理学"])
    }

    static func week() {
        let zhang = member(1, "张三", snapshot([cell(2, 1, [course("药理学", 1, 2)])]))
        let li = member(2, "李四", snapshot([
            cell(2, 1, [course("有机化学", 2, 3)]),
            cell(3, 1, [course("体育", 1, 2)]),
        ]))

        // The week starts on Monday whatever day it is asked from.
        equal(DormRules.monday("2026-09-07"), "2026-09-07")
        equal(DormRules.monday("2026-09-10"), "2026-09-07")
        equal(DormRules.monday("2026-09-13"), "2026-09-07")

        // Every period of every day says who is free and who is in class.
        let grid = DormRules.weekGrid([zhang, li], monday: "2026-09-07")
        equal(grid.dates, days("2026-09-07"))
        equal(grid.teachingWeek, 1)
        equal(grid.rows.count, 12)
        func at(_ row: Int) -> DormWeekCell { grid.rows[row].cells[1] }
        equal(at(0).freeIds, [2])
        equal(at(0).busy, [DormWeekBusy(id: 1, courses: ["药理学"])])
        equal(at(1).freeIds, [])
        equal(at(1).busy.map(\.id), [1, 2])
        equal(at(2).freeIds, [1])
        equal(at(3).freeIds, [1, 2])
        equal(at(0).level, .some)
        equal(at(1).level, .none)
        equal(at(3).level, .all)
        equal(DormRules.cellSummary(at(0)), "1 人有空")
        equal(DormRules.cellSummary(at(1)), "都在上课")
        equal(DormRules.cellSummary(at(3)), "全宿舍都有空")
        equal(at(0).freeRatio, 0.5)

        // Breaks before the afternoon and the evening are marked.
        equal(DormRules.weekGrid([zhang], monday: "2026-09-07").rows.filter(\.breakBefore).map(\.period.number), [5, 9])

        // Members without data are unknown, never free.
        let partly = DormRules.weekGrid([zhang, member(2, "李四", nil)], monday: "2026-09-07").rows[3].cells[1]
        equal(partly.freeIds, [1])
        equal(partly.unknownIds, [2])
        equal(partly.level, .all)
        equal(DormRules.cellSummary(partly), "已同步的 1 人都有空")
        let empty = DormRules.weekGrid([member(1, "张三", nil)], monday: "2026-09-07")
        equal(empty.rows[0].cells[0].level, .unknown)
        equal(DormRules.cellSummary(empty.rows[0].cells[0]), "没有课表数据")
        equal(empty.teachingWeek, nil)

        // A week outside the term has no data and no teaching week.
        let outside = DormRules.weekGrid([zhang, li], monday: "2026-10-05")
        equal(outside.teachingWeek, nil)
        check(outside.rows.allSatisfy { $0.cells.allSatisfy { $0.level == .unknown } }, "all unknown outside the term")

        // Custom course times are matched by the clock, not the period number.
        let lab = member(1, "张三", snapshot([cell(1, 1, [course("实验", 1, 1, start: "09:00", end: "10:00")])]))
        equal(DormRules.weekGrid([lab], monday: "2026-09-07").rows.prefix(4).map { $0.cells[0].level }, [.all, .none, .none, .all])

        // The bells follow the user's own timetable first.
        let own = member(1, "张三", snapshot([], calendar: calendar(periods: [["id": 1, "start": "07:30", "end": "08:15"]])))
        let theirs = member(2, "李四", snapshot([], calendar: calendar(periods: [["id": 1, "start": "08:00", "end": "08:45"]])))
        equal(DormRules.weekPeriods([theirs, own], preferredId: 1).first?.start, 450)
        equal(DormRules.weekPeriods([theirs, own]).first?.start, 480)
        equal(DormRules.weekPeriods([member(1, "张三", nil)]).count, 12)

        // A roommate at another school is busy by the clock: NJMU's 08:00–08:40 overlaps CPU's period 1.
        let njmu = member(2, "李四", snapshot([cell(1, 1, [course("解剖学", 2, 2)])], calendar: calendar(periods: [
            ["id": 1, "start": "08:00", "end": "08:40"], ["id": 2, "start": "08:50", "end": "09:30"], ["id": 3, "start": "09:40", "end": "10:20"],
        ])))
        let mixed = DormRules.weekGrid([zhang, njmu], monday: "2026-09-07", preferredId: 1)
        equal(mixed.rows[0].cells[0].busy.map(\.id), [], "08:50 is after CPU's first period")
        equal(mixed.rows[1].cells[0].busy.map(\.id), [2], "08:50–09:30 is in CPU's second")
    }

    static func sync() {
        let scope = DormRules.uploadScope(account: "acct", dorm: 7, semester: "2026-2027-1")
        let sent = "\(scope)|print@1000"
        check(DormRules.skipsUpload(last: sent, scope: scope, print: "print", now: 2000, serverSemester: "2026-2027-1", semester: "2026-2027-1"), "the same content an hour later")
        check(!DormRules.skipsUpload(last: sent, scope: scope, print: "print", now: 1000 + 13 * 3600, serverSemester: "2026-2027-1", semester: "2026-2027-1"), "twelve hours on")
        check(!DormRules.skipsUpload(last: sent, scope: scope, print: "other", now: 2000, serverSemester: "2026-2027-1", semester: "2026-2027-1"), "changed content")
        check(!DormRules.skipsUpload(last: sent, scope: scope, print: "print", now: 2000, serverSemester: "", semester: "2026-2027-1"), "the server lost it")
        check(!DormRules.skipsUpload(last: sent, scope: scope, print: "print", now: 2000, serverSemester: "2025-2026-2", semester: "2026-2027-1"), "the server has another term")
        let otherDorm = DormRules.uploadScope(account: "acct", dorm: 8, semester: "2026-2027-1")
        check(!DormRules.skipsUpload(last: sent, scope: otherDorm, print: "print", now: 2000, serverSemester: "2026-2027-1", semester: "2026-2027-1"), "another dorm")
        check(DormRules.mayFetchTerm(last: nil, scope: scope, now: 0), "never fetched")
        check(!DormRules.mayFetchTerm(last: "\(scope)@1000", scope: scope, now: 1000 + 3600), "an hour after")
        check(DormRules.mayFetchTerm(last: "\(scope)@1000", scope: scope, now: 1000 + 7 * 3600), "seven hours after")
        check(DormRules.mayFetchTerm(last: "\(otherDorm)@1000", scope: scope, now: 2000), "another scope")
    }
}
