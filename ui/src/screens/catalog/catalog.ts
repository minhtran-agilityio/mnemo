// The UI Catalog: the dev-only screen that shows every part of the design system and every token,
// drawn from the registry in ui/src/ds/catalog.ts. main.ts loads it only in a dev build, so it is
// not in the release bundle. Two switches sit at the top: Motion (stops all transitions) and
// Light or Dark (uses the shipped theme mechanism and saves nothing). All text goes in as text.

import "../../ds/catalog.css";
import "./catalog.css";
import { Bell, Check, type IconNode, Link, Search, Settings } from "lucide";
import {
  type BuiltEntryName,
  CATALOG_TABS,
  type CatalogEntry,
  type CatalogTab,
  coverage,
  entriesFor,
  isBuilt,
  TOKEN_GROUPS,
  type TokenKind,
  tokensOfKind,
} from "../../ds/catalog";
import { createIcon } from "../../ds/index";
import { applyTheme, type Theme } from "../../frame/theme";

export { tokenNames } from "../../ds/catalog";

export interface CatalogOptions {
  /** The frame's theme. Teardown puts it back, so the switch here never outlives the screen. */
  getTheme: () => Theme;
  /** The element that carries data-theme and data-motion. Defaults to the document root. */
  root?: HTMLElement;
}

/** Shown in the Value column when a token has no value in the current theme. */
const NOT_SET = "not set in this theme";

const ICONS: ReadonlyArray<[string, IconNode]> = [
  ["Search", Search],
  ["Link", Link],
  ["Settings", Settings],
  ["Check", Check],
  ["Bell", Bell],
];

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const title = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** True when the media query matches. A window without matchMedia matches nothing. */
function matches(win: Window | null, query: string): boolean {
  return typeof win?.matchMedia === "function" && win.matchMedia(query).matches;
}

/** The light or dark palette on screen now: the data-theme attribute, else the system setting. */
function effectiveTheme(root: HTMLElement): "light" | "dark" {
  const set = root.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return matches(root.ownerDocument.defaultView, "(prefers-color-scheme: dark)")
    ? "dark"
    : "light";
}

/** The source tag as a pill with text, so colour is never the only signal. */
function sourcePill(doc: Document, entry: CatalogEntry): HTMLElement {
  const kind =
    entry.source === "ds"
      ? "pill-good"
      : isBuilt(entry)
        ? "pill-info"
        : "pill-note";
  return el(doc, "span", `pill ${kind}`, entry.source);
}

/** Name, source tag, variants, states and the note of one entry. */
function entryMeta(doc: Document, entry: CatalogEntry): HTMLElement {
  const meta = el(doc, "dl", "cat-meta");
  const add = (term: string, value: string | HTMLElement) => {
    const dd = el(doc, "dd");
    dd.append(value);
    meta.append(el(doc, "dt", undefined, term), dd);
  };
  add("Source", sourcePill(doc, entry));
  add("Variants", entry.variants.length ? entry.variants.join(", ") : "none");
  add(
    "States",
    entry.states.length ? entry.states.join(", ") : "none listed yet",
  );
  if (entry.notes) add("Note", entry.notes);
  return meta;
}

function group(doc: Document, ...children: HTMLElement[]): HTMLElement {
  const box = el(doc, "div", "cat-group");
  box.append(...children);
  return box;
}

function button(
  doc: Document,
  className: string,
  text: string,
): HTMLButtonElement {
  const b = el(doc, "button", className, text);
  b.type = "button";
  return b;
}

// One renderer for each built part outside Foundations and Tokens. The key type comes from the
// registry, so a part that is built without a renderer here is a type error.
const RENDERERS: Record<BuiltEntryName, (doc: Document) => HTMLElement> = {
  button: (doc) => {
    const disabled = button(doc, "btn", "Disabled");
    disabled.disabled = true;
    return group(
      doc,
      button(doc, "btn", "Cancel"),
      button(doc, "btn btn-primary", "Save link"),
      button(doc, "btn btn-ghost", "Learn more"),
      disabled,
    );
  },
  input: (doc) => {
    const box = el(doc, "div", "cat-stack");
    const field = (label: string, setup: (input: HTMLInputElement) => void) => {
      const wrap = el(doc, "label", "field", label);
      const input = el(doc, "input", "input");
      input.type = "url";
      input.placeholder = "https://example.com";
      setup(input);
      wrap.append(input);
      return wrap;
    };
    const error = el(
      doc,
      "p",
      "cat-note",
      "Enter a full link that starts with https://.",
    );
    error.id = "cat-input-error";
    box.append(
      field("Link", () => {}),
      field("Link (invalid)", (input) => {
        input.value = "example";
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", error.id);
      }),
      error,
      field("Link (disabled)", (input) => {
        input.disabled = true;
      }),
    );
    return box;
  },
  pill: (doc) =>
    group(
      doc,
      el(doc, "span", "pill", "Draft"),
      el(doc, "span", "pill pill-info", "Link"),
      el(doc, "span", "pill pill-good", "Saved"),
      el(doc, "span", "pill pill-warn", "Guess"),
      el(doc, "span", "pill pill-note", "Idea"),
      el(doc, "span", "pill pill-bad", "Failed"),
    ),
  card: (doc) => {
    const card = el(doc, "article", "card");
    card.append(
      el(doc, "h4", undefined, "Card title"),
      el(
        doc,
        "p",
        undefined,
        "A card holds one item. Text, border and surface come from tokens.",
      ),
    );
    return card;
  },
  page: (doc) => {
    const page = el(doc, "div", "page");
    page.append(
      el(
        doc,
        "p",
        undefined,
        "The page is the reading column. It keeps lines to about seventy characters so long text stays easy to read.",
      ),
    );
    return page;
  },
  "list row": (doc) => {
    const list = el(doc, "ul", "list");
    for (const [name, meta] of [
      ["Read the design notes", "Today"],
      [
        "A very long title that is cut off with an ellipsis when the row is too narrow to show all of it",
        "Yesterday",
      ],
      ["Plan the week", "Mon"],
    ]) {
      const row = el(doc, "li", "row");
      const rowTitle = el(doc, "span", "row-title", name);
      rowTitle.title = name;
      row.append(rowTitle, el(doc, "span", "row-meta", meta));
      list.append(row);
    }
    return list;
  },
};

const hasRenderer = (name: string): name is BuiltEntryName => name in RENDERERS;

/** One specimen row: the token name as code next to its sample. */
function specimen(
  doc: Document,
  name: string,
  sample: HTMLElement,
): HTMLElement {
  const row = el(doc, "div", "cat-specimen");
  row.append(sample, el(doc, "code", undefined, name));
  return row;
}

/** The sample for each Foundations section, drawn from the token groups. */
function foundation(doc: Document, entry: CatalogEntry): HTMLElement {
  const box = el(doc, "div", "cat-stack");
  const sampleOf = (
    kind: TokenKind,
    styler: (node: HTMLElement, name: string) => void,
  ) => {
    const grid = el(doc, "div", "cat-grid");
    for (const name of tokensOfKind(kind)) {
      const node = el(doc, "div", `cat-sample cat-sample-${kind}`);
      styler(node, name);
      grid.append(specimen(doc, name, node));
    }
    return grid;
  };
  switch (entry.name) {
    case "type": {
      for (const name of tokensOfKind("font")) {
        const text = el(
          doc,
          "p",
          "cat-type",
          "Save the link now and read it later.",
        );
        if (name.startsWith("--font-")) text.style.fontFamily = `var(${name})`;
        else if (name.startsWith("--text-"))
          text.style.fontSize = `var(${name})`;
        else if (name.startsWith("--weight-"))
          text.style.fontWeight = `var(${name})`;
        else text.style.lineHeight = `var(${name})`;
        box.append(specimen(doc, name, text));
      }
      break;
    }
    case "colour": {
      for (const g of TOKEN_GROUPS.filter((x) => x.kind === "colour")) {
        box.append(el(doc, "h4", undefined, g.group));
        const grid = el(doc, "div", "cat-grid");
        for (const name of g.names) {
          const swatch = el(doc, "div", "cat-swatch");
          swatch.style.background = `var(${name})`;
          grid.append(specimen(doc, name, swatch));
        }
        box.append(grid);
      }
      break;
    }
    case "spacing":
      box.append(
        sampleOf("space", (node, name) => {
          node.className = "cat-bar";
          node.style.width = `var(${name})`;
        }),
      );
      break;
    case "radius":
      box.append(
        sampleOf("radius", (node, name) => {
          node.className = "cat-radius";
          node.style.borderRadius = `var(${name})`;
        }),
      );
      break;
    case "shadow":
      box.append(
        sampleOf("shadow", (node, name) => {
          node.className = "cat-shadow";
          node.style.boxShadow = `var(${name})`;
          node.textContent = name.slice(2);
        }),
      );
      break;
    case "motion": {
      box.append(
        el(
          doc,
          "p",
          "cat-note",
          "The dot moves while Motion is on. Turn Motion off to stop it.",
        ),
      );
      const track = el(doc, "div", "cat-motion-track");
      track.append(el(doc, "div", "cat-motion-dot"));
      box.append(track);
      for (const name of tokensOfKind("motion"))
        box.append(el(doc, "p", "cat-note", name));
      break;
    }
    case "icons": {
      const grid = el(doc, "div", "cat-grid");
      for (const [name, node] of ICONS) {
        const cell = el(doc, "div", "cat-specimen");
        cell.append(
          createIcon(node, "sm"),
          createIcon(node, "md"),
          el(doc, "span", undefined, name),
        );
        grid.append(cell);
      }
      box.append(grid);
      break;
    }
  }
  return box;
}

/** One registry entry: heading, meta and, when built, its example. */
function entryBlock(doc: Document, entry: CatalogEntry): HTMLElement {
  const block = el(doc, "article", "cat-entry");
  block.append(
    el(doc, "h3", undefined, title(entry.name)),
    entryMeta(doc, entry),
  );
  if (entry.tab === "Foundations") block.append(foundation(doc, entry));
  else if (hasRenderer(entry.name)) block.append(RENDERERS[entry.name](doc));
  else if (!isBuilt(entry))
    block.append(el(doc, "p", "cat-note", `Not built yet: ${entry.source}.`));
  return block;
}

/** The Tokens table. Returns the table and a function that reads the values again. */
function tokenTable(
  doc: Document,
  root: HTMLElement,
): [HTMLElement, () => void] {
  const wrap = el(doc, "div", "cat-table-wrap");
  const table = el(doc, "table", "cat-table");
  const head = el(doc, "tr");
  for (const name of ["Name", "Group", "Value", "Sample"]) {
    const th = el(doc, "th", undefined, name);
    th.scope = "col";
    head.append(th);
  }
  table.append(el(doc, "thead"), el(doc, "tbody"));
  table.tHead?.append(head);
  const values: Array<[string, HTMLElement]> = [];
  for (const g of TOKEN_GROUPS) {
    for (const name of g.names) {
      const row = el(doc, "tr");
      const nameCell = el(doc, "td");
      nameCell.append(el(doc, "code", undefined, name));
      const value = el(doc, "td");
      const sample = el(doc, "td");
      if (g.kind === "colour") {
        const swatch = el(doc, "span", "cat-swatch cat-swatch-small");
        swatch.style.background = `var(${name})`;
        sample.append(swatch);
      }
      row.append(nameCell, el(doc, "td", undefined, g.group), value, sample);
      table.tBodies[0].append(row);
      values.push([name, value]);
    }
  }
  wrap.append(table);
  const refresh = () => {
    const view = doc.defaultView;
    const style = view ? view.getComputedStyle(root) : null;
    for (const [name, cell] of values) {
      const v = style?.getPropertyValue(name).trim() ?? "";
      cell.textContent = v || NOT_SET;
    }
  };
  refresh();
  return [wrap, refresh];
}

/**
 * Fills `screen` with the UI Catalog. Returns the teardown: it removes data-motion, puts the
 * frame's theme back and removes the listeners. Nothing here is saved.
 */
export function renderCatalog(
  screen: HTMLElement,
  options: CatalogOptions,
): () => void {
  const doc = screen.ownerDocument;
  const root = options.root ?? doc.documentElement;
  const view = doc.defaultView;
  const stop = new AbortController();
  const { signal } = stop;

  const wrap = el(doc, "div", "ui-catalog cat-layout");
  const header = el(doc, "header", "cat-header");
  const heading = el(doc, "div", "cat-stack");
  heading.append(
    el(doc, "h1", undefined, "UI Catalog"),
    el(doc, "p", "cat-note", "Dev only. Not in the release build."),
  );

  // Motion switch. Off sets data-motion="off" on the root, which stops every transition.
  const motion = el(doc, "button", "btn cat-switch");
  motion.type = "button";
  motion.setAttribute("role", "switch");
  const motionState = el(doc, "span", "cat-switch-state");
  motionState.setAttribute("aria-hidden", "true");
  motion.append(el(doc, "span", undefined, "Motion"), motionState);
  const setMotion = (on: boolean) => {
    motion.setAttribute("aria-checked", String(on));
    motionState.textContent = on ? "On" : "Off";
    if (on) root.removeAttribute("data-motion");
    else root.setAttribute("data-motion", "off");
  };
  setMotion(!matches(view, "(prefers-reduced-motion: reduce)"));
  motion.addEventListener(
    "click",
    () => setMotion(motion.getAttribute("aria-checked") !== "true"),
    { signal },
  );

  // Light or Dark: shows the palette at once through applyTheme. Nothing is saved.
  const themes = el(doc, "div", "cat-group");
  themes.setAttribute("role", "group");
  themes.setAttribute("aria-label", "Theme");
  const light = button(doc, "btn", "Light");
  const dark = button(doc, "btn", "Dark");
  themes.append(light, dark);
  let refreshTokens = () => {};
  const showTheme = (theme: "light" | "dark") => {
    light.setAttribute("aria-pressed", String(theme === "light"));
    dark.setAttribute("aria-pressed", String(theme === "dark"));
  };
  showTheme(effectiveTheme(root));
  for (const [b, theme] of [
    [light, "light"],
    [dark, "dark"],
  ] as const) {
    b.addEventListener(
      "click",
      () => {
        applyTheme(root, theme);
        showTheme(theme);
        refreshTokens();
      },
      { signal },
    );
  }

  const switches = el(doc, "div", "cat-switches");
  switches.append(motion, themes);
  header.append(heading, switches);

  // Tabs with a roving tabindex: arrows move and wrap, Home and End jump, selection follows focus.
  const tablist = el(doc, "div", "cat-tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "UI Catalog sections");
  const tabs: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];
  for (const tab of CATALOG_TABS) {
    const id = slug(tab);
    const t = button(doc, "cat-tab", tab);
    t.id = `cat-tab-${id}`;
    t.setAttribute("role", "tab");
    t.setAttribute("aria-controls", `cat-panel-${id}`);
    const panel = el(doc, "section", "cat-panel");
    panel.id = `cat-panel-${id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", t.id);
    panel.tabIndex = 0;
    const panelHead = el(doc, "div", "cat-stack");
    const { built, total } = coverage(tab);
    panelHead.append(
      el(doc, "h2", undefined, tab),
      el(doc, "p", "cat-note", `${built} of ${total} parts built`),
    );
    panel.append(panelHead);
    fillPanel(doc, panel, tab, root, (refresh) => {
      refreshTokens = refresh;
    });
    tabs.push(t);
    panels.push(panel);
    tablist.append(t);
  }

  const select = (index: number, focus: boolean) => {
    tabs.forEach((t, i) => {
      const on = i === index;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    if (focus) tabs[index].focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(i, false), { signal });
  });
  tablist.addEventListener(
    "keydown",
    (event) => {
      const at = tabs.indexOf(event.target as HTMLButtonElement);
      if (at < 0) return;
      const count = tabs.length;
      const moves: Record<string, number> = {
        ArrowRight: (at + 1) % count,
        ArrowLeft: (at - 1 + count) % count,
        Home: 0,
        End: count - 1,
      };
      const next = moves[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(next, true);
    },
    { signal },
  );
  select(0, false);

  wrap.append(header, tablist, ...panels);
  screen.replaceChildren(wrap);

  return () => {
    stop.abort();
    root.removeAttribute("data-motion");
    applyTheme(root, options.getTheme());
  };
}

/** Draws the entries of one tab into its panel. The Tokens tab also gets the token table. */
function fillPanel(
  doc: Document,
  panel: HTMLElement,
  tab: CatalogTab,
  root: HTMLElement,
  onTokens: (refresh: () => void) => void,
): void {
  for (const entry of entriesFor(tab)) {
    panel.append(entryBlock(doc, entry));
    if (tab === "Tokens") {
      const [table, refresh] = tokenTable(doc, root);
      panel.append(table);
      onTokens(refresh);
    }
  }
}
