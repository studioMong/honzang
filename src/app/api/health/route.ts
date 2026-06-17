import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import packageInfo from "../../../../package.json";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({
      ok: true,
      database: "not_configured",
      mode: "sample",
      app: packageInfo.name,
      version: packageInfo.version,
      railway: railwayMetadata()
    });
  }

  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      database: "connected",
      mode: "database",
      app: packageInfo.name,
      version: packageInfo.version,
      railway: railwayMetadata()
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: "error",
        mode: "database",
        app: packageInfo.name,
        version: packageInfo.version,
        railway: railwayMetadata(),
        message: error instanceof Error ? error.message : "Unknown database error"
      },
      { status: 503 }
    );
  }
}

function railwayMetadata() {
  return {
    commitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    branch: process.env.RAILWAY_GIT_BRANCH ?? null,
    service: process.env.RAILWAY_SERVICE_NAME ?? null,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null
  };
}
