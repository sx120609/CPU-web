import Combine
import Foundation

/// A request to show the dorm timetable: from 更多, or from an invite link
/// with its code filled in.
@available(iOS 17.0, *)
struct DormPresentation: Identifiable, Equatable {
    let id = UUID()
    var code: String = ""
    var page: DormPage?
    /// Opens on the week with a cell's details up, for a screenshot run.
    var showsCellDetail = false
}

@available(iOS 17.0, *)
enum DormPage: String, CaseIterable, Identifiable, Hashable {
    case week = "一周", free = "空闲", morning = "早八", room = "宿舍"
    var id: String { rawValue }
}

/// The dorm, everyone's timetable and the upload of the user's own
/// (docs/dorm-schedule.md). Requests go through the signed-in web session as
/// the couple timetable's do (`/api/dorm`). Background work fails quietly, so
/// the dorm never gets in the way of the timetable; what the sheet asks for
/// reports its failures.
@available(iOS 17.0, *)
@MainActor
final class NativeDormService: ObservableObject {
    static let shared = NativeDormService()

    enum PeopleState: Equatable {
        case idle, loading, loaded
        case failed(String)
    }

    enum SyncOutcome: Equatable {
        case sent, unchanged
        /// Nothing to send now, and why.
        case skipped(String)
        case failed(String)
    }

    @Published private(set) var status: DormStatus = .unknown
    /// Everyone in the dorm in its order, each laid out with their own calendar.
    @Published private(set) var people: [DormPerson] = []
    @Published private(set) var peopleState: PeopleState = .idle
    /// Why the last status request the sheet made failed; nil after one that worked.
    @Published private(set) var statusError: String?
    @Published private(set) var refreshing = false
    @Published private(set) var syncing = false
    /// When the status and everyone's timetables were last read.
    @Published private(set) var refreshedAt: Date?
    /// The sheet to show; set from anywhere, shown over the timetable.
    @Published var presentation: DormPresentation?

    /// Brings the timetable to the front so the sheet can show over it.
    var onPresent: (() -> Void)?

    private weak var store: NativeScheduleStore?
    private var observer: AnyCancellable?
    private var settle: Task<Void, Never>?
    private var account = ""
    private var checkedAt: Date?
    private let defaults: UserDefaults
    private let now: () -> Date

    private static let syncKey = "cpu.dorm.sync"
    private static let fetchKey = "cpu.dorm.fetch"
    private static let unboundPause: TimeInterval = 10 * 60
    private static let boundPause: TimeInterval = 60
    /// The timetable has to hold still this long before it is uploaded.
    private static let settleDelay: Duration = .seconds(4)

    init(defaults: UserDefaults = .standard, now: @escaping () -> Date = { Date() }) {
        self.defaults = defaults
        self.now = now
    }

    var room: DormRoom? { status.room }

    /// The user's own row in the dorm.
    var meId: Int? { room?.me.id }

    func person(_ id: Int) -> DormPerson? { people.first { $0.id == id } }

    /// "我" for the user, else the nickname, else "室友".
    func name(_ id: Int) -> String {
        if id == meId { return "我" }
        let nickname = room?.member(id)?.nickname ?? person(id)?.nickname ?? ""
        return nickname.isEmpty ? "室友" : nickname
    }

    func color(_ id: Int) -> String { room?.member(id)?.color ?? person(id)?.color ?? "blue" }

    /// Shows the sheet, with a dorm code to join when an invite link brought it.
    func open(code: String = "", page: DormPage? = nil) {
        onPresent?()
        presentation = DormPresentation(code: DormRules.inviteCode(code), page: page)
    }

    /// Ties the service to the user's own timetable store: it supplies the
    /// signed-in session and tells when the timetable changed.
    func connect(to store: NativeScheduleStore) {
        guard self.store !== store else { return }
        self.store = store
        observer = store.$result.sink { [weak self, weak store] _ in
            // `@Published` fires before the value is set; read it afterwards.
            Task { @MainActor in
                guard let self, let store else { return }
                self.adopt(store.accountFingerprint)
                self.timetableChanged()
            }
        }
        adopt(store.accountFingerprint)
        timetableChanged()
    }

    /// Everything belongs to one account: another one signing in starts from nothing.
    private func adopt(_ next: String) {
#if DEBUG
        if debugPinned { return }
#endif
        guard next != account else { return }
        account = next
        checkedAt = nil
        status = .unknown
        people = []
        peopleState = .idle
        refreshedAt = nil
        statusError = nil
    }

    /// Once the timetable holds still: ask whether the user is in a dorm, then upload this term when they are.
    private func timetableChanged() {
        settle?.cancel()
        guard let store, store.result != nil, !account.isEmpty else { return }
        settle = Task { [weak self] in
            do { try await Task.sleep(for: Self.settleDelay) } catch { return }
            guard let self else { return }
            await self.refresh()
            guard !Task.isCancelled, self.room != nil else { return }
            _ = await self.sync()
        }
    }

    /// Asks the server for the dorm. Unforced calls are spaced out: without a
    /// dorm the answer holds for ten minutes, with one for a minute.
    @discardableResult
    func refresh(force: Bool = false) async -> Bool {
#if DEBUG
        if debugPinned { return true }
#endif
        guard store != nil else { return false }
        let time = now()
        if !force, let checkedAt, time.timeIntervalSince(checkedAt) < (room != nil ? Self.boundPause : Self.unboundPause) { return true }
        let asked = account
        do {
            let next = DormStatus.read(try await request("GET", "/dorm"))
            guard asked == account else { return false }
            apply(next)
            checkedAt = time
            statusError = nil
            return true
        } catch {
            guard asked == account else { return false }
            statusError = Self.message(error)
            return false
        }
    }

    /// What the sheet does when it opens and on 刷新: the dorm, then the
    /// user's upload (waited for, so their own row is current), then everyone's timetables.
    func reload(forceSync: Bool = false) async {
#if DEBUG
        if debugPinned { refreshedAt = now(); return }
#endif
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        guard await refresh(force: true), room != nil else { return }
        _ = await sync(force: forceSync)
        await loadPeople()
    }

    /// Everyone's timetable, each laid out with its own calendar and bells.
    func loadPeople() async {
#if DEBUG
        if debugPinned { return }
#endif
        guard let room else { return }
        let asked = account
        if peopleState != .loaded { peopleState = .loading }
        do {
            let data = try await request("GET", "/dorm/schedules")
            // The dorm may have changed meanwhile; read against the one there is now.
            guard asked == account, let current = self.room, current.id == room.id else { return }
            people = DormPeople.read(data, room: current)
            peopleState = .loaded
            refreshedAt = now()
        } catch {
            guard asked == account else { return }
            peopleState = people.isEmpty ? .failed(Self.message(error)) : .loaded
            if !people.isEmpty { statusError = Self.message(error) }
        }
    }

    private func apply(_ next: DormStatus) {
#if DEBUG
        // A request that was under way when the sample state was installed.
        if debugPinned { return }
#endif
        let previous = room
        if status != next { status = next }
        guard let room = next.room else {
            people = []
            peopleState = .idle
            defaults.removeObject(forKey: Self.syncKey)
            defaults.removeObject(forKey: Self.fetchKey)
            return
        }
        if previous?.id != room.id {
            people = []
            peopleState = .idle
            return
        }
        // Names and colours come from the dorm; somebody who left drops out.
        let members = Dictionary(room.members.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let next = people.compactMap { person -> DormPerson? in
            guard let member = members[person.id] else { return nil }
            var copy = person
            copy.nickname = member.nickname
            copy.color = member.color
            return copy
        }
        if next != people { people = next }
    }

    // MARK: The user's own timetable

    /// Uploads the user's whole current term for the roommates. Unforced, the
    /// same content goes again only after twelve hours, and a term the
    /// timetable has only one week of is fetched from 教务 at most every six.
    /// A past term the user is browsing is never sent.
    func sync(force: Bool = false) async -> SyncOutcome {
#if DEBUG
        if debugPinned {
            if force { debugMarkSynced() }
            return force ? .sent : .unchanged
        }
#endif
        guard let room, let store, let result = store.result else { return .skipped("课表还没有加载") }
        guard !syncing else { return .skipped("正在同步") }
        let semester = store.selectedSemester.trimmedNonEmpty ?? result.currentSemester
        guard Self.isCurrentTerm(semester, in: store) else { return .skipped("翻看往年学期时不上传，回到本学期再同步") }
        // The whole term may take a while to load; another user can sign in
        // meanwhile. Bind the timetable to the account it was asked for.
        let owner = account
        guard !owner.isEmpty else { return .skipped("还没有登录") }
        let scope = DormRules.uploadScope(account: owner, dorm: room.id, semester: semester)
        let time = now().timeIntervalSince1970
        if !force, store.latestSnapshot?.completeSemester != true,
           !DormRules.mayFetchTerm(last: defaults.string(forKey: Self.fetchKey), scope: scope, now: time) {
            return .skipped("刚同步过")
        }
        syncing = true
        defer { syncing = false }
        if store.latestSnapshot?.completeSemester != true { defaults.set("\(scope)@\(time)", forKey: Self.fetchKey) }
        guard let snapshot = await store.snapshotForCalendarImport(), !Task.isCancelled else { return .failed("整学期课表没有加载出来，请稍后再试") }
        guard account == owner, store.accountFingerprint == owner,
              (snapshot.auth.account ?? owner) == owner,
              snapshot.data?.currentSemester == semester,
              (store.selectedSemester.trimmedNonEmpty ?? store.result?.currentSemester) == semester,
              Self.isCurrentTerm(semester, in: store),
              let current = self.room, current.id == room.id else { return .skipped("课表已经换了") }
        let body: [String: Any]
        do {
            var value = try NativeSharedSchedule.publishBody(from: snapshot, ownerName: nil)
            value.removeValue(forKey: "ownerName")
            body = value
        } catch {
            return .failed(Self.message(error))
        }
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return .failed("课表数据有误") }
        let print = CoupleRules.fingerprint(String(decoding: data, as: UTF8.self))
        if !force, DormRules.skipsUpload(last: defaults.string(forKey: Self.syncKey), scope: scope, print: print,
                                         now: time, serverSemester: current.me.semester, semester: semester) {
            return .unchanged
        }
        do {
            let reply = try await request("PUT", "/dorm/schedule", body: data)
            guard account == owner else { return .skipped("账号已经换了") }
            defaults.set("\(scope)|\(print)@\(now().timeIntervalSince1970)", forKey: Self.syncKey)
            let json = (try? JSONSerialization.jsonObject(with: reply)) as? [String: Any]
            markSynced(at: json?["syncedAt"] as? String ?? ISO8601DateFormatter().string(from: now()), semester: semester)
            return .sent
        } catch {
            return .failed(Self.message(error))
        }
    }

    /// The user's own row shows the upload at once, without asking the server again.
    private func markSynced(at time: String, semester: String) {
        guard var room else { return }
        room.me.syncedAt = time
        room.me.semester = semester
        if let index = room.members.firstIndex(where: { $0.id == room.me.id }) {
            room.members[index].syncedAt = time
            room.members[index].semester = semester
        }
        status = .active(room)
    }

    private static func isCurrentTerm(_ semester: String, in store: NativeScheduleStore) -> Bool {
        guard let result = store.result else { return false }
        return DormRules.isCurrentTerm(semester, terms: result.semesters.map { (value: $0.value, current: $0.current) })
    }

    // MARK: Managing the dorm; these report their failures.

    /// Creates the dorm and its code, then uploads at once so roommates who
    /// join see the user's timetable.
    func create() async throws {
        try await change("POST", "/dorm/invite")
        _ = await sync(force: true)
        await loadPeople()
    }

    /// A new code (owner only); the old one stops working.
    func renewInvite() async throws { try await change("POST", "/dorm/invite") }

    func cancelInvite() async throws { try await change("DELETE", "/dorm/invite") }

    func join(_ code: String) async throws {
        try await change("POST", "/dorm/join", body: ["code": DormRules.typedCode(code)])
        _ = await sync(force: true)
        await loadPeople()
    }

    func leave() async throws { try await change("DELETE", "/dorm") }

    /// Owner only; the member is told.
    func remove(_ id: Int) async throws { try await change("DELETE", "/dorm/members/\(id)") }

    /// Owner only; empty clears the name.
    func rename(_ name: String) async throws {
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        try await change("PATCH", "/dorm", body: ["name": value.isEmpty ? NSNull() : String(value.prefix(24))])
    }

    /// Picking a colour a roommate uses swaps the two; the server does it.
    func setColor(_ color: String) async throws {
        guard room?.me.color != color else { return }
        try await change("PATCH", "/dorm", body: ["myColor": color])
    }

    private func change(_ method: String, _ path: String, body: [String: Any]? = nil) async throws {
#if DEBUG
        if debugPinned { return debugChange(method, path, body: body) }
#endif
        let data = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        let asked = account
        let reply = DormStatus.read(try await request(method, path, body: data))
        guard asked == account else { return }
        apply(reply)
        checkedAt = now()
        statusError = nil
    }

    private func request(_ method: String, _ path: String, body: Data? = nil) async throws -> Data {
        guard let store else { throw NativeScheduleStoreError.webViewUnavailable }
        return try await store.api(method: method, path: path, body: body)
    }

    static func message(_ error: Error) -> String {
        if let error = error as? NativeScheduleAPIError { return error.message }
        if case NativeScheduleStoreError.webViewUnavailable? = error as? NativeScheduleStoreError {
            return "登录状态还没有准备好，请稍后再试"
        }
        return error.localizedDescription
    }

#if DEBUG
    /// Replaces the state for a screenshot run; nothing is requested or saved.
    private(set) var debugPinned = false

    func installDebugState(status: DormStatus, people: [DormPerson]) {
        debugPinned = true
        self.status = status
        self.people = people
        peopleState = status.room == nil ? .idle : .loaded
        checkedAt = now()
        refreshedAt = now()
    }

    /// The sheet's actions on the sample state, so its flows can be tried without a server.
    private func debugChange(_ method: String, _ path: String, body: [String: Any]?) {
        guard var room else { return }
        switch (method, path) {
        case ("DELETE", "/dorm"):
            status = .none
            people = []
            return
        case ("POST", "/dorm/invite"):
            room.invite = DormInvite(code: "Q4WN7P", expiresAt: "", expired: false)
        case ("DELETE", "/dorm/invite"):
            room.invite = nil
        case ("PATCH", "/dorm"):
            if let color = body?["myColor"] as? String {
                let old = room.me.color
                room.members = room.members.map { member in
                    var copy = member
                    if member.id == room.me.id { copy.color = color } else if member.color == color { copy.color = old }
                    return copy
                }
                room.me.color = color
            }
            if body?.keys.contains("name") == true { room.name = body?["name"] as? String ?? "" }
        default:
            if path.hasPrefix("/dorm/members/"), let id = Int(path.dropFirst("/dorm/members/".count)) {
                room.members.removeAll { $0.id == id }
                people.removeAll { $0.id == id }
            }
        }
        status = .active(room)
        people = people.map { person in
            var copy = person
            copy.color = room.member(person.id)?.color ?? person.color
            copy.nickname = room.member(person.id)?.nickname ?? person.nickname
            return copy
        }
    }

    private func debugMarkSynced() {
        markSynced(at: ISO8601DateFormatter().string(from: now()), semester: room?.me.semester ?? "")
    }
#endif
}

#if DEBUG
@available(iOS 17.0, *)
extension NativeDormService {
    /// `CPU_DEBUG_DORM`: `active` puts the user (阿青, 舍长) in a dorm of
    /// five with a live code, four of them with timetables (阿杰 at NJMU, with
    /// its own bells) and 老周 not synced; `member` is the same dorm with
    /// 小鹿 as 舍长; `empty` has nobody synced; `none` shows creating and
    /// joining; `loading` and `error` the first read. Nothing is requested.
    func installDebugSample(_ state: String, store: NativeScheduleStore) {
        statusError = nil
        switch state {
        case "none":
            installDebugState(status: .none, people: [])
            return
        case "loading":
            installDebugState(status: .unknown, people: [])
            return
        case "error":
            installDebugState(status: .unknown, people: [])
            statusError = "网络连接已中断。"
            return
        default:
            break
        }
        let owner = state != "member"
        let empty = state == "empty"
        let time = now()
        func ago(_ minutes: Double) -> String { ISO8601DateFormatter().string(from: time.addingTimeInterval(-minutes * 60)) }
        let semester = store.result?.currentSemester.trimmedNonEmpty ?? "2026-2027-1"
        let members = [
            DormMember(id: 1, nickname: "阿青", color: "blue", isOwner: owner, syncedAt: empty ? "" : ago(120), semester: semester),
            DormMember(id: 2, nickname: "小鹿", color: "pink", isOwner: !owner, syncedAt: empty ? "" : ago(20), semester: semester),
            DormMember(id: 3, nickname: "小王", color: "green", isOwner: false, syncedAt: empty ? "" : ago(26 * 60), semester: semester),
            DormMember(id: 4, nickname: "阿杰", color: "amber", isOwner: false, syncedAt: empty ? "" : ago(180), semester: semester),
            DormMember(id: 5, nickname: "老周", color: "purple", isOwner: false),
        ]
        let room = DormRoom(
            id: 1, name: "6 栋 302", memberLimit: 6, isOwner: owner, since: ago(30 * 24 * 60),
            invite: owner ? DormInvite(code: "K7M2QX", expiresAt: "", expired: false) : nil,
            me: members[0], members: members
        )
        let today = DormRules.today(time)
        let thisMonday = DormRules.monday(today)
        let weeks = (0..<3).map { offset -> NativeCalendarWeek in
            let days = DormRules.dateRange(DormRules.addDays(thisMonday, (offset - 1) * 7), count: 7)
            return NativeCalendarWeek(week: 7 + offset, days: days, monday: days[0], sunday: days[6])
        }
        func calendar(_ periods: [NativeSchedulePeriod], school: String = "") -> NativeScheduleCalendar {
            NativeScheduleCalendar(currentSemester: semester, currentWeek: 8, semesterStart: weeks[0].monday,
                                   semesterEnd: weeks[2].sunday, weeks: weeks, periods: periods, school: school)
        }
        typealias Class = (day: Int, from: Int, to: Int, name: String, start: String?, end: String?)
        func shared(_ name: String, _ classes: [Class], bells: [NativeSchedulePeriod], school: String = "") -> NativeSharedSchedule {
            let cells = classes.map { item in
                NativeScheduleCell(day: item.day, bigSlot: (item.from + 1) / 2, courses: [NativeScheduleCourse(
                    customStartTime: item.start, customEndTime: item.end, name: item.name, teacher: nil,
                    weeks: "", weekList: [], location: nil, slotNote: nil, startSlot: item.from, endSlot: item.to
                )])
            }
            return NativeSharedSchedule(
                meta: NativeScheduleShareMeta(code: "DORM", owner: name, semester: semester),
                schedule: NativeScheduleResult(currentSemester: semester, currentWeek: "8", cells: cells),
                calendar: calendar(bells, school: school)
            )
        }
        // The user's own timetable as the sample timetable has it, every week.
        let mine: [Class] = (store.result?.cells ?? []).flatMap { cell in
            cell.courses.map { course in
                (cell.day, course.startSlot ?? cell.bigSlot * 2 - 1, course.endSlot ?? cell.bigSlot * 2, course.name,
                 course.customStartTime, course.customEndTime)
            }
        }
        let bells = store.latestSnapshot?.periods ?? NativeSchedulePeriod.bundledTimetable
        let njmu = [
            ("08:00", "08:40"), ("08:50", "09:30"), ("09:40", "10:20"), ("10:30", "11:10"), ("11:20", "12:00"),
            ("12:10", "12:50"), ("14:00", "14:40"), ("14:50", "15:30"), ("15:40", "16:20"), ("16:30", "17:10"),
            ("17:20", "18:00"), ("18:10", "18:50"), ("19:00", "19:40"), ("19:50", "20:30"), ("20:40", "21:20"),
        ].enumerated().map { NativeSchedulePeriod(number: $0.offset + 1, startTime: $0.element.0, endTime: $0.element.1) }
        let schedules: [Int: NativeSharedSchedule] = empty ? [:] : [
            1: shared("阿青", mine, bells: bells),
            2: shared("小鹿", [
                (1, 1, 2, "药理学", nil, nil), (1, 5, 6, "有机化学", nil, nil), (2, 3, 4, "大学英语", nil, nil),
                (2, 5, 6, "分析化学", nil, nil), (3, 1, 2, "生物化学", nil, nil), (3, 7, 8, "药物分析", nil, nil),
                (4, 3, 4, "体育", nil, nil), (5, 9, 10, "形势与政策", nil, nil),
            ], bells: NativeSchedulePeriod.bundledTimetable),
            3: shared("小王", [
                (1, 3, 4, "高等数学", nil, nil), (2, 1, 2, "分析化学", nil, nil), (2, 5, 8, "药理学实验", "13:30", "17:05"),
                (3, 9, 10, "音乐鉴赏", nil, nil), (4, 1, 2, "微生物学与免疫学", nil, nil), (5, 5, 6, "中药学", nil, nil),
                (6, 3, 4, "大学物理", nil, nil),
            ], bells: NativeSchedulePeriod.bundledTimetable),
            4: shared("阿杰", [
                (1, 2, 3, "系统解剖学", nil, nil), (2, 7, 8, "组织胚胎学", nil, nil), (3, 1, 2, "医用化学", nil, nil),
                (4, 8, 9, "生理学", nil, nil), (5, 1, 3, "医学心理学", nil, nil), (4, 13, 14, "医学伦理学", nil, nil),
            ], bells: njmu, school: "南京医科大学"),
        ]
        let people = members.map { member in
            DormPeople.person(id: member.id, nickname: member.nickname, color: member.color, schedule: schedules[member.id])
        }
        installDebugState(status: .active(room), people: people)
    }
}
#endif
