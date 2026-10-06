import Foundation

@main
struct ChineseCalendarChecks {
    static var failures = 0

    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() {
            failures += 1
            print("FAIL: \(message)")
        }
    }

    static func holiday(_ date: String) -> String? {
        ChineseCalendarInfo.info(forDate: date)?.badge
    }

    static func main() {
        // Qingming by the solar-term formula. 2062 is the first year the old
        // four-year cycle got wrong (it gave April 5).
        for (date, other) in [("2024-04-04", "2024-04-05"), ("2025-04-04", "2025-04-05"),
                              ("2026-04-05", "2026-04-04"), ("2027-04-05", "2027-04-04"),
                              ("2028-04-04", "2028-04-05"), ("2062-04-04", "2062-04-05")] {
            expect(holiday(date) == "清明节", "\(date) 应为清明节")
            expect(holiday(other) != "清明节", "\(other) 不应为清明节")
        }

        // A published New Year break that starts on December 31 belongs to the
        // next year's holiday. It must not remove this year's own January 1.
        expect(ChineseCalendarInfo.info(forDate: "2026-01-01")?.isStatutoryHoliday == true, "默认 2026 元旦")
        ChineseCalendarInfo.usePublishedHolidays([
            PublishedHoliday(date: "2026-12-31", name: "元旦"),
            PublishedHoliday(date: "2027-01-01", name: "元旦"),
            PublishedHoliday(date: "2027-01-02", name: "元旦"),
        ])
        expect(holiday("2026-01-01") == "元旦", "跨年元旦安排不应删掉 2026-01-01 的元旦")
        expect(ChineseCalendarInfo.info(forDate: "2026-12-31")?.isStatutoryHoliday == true, "2026-12-31 按发布的安排放假")
        expect(ChineseCalendarInfo.info(forDate: "2027-01-02")?.isStatutoryHoliday == true, "2027-01-02 按发布的安排放假")

        // A published window replaces the locally computed one for the same holiday.
        ChineseCalendarInfo.usePublishedHolidays([
            PublishedHoliday(date: "2026-10-01", name: "国庆节"),
            PublishedHoliday(date: "2026-10-02", name: "国庆节"),
            PublishedHoliday(date: "2026-10-03", name: "国庆节"),
            PublishedHoliday(date: "2026-10-04", name: "国庆节"),
        ])
        expect(holiday("2026-10-04") == "国庆节", "发布的国庆假期延长到 10-04")
        ChineseCalendarInfo.usePublishedHolidays([])
        expect(holiday("2026-10-04") != "国庆节", "清空发布的安排后恢复离线推算")

        if failures > 0 { exit(1) }
        print("Chinese calendar checks passed: Qingming formula, cross-year New Year, published overrides")
    }
}
