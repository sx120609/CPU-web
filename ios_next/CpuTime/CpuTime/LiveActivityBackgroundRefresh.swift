import BackgroundTasks
import Foundation

/// Best-effort fallback for dismissing an expired Activity while the app is
/// suspended. APNs remains the precise path; iOS decides when this task runs.
@available(iOS 17.0, *)
@MainActor
final class LiveActivityBackgroundRefresh {
    static let shared = LiveActivityBackgroundRefresh()
    static let identifier = "cn.cputime.ios.next.liveactivity.refresh"
    private var registered = false
    private var pending: Date?

    func register() {
        guard !registered else { return }
        registered = true
        NativeLiveActivityController.shared.scheduleBackgroundWakeup = { [weak self] date in
            self?.schedule(at: date)
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.identifier, using: nil) { task in
            let completion = Completion(task: task)
            let work = Task { @MainActor in
                await NativeLiveActivityController.shared.reconcileInBackground()
                completion.finish(success: true)
            }
            task.expirationHandler = { work.cancel(); completion.finish(success: false) }
        }
    }

    func schedule(at date: Date) {
        let earliest = max(date, Date().addingTimeInterval(60))
        if let pending, abs(pending.timeIntervalSince(earliest)) < 30 { return }
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.identifier)
        let request = BGAppRefreshTaskRequest(identifier: Self.identifier)
        request.earliestBeginDate = earliest
        do {
            try BGTaskScheduler.shared.submit(request)
            pending = earliest
        } catch {
            pending = nil
        }
    }

    private final class Completion: @unchecked Sendable {
        private let task: BGTask
        private let lock = NSLock()
        private var finished = false

        init(task: BGTask) { self.task = task }

        func finish(success: Bool) {
            lock.lock()
            guard !finished else { lock.unlock(); return }
            finished = true
            lock.unlock()
            task.setTaskCompleted(success: success)
        }
    }
}
