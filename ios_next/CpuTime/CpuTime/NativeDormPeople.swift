import Foundation

/// Lays a roommate's snapshot out on dates for `DormRules`. Each snapshot is
/// read by the share reader, which clamps everything a grid indexes with, and
/// laid out with its owner's own calendar and bells: days off, make-up days
/// (调休) and a course's own clock times count, so roommates at other schools
/// compare by the clock. Kept apart from the rules so those stay free of the
/// timetable types.
enum DormPeople {
    /// The members of a `/api/dorm/schedules` reply in the order of the dorm,
    /// with the colours and names of `room`. A member without a readable
    /// snapshot has no data.
    static func read(_ data: Data, room: DormRoom) -> [DormPerson] {
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        var snapshots: [Int: [String: Any]] = [:]
        for entry in json?["members"] as? [[String: Any]] ?? [] {
            guard let id = (entry["id"] as? NSNumber)?.intValue, let snapshot = entry["snapshot"] as? [String: Any] else { continue }
            snapshots[id] = snapshot
        }
        return room.members.map { member in
            let shared = snapshots[member.id].flatMap { Self.schedule(snapshot: $0, owner: member.nickname) }
            return person(id: member.id, nickname: member.nickname, color: member.color, schedule: shared)
        }
    }

    /// One `snapshot` object (`{semester, schedule, calendar}`) as a shared timetable; nil when it cannot be read.
    static func schedule(snapshot: [String: Any], owner: String) -> NativeSharedSchedule? {
        let document: [String: Any] = [
            "code": "DORM", "owner": owner,
            "semester": snapshot["semester"] as? String ?? "",
            "schedule": snapshot["schedule"] as? [String: Any] ?? [:],
            "calendar": snapshot["calendar"] as? [String: Any] ?? [:],
        ]
        guard JSONSerialization.isValidJSONObject(document),
              let data = try? JSONSerialization.data(withJSONObject: document) else { return nil }
        return try? NativeSharedSchedule.read(data, allowsEmpty: true)
    }

    static func person(id: Int, nickname: String, color: String, schedule: NativeSharedSchedule?) -> DormPerson {
        guard let schedule else { return DormPerson(id: id, nickname: nickname, color: color) }
        var days: [String: [DormCourse]] = [:]
        var weeks: [String: Int] = [:]
        for week in schedule.calendar.weeks {
            for date in week.days where weeks[date] == nil {
                days[date] = []
                weeks[date] = week.week
            }
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = NativeScheduleOccurrences.timeZone
        func minutes(_ date: Date) -> Int {
            let parts = calendar.dateComponents([.hour, .minute], from: date)
            return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        }
        for meeting in NativeScheduleOccurrences.make(schedule.snapshot()) where days[meeting.date] != nil {
            // A class running past midnight ends with the day.
            let start = minutes(meeting.start)
            let end = calendar.isDate(meeting.end, inSameDayAs: meeting.start) ? minutes(meeting.end) : 24 * 60
            days[meeting.date, default: []].append(DormCourse(
                name: meeting.course.name, start: start, end: end,
                startSlot: meeting.startSlot, endSlot: meeting.endSlot
            ))
        }
        for date in days.keys {
            days[date]?.sort { ($0.start, $0.startSlot) < ($1.start, $1.startSlot) }
        }
        let bells = schedule.calendar.periods.isEmpty ? NativeSchedulePeriod.bundledTimetable : schedule.calendar.periods
        let periods = bells.compactMap { period -> DormPeriod? in
            guard let start = DormRules.minutes(period.startTime), let end = DormRules.minutes(period.endTime) else { return nil }
            return DormPeriod(number: period.number, start: start, end: end)
        }
        .sorted { $0.number < $1.number }
        return DormPerson(id: id, nickname: nickname, color: color, hasData: true, periods: periods, days: days, weeks: weeks)
    }
}
