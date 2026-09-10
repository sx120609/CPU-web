import Foundation

@MainActor
protocol ScheduleStorage {
    func read() throws -> Data?
    func write(_ data: Data) throws
}

@MainActor
final class FileScheduleStorage: ScheduleStorage {
    private let url: URL
    init(url: URL) { self.url = url }

    static func local() -> FileScheduleStorage {
        let legacyURL = WatchScheduleWidgetConfiguration.legacyCacheURL()
        #if os(watchOS)
        if let sharedURL = WatchScheduleWidgetConfiguration.sharedCacheURL() {
            try? WatchScheduleWidgetConfiguration.migrateLegacyCacheIfNeeded(from: legacyURL, to: sharedURL)
            return FileScheduleStorage(url: sharedURL)
        }
        #endif
        return FileScheduleStorage(url: legacyURL)
    }

    func read() throws -> Data? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= ScheduleEnvelope.maximumBytes else { throw ScheduleFailure.invalidData }
        return try Data(contentsOf: url)
    }

    func write(_ data: Data) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        #if os(iOS) || os(watchOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url, options: .atomic)
        #endif
    }
}

@MainActor
final class CourseRepository {
    private let storage: any ScheduleStorage
    private(set) var snapshot: ScheduleEnvelope?
    private(set) var error: ScheduleFailure?

    init(storage: any ScheduleStorage) {
        self.storage = storage
        do {
            if let data = try storage.read() { snapshot = try ScheduleEnvelope.decode(data) }
        } catch let failure as ScheduleFailure { error = failure }
        catch { self.error = .storage }
    }

    /// A validated update. Partial coverage replaces only those weeks; validation
    /// and the atomic disk commit always precede publication.
    @discardableResult
    func accept(_ data: Data) throws -> ScheduleEnvelope {
        do {
            var value = try ScheduleEnvelope.decode(data)
            if let snapshot {
                if value.generatedAt < snapshot.generatedAt { return snapshot }
                if value.semester == snapshot.semester, value.timezone == snapshot.timezone,
                   (value.periods == nil
                    || !Set(value.coveredWeeks).isSuperset(of: Set(snapshot.coveredWeeks))) {
                    value = Self.merging(value, retainingUncoveredWeeksFrom: snapshot)
                }
            }
            let cleanData = try value.encoded() // Drop unknown fields before caching or forwarding.
            if snapshot != value { try storage.write(cleanData) }
            snapshot = value
            error = nil
            return value
        } catch let failure as ScheduleFailure {
            error = failure
            throw failure
        } catch {
            self.error = .storage
            throw ScheduleFailure.storage
        }
    }

    /// A newer week-only refresh replaces only the weeks it actually covers.
    /// This prevents a transient legacy/API fallback from discarding a complete
    /// semester that is already cached.
    private static func merging(
        _ incoming: ScheduleEnvelope,
        retainingUncoveredWeeksFrom existing: ScheduleEnvelope
    ) -> ScheduleEnvelope {
        let replacedWeeks = Set(incoming.coveredWeeks)
        var courses: [String: WatchCourse] = [:]
        for course in existing.courses {
            let retainedWeeks = course.weeks.filter { !replacedWeeks.contains($0) }
            if !retainedWeeks.isEmpty { courses[course.id] = course.with(weeks: retainedWeeks) }
        }
        for course in incoming.courses {
            let weeks = Set(courses[course.id]?.weeks ?? []).union(course.weeks).sorted()
            courses[course.id] = course.with(weeks: weeks)
        }
        return ScheduleEnvelope(
            schemaVersion: incoming.schemaVersion,
            messageType: incoming.messageType,
            generatedAt: incoming.generatedAt,
            semester: incoming.semester,
            timezone: incoming.timezone,
            currentWeek: incoming.currentWeek,
            coveredWeeks: Set(existing.coveredWeeks).union(incoming.coveredWeeks).sorted(),
            periods: incoming.periods ?? existing.periods,
            courses: courses.values.sorted { $0.id < $1.id }
        )
    }
}

private extension WatchCourse {
    func with(weeks: [Int]) -> WatchCourse {
        WatchCourse(
            id: id, name: name, teacher: teacher, room: room, campus: campus,
            weekday: weekday, startPeriod: startPeriod, endPeriod: endPeriod,
            startTime: startTime, endTime: endTime, weeks: weeks
        )
    }
}
