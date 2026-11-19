// Select: pick one (a native select, so the browser handles keys and screen readers) and pick many
// (a button that opens a popover of checkboxes and says how many are chosen).
import { ChevronDown } from "lucide";
import { createIcon } from "../../icon";
import { createButton } from "../button/button";
import { createCheckbox } from "../check/check";
import { nextControlId } from "../field/id";
import { createPopover, type Popover } from "../popover/popover";
import "./select.css";

export interface SelectOptions {
  readonly options: readonly string[];
  readonly value?: string;
  readonly disabled?: boolean;
}

/** Returns the wrapper (put it in a Field as `control`) and the select (the Field's `target`). */
export function createSelect(
  doc: Document,
  options: SelectOptions,
): { wrap: HTMLElement; select: HTMLSelectElement } {
  const wrap = doc.createElement("span");
  wrap.className = "selwrap";
  const select = doc.createElement("select");
  select.className = "select";
  select.id = nextControlId("select");
  for (const text of options.options) {
    const option = doc.createElement("option");
    option.textContent = text;
    option.value = text;
    select.append(option);
  }
  if (options.value !== undefined) select.value = options.value;
  if (options.disabled) select.disabled = true;
  wrap.append(select, createIcon(ChevronDown));
  return { wrap, select };
}

export interface MultiSelectOptions {
  /** Names the group, for screen readers: "Labels". */
  readonly label: string;
  readonly options: readonly { label: string; checked?: boolean }[];
  /** The button text for n chosen. Defaults to "n chosen". */
  readonly summarise?: (count: number) => string;
  readonly onChange?: (chosen: readonly string[]) => void;
}

export interface MultiSelect extends Popover {
  chosen(): string[];
}

export function createMultiSelect(
  doc: Document,
  options: MultiSelectOptions,
): MultiSelect {
  const summarise = options.summarise ?? ((n: number) => `${n} chosen`);
  const trigger = createButton(doc, { label: "" });
  const value = doc.createElement("span");
  trigger.append(value, createIcon(ChevronDown));
  const panel = doc.createElement("div");
  panel.className = "popover";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", options.label);
  const boxes = options.options.map((o) => {
    const box = createCheckbox(doc, { label: o.label, checked: o.checked });
    panel.append(box.label);
    return box;
  });
  const chosen = () =>
    boxes.filter((b) => b.input.checked).map((b) => b.text.textContent ?? "");
  const refresh = () => {
    value.textContent = summarise(chosen().length);
  };
  for (const box of boxes) {
    box.input.addEventListener("change", () => {
      refresh();
      options.onChange?.(chosen());
    });
  }
  refresh();
  const pop = createPopover(doc, { trigger, panel, haspopup: "true" });
  return { ...pop, chosen };
}
