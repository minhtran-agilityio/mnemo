// Popover: a small panel that opens from a button. Escape and a click outside close it, and focus
// goes back to the button.
import { el, focusables, uid } from "../surface-dom";
import "./popover.css";

export interface PopoverOptions {
  /** The button text. */
  trigger: string;
  /** Names the panel for assistive technology. */
  label: string;
  children: readonly Node[];
  doc?: Document;
}

export interface Popover {
  element: HTMLElement;
  trigger: HTMLButtonElement;
  panel: HTMLElement;
  open(): void;
  close(returnFocus?: boolean): void;
  isOpen(): boolean;
}

export function createPopover(options: PopoverOptions): Popover {
  const doc = options.doc ?? document;
  const anchor = el(doc, "div", "pop-anchor");
  const trigger = el(doc, "button", "btn", options.trigger);
  trigger.type = "button";
  const panel = el(doc, "div", "popover");
  panel.id = uid("popover");
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", options.label);
  panel.append(...options.children);
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", panel.id);
  anchor.append(trigger, panel);

  let isOpen = false;
  const onDocClick = (event: Event) => {
    if (!anchor.contains(event.target as Node)) close(false);
  };
  function open() {
    isOpen = true;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    focusables(panel)[0]?.focus();
    doc.addEventListener("click", onDocClick);
  }
  function close(returnFocus = true) {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    doc.removeEventListener("click", onDocClick);
    if (returnFocus) trigger.focus();
  }
  trigger.addEventListener("click", () => (isOpen ? close(false) : open()));
  anchor.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      close(true);
    }
  });
  return { element: anchor, trigger, panel, open, close, isOpen: () => isOpen };
}
