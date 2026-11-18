# SPIKE-01: Tauri 2 first test (DEC-01)

Throwaway app in `spikes/spike-01-tauri/`: the project kanban with sample data, one draggable card, and a tray with Open and Quit. It uses no real data, storage, AI or network. Delete the folder after DEC-01.

## Build and run

Ubuntu 22.04, from the repo root. The system packages are the ones in `README.md` (Prerequisites).

```sh
cd spikes/spike-01-tauri
npm ci
npx tauri build --no-bundle
./src-tauri/target/release/mnemo-spike-01
```

Recorded on Ubuntu 22.04.5 LTS (kernel 6.8, GNOME on Wayland, 12 cores, 32 GB): `npm ci` and `npx tauri build --no-bundle` finished with exit code 0 (release build 1 min 10 s, cargo registry already warm). The release binary is 9 MiB. The Mac build was not run.

## Result

| Check | How measured | Mac | Ubuntu |
| --- | --- | --- | --- |
| RAM when the app is open and idle | Ubuntu: measured 3 times, 8 s after launch, with `/proc/<pid>/status` VmRSS and `smaps_rollup` Pss, summed over the app process and its two WebKitGTK child processes. Mac: Activity Monitor | | 374 MB RSS summed (373.6, 374.0, 373.8 MB); 178 MB PSS summed (177.7, 178.1, 177.7 MB). PSS counts shared library pages once, so it is the fairer number. Not read in System Monitor |
| Time from click to first screen, 3 runs | Ubuntu: measured by script, from process start to the window appearing in `wmctrl -l` (polled every 10 ms, `GDK_BACKEND=x11`). Mac: stopwatch, 3 runs | | 80 ms, 89 ms, 76 ms to window mapped. This is not a click and not a painted page; the page content may appear later. Not measurable here: a real click and the first painted frame, because no screen capture or input tool is available. Unverified |
| Kanban looks like the prototype, drag one card | By eye | | Not measurable here: no screenshot or pointer-injection tool, and the prototype was not compared by eye. The window opens and shows the page (process and window seen). Layout match and the card drag in WebKitGTK are Unverified; the drag code uses pointer events and was only built and type-checked |
| Tray: close window, open again, Quit | Ubuntu: window closed with `wmctrl -c`; tray menu read and clicked over D-Bus (`com.canonical.dbusmenu`). Mac: try it | | Pass. The tray menu has exactly two items, Open and Quit. Close: window hidden, process still alive. Open: window shown again. Quit: process and WebKit children gone. Clicking the real tray icon with a mouse was not done; GNOME needs an AppIndicator extension to show it. Unverified |

## Notes

- RAM and start-up have no target number; the owner judges.
- Every Ubuntu number comes from one machine in one session and has no Electron comparison. Treat it as Unverified until the owner repeats it.

DEC-01:
