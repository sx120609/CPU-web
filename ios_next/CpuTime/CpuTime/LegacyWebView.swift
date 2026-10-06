import Combine
import SwiftUI
import WebKit

/// iOS 15–16 use the complete website, without advertising native bridges
/// whose UI and background capabilities require iOS 17 or later.
struct LegacyWebView: View {
    @StateObject private var session = LegacyWebSession()

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { session.goBack() } label: { Image(systemName: "chevron.backward") }
                    .disabled(!session.canGoBack)
                    .accessibilityLabel("返回")
                Spacer()
                Menu {
                    ForEach(ShellTab.allCases, id: \.self) { tab in
                        Button { session.open(tab) } label: {
                            Label(tab.label, systemImage: tab.systemImage)
                        }
                    }
                } label: {
                    Label("药大拾间", systemImage: "chevron.down").font(.headline)
                }
                .accessibilityLabel("校园导航")
                Spacer()
                Button { session.reload() } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("刷新")
            }
            .padding(.horizontal).padding(.vertical, 10)
            if session.isLoading { ProgressView().progressViewStyle(.linear) }
            if let error = session.error {
                VStack(spacing: 12) {
                    Text("页面加载失败").font(.headline)
                    Text(error).font(.footnote).multilineTextAlignment(.center)
                    Button("重试") { session.reload() }
                }
                .padding()
            }
            LegacyWebSurface(session: session)
        }
        .onOpenURL { url in
            guard url.scheme == "cputime-next", url.host == "schedule" else { return }
            session.open(.schedule)
        }
    }
}

private struct LegacyWebSurface: UIViewRepresentable {
    let session: LegacyWebSession
    func makeUIView(context: Context) -> WKWebView { session.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

@MainActor
private final class LegacyWebSession: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published var canGoBack = false
    @Published var isLoading = true
    @Published var error: String?
    private var observations: [NSKeyValueObservation] = []
    let webView: WKWebView

    override init() {
        let configuration = WKWebViewConfiguration()
        // Retain the same persistent cookie store across app and OS upgrades.
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "CPUWebIOSApp/1 CPUTimeLegacy/1"
        if let resource = Bundle.main.url(forResource: "LegacyWebCompatibility", withExtension: "js"),
           let source = try? String(contentsOf: resource, encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(
                source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true
            ))
        }
        // The Web "存储与缓存" page works the same in the legacy wrapper.
        configuration.userContentController.addScriptMessageHandler(
            NativeStorageCleaner.shared, contentWorld: .page, name: NativeStorageCleaner.handlerName
        )
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        // Keep the legacy wrapper marker, but never CPUTimeNative: the site
        // must retain web navigation and must not expect native bridges.
        observations = [
            webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.canGoBack = self.webView.canGoBack
                }
            },
            webView.observe(\.isLoading, options: [.initial, .new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.isLoading = self.webView.isLoading
                }
            }
        ]
        webView.load(URLRequest(url: IOSNextWebConfiguration.appURL))
    }

    func goBack() { webView.goBack() }
    func reload() {
        error = nil
        if webView.url == nil { webView.load(URLRequest(url: IOSNextWebConfiguration.appURL)) }
        else { webView.reload() }
    }
    func open(_ tab: ShellTab) {
        let url = IOSNextWebConfiguration.appURLFor(tab: tab)
        error = nil
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { error = nil }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        record(error)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { record(error) }
    private func record(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        self.error = error.localizedDescription
        isLoading = false
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // Let the user retry rather than entering an unbounded reload loop.
        error = "页面已停止运行，请点重试重新加载。"
        isLoading = false
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if IOSNextWebConfiguration.isTrusted(url) || url.scheme == "about" {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            if ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url, IOSNextWebConfiguration.isTrusted(url) {
            webView.load(action.request)
        }
        return nil
    }
}
