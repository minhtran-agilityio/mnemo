// Divider: a thin line between two groups in one surface.
import { el } from "../surface-dom";
import "./divider.css";

export function createDivider(doc: Document = document): HTMLHRElement {
  return el(doc, "hr", "divider");
}
