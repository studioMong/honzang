import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTED_TEXT_PREFIX = "honzangenc:v1:";
const KEY_ENV = "HONZANG_FILE_ENCRYPTION_KEY";

export function isFileEncryptionConfigured() {
  return Boolean(process.env[KEY_ENV]?.trim());
}

export function isEncryptedStoredText(value: string | null | undefined) {
  return Boolean(value?.startsWith(ENCRYPTED_TEXT_PREFIX));
}

export function encryptStoredText(value: string | null | undefined) {
  if (!value || isEncryptedStoredText(value)) return value ?? null;
  const key = encryptionKey();
  if (!key) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_TEXT_PREFIX}${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptStoredText(value: string | null | undefined) {
  if (!value) return value ?? null;
  if (!isEncryptedStoredText(value)) return value;

  const key = encryptionKey();
  if (!key) return null;

  const parts = value.slice(ENCRYPTED_TEXT_PREFIX.length).split(":");
  if (parts.length !== 3) return null;

  try {
    const [ivText, authTagText, encryptedText] = parts;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(authTagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function encryptedTextUnavailableMessage() {
  return `${KEY_ENV}가 없어 암호화된 파일을 복호화할 수 없습니다. Railway Variables의 파일 암호화 키를 확인하세요.`;
}

function encryptionKey() {
  const secret = process.env[KEY_ENV]?.trim();
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}
