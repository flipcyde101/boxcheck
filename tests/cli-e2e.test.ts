import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCliArgs } from "../src/cli.js";

describe("CLI arg parser & end-to-end --demo execution", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("parses audit, snap, diff, mcp, --demo and rejects unknown flags", () => {
    const a = parseCliArgs(["audit", "http://localhost:3000", "--vp", "390x844", "--json", "--fail-on-defects"]);
    expect(a.mode).toBe("audit");
    expect(a.url).toBe("http://localhost:3000");
    expect(a.json).toBe(true);
    expect(a.failOnDefects).toBe(true);

    const m = parseCliArgs(["mcp"]);
    expect(m.mode).toBe("mcp");

    expect(() => parseCliArgs(["audit", "http://localhost:3000", "--unknown-flag"])).toThrow(/unknown/i);
  });

  it("runs compiled dist/cli.js --demo --json and emits <500-token collision JSON + HTML overlay report", () => {
    const dir = mkdtempSync(join(tmpdir(), "boxcheck-demo-"));
    tempDirs.push(dir);
    const outHtml = join(dir, "report.html");
    const cliPath = resolve(process.cwd(), "dist", "cli.js");

    const stdout = execFileSync(
      process.execPath,
      [cliPath, "--demo", "--json", "--out", outHtml],
      { encoding: "utf8" }
    );
    const parsed = JSON.parse(stdout);
    expect(parsed.totalDefects).toBeGreaterThanOrEqual(3);
    expect(parsed.defects.some((d: { kind: string }) => d.kind === "OVERLAP")).toBe(true);
    expect(parsed.defects.some((d: { kind: string }) => d.kind === "H_OVERFLOW")).toBe(true);
    expect(stdout.length).toBeLessThan(2400);

    expect(existsSync(outHtml)).toBe(true);
    const html = readFileSync(outHtml, "utf8");
    expect(html).toContain("<svg");
    expect(html).toContain("data:image/png;base64,");
  }, 20_000);
});
