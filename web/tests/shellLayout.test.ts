import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync(new URL("../src/layouts/MainLayout.vue", import.meta.url), "utf8");
const footer = readFileSync(new URL("../src/components/common/SiteFooter.vue", import.meta.url), "utf8");
const compactMixins = readFileSync(new URL("../src/styles/_compact.scss", import.meta.url), "utf8");
const script = layout.slice(layout.indexOf("<script setup"), layout.indexOf("</script>"));
const styles = layout.slice(layout.indexOf("<style"));

/** Top-level blocks of a stylesheet with their opening line, e.g. "@media (max-width: 768px)". */
function topLevelBlocks(css: string) {
  const blocks: Array<{ head: string; body: string }> = [];
  let depth = 0;
  let start = 0;
  let head = "";
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") {
      if (depth === 0) {
        head = css.slice(start, index).trim().split("\n").pop()!.trim();
        start = index + 1;
      }
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        blocks.push({ head, body: css.slice(start, index) });
        start = index + 1;
      }
    }
  }
  return blocks;
}

test("the shell uses the shared classifier instead of its own orientation and touch rules", () => {
  for (const removed of [
    "(orientation: portrait)",
    "isTabletTouchViewport",
    "useTabbarFallback",
    "touchLikeViewport",
    "isPortraitViewport",
    "getScreenOrientation",
    "screen.height >= window.screen.width",
    "effectiveViewportWidth",
  ]) {
    assert.equal(layout.includes(removed), false, removed);
  }
  assert.match(script, /const ff = useFormFactor\(\);/u);
  assert.match(script, /const useMobileForumLayout = computed\(\(\) => ff\.value\.compact\);/u);
  assert.match(script, /const showWebTabbar = computed\(\(\) => ff\.value\.compact && !useNativeShell\.value && !mobileTopicChrome\.value\);/u);
  assert.match(layout, /'layout-root--tabbar-fallback': showWebTabbar/u);
  assert.match(layout, /<MobileTabbar\s+v-if="showWebTabbar"/u);
});

test("the PC tools button is only offered where the desktop client can be installed", () => {
  assert.match(script, /const desktopToolsOffered = canOfferDesktopClient\(\);/u);
  assert.match(script, /const showToolsFab = computed\(\(\) => showFloatingActions\.value && desktopToolsOffered\);/u);
  assert.match(layout, /'layout-root--no-tools-fab': !showToolsFab/u);
});

test("hover-only interactions have a tap equivalent on touch devices", () => {
  assert.match(layout, /<el-dropdown :trigger="ff\.canHover \? 'hover' : 'click'" @command="onUserCmd">/u);
  assert.equal((layout.match(/<el-tooltip [^>]*:disabled="!ff\.canHover"/gu) || []).length, 3);
  for (const selector of [".top-nav a", ".user-info", ".tools-fab", ".assistant-fab", ".forum-post-fab", ".direct-message-shortcut"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(styles, new RegExp(`@media \\(hover: hover\\) \\{\\s*${escaped}:hover`, "u"), selector);
    assert.match(styles, new RegExp(`${escaped}:active`, "u"), selector);
  }
});

test("viewport listeners and the first measurement do not wait for the session check", () => {
  const setupSync = script.indexOf("\nsyncViewportMetrics();");
  const mounted = script.slice(script.indexOf("onMounted(async () => {"));
  assert.ok(setupSync > 0, "syncViewportMetrics() runs in setup");
  assert.ok(setupSync < script.indexOf("onMounted(async () => {"));
  assert.ok(mounted.indexOf("syncViewportMetrics();") < mounted.indexOf("await auth.fetchMe()"));
  assert.ok(mounted.indexOf('document.addEventListener("focusin", handleFocusIn);') < mounted.indexOf("await auth.fetchMe()"));
  assert.ok(mounted.indexOf("await auth.fetchMe()") < mounted.indexOf("msg.refresh()"));
});

test("keyboard detection is keyed by width and only phones assume a keyboard on focus", () => {
  assert.match(script, /from "@\/utils\/keyboardViewport"/u);
  assert.equal(script.includes("viewportBaseHeights"), false);
  assert.match(script, /fullHeightContent\.value && editableFocused\.value && ff\.value\.device === "phone"/u);
  assert.match(script, /editorFocused\.value && ff\.value\.device === "phone"/u);
  assert.match(script, /KEYBOARD_BLUR_CLOSE_MS/u);
  assert.match(layout, /'is-keyboard-pinned': assistantKeyboardPinned/u);
  assert.equal((script.match(/innerHeightIgnoresKeyboard: ff\.value\.appleTouch/gu) || []).length, 2);
});

test("focus that survives a route change, and focus moving to a button, keep keyboard detection honest", () => {
  const routeWatcher = script.slice(script.indexOf("watch(() => route.fullPath"), script.indexOf("watch(assistantEntryVisible"));
  assert.match(routeWatcher, /editableFocused\.value = isEditableElement\(active\);/u);
  assert.equal(routeWatcher.includes("editableFocused.value = false;"), false);
  assert.match(routeWatcher, /scheduleKeyboardBlurClose\(\);/u);
  assert.match(routeWatcher, /updateKeyboardState\(\);/u);
  // Only an editable target cancels the blur safety net; a button or dialog never brings a software keyboard.
  const focusIn = script.slice(script.indexOf("function handleFocusIn"), script.indexOf("function handleFocusOut"));
  assert.match(focusIn, /if \(editableFocused\.value\) \{\s*window\.clearTimeout\(keyboardBlurCloseTimer\);/u);
  assert.equal((focusIn.match(/clearTimeout\(keyboardBlurCloseTimer\)/gu) || []).length, 1);
});

test("chrome state is published on <html> for teleported elements and removed on unmount", () => {
  for (const name of ["data-cpu-web-tabbar", "data-cpu-post-fab", "--cpu-web-tabbar-reserve"]) {
    assert.ok((script.match(new RegExp(name, "gu")) || []).length >= 2, name);
  }
  assert.match(script, /watchEffect\(/u);
  assert.match(script, /removeAttribute\("data-cpu-web-tabbar"\)[\s\S]*onBeforeUnmount|onBeforeUnmount[\s\S]*removeAttribute\("data-cpu-web-tabbar"\)/u);
  assert.match(layout, /:fab-gutter="showToolsFab \|\| showForumPostFab \|\| \(showFloatingActions && assistantEntryVisible\)"/u);
});

test("the phone shell follows the compact layout and the tablet portrait tab-bar block is gone", () => {
  assert.match(styles, /@use "\.\.\/styles\/compact" as \*;/u);
  assert.match(styles, /@include compact-header \{\s*\.top-nav \{ display: none; \}/u);
  assert.match(styles, /@include compact-layout \{/u);
  assert.equal(/@media \(max-width: 768px\)/u.test(styles), false);
  assert.equal(/@media \(max-width: 960px\)/u.test(styles), false);
  assert.equal(/max-width: 1366px/u.test(styles), false);
  assert.equal(/\(hover: none\)/u.test(styles), false);
});

test("the drawer sheet is styled wherever the header collapses", () => {
  const blocks = topLevelBlocks(styles.slice(styles.indexOf(">") + 1, styles.lastIndexOf("</style>")));
  const drawer = blocks.find((block) => block.head === ":deep(.mobile-drawer)");
  assert.ok(drawer, "unconditional :deep(.mobile-drawer) rule");
  for (const head of [":deep(.mobile-drawer .el-drawer__header)", ":deep(.mobile-drawer .el-drawer__body)"]) {
    assert.ok(blocks.some((block) => block.head === head), head);
  }
  for (const block of blocks.filter((candidate) => candidate.head.startsWith("@"))) {
    if (block.head === "@media (min-width: 700px)") continue;
    assert.equal(block.body.includes(":deep(.mobile-drawer"), false, block.head);
  }
  assert.ok(blocks.some((block) => block.head === ".layout-root.keyboard-open .forum-post-fab"));
});

test("the shared mixins keep the phone media query and add the compact attribute without specificity", () => {
  assert.match(compactMixins, /@mixin compact-layout \{\s*@media \(max-width: 768px\)/u);
  assert.match(compactMixins, /@mixin compact-header \{\s*@media \(max-width: 960px\)/u);
  assert.match(compactMixins, /:where\(html\[data-cpu-layout="compact"\]\)/u);
  assert.match(compactMixins, /@mixin expanded-only \{[\s\S]*:where\(html:not\(\[data-cpu-layout="compact"\]\)\)/u);
  assert.match(compactMixins, /@mixin expanded-touch \{\s*@media \(pointer: coarse\)[\s\S]*:where\(html\[data-cpu-layout="expanded"\]\)/u);
});

test("the footer reserves the floating buttons only when they are shown", () => {
  assert.match(footer, /'footer--fab-gutter': fabGutter/u);
  // Compact tablets at 961–1023 px hide the floating buttons, so the gutter is for the desktop tree only.
  assert.match(footer, /@media \(min-width: 961px\) and \(max-width: 1439px\) \{\s*@include expanded-only \{\s*\.footer--fab-gutter \.footer-inner \{ padding-right: 76px; \}/u);
  assert.match(footer, /@include compact-header \{\s*\.layout-root--post-fab \.footer/u);
  assert.match(footer, /@include compact-layout \{/u);
  assert.equal(/@media \(max-width: 768px\)/u.test(footer), false);
});
