// A kanban card: a title, a meta line and an optional "AI working" line. Focus it, then Alt+Left
// or Alt+Right moves it (see kanban-column). Forced states draw hover, focus and dragging in a
// still view.
import { Check } from "lucide";
import { createIcon } from "../../icon";
import { createMetaLine } from "../metadata-line/metadata-line";
import { buildSpinner } from "../spinner/spinner";
import "./kanban-card.css";

interface KanbanCardBase {
  readonly title: string;
  readonly meta?: readonly string[];
  /** Shows "AI working" with a spinner. */
  readonly working?: boolean;
}

/** A card that moves with the keys (see kanban-column): a focusable div. */
export interface KanbanMovableCardOptions extends KanbanCardBase {
  readonly forceState?: "hover" | "focus" | "dragging";
  readonly onOpen?: undefined;
  readonly current?: never;
}

/**
 * A real button that opens the item: click, Enter or Space call `onOpen`. It never moves, so it
 * has no dragging state. Use it in a board with `move: false`.
 */
export interface KanbanButtonCardOptions extends KanbanCardBase {
  readonly forceState?: "hover" | "focus";
  readonly onOpen: () => void;
  /** The item that is open now: aria-current and a check mark, not colour alone. */
  readonly current?: boolean;
}

export type KanbanCardOptions =
  | KanbanMovableCardOptions
  | KanbanButtonCardOptions;

export function createKanbanCard(
  doc: Document,
  options: KanbanCardOptions,
): HTMLElement {
  const opens = options.onOpen !== undefined;
  const card = doc.createElement(opens ? "button" : "div");
  card.className = "kcard";
  if (opens) {
    const button = card as HTMLButtonElement;
    button.type = "button";
    card.classList.add("kcard-button");
    button.addEventListener("click", () => options.onOpen?.());
    if (options.current) {
      card.classList.add("is-current");
      card.setAttribute("aria-current", "true");
    }
  } else {
    card.tabIndex = 0;
  }
  if (options.forceState) card.classList.add(`is-${options.forceState}`);
  const title = doc.createElement("span");
  title.className = "k-title";
  title.textContent = options.title;
  title.title = options.title;
  if (opens && options.current) {
    const head = doc.createElement("span");
    head.className = "k-head";
    head.append(createIcon(Check, "sm", "k-mark"), title);
    card.append(head);
  } else {
    card.append(title);
  }
  if (options.meta?.length) card.append(createMetaLine(doc, options.meta));
  if (options.working) {
    const line = doc.createElement("span");
    line.className = "k-working";
    line.setAttribute("role", "status");
    line.append(buildSpinner(), doc.createTextNode("AI working"));
    card.append(line);
  }
  return card;
}
