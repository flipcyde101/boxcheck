import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { BaselineSnapshot } from "../types.js";

export function baselineSlugForUrl(rawUrl: string): string {
  const hash = createHash("sha256").update(rawUrl).digest("hex").slice(0, 8);
  let readable = "page";
  try {
    const u = new URL(rawUrl);
    const defaultPort = u.protocol === "https:" ? "443" : "80";
    readable = `${u.hostname}-${u.port || defaultPort}-${u.pathname}`
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
  const dir = resolve(workspaceDir, ".boxcheck", "baselines");
  mkdirSync(dir, { recursive: true });
  const tmpFile = resolve(dir, `.tmp-${randomUUID().slice(0, 8)}.json`);
  writeFileSync(tmpFile, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  renameSync(tmpFile, target);
  return target;
}

export function loadBaseline(workspaceDir: string, url: string): BaselineSnapshot | null {
  const target = resolveBaselinePath(workspaceDir, url);
  if (!existsSync(target)) return null;
  const parsed = JSON.parse(readFileSync(target, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as BaselineSnapshot).viewports)) {
    throw new Error(`Corrupt baseline file at ${target}`);
  }
  return parsed as BaselineSnapshot;
}
