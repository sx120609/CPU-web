import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(serverRoot, "..");
const sourceDirectory = path.join(repositoryRoot, "desktop", "assets", "userscripts");
const targetDirectory = path.join(serverRoot, "dist", "assets", "userscripts");
const files = ["monkey.js", "multiplatform.js", "weban.js"];
const fontSourceDirectory = path.join(serverRoot, "assets", "fonts");
const fontTargetDirectory = path.join(serverRoot, "dist", "assets", "fonts");
const fontAssets = ["HarmonyOS_Sans_SC_Regular.ttf", "HarmonyOS_Sans_SC_Bold.ttf", "HarmonyOS-Sans-LICENSE.txt"];
const siteAssetDirectory = path.join(serverRoot, "dist", "assets", "site");
// 拾间AI 检索用的学校事务资料，由 scripts/import-school-knowledge.mjs 生成。
const knowledgeSourceDirectory = path.join(serverRoot, "assets", "knowledge");
const knowledgeTargetDirectory = path.join(serverRoot, "dist", "assets", "knowledge");
const knowledgeAssets = ["school-docs.json", "school-regulations.json"];

await mkdir(targetDirectory, { recursive: true });
for (const file of files) {
  await copyFile(path.join(sourceDirectory, file), path.join(targetDirectory, file));
}

await mkdir(fontTargetDirectory, { recursive: true });
for (const file of fontAssets) {
  await copyFile(path.join(fontSourceDirectory, file), path.join(fontTargetDirectory, file));
}

await mkdir(siteAssetDirectory, { recursive: true });
await copyFile(path.join(repositoryRoot, "web", "public", "favicon.svg"), path.join(siteAssetDirectory, "favicon.svg"));

await mkdir(knowledgeTargetDirectory, { recursive: true });
for (const file of knowledgeAssets) {
  await copyFile(path.join(knowledgeSourceDirectory, file), path.join(knowledgeTargetDirectory, file));
}

console.log(`Copied ${files.length} desktop userscripts, ${fontAssets.length} schedule font assets, the site logo and ${knowledgeAssets.length} assistant knowledge files into server/dist/assets`);
