export type AgentEncryptedLoginCredentials = {
  version: 1;
  algorithm: "rsa-oaep-sha256+aes-256-gcm";
  encryptedKey: string;
  iv: string;
  ciphertext: string;
};

const LOGIN_AAD = new TextEncoder().encode("cpu-web:jwxt-agent-login:v1");

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function encryptAgentLoginCredentials(
  publicKey: string,
  credentials: { username: string; password: string; captcha?: string },
): Promise<AgentEncryptedLoginCredentials> {
  const rsaKey = await crypto.subtle.importKey(
    "spki",
    fromBase64(publicKey) as unknown as BufferSource,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const rawKey = await crypto.subtle.exportKey("raw", aesKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource, additionalData: LOGIN_AAD as unknown as BufferSource },
    aesKey,
    plaintext,
  );
  const encryptedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaKey, rawKey);
  return {
    version: 1,
    algorithm: "rsa-oaep-sha256+aes-256-gcm",
    encryptedKey: base64Url(encryptedKey),
    iv: base64Url(iv),
    ciphertext: base64Url(ciphertext),
  };
}
