-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BillingModel" AS ENUM ('INTERNAL_PER_USE', 'SAAS_MONTHLY', 'SAAS_ANNUAL');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('BANK', 'CARD', 'HOMETAX_SALES', 'HOMETAX_PURCHASES', 'CASH_RECEIPT', 'PG', 'MANUAL');

-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('UNCHECKED', 'MISSING', 'ATTACHED', 'MATCHED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "ReviewSeverity" AS ENUM ('INFO', 'WARNING', 'DANGER');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'APPROVED', 'VOID');

-- CreateEnum
CREATE TYPE "TaxReportType" AS ENUM ('MONTHLY_PROFIT', 'VAT_PREP', 'WITHHOLDING_CHECKLIST', 'CORPORATE_TAX_PREP', 'RISK_REVIEW');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessRegistrationNumber" TEXT,
    "industry" TEXT,
    "vatType" TEXT NOT NULL DEFAULT 'GENERAL',
    "fiscalYearEndMonth" INTEGER NOT NULL DEFAULT 12,
    "representativeSalaryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "employeePayrollEnabled" BOOLEAN NOT NULL DEFAULT false,
    "contractorPaymentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "billingModel" "BillingModel" NOT NULL DEFAULT 'INTERNAL_PER_USE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "taxCategory" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsvTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "headerSignature" TEXT,
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsvTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "originalFileHash" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "sourceRowNumber" INTEGER,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "counterparty" TEXT,
    "direction" "TransactionDirection" NOT NULL DEFAULT 'UNKNOWN',
    "depositAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "withdrawalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "supplyAmount" DECIMAL(14,2),
    "vatAmount" DECIMAL(14,2),
    "balance" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "approvalNumber" TEXT,
    "rawPayload" JSONB,
    "suggestedAccountId" TEXT,
    "confirmedAccountId" TEXT,
    "evidenceStatus" "EvidenceStatus" NOT NULL DEFAULT 'UNCHECKED',
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transactionId" TEXT,
    "evidenceType" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "counterparty" TEXT,
    "businessRegistrationNumber" TEXT,
    "supplyAmount" DECIMAL(14,2),
    "vatAmount" DECIMAL(14,2),
    "totalAmount" DECIMAL(14,2),
    "fileName" TEXT,
    "fileUrl" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transactionId" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "memo" TEXT NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatType" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessRegistrationNumber" TEXT,
    "defaultAccountId" TEXT,
    "withholdingType" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassificationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "SourceType",
    "condition" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transactionId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "severity" "ReviewSeverity" NOT NULL,
    "reason" TEXT NOT NULL,
    "recommendation" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reportType" "TaxReportType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "calculatedPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_companyId_type_idx" ON "Account"("companyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_code_key" ON "Account"("companyId", "code");

-- CreateIndex
CREATE INDEX "CsvTemplate_companyId_sourceType_idx" ON "CsvTemplate"("companyId", "sourceType");

-- CreateIndex
CREATE INDEX "Transaction_companyId_transactionDate_idx" ON "Transaction"("companyId", "transactionDate");

-- CreateIndex
CREATE INDEX "Transaction_companyId_sourceType_idx" ON "Transaction"("companyId", "sourceType");

-- CreateIndex
CREATE INDEX "Transaction_companyId_evidenceStatus_idx" ON "Transaction"("companyId", "evidenceStatus");

-- CreateIndex
CREATE INDEX "Evidence_companyId_evidenceType_idx" ON "Evidence"("companyId", "evidenceType");

-- CreateIndex
CREATE INDEX "Evidence_companyId_issueDate_idx" ON "Evidence"("companyId", "issueDate");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_entryDate_idx" ON "JournalEntry"("companyId", "entryDate");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_status_idx" ON "JournalEntry"("companyId", "status");

-- CreateIndex
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE INDEX "Vendor_companyId_name_idx" ON "Vendor"("companyId", "name");

-- CreateIndex
CREATE INDEX "ClassificationRule_companyId_isActive_priority_idx" ON "ClassificationRule"("companyId", "isActive", "priority");

-- CreateIndex
CREATE INDEX "ReviewItem_companyId_status_idx" ON "ReviewItem"("companyId", "status");

-- CreateIndex
CREATE INDEX "ReviewItem_companyId_severity_idx" ON "ReviewItem"("companyId", "severity");

-- CreateIndex
CREATE INDEX "TaxReport_companyId_reportType_periodStart_periodEnd_idx" ON "TaxReport"("companyId", "reportType", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsvTemplate" ADD CONSTRAINT "CsvTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_suggestedAccountId_fkey" FOREIGN KEY ("suggestedAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_confirmedAccountId_fkey" FOREIGN KEY ("confirmedAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationRule" ADD CONSTRAINT "ClassificationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReport" ADD CONSTRAINT "TaxReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
