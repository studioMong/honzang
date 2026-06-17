import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { sampleSummary, sampleTransactions } from "@/lib/sample-data";
import { summarizeTransactions } from "@/lib/accounting";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { serializeTransaction } from "@/lib/server/serializers";

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({ summary: sampleSummary, transactions: sampleTransactions, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const transactions = await db.transaction.findMany({
    where: { companyId: company.id },
    include: {
      suggestedAccount: true,
      confirmedAccount: true
    },
    orderBy: { transactionDate: "desc" },
    take: 1000
  });
  const serialized = transactions.map(serializeTransaction);

  return NextResponse.json({
    summary: {
      periodLabel: "현재 데이터",
      ...summarizeTransactions(serialized)
    },
    transactions: serialized,
    mode: "database"
  });
}
