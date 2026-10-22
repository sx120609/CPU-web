import CoreGraphics

@main
struct ScheduleFoldLayoutChecks {
    static func main() {
        // The classic week grid: a 38-point period axis and 4 points before each column.
        let classic: (CGFloat, Int) -> CGFloat = { width, count in
            max(24, (width - 38 - CGFloat(count) * 4) / CGFloat(count))
        }
        func split(_ width: CGFloat, _ fold: ClosedRange<CGFloat>, _ days: Int) -> ScheduleFoldSplit? {
            ScheduleFoldSplit(contentWidth: width, fold: fold, dayCount: days, columnWidth: classic)
        }

        // The open display in the book pose: 951 points less 16 on each side,
        // with the 40-point fold in the middle.
        let week = split(919, 439...479, 7)!
        precondition(week == ScheduleFoldSplit(leadingCount: 4, leadingWidth: 439, foldWidth: 40, trailingWidth: 440), "\(week)")
        // Either way gives about 96-point columns; the leading half takes the extra day.
        precondition(split(919, 439...479, 5)!.leadingCount == 3)
        precondition(split(919, 439...479, 6)!.leadingCount == 3)
        // A fold off the middle leaves fewer days on the shorter side.
        precondition(split(719, 439...479, 7)!.leadingCount == 5)
        precondition(split(1000, 200...240, 7)!.leadingCount == 1)

        // No split: one day, a fold at or past either edge, or a half too narrow for a column.
        precondition(split(919, 439...479, 1) == nil)
        precondition(split(919, 0...40, 7) == nil)
        precondition(split(919, 879...919, 7) == nil)
        precondition(split(919, -20...20, 7) == nil)
        precondition(split(919, 40...80, 7) == nil)
        precondition(split(300, 130...170, 7) == nil)
        print("ScheduleFoldLayout checks passed")
    }
}

extension ScheduleFoldSplit {
    init(leadingCount: Int, leadingWidth: CGFloat, foldWidth: CGFloat, trailingWidth: CGFloat) {
        self.leadingCount = leadingCount
        self.leadingWidth = leadingWidth
        self.foldWidth = foldWidth
        self.trailingWidth = trailingWidth
    }
}
