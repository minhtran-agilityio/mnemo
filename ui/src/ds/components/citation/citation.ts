// A citation: a numbered link to a source, and a "?" mark for a claim with no source. The source
// list under an answer names each source with its app and age. A claim with no source says so.
import {
  type AppId,
  createAppBadge,
  createMetaLine,
} from "../metadata-line/metadata-line";
import "./citation.css";

export function createCite(
  doc: Document,
  n: number,
  href = "#",
): HTMLAnchorElement {
  const a = doc.createElement("a");
  a.className = "cite";
  a.href = href;
  a.textContent = String(n);
  a.setAttribute("aria-label", `Source ${n}`);
  return a;
}

/** The mark of a claim with no source. It is text ("?") with a name, not colour alone. */
export function createMissingCite(doc: Document): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = "cite missing";
  span.textContent = "?";
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", "No source");
  return span;
}

export interface SourceItem {
  readonly title: string;
  readonly app: AppId;
  readonly age: string;
}

export function createSourceList(
  doc: Document,
  items: readonly SourceItem[],
): HTMLOListElement {
  const ol = doc.createElement("ol");
  ol.className = "srcs";
  ol.setAttribute("aria-label", "Sources");
  items.forEach((item, i) => {
    const li = doc.createElement("li");
    const n = doc.createElement("span");
    n.className = "cite";
    n.textContent = String(i + 1);
    n.setAttribute("aria-hidden", "true");
    const title = doc.createElement("span");
    title.className = "src-title";
    title.textContent = item.title;
    title.title = item.title;
    li.append(
      n,
      title,
      createMetaLine(doc, [createAppBadge(doc, item.app), item.age]),
    );
    ol.append(li);
  });
  return ol;
}

/** Builds the paragraph of an answer: text, citations and missing-source marks in order. */
export function createAnswer(
  doc: Document,
  parts: readonly (string | Node)[],
): HTMLParagraphElement {
  const p = doc.createElement("p");
  p.className = "answer";
  for (const part of parts) {
    p.append(typeof part === "string" ? doc.createTextNode(part) : part);
  }
  return p;
}
