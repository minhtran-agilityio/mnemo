import "./dot.css";

export type DotTone = "good" | "accent" | "warn" | "bad" | "off";

export interface DotOptions {
  readonly tone: DotTone;
  /** A slow fade for work in progress. Off when the system asks for reduced motion. */
  readonly pulse?: boolean;
}

/** The bare dot. Decorative, so hidden from screen readers: put a word next to it. */
export function buildDot(options: DotOptions): HTMLSpanElement {
  const dot = document.createElement("span");
  dot.className = `dot dot-${options.tone}${options.pulse ? " pulse" : ""}`;
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

/** A dot and its word, so colour is never the only signal. */
export function buildDotLabel(text: string, tone: DotTone): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "dot-label";
  const word = document.createElement("span");
  word.textContent = text;
  wrap.append(buildDot({ tone }), word);
  return wrap;
}
