// The design system: the only entry point. Importing it loads the tokens and the base styles.
import "../ds/tokens.css";
import "../ds/base.css";

// One barrel per tab of the design system. A component lives in components/<name>/ and is
// exported from the barrel of its tab, so each tab's work edits only its own barrel.
export * from "./components/controls";
export * from "./components/feedback";
export * from "./components/lists";
export * from "./components/records";
export * from "./components/surfaces";

// Icons: Lucide (ISC), bundled from the npm package, no CDN. Import each icon by name from
// "lucide" (for example `import { Search } from "lucide"`); the package has no side effects,
// so the build keeps only the icons that are used.
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
