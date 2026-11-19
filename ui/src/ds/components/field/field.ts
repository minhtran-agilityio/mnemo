// Field: a visible label above a control, a hint below, and an error that replaces the hint.
// Never a placeholder as the label. The control keeps its own id; the label points at it.
import { CircleAlert } from "lucide";
import { controlIcon } from "../button/icon";
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

export function createField(doc: Document, options: FieldOptions): HTMLElement {
  const target = options.target ?? options.control;
  if (!target.id) target.id = nextControlId("control");
  const wrap = doc.createElement("div");
  wrap.className = "field";
  const label = doc.createElement("label");
  label.htmlFor = target.id;
  label.textContent = options.label;
  wrap.append(label, options.control);
  if (options.error) {
    const err = doc.createElement("span");
    err.className = "err-text";
    err.id = `${target.id}-error`;
    err.append(controlIcon(CircleAlert), doc.createTextNode(options.error));
    target.setAttribute("aria-invalid", "true");
    target.setAttribute("aria-describedby", err.id);
    wrap.append(err);
  } else if (options.hint) {
    const hint = doc.createElement("span");
    hint.className = "hint";
    hint.id = `${target.id}-hint`;
    hint.textContent = options.hint;
    target.setAttribute("aria-describedby", hint.id);
    wrap.append(hint);
  }
  return wrap;
}
