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
    @State private var appeared = false

    var body: some View {
        ZStack {
            Color(uiColor: .systemGroupedBackground).ignoresSafeArea()
            VStack(spacing: 18) {
                Image("CPULogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .shadow(color: Color.black.opacity(0.12), radius: 18, y: 8)
                    .scaleEffect(appeared ? 1 : 0.84)
                    .opacity(appeared ? 1 : 0)
                VStack(spacing: 5) {
                    Text("药大拾间")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Color(red: 15 / 255, green: 143 / 255, blue: 127 / 255))
                    Text("CPU 校园互助服务")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .opacity(appeared ? 1 : 0)
                ProgressView()
                    .controlSize(.small)
                    .tint(Color(red: 15 / 255, green: 143 / 255, blue: 127 / 255))
                    .opacity(appeared ? 1 : 0)
            }
        }
        .task {
            withAnimation(.easeOut(duration: 0.45)) { appeared = true }
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
    @State private var quickEntryPresented = false

    var body: some View {
        VStack(spacing: 0) {
            if shell.selectedTab != .schedule {
                NativeTopBar(
                    session: webSession,
                    onHome: { shell.userSelected(.home) },
                    onRefresh: { webSession.retry() },
                    onMenu: { quickEntryPresented = true }
                )
            }
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
                onLogin: { shell.openWeb(path: "/login", tab: .profile) },
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
        }
        .sheet(isPresented: $widgetsPresented) {
            NativeWidgetSetupView(session: webSession)
                .preferredColorScheme(webSession.pageColorScheme)
        }
        .sheet(isPresented: $quickEntryPresented) {
            quickEntrySheetContent()
        }
        .tint(Color(red: 15 / 255, green: 143 / 255, blue: 127 / 255))
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

    @ViewBuilder
    private func quickEntrySheetContent() -> some View {
        let quickEntry = NativeQuickEntryView(session: webSession) { path, tab in
            quickEntryPresented = false
            if let tab { shell.userSelected(tab) }
            if let path { shell.openWeb(path: path, tab: tab ?? .home) }
        }

        // A ScrollView has no useful intrinsic height for a fitted sheet, so
        // explicitly size the native drawer from the amount of content it
        // actually contains. Logged-in users get room for the account row;
        // guests keep the shorter variant. The scroll view remains available
        // for Dynamic Type and smaller devices.
        quickEntry
            .presentationDetents([.height(webSession.isLoggedIn ? 460 : 400)])
            .presentationDragIndicator(.visible)
            .preferredColorScheme(webSession.pageColorScheme)
    }
}

private struct NativeQuickEntryView: View {
    @ObservedObject var session: HybridWebViewStore
    let onOpen: (String?, ShellTab?) -> Void
    private let entries: [(String, String, String?, ShellTab?)] = [
        ("square.and.pencil", "发帖", "/post", .home), ("envelope", "消息", "/messages", .profile),
        ("arrow.down.circle", "客户端下载", "/download", .services), ("bubble.left.and.bubble.right", "校园论坛", "/forum", .home),
        ("bell", "校园公告", "/announcements", .home), ("book.closed", "教务数据", "/jwxt", .academic),
        ("calendar", "课表", nil, .schedule), ("wrench.and.screwdriver", "校园服务", "/services", .services),
        ("bag", "二手交流", "/market", .home), ("sparkles", "拾间AI", "/search", .home), ("arrow.clockwise", "刷新页面", nil, nil)
    ]
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // Web's bottom drawer uses one compact grid. Keeping the
                    // same grouping avoids three redundant section headers and
                    // lets the sheet size itself to the actual content.
                    quickGrid(entries: entries[...])
                    VStack(alignment: .leading, spacing: 10) {
                        Text("外观").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        HStack(spacing: 6) {
                            ForEach([("跟随系统", "circle.lefthalf.filled", "system"), ("浅色", "sun.max", "light"), ("深色", "moon", "dark")], id: \.2) { item in
                                Button { session.setAppearanceMode(item.2) } label: {
                                    Label(item.0, systemImage: item.1).font(.caption.weight(.medium)).lineLimit(1)
                                        .minimumScaleFactor(0.7).frame(maxWidth: .infinity, minHeight: 34)
                                        .background(session.appearanceMode == item.2 ? Color.accentColor.opacity(0.18) : Color.primary.opacity(0.05)).clipShape(Capsule())
                                }.buttonStyle(.plain).foregroundStyle(session.appearanceMode == item.2 ? Color.accentColor : .secondary)
                            }
                        }
                    }
                    if session.isLoggedIn {
                        HStack(spacing: 12) {
                            Image(systemName: "person.crop.circle.fill").font(.system(size: 30)).foregroundStyle(Color.accentColor)
                            VStack(alignment: .leading, spacing: 2) { Text("个人中心").font(.subheadline.weight(.semibold)); Text("管理账号与资料").font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            Button("进入") { onOpen("/profile", .profile) }.font(.caption.weight(.semibold)).buttonStyle(.borderedProminent)
                        }.padding(12).background(Color.primary.opacity(0.045)).clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                }.padding(18)
            }.scrollIndicators(.hidden).navigationTitle("快捷入口").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("完成") { onOpen(nil, nil) } } }
        }
    }

    @ViewBuilder
    private func quickGrid(entries: ArraySlice<(String, String, String?, ShellTab?)>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    Button { entry.1 == "刷新页面" ? session.retry() : onOpen(entry.2, entry.3) } label: {
                        VStack(spacing: 4) {
                            Image(systemName: entry.0)
                                .font(.system(size: 20, weight: .semibold))
                                .frame(width: 22, height: 22)
                            Text(entry.1)
                                .font(.caption.weight(.medium))
                                .lineLimit(1)
                                .minimumScaleFactor(0.72)
                        }
                        .foregroundStyle(Color.accentColor)
                        .frame(maxWidth: .infinity, minHeight: 62)
                        .background(Color(uiColor: .systemBackground))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(Color(uiColor: .separator).opacity(0.45), lineWidth: 1)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }.buttonStyle(.plain)
                }
            }
        }
    }
}

private struct NativeTopBar: View {
    @ObservedObject var session: HybridWebViewStore
    let onHome: () -> Void
    let onRefresh: () -> Void
    let onMenu: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button(action: onHome) {
                HStack(spacing: 9) {
                    Image("CPULogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 32, height: 32)
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    Text("药大拾间")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(Color(red: 15 / 255, green: 143 / 255, blue: 127 / 255))
                        .lineLimit(1)
                }
                .frame(minHeight: 36)
            }
            .buttonStyle(.plain)
            .layoutPriority(2)
            .fixedSize(horizontal: true, vertical: false)
            .accessibilityLabel("首页")

            Spacer(minLength: 4)

            topBarIconButton(systemName: "arrow.clockwise", label: "刷新页面", action: onRefresh)

            topBarIconButton(
                systemName: session.appearanceIconName,
                label: "外观：\(session.appearanceModeLabel)"
            ) {
                session.cycleAppearanceMode()
            }

            topBarIconButton(systemName: "ellipsis.circle", label: "更多", action: onMenu)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 56)
        .padding(.vertical, 4)
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottom) {
            Divider()
        }
    }

    private func topBarIconButton(
        systemName: String,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .accessibilityLabel(label)
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
