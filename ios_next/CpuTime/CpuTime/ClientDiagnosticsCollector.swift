import Foundation
import MetricKit

/// Receives MetricKit's daily performance reports and crash / hang
/// diagnostics, summarizes them and keeps them on disk until the server has
/// acknowledged them. MetricKit calls in on a background queue, so this type
/// is not main-actor isolated and guards its queue file with a lock.
nonisolated final class ClientDiagnosticsCollector: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
    static let shared = ClientDiagnosticsCollector()

    typealias Request = (String, String, [String: Any]?) async throws -> Data

    private static let maxQueued = 60
    private static let maxBatchItems = 20
    /// Keeps a batch well below the server's JSON body limit.
    private static let maxBatchStackBytes = 1_500_000
    private static let maxStackBytes = 400_000

    private let lock = NSLock()
    private var isFlushing = false
    private let iso = ISO8601DateFormatter()

    private lazy var queueURL: URL? = {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let directory = base.appendingPathComponent("ClientDiagnostics", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var url = directory.appendingPathComponent("pending.json")
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
        return url
    }()

    func start() {
        MXMetricManager.shared.add(self)
    }

    // MARK: MXMetricManagerSubscriber

    func didReceive(_ payloads: [MXMetricPayload]) {
        enqueue(reports: payloads.map(summarize), diagnostics: [])
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        enqueue(reports: [], diagnostics: payloads.flatMap(diagnostics))
    }

    // MARK: Upload

    /// Uploads queued items in batches; anything unacknowledged stays queued.
    func flush(installId: String, deviceModel: String, systemVersion: String, using request: @escaping Request) async {
        guard beginFlush() else { return }
        defer { endFlush() }
        while true {
            let queue = load()
            guard !queue.reports.isEmpty || !queue.diagnostics.isEmpty else { return }
            let reports = Array(queue.reports.prefix(Self.maxBatchItems))
            var diagnostics: [[String: Any]] = []
            var stackBytes = 0
            for item in queue.diagnostics.prefix(Self.maxBatchItems) {
                let size = (item["callStack"] as? String)?.utf8.count ?? 0
                if !diagnostics.isEmpty, stackBytes + size > Self.maxBatchStackBytes { break }
                diagnostics.append(item)
                stackBytes += size
            }
            let body: [String: Any] = [
                "installId": installId,
                "deviceModel": deviceModel,
                "systemVersion": systemVersion,
                "appBinaryName": Bundle.main.infoDictionary?["CFBundleExecutable"] as? String ?? "CpuTime",
                "reports": reports,
                "diagnostics": diagnostics,
            ]
            do {
                _ = try await request("/api/app-clients/ios/metrics", "POST", body)
            } catch {
                return
            }
            remove(reports: reports.count, diagnostics: diagnostics.count)
        }
    }

    // MARK: Summaries

    private func summarize(_ payload: MXMetricPayload) -> [String: Any] {
        var report: [String: Any] = [
            "appVersion": Self.token(payload.latestApplicationVersion, fallback: Self.bundleValue("CFBundleShortVersionString")),
            "appBuild": Self.token(payload.metaData?.applicationBuildVersion, fallback: Self.bundleValue("CFBundleVersion")),
            "periodStart": iso.string(from: payload.timeStampBegin),
            "periodEnd": iso.string(from: payload.timeStampEnd),
        ]
        if let os = payload.metaData?.osVersion { report["systemVersion"] = Self.token(os, fallback: "", limit: 40) }
        let launch = Self.histogram(payload.applicationLaunchMetrics?.histogrammedTimeToFirstDraw)
        report["launchCount"] = launch.count
        report["launchMsAvg"] = launch.averageMs ?? NSNull()
        let resume = Self.histogram(payload.applicationLaunchMetrics?.histogrammedApplicationResumeTime)
        report["resumeCount"] = resume.count
        report["resumeMsAvg"] = resume.averageMs ?? NSNull()
        let hang = Self.histogram(payload.applicationResponsivenessMetrics?.histogrammedApplicationHangTime)
        report["hangCount"] = hang.count
        report["hangMsAvg"] = hang.averageMs ?? NSNull()
        var exits: [String: Any] = [:]
        if let foreground = payload.applicationExitMetrics?.foregroundExitData {
            exits["foreground"] = [
                "normal": foreground.cumulativeNormalAppExitCount,
                "abnormal": foreground.cumulativeAbnormalExitCount,
                "memoryLimit": foreground.cumulativeMemoryResourceLimitExitCount,
                "watchdog": foreground.cumulativeAppWatchdogExitCount,
                "badAccess": foreground.cumulativeBadAccessExitCount,
                "illegalInstruction": foreground.cumulativeIllegalInstructionExitCount,
            ]
        }
        if let background = payload.applicationExitMetrics?.backgroundExitData {
            exits["background"] = [
                "normal": background.cumulativeNormalAppExitCount,
                "abnormal": background.cumulativeAbnormalExitCount,
                "memoryLimit": background.cumulativeMemoryResourceLimitExitCount,
                "memoryPressure": background.cumulativeMemoryPressureExitCount,
                "watchdog": background.cumulativeAppWatchdogExitCount,
                "badAccess": background.cumulativeBadAccessExitCount,
                "illegalInstruction": background.cumulativeIllegalInstructionExitCount,
                "cpuResourceLimit": background.cumulativeCPUResourceLimitExitCount,
                "suspendedWithLockedFile": background.cumulativeSuspendedWithLockedFileExitCount,
                "backgroundTaskAssertionTimeout": background.cumulativeBackgroundTaskAssertionTimeoutExitCount,
            ]
        }
        report["exits"] = exits
        return report
    }

    private func diagnostics(_ payload: MXDiagnosticPayload) -> [[String: Any]] {
        let occurredAt = iso.string(from: payload.timeStampEnd)
        var items: [[String: Any]] = []
        for crash in payload.crashDiagnostics ?? [] {
            guard let stack = Self.attributedStack(crash.callStackTree) else { continue }
            var item = Self.base(kind: "crash", diagnostic: crash, occurredAt: occurredAt, stack: stack)
            item["exceptionType"] = crash.exceptionType?.intValue ?? NSNull()
            item["signal"] = crash.signal?.intValue ?? NSNull()
            item["terminationReason"] = crash.terminationReason.map { String($0.prefix(1000)) } ?? NSNull()
            if let reason = crash.exceptionReason {
                item["exceptionClassName"] = String(reason.className.prefix(200))
                item["exceptionMessage"] = String(reason.composedMessage.prefix(1000))
            }
            items.append(item)
        }
        for hang in payload.hangDiagnostics ?? [] {
            guard let stack = Self.attributedStack(hang.callStackTree) else { continue }
            var item = Self.base(kind: "hang", diagnostic: hang, occurredAt: occurredAt, stack: stack)
            item["hangDurationMs"] = hang.hangDuration.converted(to: .milliseconds).value
            items.append(item)
        }
        return items
    }

    private static func base(kind: String, diagnostic: MXDiagnostic, occurredAt: String, stack: String) -> [String: Any] {
        var item: [String: Any] = [
            "kind": kind,
            "appVersion": token(diagnostic.applicationVersion, fallback: bundleValue("CFBundleShortVersionString")),
            "appBuild": token(diagnostic.metaData.applicationBuildVersion, fallback: bundleValue("CFBundleVersion")),
            "occurredAt": occurredAt,
            "callStack": stack,
        ]
        let os = token(diagnostic.metaData.osVersion, fallback: "", limit: 40)
        if !os.isEmpty { item["systemVersion"] = os }
        return item
    }

    /// Keeps only the crashing / main thread: the other threads are rarely
    /// needed and can make one report several megabytes.
    private static func attributedStack(_ tree: MXCallStackTree) -> String? {
        let data = tree.jsonRepresentation()
        guard var json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        if let stacks = json["callStacks"] as? [[String: Any]] {
            let attributed = stacks.filter { $0["threadAttributed"] as? Bool == true }
            json["callStacks"] = attributed.isEmpty ? Array(stacks.prefix(1)) : attributed
        }
        guard let trimmed = try? JSONSerialization.data(withJSONObject: json),
              trimmed.count <= maxStackBytes else { return nil }
        return String(decoding: trimmed, as: UTF8.self)
    }

    private static func histogram(_ histogram: MXHistogram<UnitDuration>?) -> (count: Int, averageMs: Double?) {
        guard let histogram else { return (0, nil) }
        var count = 0
        var total = 0.0
        for case let bucket as MXHistogramBucket<UnitDuration> in histogram.bucketEnumerator {
            let start = bucket.bucketStart.converted(to: .milliseconds).value
            let end = bucket.bucketEnd.converted(to: .milliseconds).value
            count += bucket.bucketCount
            total += (start + end) / 2 * Double(bucket.bucketCount)
        }
        return (count, count > 0 ? (total / Double(count)).rounded() : nil)
    }

    /// Matches the server's field pattern so one odd value cannot reject a batch.
    private static func token(_ value: String?, fallback: String, limit: Int = 24) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_.,() -"))
        let cleaned = String((value ?? "").unicodeScalars.filter { allowed.contains($0) }).trimmingCharacters(in: .whitespaces)
        let result = cleaned.isEmpty ? fallback : cleaned
        return String(result.prefix(limit))
    }

    private static func bundleValue(_ key: String) -> String {
        Bundle.main.infoDictionary?[key] as? String ?? "0"
    }

    // MARK: Queue file

    private struct Queue {
        var reports: [[String: Any]] = []
        var diagnostics: [[String: Any]] = []
    }

    private func beginFlush() -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !isFlushing else { return false }
        isFlushing = true
        return true
    }

    private func endFlush() {
        lock.lock(); isFlushing = false; lock.unlock()
    }

    private func enqueue(reports: [[String: Any]], diagnostics: [[String: Any]]) {
        guard !reports.isEmpty || !diagnostics.isEmpty else { return }
        lock.lock(); defer { lock.unlock() }
        var queue = readLocked()
        queue.reports = Array((queue.reports + reports).suffix(Self.maxQueued))
        queue.diagnostics = Array((queue.diagnostics + diagnostics).suffix(Self.maxQueued))
        writeLocked(queue)
    }

    private func load() -> Queue {
        lock.lock(); defer { lock.unlock() }
        return readLocked()
    }

    /// Items arriving mid-upload are appended, so removing from the front
    /// never drops anything that was not sent.
    private func remove(reports: Int, diagnostics: Int) {
        lock.lock(); defer { lock.unlock() }
        var queue = readLocked()
        queue.reports.removeFirst(min(reports, queue.reports.count))
        queue.diagnostics.removeFirst(min(diagnostics, queue.diagnostics.count))
        writeLocked(queue)
    }

    private func readLocked() -> Queue {
        guard let url = queueURL, let data = try? Data(contentsOf: url),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return Queue() }
        return Queue(
            reports: json["reports"] as? [[String: Any]] ?? [],
            diagnostics: json["diagnostics"] as? [[String: Any]] ?? []
        )
    }

    private func writeLocked(_ queue: Queue) {
        guard let url = queueURL else { return }
        if queue.reports.isEmpty && queue.diagnostics.isEmpty {
            try? FileManager.default.removeItem(at: url)
            return
        }
        let json: [String: Any] = ["reports": queue.reports, "diagnostics": queue.diagnostics]
        guard let data = try? JSONSerialization.data(withJSONObject: json) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
