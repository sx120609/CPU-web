import Combine
import Foundation
import WebKit

// MARK: - Web bridge contract

/// The request passed to the authenticated WKWebView schedule bridge.
public struct NativeScheduleRequest: Hashable, Sendable {
    public let semester: String?
    public let week: String?
    public let force: Bool

    public init(semester: String? = nil, week: String? = nil, force: Bool = false) {
        self.semester = semester?.trimmedNonEmpty
        self.week = week?.trimmedNonEmpty
        self.force = force
    }
}

/// A loader is supplied by the shell after its WKWebView has established the
/// web session. It should return the snapshot from
/// `window.CPUTimeNativeScheduleFetch(semester, week, force)`.
public typealias NativeScheduleLoader = @MainActor (NativeScheduleRequest) async throws -> NativeScheduleSnapshot

public enum NativeScheduleStoreError: LocalizedError, Equatable {
    case loaderUnavailable
    case webViewUnavailable
    case bridgeUnavailable
    case invalidResponse
    case unauthorized(String)
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .loaderUnavailable:
            return "课表服务尚未连接"
        case .webViewUnavailable:
            return "网页会话尚未准备好"
        case .bridgeUnavailable:
            return "暂时无法读取网页课表"
        case .invalidResponse:
            return "课表数据无法读取"
        case .unauthorized(let message):
            return message.trimmedNonEmpty ?? "教务授权已失效，请重新登录"
        case .server(let message):
            return message.trimmedNonEmpty ?? "课表服务暂时不可用"
        }
    }
}

// MARK: - Schedule models

public enum NativeScheduleSource: String, Codable, Sendable {
    case jwxt
    case graduate
    case cache
    case unknown

    public init(from decoder: Decoder) throws {
        let value = try String(from: decoder).lowercased()
        switch value {
        case "modern", "legacy", "undergraduate", "jwxt":
            self = .jwxt
        case "graduate":
            self = .graduate
        case "cache":
            self = .cache
        default:
            self = .unknown
        }
    }
}

public struct NativeScheduleAuth: Codable, Equatable, Sendable {
    public var authenticated: Bool
    public var identity: String?
    /// A non-reversible account fingerprint supplied by the web bridge. It
    /// scopes the on-disk timetable so a cold start never crosses accounts.
    public var account: String?

    public init(authenticated: Bool = false, identity: String? = nil, account: String? = nil) {
        self.authenticated = authenticated
        self.identity = identity
        self.account = account?.trimmedNonEmpty
    }
}

public struct NativeScheduleSemester: Codable, Identifiable, Equatable, Sendable {
    public let value: String
    public let label: String
    public let current: Bool

    public var id: String { value }

    public init(value: String, label: String, current: Bool = false) {
        self.value = value
        self.label = label
        self.current = current
    }
}

public struct NativeScheduleWeek: Codable, Identifiable, Equatable, Sendable {
    public let value: String
    public let label: String
    public let current: Bool

    public var id: String { value }

    public init(value: String, label: String, current: Bool = false) {
        self.value = value
        self.label = label
        self.current = current
    }
}

public struct NativeScheduleCourse: Codable, Identifiable, Equatable, Sendable {
    public let name: String
    public let teacher: String?
    public let weeks: String
    public let weekList: [Int]
    public let location: String?
    public let slotNote: String?
    public let startSlot: Int?
    public let endSlot: Int?
    public let sourceKey: String?
    public let customId: String?
    public let custom: Bool
    public let orphaned: Bool

    public var id: String {
        if let customId = customId?.trimmedNonEmpty { return "custom:\(customId)" }
        if let sourceKey = sourceKey?.trimmedNonEmpty { return sourceKey }
        return [name, teacher, location, weeks, startSlot.map(String.init), endSlot.map(String.init)]
            .compactMap { $0?.trimmedNonEmpty }
            .joined(separator: "|")
    }

    public init(
        name: String,
        teacher: String? = nil,
        weeks: String = "",
        weekList: [Int] = [],
        location: String? = nil,
        slotNote: String? = nil,
        startSlot: Int? = nil,
        endSlot: Int? = nil,
        sourceKey: String? = nil,
        customId: String? = nil,
        custom: Bool = false,
        orphaned: Bool = false
    ) {
        self.name = name
        self.teacher = teacher?.trimmedNonEmpty
        self.weeks = weeks
        self.weekList = weekList
        self.location = location?.trimmedNonEmpty
        self.slotNote = slotNote?.trimmedNonEmpty
        self.startSlot = startSlot
        self.endSlot = endSlot
        self.sourceKey = sourceKey?.trimmedNonEmpty
        self.customId = customId?.trimmedNonEmpty
        self.custom = custom
        self.orphaned = orphaned
    }

    private enum CodingKeys: String, CodingKey {
        case name, teacher, weeks, weekList, location, slotNote, startSlot, endSlot
        case sourceKey, customId, custom, orphaned
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            name: try values.decodeIfPresent(String.self, forKey: .name) ?? "课程",
            teacher: try values.decodeIfPresent(String.self, forKey: .teacher),
            weeks: try values.decodeIfPresent(String.self, forKey: .weeks) ?? "",
            weekList: try values.decodeIfPresent([Int].self, forKey: .weekList) ?? [],
            location: try values.decodeIfPresent(String.self, forKey: .location),
            slotNote: try values.decodeIfPresent(String.self, forKey: .slotNote),
            startSlot: try values.decodeIfPresent(Int.self, forKey: .startSlot),
            endSlot: try values.decodeIfPresent(Int.self, forKey: .endSlot),
            sourceKey: try values.decodeIfPresent(String.self, forKey: .sourceKey),
            customId: try values.decodeIfPresent(String.self, forKey: .customId),
            custom: try values.decodeIfPresent(Bool.self, forKey: .custom) ?? false,
            orphaned: try values.decodeIfPresent(Bool.self, forKey: .orphaned) ?? false
        )
    }
}

public struct NativeScheduleCell: Codable, Identifiable, Equatable, Sendable {
    public let day: Int
    public let bigSlot: Int
    public let courses: [NativeScheduleCourse]

    public var id: String { "\(day)-\(bigSlot)" }

    public init(day: Int, bigSlot: Int, courses: [NativeScheduleCourse] = []) {
        self.day = day
        self.bigSlot = bigSlot
        self.courses = courses
    }
}

public struct NativeCalendarWeek: Codable, Identifiable, Equatable, Sendable {
    public let week: Int
    public let days: [String]
    public let monday: String
    public let sunday: String

    public var id: Int { week }

    public init(week: Int, days: [String] = [], monday: String = "", sunday: String = "") {
        self.week = week
        self.days = days
        self.monday = monday
        self.sunday = sunday
    }
}

public struct NativeScheduleCalendar: Codable, Equatable, Sendable {
    public let source: NativeScheduleSource?
    public let semesters: [NativeScheduleSemester]
    public let currentSemester: String
    public let currentWeek: Int
    public let semesterStart: String
    public let semesterEnd: String
    public let weeks: [NativeCalendarWeek]

    public init(
        source: NativeScheduleSource? = nil,
        semesters: [NativeScheduleSemester] = [],
        currentSemester: String = "",
        currentWeek: Int = 0,
        semesterStart: String = "",
        semesterEnd: String = "",
        weeks: [NativeCalendarWeek] = []
    ) {
        self.source = source
        self.semesters = semesters
        self.currentSemester = currentSemester
        self.currentWeek = currentWeek
        self.semesterStart = semesterStart
        self.semesterEnd = semesterEnd
        self.weeks = weeks
    }

    private enum CodingKeys: String, CodingKey {
        case source, semesters, currentSemester, currentWeek, semesterStart, semesterEnd, weeks
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            source: try values.decodeIfPresent(NativeScheduleSource.self, forKey: .source),
            semesters: try values.decodeIfPresent([NativeScheduleSemester].self, forKey: .semesters) ?? [],
            currentSemester: try values.decodeIfPresent(String.self, forKey: .currentSemester) ?? "",
            currentWeek: try values.decodeFlexibleInt(forKey: .currentWeek) ?? 0,
            semesterStart: try values.decodeIfPresent(String.self, forKey: .semesterStart) ?? "",
            semesterEnd: try values.decodeIfPresent(String.self, forKey: .semesterEnd) ?? "",
            weeks: try values.decodeIfPresent([NativeCalendarWeek].self, forKey: .weeks) ?? []
        )
    }
}

public struct NativeScheduleResult: Codable, Equatable, Sendable {
    public let source: NativeScheduleSource?
    public let semesters: [NativeScheduleSemester]
    public let weeks: [NativeScheduleWeek]
    public let currentSemester: String
    public let currentWeek: String
    public let cells: [NativeScheduleCell]

    public init(
        source: NativeScheduleSource? = nil,
        semesters: [NativeScheduleSemester] = [],
        weeks: [NativeScheduleWeek] = [],
        currentSemester: String = "",
        currentWeek: String = "",
        cells: [NativeScheduleCell] = []
    ) {
        self.source = source
        self.semesters = semesters
        self.weeks = weeks
        self.currentSemester = currentSemester
        self.currentWeek = currentWeek
        self.cells = cells
    }

    private enum CodingKeys: String, CodingKey {
        case source, semesters, weeks, currentSemester, currentWeek, cells
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            source: try values.decodeIfPresent(NativeScheduleSource.self, forKey: .source),
            semesters: try values.decodeIfPresent([NativeScheduleSemester].self, forKey: .semesters) ?? [],
            weeks: try values.decodeIfPresent([NativeScheduleWeek].self, forKey: .weeks) ?? [],
            currentSemester: try values.decodeIfPresent(String.self, forKey: .currentSemester) ?? "",
            currentWeek: try values.decodeFlexibleString(forKey: .currentWeek) ?? "",
            cells: try values.decodeIfPresent([NativeScheduleCell].self, forKey: .cells) ?? []
        )
    }
}

/// The JSON object published by the web layer. `data.cells` already includes
/// the user's hidden and custom-course edits, so native rendering does not
/// apply a second edit pass.
public struct NativeScheduleSnapshot: Codable, Equatable, Sendable {
    public let version: Int
    public let completeSemester: Bool
    public let source: NativeScheduleSource
    public let fetchedAt: Date?
    public let data: NativeScheduleResult?
    public let calendar: NativeScheduleCalendar?
    public let auth: NativeScheduleAuth
    public let error: String?

    public init(
        version: Int = 1,
        completeSemester: Bool = false,
        source: NativeScheduleSource = .unknown,
        fetchedAt: Date? = nil,
        data: NativeScheduleResult? = nil,
        calendar: NativeScheduleCalendar? = nil,
        auth: NativeScheduleAuth = NativeScheduleAuth(),
        error: String? = nil
    ) {
        self.version = version
        self.completeSemester = completeSemester
        self.source = source
        self.fetchedAt = fetchedAt
        self.data = data
        self.calendar = calendar
        self.auth = auth
        self.error = error?.trimmedNonEmpty
    }

    private enum CodingKeys: String, CodingKey {
        case version, completeSemester, source, fetchedAt, data, calendar, auth, error
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            version: try values.decodeIfPresent(Int.self, forKey: .version) ?? 1,
            completeSemester: try values.decodeIfPresent(Bool.self, forKey: .completeSemester) ?? false,
            source: try values.decodeIfPresent(NativeScheduleSource.self, forKey: .source) ?? .unknown,
            fetchedAt: try values.decodeFlexibleDate(forKey: .fetchedAt),
            data: try values.decodeIfPresent(NativeScheduleResult.self, forKey: .data),
            calendar: try values.decodeIfPresent(NativeScheduleCalendar.self, forKey: .calendar),
            auth: try values.decodeIfPresent(NativeScheduleAuth.self, forKey: .auth) ?? NativeScheduleAuth(),
            error: try values.decodeIfPresent(String.self, forKey: .error)
        )
    }
}

// MARK: - Cold-start archive

/// The last displayed timetable, kept so a relaunch can show it before the web
/// session finishes restoring. Always scoped to one account fingerprint.
public struct NativeScheduleArchivedSchedule: Codable, Equatable, Sendable {
    /// The web account fingerprint, empty on web builds that do not send one.
    public let account: String
    /// A fingerprint of the web session cookie. The archive is only ever shown
    /// again while the same signed-in session is still present, so this is the
    /// check that keeps one account's timetable away from another's.
    public let session: String
    public let semester: String
    public let week: String
    public let savedAt: Date
    public let snapshot: NativeScheduleSnapshot

    public init(account: String, session: String, semester: String, week: String,
                savedAt: Date, snapshot: NativeScheduleSnapshot) {
        self.account = account
        self.session = session
        self.semester = semester
        self.week = week
        self.savedAt = savedAt
        self.snapshot = snapshot
    }
}

public protocol NativeScheduleArchive: AnyObject {
    func read() -> NativeScheduleArchivedSchedule?
    func write(_ record: NativeScheduleArchivedSchedule)
    func removeAll()
}

/// File-backed archive in Application Support. iOS protects the file until the
/// device is first unlocked, and it is excluded from backups because it only
/// mirrors data the schedule service can return again.
public final class NativeScheduleFileArchive: NativeScheduleArchive {
    private let url: URL?

    public init(fileName: String = "native-schedule-latest.json") {
        // A tool or test process has no bundle identifier; stay memory-only.
        guard let bundleIdentifier = Bundle.main.bundleIdentifier,
              let base = try? FileManager.default.url(
                  for: .applicationSupportDirectory, in: .userDomainMask,
                  appropriateFor: nil, create: true) else {
            url = nil
            return
        }
        var directory = base.appendingPathComponent(bundleIdentifier, isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try? directory.setResourceValues(resourceValues)
        url = directory.appendingPathComponent(fileName, isDirectory: false)
    }

    public func read() -> NativeScheduleArchivedSchedule? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder.nativeScheduleDecoder.decode(NativeScheduleArchivedSchedule.self, from: data)
    }

    public func write(_ record: NativeScheduleArchivedSchedule) {
        // ISO8601 on both sides; the flexible decoder cannot read the
        // encoder's default reference-date doubles as fetch timestamps.
        guard let url, let data = try? JSONEncoder.nativeScheduleEncoder.encode(record) else { return }
        try? data.write(to: url, options: .atomic)
    }

    public func removeAll() {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

// MARK: - Store state

public enum NativeScheduleState: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case stale
    case unauthorized
    case failed
}

@MainActor
public final class NativeScheduleStore: ObservableObject {
    @Published public private(set) var state: NativeScheduleState = .idle
    @Published public private(set) var result: NativeScheduleResult?
    @Published public private(set) var calendar: NativeScheduleCalendar?
    @Published public var selectedSemester: String = ""
    @Published public var selectedWeek: String = ""
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var lastUpdatedAt: Date?
    @Published public private(set) var source: NativeScheduleSource?

    public let cacheLifetime: TimeInterval

    private var loader: NativeScheduleLoader?
    private var webViewLoader: NativeScheduleWebViewLoader?
    private var cache: [CacheKey: CacheEntry] = [:]
    private var refreshStartedAt: [String: Date] = [:]
    private var requestGeneration = 0
    private var displayedKey: CacheKey?
    private let archive: NativeScheduleArchive?
    private var accountKey = ""
    private var sessionKey = ""
    private var didReadArchive = false
    /// Reads a fingerprint of the signed-in web session. Supplied by `attach`
    /// from the shared WKWebView cookie store; injectable for checks.
    public var sessionFingerprint: (@MainActor () async -> String?)?

    public init(
        loader: NativeScheduleLoader? = nil,
        cacheLifetime: TimeInterval = 12 * 60 * 60,
        archive: NativeScheduleArchive? = NativeScheduleFileArchive()
    ) {
        self.loader = loader
        self.cacheLifetime = max(0, cacheLifetime)
        self.archive = archive
    }

    /// Connects the store to the shell's authenticated WKWebView. Keeping the
    /// bridge here lets the UI use the same `NativeScheduleStore()` regardless
    /// of whether the web view has finished booting yet.
    public func attach(webView: WKWebView) {
        let bridge = NativeScheduleWebViewLoader(webView: webView)
        webViewLoader = bridge
        loader = { request in
            try await bridge.load(request)
        }
        sessionFingerprint = { await bridge.sessionFingerprint() }
        // Learn the session early so an auth notification never has to guess.
        Task { @MainActor [weak self] in
            guard let self, self.sessionKey.isEmpty,
                  let session = await self.sessionFingerprint?() else { return }
            if self.sessionKey.isEmpty { self.sessionKey = session }
        }
    }

    public func detach() {
        webViewLoader = nil
        loader = nil
        reset()
    }

    /// Called by the shell when the web account or JWXT identity changes.
    /// A session that finished restoring the same account keeps the timetable
    /// on screen; any other change drops every account-scoped byte, on disk
    /// included, before the next load.
    public func handleAuthChanged(account: String = "") {
        let next = account.trimmingCharacters(in: .whitespacesAndNewlines)
        if !next.isEmpty, next == accountKey {
            requestGeneration += 1
            return
        }
        if next.isEmpty {
            // An older web build sends no fingerprint, and its very first
            // notification is only the session finishing its restore. Keep the
            // timetable on screen and drop it solely once the session cookie
            // proves this is a different account, or none at all.
            requestGeneration += 1
            discardIfSessionChanged()
            return
        }
        archive?.removeAll()
        reset()
        accountKey = next
    }

    public func waitForBridge() {
        guard result == nil else { return }
        errorMessage = nil
        state = .loading
    }

    public func reportBridgeFailure(_ message: String) {
        requestGeneration += 1
        errorMessage = message
        state = .failed
    }

    public func clear() {
        reset()
    }

    /// Loads the requested semester/week. A fresh in-memory entry is used for
    /// repeated renders; `force` is used by pull-to-refresh and web session
    /// recovery. No disk cache is used, avoiding cross-account data leakage.
    public func load(semester: String? = nil, week: String? = nil, force: Bool = false) async {
        let requestedSemester = (semester ?? selectedSemester).trimmedNonEmpty
        let requestedWeek = (week ?? selectedWeek).trimmedNonEmpty
        if let requestedSemester { selectedSemester = requestedSemester }
        if let requestedWeek { selectedWeek = requestedWeek }
        webViewLoader?.prioritize(semester: selectedSemester, week: selectedWeek)

        let key = CacheKey(semester: requestedSemester ?? "", week: requestedWeek ?? "")
        if force { refreshStartedAt[key.semester] = .now }
        requestGeneration += 1
        let generation = requestGeneration
        if !force, let cached = cachedEntry(for: key), cached.isFresh(at: .now, lifetime: cacheLifetime) {
            apply(
                cached.snapshot,
                state: cached.snapshot.source == .cache ? .stale : .loaded,
                requestedSemester: requestedSemester,
                requestedWeek: requestedWeek,
                key: key
            )
            return
        }

        if displayedKey != nil, displayedKey != key {
            clearDisplayedData()
        }

        guard let loader else {
            state = .failed
            errorMessage = NativeScheduleStoreError.loaderUnavailable.localizedDescription
            return
        }

        state = .loading
        errorMessage = nil

        do {
            let snapshot = try await loader(NativeScheduleRequest(
                semester: requestedSemester,
                week: requestedWeek,
                force: force
            ))
            guard generation == requestGeneration else { return }
            try accept(snapshot, for: key, requestedSemester: requestedSemester, requestedWeek: requestedWeek)
        } catch is CancellationError {
            guard generation == requestGeneration else { return }
            state = result == nil ? .idle : .stale
        } catch {
            guard generation == requestGeneration else { return }
            handle(error, for: key)
        }
    }

    /// A trusted bridge pushes each prefetched week, then the complete semester.
    /// Cache it without changing a newer selection or a foreground loading state.
    public func receivePrefetchedSnapshot(_ snapshot: NativeScheduleSnapshot) {
        guard snapshot.version == 1, snapshot.auth.authenticated,
              snapshot.error == nil, let data = snapshot.data,
              !data.currentSemester.isEmpty, let fetchedAt = snapshot.fetchedAt else { return }
        guard cache.values.contains(where: { $0.snapshot.data?.currentSemester == data.currentSemester }),
              !cache.values.contains(where: { $0.snapshot.data?.currentSemester == data.currentSemester
                  && ($0.snapshot.fetchedAt ?? .distantPast) > fetchedAt }) else { return }
        let barrier = max(refreshStartedAt[data.currentSemester] ?? .distantPast,
                          refreshStartedAt[""] ?? .distantPast)
        guard fetchedAt >= barrier else { return }
        let entry = CacheEntry(snapshot: snapshot)
        guard entry.isFresh(at: .now, lifetime: cacheLifetime) else { return }
        if snapshot.completeSemester {
            cache = cache.filter { $0.key.semester != data.currentSemester }
            cache[CacheKey(semester: data.currentSemester, week: "*")] = entry
        } else {
            guard let week = Int(data.currentWeek), (1...64).contains(week),
                  cache[CacheKey(semester: data.currentSemester, week: "*")] == nil else { return }
            cache[CacheKey(semester: data.currentSemester, week: data.currentWeek)] = entry
            return // Prewarming must never change the visible week's state or selection.
        }
        if selectedSemester == data.currentSemester, state == .loaded || state == .stale {
            apply(snapshot, state: .loaded, requestedSemester: selectedSemester,
                  requestedWeek: selectedWeek,
                  key: CacheKey(semester: selectedSemester, week: selectedWeek))
            archiveDisplayed(snapshot)
        }
    }

    public func restoreCachedSelection() -> Bool {
        webViewLoader?.prioritize(semester: selectedSemester, week: selectedWeek)
        let key = CacheKey(semester: selectedSemester, week: selectedWeek)
        guard let entry = cachedEntry(for: key), entry.isFresh(at: .now, lifetime: cacheLifetime) else { return false }
        requestGeneration += 1
        apply(entry.snapshot, state: entry.snapshot.source == .cache ? .stale : .loaded,
              requestedSemester: selectedSemester, requestedWeek: selectedWeek, key: key)
        return true
    }

    /// Cold start: show the last timetable before the web bridge has booted.
    /// The live session cookie is checked first, so a record is only ever shown
    /// to the session that wrote it — no other account, and nobody signed out.
    public func restoreArchivedSelection() async -> Bool {
        guard !didReadArchive, result == nil, let archive else { return false }
        didReadArchive = true
        guard let record = archive.read(), !record.session.isEmpty,
              record.snapshot.auth.authenticated, let data = record.snapshot.data else { return false }
        let entry = CacheEntry(snapshot: record.snapshot, storedAt: record.savedAt)
        guard entry.isFresh(at: .now, lifetime: cacheLifetime) else {
            archive.removeAll()
            return false
        }
        guard let session = await sessionFingerprint?(), session == record.session,
              accountKey.isEmpty || record.account.isEmpty || accountKey == record.account,
              result == nil else {
            archive.removeAll()
            return false
        }
        if !record.account.isEmpty { accountKey = record.account }
        sessionKey = record.session
        selectedSemester = record.semester
        selectedWeek = record.week
        let key = CacheKey(semester: record.semester, week: record.week)
        cache[key] = entry
        if record.snapshot.completeSemester, !data.currentSemester.isEmpty {
            cache[CacheKey(semester: data.currentSemester, week: "*")] = entry
        }
        requestGeneration += 1
        webViewLoader?.prioritize(semester: selectedSemester, week: selectedWeek)
        apply(record.snapshot, state: .stale, requestedSemester: record.semester.trimmedNonEmpty,
              requestedWeek: record.week.trimmedNonEmpty, key: key)
        return true
    }

    /// Keeps the displayed timetable for the next cold start. The session
    /// fingerprint comes from the cookie store, so this works with web builds
    /// that do not send an account fingerprint of their own.
    private func archiveDisplayed(_ snapshot: NativeScheduleSnapshot) {
        guard archive != nil, snapshot.auth.authenticated, snapshot.source != .cache,
              snapshot.data != nil else { return }
        let account = snapshot.auth.account?.trimmedNonEmpty ?? ""
        if !account.isEmpty { accountKey = account }
        let semester = selectedSemester
        let week = selectedWeek
        Task { @MainActor [weak self] in
            guard let self, let session = await self.sessionFingerprint?(), !session.isEmpty else { return }
            self.sessionKey = session
            self.archive?.write(NativeScheduleArchivedSchedule(
                account: account,
                session: session,
                semester: semester,
                week: week,
                savedAt: snapshot.fetchedAt ?? .now,
                snapshot: snapshot
            ))
        }
    }

    public func refresh() async {
        await load(semester: selectedSemester, week: selectedWeek, force: true)
    }

    public func selectSemester(_ semester: String) async {
        selectedSemester = semester.trimmedNonEmpty ?? ""
        selectedWeek = ""
        await load(semester: selectedSemester, week: nil, force: false)
    }

    public func selectWeek(_ week: String) async {
        selectedWeek = week.trimmedNonEmpty ?? ""
        await load(semester: selectedSemester, week: selectedWeek, force: false)
    }

    /// Clears all in-memory data when the web session changes or the user logs
    /// out. The next request starts in the idle state.
    public func reset() {
        requestGeneration += 1
        cache.removeAll(keepingCapacity: false)
        refreshStartedAt.removeAll()
        accountKey = ""
        sessionKey = ""
        result = nil
        calendar = nil
        source = nil
        errorMessage = nil
        lastUpdatedAt = nil
        displayedKey = nil
        selectedSemester = ""
        selectedWeek = ""
        state = .idle
    }

    private func accept(
        _ snapshot: NativeScheduleSnapshot,
        for key: CacheKey,
        requestedSemester: String?,
        requestedWeek: String?
    ) throws {
        guard snapshot.version == 1 else {
            throw NativeScheduleStoreError.invalidResponse
        }
        if !snapshot.auth.authenticated {
            let message = snapshot.error ?? NativeScheduleStoreError.unauthorized("").localizedDescription
            discardUnauthorizedData()
            errorMessage = message
            state = .unauthorized
            throw NativeScheduleStoreError.unauthorized(message)
        }
        if let error = snapshot.error?.trimmedNonEmpty, snapshot.data == nil {
            if error == "bridge-unavailable" {
                throw NativeScheduleStoreError.bridgeUnavailable
            }
            throw NativeScheduleStoreError.server(error)
        }
        guard let data = snapshot.data else {
            throw NativeScheduleStoreError.invalidResponse
        }

        if !snapshot.completeSemester,
           let complete = cache[CacheKey(semester: data.currentSemester, week: "*")],
           (complete.snapshot.fetchedAt ?? .distantPast) >= (snapshot.fetchedAt ?? .distantPast) {
            try accept(complete.snapshot, for: key, requestedSemester: requestedSemester, requestedWeek: requestedWeek)
            return
        }
        let entry = CacheEntry(snapshot: snapshot)
        if !snapshot.completeSemester {
            cache = cache.filter { !($0.value.snapshot.completeSemester && $0.value.snapshot.data?.currentSemester == data.currentSemester) }
        }
        cache[key] = entry
        // The initial request commonly omits semester/week. Keep an alias for
        // the resolved values so a subsequent view render does not refetch.
        let resolvedKey = CacheKey(
            semester: requestedSemester ?? data.currentSemester,
            week: requestedWeek ?? data.currentWeek
        )
        cache[resolvedKey] = entry
        if snapshot.completeSemester {
            // Replace every older weekly alias when a semester is refreshed.
            cache = cache.filter { $0.key.semester != resolvedKey.semester }
            cache[key] = entry
            cache[resolvedKey] = entry
            cache[CacheKey(semester: resolvedKey.semester, week: "*")] = entry
        }
        if let requestedSemester { selectedSemester = requestedSemester }
        else if !data.currentSemester.isEmpty { selectedSemester = data.currentSemester }
        if let requestedWeek { selectedWeek = requestedWeek }
        else if !data.currentWeek.isEmpty { selectedWeek = data.currentWeek }
        result = data
        calendar = snapshot.calendar
        source = snapshot.source == .unknown ? data.source : snapshot.source
        lastUpdatedAt = snapshot.fetchedAt ?? .now
        errorMessage = snapshot.error?.trimmedNonEmpty
        state = snapshot.source == .cache ? .stale : .loaded
        displayedKey = key
        archiveDisplayed(snapshot)
    }

    private func apply(
        _ snapshot: NativeScheduleSnapshot,
        state: NativeScheduleState,
        requestedSemester: String?,
        requestedWeek: String?,
        key: CacheKey
    ) {
        if let data = snapshot.data {
            result = data
            calendar = snapshot.calendar
            source = snapshot.source == .unknown ? data.source : snapshot.source
            if let requestedSemester { selectedSemester = requestedSemester }
            else if !data.currentSemester.isEmpty { selectedSemester = data.currentSemester }
            if let requestedWeek { selectedWeek = requestedWeek }
            else if !data.currentWeek.isEmpty { selectedWeek = data.currentWeek }
            lastUpdatedAt = snapshot.fetchedAt
            displayedKey = key
        }
        self.state = state
        errorMessage = snapshot.error?.trimmedNonEmpty
    }

    private func handle(_ error: Error, for key: CacheKey) {
        let storeError = normalize(error)
        if case .unauthorized(let message) = storeError {
            discardUnauthorizedData()
            errorMessage = message
            state = .unauthorized
            return
        }
        if let cached = cachedEntry(for: key) {
            apply(
                cached.snapshot,
                state: .stale,
                requestedSemester: key.semester.trimmedNonEmpty,
                requestedWeek: key.week.trimmedNonEmpty,
                key: key
            )
            errorMessage = storeError.localizedDescription
            return
        }
        clearDisplayedData()
        errorMessage = storeError.localizedDescription
        state = .failed
    }

    /// An expired 教务 authorization is not a sign-out: while the same web
    /// session is still signed in, the timetable stays visible under a banner.
    /// Anything else clears it, the archive included.
    private func discardUnauthorizedData() {
        guard result != nil, !sessionKey.isEmpty, sessionFingerprint != nil else {
            archive?.removeAll()
            clearLoadedData()
            return
        }
        discardIfSessionChanged()
    }

    /// Clears every account-scoped byte unless the signed-in web session is
    /// still the one the displayed timetable was loaded for.
    private func discardIfSessionChanged() {
        // Without a way to read the session there is nothing to prove, so the
        // conservative path wins and every account-scoped byte goes.
        guard let sessionFingerprint else {
            archive?.removeAll()
            reset()
            return
        }
        let expected = sessionKey
        Task { @MainActor [weak self] in
            guard let self else { return }
            let session = await sessionFingerprint() ?? ""
            guard expected.isEmpty || session.isEmpty || session != expected else { return }
            self.archive?.removeAll()
            self.reset()
            // Resetting supersedes whatever the shell just started, so the
            // timetable must never be left empty with nothing in flight.
            if self.loader != nil { await self.load(force: true) }
        }
    }

    private func clearLoadedData() {
        cache.removeAll(keepingCapacity: false)
        clearDisplayedData()
    }

    private func clearDisplayedData() {
        result = nil
        calendar = nil
        source = nil
        lastUpdatedAt = nil
        displayedKey = nil
    }

    private func normalize(_ error: Error) -> NativeScheduleStoreError {
        if let error = error as? NativeScheduleStoreError { return error }
        if error is DecodingError { return .invalidResponse }
        return .server(error.localizedDescription)
    }

    private func cachedEntry(for key: CacheKey) -> CacheEntry? {
        cache[CacheKey(semester: key.semester, week: "*")] ?? cache[key]
    }

    private struct CacheKey: Hashable {
        let semester: String
        let week: String
    }

    private struct CacheEntry {
        let snapshot: NativeScheduleSnapshot
        let storedAt: Date

        init(snapshot: NativeScheduleSnapshot, storedAt: Date = .now) {
            self.snapshot = snapshot
            self.storedAt = storedAt
        }

        func isFresh(at date: Date, lifetime: TimeInterval) -> Bool {
            guard lifetime > 0 else { return false }
            let timestamp = snapshot.fetchedAt ?? storedAt
            return date.timeIntervalSince(timestamp) <= lifetime
        }
    }
}

// MARK: - WKWebView loader

/// Convenience loader for the native shell. The web app owns authentication;
/// this class only asks the existing WKWebView to execute the bridge function.
@MainActor
public final class NativeScheduleWebViewLoader {
    private weak var webView: WKWebView?

    public init(webView: WKWebView) {
        self.webView = webView
    }

    /// A non-reversible fingerprint of the signed-in web session cookie. It
    /// changes on sign-out and on a different account's sign-in, and the raw
    /// value never leaves the cookie store.
    public func sessionFingerprint() async -> String? {
        guard let webView else { return nil }
        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        guard let value = cookies.first(where: {
            $0.name == "__Host-cpu-session" || $0.name == "cpu-session"
        })?.value, value.count >= 16 else { return nil }
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in Array(value.utf8) {
            hash = (hash ^ UInt64(byte)) &* 0x0000_0100_0000_01b3
        }
        return "s" + String(hash, radix: 16)
    }

    public func prioritize(semester: String, week: String) {
        guard !semester.isEmpty, !week.isEmpty, let webView else { return }
        Task { @MainActor in
            _ = try? await webView.callAsyncJavaScript(
                "window.CPUTimeNativeSchedulePrioritize?.(semester, week);",
                arguments: ["semester": semester, "week": week], in: nil, contentWorld: .page
            )
        }
    }

    public func load(_ request: NativeScheduleRequest) async throws -> NativeScheduleSnapshot {
        guard let webView else { throw NativeScheduleStoreError.webViewUnavailable }

        let functionBody = """
        const fetchSchedule = window.CPUTimeNativeScheduleFetch;
        const loadSchedule = window.CPUTimeNative?.loadSchedule;
        if (typeof fetchSchedule !== 'function' && typeof loadSchedule !== 'function') {
          return JSON.stringify({version: 1, source: 'unknown', auth: {authenticated: true}, error: 'bridge-unavailable'});
        }
        const value = typeof fetchSchedule === 'function'
          ? await fetchSchedule(semester || null, week || null, Boolean(force))
          : await loadSchedule({semester: semester || null, week: week || null, force: Boolean(force)});
        return typeof value === 'string' ? value : JSON.stringify(value);
        """
        let rawValue = try await webView.callAsyncJavaScript(
            functionBody,
            arguments: [
                "semester": request.semester ?? "",
                "week": request.week ?? "",
                "force": request.force
            ],
            in: nil,
            contentWorld: .page
        )
        guard let raw = rawValue as? String else {
            throw NativeScheduleStoreError.invalidResponse
        }
        guard let data = raw.data(using: .utf8) else {
            throw NativeScheduleStoreError.invalidResponse
        }
        do {
            return try JSONDecoder.nativeScheduleDecoder.decode(NativeScheduleSnapshot.self, from: data)
        } catch {
            throw NativeScheduleStoreError.invalidResponse
        }
    }

}

// MARK: - Codable compatibility helpers

private extension String {
    var trimmedNonEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

private extension KeyedDecodingContainer {
    func decodeFlexibleString(forKey key: Key) throws -> String? {
        if let value = try? decodeIfPresent(String.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return String(value) }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return String(Int(value)) }
        return nil
    }

    func decodeFlexibleInt(forKey key: Key) throws -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(String.self, forKey: key) { return Int(value.trimmedNonEmpty ?? "") }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return Int(value) }
        return nil
    }

    func decodeFlexibleDate(forKey key: Key) throws -> Date? {
        if let value = try? decodeIfPresent(Double.self, forKey: key) {
            return Date(timeIntervalSince1970: value > 10_000_000_000 ? value / 1000 : value)
        }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            if let numeric = Double(value) {
                return Date(timeIntervalSince1970: numeric > 10_000_000_000 ? numeric / 1000 : numeric)
            }
            return ISO8601DateFormatter().date(from: value)
        }
        return nil
    }
}

private extension JSONDecoder {
    static var nativeScheduleDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private extension JSONEncoder {
    static var nativeScheduleEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
