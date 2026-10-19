package cn.lizmt.cpuweb.schedule.custom

/**
 * Everything the user can place in the tab bar, the quick-entry panel, the
 * dashboard's shortcut card or the launcher: native surfaces and site pages.
 */
enum class DestinationKind { Web, Schedule, Dashboard, Settings, External }

data class Destination(
    val id: String,
    val title: String,
    val icon: String,
    val kind: DestinationKind,
    /** Site path for [DestinationKind.Web], an https address for [DestinationKind.External]. */
    val route: String = "",
    /** Pages that draw their own full-screen navigation cannot be tabs. */
    val tabEligible: Boolean = true,
    val requiresAuth: Boolean = false,
) {
    val isNative: Boolean get() = kind == DestinationKind.Schedule || kind == DestinationKind.Dashboard || kind == DestinationKind.Settings
}

/** A page the user added: a site path (or, for shortcuts only, an https link). */
data class CustomPage(val id: String, val title: String, val route: String, val icon: String) {
    val external: Boolean get() = route.startsWith("https://")

    fun toDestination(): Destination = Destination(
        id = id, title = title, icon = icon,
        kind = if (external) DestinationKind.External else DestinationKind.Web,
        route = route, tabEligible = !external,
    )
}

object DestinationCatalog {
    const val DASHBOARD = "dashboard"
    const val HOME = "home"
    const val SCHEDULE = "schedule"
    const val ACADEMIC = "academic"
    const val SERVICES = "services"
    const val PROFILE = "profile"
    const val SETTINGS = "settings"
    const val ADMIN = "admin"
    const val UPDATE = "update"
    /** Owner of a site page that no tab claims, when the bar has no Web tab of its own. */
    const val WEB = "web"
    const val CUSTOM_PREFIX = "custom:"

    val builtIns: List<Destination> = listOf(
        Destination(DASHBOARD, "工作台", "dashboard", DestinationKind.Dashboard),
        Destination(HOME, "首页", "home", DestinationKind.Web, "/home"),
        Destination(SCHEDULE, "课表", "calendar", DestinationKind.Schedule),
        Destination(ACADEMIC, "教务", "school", DestinationKind.Web, "/jwxt"),
        Destination(SERVICES, "服务", "apps", DestinationKind.Web, "/services"),
        Destination(PROFILE, "我的", "person", DestinationKind.Web, "/profile"),
        Destination("forum", "论坛", "forum", DestinationKind.Web, "/forum"),
        Destination("messages", "消息", "mail", DestinationKind.Web, "/messages", requiresAuth = true),
        Destination("market", "二手", "bag", DestinationKind.Web, "/market"),
        Destination("ai", "拾间AI", "sparkle", DestinationKind.Web, "/search"),
        Destination("announcements", "公告", "campaign", DestinationKind.Web, "/announcements"),
        Destination("lostfound", "失物招领", "search", DestinationKind.Web, "/lost-found"),
        Destination("coursereview", "课程点评", "star", DestinationKind.Web, "/coursereview"),
        Destination("workshop", "创意工坊", "extension", DestinationKind.Web, "/workshop"),
        Destination("tools", "小工具", "build", DestinationKind.Web, "/services/tools"),
        Destination("post", "发帖", "edit", DestinationKind.Web, "/post", tabEligible = false, requiresAuth = true),
        Destination("voicehub", "点歌台", "music", DestinationKind.Web, "/voicehub", tabEligible = false),
        Destination("download", "客户端下载", "download", DestinationKind.Web, "/download", tabEligible = false),
        // Shown only to accounts that can open the admin console.
        Destination(ADMIN, "管理后台", "shield", DestinationKind.Web, "/admin", tabEligible = false, requiresAuth = true),
        Destination(UPDATE, "检查更新", "update", DestinationKind.Settings, "update", tabEligible = false),
        Destination(SETTINGS, "设置", "tune", DestinationKind.Settings),
    )

    private val byId = builtIns.associateBy { it.id }

    val webFallback = Destination(WEB, "药大拾间", "home", DestinationKind.Web, "/home", tabEligible = false)

    fun builtIn(id: String): Destination? = byId[id]

    fun resolve(id: String, customPages: List<CustomPage>): Destination? =
        byId[id] ?: customPages.firstOrNull { it.id == id }?.toDestination() ?: if (id == WEB) webFallback else null

    fun all(customPages: List<CustomPage>): List<Destination> = builtIns + customPages.map { it.toDestination() }

    /** Pages of the site that belonged to each of the original five tabs (iOS mapping). */
    fun legacySection(path: String): String? {
        val pathname = pathOnly(path)
        return when {
            pathname == "/home" || pathname == "/" -> HOME
            pathname.startsWith("/forum") || pathname.startsWith("/market") ||
                pathname.startsWith("/search") || pathname.startsWith("/post") -> HOME
            pathname == "/jwxt" || pathname.startsWith("/jwxt/") -> ACADEMIC
            pathname == "/services" || pathname.startsWith("/services/") -> SERVICES
            pathname == "/profile" || pathname.startsWith("/profile/") ||
                pathname == "/vip" || pathname.startsWith("/vip/") ||
                pathname.startsWith("/messages") || pathname.startsWith("/admin") ||
                pathname.startsWith("/u/") || pathname == "/login" || pathname == "/register" -> PROFILE
            else -> null
        }
    }

    fun pathOnly(path: String): String = path.substringBefore('?').substringBefore('#').ifEmpty { "/" }

    /** Whether [path] is [route] or lies beneath it, by whole path segments. */
    fun routeContains(route: String, path: String): Boolean {
        val root = pathOnly(route).trimEnd('/').ifEmpty { "/" }
        val target = pathOnly(path)
        if (root == "/") return target == "/"
        return target == root || target.startsWith("$root/")
    }
}

/** Icon keys the user can pick from; the UI maps each key to a vector. */
val SELECTABLE_ICONS = listOf(
    "dashboard", "home", "calendar", "school", "apps", "person", "forum", "mail", "bag", "sparkle",
    "campaign", "search", "star", "extension", "build", "edit", "music", "download", "tune", "bookmark",
    "heart", "bolt", "book", "coffee", "flag", "globe", "image", "lightbulb", "pets", "rocket",
    "sports", "trophy", "work", "link",
)
