// Checkbox (on, off, mixed) and radio group. Native inputs inside a label, so the whole row is the target.
import "./check.css";

export interface CheckboxOptions {
  readonly label: string;
  readonly checked?: boolean;
  /** Some, not all: the box shows a dash. Set on the element, as HTML has no attribute for it. */
  readonly mixed?: boolean;
  readonly disabled?: boolean;
  readonly onChange?: (checked: boolean) => void;
}

export interface Checkbox {
  readonly label: HTMLLabelElement;
  readonly input: HTMLInputElement;
  readonly text: HTMLSpanElement;
}

export function createCheckbox(
  doc: Document,
  options: CheckboxOptions,
  type: "checkbox" | "radio" = "checkbox",
): Checkbox {
  const label = doc.createElement("label");
  label.className = "check";
  const input = doc.createElement("input");
  input.type = type;
  if (options.checked) input.checked = true;
  if (options.mixed) input.indeterminate = true;
  if (options.disabled) input.disabled = true;
  const text = doc.createElement("span");
  text.textContent = options.label;
  label.append(input, text);
  if (options.onChange) {
    const onChange = options.onChange;
    input.addEventListener("change", () => onChange(input.checked));
  }
  return { label, input, text };
}

export interface RadioGroupOptions {
  readonly legend: string;
  readonly name: string;
  readonly options: readonly {
    label: string;
    value: string;
    checked?: boolean;
    disabled?: boolean;
  }[];
  readonly onChange?: (value: string) => void;
}

export function createRadioGroup(
  doc: Document,
  options: RadioGroupOptions,
): HTMLFieldSetElement {
  const set = doc.createElement("fieldset");
  set.className = "check-group";
  const legend = doc.createElement("legend");
  legend.textContent = options.legend;
  set.append(legend);
  for (const o of options.options) {
    const radio = createCheckbox(doc, o, "radio");
    radio.input.name = options.name;
    radio.input.value = o.value;
    radio.input.addEventListener("change", () => options.onChange?.(o.value));
    set.append(radio.label);
  }
  return set;
}
