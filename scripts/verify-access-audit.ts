import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const packageJson = readJson("package.json");
const helper = readText("src/lib/server/security-audit.ts");
const loginRoute = readText("src/app/api/auth/login/route.ts");
const logoutRoute = readText("src/app/api/auth/logout/route.ts");
const workspace = readText("src/components/app-workspace.tsx");
const readme = readText("README.md");

assert.equal(packageJson.scripts?.["verify:access-audit"], "tsx scripts/verify-access-audit.ts", "package should expose access audit verification");
assert.ok(existsSync("src/lib/server/security-audit.ts"), "access audit helper should exist");

for (const action of ["ACCESS_LOGIN_SUCCESS", "ACCESS_LOGIN_FAILURE", "ACCESS_LOGIN_LOCKED", "ACCESS_LOGOUT"]) {
  assert.match(helper, new RegExp(action), `helper should type ${action}`);
  assert.match(workspace, new RegExp(`${action}:`), `audit UI should label ${action}`);
}

assert.match(helper, /getPrisma/, "access audit should use the shared Prisma connection helper");
assert.match(helper, /ensureDefaultCompany/, "access audit should attach events to the default company");
assert.match(helper, /recordAuditEvent/, "access audit should reuse the shared audit writer");
assert.match(helper, /entityType:\s*"ACCESS_SESSION"/, "access audit events should use ACCESS_SESSION entity type");
assert.match(helper, /createHash/, "access audit should hash request identifiers");
assert.match(helper, /sourceHash/, "access audit should store only a hashed request source");
assert.match(helper, /userAgentHash/, "access audit should store only a hashed user-agent");
assert.match(helper, /catch\s*{[\s\S]*access control should keep working/i, "access audit failures should not break access control");
assert.doesNotMatch(helper, /rawIp|sourceIp|clientIp|accessCode/i, "access audit helper should not store raw IPs or access codes");

assert.match(loginRoute, /recordAccessAuditEvent/, "login route should write access audit events");
assert.match(loginRoute, /action:\s*"ACCESS_LOGIN_SUCCESS"/, "login route should audit successful logins");
assert.match(loginRoute, /action:\s*"ACCESS_LOGIN_FAILURE"/, "login route should audit failed login attempts");
assert.match(loginRoute, /action:\s*"ACCESS_LOGIN_LOCKED"/, "login route should audit lockout threshold events");
assert.match(loginRoute, /remainingAttempts/, "login audit should capture remaining-attempt state");
assert.doesNotMatch(loginRoute, /metadata:\s*{[\s\S]*code:\s*body\.data\.code/, "login audit metadata must not include the submitted code");

assert.match(logoutRoute, /recordAccessAuditEvent/, "logout route should write access audit events");
assert.match(logoutRoute, /action:\s*"ACCESS_LOGOUT"/, "logout route should audit logout events");
assert.match(workspace, /ACCESS_SESSION:\s*"접근 세션"/, "audit UI should label access session entities");

assert.match(readme, /접근 성공\/실패\/잠금\/로그아웃/, "README should document access audit events");
assert.match(readme, /원문 IP와 접근 코드는 저장하지 않고 해시/, "README should document access audit privacy handling");

console.log("Access audit verification passed.");

function readJson(filePath: string) {
  return JSON.parse(readText(filePath)) as { scripts?: Record<string, string> };
}

function readText(filePath: string) {
  return readFileSync(filePath, "utf8");
}
