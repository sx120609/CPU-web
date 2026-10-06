import Combine
import Foundation

/// Share codes: publishing the signed-in user's own timetable, and keeping the
/// timetables other people shared with them.
///
/// Publishing and revoking go through the site account (`/api/schedule-shares`),
/// so the codes follow the account across devices. What somebody else shared is
/// kept on this device only, under the account that imported it.
@available(iOS 17.0, *)
@MainActor
final class NativeScheduleSharingService: ObservableObject {
    static let shared = NativeScheduleSharingService()

    @Published private(set) var library: NativeSharedScheduleLibrary
    /// The signed-in user's own share codes, newest first.
    @Published private(set) var mine: [NativeScheduleShareMeta] = []

    private weak var store: NativeScheduleStore?
    private var accountObserver: AnyCancellable?
    private var refreshing = false
    private let fileURL: URL?

    /// `fileURL` is where the library is kept; `nil` uses the app's own file.
    init(fileURL: URL? = nil) {
        let fileURL = fileURL ?? Self.defaultFileURL
        self.fileURL = fileURL
        if let fileURL, let data = try? Data(contentsOf: fileURL), data.count <= 16 * 1024 * 1024,
           let saved = try? JSONDecoder().decode(NativeSharedScheduleLibrary.self, from: data) {
            library = saved
        } else {
            library = NativeSharedScheduleLibrary()
        }
    }

    private static var defaultFileURL: URL? {
        guard let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        return directory.appendingPathComponent("CPUTime", isDirectory: true)
            .appendingPathComponent("shared-schedules.json")
    }

    /// Ties the service to the user's own timetable store: it supplies the
    /// signed-in session for requests and the account the library belongs to.
    func connect(to store: NativeScheduleStore) {
        guard self.store !== store else { return }
        self.store = store
        accountObserver = store.$result.sink { [weak self, weak store] _ in
            // `@Published` fires before the value is set; read it afterwards.
            Task { @MainActor in
                guard let self, let store else { return }
                self.adopt(account: store.accountFingerprint)
            }
        }
        adopt(account: store.accountFingerprint)
        publishCompanion()
    }

    private func adopt(account: String) {
        var next = library
        next.adopt(account: account)
        guard next != library else { return }
        if next.schedules.isEmpty, !library.schedules.isEmpty { mine = [] }
        commit(next)
    }

    private func commit(_ next: NativeSharedScheduleLibrary) {
        guard next != library else { return }
        library = next
        if let fileURL, let data = try? JSONEncoder().encode(next) {
            try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            // Readable after the first unlock, so a background Live Activity
            // refresh can still read the timetable being cared about.
            try? data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        publishCompanion()
    }

    /// The timetable being cared about also drives the Live Activity.
    private func publishCompanion() {
        #if os(iOS) && canImport(ActivityKit)
        let cared = library.cared
        NativeLiveActivityController.shared.setCompanion(cared?.snapshot(), label: cared?.name)
        #endif
    }

    // MARK: My shares

    /// The share code of `semester`, when one was published.
    func share(for semester: String) -> NativeScheduleShareMeta? {
        mine.first { $0.semester == semester }
    }

    func loadMine() async throws {
        struct Response: Decodable { let shares: [NativeScheduleShareMeta] }
        let data = try await request("GET", "/schedule-shares/mine")
        mine = try JSONDecoder().decode(Response.self, from: data).shares
    }

    /// Publishes the semester on screen. A semester has one code: publishing
    /// again updates what that code shows and tells whether anything changed.
    @discardableResult
    func publish() async throws -> NativeSchedulePublishedShare {
        guard let store else { throw NativeScheduleStoreError.webViewUnavailable }
        guard let snapshot = await store.snapshotForCalendarImport() else {
            throw NativeSharedSchedule.PublishError.incomplete
        }
        let body = try NativeSharedSchedule.publishBody(from: snapshot, ownerName: await store.sessionNickname())
        let data = try await request("POST", "/schedule-shares", body: JSONSerialization.data(withJSONObject: body))
        let published = try JSONDecoder().decode(NativeSchedulePublishedShare.self, from: data)
        mine.removeAll { $0.code == published.meta.code }
        mine.insert(published.meta, at: 0)
        return published
    }

    /// Withdraws a code. A code the server no longer has is already gone.
    func revoke(_ code: String) async throws {
        do {
            _ = try await request("DELETE", "/schedule-shares/\(code)")
        } catch let error as NativeScheduleAPIError where error.status == 404 {
        }
        mine.removeAll { $0.code == code }
    }

    // MARK: Shared with me

    enum ImportError: LocalizedError, Equatable {
        case invalidCode
        case ownShare
        case notFound

        var errorDescription: String? {
            switch self {
            case .invalidCode: return "分享码是 8 位字母和数字，请检查后再试"
            case .ownShare: return "这是你自己分享的课表，直接看自己的课表就可以"
            case .notFound: return "没有找到这份共享课表，可能已被撤销"
            }
        }
    }

    /// Downloads a share without keeping it, for the preview card.
    func preview(_ input: String) async throws -> NativeSharedSchedule {
        guard let code = NativeSharedSchedule.normalizedCode(input) else { throw ImportError.invalidCode }
        // Whose share it is comes from the account's own list, never from the
        // public nickname, which anyone can pick.
        if mine.isEmpty { try? await loadMine() }
        guard !mine.contains(where: { $0.code == code }) else { throw ImportError.ownShare }
        return try await download(code)
    }

    func save(_ schedule: NativeSharedSchedule, remark: String) {
        var next = library
        next.save(schedule, remark: remark)
        commit(next)
    }

    func rename(_ code: String, remark: String) {
        var next = library
        next.rename(code, remark: remark)
        commit(next)
    }

    func remove(_ code: String) {
        var next = library
        next.remove(code)
        commit(next)
    }

    /// Cares about one shared timetable, or none with `nil`.
    func care(_ code: String?) {
        var next = library
        next.care(code)
        commit(next)
    }

    /// Checks every saved share once: a changed one is downloaded again, a
    /// withdrawn one is marked. Anything else, being offline included, leaves
    /// the saved copy as it is.
    func refresh() async {
        guard store != nil, !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        for saved in library.schedules where !saved.revoked {
            let code = saved.meta.code
            do {
                let data = try await request("GET", "/schedule-shares/\(code)/meta")
                let meta = try JSONDecoder().decode(NativeScheduleShareMeta.self, from: data)
                guard meta.updatedAt != saved.meta.updatedAt else { continue }
                let newer = try await download(code)
                var next = library
                next.refresh(newer)
                commit(next)
            } catch let error as NativeScheduleAPIError where error.status == 404 {
                // A server that predates the summary route answers 404 for
                // every code. Only the share itself being gone means revoked.
                do {
                    let newer = try await download(code)
                    var next = library
                    next.refresh(newer)
                    commit(next)
                } catch ImportError.notFound {
                    var next = library
                    next.markRevoked(code)
                    commit(next)
                } catch {
                    continue
                }
            } catch {
                continue
            }
        }
    }

    private func download(_ code: String) async throws -> NativeSharedSchedule {
        do {
            return try NativeSharedSchedule.read(try await request("GET", "/schedule-shares/\(code)"))
        } catch let error as NativeScheduleAPIError where error.status == 404 {
            throw ImportError.notFound
        }
    }

    private func request(_ method: String, _ path: String, body: Data? = nil) async throws -> Data {
        guard let store else { throw NativeScheduleStoreError.webViewUnavailable }
        return try await store.api(method: method, path: path, body: body)
    }

    // MARK: Text to send

    /// What the share sheet sends: the code, where to type it, and the link
    /// that opens the same timetable in a browser.
    static func invitation(code: String) -> String {
        var origin = IOSNextWebConfiguration.appURL.absoluteString
        while origin.hasSuffix("/") { origin.removeLast() }
        return "我的课表分享码：\(code)\n在药大拾间「课表 → 更多 → 共享课表」里输入就能看，也可以直接打开：\(origin)/schedule/share/\(code)"
    }

#if DEBUG
    /// Replaces the state for a screenshot run; nothing is written to disk.
    func installDebugState(library: NativeSharedScheduleLibrary, mine: [NativeScheduleShareMeta]) {
        self.library = library
        self.mine = mine
    }
#endif
}
