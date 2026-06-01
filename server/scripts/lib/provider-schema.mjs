import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function replaceDatasourceBlock(schema, provider, urlEnv) {
  const datasourcePattern = /datasource\s+db\s*\{[\s\S]*?\n\}/m;
  const datasourceMatch = schema.match(datasourcePattern);
  if (!datasourceMatch) {
    throw new Error("未找到 datasource db 定义，无法生成目标 Prisma schema");
  }
  const next = datasourceMatch[0]
    .replace(/provider\s*=\s*"[^"]+"/, `provider = "${provider}"`)
    .replace(/url\s*=\s*env\("([^"]+)"\)/, `url      = env("${urlEnv}")`);
  return schema.replace(datasourcePattern, next);
}

function replaceGeneratorOutput(schema, clientOutput) {
  if (!clientOutput) return schema.replace(/^\s*output\s*=\s*"[^"]+"\s*\n/m, "");

  const generatorPattern = /generator\s+client\s*\{[\s\S]*?\n\}/m;
  const generatorMatch = schema.match(generatorPattern);
  if (!generatorMatch) {
    throw new Error("未找到 generator client 定义，无法设置 Prisma Client 输出目录");
  }

  let next = generatorMatch[0];
  if (/^\s*output\s*=\s*"[^"]+"\s*$/m.test(next)) {
    next = next.replace(/^\s*output\s*=\s*"[^"]+"\s*$/m, `  output   = "${clientOutput}"`);
  } else {
    next = next.replace(/provider\s*=\s*"prisma-client-js"/, `provider = "prisma-client-js"\n  output   = "${clientOutput}"`);
  }
  return schema.replace(generatorPattern, next);
}

export async function renderProviderSchema({
  sourcePath,
  outputPath,
  provider,
  urlEnv,
  clientOutput = null,
}) {
  const source = await readFile(sourcePath, "utf8");
  const withDatasource = replaceDatasourceBlock(source, provider, urlEnv);
  const rendered = replaceGeneratorOutput(withDatasource, clientOutput);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, rendered, "utf8");
  return outputPath;
}
