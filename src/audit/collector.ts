export const DOM_COLLECTOR_SCRIPT = `(() => {
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "META", "LINK", "HEAD", "TITLE", "BR", "HR"]);
  const INTERACTIVE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  const INTERACTIVE_ROLES = new Set(["button", "link", "menuitem", "tab", "checkbox", "radio", "switch", "combobox"]);

  function buildSelector(el) {
    if (el.id && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(el.id)) {
      return el.tagName.toLowerCase() + "#" + el.id;
    }
    const tag = el.tagName.toLowerCase();
    const classes = typeof el.className === "string"
      ? el.className.trim().split(/\\s+/).filter((c) => c && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(c)).slice(0, 2)
      : [];
    const base = classes.length > 0 ? tag + "." + classes.join(".") : tag;
    try {
      if (document.querySelectorAll(base).length === 1) return base;
    } catch {}
    let idx = 1;
    let sib = el.previousElementSibling;
    while (sib) {
      if (sib.tagName === el.tagName) idx++;
      sib = sib.previousElementSibling;
    }
    const parent = el.parentElement;
    if (parent && parent.tagName !== "BODY" && parent.tagName !== "HTML") {
      const pTag = parent.tagName.toLowerCase();
      const pCls = typeof parent.className === "string"
        ? parent.className.trim().split(/\\s+/).filter((c) => c && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(c)).slice(0, 1)
        : [];
      const pPart = parent.id ? pTag + "#" + parent.id : (pCls.length ? pTag + "." + pCls[0] : pTag);
      return pPart + " > " + base + ":nth-of-type(" + idx + ")";
    }
    return base + ":nth-of-type(" + idx + ")";
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

  const allNodes = Array.from(document.querySelectorAll("body *")).slice(0, 1200);
  const idMap = new Map();
  let nextId = 1;
  for (const el of allNodes) {
    if (SKIP_TAGS.has(el.tagName)) continue;
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
    while (p) {
      const pid = idMap.get(p);
      if (pid !== undefined) {
        if (parentId === null) parentId = pid;
        ancestorIds.push(pid);
      }
      p = p.parentElement;
    }

    const role = el.getAttribute("role");
    const interactive =
      INTERACTIVE_TAGS.has(el.tagName) ||
      (role !== null && INTERACTIVE_ROLES.has(role)) ||
      el.hasAttribute("onclick") ||
      cs.cursor === "pointer";

    const dText = directText(el);
    const hasDirectText = dText.length > 0 || (interactive && (el.innerText || "").trim().length > 0);
    const text = dText || (interactive ? (el.innerText || "").trim().slice(0, 80) : "");

    let occludedBySelector = null;
    let occludedById = null;
    if (interactive && r.width >= 8 && r.height >= 8) {
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
      ariaHidden: el.getAttribute("aria-hidden") === "true",
      visibility: cs.visibility,
      opacity: Number.parseFloat(cs.opacity || "1"),
      zIndex: Number.isFinite(zParsed) ? zParsed : 0,
      occludedBySelector,
      occludedById,
    });
  }

  return {
    url: window.location.href,
    documentScrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
    documentClientWidth: document.documentElement.clientWidth,
    elements,
  };
})()`;
