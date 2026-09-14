import SwiftUI
import UIKit
import Combine

@MainActor
final class NativeAssistantModel: ObservableObject {
    @Published var input = ""
    @Published var messages: [NativeAssistantMessage] = []
    @Published var isLoading = false
    @Published var errorMessage = ""
    @Published private(set) var conversations: [NativeAssistantConversation] = []
    @Published private(set) var historyLoaded = false

    private(set) var activeConversationID = ""
    private var requestGeneration = 0
    private var messageSequence = 0
    private var streamTask: Task<Void, Never>?
    private var accountChangeTask: Task<Void, Never>?
    /// WebKit reports a few empty account states while restoring its cookie
    /// session. Keep the last confirmed identity so those bootstrap events do
    /// not cancel an otherwise healthy streaming answer.
    private var confirmedAccount = ""

    deinit {
        streamTask?.cancel()
        accountChangeTask?.cancel()
    }

    func send(_ value: String, using session: HybridWebViewStore) {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isLoading else { return }

        input = ""
        let history = messages.suffix(60).map {
            [
                "role": $0.role.rawValue,
                "content": String($0.content.prefix(4000)),
            ]
        }
        ensureConversation(title: text)
        messages.append(NativeAssistantMessage(id: nextMessageID(), role: .user, content: text))
        persistActiveConversation(using: session, syncCloud: false)

        let assistantID = nextMessageID()
        messages.append(NativeAssistantMessage(id: assistantID, role: .assistant, content: "", streaming: true))
        isLoading = true
        errorMessage = ""
        requestGeneration += 1
        let generation = requestGeneration

        // Keep the shared Web session alive while the sheet is dismissed. The
        // model itself lives on HybridWebViewStore, so leaving the AI surface
        // must not cancel or orphan this task.
        streamTask = Task { @MainActor [weak self, session] in
            guard let self else { return }
            do {
                let reply = try await session.nativeAssistantStream(
                    message: text,
                    history: history,
                    onDelta: { [weak self] delta in
                        Task { @MainActor [weak self] in
                            guard let self, generation == self.requestGeneration,
                                  let index = self.messages.firstIndex(where: { $0.id == assistantID }) else { return }
                            self.messages[index].content += delta
                            self.messages[index].streaming = true
                            self.messages[index].streamStatus = "正在生成回答…"
                        }
                    },
                    onStatus: { [weak self] status in
                        Task { @MainActor [weak self] in
                            guard let self, generation == self.requestGeneration,
                                  let index = self.messages.firstIndex(where: { $0.id == assistantID }) else { return }
                            self.messages[index].streamStatus = status
                        }
                    }
                )
                guard generation == self.requestGeneration,
                      let index = self.messages.firstIndex(where: { $0.id == assistantID }) else { return }
                self.messages[index].content = reply.answer
                self.messages[index].actions = reply.actions
                self.messages[index].suggestions = reply.suggestions
                self.messages[index].images = reply.images
                self.messages[index].sources = reply.sources
                self.messages[index].streaming = false
                self.messages[index].streamStatus = ""
                self.persistActiveConversation(using: session, syncCloud: true)
            } catch is CancellationError {
                guard generation == self.requestGeneration else { return }
                if let index = self.messages.firstIndex(where: { $0.id == assistantID }),
                   !self.messages[index].content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    self.messages[index].streaming = false
                    self.messages[index].streamStatus = "回答已中断，可重新提问"
                } else {
                    self.messages.removeAll { $0.id == assistantID }
                }
                self.persistActiveConversation(using: session, syncCloud: false)
            } catch {
                guard generation == self.requestGeneration else { return }
                if let index = self.messages.firstIndex(where: { $0.id == assistantID }),
                   !self.messages[index].content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    self.messages[index].streaming = false
                    self.messages[index].streamStatus = "回答未完成，可重新提问"
                } else {
                    self.messages.removeAll { $0.id == assistantID }
                }
                self.persistActiveConversation(using: session, syncCloud: false)
                self.errorMessage = (error as? LocalizedError)?.errorDescription ?? "拾间 AI 暂时不可用，请重试。"
            }
            if generation == self.requestGeneration {
                self.isLoading = false
                self.streamTask = nil
            }
        }
    }

    func startNewConversation(using session: HybridWebViewStore) {
        cancelStream(using: session)
        messages.removeAll()
        input = ""
        errorMessage = ""
        activeConversationID = ""
    }

    func openConversation(_ conversation: NativeAssistantConversation, using session: HybridWebViewStore) {
        cancelStream(using: session)
        activeConversationID = conversation.id
        messages = conversation.messages.map(NativeAssistantMessage.init)
        messageSequence = messages.map(\.id).max() ?? 0
        input = ""
        errorMessage = ""
    }

    func deleteConversation(_ conversation: NativeAssistantConversation, using session: HybridWebViewStore) {
        conversations.removeAll { $0.id == conversation.id }
        saveLocalHistory(using: session)
        if activeConversationID == conversation.id {
            startNewConversation(using: session)
        }
        guard session.isLoggedIn else { return }
        Task { @MainActor in
            try? await session.deleteNativeAssistantConversation(id: conversation.id)
        }
    }

    func accountDidChange(using session: HybridWebViewStore) {
        accountChangeTask?.cancel()
        // WKWebView can publish a transient empty or unauthenticated report
        // while restoring cookies after a route change. Confirm the state after
        // a short quiet period before clearing a conversation or its stream.
        accountChangeTask = Task { @MainActor [weak self, weak session] in
            try? await Task.sleep(nanoseconds: 450_000_000)
            guard let self, let session, !Task.isCancelled else { return }
            self.applyConfirmedAccountChange(using: session)
        }
    }

    private func applyConfirmedAccountChange(using session: HybridWebViewStore) {
        guard session.authState.ready else { return }
        let nextAccount = session.authState.account.trimmingCharacters(in: .whitespacesAndNewlines)
        if nextAccount.isEmpty, session.authState.authenticated { return }
        guard nextAccount != confirmedAccount else { return }
        let hadConfirmedAccount = !confirmedAccount.isEmpty
        confirmedAccount = nextAccount
        // The first non-empty report after launch only establishes the account
        // used for local history. A real switch or a confirmed logout clears a
        // live stream and all account-scoped messages.
        guard hadConfirmedAccount || nextAccount.isEmpty else {
            historyLoaded = false
            Task { @MainActor [weak self, weak session] in
                guard let self, let session else { return }
                await self.loadHistory(using: session)
            }
            return
        }
        cancelStream(using: session)
        messages.removeAll()
        conversations.removeAll()
        activeConversationID = ""
        messageSequence = 0
        historyLoaded = false
        Task { @MainActor [weak self, weak session] in
            guard let self, let session else { return }
            await self.loadHistory(using: session)
        }
    }

    func loadHistory(using session: HybridWebViewStore) async {
        guard !historyLoaded else { return }
        if session.authState.ready, !session.authState.account.isEmpty {
            confirmedAccount = session.authState.account.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        historyLoaded = true
        let local = loadLocalHistory(using: session)
        conversations = local
        if let active = local.first {
            activeConversationID = active.id
            messages = active.messages.map(NativeAssistantMessage.init)
            messageSequence = messages.map(\.id).max() ?? 0
        }
        guard session.isLoggedIn else { return }
        do {
            let cloud = try await session.listNativeAssistantConversations()
            let merged = mergeConversations(local: conversations, cloud: cloud)
            conversations = merged
            saveLocalHistory(using: session)
            if let active = merged.first(where: { $0.id == activeConversationID }) {
                messages = active.messages.map(NativeAssistantMessage.init)
                messageSequence = messages.map(\.id).max() ?? 0
            } else if messages.isEmpty, let active = merged.first {
                openConversation(active, using: session)
            }
        } catch {
            // Keep local history available while offline and retry next time.
            historyLoaded = false
        }
    }

    private func cancelStream(using session: HybridWebViewStore) {
        requestGeneration += 1
        isLoading = false
        streamTask?.cancel()
        streamTask = nil
        session.cancelNativeAssistantStreams()
    }

    private func ensureConversation(title: String) {
        guard !conversations.contains(where: { $0.id == activeConversationID }) else { return }
        let conversation = NativeAssistantConversation(
            id: UUID().uuidString.lowercased(),
            title: String(title.prefix(80)),
            messages: []
        )
        activeConversationID = conversation.id
        conversations.insert(conversation, at: 0)
    }

    private func nextMessageID() -> Int {
        messageSequence += 1
        return messageSequence
    }

    private func persistActiveConversation(using session: HybridWebViewStore, syncCloud: Bool) {
        guard let index = conversations.firstIndex(where: { $0.id == activeConversationID }) else { return }
        let stored = messages
            .filter { !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !$0.streaming }
            .suffix(60)
            .map(\.stored)
        guard !stored.isEmpty else { return }
        conversations[index].messages = Array(stored)
        conversations[index].updatedAt = Int(Date().timeIntervalSince1970 * 1000)
        if let firstUser = stored.first(where: { $0.role == .user }) {
            conversations[index].title = String(firstUser.content.prefix(80))
        }
        conversations.sort { $0.updatedAt > $1.updatedAt }
        saveLocalHistory(using: session)
        guard syncCloud, session.isLoggedIn,
              let conversation = conversations.first(where: { $0.id == activeConversationID }) else { return }
        Task { @MainActor in
            _ = try? await session.saveNativeAssistantConversation(conversation)
        }
    }

    private func historyStorageKey(using session: HybridWebViewStore) -> String {
        let account = session.authState.account.trimmingCharacters(in: .whitespacesAndNewlines)
        return "native-assistant-history:v1:\(account.isEmpty ? "default" : account)"
    }

    private func loadLocalHistory(using session: HybridWebViewStore) -> [NativeAssistantConversation] {
        guard let data = UserDefaults.standard.data(forKey: historyStorageKey(using: session)),
              let decoded = try? JSONDecoder().decode([NativeAssistantConversation].self, from: data) else { return [] }
        return decoded.filter { !$0.messages.isEmpty }.sorted { $0.updatedAt > $1.updatedAt }.prefix(20).map { $0 }
    }

    private func saveLocalHistory(using session: HybridWebViewStore) {
        guard let data = try? JSONEncoder().encode(conversations) else { return }
        UserDefaults.standard.set(data, forKey: historyStorageKey(using: session))
    }

    private func mergeConversations(local: [NativeAssistantConversation], cloud: [NativeAssistantConversation]) -> [NativeAssistantConversation] {
        var merged: [String: NativeAssistantConversation] = [:]
        let deletedIDs = Set(cloud.filter { $0.deletedAt != nil }.map(\.id))
        for conversation in local + cloud where conversation.deletedAt == nil && !deletedIDs.contains(conversation.id) && !conversation.messages.isEmpty {
            if let current = merged[conversation.id], current.updatedAt >= conversation.updatedAt { continue }
            merged[conversation.id] = conversation
        }
        return merged.values.sorted { $0.updatedAt > $1.updatedAt }.prefix(20).map { $0 }
    }
}

/// Native conversation surface for the iOS shell. The Web session remains the
/// transport owner, while SwiftUI owns the keyboard, composer and scroll
/// geometry so the page above never gets pushed out of view.
struct NativeAssistantView: View {
    @ObservedObject var session: HybridWebViewStore
    @ObservedObject private var assistant: NativeAssistantModel
    let onOpen: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var composerFocused = false
    @State private var composerHeight: CGFloat = 42
    @State private var historyPresented = false

    private let suggestions = ["宿舍电费在哪里查？", "怎么打开药苑之声？", "AI 额度怎么计算？"]

    init(session: HybridWebViewStore, onOpen: @escaping (String) -> Void) {
        self.session = session
        self.onOpen = onOpen
        _assistant = ObservedObject(wrappedValue: session.assistantModel)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if assistant.messages.isEmpty {
                    welcome
                } else {
                    conversation
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                composer
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("拾间 AI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button {
                        historyPresented = true
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                    }
                    .accessibilityLabel("历史对话")
                    Button {
                        assistant.startNewConversation(using: session)
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(assistant.messages.isEmpty && assistant.input.isEmpty)
                    .accessibilityLabel("新建对话")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .tint(.cpuBrand)
            .alert("拾间 AI", isPresented: errorAlertBinding) {
                Button("知道了", role: .cancel) { assistant.errorMessage = "" }
            } message: {
                Text(assistant.errorMessage)
            }
            .sheet(isPresented: $historyPresented) {
                historySheet
                    .preferredColorScheme(session.pageColorScheme)
            }
        }
        .preferredColorScheme(session.pageColorScheme)
        .task {
            await assistant.loadHistory(using: session)
        }
        .onChange(of: session.authState) { _, _ in
            assistant.accountDidChange(using: session)
        }
    }

    private var welcome: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 25, weight: .semibold))
                    .foregroundStyle(Color.cpuBrand)
                    .frame(width: 48, height: 48)
                    .background(Color.cpuBrand.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                Text("想做什么？直接告诉我。")
                    .font(.title3.weight(.bold))
                Text("可以询问站内功能、校园服务和操作步骤，也可以直接聊天。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("拾间 AI 不会读取你的课表、成绩或其他个人数据；涉及本人数据时会引导你进入对应页面自行查看。")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 3)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(suggestions, id: \.self) { suggestion in
                        Button { assistant.send(suggestion, using: session) } label: {
                            Text(suggestion)
                                .font(.caption.weight(.medium))
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 11)
                                .padding(.vertical, 10)
                                .background(Color(uiColor: .secondarySystemGroupedBackground))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(Color(uiColor: .separator).opacity(0.55), lineWidth: 1)
                                }
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.primary)
                    }
                }
                .padding(.top, 6)
            }
            .frame(maxWidth: 620, alignment: .topLeading)
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var historySheet: some View {
        NavigationStack {
            Group {
                if assistant.conversations.isEmpty {
                    ContentUnavailableView(
                        "暂无历史对话",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("发送第一条消息后，对话会自动保存在这里。")
                    )
                } else {
                    List {
                        ForEach(assistant.conversations) { conversation in
                            Button {
                                assistant.openConversation(conversation, using: session)
                                historyPresented = false
                            } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(conversation.title)
                                        .font(.body.weight(.medium))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                    Text(conversationPreview(conversation))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                    Text(formatHistoryDate(conversation.updatedAt))
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    assistant.deleteConversation(conversation, using: session)
                                } label: {
                                    Label("删除", systemImage: "trash")
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("历史对话")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("新建") { assistant.startNewConversation(using: session); historyPresented = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { historyPresented = false }
                }
            }
        }
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(assistant.messages) { message in
                        messageView(message)
                            .id(message.id)
                    }
                    if assistant.isLoading {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small).tint(.cpuBrand)
                            Text("正在生成回答…")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 4)
                        .id("loading")
                    }
                }
                .frame(maxWidth: 700, alignment: .leading)
                .padding(.horizontal, 18)
                .padding(.vertical, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: assistant.messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.22)) {
                    if let last = assistant.messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
            .onChange(of: assistant.messages.last?.content) { _, _ in
                guard assistant.isLoading, let last = assistant.messages.last else { return }
                withAnimation(.easeOut(duration: 0.12)) { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            .onChange(of: assistant.isLoading) { _, loading in
                guard loading else { return }
                withAnimation(.easeOut(duration: 0.22)) { proxy.scrollTo("loading", anchor: .bottom) }
            }
        }
    }

    @ViewBuilder
    private func messageView(_ message: NativeAssistantMessage) -> some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 7) {
            if message.role == .user {
                Text(message.content)
                    .font(.body)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: 340, alignment: .leading)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 10)
                    .background(Color.cpuBrand)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else {
                HStack(alignment: .bottom, spacing: 2) {
                    Text(markdown(message.content))
                        .font(.body)
                        .foregroundStyle(.primary)
                        .frame(maxWidth: 620, alignment: .leading)
                        .textSelection(.enabled)
                    if message.streaming {
                        Text("▌")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Color.cpuBrand)
                            .transition(.opacity)
                    }
                }
                if message.streaming {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.mini).tint(.cpuBrand)
                        Text(message.streamStatus.isEmpty ? "正在生成回答…" : message.streamStatus)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if !message.actions.isEmpty {
                    VStack(spacing: 8) {
                        ForEach(message.actions) { action in
                            Button { open(action.url) } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "arrow.up.right.square")
                                        .foregroundStyle(Color.cpuBrand)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(action.label).font(.subheadline.weight(.semibold))
                                        Text(action.description)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(2)
                                    }
                                    Spacer(minLength: 4)
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.tertiary)
                                }
                                .frame(maxWidth: 620, alignment: .leading)
                                .padding(11)
                                .background(Color(uiColor: .secondarySystemGroupedBackground))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(Color(uiColor: .separator).opacity(0.5), lineWidth: 1)
                                }
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 2)
                }
                if !message.images.isEmpty {
                    ForEach(message.images) { image in
                        AsyncImage(url: resourceURL(image.url)) { state in
                            switch state {
                            case .success(let content):
                                content
                                    .resizable()
                                    .scaledToFit()
                            case .failure:
                                Label("图片暂时无法加载", systemImage: "photo.badge.exclamationmark")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, minHeight: 84)
                            default:
                                ProgressView()
                                    .frame(maxWidth: .infinity, minHeight: 84)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .accessibilityLabel(image.alt)
                    }
                }
                if !message.sources.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(message.sources) { source in
                                Button {
                                    open(source.url)
                                } label: {
                                    Label(source.title, systemImage: "link")
                                        .font(.caption)
                                        .lineLimit(1)
                                        .padding(.horizontal, 9)
                                        .padding(.vertical, 7)
                                        .background(Color(uiColor: .secondarySystemGroupedBackground))
                                        .clipShape(Capsule())
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(Color.cpuBrand)
                            }
                        }
                    }
                }
                if !message.suggestions.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(message.suggestions, id: \.self) { suggestion in
                                Button(suggestion) { assistant.send(suggestion, using: session) }
                                    .font(.caption.weight(.medium))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 7)
                                    .background(Color.cpuBrand.opacity(0.1))
                                    .clipShape(Capsule())
                                    .buttonStyle(.plain)
                                    .foregroundStyle(Color.cpuBrand)
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            ZStack(alignment: .topLeading) {
                NativeAssistantTextEditor(
                    text: $assistant.input,
                    isFocused: $composerFocused,
                    onSubmit: { assistant.send(assistant.input, using: session) },
                    onHeightChange: { height in
                        guard abs(composerHeight - height) > 0.5 else { return }
                        composerHeight = height
                    }
                )
                .frame(maxWidth: .infinity)
                .frame(height: composerHeight, alignment: .topLeading)
                if assistant.input.isEmpty {
                    Text("给拾间 AI 发消息")
                        .font(.body)
                        .foregroundStyle(.tertiary)
                        .padding(.leading, 13)
                        .padding(.top, 10)
                        .allowsHitTesting(false)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: composerHeight, alignment: .topLeading)
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .background(Color(uiColor: .tertiarySystemFill))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(composerFocused ? Color.cpuBrand : Color(uiColor: .separator).opacity(0.65), lineWidth: composerFocused ? 1.5 : 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .animation(.easeOut(duration: 0.14), value: composerHeight)

            Button { assistant.send(assistant.input, using: session) } label: {
                Image(systemName: assistant.isLoading ? "hourglass" : "arrow.up")
                    .font(.system(size: 16, weight: .bold))
                    .frame(width: 42, height: 42)
                    .foregroundStyle(.white)
                    .background(Color.cpuBrand)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(assistant.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || assistant.isLoading)
            .opacity(assistant.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || assistant.isLoading ? 0.45 : 1)
            .accessibilityLabel("发送")
        }
        .padding(.horizontal, 14)
        .padding(.top, 9)
        .padding(.bottom, 8)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { !assistant.errorMessage.isEmpty },
            set: { if !$0 { assistant.errorMessage = "" } }
        )
    }

    private func conversationPreview(_ conversation: NativeAssistantConversation) -> String {
        conversation.messages.last(where: { !$0.content.isEmpty })?.content ?? "空对话"
    }

    private func formatHistoryDate(_ value: Int) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(value) / 1000)
        if Calendar.current.isDateInToday(date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.month().day())
    }

    private func markdown(_ value: String) -> AttributedString {
        (try? AttributedString(markdown: value)) ?? AttributedString(value)
    }

    private func resourceURL(_ value: String) -> URL? {
        guard let url = URL(string: value) else { return nil }
        if url.scheme != nil { return url }
        return URL(string: value, relativeTo: IOSNextWebConfiguration.appURL)?.absoluteURL
    }

    private func open(_ value: String) {
        let url = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else { return }
        if url.hasPrefix("/") {
            onOpen(url)
        } else if let external = URL(string: url) {
            UIApplication.shared.open(external)
        }
    }
}

/// UITextView gives the composer a real intrinsic content height. SwiftUI's
/// multiline TextField reports the configured line limit as its ideal height
/// on newer iOS versions, which makes the empty field jump to five lines as
/// soon as it receives text.
private final class NativeAssistantMeasuringTextView: UITextView {
    var onLayout: ((UITextView) -> Void)?
    private var lastSize: CGSize = .zero

    override func layoutSubviews() {
        super.layoutSubviews()
        let size = bounds.size
        guard abs(size.width - lastSize.width) > 0.5 || abs(size.height - lastSize.height) > 0.5 else {
            return
        }
        lastSize = size
        onLayout?(self)
    }
}

private struct NativeAssistantTextEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    let onSubmit: () -> Void
    let onHeightChange: (CGFloat) -> Void

    private let minHeight: CGFloat = 42
    private let maxHeight: CGFloat = 122

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UITextView {
        let view = NativeAssistantMeasuringTextView(frame: .zero)
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = UIFont.preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textColor = .label
        view.tintColor = UIColor(Color.cpuBrand)
        view.isEditable = true
        view.isSelectable = true
        view.autocapitalizationType = .sentences
        view.autocorrectionType = .yes
        view.returnKeyType = .send
        view.enablesReturnKeyAutomatically = false
        view.textContainerInset = UIEdgeInsets(top: 9, left: 13, bottom: 9, right: 13)
        view.textContainer.lineFragmentPadding = 0
        // Character wrapping keeps Chinese text and long unbroken words from
        // scrolling sideways inside the composer on narrow iPhone widths.
        view.textContainer.lineBreakMode = .byCharWrapping
        view.isScrollEnabled = false
        view.showsVerticalScrollIndicator = false
        view.showsHorizontalScrollIndicator = false
        view.keyboardDismissMode = .interactive
        view.accessibilityLabel = "给拾间 AI 发消息"
        view.accessibilityHint = "输入问题后按发送键"
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.onLayout = { [weak coordinator = context.coordinator] textView in
            coordinator?.parent.updateHeight(for: textView)
        }
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        if view.text != text {
            view.text = text
        }
        view.accessibilityValue = text
        if isFocused, !view.isFirstResponder {
            view.becomeFirstResponder()
        } else if !isFocused, view.isFirstResponder {
            view.resignFirstResponder()
        }
        view.layoutIfNeeded()
        updateHeight(for: view)
    }

    private func updateHeight(for view: UITextView) {
        guard view.bounds.width > 0 else { return }
        let expectedText = text
        guard !text.isEmpty else {
            view.isScrollEnabled = false
            DispatchQueue.main.async {
                // Ignore a queued measurement from text that was submitted in
                // the meantime; otherwise the composer can grow again after
                // send() has already reset it to one line.
                guard view.text == expectedText else { return }
                onHeightChange(minHeight)
            }
            return
        }
        view.isScrollEnabled = false
        // Measure the laid-out glyphs instead of relying on sizeThatFits. A
        // UITextView embedded in a flexible SwiftUI row can otherwise report
        // its single-line width while its bounds are being negotiated, which
        // clips long questions instead of growing the composer.
        let insets = view.textContainerInset
        let availableWidth = max(1, view.bounds.width - insets.left - insets.right)
        view.textContainer.size = CGSize(width: availableWidth, height: .greatestFiniteMagnitude)
        view.layoutManager.ensureLayout(for: view.textContainer)
        let usedRect = view.layoutManager.usedRect(for: view.textContainer)
        let fitting = ceil(usedRect.height + insets.top + insets.bottom)
        let height = min(max(fitting, minHeight), maxHeight)
        view.isScrollEnabled = fitting > maxHeight + 0.5
        DispatchQueue.main.async {
            guard view.text == expectedText else { return }
            onHeightChange(height)
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: NativeAssistantTextEditor

        init(parent: NativeAssistantTextEditor) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            parent.updateHeight(for: textView)
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            parent.isFocused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            parent.isFocused = false
        }

        func textView(
            _ textView: UITextView,
            shouldChangeTextIn range: NSRange,
            replacementText replacement: String
        ) -> Bool {
            guard replacement == "\n" else { return true }
            parent.onSubmit()
            return false
        }
    }
}

struct NativeAssistantMessage: Identifiable {
    enum Role: String { case user, assistant }

    let id: Int
    let role: Role
    var content: String
    var actions: [NativeAssistantAction] = []
    var suggestions: [String] = []
    var images: [NativeAssistantGeneratedImage] = []
    var sources: [NativeAssistantSource] = []
    var streaming = false
    var streamStatus = ""

    nonisolated init(
        id: Int,
        role: Role,
        content: String,
        actions: [NativeAssistantAction] = [],
        suggestions: [String] = [],
        images: [NativeAssistantGeneratedImage] = [],
        sources: [NativeAssistantSource] = [],
        streaming: Bool = false,
        streamStatus: String = ""
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.actions = actions
        self.suggestions = suggestions
        self.images = images
        self.sources = sources
        self.streaming = streaming
        self.streamStatus = streamStatus
    }

    nonisolated init(_ stored: NativeAssistantStoredMessage) {
        self.init(
            id: stored.id,
            role: Role(rawValue: stored.role.rawValue) ?? .assistant,
            content: stored.content,
            actions: stored.actions,
            suggestions: stored.suggestions,
            images: stored.images,
            sources: stored.sources
        )
    }

    var stored: NativeAssistantStoredMessage {
        NativeAssistantStoredMessage(
            id: id,
            role: NativeAssistantStoredMessage.Role(rawValue: role.rawValue) ?? .assistant,
            content: content,
            actions: actions,
            suggestions: suggestions,
            images: images,
            sources: sources
        )
    }
}
