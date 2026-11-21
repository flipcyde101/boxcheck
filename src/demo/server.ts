import http from "node:http";

const DEMO_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AcmeCloud — Pricing (boxcheck demo)</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      background: #0d1117;
      color: #e6edf3;
    }
    .nav-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: nowrap;
      padding: 16px 24px;
      border-bottom: 1px solid #21262d;
      background: #161b22;
      position: relative;
      height: 64px;
    }
    .brand { font-weight: 700; font-size: 18px; color: #58a6ff; white-space: nowrap; }
    .nav-cta {
      background: #238636;
      color: #fff;
      border: 0;
      border-radius: 6px;
      padding: 10px 18px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
    }
    .hero-section {
      padding: 40px 24px 24px;
      max-width: 980px;
      margin: 0 auto;
    }
    .hero-title {
      font-size: 36px;
      line-height: 1.15;
      margin: 0 0 12px;
    }
    .hero-sub {
      color: #8b949e;
      font-size: 16px;
      margin: 0 0 28px;
    }
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }
    .plan-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 20px;
    }
    .plan-card h3 { margin: 0 0 8px; font-size: 18px; }
    .price { font-size: 28px; font-weight: 700; margin-bottom: 14px; color: #79c0ff; }
    .upgrade-btn {
      background: #1f6feb;
      color: #fff;
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
    }
    .checkout-bar {
      max-width: 980px;
      margin: 28px auto;
      padding: 0 24px;
    }
    .checkout-btn {
      background: #8957e5;
      color: #fff;
      border: 0;
      border-radius: 6px;
      padding: 12px 20px;
      font-size: 15px;
      font-weight: 600;
    }
    .cookie-banner {
      display: none;
    }

    /* Classic AI-generated responsive bugs triggered at mobile <= 480px */
    @media (max-width: 480px) {
      .nav-cta {
        position: absolute;
        left: 16px;
        top: 52px;
        width: 170px;
      }
      .hero-section {
        padding-top: 8px;
      }
      .hero-title {
        font-size: 28px;
        margin-top: -12px;
      }
      .pricing-grid {
        width: 438px;
        grid-template-columns: repeat(3, 136px);
      }
      .upgrade-btn {
        width: 92px;
        overflow: hidden;
        white-space: nowrap;
      }
      .checkout-bar {
        position: relative;
        margin-top: 24px;
      }
      .cookie-banner {
        display: block;
        position: fixed;
        left: 0;
        right: 0;
        top: 392px;
        height: 74px;
        background: rgba(248, 81, 73, 0.92);
        color: #fff;
        padding: 16px 20px;
        font-weight: 600;
        z-index: 999;
      }
    }
  </style>
</head>
<body>
  <header class="nav-row">
    <div class="brand">AcmeCloud</div>
    <button class="nav-cta">Start Free Trial</button>
  </header>

  <main class="hero-section">
    <h1 class="hero-title">Deploy at global scale</h1>
    <p class="hero-sub">Simple transparent pricing for fast engineering teams.</p>

    <div class="pricing-grid">
      <div class="plan-card">
        <h3>Starter</h3>
        <div class="price">$19</div>
        <button class="upgrade-btn">Upgrade Starter Plan</button>
      </div>
      <div class="plan-card">
        <h3>Pro</h3>
        <div class="price">$49</div>
        <button class="upgrade-btn">Upgrade Pro Plan</button>
      </div>
      <div class="plan-card">
        <h3>Scale</h3>
        <div class="price">$149</div>
        <button class="upgrade-btn">Upgrade Scale Plan</button>
      </div>
    </div>
  </main>

  <div class="checkout-bar">
    <button class="checkout-btn">Proceed to Checkout</button>
  </div>

  <div class="cookie-banner">We use cookies to track analytics — Accept All</div>
</body>
</html>`;

export function startDemoSiteServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(DEMO_HTML);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind demo server"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
