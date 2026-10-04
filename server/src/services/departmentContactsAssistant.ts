import { departmentContactsTool, normalizeContactText } from "./departmentContacts";
import type { CampusAssistantMessage, CampusAssistantResponse } from "./campusAssistant";

export function isDepartmentContactRequest(message: string) {
  return /电话|联系方式|通讯录|部门联系/u.test(message) || /(?:部门|教务|校园卡|一卡通|卡务|饭卡|宿舍|寝室|公寓|报修|学生证|四六级|选课|校园网|图书馆|招生|后勤|办公室|学院|学籍|成绩单|毕业证明).*(?:电话|联系|咨询|找谁|找哪个|补办|丢|坏|报修|维修)|(?:电话|联系|咨询|找谁|找哪个|补办|报修|维修).*(?:部门|教务|校园卡|一卡通|宿舍|寝室|公寓|学生证|选课|图书馆|招生|后勤|办公室|学院)|^(?:部门联系|通讯录|补办校园卡|宿舍报修|教务咨询)$/u.test(message);
}

function resolveContactMessage(message: string, history: CampusAssistantMessage[]) {
  if (isDepartmentContactRequest(message)) return message;
  // Only carry a short answer forward if the immediately preceding assistant
  // actually asked a directory clarification. Other conversations stay intact.
  const last = history.at(-1);
  if (!last || last.role !== "assistant" || !last.content.includes("部门联系")
    || !/校区|本科生|研究生|具体部门|具体业务/u.test(last.content)
    || !/^(?:我在|我是|在)?(?:(?:本科生?|研究生)[，,\s]*)?(?:江宁|玄武门|江北|本科生?|研究生|选课|学生证|四六级|学籍|成绩单|毕业证明|教材)(?:校区|的|，|,|咨询|补办|问题|电话|\s)*$/u.test(message.trim())) return null;
  const earlier = [...history].reverse().find((entry) => entry.role === "user" && isDepartmentContactRequest(entry.content));
  return earlier ? `${earlier.content} ${message}` : null;
}

export function answerDepartmentContactRequest(
  message: string, history: CampusAssistantMessage[] = [],
): CampusAssistantResponse | null {
  const resolved = resolveContactMessage(message, history);
  if (!resolved) return null;
  const result = departmentContactsTool.execute({ q: resolved, limit: 3 });
  const toolUrl = `/services/tools/department_contacts?q=${encodeURIComponent(resolved.slice(0, 160))}`;
  const action = { id: "department-contacts", label: "部门联系", description: "查看业务范围、公开来源及待核实说明",
    url: toolUrl, icon: "phone", owner: "校园小工具", requireLogin: false };
  const base = { actions: [action], fallback: false, suggestions: [] as string[] };
  if (result.clarification) {
    return { ...base, answer: `部门联系：${result.clarification} 我会按具体窗口查询，不把专项电话当成通用总机。`,
      suggestions: result.intent === "academic" ? ["本科生选课咨询电话", "学生证补办咨询电话", "研究生教务咨询电话"]
        : ["江宁校区", "玄武门校区", "江北校区"] };
  }
  if (!result.contacts.length) {
    const gaps = result.gaps.map((gap) => `${gap.unit}：${gap.finding} ${gap.action}`).join("\n");
    return { ...base, answer: `部门联系：当前公开资料没有找到能明确适用于这项业务的号码。请补充部门、校区或具体业务。${gaps ? `\n${gaps}` : ""}${result.hiddenSpecialCount ? "\n存在历史或专项记录，当前适用性待核实；可在工具中主动查看。" : ""}`,
      sources: result.gaps.filter((gap) => gap.url).slice(0, 5).map((gap) => ({ title: gap.unit, url: gap.url! })) };
  }
  const answer = ["部门联系（公开资料汇编，未经电话拨测；编者标记不代表学校认证）：",
    ...result.contacts.map((contact) => {
      const sources = contact.sources.filter((source) => source.url);
      return `- ${contact.department} · ${contact.office}（${contact.campus || "来源未注明校区"}）\n业务范围：${contact.purpose}\n电话：${contact.phones.map((phone) => phone.number).join("、") || "来源未列电话"}${contact.emails.length ? `；公开邮箱：${contact.emails.join("、")}` : ""}\n${contact.warnings.join("；") || contact.status}${contact.note ? `。说明：${contact.note}` : ""}\n来源发布：${contact.sourceDate || "未标日期"}；资料核对：${contact.checkedAt}\n${sources.map((source) => `来源：[${source.title}](${source.url})`).join("\n")}\n[查看工具详情](${contact.detailUrl})`;
    })].join("\n\n");
  const sources = [...new Map(result.contacts.flatMap((contact) => contact.sources)
    .filter((source) => source.url).map((source) => [source.url, { title: source.title, url: source.url! }])).values()].slice(0, 5);
  return { ...base, answer, sources,
    actions: result.contacts.map((contact) => ({ ...action, id: `department-contact-${contact.id}`,
      label: `${contact.department} · ${contact.office}`, url: contact.detailUrl })),
    suggestions: normalizeContactText(resolved).includes("校园卡") ? ["打开部门联系工具"] : [] };
}
