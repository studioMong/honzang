import { spawnSync } from "node:child_process";
import process from "node:process";

const steps = [
  ["verify:deployment-config", "Railway/standalone deployment config"],
  ["typecheck", "TypeScript typecheck"],
  ["lint", "ESLint"],
  ["verify:samples", "CSV sample parsing and classification"],
  ["build", "Production standalone build"],
  ["verify:pwa", "PWA resources and install hooks"],
  ["verify:access-control", "Environment access-code protection"],
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
