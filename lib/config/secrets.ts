import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * AES-256-GCM for API keys saved from Admin. The key comes from
 * SETTINGS_ENCRYPTION_KEY (at least 32 characters); without it secrets cannot
 * be saved, and env values keep working. The setting key is bound as AAD, so a
 * ciphertext copied to another setting does not decrypt.
 */
const MIN_KEY_LENGTH = 32;

const storedSecret = z.object({
  v: z.literal(1),
  iv: z.base64(),
  tag: z.base64(),
  data: z.base64(),
});
export type StoredSecret = z.infer<typeof storedSecret>;

function encryptionKey(): Buffer | null {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!raw || raw.length < MIN_KEY_LENGTH) return null;
  return createHash("sha256").update(raw).digest();
}

export function secretsAvailable(): boolean {
  return encryptionKey() !== null;
}

export class SecretsUnavailableError extends Error {
  constructor() {
    super(`Set SETTINGS_ENCRYPTION_KEY (${MIN_KEY_LENGTH}+ characters) on the server to save API keys from Admin.`);
  }
}

export function encryptSecret(plain: string, settingKey: string): StoredSecret {
  const key = encryptionKey();
  if (!key) throw new SecretsUnavailableError();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(settingKey));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

/** `null` when the value is not a secret we wrote, or the key changed since. */
export function decryptSecret(stored: unknown, settingKey: string): string | null {
  const key = encryptionKey();
  const parsed = storedSecret.safeParse(stored);
  if (!key || !parsed.success) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.data.iv, "base64"));
    decipher.setAAD(Buffer.from(settingKey));
    decipher.setAuthTag(Buffer.from(parsed.data.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parsed.data.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
