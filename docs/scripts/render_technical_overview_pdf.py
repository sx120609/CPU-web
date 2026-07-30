#!/usr/bin/env python3
"""Render docs/technical-overview.md as a polished Chinese PDF."""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    HRFlowable,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE = REPO_ROOT / "docs" / "technical-overview.md"
OUTPUT = REPO_ROOT / "output" / "pdf" / "yaoda-shijian-complete-technical-route.pdf"

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN_X = 18 * mm
MARGIN_TOP = 18 * mm
MARGIN_BOTTOM = 17 * mm
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X

INK = colors.HexColor("#172033")
MUTED = colors.HexColor("#65728A")
GREEN = colors.HexColor("#3F8574")
GREEN_DARK = colors.HexColor("#2C665A")
GREEN_LIGHT = colors.HexColor("#EAF4F1")
BLUE_LIGHT = colors.HexColor("#EEF4FA")
AMBER_LIGHT = colors.HexColor("#FFF6E7")
LINE = colors.HexColor("#DCE4EA")
PAPER = colors.HexColor("#FBFCFD")
WHITE = colors.white


def register_fonts() -> None:
    fonts = Path("C:/Windows/Fonts")
    pdfmetrics.registerFont(
        TTFont("YaHei", str(fonts / "msyh.ttc"), subfontIndex=0)
    )
    pdfmetrics.registerFont(
        TTFont("YaHei-Bold", str(fonts / "msyhbd.ttc"), subfontIndex=0)
    )
    pdfmetrics.registerFontFamily(
        "YaHei",
        normal="YaHei",
        bold="YaHei-Bold",
        italic="YaHei",
        boldItalic="YaHei-Bold",
    )


class TechnicalDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        super().__init__(filename, **kwargs)
        frame = Frame(
            MARGIN_X,
            MARGIN_BOTTOM,
            CONTENT_WIDTH,
            PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM,
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
            id="content",
        )
        self.addPageTemplates(
            PageTemplate(id="main", frames=[frame], onPage=self._decorate_page)
        )
        self._bookmark_index = 0

    def beforeDocument(self) -> None:
        self._bookmark_index = 0
        super().beforeDocument()

    def _decorate_page(self, canvas, doc) -> None:
        page = canvas.getPageNumber()
        canvas.saveState()
        canvas.setFillColor(PAPER)
        canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)
        if page > 1:
            canvas.setStrokeColor(LINE)
            canvas.setLineWidth(0.55)
            canvas.line(MARGIN_X, PAGE_HEIGHT - 11 * mm, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 11 * mm)
            canvas.setFont("YaHei", 7.7)
            canvas.setFillColor(MUTED)
            canvas.drawString(MARGIN_X, PAGE_HEIGHT - 8.2 * mm, "药大拾间 · 完整技术路线")
            canvas.drawRightString(
                PAGE_WIDTH - MARGIN_X,
                PAGE_HEIGHT - 8.2 * mm,
                "面向普通用户与项目贡献者",
            )
            canvas.line(MARGIN_X, 11 * mm, PAGE_WIDTH - MARGIN_X, 11 * mm)
            canvas.drawString(MARGIN_X, 7.2 * mm, "基于 2026-07-30 仓库实现")
            canvas.drawRightString(PAGE_WIDTH - MARGIN_X, 7.2 * mm, f"{page - 1}")
        canvas.restoreState()

    def afterFlowable(self, flowable) -> None:
        if not isinstance(flowable, Paragraph):
            return
        level = getattr(flowable.style, "toc_level", None)
        if level is None:
            return
        self._bookmark_index += 1
        key = f"heading-{self._bookmark_index}"
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(flowable.getPlainText(), key, level=level, closed=False)
        self.notify(
            "TOCEntry",
            (level, flowable.getPlainText(), self.page - 1, key),
        )


class SystemDiagram(Flowable):
    """Small vector diagrams replacing Mermaid blocks in the PDF."""

    def __init__(self, kind: str):
        self.kind = kind
        height = {
            "architecture": 71 * mm,
            "request": 43 * mm,
            "deployment": 58 * mm,
        }.get(kind, 42 * mm)
        super().__init__()
        self.width = CONTENT_WIDTH
        self.height = height

    def _box(self, c, x, y, w, h, title, subtitle="", fill=WHITE, stroke=LINE):
        c.setFillColor(fill)
        c.setStrokeColor(stroke)
        c.setLineWidth(0.8)
        c.roundRect(x, y, w, h, 3.2 * mm, stroke=1, fill=1)
        c.setFillColor(INK)
        c.setFont("YaHei-Bold", 8.5)
        c.drawCentredString(x + w / 2, y + h / 2 + (2.5 if subtitle else -2.5), title)
        if subtitle:
            c.setFillColor(MUTED)
            c.setFont("YaHei", 6.6)
            c.drawCentredString(x + w / 2, y + h / 2 - 6.5, subtitle)

    def _arrow(self, c, x1, y1, x2, y2):
        c.setStrokeColor(GREEN)
        c.setFillColor(GREEN)
        c.setLineWidth(1.1)
        c.line(x1, y1, x2, y2)
        angle = 3.2
        if abs(x2 - x1) >= abs(y2 - y1):
            direction = 1 if x2 > x1 else -1
            c.line(x2, y2, x2 - direction * angle, y2 + angle)
            c.line(x2, y2, x2 - direction * angle, y2 - angle)
        else:
            direction = 1 if y2 > y1 else -1
            c.line(x2, y2, x2 + angle, y2 - direction * angle)
            c.line(x2, y2, x2 - angle, y2 - direction * angle)

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(colors.HexColor("#F4F8F7"))
        c.setStrokeColor(colors.HexColor("#BCD9D1"))
        c.roundRect(0, 0, self.width, self.height, 4 * mm, stroke=1, fill=1)

        if self.kind == "architecture":
            w = 43 * mm
            h = 13 * mm
            center_x = self.width / 2 - w / 2
            self._box(c, center_x, 52 * mm, w, h, "用户入口", "Web · 桌面 · 移动", GREEN_LIGHT, GREEN)
            self._box(c, center_x, 31 * mm, w, h, "药大拾间主站", "页面 · API · 权限", WHITE, GREEN)
            left_x = 7 * mm
            right_x = self.width - w - 7 * mm
            self._box(c, left_x, 8 * mm, w, h, "主站数据层", "PostgreSQL · Redis", BLUE_LIGHT)
            self._box(c, center_x, 8 * mm, w, h, "校园网 Agent", "受限教务任务", AMBER_LIGHT)
            self._box(c, right_x, 8 * mm, w, h, "独立与外部能力", "AI · 支付 · QQ · 药苑之声", BLUE_LIGHT)
            self._arrow(c, self.width / 2, 52 * mm, self.width / 2, 44 * mm)
            self._arrow(c, self.width / 2, 31 * mm, left_x + w / 2, 21 * mm)
            self._arrow(c, self.width / 2, 31 * mm, center_x + w / 2, 21 * mm)
            self._arrow(c, self.width / 2, 31 * mm, right_x + w / 2, 21 * mm)

        elif self.kind == "request":
            labels = [
                ("页面", "发起操作"),
                ("主站 API", "校验请求"),
                ("权限与规则", "决定能否执行"),
                ("数据或外部系统", "读取 / 写入"),
                ("页面", "显示结果"),
            ]
            gap = 4 * mm
            w = (self.width - 12 * mm - gap * 4) / 5
            y = 14 * mm
            for i, (title, sub) in enumerate(labels):
                x = 6 * mm + i * (w + gap)
                self._box(c, x, y, w, 16 * mm, title, sub, WHITE, GREEN if i in (0, 4) else LINE)
                if i < len(labels) - 1:
                    self._arrow(c, x + w, y + 8 * mm, x + w + gap - 1, y + 8 * mm)
            c.setFont("YaHei", 7)
            c.setFillColor(MUTED)
            c.drawString(7 * mm, 6 * mm, "外部系统只在确有需要时介入；权限和最终业务结果由服务端决定。")

        elif self.kind == "deployment":
            w = 40 * mm
            h = 14 * mm
            self._box(c, 6 * mm, 34 * mm, w, h, "用户与客户端", "浏览器 · 桌面 · 移动", GREEN_LIGHT, GREEN)
            self._box(c, self.width / 2 - w / 2, 34 * mm, w, h, "HTTPS / 反向代理", "统一对外入口", WHITE, GREEN)
            self._box(c, self.width - w - 6 * mm, 34 * mm, w, h, "主站与药苑之声", "独立 Node 进程", GREEN_LIGHT, GREEN)
            self._box(c, 17 * mm, 9 * mm, w, h, "主站数据", "PostgreSQL · Redis", BLUE_LIGHT)
            self._box(c, self.width / 2 - w / 2, 9 * mm, w, h, "校园网 Agent", "校内独立更新", AMBER_LIGHT)
            self._box(c, self.width - w - 17 * mm, 9 * mm, w, h, "子系统与外部能力", "广播站 · AI · 支付 · 存储", BLUE_LIGHT)
            self._arrow(c, 46 * mm, 41 * mm, self.width / 2 - w / 2, 41 * mm)
            self._arrow(c, self.width / 2 + w / 2, 41 * mm, self.width - w - 6 * mm, 41 * mm)
            self._arrow(c, self.width - 26 * mm, 34 * mm, 37 * mm, 23 * mm)
            self._arrow(c, self.width - 26 * mm, 34 * mm, self.width / 2, 23 * mm)
            self._arrow(c, self.width - 26 * mm, 34 * mm, self.width - 37 * mm, 23 * mm)

        c.restoreState()


def inline_markup(text: str) -> str:
    """Convert the small inline Markdown subset used by this document."""
    placeholders: list[str] = []

    def hold(value: str) -> str:
        placeholders.append(value)
        return f"@@H{len(placeholders) - 1}@@"

    text = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        lambda m: hold(
            f'<link href="{html.escape(m.group(2), quote=True)}" color="#2C665A">'
            f"{html.escape(m.group(1))}</link>"
        ),
        text,
    )
    text = re.sub(
        r"`([^`]+)`",
        lambda m: hold(
            f'<font name="YaHei-Bold" color="#2C665A">{html.escape(m.group(1))}</font>'
        ),
        text,
    )
    escaped = html.escape(text)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", escaped)
    escaped = escaped.replace("  ", " ")
    for idx, value in enumerate(placeholders):
        escaped = escaped.replace(f"@@H{idx}@@", value)
    return escaped


def make_styles():
    base = getSampleStyleSheet()
    styles = {
        "body": ParagraphStyle(
            "BodyCN",
            parent=base["BodyText"],
            fontName="YaHei",
            fontSize=9.2,
            leading=15.2,
            textColor=INK,
            spaceAfter=2.8 * mm,
            wordWrap="CJK",
            allowWidows=0,
            allowOrphans=0,
        ),
        "lead": ParagraphStyle(
            "Lead",
            fontName="YaHei",
            fontSize=10.2,
            leading=17.2,
            textColor=colors.HexColor("#334155"),
            spaceAfter=4 * mm,
            wordWrap="CJK",
        ),
        "section": ParagraphStyle(
            "Section",
            fontName="YaHei-Bold",
            fontSize=17,
            leading=22,
            textColor=GREEN_DARK,
            spaceBefore=6 * mm,
            spaceAfter=3.2 * mm,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "subsection": ParagraphStyle(
            "Subsection",
            fontName="YaHei-Bold",
            fontSize=12.4,
            leading=17,
            textColor=INK,
            spaceBefore=4.2 * mm,
            spaceAfter=2 * mm,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "minor": ParagraphStyle(
            "Minor",
            fontName="YaHei-Bold",
            fontSize=10.2,
            leading=15,
            textColor=GREEN_DARK,
            spaceBefore=3 * mm,
            spaceAfter=1.6 * mm,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            fontName="YaHei",
            fontSize=9,
            leading=14.3,
            textColor=INK,
            leftIndent=5 * mm,
            firstLineIndent=-3.2 * mm,
            spaceAfter=1.2 * mm,
            wordWrap="CJK",
        ),
        "number": ParagraphStyle(
            "Number",
            fontName="YaHei",
            fontSize=9,
            leading=14.3,
            textColor=INK,
            leftIndent=6 * mm,
            firstLineIndent=-4.3 * mm,
            spaceAfter=1.2 * mm,
            wordWrap="CJK",
        ),
        "quote": ParagraphStyle(
            "Quote",
            fontName="YaHei",
            fontSize=9.3,
            leading=15.2,
            textColor=GREEN_DARK,
            leftIndent=5 * mm,
            rightIndent=5 * mm,
            borderColor=colors.HexColor("#B7D8D0"),
            borderWidth=0.7,
            borderPadding=(3 * mm, 4 * mm, 3 * mm, 4 * mm),
            backColor=GREEN_LIGHT,
            spaceBefore=2 * mm,
            spaceAfter=4 * mm,
            wordWrap="CJK",
        ),
        "code": ParagraphStyle(
            "Code",
            fontName="YaHei",
            fontSize=7.5,
            leading=11.8,
            textColor=colors.HexColor("#334155"),
            leftIndent=3.2 * mm,
            rightIndent=3.2 * mm,
            borderColor=LINE,
            borderWidth=0.5,
            borderPadding=3 * mm,
            backColor=colors.HexColor("#F4F6F8"),
            spaceBefore=2 * mm,
            spaceAfter=4 * mm,
        ),
        "caption": ParagraphStyle(
            "Caption",
            fontName="YaHei",
            fontSize=7.4,
            leading=11,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceAfter=3.5 * mm,
        ),
        "toc_title": ParagraphStyle(
            "TOCTitle",
            fontName="YaHei-Bold",
            fontSize=22,
            leading=27,
            textColor=INK,
            spaceAfter=7 * mm,
        ),
    }
    styles["section"].toc_level = 0
    styles["subsection"].toc_level = 1
    return styles


def paragraph_table(rows: list[list[str]], styles) -> Table:
    if not rows:
        return Table([[""]])
    columns = max(len(row) for row in rows)
    normalized = [row + [""] * (columns - len(row)) for row in rows]
    cell_style = ParagraphStyle(
        "TableCell",
        fontName="YaHei",
        fontSize=7.7,
        leading=11.2,
        textColor=INK,
        wordWrap="CJK",
    )
    head_style = ParagraphStyle(
        "TableHead",
        parent=cell_style,
        fontName="YaHei-Bold",
        textColor=WHITE,
    )
    data = []
    for row_idx, row in enumerate(normalized):
        data.append(
            [
                Paragraph(inline_markup(cell), head_style if row_idx == 0 else cell_style)
                for cell in row
            ]
        )
    if columns == 2:
        widths = [CONTENT_WIDTH * 0.27, CONTENT_WIDTH * 0.73]
    elif columns == 3:
        widths = [CONTENT_WIDTH * 0.24, CONTENT_WIDTH * 0.33, CONTENT_WIDTH * 0.43]
    else:
        widths = [CONTENT_WIDTH / columns] * columns
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), GREEN),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.55 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.55 * mm),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F7F9FA")]),
            ]
        )
    )
    return table


def parse_table(lines: list[str], start: int) -> tuple[Table, int]:
    raw: list[str] = []
    idx = start
    while idx < len(lines) and lines[idx].strip().startswith("|"):
        raw.append(lines[idx].strip())
        idx += 1
    rows: list[list[str]] = []
    for line_no, line in enumerate(raw):
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if line_no == 1 and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        rows.append(cells)
    return rows, idx


def cover_story(styles) -> list[Flowable]:
    return [
        Spacer(1, 16 * mm),
        Table(
            [[Paragraph("药大拾间", ParagraphStyle(
                "Brand",
                fontName="YaHei-Bold",
                fontSize=15,
                leading=19,
                textColor=WHITE,
            ))]],
            colWidths=[CONTENT_WIDTH],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), GREEN),
                    ("BOX", (0, 0), (-1, -1), 0, GREEN),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6 * mm),
                    ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
                ]
            ),
        ),
        Spacer(1, 30 * mm),
        Paragraph(
            "完整技术路线",
            ParagraphStyle(
                "CoverTitle",
                fontName="YaHei-Bold",
                fontSize=34,
                leading=42,
                textColor=INK,
                alignment=TA_LEFT,
                wordWrap="CJK",
            ),
        ),
        Spacer(1, 5 * mm),
        Paragraph(
            "从校园社区、教务适配和通用工具，到多端客户端、AI、支付、消息、广播站与部署运维",
            ParagraphStyle(
                "CoverSubtitle",
                fontName="YaHei",
                fontSize=14,
                leading=23,
                textColor=GREEN_DARK,
                wordWrap="CJK",
            ),
        ),
        Spacer(1, 13 * mm),
        HRFlowable(width="32%", thickness=3, color=GREEN, hAlign="LEFT"),
        Spacer(1, 10 * mm),
        Paragraph(
            "这不是框架清单，而是一份解释整个站点如何工作、数据从哪里来、请求怎样流动、各端如何协作的全景文档。",
            styles["lead"],
        ),
        Spacer(1, 18 * mm),
        Table(
            [
                ["适合读者", "普通用户 · 学生开发者 · 项目贡献者"],
                ["实现快照", "2026 年 7 月 30 日"],
                ["项目性质", "学生开发维护 · 非学校官方平台"],
                ["覆盖范围", "主站 · 教务 · Agent · 客户端 · 子系统 · 运维"],
            ],
            colWidths=[33 * mm, CONTENT_WIDTH - 33 * mm],
            style=TableStyle(
                [
                    ("FONTNAME", (0, 0), (0, -1), "YaHei-Bold"),
                    ("FONTNAME", (1, 0), (1, -1), "YaHei"),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("TEXTCOLOR", (0, 0), (0, -1), GREEN_DARK),
                    ("TEXTCOLOR", (1, 0), (1, -1), MUTED),
                    ("LINEBELOW", (0, 0), (-1, -2), 0.45, LINE),
                    ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                ]
            ),
        ),
        Spacer(1, 18 * mm),
        Paragraph(
            "代码仓库  github.com/sx120609/CPU-web",
            ParagraphStyle(
                "CoverLink",
                fontName="YaHei",
                fontSize=8.5,
                textColor=MUTED,
            ),
        ),
        PageBreak(),
    ]


def toc_story(styles) -> list[Flowable]:
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(
            "TOCLevel1",
            fontName="YaHei-Bold",
            fontSize=10,
            leading=15,
            leftIndent=0,
            firstLineIndent=0,
            textColor=INK,
            spaceBefore=2.2 * mm,
        ),
        ParagraphStyle(
            "TOCLevel2",
            fontName="YaHei",
            fontSize=8.1,
            leading=12,
            leftIndent=8 * mm,
            firstLineIndent=0,
            textColor=MUTED,
            spaceBefore=0.6 * mm,
        ),
    ]
    return [
        Spacer(1, 7 * mm),
        Paragraph("目录", styles["toc_title"]),
        Paragraph(
            "正文按“入口、业务、数据、客户端、部署与边界”展开。页码从本页之后连续计算。",
            styles["body"],
        ),
        HRFlowable(width="100%", thickness=0.7, color=LINE),
        Spacer(1, 4 * mm),
        toc,
        PageBreak(),
    ]


def markdown_story(lines: list[str], styles) -> list[Flowable]:
    story: list[Flowable] = []
    idx = 0
    skipped_title = False
    skipped_metadata = 0

    while idx < len(lines):
        raw = lines[idx].rstrip()
        stripped = raw.strip()

        if not stripped:
            idx += 1
            continue

        if stripped.startswith("# ") and not skipped_title:
            skipped_title = True
            idx += 1
            continue

        if stripped.startswith("> ") and skipped_metadata < 2:
            skipped_metadata += 1
            idx += 1
            continue

        if stripped == "---":
            story.append(Spacer(1, 2 * mm))
            story.append(HRFlowable(width="100%", thickness=0.55, color=LINE))
            story.append(Spacer(1, 2.5 * mm))
            idx += 1
            continue

        if stripped.startswith("```"):
            language = stripped[3:].strip()
            block: list[str] = []
            idx += 1
            while idx < len(lines) and not lines[idx].strip().startswith("```"):
                block.append(lines[idx].rstrip())
                idx += 1
            idx += 1
            if language == "mermaid":
                joined = "\n".join(block)
                if "sequenceDiagram" in joined:
                    kind, caption = "request", "图：一次普通请求从页面到结果的共同路径"
                elif "反向代理" in joined or 'N["' in joined:
                    kind, caption = "deployment", "图：生产部署与客户端发布拓扑"
                else:
                    kind, caption = "architecture", "图：药大拾间全站组件与边界"
                story.append(Spacer(1, 2 * mm))
                story.append(SystemDiagram(kind))
                story.append(Paragraph(caption, styles["caption"]))
            else:
                story.append(Preformatted("\n".join(block), styles["code"], maxLineLength=100))
            continue

        if stripped.startswith("## "):
            story.append(Paragraph(inline_markup(stripped[3:]), styles["section"]))
            idx += 1
            continue
        if stripped.startswith("### "):
            story.append(Paragraph(inline_markup(stripped[4:]), styles["subsection"]))
            idx += 1
            continue
        if stripped.startswith("#### "):
            story.append(Paragraph(inline_markup(stripped[5:]), styles["minor"]))
            idx += 1
            continue

        if stripped.startswith("|"):
            rows, idx = parse_table(lines, idx)
            story.append(Spacer(1, 1.5 * mm))
            story.append(paragraph_table(rows, styles))
            story.append(Spacer(1, 4 * mm))
            continue

        if stripped.startswith("> "):
            quote_lines = []
            while idx < len(lines) and lines[idx].strip().startswith("> "):
                quote_lines.append(lines[idx].strip()[2:])
                idx += 1
            story.append(Paragraph(inline_markup(" ".join(quote_lines)), styles["quote"]))
            continue

        bullet = re.match(r"^-\s+(.+)", stripped)
        if bullet:
            story.append(
                Paragraph(f"•&nbsp;&nbsp;{inline_markup(bullet.group(1))}", styles["bullet"])
            )
            idx += 1
            continue

        numbered = re.match(r"^(\d+)\.\s+(.+)", stripped)
        if numbered:
            story.append(
                Paragraph(
                    f"{numbered.group(1)}.&nbsp;&nbsp;{inline_markup(numbered.group(2))}",
                    styles["number"],
                )
            )
            idx += 1
            continue

        paragraph_lines = [stripped]
        idx += 1
        while idx < len(lines):
            nxt = lines[idx].strip()
            if (
                not nxt
                or nxt == "---"
                or nxt.startswith("#")
                or nxt.startswith("```")
                or nxt.startswith("|")
                or nxt.startswith("> ")
                or re.match(r"^-\s+", nxt)
                or re.match(r"^\d+\.\s+", nxt)
            ):
                break
            paragraph_lines.append(nxt)
            idx += 1
        style = styles["lead"] if len(story) < 5 else styles["body"]
        story.append(Paragraph(inline_markup(" ".join(paragraph_lines)), style))

    return story


def validate_source(text: str) -> None:
    required = [
        "论坛与社区内容",
        "教务数据的完整链路",
        "校园服务与通用工具平台",
        "校园商城",
        "药苑之声",
        "桌面客户端的专用链路",
        "管理后台是全站控制面",
        "部署拓扑与发布",
        "安全、隐私和合规边界",
    ]
    missing = [item for item in required if item not in text]
    if missing:
        raise ValueError(f"Source is missing required sections: {missing}")
    if "\u2011" in text:
        raise ValueError("Source contains unsupported non-breaking hyphen U+2011")


def main() -> None:
    register_fonts()
    source_text = SOURCE.read_text(encoding="utf-8")
    validate_source(source_text)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = make_styles()
    story: list[Flowable] = []
    story.extend(cover_story(styles))
    story.extend(toc_story(styles))
    story.extend(markdown_story(source_text.splitlines(), styles))

    doc = TechnicalDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        title="药大拾间完整技术路线",
        author="药大拾间",
        subject="药大拾间全站技术路径、业务模块、客户端与部署说明",
        creator="CPU-web documentation renderer",
    )
    doc.multiBuild(story)
    print(OUTPUT)


if __name__ == "__main__":
    main()
