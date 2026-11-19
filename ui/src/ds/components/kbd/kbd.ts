// Shortcut hint: a <kbd> per key.
import "./kbd.css";

export function createKbd(doc: Document, key: string): HTMLElement {
  const kbd = doc.createElement("kbd");
  kbd.textContent = key;
  return kbd;
}

/** A label and its keys, for example "Save link" with "⌘" and "S". */
export function createShortcut(
  doc: Document,
  label: string,
  keys: readonly string[],
): HTMLElement {
  const wrap = doc.createElement("span");
  wrap.className = "shortcut";
  const text = doc.createElement("span");
  text.textContent = label;
  wrap.append(text, ...keys.map((k) => createKbd(doc, k)));
  return wrap;
}
