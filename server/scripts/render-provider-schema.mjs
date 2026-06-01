#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import { renderProviderSchema } from "./lib/provider-schema.mjs";

const { values } = parseArgs({
  options: {
    source: { type: "string", default: "prisma/schema.prisma" },
    output: { type: "string", default: "prisma/schema.postgresql.prisma" },
    provider: { type: "string", default: "postgresql" },
    "url-env": { type: "string", default: "POSTGRES_DATABASE_URL" },
    "client-output": { type: "string" },
  },
  allowPositionals: false,
});

const cwd = process.cwd();
const sourcePath = path.resolve(cwd, values.source);
const outputPath = path.resolve(cwd, values.output);
const clientOutput = values["client-output"] ?? null;

await renderProviderSchema({
  sourcePath,
  outputPath,
  provider: values.provider,
  urlEnv: values["url-env"],
  clientOutput,
});

console.log(`[schema] 已生成 ${path.relative(cwd, outputPath)}`);
