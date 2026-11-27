// The Bookmarks page (#25 BM-01, #26 BM-02, #27 BM-03): a link box, a folder list with counts, the
// saved links in three views (List, Cards, Compact; the chosen one is kept after a restart), a search
// box, a bar for the links that have no summary, and a dialog with the full card of a link.
//
// #27: "All bookmarks" shows one section per folder (Unsorted last) with its count, its 4 newest
// links and "Show all N". A folder, or "Needs a look", shows all its links. The page loads every
// bookmark through the paged `list_bookmark_cards` and filters in the screen: search is on the
// title, summary and tags, within the folder or filter chosen; folder counts stay the full counts
// from the core. Every row is drawn (no virtual scrolling). A click, or Enter on a row or card,
// opens the link card in a dialog whose "Open in browser" asks the core (`open_link`) to open the
// stored link; the UI has no opener permission.
//
// Save stores the link at once in the core; the card then follows the core's bookmark-changed
// events (reading, then done, link only or no summary yet). A link the core could not read
// offers "Paste the text"; a link with no summary yet offers "Summarize later". A link whose page
// could not be reached for now offers both (owner decision), in the link card's action slot (UI
// request issue 179). Folders (#26): a folder tree beside the cards (the owner creates, renames and
// deletes folders from the menu of each row; Unsorted is fixed), "Move to folder" and "Delete" on
// each card, and a toast with Undo after a move or a delete (the core keeps one step). Every part
// comes from ui/src/ds; bookmarks.css lays them out. All text goes in as text.
import {
  buildBanner,
  buildBusyLine,
  buildEmptyState,
  createButton,
  createConfirmDialog,
  createDialog,
  createDialogButton,
  createField,
  createFolderHeading,
  createLinkCard,
  createLinkView,
  createMenu,
  createPageHeader,
  createSearch,
  createSegmented,
  createTextarea,
  createTextInput,
  createToastRegion,
  createTree,
  type LinkItem,
  type LinkView,
  setFieldError,
  type TreeActionEvent,
  type TreeNode,
} from "../../ds";
import { findItem } from "../../frame/nav";
import {
  type Cursor,
  errorMessage,
  type Folder,
  isAppError,
  type Page,
  type SavedBookmark,
  type SaveResult,
} from "../../shared/api";
import {
  ACTION_LABELS,
  actionsFor,
  bookmarkCount,
  type CardAction,
  groupByFolder,
  matchesSearch,
  moveToTop,
  needsLook,
  needsLookLine,
  newestFirst,
  parseView,
  restore,
  SECTION_FIRST,
  toLinkItem,
  UNSORTED_REFUSED,
  upsert,
  VIEW_LABELS,
  VIEW_SETTING,
} from "./bookmarks-logic";

/** The calls the screen makes; main.ts passes the typed client from shared/api. */
export interface BookmarksDeps {
  saveLink(url: string): Promise<SaveResult>;
  summarizeBookmark(id: string, pastedText?: string): Promise<SaveResult>;
  listBookmarkCards(args: {
    limit: number;
    after?: Cursor | null;
  }): Promise<Page<SavedBookmark>>;
  onBookmarkChanged(
    handler: (bookmark: SavedBookmark) => void,
  ): Promise<() => void>;
  listFolders(): Promise<Folder[]>;
  createFolder(name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<Folder>;
  /** Deletes the folder; its links move to Unsorted. Gives how many live links moved. */
  deleteFolder(id: string): Promise<number>;
  moveBookmark(id: string, folderId: string): Promise<SavedBookmark>;
  deleteSavedBookmark(id: string): Promise<void>;
  /** Takes back the last move or delete (the core keeps one step). */
  undoLast(): Promise<SavedBookmark>;
  /** A saved setting (null when never saved); the page reads `bookmarks.view`. */
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  /** Opens the stored link of the bookmark in the system browser (the core checks it). */
  openLink(id: string): Promise<void>;
}

/** How many saved links one call reads. The page asks again until the core has no more (#27). */
export const BOOKMARKS_PAGE = 100;

/** What the page shows: every folder in sections, one folder, or the links with no summary. */
type Selection =
  | { kind: "all" }
  | { kind: "folder"; id: string }
  | { kind: "needs" };

/** How long the search box waits after a key, so a long list is not drawn for every letter. */
const SEARCH_DELAY_MS = 120;

/** The line under the title until the folders are read. */
const HEADER_CONTEXT =
  "Paste a link and save it. Mnemo stores it at once, reads the page, and adds a summary, tags and a reason. AI text is labelled.";

/** What the status region says when the owner saves a link that is already saved (#28). */
const ALREADY_SAVED_ANNOUNCEMENT =
  "This link was already saved. Its card is now on top.";

/** Fills `container` with the Bookmarks screen. Returns a function that cleans up on leave. */
export function renderBookmarks(
  container: HTMLElement,
  deps: BookmarksDeps,
): () => void {
  const doc = container.ownerDocument;
  // The folder tree beside the cards needs more than the reading width, as the Ideas board does.
  container.dataset.layout = "wide";
  let left = false;
  let unlisten: (() => void) | null = null;
  // The one place this screen keeps its state: the saved links, newest first.
  let items: SavedBookmark[] = [];
  /**
   * The bookmark the owner just saved again (#28): its card shows "Already saved" on top. It
   * clears when the owner saves the next link.
   */
  let alreadySavedId: string | null = null;
  /** Bookmarks with a summary call going, so their action is not sent twice. */
  const busy = new Set<string>();
  /**
   * A move, a delete or an Undo is going. The core keeps one Undo step, so only one of them runs
   * at a time: the toast of a step then always names the step the core holds.
   */
  let stepRunning = false;
  /** The folder tree was not redrawn because a name field was open; redraw when it closes. */
  let treeStale = false;
  /** The folders, Unsorted last; the core counts their live links. */
  let folders: Folder[] = [];
  /** Closes the toast of the last move or delete, so its Undo never takes back a later step. */
  let dismissUndo: (() => void) | null = null;
  /** Ends the menus of the cards drawn last (their listeners go when the list is drawn again). */
  let cardMenus = new AbortController();
  /** Ends the folder tree's listeners when the screen is left. */
  const stop = new AbortController();
  /** What the page shows now (the sidebar picks it). */
  let selection: Selection = { kind: "all" };
  /** The words in the search box, as typed. */
  let query = "";
  /** The chosen view, once the saved one is read (nothing is drawn before). */
  let view: LinkView = "cards";
  let viewReady = false;
  /** True once every page of bookmarks is loaded: only then is the needs-a-look count whole. */
  let loaded = false;
  /** The bookmark behind each link item drawn, so an open or an action finds its bookmark. */
  const byItem = new Map<LinkItem, SavedBookmark>();
  /** The sidebar as last drawn; it is built again only when this changes. */
  let sideKey = "";
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  const toasts = createToastRegion();
  const phase = findItem("bookmarks")?.phase;
  // The search box: on the title, summary and tags of the links of the folder or filter shown.
  const search = createSearch(doc, { placeholder: "Search your bookmarks" });
  search.input.setAttribute("aria-label", "Search your bookmarks");
  search.input.autocomplete = "off";
  search.input.spellcheck = false;
  search.input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = search.input.value;
      draw();
    }, SEARCH_DELAY_MS);
  });
  const header = createPageHeader({
    doc,
    title: "Bookmarks",
    crumb: phase === undefined ? undefined : `Phase ${phase}`,
    context: HEADER_CONTEXT,
  });
  const context = header.querySelector(".context");

  // The link box: a labelled field and the Save link button, in a form so Enter saves too.
  const input = createTextInput(doc, { type: "url" });
  input.autocomplete = "off";
  input.spellcheck = false;
  const save = createButton(doc, { label: "Save link", variant: "primary" });
  save.type = "submit";
  const field = createField(doc, {
    label: "Link",
    control: input,
    hint: "A web link that starts with http:// or https://.",
    action: save,
  });
  const form = doc.createElement("form");
  form.className = "bookmarks-linkbox";
  form.noValidate = true;
  form.append(field);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });

  const notice = doc.createElement("div");
  notice.className = "bookmarks-notice";
  // The needs-a-look bar: links with no summary, and "Show them".
  const bar = doc.createElement("div");
  bar.className = "bookmarks-bar";
  const list = doc.createElement("div");
  list.className = "bookmarks-list";
  list.setAttribute("aria-label", "Saved links");
  list.setAttribute("role", "region");
  // The view control (built when the saved view is read) and the search box, above the links. The
  // search box comes after the link box in the page, so the link box stays the first field.
  const viewSlot = doc.createElement("div");
  viewSlot.className = "bookmarks-view";
  const tools = doc.createElement("div");
  tools.className = "bookmarks-tools";
  tools.append(viewSlot, search.wrap);
  const side = doc.createElement("div");
  side.className = "bookmarks-folders";
  side.setAttribute("aria-label", "Folders");
  side.setAttribute("role", "region");
  const main = doc.createElement("div");
  main.className = "bookmarks-main";
  main.append(tools, list);
  const body = doc.createElement("div");
  body.className = "bookmarks-body";
  body.append(side, main);
  container.replaceChildren(header, form, notice, bar, body, toasts.element);

  function showProblem(message: string | null): void {
    notice.replaceChildren(
      ...(message ? [buildBanner({ tone: "bad", message })] : []),
    );
  }

  /** Saves the link in the box. The box clears at once, so the next link can be pasted. */
  function submit(): void {
    const url = input.value.trim();
    if (!url) {
      setFieldError(field, "Paste a link first.");
      input.focus();
      return;
    }
    setFieldError(field, null);
    showProblem(null);
    input.value = "";
    alreadySavedId = null;
    deps
      .saveLink(url)
      .then((result) => {
        if (left) return;
        if (result.alreadySaved) {
          // The old card goes to the top with its note; no row is added and no summary starts.
          alreadySavedId = result.id;
          items = moveToTop(items, result);
          draw();
          // The card's note is not a live region: announce the result through the toast region.
          toasts.show(ALREADY_SAVED_ANNOUNCEMENT);
        } else {
          put(result);
        }
        if (result.aiError) toasts.show(result.aiError.message);
      })
      .catch((error: unknown) => {
        if (left) return;
        // A refused link goes back in the box with the reason, unless something new was typed.
        if (isAppError(error) && error.code === "invalid_input") {
          if (!input.value) input.value = url;
          setFieldError(field, error.message);
          input.focus();
        } else {
          showProblem(`Mnemo could not save the link. ${errorMessage(error)}`);
        }
      });
  }

  function put(b: SavedBookmark): void {
    items = upsert(items, b);
    draw();
  }

  /** "Paste the text": a dialog with a labelled text area; Make summary sends the text. */
  function openPaste(b: SavedBookmark, opener: HTMLElement): void {
    const area = createTextarea(doc);
    const pasteField = createField(doc, {
      label: "Page text",
      control: area,
      hint: "Copy the text of the page in your browser and paste it here. Mnemo makes the summary from this text only.",
    });
    const dialog = createDialog({
      doc,
      title: "Paste the text",
      children: [pasteField],
      actions: (close) => [
        createDialogButton("Cancel", "default", close, doc),
        createDialogButton(
          "Make summary",
          "primary",
          () => {
            const text = area.value.trim();
            if (!text) {
              setFieldError(pasteField, "Paste the text of the page first.");
              area.focus();
              return;
            }
            close();
            run(b.id, text);
          },
          doc,
        ),
      ],
      onClose: () => dialog.element.remove(),
    });
    dialog.open(opener);
    area.focus();
  }

  /** Asks the core for the summary of `id`: from pasted text, or by reading the page again. */
  function run(id: string, pastedText?: string): void {
    if (busy.has(id)) return;
    busy.add(id);
    draw();
    deps
      .summarizeBookmark(id, pastedText)
      .then((result) => {
        if (left) return;
        busy.delete(id);
        put(result);
        if (result.aiError) toasts.show(result.aiError.message);
      })
      .catch((error: unknown) => {
        if (left) return;
        busy.delete(id);
        draw();
        toasts.show(`Mnemo could not make the summary. ${errorMessage(error)}`);
      });
  }

  // ---- folders (#26) ----

  /** The Unsorted folder, once the folders are read. */
  function unsorted(): Folder | undefined {
    return folders.find((f) => f.isDefault);
  }

  function folderNodes(): TreeNode[] {
    return folders.map((f) => ({
      id: f.id,
      label: f.name,
      kind: "folder",
      count: f.count,
      current: selection.kind === "folder" && selection.id === f.id,
      ...(f.isDefault ? { refused: UNSORTED_REFUSED } : {}),
    }));
  }

  /** The links with no summary among the bookmarks loaded (live ones only). */
  function needsCount(): number {
    return items.filter(needsLook).length;
  }

  /** "All bookmarks" and, when some link has no summary, "Needs a look": the two views of the list. */
  function viewNodes(): TreeNode[] {
    const total = folders.reduce((sum, f) => sum + f.count, 0);
    const nodes: TreeNode[] = [
      {
        id: "all",
        label: "All bookmarks",
        kind: "folder",
        count: total,
        current: selection.kind === "all",
      },
    ];
    // The count is whole only when every page is loaded; before that no row claims a number.
    const needs = needsCount();
    if (loaded && needs > 0)
      nodes.push({
        id: "needs",
        label: "Needs a look",
        kind: "folder",
        count: needs,
        current: selection.kind === "needs",
      });
    return nodes;
  }

  /** The owner picked a row of the sidebar: show it, and draw the sidebar and the list again. */
  function select(next: Selection): void {
    selection = next;
    draw();
    // The tree that was clicked is built again; keep keyboard focus on the chosen row.
    side
      .querySelector<HTMLElement>('.tnode[aria-current="true"]')
      ?.focus({ preventScroll: true });
  }

  /**
   * Draws the sidebar: the two views, then the folder tree. Built again only when its data
   * changed, and never while a name field is open (it catches up when the field closes).
   */
  function drawFolders(): void {
    const nodes = [...viewNodes(), ...folderNodes()];
    const key = JSON.stringify(nodes);
    if (key === sideKey && !treeStale) return;
    if (nameFieldOpen()) {
      treeStale = true;
      return;
    }
    treeStale = false;
    sideKey = key;
    side.replaceChildren(
      createTree(doc, "Views", viewNodes(), (label) =>
        select(label === "Needs a look" ? { kind: "needs" } : { kind: "all" }),
      ),
      createTree(
        doc,
        "Folders",
        folderNodes(),
        (label) => {
          const f = folders.find((x) => x.name === label);
          if (f) select({ kind: "folder", id: f.id });
        },
        {
          noun: "folder",
          flat: true,
          onAction: folderAction,
          signal: stop.signal,
        },
      ),
    );
  }

  /** True while the owner types a folder name (a new folder or a rename) in the tree. */
  function nameFieldOpen(): boolean {
    return side.querySelector(".tedit") !== null;
  }

  /** Reads the folders again, then fits the cards to them (a renamed folder, new counts). */
  async function refreshFolders(): Promise<void> {
    let next: Folder[];
    try {
      const read: unknown = await deps.listFolders();
      // The core always answers with a list; anything else is treated as no folders, so a
      // malformed answer can never break the cards.
      next = Array.isArray(read) ? (read as Folder[]) : [];
    } catch (error) {
      if (!left)
        showProblem(`Mnemo could not load the folders. ${errorMessage(error)}`);
      return;
    }
    if (left) return;
    const same = JSON.stringify(next) === JSON.stringify(folders);
    folders = next;
    const names = new Map(next.map((f) => [f.id, f.name]));
    const before = items;
    items = items.map((b) => {
      const name = names.get(b.folderId);
      return name !== undefined && name !== b.folder
        ? { ...b, folder: name }
        : b;
    });
    // A folder that is gone (deleted, here or elsewhere) cannot stay chosen.
    const chosen = selection;
    if (chosen.kind === "folder" && !next.some((f) => f.id === chosen.id))
      selection = { kind: "all" };
    // A name field that is open is never replaced: `drawFolders` waits until it closes.
    if (items.some((b, i) => b !== before[i]) || !same || treeStale) draw();
  }

  // When the name field closes after a refresh was held back, the tree catches up.
  side.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!left && treeStale && !nameFieldOpen()) {
        treeStale = false;
        drawFolders();
      }
    }, 0);
  });

  /** The owner's folder work: runs `work`, says why it failed, and reads the folders again. */
  async function folderWork(
    lead: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (!left) toasts.show(`${lead} ${errorMessage(error)}`);
    }
    await refreshFolders();
  }

  function folderAction(event: TreeActionEvent): Promise<void> | undefined {
    const { action, id, name } = event;
    if (action === "create")
      return folderWork("The folder was not created.", async () => {
        await deps.createFolder(name ?? "");
      });
    if (action === "rename" && id !== null)
      return folderWork("The folder was not renamed.", async () => {
        await deps.renameFolder(id, name ?? "");
      });
    if (action === "delete" && id !== null) askDeleteFolder(id);
    return undefined;
  }

  /** Asks before a folder goes. Its links move to Unsorted; none is lost. */
  function askDeleteFolder(id: string): void {
    const folder = folders.find((f) => f.id === id);
    if (!folder || folder.isDefault) return;
    const opener =
      doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const n = folder.count;
    const dialog = createConfirmDialog({
      doc,
      title: `Delete the folder "${folder.name}"?`,
      message:
        n === 0
          ? "No bookmarks are in this folder."
          : `${bookmarkCount(n)} ${n === 1 ? "moves" : "move"} to Unsorted.`,
      lose: [`The folder "${folder.name}"`],
      keepLabel: "Keep folder",
      confirmLabel: "Delete folder",
      onConfirm: () => {
        void folderWork("The folder was not deleted.", async () => {
          const moved = await deps.deleteFolder(id);
          const home = unsorted();
          if (home)
            items = items.map((b) =>
              b.folderId === id
                ? {
                    ...b,
                    folderId: home.id,
                    folder: home.name,
                    folderReason: null,
                    folderIsGuess: false,
                  }
                : b,
            );
          draw();
          toasts.show(
            moved === 0
              ? `Folder "${folder.name}" deleted.`
              : `Folder "${folder.name}" deleted. ${bookmarkCount(moved)} moved to Unsorted.`,
          );
        });
      },
      onKeep: () => opener?.focus(),
    });
    dialog.open(opener);
  }

  /** Shows a toast with Undo for the step the core just kept. A new step replaces the old toast. */
  function offerUndo(message: string): void {
    dismissUndo?.();
    dismissUndo = toasts.show(message, { onUndo: undo });
  }

  /** Takes back the last move or delete, then puts the link where it belongs in the list. */
  function undo(): void {
    dismissUndo = null;
    if (stepRunning) return;
    stepRunning = true;
    draw();
    deps
      .undoLast()
      .then((b) => {
        stepRunning = false;
        if (left) return;
        items = restore(items, b);
        draw();
        void refreshFolders();
        toasts.show("Undone.");
      })
      .catch((error: unknown) => {
        stepRunning = false;
        if (left) return;
        draw();
        toasts.show(`Mnemo could not undo. ${errorMessage(error)}`);
      });
  }

  /** Moves a link to `folder` (the owner's choice from the card's menu). */
  function move(b: SavedBookmark, folder: Folder): void {
    if (stepRunning) return;
    stepRunning = true;
    draw();
    deps
      .moveBookmark(b.id, folder.id)
      .then((moved) => {
        stepRunning = false;
        if (left) return;
        put(moved);
        void refreshFolders();
        offerUndo(`Moved to ${folder.name}.`);
      })
      .catch((error: unknown) => {
        stepRunning = false;
        if (left) return;
        draw();
        toasts.show(`Mnemo could not move the link. ${errorMessage(error)}`);
      });
  }

  /** Deletes a link with no confirm dialog: the toast offers Undo. */
  function remove(b: SavedBookmark): void {
    if (stepRunning) return;
    stepRunning = true;
    draw();
    deps
      .deleteSavedBookmark(b.id)
      .then(() => {
        stepRunning = false;
        if (left) return;
        items = items.filter((x) => x.id !== b.id);
        draw();
        void refreshFolders();
        offerUndo("Link deleted.");
      })
      .catch((error: unknown) => {
        stepRunning = false;
        if (left) return;
        draw();
        toasts.show(`Mnemo could not delete the link. ${errorMessage(error)}`);
      });
  }

  /** The card's own buttons: its summary actions, "Move to folder" and the ghost "Delete". */
  function cardButtons(b: SavedBookmark): Node[] {
    const nodes = actionsOf(b);
    const targets = folders.filter((f) => f.id !== b.folderId);
    const name = b.title ?? b.site ?? b.url;
    if (targets.length > 0) {
      const menu = createMenu(doc, {
        label: "Move to folder",
        size: "sm",
        variant: "ghost",
        disabled: stepRunning,
        items: targets.map((f) => ({
          label: f.name,
          onSelect: () => move(b, f),
        })),
        signal: cardMenus.signal,
      });
      menu.anchor
        .querySelector("button")
        ?.setAttribute("aria-label", `Move to folder: ${name}`);
      nodes.push(menu.anchor);
    }
    const del = createButton(doc, {
      label: "Delete",
      size: "sm",
      variant: "ghost",
      busy: stepRunning,
      onClick: () => remove(b),
    });
    del.setAttribute("aria-label", `Delete: ${name}`);
    nodes.push(del);
    return nodes;
  }

  /** The main action (`first`) is a default button; any other is ghost, as the link card asks. */
  function actionButton(
    b: SavedBookmark,
    action: CardAction,
    first: boolean,
  ): HTMLElement {
    const button = createButton(doc, {
      label: ACTION_LABELS[action],
      size: "sm",
      variant: first ? "default" : "ghost",
      busy: busy.has(b.id),
      onClick: () =>
        action === "paste" ? openPaste(b, button) : run(b.id, undefined),
    });
    return button;
  }

  /** The card's action buttons, in order: the first is the main one. */
  function actionsOf(b: SavedBookmark): Node[] {
    return actionsFor(b).map((action, i) => actionButton(b, action, i === 0));
  }

  // ---- the list: sections, the three views, the needs-a-look bar and the dialog (#27) ----

  /** The links the page shows for the chosen folder or filter, before the search. */
  function pool(): SavedBookmark[] {
    if (selection.kind === "needs") return items.filter(needsLook);
    if (selection.kind === "folder") {
      const id = selection.id;
      return items.filter((b) => b.folderId === id);
    }
    return items;
  }

  /** The three views of one list of links: the same items, in the same order. */
  function linkView(shown: readonly SavedBookmark[]): HTMLElement {
    const linkItems = shown.map((b) => {
      const item = toLinkItem(b, b.id === alreadySavedId);
      byItem.set(item, b);
      return item;
    });
    return createLinkView(doc, view, linkItems, {
      onOpen: openBookmark,
      actions: (item) => {
        const b = byItem.get(item);
        return b ? cardButtons(b) : [];
      },
    });
  }

  interface Section {
    id: string;
    name: string;
    count: number;
    items: SavedBookmark[];
    /** True on "All bookmarks" without a search: the first few links and "Show all N". */
    folds: boolean;
  }

  function buildSection(section: Section): HTMLElement {
    const box = doc.createElement("section");
    box.className = "bookmarks-section";
    box.setAttribute("aria-label", section.name);
    const body = doc.createElement("div");
    body.className = "bookmarks-section-body";
    body.append(
      linkView(
        section.folds ? section.items.slice(0, SECTION_FIRST) : section.items,
      ),
    );
    // "Show all N" opens the folder: the page then shows all its links, as picking it in the sidebar.
    const heading = createFolderHeading(doc, {
      name: section.name,
      count: section.count,
      canToggle: section.folds && section.count > SECTION_FIRST,
      onToggle: () => select({ kind: "folder", id: section.id }),
    });
    box.append(heading.element, body);
    return box;
  }

  /** The sections of the page: one per folder on "All bookmarks", otherwise one for the choice. */
  function sections(): Section[] {
    const found = query.trim() !== "";
    const match = (list: SavedBookmark[]) =>
      found ? list.filter((b) => matchesSearch(b, query)) : list;
    if (selection.kind === "all") {
      return groupByFolder(items, folders)
        .map((g) => {
          const hits = match(g.items);
          return {
            id: g.id,
            name: g.name,
            // The core's count is the full one; a link just saved shows before the count is read.
            count: found ? hits.length : Math.max(g.count, hits.length),
            items: hits,
            folds: !found,
          };
        })
        .filter((g) => g.count > 0);
    }
    const hits = match(pool());
    if (selection.kind === "needs")
      return [
        {
          id: "needs",
          name: "Needs a look",
          count: hits.length,
          items: hits,
          folds: false,
        },
      ];
    const id = selection.id;
    const folder = folders.find((f) => f.id === id);
    return [
      {
        id,
        name: folder?.name ?? hits[0]?.folder ?? "Folder",
        count: found ? hits.length : Math.max(folder?.count ?? 0, hits.length),
        items: hits,
        folds: false,
      },
    ];
  }

  /** The words an empty list says, for the choice and the search. */
  function emptyText(): { title: string; body: string } {
    if (query.trim() !== "")
      return {
        title: "No bookmark matches",
        body: "Try another word, or clear the search box.",
      };
    if (selection.kind === "needs")
      return {
        title: "Every link has a summary",
        body: "Nothing needs a look.",
      };
    if (selection.kind === "folder")
      return {
        title: "No bookmarks here yet",
        body: 'Open a bookmark and use "Move to folder".',
      };
    return {
      title: "No saved links yet",
      body: "Paste a link in the box above and choose Save link.",
    };
  }

  /** The bar above the list: how many links have no summary, and "Show them". */
  function drawBar(): void {
    const n = needsCount();
    // Whole only once every page is loaded; on the filter itself the bar has nothing to add.
    if (!loaded || n === 0 || selection.kind === "needs") {
      bar.replaceChildren();
      return;
    }
    bar.replaceChildren(
      buildBanner({
        tone: "warn",
        message: needsLookLine(n),
        action: {
          label: "Show them",
          onClick: () => select({ kind: "needs" }),
        },
      }),
    );
  }

  /** The line under the title: how many links, in how many folders. */
  function drawContext(): void {
    if (!context || folders.length === 0) return;
    const total = folders.reduce((sum, f) => sum + f.count, 0);
    const used = folders.filter((f) => f.count > 0).length;
    context.textContent = `${bookmarkCount(total)} in ${used === 1 ? "1 folder" : `${used} folders`}.`;
  }

  function draw(): void {
    cardMenus.abort();
    cardMenus = new AbortController();
    byItem.clear();
    drawFolders();
    drawBar();
    drawContext();
    if (!viewReady) return;
    if (!loaded && items.length === 0) {
      list.replaceChildren(buildBusyLine("Loading your bookmarks"));
      return;
    }
    const shown = sections();
    if (shown.every((sec) => sec.items.length === 0)) {
      list.replaceChildren(buildEmptyState(emptyText()));
      return;
    }
    list.replaceChildren(...shown.map(buildSection));
  }

  /** The dialog with the full card of a link and "Open in browser". */
  function openBookmark(item: LinkItem): void {
    const b = byItem.get(item);
    if (!b) return;
    const opener =
      doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    let opening = false;
    const dialog = createDialog({
      doc,
      title: "Bookmark",
      children: [createLinkCard(doc, toLinkItem(b, false))],
      actions: (close) => {
        const open = createDialogButton(
          "Open in browser",
          "primary",
          () => {
            if (opening) return;
            opening = true;
            open.disabled = true;
            deps
              .openLink(b.id)
              .catch((error: unknown) => {
                if (!left)
                  toasts.show(
                    `Mnemo could not open the link. ${errorMessage(error)}`,
                  );
              })
              .finally(() => {
                opening = false;
                open.disabled = false;
              });
          },
          doc,
        );
        return [createDialogButton("Close", "default", close, doc), open];
      },
      onClose: () => dialog.element.remove(),
    });
    dialog.open(opener);
  }

  /** The saved view: read it, build the view control, then draw the list. */
  function startView(saved: string | null): void {
    if (left) return;
    view = parseView(saved);
    const labels = Object.values(VIEW_LABELS);
    viewSlot.replaceChildren(
      createSegmented(doc, {
        label: "View",
        options: labels,
        value: VIEW_LABELS[view],
        onChange: (label) => {
          const next = (Object.keys(VIEW_LABELS) as LinkView[]).find(
            (v) => VIEW_LABELS[v] === label,
          );
          if (!next || next === view) return;
          view = next;
          draw();
          deps.setSetting(VIEW_SETTING, next).catch((error: unknown) => {
            if (!left)
              toasts.show(
                `Mnemo could not save the view for next time. ${errorMessage(error)}`,
              );
          });
        },
      }),
    );
    viewReady = true;
    draw();
  }

  draw();
  deps
    .onBookmarkChanged((b) => {
      if (left) return;
      put(b);
      void refreshFolders();
    })
    .then((stop) => {
      if (left) stop();
      else unlisten = stop;
    })
    .catch((error: unknown) => {
      console.error("could not listen for bookmark changes:", error);
    });
  void refreshFolders();
  deps
    .getSetting(VIEW_SETTING)
    .catch(() => null)
    .then(startView);
  void loadAll();

  /** Reads every page of bookmarks, newest first, and draws as the pages arrive. */
  async function loadAll(): Promise<void> {
    let after: Cursor | null = null;
    try {
      do {
        const page: Page<SavedBookmark> = await deps.listBookmarkCards({
          limit: BOOKMARKS_PAGE,
          after,
        });
        if (left) return;
        // A link saved or changed while the list loaded keeps its newer state.
        const known = new Set(items.map((b) => b.id));
        items = [...items, ...page.items.filter((b) => !known.has(b.id))];
        items.sort(newestFirst);
        // A link the owner saved again before the list loaded stays on top, not at its date.
        const again = items.find((b) => b.id === alreadySavedId);
        if (again) items = moveToTop(items, again);
        after = page.next;
        loaded = after === null;
        draw();
      } while (after !== null);
    } catch (error) {
      if (left) return;
      showProblem(
        `Mnemo could not load the saved links. ${errorMessage(error)}`,
      );
    }
  }

  return () => {
    left = true;
    delete container.dataset.layout;
    stop.abort();
    cardMenus.abort();
    unlisten?.();
    toasts.element.remove();
  };
}
