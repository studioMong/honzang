import { NextResponse } from "next/server";
import packageInfo from "../../../../package.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    app: packageInfo.name,
    version: packageInfo.version,
    environment: process.env.NODE_ENV ?? "unknown",
    railway: {
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      branch: process.env.RAILWAY_GIT_BRANCH ?? null,
      service: process.env.RAILWAY_SERVICE_NAME ?? null,
      environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null
    }
  });
}
