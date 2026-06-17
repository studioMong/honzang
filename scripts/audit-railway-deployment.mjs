import { execFileSync } from "node:child_process";
import process from "node:process";

const baseUrl = (process.env.RAILWAY_PUBLIC_URL ?? "https://honzang-production.up.railway.app").replace(/\/$/, "");
const expectedCommit = process.env.RAILWAY_EXPECTED_COMMIT ?? currentGitCommit();
const softMode = process.env.RAILWAY_AUDIT_SOFT === "1";
const cutoverChecklist = "docs/railway-cutover.md";
const railwayDashboardHint = "Railway Dashboard의 Public Networking, Deployments, Variables, Observability를 확인하세요.";
const checks = [
  { path: "/", kind: "text" },
  { path: "/api/version", kind: "json" },
  { path: "/api/health", kind: "json" },
  { path: "/manifest.webmanifest", kind: "json" }
];

const results = [];
for (const check of checks) {
  results.push(await inspectPath(check.path, check.kind));
}

const home = resultFor("/");
const version = resultFor("/api/version");
const health = resultFor("/api/health");
const manifest = resultFor("/manifest.webmanifest");
const findings = buildFindings();

printReport();

if (findings.some((finding) => finding.level === "fail") && !softMode) {
  process.exit(1);
}

async function inspectPath(path, kind) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "unknown";
    const headers = {
      server: response.headers.get("server") ?? "",
      via: response.headers.get("via") ?? "",
      railwayRequestId: response.headers.get("x-railway-request-id") ?? "",
      contentType
    };
    let json = null;
    let parseError = "";

    if (kind === "json" && text) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        parseError = error instanceof Error ? error.message : "JSON parse failed";
      }
    }

    return {
      path,
      ok: response.ok,
      status: response.status,
      bytes: Buffer.byteLength(text, "utf8"),
      contentType,
      headers,
      json,
      parseError,
      textPreview: text.slice(0, 240),
      hasNextRuntime: /__next|self\.__next_f/.test(text),
      hasLegacySummary: /프로젝트 정리|셀프 세무기장 가능 여부/.test(text)
    };
  } catch (error) {
    return {
      path,
      ok: false,
      status: 0,
      bytes: 0,
      contentType: "network-error",
      headers: {},
      json: null,
      parseError: "",
      textPreview: error instanceof Error ? error.message : String(error),
      hasNextRuntime: false,
      hasLegacySummary: false
    };
  }
}

function buildFindings() {
  const items = [];

  if (!version.ok) {
    items.push({
      level: "fail",
      title: "Next.js API 라우트 미노출",
      detail: `/api/version이 HTTP ${version.status}로 응답합니다.`,
      action: `Railway 도메인이 최신 Next.js 서비스가 아니라 legacy/static 서비스에 연결되어 있는지 확인하세요. ${railwayDashboardHint} 체크리스트: ${cutoverChecklist}`
    });
  } else if (version.json?.app !== "honzang") {
    items.push({
      level: "fail",
      title: "다른 앱이 응답",
      detail: `/api/version app 값이 ${JSON.stringify(version.json?.app)}입니다.`,
      action: `도메인과 서비스 연결을 확인하세요. ${railwayDashboardHint} 체크리스트: ${cutoverChecklist}`
    });
  } else {
    items.push({
      level: "pass",
      title: "Next.js API 라우트 응답",
      detail: `/api/version app=${version.json.app}`,
      action: "API 라우트는 현재 서비스에서 노출됩니다."
    });
  }

  const deployedCommit = version.json?.railway?.commitSha ?? "";
  if (version.ok && expectedCommit && deployedCommit && !commitMatches(deployedCommit, expectedCommit)) {
    items.push({
      level: "fail",
      title: "배포 커밋 불일치",
      detail: `expected=${expectedCommit}, deployed=${deployedCommit}`,
      action: `Railway GitHub 연결 브랜치와 최신 배포 로그를 확인하세요. ${railwayDashboardHint}`
    });
  } else if (version.ok && expectedCommit && commitMatches(deployedCommit, expectedCommit)) {
    items.push({
      level: "pass",
      title: "배포 커밋 일치",
      detail: deployedCommit,
      action: "현재 커밋이 공개 URL에 반영되어 있습니다."
    });
  } else if (version.ok) {
    items.push({
      level: "warn",
      title: "Railway 커밋 메타데이터 없음",
      detail: "RAILWAY_GIT_COMMIT_SHA 값이 응답에 없습니다.",
      action: "Railway 기본 메타데이터가 주입되는 서비스인지 확인하세요."
    });
  }

  if (home.hasLegacySummary) {
    items.push({
      level: "fail",
      title: "Legacy 정적 페이지 응답",
      detail: "루트 페이지에 이전 프로젝트 요약 문구가 남아 있습니다.",
      action: `현재 public domain을 새 Next.js 서비스로 옮기거나 이전 static 서비스를 제거하세요. 체크리스트: ${cutoverChecklist}`
    });
  } else if (home.ok && home.hasNextRuntime) {
    items.push({
      level: "pass",
      title: "Next.js 루트 페이지 응답",
      detail: `HTTP ${home.status}, ${home.bytes} bytes`,
      action: "루트 페이지는 Next.js 런타임으로 보입니다."
    });
  } else if (home.ok) {
    items.push({
      level: "warn",
      title: "루트 페이지 판별 불확실",
      detail: `HTTP ${home.status}, Next.js marker 없음`,
      action: "브라우저에서 루트 페이지 제목과 화면을 직접 확인하세요."
    });
  }

  if (!health.ok) {
    items.push({
      level: "fail",
      title: "Healthcheck 미노출",
      detail: `/api/health가 HTTP ${health.status}로 응답합니다.`,
      action: `Railway Healthcheck Path가 /api/health인 최신 서비스인지 확인하세요. ${railwayDashboardHint} 체크리스트: ${cutoverChecklist}`
    });
  } else if (health.json?.database !== "connected") {
    items.push({
      level: "fail",
      title: "Postgres 미연결",
      detail: `database=${JSON.stringify(health.json?.database)}`,
      action: `Railway Variables에서 Postgres DATABASE_URL 참조 변수를 연결하세요. 체크리스트: ${cutoverChecklist}`
    });
  } else {
    items.push({
      level: "pass",
      title: "Postgres 연결",
      detail: "database=connected",
      action: "DB 연결이 정상입니다."
    });
  }

  if (!manifest.ok) {
    items.push({
      level: "fail",
      title: "PWA manifest 미노출",
      detail: `/manifest.webmanifest가 HTTP ${manifest.status}로 응답합니다.`,
      action: `Next.js 앱 라우트가 공개 URL에 노출되는지 확인하세요. 체크리스트: ${cutoverChecklist}`
    });
  } else if (manifest.json?.name !== "혼자장부") {
    items.push({
      level: "warn",
      title: "Manifest 앱 이름 불일치",
      detail: `name=${JSON.stringify(manifest.json?.name)}`,
      action: "PWA manifest가 현재 앱의 manifest인지 확인하세요."
    });
  } else {
    items.push({
      level: "pass",
      title: "PWA manifest 응답",
      detail: `display=${manifest.json.display}`,
      action: "PWA manifest가 노출됩니다."
    });
  }

  return items;
}

function printReport() {
  console.log(`Railway deployment audit: ${baseUrl}`);
  console.log(`Expected commit: ${expectedCommit || "(not set)"}`);
  console.log("");

  for (const result of results) {
    console.log(`${result.path}: HTTP ${result.status}, ${result.contentType}, ${result.bytes} bytes`);
  }

  console.log("");
  for (const finding of findings) {
    console.log(`[${finding.level.toUpperCase()}] ${finding.title}`);
    console.log(`  ${finding.detail}`);
    console.log(`  Action: ${finding.action}`);
  }

  const failed = findings.filter((finding) => finding.level === "fail").length;
  const warned = findings.filter((finding) => finding.level === "warn").length;
  console.log("");
  console.log(`Summary: ${failed} fail, ${warned} warn, ${findings.length - failed - warned} pass`);

  if (failed > 0) {
    console.log(`Cutover checklist: ${cutoverChecklist}`);
  }

  if (softMode && failed > 0) {
    console.log("Soft mode enabled: returning success despite failed deployment readiness checks.");
  }
}

function resultFor(path) {
  return results.find((result) => result.path === path);
}

function currentGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function commitMatches(deployedCommit, expectedCommit) {
  return deployedCommit === expectedCommit || deployedCommit.startsWith(expectedCommit) || expectedCommit.startsWith(deployedCommit);
}
