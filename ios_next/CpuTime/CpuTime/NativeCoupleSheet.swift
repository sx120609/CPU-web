import SwiftUI

/// "情侣课表": inviting, accepting, colours, anniversary and unbinding. The
/// rows and wording follow the Web's `CoupleDialog.vue`.
@available(iOS 17.0, *)
struct NativeCoupleSheet: View {
    @ObservedObject private var couple = NativeCoupleService.shared
    /// What the partner is doing now, in the long form ("在上《药理学》，09:35 下课").
    let partnerNow: (Date) -> String

    @Environment(\.dismiss) private var dismiss
    @State private var loading = false
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var code = ""
    @State private var confirmsUnbind = false
    @State private var editsAnniversary = false
    @State private var anniversaryDraft = Date()

    var body: some View {
        NavigationStack {
            List {
                switch couple.status {
                case .active(let anniversary, let me, let partner):
                    activeSections(anniversary: anniversary, me: me, partner: partner)
                case .pending(let code, let expired) where !code.isEmpty && !expired:
                    introSection
                    inviteSection(code)
                    acceptSection
                case .unknown where loading:
                    Section { ProgressView().frame(maxWidth: .infinity) }
                default:
                    introSection
                    Section("邀请 TA") {
                        Text("生成一个邀请码发给 TA。").font(.footnote).foregroundStyle(.secondary)
                        Button("生成邀请码") { act { try await couple.invite() } }.disabled(busy)
                    }
                    acceptSection
                }
            }
            .navigationTitle("情侣课表")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
            }
            .task {
                loading = true
                await couple.refresh(force: true)
                loading = false
            }
            .task(id: isWaiting) {
                // While an invite is out, see whether TA accepted it.
                guard isWaiting else { return }
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(10)) } catch { return }
                    await couple.refresh(force: true)
                }
            }
            .alert("情侣课表", isPresented: Binding(
                get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
            )) {
                Button("好", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
        .tint(.cpuBrand)
    }

    private var isWaiting: Bool {
        if case .pending(let code, let expired) = couple.status { return !code.isEmpty && !expired }
        return false
    }

    private func act(_ work: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await work() } catch {
                errorMessage = (error as? NativeScheduleAPIError)?.message ?? error.localizedDescription
            }
        }
    }

    // MARK: Not bound

    private var introSection: some View {
        Section {
            Text("绑定后，TA 的课会和你的课显示在同一张课表里，两人都有空的时间一目了然。任何一方都可以随时解除，解除后双方的课表快照立即删除。")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func inviteSection(_ code: String) -> some View {
        Section("邀请 TA") {
            VStack(spacing: 8) {
                Text(code)
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .tracking(6)
                    .textSelection(.enabled)
                    .accessibilityLabel("邀请码 \(code.map(String.init).joined(separator: " "))")
                Text("24 小时内有效，TA 在「更多 → 情侣课表」里输入")
                    .font(.footnote).foregroundStyle(.secondary)
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("等待 TA 接受…").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            ShareLink(item: CoupleRules.invitation(code: code, origin: IOSNextWebConfiguration.appURL.absoluteString)) {
                Label("发送邀请", systemImage: "square.and.arrow.up")
            }
            Button("换一个") { act { try await couple.invite() } }.disabled(busy)
            Button("取消邀请", role: .destructive) { act { try await couple.cancelInvite() } }.disabled(busy)
        }
    }

    private var acceptSection: some View {
        Section("输入 TA 的邀请码") {
            HStack {
                TextField("6 位邀请码", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(.body, design: .monospaced))
                    .onChange(of: code) { _, value in
                        let cleaned = String(value.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(8))
                        if cleaned != value { code = cleaned }
                    }
                    .accessibilityLabel("TA 的邀请码")
                Button("绑定") {
                    let value = code
                    act {
                        try await couple.accept(value)
                        code = ""
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || code.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    // MARK: Bound

    @ViewBuilder
    private func activeSections(anniversary: String, me: CoupleMember, partner: CoupleMember) -> some View {
        Section {
            HStack(alignment: .center) {
                person(me.nickname.isEmpty ? "我" : me.nickname, color: me.color)
                VStack(spacing: 4) {
                    Image(systemName: "heart.fill").font(.title2).foregroundStyle(.pink).accessibilityHidden(true)
                    if let days = CoupleRules.daysTogether(anniversary, today: Self.today) {
                        Text("第 \(days) 天").font(.footnote.weight(.semibold)).monospacedDigit()
                    }
                }
                .frame(maxWidth: .infinity)
                person(partner.nickname.isEmpty ? "TA" : partner.nickname, color: partner.color)
            }
            .padding(.vertical, 6)
        }
        Section {
            TimelineView(.everyMinute) { context in
                LabeledContent("TA 此刻", value: partnerNow(context.date))
            }
            LabeledContent("TA 的课表", value: partner.syncedAt.isEmpty
                ? "还没有同步" : "同步于 \(CoupleRules.relative(partner.syncedAt, now: .now))")
            LabeledContent("我的课表", value: me.syncedAt.isEmpty
                ? "打开课表后自动同步" : "同步于 \(CoupleRules.relative(me.syncedAt, now: .now))")
        }
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Text("我的颜色")
                HStack(spacing: 0) {
                    ForEach(CoupleRules.colors, id: \.key) { option in
                        let mine = option.key == me.color, theirs = option.key == partner.color
                        Button {
                            act { try await couple.setMyColor(option.key) }
                        } label: {
                            Circle()
                                .fill(CoupleRules.swatch(option.key).color)
                                .frame(width: 30, height: 30)
                                .overlay {
                                    Text(mine ? "我" : (theirs ? "TA" : ""))
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(.white)
                                }
                                .padding(3)
                                .overlay { if mine { Circle().strokeBorder(Color.primary, lineWidth: 2) } }
                                .frame(maxWidth: .infinity)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(busy || mine)
                        .accessibilityLabel(option.label)
                        .accessibilityValue(mine ? "我的颜色" : (theirs ? "TA 的颜色，轻点互换" : ""))
                        .accessibilityAddTraits(mine ? [.isSelected] : [])
                    }
                }
            }
            .padding(.vertical, 2)
            Toggle("在课表里显示 TA 的课", isOn: Binding(get: { couple.visible }, set: { couple.setVisible($0) }))
            HStack {
                Text("纪念日")
                Spacer()
                Button(anniversary.isEmpty ? "未设置" : anniversary) {
                    anniversaryDraft = Self.date(anniversary) ?? Date()
                    editsAnniversary = true
                }
                .buttonStyle(.borderless)
                .monospacedDigit()
            }
        } footer: {
            Text("开着显示时，你的课都用你的颜色、TA 的课都用 TA 的颜色。颜色双方看到的一样；选 TA 正在用的那个，两人就互换。")
        }
        Section {
            Button("解除绑定", role: .destructive) { confirmsUnbind = true }
                .disabled(busy)
                .confirmationDialog("解除情侣课表绑定？", isPresented: $confirmsUnbind, titleVisibility: .visible) {
                    Button("解除绑定", role: .destructive) { act { try await couple.unbind() } }
                    Button("取消", role: .cancel) {}
                } message: {
                    Text("双方的课表快照会立即删除，对方会收到通知。")
                }
        }
        .sheet(isPresented: $editsAnniversary) { anniversaryEditor(anniversary) }
    }

    private func anniversaryEditor(_ current: String) -> some View {
        NavigationStack {
            Form {
                // Not later than today.
                DatePicker("纪念日", selection: $anniversaryDraft, in: ...Date(), displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .environment(\.locale, Locale(identifier: "zh_CN"))
                    .environment(\.timeZone, TimeZone(identifier: "Asia/Shanghai") ?? .current)
                if !current.isEmpty {
                    Button("清除纪念日", role: .destructive) {
                        editsAnniversary = false
                        act { try await couple.setAnniversary("") }
                    }
                }
            }
            .navigationTitle("纪念日")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { editsAnniversary = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        let value = Self.key(anniversaryDraft)
                        editsAnniversary = false
                        act { try await couple.setAnniversary(value) }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .tint(.cpuBrand)
    }

    private func person(_ name: String, color: String) -> some View {
        VStack(spacing: 6) {
            Text(String(name.prefix(1)))
                .font(.title3.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 48, height: 48)
                .background(Self.swatchColor(color), in: Circle())
                .accessibilityHidden(true)
            Text(name).font(.subheadline.weight(.semibold)).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }

    private static func swatchColor(_ color: String) -> Color { CoupleRules.swatch(color).color }

    private static var formatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }

    static var today: String { key(Date()) }
    private static func key(_ date: Date) -> String { formatter.string(from: date) }
    private static func date(_ key: String) -> Date? { key.isEmpty ? nil : formatter.date(from: key) }
}
