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

        public init(dateKey: String, period: Int, name: String, teacher: String, location: String,
                    periodLabel: String?, startDate: Date, endDate: Date, weekRangeLabel: String?) {
            self.dateKey = dateKey
            self.period = period
            self.name = name
            self.teacher = teacher
            self.location = location
            self.periodLabel = periodLabel
            self.startDate = startDate
            self.endDate = endDate
            self.weekRangeLabel = weekRangeLabel
        }
    }

    public struct ContentState: Codable, Hashable {
        public enum Phase: String, Codable, Hashable {
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
            self.updatedAt = updatedAt
            self.broadcastDateKey = broadcastDateKey
            self.broadcastPeriod = broadcastPeriod
            self.broadcastPhase = broadcastPhase
            self.broadcastTimestamp = broadcastTimestamp
        }

        /// Rehydrate a broadcast boundary with this user's private local
        /// timetable. Broadcast payloads intentionally carry no course text.
        public func resolvedForBroadcast() -> Self {
            let group = ((Bundle.main.object(forInfoDictionaryKey: "CPUAppGroupIdentifier") as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 } ?? "group.cn.cputime.mobile"
            guard let dateKey = broadcastDateKey, let period = broadcastPeriod,
                  let data = UserDefaults(suiteName: group)?.data(forKey: ScheduleLiveActivityAttributes.broadcastCoursesKey),
                  let courses = try? JSONDecoder().decode([ScheduleLiveActivityAttributes.LocalCourse].self, from: data) else { return self }
            let sameDay = courses.filter { $0.dateKey == dateKey }
            let course = broadcastPhase == "ended"
                ? sameDay.first(where: { $0.period > period }) ?? sameDay.first(where: { $0.period == period })
                : sameDay.first(where: { $0.period == period })
            guard let course else { return self }
            let phase: Phase = broadcastPhase == "started" || broadcastPhase == "inProgress" ? .inProgress : .upcoming
            return Self(
                phase: phase,
                courseName: course.name,
                teacher: course.teacher,
                location: course.location,
                periodLabel: course.periodLabel,
                dateLabel: dateKey,
                weekRangeLabel: course.weekRangeLabel,
                startDate: course.startDate,
                endDate: course.endDate,
                updatedAt: broadcastTimestamp ?? .now
            )
        }
    }

    public let semester: String
    public let dateKey: String
    public let week: Int

    public init(semester: String, dateKey: String, week: Int = 0) {
        self.semester = semester
        self.dateKey = dateKey
        self.week = week
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
