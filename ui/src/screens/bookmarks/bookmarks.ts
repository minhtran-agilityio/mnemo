// The Bookmarks screen of #25 (BM-01): a link box and the cards of the saved links. This is the
// minimal route; #27 replaces it with the full Bookmarks page.
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
  buildEmptyState,
  createButton,
  createConfirmDialog,
  createDialog,
  createDialogButton,
  createField,
  createLinkCard,
  createMenu,
  createPageHeader,
  createTextarea,
  createTextInput,
  createToastRegion,
  createTree,
  setFieldError,
  type TreeActionEvent,
  type TreeNode,
} from "../../ds";
import { findItem } from "../../frame/nav";
import {
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
  moveToTop,
  restore,
  toLinkItem,
  UNSORTED_REFUSED,
  upsert,
} from "./bookmarks-logic";

/** The calls the screen makes; main.ts passes the typed client from shared/api. */
export interface BookmarksDeps {
  saveLink(url: string): Promise<SaveResult>;
  summarizeBookmark(id: string, pastedText?: string): Promise<SaveResult>;
  listBookmarkCards(args: { limit: number }): Promise<Page<SavedBookmark>>;
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
}

/** How many saved links the screen reads (one page). #27 adds paging. */
export const BOOKMARKS_PAGE = 100;

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
  /** Bookmarks with a move or a delete going. */
  const changing = new Set<string>();
  /** The folders, Unsorted last; the core counts their live links. */
  let folders: Folder[] = [];
  /** Closes the toast of the last move or delete, so its Undo never takes back a later step. */
  let dismissUndo: (() => void) | null = null;
  /** Ends the menus of the cards drawn last (their listeners go when the list is drawn again). */
  let cardMenus = new AbortController();
  /** Ends the folder tree's listeners when the screen is left. */
  const stop = new AbortController();

  const toasts = createToastRegion();
  const phase = findItem("bookmarks")?.phase;
  const header = createPageHeader({
    doc,
    title: "Bookmarks",
    crumb: phase === undefined ? undefined : `Phase ${phase}`,
    context:
      "Paste a link and save it. Mnemo stores it at once, reads the page, and adds a summary, tags and a reason. AI text is labelled.",
  });

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
  const list = doc.createElement("div");
  list.className = "bookmarks-list";
  list.setAttribute("aria-label", "Saved links");
  list.setAttribute("role", "region");
  const side = doc.createElement("div");
  side.className = "bookmarks-folders";
  side.setAttribute("aria-label", "Folders");
  side.setAttribute("role", "region");
  const body = doc.createElement("div");
  body.className = "bookmarks-body";
  body.append(side, list);
  container.replaceChildren(header, form, notice, body, toasts.element);

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
      ...(f.isDefault ? { refused: UNSORTED_REFUSED } : {}),
    }));
  }

  /** Draws the folder tree. A name field that is open is not closed by a redraw of equal data. */
  function drawFolders(): void {
    side.replaceChildren(
      createTree(doc, "Folders", folderNodes(), undefined, {
        noun: "folder",
        flat: true,
        onAction: folderAction,
        signal: stop.signal,
      }),
    );
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
    if (!same) drawFolders();
    if (items.some((b, i) => b !== before[i]) || !same) draw();
  }

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
    deps
      .undoLast()
      .then((b) => {
        if (left) return;
        items = restore(items, b);
        draw();
        void refreshFolders();
        toasts.show("Undone.");
      })
      .catch((error: unknown) => {
        if (!left) toasts.show(`Mnemo could not undo. ${errorMessage(error)}`);
      });
  }

  /** Moves a link to `folder` (the owner's choice from the card's menu). */
  function move(b: SavedBookmark, folder: Folder): void {
    if (changing.has(b.id)) return;
    changing.add(b.id);
    deps
      .moveBookmark(b.id, folder.id)
      .then((moved) => {
        changing.delete(b.id);
        if (left) return;
        put(moved);
        void refreshFolders();
        offerUndo(`Moved to ${folder.name}.`);
      })
      .catch((error: unknown) => {
        changing.delete(b.id);
        if (left) return;
        toasts.show(`Mnemo could not move the link. ${errorMessage(error)}`);
      });
  }

  /** Deletes a link with no confirm dialog: the toast offers Undo. */
  function remove(b: SavedBookmark): void {
    if (changing.has(b.id)) return;
    changing.add(b.id);
    deps
      .deleteSavedBookmark(b.id)
      .then(() => {
        changing.delete(b.id);
        if (left) return;
        items = items.filter((x) => x.id !== b.id);
        draw();
        void refreshFolders();
        offerUndo("Link deleted.");
      })
      .catch((error: unknown) => {
        changing.delete(b.id);
        if (left) return;
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
      busy: changing.has(b.id),
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

  function draw(): void {
    cardMenus.abort();
    cardMenus = new AbortController();
    if (items.length === 0) {
      list.replaceChildren(
        buildEmptyState({
          title: "No saved links yet",
          body: "Paste a link in the box above and choose Save link.",
        }),
      );
      return;
    }
    const grid = doc.createElement("div");
    grid.className = "bookmarks-cards";
    grid.append(
      ...items.map((b) =>
        createLinkCard(doc, toLinkItem(b, b.id === alreadySavedId), {
          actions: cardButtons(b),
        }),
      ),
    );
    list.replaceChildren(grid);
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
    .listBookmarkCards({ limit: BOOKMARKS_PAGE })
    .then((page) => {
      if (left) return;
      // A link saved or changed while the list loaded keeps its newer state.
      const known = new Set(items.map((b) => b.id));
      items = [...items, ...page.items.filter((b) => !known.has(b.id))];
      items.sort((a, z) => z.createdAt.localeCompare(a.createdAt));
      // A link the owner saved again before the list loaded stays on top, not at its date.
      const again = items.find((b) => b.id === alreadySavedId);
      if (again) items = moveToTop(items, again);
      draw();
    })
    .catch((error: unknown) => {
      if (left) return;
      showProblem(
        `Mnemo could not load the saved links. ${errorMessage(error)}`,
      );
    });

  return () => {
    left = true;
    delete container.dataset.layout;
    stop.abort();
    cardMenus.abort();
    unlisten?.();
    toasts.element.remove();
  };
}
