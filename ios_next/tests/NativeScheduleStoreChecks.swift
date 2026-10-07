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
        precondition(decoded.periods.count == 12,
                     "An older deployed bridge without periods must receive the bundled timetable")
        precondition(decoded.periods.first?.number == 1
                     && decoded.periods.first?.startTime == "08:00"
                     && decoded.periods.last?.number == 12
                     && decoded.periods.last?.endTime == "22:00",
                     "The bundled period table must match the existing web schedule")
        let finalSlot = NativeSchedulePeriod.normalizedRange(
            bigSlot: 6,
            startSlot: 12,
            endSlot: 12,
            periods: decoded.periods
        )
        precondition(finalSlot.start == 12 && finalSlot.end == 12,
                     "The twelfth slot must not be truncated to the eleventh")

        let eveningRange = NativeSchedulePeriod.normalizedRange(
            bigSlot: 6, startSlot: nil, endSlot: nil, periods: decoded.periods
        )
        precondition(eveningRange.start == 11 && eveningRange.end == 12,
                     "The sixth big slot spans periods eleven and twelve")

        let legacyWeeks = #"{"version":1,"source":"jwxt","auth":{"authenticated":true},"data":{"currentSemester":"fall","weeks":[{"value":"1","label":"第 1 周"},{"value":"2","label":"第 2 周"}],"currentWeek":"","cells":[]},"calendar":{"currentWeek":0,"weeks":[{"week":1},{"week":2}]}}"#
        let legacyDecoded = try JSONDecoder().decode(NativeScheduleSnapshot.self, from: Data(legacyWeeks.utf8))
        precondition(legacyDecoded.data?.currentWeek == "1" && legacyDecoded.data?.weeks.first?.current == true,
                     "Legacy schedules without a current marker must select the first week")
        precondition(legacyDecoded.calendar?.currentWeek == 1,
                     "Legacy calendars without a current week must fall back to their first week")

        let duplicateCourse = NativeScheduleCourse(
            nativeId: "official|2025-2026-2|3|3|药理学实验",
            name: "药理学实验",
            teacher: "张老师",
            weeks: "1-8周",
            weekList: Array(1...8),
            location: "实验楼(201)",
            startSlot: 3,
            endSlot: 4
        )
        let duplicateSubset = NativeScheduleCourse(
            nativeId: "official|2025-2026-2|3|3|药理学实验",
            name: "药理学实验",
            teacher: "张老师",
            weeks: "2、4、6、8周",
            weekList: [2, 4, 6, 8],
            location: "201",
            startSlot: 3,
            endSlot: 3,
            sourceKey: "jwxt-record-b"
        )
        let distinctTeacher = NativeScheduleCourse(
            name: "药理学实验",
            teacher: "李老师",
            weeks: "1-8周",
            weekList: Array(1...8),
            location: "实验楼 201",
            startSlot: 3,
            endSlot: 4
        )
        let adjacentClass = NativeScheduleCourse(
            name: "药理学实验",
            teacher: "张老师",
            weeks: "1-8周",
            weekList: Array(1...8),
            location: "实验楼 201",
            startSlot: 5,
            endSlot: 6
        )
        let formattedDuplicate = NativeScheduleCourse(
            name: "药理学实验",
            teacher: "张 老师",
            weeks: "2、4、6、8周",
            weekList: [2, 4, 6, 8],
            location: "实验楼201",
            startSlot: 3,
            endSlot: 3,
            sourceKey: "jwxt-record-c"
        )
        let mergedCourses = NativeScheduleCourseBlockMerger.merge([
            NativeScheduleCourseBlockRecord(id: "a", course: duplicateCourse, bigSlot: 2, startSlot: 3, endSlot: 4),
            NativeScheduleCourseBlockRecord(id: "b", course: duplicateSubset, bigSlot: 2, startSlot: 3, endSlot: 3),
            // JWXT can repeat the same explicit 03-04 range under a physical
            // neighbouring big-slot row. The renderer must keep that range
            // intact so the records overlap and collapse into one card.
            NativeScheduleCourseBlockRecord(id: "a-row-1", course: duplicateCourse, bigSlot: 1, startSlot: 3, endSlot: 4),
            NativeScheduleCourseBlockRecord(id: "c", course: distinctTeacher, bigSlot: 2, startSlot: 3, endSlot: 4),
            NativeScheduleCourseBlockRecord(id: "d", course: adjacentClass, bigSlot: 3, startSlot: 5, endSlot: 6),
            NativeScheduleCourseBlockRecord(id: "e", course: formattedDuplicate, bigSlot: 2, startSlot: 3, endSlot: 3),
        ])
        precondition(mergedCourses.count == 3,
                     "Repeated records in one timetable position must collapse without hiding another teacher")
        precondition(mergedCourses.first(where: { $0.course.teacher == "张老师" })?.course.weekList == Array(1...8),
                     "Merging duplicate records must retain the complete week list")
        precondition(mergedCourses.contains(where: { $0.startSlot == 5 && $0.endSlot == 6 }),
                     "Adjacent classes with the same display text must remain separate")

        let parallelA = NativeScheduleCourse(
            nativeId: "custom:parallel-a",
            name: "同名课程",
            teacher: "同一教师",
            weeks: "1-8周",
            weekList: Array(1...8),
            location: "同一教室",
            startSlot: 1,
            endSlot: 2
        )
        let parallelB = NativeScheduleCourse(
            nativeId: "custom:parallel-b",
            name: "同名课程",
            teacher: "同一教师",
            weeks: "1-8周",
            weekList: Array(1...8),
            location: "同一教室",
            startSlot: 1,
            endSlot: 2
        )
        let parallelCourses = NativeScheduleCourseBlockMerger.merge([
            NativeScheduleCourseBlockRecord(id: "parallel-a", course: parallelA, bigSlot: 1, startSlot: 1, endSlot: 2),
            NativeScheduleCourseBlockRecord(id: "parallel-b", course: parallelB, bigSlot: 1, startSlot: 1, endSlot: 2),
        ])
        precondition(parallelCourses.count == 1,
                     "Indistinguishable custom rows must collapse even when ids differ")

        let officialParallelA = NativeScheduleCourse(
            nativeId: "source:jwxt:data-jxbid:section-a",
            name: "同名教务课程",
            teacher: "同一教师",
            weeks: "1-8周",
            weekList: Array(1...8),
            location: "同一教室",
            startSlot: 1,
            endSlot: 2
        )
        let officialParallelB = NativeScheduleCourse(
            nativeId: "source:jwxt:data-jxbid:section-b",
            name: "同名教务课程",
            teacher: "同一教师",
            weeks: "1-8周",
            weekList: Array(1...8),
            location: "同一教室",
            startSlot: 1,
            endSlot: 2
        )
        let officialParallelCourses = NativeScheduleCourseBlockMerger.merge([
            NativeScheduleCourseBlockRecord(id: "official-a", course: officialParallelA, bigSlot: 1, startSlot: 1, endSlot: 2),
            NativeScheduleCourseBlockRecord(id: "official-b", course: officialParallelB, bigSlot: 1, startSlot: 1, endSlot: 2),
        ])
        precondition(officialParallelCourses.count == 1,
                     "Indistinguishable official rows must collapse even when ids differ")

        let repeatedRowA = NativeScheduleCourse(
            nativeId: "source:jwxt:data-jxbid:row-a",
            name: "重复行课程",
            teacher: "张老师",
            weeks: "1-8周",
            weekList: Array(1...8),
            location: "实验楼201",
            startSlot: 3,
            endSlot: 4
        )
        let repeatedRowB = NativeScheduleCourse(
            nativeId: "source:jwxt:data-jxbid:row-b",
            name: "重复行课程",
            teacher: "张",
            weeks: "2、4、6、8周",
            weekList: [2, 4, 6, 8],
            location: "201",
            startSlot: 3,
            endSlot: 4
        )
        let repeatedRows = NativeScheduleCourseBlockMerger.merge([
            NativeScheduleCourseBlockRecord(id: "row-a", course: repeatedRowA, bigSlot: 2, startSlot: 3, endSlot: 4),
            NativeScheduleCourseBlockRecord(id: "row-b", course: repeatedRowB, bigSlot: 2, startSlot: 3, endSlot: 4),
        ])
        precondition(repeatedRows.count == 1 && repeatedRows[0].course.weekList == Array(1...8),
                     "Repeated rows with different explicit ids must collapse when one range is a subset")

        let cancelledStore = NativeScheduleStore(
            loader: { _ in NativeScheduleSnapshot(cancelled: true) },
            archive: nil
        )
        await cancelledStore.load(semester: "fall", week: "1")
        precondition(cancelledStore.state == .idle && cancelledStore.errorMessage == nil,
                     "A superseded request must not become a visible loading error")

        func snapshot() -> NativeScheduleSnapshot {
            NativeScheduleSnapshot(source: .graduate, fetchedAt: .now,
                data: NativeScheduleResult(currentSemester: "fall", currentWeek: "3",
                    cells: [NativeScheduleCell(day: 1, bigSlot: 1, courses: [NativeScheduleCourse(name: "药理学")])]),
                calendar: NativeScheduleCalendar(currentWeek: 3), auth: NativeScheduleAuth(authenticated: true))
        }
        var calls = 0
        let store = NativeScheduleStore(loader: { _ in calls += 1; return snapshot() })
        var watchSnapshots = 0
        var watchResets = 0
        store.onWatchSnapshot = { _ in watchSnapshots += 1 }
        store.onWatchReset = { watchResets += 1 }
        await store.load(semester: "fall", week: "8")
        precondition(store.selectedWeek == "8", "Graduate payload currentWeek must not replace the selected week")
        await store.selectWeek("9")
        await store.selectWeek("8")
        precondition(store.selectedWeek == "8", "Cache hits must preserve selected week")
        precondition(calls == 2, "Returning to a cached week must not fetch")
        precondition(watchSnapshots == 3, "A cached selection must still publish to an already-connected Watch bridge")
        precondition(store.restoreCachedSelection())
        await store.refresh()
        precondition(calls == 3, "Explicit refresh must fetch")
        store.handleAuthChanged()
        precondition(!store.restoreCachedSelection(), "Account changes must invalidate cache")
        precondition(store.result == nil && store.calendar == nil && store.state == .idle)
        precondition(watchResets == 1, "Account changes must clear the independently persisted Watch cache")

        let timedCourses = ["20:20", "21:15"].enumerated().map { index, time in
            NativeScheduleCourseBlockRecord(
                id: "timed-\(index)",
                course: NativeScheduleCourse(nativeId: "source:timed-\(index)",
                    customStartTime: time, customEndTime: "22:00", name: "晚间实验",
                    weeks: "1周", weekList: [1], startSlot: 11, endSlot: 12),
                bigSlot: 6, startSlot: 11, endSlot: 12)
        }
        precondition(NativeScheduleCourseBlockMerger.merge(timedCourses).count == 2,
                     "Different custom clock times must remain independent events")

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
        precondition(authStore.state == .stale && authStore.result != nil,
                     "Expired education authorization keeps the last valid timetable visible")
        authStore.handleAuthChanged()
        precondition(authStore.result == nil, "A confirmed site-account logout still clears the timetable")

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

        // A historical semester can be rejected by the upstream system with
        // a response for the current semester. The visible timetable and its
        // selector must survive that failure so another term can be chosen.
        let semesterSwitchStore = NativeScheduleStore(loader: { request in
            if request.semester == "old" {
                return NativeScheduleSnapshot(
                    auth: NativeScheduleAuth(authenticated: true),
                    error: "教务系统返回了其他学期的课表"
                )
            }
            let semester = request.semester ?? "fall"
            return NativeScheduleSnapshot(
                completeSemester: true,
                source: .jwxt,
                fetchedAt: .now,
                data: NativeScheduleResult(
                    currentSemester: semester,
                    currentWeek: "1",
                    cells: [NativeScheduleCell(day: 1, bigSlot: 1,
                        courses: [NativeScheduleCourse(name: semester)])]
                ),
                auth: NativeScheduleAuth(authenticated: true)
            )
        })
        await semesterSwitchStore.load(semester: "fall", week: "1")
        await semesterSwitchStore.selectSemester("old")
        precondition(semesterSwitchStore.result != nil
                     && semesterSwitchStore.selectedSemester == "fall"
                     && semesterSwitchStore.state == .stale,
                     "A rejected semester must restore the visible selection")
        await semesterSwitchStore.selectSemester("spring")
        precondition(semesterSwitchStore.selectedSemester == "spring"
                     && semesterSwitchStore.result?.currentSemester == "spring"
                     && semesterSwitchStore.state == .loaded,
                     "A later semester selection must still be accepted")

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
        precondition(expiry.state == .stale && expiry.result != nil,
                     "A lost 教务 authorization keeps the timetable without clearing it")
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
        precondition(expiredRestored && expiredArchive.data != nil && expired.state == .stale,
                     "A stale same-session archive remains visible for offline launch while revalidation runs")

        // The animated week pager swaps the page and recentres its track in one
        // transaction, so the selection has to land without awaiting the fetch.
        var pagerCalls = 0
        let pager = NativeScheduleStore(loader: { _ in pagerCalls += 1; return snapshot() })
        await pager.load(semester: "fall", week: "3")
        let callsBeforeCommit = pagerCalls
        pager.commitWeekSelection("4")
        precondition(pager.selectedWeek == "4", "Committing a week is visible before the refresh runs")
        pager.commitWeekSelection("4")
        await settle()
        precondition(pagerCalls == callsBeforeCommit + 1,
                     "Re-committing the displayed week must not fetch again")

        // Official timetable changes are paired by course name and reported
        // with the same field-level wording as Web's change notice.
        var changeRefresh = 0
        let changeStore = NativeScheduleStore(loader: { _ in
            changeRefresh += 1
            let changed = changeRefresh > 1
            let course = NativeScheduleCourse(
                name: "药理学",
                teacher: changed ? "李老师" : "张老师",
                weeks: changed ? "1-8周(双)" : "1-8周(单)",
                location: changed ? "B 教室" : "A 教室",
                slotNote: changed ? "实验" : nil
            )
            return NativeScheduleSnapshot(
                source: .jwxt,
                fetchedAt: Date(timeIntervalSince1970: Double(100 + changeRefresh)),
                data: NativeScheduleResult(
                    weeks: (1...8).map { NativeScheduleWeek(value: String($0), label: "第 \($0) 周") },
                    currentSemester: "fall",
                    currentWeek: "1",
                    cells: [NativeScheduleCell(
                        day: changed ? 2 : 1,
                        bigSlot: changed ? 2 : 1,
                        courses: [course]
                    )]
                ),
                auth: NativeScheduleAuth(authenticated: true)
            )
        })
        await changeStore.load(semester: "fall", week: "1")
        await changeStore.refresh()
        precondition(changeStore.scheduleChangeNotice?.changedCount == 1)
        precondition(changeStore.scheduleChangeNotice?.details == [
            "调整：药理学：时间 周一 1-2节 → 周二 3-4节；周次 1-8周(单) → 1-8周(双)；地点 A 教室 → B 教室；教师 张老师 → 李老师；备注 无 → 实验"
        ], "Course changes must include the changed fields")

        // A merged block draws its periods and keeps the note the course arrived with.
        let lab = { (note: String?) in
            NativeScheduleCourse(name: "连续实验", teacher: "教师", weeks: "2周", weekList: [2], location: "B311", slotNote: note,
                                 sourceKey: "jwxt-lab")
        }
        let mergedLab = NativeScheduleCourseBlockMerger.merge([
            NativeScheduleCourseBlockRecord(id: "a", course: lab("01-02节"), bigSlot: 1, startSlot: 1, endSlot: 2),
            NativeScheduleCourseBlockRecord(id: "b", course: lab("带实验报告"), bigSlot: 2, startSlot: 3, endSlot: 4),
        ])
        precondition(mergedLab.count == 1 && mergedLab[0].course.slotNote == "01-04节",
                     "Adjacent rows of one official course merge into one block labelled with its periods")
        precondition(mergedLab[0].course.sourceNote == "带实验报告" && mergedLab[0].course.editableNote == "带实验报告",
                     "The half that carries a written note wins over the other half's period label")
        for label in ["06-07节", "6节", "第 6-7 节", "第6节", " 第 6 - 7 节 "] {
            precondition(NativeScheduleCourse(name: "x", slotNote: label).editableNote == nil,
                         "A generated period label is not a note: \(label)")
        }
        for note in ["第 6-7 节在实验楼", "06-07节后答疑", "带书"] {
            precondition(NativeScheduleCourse(name: "x", slotNote: note).editableNote == note,
                         "A written note is kept: \(note)")
        }
        let plainBlock = NativeScheduleCourseBlockMerger.merge([
            NativeScheduleCourseBlockRecord(id: "c", course: lab("第 5-6 节"), bigSlot: 3, startSlot: 5, endSlot: 6),
        ])
        precondition(plainBlock[0].course.slotNote == "05-06节" && plainBlock[0].course.editableNote == nil,
                     "A course saved with an empty note has none after merging")
        let stored = try JSONEncoder().encode(mergedLab[0].course)
        precondition(!String(decoding: stored, as: UTF8.self).contains("sourceNote"),
                     "The kept note stays out of the stored course")

        print("Native schedule checks passed: decoding, selection, cache, auth, races, failed-week isolation, cold start, week paging, course notes")
    }
}
