// A note in a list: a note icon, the title, a meta line, and a "Written by AI" label when the
// text was not written by the owner.
import { FileText } from "lucide";
import { createListRow } from "../list-row/list-row";
import { buildTrustLabel } from "../trust-label/trust-label";
import "./note-row.css";

export interface NoteRowOptions {
  readonly title: string;
  readonly meta: string;
  readonly byAi?: boolean;
  readonly forceState?: "hover" | "focus";
}

export function createNoteRow(
  doc: Document,
  options: NoteRowOptions,
): HTMLLIElement {
  const row = createListRow(doc, {
    title: options.title,
    sub: options.meta,
    icon: FileText,
    forceState: options.forceState,
  });
  if (options.byAi) {
    row.append(buildTrustLabel("ai"));
  }
  return row;
}
