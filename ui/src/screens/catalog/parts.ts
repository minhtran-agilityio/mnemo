// Shared helpers of the UI Catalog screen: the row layout, the source tag and the state caption.
// Every tab renderer in ./tabs builds its rows with these, so all tabs look the same.
// All text goes in as text. Nothing here sets a colour: looks come from ds/catalog.css.

import {
  type BuiltEntryName,
  type CatalogEntry,
  type CatalogTab,
  entriesFor,
  isBuilt,
} from "../../ds/catalog";

/** What the shared frame hands to the renderer of a tab. */
export interface TabContext {
  readonly doc: Document;
  /** The element that carries data-theme and data-motion. */
  readonly root: HTMLElement;
  /** Aborts when the screen closes. Pass it to every listener you add outside your own panel. */
  readonly signal: AbortSignal;
  /** Shows a message as a real toast from the Feedback toast region (no Undo). */
  toast(message: string): void;
  /** Runs `fn` each time the theme on screen changes (Light or Dark, or the system setting). */
  onThemeChange(fn: () => void): void;
}

/** A tab renderer fills the empty tab panel it is given. The shared frame already put the title,
 * the intro line and the coverage bar into the panel; append the rows after them. */
export type TabRenderer = (panel: HTMLElement, ctx: TabContext) => void;

/** What a row renderer returns: the live examples, or the examples and a layout choice. */
export type RowExamples =
  | Node[]
  | { nodes: Node[]; column?: boolean; wide?: boolean };

/** Draws the examples of one built entry. */
export type RowRenderer = (ctx: TabContext) => RowExamples;

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

export const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
export const title = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** The heading of a row: the entry's label, else its name with a capital. */
export const headingOf = (entry: CatalogEntry) =>
  entry.label ?? title(entry.name);

export function button(
  doc: Document,
  className: string,
  text: string,
): HTMLButtonElement {
  const b = el(doc, "button", className, text);
  b.type = "button";
  return b;
}

/** The source tag as text in a box, so colour is never the only signal. */
export function sourceTag(
  doc: Document,
  source: string,
  className?: string,
): HTMLElement {
  const kind =
    className ??
    (source === "ds"
      ? "src-ds"
      : source === "base.css"
        ? "src-base"
        : "src-plan");
  return el(doc, "span", `src ${kind}`, source);
}

/**
 * One state of an example: the live part (any number of nodes) and under it a mono caption that
 * names the state ("hover", "disabled"). `grow` lets the example take the room that is left.
 */
export function state(
  doc: Document,
  caption: string,
  node: Node | Node[],
  options: { grow?: boolean } = {},
): HTMLElement {
  const box = el(doc, "div", options.grow ? "st grow" : "st");
  box.append(
    ...(Array.isArray(node) ? node : [node]),
    el(doc, "span", "cap", caption),
  );
  return box;
}

/**
 * One row: on the left the label, the source tag and the notes; on the right the examples.
 * `column` stacks the examples instead of letting them wrap. `wide` marks examples that are really
 * wider than a small window (a table, a board, a status bar): they scroll sideways in their own box.
 */
export function catRow(
  doc: Document,
  entry: CatalogEntry,
  examples: Node[],
  options: { column?: boolean; wide?: boolean } = {},
): HTMLElement {
  const row = el(doc, "div", "cat-row");
  row.dataset.part = entry.name;
  row.tabIndex = -1;
  const meta = el(doc, "div", "cat-meta");
  meta.append(
    el(doc, "h3", undefined, headingOf(entry)),
    sourceTag(doc, entry.source),
  );
  if (entry.notes) meta.append(el(doc, "p", undefined, entry.notes));
  if (entry.states.length)
    meta.append(
      el(doc, "p", "cat-states", `States: ${entry.states.join(", ")}`),
    );
  const ex = el(
    doc,
    "div",
    ["cat-ex", options.column ? "col" : "", options.wide ? "is-wide" : ""]
      .filter(Boolean)
      .join(" "),
  );
  ex.append(...examples);
  row.append(meta, ex);
  return row;
}

/** The row of a planned part: its meta and a line that says it is not built. */
function plannedRow(doc: Document, entry: CatalogEntry): HTMLElement {
  const variants = entry.variants.length
    ? ` Planned variants: ${entry.variants.join(", ")}.`
    : "";
  return catRow(doc, entry, [
    el(doc, "p", "cat-note", `Not built yet: ${entry.source}.${variants}`),
  ]);
}

/**
 * The rows of a tab, in registry order, in one `.cat-rows` box. A built entry is drawn by its
 * renderer in `renderers`; a planned entry shows its source tag and what is planned.
 * The renderers map is typed from the registry: a built entry without a renderer is a type error.
 */
export function entryRows<T extends CatalogTab>(
  ctx: TabContext,
  tab: T,
  renderers: Record<BuiltEntryName<T>, RowRenderer>,
): HTMLElement {
  const doc = ctx.doc;
  const box = el(doc, "div", "cat-rows");
  const byName: Record<string, RowRenderer | undefined> = renderers;
  for (const entry of entriesFor(tab)) {
    const render = isBuilt(entry) ? byName[entry.name] : undefined;
    if (!render) {
      box.append(plannedRow(doc, entry));
      continue;
    }
    const result = render(ctx);
    const parts = Array.isArray(result) ? { nodes: result } : result;
    box.append(
      catRow(doc, entry, parts.nodes, {
        column: "column" in parts && parts.column,
        wide: "wide" in parts && parts.wide,
      }),
    );
  }
  return box;
}
