from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from build_report import IMG_ARCH, IMG_FORUM, IMG_HOMEPAGE, SECTIONS, SUBTITLE, TITLE


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_PDF = BASE_DIR / "ai-counselor-report.pdf"

FONT_REGULAR = "YaHei"
FONT_BOLD = "YaHeiBold"
COLOR_HEADING = colors.HexColor("#205080")
COLOR_TEXT = colors.HexColor("#20232A")
COLOR_MUTED = colors.HexColor("#646C7A")
COLOR_BOX_BG = colors.HexColor("#EEF4FB")
COLOR_RULE = colors.HexColor("#D6E3F1")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont(FONT_REGULAR, r"C:\Windows\Fonts\msyh.ttc"))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, r"C:\Windows\Fonts\msyhbd.ttc"))


def create_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="ReportTitle",
            fontName=FONT_BOLD,
            fontSize=20,
            leading=28,
            textColor=COLOR_HEADING,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            name="ReportSubtitle",
            fontName=FONT_REGULAR,
            fontSize=10.5,
            leading=16,
            textColor=COLOR_MUTED,
            spaceAfter=10,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodyCN",
            fontName=FONT_REGULAR,
            fontSize=11,
            leading=18,
            textColor=COLOR_TEXT,
            alignment=TA_JUSTIFY,
            wordWrap="CJK",
            spaceAfter=7,
            firstLineIndent=22,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodyNoIndent",
            parent=styles["BodyCN"],
            firstLineIndent=0,
        )
    )
    styles.add(
        ParagraphStyle(
            name="H1CN",
            fontName=FONT_BOLD,
            fontSize=15.5,
            leading=22,
            textColor=COLOR_HEADING,
            spaceBefore=14,
            spaceAfter=8,
            keepWithNext=True,
        )
    )
    styles.add(
        ParagraphStyle(
            name="H2CN",
            fontName=FONT_BOLD,
            fontSize=12.5,
            leading=18,
            textColor=COLOR_HEADING,
            spaceBefore=4,
            spaceAfter=8,
            keepWithNext=True,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CaptionCN",
            fontName=FONT_REGULAR,
            fontSize=9.5,
            leading=14,
            alignment=TA_CENTER,
            textColor=COLOR_MUTED,
            spaceBefore=4,
        )
    )
    styles.add(
        ParagraphStyle(
            name="FooterCN",
            fontName=FONT_REGULAR,
            fontSize=8.5,
            textColor=COLOR_MUTED,
            alignment=TA_LEFT,
        )
    )
    styles.add(
        ParagraphStyle(
            name="ListCN",
            parent=styles["BodyCN"],
            firstLineIndent=0,
            leftIndent=0,
            spaceAfter=0,
        )
    )
    return styles


def add_bullets(items: list[str], style: ParagraphStyle, bullet_type: str = "bullet"):
    return ListFlowable(
        [
            ListItem(Paragraph(item, style), leftIndent=0)
            for item in items
        ],
        bulletType=bullet_type,
        start="1" if bullet_type == "1" else None,
        leftIndent=16,
        bulletFontName=FONT_REGULAR,
        bulletFontSize=10.5,
        bulletColor=COLOR_HEADING,
        spaceBefore=2,
        spaceAfter=8,
    )


def fit_image(path: Path, max_width: float, max_height: float) -> Image:
    reader = ImageReader(str(path))
    width, height = reader.getSize()
    scale = min(max_width / width, max_height / height)
    img = Image(str(path), width=width * scale, height=height * scale)
    img.hAlign = "CENTER"
    return img


def summary_box(text: str, styles) -> Table:
    table = Table([[Paragraph(text, styles["BodyNoIndent"])]], colWidths=[6.15 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), COLOR_BOX_BG),
                ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#C9DCEF")),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return table


def section_story(title: str, paragraphs: list[str], styles, bullets: list[str] | None = None, tail: list[str] | None = None):
    story = [Paragraph(title, styles["H1CN"])]
    for text in paragraphs:
        story.append(Paragraph(text, styles["BodyCN"]))
    if bullets:
        story.append(add_bullets(bullets, styles["ListCN"]))
    if tail:
        for text in tail:
            story.append(Paragraph(text, styles["BodyCN"]))
    return story


def section_story_from_tuple(section_tuple, styles):
    title = section_tuple[0]
    paragraphs = section_tuple[1]
    bullets = section_tuple[2] if len(section_tuple) >= 3 else None
    tail = section_tuple[3] if len(section_tuple) >= 4 else None
    return section_story(title, paragraphs, styles, bullets, tail)


def figure_page(heading: str, lead: str, image_path: Path, caption: str, styles):
    return [
        PageBreak(),
        Paragraph(heading, styles["H2CN"]),
        Paragraph(lead, styles["BodyCN"]),
        Spacer(1, 8),
        KeepTogether(
            [
                fit_image(image_path, max_width=6.0 * inch, max_height=8.0 * inch),
                Paragraph(caption, styles["CaptionCN"]),
            ]
        ),
    ]


def draw_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(COLOR_RULE)
    canvas.setLineWidth(0.5)
    canvas.line(doc.leftMargin, 0.62 * inch, letter[0] - doc.rightMargin, 0.62 * inch)
    canvas.setFont(FONT_REGULAR, 8.5)
    canvas.setFillColor(COLOR_MUTED)
    canvas.drawString(doc.leftMargin, 0.42 * inch, "AI 辅导员产品形态与能力边界建议")
    page_label = f"第 {canvas.getPageNumber()} 页"
    canvas.drawRightString(letter[0] - doc.rightMargin, 0.42 * inch, page_label)
    canvas.restoreState()


def build() -> None:
    register_fonts()
    styles = create_styles()
    doc = SimpleDocTemplate(
        str(OUTPUT_PDF),
        pagesize=letter,
        leftMargin=1 * inch,
        rightMargin=1 * inch,
        topMargin=0.95 * inch,
        bottomMargin=0.9 * inch,
        title=TITLE,
        author="OpenAI Codex",
    )

    story = [
        Paragraph(TITLE, styles["ReportTitle"]),
        Paragraph(SUBTITLE, styles["ReportSubtitle"]),
        HRFlowable(width="100%", thickness=0.8, color=COLOR_RULE, spaceAfter=10),
        summary_box(
            "摘要：这份材料主要围绕 AI 辅导员的产品定位、首页结构、能力组织以及论坛能力的吸收边界，提出一套更适合校内正式场景的建设思路。",
            styles,
        ),
        Spacer(1, 14),
    ]

    for section in SECTIONS[:4]:
        story.extend(section_story_from_tuple(section, styles))

    story.extend(
        figure_page(
            "配图一：工作台式首页概念图",
            "这版首页不是把 AI 去掉，而是把 AI 放回到更合适的位置。页面先承接学生最关心的事情，再让对话能力去补足复杂问题，整体会更像一个真实可用的校内服务入口。",
            IMG_HOMEPAGE,
            "图 1  首页概念图：从“聊天中心”转向“任务中心”的工作台式首页",
            styles,
        )
    )

    story.extend(section_story_from_tuple(SECTIONS[4], styles))
    story.extend(
        figure_page(
            "配图二：建议能力结构",
            "如果我们后续要把更多能力接进来，最稳的方式不是不停给聊天框加功能，而是把页面展示、意图识别和底层能力调用拆开，这样系统扩展起来会更清楚。",
            IMG_ARCH,
            "图 2  能力结构图：展示层、AI 编排层与能力数据层的分层关系",
            styles,
        )
    )

    story.extend(section_story_from_tuple(SECTIONS[5], styles))
    story.extend(
        figure_page(
            "配图三：论坛能力的吸收边界",
            "论坛最值得保留的是经验沉淀和真实问题，而不是所有原始讨论。把它转成“经验问答层”或“案例知识层”，既能补足官方知识库，又能把风险控制在更合理的范围内。",
            IMG_FORUM,
            "图 3  论坛边界图：保留经验价值，但避免把完整社区直接带入官方场景",
            styles,
        )
    )

    for section in SECTIONS[6:]:
        story.extend(section_story_from_tuple(section, styles))

    story.extend(
        [
            Paragraph("附：三张配图的使用建议", styles["H1CN"]),
            add_bullets(
                [
                    "首页概念图适合放在汇报前半部分，用来直观说明“为什么首页应该从聊天中心转成任务中心”。",
                    "能力结构图适合放在中段，用来说明 AI 辅导员不是单一模型页面，而是展示层、AI 编排层和能力数据层共同组成的系统。",
                    "论坛边界图适合放在后半部分，用来说明论坛能力可以吸收，但必须经过治理和重构，不能直接以完整社区形态并入。",
                ],
                styles["ListCN"],
                bullet_type="1",
            ),
        ]
    )

    doc.build(story, onFirstPage=draw_footer, onLaterPages=draw_footer)


if __name__ == "__main__":
    build()
