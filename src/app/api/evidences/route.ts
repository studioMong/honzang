import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_COMPANY_ID } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { sampleEvidences } from "@/lib/sample-data";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { serializeEvidence } from "@/lib/server/serializers";

const evidenceSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  evidenceType: z.string().min(1).max(80),
  issueDate: z.string().optional().nullable(),
  counterparty: z.string().max(120).optional().nullable(),
  businessRegistrationNumber: z.string().max(40).optional().nullable(),
  supplyAmount: z.coerce.number().nonnegative().optional().nullable(),
  vatAmount: z.coerce.number().nonnegative().optional().nullable(),
  totalAmount: z.coerce.number().nonnegative().optional().nullable(),
  fileName: z.string().max(240).optional().nullable(),
  fileUrl: z.string().max(500).optional().nullable(),
  fileDataUrl: z.string().max(1_500_000).optional().nullable(),
  fileMimeType: z.string().max(120).optional().nullable(),
  fileSize: z.coerce.number().int().nonnegative().max(750_000).optional().nullable(),
  transactionId: z.string().optional().nullable()
});

export async function GET() {
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({ evidences: sampleEvidences, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const evidences = await db.evidence.findMany({
    where: { companyId: company.id },
    include: {
      transaction: {
        include: {
          suggestedAccount: true,
          confirmedAccount: true
        }
      }
    },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 300
  });

  return NextResponse.json({ evidences: evidences.map(serializeEvidence), mode: "database" });
}

export async function POST(request: Request) {
  const parsed = evidenceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const db = getPrisma();

  if (!db) {
    return NextResponse.json({
      ok: true,
      evidence: {
        id: `ev-preview-${Date.now()}`,
        ...payload
      },
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
  const transaction = payload.transactionId
    ? await db.transaction.findFirst({
        where: {
          id: payload.transactionId,
          companyId: company.id
        }
      })
    : null;

  if (payload.transactionId && !transaction) {
    return NextResponse.json({ ok: false, message: "거래를 찾을 수 없습니다." }, { status: 404 });
  }

  const evidence = await db.$transaction(async (tx) => {
    const created = await tx.evidence.create({
      data: {
        companyId: company.id,
        transactionId: transaction?.id ?? null,
        evidenceType: payload.evidenceType,
        issueDate: payload.issueDate ? new Date(payload.issueDate) : null,
        counterparty: payload.counterparty,
        businessRegistrationNumber: payload.businessRegistrationNumber,
        supplyAmount: payload.supplyAmount,
        vatAmount: payload.vatAmount,
        totalAmount: payload.totalAmount,
        fileName: payload.fileName,
        fileUrl: payload.fileUrl,
        rawPayload: {
          fileDataUrl: payload.fileDataUrl ?? null,
          fileMimeType: payload.fileMimeType ?? null,
          fileSize: payload.fileSize ?? null
        }
      }
    });

    if (transaction) {
      await tx.transaction.update({
        where: { id: transaction.id },
        data: { evidenceStatus: "MATCHED" }
      });
    }

    return tx.evidence.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        transaction: {
          include: {
            suggestedAccount: true,
            confirmedAccount: true
          }
        }
      }
    });
  });

  return NextResponse.json({ ok: true, evidence: serializeEvidence(evidence), mode: "database" });
}
