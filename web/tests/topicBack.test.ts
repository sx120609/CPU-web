import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTopicBackTarget, topicBackLabel, topicBackStep } from "../src/views/forum/topicBack";

test("from names the list the topic was opened from", () => {
  const cases: Array<[string, string]> = [
    ["/home", "返回首页"],
    ["/", "返回首页"],
    ["/forum", "返回论坛"],
    ["/forum?channel=hot", "返回热榜"],
    ["/forum?channel=market&page=2", "返回二手"],
    ["/forum?channel=question", "返回板块"],
    ["/forum?channel=unknown", "返回论坛"],
    ["/forum/latest", "返回最新"],
    ["/forum/latest?page=3", "返回最新"],
    ["/forum/hot", "返回热榜"],
    ["/forum/b/market", "返回二手"],
    ["/forum/b/general?page=2", "返回板块"],
    ["/search/results?q=%E8%80%83%E8%AF%95", "返回搜索"],
    ["/search/results?q=考试", "返回搜索"],
    ["/u/12", "返回上页"],
    ["/messages", "返回上页"],
  ];
  for (const [from, label] of cases) assert.equal(topicBackLabel(from), label, from);
});

test("without a usable from the label keeps the previous defaults", () => {
  assert.equal(topicBackLabel(undefined), "返回最新");
  assert.equal(topicBackLabel(""), "返回最新");
  assert.equal(topicBackLabel(undefined, true), "返回上页");
  for (const unsafe of ["https://evil.example/home", "//evil.example/home", "/\\evil.example", "home", "javascript:alert(1)"]) {
    assert.equal(normalizeTopicBackTarget(unsafe), "", unsafe);
    assert.equal(topicBackLabel(unsafe), "返回最新", unsafe);
  }
});

test("normalisation makes from and history.state.back comparable", () => {
  assert.equal(normalizeTopicBackTarget("/search/results?q=考试"), "/search/results?q=%E8%80%83%E8%AF%95");
  assert.equal(normalizeTopicBackTarget("  /forum/latest/  "), "/forum/latest");
  assert.equal(normalizeTopicBackTarget("/"), "/");
  assert.equal(normalizeTopicBackTarget(["/home", "/forum"]), "/home");
  assert.equal(normalizeTopicBackTarget(null), "");
});

test("history is used only when the previous entry is the page the label names", () => {
  assert.deepEqual(topicBackStep("/home", "/home"), { kind: "history-back" });
  assert.deepEqual(
    topicBackStep("/search/results?q=考试", "/search/results?q=%E8%80%83%E8%AF%95"),
    { kind: "history-back" },
  );
  // Opened from home, then another topic in between: go to home instead of the other topic.
  assert.deepEqual(topicBackStep("/home", "/forum/topic/7?from=/home"), { kind: "push", to: "/home" });
  // A reload or a shared link has no previous entry.
  assert.deepEqual(topicBackStep("/forum/hot", null), { kind: "push", to: "/forum/hot" });
  assert.deepEqual(topicBackStep("/forum?channel=hot", undefined), { kind: "push", to: "/forum?channel=hot" });
});

test("without from the announcement and 最新 fallbacks stay", () => {
  assert.deepEqual(topicBackStep(undefined, "/home", true), { kind: "announcement" });
  assert.deepEqual(topicBackStep(undefined, "/home"), { kind: "latest" });
  assert.deepEqual(topicBackStep("//evil.example", "//evil.example"), { kind: "latest" });
});
