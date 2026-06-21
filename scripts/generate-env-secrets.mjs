import { randomBytes } from "node:crypto";

const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://honzang-production.up.railway.app";
const accessCode = process.env.HONZANG_ACCESS_CODE?.trim() || `hz-${randomToken(18)}`;

const variables = {
  NEXT_PUBLIC_APP_URL: appUrl,
  HONZANG_ACCESS_CODE: accessCode,
  HONZANG_ACCESS_TOKEN_SALT: randomSecret(),
  HONZANG_FILE_ENCRYPTION_KEY: randomSecret()
};

console.log("# Railway Variables");
console.log("# DATABASE_URL은 Railway Postgres reference variable로 연결하세요.");
for (const [key, value] of Object.entries(variables)) {
  console.log(`${key}=${quote(value)}`);
}
console.log("");
console.log("# 생성된 값은 다시 조회할 수 없으므로 안전한 비밀번호 관리자에 보관하세요.");
console.log("# HONZANG_ACCESS_TOKEN_SALT 또는 HONZANG_ACCESS_CODE를 바꾸면 기존 접근 쿠키는 무효화됩니다.");
console.log("# HONZANG_FILE_ENCRYPTION_KEY를 바꾸기 전에는 기존 원본 CSV/증빙 파일 백업과 복원 계획을 먼저 확인하세요.");

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

function randomToken(length) {
  return randomBytes(length).toString("base64url").slice(0, length);
}

function quote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
