import "./sample.css";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function group(...children: HTMLElement[]): HTMLElement {
  const box = el("div", "sample-group");
  box.append(...children);
  return box;
}

// Shows every base style (page, card, button, input, pill, list row) in the current theme.
// It follows the system light or dark setting. Remove it when the real app shell uses these styles.
export function mountSample(root: HTMLElement): void {
  root.classList.add("sample", "page");
  root.append(el("h2", undefined, "Style sample"));

  const card = el("article", "card");
  card.append(
    el("h3", undefined, "Card"),
    el(
      "p",
      undefined,
      "A card holds one item. Text, borders and surface come from tokens.",
    ),
  );

  const primary = el("button", "btn btn-primary", "Save link");
  primary.type = "button";
  const normal = el("button", "btn", "Cancel");
  normal.type = "button";
  const ghost = el("button", "btn btn-ghost", "Learn more");
  ghost.type = "button";
  const disabled = el("button", "btn", "Disabled");
  disabled.type = "button";
  disabled.disabled = true;
  card.append(group(primary, normal, ghost, disabled));

  const field = el("label", "field", "Link");
  const input = el("input", "input");
  input.type = "url";
  input.placeholder = "https://example.com";
  field.append(input);
  card.append(field);

  card.append(
    group(
      el("span", "pill", "Draft"),
      el("span", "pill pill-info", "Link"),
      el("span", "pill pill-good", "Saved"),
      el("span", "pill pill-warn", "Guess"),
      el("span", "pill pill-note", "Idea"),
      el("span", "pill pill-bad", "Failed"),
    ),
  );

  const list = el("ul", "list");
  for (const [title, meta] of [
    ["Read the design notes", "Today"],
    [
      "A very long title that wraps or is cut off with an ellipsis when the row is narrow",
      "Yesterday",
    ],
    ["Plan the week", "Mon"],
  ]) {
    const row = el("li", "row");
    row.append(el("span", "row-title", title), el("span", "row-meta", meta));
    list.append(row);
  }
  card.append(list);

  root.append(card);
}
