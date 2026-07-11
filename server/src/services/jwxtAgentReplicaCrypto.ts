import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { JwxtSessionSnapshot } from "./jwxtClient";

export type AgentReplicaIdentity = { publicKey: string; privateKey: string };
export type AgentReplicaRecipient = { agentId: string; publicKey: string };
export type AgentEncryptedSessionReplica = {
  version: 1;
  recipientAgentId: string;
  algorithm: "rsa-oaep-sha256+aes-256-gcm";
  tokenHash: string;
  capturedAt: number;
  encryptedKey: string;
  iv: string;
  tag: string;
  ciphertext: string;
};
export type AgentEncryptedLoginCredentials = {
  version: 1;
  algorithm: "rsa-oaep-sha256+aes-256-gcm";
  encryptedKey: string;
  iv: string;
  ciphertext: string;
};

const AAD_CONTEXT = "cpu-web:jwxt-agent-replica:v1";
const LOGIN_AAD = Buffer.from("cpu-web:jwxt-agent-login:v1", "utf8");

export function generateAgentReplicaIdentity(): AgentReplicaIdentity {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001 });
  return {
    publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

export function loadOrCreateAgentReplicaIdentity(filePath: string) {
  const resolved = path.resolve(filePath);
  try {
    return validateIdentity(JSON.parse(fs.readFileSync(resolved, "utf8")));
  } catch (error) {
    if (fs.existsSync(resolved)) throw new Error(`JWXT Agent 加密身份文件无效: ${resolved}`, { cause: error });
  }
  const identity = generateAgentReplicaIdentity();
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  try {
    fs.writeFileSync(resolved, `${JSON.stringify(identity, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!fs.existsSync(resolved)) throw error;
    return validateIdentity(JSON.parse(fs.readFileSync(resolved, "utf8")));
  }
  try { fs.chmodSync(resolved, 0o600); } catch { /* Windows uses ACLs instead of POSIX modes. */ }
  return identity;
}

function validateIdentity(value: unknown): AgentReplicaIdentity {
  const candidate = value as Partial<AgentReplicaIdentity>;
  if (typeof candidate?.publicKey !== "string" || typeof candidate.privateKey !== "string") {
    throw new Error("identity fields are missing");
  }
  const privateKey = crypto.createPrivateKey({ key: Buffer.from(candidate.privateKey, "base64"), type: "pkcs8", format: "der" });
  const derivedPublic = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");
  if (derivedPublic !== candidate.publicKey) throw new Error("identity key pair does not match");
  return { publicKey: candidate.publicKey, privateKey: candidate.privateKey };
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function aad(agentId: string, tokenHash: string) {
  return Buffer.from(`${AAD_CONTEXT}:${agentId}:${tokenHash}`, "utf8");
}

export function encryptSessionSnapshotForRecipients(
  snapshot: JwxtSessionSnapshot,
  token: string,
  recipients: AgentReplicaRecipient[],
) {
  const unique = new Map(recipients.map((item) => [item.agentId, item]));
  if (unique.size > 32) throw new Error("too many JWXT replica recipients");
  const plaintext = Buffer.from(JSON.stringify(snapshot), "utf8");
  if (plaintext.length > 1024 * 1024) throw new Error("JWXT session snapshot is too large");
  const tokenHash = hashToken(token);
  return [...unique.values()].map((recipient): AgentEncryptedSessionReplica => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(recipient.agentId)) throw new Error("invalid replica recipient id");
    const publicKey = crypto.createPublicKey({ key: Buffer.from(recipient.publicKey, "base64"), type: "spki", format: "der" });
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(recipient.agentId, tokenHash));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      version: 1,
      recipientAgentId: recipient.agentId,
      algorithm: "rsa-oaep-sha256+aes-256-gcm",
      tokenHash,
      capturedAt: snapshot.lastSeenAt,
      encryptedKey: crypto.publicEncrypt({ key: publicKey, oaepHash: "sha256" }, key).toString("base64url"),
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
  });
}

export function decryptSessionSnapshotReplica(
  replica: AgentEncryptedSessionReplica,
  token: string,
  agentId: string,
  identity: AgentReplicaIdentity,
) {
  validateReplicaEnvelope(replica);
  const tokenHash = hashToken(token);
  if (replica.recipientAgentId !== agentId || replica.tokenHash !== tokenHash) {
    throw new Error("JWXT replica recipient or token binding mismatch");
  }
  const privateKey = crypto.createPrivateKey({ key: Buffer.from(identity.privateKey, "base64"), type: "pkcs8", format: "der" });
  const key = crypto.privateDecrypt({ key: privateKey, oaepHash: "sha256" }, Buffer.from(replica.encryptedKey, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(replica.iv, "base64url"));
  decipher.setAAD(aad(agentId, tokenHash));
  decipher.setAuthTag(Buffer.from(replica.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(replica.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as JwxtSessionSnapshot;
}

export function decryptAgentLoginCredentials(
  envelope: AgentEncryptedLoginCredentials,
  identity: AgentReplicaIdentity,
) {
  if (
    envelope?.version !== 1 || envelope.algorithm !== "rsa-oaep-sha256+aes-256-gcm"
    || typeof envelope.encryptedKey !== "string" || envelope.encryptedKey.length > 2048
    || typeof envelope.iv !== "string" || envelope.iv.length > 64
    || typeof envelope.ciphertext !== "string" || envelope.ciphertext.length > 32 * 1024
  ) throw new Error("invalid encrypted login credentials");
  const privateKey = crypto.createPrivateKey({ key: Buffer.from(identity.privateKey, "base64"), type: "pkcs8", format: "der" });
  const key = crypto.privateDecrypt({ key: privateKey, oaepHash: "sha256" }, Buffer.from(envelope.encryptedKey, "base64url"));
  const combined = Buffer.from(envelope.ciphertext, "base64url");
  if (combined.length < 17) throw new Error("encrypted login credentials are truncated");
  const ciphertext = combined.subarray(0, -16);
  const tag = combined.subarray(-16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
  decipher.setAAD(LOGIN_AAD);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plaintext) as { username?: unknown; password?: unknown; captcha?: unknown };
  if (
    typeof parsed.username !== "string" || !parsed.username || parsed.username.length > 128
    || typeof parsed.password !== "string" || !parsed.password || parsed.password.length > 1024
    || (parsed.captcha !== undefined && (typeof parsed.captcha !== "string" || parsed.captcha.length > 64))
  ) throw new Error("decrypted login credentials are invalid");
  return { username: parsed.username, password: parsed.password, ...(parsed.captcha ? { captcha: parsed.captcha } : {}) };
}

export function encryptAgentLoginCredentials(
  publicKey: string,
  credentials: { username: string; password: string; captcha?: string },
): AgentEncryptedLoginCredentials {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(LOGIN_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(credentials), "utf8")),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const recipientKey = crypto.createPublicKey({ key: Buffer.from(publicKey, "base64"), type: "spki", format: "der" });
  return {
    version: 1,
    algorithm: "rsa-oaep-sha256+aes-256-gcm",
    encryptedKey: crypto.publicEncrypt({ key: recipientKey, oaepHash: "sha256" }, key).toString("base64url"),
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function validateReplicaEnvelope(value: unknown): asserts value is AgentEncryptedSessionReplica {
  const replica = value as Partial<AgentEncryptedSessionReplica>;
  if (
    replica?.version !== 1 || replica.algorithm !== "rsa-oaep-sha256+aes-256-gcm"
    || typeof replica.recipientAgentId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(replica.recipientAgentId)
    || typeof replica.tokenHash !== "string" || replica.tokenHash.length !== 43
    || !Number.isFinite(replica.capturedAt)
    || typeof replica.encryptedKey !== "string" || typeof replica.iv !== "string"
    || typeof replica.tag !== "string" || typeof replica.ciphertext !== "string"
    || replica.encryptedKey.length > 2048 || replica.iv.length > 64 || replica.tag.length > 64
    || replica.ciphertext.length > 2 * 1024 * 1024
  ) throw new Error("invalid JWXT encrypted replica envelope");
}
