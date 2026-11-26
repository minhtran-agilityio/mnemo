// A saved link in the three Bookmarks views: a card (Cards), a row (List) and a compact row
// (Compact). Honest failure: a page Mnemo could not read keeps the link only, with no summary. A
// summary the app wrote and tags it chose are labelled "Written by AI", and a reason it guessed is
// labelled "Guess". The status decides what shows: only a `done` link shows its summary.
// A long title wraps (card) or is cut off with its full text in the tooltip (rows); a long URL or
// host is cut off with the full value in the tooltip; in a row, keyboard focus also shows the full
// host. A card has one action slot: the screen passes the buttons that fit the card's status, in
// order, the main one first (for example "Summarize later" and "Paste the text" on a pending card
// whose page could not be reached). On a narrow card they wrap, each whole, from the slot's start.
// Issue 169 added the site, the saved date, tags, the reason, the action slot and `pending`.
// Issue 179: the slot holds more than one action (`actions`).
// Issue 172: the rows show the host of the URL when there is no site, never its scheme.
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
  /**
   * The actions of the card for its status, in order: the first is the main one. They sit in the
   * `.lcard-action` slot with a gap and wrap on a narrow card.
   *
   * The screen picks the buttons' variants; the card does not restyle them. A list holds many
   * cards, and a view has one primary action, so no card button is `primary`: the main action is a
   * default `createButton` with size `sm`, and each other one is a `ghost` `sm` button (quieter).
   * For example "Summarize later" (default) then "Paste the text" (ghost).
   *
   * A non-empty list wins over `action`. Empty or left out, `action` is shown; with neither there
   * is no slot.
   */
  readonly actions?: readonly Node[];
  /** One action: the same as `actions: [action]`. Shown only when `actions` is empty or left out. */
  readonly action?: Node;
}

/** The actions to show: a non-empty `actions`, else `action` alone, else none. */
function cardActions(options: LinkCardOptions): readonly Node[] {
  return options.actions?.length
    ? options.actions
    : options.action
      ? [options.action]
      : [];
}

/** Options of a List or Compact row. */
export interface LinkRowOptions {
  /** Draws a state that cannot be live in a still view (the UI Catalog). */
  readonly forceState?: "hover" | "focus" | "active";
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

/** A scheme with an authority, as in `https://`. Group 1 is the scheme's name. */
const SCHEME = /^([a-z][a-z\d+.-]*):\/\//i;

/** The port a scheme uses when the URL names none; `new URL()` leaves it out of the host. */
const DEFAULT_PORT: Readonly<Record<string, string>> = {
  http: "80",
  https: "443",
  ws: "80",
  wss: "443",
  ftp: "21",
};

/**
 * The authority of a URL written as text: after the scheme (or a protocol-relative `//`), before
 * the path, without a user. Empty when the URL has none (`file:///a`).
 */
function authority(url: string): string {
  const rest = url.replace(SCHEME, "").replace(/^\/\//, "");
  const end = rest.search(/[/?#]/);
  const auth = end < 0 ? rest : rest.slice(0, end);
  return auth.slice(auth.lastIndexOf("@") + 1);
}

/** A host and a port with no scheme ("localhost:1420/a"), which `new URL()` reads as a scheme. */
const HOST_PORT = /^[^:/?#]+:\d+(?:[/?#]|$)/;

/** A scheme with no authority after it, as in `mailto:`, `about:` or `file:/a`. */
const BARE_SCHEME = /^[a-z][a-z\d+.-]*:(?!\/\/)/i;

/** Text with only printable ASCII. */
const ASCII = /^[\x20-\x7e]*$/;

/** A host written as text, lowercased, without the default port of its scheme. */
function foldHost(host: string, scheme: string): string {
  const port = DEFAULT_PORT[scheme.toLowerCase()];
  const low = host.toLowerCase();
  return port && low.endsWith(`:${port}`)
    ? low.slice(0, -(port.length + 1))
    : low;
}

/**
 * Whether `new URL()` takes the text as an absolute URL. `URL.canParse` is in WebKit since Safari 17
 * and WebKitGTK 2.42 (2023); support in the WebKitGTK that Ubuntu 22.04 ships is **Unverified**.
 * Where it is missing, the URL is read as text only (the same host for an http or https link).
 */
function parses(url: string): boolean {
  return typeof URL.canParse === "function" && URL.canParse(url);
}

/**
 * The host to show for a link: its site, else the host of its URL, never the scheme
 * ("https://v2.tauri.app/a" and "v2.tauri.app/a" both give "v2.tauri.app"). Empty when the URL has
 * no host: `file:///a`, `about:blank`, `mailto:me@x.com`, `javascript:...`. Only the host text
 * decides how it is read:
 * - an ASCII host is parsed with `new URL()`, which lowercases it and drops a default port;
 * - a host with letters outside ASCII is lowercased as written, with a default port dropped here,
 *   since `new URL()` turns it into punycode ("xn--..."), which the owner cannot read;
 * - a URL with no scheme ("v2.tauri.app/a", "//v2.tauri.app/a", "localhost:1420/a") is not an
 *   absolute URL; its host text is lowercased as written.
 * A path with letters outside ASCII changes nothing.
 */
export function linkHost(item: LinkItem): string {
  const site = item.site?.trim();
  if (site) return site;
  const url = item.url.trim();
  if (HOST_PORT.test(url)) return foldHost(authority(url), "");
  if (parses(url)) {
    const parsed = new URL(url);
    // A scheme with no host (about:, mailto:, javascript:, file:) shows no site.
    if (!parsed.host) return "";
    const text = authority(url);
    return ASCII.test(text)
      ? parsed.host
      : foldHost(text, parsed.protocol.slice(0, -1));
  }
  if (BARE_SCHEME.test(url)) return "";
  return foldHost(authority(url), SCHEME.exec(url)?.[1] ?? "");
}

/**
 * The List row's meta line: the app badge, then the host and the saved date, kept together in
 * `.link-host` so they wrap as one piece. When the line has no room for the badge and the whole
 * host and date, they wrap under the badge. There is no dot after the badge (it is its own tinted
 * box), so a wrapped line never ends with a dot. Null when none is known.
 */
function rowMetaLine(doc: Document, item: LinkItem): HTMLDivElement | null {
  const parts: (string | Node)[] = [];
  const host = linkHost(item);
  if (host) {
    const site = textEl(doc, "span", "site", host);
    site.title = host;
    parts.push(site);
  }
  // An empty string falls back, as a missing value does.
  const when = item.saved || item.age;
  if (when) parts.push(when);
  if (!item.app && parts.length === 0) return null;
  const line = createMetaLine(
    doc,
    item.app ? [createAppBadge(doc, item.app)] : [],
  );
  if (parts.length > 0) {
    const group = createMetaLine(doc, parts);
    group.classList.add("link-host");
    line.append(group);
  }
  return line;
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
  const actions = cardActions(options);
  if (actions.length > 0) {
    const slot = doc.createElement("div");
    slot.className = "lcard-action";
    slot.append(...actions);
    card.append(slot);
  }
  return card;
}

/**
 * The List view: one row per link, with the summary (or why there is none) on a second line. A
 * summary shows only on a `done` link and keeps its Written by AI (or Guess) label after the text:
 * the summary is cut with its ellipsis, and the label stays whole (under the summary when the line
 * is tight). Tags and the reason are left out of the two-line row (each needs its own label and
 * line); the Cards view shows them (issue 171).
 */
export function createLinkRow(
  doc: Document,
  item: LinkItem,
  options: LinkRowOptions = {},
): HTMLLIElement {
  const summary = shownSummary(item);
  const row = createListRow(doc, {
    title: item.title,
    sub: summary ?? noSummaryText(item),
    icon: Link,
  });
  row.classList.add("link-row");
  if (options.forceState) row.classList.add(`is-${options.forceState}`);
  row.dataset.status = linkStatus(item);
  const sub = row.querySelector(".row-sub");
  if (summary && sub) {
    const line = doc.createElement("span");
    line.className = "link-sub";
    sub.replaceWith(line);
    line.append(sub, buildTrustLabel(item.summaryKind ?? "ai"));
  } else if (linkStatus(item) === "reading" && sub) {
    // Reading is an AI task in progress: the spinner and the words, as a status region.
    sub.replaceChildren(reading(doc));
  }
  // The body and the meta line share .link-main, after the icon: the meta line sits next to the
  // body when it fits whole, else on its own line under the title.
  const body = row.querySelector(":scope > .row-body");
  const main = doc.createElement("span");
  main.className = "link-main";
  if (body) body.replaceWith(main);
  else row.append(main);
  if (body) main.append(body);
  const meta = rowMetaLine(doc, item);
  if (meta) main.append(meta);
  return row;
}

/**
 * The Compact view: the title, the site and the saved date on one line, and a spinner (named
 * "Reading the page") while Mnemo reads it. The title and the site share the room, each up to its
 * own width. The title keeps a readable minimum (8ch), so a short title keeps an 8ch box and any
 * room beyond that goes to the site; the site is cut before the title goes under 8ch. The date goes
 * to a second line under the title in a list of 220px or narrower with a host of 8ch or more (214px
 * docs.rs, 201px x.com, 194px t.me, 160px no site; on a reading row 244, 238, 225, 218 and 184px);
 * on a reading row the site goes there too at 166px or narrower (159px docs.rs, 146px x.com, 140px
 * t.me). Measured in Chrome (issue 175). It shows nothing the app wrote (no summary, tags or
 * reason), so it needs no trust label; the List and Cards views show them, labelled (issue 171).
 */
export function createCompactRow(
  doc: Document,
  item: LinkItem,
  options: LinkRowOptions = {},
): HTMLLIElement {
  const li = doc.createElement("li");
  li.className = "compact-row";
  if (options.forceState) li.classList.add(`is-${options.forceState}`);
  li.dataset.status = linkStatus(item);
  li.tabIndex = 0;
  const title = textEl(doc, "span", "row-title", item.title);
  title.title = item.title;
  li.append(title);
  // While Mnemo reads the page, a spinner sits after the title, as a status region. Its words are
  // in the tooltip and hidden text, so the one-line row keeps room for the site and the date.
  if (linkStatus(item) === "reading") {
    const box = doc.createElement("span");
    box.className = "compact-reading";
    box.setAttribute("role", "status");
    box.title = NO_SUMMARY.reading;
    box.append(
      buildSpinner(),
      textEl(doc, "span", "compact-reading-words", NO_SUMMARY.reading),
    );
    li.append(box);
  }
  // A URL with no host (`file:///a`) shows no site, not an empty one.
  const host = linkHost(item);
  if (host) {
    const dom = textEl(doc, "span", "dom", host);
    dom.title = item.url;
    li.append(dom);
  }
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
