package cn.lizmt.cpuweb.schedule

import cn.lizmt.cpuweb.schedule.custom.AssistantControls
import cn.lizmt.cpuweb.schedule.custom.Customization
import cn.lizmt.cpuweb.schedule.custom.DashboardCard
import cn.lizmt.cpuweb.schedule.custom.DashboardLayout
import cn.lizmt.cpuweb.schedule.custom.LAYOUT_PRESETS
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AssistantControlsTest {
    private val base = Customization()

    @Test
    fun settingsFlipOnlyTheirOwnSwitch() {
        assertEquals(AssistantControls.settings.keys, AssistantControls.settings.keys.filter { AssistantControls.setting(base, it) != null }.toSet())
        val dark = AssistantControls.withSetting(base, "pureBlack", true)!!
        assertTrue(dark.pureBlack)
        assertEquals(base.copy(pureBlack = true), dark)
        assertNull(AssistantControls.withSetting(base, "rootAccess", true))
        assertNull(AssistantControls.setting(base, "rootAccess"))
    }

    @Test
    fun theBarKeepsTabsThatCanBeTabs() {
        // "post" cannot be a tab and "nowhere" is unknown; the launch page falls back to one that stays.
        val next = AssistantControls.withTabs(base, listOf("dashboard", "post", "agenda", "nowhere", "dashboard", "assistant"), "post")!!
        assertEquals(listOf("dashboard", "agenda", "assistant"), next.tabs)
        assertEquals("dashboard", next.launchTab)
        assertEquals("agenda", AssistantControls.withTabs(base, listOf("agenda", "schedule"), "agenda")!!.launchTab)
        assertNull(AssistantControls.withTabs(base, listOf("schedule", "post"), null))
    }

    @Test
    fun undoingAPresetLeavesOtherChoicesAlone() {
        val before = base.copy(accent = "#2E7D32")
        val preset = LAYOUT_PRESETS.first { it.id == "minimal" }
        val applied = preset.apply(before).copy(fontScale = 1.2f)
        val undone = AssistantControls.withPresetFields(applied, before)
        assertEquals(before.copy(fontScale = 1.2f), undone)
    }

    @Test
    fun todayGainsAndLosesSections() {
        val (withCountdown, countdown) = AssistantControls.withTodayCard(base, "countdown", "期末考试", "2027-01-08", "") { "abc123" }!!
        assertEquals("countdown-abc123", countdown.id)
        assertEquals(countdown, withCountdown.dashboard.cards.first())
        assertNull(AssistantControls.withTodayCard(base, "countdown", "期末", "", "") { "x" })
        // Sections that appear once are not added twice; unknown ones not at all.
        assertNull(AssistantControls.withTodayCard(base, "today", "", "", "") { "x" })
        assertNull(AssistantControls.withTodayCard(base, "weather", "", "", "") { "x" })
        val (withHot, hot) = AssistantControls.withTodayCard(base, "hot", "", "", "") { "x" }!!
        assertEquals(hot, withHot.dashboard.cards.last())
        assertFalse(AssistantControls.withoutTodayCard(withCountdown, countdown.id).dashboard.cards.any { it.id == countdown.id })

        val layout = base.copy(dashboard = DashboardLayout(listOf(
            DashboardCard("next", "next"), DashboardCard("note-a", "note", title = "A"), DashboardCard("today", "today"), DashboardCard("note-b", "note", title = "B"),
        )))
        val removed = AssistantControls.todayCardsOf(layout, "note")
        val without = AssistantControls.withoutTodayCards(layout, "note")
        assertEquals(listOf("next", "today"), without.dashboard.cards.map { it.id })
        assertEquals(layout, AssistantControls.withRestoredTodayCards(without, removed))
    }
}
