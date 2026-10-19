package cn.lizmt.cpuweb.schedule

import android.content.ComponentName
import android.content.pm.ActivityInfo
import android.view.WindowManager
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeShellLogicTest {
    @Test
    fun onlyTheConfiguredOriginIsTrusted() {
        assertTrue(AppConfig.isTrusted("https://cputime.cn/home"))
        assertTrue(AppConfig.isTrusted("https://cputime.cn:443/profile?tab=1"))
        assertFalse(AppConfig.isTrusted("http://cputime.cn/home"))
        assertFalse(AppConfig.isTrusted("https://cputime.cn.evil.example/home"))
        assertFalse(AppConfig.isTrusted("https://evil.example/?https://cputime.cn"))
        assertFalse(AppConfig.isTrusted("https://cputime.cn:8443/home"))
        assertTrue(AppConfig.isPayment("https://pay.kaipay.cn/order"))
        assertFalse(AppConfig.isPayment("https://cputime.cn/pay"))
    }

    @Test
    fun routeUrlsStayOnTheOrigin() {
        assertEquals("https://cputime.cn/jwxt?reauthorize=1", AppConfig.routeUrl("/jwxt?reauthorize=1"))
        assertNull(AppConfig.routeUrl("//evil.example/home"))
        assertNull(AppConfig.routeUrl("https://evil.example"))
        assertNull(AppConfig.routeUrl("/home\nx"))
        assertEquals("/forum/topic/9?from=%2Fhome#reply", AppConfig.pathOf("https://cputime.cn/forum/topic/9?from=%2Fhome#reply"))
        assertNull(AppConfig.pathOf("https://evil.example/home"))
    }

    @Test
    fun userAgentKeepsTheExistingAndroidTokensAndAddsTheNativeShell() {
        val suffix = AppConfig.userAgentSuffix(39, "4.0.0")
        assertTrue(suffix.contains("CPUWebScheduleApp/39"))
        assertTrue(suffix.contains("CPUWebScheduleAppVersion/4.0.0"))
        assertTrue(suffix.contains("CPUTimeNative/1"))
        assertTrue(suffix.contains("CPUWebNextApp/39"))
    }

    @Test
    fun tabsFollowTheIosMapping() {
        assertTrue(ShellRoutes.isSchedulePath("/schedule?refresh=1"))
        assertEquals("home", DestinationCatalog.legacySection("/forum/topic/3"))
        assertEquals("academic", DestinationCatalog.legacySection("/jwxt/grades"))
        assertEquals("services", DestinationCatalog.legacySection("/services/tools/filestore"))
        assertEquals("profile", DestinationCatalog.legacySection("/messages?tab=private"))
        assertNull(DestinationCatalog.legacySection("/announcements"))
        assertTrue(ShellRoutes.isAuthPath("/login?redirect=/home"))
        assertTrue(ShellRoutes.isAuthPath("/api/auth/sso-begin"))
        assertFalse(ShellRoutes.isAuthPath("/home"))
        assertTrue(PageChrome.usesPageNavigation("/forum/topic/12?from=/home"))
        assertFalse(PageChrome.usesPageNavigation("/forum"))
    }

    @Test
    fun activityKeepsItsWebViewAcrossConfigurationChanges() {
        val app = RuntimeEnvironment.getApplication()
        val info = app.packageManager.getActivityInfo(ComponentName(app, MainActivity::class.java), 0)
        assertEquals(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE, info.softInputMode and WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST)
        assertEquals(ActivityInfo.LAUNCH_SINGLE_TASK, info.launchMode)
        for (flag in listOf(ActivityInfo.CONFIG_UI_MODE, ActivityInfo.CONFIG_ORIENTATION, ActivityInfo.CONFIG_SCREEN_SIZE, ActivityInfo.CONFIG_FONT_SCALE)) {
            assertTrue(info.configChanges and flag == flag)
        }
    }

    @Test
    fun imagePreviewAcceptsOnlyWebImages() {
        val request = ImagePreviewRequest.parse(
            """{"images":[{"url":"javascript:alert(1)"},{"url":"https://cputime.cn/uploads/a.jpg","title":"封面","fileName":"a/b.jpg"}],"index":5}""",
        )!!
        assertEquals(1, request.images.size)
        assertEquals(0, request.index)
        assertEquals("a_b.jpg", request.images[0].fileName)
        assertNull(ImagePreviewRequest.parse("""{"images":[{"url":"file:///data/x.png"}]}"""))
    }
}
