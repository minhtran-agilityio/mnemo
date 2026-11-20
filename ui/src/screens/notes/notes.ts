// The Notes screen: the label tree on the left, the note list in the middle and the open note on
// the right. Choosing a label lists its notes with the notes of its child labels. The tree makes,
// renames, moves and deletes labels (the screen calls the label commands; a delete asks first and
// names where the notes go). The editor has Read and Edit modes; Edit has the text, the label
// picker, Save and Cancel, an "Unsaved changes" mark, and asks before unsaved changes are lost.
// A note is saved with at least one label. "New note" opens an empty note in Edit mode with the
// current label chosen. Every part comes from ui/src/ds; notes.css lays them out. Note text always
// goes in as text.
// Read mode shows the last saved text through the Markdown view part, which builds its nodes from
// an allow-list and never inserts the text as markup. Links are not opened: Mnemo opens nothing
// outside itself without the owner's approval, so the view gets no click handler yet.
import { FileText, Plus } from "lucide";
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
  createDialog,
  createDialogButton,
  createField,
  createLabelPicker,
  createListbox,
  createMarkdownView,
  createSegmented,
  createTextarea,
  createTree,
  type DialogHandle,
  type LabelPicker,
  type LabelPickerNode,
  PATH_SEPARATOR,
  setButtonBusy,
  type TreeActionEvent,
  type TreeNode,
} from "../../ds";
import {
  type ChangeCursor,
  type DeleteLabelOutcome,
  errorMessage,
  type Label,
  type LabelledNote,
  type LabelledNotePage,
} from "../../shared/api";
import "./notes.css";

/** Notes read per page. */
export const NOTES_PAGE = 50;

/** The most notes one page may hold (the core's limit), used to count a label's notes. */
const COUNT_PAGE = 100;

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
  createLabel(parentId: string | null, name: string): Promise<Label>;
  renameLabel(id: string, name: string): Promise<Label>;
  moveLabel(id: string, parentId: string | null): Promise<Label>;
  deleteLabel(id: string): Promise<DeleteLabelOutcome>;
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
const NO_LABEL = "Choose at least one label before saving";
const NOT_UNDER_ITSELF = "A label cannot go under itself.";

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

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  [...a].sort().join("\n") === [...b].sort().join("\n");

const noteCount = (n: number) => (n === 1 ? "1 note" : `${n} notes`);

export function renderNotes(
  container: HTMLElement,
  deps: NotesDeps,
): NotesHandle {
  const doc = container.ownerDocument;
  const stop = new AbortController();
  let notes: LabelledNote[] = [];
  let next: ChangeCursor | null = null;
  let loads = 0;
  let left = false;

  // The labels, flat, and what is built from them. Names are unique per parent, so a path from the
  // top names one label.
  let labels: Label[] = [];
  let labelNames = new Map<string, string>();
  let pathToId = new Map<string, string>();
  let idToPath = new Map<string, string>();
  /** The tree's own steps (names from the top, as JSON) to ids, for a click on a node. */
  let stepsToId = new Map<string, string>();
  let currentLabelId: string | null = null;

  let openId: string | null = null;
  let isNew = false;
  let original = "";
  let originalIds: string[] = [];
  let mode: Mode = "Edit";
  let saving = false;
  let asking: Promise<boolean> | null = null;
  let dialog: DialogHandle | null = null;
  let moveDialog: DialogHandle | null = null;
  let picker: LabelPicker | null = null;

  // ---- The layout: header, then label tree, note list and note ----
  const title = doc.createElement("h1");
  title.textContent = "Notes";
  const newNote = createButton(doc, {
    label: "New note",
    icon: Plus,
    onClick: () => void requestNew(),
  });
  const header = doc.createElement("header");
  header.className = "notes-head";
  header.append(title, newNote);

  const labelsPane = doc.createElement("nav");
  labelsPane.className = "notes-labels";
  labelsPane.setAttribute("aria-label", "Labels");
  const labelBanner = doc.createElement("div");
  labelBanner.className = "notes-banner";
  const allNotes = createButton(doc, {
    label: "All notes",
    variant: "ghost",
    size: "sm",
    onClick: () => selectLabel(null),
  });
  allNotes.hidden = true;
  const treeSlot = doc.createElement("div");
  treeSlot.className = "notes-tree";
  labelsPane.append(labelBanner, allNotes, treeSlot);

  const listPane = doc.createElement("div");
  listPane.className = "notes-list";
  const listHead = doc.createElement("div");
  listHead.className = "notes-list-head";
  const listBody = doc.createElement("div");
  listBody.className = "notes-list-body";
  listPane.append(listHead, listBody);
  const editorPane = doc.createElement("div");
  editorPane.className = "notes-editor";
  const layout = doc.createElement("div");
  layout.className = "notes-layout";
  layout.append(labelsPane, listPane, editorPane);
  container.replaceChildren(header, layout);

  // ---- The labels ----
  const labelPath = (id: string) =>
    idToPath.get(id) ?? labelNames.get(id) ?? "";

  function childrenOf(parentId: string | null): Label[] {
    const known = new Set(labels.map((l) => l.id));
    return labels.filter((l) =>
      parentId === null
        ? l.parentId === null || !known.has(l.parentId)
        : l.parentId === parentId,
    );
  }

  /** The label and every label under it. */
  function subtreeIds(id: string): Set<string> {
    const found = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of labels) {
        if (l.parentId !== null && found.has(l.parentId) && !found.has(l.id)) {
          found.add(l.id);
          grew = true;
        }
      }
    }
    return found;
  }

  function setLabels(list: Label[]): void {
    labels = list;
    labelNames = new Map(list.map((l) => [l.id, l.name]));
    pathToId = new Map();
    idToPath = new Map();
    stepsToId = new Map();
    const walk = (
      parentId: string | null,
      prefix: string,
      steps: string[],
    ): void => {
      for (const label of childrenOf(parentId)) {
        if (label.name.trim() === "") continue;
        const path = prefix
          ? `${prefix}${PATH_SEPARATOR}${label.name}`
          : label.name;
        const own = [...steps, label.name];
        stepsToId.set(JSON.stringify(own), label.id);
        if (!pathToId.has(path)) {
          pathToId.set(path, label.id);
          idToPath.set(label.id, path);
        }
        walk(label.id, path, own);
      }
    };
    walk(null, "", []);
  }

  function treeNodes(parentId: string | null): TreeNode[] {
    return childrenOf(parentId).map((label) => {
      const children = treeNodes(label.id);
      return {
        id: label.id,
        label: label.name,
        kind: "label",
        expanded: true,
        current: label.id === currentLabelId,
        ...(children.length ? { children } : {}),
      };
    });
  }

  function pickerNodes(
    parentId: string | null,
    options: { disabled?: Set<string>; currentParent?: string | null } = {},
  ): LabelPickerNode[] {
    return childrenOf(parentId).map((label) => {
      const children = pickerNodes(label.id, options);
      return {
        name: label.name,
        ...(children.length ? { children } : {}),
        ...(options.disabled?.has(label.id)
          ? { disabled: NOT_UNDER_ITSELF }
          : {}),
        ...(options.currentParent === label.id ? { current: true } : {}),
      };
    });
  }

  /** The id of the label a click landed on, found from the names above it in the tree. */
  function idOfNode(node: HTMLElement): string | null {
    const steps: string[] = [];
    let li: Element | null | undefined = node.closest("li");
    while (li) {
      const name = li.querySelector(".tname")?.textContent;
      if (name === null || name === undefined) return null;
      steps.unshift(name);
      li = li.parentElement?.closest("li");
    }
    return stepsToId.get(JSON.stringify(steps)) ?? null;
  }

  function showLabelProblem(lead: string, error: unknown): void {
    console.error(lead, error);
    if (left) return;
    labelBanner.replaceChildren(
      buildBanner({ tone: "bad", lead, message: errorMessage(error) }),
    );
  }

  function showTree(): void {
    const box = createTree(doc, "Labels", treeNodes(null), undefined, {
      onAction: (event) => treeAction(event),
      signal: stop.signal,
    });
    box.addEventListener("click", (event) => {
      const node = (event.target as Element).closest<HTMLElement>(".tnode");
      if (!node) return;
      const id = idOfNode(node);
      if (id !== null) selectLabel(id);
    });
    treeSlot.replaceChildren(box);
    allNotes.hidden = currentLabelId === null;
  }

  /** Rereads the labels after a change, then redraws the tree, the picker and the list. */
  async function refreshLabels(): Promise<void> {
    try {
      setLabels(await deps.listLabels());
    } catch (error) {
      showLabelProblem("The labels could not be read.", error);
      return;
    }
    if (left) return;
    if (currentLabelId !== null && !labelNames.has(currentLabelId))
      currentLabelId = null;
    showTree();
    if (picker) mountPicker(chosenIds().filter((id) => labelNames.has(id)));
    showDirty();
    await loadNotes();
  }

  async function labelWork(
    lead: string,
    done: string,
    work: () => Promise<unknown>,
  ): Promise<void> {
    labelBanner.replaceChildren();
    try {
      await work();
    } catch (error) {
      showLabelProblem(lead, error);
      return;
    }
    if (left) return;
    deps.toast(done);
    await refreshLabels();
  }

  /** What the tree reports. Each action settles in the screen; nothing rejects. */
  function treeAction(event: TreeActionEvent): Promise<void> | undefined {
    const { action, id, name } = event;
    if (action === "create")
      return labelWork("The label was not created.", "Label created.", () =>
        deps.createLabel(id, name ?? ""),
      );
    if (action === "rename" && id !== null)
      return labelWork("The label was not renamed.", "Label renamed.", () =>
        deps.renameLabel(id, name ?? ""),
      );
    if (action === "move" && id !== null) openMove(id);
    if (action === "delete" && id !== null) return askDelete(id);
    return undefined;
  }

  /** The notes that have this label itself (the list of a label also holds its children's). */
  async function countNotesOf(id: string): Promise<number> {
    let count = 0;
    let after: ChangeCursor | null = null;
    do {
      const page: LabelledNotePage = await deps.listLabelledNotes(id, {
        limit: COUNT_PAGE,
        ...(after ? { after } : {}),
      });
      count += page.items.filter((n) => n.labelIds.includes(id)).length;
      after = page.next;
    } while (after && !left);
    return count;
  }

  async function askDelete(id: string): Promise<void> {
    const label = labels.find((l) => l.id === id);
    if (!label) return;
    labelBanner.replaceChildren();
    const opener =
      doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    let count: number;
    try {
      count = await countNotesOf(id);
    } catch (error) {
      showLabelProblem("The label was not deleted.", error);
      return;
    }
    if (left) return;
    const parentPath = label.parentId ? labelPath(label.parentId) : "";
    const here = labelPath(id);
    const where = label.parentId
      ? count > 0
        ? `Its ${noteCount(count)} ${count === 1 ? "moves" : "move"} to "${parentPath}".`
        : "It holds no notes."
      : "Its notes keep their other labels. A note with no other label stops the delete.";
    const kids = childrenOf(id).length
      ? ` Its child labels move ${label.parentId ? `to "${parentPath}"` : "to the top level"}.`
      : "";
    const handle = createConfirmDialog({
      doc,
      title: `Delete the label "${here}"?`,
      message: `${where}${kids}`,
      lose: [`The label "${here}"`],
      keepLabel: "Keep label",
      confirmLabel: "Delete label",
      onConfirm: () => {
        void labelWork(
          "The label was not deleted.",
          "Label deleted.",
          async () => {
            await deps.deleteLabel(id);
            if (currentLabelId !== null && subtreeIds(id).has(currentLabelId))
              currentLabelId = label.parentId;
          },
        );
      },
    });
    handle.open(opener);
  }

  /** Move: choose the new parent in a dialog. The label and what is under it cannot be chosen. */
  function openMove(id: string): void {
    const label = labels.find((l) => l.id === id);
    if (!label) return;
    labelBanner.replaceChildren();
    const opener =
      doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const parentPath = label.parentId ? labelPath(label.parentId) : "";
    const chooser = createLabelPicker(doc, {
      label: "New parent",
      mode: "single",
      topLevel: true,
      nodes: pickerNodes(null, {
        disabled: subtreeIds(id),
        currentParent: label.parentId,
      }),
      value: [parentPath],
      onChange: () => chooser.setError(null),
    });
    let moving = false;
    const handle = createDialog({
      doc,
      title: `Move the label "${labelPath(id)}"`,
      children: [chooser.element],
      actions: (close) => {
        const move = createDialogButton(
          "Move",
          "primary",
          () => {
            const path = chooser.value()[0] ?? "";
            const parentId = path === "" ? null : (pathToId.get(path) ?? null);
            if (path !== "" && parentId === null) return;
            if (parentId === label.parentId) {
              close();
              return;
            }
            if (moving) return;
            moving = true;
            void (async () => {
              try {
                await deps.moveLabel(id, parentId);
              } catch (error) {
                console.error("could not move the label:", error);
                chooser.setError(errorMessage(error));
                moving = false;
                return;
              }
              close();
              if (left) return;
              deps.toast("Label moved.");
              await refreshLabels();
            })();
          },
          doc,
        );
        return [createDialogButton("Cancel", "default", close, doc), move];
      },
      onClose: () => {
        moveDialog = null;
      },
    });
    moveDialog = handle;
    handle.open(opener);
  }

  function selectLabel(id: string | null): void {
    if (id === currentLabelId) return;
    currentLabelId = id;
    allNotes.hidden = id === null;
    void loadNotes();
  }

  // ---- The editor of the open note. Built once per opened note, then updated in place. ----
  const area = createTextarea(doc);
  const field = createField(doc, { label: "Note text", control: area });
  field.classList.add("notes-field");
  const pickerSlot = doc.createElement("div");
  pickerSlot.className = "notes-picker";
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
  // The Read mode shows the last saved text (not the unsaved edit).
  const readPane = doc.createElement("div");
  readPane.className = "notes-read";

  /** The ids of the labels chosen in the picker now. */
  function chosenIds(): string[] {
    return (picker?.value() ?? [])
      .map((path) => pathToId.get(path))
      .filter((id): id is string => id !== undefined);
  }

  const isEditing = () => openId !== null || isNew;
  const isDirty = () =>
    isEditing() &&
    (area.value !== original || !sameIds(chosenIds(), originalIds));

  function showDirty(): void {
    dirtySlot.replaceChildren(
      ...(isDirty()
        ? [buildPill({ text: "Unsaved changes", tint: "warn" })]
        : []),
    );
  }

  /** Builds the picker for the note's labels. Chips show the full paths. */
  function mountPicker(ids: string[]): void {
    picker = createLabelPicker(doc, {
      label: "Labels",
      mode: "multiple",
      nodes: pickerNodes(null),
      value: ids
        .map((id) => idToPath.get(id))
        .filter((path): path is string => path !== undefined),
      onChange: () => {
        picker?.setError(null);
        showDirty();
      },
    });
    pickerSlot.replaceChildren(picker.element);
  }

  area.addEventListener("input", showDirty);

  const bar = doc.createElement("div");
  bar.className = "notes-bar";

  /** Edit shows the text area, the labels, Save and Cancel; Read shows the saved note. */
  function showMode(): void {
    if (mode === "Read")
      readPane.replaceChildren(
        createMarkdownView(doc, { source: original, label: "Note" }),
      );
    const body = mode === "Edit" ? [field, pickerSlot, actions] : [readPane];
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
    bar.replaceChildren(
      segmented,
      ...(isNew
        ? [buildText(doc, { tone: "muted", size: "base", content: "New note" })]
        : []),
      dirtySlot,
    );
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
    isNew = false;
    original = found.note.body;
    originalIds = [...found.labelIds];
    area.value = original;
    mode = "Edit";
    bannerSlot.replaceChildren();
    mountPicker(originalIds);
    buildEditor();
    showList();
  }

  /** A new note: empty, in Edit mode, with the current label chosen. */
  function openNew(): void {
    openId = null;
    isNew = true;
    original = "";
    originalIds = currentLabelId ? [currentLabelId] : [];
    area.value = "";
    mode = "Edit";
    bannerSlot.replaceChildren();
    mountPicker(originalIds);
    buildEditor();
    showList();
    area.focus();
  }

  function cancel(): void {
    area.value = original;
    bannerSlot.replaceChildren();
    mountPicker(originalIds.filter((id) => labelNames.has(id)));
    showDirty();
  }

  /** Whether a saved note belongs in the list now shown (the label and the labels under it). */
  function inList(note: LabelledNote): boolean {
    if (currentLabelId === null) return true;
    const scope = subtreeIds(currentLabelId);
    return note.labelIds.some((id) => scope.has(id));
  }

  async function save(): Promise<void> {
    if (saving || !isEditing()) return;
    const id = openId;
    const ids = chosenIds();
    if (ids.length === 0) {
      picker?.setError(NO_LABEL);
      return;
    }
    saving = true;
    const body = area.value;
    setButtonBusy(saveButton, true, SAVE);
    bannerSlot.replaceChildren();
    try {
      const saved = await deps.saveLabelledNote(id, body, ids);
      if (left) return;
      notes = [
        ...(inList(saved) ? [saved] : []),
        ...notes.filter((n) => n.note.id !== saved.note.id),
      ];
      if (openId === id) {
        openId = saved.note.id;
        isNew = false;
        original = saved.note.body;
        originalIds = [...saved.labelIds];
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

  async function requestNew(): Promise<void> {
    if (isDirty() && !(await askDiscard(newNote))) return;
    if (!left) openNew();
  }

  // ---- The note list ----
  function showHead(): void {
    listHead.replaceChildren(
      buildText(doc, {
        tone: "muted",
        size: "base",
        content:
          currentLabelId === null
            ? "All notes"
            : `Notes in ${labelPath(currentLabelId)}, with the notes of its child labels`,
      }),
    );
  }

  function showList(): void {
    showHead();
    if (!notes.length) {
      listBody.replaceChildren(
        buildEmptyState({
          title: "No notes yet.",
          body:
            currentLabelId === null
              ? "Notes you save show here, the latest change first."
              : "No note has this label or a label under it yet.",
        }),
      );
      return;
    }
    const hadFocus = listBody.contains(doc.activeElement);
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
    listBody.replaceChildren(...parts);
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
      const page = await deps.listLabelledNotes(currentLabelId, {
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
      listBody.append(
        buildBanner({
          tone: "bad",
          lead: "More notes could not be read.",
          message: errorMessage(error),
        }),
      );
    }
  }

  function showReading(): void {
    showHead();
    listBody.replaceChildren(
      buildSkeleton(),
      buildBusyLine("Reading your notes…"),
    );
  }

  function showReadError(error: unknown, retry: () => void): void {
    showHead();
    listBody.replaceChildren(
      buildErrorState({
        title: "The notes could not be shown.",
        body: errorMessage(error),
        action: { label: "Try again", onClick: retry },
      }),
    );
  }

  /** Reads the first page of the notes of the current label (all notes with none). */
  async function loadNotes(): Promise<void> {
    const visit = ++loads;
    showReading();
    try {
      const page = await deps.listLabelledNotes(currentLabelId, {
        limit: NOTES_PAGE,
      });
      if (left || visit !== loads) return;
      notes = page.items;
      next = page.next;
      showList();
      if (!isEditing()) showEditorHint();
    } catch (error) {
      console.error("could not read the notes:", error);
      if (left || visit !== loads) return;
      showReadError(error, () => void loadNotes());
    }
  }

  async function load(): Promise<void> {
    const visit = ++loads;
    showReading();
    try {
      const [page, labelList] = await Promise.all([
        deps.listLabelledNotes(currentLabelId, { limit: NOTES_PAGE }),
        deps.listLabels(),
      ]);
      if (left || visit !== loads) return;
      notes = page.items;
      next = page.next;
      setLabels(labelList);
      showTree();
      showList();
      if (!isEditing()) showEditorHint();
    } catch (error) {
      console.error("could not read the notes:", error);
      if (left || visit !== loads) return;
      showReadError(error, () => void load());
    }
  }

  void load();

  return {
    leave() {
      left = true;
      stop.abort();
      dialog?.close();
      moveDialog?.close();
    },
    canLeave() {
      if (!isDirty()) return Promise.resolve(true);
      return askDiscard(
        doc.activeElement instanceof HTMLElement ? doc.activeElement : null,
      );
    },
  };
}
