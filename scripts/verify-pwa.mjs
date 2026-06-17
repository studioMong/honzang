import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const port = process.env.PWA_VERIFY_PORT ?? "3101";
const baseUrl = `http://127.0.0.1:${port}`;
const startupTimeoutMs = Number(process.env.PWA_VERIFY_TIMEOUT_MS ?? 20_000);
const serverPath = ".next/standalone/server.js";

if (!existsSync(serverPath)) {
  console.error(`${serverPath} not found. Run npm run build before npm run verify:pwa.`);
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
  await verifyManifest();
  await verifyServiceWorker();
  await verifyOfflinePage();
  await verifyIcon();
  verifyRegistrationSource();
  console.log(`PWA verification passed at ${baseUrl}`);
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
      const response = await fetch(`${baseUrl}/manifest.webmanifest`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Server did not become ready within ${startupTimeoutMs}ms.`);
}

async function verifyManifest() {
  const response = await fetch(`${baseUrl}/manifest.webmanifest`, { cache: "no-store" });
  assert.equal(response.status, 200, "manifest should return HTTP 200");
  assert.match(response.headers.get("content-type") ?? "", /application\/manifest\+json|application\/json/i, "manifest should be JSON");

  const manifest = await response.json();
  assert.equal(manifest.name, "혼자장부", "manifest should expose app name");
  assert.equal(manifest.short_name, "혼자장부", "manifest should expose short app name");
  assert.equal(manifest.display, "standalone", "manifest should use standalone display mode");
  assert.equal(manifest.start_url, "/", "manifest should start at root");
  assert.equal(manifest.scope, "/", "manifest should scope root");
  assert.equal(manifest.theme_color, "#116149", "manifest should expose theme color");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "manifest should include app icons");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"), "manifest should include a maskable icon");
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.some((shortcut) => shortcut.url === "/?view=imports"), "manifest should include CSV upload shortcut");
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url === "/?view=reports"), "manifest should include report shortcut");
}

async function verifyServiceWorker() {
  const response = await fetch(`${baseUrl}/sw.js`, { cache: "no-store" });
  assert.equal(response.status, 200, "service worker should return HTTP 200");
  assert.match(response.headers.get("content-type") ?? "", /javascript|text\/plain/i, "service worker should be served as script-compatible content");
  const body = await response.text();
  assert.match(body, /CACHE_NAME/, "service worker should define a cache name");
  assert.match(body, /OFFLINE_URL\s*=\s*"\/offline\.html"/, "service worker should cache offline page");
  assert.match(body, /addEventListener\("install"/, "service worker should handle install");
  assert.match(body, /addEventListener\("fetch"/, "service worker should handle fetch");
  assert.match(body, /request\.mode\s*===\s*"navigate"/, "service worker should handle navigations");
  assert.match(body, /caches\.match\(OFFLINE_URL\)/, "service worker should fall back to offline page");
}

async function verifyOfflinePage() {
  const response = await fetch(`${baseUrl}/offline.html`, { cache: "no-store" });
  assert.equal(response.status, 200, "offline page should return HTTP 200");
  const body = await response.text();
  assert.match(body, /혼자장부 오프라인/, "offline page should expose offline title");
  assert.match(body, /오프라인 상태입니다/, "offline page should explain offline state");
}

async function verifyIcon() {
  const response = await fetch(`${baseUrl}/icon.svg`, { cache: "no-store" });
  assert.equal(response.status, 200, "icon should return HTTP 200");
  assert.match(response.headers.get("content-type") ?? "", /svg|image/i, "icon should be served as image content");
}

function verifyRegistrationSource() {
  const source = readFileSync("src/components/app-workspace.tsx", "utf8");
  assert.match(source, /navigator\.serviceWorker\.register\("\/sw\.js"\)/, "app should register /sw.js in production");
  assert.match(source, /process\.env\.NODE_ENV\s*!==\s*"production"/, "service worker registration should be production-gated");
  assert.match(source, /beforeinstallprompt/, "app should listen for the PWA install prompt");
  assert.match(source, /appinstalled/, "app should detect installed app mode");
  assert.match(source, /앱 설치/, "app should expose an install action in the UI");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
