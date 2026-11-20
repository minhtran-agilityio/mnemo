---
paths:
  - "ui/**"
  - "**/*.{html,css,ts,tsx,js,mjs}"
  - "vite.config.ts"
  - "tsconfig.json"
---

# Frontend rules (web UI in the Tauri window)

The UI lives in `ui/`, is built by Vite to `dist/`, and runs in the system web view: WebKit on macOS, WebKitGTK on Ubuntu. It is not a website and has no server.

## Stack
- TypeScript in strict mode, HTML, CSS. No UI framework until the UI-library decision (#7); then use only the chosen library.
- Keep the prototype's HTML and CSS as the starting point for every screen.
- Ship as little JavaScript as each screen needs. The goal is low RAM and fast start.

## Talking to the core
- The UI reaches data and AI only through named Tauri commands (`invoke` from `@tauri-apps/api`). Wrap all commands in one typed client module in `ui/src/`; screens never call `invoke` directly.
- The UI never reads or writes files, spawns processes, or makes network calls to Claude. Do not request fs, shell or http plugins.
- Command results and errors are typed. Handle the `{ code, message }` error shape on every call.
- Streaming results (Ask Mnemo) arrive through Tauri events; unsubscribe when the screen closes.

## Behaviour
- Treat all content (notes, links, AI output, connector data) as untrusted: insert as text (`textContent` or library escaping). Never use `innerHTML` with data. Markdown is rendered through a sanitiser.
- Every async action shows a pending state, prevents double submit, and shows a visible message on failure. A failed command never leaves a blank or frozen screen.
- AI can be off, missing, or at the usage limit. Every screen still saves and reads; AI controls show why they are unavailable.
- Destructive actions ask for confirmation or offer undo. Nothing moves, deletes or sends outside Mnemo without the owner's approval.
- Keep state in one place per screen.

## Markup
- Semantic HTML: `button` for actions, `a` for navigation, `form` with real `label`s, landmarks (`header`, `nav`, `main`). No clickable `div`s.
- Every image has `alt`. Every icon-only control has an accessible name.
- Code outside `ui/src/ds` never creates a `button`, `input`, `select`, `textarea` or `dialog` itself (no `createElement`, no markup string). It calls the builders from `ui/src/ds`. Checked by `tests/ds-screen-elements.test.mjs`.
- A part that `ui/src/ds` does not have goes through a UI component request (DESIGN.md §8); the ui-designer agent builds it. Do not build it in the screen.

## Styling
- Styles use design tokens (CSS custom properties) only. No raw colour values in component rules.
- Pick-only: every visual style lives in `ui/src/ds`, and only the ui-designer agent edits `ui/src/ds/**`. CSS outside it holds layout properties only, with token values (`tests/ds-screen-css.test.mjs`). The known exceptions are listed once, in `tests/lib/ds-guard.mjs`.
- Layout uses flex/grid and works from the smallest allowed window size up to full screen with no horizontal scroll.
- Theme uses an attribute on the root element and sets `color-scheme`; apply the saved theme before first paint.
- Bundle fonts locally (the app must work offline). No remote fonts or CDN scripts.

## Quality checks
- Type check, lint and unit tests run in `npm run check`.
- Keyboard only: every control reachable with Tab, focus visible, Escape closes overlays, focus returns where it came from.
- Check each screen in light and dark, and on both macOS (WebKit) and Ubuntu (WebKitGTK) before calling it done. WebKitGTK on Ubuntu 22.04 is older: avoid very new CSS/JS features without checking support.
- Test empty, loading, error, AI-off and long-content states, not only the happy path.
