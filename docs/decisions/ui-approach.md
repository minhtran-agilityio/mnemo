# UI approach: plain TypeScript or one small library

Status: proposal, awaiting owner approval in the PR. Not final until the owner approves.

**Choice: plain TypeScript.** Small functions build DOM with `textContent`, and a store of about 20 lines (`ui/src/shared/store.ts`) shares state. No UI library.

## Test screen and sizes

Test screen: the #5 kanban (`spikes/spike-01-tauri/`). Each option was built with `npx vite build` (vite 7.3.8) in a scratch folder. Sizes are the JS file, raw and gzip.

| Option | Bundle size (JS) | State sharing | Prototype HTML and CSS | Unit testing |
|---|---|---|---|---|
| Plain TypeScript | 3.76 kB, 1.46 kB gzip (full spike with drag) | Tiny store with subscribe | Reused as is | Pure functions need no DOM; DOM parts use happy-dom |
| Preact 10.29.8 | 14.46 kB, 6.04 kB gzip (render and keys only, no drag) | Hooks or signals | HTML becomes JSX, CSS as is | Needs a render helper and a DOM |
| Lit 3.3.3 | 16.40 kB, 6.35 kB gzip (render and keys only, no drag) | Reactive properties per element | HTML becomes templates, CSS as is | Needs a DOM and custom elements |

The library builds leave out drag, so the real gap is larger. Svelte was not measured: Unverified.

## Why the others lost

- **Preact:** it adds about 4.6 kB gzip of runtime over plain and a rewrite of markup to JSX. It gives nothing we need on a few screens.
- **Lit:** it adds about 4.9 kB gzip, and each part must become a custom element. Shadow DOM would also fight the shared CSS tokens.
- **Svelte:** not measured. It needs a compiler step and a second file type for no gain here.

## Why plain wins

- The goal is low RAM and fast start, and the frontend rules say to ship as little JS as needed.
- The prototype HTML and CSS stay the starting point of every screen with no rewrite.
- Cost: screens write their own DOM updates, so the shared parts and the store must stay small.

## Proof

- `ui/src/shared/card.ts` builds a card. Its test (`card.test.ts`) checks that markup in a title stays text.
- `ui/src/screens/kanban/` is the #5 kanban ported to plain TypeScript. Its CSS is the spike's, unchanged, and `ui/index.html` loads it until P1.2 replaces it.

## Folder layout (proposal)

```
ui/src/screens/<screen>/   one folder per screen: view, state, tests
ui/src/shared/             parts used by two or more screens (card.ts, store.ts)
ui/src/client.ts           the one typed Tauri client; screens never call invoke
```
