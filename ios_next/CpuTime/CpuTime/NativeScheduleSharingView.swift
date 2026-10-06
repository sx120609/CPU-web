import SwiftUI

/// "共享课表": the user's own share code on top, the timetables other people
/// shared with them below.
@available(iOS 17.0, *)
struct NativeScheduleSharingView: View {
    @ObservedObject private var sharing = NativeScheduleSharingService.shared
    @ObservedObject var store: NativeScheduleStore
    /// Opens a saved timetable for reading.
    let onOpen: (NativeSharedSchedule) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var notice: String?
    @State private var revokeTarget: NativeScheduleShareMeta?
    @State private var removeTarget: NativeSharedSchedule?
    @State private var renameTarget: NativeSharedSchedule?
    @State private var renameText = ""

    var body: some View {
        NavigationStack {
            List {
                ownSection
                otherTermsSection
                sharedSection
            }
            .navigationTitle("共享课表")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
            }
            .task {
                // Either may fail offline; the saved state stays on screen.
                try? await sharing.loadMine()
                await sharing.refresh()
            }
            .alert("修改备注", isPresented: Binding(
                get: { renameTarget != nil }, set: { if !$0 { renameTarget = nil } }
            )) {
                TextField("备注", text: $renameText)
                Button("取消", role: .cancel) { renameTarget = nil }
                Button("保存") {
                    if let target = renameTarget { sharing.rename(target.meta.code, remark: renameText) }
                    renameTarget = nil
                }
            } message: {
                Text("备注只保存在这台设备上，对方看不到。")
            }
        }
        .tint(.cpuBrand)
    }

    // MARK: My own share

    private var semester: String {
        store.result?.currentSemester.trimmedNonEmpty ?? store.selectedSemester
    }

    private var semesterLabel: String {
        store.result?.semesters.first { $0.value == semester }?.label.trimmedNonEmpty ?? semester
    }

    @ViewBuilder
    private var ownSection: some View {
        Section {
            if let share = sharing.share(for: semester) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(share.code)
                        .font(.system(size: 30, weight: .semibold, design: .monospaced))
                        .tracking(3)
                        .textSelection(.enabled)
                        .accessibilityLabel("分享码 \(share.code.map(String.init).joined(separator: " "))")
                    Text([semesterLabel, "\(share.courseCount) 门课", Self.updatedText(share.updatedAt)]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)

                ShareLink(item: NativeScheduleSharingService.invitation(code: share.code)) {
                    Label("发送给朋友", systemImage: "square.and.arrow.up")
                }
                Button {
                    publish()
                } label: {
                    Label("更新分享内容", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(busy)
                Button(role: .destructive) {
                    revokeTarget = share
                } label: {
                    Label("撤销分享", systemImage: "xmark.circle")
                }
                .disabled(busy)
                .confirmationDialog(
                    "撤销这个分享码？", isPresented: revokeBinding(for: share), titleVisibility: .visible
                ) {
                    Button("撤销并删除", role: .destructive) { revoke(share) }
                    Button("取消", role: .cancel) {}
                } message: {
                    Text("撤销后这个码立刻失效，服务器上的课表副本也会删除。已经保存到对方设备上的课表不会消失，只是不再更新。")
                }
            } else {
                Button {
                    publish()
                } label: {
                    Label("生成分享码", systemImage: "qrcode")
                }
                .disabled(busy || store.result == nil)
            }
            if busy {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("正在处理…").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let notice {
                Label(notice, systemImage: "checkmark.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        } header: {
            Text("分享我的课表")
        } footer: {
            Text("分享会上传「\(semesterLabel)」的课程、上课时间、教室、老师和调休安排，自己添加和修改的课程也在内。拿到分享码的人不用登录就能查看。课表有变化时点「更新分享内容」，分享码不变。")
        }
    }

    @ViewBuilder
    private var otherTermsSection: some View {
        let others = sharing.mine.filter { $0.semester != semester }
        if !others.isEmpty {
            Section("其他学期的分享码") {
                ForEach(others) { share in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(share.code).font(.body.monospaced().weight(.medium))
                            Text("\(share.semester) · \(share.courseCount) 门课")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        Button("撤销", role: .destructive) { revokeTarget = share }
                            .buttonStyle(.borderless)
                            .disabled(busy)
                            .confirmationDialog(
                                "撤销这个分享码？", isPresented: revokeBinding(for: share), titleVisibility: .visible
                            ) {
                                Button("撤销并删除", role: .destructive) { revoke(share) }
                                Button("取消", role: .cancel) {}
                            }
                    }
                }
            }
        }
    }

    private func revokeBinding(for share: NativeScheduleShareMeta) -> Binding<Bool> {
        Binding(get: { revokeTarget?.code == share.code }, set: { if !$0 { revokeTarget = nil } })
    }

    private func publish() {
        run {
            let result = try await sharing.publish()
            notice = result.created ? "分享码已生成，发给朋友就能看到你的课表。"
                : result.changed ? "分享内容已更新，对方下次打开就能看到。" : "分享内容已经是最新的。"
        }
    }

    private func revoke(_ share: NativeScheduleShareMeta) {
        run {
            try await sharing.revoke(share.code)
            notice = "分享码 \(share.code) 已撤销。"
        }
    }

    private func run(_ work: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true
        errorMessage = nil
        notice = nil
        Task { @MainActor in
            defer { busy = false }
            do { try await work() } catch { errorMessage = error.localizedDescription }
        }
    }

    // MARK: Shared with me

    @ViewBuilder
    private var sharedSection: some View {
        Section {
            ForEach(sharing.library.schedules) { schedule in
                sharedRow(schedule)
            }
            NavigationLink {
                NativeScheduleShareImportView()
            } label: {
                Label("用分享码导入", systemImage: "plus")
                    .foregroundStyle(Color.cpuBrand)
            }
        } header: {
            Text("共享给我的课表")
        } footer: {
            Text("轻点打开对方的课表，只能查看。点亮爱心设为关心后，TA 的课会和你自己的课一起出现在实时活动里；同一时间你也有课时只显示你自己的。一次只能关心一份。")
        }
    }

    private func sharedRow(_ schedule: NativeSharedSchedule) -> some View {
        let cared = sharing.library.caredCode == schedule.meta.code
        return HStack(spacing: 12) {
            Button {
                dismiss()
                onOpen(schedule)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "person.2.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.cpuBrand)
                        .frame(width: 34, height: 34)
                        .background(Color.cpuBrand.opacity(0.12), in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(schedule.name)
                            .font(.body.weight(.medium))
                            .foregroundStyle(.primary)
                        if schedule.revoked {
                            Text("分享已撤销，不会再更新")
                                .font(.caption)
                                .foregroundStyle(.orange)
                        } else {
                            Text(Self.summary(schedule))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 4)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("打开这份共享课表")

            Button {
                sharing.care(cared ? nil : schedule.meta.code)
            } label: {
                Image(systemName: cared ? "heart.fill" : "heart")
                    .font(.system(size: 19))
                    .foregroundStyle(cared ? Color.pink : Color.secondary)
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.borderless)
            .disabled(schedule.revoked)
            .accessibilityLabel(cared ? "取消关心 \(schedule.name)" : "关心 \(schedule.name)")
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button("移除", role: .destructive) { removeTarget = schedule }
            Button("备注") {
                renameText = schedule.remark
                renameTarget = schedule
            }
            .tint(.gray)
        }
        .contextMenu {
            Button {
                renameText = schedule.remark
                renameTarget = schedule
            } label: { Label("修改备注", systemImage: "pencil") }
            Button(role: .destructive) { removeTarget = schedule } label: { Label("移除", systemImage: "trash") }
        }
        .confirmationDialog(
            "移除「\(schedule.name)」？",
            isPresented: Binding(get: { removeTarget?.meta.code == schedule.meta.code }, set: { if !$0 { removeTarget = nil } }),
            titleVisibility: .visible
        ) {
            Button("移除", role: .destructive) { sharing.remove(schedule.meta.code) }
            Button("取消", role: .cancel) {}
        } message: {
            Text(cared ? "会同时取消关心，这份课表不再出现在实时活动里。" : "只从这台设备上移除，对方的分享不受影响。")
        }
    }

    static func summary(_ schedule: NativeSharedSchedule) -> String {
        var parts: [String] = []
        // The remark is the title; the nickname is worth a line only when it differs.
        if let owner = schedule.meta.ownerName, owner != schedule.name { parts.append("来自 \(owner)") }
        parts.append("\(schedule.schedule.cells.reduce(0) { $0 + $1.courses.count }) 门课")
        if let updated = updatedText(schedule.meta.updatedAt) { parts.append(updated) }
        return parts.joined(separator: " · ")
    }

    /// "更新于 10月7日" from the server's ISO timestamp.
    static func updatedText(_ value: String) -> String? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        guard let date = parser.date(from: value) ?? plain.date(from: value) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "M月d日"
        return "更新于 \(formatter.string(from: date))"
    }
}

/// Type a code, look at what it is, name it, keep it.
@available(iOS 17.0, *)
private struct NativeScheduleShareImportView: View {
    @ObservedObject private var sharing = NativeScheduleSharingService.shared
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var remark = ""
    @State private var preview: NativeSharedSchedule?
    @State private var loading = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section {
                TextField("8 位分享码，或粘贴分享链接", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                    .onChange(of: code) { _, _ in
                        preview = nil
                        errorMessage = nil
                    }
                Button {
                    load()
                } label: {
                    HStack {
                        Text("预览课表")
                        if loading { Spacer(); ProgressView().controlSize(.small) }
                    }
                }
                .disabled(loading || code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            } footer: {
                Text("分享码由对方在「课表 → 更多 → 共享课表」里生成。")
            }

            if let preview {
                Section("这份课表") {
                    LabeledContent("来自", value: preview.meta.ownerName ?? "没有留昵称")
                    LabeledContent("学期", value: preview.meta.semester)
                    LabeledContent("课程", value: "\(preview.schedule.cells.reduce(0) { $0 + $1.courses.count }) 门")
                    LabeledContent("教学周", value: "\(preview.calendar.weeks.count) 周")
                }
                Section {
                    TextField(preview.meta.ownerName ?? "例如 室友小王", text: $remark)
                    Button("确认导入") {
                        sharing.save(preview, remark: remark)
                        dismiss()
                    }
                    .disabled(remark.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && preview.meta.ownerName == nil)
                } header: {
                    Text("备注")
                } footer: {
                    Text("备注只保存在这台设备上，用来在列表和实时活动里认出这份课表。")
                }
            }
        }
        .navigationTitle("用分享码导入")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func load() {
        loading = true
        errorMessage = nil
        let input = code
        Task { @MainActor in
            defer { loading = false }
            do {
                let schedule = try await sharing.preview(input)
                guard input == code else { return }
                if let saved = sharing.library.schedules.first(where: { $0.meta.code == schedule.meta.code }) {
                    remark = saved.remark
                }
                preview = schedule
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

/// Somebody else's timetable, full screen and read-only. It runs on its own
/// store, so nothing here reaches the user's widgets, Watch or Live Activity.
@available(iOS 17.0, *)
struct NativeSharedScheduleScreen: View {
    private let code: String
    @ObservedObject private var sharing = NativeScheduleSharingService.shared
    @StateObject private var store: NativeScheduleStore
    @Environment(\.dismiss) private var dismiss

    init(schedule: NativeSharedSchedule) {
        code = schedule.meta.code
        _store = StateObject(wrappedValue: NativeScheduleStore(shared: {
            // Always the saved copy as it is now, so a refresh shows up here.
            let saved = NativeScheduleSharingService.shared.library.schedules
            return (saved.first { $0.meta.code == schedule.meta.code } ?? schedule).snapshot()
        }))
    }

    private var current: NativeSharedSchedule? {
        sharing.library.schedules.first { $0.meta.code == code }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.cpuBrand)
                VStack(alignment: .leading, spacing: 1) {
                    Text(current?.name ?? "共享课表")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text(current?.revoked == true ? "分享已撤销，不会再更新" : "共享课表 · 只能查看")
                        .font(.caption2)
                        .foregroundStyle(current?.revoked == true ? Color.orange : Color.secondary)
                }
                Spacer(minLength: 8)
                Button("关闭") { dismiss() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.cpuBrand)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(.bar)
            .overlay(alignment: .bottom) { Divider() }

            NativeScheduleView(store: store)
        }
        .task {
            await store.load()
            await sharing.refresh()
        }
        .onChange(of: current?.meta.updatedAt) { _, _ in
            Task { await store.load(force: true) }
        }
        .onChange(of: current == nil) { _, removed in
            if removed { dismiss() }
        }
    }
}
