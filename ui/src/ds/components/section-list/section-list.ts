// Section list: a labelled list of sections, each a row button with its name and its current value
// under it (Settings: "Appearance / System"). One row is current. The rows are built once and
// updated in place, so the row that has keyboard focus keeps it. All text goes in as text.
import "./section-list.css";

export interface SectionListSection {
  id: string;
  label: string;
  /** The current value, shown under the name. A long value is cut with an ellipsis and a title. */
  value: string;
}

export interface SectionListOptions {
  /** Names the nav landmark. */
  label: string;
  sections: readonly SectionListSection[];
  /** The id of the current section. */
  current?: string;
  /** Called when the owner picks a section. The list marks it current first. */
  onSelect?(id: string): void;
  /** Draws a state without the pointer or the keyboard, for the UI Catalog. */
  forceState?: { id: string; state: "hover" | "focus" };
}

export interface SectionList {
  element: HTMLElement;
  setValue(id: string, value: string): void;
  setCurrent(id: string): void;
}

export function createSectionList(
  doc: Document,
  options: SectionListOptions,
): SectionList {
  const list = doc.createElement("nav");
  list.className = "section-list";
  list.setAttribute("aria-label", options.label);

  const rows = new Map<string, HTMLButtonElement>();
  const values = new Map<string, HTMLElement>();

  function setValue(id: string, value: string): void {
    const node = values.get(id);
    if (!node) return;
    node.textContent = value;
    node.title = value;
  }

  function setCurrent(id: string): void {
    for (const [key, row] of rows) {
      if (key === id) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    }
  }

  for (const section of options.sections) {
    const row = doc.createElement("button");
    row.type = "button";
    row.className = "section-list-row";
    if (options.forceState?.id === section.id)
      row.classList.add(`is-${options.forceState.state}`);
    const name = doc.createElement("span");
    name.className = "section-list-name";
    name.textContent = section.label;
    const value = doc.createElement("span");
    value.className = "section-list-value";
    // The plain space keeps the name and the value apart for a screen reader and for copy.
    row.append(name, " ", value);
    row.addEventListener("click", () => {
      setCurrent(section.id);
      options.onSelect?.(section.id);
    });
    rows.set(section.id, row);
    values.set(section.id, value);
    list.append(row);
    setValue(section.id, section.value);
  }
  if (options.current !== undefined) setCurrent(options.current);

  return { element: list, setValue, setCurrent };
}
