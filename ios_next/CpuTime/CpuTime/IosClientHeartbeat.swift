import ActivityKit
import Foundation
import UIKit
import UserNotifications
import WatchConnectivity
import WidgetKit

/// Reports the device model, iOS version, client version and feature state
/// (widgets, Live Activities, notifications, Apple Watch) to the admin
/// statistics, then uploads any queued MetricKit diagnostics. The install id
/// is a random UUID kept in UserDefaults, not the IDFA or IDFV, and failures
/// are silent: statistics must never affect the app.
@MainActor
final class IosClientHeartbeat {
    static let shared = IosClientHeartbeat()

    typealias Request = (String, String, [String: Any]?) async throws -> Data

    private static let installKey = "cpu.clientStats.installId"
    private static let lastReportKey = "cpu.clientStats.lastReport"
    private static let lastStateKey = "cpu.clientStats.lastState"
    /// Foreground returns within this window are not reported again unless
    /// something reported has changed.
    private static let foregroundInterval: TimeInterval = 30 * 60
    /// Sign-ins are always reported so the install links to the account, but
    /// never more than once a minute.
    private static let forcedInterval: TimeInterval = 60

    private let defaults = UserDefaults.standard
    private var apiRequest: Request?
    private var task: Task<Void, Never>?

    func setAPIRequest(_ request: @escaping Request) { apiRequest = request }

    /// `force` marks an account change; plain foreground calls are throttled.
    func report(force: Bool = false) {
        guard task == nil, let apiRequest else { return }
        let installId = self.installId
        task = Task { [weak self] in
            defer { self?.task = nil }
            guard let self else { return }
            let body = await Self.payload(installId: installId)
            let state = Self.stateSignature(body)
            let elapsed = Date().timeIntervalSince1970 - defaults.double(forKey: Self.lastReportKey)
            let changed = defaults.string(forKey: Self.lastStateKey) != state
            if changed || elapsed >= (force ? Self.forcedInterval : Self.foregroundInterval) {
                do {
                    _ = try await apiRequest("/api/app-clients/ios/heartbeat", "POST", body)
                    defaults.set(Date().timeIntervalSince1970, forKey: Self.lastReportKey)
                    defaults.set(state, forKey: Self.lastStateKey)
                } catch {
                    // Retried on the next foreground or sign-in.
                }
            }
            await ClientDiagnosticsCollector.shared.flush(
                installId: installId,
                deviceModel: Self.deviceModel,
                systemVersion: UIDevice.current.systemVersion,
                using: apiRequest
            )
        }
    }

    private var installId: String {
        if let value = defaults.string(forKey: Self.installKey) { return value }
        let value = UUID().uuidString
        defaults.set(value, forKey: Self.installKey)
        return value
    }

    private static func stateSignature(_ body: [String: Any]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    private static func payload(installId: String) async -> [String: Any] {
        let info = Bundle.main.infoDictionary ?? [:]
        let notificationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        var body: [String: Any] = [
            "installId": installId,
            "deviceModel": deviceModel,
            "systemVersion": UIDevice.current.systemVersion,
            "appVersion": info["CFBundleShortVersionString"] as? String ?? "0",
            "appBuild": info["CFBundleVersion"] as? String ?? "0",
            "liveActivitySystemEnabled": ActivityAuthorizationInfo().areActivitiesEnabled,
            "liveActivityAppEnabled": NativeLiveActivityController.shared.isEnabled,
            "notificationStatus": notificationName(notificationStatus),
            "widgets": await widgetConfigurations() ?? NSNull(),
        ]
        // WatchConnectivity only answers once the Watch sync has activated it.
        if WCSession.isSupported(), WCSession.default.activationState == .activated {
            body["watchPaired"] = WCSession.default.isPaired
            body["watchAppInstalled"] = WCSession.default.isWatchAppInstalled
        }
        return body
    }

    /// Home Screen and Lock Screen widgets currently placed by the user.
    private static func widgetConfigurations() async -> [[String: String]]? {
        await withCheckedContinuation { continuation in
            WidgetCenter.shared.getCurrentConfigurations { result in
                guard case .success(let widgets) = result else {
                    continuation.resume(returning: nil)
                    return
                }
                let rows = widgets
                    .map { ["kind": $0.kind, "family": familyName($0.family)] }
                    .sorted { ($0["kind"]!, $0["family"]!) < ($1["kind"]!, $1["family"]!) }
                continuation.resume(returning: rows)
            }
        }
    }

    private static func familyName(_ family: WidgetFamily) -> String {
        switch family {
        case .systemSmall: return "systemSmall"
        case .systemMedium: return "systemMedium"
        case .systemLarge: return "systemLarge"
        case .systemExtraLarge: return "systemExtraLarge"
        case .accessoryCircular: return "accessoryCircular"
        case .accessoryRectangular: return "accessoryRectangular"
        case .accessoryInline: return "accessoryInline"
        @unknown default: return "other"
        }
    }

    private static func notificationName(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        case .ephemeral: return "ephemeral"
        @unknown default: return "notDetermined"
        }
    }

    /// Hardware identifier such as `iPhone17,1`; the server maps it to a name.
    static let deviceModel: String = {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return "Simulator \(simulated)" }
        var system = utsname()
        uname(&system)
        return withUnsafeBytes(of: &system.machine) { buffer in
            String(decoding: buffer.prefix { $0 != 0 }, as: UTF8.self)
        }
    }()
}
