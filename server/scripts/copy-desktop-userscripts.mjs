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

await mkdir(targetDirectory, { recursive: true });
for (const file of files) {
  await copyFile(path.join(sourceDirectory, file), path.join(targetDirectory, file));
}

await mkdir(fontTargetDirectory, { recursive: true });
for (const file of fontAssets) {
  await copyFile(path.join(fontSourceDirectory, file), path.join(fontTargetDirectory, file));
}

console.log(`Copied ${files.length} desktop userscripts and ${fontAssets.length} schedule font assets into server/dist/assets`);
