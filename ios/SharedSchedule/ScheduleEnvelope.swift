import Foundation
import CryptoKit

nonisolated enum ScheduleFailure: String, Error, LocalizedError, Codable {
    case invalidData, unsupportedVersion, storage, unavailable, notActivated, notPaired
    case notInstalled, loginRequired, awaitingFirstSync, syncFailed, sourceUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidData: return "课表数据无效，已保留上次课表。"
        case .unsupportedVersion: return "课表版本不受支持，请更新两端 App。"
        case .storage: return "无法读取或保存课表缓存，请稍后重试。"
        case .unavailable: return "设备暂时不可达，连接恢复后将同步最新课表。"
        case .notActivated: return "正在连接 Apple Watch，请稍后重试。"
        case .notPaired: return "尚未检测到已配对的 Apple Watch。"
        case .notInstalled: return "请在配对设备上安装药大拾间 App。"
        case .loginRequired: return "请先在 iPhone 打开教务页面并完成登录授权。"
        case .awaitingFirstSync: return "尚未收到首次课表，请在 iPhone 中打开课表并同步。"
        case .syncFailed: return "同步失败，已保留上次课表，请重试。"
        case .sourceUnavailable: return "暂时无法获取完整课表或校历，请在 iPhone 打开课表后重试。"
        }
    }
}

nonisolated struct WatchCourse: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let teacher: String?
    let room: String?
    let campus: String?
    let weekday: Int
    let startPeriod: Int
    let endPeriod: Int
    let startTime: String
    let endTime: String
    let weeks: [Int]
}

nonisolated struct SchedulePeriod: Codable, Equatable, Identifiable {
    let number: Int
    let startTime: String
    let endTime: String
    var id: Int { number }
}

nonisolated struct ScheduleSemester: Codable, Equatable {
    let id: String
    /// Monday of teaching week 1, derived from the existing calendar, never guessed.
    let startDate: String
    let endDate: String
    let weekCount: Int
}

nonisolated struct ScheduleCourseOccurrence: Equatable {
    let course: WatchCourse
    let date: Date
}

nonisolated struct ScheduleEnvelope: Codable, Equatable {
    static let currentVersion = 1
    static let maximumBytes = 60 * 1024 // Leave room for WCApplicationContext property-list overhead.
    static let staleInterval: TimeInterval = 24 * 60 * 60

    let schemaVersion: Int
    let messageType: String
    let generatedAt: Date
    let semester: ScheduleSemester
    let timezone: String
    let currentWeek: Int
    /// Only these weeks are known, including explicitly empty weeks.
    let coveredWeeks: [Int]
    /// The authoritative school-day slots supplied by the existing web schedule.
    /// Optional so a pre-upgrade cache can still be read until the next sync.
    let periods: [SchedulePeriod]?
    let courses: [WatchCourse]

    static func decode(_ data: Data) throws -> Self {
        guard data.count <= maximumBytes else { throw ScheduleFailure.invalidData }
        struct Header: Decodable { let schemaVersion: Int; let messageType: String }
        do {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .millisecondsSince1970
            let header = try decoder.decode(Header.self, from: data)
            guard header.schemaVersion == currentVersion, header.messageType == "schedule.snapshot" else {
                throw ScheduleFailure.unsupportedVersion
            }
            let value = try decoder.decode(Self.self, from: data)
            try value.validate()
            return value
        } catch let error as ScheduleFailure { throw error }
        catch { throw ScheduleFailure.invalidData }
    }

    func encoded() throws -> Data {
        try validate()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(self)
        guard data.count <= Self.maximumBytes else { throw ScheduleFailure.invalidData }
        return data
    }

    func fingerprint() throws -> String {
        SHA256.hash(data: try encoded()).map { String(format: "%02x", $0) }.joined()
    }

    func validate(now: Date = .now) throws {
        guard schemaVersion == Self.currentVersion, messageType == "schedule.snapshot" else {
            throw ScheduleFailure.unsupportedVersion
        }
        guard TimeZone(identifier: timezone) != nil,
              (1...64).contains(semester.weekCount),
              Self.validText(semester.id, maximum: 120),
              let start = date(semester.startDate), let end = date(semester.endDate), end >= start,
              calendar.component(.weekday, from: start) == 2,
              calendar.dateComponents([.day], from: start, to: end).day == semester.weekCount * 7 - 1,
              generatedAt.timeIntervalSince1970 > 0, generatedAt <= now.addingTimeInterval(300),
              currentWeek == week(on: generatedAt),
              !coveredWeeks.isEmpty, coveredWeeks == Array(Set(coveredWeeks)).sorted(),
              coveredWeeks.allSatisfy({ (1...semester.weekCount).contains($0) }),
              courses.count <= 500, Set(courses.map(\.id)).count == courses.count else {
            throw ScheduleFailure.invalidData
        }
        if let periods {
            guard !periods.isEmpty, periods.count <= 32,
                  periods.map(\.number) == Array(Set(periods.map(\.number))).sorted(),
                  periods.allSatisfy({ (1...32).contains($0.number)
                      && Self.minutes($0.startTime) != nil
                      && (Self.minutes($0.endTime) ?? 0) > (Self.minutes($0.startTime) ?? 0) }),
                  zip(periods, periods.dropFirst()).allSatisfy({
                      (Self.minutes($0.endTime) ?? 0) <= (Self.minutes($1.startTime) ?? 0)
                  }) else {
                throw ScheduleFailure.invalidData
            }
        }
        for course in courses {
            guard Self.validText(course.id, maximum: 128), Self.validText(course.name, maximum: 200),
                  [course.teacher, course.room, course.campus].allSatisfy({ $0 == nil || Self.validText($0!, maximum: 200, allowEmpty: true) }),
                  (1...7).contains(course.weekday), (1...32).contains(course.startPeriod),
                  (course.startPeriod...32).contains(course.endPeriod),
                  let start = Self.minutes(course.startTime), let end = Self.minutes(course.endTime), end > start,
                  !course.weeks.isEmpty, course.weeks == Array(Set(course.weeks)).sorted(),
                  course.weeks.allSatisfy({ coveredWeeks.contains($0) }) else {
                throw ScheduleFailure.invalidData
            }
            if let periods {
                let numbers = Set(periods.map(\.number))
                guard let start = periods.first(where: { $0.number == course.startPeriod }),
                      let end = periods.first(where: { $0.number == course.endPeriod }),
                      (course.startPeriod...course.endPeriod).allSatisfy(numbers.contains),
                      start.startTime == course.startTime, end.endTime == course.endTime else {
                    throw ScheduleFailure.invalidData
                }
            }
        }
    }

    /// New snapshots carry every authoritative slot. For a pre-upgrade cache,
    /// reconstruct only the occupied period numbers without inventing times.
    var displayPeriods: [SchedulePeriod] {
        if let periods, !periods.isEmpty { return periods }
        guard let last = courses.map(\.endPeriod).max(), last > 0 else { return [] }
        return (1...last).map { number in
            SchedulePeriod(
                number: number,
                startTime: courses.first(where: { $0.startPeriod == number })?.startTime ?? "",
                endTime: courses.first(where: { $0.endPeriod == number })?.endTime ?? ""
            )
        }
    }

    private static func validText(_ value: String, maximum: Int, allowEmpty: Bool = false) -> Bool {
        (allowEmpty || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            && value.count <= maximum && !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }

    var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: timezone) ?? TimeZone(secondsFromGMT: 0)!
        value.firstWeekday = 2
        return value
    }

    func date(_ text: String) -> Date? {
        guard text.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        guard let result = formatter.date(from: text), formatter.string(from: result) == text else { return nil }
        return result
    }

    func week(on date: Date) -> Int {
        guard let start = self.date(semester.startDate), let end = self.date(semester.endDate) else { return 0 }
        let day = calendar.startOfDay(for: date)
        guard day >= start, day <= end else { return 0 }
        return (calendar.dateComponents([.day], from: start, to: day).day ?? 0) / 7 + 1
    }

    func courses(on date: Date) -> [WatchCourse] {
        let week = week(on: date)
        let weekday = (calendar.component(.weekday, from: date) + 5) % 7 + 1
        return courses.filter { $0.weekday == weekday && $0.weeks.contains(week) }
            .sorted { ($0.startTime, $0.id) < ($1.startTime, $1.id) }
    }

    func currentCourse(at now: Date) -> WatchCourse? {
        let minutes = calendar.component(.hour, from: now) * 60 + calendar.component(.minute, from: now)
        return courses(on: now).first { (Self.minutes($0.startTime) ?? 0) <= minutes && minutes < (Self.minutes($0.endTime) ?? 0) }
    }

    func nextCourse(at now: Date) -> WatchCourse? {
        nextCourseOccurrence(at: now)?.course
    }

    /// Finds the next authoritative occurrence, including later days. Stop at
    /// the first uncovered week because a course there could be closer than any
    /// later cached result.
    func nextCourseOccurrence(at now: Date) -> ScheduleCourseOccurrence? {
        guard let semesterStart = date(semester.startDate), let semesterEnd = date(semester.endDate) else { return nil }
        let today = calendar.startOfDay(for: now)
        var day = max(today, semesterStart)
        guard day <= semesterEnd else { return nil }
        while day <= semesterEnd {
            let week = week(on: day)
            guard week == 0 || coveredWeeks.contains(week) else { return nil }
            let threshold = calendar.isDate(day, inSameDayAs: now)
                ? calendar.component(.hour, from: now) * 60 + calendar.component(.minute, from: now)
                : -1
            if let course = courses(on: day).first(where: { (Self.minutes($0.startTime) ?? 0) > threshold }) {
                return ScheduleCourseOccurrence(course: course, date: day)
            }
            guard let nextDay = calendar.date(byAdding: .day, value: 1, to: day) else { return nil }
            day = nextDay
        }
        return nil
    }

    func isStale(at now: Date) -> Bool {
        now.timeIntervalSince(generatedAt) > Self.staleInterval || week(on: now) == 0
    }

    static func minutes(_ value: String) -> Int? {
        guard value.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil else { return nil }
        let parts = value.split(separator: ":").compactMap { Int($0) }
        return parts[0] * 60 + parts[1]
    }
}
