package cn.lizmt.cpuweb.schedule

import cn.lizmt.cpuweb.schedule.update.ApkDelta
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * The fixture under src/test/resources/delta was written by the server's
 * generator (`server/src/scripts/buildAndroidDelta.ts`): this checks that the
 * app rebuilds exactly what the generator promised.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ApkDeltaTest {
    @get:Rule
    val folder = TemporaryFolder()

    private fun fixture(name: String): File {
        val stream = javaClass.classLoader!!.getResourceAsStream("delta/$name") ?: error("missing fixture $name")
        return folder.newFile(name).apply { outputStream().use { stream.copyTo(it) } }
    }

    @Test
    fun rebuildsTheNewPackageByteForByte() {
        val old = fixture("old.zip")
        val patch = fixture("old-to-new.cpupatch")
        val expected = fixture("new.zip")
        val output = File(folder.root, "rebuilt.zip")
        val header = ApkDelta.apply(old, patch, output)
        assertArrayEquals(expected.readBytes(), output.readBytes())
        assertEquals(expected.length(), header.toSize)
        assertEquals(ApkDelta.sha256(expected), header.toSha256)
        assertEquals(ApkDelta.sha256(old), header.fromSha256)
        assertEquals(header, ApkDelta.readHeader(patch))
    }

    @Test
    fun refusesAPatchForAnotherInstalledVersion() {
        val wrongBase = fixture("new.zip")
        val patch = fixture("old-to-new.cpupatch")
        val output = File(folder.root, "rebuilt.zip")
        assertThrows(ApkDelta.DeltaException::class.java) { ApkDelta.apply(wrongBase, patch, output) }
        assertFalse(output.exists())
    }

    @Test
    fun aDamagedPatchNeverLeavesAPackageBehind() {
        val old = fixture("old.zip")
        val patch = fixture("old-to-new.cpupatch")
        val bytes = patch.readBytes()
        // Damage the compressed operations, then the header.
        val damagedBody = bytes.copyOf().also { it[it.size - 20] = (it[it.size - 20] + 1).toByte() }
        val damagedHeader = bytes.copyOf().also { it[2] = 'X'.code.toByte() }
        for (damaged in listOf(damagedBody, damagedHeader)) {
            val file = File(folder.root, "damaged.cpupatch").apply { writeBytes(damaged) }
            val output = File(folder.root, "rebuilt.zip")
            assertThrows(java.io.IOException::class.java) { ApkDelta.apply(old, file, output) }
            assertFalse(output.exists())
        }
    }
}
