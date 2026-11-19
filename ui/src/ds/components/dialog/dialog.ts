// Dialog: a modal window. Focus is trapped inside, Escape closes it, and focus goes back to the
// control that opened it. The backdrop uses the --scrim token. Clicking the backdrop does not close
// it, so a confirm cannot be dismissed by accident.
import { el, focusables, uid } from "../surface-dom";
import "./dialog.css";

export type DialogButtonKind = "default" | "primary" | "danger";

export type DialogActions = readonly Node[] | ((close: () => void) => Node[]);

export interface DialogOptions {
  title: string;
  /** A line above the title, for example where a write goes. */
  lead?: Node;
  /** Body nodes under the title. */
  children?: readonly Node[];
  /** Buttons at the bottom, right-aligned. A function gets `close`. */
  actions?: DialogActions;
  /** Makes the dialog body a form. `onSubmit` runs on submit, then the dialog closes. */
  form?: { onSubmit(): void };
  /** Runs after the dialog closes, however it closed. */
  onClose?(): void;
  doc?: Document;
}

export interface DialogHandle {
  element: HTMLDialogElement;
  /** Opens the dialog. `opener` gets focus again on close (default: the focused element). */
  open(opener?: HTMLElement | null): void;
  close(): void;
  isOpen(): boolean;
}

/** A button for the action row. Uses the button classes of the design system. */
export function createDialogButton(
  label: string,
  kind: DialogButtonKind,
  onClick?: () => void,
  doc: Document = document,
): HTMLButtonElement {
  const button = el(doc, "button", "btn", label);
  button.type = "button";
  if (kind === "primary") button.classList.add("btn-primary");
  if (kind === "danger") button.classList.add("btn-danger");
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

/** The title, body and action row shared by the modal dialog and the static samples. */
export function dialogContent(
  doc: Document,
  titleId: string,
  title: string,
  children: readonly Node[],
  actions: readonly Node[],
): Node[] {
  const heading = el(doc, "h3", undefined, title);
  heading.id = titleId;
  const row = el(doc, "div", "dlg-actions");
  row.append(...actions);
  return [heading, ...children, row];
}

/** The dialog layout drawn in the page, for samples. It is not modal and traps nothing. */
export function createDialogSample(options: {
  title: string;
  label: string;
  children?: readonly Node[];
  actions?: readonly Node[];
  doc?: Document;
}): HTMLElement {
  const doc = options.doc ?? document;
  const box = el(doc, "div", "dlg-static");
  const titleId = uid("dlg-sample");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", options.label);
  box.append(
    ...dialogContent(
      doc,
      titleId,
      options.title,
      options.children ?? [],
      options.actions ?? [],
    ),
  );
  return box;
}

export function createDialog(options: DialogOptions): DialogHandle {
  const doc = options.doc ?? document;
  const dialog = el(doc, "dialog");
  const titleId = uid("dlg-title");
  dialog.setAttribute("aria-labelledby", titleId);
  let opener: HTMLElement | null = null;
  let appended = false;

  const closeDialog = () => {
    if (!dialog.open && !dialog.hasAttribute("open")) return;
    if (typeof dialog.close === "function") dialog.close();
    else {
      dialog.removeAttribute("open");
      dialog.dispatchEvent(new Event("close"));
    }
  };

  const actions =
    typeof options.actions === "function"
      ? options.actions(closeDialog)
      : (options.actions ?? []);
  const body = options.form ? el(doc, "form", "dlg") : el(doc, "div", "dlg");
  body.append(
    ...dialogContent(
      doc,
      titleId,
      options.title,
      options.children ?? [],
      actions,
    ),
  );
  if (options.lead) body.prepend(options.lead);
  if (options.form) {
    const { onSubmit } = options.form;
    body.addEventListener("submit", (event) => {
      event.preventDefault();
      onSubmit();
      closeDialog();
    });
  }
  dialog.append(body);

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(dialog);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = doc.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (active === last || !dialog.contains(active))
    ) {
      event.preventDefault();
      first.focus();
    }
  });
  // The browser's own Escape fires "cancel" first; let it close, then run our close path.
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });
  dialog.addEventListener("close", () => {
    if (appended) dialog.remove();
    appended = false;
    opener?.focus();
    opener = null;
    options.onClose?.();
  });

  return {
    element: dialog,
    open(from) {
      if (dialog.open || dialog.hasAttribute("open")) return;
      opener =
        from ??
        (doc.activeElement instanceof HTMLElement ? doc.activeElement : null);
      if (!dialog.isConnected) {
        doc.body.append(dialog);
        appended = true;
      }
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      const target =
        dialog.querySelector<HTMLElement>("[autofocus]") ??
        focusables(dialog)[0];
      target?.focus();
    },
    close: closeDialog,
    isOpen: () => dialog.open || dialog.hasAttribute("open"),
  };
}
