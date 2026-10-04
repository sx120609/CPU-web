import data from "../data/departmentContacts.json";

export type ContactRecord = typeof data.contacts[number];
export type ContactSource = typeof data.sources[number];
export type ContactQuery = {
  q?: string;
  category?: string;
  campus?: string;
  includeSpecial?: boolean;
  offset?: number;
  limit?: number;
};

export function normalizeContactText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s，。！？、：；,!?;:]/gu, "");
}

export function safeContactUrl(value: string) {
  try {
    const url = new URL(value);
    return /^https?:$/u.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function contactTelephoneUrl(value: string) {
  const match = /^(\d{3}-\d{8}|\d{11}|\d{3})(?:转(\d{1,6}))?$/u.exec(value);
  return match ? `tel:${match[1].replace(/-/gu, "")}${match[2] ? `;ext=${match[2]}` : ""}` : null;
}

const INTENTS = [
  { id: "campus-card", pattern: /校园卡|一卡通|卡务|饭卡/u, terms: ["校园卡部", "卡务中心"], campusRequired: true },
  { id: "dorm-repair", pattern: /(?:宿舍|寝室|公寓).*(?:报修|维修|坏|漏水)|(?:报修|维修).*(?:宿舍|寝室|公寓)/u, terms: ["物业服务中心"], campusRequired: true },
  { id: "course-selection", pattern: /选课|退课|补选/u, terms: ["选课其他问题咨询"], campusRequired: false },
  { id: "student-card", pattern: /学生证|乘车区间|火车.*优惠/u, terms: ["学生证"], campusRequired: false },
  { id: "english-exam", pattern: /四六级|四级报名|六级报名/u, terms: ["四六级报名"], campusRequired: false },
  { id: "academic", pattern: /教务|学籍|成绩单|毕业证明|教材/u, terms: ["教务处"], campusRequired: false },
  { id: "campus-network", pattern: /校园网|认证密码|邮箱密码/u, terms: ["网络运维部", "线下一站式服务大厅"], campusRequired: true },
] as const;

const DEPARTMENT_ALIASES: Record<string, string> = {
  招生办: "招生",
  学工处: "学生工作处", 学工: "学生工作处", 校医院: "综合门诊部",
  财务处: "计财处", 财务: "计财处", 信息中心: "信息化建设管理处",
  网络中心: "信息化建设管理处", 党办: "党委办公室", 校办: "校长办公室",
};

function queryIntent(q: string) {
  return INTENTS.find((intent) => intent.pattern.test(q));
}

function searchText(record: ContactRecord) {
  return normalizeContactText([record.id, record.department, record.office, record.purpose, record.category,
    record.address, record.contactName, ...record.phones, ...record.emails].join(" "));
}

function usableDefault(record: ContactRecord) {
  return record.suggestedDefaultDisplay
    && ["office_or_service", "external_public_hotline"].includes(record.recordType)
    && !/冲突|差异待核验/u.test(record.evidenceStatus);
}

export function presentContact(record: ContactRecord) {
  const sources = record.sourceIds.map((id) => data.sources.find((source) => source.sourceId === id))
    .filter((source): source is ContactSource => Boolean(source))
    .map((source) => ({ ...source, url: safeContactUrl(source.url) }));
  const warnings: string[] = [];
  if (/冲突|差异待核验/u.test(record.evidenceStatus) || record.recordType === "official_conflict") warnings.push("来源冲突，待单位确认");
  if (/holiday|seasonal/u.test(record.recordType) || /季节性|限定日期/u.test(record.evidenceStatus)) warnings.push("季节性或专项资料，当前适用性待核实");
  if (record.recordType === "recruitment_contact") warnings.push("仅限人才招聘，不能作为学生事务电话");
  if (/较早/u.test(record.evidenceStatus)) warnings.push("较早资料，使用前请核实");
  if (!record.suggestedDefaultDisplay && !warnings.length) warnings.push("编者建议人工审查，使用前请核实");
  if (record.sourceDate && Date.now() - Date.parse(record.sourceDate) > 2 * 365.25 * 86400000
    && !warnings.some((warning) => warning.includes("较早"))) warnings.push("来源超过两年，使用前请核实");
  return {
    ...record,
    sourceUrls: record.sourceUrls.map(safeContactUrl).filter((url): url is string => Boolean(url)),
    onlineUrl: safeContactUrl(record.onlineUrl),
    sources,
    warnings,
    status: warnings.length ? "待核实" : "公开资料 · 未拨测",
    phones: record.phones.map((number) => ({ number, dialUrl: contactTelephoneUrl(number) })),
    detailUrl: `/services/tools/department_contacts?id=${encodeURIComponent(record.id)}`,
  };
}

export function getDepartmentContact(id: string) {
  const record = data.contacts.find((contact) => contact.id === id);
  return record ? presentContact(record) : null;
}

export function isExactDepartmentContactQuery(q: string) {
  const value = normalizeContactText(q);
  return Boolean(value) && data.contacts.some((r) => [r.department, r.office, ...r.phones, r.id]
    .some((text) => normalizeContactText(text) === value));
}

export function queryDepartmentContacts(input: ContactQuery = {}) {
  const rawQuery = String(input.q || "").slice(0, 160);
  const q = normalizeContactText(String(input.q || "").slice(0, 160));
  const intent = queryIntent(q);
  const campus = input.campus || ["玄武门", "江宁", "江北"].find((value) => q.includes(value)) || "";
  const academicTopic = ["学籍", "成绩单", "毕业证明", "教材"].find((topic) => q.includes(topic));
  const studentTypeKnown = /本科|研究生/u.test(q);
  const genericAcademic = intent?.id === "academic" && !academicTopic;
  let core = q.replace(/(?:请问|请帮我|帮我|我想|我要|怎么联系|联系谁|联系方式|咨询电话|电话号码|电话|联系|部门|找谁|查询|搜索|江宁|玄武门|江北)/gu, "");
  for (const [alias, department] of Object.entries(DEPARTMENT_ALIASES).sort(([a], [b]) => b.length - a.length)) core = core.replaceAll(alias, department);
  let words = rawQuery.replace(/(?:请问|请帮我|我想(?:问|咨询|了解)?|想问|咨询一下|怎么联系|联系谁|联系方式|查询电话|电话号码|电话|联系|多少|找谁|咨询|补办|办理|校区|江宁|玄武门|江北|该找|哪里|哪个|什么|呢|吗|那|的)/gu, " ");
  for (const [alias, department] of Object.entries(DEPARTMENT_ALIASES).sort(([a], [b]) => b.length - a.length)) words = words.replaceAll(alias, department);
  const namedTerms = [...new Set(data.contacts.flatMap((record) => [record.department, record.office]))]
    .map(normalizeContactText).filter((term) => term.length >= 3 && !["办公室", "服务中心", "招生", "教务处"].includes(term)
      && core.includes(term));
  for (const term of [...namedTerms].sort((a, b) => b.length - a.length)) words = words.replaceAll(term, ` ${term} `);
  const tokens = words.split(/[\s,，。?？\/|、+]+/u).map(normalizeContactText).filter(Boolean);
  const businessTokens = tokens.filter((token) => !namedTerms.includes(token));
  const terms = [...new Set([...tokens, ...namedTerms])];
  const relevance = (record: ContactRecord) => terms.reduce((score, term) => {
    const department = normalizeContactText(record.department), office = normalizeContactText(record.office);
    return score + (department === term || office === term ? 100 : department.includes(term) ? 60 : office.includes(term) ? 45
      : normalizeContactText(record.purpose).includes(term) ? 25 : searchText(record).includes(term) ? 10 : 0);
  }, 0);
  const matches = data.contacts.filter((record) => {
    if (!record.contactFieldsPubliclyPublished) return false;
    if (input.category && record.category !== input.category) return false;
    if (campus && record.campus !== campus) return false;
    if (!q) return true;
    const text = searchText(record);
    if (intent) {
      if (namedTerms.length && !namedTerms.some((term) => text.includes(term))) return false;
      if (/研究生/u.test(q) && ["academic", "course-selection", "student-card"].includes(intent.id)) {
        const scope = normalizeContactText(record.office + record.purpose);
        const topic = academicTopic || (intent.id === "course-selection" ? "选课" : intent.id === "student-card" ? "学生证" : "教务");
        return /研究生院/u.test(record.department) && scope.includes(topic);
      }
      if (intent.id === "academic" && academicTopic) return record.department === "教务处"
        && normalizeContactText(record.office + record.purpose).includes(academicTopic);
      return intent.terms.some((term) => text.includes(normalizeContactText(term)));
    }
    return namedTerms.length ? namedTerms.some((term) => text.includes(term)) && businessTokens.every((token) => text.includes(token))
      : tokens.length > 0 && tokens.every((token) => text.includes(token));
  });
  const eligible = matches.filter((record) => input.includeSpecial || usableDefault(record));
  eligible.sort((a, b) => relevance(b) - relevance(a) || Number(usableDefault(b)) - Number(usableDefault(a))
    || Number(b.priority === "高频") - Number(a.priority === "高频")
    || a.id.localeCompare(b.id));
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit || 20)));
  const offset = Math.max(0, Math.floor(input.offset || 0));
  let clarification: string | null = null;
  if (intent?.campusRequired && !campus) clarification = "你在江宁、玄武门还是江北校区？";
  else if (intent?.id === "academic" && academicTopic && !studentTypeKnown) clarification = "你是本科生还是研究生？请先确认学生类型，再查询这项教务业务的公开窗口。";
  else if (genericAcademic) clarification = "你是本科生还是研究生？需要办理选课、学生证、四六级报名，还是学籍、成绩或毕业事务？当前资料只覆盖部分窗口。";
  else if (q && !intent && new Set(eligible.map((record) => record.department)).size > 1 && /招生|学生|办公室/u.test(core)) {
    clarification = "请补充具体部门、学生类型或业务，避免把不同窗口的号码混用。";
  }
  const gapTerms = [...(intent?.id === "academic" ? ["教务处", "研究生院"] : intent?.terms ?? tokens),
    ...Object.keys(DEPARTMENT_ALIASES).filter((alias) => q.includes(alias))];
  const gaps = q ? data.gaps.filter((gap) => gapTerms.some((term) =>
    normalizeContactText(gap.unit).includes(normalizeContactText(term))
    || normalizeContactText(term).includes(normalizeContactText(gap.unit))))
    .map((gap) => ({ ...gap, url: safeContactUrl(gap.url) })) : [];
  return {
    query: input.q || "", intent: (intent?.id || null) as string | null, campus, clarification,
    total: eligible.length, offset, limit,
    hiddenSpecialCount: matches.length - eligible.length,
    contacts: eligible.slice(offset, offset + limit).map((record) => ({ ...presentContact(record), relevanceScore: relevance(record) })),
    gaps,
    categories: [...new Set(data.contacts.map((record) => record.category))],
    campuses: [...new Set(data.contacts.map((record) => record.campus).filter(Boolean))],
    meta: { ...data.meta, actualRecordCount: data.contacts.length, actualSourceCount: data.sources.length,
      actualGapCount: data.gaps.length },
  };
}

/** A bounded, read-only tool shared by the HTTP page and both assistant transports. */
export const departmentContactsTool = {
  name: "query_department_contacts",
  description: "查询公开部门联系资料；号码只用于来源规定的业务；不能自动拨号或发邮件。",
  execute: queryDepartmentContacts,
};
