import Foundation

nonisolated struct ScheduleConnection: Equatable {
    var activated = false
    var paired = false
    var installed = false
    var reachable = false
}

nonisolated enum ScheduleDisplayState: Equatable {
    case loading, valid, refreshing, empty, loginRequired, awaitingFirstSync, offlineCache, stale
    case failed(ScheduleFailure)
}

@MainActor
protocol ScheduleTransport: AnyObject {
    var connection: ScheduleConnection { get }
    var onConnectionChange: (() -> Void)? { get set }
    /// Returns the snapshot actually retained after validation. It can be newer
    /// than an out-of-order incoming payload and is the only safe receipt target.
    var onSnapshot: ((Data) throws -> ScheduleEnvelope)? { get set }
    var onRefreshRequest: (() -> Void)? { get set }
    var onAcknowledgement: ((String, Date) -> Void)? { get set }
    var onError: ((ScheduleFailure) -> Void)? { get set }
    func activate()
    func updateSnapshot(_ data: Data) throws
    func updateStatus(_ failure: ScheduleFailure, snapshot: Data?) throws
    func requestRefresh(completion: @escaping (Result<Void, ScheduleFailure>) -> Void)
}

@MainActor
protocol ScheduleDataProvider: AnyObject {
    var onSnapshot: ((Data) -> Void)? { get set }
    var onFailure: ((ScheduleFailure) -> Void)? { get set }
    func refresh()
}

@MainActor
final class ScheduleSyncCoordinator {
    enum Role {
        case phone, watch
        var sendsSnapshots: Bool { self == .phone }
        var receivesSnapshots: Bool { self == .watch }
    }
    let repository: CourseRepository
    let transport: any ScheduleTransport
    private let role: Role
    private let provider: (any ScheduleDataProvider)?
    private let defaults: UserDefaults?
    private var started = false
    private var sending = false
    private var refreshTimeout: Task<Void, Never>?
    private var lastSentData: Data?
    private(set) var refreshing = false
    private(set) var error: ScheduleFailure?
    private(set) var lastQueuedAt: Date?
    private(set) var lastSyncedAt: Date?
    var onChange: (() -> Void)?

    var connectionIssue: ScheduleFailure? {
        guard started else { return nil }
        let connection = transport.connection
        if !connection.activated { return .notActivated }
        if !connection.paired { return .notPaired }
        if !connection.installed { return .notInstalled }
        if !connection.reachable { return .unavailable }
        return nil
    }

    init(role: Role, repository: CourseRepository, transport: any ScheduleTransport,
         provider: (any ScheduleDataProvider)? = nil, defaults: UserDefaults? = nil) {
        self.role = role
        self.repository = repository
        self.transport = transport
        self.provider = provider
        self.defaults = defaults
        lastSyncedAt = defaults?.object(forKey: "watchScheduleLastAcknowledged") as? Date
        error = repository.error
        transport.onConnectionChange = { [weak self] in self?.connectionDidChange() }
        transport.onSnapshot = { [weak self] data in
            guard let self else { throw ScheduleFailure.invalidData }
            return try self.acceptWatchSnapshot(data)
        }
        transport.onRefreshRequest = { [weak self] in self?.refresh() }
        transport.onAcknowledgement = { [weak self] fingerprint, receivedAt in self?.acknowledge(fingerprint, at: receivedAt) }
        transport.onError = { [weak self] failure in self?.fail(failure) }
        provider?.onSnapshot = { [weak self] data in self?.acceptPhoneSnapshot(data) }
        provider?.onFailure = { [weak self] failure in self?.fail(failure) }
    }

    private func connectionDidChange() {
        onChange?()
        let connection = transport.connection
        if !connection.activated || !connection.installed || !connection.paired { lastSentData = nil }
        guard role.sendsSnapshots else { return }
        sendLatest()
        sendSourceStatus()
    }

    private func acceptWatchSnapshot(_ data: Data) throws -> ScheduleEnvelope {
        guard role.receivesSnapshots else { throw ScheduleFailure.invalidData }
        let retained = try repository.accept(data)
        error = nil
        refreshTimeout?.cancel()
        refreshing = false
        lastSyncedAt = .now
        onChange?()
        return retained
    }

    private func acceptPhoneSnapshot(_ data: Data) {
        guard role.sendsSnapshots else { return }
        do {
            _ = try repository.accept(data)
            refreshing = false
            error = nil
            sendLatest()
            onChange?()
        } catch { fail(error as? ScheduleFailure ?? .invalidData) }
    }

    private func acknowledge(_ fingerprint: String, at receivedAt: Date) {
        guard role.sendsSnapshots, let snapshot = repository.snapshot,
              fingerprint == (try? snapshot.fingerprint()), receivedAt <= Date.now.addingTimeInterval(300),
              receivedAt >= snapshot.generatedAt else { return }
        lastSyncedAt = receivedAt
        defaults?.set(lastSyncedAt, forKey: "watchScheduleLastAcknowledged")
        onChange?()
    }

    func start() {
        guard !started else { return }
        started = true
        transport.activate()
        onChange?()
    }

    func foreground() {
        start()
        if role.sendsSnapshots {
            sendLatest()
            if repository.snapshot == nil || repository.snapshot!.isStale(at: .now) { refresh() }
        }
        onChange?()
    }

    func refresh() {
        guard !refreshing else { return }
        refreshing = true
        error = nil
        onChange?()
        if role.sendsSnapshots {
            sendLatest(force: true)
            provider?.refresh()
            if provider == nil { fail(.sourceUnavailable) }
        } else {
            transport.requestRefresh { [weak self] result in
                guard let self else { return }
                switch result {
                case .failure(let failure): self.fail(failure)
                case .success:
                    // sendMessage only accepted the request; a context or timeout finishes it.
                    if self.refreshing {
                        self.refreshTimeout?.cancel()
                        self.refreshTimeout = Task { @MainActor [weak self] in
                            try? await Task.sleep(for: .seconds(45))
                            guard !Task.isCancelled else { return }
                            self?.fail(.sourceUnavailable)
                        }
                    }
                }
                self.onChange?()
            }
        }
    }

    func sendLatest(force: Bool = false) {
        guard role.sendsSnapshots, !sending, let snapshot = repository.snapshot else { return }
        let connection = transport.connection
        guard connection.activated, connection.paired, connection.installed else { return }
        sending = true
        defer { sending = false }
        do {
            let data = try snapshot.encoded()
            if !force && lastSentData == data { return }
            try transport.updateSnapshot(data)
            lastSentData = data
            if error == .syncFailed || error == .unavailable { error = nil }
            lastQueuedAt = .now // Accepted by the OS, not proof of Watch delivery.
        } catch { self.error = error as? ScheduleFailure ?? .syncFailed }
        onChange?()
    }

    func fail(_ failure: ScheduleFailure) {
        refreshTimeout?.cancel()
        error = failure
        refreshing = false
        sendSourceStatus()
        onChange?()
    }

    private func sendSourceStatus() {
        guard role.sendsSnapshots, let error, [.loginRequired, .sourceUnavailable, .invalidData, .unsupportedVersion].contains(error),
              transport.connection.activated, transport.connection.paired, transport.connection.installed else { return }
        do {
            try transport.updateStatus(error, snapshot: repository.snapshot?.encoded())
            lastSentData = nil // A later recovery must replace the status, even if course data is unchanged.
        } catch { /* Keep the original actionable provider error. Retry on the next connection change. */ }
    }

    func state(at now: Date = .now) -> ScheduleDisplayState {
        if refreshing { return .refreshing }
        if let error { return error == .loginRequired ? .loginRequired : .failed(error) }
        guard let value = repository.snapshot else {
            guard started else { return .loading }
            let connection = transport.connection
            guard connection.activated else { return .loading }
            if !connection.paired { return .failed(.notPaired) }
            if !connection.installed { return .failed(.notInstalled) }
            return .awaitingFirstSync
        }
        if value.isStale(at: now) { return .stale }
        if !transport.connection.reachable { return .offlineCache }
        return value.courses.isEmpty ? .empty : .valid
    }
}
