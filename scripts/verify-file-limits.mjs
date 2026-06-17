import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fileLimits = readText("src/lib/file-limits.ts");
const sourceFileValidation = readText("src/lib/server/source-file-validation.ts");
const evidenceValidation = readText("src/lib/server/evidence-validation.ts");
const importsRoute = readText("src/app/api/imports/route.ts");
const backupRestoreRoute = readText("src/app/api/backups/restore/route.ts");
const appWorkspace = readText("src/components/app-workspace.tsx");
const readme = readText("README.md");

assert.match(fileLimits, /MAX_EVIDENCE_FILE_SIZE = 750_000/, "Evidence file limit should stay centralized.");
assert.match(fileLimits, /MAX_EVIDENCE_FILE_DATA_URL_LENGTH = 1_500_000/, "Evidence data URL limit should stay centralized.");
assert.match(fileLimits, /MAX_ORIGINAL_FILE_TEXT_SIZE = 2_000_000/, "Original CSV limit should stay centralized.");
assert.match(fileLimits, /MAX_IMPORT_REQUEST_BYTES = MAX_ORIGINAL_FILE_TEXT_SIZE \+ 3_000_000/, "CSV import request limit should derive from the CSV text limit.");
assert.match(fileLimits, /MAX_BACKUP_RESTORE_REQUEST_BYTES = 25_000_000/, "Backup restore request limit should stay centralized.");

assert.match(sourceFileValidation, /from "@\/lib\/file-limits"/, "Source file validation should import shared file limits.");
assert.match(evidenceValidation, /from "@\/lib\/file-limits"/, "Evidence validation should import shared file limits.");
assert.match(importsRoute, /MAX_IMPORT_REQUEST_BYTES/, "Import route should use the shared import request limit.");
assert.match(backupRestoreRoute, /MAX_BACKUP_RESTORE_REQUEST_BYTES/, "Backup restore route should use the shared restore request limit.");
assert.match(appWorkspace, /buildJsonRequestBody/, "Client should validate backup restore JSON body size before sending.");
assert.match(appWorkspace, /MAX_BACKUP_RESTORE_REQUEST_BYTES/, "Client should use the shared backup restore limit.");

for (const expectedLine of [
  "- 원본 CSV 보관: 파일당 2MB 이하",
  "- CSV 가져오기 요청: JSON body 5MB 이하",
  "- DB 보관 증빙 파일: 파일당 750KB 이하",
  "- 백업 JSON 복원 요청: JSON body 25MB 이하",
  "- 일반 설정/장부 API 요청: JSON body 750KB 이하"
]) {
  assert.ok(readme.includes(expectedLine), `README should document limit: ${expectedLine}`);
}

console.log("File/request limit verification passed.");

function readText(path) {
  return readFileSync(path, "utf8");
}
