import SwiftUI
import UIKit

/// Native conversation surface for the iOS shell. The Web session remains the
/// transport owner, while SwiftUI owns the keyboard, composer and scroll
/// geometry so the page above never gets pushed out of view.
struct NativeAssistantView: View {
    @ObservedObject var session: HybridWebViewStore
    let onOpen: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var composerFocused: Bool
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
        ScrollView {
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
            .frame(maxWidth: 620, alignment: .leading)
            .padding(20)
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
            TextField("给拾间 AI 发消息", text: $input, axis: .vertical)
                .lineLimit(1...4)
                .focused($composerFocused)
                .textInputAutocapitalization(.sentences)
                .autocorrectionDisabled(false)
                .font(.body)
                .textFieldStyle(.plain)
                .padding(.horizontal, 13)
                .padding(.vertical, 10)
                .background(Color(uiColor: .secondarySystemBackground))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(composerFocused ? Color.cpuBrand : Color(uiColor: .separator).opacity(0.65), lineWidth: composerFocused ? 1.5 : 1)
                }
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .submitLabel(.send)
                .onSubmit { send(input) }

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
        .padding(.vertical, 9)
        .background(.ultraThinMaterial)
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
        composerFocused = false
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
