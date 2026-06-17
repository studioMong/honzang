import assert from "node:assert/strict";
import { buildDataSourceRows } from "../src/lib/data-sources";
import { SOURCE_TYPE_LABELS } from "../src/lib/defaults";
import type { AppImportBatch, AppTransaction } from "../src/types";

const sourceBatches: AppImportBatch[] = [
  batch("batch-bank-june", "BANK", true),
  batch("batch-bank-may", "BANK", true),
  batch("batch-card-history", "CARD", false)
];

const rows = buildDataSourceRows(
  [
    transaction("tx-bank-june", "batch-bank-june", "BANK", "2026-06-17"),
    transaction("tx-card-manual", null, "CARD", "2026-06-18")
  ],
  sourceBatches
);

const bankRow = rows.find((row) => row.자료 === SOURCE_TYPE_LABELS.BANK);
assert.equal(bankRow?.거래, "1건", "BANK row should count the selected-period transactions");
assert.equal(bankRow?.업로드, "1개 업로드", "BANK row should only count batches linked to selected transactions");
assert.equal(bankRow?.원본, "원본 CSV 1/1개", "BANK row should only count linked original CSV files");

const cardRow = rows.find((row) => row.자료 === SOURCE_TYPE_LABELS.CARD);
assert.equal(cardRow?.거래, "1건", "CARD row should count transactions without an import batch");
assert.equal(cardRow?.업로드, "1개 업로드", "CARD row should fall back to source upload history without transaction batch ids");
assert.equal(cardRow?.원본, "원본 CSV 0/1개", "CARD row should show missing original CSV retention");

const salesRow = rows.find((row) => row.자료 === SOURCE_TYPE_LABELS.HOMETAX_SALES);
assert.equal(salesRow?.상태, "확인 필요", "missing required source should need confirmation");
assert.equal(salesRow?.업로드, "업로드 이력 없음", "missing required source should show no upload history");

const pgRow = rows.find((row) => row.자료 === SOURCE_TYPE_LABELS.PG);
assert.equal(pgRow?.상태, "선택", "missing PG source should remain optional");

console.log("Data source status verification passed.");

function batch(id: string, sourceType: AppImportBatch["sourceType"], hasOriginalFile: boolean): AppImportBatch {
  return {
    id,
    sourceType,
    originalFileName: `${id}.csv`,
    hasOriginalFile,
    rowCount: 1,
    importedAt: "2026-06-18T00:00:00.000Z"
  };
}

function transaction(id: string, importBatchId: string | null, sourceType: AppTransaction["sourceType"], transactionDate: string): AppTransaction {
  return {
    id,
    importBatchId,
    sourceType,
    transactionDate,
    description: `${id} transaction`,
    direction: "WITHDRAWAL",
    depositAmount: 0,
    withdrawalAmount: 1000,
    evidenceStatus: "UNCHECKED"
  };
}
