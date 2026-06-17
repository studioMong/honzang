import type { AppAccount } from "@/types";

export const DEFAULT_COMPANY_ID = "studio-mong-sample";

export const DEFAULT_ACCOUNTS: AppAccount[] = [
  { id: "acct-101", code: "101", name: "보통예금", type: "ASSET" },
  { id: "acct-108", code: "108", name: "미수금", type: "ASSET" },
  { id: "acct-135", code: "135", name: "부가세대급금", type: "ASSET", taxCategory: "VAT_INPUT" },
  { id: "acct-136", code: "136", name: "가지급금", type: "ASSET", taxCategory: "OWNER_RISK" },
  { id: "acct-251", code: "251", name: "미지급금", type: "LIABILITY" },
  { id: "acct-253", code: "253", name: "예수금", type: "LIABILITY", taxCategory: "WITHHOLDING" },
  { id: "acct-255", code: "255", name: "부가세예수금", type: "LIABILITY", taxCategory: "VAT_OUTPUT" },
  { id: "acct-281", code: "281", name: "대표자차입금", type: "LIABILITY", taxCategory: "OWNER_RISK" },
  { id: "acct-401", code: "401", name: "매출", type: "REVENUE", taxCategory: "VAT_OUTPUT" },
  { id: "acct-501", code: "501", name: "급여", type: "EXPENSE", taxCategory: "PAYROLL" },
  { id: "acct-502", code: "502", name: "외주비", type: "EXPENSE", taxCategory: "WITHHOLDING_REVIEW" },
  { id: "acct-503", code: "503", name: "복리후생비", type: "EXPENSE" },
  { id: "acct-504", code: "504", name: "접대비", type: "EXPENSE", taxCategory: "LIMITED_DEDUCTION" },
  { id: "acct-505", code: "505", name: "광고선전비", type: "EXPENSE", taxCategory: "VAT_INPUT" },
  { id: "acct-506", code: "506", name: "지급수수료", type: "EXPENSE", taxCategory: "VAT_INPUT" },
  { id: "acct-507", code: "507", name: "통신비", type: "EXPENSE", taxCategory: "VAT_INPUT" },
  { id: "acct-508", code: "508", name: "소모품비", type: "EXPENSE", taxCategory: "VAT_INPUT" },
  { id: "acct-509", code: "509", name: "세금과공과", type: "EXPENSE" },
  { id: "acct-510", code: "510", name: "여비교통비", type: "EXPENSE" },
  { id: "acct-599", code: "599", name: "미분류비용", type: "EXPENSE", taxCategory: "REVIEW" }
];

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  BANK: "통장",
  CARD: "카드",
  HOMETAX_SALES: "홈택스 매출",
  HOMETAX_PURCHASES: "홈택스 매입",
  CASH_RECEIPT: "현금영수증",
  PG: "PG 정산",
  MANUAL: "수기"
};
