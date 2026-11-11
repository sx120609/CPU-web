import SwiftUI

// Layouts of the schedule widgets, from NapTable. Measurements are cached per
// subview and proposal (at most eight proposals) so a ViewThatFits ladder does
// not measure the same card again and again: widgets have a small CPU budget.

@available(iOS 17.0, *)
nonisolated struct ProportionalWeight: LayoutValueKey {
    static let defaultValue: CGFloat = 0
}

@available(iOS 17.0, *)
nonisolated struct ProportionalMaxHeight: LayoutValueKey {
    static let defaultValue: CGFloat = .infinity
}

@available(iOS 17.0, *)
struct WidgetLayoutMeasurementCache {
    private struct Proposal: Hashable {
        let width: CGFloat?
        let height: CGFloat?
    }

    private var measurements: [Proposal: [Int: CGSize]] = [:]

    mutating func size(of index: Int, proposal: ProposedViewSize, measure: () -> CGSize) -> CGSize {
        let key = Proposal(width: proposal.width, height: proposal.height)
        if let size = measurements[key]?[index] { return size }
        let size = measure()
        if measurements[key] == nil && measurements.count >= 8 {
            measurements.removeAll(keepingCapacity: true)
        }
        measurements[key, default: [:]][index] = size
        return size
    }
}

@available(iOS 17.0, *)
struct ProportionalStack: Layout {
    func makeCache(subviews: Subviews) -> WidgetLayoutMeasurementCache { .init() }

    func updateCache(_ cache: inout WidgetLayoutMeasurementCache, subviews: Subviews) { cache = .init() }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) -> CGSize {
        let width = proposal.width ?? subviews.indices.map { index in
            cache.size(of: index, proposal: .unspecified) { subviews[index].sizeThatFits(.unspecified) }.width
        }.max() ?? 0
        let heights = heights(width: width, height: proposal.height, subviews: subviews, cache: &cache)
        return CGSize(width: width, height: heights.reduce(0, +))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) {
        let heights = heights(width: bounds.width, height: bounds.height, subviews: subviews, cache: &cache)
        var position = bounds.minY
        for (subview, height) in zip(subviews, heights) {
            subview.place(
                at: CGPoint(x: bounds.minX, y: position),
                anchor: .topLeading,
                proposal: ProposedViewSize(width: bounds.width, height: height)
            )
            position += height
        }
    }

    private func heights(width: CGFloat, height: CGFloat?, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) -> [CGFloat] {
        let proposal = ProposedViewSize(width: width, height: nil)
        let ideal = subviews.indices.map { index in
            cache.size(of: index, proposal: proposal) { subviews[index].sizeThatFits(proposal) }.height
        }
        guard let height, height > ideal.reduce(0, +) else { return ideal }
        let caps = zip(subviews, ideal).map { subview, ideal in
            let limit = subview[ProportionalMaxHeight.self]
            return limit.isFinite ? max(limit, ideal) : ideal
        }
        guard height.isFinite else { return caps }
        let weights = subviews.map { $0[ProportionalWeight.self] }
        func layout(_ scale: CGFloat) -> [CGFloat] {
            subviews.indices.map { min(max(weights[$0] * scale, ideal[$0]), caps[$0]) }
        }
        var low: CGFloat = 0
        var high: CGFloat = 1
        while layout(high).reduce(0, +) < height && high < 64 { high *= 2 }
        for _ in 0..<24 {
            let middle = (low + high) / 2
            if layout(middle).reduce(0, +) < height { low = middle } else { high = middle }
        }
        return layout(low)
    }
}

@available(iOS 17.0, *)
struct FirstThatFitsVertically: Layout {
    func makeCache(subviews: Subviews) -> WidgetLayoutMeasurementCache { .init() }

    func updateCache(_ cache: inout WidgetLayoutMeasurementCache, subviews: Subviews) { cache = .init() }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) -> CGSize {
        guard let last = subviews.indices.last else { return .zero }
        let width = proposal.width
        guard let height = proposal.height, height.isFinite else {
            return idealSize(at: last, width: width, subviews: subviews, cache: &cache)
        }
        let index = chosen(width: width, height: height, subviews: subviews, cache: &cache)
        let ideal = idealSize(at: index, width: width, subviews: subviews, cache: &cache)
        return CGSize(width: width ?? ideal.width, height: max(height, ideal.height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) {
        guard !subviews.isEmpty else { return }
        let index = chosen(width: bounds.width, height: bounds.height, subviews: subviews, cache: &cache)
        for (offset, subview) in subviews.enumerated() {
            if offset == index {
                subview.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size))
            } else {
                subview.place(at: CGPoint(x: bounds.minX, y: bounds.minY - 10_000), anchor: .topLeading, proposal: .zero)
            }
        }
    }

    private func idealSize(at index: Int, width: CGFloat?, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) -> CGSize {
        let proposal = ProposedViewSize(width: width, height: nil)
        return cache.size(of: index, proposal: proposal) { subviews[index].sizeThatFits(proposal) }
    }

    private func chosen(width: CGFloat?, height: CGFloat, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) -> Int {
        subviews.indices.first { idealSize(at: $0, width: width, subviews: subviews, cache: &cache).height <= height + 0.5 }
            ?? subviews.count - 1
    }
}

@available(iOS 17.0, *)
struct FirstThatFitsHorizontally: Layout {
    func makeCache(subviews: Subviews) -> WidgetLayoutMeasurementCache { .init() }

    func updateCache(_ cache: inout WidgetLayoutMeasurementCache, subviews: Subviews) { cache = .init() }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) -> CGSize {
        guard !subviews.isEmpty else { return .zero }
        let index = chosen(width: proposal.width, subviews: subviews, cache: &cache)
        return cache.size(of: index, proposal: proposal) { subviews[index].sizeThatFits(proposal) }
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) {
        guard !subviews.isEmpty else { return }
        let index = chosen(width: bounds.width, subviews: subviews, cache: &cache)
        for (offset, subview) in subviews.enumerated() {
            if offset == index {
                subview.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size))
            } else {
                subview.place(at: CGPoint(x: bounds.minX, y: bounds.minY - 10_000), anchor: .topLeading, proposal: .zero)
            }
        }
    }

    private func chosen(width: CGFloat?, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) -> Int {
        guard let width else { return 0 }
        return subviews.indices.first { index in
            cache.size(of: index, proposal: .unspecified) { subviews[index].sizeThatFits(.unspecified) }.width <= width + 0.5
        } ?? subviews.count - 1
    }
}
