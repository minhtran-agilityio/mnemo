// Filter chip: a button with aria-pressed. On shows a check mark too, so colour is not the only signal.
import { Check } from "lucide";
import { createIcon } from "../../icon";
import "./chip.css";

export interface ChipOptions {
  readonly label: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly forced?: "hover";
  readonly onChange?: (pressed: boolean) => void;
}

export function createChip(
  doc: Document,
  options: ChipOptions,
): HTMLButtonElement {
  const chip = doc.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  if (options.forced) chip.classList.add(`is-${options.forced}`);
  const text = doc.createTextNode(options.label);
  const render = (pressed: boolean) => {
    chip.setAttribute("aria-pressed", String(pressed));
    chip.textContent = "";
    if (pressed) chip.append(createIcon(Check));
    chip.append(text);
  };
  render(options.pressed === true);
  if (options.disabled) chip.disabled = true;
  chip.addEventListener("click", () => {
    chip.classList.remove("is-hover");
    const pressed = chip.getAttribute("aria-pressed") !== "true";
    render(pressed);
    options.onChange?.(pressed);
  });
  return chip;
}
