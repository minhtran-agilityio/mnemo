import "./toast.css";

/** How long a toast stays, in milliseconds. Hover or focus holds it. */
export const TOAST_MS = 6000;

export interface ToastOptions {
  readonly message: string;
  /** The label of the action. Default: "Undo". */
  readonly actionLabel?: string;
  /** Runs when the owner picks the action. Without it the toast has no button. */
  readonly onAction?: () => void;
}

/** One toast, not yet in a region. Use it for a fixed example; use the region to show one. */
export function buildToast(options: ToastOptions): HTMLDivElement {
  const toast = document.createElement("div");
  toast.className = "toast";
  const message = document.createElement("span");
  message.textContent = options.message;
  toast.append(message);
  if (options.onAction) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm btn-ghost toast-action";
    button.textContent = options.actionLabel ?? "Undo";
    button.addEventListener("click", options.onAction);
    toast.append(button);
  }
  return toast;
}

export interface ToastRegion {
  readonly element: HTMLElement;
  /** Shows a toast. Returns a function that dismisses it. */
  show(
    message: string,
    options?: {
      readonly onUndo?: () => void;
      readonly actionLabel?: string;
      readonly duration?: number;
    },
  ): () => void;
}

/**
 * The toast region: a polite live region fixed at the bottom right. Each toast leaves after 6 s,
 * and stays while the pointer is over it or focus is inside it. Picking Undo runs the callback
 * and closes the toast. Append `element` to the page once.
 */
export function createToastRegion(): ToastRegion {
  const element = document.createElement("div");
  element.className = "toast-region";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");

  return {
    element,
    show(message, options = {}) {
      const duration = options.duration ?? TOAST_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let startedAt = 0;
      let left = duration;
      const toast = buildToast({
        message,
        actionLabel: options.actionLabel,
        onAction: options.onUndo
          ? () => {
              options.onUndo?.();
              dismiss();
            }
          : undefined,
      });
      function dismiss() {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        toast.remove();
      }
      const start = () => {
        if (timer !== undefined) clearTimeout(timer);
        startedAt = Date.now();
        timer = setTimeout(dismiss, left);
      };
      const hold = () => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        left = Math.max(duration / 2, left - (Date.now() - startedAt));
      };
      toast.addEventListener("pointerenter", hold);
      toast.addEventListener("focusin", hold);
      toast.addEventListener("pointerleave", () => {
        if (!toast.matches(":focus-within")) start();
      });
      toast.addEventListener("focusout", () => {
        if (!toast.matches(":hover")) start();
      });
      element.append(toast);
      start();
      return dismiss;
    },
  };
}
