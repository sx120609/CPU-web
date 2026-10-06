import Foundation

@main
struct NativeCourseArrangementChecks {
    static var failures = 0

    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() {
            failures += 1
            print("FAIL: \(message)")
        }
    }

    static func main() {
        // Runs of consecutive periods.
        expect(NativeCourseArrangement(day: 1, slots: [1, 2, 5, 6, 9]).runs == [1...2, 5...6, 9...9], "不连续节次拆成连续段")
        expect(NativeCourseArrangement(day: 1, slots: []).runs.isEmpty, "没有节次就没有段")
        expect(NativeCourseArrangement(day: 1, slots: [], weekList: []).weeksLabel == "全部周", "空周次表示全部周")
        expect(NativeCourseArrangement(day: 1, slots: [], weekList: [1, 3]).weeksLabel == "第 1,3 周", "周次文案")

        // One item per run; only the first keeps the edited block's identity.
        var counter = 0
        let items = NativeCourseArrangement.customItems(
            details: .init(name: "药理学", teacher: "王老师", location: "药学楼 302", note: ""),
            arrangements: [
                NativeCourseArrangement(day: 2, slots: [3, 4, 7], weekList: [5, 1, 3, 3]),
                NativeCourseArrangement(day: 4, slots: [11, 12]),
            ],
            primaryID: "custom-primary",
            primarySourceKey: "jwxt|2|2|3|4|药理学|王老师|药学楼 302|1-16周",
            makeID: { counter += 1; return "custom-new-\(counter)" }
        )
        expect(items.count == 3, "两组安排、三段节次生成三条")
        expect(items.map(\.id) == ["custom-primary", "custom-new-1", "custom-new-2"], "只有第一段沿用原来的标识")
        expect(items[0].sourceKey != nil && items[1].sourceKey == nil && items[2].sourceKey == nil, "只有第一段关联教务原课")
        expect(items[0].course.sourceKey == items[0].sourceKey && items[0].course.customId == "custom-primary", "课程内的标识与条目一致")
        expect(items.map(\.day) == [2, 2, 4], "星期跟随各自的安排")
        expect(items.map(\.bigSlot) == [2, 4, 6], "大节按起始节次换算")
        expect(items.map { [$0.course.startSlot ?? 0, $0.course.endSlot ?? 0] } == [[3, 4], [7, 7], [11, 12]], "起止节次")
        expect(items[0].course.weekList == [1, 3, 5] && items[1].course.weekList == [1, 3, 5], "周次去重排序")
        expect(items[2].course.weekList.isEmpty && items[2].course.weeks == "全部周", "第二组是全部周")
        expect(items[0].course.slotNote == "第 3-4 节" && items[1].course.slotNote == "第 7-7 节", "没填备注时写节次")
        expect(items.allSatisfy { $0.course.custom && $0.course.name == "药理学" && $0.course.teacher == "王老师" }, "课程信息各段相同")

        let noted = NativeCourseArrangement.customItems(
            details: .init(name: "体育", teacher: "", location: "", note: "带球拍"),
            arrangements: [NativeCourseArrangement(day: 5, slots: [9])],
            primaryID: "custom-a", primarySourceKey: nil, makeID: { "unused" }
        )
        expect(noted.count == 1 && noted[0].course.slotNote == "带球拍" && noted[0].sourceKey == nil, "备注原样保存，纯自定义课程没有来源")

        // The saved items survive the JSON round trip the edit endpoint uses.
        let state = NativeScheduleEditState(hidden: ["k"], custom: items)
        let decoded = try? JSONDecoder().decode(NativeScheduleEditState.self, from: JSONEncoder().encode(state))
        expect(decoded == state, "编辑数据可以原样编解码")

        // Conflicts need a shared weekday, intersecting periods and a common week.
        let cells = [
            NativeScheduleCell(day: 2, bigSlot: 2, courses: [
                NativeScheduleCourse(name: "高等数学", weekList: [1, 3, 5], startSlot: 3, endSlot: 4, sourceKey: "math"),
                NativeScheduleCourse(name: "大学英语", weekList: [2, 4, 6], startSlot: 3, endSlot: 4, sourceKey: "english"),
            ]),
            NativeScheduleCell(day: 2, bigSlot: 4, courses: [NativeScheduleCourse(name: "体育", sourceKey: "pe")]),
            NativeScheduleCell(day: 3, bigSlot: 2, courses: [NativeScheduleCourse(name: "物理", startSlot: 3, endSlot: 4, sourceKey: "physics")]),
        ]
        expect(NativeCourseArrangement(day: 2, slots: [4, 5], weekList: [1]).conflicts(in: cells) == ["高等数学"], "同周同节才算重叠")
        expect(NativeCourseArrangement(day: 2, slots: [4], weekList: [2]).conflicts(in: cells) == ["大学英语"], "单双周轮流上的课不误报")
        expect(NativeCourseArrangement(day: 2, slots: [3]).conflicts(in: cells) == ["高等数学", "大学英语"], "全部周与两门都重叠")
        expect(NativeCourseArrangement(day: 2, slots: [7, 8], weekList: [9]).conflicts(in: cells) == ["体育"], "没有周次的课每周都上，节次按大节推算")
        expect(NativeCourseArrangement(day: 2, slots: [1, 2]).conflicts(in: cells).isEmpty, "节次不相交")
        expect(NativeCourseArrangement(day: 5, slots: [3]).conflicts(in: cells).isEmpty, "不同星期")
        expect(NativeCourseArrangement(day: 2, slots: [3], weekList: [1]).conflicts(in: cells, ignoring: ["math"]).isEmpty, "不和正在编辑的课自己冲突")

        if failures > 0 { exit(1) }
        print("Course arrangement checks passed: runs, edit items, identity, weeks, round trip and conflicts")
    }
}
