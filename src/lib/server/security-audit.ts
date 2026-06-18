import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";

export type AccessAuditAction = "ACCESS_LOGIN_SUCCESS" | "ACCESS_LOGIN_FAILURE" | "ACCESS_LOGIN_LOCKED" | "ACCESS_LOGOUT";

type AccessAuditScalar = string | number | boolean | null;
type AccessAuditMetadata = Record<string, AccessAuditScalar | undefined>;

export async function recordAccessAuditEvent(
  request: Request,
  event: {
    action: AccessAuditAction;
    summary: string;
    metadata?: AccessAuditMetadata;
  }
) {
  const db = getPrisma();
  if (!db) return;

  try {
    const company = await ensureDefaultCompany(db);
    await recordAuditEvent(db, {
      companyId: company.id,
      action: event.action,
      entityType: "ACCESS_SESSION",
      entityId: null,
      summary: event.summary,
      metadata: buildAccessAuditMetadata(request, event.metadata)
    });
  } catch {
    // Audit writes are secondary; access control should keep working during DB incidents.
  }
}

function buildAccessAuditMetadata(request: Request, metadata: AccessAuditMetadata = {}): Prisma.InputJsonObject {
  return omitUndefined({
    method: request.method,
    path: requestPathname(request.url),
    sourceHash: hashForAudit(requestSource(request)),
    userAgentHash: hashForAudit(request.headers.get("user-agent") ?? "unknown"),
    ...metadata
  });
}

function requestSource(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwardedFor || realIp || "local";
}

function requestPathname(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return "unknown";
  }
}

function hashForAudit(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function omitUndefined(input: AccessAuditMetadata): Prisma.InputJsonObject {
  const output: Record<string, AccessAuditScalar> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}
