// The Bookmarks screen of #25 (BM-01): a link box and the cards of the saved links. This is the
// minimal route; #27 replaces it with the full Bookmarks page.
//
// Save stores the link at once in the core; the card then follows the core's bookmark-changed
// events (reading, then done, link only or no summary yet). A link the core could not read
// offers "Paste the text"; a link with no summary yet offers "Summarize later". A link whose page
// could not be reached for now should offer both (owner decision); until the link card takes
// several actions (UI request issue 179) it offers "Paste the text". Every part comes from ui/src/ds;
// bookmarks.css lays them out. All text goes in as text.
import {
  buildBanner,
  buildEmptyState,
  createButton,
  createDialog,
  createDialogButton,
  createField,
  createLinkCard,
  createPageHeader,
  createTextarea,
  createTextInput,
  createToastRegion,
  setFieldError,
} from "../../ds";
import { findItem } from "../../frame/nav";
import {
  errorMessage,
  isAppError,
  type Page,
  type SavedBookmark,
  type SaveResult,
} from "../../shared/api";
import {
  ACTION_LABELS,
  type CardAction,
  shownAction,
  toLinkItem,
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
}

/** How many saved links the screen reads (one page). #27 adds paging. */
export const BOOKMARKS_PAGE = 100;

/** Fills `container` with the Bookmarks screen. Returns a function that cleans up on leave. */
export function renderBookmarks(
  container: HTMLElement,
  deps: BookmarksDeps,
): () => void {
  const doc = container.ownerDocument;
  let left = false;
  let unlisten: (() => void) | null = null;
  // The one place this screen keeps its state: the saved links, newest first.
  let items: SavedBookmark[] = [];
  /** Bookmarks with a summary call going, so their action is not sent twice. */
  const busy = new Set<string>();

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
  const field = createField(doc, {
    label: "Link",
    control: input,
    hint: "A web link that starts with http:// or https://.",
  });
  const save = createButton(doc, { label: "Save link", variant: "primary" });
  save.type = "submit";
  const form = doc.createElement("form");
  form.className = "bookmarks-linkbox";
  form.noValidate = true;
  form.append(field, save);
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
  container.replaceChildren(header, form, notice, list, toasts.element);

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
    deps
      .saveLink(url)
      .then((result) => {
        if (left) return;
        put(result);
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

  function actionButton(b: SavedBookmark, action: CardAction): HTMLElement {
    const button = createButton(doc, {
      label: ACTION_LABELS[action],
      size: "sm",
      busy: busy.has(b.id),
      onClick: () =>
        action === "paste" ? openPaste(b, button) : run(b.id, undefined),
    });
    return button;
  }

  /** The card's one action button (several wait on UI request issue 179). */
  function actionsOf(b: SavedBookmark): Node | undefined {
    const action = shownAction(b);
    return action ? actionButton(b, action) : undefined;
  }

  function draw(): void {
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
        createLinkCard(doc, toLinkItem(b), {
          action: actionsOf(b),
        }),
      ),
    );
    list.replaceChildren(grid);
  }

  draw();
  deps
    .onBookmarkChanged((b) => {
      if (!left) put(b);
    })
    .then((stop) => {
      if (left) stop();
      else unlisten = stop;
    })
    .catch((error: unknown) => {
      console.error("could not listen for bookmark changes:", error);
    });
  deps
    .listBookmarkCards({ limit: BOOKMARKS_PAGE })
    .then((page) => {
      if (left) return;
      // A link saved or changed while the list loaded keeps its newer state.
      const known = new Set(items.map((b) => b.id));
      items = [...items, ...page.items.filter((b) => !known.has(b.id))];
      items.sort((a, z) => z.createdAt.localeCompare(a.createdAt));
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
    unlisten?.();
    toasts.element.remove();
  };
}
