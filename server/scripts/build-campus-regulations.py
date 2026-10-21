"""Build server/assets/knowledge/school-regulations.json from a 规范性文件 snapshot.

Input is the folder produced when the regulation platform
(icusp.cpu.edu.cn/gzzd/client/zdgkfw) is exported: ``metadata.json`` plus one
UTF-8 text file per document in ``<snapshot>/拾间数据库/work/txt`` (pdftotext,
LibreOffice for .doc, OCR for scanned PDFs). Original files are not committed.

    python -I server/scripts/build-campus-regulations.py <snapshot-dir> [out.json]

Cleaning: strips letterheads, page numbers and print-run lines, rejoins lines
broken by PDF layout, drops paragraphs repeated inside one document (the .doc
exports print the cover notice twice) and links cross-document duplicates to
the newest copy. Each chunk is one article (第X条) or a short paragraph group,
labelled with its annex/chapter path so answers can cite 文号 + 条款.
The output uses the school-docs.json shape so schoolDocsKnowledge indexes both
files as one corpus; ``replaces`` lists school-docs documents that are copies
of a regulation found here.

Status is derived from the documents themselves rather than the platform's
fileStatus, which marks every record 有效: explicit 废止/停止执行 clauses,
"仍按《…》执行" transition clauses, and same-title older versions.
"""
import hashlib, json, pathlib, re, sys
from collections import defaultdict

SNAPSHOT_AT = "2026-10-22"
CN = "零一二三四五六七八九十百"
ARTICLE = re.compile(rf"^第[{CN}]+条")
CHAPTER = re.compile(rf"^第[{CN}]+章")
STRUCT = re.compile(rf"^(第[{CN}]+[章节条]|[{CN}]+、|[（(][{CN}]+[）)]|\d+[.．、]|附件\s*\d*|附\s*则)")
ANNEX = re.compile(r"^附件\s*(\d+)?\s*[:：]?\s*$")
TITLE_WORD = re.compile(r"(办法|规定|细则|条例|章程|规则|制度|方案|意见|标准|规程|守则|准则|要求|实施)(（试行）|\(试行\))?$")
DOCNO = re.compile(r"[一-鿿]{1,10}\s*[〔\[［(（]\s*(\d{4})\s*[〕\]］)）]\s*(?:第\s*)?(\d+)\s*号")
DATE = re.compile(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")
DROP = [
    re.compile(r"^[-－—–\s]*\d{1,3}[-－—–\s]*$"),
    re.compile(r"^(中共)?中国药科大学(委员会)?(文件|纪要)$"),
    re.compile(r"^[─━—\-_=]{4,}$"),
    re.compile(r"^[（(]此页无正文[)）]$"),
    re.compile(r"^.{0,30}\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*印发$"),
    re.compile(r"^抄送[:：]"),
]
CJK_PUNCT = "一-鿿，。、；：（）《》“”〔〕"


def norm_docno(value: str) -> str:
    m = DOCNO.search(value or "")
    if not m:
        return re.sub(r"\s", "", value or "")
    prefix = re.sub(r"\s", "", value[: m.start(1)]).rstrip("〔[［(（")
    return f"{prefix}〔{m.group(1)}〕{int(m.group(2))}号"


def key(text: str) -> str:
    return re.sub(r"[^一-鿿A-Za-z0-9]", "", text)


def paragraphs(raw: str) -> list[str]:
    lines = [l.strip() for l in raw.replace("﻿", "").replace("\r", "").replace("\f", "\n").split("\n")]
    paras, cur = [], ""
    for line in lines:
        line = re.sub(r"\s*[-－—–]\s*\d{1,3}\s*[-－—–]\s*$", "", line)  # trailing page number
        if any(p.match(line) for p in DROP):
            continue
        if not line:
            if cur:
                paras.append(cur); cur = ""
            continue
        if cur and (STRUCT.match(line) or re.search(r"[。！？；]$", cur) or ANNEX.match(cur) or ANNEX.match(line)):
            paras.append(cur); cur = line
        else:
            cur = cur + line if cur else line
    if cur:
        paras.append(cur)
    # A page break leaves an empty line in the middle of a sentence
    # (“仍按照《…全日制本 / 科学士学位…》（…79 号）执行”); rejoin such halves.
    joined = []
    for p in paras:
        prev = joined[-1] if joined else ""
        if (len(prev) > 25 and not re.search(r"[。！？；：:）)」”]$", prev) and not is_title(prev)
                and not STRUCT.match(p) and not ANNEX.match(p) and not is_title(p)):
            joined[-1] = prev + p
        else:
            joined.append(p)
    paras = joined
    # PDF layout can glue the next article or a chapter heading onto the
    # previous line; split only after a sentence end or a bare chapter heading
    # so in-text references such as “依据第五条” stay intact.
    split = []
    for p in paras:
        p = re.sub(rf"(?<=[。；！？])\s*(?=第[{CN}]+[章条])", "\n", p)
        p = re.sub(rf"^(第[{CN}]+章[^。；，\n]{{0,30}}?)\s*(?=第[{CN}]+条)", r"\1\n", p)
        split.extend(x for x in p.split("\n") if x.strip())
    out, seen = [], set()
    for p in split:
        p = re.sub(rf"(?<=[{CJK_PUNCT}])\s+(?=[{CJK_PUNCT}])", "", p)
        p = re.sub(r"\s{2,}", " ", p).strip()
        k = key(p)
        if not k:
            continue
        # In-document dedupe: .doc exports repeat the cover notice verbatim.
        if len(k) >= 8 and k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out


def is_title(p: str) -> bool:
    return (len(p) <= 48 and "。" not in p and "，" not in p and not CHAPTER.match(p)
            and not STRUCT.match(p) and bool(TITLE_WORD.search(p.replace(" ", ""))))


SECTION = re.compile(rf"^([{CN}]+、|[（(][{CN}]+[）)])[^。；]{{1,30}}$")


def chunk_document(doc_id: str, title: str, paras: list[str]) -> list[dict]:
    chunks, cur, path = [], None, {"annex": "", "title": "", "chapter": ""}

    def label(article: str = "") -> str:
        parts = [x for x in (path["annex"] + (" " if path["annex"] and path["title"] else "") + path["title"], path["chapter"], article) if x]
        return " › ".join(parts) or "正文"

    def flush():
        nonlocal cur
        if cur and key(cur["text"]):
            text = cur["text"]
            while len(text) > 1200:  # long articles split on sentence boundaries
                cut = max(text.rfind("。", 0, 1100), text.rfind("；", 0, 1100))
                cut = cut + 1 if cut > 300 else 1100
                chunks.append({**cur, "text": text[:cut]})
                text = text[cut:]; cur = {**cur, "path": cur["path"] + "（续）"}
            chunks.append({**cur, "text": text})
        cur = None

    seen_article = False
    for p in paras:
        annex = ANNEX.match(p)
        if annex:
            flush(); path.update(annex=f"附件{annex.group(1) or ''}", title="", chapter=""); continue
        if CHAPTER.match(p) and len(p) <= 40:
            flush(); path["chapter"] = re.sub(r"\s+", " ", p); continue
        if is_title(p) and not ARTICLE.match(p):
            flush(); path.update(title=p, chapter=""); continue
        m = ARTICLE.match(p)
        if m:
            flush(); seen_article = True
            cur = {"path": label(m.group(0)), "text": p}; continue
        if not seen_article and SECTION.match(p):
            # Documents without 第X条 use 一、/（一） headings as their outline.
            flush(); path["chapter"] = p; continue
        if cur is None or (not seen_article and len(cur["text"]) > 700):
            flush()
            notice = not chunks and not path["title"] and not path["chapter"] and re.search(r"印发|通知|各.{0,8}(单位|部门|学院)", p)
            cur = {"path": label("印发通知" if notice else ""), "text": p}
        else:
            cur["text"] += "\n" + p
    flush()
    for i, c in enumerate(chunks, 1):
        c["id"] = f"{doc_id}-{i}"
        c["doc"] = doc_id
    return [{"id": c["id"], "doc": c["doc"], "path": c["path"], "text": c["text"]} for c in chunks]


# Clauses that decide who an article applies to or which document wins:
# scope, precedence, deferral to another document, transition, reference.
SCOPE_CLAUSE = re.compile(
    r"本(?:实施)?(?:办法|规定|细则|条例|规则|意见|方案|标准|准则|章程|守则|规程)[^。；]{0,12}适用于"
    r"|以本(?:实施)?(?:办法|规定|细则)为准|不一致的?[^。；]{0,12}以[^。；]{0,12}为准"
    r"|由(?:对应|相关|各)[^。；]{0,20}(?:文件|办法|细则|规定|通知)[^。；]{0,10}(?:规定|执行|确定)"
    r"|另行(?:规定|制定|发文|通知)|参照[^。；]{1,40}执行|仍按")


def scope_clauses(body: str, effective: str, limit: int = 3) -> list[str]:
    found = []
    for s in sentences(body):
        s = re.sub(r"\s+", "", s).strip("；")
        if not SCOPE_CLAUSE.search(s) or len(s) > 220 or s in found or s in re.sub(r"\s+", "", effective):
            continue
        found.append(s)
        if len(found) >= limit:
            break
    return found


def sentences(text: str):
    return [s for s in re.split(r"(?<=[。；\n])", text) if s.strip()]



def main(snapshot: pathlib.Path, out: pathlib.Path, school_docs_path: pathlib.Path):
    meta = json.loads((snapshot / "metadata.json").read_text(encoding="utf-8"))
    txt_dir = snapshot / "拾间数据库" / "work" / "txt"
    scanned = {"098", "273", "281", "282", "283", "284", "285"}

    docs, chunks = [], []
    for index, m in enumerate(meta, 1):
        seq = f"{index:03d}"
        doc_id = f"R{seq}"
        local = m.get("localFile") or ""
        txt = txt_dir / (pathlib.Path(local).stem + ".txt") if local else None
        raw = txt.read_text(encoding="utf-8", errors="ignore") if txt and txt.exists() else ""
        paras = paragraphs(raw)
        doc_chunks = chunk_document(doc_id, m["name"], paras)
        body = "\n".join(paras)
        dates = [f"{int(y):04d}-{int(mo):02d}-{int(d):02d}" for y, mo, d in DATE.findall(body[:1500])]
        signed = next((d for d in dates if d[:4] == (DOCNO.search(m.get("docNo") or "") or [None, ""])[1]), None) \
            or (m.get("draftDate") or "")[:10] or None
        interpret = next((re.sub(r"^(本\S{0,4}?)", "", x).strip() for x in re.findall(r"由([^，。；]{2,30}?)负责解释", body)), "")
        effective = next((s for s in re.findall(r"[^。；\n]*自[^。；\n]{0,40}起[^。；\n]{0,30}(?:施行|执行|实施)[^。；\n]*[。；]?", body)
                          if re.search(r"本(办法|规定|细则|条例|规则|意见|制度|方案|标准|准则|章程|守则|规程)|[发公印下]\S?布?之日|学期|学年|\d{4}\s*年", s)), "")
        docs.append({
            "id": doc_id,
            "docNo": norm_docno(m.get("docNo") or ""),
            "title": m["name"],
            "level": m.get("ruleLevel_name") or "",
            "category": m.get("categoryId_name") or "",
            "publishDept": (m.get("publishDeptId_name") or "").split(" / ")[-1],
            "signedDate": signed,
            "platformPublishedAt": (m.get("publishDate") or "")[:10] or None,
            "publishType": m.get("publishType_name") or "",
            "interpretDept": interpret,
            "effectiveNote": effective[:160],
            "scopeNotes": scope_clauses(body, effective),
            "ocr": seq in scanned,
            "missing": not doc_chunks,
            "fileName": pathlib.Path(local).name if local else "",
            "_body": body,
        })
        chunks.extend(doc_chunks)

    # Supersession derived from the documents' own clauses.
    by_no = {d["docNo"]: d for d in docs}
    by_id = {d["id"]: d for d in docs}
    by_title = defaultdict(list)
    for d in docs:
        by_title[key(d["title"])].append(d)
    rel = defaultdict(lambda: {"supersededBy": [], "partial": [], "supersedes": [], "versions": []})
    for d in docs:
        for s in sentences(d.pop("_body")):
            if not re.search(r"废止|停止执行|不再执行|同时作废|仍按|继续执行", s):
                continue
            targets = {by_no[n]["id"] for n in (norm_docno(x.group(0)) for x in DOCNO.finditer(s)) if n in by_no}
            for t in re.findall(r"《([^》]{4,60})》", s):
                for cand in by_title.get(key(t), []):
                    if cand is not d and (cand["signedDate"] or "") < (d["signedDate"] or "9"):
                        targets.add(cand["id"])
            for t in (by_id[i] for i in targets):
                if t is d:
                    continue
                note = re.sub(r"\s+", "", s)[:200]
                # "本办法从2025级开始执行，原《…》同时废止" repeals for new cohorts only;
                # earlier cohorts may still be under the old document.
                kind = "partial" if re.search(r"仍按|继续执行|\d{4}\s*级", s) else "supersededBy"
                rel[t["id"]][kind].append({"doc": d["id"], "docNo": d["docNo"], "note": note})
                rel[d["id"]]["supersedes"].append({"doc": t["id"], "docNo": t["docNo"], "note": note})
    for group in by_title.values():
        if len(group) < 2:
            continue
        group.sort(key=lambda x: x["signedDate"] or "")
        newest = group[-1]
        for older in group[:-1]:
            rel[older["id"]]["versions"].append({"doc": newest["id"], "docNo": newest["docNo"], "note": f"存在同名较新版本 {newest['docNo']}（{newest['signedDate']}）"})
    for d in docs:
        r = rel[d["id"]]
        d.update({k: v for k, v in r.items() if v})
        if r["partial"]:
            d["status"] = "部分适用"
        elif r["supersededBy"]:
            d["status"] = "已废止"
        elif r["versions"]:
            d["status"] = "可能已被新版替代"
        elif d["missing"]:
            d["status"] = "原文缺失"
        else:
            d["status"] = "现行"

    # Cross-document duplicates: identical normalised article text keeps the newest copy.
    order = {d["id"]: d["signedDate"] or "" for d in docs}
    first = {}
    for c in sorted(chunks, key=lambda c: order[c["doc"]], reverse=True):
        k = key(c["text"])
        if len(k) < 60:
            continue
        h = hashlib.md5(k.encode()).hexdigest()
        if h in first and first[h]["doc"] != c["doc"]:
            c["dupOf"] = first[h]["id"]
        else:
            first.setdefault(h, c)

    # The school-docs bundle already carries some of these regulations (e.g. the
    # 综合素质测评办法 PDF). The red-header original with 文号 and status wins;
    # schoolDocsKnowledge drops the listed school-docs documents at load time.
    replaces = {}
    if school_docs_path.exists():
        existing = json.loads(school_docs_path.read_text(encoding="utf-8"))["documents"]
        for d in docs:
            if d["missing"]:
                continue
            for s in existing:
                if (d["docNo"] and d["docNo"] in norm_docno(s["title"])) or key(s["title"]) == key(d["title"]):
                    replaces[s["id"]] = d["id"]

    def note_for(d: dict) -> str:
        parts = []
        if d["status"] == "部分适用":
            parts.append("部分适用：" + "；".join(f"{x['docNo']}规定{x['note']}" for x in d["partial"]))
        elif d["status"] == "已废止":
            parts.append("已废止：" + "；".join(f"{x['docNo']}：{x['note']}" for x in d["supersededBy"]))
        elif d["status"] == "可能已被新版替代":
            parts.append("；".join(x["note"] for x in d["versions"]) + "，请先核对新版")
        if d.get("supersedes"):
            parts.append("本文件替代或调整了：" + "、".join(sorted({x["docNo"] for x in d["supersedes"]})))
        if d["effectiveNote"]:
            parts.append("施行：" + d["effectiveNote"])
        if d["scopeNotes"]:
            parts.append("适用与衔接：" + " ".join(d["scopeNotes"]))
        if d["interpretDept"]:
            parts.append("解释部门：" + d["interpretDept"])
        if d["ocr"]:
            parts.append("扫描件识别文字，个别字可能有误")
        return "。".join(p.rstrip("。") for p in parts)[:700]

    kept = [d for d in docs if not d["missing"]]
    index_of = {d["id"]: i for i, d in enumerate(kept)}
    personal = re.compile(r"(?<!\d)20[0-3]\d{7,8}(?!\d)|(?<!\d)\d{15}(?!\d)|(?<!\d)\d{17}[\dXx](?![\dXx])")
    out_chunks = []
    # One searchable status passage per document, so “还有效吗”“我这届按哪版” finds the
    # applicability note instead of only the articles.
    for d in kept:
        note = note_for(d)
        if note and (d["status"] != "现行" or d.get("supersedes")):
            out_chunks.append({"d": index_of[d["id"]], "h": "文件状态与适用范围",
                               "t": f"《{d['title']}》（{d['docNo']}，{d['signedDate'] or '日期不详'}）：{note}"})
    for c in chunks:
        if "dupOf" in c or c["doc"] not in index_of:
            continue
        text = "\n".join(line for line in c["text"].split("\n") if not personal.search(line))
        if len(key(text)) >= 12:
            out_chunks.append({"d": index_of[c["doc"]], "h": c["path"], "t": text})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "version": 1,
        "source": f"中国药科大学规范性文件数智化管理平台·制度公开_{SNAPSHOT_AT}",
        "statusMethod": "status/note 由文件自身的废止、过渡条款及同名新版推断；平台的“有效”标记对全部文件相同，不作依据。",
        "replaces": replaces,
        "documents": [{
            "id": d["id"],
            "title": d["title"],
            "category": "规章制度 · " + " / ".join(x for x in (d["level"], d["category"].split(" / ")[-1]) if x),
            "status": "historical" if d["status"] == "已废止" else "current",
            "date": d["signedDate"],
            "sourceUrl": PLATFORM_URL,
            "extracted": "ocr" if d["ocr"] else "pdf",
            "docNo": d["docNo"],
            "note": note_for(d),
            # Documents this one replaces, defers to or is replaced by; search attaches
            # their best-matching article (e.g. 119号 → 79号's English requirement).
            "links": sorted({x["doc"] for k in ("supersedes", "supersededBy", "partial", "versions")
                             for x in d.get(k, []) if x["doc"] in index_of}),
        } for d in kept],
        "chunks": out_chunks,
    }, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for d in docs:
        if d["status"] != "现行":
            print(d["id"], d["docNo"], d["title"][:30], d["status"], file=sys.stderr)
    print(f"{len(kept)} 份文件、{len(out_chunks)} 段、{sum(len(c['t']) for c in out_chunks)} 字；"
          f"跳过原文缺失 {len(docs) - len(kept)} 份、跨文件重复段 {sum(1 for c in chunks if 'dupOf' in c)} 段；"
          f"替代 school-docs 中的 {len(replaces)} 份：{replaces}", file=sys.stderr)


PLATFORM_URL = "https://icusp.cpu.edu.cn/gzzd/client/zdgkfw#/systemconfig_rulepublic"

if __name__ == "__main__":
    root = pathlib.Path(__file__).resolve().parents[1]
    main(pathlib.Path(sys.argv[1]),
         pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else root / "assets" / "knowledge" / "school-regulations.json",
         root / "assets" / "knowledge" / "school-docs.json")
