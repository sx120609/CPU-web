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

export type DesktopUserScriptKind = "chaoxing" | "multiplatform";

const scriptDefinition = (kind: DesktopUserScriptKind) => kind === "multiplatform"
  ? {
      path: path.resolve(__dirname, "../../../desktop/assets/userscripts/multiplatform.js"),
      label: "多平台助手",
    }
  : {
      path: path.resolve(__dirname, "../../../desktop/assets/userscripts/monkey.js"),
      label: "学习通助手",
    };

const metadataValue = (header: string, key: string) =>
  new RegExp(`^\\s*//\\s*@${key}\\s+(.+?)\\s*$`, "m").exec(header)?.[1]?.trim() ?? "";

export async function readDesktopUserScriptRelease(
  kind: DesktopUserScriptKind = "chaoxing",
): Promise<DesktopUserScriptRelease> {
  const definition = scriptDefinition(kind);
  const source = await readFile(definition.path, "utf8");
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
