package cn.lizmt.cpuweb.schedule

import android.app.AlarmManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@OptIn(ExperimentalCoroutinesApi::class)
class AgendaRemoteTest {
    private val context = RuntimeEnvironment.getApplication()
    private val scope = CoroutineScope(UnconfinedTestDispatcher())

    private fun item(id: String, title: String, date: String, start: String, repeat: String = "none", remind: Int = -1) =
        JSONObject().put("id", id).put("kind", "event").put("title", title).put("date", date).put("start", start)
            .put("repeat", repeat).put("remind", remind)

    @Test
    fun theSiteListIsShownTickedAtOnceAndForgottenOnSignOut() {
        val sent = mutableListOf<JSONObject>()
        var answer: String? = null
        val remote = AgendaRemote(context, scope) { request -> sent += request; answer }
        val alarms = shadowOf(context.getSystemService(AlarmManager::class.java))
        val tomorrow = LocalDate.now().plusDays(1)
        answer = JSONObject().put("authenticated", true).put("account", "u1").put("items", JSONArray()
            .put(item("meeting00001", "组会", tomorrow.toString(), "15:00", remind = 15))
            .put(item("daily0000001", "背单词", tomorrow.minusDays(7).toString(), "07:00", repeat = "daily"))
            .put(JSONObject().put("id", "BAD ID").put("title", "坏的"))).toString()

        remote.refresh(force = true)
        assertEquals("list", sent.single().getString("action"))
        assertTrue(remote.available)
        assertEquals(listOf("meeting00001", "daily0000001"), remote.items.map { it.id })
        assertEquals(listOf("daily0000001", "meeting00001"), remote.on(tomorrow).map { it.item.id })
        // The copy is kept for the next start and for the reminder receivers; only the meeting asks for one.
        assertEquals("u1" to remote.items, AgendaRemote.readCache(context))
        assertEquals(1, alarms.scheduledAlarms.size)

        // A repeat is ticked for that day only, before the page answers.
        answer = null
        remote.toggle(remote.on(tomorrow).first())
        assertTrue(remote.on(tomorrow).first().done)
        assertFalse(remote.on(tomorrow.plusDays(1)).single().done)
        val toggle = sent.last()
        assertEquals(listOf("toggle", "daily0000001", tomorrow.toString(), "true"),
            listOf(toggle.getString("action"), toggle.getString("id"), toggle.getString("date"), toggle.getBoolean("done").toString()))

        // A site without the bridge keeps what is shown; a signed-out answer clears it all.
        answer = """{"missing":true}"""
        remote.refresh(force = true)
        assertEquals(2, remote.items.size)
        answer = """{"authenticated":false}"""
        remote.refresh(force = true)
        assertFalse(remote.available)
        assertTrue(remote.items.isEmpty())
        assertEquals("" to emptyList<Any>(), AgendaRemote.readCache(context))
        assertEquals(0, alarms.scheduledAlarms.size)
    }
}
