// Markdown view: a note's Markdown shown for reading. The text is untrusted, so it is never turned
// into markup: a small parser reads it and builds only these elements with createElement and text
// nodes (headings, paragraphs, strong, em, code, pre, blockquote, lists, hr, links). Raw HTML such as
// <script> or <img onerror> stays visible as plain text and never runs. Images are not loaded (no
// network); their alt text shows. A link is never opened by this part: it reports the click to the
// screen, and only http, https and mailto addresses are links at all. No library and no markup strings.
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
  /** A link was activated. The part has already stopped the browser from following it. */
  readonly onLinkClick?: (href: string, event: MouseEvent) => void;
}

export const MARKDOWN_EMPTY_TEXT = "This note has no text.";

const MAX_DEPTH = 8;
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s]+$/i;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^ {0,3}(```+|~~~+)\s*([\w+#.-]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
const LINK = /\[([^\]]{0,2000})\]\(([^)\s]{0,2000})(?:\s+"[^"]{0,500}")?\)/y;

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

function inline(ctx: Context, s: string, depth = 0): Node[] {
  const { doc } = ctx;
  const out: Node[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(doc.createTextNode(buf));
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (
      c === "\\" &&
      i + 1 < s.length &&
      /[\\`*_{}[\]()#+\-.!<>~|]/.test(s[i + 1])
    ) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const j = s.indexOf("`", i + 1);
      if (j > i + 1) {
        flush();
        const code = make(doc, "code", "md-code");
        code.textContent = s.slice(i + 1, j);
        out.push(code);
        i = j + 1;
        continue;
      }
    }
    const image = c === "!" && s[i + 1] === "[";
    if (c === "[" || image) {
      LINK.lastIndex = image ? i + 1 : i;
      const m = LINK.exec(s);
      if (m) {
        flush();
        if (image) {
          const alt = make(doc, "span", "md-image");
          alt.textContent = m[1] || "image";
          out.push(alt);
        } else if (SAFE_HREF.test(m[2])) {
          const href = m[2];
          out.push(
            createLink(doc, {
              label: m[1] || href,
              href,
              external: true,
              onClick: (event) => {
                event.preventDefault();
                ctx.onLinkClick?.(href, event);
              },
            }),
          );
        } else {
          // Not an address the part will offer: the label stays as plain text.
          out.push(doc.createTextNode(m[1] || m[2]));
        }
        i = LINK.lastIndex;
        continue;
      }
    }
    if (depth < MAX_DEPTH) {
      const two = s.slice(i, i + 2);
      if (two === "**" || two === "__") {
        const j = s.indexOf(two, i + 2);
        if (j > i + 2) {
          flush();
          const strong = make(doc, "strong", "md-strong");
          strong.append(...inline(ctx, s.slice(i + 2, j), depth + 1));
          out.push(strong);
          i = j + 2;
          continue;
        }
      }
      if (
        (c === "*" || c === "_") &&
        s[i + 1] !== " " &&
        (c === "*" || !/[\p{L}\p{N}]/u.test(s[i - 1] ?? " "))
      ) {
        const j = s.indexOf(c, i + 1);
        if (j > i + 1 && s[j - 1] !== " ") {
          flush();
          const em = make(doc, "em", "md-em");
          em.append(...inline(ctx, s.slice(i + 1, j), depth + 1));
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
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line)
  );
}

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
  let i = start;
  let last: HTMLElement | undefined;
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i]);
    if (!m) break;
    const ind = m[1].length;
    if (ind < indent) break;
    if (ind > indent && last && depth < MAX_DEPTH) {
      const nested = list(ctx, lines, i, ind, depth + 1);
      last.append(nested.node);
      i = nested.next;
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
      li.append(mark, " ");
      text = box[2];
    }
    li.append(...inline(ctx, text));
    node.append(li);
    last = li;
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
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (
        i < lines.length &&
        !(
          lines[i].trim().startsWith(fence[1]) && /^\s*[`~]+\s*$/.test(lines[i])
        )
      ) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      const pre = make(doc, "pre", "md-pre");
      pre.tabIndex = 0;
      pre.setAttribute("role", "region");
      pre.setAttribute("aria-label", fence[2] ? `Code, ${fence[2]}` : "Code");
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
