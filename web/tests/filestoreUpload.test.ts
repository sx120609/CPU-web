import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const compiledApi = ts.transpileModule(
  readFileSync(new URL("../src/api/filestore.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

function fixture(auth = { token: "cookie-session", csrf: "csrf-session-one" }) {
  let xhr: TestXhr;
  class TestXhr {
    upload = new EventTarget();
    events = new EventTarget();
    requestHeaders = new Headers();
    status = 0;
    responseText = "";
    method = "";
    url = "";
    form: FormData | null = null;
    constructor() { xhr = this; }
    addEventListener(name: string, callback: EventListener) { this.events.addEventListener(name, callback); }
    open(method: string, url: string) { this.method = method; this.url = url; }
    setRequestHeader(name: string, value: string) { this.requestHeaders.set(name, value); }
    send(form: FormData) { this.form = form; }
    respond(status: number, body: string) {
      this.status = status;
      this.responseText = body;
      this.events.dispatchEvent(new Event("load"));
    }
  }
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiledApi, {
    exports, Headers, XMLHttpRequest: TestXhr,
    require: (name: string) => {
      assert.equal(name, "@/api/request");
      return { COOKIE_SESSION_MARKER: "cookie-session", getToken: () => auth.token, getCsrfToken: () => auth.csrf };
    },
  });
  return { api: exports, auth, get xhr() { return xhr!; } };
}

for (const suffix of ["", "/complete-remote"]) {
  test(`multipart upload authenticates ${suffix || "ordinary submission"} and preserves browser form encoding`, async () => {
    const f = fixture();
    const form = new FormData();
    form.append("files", new Blob(["synthetic test file"]), "test.docx");
    const promise = f.api.filestoreUpload(`/api/submit/task${suffix}`, form, () => {});
    assert.equal(f.xhr.method, "POST");
    assert.equal(f.xhr.url, `/filestore/api/submit/task${suffix}`);
    assert.equal(f.xhr.requestHeaders.get("X-CSRF-Token"), f.auth.csrf);
    assert.equal(f.xhr.requestHeaders.get("X-CPU-Auth-Mode"), "cookie");
    assert.equal(f.xhr.requestHeaders.has("Authorization"), false);
    assert.equal(f.xhr.requestHeaders.has("Content-Type"), false);
    assert.equal(f.xhr.form, form);
    f.xhr.respond(200, '{"submissionId":123,"files":["test.docx"]}');
    assert.equal((await promise).submissionId, 123);
  });
}

test("each upload reads current credentials after another tab changes the session", async () => {
  const f = fixture();
  let promise = f.api.filestoreUpload("/api/submit/task", new FormData(), () => {});
  f.xhr.respond(200, "{}");
  await promise;
  f.auth.csrf = "csrf-session-two";
  f.auth.token = "legacy-bearer-token";
  promise = f.api.filestoreUpload("/api/submit/task", new FormData(), () => {});
  assert.equal(f.xhr.requestHeaders.get("X-CSRF-Token"), "csrf-session-two");
  assert.equal(f.xhr.requestHeaders.get("Authorization"), "Bearer legacy-bearer-token");
  f.xhr.respond(200, "{}");
  await promise;
});

test("anonymous submission does not invent credentials", async () => {
  const f = fixture({ token: "", csrf: "" });
  const promise = f.api.filestoreUpload("/api/submit/task", new FormData(), () => {});
  assert.equal(f.xhr.requestHeaders.has("X-CSRF-Token"), false);
  assert.equal(f.xhr.requestHeaders.has("Authorization"), false);
  f.xhr.respond(200, "{}");
  await promise;
});

test("sending all bytes does not resolve a rejected submission", async () => {
  const f = fixture();
  let loaded = 0;
  const promise = f.api.filestoreUpload("/api/submit/task", new FormData(), (bytes: number) => { loaded = bytes; });
  const progress = Object.assign(new Event("progress"), { lengthComputable: true, loaded: 100, total: 100 });
  f.xhr.upload.dispatchEvent(progress);
  assert.equal(loaded, 100);
  f.xhr.respond(403, '{"message":"CSRF 校验失败，请刷新页面后重试"}');
  await assert.rejects(promise, { status: 403, message: "CSRF 校验失败，请刷新页面后重试" });
});

test("proxy HTML responses reject instead of leaving the form stuck submitting", async () => {
  const f = fixture();
  const promise = f.api.filestoreUpload("/api/submit/task", new FormData(), () => {});
  f.xhr.respond(502, "<html>Bad Gateway</html>");
  await assert.rejects(promise, { status: 502, message: "上传响应格式异常，请稍后重试" });
});

test("network errors reject the upload", async () => {
  const f = fixture();
  const promise = f.api.filestoreUpload("/api/submit/task", new FormData(), () => {});
  f.xhr.events.dispatchEvent(new Event("error"));
  await assert.rejects(promise, { status: 0, message: "网络错误，提交失败" });
});
