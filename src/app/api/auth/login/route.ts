import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE_MAX_AGE_SECONDS, ACCESS_COOKIE_NAME, createAccessToken, isAccessControlEnabled, verifyAccessCode } from "@/lib/server/access-control";

export async function POST(request: NextRequest) {
  if (!isAccessControlEnabled()) {
    return NextResponse.json({ ok: true, enabled: false });
  }

  const body = await request.json().catch(() => ({}));
  if (!verifyAccessCode(body.code)) {
    return NextResponse.json({ ok: false, message: "접근 코드가 올바르지 않습니다." }, { status: 401 });
  }

  const token = await createAccessToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "접근 코드 설정을 확인해야 합니다." }, { status: 500 });
  }

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
