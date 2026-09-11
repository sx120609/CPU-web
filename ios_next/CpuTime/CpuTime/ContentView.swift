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
        NativeShellView(
            webSession: webSession,
            scheduleStore: scheduleStore,
            shell: shell
        )
        .task(id: scheduleStore.lastUpdatedAt) {
            guard scheduleStore.result != nil else { return }
            await webSession.ensureScheduleWidgetConfigured()
        }
        .onOpenURL { url in
            shell.connect(webSession: webSession, scheduleStore: scheduleStore)
            guard url.scheme == "cputime-next", url.host == "schedule" else { return }
            scheduleStore.selectedSemester = ""
            scheduleStore.selectedWeek = ""
            shell.userSelected(.schedule)
            if webSession.bridgeReady { Task { await scheduleStore.load(semester: "", week: "", force: true) } }
        }
        .onAppear {
            shell.connect(webSession: webSession, scheduleStore: scheduleStore)
        }
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
        // The Web top bar owns the light/dark switch, so its choice drives the
        // whole shell, including the native timetable and the tab bar.
        .preferredColorScheme(webSession.pageColorScheme)
    }

    private var selection: Binding<ShellTab> {
        Binding(
            get: { shell.selectedTab },
            set: { shell.userSelected($0) }
        )
    }
}

private struct WebTabScreen: View {
    @ObservedObject var session: HybridWebViewStore
    let tab: ShellTab
    let isActive: Bool

    var body: some View {
        ZStack {
            HybridWebView(session: session, tab: tab, isActive: isActive)
                .ignoresSafeArea(.container, edges: [.top, .bottom])
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
