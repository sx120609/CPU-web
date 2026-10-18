package cn.lizmt.cpuweb.schedule.update

import kotlinx.coroutines.ensureActive
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.coroutineContext

/**
 * Downloads one update file, continuing a partial file with an HTTP range.
 * The site answers with a redirect to a short-lived enterprise-drive address,
 * so every attempt starts from the site URL again.
 */
class UpdateDownloader(private val userAgent: () -> String) {
    suspend fun download(url: String, target: File, expectedSize: Long, onProgress: (Long, Long) -> Unit) {
        var lastError: IOException? = null
        repeat(4) { attempt ->
            coroutineContext.ensureActive()
            try {
                attempt(url, target, expectedSize, onProgress)
                return
            } catch (error: IOException) {
                lastError = error
                if (error is SizeMismatch) target.delete()
                if (attempt < 3) kotlinx.coroutines.delay(1_500L * (attempt + 1))
            }
        }
        throw lastError ?: IOException("下载失败")
    }

    private class SizeMismatch(message: String) : IOException(message)

    private suspend fun attempt(url: String, target: File, expectedSize: Long, onProgress: (Long, Long) -> Unit) {
        var existing = if (target.isFile) target.length() else 0L
        if (existing > expectedSize) {
            target.delete()
            existing = 0
        }
        if (existing == expectedSize) return
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = true
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.useCaches = false
            connection.setRequestProperty("User-Agent", userAgent())
            if (existing > 0) connection.setRequestProperty("Range", "bytes=$existing-")
            val code = connection.responseCode
            val append = when (code) {
                206 -> true
                200 -> false
                416 -> {
                    target.delete()
                    throw SizeMismatch("下载位置无效，将重新下载")
                }
                else -> throw IOException("下载服务返回 $code")
            }
            if (!append) existing = 0
            val remaining = connection.getHeaderField("Content-Length")?.toLongOrNull()
            if (remaining != null && existing + remaining != expectedSize) throw SizeMismatch("下载文件大小与更新信息不一致")
            target.parentFile?.mkdirs()
            connection.inputStream.use { input ->
                FileOutputStream(target, append).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var written = existing
                    var reported = 0L
                    while (true) {
                        coroutineContext.ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (written + count > expectedSize) throw SizeMismatch("下载文件比预期更大")
                        output.write(buffer, 0, count)
                        written += count
                        if (written - reported >= 128 * 1024 || written == expectedSize) {
                            reported = written
                            onProgress(written, expectedSize)
                        }
                    }
                    output.fd.sync()
                }
            }
            if (target.length() != expectedSize) throw IOException("下载中断，稍后会继续")
        } finally {
            connection.disconnect()
        }
    }
}
