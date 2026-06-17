import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { sampleTransactions } from "@/lib/sample-data";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { serializeTransaction } from "@/lib/server/serializers";
import { summarizeTransactions } from "@/lib/accounting";

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({
      transactions: sampleTransactions,
      summary: summarizeTransactions(sampleTransactions),
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
  const transactions = await db.transaction.findMany({
    where: { companyId: company.id },
    include: {
      suggestedAccount: true,
      confirmedAccount: true
    },
    orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
    take: 300
  });
  const serialized = transactions.map(serializeTransaction);

  return NextResponse.json({
    transactions: serialized,
    summary: summarizeTransactions(serialized),
    mode: "database"
  });
}

export async function PATCH(request: Request) {
  const db = getPrisma();
  const body = await request.json();

  if (!db) {
    return NextResponse.json({ ok: true, transaction: body, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const transaction = await db.transaction.update({
    where: {
      id: String(body.id)
    },
    data: {
      confirmedAccountId: body.confirmedAccountId || null,
      evidenceStatus: body.evidenceStatus || undefined,
      memo: body.memo ?? undefined
    },
    include: {
      suggestedAccount: true,
      confirmedAccount: true
    }
  });

  if (transaction.companyId !== company.id) {
    return NextResponse.json({ ok: false, message: "Invalid company transaction." }, { status: 403 });
  }

  return NextResponse.json({ ok: true, transaction: serializeTransaction(transaction), mode: "database" });
}
