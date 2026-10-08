import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqGroupAssistantQuestion,
  closeQqGroupAssistantSession,
  collectQqAtTargets,
  countRecentQqGroupAssistantAnswers,
  decideQqGroupAssistant,
  isQqAssistantFillerMessage,
  isQqGroupProactiveCoolingDown,
  looksLikeQqGroupFollowUpQuestion,
  lookupQqGroupAssistantReply,
  markQqGroupProactiveReply,
  normalizeQqAssistantQuestionKey,
  openQqGroupAssistantSession,
  parseQqBotNameCall,
  QQBOT_GROUP_FOLLOW_UP_WINDOW_MS,
  QQBOT_GROUP_IMPLICIT_TURN_LIMIT,
  QQBOT_GROUP_IMPLICIT_TURN_WINDOW_MS,
  QQBOT_GROUP_PROACTIVE_COOLDOWN_MS,
  QQBOT_GROUP_SUMMON_WINDOW_MS,
  readQqGroupAssistantSession,
  recordQqGroupAssistantAnswer,
  rememberQqAssistantAnsweredQuestion,
  rememberQqGroupAssistantReply,
  resetQqGroupAssistantState,
  wasQqAssistantQuestionAnswered,
  type QqGroupAssistantSignals,
} from "../src/services/qqbot/groupAssistantTrigger";

const BOT = "10001";

function text(value: string) {
  return { type: "text", data: { text: value } };
}

function signals(input: Partial<QqGroupAssistantSignals> & { text?: string } = {}): QqGroupAssistantSignals {
  const value = input.text ?? "";
  return {
    text: value,
    message: input.message ?? (value ? [text(value)] : []),
    mentionsBot: false,
    calledByName: false,
    mentionsOthers: false,
    quoted: "none",
    quotedHasContent: false,
    session: null,
    collecting: false,
    recentAnswers: 0,
    proactiveCoolingDown: false,
    ...input,
  };
}

test("@拾间AI 并提问会直接回答", () => {
  assert.deepEqual(decideQqGroupAssistant(signals({
    text: "怎么查成绩",
    mentionsBot: true,
    message: [{ type: "at", data: { qq: BOT } }, text("怎么查成绩")],
  })), { action: "answer", trigger: "mention" });
});

test("只 @ 或只打招呼时先等提问，不把空问题交给模型", () => {
  assert.deepEqual(decideQqGroupAssistant(signals({
    mentionsBot: true,
    message: [{ type: "at", data: { qq: BOT } }],
  })), { action: "summon", trigger: "mention" });
  assert.deepEqual(decideQqGroupAssistant(signals({
    text: "在吗",
    mentionsBot: true,
    message: [{ type: "at", data: { qq: BOT } }, text("在吗")],
  })), { action: "summon", trigger: "mention" });
  assert.deepEqual(decideQqGroupAssistant(signals({
    mentionsBot: true,
    message: [{ type: "at", data: { qq: BOT } }, { type: "face", data: { id: "14" } }],
  })), { action: "summon", trigger: "mention" });
  assert.deepEqual(decideQqGroupAssistant(signals({
    calledByName: true,
    message: [text("拾间AI")],
  })), { action: "summon", trigger: "name" });
});

test("回复别人的消息并 @拾间AI 时回答被引用的内容", () => {
  const message = [{ type: "reply", data: { id: "55" } }, { type: "at", data: { qq: BOT } }];
  assert.deepEqual(decideQqGroupAssistant(signals({
    mentionsBot: true,
    message,
    quoted: "other",
    quotedHasContent: true,
  })), { action: "answer", trigger: "mention" });
  // The quoted message could not be read, so there is still nothing to answer.
  assert.deepEqual(decideQqGroupAssistant(signals({
    mentionsBot: true,
    message,
    quoted: "other",
    quotedHasContent: false,
  })), { action: "summon", trigger: "mention" });
});

test("引用拾间AI的回复继续追问时不需要再 @", () => {
  assert.deepEqual(decideQqGroupAssistant(signals({
    text: "那补考在哪看",
    message: [{ type: "reply", data: { id: "77" } }, text("那补考在哪看")],
    quoted: "bot",
    quotedHasContent: true,
  })), { action: "answer", trigger: "reply-to-bot" });
});

test("连续多轮后，引用和追问不再免 @ 触发，防止与其他机器人互相回复", () => {
  const exhausted = QQBOT_GROUP_IMPLICIT_TURN_LIMIT;
  assert.deepEqual(decideQqGroupAssistant(signals({
    text: "那补考在哪看",
    message: [{ type: "reply", data: { id: "77" } }, text("那补考在哪看")],
    quoted: "bot",
    quotedHasContent: true,
    recentAnswers: exhausted,
  })), { action: "ignore", reason: "not-addressed" });
  assert.deepEqual(decideQqGroupAssistant(signals({ text: "那补考呢", session: "follow-up", recentAnswers: exhausted })), {
    action: "ignore",
    reason: "not-addressed",
  });
  assert.deepEqual(decideQqGroupAssistant(signals({ text: "那补考呢", mentionsBot: true, recentAnswers: exhausted })), {
    action: "answer",
    trigger: "mention",
  });
});

test("统计每位群友最近收到的回答数", () => {
  resetQqGroupAssistantState();
  const now = 3_000_000;
  recordQqGroupAssistantAnswer("g1", "u1", now);
  recordQqGroupAssistantAnswer("g1", "u1", now + 1_000);
  recordQqGroupAssistantAnswer("g1", "u2", now);
  assert.equal(countRecentQqGroupAssistantAnswers("g1", "u1", now + 2_000), 2);
  assert.equal(countRecentQqGroupAssistantAnswers("g2", "u1", now + 2_000), 0);
  assert.equal(countRecentQqGroupAssistantAnswers("g1", "u1", now + QQBOT_GROUP_IMPLICIT_TURN_WINDOW_MS + 500), 1);
});

test("直接叫拾间AI的名字也算在跟它说话", () => {
  assert.deepEqual(decideQqGroupAssistant(signals({ text: "怎么查成绩", calledByName: true })), {
    action: "answer",
    trigger: "name",
  });
});

test("@ 或引用其他群友的消息不会被拾间AI插话，并结束追问", () => {
  for (const input of [
    signals({ text: "明天几点集合？", mentionsOthers: true, session: "follow-up" }),
    signals({ text: "这个怎么弄？", quoted: "other", quotedHasContent: true, session: "follow-up" }),
    signals({ text: "大家明天几点集合？", mentionsOthers: true, collecting: true }),
  ]) {
    assert.deepEqual(decideQqGroupAssistant(input), { action: "ignore", reason: "addressed-to-others" });
  }
});

test("被叫到之后的下一条消息就是问题，可以引用别人的消息或发图", () => {
  assert.deepEqual(decideQqGroupAssistant(signals({ text: "教务系统登不上去", session: "summoned" })), {
    action: "answer",
    trigger: "summoned",
  });
  assert.deepEqual(decideQqGroupAssistant(signals({
    text: "这个",
    message: [{ type: "reply", data: { id: "88" } }, text("这个")],
    quoted: "other",
    quotedHasContent: true,
    session: "summoned",
  })), { action: "answer", trigger: "summoned" });
  assert.deepEqual(decideQqGroupAssistant(signals({
    message: [{ type: "image", data: { file: "a.png" } }],
    session: "summoned",
  })), { action: "answer", trigger: "summoned" });
});

test("回答后同一群友的追问可以不 @，但道谢和闲聊不会触发", () => {
  for (const question of ["那补考呢", "成绩什么时候出", "帮我查下明天的课", "继续"]) {
    assert.deepEqual(decideQqGroupAssistant(signals({ text: question, session: "follow-up" })), {
      action: "answer",
      trigger: "follow-up",
    }, question);
  }
  // Remarks are not answered as follow-ups; at most the group's opt-in
  // proactive check looks at them.
  for (const remark of ["谢谢", "好的", "哈哈哈", "我去吃饭了"]) {
    assert.notEqual(decideQqGroupAssistant(signals({ text: remark, session: "follow-up" })).action, "answer", remark);
  }
  assert.deepEqual(decideQqGroupAssistant(signals({
    text: "这是什么？",
    message: [text("这是什么？"), { type: "image", data: { file: "a.png" } }],
    session: "follow-up",
  })), { action: "ignore", reason: "not-addressed" });
});

test("等待合并的几秒内同一群友的补充会并入同一轮", () => {
  assert.deepEqual(decideQqGroupAssistant(signals({ text: "为什么提示账号登不上去", collecting: true })), {
    action: "answer",
    trigger: "continuation",
  });
});

test("主动回答只考虑没有指向别人的纯文字问题，并受群冷却限制", () => {
  assert.deepEqual(decideQqGroupAssistant(signals({ text: "教务处页面没有反应怎么办？" })), { action: "proactive-candidate" });
  assert.deepEqual(decideQqGroupAssistant(signals({ text: "教务处页面没有反应怎么办？", proactiveCoolingDown: true })), {
    action: "ignore",
    reason: "not-addressed",
  });
  for (const input of [
    signals({ text: "怎么办" }),
    signals({ text: "在吗" }),
    signals({ text: "看看这个怎么办", message: [text("看看这个怎么办"), { type: "image", data: {} }] }),
    signals({ text: "@张三 教务处页面没反应怎么办", mentionsOthers: true }),
  ]) {
    assert.notEqual(decideQqGroupAssistant(input).action, "proactive-candidate", input.text);
  }
});

test("语音、转发、卡片和斜杠命令不进入拾间AI", () => {
  for (const type of ["record", "forward", "json", "video"]) {
    assert.deepEqual(decideQqGroupAssistant(signals({
      text: "看看这个",
      mentionsBot: true,
      message: [{ type: "at", data: { qq: BOT } }, { type, data: {} }],
    })), { action: "ignore", reason: "unsupported" }, type);
  }
  assert.deepEqual(decideQqGroupAssistant(signals({ text: "/帮助", mentionsBot: true })), { action: "ignore", reason: "command" });
});

test("识别结构化消息和 CQ 码里的全部 @ 对象", () => {
  assert.deepEqual(collectQqAtTargets([
    { type: "at", data: { qq: BOT } },
    { type: "at", data: { qq: "all" } },
    text("通知"),
  ]), [BOT, "all"]);
  assert.deepEqual(collectQqAtTargets(`[CQ:reply,id=1][CQ:at,qq=${BOT}] 你好 [CQ:at,qq=20002]`), [BOT, "20002"]);
  assert.deepEqual(collectQqAtTargets("没有 @"), []);
});

test("按名字叫拾间AI：开头称呼、文字 @、请问和句尾称呼", () => {
  const called: Array<[string, string]> = [
    ["拾间AI", ""],
    ["拾间ai，怎么查成绩", "怎么查成绩"],
    ["拾间AI 明天有课吗", "明天有课吗"],
    ["拾间ai怎么查成绩", "怎么查成绩"],
    ["拾间BOT 帮助", "帮助"],
    ["药大拾间·BOT：图书馆几点关门", "图书馆几点关门"],
    ["@拾间AI 怎么查成绩", "怎么查成绩"],
    ["怎么查成绩 @拾间AI", "怎么查成绩"],
    ["请问拾间ai 明天上课吗", "明天上课吗"],
    ["怎么查成绩，拾间ai", "怎么查成绩"],
    ["这个问题问问拾间AI", "这个问题"],
    ["拾间ai你好", "你好"],
  ];
  for (const [input, rest] of called) {
    assert.deepEqual(parseQqBotNameCall(input), { called: true, text: rest }, input);
  }
  for (const input of ["拾间ai挺好用的", "药大拾间真好用", "今天天气不错，拾间ai", "拾间的课表很方便", "我觉得AI挺好"]) {
    assert.equal(parseQqBotNameCall(input).called, false, input);
  }
});

test("追问判断：问句和请求算，道谢和附和不算", () => {
  for (const value of ["那补考呢", "成绩什么时候出", "可以吗", "图书馆在哪", "要带身份证吗", "帮我写个请假条", "再详细说说", "为啥？"]) {
    assert.equal(looksLikeQqGroupFollowUpQuestion(value), true, value);
  }
  for (const value of ["", "嗯", "谢谢", "好的！", "ok", "哈哈哈哈", "收到", "我先去上课了", "[图片]"]) {
    assert.equal(looksLikeQqGroupFollowUpQuestion(value), false, value);
  }
});

test("问题放在被引用的消息前面，没有问题时请模型直接作答", () => {
  const quoted = { messageId: "55", fromBot: false, senderName: "小王", text: "补考报名截止到什么时候？" };
  assert.equal(
    buildQqGroupAssistantQuestion("帮忙回答一下", quoted),
    "【提问】帮忙回答一下\n\n【引用群友「小王」的消息】\n补考报名截止到什么时候？",
  );
  assert.match(buildQqGroupAssistantQuestion("", quoted), /^【提问】请针对下面这条引用消息作答/);
  assert.match(buildQqGroupAssistantQuestion("这里不对", { ...quoted, fromBot: true }), /【引用你之前的回复】/);
  assert.equal(buildQqGroupAssistantQuestion("怎么查成绩", null), "怎么查成绩");
  assert.equal(buildQqGroupAssistantQuestion("怎么查成绩", { ...quoted, text: "" }), "怎么查成绩");
});

test("被叫到和追问窗口按时过期，转向别人时可以提前结束", () => {
  resetQqGroupAssistantState();
  const now = 1_000_000;
  openQqGroupAssistantSession("g1", "u1", "summoned", now);
  assert.equal(readQqGroupAssistantSession("g1", "u1", now + QQBOT_GROUP_SUMMON_WINDOW_MS - 1), "summoned");
  assert.equal(readQqGroupAssistantSession("g1", "u1", now + QQBOT_GROUP_SUMMON_WINDOW_MS), null);
  assert.equal(readQqGroupAssistantSession("g2", "u1", now), null);

  openQqGroupAssistantSession("g1", "u1", "follow-up", now);
  assert.equal(readQqGroupAssistantSession("g1", "u1", now + QQBOT_GROUP_FOLLOW_UP_WINDOW_MS - 1), "follow-up");
  closeQqGroupAssistantSession("g1", "u1");
  assert.equal(readQqGroupAssistantSession("g1", "u1", now), null);
});

test("主动回答之后整个群进入冷却", () => {
  resetQqGroupAssistantState();
  const now = 2_000_000;
  assert.equal(isQqGroupProactiveCoolingDown("g1", now), false);
  markQqGroupProactiveReply("g1", now);
  assert.equal(isQqGroupProactiveCoolingDown("g1", now + QQBOT_GROUP_PROACTIVE_COOLDOWN_MS - 1), true);
  assert.equal(isQqGroupProactiveCoolingDown("g2", now), false);
  assert.equal(isQqGroupProactiveCoolingDown("g1", now + QQBOT_GROUP_PROACTIVE_COOLDOWN_MS), false);
});

test("记住已发出的回答，引用图片回复时能找回原文", () => {
  resetQqGroupAssistantState();
  rememberQqGroupAssistantReply("900", "g1", "成绩在教务系统里查询。", 0);
  assert.equal(lookupQqGroupAssistantReply("900", "g1", 1), "成绩在教务系统里查询。");
  assert.equal(lookupQqGroupAssistantReply("900", "g2", 1), null);
  assert.equal(lookupQqGroupAssistantReply("901", "g1", 1), null);
  assert.equal(lookupQqGroupAssistantReply("900", "g1", 7 * 60 * 60_000), null);
});

test("等待回答时发的催促、问号和道谢不算新问题", () => {
  for (const value of ["？", "？？？", "在吗", "快点", "人呢", "怎么还不回", "为什么不理我", "谢谢", "好的", "你好", "[图片]", ""]) {
    assert.equal(isQqAssistantFillerMessage(value), true, value);
  }
  for (const value of ["对了我是大二的", "补考呢", "那选修课怎么算学分"]) {
    assert.equal(isQqAssistantFillerMessage(value), false, value);
  }
});

test("同一个问题换个标点或大小写仍视为同一问题", () => {
  assert.equal(normalizeQqAssistantQuestionKey("怎么查 GPA？"), normalizeQqAssistantQuestionKey("怎么查gpa"));
  assert.notEqual(normalizeQqAssistantQuestionKey("怎么查成绩"), normalizeQqAssistantQuestionKey("怎么查课表"));
});

test("刚回答过的问题在时间窗口内不再重复回答", () => {
  resetQqGroupAssistantState();
  const now = 4_000_000;
  rememberQqAssistantAnsweredQuestion("u1::g1", "怎么查成绩？", now);
  assert.equal(wasQqAssistantQuestionAnswered("u1::g1", "怎么查成绩", 60_000, now + 30_000), true);
  assert.equal(wasQqAssistantQuestionAnswered("u1::g1", "怎么查成绩", 60_000, now + 60_000), false);
  assert.equal(wasQqAssistantQuestionAnswered("u1::g1", "怎么查课表", 60_000, now + 1), false);
  assert.equal(wasQqAssistantQuestionAnswered("u2::g1", "怎么查成绩", 60_000, now + 1), false);
});
