import assert from "node:assert/strict";
import process from "node:process";

const baseUrl = (process.env.RAILWAY_PUBLIC_URL ?? "https://honzang-production.up.railway.app").replace(/\/$/, "");
const baseOrigin = new URL(baseUrl).origin;
const accessCode = (process.env.RAILWAY_ACCESS_CODE ?? process.env.VERIFY_DB_WORKFLOW_ACCESS_CODE ?? "").trim();
let accessCookie = normalizeCookie(process.env.RAILWAY_ACCESS_COOKIE ?? process.env.VERIFY_DB_WORKFLOW_ACCESS_COOKIE ?? "");

try {
  const publicSession = await expectJson("/api/auth/session");
  assert.equal(publicSession.enabled, true, "Railway authenticated verification requires access control to be enabled");

  if (!accessCookie) {
    if (!accessCode) {
      throw new Error("Set RAILWAY_ACCESS_CODE or VERIFY_DB_WORKFLOW_ACCESS_CODE before running authenticated Railway verification.");
    }
    accessCookie = await login(accessCode);
  }

  const authenticatedSession = await expectJson("/api/auth/session", { Cookie: accessCookie });
  assert.equal(authenticatedSession.authenticated, true, "access cookie should authenticate the Railway session");

  const companies = await expectJson("/api/companies", { Cookie: accessCookie });
  assert.equal(companies.mode, "database", "/api/companies should use database mode");
  assert.ok(companies.company?.id, "/api/companies should return a company id");

  const transactions = await expectJson("/api/transactions", { Cookie: accessCookie });
  assert.ok(Array.isArray(transactions.transactions), "/api/transactions should return a transaction list");

  const readiness = await expectJson("/api/operations/readiness", { Cookie: accessCookie });
  assert.ok(Array.isArray(readiness.checks), "/api/operations/readiness should return readiness checks");

  console.log(`Railway authenticated read verification passed at ${baseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`Railway authenticated read verification failed at ${baseUrl}`);
  process.exit(1);
}

async function login(code) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseOrigin },
    body: JSON.stringify({ code }),
    cache: "no-store"
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`/api/auth/login returned HTTP ${response.status}: ${text}`);
  }
  const cookie = normalizeCookie(response.headers.get("set-cookie") ?? "");
  assert.ok(cookie, "/api/auth/login should return an access cookie");
  return cookie;
}

async function expectJson(path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers,
    cache: "no-store"
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function normalizeCookie(value) {
  return value.split(";")[0]?.trim() ?? "";
}
