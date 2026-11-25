import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {
  DEFAULT_SITE_THEME,
  SITE_THEMES,
  normalizeSiteTheme,
  siteThemeOptions,
} from "../src/stores/siteTheme";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("defaults to classic teal and exposes all six permanent site themes", () => {
  assert.equal(DEFAULT_SITE_THEME, "classic");
  assert.deepEqual(SITE_THEMES, ["classic", "crimson", "ocean", "emerald", "violet", "amber"]);
  assert.deepEqual(
    siteThemeOptions.map((item) => item.value),
    ["classic", "crimson", "ocean", "emerald", "violet", "amber"],
  );
  for (const option of siteThemeOptions) {
    assert.ok(option.label.length >= 3);
    assert.match(option.swatch, /^linear-gradient\(/u);
  }
});

test("migrates legacy anniversary preference to crimson and falls back to classic", () => {
  assert.equal(normalizeSiteTheme("anniversary"), "crimson");
  assert.equal(normalizeSiteTheme("crimson"), "crimson");
  assert.equal(normalizeSiteTheme("ocean"), "ocean");
  assert.equal(normalizeSiteTheme("emerald"), "emerald");
  assert.equal(normalizeSiteTheme("violet"), "violet");
  assert.equal(normalizeSiteTheme("amber"), "amber");
  assert.equal(normalizeSiteTheme("classic"), "classic");
  assert.equal(normalizeSiteTheme(""), "classic");
  assert.equal(normalizeSiteTheme(null), "classic");
  assert.equal(normalizeSiteTheme(undefined), "classic");
  assert.equal(normalizeSiteTheme("unknown"), "classic");
});

function runBootstrap(storage: Record<string, string>) {
  const root: { dataset: Record<string, string>; classList: { toggle(): void }; style: Record<string, string> } = {
    dataset: {},
    classList: { toggle() {} },
    style: {},
  };
  runInNewContext(readFileSync(path.join(webRoot, "public/appearance-bootstrap.js"), "utf8"), {
    localStorage: { getItem: (key: string) => storage[key] ?? null },
    navigator: { userAgent: "Mozilla/5.0 Chrome/140.0", platform: "Win32", maxTouchPoints: 0 },
    window: {
      localStorage: { getItem: (key: string) => storage[key] ?? null },
      matchMedia: () => ({ matches: false }),
      location: { origin: "https://cputime.cn" },
    },
    document: {
      title: "药大拾间",
      readyState: "complete",
      documentElement: root,
      querySelector: () => ({ setAttribute() {}, getAttribute: () => "" }),
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({}),
      head: { appendChild() {} },
    },
  });
  return root.dataset.cpuTheme;
}

test("appearance bootstrap restores explicit site themes and ignores stale active celebration cache", () => {
  assert.equal(runBootstrap({}), undefined);
  assert.equal(runBootstrap({ "cpu-site-theme-active-v1": "anniversary" }), undefined);
  assert.equal(runBootstrap({ "cpu-site-theme-v1": "classic" }), undefined);
  assert.equal(runBootstrap({ "cpu-site-theme-v1": "anniversary" }), "crimson");
  assert.equal(runBootstrap({ "cpu-site-theme-v1": "ocean" }), "ocean");
  assert.equal(runBootstrap({ "cpu-site-theme-v1": "emerald" }), "emerald");
  assert.equal(runBootstrap({ "cpu-site-theme-v1": "violet" }), "violet");
  assert.equal(runBootstrap({ "cpu-site-theme-v1": "amber" }), "amber");
});

function luminance(hex: string) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("every non-classic site theme palette meets WCAG AA contrast in light and dark modes", () => {
  const source = readFileSync(path.join(webRoot, "src/styles/site-themes.scss"), "utf8");
  const lightMatches = [...source.matchAll(/html\[data-cpu-theme="(\w+)"\]\s*\{\s*@include site-theme-light\(\s*(#[0-9a-f]{6}),\s*#[0-9a-f]{6},\s*#[0-9a-f]{6},\s*#[0-9a-f]{6},\s*(#[0-9a-f]{6})/giu)];
  const darkMatches = [...source.matchAll(/html\[data-cpu-theme="(\w+)"\]\[data-theme="dark"\]\s*\{\s*@include site-theme-dark\(\s*(#[0-9a-f]{6}),\s*#[0-9a-f]{6},\s*#[0-9a-f]{6},\s*(#[0-9a-f]{6}),\s*(#[0-9a-f]{6})/giu)];

  assert.equal(lightMatches.length, 5);
  assert.equal(darkMatches.length, 5);

  for (const [, name, primary, bg] of lightMatches) {
    assert.ok(contrast(primary, "#ffffff") >= 4.5, `${name} light primary on white < 4.5`);
    assert.ok(contrast(primary, bg) >= 4.5, `${name} light primary on page bg < 4.5`);
  }

  for (const [, name, primary, onPrimary, bg] of darkMatches) {
    assert.ok(contrast(primary, "#1a1d21") >= 4.5, `${name} dark primary on card < 4.5`);
    assert.ok(contrast(primary, bg) >= 4.5, `${name} dark primary on page bg < 4.5`);
    assert.ok(contrast(primary, onPrimary) >= 4.5, `${name} dark primary on button ink < 4.5`);
  }
});
