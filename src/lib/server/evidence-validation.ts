import { Buffer } from "node:buffer";
import { MAX_EVIDENCE_FILE_DATA_URL_LENGTH, MAX_EVIDENCE_FILE_SIZE } from "@/lib/file-limits";
import { parseStrictDate } from "@/lib/server/date-validation";

export { MAX_EVIDENCE_FILE_DATA_URL_LENGTH, MAX_EVIDENCE_FILE_SIZE };

export type EvidenceFileValidationInput = {
  fileDataUrl?: string | null;
  fileMimeType?: string | null;
  fileSize?: number | null;
};

export type EvidenceAmountValidationInput = {
  supplyAmount?: number | null;
  vatAmount?: number | null;
  totalAmount?: number | null;
};

export const parseStrictEvidenceDate = parseStrictDate;

export function normalizeEvidenceFileUrl(value: string | null | undefined) {
  return value?.trim() || null;
}

export function validateEvidenceFile(payload: EvidenceFileValidationInput) {
  if (!payload.fileDataUrl) return null;

  const dataUrl = parseBase64DataUrl(payload.fileDataUrl);
  if (!dataUrl) return "증빙 파일 데이터 형식이 올바르지 않습니다.";
  if (payload.fileMimeType && dataUrl.mimeType !== payload.fileMimeType) {
    return "증빙 파일 MIME 정보가 실제 데이터와 일치하지 않습니다.";
  }
  if (dataUrl.byteLength > MAX_EVIDENCE_FILE_SIZE) {
    return `증빙 파일은 ${MAX_EVIDENCE_FILE_SIZE}바이트 이하만 DB에 보관할 수 있습니다.`;
  }
  if (payload.fileSize != null && payload.fileSize !== dataUrl.byteLength) {
    return "증빙 파일 크기 정보가 실제 데이터와 일치하지 않습니다.";
  }

  return null;
}

export function validateEvidenceFileUrl(value: string | null | undefined) {
  const normalized = normalizeEvidenceFileUrl(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:" ? null : "증빙 파일 URL은 http 또는 https만 사용할 수 있습니다.";
  } catch {
    return "증빙 파일 URL 형식이 올바르지 않습니다.";
  }
}

export function validateEvidenceAmounts(payload: EvidenceAmountValidationInput) {
  const supplyAmount = payload.supplyAmount ?? null;
  const vatAmount = payload.vatAmount ?? null;
  const totalAmount = payload.totalAmount ?? null;

  if (totalAmount !== null && supplyAmount !== null && roundWon(totalAmount) < roundWon(supplyAmount)) {
    return "증빙 합계는 공급가액보다 작을 수 없습니다.";
  }
  if (totalAmount !== null && vatAmount !== null && roundWon(totalAmount) < roundWon(vatAmount)) {
    return "증빙 합계는 부가세보다 작을 수 없습니다.";
  }
  if (
    supplyAmount !== null &&
    vatAmount !== null &&
    totalAmount !== null &&
    roundWon(supplyAmount) + roundWon(vatAmount) !== roundWon(totalAmount)
  ) {
    return "증빙 합계는 공급가액과 부가세의 합과 일치해야 합니다.";
  }

  return null;
}

function parseBase64DataUrl(value: string) {
  const matched = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!matched) return null;

  const [, mimeType, base64] = matched;
  if (!mimeType || !base64 || base64.length % 4 !== 0) return null;

  return {
    mimeType,
    byteLength: Buffer.from(base64, "base64").length
  };
}

function roundWon(value: number) {
  return Math.round(value);
}
