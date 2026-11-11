package cn.lizmt.cpuweb.schedule

import android.graphics.Rect
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** The part of a background photo shown, as fractions of its width and height (iOS `backgroundCrop`). */
data class BackgroundCrop(val x: Float, val y: Float, val width: Float, val height: Float) {
    /** Clipped to the photo; null when it is next to nothing or practically all of it. */
    fun normalized(): BackgroundCrop? {
        val left = x.coerceIn(0f, 1f)
        val top = y.coerceIn(0f, 1f)
        val right = (x + width).coerceIn(0f, 1f)
        val bottom = (y + height).coerceIn(0f, 1f)
        val w = right - left
        val h = bottom - top
        if (w <= 0.02f || h <= 0.02f) return null
        return if (w > 0.995f && h > 0.995f) null else BackgroundCrop(left, top, w, h)
    }

    fun text(): String = listOf(x, y, width, height).joinToString(",") { "%.5f".format(java.util.Locale.US, it) }

    fun pixels(imageWidth: Int, imageHeight: Int): Rect? {
        val left = (x * imageWidth).roundToInt().coerceIn(0, imageWidth - 1)
        val top = (y * imageHeight).roundToInt().coerceIn(0, imageHeight - 1)
        val right = ((x + width) * imageWidth).roundToInt().coerceIn(left + 1, imageWidth)
        val bottom = ((y + height) * imageHeight).roundToInt().coerceIn(top + 1, imageHeight)
        return Rect(left, top, right, bottom)
    }

    companion object {
        fun parse(text: String?): BackgroundCrop? {
            val parts = text.orEmpty().split(',').mapNotNull { it.trim().toFloatOrNull() }
            if (parts.size != 4) return null
            return BackgroundCrop(parts[0], parts[1], parts[2], parts[3]).normalized()
        }

        /**
         * The framing a viewport of [viewWidth]×[viewHeight] shows of an image
         * of [imageWidth]×[imageHeight] drawn at [scale] with its top-left at
         * ([left], [top]).
         */
        fun of(imageWidth: Float, imageHeight: Float, viewWidth: Float, viewHeight: Float, scale: Float, left: Float, top: Float) =
            BackgroundCrop(-left / (imageWidth * scale), -top / (imageHeight * scale), viewWidth / (imageWidth * scale), viewHeight / (imageHeight * scale))
    }
}

/**
 * 调整范围: frames a photo at the screen's shape, like a wallpaper. Drag,
 * pinch up to 5×, a rule of thirds, 还原. The choice is kept as fractions of
 * the original, which stays on disk, so it can be framed again later.
 */
@Composable
internal fun BackgroundCropEditor(image: ImageBitmap, crop: BackgroundCrop?, onDone: (BackgroundCrop?) -> Unit, onDismiss: () -> Unit) {
    val configuration = LocalConfiguration.current
    val aspect = configuration.screenWidthDp.toFloat() / configuration.screenHeightDp.coerceAtLeast(1)
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(Color.Black).systemBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text("取消", color = Color.White) }
                Text("调整范围", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Spacer(Modifier.size(64.dp))
            }
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                val density = LocalDensity.current
                val boxWidth = with(density) { maxWidth.toPx() }
                val boxHeight = with(density) { maxHeight.toPx() }
                // The screen's shape, as large as fits.
                val viewWidth = min(boxWidth, boxHeight * aspect)
                val viewHeight = viewWidth / aspect
                val imageWidth = image.width.toFloat()
                val imageHeight = image.height.toFloat()
                val cover = max(viewWidth / imageWidth, viewHeight / imageHeight)
                fun clampLeft(value: Float, scale: Float) = value.coerceIn(viewWidth - imageWidth * scale, 0f)
                fun clampTop(value: Float, scale: Float) = value.coerceIn(viewHeight - imageHeight * scale, 0f)
                val initialZoom = crop?.let { (viewWidth / (cover * it.width * imageWidth)).coerceIn(1f, 5f) } ?: 1f
                var zoom by remember(image) { mutableFloatStateOf(initialZoom) }
                var left by remember(image) {
                    mutableFloatStateOf(crop?.let { clampLeft(-it.x * imageWidth * cover * initialZoom, cover * initialZoom) }
                        ?: (viewWidth - imageWidth * cover) / 2)
                }
                var top by remember(image) {
                    mutableFloatStateOf(crop?.let { clampTop(-it.y * imageHeight * cover * initialZoom, cover * initialZoom) }
                        ?: (viewHeight - imageHeight * cover) / 2)
                }
                val viewWidthDp = with(density) { viewWidth.toDp() }
                val viewHeightDp = with(density) { viewHeight.toDp() }
                Box(
                    Modifier.size(viewWidthDp, viewHeightDp).clipToBounds().border(1.dp, Color.White.copy(alpha = 0.7f))
                        .semantics { contentDescription = "拖动和双指缩放来选择显示的范围" }
                        .pointerInput(image) {
                            detectTransformGestures { centroid, pan, gestureZoom, _ ->
                                val next = (zoom * gestureZoom).coerceIn(1f, 5f)
                                val scaleBefore = cover * zoom
                                val scaleAfter = cover * next
                                // Zoom about the fingers, then follow the pan.
                                val focusX = (centroid.x - left) / scaleBefore
                                val focusY = (centroid.y - top) / scaleBefore
                                zoom = next
                                left = clampLeft(centroid.x - focusX * scaleAfter + pan.x, scaleAfter)
                                top = clampTop(centroid.y - focusY * scaleAfter + pan.y, scaleAfter)
                            }
                        },
                ) {
                    Canvas(Modifier.fillMaxSize()) {
                        val scale = cover * zoom
                        drawImage(
                            image, dstOffset = IntOffset(left.roundToInt(), top.roundToInt()),
                            dstSize = IntSize((imageWidth * scale).roundToInt(), (imageHeight * scale).roundToInt()),
                        )
                        // The rule of thirds.
                        for (index in 1..2) {
                            val x = size.width * index / 3
                            val y = size.height * index / 3
                            drawLine(Color.White.copy(alpha = 0.45f), Offset(x, 0f), Offset(x, size.height), 1f)
                            drawLine(Color.White.copy(alpha = 0.45f), Offset(0f, y), Offset(size.width, y), 1f)
                        }
                    }
                }
                CropActions(
                    onReset = {
                        zoom = 1f
                        left = (viewWidth - imageWidth * cover) / 2
                        top = (viewHeight - imageHeight * cover) / 2
                    },
                    onDone = {
                        onDone(BackgroundCrop.of(imageWidth, imageHeight, viewWidth, viewHeight, cover * zoom, left, top).normalized())
                    },
                    modifier = Modifier.align(Alignment.BottomCenter),
                )
            }
            Text("拖动、双指缩放，选择课表背景显示的范围", color = Color.White.copy(alpha = 0.7f), fontSize = 13.sp,
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

@Composable
private fun CropActions(onReset: () -> Unit, onDone: () -> Unit, modifier: Modifier) {
    Row(modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = onReset, modifier = Modifier.background(Color.Black.copy(alpha = 0.5f))) { Text("还原", color = Color.White) }
        TextButton(onClick = onDone, modifier = Modifier.background(Color.Black.copy(alpha = 0.5f))) {
            Text("完成", color = Color(0xFF6FD3C1), fontWeight = FontWeight.SemiBold)
        }
    }
}
