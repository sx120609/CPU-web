import Foundation

nonisolated enum WatchScheduleWidgetConfiguration {
    static var appGroupIdentifier: String { AppGroupIdentifier.resolved() }
    static let cacheFileName = "watch-schedule-v1.json"
    static let kind = "cn.cputime.mobile.watch.widget.next"
    static let displayOptionsKey = "scheduleWidgetDisplayOptions"

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

/// Mirrors the iPhone widget preferences stored in the shared App Group. This
/// type intentionally lives in WatchShared so the Watch app and complication
/// can read the same JSON without depending on the iOS widget extension.
nonisolated struct WatchWidgetDisplayOptions: Codable, Equatable {
    var showCourseName: Bool
    var showRoom: Bool
    var showTeacher: Bool
    var showTime: Bool

    static let `default` = WatchWidgetDisplayOptions(
        showCourseName: true,
        showRoom: true,
        showTeacher: true,
        showTime: true
    )

    static func load(defaults: UserDefaults? = UserDefaults(suiteName: WatchScheduleWidgetConfiguration.appGroupIdentifier)) -> Self {
        guard let data = defaults?.data(forKey: WatchScheduleWidgetConfiguration.displayOptionsKey),
              let value = try? JSONDecoder().decode(Self.self, from: data) else {
            return .default
        }
        return value
    }

    func metadata(for course: WatchCourse) -> String? {
        [showRoom ? course.room : nil, showTeacher ? course.teacher : nil, course.campus]
            .compactMap { value in
                let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return trimmed.isEmpty ? nil : trimmed
            }
            .joined(separator: " · ")
            .nilIfEmpty
    }

    func primaryValue(for course: WatchCourse) -> String? {
        if showCourseName { return course.name }
        if showRoom { return course.room?.nilIfEmpty }
        if showTeacher { return course.teacher?.nilIfEmpty }
        if showTime { return "\(course.startTime) - \(course.endTime)" }
        return nil
    }
}

private extension String {
    var nilIfEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
