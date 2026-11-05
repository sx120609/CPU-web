package cn.lizmt.cpuweb.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class ApkUpdateAnnouncementTest {
    @Test
    fun aHigherVersionThanTheLastRunIsAnUpdate() {
        assertTrue(AppUpdater.isUpdateRun(62, 63, 1_000, 5_000, usedBefore = true))
        assertFalse(AppUpdater.isUpdateRun(63, 63, 1_000, 5_000, usedBefore = true))
    }

    @Test
    fun theFirstRunOverAnOlderInstallWithoutTheUpdaterIsAnUpdate() {
        // V61 recorded no run version; the user updated from the download page.
        assertTrue(AppUpdater.isUpdateRun(0, 62, 1_000, 5_000, usedBefore = true))
    }

    @Test
    fun aFreshInstallOrClearedDataIsNotAnUpdate() {
        assertFalse(AppUpdater.isUpdateRun(0, 62, 5_000, 5_000, usedBefore = false))
        assertFalse(AppUpdater.isUpdateRun(0, 62, 1_000, 5_000, usedBefore = false))
    }

    @Test
    fun pendingNotesCountOnlyForTheVersionThatWasInstalled() {
        val raw = """{"versionCode":62,"notes":["小组件准时换日"," ",""]}"""
        assertEquals(listOf("小组件准时换日"), AppUpdater.pendingNotesFor(raw, 62))
        assertEquals(emptyList<String>(), AppUpdater.pendingNotesFor(raw, 63))
        assertEquals(emptyList<String>(), AppUpdater.pendingNotesFor("[\"旧格式\"]", 62))
        assertEquals(emptyList<String>(), AppUpdater.pendingNotesFor(null, 62))
    }
}
