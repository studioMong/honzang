import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const port = process.env.ACCESS_SALT_VERIFY_PORT ?? "3109";
const accessCode = process.env.ACCESS_SALT_VERIFY_CODE ?? "verify-access-code";
const baseUrl = `http://127.0.0.1:${port}`;
const startupTimeoutMs = Number(process.env.ACCESS_SALT_VERIFY_TIMEOUT_MS ?? 20_000);
const serverPath = ".next/standalone/server.js";

if (!existsSync(serverPath)) {
  console.error(`${serverPath} not found. Run npm run build before npm run verify:access-salt.`);
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: port,
  HONZANG_ACCESS_CODE: accessCode
};
delete env.HONZANG_ACCESS_TOKEN_SALT;

const logs = [];
const server = spawn("npm", ["run", "start"], {
  env,
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
  await verifySaltDiagnostic();
  await verifyLoginFailsClosed();
  console.log(`Access salt production guard verification passed at ${baseUrl}`);
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

async function verifySaltDiagnostic() {
  const response = await fetch(`${baseUrl}/api/auth/session`, { cache: "no-store" });
  const body = await response.json();
  assert.equal(response.status, 200, "session diagnostic should remain public");
  assert.equal(body.enabled, true, "access control should be enabled when HONZANG_ACCESS_CODE is set");
  assert.equal(body.authenticated, false, "missing salt should not authenticate anonymous users");
}

async function verifyLoginFailsClosed() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.50"
    },
    body: JSON.stringify({ code: accessCode }),
    cache: "no-store"
  });
  const body = await response.json();
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.equal(response.status, 500, "production login should fail closed when access token salt is missing");
  assert.equal(body.ok, false, "missing salt login response should be unsuccessful");
  assert.match(body.message, /salt/, "missing salt login response should identify the salt setting");
  assert.equal(setCookie, "", "missing salt login should not set an access cookie");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
