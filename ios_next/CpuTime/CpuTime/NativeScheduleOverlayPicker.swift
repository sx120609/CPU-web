import SwiftUI

/// 叠加到我的课表: whose courses are drawn beside the user's own. The partner's
/// (情侣课表), one of the saved shared timetables, or nobody's. Somebody at
/// another school is placed by clock time, so their bells may differ.
@available(iOS 17.0, *)
struct NativeScheduleOverlayPicker: View {
    /// The share code laid on top; empty for the partner or nobody.
    @Binding var selection: String
    var openSharing: () -> Void
    var openCouple: () -> Void

    @ObservedObject private var couple = NativeCoupleService.shared
    @ObservedObject private var sharing = NativeScheduleSharingService.shared
    @Environment(\.dismiss) private var dismiss

    private enum Choice: Equatable { case nobody, couple, shared(String) }

    private var current: Choice {
        if !selection.isEmpty { return .shared(selection) }
        return couple.isActive && couple.visible ? .couple : .nobody
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    explanation
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 6, trailing: 16))
                }

                Section("情侣") {
                    if couple.isActive {
                        choiceRow(
                            title: couple.partnerMember?.nickname.trimmedNonEmpty ?? "TA",
                            detail: coupleDetail,
                            avatar: avatar(systemImage: "heart.fill", tint: .pink),
                            selected: current == .couple
                        ) { choose(.couple) }
                    } else {
                        actionRow("绑定情侣课表", systemImage: "heart", tint: .pink, action: openCouple)
                    }
                }

                Section {
                    ForEach(sharing.library.schedules) { schedule in
                        choiceRow(
                            title: schedule.name,
                            detail: detail(for: schedule),
                            avatar: avatar(initial: schedule.name, tint: .teal),
                            selected: current == .shared(schedule.meta.code)
                        ) { choose(.shared(schedule.meta.code)) }
                    }
                    actionRow(
                        sharing.library.schedules.isEmpty ? "输入同学的分享码" : "再添加一份",
                        systemImage: "plus", tint: .teal, action: openSharing
                    )
                } header: {
                    Text("同学的分享课表")
                } footer: {
                    Text("分享码保存在这台设备上；对方更新课表后，这里也会跟着更新。")
                }

                Section {
                    choiceRow(
                        title: "不叠加",
                        detail: "只看自己的课",
                        avatar: avatar(systemImage: "person.fill", tint: .gray),
                        selected: current == .nobody
                    ) { choose(.nobody) }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("叠加到我的课表")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .tint(.cpuBrand)
    }

    private var explanation: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.cpuBrand.opacity(0.85))
                    .frame(width: 22, height: 30)
                    .offset(x: -5, y: 3)
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.teal.opacity(0.85))
                    .frame(width: 22, height: 30)
                    .offset(x: 5, y: -3)
            }
            .frame(width: 40, height: 40)
            .accessibilityHidden(true)
            Text("选一个人的课表，和你的课并排显示：一起上课、谁有空，一眼就能看出来。别的学校的同学也可以，课会按实际上课时间对齐。")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var coupleDetail: String {
        let school = couple.partner?.calendar.school.trimmedNonEmpty
        return [school, couple.partner == nil ? "还没有同步课表" : "情侣课表"].compactMap { $0 }.joined(separator: " · ")
    }

    private func detail(for schedule: NativeSharedSchedule) -> String {
        var parts: [String] = []
        if let school = schedule.calendar.school.trimmedNonEmpty { parts.append(school) }
        parts.append("\(schedule.meta.courseCount > 0 ? schedule.meta.courseCount : schedule.schedule.cells.reduce(0) { $0 + $1.courses.count }) 门课")
        if schedule.revoked { parts.append("对方已停止分享") }
        return parts.joined(separator: " · ")
    }

    private func choose(_ choice: Choice) {
        withAnimation(.snappy(duration: 0.2)) {
            switch choice {
            case .nobody:
                selection = ""
                if couple.isActive { couple.setVisible(false) }
            case .couple:
                selection = ""
                couple.setVisible(true)
            case .shared(let code):
                selection = code
            }
        }
    }

    // MARK: Rows

    private func choiceRow(title: String, detail: String, avatar: some View, selected: Bool,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                avatar
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(selected ? Color.cpuBrand : Color(uiColor: .tertiaryLabel))
                    .contentTransition(.symbolEffect(.replace))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func actionRow(_ title: String, systemImage: String, tint: Color,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 36, height: 36)
                    .background(tint.opacity(0.14), in: Circle())
                Text(title)
                    .font(.body)
                    .foregroundStyle(tint)
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func avatar(systemImage: String, tint: Color) -> some View {
        Image(systemName: systemImage)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 36, height: 36)
            .background(tint.gradient, in: Circle())
    }

    private func avatar(initial name: String, tint: Color) -> some View {
        Text(String(name.prefix(1)))
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: 36, height: 36)
            .background(tint.gradient, in: Circle())
    }
}
