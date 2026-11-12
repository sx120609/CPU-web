import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeQuestionnaire,
  questionnaireRequiresLogin,
  resolveQuestionnaireAccess,
} from "../src/services/questionnaires";

test("a public questionnaire is fillable without login, whatever the legacy anonymous flag says", () => {
  assert.equal(questionnaireRequiresLogin({ visibility: "public", oneResponsePerUser: false }), false);
  const row = { visibility: "public", allowAnonymous: false, oneResponsePerUser: false };
  const normalized = normalizeQuestionnaire(row);
  assert.equal(normalized.visibility, "public");
  assert.equal(normalized.allowAnonymous, true);
  assert.equal(normalized.oneResponsePerUser, false);
});

test("login-only and one-per-account questionnaires require login", () => {
  assert.equal(questionnaireRequiresLogin({ visibility: "login", oneResponsePerUser: false }), true);
  assert.equal(questionnaireRequiresLogin({ visibility: "public", oneResponsePerUser: true }), true);
});

test("the three stored settings are written as one consistent set", () => {
  assert.deepEqual(resolveQuestionnaireAccess({ visibility: "public", oneResponsePerUser: false }), {
    visibility: "public",
    allowAnonymous: true,
    oneResponsePerUser: false,
  });
  assert.deepEqual(resolveQuestionnaireAccess({ visibility: "login", oneResponsePerUser: false }), {
    visibility: "login",
    allowAnonymous: false,
    oneResponsePerUser: false,
  });
  // Limiting to one response needs an account to tell people apart, so it implies login.
  assert.deepEqual(resolveQuestionnaireAccess({ visibility: "public", oneResponsePerUser: true }), {
    visibility: "login",
    allowAnonymous: false,
    oneResponsePerUser: true,
  });
});
