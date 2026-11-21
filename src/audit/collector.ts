export const DOM_COLLECTOR_SCRIPT = `(() => {
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "META", "LINK", "HEAD", "TITLE", "BR", "HR"]);
  const INTERACTIVE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  const INTERACTIVE_ROLES = new Set(["button", "link", "menuitem", "tab", "checkbox", "radio", "switch", "combobox"]);

  function cssEscape(str) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(str);
    }
    return str.replace(/[^A-Za-z0-9_-]/g, "\\\\$&");
  }

  function isUnique(sel) {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  }

  function nthOfType(el) {
    let idx = 1;
    let sib = el.previousElementSibling;
    while (sib) {
      if (sib.tagName === el.tagName) idx++;
      sib = sib.previousElementSibling;
    }
    return idx;
  }

  function segmentFor(el, forceNth) {
    const tag = el.tagName.toLowerCase();
    if (el.id) {
      const idSel = tag + "#" + cssEscape(el.id);
      if (isUnique(idSel)) return idSel;
    }
    const classes = typeof el.className === "string"
      ? el.className.trim().split(/\\s+/).filter((c) => c && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(c)).slice(0, 2)
      : [];
    const base = classes.length > 0 ? tag + "." + classes.join(".") : tag;
    if (!forceNth && isUnique(base)) return base;
    return base + ":nth-of-type(" + nthOfType(el) + ")";
  }

  function buildSelector(el) {
    const first = segmentFor(el, false);
    if (isUnique(first)) return first;

    const parts = [segmentFor(el, true)];
    let cur = el.parentElement;
    while (cur && cur.tagName !== "HTML") {
      if (cur.tagName === "BODY") {
        parts.unshift("body");
        break;
      }
      if (cur.id) {
        const idSeg = cur.tagName.toLowerCase() + "#" + cssEscape(cur.id);
        if (isUnique(idSeg)) {
          parts.unshift(idSeg);
          const candidate = parts.join(" > ");
          if (isUnique(candidate)) return candidate;
        }
      }
      parts.unshift(segmentFor(cur, true));
      const candidate = parts.join(" > ");
      if (isUnique(candidate)) return candidate;
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function directText(el) {
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        out += node.textContent || "";
      }
    }
    return out.trim();
  }

  const allNodes = Array.from(document.querySelectorAll("body *")).slice(0, 1400);
  const idMap = new Map();
  let nextId = 1;
  for (const el of allNodes) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    if (el instanceof SVGElement && el.tagName.toLowerCase() !== "svg") continue;
    idMap.set(el, nextId++);
  }

  const elements = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  for (const [el, id] of idMap.entries()) {
    const cs = window.getComputedStyle(el);
    if (cs.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) continue;

    const ancestorIds = [];
    let p = el.parentElement;
    let parentId = null;
    let effectiveAriaHidden = el.getAttribute("aria-hidden") === "true";
    let effectiveOpacity = Number.parseFloat(cs.opacity || "1");
    let effectiveInert = el.hasAttribute("inert");
    let insideHorizontalScroll = false;
    let clipLeft = -Infinity;
    let clipTop = -Infinity;
    let clipRight = Infinity;
    let clipBottom = Infinity;

    while (p && p.tagName !== "HTML") {
      const pid = idMap.get(p);
      if (pid !== undefined) {
        if (parentId === null) parentId = pid;
        ancestorIds.push(pid);
      }
      if (p.getAttribute("aria-hidden") === "true") effectiveAriaHidden = true;
      if (p.hasAttribute("inert")) effectiveInert = true;
      const pcs = window.getComputedStyle(p);
      const pOp = Number.parseFloat(pcs.opacity || "1");
      if (Number.isFinite(pOp)) effectiveOpacity *= pOp;

      if (pcs.overflowX === "auto" || pcs.overflowX === "scroll" || pcs.overflowX === "hidden" || pcs.overflowX === "clip") {
        if (p.tagName !== "BODY") {
          const pr = p.getBoundingClientRect();
          if (pcs.overflowX === "auto" || pcs.overflowX === "scroll") {
            insideHorizontalScroll = true;
          }
          clipLeft = Math.max(clipLeft, pr.left);
          clipRight = Math.min(clipRight, pr.right);
        }
      }
      if (pcs.overflowY === "auto" || pcs.overflowY === "scroll" || pcs.overflowY === "hidden" || pcs.overflowY === "clip") {
        if (p.tagName !== "BODY") {
          const pr = p.getBoundingClientRect();
          clipTop = Math.max(clipTop, pr.top);
          clipBottom = Math.min(clipBottom, pr.bottom);
        }
      }
      p = p.parentElement;
    }

    const visW = Math.min(r.right, clipRight) - Math.max(r.left, clipLeft);
    const visH = Math.min(r.bottom, clipBottom) - Math.max(r.top, clipTop);
    const clippedOut = visW < 2 || visH < 2;

    const role = el.getAttribute("role");
    const interactive =
      INTERACTIVE_TAGS.has(el.tagName) ||
      (role !== null && INTERACTIVE_ROLES.has(role)) ||
      el.hasAttribute("onclick") ||
      cs.cursor === "pointer";

    const dText = directText(el);
    const isLeafInteractive = (el.tagName === "BUTTON" || el.tagName === "A") && el.children.length === 0;
    const hasDirectText = dText.length > 0 || (isLeafInteractive && (el.innerText || "").trim().length > 0);
    const text = dText || (isLeafInteractive ? (el.innerText || "").trim().slice(0, 80) : "");

    const webkitLineClamp = cs.getPropertyValue("-webkit-line-clamp") || "";
    const lineClamp = webkitLineClamp !== "" && webkitLineClamp !== "none" && Number.parseInt(webkitLineClamp, 10) > 0;

    let occludedBySelector = null;
    let occludedById = null;
    if (interactive && !clippedOut && !effectiveAriaHidden && !effectiveInert && effectiveOpacity >= 0.05 && r.width >= 8 && r.height >= 8) {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx >= 1 && cx <= vw - 1 && cy >= 1 && cy <= vh - 1) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
          occludedBySelector = buildSelector(hit);
          occludedById = idMap.get(hit) ?? null;
        }
      }
    }

    const zParsed = Number.parseInt(cs.zIndex, 10);

    elements.push({
      id,
      parentId,
      ancestorIds,
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      role,
      text,
      interactive,
      hasDirectText,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
      position: cs.position,
      pointerEvents: cs.pointerEvents,
      ariaHidden: effectiveAriaHidden,
      visibility: cs.visibility,
      opacity: effectiveOpacity,
      zIndex: Number.isFinite(zParsed) ? zParsed : 0,
      occludedBySelector,
      occludedById,
      insideHorizontalScroll,
      clippedOut,
      inert: effectiveInert,
      lineClamp,
    });
  }

  return {
    url: window.location.href,
    documentScrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
    documentClientWidth: document.documentElement.clientWidth,
    elements,
  };
})()`;
