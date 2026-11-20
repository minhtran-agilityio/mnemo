// Later mark: the small "Later" word next to a feature the roadmap plans for later. A word, never
// colour alone. Not a control, and it never shows a count.
import "./later-mark.css";

export function buildLaterMark(doc: Document): HTMLSpanElement {
  const mark = doc.createElement("span");
  mark.className = "later-mark";
  mark.textContent = "Later";
  return mark;
}
