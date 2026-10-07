package cn.lizmt.cpuweb.schedule

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cbrt
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

enum class StyleGrid { Rows, Cells, Table, Sessions }
enum class StyleCourse { Card, Stripe, Ink, Departure }
enum class StyleFont { Standard, Rounded, Serif, Monospaced }

/**
 * The timetable's visual style, as on iOS (`ScheduleStyle`). It is independent
 * of the course palette and of the light/dark appearance: switching it never
 * touches course data, the selected week or editing rights.
 *
 * `Classic` is the appearance this client shipped with and stays the default,
 * so an upgrade changes nothing until the user picks another style. Persisted
 * as the stable English [id]; a missing or unknown value falls back to classic.
 */
enum class ScheduleVisualStyle(
    val id: String,
    val title: String,
    val subtitle: String,
    val grid: StyleGrid,
    val course: StyleCourse,
    val cornerRadius: Float,
    val borderWidth: Float,
    val centered: Boolean,
    val font: StyleFont,
) {
    Classic("classic", "经典", "玻璃格子与彩色卡片，沿用原来的样子", StyleGrid.Cells, StyleCourse.Card, 9f, 1.5f, true, StyleFont.Standard),
    Minimal("minimal", "简约", "淡彩卡片，轻松查课", StyleGrid.Rows, StyleCourse.Card, 9f, 0f, false, StyleFont.Rounded),
    Grid("grid", "格子", "独立方格，空闲一目了然", StyleGrid.Cells, StyleCourse.Card, 8f, 1.5f, true, StyleFont.Rounded),
    Table("table", "表格", "整齐行列，集中呈现课程", StyleGrid.Table, StyleCourse.Stripe, 0f, 0f, false, StyleFont.Standard),
    Paper("paper", "素笺", "纸墨色调，安静阅读", StyleGrid.Rows, StyleCourse.Ink, 2f, 0f, false, StyleFont.Serif),
    Board("board", "站牌", "时间优先，关注下一节", StyleGrid.Sessions, StyleCourse.Departure, 2f, 0f, false, StyleFont.Monospaced);

    /** Only minimal and grid keep a gap between day columns; the ruled styles need their columns to touch. */
    val columnGap: Float get() = if (this == Minimal || this == Grid) 4f else 0f

    /** Whether the week and day panel is outlined. The table draws its own frame, the board is divided by rules alone. */
    val framesPanel: Boolean get() = this != Table && this != Board

    /** Paper and board bring their own page colour; the others keep the page background and any photo set on it. */
    fun canvasColor(dark: Boolean): Color? = when (this) {
        Paper -> Color(if (dark) 0xFF201E1B else 0xFFF1ECE2)
        Board -> Color(if (dark) 0xFF171A1C else 0xFFF4F5F4)
        else -> null
    }

    fun inkColor(dark: Boolean, primary: Color): Color = when (this) {
        Paper -> Color(if (dark) 0xFFEDE6D8 else 0xFF2A251F)
        Board -> Color(if (dark) 0xFFFFE4A3 else 0xFF171A1C)
        else -> primary
    }

    fun accentColor(dark: Boolean, fallback: Color): Color = when (this) {
        Paper -> Color(if (dark) 0xFFF39B85 else 0xFFA63F29)
        Board -> Color(if (dark) 0xFFFFD477 else 0xFF242C32)
        else -> fallback
    }

    val fontFamily: FontFamily
        get() = when (font) {
            StyleFont.Serif -> FontFamily.Serif
            StyleFont.Monospaced -> FontFamily.Monospace
            // Android has no rounded system face; the default one stands in for it.
            StyleFont.Standard, StyleFont.Rounded -> FontFamily.Default
        }

    companion object {
        fun fromId(id: String?): ScheduleVisualStyle = entries.firstOrNull { it.id == id } ?: Classic
    }
}

/**
 * Theme-colour tiers (iOS `ThemePalette`). One brand colour is resolved once
 * per appearance into:
 * - `text`: text, icons, hairlines and the "now" line; at least 4.5:1 on the
 *   timetable canvas, the week panel and the tinted today column.
 * - `fill`: a solid fill that carries white text at 4.5:1 or better.
 *
 * Only OKLCH lightness is moved, so hue and chroma stay those of the brand;
 * chroma is scaled back where it leaves sRGB. A brand that already passes is
 * used unchanged. Colours are opaque `0xRRGGBB` integers.
 */
class ThemePalette private constructor(val base: Int) {
    val fill: Int = adjusted(base, lighten = false) { contrast(it, WHITE) >= MINIMUM_CONTRAST }
    val lightText: Int = textFor(base, dark = false)
    val darkText: Int = textFor(base, dark = true)

    fun text(dark: Boolean): Int = if (dark) darkText else lightText

    companion object {
        /** WCAG AA for body text. */
        const val MINIMUM_CONTRAST = 4.5
        private const val WHITE = 0xFFFFFF
        private val cache = HashMap<Int, ThemePalette>()

        @Synchronized
        fun of(base: Int): ThemePalette {
            val key = base and 0xFFFFFF
            cache[key]?.let { return it }
            if (cache.size >= 16) cache.clear()
            return ThemePalette(key).also { cache[key] = it }
        }

        /** The week panel without a photo: white at this opacity over the canvas. */
        fun panelWhiteOpacity(dark: Boolean): Double = if (dark) 0.09 else 0.96

        /** The wash over today's whole column. */
        fun todayStrength(dark: Boolean): Double = if (dark) 0.15 else 0.08

        /** The page colours the timetable is drawn on. */
        fun canvases(dark: Boolean): List<Int> = if (dark) listOf(0x15181C, 0x0E1012) else listOf(0xEDF4FF, 0xF5F8FC, 0xFFFFFF)

        /** Every surface the text tier has to clear. */
        fun textSurfaces(brand: Int, dark: Boolean): List<Int> = canvases(dark).flatMap { canvas ->
            val panel = overlaid(canvas, WHITE, panelWhiteOpacity(dark))
            listOf(canvas, panel, overlaid(panel, brand, todayStrength(dark)))
        }

        /** `top` composited over `bottom` at `amount` opacity, on the encoded components as the screen does. */
        fun overlaid(bottom: Int, top: Int, amount: Double): Int {
            fun channel(shift: Int): Int {
                val a = (bottom shr shift) and 0xFF
                val b = (top shr shift) and 0xFF
                return (a + (b - a) * amount).roundToInt().coerceIn(0, 255)
            }
            return (channel(16) shl 16) or (channel(8) shl 8) or channel(0)
        }

        fun luminance(color: Int): Double =
            0.2126 * linear(((color shr 16) and 0xFF) / 255.0) + 0.7152 * linear(((color shr 8) and 0xFF) / 255.0) +
                0.0722 * linear((color and 0xFF) / 255.0)

        fun contrast(first: Int, second: Int): Double {
            val a = luminance(first)
            val b = luminance(second)
            return (max(a, b) + 0.05) / (min(a, b) + 0.05)
        }

        private fun textFor(base: Int, dark: Boolean): Int {
            val surfaces = textSurfaces(base, dark)
            return adjusted(base, lighten = dark) { candidate -> surfaces.all { contrast(candidate, it) >= MINIMUM_CONTRAST } }
        }

        /** Bisects OKLCH lightness towards `lighten` for the value nearest the brand that satisfies `passes`. */
        private fun adjusted(base: Int, lighten: Boolean, passes: (Int) -> Boolean): Int {
            if (passes(base)) return base
            val color = Oklch(base)
            var good = if (lighten) 1.0 else 0.0
            var bad = color.lightness
            repeat(32) {
                val middle = (good + bad) / 2
                if (passes(color.rgb(middle))) good = middle else bad = middle
            }
            return color.rgb(good)
        }

        private fun linear(value: Double): Double = if (value <= 0.04045) value / 12.92 else ((value + 0.055) / 1.055).pow(2.4)

        private fun encoded(value: Double): Double {
            val clamped = value.coerceIn(0.0, 1.0)
            return if (clamped <= 0.0031308) clamped * 12.92 else 1.055 * clamped.pow(1 / 2.4) - 0.055
        }
    }

    /** OKLCH (Björn Ottosson's OKLab in polar form): lightness, chroma, hue in radians. */
    private class Oklch(rgb: Int) {
        val lightness: Double
        private val chroma: Double
        private val hue: Double

        init {
            val red = linear(((rgb shr 16) and 0xFF) / 255.0)
            val green = linear(((rgb shr 8) and 0xFF) / 255.0)
            val blue = linear((rgb and 0xFF) / 255.0)
            val l = cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
            val m = cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
            val s = cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
            lightness = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
            val a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
            val b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
            chroma = sqrt(a * a + b * b)
            hue = atan2(b, a)
        }

        /** Same hue and chroma at `lightness`, with chroma scaled to the sRGB boundary when needed. */
        fun rgb(lightness: Double): Int {
            val a = chroma * cos(hue)
            val b = chroma * sin(hue)
            var channels = linearRgb(lightness, a, b)
            if (!inGamut(channels)) {
                var inside = 0.0
                var outside = 1.0
                repeat(32) {
                    val middle = (inside + outside) / 2
                    if (inGamut(linearRgb(lightness, a * middle, b * middle))) inside = middle else outside = middle
                }
                channels = linearRgb(lightness, a * inside, b * inside)
            }
            fun byte(value: Double): Int = (encoded(value) * 255).roundToInt().coerceIn(0, 255)
            return (byte(channels[0]) shl 16) or (byte(channels[1]) shl 8) or byte(channels[2])
        }

        private fun linearRgb(lightness: Double, a: Double, b: Double): DoubleArray {
            fun cube(value: Double) = value * value * value
            val l = cube(lightness + 0.3963377774 * a + 0.2158037573 * b)
            val m = cube(lightness - 0.1055613458 * a - 0.0638541728 * b)
            val s = cube(lightness - 0.0894841775 * a - 1.2914855480 * b)
            return doubleArrayOf(
                4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
            )
        }

        private fun inGamut(channels: DoubleArray): Boolean = channels.all { it >= -1e-7 && it <= 1 + 1e-7 }
    }
}

/** HSL with fractional components, as packed ARGB. */
fun hslColor(hue: Double, saturation: Double, lightness: Double, alpha: Double = 1.0): Int {
    val s = saturation / 100
    val l = lightness / 100
    val chroma = (1 - abs(2 * l - 1)) * s
    val scaled = ((hue % 360) + 360) % 360 / 60
    val x = chroma * (1 - abs(scaled % 2 - 1))
    val (r, g, b) = when {
        scaled < 1 -> Triple(chroma, x, 0.0)
        scaled < 2 -> Triple(x, chroma, 0.0)
        scaled < 3 -> Triple(0.0, chroma, x)
        scaled < 4 -> Triple(0.0, x, chroma)
        scaled < 5 -> Triple(x, 0.0, chroma)
        else -> Triple(chroma, 0.0, x)
    }
    val match = l - chroma / 2
    fun byte(value: Double) = ((value + match) * 255).roundToInt().coerceIn(0, 255)
    return ((alpha * 255).roundToInt().coerceIn(0, 255) shl 24) or (byte(r) shl 16) or (byte(g) shl 8) or byte(b)
}

/** The theme colour that goes with a course palette: its accent, or the app brand for the multicolour one. */
fun scheduleThemeBrand(palette: String): Int =
    if (palette == "color-glass") 0x0F8F7F else parseHexColor(schedulePalette(palette).courseBorder) and 0xFFFFFF

/**
 * A course's colours in the styled timetable (iOS `ScheduleStyleCourseColor`).
 * The hue comes from the same UTF-16 name hash as Web and iOS, so a course
 * keeps its colour family on every client; a single-colour palette gives every
 * course that palette's hue.
 */
class StyleCourseColor(name: String, palette: String) {
    /** Degrees, 0..<360. */
    val hue: Double
    /** Percent. */
    val saturation: Double
    val backgroundLightness: Double

    init {
        if (palette == "color-glass") {
            val hash = courseNameHash(name)
            hue = (hash % 360).toDouble()
            saturation = (58 + (hash ushr 8) % 18).toDouble()
            backgroundLightness = (89 + (hash ushr 16) % 5).toDouble()
        } else {
            val brand = scheduleThemeBrand(palette)
            val (brandHue, brandSaturation) = hueSaturation(brand)
            hue = brandHue
            // Slate stays grey; only an over-vivid accent is held back.
            saturation = min(76.0, brandSaturation)
            backgroundLightness = 91.0
        }
    }

    /**
     * Text, stripes and dots. Light text sits at a fixed lightness so every
     * hue clears 4.5:1 on its own pale fill; dark uses a brighter step.
     */
    fun accent(dark: Boolean): Int =
        if (dark) hslColor(hue, min(82.0, saturation + 8), 80.0) else hslColor(hue, min(76.0, saturation + 4), 24.0)

    /**
     * The flat fill behind a course: an opaque pale tint in light mode, a
     * translucent course colour over the dark canvas in dark mode.
     */
    fun fill(dark: Boolean, hasBackground: Boolean = false): Int {
        val capped = min(45.0, saturation)
        if (dark) return hslColor(hue, capped, 50.0, 0.22)
        return hslColor(hue, capped, max(93.0, backgroundLightness), if (hasBackground) 0.92 else 1.0)
    }

    fun border(dark: Boolean): Int =
        hslColor(hue, min(50.0, saturation), if (dark) 70.0 else 55.0, if (dark) 0.34 else 0.22)

    private fun hueSaturation(color: Int): Pair<Double, Double> {
        val red = ((color shr 16) and 0xFF) / 255.0
        val green = ((color shr 8) and 0xFF) / 255.0
        val blue = (color and 0xFF) / 255.0
        val highest = max(red, max(green, blue))
        val lowest = min(red, min(green, blue))
        val delta = highest - lowest
        if (delta <= 0) return 0.0 to 0.0
        val lightness = (highest + lowest) / 2
        val saturation = delta / (1 - abs(2 * lightness - 1))
        var hue = when (highest) {
            red -> ((green - blue) / delta) % 6
            green -> (blue - red) / delta + 2
            else -> (red - green) / delta + 4
        } * 60
        if (hue < 0) hue += 360
        return hue to min(100.0, saturation * 100)
    }
}

/**
 * Everything a styled timetable view needs to pick its colours: the style, the
 * appearance, the course palette and what lies behind the grid.
 */
@Immutable
data class ScheduleStyleScope(
    val style: ScheduleVisualStyle,
    val dark: Boolean,
    val palette: String,
    /** Page text colours of the app theme, used where the style brings no ink of its own. */
    val primary: Color,
    val secondary: Color,
    val hasBackground: Boolean = false,
    /** How much of the background photo shows; the week panel veils more of a stronger photo. */
    val backgroundVisibility: Float = 0f,
    /**
     * Set while drawing a picture that outlives the moment, such as a style
     * thumbnail: no today, no "now", nothing greyed as finished.
     */
    val static: Boolean = false,
) {
    private val theme = ThemePalette.of(scheduleThemeBrand(palette))

    val themeText: Color get() = Color(0xFF000000.toInt() or theme.text(dark))
    val themeFill: Color get() = Color(0xFF000000.toInt() or theme.fill)
    val onFill: Color get() = Color.White
    fun themeTint(amount: Float): Color = Color(0xFF000000.toInt() or theme.base).copy(alpha = amount)

    val ink: Color get() = style.inkColor(dark, primary)
    val accent: Color get() = style.accentColor(dark, themeText)
    val canvas: Color? get() = if (hasBackground) null else style.canvasColor(dark)
    val fontFamily: FontFamily get() = style.fontFamily

    /** Secondary metadata grey for period times and the like: at least 4.5:1 on the canvas and the panel. */
    val meta: Color get() = Color(if (dark) 0xFF98989D else 0xFF6E6E73)

    /** Empty cells and other small surfaces: a flat fill, no gradient. */
    val cellSurface: Color
        get() = if (hasBackground) Color.White.copy(alpha = if (dark) 0.08f else 0.55f)
        else if (dark) Color.White.copy(alpha = 0.05f) else Color.White

    /** The whole week panel. Over a photo it is a thin flat veil; a stronger photo gets more veil. */
    val panelSurface: Color
        get() {
            canvas?.let { return it }
            if (!hasBackground) return Color.White.copy(alpha = ThemePalette.panelWhiteOpacity(dark).toFloat())
            val veil = 0.14f + 0.32f * backgroundVisibility.coerceIn(0f, 1f)
            return (if (dark) Color.Black else Color.White).copy(alpha = veil)
        }

    /** A standalone card such as the rest-day card. */
    val cardSurface: Color
        get() = canvas ?: if (hasBackground) (if (dark) Color(0xFF23272C) else Color.White).copy(alpha = 0.86f)
        else if (dark) Color.White.copy(alpha = 0.07f) else Color.White

    /** The hairline around cells and cards. */
    val cellBorder: Color get() = if (dark) Color.White.copy(alpha = 0.12f) else Color(0x24242E47)

    val todayStrength: Float get() = ThemePalette.todayStrength(dark).toFloat()

    fun course(name: String): StyleCourseColor = StyleCourseColor(name, palette)
}

val LocalScheduleStyle = staticCompositionLocalOf {
    ScheduleStyleScope(ScheduleVisualStyle.Classic, false, "color-glass", Color(0xFF172033), Color(0xFF64748B))
}

/** Helpers shared by the styled week, day and month views (iOS `ScheduleStyleTime`). */
object ScheduleStyleTime {
    /** "08:00" → 480; null when it cannot be parsed. */
    fun clockMinutes(value: String): Int? {
        val parts = value.split(':').mapNotNull { it.trim().toIntOrNull() }
        return if (parts.size >= 2) parts[0] * 60 + parts[1] else null
    }

    fun session(start: String): String {
        val minutes = clockMinutes(start) ?: return "课程"
        return if (minutes < 12 * 60) "上午" else if (minutes < 18 * 60) "下午" else "晚上"
    }

    fun numeral(number: Int): String {
        val values = listOf("零", "一", "二", "三", "四", "五", "六", "七", "八", "九")
        if (number <= 0 || number >= 100) return number.toString()
        if (number < 10) return values[number]
        return (if (number < 20) "十" else values[number / 10] + "十") + (if (number % 10 == 0) "" else values[number % 10])
    }

    /** The room without a leading "@": some rows carry one already and the tiles add their own. */
    fun location(raw: String?): String? = raw?.trim()?.trim('@', '＠', ' ', '\t')?.takeIf { it.isNotEmpty() }

    /** "第 1–2 节", or "第 9 节" for a single period. */
    fun slotText(start: Int, end: Int): String = if (start == end) "第 $start 节" else "第 $start–$end 节"

    /** Minutes since midnight in the timetable's time zone. */
    fun minutesNow(now: Long = System.currentTimeMillis()): Int {
        val calendar = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Shanghai"))
        calendar.timeInMillis = now
        return calendar.get(java.util.Calendar.HOUR_OF_DAY) * 60 + calendar.get(java.util.Calendar.MINUTE)
    }
}
