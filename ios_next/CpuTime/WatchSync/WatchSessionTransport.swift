#if canImport(WatchConnectivity)
import Foundation
import WatchConnectivity

@MainActor
final class WatchSessionTransport: NSObject, ScheduleTransport, WCSessionDelegate {
    private let session: WCSession?
    private var receiptDeduplicator = ScheduleReceiptDeduplicator()
    var onConnectionChange: (() -> Void)?
    var onSnapshot: ((Data) throws -> ScheduleEnvelope)?
    var onRefreshRequest: (() -> Void)?
    var onAcknowledgement: ((String, Date) -> Void)?
    var onError: ((ScheduleFailure) -> Void)?
    var onClear: (() -> Void)?

    init(session: WCSession? = WCSession.isSupported() ? .default : nil) {
        self.session = session
        super.init()
    }

    var connection: ScheduleConnection {
        guard let session else { return ScheduleConnection() }
        #if os(iOS)
        return ScheduleConnection(activated: session.activationState == .activated,
                                  paired: session.isPaired, installed: session.isWatchAppInstalled,
                                  reachable: session.isReachable)
        #else
        // watchOS has no isPaired property. A companion session represents its paired iPhone.
        return ScheduleConnection(activated: session.activationState == .activated,
                                  paired: session.activationState == .activated,
                                  installed: session.isCompanionAppInstalled, reachable: session.isReachable)
        #endif
    }

    func activate() {
        guard let session else { onError?(.notPaired); return }
        session.delegate = self
        session.activate()
    }

    func updateSnapshot(_ data: Data) throws {
        guard let session, connection.activated else { throw ScheduleFailure.notActivated }
        guard connection.paired else { throw ScheduleFailure.notPaired }
        guard connection.installed else { throw ScheduleFailure.notInstalled }
        guard data.count <= ScheduleEnvelope.maximumBytes else { throw ScheduleFailure.invalidData }
        do {
            try session.updateApplicationContext([
                ScheduleWireProtocol.Key.schemaVersion: ScheduleWireProtocol.schemaVersion,
                ScheduleWireProtocol.Key.schedule: data,
            ])
        }
        catch { throw ScheduleFailure.syncFailed }
    }

    func updateStatus(_ failure: ScheduleFailure, snapshot: Data?) throws {
        guard let session, connection.activated else { throw ScheduleFailure.notActivated }
        var context: [String: Any] = [
            ScheduleWireProtocol.Key.schemaVersion: ScheduleWireProtocol.schemaVersion,
            ScheduleWireProtocol.Key.status: failure.rawValue,
        ]
        if let snapshot { context[ScheduleWireProtocol.Key.schedule] = snapshot }
        do { try session.updateApplicationContext(context) }
        catch { throw ScheduleFailure.syncFailed }
    }

    func requestRefresh(completion: @escaping (Result<Void, ScheduleFailure>) -> Void) {
        guard let session, connection.activated else { completion(.failure(.notActivated)); return }
        guard connection.installed else { completion(.failure(.notInstalled)); return }
        guard connection.reachable else { completion(.failure(.unavailable)); return }
        session.sendMessage([
            ScheduleWireProtocol.Key.schemaVersion: ScheduleWireProtocol.schemaVersion,
            ScheduleWireProtocol.Key.messageType: ScheduleWireProtocol.MessageType.refresh,
        ], replyHandler: { reply in
            let accepted = reply[ScheduleWireProtocol.Key.accepted] as? Bool == true
            Task { @MainActor in completion(accepted ? .success(()) : .failure(.syncFailed)) }
        }, errorHandler: { _ in
            Task { @MainActor in completion(.failure(.syncFailed)) }
        })
    }

    private func receive(_ context: [String: Any]) {
        #if os(watchOS)
        guard !context.isEmpty else { return }
        guard context[ScheduleWireProtocol.Key.schemaVersion] as? Int == ScheduleWireProtocol.schemaVersion else {
            onError?(.unsupportedVersion)
            return
        }
        let status = (context[ScheduleWireProtocol.Key.status] as? String).flatMap(ScheduleFailure.init(rawValue:))
        guard let data = context[ScheduleWireProtocol.Key.schedule] as? Data else {
            if status == .loginRequired { onClear?() }
            onError?(status ?? .invalidData)
            return
        }
        do {
            // Never acknowledge a delayed payload as retained if the repository
            // has already kept a newer snapshot.
            let snapshot = try onSnapshot?(data) ?? ScheduleEnvelope.decode(data)
            let fingerprint = try snapshot.fingerprint()
            if receiptDeduplicator.shouldSend(fingerprint) {
                // The reverse application context persists the receipt while the phone is offline.
                try session?.updateApplicationContext([
                    ScheduleWireProtocol.Key.schemaVersion: ScheduleWireProtocol.schemaVersion,
                    ScheduleWireProtocol.Key.messageType: ScheduleWireProtocol.MessageType.receipt,
                    ScheduleWireProtocol.Key.snapshotID: fingerprint,
                    ScheduleWireProtocol.Key.receivedAt: Date.now.timeIntervalSince1970,
                ])
                receiptDeduplicator.markSent(fingerprint)
            }
            if let status { onError?(status) }
        } catch { onError?(error as? ScheduleFailure ?? .syncFailed) }
        #else
        guard context[ScheduleWireProtocol.Key.schemaVersion] as? Int == ScheduleWireProtocol.schemaVersion,
              context[ScheduleWireProtocol.Key.messageType] as? String == ScheduleWireProtocol.MessageType.receipt,
              let fingerprint = context[ScheduleWireProtocol.Key.snapshotID] as? String, fingerprint.count == 64,
              let time = context[ScheduleWireProtocol.Key.receivedAt] as? Double, time.isFinite else { return }
        onAcknowledgement?(fingerprint, Date(timeIntervalSince1970: time))
        #endif
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let failed = error != nil
        Task { @MainActor [weak self] in
            guard let self else { return }
            if failed { self.onError?(.syncFailed) }
            else { self.receive(self.session?.receivedApplicationContext ?? [:]) }
            self.onConnectionChange?()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor [weak self] in self?.receive(applicationContext) }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor [weak self] in self?.onConnectionChange?() }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        let valid = message[ScheduleWireProtocol.Key.schemaVersion] as? Int == ScheduleWireProtocol.schemaVersion
            && message[ScheduleWireProtocol.Key.messageType] as? String == ScheduleWireProtocol.MessageType.refresh
        #if os(iOS)
        replyHandler([ScheduleWireProtocol.Key.accepted: valid]) // Acknowledges the request, not completion of a network refresh.
        if valid { Task { @MainActor [weak self] in self?.onRefreshRequest?() } }
        #else
        replyHandler([ScheduleWireProtocol.Key.accepted: false])
        #endif
    }

    #if os(iOS)
    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor [weak self] in self?.onConnectionChange?() }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {
        Task { @MainActor [weak self] in self?.onConnectionChange?() }
    }

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        Task { @MainActor [weak self] in self?.activate() }
    }
    #endif
}
#endif
