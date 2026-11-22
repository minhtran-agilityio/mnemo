// Confirm dialog: asks before something is lost. It names what will be lost, and the safe choice
// ("Keep") has the focus when it opens. Nothing happens until the owner presses the danger button.
// Optional `typeToConfirm`: the danger button stays disabled until the owner types a word exactly.
import {
  createDialog,
  createDialogButton,
  type DialogHandle,
  dialogContent,
} from "../dialog/dialog";
import { createField } from "../field/field";
import { createTextInput } from "../input/input";
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
  /**
   * Optional. The danger button stays disabled until the owner types `word` exactly (case and
   * spaces count). `label` names the field. Without it the confirm works as before.
   */
  typeToConfirm?: { word: string; label: string };
  onConfirm(): void;
  onKeep?(): void;
  doc?: Document;
}

function loseList(doc: Document, lose: readonly string[]): HTMLUListElement {
  const list = el(doc, "ul", "lose");
  for (const item of lose) list.append(el(doc, "li", undefined, item));
  return list;
}

interface TypedGate {
  field: HTMLElement;
  /** Keeps `confirm` disabled until the field equals the word. */
  bind(confirm: HTMLButtonElement): void;
  reset(): void;
}

/** The typed-word field and the rule that gates the danger button. */
function typedGate(
  doc: Document,
  gate: { word: string; label: string },
  confirmLabel: string,
): TypedGate {
  const input = createTextInput(doc);
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");
  const field = createField(doc, {
    label: gate.label,
    control: input,
    hint: `The "${confirmLabel}" button stays off until you type ${gate.word} exactly, with the same capitals and no extra spaces.`,
  });
  field.classList.add("confirm-typed");
  return {
    field,
    bind(confirm) {
      const sync = () => {
        confirm.disabled = input.value !== gate.word;
      };
      sync();
      input.addEventListener("input", sync);
    },
    reset() {
      input.value = "";
      input.dispatchEvent(new Event("input"));
    },
  };
}

/** The modal confirm. Call `open(opener)`. */
export function createConfirmDialog(options: ConfirmOptions): DialogHandle {
  const doc = options.doc ?? document;
  const typed = options.typeToConfirm
    ? typedGate(doc, options.typeToConfirm, options.confirmLabel)
    : null;
  return createDialog({
    title: options.title,
    doc,
    children: [
      el(doc, "p", undefined, options.message),
      loseList(doc, options.lose),
      ...(typed ? [typed.field] : []),
    ],
    onClose: () => typed?.reset(),
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
      typed?.bind(confirm);
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
  const typed = options.typeToConfirm
    ? typedGate(doc, options.typeToConfirm, options.confirmLabel)
    : null;
  const confirm = createDialogButton(
    options.confirmLabel,
    "danger",
    options.onConfirm,
    doc,
  );
  typed?.bind(confirm);
  box.append(
    ...dialogContent(
      doc,
      titleId,
      options.title,
      [
        el(doc, "p", undefined, options.message),
        loseList(doc, options.lose),
        ...(typed ? [typed.field] : []),
      ],
      [
        createDialogButton(options.keepLabel, "default", options.onKeep, doc),
        confirm,
      ],
    ),
  );
  return box;
}
