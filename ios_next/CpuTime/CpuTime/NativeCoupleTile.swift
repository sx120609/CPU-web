import SwiftUI

@available(iOS 17.0, *)
private struct ScheduleCoupleKey: EnvironmentKey {
    static let defaultValue: NativeCoupleLayer? = nil
}

@available(iOS 17.0, *)
extension EnvironmentValues {
    /// The partner's timetable while it is drawn over the grid, else nil.
    var scheduleCouple: NativeCoupleLayer? {
        get { self[ScheduleCoupleKey.self] }
        set { self[ScheduleCoupleKey.self] = newValue }
    }
}

extension CoupleRGB {
    var color: Color { Color(.sRGB, red: Double(red) / 255, green: Double(green) / 255, blue: Double(blue) / 255, opacity: 1) }
}

/// A course tile while the couple timetable is drawn: one colour per person,
/// whatever the course and the style's own palette. The user's courses take
/// the user's colour, the partner's theirs with a small 「TA」 tag on a line
/// of its own above the name. The shape and typeface still follow the style.
@available(iOS 17.0, *)
struct ScheduleCouplePersonTile: View {
    @Environment(\.scheduleStyle) private var style
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scheduleWeekDisplay) private var display
    let course: NativeScheduleCourse
    let layer: NativeCoupleLayer
    /// Whose course it is.
    var partner = true
    var compact = false
    var showLocation = true
    /// What the partner does during this course of the user's.
    var note: ScheduleCoupleNote.Kind? = nil
    /// One of three or more side by side: the name and nothing else.
    var tiny = false

    private var radius: CGFloat { style == .classic ? 9 : max(2, CGFloat(style.layout.cornerRadius)) }

    var body: some View {
        let tint = CoupleRules.personTone(color: partner ? layer.partnerColor : layer.myColor, dark: scheme == .dark)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        let note = tiny ? nil : note
        GeometryReader { geometry in
            let short = geometry.size.height - (note == nil ? 0 : ScheduleCoupleNote.reserve) < 64
            let small = compact || short
            VStack(alignment: .center, spacing: small ? 2 : 4) {
                if partner, !tiny { ScheduleCoupleTag(tint: tint) }
                Text(course.name)
                    .font(.system(size: (small ? 10 : 12) * display.textScale, weight: .bold,
                                  design: style == .classic ? .default : style.textDesign))
                    .lineLimit(short ? 2 : (compact ? 4 : 3))
                    .minimumScaleFactor(0.85)
                    .layoutPriority(1)
                if showLocation, !tiny, !(short && (partner || note != nil)),
                   let location = ScheduleStyleTime.location(course.location) {
                    Text("@\(location)")
                        .font(.system(size: 9 * display.textScale, weight: .semibold))
                        .lineLimit(short ? 1 : 2)
                        .minimumScaleFactor(0.85)
                }
            }
            .multilineTextAlignment(.center)
            .foregroundStyle(tint.text.color)
            .padding(.horizontal, tiny ? 1 : 3)
            .padding(.top, short ? 3 : 5)
            .padding(.bottom, (short ? 3 : 5) + (note == nil ? 0 : ScheduleCoupleNote.reserve - 2))
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .center)
            .overlay(alignment: .bottom) {
                if let note { ScheduleCoupleNote(kind: note, layer: layer).padding(.horizontal, 1.5).padding(.bottom, 2) }
            }
        }
        .background { shape.fill(tint.fill.color) }
        .overlay { shape.strokeBorder(tint.border.color, lineWidth: 1.2) }
        .clipShape(shape)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([partner ? layer.ownerTitle : "我的课", course.name, showLocation ? ScheduleStyleTime.location(course.location) : nil]
            .compactMap { $0 }.joined(separator: "，"))
    }
}

/// 「TA」 above the name of a course of the partner's: an outlined capsule
/// in the tile's text colour, in the flow so it never covers the name.
@available(iOS 17.0, *)
struct ScheduleCoupleTag: View {
    let tint: CoupleTint

    var body: some View {
        Text("TA")
            .font(.system(size: 8, weight: .bold))
            .tracking(0.3)
            .foregroundStyle(tint.text.color)
            .padding(.horizontal, 4)
            .frame(height: 12)
            .overlay { Capsule().strokeBorder(tint.text.color.opacity(0.45), lineWidth: 1) }
            .fixedSize()
            .accessibilityHidden(true)
    }
}

/// The line at the foot of a course of the user's that says what the partner
/// does meanwhile: 「TA 中药化学」 when they have a class of their own then,
/// 「一起」 when the two sit in the same one.
@available(iOS 17.0, *)
struct ScheduleCoupleNote: View {
    enum Kind {
        case together
        /// The partner's courses during this one, earliest first.
        case partner([NativeScheduleCourseBlock])
    }

    static let height: CGFloat = 15
    /// What the tile's text gives up at the bottom for the line.
    static let reserve: CGFloat = 19

    /// The line for one of the user's blocks. `clashes` are the partner's
    /// courses of the day that meet any of the user's.
    static func kind(for block: NativeScheduleCourseBlock, clashes: [NativeScheduleCourseBlock]) -> Kind? {
        if block.owner == .both { return .together }
        guard block.owner == .mine, block.coupleMeets else { return nil }
        let during = clashes.filter { $0.courseStartSlot <= block.courseEndSlot && block.courseStartSlot <= $0.courseEndSlot }
        return during.isEmpty ? nil : .partner(during)
    }

    /// The part of a tile's frame the line is tapped in.
    static func tapArea(in tile: CGRect) -> CGRect {
        CGRect(x: tile.minX, y: tile.maxY - reserve - 3, width: tile.width, height: reserve + 3)
    }

    /// One line at its natural width, cut at the capsule's edge. A week
    /// column is too narrow to spend any of it on an ellipsis.
    private struct Line: ViewModifier {
        func body(content: Content) -> some View {
            Color.clear
                .frame(maxWidth: .infinity, minHeight: ScheduleCoupleNote.height, maxHeight: ScheduleCoupleNote.height)
                .overlay(alignment: .leading) { content.lineLimit(1).fixedSize().padding(.leading, 4) }
                .clipped()
                .padding(.trailing, 3)
        }
    }

    @Environment(\.colorScheme) private var scheme
    let kind: Kind
    let layer: NativeCoupleLayer

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        switch kind {
        case .together:
            HStack(spacing: 2) {
                Image(systemName: "heart.fill").font(.system(size: 8))
                Text("一起").font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(CoupleRGB.heart.color)
            .modifier(Line())
            .background {
                shape.fill(Color(uiColor: .systemBackground)).overlay { shape.fill(CoupleRGB.heart.color.opacity(0.12)) }
            }
            .overlay { shape.strokeBorder(CoupleRGB.heart.color.opacity(0.22), lineWidth: 1) }
            .accessibilityLabel("一起上的课")
        case .partner(let blocks):
            let tint = CoupleRules.personTone(color: layer.partnerColor, dark: scheme == .dark)
            let text = blocks.count == 1 ? blocks[0].course.name : "\(blocks.count) 门课"
            HStack(spacing: 2) {
                Text("TA").font(.system(size: 8, weight: .heavy)).tracking(0.3)
                Text(text).font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(tint.text.color)
            .modifier(Line())
            .background { shape.fill(tint.fill.color) }
            .overlay { shape.strokeBorder(tint.text.color.opacity(0.22), lineWidth: 1) }
            .accessibilityLabel("\(layer.ownerTitle)，\(blocks.map(\.course.name).joined(separator: "、"))")
            .accessibilityAddTraits(.isButton)
        }
    }
}

/// The small heart on a class both attend, in the day view's two columns.
@available(iOS 17.0, *)
struct ScheduleCoupleHeart: View {
    var size: CGFloat = 9

    var body: some View {
        Image(systemName: "heart.fill")
            .font(.system(size: size))
            .foregroundStyle(CoupleRGB.heart.color)
            .accessibilityLabel("一起上的课")
    }
}
