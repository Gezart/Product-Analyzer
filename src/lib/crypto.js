import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// AES-256-GCM. ENCRYPTION_KEY is 32 bytes, base64-encoded (openssl rand -base64 32).
function key() {
  const k = Buffer.from(env.encryptionKey, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (base64)");
  return k;
}

export function encrypt(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload) {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
