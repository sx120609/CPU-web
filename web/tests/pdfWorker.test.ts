import assert from "node:assert/strict";
import test from "node:test";
import { resolvePdfWorkerUrl } from "../src/utils/pdfWorker";

test("PDF worker uses the page origin when Vite emits a root-relative asset URL", () => {
  assert.equal(
    resolvePdfWorkerUrl(
      "https://img.cputime.cn/assets/pdf.worker-BgryrOlp.mjs",
      "https://cputime.cn",
    ),
    "https://cputime.cn/assets/pdf.worker-BgryrOlp.mjs",
  );
});

test("PDF worker keeps its development path while rebasing to the local page", () => {
  assert.equal(
    resolvePdfWorkerUrl(
      "http://localhost:5173/node_modules/pdfjs-dist/build/pdf.worker.mjs",
      "http://localhost:5173",
    ),
    "http://localhost:5173/node_modules/pdfjs-dist/build/pdf.worker.mjs",
  );
});
