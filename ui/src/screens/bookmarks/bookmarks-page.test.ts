// @vitest-environment happy-dom
// The Bookmarks page of #27 (BM-03): folder sections, the three views, search, the needs-a-look bar,
// the open dialog, the saved view and the paging of the whole list.
import { expect, test, vi } from "vitest";
import type { Cursor, Folder, Page, SavedBookmark } from "../../shared/api";
import { type BookmarksDeps, renderBookmarks } from "./bookmarks";
import {
  groupByFolder,
  matchesSearch,
  needsLook,
  needsLookLine,
  parseView,
} from "./bookmarks-logic";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const FOLDERS: Folder[] = [
  { id: "f-a", name: "Research", isDefault: false, count: 0 },
  { id: "f-b", name: "Recipes", isDefault: false, count: 0 },
  { id: "f-u", name: "Unsorted", isDefault: true, count: 0 },
];
const pad = (n: number) => String(n).padStart(4, "0");

/** Bookmark `n`: newest first by number, folder by n % 3, a summary unless n is a multiple of 5. */
function bm(n: number, over: Partial<SavedBookmark> = {}): SavedBookmark {
  const f = FOLDERS[n % 3] as Folder;
  const none = n % 5 === 0;
  const at = new Date(
    Date.UTC(2026, 10, 27, 12, 0, 0) - n * 60000,
  ).toISOString();
  return {
    id: `bm-${pad(n)}`,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    url: `https://example.org/item-${pad(n)}`,
    title: `Item ${pad(n)} title`,
    site: "example.org",
    summary: none ? null : `Summary text number ${pad(n)}.`,
    reason: none ? null : "It may matter.",
    reasonIsGuess: !none,
    summaryStatus: none ? "unreadable" : "done",
    tags: none ? [] : [`tag${n % 7}`],
    labels: [],
    folderId: f.id,
    folder: f.name,
    folderReason: null,
    folderIsGuess: false,
    ...over,
  };
}

const many = (count: number, make = bm) =>
  Array.from({ length: count }, (_, i) => make(i + 1));

/** A core stand-in: pages of at most `limit`, newest first; folder counts from the live data. */
function core(all: SavedBookmark[], over: Partial<BookmarksDeps> = {}) {
  const settings = new Map<string, string>();
  const sorted = [...all].sort((a, z) =>
    z.createdAt.localeCompare(a.createdAt),
  );
  const d: BookmarksDeps = {
    saveLink: vi.fn(),
    summarizeBookmark: vi.fn(),
    listBookmarkCards: vi.fn(
      async (args: { limit: number; after?: Cursor | null }) => {
        const start = args.after
          ? sorted.findIndex((b) => b.id === args.after?.id) + 1
          : 0;
        const items = sorted.slice(start, start + args.limit);
        const last = items[items.length - 1];
        const next =
          start + args.limit < sorted.length && last
            ? { createdAt: last.createdAt, id: last.id }
            : null;
        return { items, next } as Page<SavedBookmark>;
      },
    ),
    onBookmarkChanged: vi.fn(async () => () => {}),
    listFolders: vi.fn(async () =>
      FOLDERS.map((f) => ({
        ...f,
        count: all.filter((b) => b.folderId === f.id).length,
      })),
    ),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    moveBookmark: vi.fn(),
    deleteSavedBookmark: vi.fn(),
    undoLast: vi.fn(),
    getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
    setSetting: vi.fn(async (key: string, value: string) => {
      settings.set(key, value);
    }),
    openLink: vi.fn(async () => {}),
    ...over,
  };
  return { d, settings };
}

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** Past the search delay and the loading calls. */
const settle = () => wait(200);

async function open(all: SavedBookmark[], over: Partial<BookmarksDeps> = {}) {
  const { d, settings } = core(all, over);
  const box = document.createElement("main");
  document.body.replaceChildren(box);
  const leave = renderBookmarks(box, d);
  await settle();
  return { d, box, leave, settings };
}

/** The numbers of the bookmarks whose title is shown, in order. */
function shown(box: HTMLElement): number[] {
  return [...box.querySelectorAll(".link-open")].map((b) =>
    Number(/Item (\d+) title/.exec(b.textContent ?? "")?.[1]),
  );
}

const row = (box: HTMLElement, name: string) =>
  [...box.querySelectorAll<HTMLElement>(".tnode")].find(
    (n) => n.querySelector(".tname")?.textContent === name,
  ) as HTMLElement;
const count = (box: HTMLElement, name: string) =>
  Number(row(box, name)?.querySelector(".cnt")?.textContent);
const radio = (box: HTMLElement, name: string) =>
  [...box.querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (b) => b.textContent === name,
  ) as HTMLElement;
const button = (root: ParentNode, name: string) =>
  [...root.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  );
const searchBox = (box: HTMLElement) =>
  box.querySelector<HTMLInputElement>(
    'input[type="search"]',
  ) as HTMLInputElement;

async function typeSearch(box: HTMLElement, words: string) {
  const input = searchBox(box);
  input.value = words;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}

const byFolder = (all: SavedBookmark[], id: string) =>
  all.filter((b) => b.folderId === id).map((b) => Number(b.id.slice(3)));

// ---- logic ----

test("a saved view is one of the three, and anything else is Cards", () => {
  expect(parseView("list")).toBe("list");
  expect(parseView("compact")).toBe("compact");
  expect(parseView("cards")).toBe("cards");
  for (const bad of [null, undefined, "", "grid", "LIST"])
    expect(parseView(bad)).toBe("cards");
});

test("only a null summary needs a look, and a deleted link never does", () => {
  expect(needsLook(bm(5))).toBe(true);
  expect(needsLook(bm(1))).toBe(false);
  expect(needsLook(bm(5, { deletedAt: "2026-11-27T12:00:00Z" }))).toBe(false);
  expect(needsLook(bm(1, { summary: "", summaryStatus: "done" }))).toBe(false);
});

test("the needs-a-look line is singular for one link", () => {
  expect(needsLookLine(1)).toBe("1 link has no summary");
  expect(needsLookLine(20)).toBe("20 links have no summary");
});

test("search matches title, summary and tags, in any case and any Unicode form, and keeps accents", () => {
  const b = bm(1, {
    title: "Phở at home",
    summary: `Quán ${"phở".normalize("NFD")} ngon`,
    tags: ["noodles"],
  });
  for (const q of [
    "pHỞ",
    "phở".normalize("NFD"),
    "QUÁN",
    "noodles",
    "home ngon",
  ])
    expect(matchesSearch(b, q), q).toBe(true);
  for (const q of ["pho", "quan", "noodle soup"])
    expect(matchesSearch(b, q), q).toBe(false);
  expect(matchesSearch(b, "   ")).toBe(true);
});

test("a stored summary is searched whatever the status of the link", () => {
  const b = bm(1, { summary: "stored words", summaryStatus: "reading" });
  expect(matchesSearch(b, "stored")).toBe(true);
  expect(matchesSearch(bm(1, { summary: null }), "stored")).toBe(false);
});

test("bookmarks group by folder in the folders' order with the core's counts", () => {
  const all = many(6);
  const folders = FOLDERS.map((f) => ({ ...f, count: 10 }));
  const groups = groupByFolder(all, folders);
  expect(groups.map((g) => g.name)).toEqual([
    "Research",
    "Recipes",
    "Unsorted",
  ]);
  expect(groups.map((g) => g.count)).toEqual([10, 10, 10]);
  expect(groups.flatMap((g) => g.items)).toHaveLength(6);
  // A folder not read yet still groups its links, with the number loaded as its count.
  const early = groupByFolder([bm(1)], []);
  expect(early).toHaveLength(1);
  expect(early[0]).toMatchObject({ name: "Recipes", count: 1 });
});

// ---- the page ----

test("All bookmarks shows a section per folder: its 4 newest links and Show all N, which opens the folder", async () => {
  const all = many(30);
  const { box } = await open(all);
  const sections = [...box.querySelectorAll(".bookmarks-section")];
  expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual([
    "Research",
    "Recipes",
    "Unsorted",
  ]);
  const want = FOLDERS.flatMap((f) => byFolder(all, f.id).slice(0, 4));
  expect(shown(box)).toEqual(want);
  expect(button(box, "Show all 10")).toBeDefined();

  // "Show all N" opens the folder: all its links, and no more section.
  button(box, "Show all 10")?.click();
  expect(shown(box)).toEqual(byFolder(all, "f-a"));
  expect(box.querySelectorAll(".bookmarks-section")).toHaveLength(1);
  expect(row(box, "Research").getAttribute("aria-current")).toBe("true");
});

test("picking a folder shows all its links, and its count is the number shown", async () => {
  const all = many(60);
  const { box } = await open(all);
  for (const f of FOLDERS) {
    row(box, f.name).click();
    const n = count(box, f.name);
    expect(n).toBe(byFolder(all, f.id).length);
    expect(shown(box)).toEqual(byFolder(all, f.id));
    expect(shown(box)).toHaveLength(n);
  }
  row(box, "All bookmarks").click();
  expect(count(box, "All bookmarks")).toBe(60);
});

test("List, Cards and Compact show the same links in the same order", async () => {
  const all = many(40);
  const { box } = await open(all);
  row(box, "Research").click();
  const seen: number[][] = [];
  for (const view of ["List", "Cards", "Compact"]) {
    radio(box, view).click();
    expect(radio(box, view).getAttribute("aria-checked")).toBe("true");
    seen.push(shown(box));
  }
  expect(seen[0]).toEqual(byFolder(all, "f-a"));
  expect(seen[1]).toEqual(seen[0]);
  expect(seen[2]).toEqual(seen[0]);
  // The shape differs: a grid of cards, and a list of rows.
  expect(box.querySelector(".compact, .list")).not.toBeNull();
});

test("the chosen view is saved as bookmarks.view and read again on the next visit", async () => {
  const { d, box, settings } = await open(many(5));
  expect(d.getSetting).toHaveBeenCalledWith("bookmarks.view");
  expect(radio(box, "Cards").getAttribute("aria-checked")).toBe("true");
  radio(box, "Compact").click();
  radio(box, "List").click();
  await wait();
  expect(d.setSetting).toHaveBeenNthCalledWith(1, "bookmarks.view", "compact");
  expect(d.setSetting).toHaveBeenNthCalledWith(2, "bookmarks.view", "list");
  expect(settings.get("bookmarks.view")).toBe("list");

  const next = document.createElement("main");
  document.body.replaceChildren(next);
  renderBookmarks(next, d);
  await settle();
  expect(radio(next, "List").getAttribute("aria-checked")).toBe("true");
  expect(radio(next, "Cards").getAttribute("aria-checked")).toBe("false");
});

test("a failed save of the view says so, and the view stays chosen", async () => {
  const { box } = await open(many(3), {
    setSetting: vi.fn(async () => {
      throw { code: "storage_error", message: "No disk." };
    }),
  });
  radio(box, "List").click();
  await wait();
  expect(document.body.textContent).toContain("could not save the view");
  expect(radio(box, "List").getAttribute("aria-checked")).toBe("true");
});

test("a saved view that is not one of the three gives Cards", async () => {
  const { box } = await open(many(3), {
    getSetting: vi.fn(async () => "grid"),
  });
  expect(radio(box, "Cards").getAttribute("aria-checked")).toBe("true");
});

test("the bar counts the links with a null summary and Show them lists exactly those", async () => {
  const all = many(50);
  const none = all
    .filter((b) => b.summary === null)
    .map((b) => Number(b.id.slice(3)));
  const { box } = await open(all);
  expect(box.querySelector(".bookmarks-bar")?.textContent).toContain(
    `${none.length} links have no summary`,
  );
  expect(count(box, "Needs a look")).toBe(none.length);
  button(box, "Show them")?.click();
  for (const view of ["List", "Cards", "Compact"]) {
    radio(box, view).click();
    expect([...shown(box)].sort((a, z) => a - z)).toEqual(none);
  }
  // On the filter itself the bar has nothing to add; the cards keep their actions.
  expect(box.querySelector(".bookmarks-bar")?.textContent).toBe("");
  radio(box, "Cards").click();
  expect(button(box, "Paste the text")).toBeDefined();
});

test("the bar and the row are gone when every link has a summary", async () => {
  const { box } = await open(
    many(8, (n) => bm(n, { summary: "S", summaryStatus: "done" })),
  );
  expect(box.querySelector(".bookmarks-bar")?.textContent).toBe("");
  expect(row(box, "Needs a look")).toBeUndefined();
});

test("the needs-a-look count is not claimed before every page is loaded", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const all = many(150);
  const base = core(all).d.listBookmarkCards;
  const { box } = await open(all, {
    listBookmarkCards: vi.fn(async (args) => {
      if (args.after) await gate;
      return base(args);
    }),
  });
  expect(shown(box).length).toBeGreaterThan(0);
  expect(row(box, "Needs a look")).toBeUndefined();
  expect(box.querySelector(".bookmarks-bar")?.textContent).toBe("");
  release?.();
  await settle();
  expect(count(box, "Needs a look")).toBe(
    all.filter((b) => b.summary === null).length,
  );
});

test("search finds a link by a word only in its summary, case does not matter", async () => {
  const all = many(60, (n) =>
    n === 37 ? bm(n, { summary: "A note about zephyrine only." }) : bm(n),
  );
  const { box } = await open(all);
  await typeSearch(box, "ZEPHYRINE");
  for (const view of ["List", "Cards", "Compact"]) {
    radio(box, view).click();
    expect(shown(box)).toEqual([37]);
  }
  await typeSearch(box, "");
  expect(shown(box).length).toBeGreaterThan(1);
});

test("search finds a title word and a tag, and says so when nothing matches", async () => {
  const all = many(30, (n) =>
    n === 12
      ? bm(n, { title: "Item 0012 title marmalade" })
      : n === 14
        ? bm(n, { tags: ["quokka"] })
        : bm(n),
  );
  const { box } = await open(all);
  await typeSearch(box, "marmalade");
  expect(shown(box)).toEqual([12]);
  await typeSearch(box, "quokka");
  expect(shown(box)).toEqual([14]);
  await typeSearch(box, "no such word");
  expect(shown(box)).toEqual([]);
  expect(box.querySelector(".bookmarks-list")?.textContent).toContain(
    "No bookmark matches",
  );
});

test("search matches Vietnamese in any Unicode form and does not ignore the accents", async () => {
  const all = many(30, (n) =>
    n === 7
      ? bm(n, { summary: `Quán ${"phở".normalize("NFD")} ngon` })
      : n === 8
        ? bm(n, { summary: "Quan pho ngon" })
        : bm(n),
  );
  const { box } = await open(all);
  await typeSearch(box, "phở".normalize("NFC"));
  expect(shown(box)).toEqual([7]);
  await typeSearch(box, "PHỞ".normalize("NFD"));
  expect(shown(box)).toEqual([7]);
  await typeSearch(box, "pho");
  expect(shown(box)).toEqual([8]);
});

test("search stays inside the folder or filter chosen, and the folder counts stay the full counts", async () => {
  const all = many(60, (n) =>
    n === 37 ? bm(n, { summary: "zephyrine" }) : bm(n),
  );
  const full = FOLDERS.map((f) => byFolder(all, f.id).length);
  const { box } = await open(all);
  const owner = FOLDERS.find((f) => f.id === bm(37).folderId) as Folder;
  const other = FOLDERS.find((f) => f.id !== owner.id) as Folder;
  row(box, other.name).click();
  await typeSearch(box, "zephyrine");
  expect(shown(box)).toEqual([]);
  row(box, owner.name).click();
  expect(shown(box)).toEqual([37]);
  expect(FOLDERS.map((f) => count(box, f.name))).toEqual(full);
  // The needs-a-look filter has its own pool: a link with a summary is not in it.
  row(box, "Needs a look").click();
  expect(shown(box)).toEqual([]);
});

test("a click or Enter on a link opens its card; Open in browser asks the core to open it by id", async () => {
  const all = many(12, (n) =>
    n === 4 ? bm(n, { summary: "Words with zephyrine inside." }) : bm(n),
  );
  const { d, box } = await open(all);
  row(box, bm(4).folder).click();
  const title = [...box.querySelectorAll<HTMLElement>(".link-open")].find((b) =>
    b.textContent?.includes("Item 0004"),
  ) as HTMLElement;
  title.click();
  const dialog = document.querySelector("dialog") as HTMLDialogElement;
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain("Item 0004 title");
  expect(dialog.textContent).toContain("zephyrine");
  button(dialog, "Open in browser")?.click();
  await wait();
  expect(d.openLink).toHaveBeenCalledTimes(1);
  expect(d.openLink).toHaveBeenCalledWith("bm-0004");
  // The page passes an id only: no link, and no opener plugin call.
  const { invoke } = await import("@tauri-apps/api/core");
  expect(invoke).not.toHaveBeenCalled();
  button(dialog, "Close")?.click();
  expect(document.querySelector("dialog")).toBeNull();
});

test("a link that cannot be opened says why inside the dialog and keeps it open", async () => {
  const { box } = await open(many(6), {
    openLink: vi.fn(async () => {
      throw { code: "open_link_failed", message: "Copy it from the card." };
    }),
  });
  (box.querySelector(".link-open") as HTMLElement).click();
  const dialog = document.querySelector("dialog") as HTMLElement;
  button(dialog, "Open in browser")?.click();
  await wait();
  // The dialog is modal, so the message must be inside it, not in a toast behind it.
  const dialogNow = document.querySelector("dialog") as HTMLElement;
  expect(dialogNow.textContent).toContain("Copy it from the card.");
  expect(dialogNow.querySelector('[role="alert"]')).not.toBeNull();
  expect(document.querySelector(".toast")).toBeNull();
});

test("an action button on a card does not open the dialog", async () => {
  const { box } = await open(many(10));
  row(box, "Needs a look").click();
  button(box, "Paste the text")?.click();
  const dialogs = [...document.querySelectorAll("dialog")];
  expect(dialogs.some((d) => d.textContent?.includes("Page text"))).toBe(true);
  expect(dialogs.some((d) => d.textContent?.includes("Open in browser"))).toBe(
    false,
  );
});

test("the page reads every page of the list until the core has no more", async () => {
  const all = many(250);
  const { d, box } = await open(all);
  const calls = (d.listBookmarkCards as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls).toHaveLength(3);
  expect(calls[0]?.[0]).toMatchObject({ limit: 100, after: null });
  expect(calls[1]?.[0].after).toBeTruthy();
  expect(FOLDERS.map((f) => count(box, f.name))).toEqual(
    FOLDERS.map((f) => byFolder(all, f.id).length),
  );
  row(box, "Research").click();
  expect(shown(box)).toEqual(byFolder(all, "f-a"));
});

test("a failed page says so and keeps what was loaded", async () => {
  const all = many(150);
  const base = core(all).d.listBookmarkCards;
  const { box } = await open(all, {
    listBookmarkCards: vi.fn(async (args) => {
      if (args.after) throw { code: "storage_error", message: "Disk is busy." };
      return base(args);
    }),
  });
  expect(box.textContent).toContain("could not load the saved links");
  expect(shown(box).length).toBeGreaterThan(0);
  expect(row(box, "Needs a look")).toBeUndefined();
});

test("a failed first load shows the problem and no loading line, and no empty library", async () => {
  const { box } = await open(many(5), {
    listBookmarkCards: vi.fn(async () => {
      throw { code: "storage_error", message: "boom" };
    }),
  });
  expect(box.textContent).toContain("could not load the saved links. boom");
  expect(box.textContent).not.toContain("Loading your bookmarks");
  expect(box.textContent).not.toContain("No saved links yet");
});

test("an empty library and an empty folder say what to do next", async () => {
  const { box } = await open([]);
  expect(box.querySelector(".bookmarks-list")?.textContent).toContain(
    "No saved links yet",
  );
  const some = await open(many(1));
  row(some.box, "Unsorted").click();
  expect(some.box.querySelector(".bookmarks-list")?.textContent).toContain(
    "No bookmarks here yet",
  );
});

test("the title line counts the links and the folders that hold some", async () => {
  const { box } = await open(many(7));
  expect(box.querySelector("header")?.textContent).toContain(
    "7 bookmarks in 3 folders.",
  );
});

// ---- 500 bookmarks (decision 9: every row is drawn; a render-time budget) ----

/** The time one view of 500 links may take to draw. Generous: happy-dom is slower than a browser. */
const RENDER_BUDGET_MS = 4000;

test("renders 500 bookmarks in each view within the render-time budget and draws every row", async () => {
  const all = many(500, (n) => bm(n, { folderId: "f-a", folder: "Research" }));
  const { box } = await open(all);
  row(box, "Research").click();
  const want = byFolder(all, "f-a");
  for (const view of ["List", "Cards", "Compact"]) {
    const t0 = performance.now();
    radio(box, view).click();
    const ms = performance.now() - t0;
    expect(shown(box), view).toEqual(want);
    expect(ms, `${view} took ${Math.round(ms)} ms`).toBeLessThan(
      RENDER_BUDGET_MS,
    );
  }
  expect(box.querySelectorAll(".bookmarks-list .link-open")).toHaveLength(500);
});

test("500 bookmarks load in pages of 100 and every folder count equals what its folder shows", async () => {
  const all = many(500);
  const { d, box } = await open(all);
  expect(
    (d.listBookmarkCards as ReturnType<typeof vi.fn>).mock.calls,
  ).toHaveLength(5);
  for (const f of FOLDERS) {
    row(box, f.name).click();
    expect(shown(box)).toHaveLength(count(box, f.name));
  }
  expect(count(box, "Needs a look")).toBe(100);
});
