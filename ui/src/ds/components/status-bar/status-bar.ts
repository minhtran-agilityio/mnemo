// Status bar: the bottom line of the window. AI line, usage and save state.
// Colour is never the only signal: every item has words, and a warning or limit also has an icon.
import type { IconNode } from "lucide";
import { el, icon } from "../surface-dom";
import "./status-bar.css";

export interface StatusItem {
  text?: string;
  /** A small dot before the text. `off` is an empty ring. */
  dot?: "good" | "accent" | "off";
  /** The dot pulses (a job is running). Off when motion is off. */
  pulse?: boolean;
  icon?: IconNode;
  /** Text colour for a warning or a limit. Pair it with an icon. */
  tone?: "warn" | "bad";
  /** Numbers in the mono face. */
  mono?: boolean;
  /** Pushes this item to the right edge. */
  push?: boolean;
  /** A text button, for example "Turn AI on". */
  action?: { label: string; onAction(): void };
}

export interface StatusBarOptions {
  items: readonly StatusItem[];
  /** Default "Status". */
  label?: string;
  doc?: Document;
}

export function createStatusBar(options: StatusBarOptions): HTMLElement {
  const doc = options.doc ?? document;
  const bar = el(doc, "div", "statusbar");
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-label", options.label ?? "Status");
  for (const item of options.items) {
    const node = el(doc, "span", "sb-item");
    if (item.push) node.classList.add("push");
    if (item.tone) node.classList.add(`sb-${item.tone}`);
    if (item.dot) {
      const dot = el(doc, "span", `sb-dot sb-dot-${item.dot}`);
      if (item.pulse) dot.classList.add("pulse");
      dot.setAttribute("aria-hidden", "true");
      node.append(dot);
    }
    if (item.icon) node.append(icon(item.icon));
    if (item.text !== undefined) {
      const text = el(
        doc,
        "span",
        item.mono ? "mono num" : undefined,
        item.text,
      );
      node.append(text);
    }
    if (item.action) {
      const button = el(doc, "button", undefined, item.action.label);
      button.type = "button";
      button.addEventListener("click", item.action.onAction);
      node.append(button);
    }
    bar.append(node);
  }
  return bar;
}
