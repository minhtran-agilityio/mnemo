// Markdown view: a note's Markdown shown for reading. The text is untrusted, so it is never turned
// into markup: a small parser reads it and builds only these elements with createElement and text
// nodes (headings, paragraphs, strong, em, code, pre, blockquote, lists, hr, links). Raw HTML such as
// <script> or <img onerror> stays visible as plain text and never runs. Images are not loaded (no
// network); their alt text shows. A link is never opened by this part: a click, a middle click and
// the context menu are stopped and reported to the screen, and only http, https and mailto
// addresses are links at all. No library and no markup strings.
import { createLink } from "../link/link";
import "./markdown-view.css";

export interface MarkdownViewOptions {
  /** The Markdown source. Untrusted. */
  readonly source: string;
  /** The accessible name of the region. Default "Note". */
  readonly label?: string;
  /** What shows when the source has no text. */
  readonly emptyText?: string;
  /** The heading element a "#" becomes, 1 to 6. Default 2 (the screen owns the h1). */
  readonly headingLevel?: number;
  /**
   * A link was activated: a click, a middle click or the context menu. The part has already
   * stopped the browser from following it, so nothing leaves Mnemo until the screen decides.
   */
  readonly onLinkClick?: (href: string, event: MouseEvent) => void;
}

export const MARKDOWN_EMPTY_TEXT = "This note has no text.";

const MAX_DEPTH = 8;
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s]+$/i;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// A closing "#" run closes the heading only when a space comes before it ("# Learning C#" keeps it).
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
const LINK = /\[([^\]]{0,2000})\]\(([^)\s]{0,2000})(?:\s+"[^"]{0,500}")?\)/y;
const URL_PART = /\(([^)\s]{0,2000})\)/y;
const ALNUM = /[\p{L}\p{N}]/u;

interface Fence {
  readonly marker: string;
  readonly lang: string;
}

/** An opening fence, or null. A backtick fence cannot have a backtick in its info string. */
function matchFence(line: string): Fence | null {
  const m = FENCE_LINE.exec(line);
  if (!m) return null;
  if (m[1][0] === "`" && m[2].includes("`")) return null;
  return { marker: m[1], lang: m[2].trim().split(/\s+/)[0].slice(0, 40) };
}

function closesFence(line: string, fence: Fence): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return (
    !!m && m[1][0] === fence.marker[0] && m[1].length >= fence.marker.length
  );
}

function make<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

interface Context {
  readonly doc: Document;
  readonly top: number;
  readonly onLinkClick?: MarkdownViewOptions["onLinkClick"];
}

/** A link the owner may follow only through the screen: every way of opening it is stopped. */
function linkNode(ctx: Context, label: string, href: string): Node {
  if (!SAFE_HREF.test(href)) return ctx.doc.createTextNode(label || href);
  const report = (event: Event) => {
    event.preventDefault();
    ctx.onLinkClick?.(href, event as MouseEvent);
  };
  const a = createLink(ctx.doc, {
    label: label || href,
    href,
    external: true,
    onClick: report,
  });
  // A middle click and "open in new window" skip `click`; stop and report them too.
  a.addEventListener("auxclick", report);
  a.addEventListener("contextmenu", report);
  return a;
}

/** Inline marks in s between lo and hi. Context (the characters around a mark) reads the whole string. */
function inline(
  ctx: Context,
  s: string,
  lo = 0,
  hi = s.length,
  depth = 0,
): Node[] {
  const { doc } = ctx;
  const out: Node[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(doc.createTextNode(buf));
    buf = "";
  };
  let i = lo;
  while (i < hi) {
    const c = s[i];
    if (c === "\\" && i + 1 < hi && /[\\`*_{}[\]()#+\-.!<>~|]/.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const j = s.indexOf("`", i + 1);
      if (j > i + 1 && j < hi) {
        flush();
        const code = make(doc, "code", "md-code");
        code.textContent = s.slice(i + 1, j);
        out.push(code);
        i = j + 1;
        continue;
      }
    }
    // A badge: [![alt](image)](page). The image never loads; its alt text is the link label.
    if (c === "[" && s[i + 1] === "!" && s[i + 2] === "[") {
      LINK.lastIndex = i + 2;
      const img = LINK.exec(s);
      if (img && s[LINK.lastIndex] === "]" && s[LINK.lastIndex + 1] === "(") {
        URL_PART.lastIndex = LINK.lastIndex + 1;
        const page = URL_PART.exec(s);
        if (page && URL_PART.lastIndex <= hi) {
          flush();
          out.push(linkNode(ctx, img[1] || "image", page[1]));
          i = URL_PART.lastIndex;
          continue;
        }
      }
    }
    const image = c === "!" && s[i + 1] === "[";
    if (c === "[" || image) {
      LINK.lastIndex = image ? i + 1 : i;
      const m = LINK.exec(s);
      if (m && LINK.lastIndex <= hi) {
        flush();
        if (image) {
          const alt = make(doc, "span", "md-image");
          alt.textContent = m[1] || "image";
          out.push(alt);
        } else {
          out.push(linkNode(ctx, m[1], m[2]));
        }
        i = LINK.lastIndex;
        continue;
      }
    }
    if (depth < MAX_DEPTH) {
      const two = s.slice(i, i + 2);
      if (two === "**" || two === "__") {
        const j = s.indexOf(two, i + 2);
        if (j > i + 2 && j + 2 <= hi) {
          flush();
          const strong = make(doc, "strong", "md-strong");
          strong.append(...inline(ctx, s, i + 2, j, depth + 1));
          out.push(strong);
          i = j + 2;
          continue;
        }
      }
      if (
        (c === "*" || c === "_") &&
        s[i + 1] !== " " &&
        (c === "*" || !ALNUM.test(s[i - 1] ?? " "))
      ) {
        let j = s.indexOf(c, i + 1);
        // An underscore inside a word (snake_case_name) never closes an emphasis.
        while (j !== -1 && j < hi && c === "_" && ALNUM.test(s[j + 1] ?? " "))
          j = s.indexOf(c, j + 1);
        if (j > i + 1 && j < hi && s[j - 1] !== " ") {
          flush();
          const em = make(doc, "em", "md-em");
          em.append(...inline(ctx, s, i + 1, j, depth + 1));
          out.push(em);
          i = j + 1;
          continue;
        }
      }
    }
    buf += c;
    i += 1;
  }
  flush();
  return out;
}

function isBlockStart(line: string): boolean {
  return (
    matchFence(line) !== null ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line)
  );
}

const leadOf = (line: string) => line.length - line.trimStart().length;

/**
 * One list. A blank line keeps the list going when an item (or an indented continuation) follows;
 * indented lines under an item belong to it; an ordered list starts at its first number.
 */
function list(
  ctx: Context,
  lines: string[],
  start: number,
  indent: number,
  depth: number,
): { node: HTMLElement; next: number } {
  const first = LIST_ITEM.exec(lines[start]) as RegExpExecArray;
  const ordered = /\d/.test(first[2]);
  const node: HTMLElement = make(ctx.doc, ordered ? "ol" : "ul", "md-list");
  if (ordered) {
    const n = Number.parseInt(first[2], 10);
    if (n !== 1) (node as HTMLOListElement).start = n;
  }
  const inner = indent + 2;
  let i = start;
  let last: HTMLElement | undefined;
  let afterBlank = false;
  let content = inner;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j >= lines.length) break;
      const next = lines[j];
      const item = LIST_ITEM.exec(next);
      const continues = item
        ? item[1].length >= indent
        : !!last && leadOf(next) >= inner;
      if (!continues) break;
      i = j;
      afterBlank = true;
      continue;
    }
    const m = LIST_ITEM.exec(line);
    if (!m) {
      if (!last || leadOf(line) < inner) break;
      // Lines indented under the item: more of its text, or a code block or quote inside it.
      const chunk: string[] = [];
      let fence: Fence | null = null;
      while (i < lines.length) {
        const l = lines[i];
        if (fence) {
          chunk.push(l.slice(Math.min(leadOf(l), content)));
          if (closesFence(l.slice(Math.min(leadOf(l), content)), fence))
            fence = null;
          i += 1;
          continue;
        }
        if (!l.trim()) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j += 1;
          if (
            j < lines.length &&
            leadOf(lines[j]) >= inner &&
            !LIST_ITEM.test(lines[j])
          ) {
            chunk.push("");
            i += 1;
            continue;
          }
          break;
        }
        if (leadOf(l) < inner || LIST_ITEM.test(l)) break;
        const dedented = l.slice(Math.min(leadOf(l), content));
        fence = matchFence(dedented);
        chunk.push(dedented);
        i += 1;
      }
      const parts = blocks(ctx, chunk, depth + 1);
      const head = parts[0];
      if (!afterBlank && head && head.tagName === "P") {
        last.append(" ", ...Array.from(head.childNodes));
        last.append(...parts.slice(1));
      } else {
        last.append(...parts);
      }
      afterBlank = false;
      continue;
    }
    const ind = m[1].length;
    if (ind < indent) break;
    if (ind > indent && last && depth < MAX_DEPTH) {
      const nested = list(ctx, lines, i, ind, depth + 1);
      last.append(nested.node);
      i = nested.next;
      afterBlank = false;
      continue;
    }
    if (/\d/.test(m[2]) !== ordered) break;
    const li = make(ctx.doc, "li", "md-item");
    let text = m[3];
    const box = /^\[( |x|X)\]\s+(.*)$/.exec(text);
    if (box) {
      const done = box[1] !== " ";
      const mark = make(ctx.doc, "span", "md-check");
      mark.setAttribute("role", "img");
      mark.setAttribute("aria-label", done ? "Done" : "Not done");
      mark.textContent = done ? "[x]" : "[ ]";
      li.classList.add("md-item-task");
      li.append(mark);
      text = box[2];
    }
    li.append(...inline(ctx, text));
    node.append(li);
    last = li;
    content = Math.max(inner, ind + m[2].length + 1);
    afterBlank = false;
    i += 1;
  }
  return { node, next: i };
}

function blocks(ctx: Context, lines: string[], depth: number): HTMLElement[] {
  const { doc } = ctx;
  const out: HTMLElement[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = matchFence(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !closesFence(lines[i], fence)) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      const pre = make(doc, "pre", "md-pre");
      pre.tabIndex = 0;
      pre.setAttribute("role", "region");
      pre.setAttribute(
        "aria-label",
        fence.lang ? `Code, ${fence.lang}` : "Code",
      );
      const code = make(doc, "code");
      code.textContent = body.join("\n");
      pre.append(code);
      out.push(pre);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const tag = `h${Math.min(6, ctx.top + level - 1)}` as "h2";
      const h = make(doc, tag, `md-h md-h-${level}`);
      h.append(...inline(ctx, heading[2]));
      out.push(h);
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push(make(doc, "hr", "md-rule"));
      i += 1;
      continue;
    }
    if (QUOTE.test(line) && depth < MAX_DEPTH) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push(lines[i].replace(/^ {0,3}> ?/, ""));
        i += 1;
      }
      const quote = make(doc, "blockquote", "md-quote");
      quote.append(...blocks(ctx, inner, depth + 1));
      out.push(quote);
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const result = list(ctx, lines, i, item[1].length, 0);
      out.push(result.node);
      i = result.next;
      continue;
    }
    const text: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      (text.length === 0 || !isBlockStart(lines[i]))
    ) {
      text.push(lines[i].trim());
      i += 1;
    }
    const p = make(doc, "p", "md-p");
    p.append(...inline(ctx, text.join(" ")));
    out.push(p);
  }
  return out;
}

/** Builds the view. The result is a labelled region; it holds no markup that came from the source. */
export function createMarkdownView(
  doc: Document,
  options: MarkdownViewOptions,
): HTMLElement {
  const root = make(doc, "article", "md");
  root.setAttribute("aria-label", options.label ?? "Note");
  if (!options.source.trim()) {
    root.classList.add("is-empty");
    const p = make(doc, "p", "md-empty");
    p.textContent = options.emptyText ?? MARKDOWN_EMPTY_TEXT;
    root.append(p);
    return root;
  }
  const top = Math.min(6, Math.max(1, Math.floor(options.headingLevel ?? 2)));
  const ctx: Context = { doc, top, onLinkClick: options.onLinkClick };
  const lines = options.source
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .split("\n");
  root.append(...blocks(ctx, lines, 0));
  return root;
}
