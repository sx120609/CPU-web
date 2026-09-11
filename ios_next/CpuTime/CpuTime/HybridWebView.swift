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
    /// The Web top bar owns the appearance switch and the native timetable is
    /// on screen before the WebView finishes loading, so the last reported mode
    /// is cached: a cold start must not flash the wrong scheme first.
    @Published private(set) var pageColorScheme: ColorScheme? = HybridWebViewStore.storedAppearanceScheme()

    nonisolated private static let appearanceModeKey = "CPUWebAppearanceMode"

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

    func goBack() { webView?.goBack() }

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
            onRoute?(path, source)
        case "authChanged":
            automaticWidgetSetupAttempted = false
            widgetAuthGeneration += 1
            // An account fingerprint lets the timetable keep its cached view
            // when the session merely finished restoring the same account.
            onAuthChanged?((body["account"] as? String) ?? "")
        default:
            break
        }
    }

    fileprivate func didFinish(url: URL?) {
        guard let url, let path = Self.path(for: url) else { return }
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
            /* The native shell supplies the bottom tab bar, so the Web tab bar
               and the desktop footer stay hidden. The Web top bar is kept: it
               is the only place with the brand, account and menu entries. */
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
            html[data-cpu-ios-next] #app > [data-cpu-ios-status-content] {
              padding-bottom: calc(var(--cpu-ios-original-bottom, 0px) + var(--cpu-ios-bottom-clearance)) !important;
            }
            html[data-cpu-ios-next] .layout-root:not(.layout-root--full-width) > .main:not(.main--bare):not(.main--full-width):not(.main--mobile-topic) {
              padding-inline: var(--cpu-ios-inline-inset) !important;
            }
            /* Pages that already reserve the notch inside their own padding
               (login, register) must not stack a second inset on top of it. */
            html[data-cpu-ios-next] [data-cpu-ios-status-content] {
              padding-top: max(var(--cpu-ios-original-top, 0px), env(safe-area-inset-top, 0px)) !important;
            }
            /* The home search panel is an edge-to-edge sheet only while it is
               the first thing on the page. Anything above it keeps the notch
               clearance, so it can no longer hide under the status bar. */
            html[data-cpu-ios-next] .home-entry[data-cpu-ios-hero] {
              border-top-left-radius: 0; border-top-right-radius: 0; border-top: 0;
              margin-inline: calc(-1 * var(--cpu-ios-inline-inset, 0px));
              padding-left: calc(var(--cpu-ios-original-left, 0px) + var(--cpu-ios-inline-inset, 0px));
              padding-right: calc(var(--cpu-ios-original-right, 0px) + var(--cpu-ios-inline-inset, 0px));
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

          // Put the notch clearance inside whatever element sits at the top of
          // the page, rather than in a separate native white strip. Reapply to
          // newly mounted route views and to the Web top bar appearing.
          let statusFrame = 0;
          let statusTarget = null;
          const updateStatusContent = () => {
            statusFrame = 0;
            const main = document.querySelector('.layout-root > .main');
            const mounted = main ? [...main.children] : [];
            // During a route transition the outgoing page is frozen in place
            // while the incoming one is already mounted. The notch clearance
            // belongs to the incoming page; applying it only after the old page
            // leaves made the new content flash under the status bar and then
            // jump down.
            const page = mounted.find(el => !String(el.className).includes('page-route-leave'))
              || mounted[mounted.length - 1]
              || document.querySelector('#app > :first-child:not(.layout-root)');
            // With the Web top bar on screen it already sits above the page, so
            // the clearance belongs to the bar; only a page without the bar
            // carries the inset itself. Tracking the current owner keeps a
            // stale inset from stacking when the bar appears or disappears.
            const topbar = document.querySelector('.layout-root > .topbar');
            const content = topbar && getComputedStyle(topbar).display !== 'none' ? topbar : page;
            if (content !== statusTarget) {
              if (statusTarget) statusTarget.removeAttribute('data-cpu-ios-status-content');
              statusTarget = content;
              if (content) {
                const computed = getComputedStyle(content);
                content.style.setProperty('--cpu-ios-original-top', computed.paddingTop);
                content.style.setProperty('--cpu-ios-original-left', computed.paddingLeft);
                content.style.setProperty('--cpu-ios-original-right', computed.paddingRight);
                content.style.setProperty('--cpu-ios-original-bottom', computed.paddingBottom);
                content.setAttribute('data-cpu-ios-status-content', '');
              }
            }
            const hero = page && page.matches('.home-stream') && page.firstElementChild
              && page.firstElementChild.classList.contains('home-entry')
              ? page.firstElementChild : null;
            if (hero && !hero.hasAttribute('data-cpu-ios-hero')) {
              const heroStyle = getComputedStyle(hero);
              hero.style.setProperty('--cpu-ios-original-left', heroStyle.paddingLeft);
              hero.style.setProperty('--cpu-ios-original-right', heroStyle.paddingRight);
              hero.setAttribute('data-cpu-ios-hero', '');
            }
          };
          const scheduleStatusContent = () => {
            if (!statusFrame) statusFrame = requestAnimationFrame(updateStatusContent);
          };
          const observePage = () => {
            if (!document.documentElement) return;
            new MutationObserver(scheduleStatusContent).observe(document.documentElement, {childList: true, subtree: true});
            const appearance = () => post({
              type: 'appearance', dark: document.documentElement.dataset.theme === 'dark',
              mode: document.documentElement.dataset.appearanceMode || 'system'
            });
            new MutationObserver(appearance).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'data-appearance-mode']});
            appearance();
            scheduleStatusContent();
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
