# Design tokens and base styles

Source: the hub prototype's default pair, light (`.th.s-v1`) and dark (`.th.s-v1.t-dark`), with the prototype's cascade resolved (later rules win). Other themes (indigo, beige and the rest) are out of scope; the final theme list is an open roadmap question.

## What exists

- `ui/src/ds/tokens.css` is the only file with colour values. Light is on `:root`. Dark is under `@media (prefers-color-scheme: dark)`, so the app follows the system. It also holds type, spacing, radius and control-size tokens.
- `ui/src/ds/base.css` holds page, card, button, input, pill and list row. It uses `var(--token)` values only.
- `ui/src/screens/sample/` is a sample page that shows every base style. It is mounted on the main page until the real app frame replaces it.
- Fonts: `@fontsource/source-sans-3` (400, 600, 700) and `@fontsource/jetbrains-mono` (400, 600), latin subset, imported in `ui/src/fonts.ts` and bundled by Vite. No Google Fonts link. The OFL text is in `licenses/OFL.txt`. Licence checked in the package files: OFL 1.1.
- `tests/raw-colour.test.mjs` fails on hex, `rgb`/`hsl`/`oklch` and similar functions, or named colours in `ui/**/*.{css,ts,html}` outside `ui/src/ds/tokens.css`. It runs in `npm test` and `npm run check`.

## Choices

- Tokens keep the prototype names. The six `--o-*` tints are renamed `--tint-*` (info, note, warn, good, bad, neutral) so a rule such as `background: var(--tint-info)` holds no colour word.
- The connector brand colours (`--app-*`) are ported as they are in the prototype and are the same in light and dark.
- The theme picker (#12) can add an attribute selector that overrides the system choice. Nothing else needs to change.
- Not checked in a real window on macOS (WebKit) or Ubuntu (WebKitGTK): **Unverified**. Contrast ratios of the ported palette are **Unverified**.

## Moved in #104

- Tokens and base styles now live in `ui/src/ds/` (`tokens.css`, `base.css`, loaded by `ui/src/ds/index.ts`). Values are unchanged.
- New tokens: `--control-height-primary`, `--control-edge`, `--on-bad`, `--scrim`, motion (`--dur-*`), layers (`--z-*`), icon sizes (`--icon-*`), border widths (`--border-*`). The sidebar widths moved in from `ui/src/frame/sidebar.css`.
- `--scrim` has a plain `rgba()` fallback and an `@supports not` rule. `color-mix()` in WebKitGTK on Ubuntu 22.04 is **Unverified**.
