// A list of tags. Past `max`, the rest is one "+N" item whose name says how many tags it hides.
import "./tag-list.css";

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
    li.textContent = tag;
    li.title = tag;
    ul.append(li);
  }
  const rest = tags.length - max;
  if (rest > 0) {
    const li = doc.createElement("li");
    li.className = "tag-item tag-more";
    li.textContent = `+${rest}`;
    li.title = tags.slice(max).join(", ");
    li.setAttribute("aria-label", `${rest} more tags`);
    ul.append(li);
  }
  return ul;
}
