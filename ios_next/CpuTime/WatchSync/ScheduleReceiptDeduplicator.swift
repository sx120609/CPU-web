import Foundation

nonisolated struct ScheduleReceiptDeduplicator {
    private(set) var lastSentFingerprint: String?

    func shouldSend(_ fingerprint: String) -> Bool {
        lastSentFingerprint != fingerprint
    }

    mutating func markSent(_ fingerprint: String) {
        lastSentFingerprint = fingerprint
    }
}
