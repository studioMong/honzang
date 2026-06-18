import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { inspectDatabaseSchema, REQUIRED_DATABASE_TABLES } from "@/lib/server/database-schema";
import packageInfo from "../../../../package.json";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({
      ok: true,
      database: "not_configured",
      mode: "sample",
      schema: {
        ok: null,
        status: "not_checked",
        requiredTables: REQUIRED_DATABASE_TABLES.length
      },
      app: packageInfo.name,
      version: packageInfo.version,
      railway: railwayMetadata()
    });
  }

  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: "error",
        mode: "database",
        schema: {
          ok: null,
          status: "not_checked",
          requiredTables: REQUIRED_DATABASE_TABLES.length
        },
        app: packageInfo.name,
        version: packageInfo.version,
        railway: railwayMetadata(),
        message: error instanceof Error ? error.message : "Unknown database error"
      },
      { status: 503 }
    );
  }

  try {
    const schema = await inspectDatabaseSchema(db);
    if (!schema.ok) {
      return NextResponse.json(
        {
          ok: false,
          database: "schema_error",
          mode: "database",
          schema: {
            ok: false,
            status: "missing_tables",
            requiredTables: schema.requiredTables.length,
            missingTables: schema.missingTables
          },
          app: packageInfo.name,
          version: packageInfo.version,
          railway: railwayMetadata(),
          message: `Missing database tables: ${schema.missingTables.join(", ")}`
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      ok: true,
      database: "connected",
      mode: "database",
      schema: {
        ok: true,
        status: "ready",
        requiredTables: schema.requiredTables.length
      },
      app: packageInfo.name,
      version: packageInfo.version,
      railway: railwayMetadata()
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: "schema_error",
        mode: "database",
        schema: {
          ok: null,
          status: "error",
          requiredTables: REQUIRED_DATABASE_TABLES.length
        },
        app: packageInfo.name,
        version: packageInfo.version,
        railway: railwayMetadata(),
        message: error instanceof Error ? error.message : "Unknown database schema error"
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
