import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export const MAX_STANDARD_JSON_REQUEST_SIZE = 750_000;

export async function parseJsonRequest<T>(
  request: Request,
  schema: ZodType<T>,
  options: { label?: string; maxBytes?: number } = {}
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const label = options.label ?? "요청 본문";
  const maxBytes = options.maxBytes ?? MAX_STANDARD_JSON_REQUEST_SIZE;
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code: "JSON_PAYLOAD_TOO_LARGE", message: `${label}은 ${maxBytes}바이트 이하만 허용됩니다.` }, { status: 413 })
    };
  }

  const text = await request.text().catch(() => null);
  if (text === null) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code: "INVALID_JSON_PAYLOAD", message: `${label}을 읽을 수 없습니다.` }, { status: 400 })
    };
  }
  if (new TextEncoder().encode(text).length > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code: "JSON_PAYLOAD_TOO_LARGE", message: `${label}은 ${maxBytes}바이트 이하만 허용됩니다.` }, { status: 413 })
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code: "INVALID_JSON_PAYLOAD", message: `${label} 형식이 올바르지 않습니다.` }, { status: 400 })
    };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 })
    };
  }

  return { ok: true, data: parsed.data };
}
