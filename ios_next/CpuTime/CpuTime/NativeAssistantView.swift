import SwiftUI
import UIKit

/// Native conversation surface for the iOS shell. The Web session remains the
/// transport owner, while SwiftUI owns the keyboard, composer and scroll
/// geometry so the page above never gets pushed out of view.
struct NativeAssistantView: View {
    @ObservedObject var session: HybridWebViewStore
    let onOpen: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var composerFocused = false
    @State private var composerHeight: CGFloat = 42
    @State private var input = ""
    @State private var messages: [NativeAssistantMessage] = []
    @State private var isLoading = false
    @State private var errorMessage = ""
    @State private var requestGeneration = 0
    @State private var conversations: [NativeAssistantConversation] = []
    @State private var activeConversationID = ""
    @State private var messageSequence = 0
    @State private var historyPresented = false
    @State private var historyLoaded = false

    private let suggestions = ["宿舍电费在哪里查？", "怎么打开药苑之声？", "AI 额度怎么计算？"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if messages.isEmpty {
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
                        startNewConversation()
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(messages.isEmpty && input.isEmpty)
                    .accessibilityLabel("新建对话")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .tint(.cpuBrand)
            .alert("拾间 AI", isPresented: errorAlertBinding) {
                Button("知道了", role: .cancel) { errorMessage = "" }
            } message: {
                Text(errorMessage)
            }
            .sheet(isPresented: $historyPresented) {
                historySheet
                    .preferredColorScheme(session.pageColorScheme)
            }
        }
        .preferredColorScheme(session.pageColorScheme)
        .task {
            await loadHistory()
        }
        .onChange(of: session.authState.account) { _, _ in
            guard !isLoading else { return }
            historyLoaded = false
            Task { await loadHistory() }
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
                        Button { send(suggestion) } label: {
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
                if conversations.isEmpty {
                    ContentUnavailableView(
                        "暂无历史对话",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("发送第一条消息后，对话会自动保存在这里。")
                    )
                } else {
                    List {
                        ForEach(conversations) { conversation in
                            Button {
                                openConversation(conversation)
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
                                    deleteConversation(conversation)
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
                    Button("新建") { startNewConversation(); historyPresented = false }
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
                    ForEach(messages) { message in
                        messageView(message)
                            .id(message.id)
                    }
                    if isLoading {
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
            .onChange(of: messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.22)) {
                    if let last = messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
            .onChange(of: messages.last?.content) { _, _ in
                guard isLoading, let last = messages.last else { return }
                withAnimation(.easeOut(duration: 0.12)) { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            .onChange(of: isLoading) { _, loading in
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
                    .padding(.horizontal, 13)
                    .padding(.vertical, 10)
                    .background(Color.cpuBrand)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else {
                HStack(alignment: .bottom, spacing: 2) {
                    Text(markdown(message.content))
                        .font(.body)
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
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
                                .frame(maxWidth: .infinity, alignment: .leading)
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
                        .frame(maxWidth: 700)
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
                                Button(suggestion) { send(suggestion) }
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
                    text: $input,
                    isFocused: $composerFocused,
                    onSubmit: { send(input) },
                    onHeightChange: { height in
                        guard abs(composerHeight - height) > 0.5 else { return }
                        composerHeight = height
                    }
                )
                .frame(maxWidth: .infinity)
                .frame(height: composerHeight, alignment: .topLeading)
                if input.isEmpty {
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

            Button { send(input) } label: {
                Image(systemName: isLoading ? "hourglass" : "arrow.up")
                    .font(.system(size: 16, weight: .bold))
                    .frame(width: 42, height: 42)
                    .foregroundStyle(.white)
                    .background(Color.cpuBrand)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoading)
            .opacity(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoading ? 0.45 : 1)
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
            get: { !errorMessage.isEmpty },
            set: { if !$0 { errorMessage = "" } }
        )
    }

    private func send(_ value: String) {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isLoading else { return }
        input = ""
        composerHeight = 42
        let history = messages.suffix(60).map {
            [
                "role": $0.role.rawValue,
                "content": String($0.content.prefix(4000)),
            ]
        }
        ensureConversation(title: text)
        messages.append(NativeAssistantMessage(id: nextMessageID(), role: .user, content: text))
        persistActiveConversation(syncCloud: false)
        let assistantID = nextMessageID()
        messages.append(NativeAssistantMessage(id: assistantID, role: .assistant, content: "", streaming: true))
        isLoading = true
        errorMessage = ""
        requestGeneration += 1
        let generation = requestGeneration
        Task { @MainActor in
            do {
                let reply = try await session.nativeAssistantStream(
                    message: text,
                    history: history,
                    onDelta: { delta in
                        guard generation == requestGeneration,
                              let index = messages.firstIndex(where: { $0.id == assistantID }) else { return }
                        messages[index].content += delta
                        messages[index].streaming = true
                        messages[index].streamStatus = "正在生成回答…"
                    },
                    onStatus: { status in
                        guard generation == requestGeneration,
                              let index = messages.firstIndex(where: { $0.id == assistantID }) else { return }
                        messages[index].streamStatus = status
                    }
                )
                guard generation == requestGeneration else { return }
                guard let index = messages.firstIndex(where: { $0.id == assistantID }) else { return }
                messages[index].content = reply.answer
                messages[index].actions = reply.actions
                messages[index].suggestions = reply.suggestions
                messages[index].images = reply.images
                messages[index].sources = reply.sources
                messages[index].streaming = false
                messages[index].streamStatus = ""
                persistActiveConversation(syncCloud: true)
            } catch {
                guard generation == requestGeneration else { return }
                messages.removeAll { $0.id == assistantID }
                persistActiveConversation(syncCloud: false)
                errorMessage = (error as? LocalizedError)?.errorDescription ?? "拾间 AI 暂时不可用，请重试。"
            }
            if generation == requestGeneration { isLoading = false }
        }
    }

    private func startNewConversation() {
        session.cancelNativeAssistantStreams()
        requestGeneration += 1
        isLoading = false
        composerFocused = false
        messages.removeAll()
        input = ""
        errorMessage = ""
        activeConversationID = ""
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

    private func persistActiveConversation(syncCloud: Bool) {
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
        saveLocalHistory()
        guard syncCloud, session.isLoggedIn else { return }
        let conversation = conversations.first(where: { $0.id == activeConversationID })
        guard let conversation else { return }
        Task { @MainActor in
            _ = try? await session.saveNativeAssistantConversation(conversation)
        }
    }

    private func openConversation(_ conversation: NativeAssistantConversation) {
        session.cancelNativeAssistantStreams()
        requestGeneration += 1
        isLoading = false
        activeConversationID = conversation.id
        messages = conversation.messages.map(NativeAssistantMessage.init)
        messageSequence = messages.map(\.id).max() ?? 0
        input = ""
        errorMessage = ""
        historyPresented = false
    }

    private func deleteConversation(_ conversation: NativeAssistantConversation) {
        conversations.removeAll { $0.id == conversation.id }
        saveLocalHistory()
        if activeConversationID == conversation.id { startNewConversation() }
        guard session.isLoggedIn else { return }
        Task { @MainActor in
            try? await session.deleteNativeAssistantConversation(id: conversation.id)
        }
    }

    private func loadHistory() async {
        guard !historyLoaded else { return }
        historyLoaded = true
        let local = loadLocalHistory()
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
            saveLocalHistory()
            if let active = merged.first(where: { $0.id == activeConversationID }) {
                messages = active.messages.map(NativeAssistantMessage.init)
                messageSequence = messages.map(\.id).max() ?? 0
            } else if messages.isEmpty, let active = merged.first {
                openConversation(active)
            }
        } catch {
            // Local history is still useful when the account is offline. The
            // next open silently retries the cloud merge.
            historyLoaded = false
        }
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

    private func historyStorageKey() -> String {
        let account = session.authState.account.trimmingCharacters(in: .whitespacesAndNewlines)
        return "native-assistant-history:v1:\(account.isEmpty ? "default" : account)"
    }

    private func loadLocalHistory() -> [NativeAssistantConversation] {
        guard let data = UserDefaults.standard.data(forKey: historyStorageKey()),
              let decoded = try? JSONDecoder().decode([NativeAssistantConversation].self, from: data) else { return [] }
        return decoded.filter { !$0.messages.isEmpty }.sorted { $0.updatedAt > $1.updatedAt }.prefix(20).map { $0 }
    }

    private func saveLocalHistory() {
        guard let data = try? JSONEncoder().encode(conversations) else { return }
        UserDefaults.standard.set(data, forKey: historyStorageKey())
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
        let view = UITextView(frame: .zero)
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

private struct NativeAssistantMessage: Identifiable {
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
