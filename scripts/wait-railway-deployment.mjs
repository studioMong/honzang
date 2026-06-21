import { execFileSync } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const baseUrl = (process.env.RAILWAY_PUBLIC_URL ?? "https://honzang-production.up.railway.app").replace(/\/$/, "");
const expectedCommit = process.env.RAILWAY_EXPECTED_COMMIT ?? currentGitCommit();
const timeoutMs = readPositiveInteger(process.env.RAILWAY_WAIT_TIMEOUT_MS, 600_000);
const intervalMs = readPositiveInteger(process.env.RAILWAY_WAIT_INTERVAL_MS, 15_000);
const startedAt = Date.now();
let attempt = 0;
let lastStatus = null;

if (!expectedCommit) {
  console.error("Unable to determine expected commit. Set RAILWAY_EXPECTED_COMMIT explicitly.");
  process.exit(1);
}

console.log(`Waiting for Railway deployment at ${baseUrl}`);
console.log(`Expected commit: ${expectedCommit}`);
console.log(`Timeout: ${timeoutMs}ms, interval: ${intervalMs}ms`);

while (Date.now() - startedAt <= timeoutMs) {
  attempt += 1;
  lastStatus = await inspectDeployment();

  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[${attempt}] ${elapsedSeconds}s deployed=${lastStatus.deployedCommit || "(missing)"} version=${lastStatus.versionOk ? "ok" : "fail"} db=${lastStatus.databaseStatus} access=${lastStatus.accessStatus}`
  );

  if (lastStatus.ready) {
    console.log(`Railway deployment is ready at ${baseUrl}`);
    process.exit(0);
  }

  if (Date.now() - startedAt + intervalMs > timeoutMs) break;
  await delay(intervalMs);
}

console.error("Railway deployment did not reach the expected state before timeout.");
if (lastStatus?.issues?.length) {
  console.error("Last issues:");
  for (const issue of lastStatus.issues) {
    console.error(`- ${issue}`);
  }
}
console.error("Run npm run audit:railway for a one-shot diagnostic report, then check Railway Deployments and Public Networking.");
process.exit(1);

async function inspectDeployment() {
  const issues = [];
  const version = await fetchJson("/api/version");
  const health = await fetchJson("/api/health");
  const session = await fetchJson("/api/auth/session");
  const manifest = await fetchJson("/manifest.webmanifest");

  const deployedCommit = version.body?.railway?.commitSha ?? "";
  const versionOk = version.ok && version.body?.app === "honzang";
  const commitOk = versionOk && commitMatches(deployedCommit, expectedCommit);
  const databaseStatus = health.body?.database ?? (health.ok ? "unknown" : "unreachable");
  const databaseOk = health.ok && health.body?.app === "honzang" && health.body?.ok === true && databaseStatus === "connected";
  const accessStatus = session.body?.enabled === true ? "enabled" : session.ok ? "disabled" : "unreachable";
  const accessOk = session.ok && session.body?.enabled === true && session.body?.authenticated === false;
  const manifestOk = manifest.ok && manifest.body?.name === "혼자장부" && manifest.body?.display === "standalone";

  if (!versionOk) issues.push(`/api/version is not serving honzang (${version.status})`);
  if (versionOk && !commitOk) issues.push(`commit mismatch expected=${expectedCommit} deployed=${deployedCommit || "(missing)"}`);
  if (!databaseOk) issues.push(`/api/health database is ${databaseStatus}`);
  if (!accessOk) issues.push(`/api/auth/session access protection is ${accessStatus}`);
  if (!manifestOk) issues.push("/manifest.webmanifest is not the honzang standalone manifest");

  return {
    ready: versionOk && commitOk && databaseOk && accessOk && manifestOk,
    versionOk,
    deployedCommit,
    databaseStatus,
    accessStatus,
    issues
  };
}

async function fetchJson(path) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return { ok: false, status: response.status, body: null };
    }
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

function currentGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function commitMatches(deployedCommit, expectedCommit) {
  return deployedCommit === expectedCommit || deployedCommit.startsWith(expectedCommit) || expectedCommit.startsWith(deployedCommit);
}

function readPositiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}
