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

console.log(`Copied ${files.length} desktop userscripts, ${fontAssets.length} schedule font assets and the site logo into server/dist/assets`);
