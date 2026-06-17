import { Buffer } from "node:buffer";

export const MAX_JSON_PAYLOAD_SIZE = 500_000;

export function validateJsonPayloadSize(value: unknown, label: string) {
  if (value === null || value === undefined) return null;

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return `${label}는 JSON으로 저장할 수 있는 값이어야 합니다.`;
  }

  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > MAX_JSON_PAYLOAD_SIZE) {
    return `${label}는 ${MAX_JSON_PAYLOAD_SIZE}바이트 이하만 저장할 수 있습니다.`;
  }

  return null;
}
