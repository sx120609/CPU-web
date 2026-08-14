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

export type DesktopUserScriptKind = "chaoxing" | "multiplatform" | "weban";

const scriptDefinition = (kind: DesktopUserScriptKind) => ({
  chaoxing: {
    fileName: "monkey.js",
    label: "学习通助手",
  },
  multiplatform: {
    fileName: "multiplatform.js",
    label: "多平台助手",
  },
  weban: {
    fileName: "weban.js",
    label: "安全微伴助手",
  },
}[kind]);

const readUserScriptSource = async (fileName: string): Promise<string> => {
  const bundledPath = path.resolve(__dirname, "../assets/userscripts", fileName);
  try {
    return await readFile(bundledPath, "utf8");
  } catch {
    // Development and source-level tests run before server/dist assets exist.
    return readFile(path.resolve(__dirname, "../../../desktop/assets/userscripts", fileName), "utf8");
  }
};

const metadataValue = (header: string, key: string) =>
  new RegExp(`^\\s*//\\s*@${key}\\s+(.+?)\\s*$`, "m").exec(header)?.[1]?.trim() ?? "";

export async function readDesktopUserScriptRelease(
  kind: DesktopUserScriptKind = "chaoxing",
): Promise<DesktopUserScriptRelease> {
  const definition = scriptDefinition(kind);
  const source = await readUserScriptSource(definition.fileName);
  const header = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/)?.[1] ?? "";
  const name = metadataValue(header, "name");
  const version = metadataValue(header, "version");
  if (!name || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${definition.label}脚本缺少有效的名称或版本号`);
  }
  return {
    name,
    version,
    sha256: createHash("sha256").update(source, "utf8").digest("hex"),
    size: Buffer.byteLength(source, "utf8"),
    source,
  };
}
