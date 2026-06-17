import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_COMPANY_ID } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { sampleJournalEntries } from "@/lib/sample-data";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
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
  const parsed = journalSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const debit = payload.lines.reduce((sum, line) => sum + line.debitAmount, 0);
  const credit = payload.lines.reduce((sum, line) => sum + line.creditAmount, 0);

  if (Math.round(debit) !== Math.round(credit)) {
    return NextResponse.json({ ok: false, message: "차변과 대변이 일치하지 않습니다." }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({
      ok: true,
      journalEntry: {
        id: `journal-preview-${Date.now()}`,
        transactionId: payload.transactionId,
        entryDate: payload.entryDate,
        memo: payload.memo,
        status: payload.status,
        lines: payload.lines
      },
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
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
        entryDate: new Date(payload.entryDate),
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

    return entry;
  });

  return NextResponse.json({ ok: true, journalEntry: serializeJournalEntry(created), mode: "database" });
}
