import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import library from "../src/data/compoundLibrary.json";
import {
  detectQueryKind, isValidCas, lookupCompound, parseExperimental, parseGhs, searchLibrary, setCompoundFetcherForTests, getCompoundDetail,
} from "../src/services/compoundLookup";
import { compoundLookupRouter } from "../src/routes/compoundLookup";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const notFound = () => json({ Fault: { Code: "PUGREST.NotFound" } }, 404);

const experimental = {
  Record: { Section: [{ TOCHeading: "Chemical and Physical Properties", Section: [{ TOCHeading: "Experimental Properties", Section: [
    { TOCHeading: "Melting Point", Information: [
      { Reference: ["NTP, 1992"], Value: { StringWithMarkup: [{ String: "275 °F (NTP, 1992)" }] } },
      { Value: { StringWithMarkup: [{ String: "275 °F (NTP, 1992)" }] } },
      { Value: { Number: [135], Unit: "°C" } },
    ] },
    { TOCHeading: "Density", Information: [{ Value: { StringWithMarkup: [{ String: "1.40" }] } }] },
  ] }] }] },
};
const ghs = {
  Record: { Section: [{ TOCHeading: "Safety and Hazards", Section: [{ TOCHeading: "Hazards Identification", Section: [{ TOCHeading: "GHS Classification", Information: [
    { Name: "Pictogram(s)", Value: { StringWithMarkup: [{ String: " ", Markup: [{ URL: "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS07.svg", Extra: "Irritant" }] }] } },
    { Name: "Signal", Value: { StringWithMarkup: [{ String: "Warning" }] } },
    { Name: "GHS Hazard Statements", Value: { StringWithMarkup: [
      { String: "H302 (95.6%): Harmful if swallowed [Warning Acute toxicity, oral]" },
      { String: "H315 (20.6%): Causes skin irritation [Warning Skin corrosion/irritation]" },
    ] } },
    { Name: "GHS Hazard Statements", Value: { StringWithMarkup: [{ String: "H302: Harmful if swallowed [Warning Acute toxicity, oral]" }] } },
  ] }] }] }] },
};

function fakePubChem(calls: string[], options: { failView?: boolean; down?: boolean } = {}) {
  return async (url: string) => {
    calls.push(url);
    if (options.down) throw new TypeError("fetch failed");
    if (url.includes("/compound/name/aspirin/cids") || url.includes("/compound/name/50-78-2/cids")) return json({ IdentifierList: { CID: [2244] } });
    if (url.includes("/compound/name/")) return notFound();
    if (url.includes("/compound/cid/2244/property/")) {
      return json({ PropertyTable: { Properties: [{ CID: 2244, Title: "Aspirin", MolecularFormula: "C9H8O4", MolecularWeight: "180.16", SMILES: "CC(=O)OC1=CC=CC=C1C(=O)O", XLogP: 1.2, TPSA: 63.6, HBondDonorCount: 1, HBondAcceptorCount: 4, RotatableBondCount: 3, ExactMass: "180.04225873", IUPACName: "2-acetyloxybenzoic acid" }] } });
    }
    if (url.includes("/compound/cid/2244/synonyms")) return json({ InformationList: { Information: [{ Synonym: ["aspirin", "50-78-2", "50-78-3", "ACETYLSALICYLIC ACID"] }] } });
    if (url.includes("/pug_view/") && options.failView) return json({}, 503);
    if (url.includes("heading=Experimental+Properties")) return json(experimental);
    if (url.includes("heading=GHS+Classification")) return json(ghs);
    return notFound();
  };
}

afterEach(() => setCompoundFetcherForTests(null));

test("library entries are unique, resolved and carry valid CAS numbers", () => {
  const compounds = library.compounds;
  assert.ok(compounds.length >= 150);
  assert.equal(library.meta.count, compounds.length);
  assert.equal(new Set(compounds.map((item) => item.cid)).size, compounds.length);
  assert.equal(new Set(compounds.map((item) => item.zh)).size, compounds.length);
  for (const item of compounds) {
    assert.ok(Number.isInteger(item.cid) && item.cid > 0, item.zh);
    if (item.cas) assert.ok(isValidCas(item.cas), `${item.zh} ${item.cas}`);
  }
});

test("query kinds and CAS check digits", () => {
  assert.equal(detectQueryKind("50-78-2"), "cas");
  assert.equal(detectQueryKind("2244"), "cid");
  assert.equal(detectQueryKind("CID: 2244"), "cid");
  assert.equal(detectQueryKind("阿司匹林"), "chinese");
  assert.equal(detectQueryKind("aspirin"), "english");
  assert.ok(isValidCas("50-78-2"));
  assert.ok(isValidCas("7732-18-5"));
  assert.ok(!isValidCas("50-78-3"));
});

test("library search ranks exact Chinese names, aliases and English names first", () => {
  assert.equal(searchLibrary("阿司匹林")[0].en, "aspirin");
  assert.equal(searchLibrary("扑热息痛")[0].en, "acetaminophen");
  assert.equal(searchLibrary("DMSO")[0].zh, "二甲基亚砜");
  assert.equal(searchLibrary("Ethyl Acetate")[0].zh, "乙酸乙酯");
  assert.equal(searchLibrary("50-78-2")[0].en, "aspirin");
  assert.deepEqual(searchLibrary("  "), []);
  assert.ok(searchLibrary("乙酸").length > 1);
  // 检索专用的英文名（俗名、IUPAC 名）能搜到，但不随结果返回。
  const [glycerol] = searchLibrary("propane-1,2,3-triol");
  assert.equal(glycerol.cid, 753);
  assert.ok(!("names" in glycerol));
});

test("experimental and GHS sections are flattened, deduplicated and labelled", () => {
  const values = parseExperimental(experimental.Record);
  assert.deepEqual(values.meltingPoint.map((item) => item.value), ["275 °F (NTP, 1992)", "135 °C"]);
  assert.equal(values.meltingPoint[0].source, "NTP, 1992");
  assert.deepEqual(values.density.map((item) => item.value), ["1.40"]);
  assert.deepEqual(values.boilingPoint, []);
  const hazards = parseGhs(ghs.Record);
  assert.equal(hazards.signal, "Warning");
  assert.deepEqual(hazards.pictograms, [{ code: "GHS07", label: "Irritant" }]);
  assert.deepEqual(hazards.hazards, [{ code: "H302", text: "Harmful if swallowed" }, { code: "H315", text: "Causes skin irritation" }]);
});

test("Chinese name resolves through the library without a name lookup, and details are cached", async () => {
  const calls: string[] = [];
  setCompoundFetcherForTests(fakePubChem(calls));
  const result = await lookupCompound("阿司匹林");
  assert.equal(result.kind, "chinese");
  assert.equal(result.detail?.cid, 2244);
  assert.equal(result.detail?.zh, "阿司匹林");
  assert.equal(result.detail?.cas, "50-78-2");
  assert.equal(result.detail?.formula, "C9H8O4");
  assert.equal(result.detail?.partial, false);
  assert.ok(!result.detail?.synonyms.includes("50-78-2"));
  assert.ok(!calls.some((url) => url.includes("/compound/name/")));
  assert.equal(calls.length, 4);
  await lookupCompound("aspirin");
  await lookupCompound("2244");
  assert.equal(calls.length, 4, "library English names and CIDs reuse the cached detail");
});

test("unknown Chinese name suggests library entries instead of calling PubChem", async () => {
  const calls: string[] = [];
  setCompoundFetcherForTests(fakePubChem(calls));
  const result = await lookupCompound("某种不存在的化合物");
  assert.equal(result.detail, null);
  assert.match(result.message ?? "", /英文名/u);
  assert.equal(calls.length, 0);
});

test("bad CAS check digit is rejected locally; unknown English names report not found", async () => {
  const calls: string[] = [];
  setCompoundFetcherForTests(fakePubChem(calls));
  assert.match((await lookupCompound("50-78-3")).message ?? "", /校验位/u);
  assert.equal(calls.length, 0);
  const missing = await lookupCompound("notacompoundxyz");
  assert.equal(missing.detail, null);
  assert.match(missing.message ?? "", /没有找到/u);
});

test("view failures still return basic properties, marked partial", async () => {
  setCompoundFetcherForTests(fakePubChem([], { failView: true }));
  const detail = await getCompoundDetail(2244);
  assert.equal(detail?.formula, "C9H8O4");
  assert.equal(detail?.partial, true);
  assert.deepEqual(detail?.ghs.hazards, []);
});

test("routes validate input and map PubChem outages to 502", async () => {
  const app = express();
  app.use("/api/tools/compounds", compoundLookupRouter);
  app.use((error: { status?: number; code?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ code: error.code ?? 5000, message: error.message });
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tools/compounds`;
  try {
    setCompoundFetcherForTests(fakePubChem([]));
    const ok = await (await fetch(`${base}/lookup?q=${encodeURIComponent("50-78-2")}`)).json();
    assert.equal(ok.data.detail.cid, 2244);
    assert.equal((await fetch(`${base}/lookup?q=`)).status, 400);
    assert.equal((await fetch(`${base}/cid/abc`)).status, 400);
    const suggest = await (await fetch(`${base}/suggest?q=${encodeURIComponent("咖啡")}`)).json();
    assert.equal(suggest.data[0].en, "caffeine");
    setCompoundFetcherForTests(fakePubChem([], { down: true }));
    const down = await fetch(`${base}/cid/2244`);
    assert.equal(down.status, 502);
    assert.match((await down.json()).message, /PubChem/u);
  } finally {
    server.close();
  }
});
