import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const port = process.env.SMOKE_PORT ?? "3100";
const baseUrl = `http://127.0.0.1:${port}`;
const startupTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 20_000);
const serverPath = ".next/standalone/server.js";

if (!existsSync(serverPath)) {
  console.error(`${serverPath} not found. Run npm run build before npm run smoke:prod.`);
  process.exit(1);
}

const logs = [];
const server = spawn("npm", ["run", "start"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port
  },
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
  await expectJson("/api/version", (body) => body.app === "honzang" && body.environment === "production");
  await expectJson("/api/health", (body) => body.ok === true && body.app === "honzang");
  await expectJson("/api/reviews", (body) => Array.isArray(body.reviewItems));
  await expectJson("/api/vendors", (body) => Array.isArray(body.vendors));
  await expectJson("/api/audit-events", (body) => Array.isArray(body.auditEvents));
  await expectJson("/api/closing-periods", (body) => Array.isArray(body.closingPeriods));
  await expectJson("/api/operations/readiness", (body) =>
    body.app === "honzang" &&
    Array.isArray(body.checks) &&
    body.checks.some((check) => check.key === "database") &&
    body.checks.some((check) => check.key === "accessCode") &&
    Number.isInteger(body.summary?.blockers)
  );
  await expectText("/", (body) =>
    ["혼자장부", "최근 월 신고 준비", "오늘 할 일", "1인법인 신고 준비"].every((text) => body.includes(text))
  );
  await expectText("/?view=settings", (body) =>
    ["운영 준비 점검", "배포 환경 상태 확인", "전체 백업", "데이터 보관/삭제 기준"].every((text) => body.includes(text))
  );
  await expectText("/?view=journals", (body) =>
    ["자동분개 초안", "바로 승인", "검토 필요", "정상 초안"].every((text) => body.includes(text))
  );
  await expectText("/?view=reports", (body) =>
    ["혼자장부 신고 준비 리포트", "최종 신고 점검", "홈택스 제출 전 입력 가이드", "자료 수집 현황", "신고 패키지", "재무제표 초안", "현금흐름 요약", "복식부기 검증"].every((text) => body.includes(text))
  );
  console.log(`Production smoke passed at ${baseUrl}`);
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

async function expectJson(path, predicate) {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (!predicate(body)) {
    throw new Error(`${path} returned unexpected JSON: ${JSON.stringify(body)}`);
  }
}

async function expectText(path, predicate) {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${body}`);
  }
  if (!predicate(body)) {
    throw new Error(`${path} returned unexpected body.`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
