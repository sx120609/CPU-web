import Foundation
import Combine
import SwiftUI
import UIKit
import WebKit


enum IOSNextWebConfiguration {
    static let versionCode = 1
    static let versionName = "1.0.0"

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

    var onSchedulePrefetched: ((NativeScheduleSnapshot) -> Void)?
    var onNavigate: ((String, String) -> Void)?
    var onRoute: ((String, String) -> Void)?
    var onAuthChanged: ((String) -> Void)?
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
                Task { @MainActor in self?.canGoBack = view.canGoBack }
            },
            webView.observe(\.isLoading, options: [.initial, .new]) { [weak self] view, _ in
                Task { @MainActor in self?.isLoading = view.isLoading }
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

    func setAppearanceMode(_ mode: String) {
        guard ["system", "light", "dark"].contains(mode) else { return }
        appearanceMode = mode
        UserDefaults.standard.set(mode, forKey: Self.appearanceModeKey)
        pageColorScheme = mode == "system" ? nil : (mode == "dark" ? .dark : .light)
        let modeLiteral = IOSNextWebConfiguration.javascriptString(mode)
        let script = """
        (() => {
          const mode = \(modeLiteral);
          try { localStorage.setItem('cpu-appearance-mode-v1', mode); } catch (_) {}
          const prefersDark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
          const root = document.documentElement;
          root.dataset.appearanceMode = mode;
          root.dataset.theme = prefersDark ? 'dark' : 'light';
          root.classList.toggle('dark', prefersDark);
          root.style.colorScheme = prefersDark ? 'dark' : 'light';
          return true;
        })()
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

    func retry() {
        errorMessage = nil
        let view = makeWebView()
        if view.url == nil { view.load(URLRequest(url: IOSNextWebConfiguration.appURLFor(tab: activeTab))) }
        else { view.reload() }
    }

    fileprivate func didStart() {
        bridgeReady = false
        errorMessage = nil
    }

    fileprivate func didFail(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        isLoading = false
        errorMessage = "页面暂时无法打开，请检查网络后重试。"
        onFailure?(errorMessage!)
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
        case "route":
            guard let path = body["path"] as? String else { return }
            currentPath = path
            onRoute?(path, source)
        case "authChanged":
            automaticWidgetSetupAttempted = false
            widgetAuthGeneration += 1
            isLoggedIn = !(body["account"] as? String ?? "").isEmpty
            // An account fingerprint lets the timetable keep its cached view
            // when the session merely finished restoring the same account.
            onAuthChanged?((body["account"] as? String) ?? "")
        default:
            break
        }
    }

    fileprivate func didFinish(url: URL?) {
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

    private static func bridgeScript() -> String {
        let appURL = IOSNextWebConfiguration.appURL
        let port = appURL.port.map { ":\($0)" } ?? ""
        let origin = IOSNextWebConfiguration.javascriptString("\(appURL.scheme!)://\(appURL.host!)\(port)")
        return """
        (() => {
          if (location.origin !== \(origin)) return;
          if (!/CPUTimeNative\\//i.test(navigator.userAgent)) return;
          // Apply before Vue mounts, including on older deployed Web clients.
          const style = document.createElement('style');
          style.textContent = `
            html[data-cpu-ios-next] { --cpu-ios-bottom-clearance: 96px; }
            /* The native shell supplies both bars. The Web top bar stays in the
               DOM so its drawer and account actions remain reusable. */
            html[data-cpu-ios-next] .layout-root > .topbar,
            html[data-cpu-ios-next] .layout-root > .mobile-tabbar,
            html[data-cpu-ios-next] .layout-root > .footer { display: none !important; }
            html[data-cpu-ios-next] .layout-root {
              --layout-mobile-tabbar-reserve: 0px !important;
              --cpu-ios-inline-inset: 20px;
            }
            @media (max-width: 768px) {
              html[data-cpu-ios-next] .layout-root { --cpu-ios-inline-inset: 12px; }
            }
            html[data-cpu-ios-next] .layout-root .main {
              padding-top: 0 !important;
              padding-bottom: var(--cpu-ios-bottom-clearance) !important;
            }
            html[data-cpu-ios-next] .layout-root:not(.layout-root--full-width) > .main:not(.main--bare):not(.main--full-width):not(.main--mobile-topic) {
              padding-inline: var(--cpu-ios-inline-inset) !important;
            }
            /* A native tab tap is a tab change, not an in-page forward
               navigation: swapping instantly keeps the frozen outgoing page
               from showing through the incoming one. */
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
          const bridge = window.CPUTimeNative || {};
          bridge.isNativeShell = true;
          bridge.platform = 'ios';
          bridge.version = '1';
          bridge.navigate = (path) => {
            if (bridge.nativeNavigationDepth > 0) return false;
            return post({ type: 'navigate', path: String(path ?? '') });
          };
          bridge.ready = () => post({ type: 'ready' });
          bridge.schedulePrefetched = (snapshot) => post({type: 'schedulePrefetched', snapshot});
          bridge.scheduleWeekPrefetched = bridge.schedulePrefetched;
          bridge.authChanged = (account) => post({ type: 'authChanged', account: String(account ?? '') });
          window.CPUTimeNative = bridge;
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
          const notifyRoute = () => {
            const path = `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
            post({ type: 'route', path });
          };
          for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            if (typeof original !== 'function') continue;
            history[method] = function (...args) {
              const result = original.apply(this, args);
              notifyRoute();
              return result;
            };
          }
          addEventListener('popstate', notifyRoute);
          addEventListener('hashchange', notifyRoute);
          notifyRoute();
        })();
        """
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
