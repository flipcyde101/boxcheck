import { describe, it, expect } from "vitest";
import { formatCompactAuditJson, formatTerminalAudit } from "../src/audit/format.js";
import { renderCollisionOverlayHtml } from "../src/report/overlay.js";
import type { AuditReport } from "../src/types.js";

function makeSampleReport(defectCount = 2): AuditReport {
  const defects = Array.from({ length: defectCount }, (_, idx) => ({
    kind: idx % 2 === 0 ? ("OVERLAP" as const) : ("H_OVERFLOW" as const),
    vp: "390x844",
    a: idx % 2 === 0 ? `button.cta-${idx}` : undefined,
    b: idx % 2 === 0 ? `h1.hero-${idx}` : undefined,
    el: idx % 2 === 1 ? `div.grid-${idx}` : undefined,
    area_px: idx % 2 === 0 ? 412 : undefined,
    overflow_px: idx % 2 === 1 ? 48 : undefined,
    box: { x: 12, y: 20 + idx * 40, w: 140, h: 42 },
    winning_css: "styles.css:42 (.nav-row { flex-wrap: nowrap })",
  }));

  return {
    url: "http://127.0.0.1:3000",
    timestamp: "2026-11-21T16:00:00.000Z",
    durationMs: 420,
    totalDefects: defects.length,
    viewports: [
      {
        vp: "390x844",
        width: 390,
        height: 844,
        defects,
        screenshotBase64: "iVBORw0KGgo=",
        elementCount: 48,
        durationMs: 420,
      },
    ],
  };
}

describe("compact <500-token formatter & collision overlay HTML", () => {
  it("keeps compact JSON output tightly bounded under ~500 tokens even with 40 defects", () => {
    const jsonStr = formatCompactAuditJson(makeSampleReport(40), 10);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.totalDefects).toBe(40);
    expect(parsed.defects.length).toBeGreaterThan(0);
    expect(parsed.defects.length).toBeLessThanOrEqual(10);
    expect(parsed.truncated).toBe(40 - parsed.defects.length);
    // Strict token budget check (~4 chars/token -> <= 1800 chars = <450 tokens)
    expect(jsonStr.length).toBeLessThanOrEqual(1800);
  });

  it("renders readable terminal summary and self-contained HTML collision overlay with SVG bounding boxes", () => {
    const term = formatTerminalAudit(makeSampleReport(2));
    expect(term).toContain("OVERLAP");
    expect(term).toContain("H_OVERFLOW");
    expect(term).toContain("390x844");

    const html = renderCollisionOverlayHtml(makeSampleReport(2));
    expect(html).toContain("<svg");
    expect(html).toContain("OVERLAP");
    expect(html).toContain("data:image/png;base64,iVBORw0KGgo=");
    // XSS escaping check
    const xssReport = makeSampleReport(1);
    xssReport.url = 'http://localhost:3000/?x="><script>alert(1)</script>';
    const safeHtml = renderCollisionOverlayHtml(xssReport);
    expect(safeHtml).not.toContain("<script>alert(1)</script>");
  });
});
