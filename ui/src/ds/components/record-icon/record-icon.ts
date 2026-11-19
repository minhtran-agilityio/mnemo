// A small Lucide icon for the Records and Lists parts. Hidden from screen readers: the text next
// to it says the same thing. Sized by the --icon-sm token.
import { createElement, type IconNode } from "lucide";
import "./record-icon.css";

export function createRecordIcon(node: IconNode, extra?: string): SVGElement {
  const svg = createElement(node, {
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.classList.add("rec-ic");
  if (extra) svg.classList.add(extra);
  return svg;
}
