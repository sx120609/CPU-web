import Foundation

// The dorm timetable ("宿舍课表", docs/dorm-schedule.md): up to eight
// roommates, when they are all free, and who has an 8 a.m. class. The server
// keeps one timetable snapshot per member (`/api/dorm`). This file holds the
// free-time maths of the Web (`web/src/views/schedule/dorm.ts` and
// `dormWeek.ts`) and Android (`DormRules`), free of UI and timetable types so
// `ios_next/scripts/check-dorm-schedule.sh` runs it with plain `swiftc`.

// MARK: The dorm as the server reports it

nonisolated struct DormMember: Equatable, Identifiable, Sendable {
    var id: Int
    var nickname: String
    /// One of `DormRules.colors`.
    var color: String
    var isOwner: Bool
    /// When this member's timetable last reached the server; empty when it never did.
    var syncedAt: String = ""
    /// The term of that timetable; empty without one.
    var semester: String = ""

    var hasSnapshot: Bool { !syncedAt.isEmpty }
}

nonisolated struct DormInvite: Equatable, Sendable {
    var code: String
    var expiresAt: String
    var expired: Bool
}

nonisolated struct DormRoom: Equatable, Sendable {
    var id: Int
    var name: String
    var memberLimit: Int
    var isOwner: Bool
    var since: String = ""
    /// Only the owner gets the code.
    var invite: DormInvite?
    var me: DormMember
    var members: [DormMember]

    var isFull: Bool { members.count >= memberLimit }
    /// The code still works: a roommate can join with it.
    var liveInvite: DormInvite? { invite.flatMap { !$0.code.isEmpty && !$0.expired ? $0 : nil } }

    func member(_ id: Int) -> DormMember? { members.first { $0.id == id } }
}

nonisolated enum DormStatus: Equatable, Sendable {
    /// Not asked yet.
    case unknown
    case none
    case active(DormRoom)

    var room: DormRoom? { if case .active(let room) = self { return room } else { return nil } }

    /// Reads the `data` object of a `/api/dorm` reply.
    static func read(_ data: Data) -> DormStatus {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return .none }
        return read(json)
    }

    static func read(_ json: [String: Any]) -> DormStatus {
        guard json["status"] as? String == "active", let me = member(json["me"] as? [String: Any]) else { return .none }
        let members = (json["members"] as? [[String: Any]] ?? []).compactMap(member)
        var invite: DormInvite?
        if let value = json["invite"] as? [String: Any], !text(value, "code").isEmpty {
            invite = DormInvite(code: text(value, "code"), expiresAt: text(value, "expiresAt"),
                                expired: value["expired"] as? Bool ?? true)
        }
        let limit = (json["memberLimit"] as? NSNumber)?.intValue ?? 6
        return .active(DormRoom(
            id: (json["id"] as? NSNumber)?.intValue ?? 0,
            name: text(json, "name").trimmingCharacters(in: .whitespacesAndNewlines),
            memberLimit: min(max(limit, 1), DormRules.memberMaximum),
            isOwner: json["isOwner"] as? Bool ?? false,
            since: text(json, "since"),
            invite: invite,
            me: me,
            members: members.isEmpty ? [me] : members
        ))
    }

    private static func member(_ json: [String: Any]?) -> DormMember? {
        guard let json, let id = (json["id"] as? NSNumber)?.intValue, id > 0 else { return nil }
        let snapshot = json["snapshot"] as? [String: Any]
        return DormMember(
            id: id,
            nickname: text(json, "nickname").trimmingCharacters(in: .whitespacesAndNewlines),
            color: DormRules.color(text(json, "color")),
            isOwner: json["isOwner"] as? Bool ?? false,
            syncedAt: text(snapshot, "syncedAt"),
            semester: text(snapshot, "semester")
        )
    }

    static func text(_ json: [String: Any]?, _ key: String) -> String { json?[key] as? String ?? "" }
}

// MARK: Timetables for the maths

/// Minutes since midnight.
nonisolated struct DormSpan: Equatable, Sendable {
    var start: Int
    var end: Int
    var minutes: Int { end - start }
}

/// One period of a bell schedule, in minutes since midnight.
nonisolated struct DormPeriod: Equatable, Sendable {
    let number: Int
    let start: Int
    let end: Int
}

/// A class on one day, in minutes since midnight, with the periods it fills.
nonisolated struct DormCourse: Equatable, Sendable {
    let name: String
    let start: Int
    let end: Int
    let startSlot: Int
    let endSlot: Int
}

/// One roommate's timetable laid out on dates. A date missing from `days` is
/// one the member has no data for (never synced, or outside their term): that
/// day they count neither as free nor as busy.
nonisolated struct DormPerson: Equatable, Identifiable, Sendable {
    let id: Int
    var nickname: String
    var color: String
    /// A snapshot of theirs could be read.
    let hasData: Bool
    /// Their own bells; empty without data.
    let periods: [DormPeriod]
    /// Every date of their term with its classes in order of start (empty on a day without any).
    let days: [String: [DormCourse]]
    /// The teaching week of every date of their term.
    let weeks: [String: Int]

    init(id: Int, nickname: String, color: String, hasData: Bool = false, periods: [DormPeriod] = [],
         days: [String: [DormCourse]] = [:], weeks: [String: Int] = [:]) {
        self.id = id
        self.nickname = nickname
        self.color = color
        self.hasData = hasData
        self.periods = periods
        self.days = days
        self.weeks = weeks
    }

    func courses(on date: String) -> [DormCourse]? { days[date] }
}

nonisolated struct DormFreeWindow: Equatable, Sendable {
    var start: Int
    var end: Int
    /// The roommates surely free all through it.
    var freeIds: [Int]
    var minutes: Int { end - start }
}

nonisolated struct DormDayAvailability: Equatable, Sendable {
    let date: String
    let weekday: Int
    let window: DormSpan
    /// Roommates with data that day, who can be told free or busy.
    let knownIds: [Int]
    /// Roommates without data that day.
    let unknownIds: [Int]
    /// How many have to be free at once; by default everyone with data.
    let requiredFree: Int
    /// More people are required free than have data that day.
    let insufficientData: Bool
    /// The blocks with at least `requiredFree` free.
    let windows: [DormFreeWindow]
    /// The blocks with everyone with data free.
    let allFreeWindows: [DormFreeWindow]
}

nonisolated struct DormDuty: Equatable, Sendable {
    let id: Int
    let course: String
    let start: Int
    let end: Int
}

nonisolated struct DormMorningDay: Equatable, Sendable {
    let date: String
    let weekday: Int
    let duties: [DormDuty]
    /// Roommates with data that day.
    let knownCount: Int
    /// Roommates without data that day: the list may be incomplete.
    let unknownCount: Int
}

nonisolated struct DormWeekBusy: Equatable, Sendable {
    let id: Int
    /// The classes of that period; two when two are on at once.
    let courses: [String]
}

nonisolated enum DormWeekLevel: Equatable, Sendable { case unknown, none, some, all }

nonisolated struct DormWeekCell: Equatable, Sendable {
    let date: String
    let period: DormPeriod
    let freeIds: [Int]
    let busy: [DormWeekBusy]
    /// Roommates without data that day, neither free nor busy.
    let unknownIds: [Int]

    var known: Int { freeIds.count + busy.count }

    var level: DormWeekLevel {
        if known == 0 { return .unknown }
        if freeIds.count == known { return .all }
        return freeIds.isEmpty ? .none : .some
    }

    /// The free share of the people with data; 0 without data.
    var freeRatio: Double { known == 0 ? 0 : Double(freeIds.count) / Double(known) }
}

nonisolated struct DormWeekRow: Equatable, Sendable {
    let period: DormPeriod
    /// A break of half an hour or more (lunch, supper) comes before it.
    let breakBefore: Bool
    let cells: [DormWeekCell]
}

nonisolated struct DormWeekGrid: Equatable, Sendable {
    let monday: String
    let dates: [String]
    /// Nil when the week is outside every term.
    let teachingWeek: Int?
    let rows: [DormWeekRow]
}

/// The person tones, as the Web's `dormPersonTone`. `name` reads on the page
/// background; `border` is for outlines and dots only.
nonisolated struct DormTone: Equatable, Sendable {
    let fill: CoupleRGB
    let border: CoupleRGB
    let text: CoupleRGB
    let name: CoupleRGB
}

nonisolated enum DormRules {
    static let memberMaximum = 8
    static let minimumWindow = 20
    static let codeLength = 6
    private static let breakMinutes = 30
    /// The day without anybody's bells: 08:00 to 21:40.
    static let defaultWindow = DormSpan(start: 8 * 60, end: 21 * 60 + 40)
    static let weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

    /// The Web's `smallSlots`, for a timetable without its own bells.
    static let defaultPeriods: [DormPeriod] = [
        ("08:00", "08:45"), ("08:55", "09:40"), ("09:55", "10:40"), ("10:50", "11:35"),
        ("13:30", "14:15"), ("14:25", "15:10"), ("15:25", "16:10"), ("16:20", "17:05"),
        ("18:30", "19:15"), ("19:25", "20:10"), ("20:20", "21:05"), ("21:15", "22:00"),
    ].enumerated().map { DormPeriod(number: $0.offset + 1, start: minutes($0.element.0) ?? 0, end: minutes($0.element.1) ?? 0) }

    // MARK: Colours

    /// Eight colours, one per member at most, the same as the server's DORM_COLORS.
    static let colors: [(key: String, hue: Int, label: String)] = [
        ("blue", 214, "蓝"), ("pink", 338, "粉"), ("purple", 268, "紫"), ("teal", 178, "青"),
        ("green", 138, "绿"), ("amber", 42, "黄"), ("orange", 22, "橙"), ("red", 358, "红"),
    ]

    static func color(_ value: String) -> String { colors.contains { $0.key == value } ? value : "blue" }

    static func hue(_ color: String) -> Int { colors.first { $0.key == color }?.hue ?? 214 }

    static func tone(color: String, dark: Bool) -> DormTone {
        let hue = hue(color)
        if dark {
            return DormTone(fill: CoupleRules.hsl(hue, 48, 29), border: CoupleRules.hsl(hue, 62, 50),
                            text: CoupleRGB(red: 0xF5, green: 0xF7, blue: 0xFF), name: CoupleRules.hsl(hue, 75, 74))
        }
        return DormTone(fill: CoupleRules.hsl(hue, 88, 93), border: CoupleRules.hsl(hue, 72, 77),
                        text: CoupleRules.hsl(hue, 58, 27), name: CoupleRules.hsl(hue, 62, 30))
    }

    /// The solid colour of a swatch, an avatar or a dot.
    static func swatch(_ color: String) -> CoupleRGB { CoupleRules.hsl(hue(color), 62, 50) }

    // MARK: Codes and links

    /// A dorm code as typed or linked: no spaces, upper case; empty when it cannot be one.
    static func inviteCode(_ value: String) -> String {
        let code = value.filter { !$0.isWhitespace }.uppercased()
        let allowed = code.count >= 4 && code.count <= 12
            && code.unicodeScalars.allSatisfy { ("A"..."Z").contains($0) || ("0"..."9").contains($0) }
        return allowed ? code : ""
    }

    /// What the join field keeps of what was typed or pasted: letters and digits, upper case.
    static func typedCode(_ value: String) -> String {
        String(value.uppercased().filter { ("A"..."Z").contains($0) || ("0"..."9").contains($0) }.prefix(8))
    }

    /// The dorm code of an in-app link to the dorm: the invite link
    /// `/schedule?dorm=1&code=…` or the page the Web shells use,
    /// `/dorm-schedule?code=…`. Empty for a link without a usable code; nil
    /// for any other path.
    static func linkCode(_ path: String) -> String? {
        guard let components = URLComponents(string: "https://local" + path) else { return nil }
        let items = components.queryItems ?? []
        switch components.path {
        case "/schedule":
            guard items.first(where: { $0.name == "dorm" })?.value == "1" else { return nil }
        case "/dorm-schedule", "/dorm-schedule/":
            break
        default:
            return nil
        }
        return inviteCode(items.first(where: { $0.name == "code" })?.value ?? "")
    }

    /// What the invite sends: the code, where to type it, and the link that opens it.
    static func invitation(code: String, origin: String) -> String {
        var origin = origin
        while origin.hasSuffix("/") { origin.removeLast() }
        return "来加入我们的宿舍课表吧！宿舍码 \(code)（24 小时内有效）。在药大拾间「课表 → 更多 → 宿舍课表」里输入，"
            + "或者打开 \(origin)/schedule?dorm=1&code=\(code) 就能加入。"
    }

    // MARK: Uploading the user's own timetable

    /// Whether `semester` is the term running now by the timetable's own list
    /// of terms. Without a list it is taken as current, as the couple upload does
    /// on Android and HarmonyOS. A past term must never replace this one on the server.
    static func isCurrentTerm(_ semester: String, terms: [(value: String, current: Bool)]) -> Bool {
        guard !semester.isEmpty else { return false }
        guard let current = terms.first(where: { $0.current })?.value, !current.isEmpty else { return true }
        return current == semester
    }

    /// The same content goes up again only after this long, to keep its "synced" time fresh.
    static let unchangedResync: TimeInterval = 12 * 60 * 60
    /// The whole term is fetched from 教务 for the upload at most this often, unless asked.
    static let termFetchPause: TimeInterval = 6 * 60 * 60

    /// Uploads are kept apart by account, dorm and term.
    static func uploadScope(account: String, dorm: Int, semester: String) -> String { "\(account)|\(dorm)|\(semester)" }

    /// Whether an upload can be skipped: `last` ("scope|print@time") sent the
    /// same content for the same scope less than twelve hours ago, and the
    /// server still has a timetable of that term. Without one there, a local
    /// record never stops the upload.
    static func skipsUpload(last: String?, scope: String, print: String, now: TimeInterval, serverSemester: String, semester: String) -> Bool {
        guard serverSemester == semester, let last, let at = last.lastIndex(of: "@"),
              let sent = TimeInterval(last[last.index(after: at)...]) else { return false }
        return String(last[..<at]) == scope + "|" + print && (0..<unchangedResync).contains(now - sent)
    }

    /// Whether the whole term may be fetched for an upload nobody asked for:
    /// `last` ("scope@time") is when it was last fetched for the same scope.
    static func mayFetchTerm(last: String?, scope: String, now: TimeInterval) -> Bool {
        guard let last, let at = last.lastIndex(of: "@"), String(last[..<at]) == scope,
              let fetched = TimeInterval(last[last.index(after: at)...]) else { return true }
        return !(0..<termFetchPause).contains(now - fetched)
    }

    // MARK: Free time

    static func minutes(_ value: String) -> Int? {
        let parts = value.split(separator: ":")
        guard parts.count >= 2, let hour = Int(parts[0].trimmingCharacters(in: .whitespaces)),
              let minute = Int(parts[1].prefix(2)), (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        return hour * 60 + minute
    }

    /// The dorm's day: earliest start to latest end of everyone's periods, to
    /// five minutes; 08:00–21:40 without anybody's.
    static func dayWindow(_ people: [DormPerson]) -> DormSpan {
        var start = Int.max, end = Int.min
        for person in people {
            for period in person.periods where period.end > period.start {
                start = min(start, period.start)
                end = max(end, period.end)
            }
        }
        guard start != Int.max, end > start else { return defaultWindow }
        return DormSpan(start: start / 5 * 5, end: (end + 4) / 5 * 5)
    }

    /// A roommate's classes on `date` as minute ranges; nil without data that day.
    static func busySpans(_ person: DormPerson, date: String) -> [DormSpan]? {
        person.courses(on: date)?
            .filter { $0.end > $0.start }
            .map { DormSpan(start: $0.start, end: $0.end) }
            .sorted { ($0.start, $0.end) < ($1.start, $1.end) }
    }

    /// When people are free on `date`. The day is cut at every class start and
    /// end, each piece lists who has no class, and neighbouring pieces with
    /// the same people join, so a block is one stretch of time, not periods.
    /// `minFree` nil asks for everyone with data. People without data that day
    /// count neither as free nor as busy; they are only listed.
    static func availability(_ people: [DormPerson], date: String, minFree: Int? = nil,
                             minMinutes: Int = minimumWindow, window span: DormSpan? = nil) -> DormDayAvailability {
        let window = span ?? dayWindow(people)
        var knownIds: [Int] = [], unknownIds: [Int] = []
        var busy: [Int: [DormSpan]] = [:]
        for person in people {
            guard let spans = busySpans(person, date: date) else {
                unknownIds.append(person.id)
                continue
            }
            knownIds.append(person.id)
            busy[person.id] = spans
                .map { DormSpan(start: max($0.start, window.start), end: min($0.end, window.end)) }
                .filter { $0.end > $0.start }
        }

        var points: Set<Int> = [window.start, window.end]
        for spans in busy.values {
            for span in spans {
                points.insert(span.start)
                points.insert(span.end)
            }
        }
        let sorted = points.sorted()
        var segments: [DormFreeWindow] = []
        for index in sorted.indices.dropLast() {
            let start = sorted[index], end = sorted[index + 1]
            guard end > start else { continue }
            let free = knownIds.filter { id in !(busy[id] ?? []).contains { $0.start < end && $0.end > start } }
            if let last = segments.last, last.end == start, last.freeIds == free {
                segments[segments.count - 1].end = end
            } else {
                segments.append(DormFreeWindow(start: start, end: end, freeIds: free))
            }
        }

        let shortest = max(0, minMinutes)
        // An explicit number is never lowered to the people with data: "至少 3 人" cannot be told from two timetables.
        let required = max(1, minFree ?? knownIds.count)
        let insufficient = required > knownIds.count
        let relaxed = insufficient ? [] : absorbShort(segments, required: required, minMinutes: shortest)
            .filter { $0.minutes >= shortest && $0.freeIds.count >= required }
        let everyone = segments.filter { $0.minutes >= shortest && !knownIds.isEmpty && $0.freeIds.count == knownIds.count }
        return DormDayAvailability(
            date: date, weekday: weekday(date), window: window, knownIds: knownIds, unknownIds: unknownIds,
            requiredFree: required, insufficientData: insufficient, windows: relaxed, allFreeWindows: everyone
        )
    }

    /// With fewer than everyone required, a piece shorter than `minMinutes`
    /// joins a neighbour whose people were all free through it too, so the
    /// joined block is still one set of people: {A,B} and {B,C} never become
    /// "2 人有空". Of two such neighbours the one with more people wins, the
    /// earlier one on a tie. With everyone required this changes nothing.
    private static func absorbShort(_ segments: [DormFreeWindow], required: Int, minMinutes: Int) -> [DormFreeWindow] {
        var list = segments
        var changed = true
        while changed {
            changed = false
            for index in list.indices {
                let short = list[index]
                guard short.minutes < minMinutes else { continue }
                let candidates = [index - 1, index + 1].filter { at in
                    guard list.indices.contains(at) else { return false }
                    let neighbour = list[at]
                    return neighbour.freeIds.count >= required
                        && (neighbour.end == short.start || neighbour.start == short.end)
                        && neighbour.freeIds.allSatisfy(short.freeIds.contains)
                }
                guard let first = candidates.first else { continue }
                let target = candidates.dropFirst().reduce(first) { list[$1].freeIds.count > list[$0].freeIds.count ? $1 : $0 }
                list[target].start = min(list[target].start, short.start)
                list[target].end = max(list[target].end, short.end)
                list.remove(at: index)
                // Both sides may now be the same people next to each other: join them.
                var at = list.count - 1
                while at > 0 {
                    if list[at - 1].end == list[at].start, list[at - 1].freeIds == list[at].freeIds {
                        list[at - 1].end = list[at].end
                        list.remove(at: at)
                    }
                    at -= 1
                }
                changed = true
                break
            }
        }
        return list
    }

    /// What a free block says: with someone missing data only "已同步的人都有空", never the whole dorm.
    static func windowLabel(_ window: DormFreeWindow, day: DormDayAvailability) -> String {
        let count = window.freeIds.count
        if count < day.knownIds.count { return "\(count) 人有空" }
        if !day.unknownIds.isEmpty { return "已同步的 \(count) 人都有空" }
        return count > 1 ? "全宿舍都有空" : "有空"
    }

    /// A day without a block, telling missing data apart from a genuinely full day.
    static func freeEmptyText(_ day: DormDayAvailability, explicitMinFree: Bool) -> String {
        if day.knownIds.isEmpty { return "这天大家都没有可用课表，没法判断谁有空。" }
        if day.insufficientData {
            return "要 \(day.requiredFree) 人同时有空，但这天只有 \(day.knownIds.count) 人有课表数据，没法判断。可以放宽条件，或等室友同步课表。"
        }
        let scope = day.unknownIds.isEmpty ? "这天" : "已同步的 \(day.knownIds.count) 人里"
        let requirement = explicitMinFree && day.requiredFree < day.knownIds.count
            ? "\(day.requiredFree) 人同时有空"
            : (day.unknownIds.isEmpty ? "全宿舍同时有空" : "大家同时有空")
        return "\(scope)没有\(requirement)的时段。可以把条件放宽一点再看。"
    }

    /// The choices of 「需要几个人有空」: nil for everyone with data, then
    /// "at least N" from one fewer than the dorm down to two.
    static func minFreeChoices(memberCount: Int) -> [Int?] {
        [nil] + Array(stride(from: memberCount - 1, through: 2, by: -1)).map { Optional($0) }
    }

    // MARK: Early classes

    /// Who has an 8 a.m. class on `date`: a class in period 1, the couple
    /// timetable's rule, so a class moved to 07:40 in period 3 is not one.
    static func duties(_ people: [DormPerson], date: String) -> [DormDuty] {
        people.compactMap { person -> DormDuty? in
            guard let first = person.courses(on: date)?.first(where: { $0.startSlot == 1 }) else { return nil }
            return DormDuty(id: person.id, course: first.name, start: first.start, end: first.end)
        }
        .sorted { ($0.start, $0.id) < ($1.start, $1.id) }
    }

    static func morningDays(_ people: [DormPerson], dates: [String]) -> [DormMorningDay] {
        dates.map { date in
            let unknown = people.filter { $0.courses(on: date) == nil }.count
            return DormMorningDay(date: date, weekday: weekday(date), duties: duties(people, date: date),
                                  knownCount: people.count - unknown, unknownCount: unknown)
        }
    }

    /// The next people to get up early; today counts while their class has not begun.
    static func nextMorning(_ days: [DormMorningDay], today: String, minute: Int) -> (day: DormMorningDay, isToday: Bool)? {
        for day in days where !day.duties.isEmpty {
            if day.date == today {
                let pending = day.duties.filter { $0.start > minute }
                guard !pending.isEmpty else { continue }
                return (DormMorningDay(date: day.date, weekday: day.weekday, duties: pending,
                                       knownCount: day.knownCount, unknownCount: day.unknownCount), true)
            }
            return (day, false)
        }
        return nil
    }

    static func morningNoneText(_ day: DormMorningDay) -> String {
        if day.knownCount == 0 { return "没有数据" }
        return day.unknownCount > 0 ? "已同步的人没有早八" : "没人早八"
    }

    /// The summary when nobody has an early class coming; never "放心熬" while a list may be incomplete.
    static func morningSummaryText(_ days: [DormMorningDay]) -> String {
        if days.isEmpty || days.allSatisfy({ $0.knownCount == 0 }) { return "未来 \(days.count) 天大家都没有可用课表，看不出谁有早八。" }
        if days.contains(where: { $0.unknownCount > 0 }) { return "已同步课表的室友未来 \(days.count) 天都没有早八；还有人没同步，名单可能不全。" }
        return "未来 \(days.count) 天都没有早八，晚上可以放心熬。"
    }

    // MARK: The week

    /// The grid's periods: the user's own, else the first member with a
    /// timetable, else the default twelve. Who is busy is told by the clock,
    /// so a roommate's other bells still count right.
    static func weekPeriods(_ people: [DormPerson], preferredId: Int? = nil) -> [DormPeriod] {
        let source = people.first { $0.id == preferredId && $0.hasData } ?? people.first { $0.hasData }
        return (source?.periods ?? defaultPeriods).filter { $0.end > $0.start }
    }

    /// One row per period, one column per day: who is free, who is in which class, who has no data.
    static func weekGrid(_ people: [DormPerson], monday: String, preferredId: Int? = nil) -> DormWeekGrid {
        let dates = (0..<7).map { addDays(monday, $0) }
        let periods = weekPeriods(people, preferredId: preferredId)
        let rows = periods.enumerated().map { index, period -> DormWeekRow in
            let breakBefore = index > 0 && period.start - periods[index - 1].end >= breakMinutes
            let cells = dates.map { date -> DormWeekCell in
                var free: [Int] = [], busy: [DormWeekBusy] = [], unknown: [Int] = []
                for person in people {
                    guard let courses = person.courses(on: date) else {
                        unknown.append(person.id)
                        continue
                    }
                    var names: [String] = []
                    for course in courses where overlaps(course, period) && !names.contains(course.name) {
                        names.append(course.name)
                    }
                    if names.isEmpty { free.append(person.id) } else { busy.append(DormWeekBusy(id: person.id, courses: names)) }
                }
                return DormWeekCell(date: date, period: period, freeIds: free, busy: busy, unknownIds: unknown)
            }
            return DormWeekRow(period: period, breakBefore: breakBefore, cells: cells)
        }
        let preferred = people.first { $0.id == preferredId && $0.hasData }
        var teachingWeek: Int?
        for person in (preferred.map { [$0] } ?? []) + people where person.hasData {
            teachingWeek = dates.lazy.compactMap { person.weeks[$0] }.first
            if teachingWeek != nil { break }
        }
        return DormWeekGrid(monday: monday, dates: dates, teachingWeek: teachingWeek, rows: rows)
    }

    /// By the clock; a class without usable times falls back to its period numbers.
    private static func overlaps(_ course: DormCourse, _ period: DormPeriod) -> Bool {
        if course.end > course.start { return course.start < period.end && course.end > period.start }
        return course.startSlot <= period.number && course.endSlot >= period.number
    }

    /// What a cell says: with someone missing data only "已同步的人都有空", never the whole dorm.
    static func cellSummary(_ cell: DormWeekCell) -> String {
        switch cell.level {
        case .unknown: return "没有课表数据"
        case .none: return cell.known > 1 ? "都在上课" : "在上课"
        case .some: return "\(cell.freeIds.count) 人有空"
        case .all:
            if !cell.unknownIds.isEmpty { return "已同步的 \(cell.known) 人都有空" }
            return cell.known > 1 ? "全宿舍都有空" : "有空"
        }
    }

    // MARK: Dates and clocks

    static func clock(_ minutes: Int) -> String {
        let value = max(0, minutes)
        return String(format: "%02d:%02d", value / 60, value % 60)
    }

    static func spanText(_ start: Int, _ end: Int) -> String { "\(clock(start))–\(clock(end))" }

    /// "1 小时 45 分".
    static func durationText(_ minutes: Int) -> String {
        let hours = minutes / 60, rest = minutes % 60
        if hours == 0 { return "\(rest) 分钟" }
        return rest == 0 ? "\(hours) 小时" : "\(hours) 小时 \(rest) 分"
    }

    private static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        return calendar
    }

    private static func parse(_ date: String) -> Date? {
        let parts = date.split(separator: "-", omittingEmptySubsequences: false)
        guard date.count == 10, parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
              let value = utc.date(from: DateComponents(year: year, month: month, day: day)),
              utc.dateComponents([.month, .day], from: value) == DateComponents(month: month, day: day) else { return nil }
        return value
    }

    private static func format(_ date: Date) -> String {
        let parts = utc.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// "yyyy-MM-dd" plus some days; the date as it was when it cannot be read.
    static func addDays(_ date: String, _ days: Int) -> String {
        guard let value = parse(date), let next = utc.date(byAdding: .day, value: days, to: value) else { return date }
        return format(next)
    }

    static func dateRange(_ from: String, count: Int) -> [String] { (0..<max(0, count)).map { addDays(from, $0) } }

    /// 1 (Monday) to 7; 0 when the date cannot be read.
    static func weekday(_ date: String) -> Int {
        guard let value = parse(date) else { return 0 }
        return (utc.component(.weekday, from: value) + 5) % 7 + 1
    }

    static func monday(_ date: String) -> String { addDays(date, 1 - max(1, weekday(date))) }

    /// "今天", "明天" or the weekday; the date is shown apart.
    static func dayName(_ date: String, today: String) -> String {
        if date == today { return "今天" }
        if date == addDays(today, 1) { return "明天" }
        let day = weekday(date)
        return day > 0 ? weekdays[day - 1] : ""
    }

    /// "今天 周二", "明天 周三" or "周五 09-11".
    static func dateLabel(_ date: String, today: String) -> String {
        let day = weekday(date)
        let name = day > 0 ? weekdays[day - 1] : ""
        if date == today { return "今天 \(name)" }
        if date == addDays(today, 1) { return "明天 \(name)" }
        return "\(name) \(date.dropFirst(5))"
    }

    private static var china: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return calendar
    }

    /// Today in China time, as the timetable keeps its dates.
    static func today(_ now: Date = Date()) -> String {
        let parts = china.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Minutes since midnight in China time.
    static func minute(_ now: Date = Date()) -> Int {
        let parts = china.dateComponents([.hour, .minute], from: now)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }
}
