import type { ViewportSpec } from "./types.js";

const NAMED_PRESETS: Record<string, [number, number]> = {
  mobile: [390, 844],
  tablet: [768, 1024],
  laptop: [1280, 800],
  desktop: [1440, 900],
};

export const DEFAULT_VIEWPORTS: ViewportSpec[] = [
  { width: 390, height: 844, label: "390x844" },
  { width: 1440, height: 900, label: "1440x900" },
];

export function parseViewports(input: string): ViewportSpec[] {
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error("Viewport list cannot be empty.");
  }

  const out: ViewportSpec[] = [];
  for (const part of parts) {
    const preset = NAMED_PRESETS[part.toLowerCase()];
    if (preset) {
      out.push({ width: preset[0], height: preset[1], label: `${preset[0]}x${preset[1]}` });
      continue;
    }

    const match = /^(\d+)x(\d+)$/i.exec(part);
    if (!match) {
      throw new Error(`Invalid viewport "${part}". Expected WxH (e.g. 390x844) or mobile/tablet/laptop/desktop.`);
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width < 200 || width > 7680 || height < 200 || height > 4320) {
      throw new Error(`Viewport "${part}" out of valid bounds (200..7680 x 200..4320).`);
    }
    out.push({ width, height, label: `${width}x${height}` });
  }

  return out;
}

export function validateHttpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: "${rawUrl}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol "${parsed.protocol}". Only http: and https: URLs are allowed.`);
  }
  return parsed.toString();
}
