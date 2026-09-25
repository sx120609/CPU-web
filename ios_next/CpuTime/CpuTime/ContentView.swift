import Combine
import SwiftUI
import UIKit

extension Color {
    /// Keep native controls aligned with the Web brand instead of relying on
    /// the system blue accent that a presented sheet may inherit.
    static var cpuBrand: Color { Color(red: 15 / 255, green: 143 / 255, blue: 127 / 255) }
}

@main
struct CpuTimeApp: App {
    @UIApplicationDelegateAdaptor(CpuTimeAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

final class CpuTimeAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // BGTaskScheduler raises if a handler is registered after launch
        // finishes; SwiftUI's first onAppear is too late on iOS 18.
        if #available(iOS 17.0, *) {
            LiveActivityBackgroundRefresh.shared.register()
        }
        // Subscribe early: MetricKit delivers pending crash reports at launch.
        ClientDiagnosticsCollector.shared.start()
        return true
    }
}

struct ContentView: View {
    @StateObject private var webSession = HybridWebViewStore()
    @StateObject private var scheduleStore: NativeScheduleStore
    @StateObject private var shell = NativeShellCoordinator()
    @StateObject private var watchSchedule = PhoneWatchScheduleStore()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("CPUHasSeenWelcomeV3") private var hasSeenWelcome = false
    private let debugMockSchedule: Bool

    init() {
#if DEBUG
        let useMockSchedule = ProcessInfo.processInfo.environment["CPU_DEBUG_MOCK_SCHEDULE"] == "1"
        self.debugMockSchedule = useMockSchedule
        if useMockSchedule {
            _scheduleStore = StateObject(wrappedValue: NativeScheduleStore(
                loader: { _ in NativeScheduleDebugFixture.snapshot },
                archive: nil
            ))
        } else {
            _scheduleStore = StateObject(wrappedValue: NativeScheduleStore())
        }
#else
        self.debugMockSchedule = false
        _scheduleStore = StateObject(wrappedValue: NativeScheduleStore())
#endif
    }

    var body: some View {
        rootView
            .onOpenURL { url in
                // A deep link can arrive before the first SwiftUI frame. Keep
                // WebKit startup on the next run-loop turn so it cannot block
                // the launch surface, then replay the link against the shared
                // session once it exists.
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 50_000_000)
                    guard !Task.isCancelled else { return }
                    shell.connect(webSession: webSession, scheduleStore: scheduleStore)
                    watchSchedule.connect(to: scheduleStore)
                    NativeWidgetLocalSchedule.connect(to: scheduleStore)
                    guard url.scheme == "cputime-next", url.host == "schedule" else { return }
                    guard !shell.requiresLogin else { return }
                    shell.userSelected(.schedule)
                    let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
                    var values: [String: String] = [:]
                    for item in query {
                        if let value = item.value { values[item.name] = value }
                    }
                    let semester = (values["semester"] ?? values["widgetSemester"])
                        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                        .flatMap { $0.isEmpty ? nil : $0 }
                    let rawWeek = (values["week"] ?? values["widgetWeek"])
                        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    let week: String? = {
                        guard let rawWeek, rawWeek != "current", !rawWeek.isEmpty else { return nil }
                        return rawWeek
                    }()
                    if webSession.bridgeReady {
                        await scheduleStore.load(semester: semester, week: week, force: false)
                    }
                }
            }
            .onAppear {
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
            .task(id: hasSeenWelcome) {
                guard !debugMockSchedule, hasSeenWelcome else { return }
                // Let SwiftUI commit the waiting page before constructing
                // WKWebView. Creating a WebKit process is synchronous on the
                // main actor and can otherwise leave a cold launch blank.
                try? await Task.sleep(nanoseconds: 50_000_000)
                guard !Task.isCancelled else { return }
                shell.connect(webSession: webSession, scheduleStore: scheduleStore)
                watchSchedule.connect(to: scheduleStore)
                NativeWidgetLocalSchedule.connect(to: scheduleStore)
                await shell.resolveInitialAuth(webSession: webSession)
                IosClientHeartbeat.shared.report()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    watchSchedule.foreground()
                    IosClientHeartbeat.shared.report()
                    NativeLiveActivityController.shared.foreground()
                    if #available(iOS 17.2, *) { LiveActivityPushService.shared.activate() }
                }
            }
    }

    /// The login gate is a root-view swap, not a hidden tab bar: while it is
    /// up the native TabView is never built, so there is no tab to escape
    /// through. Until the launch session probe answers, a neutral waiting
    /// surface keeps the tab bar from flashing first.
    @ViewBuilder
    private var rootView: some View {
        if debugMockSchedule {
            NativeScheduleView(store: scheduleStore)
                .task {
                    guard scheduleStore.result == nil else { return }
                    await scheduleStore.load(semester: "2026-2027-1", week: "1")
                }
        } else if !hasSeenWelcome {
            WelcomeView {
                withAnimation(.easeInOut(duration: 0.28)) {
                    hasSeenWelcome = true
                }
            }
        } else if shell.requiresLogin {
            LoginGateView(webSession: webSession)
        } else if !shell.isAuthResolved && scheduleStore.result == nil {
            LaunchWaitingView()
        } else {
            NativeShellView(
                webSession: webSession,
                scheduleStore: scheduleStore,
                shell: shell,
                watchSchedule: watchSchedule
            )
        }
    }
}

#if DEBUG
/// A local, authenticated fixture used only with the `CPU_DEBUG_MOCK_SCHEDULE=1`
/// launch argument. It lets the simulator exercise empty cells, long room names
/// and the Live Activity layout without depending on a live education session.
private enum NativeScheduleDebugFixture {
    static let semester = "2026-2027-1"

    static var snapshot: NativeScheduleSnapshot {
        let semesters = [NativeScheduleSemester(value: semester, label: "2026-2027 学年第一学期", current: true)]
        let weeks = [NativeScheduleWeek(value: "1", label: "第 1 周", current: true)]
        var calendarValue = Calendar(identifier: .gregorian)
        calendarValue.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        calendarValue.firstWeekday = 2
        let today = calendarValue.startOfDay(for: .now)
        let weekday = calendarValue.component(.weekday, from: today)
        let mondayOffset = weekday == 1 ? -6 : 2 - weekday
        let monday = calendarValue.date(byAdding: .day, value: mondayOffset, to: today) ?? today
        let dateFormatter = DateFormatter()
        dateFormatter.calendar = calendarValue
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.timeZone = calendarValue.timeZone
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let days = (0..<7).compactMap { offset in
            calendarValue.date(byAdding: .day, value: offset, to: monday).map(dateFormatter.string(from:))
        }
        let now = Date.now
        let liveStart = now.addingTimeInterval(-15 * 60)
        let liveEnd = now.addingTimeInterval(45 * 60)
        let nextStart = now.addingTimeInterval(70 * 60)
        let nextEnd = now.addingTimeInterval(130 * 60)
        let timeFormatter = DateFormatter()
        timeFormatter.calendar = calendarValue
        timeFormatter.locale = Locale(identifier: "en_US_POSIX")
        timeFormatter.timeZone = calendarValue.timeZone
        timeFormatter.dateFormat = "HH:mm"
        let periods = NativeSchedulePeriod.bundledTimetable.enumerated().map { index, period in
            switch index {
            case 0: return NativeSchedulePeriod(number: period.number, startTime: timeFormatter.string(from: liveStart), endTime: timeFormatter.string(from: liveEnd))
            case 1: return NativeSchedulePeriod(number: period.number, startTime: timeFormatter.string(from: liveEnd), endTime: timeFormatter.string(from: liveEnd))
            case 2: return NativeSchedulePeriod(number: period.number, startTime: timeFormatter.string(from: nextStart), endTime: timeFormatter.string(from: nextEnd))
            default: return period
            }
        }
        let todayColumn = max(1, weekday == 1 ? 7 : weekday - 1)
        let calendar = NativeScheduleCalendar(
            source: .jwxt,
            semesters: semesters,
            currentSemester: semester,
            currentWeek: 1,
            semesterStart: days[0],
            semesterEnd: days[6],
            weeks: [NativeCalendarWeek(week: 1, days: days, monday: days[0], sunday: days[6])]
        )
        let cells = [
            NativeScheduleCell(day: todayColumn, bigSlot: 1, courses: [
                NativeScheduleCourse(
                    nativeId: "source:debug-english",
                    name: "英语 III",
                    teacher: "李老师",
                    weeks: "第 1 周",
                    weekList: [1],
                    location: "艺术固定教室 YS403",
                    startSlot: 1,
                    endSlot: 2,
                    sourceKey: "jwxt|2|1|2|英语III|李老师|艺术固定教室YS403|第1周"
                ),
            ]),
            NativeScheduleCell(day: todayColumn, bigSlot: 2, courses: [
                NativeScheduleCourse(
                    nativeId: "source:debug-next",
                    name: "药理学实验与实践",
                    teacher: "王老师",
                    weeks: "第 1 周",
                    weekList: [1],
                    location: "药学楼 302",
                    startSlot: 3,
                    endSlot: 3,
                    sourceKey: "jwxt|2|3|3|药理学实验与实践|王老师|药学楼302|第1周"
                ),
            ]),
            NativeScheduleCell(day: 4, bigSlot: 3, courses: [
                NativeScheduleCourse(
                    nativeId: "source:debug-lab",
                    name: "药理学实验与实践",
                    teacher: "王老师",
                    weeks: "第 1 周",
                    weekList: [1],
                    location: "药学楼 302",
                    startSlot: 5,
                    endSlot: 6,
                    sourceKey: "jwxt|4|5|6|药理学实验与实践|王老师|药学楼302|第1周"
                ),
            ]),
        ]
        let result = NativeScheduleResult(
            source: .jwxt,
            semesters: semesters,
            weeks: weeks,
            currentSemester: semester,
            currentWeek: "1",
            cells: cells
        )
        return NativeScheduleSnapshot(
            completeSemester: true,
            source: .jwxt,
            fetchedAt: .now,
            periods: periods,
            data: result,
            calendar: calendar,
            auth: NativeScheduleAuth(authenticated: true, identity: "debug", account: "debug")
        )
    }
}
#endif

/// A one-time first-run surface that gives the user a clear entry point before
/// the shared web session decides whether login is required.
private struct WelcomeView: View {
    let onContinue: () -> Void
    @State private var appeared = false

    var body: some View {
        ZStack {
            Color(uiColor: .systemGroupedBackground).ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer(minLength: 48)
                Image("CPULogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 112, height: 112)
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .shadow(color: .black.opacity(0.14), radius: 24, y: 12)
                    .scaleEffect(appeared ? 1 : 0.86)
                    .opacity(appeared ? 1 : 0)
                VStack(spacing: 9) {
                    Text("药大拾间")
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.cpuBrand)
                    Text("你的校园信息助手")
                        .font(.title3.weight(.medium))
                        .foregroundStyle(.primary)
                    Text("登录后即可同步课表、成绩和校园服务")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 24)
                .opacity(appeared ? 1 : 0)
                Spacer()
                Button(action: onContinue) {
                    Label("开始使用", systemImage: "arrow.right")
                        .font(.headline.weight(.semibold))
                        .padding(.horizontal, 22)
                        .frame(minHeight: 46)
                }
                .buttonStyle(.borderedProminent)
                .tint(.cpuBrand)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.bottom, 12)
                HStack(spacing: 6) {
                    Image("CPULogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 16, height: 16)
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                    Text("药大拾间")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .padding(.bottom, 16)
                .opacity(appeared ? 1 : 0)
            }
        }
        .task {
            withAnimation(.easeOut(duration: 0.45)) { appeared = true }
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
                    Text("校园服务正在准备")
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

private enum NativeLoginMode: String, CaseIterable, Identifiable {
    case school
    case account

    var id: String { rawValue }

    var title: String {
        switch self {
        case .school: return "统一认证"
        case .account: return "站内账号"
        }
    }
}

private enum NativeLoginFieldKind: Hashable {
    case username
    case password
    case captcha
}

/// A native login surface with no escape route. A one-pixel WebView remains
/// mounted behind it so the existing Web auth store can perform the SSO
/// handshake and set the shared HttpOnly session cookie.
private struct LoginGateView: View {
    @ObservedObject var webSession: HybridWebViewStore

    @State private var mode: NativeLoginMode = .school
    @State private var accountLoginUnlocked = false
    @State private var username = ""
    @State private var password = ""
    @State private var captcha = ""
    @State private var captchaImage = ""
    @State private var needCaptcha = false
    @State private var remember = true
    @State private var privacyAccepted = false
    @State private var isLoading = false
    @State private var isPreparing = true
    @State private var errorMessage = ""
    @State private var statusMessage = ""
    @FocusState private var focusedField: NativeLoginFieldKind?

    var body: some View {
        ZStack {
            HybridWebView(session: webSession, tab: .profile, isActive: true)
                .frame(width: 1, height: 1)
                .opacity(0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)

            Color(uiColor: .systemGroupedBackground)
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    if accountLoginUnlocked {
                        modePicker
                    }
                    form
                }
                .frame(maxWidth: 430)
                .padding(.horizontal, 24)
                .padding(.vertical, 28)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .task { await prepareSchoolLogin() }
        .onChange(of: mode) { _, next in
            errorMessage = ""
            statusMessage = ""
            isPreparing = next == .school && !webSession.bridgeReady
            if next == .school && captchaImage.isEmpty && !isLoading {
                Task { await prepareSchoolLogin() }
            }
        }
        .preferredColorScheme(webSession.pageColorScheme)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image("CPULogo")
                .resizable()
                .scaledToFit()
                .frame(width: 58, height: 58)
                .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 16, y: 8)
                .contentShape(Rectangle())
                .onLongPressGesture(minimumDuration: 1.0, maximumDistance: 24) {
                    withAnimation(.easeOut(duration: 0.2)) {
                        accountLoginUnlocked = true
                    }
                }

            VStack(alignment: .leading, spacing: 7) {
                Text("欢迎回来")
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundStyle(.primary)
                Text("登录药大拾间，继续查看你的校园信息")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.bottom, 28)
    }

    private var modePicker: some View {
        Picker("登录方式", selection: $mode) {
            ForEach(NativeLoginMode.allCases) { option in
                Text(option.title).tag(option)
            }
        }
        .pickerStyle(.segmented)
        .tint(.cpuBrand)
        .padding(.bottom, 24)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            NativeLoginField(
                systemImage: "person",
                placeholder: mode == .school ? "学号 / 工号" : "用户名",
                text: $username,
                isSecure: false,
                focusedField: $focusedField,
                field: .username,
                disabled: isLoading
            )

            NativeLoginField(
                systemImage: "lock",
                placeholder: "密码",
                text: $password,
                isSecure: true,
                focusedField: $focusedField,
                field: .password,
                disabled: isLoading
            )

            if mode == .school && needCaptcha {
                HStack(spacing: 10) {
                    NativeLoginField(
                        systemImage: "number",
                        placeholder: "验证码",
                        text: $captcha,
                        isSecure: false,
                        focusedField: $focusedField,
                        field: .captcha,
                        disabled: isLoading
                    )
                    .frame(maxWidth: .infinity)

                    Button {
                        Task { await prepareSchoolLogin() }
                    } label: {
                        NativeCaptchaImage(source: captchaImage)
                            .frame(width: 112, height: 48)
                    }
                    .buttonStyle(.plain)
                    .disabled(isLoading)
                    .accessibilityLabel("刷新验证码")
                }
            }

            Toggle(isOn: $remember) {
                Text("保持登录状态")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .tint(.cpuBrand)
            .padding(.top, 2)

            consent

            Button(action: submit) {
                HStack(spacing: 8) {
                    if isLoading { ProgressView().tint(.white) }
                    Text(isPreparing ? "准备登录…" : (mode == .school ? "登录并继续" : "登录"))
                        .font(.headline.weight(.semibold))
                }
                .padding(.horizontal, 24)
                .frame(minHeight: 46)
            }
            .buttonStyle(.borderedProminent)
            .tint(.cpuBrand)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .frame(maxWidth: .infinity)
            .disabled(isLoading || isPreparing || !privacyAccepted)

            if !errorMessage.isEmpty {
                Label(errorMessage, systemImage: "exclamationmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !statusMessage.isEmpty {
                Label(statusMessage, systemImage: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.green)
            }
        }
    }

    private var consent: some View {
        HStack(alignment: .top, spacing: 10) {
            Button {
                privacyAccepted.toggle()
            } label: {
                Image(systemName: privacyAccepted ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(privacyAccepted ? Color.cpuBrand : .secondary)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(privacyAccepted ? "已同意隐私政策和用户协议" : "同意隐私政策和用户协议")

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 0) {
                    Text("我已阅读并同意 ")
                    policyLink("《隐私政策》", path: "/privacy.html")
                    Text(" 和 ")
                    policyLink("《用户协议》", path: "/terms.html")
                }
                .font(.footnote)
                .fixedSize(horizontal: false, vertical: true)

                Text("登录后，应用会根据你的授权同步课表和校园服务数据。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .foregroundStyle(.secondary)
        .padding(.top, 4)
    }

    private func policyLink(_ title: String, path: String) -> some View {
        Button(title) {
            guard let url = IOSNextWebConfiguration.routeURL(path) else { return }
            UIApplication.shared.open(url)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.cpuBrand)
        .underline()
    }

    private func prepareSchoolLogin() async {
        guard mode == .school, !isLoading else { return }
        isPreparing = true
        errorMessage = ""
        statusMessage = ""
        // The login method probe below also waits for a cold WebView. The
        // navigation-ready flag can be cleared by the /login route transition
        // even though the injected auth methods are already available.
        let response = await webSession.nativeLoginBegin()
        guard mode == .school else { return }
        needCaptcha = response.needCaptcha
        captchaImage = response.captchaImage
        if !response.ok && !response.error.isEmpty { errorMessage = response.error }
        isPreparing = false
    }

    private func submit() {
        guard !isLoading else { return }
        let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedUsername.isEmpty else {
            errorMessage = mode == .school ? "请输入学号或工号" : "请输入用户名"
            focusedField = .username
            return
        }
        guard !password.isEmpty else {
            errorMessage = "请输入密码"
            focusedField = .password
            return
        }
        if mode == .school && needCaptcha && captcha.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errorMessage = "请输入验证码"
            focusedField = .captcha
            return
        }
        errorMessage = ""
        statusMessage = ""
        isLoading = true
        let submittedMode = mode
        Task {
            let response: NativeLoginResponse
            if submittedMode == .school {
                response = await webSession.nativeSsoLogin(
                    username: trimmedUsername,
                    password: password,
                    captcha: captcha.trimmingCharacters(in: .whitespacesAndNewlines),
                    remember: remember
                )
            } else {
                response = await webSession.nativeAccountLogin(username: trimmedUsername, password: password)
            }
            guard submittedMode == mode else { return }
            await MainActor.run {
                isLoading = false
                if response.ok {
                    password = ""
                    captcha = ""
                    statusMessage = "登录成功，正在进入药大拾间…"
                } else {
                    needCaptcha = response.needCaptcha
                    captchaImage = response.captchaImage
                    errorMessage = response.error
                }
            }
        }
    }
}

private struct NativeLoginField: View {
    let systemImage: String
    let placeholder: String
    @Binding var text: String
    let isSecure: Bool
    let focusedField: FocusState<NativeLoginFieldKind?>.Binding
    let field: NativeLoginFieldKind
    let disabled: Bool

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 20)
            if isSecure {
                SecureField(placeholder, text: $text)
                    .focused(focusedField, equals: field)
                    .textContentType(.password)
            } else {
                TextField(placeholder, text: $text)
                    .focused(focusedField, equals: field)
                    .textContentType(field == .username ? .username : .oneTimeCode)
                    .keyboardType(.default)
            }
        }
        .font(.body)
        .padding(.horizontal, 15)
        .frame(minHeight: 52)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .overlay {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(focusedField.wrappedValue == field ? Color.cpuBrand : Color.clear, lineWidth: 1.5)
        }
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .opacity(disabled ? 0.65 : 1)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .disabled(disabled)
    }
}

private struct NativeCaptchaImage: View {
    let source: String

    var body: some View {
        Group {
            if let image = dataImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if let url = URL(string: source), !source.isEmpty {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                    else { placeholder }
                }
            } else {
                placeholder
            }
        }
        .clipped()
        .background(Color(uiColor: .tertiarySystemFill))
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.primary.opacity(0.12), lineWidth: 1)
        }
    }

    private var placeholder: some View {
        Image(systemName: "arrow.clockwise")
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var dataImage: UIImage? {
        guard source.hasPrefix("data:"), let comma = source.firstIndex(of: ",") else { return nil }
        let payload = String(source[source.index(after: comma)...])
        guard let data = Data(base64Encoded: payload, options: [.ignoreUnknownCharacters]) else { return nil }
        return UIImage(data: data)
    }
}


struct NativeShellView: View {
    @ObservedObject var webSession: HybridWebViewStore
    @ObservedObject var scheduleStore: NativeScheduleStore
    @ObservedObject var shell: NativeShellCoordinator
    @ObservedObject var watchSchedule: PhoneWatchScheduleStore
    @State private var deviceSettingsPresented = false
    @State private var nativeOverlayPresented = false
    @State private var nativeOverlayMode: NativeShellOverlay = .quickEntry
    @State private var quickEntryOpening = false
    @State private var quickEntryContentHeight: CGFloat = 0

    var body: some View {
        VStack(spacing: 0) {
            if shell.selectedTab != .schedule && !NativePageChrome.usesPageNavigation(webSession.currentPath) {
                NativeTopBar(
                    session: webSession,
                    onHome: { shell.userSelected(.home) },
                    onRefresh: { webSession.refreshCurrentPage() },
                    onNotifications: { shell.openWeb(path: "/messages", tab: .profile) },
                    onMenu: {
                        guard !quickEntryOpening else { return }
                        quickEntryOpening = true
                        Task { @MainActor in
                            await webSession.refreshAuthCapability()
                            quickEntryOpening = false
                            quickEntryContentHeight = 0
                            nativeOverlayMode = .quickEntry
                            nativeOverlayPresented = true
                        }
                    }
                )
            }
            TabView(selection: selection) {
            WebTabScreen(
                session: webSession,
                tab: .home,
                isActive: shell.selectedTab == .home,
                showsNativePostButton: NativePageChrome.showsPostButton(webSession.currentPath),
                onNativePost: { shell.openWeb(path: "/post", tab: .home) }
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
                onDeviceSettings: { deviceSettingsPresented = true }
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
        .sheet(isPresented: $deviceSettingsPresented) {
            NativeDeviceSettingsView(session: webSession, watchStore: watchSchedule, scheduleStore: scheduleStore)
                .preferredColorScheme(webSession.pageColorScheme)
        }
        .sheet(isPresented: $nativeOverlayPresented) {
            switch nativeOverlayMode {
            case .quickEntry:
                quickEntrySheetContent()
            case .assistant:
                NativeAssistantView(session: webSession) { path in
                    nativeOverlayPresented = false
                    guard path != "/search" else { return }
                    shell.openWeb(path: path, tab: .home)
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
                .presentationCornerRadius(28)
                // Keep the AI surface opaque while WebKit is restoring its
                // route. A translucent sheet briefly revealed the underlying
                // page during streaming and looked like a flash.
                .presentationBackground(Color(uiColor: .systemBackground))
                .tint(.cpuBrand)
                .preferredColorScheme(webSession.pageColorScheme)
            }
        }
        .tint(.cpuBrand)
        // The native top bar owns the appearance control, so its choice drives
        // the whole shell, including the native timetable and the tab bar.
        .preferredColorScheme(webSession.pageColorScheme)
        .onAppear {
            webSession.onAssistantRequested = {
                nativeOverlayMode = .assistant
                nativeOverlayPresented = true
            }
        }
        .onDisappear {
            webSession.onAssistantRequested = nil
        }
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
            if path == "/search" {
                // Keep one presentation controller alive and swap its native
                // content. Changing a sheet item's identity can make UIKit
                // dismiss the menu instead of replacing its content.
                nativeOverlayMode = .assistant
                return
            }
            nativeOverlayPresented = false
            if let tab { shell.userSelected(tab) }
            if let path { shell.openWeb(path: path, tab: tab ?? .home) }
        }

        // Measure the actual drawer content so the system sheet opens at the
        // right height instead of clipping the last row behind a scroll view.
        // The large detent remains available as an accessibility escape hatch
        // for very large Dynamic Type settings.
        quickEntry
            .frame(maxWidth: .infinity)
            .onPreferenceChange(NativeQuickEntryHeightKey.self) { value in
                guard value > 0 else { return }
                quickEntryContentHeight = value
            }
            .presentationDetents([.height(quickEntryDetentHeight), .large])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(28)
            .presentationBackground(.regularMaterial)
            .tint(.cpuBrand)
            .preferredColorScheme(webSession.pageColorScheme)
    }

    private var quickEntryDetentHeight: CGFloat {
        let fallback: CGFloat = webSession.isLoggedIn ? 520 : 440
        let measured = quickEntryContentHeight > 0 ? quickEntryContentHeight + 68 : fallback
        return min(max(measured, 360), UIScreen.main.bounds.height * 0.86)
    }
}

private enum NativeShellOverlay: String, Identifiable {
    case quickEntry
    case assistant

    var id: String { rawValue }
}

private struct NativeQuickEntryView: View {
    @ObservedObject var session: HybridWebViewStore
    let onOpen: (String?, ShellTab?) -> Void
    private var entries: [(String, String, String?, ShellTab?)] {
        var values: [(String, String, String?, ShellTab?)] = [
            ("square.and.pencil", "发帖", "/post", .home), ("envelope", "消息", "/messages", .profile),
            ("arrow.down.circle", "客户端下载", "/download", .services), ("bubble.left.and.bubble.right", "校园论坛", "/forum", .home),
            ("bell", "校园公告", "/announcements", .home), ("book.closed", "教务数据", "/jwxt", .academic),
            ("calendar", "课表", nil, .schedule), ("wrench.and.screwdriver", "校园服务", "/services", .services),
            ("bag", "二手交流", "/market", .home), ("sparkles", "拾间AI", "/search", .home)
        ]
        if session.canAccessAdmin {
            // Keep the management entry in the first row, matching the Web
            // drawer's early account actions and keeping it visible on compact
            // sheet detents.
            values.insert(("lock.shield", "管理后台", "/admin", .profile), at: 2)
        }
        return values
    }
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                // Web's bottom drawer uses one compact grid. Keeping the
                // same grouping avoids redundant section headers and lets the
                // system sheet fit the full menu without a second scroll view.
                quickGrid(entries: entries[...])
                VStack(alignment: .leading, spacing: 10) {
                    Text("外观").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    HStack(spacing: 6) {
                        ForEach([("跟随系统", "circle.lefthalf.filled", "system"), ("浅色", "sun.max", "light"), ("深色", "moon", "dark")], id: \.2) { item in
                            Button { session.setAppearanceMode(item.2) } label: {
                                Label(item.0, systemImage: item.1).font(.caption.weight(.medium)).lineLimit(1)
                                    .minimumScaleFactor(0.7).frame(maxWidth: .infinity, minHeight: 34)
                                    .background(session.appearanceMode == item.2 ? Color.cpuBrand.opacity(0.18) : Color.primary.opacity(0.05)).clipShape(Capsule())
                            }.buttonStyle(.plain).foregroundStyle(session.appearanceMode == item.2 ? Color.cpuBrand : .secondary)
                        }
                    }
                }
                if session.isLoggedIn {
                    HStack(spacing: 12) {
                        Image(systemName: "person.crop.circle.fill").font(.system(size: 30)).foregroundStyle(Color.cpuBrand)
                        VStack(alignment: .leading, spacing: 2) { Text("个人中心").font(.subheadline.weight(.semibold)); Text("管理账号与资料").font(.caption).foregroundStyle(.secondary) }
                        Spacer()
                        Button("进入") { onOpen("/profile", .profile) }
                            .font(.caption.weight(.semibold))
                            .buttonStyle(.borderedProminent)
                            .tint(.cpuBrand)
                    }.padding(12).background(Color.primary.opacity(0.045)).clipShape(RoundedRectangle(cornerRadius: 14))
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(GeometryReader { proxy in
                Color.clear.preference(key: NativeQuickEntryHeightKey.self, value: proxy.size.height)
            })
            .navigationTitle("快捷入口")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { onOpen(nil, nil) }
                }
            }
        }
        // SwiftUI may keep a presented sheet's environment snapshot while its
        // parent changes color scheme. The identity follows the selected mode
        // so the menu repaints immediately after a tap.
        .id("quick-entry-\(session.appearanceMode)")
        .preferredColorScheme(session.pageColorScheme)
        .animation(.easeInOut(duration: 0.18), value: session.appearanceMode)
    }

    @ViewBuilder
    private func quickGrid(entries: ArraySlice<(String, String, String?, ShellTab?)>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    Button { onOpen(entry.2, entry.3) } label: {
                        VStack(spacing: 4) {
                            Image(systemName: entry.0)
                                .font(.system(size: 20, weight: .semibold))
                                .frame(width: 22, height: 22)
                            Text(entry.1)
                                .font(.caption.weight(.medium))
                                .lineLimit(1)
                                .minimumScaleFactor(0.72)
                        }
                        .foregroundStyle(Color.cpuBrand)
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

private struct NativeQuickEntryHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

private struct NativeTopBar: View {
    @ObservedObject var session: HybridWebViewStore
    let onHome: () -> Void
    let onRefresh: () -> Void
    let onNotifications: () -> Void
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

            topBarIconButton(
                systemName: session.appearanceIconName,
                label: "外观：\(session.appearanceModeLabel)"
            ) {
                session.cycleAppearanceMode()
            }

            topBarIconButton(systemName: "arrow.clockwise", label: "刷新页面", action: onRefresh)

            topBarIconButton(
                systemName: "bell",
                label: session.notificationButtonLabel,
                badge: session.unreadNotificationCount,
                action: onNotifications
            )

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
        badge: Int = 0,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: systemName)
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 36, height: 36)
                if badge > 0 {
                    Text(badge > 99 ? "99+" : String(badge))
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .padding(.horizontal, badge > 9 ? 3 : 0)
                        .frame(minWidth: 15, minHeight: 15)
                        .background(Color.red, in: Capsule())
                        .overlay(Capsule().stroke(Color(uiColor: .systemBackground), lineWidth: 1.5))
                        .offset(x: 5, y: -3)
                        .allowsHitTesting(false)
                }
            }
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
    var showsNativePostButton = false
    var onNativePost: (() -> Void)? = nil

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            HybridWebView(session: session, tab: tab, isActive: isActive)
                .ignoresSafeArea(.container, edges: [.bottom])
            if isActive, let unavailable = unavailableState {
                NativeServiceUnavailableView(
                    title: unavailable.title,
                    message: unavailable.message,
                    action: session.retry
                )
            }
            if isActive, tab == .home, unavailableState == nil, showsNativePostButton, let onNativePost {
                Button(action: onNativePost) {
                    Label("投稿", systemImage: "square.and.pencil")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.cpuBrand)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .background(.ultraThinMaterial)
                        .overlay {
                            Capsule().stroke(Color.cpuBrand.opacity(0.35), lineWidth: 1)
                        }
                        .clipShape(Capsule())
                        .shadow(color: .black.opacity(0.14), radius: 12, y: 5)
                }
                .buttonStyle(.plain)
                .padding(.trailing, 16)
                .padding(.bottom, 16)
                .transition(.opacity.combined(with: .scale(scale: 0.94)))
                .accessibilityLabel("投稿")
            }
        }
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .overlay(alignment: .top) {
            if isActive, session.isLoading { ProgressView().padding(8) }
        }
        .toolbar(NativePageChrome.usesPageNavigation(session.currentPath) ? .hidden : .visible, for: .tabBar)
    }

    private var unavailableState: (title: String, message: String)? {
        if session.isNetworkUnavailable {
            return ("当前没有网络连接", "请检查 Wi‑Fi 或切换蜂窝网络后重试。")
        }
        if let message = session.serviceUnavailableMessage, !message.isEmpty {
            return ("服务暂时不可用", message)
        }
        if let message = session.errorMessage, !message.isEmpty {
            return ("服务暂时不可用", message)
        }
        return nil
    }
}

private struct NativeServiceUnavailableView: View {
    let title: String
    let message: String
    let action: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Color.cpuBrand)
            Text(title)
                .font(.title3.weight(.semibold))
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("重试", action: action)
                .buttonStyle(.borderedProminent)
                .tint(.cpuBrand)
                .padding(.top, 2)
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
    }
}

#Preview {
    ContentView()
}
