// The icon helper of the feedback parts: one Lucide icon as an inline SVG, sized by a token.
// Kept here, not imported from ds/index.ts, so the parts never import the barrel that exports them.
import { createElement, type IconNode } from "lucide";
import "./feedback-icon.css";

/** Draws a decorative icon: hidden from screen readers, sized by `--icon-sm` or `--icon-md`. */
export function createFeedbackIcon(
  node: IconNode,
  size: "sm" | "md" = "sm",
): SVGElement {
  const svg = createElement(node, {
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.style.width = `var(--icon-${size})`;
  svg.style.height = `var(--icon-${size})`;
  svg.classList.add("feedback-icon");
  return svg;
}
