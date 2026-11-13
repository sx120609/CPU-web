import Foundation

/// What the timetable's own notifications are worked out from, with nothing but
/// Foundation: 课前提醒 for the user's classes and 「TA 下课了」 for a partner's.
/// The app's side (permission, scheduling, settings) is `NativeClassReminders`.
enum NativeClassReminderRules {
    /// One class on one date. Times are minutes since midnight in the school's zone.
    struct Meeting: Equatable {
        let name: String
        let location: String?
        let date: String
        let start: Int
        let end: Int
    }

    struct Planned: Identifiable, Equatable {
        let date: String
        /// The class's start, minutes since midnight.
        let start: Int
        let fire: Date
        let title: String
        let body: String
        var id: String { "\(date).\(start)" }
    }

    static let zone = TimeZone(identifier: "Asia/Shanghai") ?? .current
    static let leads = [5, 10, 15, 20, 30]

    static func normalizedLead(_ value: Int) -> Int { leads.contains(value) ? value : 15 }

    static func clock(_ minutes: Int) -> String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }

    /// The moment `minute` of `date` ("yyyy-MM-dd") is in the school's zone.
    static func instant(date: String, minute: Int) -> Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: minute / 60, minute: minute % 60))
    }

    /// 课前提醒: one notification before each class, earliest first, at most `limit`.
    ///
    /// A class is announced `lead` minutes ahead, or when the class before it ends if that is
    /// later: nobody wants the next room read out in the middle of a lecture. Classes whose
    /// moment has passed are left out, and so is the whole of `skipping` (「今天不再提醒」).
    static func plan(_ days: [[Meeting]], lead: Int, now: Date, limit: Int, skipping: String? = nil) -> [Planned] {
        var planned: [Planned] = []
        for day in days {
            let meetings = day.sorted { $0.start < $1.start }
            var previousEnd: Int?
            for meeting in meetings {
                defer { previousEnd = max(previousEnd ?? 0, meeting.end) }
                guard meeting.date != skipping, meeting.end > meeting.start else { continue }
                var minute = meeting.start - lead
                if let previousEnd, previousEnd <= meeting.start { minute = max(minute, previousEnd) }
                guard minute >= 0, let fire = instant(date: meeting.date, minute: minute), fire > now else { continue }
                let ahead = meeting.start - minute
                let room = meeting.location.map(ScheduleClassroom.only).flatMap { $0.isEmpty ? nil : $0 }
                planned.append(Planned(
                    date: meeting.date, start: meeting.start, fire: fire,
                    title: "\(meeting.name) · \(clock(meeting.start)) 上课",
                    body: ([ahead > 0 ? "\(ahead) 分钟后开始" : "现在上课"] + (room.map { [$0] } ?? [])).joined(separator: " · ")))
            }
        }
        return Array(planned.sorted { $0.fire < $1.fire }.prefix(max(0, limit)))
    }

    /// A stretch of a day, minutes since midnight.
    struct Window: Identifiable, Equatable {
        let start: Int
        let end: Int
        var id: Int { start }
        var text: String { "\(clock(start))–\(clock(end))" }
    }

    /// When neither of two people has a class: the stretches of `earliest..<latest` at least
    /// `minimum` minutes long that no class of either touches, from `from` on (the present
    /// minute on today, so what is already past is not offered).
    static func sharedFree(mine: [Meeting], theirs: [Meeting], earliest: Int = 8 * 60, latest: Int = 22 * 60 + 30,
                           minimum: Int = 30, from: Int = 0) -> [Window] {
        let busy = (mine + theirs).filter { $0.end > $0.start }.sorted { $0.start < $1.start }
        var windows: [Window] = []
        var cursor = max(earliest, from)
        for meeting in busy {
            if meeting.start - cursor >= minimum { windows.append(Window(start: cursor, end: min(meeting.start, latest))) }
            cursor = max(cursor, meeting.end)
            if cursor >= latest { break }
        }
        if latest - cursor >= minimum { windows.append(Window(start: cursor, end: latest)) }
        return windows.filter { $0.end - $0.start >= minimum }
    }

    /// A class both take: the same name (spaces aside) at the same clock times. By the clock
    /// rather than the period number, since two schools number their periods differently.
    static func isTogether(_ mine: Meeting, with theirs: [Meeting]) -> Bool {
        func clean(_ name: String) -> String { name.filter { !$0.isWhitespace } }
        return theirs.contains { $0.start == mine.start && $0.end == mine.end && clean($0.name) == clean(mine.name) }
    }

    /// 「TA 下课了」: one notification when a run of the partner's classes ends.
    ///
    /// Classes less than `gap` minutes apart are one run, so a morning of four periods says it
    /// once, at the end. `mine` are the user's classes on the same dates: the text says whether
    /// the user is free at that moment, and until when both are.
    static func partnerPlan(_ days: [[Meeting]], mine: [[Meeting]], name: String, now: Date, limit: Int, gap: Int = 20) -> [Planned] {
        var planned: [Planned] = []
        let own = Dictionary(mine.flatMap { $0 }.map { ($0.date, [$0]) }, uniquingKeysWith: +)
        for day in days {
            let meetings = day.filter { $0.end > $0.start }.sorted { $0.start < $1.start }
            var index = 0
            while index < meetings.count {
                var last = meetings[index]
                var names = [last.name]
                var next = index + 1
                while next < meetings.count, meetings[next].start - last.end < gap {
                    if !names.contains(meetings[next].name) { names.append(meetings[next].name) }
                    if meetings[next].end > last.end { last = meetings[next] }
                    next += 1
                }
                let end = meetings[index..<next].map(\.end).max() ?? last.end
                defer { index = next }
                guard let fire = instant(date: last.date, minute: end), fire > now else { continue }
                let theirNext = next < meetings.count ? meetings[next].start : nil
                let ownToday = (own[last.date] ?? []).sorted { $0.start < $1.start }
                let busy = ownToday.contains { $0.start <= end && end < $0.end }
                let ownNext = ownToday.first { $0.start > end }?.start
                var body = "刚上完「\(names.joined(separator: "、"))」"
                if busy {
                    body += "，你还在上课"
                } else if let until = [theirNext, ownNext].compactMap({ $0 }).min() {
                    body += until - end >= 20 ? "，你们都有空到 \(clock(until))" : ""
                } else {
                    body += "，今天你们都没课了"
                }
                planned.append(Planned(date: last.date, start: end, fire: fire, title: "\(name) 下课了", body: body))
            }
        }
        return Array(planned.sorted { $0.fire < $1.fire }.prefix(max(0, limit)))
    }
}
