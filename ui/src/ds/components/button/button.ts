// Button. A real <button> with a visible name. Text goes in as text.
import type { IconNode } from "lucide";
import "./button.css";
import { controlIcon } from "./icon";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";
/** A fixed look for a state the pointer or keyboard cannot hold still (the catalog shows these). */
export type ButtonForcedState = "hover" | "focus" | "pressed";

export interface ButtonOptions {
  /** The visible text. For an icon-only button it is the accessible name. */
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: "md" | "sm";
  readonly icon?: IconNode;
  /** Shows the icon only. The label becomes aria-label, so the button still has a name. */
  readonly iconOnly?: boolean;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly forced?: ButtonForcedState;
  readonly onClick?: (event: MouseEvent) => void;
}

const SPIN_CLASS = "btn-spin";

function fill(button: HTMLButtonElement, options: ButtonOptions): void {
  button.textContent = "";
  if (options.busy) {
    const spin = button.ownerDocument.createElement("span");
    spin.className = SPIN_CLASS;
    spin.setAttribute("aria-hidden", "true");
    button.append(spin);
  } else if (options.icon) {
    button.append(controlIcon(options.icon));
  }
  if (options.iconOnly) {
    button.setAttribute("aria-label", options.label);
  } else {
    button.append(button.ownerDocument.createTextNode(options.label));
  }
}

export function createButton(
  doc: Document,
  options: ButtonOptions,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  const classes = ["btn"];
  if (options.variant && options.variant !== "default")
    classes.push(`btn-${options.variant}`);
  if (options.size === "sm") classes.push("btn-sm");
  if (options.iconOnly) classes.push("btn-icon");
  if (options.forced) classes.push(`is-${options.forced}`);
  button.className = classes.join(" ");
  fill(button, options);
  if (options.disabled) button.disabled = true;
  if (options.busy) {
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-disabled", "true");
  }
  const onClick = options.onClick;
  if (onClick) {
    button.addEventListener("click", (event) => {
      // A busy button ignores a second click until the work ends.
      if (button.getAttribute("aria-busy") === "true") return;
      onClick(event);
    });
  }
  return button;
}

/** Turns the busy look on or off and swaps the content. A busy button ignores clicks. */
export function setButtonBusy(
  button: HTMLButtonElement,
  busy: boolean,
  options: ButtonOptions,
): void {
  fill(button, { ...options, busy });
  if (busy) {
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-disabled", "true");
  } else {
    button.removeAttribute("aria-busy");
    button.removeAttribute("aria-disabled");
  }
}
