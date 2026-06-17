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
  AppCompany,
  AppEvidence,
  AppJournalEntry,
  AppTransaction,
  CsvColumnMapping,
  CsvTemplate,
  EvidenceStatus,
  ImportPreview,
  ParsedCsvRow,
  SourceType
} from "@/types";
import { DEFAULT_ACCOUNTS, DEFAULT_COMPANY_ID, SOURCE_TYPE_LABELS } from "@/lib/defaults";
import { generateJournalDraft, normalizeCsvRow, summarizeTransactions } from "@/lib/accounting";
import { formatDate, formatKRW, formatNumber } from "@/lib/format";
import { sampleCompany, sampleEvidences, sampleJournalEntries, sampleTransactions } from "@/lib/sample-data";

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

export function AppWorkspace({ initialView = "dashboard" }: { initialView?: ViewKey }) {
  const [activeView, setActiveView] = useState<ViewKey>(initialView);
  const [company, setCompany] = useState<AppCompany>(sampleCompany);
  const [accounts, setAccounts] = useState<AppAccount[]>(DEFAULT_ACCOUNTS);
  const [csvTemplates, setCsvTemplates] = useState<CsvTemplate[]>([]);
  const [transactions, setTransactions] = useState<AppTransaction[]>(sampleTransactions);
  const [evidences, setEvidences] = useState<AppEvidence[]>(sampleEvidences);
  const [journalEntries, setJournalEntries] = useState<AppJournalEntry[]>(sampleJournalEntries);
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
      const companyPayload = await companyResponse.json();
      const transactionPayload = await transactionResponse.json();
      const evidencePayload = await evidenceResponse.json();
      const journalPayload = await journalResponse.json();
      setCompany(companyPayload.company ?? sampleCompany);
      setAccounts(companyPayload.accounts ?? DEFAULT_ACCOUNTS);
      setCsvTemplates(companyPayload.csvTemplates ?? []);
      setTransactions(transactionPayload.transactions?.length ? transactionPayload.transactions : sampleTransactions);
      setEvidences(evidencePayload.evidences?.length ? evidencePayload.evidences : sampleEvidences);
      setJournalEntries(journalPayload.journalEntries ?? []);
      setMode(
        companyPayload.mode === "database" ||
          transactionPayload.mode === "database" ||
          evidencePayload.mode === "database" ||
          journalPayload.mode === "database"
          ? "database"
          : "sample"
      );
    } catch {
      setCompany(sampleCompany);
      setAccounts(DEFAULT_ACCOUNTS);
      setCsvTemplates([]);
      setTransactions(sampleTransactions);
      setEvidences(sampleEvidences);
      setJournalEntries(sampleJournalEntries);
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
          <Dashboard summary={summary} reviewCount={reviewItems.length} transactions={transactions} onMove={setActiveView} />
        )}
        {activeView === "imports" && (
          <CsvImportPanel
            companyId={company.id || DEFAULT_COMPANY_ID}
            csvTemplates={csvTemplates}
            onImported={(imported) => {
              setTransactions(imported);
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
        {activeView === "reports" && <ReportsPanel summary={summary} transactions={transactions} journalEntries={journalEntries} />}
        {activeView === "settings" && <SettingsPanel company={company} accounts={accounts} onSaved={setCompany} />}
      </main>
    </div>
  );
}

function Dashboard({
  summary,
  reviewCount,
  transactions,
  onMove
}: {
  summary: ReturnType<typeof summarizeTransactions>;
  reviewCount: number;
  transactions: AppTransaction[];
  onMove: (view: ViewKey) => void;
}) {
  const recent = transactions.slice(0, 6);
  return (
    <div className="content">
      <section className="kpi-grid">
        <Kpi label="매출" value={formatKRW(summary.revenue)} foot="공급가액 기준" icon={<ReceiptText size={16} />} />
        <Kpi label="비용" value={formatKRW(summary.expense)} foot="공급가액 추정" icon={<WalletCards size={16} />} />
        <Kpi label="손익" value={formatKRW(summary.profit)} foot={summary.profit >= 0 ? "흑자" : "적자"} icon={<BarChart3 size={16} />} />
        <Kpi label="부가세 예상" value={formatKRW(summary.vatPayable)} foot="양수 납부 · 음수 환급" icon={<FileSpreadsheet size={16} />} />
        <Kpi label="검토" value={`${reviewCount}건`} foot={`위험 ${summary.riskCount}건`} icon={<AlertTriangle size={16} />} />
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
  csvTemplates,
  onImported
}: {
  companyId: string;
  csvTemplates: CsvTemplate[];
  onImported: (transactions: AppTransaction[]) => void;
}) {
  const [sourceType, setSourceType] = useState<SourceType>("BANK");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping>({});
  const [saving, setSaving] = useState(false);
  const canImport = preview && mapping.transactionDate && mapping.description && (mapping.amount || mapping.depositAmount || mapping.withdrawalAmount);

  function parseFile(file: File) {
    setFileName(file.name);
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
        onImported(payload.transactions);
      }
    } finally {
      setSaving(false);
    }
  }

  const previewRows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.slice(0, 5).map((row, index) => ({
      id: `row-${index}`,
      ...normalizeCsvRow(row, mapping, sourceType, index)
    }));
  }, [mapping, preview, sourceType]);

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
            <button className="primary-button" disabled={!canImport || saving} onClick={() => void submitImport()}>
              {saving ? <Loader2 size={17} /> : <CheckCircle2 size={17} />}
              가져오기
            </button>
          </div>
        </div>
        <div className="panel-body split">
          <div>
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
  const [form, setForm] = useState({
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
  summary,
  transactions,
  journalEntries
}: {
  summary: ReturnType<typeof summarizeTransactions>;
  transactions: AppTransaction[];
  journalEntries: AppJournalEntry[];
}) {
  const expenseByAccount = groupExpensesByAccount(transactions);
  const reviews = buildReviewItems(transactions);
  const ledgerRows = buildLedgerRows(journalEntries);
  const withholdingRows = buildWithholdingRows(transactions);
  const corporateTaxRows = buildCorporateTaxRows(summary, transactions, journalEntries, ledgerRows);
  const filingPackageRows = buildFilingPackageRows(summary, transactions, journalEntries, ledgerRows, withholdingRows);
  return (
    <div className="content">
      <section className="kpi-grid">
        <Kpi label="월 손익" value={formatKRW(summary.profit)} foot={`${formatKRW(summary.revenue)} - ${formatKRW(summary.expense)}`} icon={<BarChart3 size={16} />} />
        <Kpi label="매출 부가세" value={formatKRW(summary.vatOutput)} foot="예수금" icon={<ReceiptText size={16} />} />
        <Kpi label="매입 부가세" value={formatKRW(summary.vatInput)} foot="대급금" icon={<FileSpreadsheet size={16} />} />
        <Kpi label="예상 납부" value={formatKRW(summary.vatPayable)} foot="확정 전" icon={<CheckCircle2 size={16} />} />
        <Kpi label="증빙 누락" value={formatKRW(summary.missingEvidenceAmount)} foot={`${summary.reviewCount}건 검토`} icon={<AlertTriangle size={16} />} />
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
              <button className="secondary-button" onClick={() => downloadCsv("honzang-transactions.csv", buildTransactionCsv(transactions))}>
                <Download size={16} />
                거래
              </button>
              <button className="secondary-button" onClick={() => downloadCsv("honzang-vat-report.csv", buildVatCsv(summary))}>
                <Download size={16} />
                부가세
              </button>
              <button className="secondary-button" onClick={() => downloadCsv("honzang-review-items.csv", buildReviewCsv(reviews))}>
                <Download size={16} />
                검토
              </button>
              <button className="secondary-button" onClick={() => downloadCsv("honzang-withholding-candidates.csv", withholdingRows)}>
                <Download size={16} />
                원천세
              </button>
              <button className="secondary-button" onClick={() => downloadCsv("honzang-corporate-tax-prep.csv", corporateTaxRows)}>
                <Download size={16} />
                법인세
              </button>
            </div>
          </div>
          <div className="panel-body">
            <div className="review-list">
              <ChecklistItem tone="green" title="거래 분류" value={`${formatNumber(transactions.filter((tx) => tx.confirmedAccount || tx.suggestedAccount).length)}건`} />
              <ChecklistItem tone={summary.missingEvidenceAmount > 0 ? "red" : "green"} title="증빙 확인" value={formatKRW(summary.missingEvidenceAmount)} />
              <ChecklistItem tone={summary.vatPayable > 0 ? "amber" : "green"} title="부가세" value={formatKRW(summary.vatPayable)} />
              <ChecklistItem tone={summary.riskCount > 0 ? "amber" : "green"} title="원천세/대표자" value={`${summary.riskCount}건`} />
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">신고 패키지</h2>
          <div className="toolbar">
            <span className="status blue">{formatNumber(filingPackageRows.length)}개 항목</span>
            <button className="secondary-button" onClick={() => downloadCsv("honzang-filing-package.csv", filingPackageRows)}>
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
            <span className="status blue">{formatNumber(journalEntries.length)}개 분개</span>
            <button className="secondary-button" onClick={() => downloadCsv("honzang-ledger.csv", buildLedgerCsv(ledgerRows))}>
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
  onSaved
}: {
  company: AppCompany;
  accounts: AppAccount[];
  onSaved: (company: AppCompany) => void;
}) {
  const [form, setForm] = useState<AppCompany>(company);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setForm(company);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [company]);

  function updateForm<K extends keyof AppCompany>(key: K, value: AppCompany[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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

  return (
    <div className="content">
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

function groupExpensesByAccount(transactions: AppTransaction[]) {
  const grouped = new Map<string, { name: string; amount: number; count: number }>();
  transactions
    .filter((transaction) => transaction.withdrawalAmount > 0)
    .forEach((transaction) => {
      const name = transaction.confirmedAccount?.name ?? transaction.suggestedAccount?.name ?? "미분류";
      const current = grouped.get(name) ?? { name, amount: 0, count: 0 };
      current.amount += transaction.withdrawalAmount;
      current.count += 1;
      grouped.set(name, current);
    });
  return [...grouped.values()].sort((a, b) => b.amount - a.amount);
}

function inferMapping(headers: string[], sourceType: SourceType): CsvColumnMapping {
  const find = (...keywords: string[]) => headers.find((header) => keywords.some((keyword) => header.toLowerCase().includes(keyword.toLowerCase())));
  return {
    transactionDate: find("거래일", "일자", "사용일", "승인일", "작성일", "date"),
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
