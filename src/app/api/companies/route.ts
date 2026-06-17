import { NextResponse } from "next/server";
import { DEFAULT_ACCOUNTS } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { sampleCompany } from "@/lib/sample-data";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({
      company: sampleCompany,
      accounts: DEFAULT_ACCOUNTS,
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
  const accounts = await db.account.findMany({
    where: { companyId: company.id, isActive: true },
    orderBy: [{ type: "asc" }, { code: "asc" }]
  });

  return NextResponse.json({ company, accounts, mode: "database" });
}
