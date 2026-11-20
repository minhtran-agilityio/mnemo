// Choice list: one choice out of a few, as a fieldset of native radios. Each row is the radio, its
// label and a hint that the radio names with aria-describedby. Under the list, an error line
// (role=status) says what went wrong, and hides when there is no error. Ids come from `name`, so
// two lists on one page need two names. All text goes in as text.
import "./choice-list.css";

export interface Choice<V extends string = string> {
  value: V;
  label: string;
  /** One line under the label. */
  hint: string;
}

export interface ChoiceListOptions<V extends string = string> {
  legend: string;
  /** The radio group name. It is also the start of every id in the list. */
  name: string;
  choices: readonly Choice<V>[];
  /** The checked choice. */
  value?: V;
  disabled?: boolean;
  /** Called when the owner checks a choice. */
  onChange?(value: V): void;
  /** Draws a state of one row without the pointer or the keyboard, for the UI Catalog. */
  forceState?: { value: V; state: "focus" };
}

export interface ChoiceList<V extends string = string> {
  element: HTMLElement;
  /** Shows `text` on the error line, or hides the line when `text` is null. */
  setError(text: string | null): void;
  /** Checks the choice for `value` without calling onChange. */
  setValue(value: V): void;
}

export function createChoiceList<V extends string>(
  doc: Document,
  options: ChoiceListOptions<V>,
): ChoiceList<V> {
  const wrap = doc.createElement("div");
  wrap.className = "choice-list";

  const group = doc.createElement("fieldset");
  group.className = "choice-list-group";
  group.disabled = options.disabled ?? false;
  const legend = doc.createElement("legend");
  legend.className = "choice-list-legend";
  legend.textContent = options.legend;
  group.append(legend);

  const radios = new Map<V, HTMLInputElement>();
  for (const choice of options.choices) {
    const id = `${options.name}-${choice.value}`;
    const input = doc.createElement("input");
    input.type = "radio";
    input.name = options.name;
    input.id = id;
    input.value = choice.value;
    input.checked = options.value === choice.value;
    input.setAttribute("aria-describedby", `${id}-hint`);
    if (
      options.forceState?.value === choice.value &&
      options.forceState.state === "focus"
    )
      input.classList.add("is-focus");
    input.addEventListener("change", () => {
      if (input.checked) options.onChange?.(choice.value);
    });
    const label = doc.createElement("label");
    label.htmlFor = id;
    label.textContent = choice.label;
    const hint = doc.createElement("span");
    hint.className = "choice-list-hint";
    hint.id = `${id}-hint`;
    hint.textContent = choice.hint;
    const row = doc.createElement("div");
    row.className = "choice-list-row";
    row.append(input, label, hint);
    group.append(row);
    radios.set(choice.value, input);
  }

  const error = doc.createElement("p");
  error.className = "choice-list-error";
  error.setAttribute("role", "status");
  error.hidden = true;

  wrap.append(group, error);

  return {
    element: wrap,
    setError(text) {
      error.textContent = text ?? "";
      error.hidden = text === null;
    },
    setValue(value) {
      const radio = radios.get(value);
      if (radio) radio.checked = true;
    },
  };
}
