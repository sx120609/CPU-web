import Foundation
import XCTest
@testable import WatchScheduleCore

@MainActor
private final class MemoryScheduleStorage: ScheduleStorage {
    var data: Data?
    private(set) var writes = 0
    private(set) var removals = 0

    func read() throws -> Data? { data }
    func write(_ data: Data) throws {
        self.data = data
        writes += 1
    }
    func remove() throws {
        data = nil
        removals += 1
    }
}

@MainActor
private final class MockScheduleTransport: ScheduleTransport {
    var connection = ScheduleConnection(activated: true, paired: true, installed: true, reachable: true)
    var onConnectionChange: (() -> Void)?
    var onSnapshot: ((Data) throws -> ScheduleEnvelope)?
    var onRefreshRequest: (() -> Void)?
    var onAcknowledgement: ((String, Date) -> Void)?
    var onError: ((ScheduleFailure) -> Void)?
    var onClear: (() -> Void)?
    private(set) var sent: [Data] = []
    private(set) var activations = 0
    private(set) var statuses: [(ScheduleFailure, Data?)] = []
    var snapshotFailure: ScheduleFailure?
    var refreshResult: Result<Void, ScheduleFailure> = .success(())

    func activate() {
        activations += 1
        onConnectionChange?()
    }
    func updateSnapshot(_ data: Data) throws {
        if let snapshotFailure { throw snapshotFailure }
        sent.append(data)
    }
    func updateStatus(_ failure: ScheduleFailure, snapshot: Data?) throws {
        statuses.append((failure, snapshot))
    }
    func requestRefresh(completion: @escaping (Result<Void, ScheduleFailure>) -> Void) {
        completion(refreshResult)
    }
}

@MainActor
private final class MockScheduleProvider: ScheduleDataProvider {
    var onSnapshot: ((Data) -> Void)?
    var onFailure: ((ScheduleFailure) -> Void)?
    func refresh() {}
}

@MainActor
private final class MockBackgroundTask: WatchBackgroundTaskCompleting {
    var expirationHandler: (() -> Void)?
    private(set) var completions = 0
    func completeWithoutSnapshot() { completions += 1 }
}

@MainActor
final class WatchScheduleCoreTests: XCTestCase {
    private func nativeSnapshot(days: [String], courses: [NativeScheduleCourse] = []) -> NativeScheduleSnapshot {
        NativeScheduleSnapshot(
            completeSemester: true, source: .jwxt,
            fetchedAt: instant("2026-01-05T00:00:00Z"),
            data: NativeScheduleResult(currentSemester: "test-semester", currentWeek: "1",
                cells: [NativeScheduleCell(day: 1, bigSlot: 1, courses: courses)]),
            calendar: NativeScheduleCalendar(weeks: [NativeCalendarWeek(week: 1, days: days)]),
            auth: NativeScheduleAuth(authenticated: true)
        )
    }

    func testWatchConversionNormalizesSundayFirstAndMissingCalendarDays() throws {
        let monday = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"]
        for days in [monday,
                     ["2026-01-04"] + Array(monday.prefix(6)),
                     ["", "2026-01-05", "2026-01-06", "", "2026-01-08", "", "2026-01-10"],
                     ["", "2026-01-06", "2026-01-07", "", "2026-01-09", "", ""]] {
            let envelope = try nativeSnapshot(days: days).watchEnvelope()
            try envelope.validate()
            XCTAssertEqual(envelope.semester.startDate, "2026-01-05")
            XCTAssertEqual(envelope.semester.endDate, "2026-01-11")
        }
    }

    func testWatchConversionPreservesWeeklyRoomTeacherAndDurationVariants() throws {
        let first = NativeScheduleCourse(nativeId: "same-source", name: "化学", teacher: "教师甲",
            weekList: [1], location: "A", startSlot: 1, endSlot: 2)
        let second = NativeScheduleCourse(nativeId: "same-source", name: "化学", teacher: "教师乙",
            weekList: [2], location: "B", startSlot: 1, endSlot: 3)
        let snapshot = NativeScheduleSnapshot(completeSemester: true, source: .jwxt,
            fetchedAt: instant("2026-01-05T00:00:00Z"),
            data: NativeScheduleResult(currentSemester: "test-semester", currentWeek: "1",
                cells: [NativeScheduleCell(day: 1, bigSlot: 1, courses: [first, second])]),
            calendar: NativeScheduleCalendar(weeks: [
                NativeCalendarWeek(week: 1, days: ["2026-01-05"]),
                NativeCalendarWeek(week: 2, days: ["2026-01-12"])]),
            auth: NativeScheduleAuth(authenticated: true))
        let envelope = try snapshot.watchEnvelope()
        try envelope.validate()
        XCTAssertEqual(envelope.courses.count, 2)
        let weekOne = try XCTUnwrap(envelope.courses.first { $0.weeks == [1] })
        let weekTwo = try XCTUnwrap(envelope.courses.first { $0.weeks == [2] })
        XCTAssertEqual(weekOne.room, "A")
        XCTAssertEqual(weekOne.teacher, "教师甲")
        XCTAssertEqual(weekOne.endPeriod, 2)
        XCTAssertEqual(weekTwo.room, "B")
        XCTAssertEqual(weekTwo.teacher, "教师乙")
        XCTAssertEqual(weekTwo.endPeriod, 3)
    }

    func testFirstTrustedPhoneSnapshotCannotMergePreviousAccountWeeks() throws {
        let repository = CourseRepository(storage: MemoryScheduleStorage())
        let previous = fixture()
        try repository.accept(previous.encoded())
        let transport = MockScheduleTransport()
        let provider = MockScheduleProvider()
        let coordinator = ScheduleSyncCoordinator(role: .phone, repository: repository, transport: transport, provider: provider)
        coordinator.start()
        let incoming = ScheduleEnvelope(schemaVersion: 1, messageType: ScheduleWireProtocol.MessageType.snapshot,
            generatedAt: previous.generatedAt, semester: previous.semester, timezone: previous.timezone,
            currentWeek: previous.currentWeek, coveredWeeks: [2], periods: previous.periods, courses: [])
        provider.onSnapshot?(try incoming.encoded())
        XCTAssertEqual(repository.snapshot?.coveredWeeks, [2])
        XCTAssertEqual(repository.snapshot?.courses, [])
        XCTAssertEqual(transport.sent.count, 1)
        coordinator.clearForAccountChange()
        transport.onConnectionChange?()
        coordinator.sendLatest(force: true)
        XCTAssertEqual(transport.sent.count, 1)
    }

    private func fixture(
        generatedAt: Date? = nil,
        includePeriods: Bool = true,
        periods: [SchedulePeriod]? = nil,
        courses: [WatchCourse]? = nil
    ) -> ScheduleEnvelope {
        ScheduleEnvelope(
            schemaVersion: 1,
            messageType: ScheduleWireProtocol.MessageType.snapshot,
            generatedAt: generatedAt ?? instant("2026-01-05T00:00:00Z"),
            semester: ScheduleSemester(
                id: "fixture-semester",
                startDate: "2025-12-29",
                endDate: "2026-01-25",
                weekCount: 4
            ),
            timezone: "Asia/Shanghai",
            currentWeek: 2,
            coveredWeeks: [1, 2, 3, 4],
            periods: includePeriods ? (periods ?? [
                SchedulePeriod(number: 1, startTime: "08:00", endTime: "08:45"),
                SchedulePeriod(number: 2, startTime: "08:55", endTime: "09:40"),
                SchedulePeriod(number: 3, startTime: "09:55", endTime: "10:40"),
            ]) : nil,
            courses: courses ?? [
                WatchCourse(
                    id: "course-1", name: "测试课程", teacher: nil, room: nil, campus: nil,
                    weekday: 1, startPeriod: 1, endPeriod: 2,
                    startTime: "08:00", endTime: "09:40", weeks: [1, 2, 3, 4]
                ),
            ]
        )
    }

    private func course(
        id: String,
        weekday: Int = 1,
        startPeriod: Int = 1,
        endPeriod: Int = 2,
        startTime: String = "08:00",
        endTime: String = "09:40",
        weeks: [Int]
    ) -> WatchCourse {
        WatchCourse(
            id: id,
            name: id,
            teacher: nil,
            room: nil,
            campus: nil,
            weekday: weekday,
            startPeriod: startPeriod,
            endPeriod: endPeriod,
            startTime: startTime,
            endTime: endTime,
            weeks: weeks
        )
    }

    private func instant(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }

    func testEnvelopeRoundTripPreservesAuthoritativePeriods() throws {
        let value = fixture()
        XCTAssertEqual(try ScheduleEnvelope.decode(value.encoded()), value)
        XCTAssertEqual(value.displayPeriods.map(\.number), [1, 2, 3])
    }

    func testUnsupportedSchemaVersionIsRejected() throws {
        var json = try JSONSerialization.jsonObject(with: fixture().encoded()) as! [String: Any]
        json[ScheduleWireProtocol.Key.schemaVersion] = ScheduleWireProtocol.schemaVersion + 1
        let data = try JSONSerialization.data(withJSONObject: json)

        XCTAssertThrowsError(try ScheduleEnvelope.decode(data)) { error in
            XCTAssertEqual(error as? ScheduleFailure, .unsupportedVersion)
        }
    }

    func testInvalidPayloadDoesNotOverwriteValidCache() throws {
        let storage = MemoryScheduleStorage()
        let repository = CourseRepository(storage: storage)
        let original = fixture()
        try repository.accept(original.encoded())
        var json = try JSONSerialization.jsonObject(with: original.encoded()) as! [String: Any]
        json["timezone"] = "Not/A-Timezone"
        let invalid = try JSONSerialization.data(withJSONObject: json)

        XCTAssertThrowsError(try repository.accept(invalid))
        XCTAssertEqual(repository.snapshot, original)
        XCTAssertEqual(storage.writes, 1)
        XCTAssertEqual(repository.error, .invalidData)
    }

    func testContinuousOddEvenAndDiscreteWeeksRemainDistinct() {
        let snapshot = fixture(courses: [
            course(id: "continuous", weeks: [1, 2, 3, 4]),
            course(id: "odd", weeks: [1, 3]),
            course(id: "even", weeks: [2, 4]),
            course(id: "discrete", weeks: [1, 4]),
        ])
        let mondays = ["2025-12-29", "2026-01-05", "2026-01-12", "2026-01-19"]
            .compactMap(snapshot.date)

        XCTAssertEqual(Set(snapshot.courses(on: mondays[0]).map(\.id)), ["continuous", "odd", "discrete"])
        XCTAssertEqual(Set(snapshot.courses(on: mondays[1]).map(\.id)), ["continuous", "even"])
        XCTAssertEqual(Set(snapshot.courses(on: mondays[2]).map(\.id)), ["continuous", "odd"])
        XCTAssertEqual(Set(snapshot.courses(on: mondays[3]).map(\.id)), ["continuous", "even", "discrete"])
    }

    func testTodayCurrentAndNextCourseSelection() {
        let current = course(id: "current", weeks: [2])
        let next = course(
            id: "next",
            startPeriod: 3,
            endPeriod: 3,
            startTime: "09:55",
            endTime: "10:40",
            weeks: [2]
        )
        let snapshot = fixture(courses: [current, next])
        let now = instant("2026-01-05T00:10:00Z") // 08:10 in Asia/Shanghai.

        XCTAssertEqual(snapshot.courses(on: now).map(\.id), ["current", "next"])
        XCTAssertEqual(snapshot.currentCourse(at: now)?.id, "current")
        XCTAssertEqual(snapshot.nextCourseOccurrence(at: now)?.course.id, "next")
    }

    func testTimezoneMidnightMovesTeachingWeekAtLocalBoundary() {
        let beforeMidnight = instant("2026-01-04T15:59:00Z")
        let afterMidnight = instant("2026-01-04T16:00:00Z")

        XCTAssertEqual(ScheduleEnvelope.teachingWeek(
            at: beforeMidnight,
            semesterStart: "2025-12-29",
            semesterEnd: "2026-01-25",
            timezone: "Asia/Shanghai"
        ), 1)
        XCTAssertEqual(ScheduleEnvelope.teachingWeek(
            at: afterMidnight,
            semesterStart: "2025-12-29",
            semesterEnd: "2026-01-25",
            timezone: "Asia/Shanghai"
        ), 2)
    }

    func testEmptyTeacherAndRoomRoundTripAsNil() throws {
        let decoded = try ScheduleEnvelope.decode(fixture().encoded())
        XCTAssertNil(decoded.courses.first?.teacher)
        XCTAssertNil(decoded.courses.first?.room)
    }

    func testCacheWriteCanBeRestoredOnColdStart() throws {
        let storage = MemoryScheduleStorage()
        let original = fixture()
        try CourseRepository(storage: storage).accept(original.encoded())

        let restored = CourseRepository(storage: storage)

        XCTAssertEqual(restored.snapshot, original)
        XCTAssertNil(restored.error)
    }

    func testLegacyCacheWithoutPeriodsIsAcceptedAndReconstructed() throws {
        let legacy = fixture(includePeriods: false)
        let decoded = try ScheduleEnvelope.decode(legacy.encoded())

        XCTAssertNil(decoded.periods)
        XCTAssertEqual(decoded.displayPeriods.map(\.number), [1, 2])
        XCTAssertEqual(decoded.displayPeriods.first?.startTime, "08:00")
        XCTAssertEqual(decoded.displayPeriods.last?.endTime, "09:40")
    }

    func testInvalidOverlappingPeriodsAreRejected() throws {
        let value = fixture()
        var json = try JSONSerialization.jsonObject(with: value.encoded()) as! [String: Any]
        json["periods"] = [
            ["number": 1, "startTime": "08:00", "endTime": "08:45"],
            ["number": 2, "startTime": "08:40", "endTime": "09:40"],
        ]
        let data = try JSONSerialization.data(withJSONObject: json)
        XCTAssertThrowsError(try ScheduleEnvelope.decode(data))
    }

    func testDuplicateSnapshotsWriteAndPublishOnlyOnce() throws {
        let storage = MemoryScheduleStorage()
        let repository = CourseRepository(storage: storage)
        let transport = MockScheduleTransport()
        let coordinator = ScheduleSyncCoordinator(role: .watch, repository: repository, transport: transport)
        var changes = 0
        coordinator.onSnapshotChange = { changes += 1 }
        let data = try fixture().encoded()

        _ = try transport.onSnapshot?(data)
        _ = try transport.onSnapshot?(data)

        XCTAssertEqual(storage.writes, 1)
        XCTAssertEqual(changes, 1)
    }

    func testPhoneStartDoesNotSendUnverifiedCacheAndTrustedSnapshotUnlocksSending() throws {
        let repository = CourseRepository(storage: MemoryScheduleStorage())
        try repository.accept(fixture().encoded())
        let transport = MockScheduleTransport()
        let provider = MockScheduleProvider()
        let coordinator = ScheduleSyncCoordinator(role: .phone, repository: repository, transport: transport, provider: provider)

        coordinator.start()
        coordinator.start()

        XCTAssertEqual(transport.activations, 1)
        coordinator.foreground()
        transport.onConnectionChange?()
        coordinator.fail(.sourceUnavailable)
        XCTAssertTrue(transport.sent.isEmpty)
        XCTAssertNil(transport.statuses.last?.1)
        provider.onSnapshot?(try fixture().encoded())
        XCTAssertEqual(transport.sent.count, 1)
        coordinator.sendLatest()
        XCTAssertEqual(transport.sent.count, 1)
    }

    func testPhoneTransportFailureIsReportedWithoutDroppingCache() throws {
        let repository = CourseRepository(storage: MemoryScheduleStorage())
        let original = fixture()
        try repository.accept(original.encoded())
        let transport = MockScheduleTransport()
        transport.snapshotFailure = .syncFailed
        let provider = MockScheduleProvider()
        let coordinator = ScheduleSyncCoordinator(role: .phone, repository: repository, transport: transport, provider: provider)

        coordinator.start()
        provider.onSnapshot?(try original.encoded())

        XCTAssertEqual(coordinator.state(), .failed(.syncFailed))
        XCTAssertEqual(repository.snapshot, original)
        XCTAssertTrue(transport.sent.isEmpty)
    }

    func testWatchRefreshRequestFailureIsReported() {
        let repository = CourseRepository(storage: MemoryScheduleStorage())
        let transport = MockScheduleTransport()
        transport.refreshResult = .failure(.unavailable)
        let coordinator = ScheduleSyncCoordinator(role: .watch, repository: repository, transport: transport)
        coordinator.start()

        coordinator.refresh()

        XCTAssertEqual(coordinator.state(), .failed(.unavailable))
        XCTAssertFalse(coordinator.refreshing)
    }

    func testAccountChangeClearsPhoneCacheBeforePublishingLoginRequired() throws {
        let repository = CourseRepository(storage: MemoryScheduleStorage())
        try repository.accept(fixture().encoded())
        let transport = MockScheduleTransport()
        let coordinator = ScheduleSyncCoordinator(role: .phone, repository: repository, transport: transport)
        coordinator.start()

        coordinator.clearForAccountChange()

        XCTAssertNil(repository.snapshot)
        XCTAssertEqual(coordinator.state(), .loginRequired)
        XCTAssertEqual(transport.statuses.map(\.0), [.loginRequired])
        XCTAssertNil(transport.statuses.last?.1)
    }

    func testWatchClearEventRemovesCachedSnapshot() throws {
        let repository = CourseRepository(storage: MemoryScheduleStorage())
        try repository.accept(fixture().encoded())
        let transport = MockScheduleTransport()
        let coordinator = ScheduleSyncCoordinator(role: .watch, repository: repository, transport: transport)
        var changes = 0
        coordinator.onSnapshotChange = { changes += 1 }

        transport.onClear?()

        XCTAssertNil(repository.snapshot)
        XCTAssertEqual(changes, 1)
    }

    func testBackgroundTaskFinishesOnDrain() {
        let finisher = WatchConnectivityBackgroundTaskFinisher(timeout: .seconds(10))
        let task = MockBackgroundTask()
        finisher.append(task)

        finisher.completeIfReady(activated: true, hasContentPending: false)

        XCTAssertEqual(task.completions, 1)
        XCTAssertNil(task.expirationHandler)
        XCTAssertEqual(finisher.pendingCount, 0)
    }

    func testBackgroundTaskExpirationFinishesPendingWork() async {
        let finisher = WatchConnectivityBackgroundTaskFinisher(timeout: .seconds(10))
        let first = MockBackgroundTask()
        let second = MockBackgroundTask()
        finisher.append(first)
        finisher.append(second)

        first.expirationHandler?()
        await Task.yield()

        XCTAssertEqual(first.completions, 1)
        XCTAssertEqual(second.completions, 1)
        XCTAssertEqual(finisher.pendingCount, 0)
    }

    func testBackgroundTaskTimeoutFinishesPendingWork() async throws {
        let finisher = WatchConnectivityBackgroundTaskFinisher(timeout: .milliseconds(10))
        let task = MockBackgroundTask()
        finisher.append(task)

        try await Task.sleep(for: .milliseconds(50))

        XCTAssertEqual(task.completions, 1)
        XCTAssertEqual(finisher.pendingCount, 0)
    }
}
