import { CdpClient } from "../cdp/client.js";
import { launchHeadlessBrowser } from "../cdp/browser.js";
import { validateHttpUrl } from "../viewports.js";
import { DOM_COLLECTOR_SCRIPT } from "./collector.js";
import { detectLayoutDefects } from "./detector.js";
import { enrichDefectsWithCascade } from "./cascade.js";
import type {
  AuditReport,
  BaselineSnapshot,
  BaselineViewport,
  CollectedPageSnapshot,
  ViewportAuditResult,
  ViewportSpec,
} from "../types.js";

export interface RunAuditOptions {
  url: string;
  viewports: ViewportSpec[];
  cdpUrl?: string;
  chromePath?: string;
  captureScreenshots?: boolean;
  settleMs?: number;
  timeoutMs?: number;
}

async function evaluateSnapshot(
  cdp: CdpClient,
  sessionId: string,
  vp: ViewportSpec,
  url: string,
  settleMs: number,
  timeoutMs: number
): Promise<CollectedPageSnapshot> {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: false,
    },
    sessionId
  );

  const loadPromise = cdp.waitForEvent("Page.loadEventFired", timeoutMs, sessionId).catch(() => null);
  await cdp.send("Page.navigate", { url }, sessionId, timeoutMs);
  await loadPromise;
  if (settleMs > 0) {
    await new Promise((r) => setTimeout(r, settleMs));
  }

  const evalRes = await cdp.send(
    "Runtime.evaluate",
    {
      expression: DOM_COLLECTOR_SCRIPT,
      returnByValue: true,
      awaitPromise: false,
    },
    sessionId,
    timeoutMs
  );

  const val = (evalRes.result as { value?: Omit<CollectedPageSnapshot, "viewport"> } | undefined)?.value;
  if (!val || !Array.isArray(val.elements)) {
    throw new Error(`Failed to collect DOM geometry snapshot for ${url} at ${vp.label}`);
  }

  return {
    ...val,
    viewport: vp,
  };
}

export async function runAudit(opts: RunAuditOptions): Promise<AuditReport> {
  const validUrl = validateHttpUrl(opts.url);
  const startedAt = Date.now();
  const settleMs = opts.settleMs ?? 150;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const browser = await launchHeadlessBrowser({
    cdpUrl: opts.cdpUrl,
    chromePath: opts.chromePath,
    timeoutMs,
  });

  let cdp: CdpClient | null = null;
  let targetId: string | null = null;
  try {
    cdp = await CdpClient.connect(browser.wsUrl, timeoutMs);
    const created = await cdp.send("Target.createTarget", { url: "about:blank" });
    targetId = typeof created.targetId === "string" ? created.targetId : null;
    if (!targetId) throw new Error("CDP Target.createTarget failed");

    const attached = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const sessionId = typeof attached.sessionId === "string" ? attached.sessionId : "";
    if (!sessionId) throw new Error("CDP Target.attachToTarget failed");

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);

    const viewportResults: ViewportAuditResult[] = [];
    for (const vp of opts.viewports) {
      const vpStart = Date.now();
      const snapshot = await evaluateSnapshot(cdp, sessionId, vp, validUrl, settleMs, timeoutMs);
      const defects = detectLayoutDefects(snapshot);
      await enrichDefectsWithCascade(cdp, sessionId, defects);

      let screenshotBase64: string | undefined;
      if (opts.captureScreenshots) {
        const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId, timeoutMs);
        if (typeof shot.data === "string") {
          screenshotBase64 = shot.data;
        }
      }

      viewportResults.push({
        vp: vp.label,
        width: vp.width,
        height: vp.height,
        defects,
        screenshotBase64,
        elementCount: snapshot.elements.length,
        durationMs: Date.now() - vpStart,
      });
    }

    const totalDefects = viewportResults.reduce((acc, v) => acc + v.defects.length, 0);
    return {
      url: validUrl,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      totalDefects,
      viewports: viewportResults,
    };
  } finally {
    if (cdp && targetId) {
      await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    }
    cdp?.close();
    await browser.close();
  }
}

export async function captureBaselineSnapshot(opts: RunAuditOptions): Promise<BaselineSnapshot> {
  const validUrl = validateHttpUrl(opts.url);
  const settleMs = opts.settleMs ?? 150;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const browser = await launchHeadlessBrowser({
    cdpUrl: opts.cdpUrl,
    chromePath: opts.chromePath,
    timeoutMs,
  });

  let cdp: CdpClient | null = null;
  let targetId: string | null = null;
  try {
    cdp = await CdpClient.connect(browser.wsUrl, timeoutMs);
    const created = await cdp.send("Target.createTarget", { url: "about:blank" });
    targetId = typeof created.targetId === "string" ? created.targetId : null;
    if (!targetId) throw new Error("CDP Target.createTarget failed");

    const attached = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const sessionId = typeof attached.sessionId === "string" ? attached.sessionId : "";
    if (!sessionId) throw new Error("CDP Target.attachToTarget failed");

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);

    const viewports: BaselineViewport[] = [];
    for (const vp of opts.viewports) {
      const snapshot = await evaluateSnapshot(cdp, sessionId, vp, validUrl, settleMs, timeoutMs);
      const seen = new Set<string>();
      const elements = snapshot.elements
        .filter((e) => {
          if (seen.has(e.selector)) return false;
          seen.add(e.selector);
          return e.visibility === "visible" && e.opacity >= 0.05 && e.rect.w >= 4 && e.rect.h >= 4;
        })
        .map((e) => ({
          selector: e.selector,
          rect: {
            x: Math.round(e.rect.x),
            y: Math.round(e.rect.y),
            w: Math.round(e.rect.w),
            h: Math.round(e.rect.h),
          },
        }));

      viewports.push({
        vp: vp.label,
        width: vp.width,
        height: vp.height,
        elements,
      });
    }

    return {
      url: validUrl,
      createdAt: new Date().toISOString(),
      viewports,
    };
  } finally {
    if (cdp && targetId) {
      await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    }
    cdp?.close();
    await browser.close();
  }
}
