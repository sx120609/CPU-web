package cn.lizmt.cpuweb.schedule

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** 一起看的周视图 (并排 or 合并), the strip's one-time hint and 课表怎么用. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ScheduleGuideTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private fun prefs() = context.getSharedPreferences("native_schedule_style", Context.MODE_PRIVATE)

    @Test
    fun aMissingOrUnknownLayoutIsTheStrip() {
        assertEquals(CoupleWeekLayout.Split, CoupleWeekLayout.fromId(null))
        assertEquals(CoupleWeekLayout.Split, CoupleWeekLayout.fromId(""))
        assertEquals(CoupleWeekLayout.Split, CoupleWeekLayout.fromId("grid"))
        assertEquals(CoupleWeekLayout.Split, CoupleWeekLayout.fromId("split"))
        assertEquals(CoupleWeekLayout.Merged, CoupleWeekLayout.fromId("merged"))
        assertEquals(listOf("split" to "并排", "merged" to "合并"), CoupleWeekLayout.OPTIONS)
    }

    @Test
    fun theLayoutIsKeptOnTheDevice() {
        prefs().edit().clear().commit()
        val first = ScheduleStyleSettings(context)
        assertEquals(CoupleWeekLayout.Split, first.coupleWeekLayout)
        first.selectCoupleWeekLayout(CoupleWeekLayout.Merged)
        assertEquals(CoupleWeekLayout.Merged, ScheduleStyleSettings(context).coupleWeekLayout)
        prefs().edit().putString("coupleWeekLayout", "sideways").commit()
        assertEquals(CoupleWeekLayout.Split, ScheduleStyleSettings(context).coupleWeekLayout)
    }

    @Test
    fun theWeekViewIsTheStripOnlyWithSomebodyElseAndSplitChosen() {
        assertTrue(ScheduleGuideRules.usesStrip("week", hasLayer = true, layout = CoupleWeekLayout.Split))
        // 合并: the one week grid draws both people's courses, as before the strip.
        assertFalse(ScheduleGuideRules.usesStrip("week", hasLayer = true, layout = CoupleWeekLayout.Merged))
        assertFalse(ScheduleGuideRules.usesStrip("week", hasLayer = false, layout = CoupleWeekLayout.Split))
        assertFalse(ScheduleGuideRules.usesStrip("day", hasLayer = true, layout = CoupleWeekLayout.Split))
        assertFalse(ScheduleGuideRules.usesStrip("month", hasLayer = true, layout = CoupleWeekLayout.Split))
    }

    @Test
    fun theGuideOpensOnceOverTheUsersOwnTimetable() {
        assertTrue(ScheduleGuideRules.opensGuide(seenVersion = 0, readOnly = false, hasData = true, busy = false))
        // Not over a shared timetable, an empty one, or another sheet or dialog.
        assertFalse(ScheduleGuideRules.opensGuide(0, readOnly = true, hasData = true, busy = false))
        assertFalse(ScheduleGuideRules.opensGuide(0, readOnly = false, hasData = false, busy = false))
        assertFalse(ScheduleGuideRules.opensGuide(0, readOnly = false, hasData = true, busy = true))
        assertFalse(ScheduleGuideRules.opensGuide(ScheduleGuideRules.VERSION, readOnly = false, hasData = true, busy = false))
        // A later guide is shown once more to somebody who saw an earlier one.
        assertTrue(ScheduleGuideRules.opensGuide(ScheduleGuideRules.VERSION - 1, readOnly = false, hasData = true, busy = false))
    }

    @Test
    fun seeingTheGuideIsRemembered() {
        prefs().edit().clear().commit()
        val first = ScheduleStyleSettings(context)
        assertEquals(0, first.guideSeen)
        first.markGuideSeen()
        val second = ScheduleStyleSettings(context)
        assertEquals(ScheduleGuideRules.VERSION, second.guideSeen)
        assertFalse(ScheduleGuideRules.opensGuide(second.guideSeen, readOnly = false, hasData = true, busy = false))
    }

    @Test
    fun theStripHintShowsUntilItWasSeenOnce() {
        prefs().edit().clear().commit()
        val style = ScheduleStyleSettings(context)
        assertTrue(ScheduleGuideRules.showsStripHint(stripShown = true, hintSeen = style.stripHintSeen))
        assertFalse(ScheduleGuideRules.showsStripHint(stripShown = false, hintSeen = style.stripHintSeen))
        style.markStripHintSeen()
        assertTrue(ScheduleStyleSettings(context).stripHintSeen)
        assertFalse(ScheduleGuideRules.showsStripHint(stripShown = true, hintSeen = true))
        // A debug launch can look at the first run again.
        style.markGuideSeen()
        style.resetGuide(guide = true, stripHint = true)
        val again = ScheduleStyleSettings(context)
        assertEquals(0, again.guideSeen)
        assertFalse(again.stripHintSeen)
    }

    @Test
    fun theGuideOffersOnlyWhatApplies() {
        // 和 TA 一起看 is for somebody with a partner or a timetable laid over their own.
        assertFalse(ScheduleGuideRules.showsTogether(coupleBound = false, overlayOn = false))
        assertTrue(ScheduleGuideRules.showsTogether(coupleBound = true, overlayOn = false))
        assertTrue(ScheduleGuideRules.showsTogether(coupleBound = false, overlayOn = true))
        // 换回经典 only from the promoted default.
        assertTrue(ScheduleGuideRules.offersClassic(ScheduleVisualStyle.Minimal))
        assertFalse(ScheduleGuideRules.offersClassic(ScheduleVisualStyle.Classic))
        assertFalse(ScheduleGuideRules.offersClassic(ScheduleVisualStyle.Paper))
    }
}
