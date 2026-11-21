import { describe, it, expect } from "vitest";
import { parseViewports, validateHttpUrl } from "../src/viewports.js";

describe("parseViewports & validateHttpUrl", () => {
  it("parses comma-separated WxH viewport lists and named presets", () => {
    expect(parseViewports("390x844,1440x900")).toEqual([
      { width: 390, height: 844, label: "390x844" },
      { width: 1440, height: 900, label: "1440x900" },
    ]);
    expect(parseViewports("mobile,desktop")).toEqual([
      { width: 390, height: 844, label: "390x844" },
      { width: 1440, height: 900, label: "1440x900" },
    ]);
  });

  it("rejects malformed or out-of-range viewports", () => {
    expect(() => parseViewports("0x800")).toThrow();
    expect(() => parseViewports("abc")).toThrow();
    expect(() => parseViewports("99999x800")).toThrow();
  });

  it("enforces http/https schemes only (Review Focus #4)", () => {
    expect(validateHttpUrl("http://localhost:3000/pricing")).toBe("http://localhost:3000/pricing");
    expect(validateHttpUrl("https://example.com")).toBe("https://example.com/");
    expect(() => validateHttpUrl("file:///etc/passwd")).toThrow(/http/i);
    expect(() => validateHttpUrl("chrome://settings")).toThrow(/http/i);
    expect(() => validateHttpUrl("javascript:alert(1)")).toThrow(/http/i);
  });
});
