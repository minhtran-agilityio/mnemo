// The one icon helper of the design system. Lucide (ISC), bundled from the npm package, no CDN.
// Import each icon by name from "lucide" (for example `import { Search } from "lucide"`); the
// package has no side effects, so the build keeps only the icons that are used.
// Components import this module, never index.ts, so there is no import cycle.
import { createElement, type IconNode } from "lucide";
import "./icon.css";

/**
 * Draws one Lucide icon as a decorative inline SVG: hidden from screen readers, sized by the
 * `--icon-sm` or `--icon-md` token, never shrunk in a flex row. It carries the class `ic` and any
 * extra classes (`ic-muted` for the muted colour).
 */
export function createIcon(
  node: IconNode,
  size: "sm" | "md" = "sm",
  ...classes: string[]
): SVGElement {
  const svg = createElement(node, {
    "aria-hidden": "true",
    focusable: "false",
    class: ["ic", ...classes].join(" "),
  });
  svg.style.width = `var(--icon-${size})`;
  svg.style.height = `var(--icon-${size})`;
  return svg;
}
