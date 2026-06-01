#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { PrismaClient as SourcePrismaClient, Prisma } from "@prisma/client";
import { renderProviderSchema } from "./lib/provider-schema.mjs";

const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const ROOT = process.cwd();
const TMP_ROOT = path.resolve(ROOT, ".tmp", "sqlite-to-postgres");
const TMP_SCHEMA_PATH = path.join(TMP_ROOT, "schema.prisma");
const TMP_CLIENT_OUTPUT = "./client";
const SOURCE_URL = String(process.env.DATABASE_URL ?? "").trim().replace(/^"(.*)"$/, "$1");
const TARGET_URL = String(process.env.POSTGRES_DATABASE_URL ?? "").trim().replace(/^"(.*)"$/, "$1");

const { values } = parseArgs({
  options: {
    "batch-size": { type: "string", default: "1000" },
    "clear-target": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "keep-temp": { type: "boolean", default: false },
    "skip-db-push": { type: "boolean", default: false },
  },
});

const batchSize = Math.max(1, Number(values["batch-size"]));
if (!Number.isFinite(batchSize)) {
  throw new Error("--batch-size 必须是正整数");
}

const sourcePrisma = new SourcePrismaClient({
  log: ["warn", "error"],
});

function delegateName(modelName) {
  return modelName[0].toLowerCase() + modelName.slice(1);
}

function quotedIdent(name) {
  return `"${name.replace(/"/g, "\"\"")}"`;
}

function run(cmd, args, extraEnv = {}) {
  execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
}

function buildModelConfig(model) {
  const scalarFields = model.fields.filter((field) => field.kind === "scalar");
  const idFields = scalarFields.filter((field) => field.isId).map((field) => field.name);
  const primaryKeyFields = idFields.length ? idFields : (model.primaryKey?.fields ?? []);
  const singleScalarIdField = primaryKeyFields.length === 1 ? primaryKeyFields[0] : null;
  const autoincrementIdField = scalarFields.find(
    (field) =>
      field.isId &&
      field.hasDefaultValue &&
      typeof field.default === "object" &&
      field.default?.name === "autoincrement"
  )?.name ?? null;
  const selfRelationScalarFields = new Set(
    model.fields
      .filter((field) => field.kind === "object" && field.type === model.name && (field.relationFromFields?.length ?? 0) > 0)
      .flatMap((field) => field.relationFromFields ?? [])
  );
  const dependencies = new Set(
    model.fields
      .filter((field) => field.kind === "object" && field.type !== model.name && (field.relationFromFields?.length ?? 0) > 0)
      .map((field) => field.type)
  );
  return {
    modelName: model.name,
    delegate: delegateName(model.name),
    scalarFields,
    scalarFieldNames: scalarFields.map((field) => field.name),
    select: Object.fromEntries(scalarFields.map((field) => [field.name, true])),
    primaryKeyFields,
    singleScalarIdField,
    autoincrementIdField,
    dependencies,
    selfRelationScalarFields: [...selfRelationScalarFields],
  };
}

function topoSort(models) {
  const modelMap = new Map(models.map((model) => [model.modelName, model]));
  const indegree = new Map(models.map((model) => [model.modelName, 0]));
  const graph = new Map(models.map((model) => [model.modelName, new Set()]));

  for (const model of models) {
    for (const dependency of model.dependencies) {
      if (!modelMap.has(dependency)) continue;
      indegree.set(model.modelName, (indegree.get(model.modelName) ?? 0) + 1);
      graph.get(dependency)?.add(model.modelName);
    }
  }

  const queue = [...models.filter((model) => (indegree.get(model.modelName) ?? 0) === 0).map((model) => model.modelName)];
  const ordered = [];

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    ordered.push(modelMap.get(current));
    for (const next of graph.get(current) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) queue.push(next);
    }
  }

  const leftovers = models.filter((model) => !ordered.some((item) => item?.modelName === model.modelName));
  if (leftovers.length) {
    console.warn(`[warn] 检测到循环依赖模型，按原始顺序追加：${leftovers.map((item) => item.modelName).join(", ")}`);
    ordered.push(...leftovers);
  }

  return ordered.filter(Boolean);
}

async function loadTargetPrismaClient() {
  const clientEntry = path.join(TMP_ROOT, "client", "index.js");
  const moduleUrl = `${pathToFileURL(clientEntry).href}?v=${Date.now()}`;
  const imported = await import(moduleUrl);
  return new imported.PrismaClient({
    log: ["warn", "error"],
  });
}

async function ensureTargetReady() {
  if (!SOURCE_URL.startsWith("file:")) {
    throw new Error(`当前 DATABASE_URL 不是 SQLite 文件：${SOURCE_URL || "(空)"}`);
  }
  if (!values["dry-run"] && !TARGET_URL) {
    throw new Error("未设置 POSTGRES_DATABASE_URL，无法迁移到 PostgreSQL");
  }

  await mkdir(TMP_ROOT, { recursive: true });
  await renderProviderSchema({
    sourcePath: path.resolve(ROOT, "prisma", "schema.prisma"),
    outputPath: TMP_SCHEMA_PATH,
    provider: "postgresql",
    urlEnv: "POSTGRES_DATABASE_URL",
    clientOutput: TMP_CLIENT_OUTPUT,
  });

  console.log(`[schema] 迁移用 PostgreSQL schema 已生成：${path.relative(ROOT, TMP_SCHEMA_PATH)}`);

  if (values["dry-run"]) return;

  run(NPX, ["prisma", "generate", "--schema", TMP_SCHEMA_PATH], {
    POSTGRES_DATABASE_URL: TARGET_URL,
  });

  if (!values["skip-db-push"]) {
    run(NPX, ["prisma", "db", "push", "--skip-generate", "--schema", TMP_SCHEMA_PATH], {
      POSTGRES_DATABASE_URL: TARGET_URL,
    });
  }
}

async function clearTargetTables(targetPrisma, orderedModels) {
  const allTables = orderedModels.map((model) => quotedIdent(model.modelName)).join(", ");
  console.log("[target] 清空目标库现有数据 ...");
  await targetPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${allTables} RESTART IDENTITY CASCADE`);
}

async function assertTargetEmpty(targetPrisma, orderedModels) {
  for (const model of orderedModels) {
    const count = await targetPrisma[model.delegate].count();
    if (count > 0) {
      throw new Error(`目标库 ${model.modelName} 表已存在 ${count} 条数据。请改用空库，或添加 --clear-target。`);
    }
  }
}

async function countModelRows(client, model) {
  return client[model.delegate].count();
}

function batchOrderBy(model) {
  if (!model.primaryKeyFields.length) return undefined;
  return model.primaryKeyFields.map((field) => ({ [field]: "asc" }));
}

async function* readSourceBatches(model, extraArgs = {}) {
  const delegate = sourcePrisma[model.delegate];
  if (model.singleScalarIdField) {
    let cursor = null;
    while (true) {
      const rows = await delegate.findMany({
        take: batchSize,
        ...(cursor !== null ? { cursor: { [model.singleScalarIdField]: cursor }, skip: 1 } : {}),
        orderBy: { [model.singleScalarIdField]: "asc" },
        select: model.select,
        ...extraArgs,
      });
      if (!rows.length) return;
      cursor = rows[rows.length - 1][model.singleScalarIdField];
      yield rows;
    }
    return;
  }

  let skip = 0;
  while (true) {
    const rows = await delegate.findMany({
      skip,
      take: batchSize,
      ...(batchOrderBy(model) ? { orderBy: batchOrderBy(model) } : {}),
      select: model.select,
      ...extraArgs,
    });
    if (!rows.length) return;
    skip += rows.length;
    yield rows;
  }
}

async function copyModelData(targetPrisma, model) {
  const targetDelegate = targetPrisma[model.delegate];
  const total = await countModelRows(sourcePrisma, model);
  console.log(`[copy] ${model.modelName}: ${total} 行`);
  if (!total) return { total: 0, inserted: 0 };

  let inserted = 0;
  for await (const batch of readSourceBatches(model)) {
    await targetDelegate.createMany({ data: batch });
    inserted += batch.length;
    if (inserted === total || inserted % Math.max(batchSize * 10, 5000) === 0) {
      console.log(`       -> ${inserted}/${total}`);
    }
  }

  const targetCount = await countModelRows(targetPrisma, model);
  if (targetCount !== total) {
    throw new Error(`${model.modelName} 迁移后行数不一致：source=${total}, target=${targetCount}`);
  }
  return { total, inserted };
}

async function fixSelfRelations(targetPrisma, model) {
  if (!model.selfRelationScalarFields.length || !model.singleScalarIdField) return 0;
  const selfFields = model.selfRelationScalarFields;
  const where =
    selfFields.length === 1
      ? { [selfFields[0]]: { not: null } }
      : { OR: selfFields.map((field) => ({ [field]: { not: null } })) };

  let updated = 0;
  for await (const batch of readSourceBatches(model, { where })) {
    const valuesSql = batch
      .map((row) => {
        const parts = [String(row[model.singleScalarIdField])];
        for (const field of selfFields) {
          const value = row[field];
          parts.push(value === null ? "NULL" : String(value));
        }
        return `(${parts.join(", ")})`;
      })
      .join(", ");
    const aliasColumns = [quotedIdent(model.singleScalarIdField), ...selfFields.map(quotedIdent)].join(", ");
    const setClause = selfFields
      .map((field) => `${quotedIdent(field)} = v.${quotedIdent(field)}`)
      .join(", ");
    await targetPrisma.$executeRawUnsafe(
      `UPDATE ${quotedIdent(model.modelName)} AS t
       SET ${setClause}
       FROM (VALUES ${valuesSql}) AS v(${aliasColumns})
       WHERE t.${quotedIdent(model.singleScalarIdField)} = v.${quotedIdent(model.singleScalarIdField)}`
    );
    updated += batch.length;
  }
  return updated;
}

async function resetSequences(targetPrisma, orderedModels) {
  for (const model of orderedModels) {
    if (!model.autoincrementIdField) continue;
    const idColumn = quotedIdent(model.autoincrementIdField);
    const tableName = quotedIdent(model.modelName);
    await targetPrisma.$executeRawUnsafe(`
      SELECT setval(
        pg_get_serial_sequence('${tableName}', '${model.autoincrementIdField}'),
        COALESCE((SELECT MAX(${idColumn}) FROM ${tableName}), 1),
        COALESCE((SELECT MAX(${idColumn}) FROM ${tableName}), 0) > 0
      )
    `);
  }
}

async function main() {
  const models = Prisma.dmmf.datamodel.models.map(buildModelConfig);
  const orderedModels = topoSort(models);

  console.log(`[source] ${SOURCE_URL}`);
  console.log(`[target] ${TARGET_URL || "(dry-run 未提供)"}`);
  console.log(`[config] batchSize=${batchSize}, clearTarget=${values["clear-target"]}, skipDbPush=${values["skip-db-push"]}, dryRun=${values["dry-run"]}`);
  console.log(`[order] ${orderedModels.map((model) => model.modelName).join(" -> ")}`);

  await ensureTargetReady();
  if (values["dry-run"]) {
    console.log("[dry-run] 已完成 schema 生成和迁移顺序检查，未连接 PostgreSQL。");
    return;
  }

  const targetPrisma = await loadTargetPrismaClient();
  try {
    if (values["clear-target"]) await clearTargetTables(targetPrisma, orderedModels);
    else await assertTargetEmpty(targetPrisma, orderedModels);

    for (const model of orderedModels) {
      await copyModelData(targetPrisma, model);
    }

    for (const model of orderedModels) {
      const updated = await fixSelfRelations(targetPrisma, model);
      if (updated) console.log(`[self] ${model.modelName}: 已回填 ${updated} 条自关联字段`);
    }

    await resetSequences(targetPrisma, orderedModels);
    console.log("[done] SQLite -> PostgreSQL 主站主库迁移完成。");
  } finally {
    await targetPrisma.$disconnect().catch(() => undefined);
  }
}

try {
  await main();
} finally {
  await sourcePrisma.$disconnect().catch(() => undefined);
  if (!values["keep-temp"]) {
    await rm(TMP_ROOT, { recursive: true, force: true }).catch(() => undefined);
  }
}
