export type SourceType =
  | "BANK"
  | "CARD"
  | "HOMETAX_SALES"
  | "HOMETAX_PURCHASES"
  | "CASH_RECEIPT"
  | "PG"
  | "MANUAL";

export type EvidenceStatus = "UNCHECKED" | "MISSING" | "ATTACHED" | "MATCHED" | "NOT_REQUIRED";

export type ReviewSeverity = "INFO" | "WARNING" | "DANGER";

export type TransactionDirection = "DEPOSIT" | "WITHDRAWAL" | "TRANSFER" | "UNKNOWN";

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export type BillingModel = "INTERNAL_PER_USE" | "SAAS_MONTHLY" | "SAAS_ANNUAL";

export type TaxReportType = "MONTHLY_PROFIT" | "VAT_PREP" | "WITHHOLDING_CHECKLIST" | "CORPORATE_TAX_PREP" | "RISK_REVIEW";

export type AppCompany = {
  id: string;
  name: string;
  businessRegistrationNumber?: string | null;
  industry?: string | null;
  vatType: string;
  fiscalYearEndMonth: number;
  representativeSalaryEnabled: boolean;
  employeePayrollEnabled: boolean;
  contractorPaymentEnabled: boolean;
  billingModel: BillingModel;
};

export type AppAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  taxCategory?: string | null;
};

export type AppTransaction = {
  id: string;
  importBatchId?: string | null;
  sourceRowNumber?: number | null;
  sourceType: SourceType;
  transactionDate: string;
  description: string;
  counterparty?: string | null;
  direction: TransactionDirection;
  depositAmount: number;
  withdrawalAmount: number;
  supplyAmount?: number | null;
  vatAmount?: number | null;
  balance?: number | null;
  approvalNumber?: string | null;
  suggestedAccount?: AppAccount | null;
  confirmedAccount?: AppAccount | null;
  evidenceStatus: EvidenceStatus;
  memo?: string | null;
  reviewReasons?: string[];
};

export type AppEvidence = {
  id: string;
  evidenceType: string;
  issueDate?: string | null;
  counterparty?: string | null;
  businessRegistrationNumber?: string | null;
  supplyAmount?: number | null;
  vatAmount?: number | null;
  totalAmount?: number | null;
  fileName?: string | null;
  fileUrl?: string | null;
  fileDataUrl?: string | null;
  fileMimeType?: string | null;
  fileSize?: number | null;
  transactionId?: string | null;
  transaction?: AppTransaction | null;
};

export type JournalDraftLine = {
  accountCode: string;
  accountName: string;
  accountType?: AccountType;
  debitAmount: number;
  creditAmount: number;
  vatType?: string | null;
  memo?: string;
};

export type JournalDraft = {
  transactionId: string;
  entryDate: string;
  memo: string;
  status: "DRAFT";
  lines: JournalDraftLine[];
  warnings: string[];
};

export type AppJournalEntry = {
  id: string;
  transactionId?: string | null;
  entryDate: string;
  memo: string;
  status: "DRAFT" | "APPROVED" | "VOID";
  lines: JournalDraftLine[];
  transaction?: AppTransaction | null;
};

export type AppTaxReport = {
  id: string;
  reportType: TaxReportType;
  periodStart: string;
  periodEnd: string;
  calculatedPayload: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CsvColumnMapping = {
  transactionDate?: string;
  description?: string;
  counterparty?: string;
  depositAmount?: string;
  withdrawalAmount?: string;
  amount?: string;
  supplyAmount?: string;
  vatAmount?: string;
  balance?: string;
  approvalNumber?: string;
};

export type CsvTemplate = {
  id: string;
  name: string;
  sourceType: SourceType;
  headerSignature?: string | null;
  mapping: CsvColumnMapping;
};

export type AppClassificationRule = {
  id: string;
  name: string;
  keyword: string;
  accountCode: string;
  accountName?: string | null;
  sourceType?: SourceType | null;
  priority: number;
  isActive: boolean;
};

export type AppImportBatch = {
  id: string;
  sourceType: SourceType;
  originalFileName: string;
  originalFileHash?: string | null;
  originalFileMimeType?: string | null;
  originalFileSize?: number | null;
  hasOriginalFile?: boolean;
  rowCount: number;
  importedAt: string;
};

export type AppVendor = {
  id: string;
  name: string;
  businessRegistrationNumber?: string | null;
  defaultAccount?: AppAccount | null;
  withholdingType?: string | null;
  memo?: string | null;
};

export type ParsedCsvRow = Record<string, string | number | null | undefined>;

export type ImportPreview = {
  headers: string[];
  rows: ParsedCsvRow[];
};

export type ImportPayload = {
  companyId: string;
  sourceType: SourceType;
  originalFileName: string;
  originalFileHash?: string;
  mapping: CsvColumnMapping;
  headers?: string[];
  rows: ParsedCsvRow[];
};

export type ReviewItem = {
  id: string;
  severity: ReviewSeverity;
  reason: string;
  recommendation?: string | null;
  status: "OPEN" | "RESOLVED" | "IGNORED";
  transaction?: AppTransaction | null;
};

export type SummaryReport = {
  periodLabel: string;
  revenue: number;
  expense: number;
  profit: number;
  vatOutput: number;
  vatInput: number;
  vatPayable: number;
  missingEvidenceAmount: number;
  reviewCount: number;
  riskCount: number;
};
