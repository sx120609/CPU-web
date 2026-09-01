import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAliyunOssDeliveryUrl,
  buildAliyunOssObjectKey,
  encodeObjectKey,
  stripAliyunOssRoot,
} from "../src/services/aliyunOss";

test("OSS object keys stay inside the configured root", () => {
  assert.equal(
    buildAliyunOssObjectKey("forum/2026-09/example image.png", "cpu-web-media/"),
    "cpu-web-media/forum/2026-09/example image.png",
  );
  assert.equal(stripAliyunOssRoot("cpu-web-media/forum/a.png", "cpu-web-media"), "forum/a.png");
  assert.equal(stripAliyunOssRoot("another-root/a.png", "cpu-web-media"), "");
});

test("OSS URL paths encode each object-key segment", () => {
  assert.equal(encodeObjectKey("头像/示例 1.png"), "%E5%A4%B4%E5%83%8F/%E7%A4%BA%E4%BE%8B%201.png");
});

test("OSS delivery prefers ESA and retains the object root", () => {
  assert.equal(
    buildAliyunOssDeliveryUrl("web-static/assets/app.js", {
      bucket: "cputime-static-20260901",
      region: "oss-cn-shanghai",
      rootPath: "cpu-web-media",
      publicBaseUrl: "https://static.cputime.cn/",
    }),
    "https://static.cputime.cn/cpu-web-media/web-static/assets/app.js",
  );
  assert.equal(
    buildAliyunOssDeliveryUrl("forum/示例 1.png", {
      bucket: "cputime-static-20260901",
      region: "oss-cn-shanghai",
      rootPath: "cpu-web-media",
      publicBaseUrl: "",
    }),
    "https://cputime-static-20260901.oss-cn-shanghai.aliyuncs.com/cpu-web-media/forum/%E7%A4%BA%E4%BE%8B%201.png",
  );
});

test("OSS object paths reject traversal segments", () => {
  assert.throws(() => buildAliyunOssObjectKey("../secret", "cpu-web-media"), /路径不合法/u);
});
