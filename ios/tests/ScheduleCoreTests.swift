import Foundation
import XCTest
@testable import WatchScheduleCore

@MainActor
final class MemoryStorage: ScheduleStorage {
    var data: Data?
    var failWrite = false
    var writes = 0
    func read() throws -> Data? { data }
    func write(_ data: Data) throws {
        if failWrite { throw ScheduleFailure.storage }
        self.data = data
        writes += 1
    }
}

@MainActor
final class MockTransport: ScheduleTransport {
    var connection = ScheduleConnection(activated: true, paired: true, installed: true, reachable: true)
    var onConnectionChange: (() -> Void)?
    var onSnapshot: ((Data) throws -> ScheduleEnvelope)?
    var onRefreshRequest: (() -> Void)?
    var onAcknowledgement: ((String, Date) -> Void)?
    var onError: ((ScheduleFailure) -> Void)?
    var sent: [Data] = []
    var statuses: [ScheduleFailure] = []
    var failure: ScheduleFailure?
    var activations = 0
    var requests = 0
    func activate() { activations += 1; onConnectionChange?() }
    func updateSnapshot(_ data: Data) throws {
        if let failure { throw failure }
        sent.append(data)
    }
    func updateStatus(_ failure: ScheduleFailure, snapshot: Data?) throws {
        statuses.append(failure)
    }
    func requestRefresh(completion: @escaping (Result<Void, ScheduleFailure>) -> Void) {
        requests += 1
        completion(failure.map { .failure($0) } ?? .success(()))
    }
}

@MainActor
final class MockProvider: ScheduleDataProvider {
    var onSnapshot: ((Data) -> Void)?
    var onFailure: ((ScheduleFailure) -> Void)?
    var refreshes = 0
    func refresh() { refreshes += 1 }
}

@MainActor
final class ScheduleCoreTests: XCTestCase {
    func fixture(weeks: [Int] = [1, 2, 3], timezone: String = "Asia/Shanghai") -> ScheduleEnvelope {
        ScheduleEnvelope(schemaVersion: 1, messageType: "schedule.snapshot",
            generatedAt: ISO8601DateFormatter().date(from: "2026-01-05T00:00:00Z")!,
            semester: ScheduleSemester(id: "fixture-semester", startDate: "2025-12-29", endDate: "2026-01-18", weekCount: 3),
            timezone: timezone, currentWeek: 2, coveredWeeks: [1, 2, 3],
            periods: [
                SchedulePeriod(number: 1, startTime: "08:00", endTime: "08:45"),
                SchedulePeriod(number: 2, startTime: "08:55", endTime: "09:40"),
            ],
            courses: [WatchCourse(id: "course-1", name: "测试课程", teacher: nil, room: nil, campus: nil,
                weekday: 1, startPeriod: 1, endPeriod: 2, startTime: "08:00", endTime: "09:40", weeks: weeks)])
    }
    func instant(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }
    func mutate(_ snapshot: ScheduleEnvelope, _ body: (inout [String: Any]) -> Void) throws -> Data {
        var json = try JSONSerialization.jsonObject(with: snapshot.encoded()) as! [String: Any]
        body(&json)
        return try JSONSerialization.data(withJSONObject: json)
    }

    func testJSONRoundTripAndEmptyMetadata() async throws {
        let value = fixture()
        XCTAssertEqual(try ScheduleEnvelope.decode(value.encoded()), value)
        XCTAssertEqual(value.displayPeriods.map(\.number), [1, 2])
        XCTAssertNil(value.courses[0].teacher)
        XCTAssertNil(value.courses[0].room)
    }

    func testLegacyCacheWithoutPeriodsRemainsReadable() async throws {
        let data = try mutate(fixture()) { $0.removeValue(forKey: "periods") }
        let value = try ScheduleEnvelope.decode(data)
        XCTAssertNil(value.periods)
        XCTAssertEqual(value.displayPeriods.map(\.number), [1, 2])
    }

    func testOlderSenderCannotDiscardCachedAuthoritativePeriods() async throws {
        let repository = CourseRepository(storage: MemoryStorage())
        try repository.accept(fixture().encoded())
        let legacyUpdate = try mutate(fixture()) {
            $0.removeValue(forKey: "periods")
            $0["generatedAt"] = instant("2026-01-05T00:01:00Z").timeIntervalSince1970 * 1000
        }
        let retained = try repository.accept(legacyUpdate)
        XCTAssertEqual(retained.periods, fixture().periods)
        XCTAssertEqual(retained.generatedAt, instant("2026-01-05T00:01:00Z"))
    }

    func testInvalidPeriodTableIsRejected() async throws {
        let overlap = try mutate(fixture()) {
            $0["periods"] = [
                ["number": 1, "startTime": "08:00", "endTime": "08:45"],
                ["number": 2, "startTime": "08:40", "endTime": "09:40"],
            ]
        }
        XCTAssertThrowsError(try ScheduleEnvelope.decode(overlap))

        let missingIntermediatePeriod = try mutate(fixture()) {
            $0["periods"] = [
                ["number": 1, "startTime": "08:00", "endTime": "08:45"],
                ["number": 3, "startTime": "08:55", "endTime": "09:40"],
            ]
        }
        XCTAssertThrowsError(try ScheduleEnvelope.decode(missingIntermediatePeriod))
    }

    func testWatchWidgetTimelineAdvancesWhenDisplayedCourseStarts() async throws {
        let snapshot = fixture()
        let beforeMondayCourse = instant("2026-01-04T23:30:00Z")
        let dates = WatchScheduleWidgetConfiguration.timelineDates(
            for: snapshot,
            startingAt: beforeMondayCourse,
            maximumCount: 4
        )

        XCTAssertEqual(dates.count, 3)
        XCTAssertEqual(dates[0], beforeMondayCourse)
        XCTAssertEqual(dates[1], instant("2026-01-05T00:00:01Z"))
        XCTAssertEqual(dates[2], instant("2026-01-12T00:00:01Z"))
    }

    func testWidgetRelativeDayUsesScheduleTimezone() async throws {
        let snapshot = fixture()
        let reference = instant("2026-01-05T15:30:00Z")
        let nextDayInShanghai = instant("2026-01-05T16:30:00Z")
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(secondsFromGMT: 0)!
        XCTAssertEqual(
            WatchScheduleWidgetConfiguration.dayOffset(
                from: reference,
                to: nextDayInShanghai,
                calendar: snapshot.calendar
            ),
            1
        )
        XCTAssertEqual(
            WatchScheduleWidgetConfiguration.dayOffset(
                from: reference,
                to: nextDayInShanghai,
                calendar: utc
            ),
            0
        )
    }

    func testWatchWidgetCacheMigrationPreservesExistingSharedCache() async throws {
        let fileManager = FileManager.default
        let directory = fileManager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fileManager.removeItem(at: directory) }
        let legacy = directory.appendingPathComponent("legacy/watch-schedule-v1.json")
        let shared = directory.appendingPathComponent("shared/watch-schedule-v1.json")
        try fileManager.createDirectory(at: legacy.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("legacy".utf8).write(to: legacy)

        try WatchScheduleWidgetConfiguration.migrateLegacyCacheIfNeeded(
            from: legacy,
            to: shared,
            fileManager: fileManager
        )
        XCTAssertEqual(try Data(contentsOf: shared), Data("legacy".utf8))

        try Data("new-legacy".utf8).write(to: legacy)
        try WatchScheduleWidgetConfiguration.migrateLegacyCacheIfNeeded(
            from: legacy,
            to: shared,
            fileManager: fileManager
        )
        XCTAssertEqual(try Data(contentsOf: shared), Data("legacy".utf8))
    }

    func testMissingSnapshotReportsPairingAndInstallationState() async throws {
        let storage = MemoryStorage()
        let transport = MockTransport()
        let coordinator = ScheduleSyncCoordinator(
            role: .watch,
            repository: CourseRepository(storage: storage),
            transport: transport
        )

        transport.connection = ScheduleConnection(activated: true, paired: false, installed: false, reachable: false)
        coordinator.start()
        XCTAssertEqual(coordinator.state(), .failed(.notPaired))

        transport.connection = ScheduleConnection(activated: true, paired: true, installed: false, reachable: false)
        XCTAssertEqual(coordinator.state(), .failed(.notInstalled))

        transport.connection = ScheduleConnection(activated: true, paired: true, installed: true, reachable: false)
        XCTAssertEqual(coordinator.state(), .awaitingFirstSync)
    }

    func testCachedScheduleKeepsDataStateAndExposesConnectionIssue() async throws {
        let repository = CourseRepository(storage: MemoryStorage())
        try repository.accept(fixture().encoded())
        let transport = MockTransport()
        let coordinator = ScheduleSyncCoordinator(role: .watch, repository: repository, transport: transport)
        coordinator.start()

        transport.connection = ScheduleConnection(activated: true, paired: false, installed: false, reachable: false)
        XCTAssertEqual(coordinator.state(at: fixture().generatedAt), .offlineCache)
        XCTAssertEqual(coordinator.connectionIssue, .notPaired)

        transport.connection = ScheduleConnection(activated: true, paired: true, installed: false, reachable: false)
        XCTAssertEqual(coordinator.connectionIssue, .notInstalled)

        transport.connection = ScheduleConnection(activated: true, paired: true, installed: true, reachable: false)
        XCTAssertEqual(coordinator.connectionIssue, .unavailable)

        transport.connection = ScheduleConnection(activated: true, paired: true, installed: true, reachable: true)
        XCTAssertNil(coordinator.connectionIssue)
        XCTAssertEqual(coordinator.state(at: fixture().generatedAt), .valid)
    }

    func testSchemaAndOldCacheRejection() async throws {
        for version in [0, 2] {
            let data = try mutate(fixture()) { $0["schemaVersion"] = version }
            XCTAssertThrowsError(try ScheduleEnvelope.decode(data)) { XCTAssertEqual($0 as? ScheduleFailure, .unsupportedVersion) }
            let storage = MemoryStorage(); storage.data = data
            let repository = CourseRepository(storage: storage)
            XCTAssertNil(repository.snapshot)
            XCTAssertEqual(repository.error, .unsupportedVersion)
            XCTAssertEqual(storage.data, data)
        }
    }

    func testUnknownMessageTypeIsRejected() async throws {
        let data = try mutate(fixture()) { $0["messageType"] = "exam.snapshot" }
        XCTAssertThrowsError(try ScheduleEnvelope.decode(data)) { XCTAssertEqual($0 as? ScheduleFailure, .unsupportedVersion) }
    }

    func testInvalidPayloadCannotOverwriteCache() async throws {
        let storage = MemoryStorage(); let repository = CourseRepository(storage: storage)
        let old = try fixture().encoded(); try repository.accept(old)
        let invalid = try mutate(fixture()) { $0["timezone"] = "Invalid/Timezone" }
        XCTAssertThrowsError(try repository.accept(invalid))
        XCTAssertEqual(storage.data, old)
        XCTAssertEqual(repository.snapshot, fixture())
        XCTAssertEqual(repository.error, .invalidData)
    }

    func testAtomicWriteFailurePreservesSnapshot() async throws {
        let storage = MemoryStorage(); let repository = CourseRepository(storage: storage)
        try repository.accept(fixture().encoded()); storage.failWrite = true
        XCTAssertThrowsError(try repository.accept(fixture(weeks: [1, 3]).encoded()))
        XCTAssertEqual(repository.snapshot, fixture())
    }

    func testFileWriteAndColdRestore() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = FileScheduleStorage(url: directory.appendingPathComponent("schedule.json"))
        try CourseRepository(storage: storage).accept(fixture().encoded())
        let restored = CourseRepository(storage: storage)
        XCTAssertEqual(restored.snapshot, fixture())
        XCTAssertNil(restored.error)
    }

    func testBrokenCacheReportsError() async throws {
        let storage = MemoryStorage(); storage.data = Data("broken".utf8)
        let repository = CourseRepository(storage: storage)
        XCTAssertNil(repository.snapshot)
        XCTAssertEqual(repository.error, .invalidData)
    }

    func testContinuousOddEvenDiscreteWeekFiltering() async throws {
        let monday = instant("2026-01-05T01:00:00Z") // Week 2
        XCTAssertEqual(fixture().courses(on: monday).count, 1)
        XCTAssertTrue(fixture(weeks: [1, 3]).courses(on: monday).isEmpty)
        XCTAssertEqual(fixture(weeks: [2]).courses(on: monday).count, 1)
        XCTAssertEqual(fixture(weeks: [1, 3]).courses(on: instant("2026-01-12T01:00:00Z")).count, 1)
        XCTAssertTrue(fixture().courses(on: instant("2026-01-06T01:00:00Z")).isEmpty)
    }

    func testCurrentAndNextBoundaries() async throws {
        let value = fixture()
        XCTAssertEqual(value.nextCourse(at: instant("2026-01-04T23:59:59Z"))?.id, "course-1")
        XCTAssertNil(value.currentCourse(at: instant("2026-01-04T23:59:59Z")))
        XCTAssertEqual(value.currentCourse(at: instant("2026-01-05T00:00:00Z"))?.id, "course-1")
        XCTAssertEqual(value.nextCourse(at: instant("2026-01-05T00:00:00Z"))?.id, "course-1")
        XCTAssertNil(value.currentCourse(at: instant("2026-01-05T01:40:00Z")))
        let nextWeek = value.nextCourseOccurrence(at: instant("2026-01-05T01:40:00Z"))
        XCTAssertEqual(nextWeek?.course.id, "course-1")
        XCTAssertEqual(nextWeek?.date, instant("2026-01-11T16:00:00Z"))
        XCTAssertNil(fixture(weeks: [2]).nextCourse(at: instant("2026-01-05T01:40:00Z")))
    }

    func testTimezoneMidnightAndYearBoundary() async throws {
        let value = fixture()
        XCTAssertEqual(value.week(on: instant("2026-01-04T15:59:59Z")), 1)
        XCTAssertEqual(value.week(on: instant("2026-01-04T16:00:00Z")), 2)
        XCTAssertEqual(value.week(on: instant("2025-12-28T15:59:59Z")), 0)
        XCTAssertEqual(value.week(on: instant("2026-01-18T16:00:00Z")), 0)
    }

    func testDSTUsesCalendarDays() async throws {
        let data = try mutate(fixture()) {
            $0["timezone"] = "America/New_York"
            $0["semester"] = ["id": "dst-fixture", "startDate": "2026-03-02", "endDate": "2026-03-22", "weekCount": 3]
            $0["generatedAt"] = instant("2026-03-09T04:00:00Z").timeIntervalSince1970 * 1000
        }
        let value = try ScheduleEnvelope.decode(data)
        XCTAssertEqual(value.week(on: instant("2026-03-09T04:00:00Z")), 2)
        XCTAssertEqual(value.week(on: instant("2026-03-09T03:59:59Z")), 1)
    }

    func testInvalidDatesCountsTypesAndDuplicates() async throws {
        let changes: [(inout [String: Any]) -> Void] = [
            { $0["generatedAt"] = Date.now.addingTimeInterval(3600).timeIntervalSince1970 * 1000 },
            { $0["currentWeek"] = "2" }, { $0["coveredWeeks"] = [1, 1, 3] },
            { $0["semester"] = ["id": "bad", "startDate": "2025-02-30", "endDate": "2026-01-18", "weekCount": 3] },
            { $0["courses"] = Array(repeating: ($0["courses"] as! [Any])[0], count: 501) },
            { $0["courses"] = Array(repeating: ($0["courses"] as! [Any])[0], count: 2) },
        ]
        for change in changes { XCTAssertThrowsError(try ScheduleEnvelope.decode(mutate(fixture(), change))) }
        XCTAssertThrowsError(try ScheduleEnvelope.decode(Data(repeating: 0, count: ScheduleEnvelope.maximumBytes + 1)))
    }

    func testUnknownSensitiveFieldsAreStripped() async throws {
        let data = try mutate(fixture()) { $0["cookie"] = "fixture-secret"; $0["token"] = "fixture-token" }
        let storage = MemoryStorage(); let repository = CourseRepository(storage: storage)
        try repository.accept(data)
        let text = String(data: storage.data!, encoding: .utf8)!
        XCTAssertFalse(text.contains("fixture-secret")); XCTAssertFalse(text.contains("fixture-token"))
    }

    func testDuplicateAndDelayedSnapshotsDoNotAccumulate() async throws {
        let storage = MemoryStorage(); let repository = CourseRepository(storage: storage)
        let data = try fixture().encoded()
        try repository.accept(data); try repository.accept(data)
        XCTAssertEqual(storage.writes, 1); XCTAssertEqual(repository.snapshot?.courses.count, 1)
        let old = try mutate(fixture()) { $0["generatedAt"] = instant("2026-01-05T00:00:00Z").addingTimeInterval(-1).timeIntervalSince1970 * 1000 }
        try repository.accept(old)
        XCTAssertEqual(repository.snapshot, fixture())
    }

    func testNewerPartialSnapshotCannotDiscardCompleteSemester() async throws {
        let storage = MemoryStorage(); let repository = CourseRepository(storage: storage)
        try repository.accept(fixture().encoded())
        let partial = try mutate(fixture()) {
            $0["generatedAt"] = instant("2026-01-05T00:01:00Z").timeIntervalSince1970 * 1000
            $0["coveredWeeks"] = [2]
            $0["courses"] = []
        }
        let retained = try repository.accept(partial)
        XCTAssertEqual(retained.coveredWeeks, [1, 2, 3])
        XCTAssertEqual(retained.courses[0].weeks, [1, 3])
        XCTAssertEqual(retained.generatedAt, instant("2026-01-05T00:01:00Z"))
        XCTAssertEqual(storage.writes, 2)
    }

    func testMockPhoneSendAndReceiptDistinguishDelivery() async throws {
        let repository = CourseRepository(storage: MemoryStorage()); try repository.accept(fixture().encoded())
        let transport = MockTransport()
        let sync = ScheduleSyncCoordinator(role: .phone, repository: repository, transport: transport)
        sync.start(); sync.start()
        XCTAssertEqual(transport.activations, 1); XCTAssertEqual(transport.sent.count, 1)
        XCTAssertNotNil(sync.lastQueuedAt); XCTAssertNil(sync.lastSyncedAt)
        transport.onAcknowledgement?(try fixture().fingerprint(), .now)
        XCTAssertNotNil(sync.lastSyncedAt)
    }

    func testUnreachablePhoneUsesApplicationContext() async throws {
        let repository = CourseRepository(storage: MemoryStorage()); try repository.accept(fixture().encoded())
        let transport = MockTransport(); transport.connection.reachable = false
        let sync = ScheduleSyncCoordinator(role: .phone, repository: repository, transport: transport)
        sync.start()
        XCTAssertEqual(transport.sent.count, 1); XCTAssertEqual(transport.requests, 0)
    }

    func testUninstalledAndInactiveRetryOnConnection() async throws {
        for property in ["installed", "activated", "paired"] {
            let repository = CourseRepository(storage: MemoryStorage()); try repository.accept(fixture().encoded())
            let transport = MockTransport()
            if property == "installed" { transport.connection.installed = false }
            if property == "activated" { transport.connection.activated = false }
            if property == "paired" { transport.connection.paired = false }
            let sync = ScheduleSyncCoordinator(role: .phone, repository: repository, transport: transport)
            sync.start(); XCTAssertTrue(transport.sent.isEmpty)
            transport.connection = ScheduleConnection(activated: true, paired: true, installed: true, reachable: true)
            transport.onConnectionChange?(); XCTAssertEqual(transport.sent.count, 1)
        }
    }

    func testMockSendFailureThenRetry() async throws {
        let repository = CourseRepository(storage: MemoryStorage()); try repository.accept(fixture().encoded())
        let transport = MockTransport(); transport.failure = .syncFailed
        let sync = ScheduleSyncCoordinator(role: .phone, repository: repository, transport: transport)
        sync.start(); XCTAssertEqual(sync.error, .syncFailed); XCTAssertNil(sync.lastQueuedAt)
        transport.failure = nil; transport.onConnectionChange?()
        XCTAssertEqual(transport.sent.count, 1)
    }

    func testMockWatchReceiveAndInvalidReceive() async throws {
        let repository = CourseRepository(storage: MemoryStorage()); let transport = MockTransport()
        let sync = ScheduleSyncCoordinator(role: .watch, repository: repository, transport: transport)
        _ = try transport.onSnapshot?(fixture().encoded())
        XCTAssertEqual(repository.snapshot, fixture())
        XCTAssertNotNil(sync.lastSyncedAt)
        XCTAssertThrowsError(try transport.onSnapshot?(Data("invalid".utf8)))
        XCTAssertEqual(repository.snapshot, fixture())
    }

    func testDelayedWatchPayloadReturnsRetainedSnapshotForReceipt() async throws {
        let storage = MemoryStorage(); let repository = CourseRepository(storage: storage)
        let transport = MockTransport()
        let sync = ScheduleSyncCoordinator(role: .watch, repository: repository, transport: transport)
        let newerData = try mutate(fixture()) {
            $0["generatedAt"] = instant("2026-01-05T00:01:00Z").timeIntervalSince1970 * 1000
        }
        let newer = try ScheduleEnvelope.decode(newerData)
        _ = try transport.onSnapshot?(newerData)
        let retained = try transport.onSnapshot?(fixture().encoded())
        XCTAssertEqual(retained, newer)
        XCTAssertEqual(repository.snapshot, newer)
        XCTAssertEqual(storage.writes, 1)
        XCTAssertNotNil(sync.lastSyncedAt)
    }

    func testManualRefreshAndProviderFailure() async throws {
        let provider = MockProvider(); let transport = MockTransport()
        let sync = ScheduleSyncCoordinator(role: .phone, repository: CourseRepository(storage: MemoryStorage()), transport: transport, provider: provider)
        transport.onRefreshRequest?(); XCTAssertEqual(provider.refreshes, 1); XCTAssertTrue(sync.refreshing)
        provider.onFailure?(.loginRequired)
        XCTAssertFalse(sync.refreshing); XCTAssertEqual(sync.state(), .loginRequired)
        XCTAssertEqual(transport.statuses, [.loginRequired])
        sync.refresh(); provider.onSnapshot?(try fixture().encoded())
        XCTAssertEqual(transport.sent.count, 1)
    }

    func testWatchRefreshFailureKeepsOfflineCache() async throws {
        let repository = CourseRepository(storage: MemoryStorage()); try repository.accept(fixture().encoded())
        let transport = MockTransport(); transport.failure = .unavailable
        let sync = ScheduleSyncCoordinator(role: .watch, repository: repository, transport: transport)
        sync.refresh(); XCTAssertFalse(sync.refreshing)
        XCTAssertEqual(sync.error, .unavailable); XCTAssertEqual(repository.snapshot, fixture())
    }

    func testExplicitEmptyLoadingStaleAndOfflineStates() async throws {
        let repository = CourseRepository(storage: MemoryStorage()); let transport = MockTransport()
        let sync = ScheduleSyncCoordinator(role: .watch, repository: repository, transport: transport)
        XCTAssertEqual(sync.state(), .loading); sync.start(); XCTAssertEqual(sync.state(), .awaitingFirstSync)
        try repository.accept(fixture().encoded())
        XCTAssertEqual(sync.state(at: fixture().generatedAt), .valid)
        transport.connection.reachable = false
        XCTAssertEqual(sync.state(at: fixture().generatedAt), .offlineCache)
        XCTAssertEqual(sync.state(at: fixture().generatedAt.addingTimeInterval(90000)), .stale)
        transport.connection.reachable = true
        try repository.accept(mutate(fixture()) { $0["courses"] = [] })
        XCTAssertEqual(sync.state(at: fixture().generatedAt), .empty)
    }
    func testSemesterCompletionWithSameTimestampIsSentAndCannotRegress() async throws {
        let repository = CourseRepository(storage: MemoryStorage())
        let partial = try mutate(fixture(weeks: [2])) { $0["coveredWeeks"] = [2] }
        try repository.accept(partial)
        let transport = MockTransport(); let provider = MockProvider()
        let sync = ScheduleSyncCoordinator(role: .phone, repository: repository, transport: transport, provider: provider)
        sync.start(); provider.onSnapshot?(try fixture().encoded())
        XCTAssertEqual(transport.sent.count, 2)
        transport.onAcknowledgement?(try ScheduleEnvelope.decode(partial).fingerprint(), .now)
        XCTAssertNil(sync.lastSyncedAt)
        try repository.accept(partial)
        XCTAssertEqual(repository.snapshot, fixture())
    }

}
