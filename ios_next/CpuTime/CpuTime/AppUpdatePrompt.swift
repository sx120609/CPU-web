import Foundation
import UIKit

/// Tells the user when the App Store has a newer version than this one, with a
/// button that opens its App Store page. Users who turned off automatic updates
/// otherwise fall behind without noticing.
///
/// The alert shows over whatever is on screen (usually the native timetable,
/// where the Web page's own prompt would be hidden). Each version is announced
/// until the user answers it, then again every few days while it is still
/// missing. The server compares versions and caches the App Store lookup.
final class AppUpdatePrompt {
    static let shared = AppUpdatePrompt()

    /// Sent in the Web view's user agent so the page knows not to prompt as well.
    static var userAgentToken: String { "CPUWebIOSAppVersion/\(currentVersion)" }

    private static let endpoint = "https://cputime.cn/api/app-clients/ios/update"
    private static let fallbackStoreURL = "itms-apps://apps.apple.com/cn/app/id6811073406"
    private static let snoozedVersionKey = "cpu.appUpdate.snoozedVersion"
    private static let snoozedAtKey = "cpu.appUpdate.snoozedAt"
    private static let remindAfter: TimeInterval = 3 * 24 * 60 * 60
    private static let checkInterval: TimeInterval = 6 * 60 * 60
    private static let retryInterval: TimeInterval = 10 * 60
    private static let maxNotes = 5

    private struct Release {
        let version: String
        let notes: [String]
        let storeURL: URL
    }

    private var lastCheck: Date?
    private var checking = false
    private var observer: NSObjectProtocol?

    static var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }

    /// Checks on every return to the foreground, at most every few hours.
    func start() {
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { _ in
            Task { @MainActor in AppUpdatePrompt.shared.checkSoon() }
        }
    }

    private func checkSoon() {
        guard !checking else { return }
        if let lastCheck, Date().timeIntervalSince(lastCheck) < Self.checkInterval { return }
        checking = true
        lastCheck = Date()
        Task { @MainActor [weak self] in
            // Let launch, the welcome page and any sign-in settle first.
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            let release = await Self.fetchRelease()
            guard let self else { return }
            self.checking = false
            guard let release else {
                self.retrySoon()
                return
            }
            if !self.present(release) { self.retrySoon() }
        }
    }

    private func retrySoon() {
        lastCheck = Date().addingTimeInterval(Self.retryInterval - Self.checkInterval)
    }

    private static func fetchRelease() async -> Release? {
        guard var components = URLComponents(string: endpoint) else { return nil }
        components.queryItems = [URLQueryItem(name: "version", value: currentVersion)]
        guard let url = components.url else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("ios-app", forHTTPHeaderField: "X-CPU-Client")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let payload = root["data"] as? [String: Any],
              payload["updateAvailable"] as? Bool == true,
              let version = payload["latestVersion"] as? String, !version.isEmpty
        else { return nil }
        let notes = (payload["notes"] as? [Any] ?? []).compactMap { $0 as? String }.filter { !$0.isEmpty }
        let storeURL = URL(string: fallbackStoreURL)!
        return Release(version: version, notes: Array(notes.prefix(maxNotes)), storeURL: storeURL)
    }

    /// Returns false when nothing could be shown now, so the check runs again soon.
    private func present(_ release: Release) -> Bool {
        let defaults = UserDefaults.standard
        if defaults.string(forKey: Self.snoozedVersionKey) == release.version {
            let elapsed = Date().timeIntervalSince1970 - defaults.double(forKey: Self.snoozedAtKey)
            if elapsed >= 0 && elapsed < Self.remindAfter { return true }
        }
        guard UIApplication.shared.applicationState == .active, let presenter = Self.topViewController() else {
            return false
        }
        let message = release.notes.isEmpty
            ? "新版本已上架，建议更新以获得最新功能和修复。"
            : "更新内容：\n" + release.notes.map { "· \($0)" }.joined(separator: "\n")
        let alert = UIAlertController(
            title: "发现新版本 \(release.version)",
            message: message,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "稍后", style: .cancel) { _ in
            AppUpdatePrompt.snooze(release.version)
        })
        let update = UIAlertAction(title: "前往 App Store 更新", style: .default) { _ in
            AppUpdatePrompt.snooze(release.version)
            UIApplication.shared.open(release.storeURL, options: [:], completionHandler: nil)
        }
        alert.addAction(update)
        alert.preferredAction = update
        presenter.present(alert, animated: true)
        return true
    }

    private static func snooze(_ version: String) {
        UserDefaults.standard.set(version, forKey: snoozedVersionKey)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: snoozedAtKey)
    }

    /// The controller on top of the active window, unless another alert is already up.
    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) else { return nil }
        let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        if top is UIAlertController || top?.isBeingDismissed == true { return nil }
        return top
    }
}
