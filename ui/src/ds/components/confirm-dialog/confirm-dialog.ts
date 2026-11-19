// Confirm dialog: asks before something is lost. It names what will be lost, and the safe choice
// ("Keep") has the focus when it opens. Nothing happens until the owner presses the danger button.
import {
  createDialog,
  createDialogButton,
  type DialogHandle,
  dialogContent,
} from "../dialog/dialog";
import { el, uid } from "../surface-dom";
import "./confirm-dialog.css";

export interface ConfirmOptions {
  /** The question, for example `Delete the folder "Read later"?` */
  title: string;
  /** One sentence that says it cannot be undone, if that is so. */
  message: string;
  /** What will be lost, one line each. At least one: a confirm that names nothing is not allowed. */
  lose: readonly [string, ...string[]];
  /** The safe button, for example "Keep folder". */
  keepLabel: string;
  /** The danger button, with the count, for example "Delete 45 items". */
  confirmLabel: string;
  onConfirm(): void;
  onKeep?(): void;
  doc?: Document;
}

function loseList(doc: Document, lose: readonly string[]): HTMLUListElement {
  const list = el(doc, "ul", "lose");
  for (const item of lose) list.append(el(doc, "li", undefined, item));
  return list;
}

/** The modal confirm. Call `open(opener)`. */
export function createConfirmDialog(options: ConfirmOptions): DialogHandle {
  const doc = options.doc ?? document;
  return createDialog({
    title: options.title,
    doc,
    children: [
      el(doc, "p", undefined, options.message),
      loseList(doc, options.lose),
    ],
    actions: (close) => {
      const keep = createDialogButton(
        options.keepLabel,
        "default",
        () => {
          close();
          options.onKeep?.();
        },
        doc,
      );
      keep.autofocus = true;
      keep.setAttribute("autofocus", "");
      const confirm = createDialogButton(
        options.confirmLabel,
        "danger",
        () => {
          close();
          options.onConfirm();
        },
        doc,
      );
      return [keep, confirm];
    },
  });
}

/** The same confirm drawn in the page, for samples. The buttons do nothing but call the handlers. */
export function createConfirmSample(options: ConfirmOptions): HTMLElement {
  const doc = options.doc ?? document;
  const box = el(doc, "div", "dlg-static");
  box.setAttribute("role", "group");
  const titleId = uid("confirm-title");
  box.setAttribute("aria-labelledby", titleId);
  box.append(
    ...dialogContent(
      doc,
      titleId,
      options.title,
      [el(doc, "p", undefined, options.message), loseList(doc, options.lose)],
      [
        createDialogButton(options.keepLabel, "default", options.onKeep, doc),
        createDialogButton(
          options.confirmLabel,
          "danger",
          options.onConfirm,
          doc,
        ),
      ],
    ),
  );
  return box;
}
