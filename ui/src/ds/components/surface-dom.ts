// Small DOM helpers shared by the surface components. Text always goes in as text, never as markup.
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
