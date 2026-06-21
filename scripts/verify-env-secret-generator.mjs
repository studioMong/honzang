import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const script = readFileSync("scripts/generate-env-secrets.mjs", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const readme = readFileSync("README.md", "utf8");
const railwayCutover = readFileSync("docs/railway-cutover.md", "utf8");

assert.equal(packageJson.scripts?.["env:secrets"], "node scripts/generate-env-secrets.mjs", "package should expose env secret generation");
assert.match(script, /randomBytes\(32\)/, "secret generator should create high-entropy random values");
assert.match(script, /DATABASE_URL은 Railway Postgres reference variable/, "secret generator should not fake the database URL");
assert.match(readme, /npm run env:secrets/, "README should document env secret generation");
assert.match(railwayCutover, /npm run env:secrets/, "Railway cutover guide should document env secret generation");

const result = spawnSync("node", ["scripts/generate-env-secrets.mjs"], {
  encoding: "utf8",
  env: {
    ...process.env,
    NEXT_PUBLIC_APP_URL: "https://example.test",
    HONZANG_ACCESS_CODE: "known-access-code"
  }
});

assert.equal(result.status, 0, result.stderr);
const variables = parseVariables(result.stdout);
assert.equal(variables.NEXT_PUBLIC_APP_URL, "https://example.test", "generator should preserve explicit app URL");
assert.equal(variables.HONZANG_ACCESS_CODE, "known-access-code", "generator should preserve explicit access code");
assert.ok((variables.HONZANG_ACCESS_TOKEN_SALT ?? "").length >= 40, "access-token salt should be long");
assert.ok((variables.HONZANG_FILE_ENCRYPTION_KEY ?? "").length >= 40, "file encryption key should be long");
assert.notEqual(variables.HONZANG_ACCESS_TOKEN_SALT, variables.HONZANG_FILE_ENCRYPTION_KEY, "salt and encryption key should be different");
assert.equal(variables.DATABASE_URL, undefined, "generator should not print a fake database URL");

console.log("Environment secret generator verification passed.");

function parseVariables(output) {
  const entries = {};
  for (const line of output.split("\n")) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (!match) continue;
    entries[match[1]] = match[2].replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
  return entries;
}
