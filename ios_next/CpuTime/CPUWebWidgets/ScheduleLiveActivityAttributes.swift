import ActivityKit
import Foundation

/// Shared wire model for the iPhone Live Activity and its WidgetKit view.
/// This file is compiled into both the app and the widget extension.
public struct ScheduleLiveActivityAttributes: ActivityAttributes, Equatable {
    public static let broadcastCoursesKey = "cpu.liveActivity.broadcastCourses"

    public enum TimingMode: String, Codable { case whole, segmented }
    public struct Segment: Codable, Hashable {
        public let period: Int
        public let startAt: Date
        public let endAt: Date
    }
    public struct Timeline: Equatable {
        public enum Phase { case upcoming, inClass, intermission, finished }
        public let phase: Phase
        public let index: Int
        public let start: Date
        public let target: Date
        public let finalEnd: Date
    }
    public static func resolveTimeline(_ segments: [Segment], mode: TimingMode, now: Date) -> Timeline? {
        guard let first = segments.first, let last = segments.last else { return nil }
        if now >= last.endAt { return Timeline(phase: .finished, index: segments.count - 1, start: last.endAt, target: last.endAt, finalEnd: last.endAt) }
        if now < first.startAt { return Timeline(phase: .upcoming, index: 0, start: now, target: first.startAt, finalEnd: last.endAt) }
        guard let index = segments.firstIndex(where: { now < $0.endAt }) else { return nil }
        let segment = segments[index]
        let inBreak = now < segment.startAt
        return Timeline(phase: mode == .segmented && inBreak ? .intermission : .inClass, index: index,
            start: mode == .whole ? first.startAt : inBreak ? segments[index - 1].endAt : segment.startAt,
            target: mode == .whole ? last.endAt : inBreak ? segment.startAt : segment.endAt, finalEnd: last.endAt)
    }

    public struct LocalCourse: Codable, Hashable {
        public var occurrenceId: String?
        public var accountScope: String?
        public var segments: [Segment]?
        public var mode: TimingMode?
        public var contentVersion: String?
        public let dateKey: String
        public let period: Int
        public let name: String
        public let teacher: String
        public let location: String
        public let periodLabel: String?
        public let startDate: Date
        public let endDate: Date
        public let weekRangeLabel: String?
        /// 这一天的调休说明。可选，旧快照解出来就是 nil。
        public let adjustmentNote: String?

        public init(dateKey: String, period: Int, name: String, teacher: String, location: String,
                    periodLabel: String?, startDate: Date, endDate: Date, weekRangeLabel: String?,
                    adjustmentNote: String? = nil) {
            self.dateKey = dateKey
            self.period = period
            self.name = name
            self.teacher = teacher
            self.location = location
            self.periodLabel = periodLabel
            self.startDate = startDate
            self.endDate = endDate
            self.weekRangeLabel = weekRangeLabel
            self.adjustmentNote = adjustmentNote
        }
    }

    public struct ContentState: Codable, Hashable {
        public enum Phase: String, Codable, Hashable {
            case idle
            case upcoming
            case inProgress
            case intermission
        }

        // Missing only when enumerating retired activities for cleanup. New content always encodes 2.
        public let protocolVersion: Int?
        public var scheduleId: String?
        public var scheduleVersion: String?
        public var eventType: String?
        public var eventTime: Date?
        public let phase: Phase
        public let courseName: String
        public let teacher: String
        public let location: String
        /// Optional fields keep activities created by an older app version
        /// decodable while giving the Watch mirrored activity more context.
        public let periodLabel: String?
        public let dateLabel: String?
        /// The course's published week range (for example, "1-16周").
        /// Optional so activities created before this field was introduced
        /// remain decodable.
        public let weekRangeLabel: String?
        public let startDate: Date
        public let endDate: Date
        public let nextCourseName: String?
        public let nextCoursePeriod: String?
        public let nextCourseDateLabel: String?
        public let nextCourseWeekRangeLabel: String?
        public let nextCourseTeacher: String?
        public let nextCourseLocation: String?
        public let nextCourseStart: Date?
        public let nextCourseEnd: Date?
        /// 调休说明，例如「国庆节放假」或「上 9.16 周三的课」。空表示照常上课。
        /// Optional so an activity started before this field existed still
        /// decodes.
        public let adjustmentNote: String?
        public let updatedAt: Date
        /// Compact school-channel boundary marker. The widget resolves the
        /// student's actual course from the App Group snapshot instead of
        /// receiving personal course data in a broadcast payload.
        public let broadcastDateKey: String?
        public let broadcastPeriod: Int?
        public let broadcastPhase: String?
        public let broadcastTimestamp: Date?

        public init(
            phase: Phase,
            courseName: String,
            teacher: String = "",
            location: String = "",
            periodLabel: String? = nil,
            dateLabel: String? = nil,
            weekRangeLabel: String? = nil,
            startDate: Date,
            endDate: Date,
            nextCourseName: String? = nil,
            nextCoursePeriod: String? = nil,
            nextCourseDateLabel: String? = nil,
            nextCourseWeekRangeLabel: String? = nil,
            nextCourseTeacher: String? = nil,
            nextCourseLocation: String? = nil,
            nextCourseStart: Date? = nil,
            nextCourseEnd: Date? = nil,
            adjustmentNote: String? = nil,
            updatedAt: Date = .now,
            broadcastDateKey: String? = nil,
            broadcastPeriod: Int? = nil,
            broadcastPhase: String? = nil,
            broadcastTimestamp: Date? = nil
        ) {
            self.protocolVersion = 2
            self.phase = phase
            self.courseName = courseName
            self.teacher = teacher
            self.location = location
            self.periodLabel = periodLabel
            self.dateLabel = dateLabel
            self.weekRangeLabel = weekRangeLabel
            self.startDate = startDate
            self.endDate = endDate
            self.nextCourseName = nextCourseName
            self.nextCoursePeriod = nextCoursePeriod
            self.nextCourseDateLabel = nextCourseDateLabel
            self.nextCourseWeekRangeLabel = nextCourseWeekRangeLabel
            self.nextCourseTeacher = nextCourseTeacher
            self.nextCourseLocation = nextCourseLocation
            self.nextCourseStart = nextCourseStart
            self.nextCourseEnd = nextCourseEnd
            self.adjustmentNote = adjustmentNote?.trimmingCharacters(in: .whitespacesAndNewlines)
            self.updatedAt = updatedAt
            self.broadcastDateKey = broadcastDateKey
            self.broadcastPeriod = broadcastPeriod
            self.broadcastPhase = broadcastPhase
            self.broadcastTimestamp = broadcastTimestamp
        }

        /// 调休说明，去掉空白后为空就当没有。
        public var normalizedAdjustmentNote: String? {
            guard let value = adjustmentNote?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.isEmpty else { return nil }
            return value
        }

        /// Rehydrate a broadcast boundary with this user's private local
        /// timetable. Broadcast payloads intentionally carry no course text.
        public func resolvedForBroadcast(attributes: ScheduleLiveActivityAttributes? = nil, now: Date = .now, cachedCourses: [ScheduleLiveActivityAttributes.LocalCourse]? = nil) -> Self {
            guard let attributes, attributes.semester != "__preview__" else { return self }
            let group = ((Bundle.main.object(forInfoDictionaryKey: "CPUAppGroupIdentifier") as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 } ?? "group.cn.cputime.mobile"
            let defaults = UserDefaults(suiteName: group)
            let courses = cachedCourses ?? defaults?.data(forKey: ScheduleLiveActivityAttributes.broadcastCoursesKey)
                .flatMap { try? JSONDecoder().decode([LocalCourse].self, from: $0) } ?? []
            let finalEnd = attributes.reservationEnd ?? now
            guard let identity = attributes.occurrenceId, let account = attributes.accountScope,
                  (cachedCourses != nil || defaults?.string(forKey: "cpu.liveActivity.account") == account),
                  let course = courses.first(where: { $0.occurrenceId == identity && $0.accountScope == account }),
                  let segments = course.segments,
                  let timeline = ScheduleLiveActivityAttributes.resolveTimeline(segments, mode: course.mode ?? .whole, now: now) else {
                return Self(phase: .idle, courseName: now >= finalEnd ? "课程已结束" : "课程信息暂不可用", startDate: now, endDate: finalEnd, updatedAt: now)
            }
            if timeline.phase == .finished { return Self(phase: .idle, courseName: "课程已结束", startDate: finalEnd, endDate: finalEnd, updatedAt: now) }
            let phase: Phase = timeline.phase == .upcoming ? .upcoming : timeline.phase == .intermission ? .intermission : .inProgress
            return Self(phase: phase, courseName: course.name, teacher: course.teacher, location: course.location,
                periodLabel: course.periodLabel, dateLabel: attributes.dateKey, weekRangeLabel: course.weekRangeLabel,
                startDate: phase == .inProgress ? timeline.start : timeline.target, endDate: timeline.target,
                adjustmentNote: course.adjustmentNote, updatedAt: now)

        }
    }

    public var occurrenceId: String?
    public var accountScope: String?
    public var scheduleId: String?
    public var scheduleVersion: String?
    public let semester: String
    public let dateKey: String
    public let week: Int
    public let broadcastWindow: String?
    public let broadcastChannel: String?
    public let reservationStart: Date?
    public let reservationEnd: Date?
    public let reminderDate: Date?

    public init(semester: String, dateKey: String, week: Int = 0, broadcastWindow: String? = nil, broadcastChannel: String? = nil, reservationStart: Date? = nil, reservationEnd: Date? = nil, reminderDate: Date? = nil) {
        self.semester = semester
        self.dateKey = dateKey
        self.week = week
        self.broadcastWindow = broadcastWindow
        self.broadcastChannel = broadcastChannel
        self.reservationStart = reservationStart
        self.reservationEnd = reservationEnd
        self.reminderDate = reminderDate
    }

    /// The activity should open the exact timetable context represented by the
    /// island. Keeping the query in the shared model means the app and widget
    /// extension cannot drift apart when a user taps the activity.
    public var deepLinkURL: URL {
        var components = URLComponents()
        components.scheme = "cputime-next"
        components.host = "schedule"
        components.queryItems = [
            URLQueryItem(name: "source", value: "live-activity"),
            URLQueryItem(name: "semester", value: semester.isEmpty ? nil : semester),
            URLQueryItem(name: "week", value: week > 0 ? String(week) : nil),
        ].filter { $0.value != nil }
        return components.url ?? URL(string: "cputime-next://schedule")!
    }
}
