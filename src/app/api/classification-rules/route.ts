import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_COMPANY_ID } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/server/audit";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { parseJsonRequest } from "@/lib/server/request-json";
import { serializeClassificationRule } from "@/lib/server/serializers";

const sourceTypeSchema = z.enum(["BANK", "CARD", "HOMETAX_SALES", "HOMETAX_PURCHASES", "CASH_RECEIPT", "PG", "MANUAL"]);

const ruleSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  name: z.string().min(1).max(80),
  keyword: z.string().min(1).max(120),
  accountCode: z.string().min(1).max(20),
  sourceType: sourceTypeSchema.optional().nullable(),
  priority: z.coerce.number().int().min(1).max(999).default(100),
  isActive: z.boolean().default(true)
});

const patchSchema = ruleSchema.partial().extend({
  id: z.string().min(1),
  companyId: z.string().default(DEFAULT_COMPANY_ID)
});

const deleteSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().default(DEFAULT_COMPANY_ID)
});

export async function GET() {
  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ classificationRules: [], mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const [rules, accounts] = await Promise.all([
    db.classificationRule.findMany({
      where: { companyId: company.id },
      orderBy: [{ isActive: "desc" }, { priority: "asc" }, { updatedAt: "desc" }]
    }),
    db.account.findMany({ where: { companyId: company.id } })
  ]);
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));

  return NextResponse.json({
    classificationRules: rules.map((rule) => serializeClassificationRule(rule, accountByCode)),
    mode: "database"
  });
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(request, ruleSchema, { label: "자동 분류 규칙 추가 요청" });
  if (!parsed.ok) return parsed.response;

  const payload = parsed.data;
  const db = getPrisma();
  if (!db) {
    return NextResponse.json({
      ok: true,
      classificationRule: {
        id: `rule-preview-${Date.now()}`,
        ...payload,
        accountName: null
      },
      mode: "sample"
    });
  }

  const company = await ensureDefaultCompany(db);
  const account = await db.account.findFirst({
    where: {
      companyId: company.id,
      code: payload.accountCode,
      isActive: true
    }
  });

  if (!account) {
    return NextResponse.json({ ok: false, message: "계정과목을 찾을 수 없습니다." }, { status: 404 });
  }

  const created = await db.$transaction(async (tx) => {
    const classificationRule = await tx.classificationRule.create({
      data: {
        companyId: company.id,
        name: payload.name,
        sourceType: payload.sourceType ?? null,
        condition: { keyword: payload.keyword },
        action: { accountCode: payload.accountCode },
        priority: payload.priority,
        isActive: payload.isActive
      }
    });
    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "CLASSIFICATION_RULE_CREATE",
      entityType: "CLASSIFICATION_RULE",
      entityId: classificationRule.id,
      summary: `자동 분류 규칙을 추가했습니다: ${payload.name}`,
      metadata: {
        keyword: payload.keyword,
        accountCode: payload.accountCode,
        sourceType: payload.sourceType ?? null,
        priority: payload.priority
      }
    });
    return classificationRule;
  });

  return NextResponse.json({
    ok: true,
    classificationRule: serializeClassificationRule(created, new Map([[account.code, account]])),
    mode: "database"
  });
}

export async function PATCH(request: Request) {
  const parsed = await parseJsonRequest(request, patchSchema, { label: "자동 분류 규칙 수정 요청" });
  if (!parsed.ok) return parsed.response;

  const payload = parsed.data;
  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: true, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const existing = await db.classificationRule.findFirst({
    where: {
      id: payload.id,
      companyId: company.id
    }
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "자동 분류 규칙을 찾을 수 없습니다." }, { status: 404 });
  }

  const account = payload.accountCode
    ? await db.account.findFirst({
        where: {
          companyId: company.id,
          code: payload.accountCode,
          isActive: true
        }
      })
    : null;

  if (payload.accountCode && !account) {
    return NextResponse.json({ ok: false, message: "계정과목을 찾을 수 없습니다." }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.sourceType !== undefined) data.sourceType = payload.sourceType;
  if (payload.keyword !== undefined) data.condition = { keyword: payload.keyword };
  if (payload.accountCode !== undefined) data.action = { accountCode: payload.accountCode };
  if (payload.priority !== undefined) data.priority = payload.priority;
  if (payload.isActive !== undefined) data.isActive = payload.isActive;

  const updated = await db.$transaction(async (tx) => {
    const classificationRule = await tx.classificationRule.update({
      where: { id: existing.id },
      data
    });
    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "CLASSIFICATION_RULE_UPDATE",
      entityType: "CLASSIFICATION_RULE",
      entityId: classificationRule.id,
      summary: `자동 분류 규칙을 수정했습니다: ${classificationRule.name}`,
      metadata: {
        sourceType: classificationRule.sourceType,
        priority: classificationRule.priority,
        isActive: classificationRule.isActive
      }
    });
    return classificationRule;
  });
  const accounts = await db.account.findMany({ where: { companyId: company.id } });
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));

  return NextResponse.json({
    ok: true,
    classificationRule: serializeClassificationRule(updated, accountByCode),
    mode: "database"
  });
}

export async function DELETE(request: Request) {
  const parsed = await parseJsonRequest(request, deleteSchema, { label: "자동 분류 규칙 삭제 요청" });
  if (!parsed.ok) return parsed.response;

  const payload = parsed.data;
  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: true, mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const existing = await db.classificationRule.findFirst({
    where: {
      id: payload.id,
      companyId: company.id
    }
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "자동 분류 규칙을 찾을 수 없습니다." }, { status: 404 });
  }

  await db.$transaction(async (tx) => {
    const classificationRule = await tx.classificationRule.delete({
      where: { id: existing.id }
    });
    await recordAuditEvent(tx, {
      companyId: company.id,
      action: "CLASSIFICATION_RULE_DELETE",
      entityType: "CLASSIFICATION_RULE",
      entityId: payload.id,
      summary: `자동 분류 규칙을 삭제했습니다: ${classificationRule.name}`,
      metadata: {
        sourceType: classificationRule.sourceType,
        priority: classificationRule.priority,
        isActive: classificationRule.isActive
      }
    });
  });

  return NextResponse.json({ ok: true, mode: "database" });
}
