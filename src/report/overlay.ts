import type { AuditReport, DefectKind, ViewportAuditResult } from "../types.js";
import { formatCompactAuditJson } from "../audit/format.js";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DEFECT_COLORS: Record<DefectKind, string> = {
  OVERLAP: "#f85149",
  H_OVERFLOW: "#f0883e",
  TEXT_CLIPPED: "#d29922",
  OFF_SCREEN: "#bc8cff",
  OCCLUDED: "#ff4d94",
};

function renderViewportCard(vp: ViewportAuditResult): string {
  const rectsSvg = vp.defects
    .flatMap((d, idx) => {
      const color = DEFECT_COLORS[d.kind] ?? "#f85149";
      const shapes: string[] = [];
      if (d.box) {
        const labelY = Math.max(14, d.box.y - 4);
        shapes.push(
          `<rect x="${d.box.x}" y="${d.box.y}" width="${Math.max(4, d.box.w)}" height="${Math.max(4, d.box.h)}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2" />` +
            `<rect x="${d.box.x}" y="${labelY - 13}" width="${Math.min(220, d.kind.length * 7 + 34)}" height="16" rx="3" fill="${color}" />` +
            `<text x="${d.box.x + 4}" y="${labelY - 1}" fill="#0b0f14" font-family="ui-monospace,monospace" font-size="10" font-weight="700">#${idx + 1} ${escHtml(d.kind)}</text>`
        );
      }
      if (d.box_b) {
        shapes.push(
          `<rect x="${d.box_b.x}" y="${d.box_b.y}" width="${Math.max(4, d.box_b.w)}" height="${Math.max(4, d.box_b.h)}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="2" stroke-dasharray="4 3" />`
        );
      }
      return shapes;
    })
    .join("\n");

  const imgTag = vp.screenshotBase64
    ? `<img src="data:image/png;base64,${vp.screenshotBase64}" width="${vp.width}" height="${vp.height}" alt="${escHtml(vp.vp)} screenshot" />`
    : `<div class="no-shot" style="width:${vp.width}px;height:${vp.height}px">No screenshot captured</div>`;

  return `
    <section class="vp-card">
      <div class="vp-head">
        <span class="vp-title">${escHtml(vp.vp)}</span>
        <span class="vp-badge ${vp.defects.length > 0 ? "bad" : "ok"}">${vp.defects.length} defect(s)</span>
      </div>
      <div class="stage" style="width:${vp.width}px;height:${vp.height}px">
        ${imgTag}
        <svg viewBox="0 0 ${vp.width} ${vp.height}" width="${vp.width}" height="${vp.height}" xmlns="http://www.w3.org/2000/svg">
          ${rectsSvg}
        </svg>
      </div>
    </section>`;
}

export function renderCollisionOverlayHtml(report: AuditReport): string {
  const compactJson = formatCompactAuditJson(report, 12);
  const cards = report.viewports.map(renderViewportCard).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>boxcheck — Collision Report (${escHtml(report.url)})</title>
  <style>
    :root { color-scheme: dark; --bg:#0b0f14; --panel:#111822; --border:#233044; --text:#e6edf3; --muted:#8b949e; }
    * { box-sizing: border-box; }
    body { margin:0; padding:20px 24px; background:var(--bg); color:var(--text); font-family:system-ui,-apple-system,sans-serif; }
    header { display:flex; justify-content:space-between; align-items:center; padding-bottom:14px; border-bottom:1px solid var(--border); margin-bottom:18px; }
    h1 { margin:0; font-family:ui-monospace,monospace; font-size:20px; }
    .meta { color:var(--muted); font-family:ui-monospace,monospace; font-size:12px; }
    .layout { display:grid; grid-template-columns:auto 1fr; gap:20px; align-items:start; }
    .vp-grid { display:flex; flex-wrap:wrap; gap:18px; }
    .vp-card { background:var(--panel); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
    .vp-head { display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:#161f2c; border-bottom:1px solid var(--border); font-family:ui-monospace,monospace; font-size:12px; }
    .vp-badge { padding:2px 8px; border-radius:999px; font-weight:700; font-size:11px; }
    .vp-badge.bad { background:rgba(248,81,73,.2); color:#ff7b72; border:1px solid rgba(248,81,73,.45); }
    .vp-badge.ok { background:rgba(63,185,80,.2); color:#56d364; }
    .stage { position:relative; overflow:hidden; background:#090d12; }
    .stage img, .stage svg { position:absolute; inset:0; display:block; }
    .stage svg { pointer-events:none; }
    .no-shot { display:grid; place-items:center; color:var(--muted); font-family:ui-monospace,monospace; font-size:12px; }
    .json-panel { background:var(--panel); border:1px solid var(--border); border-radius:10px; overflow:hidden; min-width:340px; }
    .json-panel h2 { margin:0; padding:10px 14px; font-size:13px; background:#161f2c; border-bottom:1px solid var(--border); font-family:ui-monospace,monospace; }
    pre { margin:0; padding:14px; font-family:ui-monospace,monospace; font-size:12px; line-height:1.5; color:#79c0ff; white-space:pre-wrap; word-break:break-word; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>boxcheck</h1>
      <div class="meta">${escHtml(report.url)} · ${report.durationMs}ms · ${report.totalDefects} defect(s)</div>
    </div>
    <div class="meta">Local &lt;500-token DOM Geometry &amp; CSS Collision Oracle</div>
  </header>
  <div class="layout">
    <div class="vp-grid">${cards}</div>
    <aside class="json-panel">
      <h2>Agent Payload (&lt;500 tokens JSON)</h2>
      <pre>${escHtml(compactJson)}</pre>
    </aside>
  </div>
</body>
</html>`;
}
