import Foundation

/// How a classroom is written in the timetable.
nonisolated enum ScheduleClassroom {
    /// Theory classes are all in the teaching building and the room number
    /// names the block itself (A–E), so 「教学楼A102」 is shown as 「A102」.
    /// Anything else (实验楼, 教学楼报告厅, a block that is not A–E) stays as it
    /// is. Display only: hidden and edited courses are matched by the
    /// location the data carries, so the data keeps it.
    static func only(_ value: String) -> String {
        let location = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let range = location.range(of: #"^教学楼\s*(?=[A-Ea-e]\s*[-－]?\s*\d)"#, options: .regularExpression) else {
            return location
        }
        let room = String(location[range.upperBound...])
        return room.isEmpty ? location : room
    }
}

/// Two different courses of the user's own in the same period. That is
/// usually wrong data from the academic system (a dropped course still
/// listed, the old row left behind after a change), so the first time it is
/// seen the user is told to check there before editing or deleting here.
nonisolated struct ScheduleOverlapNotice: Equatable, Sendable {
    /// What the search needs to know about a block as the week view draws it.
    struct Piece: Equatable, Sendable {
        /// 1 is Monday, 7 is Sunday.
        let day: Int
        let startSlot: Int
        let endSlot: Int
        let lane: Int
        let name: String
    }

    let day: Int
    let startSlot: Int
    let endSlot: Int
    /// The courses that meet, by starting period, each once.
    let names: [String]

    static let title = "同一时间排了两门课"
    static let storageKey = "cpu.schedule.overlapNotice.v1"
    static let maxRemembered = 40
    private static let weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

    /// The first place of the week where courses are drawn side by side.
    /// `pieces` are the blocks as placed: one that a course marked "show
    /// first" covers is not among them, since the user dealt with that one.
    static func find(_ pieces: [Piece]) -> ScheduleOverlapNotice? {
        func meets(_ a: Piece, _ b: Piece) -> Bool { a.day == b.day && a.startSlot <= b.endSlot && b.startSlot <= a.endSlot }
        let side = pieces.enumerated()
            .filter { index, piece in pieces.enumerated().contains { $0.offset != index && meets($0.element, piece) } }
            .map(\.element)
            .sorted { ($0.day, $0.startSlot, $0.lane) < ($1.day, $1.startSlot, $1.lane) }
        guard let first = side.first else { return nil }
        // The courses of that day that meet the first one, directly or through another.
        var cluster = [first]
        var end = first.endSlot
        for piece in side.dropFirst() where piece.day == first.day && piece.startSlot <= end {
            cluster.append(piece)
            end = max(end, piece.endSlot)
        }
        var names: [String] = []
        for piece in cluster where !names.contains(piece.name) { names.append(piece.name) }
        guard names.count >= 2 else { return nil }
        return ScheduleOverlapNotice(day: first.day, startSlot: first.startSlot, endSlot: end, names: names)
    }

    /// One place is pointed out once: the same term, weekday and courses.
    func key(semester: String) -> String {
        "\(semester)|\(day)|\(names.sorted().joined(separator: "/"))"
    }

    var text: String {
        let slots = startSlot == endSlot ? "第 \(startSlot) 节" : "第 \(startSlot)–\(endSlot) 节"
        let listed = names.prefix(3).map { "「\($0)」" }.joined(separator: "、") + (names.count > 3 ? " 等" : "")
        let weekday = Self.weekdays.indices.contains(day - 1) ? Self.weekdays[day - 1] : ""
        return "\(weekday)\(slots)同时排了 \(listed)。这通常是教务系统的数据有误，建议先到教务系统核对原始课表；"
            + "确认哪一门不该在这里以后，点这门课就可以编辑或删除。"
    }

    static func seen(_ key: String, defaults: UserDefaults = .standard) -> Bool {
        (defaults.stringArray(forKey: storageKey) ?? []).contains(key)
    }

    static func remember(_ key: String, defaults: UserDefaults = .standard) {
        let seen = (defaults.stringArray(forKey: storageKey) ?? []).filter { $0 != key }
        defaults.set(Array((seen + [key]).suffix(maxRemembered)), forKey: storageKey)
    }
}
