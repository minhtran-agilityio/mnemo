// Small DOM helpers shared by the surface components. Text always goes in as text, never as markup.
import { createElement, type IconNode } from "lucide";

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A Lucide icon as a decorative inline SVG, sized by a token. */
export function icon(node: IconNode, size: "sm" | "md" = "md"): SVGElement {
  const svg = createElement(node, {
    "aria-hidden": "true",
    focusable: "false",
    class: "ic",
  });
  svg.style.width = `var(--icon-${size})`;
  svg.style.height = `var(--icon-${size})`;
  return svg;
}

let counter = 0;
/** A fresh id for aria-labelledby, aria-controls and aria-describedby links. */
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements inside `root` that the keyboard can reach, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (n) => !n.hidden && !n.closest("[hidden]"),
  );
}
