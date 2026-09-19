import Combine
import Foundation
import WebKit

// MARK: - Web bridge contract

/// The request passed to the authenticated WKWebView schedule bridge.
public struct NativeScheduleRequest: Hashable, Sendable {
    public let semester: String?
    public let week: String?
    public let force: Bool
    /// Background revalidation must never trigger a credential recovery flow.
    /// The visible grid stays usable while the bridge checks for changes.
    public let background: Bool

    public init(
        semester: String? = nil,
        week: String? = nil,
        force: Bool = false,
        background: Bool = false
    ) {
        self.semester = semester?.trimmedNonEmpty
        self.week = week?.trimmedNonEmpty
        self.force = force
        self.background = background
    }
}

/// A loader is supplied by the shell after its WKWebView has established the
/// web session. It should return the snapshot from
/// `window.CPUTimeNativeScheduleFetch(semester, week, force)`.
public typealias NativeScheduleLoader = @MainActor (NativeScheduleRequest) async throws -> NativeScheduleSnapshot

public enum NativeScheduleStoreError: LocalizedError, Equatable {
    case loaderUnavailable
    case webViewUnavailable
    case bridgeUnavailable
    case invalidResponse
    case unauthorized(String)
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .loaderUnavailable:
            return "课表服务尚未连接"
        case .webViewUnavailable:
            return "网页会话尚未准备好"
        case .bridgeUnavailable:
            return "暂时无法读取网页课表"
        case .invalidResponse:
            return "课表数据无法读取"
        case .unauthorized(let message):
            return message.trimmedNonEmpty ?? "教务授权已失效，请重新登录"
        case .server(let message):
            return message.trimmedNonEmpty ?? "课表服务暂时不可用"
        }
    }
}

// MARK: - Schedule models

public enum NativeScheduleSource: String, Codable, Sendable {
    case jwxt
    case graduate
    case cache
    case unknown

    public init(from decoder: Decoder) throws {
        let value = try String(from: decoder).lowercased()
        switch value {
        case "modern", "legacy", "undergraduate", "jwxt":
            self = .jwxt
        case "graduate":
            self = .graduate
        case "cache":
            self = .cache
        default:
            self = .unknown
        }
    }
}

public struct NativeScheduleAuth: Codable, Equatable, Sendable {
    public var authenticated: Bool
    public var identity: String?
    /// A non-reversible account fingerprint supplied by the web bridge. It
    /// scopes the on-disk timetable so a cold start never crosses accounts.
    public var account: String?

    public init(authenticated: Bool = false, identity: String? = nil, account: String? = nil) {
        self.authenticated = authenticated
        self.identity = identity
        self.account = account?.trimmedNonEmpty
    }
}

public struct NativeScheduleSemester: Codable, Identifiable, Equatable, Sendable {
    public let value: String
    public let label: String
    public let current: Bool

    public var id: String { value }

    public init(value: String, label: String, current: Bool = false) {
        self.value = value
        self.label = label
        self.current = current
    }

    private enum CodingKeys: String, CodingKey { case value, label, current }
    private enum LegacyCodingKeys: String, CodingKey { case value, label, current, selected, name, text, id, code }

    public init(from decoder: Decoder) throws {
        if let values = try? decoder.container(keyedBy: LegacyCodingKeys.self) {
            let value = try values.decodeFlexibleString(forKey: .value)
                ?? values.decodeFlexibleString(forKey: .id)
                ?? values.decodeFlexibleString(forKey: .code)
                ?? ""
            let label = try values.decodeFlexibleString(forKey: .label)
                ?? values.decodeFlexibleString(forKey: .name)
                ?? values.decodeFlexibleString(forKey: .text)
                ?? value
            self.init(value: value, label: label, current: values.decodeFlexibleBool(forKey: .current)
                ?? values.decodeFlexibleBool(forKey: .selected) ?? false)
            return
        }
        let single = try decoder.singleValueContainer()
        let value = (try? single.decode(String.self)) ?? (try? String(single.decode(Int.self))) ?? ""
        self.init(value: value, label: value)
    }
}

public struct NativeScheduleWeek: Codable, Identifiable, Equatable, Sendable {
    public let value: String
    public let label: String
    public let current: Bool

    public var id: String { value }

    public init(value: String, label: String, current: Bool = false) {
        self.value = value
        self.label = label
        self.current = current
    }

    private enum CodingKeys: String, CodingKey { case value, label, current }
    private enum LegacyCodingKeys: String, CodingKey { case value, label, current, selected, name, text, id, code }

    public init(from decoder: Decoder) throws {
        if let values = try? decoder.container(keyedBy: LegacyCodingKeys.self) {
            let value = try values.decodeFlexibleString(forKey: .value)
                ?? values.decodeFlexibleString(forKey: .id)
                ?? values.decodeFlexibleString(forKey: .code)
                ?? ""
            let label = try values.decodeFlexibleString(forKey: .label)
                ?? values.decodeFlexibleString(forKey: .name)
                ?? values.decodeFlexibleString(forKey: .text)
                ?? value
            self.init(value: value, label: label, current: values.decodeFlexibleBool(forKey: .current)
                ?? values.decodeFlexibleBool(forKey: .selected) ?? false)
            return
        }
        let single = try decoder.singleValueContainer()
        let value = (try? single.decode(String.self)) ?? (try? String(single.decode(Int.self))) ?? ""
        self.init(value: value, label: value)
    }
}

public struct NativeScheduleCourse: Codable, Identifiable, Equatable, Sendable {
    /// Stable occurrence identity supplied by the trusted schedule bridge. It
    /// excludes mutable presentation fields such as room and teacher.
    public let nativeId: String?
    public let name: String
    public let teacher: String?
    public let weeks: String
    public let weekList: [Int]
    public let location: String?
    public let slotNote: String?
    public let startSlot: Int?
    public let endSlot: Int?
    public let sourceKey: String?
    public let customId: String?
    public let custom: Bool
    public let orphaned: Bool

    public var id: String {
        if let customId = customId?.trimmedNonEmpty { return "custom:\(customId)" }
        if let sourceKey = sourceKey?.trimmedNonEmpty { return sourceKey }
        return [name, teacher, location, weeks, startSlot.map(String.init), endSlot.map(String.init)]
            .compactMap { $0?.trimmedNonEmpty }
            .joined(separator: "|")
    }

    public init(
        nativeId: String? = nil,
        name: String,
        teacher: String? = nil,
        weeks: String = "",
        weekList: [Int] = [],
        location: String? = nil,
        slotNote: String? = nil,
        startSlot: Int? = nil,
        endSlot: Int? = nil,
        sourceKey: String? = nil,
        customId: String? = nil,
        custom: Bool = false,
        orphaned: Bool = false
    ) {
        self.nativeId = nativeId?.trimmedNonEmpty
        self.name = name
        self.teacher = teacher?.trimmedNonEmpty
        self.weeks = weeks
        self.weekList = weekList
        self.location = location?.trimmedNonEmpty
        self.slotNote = slotNote?.trimmedNonEmpty
        self.startSlot = startSlot
        self.endSlot = endSlot
        self.sourceKey = sourceKey?.trimmedNonEmpty
        self.customId = customId?.trimmedNonEmpty
        self.custom = custom
        self.orphaned = orphaned
    }

    private enum CodingKeys: String, CodingKey {
        case nativeId, name, teacher, weeks, weekList, location, slotNote, startSlot, endSlot
        case sourceKey, customId, custom, orphaned
    }

    public init(from decoder: Decoder) throws {
        guard let values = try? decoder.container(keyedBy: CodingKeys.self) else {
            let single = try decoder.singleValueContainer()
            self.init(name: (try? single.decode(String.self)) ?? "课程")
            return
        }
        self.init(
            nativeId: try values.decodeFlexibleString(forKey: .nativeId),
            name: try values.decodeFlexibleString(forKey: .name) ?? "课程",
            teacher: try values.decodeFlexibleString(forKey: .teacher),
            weeks: try values.decodeFlexibleString(forKey: .weeks) ?? "",
            weekList: try values.decodeFlexibleIntArray(forKey: .weekList),
            location: try values.decodeFlexibleString(forKey: .location),
            slotNote: try values.decodeFlexibleString(forKey: .slotNote),
            startSlot: try values.decodeFlexibleInt(forKey: .startSlot),
            endSlot: try values.decodeFlexibleInt(forKey: .endSlot),
            sourceKey: try values.decodeFlexibleString(forKey: .sourceKey),
            customId: try values.decodeFlexibleString(forKey: .customId),
            custom: values.decodeFlexibleBool(forKey: .custom) ?? false,
            orphaned: values.decodeFlexibleBool(forKey: .orphaned) ?? false
        )
    }
}

public struct NativeSchedulePeriod: Codable, Equatable, Sendable {
    public let number: Int
    public let startTime: String
    public let endTime: String

    /// Compatibility table for a deployed web bridge that predates the
    /// `periods` field. Keep this aligned with the web schedule slots.
    public static let bundledTimetable = [
        NativeSchedulePeriod(number: 1, startTime: "08:00", endTime: "08:45"),
        NativeSchedulePeriod(number: 2, startTime: "08:55", endTime: "09:40"),
        NativeSchedulePeriod(number: 3, startTime: "09:55", endTime: "10:40"),
        NativeSchedulePeriod(number: 4, startTime: "10:50", endTime: "11:35"),
        NativeSchedulePeriod(number: 5, startTime: "13:30", endTime: "14:15"),
        NativeSchedulePeriod(number: 6, startTime: "14:25", endTime: "15:10"),
        NativeSchedulePeriod(number: 7, startTime: "15:25", endTime: "16:10"),
        NativeSchedulePeriod(number: 8, startTime: "16:20", endTime: "17:05"),
        NativeSchedulePeriod(number: 9, startTime: "18:30", endTime: "19:15"),
        NativeSchedulePeriod(number: 10, startTime: "19:25", endTime: "20:10"),
        NativeSchedulePeriod(number: 11, startTime: "20:20", endTime: "21:05")
    ]

    /// Older bridges may report the former twelfth-slot marker. Clamp it to
    /// the last real period before native or Watch code looks up times.
    static func normalizedRange(
        bigSlot: Int,
        startSlot: Int?,
        endSlot: Int?,
        periods: [NativeSchedulePeriod]
    ) -> (start: Int, end: Int) {
        let available = periods.map(\.number)
        let minimum = available.min() ?? 1
        let maximum = available.max() ?? minimum
        let fallbackStart = min(max(bigSlot * 2 - 1, minimum), maximum)
        let fallbackEnd = min(max(bigSlot * 2, fallbackStart), maximum)
        let start = min(max(startSlot ?? fallbackStart, minimum), maximum)
        let end = min(max(endSlot ?? fallbackEnd, start), maximum)
        return (start, end)
    }

    public init(number: Int, startTime: String, endTime: String) {
        self.number = number
        self.startTime = startTime
        self.endTime = endTime
    }

    private enum CodingKeys: String, CodingKey { case number, id, startTime, endTime, start, end }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            number: try values.decodeFlexibleInt(forKey: .number)
                ?? values.decodeFlexibleInt(forKey: .id) ?? 0,
            startTime: try values.decodeFlexibleString(forKey: .startTime)
                ?? values.decodeFlexibleString(forKey: .start) ?? "",
            endTime: try values.decodeFlexibleString(forKey: .endTime)
                ?? values.decodeFlexibleString(forKey: .end) ?? ""
        )
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(number, forKey: .number)
        try values.encode(startTime, forKey: .startTime)
        try values.encode(endTime, forKey: .endTime)
    }
}

public struct NativeScheduleAdjustment: Codable, Equatable, Sendable {
    public let date: String
    public let kind: String
    public let source: String?
    public let note: String?

    public init(date: String, kind: String, source: String? = nil, note: String? = nil) {
        self.date = date
        self.kind = kind
        self.source = source
        self.note = note
    }
}

/// The same edit payload used by the Web timetable. Keeping this contract in
/// the native target lets the iOS editor persist through the authenticated Web
/// session instead of maintaining a second, incompatible edit store.
public struct NativeScheduleCustomItem: Codable, Equatable, Sendable {
    public var id: String
    public var sourceKey: String?
    public var day: Int
    public var bigSlot: Int
    public var course: NativeScheduleCourse

    public init(id: String, sourceKey: String? = nil, day: Int, bigSlot: Int, course: NativeScheduleCourse) {
        self.id = id
        self.sourceKey = sourceKey
        self.day = day
        self.bigSlot = bigSlot
        self.course = course
    }
}

public struct NativeScheduleEditState: Codable, Equatable, Sendable {
    public var hidden: [String]
    public var custom: [NativeScheduleCustomItem]

    public init(hidden: [String] = [], custom: [NativeScheduleCustomItem] = []) {
        self.hidden = hidden
        self.custom = custom
    }
}

public struct NativeScheduleCell: Codable, Identifiable, Equatable, Sendable {
    public let day: Int
    public let bigSlot: Int
    public let courses: [NativeScheduleCourse]

    public var id: String { "\(day)-\(bigSlot)" }

    public init(day: Int, bigSlot: Int, courses: [NativeScheduleCourse] = []) {
        self.day = day
        self.bigSlot = bigSlot
        self.courses = courses
    }

    private enum CodingKeys: String, CodingKey { case day, bigSlot, courses }
    private enum LegacyCodingKeys: String, CodingKey { case day, weekday, weekDay, dayOfWeek, bigSlot, slot, section, lesson, period, courses, course, items }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: LegacyCodingKeys.self)
        let day = try values.decodeFlexibleInt(forKey: .day)
            ?? values.decodeFlexibleInt(forKey: .weekday)
            ?? values.decodeFlexibleInt(forKey: .weekDay)
            ?? values.decodeFlexibleInt(forKey: .dayOfWeek) ?? 0
        let bigSlot = try values.decodeFlexibleInt(forKey: .bigSlot)
            ?? values.decodeFlexibleInt(forKey: .slot)
            ?? values.decodeFlexibleInt(forKey: .section)
            ?? values.decodeFlexibleInt(forKey: .lesson)
            ?? values.decodeFlexibleInt(forKey: .period) ?? 0
        let courses: [NativeScheduleCourse]
        if let decoded = try? values.decode([NativeScheduleCourse].self, forKey: .courses) {
            courses = decoded
        } else if let decoded = try? values.decode([NativeScheduleCourse].self, forKey: .items) {
            courses = decoded
        } else if let decoded = try? values.decode(NativeScheduleCourse.self, forKey: .course) {
            courses = [decoded]
        } else {
            courses = []
        }
        self.init(day: day, bigSlot: bigSlot, courses: courses)
    }
}

public struct NativeCalendarWeek: Codable, Identifiable, Equatable, Sendable {
    public let week: Int
    public let days: [String]
    public let monday: String
    public let sunday: String

    public var id: Int { week }

    public init(week: Int, days: [String] = [], monday: String = "", sunday: String = "") {
        self.week = week
        self.days = days
        self.monday = monday
        self.sunday = sunday
    }

    private enum CodingKeys: String, CodingKey { case week, days, monday, sunday }
    private enum LegacyCodingKeys: String, CodingKey { case week, days, monday, sunday, start, end }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: LegacyCodingKeys.self)
        let week = try values.decodeFlexibleInt(forKey: .week) ?? 0
        let days = (try? values.decode([String].self, forKey: .days)) ?? []
        let monday = try values.decodeFlexibleString(forKey: .monday)
            ?? values.decodeFlexibleString(forKey: .start) ?? days.first ?? ""
        let sunday = try values.decodeFlexibleString(forKey: .sunday)
            ?? values.decodeFlexibleString(forKey: .end) ?? days.last ?? ""
        self.init(week: week, days: days, monday: monday, sunday: sunday)
    }
}

public struct NativeScheduleCalendar: Codable, Equatable, Sendable {
    public let source: NativeScheduleSource?
    public let semesters: [NativeScheduleSemester]
    public let currentSemester: String
    public let currentWeek: Int
    public let semesterStart: String
    public let semesterEnd: String
    public let weeks: [NativeCalendarWeek]
    public let periods: [NativeSchedulePeriod]
    public let adjustments: [NativeScheduleAdjustment]

    public init(
        source: NativeScheduleSource? = nil,
        semesters: [NativeScheduleSemester] = [],
        currentSemester: String = "",
        currentWeek: Int = 0,
        semesterStart: String = "",
        semesterEnd: String = "",
        weeks: [NativeCalendarWeek] = [],
        periods: [NativeSchedulePeriod] = [],
        adjustments: [NativeScheduleAdjustment] = []
    ) {
        self.source = source
        self.semesters = semesters
        self.currentSemester = currentSemester
        self.currentWeek = currentWeek
        self.semesterStart = semesterStart
        self.semesterEnd = semesterEnd
        self.weeks = weeks
        self.periods = periods
        self.adjustments = adjustments
    }

    private enum CodingKeys: String, CodingKey {
        case source, semesters, currentSemester, currentWeek, semesterStart, semesterEnd, weeks, periods, adjustments
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let decodedWeeks = try values.decodeIfPresent([NativeCalendarWeek].self, forKey: .weeks) ?? []
        let decodedCurrentWeek = try values.decodeFlexibleInt(forKey: .currentWeek) ?? 0
        // Older schedule payloads did not mark a current week. Keep the
        // calendar usable by selecting its first advertised week instead of
        // leaving SwiftUI with week zero and an empty grid.
        let advertisedWeeks = Set(decodedWeeks.map(\.week).filter { $0 > 0 })
        let currentWeek = decodedCurrentWeek > 0
            && (advertisedWeeks.isEmpty || advertisedWeeks.contains(decodedCurrentWeek))
            ? decodedCurrentWeek
            : decodedWeeks.first(where: { $0.week > 0 })?.week ?? 0
        self.init(
            source: try values.decodeIfPresent(NativeScheduleSource.self, forKey: .source),
            semesters: try values.decodeIfPresent([NativeScheduleSemester].self, forKey: .semesters) ?? [],
            currentSemester: try values.decodeIfPresent(String.self, forKey: .currentSemester) ?? "",
            currentWeek: currentWeek,
            semesterStart: try values.decodeIfPresent(String.self, forKey: .semesterStart) ?? "",
            semesterEnd: try values.decodeIfPresent(String.self, forKey: .semesterEnd) ?? "",
            weeks: decodedWeeks,
            periods: try values.decodeIfPresent([NativeSchedulePeriod].self, forKey: .periods) ?? [],
            adjustments: try values.decodeIfPresent([NativeScheduleAdjustment].self, forKey: .adjustments) ?? []
        )
    }
}

public struct NativeScheduleResult: Codable, Equatable, Sendable {
    public let source: NativeScheduleSource?
    public let semesters: [NativeScheduleSemester]
    public let weeks: [NativeScheduleWeek]
    public let currentSemester: String
    public let currentWeek: String
    public let cells: [NativeScheduleCell]

    public init(
        source: NativeScheduleSource? = nil,
        semesters: [NativeScheduleSemester] = [],
        weeks: [NativeScheduleWeek] = [],
        currentSemester: String = "",
        currentWeek: String = "",
        cells: [NativeScheduleCell] = []
    ) {
        self.source = source
        self.semesters = semesters
        self.weeks = weeks
        self.currentSemester = currentSemester
        self.currentWeek = currentWeek
        self.cells = cells
    }

    private enum CodingKeys: String, CodingKey {
        case source, semesters, weeks, currentSemester, currentWeek, cells
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let decodedWeeks = (try? values.decodeIfPresent([NativeScheduleWeek].self, forKey: .weeks)) ?? []
        let weeks = decodedWeeks.contains(where: { $0.current })
            ? decodedWeeks
            : decodedWeeks.enumerated().map { index, week in
                NativeScheduleWeek(value: week.value, label: week.label, current: index == 0)
            }
        let decodedCurrentWeek = try values.decodeFlexibleString(forKey: .currentWeek) ?? ""
        let advertisedWeeks = Set(weeks.compactMap { Int($0.value) }.filter { $0 > 0 })
        let usableCurrentWeek = decodedCurrentWeek.trimmedNonEmpty.flatMap { value in
            guard let number = Int(value) else { return value }
            guard number > 0, advertisedWeeks.isEmpty || advertisedWeeks.contains(number) else { return nil }
            return value
        }
        let currentWeek = usableCurrentWeek
            ?? weeks.first(where: { $0.current })?.value
            ?? weeks.first?.value
        self.init(
            source: try values.decodeIfPresent(NativeScheduleSource.self, forKey: .source),
            semesters: (try? values.decodeIfPresent([NativeScheduleSemester].self, forKey: .semesters)) ?? [],
            weeks: weeks,
            currentSemester: try values.decodeFlexibleString(forKey: .currentSemester) ?? "",
            currentWeek: currentWeek ?? "",
            cells: (try? values.decodeIfPresent([NativeScheduleCell].self, forKey: .cells)) ?? []
        )
    }
}

/// The JSON object published by the web layer. `data.cells` already includes
/// the user's hidden and custom-course edits, so native rendering does not
/// apply a second edit pass.
public struct NativeScheduleSnapshot: Codable, Equatable, Sendable {
    public let version: Int
    public let completeSemester: Bool
    /// True when a newer selection superseded this request before it could
    /// produce a usable schedule. This is a normal race outcome, not an error.
    public let cancelled: Bool
    public let source: NativeScheduleSource
    public let fetchedAt: Date?
    public let periods: [NativeSchedulePeriod]
    public let data: NativeScheduleResult?
    public let calendar: NativeScheduleCalendar?
    public let auth: NativeScheduleAuth
    public let error: String?

    public init(
        version: Int = 1,
        completeSemester: Bool = false,
        cancelled: Bool = false,
        source: NativeScheduleSource = .unknown,
        fetchedAt: Date? = nil,
        periods: [NativeSchedulePeriod] = [],
        data: NativeScheduleResult? = nil,
        calendar: NativeScheduleCalendar? = nil,
        auth: NativeScheduleAuth = NativeScheduleAuth(),
        error: String? = nil
    ) {
        self.version = version
        self.completeSemester = completeSemester
        self.cancelled = cancelled
        self.source = source
        self.fetchedAt = fetchedAt
        self.periods = periods.isEmpty ? NativeSchedulePeriod.bundledTimetable : periods
        self.data = data
        self.calendar = calendar
        self.auth = auth
        self.error = error?.trimmedNonEmpty
    }

    private enum CodingKeys: String, CodingKey {
        case version, completeSemester, cancelled, source, fetchedAt, periods, data, calendar, auth, error
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            version: try values.decodeIfPresent(Int.self, forKey: .version) ?? 1,
            completeSemester: try values.decodeIfPresent(Bool.self, forKey: .completeSemester) ?? false,
            cancelled: try values.decodeIfPresent(Bool.self, forKey: .cancelled) ?? false,
            source: try values.decodeIfPresent(NativeScheduleSource.self, forKey: .source) ?? .unknown,
            fetchedAt: try values.decodeFlexibleDate(forKey: .fetchedAt),
            periods: try values.decodeIfPresent([NativeSchedulePeriod].self, forKey: .periods) ?? [],
            data: try values.decodeIfPresent(NativeScheduleResult.self, forKey: .data),
            calendar: try values.decodeIfPresent(NativeScheduleCalendar.self, forKey: .calendar),
            auth: try values.decodeIfPresent(NativeScheduleAuth.self, forKey: .auth) ?? NativeScheduleAuth(),
            error: try values.decodeIfPresent(String.self, forKey: .error)
        )
    }
}

/// A platform-neutral timetable block used by the native schedule renderer.
/// Keeping the merge step in the shared target lets the iOS view and its
/// regression checks use exactly the same course identity rules.
public struct NativeScheduleCourseBlockRecord: Equatable, Sendable {
    public let id: String
    public let course: NativeScheduleCourse
    public let bigSlot: Int
    public let startSlot: Int
    public let endSlot: Int

    public init(
        id: String,
        course: NativeScheduleCourse,
        bigSlot: Int,
        startSlot: Int,
        endSlot: Int
    ) {
        self.id = id
        self.course = course
        self.bigSlot = bigSlot
        self.startSlot = startSlot
        self.endSlot = endSlot
    }
}

public enum NativeScheduleCourseBlockMerger {
    /// Merge repeated records for the same occurrence while retaining distinct
    /// teachers, rooms and adjacent classes as separate courses. Week text is
    /// occurrence metadata, so a different week range alone must not create a
    /// second card.
    public static func merge(_ blocks: [NativeScheduleCourseBlockRecord]) -> [NativeScheduleCourseBlockRecord] {
        var merged: [NativeScheduleCourseBlockRecord] = []
        for block in blocks.sorted(by: { ($0.startSlot, $0.endSlot, $0.id) < ($1.startSlot, $1.endSlot, $1.id) }) {
            guard let index = merged.firstIndex(where: { canMerge($0, block) }) else {
                merged.append(NativeScheduleCourseBlockRecord(
                    id: block.id,
                    course: courseWithRange(
                        block.course,
                        merging: nil,
                        startSlot: block.startSlot,
                        endSlot: block.endSlot
                    ),
                    bigSlot: max(1, Int(ceil(Double(block.startSlot) / 2))),
                    startSlot: block.startSlot,
                    endSlot: block.endSlot
                ))
                continue
            }
            let previous = merged[index]
            let start = min(previous.startSlot, block.startSlot)
            let end = max(previous.endSlot, block.endSlot)
            merged[index] = NativeScheduleCourseBlockRecord(
                id: previous.id,
                course: courseWithRange(
                    previous.course,
                    merging: block.course,
                    startSlot: start,
                    endSlot: end
                ),
                bigSlot: max(1, Int(ceil(Double(start) / 2))),
                startSlot: start,
                endSlot: end
            )
        }
        return merged.sorted { ($0.startSlot, $0.endSlot, $0.id) < ($1.startSlot, $1.endSlot, $1.id) }
    }

    private static func canMerge(
        _ left: NativeScheduleCourseBlockRecord,
        _ right: NativeScheduleCourseBlockRecord
    ) -> Bool {
        let a = left.course
        let b = right.course
        if let aCustom = a.customId?.trimmedNonEmpty, let bCustom = b.customId?.trimmedNonEmpty {
            return aCustom == bCustom && rangesOverlap(left, right)
        }
        if a.customId != nil || b.customId != nil { return false }
        let sameName = identityPart(a.name) == identityPart(b.name)
        let compatibleTeacher = compatibleTeacher(a.teacher, b.teacher)
        let compatibleLocation = locationCompatible(a.location, b.location)
        let sameSource = a.sourceKey?.trimmedNonEmpty != nil
            && a.sourceKey == b.sourceKey
        guard sameName, compatibleTeacher, compatibleLocation else { return false }
        guard rangesOverlap(left, right) || sameSource && rangesAdjacent(left, right) else { return false }
        if left.startSlot == right.startSlot, left.endSlot == right.endSlot,
           sameVisibleOccurrence(a, b) {
            return true
        }
        // `sourceKey`/`nativeId` are the only stable identity supplied by the
        // bridge for parallel sections that share all visible fields. Treat
        // generated official ids as fallbacks because repeated physical rows
        // intentionally reuse them and still need to collapse.
        let leftIdentity = explicitIdentity(a)
        let rightIdentity = explicitIdentity(b)
        if let leftIdentity, let rightIdentity, leftIdentity != rightIdentity {
            // JWXT may assign a new id to a repeated physical row. A subset
            // week range identifies that duplicate; equal or disjoint ranges
            // remain independent teaching groups.
            guard weekListsCanIndicateRepeatedRow(a, b) else { return false }
        }
        return true
    }

    private static func sameVisibleOccurrence(
        _ left: NativeScheduleCourse,
        _ right: NativeScheduleCourse
    ) -> Bool {
        let a = left.weekList.filter { $0 > 0 }
        let b = right.weekList.filter { $0 > 0 }
        let sameWeeks = !a.isEmpty && !b.isEmpty
            ? a == b
            : keyPart(left.weeks) == keyPart(right.weeks)
        return identityPart(left.name) == identityPart(right.name)
            && compatibleTeacher(left.teacher, right.teacher)
            && locationCompatible(left.location, right.location)
            && sameWeeks
    }

    private static func weekListsCanIndicateRepeatedRow(
        _ left: NativeScheduleCourse,
        _ right: NativeScheduleCourse
    ) -> Bool {
        let a = Set(left.weekList.filter { $0 > 0 })
        let b = Set(right.weekList.filter { $0 > 0 })
        if a.isEmpty || b.isEmpty { return true }
        if a.count == b.count { return false }
        return a.isSubset(of: b) || b.isSubset(of: a)
    }

    private static func explicitIdentity(_ course: NativeScheduleCourse) -> String? {
        guard let native = course.nativeId?.trimmedNonEmpty,
              native.hasPrefix("source:") || native.hasPrefix("custom:") else { return nil }
        return native
    }

    private static func rangesOverlap(
        _ left: NativeScheduleCourseBlockRecord,
        _ right: NativeScheduleCourseBlockRecord
    ) -> Bool {
        left.startSlot <= right.endSlot && right.startSlot <= left.endSlot
    }

    private static func rangesAdjacent(
        _ left: NativeScheduleCourseBlockRecord,
        _ right: NativeScheduleCourseBlockRecord
    ) -> Bool {
        left.endSlot + 1 == right.startSlot || right.endSlot + 1 == left.startSlot
    }

    private static func compatibleTeacher(_ left: String?, _ right: String?) -> Bool {
        let a = teacherTokens(left)
        let b = teacherTokens(right)
        return a.isEmpty || b.isEmpty || a.contains(where: { b.contains($0) })
    }

    private static func teacherTokens(_ value: String?) -> [String] {
        keyPart(value)
            .lowercased()
            .split { "、,，;；/&+和".contains($0) }
            .map { teacherIdentity(String($0)) }
            .filter { !$0.isEmpty }
    }

    private static func locationCompatible(_ left: String?, _ right: String?) -> Bool {
        let a = locationIdentity(left)
        let b = locationIdentity(right)
        return a.isEmpty || b.isEmpty || a == b
    }

    private static func identityPart(_ value: String?) -> String {
        keyPart(value)
            .lowercased()
            .unicodeScalars
            .filter { scalar in
                !CharacterSet.whitespacesAndNewlines.contains(scalar)
                    && !CharacterSet.punctuationCharacters.contains(scalar)
                    && !CharacterSet.symbols.contains(scalar)
            }
            .map(String.init)
            .joined()
    }

    private static func teacherIdentity(_ value: String?) -> String {
        identityPart(value).replacingOccurrences(
            of: #"(?:其他正高级|其他副高级|正高级|副高级|主任医师|副主任医师|高级实验师|副研究员|实验师|研究员|副教授|教授|讲师|助教|未评级)$"#,
            with: "",
            options: .regularExpression
        ).replacingOccurrences(of: "老师$", with: "", options: .regularExpression)
    }

    private static func locationIdentity(_ value: String?) -> String {
        let compact = identityPart(value)
        guard !compact.isEmpty else { return "" }
        if let range = compact.range(of: #"[a-z]?\d{2,4}[a-z]?$"#, options: .regularExpression) {
            let token = String(compact[range])
            let prefix = String(compact[..<range.lowerBound])
            let boundary = prefix.unicodeScalars.last.map { scalar in
                !((48...57).contains(scalar.value) || (97...122).contains(scalar.value))
            } ?? true
            if boundary {
                return token
            }
        }
        return compact
    }

    private static func courseWithRange(
        _ course: NativeScheduleCourse,
        merging next: NativeScheduleCourse?,
        startSlot: Int,
        endSlot: Int
    ) -> NativeScheduleCourse {
        let weekList = Set((course.weekList + (next?.weekList ?? [])).filter { $0 > 0 }).sorted()
        let weeks: String
        if let next, keyPart(course.weeks) != keyPart(next.weeks), !weekList.isEmpty {
            weeks = formatWeeks(weekList)
        } else {
            weeks = course.weeks.trimmedNonEmpty ?? next?.weeks.trimmedNonEmpty ?? ""
        }
        let slotNote = startSlot == endSlot
            ? "\(String(format: "%02d", startSlot))节"
            : "\(String(format: "%02d", startSlot))-\(String(format: "%02d", endSlot))节"
        return NativeScheduleCourse(
            nativeId: course.nativeId ?? next?.nativeId,
            name: course.name,
            teacher: course.teacher ?? next?.teacher,
            weeks: weeks,
            weekList: weekList,
            location: course.location ?? next?.location,
            slotNote: slotNote,
            startSlot: startSlot,
            endSlot: endSlot,
            sourceKey: course.sourceKey,
            customId: course.customId,
            custom: course.custom,
            orphaned: course.orphaned
        )
    }

    private static func formatWeeks(_ values: [Int]) -> String {
        guard let first = values.first else { return "" }
        var ranges: [String] = []
        var start = first
        var end = first
        for value in values.dropFirst() {
            if value == end + 1 {
                end = value
            } else {
                ranges.append(start == end ? "\(start)" : "\(start)-\(end)")
                start = value
                end = value
            }
        }
        ranges.append(start == end ? "\(start)" : "\(start)-\(end)")
        return "\(ranges.joined(separator: "、"))周"
    }

    private static func keyPart(_ value: String?) -> String {
        (value ?? "")
            .precomposedStringWithCompatibilityMapping
            .replacingOccurrences(of: "[\u{200B}-\u{200D}\u{FEFF}]", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }
}

// MARK: - Cold-start archive

/// The last displayed timetable, kept so a relaunch can show it before the web
/// session finishes restoring. Always scoped to one account fingerprint.
public struct NativeScheduleArchivedSchedule: Codable, Equatable, Sendable {
    /// The web account fingerprint, empty on web builds that do not send one.
    public let account: String
    /// A fingerprint of the web session cookie. The archive is only ever shown
    /// again while the same signed-in session is still present, so this is the
    /// check that keeps one account's timetable away from another's.
    public let session: String
    public let semester: String
    public let week: String
    public let savedAt: Date
    public let snapshot: NativeScheduleSnapshot

    public init(account: String, session: String, semester: String, week: String,
                savedAt: Date, snapshot: NativeScheduleSnapshot) {
        self.account = account
        self.session = session
        self.semester = semester
        self.week = week
        self.savedAt = savedAt
        self.snapshot = snapshot
    }
}

public protocol NativeScheduleArchive: AnyObject {
    func read() -> NativeScheduleArchivedSchedule?
    func write(_ record: NativeScheduleArchivedSchedule)
    func removeAll()
}

/// File-backed archive in Application Support. iOS protects the file until the
/// device is first unlocked, and it is excluded from backups because it only
/// mirrors data the schedule service can return again.
public final class NativeScheduleFileArchive: NativeScheduleArchive {
    private let url: URL?

    // The native timetable payload has had several normalization revisions.
    // Keep a revisioned archive name so an upgrade cannot paint an old grid
    // (including pre-deduplication course records) before the Web bridge has
    // had a chance to fetch the current semester.
    public init(fileName: String = "native-schedule-latest-v2.json") {
        // A tool or test process has no bundle identifier; stay memory-only.
        guard let bundleIdentifier = Bundle.main.bundleIdentifier,
              let base = try? FileManager.default.url(
                  for: .applicationSupportDirectory, in: .userDomainMask,
                  appropriateFor: nil, create: true) else {
            url = nil
            return
        }
        var directory = base.appendingPathComponent(bundleIdentifier, isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try? directory.setResourceValues(resourceValues)
        url = directory.appendingPathComponent(fileName, isDirectory: false)
    }

    public func read() -> NativeScheduleArchivedSchedule? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder.nativeScheduleDecoder.decode(NativeScheduleArchivedSchedule.self, from: data)
    }

    public func write(_ record: NativeScheduleArchivedSchedule) {
        // ISO8601 on both sides; the flexible decoder cannot read the
        // encoder's default reference-date doubles as fetch timestamps.
        guard let url, let data = try? JSONEncoder.nativeScheduleEncoder.encode(record) else { return }
        try? data.write(to: url, options: .atomic)
    }

    public func removeAll() {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

// MARK: - Store state

public enum NativeScheduleState: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case stale
    case unauthorized
    case failed
}

/// A lightweight native equivalent of Web's official timetable change notice.
/// The detailed edit state remains owned by the Web bridge; this value only
/// carries enough information for the native surface to prompt a re-check.
public struct NativeScheduleChangeNotice: Identifiable, Equatable, Sendable {
    public let id: String
    public let semester: String
    public let changedCount: Int
    public let details: [String]

    public init(id: String, semester: String, changedCount: Int, details: [String]) {
        self.id = id
        self.semester = semester
        self.changedCount = changedCount
        self.details = details
    }
}

@MainActor
public final class NativeScheduleStore: ObservableObject {
    @Published public private(set) var state: NativeScheduleState = .idle
    @Published public private(set) var result: NativeScheduleResult?
    @Published public private(set) var calendar: NativeScheduleCalendar?
    @Published public var selectedSemester: String = ""
    @Published public var selectedWeek: String = ""
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var lastUpdatedAt: Date?
    @Published public private(set) var source: NativeScheduleSource?
    @Published public private(set) var scheduleChangeNotice: NativeScheduleChangeNotice?
    /// The most recent authenticated snapshot, including prefetched weeks,
    /// published to the phone-to-Watch transport.
    public private(set) var latestSnapshot: NativeScheduleSnapshot?
    public var onWatchSnapshot: ((NativeScheduleSnapshot) -> Void)?
    public var onWatchReset: (() -> Void)?

    public let cacheLifetime: TimeInterval

    private var loader: NativeScheduleLoader?
    private var webViewLoader: NativeScheduleWebViewLoader?
    private var cache: [CacheKey: CacheEntry] = [:]
    private var backgroundRefreshTasks: [CacheKey: Task<Void, Never>] = [:]
    private var lastBackgroundRefreshAt: [CacheKey: Date] = [:]
    private var refreshStartedAt: [String: Date] = [:]
    private var requestGeneration = 0
    private var displayedKey: CacheKey?
    private let archive: NativeScheduleArchive?
    private var accountKey = ""
    private var sessionKey = ""
    private var sessionCheckGeneration = 0
    private var didReadArchive = false
    /// Reads a fingerprint of the signed-in web session. Supplied by `attach`
    /// from the shared WKWebView cookie store; injectable for checks.
    public var sessionFingerprint: (@MainActor () async -> String?)?

    public init(
        loader: NativeScheduleLoader? = nil,
        cacheLifetime: TimeInterval = 12 * 60 * 60,
        archive: NativeScheduleArchive? = NativeScheduleFileArchive()
    ) {
        self.loader = loader
        self.cacheLifetime = max(0, cacheLifetime)
        self.archive = archive
    }

    /// Connects the store to the shell's authenticated WKWebView. Keeping the
    /// bridge here lets the UI use the same `NativeScheduleStore()` regardless
    /// of whether the web view has finished booting yet.
    public func attach(webView: WKWebView) {
        let bridge = NativeScheduleWebViewLoader(webView: webView)
        webViewLoader = bridge
        loader = { request in
            try await bridge.load(request)
        }
        sessionFingerprint = { await bridge.sessionFingerprint() }
        // Learn the session early so an auth notification never has to guess.
        Task { @MainActor [weak self] in
            guard let self, self.sessionKey.isEmpty,
                  let session = await self.sessionFingerprint?() else { return }
            if self.sessionKey.isEmpty { self.sessionKey = session }
        }
    }

    public func detach() {
        webViewLoader = nil
        loader = nil
        reset()
    }

    /// Called by the shell when the web account or JWXT identity changes.
    /// A session that finished restoring the same account keeps the timetable
    /// on screen; any other change drops every account-scoped byte, on disk
    /// included, before the next load.
    public func handleAuthChanged(account: String = "") {
        let next = account.trimmingCharacters(in: .whitespacesAndNewlines)
        if !next.isEmpty, next == accountKey {
            return
        }
        if !next.isEmpty, accountKey.isEmpty {
            // A legacy archive may not contain the Web account fingerprint.
            // Adopt the first confirmed account after restoring it instead of
            // throwing away the already-validated same-session timetable.
            accountKey = next
            return
        }
        if next.isEmpty {
            // An older web build sends no fingerprint, and its very first
            // notification is only the session finishing its restore. Keep the
            // timetable on screen and drop it solely once the session cookie
            // proves this is a different account, or none at all.
            requestGeneration += 1
            discardIfSessionChanged()
            return
        }
        archive?.removeAll()
        reset()
        accountKey = next
    }

    public func waitForBridge() {
        guard result == nil else { return }
        errorMessage = nil
        state = .loading
    }

    public func reportBridgeFailure(_ message: String) {
        requestGeneration += 1
        errorMessage = message
        state = .failed
    }

    public func clear() {
        reset()
    }

    /// Loads the requested semester/week. A fresh in-memory entry is used for
    /// repeated renders; a cache hit is painted first and then refreshed in a
    /// separate task so a timetable never disappears behind a spinner. `force`
    /// is used by an explicit refresh action and the background refresh task. No disk
    /// cache is used here, avoiding cross-account data leakage.
    public func load(
        semester: String? = nil,
        week: String? = nil,
        force: Bool = false,
        background: Bool = false
    ) async {
        let requestedSemester = (semester ?? selectedSemester).trimmedNonEmpty
        let requestedWeek = (week ?? selectedWeek).trimmedNonEmpty
        if let requestedSemester { selectedSemester = requestedSemester }
        if let requestedWeek { selectedWeek = requestedWeek }
        webViewLoader?.prioritize(semester: selectedSemester, week: selectedWeek)

        let key = CacheKey(semester: requestedSemester ?? "", week: requestedWeek ?? "")
        if force { refreshStartedAt[key.semester] = .now }
        requestGeneration += 1
        let generation = requestGeneration
        // Paint any account-scoped cache before asking the bridge for a fresh
        // response. A stale entry is still the last known timetable and keeps
        // the grid interactive while the quiet revalidation runs; only an
        // explicit pull-to-refresh bypasses this first paint.
        if !force, let cached = cachedEntry(for: key) {
            apply(
                cached.snapshot,
                state: cached.snapshot.source == .cache ? .stale : .loaded,
                requestedSemester: requestedSemester,
                requestedWeek: requestedWeek,
                key: key
            )
            if !background { refreshInBackground(semester: requestedSemester, week: requestedWeek) }
            return
        }

        if !background, displayedKey != nil, displayedKey != key {
            // A missing week is a different grid and can still use the old
            // behavior. A semester switch keeps the current grid visible until
            // the new semester is accepted or rejected.
            if displayedKey?.semester == key.semester {
                clearDisplayedData()
            }
        }

        guard let loader else {
            state = .failed
            errorMessage = NativeScheduleStoreError.loaderUnavailable.localizedDescription
            return
        }

        if !background || result == nil {
            state = .loading
            errorMessage = nil
        }

        do {
            let snapshot = try await loader(NativeScheduleRequest(
                semester: requestedSemester,
                week: requestedWeek,
                force: force,
                background: background
            ))
            guard generation == requestGeneration else { return }
            if snapshot.cancelled {
                state = result == nil ? .idle : .stale
                errorMessage = nil
                return
            }
            try accept(snapshot, for: key, requestedSemester: requestedSemester, requestedWeek: requestedWeek)
        } catch is CancellationError {
            guard generation == requestGeneration else { return }
            state = result == nil ? .idle : .stale
        } catch {
            guard generation == requestGeneration else { return }
            handle(error, for: key)
        }
    }

    public func loadScheduleEdits() async throws -> NativeScheduleEditState {
        guard let webViewLoader else { throw NativeScheduleStoreError.webViewUnavailable }
        let semester = selectedSemester.trimmedNonEmpty ?? result?.currentSemester.trimmedNonEmpty ?? ""
        guard !semester.isEmpty else { return NativeScheduleEditState() }
        return try await webViewLoader.loadEdits(semester: semester)
    }

    public func saveScheduleEdits(_ edits: NativeScheduleEditState) async throws {
        guard let webViewLoader else { throw NativeScheduleStoreError.webViewUnavailable }
        let semester = selectedSemester.trimmedNonEmpty ?? result?.currentSemester.trimmedNonEmpty ?? ""
        guard !semester.isEmpty else { throw NativeScheduleStoreError.invalidResponse }
        let week = selectedWeek.trimmedNonEmpty ?? result?.currentWeek ?? ""
        let snapshot = try await webViewLoader.saveEdits(edits, semester: semester, week: week)
        let key = CacheKey(semester: semester, week: week)
        try accept(snapshot, for: key, requestedSemester: semester, requestedWeek: week, notifyChange: false)
    }

    /// A trusted bridge pushes each prefetched week, then the complete semester.
    /// Cache it without changing a newer selection or a foreground loading state.
    public func receivePrefetchedSnapshot(_ snapshot: NativeScheduleSnapshot) {
        guard snapshot.version == 1, !snapshot.cancelled, snapshot.auth.authenticated,
              snapshot.error == nil, let data = snapshot.data,
              !data.currentSemester.isEmpty, let fetchedAt = snapshot.fetchedAt else { return }
        guard cache.values.contains(where: { $0.snapshot.data?.currentSemester == data.currentSemester }),
              !cache.values.contains(where: { $0.snapshot.data?.currentSemester == data.currentSemester
                  && ($0.snapshot.fetchedAt ?? .distantPast) > fetchedAt }) else { return }
        let barrier = max(refreshStartedAt[data.currentSemester] ?? .distantPast,
                          refreshStartedAt[""] ?? .distantPast)
        guard fetchedAt >= barrier else { return }
        let entry = CacheEntry(snapshot: snapshot)
        guard entry.isFresh(at: .now, lifetime: cacheLifetime) else { return }
        if snapshot.completeSemester {
            cache = cache.filter { $0.key.semester != data.currentSemester }
            cache[CacheKey(semester: data.currentSemester, week: "*")] = entry
        } else {
            guard let week = Int(data.currentWeek), (1...64).contains(week),
                  cache[CacheKey(semester: data.currentSemester, week: "*")] == nil else { return }
            cache[CacheKey(semester: data.currentSemester, week: data.currentWeek)] = entry
            latestSnapshot = snapshot
            onWatchSnapshot?(snapshot)
            return // Prewarming must never change the visible week's state or selection.
        }
        if selectedSemester == data.currentSemester, state == .loaded || state == .stale {
            apply(snapshot, state: .loaded, requestedSemester: selectedSemester,
                  requestedWeek: selectedWeek,
                  key: CacheKey(semester: selectedSemester, week: selectedWeek))
            archiveDisplayed(snapshot)
        } else {
            latestSnapshot = snapshot
            onWatchSnapshot?(snapshot)
        }
    }

    public func restoreCachedSelection() -> Bool {
        webViewLoader?.prioritize(semester: selectedSemester, week: selectedWeek)
        let key = CacheKey(semester: selectedSemester, week: selectedWeek)
        guard let entry = cachedEntry(for: key) else { return false }
        if displayedKey == key, result != nil { return true }
        requestGeneration += 1
        apply(entry.snapshot, state: entry.snapshot.source == .cache || !entry.isFresh(at: .now, lifetime: cacheLifetime) ? .stale : .loaded,
              requestedSemester: selectedSemester, requestedWeek: selectedWeek, key: key)
        return true
    }

    /// Cold start: show the last timetable before the web bridge has booted.
    /// The live session cookie is checked first, so a record is only ever shown
    /// to the session that wrote it — no other account, and nobody signed out.
    public func restoreArchivedSelection() async -> Bool {
        guard !didReadArchive, result == nil, let archive else { return false }
        didReadArchive = true
        guard let record = archive.read(), !record.session.isEmpty,
              record.snapshot.auth.authenticated, let data = record.snapshot.data else { return false }
        let entry = CacheEntry(snapshot: record.snapshot, storedAt: record.savedAt)
        // Age triggers quiet revalidation, not deletion of the only offline
        // timetable. Session/account validation still runs before first paint.
        guard let session = await sessionFingerprint?(), session == record.session,
              accountKey.isEmpty || record.account.isEmpty || accountKey == record.account,
              result == nil else {
            archive.removeAll()
            return false
        }
        if !record.account.isEmpty { accountKey = record.account }
        sessionKey = record.session
        selectedSemester = record.semester
        selectedWeek = record.week
        let key = CacheKey(semester: record.semester, week: record.week)
        cache[key] = entry
        if record.snapshot.completeSemester, !data.currentSemester.isEmpty {
            cache[CacheKey(semester: data.currentSemester, week: "*")] = entry
        }
        requestGeneration += 1
        webViewLoader?.prioritize(semester: selectedSemester, week: selectedWeek)
        apply(record.snapshot, state: .stale, requestedSemester: record.semester.trimmedNonEmpty,
              requestedWeek: record.week.trimmedNonEmpty, key: key)
        return true
    }

    /// Keeps the displayed timetable for the next cold start. The session
    /// fingerprint comes from the cookie store, so this works with web builds
    /// that do not send an account fingerprint of their own.
    private func archiveDisplayed(_ snapshot: NativeScheduleSnapshot) {
        guard archive != nil, snapshot.auth.authenticated, snapshot.source != .cache,
              snapshot.data != nil else { return }
        let account = snapshot.auth.account?.trimmedNonEmpty ?? ""
        if !account.isEmpty { accountKey = account }
        let semester = selectedSemester
        let week = selectedWeek
        Task { @MainActor [weak self] in
            guard let self, let session = await self.sessionFingerprint?(), !session.isEmpty else { return }
            self.sessionKey = session
            self.archive?.write(NativeScheduleArchivedSchedule(
                account: account,
                session: session,
                semester: semester,
                week: week,
                savedAt: snapshot.fetchedAt ?? .now,
                snapshot: snapshot
            ))
        }
    }

    public func refresh() async {
        await load(semester: selectedSemester, week: selectedWeek, force: true)
    }

    /// Returns a semester-wide snapshot for Apple Calendar. A weekly cache is
    /// still useful for rendering, but calendar import should make one quiet
    /// attempt to promote it to the complete semester before writing events.
    /// If the education service is unavailable, the last valid weekly snapshot
    /// is returned so the user can still import the visible week.
    public func snapshotForCalendarImport() async -> NativeScheduleSnapshot? {
        ensureLatestSnapshot()
        if latestSnapshot?.completeSemester == true { return latestSnapshot }
        guard loader != nil else { return latestSnapshot }
        let semester = selectedSemester.trimmedNonEmpty
            ?? result?.currentSemester.trimmedNonEmpty
        let week = selectedWeek.trimmedNonEmpty
            ?? result?.currentWeek.trimmedNonEmpty
        await load(semester: semester, week: week, force: true)
        return latestSnapshot
    }

    /// Revalidates the visible selection without changing the rendered state.
    /// The Web timetable follows the same stale-while-revalidate contract: a
    /// cached schedule remains interactive while the server is checked quietly.
    public func refreshInBackground() {
        refreshInBackground(semester: selectedSemester, week: selectedWeek)
    }

    public func dismissScheduleChangeNotice() {
        scheduleChangeNotice = nil
    }

    private func refreshInBackground(semester: String?, week: String?) {
        guard loader != nil else { return }
        let key = CacheKey(semester: semester?.trimmedNonEmpty ?? "", week: week?.trimmedNonEmpty ?? "")
        guard result != nil, backgroundRefreshTasks[key] == nil else { return }
        let now = Date.now
        if let previous = lastBackgroundRefreshAt[key], now.timeIntervalSince(previous) < 30 {
            return
        }
        lastBackgroundRefreshAt[key] = now
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.backgroundRefreshTasks[key] = nil }
            await self.load(
                semester: semester,
                week: week,
                force: true,
                background: true
            )
        }
        backgroundRefreshTasks[key] = task
    }

    public func selectSemester(_ semester: String) async {
        selectedSemester = semester.trimmedNonEmpty ?? ""
        selectedWeek = ""
        await load(semester: selectedSemester, week: nil, force: false)
    }

    public func selectWeek(_ week: String) async {
        selectedWeek = week.trimmedNonEmpty ?? ""
        await load(semester: selectedSemester, week: selectedWeek, force: false)
    }

    /// Switches the displayed week synchronously so a view can swap the page
    /// and reset its slide offset inside one transaction. The matching refresh
    /// keeps running in the background, exactly like `selectWeek`.
    public func commitWeekSelection(_ week: String) {
        let value = week.trimmedNonEmpty ?? ""
        guard value != selectedWeek else { return }
        selectedWeek = value
        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.load(semester: self.selectedSemester, week: self.selectedWeek, force: false)
        }
    }

    /// Clears all in-memory data when the web session changes or the user logs
    /// out. The next request starts in the idle state.
    public func reset() {
        requestGeneration += 1
        sessionCheckGeneration += 1
        backgroundRefreshTasks.values.forEach { $0.cancel() }
        backgroundRefreshTasks.removeAll(keepingCapacity: false)
        lastBackgroundRefreshAt.removeAll(keepingCapacity: false)
        cache.removeAll(keepingCapacity: false)
        refreshStartedAt.removeAll()
        accountKey = ""
        sessionKey = ""
        result = nil
        calendar = nil
        source = nil
        scheduleChangeNotice = nil
        latestSnapshot = nil
        errorMessage = nil
        lastUpdatedAt = nil
        displayedKey = nil
        selectedSemester = ""
        selectedWeek = ""
        state = .idle
        onWatchReset?()
        #if os(iOS) && canImport(ActivityKit)
        if #available(iOS 17.0, *) {
            NativeLiveActivityController.shared.reset()
        }
        #endif
    }

    private func accept(
        _ snapshot: NativeScheduleSnapshot,
        for key: CacheKey,
        requestedSemester: String?,
        requestedWeek: String?,
        notifyChange: Bool = true
    ) throws {
        guard snapshot.version == 1 else {
            throw NativeScheduleStoreError.invalidResponse
        }
        // A newer week/semester selection owns the UI now. Leave the current
        // timetable and state untouched; the newer request will publish its
        // own snapshot when it completes.
        if snapshot.cancelled { return }
        if !snapshot.auth.authenticated {
            let message = snapshot.error ?? NativeScheduleStoreError.unauthorized("").localizedDescription
            if let incoming = snapshot.auth.account?.trimmedNonEmpty,
               !accountKey.isEmpty, incoming != accountKey {
                // A different site-account fingerprint is authoritative even
                // when the cookie store has not finished rotating yet.
                archive?.removeAll()
                reset()
                errorMessage = message
                state = .unauthorized
                throw NativeScheduleStoreError.unauthorized(message)
            }
            if let account = snapshot.auth.account?.trimmedNonEmpty, accountKey.isEmpty {
                accountKey = account
            }
            // The Web bridge includes the site-account fingerprint on a JWXT
            // authorization failure. Keep the last valid grid and its Watch
            // snapshot when that fingerprint is unchanged; a real site
            // logout still arrives through authChanged and is checked against
            // the cookie fingerprint below.
            if retainVisibleSchedule(for: snapshot) {
                // JWXT expiry is recoverable. Do not replace the visible
                // timetable with a login-required banner or clear Watch's
                // last valid snapshot while the site account is intact.
                errorMessage = nil
                state = .stale
                return
            }
            discardUnauthorizedData()
            errorMessage = message
            state = .unauthorized
            throw NativeScheduleStoreError.unauthorized(message)
        }
        if let error = snapshot.error?.trimmedNonEmpty, snapshot.data == nil {
            if error == "bridge-unavailable" {
                throw NativeScheduleStoreError.bridgeUnavailable
            }
            throw NativeScheduleStoreError.server(error)
        }
        guard let data = snapshot.data else {
            throw NativeScheduleStoreError.invalidResponse
        }

        if let account = snapshot.auth.account?.trimmedNonEmpty, accountKey.isEmpty {
            accountKey = account
        }

        if !snapshot.completeSemester,
           let complete = cache[CacheKey(semester: data.currentSemester, week: "*")],
           (complete.snapshot.fetchedAt ?? .distantPast) >= (snapshot.fetchedAt ?? .distantPast) {
            try accept(complete.snapshot, for: key, requestedSemester: requestedSemester, requestedWeek: requestedWeek, notifyChange: notifyChange)
            return
        }
        let previousSnapshot = cache[key]?.snapshot ?? cache[CacheKey(semester: data.currentSemester, week: "*")]?.snapshot
        if notifyChange,
           snapshot.source == .jwxt,
           previousSnapshot?.source == .jwxt,
           let previousSnapshot,
           (previousSnapshot.fetchedAt ?? .distantPast) < (snapshot.fetchedAt ?? .distantPast),
           isVisibleSelection(key: key, data: data),
           let notice = makeScheduleChangeNotice(previous: previousSnapshot, next: snapshot) {
            scheduleChangeNotice = notice
        }
        let entry = CacheEntry(snapshot: snapshot)
        if !snapshot.completeSemester {
            cache = cache.filter { !($0.value.snapshot.completeSemester && $0.value.snapshot.data?.currentSemester == data.currentSemester) }
        }
        cache[key] = entry
        // The initial request commonly omits semester/week. Keep an alias for
        // the resolved values so a subsequent view render does not refetch.
        let resolvedKey = CacheKey(
            semester: requestedSemester ?? data.currentSemester,
            week: requestedWeek ?? data.currentWeek
        )
        cache[resolvedKey] = entry
        if snapshot.completeSemester {
            // Replace every older weekly alias when a semester is refreshed.
            cache = cache.filter { $0.key.semester != resolvedKey.semester }
            cache[key] = entry
            cache[resolvedKey] = entry
            cache[CacheKey(semester: resolvedKey.semester, week: "*")] = entry
        }
        if let requestedSemester { selectedSemester = requestedSemester }
        else if !data.currentSemester.isEmpty { selectedSemester = data.currentSemester }
        if let requestedWeek { selectedWeek = requestedWeek }
        else if let resolvedWeek = firstUsableWeek(in: data) { selectedWeek = resolvedWeek }
        result = data
        calendar = snapshot.calendar
        source = snapshot.source == .unknown ? data.source : snapshot.source
        lastUpdatedAt = snapshot.fetchedAt ?? .now
        errorMessage = snapshot.error?.trimmedNonEmpty
        state = snapshot.source == .cache ? .stale : .loaded
        // `key` can be empty on the first request (the bridge resolves the
        // semester/week). Record the resolved selection so a later refresh of
        // that same visible timetable does not clear it before the response
        // has a chance to report a recoverable JWXT expiry.
        displayedKey = resolvedKey
        latestSnapshot = snapshot
        onWatchSnapshot?(snapshot)
        #if os(iOS) && canImport(ActivityKit)
        if #available(iOS 17.0, *) {
            NativeLiveActivityController.shared.accept(snapshot)
        }
        #endif
        archiveDisplayed(snapshot)
    }

    private func isVisibleSelection(key: CacheKey, data: NativeScheduleResult) -> Bool {
        guard let displayedKey else { return key.semester == selectedSemester }
        return displayedKey == key || (
            key.semester == selectedSemester &&
            (key.week == selectedWeek || key.week.isEmpty || data.currentWeek == selectedWeek)
        )
    }

    private func firstUsableWeek(in data: NativeScheduleResult) -> String? {
        data.currentWeek.trimmedNonEmpty
            ?? data.weeks.first(where: { $0.current })?.value.trimmedNonEmpty
            ?? data.weeks.first?.value.trimmedNonEmpty
    }

    private func makeScheduleChangeNotice(
        previous: NativeScheduleSnapshot,
        next: NativeScheduleSnapshot
    ) -> NativeScheduleChangeNotice? {
        guard let before = previous.data, let after = next.data else { return nil }
        let beforeEntries = scheduleChangeEntries(before)
        let afterEntries = scheduleChangeEntries(after)
        let details = describeScheduleChanges(before: beforeEntries, after: afterEntries)
        guard !details.isEmpty else { return nil }
        let fingerprint = afterEntries.map(\.key).joined(separator: "\n")
        return NativeScheduleChangeNotice(
            id: "\(after.currentSemester)-\(scheduleChangeFingerprint(fingerprint))",
            semester: after.currentSemester,
            changedCount: details.count,
            details: details
        )
    }

    /// This mirrors Web's scheduleChanges.ts. A full signature identifies an
    /// unchanged occurrence; entries with the same course name are then paired
    /// so a moved class is reported as one adjustment instead of add/remove.
    private struct ScheduleChangeEntry {
        let key: String
        let name: String
        let nameKey: String
        let teacher: String
        let teacherKey: String
        let location: String
        let locationKey: String
        let weeks: String
        let weeksKey: String
        let note: String
        let noteKey: String
        let day: Int
        let startSlot: Int
        let endSlot: Int
    }

    private func scheduleChangeEntries(_ result: NativeScheduleResult) -> [ScheduleChangeEntry] {
        let allWeeks = result.weeks.compactMap { Int($0.value) }
            .filter { $0 > 0 }
            .sorted()
        return result.cells.flatMap { cell in
            cell.courses.map { course in
                let range = NativeSchedulePeriod.normalizedRange(
                    bigSlot: cell.bigSlot,
                    startSlot: course.startSlot,
                    endSlot: course.endSlot,
                    periods: NativeSchedulePeriod.bundledTimetable
                )
                let name = normalizedChangeText(course.name)
                let teacher = normalizedChangeText(course.teacher)
                let location = normalizedChangeText(course.location)
                let weeksKey = canonicalChangeWeeks(course, allWeeks: allWeeks)
                let note = canonicalChangeNote(course.slotNote)
                let entry = ScheduleChangeEntry(
                    key: "",
                    name: name,
                    nameKey: normalizedChangeKey(name),
                    teacher: teacher,
                    teacherKey: normalizedChangeKey(teacher),
                    location: location,
                    locationKey: normalizedChangeKey(location),
                    weeks: displayChangeWeeks(course, weeksKey: weeksKey),
                    weeksKey: weeksKey,
                    note: note,
                    noteKey: normalizedChangeKey(note),
                    day: cell.day,
                    startSlot: range.start,
                    endSlot: range.end
                )
                let key = [
                    String(entry.day), String(entry.startSlot), String(entry.endSlot),
                    entry.nameKey, entry.teacherKey, entry.locationKey,
                    entry.weeksKey, entry.noteKey
                ].joined(separator: "\u{1F}")
                return ScheduleChangeEntry(
                    key: key,
                    name: entry.name,
                    nameKey: entry.nameKey,
                    teacher: entry.teacher,
                    teacherKey: entry.teacherKey,
                    location: entry.location,
                    locationKey: entry.locationKey,
                    weeks: entry.weeks,
                    weeksKey: entry.weeksKey,
                    note: entry.note,
                    noteKey: entry.noteKey,
                    day: entry.day,
                    startSlot: entry.startSlot,
                    endSlot: entry.endSlot
                )
            }
        }.sorted { $0.key < $1.key }
    }

    private func canonicalChangeWeeks(_ course: NativeScheduleCourse, allWeeks: [Int]) -> String {
        let weeks = normalizedChangeWeekList(course)
        guard !weeks.isEmpty else { return "all" }
        return allWeeks == weeks ? "all" : weeks.map(String.init).joined(separator: ",")
    }

    private func normalizedChangeWeekList(_ course: NativeScheduleCourse) -> [Int] {
        let parsed = parseChangeWeekText(course.weeks)
        if !parsed.isEmpty { return parsed }
        return Array(Set(course.weekList.filter { $0 > 0 })).sorted()
    }

    private func parseChangeWeekText(_ value: String) -> [Int] {
        var source = value
        let fullWidthDigits = ["０", "１", "２", "３", "４", "５", "６", "７", "８", "９"]
        for (index, digit) in fullWidthDigits.enumerated() {
            source = source.replacingOccurrences(of: digit, with: String(index))
        }
        source = source
            .replacingOccurrences(of: "（", with: "(")
            .replacingOccurrences(of: "）", with: ")")
            .replacingOccurrences(of: "［", with: "(")
            .replacingOccurrences(of: "］", with: ")")
            .replacingOccurrences(of: "【", with: "(")
            .replacingOccurrences(of: "】", with: ")")
            .replacingOccurrences(of: "－", with: "-")
            .replacingOccurrences(of: "–", with: "-")
            .replacingOccurrences(of: "—", with: "-")
            .replacingOccurrences(of: "~", with: "-")
            .replacingOccurrences(of: "～", with: "-")
            .replacingOccurrences(of: "第", with: "")
            .components(separatedBy: .whitespacesAndNewlines).joined()
        guard !source.isEmpty else { return [] }

        let clauses = source.split { ",，、;；".contains($0) }.map(String.init)
        let pattern = #"(\d{1,2})\s*(?:[-至到]\s*(\d{1,2}))?"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        var weeks = Set<Int>()
        for clause in clauses.isEmpty ? [source] : clauses {
            let kind: ChangeWeekKind
            if clause.contains("单双") {
                kind = .all
            } else if clause.contains("单周") || clause.contains("单数周") || clause.contains("(单)") || clause.contains("单") {
                kind = .odd
            } else if clause.contains("双周") || clause.contains("双数周") || clause.contains("(双)") || clause.contains("双") {
                kind = .even
            } else {
                kind = .all
            }
            let range = NSRange(clause.startIndex..., in: clause)
            for match in regex.matches(in: clause, range: range) {
                guard let firstRange = Range(match.range(at: 1), in: clause),
                      let start = Int(clause[firstRange]) else { continue }
                let end: Int
                if let secondRange = Range(match.range(at: 2), in: clause),
                   let parsedEnd = Int(clause[secondRange]) {
                    end = parsedEnd
                } else {
                    end = start
                }
                let lower = max(1, min(start, end))
                let upper = min(64, max(start, end))
                guard lower <= upper else { continue }
                for week in lower...upper {
                    if kind == .odd && week % 2 == 0 { continue }
                    if kind == .even && week % 2 == 1 { continue }
                    weeks.insert(week)
                }
            }
        }
        return weeks.sorted()
    }

    private enum ChangeWeekKind { case all, odd, even }

    private func canonicalChangeNote(_ value: String?) -> String {
        let note = normalizedChangeText(value)
        return note.range(of: #"^(?:第\s*)?\d+\s*(?:-\s*\d+)?\s*节$"#, options: .regularExpression) == nil
            ? note : ""
    }

    private func displayChangeWeeks(_ course: NativeScheduleCourse, weeksKey: String) -> String {
        let label = normalizedChangeText(course.weeks)
        if !label.isEmpty { return label }
        return weeksKey == "all" ? "全部周" : "第 \(weeksKey.replacingOccurrences(of: ",", with: "、")) 周"
    }

    private func describeScheduleChanges(
        before: [ScheduleChangeEntry],
        after: [ScheduleChangeEntry]
    ) -> [String] {
        var remainingAfter = after
        var remainingBefore: [ScheduleChangeEntry] = []
        for entry in before {
            if let exactIndex = remainingAfter.firstIndex(where: { $0.key == entry.key }) {
                remainingAfter.remove(at: exactIndex)
            } else {
                remainingBefore.append(entry)
            }
        }

        var details: [String] = []
        var removed: [ScheduleChangeEntry] = []
        for entry in remainingBefore {
            guard let matchIndex = closestSameCourseIndex(entry, candidates: remainingAfter) else {
                removed.append(entry)
                continue
            }
            let replacement = remainingAfter.remove(at: matchIndex)
            details.append(describeChangedCourse(before: entry, after: replacement))
        }
        details.append(contentsOf: remainingAfter.map { "新增：\(describeCourse($0))" })
        details.append(contentsOf: removed.map { "移除：\(describeCourse($0))" })
        return details
    }

    private func closestSameCourseIndex(
        _ target: ScheduleChangeEntry,
        candidates: [ScheduleChangeEntry]
    ) -> Int? {
        var bestIndex: Int?
        var bestScore = Int.max
        for (index, candidate) in candidates.enumerated() {
            guard candidate.nameKey == target.nameKey else { continue }
            var score = 0
            if candidate.day != target.day { score += 1 }
            if candidate.startSlot != target.startSlot || candidate.endSlot != target.endSlot { score += 1 }
            if candidate.teacherKey != target.teacherKey { score += 1 }
            if candidate.locationKey != target.locationKey { score += 1 }
            if candidate.weeksKey != target.weeksKey { score += 1 }
            if candidate.noteKey != target.noteKey { score += 1 }
            if score < bestScore {
                bestIndex = index
                bestScore = score
            }
        }
        return bestIndex
    }

    private func describeChangedCourse(before: ScheduleChangeEntry, after: ScheduleChangeEntry) -> String {
        var fields: [String] = []
        if before.day != after.day || before.startSlot != after.startSlot || before.endSlot != after.endSlot {
            fields.append("时间 \(displayChangeTime(before)) → \(displayChangeTime(after))")
        }
        if before.weeksKey != after.weeksKey { fields.append("周次 \(before.weeks) → \(after.weeks)") }
        if before.locationKey != after.locationKey {
            fields.append("地点 \(before.location.isEmpty ? "未标注" : before.location) → \(after.location.isEmpty ? "未标注" : after.location)")
        }
        if before.teacherKey != after.teacherKey {
            fields.append("教师 \(before.teacher.isEmpty ? "未标注" : before.teacher) → \(after.teacher.isEmpty ? "未标注" : after.teacher)")
        }
        if before.noteKey != after.noteKey {
            fields.append("备注 \(before.note.isEmpty ? "无" : before.note) → \(after.note.isEmpty ? "无" : after.note)")
        }
        return "调整：\(after.name)：\(fields.joined(separator: "；"))"
    }

    private func describeCourse(_ entry: ScheduleChangeEntry) -> String {
        var parts = [displayChangeTime(entry), entry.weeks]
        if !entry.location.isEmpty { parts.append(entry.location) }
        if !entry.teacher.isEmpty { parts.append(entry.teacher) }
        return "\(entry.name)（\(parts.joined(separator: "，"))）"
    }

    private func displayChangeTime(_ entry: ScheduleChangeEntry) -> String {
        "\(changeDayLabel(entry.day)) \(entry.startSlot)-\(entry.endSlot)节"
    }

    private func changeDayLabel(_ day: Int) -> String {
        let labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
        return labels.indices.contains(day - 1) ? labels[day - 1] : "周\(day)"
    }

    private func normalizedChangeText(_ value: String?) -> String {
        String(value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
    }

    private func normalizedChangeKey(_ value: String) -> String {
        normalizedChangeText(value).lowercased()
    }

    private func scheduleChangeFingerprint(_ source: String) -> String {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in source.utf8 {
            hash = (hash ^ UInt64(byte)) &* 0x100000001b3
        }
        return String(hash, radix: 16)
    }

    private func apply(
        _ snapshot: NativeScheduleSnapshot,
        state: NativeScheduleState,
        requestedSemester: String?,
        requestedWeek: String?,
        key: CacheKey
    ) {
        if let data = snapshot.data {
            result = data
            calendar = snapshot.calendar
            source = snapshot.source == .unknown ? data.source : snapshot.source
            if let requestedSemester { selectedSemester = requestedSemester }
            else if !data.currentSemester.isEmpty { selectedSemester = data.currentSemester }
            if let requestedWeek { selectedWeek = requestedWeek }
            else if let resolvedWeek = firstUsableWeek(in: data) { selectedWeek = resolvedWeek }
            lastUpdatedAt = snapshot.fetchedAt
            displayedKey = key
            latestSnapshot = snapshot
            onWatchSnapshot?(snapshot)
            #if os(iOS) && canImport(ActivityKit)
            if #available(iOS 17.0, *) {
                NativeLiveActivityController.shared.accept(snapshot)
            }
            #endif
        }
        self.state = state
        errorMessage = snapshot.error?.trimmedNonEmpty
    }

    private func handle(_ error: Error, for key: CacheKey) {
        let storeError = normalize(error)
        if case .unauthorized(let message) = storeError {
            discardUnauthorizedData()
            if result != nil {
                // Keep a usable cached grid while the education session is
                // repaired. A banner can describe the stale state without
                // replacing the grid with a login screen.
                errorMessage = nil
                state = .stale
            } else {
                errorMessage = message
                state = .unauthorized
            }
            return
        }
        if let cached = cachedEntry(for: key) {
            apply(
                cached.snapshot,
                state: .stale,
                requestedSemester: key.semester.trimmedNonEmpty,
                requestedWeek: key.week.trimmedNonEmpty,
                key: key
            )
            errorMessage = storeError.localizedDescription
            return
        }
        if let displayedKey,
           displayedKey.semester != key.semester,
           result != nil {
            // The server can answer an old/unsupported semester with the
            // current semester. Restore the visible selection and leave the
            // timetable usable so the user can choose another term.
            selectedSemester = displayedKey.semester
            if !displayedKey.week.isEmpty, displayedKey.week != "*" {
                selectedWeek = displayedKey.week
            } else if let result {
                selectedWeek = firstUsableWeek(in: result) ?? selectedWeek
            }
            let mismatchMessage = storeError.localizedDescription.contains("其他学期")
                || storeError.localizedDescription.contains("学期与请求")
                || storeError.localizedDescription.contains("不一致")
            let message = mismatchMessage
                ? "这个学期暂时没有可用课表，请重新选择其他学期。"
                : storeError.localizedDescription
            errorMessage = message
            state = .stale
            return
        }
        clearDisplayedData()
        errorMessage = storeError.localizedDescription
        state = .failed
    }

    /// An expired 教务 authorization is not a sign-out: while the same web
    /// session is still signed in, the timetable stays visible under a banner.
    /// Anything else clears it, the archive included.
    private func discardUnauthorizedData() {
        // A JWXT 401 is recoverable and the last successful timetable remains
        // safe to display while the site session is intact. The explicit
        // `handleAuthChanged(account: "")` path is reserved for a site-account
        // logout; an education request must never delete the phone or Watch
        // cache just because its authorization has expired.
        ensureLatestSnapshot()
        if result != nil, sessionFingerprint != nil { discardIfSessionChanged() }
    }

    private func retainVisibleSchedule(for snapshot: NativeScheduleSnapshot) -> Bool {
        guard result != nil else { return false }
        let incoming = snapshot.auth.account?.trimmedNonEmpty
        if let incoming {
            guard !incoming.isEmpty else { return false }
            if accountKey.isEmpty { accountKey = incoming }
            guard incoming == accountKey else { return false }
        }
        // Compatibility with older bridges that omit the account fingerprint.
        // Site-account changes are delivered through handleAuthChanged, so an
        // education-only authorization failure can retain the visible result
        // without waiting for the cookie fingerprint task to finish.
        ensureLatestSnapshot()
        if sessionFingerprint != nil { discardIfSessionChanged() }
        return true
    }

    /// Makes the Watch handoff resilient to a fast JWXT expiry or a legacy
    /// payload that populated `result` before `latestSnapshot` was introduced.
    public func snapshotForWatch() -> NativeScheduleSnapshot? {
        ensureLatestSnapshot()
        return latestSnapshot
    }

    private func ensureLatestSnapshot() {
        guard latestSnapshot == nil, let result else { return }
        latestSnapshot = NativeScheduleSnapshot(
            source: source ?? result.source ?? .cache,
            fetchedAt: lastUpdatedAt ?? .now,
            data: result,
            calendar: calendar,
            auth: NativeScheduleAuth(
                authenticated: true,
                identity: result.source == .graduate ? "graduate" : "undergraduate",
                account: accountKey
            )
        )
    }

    /// Clears every account-scoped byte unless the signed-in web session is
    /// still the one the displayed timetable was loaded for.
    private func discardIfSessionChanged() {
        // Without a way to read the session there is nothing to prove, so the
        // conservative path wins and every account-scoped byte goes.
        guard let sessionFingerprint else {
            archive?.removeAll()
            reset()
            return
        }
        let expected = sessionKey
        sessionCheckGeneration += 1
        let checkGeneration = sessionCheckGeneration
        Task { @MainActor [weak self] in
            guard let self else { return }
            let session = await sessionFingerprint() ?? ""
            guard checkGeneration == self.sessionCheckGeneration else { return }
            if !session.isEmpty {
                if expected.isEmpty {
                    // The cookie store can be populated a moment after the
                    // initial empty auth report. Learn it and keep the cache;
                    // a later account fingerprint still handles account swaps.
                    self.sessionKey = session
                    return
                }
                if session == expected { return }
            } else if expected.isEmpty {
                // Cookie storage can briefly report no value while WebKit is
                // restoring the page. Without a previously known session we
                // cannot prove a logout, so leave the visible/cache snapshot
                // intact and let the next auth report settle it.
                return
            }
            self.archive?.removeAll()
            self.reset()
            // Resetting supersedes whatever the shell just started, so the
            // timetable must never be left empty with nothing in flight.
            if self.loader != nil { await self.load(force: true) }
        }
    }

    private func clearLoadedData() {
        cache.removeAll(keepingCapacity: false)
        clearDisplayedData()
    }

    private func clearDisplayedData() {
        result = nil
        calendar = nil
        source = nil
        lastUpdatedAt = nil
        displayedKey = nil
    }

    private func normalize(_ error: Error) -> NativeScheduleStoreError {
        if let error = error as? NativeScheduleStoreError { return error }
        if error is DecodingError { return .invalidResponse }
        return .server(error.localizedDescription)
    }

    private func cachedEntry(for key: CacheKey) -> CacheEntry? {
        cache[CacheKey(semester: key.semester, week: "*")] ?? cache[key]
    }

    private struct CacheKey: Hashable {
        let semester: String
        let week: String
    }

    private struct CacheEntry {
        let snapshot: NativeScheduleSnapshot
        let storedAt: Date

        init(snapshot: NativeScheduleSnapshot, storedAt: Date = .now) {
            self.snapshot = snapshot
            self.storedAt = storedAt
        }

        func isFresh(at date: Date, lifetime: TimeInterval) -> Bool {
            guard lifetime > 0 else { return false }
            let timestamp = snapshot.fetchedAt ?? storedAt
            return date.timeIntervalSince(timestamp) <= lifetime
        }
    }
}

// MARK: - WKWebView loader

/// Convenience loader for the native shell. The web app owns authentication;
/// this class only asks the existing WKWebView to execute the bridge function.
@MainActor
public final class NativeScheduleWebViewLoader {
    private weak var webView: WKWebView?

    public init(webView: WKWebView) {
        self.webView = webView
    }

    /// A non-reversible fingerprint of the signed-in web session cookie. It
    /// changes on sign-out and on a different account's sign-in, and the raw
    /// value never leaves the cookie store.
    public func sessionFingerprint() async -> String? {
        guard let webView else { return nil }
        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        guard let value = cookies.first(where: {
            $0.name == "__Host-cpu-session" || $0.name == "cpu-session"
        })?.value, value.count >= 16 else { return nil }
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in Array(value.utf8) {
            hash = (hash ^ UInt64(byte)) &* 0x0000_0100_0000_01b3
        }
        return "s" + String(hash, radix: 16)
    }

    public func prioritize(semester: String, week: String) {
        guard !semester.isEmpty, !week.isEmpty, let webView else { return }
        Task { @MainActor in
            _ = try? await webView.callAsyncJavaScript(
                "window.CPUTimeNativeSchedulePrioritize?.(semester, week);",
                arguments: ["semester": semester, "week": week], in: nil, contentWorld: .page
            )
        }
    }

    public func load(_ request: NativeScheduleRequest) async throws -> NativeScheduleSnapshot {
        guard let webView else { throw NativeScheduleStoreError.webViewUnavailable }

        let functionBody = """
        const fetchSchedule = window.CPUTimeNativeScheduleFetch;
        const loadSchedule = window.CPUTimeNative?.loadSchedule;
        if (typeof fetchSchedule !== 'function' && typeof loadSchedule !== 'function') {
          return JSON.stringify({version: 1, source: 'unknown', auth: {authenticated: true}, error: 'bridge-unavailable'});
        }
        const value = typeof fetchSchedule === 'function'
          ? await fetchSchedule(semester || null, week || null, Boolean(force), Boolean(background))
          : await loadSchedule({semester: semester || null, week: week || null, force: Boolean(force), background: Boolean(background)});
        return typeof value === 'string' ? value : JSON.stringify(value);
        """
        let rawValue = try await webView.callAsyncJavaScript(
            functionBody,
            arguments: [
                "semester": request.semester ?? "",
                "week": request.week ?? "",
                "force": request.force,
                "background": request.background
            ],
            in: nil,
            contentWorld: .page
        )
        guard let raw = rawValue as? String else {
            throw NativeScheduleStoreError.invalidResponse
        }
        guard let data = raw.data(using: .utf8) else {
            throw NativeScheduleStoreError.invalidResponse
        }
        do {
            return try JSONDecoder.nativeScheduleDecoder.decode(NativeScheduleSnapshot.self, from: data)
        } catch {
            throw NativeScheduleStoreError.invalidResponse
        }
    }

    public func loadEdits(semester: String) async throws -> NativeScheduleEditState {
        guard let webView else { throw NativeScheduleStoreError.webViewUnavailable }
        let raw = try await webView.callAsyncJavaScript("""
        try {
          const cookie = (name) => {
            const part = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
            return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
          };
          const stores = document.getElementById('app')?.__vue_app__?.config?.globalProperties?.$pinia?._s;
          const auth = stores?.get('auth');
          const jwxt = stores?.get('jwxt');
          const headers = {
            'X-CPU-Auth-Mode': 'cookie', 'X-CPU-Client': 'ios',
            'X-CSRF-Token': cookie('__Host-cpu-csrf') || cookie('cpu-csrf')
          };
          if (jwxt?.token && jwxt.token !== '__cpu_jwxt_cookie_session__') headers['X-Jwxt-Token'] = String(jwxt.token);
          if (auth?.token && auth.token !== '__cpu_cookie_session__') headers.Authorization = 'Bearer ' + String(auth.token);
          const response = await fetch('/api/jwxt/schedule-edits?semester=' + encodeURIComponent(semester), {
            credentials: 'same-origin', headers
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || (typeof body.code === 'number' && body.code !== 0)) {
            return JSON.stringify({__cpuError: body.message || '课表编辑读取失败'});
          }
          const payload = typeof body.code === 'number' ? body.data : body;
          return JSON.stringify(payload?.edits || {hidden: [], custom: []});
        } catch (error) {
          return JSON.stringify({__cpuError: error?.message || '课表编辑读取失败'});
        }
        """, arguments: ["semester": semester], in: nil, contentWorld: .page)
        let data = try bridgeData(from: raw)
        return try JSONDecoder.nativeScheduleDecoder.decode(NativeScheduleEditState.self, from: data)
    }

    public func saveEdits(_ edits: NativeScheduleEditState, semester: String, week: String) async throws -> NativeScheduleSnapshot {
        guard let webView else { throw NativeScheduleStoreError.webViewUnavailable }
        let editsData = try JSONEncoder().encode(edits)
        guard let payload = String(data: editsData, encoding: .utf8) else { throw NativeScheduleStoreError.invalidResponse }
        let raw = try await webView.callAsyncJavaScript("""
        try {
          const cookie = (name) => {
            const part = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
            return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
          };
          const stores = document.getElementById('app')?.__vue_app__?.config?.globalProperties?.$pinia?._s;
          const auth = stores?.get('auth');
          const jwxt = stores?.get('jwxt');
          const headers = {
            'Content-Type': 'application/json', 'X-CPU-Auth-Mode': 'cookie',
            'X-CPU-Client': 'ios',
            'X-CSRF-Token': cookie('__Host-cpu-csrf') || cookie('cpu-csrf')
          };
          if (jwxt?.token && jwxt.token !== '__cpu_jwxt_cookie_session__') headers['X-Jwxt-Token'] = String(jwxt.token);
          if (auth?.token && auth.token !== '__cpu_cookie_session__') headers.Authorization = 'Bearer ' + String(auth.token);
          const response = await fetch('/api/jwxt/schedule-edits', {
            method: 'PUT', credentials: 'same-origin', headers,
            body: JSON.stringify({semester, edits: JSON.parse(editsJSON)})
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || (typeof body.code === 'number' && body.code !== 0)) {
            return JSON.stringify({__cpuError: body.message || '课表编辑保存失败'});
          }
          const fetchSchedule = window.CPUTimeNativeScheduleFetch || window.CPUTimeNative?.loadSchedule;
          if (typeof fetchSchedule !== 'function') {
            return JSON.stringify({__cpuError: '课表刷新桥接尚未准备好，请稍后重试'});
          }
          const value = window.CPUTimeNativeScheduleFetch
            ? await fetchSchedule(semester || null, week || null, true)
            : await fetchSchedule({semester: semester || null, week: week || null, force: true});
          return typeof value === 'string' ? value : JSON.stringify(value);
        } catch (error) {
          return JSON.stringify({__cpuError: error?.message || '课表编辑保存失败'});
        }
        """, arguments: ["semester": semester, "week": week, "editsJSON": payload], in: nil, contentWorld: .page)
        let snapshotData = try bridgeData(from: raw)
        return try JSONDecoder.nativeScheduleDecoder.decode(NativeScheduleSnapshot.self, from: snapshotData)
    }

    private func bridgeData(from rawValue: Any?) throws -> Data {
        guard let raw = rawValue as? String, let data = raw.data(using: .utf8) else {
            throw NativeScheduleStoreError.invalidResponse
        }
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let message = object["__cpuError"] as? String,
           let trimmed = message.trimmedNonEmpty {
            throw NativeScheduleStoreError.server(trimmed)
        }
        return data
    }
}

// MARK: - Codable compatibility helpers

extension String {
    var trimmedNonEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

private extension KeyedDecodingContainer {
    func decodeFlexibleString(forKey key: Key) throws -> String? {
        if let value = try? decodeIfPresent(String.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return String(value) }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return String(Int(value)) }
        return nil
    }

    func decodeFlexibleInt(forKey key: Key) throws -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(String.self, forKey: key) { return Int(value.trimmedNonEmpty ?? "") }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return Int(value) }
        return nil
    }

    func decodeFlexibleBool(forKey key: Key) -> Bool? {
        if let value = try? decodeIfPresent(Bool.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "1", "true", "yes", "y", "是": return true
            case "0", "false", "no", "n", "否": return false
            default: return nil
            }
        }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value != 0 }
        return nil
    }

    func decodeFlexibleIntArray(forKey key: Key) throws -> [Int] {
        if let values = try? decodeIfPresent([Int].self, forKey: key) { return values }
        if let values = try? decodeIfPresent([String].self, forKey: key) {
            return values.compactMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
        }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            return value
                .split { ",，、;； ".contains($0) }
                .compactMap { Int($0) }
        }
        return []
    }

    func decodeFlexibleDate(forKey key: Key) throws -> Date? {
        if let value = try? decodeIfPresent(Double.self, forKey: key) {
            return Date(timeIntervalSince1970: value > 10_000_000_000 ? value / 1000 : value)
        }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            if let numeric = Double(value) {
                return Date(timeIntervalSince1970: numeric > 10_000_000_000 ? numeric / 1000 : numeric)
            }
            return ISO8601DateFormatter().date(from: value)
        }
        return nil
    }
}

private extension JSONDecoder {
    static var nativeScheduleDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private extension JSONEncoder {
    static var nativeScheduleEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
