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
  wrap.append(label, options.control);
  fields.set(wrap, { target, hint: options.hint });
  setFieldError(wrap, options.error ?? null);
  return wrap;
}

/**
 * Show, change or clear a field's error after it is built. The control is not touched, so focus
 * and the caret stay. A message replaces the hint and marks the target invalid; null or an empty
 * message brings the hint back (or nothing, when the field had none) and clears aria-invalid.
 */
export function setFieldError(
  field: HTMLElement,
  message: string | null,
): void {
  const state = fields.get(field);
  if (!state) return;
  const { target, hint } = state;
  const doc = field.ownerDocument;
  const errId = `${target.id}-error`;
  const hintId = `${target.id}-hint`;
  const err = field.querySelector(":scope > .err-text");
  const shownHint = field.querySelector(":scope > .hint");
  if (message) {
    shownHint?.remove();
    const next = buildError(doc, errId, message);
    if (err) err.replaceWith(next);
    else field.append(next);
    target.setAttribute("aria-invalid", "true");
    target.setAttribute("aria-describedby", errId);
    return;
  }
  err?.remove();
  target.removeAttribute("aria-invalid");
  if (hint) {
    if (!shownHint) field.append(buildHint(doc, hintId, hint));
    target.setAttribute("aria-describedby", hintId);
  } else {
    target.removeAttribute("aria-describedby");
  }
}
