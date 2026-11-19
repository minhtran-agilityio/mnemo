// Tooltip: a short name for a control, shown on hover and on keyboard focus. It stays while the
// pointer is over it, and Escape hides it (WCAG 1.4.13). It never holds the only copy of a label
// that a screen reader needs: the anchor is described by it.
import { el, uid } from "../surface-dom";
import "./tooltip.css";

export interface Tooltip {
  /** The wrapper to put in the page. It holds the anchor and the tip. */
  element: HTMLElement;
  tip: HTMLElement;
}

export function createTooltip(
  anchor: HTMLElement,
  text: string,
  doc: Document = document,
): Tooltip {
  const wrap = el(doc, "span", "tip-anchor");
  const tip = el(doc, "span", "tip", text);
  tip.id = uid("tip");
  tip.setAttribute("role", "tooltip");
  anchor.setAttribute("aria-describedby", tip.id);
  wrap.append(anchor, tip);
  wrap.addEventListener("keydown", (event) => {
    if (event.key === "Escape") wrap.classList.add("tip-hidden");
  });
  const reset = () => wrap.classList.remove("tip-hidden");
  wrap.addEventListener("mouseleave", reset);
  wrap.addEventListener("focusout", reset);
  return { element: wrap, tip };
}

/** The tip drawn in the page, for samples. */
export function createStaticTooltip(
  text: string,
  doc: Document = document,
): HTMLElement {
  const tip = el(doc, "span", "tip static", text);
  tip.setAttribute("role", "tooltip");
  return tip;
}
