// Field: a visible label above a control, a hint below, and an error that replaces the hint.
// Never a placeholder as the label. The control keeps its own id; the label points at it.
// With `action`, a button (or other element) sits beside the control on one row, centred on it;
// the hint and the error stay under the control at its left edge, not under the action.
import { CircleAlert } from "lucide";
import { createIcon } from "../../icon";
import "./field.css";
import { nextControlId } from "./id";

export interface FieldOptions {
  readonly label: string;
  /** The control: an input, textarea, select or a wrapper that holds one. */
  readonly control: HTMLElement;
  /** The form control inside `control` that carries the id (defaults to `control`). */
  readonly target?: HTMLElement;
  readonly hint?: string;
  /** Replaces the hint and marks the target invalid. */
  readonly error?: string;
  /**
   * An element beside the control, such as a primary submit button. It sits on the control's row,
   * centred on the control, and is not restyled. The label stays above, and the hint or error
   * under the control only. Without it the field is the plain column.
   */
  readonly action?: HTMLElement;
}

interface FieldState {
  readonly target: HTMLElement;
  /** The hint, built once; it sits outside the live region so it is not announced when it returns. */
  readonly hintEl: HTMLElement | null;
  /** The polite live region. Only the error goes inside it. */
  readonly note: HTMLElement;
  /** Where the hint goes: the field, or the line under the control when there is an action. */
  readonly host: HTMLElement;
  readonly errorId: string;
  /** Built on the first error and kept; its message text node is updated in place. */
  err: HTMLElement | null;
  errText: Text | null;
  /** What the caller had set on the control; put back when the field stops writing it. */
  readonly ownDescribedBy: string | null;
  readonly ownInvalid: string | null;
}

/** Writes an attribute only when the value differs, so a repeat call changes nothing. */
function setAttr(el: HTMLElement, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

const fields = new WeakMap<HTMLElement, FieldState>();

export function createField(doc: Document, options: FieldOptions): HTMLElement {
  const target = options.target ?? options.control;
  if (!target.id) target.id = nextControlId("control");
  const wrap = doc.createElement("div");
  wrap.className = "field";
  const label = doc.createElement("label");
  label.htmlFor = target.id;
  label.textContent = options.label;
  // The live region exists before any message, so a message put into it while the owner types
  // is announced.
  const note = doc.createElement("div");
  note.className = "field-note";
  note.setAttribute("aria-live", "polite");
  let hintEl: HTMLElement | null = null;
  if (options.hint) {
    hintEl = doc.createElement("span");
    hintEl.className = "hint";
    hintEl.id = `${target.id}-hint`;
    hintEl.textContent = options.hint;
  }
  let host = wrap;
  if (options.action) {
    // The label across the top, the control and the action on one row, the hint and error under
    // the control's column only. The wrappers are the grid's cells, so a screen needs no child
    // selectors.
    wrap.classList.add("field--action");
    const controlCell = doc.createElement("div");
    controlCell.className = "field-control";
    controlCell.append(options.control);
    const actionCell = doc.createElement("div");
    actionCell.className = "field-action";
    actionCell.append(options.action);
    host = doc.createElement("div");
    host.className = "field-under";
    host.append(note);
    wrap.append(label, controlCell, actionCell, host);
  } else {
    wrap.append(label, options.control, note);
  }
  fields.set(wrap, {
    target,
    hintEl,
    note,
    host,
    errorId: `${target.id}-error`,
    err: null,
    errText: null,
    ownDescribedBy: target.getAttribute("aria-describedby"),
    ownInvalid: target.getAttribute("aria-invalid"),
  });
  setFieldError(wrap, options.error ?? null);
  return wrap;
}

/**
 * Show, change or clear a field's error after it is built. The control is not touched, so focus
 * and the caret stay. A message replaces the hint and marks the target invalid; null or an empty
 * message brings the hint back (or nothing, when the field had none) and clears aria-invalid.
 * The error sits in a polite live region and its text changes in place; the same message set
 * again writes nothing, so it is not announced twice. Only the attributes this field wrote are
 * changed; what the caller set on the control is put back. `field` must come from createField.
 * The control's own aria-describedby is read once, at createField: do not change it afterwards.
 */
export function setFieldError(
  field: HTMLElement,
  message: string | null,
): void {
  const state = fields.get(field);
  if (!state) throw new Error("setFieldError: not a field made by createField");
  const { target, hintEl, note, host, errorId } = state;
  // A message of only spaces is empty.
  const text = message?.trim() ?? "";
  if (text) {
    hintEl?.remove();
    if (state.err && state.errText) {
      if (state.errText.data !== text) state.errText.data = text;
      if (state.err.parentNode !== note) note.append(state.err);
    } else {
      const err = field.ownerDocument.createElement("span");
      err.className = "err-text";
      err.id = errorId;
      const node = field.ownerDocument.createTextNode(text);
      err.append(createIcon(CircleAlert), node);
      state.err = err;
      state.errText = node;
      note.append(err);
    }
    setAttr(target, "aria-invalid", "true");
    setAttr(target, "aria-describedby", errorId);
    return;
  }
  state.err?.remove();
  if (state.ownInvalid === null) target.removeAttribute("aria-invalid");
  else target.setAttribute("aria-invalid", state.ownInvalid);
  if (hintEl) {
    // The hint goes before the live region, outside it.
    if (hintEl.parentNode !== host) host.insertBefore(hintEl, note);
    target.setAttribute("aria-describedby", hintEl.id);
  } else if (state.ownDescribedBy === null) {
    target.removeAttribute("aria-describedby");
  } else {
    target.setAttribute("aria-describedby", state.ownDescribedBy);
  }
}
