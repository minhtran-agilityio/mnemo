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
  /** A one-line error under the row. Change it later with setSettingsRowError. */
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
// Controls that can be marked invalid: native fields and custom ones with a role.
const INVALIDATE = "input, select, textarea, [role]";

interface RowState {
  readonly note: HTMLElement;
  readonly controls: HTMLElement;
  readonly sub: HTMLElement | null;
  readonly errorId: string;
  err: HTMLElement | null;
  errText: Text | null;
  /** Controls the caller had disabled before the row was disabled; they stay disabled. */
  keptDisabled: Set<Element> | null;
  /** aria-invalid as the caller had it, per control, while an error is shown. */
  invalidBefore: Map<Element, string | null> | null;
}

const rows = new WeakMap<HTMLElement, RowState>();

/**
 * Turns the controls of a row off (a save is pending) or on again. Native controls get the
 * `disabled` attribute; the whole control box also gets `inert`, so a control that is not a native
 * form element (a custom switch, a link) cannot be reached by Tab or the pointer either.
 */
export function setSettingsRowDisabled(
  row: HTMLElement,
  disabled: boolean,
): void {
  const state = rows.get(row);
  const found = row.querySelectorAll<HTMLElement>(DISABLE);
  if (disabled) {
    if (state && !state.keptDisabled) {
      state.keptDisabled = new Set(
        [...found].filter((c) => (c as HTMLButtonElement).disabled),
      );
    }
    for (const c of found) (c as HTMLButtonElement).disabled = true;
  } else {
    const kept = state?.keptDisabled;
    for (const c of found) (c as HTMLButtonElement).disabled = !!kept?.has(c);
    if (state) state.keptDisabled = null;
  }
  const box = state?.controls;
  if (!box) return;
  if (disabled) box.setAttribute("inert", "");
  else box.removeAttribute("inert");
}

/**
 * Show, change or clear the one-line error under a row that is already on screen. The row is not
 * rebuilt, so focus stays on the control. The error sits in a polite live region that stays in the
 * row; its text changes in place, and the same message set again writes nothing, so it is not
 * announced twice. `null` or an empty message clears it. `row` must come from createSettingsRow.
 */
export function setSettingsRowError(
  row: HTMLElement,
  message: string | null,
): void {
  const state = rows.get(row);
  if (!state) {
    throw new Error("setSettingsRowError: not a row made by createSettingsRow");
  }
  const text = message?.trim() ?? "";
  const ids = [state.sub?.id];
  if (text) {
    if (state.err && state.errText) {
      if (state.errText.data !== text) state.errText.data = text;
      if (state.err.parentNode !== state.note) state.note.append(state.err);
    } else {
      const err = row.ownerDocument.createElement("span");
      err.className = "setting-row-error";
      err.id = state.errorId;
      const node = row.ownerDocument.createTextNode(text);
      err.append(node);
      state.err = err;
      state.errText = node;
      state.note.append(err);
    }
    ids.push(state.errorId);
  } else {
    state.err?.remove();
  }
  state.note.classList.toggle("setting-row-note-empty", !text);
  markInvalid(state, !!text);
  const described = ids.filter(Boolean).join(" ");
  if (described) row.setAttribute("aria-describedby", described);
  else row.removeAttribute("aria-describedby");
}

function markInvalid(state: RowState, invalid: boolean): void {
  if (invalid) {
    const before = state.invalidBefore ?? new Map<Element, string | null>();
    state.invalidBefore = before;
    for (const c of state.controls.querySelectorAll(INVALIDATE)) {
      if (!before.has(c)) before.set(c, c.getAttribute("aria-invalid"));
      c.setAttribute("aria-invalid", "true");
    }
  } else if (state.invalidBefore) {
    for (const [c, was] of state.invalidBefore) {
      if (was === null) c.removeAttribute("aria-invalid");
      else c.setAttribute("aria-invalid", was);
    }
    state.invalidBefore = null;
  }
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
  let sub: HTMLElement | null = null;
  if (options.sub) {
    sub = doc.createElement("span");
    sub.className = "setting-row-sub";
    sub.id = `${id}-sub`;
    sub.textContent = options.sub;
    text.append(sub);
  }
  const controls = doc.createElement("div");
  controls.className = "setting-row-controls";
  controls.append(...options.controls);
  // The live region is in the row from the start, so a screen reader hears the error when it is put in.
  const note = doc.createElement("div");
  note.className = "setting-row-note";
  note.setAttribute("aria-live", "polite");
  row.append(text, controls, note);
  rows.set(row, {
    note,
    controls,
    sub,
    errorId: `${id}-error`,
    err: null,
    errText: null,
    keptDisabled: null,
    invalidBefore: null,
  });
  setSettingsRowError(row, options.error ?? null);
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
