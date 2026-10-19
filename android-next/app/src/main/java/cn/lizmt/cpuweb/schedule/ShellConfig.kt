package cn.lizmt.cpuweb.schedule

import android.net.Uri

/**
 * Single source of truth for the shell's addresses. Mirrors the iOS
 * `IOSNextWebConfiguration` and the HarmonyOS `AppConfig` module: one primary
 * origin, an optional payment origin that stays inside the WebView, and a
 * helper that turns a router path into a trusted URL.
 */
object AppConfig {
    const val PAYMENT_HOST = "pay.kaipay.cn"
    const val APP_NAME = "药大拾间 NEXT"

    /**
     * The Web app is loaded at `/home` first. The native timetable is its own
     * surface, so the guest entry point matches iOS and HarmonyOS. Debug builds
     * may point at a development server with `-PappUrl=`.
     */
    val startUrl: String = BuildConfig.APP_URL

    private val startUri: Uri = Uri.parse(startUrl)
    val scheme: String = startUri.scheme?.lowercase() ?: "https"
    val host: String = startUri.host?.lowercase() ?: "cputime.cn"
    private val port: Int = startUri.port
    val origin: String = "$scheme://$host" + if (port > 0) ":$port" else ""

    /**
     * The stable app's tokens (the site and server treat it as the Android app)
     * plus `CPUWebNextApp/`, which tells them this is the separate 药大拾间 NEXT.
     */
    fun userAgentSuffix(versionCode: Int, versionName: String): String =
        "CPUWebScheduleApp/$versionCode CPUWebScheduleAppVersion/$versionName CPUTimeNative/1 CPUWebNextApp/$versionCode"

    /** The shell bridge is only offered to the configured first-party origin. */
    fun isTrusted(url: String?): Boolean {
        val uri = parse(url) ?: return false
        return uri.scheme?.lowercase() == scheme && uri.host?.lowercase() == host && effectivePort(uri) == effectivePort(startUri)
    }

    /** Payment pages stay inside the WebView but never receive the bridge. */
    fun isPayment(url: String?): Boolean {
        val uri = parse(url) ?: return false
        return uri.scheme?.lowercase() == "https" && uri.host?.lowercase() == PAYMENT_HOST
    }

    fun routeUrl(path: String): String? {
        val value = path.trim()
        if (value.isEmpty() || !value.startsWith("/") || value.startsWith("//")) return null
        if (value.any { it.isISOControl() }) return null
        return origin + value
    }

    /** Path, query and fragment of a trusted URL, as the Web router reports it. */
    fun pathOf(url: String?): String? {
        if (!isTrusted(url)) return null
        val uri = parse(url) ?: return null
        val path = uri.encodedPath?.takeIf { it.isNotEmpty() } ?: "/"
        val query = uri.encodedQuery?.let { "?$it" } ?: ""
        val fragment = uri.encodedFragment?.let { "#$it" } ?: ""
        return path + query + fragment
    }

    fun isHttpUrl(url: String?): Boolean {
        val scheme = parse(url)?.scheme?.lowercase() ?: return false
        return scheme == "http" || scheme == "https"
    }

    private fun parse(url: String?): Uri? =
        if (url.isNullOrBlank()) null else runCatching { Uri.parse(url.trim()) }.getOrNull()

    private fun effectivePort(uri: Uri): Int =
        if (uri.port > 0) uri.port else if (uri.scheme.equals("http", true)) 80 else 443
}

/**
 * Site paths the shell treats specially. Which page belongs to which tab is
 * the user's choice now (`Customization.tabs`); see `ShellCoordinator.ownerOf`.
 */
object ShellRoutes {
    fun isSchedulePath(path: String): Boolean {
        val pathname = path.substringBefore('?')
        return pathname == "/schedule" || pathname.startsWith("/schedule/")
    }

    fun isLoginPath(path: String): Boolean {
        val pathname = path.substringBefore('?').substringBefore('#')
        return pathname == "/login" || pathname.startsWith("/login/") ||
            pathname == "/register" || pathname.startsWith("/register/")
    }

    /** Only these paths may load while the native login gate is up. */
    fun isAuthPath(path: String): Boolean {
        val pathname = path.substringBefore('?').substringBefore('#')
        return isLoginPath(pathname) || pathname == "/api" || pathname.startsWith("/api/")
    }
}

/**
 * Pages that own their navigation: the Web shell hides the native top bar for
 * them and the native bottom bar gets out of the way. Kept in sync with the
 * iOS `NativePageChrome` prefixes and the CSS shipped in the Web bundle.
 */
object PageChrome {
    val pageRoutePrefixes = listOf(
        "/forum/topic", "/post", "/services/tools/yaoda-can-fly",
        "/services/tools/voicehub", "/voicehub",
    )

    fun usesPageNavigation(path: String): Boolean {
        val pathname = path.substringBefore('?').substringBefore('#')
        return pageRoutePrefixes.any { pathname == it || pathname.startsWith("$it/") }
    }
}
