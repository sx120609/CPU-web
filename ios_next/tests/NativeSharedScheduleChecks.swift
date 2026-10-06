import Foundation

@main
struct NativeSharedScheduleChecks {
    static var failures = 0

    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() {
            failures += 1
            print("FAIL: \(message)")
        }
    }

    static func days(_ monday: String) -> [String] {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "yyyy-MM-dd"
        let start = formatter.date(from: monday)!
        return (0..<7).map { formatter.string(from: start.addingTimeInterval(Double($0) * 86400)) }
    }

    static func date(_ text: String) -> Date {
        ISO8601DateFormatter().date(from: text)!
    }

    /// A share document as the server sends it.
    static func document(courses: String, weeks: String? = nil) -> Data {
        let first = days("2026-09-07"), second = days("2026-09-14")
        let defaultWeeks = """
        [{"week":1,"days":\(json(first)),"monday":"\(first[0])","sunday":"\(first[6])"},
         {"week":2,"days":\(json(second)),"monday":"\(second[0])","sunday":"\(second[6])"}]
        """
        return Data("""
        {"code":"ABCD2345","owner":"阿青","semester":"2026-2027-1","courseCount":2,
         "createdAt":"2026-09-01T00:00:00.000Z","updatedAt":"2026-09-02T00:00:00.000Z",
         "schedule":{"semesters":[],"weeks":[],"currentSemester":"2026-2027-1","currentWeek":"1","cells":\(courses)},
         "calendar":{"currentWeek":1,"semesterStart":"2026-09-07","semesterEnd":"2026-09-20","weeks":\(weeks ?? defaultWeeks),
           "periods":[{"id":1,"name":"第1节","start":"08:00","end":"08:45"},{"id":2,"name":"第2节","start":"08:55","end":"09:40"}],
           "adjustments":[{"date":"2026-09-12","kind":"swap","source":"2026-09-10"},{"date":"2026-09-08","kind":"mystery"}]}}
        """.utf8)
    }

    static func json(_ values: [String]) -> String {
        "[" + values.map { "\"\($0)\"" }.joined(separator: ",") + "]"
    }

    static let twoCourses = """
    [{"day":1,"bigSlot":1,"courses":[{"name":" 药理学 ","teacher":"王老师","weeks":"1-2周","weekList":[2,1,1,0,99],
       "startSlot":1,"endSlot":2,"sourceKey":"jwxt|1|1","customId":"c1","custom":true}]},
     {"day":3,"bigSlot":2,"courses":[{"name":"高等数学","weeks":"1周","weekList":[1],"startSlot":3,"endSlot":40}]}]
    """

    static func main() {
        // Codes as people type and paste them.
        expect(NativeSharedSchedule.normalizedCode(" abcd-2345 ") == "ABCD2345", "分享码不分大小写，忽略空格和连字符")
        expect(NativeSharedSchedule.normalizedCode("https://cputime.cn/schedule/share/abcd2345?from=x") == "ABCD2345", "可以直接粘贴分享链接")
        expect(NativeSharedSchedule.normalizedCode("ABCD234") == nil, "少一位不是分享码")
        expect(NativeSharedSchedule.normalizedCode("ABCD23451") == nil, "多一位不是分享码")
        expect(NativeSharedSchedule.normalizedCode("ABCD2340") == nil, "分享码里没有 0 和 1")

        // Reading a share clamps what a grid indexes with.
        guard let share = try? NativeSharedSchedule.read(document(courses: twoCourses), fetchedAt: date("2026-09-09T02:00:00Z")) else {
            print("FAIL: 读取分享失败"); exit(1)
        }
        expect(share.meta.code == "ABCD2345" && share.meta.ownerName == "阿青" && share.meta.semester == "2026-2027-1", "分享的基本信息")
        let pharmacology = share.schedule.cells[0].courses[0]
        expect(pharmacology.name == "药理学" && pharmacology.weekList == [1, 2], "课程名去空白，周次去重并丢掉越界的")
        expect(pharmacology.sourceKey == nil && pharmacology.customId == nil && !pharmacology.custom, "发布者的编辑标识不带进来")
        expect(share.schedule.cells[1].courses[0].endSlot == 20, "越界的节次收进范围")
        expect(share.calendar.periods.map(\.number) == [1, 2] && share.calendar.periods[0].startTime == "08:00", "按 Web 的节次字段读取")
        expect(share.calendar.adjustments.map(\.kind) == ["swap"], "只认放假和调休两种调整")
        expect(share.name == "阿青", "没有备注时用发布者的昵称")

        let dropped = try? NativeSharedSchedule.read(document(courses: """
        [{"day":9,"bigSlot":1,"courses":[{"name":"越界","weeks":"","weekList":[]}]},
         {"day":2,"bigSlot":1,"courses":[{"name":"  ","weeks":"","weekList":[]},{"name":"有机化学","weeks":"","weekList":[]}]}]
        """))
        expect(dropped?.schedule.cells.count == 1 && dropped?.schedule.cells[0].courses.map(\.name) == ["有机化学"], "星期越界的格子和没有名字的课丢掉")
        expect((try? NativeSharedSchedule.read(document(courses: "[]"))) == nil, "没有课程的分享不能导入")
        expect((try? NativeSharedSchedule.read(document(courses: twoCourses, weeks: "[]"))) == nil, "没有校历的分享不能导入")
        expect((try? NativeSharedSchedule.read(Data("{}".utf8))) == nil, "不是分享的内容不能导入")

        // A week as 教务 lists it, which is what a share published from the Web keeps.
        let monday = days("2026-09-07")
        expect(NativeSharedSchedule.mondayFirstDays(monday) ?? [] == monday, "周一开头的一周原样保留")
        expect(NativeSharedSchedule.mondayFirstDays(["2026-09-06"] + monday.prefix(6)) ?? [] == monday,
               "周日开头的一周取紧接着的周一到周日，与 Web 的算法一致")
        expect(NativeSharedSchedule.mondayFirstDays(["", "2026-09-08", "2026-09-09"]) ?? [] == monday, "缺日期的一周按已有的日期补齐")
        expect(NativeSharedSchedule.mondayFirstDays(["x", "2026-02-30"]) == nil, "没有有效日期的一周丢掉")
        let ragged = try? NativeSharedSchedule.read(document(courses: twoCourses, weeks: """
        [{"week":1,"days":["2026-09-07","2026-09-08"]},{"week":2,"days":[]}]
        """))
        expect(ragged?.calendar.weeks.map(\.week) == [1] && ragged?.calendar.weeks[0].days == monday
               && ragged?.calendar.weeks[0].sunday == "2026-09-13", "读取时把每周规整成周一到周日")

        // The current week follows the reader's clock, not the publisher's.
        expect(share.week(containing: "2026-09-16") == 2, "今天所在的教学周")
        expect(share.week(containing: "2026-08-01") == 1 && share.week(containing: "2027-01-01") == 2, "学期外取首周或末周")
        var named = share
        named.remark = "室友"
        let snapshot = named.snapshot(now: date("2026-09-16T02:00:00Z"))
        expect(snapshot.completeSemester && snapshot.source == .shared && snapshot.auth.authenticated, "整学期的只读快照")
        expect(snapshot.data?.currentSemester == "share:ABCD2345" && snapshot.data?.currentWeek == "2", "学期值带前缀，当前周按今天算")
        expect(snapshot.data?.semesters.map(\.label) == ["室友"], "学期菜单显示备注")
        expect(snapshot.data?.weeks.map(\.value) == ["1", "2"] && snapshot.calendar?.currentWeek == 2, "周次来自对方的校历")
        expect(snapshot.calendar?.adjustments.count == 1, "调休跟着对方的校历")

        // Publishing one's own timetable in the shape the Web share page reads.
        let own = NativeScheduleSnapshot(
            completeSemester: true, source: .jwxt,
            periods: [NativeSchedulePeriod(number: 1, startTime: "08:00", endTime: "08:45")],
            data: NativeScheduleResult(
                semesters: [NativeScheduleSemester(value: "2026-2027-1", label: "本学期", current: true)],
                currentSemester: "2026-2027-1", currentWeek: "2",
                cells: [NativeScheduleCell(day: 1, bigSlot: 1, courses: [NativeScheduleCourse(
                    nativeId: "n1", name: "药理学", teacher: "王老师", weeks: "1-2周", weekList: [1, 2],
                    startSlot: 1, endSlot: 2, sourceKey: "jwxt|1|1", customId: "c1", custom: true
                )])]
            ),
            calendar: NativeScheduleCalendar(
                currentSemester: "2026-2027-1", currentWeek: 2, semesterStart: "2026-09-07", semesterEnd: "2026-09-20",
                weeks: [NativeCalendarWeek(week: 1, days: days("2026-09-07"), monday: "2026-09-07", sunday: "2026-09-13")],
                periods: [NativeSchedulePeriod(number: 1, startTime: "08:00", endTime: "08:45")],
                adjustments: [NativeScheduleAdjustment(date: "2026-09-12", kind: "off")]
            ),
            auth: NativeScheduleAuth(authenticated: true, account: "a1")
        )
        if let body = try? NativeSharedSchedule.publishBody(from: own, ownerName: " 阿青 "),
           let encoded = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]),
           let text = String(data: encoded, encoding: .utf8) {
            expect(body["semester"] as? String == "2026-2027-1" && body["ownerName"] as? String == "阿青", "学期和昵称")
            expect(text.contains(#""periods":[{"end":"08:45","id":1,"name":"第1节","start":"08:00"}]"#), "节次按 Web 的字段名发出")
            expect(!text.contains("sourceKey") && !text.contains("customId") && !text.contains("nativeId"), "不发出账号内的课程标识")
            expect(!text.contains("本学期"), "不发出自己的学期列表")
            // The server's own tests post this same file, so the two sides
            // cannot drift apart unnoticed. `UPDATE_FIXTURES=1` rewrites it.
            let fixture = URL(fileURLWithPath: "ios_next/tests/fixtures/schedule-share-body.json")
            let pretty = (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]))
                .flatMap { String(data: $0, encoding: .utf8) }.map { $0 + "\n" } ?? ""
            if ProcessInfo.processInfo.environment["UPDATE_FIXTURES"] == "1" {
                try? pretty.write(to: fixture, atomically: true, encoding: .utf8)
            }
            expect((try? String(contentsOf: fixture, encoding: .utf8)) == pretty, "发出的内容与 fixtures/schedule-share-body.json 一致")
            // What goes out must come back as the same timetable.
            var document = body
            document["code"] = "ABCD2345"
            if let data = try? JSONSerialization.data(withJSONObject: document),
               let back = try? NativeSharedSchedule.read(data) {
                expect(back.schedule.cells[0].courses[0].name == "药理学" && back.schedule.cells[0].courses[0].teacher == "王老师", "发出的课表能原样读回")
                expect(back.calendar.adjustments.first?.kind == "off" && back.calendar.weeks.count == 1, "校历和调休一起读回")
            } else {
                expect(false, "发出的内容读不回来")
            }
        } else {
            expect(false, "生成分享内容失败")
        }
        let weekly = NativeScheduleSnapshot(completeSemester: false, source: .jwxt, data: own.data, calendar: own.calendar,
                                            auth: NativeScheduleAuth(authenticated: true))
        expect((try? NativeSharedSchedule.publishBody(from: weekly, ownerName: nil)) == nil, "只有一周的课表不能分享")

        // The reader's library.
        var library = NativeSharedScheduleLibrary()
        library.adopt(account: "a1")
        library.save(share, remark: " 室友 ")
        library.save(share, remark: "室友小王")
        expect(library.schedules.count == 1 && library.schedules[0].name == "室友小王", "同一个码重复导入只更新")
        library.care("ABCD2345")
        expect(library.cared?.meta.code == "ABCD2345", "设为关心")
        library.care("ZZZZ2222")
        expect(library.caredCode == "ABCD2345", "没导入的码不能设为关心")
        var newer = share
        newer.meta.updatedAt = "2026-09-20T00:00:00.000Z"
        library.refresh(newer)
        expect(library.schedules[0].meta.updatedAt == "2026-09-20T00:00:00.000Z" && library.schedules[0].remark == "室友小王", "刷新保留备注")
        library.markRevoked("ABCD2345")
        expect(library.schedules[0].revoked && library.caredCode == nil && library.cared == nil, "撤销后保留副本、取消关心")
        library.care("ABCD2345")
        expect(library.caredCode == nil, "已撤销的分享不能设为关心")
        library.adopt(account: "")
        library.adopt(account: "a1")
        expect(library.schedules.count == 1, "同一账号或未知账号不清空")
        library.adopt(account: "a2")
        expect(library.schedules.isEmpty && library.account == "a2", "换账号后从空的开始")
        library.save(share, remark: "")
        library.care("ABCD2345")
        library.remove("ABCD2345")
        expect(library.schedules.isEmpty && library.caredCode == nil, "移除时一并取消关心")
        if let data = try? JSONEncoder().encode(NativeSharedScheduleLibrary(account: "a1", schedules: [named], caredCode: "ABCD2345")),
           let back = try? JSONDecoder().decode(NativeSharedScheduleLibrary.self, from: data) {
            expect(back.schedules.first?.remark == "室友" && back.cared != nil, "本机保存后能读回")
        } else {
            expect(false, "共享课表库存取失败")
        }

        if failures > 0 { exit(1) }
        print("Native shared schedule checks passed")
    }
}
