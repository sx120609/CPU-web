import Foundation
import Combine
import Network
import SwiftUI
import UIKit
import WebKit


enum IOSNextWebConfiguration {
    static let versionCode = 22
    static let versionName = "3.8.0"

    static var appURL: URL {
        let configured = Bundle.main.object(forInfoDictionaryKey: "CPUAppURL") as? String
        let bundleValue = configured?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
#if DEBUG
        let environmentValue = ProcessInfo.processInfo.environment["CPU_APP_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let raw = environmentValue.isEmpty ? bundleValue : environmentValue
#else
        let raw = bundleValue
#endif
        if let url = URL(string: raw), url.host != nil, ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            return url
        }
        return URL(string: "https://cputime.cn/home")!
    }

    // The bridge is installed only for the configured first-party origin.
    // Payment and arbitrary external pages are opened outside this WKWebView.
    static var appHost: String {
        appURL.host?.lowercased() ?? "cputime.cn"
    }

    static func isTrusted(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = url.host?.lowercased() else { return false }
        return host == appHost && scheme == appURL.scheme?.lowercased()
            && (url.port ?? (scheme == "https" ? 443 : 80)) == (appURL.port ?? (appURL.scheme == "https" ? 443 : 80))
    }

    static func routeURL(_ path: String) -> URL? {
        let value = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.hasPrefix("/"), !value.hasPrefix("//"),
              !value.contains(where: { $0 == "\0" || $0.isNewline }) else { return nil }
        guard let components = URLComponents(string: value),
              components.scheme == nil,
              components.host == nil,
              components.path.hasPrefix("/") else { return nil }
        return URL(string: value, relativeTo: appURL)?.absoluteURL
    }

    static func javascriptString(_ value: String) -> String {
        let data = try? JSONEncoder().encode(value)
        return String(data: data ?? Data("\"\"".utf8), encoding: .utf8) ?? "\"\""
    }

    static func appURLFor(tab: ShellTab) -> URL {
        routeURL(tab.defaultPath) ?? appURL
    }
}

struct NativeLoginResponse: Sendable {
    let ok: Bool
    let needCaptcha: Bool
    let captchaImage: String
    let error: String
    let account: String
    let canAccessAdmin: Bool
}

struct NativeAssistantAction: Codable, Sendable, Identifiable {
    let id: String
    let label: String
    let description: String
    let url: String
    let icon: String
    let requireLogin: Bool

    var identity: String { id }
}

struct NativeAssistantGeneratedImage: Codable, Sendable, Identifiable {
    let url: String
    let alt: String

    var id: String { url }
}

struct NativeAssistantSource: Codable, Sendable, Identifiable {
    let title: String
    let url: String

    var id: String { url }
}

/// The persisted message shape mirrors the Web assistant history contract.
/// Keeping the wire model separate from the SwiftUI streaming state means an
/// interrupted response can never be written as a permanently streaming one.
struct NativeAssistantStoredMessage: Codable, Sendable, Identifiable {
    enum Role: String, Codable, Sendable {
        case user
        case assistant
    }

    let id: Int
    let role: Role
    var content: String
    var actions: [NativeAssistantAction]
    var suggestions: [String]
    var images: [NativeAssistantGeneratedImage]
    var sources: [NativeAssistantSource]

    init(
        id: Int,
        role: Role,
        content: String,
        actions: [NativeAssistantAction] = [],
        suggestions: [String] = [],
        images: [NativeAssistantGeneratedImage] = [],
        sources: [NativeAssistantSource] = []
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.actions = actions
        self.suggestions = suggestions
        self.images = images
        self.sources = sources
    }

    private enum CodingKeys: String, CodingKey {
        case id, role, content, actions, suggestions, images, sources
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try values.decode(Int.self, forKey: .id),
            role: try values.decode(Role.self, forKey: .role),
            content: try values.decode(String.self, forKey: .content),
            actions: try values.decodeIfPresent([NativeAssistantAction].self, forKey: .actions) ?? [],
            suggestions: try values.decodeIfPresent([String].self, forKey: .suggestions) ?? [],
            images: try values.decodeIfPresent([NativeAssistantGeneratedImage].self, forKey: .images) ?? [],
            sources: try values.decodeIfPresent([NativeAssistantSource].self, forKey: .sources) ?? []
        )
    }
}

struct NativeAssistantConversation: Codable, Sendable, Identifiable {
    let id: String
    var title: String
    var updatedAt: Int
    var messages: [NativeAssistantStoredMessage]
    var deletedAt: Int?

    init(
        id: String,
        title: String,
        updatedAt: Int = Int(Date().timeIntervalSince1970 * 1000),
        messages: [NativeAssistantStoredMessage],
        deletedAt: Int? = nil
    ) {
        self.id = id
        self.title = title
        self.updatedAt = updatedAt
        self.messages = messages
        self.deletedAt = deletedAt
    }
}

struct NativeAssistantReply: Codable, Sendable {
    let answer: String
    let actions: [NativeAssistantAction]
    let suggestions: [String]
    let fallback: Bool
    let images: [NativeAssistantGeneratedImage]
    let sources: [NativeAssistantSource]

    init(
        answer: String,
        actions: [NativeAssistantAction],
        suggestions: [String],
        fallback: Bool,
        images: [NativeAssistantGeneratedImage] = [],
        sources: [NativeAssistantSource] = []
    ) {
        self.answer = answer
        self.actions = actions
        self.suggestions = suggestions
        self.fallback = fallback
        self.images = images
        self.sources = sources
    }

    private enum CodingKeys: String, CodingKey {
        case answer, actions, suggestions, fallback, images, sources
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        answer = try container.decode(String.self, forKey: .answer)
        actions = try container.decodeIfPresent([NativeAssistantAction].self, forKey: .actions) ?? []
        suggestions = try container.decodeIfPresent([String].self, forKey: .suggestions) ?? []
        fallback = try container.decodeIfPresent(Bool.self, forKey: .fallback) ?? false
        images = try container.decodeIfPresent([NativeAssistantGeneratedImage].self, forKey: .images) ?? []
        sources = try container.decodeIfPresent([NativeAssistantSource].self, forKey: .sources) ?? []
    }
}

enum NativeAssistantError: LocalizedError, Sendable {
    case unavailable
    case requestFailed(String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .unavailable: return "拾间 AI 服务正在启动，请稍候再试。"
        case .requestFailed(let message): return message
        case .invalidResponse: return "拾间 AI 响应异常，请重试。"
        }
    }
}

/// Authentication reports from the Web bridge. `ready == false` means the
/// Pinia cookie probe is still in flight; it must never be interpreted as a
/// signed-out account by the native shell.
struct NativeAuthState: Equatable, Sendable {
    let account: String
    let authenticated: Bool
    let ready: Bool
    let canAccessAdmin: Bool

    init(account: String = "", authenticated: Bool = false, ready: Bool = false, canAccessAdmin: Bool = false) {
        self.account = account.trimmingCharacters(in: .whitespacesAndNewlines)
        self.authenticated = authenticated
        self.ready = ready
        self.canAccessAdmin = canAccessAdmin
    }
}

@MainActor
final class HybridWebViewStore: NSObject, ObservableObject, WKScriptMessageHandler {
    static let handlerName = "cpuTimeNative"
    @Published private(set) var isLoading = true
    @Published private(set) var canGoBack = false
    @Published private(set) var errorMessage: String?
    /// Cache the Web appearance so the native shell has the right scheme on a
    /// cold start, before the shared WebView finishes loading.
    @Published private(set) var pageColorScheme: ColorScheme? = HybridWebViewStore.storedAppearanceScheme()
    @Published private(set) var appearanceMode: String = UserDefaults.standard.string(forKey: HybridWebViewStore.appearanceModeKey) ?? "system"
    @Published private(set) var isLoggedIn = false
    /// The Web auth store is the authority for the site session. Keep the
    /// latest complete report so the native shell can distinguish a real site
    /// logout from a JWXT-only expiry or an early Pinia bootstrap update.
    @Published private(set) var authState = NativeAuthState()
    /// Mirrors Web's `canAccessModuleAdmin` getter so the native quick menu
    /// exposes the same management entry points as the browser shell.
    @Published private(set) var canAccessAdmin = false
    @Published private(set) var isNetworkUnavailable = false
    @Published private(set) var serviceUnavailableMessage: String?

    /// While the native login gate is up, only authentication pages may load.
    /// A main-frame navigation anywhere else is cancelled instead of being
    /// allowed to replace the login page.
    var blocksInternalNavigation = false
    /// The path the shared WebView last settled on, used to avoid re-issuing
    /// the same gate navigation.
    private(set) var currentPath = ""

    var isShowingAuthPage: Bool { ShellTab.isAuthPath(currentPath) }

    nonisolated private static let appearanceModeKey = "CPUWebAppearanceMode"

    var appearanceModeLabel: String {
        switch appearanceMode {
        case "dark": return "深色"
        case "light": return "浅色"
        default: return "跟随系统"
        }
    }

    var appearanceIconName: String {
        switch appearanceMode {
        case "dark": return "moon"
        case "light": return "sun.max"
        default: return "circle.lefthalf.filled"
        }
    }

    nonisolated static func storedAppearanceScheme() -> ColorScheme? {
        switch UserDefaults.standard.string(forKey: appearanceModeKey) {
        case "dark": return .dark
        case "light": return .light
        default: return nil
        }
    }

    let widgetSettings = NativeWidgetSettings()
    /// Shared across sheet presentations so a dismissed AI surface keeps its
    /// conversation and any in-flight stream alive.
    let assistantModel = NativeAssistantModel()

    var onSchedulePrefetched: ((NativeScheduleSnapshot) -> Void)?
    var onNavigate: ((String, String) -> Void)?
    var onRoute: ((String, String) -> Void)?
    /// Native shell entry point for the assistant. The Web router calls this
    /// when an iOS shell link targets /search, so every native entry uses the
    /// same keyboard-safe SwiftUI surface.
    var onAssistantRequested: (() -> Void)?
    /// Legacy account-only observer retained for older test/integration hosts.
    var onAuthChanged: ((String) -> Void)?
    var onAuthStateChanged: ((NativeAuthState) -> Void)?
    var onBridgeReady: (() -> Void)?
    var onFailure: ((String) -> Void)?

    private var webView: WKWebView?
    private var coordinator: HybridWebViewCoordinator?
    private weak var mountedHost: UIView?
    private var activeTab: ShellTab = .schedule
    private var automaticWidgetSetupAttempted = false
    private var widgetConfigurationInFlight = false
    private var widgetAuthGeneration = 0
    private var navigationGeneration = 0
    private var navigationTask: Task<Void, Never>?
    private(set) var bridgeReady = false
    private var observations: [NSKeyValueObservation] = []
    private var refreshControl: UIRefreshControl?
    private var refreshController: WebViewRefreshController?
    private var refreshTimeoutTask: Task<Void, Never>?
    private var isPullRefreshing = false
    private var assistantStreamContinuations: [String: CheckedContinuation<NativeAssistantReply, Error>] = [:]
    private var assistantStreamDeltaHandlers: [String: (String) -> Void] = [:]
    private var assistantStreamStatusHandlers: [String: (String) -> Void] = [:]
    private let pathMonitor = NWPathMonitor()
    private let pathMonitorQueue = DispatchQueue(label: "cn.cputime.ios.network-monitor")

    override init() {
        super.init()
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let unavailable = path.status != .satisfied
            Task { @MainActor [weak self] in
                self?.isNetworkUnavailable = unavailable
            }
        }
        pathMonitor.start(queue: pathMonitorQueue)
    }

    deinit {
        pathMonitor.cancel()
    }

    func makeWebView() -> WKWebView {
        if let webView { return webView }

        let contentController = WKUserContentController()
        contentController.addUserScript(
            WKUserScript(
                source: Self.bridgeScript(),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        if let url = Bundle.main.url(forResource: "NativeWebCompatibility", withExtension: "js"),
           let script = try? String(contentsOf: url, encoding: .utf8) {
            contentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController = contentController
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.applicationNameForUserAgent = "CPUWebIOSApp/1 CPUTimeNative/1"

        let webView = ImmersiveWebView(frame: .zero, configuration: configuration)
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor.systemBackground
        webView.scrollView.backgroundColor = UIColor.systemBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.scrollIndicatorInsets = .zero
        webView.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        webView.scrollView.bounces = true
        webView.scrollView.alwaysBounceVertical = true
        let refreshController = WebViewRefreshController(store: self)
        let refreshControl = UIRefreshControl()
        refreshControl.tintColor = UIColor(red: 15 / 255, green: 143 / 255, blue: 127 / 255, alpha: 1)
        refreshControl.addTarget(refreshController, action: #selector(WebViewRefreshController.didPull(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl
        self.refreshController = refreshController
        self.refreshControl = refreshControl
#if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
#endif

        let coordinator = HybridWebViewCoordinator(store: self)
        self.coordinator = coordinator
        contentController.add(self, name: Self.handlerName)
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        self.webView = webView
        observations = [
            webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] view, _ in
                guard let store = self else { return }
                let canGoBack = view.canGoBack
                Task { @MainActor in store.canGoBack = canGoBack }
            },
            webView.observe(\.isLoading, options: [.initial, .new]) { [weak self] view, _ in
                guard let store = self else { return }
                let isLoading = view.isLoading
                Task { @MainActor in store.isLoading = isLoading }
            },
        ]
        webView.load(URLRequest(url: IOSNextWebConfiguration.appURLFor(tab: .home)))
        return webView
    }

    func activate(tab: ShellTab) {
        guard activeTab != tab else { return }
        navigationGeneration += 1
        navigationTask?.cancel()
        activeTab = tab
    }

    /// A session cookie is the only pre-flight signal the shell has before the
    /// Web app boots. Its presence means "probably signed in": the gate stays
    /// down and the live `authChanged` report is the final word.
    func hasSessionCookie() async -> Bool {
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        return cookies.contains {
            ($0.name == "__Host-cpu-session" || $0.name == "cpu-session") && !$0.value.isEmpty
        }
    }

    /// Wait for the Web auth store to finish its initial cookie probe. A
    /// cookie-only decision is unsafe because an expired cookie can still be
    /// present, while a missing cookie can be repopulated by a cold WebKit
    /// restore. This bounded wait keeps the launch surface stable and avoids
    /// presenting the native login layer for a transient JWXT change.
    func waitForAuthState(timeout: Duration = .seconds(6)) async -> NativeAuthState? {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while clock.now < deadline {
            if authState.ready { return authState }
            try? await Task.sleep(for: .milliseconds(80))
            if Task.isCancelled { return nil }
        }
        return authState.ready ? authState : nil
    }

    /// The login gate is a one-way door: the page must not be swiped away.
    func setBackForwardNavigationGesturesEnabled(_ enabled: Bool) {
        makeWebView().allowsBackForwardNavigationGestures = enabled
    }

    func mount(tab: ShellTab, in host: UIView) {
        guard tab != .schedule, tab == activeTab else { return }
        let webView = makeWebView()
        if mountedHost !== host {
            webView.removeFromSuperview()
            mountedHost = host
            webView.translatesAutoresizingMaskIntoConstraints = false
            host.addSubview(webView)
            NSLayoutConstraint.activate([
                webView.topAnchor.constraint(equalTo: host.topAnchor),
                webView.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                webView.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            ])
        }
    }

    func unmount(from host: UIView) {
        guard mountedHost === host else { return }
        webView?.removeFromSuperview()
        mountedHost = nil
    }

    func navigate(path: String) {
        guard let url = IOSNextWebConfiguration.routeURL(path) else { return }
        navigationGeneration += 1
        let generation = navigationGeneration
        navigationTask?.cancel()
        navigationTask = Task { @MainActor [weak self] in
            // Commit the native selection before touching the WebView. Rapid
            // scrubbing across tabs coalesces to the latest destination.
            await Task.yield()
            guard let self, !Task.isCancelled, generation == self.navigationGeneration else { return }
            let webView = self.makeWebView()
            if self.bridgeReady {
                let script = """
                const bridge = window.CPUTimeNative;
                if (!bridge || typeof bridge.openWebRoute !== 'function') return false;
                const root = document.documentElement;
                const switchToken = String(Date.now()) + ':' + Math.random();
                bridge.nativeNavigationDepth = (bridge.nativeNavigationDepth || 0) + 1;
                // A native tab tap is a tab change, not an in-page forward
                // navigation. Mark it so the page swaps tabs without the
                // crossfade, then release the marker once that transition
                // would have finished.
                bridge.cpuTabSwitchToken = switchToken;
                root.dataset.cpuIosTabSwitch = '1';
                try { await bridge.openWebRoute(path); return true; }
                finally {
                  bridge.nativeNavigationDepth -= 1;
                  setTimeout(() => {
                    if (bridge.cpuTabSwitchToken === switchToken) delete root.dataset.cpuIosTabSwitch;
                  }, 400);
                }
                """
                let value = try? await webView.callAsyncJavaScript(script, arguments: ["path": path], in: nil, contentWorld: .page)
                guard !Task.isCancelled, generation == self.navigationGeneration else { return }
                if (value as? Bool) == true { return }
            }
            guard !Task.isCancelled, generation == self.navigationGeneration else { return }
            if webView.url?.absoluteString != url.absoluteString { webView.load(URLRequest(url: url)) }
        }
    }

    func ensureScheduleWidgetConfigured() async {
        guard !widgetSettings.isConfigured, !automaticWidgetSetupAttempted, bridgeReady else { return }
        automaticWidgetSetupAttempted = true
        let theme = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?.string(forKey: NextWidgetConfiguration.widgetThemeKey) ?? "color-glass"
        do { try await configureScheduleWidget(theme: theme) }
        catch { widgetSettings.status = error.localizedDescription }
    }

    func configureScheduleWidget(theme: String) async throws {
        guard !widgetConfigurationInFlight else { return }
        widgetConfigurationInFlight = true
        defer { widgetConfigurationInFlight = false }
        let view = makeWebView()
        guard let url = view.url, IOSNextWebConfiguration.isTrusted(url), bridgeReady else {
            throw NativeScheduleStoreError.bridgeUnavailable
        }
        let generation = widgetAuthGeneration
        let script = """
        const cookie = (name) => {
          const part = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
          return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
        };
        const response = await fetch('/api/jwxt/schedule-widget-tokens', {
          method: 'POST', credentials: 'same-origin',
          headers: {'Content-Type': 'application/json', 'X-CPU-Auth-Mode': 'cookie',
            'X-CPU-Client': 'ios-app', 'X-CSRF-Token': cookie('__Host-cpu-csrf') || cookie('cpu-csrf')},
          body: JSON.stringify({name: 'iOS Next 小组件'})
        });
        const body = await response.json();
        if (!response.ok || body.code !== 0) throw new Error(body.message || '配置失败，请先完成教务授权');
        return JSON.stringify({endpoint: body.data.endpoint, theme});
        """
        let payload = try await view.callAsyncJavaScript(script, arguments: ["theme": theme], in: nil, contentWorld: .page)
        guard generation == widgetAuthGeneration else { throw NativeScheduleStoreError.unauthorized("账号已变化，请重新配置小组件") }
        guard let payload = payload as? String else { throw NativeScheduleStoreError.invalidResponse }
        guard widgetSettings.installScheduleWidget(payload: payload) else {
            throw NativeScheduleStoreError.server(widgetSettings.status ?? "无法保存小组件配置")
        }
    }

#if DEBUG
    func debugDump(_ label: String) async {
        guard let webView else { return }
        let script = #"""
        const root = document.querySelector('.layout-root');
        const main = document.querySelector('.layout-root > .main');
        const page = main?.firstElementChild;
        const cs = (el) => el ? getComputedStyle(el) : null;
        const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
        return JSON.stringify({
          url: location.pathname,
          origin: location.origin,
          readyState: document.readyState,
          userAgent: navigator.userAgent,
          nativeBridge: typeof window.CPUTimeNative,
          nativeLoginBegin: typeof window.CPUTimeNative?.nativeLoginBegin,
          nativeSsoLogin: typeof window.CPUTimeNative?.nativeSsoLogin,
          nativeAuthFallback: Boolean(window.CPUTimeNative?.__cpuNativeAuthFallback),
          nativeBridgeError: window.__cpuNativeBridgeError || null,
          nativeIosMarker: document.documentElement?.dataset?.cpuIosNext || null,
          inner: [innerWidth, innerHeight],
          vv: [Math.round(visualViewport.width), Math.round(visualViewport.height)],
          docScroll: [document.scrollingElement.scrollTop, document.scrollingElement.scrollHeight],
          rootStyle: root ? root.getAttribute('style') : null,
          rootClass: root ? root.className : null,
          rootBox: box(root),
          rootMinH: cs(root) ? cs(root).minHeight : null,
          mainBox: box(main),
          mainPad: cs(main) ? [cs(main).paddingTop, cs(main).paddingBottom, cs(main).paddingLeft] : null,
          pageClass: page ? page.className : null,
          pageBox: box(page),
          pagePad: cs(page) ? [cs(page).paddingTop, cs(page).paddingBottom] : null,
          statusEl: (document.querySelector('[data-cpu-ios-status-content]') || {}).className || null,
          statusBox: box(document.querySelector('[data-cpu-ios-status-content]')),
          pageChildren: page ? [...page.children].map(e => e.tagName + '.' + e.className + ' ' + JSON.stringify(box(e))) : null
        });
        """#
        let value = try? await webView.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
        NSLog("CPUDEBUG[%@] %@", label, (value as? String) ?? "nil")
        NSLog("CPUDEBUG[%@] native bounds=%@ safeArea=%@ window=%@", label, NSCoder.string(for: webView.bounds), NSCoder.string(for: CGRect(x: webView.safeAreaInsets.left, y: webView.safeAreaInsets.top, width: webView.safeAreaInsets.right, height: webView.safeAreaInsets.bottom)), webView.window == nil ? "nil" : "set")
    }
#endif

    func goBack() { webView?.goBack() }

    func openWebMenu() {
        let script = "document.querySelector('.topbar .mobile-actions button[aria-label=\"更多\"]')?.click(); true;"
        webView?.evaluateJavaScript(script)
    }

    /// Ask the live Web stores for the latest account capability immediately
    /// before presenting the native quick menu. This matters after a cookie
    /// restore, when the menu can otherwise be opened before authChanged has
    /// reached SwiftUI.
    @discardableResult
    func refreshAuthCapability() async -> NativeAuthState? {
        let script = """
        return await (async () => {
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const refresh = window.CPUTimeNative?.refreshAuth;
            if (typeof refresh === 'function') {
              await refresh();
              return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          return false;
        })();
        """
        guard let webView else { return nil }
        let result = try? await webView.callAsyncJavaScript(
            script,
            arguments: [:],
            in: nil,
            contentWorld: .page
        )
        // The postMessage report is still sent by the Web bridge. Applying the
        // returned value here closes the race where the sheet is presented
        // before that message reaches SwiftUI.
        guard let payload = result as? [String: Any] else { return nil }
        let account = payload["account"] as? String ?? ""
        let state = NativeAuthState(
            account: account,
            authenticated: payload["authenticated"] as? Bool
                ?? !account.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            ready: payload["ready"] as? Bool ?? true,
            canAccessAdmin: payload["canAccessAdmin"] as? Bool ?? false
        )
        authState = state
        isLoggedIn = state.authenticated
        canAccessAdmin = state.canAccessAdmin
        return state
    }

    func setAppearanceMode(_ mode: String) {
        guard ["system", "light", "dark"].contains(mode) else { return }
        appearanceMode = mode
        UserDefaults.standard.set(mode, forKey: Self.appearanceModeKey)
        pageColorScheme = mode == "system" ? nil : (mode == "dark" ? .dark : .light)
        let modeLiteral = IOSNextWebConfiguration.javascriptString(mode)
        let script = """
        (() => {
          const mode = \(modeLiteral);
          // Keep Vue's reactive store in sync with the native shell. The DOM
          // fallback below is still needed while an older web bundle boots.
          try { window.__cpuSetAppearanceMode?.(mode); } catch (_) {}
          try { localStorage.setItem('cpu-appearance-mode-v1', mode); } catch (_) {}
          const prefersDark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
          const root = document.documentElement;
          root.dataset.appearanceMode = mode;
          root.dataset.theme = prefersDark ? 'dark' : 'light';
          root.classList.toggle('dark', prefersDark);
          root.style.colorScheme = prefersDark ? 'dark' : 'light';
          return true;
        })();
        """
        webView?.evaluateJavaScript(script)
    }

    func cycleAppearanceMode() {
        let next: String
        switch appearanceMode {
        case "system": next = "dark"
        case "dark": next = "light"
        default: next = "system"
        }
        setAppearanceMode(next)
    }

    /// The native assistant uses the authenticated WKWebView cookie jar and
    /// the same server endpoint as Web. Keeping the request in the page's
    /// origin avoids duplicating token and CSRF handling in Swift.
    func nativeAssistant(message: String, history: [[String: String]]) async throws -> NativeAssistantReply {
        guard let webView else { throw NativeAssistantError.unavailable }
        let script = """
        return await (async () => {
          const csrfCookie = document.cookie.match(/(?:^|;\\s*)(?:__Host-cpu-csrf|cpu-csrf)=([^;]+)/i);
          const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-CPU-Auth-Mode': 'cookie',
          };
          if (csrfCookie?.[1]) headers['X-CSRF-Token'] = decodeURIComponent(csrfCookie[1]);
          try {
            const response = await fetch('/api/search/assistant', {
              method: 'POST',
              credentials: 'include',
              headers,
              body: JSON.stringify({ message: String(message || ''), history }),
            });
            const raw = await response.text();
            let payload = null;
            try { payload = raw ? JSON.parse(raw) : null; } catch (_) {}
            const apiOk = response.ok && (!payload || typeof payload.code !== 'number' || payload.code === 0);
            return JSON.stringify({
              ok: apiOk,
              status: response.status,
              message: payload?.message || '',
              payload: payload?.code === 0 && payload?.data ? payload.data : payload,
            });
          } catch (_) {
            return JSON.stringify({ ok: false, status: 0, message: '请检查网络连接后重试。' });
          }
        })();
        """
        let result = try await webView.callAsyncJavaScript(
            script,
            arguments: ["message": message, "history": history],
            in: nil,
            contentWorld: .page
        )
        guard let raw = result as? String,
              let data = raw.data(using: .utf8) else { throw NativeAssistantError.invalidResponse }
        struct Envelope: Decodable {
            let ok: Bool
            let status: Int
            let message: String?
            let payload: NativeAssistantReply?
        }
        let envelope: Envelope
        do {
            envelope = try JSONDecoder().decode(Envelope.self, from: data)
        } catch {
            throw NativeAssistantError.invalidResponse
        }
        guard envelope.ok, let payload = envelope.payload else {
            if envelope.status == 0 { throw NativeAssistantError.requestFailed(envelope.message ?? "请检查网络连接后重试。") }
            throw NativeAssistantError.requestFailed(envelope.message ?? "拾间 AI 暂时不可用，请重试。")
        }
        return payload
    }

    /// Starts the Web SSE endpoint and forwards each event through the native
    /// script-message bridge. The request itself remains inside WKWebView so
    /// HttpOnly session and CSRF cookies are handled exactly like the Web app.
    func nativeAssistantStream(
        message: String,
        history: [[String: String]],
        onDelta: @escaping (String) -> Void,
        onStatus: @escaping (String) -> Void
    ) async throws -> NativeAssistantReply {
        guard let webView else { throw NativeAssistantError.unavailable }
        let requestID = UUID().uuidString
        let historyData = try JSONSerialization.data(withJSONObject: history, options: [])
        let historyJSON = String(data: historyData, encoding: .utf8) ?? "[]"
        let requestJSON = IOSNextWebConfiguration.javascriptString(requestID)
        let messageJSON = IOSNextWebConfiguration.javascriptString(message)

        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<NativeAssistantReply, Error>) in
                assistantStreamContinuations[requestID] = continuation
                assistantStreamDeltaHandlers[requestID] = onDelta
                assistantStreamStatusHandlers[requestID] = onStatus
                let script = """
                (() => {
                  const bridge = window.CPUTimeNative;
                  if (!bridge || typeof bridge.nativeAssistantStream !== 'function') {
                    try { window.webkit.messageHandlers.\(Self.handlerName).postMessage({type:'assistantStream', requestId:\(requestJSON), event:'error', payload:{message:'拾间 AI 尚未准备好，请稍后重试。'}}); } catch (_) {}
                    return true;
                  }
                  try {
                    void bridge.nativeAssistantStream(\(requestJSON), \(messageJSON), \(historyJSON));
                  } catch (_) {
                    try { window.webkit.messageHandlers.\(Self.handlerName).postMessage({type:'assistantStream', requestId:\(requestJSON), event:'error', payload:{message:'拾间 AI 暂时不可用，请重试。'}}); } catch (_) {}
                  }
                  return true;
                })()
                """
                webView.evaluateJavaScript(script) { [weak self] _, error in
                    guard let error else { return }
                    Task { @MainActor [weak self] in
                        self?.finishAssistantStream(requestID, error: NativeAssistantError.requestFailed(error.localizedDescription))
                    }
                }
            }
        }, onCancel: { [weak self] in
            Task { @MainActor [weak self] in
                self?.cancelAssistantStream(requestID)
            }
        })
    }

    func listNativeAssistantConversations() async throws -> [NativeAssistantConversation] {
        let data = try await nativeAssistantAPIRequest(
            path: "/api/search/assistant/conversations",
            method: "GET",
            body: nil
        )
        return try JSONDecoder().decode([NativeAssistantConversation].self, from: data)
    }

    @discardableResult
    func saveNativeAssistantConversation(_ conversation: NativeAssistantConversation) async throws -> NativeAssistantConversation {
        let body = try JSONEncoder().encode([
            "title": conversation.title,
            "updatedAt": String(conversation.updatedAt),
        ])
        var object = (try JSONSerialization.jsonObject(with: body) as? [String: Any]) ?? [:]
        object["updatedAt"] = conversation.updatedAt
        object["messages"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(conversation.messages))
        let payload = try await nativeAssistantAPIRequest(
            path: "/api/search/assistant/conversations/\(conversation.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? conversation.id)",
            method: "PATCH",
            body: object
        )
        return try JSONDecoder().decode(NativeAssistantConversation.self, from: payload)
    }

    func deleteNativeAssistantConversation(id: String) async throws {
        _ = try await nativeAssistantAPIRequest(
            path: "/api/search/assistant/conversations/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)",
            method: "DELETE",
            body: nil
        )
    }

    func cancelNativeAssistantStreams() {
        let requestIDs = Array(assistantStreamContinuations.keys)
        for requestID in requestIDs {
            cancelAssistantStream(requestID)
        }
    }

    private func nativeAssistantAPIRequest(path: String, method: String, body: [String: Any]?) async throws -> Data {
        guard let webView else { throw NativeAssistantError.unavailable }
        let bodyJSON: String
        if let body, JSONSerialization.isValidJSONObject(body),
           let encoded = try? JSONSerialization.data(withJSONObject: body),
           let string = String(data: encoded, encoding: .utf8) {
            bodyJSON = string
        } else {
            bodyJSON = ""
        }
        let script = """
        return await (async () => {
          const csrfCookie = document.cookie.match(/(?:^|;\\s*)(?:__Host-cpu-csrf|cpu-csrf)=([^;]+)/i);
          const headers = {'Accept': 'application/json', 'X-CPU-Auth-Mode': 'cookie'};
          if (\(methodJSONHeader(method))) headers['Content-Type'] = 'application/json';
          if (csrfCookie?.[1]) headers['X-CSRF-Token'] = decodeURIComponent(csrfCookie[1]);
          try {
            const response = await fetch(\(IOSNextWebConfiguration.javascriptString(path)), {
              method: \(IOSNextWebConfiguration.javascriptString(method)),
              credentials: 'include',
              headers,
              body: \(method == "GET" ? "undefined" : IOSNextWebConfiguration.javascriptString(bodyJSON)),
            });
            const raw = await response.text();
            let payload = null;
            try { payload = raw ? JSON.parse(raw) : null; } catch (_) {}
            const apiOk = response.ok && (!payload || typeof payload.code !== 'number' || payload.code === 0);
            return JSON.stringify({
              ok: apiOk,
              status: response.status,
              message: payload?.message || '',
              payload: payload?.code === 0 && payload?.data !== undefined ? payload.data : payload,
            });
          } catch (_) {
            return JSON.stringify({ok: false, status: 0, message: '请检查网络连接后重试。'});
          }
        })();
        """
        let result = try await webView.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
        guard let raw = result as? String, let data = raw.data(using: .utf8),
              let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              envelope["ok"] as? Bool == true else {
            if let data = (result as? String)?.data(using: .utf8),
               let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = envelope["message"] as? String, !message.isEmpty {
                throw NativeAssistantError.requestFailed(message)
            }
            throw NativeAssistantError.requestFailed("拾间 AI 历史记录暂时不可用，请重试。")
        }
        guard let payload = envelope["payload"], JSONSerialization.isValidJSONObject(payload) else {
            throw NativeAssistantError.invalidResponse
        }
        return try JSONSerialization.data(withJSONObject: payload)
    }

    private func methodJSONHeader(_ method: String) -> String {
        method == "GET" ? "false" : "true"
    }

    private func cancelAssistantStream(_ requestID: String) {
        guard assistantStreamContinuations[requestID] != nil else { return }
        webView?.evaluateJavaScript("window.CPUTimeNative?.cancelAssistantStream && window.CPUTimeNative.cancelAssistantStream(\(IOSNextWebConfiguration.javascriptString(requestID))); true;")
        finishAssistantStream(requestID, error: CancellationError())
    }

    private func finishAssistantStream(_ requestID: String, error: Error) {
        guard let continuation = assistantStreamContinuations.removeValue(forKey: requestID) else { return }
        assistantStreamDeltaHandlers.removeValue(forKey: requestID)
        assistantStreamStatusHandlers.removeValue(forKey: requestID)
        continuation.resume(throwing: error)
    }

    private func finishAssistantStream(_ requestID: String, reply: NativeAssistantReply) {
        guard let continuation = assistantStreamContinuations.removeValue(forKey: requestID) else { return }
        assistantStreamDeltaHandlers.removeValue(forKey: requestID)
        assistantStreamStatusHandlers.removeValue(forKey: requestID)
        continuation.resume(returning: reply)
    }

    func retry() {
        errorMessage = nil
        serviceUnavailableMessage = nil
        finishPullRefresh()
        reloadCurrentPage()
    }

    /// Ask the already booted Web app to create the same SSO challenge used by
    /// the browser login page. The native UI never handles school cookies or
    /// credentials itself; those stay inside the Web auth store and WKWebView.
    func nativeLoginBegin() async -> NativeLoginResponse {
        await nativeLoginCall("""
        return await (async () => {
          const bridge = window.CPUTimeNative;
          if (!bridge || typeof bridge.nativeLoginBegin !== 'function') {
            return JSON.stringify({ok: false, error: '登录服务正在启动，请稍候再试。'});
          }
          try { return JSON.stringify(await bridge.nativeLoginBegin()); }
          catch (_) { return JSON.stringify({ok: false, error: '统一认证暂时不可用，请稍后再试。'}); }
        })();
        """, arguments: [:])
    }

    /// Submit school SSO credentials through the Web store so the response's
    /// HttpOnly session cookie and the native auth gate stay in sync.
    func nativeSsoLogin(username: String, password: String, captcha: String, remember: Bool) async -> NativeLoginResponse {
        await nativeLoginCall("""
        return await (async () => {
          const bridge = window.CPUTimeNative;
          if (!bridge || typeof bridge.nativeSsoLogin !== 'function') {
            return JSON.stringify({ok: false, error: '登录服务正在启动，请稍候再试。'});
          }
          try {
            return JSON.stringify(await bridge.nativeSsoLogin(username, password, captcha, remember));
          } catch (_) {
            return JSON.stringify({ok: false, error: '登录暂时失败，请稍后再试。'});
          }
        })();
        """, arguments: [
            "username": username,
            "password": password,
            "captcha": captcha,
            "remember": remember,
        ])
    }

    /// The fallback account form is also routed through the Web auth store so
    /// its token/cookie handling remains identical to the regular site login.
    func nativeAccountLogin(username: String, password: String) async -> NativeLoginResponse {
        await nativeLoginCall("""
        return await (async () => {
          const bridge = window.CPUTimeNative;
          if (!bridge || typeof bridge.nativeAccountLogin !== 'function') {
            return JSON.stringify({ok: false, error: '登录服务正在启动，请稍候再试。'});
          }
          try {
            return JSON.stringify(await bridge.nativeAccountLogin(username, password));
          } catch (_) {
            return JSON.stringify({ok: false, error: '登录暂时失败，请稍后再试。'});
          }
        })();
        """, arguments: ["username": username, "password": password])
    }

    private func nativeLoginCall(
        _ script: String,
        arguments: [String: Any]
    ) async -> NativeLoginResponse {
        let view = makeWebView()
        // `ready` is emitted by the injected native chrome before Vue has
        // mounted the Pinia auth store. Wait for the actual login method so a
        // cold launch does not turn that short race into “服务不可用”.
        var lastError: Error?
        for attempt in 0..<80 {
            do {
                // Execute the call itself instead of probing through a second
                // JavaScript invocation. On iOS 26 a page-route transition can
                // make a variable-based `callAsyncJavaScript` probe report a
                // false negative even while the bridge methods are callable.
                let value = try await view.callAsyncJavaScript(
                    script,
                    arguments: arguments,
                    in: nil,
                    contentWorld: .page
                )
                let response = Self.decodeNativeLoginResponse(value)
                if response.error != "登录服务正在启动，请稍候再试。" {
                    // A route transition can reset the navigation flag after
                    // the injected bridge has already survived in the page.
                    bridgeReady = true
                    return response
                }
            } catch {
                lastError = error
            }
            if attempt < 79 {
                try? await Task.sleep(for: .milliseconds(125))
            }
        }

        let message: String
        if isNetworkUnavailable {
            message = "当前没有网络连接，请检查 Wi‑Fi 或切换蜂窝网络后重试。"
        } else if let serviceUnavailableMessage, !serviceUnavailableMessage.isEmpty {
            message = serviceUnavailableMessage
        } else if lastError != nil {
            message = "登录服务暂时未准备好，请稍后重试。"
        } else {
            message = "登录服务启动超时，请稍后重试。"
        }
        return NativeLoginResponse(
            ok: false,
            needCaptcha: false,
            captchaImage: "",
            error: message,
            account: "",
            canAccessAdmin: false
        )
    }

    private static func decodeNativeLoginResponse(_ value: Any?) -> NativeLoginResponse {
        var payload: [String: Any] = [:]
        if let dictionary = value as? [String: Any] {
            payload = dictionary
        } else if let json = value as? String,
                  let data = json.data(using: .utf8),
                  let dictionary = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            payload = dictionary
        }
        return NativeLoginResponse(
            ok: payload["ok"] as? Bool ?? false,
            needCaptcha: payload["needCaptcha"] as? Bool ?? false,
            captchaImage: payload["captchaImage"] as? String ?? "",
            error: payload["error"] as? String ?? "登录暂时失败，请稍后再试。",
            account: payload["account"] as? String ?? "",
            canAccessAdmin: payload["canAccessAdmin"] as? Bool ?? false
        )
    }

    private func reloadCurrentPage() {
        let view = makeWebView()
        if view.url == nil {
            view.load(URLRequest(url: IOSNextWebConfiguration.appURLFor(tab: activeTab)))
        } else {
            view.reload()
        }
    }

    fileprivate func handlePullToRefresh(_ sender: UIRefreshControl) {
        guard !isPullRefreshing else { return }
        isPullRefreshing = true
        errorMessage = nil
        let script = """
        (() => {
          window.__cpuNativeRefreshHandled = false;
          try { window.dispatchEvent(new Event('cpu-native-refresh')); } catch (_) {}
          return Boolean(window.__cpuNativeRefreshHandled);
        })()
        """
        let view = makeWebView()
        view.evaluateJavaScript(script) { [weak self] value, _ in
            Task { @MainActor in
                guard let self, self.isPullRefreshing else { return }
                if (value as? Bool) == true {
                    // Route-specific handlers finish through refreshFinished;
                    // the timeout keeps the control recoverable if an older
                    // deployed page does not send the completion message.
                    self.refreshTimeoutTask?.cancel()
                    self.refreshTimeoutTask = Task { @MainActor [weak self] in
                        try? await Task.sleep(for: .seconds(15))
                        guard let self, !Task.isCancelled else { return }
                        self.finishPullRefresh()
                    }
                } else {
                    self.reloadCurrentPage()
                }
            }
        }
        _ = sender
    }

    private func finishPullRefresh() {
        refreshTimeoutTask?.cancel()
        refreshTimeoutTask = nil
        guard isPullRefreshing || refreshControl?.isRefreshing == true else { return }
        isPullRefreshing = false
        refreshControl?.endRefreshing()
    }

    fileprivate func didStart() {
        bridgeReady = false
        errorMessage = nil
        serviceUnavailableMessage = nil
    }

    fileprivate func didFail(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        isLoading = false
        // A failed reload does not mean the already-rendered page disappeared.
        // Keep the existing Web content usable and let its own request-level
        // states describe any API problem instead of covering it with a gate.
        if webView?.url != nil, currentPath.isEmpty == false { return }
        errorMessage = "页面暂时无法打开，请检查网络后重试。"
        serviceUnavailableMessage = "服务暂时不可用，请检查网络连接或稍后重试。"
        onFailure?(errorMessage!)
    }

    /// A gateway failure can arrive as a successful WebKit navigation with an
    /// HTML 5xx body. Treat it as an unavailable service before that body can
    /// look like a blank or broken application page.
    fileprivate func didReceiveHTTPStatus(_ status: Int) {
        guard status >= 500 else { return }
        isLoading = false
        let message = "服务暂时不可用，请检查网络连接或切换流量后重试。"
        serviceUnavailableMessage = message
        errorMessage = message
        onFailure?(message)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let frameURL = message.frameInfo.request.url, IOSNextWebConfiguration.isTrusted(frameURL),
              let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        let source = activeTab.rawValue

        switch type {
        case "schedulePrefetched":
            guard let value = body["snapshot"], JSONSerialization.isValidJSONObject(value),
                  let data = try? JSONSerialization.data(withJSONObject: value),
                  let snapshot = try? JSONDecoder().decode(NativeScheduleSnapshot.self, from: data) else { return }
            onSchedulePrefetched?(snapshot)
        case "installScheduleWidget":
            widgetSettings.installScheduleWidget(payload: body["payload"] as? String)
        case "setScheduleWidgetTheme":
            widgetSettings.setScheduleWidgetTheme(body["theme"] as? String)
        case "appearance":
            guard let dark = body["dark"] as? Bool else { return }
            let mode = (body["mode"] as? String) ?? "system"
            appearanceMode = mode
            UserDefaults.standard.set(mode, forKey: Self.appearanceModeKey)
            let scheme: ColorScheme? = mode == "system" ? nil : (dark ? .dark : .light)
            if pageColorScheme != scheme { pageColorScheme = scheme }
        case "ready":
            bridgeReady = true
            onBridgeReady?()
        case "navigate":
            guard let path = body["path"] as? String else { return }
            onNavigate?(path, source)
        case "assistant":
            onAssistantRequested?()
        case "assistantStream":
            handleAssistantStreamMessage(body)
        case "route":
            guard let path = body["path"] as? String else { return }
            currentPath = path
            // Older deployed Web bundles do not have the iOS route guard yet
            // and will finish navigating to /search instead of calling
            // `CPUTimeNative.openAssistant`. Keep the native experience
            // stable across that rollout boundary by treating the route report
            // itself as the fallback handoff point. Restore the underlying Web
            // tab immediately so dismissing the native screen never reveals a
            // second assistant page.
            if Self.isAssistantPath(path) {
                onAssistantRequested?()
                if activeTab != .schedule {
                    navigate(path: activeTab.defaultPath)
                }
                return
            }
            onRoute?(path, source)
        case "authChanged":
            automaticWidgetSetupAttempted = false
            widgetAuthGeneration += 1
            let auth = Self.nativeAuthState(from: body)
            authState = auth
            isLoggedIn = auth.authenticated
            canAccessAdmin = auth.canAccessAdmin
            onAuthStateChanged?(auth)
            // Only forward confirmed states to the compatibility observer. An
            // empty account during cookie restoration is deliberately omitted.
            if auth.ready || auth.authenticated {
                onAuthChanged?(auth.authenticated ? auth.account : "")
            }
        case "refreshFinished":
            finishPullRefresh()
        case "networkError":
            serviceUnavailableMessage = "服务暂时不可用，请检查网络连接或切换流量后重试。"
        default:
            break
        }
    }

    private func handleAssistantStreamMessage(_ body: [String: Any]) {
        guard let requestID = body["requestId"] as? String,
              let event = body["event"] as? String else { return }
        let payload = body["payload"] as? [String: Any] ?? [:]
        switch event {
        case "delta":
            if let delta = payload["delta"] as? String {
                assistantStreamDeltaHandlers[requestID]?(delta)
            }
        case "status", "heartbeat":
            let elapsed = (payload["elapsedMs"] as? NSNumber)?.intValue ?? 0
            let seconds = elapsed / 1000
            assistantStreamStatusHandlers[requestID]?(seconds >= 5 ? "仍在生成，已等待 \(seconds) 秒…" : "正在生成回答…")
        case "done":
            guard JSONSerialization.isValidJSONObject(payload),
                  let data = try? JSONSerialization.data(withJSONObject: payload),
                  let reply = try? JSONDecoder().decode(NativeAssistantReply.self, from: data) else {
                finishAssistantStream(requestID, error: NativeAssistantError.invalidResponse)
                return
            }
            finishAssistantStream(requestID, reply: reply)
        case "error":
            finishAssistantStream(
                requestID,
                error: NativeAssistantError.requestFailed((payload["message"] as? String) ?? "拾间 AI 暂时不可用，请重试。")
            )
        default:
            break
        }
    }

    fileprivate func didFinish(url: URL?) {
        // A successful main-frame commit supersedes an earlier gateway or
        // network report. API requests are handled by the Web page itself.
        errorMessage = nil
        serviceUnavailableMessage = nil
        guard let url, let path = Self.path(for: url) else { return }
        currentPath = path
        onRoute?(path, activeTab.rawValue)
    }

    fileprivate func openNativeRoute(_ path: String) {
        guard activeTab != .schedule else { return }
        onNavigate?(path, activeTab.rawValue)
    }

    fileprivate func openExternal(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(),
              ["http", "https", "mailto", "tel", "sms"].contains(scheme) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private static func path(for url: URL) -> String? {
        guard IOSNextWebConfiguration.isTrusted(url) else { return nil }
        var value = url.path.isEmpty ? "/" : url.path
        if let query = url.query, !query.isEmpty { value += "?\(query)" }
        if let fragment = url.fragment, !fragment.isEmpty { value += "#\(fragment)" }
        return value
    }

    private static func nativeAuthState(from body: [String: Any]) -> NativeAuthState {
        let account = (body["account"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let authenticated = body["authenticated"] as? Bool ?? !account.isEmpty
        let ready = body["ready"] as? Bool ?? true
        return NativeAuthState(
            account: account,
            authenticated: authenticated,
            ready: ready,
            canAccessAdmin: body["canAccessAdmin"] as? Bool ?? false
        )
    }

    private static func isAssistantPath(_ path: String) -> Bool {
        let pathname = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
            .first.map(String.init) ?? path
        return pathname == "/search"
    }

    private static func bridgeScript() -> String {
        let appURL = IOSNextWebConfiguration.appURL
        let port = appURL.port.map { ":\($0)" } ?? ""
        let origin = IOSNextWebConfiguration.javascriptString("\(appURL.scheme!)://\(appURL.host!)\(port)")
        return """
        (() => {
          if (location.origin !== \(origin)) return;
          if (!/CPUTimeNative\\//i.test(navigator.userAgent)) return;
          try {
            addEventListener('error', event => {
              window.__cpuNativeBridgeError = String(event?.error?.stack || event?.message || 'script error');
            });
            addEventListener('unhandledrejection', event => {
              window.__cpuNativeBridgeError = String(event?.reason?.stack || event?.reason || 'unhandled rejection');
            });
          } catch (_) {}
          // Apply before Vue mounts, including on older deployed Web clients.
          const style = document.createElement('style');
          style.textContent = `
            html[data-cpu-ios-next] { --cpu-ios-bottom-clearance: 96px; }
            /* The native shell supplies both bars. The Web top bar stays in the
               DOM so its drawer and account actions remain reusable. */
            html[data-cpu-ios-next] .layout-root > .topbar,
            html[data-cpu-ios-next] .layout-root > .mobile-tabbar { display: none !important; }
            html[data-cpu-ios-next] .independent-service-note { display: none !important; }
            html[data-cpu-ios-next] .layout-root {
              --layout-mobile-tabbar-reserve: 0px !important;
              --cpu-safe-area-inset-top: 0px !important;
              --cpu-ios-inline-inset: 20px;
            }
            /* Let WKWebView own the document scroll. This makes its native
               UIRefreshControl receive the same pull gesture as Safari and
               keeps the existing Web pages' window.scrollY contract intact. */
            html[data-cpu-ios-next],
            html[data-cpu-ios-next] body {
              height: auto !important;
              min-height: 100%;
              overflow-x: hidden !important;
              overflow-y: auto !important;
            }
            html[data-cpu-ios-next] #app {
              height: auto !important;
              min-height: 100%;
              max-height: none;
              overflow-x: hidden;
              overflow-y: visible !important;
            }
            @media (max-width: 768px) {
              html[data-cpu-ios-next] .layout-root { --cpu-ios-inline-inset: 12px; }
            }
            html[data-cpu-ios-next] .layout-root .main {
              /* The native top bar sits outside the WebView. Keep the Web
                 page's normal breathing room below it; only the status-bar
                 inset is consumed by SwiftUI. */
              padding-bottom: var(--cpu-ios-bottom-clearance) !important;
            }
            html[data-cpu-ios-next] .layout-root .main:not(.main--bare):not(.main--full-width):not(.main--mobile-topic) {
              padding-top: 14px !important;
            }
            html[data-cpu-ios-next] .layout-root .main.main--bare,
            html[data-cpu-ios-next] .layout-root .main.main--full-width,
            html[data-cpu-ios-next] .layout-root .main.main--mobile-topic {
              padding-top: 0 !important;
            }
            /* Older Web bundles hid the footer whenever they detected a
               native shell. If that node exists, the current shell owns only
               the native tab bar and should leave the Web footer reachable. */
            html[data-cpu-ios-next] .layout-root > .footer {
              display: block !important;
            }
            /* Web drawers and course editor dialogs must sit above the native
               floating tab bar and keep their last controls reachable. */
            html[data-cpu-ios-next] .mobile-drawer,
            html[data-cpu-ios-next] .el-drawer.direction-btt {
              bottom: var(--cpu-ios-bottom-clearance) !important;
              max-height: calc(92dvh - var(--cpu-ios-bottom-clearance)) !important;
              border-radius: 18px 18px 0 0;
            }
            html[data-cpu-ios-next] .mobile-drawer .el-drawer__body,
            html[data-cpu-ios-next] .el-drawer.direction-btt .el-drawer__body {
              padding-bottom: 16px !important;
              overflow-y: auto !important;
              overscroll-behavior: contain;
            }
            html[data-cpu-ios-next] .course-editor-overlay {
              padding-bottom: calc(8px + var(--cpu-ios-bottom-clearance)) !important;
            }
            html[data-cpu-ios-next] .course-editor-panel {
              max-height: calc(92dvh - var(--cpu-ios-bottom-clearance)) !important;
            }
            html[data-cpu-ios-next] .course-editor-scroll {
              padding-bottom: calc(12px + env(safe-area-inset-bottom) + var(--cpu-ios-bottom-clearance)) !important;
            }
            html[data-cpu-ios-next] .el-overlay {
              padding-bottom: var(--cpu-ios-bottom-clearance);
            }
            html[data-cpu-ios-next] .layout-root:not(.layout-root--full-width) > .main:not(.main--bare):not(.main--full-width):not(.main--mobile-topic) {
              padding-inline: var(--cpu-ios-inline-inset) !important;
            }
            /* A native tab tap is a tab change, not an in-page forward
               navigation: swapping instantly keeps the frozen outgoing page
               from showing through the incoming one. */
            html[data-cpu-ios-next] .page-route-enter-active,
            html[data-cpu-ios-next] .page-route-leave-active { transition: none !important; }
            html[data-cpu-ios-next][data-cpu-ios-tab-switch] .page-route-enter-active,
            html[data-cpu-ios-next][data-cpu-ios-tab-switch] .page-route-leave-active { transition: none !important; }
          `;
          const installChrome = () => {
            if (!document.documentElement) return;
            document.documentElement.dataset.cpuIosNext = '1';
            if (!style.isConnected) document.documentElement.appendChild(style);
          };
          installChrome();
          addEventListener('DOMContentLoaded', installChrome, {once: true});
          const post = (payload = {}) => {
            try {
              window.webkit.messageHandlers.cpuTimeNative.postMessage(payload);
              return true;
            } catch (_) {
              return false;
            }
          };
          // Do not promote individual API fetch/XHR failures to a full-screen
          // native outage. The Web app can still render cached content and its
          // own request state; only the WKNavigationDelegate handles a main
          // document failure.
          const bridge = window.CPUTimeNative || {};
          bridge.isNativeShell = true;
          bridge.platform = 'ios';
          bridge.version = '1';
          bridge.navigate = (path) => {
            if (bridge.nativeNavigationDepth > 0) return false;
            return post({ type: 'navigate', path: String(path ?? '') });
          };
          bridge.openAssistant = () => post({type: 'assistant'});
          // Native SwiftUI consumes the same SSE protocol as the Web assistant.
          // Each delta is posted immediately so the native bubble can render
          // the answer while the model is still generating it.
          bridge.__cpuAssistantStreamControllers = bridge.__cpuAssistantStreamControllers || new Map();
          bridge.cancelAssistantStream = (requestId) => {
            const controller = bridge.__cpuAssistantStreamControllers.get(String(requestId));
            if (controller) controller.abort();
          };
          bridge.nativeAssistantStream = async (requestId, message, history) => {
            const id = String(requestId || '');
            const emit = (event, payload) => post({type: 'assistantStream', requestId: id, event, payload});
            const controller = new AbortController();
            bridge.__cpuAssistantStreamControllers.set(id, controller);
            try {
              const csrfCookie = document.cookie.match(/(?:^|;\\s*)(?:__Host-cpu-csrf|cpu-csrf)=([^;]+)/i);
              const headers = {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'X-CPU-Auth-Mode': 'cookie',
                'X-CPU-Client': 'ios'
              };
              if (csrfCookie?.[1]) headers['X-CSRF-Token'] = decodeURIComponent(csrfCookie[1]);
              const response = await fetch('/api/search/assistant/stream', {
                method: 'POST',
                credentials: 'include',
                headers,
                body: JSON.stringify({message: String(message || ''), history: Array.isArray(history) ? history : []}),
                signal: controller.signal
              });
              if (!response.ok) {
                let errorMessage = `请求失败（${response.status}）`;
                try {
                  const payload = await response.json();
                  errorMessage = String(payload?.message || payload?.data?.message || errorMessage);
                } catch (_) {}
                emit('error', {message: errorMessage});
                return;
              }
              if (!response.body) {
                emit('error', {message: '拾间 AI 流式响应不可用，请重试。'});
                return;
              }
              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              let buffer = '';
              const consume = (block) => {
                if (!block.trim() || block.trimStart().startsWith(':')) return;
                let event = 'message';
                const dataLines = [];
                for (const line of block.split(/\\r?\\n/)) {
                  if (line.startsWith('event:')) event = line.slice(6).trim();
                  if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
                }
                if (!dataLines.length) return;
                let payload;
                try { payload = JSON.parse(dataLines.join('\\n')); }
                catch (_) { emit('error', {message: '拾间 AI 响应格式异常，请重试。'}); return; }
                emit(event, payload);
              };
              while (true) {
                const chunk = await reader.read();
                if (chunk.value) buffer += decoder.decode(chunk.value, {stream: !chunk.done});
                const blocks = buffer.split(/\\r?\\n\\r?\\n/);
                buffer = blocks.pop() || '';
                for (const block of blocks) consume(block);
                if (chunk.done) {
                  buffer += decoder.decode();
                  if (buffer.trim()) consume(buffer);
                  break;
                }
              }
            } catch (error) {
              if (error?.name !== 'AbortError') emit('error', {message: '请检查网络连接后重试。'});
            } finally {
              bridge.__cpuAssistantStreamControllers.delete(id);
            }
          };
          bridge.ready = () => post({ type: 'ready' });
          bridge.schedulePrefetched = (snapshot) => post({type: 'schedulePrefetched', snapshot});
          bridge.scheduleWeekPrefetched = bridge.schedulePrefetched;
          bridge.authChanged = (value, canAccessAdmin = false, ready = true, authenticated) => {
            const info = value && typeof value === 'object' ? value : {
              account: String(value ?? ''), canAccessAdmin, ready,
              authenticated: authenticated === undefined ? Boolean(value) : Boolean(authenticated)
            };
            const account = String(info.account ?? '');
            return post({
              type: 'authChanged', account,
              authenticated: info.authenticated === undefined ? Boolean(account) : Boolean(info.authenticated),
              ready: info.ready === undefined ? true : Boolean(info.ready),
              canAccessAdmin: Boolean(info.canAccessAdmin)
            });
          };
          bridge.refreshFinished = () => post({type: 'refreshFinished'});
          window.CPUTimeNative = bridge;
          // Keep native login usable while an older deployed Web bundle is
          // still being rolled out. Newer bundles replace these methods with
          // the Pinia implementation; this fallback uses the same cookie
          // endpoints and then reloads the shared page.
          if (!bridge.__cpuNativeAuthFallback) {
            bridge.__cpuNativeAuthFallback = true;
            const cookieValue = (name) => {
              const part = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
              if (!part) return '';
              try { return decodeURIComponent(part.slice(name.length + 1)); } catch (_) { return part.slice(name.length + 1); }
            };
            const authHeaders = () => {
              const headers = {
                'Content-Type': 'application/json',
                'X-CPU-Client': 'ios',
                'X-CPU-Auth-Mode': 'cookie'
              };
              const csrf = cookieValue('__Host-cpu-csrf') || cookieValue('cpu-csrf');
              if (csrf) headers['X-CSRF-Token'] = csrf;
              return headers;
            };
            const loginState = { pendingId: '', credentialPublicKey: '' };
            const postAuth = async (path, payload) => {
              let response;
              try {
                response = await fetch(path, {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: authHeaders(),
                  body: JSON.stringify(payload ?? {})
                });
              } catch (_) {
                return { ok: false, error: '网络连接失败，请检查网络后重试。' };
              }
              let envelope;
              try { envelope = await response.json(); }
              catch (_) { return { ok: false, error: '服务暂时不可用，请稍后重试。' }; }
              const data = envelope?.data ?? envelope;
              if (!response.ok || (typeof envelope?.code === 'number' && envelope.code !== 0)) {
                return {
                  ok: false,
                  error: String(data?.error || envelope?.message || '服务暂时不可用，请稍后重试。')
                };
              }
              return data;
            };
            const nativeResult = (data, fallback = '登录暂时失败，请稍后再试。') => {
              const user = data?.user;
              const canAccessAdmin = user?.role === 'admin'
                || user?.role === 'mod'
                || user?.voiceHubRole === 'super_admin'
                || Boolean(user?.lostFoundRole);
              return {
                ok: Boolean(data?.ok),
                error: String(data?.error || (data?.ok ? '' : fallback)),
                needCaptcha: Boolean(data?.needCaptcha),
                captchaImage: String(data?.captchaImage || data?.captcha?.image || ''),
                account: user?.id ? String(user.id) : '',
                canAccessAdmin
              };
            };
            const hydratePiniaSession = (data) => {
              const user = data?.user;
              if (!user?.id) return false;
              const authMarker = '__cpu_cookie_session__';
              let hydrated = false;
              try {
                const pinia = document.getElementById('app')?.__vue_app__?.config?.globalProperties?.$pinia;
                const auth = pinia?._s?.get('auth');
                if (auth && typeof auth.applyAuthenticatedSession === 'function') {
                  auth.applyAuthenticatedSession(authMarker, user);
                  hydrated = true;
                }
                const jwxt = pinia?._s?.get('jwxt');
                if (jwxt && data?.jwxtAuthenticated) {
                  const jwxtMarker = '__cpu_jwxt_cookie_session__';
                  try { sessionStorage.setItem('cpu-jwxt-token', jwxtMarker); } catch (_) {}
                  jwxt.token = jwxtMarker;
                  jwxt.active = true;
                  jwxt.authorizationExpired = false;
                }
              } catch (_) {}
              // Keep a reload/old-bundle fallback marker as well. It contains
              // no credential and lets auth.hydrate() discover the cookie.
              try {
                localStorage.setItem('cpu-authenticated', '1');
                localStorage.setItem('cpu-auth-cache-scope', 'user-' + String(user.id));
              } catch (_) {}
              return hydrated;
            };
            const announceAuthenticated = async (data) => {
              const user = data?.user;
              hydratePiniaSession(data);
              if (user?.id) bridge.authChanged(String(user.id), Boolean(
                user.role === 'admin'
                  || user.role === 'mod'
                  || user.voiceHubRole === 'super_admin'
                  || user.lostFoundRole
              ));
              // The fallback request bypasses the Pinia action that normally
              // hydrates the cookie session. Give WebKit time to persist the
              // Set-Cookie response before the next document probes auth. A
              // refreshAuth call here races that cookie write and can publish
              // a transient empty account, reopening the gate.
              setTimeout(() => {
                try { location.replace('/home'); } catch (_) {}
              }, 500);
            };
            bridge.nativeLoginBegin = bridge.nativeLoginBegin || (async () => {
              const data = await postAuth('/api/auth/sso-begin', {});
              if (!data?.pendingId) return nativeResult(data, '统一认证暂时不可用，请稍后再试。');
              loginState.pendingId = String(data.pendingId);
              loginState.credentialPublicKey = String(data.credentialPublicKey || '');
              return {
                ok: true,
                error: '',
                needCaptcha: Boolean(data.needCaptcha),
                captchaImage: String(data.captchaImage || ''),
                account: '',
                canAccessAdmin: false
              };
            });
            bridge.nativeSsoLogin = bridge.nativeSsoLogin || (async (username, password, captcha, remember) => {
              const data = await postAuth('/api/auth/sso-login', {
                pendingId: loginState.pendingId,
                username: String(username || ''),
                password: String(password || ''),
                captcha: String(captcha || '') || undefined,
                remember: Boolean(remember)
              });
              const result = nativeResult(data);
              if (result.ok) await announceAuthenticated(data);
              else if (data?.captcha?.pendingId) loginState.pendingId = String(data.captcha.pendingId);
              return result;
            });
            bridge.nativeAccountLogin = bridge.nativeAccountLogin || (async (username, password) => {
              const data = await postAuth('/api/auth/login', {
                username: String(username || ''),
                password: String(password || '')
              });
              const result = nativeResult({
                ...data,
                ok: Boolean(data?.ok ?? (data?.user && (data?.sessionAuthenticated || data?.token)))
              });
              if (result.ok) await announceAuthenticated(data);
              return result;
            });
          }
          window.CPUIOS = {
            ...(window.CPUIOS || {}),
            supportsScheduleWidget: () => true,
            installScheduleWidget: (payload) => post({type: 'installScheduleWidget', payload: String(payload ?? '')}),
            setScheduleWidgetTheme: (theme) => post({type: 'setScheduleWidgetTheme', theme: String(theme ?? '')})
          };

          const observePage = () => {
            if (!document.documentElement) return;
            const appearance = () => post({
              type: 'appearance', dark: document.documentElement.dataset.theme === 'dark',
              mode: document.documentElement.dataset.appearanceMode || 'system'
            });
            new MutationObserver(appearance).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'data-appearance-mode']});
            appearance();
          };
          if (document.readyState === 'loading') addEventListener('DOMContentLoaded', observePage, {once: true});
          else observePage();

          if (window.__cpuTimeNativeRouteBridge) return;
          window.__cpuTimeNativeRouteBridge = true;
          const routePath = () => `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
          const scrollTop = () => Math.max(0, Math.round(window.scrollY || document.scrollingElement?.scrollTop || 0));
          const writeScroll = (top) => {
            const value = Math.max(0, Number(top) || 0);
            document.scrollingElement?.scrollTo({ top: value, left: 0, behavior: 'auto' });
            window.scrollTo({ top: value, left: 0, behavior: 'auto' });
          };
          const entryKey = (path) => {
            const position = Number(history.state?.position);
            return Number.isFinite(position) ? `history:${position}` : `path:${path}`;
          };
          const positions = new Map();
          let lastPath = routePath();
          let lastKey = entryKey(lastPath);
          const saveScroll = () => {
            const value = scrollTop();
            positions.set(lastKey, value);
            positions.set(`path:${lastPath}`, value);
          };
          const settleScroll = (path, key, top) => {
            const saved = positions.has(key) ? positions.get(key) : positions.get(`path:${path}`);
            const target = Number.isFinite(saved) ? saved : top;
            const apply = () => {
              if (routePath() !== path) return;
              writeScroll(target);
            };
            requestAnimationFrame(() => requestAnimationFrame(apply));
            setTimeout(apply, 80);
          };
          const notifyRoute = (kind = 'forward') => {
            const path = routePath();
            const key = entryKey(path);
            post({ type: 'route', path });
            if (kind === 'history') settleScroll(path, key, 0);
            else if (path !== lastPath) settleScroll(path, key, 0);
            lastPath = path;
            lastKey = key;
          };
          for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            if (typeof original !== 'function') continue;
            history[method] = function (...args) {
              saveScroll();
              const previousPath = lastPath;
              const result = original.apply(this, args);
              notifyRoute(previousPath === routePath() ? 'same' : 'forward');
              return result;
            };
          }
          addEventListener('popstate', () => {
            saveScroll();
            notifyRoute('history');
          });
          addEventListener('hashchange', () => notifyRoute('forward'));
          notifyRoute();
        })();
        """
    }
}

@MainActor
private final class WebViewRefreshController: NSObject {
    private weak var store: HybridWebViewStore?

    init(store: HybridWebViewStore) {
        self.store = store
    }

    @objc func didPull(_ sender: UIRefreshControl) {
        store?.handlePullToRefresh(sender)
    }
}

/// WebKit receives no extra bottom safe-area inset; the native tab bar floats
/// over the edge-to-edge page instead of reserving another blank strip.
private final class ImmersiveWebView: WKWebView {
    override var safeAreaInsets: UIEdgeInsets {
        var insets = super.safeAreaInsets
        if let window {
            insets.top = max(0, window.safeAreaInsets.top - convert(bounds, to: window).minY)
        }
        insets.bottom = 0
        return insets
    }
}

struct HybridWebView: UIViewRepresentable {
    let session: HybridWebViewStore
    let tab: ShellTab
    let isActive: Bool
    var onReady: ((WKWebView) -> Void)? = nil

    func makeUIView(context: Context) -> WebViewHostView {
        let host = WebViewHostView()
        host.session = session
        let webView = session.makeWebView()
        if isActive {
            session.mount(tab: tab, in: host)
        }
        onReady?(webView)
        return host
    }

    func updateUIView(_ host: WebViewHostView, context: Context) {
        if isActive {
            session.mount(tab: tab, in: host)
        } else {
            session.unmount(from: host)
        }
    }

    static func dismantleUIView(_ host: WebViewHostView, coordinator: ()) {
        host.session?.unmount(from: host)
    }
}

@MainActor
final class WebViewHostView: UIView {
    weak var session: HybridWebViewStore?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor.systemBackground
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

@MainActor
private final class HybridWebViewCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    private weak var store: HybridWebViewStore?

    init(store: HybridWebViewStore) {
        self.store = store
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        store?.didFinish(url: webView.url)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        let scheme = url.scheme?.lowercased() ?? ""
        if ["about", "blob", "data"].contains(scheme), navigationAction.targetFrame != nil {
            decisionHandler(.allow)
            return
        }

        if IOSNextWebConfiguration.isTrusted(url) {
            // The login gate owns navigation: a link, a server redirect or a
            // restored history entry must not replace the login page.
            if store?.blocksInternalNavigation == true,
               navigationAction.targetFrame?.isMainFrame != false,
               !ShellTab.isAuthPath(url.path) {
                decisionHandler(.cancel)
                return
            }
            if navigationAction.targetFrame?.isMainFrame != false && ShellTab.isSchedulePath(url.path) {
                if navigationAction.navigationType == .linkActivated {
                    store?.openNativeRoute(url.path + (url.query.map { "?\($0)" } ?? ""))
                }
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
            return
        }

        store?.openExternal(url)
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if let response = navigationResponse.response as? HTTPURLResponse,
           let url = response.url,
           IOSNextWebConfiguration.isTrusted(url) {
            if (navigationResponse.isForMainFrame) {
                store?.didReceiveHTTPStatus(response.statusCode)
            }
        }
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?
            .lowercased() ?? ""
        if !navigationResponse.canShowMIMEType || disposition.contains("attachment") {
            if let url = navigationResponse.response.url {
                store?.openExternal(url)
            }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            if IOSNextWebConfiguration.isTrusted(url) {
                // A popup to a non-auth page would leave the gate through a
                // second route, so it is dropped while the gate is up.
                if store?.blocksInternalNavigation == true, !ShellTab.isAuthPath(url.path) { return nil }
                store?.navigate(path: url.path + (url.query.map { "?\($0)" } ?? ""))
            } else {
                store?.openExternal(url)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        store?.didStart()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        store?.didFail(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        store?.didFail(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        store?.retry()
    }
}
