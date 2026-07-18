import assert from "node:assert/strict";
import test from "node:test";
import {
  buildModernJwxtEncodedCredentials,
  encodeModernJwxtInput,
  isModernJwxtLoginPage,
  parseModernJwxtLoginError,
  parseModernJwxtLoginPage,
} from "../src/services/modernJwxtLogin";

const loginHtml = `
  <html>
    <head><title>登录</title></head>
    <body>
      <form action="/jsxsd/xk/LoginToXk" method="post">
        <input name="userAccount">
        <input name="userPassword">
        <input name="RANDOMCODE">
        <input name="encoded">
      </form>
      <div id="showMsg">验证码错误</div>
      <script>
        function submitForm1() {
          var scode = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
          var sxh = "1111111111111111111111111111111111111111111111111111111";
        }
      </script>
    </body>
  </html>
`;

test("modern JWXT login page parser extracts only trusted login state", () => {
  const parsed = parseModernJwxtLoginPage(
    loginHtml,
    "https://jwxt.cpu.edu.cn/jsxsd/xskb/xskb_list.do?viweType=0",
  );
  assert.equal(parsed.loginUrl, "https://jwxt.cpu.edu.cn/jsxsd/xk/LoginToXk");
  assert.equal(parsed.scode.startsWith("abcdef"), true);
  assert.equal(parsed.sxh.length, 55);
  assert.equal(isModernJwxtLoginPage(loginHtml), true);
  assert.equal(parseModernJwxtLoginError(loginHtml), "验证码错误");
  assert.throws(
    () => parseModernJwxtLoginPage(loginHtml, "https://example.com/login"),
    /不受信任/,
  );
});

test("modern JWXT credential encoding matches the browser algorithm", () => {
  assert.equal(encodeModernJwxtInput("12"), "MTI=");
  assert.equal(encodeModernJwxtInput("ab"), "YWI=");
  assert.equal(encodeModernJwxtInput(" "), "IA==");

  const encoded = buildModernJwxtEncodedCredentials("12", "ab", {
    scode: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    sxh: "1".repeat(55),
  });
  assert.equal(encoded, "MaTbIc=d%e%f%gYhWiIj=k%l%m%nIoAp=q=r");
  assert.equal(encoded.includes("12"), false);
  assert.equal(encoded.includes("ab"), false);
});
