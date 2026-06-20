import assert from "node:assert/strict";
import process from "node:process";

const baseUrl = (process.env.RAILWAY_PUBLIC_URL ?? "https://honzang-production.up.railway.app").replace(/\/$/, "");
const expectEnabled = process.env.RAILWAY_ACCESS_EXPECT_ENABLED !== "0";

try {
  const session = await expectJson("/api/auth/session");
  assert.equal(session.enabled, expectEnabled, `/api/auth/session should report enabled=${expectEnabled}`);

  if (expectEnabled) {
    assert.equal(session.authenticated, false, "anonymous public session should not be authenticated");
    await expectPageRedirect();
    await expectProtectedApi();
  }

  await expectPublicResource("/api/version");
  await expectPublicResource("/api/health");
  await expectPublicResource("/manifest.webmanifest");
  await expectPublicResource("/samples/bank-transactions.csv", "text");
  console.log(`Railway access verification passed at ${baseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`Railway access verification failed at ${baseUrl}`);
  process.exit(1);
}

async function expectPageRedirect() {
  const response = await fetch(`${baseUrl}/?view=reports`, {
    cache: "no-store",
    redirect: "manual"
  });
  assert.ok([307, 308].includes(response.status), `root reports page should redirect to access page, got HTTP ${response.status}`);
  const location = response.headers.get("location") ?? "";
  assert.match(location, /\/access/, "redirect location should point to /access");
  assert.match(location, /next=/, "redirect location should preserve the requested path");
}

async function expectProtectedApi() {
  const response = await fetch(`${baseUrl}/api/transactions`, { cache: "no-store" });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  assert.equal(response.status, 401, "/api/transactions should reject anonymous requests");
  assert.equal(body.code, "AUTH_REQUIRED", "/api/transactions should identify the auth requirement");
}

async function expectPublicResource(path, kind = "json") {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  }
  if (kind === "json") {
    JSON.parse(text);
  }
}

async function expectJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}
