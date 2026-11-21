import type { CollectedElement, CollectedPageSnapshot, LayoutDefect, Rect } from "../types.js";

const SUBPIXEL_TOLERANCE_PX = 4;
const MIN_OVERLAP_AREA_PX = 24;
const MIN_CLIP_DELTA_PX = 6;
const MIN_OVERFLOW_PX = 4;

function isVisibleCandidate(el: CollectedElement): boolean {
  if (el.ariaHidden || el.inert || el.clippedOut) return false;
  if (el.visibility !== "visible") return false;
  if (el.opacity < 0.05) return false;
  if (el.pointerEvents === "none") return false;
  if (el.rect.w < 2 || el.rect.h < 2) return false;
  return true;
}

function isContentBearing(el: CollectedElement): boolean {
  return el.interactive || (el.hasDirectText && el.text.trim().length > 0);
}

function isSmallCornerBadge(el: CollectedElement): boolean {
  return (
    el.position === "absolute" &&
    !el.interactive &&
    el.rect.w <= 36 &&
    el.rect.h <= 28
  );
}

function isIntentionalOverlayLayer(el: CollectedElement): boolean {
  if (el.position === "fixed" || el.position === "sticky") return true;
  if (el.tag === "dialog") return true;
  if (el.role === "tooltip" || el.role === "dialog" || el.role === "menu" || el.role === "listbox") return true;
  if (isSmallCornerBadge(el)) return true;
  return false;
}

function isAncestorOrDescendant(a: CollectedElement, b: CollectedElement): boolean {
  return a.ancestorIds.includes(b.id) || b.ancestorIds.includes(a.id);
}

function intersectionRect(a: Rect, b: Rect): { w: number; h: number; area: number } {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return { w: 0, h: 0, area: 0 };
  return { w, h, area: Math.round(w * h) };
}

function roundRect(r: Rect): Rect {
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.w),
    h: Math.round(r.h),
  };
}

export function detectLayoutDefects(snapshot: CollectedPageSnapshot): LayoutDefect[] {
  const vp = snapshot.viewport.label;
  const vw = snapshot.viewport.width;
  const vh = snapshot.viewport.height;
  const visible = snapshot.elements.filter(isVisibleCandidate);
  const byId = new Map<number, CollectedElement>(snapshot.elements.map((e) => [e.id, e]));
  const defects: LayoutDefect[] = [];

  // 1. Sibling / non-ancestor OVERLAP between content-bearing elements
  const overlapCandidates = visible.filter((el) => isContentBearing(el) && !isIntentionalOverlayLayer(el));
  const seenOverlapPairs = new Set<string>();

  for (let i = 0; i < overlapCandidates.length; i++) {
    const a = overlapCandidates[i];
    for (let j = i + 1; j < overlapCandidates.length; j++) {
      const b = overlapCandidates[j];
      if (isAncestorOrDescendant(a, b)) continue;

      const inter = intersectionRect(a.rect, b.rect);
      if (inter.w < SUBPIXEL_TOLERANCE_PX || inter.h < SUBPIXEL_TOLERANCE_PX) continue;
      if (inter.area < MIN_OVERLAP_AREA_PX) continue;

      const pairKey = a.selector < b.selector ? `${a.selector}|${b.selector}` : `${b.selector}|${a.selector}`;
      if (seenOverlapPairs.has(pairKey)) continue;
      seenOverlapPairs.add(pairKey);

      defects.push({
        kind: "OVERLAP",
        vp,
        a: a.selector,
        b: b.selector,
        area_px: inter.area,
        box: roundRect(a.rect),
        box_b: roundRect(b.rect),
      });
    }
  }

  // 2. H_OVERFLOW: elements protruding past the viewport right edge when page overflows horizontally
  const docOverflow = Math.round(snapshot.documentScrollWidth - snapshot.documentClientWidth);
  if (docOverflow >= MIN_OVERFLOW_PX) {
    const overflowing = visible
      .filter((el) => {
        if (el.insideHorizontalScroll) return false;
        const clipsSelf =
          el.overflowX === "hidden" ||
          el.overflowX === "clip" ||
          el.overflowX === "auto" ||
          el.overflowX === "scroll";
        const rightEdgeOverflow = Math.round(el.rect.x + el.rect.w - vw);
        const internalOverflow = clipsSelf ? 0 : Math.round(el.scrollWidth - el.clientWidth);
        return rightEdgeOverflow >= MIN_OVERFLOW_PX || internalOverflow >= MIN_OVERFLOW_PX;
      })
      // Prefer containers with explicit protrusion (wider right edge, then shallower depth to pick root offender cleanly)
      .sort((a, b) => {
        const rightDiff = b.rect.x + b.rect.w - (a.rect.x + a.rect.w);
        if (Math.abs(rightDiff) > 4) return rightDiff;
        return a.ancestorIds.length - b.ancestorIds.length;
      });

    const reportedOverflowEls: CollectedElement[] = [];
    for (const el of overflowing) {
      // Bidirectional dedupe: skip if any ancestor OR descendant is already reported
      if (reportedOverflowEls.some((rep) => isAncestorOrDescendant(el, rep))) continue;

      const clipsSelf =
        el.overflowX === "hidden" ||
        el.overflowX === "clip" ||
        el.overflowX === "auto" ||
        el.overflowX === "scroll";
      const rightEdgeOverflow = Math.round(el.rect.x + el.rect.w - vw);
      const internalOverflow = clipsSelf ? 0 : Math.round(el.scrollWidth - el.clientWidth);
      const overflowPx = Math.max(rightEdgeOverflow, internalOverflow);
      if (overflowPx < MIN_OVERFLOW_PX) continue;

      reportedOverflowEls.push(el);
      defects.push({
        kind: "H_OVERFLOW",
        vp,
        el: el.selector,
        overflow_px: overflowPx,
        box: roundRect(el.rect),
      });
    }

    if (reportedOverflowEls.length === 0) {
      defects.push({
        kind: "H_OVERFLOW",
        vp,
        el: "document.documentElement",
        overflow_px: docOverflow,
        box: { x: 0, y: 0, w: vw + docOverflow, h: vh },
      });
    }
  }

  // 3. TEXT_CLIPPED: clipped text inside overflow:hidden/clip without intentional ellipsis or line-clamp
  for (const el of visible) {
    if (!el.hasDirectText || el.text.trim().length === 0) continue;
    if (el.textOverflow === "ellipsis" || el.lineClamp) continue;

    const clippedX =
      (el.overflowX === "hidden" || el.overflowX === "clip") &&
      el.clientWidth > 0 &&
      el.scrollWidth - el.clientWidth >= MIN_CLIP_DELTA_PX
        ? Math.round(el.scrollWidth - el.clientWidth)
        : 0;

    const clippedY =
      (el.overflowY === "hidden" || el.overflowY === "clip") &&
      el.clientHeight > 0 &&
      el.scrollHeight - el.clientHeight >= MIN_CLIP_DELTA_PX
        ? Math.round(el.scrollHeight - el.clientHeight)
        : 0;

    const maxClip = Math.max(clippedX, clippedY);
    if (maxClip >= MIN_CLIP_DELTA_PX) {
      defects.push({
        kind: "TEXT_CLIPPED",
        vp,
        el: el.selector,
        clipped_px: maxClip,
        box: roundRect(el.rect),
      });
    }
  }

  // 4. OFF_SCREEN: visible interactive elements pushed >50% outside viewport horizontal bounds
  for (const el of visible) {
    if (!el.interactive || el.insideHorizontalScroll || el.rect.w < 12) continue;
    const visLeft = Math.max(0, el.rect.x);
    const visRight = Math.min(vw, el.rect.x + el.rect.w);
    const visibleWidth = Math.max(0, visRight - visLeft);
    if (visibleWidth / el.rect.w < 0.5) {
      defects.push({
        kind: "OFF_SCREEN",
        vp,
        el: el.selector,
        overflow_px: Math.round(
          el.rect.x < 0 ? Math.abs(el.rect.x) : Math.max(0, el.rect.x + el.rect.w - vw)
        ),
        box: roundRect(el.rect),
      });
    }
  }

  // 5. OCCLUDED: interactive element whose click center is blocked by an unrelated element
  for (const el of visible) {
    if (!el.interactive || !el.occludedBySelector) continue;
    const cx = el.rect.x + el.rect.w / 2;
    const cy = el.rect.y + el.rect.h / 2;
    if (cx < 0 || cx > vw || cy < 0 || cy > vh) continue;

    if (el.occludedById !== null) {
      const blocker = byId.get(el.occludedById);
      if (blocker && (blocker.id === el.id || isAncestorOrDescendant(el, blocker))) {
        continue;
      }
    }

    defects.push({
      kind: "OCCLUDED",
      vp,
      el: el.selector,
      occluded_by: el.occludedBySelector,
      box: roundRect(el.rect),
    });
  }

  return defects;
}
