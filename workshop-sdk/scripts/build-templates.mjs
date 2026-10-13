import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pack, scaffold } from "../bin/cli.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = await mkdtemp(join(tmpdir(), "cpu-workshop-templates-"));
try {
  for (const type of ["game", "tool", "extension"]) {
    const source = await scaffold(type, join(scratch, type));
    const output = join(project, "web/public/workshop", `${type}-template.zip`);
    const result = await pack(source, output);
    console.log(`${type} template: ${result.files} files → ${output}`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
