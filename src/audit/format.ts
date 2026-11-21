import type { AuditReport, LayoutDefect } from "../types.js";

function toCompactDefect(d: LayoutDefect): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: d.kind, vp: d.vp };
  if (d.a) out.a = d.a;
  if (d.b) out.b = d.b;
  if (d.el) out.el = d.el;
  if (d.area_px !== undefined) out.area_px = d.area_px;
  if (d.overflow_px !== undefined) out.overflow_px = d.overflow_px;
  if (d.clipped_px !== undefined) out.clipped_px = d.clipped_px;
  if (d.occluded_by) out.occluded_by = d.occluded_by;
  if (d.winning_css) out.winning_css = d.winning_css;
  return out;
}

export function formatCompactAuditJson(report: AuditReport, maxDefects = 12): string {
  const all = report.viewports.flatMap((v) => v.defects);
  const shown = all.slice(0, maxDefects).map(toCompactDefect);
  const truncated = Math.max(0, all.length - shown.length);

  const payload: Record<string, unknown> = {
    url: report.url,
    durationMs: report.durationMs,
    totalDefects: report.totalDefects,
    defects: shown,
  };
  if (truncated > 0) {
    payload.truncated = truncated;
  }

  return JSON.stringify(payload, null, 2);
}

export function formatTerminalAudit(report: AuditReport): string {
  const lines: string[] = [];
  const vpList = report.viewports.map((v) => v.vp).join(", ");
  lines.push(
    `boxcheck · ${report.url} (${vpList}) · ${report.durationMs}ms · ${report.totalDefects} defect(s)`
  );

  if (report.totalDefects === 0) {
    lines.push("  ✓ 0 layout regressions detected.");
    return lines.join("\n");
  }

  for (const vp of report.viewports) {
    if (vp.defects.length === 0) {
      lines.push(`  [${vp.vp}] ✓ clean (${vp.elementCount} elements)`);
      continue;
    }
    lines.push(`  [${vp.vp}] ${vp.defects.length} issue(s):`);
    for (const d of vp.defects) {
      const target = d.a && d.b ? `${d.a} ∩ ${d.b}` : (d.el ?? "page");
      const metric =
        d.area_px !== undefined
          ? `${d.area_px}px²`
          : d.overflow_px !== undefined
            ? `+${d.overflow_px}px`
            : d.clipped_px !== undefined
              ? `-${d.clipped_px}px`
              : d.occluded_by
                ? `blocked by ${d.occluded_by}`
                : "";
      const css = d.winning_css ? ` | ${d.winning_css}` : "";
      lines.push(`    • ${d.kind.padEnd(12)} ${target} (${metric})${css}`);
    }
  }

  return lines.join("\n");
}
