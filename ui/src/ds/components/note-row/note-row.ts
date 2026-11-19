// A note in a list: a note icon, the title, a meta line, and a "Written by AI" label when the
// text was not written by the owner.
import { FileText, Sparkles } from "lucide";
import { createListRow } from "../list-row/list-row";
import { createRecordIcon } from "../record-icon/record-icon";
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
    const flag = doc.createElement("span");
    flag.className = "rec-flag rec-flag-ai";
    flag.append(
      createRecordIcon(Sparkles),
      doc.createTextNode("Written by AI"),
    );
    row.append(flag);
  }
  return row;
}
