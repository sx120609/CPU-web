package cn.lizmt.cpuweb.schedule

import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaStore
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NextSyncTest {
    @get:Rule val folder = TemporaryFolder()

    @Test
    fun theLedgerUploadsWhatTheServerHasNotConfirmed() {
        val ledger = SyncLedger(account = "owner")
        val local = mapOf("aaaaaa000001" to 10L, "aaaaaa000002" to 20L)
        assertEquals(setOf("aaaaaa000001", "aaaaaa000002"), ledger.dirty("agenda", local).toSet())
        ledger.confirm("agenda", "aaaaaa000001", 10L)
        assertEquals(listOf("aaaaaa000002"), ledger.dirty("agenda", local))
        // Edited again here: up it goes.
        assertEquals(listOf("aaaaaa000001"), ledger.dirty("agenda", mapOf("aaaaaa000001" to 11L)))
        ledger.cursor = "1700000000000:agenda:aaaaaa000001"
        val reread = SyncLedger.fromJson(JSONObject(ledger.toJson().toString()))
        assertEquals("owner", reread.account)
        assertEquals(ledger.cursor, reread.cursor)
        assertEquals(10L, reread.confirmed("agenda", "aaaaaa000001"))
        assertEquals("", SyncLedger.fromJson(null).account)
    }

    @Test
    fun agendaEditsMergeByTheirTimeAndRemovalsTravel() {
        // Recent times: removals older than the server keeps them (180 days) are forgotten.
        val t = System.currentTimeMillis() - 60_000
        val store = AgendaStore.forTest(folder.newFile("agenda.json"))
        val changed = mutableListOf<String>()
        store.onLocalChange = { changed += it }
        val item = store.save(AgendaItem("", AgendaKind.Event, "组会", "2026-10-23", "14:00"), now = t + 1_000)!!
        assertEquals(listOf(item.id), changed)
        // An older version from another phone loses; a newer one wins without counting as a local change.
        assertFalse(store.applyRemote(item.id, item.copy(title = "旧标题"), t + 500))
        assertTrue(store.applyRemote(item.id, item.copy(title = "组会（三楼）"), t + 2_000))
        assertEquals("组会（三楼）", store.items.single().title)
        assertEquals(t + 2_000, store.items.single().updatedAt)
        assertEquals(1, changed.size)
        // A removal elsewhere removes it here and is remembered.
        assertTrue(store.applyRemote(item.id, null, t + 3_000))
        assertTrue(store.items.isEmpty())
        assertEquals(t + 3_000, store.deletedAt(item.id))
        assertFalse(store.applyRemote(item.id, item, t + 2_500))
        // Undo here after a removal: the item is back and newer than the removal.
        store.restore(item, now = t + 4_000)
        assertEquals(t + 4_000, store.items.single().updatedAt)
        assertNull(store.deletedAt(item.id))
        // Removals survive a restart.
        store.remove(item.id, now = t + 5_000)
        val reread = AgendaStore.forTest(java.io.File(folder.root, "agenda.json"))
        assertEquals(t + 5_000, reread.deletedAt(item.id))
    }

    @Test
    fun conversationsKeepTheirProposalsAndFitTheServer() {
        val action = JSONObject().put("type", "agenda.create").put("item", JSONObject().put("title", "组会"))
        val messages = listOf(
            AssistantMessage("m1", fromUser = true, text = "明天下午提醒我开组会"),
            AssistantMessage("m2", fromUser = false, text = "帮你准备好了",
                proposals = listOf(AssistantProposal("p1", action, ProposalState.Applied, "已添加到明天", auto = true))),
            AssistantMessage("m3", fromUser = false, text = "", streaming = true),
        )
        val conversation = AssistantConversation("c0123456789abcdef", "明天下午", 42L, messages)
        val json = AssistantCodec.conversationToJson(conversation)
        val back = AssistantCodec.conversationFromJson(conversation.id, 42L, JSONObject(json.toString()))!!
        // The answer still being written is not stored.
        assertEquals(listOf("m1", "m2"), back.messages.map { it.id })
        assertEquals(ProposalState.Applied, back.messages[1].proposals.single().state)
        assertTrue(back.messages[1].proposals.single().auto)
        assertNull(AssistantCodec.conversationFromJson("bad id", 1L, json))
        // A long conversation drops its oldest messages to fit.
        val long = conversation.copy(messages = (1..60).map { AssistantMessage("m$it", fromUser = it % 2 == 1, text = "字".repeat(4_000)) })
        val trimmed = AssistantCodec.conversationToJson(long, AssistantCodec.SYNC_LIMIT)
        assertTrue(trimmed.toString().length <= AssistantCodec.SYNC_LIMIT)
        assertEquals("m60", trimmed.getJSONArray("messages").let { it.getJSONObject(it.length() - 1).getString("id") })
        assertEquals("周五 组会", AssistantCodec.titleFor("周五 组会\n下午三点"))
    }

    @Test
    fun theConfirmationSettingDecidesWhatRunsAtOnce() {
        assertFalse(ApprovalMode.Always.runsWithoutAsking("agenda.create"))
        assertTrue(ApprovalMode.Own.runsWithoutAsking("agenda.create"))
        assertTrue(ApprovalMode.Own.runsWithoutAsking("forum.like"))
        // Pages wait for a tap; what others will see and deleting always ask.
        assertFalse(ApprovalMode.Own.runsWithoutAsking("web.open"))
        assertFalse(ApprovalMode.Own.runsWithoutAsking("forum.post"))
        assertFalse(ApprovalMode.Own.runsWithoutAsking("dm.send"))
        assertFalse(ApprovalMode.Own.runsWithoutAsking("agenda.delete"))
        assertEquals(ApprovalMode.Own, ApprovalMode.of(null))
        assertEquals(ApprovalMode.Own, ApprovalMode.of("trusted"))
        assertEquals(ApprovalMode.Always, ApprovalMode.of("always"))
    }

    @Test
    fun anActionOnItsWayIsStoredAsNotDone() {
        val action = JSONObject().put("type", "forum.post").put("title", "求助").put("content", "有人知道吗")
        val message = AssistantMessage("m1", fromUser = false, text = "写好了",
            proposals = listOf(AssistantProposal("p1", action, ProposalState.Running, "正在发布…"), AssistantProposal("p2", action, ProposalState.Applied, "已发布", link = "/forum/topic/9")))
        val json = AssistantCodec.messageToJson(message)
        assertEquals("Pending", json.getJSONArray("proposals").getJSONObject(0).getString("state"))
        val back = AssistantCodec.messageFromJson(JSONObject(json.toString()))!!
        assertEquals(ProposalState.Dismissed, back.proposals[0].state)
        assertEquals("/forum/topic/9", back.proposals[1].link)
    }

    @Test
    fun theReminderPlanFollowsThePhonesOwnRules() {
        val now = java.time.LocalDateTime.of(2026, 10, 19, 7, 0)
        val zone = java.time.ZoneId.of("Asia/Shanghai")
        val items = listOf(
            AgendaItem("aaaaaa000001", AgendaKind.Event, "组会", "2026-10-19", "14:00", "15:00", location = "药学楼", remind = 15),
            AgendaItem("aaaaaa000002", AgendaKind.Event, "背单词", "2026-10-01", "07:30", remind = 0, repeat = cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat.Daily,
                doneDates = setOf("2026-10-20")),
            AgendaItem("aaaaaa000003", AgendaKind.Event, "不提醒", "2026-10-19", "09:00"),
        )
        val days = mapOf("2026-10-19" to DashDay("2026-10-19", "周一", 8, listOf(DashCourse("药理学", "药学楼 302", "王老师", "08:00", "09:40"))))
        val plan = ReminderPlan.build(items, days, courseMinutes = 10, now = now, zone = zone)
        val first = plan.take(3).map { it.key }
        assertEquals(listOf("agenda:aaaaaa000002:2026-10-19", "course:2026-10-19:08:00:" + "药理学".hashCode().toUInt().toString(36), "agenda:aaaaaa000001:2026-10-19"), first)
        assertEquals(now.withHour(13).withMinute(45).atZone(zone).toInstant().toEpochMilli(), plan[2].at)
        assertEquals("上课提醒 · 药理学", plan[1].title)
        assertEquals("08:00–09:40 · 药学楼 302", plan[1].text)
        // The daily item skips the day already ticked off and stops at thirty days.
        assertFalse(plan.any { it.key == "agenda:aaaaaa000002:2026-10-20" })
        assertTrue(plan.any { it.key == "agenda:aaaaaa000002:2026-10-21" })
        assertFalse(plan.any { it.key.startsWith("agenda:aaaaaa000003") })
        assertTrue(plan.all { it.at < now.plusDays(31).atZone(zone).toInstant().toEpochMilli() })
        assertEquals(plan.size, ReminderPlan.toJson(plan).getJSONArray("items").length())
    }

    @Test
    fun theActionLogReadsWhatAnotherPhoneRecorded() {
        val json = ActivityCodec.toJson(ActivityEntry("a0123456789", 10L, 10L, "c1", "m1", "p1", JSONObject().put("type", "theme.mode"), "已切换", "Pixel 9", "undone", auto = true))
        val back = ActivityCodec.fromJson("a0123456789", 20L, JSONObject(json.toString()))
        assertNotNull(back)
        assertEquals("undone", back!!.state)
        assertEquals("Pixel 9", back.device)
        assertTrue(back.auto)
        assertEquals(20L, back.updatedAt)
        assertNull(ActivityCodec.fromJson("a0123456789", 20L, JSONObject().put("at", 1)))
    }
}
