package cn.lizmt.cpuweb.schedule

import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.CookieManager
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.abs
import kotlin.math.max

data class PreviewImage(val url: String, val title: String, val fileName: String)

data class ImagePreviewRequest(val images: List<PreviewImage>, val index: Int) {
    companion object {
        /** Parse the Web `previewImages` payload; only http(s) images are accepted. */
        @JvmStatic
        fun parse(payload: String?): ImagePreviewRequest? {
            val json = runCatching { JSONObject(payload ?: "{}") }.getOrNull() ?: return null
            val array = json.optJSONArray("images") ?: return null
            val images = (0 until array.length()).mapNotNull { index ->
                val item = array.optJSONObject(index) ?: return@mapNotNull null
                val url = item.optString("url").trim()
                if (!AppConfig.isHttpUrl(url)) return@mapNotNull null
                val fileName = sanitizeImageName(item.optString("fileName").ifBlank { item.optString("title") })
                PreviewImage(url, item.optString("title").ifBlank { fileName.substringBeforeLast('.') }, fileName)
            }
            if (images.isEmpty()) return null
            return ImagePreviewRequest(images, json.optInt("index", 0).coerceIn(0, images.lastIndex))
        }

        fun sanitizeImageName(value: String): String {
            var raw = value.trim().ifEmpty { "cpu-share.png" }.replace(Regex("[\\\\/:*?\"<>|]"), "_")
            if (!Regex("\\.(png|jpe?g|webp|gif)$", RegexOption.IGNORE_CASE).containsMatchIn(raw)) raw += ".png"
            return raw
        }
    }
}

/**
 * Download bytes, sending the site cookie only to the first-party origin.
 * Redirects are followed by hand: HttpURLConnection would otherwise carry the
 * manually set Cookie header on to a CDN or any other redirect target.
 */
internal suspend fun downloadImage(url: String): ByteArray? = withContext(Dispatchers.IO) {
    runCatching {
        var target = url
        repeat(MAX_IMAGE_REDIRECTS + 1) {
            if (!AppConfig.isHttpUrl(target)) return@runCatching null
            val connection = URL(target).openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 10_000
                connection.readTimeout = 20_000
                if (AppConfig.isTrusted(target)) {
                    CookieManager.getInstance().getCookie(target)?.let { connection.setRequestProperty("Cookie", it) }
                }
                val code = connection.responseCode
                if (code in 300..399) {
                    val location = connection.getHeaderField("Location") ?: return@runCatching null
                    target = URL(URL(target), location).toString()
                    return@repeat
                }
                if (code !in 200..299) return@runCatching null
                val limit = 30 * 1024 * 1024
                return@runCatching connection.inputStream.use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(16 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        if (output.size() > limit) return@runCatching null
                    }
                    output.toByteArray()
                }
            } finally {
                connection.disconnect()
            }
        }
        null
    }.getOrNull()
}

private const val MAX_IMAGE_REDIRECTS = 5

private fun decodeForScreen(bytes: ByteArray, maxEdge: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxEdge) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

/** Save the original bytes into Pictures/CPU-web. */
fun saveImage(activity: MainActivity, image: PreviewImage) {
    activity.lifecycleScope.launch {
        if (!activity.ensureLegacyStoragePermission()) {
            Toast.makeText(activity, "请先允许存储权限后再保存图片", Toast.LENGTH_SHORT).show()
            return@launch
        }
        val bytes = downloadImage(image.url)
        val saved = bytes != null && withContext(Dispatchers.IO) { writeToGallery(activity, bytes, image.fileName) }
        Toast.makeText(activity, if (saved) "图片已保存到相册" else "保存图片失败", Toast.LENGTH_SHORT).show()
    }
}

internal fun writeToGallery(activity: MainActivity, bytes: ByteArray, fileName: String): Boolean = runCatching {
    val name = ImagePreviewRequest.sanitizeImageName(fileName)
    val mime = when (name.substringAfterLast('.').lowercase()) {
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        else -> "image/png"
    }
    val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, name)
        put(MediaStore.Images.Media.MIME_TYPE, mime)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/CPU-web")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
    }
    val resolver = activity.contentResolver
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return@runCatching false
    resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return@runCatching false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
    }
    true
}.getOrDefault(false)

@Composable
fun ImagePreviewScreen(request: ImagePreviewRequest, onSave: (PreviewImage) -> Unit, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    val pager = rememberPagerState(initialPage = request.index) { request.images.size }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color(0xFF05070A))) {
            HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
                ZoomableImage(request.images[page], onDismiss = onClose)
            }
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, contentDescription = "关闭图片预览", tint = Color.White) }
                Spacer(Modifier.weight(1f))
                if (request.images.size > 1) Text("${pager.currentPage + 1} / ${request.images.size}", color = Color.White, fontSize = 14.sp)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { onSave(request.images[pager.currentPage]) }) {
                    Icon(Icons.Rounded.Download, contentDescription = "保存到相册", tint = Color.White)
                }
            }
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp, vertical = 12.dp)) {
                Text(
                    request.images[pager.currentPage].title, color = Color.White.copy(alpha = 0.76f), fontSize = 13.sp,
                    textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun ZoomableImage(image: PreviewImage, onDismiss: () -> Unit) {
    val bitmap by produceState<Bitmap?>(initialValue = null, image.url) {
        value = downloadImage(image.url)?.let { withContext(Dispatchers.Default) { decodeForScreen(it, 2048) } }
    }
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var dismissDrag by remember { mutableFloatStateOf(0f) }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val current = bitmap
        if (current == null) {
            CircularProgressIndicator(Modifier.size(30.dp), color = Color.White, strokeWidth = 2.dp)
        } else {
            Image(
                current.asImageBitmap(), contentDescription = image.title, contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize()
                    .pointerInput(Unit) {
                        detectTapGestures(onDoubleTap = {
                            if (scale > 1.02f) { scale = 1f; offset = Offset.Zero } else scale = 2f
                        })
                    }
                    .pointerInput(Unit) {
                        detectTransformGestures(panZoomLock = false) { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 5f)
                            offset = if (scale <= 1.02f) Offset.Zero else offset + pan
                        }
                    }
                    .pointerInput(scale) {
                        if (scale > 1.02f) return@pointerInput
                        detectVerticalDragGestures(
                            onDragEnd = { if (dismissDrag > 220f) onDismiss() else dismissDrag = 0f },
                            onDragCancel = { dismissDrag = 0f },
                        ) { _, amount -> dismissDrag = max(0f, dismissDrag + amount) }
                    }
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        translationX = offset.x
                        translationY = offset.y + dismissDrag
                        alpha = 1f - (abs(dismissDrag) / 900f).coerceAtMost(0.5f)
                    },
            )
        }
    }
    LaunchedEffect(image.url) {
        scale = 1f
        offset = Offset.Zero
    }
}
