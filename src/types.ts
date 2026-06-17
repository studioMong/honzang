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
  suggestedAccount?: AppAccount | null;
  confirmedAccount?: AppAccount | null;
  evidenceStatus: EvidenceStatus;
  memo?: string | null;
  reviewReasons?: string[];
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

export type ParsedCsvRow = Record<string, string | number | null | undefined>;

export type ImportPreview = {
  headers: string[];
  rows: ParsedCsvRow[];
};

export type ImportPayload = {
  companyId: string;
  sourceType: SourceType;
  originalFileName: string;
  mapping: CsvColumnMapping;
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
