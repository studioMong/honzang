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
  CsvTemplate,
  ReviewItem
} from "@/types";
import { formatNumber } from "@/lib/format";
import { toCsvFileContent } from "@/lib/table-export";
import type { ZipFile } from "@/lib/zip";

type BackupTone = "green" | "amber" | "red" | "blue";

export type OriginalImportFile = {
  importBatchId: string;
  originalFileName: string;
  originalFileHash?: string | null;
  originalFileMimeType?: string | null;
  originalFileSize?: number | null;
  originalFileText: string;
};

export type BackupReadinessRow = {
  데이터: string;
  상태: string;
  톤: BackupTone;
  건수: string;
  확인: string;
};

export type DataRetentionRow = {
  데이터: string;
  포함정보: string;
  보관위치: string;
  보관기준: string;
  삭제방법: string;
  상태: string;
  톤: BackupTone;
};

export type WorkspaceBackupInput = {
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
};

export type WorkspaceBackupPayload = ReturnType<typeof buildWorkspaceBackupPayload>;

export function buildDataRetentionRows({
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
}: Omit<WorkspaceBackupInput, "mode" | "company" | "accounts" | "originalImportFiles">): DataRetentionRow[] {
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
      삭제방법: "수기 거래는 거래내역에서 수정/개별 삭제, CSV 거래는 업로드 배치 삭제",
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

export function buildBackupReadinessRows({
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
}: Omit<WorkspaceBackupInput, "mode" | "csvTemplates" | "originalImportFiles"> & { originalImportFiles?: OriginalImportFile[] }): BackupReadinessRow[] {
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
      톤: approvedEntries > 0 || taxReports.length > 0 ? "green" : "amber",
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

export function buildWorkspaceBackupPayload(input: WorkspaceBackupInput, generatedAt: Date | string = new Date()) {
  const dataRetentionRows = buildDataRetentionRows(input);
  const backupReadinessRows = buildBackupReadinessRows(input);

  return {
    app: "혼자장부",
    backupVersion: 1,
    generatedAt: typeof generatedAt === "string" ? generatedAt : generatedAt.toISOString(),
    mode: input.mode,
    counts: {
      accounts: input.accounts.length,
      csvTemplates: input.csvTemplates.length,
      importBatches: input.importBatches.length,
      originalImportFiles: input.originalImportFiles.length,
      transactions: input.transactions.length,
      evidences: input.evidences.length,
      journalEntries: input.journalEntries.length,
      taxReports: input.taxReports.length,
      vendors: input.vendors.length,
      classificationRules: input.classificationRules.length,
      auditEvents: input.auditEvents.length,
      closingPeriods: input.closingPeriods.length,
      reviewItems: input.reviewItems.length
    },
    dataRetentionRows,
    backupReadinessRows,
    company: input.company,
    accounts: input.accounts,
    csvTemplates: input.csvTemplates,
    importBatches: input.importBatches,
    originalImportFiles: input.originalImportFiles,
    transactions: input.transactions,
    evidences: input.evidences,
    journalEntries: input.journalEntries,
    taxReports: input.taxReports,
    vendors: input.vendors,
    classificationRules: input.classificationRules,
    auditEvents: input.auditEvents,
    closingPeriods: input.closingPeriods,
    reviewItems: input.reviewItems,
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

export function buildWorkspaceBackupZipFiles(payload: WorkspaceBackupPayload, evidences: AppEvidence[]) {
  const importSourceFiles = buildImportSourceZipEntries(payload.originalImportFiles);
  const evidenceFiles = buildEvidenceFileZipEntries(evidences);
  const sourceBatchesWithFile = payload.importBatches.filter((batch) => batch.hasOriginalFile).length;
  const externalEvidenceFiles = evidences.filter((evidence) => !evidence.fileDataUrl && evidence.fileUrl).length;
  const evidenceRecordsWithoutFile = evidences.filter((evidence) => !evidence.fileDataUrl && !evidence.fileUrl).length;
  return [
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
          originalCsvFileSummary: {
            expected: sourceBatchesWithFile,
            included: importSourceFiles.length,
            missing: Math.max(sourceBatchesWithFile - importSourceFiles.length, 0)
          },
          evidenceFiles: evidenceFiles.map((file) => file.path),
          evidenceFileSummary: {
            dbIncluded: evidenceFiles.length,
            externalLinks: externalEvidenceFiles,
            recordsWithoutFile: evidenceRecordsWithoutFile
          },
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
}

export function buildBackupExportMessage(
  label: "JSON" | "ZIP",
  importBatches: AppImportBatch[],
  originalImportFiles: OriginalImportFile[],
  evidences: AppEvidence[]
): { tone: "green" | "amber"; text: string } {
  const sourceBatchesWithFile = importBatches.filter((batch) => batch.hasOriginalFile).length;
  const missingOriginalFiles = Math.max(sourceBatchesWithFile - originalImportFiles.length, 0);
  const externalEvidenceFiles = evidences.filter((evidence) => !evidence.fileDataUrl && evidence.fileUrl).length;
  const evidenceRecordsWithoutFile = evidences.filter((evidence) => !evidence.fileDataUrl && !evidence.fileUrl).length;
  const hasCaution = missingOriginalFiles > 0 || externalEvidenceFiles > 0 || evidenceRecordsWithoutFile > 0;

  return {
    tone: hasCaution ? "amber" : "green",
    text: `${label} 백업을 생성했습니다. 원본 CSV ${formatNumber(originalImportFiles.length)}/${formatNumber(sourceBatchesWithFile)}개 포함, DB 증빙 ${formatNumber(evidences.filter((evidence) => evidence.fileDataUrl).length)}개 포함${
      hasCaution
        ? `, 확인 필요: 원본 CSV 누락 ${formatNumber(missingOriginalFiles)}개, 외부 증빙 ${formatNumber(externalEvidenceFiles)}개, 파일 없는 증빙 ${formatNumber(evidenceRecordsWithoutFile)}개`
        : ""
    }`
  };
}

export function buildImportSourceZipEntries(originalImportFiles: OriginalImportFile[]) {
  const usedPaths = new Set<string>();
  return originalImportFiles.map((file) => {
    const fileName = safeArchiveFileName(file.originalFileName, `${file.importBatchId}.csv`);
    return {
      path: uniqueZipPath(`imports/original-csv/${fileName}`, usedPaths),
      content: file.originalFileText
    };
  });
}

export function buildEvidenceFileZipEntries(evidences: AppEvidence[]) {
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

function hasText(value?: string | null) {
  return Boolean(value?.trim());
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
