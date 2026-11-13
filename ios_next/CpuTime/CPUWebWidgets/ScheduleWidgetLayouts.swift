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

// MARK: - Text size

/// Draws a widget's content at the chosen text size by scaling the whole
/// content: it is laid out in a canvas `1 / scale` the size of the widget and
/// scaled back up, so type, colour bars and gaps keep their proportions and
/// every fitting ladder inside (how many courses, one-line titles…) answers to
/// the room that is really left. A larger size shows fewer courses and counts
/// the rest in 后面还有 N 门课; it never pushes content out of the widget.
///
/// 自适应 tries its scales from the largest: the first at which the content's
/// fullest arrangement fits is used, so a light day is drawn larger and a full
/// day at the standard size.
@available(iOS 17.0, *)
struct WidgetTextScaled<Content: View>: View {
    let size: ScheduleWidgetTextSize
    @ViewBuilder let content: () -> Content

    var body: some View {
        let scales = size.scales
        if scales == [1] {
            content()
        } else {
            WidgetScaleLayout(scales: scales) {
                ForEach(scales, id: \.self) { scale in
                    content()
                        // Fill the canvas like the system's own centring would.
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .scaleEffect(scale, anchor: .topLeading)
                }
            }
        }
    }
}

/// One subview per scale, each already scaled about its top leading corner.
/// A scale effect does not change a view's layout size, so each is measured
/// and placed in its own unscaled canvas.
@available(iOS 17.0, *)
struct WidgetScaleLayout: Layout {
    let scales: [CGFloat]

    func makeCache(subviews: Subviews) -> WidgetLayoutMeasurementCache { .init() }

    func updateCache(_ cache: inout WidgetLayoutMeasurementCache, subviews: Subviews) { cache = .init() }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) -> CGSize {
        guard let last = subviews.indices.last, last < scales.count else { return .zero }
        if let width = proposal.width, let height = proposal.height, width.isFinite, height.isFinite {
            return CGSize(width: width, height: height)
        }
        let scale = scales[last]
        let ideal = idealSize(at: last, width: proposal.width.map { $0 / scale }, subviews: subviews, cache: &cache)
        return CGSize(width: proposal.width ?? ideal.width * scale, height: proposal.height ?? ideal.height * scale)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) {
        guard !subviews.isEmpty, subviews.count <= scales.count else { return }
        let index = chosen(in: bounds.size, subviews: subviews, cache: &cache)
        for (offset, subview) in subviews.enumerated() {
            if offset == index {
                let scale = scales[offset]
                subview.place(
                    at: bounds.origin,
                    anchor: .topLeading,
                    proposal: ProposedViewSize(width: bounds.width / scale, height: bounds.height / scale)
                )
            } else {
                subview.place(at: CGPoint(x: bounds.minX, y: bounds.minY - 10_000), anchor: .topLeading, proposal: .zero)
            }
        }
    }

    private func idealSize(at index: Int, width: CGFloat?, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) -> CGSize {
        let proposal = ProposedViewSize(width: width, height: nil)
        return cache.size(of: index, proposal: proposal) { subviews[index].sizeThatFits(proposal) }
    }

    private func chosen(in size: CGSize, subviews: Subviews, cache: inout WidgetLayoutMeasurementCache) -> Int {
        guard subviews.count > 1 else { return 0 }
        return subviews.indices.first { index in
            let scale = scales[index]
            let ideal = idealSize(at: index, width: size.width / scale, subviews: subviews, cache: &cache)
            return ideal.height * scale <= size.height + 0.5
        } ?? subviews.count - 1
    }
}
