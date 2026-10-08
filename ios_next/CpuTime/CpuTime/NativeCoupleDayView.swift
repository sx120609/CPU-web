import SwiftUI

/// The day view while the couple timetable is on, the same in every style:
/// the period axis runs down the middle, the user's courses are on its left
/// and the partner's on its right, each in that person's colour. Each side
/// lays out its own overlaps and neither gives up width to the other.
@available(iOS 17.0, *)
struct ScheduleCoupleDayView: View {
    static let rowHeight: CGFloat = 50
    static let rowGap: CGFloat = 3
    static let headingHeight: CGFloat = 26
    private static let axisWidth: CGFloat = 54
    private static let gap: CGFloat = 6

    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme

    let layer: NativeCoupleLayer
    let mine: [NativeScheduleCourseBlock]
    let theirs: [NativeScheduleCourseBlock]
    var clocks: [ScheduleSlot] = ScheduleSlot.all
    /// Set only when the page is today and "now" is marked.
    var nowMinutes: Int? = nil
    var showLocation = true
    let onCourseSelected: (NativeScheduleCourseBlock) -> Void
    let onEmptySlot: (Int) -> Void

    static func height(slotCount: Int = ScheduleSlot.all.count) -> CGFloat {
        headingHeight + CGFloat(slotCount) * rowHeight + CGFloat(max(0, slotCount - 1)) * rowGap
    }

    private var dark: Bool { scheme == .dark }
    private var stride: CGFloat { Self.rowHeight + Self.rowGap }
    private var gridHeight: CGFloat { Self.height(slotCount: clocks.count) - Self.headingHeight }

    /// The classes both attend carry a heart on each side.
    private var shared: Set<String> {
        CoupleRules.sharedKeys(mine: mine.map(Self.piece), theirs: theirs.map(Self.piece))
    }

    private static func piece(_ block: NativeScheduleCourseBlock) -> CoupleRules.Piece {
        .init(startSlot: block.courseStartSlot, endSlot: block.courseEndSlot, name: block.course.name)
    }

    var body: some View {
        GeometryReader { geometry in
            let column = max(60, (geometry.size.width - Self.axisWidth - 2 * Self.gap) / 2)
            VStack(spacing: 0) {
                HStack(spacing: Self.gap) {
                    Text("我")
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .foregroundStyle(ownHeading.text.color)
                        .background(ownHeading.fill.color, in: Capsule())
                        .overlay { Capsule().strokeBorder(ownHeading.border.color, lineWidth: 1) }
                        .frame(width: column)
                    Text("节次").frame(width: Self.axisWidth)
                    Text(layer.partnerName.isEmpty ? "TA" : layer.partnerName)
                        .lineLimit(1)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .foregroundStyle(partnerHeading.text.color)
                        .background(partnerHeading.fill.color, in: Capsule())
                        .overlay { Capsule().strokeBorder(partnerHeading.border.color, lineWidth: 1) }
                        .frame(width: column)
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.scheduleMeta)
                .frame(height: Self.headingHeight, alignment: .top)

                HStack(alignment: .top, spacing: Self.gap) {
                    side(mine, width: column, partner: false)
                    axis
                    side(theirs, width: column, partner: true)
                }
                .overlay(alignment: .topLeading) {
                    if let y = nowOffset {
                        // Across the two columns only: the axis marks the period itself.
                        HStack(spacing: Self.axisWidth + 2 * Self.gap) {
                            Rectangle().fill(Color.cpuBrand).frame(width: column, height: 1.5)
                            Rectangle().fill(Color.cpuBrand).frame(width: column, height: 1.5)
                        }
                        .offset(y: y).allowsHitTesting(false).accessibilityHidden(true)
                    }
                }
            }
        }
        .frame(height: Self.height(slotCount: clocks.count))
    }

    private var partnerHeading: CoupleTint { CoupleRules.personTone(color: layer.partnerColor, dark: dark) }
    private var ownHeading: CoupleTint { CoupleRules.personTone(color: layer.myColor, dark: dark) }

    // MARK: Axis

    private func minutes(_ value: String) -> Int? { CoupleRules.clockMinutes(value) }

    private func isCurrent(_ slot: ScheduleSlot) -> Bool {
        guard let nowMinutes, let start = minutes(slot.start), let end = minutes(slot.end) else { return false }
        return start <= nowMinutes && nowMinutes < end
    }

    /// The line for "now": inside a period by its share of the period, and
    /// between two periods on the gap.
    private var nowOffset: CGFloat? {
        guard let nowMinutes else { return nil }
        for (index, slot) in clocks.enumerated() {
            guard let start = minutes(slot.start), let end = minutes(slot.end), end > start else { continue }
            if nowMinutes < start {
                return index == 0 ? nil : CGFloat(index) * stride - Self.rowGap / 2
            }
            if nowMinutes < end {
                return CGFloat(index) * stride + Self.rowHeight * CGFloat(nowMinutes - start) / CGFloat(end - start)
            }
        }
        return nil
    }

    private var axis: some View {
        VStack(spacing: Self.rowGap) {
            ForEach(clocks, id: \.number) { slot in
                let current = isCurrent(slot)
                VStack(spacing: 1) {
                    Text("\(slot.number)").font(.system(size: 14, weight: .bold))
                    Text(slot.start).font(.system(size: 10, weight: .medium))
                }
                .monospacedDigit()
                .foregroundStyle(current ? AnyShapeStyle(Color.white) : AnyShapeStyle(style.inkColor(dark: dark)))
                .frame(width: Self.axisWidth, height: Self.rowHeight)
                .background {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(current ? AnyShapeStyle(Color.cpuBrand) : AnyShapeStyle(Color.primary.opacity(dark ? 0.08 : 0.04)))
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("第 \(slot.number) 节，\(slot.start) 至 \(slot.end)\(current ? "，正在上" : "")")
            }
        }
    }

    // MARK: One person's column

    /// Lane count of each block's overlap cluster within its own column.
    private static func lanes(_ blocks: [NativeScheduleCourseBlock]) -> [String: Int] {
        var counts: [String: Int] = [:]
        var cluster: [NativeScheduleCourseBlock] = []
        var clusterEnd = Int.min
        func flush() {
            let lanes = max(1, (cluster.map(\.lane).max() ?? 0) + 1)
            for block in cluster { counts[block.id] = lanes }
            cluster.removeAll()
        }
        for block in blocks.sorted(by: { ($0.startSlot, $0.endSlot) < ($1.startSlot, $1.endSlot) }) {
            if !cluster.isEmpty && block.startSlot > clusterEnd { flush() }
            cluster.append(block)
            clusterEnd = cluster.count == 1 ? block.endSlot : max(clusterEnd, block.endSlot)
        }
        flush()
        return counts
    }

    private func frame(_ block: NativeScheduleCourseBlock, lanes: Int, width: CGFloat) -> CGRect {
        let lane = width / CGFloat(lanes)
        return CGRect(
            x: CGFloat(block.lane) * lane,
            y: CGFloat(block.startSlot - 1) * stride,
            width: max(12, lane - (lanes > 1 ? 2 : 0)),
            height: CGFloat(block.endSlot - block.startSlot + 1) * Self.rowHeight
                + CGFloat(block.endSlot - block.startSlot) * Self.rowGap
        )
    }

    private func side(_ blocks: [NativeScheduleCourseBlock], width: CGFloat, partner: Bool) -> some View {
        let counts = Self.lanes(blocks)
        let together = shared
        return ZStack(alignment: .topLeading) {
            VStack(spacing: Self.rowGap) {
                ForEach(clocks, id: \.number) { _ in
                    // A free period: a faint rounded base instead of a rule.
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(style.inkColor(dark: dark).opacity(dark ? 0.05 : 0.025))
                        .frame(width: width, height: Self.rowHeight)
                }
            }
            .accessibilityHidden(true)
            ForEach(blocks) { block in
                let frame = frame(block, lanes: counts[block.id] ?? 1, width: width)
                tile(block, partner: partner, together: together.contains(CoupleRules.key(Self.piece(block))))
                    .frame(width: frame.width, height: frame.height)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { onCourseSelected(block) }
                    .offset(x: frame.minX, y: frame.minY)
            }
        }
        .frame(width: width, height: gridHeight, alignment: .topLeading)
        .contentShape(Rectangle())
        // Resolve the tapped point against the drawn frames, so a course
        // always wins over the empty period beneath it.
        .highPriorityGesture(
            SpatialTapGesture().onEnded { value in
                if let block = blocks.reversed().first(where: {
                    frame($0, lanes: counts[$0.id] ?? 1, width: width).contains(value.location)
                }) {
                    onCourseSelected(block)
                } else if !partner, value.location.y >= 0 {
                    // Only the user's own side adds a course.
                    let index = Int(value.location.y / stride)
                    if clocks.indices.contains(index) { onEmptySlot(clocks[index].number) }
                }
            }
        )
    }

    private struct Colors {
        let fill: Color
        let border: Color
        let text: Color
    }

    /// One colour per person: the user's on the left, the partner's on the right.
    private func colors(partner: Bool) -> Colors {
        let tint = CoupleRules.personTone(color: partner ? layer.partnerColor : layer.myColor, dark: dark)
        return Colors(fill: tint.fill.color, border: tint.border.color, text: tint.text.color)
    }

    private func tile(_ block: NativeScheduleCourseBlock, partner: Bool, together: Bool) -> some View {
        let colors = colors(partner: partner)
        let span = block.endSlot - block.startSlot + 1
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        let start = block.course.customStartTime?.trimmedNonEmpty ?? clocks.first { $0.number == block.courseStartSlot }?.start
        let end = block.course.customEndTime?.trimmedNonEmpty ?? clocks.first { $0.number == block.courseEndSlot }?.end
        return VStack(alignment: .leading, spacing: 2) {
            Text(block.course.name)
                .font(.system(size: 13, weight: .bold, design: style == .classic ? .default : style.textDesign))
                .lineLimit(2)
                .minimumScaleFactor(0.85)
            if showLocation, let location = ScheduleStyleTime.location(block.course.location) {
                Text("@\(location)").font(.system(size: 10, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.85)
            }
            if span > 1, let start, let end {
                Text("\(start)–\(end)").font(.system(size: 10, weight: .medium)).monospacedDigit().opacity(0.82).lineLimit(1)
            }
        }
        .foregroundStyle(colors.text)
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background { shape.fill(colors.fill) }
        // A bar in the person's colour down the leading edge, and only a faint line round the block.
        .overlay(alignment: .leading) {
            Capsule().fill(colors.border).frame(width: 3).padding(.vertical, 6).padding(.leading, 4)
        }
        .overlay { shape.strokeBorder(colors.border.opacity(0.28), lineWidth: 0.8) }
        .overlay(alignment: .topTrailing) { if together { ScheduleCoupleHeart().padding(4) } }
        .clipShape(shape)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([partner ? layer.ownerTitle : (together ? "一起上的课" : "我的课"), block.course.name,
                             showLocation ? ScheduleStyleTime.location(block.course.location) : nil,
                             start.flatMap { start in end.map { "\(start) 至 \($0)" } }]
            .compactMap { $0 }.joined(separator: "，"))
    }
}
