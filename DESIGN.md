# Mnemo design contract

This file is the one written style contract for the Mnemo UI. Every agent and person who builds UI follows it. It keeps the current Mnemo style. It adds no new palette. The theme choice (System, Light, Dark) shipped with #12.

Each rule has a **Check** line: who or what can confirm the rule. "Test" means an automated test. "Review" means a person reads the diff or the screen. Rules marked **Planned** depend on a ticket that has not shipped; until then the check is "Review".

Related files: `.claude/rules/design.md` (UX and accessibility rules), `.claude/rules/frontend.md` (UI code rules), `docs/decisions/design-tokens.md` (why the tokens look as they do).

## 1. Style principles

1. **Keep the prototype look.** The visual source of truth is the prototype's default pair: light (`.th.s-v1`) and dark (`.th.s-v1.t-dark`). Check: Review against the prototype (https://claude.ai/artifact/77KLF6DA2WFCMescbP92Vf).
2. **No new palette, font or component style** without a change to this file in the same pull request. Check: Review. Any diff to `ui/src/ds/tokens.css` colour values or to font imports in `ui/src/fonts.ts` must also change `DESIGN.md`.
3. **Light and dark both work.** The app follows the system through `prefers-color-scheme`, unless the owner picks Light or Dark in Settings (the `data-theme` attribute on the root). Check: Review each screen in both modes; Test (`ui/src/frame/theme.test.ts`).
4. **Calm and plain.** No decorative gradients, glows, glass effects or stock "AI" styling. Check: Review.
5. **One primary action per view.** Secondary actions look quieter. Check: Review.
6. **Colour is never the only signal.** Pair it with text or an icon. Check: Review.
7. **Text that the system wrote or guessed is labelled** so the owner can tell it from their own input (shared rule 1 and 8 in `CLAUDE.md`). Check: Review.
8. **Accessibility target is WCAG 2.2 AA:** text contrast 4.5:1 (3:1 for large text, control borders and focus rings); click targets at least 24 by 24 CSS pixels, primary controls at least 44 by 44; focus always visible. Check: Review. Contrast of the ported palette is **Unverified** until the contrast test in #104. Control borders use `--control-edge` (section 3), measured at 3.19 to 3.70:1 in light and 3.27 to 3.94:1 in dark on card, paper and head; `--line` on card is 1.28:1 and is not used for control borders.

## 2. Style source

| Item | Value | Where it lives |
| --- | --- | --- |
| Colours, both themes | Prototype default light and dark pair | `ui/src/ds/tokens.css` (the only file with colour values) |
| Body font | Source Sans 3 (400, 600, 700) | `ui/src/fonts.ts`, package `@fontsource/source-sans-3` |
| Mono font | JetBrains Mono (400, 600) | `ui/src/fonts.ts`, package `@fontsource/jetbrains-mono` |
| Base styles | page, card, button, input, pill, list row | `ui/src/ds/base.css` |

Rules:

- Fonts are bundled locally. No remote font link and no CDN script. Check: Review; `grep -rn "fonts.googleapis" ui/` prints nothing.
- No raw colour value (hex, `rgb`, `hsl`, `oklch`, named colour) outside `ui/src/ds/tokens.css`. Check: Test (`tests/raw-colour.test.mjs`, runs in `npm test`).
- Every size, radius, shadow and spacing value in a component rule is a `var(--token)`. Check: Review. A later test may enforce it.

## 3. Token groups

All tokens are CSS custom properties on `:root` in `ui/src/ds/tokens.css`. Dark values override the colour tokens twice, as shipped with #12: in `:root[data-theme="dark"]` and in `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`. These selectors stay as they are. A token that exists in light must exist in dark. Check: Review of the diff; Test (`ui/src/frame/theme.test.ts` checks the two dark blocks are equal).

| Group | Tokens | Use |
| --- | --- | --- |
| Surface and text | `--paper`, `--card`, `--head`, `--ink`, `--ink2`, `--muted`, `--line`, `--edge`, `--dotc`, `--player` | Page, card, header, text levels, borders |
| Accent and state | `--accent`, `--accent-hover`, `--on-accent`, `--accent-soft`, `--chip-ink`, `--warn-soft`, `--warn-ink`, `--bad`, `--bad-soft`, `--guess-ink`, `--good`, `--good-soft`, `--hl` | Primary action, warning, error, success, guessed text, highlight |
| Tints | `--tint-info`, `--tint-note`, `--tint-warn`, `--tint-good`, `--tint-bad`, `--tint-neutral` | Soft backgrounds for pills and columns |
| Connector brands | `--app-telegram`, `--app-zalo`, `--app-slack`, `--app-gmail`, `--app-gcal`, `--app-github`, `--app-gdrive`, `--app-bot`, `--app-tok`, `--app-ink` | Connector badges only. Same in light and dark |
| Shadow and motion | `--shadow`, `--sh1`, `--sh2`, `--sh2-near`, `--sh2-far`, `--ease` | Elevation and easing |
| Type | `--font-body`, `--font-mono`, `--text-xs`, `--text-sm`, `--text-md`, `--text-lg`, `--text-base`, `--text-xl`, `--text-2xl`, `--weight-regular`, `--weight-semibold`, `--weight-bold`, `--leading-body` | Font family, size, weight, line height |
| Spacing | `--space-1` to `--space-6` (4, 8, 12, 16, 20, 32 px) | Padding, gap, margin |
| Radius | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill` | Corners |
| Control | `--control-height`, `--focus-ring` | Click target height, focus ring width |
| Sidebar | `--sidebar-width` (260px), `--sidebar-width-collapsed` (72px) | Sidebar width open and collapsed. Moved from the frame's old sidebar style sheet into the token file in #104, same names |
| Sidebar icons and motion | `--icon-nav` (18px), `--icon-stroke-nav` (1.8), `--dur-nav` (150ms) | The sidebar part's icon size and stroke width, and its fold and chevron motion. Added in #111 with the values the sidebar shipped with |
| App frame | `--size-frame-height` (100vh), `--size-section-list-max` (14rem) | The height of the frame and the sticky sidebar; the widest the Settings section list grows. Added in #111 so `ui/src/style.css` and `settings.css` hold token values only |

### Approved tokens added in #104

The owner approved these with the UI Catalog prototype v3 (https://claude.ai/artifact/MbAwSzt4GxXmzTFevfAcHb). #104 added them to `ui/src/ds/tokens.css`.

| Token | Value | Use |
| --- | --- | --- |
| `--control-height-primary` | 44px | Primary buttons |
| `--control-edge` | light `#80858f`, dark `#6b7184` | Border of text inputs, textarea, select, search, filter chips and tag input. Cards, dividers and rows keep `--line` |
| `--on-bad` | light `#ffffff`, dark `#0b1033` | Text on a danger button |
| `--scrim` | `color-mix(in srgb, var(--player) 55%, transparent)` | Dialog backdrop. Support in WebKitGTK on Ubuntu 22.04 is **Unverified**; where `color-mix()` is not understood, `tokens.css` falls back to `--player` at 55% for each theme |

Container queries (`@container` in `ui/src/ds/catalog/tools.css`, used only by the UI Catalog dev tool to hide the sample window below 480px) need a newer WebKitGTK than some Ubuntu 22.04 builds ship, so support there is **Unverified**. Without them the layout still works: the sample window stays visible at any width and the note that replaces it stays hidden. The app screens do not use them. (`:has()` is not used.)

Proposed in the prototype and settled in #104 (values still **Unverified** in a real window): motion (`--dur-fast` 120ms, `--dur-base` 200ms, `--dur-slow` 1200ms), layers (`--z-sticky` 20, `--z-popover` 50, `--z-toast` 200), icon sizes (`--icon-sm` 16px, `--icon-md` 20px), border widths (`--border-1` 1px, `--border-2` 2px). #111 added `--icon-nav` (18px) and `--icon-stroke-nav` (1.8) for the sidebar icons and `--dur-nav` (150ms) for its motion (see the Sidebar rows above).

### Catalog sizes added in #105

The UI Catalog tabs need fixed lengths that no token covered (prototype v3 uses them in controls, feedback, surfaces, records, lists, limits, the specimen window, Inspect and Find). #105 added them to `ui/src/ds/tokens.css` in one group named "Catalog sizes", so the tabs built later add no token. Sizes are the same in light and dark. Values are **Unverified** in a real window. Media query breakpoints (720px, 1100px) cannot use a token and stay as numbers. A part that needs a length that is not here adds a token in its own pull request.

| Token | Value |
| --- | --- |
| `--size-page-max` | 1240px |
| `--size-label-min` | 180px |
| `--size-label-max` | 220px |
| `--size-label-duo-min` | 150px |
| `--size-label-duo-max` | 190px |
| `--size-basis-example` | 260px |
| `--size-basis-banner` | 240px |
| `--size-basis-column` | 220px |
| `--size-basis-decisions` | 420px |
| `--size-basis-tabs` | 520px |
| `--size-basis-setting` | 160px |
| `--size-decisions-max` | 640px |
| `--size-cov-bar` | 160px |
| `--measure-intro` | 72ch |
| `--measure-sub` | 70ch |
| `--measure-answer` | 62ch |
| `--size-tap-min` | 24px |
| `--size-tap-sm` | 32px |
| `--size-row-menu` | 36px |
| `--size-row-compact` | 28px |
| `--size-tag-input` | 30px |
| `--size-field-max` | 320px |
| `--size-copy-line-min` | 12rem |
| `--size-textarea-min` | 88px |
| `--size-tags-max` | 360px |
| `--size-tag-input-min` | 80px |
| `--size-link-sub-min` | 6.75rem |
| `--size-link-site-min` | 8ch |
| `--size-label-picker-max` | 280px |
| `--size-menu-min` | 220px |
| `--size-menu-max` | 320px |
| `--size-toggle-width` | 40px |
| `--size-toggle-height` | 24px |
| `--size-toggle-knob` | 18px |
| `--size-toggle-travel` | 16px |
| `--size-kbd-min` | 22px |
| `--size-cite` | 22px |
| `--size-icon-lg` | 24px |
| `--size-swatch` | 28px |
| `--size-dot` | 8px |
| `--size-dot-sm` | 6px |
| `--size-meter-max` | 320px |
| `--size-meter-height` | 10px |
| `--size-meter-tick-overhang` | 3px |
| `--size-progress-max` | 280px |
| `--size-progress-height` | 6px |
| `--size-skeleton-width` | 260px |
| `--size-skeleton-line` | 12px |
| `--size-toast-max` | 420px |
| `--size-state-max` | 380px |
| `--size-dialog-width` | 480px |
| `--size-dialog-static-max` | 440px |
| `--size-kcard-width` | 240px |
| `--size-column-max` | 320px |
| `--size-table-min` | 560px |
| `--size-tree-max` | 360px |
| `--leading-chip-sm` | 16px |
| `--leading-chip` | 18px |
| `--leading-tag` | 20px |
| `--leading-label` | 22px |
| `--size-mini-height` | 340px |
| `--size-list-height` | 280px |
| `--size-range` | 220px |
| `--size-specimen-width` | 1040px |
| `--size-specimen-height` | 560px |
| `--size-titlebar` | 30px |
| `--size-specimen-meter` | 64px |
| `--size-inspect-width` | 300px |
| `--size-inspect-swatch` | 12px |
| `--size-palette-width` | 560px |
| `--size-palette-list-max` | 420px |
| `--size-typecap` | 140px |
| `--size-spacebar` | 12px |
| `--size-space-label` | 90px |
| `--size-radbox-width` | 64px |
| `--size-radbox-height` | 48px |
| `--size-shbox-width` | 120px |
| `--size-shbox-height` | 64px |
| `--size-swatch-role-width` | 56px |
| `--size-icon-cell` | 64px |
| `--size-token-bar-max` | 200px |
| `--tracking-caption` | 0.02em |
| `--tracking-caps` | 0.06em |

#171 added `--size-link-sub-min` for the List row's body and summary line. #172 raised it from 6rem (96px, narrower than the 104.5px "Written by AI" label in Chrome) to 6.75rem (108px), so it holds a whole label, and added `--size-link-site-min` (8ch of the site's font, 52.8px in Chrome): the smallest width of the site in a List row before its date goes to the next line. #175 uses `--size-link-site-min` in the Compact row too, with no new token: the smallest width of a cut title (8ch of the title's font, 55.7px in Chrome) and of a cut site, so the site is cut before the title drops under it, and a narrow list puts the date on a second line instead. Both are checked in Chrome by `tests/acceptance/ds-09-limits.test.mjs`; **Unverified** in WebKit and WebKitGTK.

Rules:

- Add a token before using a new value. A token needs a name from the group above or a new group row in this file. Check: Review.
- Token names in this table match the names in `ui/src/ds/tokens.css`. Check: Review; `grep -o -- "--[a-z0-9-]*:" ui/src/ds/tokens.css | sort -u` lists the names to compare.
- Connector brand tokens (`--app-*`) are used only for connector badges. Check: Review.

### Sizes, icons and fixed choices

- Primary buttons are 44px tall (`--control-height-primary`). Other controls are `--control-height` (40px). Small buttons inside a row are 32px (`calc(var(--control-height) - var(--space-2))`). Check: Review in the UI Catalog.
- Each pill tint also sets its text colour: info uses `--chip-ink`, warn `--warn-ink`, bad `--guess-ink`, the others `--ink`. Check: Review; the contrast test in #104.
- Icons come from one set: Lucide (ISC licence, text in `licenses/LUCIDE-LICENSE.txt`, decision in `docs/decisions/icons.md`), bundled locally. Check: Review.
- The smallest window is 800 by 560 px, so the open sidebar (260px) leaves 540px for the page. It is set as `minWidth` and `minHeight` in `src-tauri/tauri.conf.json` by #113. The start size stays 900 by 640. Check: Review of the config; the Limits tab.
- The sidebar stays as shipped with #11: it collapses only when the owner clicks, the saved `sidebar_collapsed` choice always wins, it never folds by itself, and it shows no counts or badges. Check: Test (`tests/acceptance/app-02.test.mjs`); Review.

## 4. Naming rules

Components and classes:

1. Class names are lowercase kebab-case: `btn`, `btn-primary`, `row-title`. Check: Review; no camelCase or underscores in `ui/src/**/*.css` class selectors.
2. A component has a base class named after the component (`btn`, `card`, `pill`, `row`). A variant adds a suffix with a hyphen (`pill-warn`). A part adds the part name after the component (`row-title`, `row-meta`). Check: Review.
3. Name by role, not by look. Use `pill-warn`, not `pill-yellow`. No colour word, size in pixels or position word in a class name. Check: Review.
4. A component lives in its own folder in `ui/src/ds/components/<name>/` (`<name>.ts`, `<name>.css`, `<name>.test.ts`). Check: Review. The folder exists since #104.
5. A state is a modifier or an attribute, never a new component: `aria-busy`, `aria-invalid`, `disabled`, or a class `is-<state>` (`is-empty`, `is-loading`). Check: Review.
6. Token names: lowercase kebab-case, group prefix first (`--text-`, `--space-`, `--radius-`, `--tint-`, `--app-`). Check: Review.
7. UI labels name the action ("Save link"), not the mechanism ("Submit"). The same term is used for the same thing everywhere. Check: Review.

## 5. States every component must show

Every component that holds data or reacts to the owner shows these seven states, or the UI Catalog says in one line why a state does not apply.

| State | What the owner sees |
| --- | --- |
| Empty | What this is and what to do next |
| Loading | A pending indicator; no double submit. Progress shown for anything slower than 1 second |
| Success | The result, with feedback within 100 ms |
| Error | What happened and what the owner can do, in plain words. Never blank or frozen |
| Partial | What loaded and what did not (for example link saved, no summary) |
| Overflow | Long titles, names and URLs wrap or truncate with a way to see the full value |
| AI off | AI controls show why they are unavailable. Everything else still saves and reads |

Also required for every interactive component: default, hover, focus-visible, active and disabled. Check for the whole section: Review of the UI Catalog entry (each component has one example per state); Test (`ui/src/ds-guard.test.ts`): every component's registry entry lists its states or has a notes line saying why none applies. The entries that still miss both are listed in that test's `KNOWN_STATE_GAPS` (today: shortcut hint), and the list can only shrink.

## 6. Folder contract and pick-only rule

| Path | Role |
| --- | --- |
| `ui/src/ds/tokens.css` | Token values. The only file with colour values |
| `ui/src/ds/base.css` | Page-wide rules only (reset, body, headings, links, focus ring). No component rule |
| `ui/src/ds/icon.ts` | The one icon helper, `createIcon` (sizes `sm`, `md` and `nav`). Components import it; none keeps its own copy |
| `ui/src/ds/theme-root.ts` | The one place that writes the palette choice onto the root element (`data-theme` and `color-scheme`). `ui/src/frame/theme.ts` decides the choice and calls it |
| `ui/src/ds/components/<name>/` | One folder per component: `<name>.ts`, `<name>.css`, `<name>.test.ts`. The barrel of each catalog tab (`controls.ts`, `feedback.ts`, `surfaces.ts`, `records.ts`, `lists.ts`) exports them, and `ui/src/ds/index.ts` re-exports the barrels. Check: Test (`ui/src/ds-guard.test.ts`): each folder has a registry entry, a `<name>.test.ts` and exactly one barrel line |
| `ui/src/ds/` | The design system. **The only place that defines visual styles** (colour, font, size, spacing, radius, shadow, border) for a component |
| UI outside `ui/src/ds/` (`ui/src/screens/**`, `ui/src/frame/`, `ui/src/shared/`, `ui/src/*.ts`, `ui/src/style.css`, `ui/*.html`) | Layout only: where parts go, grid, flex, gap, which part to show. No visual style of its own, and no `button`, `input`, `select`, `textarea` or `dialog` of its own. There are no known exceptions: #111 moved the frame (sidebar, empty state, theme), Settings, the kanban proof, `ui/src/style.css` and the error page onto the parts of `ui/src/ds/`, and `KNOWN_EXCEPTIONS` in `tests/lib/ds-guard.mjs` is empty. An exception added there fails `tests/guard-exceptions-pinned.test.mjs` |
| `ui/src/screens/catalog/` | The UI Catalog is a dev tool, not in the release bundle. It is held to rule 1 and rule 5, and to rule 2 except for the files listed in `DEV_TOOL_EXCEPTIONS` in `tests/lib/ds-guard.mjs`. Each entry names one file and its reason (its own chrome: Find a part, Inspect, the specimen hotspots, the Limits range; the token specimens that set a token inline). The list names files, never the folder, so a new file in the folder is held to the guards |
Rules:

1. CSS outside `ui/src/ds/` does not set colour, font, radius, shadow or border, and defines no custom property, in a style sheet or inline (`node.style.x = ...`, `style.setProperty`, `style.cssText`, `setAttribute("style", ...)`, a `<style>` block or a `style="..."` attribute). It may set layout (`display`, `position`, `grid`, `flex`, `gap`, `padding`, `margin`, sizes, `overflow`) with token values, keywords, `0`, `%` or `fr`; motion only to switch it off (`none`). Check: Test (`tests/ds-screen-css.test.mjs`).
2. **Pick-only.** An agent never defines UI. It picks a part from `ui/src/ds/` by looking it up in the UI Catalog. Check: Review; the diff of a screen change imports from `ui/src/ds/` and adds no new component style. Test (`tests/ds-screen-elements.test.mjs`): code outside `ui/src/ds/` creates no `button`, `input`, `select`, `textarea` or `dialog` (no `createElement`, no tag helper call, no markup); it calls the builders from `ui/src/ds/`.
3. If the part is missing, the agent does not invent one. It follows the request flow in section 8. Check: Review; a UI component request issue exists for every new part.
4. `ui/src/ds/` changes only in a pull request that comes from a UI component request issue, and that updates the UI Catalog in the same pull request. Only the ui-designer agent (`.claude/agents/ui-designer.md`) makes it, with the label `design-system`. The guard configuration is protected the same way: `tests/lib/ds-guard.mjs` (the exception lists), `ui/src/ds-guard.test.ts` (its state gaps), the guard tests and `scripts/ds-write-guard.mjs` (the full list is `GUARD_FILES` in that script). Without that, a feature pull request could switch a guard off by adding an exception outside `ui/src/ds/`. The exception lists and the state gaps can only shrink: `tests/guard-exceptions-pinned.test.mjs` and `ui/src/ds-guard.test.ts` pin the current ones, so adding one fails. There are no known exceptions left; the pins hold only the UI Catalog dev tool files. One owner-approved pull request (#111) built five parts at once (sidebar, text, later mark, section list, choice list) to move the old screens; every other design pull request answers one request. Check: Test (the workflow "Design system write guard", `.github/workflows/ds-write-guard.yml`, `scripts/ds-write-guard.mjs`, unit test `tests/ds-write-guard.test.mjs`): a pull request whose diff (`git diff --name-only --no-renames base...head`, so a move lists both paths) has a path starting with `ui/src/ds/`, or a guard file, fails unless it has the label `design-system`. An empty diff passes. Adding or removing a label runs only this workflow again, not the build in `ci.yml`; "Re-run jobs" keeps the labels of the old run, so change the label to refresh it. The owner adds "Design system write guard" as a required check in the branch protection of `main`. The label is a speed bump, not an identity check: anyone can add it, and the owner's review is still the gate.
5. Raw colour values stay out of `ui/src/ds/` and `ui/src/screens/**`. Check: Test (`tests/raw-colour.test.mjs`).

Every component lives in `ui/src/ds/components/<name>/`; `ui/src/ds/base.css` holds page-wide rules only. Rules 1 and 2 have no known exceptions. A part that another part needs (the trust label, the spinner, the small button, the segmented choice, the tooltip) is imported, never copied. Check: Review; `grep -rn "function createIcon" ui/src/ds` shows one definition.

## 7. UI Catalog

The UI Catalog is the dev-only screen that shows every part in `ui/src/ds/`, with every state from section 5, in light and dark. It is the place an agent looks first. The name is "UI Catalog". No other name is used. Check: Review; a search of the repo for any other name for this screen finds nothing.

- **Dev-only.** It is not in the release bundle. A dev build (`npm run dev`) opens it at `#/ui-catalog`. Check: Test (`tests/acceptance/ds-03-catalog.test.mjs` builds the release and finds no UI Catalog code). Built in #105.
- **Tabs, in this order:** Foundations, Controls, Feedback, Surfaces, Records, Lists, Tokens, Limits. Check: Review against this list.

| Tab | Holds |
| --- | --- |
| Foundations | Fonts, type scale, spacing scale, radius scale, shadows, motion |
| Controls | Buttons, inputs, selects, toggles, links, with all interactive states |
| Feedback | Pills, banners, toasts, progress, empty, error, AI-off lines |
| Surfaces | Page, card, header, panel, dialog, overlay |
| Records | One item in each shape: link card in the three Bookmarks views (List, Cards, Compact), link card states, note row, task row, kanban card, citation, tag list, metadata line. Guessed text is labelled |
| Lists | Many items at once: list row, kanban column, table, tree, with long-content examples |
| Tokens | Every token from section 3, light and dark side by side, with its value |
| Limits | Messy content: very long titles, names and URLs, many items, smallest window size |

- **Parts per tab.** Controls: button, text input, textarea, search, checkbox, radio, toggle, segmented choice, filter chip, select, menu, popover, tag input, shortcut hint, link, choice list. Feedback: pill, dot, AI status light, usage meter, progress, spinner, skeleton, banner, toast, trust label, empty state, error state, AI-off state, text, later mark. Surfaces: nav rail, status bar, page header, card, panel, divider, tabs, page, dialog, confirm dialog, approval sheet, tooltip, context menu, sidebar. Records: link card (three views), note row, task row, kanban card, citation, tag list, metadata line. Lists: list, list row, kanban column, table, tree, section list. Limits: narrow width and 200% zoom, very long title, messy URLs, Vietnamese stacked marks, long values in parts, empty content, 1000 rows, reduced motion. The registry `ui/src/ds/catalog.ts` is the full list. Check: Test (`ui/src/ds/catalog.test.ts`); every built entry has a live row.
- **Parts that the app screens use (#111).** The old screens moved onto five parts built for them: `sidebar` (the app's side menu, `ui/src/ds/components/sidebar/`), `text` (notes, meta and status lines), `later-mark` (the Later word), `section-list` (the Settings section rows) and `choice-list` (the Settings Colours choice). The nav rail stays a sample of the menu's shape. There are no known exceptions: every screen picks its parts here.
- **Specimen window.** At the top, one Mnemo window built only from catalog parts and scaled to fit. A button over each part opens that part's row (Tab to it, Enter). "Show part names" labels them all. The window itself is inert. Check: Test (`ui/src/screens/catalog/catalog.test.ts`).
- **Inspect.** Key I, or the Inspect button, then hover or focus an example: the card shows text and ground tokens, contrast ratio, border contrast, target size against 24 and 44 px, font and radius, in the theme on screen. Escape leaves it. Check: Test (`colour.test.ts`, `catalog.test.ts`); Review in the browser.
- **Find a part.** Ctrl or Cmd K, or the Find a part button: a dialog that searches parts, tokens and actions, ignores Vietnamese marks, and opens the matching row. Arrows move, Enter opens, Escape closes, focus returns. Check: Test (`ui/src/screens/catalog/find.test.ts`).
- **Left out on purpose.** The prototype's "Both themes" view and its animated theme reveal are not in the UI Catalog. Light and Dark switch at once.
- **Source tag on every row:** `ds` (in `ui/src/ds/`), `base.css` (a base style in `ui/src/ds/base.css`) or `planned #N` (in an issue, not built yet). Check: Review.

How to pick a part:

1. Open the UI Catalog and find the tab that fits (the table above).
2. Find a part that does the job. Use it as it is, with its documented variants and states.
3. Import it from `ui/src/ds/`. Do not copy its CSS into a screen.
4. If no part fits, go to section 8.

## 8. Request flow for a missing part

The agent is [`.claude/agents/ui-designer.md`](.claude/agents/ui-designer.md). The request template is [`.github/ISSUE_TEMPLATE/ui-component-request.md`](.github/ISSUE_TEMPLATE/ui-component-request.md). One request is one issue and one pull request.

The **Storehouse keeper** is a long-running session named `Mnemo Storehouse`. It is the one place a feature agent asks about a part. Its role and message forms are in [`.claude/storehouse-keeper.md`](.claude/storehouse-keeper.md). The flow:

1. Before UI work, the feature agent searches the UI Catalog and `ui/src/ds/` for each part it needs, then asks the keeper: `ListAgents` to find `Mnemo Storehouse`, then `SendMessage` with a `UI-ASK` message (the fields of the request template, and its own session name).
2. The keeper answers `UI-EXISTS` with the part, its import and the variant or state to use. The feature agent picks that part and builds its screen itself. If the keeper answers `UI-QUEUED`, the feature agent stops its UI work for that part and goes on with the rest of its ticket.
3. For a missing part, the keeper files the request: a **UI component request** issue from the template (title `[UI-REQ] `, label `ui-component-request`) with the screen and ticket that need the part, what the part must do, which states from section 5 apply, real sample content, what was checked in the UI Catalog and `ui/src/ds/`, and a `Requested by:` line for each asking session. If the keeper session is not running, the feature agent files this issue itself and says so in its pull request.
4. The ui-designer agent, run by the keeper, picks up the issue. It builds the part in `ui/src/ds/components/<name>/` with tokens only and every state, adds the registry entry and the test, shows the part in its UI Catalog tab, and opens its own pull request with `Closes #<request>` and the label `design-system`, with light and dark screenshots of the catalog row on the `pr-assets` branch. This is the project rule that every pull request attaches screenshots (`.claude/rules/technical.md`), applied to a design pull request.
5. The owner approves the new part in its pull request and merges it.
6. After the design pull request is merged, the keeper sends `UI-READY` to every session on the issue's `Requested by:` lines, with the part and its import. The feature agent pulls `main`, picks the part and does its own UI work. It does not add a temporary style or element to a screen before that; the guards of section 6 fail one that does.

Check: Review; every new file or variant in `ui/src/ds/` links to a UI component request issue. Test: the write guard of section 6 rule 4 fails a `ui/src/ds/` change without the label `design-system`.

## 9. Changing this file

- A change to this file needs the owner's approval in the pull request.
- A new theme is a separate ticket. This file then gets a new section; it is not changed in place.
- Facts not checked yet are marked **Unverified**.
