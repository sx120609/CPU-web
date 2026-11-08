package cn.lizmt.cpuweb.schedule

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
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
        // The copy is kept for the next start.
        assertEquals("u1" to remote.items, AgendaRemote.readCache(context))

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
    }

    @Test
    fun theTimetableAddsEditsAndDeletesThroughThePage() = runTest {
        val sent = mutableListOf<JSONObject>()
        var answer: String? = null
        val remote = AgendaRemote(context, scope) { request -> sent += request; answer }
        val day = LocalDate.now().plusDays(2).toString()
        val stored = item("meeting00001", "组会", day, "15:00")

        // A new item goes without an id; the page's stored copy comes back and the list follows the page.
        answer = JSONObject().put("authenticated", true).put("account", "u1").put("relay", true)
            .put("items", JSONArray().put(stored)).put("saved", stored).toString()
        val saved = remote.save(newAgendaDraft(day, "15:00").copy(title = "组会"))
        val request = sent.last()
        assertEquals("save", request.getString("action"))
        assertFalse(request.getJSONObject("data").has("id"))
        assertEquals("15:00", request.getJSONObject("data").getString("start"))
        assertEquals("meeting00001", saved.getOrThrow().id)
        assertEquals(listOf("meeting00001"), remote.items.map { it.id })
        assertTrue(remote.relay)

        // Not stored: the page says why, and nothing is shown as saved.
        answer = JSONObject().put("authenticated", true).put("account", "u1").put("items", JSONArray().put(stored))
            .put("saved", JSONObject.NULL).put("error", "日程最多 600 条").toString()
        assertEquals("日程最多 600 条", remote.save(saved.getOrThrow().copy(title = "组会改")).exceptionOrNull()?.message)
        // The page could not answer: the edit is not lost silently either.
        answer = null
        assertTrue(remote.save(saved.getOrThrow()).isFailure)

        // Deleting succeeds once the page's list no longer has it.
        answer = JSONObject().put("authenticated", true).put("account", "u1").put("items", JSONArray()).toString()
        assertTrue(remote.remove("meeting00001").isSuccess)
        assertEquals(listOf("remove", "meeting00001"), listOf(sent.last().getString("action"), sent.last().getString("id")))
        assertTrue(remote.items.isEmpty())

        // 微信和 QQ 也提醒 shows the change at once.
        remote.updateRelay(false)
        assertFalse(remote.relay)
        assertEquals(false, sent.last().getBoolean("on"))
    }

    @Test
    fun openToDosArePastUntickedOnesThenUndatedOnes() {
        val today = LocalDate.of(2026, 10, 26)
        fun todo(id: String, date: String, start: String = "", done: Boolean = false, createdAt: Long = 0) =
            cn.lizmt.cpuweb.schedule.agenda.AgendaItem(id, cn.lizmt.cpuweb.schedule.agenda.AgendaKind.Todo, id, date, start,
                done = done, createdAt = createdAt)
        val items = listOf(
            todo("undated02", "", createdAt = 2), todo("undated01", "", createdAt = 1), todo("late0002", "2026-10-24"),
            todo("late0001", "2026-10-20"), todo("timed001", "2026-10-20", "09:00"), todo("done0001", "2026-10-20", done = true),
            todo("today001", "2026-10-26"),
        )
        assertEquals(listOf("late0001", "late0002", "undated01", "undated02"), openTodos(items, today).map { it.id })
    }

    @Test
    fun aScreenshotIsSentThroughThePageAndReadIntoNewItems() = runTest {
        val sent = mutableListOf<JSONObject>()
        var answer: String? = null
        val remote = AgendaRemote(context, scope) { request -> sent += request; answer }
        answer = JSONObject().put("message", "").put("items", JSONArray()
            .put(JSONObject().put("title", "学术讲座").put("date", "2026-11-12").put("start", "14:00").put("end", "13:00")
                .put("location", "药学楼 101").put("note", "· 带学生证").put("remind", 30).put("repeat", "none"))
            .put(JSONObject().put("title", "").put("date", "2026-11-10"))).toString()
        val items = remote.extract(image = "data:image/jpeg;base64,AAAA").getOrThrow()
        assertEquals("extract", sent.last().getString("action"))
        assertEquals("data:image/jpeg;base64,AAAA", sent.last().getString("image"))
        assertEquals(1, items.size)
        val lecture = items.single()
        assertEquals("", lecture.id)
        assertEquals("assistant", lecture.origin)
        assertEquals(listOf("2026-11-12", "14:00", "", "药学楼 101", "· 带学生证", 30), listOf(lecture.date, lecture.start, lecture.end, lecture.location, lecture.note, lecture.remind))

        answer = JSONObject().put("items", JSONArray()).put("message", "图片里没有活动安排").toString()
        assertEquals("图片里没有活动安排", remote.extract(text = "随便一段话").exceptionOrNull()?.message)
        assertEquals("随便一段话", sent.last().getString("text"))
        // A site without "extract" answers with the agenda list: never taken as items read from the picture.
        answer = JSONObject().put("authenticated", true).put("items", JSONArray().put(item("meeting00001", "组会", "2026-11-12", "15:00"))).toString()
        assertTrue(remote.extract(text = "通知").isFailure)
        answer = null
        assertFalse(remote.extract(text = "通知").isSuccess)
    }
}
