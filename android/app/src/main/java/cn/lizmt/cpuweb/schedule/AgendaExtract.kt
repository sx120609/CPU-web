package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import android.util.Base64
import cn.lizmt.cpuweb.schedule.agenda.AgendaCodec
import cn.lizmt.cpuweb.schedule.agenda.AgendaItem
import cn.lizmt.cpuweb.schedule.agenda.AgendaKind
import cn.lizmt.cpuweb.schedule.agenda.AgendaRemind
import cn.lizmt.cpuweb.schedule.agenda.AgendaRepeat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * 截图识别: a notice screenshot (or a whole pasted notice) that 拾间AI reads
 * into 日程 to prefill the editor. The page's bridge does the request
 * (`CPUTimeNativeAgenda({ action: "extract" })`, see web/src/utils/nativeAgendaBridge.ts),
 * so it runs with the site session and counts as one 拾间AI question.
 */
sealed interface AgendaSource {
    data class Image(val uri: Uri) : AgendaSource
    data class Text(val text: String) : AgendaSource
}

/** Pasting more than this into a title reads it as a whole notice for 拾间AI. */
internal const val AGENDA_NOTICE_PASTE_CHARS = 60

internal object AgendaExtract {
    // Long screenshots keep their width and shrink by height; the server also caps at 4096.
    private const val MAX_WIDTH = 1280
    private const val MAX_HEIGHT = 4096
    private const val MAX_BYTES = 2_500_000

    /** The picked image as a JPEG `data:` URL small enough to send, or null when it cannot be read. */
    suspend fun imageDataUrl(context: Context, uri: Uri): String? = withContext(Dispatchers.IO) {
        runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@runCatching null
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= MAX_WIDTH || bounds.outHeight / (sample * 2) >= MAX_HEIGHT) sample *= 2
            val decoded = context.contentResolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
            } ?: return@runCatching null
            val ratio = minOf(1f, MAX_WIDTH.toFloat() / decoded.width, MAX_HEIGHT.toFloat() / decoded.height)
            val width = (decoded.width * ratio).toInt().coerceAtLeast(1)
            val height = (decoded.height * ratio).toInt().coerceAtLeast(1)
            // A white backdrop: screenshots with transparency would otherwise turn black in JPEG.
            val flat = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            Canvas(flat).apply {
                drawColor(Color.WHITE)
                drawBitmap(Bitmap.createScaledBitmap(decoded, width, height, true), 0f, 0f, null)
            }
            var quality = 88
            var bytes: ByteArray
            do {
                bytes = ByteArrayOutputStream().also { flat.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()
                quality -= 10
            } while (bytes.size > MAX_BYTES && quality >= 50)
            "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        }.getOrNull()
    }

    /** The bridge's `{ items, message }`: new items (empty ids) to review, or why there are none. */
    fun parse(raw: String?): Result<List<AgendaItem>> {
        val reply = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?: return Result.failure(IllegalStateException("拾间AI 没来得及回复，稍后再试"))
        if (reply.optBoolean("missing", false)) return Result.failure(IllegalStateException("网页还没准备好，稍后再试"))
        // A site without "extract" answers with the agenda list instead (it carries `authenticated`).
        if (reply.has("authenticated")) {
            return Result.failure(IllegalStateException(if (reply.optBoolean("authenticated")) "截图识别还没上线，稍后再试" else "登录后才能识别截图"))
        }
        val array = reply.optJSONArray("items")
            ?: return Result.failure(IllegalStateException(reply.optString("message").ifEmpty { "登录后才能识别截图" }))
        val items = (0 until array.length()).mapNotNull { index ->
            val json = array.optJSONObject(index) ?: return@mapNotNull null
            AgendaCodec.normalize(
                AgendaItem(
                    id = "",
                    kind = AgendaKind.Event,
                    title = json.optString("title"),
                    date = json.optString("date"),
                    start = json.optString("start"),
                    end = json.optString("end"),
                    location = json.optString("location"),
                    note = json.optString("note"),
                    remind = json.optInt("remind", AgendaRemind.NONE),
                    repeat = AgendaRepeat.of(json.optString("repeat")),
                    origin = "assistant",
                ),
            )
        }
        return if (items.isEmpty()) Result.failure(IllegalStateException(reply.optString("message").ifEmpty { "没有在里面找到时间和要做的事" }))
        else Result.success(items)
    }
}
