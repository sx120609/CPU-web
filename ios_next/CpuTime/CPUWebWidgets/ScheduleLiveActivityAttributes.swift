import ActivityKit
import Foundation

/// Shared wire model for the iPhone Live Activity and its WidgetKit view.
/// This file is compiled into both the app and the widget extension.
public struct ScheduleLiveActivityAttributes: ActivityAttributes, Equatable {
    public static let broadcastCoursesKey = "cpu.liveActivity.broadcastCourses"

    public struct LocalCourse: Codable, Hashable {
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
        }

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
            guard broadcastDateKey != nil || attributes?.broadcastWindow != nil else { return self }
            let dateKey = attributes?.dateKey ?? broadcastDateKey ?? ""
            let group = ((Bundle.main.object(forInfoDictionaryKey: "CPUAppGroupIdentifier") as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 } ?? "group.cn.cputime.mobile"
            let courses = cachedCourses ?? UserDefaults(suiteName: group)?.data(forKey: ScheduleLiveActivityAttributes.broadcastCoursesKey)
                .flatMap { try? JSONDecoder().decode([ScheduleLiveActivityAttributes.LocalCourse].self, from: $0) } ?? []
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
            let window = attributes?.broadcastWindow
            let sameDay = courses.filter {
                let hour = calendar.component(.hour, from: $0.startDate)
                let matchesWindow = window == nil || window == dateKey || (window == "morning" && hour < 12)
                    || (window == "afternoon" && hour >= 12 && hour < 18) || (window == "evening" && hour >= 18)
                let matchesLesson = window != dateKey || attributes?.reservationStart == $0.startDate
                return $0.dateKey == dateKey && matchesWindow && matchesLesson && $0.endDate > now
            }.sorted { $0.startDate < $1.startDate }
            // Use actual time, not the period's first slot: a multi-slot course
            // remains in progress through its intermediate school boundaries.
            guard let course = sameDay.first(where: { $0.startDate <= now }) ?? sameDay.first else {
                return Self(phase: .idle, courseName: "本时段课程已结束", startDate: now, endDate: now, updatedAt: now)
            }
            let next = sameDay.first { $0.startDate > course.startDate }
            return Self(
                phase: course.startDate <= now ? .inProgress : .upcoming,
                courseName: course.name, teacher: course.teacher, location: course.location,
                periodLabel: course.periodLabel, dateLabel: dateKey, weekRangeLabel: course.weekRangeLabel,
                startDate: course.startDate, endDate: course.endDate,
                nextCourseName: next?.name, nextCoursePeriod: next?.periodLabel,
                nextCourseDateLabel: next?.dateKey, nextCourseWeekRangeLabel: next?.weekRangeLabel,
                nextCourseTeacher: next?.teacher, nextCourseLocation: next?.location,
                nextCourseStart: next?.startDate, nextCourseEnd: next?.endDate,
                adjustmentNote: course.adjustmentNote, updatedAt: now
            )
        }
    }

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
