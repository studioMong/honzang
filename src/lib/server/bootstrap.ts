import type { PrismaClient } from "@prisma/client";
import { DEFAULT_ACCOUNTS, DEFAULT_COMPANY_ID } from "@/lib/defaults";

export async function ensureDefaultCompany(db: PrismaClient) {
  const company = await db.company.upsert({
    where: { id: DEFAULT_COMPANY_ID },
    update: {},
    create: {
      id: DEFAULT_COMPANY_ID,
      name: "혼자장부 샘플 법인",
      industry: "소프트웨어 개발 및 공급업",
      vatType: "GENERAL",
      fiscalYearEndMonth: 12,
      representativeSalaryEnabled: true,
      contractorPaymentEnabled: true
    }
  });

  await Promise.all(
    DEFAULT_ACCOUNTS.map((account) =>
      db.account.upsert({
        where: {
          companyId_code: {
            companyId: company.id,
            code: account.code
          }
        },
        update: {
          name: account.name,
          type: account.type,
          taxCategory: account.taxCategory ?? null,
          isDefault: true,
          isActive: true
        },
        create: {
          companyId: company.id,
          code: account.code,
          name: account.name,
          type: account.type,
          taxCategory: account.taxCategory ?? null,
          isDefault: true
        }
      })
    )
  );

  return company;
}
