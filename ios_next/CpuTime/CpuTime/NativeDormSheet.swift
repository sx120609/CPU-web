import SwiftUI

/// "宿舍课表": the dorm's week of free periods, the free blocks of a day, who
/// has an 8 a.m. class, and the dorm itself (members, colours, the code, the
/// user's upload). The maths is `DormRules`, shared with the Web and Android;
/// the rows and wording follow the Web's `DormDialog.vue`.
@available(iOS 17.0, *)
struct NativeDormSheet: View {
    @ObservedObject private var dorm = NativeDormService.shared
    let presentation: DormPresentation

    @Environment(\.dismiss) private var dismiss
    @State private var page: DormPage = .week
    @State private var monday = DormRules.monday(DormRules.today())
    @State private var freeDate = DormRules.today()
    @State private var minFree: Int?
    @State private var cellPick: DormCellPick?
    @State private var joinCode = ""
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var syncNotice: String?
    @State private var didStart = false

    init(presentation: DormPresentation) {
        self.presentation = presentation
        _joinCode = State(initialValue: presentation.code)
        _page = State(initialValue: presentation.page ?? .week)
    }

    var body: some View {
        NavigationStack {
            content
                .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    if dorm.room != nil {
                        ToolbarItem(placement: .cancellationAction) {
                            Button {
                                Task { await dorm.reload() }
                            } label: {
                                if dorm.refreshing {
                                    ProgressView()
                                } else {
                                    Image(systemName: "arrow.clockwise")
                                }
                            }
                            .disabled(dorm.refreshing || busy)
                            .accessibilityLabel(dorm.refreshing ? "刷新中" : "刷新")
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
                }
        }
        .tint(.cpuBrand)
        .task {
            guard !didStart else { return }
            didStart = true
#if DEBUG
            // `CPU_DEBUG_DORM_MIN_FREE=2` opens 空闲 asking for at least that many, for a screenshot run.
            if let value = ProcessInfo.processInfo.environment["CPU_DEBUG_DORM_MIN_FREE"].flatMap(Int.init) { minFree = value }
#endif
            if presentation.showsCellDetail { pickDebugCell() }
            await dorm.reload()
        }
        .sheet(item: $cellPick) { pick in
            if let cell = cell(for: pick) {
                DormCellDetail(dorm: dorm, cell: cell, today: today) { date in
                    freeDate = date
                    withAnimation(.snappy(duration: 0.25)) { page = .free }
                }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            } else {
                // The roommates changed under the tapped cell.
                Color.clear.onAppear { cellPick = nil }
            }
        }
        .alert("宿舍课表", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("好", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var today: String { DormRules.today() }

    private var title: String {
        guard let room = dorm.room else { return "宿舍课表" }
        return room.name.isEmpty ? "宿舍课表" : room.name
    }

    @ViewBuilder
    private var content: some View {
        switch dorm.status {
        case .active(let room):
            activeView(room)
        case .none:
            DormJoinView(code: $joinCode, busy: busy, fromLink: !presentation.code.isEmpty,
                         onJoin: { code in act { try await dorm.join(code) } },
                         onCreate: { act { try await dorm.create() } })
        case .unknown:
            if let error = dorm.statusError, !dorm.refreshing {
                ScrollView {
                    DormStateCard(symbol: "wifi.exclamationmark", title: "宿舍状态没加载出来", message: "可能是网络不稳定。\(error)") {
                        Button("重试") { Task { await dorm.reload() } }
                            .buttonStyle(.borderedProminent)
                            .buttonBorderShape(.capsule)
                    }
                    .padding(16)
                }
            } else {
                ScrollView {
                    DormStateCard(symbol: nil, title: "正在读取宿舍…", loading: true).padding(16)
                }
            }
        }
    }

    private func act(_ work: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await work() } catch { errorMessage = NativeDormService.message(error) }
        }
    }

    // MARK: In a dorm

    private func activeView(_ room: DormRoom) -> some View {
        ScrollViewReader { reader in
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                DormHeader(dorm: dorm, room: room)
                if let error = dorm.statusError, !dorm.refreshing {
                    HStack(alignment: .firstTextBaseline) {
                        DormNote(text: "刷新失败，下面是之前的数据。\(error)", symbol: "exclamationmark.triangle.fill", tint: .orange)
                        Spacer(minLength: 4)
                        Button("重试") { Task { await dorm.reload() } }.font(.footnote.weight(.semibold))
                    }
                }
                if !presentation.code.isEmpty, presentation.code != room.invite?.code, page == .room || page == .week {
                    DormNote(text: "宿舍码 \(presentation.code)：你已经在一个宿舍里了，要加入别的宿舍请先退出这个。", symbol: "person.2.badge.gearshape", tint: .cpuBrand)
                }
                Picker("页面", selection: $page.animation(.snappy(duration: 0.2))) {
                    ForEach(DormPage.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                pageContent(room)
                Color.clear.frame(height: 1).id(Self.bottom)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
#if DEBUG
        .task {
            // `CPU_DEBUG_DORM_SCROLL=bottom` shows the foot of the page, `windows` the free
            // blocks of 空闲, for a screenshot run.
            guard let target = ProcessInfo.processInfo.environment["CPU_DEBUG_DORM_SCROLL"] else { return }
            try? await Task.sleep(for: .milliseconds(900))
            if target == "windows" { reader.scrollTo(DormFreePage.windowsAnchor, anchor: .top) }
            if target == "bottom" { reader.scrollTo(Self.bottom, anchor: .bottom) }
        }
#endif
        }
    }

    private static let bottom = "dorm-bottom"

    @ViewBuilder
    private func pageContent(_ room: DormRoom) -> some View {
        if page == .room {
            DormRoomPage(dorm: dorm, room: room, busy: busy, syncNotice: syncNotice, act: act, syncNow: syncNow)
        } else if dorm.people.isEmpty, dorm.peopleState == .loading || dorm.peopleState == .idle {
            DormStateCard(symbol: nil, title: "正在读取室友的课表…", loading: true)
        } else if case .failed(let message) = dorm.peopleState, dorm.people.isEmpty {
            DormStateCard(symbol: "exclamationmark.icloud", title: "室友的课表没加载出来", message: "可能是网络不稳定。\(message)") {
                Button("重试") { Task { await dorm.reload() } }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
            }
        } else if !dorm.people.contains(where: \.hasData) {
            DormStateCard(symbol: "tray", title: dorm.syncing ? "正在同步你的课表…" : "还没有人同步课表",
                          message: "打开课表会自动同步当前学期；室友同步后点左上角的刷新就能看到。") {
                Button {
                    syncNow()
                } label: {
                    Label("立即同步我的课表", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .disabled(dorm.syncing)
            }
        } else {
            switch page {
            case .week:
                DormWeekPage(dorm: dorm, monday: $monday, selection: $cellPick, today: today)
            case .free:
                DormFreePage(dorm: dorm, date: $freeDate, minFree: $minFree, today: today)
            case .morning:
                TimelineView(.everyMinute) { context in
                    DormMorningPage(dorm: dorm, today: DormRules.today(context.date), minute: DormRules.minute(context.date))
                }
            case .room:
                EmptyView()
            }
        }
    }

    private func syncNow() {
        guard !dorm.syncing else { return }
        syncNotice = nil
        Task {
            let outcome = await dorm.sync(force: true)
            switch outcome {
            case .sent, .unchanged:
                syncNotice = "已同步"
                await dorm.loadPeople()
            case .skipped(let reason), .failed(let reason):
                syncNotice = reason
            }
        }
    }

    private func cell(for pick: DormCellPick) -> DormWeekCell? {
        DormRules.weekGrid(dorm.people, monday: DormRules.monday(pick.date), preferredId: dorm.meId)
            .rows.first { $0.period.number == pick.period }?
            .cells.first { $0.date == pick.date }
    }

    /// A partly free cell of today, else of the week, for a screenshot run.
    private func pickDebugCell() {
        let grid = DormRules.weekGrid(dorm.people, monday: monday, preferredId: dorm.meId)
        let cells = grid.rows.flatMap(\.cells)
        let chosen = cells.first { $0.date == today && $0.level == .some && !$0.busy.isEmpty }
            ?? cells.first { $0.level == .some && !$0.busy.isEmpty }
        if let chosen { cellPick = DormCellPick(date: chosen.date, period: chosen.period.number) }
    }
}

// MARK: Header

/// The dorm at a glance: everyone's colour, how many are in, who has not synced.
@available(iOS 17.0, *)
private struct DormHeader: View {
    @ObservedObject var dorm: NativeDormService
    let room: DormRoom

    var body: some View {
        let unsynced = room.members.filter { member in !(dorm.person(member.id)?.hasData ?? member.hasSnapshot) }
        DormCard(spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(room.members) { member in
                        let synced = dorm.person(member.id)?.hasData ?? member.hasSnapshot
                        VStack(spacing: 5) {
                            ZStack(alignment: .bottomTrailing) {
                                DormAvatar(name: member.nickname.isEmpty ? "室" : member.nickname, color: member.color, size: 42, faded: !synced)
                                if member.isOwner {
                                    Image(systemName: "crown.fill")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundStyle(.white)
                                        .frame(width: 18, height: 18)
                                        .background(Color.orange.gradient, in: Circle())
                                        .overlay { Circle().strokeBorder(Color(uiColor: .secondarySystemGroupedBackground), lineWidth: 2) }
                                        .offset(x: 4, y: 4)
                                }
                            }
                            Text(dorm.name(member.id)).font(.caption.weight(.semibold)).lineLimit(1)
                            Text(synced ? (member.isOwner ? "舍长" : "已同步") : "未同步")
                                .font(.caption2.weight(synced ? .regular : .semibold))
                                .foregroundStyle(synced ? Color.secondary : Color.orange)
                                .lineLimit(1)
                        }
                        .frame(minWidth: 52)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(dorm.name(member.id))\(member.isOwner ? "，舍长" : "")，\(synced ? "课表已同步" : "课表未同步")")
                    }
                }
                .padding(.vertical, 2)
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    counts(unsynced: unsynced.count)
                    Spacer(minLength: 4)
                    refreshed
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) { counts(unsynced: unsynced.count) }
                    refreshed
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }
}

@available(iOS 17.0, *)
private extension DormHeader {
    @ViewBuilder
    func counts(unsynced: Int) -> some View {
        Text("\(room.members.count) / \(room.memberLimit) 人").fixedSize()
        if unsynced > 0 { Text("· \(unsynced) 人未同步").foregroundStyle(.orange).fixedSize() }
    }

    @ViewBuilder
    var refreshed: some View {
        if let refreshed = dorm.refreshedAt {
            Text("更新于 \(DormText.time(refreshed))").foregroundStyle(.tertiary).fixedSize()
        }
    }
}

// MARK: Not in a dorm

@available(iOS 17.0, *)
private struct DormJoinView: View {
    @Binding var code: String
    let busy: Bool
    /// An invite link brought a code: joining comes first.
    let fromLink: Bool
    let onJoin: (String) -> Void
    let onCreate: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                hero
                if fromLink {
                    joinCard
                    createCard
                } else {
                    createCard
                    joinCard
                }
                DormNote(text: "宿舍里最多 8 个人。你的课表只对室友可见，退出宿舍后快照立即删除。", symbol: "lock.fill")
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var hero: some View {
        VStack(spacing: 12) {
            Image(systemName: "bed.double.fill")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 68, height: 68)
                .background(LinearGradient(colors: [.cpuBrand, .teal], startPoint: .topLeading, endPoint: .bottomTrailing),
                            in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .accessibilityHidden(true)
            Text("和室友一起看课表").font(.title3.weight(.bold))
            Text("建一个宿舍，把宿舍码发到群里，室友输进来就能一起看：一周里哪几节大家都有空、哪天谁要早八。人越多，「全宿舍都有空」越准。")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private var joinCard: some View {
        DormCard {
            Label("用宿舍码加入", systemImage: "person.badge.plus").font(.headline)
            TextField("6 位宿舍码", text: $code)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .submitLabel(.join)
                .focused($focused)
                .font(.system(.title2, design: .monospaced).weight(.semibold))
                .multilineTextAlignment(.center)
                .padding(.vertical, 10)
                .background(Color(uiColor: .tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .onChange(of: code) { _, value in
                    let cleaned = DormRules.typedCode(value)
                    if cleaned != value { code = cleaned }
                }
                .onSubmit { if canJoin { onJoin(code) } }
                .accessibilityLabel("宿舍码")
            Button {
                focused = false
                onJoin(code)
            } label: {
                Text(busy ? "加入中…" : "加入宿舍").font(.body.weight(.semibold)).frame(maxWidth: .infinity).padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 12))
            .disabled(!canJoin)
            Text("宿舍码由舍长发出，24 小时内有效。").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var canJoin: Bool { !busy && code.count >= DormRules.codeLength }

    private var createCard: some View {
        DormCard {
            Label("我建宿舍", systemImage: "house.fill").font(.headline)
            Text("生成宿舍码后发给室友就行。你成为舍长，可以管理成员和宿舍码。")
                .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button(action: onCreate) {
                Text("创建宿舍并生成宿舍码").font(.body.weight(.semibold)).frame(maxWidth: .infinity).padding(.vertical, 4)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: 12))
            .disabled(busy)
        }
    }
}

// MARK: 宿舍

@available(iOS 17.0, *)
private struct DormRoomPage: View {
    @ObservedObject var dorm: NativeDormService
    let room: DormRoom
    let busy: Bool
    let syncNotice: String?
    let act: (@escaping () async throws -> Void) -> Void
    let syncNow: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var removing: DormMember?
    @State private var confirmsLeave = false
    @State private var renaming = false
    @State private var nameDraft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            DormSectionTitle(title: "成员", trailing: "\(room.members.count) / \(room.memberLimit) 人")
            membersCard
            DormSectionTitle(title: "我的颜色")
            colorsCard
            DormSectionTitle(title: "我的课表")
            syncCard
            DormSectionTitle(title: "邀请室友")
            inviteCard
            DormNote(text: "你的课表只对室友可见；退出宿舍后快照立即删除。舍长退出时会把身份交给最早加入的室友。", symbol: "lock.fill")
            Button(role: .destructive) {
                confirmsLeave = true
            } label: {
                Text("退出宿舍").font(.body.weight(.semibold)).frame(maxWidth: .infinity).padding(.vertical, 4)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: 14))
            .tint(.red)
            .disabled(busy)
        }
        .confirmationDialog("退出宿舍？", isPresented: $confirmsLeave, titleVisibility: .visible) {
            Button("退出宿舍", role: .destructive) { act { try await dorm.leave() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text(room.isOwner && room.members.count > 1
                 ? "你的课表快照会立即删除，舍长身份交给最早加入的室友。"
                 : "你的课表快照会立即删除。")
        }
        .confirmationDialog(removing.map { "把\($0.nickname.isEmpty ? "这位室友" : $0.nickname)移出宿舍？" } ?? "",
                            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            titleVisibility: .visible, presenting: removing) { member in
            Button("移出", role: .destructive) { act { try await dorm.remove(member.id) } }
            Button("取消", role: .cancel) {}
        } message: { _ in
            Text("对方会收到通知，TA 的课表也会从宿舍里删除。")
        }
        .alert("宿舍名", isPresented: $renaming) {
            TextField("比如 6 栋 302", text: $nameDraft)
            Button("保存") {
                let value = nameDraft
                act { try await dorm.rename(value) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("最多 24 个字，室友都能看到。")
        }
    }

    // MARK: Members

    private var membersCard: some View {
        DormCard(spacing: 0) {
            if room.isOwner || !room.name.isEmpty {
                HStack(spacing: 12) {
                    Image(systemName: "house.fill")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Color.cpuBrand)
                        .frame(width: 36, height: 36)
                        .background(Color.cpuBrand.opacity(0.14), in: Circle())
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("宿舍名").font(.caption).foregroundStyle(.secondary)
                        Text(room.name.isEmpty ? "未命名" : room.name).font(.body.weight(.semibold))
                            .foregroundStyle(room.name.isEmpty ? Color.secondary : Color.primary)
                    }
                    Spacer(minLength: 4)
                    if room.isOwner {
                        Button("修改") {
                            nameDraft = room.name
                            renaming = true
                        }
                        .font(.subheadline.weight(.semibold))
                        .disabled(busy)
                    }
                }
                Divider().padding(.vertical, 10)
            }
            ForEach(Array(room.members.enumerated()), id: \.element.id) { index, member in
                if index > 0 { Divider().padding(.leading, 48).padding(.vertical, 8) }
                memberRow(member)
            }
        }
    }

    private func memberRow(_ member: DormMember) -> some View {
        let synced = dorm.person(member.id)?.hasData ?? member.hasSnapshot
        let tone = DormRules.tone(color: member.color, dark: colorScheme == .dark)
        let time = DormText.synced(member.syncedAt)
        return HStack(spacing: 12) {
            DormAvatar(name: member.nickname.isEmpty ? "室" : member.nickname, color: member.color, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(member.nickname.isEmpty ? "室友" : member.nickname)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(tone.name.color)
                        .lineLimit(typeSize.isAccessibilitySize ? 2 : 1)
                    if member.id == room.me.id { tag("我", tint: .cpuBrand) }
                    if member.isOwner { tag("舍长", tint: .orange) }
                }
                Text(synced ? (time.isEmpty ? "课表已同步" : "课表\(time)") : "还没有同步课表")
                    .font(.caption)
                    .foregroundStyle(synced ? Color.secondary : Color.orange)
            }
            Spacer(minLength: 4)
            if room.isOwner, member.id != room.me.id {
                Menu {
                    Button(role: .destructive) { removing = member } label: { Label("移出宿舍", systemImage: "person.fill.xmark") }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.body.weight(.semibold))
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
                .disabled(busy)
                .accessibilityLabel("管理 \(member.nickname)")
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func tag(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .foregroundStyle(tint)
            .padding(.horizontal, 6).padding(.vertical, 1)
            .background(tint.opacity(0.14), in: Capsule())
    }

    // MARK: Colour

    private var colorsCard: some View {
        DormCard {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 64 : 36), spacing: 6)], spacing: 10) {
                ForEach(DormRules.colors, id: \.key) { option in
                    swatch(option)
                }
            }
            Text("每人一种颜色，所有人看到的一样。选室友正在用的颜色就是两人互换。")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func swatch(_ option: (key: String, hue: Int, label: String)) -> some View {
        let mine = option.key == room.me.color
        let holder = room.members.first { $0.color == option.key && $0.id != room.me.id }
        let mark = mine ? "我" : holder.map { String(($0.nickname.isEmpty ? "室" : $0.nickname).prefix(1)) } ?? ""
        return Button {
            act { try await dorm.setColor(option.key) }
        } label: {
            VStack(spacing: 4) {
                Circle()
                    .fill(DormRules.swatch(option.key).color.gradient)
                    .frame(width: 32, height: 32)
                    .overlay { Text(mark).font(.system(size: 12, weight: .bold)).foregroundStyle(.white) }
                    .padding(3)
                    .overlay { Circle().strokeBorder(Color.primary, lineWidth: mine ? 2 : 0) }
                Text(option.label).font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Not `disabled`: that would grey out the user's own colour.
        .allowsHitTesting(!busy && !mine)
        .accessibilityLabel("\(option.label)色")
        .accessibilityValue(mine ? "我的颜色" : holder.map { "\($0.nickname) 在用，轻点互换" } ?? "")
        .accessibilityAddTraits(mine ? .isSelected : [])
    }

    // MARK: Upload

    private var syncCard: some View {
        let me = room.me
        let synced = DormText.synced(me.syncedAt)
        return DormCard {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: me.hasSnapshot ? "checkmark.icloud.fill" : "icloud.slash")
                    .font(.title3)
                    .foregroundStyle(me.hasSnapshot ? Color.cpuBrand : Color.orange)
                    .frame(width: 36)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(me.hasSnapshot ? (synced.isEmpty ? "已同步" : synced) : "还没有同步").font(.body.weight(.semibold))
                    Text(syncNotice ?? "打开课表会自动同步当前学期，包括自己改过的课和上课时间。")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            Button(action: syncNow) {
                HStack(spacing: 8) {
                    if dorm.syncing { ProgressView().controlSize(.small) }
                    Text(dorm.syncing ? "同步中…" : "立即同步").font(.body.weight(.semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 2)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: 12))
            .disabled(dorm.syncing)
        }
    }

    // MARK: Invite

    @ViewBuilder
    private var inviteCard: some View {
        DormCard {
            if !room.isOwner {
                let owner = room.members.first(where: \.isOwner)
                Text("宿舍码由舍长\(owner.map { "「\($0.nickname)」" } ?? "")发出。想拉新室友进来，找舍长要一个吧。")
                    .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else if room.isFull {
                Label("宿舍已满（\(room.memberLimit) 人），暂时不能再邀请人。", systemImage: "person.3.fill")
                    .font(.subheadline).foregroundStyle(.secondary)
            } else if let invite = room.liveInvite {
                VStack(spacing: 6) {
                    HStack(spacing: 6) {
                        ForEach(Array(invite.code.enumerated()), id: \.offset) { _, letter in
                            Text(String(letter))
                                .font(.system(.title2, design: .monospaced).weight(.bold))
                                .frame(maxWidth: 44)
                                .frame(minHeight: 44)
                                .frame(maxWidth: .infinity)
                                .background(Color(uiColor: .tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }
                    .dynamicTypeSize(...DynamicTypeSize.accessibility2)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("宿舍码 \(invite.code.map(String.init).joined(separator: " "))")
                    Text("24 小时内有效，多个室友可以用同一个码；宿舍满了之后自动作废。")
                        .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
                .textSelection(.enabled)
                ShareLink(item: DormRules.invitation(code: invite.code, origin: IOSNextWebConfiguration.appURL.absoluteString)) {
                    Label("发送给室友", systemImage: "square.and.arrow.up")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 12))
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { renewButton; cancelButton }
                    VStack(spacing: 8) { renewButton; cancelButton }
                }
            } else {
                Text("生成一个宿舍码发给室友，24 小时内多个人都能用它加入。")
                    .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Button {
                    act { try await dorm.renewInvite() }
                } label: {
                    Label("生成宿舍码", systemImage: "key.fill")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 12))
                .disabled(busy)
            }
        }
    }

    private var renewButton: some View {
        Button {
            act { try await dorm.renewInvite() }
        } label: {
            Label("换一个", systemImage: "arrow.triangle.2.circlepath").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .disabled(busy)
    }

    private var cancelButton: some View {
        Button(role: .destructive) {
            act { try await dorm.cancelInvite() }
        } label: {
            Label("取消宿舍码", systemImage: "xmark").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .disabled(busy)
    }
}
