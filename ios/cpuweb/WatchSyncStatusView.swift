import Combine
import SwiftUI

@MainActor
final class PhoneScheduleStore: ObservableObject {
    static let shared = PhoneScheduleStore()
    let provider = WebScheduleDataProvider()
    let coordinator: ScheduleSyncCoordinator

    private init() {
        coordinator = ScheduleSyncCoordinator(role: .phone,
            repository: CourseRepository(storage: FileScheduleStorage.local()),
            transport: WatchSessionTransport(), provider: provider, defaults: .standard)
        coordinator.onChange = { [weak self] in self?.objectWillChange.send() }
    }
}

struct WatchSyncStatusView: View {
    @ObservedObject var store: PhoneScheduleStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let sync = store.coordinator
        let connection = sync.transport.connection
        NavigationStack {
            Form {
                Section("Apple Watch") {
                    LabeledContent("已配对", value: connection.paired ? "是" : "否")
                    LabeledContent("Watch App 已安装", value: connection.installed ? "是" : "否")
                    LabeledContent("当前可达", value: connection.reachable ? "是" : "否")
                    LabeledContent("连接已激活", value: connection.activated ? "是" : "否")
                }
                Section("课表同步") {
                    LabeledContent("缓存课程", value: String(sync.repository.snapshot?.courses.count ?? 0))
                    dateRow("课表更新时间", sync.repository.snapshot?.generatedAt)
                    dateRow("已提交系统传输", sync.lastQueuedAt)
                    dateRow("手表确认同步", sync.lastSyncedAt)
                    if let error = sync.error { Text(error.localizedDescription).foregroundStyle(.orange) }
                    if sync.repository.snapshot == nil {
                        Text("请在 iPhone 打开课表并完成教务授权，课表加载后会自动同步。")
                    }
                    if !connection.paired { Text(ScheduleFailure.notPaired.localizedDescription) }
                    else if !connection.installed { Text(ScheduleFailure.notInstalled.localizedDescription) }
                    else if !connection.reachable { Text("暂时离线，最新课表由系统在连接恢复后传输。") }
                    Button(sync.refreshing ? "正在刷新课表…" : "立即同步") { sync.refresh() }
                        .disabled(sync.refreshing)
                    Text("系统接收快照后可能延迟传输；只有手表保存成功后的回执才更新确认时间。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("手表同步")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }

    private func dateRow(_ title: LocalizedStringKey, _ date: Date?) -> some View {
        LabeledContent(title) {
            if let date { Text(date, format: .dateTime.month().day().hour().minute()) }
            else { Text("尚无") }
        }
    }
}
