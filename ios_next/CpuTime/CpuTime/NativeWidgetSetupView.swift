import SwiftUI

/// One native settings surface for the two companion experiences. Keeping the
/// Watch status and iPhone widget controls together makes the schedule header
/// a single, predictable entry point.
struct NativeDeviceSettingsView: View {
    @ObservedObject var session: HybridWebViewStore
    @ObservedObject var watchStore: PhoneWatchScheduleStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                WidgetSettingsSection(session: session)
                WatchSyncStatusSection(store: watchStore)
            }
            .navigationTitle("设备与小组件")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .tint(.cpuBrand)
        .preferredColorScheme(session.pageColorScheme)
    }
}

/// Kept as a small compatibility wrapper for any older route that still opens
/// the widget-only sheet.
struct NativeWidgetSetupView: View {
    @ObservedObject var session: HybridWebViewStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                WidgetSettingsSection(session: session)
            }
            .navigationTitle("iPhone 小组件")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .tint(.cpuBrand)
        .preferredColorScheme(session.pageColorScheme)
    }
}

private struct WidgetSettingsSection: View {
    @ObservedObject var session: HybridWebViewStore
    @State private var installing = false
    @State private var message: String?
    @State private var theme: String
    @State private var options: WidgetDisplayOptions

    private let themes = [
        ("color-glass", "彩色玻璃"), ("green", "绿"), ("blue", "蓝"),
        ("teal", "青"), ("indigo", "靛蓝"), ("violet", "紫"),
        ("orange", "橙"), ("rose", "玫瑰"), ("slate", "灰")
    ]

    init(session: HybridWebViewStore) {
        self.session = session
        let defaults = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)
        _theme = State(initialValue: defaults?.string(forKey: NextWidgetConfiguration.widgetThemeKey) ?? "color-glass")
        _options = State(initialValue: WidgetDisplayOptions.load(defaults: defaults))
    }

    var body: some View {
        Section {
            LabeledContent("状态", value: session.widgetSettings.isConfigured ? "已配置" : "等待配置")

            Toggle("课程名称", isOn: optionBinding(\.showCourseName))
            Toggle("教室", isOn: optionBinding(\.showRoom))
            Toggle("老师", isOn: optionBinding(\.showTeacher))
            Toggle("上课时间", isOn: optionBinding(\.showTime))

            Picker("颜色主题", selection: $theme) {
                ForEach(themes, id: \.0) { value in
                    Text(value.1).tag(value.0)
                }
            }
            .onChange(of: theme) { _, value in
                session.widgetSettings.setScheduleWidgetTheme(value)
            }

            Button {
                installing = true
                Task { @MainActor in
                    do {
                        try await session.configureScheduleWidget(theme: theme)
                        message = session.widgetSettings.status
                    } catch {
                        message = error.localizedDescription
                    }
                    installing = false
                }
            } label: {
                Label(
                    installing ? "正在同步配置…" : "同步小组件配置",
                    systemImage: installing ? "arrow.triangle.2.circlepath" : "square.and.arrow.down"
                )
            }
            .disabled(installing || !session.bridgeReady)

            if let message {
                statusLabel(message)
            } else if let status = session.widgetSettings.status {
                statusLabel(status)
            }
        } header: {
            Label("iPhone 小组件", systemImage: "square.grid.2x2")
        } footer: {
            Text("选择要显示的信息后，打开桌面添加“临近课程”“今日课表”或“两日课表”。课表会自动同步，今天无课时会显示最近有课的日期。")
        }
    }

    private func optionBinding(_ keyPath: WritableKeyPath<WidgetDisplayOptions, Bool>) -> Binding<Bool> {
        Binding(
            get: { options[keyPath: keyPath] },
            set: { value in
                options[keyPath: keyPath] = value
                session.widgetSettings.setScheduleWidgetDisplayOptions(options)
            }
        )
    }

    private func statusLabel(_ message: String) -> some View {
        Label(message, systemImage: message.contains("失败") ? "exclamationmark.triangle" : "checkmark.circle.fill")
            .font(.footnote)
            .foregroundStyle(message.contains("失败") ? .orange : Color.cpuBrand)
    }
}
