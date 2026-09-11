import Foundation

// Lightweight transport doubles; the production coordinator and tab model are
// compiled unchanged, so these checks exercise who owns the actual selection.
struct NativeScheduleSnapshot {}

@MainActor
final class HybridWebViewStore {
    var onSchedulePrefetched: ((NativeScheduleSnapshot) -> Void)?
    var onNavigate: ((String, String) -> Void)?
    var onRoute: ((String, String) -> Void)?
    var onAuthChanged: ((String) -> Void)?
    var onBridgeReady: (() -> Void)?
    var onFailure: ((String) -> Void)?
    var bridgeReady = true
    var errorMessage: String?
    var destinations: [String] = []
    var activeTab: ShellTab = .home
    var webViewCreations = 0
    var blocksInternalNavigation = false
    var backForwardNavigationGesturesEnabled = true
    var isShowingAuthPage = false
    var sessionCookie = false
    func activate(tab: ShellTab) { activeTab = tab }
    func navigate(path: String) { destinations.append(path) }
    func makeWebView() -> Int { webViewCreations += 1; return 0 }
    func hasSessionCookie() async -> Bool { sessionCookie }
    func setBackForwardNavigationGesturesEnabled(_ enabled: Bool) { backForwardNavigationGesturesEnabled = enabled }
}
@MainActor
final class NativeScheduleStore {
    var cached = false
    var archived = false
    var loads: [Bool] = []
    var authChanges: [String] = []
    var waitingForBridge = false
    func restoreCachedSelection() -> Bool { cached }
    func attach(webView: Int) {}
    func receivePrefetchedSnapshot(_ snapshot: NativeScheduleSnapshot) {}
    func handleAuthChanged(account: String) { authChanges.append(account) }
    func reportBridgeFailure(_ message: String) {}
    func waitForBridge() { waitingForBridge = true }
    func restoreArchivedSelection() async -> Bool { archived }
    func load(force: Bool) async { loads.append(force); cached = true }
}

@main
struct NativeTabSelectionChecks {
    @MainActor
    static func main() async {
        let startupWeb = HybridWebViewStore()
        startupWeb.bridgeReady = false
        let startupShell = NativeShellCoordinator()
        let startupStore = NativeScheduleStore()
        precondition(startupShell.selectedTab == .schedule)
        startupShell.connect(webSession: startupWeb, scheduleStore: startupStore)
        precondition(startupWeb.activeTab == .schedule && startupWeb.webViewCreations == 1)
        try? await Task.sleep(for: .milliseconds(50))
        precondition(startupWeb.destinations.isEmpty && startupStore.waitingForBridge)
        startupWeb.onNavigate?("/login", "schedule")
        precondition(startupShell.selectedTab == .schedule)
        startupWeb.bridgeReady = true
        startupWeb.onBridgeReady?()
        try? await Task.sleep(for: .milliseconds(200))
        precondition(startupStore.loads == [false], "Startup must load the timetable when the background bridge is ready")

        let web = HybridWebViewStore()
        let shell = NativeShellCoordinator()
        let store = NativeScheduleStore()
        shell.connect(webSession: web, scheduleStore: store)

        for tab in [ShellTab.academic, .services, .profile, .home, .schedule, .services] {
            shell.userSelected(tab)
            // Old history callbacks were formerly mislabeled with the NEW tab.
            for oldPath in ["/home", "/login", "/jwxt", "/schedule"] {
                web.onRoute?(oldPath, tab.rawValue)
                precondition(shell.selectedTab == tab, "History must not undo the user's latest selection")
            }
            precondition(web.activeTab == tab)
        }
        let requestCount = web.destinations.count
        shell.userSelected(.services)
        precondition(web.destinations.count == requestCount, "Reselecting a tab must not reload it")

        web.onNavigate?("/schedule", "home")
        precondition(shell.selectedTab == .services, "An old page's intent must be ignored")
        web.onNavigate?("/schedule", "services")
        precondition(shell.selectedTab == .schedule, "An explicit visible-page schedule link must still work")
        web.onNavigate?("/home", "schedule")
        precondition(shell.selectedTab == .schedule, "The hidden WebView must not take over the native schedule")

        // Opening the Web login page is a gate entry, not a tab switch.
        shell.openWeb(path: "/login", tab: .profile)
        precondition(shell.requiresLogin && shell.isAuthResolved, "Opening the Web login page must raise the gate")
        precondition(shell.selectedTab == .profile)
        precondition(web.destinations.last == NativeShellCoordinator.loginGatePath)
        precondition(web.blocksInternalNavigation && !web.backForwardNavigationGesturesEnabled,
                     "The gate blocks internal navigation and the back gesture")

        // A delayed load finish or an in-page "back to home" must not escape.
        let gateRequests = web.destinations.count
        web.onRoute?("/home", "profile")
        precondition(shell.selectedTab == .profile && shell.requiresLogin,
                     "An in-page redirect must not replace the login gate")
        precondition(web.destinations.count == gateRequests + 1)
        precondition(web.destinations.last == NativeShellCoordinator.loginGatePath)
        let bounced = web.destinations.count
        web.onRoute?("/api/auth/session", "profile")
        precondition(web.destinations.count == bounced, "Authentication paths stay reachable inside the gate")

        // The tab bar is not rendered while gated and stray taps are refused.
        shell.userSelected(.schedule)
        shell.userSelected(.home)
        precondition(shell.selectedTab == .profile, "The gate must refuse native tab switches")
        shell.openWeb(path: "/services", tab: .services)
        precondition(shell.selectedTab == .profile, "The gate must refuse opening another Web tab")

        // A non-empty account report is a completed login: back to the shell.
        web.onAuthChanged?("acct-1")
        precondition(!shell.requiresLogin && shell.isAuthResolved)
        precondition(shell.selectedTab == .home)
        precondition(web.activeTab == .home)
        precondition(web.destinations.last == "/home")
        precondition(!web.blocksInternalNavigation && web.backForwardNavigationGesturesEnabled)
        precondition(store.authChanges.last == "acct-1", "The timetable store still receives auth changes")

        shell.userSelected(.schedule)
        try? await Task.sleep(for: .milliseconds(200))
        precondition(store.loads == [false])
        shell.userSelected(.home)
        web.bridgeReady = false
        shell.userSelected(.schedule)
        try? await Task.sleep(for: .milliseconds(200))
        precondition(store.loads == [false], "Cached schedule must survive a tab switch while the bridge reloads")

        // Signing out or losing the session drops straight back into the gate.
        // The empty report is deferred only long enough for a restore report to
        // cancel it; with the cookie gone the gate follows right after.
        shell.signOutGrace = .milliseconds(30)
        shell.sessionRestoreWindow = .milliseconds(30)
        web.onAuthChanged?("")
        try? await Task.sleep(for: .milliseconds(250))
        precondition(shell.requiresLogin && shell.selectedTab == .profile)
        precondition(web.blocksInternalNavigation && !web.backForwardNavigationGesturesEnabled)

        // Cold start with a stored session keeps the existing default shell.
        let authedWeb = HybridWebViewStore()
        authedWeb.sessionCookie = true
        let authedShell = NativeShellCoordinator()
        let authedStore = NativeScheduleStore()
        authedShell.connect(webSession: authedWeb, scheduleStore: authedStore)
        precondition(!authedShell.isAuthResolved, "Nothing shows before the session is known")
        await authedShell.resolveInitialAuth(webSession: authedWeb)
        precondition(authedShell.isAuthResolved && !authedShell.requiresLogin)
        precondition(authedShell.selectedTab == .schedule, "A restored session keeps the default timetable tab")
        precondition(!authedWeb.blocksInternalNavigation && authedWeb.backForwardNavigationGesturesEnabled)

        // The Web app reports "no account" for a moment while its profile
        // request is still running. That report alone must not gate; the
        // matching account report cancels the wait.
        let restoreWeb = HybridWebViewStore()
        restoreWeb.sessionCookie = true
        let restoreShell = NativeShellCoordinator()
        restoreShell.signOutGrace = .milliseconds(40)
        restoreShell.sessionRestoreWindow = .milliseconds(120)
        restoreShell.connect(webSession: restoreWeb, scheduleStore: NativeScheduleStore())
        await restoreShell.resolveInitialAuth(webSession: restoreWeb)
        restoreWeb.onAuthChanged?("")
        precondition(!restoreShell.requiresLogin, "An empty report must not gate on its own")
        restoreWeb.onAuthChanged?("acct-restore")
        try? await Task.sleep(for: .milliseconds(400))
        precondition(!restoreShell.requiresLogin && restoreShell.hasAuthenticatedSession,
                     "The restored account must cancel the pending gate")
        precondition(restoreShell.selectedTab == .schedule, "Restoring a session keeps the default tab")

        // A stored session that never restores still ends up gated once the
        // bounded window expires, so a stale cookie cannot keep the shell open.
        let staleWeb = HybridWebViewStore()
        staleWeb.sessionCookie = true
        let staleShell = NativeShellCoordinator()
        staleShell.signOutGrace = .milliseconds(40)
        staleShell.sessionRestoreWindow = .milliseconds(120)
        staleShell.connect(webSession: staleWeb, scheduleStore: NativeScheduleStore())
        await staleShell.resolveInitialAuth(webSession: staleWeb)
        staleWeb.onAuthChanged?("")
        precondition(!staleShell.requiresLogin, "The gate waits out the grace first")
        try? await Task.sleep(for: .milliseconds(500))
        precondition(staleShell.requiresLogin && staleShell.selectedTab == .profile,
                     "A stored session that never restores must still be gated")
        precondition(staleWeb.blocksInternalNavigation && !staleWeb.backForwardNavigationGesturesEnabled)

        // Cold start without one lands on the full-screen login gate.
        let guestWeb = HybridWebViewStore()
        let guestShell = NativeShellCoordinator()
        let guestStore = NativeScheduleStore()
        guestShell.connect(webSession: guestWeb, scheduleStore: guestStore)
        precondition(!guestShell.isAuthResolved)
        await guestShell.resolveInitialAuth(webSession: guestWeb)
        precondition(guestShell.isAuthResolved && guestShell.requiresLogin)
        precondition(guestShell.selectedTab == .profile)
        precondition(guestWeb.activeTab == .profile)
        precondition(guestWeb.destinations.last == NativeShellCoordinator.loginGatePath)
        precondition(guestWeb.blocksInternalNavigation && !guestWeb.backForwardNavigationGesturesEnabled)
        let guestBounces = guestWeb.destinations.count
        guestWeb.onRoute?("/home", "profile")
        precondition(guestShell.requiresLogin, "A guest's non-auth route must stay gated")
        precondition(guestWeb.destinations.count == guestBounces + 1)
        precondition(!guestShell.hasAuthenticatedSession)

        // A signed-in visitor whose Web login page redirects itself home (its
        // own "already signed in" path) must lift the gate, not bounce forever.
        let liveWeb = HybridWebViewStore()
        liveWeb.sessionCookie = true
        let liveShell = NativeShellCoordinator()
        liveShell.connect(webSession: liveWeb, scheduleStore: NativeScheduleStore())
        await liveShell.resolveInitialAuth(webSession: liveWeb)
        liveWeb.onAuthChanged?("acct-live")
        precondition(liveShell.hasAuthenticatedSession && !liveShell.requiresLogin)
        liveShell.openWeb(path: "/login", tab: .profile)
        precondition(liveShell.requiresLogin, "Opening the Web login page raises the gate")
        liveWeb.onRoute?("/home", "profile")
        precondition(!liveShell.requiresLogin && liveShell.selectedTab == .home,
                     "The gate must follow the signed-in redirect instead of looping")

        // A bridge report that arrives before the cookie probe settles wins, so
        // a live session is never gated by the pre-flight guess.
        let raceWeb = HybridWebViewStore()
        raceWeb.sessionCookie = false
        let raceShell = NativeShellCoordinator()
        raceShell.connect(webSession: raceWeb, scheduleStore: NativeScheduleStore())
        raceWeb.onAuthChanged?("acct-race")
        precondition(!raceShell.requiresLogin && raceShell.isAuthResolved,
                     "A live report resolves auth without waiting for the cookie probe")
        precondition(raceShell.selectedTab == .schedule, "The launch report keeps the default tab")
        await raceShell.resolveInitialAuth(webSession: raceWeb)
        precondition(!raceShell.requiresLogin && raceShell.isAuthResolved,
                     "The live session report must not be overwritten by the cookie probe")

        print("Native tab checks passed: rapid selection, delayed history, reselection, stale intents, login gate, session restore")
    }
}
