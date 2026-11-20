// A list of tags. Past `max`, the rest is one "+N" item whose name says how many tags it hides.
import "./tag-list.css";

/** The text sits in its own box, which is cut with an ellipsis and has room for stacked marks. */
function text(doc: Document, value: string): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = "tag-text";
  span.textContent = value;
  return span;
}

export function createTagList(
  doc: Document,
  tags: readonly string[],
  options: { max?: number; label?: string } = {},
): HTMLUListElement {
  const ul = doc.createElement("ul");
  ul.className = "tags";
  ul.setAttribute("aria-label", options.label ?? "Tags");
  const max = options.max ?? tags.length;
  for (const tag of tags.slice(0, max)) {
    const li = doc.createElement("li");
    li.className = "tag-item";
    li.append(text(doc, tag));
    li.title = tag;
    ul.append(li);
  }
  const rest = tags.length - max;
  if (rest > 0) {
    const li = doc.createElement("li");
    li.className = "tag-item tag-more";
    li.append(text(doc, `+${rest}`));
    li.title = tags.slice(max).join(", ");
    li.setAttribute("aria-label", `${rest} more tags`);
    ul.append(li);
  }
  return ul;
}
