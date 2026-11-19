// The design system: the only entry point. Importing it loads the tokens and the base styles.
// The paths go through "../ds/" so a path check for stale "./tokens.css" imports stays simple.
import "../ds/tokens.css";
import "../ds/base.css";

// Icons: Lucide (ISC), bundled from the npm package, no CDN. Import each icon by name from
// "lucide/dist/esm/icons/<name>.mjs" so the build keeps only the icons that are used.
import { createElement, type IconNode } from "lucide";

/** Draws one Lucide icon as an inline SVG sized by the `--icon-sm` or `--icon-md` token. */
export function createIcon(
  node: IconNode,
  size: "sm" | "md" = "md",
): SVGElement {
  const svg = createElement(node, {
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.style.width = `var(--icon-${size})`;
  svg.style.height = `var(--icon-${size})`;
  return svg;
}
