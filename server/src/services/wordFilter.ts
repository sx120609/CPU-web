import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

type WordCategory =
  | "core_prohibited"
  | "campus_card"
  | "commercial"
  | "contact_info"
  | "recruitment"
  | "interest_inducement";

type MatchResult = {
  blocked: boolean;
  matchedWords: string[];
  matchedCategories: WordCategory[];
};

const CATEGORY_FILE_MAP: Record<WordCategory, string> = {
  core_prohibited: "core_prohibited_claims.txt",
  campus_card: "campus_card_or_broadband.txt",
  commercial: "commercial_promotion.txt",
  contact_info: "contact_information.txt",
  recruitment: "part_time_or_recruitment.txt",
  interest_inducement: "interest_inducement.txt",
};

let wordMap: Map<string, WordCategory[]> | null = null;

function loadWords(): Map<string, WordCategory[]> {
  if (wordMap) return wordMap;

  const dataDir = path.resolve(__dirname, "../data/campus-ad-detection-words");
  const map = new Map<string, WordCategory[]>();

  if (!existsSync(dataDir)) {
    console.warn("⚠️  词库目录不存在，跳过加载");
    wordMap = map;
    return map;
  }

  for (const [category, filename] of Object.entries(CATEGORY_FILE_MAP) as [WordCategory, string][]) {
    const filePath = path.join(dataDir, filename);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const word = line.trim();
      if (!word || word.startsWith("#")) continue;
      const existing = map.get(word);
      if (existing) {
        if (!existing.includes(category)) existing.push(category);
      } else {
        map.set(word, [category]);
      }
    }
  }

  wordMap = map;
  console.log(`📋 词库已加载: ${map.size} 个关键词`);
  return map;
}

export function checkWordFilter(text: string): MatchResult {
  const words = loadWords();
  const matchedWords: string[] = [];
  const matchedCategories = new Set<WordCategory>();

  for (const [word, categories] of words) {
    if (text.includes(word)) {
      matchedWords.push(word);
      for (const cat of categories) matchedCategories.add(cat);
    }
  }

  if (matchedWords.length === 0) {
    return { blocked: false, matchedWords: [], matchedCategories: [] };
  }

  const cats = Array.from(matchedCategories);
  const blocked =
    cats.includes("core_prohibited") ||
    cats.includes("campus_card") ||
    (cats.includes("contact_info") && cats.includes("recruitment")) ||
    (cats.length >= 3);

  return { blocked, matchedWords, matchedCategories: cats };
}
