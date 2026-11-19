// Panel: a quiet grouping surface, lighter than a card. Not interactive.
import { el } from "../surface-dom";
import "./panel.css";

export interface PanelOptions {
  title?: string;
  children?: readonly Node[];
  doc?: Document;
}

export function createPanel(options: PanelOptions = {}): HTMLElement {
  const doc = options.doc ?? document;
  const panel = el(doc, "section", "panel");
  if (options.title) {
    const heading = el(doc, "b", "panel-title", options.title);
    panel.append(heading);
  }
  if (options.children) panel.append(...options.children);
  return panel;
}
