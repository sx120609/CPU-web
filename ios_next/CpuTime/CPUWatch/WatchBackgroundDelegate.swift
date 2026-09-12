import WatchConnectivity
import WatchKit

/// Keep watchOS's connectivity wake alive until WCSession has drained pending data.
@MainActor
final class WatchBackgroundDelegate: NSObject, WKApplicationDelegate {
    private let taskFinisher = WatchConnectivityBackgroundTaskFinisher()
    private var contentObservation: NSKeyValueObservation?
    private var activationObservation: NSKeyValueObservation?

    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            if let connectivity = task as? WKWatchConnectivityRefreshBackgroundTask {
                taskFinisher.append(connectivity)
            } else {
                task.setTaskCompletedWithSnapshot(false)
            }
        }
        guard taskFinisher.pendingCount > 0 else { return }

        let session = WCSession.default
        taskFinisher.onBecameIdle = { [weak self] in self?.stopObserving() }
        if contentObservation == nil {
            contentObservation = session.observe(\.hasContentPending, options: [.new]) { [weak self] _, _ in
                guard let delegate = self else { return }
                Task { @MainActor in delegate.completeIfReady() }
            }
            activationObservation = session.observe(\.activationState, options: [.new]) { [weak self] _, _ in
                guard let delegate = self else { return }
                Task { @MainActor in delegate.completeIfReady() }
            }
        }
        WatchScheduleStore.shared.coordinator.start()
        completeIfReady()
    }

    private func completeIfReady() {
        // Run after queued main-actor snapshot validation and atomic storage work.
        Task { @MainActor [weak self] in
            await Task.yield()
            guard let self else { return }
            self.taskFinisher.completeIfReady(
                activated: WCSession.default.activationState == .activated,
                hasContentPending: WCSession.default.hasContentPending
            )
        }
    }

    private func stopObserving() {
        contentObservation = nil
        activationObservation = nil
    }
}

extension WKWatchConnectivityRefreshBackgroundTask: WatchBackgroundTaskCompleting {
    func completeWithoutSnapshot() {
        setTaskCompletedWithSnapshot(false)
    }
}
