import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(serverRoot, "..");
const sourceDirectory = path.join(repositoryRoot, "desktop", "assets", "userscripts");
const targetDirectory = path.join(serverRoot, "dist", "assets", "userscripts");
const files = ["monkey.js", "multiplatform.js"];

await mkdir(targetDirectory, { recursive: true });
for (const file of files) {
  await copyFile(path.join(sourceDirectory, file), path.join(targetDirectory, file));
}

console.log(`Copied ${files.length} desktop userscripts into server/dist/assets/userscripts`);
