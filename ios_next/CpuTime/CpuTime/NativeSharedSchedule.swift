import Foundation

/// What the server says about a share without the timetable itself. A reader
/// polls this to decide whether the full download is worth doing.
struct NativeScheduleShareMeta: Codable, Equatable, Identifiable, Sendable {
    var code: String
    /// The nickname the publisher shared under; "同学" when they gave none.
    var owner: String
    var semester: String
    var courseCount: Int
    var createdAt: String
    var updatedAt: String

    var id: String { code }

    /// The publisher's nickname, when they shared under one.
    var ownerName: String? {
        let value = owner.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty || value == "同学" ? nil : value
    }

    init(code: String, owner: String = "", semester: String = "", courseCount: Int = 0,
         createdAt: String = "", updatedAt: String = "") {
        self.code = code
        self.owner = owner
        self.semester = semester
        self.courseCount = courseCount
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey { case code, owner, semester, courseCount, createdAt, updatedAt }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            code: try values.decode(String.self, forKey: .code),
            owner: try values.decodeIfPresent(String.self, forKey: .owner) ?? "",
            semester: try values.decodeIfPresent(String.self, forKey: .semester) ?? "",
            courseCount: (try? values.decodeIfPresent(Int.self, forKey: .courseCount)) ?? 0,
            createdAt: try values.decodeIfPresent(String.self, forKey: .createdAt) ?? "",
            updatedAt: try values.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
        )
    }
}

/// The answer to publishing the signed-in user's own timetable.
struct NativeSchedulePublishedShare: Decodable, Equatable, Sendable {
    var meta: NativeScheduleShareMeta
    /// A new code was made; `false` when the semester already had one.
    var created: Bool
    /// The timetable on the server changed; `false` when it was already current.
    var changed: Bool

    private enum CodingKeys: String, CodingKey { case created, changed }

    init(from decoder: Decoder) throws {
        meta = try NativeScheduleShareMeta(from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        created = (try? values.decodeIfPresent(Bool.self, forKey: .created)) ?? true
        changed = (try? values.decodeIfPresent(Bool.self, forKey: .changed)) ?? true
    }
}

/// Somebody else's timetable, saved whole on this device.
///
/// It carries the publisher's own calendar (first Monday, week count,
/// make-up days), so it is laid out with theirs rather than the reader's.
struct NativeSharedSchedule: Codable, Equatable, Identifiable, Sendable {
    var meta: NativeScheduleShareMeta
    var schedule: NativeScheduleResult
    var calendar: NativeScheduleCalendar
    /// The reader's own name for it; only on this device.
    var remark: String
    var fetchedAt: Date
    /// The publisher withdrew the share. The saved copy still opens, it just
    /// will not change again.
    var revoked: Bool

    var id: String { meta.code }

    /// The remark wins: a nickname is the publisher's choice and may be shared by many.
    var name: String {
        let value = remark.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? (meta.ownerName ?? "共享课表") : value
    }

    /// The semester value of the store showing it. Prefixed so nothing saved
    /// per semester can mix it up with one of the reader's own terms.
    var semesterValue: String { "share:\(meta.code)" }

    static let maximumCourses = 600

    init(meta: NativeScheduleShareMeta, schedule: NativeScheduleResult, calendar: NativeScheduleCalendar,
         remark: String = "", fetchedAt: Date = .now, revoked: Bool = false) {
        self.meta = meta
        self.schedule = schedule
        self.calendar = calendar
        self.remark = remark
        self.fetchedAt = fetchedAt
        self.revoked = revoked
    }

    private enum CodingKeys: String, CodingKey { case meta, schedule, calendar, remark, fetchedAt, revoked }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            meta: try values.decode(NativeScheduleShareMeta.self, forKey: .meta),
            schedule: try values.decode(NativeScheduleResult.self, forKey: .schedule),
            calendar: try values.decode(NativeScheduleCalendar.self, forKey: .calendar),
            remark: try values.decodeIfPresent(String.self, forKey: .remark) ?? "",
            fetchedAt: try values.decodeIfPresent(Date.self, forKey: .fetchedAt) ?? .distantPast,
            revoked: try values.decodeIfPresent(Bool.self, forKey: .revoked) ?? false
        )
    }

    // MARK: Share codes

    /// A share code out of whatever was typed or pasted: any case, spaces or
    /// dashes, or a whole `/schedule/share/CODE` link. `nil` when none is there.
    static func normalizedCode(_ input: String) -> String? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if let range = text.range(of: "/schedule/share/", options: .caseInsensitive) {
            text = String(text[range.upperBound...])
            text = String(text.prefix { $0 != "?" && $0 != "#" && $0 != "/" })
        }
        let code = text.uppercased().filter { !$0.isWhitespace && $0 != "-" }
        let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789")
        guard code.count == 8, code.allSatisfy(allowed.contains) else { return nil }
        return code
    }

    // MARK: Reading a share

    enum ReadError: LocalizedError, Equatable {
        case empty
        case noCalendar

        var errorDescription: String? {
            switch self {
            case .empty: return "这份共享课表里没有课程"
            case .noCalendar: return "这份共享课表没有校历，无法按周显示"
            }
        }
    }

    /// The server's share document. The server checks little more than that
    /// every course has a name, so everything a grid indexes with is clamped
    /// here: a bad row is dropped instead of drawn somewhere it cannot be.
    static func read(_ data: Data, fetchedAt: Date = .now) throws -> NativeSharedSchedule {
        struct Document: Decodable {
            let schedule: NativeScheduleResult
            let calendar: NativeScheduleCalendar
        }
        let decoder = JSONDecoder()
        let meta = try decoder.decode(NativeScheduleShareMeta.self, from: data)
        let document = try decoder.decode(Document.self, from: data)

        var remaining = maximumCourses
        var cells: [NativeScheduleCell] = []
        for cell in document.schedule.cells where (1...7).contains(cell.day) && (1...20).contains(cell.bigSlot) {
            var courses: [NativeScheduleCourse] = []
            for course in cell.courses where remaining > 0 {
                let name = course.name.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else { continue }
                let start = course.startSlot.map { min(max($0, 1), 20) }
                let end = course.endSlot.map { min(max($0, start ?? 1), 20) }
                // Edit identities belong to the publisher's account; a reader
                // cannot edit this timetable, so they are left behind.
                courses.append(NativeScheduleCourse(
                    customStartTime: course.customStartTime,
                    customEndTime: course.customEndTime,
                    name: String(name.prefix(80)),
                    teacher: course.teacher.map { String($0.prefix(80)) },
                    weeks: String(course.weeks.prefix(120)),
                    weekList: Array(Set(course.weekList.filter { (1...64).contains($0) })).sorted(),
                    location: course.location.map { String($0.prefix(80)) },
                    slotNote: course.slotNote.map { String($0.prefix(120)) },
                    startSlot: start,
                    endSlot: end
                ))
                remaining -= 1
            }
            if !courses.isEmpty { cells.append(NativeScheduleCell(day: cell.day, bigSlot: cell.bigSlot, courses: courses)) }
        }
        guard !cells.isEmpty else { throw ReadError.empty }

        let weeks = document.calendar.weeks
            .filter { (1...64).contains($0.week) }
            .compactMap { week -> NativeCalendarWeek? in
                guard let days = mondayFirstDays(week.days) else { return nil }
                return NativeCalendarWeek(week: week.week, days: days, monday: days[0], sunday: days[6])
            }
            .sorted { $0.week < $1.week }
        guard !weeks.isEmpty else { throw ReadError.noCalendar }
        let calendar = NativeScheduleCalendar(
            currentWeek: weeks[0].week,
            semesterStart: document.calendar.semesterStart,
            semesterEnd: document.calendar.semesterEnd,
            weeks: weeks,
            periods: document.calendar.periods.filter { (1...48).contains($0.number) },
            adjustments: document.calendar.adjustments.filter { $0.kind == "off" || $0.kind == "swap" }
        )
        let schedule = NativeScheduleResult(currentSemester: meta.semester, currentWeek: String(weeks[0].week), cells: cells)
        return NativeSharedSchedule(meta: meta, schedule: schedule, calendar: calendar, fetchedAt: fetchedAt)
    }

    /// Seven dates, Monday first, out of a week as 教务 lists it: the list may
    /// start on Sunday or miss days. The Web share page reads a week the same
    /// way (`normalizeCalendarWeekDays`), and a share published there keeps the
    /// raw list. `nil` when no entry is a date.
    static func mondayFirstDays(_ raw: [String]) -> [String]? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        func date(_ text: String) -> Date? {
            let parts = text.trimmingCharacters(in: .whitespaces).split(separator: "-")
            guard parts.count == 3, parts[0].count == 4, let year = Int(parts[0]),
                  let month = Int(parts[1]), let day = Int(parts[2]),
                  let value = calendar.date(from: DateComponents(year: year, month: month, day: day)),
                  calendar.dateComponents([.month, .day], from: value) == DateComponents(month: month, day: day) else { return nil }
            return value
        }
        // 1 is Monday, 7 is Sunday.
        func weekday(_ value: Date) -> Int { (calendar.component(.weekday, from: value) + 5) % 7 + 1 }
        let anchors = raw.enumerated().compactMap { index, text in date(text).map { (index: index, date: $0, day: weekday($0)) } }
        guard let anchor = anchors.first else { return nil }
        let sundayFirst = anchors.filter { $0.day == ($0.index == 0 ? 7 : $0.index) }.count
            > anchors.filter { $0.day == $0.index + 1 }.count
        let offset = sundayFirst ? (anchor.index == 0 ? -1 : anchor.index - 1) : anchor.index
        guard let monday = calendar.date(byAdding: .day, value: -offset, to: anchor.date) else { return nil }
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: monday) }.map {
            let parts = calendar.dateComponents([.year, .month, .day], from: $0)
            return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
        }
    }

    // MARK: Showing a share

    /// The week `today` ("yyyy-MM-dd") falls in. Before the term it is the
    /// first week and after it the last, so the grid always has a week to show.
    func week(containing today: String) -> Int {
        if let week = calendar.weeks.first(where: { $0.days.contains(today) }) { return week.week }
        guard let first = calendar.weeks.first, let last = calendar.weeks.last else { return 1 }
        return today < (first.days.first ?? "") ? first.week : last.week
    }

    /// A complete-semester snapshot of the share, as the timetable store takes
    /// it. The current week is worked out from `now`: the one saved in the
    /// share is whatever week the publisher happened to share it in.
    func snapshot(now: Date = .now) -> NativeScheduleSnapshot {
        let current = week(containing: Self.dateKey(now))
        let semesters = [NativeScheduleSemester(value: semesterValue, label: name, current: true)]
        let weeks = calendar.weeks.map {
            NativeScheduleWeek(value: String($0.week), label: "第 \($0.week) 周", current: $0.week == current)
        }
        let data = NativeScheduleResult(
            source: .shared, semesters: semesters, weeks: weeks,
            currentSemester: semesterValue, currentWeek: String(current), cells: schedule.cells
        )
        let shown = NativeScheduleCalendar(
            source: .shared, semesters: semesters, currentSemester: semesterValue, currentWeek: current,
            semesterStart: calendar.semesterStart, semesterEnd: calendar.semesterEnd,
            weeks: calendar.weeks, periods: calendar.periods, adjustments: calendar.adjustments
        )
        return NativeScheduleSnapshot(
            completeSemester: true, source: .shared, fetchedAt: fetchedAt, periods: calendar.periods,
            data: data, calendar: shown, auth: NativeScheduleAuth(authenticated: true)
        )
    }

    static func dateKey(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    // MARK: Publishing one's own timetable

    enum PublishError: LocalizedError, Equatable {
        case incomplete
        case noCalendar
        case empty

        var errorDescription: String? {
            switch self {
            case .incomplete: return "整学期课表还没有加载完，请刷新课表后再试"
            case .noCalendar: return "课表还没有校历，暂时不能分享"
            case .empty: return "这个学期没有课程，没有可以分享的内容"
            }
        }
    }

    /// The request body for publishing `snapshot`, in the shape the Web share
    /// page reads: periods are `{id, name, start, end}` there, not the native
    /// `{number, startTime, endTime}`. Only what a reader needs to draw the
    /// timetable goes out. The publisher's list of terms and the identities
    /// that tie a course to their account stay behind.
    static func publishBody(from snapshot: NativeScheduleSnapshot, ownerName: String?) throws -> [String: Any] {
        guard snapshot.completeSemester, snapshot.auth.authenticated, let data = snapshot.data,
              let semester = data.currentSemester.trimmedNonEmpty else { throw PublishError.incomplete }
        guard let calendar = snapshot.calendar, !calendar.weeks.isEmpty else { throw PublishError.noCalendar }
        let cells: [[String: Any]] = data.cells.compactMap { cell in
            let courses: [[String: Any]] = cell.courses.compactMap { course in
                guard let name = course.name.trimmedNonEmpty else { return nil }
                var item: [String: Any] = ["name": name, "weeks": course.weeks, "weekList": course.weekList]
                item["teacher"] = course.teacher
                item["location"] = course.location
                item["slotNote"] = course.slotNote
                item["startSlot"] = course.startSlot
                item["endSlot"] = course.endSlot
                item["customStartTime"] = course.customStartTime
                item["customEndTime"] = course.customEndTime
                return item
            }
            return courses.isEmpty ? nil : ["day": cell.day, "bigSlot": cell.bigSlot, "courses": courses]
        }
        guard !cells.isEmpty else { throw PublishError.empty }
        let weeks = calendar.weeks.map { ["week": $0.week, "days": $0.days, "monday": $0.monday, "sunday": $0.sunday] as [String: Any] }
        let periods = (calendar.periods.isEmpty ? snapshot.periods : calendar.periods).map {
            ["id": $0.number, "name": "第\($0.number)节", "start": $0.startTime, "end": $0.endTime] as [String: Any]
        }
        let adjustments = calendar.adjustments.map { adjustment -> [String: Any] in
            var item: [String: Any] = ["date": adjustment.date, "kind": adjustment.kind]
            item["source"] = adjustment.source
            item["note"] = adjustment.note
            return item
        }
        var body: [String: Any] = [
            "semester": semester,
            "schedule": [
                "scope": "semester",
                "semesters": [[String: Any]](),
                "weeks": calendar.weeks.map { ["value": String($0.week), "label": "第 \($0.week) 周", "current": false] as [String: Any] },
                "currentSemester": semester,
                "currentWeek": String(calendar.weeks[0].week),
                "cells": cells,
            ] as [String: Any],
            "calendar": [
                "currentSemester": semester,
                "currentWeek": calendar.weeks[0].week,
                "semesterStart": calendar.semesterStart,
                "semesterEnd": calendar.semesterEnd,
                "weeks": weeks,
                "periods": periods,
                "adjustments": adjustments,
            ] as [String: Any],
        ]
        if let ownerName = ownerName?.trimmedNonEmpty { body["ownerName"] = String(ownerName.prefix(40)) }
        return body
    }
}

/// The reader's saved shared timetables and which one they care about, as a
/// plain value so the rules can be checked without a device.
struct NativeSharedScheduleLibrary: Codable, Equatable, Sendable {
    /// The account the library was saved under. A different account signing
    /// in starts from an empty one.
    var account: String = ""
    var schedules: [NativeSharedSchedule] = []
    /// The share whose classes also drive the Live Activity. One at most.
    var caredCode: String?

    var cared: NativeSharedSchedule? {
        guard let caredCode else { return nil }
        return schedules.first { $0.meta.code == caredCode && !$0.revoked }
    }

    /// Saves a previewed share under the reader's remark. Importing a code
    /// again replaces the saved copy instead of adding a second one.
    mutating func save(_ schedule: NativeSharedSchedule, remark: String) {
        var saved = schedule
        saved.remark = remark.trimmingCharacters(in: .whitespacesAndNewlines)
        if let index = schedules.firstIndex(where: { $0.meta.code == saved.meta.code }) {
            schedules[index] = saved
        } else {
            schedules.append(saved)
        }
    }

    /// A newer download of a saved share. The remark and the caring choice stay.
    mutating func refresh(_ schedule: NativeSharedSchedule) {
        guard let index = schedules.firstIndex(where: { $0.meta.code == schedule.meta.code }) else { return }
        var saved = schedule
        saved.remark = schedules[index].remark
        schedules[index] = saved
    }

    mutating func rename(_ code: String, remark: String) {
        guard let index = schedules.firstIndex(where: { $0.meta.code == code }) else { return }
        schedules[index].remark = remark.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The publisher withdrew it: keep the copy, stop treating it as live.
    mutating func markRevoked(_ code: String) {
        guard let index = schedules.firstIndex(where: { $0.meta.code == code }) else { return }
        schedules[index].revoked = true
        if caredCode == code { caredCode = nil }
    }

    mutating func remove(_ code: String) {
        schedules.removeAll { $0.meta.code == code }
        if caredCode == code { caredCode = nil }
    }

    /// Cares about one share, or none. A withdrawn or unknown share cannot be cared about.
    mutating func care(_ code: String?) {
        guard let code else { caredCode = nil; return }
        guard schedules.contains(where: { $0.meta.code == code && !$0.revoked }) else { return }
        caredCode = code
    }

    /// Starts over when another account signs in. An empty fingerprint (signed
    /// out, or a web build that sends none) changes nothing.
    mutating func adopt(account next: String) {
        let next = next.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !next.isEmpty, next != account else { return }
        if !account.isEmpty { schedules = []; caredCode = nil }
        account = next
    }
}
