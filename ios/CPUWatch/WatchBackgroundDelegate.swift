import WatchConnectivity
import WatchKit

/// Keep watchOS's connectivity wake alive until WCSession has drained pending data.
@MainActor
final class WatchBackgroundDelegate: NSObject, WKApplicationDelegate {
    private var pending: [WKWatchConnectivityRefreshBackgroundTask] = []
    private var contentObservation: NSKeyValueObservation?
    private var activationObservation: NSKeyValueObservation?

    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            if let connectivity = task as? WKWatchConnectivityRefreshBackgroundTask {
                pending.append(connectivity)
            } else {
                task.setTaskCompletedWithSnapshot(false)
            }
        }
        let session = WCSession.default
        if contentObservation == nil {
            contentObservation = session.observe(\.hasContentPending, options: [.new]) { [weak self] _, _ in
                Task { @MainActor in self?.completeIfReady() }
            }
            activationObservation = session.observe(\.activationState, options: [.new]) { [weak self] _, _ in
                Task { @MainActor in self?.completeIfReady() }
            }
        }
        WatchScheduleStore.shared.coordinator.start()
        completeIfReady()
    }

    private func completeIfReady() {
        // Run after queued main-actor snapshot validation and atomic storage work.
        Task { @MainActor [weak self] in
            await Task.yield()
            guard let self, WCSession.default.activationState == .activated,
                  !WCSession.default.hasContentPending else { return }
            self.pending.forEach { $0.setTaskCompletedWithSnapshot(false) }
            self.pending.removeAll()
        }
    }
}
