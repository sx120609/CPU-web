import Foundation

@main
struct ScheduleDisplayRulesChecks {
    static func main() {
        // Classrooms: only 教学楼 + block A–E + number loses the building.
        for (raw, shown) in [("教学楼A102", "A102"), ("教学楼 E-305", "E-305"), (" 教学楼b 210 ", "b 210"), ("教学楼C－101", "C－101"),
                             ("实验楼B203", "实验楼B203"), ("教学楼报告厅", "教学楼报告厅"), ("教学楼F101", "教学楼F101"),
                             ("教学楼", "教学楼"), ("教学楼A", "教学楼A"), ("", "")] {
            precondition(ScheduleClassroom.only(raw) == shown, "\(raw) -> \(ScheduleClassroom.only(raw))")
        }

        typealias Piece = ScheduleOverlapNotice.Piece
        func piece(_ day: Int, _ start: Int, _ end: Int, _ lane: Int, _ name: String) -> Piece {
            Piece(day: day, startSlot: start, endSlot: end, lane: lane, name: name)
        }
        // Nothing side by side.
        precondition(ScheduleOverlapNotice.find([piece(1, 1, 2, 0, "高等数学"), piece(1, 3, 4, 0, "大学英语")]) == nil)
        // The first place of the week, with the courses chained to it.
        let found = ScheduleOverlapNotice.find([
            piece(5, 1, 2, 0, "药理学"), piece(5, 1, 2, 1, "药剂学"),
            piece(3, 3, 4, 1, "分析化学"), piece(3, 1, 2, 0, "体育（羽毛球）"), piece(3, 1, 2, 1, "生物化学"),
            piece(3, 2, 3, 2, "有机化学"), piece(3, 9, 9, 0, "形势与政策"),
        ])
        precondition(found == ScheduleOverlapNotice(day: 3, startSlot: 1, endSlot: 4,
                                                    names: ["体育（羽毛球）", "生物化学", "有机化学", "分析化学"]))
        precondition(found!.text == "周三第 1–4 节同时排了 「体育（羽毛球）」、「生物化学」、「有机化学」 等。这通常是教务系统的数据有误，建议先到教务系统核对原始课表；确认哪一门不该在这里以后，点这门课就可以编辑或删除。")
        precondition(found!.key(semester: "2026-2027-1") == "2026-2027-1|3|体育（羽毛球）/分析化学/有机化学/生物化学")
        // Two rows of the same course are not two courses.
        precondition(ScheduleOverlapNotice.find([piece(2, 1, 2, 0, "药理学"), piece(2, 1, 2, 1, "药理学")]) == nil)
        // One period.
        let single = ScheduleOverlapNotice.find([piece(7, 9, 9, 0, "甲"), piece(7, 9, 9, 1, "乙")])!
        precondition(single.text.hasPrefix("周日第 9 节同时排了 「甲」、「乙」。"))
        // Remembered once, forty at most.
        let suite = "cpu.overlap.checks.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        precondition(!ScheduleOverlapNotice.seen("a", defaults: defaults))
        for index in 0..<45 { ScheduleOverlapNotice.remember("k\(index)", defaults: defaults) }
        ScheduleOverlapNotice.remember("k10", defaults: defaults)
        let kept = defaults.stringArray(forKey: ScheduleOverlapNotice.storageKey) ?? []
        precondition(kept.count == 40 && kept.last == "k10" && !ScheduleOverlapNotice.seen("k4", defaults: defaults)
                     && ScheduleOverlapNotice.seen("k44", defaults: defaults))
        print("Classroom display and same-period notice checks passed")
    }
}
