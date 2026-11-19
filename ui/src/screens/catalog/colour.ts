// Colour maths for Inspect: parse a computed colour, blend it over its ground and give the WCAG
// 2.2 contrast ratio. No DOM. A colour is [red, green, blue, alpha]: 0 to 255, alpha 0 to 1.

export type Rgba = readonly [number, number, number, number];

/**
 * Reads a colour a browser reports: "#rgb", "#rrggbb", "#rrggbbaa", "rgb()", "rgba()" and
 * "color(srgb r g b / a)". Returns null for anything else.
 */
export function parseColour(text: string): Rgba | null {
  const s = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.replace(/./g, "$&$&");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const fn = /^(rgba?|color)\(([^)]+)\)$/.exec(s);
  if (!fn) return null;
  const body = fn[2].replace(/^srgb\s+/, "");
  if (fn[1] === "color" && body === fn[2]) return null;
  const parts = body.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  // In the srgb colour function a bare number is 0 to 1 and a percentage is of 1; both end up 0 to 255.
  const isColor = fn[1] === "color";
  const channel = (p: string) => {
    if (p.endsWith("%")) return (Number.parseFloat(p) / 100) * 255;
    return Number.parseFloat(p) * (isColor ? 255 : 1);
  };
  const nums = parts.slice(0, 3).map(channel);
  if (nums.some(Number.isNaN)) return null;
  const alphaPart = parts[3];
  const alpha =
    alphaPart === undefined
      ? 1
      : alphaPart.endsWith("%")
        ? Number.parseFloat(alphaPart) / 100
        : Number.parseFloat(alphaPart);
  return [nums[0], nums[1], nums[2], alpha];
}

/** The colour `top` shows as when it lies over the opaque colour `ground`. */
export function blend(top: Rgba, ground: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + ground[0] * (1 - a),
    top[1] * a + ground[1] * (1 - a),
    top[2] * a + ground[2] * (1 - a),
    1,
  ];
}

/**
 * The colour a stack of backgrounds shows. `layers` run from the innermost (the element itself) to
 * the outermost. The walk stops at the first opaque layer; that colour, or `page` when none is
 * opaque, is the base, and each semi-transparent layer inside it is blended over it in order.
 */
export function compositeLayers(layers: readonly Rgba[], page: Rgba): Rgba {
  const stop = layers.findIndex((l) => l[3] >= 1);
  const base: Rgba = stop < 0 ? page : layers[stop];
  const over = stop < 0 ? layers : layers.slice(0, stop);
  let ground = base;
  for (let i = over.length - 1; i >= 0; i--) ground = blend(over[i], ground);
  return ground;
}

function luminance(c: Rgba): number {
  const [r, g, b] = [c[0], c[1], c[2]].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two colours, 1 to 21. */
export function contrastOf(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The words after a text contrast ratio: pass, large text only, fail, or exempt (disabled). */
export function textVerdict(ratio: number, exempt: boolean): string {
  if (exempt) return "disabled, exempt";
  if (ratio >= 4.5) return "AA pass";
  if (ratio >= 3) return "large text only";
  return "fails AA";
}

/** The words after a target size: whether the smaller side reaches 24 and 44 CSS pixels. */
export function targetVerdict(width: number, height: number): string {
  const side = Math.min(width, height);
  const at = (need: number) => (side >= need ? "ok" : "under");
  return `24: ${at(24)} · 44: ${at(44)}`;
}
