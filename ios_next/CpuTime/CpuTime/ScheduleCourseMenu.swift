import SwiftUI

/// One command of a course's long-press menu.
struct ScheduleCourseMenuAction: Identifiable {
    let id: String
    let title: String
    let systemImage: String
    var role: ButtonRole? = nil
    let perform: () -> Void

    init(_ title: String, systemImage: String, role: ButtonRole? = nil, perform: @escaping () -> Void) {
        id = title
        self.title = title
        self.systemImage = systemImage
        self.role = role
        self.perform = perform
    }
}

/// What a long press on a course shows: the commands in groups, and the
/// larger card above them. The timetable page supplies it; every style's
/// course cards read it from the environment.
struct ScheduleCourseMenuProvider {
    let sections: (NativeScheduleCourseBlock) -> [[ScheduleCourseMenuAction]]
    let preview: (NativeScheduleCourseBlock) -> AnyView
}

private struct ScheduleCourseMenuKey: EnvironmentKey {
    static let defaultValue: ScheduleCourseMenuProvider? = nil
}

extension EnvironmentValues {
    var scheduleCourseMenu: ScheduleCourseMenuProvider? {
        get { self[ScheduleCourseMenuKey.self] }
        set { self[ScheduleCourseMenuKey.self] = newValue }
    }
}

/// A course card's state for this one meeting, and its long-press menu.
@available(iOS 17.0, *)
private struct ScheduleCourseInteractions: ViewModifier {
    let block: NativeScheduleCourseBlock
    @Environment(\.scheduleCourseMenu) private var menu
    @Environment(\.scheduleStaticRendering) private var staticRendering

    func body(content: Content) -> some View {
        let decorated = content
            .saturation(block.cancelledOccurrence == nil ? 1 : 0)
            .opacity(block.cancelledOccurrence == nil ? 1 : 0.5)
            .overlay { if block.cancelledOccurrence != nil { ScheduleCancelledMark() } }
            .overlay(alignment: .topTrailing) { if block.isMovedOccurrence { ScheduleMovedBadge() } }
        if let menu, !staticRendering {
            let sections = menu.sections(block).filter { !$0.isEmpty }
            if !sections.isEmpty {
                decorated.contextMenu {
                    ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
                        Section {
                            ForEach(section) { action in
                                Button(role: action.role, action: action.perform) {
                                    Label(action.title, systemImage: action.systemImage)
                                }
                            }
                        }
                    }
                } preview: {
                    menu.preview(block)
                }
            } else {
                decorated
            }
        } else {
            decorated
        }
    }
}

extension View {
    /// Greys out a cancelled meeting, marks a moved one, and adds the
    /// long-press menu when the page provides one.
    @available(iOS 17.0, *)
    func scheduleCourseInteractions(_ block: NativeScheduleCourseBlock) -> some View {
        modifier(ScheduleCourseInteractions(block: block))
    }
}

/// A cancelled meeting: 停课 in its corner, and on a narrow card, where the
/// word would cover the name, a line through it instead.
@available(iOS 17.0, *)
private struct ScheduleCancelledMark: View {
    var body: some View {
        GeometryReader { proxy in
            if proxy.size.width >= 64, proxy.size.height >= 30 {
                Text("已停课")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.gray, in: Capsule())
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(6)
            } else {
                Path { path in
                    path.move(to: CGPoint(x: 3, y: proxy.size.height - 3))
                    path.addLine(to: CGPoint(x: proxy.size.width - 3, y: 3))
                }
                .stroke(Color.gray.opacity(0.8), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The corner mark of a meeting moved here from another time.
@available(iOS 17.0, *)
private struct ScheduleMovedBadge: View {
    var body: some View {
        Text("调")
            .font(.system(size: 8, weight: .heavy))
            .foregroundStyle(.white)
            .frame(width: 13, height: 13)
            .background(Color.orange.gradient, in: Circle())
            .overlay(Circle().stroke(.white.opacity(0.8), lineWidth: 1))
            .padding(2)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// The larger card above a course's long-press menu.
@available(iOS 17.0, *)
struct ScheduleCoursePreviewCard: View {
    let title: String
    let tint: Color
    /// Lines under the name, each with a symbol: time, room, teacher, weeks.
    let rows: [(symbol: String, text: String)]
    /// A line in colour at the foot, such as 这次停课 or 原定 11月12日.
    var status: (symbol: String, text: String, color: Color)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.title3.weight(.bold))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 14)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(tint)
                        .frame(width: 4)
                        .padding(.vertical, 2)
                }
                .padding(.bottom, 12)
            VStack(alignment: .leading, spacing: 9) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Image(systemName: row.symbol)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(tint)
                            .frame(width: 20)
                        Text(row.text)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if let status {
                Label(status.text, systemImage: status.symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(status.color)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(status.color.opacity(0.12), in: Capsule())
                    .padding(.top, 14)
            }
        }
        .padding(18)
        .frame(width: 300, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color(uiColor: .systemBackground))
    }
}
