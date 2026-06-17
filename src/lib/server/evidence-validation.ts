import { Buffer } from "node:buffer";

export const MAX_EVIDENCE_FILE_SIZE = 750_000;
export const MAX_EVIDENCE_FILE_DATA_URL_LENGTH = 1_500_000;

export type EvidenceFileValidationInput = {
  fileDataUrl?: string | null;
  fileMimeType?: string | null;
  fileSize?: number | null;
};

export function parseStrictEvidenceDate(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const separated = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (separated) {
    const [, year, month, day] = separated;
    return validDateParts(Number(year), Number(month), Number(day));
  }

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const [, year, month, day] = compact;
    return validDateParts(Number(year), Number(month), Number(day));
  }

  return null;
}

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

function validDateParts(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
