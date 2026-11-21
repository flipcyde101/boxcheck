import type { CdpClient } from "../cdp/client.js";
import type { LayoutDefect } from "../types.js";

const LAYOUT_PROPS = new Set([
  "display",
  "position",
  "flex-wrap",
  "width",
  "min-width",
  "max-width",
  "height",
  "overflow",
  "overflow-x",
  "overflow-y",
  "white-space",
  "z-index",
  "left",
  "right",
  "top",
  "grid-template-columns",
]);

interface CdpMatchedRule {
  rule?: {
    origin?: string;
    selectorList?: { text?: string };
    style?: {
      cssProperties?: Array<{ name?: string; value?: string }>;
      range?: { startLine?: number };
    };
    styleSheetId?: string;
  };
}

export async function enrichDefectsWithCascade(
  cdp: CdpClient,
  sessionId: string,
  defects: LayoutDefect[]
): Promise<void> {
  if (defects.length === 0) return;

  try {
    await cdp.send("DOM.enable", {}, sessionId);
    await cdp.send("CSS.enable", {}, sessionId);
    const doc = await cdp.send("DOM.getDocument", { depth: 1 }, sessionId);
    const rootNodeId = (doc.root as { nodeId?: number } | undefined)?.nodeId;
    if (!rootNodeId) return;

    const targetSelectors = new Set<string>();
    for (const d of defects.slice(0, 12)) {
      const sel = d.el ?? d.a;
      if (sel && sel !== "document.documentElement") {
        targetSelectors.add(sel);
      }
    }

    const cssBySelector = new Map<string, string>();
    for (const selector of targetSelectors) {
      try {
        const q = await cdp.send("DOM.querySelector", { nodeId: rootNodeId, selector }, sessionId);
        const nodeId = typeof q.nodeId === "number" ? q.nodeId : 0;
        if (nodeId <= 0) continue;

        const matched = await cdp.send("CSS.getMatchedStylesForNode", { nodeId }, sessionId);
        const matchedRules = (matched.matchedCSSRules as CdpMatchedRule[] | undefined) ?? [];

        // Walk from most-specific (last author rule) backwards to pick the winning layout rule
        for (let i = matchedRules.length - 1; i >= 0; i--) {
          const r = matchedRules[i].rule;
          if (!r || r.origin === "user-agent") continue;
          const props = (r.style?.cssProperties ?? []).filter(
            (p) => typeof p.name === "string" && LAYOUT_PROPS.has(p.name) && p.value
          );
          if (props.length === 0) continue;

          const selText = (r.selectorList?.text ?? selector).replace(/\s+/g, " ").trim();
          const lineNum = typeof r.style?.range?.startLine === "number" ? r.style.range.startLine + 1 : null;
          const decls = props
            .slice(0, 3)
            .map((p) => `${p.name}: ${p.value}`)
            .join("; ");
          const loc = lineNum ? `line ${lineNum} ` : "";
          cssBySelector.set(selector, `${loc}(${selText} { ${decls} })`);
          break;
        }
      } catch {
        // Ignore selectors that cannot be queried or have no matched styles
      }
    }

    for (const d of defects) {
      const sel = d.el ?? d.a;
      if (sel && cssBySelector.has(sel)) {
        d.winning_css = cssBySelector.get(sel);
      }
    }
  } catch {
    // Non-fatal: return geometry defects cleanly even if CSS domain fails
  }
}
