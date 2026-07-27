import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type DesktopUserScriptRelease = {
  name: string;
  version: string;
  sha256: string;
  size: number;
  source: string;
};

const scriptPath = path.resolve(__dirname, "../../../desktop/assets/userscripts/monkey.js");

const metadataValue = (header: string, key: string) =>
  new RegExp(`^\\s*//\\s*@${key}\\s+(.+?)\\s*$`, "m").exec(header)?.[1]?.trim() ?? "";

export async function readDesktopUserScriptRelease(): Promise<DesktopUserScriptRelease> {
  const source = await readFile(scriptPath, "utf8");
  const header = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/)?.[1] ?? "";
  const name = metadataValue(header, "name");
  const version = metadataValue(header, "version");
  if (!name || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("学习通助手脚本缺少有效的名称或版本号");
  }
  return {
    name,
    version,
    sha256: createHash("sha256").update(source, "utf8").digest("hex"),
    size: Buffer.byteLength(source, "utf8"),
    source,
  };
}
