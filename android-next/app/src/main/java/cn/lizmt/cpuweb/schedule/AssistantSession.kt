package cn.lizmt.cpuweb.schedule

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection

/** A link to a site page the answer recommends. */
data class AssistantLink(val label: String, val url: String)

/** [Running]: a site action on its way (posting, sending); stored as pending, which reads back as not done. */
enum class ProposalState { Pending, Running, Applied, Dismissed, Failed }

/**
 * An action 拾间AI proposed; nothing happens until the user confirms it, or
 * the confirmation setting lets it run ([auto]). [link] is where the result can
 * be seen, such as the new post.
 */
data class AssistantProposal(
    val id: String,
    val action: JSONObject,
    val state: ProposalState = ProposalState.Pending,
    val note: String = "",
    val auto: Boolean = false,
    val link: String = "",
)

data class AssistantMessage(
    val id: String,
    val fromUser: Boolean,
    val text: String,
    val links: List<AssistantLink> = emptyList(),
    val proposals: List<AssistantProposal> = emptyList(),
    val suggestions: List<String> = emptyList(),
    val failed: Boolean = false,
    val streaming: Boolean = false,
)

data class AssistantConversation(val id: String, val title: String, val updatedAt: Long, val messages: List<AssistantMessage>)

/** Grades or exams the app read for 拾间AI: compact JSON, or why it could not be read. */
data class AgentData(val data: String? = null, val error: String? = null)

/**
 * Which proposals run without a tap. Whatever other people will see (posts,
 * replies, private messages, lost and found) and deleting always ask; pages
 * open only when the user taps them.
 */
enum class ApprovalMode(val id: String, val title: String, val detail: String) {
    Always("always", "每一项都先问我", "所有操作都等你点确认"),
    Own("own", "改我自己的直接做", "日程、设置、布局、点赞、已读直接执行，可以撤销；发帖、回复、私信和删除先给你看");

    fun runsWithoutAsking(type: String): Boolean = when (this) {
        Always -> false
        Own -> type !in VIEW_ONLY && type !in PUBLISHING && type != "agenda.delete" && type != "data.request" && type != "read"
    }

    companion object {
        /** Actions that only show something: buttons the user taps, never run on their own. */
        val VIEW_ONLY = setOf("open", "web.open", "schedule.view")
        /** Actions that put something in front of other people. */
        val PUBLISHING = setOf("forum.post", "forum.reply", "dm.send", "lostfound.post")
        /** Actions sent to the site, which take a moment. */
        val SITE = PUBLISHING + setOf("forum.like", "messages.readAll")
        /** 1.2's three levels: both looser ones become [Own]. */
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: if (id == "always") Always else Own
    }
}

/** Conversations as JSON, for this phone's file and for sync. */
object AssistantCodec {
    private val ID = Regex("^[A-Za-z0-9_-]{6,40}$")
    /** The server keeps a conversation up to 120000 characters; stay below it. */
    const val SYNC_LIMIT = 100_000

    fun newId(prefix: String = ""): String = prefix + java.util.UUID.randomUUID().toString().replace("-", "").take(16)

    fun messageToJson(message: AssistantMessage): JSONObject = JSONObject()
        .put("id", message.id).put("fromUser", message.fromUser).put("text", message.text).put("failed", message.failed)
        .put("links", JSONArray(message.links.map { JSONObject().put("label", it.label.take(40)).put("url", it.url.take(300)) }))
        .put("proposals", JSONArray(message.proposals.map {
            // A running action is stored as pending: if the app stops meanwhile, it reads back as not done.
            JSONObject().put("id", it.id).put("action", it.action).put("state", (if (it.state == ProposalState.Running) ProposalState.Pending else it.state).name)
                .put("note", it.note.take(200)).put("auto", it.auto).put("link", it.link.take(300))
        }))

    fun messageFromJson(item: JSONObject): AssistantMessage? {
        val id = item.optString("id").takeIf { it.isNotEmpty() } ?: return null
        val message = AssistantMessage(
            id = id.take(40),
            fromUser = item.optBoolean("fromUser"),
            text = item.optString("text"),
            links = item.optJSONArray("links")?.let { links ->
                (0 until links.length()).mapNotNull { i -> links.optJSONObject(i)?.let { AssistantLink(it.optString("label"), it.optString("url")) } }
            }.orEmpty(),
            proposals = item.optJSONArray("proposals")?.let { list ->
                (0 until list.length()).mapNotNull { i ->
                    val proposal = list.optJSONObject(i) ?: return@mapNotNull null
                    val action = proposal.optJSONObject("action") ?: return@mapNotNull null
                    // A proposal left pending when the app closed is stale: show it as dismissed.
                    val state = runCatching { ProposalState.valueOf(proposal.optString("state")) }.getOrDefault(ProposalState.Dismissed)
                    AssistantProposal(proposal.optString("id").ifEmpty { newId() }, action,
                        if (state == ProposalState.Pending || state == ProposalState.Running) ProposalState.Dismissed else state,
                        proposal.optString("note"), proposal.optBoolean("auto"), proposal.optString("link").takeIf { it.startsWith("/") }.orEmpty())
                }
            }.orEmpty(),
            failed = item.optBoolean("failed"),
        )
        return message.takeIf { it.text.isNotBlank() || it.proposals.isNotEmpty() }
    }

    /** The stored form; [limit] drops the oldest messages until it fits. */
    fun conversationToJson(conversation: AssistantConversation, limit: Int = Int.MAX_VALUE): JSONObject {
        var messages = conversation.messages.filter { !it.streaming }.takeLast(MAX_MESSAGES)
        while (true) {
            val json = JSONObject().put("title", conversation.title.take(60))
                .put("messages", JSONArray(messages.map { messageToJson(it.copy(text = it.text.take(8_000))) }))
            if (json.toString().length <= limit || messages.size <= 1) return json
            messages = messages.drop(2)
        }
    }

    fun conversationFromJson(id: String, updatedAt: Long, json: JSONObject): AssistantConversation? {
        if (!ID.matches(id)) return null
        val array = json.optJSONArray("messages") ?: JSONArray()
        val messages = (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(::messageFromJson) }.takeLast(MAX_MESSAGES)
        return AssistantConversation(id, json.optString("title").take(60), updatedAt, messages)
    }

    /** A title from the first question: its first line, short. */
    fun titleFor(question: String): String = question.lineSequence().firstOrNull().orEmpty().trim().take(24).ifEmpty { "新对话" }

    const val MAX_MESSAGES = 60
}

/**
 * 拾间AI in personal mode: conversations kept on this phone (and synced to the
 * user's other phones), questions sent to the site's agent endpoint with the
 * WebView's session, and proposed actions that wait for the user unless the
 * confirmation setting lets them run. When an answer needs grades or exams
 * (and the user allows it), the app reads them and asks once more.
 */
class AssistantSession(context: Context, private val scope: CoroutineScope) {
    private val file = File(context.filesDir, "assistant-conversations.json")
    private val legacyFile = File(context.filesDir, "assistant-conversation.json")
    private val prefs = context.getSharedPreferences("assistant", Context.MODE_PRIVATE)

    /** Newest first. */
    var conversations by mutableStateOf<List<AssistantConversation>>(emptyList())
        private set
    private var deleted: Map<String, Long> = emptyMap()
    /** The conversation on screen; null is a new one that starts with the next question. */
    var currentId by mutableStateOf<String?>(null)
        private set
    val current: AssistantConversation? get() = conversations.firstOrNull { it.id == currentId }
    val messages: List<AssistantMessage> get() = current?.messages.orEmpty()

    var sending by mutableStateOf(false)
        private set
    /** The conversation an answer is being written into. */
    var sendingIn by mutableStateOf<String?>(null)
        private set
    /** Whether questions carry the timetable and agenda. */
    var personal by mutableStateOf(prefs.getBoolean(KEY_PERSONAL, false))
        private set
    /** True once the user has read what personal mode sends. */
    var consented by mutableStateOf(prefs.getBoolean(KEY_CONSENT, false))
        private set
    /** Whether 拾间AI may have grades and exams read when a question needs them. */
    var academic by mutableStateOf(prefs.getBoolean(KEY_ACADEMIC, false))
        private set
    /** Whether questions carry the latest announcement and hot-post titles (public, so on by default). */
    var campus by mutableStateOf(prefs.getBoolean(KEY_CAMPUS, true))
        private set
    /** Whether 拾间AI may read the forum and other public site content (on by default). */
    var forum by mutableStateOf(prefs.getBoolean(KEY_FORUM, true))
        private set
    /** Whether 拾间AI may read the user's notifications and private messages. */
    var privateMessages by mutableStateOf(prefs.getBoolean(KEY_MESSAGES, false))
        private set
    var approval by mutableStateOf(ApprovalMode.of(prefs.getString(KEY_APPROVAL, null)))
        private set
    /** What the app is doing for the answer being written, such as reading grades. */
    var status by mutableStateOf<String?>(null)
        private set
    var quota by mutableStateOf<String?>(null)
        private set
    /** Told the id of a conversation changed here (not by sync). */
    var onLocalChange: ((String) -> Unit)? = null
    /** Told when an answer is complete, so proposals the confirmation setting allows can run. */
    var onAnswered: ((conversationId: String, message: AssistantMessage) -> Unit)? = null
    private var job: Job? = null
    private var connection: HttpURLConnection? = null

    init {
        load()
    }

    fun setPersonalMode(on: Boolean) {
        personal = on
        if (on) consented = true
        prefs.edit().putBoolean(KEY_PERSONAL, on).putBoolean(KEY_CONSENT, consented).apply()
    }

    fun setAcademicAccess(on: Boolean) {
        academic = on
        prefs.edit().putBoolean(KEY_ACADEMIC, on).apply()
    }

    fun setCampusAccess(on: Boolean) {
        campus = on
        prefs.edit().putBoolean(KEY_CAMPUS, on).apply()
    }

    fun setForumAccess(on: Boolean) {
        forum = on
        prefs.edit().putBoolean(KEY_FORUM, on).apply()
    }

    fun setMessageAccess(on: Boolean) {
        privateMessages = on
        prefs.edit().putBoolean(KEY_MESSAGES, on).apply()
    }

    fun setApprovalMode(mode: ApprovalMode) {
        approval = mode
        prefs.edit().putString(KEY_APPROVAL, mode.id).apply()
    }

    // region Conversations

    /** Starts over: the next question opens a new conversation. */
    fun newConversation() {
        currentId = null
        prefs.edit().remove(KEY_CURRENT).apply()
    }

    fun open(id: String) {
        if (conversations.none { it.id == id }) return
        currentId = id
        prefs.edit().putString(KEY_CURRENT, id).apply()
    }

    fun rename(id: String, title: String) {
        val name = title.trim().take(60).ifEmpty { return }
        change(id) { it.copy(title = name) }
    }

    fun delete(id: String, now: Long = System.currentTimeMillis()) {
        if (sendingIn == id) stop()
        conversations = conversations.filterNot { it.id == id }
        deleted = deleted + (id to now)
        if (currentId == id) newConversation()
        save()
        onLocalChange?.invoke(id)
    }

    /** When [id] was deleted here, or null. */
    fun deletedAt(id: String): Long? = deleted[id]

    fun deletedIds(): Set<String> = deleted.keys

    /**
     * Takes another device's version of a conversation ([conversation] null:
     * its deletion) when it is newer. The one being answered waits until done.
     */
    fun applyRemote(id: String, conversation: AssistantConversation?, updatedAt: Long): Boolean {
        if (sendingIn == id) return false
        val local = conversations.firstOrNull { it.id == id }
        val localAt = local?.updatedAt ?: deleted[id] ?: 0L
        if (updatedAt <= localAt) return false
        if (conversation == null) {
            deleted = deleted + (id to updatedAt)
            conversations = conversations.filterNot { it.id == id }
            if (currentId == id) currentId = null
        } else {
            deleted = deleted - id
            conversations = sorted(conversations.filterNot { it.id == id } + conversation.copy(updatedAt = updatedAt))
        }
        save()
        return true
    }

    /** Forgets every conversation (another account takes over this phone). */
    fun clearAll() {
        stop()
        conversations = emptyList()
        deleted = emptyMap()
        newConversation()
        save()
    }

    // endregion

    fun stop() {
        job?.cancel()
        runCatching { connection?.disconnect() }
        job = null
        status = null
        if (sending) {
            sending = false
            val id = sendingIn
            sendingIn = null
            if (id != null) change(id) { conversation ->
                conversation.copy(messages = conversation.messages.map { if (it.streaming) it.copy(streaming = false, text = it.text.ifEmpty { "已停止" }) else it })
            }
        }
    }

    /**
     * Sends [text] in the conversation on screen (a new one when there is
     * none). [personalContext] builds what the question carries at that moment,
     * with the data read so far; [readData] reads grades or exams when 拾间AI
     * asks for them (at most twice per question).
     */
    fun send(text: String, personalContext: suspend (toolResults: JSONArray) -> JSONObject, readData: suspend (request: JSONObject) -> AgentData) {
        val question = text.trim().take(500)
        if (question.isEmpty() || sending) return
        val conversationId = currentId?.takeIf { id -> conversations.any { it.id == id } } ?: AssistantCodec.newId("c").also { id ->
            conversations = sorted(conversations + AssistantConversation(id, AssistantCodec.titleFor(question), System.currentTimeMillis(), emptyList()))
                .take(MAX_CONVERSATIONS)
            open(id)
        }
        val history = messagesOf(conversationId).filter { !it.failed && it.text.isNotBlank() }.takeLast(20).map {
            JSONObject().put("role", if (it.fromUser) "user" else "assistant").put("content", it.text.take(4_000))
        }
        val reply = AssistantMessage(id = AssistantCodec.newId(), fromUser = false, text = "", streaming = true)
        // Saved with the question at once (the answer joins when it is complete).
        change(conversationId) { it.copy(messages = it.messages + AssistantMessage(id = AssistantCodec.newId(), fromUser = true, text = question) + reply) }
        sending = true
        sendingIn = conversationId
        job = scope.launch {
            val toolResults = JSONArray()
            var rounds = 0
            while (true) {
                val body = JSONObject().put("message", question).put("history", JSONArray(history)).put("personal", personalContext(toolResults))
                val outcome = withContext(Dispatchers.IO) { runCatching { stream(body) { delta -> scope.launch { appendDelta(conversationId, reply.id, delta) } } } }
                val done = outcome.getOrElse { error ->
                    updateMessage(conversationId, reply.id) { it.copy(streaming = false, failed = true, text = it.text.ifEmpty { error.message ?: "拾间AI暂时不可用，请稍后再试" }) }
                    null
                } ?: break
                val requests = readRequests(done)
                if (requests.isEmpty() || rounds >= MAX_DATA_ROUNDS || toolResults.length() + requests.size > MAX_TOOL_RESULTS) {
                    finish(conversationId, reply.id, done)
                    break
                }
                rounds += 1
                // "Let me check" gives way to what the app is doing, then to the real answer.
                updateMessage(conversationId, reply.id) { it.copy(text = "") }
                val failures = mutableListOf<Pair<JSONObject, String>>()
                for (request in requests) {
                    status = readingLabel(request)
                    val read = readData(request)
                    val data = read.data?.takeIf { it.length <= MAX_DATA_LENGTH }
                    val source = if (request.optString("type") == "read") "site" else request.optString("source")
                    val entry = JSONObject().put("source", source).put("path", request.optString("path").take(300)).put("semester", request.optString("semester"))
                    if (data != null) {
                        toolResults.put(entry.put("data", data))
                    } else {
                        val error = read.error ?: "读取失败，请稍后重试"
                        failures += request to error
                        toolResults.put(entry.put("data", JSONObject().put("error", error).toString()))
                    }
                }
                status = null
                if (failures.size == requests.size) {
                    // Nothing was read: say why at once instead of asking again.
                    val (request, error) = failures.first()
                    val academic = request.optString("type") == "data.request"
                    updateMessage(conversationId, reply.id) {
                        it.copy(streaming = false, text = "没能读到${readingWhat(request)}：$error",
                            links = if (academic) listOf(AssistantLink("打开教务", "/jwxt")) else emptyList())
                    }
                    break
                }
            }
            status = null
            sending = false
            sendingIn = null
            change(conversationId) { it }
            messagesOf(conversationId).firstOrNull { it.id == reply.id }?.let { onAnswered?.invoke(conversationId, it) }
            refreshQuota()
        }
    }

    /** Asks the last question again, in place of its answer. */
    fun regenerate(personalContext: suspend (JSONArray) -> JSONObject, readData: suspend (JSONObject) -> AgentData) {
        val question = takeBackLastQuestion() ?: return
        send(question, personalContext, readData)
    }

    /** Removes the last question and its answer, and returns the question to edit. */
    fun takeBackLastQuestion(): String? {
        val id = currentId ?: return null
        if (sending) return null
        val list = messagesOf(id)
        val index = list.indexOfLast { it.fromUser }
        if (index < 0) return null
        change(id) { it.copy(messages = list.take(index)) }
        return list[index].text
    }

    fun setProposal(messageId: String, proposalId: String, state: ProposalState, note: String = "", auto: Boolean = false, link: String = "") {
        changeProposal(messageId, proposalId) { it.copy(state = state, note = note, auto = auto, link = link) }
    }

    /** The user's edit of a proposal before it runs (a post's text, a reply). */
    fun updateProposalAction(messageId: String, proposalId: String, action: JSONObject) {
        changeProposal(messageId, proposalId) { it.copy(action = action) }
    }

    private fun changeProposal(messageId: String, proposalId: String, transform: (AssistantProposal) -> AssistantProposal) {
        val conversation = conversations.firstOrNull { c -> c.messages.any { it.id == messageId } } ?: return
        change(conversation.id) { c ->
            c.copy(messages = c.messages.map { message ->
                if (message.id != messageId) message
                else message.copy(proposals = message.proposals.map { if (it.id == proposalId) transform(it) else it })
            })
        }
    }

    /** The conversation holding [messageId]. */
    fun conversationOf(messageId: String): String? = conversations.firstOrNull { c -> c.messages.any { it.id == messageId } }?.id

    /** Debug fixture only: show a prepared conversation. */
    internal fun debugSeed(sample: List<AssistantMessage>, title: String = "明天的安排") {
        val id = "cdebugsample01"
        conversations = sorted(conversations.filterNot { it.id == id } + AssistantConversation(id, title, System.currentTimeMillis(), sample))
        currentId = id
    }

    fun refreshQuota() {
        scope.launch {
            val reply = withContext(Dispatchers.IO) { runCatching { SiteHttp.request("/api/search/assistant/quota", "GET") }.getOrNull() } ?: return@launch
            val data = reply.data ?: return@launch
            val remaining = data.optInt("totalRemaining", data.optInt("remaining", -1))
            quota = if (remaining >= 0) "今天还能问 $remaining 次" else null
        }
    }

    // region Internals

    private fun messagesOf(id: String) = conversations.firstOrNull { it.id == id }?.messages.orEmpty()

    /** Changes one conversation; [touch] marks it edited now (and saved and synced). */
    private fun change(id: String, touch: Boolean = true, transform: (AssistantConversation) -> AssistantConversation) {
        val existing = conversations.firstOrNull { it.id == id } ?: return
        val next = transform(existing).let { if (touch) it.copy(updatedAt = maxOf(System.currentTimeMillis(), existing.updatedAt + 1)) else it }
        conversations = if (touch) sorted(conversations.map { if (it.id == id) next else it }) else conversations.map { if (it.id == id) next else it }
        if (touch) {
            save()
            onLocalChange?.invoke(id)
        }
    }

    private fun updateMessage(conversationId: String, messageId: String, transform: (AssistantMessage) -> AssistantMessage) =
        change(conversationId, touch = false) { c -> c.copy(messages = c.messages.map { if (it.id == messageId) transform(it) else it }) }

    private fun appendDelta(conversationId: String, messageId: String, delta: String) = updateMessage(conversationId, messageId) { it.copy(text = it.text + delta) }

    /** What a reply asks the app to read (site paths, grades, exams), when reading is all it asks. */
    private fun readRequests(done: JSONObject): List<JSONObject> {
        val actions = done.optJSONArray("clientActions") ?: return emptyList()
        val list = (0 until actions.length()).mapNotNull { actions.optJSONObject(it) }
        if (list.isEmpty() || list.any { it.optString("type") != "data.request" && it.optString("type") != "read" }) return emptyList()
        return list.filter { request ->
            when (request.optString("type")) {
                "read" -> request.optString("path").startsWith("/")
                else -> request.optString("source") == "grades" || request.optString("source") == "exams"
            }
        }.take(3)
    }

    private fun readingWhat(request: JSONObject): String {
        if (request.optString("type") == "data.request") return if (request.optString("source") == "grades") "你的成绩" else "你的考试安排"
        val path = request.optString("path")
        return when {
            path.startsWith("/topics/") || path.startsWith("/search") || path.startsWith("/topics") -> "论坛内容"
            path.startsWith("/messages") || path.startsWith("/direct-messages") -> "你的消息"
            path.startsWith("/lost-found") -> "失物招领"
            path.startsWith("/courses") -> "课程点评"
            path.startsWith("/home") -> "热榜"
            path.startsWith("/user") -> "用户主页"
            else -> "站内内容"
        }
    }

    private fun readingLabel(request: JSONObject): String {
        val path = request.optString("path")
        return when {
            request.optString("type") == "data.request" -> "正在查看${readingWhat(request)}…"
            Regex("^/topics/\\d+").containsMatchIn(path) -> "正在看帖子…"
            path.startsWith("/topics") || path.startsWith("/search") -> "正在论坛里找…"
            else -> "正在查看${readingWhat(request)}…"
        }
    }

    private fun finish(conversationId: String, messageId: String, done: JSONObject) {
        val links = done.optJSONArray("actions")?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                val action = array.optJSONObject(index) ?: return@mapNotNull null
                val url = action.optString("url")
                if (url.isEmpty()) null else AssistantLink(action.optString("label").ifEmpty { "打开" }, url)
            }
        }.orEmpty()
        val proposals = done.optJSONArray("clientActions")?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                // A request to read past the last round is not something to confirm.
                array.optJSONObject(index)?.takeIf { it.optString("type") != "data.request" && it.optString("type") != "read" }?.let { AssistantProposal(AssistantCodec.newId(), it) }
            }
        }.orEmpty()
        val suggestions = done.optJSONArray("suggestions")?.let { array ->
            (0 until array.length()).mapNotNull { array.optString(it).takeIf { s -> s.isNotBlank() } }
        }.orEmpty()
        updateMessage(conversationId, messageId) {
            it.copy(
                text = done.optString("answer").ifBlank { it.text },
                links = links.take(3), proposals = proposals.take(6), suggestions = suggestions.take(3),
                streaming = false, failed = done.optBoolean("fallback", false) && proposals.isEmpty() && it.text.isEmpty(),
            )
        }
    }

    /** Posts to the agent stream and reads its events until `done`; throws with a message the user can read. */
    private fun stream(body: JSONObject, onDelta: (String) -> Unit): JSONObject {
        val http = SiteHttp.open("/api/search/assistant/agent/stream", "POST", timeoutMs = 120_000)
        connection = http
        try {
            http.setRequestProperty("Accept", "text/event-stream")
            http.doOutput = true
            http.outputStream.use { it.write(body.toString().toByteArray()) }
            val status = http.responseCode
            if (status !in 200..299) {
                val message = runCatching {
                    JSONObject((http.errorStream ?: http.inputStream).bufferedReader().use { it.readText() }).optString("message")
                }.getOrNull()
                error(when {
                    status == 401 -> "请先登录药大拾间"
                    !message.isNullOrBlank() -> message
                    else -> "拾间AI暂时不可用（$status）"
                })
            }
            var event = ""
            val data = StringBuilder()
            http.inputStream.bufferedReader().useLines { lines ->
                for (line in lines) {
                    when {
                        line.startsWith("event:") -> event = line.substringAfter(':').trim()
                        line.startsWith("data:") -> data.append(line.substringAfter(':').trimStart())
                        line.isEmpty() && data.isNotEmpty() -> {
                            val payload = runCatching { JSONObject(data.toString()) }.getOrNull()
                            data.clear()
                            when (event) {
                                "delta" -> payload?.optString("delta")?.takeIf { it.isNotEmpty() }?.let(onDelta)
                                "done" -> return payload ?: error("拾间AI返回格式异常")
                                "error" -> error(payload?.optString("message")?.ifBlank { null } ?: "拾间AI暂时不可用，请稍后再试")
                            }
                        }
                    }
                }
            }
            error("连接中断了，请重试")
        } finally {
            http.disconnect()
            connection = null
        }
    }

    private fun sorted(list: List<AssistantConversation>) = list.sortedByDescending { it.updatedAt }

    private fun load() {
        val raw = runCatching { if (file.exists()) file.readText() else null }.getOrNull()
        if (raw != null) {
            val json = runCatching { JSONObject(raw) }.getOrNull() ?: return
            val array = json.optJSONArray("conversations") ?: JSONArray()
            conversations = sorted((0 until array.length()).mapNotNull { index ->
                val item = array.optJSONObject(index) ?: return@mapNotNull null
                AssistantCodec.conversationFromJson(item.optString("id"), item.optLong("updatedAt"), item)
            })
            deleted = json.optJSONObject("deleted")?.let { d -> d.keys().asSequence().associateWith { d.optLong(it) }.filterValues { it > 0 } }.orEmpty()
            currentId = prefs.getString(KEY_CURRENT, null)?.takeIf { id -> conversations.any { it.id == id } }
            return
        }
        // 1.1: one conversation in its own file becomes the first of the list.
        val legacy = runCatching { JSONObject(legacyFile.readText()) }.getOrNull() ?: return
        val messages = legacy.optJSONArray("messages")?.let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(AssistantCodec::messageFromJson) } }.orEmpty()
        if (messages.isNotEmpty()) {
            val id = AssistantCodec.newId("c")
            conversations = listOf(AssistantConversation(id, AssistantCodec.titleFor(messages.firstOrNull { it.fromUser }?.text.orEmpty()), System.currentTimeMillis(), messages))
            currentId = id
            prefs.edit().putString(KEY_CURRENT, id).apply()
        }
        save()
        legacyFile.delete()
    }

    private fun save() {
        val horizon = System.currentTimeMillis() - TOMBSTONE_LIFETIME_MS
        deleted = deleted.filterValues { it > horizon }
        val array = JSONArray(conversations.take(MAX_CONVERSATIONS).map { conversation ->
            AssistantCodec.conversationToJson(conversation).put("id", conversation.id).put("updatedAt", conversation.updatedAt)
        })
        val body = JSONObject().put("v", 2).put("conversations", array)
            .put("deleted", JSONObject().apply { deleted.forEach { (id, at) -> put(id, at) } })
        runCatching {
            val temp = File(file.parentFile, file.name + ".tmp")
            temp.writeText(body.toString())
            if (!temp.renameTo(file)) {
                file.writeText(body.toString())
                temp.delete()
            }
        }
    }

    // endregion

    companion object {
        private const val KEY_PERSONAL = "personal"
        private const val KEY_CONSENT = "consent"
        private const val KEY_ACADEMIC = "academic"
        private const val KEY_CAMPUS = "campus"
        private const val KEY_APPROVAL = "approval"
        private const val KEY_FORUM = "forum"
        private const val KEY_MESSAGES = "messages"
        private const val KEY_CURRENT = "current"
        private const val MAX_CONVERSATIONS = 100
        private const val MAX_DATA_ROUNDS = 4
        /** The server takes at most this many results with one question. */
        private const val MAX_TOOL_RESULTS = 8
        /** The server takes at most this much of one result. */
        private const val MAX_DATA_LENGTH = 12_000
        private const val TOMBSTONE_LIFETIME_MS = 180L * 24 * 60 * 60 * 1000
    }
}
