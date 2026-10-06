import Foundation

/// Builds a one-week `.ics` document for the share sheet. It takes the courses
/// the timetable already resolved for each date, so a day off exports nothing
/// and a make-up day exports the courses it actually runs.
enum NativeScheduleICSExporter {
    struct Day {
        /// "yyyy-MM-dd".
        let date: String
        let blocks: [NativeScheduleCourseBlock]
    }

    static func make(
        week: Int,
        days: [Day],
        clocks: [ScheduleSlot],
        stamp: Date = .now,
        timeZone: TimeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
    ) -> String {
        var lines = [
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CPUTime//Schedule//CN",
            "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        ]
        let utc = TimeZone(identifier: "UTC") ?? timeZone
        for day in days {
            guard let date = parseDate(day.date, zone: timeZone) else { continue }
            for block in day.blocks {
                // A custom course may carry its own clock times; they win over the bell schedule.
                let startText = clock(block.course.customStartTime)
                    ?? clocks.first { $0.number == block.startSlot }?.start
                let endText = clock(block.course.customEndTime)
                    ?? clocks.first { $0.number == block.endSlot }?.end
                guard let startText, let endText,
                      let start = self.date(day: date, time: startText, zone: timeZone),
                      let end = self.date(day: date, time: endText, zone: timeZone), end > start else { continue }
                let course = block.course
                let identity = course.customId ?? course.nativeId ?? course.sourceKey ?? course.id
                let uid = "\(week)-\(day.date)-\(block.startSlot)-\(block.endSlot)-\(identity)"
                    .unicodeScalars.map { $0.value < 128 ? String($0) : String(format: "%02X", $0.value) }.joined()
                lines.append("BEGIN:VEVENT")
                lines.append("UID:\(escape(uid))@cputime.cn")
                lines.append("DTSTAMP:\(format(stamp, zone: utc))Z")
                lines.append("DTSTART;TZID=\(timeZone.identifier):\(format(start, zone: timeZone))")
                lines.append("DTEND;TZID=\(timeZone.identifier):\(format(end, zone: timeZone))")
                lines.append("SUMMARY:\(escape(trimmed(course.name) ?? "课程"))")
                if let location = trimmed(course.location) { lines.append("LOCATION:\(escape(location))") }
                let details = [trimmed(course.teacher), trimmed(course.slotNote)]
                    .compactMap { $0 }.joined(separator: " · ")
                if !details.isEmpty { lines.append("DESCRIPTION:\(escape(details))") }
                lines.append("END:VEVENT")
            }
        }
        lines.append("END:VCALENDAR")
        return lines.joined(separator: "\r\n") + "\r\n"
    }

    private static func trimmed(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    private static func clock(_ value: String?) -> String? {
        guard let value = trimmed(value), value.split(separator: ":").compactMap({ Int($0) }).count >= 2 else {
            return nil
        }
        return value
    }

    private static func parseDate(_ value: String, zone: TimeZone) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    private static func date(day: Date, time: String, zone: TimeZone) -> Date? {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        var components = calendar.dateComponents([.year, .month, .day], from: day)
        components.hour = parts[0]
        components.minute = parts[1]
        components.second = 0
        return calendar.date(from: components)
    }

    private static func format(_ value: Date, zone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "yyyyMMdd'T'HHmmss"
        return formatter.string(from: value)
    }

    private static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: ";", with: "\\;")
            .replacingOccurrences(of: ",", with: "\\,")
            .replacingOccurrences(of: "\n", with: "\\n")
    }
}
