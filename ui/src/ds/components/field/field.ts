// Field: a visible label above a control, a hint below, and an error that replaces the hint.
// Never a placeholder as the label. The control keeps its own id; the label points at it.
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
}

interface FieldState {
  readonly target: HTMLElement;
  readonly hint?: string;
  readonly hintId: string;
  readonly errorId: string;
  /** The live region that holds the hint or the error. */
  readonly note: HTMLElement;
  /** What the caller had set on the control; put back when the field stops writing it. */
  readonly ownDescribedBy: string | null;
  readonly ownInvalid: string | null;
}

const fields = new WeakMap<HTMLElement, FieldState>();

function buildError(doc: Document, id: string, message: string): HTMLElement {
  const err = doc.createElement("span");
  err.className = "err-text";
  err.id = id;
  err.append(createIcon(CircleAlert), doc.createTextNode(message));
  return err;
}

function buildHint(doc: Document, id: string, text: string): HTMLElement {
  const hint = doc.createElement("span");
  hint.className = "hint";
  hint.id = id;
  hint.textContent = text;
  return hint;
}

export function createField(doc: Document, options: FieldOptions): HTMLElement {
  const target = options.target ?? options.control;
  if (!target.id) target.id = nextControlId("control");
  const wrap = doc.createElement("div");
  wrap.className = "field";
  const label = doc.createElement("label");
  label.htmlFor = target.id;
  label.textContent = options.label;
  // One stable polite live region: a message put into it while the owner types is announced.
  const note = doc.createElement("div");
  note.className = "field-note";
  note.setAttribute("aria-live", "polite");
  wrap.append(label, options.control, note);
  fields.set(wrap, {
    target,
    hint: options.hint,
    hintId: `${target.id}-hint`,
    errorId: `${target.id}-error`,
    note,
    ownDescribedBy: target.getAttribute("aria-describedby"),
    ownInvalid: target.getAttribute("aria-invalid"),
  });
  if (options.error) setFieldError(wrap, options.error);
  else if (options.hint) setFieldError(wrap, null);
  return wrap;
}

/**
 * Show, change or clear a field's error after it is built. The control is not touched, so focus
 * and the caret stay. A message replaces the hint and marks the target invalid; null or an empty
 * message brings the hint back (or nothing, when the field had none) and clears aria-invalid.
 * The error text changes in place inside a polite live region, so it is announced. Only the
 * attributes this field wrote are changed; what the caller set on the control is put back.
 * `field` must come from createField.
 */
export function setFieldError(
  field: HTMLElement,
  message: string | null,
): void {
  const state = fields.get(field);
  if (!state) throw new Error("setFieldError: not a field made by createField");
  const { target, hint, hintId, errorId, note } = state;
  const doc = field.ownerDocument;
  const err = note.querySelector(".err-text");
  const shownHint = note.querySelector(".hint");
  if (message) {
    shownHint?.remove();
    if (err) {
      const text = err.lastChild;
      if (text) text.textContent = message;
    } else {
      note.append(buildError(doc, errorId, message));
    }
    target.setAttribute("aria-invalid", "true");
    target.setAttribute("aria-describedby", errorId);
    return;
  }
  err?.remove();
  if (state.ownInvalid === null) target.removeAttribute("aria-invalid");
  else target.setAttribute("aria-invalid", state.ownInvalid);
  if (hint) {
    if (!shownHint) note.append(buildHint(doc, hintId, hint));
    target.setAttribute("aria-describedby", hintId);
  } else if (state.ownDescribedBy === null) {
    target.removeAttribute("aria-describedby");
  } else {
    target.setAttribute("aria-describedby", state.ownDescribedBy);
  }
}
