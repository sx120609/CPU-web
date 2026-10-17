import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../python/zhihuishu/", import.meta.url));
const target = fileURLToPath(new URL("../dist/python/zhihuishu/", import.meta.url));
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, filter: entry => !entry.includes("__pycache__") && !entry.endsWith(".pyc") });
