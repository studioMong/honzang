import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_COMPANY_ID } from "@/lib/defaults";
import { getPrisma } from "@/lib/db";
import { ensureDefaultCompany } from "@/lib/server/bootstrap";
import { serializeVendor } from "@/lib/server/serializers";

const withholdingTypes = ["NONE", "TAX_INVOICE", "BUSINESS_INCOME", "OTHER_INCOME", "PAYROLL"] as const;

const vendorSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  name: z.string().min(1).max(120),
  businessRegistrationNumber: z.string().max(40).optional().nullable(),
  defaultAccountId: z.string().optional().nullable(),
  withholdingType: z.enum(withholdingTypes).default("NONE"),
  memo: z.string().max(500).optional().nullable()
});

const vendorPatchSchema = vendorSchema.partial().extend({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  id: z.string().min(1)
});

const vendorDeleteSchema = z.object({
  companyId: z.string().default(DEFAULT_COMPANY_ID),
  id: z.string().min(1)
});

const includeDefaultAccount = {
  defaultAccount: true
};

export async function GET() {
  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ vendors: [], mode: "sample" });
  }

  const company = await ensureDefaultCompany(db);
  const vendors = await db.vendor.findMany({
    where: { companyId: company.id },
    include: includeDefaultAccount,
    orderBy: [{ name: "asc" }]
  });

  return NextResponse.json({ vendors: vendors.map(serializeVendor), mode: "database" });
}

export async function POST(request: Request) {
  const parsed = vendorSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({
      ok: true,
      mode: "sample",
      vendor: {
        id: `vendor-preview-${Date.now()}`,
        name: parsed.data.name,
        businessRegistrationNumber: parsed.data.businessRegistrationNumber ?? null,
        defaultAccount: null,
        withholdingType: parsed.data.withholdingType,
        memo: parsed.data.memo ?? null
      }
    });
  }

  const company = await ensureDefaultCompany(db);
  const defaultAccount = await findDefaultAccount(db, company.id, parsed.data.defaultAccountId);
  if (parsed.data.defaultAccountId && !defaultAccount) {
    return NextResponse.json({ ok: false, message: "기본 계정과목을 찾을 수 없습니다." }, { status: 404 });
  }

  const vendor = await db.vendor.create({
    data: {
      companyId: company.id,
      name: parsed.data.name,
      businessRegistrationNumber: parsed.data.businessRegistrationNumber,
      defaultAccountId: defaultAccount?.id ?? null,
      withholdingType: parsed.data.withholdingType,
      memo: parsed.data.memo
    },
    include: includeDefaultAccount
  });

  return NextResponse.json({ ok: true, vendor: serializeVendor(vendor), mode: "database" });
}

export async function PATCH(request: Request) {
  const parsed = vendorPatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: true, mode: "sample", vendor: { ...parsed.data, defaultAccount: null } });
  }

  const company = await ensureDefaultCompany(db);
  const existing = await db.vendor.findFirst({
    where: {
      id: parsed.data.id,
      companyId: company.id
    }
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "거래처를 찾을 수 없습니다." }, { status: 404 });
  }

  const defaultAccount = await findDefaultAccount(db, company.id, parsed.data.defaultAccountId);
  if (parsed.data.defaultAccountId && !defaultAccount) {
    return NextResponse.json({ ok: false, message: "기본 계정과목을 찾을 수 없습니다." }, { status: 404 });
  }

  const vendor = await db.vendor.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      businessRegistrationNumber: parsed.data.businessRegistrationNumber,
      defaultAccountId: parsed.data.defaultAccountId === undefined ? undefined : defaultAccount?.id ?? null,
      withholdingType: parsed.data.withholdingType,
      memo: parsed.data.memo
    },
    include: includeDefaultAccount
  });

  return NextResponse.json({ ok: true, vendor: serializeVendor(vendor), mode: "database" });
}

export async function DELETE(request: Request) {
  const parsed = vendorDeleteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const db = getPrisma();
  if (!db) {
    return NextResponse.json({ ok: true, mode: "sample", id: parsed.data.id });
  }

  const company = await ensureDefaultCompany(db);
  const existing = await db.vendor.findFirst({
    where: {
      id: parsed.data.id,
      companyId: company.id
    }
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "거래처를 찾을 수 없습니다." }, { status: 404 });
  }

  await db.vendor.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true, mode: "database", id: existing.id });
}

async function findDefaultAccount(db: NonNullable<ReturnType<typeof getPrisma>>, companyId: string, accountId?: string | null) {
  if (!accountId) return null;
  return db.account.findFirst({
    where: {
      id: accountId,
      companyId,
      isActive: true
    }
  });
}
