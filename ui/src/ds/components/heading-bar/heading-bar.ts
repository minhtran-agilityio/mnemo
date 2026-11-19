// Page header: a crumb, the title, one line of context and the actions (one primary).
import { el } from "../surface-dom";
import "./heading-bar.css";

export interface PageHeaderOptions {
  title: string;
  /** The place above the title, for example "Library". */
  crumb?: string;
  /** One line of context under the title. */
  context?: string;
  /** Buttons on the right. Put the one primary action last. */
  actions?: readonly Node[];
  doc?: Document;
}

export function createPageHeader(options: PageHeaderOptions): HTMLElement {
  const doc = options.doc ?? document;
  const header = el(doc, "header", "pagehead");
  const text = el(doc, "div", "t");
  if (options.crumb) text.append(el(doc, "span", "crumb", options.crumb));
  text.append(el(doc, "h2", undefined, options.title));
  if (options.context) text.append(el(doc, "span", "context", options.context));
  header.append(text);
  if (options.actions?.length) {
    const actions = el(doc, "div", "pagehead-actions");
    actions.append(...options.actions);
    header.append(actions);
  }
  return header;
}
