package cn.lizmt.cpuweb.schedule

import org.robolectric.RuntimeEnvironment
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
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

/** `/api/next-sync` in memory, by the server's rules: strictly newer edits win, older ones get the stored record back. */
private class FakeSyncServer {
    private class Row(val collection: String, val id: String, var data: JSONObject?, var updatedAt: Long, var seq: Long)
    private val rows = linkedMapOf<String, Row>()
    private var seq = 0L
    var pushes = 0
        private set

    /** The live records of [collection]: id to data. */
    fun live(collection: String): Map<String, JSONObject> = rows.values.filter { it.collection == collection && it.data != null }.associate { it.id to it.data!! }

    fun handle(path: String, method: String, body: JSONObject?): SiteReply = when (method) {
        "GET" -> {
            val cursor = java.net.URLDecoder.decode(path.substringAfter("cursor=", ""), "UTF-8").toLongOrNull() ?: 0L
            val changed = rows.values.filter { it.seq > cursor }.sortedBy { it.seq }
            // Small pages, so paging is exercised.
            val page = changed.take(2)
            SiteReply(200, JSONObject().put("records", JSONArray(page.map(::out)))
                .put("cursor", (page.lastOrNull()?.seq ?: cursor).toString()).put("more", changed.size > page.size), "")
        }
        "POST" -> {
            pushes += 1
            val applied = JSONArray()
            val newer = JSONArray()
            val records = body!!.getJSONArray("records")
            for (index in 0 until records.length()) {
                val record = records.getJSONObject(index)
                val key = record.getString("collection") + ":" + record.getString("id")
                val at = record.getLong("updatedAt")
                val existing = rows[key]
                if (existing != null && at <= existing.updatedAt) {
                    newer.put(out(existing))
                    continue
                }
                val data = if (record.optBoolean("deleted")) null else record.getJSONObject("data")
                rows[key] = Row(record.getString("collection"), record.getString("id"), data, at, ++seq)
                applied.put(JSONObject().put("collection", record.getString("collection")).put("id", record.getString("id")))
            }
            SiteReply(200, JSONObject().put("applied", applied).put("newer", newer).put("rejected", JSONArray()), "")
        }
        else -> SiteReply(200, JSONObject().put("deleted", rows.size).also { rows.clear() }, "")
    }

    private fun out(row: Row) = JSONObject().put("collection", row.collection).put("id", row.id).put("updatedAt", row.updatedAt)
        .put("deleted", row.data == null).put("data", row.data ?: JSONObject.NULL)
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NextSyncTwoPhonesTest {
    @get:Rule val folder = TemporaryFolder()

    private class Phone(val agenda: AgendaStore, val assistant: AssistantSession, val log: AssistantActivityLog, val sync: NextSync)

    @Test
    fun twoPhonesOnOneAccountEndUpTheSame() = runBlocking {
        val context: android.content.Context = RuntimeEnvironment.getApplication()
        val server = FakeSyncServer()
        val scope = CoroutineScope(Dispatchers.Unconfined)
        var signedInOnB: String? = "2024000001"
        fun phone(name: String, account: () -> String?): Phone {
            val agenda = AgendaStore.forTest(folder.newFile("$name-agenda.json"))
            val assistant = AssistantSession(context, scope)
            val log = AssistantActivityLog(context)
            return Phone(agenda, assistant, log, NextSync(context, scope, account, agenda, assistant, log, server::handle))
        }
        // Both phones exist before either syncs (they share this test's app files).
        val a = phone("a") { "2024000001" }
        val b = phone("b") { signedInOnB }

        val item = a.agenda.save(AgendaItem("", AgendaKind.Event, "组会", "2026-10-23", "14:00"))!!
        a.assistant.debugSeed(listOf(AssistantMessage("m1", fromUser = true, text = "明天下午提醒我开组会")), title = "组会")
        val conversationId = a.assistant.currentId!!
        a.log.record(conversationId, "m1", AssistantProposal("p1", JSONObject().put("type", "theme.mode").put("value", "dark")), "已切换", failed = false, auto = false)
        a.sync.syncNow()
        assertNull(a.sync.error)

        b.sync.syncNow()
        assertEquals(listOf("组会"), b.agenda.items.map { it.title })
        assertEquals(listOf(conversationId), b.assistant.conversations.map { it.id })
        assertEquals("明天下午提醒我开组会", b.assistant.conversations.single().messages.single().text)
        assertEquals(1, b.log.entries.size)

        // B edits the item and deletes the conversation; A follows.
        Thread.sleep(5)
        b.agenda.save(b.agenda.items.single().copy(title = "组会（改到三楼）"))
        b.assistant.delete(conversationId)
        b.sync.syncNow()
        a.sync.syncNow()
        assertEquals("组会（改到三楼）", a.agenda.items.single { it.id == item.id }.title)
        assertTrue(a.assistant.conversations.isEmpty())

        // Nothing changed: nothing goes up again.
        val pushes = server.pushes
        a.sync.syncNow()
        b.sync.syncNow()
        assertEquals(pushes, server.pushes)

        // An edit made on A while B also edits: the later one stays on both.
        Thread.sleep(5)
        a.agenda.save(a.agenda.items.single().copy(location = "药学楼"))
        Thread.sleep(5)
        b.agenda.save(b.agenda.items.single().copy(location = "图书馆"))
        a.sync.syncNow()
        b.sync.syncNow()
        a.sync.syncNow()
        assertEquals("图书馆", a.agenda.items.single().location)
        assertEquals("图书馆", b.agenda.items.single().location)

        // Another account on B: sync pauses instead of mixing the two.
        signedInOnB = "2024000002"
        b.sync.syncNow()
        assertTrue(b.sync.otherAccount)
        assertFalse(b.sync.active)
    }

    @Test
    fun aPhonesReminderPlanGoesUpWhenRelayingAndComesDownAfter() = runBlocking {
        val context: android.content.Context = RuntimeEnvironment.getApplication()
        val server = FakeSyncServer()
        val scope = CoroutineScope(Dispatchers.Unconfined)
        val agenda = AgendaStore.forTest(folder.newFile("relay-agenda.json"))
        val assistant = AssistantSession(context, scope)
        val log = AssistantActivityLog(context)
        var plan = JSONObject().put("items", JSONArray().put(JSONObject().put("key", "course:a").put("at", 1L).put("title", "上课提醒 · 药理学")))
        val sync = NextSync(context, scope, { "2024000001" }, agenda, assistant, log, server::handle, reminderPlan = { plan })
        sync.syncNow()
        assertTrue(server.live("reminders").isEmpty())

        sync.switchRelay(true)
        sync.syncNow()
        assertEquals(1, server.live("reminders").size)
        val pushes = server.pushes
        sync.syncNow()
        assertEquals("an unchanged plan is not sent again", pushes, server.pushes)
        plan = JSONObject().put("items", JSONArray())
        sync.syncNow()
        assertEquals(0, server.live("reminders").values.single().getJSONArray("items").length())

        sync.switchRelay(false)
        sync.syncNow()
        assertTrue(server.live("reminders").isEmpty())
    }
}
