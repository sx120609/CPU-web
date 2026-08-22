import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  containsQqBotMarkdown,
  normalizeQqBotAiReplyText,
  normalizeQqBotQrLinkMentions,
  renderQqBotMathExpression,
  renderQqBotAiReplyAsQqMessage,
  renderQqBotAiReplyImage,
  splitQqBotLinkUrl,
  wrapQqBotAiTextForLayout,
} from "../src/services/qqbot/aiReplyImage";

test("QQbot Markdown AI 回复会渲染为带拾间AI顶栏的 PNG", () => {
  const reply = [
    "# 登录问题",
    "",
    "**1. 登录入口**",
    "打开 [药大拾间](https://cputime.cn)，然后使用学校统一身份认证登录。",
    "",
    "- 不要使用默认密码",
    "- 遇到锁定请按官方提示处理",
    "",
    "以上回复由拾间AI生成，内容可能存在偏差，请自行鉴别并以官方信息为准。",
  ].join("\n");

  assert.equal(containsQqBotMarkdown(reply), true);
  assert.equal(containsQqBotMarkdown("AUCpo = Dosepo / AUCpo"), true);
  const png = renderQqBotAiReplyImage(reply);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const message = renderQqBotAiReplyAsQqMessage(reply);
  assert.match(message || "", /^\[CQ:image,file=base64:\/\//);
  assert.equal(message?.includes("**1. 登录入口**"), false);
});

test("QQbot 图片复用主站的行内/块级公式识别并渲染公式语义", () => {
  const reply = [
    "药代动力学：$C_{ss} = \\frac{Dose}{AUC}$。",
    "",
    "$$",
    "AUCpo = (Dosepo / AUCpo)",
    "$$",
  ].join("\n");

  assert.equal(containsQqBotMarkdown(reply), true);
  assert.equal(renderQqBotMathExpression("x^2"), "x²");
  assert.match(renderQqBotMathExpression("\\frac{a}{b}"), /a.*b/u);
  assert.match(renderQqBotMathExpression("\\sqrt{x}"), /^√/u);
  assert.equal(
    renderQqBotMathExpression("\\ceR2C = O + H2NNHC6H3(NO2)2− > R2C = NNHC6H3(NO2)2 + H2O").includes("\\ce"),
    false,
  );
  assert.match(
    renderQqBotMathExpression("\\ce{R2C=O + H2NNHC6H3(NO2)2 -> R2C=NNHC6H3(NO2)2 + H2O}"),
    /R₂C.*H₂O/u,
  );
  const png = renderQqBotAiReplyImage(reply, { qrCodeEnabled: false });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("QQbot 图片回复会清理二次转义的控制字符，但保留 LaTeX 命令", () => {
  assert.equal(
    normalizeQqBotAiReplyText("第一段\\n\\n第二段"),
    "第一段\n\n第二段",
  );
  assert.equal(normalizeQqBotAiReplyText("第一段\\r\\n第二段"), "第一段\n第二段");
  assert.equal(normalizeQqBotAiReplyText("first\\nsecond"), "first\nsecond");
  assert.equal(normalizeQqBotAiReplyText("公式：\\nabla \\neq \\theta"), "公式：\\nabla \\neq \\theta");
  assert.equal(normalizeQqBotAiReplyText("编码：\\u4e2d\\u6587"), "编码：中文");
});

test("QQbot 普通短 AI 回复也渲染为图片", () => {
  assert.equal(containsQqBotMarkdown("请打开药大拾间首页。"), false);
  assert.match(
    renderQqBotAiReplyAsQqMessage("请打开药大拾间首页。") || "",
    /^\[CQ:image,file=base64:\/\//,
  );
});

test("QQbot AI 图片把上下文提示放在页脚并为入口生成二维码卡片", () => {
  const options = {
    footerNotice: "提示：当前保留最近两条对话上下文。",
    qrEntries: [{ label: "校园服务", url: "https://cputime.cn/services" }],
  };
  const png = renderQqBotAiReplyImage("可以打开校园服务入口。", options);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const message = renderQqBotAiReplyAsQqMessage("可以打开校园服务入口。", options);
  assert.match(message || "", /^\[CQ:image,file=base64:\/\//);
  // A short answer should not leave a tall empty body or a two-row footer.
  const compactPng = renderQqBotAiReplyImage("可以打开校园服务入口。", {
    footerNotice: options.footerNotice,
  });
  assert.ok(compactPng.readUInt32BE(20) < 360);
});

test("QQbot AI 图片把在线回答页作为唯一二维码目标，即使没有功能入口也生成二维码", () => {
  const png = renderQqBotAiReplyImage("这是一条没有功能入口的普通回答。", {
    sourcePageUrl: "https://cputime.cn/qqbot/ai-reply/abcdefghijklmnop",
  });

  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 900);
  assert.ok(png.readUInt32BE(20) > 350);
});

test("QQbot AI 图片可以按统一开关关闭二维码", () => {
  const png = renderQqBotAiReplyImage("这是一条不需要在线入口的群聊回答。", {
    sourcePageUrl: "https://cputime.cn/qqbot/ai-reply/abcdefghijklmnop",
    qrCodeEnabled: false,
  });

  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.readUInt32BE(20) < 360);
});

test("QQbot 图片会把带二维码入口的链接收敛为入口名称", () => {
  const entries = [{ label: "统一身份认证", url: "https://i.cpu.edu.cn" }];
  assert.equal(
    normalizeQqBotQrLinkMentions("请打开（https://i.cpu.edu.cn）", entries),
    "请打开统一身份认证",
  );
  assert.equal(
    normalizeQqBotQrLinkMentions("[认证入口](https://i.cpu.edu.cn)", entries),
    "认证入口",
  );
});

test("QQbot 图片不会把链接后面的中文正文吞进网站地址", () => {
  assert.deepEqual(
    splitQqBotLinkUrl("https://i.cpu.edu.cn，电话中不要透露密码。若统一身份认证可以正常登录。"),
    {
      url: "https://i.cpu.edu.cn",
      trailing: "，电话中不要透露密码。若统一身份认证可以正常登录。",
    },
  );
});

test("QQbot 图片排版遵守中文标点禁首禁尾规则", () => {
  const lines = wrapQqBotAiTextForLayout("说明文字。注意事项（请先登录）", 70, 28);

  assert.equal(lines.join(""), "说明文字。注意事项（请先登录）");
  const noLineStart = "，。！？；：、）》」』】〕〉》”’)]}>,.!?;:%…％‰";
  const noLineEnd = "（〔［｛《「『【〖〈“‘([{<";
  assert.equal(lines.some((line) => Array.from(noLineStart).some((char) => line.startsWith(char))), false);
  assert.equal(lines.some((line) => Array.from(noLineEnd).some((char) => line.endsWith(char))), false);
});

test("QQbot 图片排版不会把链接分隔符单独放到下一行", () => {
  const lines = wrapQqBotAiTextForLayout("登录入口 i.cpu.edu.cn 现在可用", 110, 28);

  assert.equal(lines.join(""), "登录入口 i.cpu.edu.cn 现在可用");
  assert.equal(lines.some((line) => /^(?:[./_-])/u.test(line)), false);
});

test("QQbot 化学式与长英文不会越过图片右侧安全边距", async () => {
  const reply = [
    "在药学或有机化学语境里，‘布拉迪’通常指布拉迪试剂（Brady’s reagent），也就是 2,4-二硝基苯肼试剂。",
    "",
    "\\ceR2C = O + H2NNHC6H3(NO2)2− > R2C = NNHC6H3(NO2)2 + H2O",
  ].join("\n");
  const png = renderQqBotAiReplyImage(reply, { qrCodeEnabled: false });
  const height = png.readUInt32BE(20);
  const { data, info } = await sharp(png)
    .extract({ left: 860, top: 90, width: 40, height: Math.max(1, height - 138) })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let darkPixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (Math.min(data[offset], data[offset + 1], data[offset + 2]) < 210) darkPixels += 1;
  }
  assert.equal(darkPixels, 0, `expected an empty right safety margin, received ${darkPixels} dark pixels`);
});

test("QQbot 图片完整保留组合 Emoji 并渲染为彩色图形", async () => {
  const emoji = ["😀", "🧑🏽‍💻", "👨‍👩‍👧‍👦", "🇨🇳", "❤️", "1️⃣", "🏳️‍🌈", "🫩"];
  const source = emoji.join("");

  assert.deepEqual(wrapQqBotAiTextForLayout(source, 31, 28), emoji);

  const png = renderQqBotAiReplyImage(source, { qrCodeEnabled: false });
  const { data, info } = await sharp(png)
    .extract({ left: 40, top: 112, width: 820, height: 64 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let chromaticPixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 45) chromaticPixels += 1;
  }
  assert.ok(chromaticPixels > 250, `expected colored Emoji pixels, received ${chromaticPixels}`);
});
