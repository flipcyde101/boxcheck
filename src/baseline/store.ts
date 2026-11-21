import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { BaselineSnapshot } from "../types.js";

export function baselineSlugForUrl(rawUrl: string): string {
  const hash = createHash("sha256").update(rawUrl).digest("hex").slice(0, 8);
  let readable = "page";
  try {
    const u = new URL(rawUrl);
    readable = `${u.hostname}-${u.port || "80"}-${u.pathname}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  } catch {
    readable = "page";
  }
  return `${readable || "page"}-${hash}`;
}

export function resolveBaselinePath(workspaceDir: string, url: string): string {
  const baseDir = resolve(workspaceDir, ".boxcheck", "baselines");
  const slug = baselineSlugForUrl(url);
  const fullPath = resolve(baseDir, `${slug}.json`);
  const prefix = baseDir.endsWith(sep) ? baseDir : `${baseDir}${sep}`;
  if (!fullPath.startsWith(prefix)) {
    throw new Error("Invalid baseline path outside .boxcheck/baselines/");
  }
  return fullPath;
}

export function saveBaseline(workspaceDir: string, snapshot: BaselineSnapshot): string {
  const target = resolveBaselinePath(workspaceDir, snapshot.url);
  mkdirSync(resolve(workspaceDir, ".boxcheck", "baselines"), { recursive: true });
  writeFileSync(target, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return target;
}

export function loadBaseline(workspaceDir: string, url: string): BaselineSnapshot | null {
  const target = resolveBaselinePath(workspaceDir, url);
  if (!existsSync(target)) return null;
  return JSON.parse(readFileSync(target, "utf8")) as BaselineSnapshot;
}
