// Text input, textarea and search field. Native controls; a Field gives them a label.
import { Search } from "lucide";
import { createIcon } from "../../icon";
import { nextControlId } from "../field/id";
import "./input.css";

export interface TextInputOptions {
  readonly type?: "text" | "url" | "email" | "search";
  readonly value?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** A fixed look for hover or focus (the catalog shows these). */
  readonly forced?: "hover" | "focus";
}

export function createTextInput(
  doc: Document,
  options: TextInputOptions = {},
): HTMLInputElement {
  const input = doc.createElement("input");
  input.className = "input";
  input.id = nextControlId("input");
  input.type = options.type ?? "text";
  if (options.value !== undefined) input.value = options.value;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.disabled) input.disabled = true;
  if (options.forced) input.classList.add(`is-${options.forced}`);
  return input;
}

export interface TextareaOptions {
  readonly value?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

export function createTextarea(
  doc: Document,
  options: TextareaOptions = {},
): HTMLTextAreaElement {
  const area = doc.createElement("textarea");
  area.className = "textarea";
  area.id = nextControlId("textarea");
  if (options.value !== undefined) area.value = options.value;
  if (options.placeholder) area.placeholder = options.placeholder;
  if (options.disabled) area.disabled = true;
  return area;
}

/** A search field: a type=search input with a magnifier. Returns the wrapper and the input. */
export function createSearch(
  doc: Document,
  options: { placeholder?: string } = {},
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = doc.createElement("div");
  wrap.className = "search";
  const input = createTextInput(doc, {
    type: "search",
    placeholder: options.placeholder,
  });
  wrap.append(createIcon(Search), input);
  return { wrap, input };
}
