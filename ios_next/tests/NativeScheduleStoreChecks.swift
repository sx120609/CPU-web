import Foundation

/// Run with swiftc alongside NativeScheduleStore.swift; no school account is required.
@main
struct NativeScheduleStoreChecks {
    @MainActor
    static func main() async throws {
        let raw = #"{"version":1,"source":"jwxt","fetchedAt":1788739200000,"auth":{"authenticated":true},"data":{"currentSemester":"fall","currentWeek":3,"cells":[]},"calendar":{"currentWeek":"3","weeks":[]}}"#
        let decoded = try JSONDecoder().decode(NativeScheduleSnapshot.self, from: Data(raw.utf8))
        precondition(!decoded.completeSemester, "Old bridges without a scope marker remain week-scoped")
        precondition(decoded.data?.currentWeek == "3")
        precondition(decoded.calendar?.currentWeek == 3)
        precondition(abs(decoded.fetchedAt!.timeIntervalSince1970 - 1_788_739_200) < 1)

        func snapshot() -> NativeScheduleSnapshot {
            NativeScheduleSnapshot(source: .graduate, fetchedAt: .now,
                data: NativeScheduleResult(currentSemester: "fall", currentWeek: "3",
                    cells: [NativeScheduleCell(day: 1, bigSlot: 1, courses: [NativeScheduleCourse(name: "药理学")])]),
                calendar: NativeScheduleCalendar(currentWeek: 3), auth: NativeScheduleAuth(authenticated: true))
        }
        var calls = 0
        let store = NativeScheduleStore(loader: { _ in calls += 1; return snapshot() })
        await store.load(semester: "fall", week: "8")
        precondition(store.selectedWeek == "8", "Graduate payload currentWeek must not replace the selected week")
        await store.selectWeek("9")
        await store.selectWeek("8")
        precondition(store.selectedWeek == "8", "Cache hits must preserve selected week")
        precondition(calls == 2, "Returning to a cached week must not fetch")
        precondition(store.restoreCachedSelection())
        await store.refresh()
        precondition(calls == 3, "Explicit refresh must fetch")
        store.handleAuthChanged()
        precondition(!store.restoreCachedSelection(), "Account changes must invalidate cache")
        precondition(store.result == nil && store.calendar == nil && store.state == .idle)

        var semesterCalls = 0
        let semesterStore = NativeScheduleStore(loader: { _ in
            semesterCalls += 1
            return NativeScheduleSnapshot(completeSemester: true, source: .jwxt, fetchedAt: .now,
                data: snapshot().data, auth: NativeScheduleAuth(authenticated: true))
        })
        await semesterStore.load()
        await semesterStore.selectWeek("12")
        await semesterStore.selectWeek("2")
        precondition(semesterCalls == 1 && semesterStore.selectedWeek == "2", "Complete semester must serve unvisited weeks locally")
        await semesterStore.refresh()
        await semesterStore.selectWeek("12")
        precondition(semesterCalls == 2, "Refresh replaces the complete semester cache")

        var adjacentCalls = 0
        let adjacentStore = NativeScheduleStore(loader: { _ in adjacentCalls += 1; return snapshot() })
        await adjacentStore.load(semester: "fall", week: "3")
        let nextWeek = NativeScheduleSnapshot(source: .jwxt, fetchedAt: .now,
            data: NativeScheduleResult(currentSemester: "fall", currentWeek: "4",
                cells: [NativeScheduleCell(day: 2, bigSlot: 1, courses: [NativeScheduleCourse(name: "下周实验")])]),
            auth: NativeScheduleAuth(authenticated: true))
        adjacentStore.receivePrefetchedSnapshot(nextWeek)
        precondition(adjacentStore.selectedWeek == "3" && adjacentStore.state == .loaded,
                     "Prewarming must not change the visible week or show a spinner")
        await adjacentStore.selectWeek("4")
        precondition(adjacentCalls == 1 && adjacentStore.state == .loaded,
                     "A prewarmed next week must be served locally without a bridge data request")
        precondition(adjacentStore.result?.cells.first?.courses.first?.name == "下周实验")
        adjacentStore.reset()
        adjacentStore.receivePrefetchedSnapshot(nextWeek)
        adjacentStore.selectedSemester = "fall"
        adjacentStore.selectedWeek = "4"
        precondition(!adjacentStore.restoreCachedSelection(), "Late weekly prefetch cannot restore logged-out data")

        let prefetchStore = NativeScheduleStore(loader: { _ in snapshot() })
        await prefetchStore.load(semester: "fall", week: "3")
        let whole = NativeScheduleSnapshot(completeSemester: true, source: .jwxt, fetchedAt: .now,
            data: snapshot().data, auth: NativeScheduleAuth(authenticated: true))
        prefetchStore.receivePrefetchedSnapshot(whole)
        precondition(prefetchStore.selectedWeek == "3", "Background completion must preserve selection")
        await prefetchStore.selectWeek("15")
        precondition(prefetchStore.restoreCachedSelection(), "Pushed semester serves unseen weeks")
        prefetchStore.reset()
        prefetchStore.receivePrefetchedSnapshot(whole)
        prefetchStore.selectedSemester = "fall"
        prefetchStore.selectedWeek = "15"
        precondition(!prefetchStore.restoreCachedSelection(), "A late prefetch must not repopulate a logged-out cache")

        var authorized = true
        let authStore = NativeScheduleStore(loader: { _ in
            authorized ? snapshot() : NativeScheduleSnapshot(auth: NativeScheduleAuth(authenticated: false))
        })
        await authStore.load()
        authorized = false
        await authStore.refresh()
        precondition(authStore.state == .unauthorized && authStore.result == nil, "Expired auth must clear sensitive records")

        var pending: CheckedContinuation<NativeScheduleSnapshot, Never>?
        let raceStore = NativeScheduleStore(loader: { request in
            if request.week == "9" {
                return await withCheckedContinuation { pending = $0 }
            }
            return snapshot()
        })
        await raceStore.load(semester: "fall", week: "8")
        let slow = Task { await raceStore.selectWeek("9") }
        while pending == nil { await Task.yield() }
        await raceStore.selectWeek("8")
        pending?.resume(returning: snapshot())
        await slow.value
        precondition(raceStore.selectedWeek == "8", "A late request must not overwrite a subsequent cache hit")

        var fail = false
        let failedStore = NativeScheduleStore(loader: { _ in
            if fail { throw NativeScheduleStoreError.server("offline") }
            return snapshot()
        })
        await failedStore.load(semester: "fall", week: "8")
        fail = true
        await failedStore.selectWeek("9")
        precondition(failedStore.state == .failed && failedStore.result == nil, "Never show another week's courses under a failed week")
        // Cold start: the last timetable is shown again only while the same
        // signed-in web session is still present.
        final class MemoryArchive: NativeScheduleArchive {
            var data: Data?
            func read() -> NativeScheduleArchivedSchedule? {
                guard let data else { return nil }
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .iso8601
                return try? decoder.decode(NativeScheduleArchivedSchedule.self, from: data)
            }
            func write(_ record: NativeScheduleArchivedSchedule) {
                let encoder = JSONEncoder()
                encoder.dateEncodingStrategy = .iso8601
                data = try? encoder.encode(record)
            }
            func removeAll() { data = nil }
        }
        func accountSnapshot(_ account: String?) -> NativeScheduleSnapshot {
            NativeScheduleSnapshot(completeSemester: true, source: .jwxt, fetchedAt: .now,
                data: snapshot().data, calendar: NativeScheduleCalendar(currentWeek: 3),
                auth: NativeScheduleAuth(authenticated: true, identity: "undergraduate", account: account))
        }
        func settle() async { for _ in 0..<10 { await Task.yield() } }

        // A web build without an account fingerprint still gets a warm start.
        let archive = MemoryArchive()
        let firstRun = NativeScheduleStore(loader: { _ in accountSnapshot(nil) }, archive: archive)
        firstRun.sessionFingerprint = { "s1111" }
        await firstRun.load(semester: "fall", week: "3")
        await settle()
        precondition(archive.data != nil, "A displayed timetable must survive the next launch")

        var relaunchCalls = 0
        let relaunch = NativeScheduleStore(loader: { _ in relaunchCalls += 1; return accountSnapshot(nil) },
                                           archive: archive)
        relaunch.sessionFingerprint = { "s1111" }
        precondition(!relaunch.restoreCachedSelection(), "Memory starts empty after a relaunch")
        let relaunchRestored = await relaunch.restoreArchivedSelection()
        precondition(relaunchRestored, "A cold start must show the archived timetable")
        precondition(relaunch.state == .stale && relaunch.result?.cells.first?.courses.first?.name == "药理学")
        precondition(relaunch.selectedSemester == "fall" && relaunch.selectedWeek == "3")
        precondition(relaunchCalls == 0, "Restoring must not wait for the bridge")
        relaunch.handleAuthChanged()
        await settle()
        precondition(relaunch.result != nil && archive.data != nil,
                     "The same session finishing its restore must not blank the timetable")
        await relaunch.load(force: true)
        precondition(relaunchCalls == 1 && relaunch.state == .loaded, "The restored view refreshes silently")

        // A different session, including a signed-out one, never sees it.
        let strangerArchive = MemoryArchive()
        let stranger = NativeScheduleStore(loader: { _ in accountSnapshot(nil) }, archive: strangerArchive)
        stranger.sessionFingerprint = { "s1111" }
        await stranger.load(semester: "fall", week: "3")
        await settle()
        let otherSession = NativeScheduleStore(loader: { _ in accountSnapshot(nil) }, archive: strangerArchive)
        otherSession.sessionFingerprint = { "s2222" }
        let otherRestored = await otherSession.restoreArchivedSelection()
        precondition(!otherRestored && strangerArchive.data == nil,
                     "Another session must never see the archived timetable")

        let signedOutArchive = MemoryArchive()
        let signedOutOwner = NativeScheduleStore(loader: { _ in accountSnapshot(nil) }, archive: signedOutArchive)
        signedOutOwner.sessionFingerprint = { "s1111" }
        await signedOutOwner.load(semester: "fall", week: "3")
        await settle()
        let signedOut = NativeScheduleStore(loader: { _ in accountSnapshot(nil) }, archive: signedOutArchive)
        signedOut.sessionFingerprint = { nil }
        let signedOutRestored = await signedOut.restoreArchivedSelection()
        precondition(!signedOutRestored && signedOutArchive.data == nil,
                     "A signed-out launch must drop the archive")

        // An account fingerprint, once the web sends one, wins immediately.
        let accountArchive = MemoryArchive()
        let accountStore = NativeScheduleStore(loader: { _ in accountSnapshot("a1b2c3d4") }, archive: accountArchive)
        accountStore.sessionFingerprint = { "s1111" }
        await accountStore.load(semester: "fall", week: "3")
        await settle()
        precondition(accountArchive.read()?.account == "a1b2c3d4")
        accountStore.handleAuthChanged(account: "a1b2c3d4")
        precondition(accountStore.result != nil && accountArchive.data != nil,
                     "The same account finishing its session must not blank the timetable")
        accountStore.handleAuthChanged(account: "ffffffff")
        precondition(accountStore.result == nil && accountArchive.data == nil, "Another account erases the archive")

        // An expired 教务 authorization must not blank a timetable that is
        // already on screen while the same web session is still signed in.
        var jwxtAuthorized = true
        let expiryArchive = MemoryArchive()
        var liveSession: String? = "s1111"
        let expiry = NativeScheduleStore(loader: { _ in
            jwxtAuthorized ? accountSnapshot(nil) : NativeScheduleSnapshot(auth: NativeScheduleAuth(authenticated: false))
        }, archive: expiryArchive)
        expiry.sessionFingerprint = { liveSession }
        await expiry.load(semester: "fall", week: "3")
        await settle()
        jwxtAuthorized = false
        await expiry.refresh()
        await settle()
        precondition(expiry.state == .unauthorized && expiry.result != nil,
                     "A lost 教务 authorization keeps the timetable under a banner")
        // Signing out of the site clears it on the next unauthorized answer.
        liveSession = nil
        await expiry.refresh()
        await settle()
        precondition(expiry.result == nil && expiryArchive.data == nil,
                     "Signing out clears the timetable and the archive")

        let expiredArchive = MemoryArchive()
        let expiredOwner = NativeScheduleStore(loader: { _ in accountSnapshot(nil) }, archive: expiredArchive)
        expiredOwner.sessionFingerprint = { "s1111" }
        await expiredOwner.load(semester: "fall", week: "3")
        await settle()
        let expired = NativeScheduleStore(loader: { _ in accountSnapshot(nil) },
                                          cacheLifetime: 0, archive: expiredArchive)
        expired.sessionFingerprint = { "s1111" }
        let expiredRestored = await expired.restoreArchivedSelection()
        precondition(!expiredRestored && expiredArchive.data == nil,
                     "A stale archive is dropped, not shown")

        print("Native schedule checks passed: decoding, selection, cache, auth, races, failed-week isolation, cold start")
    }
}
