import crypto from "node:crypto";
import { config } from "../config";

type EncryptedEnvelope = {
  version: 1 | 2;
  algorithm: "aes-256-gcm";
  keyId?: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

const KEY_CONTEXT = "cpu-web:jwxt-sensitive:v1";

function encryptionKey(secret: string) {
  return crypto.createHash("sha256").update(KEY_CONTEXT).update("\0").update(secret).digest();
}

function secrets() {
  return config.jwxtSessionSyncKeys.length
    ? config.jwxtSessionSyncKeys
    : [config.jwxtSessionSyncKey || config.jwtSecret];
}

function keyId(secret: string) {
  return crypto.createHash("sha256").update("key-id\0").update(secret).digest("base64url").slice(0, 16);
}

function aad(purpose: string, context: string) {
  const contextHash = crypto.createHash("sha256").update(context).digest("base64url");
  return Buffer.from(`${KEY_CONTEXT}:${purpose}:${contextHash}`, "utf8");
}

export function encryptJwxtSensitiveJson(purpose: string, context: string, value: unknown) {
  const iv = crypto.randomBytes(12);
  const secret = secrets()[0];
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(aad(purpose, context));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    version: 2,
    algorithm: "aes-256-gcm",
    keyId: keyId(secret),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
  return JSON.stringify(envelope);
}

export function decryptJwxtSensitiveJson<T>(
  purpose: string,
  context: string,
  raw: string,
  options: { allowLegacyPlaintext?: boolean } = {},
): { value: T; legacyPlaintext: boolean } {
  let parsed: Partial<EncryptedEnvelope>;
  try {
    parsed = JSON.parse(raw) as Partial<EncryptedEnvelope>;
  } catch {
    if (options.allowLegacyPlaintext) return { value: raw as T, legacyPlaintext: true };
    throw new Error("JWXT encrypted envelope is invalid");
  }
  if (
    (parsed?.version !== 1 && parsed?.version !== 2)
    || parsed.algorithm !== "aes-256-gcm"
    || typeof parsed.iv !== "string"
    || typeof parsed.tag !== "string"
    || typeof parsed.ciphertext !== "string"
    || (parsed.version === 2 && typeof parsed.keyId !== "string")
  ) {
    if (options.allowLegacyPlaintext) return { value: parsed as T, legacyPlaintext: true };
    throw new Error("JWXT encrypted envelope is invalid");
  }

  const iv = Buffer.from(parsed.iv, "base64url");
  const tag = Buffer.from(parsed.tag, "base64url");
  const ciphertext = Buffer.from(parsed.ciphertext, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 2 * 1024 * 1024) {
    throw new Error("JWXT encrypted envelope size is invalid");
  }
  const candidates = parsed.version === 2
    ? secrets().filter((secret) => keyId(secret) === parsed.keyId)
    : secrets();
  for (const secret of candidates) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
      decipher.setAAD(aad(purpose, context));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      return { value: JSON.parse(plaintext) as T, legacyPlaintext: false };
    } catch { /* try an older key during rotation */ }
  }
  throw new Error("JWXT encrypted envelope key is unavailable or authentication failed");
}
