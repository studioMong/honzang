import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standaloneDir = path.join(root, ".next", "standalone");
const standaloneNextDir = path.join(standaloneDir, ".next");

if (!existsSync(standaloneDir)) {
  process.exit(0);
}

await mkdir(standaloneNextDir, { recursive: true });

const staticDir = path.join(root, ".next", "static");
if (existsSync(staticDir)) {
  await cp(staticDir, path.join(standaloneNextDir, "static"), { recursive: true });
}

const publicDir = path.join(root, "public");
if (existsSync(publicDir)) {
  await cp(publicDir, path.join(standaloneDir, "public"), { recursive: true });
}
