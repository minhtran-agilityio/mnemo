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
| Sidebar | `--sidebar-width` (260px), `--sidebar-width-collapsed` (72px) | Sidebar width open and collapsed. Moved from `ui/src/frame/sidebar.css` into the token file in #104, same names |

### Approved tokens added in #104

The owner approved these with the UI Catalog prototype v3 (https://claude.ai/artifact/MbAwSzt4GxXmzTFevfAcHb). #104 added them to `ui/src/ds/tokens.css`.

| Token | Value | Use |
| --- | --- | --- |
| `--control-height-primary` | 44px | Primary buttons |
| `--control-edge` | light `#80858f`, dark `#6b7184` | Border of text inputs, textarea, select, search, filter chips and tag input. Cards, dividers and rows keep `--line` |
| `--on-bad` | light `#ffffff`, dark `#0b1033` | Text on a danger button |
| `--scrim` | `color-mix(in srgb, var(--player) 55%, transparent)` | Dialog backdrop. Support in WebKitGTK on Ubuntu 22.04 is **Unverified**; where `color-mix()` is not understood, `tokens.css` falls back to `--player` at 55% for each theme |

Proposed in the prototype and settled in #104 (values still **Unverified** in a real window): motion (`--dur-fast` 120ms, `--dur-base` 200ms, `--dur-slow` 1200ms), layers (`--z-sticky` 20, `--z-popover` 50, `--z-toast` 200), icon sizes (`--icon-sm` 16px, `--icon-md` 20px), border widths (`--border-1` 1px, `--border-2` 2px).

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

Also required for every interactive component: default, hover, focus-visible, active and disabled. Check for the whole section: Review of the UI Catalog entry (each component has one example per state). **Planned**: a test that lists the states in the UI Catalog is requested in #106.

## 6. Folder contract and pick-only rule

| Path | Role |
| --- | --- |
| `ui/src/ds/tokens.css` | Token values. The only file with colour values |
| `ui/src/ds/base.css` | Base styles |
| `ui/src/ds/` | The design system. **The only place that defines visual styles** (colour, font, size, spacing, radius, shadow, border) for a component |
| `ui/src/screens/**` | Layout only: where parts go, grid, flex, gap, which part to show. No visual style of its own |
| `ui/src/frame/`, `ui/src/screens/settings/`, `ui/src/screens/kanban/`, `ui/src/style.css` | Shipped before this contract and still hold their own CSS. They are known exceptions: #109 moves the sidebar into `ui/src/ds/`, #111 moves the rest and removes the exceptions |

Rules:

1. A screen file under `ui/src/screens/**` does not set colour, font, radius, shadow or border. It may set layout (`display`, `grid`, `flex`, `gap`, `margin`, `width`) using spacing tokens. Check: Review; **Planned**: a test that fails on those properties in `ui/src/screens/**/*.css` (requested in #106).
2. **Pick-only.** An agent never defines UI. It picks a part from `ui/src/ds/` by looking it up in the UI Catalog. Check: Review; the diff of a screen change imports from `ui/src/ds/` and adds no new component style.
3. If the part is missing, the agent does not invent one. It follows the request flow in section 8. Check: Review; a UI component request issue exists for every new part.
4. `ui/src/ds/` changes only in a pull request that comes from a UI component request issue, and that updates the UI Catalog in the same pull request. Check: Review.
5. Raw colour values stay out of `ui/src/ds/` and `ui/src/screens/**`. Check: Test (`tests/raw-colour.test.mjs`).

The base styles live in `ui/src/ds/base.css` (moved in #104).

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

- **Source tag on every row:** `ds` (in `ui/src/ds/`), `base.css` (exists today, moves into `ui/src/ds/` in #105) or `planned #N` (in an issue, not built yet). Check: Review.

How to pick a part:

1. Open the UI Catalog and find the tab that fits (the table above).
2. Find a part that does the job. Use it as it is, with its documented variants and states.
3. Import it from `ui/src/ds/`. Do not copy its CSS into a screen.
4. If no part fits, go to section 8.

## 8. Request flow for a missing part

Detail and templates are in #106. The flow:

1. The agent searches the UI Catalog and `ui/src/ds/` and finds no part, variant or state that fits.
2. The agent opens a **UI component request** issue. It states: the screen and ticket that need it, what the part must do, which states from section 5 apply, and what it checked in the UI Catalog.
3. A ui-designer agent picks up the issue, builds the part in `ui/src/ds/` using tokens only, and adds it to the UI Catalog with every state.
4. The original ticket continues only after that pull request merges. The agent does not add a temporary style to a screen.
5. The owner approves the new part in its pull request.

Check: Review; every new file or variant in `ui/src/ds/` links to a UI component request issue.

## 9. Changing this file

- A change to this file needs the owner's approval in the pull request.
- A new theme is a separate ticket. This file then gets a new section; it is not changed in place.
- Facts not checked yet are marked **Unverified**.
