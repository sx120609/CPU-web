package cn.lizmt.cpuweb.schedule.update

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** An incremental update from one installed version to the release. */
data class PatchInfo(
    val fromVersionCode: Int,
    val fromSha256: String,
    val size: Long,
    val sha256: String,
    val url: String,
)

data class ReleaseInfo(
    val versionCode: Int,
    val versionName: String,
    val fileName: String,
    val size: Long,
    val sha256: String,
    val notes: List<String>,
    val downloadUrl: String,
    val patch: PatchInfo?,
)

object ReleaseParser {
    private val HEX = Regex("^[a-f0-9]{64}$")
    private val VERSION = Regex("^\\d+\\.\\d+\\.\\d+$")

    /** The `data` of `/api/site/downloads/android`, or null when anything is off. */
    fun parse(body: String, origin: String, expectedPackage: String, installedVersion: Int): ReleaseInfo? {
        val payload = runCatching { JSONObject(body) }.getOrNull() ?: return null
        if (payload.optInt("code", -1) != 0) return null
        val data = payload.optJSONObject("data") ?: return null
        val versionCode = data.optInt("versionCode", -1)
        val versionName = data.optString("versionName")
        val fileName = data.optString("fileName")
        val size = data.optLong("size", -1)
        val sha256 = data.optString("sha256")
        if (data.optString("packageName") != expectedPackage || versionCode < 1 || !VERSION.matches(versionName) ||
            fileName != "CPU-Web-Android-V$versionCode.apk" || size < 65_536 || !HEX.matches(sha256)) return null
        val downloadUrl = absolute(origin, data.optString("downloadUrl")) ?: return null
        val notes = data.optJSONArray("notes")?.let { array ->
            (0 until array.length()).mapNotNull { (array.opt(it) as? String)?.trim()?.takeIf(String::isNotEmpty) }.take(20)
        }.orEmpty()
        val patch = data.optJSONObject("patch")?.let { item ->
            val from = item.optInt("fromVersionCode", -1)
            val patchSize = item.optLong("size", -1)
            val url = absolute(origin, item.optString("url"))
            if (from != installedVersion || from >= versionCode || patchSize <= 0 || patchSize >= size || url == null ||
                !HEX.matches(item.optString("fromSha256")) || !HEX.matches(item.optString("sha256"))) null
            else PatchInfo(from, item.optString("fromSha256"), patchSize, item.optString("sha256"), url)
        }
        return ReleaseInfo(
            versionCode = versionCode,
            versionName = versionName,
            fileName = fileName,
            size = size,
            sha256 = sha256,
            notes = notes,
            downloadUrl = downloadUrl,
            patch = patch,
        )
    }

    /** Server paths become addresses on the site; anything else must already be https. */
    private fun absolute(origin: String, value: String): String? = when {
        value.startsWith("/") && !value.startsWith("//") -> origin + value
        value.startsWith("https://") -> value
        else -> null
    }
}

/** Reads the published release from the site, as the app itself (no cookies needed). */
class ReleaseClient(private val origin: String, private val userAgent: () -> String) {
    fun fetch(installedVersion: Int, packageName: String): ReleaseInfo {
        val url = URL("$origin/api/site/downloads/android?from=$installedVersion")
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.useCaches = false
            connection.setRequestProperty("User-Agent", userAgent())
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            val code = connection.responseCode
            if (code !in 200..299) throw java.io.IOException("更新服务返回 $code")
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            return ReleaseParser.parse(body, origin, packageName, installedVersion)
                ?: throw java.io.IOException("更新信息无效")
        } finally {
            connection.disconnect()
        }
    }
}
