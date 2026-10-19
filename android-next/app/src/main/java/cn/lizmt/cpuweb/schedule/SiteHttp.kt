package cn.lizmt.cpuweb.schedule

import android.webkit.CookieManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** A site API reply: the HTTP status and the `data` of the `{ code, data, message }` envelope. */
data class SiteReply(val status: Int, val data: JSONObject?, val message: String) {
    val ok: Boolean get() = status in 200..299
}

/**
 * Native requests to the site's API with the WebView's session and CSRF token,
 * as the page itself would send them. Blocking: call from an IO dispatcher.
 */
object SiteHttp {
    fun open(path: String, method: String, timeoutMs: Int = 30_000): HttpURLConnection {
        val url = AppConfig.routeUrl(path) ?: error("站点地址无效")
        val cookies = runCatching { CookieManager.getInstance().getCookie(AppConfig.origin) }.getOrNull().orEmpty()
        return (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = timeoutMs
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

    /** Sends [body] (or nothing) and reads the JSON reply; network failures throw. */
    fun request(path: String, method: String, body: JSONObject? = null, timeoutMs: Int = 30_000): SiteReply {
        val http = open(path, method, timeoutMs)
        try {
            if (body != null) {
                http.doOutput = true
                http.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val status = http.responseCode
            val text = runCatching { ((if (status in 200..299) http.inputStream else http.errorStream) ?: http.inputStream).bufferedReader().use { it.readText() } }
                .getOrDefault("")
            val json = runCatching { JSONObject(text) }.getOrNull()
            return SiteReply(status, json?.optJSONObject("data"), json?.optString("message").orEmpty())
        } finally {
            http.disconnect()
        }
    }
}
