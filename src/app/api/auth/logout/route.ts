import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE_NAME } from "@/lib/server/access-control";
import { recordAccessAuditEvent } from "@/lib/server/security-audit";

export async function POST(request: NextRequest) {
  await recordAccessAuditEvent(request, {
    action: "ACCESS_LOGOUT",
    summary: "접근 세션이 로그아웃되었습니다."
  });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
  return response;
}
