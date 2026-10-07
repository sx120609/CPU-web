package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.File
import kotlin.math.max

/**
 * Timetable style, palette and background, stored only on this device. Values
 * follow the Web and iOS editors: centered `cover` photo, 22%–88% visibility
 * (default 76%) and 0–18 softening.
 */
class ScheduleStyleSettings(private val context: Context) {
    private val prefs = context.getSharedPreferences("native_schedule_style", Context.MODE_PRIVATE)
    private val file = File(context.filesDir, "schedule-background.jpg")

    var palette by mutableStateOf(normalizedScheduleTheme(prefs.getString("palette", "color-glass")))
        private set
    var visibility by mutableFloatStateOf(normalizedVisibility(prefs.getFloat("visibility", DEFAULT_VISIBILITY)))
        private set
    var blur by mutableFloatStateOf(prefs.getFloat("blur", 0f).coerceIn(0f, MAX_BLUR))
        private set
    var background by mutableStateOf<ImageBitmap?>(null)
        private set
    /** The visual style; classic until the user picks another one. */
    var visualStyle by mutableStateOf(ScheduleVisualStyle.fromId(prefs.getString("visualStyle", null)))
        private set
    /** Saturday and Sunday columns; a weekend day with classes shows either way. */
    var showWeekend by mutableStateOf(prefs.getBoolean("showWeekend", true))
        private set
    /** Marks the current time on today's column and the in-class / next-up states of the day view. */
    var showNowIndicator by mutableStateOf(prefs.getBoolean("showNowIndicator", true))
        private set

    init {
        if (file.exists()) background = decode(file)
    }

    fun selectVisualStyle(value: ScheduleVisualStyle) {
        visualStyle = value
        prefs.edit().putString("visualStyle", value.id).apply()
    }

    fun updateShowWeekend(value: Boolean) {
        showWeekend = value
        prefs.edit().putBoolean("showWeekend", value).apply()
    }

    fun updateShowNowIndicator(value: Boolean) {
        showNowIndicator = value
        prefs.edit().putBoolean("showNowIndicator", value).apply()
    }

    fun selectPalette(value: String) {
        palette = normalizedScheduleTheme(value)
        prefs.edit().putString("palette", palette).apply()
    }

    fun updateVisibility(value: Float) {
        visibility = normalizedVisibility(value)
        prefs.edit().putFloat("visibility", visibility).apply()
    }

    fun updateBlur(value: Float) {
        blur = value.coerceIn(0f, MAX_BLUR)
        prefs.edit().putFloat("blur", blur).apply()
    }

    /**
     * Copy the picked photo into private storage, downsampled to limit memory
     * use. Runs off the main thread; pass the result to [showBackground].
     */
    fun importBackground(uri: Uri): Result<ImageBitmap> = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        // A bounds-only decode always returns null; only a missing stream is an error.
        val stream = context.contentResolver.openInputStream(uri) ?: error("图片读取失败")
        stream.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) error("无法识别这张图片")
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_EDGE) sample *= 2
        val bitmap = context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: error("图片读取失败")
        val temporary = File(file.parentFile, file.name + ".tmp")
        temporary.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        if (!temporary.renameTo(file)) {
            file.delete()
            if (!temporary.renameTo(file)) error("背景保存失败")
        }
        bitmap.asImageBitmap()
    }

    fun showBackground(image: ImageBitmap) {
        background = image
    }

    fun clearBackground() {
        file.delete()
        background = null
    }

    fun reset() {
        clearBackground()
        updateVisibility(DEFAULT_VISIBILITY)
        updateBlur(0f)
    }

    private fun decode(source: File): ImageBitmap? = runCatching {
        BitmapFactory.decodeFile(source.absolutePath)?.asImageBitmap()
    }.getOrNull()

    companion object {
        const val DEFAULT_VISIBILITY = 0.76f
        const val MIN_VISIBILITY = 0.22f
        const val MAX_VISIBILITY = 0.88f
        const val MAX_BLUR = 18f
        private const val MAX_EDGE = 1600

        fun normalizedVisibility(value: Float): Float =
            if (value.isNaN()) DEFAULT_VISIBILITY else value.coerceIn(MIN_VISIBILITY, MAX_VISIBILITY)
    }
}
