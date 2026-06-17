import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

type ClosingPeriodReader = {
  closingPeriod: {
    findFirst: (args: {
      where: {
        companyId: string;
        periodStart: { lte: Date };
        periodEnd: { gte: Date };
      };
    }) => Promise<{ period: string } | null>;
    findMany: (args: {
      where: {
        companyId: string;
        periodStart: { lte: Date };
        periodEnd: { gte: Date };
      };
      orderBy?: { period: "asc" | "desc" };
    }) => Promise<Array<{ period: string; periodStart: Date; periodEnd: Date }>>;
  };
};

export function monthPeriodFromDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 7);
}

export function periodRangeFromMonth(period: string) {
  const matched = period.match(/^(\d{4})-(\d{2})$/);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0))
  };
}

export async function findClosedPeriodForDate(db: ClosingPeriodReader, companyId: string, value: string | Date | null | undefined) {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;

  return db.closingPeriod.findFirst({
    where: {
      companyId,
      periodStart: { lte: date },
      periodEnd: { gte: date }
    }
  });
}

export async function findClosedPeriodForDates(db: ClosingPeriodReader, companyId: string, values: Array<string | Date | null | undefined>) {
  const dates = values.flatMap((value) => {
    if (!value) return [];
    const date = typeof value === "string" ? new Date(value) : value;
    return Number.isNaN(date.getTime()) ? [] : [date];
  });
  if (dates.length === 0) return null;

  const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const firstDate = sortedDates[0];
  const lastDate = sortedDates.at(-1);
  if (!firstDate || !lastDate) return null;

  const candidates = await db.closingPeriod.findMany({
    where: {
      companyId,
      periodStart: { lte: lastDate },
      periodEnd: { gte: firstDate }
    },
    orderBy: { period: "desc" }
  });

  return candidates.find((period) => dates.some((date) => period.periodStart <= date && period.periodEnd >= date)) ?? null;
}

export function closedPeriodResponse(period: string) {
  return NextResponse.json(
    {
      ok: false,
      code: "PERIOD_CLOSED",
      message: `${period} 기간은 마감 잠금 상태입니다. 마감 해제 후 다시 시도하세요.`
    },
    { status: 409 }
  );
}

export function asJsonValue(value: unknown) {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}
