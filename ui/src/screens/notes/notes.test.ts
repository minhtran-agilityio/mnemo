// @vitest-environment happy-dom
// The Notes screen with fake data functions: states, the editor (dirty mark, Cancel, Save) and
// the question before unsaved changes are lost.
import { afterEach, expect, test, vi } from "vitest";
import type { Label, LabelledNote, LabelledNotePage } from "../../shared/api";
import { changedText, type NotesDeps, noteTitle, renderNotes } from "./notes";

const T1 = "2026-11-02T10:00:00Z";
const T2 = "2026-11-01T09:00:00Z";
const T3 = "2026-11-03T08:00:00Z";
const label = (id: string, name: string, parentId: string | null): Label => ({
  id,
  createdAt: T2,
  updatedAt: T2,
  deletedAt: null,
  name,
  parentId,
});
const LABELS = [
  label("lab-work", "Work", null),
  label("lab-proj", "Projects", "lab-work"),
];
const ln = (
  id: string,
  body: string,
  labelIds: string[],
  at: string,
): LabelledNote => ({
  note: { id, createdAt: at, updatedAt: at, deletedAt: null, body },
  labelIds,
});
const BODY1 = "# Groceries\nBuy oat milk\n**bold words**";
const BODY2 = "Meeting plan\nAgenda for Monday";
const NOTES = [
  ln("note-1", BODY1, ["lab-work"], T1),
  ln("note-2", BODY2, ["lab-proj", "lab-work"], T2),
];

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

function setup(over: Partial<NotesDeps> = {}) {
  const deps: NotesDeps = {
    listLabelledNotes: vi.fn(
      async (): Promise<LabelledNotePage> => ({
        items: NOTES.slice(),
        next: null,
      }),
    ),
    listLabels: vi.fn(async () => LABELS.slice()),
    saveLabelledNote: vi.fn(async (id, body, labelIds) =>
      ln(id ?? "note-new", body, labelIds, T3),
    ),
    toast: vi.fn(),
    ...over,
  };
  const screen = document.createElement("main");
  document.body.append(screen);
  const handle = renderNotes(screen, deps);
  return { deps, screen, handle };
}

const options = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLElement>("[role=option]"),
];
const option = (root: ParentNode, text: string) =>
  options(root).find((o) => o.textContent?.includes(text)) as HTMLElement;
const area = (root: ParentNode) => root.querySelector("textarea");
const button = (root: ParentNode, name: string) =>
  [...root.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement;
const dialog = () => document.querySelector("dialog");
const type = (root: ParentNode, text: string) => {
  const a = area(root) as HTMLTextAreaElement;
  a.value += text;
  a.dispatchEvent(new Event("input", { bubbles: true }));
};
const hasText = (root: ParentNode, text: string) =>
  (root.textContent ?? "").includes(text);

async function opened(over: Partial<NotesDeps> = {}) {
  const s = setup(over);
  await flush();
  option(s.screen, "Groceries").click();
  await flush();
  return s;
}

afterEach(() => {
  document.body.replaceChildren();
});

test("the row title is the first line with text, without heading marks", () => {
  expect(noteTitle(BODY1)).toBe("Groceries");
  expect(noteTitle("\n  \n## Plan  \nmore")).toBe("Plan");
  expect(noteTitle(" \n#\n")).toBe("Untitled note");
  expect(changedText(T1)).toBe("2026-11-02");
});

test("while the notes load the screen shows a busy line, then the list", async () => {
  let release: (p: LabelledNotePage) => void = () => {};
  const { screen } = setup({
    listLabelledNotes: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  await flush();
  expect(screen.querySelector("[role=status]")?.textContent).toMatch(
    /Reading your notes/,
  );
  expect(options(screen)).toHaveLength(0);
  release({ items: NOTES.slice(), next: null });
  await flush();
  expect(screen.querySelector("[role=status]")).toBeNull();
  expect(options(screen)).toHaveLength(2);
});

test("each row shows the title, the label names and the last change", async () => {
  const { screen, deps } = setup();
  await flush();
  expect(deps.listLabelledNotes).toHaveBeenCalledWith(null, { limit: 50 });
  expect(screen.querySelector("[role=listbox]")).not.toBeNull();
  const one = option(screen, "Groceries");
  expect(one.querySelector(".row-title")?.textContent).toBe("Groceries");
  expect(one.textContent).toContain("Work");
  expect(one.textContent).toContain("2026-11-02");
  expect(one.textContent).not.toContain("Buy oat milk");
  expect(option(screen, "Meeting plan").textContent).toContain(
    "Projects, Work",
  );
  expect(options(screen).map((o) => o.getAttribute("aria-selected"))).toEqual([
    "false",
    "false",
  ]);
});

test("with no notes the screen shows an empty state", async () => {
  const { screen } = setup({
    listLabelledNotes: async () => ({ items: [], next: null }),
  });
  await flush();
  expect(hasText(screen, "No notes yet.")).toBe(true);
  expect(options(screen)).toHaveLength(0);
  expect(area(screen)).toBeNull();
});

test("a failed list shows the core message and Try again reads the list again", async () => {
  let fail = true;
  const list = vi.fn(async (): Promise<LabelledNotePage> => {
    if (fail)
      throw { code: "storage_error", message: "The notes could not be read." };
    return { items: NOTES.slice(), next: null };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { screen } = setup({ listLabelledNotes: list });
  await flush();
  const alert = screen.querySelector("[role=alert]");
  expect(alert?.textContent).toContain("The notes could not be read.");
  fail = false;
  button(screen, "Try again").click();
  await flush();
  expect(list).toHaveBeenCalledTimes(2);
  expect(options(screen)).toHaveLength(2);
  expect(screen.querySelector("[role=alert]")).toBeNull();
});

test("opening a note selects its row and shows its text in Edit mode", async () => {
  const { screen } = await opened();
  expect(area(screen)?.value).toBe(BODY1);
  expect(option(screen, "Groceries").getAttribute("aria-selected")).toBe(
    "true",
  );
  const radios = [...screen.querySelectorAll("[role=radio]")];
  expect(radios.map((r) => r.textContent)).toEqual(["Read", "Edit"]);
  expect(radios[1].getAttribute("aria-checked")).toBe("true");
  const textarea = area(screen) as HTMLTextAreaElement;
  expect(screen.querySelector(`label[for="${textarea.id}"]`)?.textContent).toBe(
    "Note text",
  );
  expect(button(screen, "Save")).toBeTruthy();
  expect(button(screen, "Cancel")).toBeTruthy();
});

test("an edit shows 'Unsaved changes' and Cancel restores the text from before it", async () => {
  const { screen, deps } = await opened();
  expect(hasText(screen, "Unsaved changes")).toBe(false);
  type(screen, "\nand bread");
  expect(hasText(screen, "Unsaved changes")).toBe(true);
  expect(screen.querySelector(".pill-warn")?.textContent).toBe(
    "Unsaved changes",
  );
  button(screen, "Cancel").click();
  expect(area(screen)?.value).toBe(BODY1);
  expect(hasText(screen, "Unsaved changes")).toBe(false);
  expect(deps.saveLabelledNote).not.toHaveBeenCalled();
});

test("Save sends the text with the note's labels, shows a toast and clears the mark", async () => {
  const { screen, deps } = await opened();
  type(screen, "\nand bread");
  button(screen, "Save").click();
  await flush();
  expect(deps.saveLabelledNote).toHaveBeenCalledWith(
    "note-1",
    `${BODY1}\nand bread`,
    ["lab-work"],
  );
  expect(deps.toast).toHaveBeenCalledWith("Note saved.");
  expect(hasText(screen, "Unsaved changes")).toBe(false);
  // The saved note is the newest change, so it leads the list.
  expect(options(screen)[0].getAttribute("aria-selected")).toBe("true");
});

test("a failed save shows a bad banner and keeps the text and the mark", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { screen, deps } = await opened({
    saveLabelledNote: async () => {
      throw {
        code: "invalid_input",
        message: "A note needs at least one label.",
      };
    },
  });
  type(screen, "\nand bread");
  button(screen, "Save").click();
  await flush();
  const alert = screen.querySelector("[role=alert]");
  expect(alert?.classList.contains("banner-bad")).toBe(true);
  expect(alert?.textContent).toContain("A note needs at least one label.");
  expect(area(screen)?.value).toBe(`${BODY1}\nand bread`);
  expect(hasText(screen, "Unsaved changes")).toBe(true);
  expect(deps.toast).not.toHaveBeenCalled();
});

test("Save is busy while it saves, so a second click sends nothing", async () => {
  let release: () => void = () => {};
  const save = vi.fn(
    (id: string | null, body: string, labelIds: string[]) =>
      new Promise<LabelledNote>((r) => {
        release = () => r(ln(id ?? "x", body, labelIds, T3));
      }),
  );
  const { screen } = await opened({ saveLabelledNote: save });
  type(screen, "!");
  const saveButton = button(screen, "Save");
  saveButton.click();
  await flush();
  expect(saveButton.getAttribute("aria-busy")).toBe("true");
  saveButton.click();
  await flush();
  expect(save).toHaveBeenCalledTimes(1);
  release();
  await flush();
  expect(saveButton.getAttribute("aria-busy")).toBeNull();
  expect(hasText(screen, "Unsaved changes")).toBe(false);
});

test("opening another note with unsaved changes asks; Keep editing stays", async () => {
  const { screen } = await opened();
  type(screen, "\nand bread");
  option(screen, "Meeting plan").click();
  await flush();
  expect(dialog()?.textContent).toContain("Discard your changes");
  button(document, "Keep editing").click();
  await flush();
  expect(area(screen)?.value).toBe(`${BODY1}\nand bread`);
  expect(option(screen, "Groceries").getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(option(screen, "Meeting plan").getAttribute("aria-selected")).toBe(
    "false",
  );
});

test("Discard changes opens the other note without saving", async () => {
  const { screen, deps } = await opened();
  type(screen, "\nand bread");
  option(screen, "Meeting plan").click();
  await flush();
  button(document, "Discard changes").click();
  await flush();
  expect(area(screen)?.value).toBe(BODY2);
  expect(hasText(screen, "Unsaved changes")).toBe(false);
  expect(deps.saveLabelledNote).not.toHaveBeenCalled();
});

test("a note with no changes is left without asking", async () => {
  const { screen, handle } = await opened();
  option(screen, "Meeting plan").click();
  await flush();
  expect(dialog()).toBeNull();
  expect(area(screen)?.value).toBe(BODY2);
  await expect(handle.canLeave()).resolves.toBe(true);
});

test("leaving the screen with unsaved changes asks; Keep editing and Escape stay, Discard leaves", async () => {
  const { screen, handle } = await opened();
  type(screen, "\nand bread");
  const keep = handle.canLeave();
  await flush();
  button(document, "Keep editing").click();
  await expect(keep).resolves.toBe(false);
  const byEscape = handle.canLeave();
  await flush();
  (dialog() as HTMLDialogElement).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await expect(byEscape).resolves.toBe(false);
  // Two questions at once share one dialog.
  const first = handle.canLeave();
  const second = handle.canLeave();
  await flush();
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  button(document, "Discard changes").click();
  await expect(first).resolves.toBe(true);
  await expect(second).resolves.toBe(true);
});

test("the Read mode shows no note content and no text area", async () => {
  const { screen } = await opened();
  button(screen, "Read").click();
  expect(area(screen)).toBeNull();
  expect(hasText(screen, "Buy oat milk")).toBe(false);
  expect(hasText(screen, "bold words")).toBe(false);
  expect(screen.querySelector("strong, b, h2, script")).toBeNull();
  expect(button(screen, "Save")).toBeUndefined();
  button(screen, "Edit").click();
  expect(area(screen)?.value).toBe(BODY1);
});

test("a note list with more pages shows more notes on request", async () => {
  const more = ln("note-3", "Old note", ["lab-work"], "2026-10-01T00:00:00Z");
  const list = vi.fn(
    async (
      _label: string | null,
      page: { limit: number; after?: unknown },
    ): Promise<LabelledNotePage> =>
      page.after
        ? { items: [more], next: null }
        : {
            items: NOTES.slice(),
            next: { updatedAt: T2, id: "note-2" },
          },
  );
  const { screen } = setup({ listLabelledNotes: list });
  await flush();
  button(screen, "Show more notes").click();
  await flush();
  expect(list).toHaveBeenLastCalledWith(null, {
    limit: 50,
    after: { updatedAt: T2, id: "note-2" },
  });
  expect(options(screen)).toHaveLength(3);
  expect(button(screen, "Show more notes")).toBeUndefined();
});

test("after leave, a late list result draws nothing", async () => {
  let release: (p: LabelledNotePage) => void = () => {};
  const { screen, handle } = setup({
    listLabelledNotes: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  handle.leave();
  release({ items: NOTES.slice(), next: null });
  await flush();
  expect(options(screen)).toHaveLength(0);
});
