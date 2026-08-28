import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_CORS_ALLOWED_ORIGINS,
  resolveCorsAllowedOrigins,
} from "../src/config";

test("both production domains are always allowed alongside configured origins", () => {
  assert.deepEqual(
    resolveCorsAllowedOrigins("https://extra.example, https://cputime.cn", "production"),
    [...PRODUCTION_CORS_ALLOWED_ORIGINS, "https://extra.example"],
  );
});

test("non-production CORS origins remain opt-in", () => {
  assert.deepEqual(resolveCorsAllowedOrigins(undefined, "development"), []);
  assert.deepEqual(resolveCorsAllowedOrigins("http://localhost:5173", "development"), ["http://localhost:5173"]);
});
