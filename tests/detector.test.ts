import { describe, it, expect } from "vitest";
import { detectLayoutDefects } from "../src/audit/detector.js";
import type { CollectedElement, CollectedPageSnapshot } from "../src/types.js";

function makeEl(overrides: Partial<CollectedElement> & { id: number; selector: string }): CollectedElement {
  return {
    parentId: null,
    ancestorIds: [],
    tag: "div",
    role: null,
    text: "Sample text",
    interactive: false,
    hasDirectText: true,
    rect: { x: 20, y: 20, w: 120, h: 40 },
    scrollWidth: 120,
    clientWidth: 120,
    scrollHeight: 40,
    clientHeight: 40,
    overflowX: "visible",
    overflowY: "visible",
    textOverflow: "clip",
    whiteSpace: "normal",
    position: "static",
    pointerEvents: "auto",
    ariaHidden: false,
    visibility: "visible",
    opacity: 1,
    zIndex: 0,
    occludedBySelector: null,
    occludedById: null,
    ...overrides,
  };
}

function makeSnapshot(elements: CollectedElement[], docScrollWidth = 390): CollectedPageSnapshot {
  return {
    url: "http://localhost:3000",
    viewport: { width: 390, height: 844, label: "390x844" },
    documentScrollWidth: docScrollWidth,
    documentClientWidth: 390,
    elements,
  };
}

describe("detectLayoutDefects & False-Positive Shield (Review Focus #1)", () => {
  it("detects sibling OVERLAP, H_OVERFLOW, TEXT_CLIPPED, OFF_SCREEN, and OCCLUDED accurately", () => {
    const snap = makeSnapshot(
      [
        // Overlapping sibling button & hero heading
        makeEl({ id: 1, selector: "button.nav-cta", tag: "button", interactive: true, rect: { x: 20, y: 20, w: 140, h: 44 } }),
        makeEl({ id: 2, selector: "h1.hero", tag: "h1", rect: { x: 100, y: 30, w: 240, h: 50 } }),
        // Horizontal overflow grid
        makeEl({
          id: 3,
          selector: "div.pricing-grid",
          hasDirectText: false,
          rect: { x: 0, y: 120, w: 438, h: 200 },
          scrollWidth: 438,
          clientWidth: 390,
        }),
        // Clipped button text (overflow: hidden, NOT text-overflow: ellipsis)
        makeEl({
          id: 4,
          selector: "button.buy-now",
          tag: "button",
          interactive: true,
          rect: { x: 20, y: 360, w: 90, h: 36 },
          scrollWidth: 162,
          clientWidth: 90,
          overflowX: "hidden",
          textOverflow: "clip",
        }),
        // Off-screen interactive link
        makeEl({
          id: 5,
          selector: "a.hidden-cta",
          tag: "a",
          interactive: true,
          rect: { x: 380, y: 420, w: 120, h: 40 },
        }),
        // Occluded interactive button blocked by unrelated floating banner
        makeEl({
          id: 6,
          selector: "button.submit-order",
          tag: "button",
          interactive: true,
          rect: { x: 20, y: 500, w: 160, h: 44 },
          occludedBySelector: "div.cookie-banner",
          occludedById: 7,
        }),
        makeEl({
          id: 7,
          selector: "div.cookie-banner",
          position: "fixed",
          hasDirectText: false,
          rect: { x: 0, y: 490, w: 390, h: 80 },
          zIndex: 999,
        }),
      ],
      438
    );

    const defects = detectLayoutDefects(snap);
    expect(defects.some((d) => d.kind === "OVERLAP" && d.a === "button.nav-cta" && d.b === "h1.hero")).toBe(true);
    expect(defects.some((d) => d.kind === "H_OVERFLOW" && d.el === "div.pricing-grid" && d.overflow_px === 48)).toBe(true);
    expect(defects.some((d) => d.kind === "TEXT_CLIPPED" && d.el === "button.buy-now" && d.clipped_px === 72)).toBe(true);
    expect(defects.some((d) => d.kind === "OFF_SCREEN" && d.el === "a.hidden-cta")).toBe(true);
    expect(defects.some((d) => d.kind === "OCCLUDED" && d.el === "button.submit-order" && d.occluded_by === "div.cookie-banner")).toBe(true);
  });

  it("ignores ancestor-descendant pairs, pointer-events:none, aria-hidden, sticky/fixed intentional layers, ellipsis, and <4px subpixel jitter", () => {
    const snap = makeSnapshot([
      // Ancestor + descendant inside it (must NOT flag overlap!)
      makeEl({ id: 10, selector: "div.card", rect: { x: 10, y: 10, w: 200, h: 100 } }),
      makeEl({ id: 11, parentId: 10, ancestorIds: [10], selector: "div.card > h2", rect: { x: 20, y: 20, w: 180, h: 30 } }),

      // Decorative pointer-events: none & aria-hidden badge
      makeEl({ id: 12, selector: "span.bg-glow", pointerEvents: "none", rect: { x: 20, y: 20, w: 180, h: 30 } }),
      makeEl({ id: 13, selector: "span.sr-deco", ariaHidden: true, rect: { x: 20, y: 20, w: 180, h: 30 } }),

      // Sticky navbar floating over body text
      makeEl({ id: 14, selector: "header.sticky-nav", position: "sticky", rect: { x: 0, y: 0, w: 390, h: 56 }, zIndex: 50 }),

      // Intentional text-overflow: ellipsis
      makeEl({
        id: 15,
        selector: "span.truncate",
        rect: { x: 20, y: 200, w: 100, h: 24 },
        scrollWidth: 220,
        clientWidth: 100,
        overflowX: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }),

      // Subpixel <4px overlap between two siblings
      makeEl({ id: 16, selector: "p.line-a", rect: { x: 20, y: 260, w: 200, h: 20 } }),
      makeEl({ id: 17, selector: "p.line-b", rect: { x: 20, y: 277, w: 200, h: 20 } }), // 3px vertical touch

      // Intentional avatar badge (small decorative non-interactive badge inside/on corner)
      makeEl({ id: 18, selector: "img.avatar", tag: "img", hasDirectText: false, rect: { x: 20, y: 320, w: 48, h: 48 } }),
      makeEl({ id: 19, selector: "span.status-dot", tag: "span", hasDirectText: false, text: "", rect: { x: 56, y: 356, w: 12, h: 12 } }),
    ]);

    const defects = detectLayoutDefects(snap);
    expect(defects).toEqual([]);
  });
});
