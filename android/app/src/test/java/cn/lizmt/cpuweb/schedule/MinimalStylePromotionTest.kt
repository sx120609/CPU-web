package cn.lizmt.cpuweb.schedule

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** 简约 is promoted once: a stored 经典 becomes 简约, later choices and other styles stay. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MinimalStylePromotionTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private fun prefs() = context.getSharedPreferences("native_schedule_style", Context.MODE_PRIVATE)

    @Test
    fun aNewUserStartsWithMinimal() {
        prefs().edit().clear().commit()
        assertEquals(ScheduleVisualStyle.Minimal, ScheduleStyleSettings(context).visualStyle)
    }

    @Test
    fun aStoredClassicBecomesMinimalOnceAndAChosenClassicThenStays() {
        prefs().edit().clear().putString("visualStyle", "classic").commit()
        val first = ScheduleStyleSettings(context)
        assertEquals(ScheduleVisualStyle.Minimal, first.visualStyle)
        first.selectVisualStyle(ScheduleVisualStyle.Classic)
        assertEquals(ScheduleVisualStyle.Classic, ScheduleStyleSettings(context).visualStyle)
    }

    @Test
    fun otherStylesAreNotTouched() {
        prefs().edit().clear().putString("visualStyle", "paper").commit()
        assertEquals(ScheduleVisualStyle.Paper, ScheduleStyleSettings(context).visualStyle)
    }
}
