import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// The native UI has its own scale (CpuTheme.kt: NativeScale): a narrow phone lays out 393 wide and text
// does not follow the system text size. A sheet, dialog or menu is a window of its own and starts again
// from the system's values, so every one must go through the wrappers in CpuWindows.kt. These checks keep
// a new screen from quietly opening one at the system's size.
const sources = new URL("../app/src/main/java/cn/lizmt/cpuweb/schedule/", import.meta.url);
const read = (name) => readFileSync(new URL(name, sources), "utf8");
const kotlin = readdirSync(sources).filter((name) => name.endsWith(".kt"));

test("sheets, dialogs and menus are opened through the scaled wrappers", () => {
  const raw = /(?<![A-Za-z0-9_])(ModalBottomSheet|AlertDialog|BasicAlertDialog|DropdownMenu|Dialog|Popup|DatePickerDialog|TimePickerDialog|ExposedDropdownMenu)\(/gu;
  const offenders = [];
  for (const name of kotlin) {
    if (name === "CpuWindows.kt") continue;
    const code = read(name).replace(/\/\/.*$/gmu, "").replace(/\/\*[\s\S]*?\*\//gu, "");
    for (const match of code.matchAll(raw)) offenders.push(`${name}: ${match[1]}(`);
  }
  assert.deepEqual(offenders, []);
});

test("each wrapper puts its content on the app's scale", () => {
  const windows = read("CpuWindows.kt");
  for (const wrapper of ["CpuBottomSheet", "CpuAlertDialog", "CpuDropdownMenu", "CpuDialog"]) {
    const start = windows.indexOf(`fun ${wrapper}(`);
    assert.ok(start >= 0, wrapper);
    const next = windows.indexOf("\n@Composable", start);
    assert.match(windows.slice(start, next < 0 ? undefined : next), /NativeScale/u, wrapper);
  }
});

test("the page is scaled once by the theme, and both activities hold text at 100%", () => {
  const theme = read("CpuTheme.kt");
  assert.match(theme, /const val NATIVE_FONT_SCALE = 1f/u);
  assert.match(theme, /const val DESIGN_WIDTH_DP = 393f/u);
  assert.match(theme, /NativeScale\(content\)/u);
  for (const activity of ["MainActivity.kt", "ScheduleWidgetConfigureActivity.kt"]) {
    assert.match(read(activity), /applyOverrideConfiguration\(nativeConfigurationOverride\(\)\)/u, activity);
  }
  // The Web pages are held at 100% as well.
  assert.match(read("WebSession.kt"), /settings\.textZoom = 100/u);
});

test("the Web pages of the app use the same design width and limits", () => {
  const theme = read("CpuTheme.kt");
  const bootstrap = readFileSync(new URL("../../web/public/appearance-bootstrap.js", import.meta.url), "utf8");
  const number = (source, pattern) => Number(source.match(pattern)?.[1]);
  assert.equal(number(bootstrap, /const designWidth = ([\d.]+);/u), number(theme, /const val DESIGN_WIDTH_DP = ([\d.]+)f/u));
  assert.equal(number(bootstrap, /const fullWidth = ([\d.]+);/u), number(theme, /const val FULL_WIDTH_DP = ([\d.]+)f/u));
  assert.equal(number(bootstrap, /const smallestScale = ([\d.]+);/u), number(theme, /const val MIN_LAYOUT_SCALE = ([\d.]+)f/u));
});

test("widget text is sized in dp: the launcher would scale sp with the system text size", () => {
  const layouts = new URL("../app/src/main/res/layout/", import.meta.url);
  const offenders = readdirSync(layouts)
    .filter((name) => name.endsWith(".xml") && /android:textSize="[\d.]+sp"/u.test(readFileSync(new URL(name, layouts), "utf8")));
  assert.deepEqual(offenders, []);
});
