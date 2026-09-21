import { load } from "cheerio";
import lexicon from "../data/moderation/lexicon.json";
import type { TopicAiReviewResult } from "./topicAiReview";

// Site incident supplements, kept separate from the attributed upstream subset.
const SITE_TERMS = ["麻豆传媒", "习扁担"];
const TRADITIONAL: Record<string, string> = Object.fromEntries(
  [..."傳媒習擔頭搖藥姦艷槍彈軍買賣發視頻圖書網換體國產銷應製無碼級亂倫獵供販購貨電樂擊蕩"].map((char, i) =>
    [char, [..."传媒习担头摇药奸艳枪弹军买卖发视频图书网换体国产销应制无码级乱伦猎供贩购货电乐击荡"][i]]),
);

export function normalizeKeywordText(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[傳媒習擔頭搖藥姦艷槍彈軍買賣發視頻圖書網換體國產銷應製無碼級亂倫獵供販購貨電樂擊蕩]/gu, char => TRADITIONAL[char])
    .replace(/[\p{P}\p{S}\p{Z}\p{C}\p{M}]/gu, "");
}

const directRules = [
  ...lexicon.adult.map(term => ({ term, category: "porn_explicit" })),
  ...lexicon.weapons.map(term => ({ term, category: "illegal_weapons" })),
  ...SITE_TERMS.map(term => ({ term, category: "site_prohibited" })),
].map(rule => ({ ...rule, normalized: normalizeKeywordText(rule.term) }));
const drugs = [...lexicon.drugs, "毒品", "冰毒", "海洛因", "可卡因", "大麻", "麻古"];
const trade = "(?:出售|销售|售卖|贩卖|供应|批发|购买|求购|收购|出货)";
const drugTrade = new RegExp(`${trade}.{0,8}(${drugs.join("|")})|(${drugs.join("|")}).{0,8}${trade}`, "u");

function textVariants(value: string): string[] {
  // Decode encoded links as well as visible text; stripping Markdown URLs would hide adverts.
  let decoded = value;
  for (let i = 0; i < 2; i++) {
    decoded = decoded.replace(/(?:%[\da-f]{2})+/giu, part => {
      try { return decodeURIComponent(part); } catch { return part; }
    });
  }
  const $ = load(decoded, {}, false);
  const attributes: string[] = [];
  $("[href], [src], [alt], [title]").each((_index, element) => {
    for (const name of ["href", "src", "alt", "title"]) {
      const attribute = $(element).attr(name);
      if (attribute) attributes.push(attribute);
    }
  });
  return [decoded, $.root().text(), ...attributes].map(normalizeKeywordText);
}

function metadataStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(metadataStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(metadataStrings);
  return [];
}

export function reviewContentKeywords(input: {
  title?: string | null;
  content: string;
  metadata?: unknown;
  parentContent?: string | null;
}): TopicAiReviewResult | null {
  const fields = [input.title || "", input.content, ...metadataStrings(input.metadata)];
  const adultParent = input.parentContent
    ? textVariants(input.parentContent).some(text => /麻豆传媒|色情|三级片/u.test(text))
    : false;
  for (const field of fields) {
    for (const text of textVariants(field)) {
      const direct = directRules.find(rule => text.includes(rule.normalized));
      const drug = drugTrade.exec(text);
      const incidentAlias = text.includes("三片高清")
        && (text === "三片高清" || adultParent || /资源|下载|片源|加群|视频/u.test(text));
      const hit = direct || (drug ? { term: drug[1] || drug[2], category: "illegal_drug_trade" } : null)
        || (incidentAlias ? { term: "三片高清", category: "porn_explicit" } : null);
      if (!hit) continue;
      return {
        status: "manual_requested",
        riskLevel: "medium",
        riskScore: 70,
        reason: "内容命中关键词，需复核确认，暂不公开；这不代表已判定违规",
        detail: JSON.stringify({ decision: "manual_review", rule: "content-keywords-v1", category: hit.category, matchedTerm: hit.term, lexiconCommit: lexicon.commit }),
        model: "local-keyword-filter-v1",
      };
    }
  }
  return null;
}

/** A keyword conflict must never be overridden by a low AI score or whitelist. */
export function applyKeywordReview(keyword: TopicAiReviewResult | null, ai: TopicAiReviewResult): TopicAiReviewResult {
  if (!keyword) return ai;
  const detail = JSON.parse(ai.detail || "{}");
  if (detail.unavailable) return ai; // Retry automatically while keeping the submission private.
  if (ai.status === "blocked_ai" && detail.modelDecision !== "manual_review") return ai;
  return {
    ...keyword,
    model: ai.model,
    detail: JSON.stringify({ ...JSON.parse(keyword.detail), aiReview: { ...ai, detail } }),
  };
}

export function isKeywordManualReview(detail: string | null | undefined): boolean {
  try { return JSON.parse(detail || "{}").rule === "content-keywords-v1"; } catch { return false; }
}
