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
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        requestGeneration += 1
                        isLoading = false
                        composerFocused = false
                        messages.removeAll()
                        input = ""
                        errorMessage = ""
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
        }
        .preferredColorScheme(session.pageColorScheme)
    }

    private var welcome: some View {
        // The welcome state does not need to scroll. Keeping it as a fixed
        // layout prevents UIKit from trying to reveal the focused text view by
        // moving the whole page when the keyboard appears.
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
        .frame(maxWidth: 620, maxHeight: .infinity, alignment: .topLeading)
        .padding(20)
        .clipped()
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
                Text(markdown(message.content))
                    .font(.body)
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
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
        messages.append(NativeAssistantMessage(role: .user, content: text))
        isLoading = true
        errorMessage = ""
        requestGeneration += 1
        let generation = requestGeneration
        Task { @MainActor in
            do {
                let reply = try await session.nativeAssistant(message: text, history: history)
                guard generation == requestGeneration else { return }
                messages.append(NativeAssistantMessage(
                    role: .assistant,
                    content: reply.answer,
                    actions: reply.actions,
                    suggestions: reply.suggestions,
                    images: reply.images,
                    sources: reply.sources
                ))
            } catch {
                guard generation == requestGeneration else { return }
                errorMessage = (error as? LocalizedError)?.errorDescription ?? "拾间 AI 暂时不可用，请重试。"
            }
            if generation == requestGeneration { isLoading = false }
        }
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

    let id = UUID()
    let role: Role
    let content: String
    var actions: [NativeAssistantAction] = []
    var suggestions: [String] = []
    var images: [NativeAssistantGeneratedImage] = []
    var sources: [NativeAssistantSource] = []
}
