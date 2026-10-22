import CoreGraphics

/// How the week grid shares its days between the two halves of a partly
/// folded iPhone Duo, so that no day's column lies across the fold.
///
/// Each half becomes a grid of its own, with its own period axis, and the
/// fold between them is left empty. The days are divided where the narrower
/// half's columns come out widest; when both ways are as good, the leading
/// half takes the extra day.
nonisolated struct ScheduleFoldSplit: Equatable, Sendable {
    /// The number of days on the leading half.
    let leadingCount: Int
    /// From the grid's leading edge to the fold.
    let leadingWidth: CGFloat
    /// The fold itself, margins included.
    let foldWidth: CGFloat
    /// From the fold to the grid's trailing edge.
    let trailingWidth: CGFloat

    /// Below this a half is too narrow for a day column, and the grid is
    /// drawn whole across the fold instead.
    static let minimumColumnWidth: CGFloat = 40

    /// - Parameters:
    ///   - contentWidth: The grid's width.
    ///   - fold: The fold's span across the grid, in the grid's coordinates.
    ///   - dayCount: The number of day columns.
    ///   - columnWidth: The width of each column when a grid of the given
    ///     width holds the given number of days.
    init?(contentWidth: CGFloat, fold: ClosedRange<CGFloat>, dayCount: Int,
          columnWidth: (CGFloat, Int) -> CGFloat) {
        guard dayCount > 1, fold.lowerBound > 0, fold.upperBound < contentWidth else { return nil }
        let leadingWidth = fold.lowerBound
        let trailingWidth = contentWidth - fold.upperBound
        let narrowest = (1..<dayCount).map { count in
            (count: count, width: min(columnWidth(leadingWidth, count), columnWidth(trailingWidth, dayCount - count)))
        }
        guard let widest = narrowest.map(\.width).max(), widest >= Self.minimumColumnWidth,
              let best = narrowest.last(where: { $0.width >= widest - 0.5 }) else { return nil }
        self.leadingCount = best.count
        self.leadingWidth = leadingWidth
        self.foldWidth = fold.upperBound - fold.lowerBound
        self.trailingWidth = trailingWidth
    }
}
