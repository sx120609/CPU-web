import CoreGraphics

@main
struct SchedulePadLayoutChecks {
    static func main() {
        // The classic week grid: a 2-point inset, a 46-point date header, twelve
        // rows with 4 points between them and 4 points under the last.
        let fixed: CGFloat = 2 + 46 + 11 * 4 + 4
        func row(_ available: CGFloat, base: CGFloat = 44) -> CGFloat {
            SchedulePadLayout.stretchedRowHeight(base: base, available: available, fixed: fixed, perRow: 12)
        }
        // An iPad Pro 11-inch upright leaves about 960 points: the rows grow to fill them.
        precondition(row(960) == 72, "\(row(960))")
        precondition(fixed + 12 * row(960) <= 960)
        // A phone, or the iPad on its side: the grid is already taller, so nothing changes.
        precondition(row(560) == 44)
        precondition(row(0) == 44)
        // Never past 2.4 times the chosen height, however tall the window.
        precondition(row(4000) == 105, "\(row(4000))")
        // The user's own row height is the floor, compact or enlarged.
        precondition(row(700, base: 40) == 50)
        precondition(row(700, base: 66) == 66)
        // Degenerate input keeps the base.
        precondition(SchedulePadLayout.stretchedRowHeight(base: 44, available: 900, fixed: 96, perRow: 0) == 44)

        // The side column beside the day view: from 760 points of content, about a third.
        precondition(SchedulePadLayout.sideColumnWidth(contentWidth: 759) == nil)
        precondition(SchedulePadLayout.sideColumnWidth(contentWidth: 358) == nil)
        precondition(SchedulePadLayout.sideColumnWidth(contentWidth: 802) == 300)
        precondition(SchedulePadLayout.sideColumnWidth(contentWidth: 1000) == 340)
        precondition(SchedulePadLayout.sideColumnWidth(contentWidth: 1344) == 380)
        // 当天安排 moves beside the month only when the calendar keeps a phone's width and more.
        precondition(SchedulePadLayout.monthSideColumnWidth(contentWidth: 802) == nil)
        precondition(SchedulePadLayout.monthSideColumnWidth(contentWidth: 1000) == 320)
        precondition(SchedulePadLayout.monthSideColumnWidth(contentWidth: 1344) == 400)

        // The month's rows share the height; five weeks in 700 points.
        let month = SchedulePadLayout.monthRowHeight(base: 88, available: 700, chrome: 38, spacing: 6, weeks: 5)
        precondition(month == 126, "\(month)")
        precondition(SchedulePadLayout.monthRowHeight(base: 88, available: 400, chrome: 38, spacing: 6, weeks: 6) == 88)
        precondition(SchedulePadLayout.monthRowHeight(base: 88, available: 5000, chrome: 38, spacing: 6, weeks: 5) == 211)
        // A phone's cell lists three names; a taller cell lists what fits.
        precondition(SchedulePadLayout.monthLineLimit(rowHeight: 88, reserved: 42, lineHeight: 15) == 3)
        precondition(SchedulePadLayout.monthLineLimit(rowHeight: 104, reserved: 58, lineHeight: 15) == 3)
        precondition(SchedulePadLayout.monthLineLimit(rowHeight: 126, reserved: 42, lineHeight: 18) == 4)
        precondition(SchedulePadLayout.monthLineLimit(rowHeight: 60, reserved: 42, lineHeight: 18) == 3)

        // The small month: whole weeks from Monday.
        let november = ScheduleMiniMonthGrid.weeks(month: "2026-11")
        precondition(november.count == 6 && november.allSatisfy { $0.count == 7 }, "\(november.count)")
        precondition(november[0].map(\.date).first == "2026-10-26")
        precondition(november[0][6] == .init(date: "2026-11-01", number: 1, inMonth: true))
        precondition(november[5].map(\.date) == ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03",
                                                 "2026-12-04", "2026-12-05", "2026-12-06"])
        // February 2027 starts on a Monday and fills four weeks exactly.
        let february = ScheduleMiniMonthGrid.weeks(month: "2027-02")
        precondition(february.count == 4 && february.allSatisfy { $0.allSatisfy(\.inMonth) })
        precondition(ScheduleMiniMonthGrid.weeks(month: "2028-02").flatMap { $0 }.filter(\.inMonth).count == 29)
        precondition(ScheduleMiniMonthGrid.weeks(month: "nonsense").isEmpty)
        // Turning the month crosses the year both ways.
        precondition(ScheduleMiniMonthGrid.month("2026-12", offset: 1) == "2027-01")
        precondition(ScheduleMiniMonthGrid.month("2027-01", offset: -1) == "2026-12")
        precondition(ScheduleMiniMonthGrid.month("2026-11-12", offset: 0) == "2026-11")
        print("SchedulePadLayout checks passed")
    }
}
