/**
 * 拾间AI 检索共用的文字处理和打分：中文按字二元组、英文数字按整词，idf 加权。
 * 学校文件、论坛帖子和公告三类语料都用这里的函数，各自只决定先验权重（时效、可信度）。
 */

const MAX_QUERY_TERMS = 30;
const RARE_TERM_DOCUMENTS = 2;
const PARTICLE_CHARS = new Set("的了吗呢啊呀吧嘛哦哈么噢喔哇");
// 虚词当作分隔：“在共识期刊目录里是什么级别”只切“共识期刊目录”“什么级别”，
// 不产生“在共”“录里”“里是”这类跨词的二元组。只影响查询词，正文照常整段匹配。
const SEPARATOR_CHARS = /[在是里和与把被给向往于及或也都还就才又很太更最我你他她它们吗呢啊呀吧嘛哦哈么噢喔哇的了哪些什怎需要]/u;
// 学生的问法和学校文件的写法对不上时（“时间节点”对“工作日程”），把问法换成一组同义词，
// 命中其中任意一个就算命中。组在查询词里写成“甲|乙|丙”。
const QUERY_SYNONYMS: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /时间节点|时间安排|时间线|时间表|什么时候|啥时候|几月几号|几号|哪天|截止时间|截止日期/gu, terms: ["日程", "时间", "截止", "日期", "安排"] },
  { pattern: /流程|步骤|手续|怎么办理|如何办理|怎么申请|如何申请/gu, terms: ["程序", "流程", "步骤", "办理", "手续"] },
  { pattern: /条件|资格|门槛/gu, terms: ["条件", "资格", "要求"] },
  { pattern: /材料|交什么|提交什么/gu, terms: ["材料", "提交", "附件"] },
  // 也切开“硕士学费”这类连写：否则“士学”会去匹配制度里到处都有的“硕士学位”“学士学位”。
  { pattern: /学费|收费标准|收费/gu, terms: ["学费", "收费"] },
  // “处分多久能解除”切出的“分多”“能解”会拉低覆盖率，整段换成期限类说法。
  { pattern: /多长时间|多久|多长|期限|有效期/gu, terms: ["期限", "时间", "多久"] },
  // “我是2021级”：年份另作一个词；“级”匹配过渡条款的区间写法（“2020级至2022级”
  // “2024级及之前”“从2025级起”），原文里往往没有用户那一年。
  { pattern: /(?<=\d)\s*级/gu, terms: ["级至", "级及之前", "级及以前", "级及以后", "级以后", "级起", "级开始", "级入学"] },
];
// 问“按哪个文件”“依据什么”的问法词：切成“个文”“金按”这类碎片只会稀释覆盖率。
const QUERY_NOISE = /按照?哪(?:个|份|一个|一份|种|条|版)?(?:文件|规定|办法|版本)?|哪(?:个|份|一个|一份|版)(?:文件|规定|办法|版本)?|依据什么|根据什么/gu;
const SYNONYM_MARKER_BASE = 0xe000;
const STOP_BIGRAMS = new Set([
  "请问", "有没", "没有", "有人", "人知", "知道", "谁知", "怎么", "么办", "什么", "为什", "如何", "可以", "能不",
  "不能", "大家", "各位", "同学", "学长", "学姐", "一下", "这个", "那个", "我们", "你们", "他们", "自己", "现在",
  "时候", "是不", "不是", "是否", "求助", "求问", "谢谢", "感谢", "一个", "有个", "想问", "问一", "问下", "一般",
  "应该", "需要", "可能", "还是", "或者", "但是", "因为", "所以", "如果", "就是", "然后", "已经", "东西", "问题",
  "情况", "怎样", "哪里", "哪个", "哪些", "多少", "有点", "比较", "真的", "其实", "觉得", "感觉", "请教", "帮忙",
  "麻烦", "急急", "大佬", "宝子", "家人", "姐妹", "兄弟", "有无", "能否", "可否", "会不", "不会", "要不", "不要",
]);

/** NFKC 统一全角半角，小写，空白折叠，便于子串匹配。 */
export function normalizeKnowledgeText(value: string) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Markdown/HTML 转成可读的纯文本：去图片、视频、代码围栏标记和链接地址，保留链接文字。 */
export function knowledgePlainText(value: string) {
  return String(value || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/<(?:img|video|source|iframe)\b[^>]*>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/```[a-z]*|~~~/giu, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gmu, "")
    .replace(/[*_~`|]+/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/[ \t　]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}

/**
 * 查询词：中文连续段切成二元组（去掉语气词和“请问、怎么”这类通用词），
 * 英文和数字按整词。顺序保留，越靠前越重要（标题在前）。
 */
export function extractKnowledgeQueryTerms(value: string, limit = MAX_QUERY_TERMS) {
  let text = normalizeKnowledgeText(value).replace(/[\uE000-\uE0FF]/gu, " ").replace(QUERY_NOISE, " ");
  QUERY_SYNONYMS.forEach((synonym, index) => {
    text = text.replace(synonym.pattern, ` ${String.fromCharCode(SYNONYM_MARKER_BASE + index)} `);
  });
  const terms: string[] = [];
  const seen = new Set<string>();
  const push = (term: string) => {
    if (seen.has(term) || terms.length >= limit) return;
    seen.add(term);
    terms.push(term);
  };
  for (const match of text.matchAll(/[\uE000-\uE0FF]|[\u3400-\u9fff]+|[a-z0-9]+(?:[.+#][a-z0-9]+)*/gu)) {
    const run = match[0];
    const synonym = QUERY_SYNONYMS[run.charCodeAt(0) - SYNONYM_MARKER_BASE];
    if (run.length === 1 && synonym) {
      push(synonym.terms.join("|"));
      continue;
    }
    if (/^[a-z0-9]/u.test(run)) {
      if (/^\d+$/u.test(run) ? run.length >= 3 : run.length >= 2) push(run);
      continue;
    }
    for (const segment of run.split(SEPARATOR_CHARS)) {
      const chars = Array.from(segment);
      for (let index = 0; index + 1 < chars.length; index += 1) {
        if (PARTICLE_CHARS.has(chars[index]) || PARTICLE_CHARS.has(chars[index + 1])) continue;
        const bigram = chars[index] + chars[index + 1];
        if (!STOP_BIGRAMS.has(bigram)) push(bigram);
      }
    }
  }
  return terms;
}

export type KnowledgeIndexEntry = {
  /** 标题（含小标题路径），命中加权。 */
  titleKey: string;
  /** 参与匹配的全部文字，应包含 titleKey。 */
  bodyKey: string;
};

export type RankedKnowledgeEntry<T> = { entry: T; coverage: number; rank: number };

export type KnowledgeTermStats = { total: number; frequency: number[] };

/** 每个查询词在多少条目里出现，供 rankKnowledgeEntries 的 corpusStats 复用。 */
export function knowledgeTermStats(entries: Iterable<KnowledgeIndexEntry>, terms: string[]): KnowledgeTermStats {
  const alternatives = terms.slice(0, MAX_QUERY_TERMS).map((term) => term.split("|"));
  const frequency = new Array<number>(alternatives.length).fill(0);
  let total = 0;
  for (const entry of entries) {
    total += 1;
    alternatives.forEach((group, index) => { if (group.some((term) => entry.bodyKey.includes(term))) frequency[index] += 1; });
  }
  return { total, frequency };
}

/**
 * 命中覆盖率 = 命中词的 idf 加权和 / 全部查询词的 idf 加权和；标题命中额外加分，
 * 再乘调用方给的先验（时效、可信度、回复数）。覆盖率不够或只命中一个词的不要。
 */
export function rankKnowledgeEntries<T extends KnowledgeIndexEntry>(
  entries: Iterable<T>,
  terms: string[],
  options: {
    allow?: (entry: T) => boolean;
    /** 用 knowledgeTermStats 预先算好的全库词频，而不是 entries 自己的：在一份文件里挑
     * 条款时，文件内只出现一两次的词正是区分条款的词，不能按“偶然出现”压低。 */
    corpusStats?: KnowledgeTermStats;
    prior?: (entry: T) => number;
    minCoverage: number;
    limit: number;
  },
): RankedKnowledgeEntry<T>[] {
  const count = Math.min(terms.length, MAX_QUERY_TERMS);
  // 同义词组“甲|乙”命中任意一个即可。
  const alternatives = terms.slice(0, count).map((term) => term.split("|"));
  const contains = (text: string, index: number) => alternatives[index].some((term) => text.includes(term));
  if (!count) return [];
  const documentFrequency = new Array<number>(count).fill(0);
  const hits: Array<{ entry: T; textMask: number; titleMask: number }> = [];
  let total = 0;
  for (const entry of entries) {
    total += 1;
    if (options.allow && !options.allow(entry)) continue;
    let textMask = 0;
    let titleMask = 0;
    for (let index = 0; index < count; index += 1) {
      if (!contains(entry.bodyKey, index)) continue;
      textMask |= 1 << index;
      documentFrequency[index] += 1;
      if (contains(entry.titleKey, index)) titleMask |= 1 << index;
    }
    if (textMask) hits.push({ entry, textMask, titleMask });
  }
  if (!hits.length) return [];
  if (options.corpusStats) {
    total = options.corpusStats.total;
    options.corpusStats.frequency.slice(0, count).forEach((frequency, index) => { documentFrequency[index] = frequency; });
  }
  // 越靠前的词（标题、问题本身）权重越高，后面的正文细节只作补充。
  const weights = Array.from({ length: count }, (_, index) => 1 / (1 + index / 12));
  const rawIdf = (frequency: number) => Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5));
  const commonIdf = documentFrequency
    .filter((frequency) => frequency > RARE_TERM_DOCUMENTS)
    .map(rawIdf);
  const meanCommonIdf = commonIdf.length
    ? commonIdf.reduce((sum, value) => sum + value, 0) / commonIdf.length
    : rawIdf(RARE_TERM_DOCUMENTS + 1);
  // 语料里没有或只偶然出现一两次的二元组多半跨了词（“舍报”“师需”“要走”），
  // 按普通词的分量算，不能按最大 idf 把真正相关的段落压下去；真缺关键词时覆盖率照样会降。
  const idf = documentFrequency.map((frequency) => frequency > RARE_TERM_DOCUMENTS
    ? rawIdf(frequency)
    : 0.75 * meanCommonIdf);
  const totalWeight = idf.reduce((sum, value, index) => sum + value * weights[index], 0) || 1;
  const minTerms = Math.min(2, count);
  return hits
    .map(({ entry, textMask, titleMask }) => {
      let matched = 0;
      let titleMatched = 0;
      let matchedTerms = 0;
      for (let index = 0; index < count; index += 1) {
        if (!(textMask & (1 << index))) continue;
        matchedTerms += 1;
        matched += idf[index] * weights[index];
        if (titleMask & (1 << index)) titleMatched += idf[index] * weights[index];
      }
      const coverage = matched / totalWeight;
      const rank = coverage * (1 + 0.6 * (titleMatched / totalWeight)) * (options.prior ? options.prior(entry) : 1);
      return { entry, coverage, rank, matchedTerms };
    })
    .filter((item) => item.coverage >= options.minCoverage && item.matchedTerms >= minTerms)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, Math.max(1, options.limit))
    .map(({ entry, coverage, rank }) => ({ entry, coverage: Math.round(coverage * 100) / 100, rank }));
}

/** 取正文里命中最多查询词的一段，长文（公告、制度）要的信息常在后面。 */
export function focusedExcerpt(text: string, terms: string[], maxChars: number) {
  const plain = String(text || "").trim();
  if (plain.length <= maxChars) return plain;
  const lower = normalizeKnowledgeText(plain);
  // NFKC 和空白折叠可能改变长度；对不上时退回开头。
  if (lower.length !== plain.length) return `${plain.slice(0, maxChars)}…`;
  const step = Math.max(40, Math.floor(maxChars / 4));
  let bestStart = 0;
  let bestScore = -1;
  for (let start = 0; start < plain.length; start += step) {
    const window = lower.slice(start, start + maxChars);
    let score = 0;
    for (const term of terms) if (term.split("|").some((part) => window.includes(part))) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
    if (start + maxChars >= plain.length) break;
  }
  const slice = plain.slice(bestStart, bestStart + maxChars);
  return `${bestStart > 0 ? "…" : ""}${slice}${bestStart + maxChars < plain.length ? "…" : ""}`;
}

export const KNOWLEDGE_DAY_MS = 86_400_000;
