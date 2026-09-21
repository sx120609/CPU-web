import ActivityKit
import Combine
import Foundation

/// Uploads only the push-to-start credential and semester window times.
/// All updates use school channels; course details stay in the App Group.
@available(iOS 17.2, *)
@MainActor
final class LiveActivityPushService: ObservableObject {
    static let shared = LiveActivityPushService()
    private typealias Request = (String, String, [String: Any]?) async throws -> Data
    private var apiRequest: Request?
    private var startTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var generation = 0
    private var revision = 0
    private var token: String?
    private var lastDigest: Data?
    private let defaults = UserDefaults.standard
    private static let revokeKey = "cpu.liveActivity.remote.revoke"
    private static let pendingRevokeKey = "cpu.liveActivity.remote.pendingRevokes"

    func setAPIRequest(_ request: @escaping (String, String, [String: Any]?) async throws -> Data) {
        apiRequest = request
    }

    func activate() {
        let controller = NativeLiveActivityController.shared
        controller.resetPushService = { [weak self] in self?.resetForLogout() }
        controller.planDidChange = { [weak self] in self?.scheduleSync() }
        guard controller.isEnabled else { flushRevocations(); return }
        guard #available(iOS 18.0, *) else {
            controller.broadcastStatus = "此系统版本仅支持前台本地实时活动；远程启动与广播需要 iOS 18。"
            return
        }
        controller.remoteStartsEnabled = true
        guard apiRequest != nil else { return }
        if let data = Activity<ScheduleLiveActivityAttributes>.pushToStartToken {
            token = data.map { String(format: "%02x", $0) }.joined()
        }
        if startTask == nil {
            startTask = Task { [weak self] in
                for await data in Activity<ScheduleLiveActivityAttributes>.pushToStartTokenUpdates {
                    guard let self, !Task.isCancelled else { return }
                    let next = data.map { String(format: "%02x", $0) }.joined()
                    token = next
                    lastDigest = nil
                    scheduleSync()
                }
            }
        }
        scheduleSync()
    }

    private func scheduleSync() {
        revision += 1
        guard syncTask == nil, let request = apiRequest else { return }
        let epoch = generation
        syncTask = Task { [weak self] in
            guard let self else { return }
            defer {
                syncTask = nil
                if epoch != generation { scheduleSync() }
            }
            var failures = 0
            while !Task.isCancelled, epoch == generation {
                let version = revision
                do {
                    try await flushRevocations(using: request)
                    let controller = NativeLiveActivityController.shared
                    guard controller.isEnabled, controller.remoteStartsEnabled else { return }
                    guard let token else {
                        controller.broadcastStatus = "等待系统提供远程启动凭据，请保持联网。"
                        return
                    }
                    guard let snapshot = controller.currentScheduleMetadata,
                          snapshot.auth.authenticated, snapshot.data != nil, snapshot.calendar != nil else { return }
                    let items = controller.remoteStartWindows()
                    let encoded = try JSONEncoder().encode(items)
                    let lead = controller.leadMinutes
                    var digest = encoded
                    digest.append(Data("\(lead):\(token)".utf8))
                    if digest != lastDigest {
                        var body: [String: Any] = [
                            "token": token, "environment": Self.environment,
                            "bundleID": Bundle.main.bundleIdentifier ?? "cn.cputime.mobile",
                            "leadMinutes": lead, "items": try JSONSerialization.jsonObject(with: encoded),
                        ]
                        if let replaces = defaults.string(forKey: Self.revokeKey) { body["replaces"] = replaces }
                        let result = try Self.decode(try await request("/api/live-activities/remote-start", "PUT", body))
                        if let revoke = result["revoke"] as? String {
                            if epoch != generation || Task.isCancelled {
                                appendPendingRevoke(revoke)
                                flushRevocations()
                                return
                            }
                            defaults.set(revoke, forKey: Self.revokeKey)
                        }
                        guard epoch == generation, !Task.isCancelled else { return }
                        lastDigest = digest
                        let through = result["scheduledThrough"] as? String
                        let missing = result["missingWindows"] as? [String] ?? []
                        controller.broadcastStatus = !missing.isEmpty ? "启动计划已保存，但部分学校频道未就绪，请联系管理员。" : through.map { "远程启动已同步至 \($0)，提前 \(lead) 分钟；无需每天打开 App。" } ?? "当前没有待启动的有课时段。"
                    }
                    failures = 0
                    if version == revision { return }
                } catch {
                    guard epoch == generation, !Task.isCancelled else { return }
                    NativeLiveActivityController.shared.broadcastStatus = "远程计划同步失败，旧计划可能仍生效；联网后将重试。"
                    failures += 1
                    if failures >= 4 { return }
                    do { try await Task.sleep(for: .seconds(min(30, 2 << failures))) }
                    catch { return }
                }
            }
        }
    }

    func enabledDidChange(_ enabled: Bool) {
        if enabled { activate() } else { resetForLogout() }
    }

    private func appendPendingRevoke(_ value: String) {
        var pending = defaults.stringArray(forKey: Self.pendingRevokeKey) ?? []
        if !pending.contains(value) { pending.append(value) }
        defaults.set(pending, forKey: Self.pendingRevokeKey)
    }
    private func queueRevocation() {
        if let revoke = defaults.string(forKey: Self.revokeKey) { appendPendingRevoke(revoke) }
        defaults.removeObject(forKey: Self.revokeKey)
    }
    private func flushRevocations(using request: Request) async throws {
        for revoke in defaults.stringArray(forKey: Self.pendingRevokeKey) ?? [] {
            _ = try await request("/api/live-activities/remote-start/revoke", "POST", ["revoke": revoke])
            let remaining = (defaults.stringArray(forKey: Self.pendingRevokeKey) ?? []).filter { $0 != revoke }
            defaults.set(remaining, forKey: Self.pendingRevokeKey)
        }
    }
    private func flushRevocations() { scheduleSync() }
    func resetForLogout() {
        generation += 1
        queueRevocation()
        // Let an in-flight save finish and revoke its returned capability too.
        startTask?.cancel()
        startTask = nil
        lastDigest = nil
        token = nil
        let controller = NativeLiveActivityController.shared
        controller.remoteStartsEnabled = false
        controller.broadcastWindows = []
        flushRevocations()
    }
    private static func decode(_ data: Data) throws -> [String: Any] {
        let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        return envelope["data"] as? [String: Any] ?? envelope
    }
    private static let environment: String = {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .isoLatin1),
              let range = text.range(of: "<key>aps-environment</key>") else {
            #if DEBUG
            return "sandbox"
            #else
            return "production"
            #endif
        }
        return text[range.upperBound...].prefix(200).contains("development") ? "sandbox" : "production"
    }()

}
