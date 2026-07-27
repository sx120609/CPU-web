import assert from "node:assert/strict";
import test from "node:test";
import { parseShareUrl, pickInstaller, PdsEntry, walkShareTree } from "../src/services/pdsShare";

test("PDS 文件夹分享会递归找到内部安装包", async () => {
  const tree = new Map<string, PdsEntry[]>([
    ["root", [
      { file_id: "windows", name: "Windows", type: "folder" },
      { file_id: "readme", name: "说明.txt", type: "file", size: 10 },
    ]],
    ["windows", [
      { file_id: "old", name: "药大拾间桌面端-0.1.0-win-x64-安装版.exe", type: "file", size: 80, updated_at: "2026-07-26T00:00:00Z" },
      { file_id: "new", name: "药大拾间桌面端-0.1.1-win-x64-安装版.exe", type: "file", size: 81, updated_at: "2026-07-27T00:00:00Z" },
    ]],
  ]);

  const files = await walkShareTree(async (parent) => tree.get(parent) ?? []);
  assert.equal(files.length, 3);
  assert.equal(pickInstaller(files)?.fileId, "new");
});

test("新的企业版文件夹分享链接能解析 domain 与 share id", () => {
  assert.deepEqual(
    parseShareUrl("https://bj37249.apps.aliyunfile.com/disk/s/TunDZWtpXk5?domainId=bj37249"),
    {
      apiBase: "https://bj37249.api.aliyunfile.com",
      shareId: "TunDZWtpXk5",
    },
  );
});
