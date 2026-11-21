export interface ViewportSpec {
  width: number;
  height: number;
  label: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CollectedElement {
  id: number;
  parentId: number | null;
  ancestorIds: number[];
  selector: string;
  tag: string;
  role: string | null;
  text: string;
  interactive: boolean;
  hasDirectText: boolean;
  rect: Rect;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  overflowX: string;
  overflowY: string;
  textOverflow: string;
  whiteSpace: string;
  position: string;
  pointerEvents: string;
  ariaHidden: boolean;
  visibility: string;
  opacity: number;
  zIndex: number;
  occludedBySelector: string | null;
  occludedById: number | null;
  insideHorizontalScroll?: boolean;
  clippedOut?: boolean;
  inert?: boolean;
  lineClamp?: boolean;
}

export interface CollectedPageSnapshot {
  url: string;
  viewport: ViewportSpec;
  documentScrollWidth: number;
  documentClientWidth: number;
  elements: CollectedElement[];
}

export type DefectKind =
  | "OVERLAP"
  | "H_OVERFLOW"
  | "TEXT_CLIPPED"
  | "OFF_SCREEN"
  | "OCCLUDED";

export interface LayoutDefect {
  kind: DefectKind;
  vp: string;
  el?: string;
  a?: string;
  b?: string;
  area_px?: number;
  overflow_px?: number;
  clipped_px?: number;
  occluded_by?: string;
  box?: Rect;
  box_b?: Rect;
  winning_css?: string;
}

export interface ViewportAuditResult {
  vp: string;
  width: number;
  height: number;
  defects: LayoutDefect[];
  screenshotBase64?: string;
  elementCount: number;
  durationMs: number;
}

export interface AuditReport {
  url: string;
  timestamp: string;
  durationMs: number;
  totalDefects: number;
  viewports: ViewportAuditResult[];
}

export interface BaselineElement {
  selector: string;
  rect: Rect;
}

export interface BaselineViewport {
  vp: string;
  width: number;
  height: number;
  elements: BaselineElement[];
}

export interface BaselineSnapshot {
  url: string;
  createdAt: string;
  viewports: BaselineViewport[];
}

export type GeometryChangeKind = "SHIFTED" | "RESIZED" | "MISSING" | "ADDED";

export interface GeometryDiffItem {
  kind: GeometryChangeKind;
  vp: string;
  el: string;
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
  prev?: Rect;
  curr?: Rect;
}

export interface BaselineDiffReport {
  url: string;
  thresholdPx: number;
  totalChanges: number;
  unmatchedViewports: string[];
  changes: GeometryDiffItem[];
  truncated?: number;
}
