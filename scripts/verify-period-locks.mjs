import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = readJson("package.json");
const readme = readText("README.md");
const importsRoute = readText("src/app/api/imports/route.ts");
const transactionsRoute = readText("src/app/api/transactions/route.ts");
const evidencesRoute = readText("src/app/api/evidences/route.ts");
const journalsRoute = readText("src/app/api/journals/route.ts");
const reportsRoute = readText("src/app/api/reports/route.ts");
const reviewsRoute = readText("src/app/api/reviews/route.ts");
const dbWorkflow = readText("scripts/verify-db-workflow.ts");

assert.equal(packageJson.scripts?.["verify:period-locks"], "node scripts/verify-period-locks.mjs", "package should expose period-lock verification");

assert.match(readme, /월 마감 상태/, "README should describe closing-period data");
assert.match(readme, /CSV 가져오기와 업로드 삭제/, "README should document import mutation period locks");

assertMatches(importsRoute, /findClosedPeriodForDates/g, 2, "imports route should check closed periods for import create and delete");
assert.match(importsRoute, /closedPeriodResponse\(closedPeriod\.period\)/, "imports route should return PERIOD_CLOSED when importing into closed periods");
assert.match(importsRoute, /transactions\.map\(\(transaction\) => transaction\.transactionDate\)/, "import delete should check every imported transaction date");

assertMatches(transactionsRoute, /findClosedPeriodForDate/g, 3, "transactions route should check closed periods for create, patch, and delete");
assertMatches(evidencesRoute, /findClosedPeriodForDate/g, 4, "evidences route should check issue and linked transaction periods for create and delete");
assertMatches(journalsRoute, /findClosedPeriodForDate/g, 4, "journals route should check entry and linked transaction periods for create and patch");
assert.match(reportsRoute, /findClosedPeriodOverlappingRange/, "reports route should check report ranges against closed periods");
assert.match(reviewsRoute, /findClosedPeriodForDate/, "reviews route should check linked transaction periods");

assert.match(dbWorkflow, /lockedImportCreatePayload/, "DB workflow should verify locked-period CSV import create rejection");
assert.match(dbWorkflow, /lockedImportDeletePayload/, "DB workflow should verify locked-period import delete rejection");
assert.match(dbWorkflow, /lockedTransactionPatchPayload/, "DB workflow should verify locked-period transaction patch rejection");
assert.match(dbWorkflow, /lockedTransactionDeletePayload/, "DB workflow should verify locked-period transaction delete rejection");
assert.match(dbWorkflow, /lockedEvidencePatchPayload/, "DB workflow should verify locked-period evidence patch rejection");
assert.match(dbWorkflow, /locked period import create should return PERIOD_CLOSED/, "DB workflow should assert locked import create code");
assert.match(dbWorkflow, /locked period import delete should return PERIOD_CLOSED/, "DB workflow should assert locked import delete code");
assert.match(dbWorkflow, /locked period transaction patch should return PERIOD_CLOSED/, "DB workflow should assert locked transaction patch code");
assert.match(dbWorkflow, /locked period transaction delete should return PERIOD_CLOSED/, "DB workflow should assert locked transaction delete code");
assert.match(dbWorkflow, /locked period evidence patch should return PERIOD_CLOSED/, "DB workflow should assert locked evidence patch code");

console.log("Period lock verification passed.");

function assertMatches(text, pattern, minimumCount, message) {
  assert.ok((text.match(pattern) ?? []).length >= minimumCount, message);
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}
