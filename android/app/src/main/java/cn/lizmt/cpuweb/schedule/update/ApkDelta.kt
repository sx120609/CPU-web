package cn.lizmt.cpuweb.schedule.update

import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.zip.Inflater
import java.util.zip.InflaterInputStream

/**
 * Applies an incremental update (`CPUDLT01`, written by
 * `server/src/services/androidDelta.ts`) to the installed APK.
 *
 * Layout: the magic, a big-endian header length, a JSON header with the sizes
 * and SHA-256 of both APKs, then a raw DEFLATE stream of operations:
 *
 * - `0x01 off len`: copy bytes of the installed APK (unchanged ZIP entries);
 * - `0x02 len bytes`: literal bytes (changed compressed entries, the signing
 *   block and the central directory);
 * - `0x03 oldOff oldLen newLen (add diff… extra extra… seek)*`: a bsdiff-style
 *   difference of one uncompressed entry (DEX, resources.arsc) against the same
 *   entry in the installed APK;
 * - `0x00`: end.
 *
 * Numbers are unsigned LEB128, `seek` is zigzag-encoded. The output must match
 * the published APK byte for byte, so its signature stays valid; the caller
 * still verifies the result like any downloaded APK.
 */
object ApkDelta {
    private val MAGIC = "CPUDLT01".toByteArray(Charsets.US_ASCII)
    private const val MAX_HEADER = 4_096
    private const val CHUNK = 64 * 1024

    data class Header(val fromSize: Long, val fromSha256: String, val toSize: Long, val toSha256: String)

    class DeltaException(message: String) : IOException(message)

    fun readHeader(patch: File): Header = FileInputStream(patch).use { readHeader(DataInputStream(it)) }

    private fun readHeader(input: DataInputStream): Header {
        val magic = ByteArray(MAGIC.size)
        input.readFully(magic)
        if (!magic.contentEquals(MAGIC)) throw DeltaException("不是增量更新包")
        val length = input.readInt()
        if (length <= 0 || length > MAX_HEADER) throw DeltaException("增量更新包头部无效")
        val bytes = ByteArray(length)
        input.readFully(bytes)
        val json = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull() ?: throw DeltaException("增量更新包头部无效")
        val header = Header(
            fromSize = json.optLong("fromSize", -1),
            fromSha256 = json.optString("fromSha256"),
            toSize = json.optLong("toSize", -1),
            toSha256 = json.optString("toSha256"),
        )
        val hex = Regex("^[a-f0-9]{64}$")
        if (header.fromSize <= 0 || header.toSize <= 0 || !hex.matches(header.fromSha256) || !hex.matches(header.toSha256)) {
            throw DeltaException("增量更新包头部无效")
        }
        return header
    }

    /**
     * Rebuilds the new APK at [output] from [old] and [patch]. Throws when the
     * patch does not belong to [old] or the result is not the expected APK;
     * [output] is deleted in that case.
     */
    fun apply(old: File, patch: File, output: File, onProgress: (written: Long, total: Long) -> Unit = { _, _ -> }): Header {
        FileInputStream(patch).use { raw ->
            val data = DataInputStream(raw.buffered())
            val header = readHeader(data)
            if (old.length() != header.fromSize) throw DeltaException("增量包与已安装版本不匹配")
            val inflater = Inflater(true)
            try {
                val ops = DataInputStream(InflaterInputStream(data, inflater, CHUNK))
                RandomAccessFile(old, "r").use { source ->
                    val digest = MessageDigest.getInstance("SHA-256")
                    BufferedOutputStream(FileOutputStream(output), CHUNK).use { sink ->
                        val writer = Writer(sink, digest, header.toSize, onProgress)
                        run(ops, source, header, writer)
                        if (writer.written != header.toSize) throw DeltaException("合成的安装包大小不对")
                    }
                    if (hex(digest.digest()) != header.toSha256) throw DeltaException("合成的安装包校验失败")
                }
            } catch (error: Exception) {
                output.delete()
                throw if (error is DeltaException) error else DeltaException("增量更新包已损坏：${error.message ?: error.javaClass.simpleName}")
            } finally {
                inflater.end()
            }
            return header
        }
    }

    private class Writer(
        private val sink: BufferedOutputStream,
        private val digest: MessageDigest,
        private val total: Long,
        private val onProgress: (Long, Long) -> Unit,
    ) {
        var written = 0L
            private set
        private var reported = 0L

        fun write(buffer: ByteArray, offset: Int, length: Int) {
            if (written + length > total) throw DeltaException("合成的安装包超出预期大小")
            sink.write(buffer, offset, length)
            digest.update(buffer, offset, length)
            written += length
            if (written - reported >= 512 * 1024 || written == total) {
                reported = written
                onProgress(written, total)
            }
        }
    }

    private fun run(ops: DataInputStream, source: RandomAccessFile, header: Header, writer: Writer) {
        val buffer = ByteArray(CHUNK)
        val oldBuffer = ByteArray(CHUNK)
        while (true) {
            when (val op = ops.read()) {
                -1 -> throw DeltaException("增量更新包不完整")
                0x00 -> return
                0x01 -> {
                    val offset = varint(ops)
                    var length = varint(ops)
                    if (offset < 0 || length < 0 || offset + length > header.fromSize) throw DeltaException("增量更新包引用越界")
                    source.seek(offset)
                    while (length > 0) {
                        val count = minOf(length, CHUNK.toLong()).toInt()
                        source.readFully(buffer, 0, count)
                        writer.write(buffer, 0, count)
                        length -= count
                    }
                }
                0x02 -> {
                    var length = varint(ops)
                    if (length < 0 || length > header.toSize) throw DeltaException("增量更新包数据越界")
                    while (length > 0) {
                        val count = minOf(length, CHUNK.toLong()).toInt()
                        ops.readFully(buffer, 0, count)
                        writer.write(buffer, 0, count)
                        length -= count
                    }
                }
                0x03 -> diff(ops, source, header, writer, buffer, oldBuffer)
                else -> throw DeltaException("增量更新包含有未知操作 $op")
            }
        }
    }

    /** One bsdiff-style entry: old bytes outside the entry count as zero, as in bspatch. */
    private fun diff(ops: DataInputStream, source: RandomAccessFile, header: Header, writer: Writer, buffer: ByteArray, oldBuffer: ByteArray) {
        val oldOffset = varint(ops)
        val oldLength = varint(ops)
        val newLength = varint(ops)
        if (oldOffset < 0 || oldLength < 0 || oldOffset + oldLength > header.fromSize || newLength < 0 || newLength > header.toSize) {
            throw DeltaException("增量更新包引用越界")
        }
        var produced = 0L
        var oldPos = 0L
        while (produced < newLength) {
            var add = varint(ops)
            if (add < 0 || produced + add > newLength) throw DeltaException("增量更新包控制数据无效")
            produced += add
            while (add > 0) {
                val count = minOf(add, CHUNK.toLong()).toInt()
                ops.readFully(buffer, 0, count)
                readOld(source, oldOffset, oldLength, oldPos, oldBuffer, count)
                for (index in 0 until count) buffer[index] = (buffer[index] + oldBuffer[index]).toByte()
                writer.write(buffer, 0, count)
                oldPos += count
                add -= count
            }
            var extra = varint(ops)
            if (extra < 0 || produced + extra > newLength) throw DeltaException("增量更新包控制数据无效")
            produced += extra
            while (extra > 0) {
                val count = minOf(extra, CHUNK.toLong()).toInt()
                ops.readFully(buffer, 0, count)
                writer.write(buffer, 0, count)
                extra -= count
            }
            val seek = zigzag(varint(ops))
            oldPos += seek
        }
    }

    /** [count] old bytes from entry position [position], zero outside the entry. */
    private fun readOld(source: RandomAccessFile, entryOffset: Long, entryLength: Long, position: Long, out: ByteArray, count: Int) {
        java.util.Arrays.fill(out, 0, count, 0)
        val start = maxOf(position, 0L)
        val end = minOf(position + count, entryLength)
        if (end <= start) return
        source.seek(entryOffset + start)
        source.readFully(out, (start - position).toInt(), (end - start).toInt())
    }

    private fun varint(input: InputStream): Long {
        var result = 0L
        var shift = 0
        while (true) {
            val byte = input.read()
            if (byte < 0) throw EOFException("增量更新包不完整")
            result = result or ((byte and 0x7F).toLong() shl shift)
            if (byte and 0x80 == 0) return result
            shift += 7
            if (shift > 63) throw DeltaException("增量更新包数字过长")
        }
    }

    private fun zigzag(value: Long): Long = (value ushr 1) xor -(value and 1)

    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 0xFF) }

    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(CHUNK)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return hex(digest.digest())
    }
}
