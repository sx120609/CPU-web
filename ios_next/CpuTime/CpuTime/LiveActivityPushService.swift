import ActivityKit
import Combine
import Foundation

@available(iOS 17.2, *)
@MainActor
final class LiveActivityPushService: ObservableObject {
    static let shared = LiveActivityPushService()
    private let localScheduling: Bool
    init(localScheduling: Bool? = nil) {
        if let localScheduling { self.localScheduling = localScheduling }
        else if #available(iOS 26.0, *) { self.localScheduling = true }
        else { self.localScheduling = false }
    }
    private typealias Request = (String, String, [String: Any]?) async throws -> Data
    private var apiRequest: Request?
    private var startTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var generation = 0
    private var dirty = false
    private var configurationRevision = 0
    private var token: String?
    private let defaults = UserDefaults.standard
    private var account: String? { NativeLiveActivityController.shared.currentScheduleMetadata?.auth.account }
    private var installationId: String {
        if let value = defaults.string(forKey: "cpu.liveActivity.installation.v2") { return value }
        let value = UUID().uuidString
        defaults.set(value, forKey: "cpu.liveActivity.installation.v2")
        return value
    }
    private func key(_ kind: String, _ account: String) -> String { "cpu.liveActivity.v2.\(installationId).\(account).\(kind)" }
    func setAPIRequest(_ request: @escaping (String, String, [String: Any]?) async throws -> Data) { apiRequest = request }
    func activate() {
        let controller = NativeLiveActivityController.shared
        controller.resetPushService = { [weak self] in self?.resetForLogout() }
        controller.planDidChange = { [weak self] in self?.scheduleSync() }
        controller.recoverRemote = { [weak self] id in try await self?.recover(id) }
        guard controller.isEnabled else { scheduleSync(); return }
        if localScheduling {
            controller.remoteStartsEnabled = false
            startTask?.cancel(); startTask = nil
            if let account { controller.localHandoffComplete = defaults.bool(forKey: key("handoffComplete", account)) }
        } else if #available(iOS 18.0, *) {
            controller.remoteStartsEnabled = true
            if let data = Activity<ScheduleLiveActivityAttributes>.pushToStartToken { token = data.map { String(format: "%02x", $0) }.joined() }
            if startTask == nil {
                startTask = Task { [weak self] in
                    for await data in Activity<ScheduleLiveActivityAttributes>.pushToStartTokenUpdates {
                        guard let self, !Task.isCancelled else { return }
                        token = data.map { String(format: "%02x", $0) }.joined(); scheduleSync()
                    }
                }
            }
        }
        scheduleSync()
    }
    private func deviceBody(_ account: String) -> [String: Any] {
        ["installationId": installationId, "accountScope": account, "environment": Self.environment,
         "bundleID": Bundle.main.bundleIdentifier ?? "cn.cputime.mobile"]
    }
    private func scheduleSync() {
        dirty = true
        configurationRevision += 1
        guard syncTask == nil, let request = apiRequest else { return }
        let epoch = generation
        syncTask = Task { [weak self] in
            guard let self else { return }
            defer { syncTask = nil; if dirty || epoch != generation { scheduleSync() } }
            var attempts = 0
            while dirty, epoch == generation, !Task.isCancelled {
                dirty = false
                do {
                    try await flushRevocations(request)
                    let controller = NativeLiveActivityController.shared
                    guard controller.isEnabled, let account,
                          let snapshot = controller.currentScheduleMetadata, snapshot.auth.authenticated else { return }
                    lastAccount = account
                    if localScheduling {
                        controller.localHandoffComplete = defaults.bool(forKey: key("handoffComplete", account))
                        controller.installHandoffRecords(defaults.array(forKey: key("handoffRecords", account)) as? [[String: Any]] ?? [])
                    }
                    let stillValid = { epoch == self.generation && self.account == account && controller.isEnabled && !Task.isCancelled }
                    if localScheduling && !defaults.bool(forKey: key("handoffComplete", account)) {
                        let handoffId = defaults.string(forKey: key("handoffId", account)) ?? UUID().uuidString
                        defaults.set(handoffId, forKey: key("handoffId", account))
                        controller.broadcastStatus = "等待完成启动方式切换"
                        var body = deviceBody(account); body["handoffId"] = handoffId
                        let result = try Self.decode(try await request("/api/live-activities/local-handoff", "POST", body))
                        if let revoke = result["revoke"] as? String {
                            if !stillValid() { queueRevoke(revoke); return }
                            defaults.set(revoke, forKey: key("revoke", account))
                        }
                        guard stillValid() else { return }
                        defaults.set(true, forKey: key("handoffComplete", account))
                        defaults.set(result["records"] as? [[String: Any]] ?? [], forKey: key("handoffRecords", account))
                        controller.installHandoffRecords(result["records"] as? [[String: Any]] ?? [])
                        controller.localHandoffComplete = true
                    }
                    // Cached mappings remain usable offline; fetching never extends
                    // their lease unless the server actually issues a new mapping.
                    let bundle = Bundle.main.bundleIdentifier ?? "cn.cputime.mobile"
                    let data = try await request("/api/live-activities/broadcast-config?mode=local&environment=\(Self.environment)&bundleID=\(bundle)", "GET", nil)
                    let result = try Self.decode(data)
                    let config = try JSONDecoder().decode(NativeLiveActivityController.TimingConfig.self, from: JSONSerialization.data(withJSONObject: result))
                    guard stillValid() else { return }
                    if controller.timing != config { controller.installTiming(config) }
                    if localScheduling {
                        controller.localHandoffComplete = true
                        controller.broadcastStatus = "每次打开 App 滚动安排未来 7 天，结束由学校节次频道处理。"
                        // installTiming triggers planDidChange; it needs no second fetch.
                        dirty = false
                        return
                    }
                    guard controller.remoteStartsEnabled, let token else { controller.broadcastStatus = "等待系统提供远程启动凭据"; return }
                    let items = controller.remoteStartWindows()
                    let dates = controller.currentScheduleMetadata?.calendar?.weeks.flatMap(\.days).sorted() ?? []
                    guard let first = dates.first, let last = dates.last else { return }
                    let dateFormatter = DateFormatter(); dateFormatter.dateFormat = "yyyy-MM-dd"; dateFormatter.timeZone = TimeZone(identifier: config.timezone)
                    guard let lastDate = dateFormatter.date(from: last) else { return }
                    var body = deviceBody(account)
                    body.merge(["protocolVersion": 2, "scheduleId": config.scheduleId, "scheduleVersion": config.scheduleVersion,
                        "coverageStart": first, "coverageEndExclusive": dateFormatter.string(from: lastDate.addingTimeInterval(86400)),
                        "leadMinutes": controller.leadMinutes, "token": token,
                        "busyIntervals": try JSONSerialization.jsonObject(with: JSONEncoder().encode(controller.busyIntervals)),
                        "items": try JSONSerialization.jsonObject(with: JSONEncoder().encode(items))]) { _, b in b }
                    let sentRevision = configurationRevision
                    let digest = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
                    if defaults.data(forKey: key("acceptedDigest", account)) != digest {
                        let pendingDigest = defaults.data(forKey: key("pendingDigest", account))
                        var planRevision = defaults.integer(forKey: key("revision", account))
                        if pendingDigest != digest {
                            let state = try Self.decode(try await request("/api/live-activities/device-state", "POST", deviceBody(account)))
                            guard stillValid() else { return }
                            if configurationRevision != sentRevision { dirty = true; continue }
                            planRevision = max(planRevision, state["planRevision"] as? Int ?? 0) + 1; defaults.set(planRevision, forKey: key("revision", account)); defaults.set(digest, forKey: key("pendingDigest", account)) }
                        body["planRevision"] = planRevision
                        let result = try Self.decode(try await request("/api/live-activities/remote-start", "PUT", body))
                        if let revoke = result["revoke"] as? String {
                            if !stillValid() { queueRevoke(revoke); return }
                            defaults.set(revoke, forKey: key("revoke", account))
                        }
                        guard stillValid() else { return }
                        defaults.set(digest, forKey: key("acceptedDigest", account))
                        controller.broadcastStatus = "已同步整学期课程计划，提前 \(controller.leadMinutes) 分钟。"
                    }
                    dirty = configurationRevision != sentRevision
                    attempts = 0
                } catch {
                    guard epoch == generation else { return }
                    if error.localizedDescription.contains("计划版本冲突"), let account { defaults.removeObject(forKey: key("pendingDigest", account)) }
                    NativeLiveActivityController.shared.broadcastStatus = localScheduling ? "联网配置失败；已有有效频道缓存可继续使用，未完成交接时等待联网。" : "远程计划同步失败，旧计划可能仍生效；联网后重试。"
                    attempts += 1
                    guard attempts < 4 else { dirty = false; return }
                    dirty = true
                    do { try await Task.sleep(for: .seconds(min(30, 2 << attempts))) } catch { return }
                }
            }
        }
    }
    private func recover(_ occurrence: String) async throws -> String? {
        guard let apiRequest, let account else { return nil }
        let epoch = generation
        var body = deviceBody(account)
        body["occurrenceId"] = occurrence
        body["planRevision"] = defaults.integer(forKey: key("revision", account))
        body["scheduleVersion"] = NativeLiveActivityController.shared.timing?.scheduleVersion
        let result = try Self.decode(try await apiRequest("/api/live-activities/foreground-recovery", "POST", body))
        guard epoch == generation, self.account == account, NativeLiveActivityController.shared.isEnabled else { return nil }
        return result["channelID"] as? String
    }
    func enabledDidChange(_ enabled: Bool) { if enabled { activate() } else { resetForLogout() } }
    private func queueRevoke(_ value: String) {
        var pending = defaults.stringArray(forKey: "cpu.liveActivity.v2.pendingRevokes") ?? []
        if !pending.contains(value) { pending.append(value) }
        defaults.set(pending, forKey: "cpu.liveActivity.v2.pendingRevokes")
    }
    private func flushRevocations(_ request: Request) async throws {
        for revoke in defaults.stringArray(forKey: "cpu.liveActivity.v2.pendingRevokes") ?? [] {
            _ = try await request("/api/live-activities/remote-start/revoke", "POST", ["revoke": revoke])
            defaults.set((defaults.stringArray(forKey: "cpu.liveActivity.v2.pendingRevokes") ?? []).filter { $0 != revoke }, forKey: "cpu.liveActivity.v2.pendingRevokes")
        }
    }
    private var lastAccount: String?
    func resetForLogout() {
        generation += 1
        if let account = account ?? lastAccount, let revoke = defaults.string(forKey: key("revoke", account)) {
            queueRevoke(revoke)
            defaults.removeObject(forKey: key("acceptedDigest", account))
            defaults.removeObject(forKey: key("pendingDigest", account))
        }
        startTask?.cancel(); startTask = nil; token = nil
        let controller = NativeLiveActivityController.shared
        controller.remoteStartsEnabled = false; controller.localHandoffComplete = false
        scheduleSync()
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
