import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE_MAX_AGE_SECONDS, ACCESS_COOKIE_NAME, createAccessToken, isAccessControlEnabled, verifyAccessCode } from "@/lib/server/access-control";
import { clearAccessFailures, inspectAccessAttempt, recordAccessFailure } from "@/lib/server/access-attempts";

export async function POST(request: NextRequest) {
  if (!isAccessControlEnabled()) {
    return NextResponse.json({ ok: true, enabled: false });
  }

  const attempt = inspectAccessAttempt(request);
  if (attempt.blocked) {
    return rateLimitedResponse(attempt.retryAfterSeconds);
  }

  const body = await request.json().catch(() => ({}));
  if (!verifyAccessCode(body.code)) {
    const failure = recordAccessFailure(request);
    if (failure.blocked) {
      return rateLimitedResponse(failure.retryAfterSeconds);
    }
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
    return NextResponse.json({ ok: false, message: "접근 코드 설정을 확인해야 합니다." }, { status: 500 });
  }

  clearAccessFailures(request);
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
