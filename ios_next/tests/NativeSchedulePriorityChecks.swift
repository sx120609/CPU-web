import Foundation

@main
struct NativeSchedulePriorityChecks {
    static var failures = 0

    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() {
            failures += 1
            print("FAIL: \(message)")
        }
    }

    static func block(_ name: String, _ start: Int, _ end: Int) -> NativeScheduleCourseBlockRecord {
        NativeScheduleCourseBlockRecord(
            id: "\(name)-\(start)", course: NativeScheduleCourse(name: name), bigSlot: (start + 1) / 2,
            startSlot: start, endSlot: end
        )
    }

    static func shape(_ placed: [NativeSchedulePriority.Placed]) -> [String] {
        placed.map { "\($0.block.course.name) \($0.startSlot)-\($0.endSlot) L\($0.lane)" }
    }

    static func main() {
        expect(NativeSchedulePriority.key("  药物  化学 \n") == "药物 化学", "键是收拢空白后的课程名")
        expect(NativeSchedulePriority.value(of: "药物 化学", in: ["药物 化学": 3]) == 3, "按课程名取优先级")
        expect(NativeSchedulePriority.value(of: "药理学", in: ["药物 化学": 3, "药理学": -2]) == 0, "没有或无效的优先级算 0")
        expect(NativeSchedulePriority.top(in: [:]) == 1 && NativeSchedulePriority.top(in: ["甲": 4, "乙": 2]) == 5, "置顶值比现有的都大")

        // Without any priority the layout is the side-by-side one it always was.
        let plain = [block("甲", 1, 2), block("乙", 1, 4), block("丙", 3, 4), block("丁", 5, 6)]
        expect(shape(NativeSchedulePriority.place(plain, priorities: [:]))
               == ["甲 1-2 L0", "乙 1-4 L1", "丙 3-4 L0", "丁 5-6 L0"], "没有优先级时并排")
        expect(shape(NativeSchedulePriority.place(plain, priorities: ["甲": 2, "乙": 2, "丙": 2]))
               == ["甲 1-2 L0", "乙 1-4 L1", "丙 3-4 L0", "丁 5-6 L0"], "优先级相同仍然并排")

        // A course in front covers only the periods it shares.
        let covered = NativeSchedulePriority.place([block("甲", 1, 2), block("乙", 1, 4)], priorities: ["甲": 1])
        expect(shape(covered) == ["甲 1-2 L0", "乙 3-4 L0"], "低优先级只留没被盖住的节次")
        expect(covered[1].id == "乙-1-segment-3-4" && covered[0].id == "甲-1", "被裁开的一段有自己的标识")
        expect(covered[1].block.startSlot == 1 && covered[1].block.endSlot == 4, "原课程的节次保留，供速览和编辑使用")

        let hidden = NativeSchedulePriority.place([block("甲", 1, 4), block("乙", 2, 3)], priorities: ["甲": 1])
        expect(shape(hidden) == ["甲 1-4 L0"], "完全被盖住的课不画")

        let split = NativeSchedulePriority.place([block("甲", 3, 4), block("乙", 1, 6)], priorities: ["甲": 5])
        expect(shape(split) == ["乙 1-2 L0", "甲 3-4 L0", "乙 5-6 L0"], "中间被盖住时前后各留一段")

        let ranked = NativeSchedulePriority.place(
            [block("甲", 1, 2), block("乙", 1, 2), block("丙", 1, 4)], priorities: ["甲": 1, "乙": 2]
        )
        expect(shape(ranked) == ["乙 1-2 L0", "丙 3-4 L0"], "多门课时最高的在前")

        // The Live Activity takes the same answer, but only when it is unambiguous.
        let names = ["a": "甲", "b": "乙", "c": "丙"]
        expect(NativeSchedulePriority.preferred(among: names, priorities: ["乙": 2, "甲": 1]) == "b", "实时活动取优先级最高的课")
        expect(NativeSchedulePriority.preferred(among: names, priorities: [:]) == nil, "都没设优先级时不替用户选")
        expect(NativeSchedulePriority.preferred(among: names, priorities: ["乙": 2, "甲": 2]) == nil, "并列最高时不替用户选")

        // The edit payload: a missing field decodes to no priorities, and the field is always sent.
        let old = try? JSONDecoder().decode(NativeScheduleEditState.self, from: Data(#"{"hidden":[],"custom":[]}"#.utf8))
        expect(old?.priority == [:], "旧数据没有优先级字段")
        let sent = (try? JSONEncoder().encode(NativeScheduleEditState())).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        expect(sent.contains("\"priority\":{}"), "保存时总是带上优先级字段")
        let saved = try? JSONDecoder().decode(
            NativeScheduleEditState.self, from: Data(#"{"hidden":["k"],"custom":[],"priority":{"药理学":2}}"#.utf8)
        )
        expect(saved?.priority == ["药理学": 2] && saved?.hidden == ["k"], "读取已保存的优先级")

        if failures > 0 { exit(1) }
        print("Native schedule priority checks passed")
    }
}
