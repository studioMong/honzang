import assert from "node:assert/strict";
import { CLOSING_SNAPSHOT_PACKAGE_FILES, buildClosingSnapshotExportPayload, buildClosingSnapshotWorkbookSheets, buildClosingSnapshotZipFiles, type ClosingSnapshotReportPayload } from "../src/lib/closing-snapshot-export";
import { sampleClosingPeriods } from "../src/lib/sample-data";
import { toCsvFileContent } from "../src/lib/table-export";
import { createXlsxBytes } from "../src/lib/xlsx";
import { createZipBytes } from "../src/lib/zip";

const GENERATED_AT = "2026-06-18T00:00:00.000Z";
const closingPeriod = sampleClosingPeriods.find((period) => period.period === "2026-05");

assert.ok(closingPeriod, "sample closing period should include 2026-05");

const reportPayload = extractReportPayload(closingPeriod.summaryPayload);
const exportPayload = buildClosingSnapshotExportPayload(closingPeriod, reportPayload, GENERATED_AT);

assert.equal(exportPayload.app, "혼자장부", "closing snapshot export should identify the app");
assert.equal(exportPayload.exportType, "closing-period-snapshot", "closing snapshot export should identify the export type");
assert.equal(exportPayload.generatedAt, GENERATED_AT, "closing snapshot export should support deterministic generatedAt values");
assert.equal(exportPayload.closingPeriod.period, "2026-05", "closing snapshot export should preserve the closing period");
assert.equal(exportPayload.counts.transactionCount, 4, "closing snapshot export should preserve transaction counts");
assert.equal(exportPayload.counts.filingInputSummaryRows, 2, "closing snapshot export should count filing input rows");
assert.ok(exportPayload.summaryRows.some((row) => row.항목 === "마감 월" && row.값 === "2026년 5월"), "summary rows should include a Korean period label");
assert.ok(exportPayload.summaryRows.some((row) => row.항목 === "통장 잔액 대조" && row.값 === "대조 완료"), "summary rows should include bank balance status");

const zipFiles = buildClosingSnapshotZipFiles(exportPayload);
assert.deepEqual(
  zipFiles.map((file) => file.path),
  ["manifest.json", ...CLOSING_SNAPSHOT_PACKAGE_FILES],
  "closing snapshot ZIP should expose a stable manifest and CSV file order"
);

const manifestFile = zipFiles.find((file) => file.path === "manifest.json");
assert.ok(manifestFile && typeof manifestFile.content === "string", "closing snapshot ZIP should include a JSON manifest");
const manifest = JSON.parse(manifestFile.content);
assert.deepEqual(manifest.files, CLOSING_SNAPSHOT_PACKAGE_FILES, "closing snapshot manifest should list every packaged file");
assert.equal(manifest.counts.filingInputSummaryRows, 2, "closing snapshot manifest should preserve filing input counts");

const jsonFile = zipFiles.find((file) => file.path === "closing-snapshot.json");
assert.ok(jsonFile && typeof jsonFile.content === "string", "closing snapshot ZIP should include the full JSON export");
assert.ok(jsonFile.content.includes("\"storedSummaryPayload\""), "closing snapshot JSON should preserve the stored summary payload");
assert.ok(jsonFile.content.includes("과세 매출 공급가액"), "closing snapshot JSON should include filing input labels");

const filingInputCsv = zipFiles.find((file) => file.path === "csv/filing-input-summary.csv");
assert.ok(filingInputCsv && typeof filingInputCsv.content === "string", "closing snapshot ZIP should include filing input CSV");
assert.ok(filingInputCsv.content.startsWith("\uFEFF"), "closing snapshot CSV should include a UTF-8 BOM for spreadsheet compatibility");
assert.ok(filingInputCsv.content.includes("과세 매출 공급가액"), "closing snapshot CSV should include filing input labels");
assert.ok(filingInputCsv.content.includes("승인 분개/원장"), "closing snapshot CSV should include ledger filing input labels");

assert.equal(
  toCsvFileContent([{ 항목: "CSV 보안", 값: "=1+1" }]),
  "\uFEFF항목,값\nCSV 보안,'=1+1",
  "CSV exports should neutralize formula-like cells"
);

const zipText = decodeBytes(createZipBytes(zipFiles));
for (const fileName of ["manifest.json", "closing-snapshot.json", "csv/filing-input-summary.csv", "csv/ledger.csv"]) {
  assert.ok(zipText.includes(fileName), `closing snapshot ZIP bytes should contain ${fileName}`);
}
assert.ok(zipText.includes("월 마감 스냅샷"), "closing snapshot ZIP bytes should contain summary CSV content");
assert.ok(zipText.includes("과세 매출 공급가액"), "closing snapshot ZIP bytes should contain filing input CSV content");

const workbookSheets = buildClosingSnapshotWorkbookSheets(exportPayload);
assert.deepEqual(
  workbookSheets.map((sheet) => sheet.name),
  ["요약", "최종점검", "신고일정", "제출가이드", "입력값요약", "자료수집", "신고패키지", "검토", "원천세", "복식검증", "법인세", "현금흐름", "잔액대조", "재무제표", "원장"],
  "closing snapshot XLSX should expose the expected sheets"
);
assert.equal(workbookSheets[4].rows.length, 2, "closing snapshot XLSX filing input sheet should contain sample rows");

const xlsxText = decodeBytes(createXlsxBytes(workbookSheets));
assert.ok(xlsxText.includes("xl/workbook.xml"), "closing snapshot XLSX bytes should include workbook metadata");
assert.ok(xlsxText.includes("name=\"입력값요약\""), "closing snapshot XLSX workbook should include the filing input sheet");
assert.ok(xlsxText.includes("xl/worksheets/sheet15.xml"), "closing snapshot XLSX bytes should include the ledger worksheet");
assert.ok(xlsxText.includes("과세 매출 공급가액"), "closing snapshot XLSX sheet XML should include filing input labels");

console.log("Closing snapshot export verification passed.");

function extractReportPayload(summaryPayload: unknown): ClosingSnapshotReportPayload {
  if (!isRecord(summaryPayload)) {
    throw new Error("sample closing period should contain a summary payload");
  }
  const report = isRecord(summaryPayload.report) ? summaryPayload.report : summaryPayload;
  return report as unknown as ClosingSnapshotReportPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeBytes(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}
