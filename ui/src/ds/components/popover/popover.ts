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
  /**
   * A panel the catalog holds open to show it: no focus moves in, and a click outside or focus
   * leaving does not close it. The trigger and Escape still do.
   */
  readonly held?: boolean;
  /** When it aborts, the popover closes and drops its document listener. */
  readonly signal?: AbortSignal;
}

export interface Popover {
  readonly anchor: HTMLElement;
  open(): void;
  close(returnFocus?: boolean): void;
  isOpen(): boolean;
  /** Closes the panel and removes the document listener. Safe to call twice. */
  destroy(): void;
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

  // Focus moved out of the popover (Tab away): close. A null target (a click on nothing) is left
  // to the document click listener.
  anchor.addEventListener("focusout", (event) => {
    const to = event.relatedTarget;
    if (options.held) return;
    if (isOpen() && to instanceof Node && !anchor.contains(to)) close(false);
  });

  function isOpen(): boolean {
    return !panel.hidden;
  }

  function open(): void {
    if (isOpen()) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (options.held) return;
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

  function destroy(): void {
    close(false);
    doc.removeEventListener("click", outside);
  }
  options.signal?.addEventListener("abort", destroy, { once: true });
  if (options.signal?.aborted) destroy();

  return { anchor, open, close, isOpen, destroy };
}
