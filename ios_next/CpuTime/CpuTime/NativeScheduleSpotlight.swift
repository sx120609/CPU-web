import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

/// The timetable's courses in system search: one entry per course and room,
/// with the days and times it meets. Tapping one opens the timetable on that
/// course's quick look. Only the user's own timetable is indexed; signing
/// out removes every entry.
enum NativeScheduleSpotlight {
    static let domain = "cn.cputime.schedule.course"
    /// Posted with the course name when an entry is opened from search.
    static let openNotification = Notification.Name("CPUScheduleSpotlightOpen")

    static func index(_ record: NativeWidgetLocalSchedule.Record?) {
        let index = CSSearchableIndex.default()
        guard let record else {
            index.deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in }
            return
        }
        struct Entry { var name: String; var location: String?; var times: [String: String] }
        var entries: [String: Entry] = [:]
        let weekdays = ["一", "二", "三", "四", "五", "六", "日"]
        for day in record.days {
            for course in day.courses {
                let name = course.name.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else { continue }
                let location = course.location?.trimmedNonEmpty.map(ScheduleClassroom.only)
                let key = "\(name)|\(location ?? "")"
                var entry = entries[key] ?? Entry(name: name, location: location, times: [:])
                let weekday = (1...7).contains(day.day) ? "周\(weekdays[day.day - 1])" : ""
                let time = [course.startTime, course.endTime].compactMap { $0 }.joined(separator: "–")
                entry.times["\(day.day)|\(time)"] = "\(weekday) \(time)"
                entries[key] = entry
            }
        }
        let items = entries.map { key, entry -> CSSearchableItem in
            let attributes = CSSearchableItemAttributeSet(contentType: .text)
            attributes.title = entry.name
            let times = entry.times.sorted { $0.key < $1.key }.map(\.value).prefix(4).joined(separator: "、")
            attributes.contentDescription = [entry.location, times.isEmpty ? nil : times].compactMap { $0 }.joined(separator: " · ")
            attributes.keywords = ["课表", "课程", entry.name] + [entry.location].compactMap { $0 }
            return CSSearchableItem(uniqueIdentifier: "course:\(key)", domainIdentifier: domain, attributeSet: attributes)
        }
        index.deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in
            index.indexSearchableItems(items) { _ in }
        }
    }

    /// The course name of a search entry's identifier.
    static func courseName(fromIdentifier identifier: String) -> String? {
        guard identifier.hasPrefix("course:") else { return nil }
        return identifier.dropFirst("course:".count).split(separator: "|", omittingEmptySubsequences: false).first.map(String.init)
    }
}
