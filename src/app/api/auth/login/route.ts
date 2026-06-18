import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ACCESS_COOKIE_MAX_AGE_SECONDS, ACCESS_COOKIE_NAME, createAccessToken, isAccessControlEnabled, verifyAccessCode } from "@/lib/server/access-control";
import { clearAccessFailures, inspectAccessAttempt, recordAccessFailure } from "@/lib/server/access-attempts";
import { recordAccessAuditEvent } from "@/lib/server/security-audit";

const MAX_LOGIN_BODY_BYTES = 2_048;
const loginSchema = z.object({
  code: z.string().min(1).max(200)
});

export async function POST(request: NextRequest) {
  if (!isAccessControlEnabled()) {
    return NextResponse.json({ ok: true, enabled: false });
  }

  const attempt = inspectAccessAttempt(request);
  if (attempt.blocked) {
    return rateLimitedResponse(attempt.retryAfterSeconds);
  }

  const body = await readLoginBody(request);
  if (!body.ok) {
    return body.response;
  }

  if (!verifyAccessCode(body.data.code)) {
    const failure = recordAccessFailure(request);
    if (failure.blocked) {
      await recordAccessAuditEvent(request, {
        action: "ACCESS_LOGIN_LOCKED",
        summary: "접근 코드 실패 횟수 초과로 로그인이 잠금 처리되었습니다.",
        metadata: {
          reason: "failure_threshold",
          retryAfterSeconds: failure.retryAfterSeconds,
          remainingAttempts: 0
        }
      });
      return rateLimitedResponse(failure.retryAfterSeconds);
    }
    await recordAccessAuditEvent(request, {
      action: "ACCESS_LOGIN_FAILURE",
      summary: "접근 코드 로그인이 실패했습니다.",
      metadata: {
        remainingAttempts: failure.remainingAttempts
      }
    });
    return NextResponse.json(
      {
        ok: false,
        message: "접근 코드가 올바르지 않습니다.",
        remainingAttempts: failure.remainingAttempts
      },
      { status: 401 }
    );
  }

  const token = await createAccessToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "접근 코드와 쿠키 salt 설정을 확인해야 합니다." }, { status: 500 });
  }

  clearAccessFailures(request);
  await recordAccessAuditEvent(request, {
    action: "ACCESS_LOGIN_SUCCESS",
    summary: "접근 코드 로그인이 성공했습니다.",
    metadata: {
      maxAgeSeconds: ACCESS_COOKIE_MAX_AGE_SECONDS
    }
  });
  const response = NextResponse.json({ ok: true, enabled: true });
  response.cookies.set(ACCESS_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
  return response;
}

async function readLoginBody(request: NextRequest): Promise<{ ok: true; data: z.infer<typeof loginSchema> } | { ok: false; response: NextResponse }> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_LOGIN_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code: "LOGIN_PAYLOAD_TOO_LARGE", message: "로그인 요청 본문이 너무 큽니다." }, { status: 413 })
    };
  }

  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).length > MAX_LOGIN_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code: "LOGIN_PAYLOAD_TOO_LARGE", message: "로그인 요청 본문이 너무 큽니다." }, { status: 413 })
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code: "INVALID_LOGIN_PAYLOAD", message: "로그인 요청 형식이 올바르지 않습니다." }, { status: 400 })
    };
  }

  const parsed = loginSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code: "INVALID_LOGIN_PAYLOAD", message: "로그인 요청 형식이 올바르지 않습니다." }, { status: 400 })
    };
  }

  return { ok: true, data: parsed.data };
}

function rateLimitedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      ok: false,
      message: "접근 코드 입력 횟수가 초과되었습니다. 잠시 후 다시 시도하세요.",
      retryAfterSeconds
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds)
      }
    }
  );
}
