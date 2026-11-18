# Mnemo logo: brain with a plaster

A tired brain with a yellow plaster: Mnemo is the helper for people who forget things.

Colours: tile indigo `#4B4FD8`, brain white `#FFFFFF`, plaster yellow `#FFE45C`. They match the indigo theme in the prototype.

## Files

| File | Use |
| --- | --- |
| `mnemo-icon-linux.svg` | 1024 master, full tile. Source of every file in `src-tauri/icons/` except `icon.icns`. |
| `mnemo-icon-macos.svg` | 1024 master inside Apple's 824 px grid (transparent margin). Source of `src-tauri/icons/icon.icns`. |
| `mnemo-mark-color.svg` | The brain alone, no tile, for use inside the app. |
| `mnemo-tray-template.svg`, `tray/tray-macos-template*.png` | macOS menu bar. Black on transparent. Load it as a template image so macOS tints it. |
| `mnemo-tray-white.svg`, `tray/tray-linux*.png` | Linux top bar (dark panels). White on transparent. |

The plaster is cut out of the brain with an SVG mask, so every file works on any background.

## Regenerate the app icons

```bash
# 1. Export mnemo-icon-linux.svg to a 1024x1024 PNG, then:
npx tauri icon linux-1024.png
rm -rf src-tauri/icons/android src-tauri/icons/ios   # desktop only
# 2. Export mnemo-icon-macos.svg to a 1024x1024 PNG, run `npx tauri icon` into a temp folder,
#    and copy only its icon.icns over src-tauri/icons/icon.icns.
```
