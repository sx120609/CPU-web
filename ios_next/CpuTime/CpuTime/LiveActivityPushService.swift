import ActivityKit
import Combine
import Foundation

/// Owns the device-level push-to-start token and the update token of each
/// running Activity. The controller renders the plan; this class only uploads
/// and relays it through the authenticated WebView session.
@available(iOS 17.2, *)
@MainActor
final class LiveActivityPushService: ObservableObject {
    static let shared = LiveActivityPushService()
    static let enabledKey = NativeLiveActivityController.enabledKey
    private static let deviceIDKey = "cpu.liveActivity.deviceID"
    private static let channelIDKey = "cpu.liveActivity.channelID"
    private static let digestKey = "cpu.liveActivity.planDigest"
    private static let pendingStartTokenKey = "cpu.liveActivity.pendingStartToken"
    private static let pendingActivitiesKey = "cpu.liveActivity.pendingActivities"

    private struct PendingActivityRegistration: Codable {
        let activityID: String
        let updateToken: String
        let expiresAt: Int
    }

    typealias APIRequest = NativeLiveActivityController.APIRequest
    private var apiRequest: APIRequest?
    private var startTask: Task<Void, Never>?
    private var activityTask: Task<Void, Never>?
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    private var planTask: Task<Void, Never>?
    private let defaults = UserDefaults.standard

    var isEnabled: Bool {
        UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?
            .object(forKey: Self.enabledKey) as? Bool ?? true
    }
    private var deviceID: String? { defaults.string(forKey: Self.deviceIDKey) }

    func setAPIRequest(_ request: APIRequest?) { apiRequest = request }

    func activate() {
        NativeLiveActivityController.shared.wantsPushToken = isEnabled
        NativeLiveActivityController.shared.broadcastChannelID = defaults.string(forKey: Self.channelIDKey)
        NativeLiveActivityController.shared.planDidChange = { [weak self] plan in
            self?.submit(plan)
        }
        observeActivities()
        guard isEnabled else { return }
        observeStartToken()
        Task { await registerDevice(startToken: nil); await refreshStatus() }
    }

    func setEnabled(_ enabled: Bool) {
        UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?.set(enabled, forKey: Self.enabledKey)
        NativeLiveActivityController.shared.wantsPushToken = enabled
        if enabled {
            observeStartToken()
            NativeLiveActivityController.shared.replanForPush()
            Task { await registerDevice(startToken: nil) }
        } else {
            startTask?.cancel()
            startTask = nil
            defaults.removeObject(forKey: Self.digestKey)
            if let id = deviceID { Task { _ = try? await request(path: "/api/live-activities/devices/\(id)", method: "DELETE") } }
            defaults.removeObject(forKey: Self.deviceIDKey)
            defaults.removeObject(forKey: Self.channelIDKey)
            NativeLiveActivityController.shared.broadcastChannelID = nil
        }
    }

    private func observeStartToken() {
        guard startTask == nil else { return }
        startTask = Task { @MainActor [weak self] in
            for await data in Activity<ScheduleLiveActivityAttributes>.pushToStartTokenUpdates {
                guard let self, !Task.isCancelled else { return }
                self.defaults.set(Self.hex(data), forKey: Self.pendingStartTokenKey)
                await self.registerDevice(startToken: Self.hex(data))
            }
        }
    }

    private func observeActivities() {
        guard activityTask == nil else { return }
        for activity in Activity<ScheduleLiveActivityAttributes>.activities { observe(activity) }
        activityTask = Task { @MainActor [weak self] in
            for await activity in Activity<ScheduleLiveActivityAttributes>.activityUpdates {
                self?.observe(activity)
            }
        }
    }

    private func observe(_ activity: Activity<ScheduleLiveActivityAttributes>) {
        guard tokenTasks[activity.id] == nil else { return }
        tokenTasks[activity.id] = Task { @MainActor [weak self] in
            for await data in activity.pushTokenUpdates {
                guard let self, !Task.isCancelled else { return }
                await self.registerActivity(activity, token: Self.hex(data))
            }
            guard let self else { return }
            self.tokenTasks[activity.id] = nil
            await self.forgetActivity(activity.id)
        }
    }

    private func registerDevice(startToken: String?) async {
        guard isEnabled, apiRequest != nil else { return }
        let tokenForRequest = startToken ?? defaults.string(forKey: Self.pendingStartTokenKey)
        var body: [String: Any] = [
            "environment": Self.environment,
            "bundleID": Bundle.main.bundleIdentifier ?? "cn.cputime.mobile",
            "timeZone": "Asia/Shanghai",
        ]
        if #available(iOS 26.0, *) { body["supportsBroadcast"] = true }
        if let tokenForRequest, !tokenForRequest.isEmpty { body["startToken"] = tokenForRequest }
        if let deviceID { body["deviceID"] = deviceID }
        do {
            let result = try await retryRequest { [self] in
                guard let apiRequest else { throw CancellationError() }
                return try await decode(apiRequest("/api/live-activities/devices", "POST", body))
            }
            if let id = result["deviceID"] as? String { defaults.set(id, forKey: Self.deviceIDKey) }
            if let channel = result["channelID"] as? String, !channel.isEmpty {
                defaults.set(channel, forKey: Self.channelIDKey)
                NativeLiveActivityController.shared.broadcastChannelID = channel
            } else {
                defaults.removeObject(forKey: Self.channelIDKey)
                NativeLiveActivityController.shared.broadcastChannelID = nil
            }
            if let tokenForRequest, defaults.string(forKey: Self.pendingStartTokenKey) == tokenForRequest {
                defaults.removeObject(forKey: Self.pendingStartTokenKey)
            }
            defaults.removeObject(forKey: Self.digestKey)
            NativeLiveActivityController.shared.replanForPush()
            await flushPendingActivities()
        } catch { /* Keep tokens persisted for the next activation/retry. */ }
    }

    func submit(_ plan: [NativeLiveActivityController.PlannedPush]) {
        guard isEnabled, let deviceID, let apiRequest else { return }
        let items = plan.map(Self.payload)
        let digest = Self.digest(items)
        guard digest != defaults.string(forKey: Self.digestKey) else { return }
        planTask?.cancel()
        let request = apiRequest
        planTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                _ = try await request("/api/live-activities/devices/\(deviceID)/plan", "PUT", ["items": items])
                self.defaults.set(digest, forKey: Self.digestKey)
            } catch {
                self.defaults.removeObject(forKey: Self.digestKey)
            }
        }
    }

    private func registerActivity(_ activity: Activity<ScheduleLiveActivityAttributes>, token: String) async {
        guard isEnabled, !token.isEmpty else { return }
        let expires = max(activity.content.state.endDate.addingTimeInterval(48 * 3600), Date().addingTimeInterval(48 * 3600))
        let pending = PendingActivityRegistration(activityID: activity.id, updateToken: token, expiresAt: Int(expires.timeIntervalSince1970))
        savePendingActivity(pending)
        await sendPendingActivity(pending)
    }

    private func flushPendingActivities() async {
        for pending in loadPendingActivities() { await sendPendingActivity(pending) }
    }

    private func sendPendingActivity(_ pending: PendingActivityRegistration) async {
        guard isEnabled, let deviceID, apiRequest != nil else { return }
        do {
            _ = try await retryRequest { [self] in
                guard let apiRequest else { throw CancellationError() }
                return try await decode(apiRequest("/api/live-activities/devices/\(deviceID)/activities", "POST", [
                    "activityID": pending.activityID,
                    "updateToken": pending.updateToken,
                    "expiresAt": pending.expiresAt,
                ]))
            }
            removePendingActivity(pending.activityID, token: pending.updateToken)
        } catch { /* Keep the latest token queued for a later retry. */ }
    }

    private func forgetActivity(_ activityID: String) async {
        removePendingActivity(activityID)
        guard let deviceID else { return }
        _ = try? await request(path: "/api/live-activities/devices/\(deviceID)/activities/\(activityID)", method: "DELETE")
    }

    private func loadPendingActivities() -> [PendingActivityRegistration] {
        guard let data = defaults.data(forKey: Self.pendingActivitiesKey),
              let values = try? JSONDecoder().decode([PendingActivityRegistration].self, from: data) else { return [] }
        return values
    }

    private func savePendingActivity(_ pending: PendingActivityRegistration) {
        var values = loadPendingActivities().filter { $0.activityID != pending.activityID }
        values.append(pending)
        if let data = try? JSONEncoder().encode(values) { defaults.set(data, forKey: Self.pendingActivitiesKey) }
    }

    private func removePendingActivity(_ activityID: String, token: String? = nil) {
        let values = loadPendingActivities().filter { $0.activityID != activityID || (token != nil && $0.updateToken != token) }
        if values.isEmpty { defaults.removeObject(forKey: Self.pendingActivitiesKey) }
        else if let data = try? JSONEncoder().encode(values) { defaults.set(data, forKey: Self.pendingActivitiesKey) }
    }

    private func retryRequest<T>(_ operation: () async throws -> T) async throws -> T {
        var lastError: Error?
        for attempt in 0..<3 {
            do { return try await operation() }
            catch {
                lastError = error
                if attempt < 2 { try await Task.sleep(nanoseconds: UInt64((1 << attempt) * 500_000_000)) }
            }
        }
        throw lastError ?? CancellationError()
    }

    private func refreshStatus() async {
        guard let deviceID else { return }
        _ = try? await request(path: "/api/live-activities/devices/\(deviceID)", method: "GET")
    }

    @discardableResult
    private func request(path: String, method: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        guard let apiRequest else { throw CancellationError() }
        return try await decode(try await apiRequest(path, method, body))
    }

    private func decode(_ data: Data) throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        if let code = object["code"] as? Int, code != 0 {
            throw NSError(domain: "LiveActivity", code: code, userInfo: [NSLocalizedDescriptionKey: object["message"] as? String ?? "请求失败"])
        }
        return (object["data"] as? [String: Any]) ?? object
    }

    private static let environment: String = {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }()

    private static func payload(_ push: NativeLiveActivityController.PlannedPush) -> [String: Any] {
        var value: [String: Any] = [
            "id": push.id,
            "event": push.event.rawValue,
            "fireAt": Int(push.fireAt.timeIntervalSince1970),
            "expiresAt": Int(push.expiresAt.timeIntervalSince1970),
            "contentState": object(push.state),
            "attributesType": "ScheduleLiveActivityAttributes",
            "staleDate": Int(push.staleDate.timeIntervalSince1970),
        ]
        if push.event == .start { value["attributes"] = object(push.attributes) }
        if push.event == .end { value["dismissalDate"] = Int(push.fireAt.timeIntervalSince1970) }
        return value
    }

    private static func object<T: Encodable>(_ value: T) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(value), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }

    private static func digest(_ value: [[String: Any]]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data()
        return data.base64EncodedString()
    }

    private static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
}
