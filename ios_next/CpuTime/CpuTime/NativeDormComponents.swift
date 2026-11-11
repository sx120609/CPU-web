import SwiftUI

/// Pieces the dorm sheet's pages share: cards, avatars, name chips, the
/// hatching of "no data", and a layout that wraps chips onto new lines.

@available(iOS 17.0, *)
struct DormCard<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

@available(iOS 17.0, *)
struct DormSectionTitle: View {
    let title: String
    var trailing: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            if let trailing { Text(trailing).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.trailing) }
        }
        .padding(.horizontal, 4)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A roommate's initial on their colour.
@available(iOS 17.0, *)
struct DormAvatar: View {
    let name: String
    let color: String
    var size: CGFloat = 36
    /// Drawn without their colour: no timetable to show.
    var faded = false

    var body: some View {
        Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
            .font(.system(size: size * 0.42, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(DormRules.swatch(color).color.opacity(faded ? 0.45 : 1).gradient, in: Circle())
            .accessibilityHidden(true)
    }
}

/// A coloured dot for a roommate, ringed so it reads on any fill.
@available(iOS 17.0, *)
struct DormDot: View {
    let color: String
    var size: CGFloat = 8

    var body: some View {
        Circle()
            .fill(DormRules.swatch(color).color)
            .frame(width: size, height: size)
            .overlay { Circle().strokeBorder(.white.opacity(0.85), lineWidth: size > 7 ? 1 : 0.75) }
            .accessibilityHidden(true)
    }
}

/// A roommate's name on their own tint, optionally with what they are doing.
@available(iOS 17.0, *)
struct DormNameChip: View {
    @Environment(\.colorScheme) private var colorScheme
    let name: String
    let color: String
    var detail: String?

    var body: some View {
        let tone = DormRules.tone(color: color, dark: colorScheme == .dark)
        HStack(spacing: 6) {
            DormDot(color: color, size: 7)
            Text(detail.map { "\(name) · \($0)" } ?? name)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(tone.text.color)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(tone.fill.color, in: Capsule())
    }
}

/// Diagonal lines: a cell or lane nobody has data for.
@available(iOS 17.0, *)
struct DormHatch: View {
    var spacing: CGFloat = 5

    var body: some View {
        Canvas { context, size in
            var path = Path()
            var x = -size.height
            while x < size.width {
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x + size.height, y: 0))
                x += spacing
            }
            context.stroke(path, with: .color(.secondary.opacity(0.32)), lineWidth: 1)
        }
        .background(Color(uiColor: .tertiarySystemFill))
        .accessibilityHidden(true)
    }
}

/// A small coloured note: a warning about missing data, or a plain hint.
@available(iOS 17.0, *)
struct DormNote: View {
    let text: String
    var symbol = "info.circle"
    var tint: Color = .secondary

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: symbol).foregroundStyle(tint).accessibilityHidden(true)
            Text(text).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .font(.footnote)
        .padding(.horizontal, 4)
    }
}

/// An empty, loading or failed page: a symbol, a line, and an optional action.
@available(iOS 17.0, *)
struct DormStateCard<Action: View>: View {
    let symbol: String?
    let title: String
    var message: String?
    var loading = false
    @ViewBuilder var action: Action

    var body: some View {
        DormCard {
            VStack(spacing: 12) {
                if loading {
                    ProgressView().controlSize(.large)
                } else if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 34, weight: .regular))
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
                Text(title).font(.headline).multilineTextAlignment(.center)
                if let message {
                    Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                action
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .padding(.horizontal, 6)
        }
    }
}

@available(iOS 17.0, *)
extension DormStateCard where Action == EmptyView {
    init(symbol: String?, title: String, message: String? = nil, loading: Bool = false) {
        self.init(symbol: symbol, title: title, message: message, loading: loading) { EmptyView() }
    }
}

/// Lays its children out in rows, starting a new row when one is full.
@available(iOS 17.0, *)
struct DormFlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: width.isFinite ? width : nil, height: nil))
            if x > 0, x + size.width > width {
                y += line + lineSpacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            line = max(line, size.height)
        }
        return CGSize(width: width.isFinite ? min(widest, width) : widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += line + lineSpacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

@available(iOS 17.0, *)
enum DormText {
    /// "11月9日".
    static func monthDay(_ date: String) -> String {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return date }
        return "\(parts[1])月\(parts[2])日"
    }

    /// "11-09".
    static func short(_ date: String) -> String { String(date.dropFirst(5)) }

    /// "3 小时前", for a server time; empty when it cannot be read.
    static func synced(_ iso: String, now: Date = .now) -> String {
        let relative = CoupleRules.relative(iso, now: now)
        return relative.isEmpty ? "" : "同步于 \(relative)"
    }

    static func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}
