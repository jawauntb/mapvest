import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sessionSigningKey } from "./env.js";

/** AES-256-GCM encrypt using a key derived from SESSION_SIGNING_KEY. */
export function encryptSecret(plaintext: string): string {
  const key = createHash("sha256").update(sessionSigningKey()).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const [ver, ivB64, tagB64, dataB64] = payload.split(".");
  if (ver !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("invalid secret payload");
  }
  const key = createHash("sha256").update(sessionSigningKey()).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
