import { Buffer } from "node:buffer";

export const MAX_ORIGINAL_FILE_TEXT_SIZE = 2_000_000;

const UTF8_BOM_BYTE_LENGTH = 3;

export type OriginalFileValidationInput = {
  originalFileText?: string | null;
  originalFileSize?: number | null;
};

export function validateOriginalFileText(input: OriginalFileValidationInput) {
  if (!input.originalFileText) return null;

  const byteLength = Buffer.byteLength(input.originalFileText, "utf8");
  if (byteLength > MAX_ORIGINAL_FILE_TEXT_SIZE) {
    return `원본 CSV는 ${MAX_ORIGINAL_FILE_TEXT_SIZE}바이트 이하만 보관할 수 있습니다.`;
  }

  if (input.originalFileSize != null && Math.abs(input.originalFileSize - byteLength) > UTF8_BOM_BYTE_LENGTH) {
    return "원본 CSV 파일 크기 정보가 실제 텍스트 데이터와 일치하지 않습니다.";
  }

  return null;
}
