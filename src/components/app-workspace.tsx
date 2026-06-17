"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import Papa from "papaparse";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSpreadsheet,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  Printer,
  ReceiptText,
  RefreshCcw,
  Settings,
  Smartphone,
  Upload,
  WalletCards
} from "lucide-react";
import type {
  AppAccount,
  AppAuditEvent,
  AppClassificationRule,
  AppClosingPeriod,
  AppCompany,
  AppEvidence,
  AppImportBatch,
  AppJournalEntry,
  AppTaxReport,
  AppTransaction,
  AppVendor,
  CsvColumnMapping,
  CsvTemplate,
  EvidenceStatus,
  ImportPreview,
  ParsedCsvRow,
  ReviewItem,
  SourceType
} from "@/types";
import { RESTORE_CONFIRMATION_TEXT } from "@/lib/backup-restore";
import { DEFAULT_ACCOUNTS, DEFAULT_COMPANY_ID, SOURCE_TYPE_LABELS } from "@/lib/defaults";
import { applyClassificationRules, buildReviewItems, generateJournalDraft, inferMapping, normalizeCsvRow, parseMoney, summarizeTransactions } from "@/lib/accounting";
import { formatDate, formatDateTime, formatKRW, formatNumber } from "@/lib/format";
import { sampleCompany, sampleEvidences, sampleJournalEntries, sampleTaxReports, sampleTransactions } from "@/lib/sample-data";
import { createXlsxBlob, type XlsxSheet } from "@/lib/xlsx";
import { createZipBlob, type ZipFile } from "@/lib/zip";

export type ViewKey = "dashboard" | "imports" | "transactions" | "evidences" | "journals" | "reviews" | "reports" | "settings";

type StatusTone = "green" | "amber" | "red" | "blue";
type JournalDraft = ReturnType<typeof generateJournalDraft>;
type JournalDraftFilter = "ALL" | "READY" | "REVIEW" | "APPROVED";
type PanelMessage = {
  tone: "green" | "amber" | "red";
  text: string;
  details?: string[];
};
type MappingSourceState = {
  type: "database" | "local" | "inferred" | "edited";
  label: string;
};

type FilingReadinessRow = {
  순서: number;
  점검: string;
  상태: string;
  톤: StatusTone;
  근거: string;
  "다음 작업": string;
};

type BackupReadinessRow = {
  데이터: string;
  상태: string;
  톤: StatusTone;
  건수: string;
  확인: string;
};

type DataRetentionRow = {
  데이터: string;
  포함정보: string;
  보관위치: string;
  보관기준: string;
  삭제방법: string;
  상태: string;
  톤: StatusTone;
};

type FilingSubmissionGuideRow = {
  순서: number;
  신고: string;
  "홈택스/제출 위치": string;
  "혼자장부에서 볼 것": string;
  상태: string;
  톤: StatusTone;
  "입력 기준": string;
  "마감 전 확인": string;
};

type JournalIntegrityRow = {
  점검: string;
  상태: string;
  톤: StatusTone;
  금액: string;
  근거: string;
  "다음 작업": string;
};

type CashFlowRow = {
  구분: string;
  항목: string;
  금액: number;
  건수: number;
  톤: StatusTone;
  근거: string;
  "다음 확인": string;
};

type BankBalanceCheckRow = {
  점검: string;
  상태: string;
  톤: StatusTone;
  금액: string | number;
  건수: number;
  근거: string;
  "다음 확인": string;
};

type OperationReadinessCheck = {
  key: string;
  label: string;
  status: string;
  tone: StatusTone;
  detail: string;
  action: string;
};

type OperationReadinessPayload = {
  app: string;
  version: string;
  generatedAt: string;
  summary: {
    blockers: number;
    warnings: number;
    passes: number;
  };
  checks: OperationReadinessCheck[];
  railway: {
    commitSha: string | null;
    branch: string | null;
    service: string | null;
    environment: string | null;
  };
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type AccessSession = {
  enabled: boolean;
  authenticated: boolean;
};

const views: Array<{ key: ViewKey; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: "dashboard", label: "대시보드", icon: LayoutDashboard },
  { key: "imports", label: "업로드", icon: Upload },
  { key: "transactions", label: "거래내역", icon: WalletCards },
  { key: "evidences", label: "증빙함", icon: FileCheck2 },
  { key: "journals", label: "자동분개", icon: GitBranch },
  { key: "reviews", label: "검토함", icon: ListChecks },
  { key: "reports", label: "리포트", icon: BarChart3 },
  { key: "settings", label: "설정", icon: Settings }
];

const mappingFields: Array<{ key: keyof CsvColumnMapping; label: string; required?: boolean }> = [
  { key: "transactionDate", label: "거래일", required: true },
  { key: "description", label: "적요/내용", required: true },
  { key: "counterparty", label: "거래처" },
  { key: "depositAmount", label: "입금" },
  { key: "withdrawalAmount", label: "출금" },
  { key: "amount", label: "금액" },
  { key: "supplyAmount", label: "공급가액" },
  { key: "vatAmount", label: "부가세" },
  { key: "balance", label: "잔액" },
  { key: "approvalNumber", label: "승인번호" }
];

const sourceOptions: SourceType[] = ["BANK", "CARD", "HOMETAX_SALES", "HOMETAX_PURCHASES", "CASH_RECEIPT", "PG"];
const MAX_EVIDENCE_FILE_SIZE = 750_000;
const MAX_IMPORT_ORIGINAL_FILE_SIZE = 2_000_000;

const sampleCsvLinks: Record<SourceType, { label: string; href: string }> = {
  BANK: { label: "통장 샘플", href: "/samples/bank-transactions.csv" },
  CARD: { label: "카드 샘플", href: "/samples/card-transactions.csv" },
  HOMETAX_SALES: { label: "홈택스 매출 샘플", href: "/samples/hometax-sales.csv" },
  HOMETAX_PURCHASES: { label: "홈택스 매입 샘플", href: "/samples/hometax-purchases.csv" },
  CASH_RECEIPT: { label: "현금영수증 샘플", href: "/samples/hometax-purchases.csv" },
  PG: { label: "PG 정산 샘플", href: "/samples/pg-settlements.csv" },
  MANUAL: { label: "수기 샘플", href: "/samples/bank-transactions.csv" }
};

const csvPreparationGuides: Record<SourceType, { required: string[]; optional: string[]; masking: string; source: string }> = {
  BANK: {
    required: ["거래일", "적요/내용", "입금/출금 또는 금액"],
    optional: ["거래처", "잔액", "계좌 메모"],
    masking: "계좌번호, 상대방명 일부",
    source: "은행 입출금내역 CSV"
  },
  CARD: {
    required: ["사용일", "가맹점/내용", "이용금액"],
    optional: ["공급가액", "부가세", "승인번호"],
    masking: "카드번호, 승인번호 일부",
    source: "카드사 이용내역 CSV"
  },
  HOMETAX_SALES: {
    required: ["작성일", "거래처", "공급가액", "부가세"],
    optional: ["품목", "합계", "사업자번호"],
    masking: "거래처명, 사업자번호 일부",
    source: "홈택스 전자세금계산서 매출"
  },
  HOMETAX_PURCHASES: {
    required: ["작성일", "거래처", "공급가액", "부가세"],
    optional: ["품목", "합계", "사업자번호"],
    masking: "거래처명, 사업자번호 일부",
    source: "홈택스 전자세금계산서 매입"
  },
  CASH_RECEIPT: {
    required: ["거래일/작성일", "거래처", "합계 또는 금액"],
    optional: ["공급가액", "부가세", "승인번호"],
    masking: "승인번호, 거래처 일부",
    source: "홈택스 현금영수증/카드 매입"
  },
  PG: {
    required: ["정산일", "거래처/플랫폼", "정산금액"],
    optional: ["공급가액", "부가세", "수수료", "주문번호"],
    masking: "주문번호, 구매자 정보",
    source: "PG/마켓 정산 CSV"
  },
  MANUAL: {
    required: ["거래일", "내용", "입금/출금"],
    optional: ["거래처", "계정과목", "증빙 상태"],
    masking: "거래처 일부",
    source: "수기 입력 보조 CSV"
  }
};

export function AppWorkspace({ initialView = "dashboard" }: { initialView?: ViewKey }) {
  const [activeView, setActiveView] = useState<ViewKey>(initialView);
  const [company, setCompany] = useState<AppCompany>(sampleCompany);
  const [accounts, setAccounts] = useState<AppAccount[]>(DEFAULT_ACCOUNTS);
  const [csvTemplates, setCsvTemplates] = useState<CsvTemplate[]>([]);
  const [classificationRules, setClassificationRules] = useState<AppClassificationRule[]>([]);
  const [importBatches, setImportBatches] = useState<AppImportBatch[]>([]);
  const [transactions, setTransactions] = useState<AppTransaction[]>(sampleTransactions);
  const [evidences, setEvidences] = useState<AppEvidence[]>(sampleEvidences);
  const [journalEntries, setJournalEntries] = useState<AppJournalEntry[]>(sampleJournalEntries);
  const [taxReports, setTaxReports] = useState<AppTaxReport[]>(sampleTaxReports);
  const [vendors, setVendors] = useState<AppVendor[]>([]);
  const [auditEvents, setAuditEvents] = useState<AppAuditEvent[]>([]);
  const [closingPeriods, setClosingPeriods] = useState<AppClosingPeriod[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>(buildReviewItems(sampleTransactions));
  const [reviewStatusOverrides, setReviewStatusOverrides] = useState<Record<string, ReviewItem["status"]>>({});
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"sample" | "database">("sample");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandaloneMode, setIsStandaloneMode] = useState(false);
  const [accessSession, setAccessSession] = useState<AccessSession | null>(null);

  const summary = useMemo(() => summarizeTransactions(transactions), [transactions]);
  const computedReviewItems = useMemo(() => buildReviewItems(transactions), [transactions]);
  const visibleReviewItems = useMemo(
    () =>
      mode === "sample"
        ? computedReviewItems.map((item) => ({ ...item, status: reviewStatusOverrides[item.id] ?? item.status }))
        : reviewItems,
    [computedReviewItems, mode, reviewItems, reviewStatusOverrides]
  );
  const openReviewItems = useMemo(() => visibleReviewItems.filter((item) => item.status === "OPEN"), [visibleReviewItems]);

  async function refresh() {
    setLoading(true);
    try {
      const [companyResponse, transactionResponse] = await Promise.all([
        fetch("/api/companies", { cache: "no-store" }),
        fetch("/api/transactions", { cache: "no-store" })
      ]);
      const importResponse = await fetch("/api/imports", { cache: "no-store" });
      const evidenceResponse = await fetch("/api/evidences", { cache: "no-store" });
      const journalResponse = await fetch("/api/journals", { cache: "no-store" });
      const reportResponse = await fetch("/api/reports", { cache: "no-store" });
      const reviewResponse = await fetch("/api/reviews", { cache: "no-store" });
      const vendorResponse = await fetch("/api/vendors", { cache: "no-store" });
      const auditResponse = await fetch("/api/audit-events", { cache: "no-store" });
      const closingPeriodResponse = await fetch("/api/closing-periods", { cache: "no-store" });
      const responses = [
        companyResponse,
        transactionResponse,
        importResponse,
        evidenceResponse,
        journalResponse,
        reportResponse,
        reviewResponse,
        vendorResponse,
        auditResponse,
        closingPeriodResponse
      ];
      if (responses.some((response) => response.status === 401)) {
        redirectToAccess();
        return;
      }
      const companyPayload = await companyResponse.json();
      const transactionPayload = await transactionResponse.json();
      const importPayload = await importResponse.json();
      const evidencePayload = await evidenceResponse.json();
      const journalPayload = await journalResponse.json();
      const reportPayload = await reportResponse.json();
      const reviewPayload = await reviewResponse.json();
      const vendorPayload = await vendorResponse.json();
      const auditPayload = await auditResponse.json();
      const closingPeriodPayload = await closingPeriodResponse.json();
      const isDatabaseMode =
        companyPayload.mode === "database" ||
        transactionPayload.mode === "database" ||
        importPayload.mode === "database" ||
        evidencePayload.mode === "database" ||
        journalPayload.mode === "database" ||
        reportPayload.mode === "database" ||
        reviewPayload.mode === "database" ||
        vendorPayload.mode === "database" ||
        auditPayload.mode === "database" ||
        closingPeriodPayload.mode === "database";
      const nextTransactions = isDatabaseMode ? transactionPayload.transactions ?? [] : transactionPayload.transactions?.length ? transactionPayload.transactions : sampleTransactions;
      setCompany(companyPayload.company ?? sampleCompany);
      setAccounts(companyPayload.accounts ?? DEFAULT_ACCOUNTS);
      setCsvTemplates(companyPayload.csvTemplates ?? []);
      setClassificationRules(companyPayload.classificationRules ?? []);
      setImportBatches(importPayload.importBatches ?? []);
      setTransactions(nextTransactions);
      setEvidences(isDatabaseMode ? evidencePayload.evidences ?? [] : evidencePayload.evidences?.length ? evidencePayload.evidences : sampleEvidences);
      setJournalEntries(journalPayload.journalEntries ?? []);
      setTaxReports(reportPayload.taxReports ?? []);
      setVendors(vendorPayload.vendors ?? []);
      setAuditEvents(auditPayload.auditEvents ?? []);
      setClosingPeriods(closingPeriodPayload.closingPeriods ?? []);
      setReviewItems(reviewPayload.reviewItems ?? buildReviewItems(nextTransactions));
      setMode(isDatabaseMode ? "database" : "sample");
    } catch {
      setCompany(sampleCompany);
      setAccounts(DEFAULT_ACCOUNTS);
      setCsvTemplates([]);
      setClassificationRules([]);
      setImportBatches([]);
      setTransactions(sampleTransactions);
      setEvidences(sampleEvidences);
      setJournalEntries(sampleJournalEntries);
      setTaxReports(sampleTaxReports);
      setVendors([]);
      setAuditEvents([]);
      setClosingPeriods([]);
      setReviewItems(buildReviewItems(sampleTransactions));
      setMode("sample");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadAccessSession() {
      const response = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const payload = (await response.json()) as AccessSession;
      if (active) setAccessSession(payload);
    }

    void loadAccessSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const standaloneTimer = window.setTimeout(() => {
      setIsStandaloneMode(isPwaStandalone());
    }, 0);

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setInstallPrompt(null);
      setIsStandaloneMode(true);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.clearTimeout(standaloneTimer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function installPwa() {
    if (isStandaloneMode) return;
    if (!installPrompt) {
      window.alert("브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택하세요.");
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
    if (choice?.outcome === "accepted") setIsStandaloneMode(true);
  }

  async function logoutAccess() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/access");
  }

  async function updateTransaction(id: string, patch: Partial<AppTransaction> & { confirmedAccountId?: string }) {
    const confirmedAccount = patch.confirmedAccountId ? accounts.find((account) => account.id === patch.confirmedAccountId) ?? null : undefined;
    setTransactions((current) =>
      current.map((transaction) =>
        transaction.id === id
          ? {
              ...transaction,
              ...patch,
              confirmedAccount: confirmedAccount === undefined ? transaction.confirmedAccount : confirmedAccount
            }
          : transaction
      )
    );

    try {
      await fetch("/api/transactions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch })
      });
      if (mode === "database") void refresh();
    } catch {
      setMode("sample");
    }
  }

  async function updateReviewStatus(id: string, status: ReviewItem["status"]) {
    if (mode === "sample") {
      setReviewStatusOverrides((current) => ({ ...current, [id]: status }));
      return;
    }

    const previous = reviewItems;
    setReviewItems((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
    try {
      const response = await fetch("/api/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status })
      });
      const payload = await response.json();
      if (payload.reviewItem?.reason) {
        setReviewItems((current) => current.map((item) => (item.id === id ? payload.reviewItem : item)));
      } else if (!response.ok) {
        setReviewItems(previous);
      }
    } catch {
      setReviewItems(previous);
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">장</div>
          <div className="brand-title">
            <strong>혼자장부</strong>
            <span>{company.name}</span>
          </div>
        </div>
        <nav className="nav">
          {views.map((view) => {
            const Icon = view.icon;
            return (
              <a
                key={view.key}
                className="nav-button"
                data-active={activeView === view.key}
                href={`/?view=${view.key}`}
                onClick={(event) => {
                  event.preventDefault();
                  window.history.replaceState(null, "", `/?view=${view.key}`);
                  setActiveView(view.key);
                }}
                title={view.label}
              >
                <Icon size={18} />
                <span>{view.label}</span>
              </a>
            );
          })}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1 className="page-title">{getViewTitle(activeView)}</h1>
            <p className="page-subtitle">
              {mode === "database" ? "Railway Postgres 연결됨" : "샘플 데이터 모드"} · {formatNumber(transactions.length)}건
            </p>
          </div>
          <div className="toolbar">
            <button className="icon-button" onClick={() => void refresh()} title="새로고침">
              {loading ? <Loader2 size={18} className="spin" /> : <RefreshCcw size={18} />}
            </button>
            <InstallPwaButton isStandaloneMode={isStandaloneMode} onInstall={installPwa} />
            {accessSession?.enabled && (
              <button className="secondary-button" onClick={() => void logoutAccess()} title="접근 종료">
                <LogOut size={17} />
                접근 종료
              </button>
            )}
            <button className="secondary-button" onClick={() => setActiveView("imports")}>
              <Upload size={17} />
              CSV 업로드
            </button>
          </div>
        </header>

        {activeView === "dashboard" && (
          <Dashboard
            company={company}
            summary={summary}
            reviewItems={openReviewItems}
            transactions={transactions}
            evidences={evidences}
            journalEntries={journalEntries}
            taxReports={taxReports}
            closingPeriods={closingPeriods}
            onMove={setActiveView}
          />
        )}
        {activeView === "imports" && (
          <CsvImportPanel
            companyId={company.id || DEFAULT_COMPANY_ID}
            accounts={accounts}
            importBatches={importBatches}
            csvTemplates={csvTemplates}
            classificationRules={classificationRules}
            onImported={(imported) => {
              setTransactions((current) => mergeTransactions(current, imported));
              setActiveView("transactions");
              if (mode === "database") void refresh();
            }}
            onImportBatch={(importBatch) => {
              setImportBatches((current) => mergeImportBatches(current, importBatch));
            }}
            onCsvTemplateSaved={(csvTemplate) => {
              setCsvTemplates((current) => mergeCsvTemplates(current, csvTemplate));
            }}
            onImportDeleted={(importBatchId) => {
              setImportBatches((current) => current.filter((batch) => batch.id !== importBatchId));
              void refresh();
            }}
          />
        )}
        {activeView === "transactions" && (
          <TransactionsPanel
            transactions={transactions}
            accounts={accounts}
            onCreated={(transaction) => {
              setTransactions((current) => mergeTransactions(current, [transaction]));
              if (mode === "database") void refresh();
            }}
            onUpdate={updateTransaction}
          />
        )}
        {activeView === "evidences" && (
          <EvidencesPanel
            companyId={company.id || DEFAULT_COMPANY_ID}
            evidences={evidences}
            transactions={transactions}
            onCreated={(evidence) => {
              setEvidences((current) => [evidence, ...current]);
              if (evidence.transactionId) {
                setTransactions((current) =>
                  current.map((transaction) =>
                    transaction.id === evidence.transactionId ? { ...transaction, evidenceStatus: "MATCHED" } : transaction
                  )
                );
              }
              if (mode === "database") void refresh();
            }}
            onDeleted={(evidenceId, transactionUpdate) => {
              setEvidences((current) => current.filter((evidence) => evidence.id !== evidenceId));
              if (transactionUpdate) {
                setTransactions((current) =>
                  current.map((transaction) =>
                    transaction.id === transactionUpdate.transactionId ? { ...transaction, evidenceStatus: transactionUpdate.evidenceStatus } : transaction
                  )
                );
              }
              if (mode === "database") void refresh();
            }}
          />
        )}
        {activeView === "journals" && (
          <JournalDraftsPanel
            companyId={company.id || DEFAULT_COMPANY_ID}
            transactions={transactions}
            journalEntries={journalEntries}
            onChanged={(entry) => {
              setJournalEntries((current) => [entry, ...current.filter((item) => item.id !== entry.id && item.transactionId !== entry.transactionId)]);
            }}
          />
        )}
        {activeView === "reviews" && <ReviewsPanel items={visibleReviewItems} onStatusChange={updateReviewStatus} />}
        {activeView === "reports" && (
          <ReportsPanel
            company={company}
            companyId={company.id || DEFAULT_COMPANY_ID}
            transactions={transactions}
            evidences={evidences}
            reviewItems={visibleReviewItems}
            journalEntries={journalEntries}
            taxReports={taxReports}
            closingPeriods={closingPeriods}
            onSaved={(taxReport) => setTaxReports((current) => [taxReport, ...current.filter((item) => item.id !== taxReport.id)])}
            onDeleted={(taxReportId) => setTaxReports((current) => current.filter((item) => item.id !== taxReportId))}
            onClosingPeriodsChanged={setClosingPeriods}
          />
        )}
        {activeView === "settings" && (
          <SettingsPanel
            mode={mode}
            company={company}
            accounts={accounts}
            csvTemplates={csvTemplates}
            importBatches={importBatches}
            transactions={transactions}
            evidences={evidences}
            journalEntries={journalEntries}
            taxReports={taxReports}
            vendors={vendors}
            classificationRules={classificationRules}
            auditEvents={auditEvents}
            closingPeriods={closingPeriods}
            reviewItems={visibleReviewItems}
            onSaved={setCompany}
            onVendorsChanged={setVendors}
            onRulesChanged={setClassificationRules}
            onCsvTemplatesChanged={setCsvTemplates}
            onRestored={refresh}
          />
        )}
      </main>
    </div>
  );
}

function redirectToAccess() {
  window.location.assign(`/access?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
}

function Dashboard({
  company,
  summary,
  reviewItems,
  transactions,
  evidences,
  journalEntries,
  taxReports,
  closingPeriods,
  onMove
}: {
  company: AppCompany;
  summary: ReturnType<typeof summarizeTransactions>;
  reviewItems: ReviewItem[];
  transactions: AppTransaction[];
  evidences: AppEvidence[];
  journalEntries: AppJournalEntry[];
  taxReports: AppTaxReport[];
  closingPeriods: AppClosingPeriod[];
  onMove: (view: ViewKey) => void;
}) {
  const recent = transactions.slice(0, 6);
  const setupItems = buildCompanySetupItems(company);
  const readyCount = setupItems.filter((item) => item.tone !== "red").length;
  const latestPeriod = getLatestTransactionPeriod(transactions);
  const dashboardTransactions = latestPeriod ? filterTransactionsByPeriod(transactions, latestPeriod) : [];
  const dashboardJournalEntries = latestPeriod ? filterJournalEntriesByPeriod(journalEntries, latestPeriod) : [];
  const dashboardApprovedJournalEntries = dashboardJournalEntries.filter((entry) => entry.status === "APPROVED");
  const dashboardLedgerRows = buildLedgerRows(dashboardApprovedJournalEntries);
  const dashboardFinancialStatementRows = buildFinancialStatementRows(dashboardLedgerRows);
  const dashboardFinancialStatementTotals = buildFinancialStatementTotals(dashboardFinancialStatementRows);
  const dashboardCashFlowRows = buildCashFlowRows(dashboardTransactions);
  const dashboardCashFlowTotals = buildCashFlowTotals(dashboardCashFlowRows);
  const dashboardBankBalanceRows = buildBankBalanceCheckRows(dashboardTransactions, dashboardCashFlowTotals);
  const evidenceAmountMismatchCount = countEvidenceAmountMismatchReviews(reviewItems);
  const dashboardReadinessRows = buildFilingReadinessRows({
    setupItems,
    transactions: dashboardTransactions,
    summary: summarizeTransactions(dashboardTransactions),
    dataSourceRows: buildDataSourceRows(dashboardTransactions),
    withholdingRows: buildWithholdingRows(dashboardTransactions),
    journalEntries: dashboardJournalEntries,
    journalIntegrityRows: buildJournalIntegrityRows(dashboardApprovedJournalEntries, dashboardLedgerRows, dashboardFinancialStatementRows, dashboardFinancialStatementTotals),
    ledgerRows: dashboardLedgerRows,
    cashFlowRows: dashboardCashFlowRows,
    bankBalanceRows: dashboardBankBalanceRows,
    isPeriodClosed: Boolean(latestPeriod && closingPeriods.some((period) => period.period === latestPeriod)),
    canClosePeriod: Boolean(latestPeriod)
  });
  const readinessBlockers = dashboardReadinessRows.filter((row) => row.톤 === "red").length;
  const readinessWarnings = dashboardReadinessRows.filter((row) => row.톤 === "amber").length;
  const readinessDone = dashboardReadinessRows.filter((row) => row.톤 === "green").length;
  const readinessPercent = Math.round((readinessDone / Math.max(1, dashboardReadinessRows.length)) * 100);
  const readinessStatus = readinessBlockers > 0 ? "차단" : readinessWarnings > 0 ? "확인 필요" : "준비 가능";
  const actionItems = buildDashboardActionItems({
    company,
    summary,
    setupItems,
    reviewItems,
    transactions,
    evidences,
    journalEntries,
    taxReports,
    closingPeriods
  });
  const onboardingActions = transactions.length === 0 ? buildInitialOnboardingActions(setupItems) : [];
  return (
    <div className="content">
      {onboardingActions.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">초기 장부 시작</h2>
              <p className="panel-subtitle">빈 Postgres 데이터베이스에서 첫 신고 준비까지 이어지는 작업 순서</p>
            </div>
            <span className="status blue">거래 0건</span>
          </div>
          <div className="panel-body">
            <div className="action-list">
              {onboardingActions.map((item) => (
                <DashboardActionItem key={item.title} item={item} onMove={onMove} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="kpi-grid">
        <Kpi label="매출" value={formatKRW(summary.revenue)} foot="공급가액 기준" icon={<ReceiptText size={16} />} />
        <Kpi label="비용" value={formatKRW(summary.expense)} foot="공급가액 추정" icon={<WalletCards size={16} />} />
        <Kpi label="손익" value={formatKRW(summary.profit)} foot={summary.profit >= 0 ? "흑자" : "적자"} icon={<BarChart3 size={16} />} />
        <Kpi label="부가세 예상" value={formatKRW(summary.vatPayable)} foot="양수 납부 · 음수 환급" icon={<FileSpreadsheet size={16} />} />
        <Kpi label="검토" value={`${reviewItems.length}건`} foot={`위험 ${summary.riskCount}건 · 불일치 ${evidenceAmountMismatchCount}건`} icon={<AlertTriangle size={16} />} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">오늘 할 일</h2>
            <p className="panel-subtitle">우선순위가 높은 처리 항목</p>
          </div>
          <button className="ghost-button" onClick={() => onMove(actionItems[0]?.target ?? "reports")}>
            첫 항목 열기
          </button>
        </div>
        <div className="panel-body">
          <div className="action-list">
            {actionItems.map((item) => (
              <DashboardActionItem key={item.title} item={item} onMove={onMove} />
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">최근 월 신고 준비</h2>
            <p className="panel-subtitle">{latestPeriod ? `${formatPeriodLabel(latestPeriod)} 기준` : "거래 업로드 후 월별 점검 생성"}</p>
          </div>
          <button className="ghost-button" onClick={() => onMove("reports")}>리포트</button>
        </div>
        <div className="panel-body setup-grid">
          <div className="setup-score">
            <strong>{readinessPercent}%</strong>
            <span>{readinessStatus}</span>
          </div>
          <div className="review-list">
            {dashboardReadinessRows.map((row) => (
              <ChecklistItem key={row.점검} tone={row.톤} title={`${row.순서}. ${row.점검}`} value={row.상태} />
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">1인법인 신고 준비</h2>
            <p className="panel-subtitle">법인 기본값과 원천세 분기점</p>
          </div>
          <button className="ghost-button" onClick={() => onMove("settings")}>설정</button>
        </div>
        <div className="panel-body setup-grid">
          <div className="setup-score">
            <strong>{readyCount}/{setupItems.length}</strong>
            <span>준비 항목</span>
          </div>
          <div className="setup-list">
            {setupItems.map((item) => (
              <SetupStatusItem key={item.title} item={item} />
            ))}
          </div>
        </div>
      </section>

      <div className="split">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">최근 거래</h2>
            <button className="ghost-button" onClick={() => onMove("transactions")}>전체</button>
          </div>
          <div className="table-wrap">
            <TransactionsTable transactions={recent} compact />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">마감 체크</h2>
            <button className="ghost-button" onClick={() => onMove("reports")}>리포트</button>
          </div>
          <div className="panel-body">
            <div className="review-list">
              <ChecklistItem tone="green" title="월별 손익" value={formatKRW(summary.profit)} />
              <ChecklistItem tone={summary.vatPayable > 0 ? "amber" : "green"} title="부가세 준비" value={formatKRW(summary.vatPayable)} />
              <ChecklistItem tone={summary.missingEvidenceAmount > 0 ? "red" : "green"} title="증빙 누락" value={formatKRW(summary.missingEvidenceAmount)} />
              <ChecklistItem tone={summary.riskCount > 0 ? "amber" : "green"} title="위험 거래" value={`${summary.riskCount}건`} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function CsvImportPanel({
  companyId,
  accounts,
  importBatches,
  csvTemplates,
  classificationRules,
  onImported,
  onImportBatch,
  onCsvTemplateSaved,
  onImportDeleted
}: {
  companyId: string;
  accounts: AppAccount[];
  importBatches: AppImportBatch[];
  csvTemplates: CsvTemplate[];
  classificationRules: AppClassificationRule[];
  onImported: (transactions: AppTransaction[]) => void;
  onImportBatch: (importBatch: AppImportBatch) => void;
  onCsvTemplateSaved: (csvTemplate: CsvTemplate) => void;
  onImportDeleted: (importBatchId: string) => void;
}) {
  const [sourceType, setSourceType] = useState<SourceType>("BANK");
  const [fileName, setFileName] = useState("");
  const [originalFileText, setOriginalFileText] = useState("");
  const [originalFileMeta, setOriginalFileMeta] = useState<{ mimeType: string; size: number } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping>({});
  const [mappingSource, setMappingSource] = useState<MappingSourceState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<PanelMessage | null>(null);
  const canImport = preview && mapping.transactionDate && mapping.description && (mapping.amount || mapping.depositAmount || mapping.withdrawalAmount);
  const importReady = Boolean(canImport);
  const amountMappingLabel =
    mapping.amount ??
    (mapping.depositAmount && mapping.withdrawalAmount
      ? `${mapping.depositAmount} / ${mapping.withdrawalAmount}`
      : mapping.depositAmount ?? mapping.withdrawalAmount ?? "");
  const sourceTemplateCount = csvTemplates.filter((template) => template.sourceType === sourceType).length;
  const mappingSourceStatus = getMappingSourceStatus(mappingSource, preview, sourceTemplateCount);
  const mappingStatusItems = [
    {
      title: "CSV 파일",
      value: preview ? `${formatNumber(preview.rows.length)}행` : "미선택",
      tone: preview ? "green" : "red"
    },
    {
      title: "거래일",
      value: mapping.transactionDate || "필요",
      tone: mapping.transactionDate ? "green" : "red"
    },
    {
      title: "내용",
      value: mapping.description || "필요",
      tone: mapping.description ? "green" : "red"
    },
    {
      title: "금액",
      value: amountMappingLabel || "필요",
      tone: amountMappingLabel ? "green" : "red"
    },
    {
      title: "템플릿",
      value: mappingSourceStatus.value,
      tone: mappingSourceStatus.tone
    }
  ] satisfies Array<{ title: string; value: string; tone: StatusTone }>;

  function applyMappingForHeaders(nextSourceType: SourceType, headers: string[]) {
    const savedMapping = getSavedMapping(nextSourceType, headers, csvTemplates);
    if (savedMapping) {
      setMapping(savedMapping.mapping);
      setMappingSource(savedMapping.source);
      return;
    }

    setMapping(inferMapping(headers, nextSourceType));
    setMappingSource({ type: "inferred", label: "자동 추론" });
  }

  function changeSourceType(nextSourceType: SourceType) {
    setSourceType(nextSourceType);
    setImportMessage(null);
    if (preview) applyMappingForHeaders(nextSourceType, preview.headers);
  }

  async function parseFile(file: File) {
    setFileName(file.name);
    setOriginalFileText("");
    setOriginalFileMeta(null);
    setPreview(null);
    setImportMessage(null);
    if (file.size > MAX_IMPORT_ORIGINAL_FILE_SIZE) {
      setImportMessage({
        tone: "red",
        text: `원본 CSV 보관을 위해 ${formatFileSize(MAX_IMPORT_ORIGINAL_FILE_SIZE)} 이하 파일만 업로드할 수 있습니다.`
      });
      return;
    }

    const text = await file.text();
    if (text.length > MAX_IMPORT_ORIGINAL_FILE_SIZE) {
      setImportMessage({
        tone: "red",
        text: `원본 CSV 텍스트가 ${formatFileSize(MAX_IMPORT_ORIGINAL_FILE_SIZE)}를 초과합니다.`
      });
      return;
    }

    setOriginalFileText(text);
    setOriginalFileMeta({ mimeType: file.type || "text/csv", size: file.size });
    Papa.parse<ParsedCsvRow>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: (result) => {
        const headers = result.meta.fields?.filter(Boolean) ?? [];
        const rows = result.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
        setPreview({ headers, rows: rows.slice(0, 2000) });
        applyMappingForHeaders(sourceType, headers);
      }
    });
  }

  async function submitImport() {
    if (!preview || !canImport) return;
    setSaving(true);
    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          sourceType,
          originalFileName: fileName,
          originalFileText,
          originalFileMimeType: originalFileMeta?.mimeType ?? "text/csv",
          originalFileSize: originalFileMeta?.size ?? originalFileText.length,
          mapping,
          headers: preview.headers,
          rows: preview.rows
        })
      });
      const payload = await response.json();
      if (payload.transactions?.length) {
        saveLocalMapping(sourceType, preview.headers, mapping);
        if (payload.importBatch) onImportBatch(payload.importBatch);
        if (payload.csvTemplate) {
          onCsvTemplateSaved(payload.csvTemplate);
          setMappingSource({ type: "database", label: `${payload.csvTemplate.name} 저장` });
        }
        setImportMessage({
          tone: payload.duplicate ? "amber" : "green",
          text: payload.duplicate ? "이미 가져온 파일입니다. 기존 거래를 다시 불러왔습니다." : `${formatNumber(payload.transactions.length)}건을 가져왔습니다.`
        });
        onImported(payload.transactions);
      } else if (!response.ok) {
        setImportMessage(toImportErrorMessage(payload));
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteImportBatch(batch: AppImportBatch) {
    const confirmed = window.confirm(`${batch.originalFileName} 업로드와 연결 거래를 삭제할까요? 승인된 분개가 있으면 삭제되지 않습니다.`);
    if (!confirmed) return;

    setDeletingBatchId(batch.id);
    try {
      const response = await fetch("/api/imports", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, importBatchId: batch.id })
      });
      const payload = await response.json();
      if (response.ok) {
        setImportMessage({
          tone: "green",
          text: `${formatNumber(payload.deletedTransactions ?? 0)}건의 거래를 삭제했습니다.`
        });
        onImportDeleted(batch.id);
      } else {
        setImportMessage({
          tone: "red",
          text: payload.message ?? "업로드 삭제에 실패했습니다."
        });
      }
    } finally {
      setDeletingBatchId(null);
    }
  }

  async function downloadImportBatchSource(batch: AppImportBatch) {
    try {
      const response = await fetch(`/api/imports?importBatchId=${encodeURIComponent(batch.id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.originalFileText) {
        setImportMessage({ tone: "red", text: payload.message ?? "원본 CSV를 찾을 수 없습니다." });
        return;
      }

      downloadBlob(
        payload.originalFileName ?? batch.originalFileName,
        new Blob([payload.originalFileText], { type: payload.originalFileMimeType ?? "text/csv;charset=utf-8" })
      );
    } catch {
      setImportMessage({ tone: "red", text: "원본 CSV 다운로드에 실패했습니다." });
    }
  }

  const previewRows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.slice(0, 5).map((row, index) => ({
      id: `row-${index}`,
      ...applyClassificationRules(normalizeCsvRow(row, mapping, sourceType, index), classificationRules, accounts)
    }));
  }, [accounts, classificationRules, mapping, preview, sourceType]);

  return (
    <div className="content">
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">CSV 업로드</h2>
          <div className="toolbar">
            <select value={sourceType} onChange={(event) => changeSourceType(event.target.value as SourceType)} className="secondary-button">
              {sourceOptions.map((option) => (
                <option key={option} value={option}>
                  {SOURCE_TYPE_LABELS[option]}
                </option>
              ))}
            </select>
            <a className="secondary-button" href={sampleCsvLinks[sourceType].href} download>
              <Download size={16} />
              {sampleCsvLinks[sourceType].label}
            </a>
            <button className="primary-button" disabled={!importReady || saving} onClick={() => void submitImport()}>
              {saving ? <Loader2 size={17} /> : <CheckCircle2 size={17} />}
              가져오기
            </button>
          </div>
        </div>
        <div className="panel-body split">
          <div>
            {importMessage && <PanelMessageView message={importMessage} />}
            <label className="file-drop">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void parseFile(file);
                }}
              />
              <span>
                <FileSpreadsheet size={28} />
                <strong>{fileName || "CSV 파일 선택"}</strong>
                <span>
                  {preview
                    ? `${formatNumber(preview.rows.length)}행 · ${formatNumber(preview.headers.length)}개 컬럼 · 원본 ${formatFileSize(originalFileMeta?.size ?? originalFileText.length)} 보관`
                    : `통장, 카드, 홈택스, PG · 원본 ${formatFileSize(MAX_IMPORT_ORIGINAL_FILE_SIZE)} 이하 보관`}
                </span>
              </span>
            </label>

            <div className="sample-links">
              {sourceOptions.map((option) => (
                <a key={option} href={sampleCsvLinks[option].href} download>
                  {SOURCE_TYPE_LABELS[option]}
                </a>
              ))}
            </div>

            {previewRows.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <TransactionsTable transactions={previewRows} compact />
              </div>
            )}
          </div>

          <div className="mapping-grid">
            <div className="import-readiness field-wide">
              <div className="review-row">
                <strong>가져오기 조건</strong>
                <span className={`status ${importReady ? "green" : "red"}`}>{importReady ? "가능" : "확인 필요"}</span>
              </div>
              <div className="review-list">
                {mappingStatusItems.map((item) => (
                  <ChecklistItem key={item.title} tone={item.tone} title={item.title} value={item.value} />
                ))}
              </div>
            </div>
            {mappingFields.map((field) => (
              <div className="field" key={field.key}>
                <label>{field.label}</label>
                <select
                  value={mapping[field.key] ?? ""}
                  onChange={(event) => {
                    setMapping((current) => ({ ...current, [field.key]: event.target.value || undefined }));
                    if (preview) setMappingSource({ type: "edited", label: "직접 수정" });
                  }}
                >
                  <option value="">선택 안 함</option>
                  {preview?.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CsvGuidePanel />

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">최근 업로드</h2>
          <span className="status blue">{formatNumber(importBatches.length)}개</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>가져온 시간</th>
                <th>자료 유형</th>
                <th>파일</th>
                <th className="amount">행</th>
                <th>해시</th>
                <th>원본</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {importBatches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">아직 업로드한 CSV가 없습니다.</td>
                </tr>
              ) : (
                importBatches.map((batch) => (
                  <tr key={batch.id}>
                    <td>{formatDateTime(batch.importedAt)}</td>
                    <td>{SOURCE_TYPE_LABELS[batch.sourceType]}</td>
                    <td>{batch.originalFileName}</td>
                    <td className="amount">{formatNumber(batch.rowCount)}</td>
                    <td>{batch.originalFileHash ? batch.originalFileHash.slice(0, 12) : "-"}</td>
                    <td>
                      {batch.hasOriginalFile ? (
                        <button className="ghost-button" onClick={() => void downloadImportBatchSource(batch)}>
                          원본
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <button className="ghost-button" onClick={() => void deleteImportBatch(batch)} disabled={deletingBatchId === batch.id}>
                        {deletingBatchId === batch.id ? "삭제 중" : "삭제"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PanelMessageView({ message }: { message: PanelMessage }) {
  return (
    <div className={`panel-message ${message.tone}`}>
      <strong>{message.text}</strong>
      {message.details?.length ? (
        <ul>
          {message.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function toImportErrorMessage(payload: unknown): PanelMessage {
  const fallback = "가져오기에 실패했습니다. CSV 매핑과 행 데이터를 확인해 주세요.";
  if (!isRecord(payload)) return { tone: "red", text: fallback };

  const message = typeof payload.message === "string" && payload.message.trim() ? payload.message : fallback;
  const issueDetails = Array.isArray(payload.issues)
    ? payload.issues
        .filter((issue): issue is string => typeof issue === "string" && issue.trim().length > 0)
    : [];
  const details =
    issueDetails.length > 8
      ? [...issueDetails.slice(0, 8), `외 ${formatNumber(issueDetails.length - 8)}개 오류가 더 있습니다.`]
      : issueDetails;

  return {
    tone: "red",
    text: message,
    details: details.length > 0 ? details : undefined
  };
}

function CsvGuidePanel() {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">자료별 준비 기준</h2>
          <p className="panel-subtitle">컬럼명은 달라도 업로드 후 매핑할 수 있습니다. 실제 파일의 컬럼 구조는 유지합니다.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="guide-table">
          <thead>
            <tr>
              <th>자료</th>
              <th>받을 곳</th>
              <th>필수 컬럼</th>
              <th>있으면 좋은 컬럼</th>
              <th>마스킹 가능</th>
              <th>샘플</th>
            </tr>
          </thead>
          <tbody>
            {sourceOptions.map((sourceType) => {
              const guide = csvPreparationGuides[sourceType];
              return (
                <tr key={sourceType}>
                  <td>{SOURCE_TYPE_LABELS[sourceType]}</td>
                  <td>{guide.source}</td>
                  <td>{guide.required.join(", ")}</td>
                  <td>{guide.optional.join(", ")}</td>
                  <td>{guide.masking}</td>
                  <td>
                    <a className="ghost-button" href={sampleCsvLinks[sourceType].href} download>
                      샘플
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TransactionsPanel({
  transactions,
  accounts,
  onCreated,
  onUpdate
}: {
  transactions: AppTransaction[];
  accounts: AppAccount[];
  onCreated: (transaction: AppTransaction) => void;
  onUpdate: (id: string, patch: Partial<AppTransaction> & { confirmedAccountId?: string }) => void;
}) {
  const [form, setForm] = useState({
    transactionDate: new Date().toISOString().slice(0, 10),
    description: "",
    counterparty: "",
    depositAmount: "",
    withdrawalAmount: "",
    confirmedAccountId: "",
    evidenceStatus: "UNCHECKED" as EvidenceStatus,
    memo: ""
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  function updateForm(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function createManualTransaction() {
    if (!form.description.trim()) return;
    const depositAmount = Number(form.depositAmount || 0);
    const withdrawalAmount = Number(form.withdrawalAmount || 0);
    if (!Number.isFinite(depositAmount) || !Number.isFinite(withdrawalAmount)) {
      setMessage({ tone: "red", text: "금액은 숫자로 입력해야 합니다." });
      return;
    }
    if (depositAmount <= 0 && withdrawalAmount <= 0) {
      setMessage({ tone: "red", text: "입금 또는 출금 금액을 입력해야 합니다." });
      return;
    }
    if (depositAmount > 0 && withdrawalAmount > 0) {
      setMessage({ tone: "red", text: "입금과 출금 중 하나만 입력해야 합니다." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionDate: form.transactionDate,
          description: form.description.trim(),
          counterparty: form.counterparty.trim() || null,
          depositAmount,
          withdrawalAmount,
          confirmedAccountId: form.confirmedAccountId || null,
          evidenceStatus: form.evidenceStatus,
          memo: form.memo.trim() || null
        })
      });
      const payload = await response.json();
      if (payload.transaction) {
        onCreated(payload.transaction);
        setMessage({ tone: "green", text: "수기 거래를 추가했습니다." });
        setForm((current) => ({
          ...current,
          description: "",
          counterparty: "",
          depositAmount: "",
          withdrawalAmount: "",
          memo: ""
        }));
      } else {
        setMessage({ tone: "red", text: payload.message ?? "수기 거래 추가에 실패했습니다." });
      }
    } catch {
      setMessage({ tone: "red", text: "수기 거래 추가 중 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="content">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">수기 거래</h2>
            <p className="panel-subtitle">CSV에 없는 대표자 입출금, 현금 거래, 조정분 입력</p>
          </div>
          <button className="primary-button" onClick={() => void createManualTransaction()} disabled={saving || !form.description.trim()}>
            {saving ? <Loader2 size={17} className="spin" /> : <CheckCircle2 size={17} />}
            추가
          </button>
        </div>
        <div className="panel-body form-grid">
          {message && <div className={`import-message status ${message.tone} field-wide`}>{message.text}</div>}
          <div className="field">
            <label>거래일</label>
            <input type="date" value={form.transactionDate} onChange={(event) => updateForm("transactionDate", event.target.value)} />
          </div>
          <div className="field">
            <label>내용</label>
            <input value={form.description} onChange={(event) => updateForm("description", event.target.value)} placeholder="예: 대표자 입금" />
          </div>
          <div className="field">
            <label>거래처</label>
            <input value={form.counterparty} onChange={(event) => updateForm("counterparty", event.target.value)} />
          </div>
          <div className="field">
            <label>계정과목</label>
            <select value={form.confirmedAccountId} onChange={(event) => updateForm("confirmedAccountId", event.target.value)}>
              <option value="">자동 추론</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>입금</label>
            <input type="number" min="0" step="1" inputMode="numeric" value={form.depositAmount} onChange={(event) => updateForm("depositAmount", event.target.value)} />
          </div>
          <div className="field">
            <label>출금</label>
            <input type="number" min="0" step="1" inputMode="numeric" value={form.withdrawalAmount} onChange={(event) => updateForm("withdrawalAmount", event.target.value)} />
          </div>
          <div className="field">
            <label>증빙</label>
            <select value={form.evidenceStatus} onChange={(event) => updateForm("evidenceStatus", event.target.value as EvidenceStatus)}>
              <option value="UNCHECKED">미확인</option>
              <option value="MISSING">누락</option>
              <option value="ATTACHED">첨부</option>
              <option value="MATCHED">매칭</option>
              <option value="NOT_REQUIRED">불필요</option>
            </select>
          </div>
          <div className="field">
            <label>메모</label>
            <input value={form.memo} onChange={(event) => updateForm("memo", event.target.value)} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">거래내역</h2>
          <span className="status blue">{formatNumber(transactions.length)}건</span>
        </div>
        <div className="table-wrap">
          <table>
          <thead>
            <tr>
              <th>일자</th>
              <th>출처</th>
              <th>내용</th>
              <th>계정과목</th>
              <th>증빙</th>
              <th className="amount">입금</th>
              <th className="amount">출금</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-cell">아직 거래가 없습니다. 법인 통장 CSV를 업로드하거나 수기 거래를 추가하세요.</td>
              </tr>
            ) : (
              transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDate(transaction.transactionDate)}</td>
                  <td>{SOURCE_TYPE_LABELS[transaction.sourceType]}</td>
                  <td>
                    <strong>{transaction.description}</strong>
                    {transaction.counterparty && <div className="muted">{transaction.counterparty}</div>}
                  </td>
                  <td>
                    <select
                      value={transaction.confirmedAccount?.id ?? transaction.suggestedAccount?.id ?? ""}
                      onChange={(event) => onUpdate(transaction.id, { confirmedAccountId: event.target.value })}
                    >
                      <option value="">미분류</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code} {account.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={transaction.evidenceStatus}
                      onChange={(event) => onUpdate(transaction.id, { evidenceStatus: event.target.value as EvidenceStatus })}
                    >
                      <option value="UNCHECKED">미확인</option>
                      <option value="MISSING">누락</option>
                      <option value="ATTACHED">첨부</option>
                      <option value="MATCHED">매칭</option>
                      <option value="NOT_REQUIRED">불필요</option>
                    </select>
                  </td>
                  <td className="amount">{transaction.depositAmount ? formatKRW(transaction.depositAmount) : "-"}</td>
                  <td className="amount">{transaction.withdrawalAmount ? formatKRW(transaction.withdrawalAmount) : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EvidencesPanel({
  companyId,
  evidences,
  transactions,
  onCreated,
  onDeleted
}: {
  companyId: string;
  evidences: AppEvidence[];
  transactions: AppTransaction[];
  onCreated: (evidence: AppEvidence) => void;
  onDeleted: (evidenceId: string, transactionUpdate?: { transactionId: string; evidenceStatus: EvidenceStatus } | null) => void;
}) {
  const [form, setForm] = useState<EvidenceFormState>({
    evidenceType: "전자세금계산서",
    issueDate: new Date().toISOString().slice(0, 10),
    counterparty: "",
    businessRegistrationNumber: "",
    supplyAmount: "",
    vatAmount: "",
    totalAmount: "",
    fileName: "",
    fileDataUrl: "",
    fileMimeType: "",
    fileSize: "",
    transactionId: ""
  });
  const [saving, setSaving] = useState(false);
  const [deletingEvidenceId, setDeletingEvidenceId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const matchCandidates = useMemo(() => buildEvidenceMatchCandidates(form, transactions), [form, transactions]);

  function updateField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleEvidenceFile(file?: File | null) {
    if (!file) return;
    if (file.size > MAX_EVIDENCE_FILE_SIZE) {
      setFileError(`파일은 ${formatFileSize(MAX_EVIDENCE_FILE_SIZE)} 이하만 DB에 보관할 수 있습니다.`);
      return;
    }

    setFileError(null);
    const dataUrl = await readFileAsDataUrl(file);
    setForm((current) => ({
      ...current,
      fileName: file.name,
      fileDataUrl: dataUrl,
      fileMimeType: file.type || "application/octet-stream",
      fileSize: String(file.size)
    }));
  }

  async function createEvidence() {
    setSaving(true);
    try {
      const response = await fetch("/api/evidences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          evidenceType: form.evidenceType,
          issueDate: form.issueDate,
          counterparty: form.counterparty || null,
          businessRegistrationNumber: form.businessRegistrationNumber || null,
          supplyAmount: form.supplyAmount ? Number(form.supplyAmount) : null,
          vatAmount: form.vatAmount ? Number(form.vatAmount) : null,
          totalAmount: form.totalAmount ? Number(form.totalAmount) : null,
          fileName: form.fileName || null,
          fileDataUrl: form.fileDataUrl || null,
          fileMimeType: form.fileMimeType || null,
          fileSize: form.fileSize ? Number(form.fileSize) : null,
          transactionId: form.transactionId || null
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setFileError(payload.message ?? "증빙 저장에 실패했습니다.");
        return;
      }
      if (payload.evidence) {
        onCreated(payload.evidence);
        setForm((current) => ({
          ...current,
          counterparty: "",
          businessRegistrationNumber: "",
          supplyAmount: "",
          vatAmount: "",
          totalAmount: "",
          fileName: "",
          fileDataUrl: "",
          fileMimeType: "",
          fileSize: "",
          transactionId: ""
        }));
        setFileError(null);
      } else {
        setFileError("증빙 저장 결과를 확인할 수 없습니다.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvidence(evidence: AppEvidence) {
    const label = evidence.counterparty || evidence.fileName || evidence.evidenceType;
    if (!window.confirm(`${label} 증빙을 삭제할까요? 연결된 거래는 증빙 상태가 다시 확인 필요로 바뀔 수 있습니다.`)) return;

    setDeletingEvidenceId(evidence.id);
    try {
      const response = await fetch("/api/evidences", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: evidence.id })
      });
      const payload = await response.json();
      if (!response.ok) {
        window.alert(payload.message ?? "증빙 삭제에 실패했습니다.");
        return;
      }

      onDeleted(
        payload.deletedEvidenceId ?? evidence.id,
        payload.transactionId && payload.evidenceStatus
          ? { transactionId: payload.transactionId, evidenceStatus: payload.evidenceStatus as EvidenceStatus }
          : null
      );
    } finally {
      setDeletingEvidenceId(null);
    }
  }

  return (
    <div className="content">
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">증빙 추가</h2>
          <button className="primary-button" onClick={() => void createEvidence()} disabled={saving}>
            {saving ? <Loader2 size={17} className="spin" /> : <CheckCircle2 size={17} />}
            저장
          </button>
        </div>
        <div className="panel-body form-grid">
          <div className="field">
            <label>증빙 유형</label>
            <select value={form.evidenceType} onChange={(event) => updateField("evidenceType", event.target.value)}>
              <option value="전자세금계산서">전자세금계산서</option>
              <option value="계산서">계산서</option>
              <option value="카드전표">카드전표</option>
              <option value="현금영수증">현금영수증</option>
              <option value="인보이스">인보이스</option>
              <option value="기타영수증">기타영수증</option>
            </select>
          </div>
          <div className="field">
            <label>발행일</label>
            <input type="date" value={form.issueDate} onChange={(event) => updateField("issueDate", event.target.value)} />
          </div>
          <div className="field">
            <label>거래처</label>
            <input value={form.counterparty} onChange={(event) => updateField("counterparty", event.target.value)} />
          </div>
          <div className="field">
            <label>사업자등록번호</label>
            <input value={form.businessRegistrationNumber} onChange={(event) => updateField("businessRegistrationNumber", event.target.value)} />
          </div>
          <div className="field">
            <label>공급가액</label>
            <input inputMode="numeric" value={form.supplyAmount} onChange={(event) => updateField("supplyAmount", event.target.value)} />
          </div>
          <div className="field">
            <label>부가세</label>
            <input inputMode="numeric" value={form.vatAmount} onChange={(event) => updateField("vatAmount", event.target.value)} />
          </div>
          <div className="field">
            <label>합계</label>
            <input inputMode="numeric" value={form.totalAmount} onChange={(event) => updateField("totalAmount", event.target.value)} />
          </div>
          <div className="field">
            <label>거래 매칭</label>
            <select value={form.transactionId} onChange={(event) => updateField("transactionId", event.target.value)}>
              <option value="">매칭 안 함</option>
              {transactions.map((transaction) => (
                <option key={transaction.id} value={transaction.id}>
                  {transaction.transactionDate} · {transaction.description} · {formatKRW(transaction.depositAmount || transaction.withdrawalAmount)}
                </option>
              ))}
            </select>
          </div>
          <div className="field field-wide">
            <label>추천 매칭</label>
            <div className="match-suggestions">
              {matchCandidates.length === 0 ? (
                <span className="muted">거래처, 발행일, 합계를 입력하면 후보가 표시됩니다.</span>
              ) : (
                matchCandidates.map((candidate) => (
                  <button
                    key={candidate.transaction.id}
                    type="button"
                    className="match-suggestion"
                    data-selected={form.transactionId === candidate.transaction.id}
                    onClick={() => updateField("transactionId", candidate.transaction.id)}
                  >
                    <span>
                      <strong>{candidate.transaction.description}</strong>
                      <small>
                        {formatDate(candidate.transaction.transactionDate)} · {candidate.transaction.counterparty ?? "거래처 없음"} ·{" "}
                        {formatKRW(candidate.transaction.depositAmount || candidate.transaction.withdrawalAmount)}
                      </small>
                    </span>
                    <span className={`status ${candidate.tone}`}>{candidate.reason}</span>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="field">
            <label>파일명</label>
            <input value={form.fileName} onChange={(event) => updateField("fileName", event.target.value)} placeholder="invoice.pdf" />
          </div>
          <label className="file-drop">
            <input
              type="file"
              onChange={(event) => void handleEvidenceFile(event.target.files?.[0])}
            />
            <span>
              <FileCheck2 size={28} />
              <strong>{form.fileName || "증빙 파일 선택"}</strong>
              <span>{form.fileSize ? `${formatFileSize(Number(form.fileSize))} DB 보관 준비` : `${formatFileSize(MAX_EVIDENCE_FILE_SIZE)} 이하 파일은 DB에 보관합니다`}</span>
            </span>
          </label>
          {fileError && <p className="field-help">{fileError}</p>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">증빙 목록</h2>
          <span className="status blue">{formatNumber(evidences.length)}건</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>발행일</th>
                <th>유형</th>
                <th>거래처</th>
                <th>매칭 거래</th>
                <th className="amount">공급가액</th>
                <th className="amount">부가세</th>
                <th className="amount">합계</th>
                <th>파일</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {evidences.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-cell">아직 등록된 증빙이 없습니다.</td>
                </tr>
              ) : (
                evidences.map((evidence) => (
                  <tr key={evidence.id}>
                    <td>{evidence.issueDate ? formatDate(evidence.issueDate) : "-"}</td>
                    <td>{evidence.evidenceType}</td>
                    <td>{evidence.counterparty ?? "-"}</td>
                    <td>{evidence.transaction?.description ?? "-"}</td>
                    <td className="amount">{evidence.supplyAmount ? formatKRW(evidence.supplyAmount) : "-"}</td>
                    <td className="amount">{evidence.vatAmount ? formatKRW(evidence.vatAmount) : "-"}</td>
                    <td className="amount">{evidence.totalAmount ? formatKRW(evidence.totalAmount) : "-"}</td>
                    <td>
                      {evidence.fileDataUrl ? (
                        <button className="ghost-button" onClick={() => downloadDataUrl(evidence.fileName ?? "evidence", evidence.fileDataUrl ?? "")}>다운로드</button>
                      ) : (
                        evidence.fileName ?? "-"
                      )}
                    </td>
                    <td>
                      <button className="ghost-button" onClick={() => void deleteEvidence(evidence)} disabled={deletingEvidenceId === evidence.id}>
                        {deletingEvidenceId === evidence.id ? "삭제 중" : "삭제"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function JournalDraftsPanel({
  companyId,
  transactions,
  journalEntries,
  onChanged
}: {
  companyId: string;
  transactions: AppTransaction[];
  journalEntries: AppJournalEntry[];
  onChanged: (entry: AppJournalEntry) => void;
}) {
  const drafts = transactions.map(generateJournalDraft);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [draftFilter, setDraftFilter] = useState<JournalDraftFilter>("ALL");
  const approvedTransactionIds = new Set(journalEntries.filter((entry) => entry.status === "APPROVED").map((entry) => entry.transactionId).filter(Boolean));
  const approvedDrafts = drafts.filter((draft) => approvedTransactionIds.has(draft.transactionId));
  const pendingDrafts = drafts.filter((draft) => !approvedTransactionIds.has(draft.transactionId));
  const readyDrafts = pendingDrafts.filter((draft) => isBalancedJournalDraft(draft) && draft.warnings.length === 0);
  const reviewDrafts = pendingDrafts.filter((draft) => !isBalancedJournalDraft(draft) || draft.warnings.length > 0);
  const visibleDrafts =
    draftFilter === "READY" ? readyDrafts : draftFilter === "REVIEW" ? reviewDrafts : draftFilter === "APPROVED" ? approvedDrafts : drafts;
  const draftFilterOptions: Array<{ key: JournalDraftFilter; label: string; count: number }> = [
    { key: "ALL", label: "전체", count: drafts.length },
    { key: "READY", label: "바로 승인", count: readyDrafts.length },
    { key: "REVIEW", label: "검토 필요", count: reviewDrafts.length },
    { key: "APPROVED", label: "승인됨", count: approvedDrafts.length }
  ];

  async function saveDraft(draft: JournalDraft) {
    const response = await fetch("/api/journals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        transactionId: draft.transactionId,
        entryDate: draft.entryDate,
        memo: draft.memo,
        status: "APPROVED",
        lines: draft.lines
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.journalEntry?.lines) {
      window.alert(payload.message ?? "분개 승인에 실패했습니다.");
      return null;
    }
    return payload.journalEntry as AppJournalEntry;
  }

  async function approveDraft(draft: JournalDraft) {
    setSavingId(draft.transactionId);
    try {
      const entry = await saveDraft(draft);
      if (entry) onChanged(entry);
    } finally {
      setSavingId(null);
    }
  }

  async function voidApprovedDraft(draft: JournalDraft) {
    const approvedEntry = journalEntries.find((entry) => entry.transactionId === draft.transactionId && entry.status === "APPROVED");
    if (!approvedEntry) return;

    setSavingId(draft.transactionId);
    try {
      const response = await fetch("/api/journals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: approvedEntry.id, status: "VOID" })
      });
      const payload = await response.json();
      if (!response.ok || !payload.journalEntry?.lines) {
        window.alert(payload.message ?? "분개 승인 취소에 실패했습니다.");
        return;
      }
      onChanged(payload.journalEntry);
    } finally {
      setSavingId(null);
    }
  }

  async function approveReadyDrafts() {
    setBulkSaving(true);
    try {
      for (const draft of readyDrafts) {
        setSavingId(draft.transactionId);
        const entry = await saveDraft(draft);
        if (!entry) break;
        onChanged(entry);
      }
    } finally {
      setSavingId(null);
      setBulkSaving(false);
    }
  }

  return (
    <div className="content">
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">자동분개 초안</h2>
          <div className="toolbar">
            <span className="status blue">{formatNumber(drafts.length)}건</span>
            <span className="status green">{formatNumber(drafts.length - pendingDrafts.length)}건 승인</span>
            {reviewDrafts.length > 0 && <span className="status amber">{formatNumber(reviewDrafts.length)}건 검토</span>}
            <button className="secondary-button" disabled={bulkSaving || readyDrafts.length === 0} onClick={() => void approveReadyDrafts()}>
              {bulkSaving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
              정상 초안 {formatNumber(readyDrafts.length)}건 승인
            </button>
          </div>
        </div>
        <div className="panel-body review-list">
          <div className="journal-summary-grid">
            <button type="button" className="journal-summary-card" data-tone="green" data-active={draftFilter === "READY"} onClick={() => setDraftFilter("READY")}>
              <span>바로 승인</span>
              <strong>{formatNumber(readyDrafts.length)}건</strong>
              <small>균형 완료 · 경고 없음</small>
            </button>
            <button type="button" className="journal-summary-card" data-tone="amber" data-active={draftFilter === "REVIEW"} onClick={() => setDraftFilter("REVIEW")}>
              <span>검토 필요</span>
              <strong>{formatNumber(reviewDrafts.length)}건</strong>
              <small>계정·증빙·균형 확인</small>
            </button>
            <button type="button" className="journal-summary-card" data-tone="blue" data-active={draftFilter === "APPROVED"} onClick={() => setDraftFilter("APPROVED")}>
              <span>승인 완료</span>
              <strong>{formatNumber(approvedDrafts.length)}건</strong>
              <small>원장 반영 대상</small>
            </button>
          </div>
          <div className="toolbar journal-filter-toolbar" aria-label="자동분개 필터">
            {draftFilterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className="secondary-button"
                data-active={draftFilter === option.key}
                onClick={() => setDraftFilter(option.key)}
              >
                {option.label} {formatNumber(option.count)}
              </button>
            ))}
          </div>
          {visibleDrafts.length === 0 ? (
            <div className="empty">조건에 맞는 자동분개 초안 없음</div>
          ) : visibleDrafts.map((draft) => {
            const isApproved = approvedTransactionIds.has(draft.transactionId);
            const isBalanced = isBalancedJournalDraft(draft);
            const needsReview = !isBalanced || draft.warnings.length > 0;
            return (
            <article key={draft.transactionId} className="journal-card">
              <div className="review-row">
                <div>
                  <strong>{draft.memo}</strong>
                  <div className="muted">{draft.entryDate} · 차변 {formatKRW(draft.lines.reduce((sum, line) => sum + line.debitAmount, 0))} · 대변 {formatKRW(draft.lines.reduce((sum, line) => sum + line.creditAmount, 0))}</div>
                </div>
                <div className="toolbar">
                  {isApproved && <span className="status green">승인됨</span>}
                  <span className={needsReview ? "status amber" : "status green"}>{needsReview ? "검토 필요" : "균형"}</span>
                  {isApproved ? (
                    <button className="secondary-button" disabled={bulkSaving || savingId === draft.transactionId} onClick={() => void voidApprovedDraft(draft)}>
                      {savingId === draft.transactionId ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
                      승인 취소
                    </button>
                  ) : (
                    <button
                      className="secondary-button"
                      disabled={bulkSaving || savingId === draft.transactionId || !isBalanced}
                      onClick={() => void approveDraft(draft)}
                    >
                      {savingId === draft.transactionId ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                      승인 저장
                    </button>
                  )}
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>계정</th>
                      <th className="amount">차변</th>
                      <th className="amount">대변</th>
                      <th>메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines.map((line, index) => (
                      <tr key={`${draft.transactionId}-${line.accountCode}-${index}`}>
                        <td>
                          {line.accountCode} {line.accountName}
                        </td>
                        <td className="amount">{line.debitAmount ? formatKRW(line.debitAmount) : "-"}</td>
                        <td className="amount">{line.creditAmount ? formatKRW(line.creditAmount) : "-"}</td>
                        <td>{line.memo ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {draft.warnings.length > 0 && (
                <div className="journal-warnings">
                  {draft.warnings.map((warning) => (
                    <span key={warning} className="status amber">{warning}</span>
                  ))}
                </div>
              )}
            </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function isBalancedJournalDraft(draft: JournalDraft) {
  const debit = draft.lines.reduce((sum, line) => sum + line.debitAmount, 0);
  const credit = draft.lines.reduce((sum, line) => sum + line.creditAmount, 0);
  return draft.lines.length > 0 && Math.round(debit) === Math.round(credit);
}

function ReviewsPanel({
  items,
  onStatusChange
}: {
  items: ReviewItem[];
  onStatusChange: (id: string, status: ReviewItem["status"]) => void;
}) {
  const openCount = items.filter((item) => item.status === "OPEN").length;
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">검토함</h2>
        <span className={openCount > 0 ? "status amber" : "status green"}>{formatNumber(openCount)}건 열림</span>
      </div>
      <div className="panel-body">
        {items.length === 0 ? (
          <div className="empty">열린 검토 항목 없음</div>
        ) : (
          <div className="review-list">
            {items.map((item) => (
              <article key={item.id} className="review-item" data-severity={item.severity}>
                <div className="review-row">
                  <strong>{item.reason}</strong>
                  <div className="toolbar">
                    <span className={item.severity === "DANGER" ? "status red" : item.severity === "WARNING" ? "status amber" : "status blue"}>
                      {item.severity === "DANGER" ? "위험" : item.severity === "WARNING" ? "주의" : "확인"}
                    </span>
                    <span className={`status ${reviewStatusTone(item.status)}`}>{reviewStatusLabel(item.status)}</span>
                  </div>
                </div>
                <div className="muted">
                  {item.transaction ? `${formatDate(item.transaction.transactionDate)} · ${item.transaction.description}` : "거래 없음"}
                </div>
                {item.recommendation && <div className="muted">{item.recommendation}</div>}
                <div className="toolbar">
                  {item.status === "OPEN" ? (
                    <>
                      <button className="ghost-button" onClick={() => onStatusChange(item.id, "RESOLVED")}>처리 완료</button>
                      <button className="ghost-button" onClick={() => onStatusChange(item.id, "IGNORED")}>무시</button>
                    </>
                  ) : (
                    <button className="ghost-button" onClick={() => onStatusChange(item.id, "OPEN")}>다시 열기</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function reviewStatusLabel(status: ReviewItem["status"]) {
  const labels: Record<ReviewItem["status"], string> = {
    OPEN: "열림",
    RESOLVED: "완료",
    IGNORED: "무시"
  };
  return labels[status];
}

function reviewStatusTone(status: ReviewItem["status"]) {
  const tones: Record<ReviewItem["status"], string> = {
    OPEN: "amber",
    RESOLVED: "green",
    IGNORED: "blue"
  };
  return tones[status];
}

function ReportsPanel({
  company,
  companyId,
  transactions,
  evidences,
  reviewItems,
  journalEntries,
  taxReports,
  closingPeriods,
  onSaved,
  onDeleted,
  onClosingPeriodsChanged
}: {
  company: AppCompany;
  companyId: string;
  transactions: AppTransaction[];
  evidences: AppEvidence[];
  reviewItems: ReviewItem[];
  journalEntries: AppJournalEntry[];
  taxReports: AppTaxReport[];
  closingPeriods: AppClosingPeriod[];
  onSaved: (taxReport: AppTaxReport) => void;
  onDeleted: (taxReportId: string) => void;
  onClosingPeriodsChanged: (closingPeriods: AppClosingPeriod[]) => void;
}) {
  const periodOptions = useMemo(() => buildPeriodOptions(transactions), [transactions]);
  const [period, setPeriod] = useState(() => periodOptions[0]?.value ?? "ALL");
  const [savingReport, setSavingReport] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [closingPeriodAction, setClosingPeriodAction] = useState<"close" | "reopen" | null>(null);
  const [selectedTaxReportId, setSelectedTaxReportId] = useState<string | null>(null);
  const selectedPeriod = period === "ALL" || periodOptions.some((option) => option.value === period) ? period : periodOptions[0]?.value ?? "ALL";
  const selectedClosingPeriod = closingPeriods.find((item) => item.period === selectedPeriod) ?? null;
  const canClosePeriod = selectedPeriod !== "ALL";
  const isPeriodClosed = Boolean(selectedClosingPeriod);
  const filteredTransactions = useMemo(() => filterTransactionsByPeriod(transactions, selectedPeriod), [selectedPeriod, transactions]);
  const filteredEvidences = useMemo(() => filterEvidencesByPeriod(evidences, selectedPeriod), [evidences, selectedPeriod]);
  const filteredReviewItems = useMemo(() => filterReviewItemsByPeriod(reviewItems, selectedPeriod), [reviewItems, selectedPeriod]);
  const filteredJournalEntries = useMemo(() => filterJournalEntriesByPeriod(journalEntries, selectedPeriod), [journalEntries, selectedPeriod]);
  const approvedJournalEntries = useMemo(() => filteredJournalEntries.filter((entry) => entry.status === "APPROVED"), [filteredJournalEntries]);
  const reportSummary = useMemo(() => summarizeTransactions(filteredTransactions), [filteredTransactions]);
  const setupItems = buildCompanySetupItems(company);
  const expenseByAccount = groupExpensesByAccount(filteredTransactions);
  const reviews = useMemo(() => filteredReviewItems.filter((item) => item.status === "OPEN"), [filteredReviewItems]);
  const evidenceAmountMismatchCount = countEvidenceAmountMismatchReviews(reviews);
  const ledgerRows = buildLedgerRows(approvedJournalEntries);
  const withholdingRows = buildWithholdingRows(filteredTransactions);
  const financialStatementRows = buildFinancialStatementRows(ledgerRows);
  const financialStatementTotals = buildFinancialStatementTotals(financialStatementRows);
  const journalIntegrityRows = buildJournalIntegrityRows(approvedJournalEntries, ledgerRows, financialStatementRows, financialStatementTotals);
  const cashFlowRows = buildCashFlowRows(filteredTransactions);
  const cashFlowTotals = buildCashFlowTotals(cashFlowRows);
  const bankBalanceRows = buildBankBalanceCheckRows(filteredTransactions, cashFlowTotals);
  const bankBalanceStatus = summarizeBankBalanceRows(bankBalanceRows);
  const corporateTaxRows = buildCorporateTaxRows(reportSummary, filteredTransactions, filteredJournalEntries, ledgerRows, financialStatementRows, cashFlowRows, bankBalanceRows);
  const filingPackageRows = buildFilingPackageRows(reportSummary, filteredTransactions, filteredJournalEntries, ledgerRows, withholdingRows, financialStatementRows, cashFlowRows, bankBalanceRows);
  const dataSourceRows = buildDataSourceRows(filteredTransactions);
  const filingReadinessRows = buildFilingReadinessRows({
    setupItems,
    transactions: filteredTransactions,
    summary: reportSummary,
    dataSourceRows,
    withholdingRows,
    journalEntries: filteredJournalEntries,
    journalIntegrityRows,
    ledgerRows,
    cashFlowRows,
    bankBalanceRows,
    isPeriodClosed,
    canClosePeriod
  });
  const readinessBlockers = filingReadinessRows.filter((row) => row.톤 === "red").length;
  const readinessWarnings = filingReadinessRows.filter((row) => row.톤 === "amber").length;
  const readinessStatus = readinessBlockers > 0 ? "차단" : readinessWarnings > 0 ? "확인 필요" : "준비 가능";
  const readinessTone = readinessBlockers > 0 ? "red" : readinessWarnings > 0 ? "amber" : "green";
  const closingBlockerRows = buildClosingBlockerRows(filingReadinessRows);
  const isClosingBlocked = closingBlockerRows.length > 0;
  const periodLabel = formatPeriodLabel(selectedPeriod);
  const periodRange = getReportPeriodRange(selectedPeriod, filteredTransactions);
  const filingScheduleRows = buildFilingScheduleRows(company, periodRange, reportSummary, withholdingRows, ledgerRows);
  const submissionGuideRows = buildFilingSubmissionGuideRows({
    company,
    summary: reportSummary,
    dataSourceRows,
    filingReadinessRows,
    filingScheduleRows,
    withholdingRows,
    ledgerRows,
    financialStatementRows,
    cashFlowRows,
    bankBalanceRows,
    isPeriodClosed,
    canClosePeriod
  });
  const vatPrepRows = buildVatCsv(reportSummary, filteredTransactions);
  const visibleTaxReports = taxReports.slice(0, 6);
  const selectedTaxReport = taxReports.find((taxReport) => taxReport.id === selectedTaxReportId) ?? null;
  const selectedPayload = selectedTaxReport ? parseDetailedTaxReportPayload(selectedTaxReport.calculatedPayload) : null;

  function buildCurrentFilingPackagePayload() {
    return buildFilingPackagePayload({
      company,
      period: selectedPeriod,
      periodLabel,
      periodRange,
      summary: reportSummary,
      transactions: filteredTransactions,
      evidences: filteredEvidences,
      reviews,
      filingReadinessRows,
      filingScheduleRows,
      submissionGuideRows,
      dataSourceRows,
      filingPackageRows,
      withholdingRows,
      journalIntegrityRows,
      corporateTaxRows,
      cashFlowRows,
      bankBalanceRows,
      financialStatementRows,
      ledgerRows
    });
  }

  function downloadFilingPackageJson() {
    downloadJson(buildReportJsonFileName("filing-package", selectedPeriod), buildCurrentFilingPackagePayload());
  }

  function downloadFilingPackageArchive() {
    downloadFilingPackageZip(buildReportZipFileName("filing-package", selectedPeriod), buildCurrentFilingPackagePayload(), filteredEvidences);
  }

  function downloadFilingPackageWorkbook() {
    downloadFilingPackageXlsx(buildReportXlsxFileName("filing-package", selectedPeriod), buildCurrentFilingPackagePayload());
  }

  function printReport() {
    window.print();
  }

  async function saveSnapshot() {
    if (isPeriodClosed) return;
    setSavingReport(true);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          reportType: "CORPORATE_TAX_PREP",
          periodStart: periodRange.start,
          periodEnd: periodRange.end,
          calculatedPayload: buildTaxReportPayload({
            period: selectedPeriod,
            periodLabel,
            summary: reportSummary,
            filingReadinessRows,
            filingScheduleRows,
            submissionGuideRows,
            dataSourceRows,
            filingPackageRows,
            reviewItems: buildReviewCsv(reviews),
            withholdingRows,
            journalIntegrityRows,
            corporateTaxRows,
            cashFlowRows,
            bankBalanceRows,
            financialStatementRows,
            ledgerRows,
            transactionCount: filteredTransactions.length,
            journalEntryCount: approvedJournalEntries.length
          })
        })
      });
      const payload = await response.json();
      if (payload.taxReport) onSaved(payload.taxReport);
    } finally {
      setSavingReport(false);
    }
  }

  async function deleteTaxReport(taxReportId: string) {
    const taxReport = taxReports.find((item) => item.id === taxReportId);
    if (taxReport && isDateInClosedPeriod(taxReport.periodStart)) {
      window.alert("마감 잠금된 기간의 리포트는 삭제할 수 없습니다. 먼저 마감 해제를 진행하세요.");
      return;
    }
    const label = taxReport ? `${formatDate(taxReport.periodStart)} - ${formatDate(taxReport.periodEnd)} 리포트` : "선택한 리포트";
    if (!window.confirm(`${label}를 삭제할까요? 저장된 스냅샷은 복구할 수 없습니다.`)) return;

    setDeletingReportId(taxReportId);
    try {
      const response = await fetch("/api/reports", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taxReportId })
      });
      const payload = await response.json();
      if (payload.ok) {
        onDeleted(taxReportId);
        if (selectedTaxReportId === taxReportId) setSelectedTaxReportId(null);
      }
    } finally {
      setDeletingReportId(null);
    }
  }

  async function closeSelectedPeriod() {
    if (!canClosePeriod || isPeriodClosed) return;
    if (isClosingBlocked) {
      window.alert(`마감 잠금 전 차단 항목을 먼저 해결해야 합니다: ${closingBlockerRows.map((row) => row.점검).join(", ")}`);
      return;
    }
    if (!window.confirm(`${periodLabel} 장부를 마감 잠금 처리할까요? 잠금 후에는 해당 월의 거래, 증빙, 분개, 리포트 변경이 차단됩니다.`)) return;

    setClosingPeriodAction("close");
    try {
      const response = await fetch("/api/closing-periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          period: selectedPeriod,
          summaryPayload: {
            periodRange,
            report: buildTaxReportPayload({
              period: selectedPeriod,
              periodLabel,
              summary: reportSummary,
              filingReadinessRows,
              filingScheduleRows,
              submissionGuideRows,
              dataSourceRows,
              filingPackageRows,
              reviewItems: buildReviewCsv(reviews),
              withholdingRows,
              journalIntegrityRows,
              corporateTaxRows,
              cashFlowRows,
              bankBalanceRows,
              financialStatementRows,
              ledgerRows,
              transactionCount: filteredTransactions.length,
              journalEntryCount: approvedJournalEntries.length
            })
          }
        })
      });
      const payload = await response.json();
      if (payload.closingPeriod) {
        onClosingPeriodsChanged(sortClosingPeriods([payload.closingPeriod, ...closingPeriods.filter((item) => item.period !== selectedPeriod)]));
      } else if (!response.ok) {
        window.alert(payload.message ?? "마감 잠금에 실패했습니다.");
      }
    } finally {
      setClosingPeriodAction(null);
    }
  }

  async function reopenSelectedPeriod() {
    if (!canClosePeriod || !isPeriodClosed) return;
    if (!window.confirm(`${periodLabel} 마감 잠금을 해제할까요? 해제 후에는 해당 월 데이터를 다시 수정할 수 있습니다.`)) return;

    setClosingPeriodAction("reopen");
    try {
      const response = await fetch("/api/closing-periods", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, period: selectedPeriod })
      });
      const payload = await response.json();
      if (payload.ok) {
        onClosingPeriodsChanged(closingPeriods.filter((item) => item.period !== selectedPeriod));
      } else if (!response.ok) {
        window.alert(payload.message ?? "마감 해제에 실패했습니다.");
      }
    } finally {
      setClosingPeriodAction(null);
    }
  }

  function isDateInClosedPeriod(value: string) {
    return closingPeriods.some((item) => item.periodStart <= value && item.periodEnd >= value);
  }

  return (
    <div className="content">
      <section className="print-report-title">
        <h1>혼자장부 신고 준비 리포트</h1>
        <p>
          {company.name} · {periodLabel} · {formatDate(periodRange.start)} - {formatDate(periodRange.end)}
        </p>
      </section>

      <section className="panel report-filter-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">리포트 기간</h2>
            <p className="panel-subtitle">
              {isPeriodClosed
                ? `${formatDate(selectedClosingPeriod?.closedAt ?? "")} 마감됨 · 해당 월 변경 잠금`
                : canClosePeriod && isClosingBlocked
                  ? `${formatNumber(closingBlockerRows.length)}개 차단 항목 해결 후 마감 잠금 가능`
                  : canClosePeriod
                  ? "월별 신고자료가 확정되면 마감 잠금으로 변경을 차단"
                  : "월별 기간을 선택하면 마감 잠금을 사용할 수 있습니다."}
            </p>
          </div>
          <div className="toolbar">
            <span className="status blue">{periodLabel}</span>
            <span className={`status ${isPeriodClosed ? "green" : canClosePeriod && isClosingBlocked ? "red" : canClosePeriod ? "amber" : "blue"}`}>
              {isPeriodClosed ? "마감 잠금" : canClosePeriod && isClosingBlocked ? "마감 차단" : canClosePeriod ? "마감 가능" : "전체 기간"}
            </span>
            <button className="secondary-button" onClick={printReport}>
              <Printer size={16} />
              인쇄/PDF
            </button>
            {canClosePeriod &&
              (isPeriodClosed ? (
                <button className="secondary-button" onClick={() => void reopenSelectedPeriod()} disabled={closingPeriodAction !== null}>
                  {closingPeriodAction === "reopen" ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
                  마감 해제
                </button>
              ) : (
                <button
                  className="secondary-button"
                  onClick={() => void closeSelectedPeriod()}
                  disabled={closingPeriodAction !== null || isClosingBlocked}
                  title={isClosingBlocked ? "최종 신고 점검의 차단 항목을 먼저 해결하세요." : "월 마감 잠금"}
                >
                  {closingPeriodAction === "close" ? <Loader2 size={16} className="spin" /> : <FileCheck2 size={16} />}
                  마감 잠금
                </button>
              ))}
            <button className="primary-button" onClick={() => void saveSnapshot()} disabled={savingReport || isPeriodClosed}>
              {savingReport ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
              스냅샷 저장
            </button>
            <select className="secondary-button" value={selectedPeriod} onChange={(event) => setPeriod(event.target.value)}>
              {periodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="ALL">전체 기간</option>
            </select>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">최종 신고 점검</h2>
            <p className="panel-subtitle">자료, 분류, 증빙, 원장, 마감 상태를 신고 전 순서대로 확인</p>
          </div>
          <div className="toolbar">
            <span className={`status ${readinessTone}`}>{readinessStatus}</span>
            <span className={readinessBlockers > 0 ? "status red" : "status green"}>{formatNumber(readinessBlockers)}개 차단</span>
            <span className={readinessWarnings > 0 ? "status amber" : "status green"}>{formatNumber(readinessWarnings)}개 확인</span>
            <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("filing-readiness", selectedPeriod), filingReadinessRows)}>
              <Download size={16} />
              점검
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>순서</th>
                <th>점검</th>
                <th>상태</th>
                <th>근거</th>
                <th>다음 작업</th>
              </tr>
            </thead>
            <tbody>
              {filingReadinessRows.map((row) => (
                <tr key={row.점검}>
                  <td>{row.순서}</td>
                  <td>{row.점검}</td>
                  <td>
                    <span className={`status ${row.톤}`}>{row.상태}</span>
                  </td>
                  <td>{row.근거}</td>
                  <td>{row["다음 작업"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">신고 일정</h2>
            <p className="panel-subtitle">기한은 신고 전 국세청 공지와 홈택스 기준으로 최종 확인</p>
          </div>
          <div className="toolbar">
            <span className="status blue">{periodLabel}</span>
            <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("filing-schedule", selectedPeriod), filingScheduleRows)}>
              <Download size={16} />
              일정
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>신고</th>
                <th>대상 기간</th>
                <th>예상 기한</th>
                <th>상태</th>
                <th>다음 작업</th>
              </tr>
            </thead>
            <tbody>
              {filingScheduleRows.map((row) => (
                <tr key={row.신고}>
                  <td>{row.신고}</td>
                  <td>{row["대상 기간"]}</td>
                  <td>{row["예상 기한"]}</td>
                  <td>
                    <span className={`status ${row.톤}`}>{row.상태}</span>
                  </td>
                  <td>{row["다음 작업"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">홈택스 제출 전 입력 가이드</h2>
            <p className="panel-subtitle">부가세, 원천세, 법인세 입력 전에 어떤 표를 보고 무엇을 대조할지 순서대로 확인</p>
          </div>
          <div className="toolbar">
            <span className="status blue">{formatNumber(submissionGuideRows.length)}단계</span>
            <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("submission-guide", selectedPeriod), submissionGuideRows)}>
              <Download size={16} />
              가이드
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>순서</th>
                <th>신고</th>
                <th>홈택스/제출 위치</th>
                <th>혼자장부에서 볼 것</th>
                <th>상태</th>
                <th>입력 기준</th>
                <th>마감 전 확인</th>
              </tr>
            </thead>
            <tbody>
              {submissionGuideRows.map((row) => (
                <tr key={`${row.순서}-${row.신고}`}>
                  <td>{row.순서}</td>
                  <td>{row.신고}</td>
                  <td>{row["홈택스/제출 위치"]}</td>
                  <td>{row["혼자장부에서 볼 것"]}</td>
                  <td>
                    <span className={`status ${row.톤}`}>{row.상태}</span>
                  </td>
                  <td>{row["입력 기준"]}</td>
                  <td>{row["마감 전 확인"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">자료 수집 현황</h2>
            <p className="panel-subtitle">신고 전 통장, 카드, 홈택스, PG 자료 반영 여부 확인</p>
          </div>
          <div className="toolbar">
            <span className="status blue">{periodLabel}</span>
            <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("data-sources", selectedPeriod), dataSourceRows)}>
              <Download size={16} />
              자료
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>자료</th>
                <th>상태</th>
                <th className="amount">거래</th>
                <th>기간</th>
                <th>다음 확인</th>
              </tr>
            </thead>
            <tbody>
              {dataSourceRows.map((row) => (
                <tr key={row.자료}>
                  <td>{row.자료}</td>
                  <td>
                    <span className={`status ${row.톤}`}>{row.상태}</span>
                  </td>
                  <td className="amount">{row.거래}</td>
                  <td>{row.기간}</td>
                  <td>{row["다음 확인"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">부가세 입력 전 정리표</h2>
            <p className="panel-subtitle">홈택스 입력 전 공급가액, 세액, 공제 보류 후보 확인</p>
          </div>
          <div className="toolbar">
            <span className="status blue">{formatNumber(vatPrepRows.length)}행</span>
            <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("vat-report", selectedPeriod), vatPrepRows)}>
              <Download size={16} />
              부가세
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th>입력/확인 위치</th>
                <th className="amount">공급가액</th>
                <th className="amount">세액</th>
                <th className="amount">건수</th>
                <th>거래/근거</th>
                <th>검토</th>
              </tr>
            </thead>
            <tbody>
              {vatPrepRows.map((row, index) => (
                <tr key={`${row.구분}-${row["거래/근거"]}-${index}`}>
                  <td>{row.구분}</td>
                  <td>{row["신고서 입력/확인 위치"]}</td>
                  <td className="amount">{formatReportAmount(row.공급가액)}</td>
                  <td className="amount">{formatReportAmount(row.세액)}</td>
                  <td className="amount">{formatNumber(Number(row.건수) || 0)}</td>
                  <td>{row["거래/근거"]}</td>
                  <td>{row.검토}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {visibleTaxReports.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">저장된 리포트</h2>
            <span className="status blue">{formatNumber(taxReports.length)}개</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>저장일</th>
                  <th>기간</th>
                  <th>유형</th>
                  <th className="amount">거래</th>
                  <th className="amount">손익</th>
                  <th className="amount">예상 부가세</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {visibleTaxReports.map((taxReport) => {
                  const payload = parseTaxReportPayload(taxReport.calculatedPayload);
                  return (
                    <tr key={taxReport.id}>
                      <td>{formatDate(taxReport.createdAt)}</td>
                      <td>
                        {formatDate(taxReport.periodStart)} - {formatDate(taxReport.periodEnd)}
                      </td>
                      <td>{taxReportTypeLabel(taxReport.reportType)}</td>
                      <td className="amount">{formatNumber(payload.transactionCount ?? 0)}건</td>
                      <td className="amount">{formatKRW(payload.profit ?? 0)}</td>
                      <td className="amount">{formatKRW(payload.vatPayable ?? 0)}</td>
                      <td>
                        <button className="ghost-button" onClick={() => setSelectedTaxReportId(taxReport.id)}>열기</button>
                        <button className="ghost-button" disabled={deletingReportId === taxReport.id || isDateInClosedPeriod(taxReport.periodStart)} onClick={() => void deleteTaxReport(taxReport.id)}>
                          {isDateInClosedPeriod(taxReport.periodStart) ? "마감됨" : deletingReportId === taxReport.id ? "삭제 중" : "삭제"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selectedTaxReport && selectedPayload && (
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">리포트 상세</h2>
            <div className="toolbar">
              <span className="status blue">{selectedPayload.periodLabel || taxReportTypeLabel(selectedTaxReport.reportType)}</span>
              <button
                className="secondary-button"
                onClick={() => downloadJson(`honzang-report-${selectedTaxReport.periodStart}-${selectedTaxReport.id}.json`, selectedTaxReport)}
              >
                <Download size={16} />
                JSON
              </button>
              <button className="ghost-button" disabled={deletingReportId === selectedTaxReport.id || isDateInClosedPeriod(selectedTaxReport.periodStart)} onClick={() => void deleteTaxReport(selectedTaxReport.id)}>
                {isDateInClosedPeriod(selectedTaxReport.periodStart) ? "마감됨" : deletingReportId === selectedTaxReport.id ? "삭제 중" : "삭제"}
              </button>
              <button className="ghost-button" onClick={() => setSelectedTaxReportId(null)}>닫기</button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>항목</th>
                  <th className="amount">값</th>
                  <th>확인</th>
                </tr>
              </thead>
              <tbody>
                {buildTaxReportDetailRows(selectedTaxReport, selectedPayload).map((row) => (
                  <tr key={row.항목}>
                    <td>{row.항목}</td>
                    <td className="amount">{row.값}</td>
                    <td>{row.확인}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-wrap snapshot-detail">
            <table>
              <thead>
                <tr>
                  <th>순서</th>
                  <th>점검</th>
                  <th>상태</th>
                  <th>근거</th>
                  <th>다음 작업</th>
                </tr>
              </thead>
              <tbody>
                {selectedPayload.filingReadinessRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">저장된 최종 신고 점검이 없습니다.</td>
                  </tr>
                ) : (
                  selectedPayload.filingReadinessRows.map((row) => (
                    <tr key={row.점검}>
                      <td>{row.순서}</td>
                      <td>{row.점검}</td>
                      <td>{row.상태}</td>
                      <td>{row.근거}</td>
                      <td>{row["다음 작업"]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-wrap snapshot-detail">
            <table>
              <thead>
                <tr>
                  <th>신고</th>
                  <th>대상 기간</th>
                  <th>예상 기한</th>
                  <th>상태</th>
                  <th>다음 작업</th>
                </tr>
              </thead>
              <tbody>
                {selectedPayload.filingScheduleRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">저장된 신고 일정이 없습니다.</td>
                  </tr>
                ) : (
                  selectedPayload.filingScheduleRows.map((row) => (
                    <tr key={row.신고}>
                      <td>{row.신고}</td>
                      <td>{row["대상 기간"]}</td>
                      <td>{row["예상 기한"]}</td>
                      <td>
                        <span className={`status ${row.톤}`}>{row.상태}</span>
                      </td>
                      <td>{row["다음 작업"]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-wrap snapshot-detail">
            <table>
              <thead>
                <tr>
                  <th>순서</th>
                  <th>신고</th>
                  <th>홈택스/제출 위치</th>
                  <th>혼자장부에서 볼 것</th>
                  <th>상태</th>
                  <th>입력 기준</th>
                  <th>마감 전 확인</th>
                </tr>
              </thead>
              <tbody>
                {selectedPayload.submissionGuideRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-cell">저장된 홈택스 제출 전 입력 가이드가 없습니다.</td>
                  </tr>
                ) : (
                  selectedPayload.submissionGuideRows.map((row) => (
                    <tr key={`${row.순서}-${row.신고}`}>
                      <td>{row.순서}</td>
                      <td>{row.신고}</td>
                      <td>{row["홈택스/제출 위치"]}</td>
                      <td>{row["혼자장부에서 볼 것"]}</td>
                      <td>
                        <span className={`status ${row.톤}`}>{row.상태}</span>
                      </td>
                      <td>{row["입력 기준"]}</td>
                      <td>{row["마감 전 확인"]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-wrap snapshot-detail">
            <table>
              <thead>
                <tr>
                  <th>자료</th>
                  <th>상태</th>
                  <th className="amount">거래</th>
                  <th>기간</th>
                  <th>다음 확인</th>
                </tr>
              </thead>
              <tbody>
                {selectedPayload.dataSourceRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">저장된 자료 수집 현황이 없습니다.</td>
                  </tr>
                ) : (
                  selectedPayload.dataSourceRows.map((row) => (
                    <tr key={row.자료}>
                      <td>{row.자료}</td>
                      <td>{row.상태}</td>
                      <td className="amount">{row.거래}</td>
                      <td>{row.기간}</td>
                      <td>{row["다음 확인"]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="split snapshot-detail">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>신고 패키지</th>
                    <th>상태</th>
                    <th className="amount">금액/건수</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPayload.filingPackageRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="empty-cell">저장된 신고 패키지 항목이 없습니다.</td>
                    </tr>
                  ) : (
                    selectedPayload.filingPackageRows.map((row) => (
                      <tr key={row.구분}>
                        <td>{row.구분}</td>
                        <td>{row.상태}</td>
                        <td className="amount">{row["금액/건수"]}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>법인세 체크</th>
                    <th className="amount">값</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPayload.corporateTaxRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="empty-cell">저장된 법인세 체크 항목이 없습니다.</td>
                    </tr>
                  ) : (
                    selectedPayload.corporateTaxRows.map((row) => (
                      <tr key={row.항목}>
                        <td>{row.항목}</td>
                        <td className="amount">{row.값}</td>
                        <td>{row.상태}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-wrap snapshot-detail">
            <table>
              <thead>
                <tr>
                  <th>재무제표 구분</th>
                  <th>계정</th>
                  <th className="amount">금액</th>
                  <th>확인</th>
                </tr>
              </thead>
              <tbody>
                {selectedPayload.financialStatementRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">저장된 재무제표 초안이 없습니다.</td>
                  </tr>
                ) : (
                  selectedPayload.financialStatementRows.map((row) => (
                    <tr key={`${row.구분}-${row.계정}`}>
                      <td>{row.구분}</td>
                      <td>{row.계정}</td>
                      <td className="amount">{formatKRW(row.금액)}</td>
                      <td>{row.확인}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-wrap snapshot-detail">
            <table>
              <thead>
                <tr>
                  <th>현금흐름 구분</th>
                  <th>항목</th>
                  <th className="amount">금액</th>
                  <th className="amount">건수</th>
                  <th>다음 확인</th>
                </tr>
              </thead>
              <tbody>
                {selectedPayload.cashFlowRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">저장된 현금흐름 요약이 없습니다.</td>
                  </tr>
                ) : (
                  selectedPayload.cashFlowRows.map((row) => (
                    <tr key={`${row.구분}-${row.항목}`}>
                      <td>{row.구분}</td>
                      <td>{row.항목}</td>
                      <td className="amount">{formatKRW(row.금액)}</td>
                      <td className="amount">{formatNumber(row.건수)}</td>
                      <td>{row["다음 확인"]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-wrap snapshot-detail">
            <table>
              <thead>
                <tr>
                  <th>잔액 점검</th>
                  <th>상태</th>
                  <th className="amount">금액</th>
                  <th>다음 확인</th>
                </tr>
              </thead>
              <tbody>
                {selectedPayload.bankBalanceRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">저장된 통장 잔액 대조가 없습니다.</td>
                  </tr>
                ) : (
                  selectedPayload.bankBalanceRows.map((row) => (
                    <tr key={`${row.점검}-${row.상태}`}>
                      <td>{row.점검}</td>
                      <td>
                        <span className={`status ${row.톤}`}>{row.상태}</span>
                      </td>
                      <td className="amount">{formatReportAmount(row.금액)}</td>
                      <td>{row["다음 확인"]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-wrap snapshot-detail">
            <table>
              <thead>
                <tr>
                  <th>원천세 후보</th>
                  <th>거래처</th>
                  <th className="amount">지급액</th>
                  <th className="amount">예상 원천세</th>
                  <th>확인</th>
                </tr>
              </thead>
              <tbody>
                {selectedPayload.withholdingRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">저장된 원천세 후보가 없습니다.</td>
                  </tr>
                ) : (
                  selectedPayload.withholdingRows.map((row) => (
                    <tr key={`${row.거래일}-${row.거래처}-${row.지급액}`}>
                      <td>{formatDate(row.거래일)}</td>
                      <td>{row.거래처}</td>
                      <td className="amount">{formatKRW(row.지급액)}</td>
                      <td className="amount">{row["예상 원천세"] ? formatKRW(row["예상 원천세"]) : "-"}</td>
                      <td>{row.확인}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="kpi-grid">
        <Kpi label="기간 손익" value={formatKRW(reportSummary.profit)} foot={`${formatKRW(reportSummary.revenue)} - ${formatKRW(reportSummary.expense)}`} icon={<BarChart3 size={16} />} />
        <Kpi label="매출 부가세" value={formatKRW(reportSummary.vatOutput)} foot="예수금" icon={<ReceiptText size={16} />} />
        <Kpi label="매입 부가세" value={formatKRW(reportSummary.vatInput)} foot="대급금" icon={<FileSpreadsheet size={16} />} />
        <Kpi label="예상 납부" value={formatKRW(reportSummary.vatPayable)} foot="확정 전" icon={<CheckCircle2 size={16} />} />
        <Kpi label="증빙 누락" value={formatKRW(reportSummary.missingEvidenceAmount)} foot={`${formatNumber(reviews.length)}건 검토`} icon={<AlertTriangle size={16} />} />
        <Kpi label="증빙 불일치" value={`${formatNumber(evidenceAmountMismatchCount)}건`} foot="거래-증빙 금액 차이" icon={<AlertTriangle size={16} />} />
      </section>

      <div className="split">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">비용 계정</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>계정과목</th>
                  <th className="amount">금액</th>
                  <th className="amount">건수</th>
                </tr>
              </thead>
              <tbody>
                {expenseByAccount.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td className="amount">{formatKRW(row.amount)}</td>
                    <td className="amount">{formatNumber(row.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">신고 준비</h2>
            <div className="toolbar">
              <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("transactions", selectedPeriod), buildTransactionCsv(filteredTransactions))}>
                <Download size={16} />
                거래
              </button>
              <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("vat-report", selectedPeriod), vatPrepRows)}>
                <Download size={16} />
                부가세
              </button>
              <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("review-items", selectedPeriod), buildReviewCsv(reviews))}>
                <Download size={16} />
                검토
              </button>
              <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("withholding-candidates", selectedPeriod), withholdingRows)}>
                <Download size={16} />
                원천세
              </button>
              <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("cash-flow", selectedPeriod), cashFlowRows)}>
                <Download size={16} />
                현금흐름
              </button>
              <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("bank-balance-check", selectedPeriod), bankBalanceRows)}>
                <Download size={16} />
                잔액대조
              </button>
              <button className="secondary-button" onClick={downloadFilingPackageArchive}>
                <Download size={16} />
                패키지 ZIP
              </button>
              <button className="secondary-button" onClick={downloadFilingPackageWorkbook}>
                <Download size={16} />
                엑셀
              </button>
              <button className="secondary-button" onClick={downloadFilingPackageJson}>
                <Download size={16} />
                패키지 JSON
              </button>
              <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("corporate-tax-prep", selectedPeriod), corporateTaxRows)}>
                <Download size={16} />
                법인세
              </button>
              <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("financial-statements", selectedPeriod), financialStatementRows)}>
                <Download size={16} />
                재무제표
              </button>
            </div>
          </div>
          <div className="panel-body">
            <div className="review-list">
              <ChecklistItem tone="green" title="거래 분류" value={`${formatNumber(filteredTransactions.filter((tx) => tx.confirmedAccount || tx.suggestedAccount).length)}건`} />
              <ChecklistItem tone={reportSummary.missingEvidenceAmount > 0 ? "red" : "green"} title="증빙 확인" value={formatKRW(reportSummary.missingEvidenceAmount)} />
              <ChecklistItem tone={evidenceAmountMismatchCount > 0 ? "red" : "green"} title="증빙 금액" value={`${formatNumber(evidenceAmountMismatchCount)}건 불일치`} />
              <ChecklistItem tone={reportSummary.vatPayable > 0 ? "amber" : "green"} title="부가세" value={formatKRW(reportSummary.vatPayable)} />
              <ChecklistItem tone={reportSummary.riskCount > 0 ? "amber" : "green"} title="원천세/대표자" value={`${reportSummary.riskCount}건`} />
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">신고 패키지</h2>
          <div className="toolbar">
            <span className="status blue">{formatNumber(filingPackageRows.length)}개 항목</span>
            <button className="secondary-button" onClick={downloadFilingPackageJson}>
              <Download size={16} />
              JSON
            </button>
            <button className="secondary-button" onClick={downloadFilingPackageArchive}>
              <Download size={16} />
              ZIP
            </button>
            <button className="secondary-button" onClick={downloadFilingPackageWorkbook}>
              <Download size={16} />
              XLSX
            </button>
            <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("filing-package", selectedPeriod), filingPackageRows)}>
              <Download size={16} />
              패키지
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th>상태</th>
                <th className="amount">금액/건수</th>
                <th>다음 확인</th>
              </tr>
            </thead>
            <tbody>
              {filingPackageRows.map((row) => (
                <tr key={row.구분}>
                  <td>{row.구분}</td>
                  <td>
                    <span className={`status ${row.톤}`}>{row.상태}</span>
                  </td>
                  <td className="amount">{row["금액/건수"]}</td>
                  <td>{row["다음 확인"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="split">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">원천세 후보</h2>
            <span className={withholdingRows.length ? "status amber" : "status green"}>{formatNumber(withholdingRows.length)}건</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>거래일</th>
                  <th>거래처</th>
                  <th>구분</th>
                  <th className="amount">지급액</th>
                  <th className="amount">예상 원천세</th>
                  <th>확인</th>
                </tr>
              </thead>
              <tbody>
                {withholdingRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">급여, 외주비, 기타소득 원천세 후보가 없습니다.</td>
                  </tr>
                ) : (
                  withholdingRows.map((row) => (
                    <tr key={`${row.거래일}-${row.거래처}-${row.지급액}`}>
                      <td>{formatDate(row.거래일)}</td>
                      <td>{row.거래처}</td>
                      <td>{row.구분}</td>
                      <td className="amount">{formatKRW(row.지급액)}</td>
                      <td className="amount">{row["예상 원천세"] ? formatKRW(row["예상 원천세"]) : "-"}</td>
                      <td>{row.확인}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">법인세 결산 체크</h2>
            <span className="status blue">{formatNumber(corporateTaxRows.length)}개 항목</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>항목</th>
                  <th className="amount">값</th>
                  <th>상태</th>
                  <th>확인</th>
                </tr>
              </thead>
              <tbody>
                {corporateTaxRows.map((row) => (
                  <tr key={row.항목}>
                    <td>{row.항목}</td>
                    <td className="amount">{row.값}</td>
                    <td>{row.상태}</td>
                    <td>{row.확인}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">재무제표 초안</h2>
            <p className="panel-subtitle">승인된 분개 기준, 신고 전 검토용</p>
          </div>
          <div className="toolbar">
            <span className="status blue">{formatNumber(financialStatementRows.length)}개 계정</span>
            <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("financial-statements", selectedPeriod), financialStatementRows)}>
              <Download size={16} />
              CSV
            </button>
          </div>
        </div>
        <div className="panel-body">
          <div className="review-list">
            <ChecklistItem tone="green" title="자산" value={formatKRW(financialStatementTotals.asset)} />
            <ChecklistItem tone="green" title="부채" value={formatKRW(financialStatementTotals.liability)} />
            <ChecklistItem tone="green" title="자본" value={formatKRW(financialStatementTotals.equity + financialStatementTotals.profit)} />
            <ChecklistItem tone={financialStatementTotals.profit >= 0 ? "green" : "amber"} title="손익" value={formatKRW(financialStatementTotals.profit)} />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th>계정</th>
                <th className="amount">금액</th>
                <th>확인</th>
              </tr>
            </thead>
            <tbody>
              {financialStatementRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-cell">승인된 분개가 없습니다. 자동분개 탭에서 초안을 승인하면 재무제표 초안이 생성됩니다.</td>
                </tr>
              ) : (
                financialStatementRows.map((row) => (
                  <tr key={`${row.구분}-${row.계정}`}>
                    <td>{row.구분}</td>
                    <td>{row.계정}</td>
                    <td className="amount">{formatKRW(row.금액)}</td>
                    <td>{row.확인}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">현금흐름 요약</h2>
            <p className="panel-subtitle">거래 CSV 기준 입출금 흐름과 보조자료 영향을 확인합니다.</p>
          </div>
          <div className="toolbar">
            <span className={`status ${cashFlowTotals.net >= 0 ? "green" : "amber"}`}>순증감 {formatKRW(cashFlowTotals.net)}</span>
            <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("cash-flow", selectedPeriod), cashFlowRows)}>
              <Download size={16} />
              CSV
            </button>
          </div>
        </div>
        <div className="panel-body">
          <div className="review-list">
            <ChecklistItem tone="green" title="현금 유입" value={formatKRW(cashFlowTotals.inflow)} />
            <ChecklistItem tone={cashFlowTotals.outflow > 0 ? "amber" : "green"} title="현금 유출" value={formatKRW(cashFlowTotals.outflow)} />
            <ChecklistItem tone={cashFlowTotals.net >= 0 ? "green" : "amber"} title="순현금증감" value={formatKRW(cashFlowTotals.net)} />
            <ChecklistItem tone="blue" title="거래 건수" value={`${formatNumber(cashFlowTotals.count)}건`} />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th>항목</th>
                <th className="amount">금액</th>
                <th className="amount">건수</th>
                <th>근거</th>
                <th>다음 확인</th>
              </tr>
            </thead>
            <tbody>
              {cashFlowRows.map((row) => (
                <tr key={`${row.구분}-${row.항목}`}>
                  <td>{row.구분}</td>
                  <td>{row.항목}</td>
                  <td className="amount">{formatKRW(row.금액)}</td>
                  <td className="amount">{formatNumber(row.건수)}</td>
                  <td>{row.근거}</td>
                  <td>{row["다음 확인"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">통장 잔액 대조</h2>
            <p className="panel-subtitle">은행 CSV 잔액 컬럼 기준으로 시작/종료 잔액과 통장 거래 순증감을 맞춥니다.</p>
          </div>
          <div className="toolbar">
            <span className={`status ${bankBalanceStatus.tone}`}>{bankBalanceStatus.status}</span>
            <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("bank-balance-check", selectedPeriod), bankBalanceRows)}>
              <Download size={16} />
              CSV
            </button>
          </div>
        </div>
        <div className="panel-body">
          <div className="review-list">
            <ChecklistItem tone={bankBalanceStatus.tone} title="대조 상태" value={bankBalanceStatus.status} />
            <ChecklistItem tone={bankBalanceStatus.tone === "red" ? "red" : bankBalanceStatus.difference === 0 ? "green" : "amber"} title="대조 차이" value={formatReportAmount(bankBalanceStatus.difference)} />
            <ChecklistItem tone="blue" title="통장 거래" value={`${formatNumber(bankBalanceStatus.bankTransactionCount)}건`} />
            <ChecklistItem tone={bankBalanceStatus.balanceRowCount > 0 ? "green" : "amber"} title="잔액 행" value={`${formatNumber(bankBalanceStatus.balanceRowCount)}건`} />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>점검</th>
                <th>상태</th>
                <th className="amount">금액</th>
                <th>근거</th>
                <th>다음 확인</th>
              </tr>
            </thead>
            <tbody>
              {bankBalanceRows.map((row) => (
                <tr key={`${row.점검}-${row.상태}`}>
                  <td>{row.점검}</td>
                  <td>
                    <span className={`status ${row.톤}`}>{row.상태}</span>
                  </td>
                  <td className="amount">{formatReportAmount(row.금액)}</td>
                  <td>{row.근거}</td>
                  <td>{row["다음 확인"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">복식부기 검증</h2>
            <p className="panel-subtitle">승인 분개 기준 차변/대변과 회계등식 점검</p>
          </div>
          <div className="toolbar">
            <span className={`status ${journalIntegrityRows.some((row) => row.톤 === "red") ? "red" : journalIntegrityRows.some((row) => row.톤 === "amber") ? "amber" : "green"}`}>
              {journalIntegrityRows.some((row) => row.톤 === "red") ? "차단" : journalIntegrityRows.some((row) => row.톤 === "amber") ? "확인" : "균형"}
            </span>
            <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("journal-integrity", selectedPeriod), journalIntegrityRows)}>
              <Download size={16} />
              검증
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>점검</th>
                <th>상태</th>
                <th className="amount">금액</th>
                <th>근거</th>
                <th>다음 작업</th>
              </tr>
            </thead>
            <tbody>
              {journalIntegrityRows.map((row) => (
                <tr key={row.점검}>
                  <td>{row.점검}</td>
                  <td><span className={`status ${row.톤}`}>{row.상태}</span></td>
                  <td className="amount">{row.금액}</td>
                  <td>{row.근거}</td>
                  <td>{row["다음 작업"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">계정별 원장</h2>
          <div className="toolbar">
            <span className="status blue">{formatNumber(approvedJournalEntries.length)}개 승인 분개</span>
            <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("ledger", selectedPeriod), buildLedgerCsv(ledgerRows))}>
              <Download size={16} />
              원장
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>일자</th>
                <th>계정</th>
                <th>적요</th>
                <th className="amount">차변</th>
                <th className="amount">대변</th>
                <th className="amount">잔액</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">승인된 분개가 없습니다. 자동분개 탭에서 초안을 승인하면 원장이 생성됩니다.</td>
                </tr>
              ) : (
                ledgerRows.map((row, index) => (
                  <tr key={`${row.entryDate}-${row.accountCode}-${index}`}>
                    <td>{formatDate(row.entryDate)}</td>
                    <td>
                      {row.accountCode} {row.accountName}
                    </td>
                    <td>{row.memo}</td>
                    <td className="amount">{row.debitAmount ? formatKRW(row.debitAmount) : "-"}</td>
                    <td className="amount">{row.creditAmount ? formatKRW(row.creditAmount) : "-"}</td>
                    <td className="amount">{formatKRW(row.balance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SettingsPanel({
  mode,
  company,
  accounts,
  csvTemplates,
  importBatches,
  transactions,
  evidences,
  journalEntries,
  taxReports,
  vendors,
  classificationRules,
  auditEvents,
  closingPeriods,
  reviewItems,
  onSaved,
  onVendorsChanged,
  onRulesChanged,
  onCsvTemplatesChanged,
  onRestored
}: {
  mode: "sample" | "database";
  company: AppCompany;
  accounts: AppAccount[];
  csvTemplates: CsvTemplate[];
  importBatches: AppImportBatch[];
  transactions: AppTransaction[];
  evidences: AppEvidence[];
  journalEntries: AppJournalEntry[];
  taxReports: AppTaxReport[];
  vendors: AppVendor[];
  classificationRules: AppClassificationRule[];
  auditEvents: AppAuditEvent[];
  closingPeriods: AppClosingPeriod[];
  reviewItems: ReviewItem[];
  onSaved: (company: AppCompany) => void;
  onVendorsChanged: (vendors: AppVendor[]) => void;
  onRulesChanged: (rules: AppClassificationRule[]) => void;
  onCsvTemplatesChanged: (templates: CsvTemplate[]) => void;
  onRestored: () => Promise<void>;
}) {
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<AppCompany>(company);
  const [vendorForm, setVendorForm] = useState({
    name: "",
    businessRegistrationNumber: "",
    defaultAccountId: accounts.find((account) => account.code === "599")?.id ?? accounts[0]?.id ?? "",
    withholdingType: "NONE",
    memo: ""
  });
  const [ruleForm, setRuleForm] = useState({
    name: "",
    keyword: "",
    accountCode: accounts.find((account) => account.code === "599")?.code ?? accounts[0]?.code ?? "",
    sourceType: "",
    priority: "100"
  });
  const [saving, setSaving] = useState(false);
  const [savingVendor, setSavingVendor] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [deletingCsvTemplateId, setDeletingCsvTemplateId] = useState<string | null>(null);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null);
  const [operationReadiness, setOperationReadiness] = useState<OperationReadinessPayload | null>(null);
  const [operationLoading, setOperationLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const setupItems = buildCompanySetupItems(form);
  const billingEstimate = buildBillingEstimate(form, transactions);
  const missingCount = setupItems.filter((item) => item.tone === "red").length;
  const dataRetentionRows = buildDataRetentionRows({
    importBatches,
    transactions,
    evidences,
    journalEntries,
    taxReports,
    vendors,
    classificationRules,
    auditEvents,
    closingPeriods,
    csvTemplates,
    reviewItems
  });
  const backupReadinessRows = buildBackupReadinessRows({
    company: form,
    accounts,
    importBatches,
    transactions,
    evidences,
    journalEntries,
    taxReports,
    vendors,
    classificationRules,
    auditEvents,
    closingPeriods,
    reviewItems
  });
  const csvTemplateRows = buildCsvTemplateRows(csvTemplates);
  function buildCurrentBackupPayload(originalImportFiles: OriginalImportFile[] = []) {
    return buildWorkspaceBackupPayload({
      mode,
      company: form,
      accounts,
      csvTemplates,
      importBatches,
      originalImportFiles,
      transactions,
      evidences,
      journalEntries,
      taxReports,
      vendors,
      classificationRules,
      auditEvents,
      closingPeriods,
      reviewItems
    });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setForm(company);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [company]);

  useEffect(() => {
    void loadOperationReadiness();
  }, []);

  function updateForm<K extends keyof AppCompany>(key: K, value: AppCompany[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateRuleForm(key: keyof typeof ruleForm, value: string) {
    setRuleForm((current) => ({ ...current, [key]: value }));
  }

  function updateVendorForm(key: keyof typeof vendorForm, value: string) {
    setVendorForm((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const response = await fetch("/api/companies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload = await response.json();
      onSaved(payload.company ?? form);
      setSavedAt(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
    } finally {
      setSaving(false);
    }
  }

  async function loadOperationReadiness() {
    setOperationLoading(true);
    try {
      const response = await fetch("/api/operations/readiness", { cache: "no-store" });
      if (response.status === 401) {
        redirectToAccess();
        return;
      }
      const payload = await response.json();
      if (response.ok) setOperationReadiness(payload);
    } finally {
      setOperationLoading(false);
    }
  }

  async function createRule() {
    if (!ruleForm.keyword.trim() || !ruleForm.accountCode) return;
    setSavingRule(true);
    try {
      const response = await fetch("/api/classification-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ruleForm.name.trim() || `${ruleForm.keyword.trim()} 자동 분류`,
          keyword: ruleForm.keyword.trim(),
          accountCode: ruleForm.accountCode,
          sourceType: ruleForm.sourceType || null,
          priority: Number(ruleForm.priority) || 100,
          isActive: true
        })
      });
      const payload = await response.json();
      if (payload.classificationRule) {
        onRulesChanged([payload.classificationRule, ...classificationRules]);
        setRuleForm((current) => ({ ...current, name: "", keyword: "" }));
      }
    } finally {
      setSavingRule(false);
    }
  }

  async function createVendor() {
    if (!vendorForm.name.trim()) return;
    setSavingVendor(true);
    try {
      const response = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: vendorForm.name.trim(),
          businessRegistrationNumber: vendorForm.businessRegistrationNumber.trim() || null,
          defaultAccountId: vendorForm.defaultAccountId || null,
          withholdingType: vendorForm.withholdingType,
          memo: vendorForm.memo.trim() || null
        })
      });
      const payload = await response.json();
      if (payload.vendor) {
        const defaultAccount = accounts.find((account) => account.id === vendorForm.defaultAccountId) ?? null;
        const createdVendor = { ...payload.vendor, defaultAccount: payload.vendor.defaultAccount ?? defaultAccount };
        onVendorsChanged([createdVendor, ...vendors.filter((vendor) => vendor.id !== createdVendor.id)]);
        setVendorForm((current) => ({ ...current, name: "", businessRegistrationNumber: "", memo: "" }));
      }
    } finally {
      setSavingVendor(false);
    }
  }

  async function deleteVendor(vendorId: string) {
    const vendor = vendors.find((item) => item.id === vendorId);
    if (!window.confirm(`${vendor?.name ?? "선택한 거래처"} 기본값을 삭제할까요? 이후 새 거래에는 이 기본값이 적용되지 않습니다.`)) return;

    const previous = vendors;
    onVendorsChanged(vendors.filter((vendor) => vendor.id !== vendorId));
    try {
      const response = await fetch("/api/vendors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vendorId })
      });
      if (!response.ok) onVendorsChanged(previous);
    } catch {
      onVendorsChanged(previous);
    }
  }

  async function toggleRule(rule: AppClassificationRule) {
    const next = { ...rule, isActive: !rule.isActive };
    onRulesChanged(classificationRules.map((item) => (item.id === rule.id ? next : item)));
    try {
      const response = await fetch("/api/classification-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id, isActive: next.isActive })
      });
      const payload = await response.json();
      if (payload.classificationRule) {
        onRulesChanged(classificationRules.map((item) => (item.id === rule.id ? payload.classificationRule : item)));
      }
    } catch {
      onRulesChanged(classificationRules);
    }
  }

  async function deleteRule(ruleId: string) {
    const rule = classificationRules.find((item) => item.id === ruleId);
    if (!window.confirm(`${rule?.name ?? "선택한 자동 분류 규칙"}을 삭제할까요? 이후 CSV 가져오기에는 이 규칙이 적용되지 않습니다.`)) return;

    const previous = classificationRules;
    onRulesChanged(classificationRules.filter((rule) => rule.id !== ruleId));
    try {
      const response = await fetch("/api/classification-rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ruleId })
      });
      if (!response.ok) onRulesChanged(previous);
    } catch {
      onRulesChanged(previous);
    }
  }

  async function deleteCsvTemplate(templateId: string) {
    const template = csvTemplates.find((item) => item.id === templateId);
    if (!window.confirm(`${template?.name ?? "선택한 CSV 매핑 템플릿"}을 삭제할까요? 같은 구조의 CSV를 다시 올리면 매핑을 새로 확인해야 합니다.`)) return;

    const previous = csvTemplates;
    onCsvTemplatesChanged(csvTemplates.filter((item) => item.id !== templateId));
    setDeletingCsvTemplateId(templateId);
    try {
      const response = await fetch("/api/csv-templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: company.id || DEFAULT_COMPANY_ID, id: templateId })
      });
      if (!response.ok) onCsvTemplatesChanged(previous);
    } catch {
      onCsvTemplatesChanged(previous);
    } finally {
      setDeletingCsvTemplateId(null);
    }
  }

  async function downloadWorkspaceBackupJson() {
    setExportingBackup(true);
    try {
      const originalImportFiles = await fetchOriginalImportFiles(importBatches);
      downloadJson(buildWorkspaceBackupFileName("json"), buildCurrentBackupPayload(originalImportFiles));
    } finally {
      setExportingBackup(false);
    }
  }

  async function downloadWorkspaceBackupZip() {
    setExportingBackup(true);
    try {
      const originalImportFiles = await fetchOriginalImportFiles(importBatches);
      downloadWorkspaceBackupArchive(buildWorkspaceBackupFileName("zip"), buildCurrentBackupPayload(originalImportFiles), evidences);
    } finally {
      setExportingBackup(false);
    }
  }

  async function restoreWorkspaceBackup(file?: File | null) {
    if (!file) return;
    if (mode !== "database") {
      setBackupMessage({ tone: "amber", text: "백업 복원은 Postgres DB 모드에서만 실행할 수 있습니다." });
      return;
    }

    setRestoringBackup(true);
    setBackupMessage(null);
    try {
      const backup = JSON.parse(await file.text());
      const dryRunResponse = await fetch("/api/backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup, dryRun: true })
      });
      const dryRunPayload = await dryRunResponse.json();
      if (!dryRunResponse.ok) {
        setBackupMessage({ tone: "red", text: dryRunPayload.message ?? "백업 JSON 형식이 올바르지 않습니다." });
        return;
      }

      const dryRunCounts = dryRunPayload.restoredCounts ?? {};
      const restoreText = [
        "백업 검사 완료",
        `거래 ${formatNumber(dryRunCounts.transactions ?? 0)}건`,
        `증빙 ${formatNumber(dryRunCounts.evidences ?? 0)}건`,
        `분개 ${formatNumber(dryRunCounts.journalEntries ?? 0)}개`,
        `마감 ${formatNumber(dryRunCounts.closingPeriods ?? 0)}개`,
        `원본 CSV ${formatNumber(dryRunCounts.originalImportFiles ?? 0)}개`,
        "현재 DB의 회사 데이터, 거래, 증빙, 분개, 리포트, 마감, 규칙을 백업 파일 내용으로 교체할까요?"
      ].join("\n");
      if (!window.confirm(restoreText)) return;
      const typedConfirmation = window.prompt(`전체 교체를 진행하려면 "${RESTORE_CONFIRMATION_TEXT}"를 입력하세요.`);
      const restoreConfirmation = typedConfirmation?.trim() ?? "";
      if (restoreConfirmation !== RESTORE_CONFIRMATION_TEXT) {
        setBackupMessage({ tone: "amber", text: "확인 문구가 일치하지 않아 백업 복원을 취소했습니다." });
        return;
      }

      const response = await fetch("/api/backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup, confirmReplace: true, restoreConfirmation })
      });
      const payload = await response.json();
      if (!response.ok) {
        setBackupMessage({ tone: "red", text: payload.message ?? "백업 복원에 실패했습니다." });
        return;
      }

      const counts = payload.restoredCounts ?? {};
      setBackupMessage({
        tone: "green",
        text: `복원 완료: 거래 ${formatNumber(counts.transactions ?? 0)}건, 증빙 ${formatNumber(counts.evidences ?? 0)}건, 분개 ${formatNumber(counts.journalEntries ?? 0)}개, 마감 ${formatNumber(counts.closingPeriods ?? 0)}개, 원본 CSV ${formatNumber(counts.originalImportFiles ?? 0)}개`
      });
      await onRestored();
    } catch {
      setBackupMessage({ tone: "red", text: "백업 JSON을 읽거나 복원할 수 없습니다." });
    } finally {
      setRestoringBackup(false);
    }
  }

  return (
    <div className="content">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">필수정보 상태</h2>
            <p className="panel-subtitle">{missingCount > 0 ? `${missingCount}개 항목 입력 필요` : "기본 신고정보 확인 완료"}</p>
          </div>
          <span className={`status ${missingCount > 0 ? "red" : "green"}`}>{missingCount > 0 ? "입력 필요" : "준비됨"}</span>
        </div>
        <div className="panel-body setup-list">
          {setupItems.map((item) => (
            <SetupStatusItem key={item.title} item={item} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">회사 설정</h2>
          <div className="toolbar">
            {savedAt && <span className="status green">{savedAt} 저장</span>}
            <button className="primary-button" onClick={() => void saveSettings()} disabled={saving}>
              {saving ? <Loader2 size={17} className="spin" /> : <CheckCircle2 size={17} />}
              저장
            </button>
          </div>
        </div>
        <div className="panel-body form-grid">
          <div className="field">
            <label>법인명</label>
            <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} />
          </div>
          <div className="field">
            <label>업종</label>
            <input value={form.industry ?? ""} onChange={(event) => updateForm("industry", event.target.value)} />
          </div>
          <div className="field">
            <label>사업자등록번호</label>
            <input
              value={form.businessRegistrationNumber ?? ""}
              onChange={(event) => updateForm("businessRegistrationNumber", event.target.value)}
              placeholder="선택 입력"
            />
          </div>
          <div className="field">
            <label>과세유형</label>
            <select value={form.vatType} onChange={(event) => updateForm("vatType", event.target.value)}>
              <option value="GENERAL">일반과세</option>
              <option value="EXEMPT">면세</option>
              <option value="MIXED">겸영</option>
            </select>
          </div>
          <div className="field">
            <label>결산월</label>
            <select
              value={form.fiscalYearEndMonth}
              onChange={(event) => updateForm("fiscalYearEndMonth", Number(event.target.value))}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                <option key={month} value={month}>
                  {month}월
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>과금 모델</label>
            <select value={form.billingModel} onChange={(event) => updateForm("billingModel", event.target.value as AppCompany["billingModel"])}>
              <option value="INTERNAL_PER_USE">내부 회당 정산</option>
              <option value="SAAS_MONTHLY">SaaS 월 구독</option>
              <option value="SAAS_ANNUAL">SaaS 연 구독</option>
            </select>
          </div>
          <div className="field">
            <label>회당 단가</label>
            <input inputMode="numeric" value={form.perUseUnitPrice} onChange={(event) => updateForm("perUseUnitPrice", numericInputValue(event.target.value))} />
          </div>
          <div className="field">
            <label>월 구독가</label>
            <input inputMode="numeric" value={form.monthlySubscriptionPrice} onChange={(event) => updateForm("monthlySubscriptionPrice", numericInputValue(event.target.value))} />
          </div>
          <div className="field">
            <label>연 구독가</label>
            <input inputMode="numeric" value={form.annualSubscriptionPrice} onChange={(event) => updateForm("annualSubscriptionPrice", numericInputValue(event.target.value))} />
          </div>
          <ToggleField
            label="대표자 급여"
            checked={form.representativeSalaryEnabled}
            onChange={(checked) => updateForm("representativeSalaryEnabled", checked)}
          />
          <ToggleField
            label="직원 급여"
            checked={form.employeePayrollEnabled}
            onChange={(checked) => updateForm("employeePayrollEnabled", checked)}
          />
          <ToggleField
            label="외주 지급"
            checked={form.contractorPaymentEnabled}
            onChange={(checked) => updateForm("contractorPaymentEnabled", checked)}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">CSV 매핑 템플릿</h2>
            <p className="panel-subtitle">반복 업로드에 적용되는 자료 유형별 헤더와 컬럼 매핑 기준</p>
          </div>
          <div className="toolbar">
            <span className="status blue">{formatNumber(csvTemplateRows.length)}개</span>
            <button className="secondary-button" onClick={() => downloadCsv("honzang-csv-mapping-templates.csv", csvTemplateRows)}>
              <Download size={16} />
              템플릿 목록
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>자료</th>
                <th>템플릿</th>
                <th>헤더</th>
                <th>필수 매핑</th>
                <th>금액 매핑</th>
                <th>선택 매핑</th>
                <th>수정</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {csvTemplateRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-cell">저장된 CSV 매핑 템플릿이 없습니다. CSV를 한 번 가져오면 자동 저장됩니다.</td>
                </tr>
              ) : (
                csvTemplateRows.map((row) => (
                  <tr key={row.ID}>
                    <td>{row.자료}</td>
                    <td>{row.템플릿}</td>
                    <td>{row.헤더}</td>
                    <td>{row["필수 매핑"]}</td>
                    <td>{row["금액 매핑"]}</td>
                    <td>{row["선택 매핑"]}</td>
                    <td>{row.수정}</td>
                    <td>
                      <button className="ghost-button" onClick={() => void deleteCsvTemplate(row.ID)} disabled={deletingCsvTemplateId === row.ID}>
                        {deletingCsvTemplateId === row.ID ? "삭제 중" : "삭제"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">운영 준비 점검</h2>
            <p className="panel-subtitle">
              {operationReadiness ? `${operationReadiness.app} ${operationReadiness.version} · ${formatDateTime(operationReadiness.generatedAt)}` : "배포 환경 상태 확인"}
            </p>
          </div>
          <div className="toolbar">
            {operationReadiness && (
              <span className={`status ${operationReadiness.summary.blockers > 0 ? "red" : operationReadiness.summary.warnings > 0 ? "amber" : "green"}`}>
                {operationReadiness.summary.blockers > 0
                  ? `${formatNumber(operationReadiness.summary.blockers)}개 차단`
                  : operationReadiness.summary.warnings > 0
                    ? `${formatNumber(operationReadiness.summary.warnings)}개 확인`
                    : "준비됨"}
              </span>
            )}
            <button className="secondary-button" onClick={() => void loadOperationReadiness()} disabled={operationLoading}>
              {operationLoading ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
              새로고침
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>항목</th>
                <th>상태</th>
                <th>확인</th>
                <th>다음 작업</th>
              </tr>
            </thead>
            <tbody>
              {!operationReadiness ? (
                <tr>
                  <td colSpan={4} className="empty-cell">운영 준비 상태를 불러오는 중입니다.</td>
                </tr>
              ) : (
                operationReadiness.checks.map((check) => (
                  <tr key={check.key}>
                    <td>{check.label}</td>
                    <td><span className={`status ${check.tone}`}>{check.status}</span></td>
                    <td>{check.detail}</td>
                    <td>{check.action}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">데이터 보관/삭제 기준</h2>
            <p className="panel-subtitle">세무자료, 증빙 파일, 감사 로그의 보관 위치와 삭제 경로</p>
          </div>
          <div className="toolbar">
            <span className="status blue">{formatNumber(dataRetentionRows.length)}개 항목</span>
            <button className="secondary-button" onClick={() => downloadCsv("honzang-data-retention-policy.csv", dataRetentionRows)}>
              <Download size={16} />
              보관 기준
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>데이터</th>
                <th>포함정보</th>
                <th>보관위치</th>
                <th>보관기준</th>
                <th>삭제방법</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {dataRetentionRows.map((row) => (
                <tr key={row.데이터}>
                  <td>{row.데이터}</td>
                  <td>{row.포함정보}</td>
                  <td>{row.보관위치}</td>
                  <td>{row.보관기준}</td>
                  <td>{row.삭제방법}</td>
                  <td><span className={`status ${row.톤}`}>{row.상태}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">과금 정책</h2>
            <p className="panel-subtitle">매출 거래 기준 과금 단위 추정</p>
          </div>
          <span className={`status ${billingEstimate.unitPrice > 0 ? "green" : "amber"}`}>{billingEstimate.unitPrice > 0 ? "단가 설정" : "단가 필요"}</span>
        </div>
        <div className="panel-body">
          <div className="review-list">
            <ChecklistItem tone="green" title="모델" value={billingModelLabel(form.billingModel)} />
            <ChecklistItem tone={billingEstimate.unitPrice > 0 ? "green" : "amber"} title="기준 단가" value={billingEstimate.unitPrice > 0 ? formatKRW(billingEstimate.unitPrice) : "미설정"} />
            <ChecklistItem tone="green" title="매출 거래" value={`${formatNumber(billingEstimate.revenueTransactionCount)}건`} />
            <ChecklistItem tone="green" title="매출 공급가액" value={formatKRW(billingEstimate.revenueSupplyAmount)} />
            <ChecklistItem tone={billingEstimate.unitPrice > 0 ? "green" : "amber"} title="추정 단위" value={billingEstimate.unitPrice > 0 ? `${formatBillingUnits(billingEstimate.estimatedUnits)} ${billingEstimate.unitLabel}` : "단가 입력"} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">거래처 기본값</h2>
            <p className="panel-subtitle">반복 거래처의 기본 계정과 원천세 확인 유형</p>
          </div>
          <span className="status blue">{formatNumber(vendors.length)}개</span>
        </div>
        <div className="panel-body form-grid">
          <div className="field">
            <label>거래처명</label>
            <input value={vendorForm.name} onChange={(event) => updateVendorForm("name", event.target.value)} placeholder="예: 김디자인" />
          </div>
          <div className="field">
            <label>사업자등록번호</label>
            <input
              value={vendorForm.businessRegistrationNumber}
              onChange={(event) => updateVendorForm("businessRegistrationNumber", event.target.value)}
              placeholder="선택 입력"
            />
          </div>
          <div className="field">
            <label>기본 계정</label>
            <select value={vendorForm.defaultAccountId} onChange={(event) => updateVendorForm("defaultAccountId", event.target.value)}>
              <option value="">자동 추론</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>원천세 유형</label>
            <select value={vendorForm.withholdingType} onChange={(event) => updateVendorForm("withholdingType", event.target.value)}>
              <option value="NONE">해당 없음</option>
              <option value="TAX_INVOICE">세금계산서 수취</option>
              <option value="BUSINESS_INCOME">사업소득 3.3%</option>
              <option value="OTHER_INCOME">기타소득</option>
              <option value="PAYROLL">급여</option>
            </select>
          </div>
          <div className="field">
            <label>메모</label>
            <input value={vendorForm.memo} onChange={(event) => updateVendorForm("memo", event.target.value)} />
          </div>
          <div className="field">
            <label>작업</label>
            <button className="primary-button" onClick={() => void createVendor()} disabled={savingVendor || !vendorForm.name.trim()}>
              {savingVendor ? <Loader2 size={17} className="spin" /> : <CheckCircle2 size={17} />}
              거래처 추가
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>거래처</th>
                <th>사업자등록번호</th>
                <th>기본 계정</th>
                <th>원천세</th>
                <th>메모</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {vendors.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">아직 거래처 기본값이 없습니다.</td>
                </tr>
              ) : (
                vendors.map((vendor) => (
                  <tr key={vendor.id}>
                    <td>{vendor.name}</td>
                    <td>{vendor.businessRegistrationNumber ?? "-"}</td>
                    <td>{vendor.defaultAccount ? `${vendor.defaultAccount.code} ${vendor.defaultAccount.name}` : "자동 추론"}</td>
                    <td>{withholdingTypeLabel(vendor.withholdingType)}</td>
                    <td>{vendor.memo ?? "-"}</td>
                    <td>
                      <button className="ghost-button" onClick={() => void deleteVendor(vendor.id)}>삭제</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">자동 분류 규칙</h2>
            <p className="panel-subtitle">CSV 가져오기 때 키워드가 포함된 거래의 계정과목을 우선 지정</p>
          </div>
          <span className="status blue">{formatNumber(classificationRules.length)}개</span>
        </div>
        <div className="panel-body form-grid">
          <div className="field">
            <label>규칙명</label>
            <input value={ruleForm.name} onChange={(event) => updateRuleForm("name", event.target.value)} placeholder="예: AWS 비용" />
          </div>
          <div className="field">
            <label>키워드</label>
            <input value={ruleForm.keyword} onChange={(event) => updateRuleForm("keyword", event.target.value)} placeholder="예: aws" />
          </div>
          <div className="field">
            <label>자료 유형</label>
            <select value={ruleForm.sourceType} onChange={(event) => updateRuleForm("sourceType", event.target.value)}>
              <option value="">전체</option>
              {sourceOptions.map((option) => (
                <option key={option} value={option}>
                  {SOURCE_TYPE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>계정과목</label>
            <select value={ruleForm.accountCode} onChange={(event) => updateRuleForm("accountCode", event.target.value)}>
              {accounts.map((account) => (
                <option key={account.id} value={account.code}>
                  {account.code} {account.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>우선순위</label>
            <input inputMode="numeric" value={ruleForm.priority} onChange={(event) => updateRuleForm("priority", event.target.value)} />
          </div>
          <div className="field">
            <label>작업</label>
            <button className="primary-button" onClick={() => void createRule()} disabled={savingRule || !ruleForm.keyword.trim()}>
              {savingRule ? <Loader2 size={17} className="spin" /> : <CheckCircle2 size={17} />}
              규칙 추가
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>상태</th>
                <th>규칙</th>
                <th>키워드</th>
                <th>자료 유형</th>
                <th>계정과목</th>
                <th className="amount">우선순위</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {classificationRules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">아직 자동 분류 규칙이 없습니다.</td>
                </tr>
              ) : (
                classificationRules.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      <span className={`status ${rule.isActive ? "green" : "amber"}`}>{rule.isActive ? "사용" : "중지"}</span>
                    </td>
                    <td>{rule.name}</td>
                    <td>{rule.keyword}</td>
                    <td>{rule.sourceType ? SOURCE_TYPE_LABELS[rule.sourceType] : "전체"}</td>
                    <td>
                      {rule.accountCode} {rule.accountName ?? accounts.find((account) => account.code === rule.accountCode)?.name ?? ""}
                    </td>
                    <td className="amount">{formatNumber(rule.priority)}</td>
                    <td>
                      <div className="toolbar">
                        <button className="ghost-button" onClick={() => void toggleRule(rule)}>
                          {rule.isActive ? "중지" : "사용"}
                        </button>
                        <button className="ghost-button" onClick={() => void deleteRule(rule.id)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">활동 로그</h2>
            <p className="panel-subtitle">가져오기, 거래 수정, 분개, 리포트, 복원 등 주요 변경 이력</p>
          </div>
          <span className="status blue">{formatNumber(auditEvents.length)}개</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>시각</th>
                <th>작업</th>
                <th>대상</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {auditEvents.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-cell">아직 기록된 활동 로그가 없습니다.</td>
                </tr>
              ) : (
                auditEvents.slice(0, 30).map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.createdAt)}</td>
                    <td>{auditActionLabel(event.action)}</td>
                    <td>{auditEntityLabel(event.entityType)}</td>
                    <td>{event.summary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">계정과목</h2>
          <span className="status blue">{formatNumber(accounts.length)}개</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>코드</th>
                <th>계정과목</th>
                <th>유형</th>
                <th>세무 태그</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.code}</td>
                  <td>{account.name}</td>
                  <td>{account.type}</td>
                  <td>{account.taxCategory ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">전체 백업</h2>
            <p className="panel-subtitle">현재 회사 데이터, 거래, 증빙, 분개, 리포트, 마감, 규칙을 파일로 보관</p>
          </div>
          <div className="toolbar">
            <button className="secondary-button" onClick={() => void downloadWorkspaceBackupJson()} disabled={exportingBackup}>
              {exportingBackup ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
              백업 JSON
            </button>
            <button className="secondary-button" onClick={() => void downloadWorkspaceBackupZip()} disabled={exportingBackup}>
              {exportingBackup ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
              백업 ZIP
            </button>
            <button className="secondary-button" onClick={() => restoreInputRef.current?.click()} disabled={mode !== "database" || restoringBackup}>
              {restoringBackup ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
              백업 복원
            </button>
            <input
              ref={restoreInputRef}
              className="hidden-file-input"
              type="file"
              accept="application/json,.json"
              disabled={mode !== "database" || restoringBackup}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void restoreWorkspaceBackup(file);
              }}
            />
          </div>
        </div>
        <div className="panel-body">
          <div className="review-list">
            <ChecklistItem tone="green" title="거래" value={`${formatNumber(transactions.length)}건`} />
            <ChecklistItem tone="green" title="증빙" value={`${formatNumber(evidences.length)}건`} />
            <ChecklistItem tone="green" title="분개" value={`${formatNumber(journalEntries.length)}건`} />
            <ChecklistItem tone="green" title="리포트" value={`${formatNumber(taxReports.length)}개`} />
            <ChecklistItem tone="green" title="마감" value={`${formatNumber(closingPeriods.length)}개`} />
            <ChecklistItem tone="green" title="원본 CSV" value={`${formatNumber(importBatches.filter((batch) => batch.hasOriginalFile).length)}개`} />
          </div>
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>백업 점검</th>
                  <th>상태</th>
                  <th>건수</th>
                  <th>확인</th>
                </tr>
              </thead>
              <tbody>
                {backupReadinessRows.map((row) => (
                  <tr key={row.데이터}>
                    <td>{row.데이터}</td>
                    <td><span className={`status ${row.톤}`}>{row.상태}</span></td>
                    <td>{row.건수}</td>
                    <td>{row.확인}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {backupMessage && <div className={`import-message status ${backupMessage.tone}`}>{backupMessage.text}</div>}
        </div>
      </section>
    </div>
  );
}

type CompanySetupItem = {
  title: string;
  detail: string;
  tone: "green" | "amber" | "red";
  status: string;
};

type DashboardAction = {
  title: string;
  detail: string;
  status: string;
  tone: "green" | "amber" | "red" | "blue";
  target: ViewKey;
  actionLabel: string;
};

function buildInitialOnboardingActions(setupItems: CompanySetupItem[]): DashboardAction[] {
  const missingSetupCount = setupItems.filter((item) => item.tone === "red").length;

  return [
    {
      title: "법인 기본정보 확정",
      detail: missingSetupCount > 0 ? "사업자등록번호, 업종, 급여/외주 지급 여부를 먼저 맞춥니다." : "법인 기본정보와 1인법인 설정이 준비되어 있습니다.",
      status: missingSetupCount > 0 ? `${formatNumber(missingSetupCount)}개 필요` : "완료",
      tone: missingSetupCount > 0 ? "red" : "green",
      target: "settings",
      actionLabel: "설정"
    },
    {
      title: "법인 통장 CSV 업로드",
      detail: "거래일, 적요, 입금, 출금, 잔액 컬럼이 있는 법인 통장 파일을 먼저 반영합니다.",
      status: "1순위",
      tone: "blue",
      target: "imports",
      actionLabel: "업로드"
    },
    {
      title: "카드·홈택스 자료 반영",
      detail: "법인카드, 홈택스 매출·매입, 현금영수증, PG 정산 자료를 같은 기간으로 맞춥니다.",
      status: "보조자료",
      tone: "amber",
      target: "imports",
      actionLabel: "자료"
    },
    {
      title: "CSV에 없는 거래 보완",
      detail: "대표자 입출금, 현금 거래, 조정분처럼 파일에 없는 항목은 수기로 남깁니다.",
      status: "필요 시",
      tone: "blue",
      target: "transactions",
      actionLabel: "입력"
    },
    {
      title: "분개 승인 후 리포트 저장",
      detail: "거래 분류, 증빙 매칭, 자동분개 승인을 끝낸 뒤 신고 패키지와 마감 잠금을 진행합니다.",
      status: "마지막",
      tone: "green",
      target: "reports",
      actionLabel: "리포트"
    }
  ];
}

function buildCompanySetupItems(company: AppCompany): CompanySetupItem[] {
  const missingBasics = [
    hasText(company.name) ? null : "법인명",
    hasText(company.businessRegistrationNumber) ? null : "사업자등록번호",
    hasText(company.industry) ? null : "업종"
  ].filter(Boolean) as string[];
  const payrollTargets = [
    company.representativeSalaryEnabled ? "대표자 급여" : null,
    company.employeePayrollEnabled ? "직원 급여" : null,
    company.contractorPaymentEnabled ? "외주 지급" : null
  ].filter(Boolean) as string[];

  return [
    {
      title: "법인 기본정보",
      detail: missingBasics.length
        ? `${missingBasics.join(", ")} 입력 필요`
        : `${company.name} · ${formatBusinessRegistrationNumber(company.businessRegistrationNumber)} · ${company.industry}`,
      tone: missingBasics.length ? "red" : "green",
      status: missingBasics.length ? "입력 필요" : "완료"
    },
    {
      title: "부가세 신고 기준",
      detail: `${vatTypeLabel(company.vatType)} · 매출/매입세액 분리 기준`,
      tone: company.vatType === "MIXED" ? "amber" : "green",
      status: company.vatType === "MIXED" ? "겸영 검토" : "설정됨"
    },
    {
      title: "법인세 결산",
      detail: `${company.fiscalYearEndMonth}월 결산 · 해당 사업연도 기준`,
      tone: "green",
      status: "설정됨"
    },
    {
      title: "원천세 대상",
      detail: payrollTargets.length ? `${payrollTargets.join(", ")} 관리` : "급여/외주 지급 없음",
      tone: payrollTargets.length ? "amber" : "green",
      status: payrollTargets.length ? "관리 필요" : "미사용"
    },
    {
      title: "매출 과금 방식",
      detail: `${billingModelLabel(company.billingModel)} · ${billingActivePrice(company) > 0 ? formatKRW(billingActivePrice(company)) : "단가 입력 필요"}`,
      tone: billingActivePrice(company) > 0 ? "green" : "amber",
      status: billingActivePrice(company) > 0 ? "설정됨" : "단가 필요"
    }
  ];
}

function buildDashboardActionItems({
  company,
  summary,
  setupItems,
  reviewItems,
  transactions,
  evidences,
  journalEntries,
  taxReports,
  closingPeriods
}: {
  company: AppCompany;
  summary: ReturnType<typeof summarizeTransactions>;
  setupItems: CompanySetupItem[];
  reviewItems: ReviewItem[];
  transactions: AppTransaction[];
  evidences: AppEvidence[];
  journalEntries: AppJournalEntry[];
  taxReports: AppTaxReport[];
  closingPeriods: AppClosingPeriod[];
}) {
  const items: DashboardAction[] = [];
  const missingSetupItems = setupItems.filter((item) => item.tone === "red");
  const latestPeriod = getLatestTransactionPeriod(transactions);
  const evidenceAmountMismatchCount = countEvidenceAmountMismatchReviews(reviewItems);

  if (missingSetupItems.length > 0) {
    items.push({
      title: "법인 기본정보 입력",
      detail: missingSetupItems.map((item) => item.detail).join(" · "),
      status: `${formatNumber(missingSetupItems.length)}개`,
      tone: "red",
      target: "settings",
      actionLabel: "설정"
    });
  } else if (billingActivePrice(company) <= 0) {
    items.push({
      title: "매출 과금 단가 입력",
      detail: `${billingModelLabel(company.billingModel)} 기준 단가가 필요합니다.`,
      status: "단가 필요",
      tone: "amber",
      target: "settings",
      actionLabel: "설정"
    });
  }

  if (transactions.length === 0) {
    items.push({
      title: "거래 CSV 업로드",
      detail: "통장, 카드, 홈택스, PG 정산 자료를 먼저 불러옵니다.",
      status: "시작",
      tone: "blue",
      target: "imports",
      actionLabel: "업로드"
    });
    return items;
  }

  const unclassifiedCount = transactions.filter((transaction) => !getTransactionAccount(transaction)).length;
  if (unclassifiedCount > 0) {
    items.push({
      title: "계정과목 확정",
      detail: "자동 추천이 없거나 아직 확정되지 않은 거래가 있습니다.",
      status: `${formatNumber(unclassifiedCount)}건`,
      tone: "red",
      target: "transactions",
      actionLabel: "분류"
    });
  }

  const unmatchedEvidenceCount = transactions.filter((transaction) => transaction.evidenceStatus === "UNCHECKED" || transaction.evidenceStatus === "MISSING").length;
  if (summary.missingEvidenceAmount > 0 || unmatchedEvidenceCount > 0) {
    items.push({
      title: "증빙 매칭",
      detail: `누락 추정액 ${formatKRW(summary.missingEvidenceAmount)} · 증빙 ${formatNumber(evidences.length)}개 보관 중`,
      status: `${formatNumber(unmatchedEvidenceCount)}건`,
      tone: summary.missingEvidenceAmount > 0 ? "red" : "amber",
      target: "evidences",
      actionLabel: "증빙"
    });
  }

  const approvedTransactionIds = new Set(journalEntries.filter((entry) => entry.status === "APPROVED" && entry.transactionId).map((entry) => entry.transactionId));
  const journalPendingCount = transactions.filter((transaction) => getTransactionAccount(transaction) && !approvedTransactionIds.has(transaction.id)).length;
  if (journalPendingCount > 0) {
    items.push({
      title: "자동분개 승인",
      detail: "확정된 계정과목을 복식부기 분개로 저장합니다.",
      status: `${formatNumber(journalPendingCount)}건`,
      tone: "amber",
      target: "journals",
      actionLabel: "분개"
    });
  }

  if (reviewItems.length > 0) {
    items.push({
      title: "검토함 처리",
      detail:
        evidenceAmountMismatchCount > 0
          ? `증빙 금액 불일치 ${formatNumber(evidenceAmountMismatchCount)}건을 포함한 신고 전 확인 항목입니다.`
          : "대표자 거래, 원천세 후보, 고액 비용 등 신고 전 확인 항목입니다.",
      status: `${formatNumber(reviewItems.length)}건`,
      tone: summary.riskCount > 0 || evidenceAmountMismatchCount > 0 ? "red" : "amber",
      target: "reviews",
      actionLabel: "검토"
    });
  }

  if (latestPeriod && !taxReports.some((report) => report.periodStart.startsWith(latestPeriod) || report.periodEnd.startsWith(latestPeriod))) {
    items.push({
      title: `${formatPeriodLabel(latestPeriod)} 리포트 저장`,
      detail: "월 손익, 부가세, 법인세 준비표를 스냅샷으로 남깁니다.",
      status: "미저장",
      tone: "amber",
      target: "reports",
      actionLabel: "리포트"
    });
  }

  if (latestPeriod && !closingPeriods.some((period) => period.period === latestPeriod)) {
    items.push({
      title: `${formatPeriodLabel(latestPeriod)} 마감 잠금`,
      detail: "수정이 끝난 월을 잠가 신고 기준 데이터를 고정합니다.",
      status: "열림",
      tone: "blue",
      target: "reports",
      actionLabel: "마감"
    });
  }

  if (items.length === 0) {
    items.push({
      title: "신고 패키지 확인",
      detail: "최근 월 장부가 잠겨 있습니다. 홈택스 입력 전 파일을 확인합니다.",
      status: "준비됨",
      tone: "green",
      target: "reports",
      actionLabel: "리포트"
    });
  }

  return items.slice(0, 5);
}

function getLatestTransactionPeriod(transactions: AppTransaction[]) {
  const latestDate = transactions.map((transaction) => transaction.transactionDate).filter(Boolean).sort().at(-1);
  return latestDate ? latestDate.slice(0, 7) : null;
}

function isPwaStandalone() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || Boolean(navigatorWithStandalone.standalone);
}

function numericInputValue(value: string) {
  const normalized = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(normalized) ? normalized : 0;
}

function hasText(value?: string | null) {
  return Boolean(value?.trim());
}

function formatBusinessRegistrationNumber(value?: string | null) {
  if (!value) return "-";
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) return value;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function vatTypeLabel(value: string) {
  const labels: Record<string, string> = {
    GENERAL: "일반과세",
    EXEMPT: "면세",
    MIXED: "겸영"
  };
  return labels[value] ?? value;
}

function billingModelLabel(value: AppCompany["billingModel"]) {
  const labels: Record<AppCompany["billingModel"], string> = {
    INTERNAL_PER_USE: "내부 회당 정산",
    SAAS_MONTHLY: "SaaS 월 구독",
    SAAS_ANNUAL: "SaaS 연 구독"
  };
  return labels[value];
}

function billingActivePrice(company: AppCompany) {
  if (company.billingModel === "SAAS_MONTHLY") return company.monthlySubscriptionPrice;
  if (company.billingModel === "SAAS_ANNUAL") return company.annualSubscriptionPrice;
  return company.perUseUnitPrice;
}

function buildBillingEstimate(company: AppCompany, transactions: AppTransaction[]) {
  const unitPrice = billingActivePrice(company);
  const revenueTransactions = transactions.filter(isBillingRevenueTransaction);
  const revenueSupplyAmount = revenueTransactions.reduce((sum, transaction) => sum + billingSupplyAmount(transaction), 0);
  return {
    unitPrice,
    unitLabel: billingUnitLabel(company.billingModel),
    revenueTransactionCount: revenueTransactions.length,
    revenueSupplyAmount,
    estimatedUnits: unitPrice > 0 ? revenueSupplyAmount / unitPrice : 0
  };
}

function isBillingRevenueTransaction(transaction: AppTransaction) {
  const account = getTransactionAccount(transaction);
  if (transaction.depositAmount <= 0) return false;
  if (account) return account.type === "REVENUE";
  return transaction.sourceType === "HOMETAX_SALES" || transaction.description.includes("구독") || transaction.description.includes("정산");
}

function billingSupplyAmount(transaction: AppTransaction) {
  return transaction.supplyAmount ?? Math.round(transaction.depositAmount / 1.1);
}

function billingUnitLabel(model: AppCompany["billingModel"]) {
  if (model === "SAAS_MONTHLY") return "월 구독분";
  if (model === "SAAS_ANNUAL") return "연 구독분";
  return "회";
}

function formatBillingUnits(value: number) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: value >= 10 ? 1 : 2 }).format(value);
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    COMPANY_UPDATE: "회사 설정",
    IMPORT_CREATE: "CSV 가져오기",
    IMPORT_DELETE: "업로드 삭제",
    TRANSACTION_CREATE: "거래 추가",
    TRANSACTION_UPDATE: "거래 수정",
    EVIDENCE_CREATE: "증빙 추가",
    EVIDENCE_DELETE: "증빙 삭제",
    JOURNAL_CREATE: "분개 저장",
    JOURNAL_STATUS_UPDATE: "분개 상태",
    REPORT_CREATE: "리포트 저장",
    REPORT_DELETE: "리포트 삭제",
    VENDOR_CREATE: "거래처 추가",
    VENDOR_UPDATE: "거래처 수정",
    VENDOR_DELETE: "거래처 삭제",
    CSV_TEMPLATE_DELETE: "CSV 템플릿 삭제",
    CLASSIFICATION_RULE_CREATE: "규칙 추가",
    CLASSIFICATION_RULE_UPDATE: "규칙 수정",
    CLASSIFICATION_RULE_DELETE: "규칙 삭제",
    REVIEW_STATUS_UPDATE: "검토 처리",
    BACKUP_RESTORE: "백업 복원"
  };
  return labels[action] ?? action;
}

function auditEntityLabel(entityType: string) {
  const labels: Record<string, string> = {
    COMPANY: "회사",
    IMPORT_BATCH: "업로드",
    TRANSACTION: "거래",
    EVIDENCE: "증빙",
    JOURNAL_ENTRY: "분개",
    TAX_REPORT: "리포트",
    VENDOR: "거래처",
    CSV_TEMPLATE: "CSV 템플릿",
    CLASSIFICATION_RULE: "자동 분류",
    REVIEW_ITEM: "검토 항목",
    WORKSPACE_BACKUP: "워크스페이스"
  };
  return labels[entityType] ?? entityType;
}

function SetupStatusItem({ item }: { item: CompanySetupItem }) {
  return (
    <div className="setup-item" data-tone={item.tone}>
      <div>
        <strong>{item.title}</strong>
        <span>{item.detail}</span>
      </div>
      <span className={`status ${item.tone}`}>{item.status}</span>
    </div>
  );
}

function InstallPwaButton({ isStandaloneMode, onInstall }: { isStandaloneMode: boolean; onInstall: () => Promise<void> }) {
  return (
    <button
      className="secondary-button"
      disabled={isStandaloneMode}
      onClick={() => void onInstall()}
      title={isStandaloneMode ? "설치형 앱으로 실행 중" : "혼자장부를 설치형 앱으로 열기"}
    >
      <Smartphone size={16} />
      {isStandaloneMode ? "앱 모드" : "앱 설치"}
    </button>
  );
}

function DashboardActionItem({ item, onMove }: { item: DashboardAction; onMove: (view: ViewKey) => void }) {
  return (
    <div className="action-item" data-tone={item.tone}>
      <div className="action-copy">
        <div className="review-row">
          <strong>{item.title}</strong>
          <span className={`status ${item.tone}`}>{item.status}</span>
        </div>
        <span>{item.detail}</span>
      </div>
      <button className="secondary-button" onClick={() => onMove(item.target)}>
        {item.actionLabel}
        <ArrowRight size={15} />
      </button>
    </div>
  );
}

function Kpi({ label, value, foot, icon }: { label: string; value: string; foot: string; icon: React.ReactNode }) {
  return (
    <section className="kpi">
      <div className="kpi-label">
        {icon}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">{foot}</div>
    </section>
  );
}

function ChecklistItem({ title, value, tone }: { title: string; value: string; tone: StatusTone }) {
  return (
    <div className="review-item">
      <div className="review-row">
        <span>{title}</span>
        <span className={`status ${tone}`}>{value}</span>
      </div>
    </div>
  );
}

function TransactionsTable({ transactions, compact = false }: { transactions: AppTransaction[]; compact?: boolean }) {
  return (
    <table>
      <thead>
        <tr>
          <th>일자</th>
          <th>내용</th>
          {!compact && <th>계정</th>}
          <th className="amount">입금</th>
          <th className="amount">출금</th>
          <th>증빙</th>
        </tr>
      </thead>
      <tbody>
        {transactions.length === 0 ? (
          <tr>
            <td colSpan={compact ? 5 : 6} className="empty-cell">아직 거래가 없습니다. 법인 통장 CSV를 업로드하거나 수기 거래를 추가하세요.</td>
          </tr>
        ) : (
          transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td>{formatDate(transaction.transactionDate)}</td>
              <td>
                <strong>{transaction.description}</strong>
                {transaction.counterparty && <div className="muted">{transaction.counterparty}</div>}
              </td>
              {!compact && <td>{transaction.confirmedAccount?.name ?? transaction.suggestedAccount?.name ?? "미분류"}</td>}
              <td className="amount">{transaction.depositAmount ? formatKRW(transaction.depositAmount) : "-"}</td>
              <td className="amount">{transaction.withdrawalAmount ? formatKRW(transaction.withdrawalAmount) : "-"}</td>
              <td>{evidenceBadge(transaction.evidenceStatus)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{checked ? "사용" : "미사용"}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

type EvidenceFormState = {
  evidenceType: string;
  issueDate: string;
  counterparty: string;
  businessRegistrationNumber: string;
  supplyAmount: string;
  vatAmount: string;
  totalAmount: string;
  fileName: string;
  fileDataUrl: string;
  fileMimeType: string;
  fileSize: string;
  transactionId: string;
};

function buildEvidenceMatchCandidates(form: EvidenceFormState, transactions: AppTransaction[]) {
  const evidenceAmount = parseMoney(form.totalAmount) || parseMoney(form.supplyAmount) + parseMoney(form.vatAmount);
  const counterparty = form.counterparty.trim().toLowerCase();
  const issueDate = form.issueDate ? parseIsoDate(form.issueDate) : null;

  return transactions
    .filter((transaction) => transaction.withdrawalAmount > 0 || transaction.depositAmount > 0)
    .map((transaction) => {
      const transactionAmount = transaction.withdrawalAmount || transaction.depositAmount;
      const amountDiff = evidenceAmount ? Math.abs(transactionAmount - evidenceAmount) : Number.POSITIVE_INFINITY;
      const amountScore = evidenceAmount && amountDiff === 0 ? 60 : evidenceAmount && amountDiff <= 10 ? 45 : evidenceAmount && amountDiff <= 1_000 ? 25 : 0;
      const text = `${transaction.description} ${transaction.counterparty ?? ""}`.toLowerCase();
      const transactionCounterparty = transaction.counterparty?.trim().toLowerCase() ?? "";
      const counterpartyScore = counterparty && text.includes(counterparty) ? 25 : counterparty && transactionCounterparty && counterparty.includes(transactionCounterparty) ? 15 : 0;
      const dateDiff = issueDate ? Math.abs(daysBetween(issueDate, parseIsoDate(transaction.transactionDate))) : Number.POSITIVE_INFINITY;
      const dateScore = dateDiff === 0 ? 15 : dateDiff <= 3 ? 10 : dateDiff <= 7 ? 5 : 0;
      const matchedPenalty = transaction.evidenceStatus === "MATCHED" ? -35 : 0;
      const score = amountScore + counterpartyScore + dateScore + matchedPenalty;

      return {
        transaction,
        score,
        reason: amountDiff === 0 ? "금액 일치" : counterpartyScore > 0 ? "거래처 유사" : dateDiff <= 3 ? "일자 근접" : "후보",
        tone: score >= 70 ? ("green" as const) : score >= 35 ? ("amber" as const) : ("blue" as const)
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function mergeTransactions(current: AppTransaction[], incoming: AppTransaction[]) {
  const byId = new Map(current.map((transaction) => [transaction.id, transaction]));
  incoming.forEach((transaction) => {
    byId.set(transaction.id, transaction);
  });
  return [...byId.values()].sort((left, right) => right.transactionDate.localeCompare(left.transactionDate));
}

function mergeImportBatches(current: AppImportBatch[], incoming: AppImportBatch) {
  const byId = new Map(current.map((batch) => [batch.id, batch]));
  byId.set(incoming.id, incoming);
  return [...byId.values()].sort((left, right) => right.importedAt.localeCompare(left.importedAt)).slice(0, 50);
}

function mergeCsvTemplates(current: CsvTemplate[], incoming: CsvTemplate) {
  const byId = new Map(current.map((template) => [template.id, template]));
  byId.set(incoming.id, incoming);
  return [...byId.values()].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

function daysBetween(left: Date, right: Date) {
  return Math.round((left.getTime() - right.getTime()) / 86_400_000);
}

function evidenceBadge(status: EvidenceStatus) {
  const map: Record<EvidenceStatus, { label: string; tone: string }> = {
    UNCHECKED: { label: "미확인", tone: "amber" },
    MISSING: { label: "누락", tone: "red" },
    ATTACHED: { label: "첨부", tone: "blue" },
    MATCHED: { label: "매칭", tone: "green" },
    NOT_REQUIRED: { label: "불필요", tone: "green" }
  };
  const item = map[status];
  return <span className={`status ${item.tone}`}>{item.label}</span>;
}

function buildPeriodOptions(transactions: AppTransaction[]) {
  return [...new Set(transactions.map((transaction) => transaction.transactionDate.slice(0, 7)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a))
    .map((value) => ({ value, label: formatPeriodLabel(value) }));
}

function sortClosingPeriods(closingPeriods: AppClosingPeriod[]) {
  return [...closingPeriods].sort((a, b) => b.period.localeCompare(a.period));
}

function formatPeriodLabel(period: string) {
  if (period === "ALL") return "전체 기간";
  const [year, month] = period.split("-");
  return `${year}년 ${Number(month)}월`;
}

function filterTransactionsByPeriod(transactions: AppTransaction[], period: string) {
  if (period === "ALL") return transactions;
  return transactions.filter((transaction) => transaction.transactionDate.startsWith(period));
}

function filterEvidencesByPeriod(evidences: AppEvidence[], period: string) {
  if (period === "ALL") return evidences;
  return evidences.filter((evidence) => evidence.issueDate?.startsWith(period) ?? false);
}

function filterReviewItemsByPeriod(reviewItems: ReviewItem[], period: string) {
  if (period === "ALL") return reviewItems;
  return reviewItems.filter((item) => item.transaction?.transactionDate.startsWith(period) ?? false);
}

function filterJournalEntriesByPeriod(journalEntries: AppJournalEntry[], period: string) {
  if (period === "ALL") return journalEntries;
  return journalEntries.filter((entry) => entry.entryDate.startsWith(period));
}

function buildReportFileName(name: string, period: string) {
  return `honzang-${period === "ALL" ? "all" : period}-${name}.csv`;
}

function buildReportJsonFileName(name: string, period: string) {
  return `honzang-${period === "ALL" ? "all" : period}-${name}.json`;
}

function buildReportZipFileName(name: string, period: string) {
  return `honzang-${period === "ALL" ? "all" : period}-${name}.zip`;
}

function buildReportXlsxFileName(name: string, period: string) {
  return `honzang-${period === "ALL" ? "all" : period}-${name}.xlsx`;
}

function getReportPeriodRange(period: string, transactions: AppTransaction[]) {
  if (period !== "ALL") {
    const [year, month] = period.split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return { start, end };
  }

  const dates = transactions.map((transaction) => transaction.transactionDate).sort();
  const today = new Date().toISOString().slice(0, 10);
  return { start: dates[0] ?? today, end: dates.at(-1) ?? today };
}

function buildTaxReportPayload({
  period,
  periodLabel,
  summary,
  filingReadinessRows,
  filingScheduleRows,
  submissionGuideRows,
  dataSourceRows,
  filingPackageRows,
  reviewItems,
  withholdingRows,
  journalIntegrityRows,
  corporateTaxRows,
  cashFlowRows,
  bankBalanceRows,
  financialStatementRows,
  ledgerRows,
  transactionCount,
  journalEntryCount
}: {
  period: string;
  periodLabel: string;
  summary: ReturnType<typeof summarizeTransactions>;
  filingReadinessRows: ReturnType<typeof buildFilingReadinessRows>;
  filingScheduleRows: ReturnType<typeof buildFilingScheduleRows>;
  submissionGuideRows: ReturnType<typeof buildFilingSubmissionGuideRows>;
  dataSourceRows: ReturnType<typeof buildDataSourceRows>;
  filingPackageRows: ReturnType<typeof buildFilingPackageRows>;
  reviewItems: ReturnType<typeof buildReviewCsv>;
  withholdingRows: ReturnType<typeof buildWithholdingRows>;
  journalIntegrityRows: JournalIntegrityRow[];
  corporateTaxRows: ReturnType<typeof buildCorporateTaxRows>;
  cashFlowRows: CashFlowRow[];
  bankBalanceRows: BankBalanceCheckRow[];
  financialStatementRows: ReturnType<typeof buildFinancialStatementRows>;
  ledgerRows: ReturnType<typeof buildLedgerRows>;
  transactionCount: number;
  journalEntryCount: number;
}) {
  return {
    period,
    periodLabel,
    summary,
    filingReadinessRows,
    filingScheduleRows,
    submissionGuideRows,
    dataSourceRows,
    filingPackageRows,
    reviewItems,
    withholdingRows,
    journalIntegrityRows,
    corporateTaxRows,
    cashFlowRows,
    bankBalanceRows,
    financialStatementRows,
    ledgerRows,
    transactionCount,
    journalEntryCount
  };
}

function parseTaxReportPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return {};
  const record = payload as {
    summary?: Partial<ReturnType<typeof summarizeTransactions>>;
    transactionCount?: unknown;
  };
  return {
    transactionCount: typeof record.transactionCount === "number" ? record.transactionCount : 0,
    profit: typeof record.summary?.profit === "number" ? record.summary.profit : 0,
    vatPayable: typeof record.summary?.vatPayable === "number" ? record.summary.vatPayable : 0
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStringNumberRecordRows(rows: unknown): Array<Record<string, string | number>> {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const normalized: Record<string, string | number> = {};
    Object.entries(row).forEach(([key, value]) => {
      if (typeof value === "string" || typeof value === "number") normalized[key] = value;
    });
    return [normalized];
  });
}

function parseDetailedTaxReportPayload(payload: unknown) {
  const record = isRecord(payload) ? payload : {};
  const summary = isRecord(record.summary) ? record.summary : {};
  return {
    period: typeof record.period === "string" ? record.period : "",
    periodLabel: typeof record.periodLabel === "string" ? record.periodLabel : "",
    summary: {
      revenue: typeof summary.revenue === "number" ? summary.revenue : 0,
      expense: typeof summary.expense === "number" ? summary.expense : 0,
      profit: typeof summary.profit === "number" ? summary.profit : 0,
      vatOutput: typeof summary.vatOutput === "number" ? summary.vatOutput : 0,
      vatInput: typeof summary.vatInput === "number" ? summary.vatInput : 0,
      vatPayable: typeof summary.vatPayable === "number" ? summary.vatPayable : 0,
      missingEvidenceAmount: typeof summary.missingEvidenceAmount === "number" ? summary.missingEvidenceAmount : 0,
      reviewCount: typeof summary.reviewCount === "number" ? summary.reviewCount : 0,
      riskCount: typeof summary.riskCount === "number" ? summary.riskCount : 0
    },
    filingReadinessRows: parseStringNumberRecordRows(record.filingReadinessRows) as ReturnType<typeof buildFilingReadinessRows>,
    filingScheduleRows: parseStringNumberRecordRows(record.filingScheduleRows) as ReturnType<typeof buildFilingScheduleRows>,
    submissionGuideRows: parseStringNumberRecordRows(record.submissionGuideRows) as ReturnType<typeof buildFilingSubmissionGuideRows>,
    dataSourceRows: parseStringNumberRecordRows(record.dataSourceRows) as ReturnType<typeof buildDataSourceRows>,
    filingPackageRows: parseStringNumberRecordRows(record.filingPackageRows) as ReturnType<typeof buildFilingPackageRows>,
    reviewItems: parseStringNumberRecordRows(record.reviewItems) as ReturnType<typeof buildReviewCsv>,
    withholdingRows: parseStringNumberRecordRows(record.withholdingRows) as ReturnType<typeof buildWithholdingRows>,
    journalIntegrityRows: parseStringNumberRecordRows(record.journalIntegrityRows) as JournalIntegrityRow[],
    corporateTaxRows: parseStringNumberRecordRows(record.corporateTaxRows) as ReturnType<typeof buildCorporateTaxRows>,
    cashFlowRows: parseStringNumberRecordRows(record.cashFlowRows) as CashFlowRow[],
    bankBalanceRows: parseStringNumberRecordRows(record.bankBalanceRows) as BankBalanceCheckRow[],
    financialStatementRows: parseStringNumberRecordRows(record.financialStatementRows) as ReturnType<typeof buildFinancialStatementRows>,
    ledgerRows: parseStringNumberRecordRows(record.ledgerRows),
    transactionCount: typeof record.transactionCount === "number" ? record.transactionCount : 0,
    journalEntryCount: typeof record.journalEntryCount === "number" ? record.journalEntryCount : 0
  };
}

function buildTaxReportDetailRows(taxReport: AppTaxReport, payload: ReturnType<typeof parseDetailedTaxReportPayload>) {
  const evidenceAmountMismatchCount = countEvidenceAmountMismatchReviewRows(payload.reviewItems);
  return [
    { 항목: "기간", 값: `${formatDate(taxReport.periodStart)} - ${formatDate(taxReport.periodEnd)}`, 확인: payload.periodLabel || taxReportTypeLabel(taxReport.reportType) },
    { 항목: "거래", 값: `${formatNumber(payload.transactionCount)}건`, 확인: "저장 당시 기간 필터 기준" },
    { 항목: "승인 분개", 값: `${formatNumber(payload.journalEntryCount)}개`, 확인: "저장 당시 승인 분개 기준" },
    { 항목: "매출 공급가액", 값: formatKRW(payload.summary.revenue), 확인: "부채성 입금 제외" },
    { 항목: "비용 공급가액", 값: formatKRW(payload.summary.expense), 확인: "비용 계정 출금 기준" },
    { 항목: "손익", 값: formatKRW(payload.summary.profit), 확인: payload.summary.profit >= 0 ? "이익" : "손실" },
    { 항목: "예상 부가세", 값: formatKRW(payload.summary.vatPayable), 확인: "확정 전 신고 준비 금액" },
    { 항목: "증빙 누락", 값: formatKRW(payload.summary.missingEvidenceAmount), 확인: `${formatNumber(payload.reviewItems.length)}건 검토` },
    { 항목: "증빙 금액 불일치", 값: `${formatNumber(evidenceAmountMismatchCount)}건`, 확인: "거래금액과 연결 증빙 합계 대조" },
    { 항목: "현금흐름 순증감", 값: formatKRW(buildCashFlowTotals(payload.cashFlowRows).net), 확인: "저장 당시 거래 CSV 입출금 기준" },
    { 항목: "통장 잔액 대조", 값: formatReportAmount(summarizeBankBalanceRows(payload.bankBalanceRows).difference), 확인: summarizeBankBalanceRows(payload.bankBalanceRows).detail },
    { 항목: "재무제표 초안", 값: `${formatNumber(payload.financialStatementRows.length)}행`, 확인: "저장 당시 승인 분개 기준" },
    { 항목: "계정별 원장", 값: `${formatNumber(payload.ledgerRows.length)}행`, 확인: "저장 당시 원장 행 수" }
  ];
}

function taxReportTypeLabel(type: AppTaxReport["reportType"]) {
  const labels: Record<AppTaxReport["reportType"], string> = {
    MONTHLY_PROFIT: "월 손익",
    VAT_PREP: "부가세",
    WITHHOLDING_CHECKLIST: "원천세",
    CORPORATE_TAX_PREP: "법인세 준비",
    RISK_REVIEW: "위험 검토"
  };
  return labels[type];
}

function withholdingTypeLabel(type?: string | null) {
  const labels: Record<string, string> = {
    NONE: "해당 없음",
    TAX_INVOICE: "세금계산서 수취",
    BUSINESS_INCOME: "사업소득 3.3%",
    OTHER_INCOME: "기타소득",
    PAYROLL: "급여"
  };
  return labels[type ?? "NONE"] ?? type ?? "해당 없음";
}

function groupExpensesByAccount(transactions: AppTransaction[]) {
  const grouped = new Map<string, { name: string; amount: number; count: number }>();
  transactions
    .filter((transaction) => transaction.withdrawalAmount > 0)
    .forEach((transaction) => {
      const account = transaction.confirmedAccount ?? transaction.suggestedAccount ?? null;
      if (account && account.type !== "EXPENSE") return;
      const name = account?.name ?? "미분류";
      const current = grouped.get(name) ?? { name, amount: 0, count: 0 };
      current.amount += transaction.withdrawalAmount;
      current.count += 1;
      grouped.set(name, current);
    });
  return [...grouped.values()].sort((a, b) => b.amount - a.amount);
}

function getSavedMapping(sourceType: SourceType, headers: string[], templates: CsvTemplate[]) {
  const signature = headers.join("|");
  const dbTemplate = templates.find((template) => template.sourceType === sourceType && template.headerSignature === signature);
  if (dbTemplate) {
    return {
      mapping: dbTemplate.mapping,
      source: { type: "database", label: dbTemplate.name } satisfies MappingSourceState
    };
  }

  try {
    const raw = window.localStorage.getItem(`honzang:csv-template:${sourceType}:${signature}`);
    return raw
      ? {
          mapping: JSON.parse(raw) as CsvColumnMapping,
          source: { type: "local", label: "브라우저 저장" } satisfies MappingSourceState
        }
      : null;
  } catch {
    return null;
  }
}

function getMappingSourceStatus(
  mappingSource: MappingSourceState | null,
  preview: ImportPreview | null,
  sourceTemplateCount: number
): { value: string; tone: StatusTone } {
  if (!preview) {
    return {
      value: sourceTemplateCount > 0 ? `${formatNumber(sourceTemplateCount)}개 저장` : "파일 선택 후",
      tone: sourceTemplateCount > 0 ? "blue" : "amber"
    };
  }
  if (!mappingSource) return { value: "확인 필요", tone: "amber" };
  if (mappingSource.type === "database") return { value: "DB 적용", tone: "green" };
  if (mappingSource.type === "local") return { value: "로컬 적용", tone: "green" };
  if (mappingSource.type === "edited") return { value: "직접 수정", tone: "blue" };
  return { value: "자동 추론", tone: "amber" };
}

function saveLocalMapping(sourceType: SourceType, headers: string[], mapping: CsvColumnMapping) {
  try {
    window.localStorage.setItem(`honzang:csv-template:${sourceType}:${headers.join("|")}`, JSON.stringify(mapping));
  } catch {
    // Local storage is optional; database persistence still applies when configured.
  }
}

function downloadCsv(fileName: string, rows: Array<Record<string, string | number>>) {
  downloadBlob(fileName, new Blob([toCsvFileContent(rows)], { type: "text/csv;charset=utf-8" }));
}

function downloadJson(fileName: string, payload: unknown) {
  downloadBlob(fileName, new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }));
}

function downloadFilingPackageXlsx(fileName: string, payload: ReturnType<typeof buildFilingPackagePayload>) {
  downloadBlob(fileName, createXlsxBlob(buildFilingWorkbookSheets(payload)));
}

function downloadFilingPackageZip(fileName: string, payload: ReturnType<typeof buildFilingPackagePayload>, evidences: AppEvidence[]) {
  const evidenceFiles = buildEvidenceFileZipEntries(evidences);
  const packageFiles = [
    "filing-package.json",
    "csv/filing-readiness.csv",
    "csv/filing-schedule.csv",
    "csv/submission-guide.csv",
    "csv/data-sources.csv",
    "csv/filing-package.csv",
    "csv/transactions.csv",
    "csv/evidences.csv",
    "csv/vat-report.csv",
    "csv/review-items.csv",
    "csv/withholding-candidates.csv",
    "csv/journal-integrity.csv",
    "csv/corporate-tax-prep.csv",
    "csv/cash-flow.csv",
    "csv/bank-balance-check.csv",
    "csv/financial-statements.csv",
    "csv/ledger.csv"
  ];
  const files: ZipFile[] = [
    {
      path: "manifest.json",
      content: JSON.stringify(
        {
          app: payload.app,
          generatedAt: payload.generatedAt,
          company: payload.company,
          period: payload.period,
          summary: payload.summary,
          files: packageFiles,
          evidenceFiles: evidenceFiles.map((file) => file.path),
          notes: payload.notes
        },
        null,
        2
      )
    },
    { path: "filing-package.json", content: JSON.stringify(payload, null, 2) },
    { path: "csv/filing-readiness.csv", content: toCsvFileContent(payload.filingReadinessRows) },
    { path: "csv/filing-schedule.csv", content: toCsvFileContent(payload.filingScheduleRows) },
    { path: "csv/submission-guide.csv", content: toCsvFileContent(payload.submissionGuideRows) },
    { path: "csv/data-sources.csv", content: toCsvFileContent(payload.dataSourceRows) },
    { path: "csv/filing-package.csv", content: toCsvFileContent(payload.filingPackageRows) },
    { path: "csv/transactions.csv", content: toCsvFileContent(payload.tables.transactions) },
    { path: "csv/evidences.csv", content: toCsvFileContent(payload.tables.evidences) },
    { path: "csv/vat-report.csv", content: toCsvFileContent(payload.tables.vatReport) },
    { path: "csv/review-items.csv", content: toCsvFileContent(payload.tables.reviewItems) },
    { path: "csv/withholding-candidates.csv", content: toCsvFileContent(payload.tables.withholdingCandidates) },
    { path: "csv/journal-integrity.csv", content: toCsvFileContent(payload.tables.journalIntegrity) },
    { path: "csv/corporate-tax-prep.csv", content: toCsvFileContent(payload.tables.corporateTaxPrep) },
    { path: "csv/cash-flow.csv", content: toCsvFileContent(payload.tables.cashFlow) },
    { path: "csv/bank-balance-check.csv", content: toCsvFileContent(payload.tables.bankBalanceCheck) },
    { path: "csv/financial-statements.csv", content: toCsvFileContent(payload.tables.financialStatements) },
    { path: "csv/ledger.csv", content: toCsvFileContent(payload.tables.ledger) },
    ...evidenceFiles
  ];
  downloadBlob(fileName, createZipBlob(files));
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(fileName: string, dataUrl: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("파일을 읽을 수 없습니다.")));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size: number) {
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(size / 1000))}KB`;
}

function toCsv(rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escapeCell = (value: string | number) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(","))].join("\n");
}

function toCsvFileContent(rows: Array<Record<string, string | number>>) {
  return `\uFEFF${toCsv(rows)}`;
}

function buildWorkspaceBackupFileName(extension: "json" | "zip") {
  return `honzang-${new Date().toISOString().slice(0, 10)}-workspace-backup.${extension}`;
}

type OriginalImportFile = {
  importBatchId: string;
  originalFileName: string;
  originalFileHash?: string | null;
  originalFileMimeType?: string | null;
  originalFileSize?: number | null;
  originalFileText: string;
};

function buildCsvTemplateRows(csvTemplates: CsvTemplate[]) {
  return csvTemplates.map((template) => {
    const headers = template.headerSignature?.split("|").filter(Boolean) ?? [];
    const mapping = template.mapping;
    const requiredMapping = [`거래일:${mapping.transactionDate ?? "-"}`, `내용:${mapping.description ?? "-"}`].join(" · ");
    const amountMapping =
      mapping.amount
        ? `금액:${mapping.amount}`
        : mapping.depositAmount || mapping.withdrawalAmount
          ? `입금:${mapping.depositAmount ?? "-"} · 출금:${mapping.withdrawalAmount ?? "-"}`
          : "-";
    const optionalMapping = [
      mapping.counterparty ? `거래처:${mapping.counterparty}` : null,
      mapping.supplyAmount ? `공급가:${mapping.supplyAmount}` : null,
      mapping.vatAmount ? `부가세:${mapping.vatAmount}` : null,
      mapping.balance ? `잔액:${mapping.balance}` : null,
      mapping.approvalNumber ? `승인번호:${mapping.approvalNumber}` : null
    ].filter((item): item is string => Boolean(item));

    return {
      자료: SOURCE_TYPE_LABELS[template.sourceType],
      ID: template.id,
      템플릿: template.name,
      헤더: headers.length > 0 ? `${formatNumber(headers.length)}개 · ${headers.slice(0, 4).join(", ")}${headers.length > 4 ? "..." : ""}` : "-",
      "전체 헤더": headers.join(", ") || "-",
      "필수 매핑": requiredMapping,
      "금액 매핑": amountMapping,
      "선택 매핑": optionalMapping.join(", ") || "-",
      수정: template.updatedAt ? formatDateTime(template.updatedAt) : "-"
    };
  });
}

function buildDataRetentionRows({
  importBatches,
  transactions,
  evidences,
  journalEntries,
  taxReports,
  vendors,
  classificationRules,
  auditEvents,
  closingPeriods,
  csvTemplates,
  reviewItems
}: {
  importBatches: AppImportBatch[];
  transactions: AppTransaction[];
  evidences: AppEvidence[];
  journalEntries: AppJournalEntry[];
  taxReports: AppTaxReport[];
  vendors: AppVendor[];
  classificationRules: AppClassificationRule[];
  auditEvents: AppAuditEvent[];
  closingPeriods: AppClosingPeriod[];
  csvTemplates: CsvTemplate[];
  reviewItems: ReviewItem[];
}): DataRetentionRow[] {
  const originalCsvCount = importBatches.filter((batch) => batch.hasOriginalFile).length;
  const dbEvidenceFileCount = evidences.filter((evidence) => evidence.fileDataUrl).length;
  const externalEvidenceFileCount = evidences.filter((evidence) => !evidence.fileDataUrl && evidence.fileUrl).length;

  return [
    {
      데이터: "원본 CSV",
      포함정보: "은행, 카드, 홈택스, PG 업로드 원본 파일명, 해시, 원문",
      보관위치: "Postgres ImportBatch, 백업 JSON/ZIP imports/original-csv",
      보관기준: "신고 근거 재검증이 필요한 기간 동안 보관",
      삭제방법: "업로드 화면에서 배치 삭제, 전체 교체는 백업 복원",
      상태: originalCsvCount > 0 ? "보관 중" : "대기",
      톤: originalCsvCount > 0 ? "green" : "amber"
    },
    {
      데이터: "거래내역",
      포함정보: "거래일, 거래처, 금액, 계정과목, 증빙 상태, 메모",
      보관위치: "Postgres Transaction, 신고 패키지 CSV/XLSX, 전체 백업",
      보관기준: "장부와 신고 근거가 되는 기간 동안 보관",
      삭제방법: "업로드 배치 삭제 또는 백업 복원으로 교체",
      상태: transactions.length > 0 ? "보관 중" : "대기",
      톤: transactions.length > 0 ? "green" : "amber"
    },
    {
      데이터: "증빙 파일",
      포함정보: "세금계산서, 카드전표, 현금영수증, 인보이스 파일과 금액 메타데이터",
      보관위치: "Postgres Evidence rawPayload, 백업 ZIP evidences",
      보관기준: "세무 증빙 보관 필요 기간 동안 보관",
      삭제방법: "증빙함에서 개별 삭제, 전체 교체는 백업 복원",
      상태: evidences.length === 0 ? "대기" : externalEvidenceFileCount > 0 ? "외부 링크 포함" : "보관 중",
      톤: evidences.length === 0 ? "amber" : externalEvidenceFileCount > 0 ? "amber" : "green"
    },
    {
      데이터: "분개/원장",
      포함정보: "자동분개 초안, 승인 분개, 차변/대변 라인",
      보관위치: "Postgres JournalEntry/JournalLine, 신고 패키지 원장",
      보관기준: "마감 및 재무제표 산출 근거로 보관",
      삭제방법: "거래 재분류 후 분개 재생성, 전체 교체는 백업 복원",
      상태: journalEntries.length > 0 ? "보관 중" : "대기",
      톤: journalEntries.length > 0 ? "green" : "amber"
    },
    {
      데이터: "리포트/마감",
      포함정보: "신고 준비 스냅샷, 월 마감 잠금, 재무제표 초안",
      보관위치: "Postgres TaxReport/ClosingPeriod, 백업 JSON",
      보관기준: "제출 전 확정본과 변경 차단 기준으로 보관",
      삭제방법: "리포트 삭제, 마감 해제 후 수정, 전체 교체는 백업 복원",
      상태: taxReports.length > 0 || closingPeriods.length > 0 ? "보관 중" : "대기",
      톤: taxReports.length > 0 || closingPeriods.length > 0 ? "green" : "amber"
    },
    {
      데이터: "CSV 매핑 템플릿",
      포함정보: "자료 유형, CSV 헤더 시그니처, 거래일/내용/금액/잔액 컬럼 매핑",
      보관위치: "Postgres CsvTemplate, 백업 JSON, 설정 화면 템플릿 목록 CSV",
      보관기준: "같은 구조의 CSV를 반복 업로드하는 동안 보관",
      삭제방법: "설정 화면에서 개별 삭제",
      상태: csvTemplates.length > 0 ? "보관 중" : "대기",
      톤: csvTemplates.length > 0 ? "green" : "amber"
    },
    {
      데이터: "거래처/분류 규칙",
      포함정보: "거래처 기본 계정, 원천세 유형, 자동 분류 키워드",
      보관위치: "Postgres Vendor/ClassificationRule, 백업 JSON",
      보관기준: "반복 거래 자동화 기준으로 사용 중 보관",
      삭제방법: "설정 화면에서 개별 삭제",
      상태: vendors.length > 0 || classificationRules.length > 0 ? "보관 중" : "대기",
      톤: vendors.length > 0 || classificationRules.length > 0 ? "green" : "amber"
    },
    {
      데이터: "검토/감사 로그",
      포함정보: "위험 거래 검토 상태, 주요 변경 이력, 복원 이력",
      보관위치: "Postgres ReviewItem/AuditEvent, 백업 JSON",
      보관기준: "운영 추적과 신고 전 검토 근거로 보관",
      삭제방법: "검토 상태 정리, 전체 교체는 백업 복원",
      상태: reviewItems.length > 0 || auditEvents.length > 0 ? "보관 중" : "대기",
      톤: reviewItems.length > 0 || auditEvents.length > 0 ? "green" : "amber"
    },
    {
      데이터: "백업 파일",
      포함정보: "회사 설정, 거래, 증빙, 원본 CSV, 리포트, 마감, 로그",
      보관위치: "사용자가 내려받은 JSON/ZIP 파일",
      보관기준: "운영 복구 목적의 별도 안전 저장소에 보관",
      삭제방법: "사용자 저장 위치에서 직접 삭제",
      상태: dbEvidenceFileCount > 0 || originalCsvCount > 0 ? "민감정보 포함" : "구조 데이터",
      톤: dbEvidenceFileCount > 0 || originalCsvCount > 0 ? "amber" : "blue"
    }
  ];
}

function buildBackupReadinessRows({
  company,
  accounts,
  importBatches,
  originalImportFiles,
  transactions,
  evidences,
  journalEntries,
  taxReports,
  vendors,
  classificationRules,
  auditEvents,
  closingPeriods,
  reviewItems
}: {
  company: AppCompany;
  accounts: AppAccount[];
  importBatches: AppImportBatch[];
  originalImportFiles?: OriginalImportFile[];
  transactions: AppTransaction[];
  evidences: AppEvidence[];
  journalEntries: AppJournalEntry[];
  taxReports: AppTaxReport[];
  vendors: AppVendor[];
  classificationRules: AppClassificationRule[];
  auditEvents: AppAuditEvent[];
  closingPeriods: AppClosingPeriod[];
  reviewItems: ReviewItem[];
}): BackupReadinessRow[] {
  const sourceBatchesWithFile = importBatches.filter((batch) => batch.hasOriginalFile).length;
  const sourceFilesIncluded = originalImportFiles?.length ?? sourceBatchesWithFile;
  const approvedEntries = journalEntries.filter((entry) => entry.status === "APPROVED").length;
  const dbEvidenceFiles = evidences.filter((evidence) => evidence.fileDataUrl).length;
  const externalEvidenceFiles = evidences.filter((evidence) => !evidence.fileDataUrl && evidence.fileUrl).length;
  const evidenceRecordsWithoutFile = evidences.filter((evidence) => !evidence.fileDataUrl && !evidence.fileUrl).length;
  const missingCompanyBasics = [hasText(company.name), hasText(company.businessRegistrationNumber), accounts.length > 0].filter((item) => !item).length;

  return [
    {
      데이터: "회사/계정",
      상태: missingCompanyBasics === 0 ? "포함" : missingCompanyBasics >= 2 ? "확인 필요" : "부분",
      톤: missingCompanyBasics === 0 ? "green" : missingCompanyBasics >= 2 ? "red" : "amber",
      건수: `계정 ${formatNumber(accounts.length)}개`,
      확인: "법인명, 사업자등록번호, 계정과목 복구 기준"
    },
    {
      데이터: "원본 CSV",
      상태: importBatches.length === 0 ? "대기" : sourceFilesIncluded === importBatches.length ? "포함" : sourceFilesIncluded > 0 ? "부분" : "메타만",
      톤: importBatches.length === 0 ? "amber" : sourceFilesIncluded > 0 ? (sourceFilesIncluded === importBatches.length ? "green" : "amber") : "red",
      건수: `${formatNumber(sourceFilesIncluded)}/${formatNumber(importBatches.length)}개`,
      확인: "은행, 카드, 홈택스 원본 업로드 파일 재검증용"
    },
    {
      데이터: "거래/검토",
      상태: transactions.length > 0 ? "포함" : "확인 필요",
      톤: transactions.length > 0 ? "green" : "red",
      건수: `거래 ${formatNumber(transactions.length)}건 · 검토 ${formatNumber(reviewItems.length)}건`,
      확인: "복원 후 분류, 증빙, 신고 점검을 재현할 기본 데이터"
    },
    {
      데이터: "증빙 파일",
      상태: evidences.length === 0 ? "대기" : evidenceRecordsWithoutFile > 0 ? "확인 필요" : externalEvidenceFiles > 0 ? "외부 링크" : "포함",
      톤: evidences.length === 0 ? "amber" : evidenceRecordsWithoutFile > 0 || externalEvidenceFiles > 0 ? "amber" : "green",
      건수: `DB ${formatNumber(dbEvidenceFiles)}개 · 외부 ${formatNumber(externalEvidenceFiles)}개 · 파일없음 ${formatNumber(evidenceRecordsWithoutFile)}개`,
      확인: "DB 보관 파일은 백업에 포함, 외부 URL은 원본 위치 유지 필요"
    },
    {
      데이터: "분개/리포트",
      상태: journalEntries.length > 0 || taxReports.length > 0 ? "포함" : "대기",
      톤: approvedEntries > 0 || taxReports.length > 0 ? "green" : journalEntries.length > 0 ? "amber" : "amber",
      건수: `분개 ${formatNumber(journalEntries.length)}건 · 승인 ${formatNumber(approvedEntries)}건 · 리포트 ${formatNumber(taxReports.length)}개`,
      확인: "복식부기 원장, 재무제표 초안, 신고 자료 재생성 기준"
    },
    {
      데이터: "월 마감",
      상태: closingPeriods.length > 0 ? "포함" : "미마감",
      톤: closingPeriods.length > 0 ? "green" : "amber",
      건수: `${formatNumber(closingPeriods.length)}개`,
      확인: "복원 후 확정 기간 잠금과 감사 기준 유지"
    },
    {
      데이터: "규칙/감사",
      상태: classificationRules.length > 0 && auditEvents.length > 0 ? "포함" : classificationRules.length > 0 || auditEvents.length > 0 || vendors.length > 0 ? "부분" : "대기",
      톤: classificationRules.length > 0 && auditEvents.length > 0 ? "green" : "amber",
      건수: `거래처 ${formatNumber(vendors.length)}개 · 규칙 ${formatNumber(classificationRules.length)}개 · 로그 ${formatNumber(auditEvents.length)}건`,
      확인: "자동 분류 기준과 주요 작업 이력 복구"
    }
  ];
}

function buildWorkspaceBackupPayload({
  mode,
  company,
  accounts,
  csvTemplates,
  importBatches,
  originalImportFiles,
  transactions,
  evidences,
  journalEntries,
  taxReports,
  vendors,
  classificationRules,
  auditEvents,
  closingPeriods,
  reviewItems
}: {
  mode: "sample" | "database";
  company: AppCompany;
  accounts: AppAccount[];
  csvTemplates: CsvTemplate[];
  importBatches: AppImportBatch[];
  originalImportFiles: OriginalImportFile[];
  transactions: AppTransaction[];
  evidences: AppEvidence[];
  journalEntries: AppJournalEntry[];
  taxReports: AppTaxReport[];
  vendors: AppVendor[];
  classificationRules: AppClassificationRule[];
  auditEvents: AppAuditEvent[];
  closingPeriods: AppClosingPeriod[];
  reviewItems: ReviewItem[];
}) {
  const dataRetentionRows = buildDataRetentionRows({
    importBatches,
    transactions,
    evidences,
    journalEntries,
    taxReports,
    vendors,
    classificationRules,
    auditEvents,
    closingPeriods,
    csvTemplates,
    reviewItems
  });
  const backupReadinessRows = buildBackupReadinessRows({
    company,
    accounts,
    importBatches,
    originalImportFiles,
    transactions,
    evidences,
    journalEntries,
    taxReports,
    vendors,
    classificationRules,
    auditEvents,
    closingPeriods,
    reviewItems
  });

  return {
    app: "혼자장부",
    backupVersion: 1,
    generatedAt: new Date().toISOString(),
    mode,
    counts: {
      accounts: accounts.length,
      csvTemplates: csvTemplates.length,
      importBatches: importBatches.length,
      originalImportFiles: originalImportFiles.length,
      transactions: transactions.length,
      evidences: evidences.length,
      journalEntries: journalEntries.length,
      taxReports: taxReports.length,
      vendors: vendors.length,
      classificationRules: classificationRules.length,
      auditEvents: auditEvents.length,
      closingPeriods: closingPeriods.length,
      reviewItems: reviewItems.length
    },
    dataRetentionRows,
    backupReadinessRows,
    company,
    accounts,
    csvTemplates,
    importBatches,
    originalImportFiles,
    transactions,
    evidences,
    journalEntries,
    taxReports,
    vendors,
    classificationRules,
    auditEvents,
    closingPeriods,
    reviewItems,
    notes: [
      "혼자장부 전체 백업 파일입니다.",
      "민감한 거래처, 금액, 증빙 파일 정보가 포함될 수 있으므로 안전한 위치에 보관하세요.",
      "dataRetentionRows와 csv/data-retention-policy.csv에는 데이터 보관 위치와 삭제 경로가 요약됩니다.",
      "backupReadinessRows와 csv/backup-readiness.csv에는 백업 누락 가능성이 있는 항목이 요약됩니다.",
      "가능한 경우 원본 CSV는 originalImportFiles에 포함되며 ZIP 백업에는 별도 CSV 파일로도 함께 포함됩니다.",
      "DB 보관 증빙 파일은 백업 JSON과 ZIP의 evidences 폴더에 포함됩니다."
    ]
  };
}

function downloadWorkspaceBackupArchive(
  fileName: string,
  payload: ReturnType<typeof buildWorkspaceBackupPayload>,
  evidences: AppEvidence[]
) {
  const importSourceFiles = buildImportSourceZipEntries(payload.originalImportFiles);
  const evidenceFiles = buildEvidenceFileZipEntries(evidences);
  const files: ZipFile[] = [
    {
      path: "manifest.json",
      content: JSON.stringify(
        {
          app: payload.app,
          backupVersion: payload.backupVersion,
          generatedAt: payload.generatedAt,
          company: {
            id: payload.company.id,
            name: payload.company.name,
            businessRegistrationNumber: payload.company.businessRegistrationNumber
          },
          counts: payload.counts,
          dataRetentionRows: payload.dataRetentionRows,
          backupReadinessRows: payload.backupReadinessRows,
          readinessIssues: payload.backupReadinessRows.filter((row) => row.톤 === "red" || row.톤 === "amber").length,
          files: ["workspace-backup.json", "csv/data-retention-policy.csv", "csv/backup-readiness.csv"],
          originalCsvFiles: importSourceFiles.map((file) => file.path),
          evidenceFiles: evidenceFiles.map((file) => file.path),
          notes: payload.notes
        },
        null,
        2
      )
    },
    { path: "workspace-backup.json", content: JSON.stringify(payload, null, 2) },
    { path: "csv/data-retention-policy.csv", content: toCsvFileContent(payload.dataRetentionRows) },
    { path: "csv/backup-readiness.csv", content: toCsvFileContent(payload.backupReadinessRows) },
    ...importSourceFiles,
    ...evidenceFiles
  ];
  downloadBlob(fileName, createZipBlob(files));
}

async function fetchOriginalImportFiles(importBatches: AppImportBatch[]) {
  const originalImportFiles: OriginalImportFile[] = [];

  for (const batch of importBatches) {
    if (!batch.hasOriginalFile) continue;
    try {
      const response = await fetch(`/api/imports?importBatchId=${encodeURIComponent(batch.id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || typeof payload.originalFileText !== "string") continue;
      originalImportFiles.push({
        importBatchId: batch.id,
        originalFileName: payload.originalFileName ?? batch.originalFileName,
        originalFileHash: payload.originalFileHash ?? batch.originalFileHash ?? null,
        originalFileMimeType: payload.originalFileMimeType ?? batch.originalFileMimeType ?? null,
        originalFileSize: payload.originalFileSize ?? batch.originalFileSize ?? payload.originalFileText.length,
        originalFileText: payload.originalFileText
      });
    } catch {
      // Backup still succeeds with the structured data even if one source CSV cannot be fetched.
    }
  }

  return originalImportFiles;
}

function buildImportSourceZipEntries(originalImportFiles: OriginalImportFile[]) {
  const usedPaths = new Set<string>();
  return originalImportFiles.map((file) => {
    const fileName = safeArchiveFileName(file.originalFileName, `${file.importBatchId}.csv`);
    return {
      path: uniqueZipPath(`imports/original-csv/${fileName}`, usedPaths),
      content: file.originalFileText
    };
  });
}

function buildFilingWorkbookSheets(payload: ReturnType<typeof buildFilingPackagePayload>): XlsxSheet[] {
  return [
    { name: "요약", rows: buildFilingSummaryRows(payload) },
    { name: "최종점검", rows: payload.filingReadinessRows },
    { name: "신고일정", rows: payload.filingScheduleRows },
    { name: "제출가이드", rows: payload.submissionGuideRows },
    { name: "자료수집", rows: payload.dataSourceRows },
    { name: "신고패키지", rows: payload.filingPackageRows },
    { name: "거래", rows: payload.tables.transactions },
    { name: "증빙", rows: payload.tables.evidences },
    { name: "부가세", rows: payload.tables.vatReport },
    { name: "검토", rows: payload.tables.reviewItems },
    { name: "원천세", rows: payload.tables.withholdingCandidates },
    { name: "복식검증", rows: payload.tables.journalIntegrity },
    { name: "법인세", rows: payload.tables.corporateTaxPrep },
    { name: "현금흐름", rows: payload.tables.cashFlow },
    { name: "잔액대조", rows: payload.tables.bankBalanceCheck },
    { name: "재무제표", rows: payload.tables.financialStatements },
    { name: "원장", rows: payload.tables.ledger }
  ];
}

function buildFilingSummaryRows(payload: ReturnType<typeof buildFilingPackagePayload>) {
  const evidenceAmountMismatchCount = countEvidenceAmountMismatchReviewRows(payload.tables.reviewItems);
  return [
    { 항목: "앱", 값: payload.app },
    { 항목: "생성일시", 값: payload.generatedAt },
    { 항목: "회사명", 값: payload.company.name ?? "" },
    { 항목: "사업자등록번호", 값: payload.company.businessRegistrationNumber ?? "" },
    { 항목: "업종", 값: payload.company.industry ?? "" },
    { 항목: "기간", 값: payload.period.label },
    { 항목: "기간 시작", 값: payload.period.start },
    { 항목: "기간 종료", 값: payload.period.end },
    { 항목: "신고 차단 항목", 값: payload.filingReadinessRows.filter((row) => row.톤 === "red").length },
    { 항목: "신고 확인 항목", 값: payload.filingReadinessRows.filter((row) => row.톤 === "amber").length },
    { 항목: "복식부기 차단 항목", 값: payload.tables.journalIntegrity.filter((row) => row.톤 === "red").length },
    { 항목: "현금 순증감", 값: buildCashFlowTotals(payload.tables.cashFlow).net },
    { 항목: "통장 잔액 대조", 값: summarizeBankBalanceRows(payload.tables.bankBalanceCheck).status },
    { 항목: "통장 잔액 차이", 값: summarizeBankBalanceRows(payload.tables.bankBalanceCheck).difference },
    { 항목: "제출 가이드 단계", 값: payload.submissionGuideRows.length },
    { 항목: "확인 필요 자료", 값: payload.dataSourceRows.filter((row) => row.상태 === "확인 필요").length },
    { 항목: "매출", 값: payload.summary.revenue },
    { 항목: "비용", 값: payload.summary.expense },
    { 항목: "손익", 값: payload.summary.profit },
    { 항목: "매출 부가세", 값: payload.summary.vatOutput },
    { 항목: "매입 부가세", 값: payload.summary.vatInput },
    { 항목: "예상 납부/환급 부가세", 값: payload.summary.vatPayable },
    { 항목: "증빙 누락 비용", 값: payload.summary.missingEvidenceAmount },
    { 항목: "증빙 금액 불일치", 값: evidenceAmountMismatchCount },
    { 항목: "검토 필요 건수", 값: payload.tables.reviewItems.length },
    { 항목: "위험 거래 건수", 값: payload.summary.riskCount }
  ];
}

function buildEvidenceFileZipEntries(evidences: AppEvidence[]) {
  const usedPaths = new Set<string>();
  const files: ZipFile[] = [];

  evidences.forEach((evidence, index) => {
    if (!evidence.fileDataUrl) return;
    const content = decodeDataUrl(evidence.fileDataUrl);
    if (!content) return;
    const fileName = buildSafeEvidenceFileName(evidence, index);
    const path = uniqueZipPath(`evidences/${fileName}`, usedPaths);
    files.push({ path, content });
  });

  return files;
}

function decodeDataUrl(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) return null;
  const meta = dataUrl.slice(0, commaIndex);
  const data = dataUrl.slice(commaIndex + 1);

  try {
    if (/;base64/i.test(meta)) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(data));
  } catch {
    return null;
  }
}

function buildSafeEvidenceFileName(evidence: AppEvidence, index: number) {
  return safeArchiveFileName(evidence.fileName, `evidence-${index + 1}${extensionFromMimeType(evidence.fileMimeType)}`);
}

function safeArchiveFileName(fileName: string | null | undefined, fallback: string) {
  const rawName = fileName?.split(/[\\/]/).pop()?.trim() || fallback;
  const cleaned = rawName.replace(/[<>:"|?*\u0000-\u001F]/g, "_").replace(/^\.+$/, "");
  return cleaned || fallback;
}

function extensionFromMimeType(mimeType?: string | null) {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "text/plain") return ".txt";
  if (mimeType === "text/csv") return ".csv";
  return "";
}

function uniqueZipPath(path: string, usedPaths: Set<string>) {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const extensionIndex = path.lastIndexOf(".");
  const hasExtension = extensionIndex > path.lastIndexOf("/");
  const base = hasExtension ? path.slice(0, extensionIndex) : path;
  const extension = hasExtension ? path.slice(extensionIndex) : "";
  let index = 2;
  let candidate = `${base}-${index}${extension}`;
  while (usedPaths.has(candidate)) {
    index += 1;
    candidate = `${base}-${index}${extension}`;
  }
  usedPaths.add(candidate);
  return candidate;
}

function buildTransactionCsv(transactions: AppTransaction[]) {
  return transactions.map((transaction) => ({
    거래일: transaction.transactionDate,
    출처: SOURCE_TYPE_LABELS[transaction.sourceType],
    거래처: transaction.counterparty ?? "",
    적요: transaction.description,
    계정과목: transaction.confirmedAccount?.name ?? transaction.suggestedAccount?.name ?? "미분류",
    입금: transaction.depositAmount,
    출금: transaction.withdrawalAmount,
    공급가액: transaction.supplyAmount ?? "",
    부가세: transaction.vatAmount ?? "",
    증빙상태: transaction.evidenceStatus,
    메모: transaction.memo ?? ""
  }));
}

function buildVatCsv(summary: ReturnType<typeof summarizeTransactions>, transactions: AppTransaction[]) {
  const revenueTransactions = transactions.filter(isVatRevenueTransaction);
  const expenseTransactions = transactions.filter(isVatExpenseTransaction);
  const deductibleExpenses = expenseTransactions.filter(isDeductibleVatExpense);
  const heldExpenses = expenseTransactions.filter(isHeldVatExpense);
  const reviewExpenses = expenseTransactions.filter((transaction) => !isDeductibleVatExpense(transaction) && !isHeldVatExpense(transaction));
  const heldVatAmount = heldExpenses.reduce((sum, transaction) => sum + vatInputCandidateAmount(transaction), 0);
  const reviewVatAmount = reviewExpenses.reduce((sum, transaction) => sum + vatEstimatedAmount(transaction), 0);

  const summaryRows = [
    buildVatPrepRow("요약", "과세표준 및 매출세액", summary.revenue, summary.vatOutput, revenueTransactions.length, "과세 매출 합계", "세금계산서, 카드, PG 매출과 입금 매칭 확인"),
    buildVatPrepRow("요약", "매입세액 공제 추정", summary.expense, summary.vatInput, expenseTransactions.length, "매입/비용 합계", "증빙 누락과 불공제 후보 차감 전 추정치"),
    buildVatPrepRow("요약", "공제 보류 후보", heldExpenses.reduce((sum, transaction) => sum + vatSupplyAmount(transaction), 0), heldVatAmount, heldExpenses.length, "증빙 미확인 매입", "증빙 매칭 전에는 공제 반영 보류"),
    buildVatPrepRow("요약", "불공제/검토 후보", reviewExpenses.reduce((sum, transaction) => sum + vatSupplyAmount(transaction), 0), reviewVatAmount, reviewExpenses.length, "해외 SaaS, 불공제 가능 비용", "홈택스 입력 전 공제 가능 여부 확인"),
    buildVatPrepRow("요약", "예상 납부/환급", "", summary.vatPayable, transactions.length, "매출세액 - 매입세액", "확정 신고 전 검토용")
  ];

  const transactionRows = [
    ...revenueTransactions.map((transaction) =>
      buildVatPrepRow("매출 거래", "과세표준 및 매출세액", vatSupplyAmount(transaction), vatOutputCandidateAmount(transaction), 1, vatTransactionLabel(transaction), "매출 자료 원천과 입금 매칭")
    ),
    ...deductibleExpenses.map((transaction) =>
      buildVatPrepRow("매입 공제 후보", "매입세액 공제", vatSupplyAmount(transaction), vatInputCandidateAmount(transaction), 1, vatTransactionLabel(transaction), "적격증빙 확인 후 공제 반영")
    ),
    ...heldExpenses.map((transaction) =>
      buildVatPrepRow("매입 공제 보류", "매입세액 공제 보류", vatSupplyAmount(transaction), vatInputCandidateAmount(transaction), 1, vatTransactionLabel(transaction), "증빙함에서 세금계산서, 카드전표, 현금영수증 매칭 필요")
    ),
    ...reviewExpenses.map((transaction) =>
      buildVatPrepRow("매입 검토 후보", "불공제/공제여부 검토", vatSupplyAmount(transaction), vatEstimatedAmount(transaction), 1, vatTransactionLabel(transaction), vatReviewMemo(transaction))
    )
  ];

  return [...summaryRows, ...transactionRows];
}

function buildVatPrepRow(
  category: string,
  location: string,
  supplyAmount: string | number,
  vatAmount: string | number,
  count: number,
  basis: string,
  review: string
) {
  return {
    구분: category,
    "신고서 입력/확인 위치": location,
    공급가액: supplyAmount,
    세액: vatAmount,
    건수: count,
    "거래/근거": basis,
    검토: review
  };
}

function formatReportAmount(value: string | number) {
  if (typeof value === "number") return formatKRW(value);
  return value || "-";
}

function isVatRevenueTransaction(transaction: AppTransaction) {
  const account = getTransactionAccount(transaction);
  if (transaction.depositAmount <= 0) return false;
  if (account) return account.type === "REVENUE";
  return transaction.sourceType === "HOMETAX_SALES";
}

function isVatExpenseTransaction(transaction: AppTransaction) {
  const account = getTransactionAccount(transaction);
  if (transaction.withdrawalAmount <= 0) return false;
  return account ? account.type === "EXPENSE" : true;
}

function isDeductibleVatExpense(transaction: AppTransaction) {
  return vatInputCandidateAmount(transaction) > 0 && !hasMissingVatEvidence(transaction) && !hasForeignSaasSignal(transaction);
}

function isHeldVatExpense(transaction: AppTransaction) {
  return vatInputCandidateAmount(transaction) > 0 && hasMissingVatEvidence(transaction) && !hasForeignSaasSignal(transaction);
}

function vatGrossAmount(transaction: AppTransaction) {
  return transaction.depositAmount || transaction.withdrawalAmount || 0;
}

function vatSupplyAmount(transaction: AppTransaction) {
  return transaction.supplyAmount ?? Math.round(vatGrossAmount(transaction) / 1.1);
}

function vatEstimatedAmount(transaction: AppTransaction) {
  return transaction.vatAmount ?? Math.round(vatGrossAmount(transaction) - vatSupplyAmount(transaction));
}

function vatOutputCandidateAmount(transaction: AppTransaction) {
  return transaction.vatAmount ?? vatEstimatedAmount(transaction);
}

function vatInputCandidateAmount(transaction: AppTransaction) {
  if (transaction.vatAmount !== null && transaction.vatAmount !== undefined) return transaction.vatAmount;
  const account = getTransactionAccount(transaction);
  if (account?.taxCategory === "VAT_INPUT" && !hasForeignSaasSignal(transaction)) return vatEstimatedAmount(transaction);
  return 0;
}

function hasForeignSaasSignal(transaction: AppTransaction) {
  const text = `${transaction.description} ${transaction.counterparty ?? ""}`.toLowerCase();
  return ["openai", "aws", "github", "vercel", "railway", "stripe"].some((keyword) => text.includes(keyword));
}

function hasMissingVatEvidence(transaction: AppTransaction) {
  return ["UNCHECKED", "MISSING"].includes(transaction.evidenceStatus);
}

function vatTransactionLabel(transaction: AppTransaction) {
  return `${transaction.transactionDate} · ${SOURCE_TYPE_LABELS[transaction.sourceType]} · ${transaction.counterparty ?? "-"} · ${transaction.description}`;
}

function vatReviewMemo(transaction: AppTransaction) {
  if (hasForeignSaasSignal(transaction)) return "해외 SaaS 또는 외화 결제는 영세율/대리납부/불공제 여부 검토";
  if (hasMissingVatEvidence(transaction)) return "증빙 매칭 전 공제 반영 보류";
  const account = getTransactionAccount(transaction);
  if (account?.taxCategory !== "VAT_INPUT") return "계정과목상 매입세액 공제 대상인지 확인";
  return "홈택스 입력 전 공제 가능 여부 확인";
}

function buildReviewCsv(items: ReturnType<typeof buildReviewItems>) {
  return items.map((item) => ({
    심각도: item.severity,
    사유: item.reason,
    거래일: item.transaction?.transactionDate ?? "",
    적요: item.transaction?.description ?? "",
    거래처: item.transaction?.counterparty ?? "",
    금액: item.transaction?.withdrawalAmount || item.transaction?.depositAmount || 0
  }));
}

const EVIDENCE_AMOUNT_MISMATCH_REVIEW_REASON = "연결 증빙 합계가 거래금액과 일치하지 않습니다.";

function countEvidenceAmountMismatchReviews(items: Array<Pick<ReviewItem, "reason">>) {
  return items.filter((item) => isEvidenceAmountMismatchReason(item.reason)).length;
}

function countEvidenceAmountMismatchReviewRows(rows: Array<Record<string, unknown>>) {
  return rows.filter((row) => isEvidenceAmountMismatchReason(row.사유)).length;
}

function isEvidenceAmountMismatchReason(reason: unknown) {
  return typeof reason === "string" && reason.includes(EVIDENCE_AMOUNT_MISMATCH_REVIEW_REASON);
}

function buildEvidenceCsv(evidences: AppEvidence[]) {
  return evidences.map((evidence) => ({
    발행일: evidence.issueDate ?? "",
    유형: evidence.evidenceType,
    거래처: evidence.counterparty ?? "",
    사업자등록번호: evidence.businessRegistrationNumber ?? "",
    매칭거래: evidence.transaction?.description ?? "",
    공급가액: evidence.supplyAmount ?? "",
    부가세: evidence.vatAmount ?? "",
    합계: evidence.totalAmount ?? "",
    파일명: evidence.fileName ?? "",
    파일보관: evidence.fileDataUrl ? "DB 보관" : evidence.fileUrl ? "외부 URL" : "파일 없음",
    파일크기: evidence.fileSize ? formatFileSize(evidence.fileSize) : ""
  }));
}

function buildFilingPackagePayload({
  company,
  period,
  periodLabel,
  periodRange,
  summary,
  transactions,
  evidences,
  reviews,
  filingReadinessRows,
  filingScheduleRows,
  submissionGuideRows,
  dataSourceRows,
  filingPackageRows,
  withholdingRows,
  journalIntegrityRows,
  corporateTaxRows,
  cashFlowRows,
  bankBalanceRows,
  financialStatementRows,
  ledgerRows
}: {
  company: AppCompany;
  period: string;
  periodLabel: string;
  periodRange: { start: string; end: string };
  summary: ReturnType<typeof summarizeTransactions>;
  transactions: AppTransaction[];
  evidences: AppEvidence[];
  reviews: ReturnType<typeof buildReviewItems>;
  filingReadinessRows: ReturnType<typeof buildFilingReadinessRows>;
  filingScheduleRows: ReturnType<typeof buildFilingScheduleRows>;
  submissionGuideRows: ReturnType<typeof buildFilingSubmissionGuideRows>;
  dataSourceRows: ReturnType<typeof buildDataSourceRows>;
  filingPackageRows: ReturnType<typeof buildFilingPackageRows>;
  withholdingRows: ReturnType<typeof buildWithholdingRows>;
  journalIntegrityRows: JournalIntegrityRow[];
  corporateTaxRows: ReturnType<typeof buildCorporateTaxRows>;
  cashFlowRows: CashFlowRow[];
  bankBalanceRows: BankBalanceCheckRow[];
  financialStatementRows: ReturnType<typeof buildFinancialStatementRows>;
  ledgerRows: ReturnType<typeof buildLedgerRows>;
}) {
  return {
    app: "혼자장부",
    generatedAt: new Date().toISOString(),
    company: {
      name: company.name,
      businessRegistrationNumber: company.businessRegistrationNumber,
      industry: company.industry,
      vatType: company.vatType,
      fiscalYearEndMonth: company.fiscalYearEndMonth
    },
    period: {
      value: period,
      label: periodLabel,
      start: periodRange.start,
      end: periodRange.end
    },
    summary,
    filingReadinessRows,
    filingScheduleRows,
    submissionGuideRows,
    dataSourceRows,
    filingPackageRows,
    journalIntegrityRows,
    cashFlowRows,
    bankBalanceRows,
    tables: {
      filingReadiness: filingReadinessRows,
      submissionGuide: submissionGuideRows,
      dataSources: dataSourceRows,
      transactions: buildTransactionCsv(transactions),
      evidences: buildEvidenceCsv(evidences),
      vatReport: buildVatCsv(summary, transactions),
      reviewItems: buildReviewCsv(reviews),
      withholdingCandidates: withholdingRows,
      journalIntegrity: journalIntegrityRows,
      corporateTaxPrep: corporateTaxRows,
      cashFlow: cashFlowRows,
      bankBalanceCheck: bankBalanceRows,
      financialStatements: financialStatementRows,
      ledger: buildLedgerCsv(ledgerRows)
    },
    notes: [
      "혼자장부 신고 패키지는 직접 신고 준비를 돕는 자료입니다.",
      "최종 신고 전 홈택스, 국세청 공지, 세무 전문가 검토가 필요한 항목을 확인하세요."
    ]
  };
}

function getTransactionAccount(transaction: AppTransaction) {
  return transaction.confirmedAccount ?? transaction.suggestedAccount ?? null;
}

function buildCashFlowRows(transactions: AppTransaction[]): CashFlowRow[] {
  const deposits = transactions.filter((transaction) => transaction.depositAmount > 0);
  const withdrawals = transactions.filter((transaction) => transaction.withdrawalAmount > 0);
  const revenueInflows = deposits.filter(isRevenueCashIn);
  const ownerInflows = deposits.filter((transaction) => !revenueInflows.includes(transaction) && isOwnerCashFlow(transaction));
  const otherInflows = deposits.filter((transaction) => !revenueInflows.includes(transaction) && !ownerInflows.includes(transaction));
  const taxOutflows = withdrawals.filter(isTaxCashOut);
  const ownerOutflows = withdrawals.filter((transaction) => !taxOutflows.includes(transaction) && isOwnerCashFlow(transaction));
  const operatingOutflows = withdrawals.filter((transaction) => !taxOutflows.includes(transaction) && !ownerOutflows.includes(transaction) && isOperatingCashOut(transaction));
  const otherOutflows = withdrawals.filter((transaction) => !taxOutflows.includes(transaction) && !ownerOutflows.includes(transaction) && !operatingOutflows.includes(transaction));
  const inflowTotal = sumCashFlowAmount(deposits, "DEPOSIT");
  const outflowTotal = sumCashFlowAmount(withdrawals, "WITHDRAWAL");
  const netCashFlow = inflowTotal - outflowTotal;

  return [
    buildCashFlowRow("현금 유입", "매출/영업 유입", revenueInflows, "DEPOSIT", "매출, PG 정산, 영업 입금", "매출 증빙과 실제 입금 매칭"),
    buildCashFlowRow("현금 유입", "대표자/자본 유입", ownerInflows, "DEPOSIT", "대표자차입금, 자본성 입금", "대표자차입금/자본금 처리 확인"),
    buildCashFlowRow("현금 유입", "기타 유입", otherInflows, "DEPOSIT", "매출·대표자 외 입금", "입금 성격과 계정과목 확인"),
    buildCashFlowRow("현금 유출", "영업 비용 유출", operatingOutflows, "WITHDRAWAL", "비용 계정 출금", "증빙과 손금 가능성 확인"),
    buildCashFlowRow("현금 유출", "세금/공과 유출", taxOutflows, "WITHDRAWAL", "세금과공과, 국세/지방세 키워드", "신고서 납부액과 이체 내역 대조"),
    buildCashFlowRow("현금 유출", "대표자/자본 유출", ownerOutflows, "WITHDRAWAL", "대표자/개인/가지급금 신호", "가지급금, 상환, 개인 사용 여부 확인"),
    buildCashFlowRow("현금 유출", "기타 유출", otherOutflows, "WITHDRAWAL", "비용·세금·대표자 외 출금", "출금 성격과 계정과목 확인"),
    {
      구분: "순현금",
      항목: "순현금증감",
      금액: netCashFlow,
      건수: deposits.length + withdrawals.length,
      톤: netCashFlow >= 0 ? "green" : "amber",
      근거: `유입 ${formatKRW(inflowTotal)} - 유출 ${formatKRW(outflowTotal)}`,
      "다음 확인": "기간 시작/종료 통장 잔액과 순증감 대조"
    }
  ];
}

function buildCashFlowRow(
  category: string,
  item: string,
  transactions: AppTransaction[],
  direction: "DEPOSIT" | "WITHDRAWAL",
  basis: string,
  nextCheck: string
): CashFlowRow {
  const amount = sumCashFlowAmount(transactions, direction);
  return {
    구분: category,
    항목: item,
    금액: amount,
    건수: transactions.length,
    톤: amount > 0 ? "green" : "blue",
    근거: basis,
    "다음 확인": nextCheck
  };
}

function buildCashFlowTotals(rows: CashFlowRow[]) {
  const inflow = rows.filter((row) => row.구분 === "현금 유입").reduce((sum, row) => sum + Number(row.금액 || 0), 0);
  const outflow = rows.filter((row) => row.구분 === "현금 유출").reduce((sum, row) => sum + Number(row.금액 || 0), 0);
  const count = rows
    .filter((row) => row.구분 === "현금 유입" || row.구분 === "현금 유출")
    .reduce((sum, row) => sum + Number(row.건수 || 0), 0);
  return { inflow, outflow, net: inflow - outflow, count };
}

function buildBankBalanceCheckRows(transactions: AppTransaction[], cashFlowTotals: ReturnType<typeof buildCashFlowTotals>): BankBalanceCheckRow[] {
  const bankTransactions = transactions
    .filter((transaction) => transaction.sourceType === "BANK")
    .sort(compareTransactionsForBalanceCheck);
  const bankTransactionsWithBalance = bankTransactions.filter((transaction) => typeof transaction.balance === "number" && Number.isFinite(transaction.balance));
  const bankTransactionNet = sumCashFlowAmount(bankTransactions, "DEPOSIT") - sumCashFlowAmount(bankTransactions, "WITHDRAWAL");

  if (bankTransactions.length === 0) {
    return [
      {
        점검: "법인 통장 CSV",
        상태: "자료 없음",
        톤: "red",
        금액: "-",
        건수: 0,
        근거: "기간 내 통장 거래가 없습니다.",
        "다음 확인": "법인 통장 입출금 CSV를 업로드"
      }
    ];
  }

  const transactionNetRow: BankBalanceCheckRow = {
    점검: "통장 거래 순증감",
    상태: "집계됨",
    톤: "green",
    금액: bankTransactionNet,
    건수: bankTransactions.length,
    근거: `입금 ${formatKRW(sumCashFlowAmount(bankTransactions, "DEPOSIT"))} - 출금 ${formatKRW(sumCashFlowAmount(bankTransactions, "WITHDRAWAL"))}`,
    "다음 확인": "은행 원장 거래 건수와 업로드 건수 대조"
  };

  if (bankTransactionsWithBalance.length === 0) {
    return [
      transactionNetRow,
      {
        점검: "잔액 컬럼",
        상태: "잔액 없음",
        톤: "amber",
        금액: "-",
        건수: 0,
        근거: `통장 ${formatNumber(bankTransactions.length)}건 중 잔액 컬럼 반영 0건`,
        "다음 확인": "은행 CSV에서 거래 후 잔액 컬럼을 포함해 다시 업로드"
      }
    ];
  }

  const first = bankTransactionsWithBalance[0];
  const last = bankTransactionsWithBalance.at(-1) ?? first;
  const openingBalance = Number(first.balance) - first.depositAmount + first.withdrawalAmount;
  const closingBalance = Number(last.balance);
  const balanceNetChange = closingBalance - openingBalance;
  const difference = balanceNetChange - bankTransactionNet;
  const missingBalanceCount = bankTransactions.length - bankTransactionsWithBalance.length;
  const hasDifference = Math.abs(difference) >= 1;
  const hasFullBalanceCoverage = missingBalanceCount === 0;
  const differenceTone: StatusTone = hasDifference ? "red" : hasFullBalanceCoverage ? "green" : "amber";
  const nonBankCashNet = cashFlowTotals.net - bankTransactionNet;

  return [
    transactionNetRow,
    {
      점검: "통장 잔액 순증감",
      상태: hasFullBalanceCoverage ? "대조 가능" : "부분 대조",
      톤: hasFullBalanceCoverage ? "green" : "amber",
      금액: balanceNetChange,
      건수: bankTransactionsWithBalance.length,
      근거: `시작 ${formatKRW(openingBalance)} · 종료 ${formatKRW(closingBalance)} · ${formatDate(first.transactionDate)}-${formatDate(last.transactionDate)}`,
      "다음 확인": hasFullBalanceCoverage ? "통장 거래 순증감과 잔액 순증감 일치 여부 확인" : "잔액 없는 통장 거래가 있는지 확인"
    },
    ...(missingBalanceCount > 0
      ? [
          {
            점검: "잔액 컬럼",
            상태: "부분 반영",
            톤: "amber" as StatusTone,
            금액: "-",
            건수: bankTransactionsWithBalance.length,
            근거: `잔액 있음 ${formatNumber(bankTransactionsWithBalance.length)}건 · 잔액 없음 ${formatNumber(missingBalanceCount)}건`,
            "다음 확인": "잔액 컬럼이 빠진 행을 은행 원본 CSV 기준으로 보완"
          }
        ]
      : []),
    {
      점검: "잔액 대조 차이",
      상태: hasDifference ? "차액" : hasFullBalanceCoverage ? "일치" : "부분 일치",
      톤: differenceTone,
      금액: difference,
      건수: bankTransactions.length,
      근거: `잔액 순증감 ${formatKRW(balanceNetChange)} - 통장 거래 순증감 ${formatKRW(bankTransactionNet)}`,
      "다음 확인": hasDifference ? "중복 업로드, 누락 거래, 날짜 범위, 잔액 정렬 확인" : "월말 잔액과 통장 원장 표본 확인"
    },
    {
      점검: "보조자료 영향",
      상태: nonBankCashNet === 0 ? "없음" : "분리 확인",
      톤: nonBankCashNet === 0 ? "green" : "blue",
      금액: nonBankCashNet,
      건수: cashFlowTotals.count - bankTransactions.length,
      근거: `전체 현금 순증감 ${formatKRW(cashFlowTotals.net)} - 통장 거래 순증감 ${formatKRW(bankTransactionNet)}`,
      "다음 확인": nonBankCashNet === 0 ? "통장 기준으로 현금흐름 확인 가능" : "카드, 홈택스, PG 정산 자료는 결제/정산 시점 차이를 별도 확인"
    }
  ];
}

function summarizeBankBalanceRows(rows: BankBalanceCheckRow[]) {
  const hasRed = rows.some((row) => row.톤 === "red");
  const hasAmber = rows.some((row) => row.톤 === "amber");
  const missingBank = rows.some((row) => row.점검 === "법인 통장 CSV");
  const missingBalance = rows.some((row) => row.점검 === "잔액 컬럼" && row.상태 === "잔액 없음");
  const differenceRow = rows.find((row) => row.점검 === "잔액 대조 차이");
  const bankTransactionRow = rows.find((row) => row.점검 === "통장 거래 순증감");
  const balanceChangeRow = rows.find((row) => row.점검 === "통장 잔액 순증감");
  const tone: StatusTone = hasRed ? "red" : hasAmber ? "amber" : "green";

  return {
    tone,
    status: missingBank ? "자료 없음" : missingBalance ? "잔액 없음" : hasRed ? "차액 발생" : hasAmber ? "부분 대조" : "대조 완료",
    difference: differenceRow?.금액 ?? "-",
    detail: differenceRow?.근거 ?? balanceChangeRow?.근거 ?? bankTransactionRow?.근거 ?? "통장 잔액 대조 없음",
    nextAction:
      tone === "red"
        ? "누락 거래, 중복 업로드, 기간 범위, 잔액 정렬을 확인"
        : tone === "amber"
          ? "잔액 컬럼이 포함된 은행 CSV로 보완"
          : "잔액 차이 없는지 월말 통장 원장과 표본 확인",
    bankTransactionCount: Number(bankTransactionRow?.건수 ?? 0),
    balanceRowCount: Number(balanceChangeRow?.건수 ?? 0)
  };
}

function compareTransactionsForBalanceCheck(a: AppTransaction, b: AppTransaction) {
  const dateOrder = a.transactionDate.localeCompare(b.transactionDate);
  if (dateOrder !== 0) return dateOrder;
  const batchOrder = (a.importBatchId ?? "").localeCompare(b.importBatchId ?? "");
  if (batchOrder !== 0) return batchOrder;
  const rowOrder = (a.sourceRowNumber ?? 0) - (b.sourceRowNumber ?? 0);
  if (rowOrder !== 0) return rowOrder;
  return a.id.localeCompare(b.id);
}

function sumCashFlowAmount(transactions: AppTransaction[], direction: "DEPOSIT" | "WITHDRAWAL") {
  return transactions.reduce((sum, transaction) => sum + (direction === "DEPOSIT" ? transaction.depositAmount : transaction.withdrawalAmount), 0);
}

function isRevenueCashIn(transaction: AppTransaction) {
  const account = getTransactionAccount(transaction);
  const text = cashFlowText(transaction);
  return account?.type === "REVENUE" || transaction.sourceType === "HOMETAX_SALES" || transaction.sourceType === "PG" || text.includes("매출") || text.includes("정산");
}

function isOperatingCashOut(transaction: AppTransaction) {
  const account = getTransactionAccount(transaction);
  return !account || account.type === "EXPENSE";
}

function isTaxCashOut(transaction: AppTransaction) {
  const account = getTransactionAccount(transaction);
  const text = cashFlowText(transaction);
  return account?.code === "509" || ["세금", "국세", "지방세", "부가세", "원천세", "4대보험"].some((keyword) => text.includes(keyword));
}

function isOwnerCashFlow(transaction: AppTransaction) {
  const account = getTransactionAccount(transaction);
  const text = cashFlowText(transaction);
  return account?.taxCategory === "OWNER_RISK" || ["대표", "대표자", "개인", "차입", "가지급"].some((keyword) => text.includes(keyword));
}

function cashFlowText(transaction: AppTransaction) {
  return `${transaction.description} ${transaction.counterparty ?? ""}`.toLowerCase();
}

function buildWithholdingRows(transactions: AppTransaction[]) {
  return transactions
    .filter((transaction) => transaction.withdrawalAmount > 0)
    .map((transaction) => {
      const account = getTransactionAccount(transaction);
      const text = `${transaction.description} ${transaction.counterparty ?? ""}`.toLowerCase();
      const isPayroll = account?.taxCategory === "PAYROLL" || text.includes("급여") || text.includes("상여");
      const isContractor =
        account?.taxCategory === "WITHHOLDING_REVIEW" ||
        text.includes("외주") ||
        text.includes("프리랜서") ||
        text.includes("사업소득") ||
        text.includes("기타소득");

      if (!isPayroll && !isContractor) return null;

      const candidateType = isPayroll ? "급여 후보" : "사업소득/기타소득 후보";
      const estimatedTax = isContractor ? Math.round(transaction.withdrawalAmount * 0.033) : 0;
      const check = isPayroll ? "급여대장, 4대보험, 간이세액표 기준 확인" : "세금계산서 수취 거래인지 3.3% 원천세 대상인지 확인";

      return {
        거래일: transaction.transactionDate,
        거래처: transaction.counterparty ?? "",
        구분: candidateType,
        지급액: transaction.withdrawalAmount,
        "예상 원천세": estimatedTax,
        확인: check
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

function buildCorporateTaxRows(
  summary: ReturnType<typeof summarizeTransactions>,
  transactions: AppTransaction[],
  journalEntries: AppJournalEntry[],
  ledgerRows: ReturnType<typeof buildLedgerRows>,
  financialStatementRows: ReturnType<typeof buildFinancialStatementRows>,
  cashFlowRows: CashFlowRow[],
  bankBalanceRows: BankBalanceCheckRow[]
) {
  const unclassifiedCount = transactions.filter((transaction) => !transaction.confirmedAccount && !transaction.suggestedAccount).length;
  const ownerRiskCount = transactions.filter((transaction) => {
    const account = getTransactionAccount(transaction);
    return account?.taxCategory === "OWNER_RISK" || transaction.reviewReasons?.some((reason) => reason.includes("대표자"));
  }).length;
  const approvedJournalCount = journalEntries.filter((entry) => entry.status === "APPROVED").length;
  const cashFlowTotals = buildCashFlowTotals(cashFlowRows);
  const bankBalanceStatus = summarizeBankBalanceRows(bankBalanceRows);

  return [
    {
      항목: "매출 공급가액",
      값: formatKRW(summary.revenue),
      상태: summary.revenue > 0 ? "집계됨" : "매출 없음",
      확인: "세금계산서, 카드, PG 매출과 입금 매칭 확인"
    },
    {
      항목: "비용 공급가액",
      값: formatKRW(summary.expense),
      상태: summary.expense > 0 ? "집계됨" : "비용 없음",
      확인: "손금 인정 가능성과 적격증빙 확인"
    },
    {
      항목: "월 손익",
      값: formatKRW(summary.profit),
      상태: summary.profit >= 0 ? "이익" : "손실",
      확인: "연말 법인세 전 기간별 손익 누락 확인"
    },
    {
      항목: "증빙 누락 비용",
      값: formatKRW(summary.missingEvidenceAmount),
      상태: summary.missingEvidenceAmount > 0 ? "검토 필요" : "정상",
      확인: "증빙 없는 비용은 손금/부가세 공제 제한 가능성 확인"
    },
    {
      항목: "대표자 거래",
      값: `${formatNumber(ownerRiskCount)}건`,
      상태: ownerRiskCount > 0 ? "검토 필요" : "정상",
      확인: "가지급금, 대표자차입금, 개인 사용 여부 확인"
    },
    {
      항목: "미분류 거래",
      값: `${formatNumber(unclassifiedCount)}건`,
      상태: unclassifiedCount > 0 ? "분류 필요" : "정상",
      확인: "모든 거래에 계정과목 확정"
    },
    {
      항목: "승인 분개",
      값: `${formatNumber(approvedJournalCount)}개`,
      상태: approvedJournalCount > 0 ? "원장 생성 가능" : "승인 필요",
      확인: "자동분개 탭에서 월 마감 전 승인"
    },
    {
      항목: "계정별 원장",
      값: `${formatNumber(ledgerRows.length)}행`,
      상태: ledgerRows.length > 0 ? "생성됨" : "대기",
      확인: "법인세 준비 시 계정별 원장 다운로드"
    },
    {
      항목: "재무제표 초안",
      값: `${formatNumber(financialStatementRows.length)}개 계정`,
      상태: financialStatementRows.length > 0 ? "생성됨" : "대기",
      확인: "자산, 부채, 자본, 손익 초안 검토"
    },
    {
      항목: "현금흐름 순증감",
      값: formatKRW(cashFlowTotals.net),
      상태: cashFlowTotals.count > 0 ? "요약 생성" : "대기",
      확인: "통장 잔액과 현금 순증감 대조"
    },
    {
      항목: "통장 잔액 대조",
      값: formatReportAmount(bankBalanceStatus.difference),
      상태: bankBalanceStatus.status,
      확인: bankBalanceStatus.nextAction
    }
  ];
}

function buildFilingReadinessRows({
  setupItems,
  transactions,
  summary,
  dataSourceRows,
  withholdingRows,
  journalEntries,
  journalIntegrityRows,
  ledgerRows,
  cashFlowRows,
  bankBalanceRows,
  isPeriodClosed,
  canClosePeriod
}: {
  setupItems: CompanySetupItem[];
  transactions: AppTransaction[];
  summary: ReturnType<typeof summarizeTransactions>;
  dataSourceRows: ReturnType<typeof buildDataSourceRows>;
  withholdingRows: ReturnType<typeof buildWithholdingRows>;
  journalEntries: AppJournalEntry[];
  journalIntegrityRows: JournalIntegrityRow[];
  ledgerRows: ReturnType<typeof buildLedgerRows>;
  cashFlowRows: CashFlowRow[];
  bankBalanceRows: BankBalanceCheckRow[];
  isPeriodClosed: boolean;
  canClosePeriod: boolean;
}): FilingReadinessRow[] {
  const missingSetupItems = setupItems.filter((item) => item.tone === "red");
  const warningSetupItems = setupItems.filter((item) => item.tone === "amber");
  const setupTone: StatusTone = missingSetupItems.length > 0 ? "red" : warningSetupItems.length > 0 ? "amber" : "green";
  const setupIssueItems = missingSetupItems.length > 0 ? missingSetupItems : warningSetupItems;
  const totalTransactions = transactions.length;
  const bankSourceMissing = dataSourceRows.some((row) => row.자료 === SOURCE_TYPE_LABELS.BANK && row.상태 === "확인 필요");
  const supportingSourceMissingCount = dataSourceRows.filter((row) => row.자료 !== SOURCE_TYPE_LABELS.BANK && row.상태 === "확인 필요").length;
  const unclassifiedCount = transactions.filter((transaction) => !transaction.confirmedAccount && !transaction.suggestedAccount).length;
  const missingEvidenceCount = transactions.filter((transaction) => transaction.withdrawalAmount > 0 && ["UNCHECKED", "MISSING"].includes(transaction.evidenceStatus)).length;
  const approvedJournalCount = journalEntries.filter((entry) => entry.status === "APPROVED").length;
  const draftJournalCount = journalEntries.filter((entry) => entry.status === "DRAFT").length;
  const sourceTone: StatusTone = totalTransactions === 0 || bankSourceMissing ? "red" : supportingSourceMissingCount > 0 ? "amber" : "green";
  const integrityBlockers = journalIntegrityRows.filter((row) => row.톤 === "red").length;
  const integrityWarnings = journalIntegrityRows.filter((row) => row.톤 === "amber").length;
  const integrityTone: StatusTone = integrityBlockers > 0 ? "red" : integrityWarnings > 0 ? "amber" : "green";
  const cashFlowTotals = buildCashFlowTotals(cashFlowRows);
  const hasCashFlow = cashFlowTotals.count > 0;
  const bankBalanceStatus = summarizeBankBalanceRows(bankBalanceRows);

  return [
    {
      순서: 1,
      점검: "법인 기본정보",
      상태: setupTone === "red" ? "차단" : setupTone === "amber" ? "확인 필요" : "완료",
      톤: setupTone,
      근거: setupIssueItems.length > 0 ? setupIssueItems.map((item) => item.detail).join(" · ") : "법인 기본정보와 1인법인 설정 확인됨",
      "다음 작업":
        setupTone === "red"
          ? "설정에서 사업자등록번호, 업종, 법인 기본값 입력"
          : setupTone === "amber"
            ? "설정에서 겸영, 원천세, 과금 단가 적용 여부 확인"
            : "신고 전 사업자등록증 정보와 대조"
    },
    {
      순서: 2,
      점검: "자료 수집",
      상태: sourceTone === "red" ? "차단" : sourceTone === "amber" ? "확인 필요" : "완료",
      톤: sourceTone,
      근거:
        totalTransactions === 0
          ? "거래 없음"
          : bankSourceMissing
            ? "통장 자료 미반영"
            : supportingSourceMissingCount > 0
              ? `보조 자료 ${formatNumber(supportingSourceMissingCount)}개 확인 필요`
              : "자료 반영됨",
      "다음 작업":
        totalTransactions === 0 || bankSourceMissing
          ? "법인 통장 거래 CSV를 먼저 업로드"
          : supportingSourceMissingCount > 0
            ? "카드, 홈택스, 현금영수증 자료가 해당되는지 확인"
            : "자료별 기간 누락만 최종 확인"
    },
    {
      순서: 3,
      점검: "거래 분류",
      상태: totalTransactions === 0 || unclassifiedCount > 0 ? "차단" : "완료",
      톤: totalTransactions === 0 || unclassifiedCount > 0 ? "red" : "green",
      근거: totalTransactions === 0 ? "거래 없음" : `${formatNumber(unclassifiedCount)} / ${formatNumber(totalTransactions)}건 미분류`,
      "다음 작업": totalTransactions === 0 ? "신고 대상 기간의 거래 CSV 업로드" : unclassifiedCount > 0 ? "거래내역에서 계정과목 확정" : "분류 결과 표본 검토"
    },
    {
      순서: 4,
      점검: "증빙",
      상태: missingEvidenceCount > 0 ? "차단" : "완료",
      톤: missingEvidenceCount > 0 ? "red" : "green",
      근거: `${formatNumber(missingEvidenceCount)}건 · ${formatKRW(summary.missingEvidenceAmount)}`,
      "다음 작업": missingEvidenceCount > 0 ? "카드전표, 세금계산서, 현금영수증 연결" : "증빙 파일 원본 보관 상태 확인"
    },
    {
      순서: 5,
      점검: "부가세",
      상태: summary.vatPayable === 0 ? "완료" : "확인 필요",
      톤: summary.vatPayable === 0 ? "green" : "amber",
      근거: formatKRW(summary.vatPayable),
      "다음 작업": summary.vatPayable >= 0 ? "납부 예상액과 홈택스 입력값 대조" : "환급 예상 사유와 매입세액 공제 가능 여부 확인"
    },
    {
      순서: 6,
      점검: "원천세/대표자",
      상태: withholdingRows.length > 0 || summary.riskCount > 0 ? "확인 필요" : "완료",
      톤: withholdingRows.length > 0 || summary.riskCount > 0 ? "amber" : "green",
      근거: `원천세 ${formatNumber(withholdingRows.length)}건 · 위험 ${formatNumber(summary.riskCount)}건`,
      "다음 작업": withholdingRows.length > 0 || summary.riskCount > 0 ? "급여, 외주비, 대표자 입출금 검토" : "추가 지급 건만 확인"
    },
    {
      순서: 7,
      점검: "자동분개/원장",
      상태: approvedJournalCount > 0 && ledgerRows.length > 0 ? "완료" : draftJournalCount > 0 ? "확인 필요" : "차단",
      톤: approvedJournalCount > 0 && ledgerRows.length > 0 ? "green" : draftJournalCount > 0 ? "amber" : "red",
      근거: `승인 ${formatNumber(approvedJournalCount)}개 · 초안 ${formatNumber(draftJournalCount)}개 · 원장 ${formatNumber(ledgerRows.length)}행`,
      "다음 작업": approvedJournalCount > 0 && ledgerRows.length > 0 ? "원장과 재무제표 초안 검토" : "자동분개 탭에서 초안 승인"
    },
    {
      순서: 8,
      점검: "복식부기 검증",
      상태: integrityTone === "red" ? "차단" : integrityTone === "amber" ? "확인 필요" : "완료",
      톤: integrityTone,
      근거: `차단 ${formatNumber(integrityBlockers)}개 · 확인 ${formatNumber(integrityWarnings)}개`,
      "다음 작업": integrityTone === "green" ? "차변/대변과 회계등식 최종 대조" : "복식부기 검증 표에서 차액과 미생성 항목 확인"
    },
    {
      순서: 9,
      점검: "현금흐름",
      상태: hasCashFlow ? "요약 생성" : "대기",
      톤: hasCashFlow ? "green" : "red",
      근거: `유입 ${formatKRW(cashFlowTotals.inflow)} · 유출 ${formatKRW(cashFlowTotals.outflow)} · 순증감 ${formatKRW(cashFlowTotals.net)}`,
      "다음 작업": hasCashFlow ? "통장 잔액과 현금흐름 순증감 대조" : "법인 통장 거래 CSV 업로드 후 입출금 흐름 확인"
    },
    {
      순서: 10,
      점검: "통장 잔액 대조",
      상태: bankBalanceStatus.status,
      톤: bankBalanceStatus.tone,
      근거: bankBalanceStatus.detail,
      "다음 작업": bankBalanceStatus.nextAction
    },
    {
      순서: 11,
      점검: "월 마감",
      상태: !canClosePeriod ? "전체 기간" : isPeriodClosed ? "완료" : "확인 필요",
      톤: !canClosePeriod ? "blue" : isPeriodClosed ? "green" : "amber",
      근거: !canClosePeriod ? "전체 기간 선택" : isPeriodClosed ? "마감 잠금됨" : "아직 미마감",
      "다음 작업": !canClosePeriod ? "신고 월을 선택해 마감 여부 확인" : isPeriodClosed ? "잠금 후 변경 차단됨" : "스냅샷 저장 후 마감 잠금"
    }
  ];
}

function buildClosingBlockerRows(rows: FilingReadinessRow[]) {
  return rows.filter((row) => row.톤 === "red" && row.점검 !== "월 마감");
}

function buildDataSourceRows(transactions: AppTransaction[]) {
  return sourceOptions.map((sourceType) => {
    const sourceTransactions = transactions.filter((transaction) => transaction.sourceType === sourceType);
    const dates = sourceTransactions.map((transaction) => transaction.transactionDate).filter(Boolean).sort();
    const hasTransactions = sourceTransactions.length > 0;
    const optionalSource = sourceType === "PG";

    return {
      자료: SOURCE_TYPE_LABELS[sourceType],
      상태: hasTransactions ? "반영됨" : optionalSource ? "선택" : "확인 필요",
      톤: hasTransactions ? "green" : optionalSource ? "blue" : "amber",
      거래: `${formatNumber(sourceTransactions.length)}건`,
      기간: hasTransactions ? `${formatDate(dates[0])} - ${formatDate(dates.at(-1) ?? dates[0])}` : "-",
      "다음 확인": hasTransactions ? dataSourceReadyMessage(sourceType) : dataSourceMissingMessage(sourceType)
    };
  });
}

function dataSourceReadyMessage(sourceType: SourceType) {
  switch (sourceType) {
    case "BANK":
      return "입출금 누락 월이 없는지 잔액 흐름 확인";
    case "CARD":
      return "카드전표와 증빙 매칭 확인";
    case "HOMETAX_SALES":
      return "매출 입금과 세금계산서 매칭 확인";
    case "HOMETAX_PURCHASES":
      return "매입세액 공제 가능 여부 확인";
    case "CASH_RECEIPT":
      return "현금영수증/카드 매입 중복 반영 확인";
    case "PG":
      return "정산금액과 실제 입금액 차이 확인";
    case "MANUAL":
      return "수기 입력 거래의 계정과 증빙 확인";
  }
}

function dataSourceMissingMessage(sourceType: SourceType) {
  switch (sourceType) {
    case "BANK":
      return "법인 통장 입출금 CSV를 업로드";
    case "CARD":
      return "법인카드 이용내역 CSV를 업로드";
    case "HOMETAX_SALES":
      return "홈택스 매출 세금계산서 CSV 반영";
    case "HOMETAX_PURCHASES":
      return "홈택스 매입 세금계산서 CSV 반영";
    case "CASH_RECEIPT":
      return "홈택스 현금영수증/카드 매입 자료 확인";
    case "PG":
      return "PG/마켓 정산자료가 있으면 업로드";
    case "MANUAL":
      return "필요한 수기 거래는 거래내역에서 직접 추가";
  }
}

function buildFilingSubmissionGuideRows({
  company,
  summary,
  dataSourceRows,
  filingReadinessRows,
  filingScheduleRows,
  withholdingRows,
  ledgerRows,
  financialStatementRows,
  cashFlowRows,
  bankBalanceRows,
  isPeriodClosed,
  canClosePeriod
}: {
  company: AppCompany;
  summary: ReturnType<typeof summarizeTransactions>;
  dataSourceRows: ReturnType<typeof buildDataSourceRows>;
  filingReadinessRows: ReturnType<typeof buildFilingReadinessRows>;
  filingScheduleRows: ReturnType<typeof buildFilingScheduleRows>;
  withholdingRows: ReturnType<typeof buildWithholdingRows>;
  ledgerRows: ReturnType<typeof buildLedgerRows>;
  financialStatementRows: ReturnType<typeof buildFinancialStatementRows>;
  cashFlowRows: CashFlowRow[];
  bankBalanceRows: BankBalanceCheckRow[];
  isPeriodClosed: boolean;
  canClosePeriod: boolean;
}): FilingSubmissionGuideRow[] {
  const setupReadiness = filingReadinessRows.find((row) => row.점검 === "법인 기본정보");
  const sourceReadiness = filingReadinessRows.find((row) => row.점검 === "자료 수집");
  const classificationReadiness = filingReadinessRows.find((row) => row.점검 === "거래 분류");
  const evidenceReadiness = filingReadinessRows.find((row) => row.점검 === "증빙");
  const journalReadiness = filingReadinessRows.find((row) => row.점검 === "자동분개/원장");
  const dataMissingCount = dataSourceRows.filter((row) => row.상태 === "확인 필요").length;
  const payrollEnabled = company.representativeSalaryEnabled || company.employeePayrollEnabled || company.contractorPaymentEnabled;
  const vatSchedule = filingScheduleRows.find((row) => row.신고.includes("부가세"));
  const withholdingSchedule = filingScheduleRows.find((row) => row.신고.includes("원천세"));
  const corporateSchedule = filingScheduleRows.find((row) => row.신고.includes("법인세"));
  const vatTone: StatusTone = sourceReadiness?.톤 === "red" ? "red" : summary.missingEvidenceAmount > 0 || dataMissingCount > 0 ? "amber" : "green";
  const withholdingTone: StatusTone = withholdingRows.length > 0 ? "amber" : payrollEnabled ? "green" : "blue";
  const corporateTone: StatusTone = ledgerRows.length > 0 && financialStatementRows.length > 0 ? "green" : journalReadiness?.톤 === "red" ? "red" : "amber";
  const closeTone: StatusTone = !canClosePeriod ? "blue" : isPeriodClosed ? "green" : "amber";
  const cashFlowTotals = buildCashFlowTotals(cashFlowRows);
  const bankBalanceStatus = summarizeBankBalanceRows(bankBalanceRows);

  return [
    {
      순서: 1,
      신고: "기본정보",
      "홈택스/제출 위치": "사업자등록증, 법인 기본정보",
      "혼자장부에서 볼 것": "설정, 최종 신고 점검",
      상태: setupReadiness?.상태 ?? "확인 필요",
      톤: setupReadiness?.톤 ?? "amber",
      "입력 기준": `${company.name} · ${formatBusinessRegistrationNumber(company.businessRegistrationNumber)} · ${company.industry || "업종 미입력"} · ${vatTypeLabel(company.vatType)}`,
      "마감 전 확인": setupReadiness?.["다음 작업"] ?? "사업자등록번호, 업종, 과세유형, 결산월 확인"
    },
    {
      순서: 2,
      신고: "자료 확정",
      "홈택스/제출 위치": "은행, 카드, 홈택스, PG 자료 조회",
      "혼자장부에서 볼 것": "자료 수집 현황, 최종 신고 점검",
      상태: sourceReadiness?.상태 ?? "확인 필요",
      톤: sourceReadiness?.톤 ?? "amber",
      "입력 기준": `확인 필요 자료 ${formatNumber(dataMissingCount)}개`,
      "마감 전 확인": sourceReadiness?.["다음 작업"] ?? "신고 대상 기간 자료 업로드"
    },
    {
      순서: 3,
      신고: "부가세",
      "홈택스/제출 위치": "부가가치세 신고서",
      "혼자장부에서 볼 것": "부가세 입력 전 정리표, 증빙함",
      상태: vatTone === "red" ? "차단" : vatTone === "amber" ? "대조 필요" : "입력 가능",
      톤: vatTone,
      "입력 기준": `매출세액 ${formatKRW(summary.vatOutput)} · 매입세액 ${formatKRW(summary.vatInput)} · 예상 ${formatKRW(summary.vatPayable)}`,
      "마감 전 확인": vatSchedule ? `${vatSchedule["예상 기한"]} 전 ${vatSchedule["다음 작업"]}` : "매출/매입세액과 공제 보류 후보 대조"
    },
    {
      순서: 4,
      신고: "원천세",
      "홈택스/제출 위치": "원천세 신고/납부",
      "혼자장부에서 볼 것": "원천세 후보, 대표자/급여 설정",
      상태: withholdingRows.length > 0 ? "후보 확인" : payrollEnabled ? "대상 없음" : "설정 선택",
      톤: withholdingTone,
      "입력 기준": `원천세 후보 ${formatNumber(withholdingRows.length)}건`,
      "마감 전 확인": withholdingSchedule ? `${withholdingSchedule["예상 기한"]} 전 ${withholdingSchedule["다음 작업"]}` : "급여, 외주비, 기타소득 지급 여부 확인"
    },
    {
      순서: 5,
      신고: "법인세",
      "홈택스/제출 위치": "법인세 신고, 재무제표 입력",
      "혼자장부에서 볼 것": "법인세 결산 체크, 재무제표 초안, 계정별 원장, 현금흐름 요약, 통장 잔액 대조",
      상태: corporateTone === "red" || bankBalanceStatus.tone === "red" ? "차단" : corporateTone === "green" ? "준비 가능" : "원장 대기",
      톤: corporateTone === "red" || bankBalanceStatus.tone === "red" ? "red" : corporateTone,
      "입력 기준": `원장 ${formatNumber(ledgerRows.length)}행 · 재무제표 ${formatNumber(financialStatementRows.length)}개 계정 · 현금 순증감 ${formatKRW(cashFlowTotals.net)} · 잔액 차이 ${formatReportAmount(bankBalanceStatus.difference)}`,
      "마감 전 확인": bankBalanceStatus.tone === "red" ? bankBalanceStatus.nextAction : corporateSchedule ? `${corporateSchedule["예상 기한"]} 전 ${corporateSchedule["다음 작업"]}` : "승인 분개 기준 재무제표와 원장 확인"
    },
    {
      순서: 6,
      신고: "증빙 보관",
      "홈택스/제출 위치": "신고 근거자료 보관",
      "혼자장부에서 볼 것": "증빙함, 신고 패키지 ZIP",
      상태: evidenceReadiness?.톤 === "red" ? "차단" : "보관 가능",
      톤: evidenceReadiness?.톤 === "red" ? "red" : "green",
      "입력 기준": `증빙 누락 ${formatKRW(summary.missingEvidenceAmount)} · 검토 ${formatNumber(summary.reviewCount)}건`,
      "마감 전 확인": evidenceReadiness?.["다음 작업"] ?? "세금계산서, 카드전표, 현금영수증 원본 보관"
    },
    {
      순서: 7,
      신고: "마감/보관",
      "홈택스/제출 위치": "제출 전 내부 확정",
      "혼자장부에서 볼 것": "스냅샷 저장, 마감 잠금, XLSX/ZIP 패키지",
      상태: !canClosePeriod ? "기간 선택" : isPeriodClosed ? "마감됨" : "마감 필요",
      톤: closeTone,
      "입력 기준": `분류 ${classificationReadiness?.상태 ?? "-"} · 분개 ${journalReadiness?.상태 ?? "-"}`,
      "마감 전 확인": isPeriodClosed ? "잠금 후 변경 차단됨" : "스냅샷 저장 후 마감 잠금"
    }
  ];
}

function buildFilingPackageRows(
  summary: ReturnType<typeof summarizeTransactions>,
  transactions: AppTransaction[],
  journalEntries: AppJournalEntry[],
  ledgerRows: ReturnType<typeof buildLedgerRows>,
  withholdingRows: ReturnType<typeof buildWithholdingRows>,
  financialStatementRows: ReturnType<typeof buildFinancialStatementRows>,
  cashFlowRows: CashFlowRow[],
  bankBalanceRows: BankBalanceCheckRow[]
) {
  const classifiedCount = transactions.filter((transaction) => transaction.confirmedAccount || transaction.suggestedAccount).length;
  const missingEvidenceCount = transactions.filter((transaction) => transaction.withdrawalAmount > 0 && ["UNCHECKED", "MISSING"].includes(transaction.evidenceStatus)).length;
  const approvedJournalCount = journalEntries.filter((entry) => entry.status === "APPROVED").length;
  const totalTransactions = transactions.length;
  const cashFlowTotals = buildCashFlowTotals(cashFlowRows);
  const bankBalanceStatus = summarizeBankBalanceRows(bankBalanceRows);

  return [
    {
      구분: "거래 분류",
      상태: classifiedCount === totalTransactions ? "완료" : "진행",
      톤: classifiedCount === totalTransactions ? "green" : "amber",
      "금액/건수": `${formatNumber(classifiedCount)} / ${formatNumber(totalTransactions)}건`,
      "다음 확인": "미분류 거래는 거래내역에서 계정과목 확정"
    },
    {
      구분: "증빙",
      상태: missingEvidenceCount > 0 ? "누락" : "정상",
      톤: missingEvidenceCount > 0 ? "red" : "green",
      "금액/건수": formatKRW(summary.missingEvidenceAmount),
      "다음 확인": "카드전표, 세금계산서, 현금영수증 매칭"
    },
    {
      구분: "부가세",
      상태: summary.vatPayable >= 0 ? "납부 예상" : "환급 예상",
      톤: summary.missingEvidenceAmount > 0 ? "amber" : "green",
      "금액/건수": formatKRW(summary.vatPayable),
      "다음 확인": "매출세액, 매입세액, 불공제 후보 확인"
    },
    {
      구분: "원천세",
      상태: withholdingRows.length > 0 ? "후보 있음" : "대상 없음",
      톤: withholdingRows.length > 0 ? "amber" : "green",
      "금액/건수": `${formatNumber(withholdingRows.length)}건`,
      "다음 확인": "급여, 외주비, 기타소득 지급 여부 확인"
    },
    {
      구분: "자동분개",
      상태: approvedJournalCount > 0 ? "승인 있음" : "승인 필요",
      톤: approvedJournalCount > 0 ? "green" : "amber",
      "금액/건수": `${formatNumber(approvedJournalCount)}개`,
      "다음 확인": "월 마감 전 자동분개 초안 승인"
    },
    {
      구분: "법인세",
      상태: ledgerRows.length > 0 ? "원장 있음" : "원장 대기",
      톤: ledgerRows.length > 0 ? "green" : "amber",
      "금액/건수": `${formatNumber(ledgerRows.length)}행`,
      "다음 확인": "계정별 원장, 증빙 누락, 대표자 거래 검토"
    },
    {
      구분: "재무제표",
      상태: financialStatementRows.length > 0 ? "초안 있음" : "초안 대기",
      톤: financialStatementRows.length > 0 ? "green" : "amber",
      "금액/건수": `${formatNumber(financialStatementRows.length)}개 계정`,
      "다음 확인": "재무상태표 자산/부채/자본과 손익계산서 수익/비용 확인"
    },
    {
      구분: "현금흐름",
      상태: cashFlowTotals.count > 0 ? "요약 있음" : "대기",
      톤: cashFlowTotals.count > 0 ? "green" : "amber",
      "금액/건수": formatKRW(cashFlowTotals.net),
      "다음 확인": "통장 잔액과 현금 순증감 대조"
    },
    {
      구분: "통장 잔액",
      상태: bankBalanceStatus.status,
      톤: bankBalanceStatus.tone,
      "금액/건수": formatReportAmount(bankBalanceStatus.difference),
      "다음 확인": bankBalanceStatus.nextAction
    }
  ];
}

function buildFilingScheduleRows(
  company: AppCompany,
  periodRange: { start: string; end: string },
  summary: ReturnType<typeof summarizeTransactions>,
  withholdingRows: ReturnType<typeof buildWithholdingRows>,
  ledgerRows: ReturnType<typeof buildLedgerRows>
) {
  const periodEnd = parseIsoDate(periodRange.end);
  const periodMonth = periodEnd.getUTCMonth() + 1;
  const periodYear = periodEnd.getUTCFullYear();
  const periodLabel = `${formatDate(periodRange.start)} - ${formatDate(periodRange.end)}`;
  const vatDueDate = periodMonth <= 6 ? new Date(Date.UTC(periodYear, 6, 25)) : new Date(Date.UTC(periodYear + 1, 0, 25));
  const vatHalfLabel = `${periodYear}년 ${periodMonth <= 6 ? "1기" : "2기"}`;
  const withholdingDueDate = new Date(Date.UTC(periodYear, periodEnd.getUTCMonth() + 1, 10));
  const evidenceDueDate = endOfMonth(periodYear, periodEnd.getUTCMonth());
  const fiscalYearEndDate = getFiscalYearEndDate(periodEnd, company.fiscalYearEndMonth);
  const corporateTaxDueDate = endOfMonth(fiscalYearEndDate.getUTCFullYear(), fiscalYearEndDate.getUTCMonth() + 3);
  const hasWithholdingSetting = company.representativeSalaryEnabled || company.employeePayrollEnabled || company.contractorPaymentEnabled;
  const vatNeedsTypeReview = company.vatType !== "GENERAL";
  const missingEvidence = summary.missingEvidenceAmount > 0;

  return [
    {
      신고: "증빙 정리",
      "대상 기간": periodLabel,
      "예상 기한": formatIsoDate(evidenceDueDate),
      상태: missingEvidence ? "누락" : scheduleStatus(evidenceDueDate, "정리 가능"),
      톤: missingEvidence ? "red" : toneForDueDate(evidenceDueDate),
      "다음 작업": missingEvidence ? "증빙함에서 카드전표, 세금계산서, 현금영수증 매칭" : "월 마감 전 미확인 비용 증빙 점검"
    },
    {
      신고: "부가세",
      "대상 기간": vatHalfLabel,
      "예상 기한": formatIsoDate(vatDueDate),
      상태: missingEvidence ? "증빙 확인" : vatNeedsTypeReview ? "유형 검토" : scheduleStatus(vatDueDate, "준비 가능"),
      톤: missingEvidence ? "red" : vatNeedsTypeReview ? "amber" : toneForDueDate(vatDueDate),
      "다음 작업": vatNeedsTypeReview ? "면세/겸영 매출과 공제 가능 매입세액 구분" : "매출세액, 매입세액, 불공제 후보 확인"
    },
    {
      신고: "원천세",
      "대상 기간": `${periodYear}년 ${periodMonth}월 지급분`,
      "예상 기한": formatIsoDate(withholdingDueDate),
      상태: withholdingRows.length > 0 ? "후보 확인" : hasWithholdingSetting ? scheduleStatus(withholdingDueDate, "지급 확인") : "미사용",
      톤: withholdingRows.length > 0 ? "amber" : hasWithholdingSetting ? toneForDueDate(withholdingDueDate) : "green",
      "다음 작업": withholdingRows.length > 0 ? "급여대장, 외주 세금계산서, 3.3% 원천세 여부 확인" : "급여/외주 지급 발생 시 지급월별 신고 대상 확인"
    },
    {
      신고: "법인세",
      "대상 기간": `${formatIsoDate(getFiscalYearStartDate(fiscalYearEndDate))} - ${formatIsoDate(fiscalYearEndDate)}`,
      "예상 기한": formatIsoDate(corporateTaxDueDate),
      상태: ledgerRows.length > 0 ? scheduleStatus(corporateTaxDueDate, "원장 있음") : "분개 승인",
      톤: ledgerRows.length > 0 ? toneForDueDate(corporateTaxDueDate) : "amber",
      "다음 작업": ledgerRows.length > 0 ? "계정별 원장, 손익, 대표자 거래 검토" : "자동분개 탭에서 기간별 분개 승인 후 원장 생성"
    }
  ];
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function endOfMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

function getFiscalYearEndDate(periodEnd: Date, fiscalYearEndMonth: number) {
  const fiscalMonthIndex = fiscalYearEndMonth - 1;
  const fiscalYear = periodEnd.getUTCMonth() > fiscalMonthIndex ? periodEnd.getUTCFullYear() + 1 : periodEnd.getUTCFullYear();
  return endOfMonth(fiscalYear, fiscalMonthIndex);
}

function getFiscalYearStartDate(fiscalYearEndDate: Date) {
  return new Date(Date.UTC(fiscalYearEndDate.getUTCFullYear() - 1, fiscalYearEndDate.getUTCMonth() + 1, 1));
}

function daysUntil(date: Date) {
  const today = parseIsoDate(new Date().toISOString().slice(0, 10));
  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
}

function toneForDueDate(date: Date): "green" | "amber" | "red" {
  const days = daysUntil(date);
  if (days < 0) return "red";
  if (days <= 30) return "amber";
  return "green";
}

function scheduleStatus(date: Date, readyLabel: string) {
  const days = daysUntil(date);
  if (days < 0) return "기한 확인";
  if (days <= 30) return "다가옴";
  return readyLabel;
}

function buildJournalIntegrityRows(
  journalEntries: AppJournalEntry[],
  ledgerRows: ReturnType<typeof buildLedgerRows>,
  financialStatementRows: FinancialStatementRow[],
  totals: ReturnType<typeof buildFinancialStatementTotals>
): JournalIntegrityRow[] {
  const approvedEntries = journalEntries.filter((entry) => entry.status === "APPROVED");
  const approvedLines = approvedEntries.flatMap((entry) => entry.lines);
  const totalDebit = approvedLines.reduce((sum, line) => sum + line.debitAmount, 0);
  const totalCredit = approvedLines.reduce((sum, line) => sum + line.creditAmount, 0);
  const journalDifference = Math.round(totalDebit - totalCredit);
  const equationRight = totals.liability + totals.equity + totals.profit;
  const equationDifference = Math.round(totals.asset - equationRight);

  return [
    {
      점검: "차변/대변 합계",
      상태: approvedEntries.length === 0 ? "승인 대기" : journalDifference === 0 ? "균형" : "차액 확인",
      톤: approvedEntries.length === 0 ? "red" : journalDifference === 0 ? "green" : "red",
      금액: `차변 ${formatKRW(totalDebit)} · 대변 ${formatKRW(totalCredit)}`,
      근거: approvedEntries.length === 0 ? "승인된 분개가 없습니다." : `차액 ${formatKRW(Math.abs(journalDifference))}`,
      "다음 작업": approvedEntries.length === 0 ? "자동분개 탭에서 정상 초안 승인" : journalDifference === 0 ? "기간별 승인 분개 표본 확인" : "불균형 분개를 취소하고 거래 분류 재확인"
    },
    {
      점검: "회계등식",
      상태: financialStatementRows.length === 0 ? "재무제표 대기" : equationDifference === 0 ? "균형" : "차액 확인",
      톤: financialStatementRows.length === 0 ? "red" : equationDifference === 0 ? "green" : "red",
      금액: `자산 ${formatKRW(totals.asset)} · 부채+자본+손익 ${formatKRW(equationRight)}`,
      근거: financialStatementRows.length === 0 ? "재무제표 초안이 없습니다." : `차액 ${formatKRW(Math.abs(equationDifference))}`,
      "다음 작업": financialStatementRows.length === 0 ? "승인 분개 생성 후 재무제표 초안 확인" : equationDifference === 0 ? "자산, 부채, 자본 계정 실재성 검토" : "자본금, 대표자차입금, 손익 계정 분류 확인"
    },
    {
      점검: "계정별 원장",
      상태: ledgerRows.length > 0 ? "생성됨" : "대기",
      톤: ledgerRows.length > 0 ? "green" : "red",
      금액: `${formatNumber(ledgerRows.length)}행`,
      근거: ledgerRows.length > 0 ? "승인 분개 라인이 원장에 반영되었습니다." : "원장 행이 없습니다.",
      "다음 작업": ledgerRows.length > 0 ? "계정별 잔액과 거래처 원천자료 대조" : "자동분개 승인 후 원장 재생성"
    },
    {
      점검: "재무제표 초안",
      상태: financialStatementRows.length > 0 ? "생성됨" : "대기",
      톤: financialStatementRows.length > 0 ? "green" : "red",
      금액: `${formatNumber(financialStatementRows.length)}개 계정`,
      근거: financialStatementRows.length > 0 ? "원장 잔액이 재무제표 초안으로 집계되었습니다." : "재무제표 초안 행이 없습니다.",
      "다음 작업": financialStatementRows.length > 0 ? "법인세 신고 전 계정별 금액 확인" : "승인 분개 생성 후 재무제표 초안 확인"
    }
  ];
}

function buildLedgerRows(journalEntries: AppJournalEntry[]) {
  const defaultAccountTypeByCode = new Map(DEFAULT_ACCOUNTS.map((account) => [account.code, account.type]));
  const rows = journalEntries
    .filter((entry) => entry.status === "APPROVED")
    .flatMap((entry) =>
      entry.lines.map((line) => ({
        entryDate: entry.entryDate,
        accountCode: line.accountCode,
        accountName: line.accountName,
        accountType: line.accountType ?? defaultAccountTypeByCode.get(line.accountCode),
        memo: line.memo ?? entry.memo,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount
      }))
    )
    .sort((a, b) => `${a.accountCode}-${a.entryDate}`.localeCompare(`${b.accountCode}-${b.entryDate}`));

  const balances = new Map<string, number>();
  return rows.map((row) => {
    const current = balances.get(row.accountCode) ?? 0;
    const isCreditNormal = row.accountType === "LIABILITY" || row.accountType === "EQUITY" || row.accountType === "REVENUE";
    const next = current + (isCreditNormal ? row.creditAmount - row.debitAmount : row.debitAmount - row.creditAmount);
    balances.set(row.accountCode, next);
    return { ...row, balance: next };
  });
}

type FinancialStatementRow = {
  구분: string;
  계정: string;
  금액: number;
  확인: string;
};

function buildFinancialStatementRows(ledgerRows: ReturnType<typeof buildLedgerRows>): FinancialStatementRow[] {
  const accountBalances = new Map<
    string,
    {
      accountCode: string;
      accountName: string;
      accountType?: AppAccount["type"];
      balance: number;
    }
  >();

  ledgerRows.forEach((row) => {
    accountBalances.set(row.accountCode, {
      accountCode: row.accountCode,
      accountName: row.accountName,
      accountType: row.accountType,
      balance: row.balance
    });
  });

  return [...accountBalances.values()]
    .filter((row) => row.balance !== 0)
    .sort((a, b) => {
      const typeOrder = financialStatementSortOrder(a.accountType) - financialStatementSortOrder(b.accountType);
      if (typeOrder !== 0) return typeOrder;
      return a.accountCode.localeCompare(b.accountCode);
    })
    .map((row) => ({
      구분: financialStatementLabel(row.accountType),
      계정: `${row.accountCode} ${row.accountName}`,
      금액: Math.round(row.balance),
      확인: financialStatementCheckText(row.accountType)
    }));
}

function buildFinancialStatementTotals(rows: FinancialStatementRow[]) {
  const totals = {
    asset: 0,
    liability: 0,
    equity: 0,
    revenue: 0,
    expense: 0,
    profit: 0
  };

  rows.forEach((row) => {
    if (row.구분 === "재무상태표 자산") totals.asset += row.금액;
    if (row.구분 === "재무상태표 부채") totals.liability += row.금액;
    if (row.구분 === "재무상태표 자본") totals.equity += row.금액;
    if (row.구분 === "손익계산서 수익") totals.revenue += row.금액;
    if (row.구분 === "손익계산서 비용") totals.expense += row.금액;
  });
  totals.profit = totals.revenue - totals.expense;
  return totals;
}

function financialStatementSortOrder(type?: AppAccount["type"]) {
  const order: Record<AppAccount["type"], number> = {
    ASSET: 1,
    LIABILITY: 2,
    EQUITY: 3,
    REVENUE: 4,
    EXPENSE: 5
  };
  return type ? order[type] : 9;
}

function financialStatementLabel(type?: AppAccount["type"]) {
  const labels: Record<AppAccount["type"], string> = {
    ASSET: "재무상태표 자산",
    LIABILITY: "재무상태표 부채",
    EQUITY: "재무상태표 자본",
    REVENUE: "손익계산서 수익",
    EXPENSE: "손익계산서 비용"
  };
  return type ? labels[type] : "미분류";
}

function financialStatementCheckText(type?: AppAccount["type"]) {
  const checks: Record<AppAccount["type"], string> = {
    ASSET: "통장 잔액, 미수금, 가지급금 실재성 확인",
    LIABILITY: "대표자차입금, 미지급금, 카드대금 확인",
    EQUITY: "자본금, 이익잉여금, 당기손익 반영 확인",
    REVENUE: "세금계산서, 카드, PG 매출 누락 확인",
    EXPENSE: "손금 가능성과 적격증빙 확인"
  };
  return type ? checks[type] : "계정 유형 확인";
}

function buildLedgerCsv(rows: ReturnType<typeof buildLedgerRows>) {
  return rows.map((row) => ({
    일자: row.entryDate,
    계정코드: row.accountCode,
    계정과목: row.accountName,
    계정유형: row.accountType ?? "",
    적요: row.memo,
    차변: row.debitAmount,
    대변: row.creditAmount,
    잔액: row.balance
  }));
}

function getViewTitle(view: ViewKey) {
  const title: Record<ViewKey, string> = {
    dashboard: "대시보드",
    imports: "자료 업로드",
    transactions: "거래내역",
    evidences: "증빙함",
    journals: "자동분개",
    reviews: "검토함",
    reports: "신고 준비 리포트",
    settings: "설정"
  };
  return title[view];
}
