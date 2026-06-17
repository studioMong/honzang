import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_ACCOUNTS } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { sampleCompany } from "@/lib/sample-data";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";

const companySchema = z.object({
  name: z.string().min(1).max(100),
  businessRegistrationNumber: z.string().max(40).optional().nullable(),
  industry: z.string().max(120).optional().nullable(),
  vatType: z.string().min(1).max(40),
  fiscalYearEndMonth: z.coerce.number().int().min(1).max(12),
  representativeSalaryEnabled: z.boolean(),
  employeePayrollEnabled: z.boolean(),
  contractorPaymentEnabled: z.boolean(),
  billingModel: z.enum(["INTERNAL_PER_USE", "SAAS_MONTHLY", "SAAS_ANNUAL"])
});

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({
      company: sampleCompany,
      accounts: DEFAULT_ACCOUNTS,
      csvTemplates: [],
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
  const accounts = await db.account.findMany({
    where: { companyId: company.id, isActive: true },
    orderBy: [{ type: "asc" }, { code: "asc" }]
  });
  const csvTemplates = await db.csvTemplate.findMany({
    where: { companyId: company.id },
    orderBy: [{ sourceType: "asc" }, { updatedAt: "desc" }]
  });

  return NextResponse.json({ company, accounts, csvTemplates, mode: "database" });
}

export async function PATCH(request: Request) {
  const parsed = companySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: true, company: { ...sampleCompany, ...parsed.data }, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const updated = await db.company.update({
    where: { id: company.id },
    data: parsed.data
  });

  return NextResponse.json({ ok: true, company: updated, mode: "database" });
}
