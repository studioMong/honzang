import { NextResponse, type NextRequest } from "next/server";
import { isAccessControlEnabled, isRequestAuthenticated } from "@/lib/server/access-control";

export async function GET(request: NextRequest) {
  const enabled = isAccessControlEnabled();
  return NextResponse.json({
    enabled,
    authenticated: enabled ? await isRequestAuthenticated(request) : true
  });
}
