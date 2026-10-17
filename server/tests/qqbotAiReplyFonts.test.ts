import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { QQBOT_AI_CODE_FONT_FAMILY, QQBOT_AI_MATH_FONT_FAMILY } from "../src/services/qqbot/aiReplyImage";

// Linux 上的 Noto Color Emoji 收录了 0-9 却没有可见图形；文字字体若排在它后面，公式和代码里的数字会画成空白。
test("formula and code text fall back to a text font before any emoji font", () => {
  for (const family of [QQBOT_AI_MATH_FONT_FAMILY, QQBOT_AI_CODE_FONT_FAMILY]) {
    const fonts = family.split(",").map((name) => name.trim());
    const emoji = fonts.findIndex((name) => /emoji/iu.test(name));
    assert.ok(emoji > 0, family);
    for (const textFont of ["Noto Sans CJK SC", "HarmonyOS Sans SC"]) {
      const index = fonts.indexOf(textFont);
      assert.ok(index >= 0 && index < emoji, `${textFont} must come before the emoji fonts in ${family}`);
    }
  }
});

test("the bundled HarmonyOS Sans font the renderer falls back to ships with the server", () => {
  assert.ok(existsSync(path.resolve(__dirname, "../assets/fonts/HarmonyOS_Sans_SC_Regular.ttf")));
});
