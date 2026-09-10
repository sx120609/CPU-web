import Foundation
#if SWIFT_PACKAGE
import SharedConfiguration
#endif

nonisolated enum WatchScheduleWidgetConfiguration {
    static var appGroupIdentifier: String { AppGroupIdentifier.resolved() }
    static let cacheFileName = "watch-schedule-v1.json"
    static let kind = "cn.lizmt.cpuweb.watch.widget.next"

    static func sharedCacheURL(fileManager: FileManager = .default) -> URL? {
        fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)?
            .appendingPathComponent(cacheFileName)
    }

    static func legacyCacheURL(fileManager: FileManager = .default) -> URL {
        fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(cacheFileName)
    }

    static func migrateLegacyCacheIfNeeded(
        from legacyURL: URL,
        to sharedURL: URL,
        fileManager: FileManager = .default
    ) throws {
        guard !fileManager.fileExists(atPath: sharedURL.path),
              fileManager.fileExists(atPath: legacyURL.path) else { return }
        try fileManager.createDirectory(at: sharedURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try fileManager.copyItem(at: legacyURL, to: sharedURL)
    }

    static func courseStartDate(
        for occurrence: ScheduleCourseOccurrence,
        calendar: Calendar
    ) -> Date? {
        guard let minutes = ScheduleEnvelope.minutes(occurrence.course.startTime) else { return nil }
        return calendar.date(byAdding: .minute, value: minutes, to: calendar.startOfDay(for: occurrence.date))
    }

    static func dayOffset(from reference: Date, to date: Date, calendar: Calendar) -> Int? {
        calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: reference),
            to: calendar.startOfDay(for: date)
        ).day
    }

    /// The widget changes immediately after each displayed course starts, at
    /// which point the following course becomes the next one to attend.
    static func timelineDates(
        for snapshot: ScheduleEnvelope,
        startingAt now: Date,
        maximumCount: Int = 12
    ) -> [Date] {
        let limit = max(1, maximumCount)
        var dates = [now]
        var cursor = now

        while dates.count < limit,
              let occurrence = snapshot.nextCourseOccurrence(at: cursor),
              let start = courseStartDate(for: occurrence, calendar: snapshot.calendar) {
            let transition = start.addingTimeInterval(1)
            guard transition > cursor else { break }
            dates.append(transition)
            cursor = transition
        }
        return dates
    }
}
