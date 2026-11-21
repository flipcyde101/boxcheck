import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { existsSync } from "node:fs";
import { findChromeExecutable, launchHeadlessBrowser } from "../src/cdp/browser.js";
import { runAudit } from "../src/audit/runner.js";

function startTestSite(html: string): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("bad addr");
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
  });
}

describe("raw CDP native-WebSocket browser runner & cascade attribution (Review Focus #2)", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const s = servers.pop()!;
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  it("discovers Chrome/Edge, launches cleanly, and removes isolated temp profile on close", async () => {
    const exe = findChromeExecutable();
    expect(exe).not.toBeNull();

    const browser = await launchHeadlessBrowser({ chromePath: exe! });
    const profileDir = browser.userDataDir;
    expect(profileDir).toBeTruthy();
    expect(existsSync(profileDir!)).toBe(true);
    expect(browser.wsUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\//);

    await browser.close();
    expect(existsSync(profileDir!)).toBe(false);
  }, 15_000);

  it("detects real OVERLAP, H_OVERFLOW, TEXT_CLIPPED, and OCCLUDED with winning_css on a real Chrome DOM", async () => {
    const html = `<!doctype html><html><head><style>
      body { margin: 0; font-family: sans-serif; background: #111; color: #fff; }
      .nav-row { display: flex; flex-wrap: nowrap; position: relative; height: 48px; }
      .nav-cta { position: absolute; left: 20px; top: 10px; width: 150px; height: 40px; }
      .hero { position: absolute; left: 90px; top: 18px; width: 220px; height: 44px; margin: 0; }
      .pricing-grid { margin-top: 90px; width: 450px; height: 60px; background: #222; }
      .buy-btn { margin-top: 20px; margin-left: 16px; width: 70px; height: 32px; overflow: hidden; white-space: nowrap; }
      .blocked-btn { position: absolute; left: 20px; top: 260px; width: 140px; height: 40px; z-index: 1; }
      .blocker { position: fixed; left: 10px; top: 250px; width: 200px; height: 60px; z-index: 99; background: rgba(255,0,0,0.5); }
    </style></head><body>
      <div class="nav-row">
        <button class="nav-cta">Start Free Trial</button>
        <h1 class="hero">Ship Faster Today</h1>
      </div>
      <div class="pricing-grid">Wide 450px pricing table</div>
      <button class="buy-btn">Complete Enterprise Checkout Now</button>
      <button class="blocked-btn">Confirm Payment</button>
      <div class="blocker">Cookie Overlay</div>
    </body></html>`;

    const site = await startTestSite(html);
    servers.push(site.server);

    const report = await runAudit({
      url: site.url,
      viewports: [{ width: 390, height: 844, label: "390x844" }],
      captureScreenshots: true,
    });

    expect(report.totalDefects).toBeGreaterThanOrEqual(3);
    const defects = report.viewports[0].defects;
    expect(defects.some((d) => d.kind === "OVERLAP")).toBe(true);
    expect(defects.some((d) => d.kind === "H_OVERFLOW")).toBe(true);
    expect(defects.some((d) => d.kind === "TEXT_CLIPPED")).toBe(true);
    expect(defects.some((d) => d.kind === "OCCLUDED")).toBe(true);
    // At least one defect has CDP winning_css populated!
    expect(defects.some((d) => typeof d.winning_css === "string" && d.winning_css.length > 0)).toBe(true);
    // Real PNG screenshot captured
    expect(report.viewports[0].screenshotBase64?.length).toBeGreaterThan(100);
  }, 20_000);
});
