import type { AppAccount, AppTransaction, JournalDraft, ParsedCsvRow, CsvColumnMapping, SourceType } from "@/types";
import { DEFAULT_ACCOUNTS } from "@/lib/defaults";

const keywordAccountRules: Array<{ keywords: string[]; code: string; reason?: string }> = [
  { keywords: ["매출", "입금", "프로젝트", "용역"], code: "401" },
  { keywords: ["네이버", "구글", "메타", "광고", "애즈", "ads"], code: "505" },
  { keywords: ["openai", "github", "aws", "vercel", "railway", "slack", "notion", "figma", "saas"], code: "506", reason: "해외 SaaS 또는 소프트웨어 비용은 증빙과 부가세 처리 검토가 필요합니다." },
  { keywords: ["통신", "kt", "skt", "lg유플러스", "인터넷"], code: "507" },
  { keywords: ["문구", "쿠팡", "소모품", "오피스"], code: "508" },
  { keywords: ["외주", "프리랜서", "디자인", "개발자"], code: "502", reason: "외주비는 원천세 또는 세금계산서 수취 여부 확인이 필요합니다." },
  { keywords: ["급여", "상여", "4대보험"], code: "501" },
  { keywords: ["식대", "카페", "커피", "음식", "식당"], code: "503" },
  { keywords: ["접대", "경조사", "축의", "조의"], code: "504", reason: "접대비/경조사비는 한도와 증빙 요건 검토가 필요합니다." },
  { keywords: ["세금", "국세", "지방세", "고용보험", "산재보험"], code: "509" },
  { keywords: ["대표", "대표자", "차입", "가수", "개인"], code: "281", reason: "대표자 거래는 가지급금/차입금 여부를 확인해야 합니다." }
];

export function parseMoney(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const normalized = value.replace(/[,\s원₩]/g, "").replace(/[()]/g, "-");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

export function parseDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "string") return new Date().toISOString().slice(0, 10);
  const trimmed = value.trim();
  const dotted = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (dotted) {
    const [, year, month, day] = dotted;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) {
    const [, year, month, day] = compact;
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
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
  const depositAmount = parseMoney(get(mapping.depositAmount)) || (sourceType === "HOMETAX_SALES" ? amount : 0);
  const withdrawalAmount = parseMoney(get(mapping.withdrawalAmount)) || (sourceType !== "HOMETAX_SALES" ? amount : 0);
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
    balance: mapping.balance ? parseMoney(get(mapping.balance)) : null,
    suggestedAccount: inferred.account,
    confirmedAccount: null,
    evidenceStatus: "UNCHECKED",
    memo: null,
    reviewReasons,
    approvalNumber: mapping.approvalNumber ? String(get(mapping.approvalNumber) ?? "") : null,
    rawPayload: row
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

export function summarizeTransactions(transactions: AppTransaction[]) {
  const revenue = transactions.reduce((sum, tx) => sum + tx.depositAmount / 1.1, 0);
  const expense = transactions.reduce((sum, tx) => sum + tx.withdrawalAmount / 1.1, 0);
  const vatOutput = transactions.reduce((sum, tx) => sum + (tx.vatAmount ?? (tx.depositAmount > 0 ? tx.depositAmount - tx.depositAmount / 1.1 : 0)), 0);
  const vatInput = transactions.reduce((sum, tx) => sum + (tx.vatAmount ?? (tx.withdrawalAmount > 0 ? tx.withdrawalAmount - tx.withdrawalAmount / 1.1 : 0)), 0);
  const missingEvidenceAmount = transactions
    .filter((tx) => tx.withdrawalAmount > 0 && ["MISSING", "UNCHECKED"].includes(tx.evidenceStatus))
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

  const supplyAmount = transaction.supplyAmount ?? Math.round((transaction.depositAmount || transaction.withdrawalAmount) / 1.1);
  const vatAmount = transaction.vatAmount ?? Math.round((transaction.depositAmount || transaction.withdrawalAmount) - supplyAmount);

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
      lines.push({
        accountCode: account.code,
        accountName: account.name,
        debitAmount: supplyAmount,
        creditAmount: 0,
        memo
      });

      if (vatAmount > 0 && account.taxCategory === "VAT_INPUT") {
        lines.push({ accountCode: "135", accountName: "부가세대급금", debitAmount: vatAmount, creditAmount: 0, memo: "매입 부가세" });
      } else if (vatAmount > 0) {
        warnings.push("부가세 공제 가능 여부를 확인해야 합니다.");
      }

      lines.push({
        accountCode: "101",
        accountName: "보통예금",
        debitAmount: 0,
        creditAmount: transaction.withdrawalAmount,
        memo: "지출"
      });
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
