package cn.lizmt.cpuweb.schedule

import android.content.Intent
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.ComposeView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class NativeWebLayerInstrumentedTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    private fun event(activity: TouchRegressionActivity, action: Int, y: Float, down: Long, count: Int = 1) {
        val properties = Array(count) { index -> MotionEvent.PointerProperties().apply { id = index; toolType = MotionEvent.TOOL_TYPE_FINGER } }
        val coordinates = Array(count) { index -> MotionEvent.PointerCoords().apply { x = 200f + index * 120f; this.y = y; pressure = 1f; size = 0.1f } }
        val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, count, properties,
            coordinates, 0, 0, 1f, 1f, 0, 0, android.view.InputDevice.SOURCE_TOUCHSCREEN, 0)
        activity.window.decorView.dispatchTouchEvent(event)
        event.recycle()
    }

    @Test fun nativePageBypassesComposeAndEveryFreshSingleFingerGestureScrolls() {
        ActivityScenario.launch<TouchRegressionActivity>(Intent(instrumentation.targetContext, TouchRegressionActivity::class.java)).use { scenario ->
            lateinit var page: WebView
            lateinit var layer: NativeWebLayer
            lateinit var chrome: ComposeView
            var composeEvents = 0
            val loaded = CountDownLatch(1)
            scenario.onActivity { activity ->
                val root = FrameLayout(activity)
                chrome = ComposeView(activity).apply {
                    setContent {
                        // Deliberately consume all events received by Compose. Page events
                        // must never reach this path, even with hostile native gestures.
                        Box(Modifier.fillMaxSize().pointerInput(Unit) {
                            awaitPointerEventScope {
                                while (true) {
                                    val event = awaitPointerEvent()
                                    composeEvents++
                                    event.changes.forEach { it.consume() }
                                }
                            }
                        })
                    }
                }
                page = WebView(activity).apply {
                    settings.javaScriptEnabled = true
                    settings.userAgentString += " CPUTimeNative/1"
                    val bootstrap = activity.assets.open("NativeShellBootstrap.js").bufferedReader().use { it.readText() }
                        .replace("__CPU_APP_ORIGIN__", "https://cputime.cn")
                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView, url: String) {
                            view.evaluateJavascript(bootstrap) { loaded.countDown() }
                        }
                    }
                    // Real app CSS: nested auto-height body plus overscroll:none used
                    // to trap single-finger scrolls in WebView 149. The APK bootstrap
                    // must override this while preserving explicit dialog locks.
                    loadDataWithBaseURL("https://cputime.cn", """
                        <meta name='viewport' content='width=device-width'>
                        <style>
                        html,body{margin:0;height:100%;overscroll-behavior:none}
                        html[data-cpu-ios-next],html[data-cpu-ios-next] body{height:auto;min-height:100%;overflow-x:hidden;overflow-y:auto}
                        body.el-popup-parent--hidden{overflow:hidden}
                        </style>
                        <body><div style='height:9000px;background:linear-gradient(red,blue)'>Native touch regression</div></body>
                    """.trimIndent(), "text/html", "UTF-8", null)
                }
                layer = NativeWebLayer(activity).apply { bind(page) }
                root.addView(chrome, FrameLayout.LayoutParams(-1, -1))
                root.addView(layer, FrameLayout.LayoutParams(0, 0))
                root.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
                    layer.place(0, 140, root.width, root.height - 280)
                    layer.showPage(true, false, false)
                }
                activity.setContentView(root)
            }
            assertTrue(loaded.await(10, TimeUnit.SECONDS))
            instrumentation.waitForIdleSync()
            Thread.sleep(400)
            val stylesRead = CountDownLatch(1)
            var bodyOverflow = ""
            scenario.onActivity {
                page.evaluateJavascript("getComputedStyle(document.body).overflow") { value -> bodyOverflow = value; stylesRead.countDown() }
            }
            assertTrue(stylesRead.await(5, TimeUnit.SECONDS))
            assertEquals("\"visible\"", bodyOverflow)
            val lockRead = CountDownLatch(1)
            var lockedOverflow = ""
            scenario.onActivity {
                page.evaluateJavascript("(()=>{document.body.classList.add('el-popup-parent--hidden');const value=getComputedStyle(document.body).overflow;document.body.classList.remove('el-popup-parent--hidden');return value})()") {
                    value -> lockedOverflow = value; lockRead.countDown()
                }
            }
            assertTrue(lockRead.await(5, TimeUnit.SECONDS))
            assertEquals("\"hidden\"", lockedOverflow)
            scenario.onActivity {
                assertSame(chrome.parent, layer.parent)
                assertSame(layer, page.parent)
                var ancestor = page.parent
                while (ancestor is View) {
                    assertFalse("No Compose host may be above the WebView", ancestor is ComposeView || ancestor.javaClass.name.contains("AndroidComposeView"))
                    ancestor = ancestor.parent
                }
            }
            fun swipe() {
                var before = 0
                scenario.onActivity { before = page.scrollY }
                val down = SystemClock.uptimeMillis()
                scenario.onActivity { event(it, MotionEvent.ACTION_DOWN, 1400f, down) }
                for (step in 1..20) {
                    Thread.sleep(16)
                    scenario.onActivity { event(it, MotionEvent.ACTION_MOVE, 1400f - step * 40f, down) }
                }
                scenario.onActivity { event(it, MotionEvent.ACTION_UP, 600f, down) }
                Thread.sleep(250)
                scenario.onActivity { assertTrue("Fresh single finger must scroll", page.scrollY > before + 100) }
            }
            repeat(3) { swipe() }
            scenario.onActivity { assertEquals("Compose must receive none of the page gestures", 0, composeEvents) }
            // Add and remove a second finger, lift both, then start fresh again.
            val down = SystemClock.uptimeMillis()
            scenario.onActivity { event(it, MotionEvent.ACTION_DOWN, 1200f, down) }
            scenario.onActivity { event(it, MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 1200f, down, 2) }
            scenario.onActivity { event(it, MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 1200f, down, 2) }
            scenario.onActivity { event(it, MotionEvent.ACTION_UP, 1200f, down) }
            swipe()
            // A native page or full-screen gate must own the same area when the WebView is hidden.
            scenario.onActivity { layer.showPage(false, false, false) }
            val hidden = SystemClock.uptimeMillis()
            scenario.onActivity { event(it, MotionEvent.ACTION_DOWN, 700f, hidden) }
            scenario.onActivity { event(it, MotionEvent.ACTION_UP, 700f, hidden) }
            scenario.onActivity { assertTrue(composeEvents > 0); layer.showPage(true, false, false) }
            swipe()
            scenario.onActivity { layer.removeView(page); page.destroy() }
        }
    }

    @Test fun rendererReplacementKeepsNativeParentAndViewport() {
        ActivityScenario.launch<TouchRegressionActivity>(Intent(instrumentation.targetContext, TouchRegressionActivity::class.java)).use { scenario ->
            scenario.onActivity { activity ->
                val root = FrameLayout(activity)
                val layer = NativeWebLayer(activity)
                root.addView(layer)
                activity.setContentView(root)
                val old = WebView(activity)
                val fresh = WebView(activity)
                layer.bind(old)
                layer.place(0, 120, 800, 1200)
                layer.bind(fresh)
                assertNull(old.parent)
                assertSame(layer, fresh.parent)
                assertEquals(1200, layer.layoutParams.height)
                old.destroy()
                layer.removeView(fresh)
                fresh.destroy()
            }
        }
    }
}
