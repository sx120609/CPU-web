import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTencentCosDeliveryUrl,
  buildTencentCosObjectKey,
  encodeObjectKey,
  stripTencentCosRoot,
} from "../src/services/tencentCos";

test("COS object keys stay inside the configured root", () => {
  assert.equal(
    buildTencentCosObjectKey("forum/2026-08/example image.png", "cpu-web-media/"),
    "cpu-web-media/forum/2026-08/example image.png",
  );
  assert.equal(
    stripTencentCosRoot("cpu-web-media/forum/a.png", "cpu-web-media"),
    "forum/a.png",
  );
  assert.equal(stripTencentCosRoot("another-root/a.png", "cpu-web-media"), "");
});

test("COS URL paths encode each object-key segment", () => {
  assert.equal(encodeObjectKey("头像/示例 1.png"), "%E5%A4%B4%E5%83%8F/%E7%A4%BA%E4%BE%8B%201.png");
});

test("COS delivery prefers the configured CDN domain and retains the object root", () => {
  assert.equal(
    buildTencentCosDeliveryUrl("web-static/assets/app.js", {
      bucket: "cputime-1462084442",
      region: "ap-shanghai",
      rootPath: "cpu-web-media",
      publicBaseUrl: "https://img.cputime.cn/",
    }),
    "https://img.cputime.cn/cpu-web-media/web-static/assets/app.js",
  );
  assert.equal(
    buildTencentCosDeliveryUrl("forum/示例 1.png", {
      bucket: "cputime-1462084442",
      region: "ap-shanghai",
      rootPath: "cpu-web-media",
      publicBaseUrl: "",
    }),
    "https://cputime-1462084442.cos.ap-shanghai.myqcloud.com/cpu-web-media/forum/%E7%A4%BA%E4%BE%8B%201.png",
  );
});

test("COS object paths reject traversal segments", () => {
  assert.throws(() => buildTencentCosObjectKey("../secret", "cpu-web-media"), /路径不合法/u);
});
