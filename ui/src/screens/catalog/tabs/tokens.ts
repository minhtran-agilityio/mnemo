// The Tokens tab: every token in ds/tokens.css with its value in the theme on screen, one table
// for each group, and the text contrast of the main colour pairs. This file is the tab's
// renderer; the token groups are in ds/catalog.ts and the looks in ds/catalog/tokens.css.

import "../../../ds/catalog/tokens.css";
import { entriesFor, TOKEN_GROUPS } from "../../../ds/catalog";
import { buildTrustLabel } from "../../../ds/index";
import { el, sourceTag, type TabRenderer } from "../parts";

/** Shown in the Value column when a token has no value in the current theme. */
const NOT_SET = "not set in this theme";

/** [text, background]: the pairs the contrast table measures. */
const PAIRS: ReadonlyArray<[string, string]> = [
  ["--control-edge", "--card"],
  ["--control-edge", "--paper"],
  ["--on-bad", "--bad"],
  ["--ink", "--paper"],
  ["--ink", "--card"],
  ["--ink2", "--card"],
  ["--muted", "--paper"],
  ["--muted", "--card"],
  ["--muted", "--head"],
  ["--accent", "--card"],
  ["--accent", "--paper"],
  ["--on-accent", "--accent"],
  ["--on-accent", "--accent-hover"],
  ["--chip-ink", "--accent-soft"],
  ["--chip-ink", "--tint-info"],
  ["--warn-ink", "--warn-soft"],
  ["--guess-ink", "--tint-bad"],
  ["--bad", "--card"],
  ["--bad", "--bad-soft"],
  ["--on-accent", "--bad"],
  ["--good", "--card"],
  ["--ink", "--good-soft"],
  ["--ink", "--tint-note"],
  ["--ink", "--tint-neutral"],
  ["--paper", "--ink"],
  ["--app-ink", "--app-telegram"],
  ["--app-ink", "--app-zalo"],
  ["--app-ink", "--app-slack"],
  ["--app-ink", "--app-gmail"],
  ["--app-ink", "--app-gcal"],
  ["--app-ink", "--app-github"],
  ["--app-ink", "--app-gdrive"],
  ["--app-ink", "--app-bot"],
  ["--app-ink", "--app-tok"],
];

/** The red, green and blue of "#rgb" or "#rrggbb" as 0 to 1, or null for any other value. */
function parseHex(value: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  const at = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255;
  return [at(0), at(2), at(4)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The WCAG contrast ratio of two "#rrggbb" colours, or null when either is not a hex colour. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  const [l1, l2] = [luminance(ca), luminance(cb)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export const renderTokens: TabRenderer = (panel, ctx) => {
  const { doc, root } = ctx;
  const entry = entriesFor("Tokens")[0];
  const kindOf = (name: string, groupKind: string) => {
    if (groupKind === "colour") return "swatch";
    if (groupKind === "shadow") return "shadow";
    if (groupKind === "radius") return "radius";
    if (name.startsWith("--text-")) return "text";
    if (name.startsWith("--font-")) return "font";
    if (name.startsWith("--weight-")) return "weight";
    if (
      groupKind === "space" ||
      (groupKind === "size" && !name.startsWith("--measure-"))
    )
      return "bar";
    return "none";
  };

  const note = el(doc, "div", "cat-ex");
  note.append(sourceTag(doc, entry.source));
  if (entry.notes) note.append(el(doc, "span", "cat-note", entry.notes));
  panel.append(note);

  const out = el(doc, "div", "cat-stack");
  const values: Array<[string, HTMLElement]> = [];
  for (const g of TOKEN_GROUPS) {
    const box = el(doc, "div", "tok-group");
    const head = el(doc, "h3", undefined, g.group);
    head.append(
      " ",
      el(doc, "span", "cat-note cat-num", `${g.names.length} tokens`),
    );
    const wrap = el(doc, "div", "cat-table-wrap");
    const table = el(doc, "table", "cat-table");
    const tr = el(doc, "tr");
    for (const col of ["Name", "Value", "Sample"]) {
      const th = el(doc, "th", undefined, col);
      th.scope = "col";
      tr.append(th);
    }
    table.append(el(doc, "thead"), el(doc, "tbody"));
    table.tHead?.append(tr);
    table.dataset.tokens = g.group;
    for (const name of g.names) {
      const row = el(doc, "tr");
      const nameCell = el(doc, "td");
      nameCell.append(el(doc, "code", undefined, name));
      const valueCell = el(doc, "td", "tok-value");
      const sample = el(doc, "td");
      switch (kindOf(name, g.kind)) {
        case "swatch": {
          const s = el(doc, "span", "sw");
          s.style.background = `var(${name})`;
          sample.append(s);
          break;
        }
        case "shadow": {
          const s = el(doc, "span", "tok-sample-shadow");
          s.style.boxShadow = `var(${name})`;
          sample.append(s);
          break;
        }
        case "radius": {
          const s = el(doc, "span", "tok-sample-radius");
          s.style.borderRadius = `var(${name})`;
          sample.append(s);
          break;
        }
        case "text": {
          const s = el(doc, "span", undefined, "Lưu liên kết");
          s.style.fontSize = `var(${name})`;
          sample.append(s);
          break;
        }
        case "font": {
          const s = el(doc, "span", undefined, "Mnemo Ẫ 0123");
          s.style.fontFamily = `var(${name})`;
          sample.append(s);
          break;
        }
        case "weight": {
          const s = el(doc, "span", undefined, "Bookmarks");
          s.style.fontWeight = `var(${name})`;
          sample.append(s);
          break;
        }
        case "bar": {
          const s = el(doc, "span", "tok-sample-bar");
          s.style.width = `min(var(${name}), var(--size-token-bar-max))`;
          sample.append(s);
          break;
        }
        default:
          sample.append(el(doc, "span", "cat-note", "—"));
      }
      row.append(nameCell, valueCell, sample);
      table.tBodies[0].append(row);
      values.push([name, valueCell]);
    }
    wrap.append(table);
    box.append(head, wrap);
    out.append(box);
  }

  // Text contrast of the main pairs in the theme on screen. Unverified: the test in
  // tests/wcag-contrast.test.mjs is the check, this table is for looking.
  const cbox = el(doc, "div", "tok-group");
  const cheadText = el(doc, "span");
  const chead = el(doc, "h3", undefined, "Text contrast ");
  chead.append(cheadText, " ", buildTrustLabel("unverified"));
  const cnote = el(
    doc,
    "p",
    "cat-note",
    "WCAG 2.2 AA asks for 4.5:1 for body text and 3:1 for large text and control borders. Computed here, not by the test.",
  );
  const ctable = el(doc, "table", "cat-table");
  const ctr = el(doc, "tr");
  for (const col of ["Text", "On", "Sample", "Ratio", "AA text"]) {
    const th = el(doc, "th", undefined, col);
    th.scope = "col";
    ctr.append(th);
  }
  ctable.append(el(doc, "thead"), el(doc, "tbody"));
  ctable.tHead?.append(ctr);
  const summary = el(doc, "p", "cat-note");
  const cwrap = el(doc, "div", "cat-table-wrap");
  cwrap.append(ctable);
  cbox.append(chead, cnote, cwrap, summary);
  out.append(cbox);
  panel.append(out);

  const refresh = () => {
    const style = doc.defaultView?.getComputedStyle(root) ?? null;
    const read = (name: string) => style?.getPropertyValue(name).trim() ?? "";
    for (const [name, cell] of values) cell.textContent = read(name) || NOT_SET;

    const theme = root.getAttribute("data-theme");
    cheadText.textContent =
      theme === "dark" || theme === "light" ? `(${theme})` : "(current theme)";
    const body = ctable.tBodies[0];
    body.replaceChildren();
    let fails = 0;
    let measured = 0;
    for (const [fg, bg] of PAIRS) {
      const ratio = contrastRatio(read(fg), read(bg));
      if (ratio === null) continue;
      measured++;
      const ok = ratio >= 4.5;
      if (!ok) fails++;
      const row = el(doc, "tr");
      const sample = el(doc, "span", "tok-pair", "Lưu liên kết");
      sample.style.color = `var(${fg})`;
      sample.style.background = `var(${bg})`;
      const code = (t: string) => {
        const td = el(doc, "td");
        td.append(el(doc, "code", undefined, t));
        return td;
      };
      const sampleCell = el(doc, "td");
      sampleCell.append(sample);
      row.append(
        code(fg),
        code(bg),
        sampleCell,
        el(doc, "td", "cat-num", `${ratio.toFixed(2)}:1`),
        el(
          doc,
          "td",
          ok ? "cat-ok" : "cat-fail",
          ok ? "Pass" : ratio >= 3 ? "Large text only" : "Fail",
        ),
      );
      body.append(row);
    }
    summary.textContent = measured
      ? fails
        ? `${fails} pair(s) below 4.5:1 in this theme.`
        : "Every listed pair reaches 4.5:1 in this theme."
      : "The values are not readable here, so no ratio is shown.";
  };
  refresh();
  ctx.onThemeChange(refresh);
};
