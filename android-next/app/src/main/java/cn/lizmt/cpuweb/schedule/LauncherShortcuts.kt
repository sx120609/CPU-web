package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.ui.graphics.toArgb
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import cn.lizmt.cpuweb.schedule.custom.Customization
import cn.lizmt.cpuweb.schedule.custom.Destination

/**
 * Launcher shortcuts for the user's chosen pages: the long-press menu on the
 * app icon, and icons pinned to the home screen. Each opens [MainActivity]
 * with the destination id, which the shell opens like a quick entry.
 */
object LauncherShortcuts {
    const val EXTRA_DESTINATION = "cn.lizmt.cpuweb.DESTINATION"

    fun sync(context: Context, custom: Customization) {
        val shortcuts = custom.launcherShortcuts.mapNotNull(custom::destination).mapIndexed { rank, destination ->
            build(context, destination, custom, "dynamic-${destination.id}").setRank(rank).build()
        }
        runCatching { ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts) }
    }

    /** Asks the launcher to place a home-screen icon; false when it cannot. */
    fun pin(context: Context, destination: Destination, custom: Customization = Customization()): Boolean {
        if (!ShortcutManagerCompat.isRequestPinShortcutSupported(context)) return false
        return runCatching {
            ShortcutManagerCompat.requestPinShortcut(context, build(context, destination, custom, "pin-${destination.id}").build(), null)
        }.getOrDefault(false)
    }

    private fun build(context: Context, destination: Destination, custom: Customization, id: String): ShortcutInfoCompat.Builder {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .putExtra(EXTRA_DESTINATION, destination.id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return ShortcutInfoCompat.Builder(context, id)
            .setShortLabel(destination.title)
            .setLongLabel("打开${destination.title}")
            .setIcon(IconCompat.createWithAdaptiveBitmap(tile(destination.title, accentArgb(custom))))
            .setIntent(intent)
    }

    private fun accentArgb(custom: Customization): Int =
        (if (custom.accent.startsWith("#")) parseHex(custom.accent) else null)?.toArgb() ?: CpuBrand.toArgb()

    /** An adaptive icon: the first character of the title on the accent colour. */
    private fun tile(title: String, color: Int): Bitmap {
        val size = 216
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(color)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = android.graphics.Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = size * 0.3f
            typeface = Typeface.DEFAULT_BOLD
        }
        val label = title.trim().let { if (it.isEmpty()) "拾" else String(Character.toChars(it.codePointAt(0))) }
        val baseline = size / 2f - (paint.descent() + paint.ascent()) / 2f
        canvas.drawText(label, size / 2f, baseline, paint)
        return bitmap
    }
}
