import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_COMPANY_ID } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { sampleJournalEntries } from "@/lib/sample-data";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { closedPeriodResponse, findClosedPeriodForDate } from "@/lib/server/closing-periods";
import { parseStrictDate } from "@/lib/server/date-validation";
import { minorUnitsToMoney, moneyToMinorUnits, validateDecimal14_2Amount } from "@/lib/server/money-validation";
import { parseJsonRequest } from "@/lib/server/request-json";
import { serializeJournalEntry } from "@/lib/server/serializers";

const journalLineSchema = z.object({
  accountCode: z.string().min(1).max(30),
  accountName: z.string().min(1).max(120),
  accountType: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]).optional(),
  debitAmount: z.coerce.number().nonnegative(),
  creditAmount: z.coerce.number().nonnegative(),
  vatType: z.string().optional().nullable(),
  memo: z.string().optional().nullable()
});

const journalSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  transactionId: z.string().optional().nullable(),
  entryDate: z.string().min(1),
  memo: z.string().min(1).max(300),
  status: z.enum(["DRAFT", "APPROVED", "VOID"]).default("APPROVED"),
  lines: z.array(journalLineSchema).min(2).max(20)
});

const journalStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["DRAFT", "APPROVED", "VOID"])
});

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({ journalEntries: sampleJournalEntries, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const entries = await db.journalEntry.findMany({
    where: { companyId: company.id },
    include: {
      lines: {
        include: { account: true },
        orderBy: { createdAt: "asc" }
      },
      transaction: {
        include: {
          suggestedAccount: true,
          confirmedAccount: true
        }
      }
    },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: 500
  });

  return NextResponse.json({ journalEntries: entries.map(serializeJournalEntry), mode: "database" });
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(request, journalSchema, { label: "분개 저장 요청" });
  if (!parsed.ok) return parsed.response;

  const payload = parsed.data;
  const entryDate = parseStrictDate(payload.entryDate);
  if (!entryDate) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_JOURNAL_DATE",
        message: "분개일은 유효한 날짜여야 합니다."
      },
      { status: 400 }
    );
  }

  const lineIssues = validateJournalLines(payload.lines);
  if (lineIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_JOURNAL_LINES",
        message: "분개 라인의 차변/대변 금액이 올바르지 않습니다.",
        issues: lineIssues
      },
      { status: 400 }
    );
  }

  const debitMinorUnits = payload.lines.reduce((sum, line) => sum + moneyToMinorUnits(line.debitAmount), 0);
  const creditMinorUnits = payload.lines.reduce((sum, line) => sum + moneyToMinorUnits(line.creditAmount), 0);
  const debit = minorUnitsToMoney(debitMinorUnits);
  const credit = minorUnitsToMoney(creditMinorUnits);

  if (debitMinorUnits !== creditMinorUnits) {
    return NextResponse.json(
      {
        ok: false,
        code: "UNBALANCED_JOURNAL",
        message: "차변과 대변이 일치하지 않습니다."
      },
      { status: 400 }
    );
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({
      ok: true,
      journalEntry: {
        id: `journal-preview-${payload.transactionId ?? "manual"}-${Date.now()}`,
        transactionId: payload.transactionId,
        entryDate,
        memo: payload.memo,
        status: payload.status,
        lines: payload.lines
      },
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
  const closedEntryPeriod = await findClosedPeriodForDate(db, company.id, entryDate);
  if (closedEntryPeriod) return closedPeriodResponse(closedEntryPeriod.period);

  const accounts = await db.account.findMany({ where: { companyId: company.id } });
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  const missingAccount = payload.lines.find((line) => !accountByCode.has(line.accountCode));

  if (missingAccount) {
    return NextResponse.json({ ok: false, message: `${missingAccount.accountCode} 계정과목을 찾을 수 없습니다.` }, { status: 400 });
  }

  const transaction = payload.transactionId
    ? await db.transaction.findFirst({
        where: {
          id: payload.transactionId,
          companyId: company.id
        }
      })
    : null;

  if (payload.transactionId && !transaction) {
    return NextResponse.json({ ok: false, message: "거래를 찾을 수 없습니다." }, { status: 404 });
  }
  const closedTransactionPeriod = await findClosedPeriodForDate(db, company.id, transaction?.transactionDate);
  if (closedTransactionPeriod) return closedPeriodResponse(closedTransactionPeriod.period);

  if (transaction) {
    const approvedJournal = await db.journalEntry.findFirst({
      where: {
        companyId: company.id,
        transactionId: transaction.id,
        status: "APPROVED"
      },
      select: { id: true }
    });

    if (approvedJournal) {
      return NextResponse.json(
        {
          ok: false,
          code: "APPROVED_JOURNAL_REPLACEMENT_BLOCKED",
          message: "승인된 분개가 있는 거래는 새 분개로 교체할 수 없습니다. 먼저 승인 취소 후 다시 저장하세요.",
          approvedJournalId: approvedJournal.id
        },
        { status: 409 }
      );
    }
  }

  const created = await db.$transaction(async (tx) => {
    if (transaction) {
      await tx.journalEntry.deleteMany({
        where: {
          companyId: company.id,
          transactionId: transaction.id
        }
      });
    }

    const entry = await tx.journalEntry.create({
      data: {
        companyId: company.id,
        transactionId: transaction?.id ?? null,
        entryDate: new Date(entryDate),
        memo: payload.memo,
        status: payload.status,
        lines: {
          create: payload.lines.map((line) => ({
            accountId: accountByCode.get(line.accountCode)!.id,
            debitAmount: line.debitAmount,
            creditAmount: line.creditAmount,
            vatType: line.vatType,
            memo: line.memo
          }))
        }
      },
      include: {
        lines: {
          include: { account: true },
          orderBy: { createdAt: "asc" }
        },
        transaction: {
          include: {
            suggestedAccount: true,
            confirmedAccount: true
          }
        }
      }
    });

    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "JOURNAL_CREATE",
      entityType: "JOURNAL_ENTRY",
      entityId: entry.id,
      summary: `${payload.status === "APPROVED" ? "분개를 승인했습니다" : "분개를 저장했습니다"}: ${payload.memo}`,
      metadata: {
        transactionId: transaction?.id ?? null,
        status: payload.status,
        lineCount: payload.lines.length,
        debit,
        credit
      }
    });

    return entry;
  });

  return NextResponse.json({ ok: true, journalEntry: serializeJournalEntry(created), mode: "database" });
}

export async function PATCH(request: Request) {
  const parsed = await parseJsonRequest(request, journalStatusSchema, { label: "분개 상태 변경 요청" });
  if (!parsed.ok) return parsed.response;

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({
      ok: true,
      journalEntry: {
        id: parsed.data.id,
        status: parsed.data.status
      },
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
  const existing = await db.journalEntry.findFirst({
    where: {
      id: parsed.data.id,
      companyId: company.id
    },
    include: {
      transaction: {
        select: {
          transactionDate: true
        }
      }
    }
  });

  if (!existing) {
    return NextResponse.json({ ok: false, message: "분개를 찾을 수 없습니다." }, { status: 404 });
  }
  const closedPeriod = await findClosedPeriodForDate(db, company.id, existing.entryDate);
  if (closedPeriod) return closedPeriodResponse(closedPeriod.period);
  const closedTransactionPeriod = await findClosedPeriodForDate(db, company.id, existing.transaction?.transactionDate);
  if (closedTransactionPeriod) return closedPeriodResponse(closedTransactionPeriod.period);

  if (parsed.data.status === "APPROVED" && existing.status !== "APPROVED" && existing.transactionId) {
    const approvedJournal = await db.journalEntry.findFirst({
      where: {
        companyId: company.id,
        transactionId: existing.transactionId,
        status: "APPROVED",
        id: { not: existing.id }
      },
      select: { id: true }
    });

    if (approvedJournal) {
      return NextResponse.json(
        {
          ok: false,
          code: "APPROVED_JOURNAL_DUPLICATE_BLOCKED",
          message: "이미 승인된 분개가 있는 거래는 다른 분개를 추가 승인할 수 없습니다. 기존 승인 분개를 먼저 취소하세요.",
          approvedJournalId: approvedJournal.id
        },
        { status: 409 }
      );
    }
  }

  const journalEntry = await db.$transaction(async (tx) => {
    const updated = await tx.journalEntry.update({
      where: { id: parsed.data.id },
      data: { status: parsed.data.status },
      include: {
        lines: {
          include: { account: true },
          orderBy: { createdAt: "asc" }
        },
        transaction: {
          include: {
            suggestedAccount: true,
            confirmedAccount: true
          }
        }
      }
    });
    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "JOURNAL_STATUS_UPDATE",
      entityType: "JOURNAL_ENTRY",
      entityId: updated.id,
      summary: `분개 상태를 ${parsed.data.status}로 변경했습니다.`,
      metadata: {
        transactionId: updated.transactionId ?? null,
        status: parsed.data.status
      }
    });
    return updated;
  });

  return NextResponse.json({ ok: true, journalEntry: serializeJournalEntry(journalEntry), mode: "database" });
}

function validateJournalLines(lines: z.infer<typeof journalSchema>["lines"]) {
  return lines.flatMap((line, index) => {
    const lineNumber = index + 1;
    const issues = [
      validateDecimal14_2Amount(line.debitAmount, `${lineNumber}번째 라인 차변`),
      validateDecimal14_2Amount(line.creditAmount, `${lineNumber}번째 라인 대변`)
    ].filter((issue): issue is string => Boolean(issue));

    if (issues.length > 0) return issues;

    const debitPositive = moneyToMinorUnits(line.debitAmount) > 0;
    const creditPositive = moneyToMinorUnits(line.creditAmount) > 0;
    if (debitPositive === creditPositive) {
      return [`${lineNumber}번째 라인은 차변 또는 대변 중 한쪽만 0보다 커야 합니다.`];
    }
    return [];
  });
}
