import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = readJson("package.json");
const prismaSchema = readText("prisma/schema.prisma");
const databaseSchemaHelper = readText("src/lib/server/database-schema.ts");
const deploymentConfigVerifier = readText("scripts/verify-deployment-config.mjs");
const mvpVerifier = readText("scripts/verify-mvp.mjs");

const prismaModels = [...prismaSchema.matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s*{/gm)].map((match) => match[1]);
const requiredTables = extractRequiredTables(databaseSchemaHelper);

assert.equal(
  packageJson.scripts?.["verify:database-schema-contract"],
  "node scripts/verify-database-schema-contract.mjs",
  "package should expose database schema contract verification"
);
assert.ok(prismaModels.length > 0, "Prisma schema should declare models");
assert.deepEqual(requiredTables, prismaModels, "REQUIRED_DATABASE_TABLES should match Prisma model table names and order");
assert.match(databaseSchemaHelper, /information_schema\.tables/, "database schema helper should inspect Postgres tables");
assert.match(databaseSchemaHelper, /WHERE table_schema = 'public'/, "database schema helper should inspect the public schema");
assert.match(deploymentConfigVerifier, /verify:database-schema-contract/, "deployment config verifier should require the database schema contract script");
assert.match(mvpVerifier, /verify:database-schema-contract/, "MVP verifier should include the database schema contract");

console.log("Database schema contract verification passed.");

function extractRequiredTables(source) {
  const match = source.match(/REQUIRED_DATABASE_TABLES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(match, "database schema helper should export REQUIRED_DATABASE_TABLES");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}
