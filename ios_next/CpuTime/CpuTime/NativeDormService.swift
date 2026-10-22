import Combine
import Foundation

/// Keeps the dorm page (`/dorm-schedule`, see `DormRules`) supplied with the
/// term running now. The page decides whether the user is in a dorm and
/// uploads by the Web timetable's rules, so nothing here talks to `/api/dorm`.
/// Every request fails quietly: the dorm timetable must never get in the way
/// of the timetable itself.
@available(iOS 17.0, *)
@MainActor
final class NativeDormService {
    static let shared = NativeDormService()

    private weak var store: NativeScheduleStore?
    private var observer: AnyCancellable?
    private var settle: Task<Void, Never>?
    /// The timetable has to hold still this long before it is handed over, as for the couple upload.
    private static let settleDelay: Duration = .seconds(4)

    /// Ties the service to the user's own timetable store, like `NativeCoupleService.connect`.
    func connect(to store: NativeScheduleStore) {
        guard self.store !== store else { return }
        self.store = store
        observer = store.$result.sink { [weak self] _ in
            // `@Published` fires before the value is set; read it afterwards.
            Task { @MainActor in self?.timetableChanged() }
        }
        timetableChanged()
    }

    private func timetableChanged() {
        settle?.cancel()
        guard store?.result != nil else { return }
        settle = Task { [weak self] in
            do { try await Task.sleep(for: Self.settleDelay) } catch { return }
            await self?.offer()
        }
    }

    /// Hands the page this term's whole timetable, edits and each course's own
    /// clock times included. Only the term running now: a past one the user
    /// is browsing must never replace it on the server.
    func offer() async {
        guard let store, let result = store.result else { return }
        let semester = store.selectedSemester.trimmedNonEmpty ?? result.currentSemester
        guard Self.isCurrentTerm(semester, in: store) else { return }
        // The whole term may take a while to load; another user can sign in
        // meanwhile. Bind the timetable to the account it was asked for.
        let account = store.accountFingerprint
        guard let snapshot = await store.snapshotForCalendarImport(), !Task.isCancelled else { return }
        // A store that did not know its account yet adopts the one the loaded
        // snapshot carries; anything else means the account changed.
        let owner = account.isEmpty ? (snapshot.auth.account ?? "") : account
        guard store.accountFingerprint == owner,
              (snapshot.auth.account ?? owner) == owner,
              snapshot.data?.currentSemester == semester,
              (store.selectedSemester.trimmedNonEmpty ?? store.result?.currentSemester) == semester,
              Self.isCurrentTerm(semester, in: store),
              var body = try? NativeSharedSchedule.publishBody(from: snapshot, ownerName: nil) else { return }
        body.removeValue(forKey: "ownerName")
        _ = await store.dormRequest(DormRules.offer(body: body, account: owner))
    }

    private static func isCurrentTerm(_ semester: String, in store: NativeScheduleStore) -> Bool {
        guard let result = store.result else { return false }
        return DormRules.isCurrentTerm(semester, terms: result.semesters.map { (value: $0.value, current: $0.current) })
    }
}
