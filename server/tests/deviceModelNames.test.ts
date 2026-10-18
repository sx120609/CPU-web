import assert from "node:assert/strict";
import test from "node:test";
import { deviceModelName, groupDeviceModels } from "../src/services/deviceModelNames";

test("model codes reported by Android and HarmonyOS map to market names", () => {
  assert.equal(deviceModelName("24129PN74C"), "Xiaomi 15");
  assert.equal(deviceModelName("V2509A"), "vivo X300");
  assert.equal(deviceModelName("PLJ110"), "OPPO Find X9");
  assert.equal(deviceModelName("ALN-AL00"), "HUAWEI Mate 60 Pro");
  assert.equal(deviceModelName("DNN-AN00"), "荣耀 400");
  assert.equal(deviceModelName("SM-W7024"), "三星 W24 Flip");
  // Some vendors report the code in lower case or with stray spaces.
  assert.equal(deviceModelName(" v2509a "), "vivo X300");
  assert.equal(deviceModelName("unknown"), null);
});

test("codes with one name form one row; unknown codes keep their own row", () => {
  const groups = groupDeviceModels(new Map([["A1", 2], ["A2", 3], ["B", 4], ["C", 1]]), (code) => (code.startsWith("A") ? "Phone A" : null));
  assert.deepEqual(groups, [
    { deviceModel: "A2", deviceModels: ["A2", "A1"], name: "Phone A", named: true, count: 5 },
    { deviceModel: "B", deviceModels: ["B"], name: "B", named: false, count: 4 },
    { deviceModel: "C", deviceModels: ["C"], name: "C", named: false, count: 1 },
  ]);
  // An unknown code that happens to equal a market name is not merged into it.
  assert.equal(groupDeviceModels(new Map([["X", 1], ["Phone A", 1]]), (code) => (code === "X" ? "Phone A" : null)).length, 2);
});
