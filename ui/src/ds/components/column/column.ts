// Page: the reading column. It keeps lines to about 72 characters.
import { el } from "../surface-dom";
import "./column.css";

export interface PageOptions {
  children?: readonly Node[];
  doc?: Document;
}

export function createPage(options: PageOptions = {}): HTMLElement {
  const page = el(options.doc ?? document, "div", "page");
  if (options.children) page.append(...options.children);
  return page;
}
