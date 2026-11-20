// Card: a container for one item. It has no interactive states.
import { el } from "../surface-dom";
import "./card.css";

export interface CardOptions {
  title?: string;
  /** Heading level of the title. Default 3. */
  level?: 2 | 3 | 4;
  children?: readonly Node[];
  /** "section" makes the card a named region of the page (with `label`). Default "article". */
  element?: "article" | "section";
  /** The accessible name of the card. */
  label?: string;
  doc?: Document;
}

export function createCard(options: CardOptions = {}): HTMLElement {
  const doc = options.doc ?? document;
  const card = el(doc, options.element ?? "article", "card");
  if (options.label) card.setAttribute("aria-label", options.label);
  if (options.title)
    card.append(
      el(doc, `h${options.level ?? 3}` as "h3", undefined, options.title),
    );
  if (options.children) card.append(...options.children);
  return card;
}
