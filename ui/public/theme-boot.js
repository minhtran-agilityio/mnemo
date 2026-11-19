// Runs before the page is drawn: a classic, blocking script in <head>. The app code in main.ts
// is a module script, and the browser runs module scripts only after it has parsed the page,
// so it can be too late for the first paint. This shows the last known Light or Dark choice at
// once. It mirrors readCachedTheme and applyTheme in src/frame/theme.ts; main.ts applies the
// same choice again and then reads the settings store, which stays the truth.
try {
  const theme = localStorage.getItem("mnemo.theme");
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
  }
} catch {
  // Storage can be blocked. The app then starts in System until the store is read.
}
