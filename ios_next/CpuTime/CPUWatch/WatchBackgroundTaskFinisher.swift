import Foundation

@MainActor
protocol WatchBackgroundTaskCompleting: AnyObject {
    var expirationHandler: (() -> Void)? { get set }
    func completeWithoutSnapshot()
}

/// Bounds WatchConnectivity background execution even when activation or
/// delivery never reaches a clean, drained state.
@MainActor
final class WatchConnectivityBackgroundTaskFinisher {
    private var pending: [any WatchBackgroundTaskCompleting] = []
    private var timeoutTask: Task<Void, Never>?
    private let timeout: Duration
    var onBecameIdle: (() -> Void)?

    init(timeout: Duration = .seconds(8)) {
        self.timeout = timeout
    }

    var pendingCount: Int { pending.count }

    func append(_ task: any WatchBackgroundTaskCompleting) {
        task.expirationHandler = { [weak self] in
            Task { @MainActor in self?.completeAll() }
        }
        pending.append(task)
        guard timeoutTask == nil else { return }
        let timeout = timeout
        timeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: timeout)
            guard !Task.isCancelled else { return }
            self?.completeAll()
        }
    }

    func completeIfReady(activated: Bool, hasContentPending: Bool) {
        guard activated, !hasContentPending else { return }
        completeAll()
    }

    func completeAll() {
        guard !pending.isEmpty else { return }
        timeoutTask?.cancel()
        timeoutTask = nil
        let tasks = pending
        pending.removeAll()
        for task in tasks {
            task.expirationHandler = nil
            task.completeWithoutSnapshot()
        }
        onBecameIdle?()
    }
}
