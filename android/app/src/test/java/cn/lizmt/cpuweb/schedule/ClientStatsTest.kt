package cn.lizmt.cpuweb.schedule

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ClientStatsTest {
    @get:Rule
    val folder = TemporaryFolder()

    @Test
    fun datesFollowBeijingTime() {
        // 2026-10-06 16:30 UTC is already the 7th in Beijing.
        val millis = 1_791_304_200_000L
        assertEquals("2026-10-07", ClientStatsLogic.dateKey(millis))
        assertEquals("2026-10-07T00:30:00.000+08:00", ClientStatsLogic.isoTime(millis))
    }

    @Test
    fun exitReasonsFollowThePlatformConstants() {
        assertEquals("crash", ClientStatsLogic.exitReasonName(android.app.ApplicationExitInfo.REASON_CRASH))
        assertEquals("crashNative", ClientStatsLogic.exitReasonName(android.app.ApplicationExitInfo.REASON_CRASH_NATIVE))
        assertEquals("anr", ClientStatsLogic.exitReasonName(android.app.ApplicationExitInfo.REASON_ANR))
        assertEquals("lowMemory", ClientStatsLogic.exitReasonName(android.app.ApplicationExitInfo.REASON_LOW_MEMORY))
        assertEquals("signaled", ClientStatsLogic.exitReasonName(android.app.ApplicationExitInfo.REASON_SIGNALED))
        assertEquals("userRequested", ClientStatsLogic.exitReasonName(android.app.ApplicationExitInfo.REASON_USER_REQUESTED))
        assertEquals("other", ClientStatsLogic.exitReasonName(99))
        assertEquals("other", ClientStatsLogic.exitReasonName(-1))
    }

    @Test
    fun theProcessSummaryCarriesTheVersion() {
        assertEquals("4.0.15" to "56", ClientStatsLogic.parseVersionSummary(ClientStatsLogic.versionSummary("4.0.15", "56")))
        assertNull(ClientStatsLogic.parseVersionSummary(null))
        assertNull(ClientStatsLogic.parseVersionSummary(ByteArray(0)))
        assertNull(ClientStatsLogic.parseVersionSummary("4.0.15".toByteArray()))
        assertNull(ClientStatsLogic.parseVersionSummary("|56".toByteArray()))
    }

    @Test
    fun aDayIsSentOnlyOnceItIsOver() {
        val buckets = JSONObject()
        ClientStatsLogic.addLaunch(buckets, "2026-10-06", "4.0.15", "56", 600)
        ClientStatsLogic.addLaunch(buckets, "2026-10-06", "4.0.15", "56", 1000)
        ClientStatsLogic.addLaunch(buckets, "2026-10-06", "4.0.15", "56", 0)
        ClientStatsLogic.addLaunch(buckets, "2026-10-06", "4.0.15", "56", ClientStatsLogic.MAX_LAUNCH_MS + 1)
        ClientStatsLogic.addRendererLoss(buckets, "2026-10-06", "4.0.15", "56", crashed = true)
        ClientStatsLogic.addRendererLoss(buckets, "2026-10-06", "4.0.15", "56", crashed = false)
        ClientStatsLogic.addRendererLoss(buckets, "2026-10-06", "4.0.15", "56", crashed = false)
        ClientStatsLogic.addExit(buckets, "2026-10-06", "4.0.14", "55", "crash", foreground = true)
        ClientStatsLogic.addExit(buckets, "2026-10-06", "4.0.14", "55", "crash", foreground = true)
        ClientStatsLogic.addExit(buckets, "2026-10-06", "4.0.14", "55", "signaled", foreground = false)
        ClientStatsLogic.addLaunch(buckets, "2026-10-07", "4.0.15", "56", 700)

        assertTrue(ClientStatsLogic.completedReports(buckets, "2026-10-06").isEmpty())
        val reports = ClientStatsLogic.completedReports(buckets, "2026-10-07")
        assertEquals(listOf("2026-10-06|4.0.14|55", "2026-10-06|4.0.15|56"), reports.map { it.first })

        val old = reports[0].second
        assertEquals(0, old.getInt("launchCount"))
        assertTrue(old.isNull("launchMsAvg"))
        assertEquals(2, old.getJSONObject("exits").getJSONObject("foreground").getInt("crash"))
        assertEquals(1, old.getJSONObject("exits").getJSONObject("background").getInt("signaled"))

        val current = reports[1].second
        assertEquals(2, current.getInt("launchCount"))
        assertEquals(800.0, current.getDouble("launchMsAvg"), 0.001)
        assertEquals(1, current.getInt("rendererCrashes"))
        assertEquals(2, current.getInt("rendererKills"))
        assertEquals(0, current.getJSONObject("exits").length())

        // Sent buckets are removed by key; the day in progress stays.
        reports.forEach { buckets.remove(it.first) }
        assertEquals(listOf("2026-10-07|4.0.15|56"), buckets.keys().asSequence().toList())
    }

    @Test
    fun bucketsOlderThanTheServerKeepsAreDropped() {
        val buckets = JSONObject()
        ClientStatsLogic.addLaunch(buckets, "2026-07-01", "4.0.10", "50", 500)
        ClientStatsLogic.addLaunch(buckets, "2026-10-06", "4.0.15", "56", 500)
        assertEquals(listOf("2026-07-01|4.0.10|50"), ClientStatsLogic.staleKeys(buckets, "2026-08-08"))
    }

    @Test
    fun anAnrKeepsOnlyTheMainThread() {
        val dump = listOf(
            "----- pid 4242 at 2026-10-07 09:12:01 -----",
            "Cmd line: cn.lizmt.cpuweb",
            "",
            "\"Signal Catcher\" daemon prio=10 tid=6 Runnable",
            "  at java.lang.Object.wait(Native method)",
            "",
            "\"main\" prio=5 tid=1 Blocked",
            "  | group=\"main\" sCount=1 ucsCount=0 flags=1 obj=0x72a1b2c8 self=0xb400007a",
            "  at cn.lizmt.cpuweb.schedule.ScheduleArchive.read(ScheduleArchive.kt:61)",
            "  - waiting to lock <0x0d3f1a2b> (a java.lang.Object) held by thread 31",
            "  at android.os.Handler.dispatchMessage(Handler.java:106)",
            "",
            "\"pool-2-thread-1\" prio=5 tid=31 Sleeping",
            "  at java.lang.Thread.sleep(Native method)",
        ).joinToString("\n")
        val trace = ClientStatsLogic.mainThreadTrace(dump)
        assertTrue(trace.startsWith("\"main\" prio=5"))
        assertTrue(trace.contains("ScheduleArchive.read"))
        assertTrue(trace.endsWith("Handler.dispatchMessage(Handler.java:106)"))
        assertFalse(trace.contains("pool-2-thread-1"))
        assertEquals("", ClientStatsLogic.mainThreadTrace("no thread dump here"))
    }

    @Test
    fun theStateSignatureIgnoresKeyOrder() {
        val a = JSONObject().put("appVersion", "4.0.15").put("scheduleStyle", "paper").put("customBackground", false)
        val b = JSONObject().put("customBackground", false).put("scheduleStyle", "paper").put("appVersion", "4.0.15")
        assertEquals(ClientStatsLogic.stateSignature(a), ClientStatsLogic.stateSignature(b))
        b.put("scheduleStyle", "board")
        assertFalse(ClientStatsLogic.stateSignature(a) == ClientStatsLogic.stateSignature(b))
    }

    @Test
    fun aCrashRecordKeepsTheRootCause() {
        val error = RuntimeException("outer", IllegalStateException("schedule archive is closed"))
        val record = ClientStatsLogic.diagnostic("crash", "4.0.15", "56", 1_791_304_200_000L, "main", null, ClientStatsLogic.stackTraceText(error))
        assertEquals("crash", record.getString("kind"))
        assertEquals("2026-10-07T00:30:00.000+08:00", record.getString("occurredAt"))
        assertTrue(record.isNull("message"))
        val stack = record.getString("stackTrace")
        assertTrue(stack.startsWith("java.lang.RuntimeException: outer"))
        assertTrue(stack.contains("Caused by: java.lang.IllegalStateException: schedule archive is closed"))
        assertTrue(stack.contains("at cn.lizmt.cpuweb.schedule.ClientStatsTest.aCrashRecordKeepsTheRootCause"))
    }

    @Test
    fun pendingDiagnosticsAreCappedAndExpire() {
        val directory = File(folder.root, "client-diagnostics")
        val now = 1_791_304_200_000L
        val day = 24L * 60 * 60 * 1000
        repeat(24) { index ->
            ClientDiagnostics.write(directory, JSONObject().put("kind", "crash").put("index", index), now - index)
        }
        val files = directory.listFiles()!!.sortedBy { it.name }
        assertEquals(24, files.size)
        // Newest name sorts last; give every file a distinct age, two of them past the limit.
        files.forEachIndexed { index, file -> file.setLastModified(now - (files.size - index) * 60_000L) }
        files[0].setLastModified(now - 31 * day)
        files[1].setLastModified(now - 40 * day)

        val pending = ClientDiagnostics.pending(directory, now)
        assertEquals(20, pending.size)
        assertEquals(20, directory.listFiles()!!.size)
        assertFalse(files[0].exists())
        assertFalse(files[1].exists())
        // The two oldest of the 22 still fresh are the ones beyond the cap.
        assertFalse(files[2].exists())
        assertFalse(files[3].exists())
        assertEquals(files[4].name, pending.first().name)
        assertEquals(files.last().name, pending.last().name)
    }

    @Test
    fun theCsrfTokenComesFromTheSessionCookies() {
        assertEquals("a b+c", ClientStats.csrfToken("cpu-session=abc; __Host-cpu-csrf=a%20b+c; theme=dark"))
        assertEquals("plain", ClientStats.csrfToken("cpu-csrf=plain"))
        assertNull(ClientStats.csrfToken("cpu-session=abc"))
        assertNull(ClientStats.csrfToken(""))
    }

    @Test
    fun onlyAnActivityStartedProcessCountsAsAColdStart() {
        assertTrue(ClientStatsLogic.isColdStart(processReadyAt = 10_000, activityCreatedAt = 10_400))
        // Woken for a widget update a minute before the user opened the app.
        assertFalse(ClientStatsLogic.isColdStart(processReadyAt = 10_000, activityCreatedAt = 70_000))
        assertFalse(ClientStatsLogic.isColdStart(processReadyAt = 0, activityCreatedAt = 400))
    }
}
