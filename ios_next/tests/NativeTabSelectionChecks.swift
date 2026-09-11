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
    func activate(tab: ShellTab) { activeTab = tab }
    func navigate(path: String) { destinations.append(path) }
    func makeWebView() -> Int { webViewCreations += 1; return 0 }
}
@MainActor
final class NativeScheduleStore {
    var cached = false
    var archived = false
    var loads: [Bool] = []
    var waitingForBridge = false
    func restoreCachedSelection() -> Bool { cached }
    func attach(webView: Int) {}
    func receivePrefetchedSnapshot(_ snapshot: NativeScheduleSnapshot) {}
    func handleAuthChanged(account: String) {}
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

        shell.openWeb(path: "/login", tab: .profile)
        precondition(shell.selectedTab == .profile && web.destinations.last == "/login")
        web.onRoute?("/home", "profile")
        precondition(shell.selectedTab == .profile, "A delayed load finish must not replace login selection")
        shell.userSelected(.schedule)
        try? await Task.sleep(for: .milliseconds(200))
        precondition(store.loads == [false])
        shell.userSelected(.home)
        web.bridgeReady = false
        shell.userSelected(.schedule)
        try? await Task.sleep(for: .milliseconds(200))
        precondition(store.loads == [false], "Cached schedule must survive a tab switch while the bridge reloads")
        print("Native tab checks passed: rapid selection, delayed history, reselection, stale intents, login")
    }
}
