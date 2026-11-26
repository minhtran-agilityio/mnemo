// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import type { Page, SavedBookmark, SaveResult } from "../../shared/api";
import { type BookmarksDeps, renderBookmarks } from "./bookmarks";
import {
  actionsFor,
  moveToTop,
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
    ...over,
  };
}

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
  const shown = [...card.querySelectorAll(".lcard-action button")];
  expect(shown.map((b) => b.textContent?.trim())).toEqual([
    "Summarize later",
    "Paste the text",
  ]);
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
  // The next save clears the note.
  d.saveLink = vi.fn(async (url: string) => res({ id: "n2", url }));
  (box.querySelector("input") as HTMLInputElement).value = "https://c.example/";
  box.querySelector("form")?.dispatchEvent(new Event("submit"));
  await flush();
  expect(box.textContent).not.toContain("Already saved");
});
