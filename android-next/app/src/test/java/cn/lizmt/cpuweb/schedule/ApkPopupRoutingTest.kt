package cn.lizmt.cpuweb.schedule

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ApkPopupRoutingTest {
    @Test fun sameOriginTargetBlankApkUsesInstallerInsteadOfVueRouter() {
        for (path in listOf("/api/site/downloads/android-app", "/downloads/CPU-Web-Android-V46.apk", "/api/site/downloads/desktop-app")) {
            val activity = Robolectric.buildActivity(MainActivity::class.java).get()
            val downloads = mutableListOf<String>()
            val external = mutableListOf<String>()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
            val host = object : WebSessionHost {
                override fun openExternal(uri: Uri) { external += uri.toString() }
                override fun chooseFiles(params: WebChromeClient.FileChooserParams, callback: ValueCallback<Array<Uri>?>) {}
                override fun requestWebPermissions(permissions: Array<String>, onResult: (Boolean) -> Unit) {}
                override fun handleApkDownload(url: String): Boolean { downloads += url; return true }
            }
            val session = WebSession(activity, scope, host, CpuAndroidBridge(activity))
            try {
                val transport = session.webView.WebViewTransport()
                val message = Handler(Looper.getMainLooper()).obtainMessage().apply { obj = transport }
                assertTrue(session.webView.webChromeClient!!.onCreateWindow(session.webView, false, true, message))
                val popup = requireNotNull(transport.webView)
                val url = AppConfig.origin + path
                popup.webViewClient.onPageStarted(popup, url, null)
                popup.webViewClient.onPageStarted(popup, url, null)
                if (path.endsWith("desktop-app")) {
                    assertTrue(downloads.isEmpty())
                    assertEquals(listOf(url), external)
                } else {
                    assertEquals(listOf(url), downloads)
                    assertTrue(external.isEmpty())
                }
                assertNull("Download endpoints must never replace the page", session.webView.url)
            } finally {
                session.destroy()
                scope.cancel()
            }
        }
    }
}
