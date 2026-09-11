import Combine
import Foundation

@MainActor
final class NativeShellCoordinator: ObservableObject {
    @Published private(set) var selectedTab: ShellTab = .schedule
    /// False until the launch session probe has decided where to start. The
    /// root view shows a neutral waiting surface instead, so the native tab bar
    /// never flashes before a guest is sent to the login gate.
    @Published private(set) var isAuthResolved = false
    /// True while the full-screen login gate replaces the native shell.
    @Published private(set) var requiresLogin = false

    /// The Web login page the gate always lands on.
    static let loginGatePath = "/login?redirect=/home"

    /// How long a still-present session cookie may defer an empty account report
    /// before the gate takes over. Overridable so checks stay fast.
    var sessionRestoreWindow: Duration = .seconds(4)
    /// How long the shell waits for the account report that follows an empty one
    /// before believing the session ended. Overridable so checks stay fast.
    var signOutGrace: Duration = .milliseconds(400)

    private weak var webSession: HybridWebViewStore?
    private var scheduleStore: NativeScheduleStore?
    private var isConnected = false
    private var scheduleTask: Task<Void, Never>?
    private var pendingGateTask: Task<Void, Never>?
    /// The last non-empty account fingerprint the Web reported, cleared the
    /// moment the session ends.
    private var accountKey = ""

    /// True once the Web has proved a real signed-in account. This is stronger
    /// than a session cookie, which can outlive an expired server session.
    var hasAuthenticatedSession: Bool { !accountKey.isEmpty }

    func connect(webSession: HybridWebViewStore, scheduleStore: NativeScheduleStore) {
        guard !isConnected else { return }
        self.webSession = webSession
        self.scheduleStore = scheduleStore

        // The web app owns its router for the web tabs. It reports route intents
        // here so a web link to /schedule can select the native tab instead of
        // creating a second schedule page inside WKWebView.
        webSession.onNavigate = { [weak self, weak webSession] path, source in
            self?.handleNavigate(path: path, source: source, webSession: webSession)
        }
        // History notifications describe Web content, not a new tab selection.
        // A delayed /home or /login redirect must never undo the user's tap.
        // While the gate is up they also police SPA routing: a guest who lands
        // on /home in-page is pulled straight back to the login page.
        webSession.onRoute = { [weak self] path, source in
            self?.handleRouteChanged(path: path, source: source)
        }
        webSession.onAuthChanged = { [weak self, weak scheduleStore] account in
            scheduleStore?.handleAuthChanged(account: account)
            guard let self else { return }
            self.handleAuthChanged(account)
            guard self.selectedTab == .schedule else { return }
            self.requestScheduleLoad(force: true)
        }
        webSession.onSchedulePrefetched = { [weak scheduleStore] snapshot in
            scheduleStore?.receivePrefetchedSnapshot(snapshot)
        }
        webSession.onBridgeReady = { [weak self] in
            guard let self, self.selectedTab == .schedule else { return }
            self.requestScheduleLoad(force: false, refreshCached: true)
        }
        webSession.onFailure = { [weak scheduleStore] message in
            scheduleStore?.reportBridgeFailure(message)
        }
        isConnected = true
        webSession.activate(tab: selectedTab)
        // Prewarm the shared WebView without presenting a Web tab. The native
        // timetable stays visible while its authenticated bridge starts up.
        scheduleStore.attach(webView: webSession.makeWebView())
        if selectedTab == .schedule {
            requestScheduleLoad(force: false, refreshCached: true)
        }
    }

    /// Decides where a cold start lands before anything is shown. A stored
    /// session cookie keeps the existing native shell; otherwise the login gate
    /// takes over. The live `authChanged` report can settle the question first.
    func resolveInitialAuth(webSession: HybridWebViewStore) async {
        guard !isAuthResolved else { return }
        let hasCookie = await webSession.hasSessionCookie()
        // The bridge may have reported the real session while the cookie store
        // was being read; that live answer wins over the pre-flight guess.
        guard !isAuthResolved else { return }
        if hasCookie {
            applyAuthenticated(navigateToHome: false)
        } else {
            applyLoginGate(navigateToLogin: true)
        }
    }

    /// The Web app reports the signed-in account fingerprint, or an empty
    /// string once the session is gone.
    func handleAuthChanged(_ account: String) {
        let normalized = account.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.isEmpty {
            accountKey = ""
            // An empty report is not proof on its own: the Web app emits one
            // while it is still restoring a session, right before the matching
            // account report. Gating instantly there tore the shell down and
            // sent the signed-in login page into a redirect loop with the gate.
            scheduleLoginGate()
            return
        }
        pendingGateTask?.cancel()
        pendingGateTask = nil
        accountKey = normalized
        // Only a login that follows the gate moves the shell to the home tab.
        // The launch report must keep the existing default tab (the timetable).
        applyAuthenticated(navigateToHome: requiresLogin)
    }

    func userSelected(_ tab: ShellTab) {
        guard !requiresLogin else { return }
        guard tab != selectedTab else { return }
        selectedTab = tab
        guard isConnected else { return }
        webSession?.activate(tab: tab)
        if tab == .schedule {
            requestScheduleLoad(force: false)
            return
        }
        webSession?.navigate(path: tab.defaultPath)
    }

    func openWeb(path: String, tab: ShellTab = .profile) {
        // Opening the Web login or register page is a gate entry, not a tab
        // switch: the native tab bar stays hidden until the session exists.
        if ShellTab.isLoginPath(path) {
            applyLoginGate(navigateToLogin: true)
            return
        }
        // The gate is the only screen while it is up; nothing may open a tab.
        guard !requiresLogin else { return }
        guard tab != .schedule else { return }
        selectedTab = tab
        webSession?.activate(tab: tab)
        webSession?.navigate(path: path)
    }

    private func handleRouteChanged(path: String, source: String) {
        guard requiresLogin else { return }
        guard !ShellTab.isAuthPath(path) else { return }
        // A session the Web already proved is signed in is not an escape
        // attempt: the login page redirects signed-in visitors straight home on
        // its own. Follow it and lift the gate instead of fighting its router.
        if hasAuthenticatedSession {
            applyAuthenticated(navigateToHome: true)
            return
        }
        // The Web page reached somewhere the gate forbids (a "back to home"
        // link, a redirect, an in-page router push): put it back on login.
        applyLoginGate(navigateToLogin: true)
    }

    private func handleNavigate(path: String, source: String, webSession: HybridWebViewStore?) {
        guard !requiresLogin else { return }
        guard selectedTab != .schedule, source == selectedTab.rawValue else { return }
        if let destination = ShellTab.from(path: path) {
            selectedTab = destination
            webSession?.activate(tab: destination)
            if destination == .schedule {
                requestScheduleLoad(force: false)
            } else {
                webSession?.navigate(path: path)
            }
            return
        }

    }

    /// Waits for the account report that normally follows an empty one, then
    /// lets the shared cookie jar settle it: a cookie that is gone means the
    /// session really ended, a cookie that is still there only buys the bounded
    /// restore window. Either way the gate eventually takes over on its own.
    private func scheduleLoginGate() {
        // Already gated: only a non-empty account report can open it again.
        guard !requiresLogin else {
            pendingGateTask?.cancel()
            pendingGateTask = nil
            return
        }
        guard pendingGateTask == nil else { return }
        let grace = signOutGrace
        let window = sessionRestoreWindow
        pendingGateTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: grace)
            guard let self, !Task.isCancelled else { return }
            if await self.webSession?.hasSessionCookie() == true {
                try? await Task.sleep(for: window)
                guard !Task.isCancelled else { return }
            }
            self.applyLoginGate(navigateToLogin: true)
        }
    }

    /// Hides the native shell behind a full-screen Web login page. The tab bar
    /// is not rendered at all (the root view swaps), so there is no tab to
    /// leave through and no back gesture to dismiss it.
    private func applyLoginGate(navigateToLogin: Bool) {
        pendingGateTask?.cancel()
        pendingGateTask = nil
        requiresLogin = true
        isAuthResolved = true
        guard isConnected else { return }
        webSession?.blocksInternalNavigation = true
        webSession?.setBackForwardNavigationGesturesEnabled(false)
        if selectedTab != .profile { selectedTab = .profile }
        webSession?.activate(tab: .profile)
        if navigateToLogin, webSession?.isShowingAuthPage != true {
            webSession?.navigate(path: Self.loginGatePath)
        }
    }

    /// Lifts the gate, restoring the native tab bar and the normal back gesture.
    private func applyAuthenticated(navigateToHome: Bool) {
        requiresLogin = false
        isAuthResolved = true
        guard isConnected else { return }
        webSession?.blocksInternalNavigation = false
        webSession?.setBackForwardNavigationGesturesEnabled(true)
        guard navigateToHome else { return }
        selectedTab = .home
        webSession?.activate(tab: .home)
        webSession?.navigate(path: ShellTab.home.defaultPath)
    }

    private func requestScheduleLoad(force: Bool, refreshCached: Bool = false) {
        guard let scheduleStore else { return }
        let restoredCache = !force && scheduleStore.restoreCachedSelection()
        if restoredCache, !refreshCached {
            scheduleTask?.cancel()
            return
        }
        scheduleTask?.cancel()
        scheduleTask = Task { @MainActor in
            // A relaunch shows the archived timetable before the web bridge has
            // booted, then refreshes it in place.
            var restoredArchive = false
            if !force, !restoredCache {
                restoredArchive = await scheduleStore.restoreArchivedSelection()
            }
            guard !Task.isCancelled else { return }
            guard self.webSession?.bridgeReady == true else {
                if let message = self.webSession?.errorMessage { scheduleStore.reportBridgeFailure(message) }
                else { scheduleStore.waitForBridge() }
                return
            }
            // Login can update account and JWXT state in consecutive messages.
            // Wait for that burst to settle before starting the next request.
            try? await Task.sleep(for: .milliseconds(100))
            guard !Task.isCancelled else { return }
            await scheduleStore.load(force: force || restoredCache || restoredArchive)
        }
    }
}
