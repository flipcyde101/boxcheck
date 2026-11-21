import type { BaselineDiffReport, BaselineSnapshot, GeometryDiffItem } from "../types.js";

export function diffBaselines(
  prev: BaselineSnapshot,
  curr: BaselineSnapshot,
  thresholdPx = 2
): BaselineDiffReport {
  const changes: GeometryDiffItem[] = [];
  const prevByVp = new Map(prev.viewports.map((v) => [v.vp, v]));

  for (const currVp of curr.viewports) {
    const prevVp = prevByVp.get(currVp.vp);
    if (!prevVp) continue;

    const prevMap = new Map(prevVp.elements.map((e) => [e.selector, e.rect]));
    const currMap = new Map(currVp.elements.map((e) => [e.selector, e.rect]));

    for (const [sel, currRect] of currMap) {
      const prevRect = prevMap.get(sel);
      if (!prevRect) {
        changes.push({ kind: "ADDED", vp: currVp.vp, el: sel, curr: currRect });
        continue;
      }

      const dx = Math.round(currRect.x - prevRect.x);
      const dy = Math.round(currRect.y - prevRect.y);
      const dw = Math.round(currRect.w - prevRect.w);
      const dh = Math.round(currRect.h - prevRect.h);

      const resized = Math.abs(dw) > thresholdPx || Math.abs(dh) > thresholdPx;
      const shifted = Math.abs(dx) > thresholdPx || Math.abs(dy) > thresholdPx;

      if (resized) {
        changes.push({
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
        changes.push({
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
        changes.push({ kind: "MISSING", vp: currVp.vp, el: sel, prev: prevRect });
      }
    }
  }

  return {
    url: curr.url,
    thresholdPx,
    totalChanges: changes.length,
    changes,
  };
}
