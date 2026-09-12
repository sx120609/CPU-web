import Foundation
import XCTest
@testable import WatchScheduleCore

@MainActor
private final class MemoryScheduleStorage: ScheduleStorage {
    var data: Data?
    private(set) var writes = 0

    func read() throws -> Data? { data }
    func write(_ data: Data) throws {
        self.data = data
        writes += 1
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

    func activate() {
        activations += 1
        onConnectionChange?()
    }
    func updateSnapshot(_ data: Data) throws { sent.append(data) }
    func updateStatus(_ failure: ScheduleFailure, snapshot: Data?) throws {
        statuses.append((failure, snapshot))
    }
    func requestRefresh(completion: @escaping (Result<Void, ScheduleFailure>) -> Void) {
        completion(.success(()))
    }
}

@MainActor
private final class MockBackgroundTask: WatchBackgroundTaskCompleting {
    var expirationHandler: (() -> Void)?
    private(set) var completions = 0
    func completeWithoutSnapshot() { completions += 1 }
}

@MainActor
final class WatchScheduleCoreTests: XCTestCase {
    private func fixture(generatedAt: Date? = nil) -> ScheduleEnvelope {
        ScheduleEnvelope(
            schemaVersion: 1,
            messageType: "schedule.snapshot",
            generatedAt: generatedAt ?? instant("2026-01-05T00:00:00Z"),
            semester: ScheduleSemester(
                id: "fixture-semester",
                startDate: "2025-12-29",
                endDate: "2026-01-18",
                weekCount: 3
            ),
            timezone: "Asia/Shanghai",
            currentWeek: 2,
            coveredWeeks: [1, 2, 3],
            periods: [
                SchedulePeriod(number: 1, startTime: "08:00", endTime: "08:45"),
                SchedulePeriod(number: 2, startTime: "08:55", endTime: "09:40"),
            ],
            courses: [
                WatchCourse(
                    id: "course-1", name: "测试课程", teacher: nil, room: nil, campus: nil,
                    weekday: 1, startPeriod: 1, endPeriod: 2,
                    startTime: "08:00", endTime: "09:40", weeks: [1, 2, 3]
                ),
            ]
        )
    }

    private func instant(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }

    func testEnvelopeRoundTripPreservesAuthoritativePeriods() throws {
        let value = fixture()
        XCTAssertEqual(try ScheduleEnvelope.decode(value.encoded()), value)
        XCTAssertEqual(value.displayPeriods.map(\.number), [1, 2])
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

    func testPhoneStartIsIdempotentAndQueuesOneSnapshot() throws {
        let repository = CourseRepository(storage: MemoryScheduleStorage())
        try repository.accept(fixture().encoded())
        let transport = MockScheduleTransport()
        let coordinator = ScheduleSyncCoordinator(role: .phone, repository: repository, transport: transport)

        coordinator.start()
        coordinator.start()

        XCTAssertEqual(transport.activations, 1)
        XCTAssertEqual(transport.sent.count, 1)
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
