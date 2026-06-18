import type { AppAccount, AppClassificationRule, AppTransaction, AppVendor, JournalDraft, ParsedCsvRow, CsvColumnMapping, ReviewItem, SourceType } from "@/types";
import { DEFAULT_ACCOUNTS } from "@/lib/defaults";

const keywordAccountRules: Array<{ keywords: string[]; code: string; reason?: string }> = [
  { keywords: ["대표", "대표자", "차입", "가수", "개인"], code: "281", reason: "대표자 거래는 가지급금/차입금 여부를 확인해야 합니다." },
  { keywords: ["매출", "입금", "프로젝트", "용역", "정산", "구독 결제"], code: "401" },
  { keywords: ["네이버", "구글", "메타", "광고", "애즈", "ads"], code: "505" },
  { keywords: ["openai", "github", "aws", "vercel", "railway", "slack", "notion", "figma", "saas"], code: "506", reason: "해외 SaaS 또는 소프트웨어 비용은 증빙과 부가세 처리 검토가 필요합니다." },
  { keywords: ["통신", "kt", "skt", "lg유플러스", "인터넷"], code: "507" },
  { keywords: ["문구", "쿠팡", "소모품", "오피스"], code: "508" },
  { keywords: ["외주", "프리랜서", "디자인", "개발자"], code: "502", reason: "외주비는 원천세 또는 세금계산서 수취 여부 확인이 필요합니다." },
  { keywords: ["급여", "상여", "4대보험"], code: "501" },
  { keywords: ["식대", "카페", "커피", "음식", "식당"], code: "503" },
  { keywords: ["접대", "경조사", "축의", "조의"], code: "504", reason: "접대비/경조사비는 한도와 증빙 요건 검토가 필요합니다." },
  { keywords: ["세금", "국세", "지방세", "고용보험", "산재보험"], code: "509" }
];

const optionalTimeSuffix = "(?:[T ]+(?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d{1,6})?)?(?: ?(?:Z|[+-](?:[01]\\d|2[0-3]):?[0-5]\\d))?)?";
const separatedDatePattern = new RegExp(`^(\\d{4})[./-](\\d{1,2})[./-](\\d{1,2})${optionalTimeSuffix}$`);
const compactDatePattern = new RegExp(`^(\\d{4})(\\d{2})(\\d{2})${optionalTimeSuffix}$`);

export function parseMoney(value: unknown): number {
  return Math.abs(parseSignedMoney(value));
}

export function parseSignedMoney(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const compact = value.trim().replace(/[,\s원₩]/g, "");
  const parenthesized = compact.match(/^\((.+)\)$/);
  const trailingNegative = compact.match(/^(.+)-$/);
  const normalized = parenthesized ? `-${parenthesized[1]}` : trailingNegative ? `-${trailingNegative[1]}` : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseDate(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  const dotted = trimmed.match(separatedDatePattern);
  if (dotted) {
    const [, year, month, day] = dotted;
    return validDateParts(Number(year), Number(month), Number(day)) ?? trimmed;
  }
  const compact = trimmed.match(compactDatePattern);
  if (compact) {
    const [, year, month, day] = compact;
    return validDateParts(Number(year), Number(month), Number(day)) ?? trimmed;
  }
  return trimmed;
}

function validDateParts(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function inferMapping(headers: string[], sourceType: SourceType): CsvColumnMapping {
  const find = (...keywords: string[]) => headers.find((header) => keywords.some((keyword) => header.toLowerCase().includes(keyword.toLowerCase())));
  return {
    transactionDate: find("거래일", "일자", "사용일", "승인일", "작성일", "정산일", "date"),
    description: find("적요", "내용", "거래내용", "품목", "가맹점", "description", "memo") ?? find("상호", "거래처"),
    counterparty: find("거래처", "상호", "가맹점", "counterparty", "merchant"),
    depositAmount: sourceType === "BANK" ? find("입금", "맡기신", "deposit") : undefined,
    withdrawalAmount: sourceType === "BANK" ? find("출금", "찾으신", "withdrawal") : undefined,
    amount: sourceType !== "BANK" ? find("금액", "합계", "이용금액", "승인금액", "total", "amount") : undefined,
    supplyAmount: find("공급가액", "공급", "supply"),
    vatAmount: find("부가세", "세액", "vat"),
    balance: find("잔액", "balance"),
    approvalNumber: find("승인번호", "approval")
  };
}

export function inferAccount(description: string, counterparty?: string | null): { account: AppAccount; reason?: string } {
  const haystack = `${description} ${counterparty ?? ""}`.toLowerCase();
  const rule = keywordAccountRules.find((item) => item.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())));
  const account = DEFAULT_ACCOUNTS.find((item) => item.code === rule?.code) ?? DEFAULT_ACCOUNTS.find((item) => item.code === "599");
  if (!account) throw new Error("Default accounts are not configured.");
  return { account, reason: rule?.reason };
}

function getAccountType(code: string) {
  return DEFAULT_ACCOUNTS.find((item) => item.code === code)?.type;
}

export function normalizeCsvRow(
  row: ParsedCsvRow,
  mapping: CsvColumnMapping,
  sourceType: SourceType,
  index: number
): Omit<AppTransaction, "id"> & { approvalNumber?: string | null; rawPayload: ParsedCsvRow } {
  const get = (key?: string) => (key ? row[key] : undefined);
  const amount = parseMoney(get(mapping.amount));
  const isIncomeSource = sourceType === "HOMETAX_SALES" || sourceType === "PG";
  const depositAmount = parseMoney(get(mapping.depositAmount)) || (isIncomeSource ? amount : 0);
  const withdrawalAmount = parseMoney(get(mapping.withdrawalAmount)) || (!isIncomeSource ? amount : 0);
  const description = String(get(mapping.description) ?? get(mapping.counterparty) ?? `CSV ${index + 1}행`).trim();
  const counterparty = String(get(mapping.counterparty) ?? "").trim() || null;
  const inferred = inferAccount(description, counterparty);
  const reviewReasons = collectReviewReasons({
    description,
    counterparty,
    depositAmount,
    withdrawalAmount,
    evidenceStatus: "UNCHECKED",
    suggestedAccount: inferred.account
  });
  if (inferred.reason) reviewReasons.push(inferred.reason);

  return {
    sourceType,
    transactionDate: parseDate(get(mapping.transactionDate)),
    description,
    counterparty,
    direction: depositAmount > 0 ? "DEPOSIT" : withdrawalAmount > 0 ? "WITHDRAWAL" : "UNKNOWN",
    depositAmount,
    withdrawalAmount,
    supplyAmount: mapping.supplyAmount ? parseMoney(get(mapping.supplyAmount)) : null,
    vatAmount: mapping.vatAmount ? parseMoney(get(mapping.vatAmount)) : null,
    balance: mapping.balance ? parseSignedMoney(get(mapping.balance)) : null,
    suggestedAccount: inferred.account,
    confirmedAccount: null,
    evidenceStatus: "UNCHECKED",
    memo: null,
    reviewReasons,
    approvalNumber: mapping.approvalNumber ? String(get(mapping.approvalNumber) ?? "") : null,
    rawPayload: row
  };
}

export function applyClassificationRules<T extends Pick<AppTransaction, "sourceType" | "description" | "counterparty" | "suggestedAccount"> & { reviewReasons?: string[] }>(
  transaction: T,
  rules: AppClassificationRule[],
  accounts: AppAccount[]
): T {
  const text = `${transaction.description} ${transaction.counterparty ?? ""}`.toLowerCase();
  const rule = rules
    .filter((item) => item.isActive)
    .sort((left, right) => left.priority - right.priority)
    .find((item) => {
      if (item.sourceType && item.sourceType !== transaction.sourceType) return false;
      return text.includes(item.keyword.toLowerCase());
    });

  if (!rule) return transaction;

  const account = accounts.find((item) => item.code === rule.accountCode);
  if (!account) return transaction;

  return {
    ...transaction,
    suggestedAccount: account,
    reviewReasons: [...new Set([...(transaction.reviewReasons ?? []), `분류 규칙 적용: ${rule.name}`])]
  };
}

export function applyVendorDefaults<T extends Pick<AppTransaction, "counterparty" | "suggestedAccount"> & { reviewReasons?: string[] }>(
  transaction: T,
  vendors: AppVendor[]
): T {
  const counterparty = normalizeVendorText(transaction.counterparty);
  if (!counterparty) return transaction;

  const vendor = vendors.find((item) => {
    const name = normalizeVendorText(item.name);
    return Boolean(name && (counterparty.includes(name) || name.includes(counterparty)));
  });
  if (!vendor) return transaction;

  const reasons = [...(transaction.reviewReasons ?? [])];
  if (vendor.defaultAccount) {
    reasons.push(`거래처 기본 계정 적용: ${vendor.name}`);
  }
  if (vendor.withholdingType && vendor.withholdingType !== "NONE") {
    reasons.push(`거래처 원천세 유형 확인: ${withholdingTypeReviewLabel(vendor.withholdingType)}`);
  }

  return {
    ...transaction,
    suggestedAccount: vendor.defaultAccount ?? transaction.suggestedAccount,
    reviewReasons: [...new Set(reasons)]
  };
}

export function collectReviewReasons(input: {
  description: string;
  counterparty?: string | null;
  depositAmount: number;
  withdrawalAmount: number;
  evidenceStatus: string;
  suggestedAccount?: AppAccount | null;
}): string[] {
  const text = `${input.description} ${input.counterparty ?? ""}`.toLowerCase();
  const reasons: string[] = [];

  if (input.withdrawalAmount > 0 && ["UNCHECKED", "MISSING"].includes(input.evidenceStatus)) {
    reasons.push("비용 거래는 증빙 확인이 필요합니다.");
  }
  if (text.includes("대표") || text.includes("개인")) {
    reasons.push("대표자 입출금은 가지급금/차입금 여부를 확인해야 합니다.");
  }
  if (["openai", "aws", "github", "vercel", "railway", "stripe", "google"].some((keyword) => text.includes(keyword))) {
    reasons.push("해외 SaaS 결제는 인보이스와 업무 관련성 메모를 보관해야 합니다.");
  }
  if (input.suggestedAccount?.taxCategory === "WITHHOLDING_REVIEW") {
    reasons.push("외주비는 원천세 대상 또는 세금계산서 수취 여부를 확인해야 합니다.");
  }
  if (input.suggestedAccount?.taxCategory === "LIMITED_DEDUCTION") {
    reasons.push("접대비성 지출은 한도와 적격증빙 요건을 확인해야 합니다.");
  }

  return [...new Set(reasons)];
}

export function reviewSeverityForReason(reason: string): ReviewItem["severity"] {
  if (reason.includes("원천세") || reason.includes("대표자") || reason.includes("가지급금") || reason.includes("차입금")) return "DANGER";
  if (reason.includes("증빙") || reason.includes("인보이스") || reason.includes("접대비")) return "WARNING";
  return "INFO";
}

export function reviewRecommendationForReason(reason: string) {
  if (reason.includes("대표자") || reason.includes("가지급금") || reason.includes("차입금")) {
    return "대표자차입금/가지급금 여부와 실제 자금 흐름을 확인하세요.";
  }
  if (reason.includes("원천세")) {
    return "세금계산서 수취 거래인지, 3.3% 원천세 신고 대상인지 확인하세요.";
  }
  if (reason.includes("해외 SaaS") || reason.includes("인보이스")) {
    return "해외 인보이스, 업무 관련성 메모, 부가세 처리 여부를 보관하세요.";
  }
  if (reason.includes("증빙")) {
    return "세금계산서, 카드전표, 현금영수증, 인보이스 중 해당 증빙을 연결하세요.";
  }
  if (reason.includes("접대비")) {
    return "접대 목적, 상대방, 적격증빙, 한도 검토가 필요합니다.";
  }
  return "거래 성격과 신고 반영 여부를 확인하세요.";
}

export function buildReviewItems(transactions: AppTransaction[]): ReviewItem[] {
  return transactions.flatMap((transaction) => {
    const account = transaction.confirmedAccount ?? transaction.suggestedAccount ?? null;
    const reasons = [...(transaction.reviewReasons ?? [])];
    collectReviewReasons({
      description: transaction.description,
      counterparty: transaction.counterparty,
      depositAmount: transaction.depositAmount,
      withdrawalAmount: transaction.withdrawalAmount,
      evidenceStatus: transaction.evidenceStatus,
      suggestedAccount: account
    })
      .filter((reason) => !reasons.some((existing) => reviewReasonCategory(existing) === reviewReasonCategory(reason)))
      .forEach((reason) => reasons.push(reason));

    return [...new Set(reasons)].map((reason, index) => ({
      id: `${transaction.id}-${index}`,
      severity: reviewSeverityForReason(reason),
      reason,
      recommendation: reviewRecommendationForReason(reason),
      status: "OPEN",
      transaction
    }));
  });
}

function reviewReasonCategory(reason: string) {
  if (reason.includes("대표자") || reason.includes("가지급금") || reason.includes("차입금")) return "OWNER";
  if (reason.includes("원천세") || reason.includes("외주비") || reason.includes("사업소득") || reason.includes("기타소득")) return "WITHHOLDING";
  if (reason.includes("해외 SaaS") || reason.includes("인보이스")) return "SAAS";
  if (reason.includes("접대비")) return "ENTERTAINMENT";
  if (reason.includes("증빙")) return "EVIDENCE";
  return reason;
}

function normalizeVendorText(value?: string | null) {
  return (value ?? "").toLowerCase().replace(/\s+/g, "").trim();
}

function withholdingTypeReviewLabel(type: string) {
  const labels: Record<string, string> = {
    TAX_INVOICE: "세금계산서 수취",
    BUSINESS_INCOME: "사업소득 3.3%",
    OTHER_INCOME: "기타소득",
    PAYROLL: "급여"
  };
  return labels[type] ?? type;
}

function transactionAccount(transaction: AppTransaction) {
  return transaction.confirmedAccount ?? transaction.suggestedAccount ?? null;
}

function isRevenueTransaction(transaction: AppTransaction) {
  const account = transactionAccount(transaction);
  if (transaction.depositAmount <= 0) return false;
  if (account) return account.type === "REVENUE";
  return transaction.sourceType === "HOMETAX_SALES";
}

function isExpenseTransaction(transaction: AppTransaction) {
  const account = transactionAccount(transaction);
  if (transaction.withdrawalAmount <= 0) return false;
  return account ? account.type === "EXPENSE" : true;
}

function taxableSupplyAmount(transaction: AppTransaction) {
  const grossAmount = transaction.depositAmount || transaction.withdrawalAmount;
  return transaction.supplyAmount ?? Math.round(grossAmount / 1.1);
}

function estimatedVatAmount(transaction: AppTransaction) {
  const grossAmount = transaction.depositAmount || transaction.withdrawalAmount;
  return transaction.vatAmount ?? Math.round(grossAmount - taxableSupplyAmount(transaction));
}

function hasForeignSaasSignal(transaction: AppTransaction) {
  const text = `${transaction.description} ${transaction.counterparty ?? ""}`.toLowerCase();
  return ["openai", "aws", "github", "vercel", "railway", "stripe"].some((keyword) => text.includes(keyword));
}

function outputVatAmount(transaction: AppTransaction) {
  return transaction.vatAmount ?? estimatedVatAmount(transaction);
}

function inputVatAmount(transaction: AppTransaction) {
  if (transaction.vatAmount !== null && transaction.vatAmount !== undefined) return transaction.vatAmount;
  const account = transactionAccount(transaction);
  if (account?.taxCategory === "VAT_INPUT" && !hasForeignSaasSignal(transaction)) return estimatedVatAmount(transaction);
  return 0;
}

export function summarizeTransactions(transactions: AppTransaction[]) {
  const revenueTransactions = transactions.filter(isRevenueTransaction);
  const expenseTransactions = transactions.filter(isExpenseTransaction);
  const revenue = revenueTransactions.reduce((sum, tx) => sum + taxableSupplyAmount(tx), 0);
  const expense = expenseTransactions.reduce((sum, tx) => sum + taxableSupplyAmount(tx), 0);
  const vatOutput = revenueTransactions.reduce((sum, tx) => sum + outputVatAmount(tx), 0);
  const vatInput = expenseTransactions.reduce((sum, tx) => sum + inputVatAmount(tx), 0);
  const missingEvidenceAmount = transactions
    .filter((tx) => isExpenseTransaction(tx) && ["MISSING", "UNCHECKED"].includes(tx.evidenceStatus))
    .reduce((sum, tx) => sum + tx.withdrawalAmount, 0);
  const reviewCount = transactions.filter((tx) => (tx.reviewReasons?.length ?? 0) > 0 || tx.evidenceStatus === "MISSING").length;

  return {
    revenue: Math.round(revenue),
    expense: Math.round(expense),
    profit: Math.round(revenue - expense),
    vatOutput: Math.round(vatOutput),
    vatInput: Math.round(vatInput),
    vatPayable: Math.round(vatOutput - vatInput),
    missingEvidenceAmount: Math.round(missingEvidenceAmount),
    reviewCount,
    riskCount: transactions.filter((tx) => tx.reviewReasons?.some((reason) => reason.includes("원천세") || reason.includes("대표자"))).length
  };
}

export function generateJournalDraft(transaction: AppTransaction): JournalDraft {
  const account = transaction.confirmedAccount ?? transaction.suggestedAccount ?? DEFAULT_ACCOUNTS.find((item) => item.code === "599");
  const warnings = [...(transaction.reviewReasons ?? [])];
  const lines: JournalDraft["lines"] = [];
  const date = transaction.transactionDate;
  const memo = transaction.description;

  if (!account) {
    return {
      transactionId: transaction.id,
      entryDate: date,
      memo,
      status: "DRAFT",
      lines: [],
      warnings: ["계정과목을 먼저 지정해야 분개 초안을 만들 수 있습니다."]
    };
  }

  const grossAmount = transaction.depositAmount || transaction.withdrawalAmount;
  const hasExplicitVatBreakdown =
    (transaction.supplyAmount !== null && transaction.supplyAmount !== undefined) ||
    (transaction.vatAmount !== null && transaction.vatAmount !== undefined);
  const vatAmount = transaction.vatAmount ?? Math.max(0, Math.round(grossAmount - (transaction.supplyAmount ?? grossAmount / 1.1)));
  const supplyAmount = transaction.supplyAmount ?? Math.max(0, Math.round(grossAmount - vatAmount));

  if (transaction.depositAmount > 0) {
    lines.push({
      accountCode: "101",
      accountName: "보통예금",
      debitAmount: transaction.depositAmount,
      creditAmount: 0,
      memo: transaction.counterparty ?? undefined
    });

    if (account.code === "401") {
      lines.push({ accountCode: "401", accountName: "매출", debitAmount: 0, creditAmount: supplyAmount, memo });
      lines.push({ accountCode: "255", accountName: "부가세예수금", debitAmount: 0, creditAmount: vatAmount, memo: "매출 부가세" });
    } else {
      lines.push({
        accountCode: account.code,
        accountName: account.name,
        debitAmount: 0,
        creditAmount: transaction.depositAmount,
        memo
      });
    }
  } else if (transaction.withdrawalAmount > 0) {
    if (account.type === "EXPENSE") {
      const withholdingRate = withholdingRateForJournalDraft(warnings);
      const canCreateWithholdingLine = account.taxCategory === "WITHHOLDING_REVIEW" && !hasExplicitVatBreakdown && withholdingRate > 0;
      const withholdingGrossAmount = canCreateWithholdingLine ? Math.round(transaction.withdrawalAmount / (1 - withholdingRate)) : 0;
      const withholdingAmount = canCreateWithholdingLine ? Math.max(0, withholdingGrossAmount - transaction.withdrawalAmount) : 0;
      const canCreateInputVatLine =
        !canCreateWithholdingLine &&
        vatAmount > 0 &&
        !hasForeignSaasSignal(transaction) &&
        (account.taxCategory === "VAT_INPUT" || (account.taxCategory === "WITHHOLDING_REVIEW" && hasExplicitVatBreakdown));
      const expenseDebitAmount = canCreateWithholdingLine ? withholdingGrossAmount : canCreateInputVatLine ? supplyAmount : transaction.withdrawalAmount;

      lines.push({
        accountCode: account.code,
        accountName: account.name,
        debitAmount: expenseDebitAmount,
        creditAmount: 0,
        memo
      });

      if (canCreateInputVatLine) {
        lines.push({ accountCode: "135", accountName: "부가세대급금", debitAmount: vatAmount, creditAmount: 0, memo: "매입 부가세" });
      } else if (vatAmount > 0 && hasExplicitVatBreakdown) {
        warnings.push("부가세를 비용에 포함할지 매입세액으로 공제할지 확인해야 합니다.");
      }

      lines.push({
        accountCode: "101",
        accountName: "보통예금",
        debitAmount: 0,
        creditAmount: transaction.withdrawalAmount,
        memo: "지출"
      });

      if (canCreateWithholdingLine && withholdingAmount > 0) {
        lines.push({
          accountCode: "253",
          accountName: "예수금",
          debitAmount: 0,
          creditAmount: withholdingAmount,
          memo: "사업소득 3.3% 원천세 추정"
        });
        warnings.push("사업소득 3.3% 원천세 예수금은 지급액 기준 추정치이므로 신고 전 확인해야 합니다.");
      }
    } else {
      lines.push({
        accountCode: account.code,
        accountName: account.name,
        debitAmount: transaction.withdrawalAmount,
        creditAmount: 0,
        memo
      });
      lines.push({
        accountCode: "101",
        accountName: "보통예금",
        debitAmount: 0,
        creditAmount: transaction.withdrawalAmount,
        memo: "출금"
      });
    }
  } else {
    warnings.push("입금/출금 금액이 없어 분개 초안이 비어 있습니다.");
  }

  const debit = lines.reduce((sum, line) => sum + line.debitAmount, 0);
  const credit = lines.reduce((sum, line) => sum + line.creditAmount, 0);
  if (debit !== credit) {
    warnings.push(`차변/대변 차액 ${Math.abs(debit - credit).toLocaleString("ko-KR")}원을 확인해야 합니다.`);
  }

  return {
    transactionId: transaction.id,
    entryDate: date,
    memo,
    status: "DRAFT",
    lines: lines.map((line) => ({
      ...line,
      accountType: line.accountType ?? getAccountType(line.accountCode)
    })),
    warnings: [...new Set(warnings)]
  };
}

function withholdingRateForJournalDraft(warnings: string[]) {
  const hasBusinessIncomeSignal = warnings.some((warning) => warning.includes("BUSINESS_INCOME") || warning.includes("사업소득 3.3%"));
  return hasBusinessIncomeSignal ? 0.033 : 0;
}
