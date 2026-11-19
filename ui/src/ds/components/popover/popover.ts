// Popover: a button that opens a panel. Escape closes it and gives focus back to the button; a
// click outside closes it. The menu and the multi select build on this.
import "./popover.css";

export interface PopoverOptions {
  /** The trigger button, already built (so its content and classes are the caller's). */
  readonly trigger: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly haspopup: "dialog" | "menu" | "true";
  /** Which element takes focus on open. Defaults to the first input or button in the panel. */
  readonly firstFocus?: () => HTMLElement | null;
  readonly onOpen?: () => void;
}

export interface Popover {
  readonly anchor: HTMLElement;
  open(): void;
  close(returnFocus?: boolean): void;
  isOpen(): boolean;
}

let counter = 0;

export function createPopover(doc: Document, options: PopoverOptions): Popover {
  const { trigger, panel } = options;
  const anchor = doc.createElement("div");
  anchor.className = "pop-anchor";
  counter += 1;
  if (!panel.id) panel.id = `ds-pop-${counter}`;
  panel.hidden = true;
  trigger.setAttribute("aria-haspopup", options.haspopup);
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", panel.id);
  anchor.append(trigger, panel);

  const outside = (event: Event): void => {
    if (event.target instanceof Node && !anchor.contains(event.target))
      close(false);
  };

  function isOpen(): boolean {
    return !panel.hidden;
  }

  function open(): void {
    if (isOpen()) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    doc.addEventListener("click", outside);
    options.onOpen?.();
    const first =
      options.firstFocus?.() ??
      panel.querySelector<HTMLElement>("input, button:not([aria-disabled])");
    first?.focus();
  }

  function close(returnFocus = false): void {
    if (!isOpen()) return;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    doc.removeEventListener("click", outside);
    if (returnFocus) trigger.focus();
  }

  trigger.addEventListener("click", () => (isOpen() ? close(false) : open()));
  anchor.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      event.stopPropagation();
      close(true);
    }
  });

  return { anchor, open, close, isOpen };
}
