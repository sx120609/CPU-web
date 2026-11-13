import SwiftUI

// What tells people how the timetable works, and lets them undo what changed:
// the 并排／合并 choice for the week view of two timetables, the one-time hint
// over the two-column strip, and the 课表怎么用 sheet shown once per device.
// Android and HarmonyOS carry the same three, in the same words.

/// 一起看的周视图: 并排 (each day in two columns) or 合并 (both people's courses in
/// the one week grid). A section for the timetable settings and the 情侣课表 page;
/// shown only while a partner's or a shared timetable is laid over the user's.
@available(iOS 17.0, *)
struct ScheduleCoupleWeekLayoutSection: View {
    @ObservedObject private var preferences = NativeSchedulePreferences.shared

    var body: some View {
        Section {
            Picker("一起看的周视图", selection: $preferences.coupleWeekLayout) {
                Text("并排").tag("split")
                Text("合并").tag("merged")
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("一起看的周视图")
        } header: {
            Text("一起看的周视图")
        } footer: {
            Text("并排：每天两栏，左边是你，右边是 TA。合并：两人的课排在同一张周课表里。")
        }
    }
}

/// The same section where it only belongs while two timetables are shown together:
/// bound to a partner, or with a shared timetable laid on top.
@available(iOS 17.0, *)
struct ScheduleCoupleWeekLayoutSetting: View {
    @ObservedObject private var couple = NativeCoupleService.shared
    @AppStorage("cpu.schedule.overlay.v1") private var overlayCode = ""

    var body: some View {
        if couple.isActive || !overlayCode.isEmpty {
            ScheduleCoupleWeekLayoutSection()
        }
    }
}

/// The line over the two-column strip the first time it is shown.
@available(iOS 17.0, *)
struct ScheduleCoupleSplitHint: View {
    let onMerge: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "rectangle.split.2x1")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.cpuBrand)
                .accessibilityHidden(true)
            Text("两人的课并排显示，左右滑动换天。")
                .font(.footnote)
                .foregroundStyle(.primary)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("改回合并", action: onMerge)
                .font(.footnote.weight(.semibold))
                .buttonStyle(.borderless)
                .fixedSize()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("关闭提示")
        }
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .padding(.vertical, 4)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("schedule.couple.splitHint")
    }
}

/// 课表怎么用: shown once per device when the timetable first has something to
/// show, and from 更多 › 使用指引 whenever it is wanted again. Short on purpose.
@available(iOS 17.0, *)
struct ScheduleGuideSheet: View {
    /// Bumped when the guide gains something everybody should see again.
    static let version = 1
    static let seenKey = "nativeSchedule.guideSeen"

    /// A partner's or a shared timetable is laid over the user's.
    let overlayIsOn: Bool
    @ObservedObject private var preferences = NativeSchedulePreferences.shared
    @ObservedObject private var styleSettings = NativeScheduleStyleSettings.shared
    @Environment(\.dismiss) private var dismiss
    /// The buttons say what they did once pressed, here.
    @State private var wentClassic = false
    @State private var wentMerged = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    row("hand.tap.fill", .blue, "点一下课程", "看详情；编辑、调整这一次、这次停课都在里面。")
                    row("paintpalette.fill", .purple, "课表风格", "现在默认是“简约”。想用原来的样子，可以换回“经典”。") {
                        if styleSettings.style == .minimal || wentClassic {
                            action(wentClassic ? "已换回" : "换回经典", done: wentClassic) {
                                styleSettings.setStyle(.classic)
                                wentClassic = true
                            }
                        }
                        Text("以后在 更多 › 课表风格 里换。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if overlayIsOn {
                        row("heart.fill", .pink, "和 TA 一起看", "周视图里两人的课并排显示，左右滑动换天。") {
                            if !preferences.mergesCoupleWeek || wentMerged {
                                action(wentMerged ? "已改回" : "改回合并", done: wentMerged) {
                                    preferences.coupleWeekLayout = "merged"
                                    wentMerged = true
                                }
                            }
                        }
                    }
                    row("ellipsis.circle.fill", .gray, "更多", "课表设置、小组件、日程和共享课表都在“更多”里。")
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 12)
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    dismiss()
                } label: {
                    Text("知道了")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .navigationTitle("课表怎么用")
            .navigationBarTitleDisplayMode(.inline)
        }
        .tint(.cpuBrand)
        // Tall enough for every entry on a phone without covering the timetable entirely.
        .presentationDetents([.fraction(0.78), .large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("schedule.guide")
    }

    private func row(_ symbol: String, _ tint: Color, _ title: String, _ text: String) -> some View {
        row(symbol, tint, title, text) { EmptyView() }
    }

    private func row<Extra: View>(_ symbol: String, _ tint: Color, _ title: String, _ text: String,
                                  @ViewBuilder extra: () -> Extra) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(tint.gradient, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.body.weight(.semibold))
                Text(text)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                extra()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func action(_ title: String, done: Bool, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Label(title, systemImage: done ? "checkmark" : "arrow.uturn.backward")
                .font(.subheadline.weight(.semibold))
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(done)
    }
}
