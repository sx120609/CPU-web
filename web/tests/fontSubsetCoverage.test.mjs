import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { brotliDecompressSync } from 'node:zlib'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fontRoot = path.join(webRoot, 'src/assets/fonts')
const SOURCE_EXTENSIONS = new Set(['.vue', '.ts', '.scss', '.css'])
// Inter 排在字体栈首位；只有它缺字的 CJK 汉字、CJK 标点与全角符号才会由 HarmonyOS Sans SC 渲染。
const CHECKED_RANGES = [[0x3000, 0x303f], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xff00, 0xffef]]

// WOFF2 规范中的已知表标签（索引 0-62）；63 表示后面紧跟 4 字节的自定义标签。
const WOFF2_KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
  'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE',
  'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt',
  'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar',
  'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
]

function readUIntBase128(buffer, cursor) {
  let value = 0
  for (let index = 0; index < 5; index += 1) {
    const byte = buffer[cursor.offset++]
    value = value * 128 + (byte & 0x7f)
    if (!(byte & 0x80)) return value
  }
  throw new Error('invalid UIntBase128')
}

/** 返回 WOFF2 字体 cmap 中映射到非 .notdef 字形的码位集合（cmap 在 WOFF2 中从不做变换）。 */
function readWoff2CodePoints(file) {
  const buffer = readFileSync(file)
  assert.equal(buffer.toString('latin1', 0, 4), 'wOF2', `${file} is not a WOFF2 font`)
  assert.notEqual(buffer.toString('latin1', 4, 8), 'ttcf', `${file}: font collections are not supported`)
  const numTables = buffer.readUInt16BE(12)
  const totalCompressedSize = buffer.readUInt32BE(20)
  const cursor = { offset: 48 }
  const tables = []
  for (let index = 0; index < numTables; index += 1) {
    const flags = buffer[cursor.offset++]
    let tag = WOFF2_KNOWN_TAGS[flags & 0x3f]
    if ((flags & 0x3f) === 63) {
      tag = buffer.toString('latin1', cursor.offset, cursor.offset + 4)
      cursor.offset += 4
    }
    const transformVersion = flags >> 6
    const origLength = readUIntBase128(buffer, cursor)
    // glyf/loca 的版本 0 表示已变换；其他表只有非 0 版本才带 transformLength。
    const transformed = tag === 'glyf' || tag === 'loca' ? transformVersion === 0 : transformVersion !== 0
    tables.push({ tag, length: transformed ? readUIntBase128(buffer, cursor) : origLength, transformed })
  }
  const stream = brotliDecompressSync(buffer.subarray(cursor.offset, cursor.offset + totalCompressedSize))
  let offset = 0
  for (const table of tables) {
    if (table.tag === 'cmap') {
      assert.equal(table.transformed, false)
      return readCmapCodePoints(stream.subarray(offset, offset + table.length))
    }
    offset += table.length
  }
  throw new Error(`${file} has no cmap table`)
}

function readCmapCodePoints(cmap) {
  const codePoints = new Set()
  const numTables = cmap.readUInt16BE(2)
  for (let index = 0; index < numTables; index += 1) {
    const record = 4 + index * 8
    const platformId = cmap.readUInt16BE(record)
    const encodingId = cmap.readUInt16BE(record + 2)
    if (platformId !== 0 && !(platformId === 3 && (encodingId === 1 || encodingId === 10))) continue
    const subtable = cmap.readUInt32BE(record + 4)
    const format = cmap.readUInt16BE(subtable)
    if (format === 4) readFormat4(cmap, subtable, codePoints)
    else if (format === 12) readFormat12(cmap, subtable, codePoints)
  }
  return codePoints
}

function readFormat4(cmap, subtable, codePoints) {
  const segCount = cmap.readUInt16BE(subtable + 6) / 2
  const endCodes = subtable + 14
  const startCodes = endCodes + segCount * 2 + 2
  const idDeltas = startCodes + segCount * 2
  const idRangeOffsets = idDeltas + segCount * 2
  for (let segment = 0; segment < segCount; segment += 1) {
    const start = cmap.readUInt16BE(startCodes + segment * 2)
    const end = cmap.readUInt16BE(endCodes + segment * 2)
    const delta = cmap.readInt16BE(idDeltas + segment * 2)
    const rangeOffsetAt = idRangeOffsets + segment * 2
    const rangeOffset = cmap.readUInt16BE(rangeOffsetAt)
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      let glyph = (code + delta) & 0xffff
      if (rangeOffset !== 0) {
        glyph = cmap.readUInt16BE(rangeOffsetAt + rangeOffset + (code - start) * 2)
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff
      }
      if (glyph !== 0) codePoints.add(code)
    }
  }
}

function readFormat12(cmap, subtable, codePoints) {
  const groups = cmap.readUInt32BE(subtable + 12)
  for (let group = 0; group < groups; group += 1) {
    const record = subtable + 16 + group * 12
    const start = cmap.readUInt32BE(record)
    const end = cmap.readUInt32BE(record + 4)
    const startGlyph = cmap.readUInt32BE(record + 8)
    for (let code = start; code <= end; code += 1) {
      if (startGlyph + code - start !== 0) codePoints.add(code)
    }
  }
}

/** 去掉注释但保留字符串内容；注释里的文字不会显示，不要求字体子集覆盖。 */
function stripComments(source, { lineComments }) {
  let output = ''
  let quote = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (quote) {
      output += char
      if (char === '\\') output += source[++index] ?? ''
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      output += char
    } else if (lineComments && char === '/' && next === '/') {
      const end = source.indexOf('\n', index)
      index = end < 0 ? source.length : end - 1
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 1
    } else {
      output += char
    }
  }
  return output
}

function stripVueComments(source) {
  let output = ''
  let last = 0
  for (const match of source.matchAll(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gu)) {
    output += source.slice(last, match.index).replace(/<!--[\s\S]*?-->/gu, '')
    const [, tag, attrs, body] = match
    output += stripComments(body, { lineComments: tag === 'script' || /\blang=["']s[ac]ss["']/u.test(attrs) })
    last = match.index + match[0].length
  }
  return output + source.slice(last).replace(/<!--[\s\S]*?-->/gu, '')
}

function visibleSourceText(file) {
  const source = readFileSync(file, 'utf8')
  const extension = path.extname(file)
  if (extension === '.vue') return stripVueComments(source)
  return stripComments(source, { lineComments: extension !== '.css' })
}

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : []
  })
}

// 与 tools/subset-harmony-fonts.py 的扫描范围保持一致：网页也会打包这些共享模块里的文字。
const SOURCE_DIRECTORIES = [
  path.join(webRoot, 'src'),
  path.join(webRoot, '../shared'),
  path.join(webRoot, '../server/src/shared'),
]

function collectUsedCharacters() {
  const used = new Map()
  for (const file of SOURCE_DIRECTORIES.flatMap(listSourceFiles)) {
    for (const char of visibleSourceText(file)) {
      const codePoint = char.codePointAt(0)
      if (!used.has(codePoint) && CHECKED_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high)) {
        used.set(codePoint, path.relative(webRoot, file).split(path.sep).join('/'))
      }
    }
  }
  return used
}

// 缺字只会让个别字符回退到系统字体，不应阻塞日常改文案的推送：这里只校验解析正确，
// 缺字以 CI 警告提示，由维护者择机运行 tools/subset-harmony-fonts.py 并提升 vite.config.ts 中的字体目录版本。
test('HarmonyOS Sans SC UI subsets cover every CJK character used by the web bundle', (t) => {
  const used = collectUsedCharacters()
  assert.ok(used.size > 1000, `expected to find the site's CJK text, found ${used.size} characters`)
  assert.equal(used.has('课'.codePointAt(0)), true)
  for (const weight of ['Regular', 'Medium', 'Bold']) {
    const full = readWoff2CodePoints(path.join(fontRoot, `HarmonyOS_Sans_SC_${weight}.woff2`))
    const subset = readWoff2CodePoints(path.join(fontRoot, `HarmonyOS_Sans_SC_${weight}_UI.woff2`))
    assert.ok(full.size > 20000 && subset.has('药'.codePointAt(0)), `${weight}: cmap parsing looks wrong`)
    // 完整字体本身没有的字符只能回退到系统字体，不要求子集包含。
    const missing = [...used].filter(([codePoint]) => full.has(codePoint) && !subset.has(codePoint))
    if (!missing.length) continue
    const summary = `${weight} UI subset is missing ${missing.length} character(s): ${missing
      .slice(0, 20)
      .map(([codePoint, file]) => `${String.fromCodePoint(codePoint)} (${file})`)
      .join(', ')}${missing.length > 20 ? ', …' : ''}. Run tools/subset-harmony-fonts.py and bump the font directory version in vite.config.ts.`
    t.diagnostic(summary)
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=HarmonyOS font subset is stale::${summary}`)
    else console.warn(`[font-subset] ${summary}`)
  }
})
