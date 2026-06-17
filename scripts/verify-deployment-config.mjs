import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const packageJson = readJson("package.json");
const railwayConfig = readJson("railway.json");
const dockerfile = readText("Dockerfile");
const nextConfig = readText("next.config.ts");
const dockerignore = readText(".dockerignore");
const readme = readText("README.md");
const railwayCutoverDoc = readText("docs/railway-cutover.md");
const railwayAuditScript = readText("scripts/audit-railway-deployment.mjs");
const railwayVerifyScript = readText("scripts/verify-railway.mjs");
const securityHeaders = readText("scripts/lib/security-headers.mjs");
const accessControl = readText("src/lib/server/access-control.ts");
const operationsReadiness = readText("src/app/api/operations/readiness/route.ts");
const proxy = readText("src/proxy.ts");

assert.equal(packageJson.scripts?.build, "prisma generate && next build && node scripts/prepare-standalone.mjs", "package build script should create the standalone server");
assert.equal(packageJson.scripts?.start, "HOSTNAME=0.0.0.0 node .next/standalone/server.js", "package start script should run the standalone server");
assert.equal(packageJson.scripts?.["db:deploy"], "prisma migrate deploy", "package should expose a deploy migration command");
assert.equal(packageJson.scripts?.["audit:railway"], "node scripts/audit-railway-deployment.mjs", "package should expose a Railway deployment audit command");
assert.equal(packageJson.scripts?.["verify:access-control"], "node scripts/verify-access-control.mjs", "package should expose access-control verification");

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
assert.match(nextConfig, /Content-Security-Policy/, "Next config should set a baseline CSP header");
assert.match(nextConfig, /frame-ancestors 'none'/, "CSP should prevent framing");
assert.match(nextConfig, /X-Content-Type-Options/, "Next config should prevent content-type sniffing");
assert.match(nextConfig, /Strict-Transport-Security/, "Next config should set HSTS for production responses");
assert.match(nextConfig, /Referrer-Policy/, "Next config should set a referrer policy");
assert.match(nextConfig, /Permissions-Policy/, "Next config should disable unused browser capabilities");
assert.match(proxy, /api\/auth\/login/, "proxy should leave auth login public");
assert.match(proxy, /api\/health/, "proxy should leave healthcheck public");
assert.match(proxy, /isRequestAuthenticated/, "proxy should protect private routes by access cookie");
assert.ok(existsSync("src/app/api/operations/readiness/route.ts"), "Operations readiness API should exist");
assert.match(dockerignore, /^\.next$/m, ".dockerignore should exclude local build output");
assert.match(dockerignore, /^node_modules$/m, ".dockerignore should exclude local dependencies");
assert.match(dockerignore, /^\.env\.\*$/m, ".dockerignore should exclude env files");

assert.equal(existsSync("index.html"), false, "root index.html must not exist because Railway can mis-detect a static site");
assert.ok(existsSync("scripts/audit-railway-deployment.mjs"), "Railway audit script should exist");
assert.ok(existsSync("scripts/verify-access-control.mjs"), "Access-control verification script should exist");
assert.ok(existsSync("scripts/lib/security-headers.mjs"), "Security header verifier should exist");
assert.ok(existsSync("prisma/schema.prisma"), "Prisma schema should exist");
assert.ok(readdirSync("prisma/migrations").some((entry) => existsSync(path.join("prisma/migrations", entry, "migration.sql"))), "Prisma migrations should be present");

assert.match(readme, /HONZANG_ACCESS_CODE=/, "README should document the deployment access code variable");
assert.match(readme, /HONZANG_ACCESS_TOKEN_SALT=/, "README should document the access-token salt variable");
assert.match(readme, /프로덕션에서는 `HONZANG_ACCESS_TOKEN_SALT`도 함께 있어야/, "README should mark access-token salt as required in production");
assert.match(readme, /docs\/railway-cutover\.md/, "README should link to the Railway cutover checklist");
assert.match(railwayCutoverDoc, /honzang-production\.up\.railway\.app/, "Railway cutover checklist should name the production domain");
assert.match(railwayCutoverDoc, /\/api\/version/, "Railway cutover checklist should include version endpoint verification");
assert.match(railwayCutoverDoc, /\/api\/health/, "Railway cutover checklist should include health endpoint verification");
assert.match(railwayCutoverDoc, /\/manifest\.webmanifest/, "Railway cutover checklist should include PWA manifest verification");
assert.match(railwayCutoverDoc, /VERIFY_DB_WORKFLOW_BASE_URL/, "Railway cutover checklist should include DB workflow guidance");
assert.match(railwayAuditScript, /docs\/railway-cutover\.md/, "Railway audit should point operators to the cutover checklist");
assert.match(railwayAuditScript, /Public Networking/, "Railway audit should mention public domain diagnostics");
assert.match(railwayAuditScript, /Variables/, "Railway audit should mention environment variable diagnostics");
assert.match(railwayAuditScript, /findSecurityHeaderIssues/, "Railway audit should inspect public security headers");
assert.match(railwayVerifyScript, /expectSecurityHeaders/, "Railway verification should require public security headers");
assert.match(securityHeaders, /strict-transport-security/, "Security header verifier should check HSTS");
assert.match(securityHeaders, /content-security-policy/, "Security header verifier should check CSP");
assert.match(accessControl, /isAccessTokenSaltConfigured/, "Access control should expose salt configuration state");
assert.match(accessControl, /process\.env\.NODE_ENV !== "production"/, "Access control should only allow default salt outside production");
assert.match(operationsReadiness, /프로덕션에서는 기본 salt/, "Operations readiness should warn when production salt is missing");
assert.match(operationsReadiness, /production \? "red"/, "Operations readiness should block production deployments without access-token salt");

console.log("Deployment config verification passed.");

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}
