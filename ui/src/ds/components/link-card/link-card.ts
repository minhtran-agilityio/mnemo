// A saved link in the three Bookmarks views: a card (Cards), a row (List) and a compact row
// (Compact). Honest failure: a page Mnemo could not read keeps the link only, with no summary. A
// summary the app wrote and tags it chose are labelled "Written by AI", and a reason it guessed is
// labelled "Guess". The status decides what shows: only a `done` link shows its summary.
// A long title wraps (card) or is cut off with its full text in the tooltip (rows); a long URL or
// host is cut off with the full value in the tooltip. A card has one action slot: the screen
// passes the one button that fits the card's status (for example "Paste the text").
// Issue 169 added the site, the saved date, tags, the reason, the action slot and `pending`.
import { Clock, Link, PowerOff } from "lucide";
import { createIcon } from "../../icon";
import { createListRow } from "../list-row/list-row";
import {
  type AppId,
  createAppBadge,
  createMetaLine,
} from "../metadata-line/metadata-line";
import { buildSpinner } from "../spinner/spinner";
import { createTagList } from "../tag-list/tag-list";
import { buildTrustLabel } from "../trust-label/trust-label";
import "./link-card.css";

/**
 * Where a saved link is. `pending`: saved, no summary yet (reading not started, or an AI run
 * failed). `reading`: Mnemo is reading the page. `done`: read, with a summary. `unreadable`: link
 * only. `ai-off`: saved, AI is off.
 */
export type LinkStatus =
  | "pending"
  | "reading"
  | "done"
  | "unreadable"
  | "ai-off";

export interface LinkItem {
  readonly title: string;
  readonly url: string;
  /** The app the link came from. Leave out for a link pasted into Mnemo. */
  readonly app?: AppId;
  /** The site's host, for example `v2.tauri.app`. Shown on the meta line. */
  readonly site?: string;
  /** How long ago it was saved ("2 d"). Shown when `saved` is left out. */
  readonly age?: string;
  /** The saved date ("25 Nov 2026"). Shown on the meta line in place of `age`. */
  readonly saved?: string;
  /** The summary text. Leave out when Mnemo has none. */
  readonly summary?: string;
  /** Who wrote the summary. A guess is labelled as one. Default `ai`. */
  readonly summaryKind?: "ai" | "guess";
  /**
   * Where the link is. It decides what shows: a summary shows only when the status is `done` (or
   * left out). Left out, the status is `done` with a summary and `unreadable` without one.
   */
  readonly status?: LinkStatus;
  /** The top-level label names, shown with the tag list part. Tags the app chose show only on a
   * `done` link; the owner's show in every status. */
  readonly tags?: readonly string[];
  /** Who chose the tags. `ai` (the app chose them) is labelled Written by AI. Default `ai`. */
  readonly tagsKind?: "ai" | "owner";
  /** Why the link was saved. A guessed reason shows only on a `done` link; the owner's always. */
  readonly reason?: string;
  /** Who wrote the reason. `guess` (the app wrote it) is labelled Guess. Default `guess`. */
  readonly reasonKind?: "guess" | "owner";
}

export interface LinkCardOptions {
  /** Shows a picture box on top (the Cards view). */
  readonly thumb?: boolean;
  /** The one action of the card for its status, for example a `createButton`. */
  readonly action?: Node;
}

/** Past this many tags the tag list shows one "+N" item. */
const MAX_TAGS = 6;

function textEl<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

const NO_SUMMARY = {
  pending: "No summary yet.",
  reading: "Reading the page",
  done: "No summary.",
  unreadable: "Link only. Mnemo could not read this page.",
  "ai-off": "No summary yet: AI is off.",
} as const satisfies Record<LinkStatus, string>;

/** The status that decides what the link shows. Left out: `done` with a summary, else `unreadable`. */
export function linkStatus(item: LinkItem): LinkStatus {
  return item.status ?? (item.summary ? "done" : "unreadable");
}

/**
 * The summary to show, or undefined. Shared rule 1: only a `done` link shows one, so a link that
 * is pending, reading, unreadable or AI off never shows a summary as if it were read. An empty
 * summary counts as none.
 */
function shownSummary(item: LinkItem): string | undefined {
  return linkStatus(item) === "done" && item.summary ? item.summary : undefined;
}

/** The honest line under a link that shows no summary: why there is none. */
export function noSummaryText(item: LinkItem): string {
  return NO_SUMMARY[linkStatus(item)];
}

function reading(doc: Document): HTMLElement {
  const box = doc.createElement("span");
  box.className = "rec-reading";
  box.setAttribute("role", "status");
  box.append(buildSpinner(), doc.createTextNode(NO_SUMMARY.reading));
  return box;
}

/**
 * The meta line: the source app, the site and when it was saved, each only when known. Null when
 * none is known, so no empty line adds a gap.
 */
function metaLine(doc: Document, item: LinkItem): HTMLDivElement | null {
  const parts: (string | Node)[] = [];
  if (item.app) parts.push(createAppBadge(doc, item.app));
  if (item.site) {
    const site = textEl(doc, "span", "site", item.site);
    site.title = item.site;
    parts.push(site);
  }
  // An empty string falls back, as a missing value does.
  const when = item.saved || item.age;
  if (when) parts.push(when);
  return parts.length > 0 ? createMetaLine(doc, parts) : null;
}

function noSummary(doc: Document, item: LinkItem): HTMLElement {
  const status = linkStatus(item);
  if (status === "reading") return reading(doc);
  const none = doc.createElement("div");
  none.className = "nosum";
  // The link icon means "link only", so a read link with no summary has no icon.
  const icon =
    status === "ai-off"
      ? PowerOff
      : status === "pending"
        ? Clock
        : status === "unreadable"
          ? Link
          : undefined;
  if (icon) none.append(createIcon(icon));
  none.append(doc.createTextNode(noSummaryText(item)));
  return none;
}

function reasonLine(doc: Document, item: LinkItem): HTMLElement {
  const line = doc.createElement("div");
  line.className = "reason";
  line.append(textEl(doc, "span", "reason-text", item.reason ?? ""));
  if ((item.reasonKind ?? "guess") === "guess")
    line.append(buildTrustLabel("guess"));
  return line;
}

/** The tags, with the Written by AI label when the app chose them. */
function tagLine(doc: Document, item: LinkItem): HTMLElement {
  const line = doc.createElement("div");
  line.className = "lcard-tags";
  line.append(createTagList(doc, item.tags ?? [], { max: MAX_TAGS }));
  if ((item.tagsKind ?? "ai") === "ai") line.append(buildTrustLabel("ai"));
  return line;
}

export function createLinkCard(
  doc: Document,
  item: LinkItem,
  options: LinkCardOptions = {},
): HTMLElement {
  const card = doc.createElement("article");
  card.className = "lcard";
  card.dataset.status = linkStatus(item);
  if (options.thumb) {
    const thumb = doc.createElement("div");
    thumb.className = "thumb";
    thumb.append(createIcon(Link));
    card.append(thumb);
  }
  const meta = metaLine(doc, item);
  if (meta) card.append(meta);
  const title = textEl(doc, "div", "title", item.title);
  title.title = item.title;
  const url = textEl(doc, "div", "url", item.url);
  url.title = item.url;
  card.append(title, url);
  const summary = shownSummary(item);
  if (summary) {
    card.append(
      textEl(doc, "div", "sum", summary),
      buildTrustLabel(item.summaryKind ?? "ai"),
    );
  } else {
    card.append(noSummary(doc, item));
  }
  // Shared rule 1: tags and a reason the app wrote show only on a read (`done`) link. The owner's
  // own tags and reason show in every status.
  const read = linkStatus(item) === "done";
  const aiTags = (item.tagsKind ?? "ai") === "ai";
  if (item.tags && item.tags.length > 0 && (read || !aiTags))
    card.append(tagLine(doc, item));
  const guessed = (item.reasonKind ?? "guess") === "guess";
  if (item.reason && (read || !guessed)) card.append(reasonLine(doc, item));
  if (options.action) {
    const slot = doc.createElement("div");
    slot.className = "lcard-action";
    slot.append(options.action);
    card.append(slot);
  }
  return card;
}

/** The List view: one row per link, with the summary (or why there is none) on a second line. */
export function createLinkRow(doc: Document, item: LinkItem): HTMLLIElement {
  const row = createListRow(doc, {
    title: item.title,
    sub: shownSummary(item) ?? noSummaryText(item),
    icon: Link,
  });
  row.classList.add("link-row");
  const meta = metaLine(doc, item);
  if (meta) row.append(meta);
  return row;
}

/** The Compact view: the title, the site and the age on one line. */
export function createCompactRow(doc: Document, item: LinkItem): HTMLLIElement {
  const li = doc.createElement("li");
  li.className = "compact-row";
  li.tabIndex = 0;
  const title = textEl(doc, "span", "row-title", item.title);
  title.title = item.title;
  const host = item.site || item.url.split("/")[0];
  const dom = textEl(doc, "span", "dom", host);
  dom.title = item.url;
  li.append(title, dom);
  const when = item.saved || item.age;
  if (when) li.append(textEl(doc, "span", "row-meta", when));
  return li;
}

export type LinkView = "list" | "cards" | "compact";

/** One of the three Bookmarks views of the same links. */
export function createLinkView(
  doc: Document,
  view: LinkView,
  items: readonly LinkItem[],
): HTMLElement {
  if (view === "cards") {
    const grid = doc.createElement("div");
    grid.className = "views cards";
    grid.append(...items.map((i) => createLinkCard(doc, i, { thumb: true })));
    return grid;
  }
  const ul = doc.createElement("ul");
  ul.className = "list";
  ul.setAttribute(
    "aria-label",
    view === "list" ? "Links, list view" : "Links, compact view",
  );
  ul.append(
    ...items.map((i) =>
      view === "list" ? createLinkRow(doc, i) : createCompactRow(doc, i),
    ),
  );
  return ul;
}
