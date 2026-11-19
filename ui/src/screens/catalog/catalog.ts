// The UI Catalog: the dev-only screen that shows every part of the design system and every token,
// drawn from the registry in ui/src/ds/catalog.ts. main.ts loads it only in a dev build, so it is
// not in the release bundle. Two switches sit in the tab bar: Motion (stops all transitions) and
// Light or Dark (uses the shipped theme mechanism and saves nothing). All text goes in as text.
//
// This file is the shared frame: header, coverage, decisions, tab bar and panels. Each tab fills
// its own panel from ./tabs/<tab>.ts, so a tab's work never edits this file.

import "../../ds/catalog.css";
import "../../ds/catalog/tools.css";
import "./catalog.css";
import { ChevronRight, Search } from "lucide";
import {
  CATALOG,
  CATALOG_TABS,
  type CatalogTab,
  coverage,
  entriesFor,
  sourceCounts,
  TAB_INTRO,
  TOKEN_GROUPS,
} from "../../ds/catalog";
import {
  createButton,
  createIcon,
  createKbd,
  createToastRegion,
} from "../../ds/index";
import { applyTheme, type Theme } from "../../frame/theme";
import { DECISIONS, DECISIONS_SUMMARY } from "./decisions";
import { createFinder, type FindItem } from "./find";
import { createInspector } from "./inspect";
import {
  button,
  el,
  headingOf,
  slug,
  sourceTag,
  type TabContext,
  type TabRenderer,
} from "./parts";
import { createSpecimen } from "./specimen";
import { renderControls } from "./tabs/controls";
import { renderFeedback } from "./tabs/feedback";
import { renderFoundations } from "./tabs/foundations";
import { renderLimits } from "./tabs/limits";
import { renderLists } from "./tabs/lists";
import { renderRecords } from "./tabs/records";
import { renderSurfaces } from "./tabs/surfaces";
import { renderTokens } from "./tabs/tokens";

export { tokenNames } from "../../ds/catalog";

export interface CatalogOptions {
  /** The frame's theme. Teardown puts it back, so the switch here never outlives the screen. */
  getTheme: () => Theme;
  /** The element that carries data-theme and data-motion. Defaults to the document root. */
  root?: HTMLElement;
}

/** The renderer of each tab. The type makes a tab without a renderer a compile error. */
const TAB_RENDERERS: Record<CatalogTab, TabRenderer> = {
  Foundations: renderFoundations,
  Controls: renderControls,
  Feedback: renderFeedback,
  Surfaces: renderSurfaces,
  Records: renderRecords,
  Lists: renderLists,
  Tokens: renderTokens,
  Limits: renderLimits,
};

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

/** Text with ‹code› parts: the parts go in as code elements, the rest as text. */
function richText(doc: Document, text: string): Array<string | Node> {
  return text
    .split(/‹([^›]*)›/)
    .map((part, i) => (i % 2 ? el(doc, "code", undefined, part) : part))
    .filter((node) => node !== "");
}

/** The coverage bar and the counts of one set of entries. */
function coverageLine(
  doc: Document,
  counts: { ds: number; base: number; plan: number },
): HTMLElement {
  const total = counts.ds + counts.base + counts.plan;
  const line = el(doc, "div", "cov");
  const bar = el(doc, "span", "cov-bar");
  bar.setAttribute("aria-hidden", "true");
  for (const [key, cls] of [
    ["ds", "cov-ds"],
    ["base", "cov-base"],
  ] as const) {
    const part = el(doc, "i", cls);
    part.style.width = `${total ? (counts[key] / total) * 100 : 0}%`;
    bar.append(part);
  }
  line.append(
    bar,
    el(
      doc,
      "span",
      "cat-num",
      `${counts.ds} of ${total} parts in ds · ${counts.base} in base.css · ${counts.plan} planned`,
    ),
  );
  return line;
}

/** The number on a tab: its rows, or for Tokens the tokens it lists. */
function tabCount(tab: CatalogTab): number {
  return tab === "Tokens"
    ? TOKEN_GROUPS.reduce((sum, g) => sum + g.names.length, 0)
    : entriesFor(tab).length;
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

  // Tabs ask to hear about a theme change (the Tokens tab reads its values again).
  const themeListeners: Array<() => void> = [];
  const themeChanged = () => {
    for (const fn of themeListeners) fn();
  };
  const toasts = createToastRegion();
  const ctx: TabContext = {
    doc,
    toast: (message) => {
      toasts.show(message);
    },
    root,
    signal,
    onThemeChange: (fn) => {
      themeListeners.push(fn);
    },
  };

  const wrap = el(doc, "div", "ui-catalog cat-layout");

  // Page header: title, dev-only tag, a line about what this is, and the legend of source tags.
  const head = el(doc, "header", "cat-head");
  const heading = el(doc, "div", "cat-stack");
  const h1 = el(doc, "h1", undefined, "UI Catalog");
  h1.append(el(doc, "span", "cat-devtag", "Dev build only"));
  heading.append(
    h1,
    el(
      doc,
      "p",
      "cat-sub",
      "Every part of the Mnemo design system, live, in every state. Screens pick parts from here; a part that is not on this page does not exist yet.",
    ),
  );
  const legend = el(doc, "div", "cat-legend");
  legend.setAttribute("aria-label", "Source tags");
  legend.append(
    sourceTag(doc, "ds"),
    " defined in ui/src/ds ",
    sourceTag(doc, "base.css"),
    " a base style in ds/base.css ",
    sourceTag(doc, "planned #N"),
    " listed in an issue, not built",
  );
  head.append(heading, legend);

  // Coverage of the whole registry, and the design decisions the owner approved.
  const status = el(doc, "div", "cat-status");
  const totals = el(doc, "div", "cat-stack");
  totals.append(
    el(doc, "b", "cat-total", "Built so far"),
    coverageLine(doc, sourceCounts()),
  );
  const decisions = el(doc, "details", "cat-decisions");
  const summary = el(doc, "summary");
  summary.append(createIcon(ChevronRight, "sm"), DECISIONS_SUMMARY);
  const list = el(doc, "ul");
  for (const text of DECISIONS) {
    const li = el(doc, "li");
    li.append(...richText(doc, text));
    list.append(li);
  }
  decisions.append(summary, list);
  status.append(totals, decisions);

  // The switches of the tab bar share one look: a track, a label and On or Off.
  const makeSwitch = (label: string) => {
    const b = el(doc, "button", "cat-switch");
    b.type = "button";
    b.setAttribute("role", "switch");
    const knob = el(doc, "span", "cat-switch-track");
    knob.append(el(doc, "span", "cat-switch-knob"));
    const stateText = el(doc, "span", "cat-switch-state");
    stateText.setAttribute("aria-hidden", "true");
    b.append(knob, el(doc, "span", undefined, label), stateText);
    const set = (on: boolean) => {
      b.setAttribute("aria-checked", String(on));
      stateText.textContent = on ? "On" : "Off";
    };
    set(false);
    return { b, set };
  };

  // Motion switch. Off sets data-motion="off" on the root, which stops every transition.
  const { b: motion, set: paintMotion } = makeSwitch("Motion");
  const setMotion = (on: boolean) => {
    paintMotion(on);
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
  const themes = el(doc, "div", "cat-seg");
  themes.setAttribute("role", "group");
  themes.setAttribute("aria-label", "Theme");
  const light = button(doc, "", "Light");
  const dark = button(doc, "", "Dark");
  themes.append(light, dark);
  const showTheme = (theme: "light" | "dark") => {
    light.setAttribute("aria-pressed", String(theme === "light"));
    dark.setAttribute("aria-pressed", String(theme === "dark"));
  };
  showTheme(effectiveTheme(root));
  const chooseTheme = (theme: "light" | "dark") => {
    applyTheme(root, theme);
    showTheme(theme);
    themeChanged();
  };
  for (const [b, theme] of [
    [light, "light"],
    [dark, "dark"],
  ] as const) {
    b.addEventListener("click", () => chooseTheme(theme), { signal });
  }

  // On the System theme the palette follows the OS at once, so the buttons and values follow too.
  const os = view?.matchMedia?.("(prefers-color-scheme: dark)");
  os?.addEventListener(
    "change",
    () => {
      const set = root.getAttribute("data-theme");
      if (set === "light" || set === "dark") return;
      showTheme(effectiveTheme(root));
      themeChanged();
    },
    { signal },
  );

  // Tab bar: the tabs with their counts on the left, the switches on the right.
  const tabbar = el(doc, "div", "cat-tabbar");
  const switches = el(doc, "div", "cat-switches");
  // Inspect is a toggle button (aria-pressed) with its state in words.
  const inspectSwitch = createButton(doc, { label: "Inspect", size: "sm" });
  const inspectState = el(doc, "span", "cat-switch-state", "Off");
  inspectSwitch.append(inspectState);
  inspectSwitch.setAttribute("aria-pressed", "false");
  inspectSwitch.setAttribute("aria-keyshortcuts", "I");
  inspectSwitch.title = "Shortcut: I";
  const paintInspect = (on: boolean) => {
    inspectSwitch.setAttribute("aria-pressed", String(on));
    inspectState.textContent = on ? "On" : "Off";
  };
  const isMac = /Mac|iPhone|iPad/.test(
    view?.navigator.platform || view?.navigator.userAgent || "",
  );
  const findButton = createButton(doc, {
    label: "Find a part",
    size: "sm",
    icon: Search,
  });
  findButton.setAttribute("aria-haspopup", "dialog");
  findButton.setAttribute("aria-keyshortcuts", isMac ? "Meta+K" : "Control+K");
  findButton.append(createKbd(doc, isMac ? "⌘K" : "Ctrl K"));
  switches.append(findButton, inspectSwitch, motion, themes);

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
    t.dataset.count = String(tabCount(tab));
    t.setAttribute("role", "tab");
    t.setAttribute("aria-controls", `cat-panel-${id}`);
    const panel = el(doc, "section", "cat-panel");
    panel.id = `cat-panel-${id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", t.id);
    panel.tabIndex = 0;
    const intro = el(doc, "div", "cat-intro");
    intro.append(
      el(doc, "h2", undefined, tab),
      el(doc, "p", undefined, TAB_INTRO[tab]),
    );
    if (coverage(tab).total) intro.append(coverageLine(doc, sourceCounts(tab)));
    panel.append(intro);
    TAB_RENDERERS[tab](panel, ctx);
    tabs.push(t);
    panels.push(panel);
    tablist.append(t);
  }
  tabbar.append(tablist, switches);

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

  // Opening a row: show its tab, scroll to it, flash it once and give it the focus.
  const rowFor = (name: string) =>
    [...wrap.querySelectorAll<HTMLElement>(".cat-row")].find(
      (r) => r.dataset.part === name,
    );
  const motionOn = () =>
    motion.getAttribute("aria-checked") === "true" &&
    !matches(view, "(prefers-reduced-motion: reduce)");
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const reveal = (node: HTMLElement) => {
    node.scrollIntoView?.({
      block: "center",
      behavior: motionOn() ? "smooth" : "auto",
    });
    node.classList.remove("flash");
    void node.offsetWidth;
    node.classList.add("flash");
    if (!node.hasAttribute("tabindex")) node.tabIndex = -1;
    node.focus({ preventScroll: true });
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => node.classList.remove("flash"), 1900);
  };
  signal.addEventListener("abort", () => clearTimeout(flashTimer));
  const jumpTo = (name: string) => {
    const row = rowFor(name);
    const at = panels.findIndex((p) => row && p.contains(row));
    if (!row || at < 0) return;
    select(at, false);
    reveal(row);
  };

  const specimen = createSpecimen(doc, { open: jumpTo, signal });

  // Inspect: the switch, the I key and the card follow one state.
  const inspector = createInspector(wrap, signal, paintInspect);
  inspectSwitch.addEventListener(
    "click",
    () => inspector.setOn(!inspector.isOn()),
    { signal },
  );

  // Find a part: the parts of every tab, the tokens and a few actions.
  const findItems = (): FindItem[] => {
    const items: FindItem[] = [];
    for (const entry of CATALOG) {
      if (!rowFor(entry.name)) continue;
      items.push({
        label: headingOf(entry),
        where: `${entry.tab} · ${entry.source}`,
        keywords: `${entry.name} ${entry.variants.join(" ")}`,
        run: () => jumpTo(entry.name),
      });
    }
    for (const g of TOKEN_GROUPS) {
      for (const name of g.names) {
        items.push({
          label: name,
          mono: true,
          where: `Tokens · ${g.group}`,
          run: () => {
            select(CATALOG_TABS.indexOf("Tokens"), false);
            const tr = [...wrap.querySelectorAll<HTMLElement>("tr")].find(
              (r) => r.dataset.token === name,
            );
            if (tr) reveal(tr);
          },
        });
      }
    }
    const motionIsOn = motion.getAttribute("aria-checked") === "true";
    items.push(
      {
        label: "Switch to dark",
        where: "Action",
        run: () => chooseTheme("dark"),
      },
      {
        label: "Switch to light",
        where: "Action",
        run: () => chooseTheme("light"),
      },
      {
        label: `Turn motion ${motionIsOn ? "off" : "on"}`,
        where: "Action",
        run: () => setMotion(!motionIsOn),
      },
      {
        label: `${inspector.isOn() ? "Stop" : "Start"} inspecting parts`,
        where: "Action · I",
        run: () => inspector.setOn(!inspector.isOn()),
      },
    );
    return items;
  };
  const finder = createFinder(wrap, signal, findItems);
  findButton.addEventListener("click", () => finder.open(findButton), {
    signal,
  });
  doc.addEventListener(
    "keydown",
    (event) => {
      const t = event.target;
      const typing =
        t instanceof HTMLElement &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        if (doc.querySelector("dialog[open]")) return;
        if (!finder.isOpen()) finder.open();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (finder.isOpen() || doc.querySelector("dialog[open]")) return;
      if (event.key === "i" || event.key === "I") {
        inspector.setOn(!inspector.isOn());
      }
    },
    { signal },
  );

  wrap.append(head, status, specimen, tabbar, ...panels, toasts.element);
  screen.classList.add("cat-screen");
  screen.replaceChildren(wrap);

  return () => {
    stop.abort();
    screen.classList.remove("cat-screen");
    root.removeAttribute("data-motion");
    applyTheme(root, options.getTheme());
  };
}
