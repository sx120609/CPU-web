package cn.lizmt.cpuweb.schedule

import cn.lizmt.cpuweb.schedule.update.ReleaseParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The official app's updater reads the site's `/api/site/downloads/android` answer. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ApkReleaseParserTest {
    private val origin = "https://cputime.cn"
    private val sha = "74933de47da50ef103e2950f1eee74ddbaf3abcd1d7172db4cf83117a8aba519"

    private fun body(versionCode: Int = 62, fileName: String = "CPU-Web-Android-V$versionCode.apk", patch: String = "null") = """
        {"code":0,"data":{"schemaVersion":1,"versionCode":$versionCode,"versionName":"4.0.21","packageName":"cn.lizmt.cpuweb",
        "fileName":"$fileName","size":8185687,"sha256":"$sha","downloadUrl":"/api/site/downloads/android-app",
        "notes":["增量更新"],"patch":$patch,"next":null,"updateRequirement":null},"message":""}
    """.trimIndent()

    @Test
    fun readsTheReleaseAndTheOnePatchForTheInstalledVersion() {
        val patch = """{"fromVersionCode":61,"fromSha256":"$sha","fileName":"CPU-Web-Android-V61-V62.cpupatch","size":4321,"sha256":"$sha",
            "url":"/api/site/downloads/android-patch?from=61"}"""
        val release = ReleaseParser.parse(body(patch = patch), origin, "cn.lizmt.cpuweb", installedVersion = 61)!!
        assertEquals(62, release.versionCode)
        assertEquals("https://cputime.cn/api/site/downloads/android-app", release.downloadUrl)
        assertEquals(listOf("增量更新"), release.notes)
        assertEquals("https://cputime.cn/api/site/downloads/android-patch?from=61", release.patch!!.url)
        // A patch for another installed version is ignored; the full package remains.
        assertNull(ReleaseParser.parse(body(patch = patch), origin, "cn.lizmt.cpuweb", installedVersion = 60)!!.patch)
    }

    @Test
    fun theLiveAnswerOfAnOlderServerStillParses() {
        // What the site returned on 2026-10-28, before it knew about patches and notes.
        val live = """{"code":0,"data":{"schemaVersion":1,"versionCode":61,"versionName":"4.0.20","packageName":"cn.lizmt.cpuweb",
            "fileName":"CPU-Web-Android-V61.apk","size":12601806,"sha256":"$sha",
            "certificateSha256":"c18b7adc4fc870f75fe3c6c33d643fa4233af54c254c96edf48fcca6743df744",
            "downloadUrl":"/api/site/downloads/android-app","next":null,"serverTime":"2026-10-28T07:45:49.848Z"},"message":""}"""
        val release = ReleaseParser.parse(live, origin, "cn.lizmt.cpuweb", installedVersion = 61)!!
        assertEquals(61, release.versionCode)
        assertNull(release.patch)
        assertEquals(emptyList<String>(), release.notes)
    }

    @Test
    fun rejectsAnotherAppsRelease() {
        assertNull(ReleaseParser.parse(body(fileName = "CPU-Web-Android-NEXT-V62.apk"), origin, "cn.lizmt.cpuweb", 61))
        assertNull(ReleaseParser.parse(body(), origin, "cn.lizmt.cpuweb.next", 61))
    }
}
