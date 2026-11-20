// Text: a line of plain text in a tone and a size from the type scale, for notes, meta lines and
// status lines. Content goes in as text or as nodes, never as markup. Spacing and wrapping are the
// caller's layout.
import "./text.css";

export type TextTone = "default" | "muted";
export type TextSize = "base" | "md" | "sm";

export interface TextOptions {
  /** The element. Default "p". */
  as?: "p" | "h1" | "span";
  /** "muted" for quiet notes. Default: the colour of the text around it. */
  tone?: TextTone;
  /** A size from the type scale. Default: the size of the text around it. */
  size?: TextSize;
  /** A string goes in as text. In a list, strings go in as text nodes and nodes as they are. */
  content: string | readonly (Node | string)[];
}

/** The classes of the text part, for an element that already exists in the page. */
export function textClasses(
  options: { tone?: TextTone; size?: TextSize } = {},
): string[] {
  const classes = ["text"];
  if (options.tone && options.tone !== "default")
    classes.push(`text-${options.tone}`);
  if (options.size) classes.push(`text-${options.size}`);
  return classes;
}

export function buildText(doc: Document, options: TextOptions): HTMLElement {
  const node = doc.createElement(options.as ?? "p");
  node.className = textClasses(options).join(" ");
  if (typeof options.content === "string") node.textContent = options.content;
  else node.append(...options.content);
  return node;
}
