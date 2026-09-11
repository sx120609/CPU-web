import Combine
import SwiftUI

@main
struct CpuTimeApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @StateObject private var webSession = HybridWebViewStore()
    @StateObject private var scheduleStore = NativeScheduleStore()
    @StateObject private var shell = NativeShellCoordinator()

    var body: some View {
        rootView
            .task(id: scheduleStore.lastUpdatedAt) {
                guard scheduleStore.result != nil else { return }
                await webSession.ensureScheduleWidgetConfigured()
            }
            .onOpenURL { url in
                shell.connect(webSession: webSession, scheduleStore: scheduleStore)
                guard url.scheme == "cputime-next", url.host == "schedule" else { return }
                guard !shell.requiresLogin else { return }
                scheduleStore.selectedSemester = ""
                scheduleStore.selectedWeek = ""
                shell.userSelected(.schedule)
                if webSession.bridgeReady { Task { await scheduleStore.load(semester: "", week: "", force: true) } }
            }
            .onAppear {
                shell.connect(webSession: webSession, scheduleStore: scheduleStore)
                Task { await shell.resolveInitialAuth(webSession: webSession) }
#if DEBUG
                let env = ProcessInfo.processInfo.environment
                if let raw = env["CPU_DEBUG_TAB"], let tab = ShellTab(rawValue: raw) {
                    let delay = Double(env["CPU_DEBUG_TAB_DELAY"] ?? "") ?? 0
                    Task { @MainActor in
                        try? await Task.sleep(for: .seconds(delay))
                        await webSession.debugDump("before")
                        shell.userSelected(tab)
                        try? await Task.sleep(for: .milliseconds(120))
                        await webSession.debugDump("t+120ms")
                        try? await Task.sleep(for: .seconds(3))
                        await webSession.debugDump("settled")
                    }
                }
                if let list = env["CPU_DEBUG_TAB_CYCLE"] {
                    let tabs = list.split(separator: ",").compactMap { ShellTab(rawValue: String($0)) }
                    Task { @MainActor in
                        try? await Task.sleep(for: .seconds(8))
                        for tab in tabs {
                            shell.userSelected(tab)
                            for step in [16, 34, 50, 120, 400] {
                                try? await Task.sleep(for: .milliseconds(step))
                                await webSession.debugDump("\(tab.rawValue)+\(step)")
                            }
                            try? await Task.sleep(for: .seconds(3))
                            await webSession.debugDump("\(tab.rawValue) settled")
                        }
                    }
                }
#endif
            }
    }

    /// The login gate is a root-view swap, not a hidden tab bar: while it is
    /// up the native TabView is never built, so there is no tab to escape
    /// through. Until the launch session probe answers, a neutral waiting
    /// surface keeps the tab bar from flashing first.
    @ViewBuilder
    private var rootView: some View {
        if shell.requiresLogin {
            LoginGateView(webSession: webSession)
        } else if !shell.isAuthResolved {
            LaunchWaitingView()
        } else {
            NativeShellView(
                webSession: webSession,
                scheduleStore: scheduleStore,
                shell: shell
            )
        }
    }
}

/// Shown for the instant between the first frame and the session decision.
private struct LaunchWaitingView: View {
    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground).ignoresSafeArea()
            ProgressView()
        }
    }
}

/// Full-screen Web login gate. It reuses the shared WKWebView (same cookie
/// jar) and is not wrapped in the native TabView.
private struct LoginGateView: View {
    @ObservedObject var webSession: HybridWebViewStore

    var body: some View {
        ZStack {
            HybridWebView(session: webSession, tab: .profile, isActive: true)
                .ignoresSafeArea(.container, edges: [.top, .bottom])
            if let message = webSession.errorMessage {
                ContentUnavailableView {
                    Label("页面无法打开", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("重试", action: webSession.retry).buttonStyle(.borderedProminent)
                }
                .background(Color(uiColor: .systemBackground))
            }
        }
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .overlay(alignment: .top) {
            if webSession.isLoading { ProgressView().padding(8) }
        }
        .preferredColorScheme(webSession.pageColorScheme)
    }
}


struct NativeShellView: View {
    @ObservedObject var webSession: HybridWebViewStore
    @ObservedObject var scheduleStore: NativeScheduleStore
    @ObservedObject var shell: NativeShellCoordinator
    @State private var widgetsPresented = false

    var body: some View {
        TabView(selection: selection) {
            WebTabScreen(
                session: webSession,
                tab: .home,
                isActive: shell.selectedTab == .home
            )
            .tabItem {
                Label(ShellTab.home.label, systemImage: ShellTab.home.systemImage)
            }
            .tag(ShellTab.home)

            WebTabScreen(session: webSession, tab: .academic, isActive: shell.selectedTab == .academic)
                .tabItem {
                    Label(ShellTab.academic.label, systemImage: ShellTab.academic.systemImage)
                }
                .tag(ShellTab.academic)

            NativeScheduleView(
                store: scheduleStore,
                onLogin: {
                    shell.openWeb(path: "/login", tab: .profile)
                },
                onWidgets: { widgetsPresented = true }
            )
            .tabItem {
                Label(ShellTab.schedule.label, systemImage: ShellTab.schedule.systemImage)
            }
            .tag(ShellTab.schedule)

            WebTabScreen(session: webSession, tab: .services, isActive: shell.selectedTab == .services)
                .tabItem {
                    Label(ShellTab.services.label, systemImage: ShellTab.services.systemImage)
                }
                .tag(ShellTab.services)

            WebTabScreen(session: webSession, tab: .profile, isActive: shell.selectedTab == .profile)
                .tabItem {
                    Label(ShellTab.profile.label, systemImage: ShellTab.profile.systemImage)
                }
                .tag(ShellTab.profile)
        }
        .sheet(isPresented: $widgetsPresented) {
            NativeWidgetSetupView(session: webSession)
                .preferredColorScheme(webSession.pageColorScheme)
        }
        .tint(Color(red: 54 / 255, green: 104 / 255, blue: 211 / 255))
        .safeAreaInset(edge: .top, spacing: 0) {
            NativeTopBar(
                selectedTab: shell.selectedTab,
                session: webSession,
                onHome: { shell.userSelected(.home) },
                onRefresh: { webSession.retry() },
                onProfile: {
                    shell.openWeb(path: webSession.isLoggedIn ? "/profile" : "/login", tab: .profile)
                },
                onMenu: { webSession.openWebMenu() }
            )
        }
        // The native top bar owns the appearance control, so its choice drives
        // the whole shell, including the native timetable and the tab bar.
        .preferredColorScheme(webSession.pageColorScheme)
    }

    private var selection: Binding<ShellTab> {
        Binding(
            get: { shell.selectedTab },
            set: { shell.userSelected($0) }
        )
    }
}

private struct NativeTopBar: View {
    let selectedTab: ShellTab
    @ObservedObject var session: HybridWebViewStore
    let onHome: () -> Void
    let onRefresh: () -> Void
    let onProfile: () -> Void
    let onMenu: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onHome) {
                Image(systemName: "house")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .foregroundStyle(selectedTab == .home ? Color.accentColor : .primary)
            .accessibilityLabel("首页")

            Text(selectedTab.label)
                .font(.headline)
                .lineLimit(1)

            Spacer(minLength: 8)

            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("刷新页面")

            Button {
                session.cycleAppearanceMode()
            } label: {
                Image(systemName: session.appearanceIconName)
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("外观：\(session.appearanceModeLabel)")

            Button(action: onProfile) {
                Image(systemName: session.isLoggedIn ? "person.crop.circle.fill" : "person.crop.circle")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(session.isLoggedIn ? "我的" : "登录")

            Button(action: onMenu) {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("更多")
        }
        .padding(.horizontal, 12)
        .frame(height: 52)
        .background(.bar)
        .overlay(alignment: .bottom) {
            Divider()
        }
    }
}

private struct WebTabScreen: View {
    @ObservedObject var session: HybridWebViewStore
    let tab: ShellTab
    let isActive: Bool

    var body: some View {
        ZStack {
            HybridWebView(session: session, tab: tab, isActive: isActive)
                .ignoresSafeArea(.container, edges: [.bottom])
            if let message = session.errorMessage {
                ContentUnavailableView {
                    Label("页面无法打开", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("重试", action: session.retry).buttonStyle(.borderedProminent)
                }
                .background(Color(uiColor: .systemBackground))
            }
        }
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .overlay(alignment: .top) {
            if session.isLoading { ProgressView().padding(8) }
        }
    }
}

#Preview {
    ContentView()
}
