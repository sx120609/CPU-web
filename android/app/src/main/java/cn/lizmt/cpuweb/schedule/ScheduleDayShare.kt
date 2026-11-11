package cn.lizmt.cpuweb.schedule

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.core.content.FileProvider
import java.io.File

/**
 * The picture 分享这一天 makes: a tall card with the day's classes in time
 * order, each in its course colour, for a chat or a status update (iOS
 * `ScheduleDayShareCard`). Drawn with the platform canvas, always light.
 */
object DayShareCard {
    data class Item(
        val start: String,
        val end: String,
        val name: String,
        val detail: String,
        /** ARGB. */
        val tint: Int,
        val cancelled: Boolean = false,
        val moved: Boolean = false,
    )

    data class Card(
        val brand: String,
        /** "11月12日 周四". */
        val title: String,
        /** "第 10 周 · 农历十月廿四". */
        val subtitle: String,
        val items: List<Item>,
        /** Shown when there are no classes: 放假啦 or 这天没有课. */
        val emptyText: String,
    ) {
        /** "3 节课" and "08:00–15:10", from the classes that still take place. */
        val summary: List<String>
            get() {
                val held = items.filter { !it.cancelled }
                if (items.isEmpty()) return listOf("无课")
                val first = held.firstOrNull()
                val last = held.lastOrNull()
                return listOfNotNull("${held.size} 节课", if (first != null && last != null) "${first.start}–${last.end}" else null)
            }
    }

    private const val WIDTH = 1080
    private const val PAD = 56f
    private const val BRAND = 0xFF13887A.toInt()

    fun render(card: Card): Bitmap {
        val rows = card.items.map { item -> item to rowHeight(item) }
        val headerHeight = 420f
        val listHeight = if (card.items.isEmpty()) 420f else rows.sumOf { it.second.toDouble() }.toFloat() + 28f * (rows.size - 1)
        val height = (headerHeight + 44f + listHeight + 44f + 80f).toInt()
        val bitmap = Bitmap.createBitmap(WIDTH, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(0xFFFFFFFF.toInt())

        // Header: the brand gradient with two soft circles.
        val header = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(0f, 0f, WIDTH.toFloat(), headerHeight,
                intArrayOf(BRAND, 0xFF2EA597.toInt(), 0xFF35B6C6.toInt()), null, Shader.TileMode.CLAMP)
        }
        canvas.drawRect(0f, 0f, WIDTH.toFloat(), headerHeight, header)
        val soft = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x1FFFFFFF }
        canvas.save()
        canvas.clipRect(0f, 0f, WIDTH.toFloat(), headerHeight)
        canvas.drawCircle(WIDTH - 80f, 30f, 220f, soft)
        soft.color = 0x14FFFFFF
        canvas.drawCircle(WIDTH - 120f, headerHeight + 20f, 140f, soft)
        canvas.restore()
        var y = PAD + 6f
        y = text(canvas, card.brand, PAD, y, 36f, 0xE6FFFFFF.toInt(), bold = true) + 12f
        y = text(canvas, card.title, PAD, y, 80f, 0xFFFFFFFF.toInt(), bold = true) + 12f
        y = text(canvas, card.subtitle, PAD, y, 30f, 0xD9FFFFFF.toInt()) + 22f
        text(canvas, card.summary.joinToString("   ·   "), PAD, y, 28f, 0xFFFFFFFF.toInt(), bold = true)

        // The day's classes, or a sunny empty day.
        y = headerHeight + 44f
        if (card.items.isEmpty()) {
            val sun = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFF5A623.toInt() }
            canvas.drawCircle(WIDTH / 2f, y + 110f, 64f, sun)
            sun.strokeWidth = 10f
            sun.strokeCap = Paint.Cap.ROUND
            for (index in 0 until 8) {
                val angle = Math.PI / 4 * index
                canvas.drawLine(
                    WIDTH / 2f + (Math.cos(angle) * 90).toFloat(), y + 110f + (Math.sin(angle) * 90).toFloat(),
                    WIDTH / 2f + (Math.cos(angle) * 118).toFloat(), y + 110f + (Math.sin(angle) * 118).toFloat(), sun,
                )
            }
            text(canvas, card.emptyText, 0f, y + 220f, 44f, 0xFF1C1C1E.toInt(), bold = true, center = true)
            text(canvas, "好好休息，或者去做点喜欢的事。", 0f, y + 290f, 30f, 0xFF8E8E93.toInt(), center = true)
        }
        rows.forEach { (item, rowHeight) ->
            drawRow(canvas, item, y, rowHeight)
            y += rowHeight + 28f
        }
        text(canvas, "由 ${card.brand} 生成", 0f, height - 64f, 24f, 0xFFAEAEB2.toInt(), right = true)
        return bitmap
    }

    private fun nameLayout(item: Item, width: Int): StaticLayout {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 42f
            typeface = Typeface.DEFAULT_BOLD
            color = if (item.cancelled) 0xFF8E8E93.toInt() else 0xFF1C1C1E.toInt()
            isStrikeThruText = item.cancelled
        }
        return StaticLayout.Builder.obtain(item.name, 0, item.name.length, paint, width).setMaxLines(2)
            .setEllipsize(android.text.TextUtils.TruncateAt.END).build()
    }

    private val nameWidth: Int get() = (WIDTH - PAD * 2 - 32f - 132f - 32f - 12f - 32f - 120f).toInt()

    private fun rowHeight(item: Item): Float {
        val name = nameLayout(item, nameWidth).height
        val detail = if (item.detail.isEmpty()) 0 else 46
        return maxOf(140f, 32f * 2 + name + detail)
    }

    private fun drawRow(canvas: Canvas, item: Item, top: Float, height: Float) {
        val left = PAD
        val right = WIDTH - PAD
        val wash = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = (item.tint and 0x00FFFFFF) or (0x17 shl 24) }
        canvas.drawRoundRect(RectF(left, top, right, top + height), 36f, 36f, wash)
        val timeRight = left + 32f + 132f
        text(canvas, item.start, 0f, top + 30f, 40f, 0xFF1C1C1E.toInt(), bold = true, rightAt = timeRight)
        text(canvas, item.end, 0f, top + 84f, 28f, 0xFF8E8E93.toInt(), rightAt = timeRight)
        val bar = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = item.tint }
        canvas.drawRoundRect(RectF(timeRight + 32f, top + 30f, timeRight + 44f, top + height - 30f), 6f, 6f, bar)
        val textLeft = timeRight + 44f + 32f
        val name = nameLayout(item, nameWidth)
        canvas.save()
        canvas.translate(textLeft, top + 30f)
        name.draw(canvas)
        canvas.restore()
        var tagLeft = textLeft + minOf(name.getLineWidth(name.lineCount - 1), nameWidth.toFloat()) + 16f
        val tagTop = top + 30f + name.getLineTop(name.lineCount - 1) + 8f
        if (item.cancelled) tagLeft = tag(canvas, "停课", 0xFF8E8E93.toInt(), tagLeft, tagTop) + 10f
        if (item.moved) tag(canvas, "调课", 0xFFE08A1E.toInt(), tagLeft, tagTop)
        if (item.detail.isNotEmpty()) text(canvas, item.detail, textLeft, top + 30f + name.height + 10f, 30f, 0xFF6E6E73.toInt(), maxWidth = (right - textLeft - 24f))
    }

    private fun tag(canvas: Canvas, label: String, color: Int, left: Float, top: Float): Float {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 24f; typeface = Typeface.DEFAULT_BOLD }
        val width = paint.measureText(label) + 28f
        paint.color = color
        canvas.drawRoundRect(RectF(left, top, left + width, top + 38f), 19f, 19f, paint)
        paint.color = 0xFFFFFFFF.toInt()
        canvas.drawText(label, left + 14f, top + 28f, paint)
        return left + width
    }

    /** Draws one line from its top; returns its bottom. */
    private fun text(
        canvas: Canvas, value: String, left: Float, top: Float, size: Float, color: Int, bold: Boolean = false,
        center: Boolean = false, right: Boolean = false, rightAt: Float? = null, maxWidth: Float? = null,
    ): Float {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = size
            this.color = color
            typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        }
        val shown = if (maxWidth != null) android.text.TextUtils.ellipsize(value, paint, maxWidth, android.text.TextUtils.TruncateAt.END).toString() else value
        val width = paint.measureText(shown)
        val x = when {
            center -> (WIDTH - width) / 2
            right -> WIDTH - PAD - width
            rightAt != null -> rightAt - width
            else -> left
        }
        val baseline = top - paint.fontMetrics.ascent
        canvas.drawText(shown, x, baseline, paint)
        return baseline + paint.fontMetrics.descent
    }

    /** Writes the card to the app's cache and opens the share sheet. */
    fun share(context: Context, bitmap: Bitmap, fileName: String): Boolean = runCatching {
        val folder = File(context.cacheDir, "shared").apply { mkdirs() }
        folder.listFiles()?.forEach { it.delete() }
        val file = File(folder, fileName)
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        intent.clipData = ClipData.newRawUri(fileName, uri)
        context.startActivity(Intent.createChooser(intent, "分享这一天").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        true
    }.getOrDefault(false)
}

/**
 * The day 分享这一天 shares: the one shown in the day view, else today in the
 * shown week, else the shown week's first day with classes.
 */
internal fun shareDayTarget(store: ScheduleStore): Pair<Int, String>? {
    val week = store.calendarWeek() ?: return null
    val day = if (store.viewMode == "day") store.selectedDay else {
        (1..7).firstOrNull { week.days.getOrNull(it - 1) == ScheduleStore.todayKey() }
            ?: (1..7).firstOrNull { store.blocksForDay(it).isNotEmpty() } ?: 1
    }
    val date = week.days.getOrNull(day - 1)?.takeIf { it.length == 10 } ?: return null
    return day to date
}

/** 分享这一天: the card of one day of the user's own timetable, the partner's courses left out. */
internal fun shareDayCard(activity: MainActivity, store: ScheduleStore, day: Int, date: String) {
    val week = store.calendar?.weeks?.firstOrNull { date in it.days } ?: return
    val items = store.placedBlocksForDay(day, week.week.toString()).sortedWith(compareBy({ it.startSlot }, { it.lane })).map { block ->
        DayShareCard.Item(
            start = store.startTime(block.block), end = store.endTime(block.block), name = block.course.name,
            detail = listOfNotNull(ScheduleStyleTime.location(block.course.location), block.course.teacher?.trim()?.takeIf { it.isNotEmpty() })
                .joinToString(" · "),
            tint = StyleCourseColor(block.course.name, activity.style.palette).accent(false),
            cancelled = block.block.cancelled != null, moved = block.course.isMovedOccurrence,
        )
    }
    val lunar = ChineseCalendarInfo.info(date)?.displayLabel()
    val off = store.calendar?.adjustments?.firstOrNull { it.date == date }?.kind == "off"
    val card = DayShareCard.Card(
        brand = activity.getString(R.string.app_name), title = OccurrenceRules.dateText(date),
        subtitle = listOfNotNull("第 ${week.week} 周", lunar?.let { "农历$it" }).joinToString(" · "),
        items = items, emptyText = if (off) "放假啦" else "这天没有课",
    )
    if (!DayShareCard.share(activity, DayShareCard.render(card), "课表-$date.png")) activity.toast("分享面板暂时不可用")
}
