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
  await expectInvalidClosingPeriod();
  await expectMissingClosingReadiness();
  await expectBlockedClosingPeriod();
  await expectInvalidCsvImportMapping();
  await expectInvalidCsvImportRows();
  await expectInvalidCsvOriginalFile();
  await expectInvalidManualTransactionDate();
  await expectInvalidManualTransactionAmounts();
  await expectInvalidTransactionPatch();
  await expectInvalidJournalDate();
  await expectInvalidJournalLines();
  await expectInvalidEvidenceDate();
  await expectInvalidEvidenceFile();
  await expectInvalidEvidenceFileUrl();
  await expectInvalidEvidenceAmounts();
  await expectInvalidReportPeriod();
  await expectInvalidReportPeriodRange();
  await expectText("/", (body) =>
    ["혼자장부", "최근 월 신고 준비", "오늘 할 일", "1인법인 신고 준비"].every((text) => body.includes(text))
  );
  await expectText("/?view=settings", (body) =>
    ["운영 준비 점검", "배포 환경 상태 확인", "전체 백업", "데이터 보관/삭제 기준", "CSV 매핑 템플릿"].every((text) => body.includes(text))
  );
  await expectText("/?view=journals", (body) =>
    ["자동분개 초안", "바로 승인", "검토 필요", "정상 초안"].every((text) => body.includes(text))
  );
  await expectText("/?view=reports", (body) =>
    ["혼자장부 신고 준비 리포트", "최종 신고 점검", "법인 기본정보", "홈택스 제출 전 입력 가이드", "기본정보", "자료 수집 현황", "신고 패키지", "재무제표 초안", "현금흐름 요약", "통장 잔액 대조", "복식부기 검증"].every((text) => body.includes(text))
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

async function expectBlockedClosingPeriod() {
  const response = await fetch(`${baseUrl}/api/closing-periods`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      period: "2026-06",
      summaryPayload: {
        report: {
          filingReadinessRows: [{ 점검: "증빙", 톤: "red" }]
        }
      }
    })
  });
  const text = await response.text();
  if (response.status !== 409) {
    throw new Error(`/api/closing-periods should block red filing readiness rows, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "FILING_READINESS_BLOCKED" || !Array.isArray(body.blockers) || body.blockers[0]?.check !== "증빙") {
    throw new Error(`/api/closing-periods returned unexpected blocker payload: ${text}`);
  }
}

async function expectInvalidClosingPeriod() {
  const response = await fetch(`${baseUrl}/api/closing-periods`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      period: "2026-13",
      summaryPayload: {
        filingReadinessRows: [{ 점검: "증빙", 톤: "green" }]
      }
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/closing-periods should reject invalid period months, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_CLOSING_PERIOD") {
    throw new Error(`/api/closing-periods returned unexpected invalid period payload: ${text}`);
  }
}

async function expectMissingClosingReadiness() {
  const response = await fetch(`${baseUrl}/api/closing-periods`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      period: "2026-06",
      summaryPayload: {
        transactionCount: 1
      }
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/closing-periods should require filing readiness rows, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "FILING_READINESS_REQUIRED") {
    throw new Error(`/api/closing-periods returned unexpected readiness-required payload: ${text}`);
  }
}

async function expectInvalidCsvImportMapping() {
  const response = await fetch(`${baseUrl}/api/imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceType: "BANK",
      originalFileName: "invalid-mapping.csv",
      mapping: {},
      headers: ["거래일", "적요", "입금"],
      rows: [
        {
          거래일: "2026-06-17",
          적요: "테스트 입금",
          입금: "1000"
        }
      ]
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/imports should reject missing CSV mappings, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_CSV_MAPPING" || !Array.isArray(body.issues) || body.issues.length < 3) {
    throw new Error(`/api/imports returned unexpected mapping validation payload: ${text}`);
  }
}

async function expectInvalidCsvImportRows() {
  const response = await fetch(`${baseUrl}/api/imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceType: "BANK",
      originalFileName: "invalid-rows.csv",
      mapping: {
        transactionDate: "거래일",
        description: "적요",
        depositAmount: "입금"
      },
      headers: ["거래일", "적요", "입금"],
      rows: [
        {
          거래일: "날짜아님",
          적요: "",
          입금: "0"
        }
      ]
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/imports should reject invalid CSV row values, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_CSV_ROWS" || !Array.isArray(body.issues) || body.issues.length < 3) {
    throw new Error(`/api/imports returned unexpected row validation payload: ${text}`);
  }
}

async function expectInvalidCsvOriginalFile() {
  const response = await fetch(`${baseUrl}/api/imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceType: "BANK",
      originalFileName: "invalid-original-size.csv",
      originalFileText: "거래일,적요,입금\n2026-06-17,테스트,1000\n",
      originalFileSize: 1,
      mapping: {
        transactionDate: "거래일",
        description: "적요",
        depositAmount: "입금"
      },
      headers: ["거래일", "적요", "입금"],
      rows: [
        {
          거래일: "2026-06-17",
          적요: "테스트",
          입금: "1000"
        }
      ]
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/imports should reject inconsistent original CSV metadata, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_ORIGINAL_FILE") {
    throw new Error(`/api/imports returned unexpected original file validation payload: ${text}`);
  }
}

async function expectInvalidManualTransactionDate() {
  const response = await fetch(`${baseUrl}/api/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionDate: "2026-02-31",
      description: "잘못된 날짜 수기 거래",
      depositAmount: 1000,
      withdrawalAmount: 0
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/transactions should reject invalid manual transaction dates, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_TRANSACTION_DATE") {
    throw new Error(`/api/transactions returned unexpected date validation payload: ${text}`);
  }
}

async function expectInvalidManualTransactionAmounts() {
  const response = await fetch(`${baseUrl}/api/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionDate: "2026-06-17",
      description: "잘못된 금액 수기 거래",
      depositAmount: 1000,
      withdrawalAmount: 1000
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/transactions should reject invalid manual transaction amounts, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_TRANSACTION_AMOUNTS") {
    throw new Error(`/api/transactions returned unexpected amount validation payload: ${text}`);
  }
}

async function expectInvalidTransactionPatch() {
  const response = await fetch(`${baseUrl}/api/transactions`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "sample-transaction",
      evidenceStatus: "BROKEN"
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/transactions should reject invalid patch payloads, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (!body.errors?.fieldErrors?.evidenceStatus?.length) {
    throw new Error(`/api/transactions returned unexpected patch validation payload: ${text}`);
  }
}

async function expectInvalidJournalDate() {
  const response = await fetch(`${baseUrl}/api/journals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entryDate: "2026-02-31",
      memo: "잘못된 날짜 분개",
      status: "APPROVED",
      lines: [
        {
          accountCode: "103",
          accountName: "보통예금",
          debitAmount: 1000,
          creditAmount: 0
        },
        {
          accountCode: "401",
          accountName: "매출",
          debitAmount: 0,
          creditAmount: 1000
        }
      ]
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/journals should reject invalid journal dates, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_JOURNAL_DATE") {
    throw new Error(`/api/journals returned unexpected date validation payload: ${text}`);
  }
}

async function expectInvalidJournalLines() {
  const response = await fetch(`${baseUrl}/api/journals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entryDate: "2026-06-17",
      memo: "잘못된 금액 라인 분개",
      status: "APPROVED",
      lines: [
        {
          accountCode: "103",
          accountName: "보통예금",
          debitAmount: 1000,
          creditAmount: 1000
        },
        {
          accountCode: "401",
          accountName: "매출",
          debitAmount: 0,
          creditAmount: 0
        }
      ]
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/journals should reject invalid journal lines, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_JOURNAL_LINES" || !Array.isArray(body.issues) || body.issues.length < 2) {
    throw new Error(`/api/journals returned unexpected line validation payload: ${text}`);
  }
}

async function expectInvalidEvidenceDate() {
  const response = await fetch(`${baseUrl}/api/evidences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      evidenceType: "전자세금계산서",
      issueDate: "2026-02-31"
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/evidences should reject invalid evidence dates, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_EVIDENCE_DATE") {
    throw new Error(`/api/evidences returned unexpected date validation payload: ${text}`);
  }
}

async function expectInvalidEvidenceFile() {
  const response = await fetch(`${baseUrl}/api/evidences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      evidenceType: "카드전표",
      issueDate: "2026-06-17",
      fileName: "receipt.txt",
      fileDataUrl: "data:text/plain;base64,SGVsbG8=",
      fileMimeType: "text/plain",
      fileSize: 999
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/evidences should reject inconsistent file payloads, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_EVIDENCE_FILE") {
    throw new Error(`/api/evidences returned unexpected file validation payload: ${text}`);
  }
}

async function expectInvalidEvidenceFileUrl() {
  const response = await fetch(`${baseUrl}/api/evidences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      evidenceType: "기타영수증",
      issueDate: "2026-06-17",
      fileUrl: "javascript:alert(1)"
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/evidences should reject unsafe file URLs, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_EVIDENCE_FILE_URL") {
    throw new Error(`/api/evidences returned unexpected file URL validation payload: ${text}`);
  }
}

async function expectInvalidEvidenceAmounts() {
  const response = await fetch(`${baseUrl}/api/evidences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      evidenceType: "전자세금계산서",
      issueDate: "2026-06-17",
      supplyAmount: 1000,
      vatAmount: 100,
      totalAmount: 1000
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/evidences should reject inconsistent amounts, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_EVIDENCE_AMOUNTS") {
    throw new Error(`/api/evidences returned unexpected amount validation payload: ${text}`);
  }
}

async function expectInvalidReportPeriod() {
  const response = await fetch(`${baseUrl}/api/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reportType: "CORPORATE_TAX_PREP",
      periodStart: "2026-02-31",
      periodEnd: "2026-12-31",
      calculatedPayload: {}
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/reports should reject invalid report periods, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_REPORT_PERIOD") {
    throw new Error(`/api/reports returned unexpected period validation payload: ${text}`);
  }
}

async function expectInvalidReportPeriodRange() {
  const response = await fetch(`${baseUrl}/api/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reportType: "CORPORATE_TAX_PREP",
      periodStart: "2026-12-31",
      periodEnd: "2026-01-01",
      calculatedPayload: {}
    })
  });
  const text = await response.text();
  if (response.status !== 400) {
    throw new Error(`/api/reports should reject reversed report periods, got HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (body.code !== "INVALID_REPORT_PERIOD_RANGE") {
    throw new Error(`/api/reports returned unexpected period range validation payload: ${text}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
