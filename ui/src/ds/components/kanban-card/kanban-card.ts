// A kanban card: a title, a meta line and an optional "AI working" line. Focus it, then Alt+Left
// or Alt+Right moves it (see kanban-column). Forced states draw hover, focus and dragging in a
// still view.
import { createMetaLine } from "../metadata-line/metadata-line";
import "./kanban-card.css";

export interface KanbanCardOptions {
  readonly title: string;
  readonly meta?: readonly string[];
  /** Shows "AI working" with a spinner. */
  readonly working?: boolean;
  readonly forceState?: "hover" | "focus" | "dragging";
}

export function createKanbanCard(
  doc: Document,
  options: KanbanCardOptions,
): HTMLDivElement {
  const card = doc.createElement("div");
  card.className = "kcard";
  card.tabIndex = 0;
  if (options.forceState) card.classList.add(`is-${options.forceState}`);
  const title = doc.createElement("span");
  title.className = "k-title";
  title.textContent = options.title;
  title.title = options.title;
  card.append(title);
  if (options.meta?.length) card.append(createMetaLine(doc, options.meta));
  if (options.working) {
    const line = doc.createElement("span");
    line.className = "k-working";
    line.setAttribute("role", "status");
    const spin = doc.createElement("span");
    spin.className = "rec-spin";
    spin.setAttribute("aria-hidden", "true");
    line.append(spin, doc.createTextNode("AI working"));
    card.append(line);
  }
  return card;
}
