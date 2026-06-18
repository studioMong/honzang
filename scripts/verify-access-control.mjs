import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const port = process.env.ACCESS_CONTROL_VERIFY_PORT ?? "3104";
const accessCode = process.env.ACCESS_CONTROL_VERIFY_CODE ?? "verify-access-code";
const baseUrl = `http://127.0.0.1:${port}`;
const startupTimeoutMs = Number(process.env.ACCESS_CONTROL_VERIFY_TIMEOUT_MS ?? 20_000);
const serverPath = ".next/standalone/server.js";
const publicSampleCsvChecks = [
  ["/samples/bank-transactions.csv", "거래일"],
  ["/samples/card-transactions.csv", "승인번호"],
  ["/samples/hometax-sales.csv", "공급가액"],
  ["/samples/hometax-purchases.csv", "공급가액"],
  ["/samples/cash-receipts.csv", "승인번호"],
  ["/samples/pg-settlements.csv", "정산금액"]
];

if (!existsSync(serverPath)) {
  console.error(`${serverPath} not found. Run npm run build before npm run verify:access-control.`);
  process.exit(1);
}

const logs = [];
const server = spawn("npm", ["run", "start"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port,
    HONZANG_ACCESS_CODE: accessCode,
    HONZANG_ACCESS_TOKEN_SALT: "verify-access-token-salt"
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
  await verifyPublicHealth();
  await verifyPageRedirect();
  await verifyUnauthorizedApi();
  await verifyInvalidLoginPayload();
  await verifyOversizedLoginPayload();
  await verifyWrongCode();
  await verifyRateLimit();
  await verifyCrossOriginLogin();
  const cookie = await verifyLogin();
  await verifyAuthenticatedSession(cookie);
  await verifyAuthenticatedApi(cookie);
  await verifyCrossOriginMutation(cookie);
  await verifyLogout(cookie);
  console.log(`Access-control verification passed at ${baseUrl}`);
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

async function verifyPublicHealth() {
  await expectJson("/api/version", (body) => body.app === "honzang");
  await expectJson(
    "/api/health",
    (body) =>
      body.ok === true &&
      body.app === "honzang" &&
      typeof body.version === "string" &&
      ["sample", "database"].includes(body.mode) &&
      ["not_configured", "connected"].includes(body.database)
  );
  await expectJson("/api/auth/session", (body) => body.enabled === true && body.authenticated === false);
  for (const [path, expectedHeader] of publicSampleCsvChecks) {
    await expectText(path, (body) => body.includes(expectedHeader));
  }
}

async function verifyPageRedirect() {
  const response = await fetch(`${baseUrl}/?view=reports`, {
    cache: "no-store",
    redirect: "manual"
  });
  assert.ok([307, 308].includes(response.status), `root should redirect to access page, got HTTP ${response.status}`);
  const location = response.headers.get("location") ?? "";
  assert.match(location, /\/access\?next=%2F%3Fview%3Dreports|\/access\?next=%2F\?view=reports/, "redirect should preserve requested path");
}

async function verifyUnauthorizedApi() {
  const protectedApiCases = [
    { path: "/api/companies", method: "GET" },
    { path: "/api/transactions", method: "GET" },
    { path: "/api/evidences", method: "GET" },
    { path: "/api/journals", method: "GET" },
    { path: "/api/reviews", method: "GET" },
    { path: "/api/reports", method: "GET" },
    { path: "/api/reports/summary", method: "GET" },
    { path: "/api/vendors", method: "GET" },
    { path: "/api/audit-events", method: "GET" },
    { path: "/api/closing-periods", method: "GET" },
    { path: "/api/operations/readiness", method: "GET" },
    { path: "/api/classification-rules", method: "DELETE", body: { id: "verify-rule" } },
    { path: "/api/csv-templates", method: "DELETE", body: { id: "verify-template" } },
    { path: "/api/transactions", method: "DELETE", body: { id: "verify-transaction" } },
    { path: "/api/backups/restore", method: "POST", body: { backup: {}, dryRun: true } }
  ];

  for (const item of protectedApiCases) {
    const response = await fetch(`${baseUrl}${item.path}`, {
      method: item.method,
      headers: item.body ? { "Content-Type": "application/json" } : undefined,
      body: item.body ? JSON.stringify(item.body) : undefined,
      cache: "no-store"
    });
    const body = await response.json();
    assert.equal(response.status, 401, `${item.method} ${item.path} should require access cookie`);
    assert.equal(body.code, "AUTH_REQUIRED", `${item.method} ${item.path} should identify auth requirement`);
  }
}

async function verifyWrongCode() {
  const response = await postLogin("wrong-code", "203.0.113.10");
  assert.equal(response.status, 401, "wrong access code should be rejected");
  const body = await response.json();
  assert.equal(body.remainingAttempts, 4, "wrong code response should expose remaining attempts");
}

async function verifyInvalidLoginPayload() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.11" },
    body: "{",
    cache: "no-store"
  });
  assert.equal(response.status, 400, "invalid login JSON should be rejected");
  const body = await response.json();
  assert.equal(body.code, "INVALID_LOGIN_PAYLOAD", "invalid login JSON should return a payload code");
}

async function verifyOversizedLoginPayload() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.12" },
    body: JSON.stringify({ code: "x".repeat(2_100) }),
    cache: "no-store"
  });
  assert.equal(response.status, 413, "oversized login payload should be rejected");
  const body = await response.json();
  assert.equal(body.code, "LOGIN_PAYLOAD_TOO_LARGE", "oversized login payload should return a size code");
}

async function verifyRateLimit() {
  const ip = "203.0.113.20";
  for (let index = 0; index < 4; index += 1) {
    const response = await postLogin(`wrong-code-${index}`, ip);
    assert.equal(response.status, 401, `wrong code attempt ${index + 1} should return HTTP 401`);
  }

  const limitedResponse = await postLogin("wrong-code-limit", ip);
  assert.equal(limitedResponse.status, 429, "fifth wrong code attempt should be rate-limited");
  assert.ok(Number(limitedResponse.headers.get("retry-after")) > 0, "rate-limited response should expose retry-after");

  const stillLimitedResponse = await postLogin(accessCode, ip);
  assert.equal(stillLimitedResponse.status, 429, "correct code from a locked source should remain rate-limited");
}

async function verifyCrossOriginLogin() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://malicious.example", "x-forwarded-for": "203.0.113.25" },
    body: JSON.stringify({ code: accessCode }),
    cache: "no-store"
  });
  assert.equal(response.status, 403, "cross-origin login mutation should be rejected");
  const body = await response.json();
  assert.equal(body.code, "INVALID_ORIGIN", "cross-origin login should identify invalid origin");
}

async function verifyLogin() {
  const response = await postLogin(accessCode, "203.0.113.30");
  assert.equal(response.status, 200, "correct access code should be accepted");
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /honzang_access=/, "login should set access cookie");
  assert.match(setCookie, /HttpOnly/i, "access cookie should be HTTP-only");
  assert.match(setCookie, /Secure/i, "production access cookie should be secure");
  assert.match(setCookie, /SameSite=Lax/i, "access cookie should use SameSite=Lax");
  assert.match(setCookie, /Max-Age=604800/i, "access cookie should expire after seven days");
  const cookie = setCookie.split(";")[0];
  assert.ok(cookie.includes("=") && !cookie.endsWith("="), "access cookie should contain a token");
  return cookie;
}

async function verifyAuthenticatedSession(cookie) {
  await expectJson("/api/auth/session", (body) => body.enabled === true && body.authenticated === true, { Cookie: cookie });
}

async function verifyAuthenticatedApi(cookie) {
  await expectJson("/api/transactions", (body) => Array.isArray(body.transactions), { Cookie: cookie });
  await expectJson(
    "/api/operations/readiness",
    (body) =>
      Array.isArray(body.checks) &&
      body.checks.some((check) => check.key === "accessCode" && check.tone === "green") &&
      body.checks.some((check) => check.key === "accessSalt" && check.tone === "green"),
    { Cookie: cookie }
  );
}

async function verifyCrossOriginMutation(cookie) {
  const response = await fetch(`${baseUrl}/api/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "https://malicious.example" },
    body: JSON.stringify({ description: "blocked" }),
    cache: "no-store"
  });
  assert.equal(response.status, 403, "cross-origin authenticated mutation should be rejected before route handling");
  const body = await response.json();
  assert.equal(body.code, "INVALID_ORIGIN", "cross-origin authenticated mutation should identify invalid origin");
}

async function verifyLogout(cookie) {
  const response = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: baseUrl },
    cache: "no-store"
  });
  assert.equal(response.status, 200, "logout should succeed");
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /Max-Age=0/, "logout should clear access cookie");
}

async function postLogin(code, ip = "203.0.113.30") {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ code }),
    cache: "no-store"
  });
}

async function expectJson(path, predicate, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers,
    cache: "no-store"
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  }
  const body = JSON.parse(text);
  assert.ok(predicate(body), `${path} returned unexpected JSON: ${JSON.stringify(body)}`);
}

async function expectText(path, predicate, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers,
    cache: "no-store"
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${body}`);
  }
  assert.ok(predicate(body), `${path} returned unexpected body.`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
