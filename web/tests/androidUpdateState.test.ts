import assert from "node:assert/strict";
import test from "node:test";
import { parseAndroidUpdateState } from "../src/utils/androidUpdateState";
test("restored ready and failed jobs retain their recovery actions",()=>{
  assert.equal(parseAndroidUpdateState('{"phase":"ready"}').progress,100);
  assert.equal(parseAndroidUpdateState('{"phase":"permission"}').phase,"permission");
  assert.equal(parseAndroidUpdateState('{"phase":"failed","message":"断网","errorCode":"download_1"}').message,"断网");
});
test("malformed bridge states cannot corrupt update progress",()=>{
  assert.equal(parseAndroidUpdateState('invalid').phase,"idle");
  assert.equal(parseAndroidUpdateState('{"phase":"unknown"}').phase,"idle");
  assert.equal(parseAndroidUpdateState('{"phase":"downloading","progress":999}').progress,100);
});
