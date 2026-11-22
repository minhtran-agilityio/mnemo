// Settings row: a bold label, a muted sub-line and the controls the caller gives, on the right.
// Long text wraps; when the row is narrow the controls drop under the text. The row is not a
// button and not focusable: Tab goes to its controls only.
// Why not a list row: that one is a focusable li, cuts text with an ellipsis and holds text meta.
// All text goes in as text. Each control must carry its own accessible name (the caller's job).
import "./settings-row.css";

export interface SettingsRowOptions {
  readonly label: string;
  /** The muted line under the label. */
  readonly sub?: string;
  /** The controls at the right (selects, toggles, buttons), in tab order. */
  readonly controls: readonly HTMLElement[];
  /** A one-line error under the row. */
  readonly error?: string;
  /** Disables every form control and button in the row (a save is pending). */
  readonly disabled?: boolean;
}

export interface SettingsRowsOptions {
  /** Names the group of rows for a screen reader. */
  readonly label: string;
  readonly rows: readonly HTMLElement[];
}

let counter = 0;

const DISABLE = "button, input, select, textarea";

/** Turns the controls of a row off (a save is pending) or on again. */
export function setSettingsRowDisabled(
  row: HTMLElement,
  disabled: boolean,
): void {
  for (const control of row.querySelectorAll<HTMLElement>(DISABLE)) {
    (control as HTMLButtonElement).disabled = disabled;
  }
  row.classList.toggle("is-disabled", disabled);
}

export function createSettingsRow(
  doc: Document,
  options: SettingsRowOptions,
): HTMLElement {
  counter += 1;
  const id = `setting-row-${counter}`;
  const row = doc.createElement("div");
  row.className = "setting-row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-labelledby", `${id}-label`);
  const text = doc.createElement("div");
  text.className = "setting-row-text";
  const label = doc.createElement("span");
  label.className = "setting-row-label";
  label.id = `${id}-label`;
  label.textContent = options.label;
  text.append(label);
  const described: string[] = [];
  if (options.sub) {
    const sub = doc.createElement("span");
    sub.className = "setting-row-sub";
    sub.id = `${id}-sub`;
    sub.textContent = options.sub;
    text.append(sub);
    described.push(sub.id);
  }
  const controls = doc.createElement("div");
  controls.className = "setting-row-controls";
  controls.append(...options.controls);
  row.append(text, controls);
  if (options.error) {
    const error = doc.createElement("span");
    error.className = "setting-row-error";
    error.id = `${id}-error`;
    error.setAttribute("role", "alert");
    error.textContent = options.error;
    row.append(error);
    row.classList.add("has-error");
    described.push(error.id);
  }
  if (described.length > 0)
    row.setAttribute("aria-describedby", described.join(" "));
  if (options.disabled) setSettingsRowDisabled(row, true);
  return row;
}

/** A card that stacks settings rows with a line between them. */
export function createSettingsRows(
  doc: Document,
  options: SettingsRowsOptions,
): HTMLElement {
  const card = doc.createElement("div");
  card.className = "setting-rows";
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", options.label);
  card.append(...options.rows);
  return card;
}
