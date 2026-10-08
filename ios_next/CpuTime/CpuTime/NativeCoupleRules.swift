import Foundation

// The couple timetable ("情侣课表"): two bound accounts see each other's
// classes in one grid. The server keeps a snapshot of each side's term
// (`/api/couple`, see docs/couple-schedule.md). This file holds the rules
// shared with the Web (`web/src/views/schedule/couple.ts`) and Android
// (`ScheduleCouple.kt`), free of UI types so they run in a check on the Mac.

/// Whose course a tile is. `both`: the two attend the same class, drawn once.
nonisolated enum CoupleOwner: Equatable, Sendable { case mine, partner, both }

nonisolated struct CoupleMember: Equatable, Sendable {
    var nickname = ""
    /// One of `CoupleRules.colors`.
    var color = "blue"
    /// When this side's timetable last reached the server; empty when it never did.
    var syncedAt = ""
}

nonisolated enum CoupleStatus: Equatable, Sendable {
    /// Not asked yet.
    case unknown
    case none
    /// The user made an invite nobody accepted yet.
    case pending(code: String, expired: Bool)
    case active(anniversary: String, me: CoupleMember, partner: CoupleMember)

    /// Reads the `data` object of a `/api/couple` reply.
    static func read(_ data: Data) -> CoupleStatus {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return .none }
        switch json["status"] as? String {
        case "pending":
            let invite = json["invite"] as? [String: Any]
            return .pending(code: text(invite, "code"), expired: invite?["expired"] as? Bool ?? true)
        case "active":
            return .active(anniversary: text(json, "anniversary"),
                           me: member(json["me"] as? [String: Any]),
                           partner: member(json["partner"] as? [String: Any]))
        default:
            return .none
        }
    }

    private static func member(_ json: [String: Any]?) -> CoupleMember {
        CoupleMember(
            nickname: text(json, "nickname").trimmingCharacters(in: .whitespacesAndNewlines),
            color: CoupleRules.colors.contains { $0.key == text(json, "color") } ? text(json, "color") : "blue",
            syncedAt: text(json?["snapshot"] as? [String: Any], "syncedAt")
        )
    }

    private static func text(_ json: [String: Any]?, _ key: String) -> String { json?[key] as? String ?? "" }
}

/// An opaque sRGB colour in whole 0–255 channels, so it compares exactly with the Web's.
nonisolated struct CoupleRGB: Equatable, Sendable {
    let red: Int
    let green: Int
    let blue: Int

    var hex: String { String(format: "#%02X%02X%02X", red, green, blue) }
}

/// The colours of one person's tiles.
nonisolated struct CoupleTint: Equatable, Sendable {
    let fill: CoupleRGB
    let border: CoupleRGB
    let text: CoupleRGB
}

extension CoupleRGB {
    /// The small heart on a class both attend.
    static let heart = CoupleRGB(red: 0xE2, green: 0x56, blue: 0x8A)
}

nonisolated enum CoupleRules {
    /// The Web's `nameHash`: UTF-16 code units, 32-bit wrap-around.
    static func nameHash(_ name: String) -> UInt32 {
        var hash: UInt32 = 0
        for unit in name.utf16 { hash = hash &* 31 &+ UInt32(unit) }
        return hash
    }

    /// The seven colours a person can pick, with their hues. The two of a
    /// couple never share one: the server swaps them when one picks the other's.
    static let colors: [(key: String, hue: Int, label: String)] = [
        ("blue", 214, "蓝色"), ("pink", 338, "粉色"), ("purple", 268, "紫色"), ("teal", 178, "青色"),
        ("green", 138, "绿色"), ("amber", 42, "琥珀色"), ("orange", 22, "橙色"),
    ]

    /// An unknown key is blue.
    static func hue(_ color: String) -> Int { colors.first { $0.key == color }?.hue ?? 214 }

    /// One person, one colour: every course of theirs uses it, whatever its
    /// name. The Web's `couplePersonTone`.
    static func personTone(color: String, dark: Bool) -> CoupleTint {
        let hue = hue(color)
        if dark {
            return CoupleTint(fill: hsl(hue, 48, 29), border: hsl(hue, 62, 50), text: CoupleRGB(red: 0xF5, green: 0xF7, blue: 0xFF))
        }
        return CoupleTint(fill: hsl(hue, 88, 93), border: hsl(hue, 72, 77), text: hsl(hue, 58, 27))
    }

    /// The solid colour of a swatch or an avatar.
    static func swatch(_ color: String) -> CoupleRGB { hsl(hue(color), 62, 50) }

    /// CSS `hsl()` with whole-number hue, saturation and lightness.
    static func hsl(_ hue: Int, _ saturation: Int, _ lightness: Int) -> CoupleRGB {
        let h = ((hue % 360) + 360) % 360
        let s = Double(saturation) / 100
        let l = Double(lightness) / 100
        let chroma = (1 - abs(2 * l - 1)) * s
        let x = chroma * (1 - abs((Double(h) / 60).truncatingRemainder(dividingBy: 2) - 1))
        let (r, g, b): (Double, Double, Double)
        switch h / 60 {
        case 0: (r, g, b) = (chroma, x, 0)
        case 1: (r, g, b) = (x, chroma, 0)
        case 2: (r, g, b) = (0, chroma, x)
        case 3: (r, g, b) = (0, x, chroma)
        case 4: (r, g, b) = (x, 0, chroma)
        default: (r, g, b) = (chroma, 0, x)
        }
        let m = l - chroma / 2
        func channel(_ value: Double) -> Int { min(255, max(0, Int(((value + m) * 255).rounded()))) }
        return CoupleRGB(red: channel(r), green: channel(g), blue: channel(b))
    }

    // MARK: One day of both timetables

    /// What the merge needs to know about a course block.
    struct Piece: Equatable, Sendable {
        let startSlot: Int
        let endSlot: Int
        let name: String
    }

    /// How a block is drawn. `index` points into the list it came from.
    struct Placed: Equatable, Sendable {
        let index: Int
        let fromPartner: Bool
        let owner: CoupleOwner
        /// The two timetables meet here. The user's course keeps its cell and
        /// names the partner's in a line at its foot; the partner's gets no tile.
        let meets: Bool
    }

    /// Two blocks are the same class when they fill the same periods under
    /// the same name, compared without whitespace.
    static func key(_ piece: Piece) -> String {
        "\(piece.startSlot)|\(piece.endSlot)|\(piece.name.components(separatedBy: .whitespacesAndNewlines).joined())"
    }

    /// One day of both timetables for the week view. The user's courses keep
    /// their place. A class both attend is the user's tile, marked. A course
    /// of the partner's that meets none of the user's takes the whole cell;
    /// one that does is named at the foot of the user's course.
    static func merge(mine: [Piece], theirs: [Piece]) -> [Placed] {
        let keys = Set(mine.map(key))
        let shared = Set(theirs.map(key).filter(keys.contains))
        let partner = theirs.enumerated().filter { !keys.contains(key($0.element)) }
        func overlap(_ a: Piece, _ b: Piece) -> Bool { a.startSlot <= b.endSlot && b.startSlot <= a.endSlot }
        let own = mine.enumerated().map { index, piece in
            Placed(index: index, fromPartner: false, owner: shared.contains(key(piece)) ? .both : .mine,
                   meets: partner.contains { overlap($0.element, piece) })
        }
        let other = partner.map { index, piece in
            Placed(index: index, fromPartner: true, owner: .partner, meets: mine.contains { overlap($0, piece) })
        }
        return own + other
    }

    /// The keys of the classes both attend, for the day view's two columns.
    static func sharedKeys(mine: [Piece], theirs: [Piece]) -> Set<String> {
        Set(mine.map(key)).intersection(theirs.map(key))
    }

    // MARK: Status line

    /// Day 1 is the anniversary itself. Nil without one, or when it is not in the past.
    static func daysTogether(_ anniversary: String, today: String) -> Int? {
        guard let start = epochDay(anniversary), let end = epochDay(today), end >= start else { return nil }
        return end - start + 1
    }

    private static func epochDay(_ date: String) -> Int? {
        let pieces = date.split(separator: "-", omittingEmptySubsequences: false)
        guard date.count == 10, pieces.count == 3, pieces[0].count == 4, pieces[1].count == 2, pieces[2].count == 2,
              let year = Int(pieces[0]), let month = Int(pieces[1]), let day = Int(pieces[2]) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        guard let value = calendar.date(from: DateComponents(year: year, month: month, day: day)) else { return nil }
        // A date the calendar had to roll over (02-30) is not a date.
        let back = calendar.dateComponents([.year, .month, .day], from: value)
        guard back.year == year, back.month == month, back.day == day else { return nil }
        return Int((value.timeIntervalSince1970 / 86_400).rounded(.down))
    }

    /// A course of one day with its clock times, for "what is TA doing now".
    struct TimedCourse: Equatable, Sendable {
        let name: String
        let start: String
        let end: String
    }

    static func clockMinutes(_ value: String) -> Int? {
        let pieces = value.split(separator: ":")
        guard pieces.count >= 2, let hour = Int(pieces[0]), let minute = Int(pieces[1].prefix(2)) else { return nil }
        return hour * 60 + minute
    }

    /// What the partner is doing at `minutes` past midnight. `courses` is nil
    /// when today is outside the partner's term.
    static func nowText(name: String, hasData: Bool, courses: [TimedCourse]?, minutes: Int, short: Bool = true) -> String {
        let who = name.isEmpty ? "TA" : name
        guard hasData else { return "\(who) 还没有同步课表" }
        guard let courses else { return "\(who) 今天不在学期内" }
        if courses.isEmpty { return "\(who) 今天没有课" }
        func clock(_ value: String) -> Int { clockMinutes(value) ?? -1 }
        let ordered = courses.sorted { clock($0.start) < clock($1.start) }
        if let current = ordered.first(where: { clock($0.start) <= minutes && minutes < clock($0.end) }) {
            return short ? "\(who) 在上《\(current.name)》· \(current.end) 下课" : "在上《\(current.name)》，\(current.end) 下课"
        }
        if let next = ordered.first(where: { clock($0.start) > minutes }) {
            return short ? "\(who) 下一节《\(next.name)》· \(next.start)" : "下一节《\(next.name)》\(next.start) 开始"
        }
        return "\(who) 今天的课都上完了"
    }

    /// "3 小时前" for a server timestamp; empty when it cannot be read.
    static func relative(_ iso: String, now: Date) -> String {
        guard let time = parseISO(iso) else { return "" }
        let elapsed = now.timeIntervalSince(time)
        switch elapsed {
        case ..<60: return "刚刚"
        case ..<3_600: return "\(Int(elapsed / 60)) 分钟前"
        case ..<86_400: return "\(Int(elapsed / 3_600)) 小时前"
        case ..<(30 * 86_400): return "\(Int(elapsed / 86_400)) 天前"
        default:
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "zh_CN")
            formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
            formatter.dateFormat = "M 月 d 日"
            return formatter.string(from: time)
        }
    }

    static func parseISO(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    /// A cheap fingerprint of an upload, to skip sending the same timetable again.
    static func fingerprint(_ text: String) -> String {
        var hash: UInt32 = 0x811C_9DC5
        for unit in text.utf16 { hash = (hash ^ UInt32(unit)) &* 0x0100_0193 }
        return String(text.utf16.count, radix: 36) + "-" + String(hash, radix: 36)
    }

    /// What the invite sheet sends: the code, where to type it, and the link
    /// that opens the Web page with it filled in.
    static func invitation(code: String, origin: String) -> String {
        var origin = origin
        while origin.hasSuffix("/") { origin.removeLast() }
        return "我们来绑定情侣课表吧！邀请码 \(code)（24 小时内有效）。在药大拾间「课表 → 更多 → 情侣课表」里输入，"
            + "或者打开 \(origin)/schedule?couple=1&code=\(code) 就能绑定。"
    }
}
