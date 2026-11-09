import library from "../data/compoundLibrary.json";

/**
 * 化合索检器：先查本地物质库（中文名、俗名、英文名、CAS 号），再向 PubChem 公开接口取理化数据。
 * PubChem 要求每秒不超过 5 次请求，所有上游请求排成一条队列；结果按 CID 缓存，同一物质不重复请求。
 */

export type LibraryCompound = { zh: string; en: string; aliases: string[]; cas: string | null; cid: number };
export type QueryKind = "cas" | "cid" | "chinese" | "english";

export type ExperimentalValue = { value: string; source: string | null };
export type CompoundDetail = {
  cid: number;
  title: string;
  zh: string | null;
  aliases: string[];
  iupacName: string | null;
  cas: string | null;
  formula: string | null;
  molecularWeight: string | null;
  exactMass: string | null;
  smiles: string | null;
  xlogp: number | null;
  tpsa: number | null;
  hBondDonors: number | null;
  hBondAcceptors: number | null;
  rotatableBonds: number | null;
  synonyms: string[];
  experimental: Record<ExperimentalKey, ExperimentalValue[]>;
  ghs: { signal: string | null; pictograms: Array<{ code: string; label: string }>; hazards: Array<{ code: string; text: string }> };
  partial: boolean;
  pubchemUrl: string;
  fetchedAt: string;
};

export type LookupResult = {
  query: string;
  kind: QueryKind;
  candidates: LibraryCompound[];
  detail: CompoundDetail | null;
  message: string | null;
};

export const EXPERIMENTAL_HEADINGS = {
  meltingPoint: "Melting Point",
  boilingPoint: "Boiling Point",
  density: "Density",
  solubility: "Solubility",
  pka: "Dissociation Constants",
  flashPoint: "Flash Point",
  logP: "LogP",
  physicalDescription: "Physical Description",
} as const;
export type ExperimentalKey = keyof typeof EXPERIMENTAL_HEADINGS;

const PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const PUG_VIEW = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound";
const CAS_RE = /^\d{2,7}-\d{2}-\d$/u;
const CID_RE = /^(?:cid\s*[:：]?\s*)?(\d{1,10})$/iu;
const HAN_RE = /\p{Script=Han}/u;
const MAX_VALUES = 3;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 60 * 60 * 1000;
const CACHE_LIMIT = 600;

const compounds = (library as { compounds: LibraryCompound[] }).compounds;
export const compoundLibraryMeta = (library as { meta: { source: string; updatedAt: string; count?: number } }).meta;

export function isValidCas(value: string) {
  if (!CAS_RE.test(value)) return false;
  const digits = value.replace(/-/gu, "");
  const body = digits.slice(0, -1).split("").reverse();
  return body.reduce((sum, digit, index) => sum + Number(digit) * (index + 1), 0) % 10 === Number(digits.at(-1));
}

export function normalizeQuery(raw: string) {
  return raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function detectQueryKind(query: string): QueryKind {
  if (CAS_RE.test(query)) return "cas";
  if (CID_RE.test(query)) return "cid";
  return HAN_RE.test(query) ? "chinese" : "english";
}

function fold(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\-_,'()（）]/gu, "");
}

const libraryIndex = compounds.map((compound) => ({
  compound,
  keys: [compound.zh, compound.en, ...compound.aliases, ...(compound.cas ? [compound.cas] : [])].map(fold),
}));

/** 精确命中排最前，其次是前缀命中，再次是包含；同档按名字短的在前。 */
export function searchLibrary(query: string, limit = 8): LibraryCompound[] {
  const needle = fold(query);
  if (!needle) return [];
  const scored: Array<{ compound: LibraryCompound; score: number }> = [];
  for (const { compound, keys } of libraryIndex) {
    let score = 0;
    for (const key of keys) {
      if (key === needle) score = Math.max(score, 3);
      else if (key.startsWith(needle)) score = Math.max(score, 2);
      else if (needle.length >= 2 && key.includes(needle)) score = Math.max(score, 1);
    }
    if (score) scored.push({ compound, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.compound.zh.length - b.compound.zh.length)
    .slice(0, limit)
    .map((entry) => entry.compound);
}

export function findLibraryByCid(cid: number) {
  return compounds.find((compound) => compound.cid === cid) ?? null;
}

// ---------- 上游请求 ----------

export type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, init);
let minIntervalMs = 220;
let lastStartedAt = 0;
let queue: Promise<unknown> = Promise.resolve();

export function setCompoundFetcherForTests(next: Fetcher | null, interval = 0) {
  fetcher = next ?? ((url, init) => fetch(url, init));
  minIntervalMs = next ? interval : 220;
  detailCache.clear();
  nameCache.clear();
  imageCache.clear();
  inflight.clear();
}

class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    upstreamFailures.note(message);
  }
}

function describeFetchError(error: unknown) {
  const cause = (error as { cause?: { code?: string; message?: string; errors?: Array<{ code?: string; address?: string }> } })?.cause;
  const parts = cause?.errors?.map((item) => `${item.code ?? "?"} ${item.address ?? ""}`.trim());
  return [(error as Error)?.name, cause?.code ?? cause?.message, parts?.length ? `(${parts.join(", ")})` : ""].filter(Boolean).join(" ");
}

class UpstreamFailureLog {
  private last = 0;
  note(message: string) {
    // 失败原因写进服务日志，一分钟最多一条，免得刷屏。
    if (Date.now() - this.last < 60_000) return;
    this.last = Date.now();
    console.warn(`[compound-lookup] ${message}`);
  }
}
const upstreamFailures = new UpstreamFailureLog();

/** 返回 null 表示 PubChem 明确说没有（404）。 */
async function upstreamJson(url: string): Promise<unknown | null> {
  const run = async () => {
    const wait = lastStartedAt + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastStartedAt = Date.now();
    let response: Response;
    try {
      response = await fetcher(url, {
        signal: AbortSignal.timeout(12_000),
        headers: { Accept: "application/json", "User-Agent": "CPU-web compound lookup (+https://cputime.cn)" },
      });
    } catch (error) {
      throw new UpstreamError(`PubChem unreachable: ${describeFetchError(error)}`);
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new UpstreamError(`PubChem ${response.status}`);
    try { return await response.json(); } catch { throw new UpstreamError("PubChem returned invalid JSON"); }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

const detailCache = new Map<number, { value: CompoundDetail | null; expiresAt: number }>();
const nameCache = new Map<string, { cids: number[]; expiresAt: number }>();
const inflight = new Map<string, Promise<unknown>>();

function remember<K, V extends { expiresAt: number }>(cache: Map<K, V>, key: K, value: V) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as K);
}

function once<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = task().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export async function resolveCids(name: string): Promise<number[]> {
  const key = name.toLowerCase();
  const cached = nameCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.cids;
  return once(`name:${key}`, async () => {
    const body = await upstreamJson(`${PUG}/compound/name/${encodeURIComponent(name)}/cids/JSON`) as { IdentifierList?: { CID?: number[] } } | null;
    const cids = (body?.IdentifierList?.CID ?? []).filter((cid) => Number.isInteger(cid) && cid > 0).slice(0, 5);
    remember(nameCache, key, { cids, expiresAt: Date.now() + (cids.length ? CACHE_TTL_MS : NOT_FOUND_TTL_MS) });
    return cids;
  });
}

// ---------- PUG View 解析 ----------

type ViewSection = { TOCHeading?: string; Section?: ViewSection[]; Information?: ViewInformation[] };
type ViewInformation = { Name?: string; Reference?: string[]; Value?: ViewValue };
type ViewValue = {
  StringWithMarkup?: Array<{ String?: string; Markup?: Array<{ URL?: string; Type?: string; Extra?: string }> }>;
  Number?: number[];
  Unit?: string;
};

function findSection(section: ViewSection | undefined, heading: string): ViewSection | undefined {
  for (const child of section?.Section ?? []) {
    if (child.TOCHeading === heading) return child;
    const found = findSection(child, heading);
    if (found) return found;
  }
  return undefined;
}

function valueText(value: ViewValue | undefined) {
  if (!value) return "";
  if (value.StringWithMarkup?.length) return value.StringWithMarkup.map((item) => item.String ?? "").join("; ").trim();
  if (value.Number?.length) return `${value.Number.join(" - ")}${value.Unit ? ` ${value.Unit}` : ""}`.trim();
  return "";
}

function shortSource(reference: string[] | undefined) {
  const text = reference?.[0]?.trim();
  if (!text) return null;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

export function parseExperimental(record: ViewSection | undefined): Record<ExperimentalKey, ExperimentalValue[]> {
  const result = {} as Record<ExperimentalKey, ExperimentalValue[]>;
  for (const [key, heading] of Object.entries(EXPERIMENTAL_HEADINGS) as Array<[ExperimentalKey, string]>) {
    const seen = new Set<string>();
    const values: ExperimentalValue[] = [];
    for (const information of findSection(record, heading)?.Information ?? []) {
      const value = valueText(information.Value).slice(0, 300);
      if (!value || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      values.push({ value, source: shortSource(information.Reference) });
      if (values.length >= (key === "physicalDescription" ? 2 : MAX_VALUES)) break;
    }
    result[key] = values;
  }
  return result;
}

export function parseGhs(record: ViewSection | undefined): CompoundDetail["ghs"] {
  const section = findSection(record, "GHS Classification");
  let signal: string | null = null;
  const pictograms = new Map<string, string>();
  const hazards = new Map<string, string>();
  for (const information of section?.Information ?? []) {
    if (information.Name === "Signal" && !signal) signal = valueText(information.Value) || null;
    if (information.Name === "Pictogram(s)") {
      for (const item of information.Value?.StringWithMarkup ?? []) {
        for (const markup of item.Markup ?? []) {
          const code = markup.URL?.match(/(GHS\d{2})\.svg$/u)?.[1];
          if (code) pictograms.set(code, markup.Extra ?? code);
        }
      }
    }
    if (information.Name === "GHS Hazard Statements") {
      for (const item of information.Value?.StringWithMarkup ?? []) {
        const match = item.String?.match(/^(H\d{3}[A-Za-z]*(?:\+H\d{3}[A-Za-z]*)*)(?:\s*\([\d.]+%\))?\s*:\s*(.+)$/u);
        if (match && !hazards.has(match[1])) hazards.set(match[1], match[2].replace(/\s*\[[^\]]*\]\s*$/u, "").trim());
      }
    }
  }
  return {
    signal,
    pictograms: [...pictograms].map(([code, label]) => ({ code, label })).sort((a, b) => a.code.localeCompare(b.code)),
    hazards: [...hazards].map(([code, text]) => ({ code, text })).sort((a, b) => a.code.localeCompare(b.code)),
  };
}

// ---------- 物质详情 ----------

const PROPERTY_FIELDS = "Title,IUPACName,MolecularFormula,MolecularWeight,ExactMass,SMILES,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,RotatableBondCount";

type PropertyRow = {
  CID: number; Title?: string; IUPACName?: string; MolecularFormula?: string; MolecularWeight?: string | number; ExactMass?: string | number;
  SMILES?: string; XLogP?: number; TPSA?: number; HBondDonorCount?: number; HBondAcceptorCount?: number; RotatableBondCount?: number;
};

const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const asText = (value: unknown) => (value === undefined || value === null || value === "" ? null : String(value));

/** 去掉 CAS 号和数据库登记号（RefChem:1092872、Npc209773、DTXSID5020…、UNII-…），只留人读得懂的名称。 */
export function isReadableSynonym(name: string) {
  if (name.length > 60 || isValidCas(name) || name.includes(":")) return false;
  if (/^[A-Za-z]{2,8}[-_]?\d{3,}[A-Za-z0-9]*$/u.test(name)) return false;
  if (/^(?:UNII|EINECS|NSC|HSDB|CCRIS|BRN|AI3|DTXSID|DTXCID|SCHEMBL|CHEMBL|ZINC|MFCD)[-\s]?/iu.test(name)) return false;
  return /[a-z]/iu.test(name);
}

async function optional<T>(task: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try { return { ok: true, value: await task }; } catch { return { ok: false }; }
}

export async function getCompoundDetail(cid: number): Promise<CompoundDetail | null> {
  const cached = detailCache.get(cid);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  return once(`cid:${cid}`, async () => {
    const properties = await upstreamJson(`${PUG}/compound/cid/${cid}/property/${PROPERTY_FIELDS}/JSON`) as { PropertyTable?: { Properties?: PropertyRow[] } } | null;
    const row = properties?.PropertyTable?.Properties?.[0];
    if (!row) {
      remember(detailCache, cid, { value: null, expiresAt: Date.now() + NOT_FOUND_TTL_MS });
      return null;
    }
    const [synonyms, experimental, ghs] = await Promise.all([
      optional(upstreamJson(`${PUG}/compound/cid/${cid}/synonyms/JSON`)),
      optional(upstreamJson(`${PUG_VIEW}/${cid}/JSON?heading=Experimental+Properties`)),
      optional(upstreamJson(`${PUG_VIEW}/${cid}/JSON?heading=GHS+Classification`)),
    ]);
    const synonymList = synonyms.ok
      ? ((synonyms.value as { InformationList?: { Information?: Array<{ Synonym?: string[] }> } } | null)?.InformationList?.Information?.[0]?.Synonym ?? [])
      : [];
    const local = findLibraryByCid(cid);
    const cas = local?.cas ?? synonymList.find(isValidCas) ?? null;
    const record = (value: unknown) => (value as { Record?: ViewSection } | null)?.Record;
    const detail: CompoundDetail = {
      cid,
      // PubChem 的标题有时是登记号（如阿托品显示 Npc209773），物质库里有的用库里的英文名。
      title: local?.en ?? row.Title ?? `CID ${cid}`,
      zh: local?.zh ?? null,
      aliases: local?.aliases ?? [],
      iupacName: asText(row.IUPACName),
      cas,
      formula: asText(row.MolecularFormula),
      molecularWeight: asText(row.MolecularWeight),
      exactMass: asText(row.ExactMass),
      smiles: asText(row.SMILES),
      xlogp: asNumber(row.XLogP),
      tpsa: asNumber(row.TPSA),
      hBondDonors: asNumber(row.HBondDonorCount),
      hBondAcceptors: asNumber(row.HBondAcceptorCount),
      rotatableBonds: asNumber(row.RotatableBondCount),
      synonyms: synonymList.filter(isReadableSynonym).slice(0, 12),
      experimental: parseExperimental(experimental.ok ? record(experimental.value) : undefined),
      ghs: parseGhs(ghs.ok ? record(ghs.value) : undefined),
      partial: !synonyms.ok || !experimental.ok || !ghs.ok,
      pubchemUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
      fetchedAt: new Date().toISOString(),
    };
    // 缺了部分数据的结果只短暂缓存，下次再补。
    remember(detailCache, cid, { value: detail, expiresAt: Date.now() + (detail.partial ? 10 * 60 * 1000 : CACHE_TTL_MS) });
    return detail;
  });
}

const imageCache = new Map<number, { value: Buffer | null; expiresAt: number }>();
const IMAGE_CACHE_LIMIT = 300;
const MAX_IMAGE_BYTES = 512 * 1024;

/** 二维结构式 PNG，经同一条限速队列取回并缓存；PubChem 没有时返回 null。 */
export async function getStructureImage(cid: number): Promise<Buffer | null> {
  const cached = imageCache.get(cid);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  return once(`png:${cid}`, async () => {
    const value = await upstreamBinary(`${PUG}/compound/cid/${cid}/PNG?image_size=300x300`);
    imageCache.delete(cid);
    imageCache.set(cid, { value, expiresAt: Date.now() + (value ? CACHE_TTL_MS : NOT_FOUND_TTL_MS) });
    while (imageCache.size > IMAGE_CACHE_LIMIT) imageCache.delete(imageCache.keys().next().value as number);
    return value;
  });
}

async function upstreamBinary(url: string): Promise<Buffer | null> {
  const run = async () => {
    const wait = lastStartedAt + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastStartedAt = Date.now();
    let response: Response;
    try {
      response = await fetcher(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: "image/png", "User-Agent": "CPU-web compound lookup (+https://cputime.cn)" } });
    } catch (error) {
      throw new UpstreamError(`PubChem unreachable: ${describeFetchError(error)}`);
    }
    if (response.status === 404) return null;
    if (!response.ok || !(response.headers.get("content-type") ?? "").startsWith("image/png")) throw new UpstreamError(`PubChem image ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) throw new UpstreamError("PubChem image too large");
    return buffer;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

export async function lookupCompound(raw: string): Promise<LookupResult> {
  const query = normalizeQuery(raw);
  const kind = detectQueryKind(query);
  const candidates = searchLibrary(query);
  const exact = candidates.find((compound) => [compound.zh, compound.en, compound.cas ?? "", ...compound.aliases].some((key) => fold(key) === fold(query)));
  const base = { query, kind, candidates };

  if (kind === "cas" && !isValidCas(query)) return { ...base, detail: null, message: "CAS 号校验位不对，请检查是否输错" };

  let cid: number | null = exact?.cid ?? null;
  if (!cid && kind === "cid") cid = Number(query.match(CID_RE)![1]);
  if (!cid && kind !== "chinese") cid = (await resolveCids(query))[0] ?? null;
  if (!cid) {
    if (kind === "chinese") {
      return { ...base, detail: null, message: candidates.length ? "没有完全对应的名称，请从下面选一个" : "物质库里没有这个中文名，可以换成英文名、CAS 号或 CID 再查" };
    }
    return { ...base, detail: null, message: "PubChem 没有找到这个物质" };
  }
  const detail = await getCompoundDetail(cid);
  return { ...base, detail, message: detail ? null : "PubChem 没有这个 CID" };
}

export { UpstreamError as CompoundUpstreamError };
