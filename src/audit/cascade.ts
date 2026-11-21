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

interface CdpCssProp {
  name?: string;
  value?: string;
  disabled?: boolean;
}

interface CdpMatchedRule {
  rule?: {
    origin?: string;
    selectorList?: { text?: string };
    style?: {
      cssProperties?: CdpCssProp[];
      range?: { startLine?: number };
    };
  };
}

function dedupeLayoutProps(props: CdpCssProp[]): Array<{ name: string; value: string }> {
  const seen = new Map<string, string>();
  for (const p of props) {
    if (p.disabled) continue;
    if (typeof p.name !== "string" || typeof p.value !== "string") continue;
    const name = p.name.trim();
    const val = p.value.trim();
    if (!LAYOUT_PROPS.has(name) || !val) continue;
    seen.set(name, val);
  }
  return Array.from(seen.entries()).map(([name, value]) => ({ name, value }));
}

async function resolveWinningCss(
  cdp: CdpClient,
  sessionId: string,
  rootNodeId: number,
  selector: string
): Promise<string | null> {
  try {
    const q = await cdp.send("DOM.querySelector", { nodeId: rootNodeId, selector }, sessionId);
    const nodeId = typeof q.nodeId === "number" ? q.nodeId : 0;
    if (nodeId <= 0) return null;

    const matched = await cdp.send("CSS.getMatchedStylesForNode", { nodeId }, sessionId);

    // 1. Check inline style first (highest specificity)
    const inlineProps = dedupeLayoutProps(
      ((matched.inlineStyle as { cssProperties?: CdpCssProp[] } | undefined)?.cssProperties) ?? []
    );
    if (inlineProps.length > 0) {
      const decls = inlineProps
        .slice(0, 3)
        .map((p) => `${p.name}: ${p.value}`)
        .join("; ");
      return `inline (${decls})`;
    }

    // 2. Walk author CSS rules from most specific backwards
    const matchedRules = (matched.matchedCSSRules as CdpMatchedRule[] | undefined) ?? [];
    for (let i = matchedRules.length - 1; i >= 0; i--) {
      const r = matchedRules[i].rule;
      if (!r || r.origin === "user-agent") continue;
      const props = dedupeLayoutProps(r.style?.cssProperties ?? []);
      if (props.length === 0) continue;

      const rawSel = (r.selectorList?.text ?? selector).replace(/\s+/g, " ").trim();
      const selText = rawSel.length > 44 ? `${rawSel.slice(0, 41)}...` : rawSel;
      const lineNum = typeof r.style?.range?.startLine === "number" ? r.style.range.startLine + 1 : null;
      const decls = props
        .slice(0, 3)
        .map((p) => `${p.name}: ${p.value}`)
        .join("; ");
      const loc = lineNum ? `line ${lineNum} ` : "";
      return `${loc}(${selText} { ${decls} })`;
    }
  } catch {
    return null;
  }
  return null;
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

    const cache = new Map<string, string | null>();
    const lookup = async (sel: string | undefined): Promise<string | null> => {
      if (!sel || sel === "document.documentElement") return null;
      if (cache.has(sel)) return cache.get(sel) ?? null;
      const val = await resolveWinningCss(cdp, sessionId, rootNodeId, sel);
      cache.set(sel, val);
      return val;
    };

    for (const d of defects.slice(0, 12)) {
      const primary = d.kind === "OCCLUDED" ? d.occluded_by : (d.el ?? d.a);
      const fallback = d.kind === "OCCLUDED" ? d.el : d.b;
      const css = (await lookup(primary)) ?? (await lookup(fallback));
      if (css) {
        d.winning_css = css;
      }
    }
  } catch {
    // Non-fatal: return geometry defects cleanly even if CSS domain fails
  }
}
