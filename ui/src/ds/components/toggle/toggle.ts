// Toggle: a button with role=switch. It flips on click and says On or Off in words.
import "./toggle.css";

export interface ToggleOptions {
  readonly label: string;
  readonly on?: boolean;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly onChange?: (on: boolean) => void;
}

export function createToggle(
  doc: Document,
  options: ToggleOptions,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = options.compact ? "toggle compact" : "toggle";
  button.setAttribute("role", "switch");
  const track = doc.createElement("span");
  track.className = "track";
  const knob = doc.createElement("span");
  knob.className = "knob";
  track.append(knob);
  const text = doc.createElement("span");
  text.textContent = options.label;
  const state = doc.createElement("span");
  state.className = "state";
  button.append(track, text, state);
  const set = (on: boolean) => {
    button.setAttribute("aria-checked", String(on));
    state.textContent = on ? "On" : "Off";
  };
  set(options.on === true);
  if (options.disabled) button.disabled = true;
  button.addEventListener("click", () => {
    const on = button.getAttribute("aria-checked") !== "true";
    set(on);
    options.onChange?.(on);
  });
  return button;
}
