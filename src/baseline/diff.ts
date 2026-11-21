import type { BaselineDiffReport, BaselineSnapshot, GeometryDiffItem } from "../types.js";

export function diffBaselines(
  prev: BaselineSnapshot,
  curr: BaselineSnapshot,
  thresholdPx = 2,
  maxChanges = 30
): BaselineDiffReport {
  const allChanges: GeometryDiffItem[] = [];
  const unmatchedViewports: string[] = [];
  const prevByVp = new Map(prev.viewports.map((v) => [v.vp, v]));

  for (const currVp of curr.viewports) {
    const prevVp = prevByVp.get(currVp.vp);
    if (!prevVp) {
      unmatchedViewports.push(currVp.vp);
      continue;
    }

    const prevMap = new Map(prevVp.elements.map((e) => [e.selector, e.rect]));
    const currMap = new Map(currVp.elements.map((e) => [e.selector, e.rect]));

    for (const [sel, currRect] of currMap) {
      const prevRect = prevMap.get(sel);
      if (!prevRect) {
        allChanges.push({ kind: "ADDED", vp: currVp.vp, el: sel, curr: currRect });
        continue;
      }

      const dx = Math.round(currRect.x - prevRect.x);
      const dy = Math.round(currRect.y - prevRect.y);
      const dw = Math.round(currRect.w - prevRect.w);
      const dh = Math.round(currRect.h - prevRect.h);

      const resized = Math.abs(dw) > thresholdPx || Math.abs(dh) > thresholdPx;
      const shifted = Math.abs(dx) > thresholdPx || Math.abs(dy) > thresholdPx;

      if (resized) {
        allChanges.push({
          kind: "RESIZED",
          vp: currVp.vp,
          el: sel,
          dw,
          dh,
          dx: shifted ? dx : undefined,
          dy: shifted ? dy : undefined,
          prev: prevRect,
          curr: currRect,
        });
      } else if (shifted) {
        allChanges.push({
          kind: "SHIFTED",
          vp: currVp.vp,
          el: sel,
          dx,
          dy,
          prev: prevRect,
          curr: currRect,
        });
      }
    }

    for (const [sel, prevRect] of prevMap) {
      if (!currMap.has(sel)) {
        allChanges.push({ kind: "MISSING", vp: currVp.vp, el: sel, prev: prevRect });
      }
    }
  }

  const shown = allChanges.slice(0, maxChanges);
  const truncated = Math.max(0, allChanges.length - shown.length);

  return {
    url: curr.url,
    thresholdPx,
    totalChanges: allChanges.length,
    unmatchedViewports,
    changes: shown,
    ...(truncated > 0 ? { truncated } : {}),
  };
}
