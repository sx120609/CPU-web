package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * Fireworks over a holiday's empty day: a few bursts, sparks flying out
 * under gravity and fading (iOS `ScheduleFireworks`). One canvas from a fixed
 * seed, so every play looks the same; [onFinished] runs after [duration] seconds.
 */
@Composable
internal fun ScheduleFireworks(key: Any, duration: Float = 3.2f, onFinished: () -> Unit) {
    var elapsed by remember(key) { mutableFloatStateOf(0f) }
    LaunchedEffect(key) {
        val start = withFrameNanos { it }
        while (elapsed < duration) {
            elapsed = withFrameNanos { (it - start) / 1_000_000_000f }
        }
        onFinished()
    }
    Canvas(Modifier.fillMaxSize()) {
        val reach = min(size.width, size.height) * 0.32f
        for (spark in FireworkShow.sparks) {
            val burst = FireworkShow.bursts[spark.burst]
            val t = elapsed - burst.delay
            if (t <= 0f || t >= 1.8f) continue
            val progress = 1 - (1 - min(t / 1.1f, 1f)).pow(3)
            val distance = reach * spark.speed * progress
            val x = burst.x * size.width + cos(spark.angle) * distance
            val y = burst.y * size.height + sin(spark.angle) * distance + 40f * t * t * density
            val fade = (1 - t / 1.8f).coerceAtLeast(0f)
            val color = Color.hsv((spark.hue % 1f + 1f) % 1f * 360f, 0.85f, 1f).copy(alpha = fade)
            val radius = spark.size * (0.6f + 0.4f * fade) * density
            drawCircle(color, radius, Offset(x, y))
            // A short trail back towards the centre.
            drawLine(color.copy(alpha = fade * 0.5f), Offset(x, y),
                Offset(x - cos(spark.angle) * 18f * fade * density, y - sin(spark.angle) * 18f * fade * density),
                strokeWidth = radius * 0.8f, cap = StrokeCap.Round)
        }
        // The flash of each burst.
        for (burst in FireworkShow.bursts) {
            val t = elapsed - burst.delay
            if (t <= 0f || t >= 0.35f) continue
            drawCircle(Color.White.copy(alpha = 0.7f * (1 - t / 0.35f)), 26f * density * (t / 0.35f), Offset(burst.x * size.width, burst.y * size.height))
        }
    }
}

internal object FireworkShow {
    class Burst(val x: Float, val y: Float, val delay: Float, val hue: Float)
    class Spark(val burst: Int, val angle: Float, val speed: Float, val size: Float, val hue: Float)

    val bursts = listOf(
        Burst(0.5f, 0.34f, 0f, 0.98f), Burst(0.24f, 0.22f, 0.35f, 0.12f), Burst(0.77f, 0.26f, 0.6f, 0.55f),
        Burst(0.38f, 0.12f, 1.0f, 0.82f), Burst(0.66f, 0.42f, 1.25f, 0.32f),
    )

    val sparks: List<Spark> = run {
        var seed = 0x9E3779B97F4A7C15uL
        fun next(): Float {
            seed = seed * 6364136223846793005uL + 1442695040888963407uL
            return ((seed shr 11).toDouble() / (1uL shl 53).toDouble()).toFloat()
        }
        bursts.flatMapIndexed { index, burst ->
            (0 until 36).map { spark ->
                Spark(index, (spark / 36f * 2 * Math.PI).toFloat() + next() * 0.2f, 0.55f + next() * 0.45f, 3f + next() * 2.8f,
                    burst.hue + (next() - 0.5f) * 0.08f)
            }
        }
    }

    /** A festive holiday: fireworks, not for 清明. */
    fun festive(greeting: String?): Boolean = !greeting.isNullOrEmpty() && !greeting.startsWith("清明")
}
