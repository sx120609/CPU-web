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
    /** The dark-appearance photo; without one, dark mode keeps the light one. */
    private val darkFile = File(context.filesDir, "schedule-background-dark.jpg")

    var palette by mutableStateOf(normalizedScheduleTheme(prefs.getString("palette", "color-glass")))
        private set
    var visibility by mutableFloatStateOf(normalizedVisibility(prefs.getFloat("visibility", DEFAULT_VISIBILITY)))
        private set
    var blur by mutableFloatStateOf(prefs.getFloat("blur", 0f).coerceIn(0f, MAX_BLUR))
        private set
    /** The light-appearance photo, cropped as chosen. */
    var lightBackground by mutableStateOf<ImageBitmap?>(null)
        private set
    var darkBackground by mutableStateOf<ImageBitmap?>(null)
        private set
    /** The part of each photo shown, as fractions of its width and height; null shows all of it filled to the screen. */
    var lightCrop by mutableStateOf(BackgroundCrop.parse(prefs.getString("backgroundCrop", null)))
        private set
    var darkCrop by mutableStateOf(BackgroundCrop.parse(prefs.getString("darkBackgroundCrop", null)))
        private set
    /** The appearance the timetable is drawn in, told by the screen; the background follows it. */
    var appearanceDark by mutableStateOf(false)

    /** The background of the appearance on screen: the dark photo in dark mode when there is one. */
    val background: ImageBitmap?
        get() = if (appearanceDark) darkBackground ?: lightBackground else lightBackground

    fun background(dark: Boolean): ImageBitmap? = if (dark) darkBackground ?: lightBackground else lightBackground

    val hasBackground: Boolean get() = lightBackground != null || darkBackground != null
    /** The visual style; classic until the user picks another one. */
    var visualStyle by mutableStateOf(ScheduleVisualStyle.fromId(prefs.getString("visualStyle", null)))
        private set
    /** Saturday and Sunday columns; a weekend day with classes shows either way. Both start from the old single switch. */
    var showSaturday by mutableStateOf(prefs.getBoolean("showSaturday", prefs.getBoolean("showWeekend", true)))
        private set
    var showSunday by mutableStateOf(prefs.getBoolean("showSunday", prefs.getBoolean("showWeekend", true)))
        private set
    /** The week runs Sunday to Saturday: the first column is the Sunday before that Monday. */
    var sundayFirst by mutableStateOf(prefs.getBoolean("sundayFirst", false))
        private set
    /** Row height of the week view in percent; 100 fits the twelve periods on one screen. */
    var rowHeight by mutableStateOf(ScheduleDisplayRules.normalizedRowHeight(prefs.getInt("rowHeight", 100)))
        private set
    var textSize by mutableStateOf(ScheduleDisplayRules.normalizedTextSize(prefs.getString("textSize", null)))
        private set
    var compactLayout by mutableStateOf(prefs.getBoolean("compactLayout", false))
        private set
    var showTeacher by mutableStateOf(prefs.getBoolean("showTeacher", false))
        private set
    /** Courses that do not run this week, drawn faded in the periods this week leaves free. */
    var showOffWeek by mutableStateOf(prefs.getBoolean("showOffWeek", false))
        private set
    var showSlotTime by mutableStateOf(prefs.getBoolean("showSlotTime", true))
        private set
    var showBackToWeek by mutableStateOf(prefs.getBoolean("showBackToWeek", true))
        private set
    /** Marks the current time on today's column and the in-class / next-up states of the day view. */
    var showNowIndicator by mutableStateOf(prefs.getBoolean("showNowIndicator", true))
        private set

    init {
        if (file.exists()) lightBackground = decode(file, lightCrop)
        if (darkFile.exists()) darkBackground = decode(darkFile, darkCrop)
    }

    fun selectVisualStyle(value: ScheduleVisualStyle) {
        visualStyle = value
        prefs.edit().putString("visualStyle", value.id).commit()
        // The widgets follow the timetable's style unless they have one of their own.
        if (ScheduleWidgetPrefs.styleChoice(context).isEmpty()) runCatching { ScheduleWidgetProvider.updateAll(context) }
    }

    /** What the week grid's cards and period axis read. */
    val displayOptions: ScheduleDisplayOptions
        get() = ScheduleDisplayOptions(
            textScale = ScheduleDisplayRules.textScale(textSize, compactLayout),
            compact = compactLayout, showTeacher = showTeacher, showSlotTime = showSlotTime,
        )

    val displayIsDefault: Boolean
        get() = rowHeight == 100 && textSize == "standard" && !compactLayout && !showTeacher && !showOffWeek && showSlotTime &&
            showNowIndicator && showBackToWeek && showSaturday && showSunday && !sundayFirst

    private fun store(key: String, value: Boolean) = prefs.edit().putBoolean(key, value).apply()

    fun updateShowSaturday(value: Boolean) { showSaturday = value; store("showSaturday", value) }
    fun updateShowSunday(value: Boolean) { showSunday = value; store("showSunday", value) }
    fun updateSundayFirst(value: Boolean) { sundayFirst = value; store("sundayFirst", value) }
    fun updateCompactLayout(value: Boolean) { compactLayout = value; store("compactLayout", value) }
    fun updateShowTeacher(value: Boolean) { showTeacher = value; store("showTeacher", value) }
    fun updateShowOffWeek(value: Boolean) { showOffWeek = value; store("showOffWeek", value) }
    fun updateShowSlotTime(value: Boolean) { showSlotTime = value; store("showSlotTime", value) }
    fun updateShowBackToWeek(value: Boolean) { showBackToWeek = value; store("showBackToWeek", value) }

    fun updateRowHeight(value: Int) {
        rowHeight = ScheduleDisplayRules.normalizedRowHeight(value)
        prefs.edit().putInt("rowHeight", rowHeight).apply()
    }

    fun selectTextSize(value: String) {
        textSize = ScheduleDisplayRules.normalizedTextSize(value)
        prefs.edit().putString("textSize", textSize).apply()
    }

    fun resetDisplay() {
        updateRowHeight(100)
        selectTextSize("standard")
        updateCompactLayout(false)
        updateShowTeacher(false)
        updateShowOffWeek(false)
        updateShowSlotTime(true)
        updateShowNowIndicator(true)
        updateShowBackToWeek(true)
        updateShowSaturday(true)
        updateShowSunday(true)
        updateSundayFirst(false)
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
     * Copy the picked photo into private storage for one appearance, downsampled
     * to limit memory use. The whole photo is kept so it can be framed again.
     * Runs off the main thread; pass the result to [showBackground].
     */
    fun importBackground(uri: Uri, dark: Boolean = false): Result<ImageBitmap> = runCatching {
        val file = if (dark) darkFile else this.file
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

    /** A new photo for one appearance: shown whole until it is framed. */
    fun showBackground(image: ImageBitmap, dark: Boolean = false) {
        setCrop(null, dark, reload = false)
        if (dark) darkBackground = image else lightBackground = image
    }

    /** The whole photo of an appearance, for the crop editor. */
    fun originalBackground(dark: Boolean): ImageBitmap? = decode(if (dark) darkFile else file, null)

    /** Shows only [crop] of an appearance's photo; null shows all of it. */
    fun setCrop(crop: BackgroundCrop?, dark: Boolean, reload: Boolean = true) {
        val value = crop?.normalized()
        if (dark) darkCrop = value else lightCrop = value
        prefs.edit().putString(if (dark) "darkBackgroundCrop" else "backgroundCrop", value?.text().orEmpty()).apply()
        if (!reload) return
        if (dark) darkBackground = decode(darkFile, value) else lightBackground = decode(file, value)
    }

    /** Clears the light photo, or the dark one (dark mode then keeps the light one). */
    fun clearBackground(dark: Boolean = false) {
        setCrop(null, dark, reload = false)
        if (dark) {
            darkFile.delete()
            darkBackground = null
        } else {
            file.delete()
            lightBackground = null
        }
    }

    fun reset() {
        clearBackground()
        clearBackground(dark = true)
        updateVisibility(DEFAULT_VISIBILITY)
        updateBlur(0f)
    }

    private fun decode(source: File, crop: BackgroundCrop?): ImageBitmap? = runCatching {
        val bitmap = BitmapFactory.decodeFile(source.absolutePath) ?: return@runCatching null
        val rect = crop?.pixels(bitmap.width, bitmap.height) ?: return@runCatching bitmap.asImageBitmap()
        Bitmap.createBitmap(bitmap, rect.left, rect.top, rect.width(), rect.height()).asImageBitmap()
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
