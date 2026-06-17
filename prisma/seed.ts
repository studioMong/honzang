import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DEFAULT_ACCOUNTS, DEFAULT_COMPANY_ID } from "../src/lib/defaults";
import { sampleTransactions } from "../src/lib/sample-data";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL)
});

async function main() {
  const company = await prisma.company.upsert({
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

  for (const account of DEFAULT_ACCOUNTS) {
    await prisma.account.upsert({
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
    });
  }

  const accountByCode = new Map(
    (await prisma.account.findMany({ where: { companyId: company.id } })).map((account) => [account.code, account.id])
  );

  const existingCount = await prisma.transaction.count({ where: { companyId: company.id } });
  if (existingCount === 0) {
    for (const transaction of sampleTransactions) {
      const suggestedCode = transaction.suggestedAccount?.code;
      const confirmedCode = transaction.confirmedAccount?.code;
      await prisma.transaction.create({
        data: {
          companyId: company.id,
          sourceType: transaction.sourceType,
          transactionDate: new Date(transaction.transactionDate),
          description: transaction.description,
          counterparty: transaction.counterparty,
          direction: transaction.direction,
          depositAmount: transaction.depositAmount,
          withdrawalAmount: transaction.withdrawalAmount,
          supplyAmount: transaction.supplyAmount,
          vatAmount: transaction.vatAmount,
          suggestedAccountId: suggestedCode ? accountByCode.get(suggestedCode) : null,
          confirmedAccountId: confirmedCode ? accountByCode.get(confirmedCode) : null,
          evidenceStatus: transaction.evidenceStatus,
          memo: transaction.memo
        }
      });
    }
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    throw error;
  });
