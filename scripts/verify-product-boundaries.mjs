import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { readdirSync, statSync } from "node:fs";

const productRoots = ["src", "public"];
const productExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".html"]);
const blockedProductPhrases = [
  "신고 대행",
  "신고대행",
  "기장 대행",
  "기장대행",
  "세무기장 대행",
  "세무대리",
  "절세 자문",
  "완전 자동 신고",
  "완전자동 신고",
  "자동 신고",
  "세무사가 필요 없는",
  "세무사 불필요",
  "홈택스 자동 제출",
  "고객 대신",
  "신고서를 대신",
  "제출 대행"
];

const requiredProductBoundaryChecks = [
  {
    file: "README.md",
    phrases: ["직접 장부를 정리하고 신고 준비자료", "홈택스 자동 제출", "신고 준비자료 생성까지"]
  },
  {
    file: "혼자장부_프로젝트_검토_2026-06-17.md",
    phrases: ["세무기장 대행 서비스가 아니라", "최종 판단과 홈택스 신고는 사용자가 직접", "피해야 할 포지셔닝"]
  },
  {
    file: "src/components/app-workspace.tsx",
    phrases: ["기한은 신고 전 국세청 공지와 홈택스 기준으로 최종 확인", "홈택스 입력 전 금액과 상태를 신고 유형별로 대조", "혼자장부 신고 패키지는 직접 신고 준비를 돕는 자료입니다.", "최종 신고 전 홈택스, 국세청 공지, 세무 전문가 검토가 필요한 항목을 확인하세요."]
  },
  {
    file: "src/lib/closing-snapshot-export.ts",
    phrases: ["월 마감 시점에 Postgres ClosingPeriod.summaryPayload로 보관된 신고 준비 스냅샷입니다.", "ZIP과 XLSX는 홈택스 입력 전 대조에 필요한 표를 CSV/시트로 분리합니다."]
  },
  {
    file: "scripts/smoke-production.mjs",
    phrases: ["혼자장부 신고 준비 리포트", "홈택스 제출 전 입력 가이드", "신고서 입력값 요약"]
  }
];

const productFiles = productRoots.flatMap((root) => walk(root)).filter((filePath) => productExtensions.has(extname(filePath)));
const blockedHits = [];

for (const filePath of productFiles) {
  const text = readText(filePath);
  for (const phrase of blockedProductPhrases) {
    if (text.includes(phrase)) {
      blockedHits.push(`${filePath}: ${phrase}`);
    }
  }
}

assert.deepEqual(
  blockedHits,
  [],
  `Product-facing files should not use tax-agency or automatic-filing positioning:\n${blockedHits.join("\n")}`
);

for (const check of requiredProductBoundaryChecks) {
  const text = readText(check.file);
  for (const phrase of check.phrases) {
    assert.ok(text.includes(phrase), `${check.file} should include product-boundary phrase: ${phrase}`);
  }
}

assert.ok(
  /피해야 할 포지셔닝:[\s\S]*세무기장 대행[\s\S]*법인세 신고 대행[\s\S]*절세 자문[\s\S]*완전 자동 신고[\s\S]*홈택스 신고 제출/.test(
    readText("혼자장부_프로젝트_검토_2026-06-17.md")
  ),
  "Project review should preserve the explicit excluded positioning list"
);

console.log("Product boundary verification passed.");

function walk(root) {
  return readdirSync(root).flatMap((entry) => {
    const filePath = join(root, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) return walk(filePath);
    if (!stats.isFile()) return [];
    return [relative(".", filePath)];
  });
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}
