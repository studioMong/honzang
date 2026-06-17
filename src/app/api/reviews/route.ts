import { NextResponse } from "next/server";
import { z } from "zod";
import { buildReviewItems } from "@/lib/accounting";
import { getPrisma } from "@/lib/db";
import { sampleTransactions } from "@/lib/sample-data";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { serializeReviewItem, serializeTransaction } from "@/lib/server/serializers";
import type { ReviewItem } from "@/types";

const reviewStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["OPEN", "RESOLVED", "IGNORED"])
});

const transactionInclude = {
  suggestedAccount: true,
  confirmedAccount: true
};

const reviewInclude = {
  transaction: {
    include: transactionInclude
  }
};

export async function GET() {
  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ reviewItems: buildReviewItems(sampleTransactions), mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const transactions = await db.transaction.findMany({
    where: { companyId: company.id },
    include: transactionInclude,
    orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }]
  });
  const candidates = buildReviewItems(transactions.map(serializeTransaction));

  const existing = await db.reviewItem.findMany({
    where: {
      companyId: company.id,
      targetType: "TRANSACTION"
    },
    include: reviewInclude
  });
  const activeKeys = new Set(candidates.map(reviewCandidateKey));
  const existingKeys = new Set(existing.map((item) => persistedReviewKey(item.targetId, item.reason)));

  const createRows = candidates.flatMap((candidate) => {
    if (!candidate.transaction || existingKeys.has(reviewCandidateKey(candidate))) return [];
    return [
      {
        companyId: company.id,
        transactionId: candidate.transaction.id,
        targetType: "TRANSACTION",
        targetId: candidate.transaction.id,
        severity: candidate.severity,
        reason: candidate.reason,
        recommendation: candidate.recommendation ?? null,
        status: candidate.status
      }
    ];
  });

  if (createRows.length > 0) {
    await db.reviewItem.createMany({ data: createRows });
  }

  const staleOpenIds = existing
    .filter((item) => item.status === "OPEN" && !activeKeys.has(persistedReviewKey(item.targetId, item.reason)))
    .map((item) => item.id);
  if (staleOpenIds.length > 0) {
    await db.reviewItem.updateMany({
      where: {
        companyId: company.id,
        id: { in: staleOpenIds }
      },
      data: { status: "RESOLVED" }
    });
  }

  const reviewItems = await db.reviewItem.findMany({
    where: { companyId: company.id },
    include: reviewInclude,
    orderBy: [{ status: "asc" }, { severity: "desc" }, { createdAt: "desc" }]
  });

  return NextResponse.json({ reviewItems: reviewItems.map(serializeReviewItem), mode: "database" });
}

export async function PATCH(request: Request) {
  const parsed = reviewStatusSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({
      ok: true,
      mode: "sample",
      reviewItem: {
        id: parsed.data.id,
        status: parsed.data.status
      }
    });
  }

  const company = await ensureDefaultCompany(db);
  const existing = await db.reviewItem.findFirst({
    where: {
      id: parsed.data.id,
      companyId: company.id
    }
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "검토 항목을 찾을 수 없습니다." }, { status: 404 });
  }

  const reviewItem = await db.reviewItem.update({
    where: { id: parsed.data.id },
    data: { status: parsed.data.status },
    include: reviewInclude
  });
  await recordAuditEvent(db, {
    companyId: company.id,
    action: "REVIEW_STATUS_UPDATE",
    entityType: "REVIEW_ITEM",
    entityId: reviewItem.id,
    summary: `검토 항목 상태를 ${parsed.data.status}로 변경했습니다: ${reviewItem.reason}`,
    metadata: {
      transactionId: reviewItem.transactionId ?? null,
      status: parsed.data.status,
      severity: reviewItem.severity
    }
  });

  return NextResponse.json({ ok: true, reviewItem: serializeReviewItem(reviewItem), mode: "database" });
}

function reviewCandidateKey(candidate: ReviewItem) {
  return persistedReviewKey(candidate.transaction?.id ?? "", candidate.reason);
}

function persistedReviewKey(targetId: string, reason: string) {
  return `${targetId}\n${reason}`;
}
