import Foundation

/// Builds an `.ics` document from the meetings `NativeScheduleOccurrences`
/// resolved, so the file follows days off, make-up days and a course's own
/// clock times exactly as the timetable and the Apple Calendar import do.
enum NativeScheduleICSExporter {
    static func make(
        occurrences: [NativeScheduleOccurrence],
        calendarName: String,
        stamp: Date = .now,
        timeZone: TimeZone = NativeScheduleOccurrences.timeZone
    ) -> String {
        var lines = [
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CPUTime//Schedule//CN",
            "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
            "X-WR-CALNAME:\(escape(calendarName))",
            "X-WR-TIMEZONE:\(timeZone.identifier)",
        ]
        let utc = TimeZone(identifier: "UTC") ?? timeZone
        for occurrence in occurrences {
            let course = occurrence.course
            let uid = occurrence.key.unicodeScalars
                .map { $0.value < 128 ? String($0) : String(format: "%02X", $0.value) }
                .joined()
            lines.append("BEGIN:VEVENT")
            lines.append("UID:\(escape(uid))@cputime.cn")
            lines.append("DTSTAMP:\(format(stamp, zone: utc))Z")
            lines.append("DTSTART;TZID=\(timeZone.identifier):\(format(occurrence.start, zone: timeZone))")
            lines.append("DTEND;TZID=\(timeZone.identifier):\(format(occurrence.end, zone: timeZone))")
            lines.append("SUMMARY:\(escape(course.name.trimmedNonEmpty ?? "课程"))")
            if let location = course.location?.trimmedNonEmpty {
                lines.append("LOCATION:\(escape(ScheduleClassroom.only(location)))")
            }
            var details = ["第 \(occurrence.week) 周"]
            if let teacher = course.teacher?.trimmedNonEmpty { details.append(teacher) }
            if let note = course.editableNote { details.append(note) }
            if let source = occurrence.sourceDate { details.append("调休补 \(source) 的课") }
            lines.append("DESCRIPTION:\(escape(details.joined(separator: " · ")))")
            lines.append("END:VEVENT")
        }
        lines.append("END:VCALENDAR")
        return lines.map(fold).joined(separator: "\r\n") + "\r\n"
    }

    /// RFC 5545 caps a content line at 75 octets; longer lines continue on the
    /// next line after a single space, never inside a UTF-8 sequence.
    private static func fold(_ line: String) -> String {
        guard line.utf8.count > 75 else { return line }
        var parts: [String] = []
        var current = ""
        var size = 0
        for character in line {
            let width = String(character).utf8.count
            let limit = parts.isEmpty ? 75 : 74
            if size + width > limit {
                parts.append(current)
                current = ""
                size = 0
            }
            current.append(character)
            size += width
        }
        parts.append(current)
        return parts.joined(separator: "\r\n ")
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
