from pathlib import Path
from fontTools import subset


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "web"
FONT_ROOT = WEB_ROOT / "src" / "assets" / "fonts"
# 网页还会打包这些目录里的共享模块（如页脚备案号），其中的文字同样需要覆盖。
SOURCE_ROOTS = (WEB_ROOT, ROOT / "shared", ROOT / "server" / "src" / "shared", ROOT / "server" / "src" / "releases")
SOURCE_EXTENSIONS = {".css", ".html", ".js", ".json", ".scss", ".ts", ".vue"}
BASE_CHARACTERS = "".join(chr(value) for value in range(0x20, 0x7F)) + "\n\r\t，。！？：；、（）【】《》“”‘’·…—￥"


def collect_characters():
    characters = set(BASE_CHARACTERS)
    for source_root in SOURCE_ROOTS:
        for path in source_root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in SOURCE_EXTENSIONS:
                continue
            if any(part in {"dist", "node_modules"} for part in path.parts):
                continue
            characters.update(path.read_text(encoding="utf-8", errors="ignore"))
    return ",".join(f"U+{ord(char):04X}" for char in sorted(characters))


def main():
    unicodes = collect_characters()
    for weight in ("Regular", "Medium", "Bold"):
        source = FONT_ROOT / f"HarmonyOS_Sans_SC_{weight}.woff2"
        target = FONT_ROOT / f"HarmonyOS_Sans_SC_{weight}_UI.woff2"
        subset.main([
            str(source),
            f"--output-file={target}",
            f"--unicodes={unicodes}",
            "--flavor=woff2",
            "--layout-features=*",
            "--name-IDs=*",
            "--name-legacy",
            "--notdef-glyph",
            "--notdef-outline",
            "--recommended-glyphs",
            "--no-hinting",
        ])


if __name__ == "__main__":
    main()
