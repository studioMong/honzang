import { spawnSync } from "node:child_process";
import process from "node:process";

const steps = [
  ["verify:deployment-config", "Railway/standalone deployment config"],
  ["verify:limits", "File/request limit policy"],
  ["verify:data-sources", "Data source status calculation"],
  ["verify:billing-estimates", "Billing model estimates"],
  ["verify:filing-schedules", "Filing schedule due dates"],
  ["verify:file-encryption", "Stored file encryption"],
  ["verify:database-schema-contract", "Database schema contract"],
  ["verify:period-locks", "Closing period mutation locks"],
  ["verify:product-boundaries", "Product positioning boundaries"],
  ["typecheck", "TypeScript typecheck"],
  ["lint", "ESLint"],
  ["verify:samples", "CSV sample parsing and classification"],
  ["verify:closing-snapshot-exports", "Closing snapshot export packages"],
  ["verify:workspace-backup-exports", "Workspace backup export packages"],
  ["build", "Production standalone build"],
  ["verify:workspace-backup-restore-contract", "Workspace backup restore contract"],
  ["verify:operations-readiness", "Operations readiness diagnostics"],
  ["verify:pwa", "PWA resources and install hooks"],
  ["verify:access-control", "Environment access-code protection"],
  ["verify:access-audit", "Access security audit contract"],
  ["verify:backup-restore", "Backup restore dry-run"],
  ["smoke:prod", "Production API/UI smoke test"]
];

for (const [scriptName, label] of steps) {
  console.log(`\n==> ${label}`);
  const result = spawnSync("npm", ["run", scriptName], {
    env: process.env,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    console.error(`\nMVP verification failed at: ${scriptName}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nMVP verification passed.");
