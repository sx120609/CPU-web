package cn.lizmt.cpuweb.schedule.custom

import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog.ACADEMIC
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog.AGENDA
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog.ASSISTANT
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog.DASHBOARD
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog.HOME
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog.PROFILE
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog.SCHEDULE
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog.SERVICES
import org.json.JSONArray
import org.json.JSONObject

enum class TabBarStyle(val id: String, val title: String) {
    Floating("floating", "悬浮"),
    Docked("docked", "贴底");

    companion object {
        /** Retired looks (glass, minimal) open as the floating bar. */
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: Floating
    }
}

enum class TabLabelMode(val id: String, val title: String) {
    Always("always", "显示"),
    Selected("selected", "仅当前"),
    Never("never", "不显示");

    companion object {
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: Always
    }
}

enum class UiDensity(val id: String, val title: String, val scale: Float) {
    Compact("compact", "紧凑", 0.86f),
    Standard("standard", "标准", 1f),
    Comfortable("comfortable", "宽松", 1.14f);

    companion object {
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: Standard
    }
}

enum class BackBehavior(val id: String, val title: String, val detail: String) {
    LaunchTab("launch", "先回到启动页", "在其他页面按返回，先回到启动页，再按一次退出"),
    DoubleExit("double", "连按两次退出", "在任意根页面连按两次返回才退出，避免误触"),
    Exit("exit", "直接退出", "根页面按返回立即退出");

    companion object {
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: LaunchTab
    }
}

data class TopBarOptions(
    val logo: Boolean = false,
    val refresh: Boolean = false,
    val messages: Boolean = true,
    val quickEntry: Boolean = true,
)

/** One section of 今天. Unused fields stay empty for section types that do not need them. */
data class DashboardCard(
    val id: String,
    val type: String,
    val title: String = "",
    val text: String = "",
    val date: String = "",
    val items: List<String> = emptyList(),
)

data class DashboardLayout(
    val cards: List<DashboardCard> = DEFAULT_DASHBOARD_CARDS,
)

object DashboardCards {
    val types = linkedMapOf(
        "next" to "下一项",
        "today" to "今天的安排",
        "todo" to "未完成",
        "upcoming" to "明天",
        "messages" to "未读消息",
        "shortcuts" to "常用入口",
        "announcements" to "校园公告",
        "hot" to "论坛热榜",
        "countdown" to "倒计时",
        "note" to "便签",
    )
    /** Section types that may appear more than once. */
    val repeatable = setOf("countdown", "note", "shortcuts")
}

val DEFAULT_DASHBOARD_CARDS = listOf(
    DashboardCard("next", "next"),
    DashboardCard("today", "today"),
    DashboardCard("todo", "todo"),
    DashboardCard("upcoming", "upcoming"),
    DashboardCard("messages", "messages"),
    DashboardCard(
        "shortcuts", "shortcuts", title = "常用",
        items = listOf("forum", "announcements", "market", "lostfound", "coursereview", "tools"),
    ),
    DashboardCard("announcements", "announcements"),
)

/** Optional style rules the user can switch on for the site's pages. */
data class WebTweak(val id: String, val title: String, val detail: String, val css: String)

object WebTweaks {
    private const val NATIVE = "html[data-cpu-android-native]"
    val all = listOf(
        WebTweak("hideHot", "隐藏首页热榜", "首页不再显示热榜条", "$NATIVE .home-stream > .hot-strip{display:none!important}"),
        WebTweak("hideEntry", "隐藏首页快捷入口", "首页从帖子流开始", "$NATIVE .home-stream > .home-entry{display:none!important}"),
        WebTweak("hideFab", "隐藏悬浮发帖按钮", "网页里的圆形发帖按钮", "$NATIVE .forum-post-fab{display:none!important}"),
        WebTweak("systemFont", "使用系统字体", "网页改用手机自带字体", "$NATIVE{--cpu-font-sans:system-ui,-apple-system,\"Noto Sans CJK SC\",sans-serif}"),
        WebTweak(
            "contrast", "加深次要文字", "灰色说明文字更清楚",
            "$NATIVE{--cpu-text-secondary:var(--cpu-text);--cpu-text-muted:#4e5661}" +
                "$NATIVE[data-theme=\"dark\"]{--cpu-text-muted:#b0b7c1}",
        ),
        WebTweak(
            "noMotion", "关闭网页动画", "过渡和动效一律跳过",
            "$NATIVE *,$NATIVE *::before,$NATIVE *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;" +
                "transition-duration:.01ms!important;scroll-behavior:auto!important}",
        ),
        WebTweak("grayscale", "黑白模式", "整个网页去掉颜色", "$NATIVE{filter:grayscale(1)}"),
    )
    val ids = all.map { it.id }.toSet()
}

val ACCENT_PRESETS = listOf(
    "brand" to "拾间青",
    "dynamic" to "跟随壁纸",
    "#1E6FD9" to "晴空蓝",
    "#4F55C9" to "靛青",
    "#7A4CC2" to "鸢尾紫",
    "#C2337A" to "樱桃粉",
    "#D2462E" to "珊瑚红",
    "#D46A00" to "柿子橙",
    "#A07800" to "琥珀",
    "#2E7D32" to "松绿",
    "#4A5866" to "石墨",
)

data class Customization(
    val tabs: List<String> = DEFAULT_TABS,
    val launchTab: String = DASHBOARD,
    val labels: Map<String, String> = emptyMap(),
    val icons: Map<String, String> = emptyMap(),
    val customPages: List<CustomPage> = emptyList(),
    val tabBarStyle: TabBarStyle = TabBarStyle.Floating,
    val tabLabels: TabLabelMode = TabLabelMode.Always,
    val topBar: TopBarOptions = TopBarOptions(),
    val postButton: Boolean = true,
    val quickEntries: List<String> = DEFAULT_QUICK_ENTRIES,
    val accent: String = "brand",
    val pureBlack: Boolean = false,
    val corners: Float = 1f,
    val density: UiDensity = UiDensity.Standard,
    val fontScale: Float = 1f,
    val webTheme: Boolean = true,
    val webTextZoom: Int = 100,
    val webTweaks: Set<String> = emptySet(),
    val customCss: String = "",
    val customCssEnabled: Boolean = false,
    val backAtRoot: BackBehavior = BackBehavior.LaunchTab,
    val haptics: Boolean = true,
    val reduceMotion: Boolean = false,
    val secureScreen: Boolean = false,
    val keepScreenOn: Boolean = false,
    val doubleTapRefresh: Boolean = true,
    val launcherShortcuts: List<String> = DEFAULT_LAUNCHER_SHORTCUTS,
    val dashboard: DashboardLayout = DashboardLayout(),
) {
    fun destination(id: String): Destination? = DestinationCatalog.resolve(id, customPages)?.let(::personalize)

    /** The catalog entry with the user's own name and icon. */
    fun personalize(destination: Destination): Destination = destination.copy(
        title = labels[destination.id] ?: destination.title,
        icon = icons[destination.id] ?: destination.icon,
    )

    val tabDestinations: List<Destination> get() = tabs.mapNotNull(::destination)
    val launchDestination: Destination get() = destination(launchTab) ?: tabDestinations.first()
    val catalog: List<Destination> get() = DestinationCatalog.all(customPages).map(::personalize)

    /** Web pages that are roots of a tab; the page bridge treats them like its own five roots. */
    val webTabRoots: List<String> get() = tabDestinations.filter { it.kind == DestinationKind.Web }.map { it.route }

    fun isChanged(): Boolean = this != Customization()
}

val DEFAULT_TABS = listOf(DASHBOARD, SCHEDULE, HOME, SERVICES, PROFILE)
val DEFAULT_QUICK_ENTRIES = listOf(
    AGENDA, ASSISTANT, "post", "messages", "forum", "announcements", ACADEMIC, "market", "ai", "admin", "settings",
)
val DEFAULT_LAUNCHER_SHORTCUTS = listOf(AGENDA, SCHEDULE, ASSISTANT)
const val MIN_TABS = 2
const val MAX_TABS = 6

/** Named layouts the user can start from; each keeps appearance, notes and custom pages. */
data class LayoutPreset(val id: String, val title: String, val detail: String, val apply: (Customization) -> Customization)

val LAYOUT_PRESETS = listOf(
    LayoutPreset("today", "今天", "今天 · 课表 · 首页 · 服务 · 我的") {
        it.copy(tabs = DEFAULT_TABS, launchTab = DASHBOARD, tabBarStyle = TabBarStyle.Floating, tabLabels = TabLabelMode.Always)
    },
    LayoutPreset("assistant", "个人助理", "今天 · 日程 · 拾间AI · 课表 · 我的") {
        it.copy(tabs = listOf(DASHBOARD, AGENDA, ASSISTANT, SCHEDULE, PROFILE), launchTab = DASHBOARD,
            tabBarStyle = TabBarStyle.Floating, tabLabels = TabLabelMode.Always)
    },
    LayoutPreset("classic", "正式版", "首页 · 教务 · 课表 · 服务 · 我的") {
        it.copy(tabs = listOf(HOME, ACADEMIC, SCHEDULE, SERVICES, PROFILE), launchTab = SCHEDULE,
            tabBarStyle = TabBarStyle.Floating, tabLabels = TabLabelMode.Always)
    },
    LayoutPreset("community", "社区", "首页 · 论坛 · 课表 · 消息 · 我的") {
        it.copy(tabs = listOf(HOME, "forum", SCHEDULE, "messages", PROFILE), launchTab = HOME,
            tabBarStyle = TabBarStyle.Docked, tabLabels = TabLabelMode.Always)
    },
    LayoutPreset("minimal", "极简", "今天 · 课表 · 我的，不显示文字") {
        it.copy(tabs = listOf(DASHBOARD, SCHEDULE, PROFILE), launchTab = DASHBOARD,
            tabBarStyle = TabBarStyle.Floating, tabLabels = TabLabelMode.Never, postButton = false)
    },
)

object CustomizationCodec {
    const val VERSION = 1
    private const val MAX_PAGES = 12
    private const val MAX_CARDS = 24
    private const val MAX_CSS = 20_000
    private val CUSTOM_ID = Regex("^custom:[a-z0-9]{1,12}$")
    private val CARD_ID = Regex("^[a-z0-9-]{1,24}$")
    private val HEX = Regex("^#[0-9A-Fa-f]{6}$")
    private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

    // region Encoding

    /** [private] false leaves out what a shared layout must not carry: note text. */
    fun toJson(value: Customization, private: Boolean = true): JSONObject = JSONObject()
        .put("v", VERSION)
        .put("tabs", JSONArray(value.tabs))
        .put("launchTab", value.launchTab)
        .put("labels", JSONObject(value.labels))
        .put("icons", JSONObject(value.icons))
        .put("customPages", JSONArray(value.customPages.map {
            JSONObject().put("id", it.id).put("title", it.title).put("route", it.route).put("icon", it.icon)
        }))
        .put("tabBarStyle", value.tabBarStyle.id)
        .put("tabLabels", value.tabLabels.id)
        .put("topBar", JSONObject().put("logo", value.topBar.logo).put("refresh", value.topBar.refresh)
            .put("messages", value.topBar.messages).put("quickEntry", value.topBar.quickEntry))
        .put("postButton", value.postButton)
        .put("quickEntries", JSONArray(value.quickEntries))
        .put("accent", value.accent)
        .put("pureBlack", value.pureBlack)
        .put("corners", value.corners.toDouble())
        .put("density", value.density.id)
        .put("fontScale", value.fontScale.toDouble())
        .put("webTheme", value.webTheme)
        .put("webTextZoom", value.webTextZoom)
        .put("webTweaks", JSONArray(value.webTweaks.sorted()))
        .put("customCss", value.customCss)
        .put("customCssEnabled", value.customCssEnabled)
        .put("backAtRoot", value.backAtRoot.id)
        .put("haptics", value.haptics)
        .put("reduceMotion", value.reduceMotion)
        .put("secureScreen", value.secureScreen)
        .put("keepScreenOn", value.keepScreenOn)
        .put("doubleTapRefresh", value.doubleTapRefresh)
        .put("launcherShortcuts", JSONArray(value.launcherShortcuts))
        .put("dashboard", JSONObject()
            .put("cards", JSONArray(value.dashboard.cards.map { card ->
                JSONObject().put("id", card.id).put("type", card.type).put("title", card.title)
                    .put("text", if (private || card.type != "note") card.text else "")
                    .put("date", card.date).put("items", JSONArray(card.items))
            })))

    // endregion

    // region Decoding

    /** Reads any stored or shared layout; anything unknown or out of range falls back to the default. */
    fun fromJson(json: JSONObject?): Customization {
        if (json == null) return Customization()
        val defaults = Customization()
        val customPages = pages(json.optJSONArray("customPages"))
        val resolvable = { id: String -> DestinationCatalog.resolve(id, customPages) != null }

        val tabs = normalizedTabs(strings(json.optJSONArray("tabs")) ?: defaults.tabs, customPages)
        val launch = json.optString("launchTab").takeIf { it in tabs } ?: tabs.first()
        val topBar = json.optJSONObject("topBar")
        val dashboard = json.optJSONObject("dashboard")
        return Customization(
            tabs = tabs,
            launchTab = launch,
            labels = stringMap(json.optJSONObject("labels"))
                .filterKeys(resolvable)
                .mapValues { (_, value) -> clip(value.trim(), 8) }
                .filterValues { it.isNotEmpty() },
            icons = stringMap(json.optJSONObject("icons")).filterKeys(resolvable).filterValues { it in SELECTABLE_ICONS },
            customPages = customPages,
            tabBarStyle = TabBarStyle.of(json.optString("tabBarStyle")),
            // The retired icon-only look keeps its labels hidden.
            tabLabels = if (json.optString("tabBarStyle") == "minimal" && !json.has("tabLabels")) TabLabelMode.Never
            else TabLabelMode.of(json.optString("tabLabels")),
            topBar = TopBarOptions(
                logo = topBar?.optBoolean("logo", false) ?: false,
                refresh = topBar?.optBoolean("refresh", false) ?: false,
                messages = topBar?.optBoolean("messages", true) ?: true,
                quickEntry = topBar?.optBoolean("quickEntry", true) ?: true,
            ),
            postButton = json.optBoolean("postButton", defaults.postButton),
            quickEntries = (strings(json.optJSONArray("quickEntries")) ?: defaults.quickEntries)
                .filter(resolvable).distinct().take(30),
            accent = json.optString("accent").let {
                when {
                    it == "brand" || it == "dynamic" -> it
                    HEX.matches(it) -> it.uppercase()
                    else -> "brand"
                }
            },
            pureBlack = json.optBoolean("pureBlack", false),
            corners = json.optDouble("corners", 1.0).toFloat().takeIf { it.isFinite() }?.coerceIn(0f, 1.6f) ?: 1f,
            density = UiDensity.of(json.optString("density")),
            fontScale = roundStep(json.optDouble("fontScale", 1.0).toFloat(), 0.05f, 0.85f, 1.3f, 1f),
            webTheme = json.optBoolean("webTheme", defaults.webTheme),
            webTextZoom = (json.optInt("webTextZoom", 100) / 5 * 5).coerceIn(80, 150),
            webTweaks = (strings(json.optJSONArray("webTweaks")) ?: emptyList()).filter { it in WebTweaks.ids }.toSet(),
            customCss = clip(json.optString("customCss"), MAX_CSS),
            customCssEnabled = json.optBoolean("customCssEnabled", false),
            backAtRoot = BackBehavior.of(json.optString("backAtRoot")),
            haptics = json.optBoolean("haptics", true),
            reduceMotion = json.optBoolean("reduceMotion", false),
            secureScreen = json.optBoolean("secureScreen", false),
            keepScreenOn = json.optBoolean("keepScreenOn", false),
            doubleTapRefresh = json.optBoolean("doubleTapRefresh", true),
            launcherShortcuts = (strings(json.optJSONArray("launcherShortcuts")) ?: defaults.launcherShortcuts)
                .filter(resolvable).distinct().take(4),
            dashboard = DashboardLayout(
                cards = cards(dashboard?.optJSONArray("cards"), customPages) ?: DEFAULT_DASHBOARD_CARDS,
            ),
        )
    }

    /** Distinct tab-eligible destinations, filled up to the minimum and cut to the maximum. */
    fun normalizedTabs(ids: List<String>, customPages: List<CustomPage>): List<String> {
        val result = ids.filter { DestinationCatalog.resolve(it, customPages)?.tabEligible == true }.distinct().take(MAX_TABS).toMutableList()
        for (fallback in listOf(SCHEDULE, HOME, PROFILE)) {
            if (result.size >= MIN_TABS) break
            if (fallback !in result) result += fallback
        }
        return result
    }

    /** A site path (`/forum?x=1`), a link on the site's own origin, or (for shortcuts) another https address. */
    fun normalizeRoute(raw: String, siteOrigin: String, allowExternal: Boolean): String? {
        val value = raw.trim()
        if (value.isEmpty() || value.length > 500 || value.any { it.isISOControl() } || '\\' in value) return null
        if (value.startsWith("/") && !value.startsWith("//")) return value
        val lower = value.lowercase()
        if (lower.startsWith(siteOrigin.lowercase() + "/") || lower == siteOrigin.lowercase()) {
            return value.substring(siteOrigin.length).ifEmpty { "/home" }
        }
        if (allowExternal && lower.startsWith("https://") && value.length > 8 && ' ' !in value) return value
        return null
    }

    private fun pages(array: JSONArray?): List<CustomPage> {
        array ?: return emptyList()
        val result = mutableListOf<CustomPage>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val id = item.optString("id")
            val title = clip(item.optString("title").trim(), 12)
            val route = item.optString("route").trim()
            val validRoute = (route.startsWith("/") && !route.startsWith("//") && route.length <= 300) ||
                (route.startsWith("https://") && route.length <= 500 && ' ' !in route)
            if (!CUSTOM_ID.matches(id) || title.isEmpty() || !validRoute || route.any { it.isISOControl() } || '\\' in route) continue
            if (result.any { it.id == id }) continue
            result += CustomPage(id, title, route, item.optString("icon").takeIf { it in SELECTABLE_ICONS } ?: "link")
            if (result.size == MAX_PAGES) break
        }
        return result
    }

    private fun cards(array: JSONArray?, customPages: List<CustomPage>): List<DashboardCard>? {
        array ?: return null
        val result = mutableListOf<DashboardCard>()
        val seenTypes = mutableSetOf<String>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val type = item.optString("type")
            val id = item.optString("id")
            if (type !in DashboardCards.types || !CARD_ID.matches(id) || result.any { it.id == id }) continue
            if (type !in DashboardCards.repeatable && !seenTypes.add(type)) continue
            val date = item.optString("date").takeIf { DATE.matches(it) }.orEmpty()
            if (type == "countdown" && date.isEmpty()) continue
            result += DashboardCard(
                id = id, type = type,
                title = clip(item.optString("title").trim(), 16),
                text = clip(item.optString("text"), 2_000),
                date = date,
                items = (strings(item.optJSONArray("items")) ?: emptyList())
                    .filter { DestinationCatalog.resolve(it, customPages) != null }.distinct().take(12),
            )
            if (result.size == MAX_CARDS) break
        }
        return result
    }

    // endregion

    // region Share codes

    private const val CODE_PREFIX = "NEXT1-"
    // URL-safe, one line, no padding: survives chat apps and line breaks around it.
    private const val BASE64_FLAGS = android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING

    /** A layout as text friends can paste: deflated JSON in URL-safe base64, without private text. */
    fun shareCode(value: Customization): String {
        val bytes = toJson(value, private = false).toString().toByteArray(Charsets.UTF_8)
        val deflater = java.util.zip.Deflater(9, true)
        deflater.setInput(bytes)
        deflater.finish()
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (!deflater.finished()) output.write(buffer, 0, deflater.deflate(buffer))
        deflater.end()
        return CODE_PREFIX + android.util.Base64.encodeToString(output.toByteArray(), BASE64_FLAGS)
    }

    /** The layout in a share code, keeping the receiver's private text; null when the code is not one. */
    fun fromShareCode(code: String, keepPrivateFrom: Customization): Customization? {
        val compact = code.filterNot { it.isWhitespace() }
        val start = compact.indexOf(CODE_PREFIX)
        if (start < 0) return null
        val payload = compact.substring(start + CODE_PREFIX.length).takeWhile { it.isLetterOrDigit() || it == '-' || it == '_' }
        if (payload.isEmpty() || payload.length > 120_000) return null
        val json = runCatching {
            val inflater = java.util.zip.Inflater(true)
            inflater.setInput(android.util.Base64.decode(payload, BASE64_FLAGS))
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            while (!inflater.finished()) {
                val count = inflater.inflate(buffer)
                if (count == 0 && (inflater.needsInput() || inflater.needsDictionary())) break
                output.write(buffer, 0, count)
                if (output.size() > 400_000) return null
            }
            inflater.end()
            JSONObject(output.toString(Charsets.UTF_8.name()))
        }.getOrNull() ?: return null
        val imported = fromJson(json)
        val myNotes = keepPrivateFrom.dashboard.cards.filter { it.type == "note" }.associateBy { it.id }
        return imported.copy(
            dashboard = imported.dashboard.copy(
                cards = imported.dashboard.cards.map { card ->
                    if (card.type == "note") card.copy(text = myNotes[card.id]?.text.orEmpty()) else card
                },
            ),
        )
    }

    // endregion

    private fun strings(array: JSONArray?): List<String>? {
        array ?: return null
        return (0 until array.length()).mapNotNull { array.opt(it) as? String }
    }

    private fun stringMap(json: JSONObject?): Map<String, String> {
        json ?: return emptyMap()
        return json.keys().asSequence().mapNotNull { key -> (json.opt(key) as? String)?.let { key to it } }.toMap()
    }

    private fun clip(value: String, codePoints: Int): String {
        if (value.codePointCount(0, value.length) <= codePoints) return value
        return value.substring(0, value.offsetByCodePoints(0, codePoints))
    }

    private fun roundStep(value: Float, step: Float, min: Float, max: Float, fallback: Float): Float {
        if (!value.isFinite()) return fallback
        return (Math.round(value.coerceIn(min, max) / step) * step).coerceIn(min, max)
    }
}
