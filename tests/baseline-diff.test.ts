import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffBaselines } from "../src/baseline/diff.js";
import { saveBaseline, loadBaseline, baselineSlugForUrl } from "../src/baseline/store.js";
import type { BaselineSnapshot } from "../src/types.js";

describe("baseline store & geometric diff engine (Review Focus #5)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("sanitizes arbitrary URLs into Windows-safe, traversal-proof slugs", () => {
    const slug = baselineSlugForUrl("http://localhost:3000/pricing?tab=pro&x=../../etc#top");
    expect(slug).not.toMatch(/[\\/:*?"<>|]/);
    expect(slug).not.toContain("..");
    expect(slug.length).toBeGreaterThan(4);
  });

  it("persists and reloads baseline snapshots inside .boxcheck/baselines/", () => {
    const root = mkdtempSync(join(tmpdir(), "boxcheck-base-"));
    tempDirs.push(root);

    const snap: BaselineSnapshot = {
      url: "http://localhost:3000/pricing",
      createdAt: "2026-11-21T00:00:00.000Z",
      viewports: [
        {
          vp: "390x844",
          width: 390,
          height: 844,
          elements: [{ selector: "h1.hero", rect: { x: 16, y: 80, w: 358, h: 48 } }],
        },
      ],
    };

    const savedPath = saveBaseline(root, snap);
    expect(savedPath).toContain("baselines");
    const loaded = loadBaseline(root, snap.url);
    expect(loaded).toEqual(snap);
  });

  it("detects SHIFTED (>2px), RESIZED (>2px), MISSING, and ADDED while ignoring <=2px jitter", () => {
    const prev: BaselineSnapshot = {
      url: "http://localhost:3000",
      createdAt: "2026-11-21T00:00:00.000Z",
      viewports: [
        {
          vp: "390x844",
          width: 390,
          height: 844,
          elements: [
            { selector: "h1.stable", rect: { x: 16, y: 20, w: 300, h: 40 } },
            { selector: "button.cta", rect: { x: 16, y: 80, w: 120, h: 40 } },
            { selector: "div.card", rect: { x: 16, y: 150, w: 300, h: 120 } },
            { selector: "a.removed", rect: { x: 16, y: 300, w: 100, h: 24 } },
          ],
        },
      ],
    };

    const curr: BaselineSnapshot = {
      url: "http://localhost:3000",
      createdAt: "2026-11-21T00:05:00.000Z",
      viewports: [
        {
          vp: "390x844",
          width: 390,
          height: 844,
          elements: [
            { selector: "h1.stable", rect: { x: 17, y: 21, w: 301, h: 40 } }, // <=2px jitter -> ignored!
            { selector: "button.cta", rect: { x: 30, y: 80, w: 120, h: 40 } }, // dx = +14 -> SHIFTED
            { selector: "div.card", rect: { x: 16, y: 150, w: 348, h: 120 } }, // dw = +48 -> RESIZED
            { selector: "p.added", rect: { x: 16, y: 320, w: 200, h: 20 } },   // ADDED
          ],
        },
      ],
    };

    const report = diffBaselines(prev, curr, 2);
    expect(report.changes.some((c) => c.el === "h1.stable")).toBe(false);
    expect(report.changes.find((c) => c.el === "button.cta")?.kind).toBe("SHIFTED");
    expect(report.changes.find((c) => c.el === "div.card")?.kind).toBe("RESIZED");
    expect(report.changes.find((c) => c.el === "a.removed")?.kind).toBe("MISSING");
    expect(report.changes.find((c) => c.el === "p.added")?.kind).toBe("ADDED");
    expect(report.totalChanges).toBe(4);
  });
});
