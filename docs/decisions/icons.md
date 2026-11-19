# Icons: Lucide, bundled locally

Decision (owner-approved with the UI Catalog prototype v3, recorded in `DESIGN.md`): the app uses one icon set, Lucide.

## What was chosen

- Package: `lucide` from npm, pinned to an exact version (1.68.0) in `package.json`. The vanilla package has no framework dependency, which fits the no-framework UI.
- Bundled by Vite from `node_modules`, so the app loads icons with no network call and works offline. No CDN link in any `ui/` file.
- `ui/src/ds/index.ts` exports `createIcon(node, size)`. Each icon is imported by name, so the build keeps only the icons in use. Sizes use `--icon-sm` (16px) and `--icon-md` (20px). Colour comes from `currentColor`, so icons follow the text token.
- Licence: ISC, with the MIT text for the icons derived from Feather. The full text is in `licenses/LUCIDE-LICENSE.txt`, copied from the package.

## Rejected

- `lucide-static` SVG files as raw strings: more files to track and no tree-shaking.
- Copying SVG files into the repo: the licence and version trail gets lost.
- A CDN or the Lucide web font: breaks the offline rule.

## Not checked

Rendering in a real window on macOS (WebKit) and Ubuntu (WebKitGTK) is **Unverified**.
