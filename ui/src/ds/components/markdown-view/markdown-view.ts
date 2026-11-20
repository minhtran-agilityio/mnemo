// Markdown view: a note's Markdown shown for reading. The text is untrusted, so it is never turned
// into markup: a small parser reads it and builds only these elements with createElement and text
// nodes (headings, paragraphs, strong, em, code, pre, blockquote, lists, hr, links). Raw HTML such as
// <script> or <img onerror> stays visible as plain text and never runs. Images are not loaded (no
// network); their alt text shows. A link is never opened by this part: a click and a middle click are
// stopped and reported, the context menu is stopped unless the screen allows it, and only http,
// https and mailto addresses are links at all. No library and no markup strings.
//
// Limits that keep a hostile note from freezing the pane: nesting of lists, quotes and items stops at
// MAX_DEPTH (the rest shows as plain text), a paragraph longer than MAX_INLINE characters shows as
// plain text, and every pattern is linear in the length of its line.
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
   * A link was activated by a click or a middle click. The part has already stopped the browser
   * from following it, so nothing leaves Mnemo until the screen decides.
   */
  readonly onLinkClick?: (href: string, event: MouseEvent) => void;
  /**
   * The context menu was asked for on a link. The part stops the native menu (it can open the
   * address in a new window) and reports here, so the screen can show its own menu, for example
   * with "Copy link address".
   */
  readonly onLinkMenu?: (href: string, event: MouseEvent) => void;
  /**
   * Keep the native context menu on links (for "Copy link address"). Default false. The native menu
   * may offer to open the address, so the screen takes that on.
   */
  readonly allowNativeLinkMenu?: boolean;
}

export const MARKDOWN_EMPTY_TEXT = "This note has no text.";

const MAX_DEPTH = 8;
/** A paragraph, heading or item longer than this shows as plain text. */
const MAX_INLINE = 10000;
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s]+$/i;
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])\s+([\s\S]*)$/;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})([\s\S]*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+([\s\S]*)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
// An address may hold one level of balanced parentheses (Wikipedia style). The two alternatives
// never match the same character, so the pattern cannot backtrack badly.
const URL_BODY = "((?:[^()\\s]|\\([^()\\s]*\\)){0,2000})";
const LINK_TAIL = new RegExp(`\\(${URL_BODY}(?:\\s+"[^"]{0,500}")?\\)`, "y");
const MAX_LABEL = 2000;

interface Bracketed {
  /** Where the label ends (the index of its closing bracket). */
  readonly labelEnd: number;
  readonly href: string;
  /** The index after the closing parenthesis. */
  readonly end: number;
}

/**
 * The "[label](address)" that starts at s[at], or null. The label is matched by bracket depth, so it
 * may hold balanced brackets (an image, `array[0]`) and the outer "](" is the one that closes it.
 */
function matchBracketed(s: string, at: number, hi: number): Bracketed | null {
  let depth = 0;
  const limit = Math.min(hi, at + MAX_LABEL + 2);
  for (let j = at; j < limit; j++) {
    const c = s[j];
    if (c === "\\") j += 1;
    else if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) {
        if (s[j + 1] !== "(") return null;
        LINK_TAIL.lastIndex = j + 1;
        const tail = LINK_TAIL.exec(s);
        const end = LINK_TAIL.lastIndex;
        if (!tail || end > hi) return null;
        return { labelEnd: j, href: tail[1], end };
      }
    }
  }
  return null;
}
const ALNUM = /[\p{L}\p{N}]/u;

/** A list item line. A thematic break such as "- - -" is not an item. */
const isItem = (line: string) => LIST_ITEM.test(line) && !RULE.test(line);

/** The width of the leading spaces and tabs of a line, a tab going to the next multiple of 4. */
function leadW(line: string): number {
  let col = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === " ") col += 1;
    else if (line[i] === "\t") col += 4 - (col % 4);
    else break;
  }
  return col;
}

/** Removes up to n columns of leading space from a line. Text after it, tabs included, is kept. */
function dedent(line: string, n: number): string {
  let col = 0;
  let i = 0;
  while (i < line.length && col < n) {
    if (line[i] === " ") {
      col += 1;
      i += 1;
    } else if (line[i] === "\t") {
      const next = col + 4 - (col % 4);
      if (next > n) return " ".repeat(next - n) + line.slice(i + 1);
      col = next;
      i += 1;
    } else break;
  }
  return line.slice(i);
}

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

/** The heading text without its closing # run (only a run after a space closes it). Linear. */
function headingText(raw: string): string {
  const text = raw.trimEnd();
  let j = text.length;
  while (j > 0 && text[j - 1] === "#") j -= 1;
  if (j < text.length && (j === 0 || /\s/.test(text[j - 1])))
    return text.slice(0, j).trimEnd();
  return text;
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

/** Appends one at a time: a spread of a long array can pass the argument limit of the engine. */
function put(parent: Node, nodes: readonly Node[]): void {
  for (const node of nodes) parent.appendChild(node);
}

interface Context {
  readonly doc: Document;
  readonly top: number;
  readonly onLinkClick?: MarkdownViewOptions["onLinkClick"];
  readonly onLinkMenu?: MarkdownViewOptions["onLinkMenu"];
  readonly allowNativeLinkMenu?: boolean;
}

/** A link the owner may follow only through the screen: every way of opening it is stopped. */
function linkNode(ctx: Context, label: readonly Node[], href: string): Node[] {
  const nodes = label.length ? label : [ctx.doc.createTextNode(href)];
  if (!SAFE_HREF.test(href)) return [...nodes];
  const a = createLink(ctx.doc, { label: "", href, external: true });
  // The link part put an empty text node first; the label (with its marks) goes there.
  const slot = a.firstChild;
  for (const node of nodes) a.insertBefore(node, slot);
  if (slot) a.removeChild(slot);
  a.addEventListener("click", (event) => {
    event.preventDefault();
    ctx.onLinkClick?.(href, event);
  });
  // A middle click skips `click`. Other buttons only need to be kept from navigating.
  a.addEventListener("auxclick", (event) => {
    event.preventDefault();
    if (event.button === 1) ctx.onLinkClick?.(href, event);
  });
  a.addEventListener("contextmenu", (event) => {
    if (!ctx.allowNativeLinkMenu) event.preventDefault();
    ctx.onLinkMenu?.(href, event);
  });
  return [a];
}

/**
 * Inline marks in s between lo and hi. The characters around a mark are read from the whole string.
 * `inLink` is true inside a link label, where no further link is made.
 */
function inline(
  ctx: Context,
  s: string,
  lo = 0,
  hi = s.length,
  depth = 0,
  inLink = false,
): Node[] {
  const { doc } = ctx;
  if (depth === 0 && hi - lo > MAX_INLINE)
    return [doc.createTextNode(s.slice(lo, hi))];
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
      // A code span opens with a run of backticks and closes on a run of the same length.
      let n = 1;
      while (s[i + n] === "`") n += 1;
      let k = i + n;
      let close = -1;
      while (k < hi) {
        const j = s.indexOf("`", k);
        if (j === -1 || j >= hi) break;
        let run = 1;
        while (s[j + run] === "`") run += 1;
        if (run === n && j > i + n) {
          close = j;
          break;
        }
        k = j + run;
      }
      if (close !== -1) {
        flush();
        let text = s.slice(i + n, close);
        if (
          text.length > 2 &&
          text.startsWith(" ") &&
          text.endsWith(" ") &&
          text.trim()
        )
          text = text.slice(1, -1);
        const code = make(doc, "code", "md-code");
        code.textContent = text;
        out.push(code);
        i = close + n;
        continue;
      }
      buf += s.slice(i, i + n);
      i += n;
      continue;
    }
    // A link, or an image (never loaded: its alt text shows). A badge is a link whose label is an image.
    const image = c === "!" && s[i + 1] === "[";
    if ((c === "[" && !inLink) || image) {
      const at = image ? i + 1 : i;
      const m = matchBracketed(s, at, hi);
      if (m) {
        flush();
        if (image) {
          const alt = make(doc, "span", "md-image");
          alt.textContent = s.slice(at + 1, m.labelEnd) || "image";
          out.push(alt);
        } else {
          out.push(
            ...linkNode(
              ctx,
              inline(ctx, s, at + 1, m.labelEnd, depth + 1, true),
              m.href,
            ),
          );
        }
        i = m.end;
        continue;
      }
    }
    if (depth < MAX_DEPTH) {
      if (c === "*" && s.startsWith("***", i)) {
        const j = s.indexOf("***", i + 3);
        if (j > i + 3 && j + 3 <= hi) {
          flush();
          const strong = make(doc, "strong", "md-strong");
          const em = make(doc, "em", "md-em");
          put(em, inline(ctx, s, i + 3, j, depth + 1, inLink));
          strong.append(em);
          out.push(strong);
          i = j + 3;
          continue;
        }
      }
      const two = s.slice(i, i + 2);
      if (
        (two === "**" || two === "__") &&
        (two === "**" || !ALNUM.test(s[i - 1] ?? " "))
      ) {
        let j = s.indexOf(two, i + 2);
        // A double underscore inside a word (my__var__name) is not bold.
        while (
          j !== -1 &&
          j + 2 <= hi &&
          two === "__" &&
          ALNUM.test(s[j + 2] ?? " ")
        )
          j = s.indexOf(two, j + 2);
        if (j > i + 2 && j + 2 <= hi) {
          flush();
          const strong = make(doc, "strong", "md-strong");
          put(strong, inline(ctx, s, i + 2, j, depth + 1, inLink));
          out.push(strong);
          i = j + 2;
          continue;
        }
      }
      if (
        (c === "*" || c === "_") &&
        s[i + 1] !== " " &&
        (c === "*" ||
          (!ALNUM.test(s[i - 1] ?? " ") &&
            s[i - 1] !== "_" &&
            s[i + 1] !== "_"))
      ) {
        let j = s.indexOf(c, i + 1);
        // An underscore inside a word (snake_case_name) never closes an emphasis.
        while (
          j !== -1 &&
          j < hi &&
          c === "_" &&
          (ALNUM.test(s[j + 1] ?? " ") || s[j + 1] === "_" || s[j - 1] === "_")
        )
          j = s.indexOf(c, j + 1);
        if (j > i + 1 && j < hi && s[j - 1] !== " ") {
          flush();
          const em = make(doc, "em", "md-em");
          put(em, inline(ctx, s, i + 1, j, depth + 1, inLink));
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
    interruptsParagraph(line)
  );
}

/** Only a bullet, or an ordered item numbered 1, may interrupt a paragraph ("2019. Since" may not). */
function interruptsParagraph(line: string): boolean {
  const m = LIST_ITEM.exec(line);
  return !!m && (!/\d/.test(m[2]) || Number.parseInt(m[2], 10) === 1);
}

/**
 * One list. A blank line keeps the list going when an item (or an indented continuation) follows;
 * indented lines under an item belong to it; an ordered list starts at its first number. `depth` is
 * the one nesting count shared with blocks(), so mixed lists and quotes cannot get around the cap.
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
      const item = RULE.test(next) ? null : LIST_ITEM.exec(next);
      const continues = item
        ? leadW(item[1]) >= indent
        : !!last && leadW(next) >= inner;
      if (!continues) break;
      i = j;
      afterBlank = true;
      continue;
    }
    // A rule ends the list: "- - -" is a rule, not a nested item.
    if (leadW(line) < inner && RULE.test(line)) break;
    const m = RULE.test(line) ? null : LIST_ITEM.exec(line);
    if (!m) {
      if (!last || leadW(line) < inner) break;
      // Lines indented under the item: more of its text, or a code block or quote inside it.
      const chunk: string[] = [];
      const startChunk = i;
      let fence: Fence | null = null;
      while (i < lines.length) {
        const l = lines[i];
        if (fence) {
          // An unclosed fence ends where the indent falls back below the item.
          if (l.trim() && leadW(l) < inner) break;
          const cut = dedent(l, content);
          chunk.push(cut);
          if (closesFence(cut, fence)) fence = null;
          i += 1;
          continue;
        }
        if (!l.trim()) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j += 1;
          if (
            j < lines.length &&
            leadW(lines[j]) >= inner &&
            !isItem(lines[j])
          ) {
            chunk.push("");
            i = j;
            continue;
          }
          break;
        }
        if (leadW(l) < inner || isItem(l)) break;
        const cut = dedent(l, content);
        fence = matchFence(cut);
        chunk.push(cut);
        i += 1;
      }
      if (i === startChunk) i += 1; // always move on
      const parts = blocks(ctx, chunk, depth + 1);
      const head = parts[0];
      if (!afterBlank && head && head.tagName === "P") {
        last.append(" ");
        put(last, Array.from(head.childNodes));
        put(last, parts.slice(1));
      } else {
        put(last, parts);
      }
      afterBlank = false;
      continue;
    }
    const ind = leadW(m[1]);
    if (ind < indent) break;
    if (ind >= inner && last && depth < MAX_DEPTH) {
      const nested = list(ctx, lines, i, ind, depth + 1);
      last.append(nested.node);
      i = nested.next > i ? nested.next : i + 1; // always move on

      afterBlank = false;
      continue;
    }
    if (/\d/.test(m[2]) !== ordered) break;
    const li = make(ctx.doc, "li", "md-item");
    let text = m[3];
    const box = /^\[( |x|X)\](?:\s+([\s\S]*))?$/.exec(text);
    if (box) {
      const done = box[1] !== " ";
      const mark = make(ctx.doc, "span", "md-check");
      mark.setAttribute("role", "img");
      mark.setAttribute("aria-label", done ? "Done" : "Not done");
      mark.textContent = done ? "[x]" : "[ ]";
      li.classList.add("md-item-task");
      li.append(mark);
      text = box[2] ?? "";
    }
    put(li, inline(ctx, text));
    node.append(li);
    last = li;
    content = Math.max(inner, ind + m[2].length + 1);
    afterBlank = false;
    i += 1;
  }
  return { node, next: i };
}

/** The blocks of some lines. Past MAX_DEPTH nesting the rest shows as plain text. */
function blocks(ctx: Context, lines: string[], depth: number): HTMLElement[] {
  const { doc } = ctx;
  if (depth > MAX_DEPTH) {
    const p = make(doc, "p", "md-p");
    p.textContent = lines
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
    return [p];
  }
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
      const fenceIndent = leadW(line);
      i += 1;
      while (i < lines.length && !closesFence(lines[i], fence)) {
        body.push(dedent(lines[i], fenceIndent));
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
      put(h, inline(ctx, headingText(heading[2])));
      out.push(h);
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push(make(doc, "hr", "md-rule"));
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push(lines[i].replace(/^ {0,3}> ?/, ""));
        i += 1;
      }
      const quote = make(doc, "blockquote", "md-quote");
      put(quote, blocks(ctx, inner, depth + 1));
      out.push(quote);
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const result = list(ctx, lines, i, leadW(item[1]), depth);
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
    put(p, inline(ctx, text.join(" ")));
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
  const ctx: Context = {
    doc,
    top,
    onLinkClick: options.onLinkClick,
    onLinkMenu: options.onLinkMenu,
    allowNativeLinkMenu: options.allowNativeLinkMenu,
  };
  // Tabs stay as they are: code keeps them, and the indent of a line is measured with leadW.
  const lines = options.source.replace(/\r\n?/g, "\n").split("\n");
  put(root, blocks(ctx, lines, 0));
  return root;
}
