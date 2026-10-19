package cn.lizmt.cpuweb.schedule

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Colors of one course card, as packed ARGB integers. */
data class ScheduleCourseTone(val fill: Int, val border: Int, val text: Int, val highlight: Int = fill)

/** Reserve the weekday header, gap and bottom inset; fit all timetable rows in portrait. */
fun compactWeekRowHeight(availableHeight: Float): Float = max(34f, (availableHeight - 46f) / SLOT_COUNT)

/** The nine Web palettes in the order the palette picker shows them. */
val SCHEDULE_THEME_ORDER = listOf("color-glass", "green", "blue", "teal", "indigo", "violet", "orange", "rose", "slate")

fun schedulePalette(key: String): SchedulePalette =
    SCHEDULE_PALETTES.firstOrNull { it.key == key } ?: SCHEDULE_PALETTES.first { it.key == "color-glass" }

fun normalizedScheduleTheme(value: String?): String {
    val theme = value?.trim()?.lowercase().orEmpty()
    return if (theme in SCHEDULE_THEME_ORDER) theme else "color-glass"
}

/** Short labels used by the native palette picker and widget settings. */
fun scheduleThemeLabel(theme: String): String = when (theme) {
    "color-glass" -> "多彩"
    "green" -> "青绿"
    "blue" -> "蓝色"
    "teal" -> "湖蓝"
    "indigo" -> "靛粉"
    "violet" -> "紫色"
    "orange" -> "橙色"
    "rose" -> "玫红"
    "slate" -> "石墨"
    else -> theme
}

fun parseHexColor(value: String): Int {
    val hex = value.removePrefix("#")
    return when (hex.length) {
        6 -> (0xFF shl 24) or hex.toInt(16)
        8 -> hex.toLong(16).toInt()
        else -> 0xFF000000.toInt()
    }
}

/** Channel-wise `first * weight + second * (1 - weight)`, like the HarmonyOS mixer. */
fun mixScheduleColor(first: Int, second: Int, weight: Float): Int {
    fun channel(shift: Int): Int {
        val a = (first shr shift) and 0xFF
        val b = (second shr shift) and 0xFF
        return (a * weight + b * (1 - weight)).roundToInt().coerceIn(0, 255)
    }
    return (0xFF shl 24) or (channel(16) shl 16) or (channel(8) shl 8) or channel(0)
}

private fun hsla(hue: Int, saturation: Int, lightness: Int, alpha: Float = 1f): Int {
    val s = saturation / 100f
    val l = lightness / 100f
    val a = s * min(l, 1 - l)
    fun channel(offset: Int): Int {
        val k = (offset + hue / 30f) % 12
        val value = 255 * (l - a * max(-1f, min(min(k - 3, 9 - k), 1f)))
        return value.roundToInt().coerceIn(0, 255)
    }
    val alphaByte = (alpha * 255).roundToInt().coerceIn(0, 255)
    return (alphaByte shl 24) or (channel(0) shl 16) or (channel(8) shl 8) or channel(4)
}

/** Unsigned 31-multiplier hash of the normalized course name, matching the Web color-glass seed. */
fun courseNameHash(name: String): Long {
    var hash = 0L
    val seed = name.trim().replace(Regex("\\s+"), " ")
    for (character in seed) hash = (hash * 31 + character.code) and 0xFFFFFFFFL
    return hash
}

private fun opaque(color: Int): Int = color or (0xFF shl 24)

/**
 * Port of the Web `scheduleCourseTone`: themed palettes use the palette card
 * colors; color-glass derives a stable hue from the course name.
 */
fun scheduleCourseTone(name: String, key: String, dark: Boolean): ScheduleCourseTone {
    val palette = schedulePalette(key)
    if (key != "color-glass") {
        val background = if (dark) mixScheduleColor(parseHexColor(palette.courseBg), parseHexColor("#101c19"), 0.32f)
        else parseHexColor(palette.courseBg)
        val border = if (dark) mixScheduleColor(parseHexColor(palette.courseBorder), parseHexColor("#ffffff"), 0.72f)
        else parseHexColor(palette.courseBorder)
        val text = if (dark) mixScheduleColor(parseHexColor(palette.courseText), parseHexColor("#ffffff"), 0.22f)
        else parseHexColor(palette.courseText)
        return ScheduleCourseTone(background, border, text)
    }
    val hash = courseNameHash(name)
    val hue = (hash % 360).toInt()
    val saturation = 58 + ((hash ushr 8) % 18).toInt()
    if (dark) {
        return ScheduleCourseTone(
            fill = hsla(hue, min(82, saturation + 4), 24, 0.88f),
            border = hsla(hue, min(86, saturation + 8), 72, 0.72f),
            text = parseHexColor("#f8fffd"),
        )
    }
    return ScheduleCourseTone(
        fill = hsla(hue, saturation, 89 + ((hash ushr 16) % 5).toInt(), 0.86f),
        border = hsla(hue, min(82, saturation + 8), 48 + ((hash ushr 20) % 10).toInt(), 0.48f),
        text = hsla(hue, min(76, saturation + 4), 25 + ((hash ushr 24) % 8).toInt()),
    )
}

/**
 * The native grid uses the same name-derived tones as the Web. Do not bucket
 * names into a short palette: unrelated courses then become indistinguishable.
 */
fun scheduleCardTone(name: String, key: String, dark: Boolean): ScheduleCourseTone {
    val tone = scheduleCourseTone(name, key, dark)
    var ink = tone.text
    // Preserve the Web hue while making small native labels readable.
    repeat(10) {
        if (contrastRatio(ink, opaque(tone.fill)) < 4.8) {
            ink = mixScheduleColor(ink, if (dark) 0xFFFFFFFF.toInt() else 0xFF000000.toInt(), 0.92f)
        }
    }
    val highlight = if (dark && key == "color-glass") {
        val hash = courseNameHash(name)
        hsla((hash % 360).toInt(), min(82, 62 + ((hash ushr 8) % 18).toInt()), 34, 0.84f)
    } else tone.fill
    return tone.copy(text = ink, highlight = highlight)
}

/** WCAG relative-luminance contrast, used by the palette regression checks. */
fun contrastRatio(foreground: Int, background: Int): Double {
    fun luminance(color: Int): Double {
        fun linear(channel: Int): Double {
            val value = channel / 255.0
            return if (value <= 0.03928) value / 12.92 else Math.pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear((color shr 16) and 0xFF) + 0.7152 * linear((color shr 8) and 0xFF) +
            0.0722 * linear(color and 0xFF)
    }
    val a = luminance(foreground)
    val b = luminance(background)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)
}
