import ActivityKit
import Foundation

/// Shared wire model for the iPhone Live Activity and its WidgetKit view.
/// This file is compiled into both the app and the widget extension.
public struct ScheduleLiveActivityAttributes: ActivityAttributes, Equatable {
    public struct ContentState: Codable, Hashable {
        public enum Phase: String, Codable, Hashable {
            case upcoming
            case inProgress
        }

        public let phase: Phase
        public let courseName: String
        public let teacher: String
        public let location: String
        public let startDate: Date
        public let endDate: Date
        public let nextCourseName: String?
        public let nextCourseStart: Date?
        public let updatedAt: Date

        public init(
            phase: Phase,
            courseName: String,
            teacher: String = "",
            location: String = "",
            startDate: Date,
            endDate: Date,
            nextCourseName: String? = nil,
            nextCourseStart: Date? = nil,
            updatedAt: Date = .now
        ) {
            self.phase = phase
            self.courseName = courseName
            self.teacher = teacher
            self.location = location
            self.startDate = startDate
            self.endDate = endDate
            self.nextCourseName = nextCourseName
            self.nextCourseStart = nextCourseStart
            self.updatedAt = updatedAt
        }
    }

    public let semester: String
    public let dateKey: String

    public init(semester: String, dateKey: String) {
        self.semester = semester
        self.dateKey = dateKey
    }
}
