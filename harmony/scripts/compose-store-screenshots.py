# compose-store-screenshots.py <screens-dir | manifest.json> <out-dir>
# Composes 1080 x 1920 (9:16) store images: a title, one line beneath it and the whole phone screen.
# Given the directory written by capture-store-screenshots.mjs it uses the built-in timetable set;
# given a JSON manifest, a list of {"image", "title", "subtitle", "dark"} with image paths relative
# to the manifest, it composes that set instead. Needs Pillow and Noto Sans SC (shipped with Windows 11).
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

source, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
FONT = r'C:\Windows\Fonts\NotoSansSC-VF.ttf'  # Noto Sans SC, SIL Open Font License
W, H = 1080, 1920

TIMETABLE = [
    ('01-week-classic', '一眼看完这一周', '原生课表，全天节次一屏显示', False),
    ('02-week-minimal', '六种课表风格', '经典、简约、格子、表格、素笺、站牌', False),
    ('04-day-board', '现在上什么，下一节在哪', '日视图标出正在上和接下来的课', False),
    ('06-month-classic', '月视图', '农历、节假日与调休，一个月尽收眼底', False),
    ('08-course-quick-look', '点一下，看课程详情', '教室、老师、周次，随手就能编辑', False),
    ('10-sharing', '和同学共享课表', '一个分享码，对方只读查看', False),
    ('11-week-grid-dark', '深色模式', '中性深灰，夜里看课表不刺眼', True),
]
if source.suffix == '.json':
    posters = [(source.parent / item['image'], item['title'], item['subtitle'], bool(item.get('dark')))
               for item in json.loads(source.read_text(encoding='utf-8'))]
else:
    posters = [(source / f'{name}.png', title, subtitle, dark) for name, title, subtitle, dark in TIMETABLE]


def font(size, weight):
    face = ImageFont.truetype(FONT, size)
    face.set_variation_by_axes([weight])
    return face


def gradient(top, bottom):
    image = Image.new('RGB', (W, H))
    draw = ImageDraw.Draw(image)
    for y in range(H):
        t = y / (H - 1)
        draw.line([(0, y), (W, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return image


for index, (path, title, subtitle, dark) in enumerate(posters, start=1):
    canvas = gradient((21, 24, 28), (14, 16, 18)) if dark else gradient((226, 242, 237), (248, 251, 255))
    draw = ImageDraw.Draw(canvas)
    title_font, subtitle_font = font(70, 700), font(35, 400)
    draw.text((W / 2, 150), title, font=title_font, fill=(236, 238, 241) if dark else (18, 50, 44), anchor='mm')
    draw.text((W / 2, 244), subtitle, font=subtitle_font, fill=(176, 183, 193) if dark else (84, 104, 98), anchor='mm')

    screen = Image.open(path).convert('RGB')
    height = H - 330 - 70
    width = round(screen.width * height / screen.height)
    screen = screen.resize((width, height), Image.LANCZOS)
    radius = 46
    mask = Image.new('L', (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, width - 1, height - 1], radius=radius, fill=255)
    left, top = (W - width) // 2, 330
    # A soft shadow under the screen, then a hairline so a light screen keeps its edge.
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([left, top + 18, left + width, top + height + 18], radius=radius,
                                             fill=(0, 0, 0, 120 if dark else 46))
    canvas.paste(Image.alpha_composite(canvas.convert('RGBA'), shadow.filter(ImageFilter.GaussianBlur(28))).convert('RGB'))
    canvas.paste(screen, (left, top), mask)
    ImageDraw.Draw(canvas).rounded_rectangle([left, top, left + width - 1, top + height - 1], radius=radius,
                                             outline=(58, 62, 68) if dark else (206, 216, 222), width=2)
    stem = path.stem
    target = out / f'{index:02d}-{stem[3:] if stem[:2].isdigit() and stem[2] == "-" else stem}.png'
    canvas.save(target)
    print(target.name, canvas.size)
