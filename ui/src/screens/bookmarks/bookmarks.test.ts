// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import type { Folder, Page, SavedBookmark, SaveResult } from "../../shared/api";
import { type BookmarksDeps, renderBookmarks } from "./bookmarks";
import {
  actionsFor,
  moveToTop,
  restore,
  savedDate,
  toLinkItem,
  upsert,
} from "./bookmarks-logic";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

function bm(over: Partial<SavedBookmark> = {}): SavedBookmark {
  return {
    id: "b1",
    createdAt: "2026-11-25T10:00:00Z",
    updatedAt: "2026-11-25T10:00:00Z",
    deletedAt: null,
    url: "https://v2.tauri.app/security/",
    title: "Capabilities",
    site: "v2.tauri.app",
    summary: "Each window gets a list of allowed commands.",
    reason: "It may matter for the command allow-list.",
    reasonIsGuess: true,
    summaryStatus: "done",
    tags: ["security", "tauri"],
    labels: [],
    folderId: UNSORTED.id,
    folder: "Unsorted",
    folderReason: null,
    folderIsGuess: false,
    ...over,
  };
}

const UNSORTED: Folder = {
  id: "f-unsorted",
  name: "Unsorted",
  isDefault: true,
  count: 0,
};
const DEV: Folder = {
  id: "f-dev",
  name: "Dev tools",
  isDefault: false,
  count: 0,
};

/** A save or summary result: the bookmark, not already saved. */
function res(over: Partial<SaveResult> = {}): SaveResult {
  return { ...bm(), alreadySaved: false, ...over };
}

const page = <T>(items: T[]): Page<T> => ({ items, next: null });
const flush = () => new Promise((r) => setTimeout(r, 0));

function deps(over: Partial<BookmarksDeps> = {}) {
  let emit: (b: SavedBookmark) => void = () => {};
  const stop = vi.fn();
  const d: BookmarksDeps = {
    saveLink: vi.fn(async (url: string) => res({ id: "new", url })),
    summarizeBookmark: vi.fn(async (id: string) => res({ id })),
    listBookmarkCards: vi.fn(async () => page<SavedBookmark>([])),
    onBookmarkChanged: vi.fn(async (h: (b: SavedBookmark) => void) => {
      emit = h;
      return stop;
    }),
    listFolders: vi.fn(async () => [UNSORTED]),
    createFolder: vi.fn(async (name: string) => ({ ...DEV, name })),
    renameFolder: vi.fn(async (id: string, name: string) => ({
      ...DEV,
      id,
      name,
    })),
    deleteFolder: vi.fn(async () => 0),
    moveBookmark: vi.fn(async (id: string, folderId: string) =>
      bm({ id, folderId, folder: folderId === DEV.id ? DEV.name : "Unsorted" }),
    ),
    deleteSavedBookmark: vi.fn(async () => {}),
    undoLast: vi.fn(async () => bm()),
    ...over,
  };
  return { d, emit: (b: SavedBookmark) => emit(b), stop };
}

function mount(d: BookmarksDeps) {
  const box = document.createElement("main");
  document.body.replaceChildren(box);
  const leave = renderBookmarks(box, d);
  return { box, leave };
}

const button = (root: ParentNode, name: string) =>
  [...root.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  );

// ---- logic ----

test("savedDate gives day, month and year in UTC", () => {
  expect(savedDate("2026-11-25T23:30:00Z")).toBe("25 Nov 2026");
  expect(savedDate("not a date")).toBe("not a date");
});

test("a done link shows its summary, tags and reason as a guess", () => {
  const item = toLinkItem(bm());
  expect(item).toMatchObject({
    title: "Capabilities",
    site: "v2.tauri.app",
    saved: "25 Nov 2026",
    status: "done",
    summary: "Each window gets a list of allowed commands.",
    tags: ["security", "tauri"],
    reason: "It may matter for the command allow-list.",
    reasonKind: "guess",
  });
});

test("a link that is not done never shows a summary, tags or reason, and has a title", () => {
  const item = toLinkItem(
    bm({ summaryStatus: "reading", title: null, summary: "old" }),
  );
  expect(item.summary).toBeUndefined();
  expect(item.tags).toBeUndefined();
  expect(item.reason).toBeUndefined();
  expect(item.title).toBe("v2.tauri.app");
  expect(toLinkItem(bm({ title: null, site: null })).title).toBe(
    "https://v2.tauri.app/security/",
  );
  expect(toLinkItem(bm({ summaryStatus: "ai_off" })).status).toBe("ai-off");
});

test("each status has its actions", () => {
  expect(actionsFor(bm({ summaryStatus: "unreadable" }))).toEqual(["paste"]);
  expect(actionsFor(bm({ summaryStatus: "ai_off" }))).toEqual(["later"]);
  expect(actionsFor(bm({ summaryStatus: "pending" }))).toEqual(["later"]);
  expect(actionsFor(bm({ summaryStatus: "reading" }))).toEqual([]);
  expect(actionsFor(bm())).toEqual([]);
});

test("a page that could not be reached offers both Summarize later and Paste the text", () => {
  // Read from the stored status, so it holds after a list reload or a restart (no aiError).
  const notReached = bm({
    summaryStatus: "not_reached",
    summary: null,
    tags: [],
  });
  expect(actionsFor(notReached)).toEqual(["later", "paste"]);
  // The card says "No summary yet": the ds link card has no sixth status.
  expect(toLinkItem(notReached).status).toBe("pending");
  expect(toLinkItem(notReached).summary).toBeUndefined();
  // Another AI failure keeps the one action.
  const timeout = { ...notReached, summaryStatus: "pending" as const };
  expect(actionsFor(timeout)).toEqual(["later"]);
  // Done or being read: no action, whatever the last error was.
  expect(actionsFor({ ...notReached, summaryStatus: "reading" })).toEqual([]);
});

test("upsert replaces in place and puts a new link first", () => {
  const a = bm({ id: "a" });
  const b = bm({ id: "b" });
  expect(upsert([a], b).map((x) => x.id)).toEqual(["b", "a"]);
  const changed = upsert([b, a], bm({ id: "a", title: "New" }));
  expect(changed.map((x) => x.id)).toEqual(["b", "a"]);
  expect(changed[1].title).toBe("New");
});

// ---- screen ----

test("the screen has a labelled link box, a Save link button, and an empty state", async () => {
  const { d } = deps();
  const { box } = mount(d);
  await flush();
  const input = box.querySelector("input");
  expect(input?.labels?.[0]?.textContent).toBe("Link");
  expect(button(box, "Save link")).toBeDefined();
  expect(box.textContent).toContain("No saved links yet");
  expect(d.listBookmarkCards).toHaveBeenCalledWith({ limit: 100 });
});

test("Save sends the link, clears the box at once, and the card follows the events", async () => {
  let finish: (r: SaveResult) => void = () => {};
  const { d, emit } = deps({
    saveLink: vi.fn(
      (url: string) =>
        new Promise<SaveResult>((r) => {
          finish = r;
          void url;
        }),
    ),
  });
  const { box } = mount(d);
  await flush();
  const input = box.querySelector("input") as HTMLInputElement;
  input.value = " https://v2.tauri.app/security/ ";
  box.querySelector("form")?.dispatchEvent(new Event("submit"));
  expect(d.saveLink).toHaveBeenCalledWith("https://v2.tauri.app/security/");
  expect(input.value).toBe("");
  emit(bm({ summaryStatus: "reading", summary: null, title: null }));
  expect(box.textContent).toContain("Reading the page");
  finish(res());
  await flush();
  expect(box.textContent).toContain(
    "Each window gets a list of allowed commands.",
  );
  expect(box.textContent).toContain("Guess");
  expect(box.querySelectorAll("article")).toHaveLength(1);
});

test("an empty box or a refused link shows the reason on the field and keeps the text", async () => {
  const { d } = deps({
    saveLink: vi.fn(async () => {
      throw {
        code: "invalid_input",
        message: "The link must be a web address.",
      };
    }),
  });
  const { box } = mount(d);
  await flush();
  const input = box.querySelector("input") as HTMLInputElement;
  box.querySelector("form")?.dispatchEvent(new Event("submit"));
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(d.saveLink).not.toHaveBeenCalled();
  input.value = "not a link";
  box.querySelector("form")?.dispatchEvent(new Event("submit"));
  await flush();
  expect(input.value).toBe("not a link");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(box.textContent).toContain("The link must be a web address.");
  expect(box.querySelectorAll("article")).toHaveLength(0);
});

test("another failure shows a banner and no card", async () => {
  const { d } = deps({
    saveLink: vi.fn(async () => {
      throw { code: "storage_error", message: "Disk full." };
    }),
  });
  const { box } = mount(d);
  await flush();
  (box.querySelector("input") as HTMLInputElement).value = "https://a.example";
  box.querySelector("form")?.dispatchEvent(new Event("submit"));
  await flush();
  expect(box.querySelector('[role="alert"]')?.textContent).toContain(
    "Mnemo could not save the link. Disk full.",
  );
});

test("Paste the text opens a dialog and Make summary sends the text for that bookmark", async () => {
  const unreadable = bm({
    id: "u1",
    summaryStatus: "unreadable",
    summary: null,
    reason: null,
    tags: [],
  });
  const { d } = deps({
    listBookmarkCards: vi.fn(async () => page([unreadable])),
    summarizeBookmark: vi.fn(async (id: string) =>
      res({ id, summary: "Summary made from the pasted text." }),
    ),
  });
  const { box } = mount(d);
  await flush();
  expect(box.textContent).toContain(
    "Link only. Mnemo could not read this page.",
  );
  button(box, "Paste the text")?.click();
  const dialog = document.querySelector("dialog") as HTMLElement;
  const area = dialog.querySelector("textarea") as HTMLTextAreaElement;
  expect(area.labels?.[0]?.textContent).toBe("Page text");
  // Blank text is refused in place; the dialog stays.
  button(dialog, "Make summary")?.click();
  expect(area.getAttribute("aria-invalid")).toBe("true");
  expect(d.summarizeBookmark).not.toHaveBeenCalled();
  area.value = "  The page text.  ";
  button(dialog, "Make summary")?.click();
  expect(d.summarizeBookmark).toHaveBeenCalledWith("u1", "The page text.");
  await flush();
  expect(box.textContent).toContain("Summary made from the pasted text.");
  expect(document.querySelector("dialog")).toBeNull();
});

test("Summarize later asks again without pasted text and an AI error shows as a toast", async () => {
  const off = bm({
    id: "o1",
    summaryStatus: "ai_off",
    summary: null,
    tags: [],
  });
  const { d } = deps({
    listBookmarkCards: vi.fn(async () => page([off])),
    summarizeBookmark: vi.fn(async (id: string) => ({
      ...res({ id, summaryStatus: "pending", summary: null, tags: [] }),
      aiError: { code: "timeout", message: "Claude did not answer in time." },
    })),
  });
  const { box } = mount(d);
  await flush();
  expect(box.textContent).toMatch(/no summary yet/i);
  button(box, "Summarize later")?.click();
  expect(d.summarizeBookmark).toHaveBeenCalledWith("o1", undefined);
  await flush();
  expect(document.body.textContent).toContain("Claude did not answer in time.");
  // Still no summary yet, so the action stays.
  expect(button(box, "Summarize later")).toBeDefined();
});

test("a link whose page could not be reached offers both actions, and pasted text makes its summary", async () => {
  const { d } = deps({
    saveLink: vi.fn(async (url: string) => ({
      ...res({
        id: "n1",
        url,
        summaryStatus: "not_reached",
        summary: null,
        tags: [],
      }),
      aiError: {
        code: "page_not_reached",
        message:
          "Mnemo could not reach the site. No summary was saved. You can summarize it later or paste the text.",
      },
    })),
    summarizeBookmark: vi.fn(async (id: string) =>
      res({ id, summary: "Summary made from the pasted text." }),
    ),
  });
  const { box } = mount(d);
  await flush();
  (box.querySelector("input") as HTMLInputElement).value = "https://a.example";
  box.querySelector("form")?.dispatchEvent(new Event("submit"));
  await flush();
  const card = box.querySelector("article") as HTMLElement;
  // Link only, no summary, and both actions (owner decision on #25: "Offer both").
  expect(card.textContent).toMatch(/no summary yet/i);
  expect(card.textContent).not.toContain("Summary made");
  expectBothActions(card);
  expect(document.body.textContent).toContain(
    "Mnemo could not reach the site.",
  );
  button(card, "Paste the text")?.click();
  const dialog = document.querySelector("dialog") as HTMLElement;
  (dialog.querySelector("textarea") as HTMLTextAreaElement).value =
    "The page text.";
  button(dialog, "Make summary")?.click();
  expect(d.summarizeBookmark).toHaveBeenCalledWith("n1", "The page text.");
  await flush();
  expect(box.textContent).toContain("Summary made from the pasted text.");
  expect(button(box, "Paste the text")).toBeUndefined();
  expect(button(box, "Summarize later")).toBeUndefined();
});

test("a not-reached link loaded from the list offers both actions, with no toast", async () => {
  const { d } = deps({
    listBookmarkCards: vi.fn(async () =>
      page([
        bm({
          id: "r1",
          summaryStatus: "not_reached",
          summary: null,
          tags: [],
        }),
      ]),
    ),
  });
  const { box } = mount(d);
  await flush();
  const card = box.querySelector("article") as HTMLElement;
  expect(card.textContent).toMatch(/no summary yet/i);
  expectBothActions(card);
  expect(document.querySelector(".toast")).toBeNull();
});

test("Summarize later on a not-reached card asks again without pasted text", async () => {
  const { d } = deps({
    listBookmarkCards: vi.fn(async () =>
      page([
        bm({ id: "r2", summaryStatus: "not_reached", summary: null, tags: [] }),
      ]),
    ),
  });
  const { box } = mount(d);
  await flush();
  button(box, "Summarize later")?.click();
  expect(d.summarizeBookmark).toHaveBeenCalledWith("r2", undefined);
});

/** "Summarize later" first (the main one, default), then "Paste the text" (ghost), per the link card of issue 179. */
function expectBothActions(card: HTMLElement): void {
  const later = button(card, "Summarize later");
  const paste = button(card, "Paste the text");
  expect(later).toBeDefined();
  expect(paste).toBeDefined();
  // The card's own folder buttons come after the summary actions (see the folders tests).
  const shown = [...card.querySelectorAll(".lcard-action button")];
  expect(
    shown.map((b) => b.textContent?.trim()).filter((t) => t !== "Delete"),
  ).toEqual(["Summarize later", "Paste the text"]);
  expect(later?.classList.contains("btn-ghost")).toBe(false);
  expect(paste?.classList.contains("btn-ghost")).toBe(true);
}

test("a bookmark deleted while it was read leaves the list quietly", async () => {
  const { d, emit } = deps({
    saveLink: vi.fn(async (url: string) =>
      res({
        id: "g1",
        url,
        summaryStatus: "reading",
        summary: null,
        deletedAt: "2026-11-25T10:01:00Z",
      }),
    ),
  });
  const { box } = mount(d);
  await flush();
  emit(bm({ id: "g1", summaryStatus: "reading", summary: null }));
  expect(box.querySelectorAll("article")).toHaveLength(1);
  (box.querySelector("input") as HTMLInputElement).value = "https://g.example";
  box.querySelector("form")?.dispatchEvent(new Event("submit"));
  await flush();
  expect(box.querySelectorAll("article")).toHaveLength(0);
  expect(box.querySelector('[role="alert"]')).toBeNull();
  expect(box.textContent).toContain("No saved links yet");
});

test("a load failure says so, and leaving stops the event listener", async () => {
  const { d, stop } = deps({
    listBookmarkCards: vi.fn(async () => {
      throw { code: "storage_unavailable", message: "Quit and start again." };
    }),
  });
  const { box, leave } = mount(d);
  await flush();
  expect(box.querySelector('[role="alert"]')?.textContent).toContain(
    "Mnemo could not load the saved links. Quit and start again.",
  );
  leave();
  expect(stop).toHaveBeenCalled();
});

// ---- a link saved again (#28) ----

test("moveToTop puts a link saved again first and leaves no second row for it", () => {
  const a = bm({ id: "a" });
  const b = bm({ id: "b" });
  const c = bm({ id: "c" });
  expect(moveToTop([a, b, c], c).map((x) => x.id)).toEqual(["c", "a", "b"]);
  expect(moveToTop([a, b], c).map((x) => x.id)).toEqual(["c", "a", "b"]);
  expect(
    moveToTop([a, b], bm({ id: "b", deletedAt: "2026-11-25T10:01:00Z" })).map(
      (x) => x.id,
    ),
  ).toEqual(["a"]);
});

test("toLinkItem marks the card Already saved only when asked", () => {
  expect(toLinkItem(bm()).alreadySaved).toBeUndefined();
  expect(toLinkItem(bm(), true).alreadySaved).toBe(true);
});

test("saving a link that is already saved shows its old card on top with the note and adds no card", async () => {
  const one = bm({
    id: "o1",
    url: "https://a.example/",
    summary: "Summary one.",
  });
  const two = bm({
    id: "o2",
    url: "https://b.example/",
    summary: "Summary two.",
  });
  const { d } = deps({
    listBookmarkCards: vi.fn(async () => page([two, one])),
    saveLink: vi.fn(async () => res({ ...one, alreadySaved: true })),
  });
  const { box } = mount(d);
  await flush();
  expect(box.textContent).not.toContain("Already saved");
  (box.querySelector("input") as HTMLInputElement).value = "https://a.example/";
  box.querySelector("form")?.dispatchEvent(new Event("submit"));
  await flush();
  const cards = [...box.querySelectorAll("article")];
  expect(cards).toHaveLength(2);
  expect(cards[0]?.textContent).toContain("Summary one.");
  expect(cards[0]?.textContent).toContain("Already saved");
  expect(cards[1]?.textContent).not.toContain("Already saved");
  expect(d.summarizeBookmark).not.toHaveBeenCalled();
  // The result is announced through the screen's live status region.
  const status = box.querySelector('[role="status"][aria-live="polite"]');
  expect(status?.textContent).toContain("This link was already saved.");
  // The next save clears the note.
  d.saveLink = vi.fn(async (url: string) => res({ id: "n2", url }));
  (box.querySelector("input") as HTMLInputElement).value = "https://c.example/";
  box.querySelector("form")?.dispatchEvent(new Event("submit"));
  await flush();
  expect(box.textContent).not.toContain("Already saved");
});

test("a link saved again before the list has loaded stays on top with its note after the list loads", async () => {
  const older = bm({
    id: "o1",
    url: "https://a.example/",
    createdAt: "2026-11-24T10:00:00Z",
    summary: "Summary one.",
  });
  const newer = bm({
    id: "o2",
    url: "https://b.example/",
    createdAt: "2026-11-25T10:00:00Z",
    summary: "Summary two.",
  });
  let loaded: (p: Page<SavedBookmark>) => void = () => {};
  const { d } = deps({
    listBookmarkCards: vi.fn(
      () =>
        new Promise<Page<SavedBookmark>>((r) => {
          loaded = r;
        }),
    ),
    saveLink: vi.fn(async () => res({ ...older, alreadySaved: true })),
  });
  const { box } = mount(d);
  (box.querySelector("input") as HTMLInputElement).value = "https://a.example/";
  box.querySelector("form")?.dispatchEvent(new Event("submit"));
  await flush();
  // The duplicate answered first; the list resolves after it.
  loaded(page([newer, older]));
  await flush();
  const cards = [...box.querySelectorAll("article")];
  expect(cards).toHaveLength(2);
  expect(cards[0]?.textContent).toContain("Summary one.");
  expect(cards[0]?.textContent).toContain("Already saved");
  expect(cards[1]?.textContent).toContain("Summary two.");
  expect(cards[1]?.textContent).not.toContain("Already saved");
});

// ---- folders, Move, Delete and Undo (#26) ----

const WORK: Folder = { id: "f-work", name: "Work", isDefault: false, count: 0 };
const withFolders = (
  list: Folder[],
  cards: SavedBookmark[],
  over: Partial<BookmarksDeps> = {},
) =>
  deps({
    listFolders: vi.fn(async () => list.map((f) => ({ ...f }))),
    listBookmarkCards: vi.fn(async () => page(cards)),
    ...over,
  });
const treeNode = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLElement>(".tnode")].find(
    (n) => n.querySelector(".tname")?.textContent === name,
  ) as HTMLElement;
const menuItem = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) =>
    i.textContent?.startsWith(name),
  ) as HTMLElement;
const toastAction = () =>
  document.querySelector(".toast-action") as HTMLButtonElement | null;

test("the folder tree lists the folders with their counts, Unsorted last", async () => {
  const { d } = withFolders(
    [
      { ...DEV, count: 2 },
      { ...UNSORTED, count: 1 },
    ],
    [bm()],
  );
  const { box } = mount(d);
  await flush();
  const names = [...box.querySelectorAll(".tree-box .tname")].map(
    (n) => n.textContent,
  );
  expect(names).toEqual(["Dev tools", "Unsorted"]);
  expect(treeNode(box, "Dev tools").textContent).toContain("2");
});

test("Unsorted refuses rename and delete in its menu, with the reason", async () => {
  const { d } = withFolders([DEV, UNSORTED], []);
  const { box } = mount(d);
  await flush();
  const row = treeNode(box, "Unsorted").closest(".trow") as HTMLElement;
  (row.querySelector(".tmore") as HTMLButtonElement).click();
  for (const name of ["Rename", "Delete"]) {
    const item = menuItem(row, name);
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("Unsorted is the default folder.");
  }
  const dev = treeNode(box, "Dev tools").closest(".trow") as HTMLElement;
  expect(menuItem(dev, "Rename").getAttribute("aria-disabled")).toBeNull();
});

test("the card shows its folder, with the guess label and the app's reason, as the core sent them", async () => {
  const { d } = withFolders(
    [DEV, UNSORTED],
    [
      bm({
        id: "a",
        folderId: DEV.id,
        folder: "Dev tools",
        folderReason: "It is a reference page.",
        folderIsGuess: true,
      }),
      bm({ id: "b", summaryStatus: "ai_off", summary: null, tags: [] }),
    ],
  );
  const { box } = mount(d);
  await flush();
  const [first, second] = [...box.querySelectorAll("article")];
  expect(first.textContent).toContain("Dev tools");
  expect(first.textContent).toContain("It is a reference page.");
  expect(first.textContent).toContain("Guess");
  expect(second.textContent).toContain("Unsorted");
  expect(second.textContent).not.toContain("Guess");
});

test("the owner creates a folder from the tree; the screen asks the core and reads the folders again", async () => {
  const folders = [UNSORTED];
  const { d } = withFolders(folders, [], {
    listFolders: vi.fn(async () => [...folders]),
    createFolder: vi.fn(async (name: string) => {
      folders.unshift({ ...WORK, name });
      return WORK;
    }),
  });
  const { box } = mount(d);
  await flush();
  button(box, "New folder")?.click();
  const input = box.querySelector(".tedit input") as HTMLInputElement;
  input.value = "Work";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  await flush();
  expect(d.createFolder).toHaveBeenCalledWith("Work");
  expect(treeNode(box, "Work")).toBeDefined();
});

test("a refused folder create says why in a toast and keeps the tree as the core has it", async () => {
  const { d } = withFolders([UNSORTED], [], {
    createFolder: vi.fn(async () => {
      throw {
        code: "invalid_input",
        message: "A folder with this name already exists.",
      };
    }),
  });
  const { box } = mount(d);
  await flush();
  button(box, "New folder")?.click();
  const input = box.querySelector(".tedit input") as HTMLInputElement;
  input.value = "Work";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  await flush();
  expect(document.querySelector(".toast")?.textContent).toContain(
    "The folder was not created. A folder with this name already exists.",
  );
});

test("a folder delete asks first and says how many bookmarks move to Unsorted; Keep does nothing", async () => {
  const { d } = withFolders(
    [{ ...DEV, count: 3 }, UNSORTED],
    [bm({ id: "a", folderId: DEV.id, folder: "Dev tools" })],
  );
  const { box } = mount(d);
  await flush();
  const row = treeNode(box, "Dev tools").closest(".trow") as HTMLElement;
  (row.querySelector(".tmore") as HTMLButtonElement).click();
  menuItem(row, "Delete").click();
  const dialog = document.querySelector("dialog") as HTMLElement;
  expect(dialog.textContent).toContain('Delete the folder "Dev tools"?');
  expect(dialog.textContent).toContain("3 bookmarks move to Unsorted.");
  button(dialog, "Keep folder")?.click();
  await flush();
  expect(d.deleteFolder).not.toHaveBeenCalled();
});

test("a confirmed folder delete moves its cards to Unsorted at once, and no card is lost", async () => {
  const folders = [{ ...DEV, count: 1 }, UNSORTED];
  const { d } = withFolders(
    folders,
    [
      bm({
        id: "a",
        folderId: DEV.id,
        folder: "Dev tools",
        folderReason: "A tool.",
        folderIsGuess: true,
      }),
    ],
    {
      deleteFolder: vi.fn(async () => {
        folders.shift();
        folders[0] = { ...UNSORTED, count: 1 };
        return 1;
      }),
    },
  );
  const { box } = mount(d);
  await flush();
  const row = treeNode(box, "Dev tools").closest(".trow") as HTMLElement;
  (row.querySelector(".tmore") as HTMLButtonElement).click();
  menuItem(row, "Delete").click();
  button(
    document.querySelector("dialog") as HTMLElement,
    "Delete folder",
  )?.click();
  await flush();
  expect(d.deleteFolder).toHaveBeenCalledWith(DEV.id);
  const card = box.querySelector("article") as HTMLElement;
  expect(card.textContent).toContain("Unsorted");
  expect(card.textContent).not.toContain("A tool.");
  expect(card.querySelector(".lcard-folder")?.textContent).not.toContain(
    "Guess",
  );
  expect(treeNode(box, "Dev tools")).toBeUndefined();
  expect(document.querySelector(".toast")?.textContent).toContain(
    "1 bookmark moved to Unsorted.",
  );
});

test("Move to folder lists the other folders; a move updates the card and offers Undo, and Undo puts it back", async () => {
  const { d } = withFolders([DEV, UNSORTED], [bm({ id: "a" })], {
    undoLast: vi.fn(async () => bm({ id: "a" })),
  });
  const { box } = mount(d);
  await flush();
  const card = box.querySelector("article") as HTMLElement;
  button(card, "Move to folder")?.click();
  const items = [...card.querySelectorAll('[role="menuitem"]')].map(
    (i) => i.textContent,
  );
  expect(items).toEqual(["Dev tools"]);
  menuItem(card, "Dev tools").click();
  await flush();
  expect(d.moveBookmark).toHaveBeenCalledWith("a", DEV.id);
  expect(box.querySelector("article")?.textContent).toContain("Dev tools");
  expect(document.querySelector(".toast")?.textContent).toContain(
    "Moved to Dev tools.",
  );
  toastAction()?.click();
  await flush();
  expect(d.undoLast).toHaveBeenCalledTimes(1);
  expect(box.querySelector("article")?.textContent).toContain("Unsorted");
  expect(box.querySelectorAll("article")).toHaveLength(1);
});

test("a refused move says so and leaves the card where it was", async () => {
  const { d } = withFolders([DEV, UNSORTED], [bm({ id: "a" })], {
    moveBookmark: vi.fn(async () => {
      throw {
        code: "not_found",
        message: "There is no such folder. It may have been deleted.",
      };
    }),
  });
  const { box } = mount(d);
  await flush();
  const card = box.querySelector("article") as HTMLElement;
  button(card, "Move to folder")?.click();
  menuItem(card, "Dev tools").click();
  await flush();
  expect(document.querySelector(".toast")?.textContent).toContain(
    "Mnemo could not move the link. There is no such folder.",
  );
  expect(toastAction()).toBeNull();
  expect(box.querySelector("article")?.textContent).toContain("Unsorted");
});

test("Delete on a card asks for no confirm; the card leaves and a toast offers Undo, which brings it back in date order", async () => {
  const older = bm({
    id: "old",
    createdAt: "2026-11-20T10:00:00Z",
    title: "Older",
  });
  const newer = bm({
    id: "new",
    createdAt: "2026-11-25T10:00:00Z",
    title: "Newer",
  });
  const { d } = withFolders([UNSORTED], [newer, older], {
    undoLast: vi.fn(async () => newer),
  });
  const { box } = mount(d);
  await flush();
  const card = box.querySelector("article") as HTMLElement;
  const del = button(card, "Delete");
  expect(del?.classList.contains("btn-ghost")).toBe(true);
  del?.click();
  await flush();
  expect(document.querySelector("dialog[open]")).toBeNull();
  expect(d.deleteSavedBookmark).toHaveBeenCalledWith("new");
  expect(box.querySelectorAll("article")).toHaveLength(1);
  expect(document.querySelector(".toast")?.textContent).toContain(
    "Link deleted.",
  );
  toastAction()?.click();
  await flush();
  const titles = [...box.querySelectorAll("article")].map((a) =>
    a.textContent?.includes("Newer") ? "Newer" : "Older",
  );
  expect(titles).toEqual(["Newer", "Older"]);
});

test("a second step replaces the toast of the first, so Undo never takes back a step it does not show", async () => {
  const { d } = withFolders(
    [DEV, UNSORTED],
    [bm({ id: "a" }), bm({ id: "b" })],
  );
  const { box } = mount(d);
  await flush();
  const cards = [...box.querySelectorAll("article")];
  button(cards[0] as HTMLElement, "Delete")?.click();
  await flush();
  expect(document.querySelectorAll(".toast-action")).toHaveLength(1);
  button(box.querySelector("article") as HTMLElement, "Delete")?.click();
  await flush();
  expect(document.querySelectorAll(".toast-action")).toHaveLength(1);
  expect(d.deleteSavedBookmark).toHaveBeenCalledTimes(2);
});

test("a failed Undo says why", async () => {
  const { d } = withFolders([UNSORTED], [bm({ id: "a" })], {
    undoLast: vi.fn(async () => {
      throw { code: "invalid_input", message: "There is nothing to undo." };
    }),
  });
  const { box } = mount(d);
  await flush();
  button(box.querySelector("article") as HTMLElement, "Delete")?.click();
  await flush();
  toastAction()?.click();
  await flush();
  expect(document.body.textContent).toContain(
    "Mnemo could not undo. There is nothing to undo.",
  );
});

test("a folder read that fails says so, and the cards still show", async () => {
  const { d } = withFolders([UNSORTED], [bm({ id: "a" })], {
    listFolders: vi.fn(async () => {
      throw { code: "storage_unavailable", message: "Quit and start again." };
    }),
  });
  const { box } = mount(d);
  await flush();
  expect(box.querySelector('[role="alert"]')?.textContent).toContain(
    "Mnemo could not load the folders. Quit and start again.",
  );
  expect(box.querySelectorAll("article")).toHaveLength(1);
});

test("restore puts a deleted link back by its date, and replaces one that is there", () => {
  const a = bm({ id: "a", createdAt: "2026-11-25T10:00:00Z" });
  const b = bm({ id: "b", createdAt: "2026-11-24T10:00:00Z" });
  const c = bm({ id: "c", createdAt: "2026-11-23T10:00:00Z" });
  expect(restore([a, c], b).map((x) => x.id)).toEqual(["a", "b", "c"]);
  expect(restore([a, b], c).map((x) => x.id)).toEqual(["a", "b", "c"]);
  expect(restore([b, c], a).map((x) => x.id)).toEqual(["a", "b", "c"]);
  expect(restore([a, b], { ...b, folder: "X" })[1]?.folder).toBe("X");
});

test("only one move, delete or Undo runs at a time, so a toast always names the step the core holds", async () => {
  let release: () => void = () => {};
  const { d } = withFolders(
    [DEV, UNSORTED],
    [bm({ id: "a" }), bm({ id: "b" })],
    {
      deleteSavedBookmark: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    },
  );
  const { box } = mount(d);
  await flush();
  const [first, second] = [...box.querySelectorAll("article")] as HTMLElement[];
  button(first, "Delete")?.click();
  // A second step while the first is going is ignored, from a Delete and from a Move.
  button(second, "Delete")?.click();
  button(second, "Move to folder")?.click();
  menuItem(second, "Dev tools")?.click();
  expect(d.deleteSavedBookmark).toHaveBeenCalledTimes(1);
  expect(d.moveBookmark).not.toHaveBeenCalled();
  release();
  await flush();
  expect(document.querySelectorAll(".toast-action")).toHaveLength(1);
  // The first step is over: the next one runs.
  button(
    box.querySelector("article") as HTMLElement,
    "Move to folder",
  )?.click();
  menuItem(box, "Dev tools").click();
  await flush();
  expect(d.moveBookmark).toHaveBeenCalledTimes(1);
});

test("a bookmark-changed event never wipes the folder name the owner is typing", async () => {
  let counts = 0;
  const { d, emit } = withFolders([UNSORTED], [bm({ id: "a" })], {
    listFolders: vi.fn(async () => [{ ...UNSORTED, count: counts }]),
  });
  const { box } = mount(d);
  await flush();
  button(box, "New folder")?.click();
  const input = box.querySelector(".tedit input") as HTMLInputElement;
  input.value = "Wor";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  // The counts change while the owner types.
  counts = 5;
  emit(bm({ id: "b", createdAt: "2026-11-26T10:00:00Z" }));
  await flush();
  const still = box.querySelector(".tedit input") as HTMLInputElement;
  expect(still).toBe(input);
  expect(still.value).toBe("Wor");
  // The owner cancels; the next refresh draws the tree with the new counts.
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  emit(bm({ id: "c", createdAt: "2026-11-27T10:00:00Z" }));
  await flush();
  expect(box.querySelector(".tedit")).toBeNull();
  expect(treeNode(box, "Unsorted").textContent).toContain("5");
});
