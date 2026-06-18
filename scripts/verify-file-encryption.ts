import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decryptStoredText,
  encryptedTextUnavailableMessage,
  encryptStoredText,
  isEncryptedStoredText,
  isFileEncryptionConfigured
} from "../src/lib/server/file-encryption";

const originalKey = process.env.HONZANG_FILE_ENCRYPTION_KEY;
const secretText = "원본 CSV와 증빙 파일 암호화 검증\n거래처,금액\n몽고객사,1100000";

try {
  delete process.env.HONZANG_FILE_ENCRYPTION_KEY;
  assert.equal(isFileEncryptionConfigured(), false, "file encryption should be disabled without a key");
  assert.equal(encryptStoredText(secretText), secretText, "missing key should keep local/dev storage backward compatible");
  assert.equal(decryptStoredText(secretText), secretText, "plain stored text should remain readable");
  assert.equal(decryptStoredText(null), null, "null stored text should remain null");

  process.env.HONZANG_FILE_ENCRYPTION_KEY = "verify-file-encryption-key";
  assert.equal(isFileEncryptionConfigured(), true, "file encryption should be enabled with a key");
  const encrypted = encryptStoredText(secretText);
  assert.ok(encrypted, "encrypted text should be returned");
  assert.equal(isEncryptedStoredText(encrypted), true, "encrypted text should be tagged");
  assert.notEqual(encrypted, secretText, "encrypted text should not equal plaintext");
  assert.equal(encrypted.includes("몽고객사"), false, "encrypted text should not expose Korean plaintext");
  assert.equal(decryptStoredText(encrypted), secretText, "encrypted text should decrypt with the same key");
  assert.equal(encryptStoredText(encrypted), encrypted, "already encrypted text should not be encrypted again");

  process.env.HONZANG_FILE_ENCRYPTION_KEY = "wrong-file-encryption-key";
  assert.equal(decryptStoredText(encrypted), null, "wrong key should not return corrupted plaintext");
  assert.equal(decryptStoredText("honzangenc:v1:not-valid"), null, "malformed encrypted text should not throw");
  assert.match(encryptedTextUnavailableMessage(), /HONZANG_FILE_ENCRYPTION_KEY/, "missing-key message should name the env var");

  const importsRoute = readFileSync("src/app/api/imports/route.ts", "utf8");
  const evidencesRoute = readFileSync("src/app/api/evidences/route.ts", "utf8");
  const backupRestoreRoute = readFileSync("src/app/api/backups/restore/route.ts", "utf8");
  const serializers = readFileSync("src/lib/server/serializers.ts", "utf8");
  const readinessRoute = readFileSync("src/app/api/operations/readiness/route.ts", "utf8");
  const readme = readFileSync("README.md", "utf8");
  const envExample = readFileSync(".env.example", "utf8");

  assert.match(importsRoute, /encryptStoredText\(payload\.originalFileText\)/, "CSV imports should encrypt stored original CSV text");
  assert.match(importsRoute, /decryptStoredText\(importBatch\.originalFileText\)/, "CSV original download should decrypt stored text");
  assert.match(evidencesRoute, /encryptStoredText\(payload\.fileDataUrl\)/, "evidence uploads should encrypt DB-stored file data URLs");
  assert.match(backupRestoreRoute, /encryptStoredText\(originalFile\?\.originalFileText\)/, "backup restore should encrypt restored original CSV text");
  assert.match(backupRestoreRoute, /encryptStoredText\(evidence\.fileDataUrl\)/, "backup restore should encrypt restored evidence files");
  assert.match(serializers, /decryptStoredText\(rawPayload\.fileDataUrl\)/, "evidence serialization should decrypt stored file data URLs");
  assert.match(readinessRoute, /fileEncryptionCheck/, "operations readiness should include file encryption status");
  assert.match(readme, /HONZANG_FILE_ENCRYPTION_KEY/, "README should document the file encryption key");
  assert.match(envExample, /HONZANG_FILE_ENCRYPTION_KEY/, ".env.example should include the file encryption key");

  console.log("File encryption verification passed.");
} finally {
  if (originalKey === undefined) {
    delete process.env.HONZANG_FILE_ENCRYPTION_KEY;
  } else {
    process.env.HONZANG_FILE_ENCRYPTION_KEY = originalKey;
  }
}
