package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.webkit.CookieManager
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
import java.net.URL

/** A link to a site page the answer recommends. */
data class AssistantLink(val label: String, val url: String)

enum class ProposalState { Pending, Applied, Dismissed, Failed }

/** An action 拾间AI proposed; nothing happens until the user confirms it. */
data class AssistantProposal(val id: String, val action: JSONObject, val state: ProposalState = ProposalState.Pending, val note: String = "")

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

/** Grades or exams the app read for 拾间AI: compact JSON, or why it could not be read. */
data class AgentData(val data: String? = null, val error: String? = null)

/**
 * The conversation with 拾间AI in personal mode. Questions go to the site's
 * agent endpoint with the WebView's session; the answer streams in, and its
 * proposed actions wait for the user. When it needs grades or exams (and the
 * user allows it), the app reads them and asks once more with them attached.
 * The conversation stays on this phone.
 */
class AssistantSession(context: Context, private val scope: CoroutineScope) {
    private val file = File(context.filesDir, "assistant-conversation.json")
    private val prefs = context.getSharedPreferences("assistant", Context.MODE_PRIVATE)

    var messages by mutableStateOf(load())
        private set
    var sending by mutableStateOf(false)
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
    /** What the app is doing for the answer being written, such as reading grades. */
    var status by mutableStateOf<String?>(null)
        private set
    var quota by mutableStateOf<String?>(null)
        private set
    private var job: Job? = null
    private var connection: HttpURLConnection? = null

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

    fun clear() {
        stop()
        messages = emptyList()
        save()
    }

    fun stop() {
        job?.cancel()
        runCatching { connection?.disconnect() }
        job = null
        status = null
        if (sending) {
            sending = false
            messages = messages.map { if (it.streaming) it.copy(streaming = false, text = it.text.ifEmpty { "已停止" }) else it }
            save()
        }
    }

    /**
     * Sends [text]. [personalContext] builds what the question carries at that
     * moment, with the data read so far; [readData] reads grades or exams when
     * 拾间AI asks for them (at most twice per question).
     */
    fun send(text: String, personalContext: suspend (toolResults: JSONArray) -> JSONObject, readData: suspend (source: String, semester: String) -> AgentData) {
        val question = text.trim().take(500)
        if (question.isEmpty() || sending) return
        val history = messages.filter { !it.failed && it.text.isNotBlank() }.takeLast(20).map {
            JSONObject().put("role", if (it.fromUser) "user" else "assistant").put("content", it.text.take(4_000))
        }
        val reply = AssistantMessage(id = newId(), fromUser = false, text = "", streaming = true)
        messages = messages + AssistantMessage(id = newId(), fromUser = true, text = question) + reply
        sending = true
        job = scope.launch {
            val toolResults = JSONArray()
            while (true) {
                val body = JSONObject().put("message", question).put("history", JSONArray(history)).put("personal", personalContext(toolResults))
                val outcome = withContext(Dispatchers.IO) { runCatching { stream(body) { delta -> scope.launch { appendDelta(reply.id, delta) } } } }
                val done = outcome.getOrElse { error ->
                    update(reply.id) { it.copy(streaming = false, failed = true, text = it.text.ifEmpty { error.message ?: "拾间AI暂时不可用，请稍后再试" }) }
                    null
                } ?: break
                val request = dataRequest(done)
                if (request == null || toolResults.length() >= MAX_DATA_ROUNDS) {
                    finish(reply.id, done)
                    break
                }
                // "Let me check" gives way to what the app is doing, then to the real answer.
                val (source, semester) = request
                val what = if (source == "grades") "成绩" else "考试安排"
                update(reply.id) { it.copy(text = "") }
                status = "正在查看你的$what…"
                val read = readData(source, semester)
                status = null
                val data = read.data?.takeIf { it.length <= MAX_DATA_LENGTH }
                if (data == null) {
                    update(reply.id) {
                        it.copy(streaming = false, text = "没能读到你的$what：${read.error ?: "读取失败，请稍后重试"}",
                            links = listOf(AssistantLink("打开教务", "/jwxt")))
                    }
                    break
                }
                toolResults.put(JSONObject().put("source", source).put("semester", semester).put("data", data))
            }
            status = null
            sending = false
            save()
            refreshQuota()
        }
    }

    /** The grades or exams a reply asks the app to read, when that is all it asks. */
    private fun dataRequest(done: JSONObject): Pair<String, String>? {
        val actions = done.optJSONArray("clientActions") ?: return null
        val action = actions.optJSONObject(0)?.takeIf { actions.length() == 1 && it.optString("type") == "data.request" } ?: return null
        val source = action.optString("source").takeIf { it == "grades" || it == "exams" } ?: return null
        return source to action.optString("semester").takeIf { Regex("^\\d{4}-\\d{4}-[12]$").matches(it) }.orEmpty()
    }

    fun setProposal(messageId: String, proposalId: String, state: ProposalState, note: String = "") {
        update(messageId) { message ->
            message.copy(proposals = message.proposals.map { if (it.id == proposalId) it.copy(state = state, note = note) else it })
        }
        save()
    }

    /** Debug fixture only: show a prepared conversation. */
    internal fun debugSeed(sample: List<AssistantMessage>) {
        messages = sample
    }

    fun refreshQuota() {
        scope.launch {
            val text = withContext(Dispatchers.IO) { runCatching { get("/api/search/assistant/quota") }.getOrNull() } ?: return@launch
            val data = runCatching { JSONObject(text).optJSONObject("data") }.getOrNull() ?: return@launch
            val remaining = data.optInt("totalRemaining", data.optInt("remaining", -1))
            quota = if (remaining >= 0) "今天还能问 $remaining 次" else null
        }
    }

    private fun appendDelta(id: String, delta: String) = update(id) { it.copy(text = it.text + delta) }

    private fun finish(id: String, done: JSONObject) {
        val links = done.optJSONArray("actions")?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                val action = array.optJSONObject(index) ?: return@mapNotNull null
                val url = action.optString("url")
                if (url.isEmpty()) null else AssistantLink(action.optString("label").ifEmpty { "打开" }, url)
            }
        }.orEmpty()
        val proposals = done.optJSONArray("clientActions")?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                // A request for data past the last round is not something to confirm.
                array.optJSONObject(index)?.takeIf { it.optString("type") != "data.request" }?.let { AssistantProposal(newId(), it) }
            }
        }.orEmpty()
        val suggestions = done.optJSONArray("suggestions")?.let { array ->
            (0 until array.length()).mapNotNull { array.optString(it).takeIf { s -> s.isNotBlank() } }
        }.orEmpty()
        update(id) {
            it.copy(
                text = done.optString("answer").ifBlank { it.text },
                links = links.take(3), proposals = proposals.take(6), suggestions = suggestions.take(3),
                streaming = false, failed = done.optBoolean("fallback", false) && proposals.isEmpty() && it.text.isEmpty(),
            )
        }
    }

    private fun update(id: String, change: (AssistantMessage) -> AssistantMessage) {
        messages = messages.map { if (it.id == id) change(it) else it }
    }

    /** Posts to the agent stream and reads its events until `done`; throws with a message the user can read. */
    private fun stream(body: JSONObject, onDelta: (String) -> Unit): JSONObject {
        val url = AppConfig.routeUrl("/api/search/assistant/agent/stream") ?: error("拾间AI暂时不可用")
        val http = open(url, "POST")
        connection = http
        try {
            http.setRequestProperty("Accept", "text/event-stream")
            http.readTimeout = 120_000
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

    private fun get(path: String): String? {
        val url = AppConfig.routeUrl(path) ?: return null
        val http = open(url, "GET")
        return try {
            if (http.responseCode in 200..299) http.inputStream.bufferedReader().use { it.readText() } else null
        } finally {
            http.disconnect()
        }
    }

    /** A request with the WebView's site session and CSRF token, as the page itself would send. */
    private fun open(url: String, method: String): HttpURLConnection {
        val cookies = runCatching { CookieManager.getInstance().getCookie(AppConfig.origin) }.getOrNull().orEmpty()
        return (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = false
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("User-Agent", AppConfig.userAgentSuffix(BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME))
            setRequestProperty("X-CPU-Auth-Mode", "cookie")
            setRequestProperty("X-CPU-Client", "android-app")
            if (cookies.isNotEmpty()) {
                setRequestProperty("Cookie", cookies)
                ClientStats.csrfToken(cookies)?.let { setRequestProperty("X-CSRF-Token", it) }
            }
        }
    }

    private fun load(): List<AssistantMessage> = runCatching {
        val array = JSONObject(file.readText()).optJSONArray("messages") ?: return emptyList()
        (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            AssistantMessage(
                id = item.optString("id").ifEmpty { newId() },
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
                            if (state == ProposalState.Pending) ProposalState.Dismissed else state, proposal.optString("note"))
                    }
                }.orEmpty(),
                failed = item.optBoolean("failed"),
            )
        }.filter { it.text.isNotBlank() || it.proposals.isNotEmpty() }
    }.getOrDefault(emptyList())

    private fun save() {
        val array = JSONArray(messages.filter { !it.streaming }.takeLast(MAX_STORED).map { message ->
            JSONObject().put("id", message.id).put("fromUser", message.fromUser).put("text", message.text).put("failed", message.failed)
                .put("links", JSONArray(message.links.map { JSONObject().put("label", it.label).put("url", it.url) }))
                .put("proposals", JSONArray(message.proposals.map {
                    JSONObject().put("id", it.id).put("action", it.action).put("state", it.state.name).put("note", it.note)
                }))
        })
        runCatching { file.writeText(JSONObject().put("messages", array).toString()) }
    }

    private fun newId(): String = java.util.UUID.randomUUID().toString().take(12)

    companion object {
        private const val KEY_PERSONAL = "personal"
        private const val KEY_CONSENT = "consent"
        private const val KEY_ACADEMIC = "academic"
        private const val KEY_CAMPUS = "campus"
        private const val MAX_STORED = 60
        private const val MAX_DATA_ROUNDS = 2
        /** The server takes at most this much of one result. */
        private const val MAX_DATA_LENGTH = 12_000
    }
}
