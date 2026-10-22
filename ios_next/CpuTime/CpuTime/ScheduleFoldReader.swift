import SwiftUI

extension GeometryProxy {
    /// The fold of a partly folded iPhone Duo when it runs down this view
    /// from top to bottom: the span of x it takes in the view's coordinates,
    /// margins included. Lying flat, closed, or with the fold across the
    /// view (the open display turned upright), there is none.
    nonisolated var verticalFold: ClosedRange<CGFloat>? {
#if DEBUG
        // `CPU_DEBUG_FOLD=455-495` stands in for a partly folded iPhone Duo
        // on any simulator: a fold over that span of the window, in points.
        if let raw = ProcessInfo.processInfo.environment["CPU_DEBUG_FOLD"] {
            let ends = raw.split(separator: "-").compactMap { Double($0) }
            guard ends.count == 2, ends[0] < ends[1] else { return nil }
            let origin = frame(in: .global).minX
            return (ends[0] - origin)...(ends[1] - origin)
        }
#endif
        guard #available(iOS 27.1, *) else { return nil }
        let width = size.width
        return reservedRegions(kind: .division)
            .filter(\.isActive)
            .map(\.frame)
            .first { $0.height > $0.width && $0.minX > 0 && $0.maxX < width }
            .map { $0.minX...$0.maxX }
    }
}

/// A row of equally wide day cells that leaves the fold of a partly folded
/// iPhone Duo empty: the days before it share the leading half and the rest
/// the trailing half. Elsewhere it is a plain row. Each cell should take
/// `maxWidth: .infinity`.
@available(iOS 17.0, *)
struct ScheduleFoldRow<Cell: View>: View {
    let count: Int
    let spacing: CGFloat
    @ViewBuilder let cell: (Int) -> Cell
    @State private var geometry = ScheduleFoldGeometry()

    var body: some View {
        Group {
            if let fold = geometry.fold,
               let split = ScheduleFoldSplit(contentWidth: geometry.width, fold: fold, dayCount: count,
                                             columnWidth: { width, count in
                                                 (width - CGFloat(count - 1) * spacing) / CGFloat(count)
                                             }) {
                HStack(spacing: split.foldWidth) {
                    HStack(spacing: spacing) { ForEach(0..<split.leadingCount, id: \.self) { cell($0) } }
                        .frame(width: split.leadingWidth)
                    HStack(spacing: spacing) { ForEach(split.leadingCount..<count, id: \.self) { cell($0) } }
                        .frame(width: split.trailingWidth)
                }
            } else {
                HStack(spacing: spacing) { ForEach(0..<count, id: \.self) { cell($0) } }
            }
        }
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: ScheduleFoldGeometry.self) { proxy in
            ScheduleFoldGeometry(width: proxy.size.width, fold: proxy.verticalFold)
        } action: { geometry = $0 }
    }
}

private nonisolated struct ScheduleFoldGeometry: Equatable, Sendable {
    var width: CGFloat = 0
    var fold: ClosedRange<CGFloat>?
}
