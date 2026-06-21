import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const packageJson = readJson("package.json");
const railwayConfig = readJson("railway.json");
const dockerfile = readText("Dockerfile");
const nextConfig = readText("next.config.ts");
const dockerignore = readText(".dockerignore");
const envExample = readText(".env.example");
const readme = readText("README.md");
const projectGoalDoc = readText("docs/project-goal.md");
const railwayCutoverDoc = readText("docs/railway-cutover.md");
const railwayAuditScript = readText("scripts/audit-railway-deployment.mjs");
const railwayWaitScript = readText("scripts/wait-railway-deployment.mjs");
const railwayVerifyScript = readText("scripts/verify-railway.mjs");
const railwayAccessVerifyScript = readText("scripts/verify-railway-access.mjs");
const railwayAuthenticatedVerifyScript = readText("scripts/verify-railway-authenticated.mjs");
const envSecretGeneratorScript = readText("scripts/generate-env-secrets.mjs");
const secretHygieneVerifyScript = readText("scripts/verify-secret-hygiene.mjs");
const dbWorkflowVerifyScript = readText("scripts/verify-db-workflow.ts");
const securityHeaders = readText("scripts/lib/security-headers.mjs");
const accessControl = readText("src/lib/server/access-control.ts");
const operationsReadiness = readText("src/app/api/operations/readiness/route.ts");
const healthRoute = readText("src/app/api/health/route.ts");
const databaseSchema = readText("src/lib/server/database-schema.ts");
const proxy = readText("src/proxy.ts");

assert.equal(packageJson.scripts?.build, "prisma generate && next build && node scripts/prepare-standalone.mjs", "package build script should create the standalone server");
assert.equal(packageJson.scripts?.start, "HOSTNAME=0.0.0.0 node .next/standalone/server.js", "package start script should run the standalone server");
assert.equal(packageJson.scripts?.["db:deploy"], "prisma migrate deploy", "package should expose a deploy migration command");
assert.equal(packageJson.scripts?.["audit:railway"], "node scripts/audit-railway-deployment.mjs", "package should expose a Railway deployment audit command");
assert.equal(packageJson.scripts?.["wait:railway"], "node scripts/wait-railway-deployment.mjs", "package should expose a Railway deployment wait command");
assert.equal(packageJson.scripts?.["verify:railway-access"], "node scripts/verify-railway-access.mjs", "package should expose Railway access verification");
assert.equal(
  packageJson.scripts?.["verify:railway-authenticated"],
  "node scripts/verify-railway-authenticated.mjs",
  "package should expose authenticated Railway read verification"
);
assert.equal(packageJson.scripts?.["env:secrets"], "node scripts/generate-env-secrets.mjs", "package should expose environment secret generation");
assert.equal(packageJson.scripts?.["verify:env-secrets"], "node scripts/verify-env-secret-generator.mjs", "package should expose environment secret generation verification");
assert.equal(packageJson.scripts?.["verify:secret-hygiene"], "node scripts/verify-secret-hygiene.mjs", "package should expose repository secret hygiene verification");
assert.equal(packageJson.scripts?.["verify:access-control"], "node scripts/verify-access-control.mjs", "package should expose access-control verification");
assert.equal(packageJson.scripts?.["verify:access-audit"], "tsx scripts/verify-access-audit.ts", "package should expose access-audit verification");
assert.equal(packageJson.scripts?.["verify:period-locks"], "node scripts/verify-period-locks.mjs", "package should expose period-lock verification");
assert.equal(
  packageJson.scripts?.["verify:database-schema-contract"],
  "node scripts/verify-database-schema-contract.mjs",
  "package should expose database schema contract verification"
);

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
assert.match(proxy, /INVALID_ORIGIN/, "proxy should reject cross-origin API mutations");
assert.match(proxy, /MUTATION_METHODS/, "proxy should identify mutating API methods for origin checks");
assert.ok(existsSync("src/app/api/operations/readiness/route.ts"), "Operations readiness API should exist");
assert.ok(existsSync("src/lib/server/database-schema.ts"), "Database schema inspection helper should exist");
assert.match(dockerignore, /^\.next$/m, ".dockerignore should exclude local build output");
assert.match(dockerignore, /^node_modules$/m, ".dockerignore should exclude local dependencies");
assert.match(dockerignore, /^\.env\.\*$/m, ".dockerignore should exclude env files");

assert.equal(existsSync("index.html"), false, "root index.html must not exist because Railway can mis-detect a static site");
assert.ok(existsSync("scripts/audit-railway-deployment.mjs"), "Railway audit script should exist");
assert.ok(existsSync("scripts/wait-railway-deployment.mjs"), "Railway deployment wait script should exist");
assert.ok(existsSync("scripts/verify-railway-authenticated.mjs"), "Authenticated Railway read verification script should exist");
assert.ok(existsSync("scripts/generate-env-secrets.mjs"), "Environment secret generator should exist");
assert.ok(existsSync("scripts/verify-env-secret-generator.mjs"), "Environment secret generator verification should exist");
assert.ok(existsSync("scripts/verify-secret-hygiene.mjs"), "Repository secret hygiene verification should exist");
assert.ok(existsSync("scripts/verify-access-control.mjs"), "Access-control verification script should exist");
assert.ok(existsSync("scripts/verify-access-audit.ts"), "Access-audit verification script should exist");
assert.ok(existsSync("scripts/verify-period-locks.mjs"), "Period-lock verification script should exist");
assert.ok(existsSync("scripts/verify-database-schema-contract.mjs"), "Database schema contract verification script should exist");
assert.ok(existsSync("scripts/lib/security-headers.mjs"), "Security header verifier should exist");
assert.ok(existsSync("prisma/schema.prisma"), "Prisma schema should exist");
assert.ok(readdirSync("prisma/migrations").some((entry) => existsSync(path.join("prisma/migrations", entry, "migration.sql"))), "Prisma migrations should be present");

assert.match(readme, /HONZANG_ACCESS_CODE=/, "README should document the deployment access code variable");
assert.match(readme, /HONZANG_ACCESS_TOKEN_SALT=/, "README should document the access-token salt variable");
assert.match(readme, /HONZANG_FILE_ENCRYPTION_KEY=/, "README should document the file encryption key variable");
assert.match(readme, /프로덕션에서는 `HONZANG_ACCESS_TOKEN_SALT`도 함께 있어야/, "README should mark access-token salt as required in production");
assert.match(readme, /접근 성공\/실패\/잠금\/로그아웃/, "README should document access audit events");
assert.match(readme, /verify:railway-authenticated/, "README should document authenticated Railway read verification");
assert.match(readme, /npm run wait:railway/, "README should document Railway deployment waiting");
assert.match(readme, /npm run env:secrets/, "README should document environment secret generation");
assert.match(readme, /verify:secret-hygiene/, "README should document repository secret hygiene verification");
assert.match(envExample, /HONZANG_ACCESS_CODE=/, ".env.example should include the deployment access code variable");
assert.match(envExample, /HONZANG_ACCESS_TOKEN_SALT=/, ".env.example should include the access-token salt variable");
assert.match(envExample, /HONZANG_FILE_ENCRYPTION_KEY=/, ".env.example should include the file encryption key variable");
assert.match(readme, /docs\/railway-cutover\.md/, "README should link to the Railway cutover checklist");
assert.match(readme, /docs\/project-goal\.md/, "README should link to the final project goal");
assert.match(projectGoalDoc, /100% 완료 기준/, "Project goal document should define completion criteria");
assert.match(projectGoalDoc, /홈택스 자동 제출/, "Project goal document should define excluded tax-agent behavior");
assert.match(projectGoalDoc, /VERIFY_DB_WORKFLOW_ACCESS_CODE/, "Project goal document should include protected DB workflow criteria");
assert.match(railwayCutoverDoc, /honzang-production\.up\.railway\.app/, "Railway cutover checklist should name the production domain");
assert.match(railwayCutoverDoc, /\/api\/version/, "Railway cutover checklist should include version endpoint verification");
assert.match(railwayCutoverDoc, /\/api\/health/, "Railway cutover checklist should include health endpoint verification");
assert.match(railwayCutoverDoc, /\/manifest\.webmanifest/, "Railway cutover checklist should include PWA manifest verification");
assert.match(railwayCutoverDoc, /VERIFY_DB_WORKFLOW_BASE_URL/, "Railway cutover checklist should include DB workflow guidance");
assert.match(railwayCutoverDoc, /VERIFY_DB_WORKFLOW_ACCESS_CODE/, "Railway cutover checklist should include access-code DB workflow guidance");
assert.match(railwayCutoverDoc, /verify:railway-authenticated/, "Railway cutover checklist should include authenticated read verification");
assert.match(railwayCutoverDoc, /npm run wait:railway/, "Railway cutover checklist should include deployment waiting");
assert.match(railwayCutoverDoc, /npm run env:secrets/, "Railway cutover checklist should include environment secret generation");
assert.match(railwayCutoverDoc, /HONZANG_FILE_ENCRYPTION_KEY/, "Railway cutover checklist should include the file encryption key variable");
assert.match(railwayAuditScript, /docs\/railway-cutover\.md/, "Railway audit should point operators to the cutover checklist");
assert.match(railwayAuditScript, /Public Networking/, "Railway audit should mention public domain diagnostics");
assert.match(railwayAuditScript, /Variables/, "Railway audit should mention environment variable diagnostics");
assert.match(railwayAuditScript, /findSecurityHeaderIssues/, "Railway audit should inspect public security headers");
assert.match(railwayWaitScript, /RAILWAY_WAIT_TIMEOUT_MS/, "Railway wait should allow timeout configuration");
assert.match(railwayWaitScript, /\/api\/version/, "Railway wait should poll version metadata");
assert.match(railwayWaitScript, /\/api\/health/, "Railway wait should poll health status");
assert.match(railwayWaitScript, /\/api\/auth\/session/, "Railway wait should poll access protection status");
assert.match(railwayWaitScript, /\/manifest\.webmanifest/, "Railway wait should poll PWA manifest status");
assert.match(railwayVerifyScript, /expectSecurityHeaders/, "Railway verification should require public security headers");
assert.match(railwayAccessVerifyScript, /AUTH_REQUIRED/, "Railway access verification should require protected APIs to reject anonymous requests");
assert.match(railwayAccessVerifyScript, /\/access/, "Railway access verification should check access-page redirects");
assert.match(railwayAuthenticatedVerifyScript, /RAILWAY_ACCESS_CODE/, "Authenticated Railway verification should accept an access code");
assert.match(railwayAuthenticatedVerifyScript, /\/api\/auth\/login/, "Authenticated Railway verification should log in without mutating ledger data");
assert.match(railwayAuthenticatedVerifyScript, /\/api\/companies/, "Authenticated Railway verification should read protected company data");
assert.match(railwayAuthenticatedVerifyScript, /\/api\/transactions/, "Authenticated Railway verification should read protected transaction data");
assert.match(railwayAuthenticatedVerifyScript, /\/api\/operations\/readiness/, "Authenticated Railway verification should read protected readiness data");
assert.match(envSecretGeneratorScript, /randomBytes\(32\)/, "Environment secret generator should create high-entropy secret values");
assert.match(envSecretGeneratorScript, /DATABASE_URL은 Railway Postgres reference variable/, "Environment secret generator should defer DATABASE_URL to Railway reference variables");
assert.match(secretHygieneVerifyScript, /git.*ls-files/s, "Secret hygiene verification should inspect tracked files");
assert.match(secretHygieneVerifyScript, /tracked environment files are not allowed/, "Secret hygiene verification should block committed env files");
assert.match(secretHygieneVerifyScript, /private key block/, "Secret hygiene verification should block private key material");
assert.match(dbWorkflowVerifyScript, /baseOrigin/, "DB workflow verification should derive the target origin");
assert.match(dbWorkflowVerifyScript, /Origin: baseOrigin/, "DB workflow verification should send same-origin login requests");
assert.match(dbWorkflowVerifyScript, /isMutationMethod\(method\).*headers\.Origin = baseOrigin/s, "DB workflow verification should send same-origin mutation requests");
assert.match(securityHeaders, /strict-transport-security/, "Security header verifier should check HSTS");
assert.match(securityHeaders, /content-security-policy/, "Security header verifier should check CSP");
assert.match(accessControl, /isAccessTokenSaltConfigured/, "Access control should expose salt configuration state");
assert.match(accessControl, /process\.env\.NODE_ENV !== "production"/, "Access control should only allow default salt outside production");
assert.match(operationsReadiness, /프로덕션에서는 기본 salt/, "Operations readiness should warn when production salt is missing");
assert.match(operationsReadiness, /production \? "red"/, "Operations readiness should block production deployments without access-token salt");
assert.match(operationsReadiness, /fileEncryptionCheck/, "Operations readiness should include file encryption status");
assert.match(operationsReadiness, /HONZANG_FILE_ENCRYPTION_KEY/, "Operations readiness should name the file encryption key variable");
assert.match(operationsReadiness, /databaseSchemaCheck/, "Operations readiness should include database schema status");
assert.match(operationsReadiness, /inspectDatabaseSchema/, "Operations readiness should use the shared database schema inspector");
assert.match(healthRoute, /inspectDatabaseSchema/, "Healthcheck should verify database schema readiness");
assert.match(healthRoute, /schema_error/, "Healthcheck should fail when required database tables are missing");
assert.match(databaseSchema, /REQUIRED_DATABASE_TABLES/, "Database schema helper should enumerate required Prisma tables");
assert.match(databaseSchema, /information_schema\.tables/, "Database schema helper should inspect Postgres tables");

console.log("Deployment config verification passed.");

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}
