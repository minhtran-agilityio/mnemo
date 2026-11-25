// A saved link in the three Bookmarks views: a card (Cards), a row (List) and a compact row
// (Compact). Honest failure: a page Mnemo could not read keeps the link only, with no summary. A
// summary the app wrote is labelled "Written by AI", and a reason it guessed is labelled "Guess".
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
 * Where a saved link is. `pending`: saved, reading not started. `reading`: Mnemo is reading the
 * page. `done`: read, with a summary. `unreadable`: link only. `ai-off`: saved, AI is off.
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
  /** Where the link is. Without a summary the default is `unreadable`. */
  readonly status?: LinkStatus;
  /** The top-level label names, shown with the tag list part. */
  readonly tags?: readonly string[];
  /** Why the link was saved. */
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
  pending: "Saved. Mnemo has not read the page yet.",
  reading: "Reading the page",
  done: "No summary.",
  unreadable: "Link only. Mnemo could not read this page.",
  "ai-off": "No summary yet: AI is off.",
} as const satisfies Record<LinkStatus, string>;

/** The honest line under a link that has no summary: why there is none. */
export function noSummaryText(item: LinkItem): string {
  return NO_SUMMARY[item.status ?? "unreadable"];
}

function reading(doc: Document): HTMLElement {
  const box = doc.createElement("span");
  box.className = "rec-reading";
  box.setAttribute("role", "status");
  box.append(buildSpinner(), doc.createTextNode(NO_SUMMARY.reading));
  return box;
}

/** The meta line: the source app, the site and when it was saved, each only when known. */
function metaLine(doc: Document, item: LinkItem): HTMLDivElement {
  const parts: (string | Node)[] = [];
  if (item.app) parts.push(createAppBadge(doc, item.app));
  if (item.site) {
    const site = textEl(doc, "span", "site", item.site);
    site.title = item.site;
    parts.push(site);
  }
  const when = item.saved ?? item.age;
  if (when) parts.push(when);
  return createMetaLine(doc, parts);
}

function noSummary(doc: Document, item: LinkItem): HTMLElement {
  if (item.status === "reading") return reading(doc);
  const none = doc.createElement("div");
  none.className = "nosum";
  const icon =
    item.status === "ai-off"
      ? PowerOff
      : item.status === "pending"
        ? Clock
        : Link;
  none.append(createIcon(icon), doc.createTextNode(noSummaryText(item)));
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

export function createLinkCard(
  doc: Document,
  item: LinkItem,
  options: LinkCardOptions = {},
): HTMLElement {
  const card = doc.createElement("article");
  card.className = "lcard";
  card.dataset.status = item.summary ? "done" : (item.status ?? "unreadable");
  if (options.thumb) {
    const thumb = doc.createElement("div");
    thumb.className = "thumb";
    thumb.append(createIcon(Link));
    card.append(thumb);
  }
  card.append(metaLine(doc, item));
  const title = textEl(doc, "div", "title", item.title);
  title.title = item.title;
  const url = textEl(doc, "div", "url", item.url);
  url.title = item.url;
  card.append(title, url);
  if (item.summary) {
    card.append(
      textEl(doc, "div", "sum", item.summary),
      buildTrustLabel(item.summaryKind ?? "ai"),
    );
  } else {
    card.append(noSummary(doc, item));
  }
  if (item.tags && item.tags.length > 0)
    card.append(createTagList(doc, item.tags, { max: MAX_TAGS }));
  if (item.reason) card.append(reasonLine(doc, item));
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
    sub: item.summary ?? noSummaryText(item),
    icon: Link,
  });
  row.append(metaLine(doc, item));
  return row;
}

/** The Compact view: the title, the site and the age on one line. */
export function createCompactRow(doc: Document, item: LinkItem): HTMLLIElement {
  const li = doc.createElement("li");
  li.className = "compact-row";
  li.tabIndex = 0;
  const title = textEl(doc, "span", "row-title", item.title);
  title.title = item.title;
  const host = item.site ?? item.url.split("/")[0];
  const dom = textEl(doc, "span", "dom", host);
  dom.title = item.url;
  li.append(title, dom);
  const when = item.saved ?? item.age;
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
