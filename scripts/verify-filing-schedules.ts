import assert from "node:assert/strict";
import { buildPaymentStatementSchedule, buildVatFilingSchedule } from "../src/lib/filing-schedule";

const vatCases = [
  { month: 1, name: "부가세 예정", phase: "1기 예정", period: "2026년 1기 예정", dueDate: "2026-04-25" },
  { month: 3, name: "부가세 예정", phase: "1기 예정", period: "2026년 1기 예정", dueDate: "2026-04-25" },
  { month: 4, name: "부가세 확정", phase: "1기 확정", period: "2026년 1기 확정", dueDate: "2026-07-25" },
  { month: 6, name: "부가세 확정", phase: "1기 확정", period: "2026년 1기 확정", dueDate: "2026-07-25" },
  { month: 7, name: "부가세 예정", phase: "2기 예정", period: "2026년 2기 예정", dueDate: "2026-10-25" },
  { month: 9, name: "부가세 예정", phase: "2기 예정", period: "2026년 2기 예정", dueDate: "2026-10-25" },
  { month: 10, name: "부가세 확정", phase: "2기 확정", period: "2026년 2기 확정", dueDate: "2027-01-25" },
  { month: 12, name: "부가세 확정", phase: "2기 확정", period: "2026년 2기 확정", dueDate: "2027-01-25" }
] as const;

for (const item of vatCases) {
  const schedule = buildVatFilingSchedule(2026, item.month);
  assert.equal(schedule.name, item.name, `month ${item.month} VAT name`);
  assert.equal(schedule.phase, item.phase, `month ${item.month} VAT phase`);
  assert.ok(schedule.periodLabel.includes(item.period), `month ${item.month} VAT period label`);
  assert.equal(toIsoDate(schedule.dueDate), item.dueDate, `month ${item.month} VAT due date`);
}

const juneStatements = buildPaymentStatementSchedule(2026, 6);
assert.equal(toIsoDate(juneStatements.monthlyBusinessOtherDueDate), "2026-07-31", "June business/other simple statement due date");
assert.equal(toIsoDate(juneStatements.payrollSimpleDueDate), "2026-07-31", "first-half payroll simple statement due date");
assert.equal(toIsoDate(juneStatements.annualPaymentStatementDueDate), "2027-03-10", "annual payment statement due date");

const decemberStatements = buildPaymentStatementSchedule(2026, 12);
assert.equal(toIsoDate(decemberStatements.monthlyBusinessOtherDueDate), "2027-01-31", "December business/other simple statement due date");
assert.equal(toIsoDate(decemberStatements.payrollSimpleDueDate), "2027-01-31", "second-half payroll simple statement due date");
assert.equal(toIsoDate(decemberStatements.annualPaymentStatementDueDate), "2027-03-10", "annual payment statement due date for 2026 payments");

assert.throws(() => buildVatFilingSchedule(2026, 0), /Invalid filing schedule month/, "invalid VAT month should throw");
assert.throws(() => buildPaymentStatementSchedule(2026, 13), /Invalid filing schedule month/, "invalid payment statement month should throw");

console.log("Filing schedule verification passed.");

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
