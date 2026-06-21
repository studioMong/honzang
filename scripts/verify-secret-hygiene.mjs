import assert from "node:assert/strict";
import { basename, extname } from "node:path";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const packageJson = readJson("package.json");
const gitignore = readText(".gitignore");
const readme = readText("README.md");
const deploymentConfigVerify = readText("scripts/verify-deployment-config.mjs");

assert.equal(packageJson.scripts?.["verify:secret-hygiene"], "node scripts/verify-secret-hygiene.mjs", "package should expose secret hygiene verification");
assert.match(gitignore, /^\.env$/m, ".gitignore should exclude root .env");
assert.match(gitignore, /^\.env\.\*$/m, ".gitignore should exclude environment-specific env files");
assert.match(gitignore, /^!\.env\.example$/m, ".gitignore should allow only .env.example");
assert.match(readme, /`DATABASE_URL`은 출력하지 않으므로/, "README should warn that generated secrets do not include DATABASE_URL");
assert.match(deploymentConfigVerify, /verify:secret-hygiene/, "deployment config verification should include secret hygiene");

const trackedFiles = gitLsFiles();
const trackedEnvFiles = trackedFiles.filter((file) => basename(file).startsWith(".env") && file !== ".env.example");
assert.deepEqual(trackedEnvFiles, [], `tracked environment files are not allowed: ${trackedEnvFiles.join(", ")}`);

const trackedKeyFiles = trackedFiles.filter((file) => [".pem", ".p12", ".pfx", ".key"].includes(extname(file).toLowerCase()));
assert.deepEqual(trackedKeyFiles, [], `tracked private key/certificate files are not allowed: ${trackedKeyFiles.join(", ")}`);

const issues = [];
for (const file of trackedFiles) {
  const text = readTrackedText(file);
  if (text === null) continue;
  collectPrivateKeyIssues(file, text, issues);
  collectPostgresUrlIssues(file, text, issues);
  collectHonzangSecretIssues(file, text, issues);
}

assert.deepEqual(issues, [], `potential committed secrets found:\n${issues.join("\n")}`);

console.log("Secret hygiene verification passed.");

function gitLsFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\0").filter(Boolean);
}

function readTrackedText(file) {
  try {
    const buffer = readFileSync(file);
    if (buffer.includes(0)) return null;
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

function collectPrivateKeyIssues(file, text, issues) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/.test(text)) {
    issues.push(`${file}: private key block`);
  }
}

function collectPostgresUrlIssues(file, text, issues) {
  const matches = text.matchAll(/postgres(?:ql)?:\/\/([^:\s"'`]+):([^@\s"'`]+)@/g);
  for (const match of matches) {
    const user = match[1];
    const password = match[2];
    if (["USER", "user", "..."].includes(user) || ["PASSWORD", "password", "..."].includes(password)) continue;
    issues.push(`${file}: concrete Postgres credential URL`);
  }
}

function collectHonzangSecretIssues(file, text, issues) {
  for (const line of text.split("\n")) {
    const match = /^\s*(HONZANG_(?:ACCESS_CODE|ACCESS_TOKEN_SALT|FILE_ENCRYPTION_KEY))\s*=\s*["']?([^"'\s]+)["']?/.exec(line);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (isAllowedPlaceholder(value)) continue;
    if (key === "HONZANG_ACCESS_CODE" && value.length < 20) continue;
    issues.push(`${file}: possible concrete ${key}`);
  }
}

function isAllowedPlaceholder(value) {
  return (
    value.includes("...") ||
    value.includes("change-me") ||
    value.includes("replace-with") ||
    value.includes("verify-") ||
    value.includes("운영_") ||
    value.includes("원하는_") ||
    value.includes("배포_") ||
    value.includes("쿠키_") ||
    value.includes("원본_") ||
    value.includes("접근코드")
  );
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}
