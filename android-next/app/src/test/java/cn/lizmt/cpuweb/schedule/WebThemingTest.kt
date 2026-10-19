package cn.lizmt.cpuweb.schedule

import cn.lizmt.cpuweb.schedule.custom.CustomPage
import cn.lizmt.cpuweb.schedule.custom.Customization
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WebThemingTest {
    @Test
    fun theSiteKeepsItsOwnLookByDefault() {
        assertEquals("", WebTheming.css(Customization(), null))
    }

    @Test
    fun aChosenAccentRepaintsTheSiteInBothThemes() {
        val css = WebTheming.css(Customization(accent = "#C2337A", corners = 0.5f, pureBlack = true), null)
        assertTrue(css.contains("html[data-cpu-android-native]{--cpu-primary:#"))
        assertTrue(css.contains("html[data-cpu-android-native][data-theme=\"dark\"]{--cpu-primary:#"))
        assertTrue(css.contains("--el-color-primary:"))
        assertTrue(css.contains("--cpu-radius-m:5.0px"))
        assertTrue(css.contains("--cpu-bg:#000"))
        // Turned off, only tweaks and the user's own stylesheet remain.
        assertFalse(WebTheming.css(Customization(accent = "#C2337A", webTheme = false), null).contains("--cpu-primary"))
    }

    @Test
    fun anAccentKeepsReadableContrastOnBothBackgrounds() {
        for (hex in listOf("#FFE14D", "#C2337A", "#1E6FD9", "#4A5866")) {
            val accent = parseHex(hex)!!
            assertTrue(hex, contrast(accentScheme(accent, dark = false).primary, androidx.compose.ui.graphics.Color.White) >= 4.5f)
            assertTrue(hex, contrast(accentScheme(accent, dark = true).primary, androidx.compose.ui.graphics.Color(0xFF111416)) >= 4.5f)
        }
    }

    @Test
    fun tweaksAndCustomCssOnlyApplyWhenOn() {
        val custom = Customization(webTweaks = setOf("hideHot"), customCss = ".x{color:red}", customCssEnabled = false)
        val css = WebTheming.css(custom, null)
        assertTrue(css.contains(".hot-strip{display:none!important}"))
        assertFalse(css.contains(".x{color:red}"))
        assertTrue(WebTheming.css(custom.copy(customCssEnabled = true), null).contains(".x{color:red}"))
    }

    @Test
    fun thePageScriptCarriesTabRootsAndQuotesTheStylesheet() {
        val page = CustomPage("custom:board", "跳蚤", "/forum/b/market?sort=new", "bag")
        val custom = Customization(customPages = listOf(page), tabs = listOf("home", page.id, "schedule"), labels = mapOf("home" to "广场"))
        val script = WebTheming.documentScript("https://cputime.cn", "a{}</style><script>alert(1)</script>", custom)
        assertTrue(script.contains(org.json.JSONArray(listOf("/home", "/forum/b/market")).toString()))
        assertTrue(script.contains(org.json.JSONObject().put("/home", "广场").put("/forum/b/market", "跳蚤").toString()))
        assertFalse(script.contains("</script>"))
        assertTrue(script.startsWith("(function(o,c,r,t){if(location.origin!==o)return;"))
    }
}
