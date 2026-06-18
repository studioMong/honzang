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
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function proxy(request: NextRequest) {
  const originResponse = rejectCrossOriginMutation(request);
  if (originResponse) {
    return originResponse;
  }

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

function rejectCrossOriginMutation(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/") || !MUTATION_METHODS.has(request.method.toUpperCase())) {
    return null;
  }

  const origin = request.headers.get("origin");
  if (!origin || isSameOrigin(origin, request)) {
    return null;
  }

  return NextResponse.json(
    {
      ok: false,
      code: "INVALID_ORIGIN",
      message: "요청 출처가 올바르지 않습니다."
    },
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}

function isSameOrigin(origin: string, request: NextRequest) {
  try {
    const parsedOrigin = new URL(origin);
    return requestOrigins(request).some((candidate) => parsedOrigin.protocol === candidate.protocol && parsedOrigin.host === candidate.host);
  } catch {
    return false;
  }
}

function requestOrigins(request: NextRequest) {
  const origins = [{ protocol: request.nextUrl.protocol, host: request.nextUrl.host }];
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocols = [forwardedProto ? `${forwardedProto}:` : null, request.nextUrl.protocol].filter((value): value is string => Boolean(value));

  for (const candidateHost of [forwardedHost, host]) {
    if (!candidateHost) continue;
    for (const protocol of protocols) {
      origins.push({ protocol, host: candidateHost });
    }
  }

  return origins;
}
