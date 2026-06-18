import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { isAccessControlEnabled, isAccessTokenSaltConfigured } from "@/lib/server/access-control";
import { inspectDatabaseSchema, REQUIRED_DATABASE_TABLES } from "@/lib/server/database-schema";
import { isFileEncryptionConfigured } from "@/lib/server/file-encryption";
import packageInfo from "../../../../../package.json";

type ReadinessTone = "green" | "amber" | "red" | "blue";

type ReadinessCheck = {
  key: string;
  label: string;
  status: string;
  tone: ReadinessTone;
  detail: string;
  action: string;
};

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: ReadinessCheck[] = [];
  checks.push(await databaseCheck());
  checks.push(await databaseSchemaCheck());
  checks.push(accessCodeCheck());
  checks.push(accessSaltCheck());
  checks.push(fileEncryptionCheck());
  checks.push(appUrlCheck());
  checks.push(runtimeCheck());
  checks.push(railwayCheck());

  const blockers = checks.filter((check) => check.tone === "red").length;
  const warnings = checks.filter((check) => check.tone === "amber").length;

  return NextResponse.json({
    app: packageInfo.name,
    version: packageInfo.version,
    generatedAt: new Date().toISOString(),
    summary: {
      blockers,
      warnings,
      passes: checks.filter((check) => check.tone === "green").length
    },
    checks,
    railway: {
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      branch: process.env.RAILWAY_GIT_BRANCH ?? null,
      service: process.env.RAILWAY_SERVICE_NAME ?? null,
      environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null
    }
  });
}

async function databaseCheck(): Promise<ReadinessCheck> {
  const db = getPrisma();
  if (!db) {
    return {
      key: "database",
      label: "Postgres 연결",
      status: "미설정",
      tone: "red",
      detail: "DATABASE_URL이 없어 샘플 데이터 모드로 실행됩니다.",
      action: "Railway Postgres DATABASE_URL을 서비스 변수로 연결"
    };
  }

  try {
    await db.$queryRaw`SELECT 1`;
    return {
      key: "database",
      label: "Postgres 연결",
      status: "연결됨",
      tone: "green",
      detail: "앱 서버에서 Postgres 쿼리를 실행할 수 있습니다.",
      action: "배포 후 /api/health도 함께 확인"
    };
  } catch (error) {
    return {
      key: "database",
      label: "Postgres 연결",
      status: "오류",
      tone: "red",
      detail: error instanceof Error ? error.message : "Postgres 연결 확인에 실패했습니다.",
      action: "DATABASE_URL, Railway Postgres 연결, migration 상태 확인"
    };
  }
}

async function databaseSchemaCheck(): Promise<ReadinessCheck> {
  const db = getPrisma();
  if (!db) {
    return {
      key: "databaseSchema",
      label: "Postgres 스키마",
      status: "대기",
      tone: "blue",
      detail: "DATABASE_URL이 없어 Prisma 테이블 상태를 확인하지 않았습니다.",
      action: "DATABASE_URL 연결 후 npm run db:deploy 또는 Railway preDeployCommand 확인"
    };
  }

  try {
    const schema = await inspectDatabaseSchema(db);
    if (!schema.ok) {
      return {
        key: "databaseSchema",
        label: "Postgres 스키마",
        status: "마이그레이션 필요",
        tone: "red",
        detail: `누락 테이블: ${schema.missingTables.join(", ")}`,
        action: "Railway preDeployCommand의 npm run db:deploy 실행 로그와 Prisma migration 상태 확인"
      };
    }

    return {
      key: "databaseSchema",
      label: "Postgres 스키마",
      status: "정상",
      tone: "green",
      detail: `필수 테이블 ${REQUIRED_DATABASE_TABLES.length}개를 확인했습니다.`,
      action: "마이그레이션 추가 시 readiness와 verify:db-workflow도 함께 확인"
    };
  } catch (error) {
    return {
      key: "databaseSchema",
      label: "Postgres 스키마",
      status: "오류",
      tone: "red",
      detail: error instanceof Error ? error.message : "Postgres 스키마 확인에 실패했습니다.",
      action: "DATABASE_URL 권한, information_schema 조회 권한, Prisma migration 상태 확인"
    };
  }
}

function accessCodeCheck(): ReadinessCheck {
  const enabled = isAccessControlEnabled();
  const production = process.env.NODE_ENV === "production";
  return {
    key: "accessCode",
    label: "접근코드 보호",
    status: enabled ? "사용" : "미설정",
    tone: enabled ? "green" : production ? "red" : "amber",
    detail: enabled ? "앱 화면과 민감 API가 접근코드로 보호됩니다." : "HONZANG_ACCESS_CODE가 없어 앱 화면과 API가 열립니다.",
    action: enabled ? "코드 변경 시 기존 접근 쿠키 무효화 확인" : "Railway Variables에 HONZANG_ACCESS_CODE 추가"
  };
}

function accessSaltCheck(): ReadinessCheck {
  const configured = isAccessTokenSaltConfigured();
  const production = process.env.NODE_ENV === "production";
  return {
    key: "accessSalt",
    label: "접근 쿠키 salt",
    status: configured ? "설정됨" : production ? "필수 누락" : "기본값",
    tone: configured ? "green" : production ? "red" : "amber",
    detail: configured
      ? "배포 환경 전용 salt로 접근 쿠키 토큰을 생성합니다."
      : production
        ? "프로덕션에서는 기본 salt로 접근 쿠키를 생성하지 않습니다."
        : "개발 환경에서만 기본 salt를 사용 중입니다.",
    action: configured ? "장기 운영 전 salt 보관 위치 확인" : "Railway Variables에 긴 랜덤 HONZANG_ACCESS_TOKEN_SALT 추가"
  };
}

function fileEncryptionCheck(): ReadinessCheck {
  const configured = isFileEncryptionConfigured();
  const production = process.env.NODE_ENV === "production";
  return {
    key: "fileEncryption",
    label: "파일 암호화 키",
    status: configured ? "설정됨" : production ? "필수 누락" : "미설정",
    tone: configured ? "green" : production ? "red" : "amber",
    detail: configured
      ? "원본 CSV와 DB 보관 증빙 파일을 암호화 저장합니다."
      : "HONZANG_FILE_ENCRYPTION_KEY가 없어 신규 원본 CSV와 DB 보관 증빙 파일을 평문 저장합니다.",
    action: configured ? "키 교체 전 기존 백업과 복원 계획 확인" : "Railway Variables에 긴 랜덤 HONZANG_FILE_ENCRYPTION_KEY 추가"
  };
}

function appUrlCheck(): ReadinessCheck {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const validHttps = appUrl?.startsWith("https://");
  return {
    key: "appUrl",
    label: "공개 앱 URL",
    status: validHttps ? "설정됨" : appUrl ? "확인 필요" : "미설정",
    tone: validHttps ? "green" : appUrl ? "amber" : "red",
    detail: appUrl ? `NEXT_PUBLIC_APP_URL=${appUrl}` : "NEXT_PUBLIC_APP_URL이 없습니다.",
    action: validHttps ? "Railway public domain과 실제 응답 일치 확인" : "NEXT_PUBLIC_APP_URL을 https 공개 도메인으로 설정"
  };
}

function runtimeCheck(): ReadinessCheck {
  const production = process.env.NODE_ENV === "production";
  return {
    key: "runtime",
    label: "서버 런타임",
    status: process.env.NODE_ENV ?? "unknown",
    tone: production ? "green" : "blue",
    detail: production ? "프로덕션 빌드로 실행 중입니다." : "개발 또는 검증 런타임입니다.",
    action: production ? "standalone 서버와 healthcheck 유지" : "배포에서는 npm run build 후 npm run start 사용"
  };
}

function railwayCheck(): ReadinessCheck {
  const hasRailwayMetadata = Boolean(process.env.RAILWAY_SERVICE_NAME || process.env.RAILWAY_GIT_COMMIT_SHA);
  return {
    key: "railway",
    label: "Railway 메타데이터",
    status: hasRailwayMetadata ? "감지됨" : "로컬/미감지",
    tone: hasRailwayMetadata ? "green" : "blue",
    detail: hasRailwayMetadata
      ? `service=${process.env.RAILWAY_SERVICE_NAME ?? "-"} branch=${process.env.RAILWAY_GIT_BRANCH ?? "-"}`
      : "Railway 런타임 환경변수가 없습니다.",
    action: hasRailwayMetadata ? "Deploy source commit과 GitHub main HEAD 일치 확인" : "Railway 배포 후 /api/version으로 커밋 확인"
  };
}
