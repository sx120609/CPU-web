#!/usr/bin/env node
// 校园网认证协议的断言。跑之前要先 npm run build。
//
//   node scripts/campus-net-test.cjs
//
// 这是从 C# 移植过来的协议，参数顺序、预编码的 %2C、重复的 lang 都是照抄上游的，
// 看起来像笔误的地方其实不能"顺手整理"。改错了不会报错，只会认证失败。

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dist = path.join(__dirname, "..", "dist", "electron", "campus-net");
let protocol;
let schedule;
try {
  protocol = require(path.join(dist, "protocol.js"));
  schedule = require(path.join(dist, "schedule.js"));
} catch (error) {
  console.error("找不到编译产物，请先执行 npm run build。");
  console.error(error.message);
  process.exit(1);
}

const { buildLoginUrl, parseJsonp, parseLoginResponse, redactUrl, resolveMode, isValidStudentId } = protocol;
const { configuredIntervalMs, healthyProbeDelayMs, retryBackoffDelayMs } = schedule;
const serviceSource = fs.readFileSync(path.join(__dirname, "..", "electron", "campus-net", "service.ts"), "utf8");
const HINTS = ["密码", "账号", "欠费"];

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}\n  ${error.message.split("\n")[0]}`);
  }
};

/* ------------------------------------------------------------ URL 拼接 */

const base = { studentId: "2021000000", password: "abc123", carrier: "", wlanUserIp: "10.12.1.2" };

check("校园网模式：账号不带运营商后缀，参数顺序固定", () => {
  const url = buildLoginUrl({ ...base, mode: "campus" });
  assert.ok(url.startsWith("http://192.168.199.21:801/eportal/?c=Portal&a=login&callback=dr1004&login_method=1&"));
  assert.ok(url.includes("user_account=%2C0%2C2021000000&"), "账号段必须是预编码的 %2C0%2C 且无后缀");
  assert.ok(url.includes("wlan_user_mac=000000000000"));
  assert.ok(url.endsWith("jsVersion=3.3.3&v=1954"));
});

check("宽带模式：账号带运营商后缀，尾部参数与校园网不同", () => {
  const url = buildLoginUrl({ ...base, mode: "pppoe", carrier: "telecom" });
  assert.ok(url.startsWith("http://172.17.253.3:801/eportal/portal/login?callback=dr1004&login_method=1&"));
  assert.ok(url.includes("user_account=%2C0%2C2021000000%40telecom&"));
  // lang 确实出现两次，是上游的样子，不要去重
  assert.ok(url.endsWith("jsVersion=4.2.2&terminal_type=1&lang=zh-cn&v=9745&lang=zh"));
});

check("三家运营商后缀都对", () => {
  for (const [carrier, suffix] of [["cmcc", "%40cmcc"], ["unicom", "%40unicom"], ["telecom", "%40telecom"]]) {
    const url = buildLoginUrl({ ...base, mode: "pppoe", carrier });
    assert.ok(url.includes(`user_account=%2C0%2C2021000000${suffix}&`), `${carrier} 后缀不对`);
  }
});

check("账号段绝不能被二次编码", () => {
  const url = buildLoginUrl({ ...base, mode: "campus" });
  assert.ok(!url.includes("%252C"), "%2C 被二次编码成了 %252C");
  assert.ok(!url.includes("%2540"), "%40 被二次编码成了 %2540");
});

check("密码做 URL 编码（上游的 bug，这里修掉）", () => {
  const url = buildLoginUrl({ ...base, mode: "campus", password: "a&b=c d#e+f%g" });
  assert.ok(url.includes("user_password=a%26b%3Dc%20d%23e%2Bf%25g&"));
  // 编码后不能把后面的参数挤掉
  assert.ok(url.includes("&wlan_user_ip=10.12.1.2"));
});

check("纯字母数字密码编码前后字节不变", () => {
  assert.ok(buildLoginUrl({ ...base, mode: "campus" }).includes("user_password=abc123&"));
});

check("AC 参数默认为空，可覆盖", () => {
  assert.ok(buildLoginUrl({ ...base, mode: "campus" }).includes("wlan_ac_ip=&wlan_ac_name=&"));
  const custom = buildLoginUrl({ ...base, mode: "campus", wlanAcIp: "1.2.3.4", wlanAcName: "AC01" });
  assert.ok(custom.includes("wlan_ac_ip=1.2.3.4&wlan_ac_name=AC01&"));
});

/* -------------------------------------------------------------- 脱敏 */

check("日志脱敏必须抹掉密码且只抹密码", () => {
  const url = buildLoginUrl({ ...base, mode: "campus", password: "s3cr3t!" });
  const safe = redactUrl(url);
  assert.ok(!safe.includes("s3cr3t"), "脱敏后仍能看到密码");
  assert.ok(safe.includes("user_password=***"));
  assert.ok(safe.includes("user_account=%2C0%2C2021000000"), "学号不该被抹掉，排障要用");
});

/* -------------------------------------------------------- JSONP 解析 */

check("两种外壳都能剥（chkstatus 无分号，login 有）", () => {
  assert.deepEqual(parseJsonp('dr1002({"ss5":"10.12.1.2"})'), { ss5: "10.12.1.2" });
  assert.deepEqual(parseJsonp('dr1004({"result":1});'), { result: 1 });
  assert.deepEqual(parseJsonp('  dr1004({"result":1}) ;  '), { result: 1 });
});

check("坏输入返回 undefined 而不是抛异常", () => {
  for (const raw of ["", "not jsonp", "dr1004(", "dr1004(bad json)", "()"]) {
    assert.equal(parseJsonp(raw), undefined, `应当返回 undefined：${raw}`);
  }
});

check("含中文空格的 msg 不被破坏", () => {
  // 原版用 Replace(" ","") 剥壳，会把 msg 里的空格一起吃掉
  const parsed = parseJsonp('dr1004({"result":0,"msg":"AC 认证 失败"});');
  assert.equal(parsed.msg, "AC 认证 失败");
});

/* -------------------------------------------------------- 响应判定 */

check("result=1 是成功", () => {
  const r = parseLoginResponse('dr1004({"result":1,"msg":""});', HINTS);
  assert.equal(r.ok, true);
  assert.equal(r.alreadyOnline, false);
});

check("result=0 且 ret_code=2 视为已在线（成功）", () => {
  const r = parseLoginResponse('dr1004({"result":0,"ret_code":2,"msg":"已经在线"});', HINTS);
  assert.equal(r.ok, true);
  assert.equal(r.alreadyOnline, true);
});

check("其他失败透传服务端原文", () => {
  const r = parseLoginResponse('dr1004({"result":0,"ret_code":1,"msg":"AC认证失败"});', HINTS);
  assert.equal(r.ok, false);
  assert.equal(r.message, "AC认证失败");
  assert.equal(r.fatal, false, "AC 失败是可重试的，不该熔断");
});

check("凭据类错误标记为 fatal，立刻停止自动重试", () => {
  for (const msg of ["密码错误", "账号不存在", "您已欠费"]) {
    const r = parseLoginResponse(`dr1004({"result":0,"ret_code":1,"msg":"${msg}"});`, HINTS);
    assert.equal(r.ok, false);
    assert.equal(r.fatal, true, `${msg} 应当判为不可恢复`);
  }
});

check("空响应判为网络错误而不是崩溃", () => {
  const r = parseLoginResponse("", HINTS);
  assert.equal(r.ok, false);
  assert.equal(r.message, "网络错误");
});

/* -------------------------------------------------------- 模式判定 */

check("手动指定的模式不被 IP 覆盖", () => {
  assert.equal(resolveMode("campus", "192.168.1.5"), "campus");
  assert.equal(resolveMode("pppoe", "10.31.1.5"), "pppoe");
});

check("auto 模式按 IP 段判定（照抄上游规则）", () => {
  assert.equal(resolveMode("auto", "192.168.1.5"), "pppoe");
  assert.equal(resolveMode("auto", "10.12.3.4"), "pppoe");
  assert.equal(resolveMode("auto", "10.31.3.4"), "pppoe");
  assert.equal(resolveMode("auto", "10.33.3.4"), "pppoe");
  assert.equal(resolveMode("auto", "10.99.3.4"), "campus");
  assert.equal(resolveMode("auto", "172.17.1.1"), "campus");
});

check("auto 模式遇到畸形 IP 不越界（上游会抛异常）", () => {
  assert.equal(resolveMode("auto", ""), "campus");
  assert.equal(resolveMode("auto", "10.12"), "campus");
});

check("IP 启发式本身判不出「不在校园网」——所以必须有网关探测兜底", () => {
  // 这三个都是校外地址（家用 NAT、VPN 隧道、手机热点），
  // 但 resolveMode 只会在两种校内接入方式之间二选一，永远不会说"不在校园网"。
  // 单靠它就会在校外反复去撞根本不存在的网关，这正是 environment.ts 存在的理由。
  for (const ip of ["198.18.0.1", "172.20.10.3", "100.64.1.2"]) {
    assert.ok(["campus", "pppoe"].includes(resolveMode("auto", ip)), `${ip} 仍被判成某种校内接入`);
  }
});

/* -------------------------------------------------------- 检测调度 */

check("稳定在线后至少 30 秒再探测，降低后台网络唤醒", () => {
  assert.equal(healthyProbeDelayMs(5), 30_000);
  assert.equal(healthyProbeDelayMs(15), 30_000);
  assert.equal(healthyProbeDelayMs(45), 45_000, "用户主动设置的更长间隔应当保留");
});

check("掉线重连仍按用户基础间隔执行并限制在安全范围内", () => {
  assert.equal(configuredIntervalMs(1), 5_000);
  assert.equal(configuredIntervalMs(15), 15_000);
  assert.equal(configuredIntervalMs(900), 600_000);
});

check("临时认证失败持续退避重试，不会在第 5 次后永久停止", () => {
  assert.equal(retryBackoffDelayMs(15, 1), 30_000);
  assert.equal(retryBackoffDelayMs(15, 4), 240_000);
  assert.equal(retryBackoffDelayMs(15, 5), 300_000, "第 5 次失败后应进入低频重试");
  assert.equal(retryBackoffDelayMs(15, 100), 300_000, "长期维护期间仍应每 5 分钟探测");
});

check("启动日志写入客户端版本和临时故障重试策略，便于排除旧进程", () => {
  assert.match(serviceSource, /客户端 v\$\{app\.getVersion\(\)\}/);
  assert.match(serviceSource, /临时认证故障会持续低频重试/);
});

/* -------------------------------------------------------- 学号校验 */

check("学号只接受字母数字（上游只在键入时过滤，粘贴可绕过）", () => {
  assert.equal(isValidStudentId("2021000000"), true);
  assert.equal(isValidStudentId(" 2021000000 "), true, "应当先 trim");
  for (const bad of ["", "2021 000", "2021&x=1", "2021-01", "学号"]) {
    assert.equal(isValidStudentId(bad), false, `应当拒绝：${bad}`);
  }
});

console.log(`\n${passed} 项通过，${failed} 项失败。`);
process.exit(failed === 0 ? 0 : 1);
