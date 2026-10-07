import assert from "node:assert/strict";
import test from "node:test";
import { getColorGlassCourseTone, scheduleThemeOptions } from "../src/components/jwxt/scheduleTheme";
import {
  DEFAULT_SCHEDULE_STYLE,
  contrastRatio,
  normalizeScheduleStyle,
  rgbFromHex,
  scheduleCourseHash,
  scheduleStyleBrand,
  scheduleStyleCourseColor,
  scheduleStyleCourseTone,
  scheduleStyleCssVars,
  scheduleStyleLayout,
  scheduleStyleOptions,
  scheduleSurface,
  scheduleThemeTier,
  type RGB,
} from "../src/views/schedule/scheduleStyle";

const WHITE: RGB = { red: 1, green: 1, blue: 1 };

function over(base: RGB, top: RGB, amount: number): RGB {
  return {
    red: base.red + (top.red - base.red) * amount,
    green: base.green + (top.green - base.green) * amount,
    blue: base.blue + (top.blue - base.blue) * amount,
  };
}

test("classic stays the default and unknown values fall back to it", () => {
  assert.equal(DEFAULT_SCHEDULE_STYLE, "classic");
  assert.equal(normalizeScheduleStyle(null), "classic");
  assert.equal(normalizeScheduleStyle("neon"), "classic");
  assert.equal(normalizeScheduleStyle("paper"), "paper");
  // The identifiers and names iOS persists and shows (ScheduleStyle.swift).
  assert.deepEqual(scheduleStyleOptions.map((option) => [option.key, option.title]), [
    ["classic", "经典"], ["minimal", "简约"], ["grid", "格子"], ["table", "表格"], ["paper", "素笺"], ["board", "站牌"],
  ]);
  assert.deepEqual(scheduleStyleLayout("table"), {
    grid: "table", course: "stripe", cornerRadius: 0, borderWidth: 0, centered: false, font: "standard",
  });
  assert.deepEqual(scheduleStyleLayout("board"), {
    grid: "sessions", course: "departure", cornerRadius: 2, borderWidth: 0, centered: false, font: "monospaced",
  });
});

test("a course keeps the hue family it has in the classic style", () => {
  for (const name of ["药理学", "  高等  数学 ", "Organic Chemistry", "大学英语（四）"]) {
    const hash = scheduleCourseHash(name);
    const classic = getColorGlassCourseTone(name).text.match(/hsl\((\d+), (\d+)%/u);
    const styled = scheduleStyleCourseColor(name, "color-glass");
    assert.equal(styled.hue, hash % 360);
    assert.equal(String(styled.hue), classic?.[1]);
    assert.equal(styled.saturation, 58 + ((hash >>> 8) % 18));
    assert.equal(styled.backgroundLightness, 89 + ((hash >>> 16) % 5));
  }
  assert.equal(scheduleCourseHash("a  b"), scheduleCourseHash(" a b "));
});

test("a single-colour palette gives every course that palette's hue", () => {
  const first = scheduleStyleCourseColor("药理学", "blue");
  const second = scheduleStyleCourseColor("高等数学", "blue");
  assert.deepEqual(first, second);
  assert.equal(first.backgroundLightness, 91);
  assert.ok(first.saturation <= 76);
  // Slate stays grey.
  assert.ok(scheduleStyleCourseColor("药理学", "slate").saturation < 25);
  assert.deepEqual(scheduleStyleBrand("color-glass"), rgbFromHex(0x0f8f7f));
  assert.deepEqual(scheduleStyleBrand("blue"), rgbFromHex(0x2563eb));
});

test("course tones are a pale opaque tint in light and a translucent colour in dark", () => {
  const light = scheduleStyleCourseTone("药理学", "color-glass", false);
  const dark = scheduleStyleCourseTone("药理学", "color-glass", true);
  assert.match(light.fill, /^hsl\(/u);
  assert.match(scheduleStyleCourseTone("药理学", "color-glass", false, true).fill, /, 0\.92\)$/u);
  assert.match(dark.fill, /, 50%, 0\.22\)$/u);
  assert.match(light.accent, /, 24%\)$/u);
  assert.match(dark.accent, /, 80%\)$/u);
  assert.equal(light.accentInverse, dark.accent);
});

test("the theme text clears 4.5:1 on the page, the week panel and today's column for every palette", () => {
  for (const option of scheduleThemeOptions) {
    const brand = scheduleStyleBrand(option.key);
    for (const dark of [false, true]) {
      const tier = scheduleThemeTier(brand, dark);
      const canvases = dark
        ? [rgbFromHex(0x15181c), rgbFromHex(0x0e1012)]
        : [rgbFromHex(0xedf4ff), rgbFromHex(0xf8fafc), WHITE];
      for (const canvas of canvases) {
        const panel = over(canvas, WHITE, scheduleSurface.panelWhiteOpacity(dark));
        const today = over(panel, brand, scheduleSurface.todayStrength(dark));
        for (const surface of [canvas, panel, today]) {
          assert.ok(contrastRatio(tier.text, surface) >= 4.5 - 1e-6, `${option.key} ${dark ? "dark" : "light"} text`);
        }
      }
      assert.ok(contrastRatio(tier.fill, WHITE) >= 4.5 - 1e-6, `${option.key} fill carries white text`);
    }
  }
});

test("paper and board bring their own page colour unless a photo is set", () => {
  assert.equal(scheduleStyleCssVars({ style: "paper", palette: "color-glass", dark: false })["--ss-canvas"], "rgb(241, 236, 226)");
  assert.equal(scheduleStyleCssVars({ style: "board", palette: "color-glass", dark: true })["--ss-ink"], "rgb(255, 228, 163)");
  assert.equal(scheduleStyleCssVars({ style: "paper", palette: "color-glass", dark: false, hasBackground: true })["--ss-canvas"], "transparent");
  const minimal = scheduleStyleCssVars({ style: "minimal", palette: "blue", dark: false });
  assert.equal(minimal["--ss-canvas"], "transparent");
  assert.equal(minimal["--ss-column-gap"], "4px");
  assert.equal(minimal["--ss-theme-rgb"], "37, 99, 235");
  assert.equal(scheduleStyleCssVars({ style: "table", palette: "blue", dark: false })["--ss-column-gap"], "0px");
});
