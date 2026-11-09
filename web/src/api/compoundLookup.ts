import { request } from "./request";

export type LibraryCompound = { zh: string; en: string; aliases: string[]; cas: string | null; cid: number };
export type ExperimentalKey = "meltingPoint" | "boilingPoint" | "density" | "solubility" | "pka" | "flashPoint" | "logP" | "physicalDescription";
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

export type CompoundLookupResult = {
  query: string;
  kind: "cas" | "cid" | "chinese" | "english";
  candidates: LibraryCompound[];
  detail: CompoundDetail | null;
  message: string | null;
};

export type CompoundLibraryMeta = { source: string; updatedAt: string; count?: number };

const live = { suppressErrorMessage: true, cacheTtlMs: 0, cacheStaleTtlMs: 0 } as const;

export const compoundLookupApi = {
  meta: () => request.get<CompoundLibraryMeta>("/tools/compounds/meta", undefined, { suppressErrorMessage: true }),
  suggest: (q: string) => request.get<LibraryCompound[]>("/tools/compounds/suggest", { q }, { suppressErrorMessage: true }),
  lookup: (q: string) => request.get<CompoundLookupResult>("/tools/compounds/lookup", { q }, live),
  byCid: (cid: number) => request.get<CompoundDetail>(`/tools/compounds/cid/${cid}`, undefined, live),
  structureUrl: (cid: number) => `/api/tools/compounds/cid/${cid}/structure.png`,
};
