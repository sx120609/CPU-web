import BackgroundTasks
import Foundation

/// Best-effort work while the app is suspended: dismissing an expired Activity (APNs remains
/// the precise path), asking 教务 whether the timetable changed, and arranging the next 课前提醒.
/// iOS decides when this task runs, and whether it runs at all.
@available(iOS 17.0, *)
@MainActor
final class LiveActivityBackgroundRefresh {
    static let shared = LiveActivityBackgroundRefresh()
    static let identifier = "cn.cputime.ios.next.liveactivity.refresh"
    private var registered = false
    private var pending: Date?
    /// Whatever else should happen on a background wake-up: the timetable check and the
    /// reminders that follow from it. Set by the app once its stores exist; a launch straight
    /// into the background has none and does only the Activity work.
    var timetableWork: (() async -> Void)?
    /// How long after the app leaves the screen the system is first asked to wake it.
    static let interval: TimeInterval = 2 * 3600

    func register() {
        guard !registered else { return }
        registered = true
        NativeLiveActivityController.shared.scheduleBackgroundWakeup = { [weak self] date in
            self?.schedule(at: date)
        }
        registered = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.identifier, using: .main, launchHandler: Self.handle
        )
    }

    // The scheduler and expiration callbacks do not inherit the app's default
    // MainActor isolation. Only controller work crosses onto the main actor.
    nonisolated private static func handle(_ task: BGTask) {
        let completion = Completion(task: task)
        let work = Task { @MainActor in
            await NativeLiveActivityController.shared.reconcileInBackground()
            await shared.timetableWork?()
            // Ask for the next one before finishing: a refresh request is used up when it runs.
            shared.pending = nil
            shared.schedule(at: Date().addingTimeInterval(interval))
            completion.finish(success: !Task.isCancelled)
        }
        task.expirationHandler = { @Sendable in
            work.cancel()
            completion.finish(success: false)
        }
    }

    /// The app has left the screen: ask to be woken in a while.
    func enteredBackground() {
        guard registered, timetableWork != nil else { return }
        let target = Date().addingTimeInterval(Self.interval)
        // An earlier wake-up already asked for (an Activity about to expire) stands.
        if let pending, pending > Date(), pending < target { return }
        schedule(at: target)
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

    nonisolated private final class Completion: @unchecked Sendable {
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
