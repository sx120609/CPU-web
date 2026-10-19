package cn.lizmt.cpuweb.schedule

import cn.lizmt.cpuweb.schedule.custom.CustomPage
import cn.lizmt.cpuweb.schedule.custom.Customization
import cn.lizmt.cpuweb.schedule.custom.CustomizationCodec
import cn.lizmt.cpuweb.schedule.custom.CustomizationStore
import cn.lizmt.cpuweb.schedule.custom.DashboardCard
import cn.lizmt.cpuweb.schedule.custom.DestinationCatalog
import cn.lizmt.cpuweb.schedule.custom.DestinationKind
import cn.lizmt.cpuweb.schedule.custom.LAYOUT_PRESETS
import cn.lizmt.cpuweb.schedule.custom.TabBarStyle
import cn.lizmt.cpuweb.schedule.update.ReleaseParser
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CustomizationTest {
    private fun normalize(value: Customization) = CustomizationStore.normalize(value)

    @Test
    fun theDefaultLayoutIsTheFamiliarOne() {
        val value = Customization()
        assertEquals(listOf("home", "academic", "schedule", "services", "profile"), value.tabs)
        assertEquals("schedule", value.launchTab)
        assertEquals(value, normalize(value))
        assertEquals(listOf("/home", "/jwxt", "/services", "/profile"), value.webTabRoots)
    }

    @Test
    fun tabsStayWithinTheirLimitsAndOnlyHoldTabPages() {
        val tooFew = normalize(Customization(tabs = listOf("post", "nowhere"), launchTab = "post"))
        assertEquals(listOf("schedule", "home"), tooFew.tabs)
        assertEquals("schedule", tooFew.launchTab)
        val tooMany = normalize(Customization(tabs = listOf("home", "forum", "market", "ai", "messages", "profile", "schedule", "academic")))
        assertEquals(6, tooMany.tabs.size)
        val duplicates = normalize(Customization(tabs = listOf("home", "home", "profile"), launchTab = "dashboard"))
        assertEquals(listOf("home", "profile"), duplicates.tabs)
        assertEquals("home", duplicates.launchTab)
    }

    @Test
    fun customPagesBecomeTabsButExternalLinksDoNot() {
        val page = CustomPage("custom:market1", "跳蚤", "/forum/b/market", "bag")
        val link = CustomPage("custom:blog", "博客", "https://example.com/", "globe")
        val value = normalize(Customization(customPages = listOf(page, link), tabs = listOf("home", page.id, link.id, "profile")))
        assertEquals(listOf("home", page.id, "profile"), value.tabs)
        assertEquals(DestinationKind.Web, value.destination(page.id)!!.kind)
        assertEquals(DestinationKind.External, value.destination(link.id)!!.kind)
        assertTrue("/forum/b/market" in value.webTabRoots)
        // Unsafe routes are dropped with the page.
        val unsafe = normalize(Customization(customPages = listOf(CustomPage("custom:x", "x", "//evil.example", "link"))))
        assertTrue(unsafe.customPages.isEmpty())
    }

    @Test
    fun routesAreSitePathsOrHttpsLinks() {
        val origin = "https://cputime.cn"
        assertEquals("/forum/b/market?x=1", CustomizationCodec.normalizeRoute("https://cputime.cn/forum/b/market?x=1", origin, false))
        assertEquals("/jwxt", CustomizationCodec.normalizeRoute(" /jwxt ", origin, false))
        assertNull(CustomizationCodec.normalizeRoute("https://example.com/a", origin, false))
        assertEquals("https://example.com/a", CustomizationCodec.normalizeRoute("https://example.com/a", origin, true))
        assertNull(CustomizationCodec.normalizeRoute("javascript:alert(1)", origin, true))
        assertNull(CustomizationCodec.normalizeRoute("//evil.example", origin, true))
        assertNull(CustomizationCodec.normalizeRoute("/a\nb", origin, true))
    }

    @Test
    fun personalNamesAndIconsApplyEverywhere() {
        val value = normalize(Customization(labels = mapOf("home" to "广场", "ghost" to "x"), icons = mapOf("home" to "rocket", "profile" to "nope")))
        assertEquals("广场", value.destination("home")!!.title)
        assertEquals("rocket", value.destination("home")!!.icon)
        assertEquals(mapOf("home" to "广场"), value.labels)
        assertEquals(mapOf("home" to "rocket"), value.icons)
    }

    @Test
    fun outOfRangeLooksFallBackToSafeValues() {
        val value = normalize(Customization(accent = "#zzzzzz", corners = 9f, fontScale = 0.1f, webTextZoom = 999))
        assertEquals("brand", value.accent)
        assertEquals(1.6f, value.corners)
        assertEquals(0.85f, value.fontScale, 0.001f)
        assertEquals(150, value.webTextZoom)
        assertEquals("#C2337A", normalize(Customization(accent = "#c2337a")).accent)
    }

    @Test
    fun dashboardCardsAreValidated() {
        val value = normalize(Customization(dashboard = Customization().dashboard.copy(cards = listOf(
            DashboardCard("next", "next"),
            DashboardCard("next2", "next"),
            DashboardCard("cd-1", "countdown", title = "考试"),
            DashboardCard("cd-2", "countdown", title = "生日", date = "2026-12-01"),
            DashboardCard("bad id!", "note"),
            DashboardCard("weird", "weather"),
        ))))
        assertEquals(listOf("next", "cd-2"), value.dashboard.cards.map { it.id })
    }

    @Test
    fun shareCodesCarryTheLayoutButNotPrivateText() {
        val mine = normalize(Customization(
            tabs = listOf("dashboard", "schedule", "forum"), launchTab = "dashboard", accent = "#1E6FD9", tabBarStyle = TabBarStyle.Glass,
            dashboard = Customization().dashboard.copy(greetingName = "小明", cards = listOf(DashboardCard("note-1", "note", title = "待办", text = "银行卡密码"))),
        ))
        val code = CustomizationCodec.shareCode(mine)
        assertTrue(code.startsWith("NEXT1-"))
        assertFalse(String(java.util.Base64.getUrlDecoder().decode(code.removePrefix("NEXT1-"))).contains("银行卡"))
        val friend = normalize(Customization(dashboard = Customization().dashboard.copy(greetingName = "小红",
            cards = listOf(DashboardCard("note-1", "note", text = "我的便签")))))
        val imported = CustomizationCodec.fromShareCode("看看我的布局：\n$code\n", keepPrivateFrom = friend)!!
        assertEquals(mine.tabs, imported.tabs)
        assertEquals("#1E6FD9", imported.accent)
        assertEquals(TabBarStyle.Glass, imported.tabBarStyle)
        assertEquals("小红", imported.dashboard.greetingName)
        assertEquals("我的便签", imported.dashboard.cards.single().text)
        assertNull(CustomizationCodec.fromShareCode("NEXT1-not-base64!!", friend))
        assertNull(CustomizationCodec.fromShareCode("hello", friend))
    }

    @Test
    fun presetsProduceValidLayouts() {
        for (preset in LAYOUT_PRESETS) {
            val value = normalize(preset.apply(Customization()))
            assertTrue(preset.id, value.tabs.size in 2..6)
            assertTrue(preset.id, value.launchTab in value.tabs)
        }
    }

    @Test
    fun routeContainmentFollowsWholeSegments() {
        assertTrue(DestinationCatalog.routeContains("/forum", "/forum/topic/3"))
        assertTrue(DestinationCatalog.routeContains("/forum", "/forum?x=1"))
        assertFalse(DestinationCatalog.routeContains("/forum", "/forums"))
        assertFalse(DestinationCatalog.routeContains("/", "/home"))
    }

    @Test
    fun releaseInfoIsReadStrictly() {
        val sha = "a".repeat(64)
        fun body(edit: JSONObject.() -> Unit = {}): String {
            val data = JSONObject()
                .put("packageName", "cn.lizmt.cpuweb.next").put("versionCode", 1002).put("versionName", "1.0.1")
                .put("fileName", "CPU-Web-Android-NEXT-V1002.apk").put("size", 8_000_000).put("sha256", sha)
                .put("notes", org.json.JSONArray(listOf("新的工作台", " ")))
                .put("downloadUrl", "/api/site/downloads/android-next-app")
                .put("patch", JSONObject().put("fromVersionCode", 1001).put("fromSha256", sha).put("size", 140_000).put("sha256", sha)
                    .put("url", "/api/site/downloads/android-next-patch?from=1001"))
            data.edit()
            return JSONObject().put("code", 0).put("data", data).toString()
        }
        val pkg = "cn.lizmt.cpuweb.next"
        val release = ReleaseParser.parse(body(), "https://cputime.cn", pkg, installedVersion = 1001)!!
        assertEquals(1002, release.versionCode)
        assertEquals(listOf("新的工作台"), release.notes)
        assertEquals("https://cputime.cn/api/site/downloads/android-next-app", release.downloadUrl)
        assertNotNull(release.patch)
        // A patch for another installed version is never used.
        assertNull(ReleaseParser.parse(body(), "https://cputime.cn", pkg, installedVersion = 1000)!!.patch)
        // The stable app's manifest never passes for NEXT, and the other way round.
        assertNull(ReleaseParser.parse(body { put("packageName", "cn.lizmt.cpuweb") }, "https://cputime.cn", pkg, 1001))
        assertNull(ReleaseParser.parse(body { put("fileName", "CPU-Web-Android-V1002.apk") }, "https://cputime.cn", pkg, 1001))
        assertNull(ReleaseParser.parse(body { put("downloadUrl", "http://evil.example/x") }, "https://cputime.cn", pkg, 1001))
        assertNull(ReleaseParser.parse(body { put("sha256", "nothex") }, "https://cputime.cn", pkg, 1001))
    }
}
