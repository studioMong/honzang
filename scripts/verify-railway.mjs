import assert from "node:assert/strict";
import process from "node:process";

const baseUrl = (process.env.RAILWAY_PUBLIC_URL ?? "https://honzang-production.up.railway.app").replace(/\/$/, "");
const expectedCommit = process.env.RAILWAY_EXPECTED_COMMIT ?? null;
const allowNoDatabase = process.env.RAILWAY_VERIFY_ALLOW_NO_DB === "1";
const requireRailwayMetadata = process.env.RAILWAY_VERIFY_REQUIRE_METADATA !== "0" && baseUrl.includes("railway.app");

try {
  const version = await expectJson("/api/version");
  assert.equal(version.app, "honzang", "/api/version should expose the honzang app name");
  assert.ok(version.environment === "production" || !baseUrl.includes("railway.app"), "/api/version should report production on Railway");

  if (expectedCommit) {
    assert.equal(version.railway?.commitSha, expectedCommit, `/api/version should expose Railway commit ${expectedCommit}`);
  }
  if (requireRailwayMetadata) {
    assert.ok(version.railway?.commitSha, "/api/version should expose RAILWAY_GIT_COMMIT_SHA");
    assert.ok(version.railway?.service, "/api/version should expose RAILWAY_SERVICE_NAME");
  }

  const health = await expectJson("/api/health");
  assert.equal(health.app, "honzang", "/api/health should expose the honzang app name");
  assert.equal(health.ok, true, "/api/health should be ok");
  if (!allowNoDatabase) {
    assert.equal(health.database, "connected", "/api/health should report a connected Railway Postgres database");
  }

  const home = await expectText("/");
  assert.match(home, /혼자장부/, "root page should include 혼자장부");
  assert.doesNotMatch(home, /프로젝트 정리/, "root page should not be the legacy static project summary");

  const manifest = await expectJson("/manifest.webmanifest");
  assert.equal(manifest.name, "혼자장부", "manifest should expose app name");
  assert.equal(manifest.display, "standalone", "manifest should expose standalone display mode");

  console.log(`Railway verification passed at ${baseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`Railway verification failed at ${baseUrl}`);
  console.error("Check that the public domain is attached to the Next.js service built from the latest main branch commit, and that DATABASE_URL is configured.");
  await printDiagnostics();
  process.exit(1);
}

async function expectJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON: ${text.slice(0, 160)}`);
  }
}

async function expectText(path) {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  }
  return text;
}

async function printDiagnostics() {
  console.error("Railway response diagnostics:");

  for (const path of ["/", "/api/version", "/api/health", "/manifest.webmanifest"]) {
    try {
      const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "unknown";
      console.error(`- ${path}: HTTP ${response.status}, content-type=${contentType}, bytes=${Buffer.byteLength(text, "utf8")}`);

      if (path === "/") {
        if (/프로젝트 정리/.test(text)) {
          console.error("  root page appears to be the legacy static project summary.");
        }
        if (/__next|self\.__next_f/.test(text)) {
          console.error("  root page contains Next.js runtime markers.");
        }
      }

      if (path.startsWith("/api/") && text && !contentType.includes("application/json")) {
        console.error(`  body preview: ${text.slice(0, 120)}`);
      }
    } catch (diagnosticError) {
      console.error(`- ${path}: diagnostics failed: ${diagnosticError instanceof Error ? diagnosticError.message : diagnosticError}`);
    }
  }
}
