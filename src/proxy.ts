import { NextResponse, type NextRequest } from "next/server";
import { isAccessControlEnabled, isRequestAuthenticated } from "@/lib/server/access-control";

const PUBLIC_PATHS = new Set([
  "/access",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
  "/api/health",
  "/api/version",
  "/favicon.ico",
  "/icon.svg",
  "/manifest.webmanifest",
  "/offline.html",
  "/sw.js"
]);

const PUBLIC_PREFIXES = ["/_next/", "/icons/", "/samples/"];

export async function proxy(request: NextRequest) {
  if (!isAccessControlEnabled() || isPublicRequest(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (await isRequestAuthenticated(request)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "접근 코드가 필요합니다."
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  const accessUrl = request.nextUrl.clone();
  accessUrl.pathname = "/access";
  accessUrl.search = "";
  accessUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(accessUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};

function isPublicRequest(pathname: string) {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
