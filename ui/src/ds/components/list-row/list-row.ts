// A list row: an optional icon, a title (and a second line), and a meta text. A long title is cut
// off with an ellipsis and the full text is in its tooltip. The class names are the base ones
// (.row, .row-title, .row-meta) so the existing screens keep working.
import type { IconNode } from "lucide";
import { createRecordIcon } from "../record-icon/record-icon";
import "./list-row.css";

export interface ListRowOptions {
  readonly title: string;
  /** A second line under the title. */
  readonly sub?: string;
  /** The text at the right edge ("2 d"). */
  readonly meta?: string;
  readonly icon?: IconNode;
  /** `option` makes the row a listbox option (aria-selected). */
  readonly role?: "option";
  readonly selected?: boolean;
  /** Reachable by Tab when true (the default for a row that is not a listbox option). */
  readonly focusable?: boolean;
  /** Draws a state that cannot be live in a still view. */
  readonly forceState?: "hover" | "focus" | "selected";
}

export function createListRow(
  doc: Document,
  options: ListRowOptions,
): HTMLLIElement {
  const li = doc.createElement("li");
  li.className = "row";
  if (options.role === "option") {
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(options.selected === true));
    li.tabIndex = -1;
  } else {
    if (options.selected) li.classList.add("is-selected");
    li.tabIndex = options.focusable === false ? -1 : 0;
  }
  if (options.forceState) li.classList.add(`is-${options.forceState}`);
  if (options.icon) li.append(createRecordIcon(options.icon, "rec-ic-muted"));
  const title = doc.createElement("span");
  title.className = "row-title";
  title.textContent = options.title;
  title.title = options.title;
  if (options.sub) {
    const body = doc.createElement("span");
    body.className = "row-body";
    const sub = doc.createElement("span");
    sub.className = "row-meta row-sub";
    sub.textContent = options.sub;
    sub.title = options.sub;
    body.append(title, sub);
    li.append(body);
  } else {
    li.append(title);
  }
  if (options.meta) {
    const meta = doc.createElement("span");
    meta.className = "row-meta";
    meta.textContent = options.meta;
    li.append(meta);
  }
  return li;
}
