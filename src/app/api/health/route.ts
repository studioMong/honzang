import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({
      ok: true,
      database: "not_configured",
      app: "honzang"
    });
  }

  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "connected", app: "honzang" });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: "error",
        message: error instanceof Error ? error.message : "Unknown database error"
      },
      { status: 503 }
    );
  }
}
