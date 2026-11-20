// The Notes screen: the note list (newest change first) and the open note, with Read and Edit
// modes. Edit has Save and Cancel, an "Unsaved changes" mark, and asks before unsaved changes are
// lost. Every part comes from ui/src/ds; notes.css lays them out. Note text always goes in as text.
//
// Parts that wait for their own design-system requests are left out, with no stand-in: the label
// tree (create, rename, move, delete labels; open a label), the label picker (choose labels on
// save), and the Markdown read view with its sanitiser. Until then the Read mode shows nothing, a
// save keeps the labels the note already has, and a note cannot be added from this screen.
import { FileText } from "lucide";
import {
  type ButtonOptions,
  buildBanner,
  buildBusyLine,
  buildEmptyState,
  buildErrorState,
  buildPill,
  buildSkeleton,
  buildText,
  createButton,
  createConfirmDialog,
  createField,
  createListbox,
  createSegmented,
  createTextarea,
  type DialogHandle,
  setButtonBusy,
} from "../../ds";
import {
  type ChangeCursor,
  errorMessage,
  type Label,
  type LabelledNote,
  type LabelledNotePage,
} from "../../shared/api";
import "./notes.css";

/** Notes read per page. */
export const NOTES_PAGE = 50;

export interface NotesDeps {
  listLabelledNotes(
    labelId: string | null,
    page: { limit: number; after?: ChangeCursor | null },
  ): Promise<LabelledNotePage>;
  listLabels(): Promise<Label[]>;
  saveLabelledNote(
    id: string | null,
    body: string,
    labelIds: string[],
  ): Promise<LabelledNote>;
  /** Shows a short message in the app's toast region. */
  toast(message: string): void;
}

export interface NotesHandle {
  /** Ends the screen: closes an open question and drops late results. */
  leave(): void;
  /** True when nothing is unsaved, or when the owner chose to discard the changes. */
  canLeave(): Promise<boolean>;
}

type Mode = "Read" | "Edit";

const SAVE: ButtonOptions = { label: "Save", variant: "primary" };

/** The row title: the first line with text, without leading Markdown heading marks. */
export function noteTitle(body: string): string {
  for (const line of body.split("\n")) {
    const text = line.replace(/^\s*#+\s*/, "").trim();
    if (text) return text;
  }
  return "Untitled note";
}

/** The date part of an ISO time, for the row's last-changed text. */
export function changedText(updatedAt: string): string {
  return updatedAt.slice(0, 10);
}

export function renderNotes(
  container: HTMLElement,
  deps: NotesDeps,
): NotesHandle {
  const doc = container.ownerDocument;
  let notes: LabelledNote[] = [];
  let labelNames = new Map<string, string>();
  let next: ChangeCursor | null = null;
  let loads = 0;
  let left = false;

  let openId: string | null = null;
  let original = "";
  let mode: Mode = "Edit";
  let saving = false;
  let asking: Promise<boolean> | null = null;
  let dialog: DialogHandle | null = null;

  const title = doc.createElement("h1");
  title.textContent = "Notes";
  const header = doc.createElement("header");
  header.className = "notes-head";
  header.append(title);

  const listPane = doc.createElement("div");
  listPane.className = "notes-list";
  const editorPane = doc.createElement("div");
  editorPane.className = "notes-editor";
  const layout = doc.createElement("div");
  layout.className = "notes-layout";
  layout.append(listPane, editorPane);
  container.replaceChildren(header, layout);

  // ---- The editor of the open note. Built once per opened note, then updated in place. ----
  const area = createTextarea(doc);
  const field = createField(doc, { label: "Note text", control: area });
  field.classList.add("notes-field");
  const dirtySlot = doc.createElement("div");
  dirtySlot.className = "notes-dirty";
  const bannerSlot = doc.createElement("div");
  bannerSlot.className = "notes-banner";
  const saveButton = createButton(doc, { ...SAVE, onClick: () => save() });
  const cancelButton = createButton(doc, {
    label: "Cancel",
    onClick: () => cancel(),
  });
  const actions = doc.createElement("div");
  actions.className = "notes-actions";
  actions.append(saveButton, cancelButton);
  // The Read mode stays empty until the Markdown read view and its sanitiser exist.
  const readPane = doc.createElement("div");
  readPane.className = "notes-read";

  const isDirty = () => openId !== null && area.value !== original;

  function showDirty(): void {
    dirtySlot.replaceChildren(
      ...(isDirty()
        ? [buildPill({ text: "Unsaved changes", tint: "warn" })]
        : []),
    );
  }

  area.addEventListener("input", showDirty);

  const bar = doc.createElement("div");
  bar.className = "notes-bar";

  /** Edit shows the text area, Save and Cancel; Read shows the (empty) read pane. */
  function showMode(): void {
    const body = mode === "Edit" ? [field, actions] : [readPane];
    editorPane.replaceChildren(bar, bannerSlot, ...body);
  }

  function buildEditor(): void {
    const segmented = createSegmented(doc, {
      label: "View",
      options: ["Read", "Edit"],
      value: mode,
      onChange: (value) => {
        mode = value === "Read" ? "Read" : "Edit";
        showMode();
      },
    });
    bar.replaceChildren(segmented, dirtySlot);
    showDirty();
    showMode();
  }

  function showEditorHint(): void {
    editorPane.replaceChildren(
      ...(notes.length
        ? [
            buildText(doc, {
              tone: "muted",
              size: "base",
              content: "Choose a note in the list to edit it.",
            }),
          ]
        : []),
    );
  }

  function openNote(id: string): void {
    const found = notes.find((n) => n.note.id === id);
    if (!found) return;
    openId = id;
    original = found.note.body;
    area.value = original;
    mode = "Edit";
    bannerSlot.replaceChildren();
    buildEditor();
    showList();
  }

  function cancel(): void {
    area.value = original;
    bannerSlot.replaceChildren();
    showDirty();
  }

  async function save(): Promise<void> {
    const id = openId;
    const current = notes.find((n) => n.note.id === id);
    if (saving || id === null || !current) return;
    saving = true;
    const body = area.value;
    setButtonBusy(saveButton, true, SAVE);
    bannerSlot.replaceChildren();
    try {
      const saved = await deps.saveLabelledNote(id, body, current.labelIds);
      if (left) return;
      notes = [saved, ...notes.filter((n) => n.note.id !== saved.note.id)];
      if (openId === id) {
        original = saved.note.body;
        showDirty();
      }
      showList();
      deps.toast("Note saved.");
    } catch (error) {
      console.error("could not save the note:", error);
      if (left || openId !== id) return;
      bannerSlot.replaceChildren(
        buildBanner({
          tone: "bad",
          lead: "The note was not saved.",
          message: errorMessage(error),
        }),
      );
    } finally {
      saving = false;
      setButtonBusy(saveButton, false, SAVE);
    }
  }

  /** Asks once whether to discard unsaved changes. Every caller shares the open question. */
  function askDiscard(opener: HTMLElement | null): Promise<boolean> {
    if (asking) return asking;
    asking = new Promise<boolean>((resolve) => {
      const handle = createConfirmDialog({
        doc,
        title: "Discard your changes to this note?",
        message: "The changes are not saved. Discarding them cannot be undone.",
        lose: ["The changes since the last save"],
        keepLabel: "Keep editing",
        confirmLabel: "Discard changes",
        onConfirm: () => resolve(true),
        onKeep: () => resolve(false),
      });
      // Escape closes the dialog without a choice: that keeps the changes. The buttons close the
      // dialog before they report the choice, so the fallback waits one task.
      handle.element.addEventListener("close", () => {
        setTimeout(() => resolve(false), 0);
      });
      dialog = handle;
      handle.open(opener);
    }).finally(() => {
      asking = null;
      dialog = null;
    });
    return asking;
  }

  async function requestOpen(id: string, row: HTMLElement): Promise<void> {
    if (id === openId) return;
    if (isDirty() && !(await askDiscard(row))) {
      // Keep editing: the open note stays the selected row.
      if (!left) showList();
      return;
    }
    if (!left) openNote(id);
  }

  // ---- The note list ----
  function showList(): void {
    if (!notes.length) {
      listPane.replaceChildren(
        buildEmptyState({
          title: "No notes yet.",
          body: "Notes you save show here, the latest change first.",
        }),
      );
      return;
    }
    const hadFocus = listPane.contains(doc.activeElement);
    const listbox = createListbox(
      doc,
      "Notes",
      notes.map((n) => ({
        title: noteTitle(n.note.body),
        sub:
          n.labelIds
            .map((l) => labelNames.get(l))
            .filter((name): name is string => !!name)
            .join(", ") || "No label",
        meta: changedText(n.note.updatedAt),
        icon: FileText,
        selected: n.note.id === openId,
      })),
    );
    const rows = [...listbox.children] as HTMLElement[];
    rows.forEach((row, i) => {
      const id = notes[i]?.note.id;
      if (!id) return;
      row.addEventListener("click", () => void requestOpen(id, row));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ")
          void requestOpen(id, row);
      });
    });
    const parts: Node[] = [listbox];
    if (next) {
      const more: ButtonOptions = { label: "Show more notes" };
      const button = createButton(doc, {
        ...more,
        onClick: () => void loadMore(button, more),
      });
      parts.push(button);
    }
    listPane.replaceChildren(...parts);
    if (hadFocus) {
      const at = notes.findIndex((n) => n.note.id === openId);
      rows[Math.max(0, at)]?.focus();
    }
  }

  async function loadMore(
    button: HTMLButtonElement,
    options: ButtonOptions,
  ): Promise<void> {
    if (!next) return;
    const visit = loads;
    setButtonBusy(button, true, options);
    try {
      const page = await deps.listLabelledNotes(null, {
        limit: NOTES_PAGE,
        after: next,
      });
      if (left || visit !== loads) return;
      const known = new Set(notes.map((n) => n.note.id));
      notes = [...notes, ...page.items.filter((n) => !known.has(n.note.id))];
      next = page.next;
      showList();
    } catch (error) {
      console.error("could not read more notes:", error);
      if (left || visit !== loads) return;
      setButtonBusy(button, false, options);
      listPane.append(
        buildBanner({
          tone: "bad",
          lead: "More notes could not be read.",
          message: errorMessage(error),
        }),
      );
    }
  }

  async function load(): Promise<void> {
    const visit = ++loads;
    listPane.replaceChildren(
      buildSkeleton(),
      buildBusyLine("Reading your notes…"),
    );
    try {
      const [page, labels] = await Promise.all([
        deps.listLabelledNotes(null, { limit: NOTES_PAGE }),
        deps.listLabels(),
      ]);
      if (left || visit !== loads) return;
      notes = page.items;
      next = page.next;
      labelNames = new Map(labels.map((l) => [l.id, l.name]));
      showList();
      if (openId === null) showEditorHint();
    } catch (error) {
      console.error("could not read the notes:", error);
      if (left || visit !== loads) return;
      listPane.replaceChildren(
        buildErrorState({
          title: "The notes could not be shown.",
          body: errorMessage(error),
          action: { label: "Try again", onClick: () => void load() },
        }),
      );
    }
  }

  void load();

  return {
    leave() {
      left = true;
      dialog?.close();
    },
    canLeave() {
      if (!isDirty()) return Promise.resolve(true);
      return askDiscard(
        doc.activeElement instanceof HTMLElement ? doc.activeElement : null,
      );
    },
  };
}
