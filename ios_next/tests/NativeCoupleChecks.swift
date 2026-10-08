import Foundation

// Run with ios_next/scripts/check-couple-schedule.sh. The expected values are
// the Web's (`web/src/views/schedule/couple.ts`) and Android's (`ScheduleParityTest`).

private func piece(_ name: String, _ start: Int, _ end: Int) -> CoupleRules.Piece {
    CoupleRules.Piece(startSlot: start, endSlot: end, name: name)
}

@main
struct NativeCoupleChecks {
    static func main() {
        // One person, one colour, whatever the course: the Web's `couplePersonTone`.
        precondition(CoupleRules.nameHash("药理学") == 33_278_927)
        let blue = CoupleRules.personTone(color: "blue", dark: false)
        precondition([blue.fill.hex, blue.border.hex, blue.text.hex] == ["#DDEBFD", "#9ABFEF", "#1D406D"], "blue, light")
        let pinkDark = CoupleRules.personTone(color: "pink", dark: true)
        precondition([pinkDark.fill.hex, pinkDark.border.hex, pinkDark.text.hex] == ["#6D2640", "#CF306A", "#F5F7FF"], "pink, dark")
        precondition(CoupleRules.colors.map(\.key) == ["blue", "pink", "purple", "teal", "green", "amber", "orange"])
        precondition(CoupleRules.colors.map(\.hue) == [214, 338, 268, 178, 138, 42, 22])
        precondition(CoupleRules.personTone(color: "mauve", dark: false) == blue, "an unknown colour is blue")
        precondition(CoupleRules.personTone(color: "teal", dark: false) != CoupleRules.personTone(color: "green", dark: false))
        precondition(CoupleRGB.heart.hex == "#E2568A")

        // The week view: the user's courses stay, the partner's fit around them.
        let mine = [piece("药理学", 1, 2), piece("大学英语", 3, 4), piece("药物分析", 9, 10)]
        let theirs = [piece("药 理 学", 1, 2), piece("高等数学", 4, 5), piece("物理化学", 7, 8)]
        let merged = CoupleRules.merge(mine: mine, theirs: theirs)
        func find(_ name: String) -> CoupleRules.Placed {
            merged.first { ($0.fromPartner ? theirs : mine)[$0.index].name == name }!
        }
        // The same class in the same periods is the user's tile, whatever the spacing of its name.
        precondition(merged.count == 5)
        precondition(find("药理学").owner == .both && !find("药理学").fromPartner && !find("药理学").meets)
        // Where the two meet, the user's course keeps its cell and names the partner's at its foot.
        precondition(find("大学英语").owner == .mine && find("大学英语").meets)
        precondition(find("高等数学").owner == .partner && find("高等数学").meets)
        // Everything else keeps the whole cell.
        precondition(find("药物分析").owner == .mine && !find("药物分析").meets)
        precondition(find("物理化学").owner == .partner && !find("物理化学").meets)
        // Without a partner timetable nothing changes for the user's courses.
        precondition(CoupleRules.merge(mine: [piece("甲", 1, 2)], theirs: []) ==
            [CoupleRules.Placed(index: 0, fromPartner: false, owner: .mine, meets: false)])
        // The day view marks the classes both attend in each column.
        precondition(CoupleRules.sharedKeys(mine: mine, theirs: theirs) == ["1|2|药理学"])

        // The status line says what the partner is doing.
        let day = [CoupleRules.TimedCourse(name: "高等数学", start: "10:00", end: "11:35"),
                   CoupleRules.TimedCourse(name: "药理学", start: "08:00", end: "09:35")]
        precondition(CoupleRules.nowText(name: "小鹿", hasData: true, courses: day, minutes: 8 * 60 + 30) == "小鹿 在上《药理学》· 09:35 下课")
        precondition(CoupleRules.nowText(name: "小鹿", hasData: true, courses: day, minutes: 9 * 60 + 40) == "小鹿 下一节《高等数学》· 10:00")
        precondition(CoupleRules.nowText(name: "小鹿", hasData: true, courses: day, minutes: 12 * 60) == "小鹿 今天的课都上完了")
        precondition(CoupleRules.nowText(name: "小鹿", hasData: true, courses: [], minutes: 600) == "小鹿 今天没有课")
        precondition(CoupleRules.nowText(name: "小鹿", hasData: true, courses: nil, minutes: 600) == "小鹿 今天不在学期内")
        precondition(CoupleRules.nowText(name: "", hasData: false, courses: nil, minutes: 600) == "TA 还没有同步课表")
        precondition(CoupleRules.nowText(name: "小鹿", hasData: true, courses: day, minutes: 8 * 60 + 30, short: false) == "在上《药理学》，09:35 下课")
        precondition(CoupleRules.nowText(name: "小鹿", hasData: true, courses: day, minutes: 9 * 60 + 40, short: false) == "下一节《高等数学》10:00 开始")

        // Days together: day 1 is the anniversary itself.
        precondition(CoupleRules.daysTogether("2026-10-08", today: "2026-10-08") == 1)
        precondition(CoupleRules.daysTogether("2025-05-20", today: "2026-10-08") == 507)
        precondition(CoupleRules.daysTogether("2026-10-09", today: "2026-10-08") == nil)
        precondition(CoupleRules.daysTogether("", today: "2026-10-08") == nil)
        precondition(CoupleRules.daysTogether("2026-02-30", today: "2026-10-08") == nil)
        precondition(CoupleRules.daysTogether("2026-1-05", today: "2026-10-08") == nil)

        // The binding is read from the server's answer.
        func status(_ json: String) -> CoupleStatus { CoupleStatus.read(Data(json.utf8)) }
        precondition(status(#"{"status":"none"}"#) == CoupleStatus.none)
        precondition(status(#"{"status":"pending","invite":{"code":"K7M2QX","expiresAt":"2026-10-09T01:00:00.000Z","expired":false}}"#)
            == .pending(code: "K7M2QX", expired: false))
        precondition(status(#"{"status":"pending","invite":{"code":null,"expiresAt":null,"expired":true}}"#) == .pending(code: "", expired: true))
        let active = status(#"{"status":"active","since":"2026-01-01T00:00:00.000Z","anniversary":null,"me":{"id":1,"color":"pink","nickname":" 阿青 ","avatar":null,"snapshot":null},"partner":{"id":2,"color":"amber","nickname":"小鹿","avatar":null,"snapshot":{"semester":"2026-2027-1","syncedAt":"2026-10-08T01:30:00.000Z","changedAt":"2026-10-07T01:30:00.000Z"}}}"#)
        precondition(active == .active(anniversary: "", me: CoupleMember(nickname: "阿青", color: "pink", syncedAt: ""),
                                       partner: CoupleMember(nickname: "小鹿", color: "amber", syncedAt: "2026-10-08T01:30:00.000Z")))
        precondition(status(#"{"status":"active","me":{"color":"mauve"},"partner":{"color":"teal"}}"#)
            == .active(anniversary: "", me: CoupleMember(color: "blue"), partner: CoupleMember(color: "teal")))
        precondition(status("not json") == CoupleStatus.none)

        // Relative times, the upload fingerprint and the invitation text.
        let now = CoupleRules.parseISO("2026-10-08T04:00:00.000Z")!
        precondition(CoupleRules.relative("2026-10-08T03:59:30.000Z", now: now) == "刚刚")
        precondition(CoupleRules.relative("2026-10-08T03:15:00Z", now: now) == "45 分钟前")
        precondition(CoupleRules.relative("2026-10-08T01:30:00.000Z", now: now) == "2 小时前")
        precondition(CoupleRules.relative("2026-10-05T01:30:00.000Z", now: now) == "3 天前")
        precondition(CoupleRules.relative("2026-08-01T01:30:00.000Z", now: now) == "8 月 1 日")
        precondition(CoupleRules.relative("", now: now) == "")
        // Same function as the Web's `snapshotFingerprint` (FNV-1a over UTF-16 units).
        precondition(CoupleRules.fingerprint("") == "0-" + String(UInt32(0x811C_9DC5), radix: 36))
        precondition(CoupleRules.fingerprint("课表") != CoupleRules.fingerprint("课 表"))
        precondition(CoupleRules.invitation(code: "K7M2QX", origin: "https://cputime.cn/")
            .hasSuffix("打开 https://cputime.cn/schedule?couple=1&code=K7M2QX 就能绑定。"))

        print("Couple timetable colours, merge, status line, days together, binding and text checks passed")
    }
}
