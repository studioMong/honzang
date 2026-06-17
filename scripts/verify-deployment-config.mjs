import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const packageJson = readJson("package.json");
const railwayConfig = readJson("railway.json");
const dockerfile = readText("Dockerfile");
const nextConfig = readText("next.config.ts");
const dockerignore = readText(".dockerignore");

assert.equal(packageJson.scripts?.build, "prisma generate && next build && node scripts/prepare-standalone.mjs", "package build script should create the standalone server");
assert.equal(packageJson.scripts?.start, "HOSTNAME=0.0.0.0 node .next/standalone/server.js", "package start script should run the standalone server");
assert.equal(packageJson.scripts?.["db:deploy"], "prisma migrate deploy", "package should expose a deploy migration command");

assert.equal(railwayConfig.build?.builder, "DOCKERFILE", "Railway builder should be Dockerfile");
assert.equal(railwayConfig.build?.dockerfilePath, "Dockerfile", "Railway should use the root Dockerfile");
assert.equal(railwayConfig.deploy?.preDeployCommand, "npm run db:deploy", "Railway should run migrations before deployment");
assert.equal(railwayConfig.deploy?.startCommand, "npm run start", "Railway should start the Next standalone server");
assert.equal(railwayConfig.deploy?.healthcheckPath, "/api/health", "Railway should healthcheck the app API");

assert.match(dockerfile, /FROM node:22-slim/, "Dockerfile should use the expected Node runtime");
assert.match(dockerfile, /RUN npm ci/, "Dockerfile should install locked dependencies");
assert.match(dockerfile, /RUN npm run build/, "Dockerfile should build the app");
assert.match(dockerfile, /EXPOSE 3000/, "Dockerfile should expose the Railway app port");
assert.match(dockerfile, /CMD \["npm", "run", "start"\]/, "Dockerfile should start through npm run start");

assert.match(nextConfig, /output:\s*"standalone"/, "Next config should produce standalone output");
assert.match(dockerignore, /^\.next$/m, ".dockerignore should exclude local build output");
assert.match(dockerignore, /^node_modules$/m, ".dockerignore should exclude local dependencies");
assert.match(dockerignore, /^\.env\.\*$/m, ".dockerignore should exclude env files");

assert.equal(existsSync("index.html"), false, "root index.html must not exist because Railway can mis-detect a static site");
assert.ok(existsSync("prisma/schema.prisma"), "Prisma schema should exist");
assert.ok(readdirSync("prisma/migrations").some((entry) => existsSync(path.join("prisma/migrations", entry, "migration.sql"))), "Prisma migrations should be present");

console.log("Deployment config verification passed.");

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}
