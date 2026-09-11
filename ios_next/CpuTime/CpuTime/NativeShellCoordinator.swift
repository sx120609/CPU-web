import Combine
import Foundation

@MainActor
final class NativeShellCoordinator: ObservableObject {
    @Published private(set) var selectedTab: ShellTab = .home

    private weak var webSession: HybridWebViewStore?
    private var scheduleStore: NativeScheduleStore?
    private var isConnected = false
    private var scheduleTask: Task<Void, Never>?

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
        webSession.onAuthChanged = { [weak self, weak scheduleStore] in
            scheduleStore?.handleAuthChanged()
            guard let self, self.selectedTab == .schedule else { return }
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
        scheduleStore.attach(webView: webSession.makeWebView())
    }

    func userSelected(_ tab: ShellTab) {
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
        guard tab != .schedule else { return }
        selectedTab = tab
        webSession?.activate(tab: tab)
        webSession?.navigate(path: path)
    }

    private func handleNavigate(path: String, source: String, webSession: HybridWebViewStore?) {
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

    private func requestScheduleLoad(force: Bool, refreshCached: Bool = false) {
        guard let scheduleStore else { return }
        let restoredCache = !force && scheduleStore.restoreCachedSelection()
        if restoredCache, !refreshCached {
            scheduleTask?.cancel()
            return
        }
        guard webSession?.bridgeReady == true else {
            if let message = webSession?.errorMessage { scheduleStore.reportBridgeFailure(message) }
            else { scheduleStore.waitForBridge() }
            return
        }
        scheduleTask?.cancel()
        scheduleTask = Task { @MainActor in
            // Login can update account and JWXT state in consecutive messages.
            // Wait for that burst to settle before starting the next request.
            try? await Task.sleep(for: .milliseconds(100))
            guard !Task.isCancelled else { return }
            await scheduleStore.load(force: force || restoredCache)
        }
    }
}
