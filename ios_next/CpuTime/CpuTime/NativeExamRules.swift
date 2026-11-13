import Foundation

/// One exam arrangement as 教务 lists it (`GET /api/jwxt/exams`, the Web's 考试安排). Only the
/// course name is certain; the time is 教务's own text and each school writes it its own way.
struct NativeExam: Codable, Hashable, Identifiable, Sendable {
    var courseName: String
    /// e.g. "2026-07-08(09:00-12:00)" (南医) or "2027-01-05 09:30~11:30" (南中医); may be empty.
    var examTime: String
    var location: String
    var seat: String
    var examType: String
    var examName: String
    var semester: String

    enum CodingKeys: String, CodingKey { case courseName, examTime, location, seat, examType, examName, semester }

    init(courseName: String, examTime: String = "", location: String = "", seat: String = "",
         examType: String = "", examName: String = "", semester: String = "") {
        self.courseName = courseName
        self.examTime = examTime
        self.location = location
        self.seat = seat
        self.examType = examType
        self.examName = examName
        self.semester = semester
    }

    /// A field that is missing or of another type reads as empty; a list never fails for one row.
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        func text(_ key: CodingKeys) -> String {
            ((try? values.decodeIfPresent(String.self, forKey: key)) ?? "")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        }
        courseName = text(.courseName)
        examTime = text(.examTime)
        location = text(.location)
        seat = text(.seat)
        examType = text(.examType)
        examName = text(.examName)
        semester = text(.semester)
    }

    /// 教务 gives no identity, so the arrangement itself is one: the same course at the same
    /// time is the same exam, and a moved exam is a new one.
    var id: String { "exam:" + NativeExamRules.hash("\(semester)|\(courseName)|\(examTime)") }

    var when: NativeExamRules.When? { NativeExamRules.parse(examTime) }

    /// The kind of exam, when it says more than 教务's long title does (期末考试, 重修).
    var kindText: String {
        let type = examType.isEmpty ? examName : examType
        // 南医 writes the whole 「2025-2026学年第二学期期末考试」 into both.
        if let range = type.range(of: "学期") { return String(type[range.upperBound...]).trimmingCharacters(in: .whitespaces) }
        return type
    }

    var place: String {
        [location, seat.isEmpty ? "" : "座位 \(seat)"].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

enum NativeExamRules {
    /// What an exam's time text says: a day, and a start and end when it gives clocks.
    struct When: Equatable {
        /// "yyyy-MM-dd"
        let date: String
        /// "HH:mm" or empty.
        let start: String
        let end: String
    }

    /// Reads 教务's time text the way the Web's 考试安排 does (`parseExamTime` in
    /// web/src/components/jwxt/examSchedule.ts): the first real date, then the clocks after it.
    /// The first clock is the start; the second is the end only when it is later.
    static func parse(_ text: String) -> When? {
        guard let dateRegex = try? NSRegularExpression(pattern: #"(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?"#),
              let clockRegex = try? NSRegularExpression(pattern: #"(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*\d{2})?"#) else { return nil }
        let whole = NSRange(text.startIndex..., in: text)
        guard let match = dateRegex.firstMatch(in: text, range: whole) else { return nil }
        func number(_ result: NSTextCheckingResult, _ index: Int) -> Int? {
            Range(result.range(at: index), in: text).flatMap { Int(text[$0]) }
        }
        guard let year = number(match, 1), let month = number(match, 2), let day = number(match, 3) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        // 2 月 30 日 is no date: the calendar would roll it over, so check it came back as asked.
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12)),
              calendar.dateComponents([.year, .month, .day], from: date) == DateComponents(year: year, month: month, day: day) else { return nil }
        let rest = NSRange(location: match.range.upperBound, length: whole.upperBound - match.range.upperBound)
        let clocks: [Int] = clockRegex.matches(in: text, range: rest).compactMap { result in
            guard let hour = number(result, 1), let minute = number(result, 2), hour < 24, minute < 60 else { return nil }
            return hour * 60 + minute
        }
        func clock(_ minutes: Int) -> String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }
        let start = clocks.first
        let end = clocks.count > 1 && clocks[1] > (start ?? 0) ? clocks[1] : nil
        return When(date: String(format: "%04d-%02d-%02d", year, month, day), start: start.map(clock) ?? "", end: end.map(clock) ?? "")
    }

    /// FNV-1a, as hex: stable across launches, which `hashValue` is not.
    static func hash(_ text: String) -> String {
        var value: UInt64 = 0xcbf29ce484222325
        for byte in text.utf8 {
            value ^= UInt64(byte)
            value = value &* 0x100000001b3
        }
        return String(value, radix: 16)
    }

    static func isExam(_ id: String) -> Bool { id.hasPrefix("exam:") }

    /// Days from `today` to the exam ("yyyy-MM-dd" both); negative once it is past.
    static func daysUntil(_ date: String, today: String) -> Int? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        func day(_ text: String) -> Date? {
            let parts = text.split(separator: "-").compactMap { Int($0) }
            return parts.count == 3 ? calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)) : nil
        }
        guard let from = day(today), let to = day(date) else { return nil }
        return calendar.dateComponents([.day], from: from, to: to).day
    }

    static func countdown(_ date: String, today: String) -> String {
        guard let days = daysUntil(date, today: today) else { return "" }
        switch days {
        case ..<0: return "已结束"
        case 0: return "今天"
        case 1: return "明天"
        case 2: return "后天"
        default: return "\(days) 天后"
        }
    }

    /// Exams with a day, soonest first, then those 教务 has not dated; the past ones last, newest first.
    static func ordered(_ exams: [NativeExam], today: String) -> [NativeExam] {
        func rank(_ exam: NativeExam) -> Int {
            guard let when = exam.when else { return 1 }
            return when.date >= today ? 0 : 2
        }
        func moment(_ exam: NativeExam) -> String { (exam.when?.date ?? "") + (exam.when?.start ?? "") }
        return exams.sorted { first, second in
            let ranks = (rank(first), rank(second))
            if ranks.0 != ranks.1 { return ranks.0 < ranks.1 }
            let moments = (moment(first), moment(second))
            if moments.0 == moments.1 { return first.courseName < second.courseName }
            return ranks.0 == 2 ? moments.0 > moments.1 : moments.0 < moments.1
        }
    }

    /// The exams still ahead (or today) as 日程, so the timetable, the month, the widgets and the
    /// reminders that already draw 日程 show them too. They are made here from 教务's list each
    /// time and never saved as 日程: `NativeExamRules.isExam` tells them apart, and they can be
    /// neither edited nor ticked. The reminder is a day ahead.
    static func agendaItems(_ exams: [NativeExam], today: String) -> [NativeAgendaItem] {
        var seen = Set<String>()
        return exams.compactMap { exam in
            guard let when = exam.when, when.date >= today, seen.insert(exam.id).inserted else { return nil }
            return NativeAgendaItem(
                id: exam.id, kind: "event", title: "考试 · \(exam.courseName)", date: when.date,
                start: when.start, end: when.end, location: exam.place, note: exam.kindText, remind: 1440)
        }
    }
}
