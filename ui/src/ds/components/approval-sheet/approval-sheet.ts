// Approval sheet: any write outside Mnemo shows exactly what will happen, then waits. It says where
// the write goes, lists every step, and does nothing until the owner presses the approve button.
import { ArrowRight, TriangleAlert } from "lucide";
import {
  createDialog,
  createDialogButton,
  type DialogHandle,
  dialogContent,
} from "../dialog/dialog";
import { el, icon, uid } from "../surface-dom";
import "./approval-sheet.css";

/** One step: plain text and `{ code }` parts (file names, paths). */
export type PlanStep = readonly (string | { code: string })[];

export interface ApprovalOptions {
  /** Where the write goes, for example "Google Drive". The sheet adds "Writes outside Mnemo:". */
  where: string;
  title: string;
  /** Every step, in order. At least one: a sheet with no plan is not allowed. */
  plan: readonly [PlanStep, ...PlanStep[]];
  /** A line under the plan, for example "Nothing is deleted." */
  note?: string;
  declineLabel: string;
  approveLabel: string;
  onApprove(): void;
  onDecline?(): void;
  doc?: Document;
}

function whereLine(doc: Document, where: string): HTMLElement {
  const line = el(doc, "div", "sheet-where");
  line.append(
    icon(TriangleAlert),
    el(doc, "span", undefined, `Writes outside Mnemo: ${where}`),
  );
  return line;
}

function planList(doc: Document, plan: readonly PlanStep[]): HTMLUListElement {
  const list = el(doc, "ul", "plan");
  for (const step of plan) {
    const item = el(doc, "li");
    const text = el(doc, "span");
    for (const part of step) {
      if (typeof part === "string") text.append(part);
      else text.append(el(doc, "code", undefined, part.code));
    }
    item.append(icon(ArrowRight), text);
    list.append(item);
  }
  return list;
}

function steps(doc: Document, options: ApprovalOptions): Node[] {
  const nodes: Node[] = [planList(doc, options.plan)];
  if (options.note) nodes.push(el(doc, "p", "note", options.note));
  return nodes;
}

/** The modal sheet. Call `open(opener)`. Decline is the first button and has the focus. */
export function createApprovalSheet(options: ApprovalOptions): DialogHandle {
  const doc = options.doc ?? document;
  return createDialog({
    title: options.title,
    doc,
    lead: whereLine(doc, options.where),
    children: steps(doc, options),
    actions: (close) => {
      const decline = createDialogButton(
        options.declineLabel,
        "default",
        () => {
          close();
          options.onDecline?.();
        },
        doc,
      );
      decline.setAttribute("autofocus", "");
      const approve = createDialogButton(
        options.approveLabel,
        "primary",
        () => {
          close();
          options.onApprove();
        },
        doc,
      );
      return [decline, approve];
    },
  });
}

/** The same sheet drawn in the page, for samples. Buttons only call the handlers. */
export function createApprovalSample(options: ApprovalOptions): HTMLElement {
  const doc = options.doc ?? document;
  const box = el(doc, "div", "dlg-static");
  box.setAttribute("role", "group");
  const titleId = uid("approval-title");
  box.setAttribute("aria-labelledby", titleId);
  const content = dialogContent(
    doc,
    titleId,
    options.title,
    steps(doc, options),
    [
      createDialogButton(
        options.declineLabel,
        "default",
        options.onDecline,
        doc,
      ),
      createDialogButton(
        options.approveLabel,
        "primary",
        options.onApprove,
        doc,
      ),
    ],
  );
  box.append(whereLine(doc, options.where), ...content);
  return box;
}
