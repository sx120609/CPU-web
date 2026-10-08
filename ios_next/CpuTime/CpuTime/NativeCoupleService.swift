import Combine
import Foundation

/// The partner's timetable while it is drawn over the grid.
@available(iOS 17.0, *)
struct NativeCoupleLayer: Equatable {
    let partner: NativeSharedSchedule
    let myColor: String
    let partnerColor: String
    let partnerName: String

    /// "小鹿的课", for the quick look of a course of theirs.
    var ownerTitle: String { "\(partnerName.isEmpty ? "TA " : partnerName)的课" }
}

/// The binding, the partner's snapshot and the upload of the user's own
/// timetable. Requests go through the signed-in web session like the shared
/// timetables do (`/api/couple`). Every background request fails quietly: the
/// couple timetable must never get in the way of the timetable itself.
@available(iOS 17.0, *)
@MainActor
final class NativeCoupleService: ObservableObject {
    static let shared = NativeCoupleService()

    @Published private(set) var status: CoupleStatus = .unknown { didSet { publishPartner() } }
    /// Whether the partner's courses are drawn in the grid; kept on this device.
    @Published private(set) var visible: Bool { didSet { publishPartner() } }
    /// The partner's term; nil while there is no snapshot of theirs.
    @Published private(set) var partner: NativeSharedSchedule? { didSet { publishPartner() } }

    private weak var store: NativeScheduleStore?
    private var observer: AnyCancellable?
    private var settle: Task<Void, Never>?
    private var account = ""
    private var checkedAt: Date?
    private var refreshing = false
    private var syncing = false
    private let defaults: UserDefaults
    private let now: () -> Date

    private static let visibleKey = "cpu.couple.visible"
    private static let syncKey = "cpu.couple.sync"
    private static let unboundPause: TimeInterval = 10 * 60
    private static let boundPause: TimeInterval = 60
    private static let unchangedResync: TimeInterval = 12 * 60 * 60
    /// The timetable has to hold still this long before it is uploaded.
    private static let settleDelay: Duration = .seconds(4)

    init(defaults: UserDefaults = .standard, now: @escaping () -> Date = { Date() }) {
        self.defaults = defaults
        self.now = now
        visible = defaults.object(forKey: Self.visibleKey) as? Bool ?? true
    }

    /// The Live Activity shows the partner's courses beside the user's while
    /// they are drawn in the grid.
    private func publishPartner() {
        #if os(iOS) && canImport(ActivityKit)
        let layer = layer
        NativeLiveActivityController.shared.setPartner(
            layer?.partner.snapshot(), label: layer?.partnerName,
            hue: layer.map { CoupleRules.hue($0.partnerColor) }, ownHue: layer.map { CoupleRules.hue($0.myColor) })
        #endif
    }

    var isActive: Bool { if case .active = status { return true } else { return false } }

    var me: CoupleMember? { if case .active(_, let me, _) = status { return me } else { return nil } }
    var partnerMember: CoupleMember? { if case .active(_, _, let partner) = status { return partner } else { return nil } }
    var anniversary: String { if case .active(let anniversary, _, _) = status { return anniversary } else { return "" } }

    /// The partner's timetable ready to draw, when the user wants to see it.
    var layer: NativeCoupleLayer? {
        guard visible, let partner, case .active(_, let me, let other) = status else { return nil }
        return NativeCoupleLayer(partner: partner, myColor: me.color, partnerColor: other.color, partnerName: other.nickname)
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
        partner = nil
    }

    func setVisible(_ value: Bool) {
        visible = value
        defaults.set(value, forKey: Self.visibleKey)
    }

    /// Once the timetable holds still: ask who the user is bound to, then
    /// upload the term when bound.
    private func timetableChanged() {
        settle?.cancel()
        guard let store, store.result != nil, !account.isEmpty else { return }
        settle = Task { [weak self] in
            do { try await Task.sleep(for: Self.settleDelay) } catch { return }
            guard let self else { return }
            await self.refresh()
            guard !Task.isCancelled else { return }
            await self.sync()
        }
    }

    /// Asks the server who the user is bound to and fetches the partner's
    /// timetable. Unforced calls are spaced out: an unbound account is asked
    /// again after ten minutes, a bound one after a minute.
    func refresh(force: Bool = false) async {
#if DEBUG
        if debugPinned { return }
#endif
        guard store != nil, !refreshing else { return }
        let time = now()
        if !force, let checkedAt, time.timeIntervalSince(checkedAt) < (isActive ? Self.boundPause : Self.unboundPause) { return }
        refreshing = true
        defer { refreshing = false }
        do {
            apply(CoupleStatus.read(try await request("GET", "/couple")))
            checkedAt = time
            try await loadPartner()
        } catch {}
    }

    private func apply(_ next: CoupleStatus) {
#if DEBUG
        // A request that was under way when the sample state was installed.
        if debugPinned { return }
#endif
        if status != next { status = next }
        if !isActive {
            if partner != nil { partner = nil }
            defaults.removeObject(forKey: Self.syncKey)
        }
    }

    private func loadPartner() async throws {
        guard let other = partnerMember else { return }
        let data = try await request("GET", "/couple/schedules")
#if DEBUG
        if debugPinned { return }
#endif
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let snapshot = json["partner"] as? [String: Any] else {
            if partner != nil { partner = nil }
            return
        }
        // The share reader clamps everything a grid indexes with; a snapshot it refuses is not drawn.
        let document: [String: Any] = [
            "code": "COUPLE", "owner": other.nickname,
            "semester": snapshot["semester"] as? String ?? "",
            "schedule": snapshot["schedule"] as? [String: Any] ?? [:],
            "calendar": snapshot["calendar"] as? [String: Any] ?? [:],
        ]
        guard var next = (try? JSONSerialization.data(withJSONObject: document)).flatMap({ try? NativeSharedSchedule.read($0) }) else {
            if partner != nil { partner = nil }
            return
        }
        // Compared without the fetch time: the same content again must not redraw the grid.
        next.fetchedAt = partner?.fetchedAt ?? next.fetchedAt
        if next != partner { partner = next }
    }

    /// Uploads the user's whole current term so the partner sees it. The same
    /// content is sent again only after twelve hours, to keep its "synced" time fresh.
    private func sync() async {
        guard isActive, !syncing, let store else { return }
        guard let snapshot = await store.snapshotForCalendarImport(),
              var body = try? NativeSharedSchedule.publishBody(from: snapshot, ownerName: nil) else { return }
        body.removeValue(forKey: "ownerName")
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return }
        let print = account + "|" + CoupleRules.fingerprint(String(decoding: data, as: UTF8.self))
        let time = now().timeIntervalSince1970
        let last = (defaults.string(forKey: Self.syncKey) ?? "").components(separatedBy: "@")
        if last.count == 2, last[0] == print, let sent = Double(last[1]), (0..<Self.unchangedResync).contains(time - sent) { return }
        syncing = true
        defer { syncing = false }
        guard (try? await request("PUT", "/couple/schedule", body: data)) != nil else { return }
        defaults.set("\(print)@\(time)", forKey: Self.syncKey)
    }

    // MARK: Managing the binding; these report their failures.

    func invite() async throws { try await change("POST", "/couple/invite") }

    func cancelInvite() async throws { try await change("DELETE", "/couple/invite") }

    func accept(_ code: String) async throws {
        try await change("POST", "/couple/accept", body: ["code": code])
        // A new binding uploads at once, so the partner is not left looking at nothing.
        await sync()
    }

    func unbind() async throws { try await change("DELETE", "/couple") }

    /// An empty date clears the anniversary.
    func setAnniversary(_ date: String) async throws {
        try await change("PATCH", "/couple", body: ["anniversary": date.isEmpty ? NSNull() : date])
    }

    /// Picks the user's colour. Picking the partner's swaps the two on the
    /// server, so the two never share one.
    func setMyColor(_ color: String) async throws {
        guard me?.color != color else { return }
        try await change("PATCH", "/couple", body: ["myColor": color])
    }

    private func change(_ method: String, _ path: String, body: [String: Any]? = nil) async throws {
        let data = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        apply(CoupleStatus.read(try await request(method, path, body: data)))
        checkedAt = now()
        try? await loadPartner()
    }

    private func request(_ method: String, _ path: String, body: Data? = nil) async throws -> Data {
        guard let store else { throw NativeScheduleStoreError.webViewUnavailable }
        return try await store.api(method: method, path: path, body: body)
    }

#if DEBUG
    /// Replaces the state for a screenshot run; nothing is requested or saved.
    private var debugPinned = false

    func installDebugState(status: CoupleStatus, partner: NativeSharedSchedule?) {
        debugPinned = true
        self.status = status
        self.partner = partner
        checkedAt = now()
    }
#endif
}
