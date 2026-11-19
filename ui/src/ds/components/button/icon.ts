// A Lucide icon as inline SVG for the controls. Sized by the --icon-sm or --icon-md token.
// Kept apart from ds/index.ts so a component never imports the design system entry point.
import { createElement, type IconNode } from "lucide";

export function controlIcon(
  node: IconNode,
  size: "sm" | "md" = "sm",
): SVGElement {
  const svg = createElement(node, {
    "aria-hidden": "true",
    focusable: "false",
    class: "ic",
  });
  svg.style.width = `var(--icon-${size})`;
  svg.style.height = `var(--icon-${size})`;
  return svg;
}
