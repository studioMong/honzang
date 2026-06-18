export type VatFilingSchedule = {
  name: "부가세 예정" | "부가세 확정";
  phase: "1기 예정" | "1기 확정" | "2기 예정" | "2기 확정";
  periodLabel: string;
  dueDate: Date;
};

export type PaymentStatementSchedule = {
  monthlyBusinessOtherDueDate: Date;
  payrollSimpleDueDate: Date;
  annualPaymentStatementDueDate: Date;
};

export function buildVatFilingSchedule(periodYear: number, periodMonth: number): VatFilingSchedule {
  assertValidPeriod(periodYear, periodMonth);

  if (periodMonth <= 3) {
    return {
      name: "부가세 예정",
      phase: "1기 예정",
      periodLabel: `${periodYear}년 1기 예정 (${periodYear}-01-01 - ${periodYear}-03-31)`,
      dueDate: new Date(Date.UTC(periodYear, 3, 25))
    };
  }
  if (periodMonth <= 6) {
    return {
      name: "부가세 확정",
      phase: "1기 확정",
      periodLabel: `${periodYear}년 1기 확정 (${periodYear}-04-01 - ${periodYear}-06-30)`,
      dueDate: new Date(Date.UTC(periodYear, 6, 25))
    };
  }
  if (periodMonth <= 9) {
    return {
      name: "부가세 예정",
      phase: "2기 예정",
      periodLabel: `${periodYear}년 2기 예정 (${periodYear}-07-01 - ${periodYear}-09-30)`,
      dueDate: new Date(Date.UTC(periodYear, 9, 25))
    };
  }
  return {
    name: "부가세 확정",
    phase: "2기 확정",
    periodLabel: `${periodYear}년 2기 확정 (${periodYear}-10-01 - ${periodYear}-12-31)`,
    dueDate: new Date(Date.UTC(periodYear + 1, 0, 25))
  };
}

export function buildPaymentStatementSchedule(periodYear: number, periodMonth: number): PaymentStatementSchedule {
  assertValidPeriod(periodYear, periodMonth);

  return {
    monthlyBusinessOtherDueDate: endOfMonth(periodYear, periodMonth),
    payrollSimpleDueDate: periodMonth <= 6 ? endOfMonth(periodYear, 6) : endOfMonth(periodYear + 1, 0),
    annualPaymentStatementDueDate: new Date(Date.UTC(periodYear + 1, 2, 10))
  };
}

function assertValidPeriod(periodYear: number, periodMonth: number) {
  if (!Number.isInteger(periodYear) || periodYear < 1900 || periodYear > 9999) {
    throw new Error(`Invalid filing schedule year: ${periodYear}`);
  }
  if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
    throw new Error(`Invalid filing schedule month: ${periodMonth}`);
  }
}

function endOfMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}
