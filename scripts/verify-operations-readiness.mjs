import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const port = process.env.OPERATIONS_READINESS_VERIFY_PORT ?? "3106";
const appUrl = "https://honzang-production.up.railway.app";
const commitSha = "readiness-verify-commit";
const baseUrl = `http://127.0.0.1:${port}`;
const startupTimeoutMs = Number(process.env.OPERATIONS_READINESS_VERIFY_TIMEOUT_MS ?? 20_000);
const serverPath = ".next/standalone/server.js";

if (!existsSync(serverPath)) {
  console.error(`${serverPath} not found. Run npm run build before npm run verify:operations-readiness.`);
  process.exit(1);
}

const logs = [];
const serverEnv = {
  ...process.env,
  NODE_ENV: "production",
  PORT: port,
  DATABASE_URL: "",
  HONZANG_ACCESS_TOKEN_SALT: "verify-operations-readiness-salt",
  HONZANG_FILE_ENCRYPTION_KEY: "verify-operations-readiness-file-encryption-key",
  NEXT_PUBLIC_APP_URL: appUrl,
  RAILWAY_GIT_COMMIT_SHA: commitSha,
  RAILWAY_GIT_BRANCH: "main",
  RAILWAY_SERVICE_NAME: "honzang",
  RAILWAY_ENVIRONMENT_NAME: "production"
};
delete serverEnv.HONZANG_ACCESS_CODE;

const server = spawn("npm", ["run", "start"], {
  env: serverEnv,
  stdio: ["ignore", "pipe", "pipe"]
});

server.stdout.on("data", (chunk) => logs.push(chunk.toString()));
server.stderr.on("data", (chunk) => logs.push(chunk.toString()));

let serverExited = false;
server.on("exit", (code, signal) => {
  serverExited = true;
  logs.push(`server exited code=${code ?? "null"} signal=${signal ?? "null"}\n`);
});

try {
  await waitForServer();
  await verifyVersionMetadata();
  await verifyHealthSampleMode();
  await verifyOperationsReadiness();
  console.log(`Operations readiness verification passed at ${baseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("--- server logs ---");
  console.error(logs.join("").trim());
  process.exitCode = 1;
} finally {
  if (!serverExited) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}

async function verifyVersionMetadata() {
  await expectJson("/api/version", (body) => {
    assert.equal(body.app, "honzang", "/api/version should identify the app");
    assert.equal(body.environment, "production", "/api/version should expose production runtime");
    assert.equal(body.railway?.commitSha, commitSha, "/api/version should expose Railway commit metadata");
    assert.equal(body.railway?.branch, "main", "/api/version should expose Railway branch metadata");
    assert.equal(body.railway?.service, "honzang", "/api/version should expose Railway service metadata");
    assert.equal(body.railway?.environment, "production", "/api/version should expose Railway environment metadata");
  });
}

async function verifyHealthSampleMode() {
  await expectJson("/api/health", (body) => {
    assert.equal(body.ok, true, "/api/health should stay reachable without DATABASE_URL");
    assert.equal(body.mode, "sample", "/api/health should report sample mode without DATABASE_URL");
    assert.equal(body.database, "not_configured", "/api/health should report missing database configuration");
    assert.equal(body.schema?.status, "not_checked", "/api/health should report schema not checked without DATABASE_URL");
    assert.equal(body.schema?.requiredTables, 14, "/api/health should expose required table count without DATABASE_URL");
    assert.equal(body.railway?.commitSha, commitSha, "/api/health should expose Railway commit metadata");
  });
}

async function verifyOperationsReadiness() {
  await expectJson("/api/operations/readiness", (body) => {
    assert.equal(body.app, "honzang", "readiness response should identify the app");
    assert.equal(body.version, "0.1.0", "readiness response should expose package version");
    assert.match(body.generatedAt, /^\d{4}-\d{2}-\d{2}T/, "readiness response should include an ISO timestamp");
    assert.equal(body.summary?.blockers, 2, "readiness summary should block missing database and access code");
    assert.equal(body.summary?.warnings, 0, "readiness summary should not warn when app URL, salt, runtime, and Railway metadata are set");
    assert.equal(body.summary?.passes, 5, "readiness summary should count green checks");
    assert.equal(body.railway?.commitSha, commitSha, "readiness response should expose Railway commit metadata");
    assert.equal(body.railway?.branch, "main", "readiness response should expose Railway branch metadata");
    assert.equal(body.railway?.service, "honzang", "readiness response should expose Railway service metadata");
    assert.equal(body.railway?.environment, "production", "readiness response should expose Railway environment metadata");

    const checks = new Map(body.checks.map((check) => [check.key, check]));
    assert.deepEqual(
      [...checks.keys()],
      ["database", "databaseSchema", "accessCode", "accessSalt", "fileEncryption", "appUrl", "runtime", "railway"],
      "readiness checks should keep a stable order"
    );
    assertCheck(checks.get("database"), "Postgres 연결", "미설정", "red", "DATABASE_URL", "Railway Postgres");
    assertCheck(checks.get("databaseSchema"), "Postgres 스키마", "대기", "blue", "DATABASE_URL", "db:deploy");
    assertCheck(checks.get("accessCode"), "접근코드 보호", "미설정", "red", "HONZANG_ACCESS_CODE", "Railway Variables");
    assertCheck(checks.get("accessSalt"), "접근 쿠키 salt", "설정됨", "green", "배포 환경 전용 salt", "salt 보관");
    assertCheck(checks.get("fileEncryption"), "파일 암호화 키", "설정됨", "green", "원본 CSV와 DB 보관 증빙 파일", "키 교체");
    assertCheck(checks.get("appUrl"), "공개 앱 URL", "설정됨", "green", appUrl, "public domain");
    assertCheck(checks.get("runtime"), "서버 런타임", "production", "green", "프로덕션 빌드", "standalone 서버");
    assertCheck(checks.get("railway"), "Railway 메타데이터", "감지됨", "green", "service=honzang branch=main", "Deploy source commit");
  });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (serverExited) break;
    try {
      const response = await fetch(`${baseUrl}/api/version`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Server did not become ready within ${startupTimeoutMs}ms.`);
}

async function expectJson(path, inspect) {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  }
  inspect(JSON.parse(text));
}

function assertCheck(check, label, status, tone, detailPattern, actionPattern) {
  assert.ok(check, `${label} check should exist`);
  assert.equal(check.label, label, `${label} check should keep its label`);
  assert.equal(check.status, status, `${label} check should keep its status`);
  assert.equal(check.tone, tone, `${label} check should keep its tone`);
  assert.match(check.detail, new RegExp(escapeRegExp(detailPattern)), `${label} check should explain its detail`);
  assert.match(check.action, new RegExp(escapeRegExp(actionPattern)), `${label} check should explain its next action`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
