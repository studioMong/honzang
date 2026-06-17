"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import Papa from "papaparse";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSpreadsheet,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  Loader2,
  ReceiptText,
  RefreshCcw,
  Settings,
  Upload,
  WalletCards
} from "lucide-react";
import type {
  AppAccount,
  AppClassificationRule,
  AppCompany,
  AppEvidence,
  AppJournalEntry,
  AppTaxReport,
  AppTransaction,
  CsvColumnMapping,
  CsvTemplate,
  EvidenceStatus,
  ImportPreview,
  ParsedCsvRow,
  SourceType
} from "@/types";
import { DEFAULT_ACCOUNTS, DEFAULT_COMPANY_ID, SOURCE_TYPE_LABELS } from "@/lib/defaults";
import { applyClassificationRules, generateJournalDraft, inferMapping, normalizeCsvRow, parseMoney, summarizeTransactions } from "@/lib/accounting";
import { formatDate, formatKRW, formatNumber } from "@/lib/format";
import { sampleCompany, sampleEvidences, sampleJournalEntries, sampleTaxReports, sampleTransactions } from "@/lib/sample-data";

export type ViewKey = "dashboard" | "imports" | "transactions" | "evidences" | "journals" | "reviews" | "reports" | "settings";

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

const sampleCsvLinks: Record<SourceType, { label: string; href: string }> = {
  BANK: { label: "통장 샘플", href: "/samples/bank-transactions.csv" },
  CARD: { label: "카드 샘플", href: "/samples/card-transactions.csv" },
  HOMETAX_SALES: { label: "홈택스 매출 샘플", href: "/samples/hometax-sales.csv" },
  HOMETAX_PURCHASES: { label: "홈택스 매입 샘플", href: "/samples/hometax-purchases.csv" },
  CASH_RECEIPT: { label: "현금영수증 샘플", href: "/samples/hometax-purchases.csv" },
  PG: { label: "PG 정산 샘플", href: "/samples/pg-settlements.csv" },
  MANUAL: { label: "수기 샘플", href: "/samples/bank-transactions.csv" }
};

export function AppWorkspace({ initialView = "dashboard" }: { initialView?: ViewKey }) {
  const [activeView, setActiveView] = useState<ViewKey>(initialView);
  const [company, setCompany] = useState<AppCompany>(sampleCompany);
  const [accounts, setAccounts] = useState<AppAccount[]>(DEFAULT_ACCOUNTS);
  const [csvTemplates, setCsvTemplates] = useState<CsvTemplate[]>([]);
  const [classificationRules, setClassificationRules] = useState<AppClassificationRule[]>([]);
  const [transactions, setTransactions] = useState<AppTransaction[]>(sampleTransactions);
  const [evidences, setEvidences] = useState<AppEvidence[]>(sampleEvidences);
  const [journalEntries, setJournalEntries] = useState<AppJournalEntry[]>(sampleJournalEntries);
  const [taxReports, setTaxReports] = useState<AppTaxReport[]>(sampleTaxReports);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"sample" | "database">("sample");

  const summary = useMemo(() => summarizeTransactions(transactions), [transactions]);
  const reviewItems = useMemo(() => buildReviewItems(transactions), [transactions]);

  async function refresh() {
    setLoading(true);
    try {
      const [companyResponse, transactionResponse] = await Promise.all([
        fetch("/api/companies", { cache: "no-store" }),
        fetch("/api/transactions", { cache: "no-store" })
      ]);
      const evidenceResponse = await fetch("/api/evidences", { cache: "no-store" });
      const journalResponse = await fetch("/api/journals", { cache: "no-store" });
      const reportResponse = await fetch("/api/reports", { cache: "no-store" });
      const companyPayload = await companyResponse.json();
      const transactionPayload = await transactionResponse.json();
      const evidencePayload = await evidenceResponse.json();
      const journalPayload = await journalResponse.json();
      const reportPayload = await reportResponse.json();
      const isDatabaseMode =
        companyPayload.mode === "database" ||
        transactionPayload.mode === "database" ||
        evidencePayload.mode === "database" ||
        journalPayload.mode === "database" ||
        reportPayload.mode === "database";
      setCompany(companyPayload.company ?? sampleCompany);
      setAccounts(companyPayload.accounts ?? DEFAULT_ACCOUNTS);
      setCsvTemplates(companyPayload.csvTemplates ?? []);
      setClassificationRules(companyPayload.classificationRules ?? []);
      setTransactions(isDatabaseMode ? transactionPayload.transactions ?? [] : transactionPayload.transactions?.length ? transactionPayload.transactions : sampleTransactions);
      setEvidences(isDatabaseMode ? evidencePayload.evidences ?? [] : evidencePayload.evidences?.length ? evidencePayload.evidences : sampleEvidences);
      setJournalEntries(journalPayload.journalEntries ?? []);
      setTaxReports(reportPayload.taxReports ?? []);
      setMode(isDatabaseMode ? "database" : "sample");
    } catch {
      setCompany(sampleCompany);
      setAccounts(DEFAULT_ACCOUNTS);
      setCsvTemplates([]);
      setClassificationRules([]);
      setTransactions(sampleTransactions);
      setEvidences(sampleEvidences);
      setJournalEntries(sampleJournalEntries);
      setTaxReports(sampleTaxReports);
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
    } catch {
      setMode("sample");
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
            <button className="secondary-button" onClick={() => setActiveView("imports")}>
              <Upload size={17} />
              CSV 업로드
            </button>
          </div>
        </header>

        {activeView === "dashboard" && (
          <Dashboard company={company} summary={summary} reviewCount={reviewItems.length} transactions={transactions} onMove={setActiveView} />
        )}
        {activeView === "imports" && (
          <CsvImportPanel
            companyId={company.id || DEFAULT_COMPANY_ID}
            accounts={accounts}
            csvTemplates={csvTemplates}
            classificationRules={classificationRules}
            onImported={(imported) => {
              setTransactions((current) => mergeTransactions(current, imported));
              setActiveView("transactions");
            }}
          />
        )}
        {activeView === "transactions" && (
          <TransactionsPanel transactions={transactions} accounts={accounts} onUpdate={updateTransaction} />
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
            }}
          />
        )}
        {activeView === "journals" && (
          <JournalDraftsPanel
            companyId={company.id || DEFAULT_COMPANY_ID}
            transactions={transactions}
            journalEntries={journalEntries}
            onApproved={(entry) => {
              setJournalEntries((current) => [entry, ...current.filter((item) => item.transactionId !== entry.transactionId)]);
            }}
          />
        )}
        {activeView === "reviews" && <ReviewsPanel items={reviewItems} />}
        {activeView === "reports" && (
          <ReportsPanel
            company={company}
            companyId={company.id || DEFAULT_COMPANY_ID}
            transactions={transactions}
            journalEntries={journalEntries}
            taxReports={taxReports}
            onSaved={(taxReport) => setTaxReports((current) => [taxReport, ...current.filter((item) => item.id !== taxReport.id)])}
          />
        )}
        {activeView === "settings" && (
          <SettingsPanel
            company={company}
            accounts={accounts}
            classificationRules={classificationRules}
            onSaved={setCompany}
            onRulesChanged={setClassificationRules}
          />
        )}
      </main>
    </div>
  );
}

function Dashboard({
  company,
  summary,
  reviewCount,
  transactions,
  onMove
}: {
  company: AppCompany;
  summary: ReturnType<typeof summarizeTransactions>;
  reviewCount: number;
  transactions: AppTransaction[];
  onMove: (view: ViewKey) => void;
}) {
  const recent = transactions.slice(0, 6);
  const setupItems = buildCompanySetupItems(company);
  const readyCount = setupItems.filter((item) => item.tone !== "red").length;
  return (
    <div className="content">
      <section className="kpi-grid">
        <Kpi label="매출" value={formatKRW(summary.revenue)} foot="공급가액 기준" icon={<ReceiptText size={16} />} />
        <Kpi label="비용" value={formatKRW(summary.expense)} foot="공급가액 추정" icon={<WalletCards size={16} />} />
        <Kpi label="손익" value={formatKRW(summary.profit)} foot={summary.profit >= 0 ? "흑자" : "적자"} icon={<BarChart3 size={16} />} />
        <Kpi label="부가세 예상" value={formatKRW(summary.vatPayable)} foot="양수 납부 · 음수 환급" icon={<FileSpreadsheet size={16} />} />
        <Kpi label="검토" value={`${reviewCount}건`} foot={`위험 ${summary.riskCount}건`} icon={<AlertTriangle size={16} />} />
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
  csvTemplates,
  classificationRules,
  onImported
}: {
  companyId: string;
  accounts: AppAccount[];
  csvTemplates: CsvTemplate[];
  classificationRules: AppClassificationRule[];
  onImported: (transactions: AppTransaction[]) => void;
}) {
  const [sourceType, setSourceType] = useState<SourceType>("BANK");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping>({});
  const [saving, setSaving] = useState(false);
  const [importMessage, setImportMessage] = useState<{ tone: "green" | "amber" | "red"; text: string } | null>(null);
  const canImport = preview && mapping.transactionDate && mapping.description && (mapping.amount || mapping.depositAmount || mapping.withdrawalAmount);

  function parseFile(file: File) {
    setFileName(file.name);
    setImportMessage(null);
    Papa.parse<ParsedCsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: (result) => {
        const headers = result.meta.fields?.filter(Boolean) ?? [];
        const rows = result.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
        setPreview({ headers, rows: rows.slice(0, 2000) });
        setMapping(getSavedMapping(sourceType, headers, csvTemplates) ?? inferMapping(headers, sourceType));
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
          mapping,
          headers: preview.headers,
          rows: preview.rows
        })
      });
      const payload = await response.json();
      if (payload.transactions?.length) {
        saveLocalMapping(sourceType, preview.headers, mapping);
        setImportMessage({
          tone: payload.duplicate ? "amber" : "green",
          text: payload.duplicate ? "이미 가져온 파일입니다. 기존 거래를 다시 불러왔습니다." : `${formatNumber(payload.transactions.length)}건을 가져왔습니다.`
        });
        onImported(payload.transactions);
      } else if (!response.ok) {
        setImportMessage({ tone: "red", text: "가져오기에 실패했습니다. CSV 매핑과 행 데이터를 확인해 주세요." });
      }
    } finally {
      setSaving(false);
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
            <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)} className="secondary-button">
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
            <button className="primary-button" disabled={!canImport || saving} onClick={() => void submitImport()}>
              {saving ? <Loader2 size={17} /> : <CheckCircle2 size={17} />}
              가져오기
            </button>
          </div>
        </div>
        <div className="panel-body split">
          <div>
            {importMessage && <div className={`import-message status ${importMessage.tone}`}>{importMessage.text}</div>}
            <label className="file-drop">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) parseFile(file);
                }}
              />
              <span>
                <FileSpreadsheet size={28} />
                <strong>{fileName || "CSV 파일 선택"}</strong>
                <span>{preview ? `${formatNumber(preview.rows.length)}행 · ${formatNumber(preview.headers.length)}개 컬럼` : "통장, 카드, 홈택스, PG"}</span>
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
            {mappingFields.map((field) => (
              <div className="field" key={field.key}>
                <label>{field.label}</label>
                <select
                  value={mapping[field.key] ?? ""}
                  onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.target.value || undefined }))}
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
    </div>
  );
}

function TransactionsPanel({
  transactions,
  accounts,
  onUpdate
}: {
  transactions: AppTransaction[];
  accounts: AppAccount[];
  onUpdate: (id: string, patch: Partial<AppTransaction> & { confirmedAccountId?: string }) => void;
}) {
  return (
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
            {transactions.map((transaction) => (
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
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EvidencesPanel({
  companyId,
  evidences,
  transactions,
  onCreated
}: {
  companyId: string;
  evidences: AppEvidence[];
  transactions: AppTransaction[];
  onCreated: (evidence: AppEvidence) => void;
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
    transactionId: ""
  });
  const [saving, setSaving] = useState(false);
  const matchCandidates = useMemo(() => buildEvidenceMatchCandidates(form, transactions), [form, transactions]);

  function updateField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
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
          transactionId: form.transactionId || null
        })
      });
      const payload = await response.json();
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
          transactionId: ""
        }));
      }
    } finally {
      setSaving(false);
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
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) updateField("fileName", file.name);
              }}
            />
            <span>
              <FileCheck2 size={28} />
              <strong>{form.fileName || "증빙 파일 선택"}</strong>
              <span>초기 버전은 파일명과 매칭 정보를 저장합니다</span>
            </span>
          </label>
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
              </tr>
            </thead>
            <tbody>
              {evidences.map((evidence) => (
                <tr key={evidence.id}>
                  <td>{evidence.issueDate ? formatDate(evidence.issueDate) : "-"}</td>
                  <td>{evidence.evidenceType}</td>
                  <td>{evidence.counterparty ?? "-"}</td>
                  <td>{evidence.transaction?.description ?? "-"}</td>
                  <td className="amount">{evidence.supplyAmount ? formatKRW(evidence.supplyAmount) : "-"}</td>
                  <td className="amount">{evidence.vatAmount ? formatKRW(evidence.vatAmount) : "-"}</td>
                  <td className="amount">{evidence.totalAmount ? formatKRW(evidence.totalAmount) : "-"}</td>
                  <td>{evidence.fileName ?? "-"}</td>
                </tr>
              ))}
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
  onApproved
}: {
  companyId: string;
  transactions: AppTransaction[];
  journalEntries: AppJournalEntry[];
  onApproved: (entry: AppJournalEntry) => void;
}) {
  const drafts = transactions.map(generateJournalDraft);
  const [savingId, setSavingId] = useState<string | null>(null);
  const approvedTransactionIds = new Set(journalEntries.map((entry) => entry.transactionId).filter(Boolean));

  async function approveDraft(draft: ReturnType<typeof generateJournalDraft>) {
    setSavingId(draft.transactionId);
    try {
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
      if (payload.journalEntry) onApproved(payload.journalEntry);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="content">
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">자동분개 초안</h2>
          <span className="status blue">{formatNumber(drafts.length)}건</span>
        </div>
        <div className="panel-body review-list">
          {drafts.map((draft) => {
            const isApproved = approvedTransactionIds.has(draft.transactionId);
            return (
            <article key={draft.transactionId} className="journal-card">
              <div className="review-row">
                <div>
                  <strong>{draft.memo}</strong>
                  <div className="muted">{draft.entryDate} · 차변 {formatKRW(draft.lines.reduce((sum, line) => sum + line.debitAmount, 0))} · 대변 {formatKRW(draft.lines.reduce((sum, line) => sum + line.creditAmount, 0))}</div>
                </div>
                <div className="toolbar">
                  {isApproved && <span className="status green">승인됨</span>}
                  <span className={draft.warnings.length ? "status amber" : "status green"}>{draft.warnings.length ? "검토 필요" : "균형"}</span>
                  <button
                    className="secondary-button"
                    disabled={isApproved || savingId === draft.transactionId || draft.lines.length === 0}
                    onClick={() => void approveDraft(draft)}
                  >
                    {savingId === draft.transactionId ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                    {isApproved ? "저장 완료" : "승인 저장"}
                  </button>
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

function ReviewsPanel({ items }: { items: ReturnType<typeof buildReviewItems> }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">검토함</h2>
        <span className="status amber">{formatNumber(items.length)}건</span>
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
                  <span className={item.severity === "DANGER" ? "status red" : item.severity === "WARNING" ? "status amber" : "status blue"}>
                    {item.severity === "DANGER" ? "위험" : item.severity === "WARNING" ? "주의" : "확인"}
                  </span>
                </div>
                <div className="muted">
                  {item.transaction ? `${formatDate(item.transaction.transactionDate)} · ${item.transaction.description}` : "거래 없음"}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ReportsPanel({
  company,
  companyId,
  transactions,
  journalEntries,
  taxReports,
  onSaved
}: {
  company: AppCompany;
  companyId: string;
  transactions: AppTransaction[];
  journalEntries: AppJournalEntry[];
  taxReports: AppTaxReport[];
  onSaved: (taxReport: AppTaxReport) => void;
}) {
  const periodOptions = useMemo(() => buildPeriodOptions(transactions), [transactions]);
  const [period, setPeriod] = useState(() => periodOptions[0]?.value ?? "ALL");
  const [savingReport, setSavingReport] = useState(false);
  const [selectedTaxReportId, setSelectedTaxReportId] = useState<string | null>(null);
  const selectedPeriod = period === "ALL" || periodOptions.some((option) => option.value === period) ? period : periodOptions[0]?.value ?? "ALL";
  const filteredTransactions = useMemo(() => filterTransactionsByPeriod(transactions, selectedPeriod), [selectedPeriod, transactions]);
  const filteredJournalEntries = useMemo(() => filterJournalEntriesByPeriod(journalEntries, selectedPeriod), [journalEntries, selectedPeriod]);
  const reportSummary = useMemo(() => summarizeTransactions(filteredTransactions), [filteredTransactions]);
  const expenseByAccount = groupExpensesByAccount(filteredTransactions);
  const reviews = buildReviewItems(filteredTransactions);
  const ledgerRows = buildLedgerRows(filteredJournalEntries);
  const withholdingRows = buildWithholdingRows(filteredTransactions);
  const corporateTaxRows = buildCorporateTaxRows(reportSummary, filteredTransactions, filteredJournalEntries, ledgerRows);
  const filingPackageRows = buildFilingPackageRows(reportSummary, filteredTransactions, filteredJournalEntries, ledgerRows, withholdingRows);
  const periodLabel = formatPeriodLabel(selectedPeriod);
  const periodRange = getReportPeriodRange(selectedPeriod, filteredTransactions);
  const filingScheduleRows = buildFilingScheduleRows(company, periodRange, reportSummary, withholdingRows, ledgerRows);
  const visibleTaxReports = taxReports.slice(0, 6);
  const selectedTaxReport = taxReports.find((taxReport) => taxReport.id === selectedTaxReportId) ?? null;
  const selectedPayload = selectedTaxReport ? parseDetailedTaxReportPayload(selectedTaxReport.calculatedPayload) : null;

  async function saveSnapshot() {
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
            filingScheduleRows,
            filingPackageRows,
            withholdingRows,
            corporateTaxRows,
            ledgerRows,
            transactionCount: filteredTransactions.length,
            journalEntryCount: filteredJournalEntries.length
          })
        })
      });
      const payload = await response.json();
      if (payload.taxReport) onSaved(payload.taxReport);
    } finally {
      setSavingReport(false);
    }
  }

  return (
    <div className="content">
      <section className="panel report-filter-panel">
        <div className="panel-header">
          <h2 className="panel-title">리포트 기간</h2>
          <div className="toolbar">
            <span className="status blue">{periodLabel}</span>
            <button className="primary-button" onClick={() => void saveSnapshot()} disabled={savingReport}>
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
        <Kpi label="증빙 누락" value={formatKRW(reportSummary.missingEvidenceAmount)} foot={`${reportSummary.reviewCount}건 검토`} icon={<AlertTriangle size={16} />} />
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
              <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("vat-report", selectedPeriod), buildVatCsv(reportSummary))}>
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
              <button className="secondary-button" onClick={() => downloadCsv(buildReportFileName("corporate-tax-prep", selectedPeriod), corporateTaxRows)}>
                <Download size={16} />
                법인세
              </button>
            </div>
          </div>
          <div className="panel-body">
            <div className="review-list">
              <ChecklistItem tone="green" title="거래 분류" value={`${formatNumber(filteredTransactions.filter((tx) => tx.confirmedAccount || tx.suggestedAccount).length)}건`} />
              <ChecklistItem tone={reportSummary.missingEvidenceAmount > 0 ? "red" : "green"} title="증빙 확인" value={formatKRW(reportSummary.missingEvidenceAmount)} />
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
          <h2 className="panel-title">계정별 원장</h2>
          <div className="toolbar">
            <span className="status blue">{formatNumber(filteredJournalEntries.length)}개 분개</span>
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
  company,
  accounts,
  classificationRules,
  onSaved,
  onRulesChanged
}: {
  company: AppCompany;
  accounts: AppAccount[];
  classificationRules: AppClassificationRule[];
  onSaved: (company: AppCompany) => void;
  onRulesChanged: (rules: AppClassificationRule[]) => void;
}) {
  const [form, setForm] = useState<AppCompany>(company);
  const [ruleForm, setRuleForm] = useState({
    name: "",
    keyword: "",
    accountCode: accounts.find((account) => account.code === "599")?.code ?? accounts[0]?.code ?? "",
    sourceType: "",
    priority: "100"
  });
  const [saving, setSaving] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const setupItems = buildCompanySetupItems(form);
  const missingCount = setupItems.filter((item) => item.tone === "red").length;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setForm(company);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [company]);

  function updateForm<K extends keyof AppCompany>(key: K, value: AppCompany[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateRuleForm(key: keyof typeof ruleForm, value: string) {
    setRuleForm((current) => ({ ...current, [key]: value }));
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
    </div>
  );
}

type CompanySetupItem = {
  title: string;
  detail: string;
  tone: "green" | "amber" | "red";
  status: string;
};

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
      detail: billingModelLabel(company.billingModel),
      tone: "green",
      status: "설정됨"
    }
  ];
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

function ChecklistItem({ title, value, tone }: { title: string; value: string; tone: "green" | "amber" | "red" }) {
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
        {transactions.map((transaction) => (
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
        ))}
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

function buildReviewItems(transactions: AppTransaction[]) {
  return transactions.flatMap((transaction) => {
    const reasons = [...(transaction.reviewReasons ?? [])];
    if (transaction.withdrawalAmount > 0 && transaction.evidenceStatus === "MISSING") {
      reasons.push("증빙 없는 비용");
    }
    return [...new Set(reasons)].map((reason, index) => ({
      id: `${transaction.id}-${index}`,
      reason,
      severity: reason.includes("원천세") || reason.includes("대표자") ? ("DANGER" as const) : reason.includes("증빙") ? ("WARNING" as const) : ("INFO" as const),
      transaction
    }));
  });
}

function buildPeriodOptions(transactions: AppTransaction[]) {
  return [...new Set(transactions.map((transaction) => transaction.transactionDate.slice(0, 7)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a))
    .map((value) => ({ value, label: formatPeriodLabel(value) }));
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

function filterJournalEntriesByPeriod(journalEntries: AppJournalEntry[], period: string) {
  if (period === "ALL") return journalEntries;
  return journalEntries.filter((entry) => entry.entryDate.startsWith(period));
}

function buildReportFileName(name: string, period: string) {
  return `honzang-${period === "ALL" ? "all" : period}-${name}.csv`;
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
  filingScheduleRows,
  filingPackageRows,
  withholdingRows,
  corporateTaxRows,
  ledgerRows,
  transactionCount,
  journalEntryCount
}: {
  period: string;
  periodLabel: string;
  summary: ReturnType<typeof summarizeTransactions>;
  filingScheduleRows: ReturnType<typeof buildFilingScheduleRows>;
  filingPackageRows: ReturnType<typeof buildFilingPackageRows>;
  withholdingRows: ReturnType<typeof buildWithholdingRows>;
  corporateTaxRows: ReturnType<typeof buildCorporateTaxRows>;
  ledgerRows: ReturnType<typeof buildLedgerRows>;
  transactionCount: number;
  journalEntryCount: number;
}) {
  return {
    period,
    periodLabel,
    summary,
    filingScheduleRows,
    filingPackageRows,
    withholdingRows,
    corporateTaxRows,
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
    filingScheduleRows: parseStringNumberRecordRows(record.filingScheduleRows) as ReturnType<typeof buildFilingScheduleRows>,
    filingPackageRows: parseStringNumberRecordRows(record.filingPackageRows) as ReturnType<typeof buildFilingPackageRows>,
    withholdingRows: parseStringNumberRecordRows(record.withholdingRows) as ReturnType<typeof buildWithholdingRows>,
    corporateTaxRows: parseStringNumberRecordRows(record.corporateTaxRows) as ReturnType<typeof buildCorporateTaxRows>,
    ledgerRows: parseStringNumberRecordRows(record.ledgerRows),
    transactionCount: typeof record.transactionCount === "number" ? record.transactionCount : 0,
    journalEntryCount: typeof record.journalEntryCount === "number" ? record.journalEntryCount : 0
  };
}

function buildTaxReportDetailRows(taxReport: AppTaxReport, payload: ReturnType<typeof parseDetailedTaxReportPayload>) {
  return [
    { 항목: "기간", 값: `${formatDate(taxReport.periodStart)} - ${formatDate(taxReport.periodEnd)}`, 확인: payload.periodLabel || taxReportTypeLabel(taxReport.reportType) },
    { 항목: "거래", 값: `${formatNumber(payload.transactionCount)}건`, 확인: "저장 당시 기간 필터 기준" },
    { 항목: "승인 분개", 값: `${formatNumber(payload.journalEntryCount)}개`, 확인: "저장 당시 승인 분개 기준" },
    { 항목: "매출 공급가액", 값: formatKRW(payload.summary.revenue), 확인: "부채성 입금 제외" },
    { 항목: "비용 공급가액", 값: formatKRW(payload.summary.expense), 확인: "비용 계정 출금 기준" },
    { 항목: "손익", 값: formatKRW(payload.summary.profit), 확인: payload.summary.profit >= 0 ? "이익" : "손실" },
    { 항목: "예상 부가세", 값: formatKRW(payload.summary.vatPayable), 확인: "확정 전 신고 준비 금액" },
    { 항목: "증빙 누락", 값: formatKRW(payload.summary.missingEvidenceAmount), 확인: `${formatNumber(payload.summary.reviewCount)}건 검토` },
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
  if (dbTemplate) return dbTemplate.mapping;

  try {
    const raw = window.localStorage.getItem(`honzang:csv-template:${sourceType}:${signature}`);
    return raw ? (JSON.parse(raw) as CsvColumnMapping) : null;
  } catch {
    return null;
  }
}

function saveLocalMapping(sourceType: SourceType, headers: string[], mapping: CsvColumnMapping) {
  try {
    window.localStorage.setItem(`honzang:csv-template:${sourceType}:${headers.join("|")}`, JSON.stringify(mapping));
  } catch {
    // Local storage is optional; database persistence still applies when configured.
  }
}

function downloadCsv(fileName: string, rows: Array<Record<string, string | number>>) {
  const csv = toCsv(rows);
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadJson(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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

function buildVatCsv(summary: ReturnType<typeof summarizeTransactions>) {
  return [
    { 항목: "과세 매출 공급가액", 금액: summary.revenue },
    { 항목: "매출 부가세", 금액: summary.vatOutput },
    { 항목: "매입 공급가액", 금액: summary.expense },
    { 항목: "매입 부가세", 금액: summary.vatInput },
    { 항목: "예상 납부/환급액", 금액: summary.vatPayable },
    { 항목: "증빙 누락 비용", 금액: summary.missingEvidenceAmount },
    { 항목: "검토 필요 건수", 금액: summary.reviewCount },
    { 항목: "위험 거래 건수", 금액: summary.riskCount }
  ];
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

function getTransactionAccount(transaction: AppTransaction) {
  return transaction.confirmedAccount ?? transaction.suggestedAccount ?? null;
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
  ledgerRows: ReturnType<typeof buildLedgerRows>
) {
  const unclassifiedCount = transactions.filter((transaction) => !transaction.confirmedAccount && !transaction.suggestedAccount).length;
  const ownerRiskCount = transactions.filter((transaction) => {
    const account = getTransactionAccount(transaction);
    return account?.taxCategory === "OWNER_RISK" || transaction.reviewReasons?.some((reason) => reason.includes("대표자"));
  }).length;
  const approvedJournalCount = journalEntries.filter((entry) => entry.status === "APPROVED").length;

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
    }
  ];
}

function buildFilingPackageRows(
  summary: ReturnType<typeof summarizeTransactions>,
  transactions: AppTransaction[],
  journalEntries: AppJournalEntry[],
  ledgerRows: ReturnType<typeof buildLedgerRows>,
  withholdingRows: ReturnType<typeof buildWithholdingRows>
) {
  const classifiedCount = transactions.filter((transaction) => transaction.confirmedAccount || transaction.suggestedAccount).length;
  const missingEvidenceCount = transactions.filter((transaction) => transaction.withdrawalAmount > 0 && ["UNCHECKED", "MISSING"].includes(transaction.evidenceStatus)).length;
  const approvedJournalCount = journalEntries.filter((entry) => entry.status === "APPROVED").length;
  const totalTransactions = transactions.length;

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
